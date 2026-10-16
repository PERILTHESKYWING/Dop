/**
 * What a move looks like to a player: "the knight's move at O3", "the hane at C17", "the
 * attachment at P16". Pure geometry on the board before the move, no engine: a name is only
 * given when the shape is unambiguous, so the teacher text can say what kind of move it is
 * instead of only where it is. Also sorts moves into the kinds of game they lead to (solid,
 * territory, influence, fighting) for "play your style" answers.
 */
import type { Board } from '../../go/board';
import { lineOf, xy } from '../../go/coords';
import { other, PASS, type Color, type Loc } from '../../go/types';

export type ShapeId =
  | 'capture'
  | 'atari'
  | 'connect'
  | 'cut'
  | 'hane'
  | 'extend'
  | 'attach'
  | 'kosumi'
  | 'one-space-jump'
  | 'two-space-jump'
  | 'keima'
  | 'large-keima'
  | 'three-three'
  | 'approach'
  | 'enclosure'
  | 'pincer'
  | 'open-point';

/** What kind of game a move leads to (for "play your style"). */
export type MoveStyle = 'solid' | 'territory' | 'influence' | 'fighting';

export interface Shape {
  id: ShapeId;
  /** "the knight's move", "a hane", without the point. */
  name: string;
  /** The Go term, for the glossary hover ("keima"); absent when the English is the term. */
  term?: string;
  style: MoveStyle;
}

const SHAPES: Record<ShapeId, Omit<Shape, 'id'>> = {
  capture: { name: 'the capture', style: 'fighting' },
  atari: { name: 'the atari', term: 'atari', style: 'fighting' },
  connect: { name: 'the connection', style: 'solid' },
  cut: { name: 'the cut', style: 'fighting' },
  hane: { name: 'the hane', term: 'hane', style: 'fighting' },
  extend: { name: 'the extension', style: 'solid' },
  attach: { name: 'the attachment', term: 'tsuke', style: 'fighting' },
  kosumi: { name: 'the diagonal move', term: 'kosumi', style: 'solid' },
  'one-space-jump': { name: 'the one-space jump', style: 'solid' },
  'two-space-jump': { name: 'the two-space extension', style: 'solid' },
  keima: { name: "the knight's move", term: 'keima', style: 'solid' },
  'large-keima': { name: "the large knight's move", term: 'ogeima', style: 'solid' },
  'three-three': { name: 'the 3-3 invasion', style: 'territory' },
  approach: { name: 'the approach', term: 'kakari', style: 'influence' },
  enclosure: { name: 'the corner enclosure', term: 'shimari', style: 'solid' },
  pincer: { name: 'the pincer', term: 'hasami', style: 'fighting' },
  'open-point': { name: 'the big point', style: 'influence' },
};

const shape = (id: ShapeId, style?: MoveStyle): Shape => ({ id, ...SHAPES[id], ...(style ? { style } : {}) });

/** Stones of `color` at offsets (dx, dy) from `loc`, in any of the 8 orientations. */
function at(board: Board, loc: Loc, dx: number, dy: number): Loc[] {
  const n = board.size;
  const [x, y] = xy(loc, n);
  const out = new Set<Loc>();
  for (const [a, b] of [
    [dx, dy],
    [dy, dx],
  ]) {
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) {
        const xx = x + sx * a;
        const yy = y + sy * b;
        if (xx >= 0 && yy >= 0 && xx < n && yy < n) out.add(yy * n + xx);
      }
  }
  return [...out];
}

const of = (board: Board, locs: Loc[], c: Color) => locs.filter((l) => board.stones[l] === c);

/** Chebyshev distance from loc to the nearest stone (any colour), up to `max`. */
function nearestStone(board: Board, loc: Loc, max: number): number {
  const n = board.size;
  const [x0, y0] = xy(loc, n);
  let best = Infinity;
  for (let y = Math.max(0, y0 - max); y <= Math.min(n - 1, y0 + max); y++)
    for (let x = Math.max(0, x0 - max); x <= Math.min(n - 1, x0 + max); x++) {
      if ((x !== x0 || y !== y0) && board.stones[y * n + x]) best = Math.min(best, Math.max(Math.abs(x - x0), Math.abs(y - y0)));
    }
  return best;
}

/** Which corner a point is in (on its board's quarter), or -1 when it is not near one. */
function cornerOf(loc: Loc, n: number): number {
  const [x, y] = xy(loc, n);
  const lim = n >= 15 ? 6 : n >= 11 ? 4 : 3;
  const left = x < lim;
  const right = x >= n - lim;
  const top = y < lim;
  const bottom = y >= n - lim;
  if (top && left) return 0;
  if (top && right) return 1;
  if (bottom && left) return 2;
  if (bottom && right) return 3;
  return -1;
}

const stonesIn = (board: Board, corner: number, c: Color) => {
  const out: Loc[] = [];
  for (let i = 0; i < board.stones.length; i++) if (board.stones[i] === c && cornerOf(i, board.size) === corner) out.push(i);
  return out;
};

/**
 * The shape of `move` for `color` on `board` (the board before the move), or null when it has
 * no clear name. The first rule that fits wins: tactics (capture, atari, connect, cut) before
 * contact shapes, before the distance shapes from the player's own stones.
 */
