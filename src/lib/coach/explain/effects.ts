/**
 * What a move does, in Go words, from two of KataGo's ownership maps: the board after the
 * move and the board after something else (the opponent moving there first, or another
 * move). Both maps must have the same side to move, so the difference is the move itself:
 * the territory it takes, the framework it builds or trims, the groups it presses or saves.
 * And the whole-board picture for "explain this position": whose areas are sure, whose are
 * frameworks, which groups are weak. Words only come from these maps; nothing is guessed.
 */
import { chebyshev, lineOf, xy, zoneOf } from '../../go/coords';
import { PASS, type Color, type Loc } from '../../go/types';
import type { Board } from '../../go/board';
import { groupAnchor, groupOwn, looseGroups, zoneName, type StoneGroup } from './geometry';

/** Ownership (for one side) from which a point counts as theirs for sure, and as leaning theirs. */
export const SURE = 0.6;
export const LEAN = 0.2;
/** Summed ownership change in a region that counts as a purpose of the move. */
export const EFFECT_PTS = 2.5;
/** Average ownership change of a group that counts as pressing or saving it. */
export const GROUP_SHIFT = 0.15;

export type Purpose =
  /** Area near the edge gained (lines 1-4); `from` when it was leaning the opponent's before. */
  | { kind: 'territory'; region: string; amount: number; from: boolean }
  /** Potential toward the open board gained (line 5 and up): a framework (moyo) or influence. */
  | { kind: 'framework'; region: string; amount: number }
  /** The opponent's potential trimmed, away from the edge or without taking it over. */
  | { kind: 'reduce'; region: string; amount: number }
  /** An opponent group made weaker. */
  | { kind: 'press'; at: Loc; stones: number; amount: number }
  /** One of the mover's groups made safer (or saved). */
  | { kind: 'secure'; at: Loc; stones: number; amount: number; saved: boolean };

const s = (c: Color) => (c === 1 ? 1 : -1);

/** Corner regions of the 9 (zoneOf's 3x3 grid). */
export const CORNER_ZONES = new Set([0, 2, 6, 8]);

/**
 * The purposes of `move` for `mover`: `ownAfter` is the board after the move, `ownRef` the
 * board after the alternative (both with the same side to move). Biggest first. Opening
 * ownership is soft (0.1-0.4), so areas count by how much they moved, not by being sure.
 */
export function purposes(board: Board, move: Loc, mover: Color, ownAfter: Float32Array, ownRef: Float32Array, groups: StoneGroup[] = looseGroups(board)): Purpose[] {
  const n = board.size;
  const sign = s(mover);
  const scale = Math.max(0.35, (n * n) / 361);
  const terr = new Array(9).fill(0);
  const from = new Array(9).fill(0);
  const frame = new Array(9).fill(0);
  const reduce = new Array(9).fill(0);
  for (let p = 0; p < n * n; p++) {
    if (board.stones[p] || p === move) continue;
    const a = sign * ownAfter[p];
    const r = sign * ownRef[p];
    const d = a - r;
    if (d <= 0.05) continue;
    const z = zoneOf(p, n);
    const edge = lineOf(p, n) <= 4;
    if (r < -0.1) {
      // It was leaning the opponent's: taken over when it now leans the mover's, else trimmed.
      if (a > 0.1 && edge) {
        terr[z] += d;
        from[z] += d;
      } else reduce[z] += Math.min(d, -r);
    } else if (a > 0.1) {
      if (edge) terr[z] += d;
      else frame[z] += d;
    }
  }
  const out: Purpose[] = [];
  const top = (arr: number[]) => {
    let z = 0;
    for (let i = 1; i < 9; i++) if (arr[i] > arr[z]) z = i;
    return z;
  };
  const min = EFFECT_PTS * scale;
  const zt = top(terr);
  if (terr[zt] >= min) out.push({ kind: 'territory', region: zoneName(zt), amount: terr[zt], from: from[zt] >= 0.5 * terr[zt] });
  const zf = top(frame);
  if (frame[zf] >= min + scale) out.push({ kind: 'framework', region: zoneName(zf), amount: frame[zf] });
  const zr = top(reduce);
  if (reduce[zr] >= min && !(zr === zt && terr[zt] >= min)) out.push({ kind: 'reduce', region: zoneName(zr), amount: reduce[zr] });
  for (const g of groups) {
    if (move === PASS || !g.stones.some((q) => chebyshev(q, move, n) <= 3)) continue;
    const a = groupOwn(g, ownAfter);
    const r = groupOwn(g, ownRef);
    if (g.color === mover) {
      if (a - r >= GROUP_SHIFT && r <= 0.75) out.push({ kind: 'secure', at: groupAnchor(g, n), stones: g.stones.length, amount: a - r, saved: r <= -0.3 && a >= 0.3 });
    } else if (r - a >= GROUP_SHIFT && a <= 0.8) {
      out.push({ kind: 'press', at: groupAnchor(g, n), stones: g.stones.length, amount: r - a });
    }
  }
  const size = (p: Purpose) => (p.kind === 'press' || p.kind === 'secure' ? p.amount * p.stones * 2 : p.amount);
  return out.sort((a, b) => size(b) - size(a));
}

/** Groups that die in `own` but live in `ref` (for their own colour), biggest first. */
export function dyingGroups(groups: StoneGroup[], own: Float32Array, ref: Float32Array, color?: Color): { g: StoneGroup; at: Loc }[] {
  return groups
    .filter((g) => (color === undefined || g.color === color) && groupOwn(g, own) <= -0.5 && groupOwn(g, ref) >= 0.2)
    .sort((a, b) => b.stones.length - a.stones.length)
    .map((g) => ({ g, at: g.stones[0] }));
}

