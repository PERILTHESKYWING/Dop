/**
 * What each Kami model may spend on one answer. maxMs is the hard cap: the answer is done by
 * then on any machine, and a slow machine simply gets fewer visits inside it. visits are the
 * target. Measured with scripts/explain-bench.ts (WASM b10 in Node, one thread, about 20
 * visits a second with a cold cache on the 2-core cloud box): Tesuji medium's full plan
 * needs about 17 s there (mean of 11 positions), so a browser must run at least about 2.4x
 * that to read it all inside 10 s. No browser has been measured; see
 * docs/handoff/kami-engine.md.
 *
 * - Hane: two reads (the position, and the asked move or the best move), no line play.
 * - Tesuji: reads ahead; consequence lines grow with the thinking level.
 * - Myoshu: deepest reads (the LLM only rewords them afterwards).
 */
import type { Budget, ModelId, ThinkingLevel } from './types';

const B = (reads: number, visits: number, lineVisits: number, lineDepth: number, maxMs: number): Budget => ({ reads, visits, lineVisits, lineDepth, maxMs });

const TABLE: Record<ModelId, Record<ThinkingLevel, Budget>> = {
  hane: {
    off: B(2, 48, 0, 0, 1500),
    low: B(2, 64, 0, 0, 2000),
    medium: B(2, 100, 0, 0, 3000),
    high: B(2, 160, 0, 0, 4000),
  },
  tesuji: {
    off: B(4, 100, 32, 10, 4000),
    low: B(6, 128, 40, 16, 6000),
    medium: B(10, 160, 48, 24, 10000),
    high: B(16, 240, 64, 36, 16000),
  },
  myoshu: {
    off: B(8, 200, 64, 20, 9000),
    low: B(12, 240, 64, 28, 14000),
    medium: B(18, 320, 80, 36, 22000),
    high: B(26, 400, 100, 48, 32000),
  },
};

export function budgetFor(model: ModelId, thinking: ThinkingLevel): Budget {
  const m = TABLE[model] ?? TABLE.tesuji;
  return { ...(m[thinking] ?? m.medium) };
}