export function shapeOf(board: Board, move: Loc, color: Color): Shape | null {
  if (move === PASS || move < 0 || move >= board.stones.length || board.stones[move]) return null;
  const n = board.size;
  const opp = other(color);
  const nbrs = board.neighbors(move);
  const ownN = nbrs.filter((q) => board.stones[q] === color);
  const oppN = nbrs.filter((q) => board.stones[q] === opp);
  const chain = (q: Loc) => board.groupAt(q)!;

  // Tactics first.
  const oppChains = new Map<Loc, ReturnType<typeof chain>>();
  for (const q of oppN) {
    const g = chain(q);
    oppChains.set(Math.min(...g.stones), g);
  }
  if ([...oppChains.values()].some((g) => g.liberties.length === 1)) return shape('capture');
  if ([...oppChains.values()].some((g) => g.liberties.length === 2 && g.stones.length >= 1)) {
    // After the move this chain has one liberty left: atari (unless the move is self-atari).
    const own = new Set<Loc>();
    for (const q of ownN) for (const l of chain(q).liberties) own.add(l);
    for (const q of nbrs) if (!board.stones[q]) own.add(q);
    own.delete(move);
    if (own.size >= 2) return shape('atari');
  }
  const ownChains = new Set(ownN.map((q) => Math.min(...chain(q).stones)));
  if (ownChains.size >= 2) return shape('connect');
  if (oppChains.size >= 2) return shape('cut');

  // Contact shapes.
  const diagOwn = of(board, at(board, move, 1, 1), color);
  if (oppN.length && diagOwn.some((d) => board.neighbors(d).some((q) => oppN.includes(q)))) return shape('hane');
  if (ownN.length && oppN.length) return shape('extend', 'solid');
  if (oppN.length && !ownN.length && !diagOwn.length) return shape('attach');
  if (ownN.length) return shape('extend');

  // Openings: 3-3 under a 4-4 stone, approaches, enclosures, pincers.
  const corner = cornerOf(move, n);
  const line = lineOf(move, n);
  const [mx, my] = xy(move, n);
  const lineX = Math.min(mx, n - 1 - mx) + 1;
  const lineY = Math.min(my, n - 1 - my) + 1;
  if (corner >= 0 && n >= 13) {
    const theirs = stonesIn(board, corner, opp);
    const mine = stonesIn(board, corner, color);
    if (lineX === 3 && lineY === 3 && theirs.length === 1 && !mine.length) {
      const [tx, ty] = xy(theirs[0], n);
      if (Math.min(tx, n - 1 - tx) === 3 && Math.min(ty, n - 1 - ty) === 3) return shape('three-three');
    }
    const knightish = (a: Loc) => {
      const [ax, ay] = xy(a, n);
      const dx = Math.abs(ax - mx);
      const dy = Math.abs(ay - my);
      return (dx <= 3 && dy <= 3 && dx + dy >= 3 && dx + dy <= 5) || (dx === 0 && dy >= 2 && dy <= 3) || (dy === 0 && dx >= 2 && dx <= 3);
    };
    if (theirs.length === 1 && !mine.length && (line === 3 || line === 4) && knightish(theirs[0])) return shape('approach');
    if (mine.length === 1 && !theirs.length && (line === 3 || line === 4) && knightish(mine[0])) return shape('enclosure');
  }

  // Distance shapes from the player's own stones.
  if (diagOwn.length) return shape('kosumi');
  const jump1 = of(board, at(board, move, 2, 0), color).find((s) => board.stones[(s + move) / 2] === 0);
  if (jump1 !== undefined) return shape('one-space-jump');
  if (of(board, at(board, move, 2, 1), color).length) return shape('keima');
  // A pincer: on the 3rd/4th line, an opponent stone that approached our corner stone sits between.
  if ((line === 3 || line === 4) && n >= 13) {
    for (const s of of(board, at(board, move, 2, 0).concat(at(board, move, 3, 0), at(board, move, 4, 0), at(board, move, 3, 1), at(board, move, 4, 1), at(board, move, 5, 0), at(board, move, 5, 1)), opp)) {
      if (board.neighbors(s).some((q) => board.stones[q])) continue;
      const near = of(board, at(board, s, 1, 2).concat(at(board, s, 2, 0), at(board, s, 1, 3), at(board, s, 2, 1), at(board, s, 3, 0)), color);
      if (near.length && !near.some((m) => (xy(m, n)[0] - xy(s, n)[0]) * (xy(move, n)[0] - xy(s, n)[0]) > 0 && (xy(m, n)[1] - xy(s, n)[1]) * (xy(move, n)[1] - xy(s, n)[1]) >= 0 && Math.abs(xy(m, n)[0] - xy(s, n)[0]) > 0)) {
        return shape('pincer');
      }
    }
  }
  const jump2 = of(board, at(board, move, 3, 0), color).find((s) => {
    const step = (s - move) / 3;
    return board.stones[move + step] === 0 && board.stones[move + 2 * step] === 0;
  });
  if (jump2 !== undefined) return shape('two-space-jump');
  if (of(board, at(board, move, 3, 1), color).length) return shape('large-keima');
  if (nearestStone(board, move, 3) > 3 && (line === 3 || line === 4)) return shape('open-point', line === 3 ? 'territory' : 'influence');
  return null;
}

/** The style of game a move points to, when its shape does not say. */
export function styleOf(board: Board, move: Loc, color: Color): MoveStyle {
  const s = shapeOf(board, move, color);
  if (s) return s.style;
  if (move === PASS || move < 0) return 'solid';
  const line = lineOf(move, board.size);
  if (line <= 3) return 'territory';
  return nearestStone(board, move, 2) <= 1 ? 'fighting' : 'influence';
}

/** "the knight's move at O3" (or just "O3" with no clear shape). */
export function shapeAt(board: Board, move: Loc, color: Color, C: (l: Loc) => string): string {
  const s = shapeOf(board, move, color);
  return s ? `${s.name} at ${C(move)}` : C(move);
}

export const STYLE_WORDS: Record<MoveStyle, string> = {
  solid: 'solid and safe',
  territory: 'territory-minded',
  influence: 'building outward',
  fighting: 'fighting',
};
