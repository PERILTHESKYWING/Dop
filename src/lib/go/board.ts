import { PASS, type Color, type Loc, type Move, other } from './types';

export interface Group {
  color: Color;
  stones: Loc[];
  liberties: Loc[];
}

export interface PlayResult {
  captured: Loc[];
}

/**
 * Minimal Go rules: placement, captures, suicide and simple ko. Used for replaying
 * games, feature extraction and legality checks. The engine (KataGo) is the authority
 * on evaluation; this is only the bookkeeping.
 */
export class Board {
  readonly size: number;
  stones: Int8Array;
  /** Point that is illegal for the side to move because of simple ko, or PASS. */
  koPoint: Loc = PASS;
  captures: [number, number, number] = [0, 0, 0];

  constructor(size = 19, stones?: Int8Array) {
    this.size = size;
    this.stones = stones ? new Int8Array(stones) : new Int8Array(size * size);
  }

  clone(): Board {
    const b = new Board(this.size, this.stones);
    b.koPoint = this.koPoint;
    b.captures = [...this.captures] as [number, number, number];
    return b;
  }

  get(loc: Loc): number {
    return this.stones[loc];
  }

  neighbors(loc: Loc): Loc[] {
    const n = this.size;
    const x = loc % n;
    const y = (loc - x) / n;
    const out: Loc[] = [];
    if (x > 0) out.push(loc - 1);
    if (x < n - 1) out.push(loc + 1);
    if (y > 0) out.push(loc - n);
    if (y < n - 1) out.push(loc + n);
    return out;
  }

  /** Flood-fill the chain at loc. Returns null on an empty point. */
  groupAt(loc: Loc): Group | null {
    const color = this.stones[loc];
    if (color === 0) return null;
    const seen = new Uint8Array(this.stones.length);
    const stones: Loc[] = [];
    const libs = new Set<Loc>();
    const stack = [loc];
    seen[loc] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      stones.push(p);
      for (const q of this.neighbors(p)) {
        const c = this.stones[q];
        if (c === 0) libs.add(q);
        else if (c === color && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    return { color: color as Color, stones, liberties: [...libs] };
  }

  /** All chains on the board. */
  groups(): Group[] {
    const seen = new Uint8Array(this.stones.length);
    const out: Group[] = [];
    for (let i = 0; i < this.stones.length; i++) {
      if (this.stones[i] === 0 || seen[i]) continue;
      const g = this.groupAt(i)!;
      for (const s of g.stones) seen[s] = 1;
      out.push(g);
    }
    return out;
  }

  libertyCount(loc: Loc): number {
    const g = this.groupAt(loc);
    return g ? g.liberties.length : 0;
  }

  isLegal(loc: Loc, color: Color): boolean {
    if (loc === PASS) return true;
    if (loc < 0 || loc >= this.stones.length) return false;
    if (this.stones[loc] !== 0) return false;
    if (loc === this.koPoint) return false;
    // Legal if it has a liberty, captures something, or connects to a group with spare liberties.
    for (const q of this.neighbors(loc)) {
      const c = this.stones[q];
      if (c === 0) return true;
      const libs = this.groupAt(q)!.liberties.length;
      if (c === color && libs > 1) return true;
      if (c !== color && libs === 1) return true;
    }
    return false;
  }

  /**
   * Legal points for `color` (1 = legal), computed with one pass over the chains
   * instead of a flood fill per point. Same rules as isLegal.
   */
  legalMask(color: Color): Uint8Array {
    const n = this.stones.length;
    const chain = new Int32Array(n).fill(-1);
    const libs: number[] = [];
    const stamp = new Int32Array(n).fill(-1);
    const stack: number[] = [];
    for (let i = 0; i < n; i++) {
      const c = this.stones[i];
      if (c === 0 || chain[i] >= 0) continue;
      const id = libs.length;
      let count = 0;
      chain[i] = id;
      stack.push(i);
      while (stack.length) {
        const p = stack.pop()!;
        for (const q of this.neighbors(p)) {
          const v = this.stones[q];
          if (v === 0) {
            if (stamp[q] !== id) {
              stamp[q] = id;
              count++;
            }
          } else if (v === c && chain[q] < 0) {
            chain[q] = id;
            stack.push(q);
          }
        }
      }
      libs.push(count);
    }
    const out = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      if (this.stones[p] !== 0 || p === this.koPoint) continue;
      for (const q of this.neighbors(p)) {
        const v = this.stones[q];
        if (v === 0 || (v === color ? libs[chain[q]] > 1 : libs[chain[q]] === 1)) {
          out[p] = 1;
          break;
        }
      }
    }
    return out;
  }

  /** Play a move. Throws on an illegal move unless `force` is set (SGFs can contain odd moves). */
  play(loc: Loc, color: Color, force = false): PlayResult {
    if (loc === PASS) {
      this.koPoint = PASS;
      return { captured: [] };
    }
    if (!force && !this.isLegal(loc, color)) {
      throw new Error(`illegal move at ${loc}`);
    }
    this.stones[loc] = color;
    const opp = other(color);
    const captured: Loc[] = [];
    for (const q of this.neighbors(loc)) {
      if (this.stones[q] !== opp) continue;
      const g = this.groupAt(q)!;
      if (g.liberties.length === 0) {
        for (const s of g.stones) {
          this.stones[s] = 0;
          captured.push(s);
        }
      }
    }
    const own = this.groupAt(loc)!;
    if (own.liberties.length === 0) {
      // Suicide (only reachable with force): remove own group, as Tromp-Taylor does.
      for (const s of own.stones) this.stones[s] = 0;
      this.captures[opp] += own.stones.length;
    }
    this.captures[color] += captured.length;
    // Simple ko: single stone captured by a single stone that now has one liberty.
    this.koPoint =
      captured.length === 1 && own.stones.length === 1 && own.liberties.length === 1 ? captured[0] : PASS;
    return { captured };
  }

  /** Stone counts [empty, black, white]. */
  counts(): [number, number, number] {
    const c: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < this.stones.length; i++) c[this.stones[i]]++;
    return c;
  }
}

/** Replay setup stones and moves; returns the board after `upTo` moves (default: all). */
export function replay(size: number, setup: Move[], moves: Move[], upTo = moves.length): Board {
  const b = new Board(size);
  for (const s of setup) if (s.loc !== PASS) b.stones[s.loc] = s.color;
  for (let i = 0; i < upTo && i < moves.length; i++) b.play(moves[i].loc, moves[i].color, true);
  return b;
}

/**
 * Walk a game once, yielding the board BEFORE each move (index i = position before move i),
 * plus the final position at index moves.length. Boards are cloned so they can be kept.
 */
export function allPositions(size: number, setup: Move[], moves: Move[]): Board[] {
  const b = new Board(size);
  for (const s of setup) if (s.loc !== PASS) b.stones[s.loc] = s.color;
  const out: Board[] = [b.clone()];
  for (const m of moves) {
    b.play(m.loc, m.color, true);
    out.push(b.clone());
  }
  return out;
}
