/**
 * The Performance tab's numbers, chess.com style, from the quick KataGo reads the graphs
 * already make of every position: each move's class (Brilliant … Blunder), each side's
 * accuracy, and how each side did in the opening, middle game and endgame.
 */
import { classifyMove, lossFromEvals, type EvalSummary, type MoveClass } from '../../../src/lib/coach/classify';
import { phaseOf, type Phase } from '../../../src/lib/analysis/lineStats';
import type { EngineRead, ExplainPosition } from '../../../src/lib/coach/explain/types';
import { PASS, type Color, type Move } from '../../../src/lib/go/types';

/** A great move counts as brilliant when the network alone gave it under this chance. */
export const BRILLIANT_POLICY = 0.12;

export interface MoveReview {
  index: number;
  color: Color;
  cls: MoveClass;
  /** Winrate the mover gave away, 0..1. */
  winLoss: number;
  phase: Phase;
}

const summary = (p: ExplainPosition, r: EngineRead): EvalSummary => ({ toPlay: p.toPlay, bWin: r.bWin, bLead: r.bLead, visits: r.visits, cands: r.candidates });

/**
 * Every move whose position before and after KataGo has read. `policy` (by move index) is
 * the network's own chance for the played move, when measured, which turns a hard-to-find
 * great move into a brilliant one.
 */
export function reviewMoves(positions: ExplainPosition[], reads: (EngineRead | undefined)[], moves: Move[], size: number, policy?: Map<number, number>): MoveReview[] {
  const out: MoveReview[] = [];
  let prev: { scoreLoss: number; winrateLoss: number } | null = null;
  moves.forEach((m, i) => {
    const a = reads[i];
    const b = reads[i + 1];
    if (!a || !b || m.loc === PASS) {
      prev = null;
      return;
    }
    const loss = lossFromEvals(summary(positions[i], a), m.loc, summary(positions[i + 1], b));
    if (!loss) {
      prev = null;
      return;
    }
    const p = policy?.get(i);
    const cls = classifyMove({ ...loss, prev, strongFind: p == null ? null : p < BRILLIANT_POLICY ? 0 : 1 });
    out.push({ index: i, color: m.color, cls, winLoss: loss.winrateLoss, phase: phaseOf(i, size) });
    prev = { scoreLoss: loss.scoreLoss, winrateLoss: loss.winrateLoss };
  });
  return out;
}

/** chess.com's per-move accuracy from the winning chance lost (in percent points). */
export const moveAccuracy = (winLoss: number) => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * winLoss * 100) - 3.1669));

/** Mean move accuracy of one side (optionally in one phase), or null without moves. */
export function accuracy(list: MoveReview[], color: Color, phase?: Phase): number | null {
  const xs = list.filter((m) => m.color === color && (!phase || m.phase === phase));
  return xs.length ? xs.reduce((a, m) => a + moveAccuracy(m.winLoss), 0) / xs.length : null;
}

/** The icon a phase gets from its accuracy, as on chess.com's game review. */
export function phaseClass(acc: number | null): MoveClass | null {
  if (acc === null) return null;
  if (acc >= 90) return 'best';
  if (acc >= 80) return 'excellent';
  if (acc >= 70) return 'good';
  if (acc >= 60) return 'inaccuracy';
  if (acc >= 45) return 'mistake';
  return 'blunder';
}
