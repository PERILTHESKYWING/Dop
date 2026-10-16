/**
 * Kami's life-and-death reader: it reads a local fight out move by move, the way a tsumego
 * solver does, and either proves what happens to a group or says that it could not.
 *
 * KataGo judges whole positions. Its ownership and winrate say a group is "probably dead", not
 * "dead whatever the defender tries". Here KataGo only suggests which moves to try first (the
 * hint). The verdict comes from playing the fight out on a small local board:
 *
 * - Area. The local area is the set of points connected to the group over empty points, the
 *   defender's stones and the attacker's stones that are not safe. An attacker chain is safe
 *   (a wall) when KataGo gives it to the attacker (ownership 0.8 or more) or, without
 *   ownership, when it has 6 or more stones, and it must keep two liberties outside the area
 *   (so local play cannot even put it in atari). A wall without them is pulled into the area,
 *   so a stone KataGo expects to connect, or a chain in a race, is read, not assumed safe. Moves are the area's empty points (points emptied by captures included) and,
 *   for the defender, a pass. Walls never change. An area with more than `maxEmpty` empty
 *   points (the group reaches open board) is not a tsumego: the reader returns null.
 * - Goal. The group is the target's chain plus the defender chains linked to it by shared
 *   liberties. Its largest chain is the main chain. The attacker wins by capturing the main
 *   chain (so giving up the main chain to save a smaller part counts as dead). The defender
 *   wins when the main chain is unconditionally alive (Benson's pass-alive test, counting only
 *   regions enclosed inside the area, which is conservative), or when the attacker gives up.
 *   The defender may pass, and if the attacker passes back the group stays on the board, so
 *   the attacker never passes: having no legal move loses.
 * - Search. Depth-first proof-number search (df-pn, with the 1+ε threshold trick) over a
 *   transposition table keyed by a Zobrist hash of the area, the side to move and the ko
 *   point. Moves are tried in this order: KataGo's hint first, then captures, ataris, the main
 *   chain's liberties and points next to many empty points (vital points). Node and time
 *   limits are counted. A search that hits one before a proof gives 'unresolved', never a
 *   guess.
 * - Ko. Each result is read twice: once with the defender allowed to retake a ko at once
 *   (unlimited ko threats), once with the attacker allowed to. If the group is dead even when
 *   the defender wins every ko, it is dead. If it is alive even when the attacker wins every
 *   ko, it is alive. Otherwise its fate is a ko. A position repeated along a line counts for
 *   the side with threats, and a result that used such a repetition is not called proven
 *   (double ko and other long cycles).
 * - Seki. The defender can live because the attacker gives up rather than by Benson's test.
 *   If an attacker chain in the area then shares a liberty with the group and has at least as
 *   many liberties as the group's chain next to it, the result is 'seki'. This name is a
 *   heuristic. The defender's survival itself is proven.
 *
 * Snapback, throw-ins and false eyes need no special code. They come out of legal play and
 * Benson's test.
 */
import type { Board, Group } from '../../go/board';
import { other, PASS, type Color, type Loc } from '../../go/types';
import type { LifeDeathVerdict } from './types';

export interface LifeDeathOptions {
  /** Search nodes for the whole verdict, all reads together (default 300k; ~120k nodes/s in Node). */
  maxNodes?: number;
  /** Wall-clock cap for the whole verdict (default 1200 ms; it runs on the main thread). */
  maxMs?: number;
  /** Most empty points the local area may have (default 24). */
  maxEmpty?: number;
  /** Black-positive ownership from KataGo (size*size): tells safe walls from weak stones. */
  own?: Float32Array | null;
}

type Fate = LifeDeathVerdict['result'];

const DEFAULTS = { maxNodes: 300_000, maxMs: 1200, maxEmpty: 24 };
/** Most points (stones and empties) in a local area. */
const MAX_POINTS = 180;
/** Without ownership, an attacker chain this big counts as a wall. */
const WALL_STONES = 6;
/** With ownership, an attacker chain owned this much by the attacker counts as a wall. */
const WALL_OWN = 0.8;
const LINE_CAP = 12;
/** Lines are cut at this depth (the attacker is taken to fail there, and nothing is called proven). */
const MAX_DEPTH = 150;
const INF = 1_000_000_000;
/** Liberty count standing for "joined to a wall": such a chain is never captured. */
const MANY = 1000;
/** Share of the node and time budget for the side-to-move reads (the rest is for the other side first). */
const FIRST_SHARE = 0.7;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ---------------------------------------------------------------------------------------------
// The local area

interface Area {
  /** Global points in the area, the start point first. */
  points: Loc[];
  inA: Uint8Array;
}

function chainIndex(board: Board): { id: Int32Array; chains: Group[] } {
  const id = new Int32Array(board.stones.length).fill(-1);
  const chains = board.groups();
  chains.forEach((g, i) => {
    for (const s of g.stones) id[s] = i;
  });
  return { id, chains };
}

function isWall(g: Group, own: Float32Array | null): boolean {
  if (!own) return g.stones.length >= WALL_STONES;
  let t = 0;
  for (const s of g.stones) t += own[s];
  return (g.color === 1 ? t : -t) / g.stones.length >= WALL_OWN;
}

