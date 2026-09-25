import { allPositions, type Board } from '../go/board';
import { buildContext, moveFeatures, type PositionContext } from '../go/features';
import { PASS, type Loc } from '../go/types';
import { decodeOwnership, moverView } from '../engine/parse';
import { searchedValue } from './analyzer';
import { classifyMove } from '../profile/signatures';
import type { GameAnalysis, GameRecord, MoveRecord, PositionEval, Severity } from '../types';

export function severityOf(scoreLoss: number, winrateLoss: number, playedIsBest: boolean): Severity {
  if (playedIsBest || (scoreLoss < 0.3 && winrateLoss < 0.01)) return 'best';
  const s = scoreLoss < 1 ? 1 : scoreLoss < 2.5 ? 2 : scoreLoss < 6 ? 3 : 4;
  const w = winrateLoss < 0.03 ? 1 : winrateLoss < 0.07 ? 2 : winrateLoss < 0.15 ? 3 : 4;
  // Winrate alone should not flag moves as blunders in lopsided positions, so cap its effect.
  const level = Math.max(s, Math.min(w, s + 1));
  return (['best', 'good', 'inaccuracy', 'mistake', 'blunder'] as Severity[])[level];
}

export interface MoveLoss {
  winrateLoss: number;
  scoreLoss: number;
  bestLoc: Loc;
  depth: 'fast' | 'deep';
}

/**
 * Loss of the played move from the mover's perspective.
 * Deep: compare the played move's one-ply evaluation against the best candidate's.
 * Fast: compare the evaluation before the move with the evaluation after it.
 */
export function moveLoss(before: PositionEval, after: PositionEval | null, played: Loc): MoveLoss | null {
  const mover = before.toPlay;
  if (before.depth === 'deep' && before.candidates?.length) {
    const cands = before.candidates.filter((c) => c.scoreLead !== undefined && c.winrate !== undefined);
    const playedCand = cands.find((c) => c.loc === played);
    if (cands.length && playedCand) {
      let best = cands[0];
      for (const c of cands) if ((c.scoreLead ?? -1e9) > (best.scoreLead ?? -1e9)) best = c;
      const bestLoc = before.bestLoc !== PASS && cands.some((c) => c.loc === before.bestLoc) ? before.bestLoc : best.loc;
      const maxLead = Math.max(...cands.map((c) => c.scoreLead!));
      const maxWin = Math.max(...cands.map((c) => c.winrate!));
      return {
        scoreLoss: Math.max(0, maxLead - playedCand.scoreLead!),
        winrateLoss: Math.max(0, maxWin - playedCand.winrate!),
        bestLoc,
        depth: 'deep',
      };
    }
  }
  if (!after) return null;
  const b = moverView(before.bWin, before.bLead, mover);
  const a = moverView(after.bWin, after.bLead, mover);
  return {
    scoreLoss: Math.max(0, b.lead - a.lead),
    winrateLoss: Math.max(0, b.win - a.win),
    bestLoc: before.bestLoc,
    depth: 'fast',
  };
}

export interface GameRecordsResult {
  records: MoveRecord[];
  /** Board and context before each move, only kept when requested (for model training). */
  contexts?: (PositionContext | null)[];
  boards: Board[];
}

/** Derive per-move records (losses, features, signatures) for one analysed game. */
export function computeMoveRecords(game: GameRecord, analysis: GameAnalysis | null, keepContexts = false): GameRecordsResult {
  const boards = allPositions(game.size, game.setup, game.moves);
  const records: MoveRecord[] = [];
  const contexts: (PositionContext | null)[] = [];
  for (let i = 0; i < game.moves.length; i++) {
    const m = game.moves[i];
    const before = analysis?.evals[i] ?? null;
    const after = analysis?.evals[i + 1] ?? null;
    if (!before || m.loc === PASS) {
      contexts.push(null);
      continue;
    }
    const loss = moveLoss(before, after, m.loc);
    if (!loss) {
      contexts.push(null);
      continue;
    }
    const own = decodeOwnership(before.ownership);
    const ctx = buildContext(boards[i], own);
    const lastOpp = i > 0 && game.moves[i - 1].color !== m.color ? game.moves[i - 1].loc : null;
    const mv = moverView(before.bWin, before.bLead, m.color);
    const searched = searchedValue(before);
    const f = moveFeatures(ctx, m.loc, loss.bestLoc, m.color, lastOpp, i + 1, mv.lead);
    const rank = before.policy.findIndex((p) => p.loc === m.loc);
    const playedIsBest = m.loc === loss.bestLoc;
    const { contexts: cx, errors } = classifyMove(f, loss.scoreLoss, loss.winrateLoss);
    records.push({
      id: `${game.id}:${i}`,
      gameId: game.id,
      index: i,
      color: m.color,
      loc: m.loc,
      isPlayer: game.playerColor === m.color,
      bestLoc: loss.bestLoc,
      playedPolicy: rank >= 0 ? before.policy[rank].p : 0,
      playedRank: rank >= 0 ? rank + 1 : 99,
      winrateLoss: loss.winrateLoss,
      scoreLoss: loss.scoreLoss,
      winBefore: moverView(searched.bWin, searched.bLead, m.color).win,
      depth: loss.depth,
      severity: severityOf(loss.scoreLoss, loss.winrateLoss, playedIsBest),
      features: f,
      contexts: cx,
      errors,
      size: game.size,
    });
    contexts.push(keepContexts ? ctx : null);
  }
  return { records, boards, contexts: keepContexts ? contexts : undefined };
}
