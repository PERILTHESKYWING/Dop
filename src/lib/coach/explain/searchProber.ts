/**
 * A Prober over the site's own search, for any engine: the browser worker, the WASM engine
 * in Node (scripts/explainNode.ts) or native KataGo. Shared by the Kami site, the bench and
 * the training task factory.
 */
import { engineMoves } from '../../analysis/analyzer';
import { Search, type LeafEvaluator } from '../../engine/mcts';
import { replay } from '../../go/board';
import type { EngineRead, ExplainPosition, Prober } from './types';

export function searchProber(evaluator: LeafEvaluator, opts: { batch?: number } = {}): Prober {
  return {
    async read(pos: ExplainPosition, budget: { visits: number; maxMs: number }): Promise<EngineRead | null> {
      const board = replay(pos.size, pos.setup, pos.moves);
      const search = new Search(
        evaluator,
        { size: pos.size, komi: pos.komi, moves: engineMoves(pos.setup, pos.moves), toPlay: pos.toPlay, board },
        { batch: opts.batch ?? 1 },
      );
      const snap = await search.run({ visits: budget.visits, maxMs: budget.maxMs });
      if (!snap) return null;
      return {
        visits: snap.visits,
        bWin: snap.bWin,
        bLead: snap.bLead,
        ownership: snap.ownership,
        candidates: snap.candidates.map((c) => ({ loc: c.loc, winrate: c.winrate, scoreLead: c.scoreLead, visits: c.visits, pv: [...c.pv] })),
      };
    },
  };
}
