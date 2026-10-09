import type { Board } from '../go/board';
import { PASS, type Color, type Move } from '../go/types';
import type { NetEval } from './parse';

/**
 * Network-evaluation cache (KataGo calls it the NN cache), shared by every search on one
 * engine. Positions are keyed by exactly what the network sees: the stones, the side to
 * move, the ko point, the last five moves and the komi.
 *
 * The key is symmetry-aware. Each position is hashed under all 8 board symmetries and
 * stored under the smallest hash, with its policy and ownership turned into that
 * orientation. A mirrored or rotated position (common in openings, and in the tree
 * whenever two moves transpose into the same shape) then finds the stored evaluation.
 * KataGo itself evaluates each position under a random symmetry, so serving the
 * evaluation of a symmetric twin is the same thing it does, minus the network call.
 */

/** Moves of history the network sees (KataGo input version 7). */
const HISTORY = 5;

interface Entry {
  policy: Float32Array;
  bWin: number;
  bLead: number;
  ownership?: Float32Array;
  /** Stones on the board (openings are kept between visits, see exportRows). */
  stones: number;
}

/** A stored evaluation, as saved between visits. */
export interface CacheRow {
  key: string;
  policy: Float32Array;
  bWin: number;
  bLead: number;
  stones: number;
}

interface SizeTables {
  hw: number;
  /** sym[s][p]: point p under symmetry s. */
  sym: Int16Array[];
  /** Two 32-bit halves per feature. */
  stone: Uint32Array; // [color-1][p][2]
  hist: Uint32Array; // [k][p or hw for pass][2]
  ko: Uint32Array; // [p][2]
}

const tables = new Map<number, SizeTables>();

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

function tablesFor(size: number): SizeTables {
  const hit = tables.get(size);
  if (hit) return hit;
  const hw = size * size;
  const m = size - 1;
  const sym: Int16Array[] = [];
  for (let s = 0; s < 8; s++) {
    const map = new Int16Array(hw);
    for (let p = 0; p < hw; p++) {
      let x = p % size;
      let y = (p - x) / size;
      if (s & 1) x = m - x;
      if (s & 2) y = m - y;
      if (s & 4) [x, y] = [y, x];
      map[p] = y * size + x;
    }
    sym.push(map);
  }
  const r = rng(0x5eed0000 + size);
  const fill = (n: number) => {
    const a = new Uint32Array(n);
    for (let i = 0; i < n; i++) a[i] = r();
    return a;
  };
  const t = { hw, sym, stone: fill(2 * hw * 2), hist: fill(HISTORY * (hw + 1) * 2), ko: fill(hw * 2) };
  tables.set(size, t);
  return t;
}

export interface CacheKey {
  key: string;
  /** The symmetry that turns this position into its stored orientation. */
  sym: number;
  stones: number;
}

/** The cache key of a position (and which symmetry maps it to the stored orientation). */
export function positionHash(board: Board, toPlay: Color, moves: Move[], komi: number): CacheKey {
  const size = board.size;
  const t = tablesFor(size);
  const { hw, sym } = t;
  const hi = new Uint32Array(8);
  const lo = new Uint32Array(8);
  const stones = board.stones;
  let count = 0;
  for (let p = 0; p < hw; p++) {
    const c = stones[p];
    if (c !== 1 && c !== 2) continue;
    count++;
    const base = (c - 1) * hw;
    for (let s = 0; s < 8; s++) {
      const q = (base + sym[s][p]) * 2;
      hi[s] ^= t.stone[q];
      lo[s] ^= t.stone[q + 1];
    }
  }
  const n = moves.length;
  for (let k = 0; k < HISTORY && k < n; k++) {
    const mv = moves[n - 1 - k];
    // A move by the side to move (setup stones, or a pass sequence) flips the colour bit.
    const flip = mv.color === toPlay ? 0x9e3779b9 : 0;
    for (let s = 0; s < 8; s++) {
      const pt = mv.loc === PASS || mv.loc < 0 ? hw : sym[s][mv.loc];
      const q = (k * (hw + 1) + pt) * 2;
      hi[s] ^= t.hist[q] ^ flip;
      lo[s] ^= t.hist[q + 1];
    }
  }
  const ko = board.koPoint;
  if (ko !== PASS && ko >= 0) {
    for (let s = 0; s < 8; s++) {
      const q = sym[s][ko] * 2;
      hi[s] ^= t.ko[q];
      lo[s] ^= t.ko[q + 1];
    }
  }
  let best = 0;
  for (let s = 1; s < 8; s++) if (hi[s] < hi[best] || (hi[s] === hi[best] && lo[s] < lo[best])) best = s;
  // Setup stones (a handicap) change how KataGo scores the game, so they are part of the key.
  const handicap = n >= 2 && moves[0].color === 1 && moves[1].color === 1 ? 'h' : '';
  return { key: `${size}${handicap}:${komi}:${toPlay}:${hi[best].toString(36)}.${lo[best].toString(36)}`, sym: best, stones: count };
}

