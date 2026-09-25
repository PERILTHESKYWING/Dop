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

/**
 * Grade a training answer against the reference analysis. `live` is an optional
 * engine evaluation of the answer (mover's winrate/lead after the move) for moves the
 * reference analysis did not cover.
 */
export function gradeAnswer(item: TrainingItem, loc: Loc, live?: { win: number; lead: number } | null): GradeResult {
  const e = item.eval;
  const cands = (e.candidates ?? []).filter((c) => c.scoreLead !== undefined);
  const bestLead = cands.length ? Math.max(...cands.map((c) => c.scoreLead!)) : moverView(e.bWin, e.bLead, item.toPlay).lead;
  const bestWin = cands.length ? Math.max(...cands.map((c) => c.winrate!)) : moverView(e.bWin, e.bLead, item.toPlay).win;
  const bestLoc = e.bestLoc !== PASS ? e.bestLoc : (cands[0]?.loc ?? PASS);
  let scoreLoss: number;
  let winrateLoss: number;
  let estimated = false;
  const cand = cands.find((c) => c.loc === loc);
  if (cand) {
    scoreLoss = Math.max(0, bestLead - cand.scoreLead!);
    winrateLoss = Math.max(0, bestWin - cand.winrate!);
  } else if (live) {
    scoreLoss = Math.max(0, bestLead - live.lead);
    winrateLoss = Math.max(0, bestWin - live.win);
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