/** The local area around the group at `start` (see the top of the file), or null when it is open. */
function buildArea(board: Board, start: Loc, own: Float32Array | null, maxEmpty: number): Area | null {
  const defender = board.stones[start];
  if (defender !== 1 && defender !== 2) return null;
  const attacker = other(defender);
  const { id, chains } = chainIndex(board);
  const wall = chains.map((g) => g.color === attacker && isWall(g, own));
  for (let round = 0; round < 8; round++) {
    const inA = new Uint8Array(board.stones.length);
    const points: Loc[] = [];
    let empties = 0;
    const stack = [start];
    inA[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      points.push(p);
      if (board.stones[p] === 0 && ++empties > maxEmpty) return null;
      if (points.length > MAX_POINTS) return null;
      for (const q of board.neighbors(p)) {
        if (inA[q] || (board.stones[q] === attacker && wall[id[q]])) continue;
        inA[q] = 1;
        stack.push(q);
      }
    }
    // Every point next to the area but outside it is a wall stone. A wall must keep two
    // liberties outside the area: then no local play can even put it in atari. A wall short
    // of liberties (a stone KataGo expects to connect, a chain in a race) is part of the
    // fight: pull it in and flood again.
    let changed = false;
    const seen = new Set<number>();
    for (const p of points)
      for (const q of board.neighbors(p)) {
        if (inA[q] || seen.has(id[q])) continue;
        seen.add(id[q]);
        let outside = 0;
        for (const l of chains[id[q]].liberties) if (!inA[l]) outside++;
        if (outside < 2) {
          wall[id[q]] = false;
          changed = true;
        }
      }
    if (!changed) return { points, inA };
  }
  return null;
}

/**
 * The group: the chain at `start` and the same-coloured chains linked to it by shared
 * liberties. `main` is its largest chain (the start chain on a tie).
 */
function linkedGroup(board: Board, start: Loc): { stones: Loc[]; main: Loc[] } {
  const color = board.stones[start];
  const seen = new Uint8Array(board.stones.length);
  const first = board.groupAt(start)!;
  for (const s of first.stones) seen[s] = 1;
  const queue = [first];
  const stones: Loc[] = [];
  let main = first.stones;
  for (let i = 0; i < queue.length; i++) {
    const g = queue[i];
    stones.push(...g.stones);
    if (g.stones.length > main.length) main = g.stones;
    for (const l of g.liberties)
      for (const q of board.neighbors(l)) {
        if (board.stones[q] !== color || seen[q]) continue;
        const h = board.groupAt(q)!;
        for (const s of h.stones) seen[s] = 1;
        queue.push(h);
      }
  }
  return { stones, main };
}

// ---------------------------------------------------------------------------------------------
// The reader: a small board over the area with make/undo, df-pn and Benson's test

interface Entry {
  /** Proof and disproof numbers for the side to move (0 / INF when proven). */
  phi: number;
  delta: number;
  /** Nodes spent below this position (the strongest resistance is the one that took most work). */
  work: number;
  /** Benson's test already done here (and it was not alive). */
  seen: boolean;
}

interface Kids {
  n: number;
  /** Local point, -1 = pass. */
  mv: Int16Array;
  key: Float64Array;
  /**
   * 0 = open, 1 = the child's mover has won, 2 = the child's mover has lost (main chain
   * captured, or a repetition counted against it).
   */
  term: Int8Array;
  score: Int32Array;
  /** The child's table entry, looked up once per expansion (refreshed after reading it). */
  ent: (Entry | undefined)[];
}

interface Run {
  /** Who wins the read: the colour, or 0 when it was not settled. */
  win: Color | 0;
  /** No repetition used and no line cut at MAX_DEPTH. */
  clean: boolean;
  /** A position with a ko ban was read (else the other ko rule reads the very same tree). */
  koSeen: boolean;
  free: Color;
}

interface Decision {
  fate: Fate;
  proven: boolean;
  /** The read whose table holds the proof (its `free` side). */
  free: Color;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) | 0;
  };
}

const keyOf = (a: number, b: number) => (a >>> 0) * 2097152 + ((b >>> 0) >>> 11);

class Reader {
  readonly m: number;
  readonly glob: Int32Array;
  /** Four neighbours per point: local index, -1 off the board, -2 a wall stone (attacker's). */
  readonly nb: Int16Array;
  readonly col: Int8Array;
  readonly att: Color;
  readonly def: Color;
  readonly anchor: number;
  /** Stones of the group at the start (seki test). */
  readonly grp: Uint8Array;
  readonly hint: Int16Array;
  readonly z: Int32Array;
  readonly zKo: Int32Array;
  readonly zSide: [number, number];
  readonly rootH: [number, number];
  readonly rootKo: number;
  h1 = 0;
  h2 = 0;
  ko = -1;
  toMove: Color = 1;
  /** The side allowed to retake a ko at once in the current read. */
  free: Color = 1;
  tt: Map<number, Entry> = new Map();
  readonly tts: [Map<number, Entry>, Map<number, Entry>] = [new Map(), new Map()];
  nodes = 0;
  budget = 0;
  deadline = 0;
  aborted = false;
  /**
   * Per table (index free - 1), sticky because later reads reuse earlier proofs: a repetition
   * was counted, a line was cut at MAX_DEPTH, a position with a ko ban was read.
   */
  readonly cycT = [false, false];
  readonly deepT = [false, false];
  readonly koT = [false, false];
  readonly path = new Set<number>();
  // Chain map of the current position (chains()).
  readonly cid: Int16Array;
  readonly cLibs: Int16Array;
  readonly cLen: Int16Array;
  readonly cStart: Int16Array;
  readonly cStones: Int16Array;
  nChains = 0;
  readonly mark: Int32Array;
  readonly lmark: Int32Array;
  stamp = 0;
  readonly stk: Int16Array;
  readonly kids: Kids[] = [];
  // Undo records.
  sp = 0;
  readonly uKo: Int16Array;
  readonly uP: Int16Array;
  readonly uH1: Int32Array;
  readonly uH2: Int32Array;
  readonly uCap: Int32Array;
  readonly caps: number[] = [];
  // Benson scratch: region of each point, and per region its empty points and defender chains.
  readonly reg: Int16Array;
  readonly rClosed: Uint8Array;
  readonly rEm: Int16Array;
  readonly rEmN: Int16Array;
  readonly rAr: Int32Array;
  readonly rArN: Int16Array;
  readonly emList: Int16Array;
  readonly arList: Int16Array;
  readonly aliveC: Uint8Array;
  readonly aliveR: Uint8Array;
  // Child values (childPD), kept in fields to avoid allocating.
  cp = 0;
  cd = 0;

