import { Board } from '../go/board';
import { locToSgf, sgfToLoc, toLoc, xy } from '../go/coords';
import { type Color, type Loc, other } from '../go/types';

/**
 * Turning a fight from a real game into a local life-and-death problem.
 *
 * The group at stake and the stones around it are cut out (a window reaching the board's
 * edge), and the rest of the board is filled with a tsumego frame: a solid wall of the
 * attacker's stones around the window, the attacker's area behind it, then the defender's
 * area, each one chain with plenty of eyes. The frame is settled, so the only thing left to
 * play for is the problem; the komi is then set so that the right answer leaves the game
 * even (see scripts/problem-bank.ts), which makes KataGo read the problem as a close game.
 */

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const rectWidth = (r: Rect) => r.x1 - r.x0 + 1;
export const rectHeight = (r: Rect) => r.y1 - r.y0 + 1;
export const inRect = (r: Rect, x: number, y: number) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

/** Largest problem window side. */
export const MAX_WINDOW = 10;
/** Most of a window that may be covered by stones: denser windows read as a slice of a game, not a problem. */
export const MAX_DENSITY = 0.55;
/** Space kept around the group inside the window. */
export const WINDOW_MARGIN = 2;
/** A window this close to an edge is extended to it. */
export const EDGE_SNAP = 3;

/**
 * The window for a group: its bounding box plus a margin, extended to any edge it comes
 * close to. Null for groups that do not reach near an edge (center fights are not local
 * problems) or that need a window larger than MAX_WINDOW.
 */
export function problemWindow(size: number, stones: readonly Loc[], margin = WINDOW_MARGIN): Rect | null {
  if (!stones.length) return null;
  let x0 = size, y0 = size, x1 = -1, y1 = -1;
  for (const s of stones) {
    const [x, y] = xy(s, size);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  x0 -= margin;
  y0 -= margin;
  x1 += margin;
  y1 += margin;
  if (x0 <= EDGE_SNAP) x0 = 0;
  if (y0 <= EDGE_SNAP) y0 = 0;
  if (x1 >= size - 1 - EDGE_SNAP) x1 = size - 1;
  if (y1 >= size - 1 - EDGE_SNAP) y1 = size - 1;
  const r = { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(size - 1, x1), y1: Math.min(size - 1, y1) };
  const edges = (r.x0 === 0 ? 1 : 0) + (r.y0 === 0 ? 1 : 0) + (r.x1 === size - 1 ? 1 : 0) + (r.y1 === size - 1 ? 1 : 0);
  if (edges === 0 || edges > 2) return null;
  // Two opposite edges would split the frame in two.
  if ((r.x0 === 0 && r.x1 === size - 1) || (r.y0 === 0 && r.y1 === size - 1)) return null;
  if (rectWidth(r) > MAX_WINDOW || rectHeight(r) > MAX_WINDOW) return null;
  return r;
}

/**
 * Groups as a player sees them: chains of one colour joined when they touch diagonally or
 * stand one point apart on a line with that point empty (hard to cut in a fight).
 */
export function looseGroups(board: Board): { color: Color; stones: Loc[] }[] {
  const n = board.size;
  const chains = board.groups();
  const chainOf = new Int32Array(n * n).fill(-1);
  chains.forEach((g, i) => g.stones.forEach((s) => (chainOf[s] = i)));
  const parent = chains.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a: number, b: number) => {
    const x = find(a), y = find(b);
    if (x !== y) parent[x] = y;
  };
  for (let l = 0; l < n * n; l++) {
    const c = board.stones[l];
    if (!c) continue;
    const [x, y] = xy(l, n);
    const link = (dx: number, dy: number, mid?: [number, number]) => {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) return;
      const q = toLoc(nx, ny, n);
      if (board.stones[q] !== c) return;
      if (mid && board.stones[toLoc(x + mid[0], y + mid[1], n)] !== 0) return;
      join(chainOf[l], chainOf[q]);
    };
    link(1, 1);
    link(1, -1);
    link(2, 0, [1, 0]);
    link(0, 2, [0, 1]);
  }
  const out = new Map<number, { color: Color; stones: Loc[] }>();
  chains.forEach((g, i) => {
    const r = find(i);
    const e = out.get(r) ?? { color: g.color, stones: [] };
    e.stones.push(...g.stones);
    out.set(r, e);
  });
  return [...out.values()];
}