/** Turn a size*size(+1) array into the stored orientation (`toStored`) or back. */
function orient(src: Float32Array, size: number, s: number, toStored: boolean): Float32Array {
  if (s === 0) return src;
  const map = tablesFor(size).sym[s];
  const hw = size * size;
  const out = new Float32Array(src.length);
  for (let p = 0; p < hw; p++) {
    if (toStored) out[map[p]] = src[p];
    else out[p] = src[map[p]];
  }
  if (src.length > hw) out[hw] = src[hw];
  return out;
}

export interface CacheStats {
  hits: number;
  symmetryHits: number;
  misses: number;
  entries: number;
  /** Approximate memory held, in bytes. */
  bytes: number;
}

export class NNCache {
  private map = new Map<string, Entry>();
  private bytes = 0;
  hits = 0;
  symmetryHits = 0;
  misses = 0;

  /** `maxBytes` bounds the memory held (oldest entries go first). */
  constructor(readonly maxBytes = 48 * 1024 * 1024) {}

  get(k: CacheKey, size: number, ownership: boolean): NetEval | null {
    const e = this.map.get(k.key);
    if (!e || (ownership && !e.ownership)) {
      this.misses++;
      return null;
    }
    // Most recently used goes last.
    this.map.delete(k.key);
    this.map.set(k.key, e);
    this.hits++;
    if (k.sym !== 0) this.symmetryHits++;
    return {
      policy: orient(e.policy, size, k.sym, false),
      bWin: e.bWin,
      bLead: e.bLead,
      ownership: e.ownership ? orient(e.ownership, size, k.sym, false) : undefined,
    };
  }

  put(k: CacheKey, size: number, ev: NetEval) {
    const old = this.map.get(k.key);
    if (old) {
      if (old.ownership || !ev.ownership) return;
      this.map.delete(k.key);
      this.bytes -= entryBytes(old);
    }
    const e: Entry = {
      policy: orient(ev.policy, size, k.sym, true),
      bWin: ev.bWin,
      bLead: ev.bLead,
      ownership: ev.ownership ? orient(ev.ownership, size, k.sym, true) : undefined,
      stones: k.stones,
    };
    // The stored copy must not share memory with what the caller keeps.
    if (e.policy === ev.policy) e.policy = ev.policy.slice();
    if (e.ownership && e.ownership === ev.ownership) e.ownership = ev.ownership.slice();
    this.map.set(k.key, e);
    this.bytes += entryBytes(e);
    while (this.bytes > this.maxBytes && this.map.size > 1) {
      const [oldest, v] = this.map.entries().next().value as [string, Entry];
      this.map.delete(oldest);
      this.bytes -= entryBytes(v);
    }
  }

  /**
   * The most recently used evaluations of positions with at most `maxStones` stones
   * (openings recur from game to game), without ownership, for saving between visits.
   */
  exportRows(maxStones: number, limit: number): CacheRow[] {
    const out: CacheRow[] = [];
    const all = [...this.map.entries()];
    for (let i = all.length - 1; i >= 0 && out.length < limit; i--) {
      const [key, e] = all[i];
      if (e.stones <= maxStones) out.push({ key, policy: e.policy, bWin: e.bWin, bLead: e.bLead, stones: e.stones });
    }
    return out;
  }

  /** Add saved evaluations (older than anything already here). */
  importRows(rows: CacheRow[]) {
    const current = [...this.map.entries()];
    this.map.clear();
    this.bytes = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (!(r.policy instanceof Float32Array)) continue;
      const e: Entry = { policy: r.policy, bWin: r.bWin, bLead: r.bLead, stones: r.stones };
      this.map.set(r.key, e);
      this.bytes += entryBytes(e);
    }
    for (const [k, e] of current) {
      this.map.delete(k);
      this.map.set(k, e);
      this.bytes += entryBytes(e);
    }
  }

  clear() {
    this.map.clear();
    this.bytes = 0;
  }

  stats(): CacheStats {
    return { hits: this.hits, symmetryHits: this.symmetryHits, misses: this.misses, entries: this.map.size, bytes: this.bytes };
  }
}

const entryBytes = (e: Entry) => 64 + e.policy.byteLength + (e.ownership?.byteLength ?? 0);