  constructor(board: Board, area: Area, anchor: Loc, group: Loc[], hint: Loc[]) {
    const n = board.size;
    this.def = board.stones[anchor] as Color;
    this.att = other(this.def);
    const pts = area.points;
    const m = (this.m = pts.length);
    this.glob = Int32Array.from(pts);
    const local = new Map<number, number>();
    pts.forEach((p, i) => local.set(p, i));
    this.nb = new Int16Array(m * 4);
    this.col = new Int8Array(m);
    for (let i = 0; i < m; i++) {
      const p = pts[i];
      this.col[i] = board.stones[p];
      const x = p % n;
      const y = (p - x) / n;
      const around = [x > 0 ? p - 1 : -1, x < n - 1 ? p + 1 : -1, y > 0 ? p - n : -1, y < n - 1 ? p + n : -1];
      for (let j = 0; j < 4; j++) {
        const q = around[j];
        this.nb[i * 4 + j] = q < 0 ? -1 : area.inA[q] ? local.get(q)! : -2;
      }
    }
    this.anchor = local.get(anchor)!;
    this.grp = new Uint8Array(m);
    for (const s of group) if (local.has(s)) this.grp[local.get(s)!] = 1;
    this.hint = new Int16Array(m).fill(-1);
    let rank = 0;
    for (const h of hint) {
      const i = local.get(h);
      if (i !== undefined && this.hint[i] < 0) this.hint[i] = rank++;
    }
    const rnd = mulberry(0x5eed + m);
    this.z = new Int32Array(m * 4);
    for (let i = 0; i < this.z.length; i++) this.z[i] = rnd();
    this.zKo = new Int32Array(m * 2);
    for (let i = 0; i < this.zKo.length; i++) this.zKo[i] = rnd();
    this.zSide = [rnd(), rnd()];
    for (let i = 0; i < m; i++)
      if (this.col[i]) {
        this.h1 ^= this.z[i * 4 + (this.col[i] - 1) * 2];
        this.h2 ^= this.z[i * 4 + (this.col[i] - 1) * 2 + 1];
      }
    this.rootH = [this.h1, this.h2];
    this.rootKo = board.koPoint >= 0 && local.has(board.koPoint) ? local.get(board.koPoint)! : -1;
    this.cid = new Int16Array(m);
    this.cLibs = new Int16Array(m);
    this.cLen = new Int16Array(m);
    this.cStart = new Int16Array(m);
    this.cStones = new Int16Array(m);
    this.mark = new Int32Array(m);
    this.lmark = new Int32Array(m);
    this.stk = new Int16Array(m);
    this.reg = new Int16Array(m);
    this.rClosed = new Uint8Array(m);
    this.rEm = new Int16Array(m);
    this.rEmN = new Int16Array(m);
    this.rAr = new Int32Array(m);
    this.rArN = new Int16Array(m);
    this.emList = new Int16Array(m);
    this.arList = new Int16Array(m * 4);
    this.aliveC = new Uint8Array(m);
    this.aliveR = new Uint8Array(m);
    const depth = MAX_DEPTH + LINE_CAP + 4;
    this.uKo = new Int16Array(depth);
    this.uP = new Int16Array(depth);
    this.uH1 = new Int32Array(depth);
    this.uH2 = new Int32Array(depth);
    this.uCap = new Int32Array(depth);
  }

  key(): number {
    const tb = this.toMove === 2;
    const k = this.ko >= 0 && this.toMove !== this.free;
    return keyOf(
      this.h1 ^ (tb ? this.zSide[0] : 0) ^ (k ? this.zKo[this.ko * 2] : 0),
      this.h2 ^ (tb ? this.zSide[1] : 0) ^ (k ? this.zKo[this.ko * 2 + 1] : 0),
    );
  }

  /** Back to the root position with `mover` to play, in the read where `free` may retake kos. */
  reset(mover: Color, free: Color, ko: number) {
    while (this.sp) this.undo();
    this.toMove = mover;
    this.free = free;
    this.tt = this.tts[free - 1];
    this.ko = ko;
    this.h1 = this.rootH[0];
    this.h2 = this.rootH[1];
  }

  // --- board ---

  private hasLiberty(q: number): boolean {
    const c = this.col[q];
    const st = ++this.stamp;
    const { nb, col, mark, stk } = this;
    let top = 0;
    stk[top++] = q;
    mark[q] = st;
    while (top) {
      const p = stk[--top];
      for (let j = p * 4; j < p * 4 + 4; j++) {
        const r = nb[j];
        if (r === -1) continue;
        if (r === -2) {
          if (c === this.att) return true;
          continue;
        }
        const v = col[r];
        if (v === 0) return true;
        if (v === c && mark[r] !== st) {
          mark[r] = st;
          stk[top++] = r;
        }
      }
    }
    return false;
  }

  private remove(q: number) {
    const c = this.col[q];
    const zi = (c - 1) * 2;
    const { nb, col, stk } = this;
    let top = 0;
    stk[top++] = q;
    col[q] = 0;
    while (top) {
      const p = stk[--top];
      this.caps.push(p);
      this.h1 ^= this.z[p * 4 + zi];
      this.h2 ^= this.z[p * 4 + zi + 1];
      for (let j = p * 4; j < p * 4 + 4; j++) {
        const r = nb[j];
        if (r >= 0 && col[r] === c) {
          col[r] = 0;
          stk[top++] = r;
        }
      }
    }
  }

