import { buildContext, moveFeatures, pointFeatures } from '../go/features';
import { Board } from '../go/board';
import { PASS, type Loc } from '../go/types';
import { decodeOwnership, moverView } from '../engine/parse';
import { signatureById } from '../profile/signatures';
import type { Grade, TrainingItem } from '../types';

export interface GradeResult {
  scoreLoss: number;
  winrateLoss: number;
  grade: Grade;
  conceptCorrect: boolean;
  repeatedError: boolean;
  bestLoc: Loc;
  /** True when the loss had to be estimated (move outside analysed candidates and no engine). */
  estimated: boolean;
  playedLabel?: string;
  bestLabel?: string;
}

export function gradeOf(scoreLoss: number, winrateLoss: number): Grade {
  if (scoreLoss < 0.5 && winrateLoss < 0.015) return 'excellent';
  if (scoreLoss < 1.5 && winrateLoss < 0.04) return 'good';
  if (scoreLoss < 3 && winrateLoss < 0.08) return 'inaccurate';
  if (scoreLoss < 7 && winrateLoss < 0.2) return 'mistake';
  return 'blunder';
}

export function itemBoard(item: TrainingItem): Board {
  const b = new Board(item.size);
  for (const s of item.setup) b.stones[s.loc] = s.color;
  for (const m of item.moves) b.play(m.loc, m.color, true);
  return b;
}

export function lastOpponentMove(item: TrainingItem): Loc | null {
  const last = item.moves[item.moves.length - 1];
  return last && last.color !== item.toPlay ? last.loc : null;
}

/** An answer checked by a search of its own: the answer's value and the best move's, from the same search. */
export interface LiveCheck {
  win: number;
  lead: number;
  bestWin?: number;
  bestLead?: number;
  bestLoc?: Loc;
}

/**
 * The reference an answer is measured against. After a tree search that is the move the
 * search trusted most (most visits), as in Lizzie: a candidate with a handful of visits
 * can look better than it is. Older analyses (one-ply candidates) take the best value.
 */
export function referenceOf(item: TrainingItem): { lead: number; win: number; loc: Loc } {
  const e = item.eval;
  const cands = (e.candidates ?? []).filter((c) => c.scoreLead !== undefined && c.winrate !== undefined);
  const root = moverView(e.bWin, e.bLead, item.toPlay);
  if (!cands.length) return { lead: root.lead, win: root.win, loc: e.bestLoc };
  if (e.searched) {
    const top = cands.reduce((a, c) => ((c.visits ?? 0) > (a.visits ?? 0) ? c : a));
    return { lead: top.scoreLead!, win: top.winrate!, loc: top.loc };
  }
  return {
    lead: Math.max(...cands.map((c) => c.scoreLead!)),
    win: Math.max(...cands.map((c) => c.winrate!)),
    loc: e.bestLoc !== PASS ? e.bestLoc : cands[0].loc,
  };
}

/** Candidates with this many visits are trusted for grading; fewer, and the answer is checked again. */
export const TRUSTED_VISITS = 8;

/** Whether the stored analysis can grade this answer on its own. */
export function answerCovered(item: TrainingItem, loc: Loc): boolean {
  const c = item.eval.candidates?.find((x) => x.loc === loc);
  if (!c || c.winrate === undefined || c.scoreLead === undefined) return false;
  return !item.eval.searched || (c.visits ?? 0) >= TRUSTED_VISITS || loc === referenceOf(item).loc;
}

/**
 * Grade a training answer against the reference analysis. `live` is an engine check of
 * the answer (mover's winrate/lead after it) for moves the reference analysis did not
 * cover well; when it carries the best move's value from the same search, the loss is
 * measured within that search.
 */
export function gradeAnswer(item: TrainingItem, loc: Loc, live?: LiveCheck | null): GradeResult {
  const e = item.eval;
  const cands = (e.candidates ?? []).filter((c) => c.scoreLead !== undefined);
  const ref = referenceOf(item);
  const bestLead = ref.lead;
  const bestWin = ref.win;
  const bestLoc = ref.loc !== PASS ? ref.loc : (cands[0]?.loc ?? PASS);
  let scoreLoss: number;
  let winrateLoss: number;
  let estimated = false;
  const cand = answerCovered(item, loc) ? cands.find((c) => c.loc === loc) : undefined;
  if (cand) {
    scoreLoss = Math.max(0, bestLead - cand.scoreLead!);
    winrateLoss = Math.max(0, bestWin - cand.winrate!);
  } else if (live) {
    scoreLoss = Math.max(0, (live.bestLead ?? bestLead) - live.lead);
    winrateLoss = Math.max(0, (live.bestWin ?? bestWin) - live.win);
  } else if (cands.some((c) => c.loc === loc)) {
    // A lightly searched candidate and no engine to check it: its value is all there is.
    const c = cands.find((x) => x.loc === loc)!;
    scoreLoss = Math.max(0, bestLead - c.scoreLead!);
    winrateLoss = Math.max(0, bestWin - (c.winrate ?? bestWin));
  } else {
    // Outside KataGo's candidate list: assume at least as bad as the worst candidate.
    estimated = true;
    // Without an engine: a move KataGo did not consider is assumed to be about as bad as
    // its weaker candidates (upper quartile of their losses), at least 2 points.
    const losses = cands.map((c) => bestLead - c.scoreLead!).sort((x, y) => x - y);
    const prior = e.policy.find((p) => p.loc === loc)?.p ?? 0;
    const q = losses.length ? losses[Math.floor((losses.length - 1) * (prior > 0.05 ? 0.5 : 0.75))] : 3;
    scoreLoss = Math.max(q, 2);
    winrateLoss = Math.min(0.5, scoreLoss * 0.02);
  }
  if (loc === bestLoc) {
    scoreLoss = 0;
    winrateLoss = 0;
  }

  const sig = signatureById.get(item.signature);
  const board = itemBoard(item);
  const ctx = buildContext(board, decodeOwnership(e.ownership));
  const lastOpp = lastOpponentMove(item);
  const f = moveFeatures(ctx, loc, bestLoc, item.toPlay, lastOpp, item.moves.length + 1, 0);
  let conceptCorrect = scoreLoss < 1;
  let repeatedError = false;
  let playedLabel: string | undefined;
  let bestLabel: string | undefined;
  if (sig) {
    if (sig.decide) {
      playedLabel = sig.decide(pointFeatures(ctx, loc, item.toPlay, lastOpp), f);
      bestLabel = sig.decide(pointFeatures(ctx, bestLoc, item.toPlay, lastOpp), f);
      conceptCorrect = playedLabel === bestLabel || scoreLoss < 1;
    }
    repeatedError = sig.context(f) && sig.commits(f) && scoreLoss >= (sig.minLoss ?? 1.5) * 0.7;
  }
  return { scoreLoss, winrateLoss, grade: gradeOf(scoreLoss, winrateLoss), conceptCorrect, repeatedError, bestLoc, estimated, playedLabel, bestLabel };
}
