import { PASS, type Loc } from './types';

const GTP_COLS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';

export const xy = (loc: Loc, size: number): [number, number] => [loc % size, Math.floor(loc / size)];
export const toLoc = (x: number, y: number, size: number): Loc => y * size + x;
export const onBoard = (x: number, y: number, size: number) => x >= 0 && y >= 0 && x < size && y < size;

/** SGF point ("pd") to Loc. Empty string or "tt" on boards <= 19 means pass. */
export function sgfToLoc(s: string, size: number): Loc {
  if (!s || (s === 'tt' && size <= 19)) return PASS;
  const x = s.charCodeAt(0) - 97;
  const y = s.charCodeAt(1) - 97;
  if (!onBoard(x, y, size)) return PASS;
  return toLoc(x, y, size);
}

export function locToSgf(loc: Loc, size: number): string {
  if (loc === PASS) return '';
  const [x, y] = xy(loc, size);
  return String.fromCharCode(97 + x) + String.fromCharCode(97 + y);
}

/** Human-readable coordinate, e.g. "Q16". */
export function locToGtp(loc: Loc, size: number): string {
  if (loc === PASS) return 'pass';
  const [x, y] = xy(loc, size);
  return `${GTP_COLS[x]}${size - y}`;
}

export function gtpToLoc(s: string, size: number): Loc {
  const t = s.trim().toUpperCase();
  if (t === 'PASS') return PASS;
  const x = GTP_COLS.indexOf(t[0]);
  const y = size - parseInt(t.slice(1), 10);
  if (x < 0 || !onBoard(x, y, size)) throw new Error(`bad coordinate ${s}`);
  return toLoc(x, y, size);
}

/** Line from the nearest edge, 1-based (1 = first line). */
export function lineOf(loc: Loc, size: number): number {
  const [x, y] = xy(loc, size);
  return Math.min(x, y, size - 1 - x, size - 1 - y) + 1;
}

export function chebyshev(a: Loc, b: Loc, size: number): number {
  if (a === PASS || b === PASS) return Infinity;
  const [ax, ay] = xy(a, size);
  const [bx, by] = xy(b, size);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function manhattan(a: Loc, b: Loc, size: number): number {
  if (a === PASS || b === PASS) return Infinity;
  const [ax, ay] = xy(a, size);
  const [bx, by] = xy(b, size);
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

export type Region = 'corner' | 'side' | 'center';

/** Coarse board region: corners are the 6x6 (19x19) squares, sides the edge bands. */
export function regionOf(loc: Loc, size: number): Region {
  const [x, y] = xy(loc, size);
  const band = size >= 19 ? 5 : size >= 13 ? 4 : 3;
  const nearX = x < band || x >= size - band;
  const nearY = y < band || y >= size - band;
  if (nearX && nearY) return 'corner';
  if (nearX || nearY) return 'side';
  return 'center';
}

/** Which of 9 zones (3x3 grid) a point is in: 0..8, row-major. */
export function zoneOf(loc: Loc, size: number): number {
  const [x, y] = xy(loc, size);
  const band = (v: number) => (v < size / 3 ? 0 : v < (2 * size) / 3 ? 1 : 2);
  return band(y) * 3 + band(x);
}

/** The 8 board symmetries applied to a point. */
export function symmetric(loc: Loc, size: number, sym: number): Loc {
  if (loc === PASS) return PASS;
  let [x, y] = xy(loc, size);
  const m = size - 1;
  if (sym & 1) x = m - x;
  if (sym & 2) y = m - y;
  if (sym & 4) [x, y] = [y, x];
  return toLoc(x, y, size);
}