  /** Play a legal move (-1 = pass) for the side to move. */
  play(p: number) {
    const d = this.sp++;
    this.uKo[d] = this.ko;
    this.uP[d] = p;
    this.uH1[d] = this.h1;
    this.uH2[d] = this.h2;
    this.uCap[d] = this.caps.length;
    const mover = this.toMove;
    const opp = other(mover);
    this.toMove = opp;
    this.ko = -1;
    if (p < 0) return;
    const { nb, col } = this;
    col[p] = mover;
    this.h1 ^= this.z[p * 4 + (mover - 1) * 2];
    this.h2 ^= this.z[p * 4 + (mover - 1) * 2 + 1];
    for (let j = p * 4; j < p * 4 + 4; j++) {
      const q = nb[j];
      if (q >= 0 && col[q] === opp && !this.hasLiberty(q)) this.remove(q);
    }
    if (this.caps.length - this.uCap[d] === 1) {
      // Simple ko: one stone captured by a lone stone that now has that point as its only liberty.
      let lone = true;
      let libs = 0;
      for (let j = p * 4; j < p * 4 + 4; j++) {
        const q = nb[j];
        if (q === -2) lone &&= mover !== this.att;
        else if (q >= 0) {
          if (col[q] === mover) lone = false;
          else if (col[q] === 0) libs++;
        }
      }
      if (lone && libs === 1) this.ko = this.caps[this.caps.length - 1];
    }
  }

  undo() {
    const d = --this.sp;
    const p = this.uP[d];
    const mover = other(this.toMove);
    this.toMove = mover;
    if (p >= 0) {
      this.col[p] = 0;
      const opp = other(mover);
      while (this.caps.length > this.uCap[d]) this.col[this.caps.pop()!] = opp;
    }
    this.ko = this.uKo[d];
    this.h1 = this.uH1[d];
    this.h2 = this.uH2[d];
  }

  /** Chains of the current position with their liberty counts (MANY when joined to a wall). */
  chains() {
    const { m, nb, col, cid, cLibs, cLen, cStart, cStones, lmark } = this;
    cid.fill(-1);
    let nc = 0;
    let top = 0;
    for (let s = 0; s < m; s++) {
      const c = col[s];
      if (!c || cid[s] >= 0) continue;
      const st = ++this.stamp;
      cStart[nc] = top;
      cid[s] = nc;
      cStones[top++] = s;
      let libs = 0;
      let wall = false;
      for (let k = cStart[nc]; k < top; k++) {
        const p = cStones[k];
        for (let j = p * 4; j < p * 4 + 4; j++) {
          const r = nb[j];
          if (r === -1) continue;
          if (r === -2) {
            wall ||= c === this.att;
            continue;
          }
          const v = col[r];
          if (v === 0) {
            if (lmark[r] !== st) {
              lmark[r] = st;
              libs++;
            }
          } else if (v === c && cid[r] < 0) {
            cid[r] = nc;
            cStones[top++] = r;
          }
        }
      }
      cLen[nc] = top - cStart[nc];
      cLibs[nc] = wall ? MANY : Math.min(libs, MANY - 1);
      nc++;
    }
    this.nChains = nc;
  }

  /**
   * Benson's test for the main chain (needs chains()): the defender's chains that keep two
   * vital regions while chains without them are dropped, and regions next to dropped chains
   * with them. Only regions enclosed inside the area count, so it may miss life (never finds
   * false life).
   */
  passAlive(): boolean {
    const { m, nb, col, cid, def, reg, stk, rClosed, rEm, rEmN, rAr, rArN, emList, arList, aliveC, aliveR } = this;
    const a = cid[this.anchor];
    if (a < 0 || this.cLibs[a] < 2) return false;
    reg.fill(-1);
    // Regions: connected non-defender points, each with: enclosed?, its empty points, and the
    // defender chains next to it (flat lists).
    let nr = 0;
    let emTop = 0;
    let arTop = 0;
    for (let s = 0; s < m; s++) {
      if (col[s] === def || reg[s] >= 0) continue;
      let top = 0;
      stk[top++] = s;
      reg[s] = nr;
      let closed = 1;
      rEm[nr] = emTop;
      rAr[nr] = arTop;
      while (top) {
        const p = stk[--top];
        if (col[p] === 0) emList[emTop++] = p;
        for (let j = p * 4; j < p * 4 + 4; j++) {
          const r = nb[j];
          if (r === -1) continue;
          if (r === -2) {
            closed = 0;
            continue;
          }
          if (col[r] === def) {
            const c = cid[r];
            let known = false;
            for (let k = rAr[nr]; k < arTop; k++) if (arList[k] === c) known = true;
            if (!known) arList[arTop++] = c;
          } else if (reg[r] < 0) {
            reg[r] = nr;
            stk[top++] = r;
          }
        }
      }
      rEmN[nr] = emTop - rEm[nr];
      rArN[nr] = arTop - rAr[nr];
      rClosed[nr] = closed && rEmN[nr] > 0 ? 1 : 0;
      aliveR[nr] = rClosed[nr];
      nr++;
    }
    let quick = 0;
    for (let r = 0; r < nr && quick < 2; r++) if (this.vital(r, a)) quick++;
    if (quick < 2) return false;
    for (let c = 0; c < this.nChains; c++) aliveC[c] = col[this.cStones[this.cStart[c]]] === def ? 1 : 0;
    for (let changed = true; changed; ) {
      changed = false;
      for (let c = 0; c < this.nChains; c++) {
        if (!aliveC[c]) continue;
        let v = 0;
        for (let r = 0; r < nr && v < 2; r++) if (aliveR[r] && this.vital(r, c)) v++;
        if (v < 2) {
          aliveC[c] = 0;
          changed = true;
        }
      }
      for (let r = 0; r < nr; r++) {
        if (!aliveR[r]) continue;
        for (let k = rAr[r]; k < rAr[r] + rArN[r]; k++)
          if (!aliveC[arList[k]]) {
            aliveR[r] = 0;
            changed = true;
            break;
          }
      }
    }
    return aliveC[a] === 1;
  }

