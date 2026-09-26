import type { SearchCandidate } from '../engine/mcts';

/**
 * The moves a careful player may choose from: the best one, and any other move the search
 * read enough to trust that loses at most `maxLoss` points and `maxWr` winrate against it.
 */
export function safeChoices(cands: SearchCandidate[], maxLoss: number, maxWr: number): SearchCandidate[] {
  if (!cands.length) return [];
  const best = cands[0];
  const top = best.visits || 1;
  return cands.filter(
    (c, i) => i === 0 || (c.visits >= Math.max(4, top * 0.08) && best.scoreLead - c.scoreLead <= maxLoss && best.winrate - c.winrate <= maxWr),
  );
}
