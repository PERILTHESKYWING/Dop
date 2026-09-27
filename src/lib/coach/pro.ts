import type { Color, Loc } from '../go/types';
import { hashString } from '../util/hash';

/**
 * Pro game explorer: how often professionals reached a whole-board position (in any of its
 * eight rotations and reflections) and what they played there. Built from the professional
 * collection of github.com/yenw/computer-go-dataset (73,522 games, 1940 to early 2017) by
 * scripts/pro-openings.ts; only counts are shipped.
 */

/** Transform `s` (0..7) of point (x, y) on a board of `size`. */
function tf(s: number, x: number, y: number, size: number): [number, number] {
  const m = size - 1;
  const [a, b] = s & 4 ? [y, x] : [x, y];
  return [s & 1 ? m - a : a, s & 2 ? m - b : b];
}

export function transformLoc(s: number, loc: Loc, size: number): Loc {
  if (loc < 0) return loc;
  const [x, y] = tf(s, loc % size, Math.floor(loc / size), size);
  return y * size + x;
}

/** The transform that undoes `s`. */
export function inverseSym(s: number, size: number): number {
  for (let t = 0; t < 8; t++) if (transformLoc(t, transformLoc(s, 1 + 2 * size, size), size) === 1 + 2 * size) return t;
  return 0;
}

export interface CanonicalPosition {
  key: string;
  /** Transforms taking this position to the canonical one (more than one if it is symmetric). */
  syms: number[];
}

/** A position's key, the same for all eight orientations of it. */
export function canonicalPosition(stones: ArrayLike<number>, toPlay: Color, size: number): CanonicalPosition {
  let best = '';
  let syms: number[] = [];
  const n = size * size;
  for (let s = 0; s < 8; s++) {
    const t = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) if (stones[i]) t[transformLoc(s, i, size)] = stones[i];
    const key = hashString(`${size}|${toPlay}|${t.join('')}`).slice(0, 12);
    if (!syms.length || key < best) {
      best = key;
      syms = [s];
    } else if (key === best) syms.push(s);
  }
  return { key: best, syms };
}

/** A move in the canonical frame; in a symmetric position, equivalent moves become one. */
export function canonicalMove(c: CanonicalPosition, loc: Loc, size: number): Loc {
  return Math.min(...c.syms.map((s) => transformLoc(s, loc, size)));
}

export interface ProExplorer {
  version: 1;
  source: string;
  games: number;
  maxMove: number;
  /** Per position: times reached, and per move [canonical move, times played, games the mover went on to win]. */
  positions: Record<string, { n: number; m: [Loc, number, number][] }>;
}

export interface ProMove {
  loc: Loc;
  count: number;
  /** Share of those games the player who played it won. */
  winRate: number;
}

export interface ProStats {
  /** Pro games that reached this position. */
  games: number;
  moves: ProMove[];
}

/**
 * What pros played in this position, in the position's own orientation. In a symmetric
 * position a move has several equivalent points; `prefer` (e.g. the move played) is used
 * when it is one of them.
 */
export function proStats(ex: ProExplorer, stones: ArrayLike<number>, toPlay: Color, size: number, prefer?: Loc): ProStats | null {
  if (size !== 19) return null;
  const c = canonicalPosition(stones, toPlay, size);
  const row = ex.positions[c.key];
  if (!row) return null;
  const backs = c.syms.map((s) => inverseSym(s, size));
  const moves = row.m.map(([loc, count, wins]) => {
    const pts = backs.map((b) => transformLoc(b, loc, size));
    return { loc: prefer !== undefined && pts.includes(prefer) ? prefer : pts[0], count, winRate: count ? wins / count : 0 };
  });
  return { games: row.n, moves };
}