  /** Region r (from passAlive) is vital to chain c: enclosed, next to c, every empty point a liberty of c. */
  private vital(r: number, c: number): boolean {
    if (!this.rClosed[r]) return false;
    const { nb, col, cid, def, emList, arList } = this;
    let next = false;
    for (let k = this.rAr[r]; k < this.rAr[r] + this.rArN[r]; k++) if (arList[k] === c) next = true;
    if (!next) return false;
    for (let k = this.rEm[r]; k < this.rEm[r] + this.rEmN[r]; k++) {
      const p = emList[k];
      let lib = false;
      for (let j = p * 4; j < p * 4 + 4 && !lib; j++) {
        const q = nb[j];
        lib = q >= 0 && col[q] === def && cid[q] === c;
      }
      if (!lib) return false;
    }
    return true;
  }

  /** After the attacker gives up: is it seki rather than plain life? (needs nothing; see the top). */
  sekiNow(): boolean {
    this.chains();
    if (this.passAlive()) return false;
    const { m, nb, col, cid, cLibs, def, att } = this;
    const a = cid[this.anchor];
    const inGroup = (c: number) => {
      if (c === a) return true;
      for (let k = this.cStart[c]; k < this.cStart[c] + this.cLen[c]; k++) if (this.grp[this.cStones[k]]) return true;
      return false;
    };
    for (let p = 0; p < m; p++) {
      if (col[p] !== 0) continue;
      let minDef = MANY;
      let maxAtt = 0;
      for (let j = p * 4; j < p * 4 + 4; j++) {
        const q = nb[j];
        if (q < 0) continue;
        const l = cLibs[cid[q]];
        if (col[q] === def && inGroup(cid[q])) minDef = Math.min(minDef, l);
        else if (col[q] === att && l < MANY) maxAtt = Math.max(maxAtt, l);
      }
      if (maxAtt >= 2 && minDef <= maxAtt) return true;
    }
    return false;
  }

  /** Legal moves of the side to move with their child keys, best first (needs chains()). */
  gen(depth: number): Kids {
    const m = this.m;
    let k = this.kids[depth];
    if (!k) k = this.kids[depth] = { n: 0, mv: new Int16Array(m + 1), key: new Float64Array(m + 1), term: new Int8Array(m + 1), score: new Int32Array(m + 1), ent: [] };
    const { nb, col, cid, cLibs, cLen, cStart, cStones, z } = this;
    const mover = this.toMove;
    const opp = other(mover);
    const bound = mover !== this.free;
    const childBound = opp !== this.free;
    const a = cid[this.anchor];
    const zm = (mover - 1) * 2;
    const zo = (opp - 1) * 2;
    const sideOpp = opp === 2;
    const seen = [-1, -1, -1, -1];
    let n = 0;
    for (let p = 0; p < m; p++) {
      if (col[p] !== 0 || (bound && p === this.ko)) continue;
      let empt = 0;
      let ok = false;
      let same = false;
      let capStones = 0;
      let capLoc = -1;
      let capsMain = false;
      let atari = 0;
      let nearMain = false;
      let libsEst = 0;
      let x1 = this.h1 ^ z[p * 4 + zm];
      let x2 = this.h2 ^ z[p * 4 + zm + 1];
      let ns = 0;
      let wallNext = false;
      let oppNext = false;
      let ownChains = 0;
      for (let j = p * 4; j < p * 4 + 4; j++) {
        const q = nb[j];
        if (q === -1) continue;
        if (q === -2) {
          if (mover === this.att) {
            ok = same = wallNext = true;
            libsEst += MANY;
          } else oppNext = true;
          continue;
        }
        const c = col[q];
        if (c === 0) {
          empt++;
          continue;
        }
        const ch = cid[q];
        if (ch === a) nearMain = true;
        if (c !== mover) oppNext = true;
        if (seen[0] === ch || seen[1] === ch || seen[2] === ch || seen[3] === ch) continue;
        seen[ns++] = ch;
        const l = cLibs[ch];
        if (c === mover) {
          ownChains++;
          same = true;
          if (l >= 2) ok = true;
          libsEst += l - 1;
        } else if (l === 1) {
          ok = true;
          capStones += cLen[ch];
          capLoc = q;
          libsEst += 1;
          if (ch === a) capsMain = true;
          for (let s = cStart[ch]; s < cStart[ch] + cLen[ch]; s++) {
            x1 ^= z[cStones[s] * 4 + zo];
            x2 ^= z[cStones[s] * 4 + zo + 1];
          }
        } else if (l === 2) atari++;
      }
      seen[0] = seen[1] = seen[2] = seen[3] = -1;
      if (!ok && empt === 0) continue; // suicide
      // Filling one's own one-point eye (next to one own chain only, or only to walls) never
      // helps: it only takes a liberty from one's own chain, and passing is always as good
      // (the defender may pass; for the attacker it is a waiting move, and waiting never
      // helps it since the defender can pass back).
      if (empt === 0 && !oppNext && (wallNext ? ownChains === 0 : ownChains === 1)) continue;
      libsEst += empt;
      const newKo = capStones === 1 && !same && empt === 0 ? capLoc : -1;
      if (sideOpp) {
        x1 ^= this.zSide[0];
        x2 ^= this.zSide[1];
      }
      if (newKo >= 0 && childBound) {
        x1 ^= this.zKo[newKo * 2];
        x2 ^= this.zKo[newKo * 2 + 1];
      }
      let sc = 0;
      if (this.hint[p] >= 0) sc += 400 - 20 * Math.min(this.hint[p], 10);
      sc += Math.min(capStones, 10) * 30 + atari * 8 + empt * 3;
      if (nearMain) sc += 12;
      if (libsEst <= 1 && capStones === 0) sc -= 6;
      k.mv[n] = p;
      k.key[n] = keyOf(x1, x2);
      k.term[n] = capsMain ? 2 : 0;
      k.score[n] = capsMain ? 1 << 20 : sc;
      n++;
    }
    if (mover === this.def) {
      // Pass (tenuki, or a ko threat elsewhere): last.
      const s = opp === 2;
      k.mv[n] = -1;
      k.key[n] = keyOf(this.h1 ^ (s ? this.zSide[0] : 0), this.h2 ^ (s ? this.zSide[1] : 0));
      k.term[n] = 0;
      k.score[n] = -(1 << 20);
      n++;
    }
    // Insertion sort, best first (stable, so the scan order breaks ties).
    for (let i = 1; i < n; i++) {
      const mv = k.mv[i], ky = k.key[i], t = k.term[i], s = k.score[i];
      let j = i - 1;
      while (j >= 0 && k.score[j] < s) {
        k.mv[j + 1] = k.mv[j];
        k.key[j + 1] = k.key[j];
        k.term[j + 1] = k.term[j];
        k.score[j + 1] = k.score[j];
        j--;
      }
      k.mv[j + 1] = mv;
      k.key[j + 1] = ky;
      k.term[j + 1] = t;
      k.score[j + 1] = s;
    }
    k.n = n;
    // A position already on the current line is a repetition: it counts for the side allowed
    // to retake kos at once.
    const repWins = opp === this.free ? 1 : 2;
    for (let i = 0; i < n; i++) {
      if (!k.term[i] && this.path.has(k.key[i])) {
        k.term[i] = repWins;
        this.cycT[this.free - 1] = true;
      }
      k.ent[i] = k.term[i] ? undefined : this.tt.get(k.key[i]);
    }
    return k;
  }