/** A strong group of `color` (owned >= 0.8, at least `min` stones) within `r` of loc. */
export function strongNear(groups: StoneGroup[], own: Float32Array, loc: Loc, color: Color, size: number, r: number, min = 4): StoneGroup | null {
  if (loc === PASS) return null;
  let pick: StoneGroup | null = null;
  for (const g of groups) {
    if (g.color !== color || g.stones.length < min || groupOwn(g, own) < 0.8) continue;
    if (!g.stones.some((q) => chebyshev(q, loc, size) <= r)) continue;
    if (!pick || g.stones.length > pick.stones.length) pick = g;
  }
  return pick;
}

/** The whole board in a few facts: sure areas and frameworks per region, weak groups, the balance. */
export interface BoardPicture {
  /** Regions mostly sure for one side (summed sure ownership >= AREA_PTS). */
  sure: { color: Color; region: string; amount: number }[];
  /** Regions where one side has a big unsure framework. */
  frameworks: { color: Color; region: string; amount: number }[];
  /** Regions still open (no side leans). */
  open: string[];
  weak: { color: Color; at: Loc; stones: number; own: number }[];
  dead: { color: Color; at: Loc; stones: number }[];
  /** Share of the board's points already settled (|ownership| >= 0.8). */
  settled: number;
}

const AREA_PTS = 8;
const FRAME_PTS = 6;

export function boardPicture(board: Board, own: Float32Array, groups: StoneGroup[] = looseGroups(board)): BoardPicture {
  const n = board.size;
  const area = n * n;
  const sure = [new Array(9).fill(0), new Array(9).fill(0)];
  const frame = [new Array(9).fill(0), new Array(9).fill(0)];
  const pts = new Array(9).fill(0);
  let settled = 0;
  for (let p = 0; p < area; p++) {
    const v = own[p];
    if (Math.abs(v) >= 0.8) settled++;
    const z = zoneOf(p, n);
    pts[z]++;
    if (board.stones[p]) continue;
    const c = v > 0 ? 0 : 1;
    const a = Math.abs(v);
    if (a >= SURE) sure[c][z] += a;
    else if (a >= LEAN) frame[c][z] += a;
  }
  const scale = area / 361;
  const out: BoardPicture = { sure: [], frameworks: [], open: [], weak: [], dead: [], settled: settled / area };
  for (let z = 0; z < 9; z++) {
    const region = zoneName(z);
    const [sb, sw] = [sure[0][z], sure[1][z]];
    const [fb, fw] = [frame[0][z], frame[1][z]];
    if (Math.max(sb, sw) >= AREA_PTS * scale && Math.abs(sb - sw) >= AREA_PTS * scale * 0.6) out.sure.push({ color: sb > sw ? 1 : 2, region, amount: Math.max(sb, sw) });
    if (Math.max(fb, fw) >= FRAME_PTS * scale && Math.abs(fb - fw) >= FRAME_PTS * scale * 0.6) out.frameworks.push({ color: fb > fw ? 1 : 2, region, amount: Math.max(fb, fw) });
    if (sb + sw + fb + fw < 0.25 * pts[z]) out.open.push(region);
  }
  out.sure.sort((a, b) => b.amount - a.amount);
  out.frameworks.sort((a, b) => b.amount - a.amount);
  for (const g of groups) {
    if (g.stones.length < 2) continue;
    const v = groupOwn(g, own);
    if (v <= -0.7 && g.stones.length >= 3) out.dead.push({ color: g.color, at: groupAnchor(g, n), stones: g.stones.length });
    else if (v >= -0.3 && v <= 0.35) out.weak.push({ color: g.color, at: groupAnchor(g, n), stones: g.stones.length, own: v });
  }
  out.weak.sort((a, b) => b.stones - a.stones);
  out.dead.sort((a, b) => b.stones - a.stones);
  return out;
}

/** "the upper left and the left side" (regions in reading order, de-duplicated). */
export function regionList(regions: string[]): string {
  const u = [...new Set(regions)];
  if (u.length <= 1) return u[0] ? `the ${u[0]}` : 'the board';
  return `the ${u.slice(0, -1).join(', the ')} and the ${u[u.length - 1]}`;
}

/** Points of a line inside a square around `center` (for zooming a local problem). */
export function viewAround(points: Loc[], size: number, margin = 2): [number, number, number, number] | undefined {
  const ps = points.filter((p) => p !== PASS && p >= 0);
  if (!ps.length) return undefined;
  let [x0, y0, x1, y1] = [size, size, -1, -1];
  for (const p of ps) {
    const [x, y] = xy(p, size);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  x0 = Math.max(0, x0 - margin);
  y0 = Math.max(0, y0 - margin);
  x1 = Math.min(size - 1, x1 + margin);
  y1 = Math.min(size - 1, y1 + margin);
  // Snap to the edge when close (a corner problem shows its corner).
  if (x0 <= 2) x0 = 0;
  if (y0 <= 2) y0 = 0;
  if (x1 >= size - 3) x1 = size - 1;
  if (y1 >= size - 3) y1 = size - 1;
  // A window covering most of the board is no zoom at all.
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 0.6 * size * size) return undefined;
  return [x0, y0, x1, y1];
}