/**
 * The window for a life-and-death problem: the group with room around it, and the
 * opponent's stones that surround it.
 */
export function lifeWindow(board: Board, group: readonly Loc[]): Rect | null {
  const n = board.size;
  const color = board.stones[group[0]];
  const inGroup = new Set(group);
  const near: Loc[] = [...group];
  for (let l = 0; l < n * n; l++) {
    if (!board.stones[l] || board.stones[l] === color || inGroup.has(l)) continue;
    const [x, y] = xy(l, n);
    if (group.some((g) => {
      const [gx, gy] = xy(g, n);
      return Math.max(Math.abs(gx - x), Math.abs(gy - y)) <= 2;
    })) near.push(l);
  }
  const a = problemWindow(n, group, WINDOW_MARGIN);
  const b = problemWindow(n, near, 1);
  if (!a || !b) return null;
  const r = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
  if (rectWidth(r) > MAX_WINDOW || rectHeight(r) > MAX_WINDOW) return null;
  if ((r.x0 === 0 && r.x1 === n - 1) || (r.y0 === 0 && r.y1 === n - 1)) return null;
  // Problems are shown at least 6 by 6, so the shape has room around it.
  if (rectWidth(r) < 6 || rectHeight(r) < 6) {
    const grow = (lo: number, hi: number): [number, number] => {
      while (hi - lo + 1 < 6) {
        if (lo > 0 && (hi === n - 1 || lo > n - 1 - hi)) lo--;
        else hi++;
      }
      return [lo, hi];
    };
    [r.x0, r.x1] = r.x0 === 0 ? [0, Math.max(r.x1, 5)] : r.x1 === n - 1 ? [Math.min(r.x0, n - 6), n - 1] : grow(r.x0, r.x1);
    [r.y0, r.y1] = r.y0 === 0 ? [0, Math.max(r.y1, 5)] : r.y1 === n - 1 ? [Math.min(r.y0, n - 6), n - 1] : grow(r.y0, r.y1);
  }
  return r;
}

/** Does the window look like a problem (not too crowded, not too large)? */
export function shapeOk(stones: ArrayLike<number>, size: number, r: Rect): boolean {
  if (rectWidth(r) > MAX_WINDOW || rectHeight(r) > MAX_WINDOW) return false;
  let n = 0;
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (stones[toLoc(x, y, size)]) n++;
  return n <= MAX_DENSITY * rectWidth(r) * rectHeight(r);
}

/** Chebyshev distance from a point to the window (0 inside). */
export function distToRect(r: Rect, x: number, y: number): number {
  const dx = x < r.x0 ? r.x0 - x : x > r.x1 ? x - r.x1 : 0;
  const dy = y < r.y0 ? r.y0 - y : y > r.y1 ? y - r.y1 : 0;
  return Math.max(dx, dy);
}

/**
 * The window's stones inside a frame. `attacker` surrounds the window. Returns null when
 * the frame would not give both sides a living area (a window too large for the board).
 */
export function framePosition(stones: ArrayLike<number>, size: number, r: Rect, attacker: Color): Int8Array | null {
  const out = new Int8Array(size * size);
  const d = new Int8Array(size * size);
  let maxD = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const l = toLoc(x, y, size);
      d[l] = distToRect(r, x, y);
      maxD = Math.max(maxD, d[l]);
      if (d[l] === 0) out[l] = stones[l];
    }
  // The attacker's band (distance 1..t) against the defender's area beyond, split about evenly.
  const outside = size * size - rectWidth(r) * rectHeight(r);
  let t = 1;
  for (; t < maxD; t++) {
    let band = 0;
    for (let l = 0; l < size * size; l++) if (d[l] >= 1 && d[l] <= t) band++;
    if (band * 2 >= outside) break;
  }
  if (t >= maxD) return null;
  const defender = other(attacker);
  for (let l = 0; l < size * size; l++) if (d[l] >= 1) out[l] = d[l] <= t ? attacker : defender;
  // Eyes: single empty points on a lattice, each surrounded by its own colour only. The wall
  // facing the window (distance 1 and 2) stays solid.
  const eyes = [0, 0, 0];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const l = toLoc(x, y, size);
      if (d[l] < 3 || x % 3 !== 1 || y % 3 !== 1) continue;
      const c = out[l];
      let solid = true;
      for (let dy = -1; dy <= 1 && solid; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const n = toLoc(nx, ny, size);
          if (d[n] === 0 || out[n] !== c) {
            solid = false;
            break;
          }
        }
      if (!solid) continue;
      out[l] = 0;
      eyes[c]++;
    }
  if (eyes[attacker] < 2 || eyes[defender] < 2) return null;
  return out;
}