  /** The child's proof/disproof numbers (for its own mover) into cp/cd. */
  private childPD(k: Kids, i: number) {
    const t = k.term[i];
    if (t) {
      this.cp = t === 1 ? 0 : INF;
      this.cd = t === 1 ? INF : 0;
      return;
    }
    const e = k.ent[i];
    this.cp = e ? e.phi : 1;
    this.cd = e ? e.delta : 1;
  }

  private settle(e: Entry, moverWins: boolean) {
    e.phi = moverWins ? 0 : INF;
    e.delta = moverWins ? INF : 0;
  }

  private mid(key: number, thPhi: number, thDelta: number, depth: number): Entry {
    this.nodes++;
    let e = this.tt.get(key);
    if (e && (e.phi >= thPhi || e.delta >= thDelta)) return e;
    if (!e) {
      e = { phi: 1, delta: 1, work: 0, seen: false };
      this.tt.set(key, e);
    }
    if (this.nodes >= this.budget || ((this.nodes & 127) === 0 && now() >= this.deadline)) this.aborted = true;
    if (this.aborted) return e;
    const start = this.nodes;
    const mover = this.toMove;
    if (this.ko >= 0) this.koT[this.free - 1] = true;
    if (depth >= MAX_DEPTH) {
      this.deepT[this.free - 1] = true;
      this.settle(e, mover === this.def);
      return e;
    }
    this.chains();
    if (!e.seen) {
      if (this.passAlive()) {
        this.settle(e, mover === this.def);
        return e;
      }
      e.seen = true;
    }
    const k = this.gen(depth);
    if (k.n === 0) {
      // Only the attacker can run out of moves (the defender may pass): it has failed.
      this.settle(e, mover === this.def);
      return e;
    }
    this.path.add(key);
    for (;;) {
      let phi = INF;
      let delta = 0;
      let best = -1;
      let bestPhi = 0;
      let d2 = INF;
      for (let i = 0; i < k.n; i++) {
        this.childPD(k, i);
        if (this.cd < phi) {
          d2 = phi;
          phi = this.cd;
          best = i;
          bestPhi = this.cp;
        } else if (this.cd < d2) d2 = this.cd;
        delta = Math.min(INF, delta + this.cp);
      }
      e.phi = phi;
      e.delta = delta;
      if (phi >= thPhi || delta >= thDelta || this.aborted) break;
      const cThPhi = Math.min(INF, thDelta - delta + bestPhi);
      const cThDelta = Math.min(thPhi, d2 >= INF ? INF : Math.max(d2 + 1, Math.ceil(d2 * 1.25)));
      this.play(k.mv[best]);
      k.ent[best] = this.mid(k.key[best], cThPhi, cThDelta, depth + 1);
      this.undo();
    }
    this.path.delete(key);
    e.work += this.nodes - start;
    return e;
  }

  /** One read from the root: who wins with `mover` to play when `free` may retake kos at once. */
  run(mover: Color, free: Color, ko: number, nodes: number, deadline: number): Run {
    this.reset(mover, free, ko);
    this.aborted = false;
    this.path.clear();
    this.budget = this.nodes + Math.max(1, Math.floor(nodes));
    this.deadline = deadline;
    const key = this.key();
    this.mid(key, INF, INF, 0);
    const e = this.tt.get(key)!;
    const win: Color | 0 = e.phi === 0 ? mover : e.delta === 0 ? other(mover) : 0;
    const t = free - 1;
    return { win, clean: !this.cycT[t] && !this.deepT[t], koSeen: this.koT[t], free };
  }

  /**
   * The group's fate with `mover` first: the read with the defender's unlimited ko threats
   * first (dead there is dead), then the attacker's (alive there is alive), else ko. When the
   * first read met no ko ban and no repetition, the second would read the very same tree:
   * the first read gets the whole budget and decides alone.
   */
  decide(mover: Color, ko: number, nodes: number, deadline: number): Decision {
    const n0 = this.nodes;
    const t0 = now();
    const left = () => nodes - (this.nodes - n0);
    const sameTree = (x: Run) => !x.koSeen && x.clean;
    let a = this.run(mover, this.def, ko, nodes * 0.6, t0 + (deadline - t0) * 0.6);
    // Not settled yet and no ko in sight: go on with the same table (df-pn resumes).
    if (!a.win && sameTree(a) && left() > 0) a = this.run(mover, this.def, ko, left(), deadline);
    if (a.win === this.att) return { fate: 'dead', proven: a.clean, free: this.def };
    if (a.win === this.def && sameTree(a)) return { fate: 'alive', proven: true, free: this.def };
    if (!a.win && sameTree(a)) return { fate: 'unresolved', proven: false, free: mover };
    const b = this.run(mover, this.att, ko, left(), deadline);
    if (b.win === this.def) return { fate: 'alive', proven: b.clean, free: this.att };
    if (a.win === this.def && b.win === this.att) {
      // The side to move wins the ko in the read where it has the threats.
      return { fate: 'ko', proven: a.clean && b.clean, free: mover };
    }
    return { fate: 'unresolved', proven: false, free: mover };
  }

