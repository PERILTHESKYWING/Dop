import type { EvalSummary } from '../lib/coach/classify';
import type { SearchSnapshot } from '../lib/engine/mcts';
import { useLive } from './live';

/**
 * What the live boards have seen: the latest evaluation of every position KataGo read
 * while you looked at it, by the live key of the position. A move played on an analysis
 * board is classified from the position before it (and after it) through this.
 */
const memory = new Map<string, EvalSummary>();
const LIMIT = 4000;

export function remember(key: string, e: EvalSummary) {
  const had = memory.get(key);
  if (had && had.visits > e.visits) return;
  memory.delete(key);
  memory.set(key, e);
  if (memory.size > LIMIT) memory.delete(memory.keys().next().value!);
}

export const recall = (key: string | null | undefined) => (key ? memory.get(key) ?? null : null);

export function summaryOf(s: SearchSnapshot): EvalSummary {
  return {
    toPlay: s.toPlay,
    bWin: s.bWin,
    bLead: s.bLead,
    visits: s.visits,
    cands: s.candidates.map((c) => ({ loc: c.loc, winrate: c.winrate, scoreLead: c.scoreLead, visits: c.visits })),
  };
}

useLive.subscribe((s) => {
  if (s.key && s.snap && s.snap.visits > 1) remember(s.key, summaryOf(s.snap));
});
