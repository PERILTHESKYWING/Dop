import type { Board } from '../go/board';
import { symmetric } from '../go/coords';
import { PASS, type Color, type Loc } from '../go/types';

/**
 * The player's own opening book: every early position from their games, with the moves
 * they played there and how often. Positions are stored turned to one standard orientation
 * (all 8 board symmetries), so a corner joseki is found in whichever corner it comes up.
 */
export interface OpeningBook {
  /** Moves into a 19x19 game the book covers (scaled by board area on other sizes). */
  depth: number;
  /** Position key → [move in the standard orientation, times played][]. */
  entries: Record<string, [number, number][]>;
  /** Positions in the book. */
  positions: number;
}

/** How far into the game the book reaches by default (19x19 moves). */
export const BOOK_DEPTH = 40;
/** At most this many positions are kept (the most recent games' first). */
const MAX_POSITIONS = 6000;

export const bookDepth = (depth19: number, size: number) => Math.round((depth19 * size * size) / 361);

/** The inverse of coords.symmetric (flips are their own inverse; the transpose comes last there). */
export function unsymmetric(loc: Loc, size: number, sym: number): Loc {
  if (loc === PASS) return PASS;
  // symmetric() flips x/y, then swaps them; undo the swap first, then the flips.
  const t = sym & 4 ? symmetric(loc, size, 4) : loc;
  return symmetric(t, size, sym & 3);
}

/** Point order of each symmetry, cached per board size. */
const orders = new Map<number, Int32Array[]>();
function symOrders(n: number): Int32Array[] {
  let o = orders.get(n);
  if (!o) {
    o = [];
    for (let sym = 0; sym < 8; sym++) {
      // order[j] = the point that lands on j under this symmetry.
      const a = new Int32Array(n * n);
      for (let i = 0; i < n * n; i++) a[symmetric(i, n, sym)] = i;
      o.push(a);
    }
    orders.set(n, o);
  }
  return o;
}

/** The position's key in its standard orientation, and the symmetry that turns it there. */
export function bookKey(board: Board, toPlay: Color): { key: string; sym: number } {
  const n = board.size;
  const st = board.stones;
  let best = '';
  let bestSym = 0;
  symOrders(n).forEach((order, sym) => {
    // Two 32-bit FNV-style lanes over the turned board.
    let h1 = 0x811c9dc5 ^ toPlay;
    let h2 = 0x9747b28c;
    for (let j = 0; j < order.length; j++) {
      const c = st[order[j]] + 1;
      h1 = Math.imul(h1 ^ c, 0x01000193);
      h2 = Math.imul(h2 ^ (c + j), 0x5bd1e995);
      h2 ^= h2 >>> 15;
    }
    const k = (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
    if (sym === 0 || k < best) {
      best = k;
      bestSym = sym;
    }
  });
  return { key: `${n}:${toPlay}:${best}`, sym: bestSym };
}

export interface BookMove {
  board: Board;
  toPlay: Color;
  loc: Loc;
  /** Moves played before this position. */
  moveNumber: number;
}

/** Build the book from the player's moves, most recent games first. */
export function buildBook(moves: Iterable<BookMove>, depth19 = BOOK_DEPTH): OpeningBook {
  const counts = new Map<string, Map<number, number>>();
  for (const m of moves) {
    if (m.loc === PASS || m.moveNumber >= bookDepth(depth19, m.board.size)) continue;
    const { key, sym } = bookKey(m.board, m.toPlay);
    let e = counts.get(key);
    if (!e) {
      if (counts.size >= MAX_POSITIONS) continue;
      e = new Map();
      counts.set(key, e);
    }
    const c = symmetric(m.loc, m.board.size, sym);
    e.set(c, (e.get(c) ?? 0) + 1);
  }
  const entries: OpeningBook['entries'] = {};
  for (const [k, e] of counts) entries[k] = [...e].sort((a, b) => b[1] - a[1]);
  return { depth: depth19, entries, positions: counts.size };
}

/**
 * The player's moves in this position from their book (in this board's orientation), with
 * how often each was played; empty when the position is not in the book or too deep.
 */
export function bookMoves(book: OpeningBook | null | undefined, board: Board, toPlay: Color, moveNumber: number, depth19?: number): { loc: Loc; n: number }[] {
  if (!book) return [];
  const depth = Math.min(depth19 ?? book.depth, book.depth);
  if (depth <= 0 || moveNumber >= bookDepth(depth, board.size)) return [];
  const { key, sym } = bookKey(board, toPlay);
  const e = book.entries[key];
  if (!e) return [];
  return e.map(([c, n]) => ({ loc: unsymmetric(c, board.size, sym), n })).filter((m) => board.isLegal(m.loc, toPlay));
}
