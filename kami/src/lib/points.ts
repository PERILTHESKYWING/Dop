/**
 * Board points named in answer text ("R16", "D4"), found so the chat can show each one on
 * the board when hovered: as the line it starts, else the line it is part of, else the point.
 */
import type { ExplainPosition, Variation } from '../../../src/lib/coach/explain/types';
import { replay } from '../../../src/lib/go/board';
import type { Loc, Move } from '../../../src/lib/go/types';

const COLS = 'ABCDEFGHJKLMNOPQRST';
/** Upper-case column letter (no I) and a row, standing alone: "R16", not "BR16" or "R16x". */
const POINT = /(?<![A-Za-z0-9])([A-HJ-T])(1[0-9]|[1-9])(?![A-Za-z0-9])/g;

export type TextPart = { type: 'text'; text: string } | { type: 'point'; text: string; loc: Loc };

/** Text split around the board points it names. Letters or rows off a `size` board stay text. */
export function splitPoints(text: string, size: number): TextPart[] {
  const out: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(POINT)) {
    const x = COLS.indexOf(m[1]);
    const row = parseInt(m[2], 10);
    if (x < 0 || x >= size || row < 1 || row > size) continue;
    if (m.index! > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    out.push({ type: 'point', text: m[0], loc: (size - row) * size + x });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

export interface PointView {
  /** The line to draw (empty: only mark the point). */
  line: Move[];
  highlight: Loc[];
  /** The variation the point belongs to, when it is in one. */
  variation?: Variation;
}

/**
 * What hovering a point shows: the variation that starts there; else the first variation
 * that plays there, with the point marked; else, on an empty point, that move for the side
 * to play; else (a stone already there) just the mark.
 */
export function pointView(loc: Loc, base: ExplainPosition, variations: Variation[]): PointView {
  const starts = variations.find((v) => v.moves[0]?.loc === loc);
  if (starts) return { line: starts.moves, highlight: [loc], variation: starts };
  const inside = variations.find((v) => v.moves.some((m) => m.loc === loc));
  if (inside) return { line: inside.moves, highlight: [loc], variation: inside };
  const stones = replay(base.size, base.setup, base.moves).stones;
  if (stones[loc]) return { line: [], highlight: [loc] };
  return { line: [{ color: base.toPlay, loc }], highlight: [] };
}
