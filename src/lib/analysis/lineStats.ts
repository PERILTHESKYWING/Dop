import { PASS, type Color, type Loc, type Move } from '../go/types';
import { classifyMove, type MoveClass } from '../coach/classify';

/**
 * What a game's evaluations say about each move: how much winrate (and score) the mover
 * gave away, the biggest drops ("blunders", as Fox calls its problematic-move chart), and
 * each player's performance by phase. Works from any series of position values, so the
 * study board, game review, live games and games against the copy share one report.
 */

/** KataGo's view of one position: Black's winrate (0..1), Black's lead, and its first choice. */
export interface PosValue {
  bWin: number;
  bLead?: number | null;
  best?: Loc | null;
}

export type Phase = 'opening' | 'middle' | 'endgame';

export interface MoveLoss {
  /** 0-based move index: the move that turns position `index` into position `index + 1`. */
  index: number;
  color: Color;
  loc: Loc;
  /** Winrate the mover gave away (0..1, never negative). */
  winLoss: number;
  /** Points the mover gave away, when both positions have a score. */
  scoreLoss: number | null;
  /** The mover's winrate after the move. */
  after: number;
  /** Whether it was KataGo's first choice, when that is known. */
  matched: boolean | null;
  phase: Phase;
}

/** Where the opening and the middle game end, scaled from 19×19's 50 and 150 moves. */
export function phaseBounds(size: number): [number, number] {
  const f = (size * size) / 361;
  return [Math.max(6, Math.round(50 * f)), Math.max(16, Math.round(150 * f))];
}

export function phaseOf(index: number, size: number): Phase {
  const [a, b] = phaseBounds(size);
  return index < a ? 'opening' : index < b ? 'middle' : 'endgame';
}

/** One entry per move whose position before and after both have a value. Passes are skipped. */
export function moveLosses(values: (PosValue | null | undefined)[], moves: Move[], size: number): MoveLoss[] {
  const out: MoveLoss[] = [];
  moves.forEach((m, i) => {
    const a = values[i];
    const b = values[i + 1];
    if (!a || !b || m.loc === PASS) return;
    const sign = m.color === 1 ? 1 : -1;
    const winLoss = Math.max(0, sign * (a.bWin - b.bWin));
    const scoreLoss = a.bLead != null && b.bLead != null ? Math.max(0, sign * (a.bLead - b.bLead)) : null;
    out.push({
      index: i,
      color: m.color,
      loc: m.loc,
      winLoss,
      scoreLoss,
      after: m.color === 1 ? b.bWin : 1 - b.bWin,
      matched: a.best != null ? a.best === m.loc : null,
      phase: phaseOf(i, size),
    });
  });
  return out;
}

/** Losses big enough to count as a mistake or a blunder (winrate, or points when winrate barely moves). */
export const MISTAKE = { win: 0.1, points: 3 };
export const BLUNDER = { win: 0.2, points: 6 };
export const GOOD = { win: 0.02, points: 1 };

export function isMistake(l: MoveLoss) {
  return l.winLoss >= MISTAKE.win || (l.scoreLoss ?? 0) >= MISTAKE.points;
}
export function isBlunder(l: MoveLoss) {
  return l.winLoss >= BLUNDER.win || (l.scoreLoss ?? 0) >= BLUNDER.points;
}
export function isGood(l: MoveLoss) {
  return l.winLoss < GOOD.win && (l.scoreLoss ?? 0) < GOOD.points;
}

/**
 * The biggest drops, as on Fox's chart: the `max` moves that lost the most winrate (at
 * least 5%, or 2 points), in move order.
 */
export function biggestDrops(losses: MoveLoss[], filter: { color?: Color; phase?: Phase } = {}, max = 10): MoveLoss[] {
  return losses
    .filter((l) => (!filter.color || l.color === filter.color) && (!filter.phase || l.phase === filter.phase))
    .filter((l) => l.winLoss >= 0.05 || (l.scoreLoss ?? 0) >= 2)
    .sort((a, b) => b.winLoss - a.winLoss || (b.scoreLoss ?? 0) - (a.scoreLoss ?? 0))
    .slice(0, max)
    .sort((a, b) => a.index - b.index);
}

export interface Performance {
  moves: number;
  /** Share of moves that lost under 2% and under a point. */
  accuracy: number | null;
  /** Share of moves that were KataGo's first choice (only counted where that is known). */
  match: number | null;
  avgWinLoss: number | null;
  avgScoreLoss: number | null;
  mistakes: number;
  blunders: number;
}

export function performance(losses: MoveLoss[], color: Color, phase?: Phase): Performance {
  const ls = losses.filter((l) => l.color === color && (!phase || l.phase === phase));
  const n = ls.length;
  const scored = ls.filter((l) => l.scoreLoss !== null);
  const known = ls.filter((l) => l.matched !== null);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    moves: n,
    accuracy: n ? ls.filter(isGood).length / n : null,
    match: known.length ? known.filter((l) => l.matched).length / known.length : null,
    avgWinLoss: avg(ls.map((l) => l.winLoss)),
    avgScoreLoss: avg(scored.map((l) => l.scoreLoss!)),
    mistakes: ls.filter((l) => isMistake(l) && !isBlunder(l)).length,
    blunders: ls.filter(isBlunder).length,
  };
}

/**
 * Each move's class (brilliant … blunder) from the losses alone, for boards that have no
 * per-move candidate lists (study board, live games). Without the gap to KataGo's second
 * choice there is no "only move", so brilliant and great come only from the game review.
 */
export function lineClasses(losses: MoveLoss[]): Map<number, MoveClass> {
  const out = new Map<number, MoveClass>();
  const byIndex = new Map(losses.map((l) => [l.index, l]));
  for (const l of losses) {
    const prev = byIndex.get(l.index - 1);
    out.set(
      l.index,
      classifyMove({
        scoreLoss: l.scoreLoss ?? l.winLoss * 30,
        winrateLoss: l.winLoss,
        isBest: l.matched === true,
        prev: prev ? { scoreLoss: prev.scoreLoss ?? prev.winLoss * 30, winrateLoss: prev.winLoss } : null,
      }),
    );
  }
  return out;
}
