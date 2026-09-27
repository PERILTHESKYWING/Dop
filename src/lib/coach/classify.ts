import { severityOf } from '../analysis/records';
import type { Color, Loc } from '../go/types';
import { BRILLIANT_5D, nextBestGap, ONLY_GAP_POINTS, ONLY_GAP_WIN } from './difficulty';

/**
 * Move classifications in the style chess players know from chess.com, grounded in
 * KataGo's numbers:
 *
 *   Brilliant !!  an only move (see Great) that strong amateurs (5d) find under 20% of the time
 *   Great !       the only good move: every alternative KataGo read is 2+ points or 8%+ worse
 *   Best ★        KataGo's choice, or as good (under 0.3 points and 1%)
 *   Excellent     within 0.6 points and 1.5%
 *   Good ✓        within 1 point and 3% (the review's "good")
 *   Book          a move professionals often chose from this exact opening position
 *   Inaccuracy ?! Mistake ?  Blunder ??  the review's grading by points and winrate lost
 *   Miss ✕        the opponent had just erred and this move gave much of it back
 */
export type MoveClass = 'brilliant' | 'great' | 'best' | 'excellent' | 'good' | 'book' | 'inaccuracy' | 'mistake' | 'miss' | 'blunder';

export const CLASS_ORDER: MoveClass[] = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];

export const CLASS_INFO: Record<MoveClass, { name: string; symbol: string; color: string; about: string }> = {
  brilliant: { name: 'Brilliant', symbol: '!!', color: '#1bb8a6', about: 'The only good move, and one that even strong amateurs rarely find.' },
  great: { name: 'Great', symbol: '!', color: '#4f8fd6', about: 'The only good move here: every alternative is clearly worse.' },
  best: { name: 'Best', symbol: '★', color: '#7cb342', about: "KataGo's choice, or just as good." },
  excellent: { name: 'Excellent', symbol: '👍', color: '#8fbf3f', about: 'Almost as good as the best move.' },
  good: { name: 'Good', symbol: '✓', color: '#8aa97a', about: 'A sound move that gives up very little.' },
  book: { name: 'Book', symbol: '📖', color: '#a8845f', about: 'A move professionals often chose from this exact opening position.' },
  inaccuracy: { name: 'Inaccuracy', symbol: '?!', color: '#f0b429', about: 'Gives up a little: about 1 to 2.5 points.' },
  mistake: { name: 'Mistake', symbol: '?', color: '#f08a24', about: 'Gives up a lot: about 2.5 to 6 points.' },
  miss: { name: 'Miss', symbol: '✕', color: '#ee5d5d', about: 'The opponent had just made a mistake, and this move let them off.' },
  blunder: { name: 'Blunder', symbol: '??', color: '#d93a2b', about: 'Gives up the game or a big part of it.' },
};

export interface ClassInput {
  /** Losses of the move from the mover's view (points; winrate 0..1). */
  scoreLoss: number;
  winrateLoss: number;
  /** The move is KataGo's first choice. */
  isBest: boolean;
  /** When it is best: how much worse the next-best move is. */
  gap?: { points: number; win: number } | null;
  /** How often strong amateurs (5d) play it here (see difficulty.ts), when known. */
  strongFind?: number | null;
  /** Professionals often played it from this position. */
  book?: boolean;
  /** What the opponent's previous move gave away, when known. */
  prev?: { scoreLoss: number; winrateLoss: number } | null;
}

export function isOnly(gap: { points: number; win: number } | null | undefined): boolean {
  return !!gap && (gap.points >= ONLY_GAP_POINTS || gap.win >= ONLY_GAP_WIN);
}

export function classifyMove(m: ClassInput): MoveClass {
  const sev = severityOf(m.scoreLoss, m.winrateLoss, m.isBest);
  if (sev === 'best') {
    if (isOnly(m.gap)) return m.strongFind != null && m.strongFind < BRILLIANT_5D ? 'brilliant' : 'great';
    if (m.book) return 'book';
    return 'best';
  }
  if (m.book && (sev === 'good' || sev === 'inaccuracy')) return 'book';
  if (sev === 'good') return m.scoreLoss < 0.6 && m.winrateLoss < 0.015 ? 'excellent' : 'good';
  if ((sev === 'inaccuracy' || sev === 'mistake') && m.prev && (m.prev.winrateLoss >= 0.1 || m.prev.scoreLoss >= 4)) {
    // The opponent had just given something away; giving half of it back is a missed punish.
    if (m.winrateLoss >= 0.5 * m.prev.winrateLoss || m.scoreLoss >= 0.5 * m.prev.scoreLoss) return 'miss';
  }
  return sev;
}

/** A position's evaluation as the live boards keep it (winrate and score for the side to move per candidate). */
export interface EvalSummary {
  toPlay: Color;
  /** Black's winrate and lead. */
  bWin: number;
  bLead: number;
  visits: number;
  /** Most visits first. */
  cands: { loc: Loc; winrate: number; scoreLead: number; visits: number }[];
}

/**
 * Losses of `move` played from `parent`, from the parent's candidates when the move was
 * read there, otherwise from the evaluation of the position after it (`child`).
 */
export function lossFromEvals(parent: EvalSummary, move: Loc, child: EvalSummary | null): Omit<ClassInput, 'prev' | 'book' | 'strongFind'> | null {
  const mover = parent.toPlay;
  const best = parent.cands[0];
  const bestWin = best ? best.winrate : mover === 1 ? parent.bWin : 1 - parent.bWin;
  const bestLead = best ? best.scoreLead : mover === 1 ? parent.bLead : -parent.bLead;
  const c = parent.cands.find((x) => x.loc === move && x.visits >= 2);
  let win: number, lead: number;
  if (c) {
    win = c.winrate;
    lead = c.scoreLead;
  } else if (child && child.visits >= 2) {
    win = mover === 1 ? child.bWin : 1 - child.bWin;
    lead = mover === 1 ? child.bLead : -child.bLead;
  } else return null;
  const isBest = !!best && best.loc === move;
  return {
    scoreLoss: Math.max(0, bestLead - lead),
    winrateLoss: Math.max(0, bestWin - win),
    isBest,
    gap: isBest ? nextBestGap(parent.cands, parent.visits, 30) : null,
  };
}
