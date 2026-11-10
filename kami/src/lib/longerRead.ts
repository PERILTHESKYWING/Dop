/**
 * "Read longer" says whether KataGo's pick moved (busy parent, 2026-11-08 and 11-09: after a
 * longer read the board changed and nothing said so). Only KataGo's own first choice from each
 * read, compared on the same position; no LLM call.
 */
import type { ExplainPosition } from '../../../src/lib/coach/explain/types';
import { locToGtp } from '../../../src/lib/go/coords';
import { PASS } from '../../../src/lib/go/types';
import type { Answer } from './store';

/** The shorter read a "Read longer" answer is compared with: KataGo's pick there and its position. */
export interface ShorterRead {
  /** KataGo's first choice on the shorter read ("Q10"). */
  pick: string;
  /** The position it read (positionOf), so a pick is only compared on the same board. */
  pos: string;
}

const positionOf = (p: ExplainPosition) => [p.size, p.toPlay, p.setup.map((m) => `${m.color}${m.loc}`).join(','), p.moves.map((m) => `${m.color}${m.loc}`).join(',')].join('|');

/** KataGo's pick in an engine answer and the position it read (null: no read with a move). */
export function shorterRead(a: Answer | undefined): ShorterRead | null {
  if (a?.type !== 'explain') return null;
  const ex = a.explanation;
  const top = ex.root?.candidates[0];
  if (!top || top.loc === PASS || top.loc < 0) return null;
  return { pick: locToGtp(top.loc, ex.position.size), pos: positionOf(ex.position) };
}

/**
 * The line under a longer read's header: "Longer read: KataGo's pick moved from Q10 to Q9." or
 * "Longer read: KataGo's pick stays Q10." Null when there is nothing to compare (no shorter read,
 * another position, or no pick on this read).
 */
export function pickMoveLine(before: ShorterRead | undefined, a: Answer | undefined): string | null {
  const now = shorterRead(a);
  if (!before || !now || before.pos !== now.pos) return null;
  return now.pick === before.pick ? `Longer read: KataGo's pick stays ${now.pick}.` : `Longer read: KataGo's pick moved from ${before.pick} to ${now.pick}.`;
}
