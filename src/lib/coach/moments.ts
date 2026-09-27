import type { Color, Loc } from '../go/types';
import { PASS } from '../go/types';
import type { GameAnalysis, MoveRecord } from '../types';
import { fromStoredCandidates } from './stored';
import { nextBestGap, ONLY_GAP_POINTS, ONLY_GAP_WIN } from './difficulty';

/**
 * The parts of a game that mattered, from its stored analysis: the turning points (the
 * moves that gave away the most) and the positions with only one right move (every
 * alternative KataGo read was clearly worse), whether or not the player found it.
 */

export interface KeyMoment {
  /** Position index (the move played here is move index + 1). */
  index: number;
  color: Color;
  kind: 'turning-point' | 'only-move';
  played: Loc;
  best: Loc;
  found: boolean;
  winrateLoss: number;
  scoreLoss: number;
  /** For only moves: how much worse the next-best move is. */
  gap?: { points: number; win: number };
}

export function keyMoments(records: readonly MoveRecord[], analysis: GameAnalysis | undefined, max = 8): KeyMoment[] {
  const byIndex = new Map(records.map((r) => [r.index, r]));
  const turning = records
    .filter((r) => r.loc !== PASS && (r.winrateLoss >= 0.1 || r.scoreLoss >= 5) && r.winBefore > 0.05 && r.winBefore < 0.95)
    .sort((a, b) => b.winrateLoss - a.winrateLoss || b.scoreLoss - a.scoreLoss)
    .slice(0, Math.ceil(max / 2))
    .map<KeyMoment>((r) => ({ index: r.index, color: r.color, kind: 'turning-point', played: r.loc, best: r.bestLoc, found: false, winrateLoss: r.winrateLoss, scoreLoss: r.scoreLoss }));
  const only: KeyMoment[] = [];
  for (const [i, e] of (analysis?.evals ?? []).entries()) {
    const r = byIndex.get(i);
    if (!e?.searched || !r || r.loc === PASS || r.winBefore < 0.05 || r.winBefore > 0.95) continue;
    const cands = fromStoredCandidates(e.candidates);
    const gap = nextBestGap(cands, e.visits);
    if (!gap || (gap.points < ONLY_GAP_POINTS && gap.win < ONLY_GAP_WIN)) continue;
    only.push({ index: i, color: r.color, kind: 'only-move', played: r.loc, best: cands[0].loc, found: r.loc === cands[0].loc, winrateLoss: r.winrateLoss, scoreLoss: r.scoreLoss, gap });
  }
  only.sort((a, b) => b.gap!.win - a.gap!.win || b.gap!.points - a.gap!.points);
  const seen = new Set(turning.map((m) => m.index));
  const out = [...turning, ...only.filter((m) => !seen.has(m.index)).slice(0, max - turning.length)];
  return out.sort((a, b) => a.index - b.index);
}
