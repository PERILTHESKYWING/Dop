/**
 * What each Kami model may spend on one answer. maxMs is the hard cap: the answer is done by
 * then on any machine, and a slow machine simply gets fewer visits inside it. visits are the
 * target. Measured with scripts/explain-bench.ts (WASM b10 in Node, one thread, about 20
 * visits a second with a cold cache on the 2-core cloud box): see
 * docs/handoff/kami-engine.md for measured times.
 *
 * - Hane: two reads (the position, and the asked move or the best move), no line play.
 * - Tesuji: reads ahead; consequence lines grow with the thinking level.
 * - Myoshu: deepest reads (the LLM only rewords them afterwards).
 */
import type { Budget, ModelId, ThinkingLevel } from './types';

const B = (reads: number, visits: number, lineVisits: number, lineDepth: number, maxMs: number): Budget => ({ reads, visits, lineVisits, lineDepth, maxMs });

// Fewer, deeper reads: a read at 11-19 visits moved leads by 1-2 points and its ownership
// was mostly noise, so line reads get at least 64 visits and the plan reads fewer positions.
// On a computer Kami runs kata1 b18 on the GPU (kami/src/lib/engine.ts), which fills these
// budgets quickly; b10 on a CPU reaches maxMs first and simply reads less.
const TABLE: Record<ModelId, Record<ThinkingLevel, Budget>> = {
  hane: {
    off: B(2, 64, 0, 0, 2000),
    low: B(2, 100, 0, 0, 3000),
    medium: B(2, 160, 0, 0, 4000),
    high: B(2, 240, 0, 0, 6000),
  },
  tesuji: {
    off: B(4, 160, 64, 10, 6000),
    low: B(6, 200, 80, 16, 9000),
    medium: B(8, 240, 100, 20, 14000),
    high: B(10, 320, 128, 28, 20000),
  },
  myoshu: {
    off: B(8, 240, 100, 20, 12000),
    low: B(10, 320, 128, 24, 18000),
    medium: B(12, 400, 160, 30, 26000),
    high: B(16, 500, 200, 40, 36000),
  },
};

export function budgetFor(model: ModelId, thinking: ThinkingLevel): Budget {
  const m = TABLE[model] ?? TABLE.tesuji;
  return { ...(m[thinking] ?? m.medium) };
}