  private workOf(k: Kids, i: number): number {
    if (k.term[i]) return 0;
    return this.tt.get(k.key[i])?.work ?? 0;
  }

  /**
   * The proving line from the root of a read (local points, -1 = pass): the winner's proven
   * move (KataGo's hint first, then the quickest proof), the loser's strongest resistance (the
   * reply that took most work to refute). It stops when the main chain is captured, the group
   * is pass-alive, the attacker has only hopeless tries left, or at LINE_CAP moves. The
   * loser passes only when it has no other legal move.
   */
  line(mover: Color, free: Color, ko: number, pick?: (k: Kids, ok: number[]) => number): number[] {
    this.reset(mover, free, ko);
    const out: number[] = [];
    const visited = new Set<number>();
    while (out.length < LINE_CAP) {
      const key = this.key();
      if (visited.has(key)) break;
      visited.add(key);
      const e = this.tt.get(key);
      if (!e) break;
      this.chains();
      if (this.passAlive()) break;
      this.path.clear();
      const k = this.gen(out.length);
      if (!k.n) break;
      const mv = this.toMove;
      let choice = -1;
      if (e.phi === 0) {
        const ok: number[] = [];
        for (let i = 0; i < k.n; i++) {
          this.childPD(k, i);
          if (this.cd === 0) ok.push(i);
        }
        if (!ok.length) break;
        if (out.length === 0 && pick) choice = pick(k, ok);
        if (choice < 0) {
          let bestRank = Infinity;
          for (const i of ok) {
            const p = k.mv[i];
            const rank = (p < 0 ? 2e9 : 0) + (p >= 0 && this.hint[p] >= 0 ? this.hint[p] * 1e6 : 1e8) + this.workOf(k, i);
            if (rank < bestRank) {
              bestRank = rank;
              choice = i;
            }
          }
        }
      } else if (e.delta === 0) {
        let most = -1;
        for (let i = 0; i < k.n; i++) {
          // A local reply reads better than a pass; a pass only when nothing else is legal.
          if (k.mv[i] < 0 && k.n > 1) continue;
          const w = this.workOf(k, i);
          if (w > most) {
            most = w;
            choice = i;
          }
        }
        if (mv === this.att && out.length > 0 && most <= 0) break;
      } else break;
      if (choice < 0) break;
      const t = k.term[choice];
      out.push(k.mv[choice]);
      this.play(k.mv[choice]);
      if (t === 2) break;
    }
    while (out.length && out[out.length - 1] < 0) out.pop();
    this.reset(mover, free, ko);
    return out;
  }

  /** Plain life or seki, at the position after `moves` from the root (attacker to move there). */
  sekiAfter(mover: Color, free: Color, ko: number, moves: number[]): boolean {
    this.reset(mover, free, ko);
    for (const p of moves) this.play(p);
    const s = this.sekiNow();
    this.reset(mover, free, ko);
    return s;
  }
}

// ---------------------------------------------------------------------------------------------
// API

/**
 * The group a question is about: the weakest sizeable group near `near` (any colour), its
 * local area, or null. `own` = Black-positive ownership (-1..1, size*size) from KataGo when
 * available. Only enclosed groups count (open fights are not tsumego). Weakest: lowest
 * ownership for its owner (without ownership: fewest liberties), pass-alive groups last,
 * single stones only when nothing bigger is near.
 */
export function findTarget(board: Board, near: Loc[], own: Float32Array | null): { stones: Loc[]; owner: Color; region: Loc[] } | null {
  const n = board.size;
  const seen = new Uint8Array(board.stones.length);
  let best: { stones: Loc[]; owner: Color; region: Loc[]; score: number } | null = null;
  for (const c of near) {
    if (c < 0 || c >= board.stones.length) continue;
    const cx = c % n;
    const cy = (c - cx) / n;
    for (let y = Math.max(0, cy - 2); y <= Math.min(n - 1, cy + 2); y++)
      for (let x = Math.max(0, cx - 2); x <= Math.min(n - 1, cx + 2); x++) {
        const p = y * n + x;
        if (!board.stones[p] || seen[p]) continue;
        const g = linkedGroup(board, p);
        for (const s of g.stones) seen[s] = 1;
        const area = buildArea(board, p, own, DEFAULTS.maxEmpty);
        if (!area) continue;
        const owner = board.stones[p] as Color;
        // A pass-alive group is never the question (a frame's wall, a settled corner): last.
        const r = new Reader(board, area, g.main[0], g.stones, []);
        r.chains();
        let status: number;
        if (r.passAlive()) status = 2;
        else if (own) {
          let t = 0;
          for (const s of g.stones) t += own[s];
          status = (owner === 1 ? t : -t) / g.stones.length;
        } else {
          const libs = new Set<Loc>();
          for (const s of g.stones) for (const q of board.neighbors(s)) if (!board.stones[q]) libs.add(q);
          status = Math.min(1, libs.size / 10);
        }
        let dist = Infinity;
        for (const s of g.stones) dist = Math.min(dist, Math.max(Math.abs((s % n) - cx), Math.abs(Math.floor(s / n) - cy)));
        const score = status - 0.02 * Math.min(g.stones.length, 10) + (g.stones.length < 2 ? 0.5 : 0) + 0.01 * dist;
        if (!best || score < best.score) {
          const anchor = g.main[0];
          const stones = [anchor, ...g.stones.filter((s) => s !== anchor)];
          best = { stones, owner, region: [...area.points].sort((u, v) => u - v), score };
        }
      }
  }
  if (!best) return null;
  return { stones: best.stones, owner: best.owner, region: best.region };
}