export const encodeStones = (stones: ArrayLike<number>, size: number, color: Color) => {
  let s = '';
  for (let l = 0; l < stones.length; l++) if (stones[l] === color) s += locToSgf(l, size);
  return s;
};

export function decodeStones(b: string, w: string, size: number): Int8Array {
  const out = new Int8Array(size * size);
  for (let i = 0; i + 1 < b.length; i += 2) out[sgfToLoc(b.slice(i, i + 2), size)] = 1;
  for (let i = 0; i + 1 < w.length; i += 2) out[sgfToLoc(w.slice(i, i + 2), size)] = 2;
  return out;
}

export const decodeLocs = (s: string, size: number): Loc[] => {
  const out: Loc[] = [];
  for (let i = 0; i + 1 < s.length; i += 2) out.push(sgfToLoc(s.slice(i, i + 2), size));
  return out;
};

/**
 * A key that is the same for a position and its mirror images and rotations, and for the
 * colour-swapped position with the other side to move (stones are labelled as the mover's
 * or the opponent's), so the bank never holds one problem twice.
 */
export function canonicalKey(stones: ArrayLike<number>, size: number, toPlay: Color, r?: Rect): string {
  const keys: string[] = [];
  const x0 = r?.x0 ?? 0, y0 = r?.y0 ?? 0, x1 = r?.x1 ?? size - 1, y1 = r?.y1 ?? size - 1;
  for (let sym = 0; sym < 8; sym++) {
    const pts: string[] = [];
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const c = stones[toLoc(x, y, size)];
        if (!c) continue;
        let [a, b] = [x, y];
        if (sym & 1) a = size - 1 - a;
        if (sym & 2) b = size - 1 - b;
        if (sym & 4) [a, b] = [b, a];
        pts.push(`${c === toPlay ? 'x' : 'o'}${a.toString(36)}${b.toString(36)}`);
      }
    keys.push(pts.sort().join(''));
  }
  keys.sort();
  return keys[0];
}

/** Techniques visible in a line of play (for tags and the writer's facts). */
export function lineTags(start: Board, first: Color, line: readonly Loc[], firstLine = true): string[] {
  const tags = new Set<string>();
  const b = start.clone();
  let c = first;
  line.forEach((loc, i) => {
    if (loc < 0 || !b.isLegal(loc, c)) return;
    const mine = i % 2 === 0;
    const before = b.clone();
    const res = b.play(loc, c);
    const g = b.groupAt(loc);
    if (mine) {
      if (res.captured.length) tags.add('capture');
      if (g && g.liberties.length === 1) {
        // A stone put where it can be taken at once: a throw-in or a sacrifice.
        const next = line[i + 1];
        tags.add(g.stones.length === 1 && next !== undefined && g.liberties[0] === next ? 'throw-in' : 'sacrifice');
      }
      for (const q of b.neighbors(loc)) {
        const og = b.stones[q] === other(c) ? b.groupAt(q) : null;
        if (og && og.liberties.length === 1) tags.add('atari');
      }
      const [x, y] = xy(loc, b.size);
      if (firstLine && Math.min(x, y, b.size - 1 - x, b.size - 1 - y) === 0 && i === 0) tags.add('first-line');
      // Placement: a first move inside the opponent's shape, touching only their stones.
      if (i === 0) {
        const n = before.neighbors(loc).map((q) => before.stones[q]);
        if (n.some((v) => v === other(c)) && !n.some((v) => v === c)) tags.add('placement');
      }
    } else if (res.captured.length === 1 && i >= 1) {
      // The opponent takes one stone and is captured right back: a snapback.
      const next = line[i + 1];
      if (next !== undefined && next === res.captured[0]) {
        const after = b.clone();
        if (after.isLegal(next, other(c))) {
          const r2 = after.play(next, other(c));
          if (r2.captured.length >= 2) tags.add('snapback');
        }
      }
    }
    c = other(c);
  });
  return [...tags];
}
