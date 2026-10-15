/**
 * Small board helpers for the explainer: positions after a line, loose groups, the 9 board
 * regions, and number formatting shared by thoughts, facts and notes (so the same read
 * value is always written the same way).
 */
import { Board, replay } from '../../go/board';
import { locToGtp, xy, zoneOf } from '../../go/coords';
import { other, PASS, type Color, type Loc, type Move } from '../../go/types';
import type { ExplainPosition } from './types';

/** Region names for zoneOf's 3x3 grid, row-major from the top left. */
export const ZONE_NAMES = ['upper left', 'top', 'upper right', 'left side', 'center', 'right side', 'lower left', 'bottom', 'lower right'] as const;

export const coord = (loc: Loc, size: number) => (loc === PASS || loc < 0 ? 'pass' : locToGtp(loc, size));
export const colorWord = (c: Color) => (c === 1 ? 'Black' : 'White');
export const colorAdj = (c: Color) => (c === 1 ? 'black' : 'white');

/** A value for one side from Black's lead / winrate. */
export const sideLead = (bLead: number, c: Color) => (c === 1 ? bLead : -bLead);
export const sideWin = (bWin: number, c: Color) => (c === 1 ? bWin : 1 - bWin);

/** One decimal, never "-0". */
export function fmt1(x: number): string {
  const r = Math.round(x * 10) / 10;
  return (r === 0 ? 0 : r).toFixed(1);
}
export const pct = (x: number) => `${Math.round(x * 100)}%`;

/** "Black leads by 2.3" / "White leads by 1.1" / "the game is even" from Black's lead. */
export function leadPhrase(bLead: number): string {
  const r = Math.round(bLead * 10) / 10;
  if (r === 0) return 'the game is even';
  return r > 0 ? `Black leads by ${fmt1(r)}` : `White leads by ${fmt1(-r)}`;
}

/** Moves for a line of points played alternately, starting with `first`. */
export function lineMoves(first: Color, locs: readonly Loc[]): Move[] {
  let c = first;
  return locs.map((loc) => {
    const m = { color: c, loc };
    c = other(c);
    return m;
  });
}

/** The position after `locs` are played from `pos` (alternating, side to move first). */
export function afterMoves(pos: ExplainPosition, locs: readonly Loc[]): ExplainPosition {
  const added = lineMoves(pos.toPlay, locs);
  return {
    size: pos.size,
    komi: pos.komi,
    setup: pos.setup,
    moves: [...pos.moves, ...added],
    toPlay: locs.length % 2 ? other(pos.toPlay) : pos.toPlay,
  };
}

export const boardOf = (pos: ExplainPosition): Board => replay(pos.size, pos.setup, pos.moves);

/**
 * How many moves of a principal variation to trust, from the visits of its first move: the
 * search's visits thin out along the line (roughly 0.6 of a node's visits go to its best
 * child), and past a handful of visits a move is a guess. Measured PVs at 64–400 visits ran
 * 9–17 moves; this keeps 5–9 of them.
 */
export function trustedLen(visits: number): number {
  if (visits < 4) return 1;
  return Math.max(2, Math.min(12, Math.round(2 * Math.log(visits / 4))));
}

/** Points of each of the 9 regions. */
export function zonePoints(size: number): Loc[][] {
  const out: Loc[][] = Array.from({ length: 9 }, () => []);
  for (let i = 0; i < size * size; i++) out[zoneOf(i, size)].push(i);
  return out;
}

export const zoneName = (z: number) => ZONE_NAMES[z] ?? 'board';

/** Region name of a set of points (by their middle). */
export function regionOfPoints(points: readonly Loc[], size: number): string {
  if (!points.length) return 'board';
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    const [x, y] = xy(p, size);
    sx += x;
    sy += y;
  }
  const cx = Math.round(sx / points.length);
  const cy = Math.round(sy / points.length);
  return zoneName(zoneOf(cy * size + cx, size));
}

/** A group as players mean it: chains joined by diagonals and one-point jumps nobody can cut at once. */
export interface StoneGroup {
  color: Color;
  stones: Loc[];
}

export function looseGroups(board: Board): StoneGroup[] {
  const n = board.size;
  const hw = n * n;
  const parent = new Int32Array(hw);
  for (let i = 0; i < hw; i++) parent[i] = i;
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const join = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const s = board.stones;
  for (let i = 0; i < hw; i++) {
    const c = s[i];
    if (!c) continue;
    const opp = other(c as Color);
    const [x, y] = xy(i, n);
    // Solid connections.
    if (x + 1 < n && s[i + 1] === c) join(i, i + 1);
    if (y + 1 < n && s[i + n] === c) join(i, i + n);
    // Diagonals, unless both shared points are the opponent's (already cut).
    for (const dx of [-1, 1]) {
      const xx = x + dx;
      const yy = y + 1;
      if (xx < 0 || xx >= n || yy >= n) continue;
      const j = yy * n + xx;
      if (s[j] !== c) continue;
      if (s[y * n + xx] === opp && s[yy * n + x] === opp) continue;
      join(i, j);
    }
    // One-point jumps with an empty middle.
    if (x + 2 < n && s[i + 2] === c && s[i + 1] === 0) join(i, i + 2);
    if (y + 2 < n && s[i + 2 * n] === c && s[i + n] === 0) join(i, i + 2 * n);
  }
  const groups = new Map<number, StoneGroup>();
  for (let i = 0; i < hw; i++) {
    if (!s[i]) continue;
    const r = find(i);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = { color: s[i] as Color, stones: [] }));
    g.stones.push(i);
  }
  return [...groups.values()];
}

/** Average ownership of a group for its own colour (1 = surely its owner's, -1 = surely captured). */
export function groupOwn(g: StoneGroup, own: Float32Array): number {
  const sign = g.color === 1 ? 1 : -1;
  let sum = 0;
  for (const p of g.stones) sum += own[p] * sign;
  return sum / g.stones.length;
}

/** The stone of a group nearest its middle, to name it ("the white group at R12"). */
export function groupAnchor(g: StoneGroup, size: number): Loc {
  let sx = 0;
  let sy = 0;
  for (const p of g.stones) {
    const [x, y] = xy(p, size);
    sx += x;
    sy += y;
  }
  sx /= g.stones.length;
  sy /= g.stones.length;
  let best = g.stones[0];
  let bd = Infinity;
  for (const p of g.stones) {
    const [x, y] = xy(p, size);
    const d = (x - sx) ** 2 + (y - sy) ** 2;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

/** Whether any stone lies within `r` (Chebyshev) of loc. */
export function stonesNear(board: Board, loc: Loc, r: number): boolean {
  if (loc === PASS || loc < 0) return false;
  const n = board.size;
  const [x0, y0] = xy(loc, n);
  for (let y = Math.max(0, y0 - r); y <= Math.min(n - 1, y0 + r); y++)
    for (let x = Math.max(0, x0 - r); x <= Math.min(n - 1, x0 + r); x++) if ((x !== x0 || y !== y0) && board.stones[y * n + x]) return true;
  return false;
}