/**
 * Solve the group at `target` with `toPlay` to move. `hint`: moves to try first (KataGo's
 * candidates/PV). null when the group is not enclosed in a small local area (open fights are
 * not tsumego).
 *
 * `result` is the group's fate with `toPlay` first, `ifOtherFirst` with the other side first.
 * `key` is the first move of the winning line when the side to move gets its way by moving
 * (absent when no move is needed, i.e. both orders give the same fate, when the side to move
 * cannot get its way, or when unresolved). `line` starts at `key`; when the side to move
 * cannot get its way it holds its strongest try and the refutation instead (empty for seki).
 * Lines are local points as board Locs; PASS (-1) inside a line is a move elsewhere (a ko
 * threat or tenuki). `proven` is true only when both reads behind `result` finished without
 * hitting a limit.
 */
export function solveLifeDeath(board: Board, target: Loc, toPlay: Color, opts: LifeDeathOptions = {}, hint: Loc[] = []): LifeDeathVerdict | null {
  if (target < 0 || target >= board.stones.length || !board.stones[target]) return null;
  const maxNodes = opts.maxNodes ?? DEFAULTS.maxNodes;
  const maxMs = opts.maxMs ?? DEFAULTS.maxMs;
  const area = buildArea(board, target, opts.own ?? null, opts.maxEmpty ?? DEFAULTS.maxEmpty);
  if (!area) return null;
  const group = linkedGroup(board, target);
  const anchor = group.main.includes(target) ? target : group.main[0];
  const r = new Reader(board, area, anchor, group.stones, hint);
  const owner = r.def;
  const second = other(toPlay);
  const t0 = now();

  const first = r.decide(toPlay, r.rootKo, maxNodes * FIRST_SHARE, t0 + maxMs * FIRST_SHARE);
  const lines1 = sideLines(r, toPlay, r.rootKo, first);
  const then = r.decide(second, -1, maxNodes - r.nodes, t0 + maxMs);
  const lines2 = sideLines(r, second, -1, then);

  const result = named(r, toPlay, r.rootKo, first, lines1);
  const ifOtherFirst = named(r, second, -1, then, lines2);
  const toGlob = (ps: number[]) => ps.map((p) => (p < 0 ? PASS : r.glob[p]));

  const goal = toPlay === owner ? (f: Fate) => f === 'alive' || f === 'seki' : (f: Fate) => f === 'dead';
  const same = (f: Fate, g: Fate) => (f === 'seki' ? 'alive' : f) === (g === 'seki' ? 'alive' : g);
  let key: Loc | undefined;
  let line: number[] = [];
  if (result === 'ko' || goal(result)) {
    // The side to move gets its way. A move is needed unless the other side moving first
    // changes nothing.
    if (result === 'ko' || !same(result, ifOtherFirst)) {
      line = result === 'seki' ? lines1.win.slice(0, 1) : lines1.win;
      if (line.length && line[0] >= 0) key = r.glob[line[0]];
      else line = [];
    }
  } else if (result !== 'unresolved' && result !== 'seki') {
    line = lines1.lose;
  }
  const missLine = ifOtherFirst === 'unresolved' || ifOtherFirst === 'seki' ? [] : lines2.win.length ? lines2.win : lines2.lose;
  const anchorStone = anchor;
  return {
    target: [anchorStone, ...group.stones.filter((s) => s !== anchorStone)],
    owner,
    result,
    ifOtherFirst,
    ...(key !== undefined ? { key } : {}),
    line: toGlob(line),
    missLine: toGlob(missLine),
    proven: first.proven && result !== 'unresolved',
    nodes: r.nodes,
  };
}

/**
 * The lines of one side-to-move decision: `win` when the mover gets its way (alive/seki for
 * the defender, dead for the attacker, either side in a ko), `lose` when it does not (its
 * strongest try).
 */
function sideLines(r: Reader, mover: Color, ko: number, d: Decision): { win: number[]; lose: number[] } {
  if (d.fate === 'unresolved') return { win: [], lose: [] };
  const moverWins = d.fate === 'ko' || (d.fate === 'dead') === (mover === r.att);
  if (!moverWins) return { win: [], lose: r.line(mover, d.free, ko) };
  // Prefer a defender move that lives outright over one that lives in seki.
  const pick =
    mover === r.def && d.fate === 'alive'
      ? (k: Kids, ok: number[]) => {
          const real = ok.filter((i) => k.mv[i] >= 0);
          if (real.length < 2) return -1;
          const sorted = [...real].sort((i, j) => (r.hint[k.mv[i]] < 0 ? 1e9 : r.hint[k.mv[i]]) - (r.hint[k.mv[j]] < 0 ? 1e9 : r.hint[k.mv[j]]));
          for (const i of sorted) if (!r.sekiAfter(mover, d.free, ko, [k.mv[i]])) return i;
          return -1;
        }
      : undefined;
  return { win: r.line(mover, d.free, ko, pick), lose: [] };
}

/** A decision's fate with 'alive' split into alive and seki. */
function named(r: Reader, mover: Color, ko: number, d: Decision, lines: { win: number[] }): Fate {
  if (d.fate !== 'alive') return d.fate;
  // The position where the attacker has to move after the defender's answer (or at once).
  const at = mover === r.def ? lines.win.slice(0, 1).filter((p) => p >= 0) : [];
  const moves = mover === r.def && !at.length ? [-1] : at;
  return r.sekiAfter(mover, d.free, ko, moves) ? 'seki' : 'alive';
}
