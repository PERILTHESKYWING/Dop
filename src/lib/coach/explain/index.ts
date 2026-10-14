/**
 * The explainer's entry point. This first version is a minimal working stand-in (one read,
 * the best line, plain text) so the Kami site and the training factory can be built against
 * the real call; thread 1 (planner, consequence search, concepts) replaces the body.
 */
import { locToGtp } from '../../go/coords';
import { other, PASS, type Move } from '../../go/types';
import { KAMI_VERSION, type ExplainFn, type Explanation, type Variation } from './types';

export * from './types';
export { searchProber } from './searchProber';
export { buildLmPrompt, LM_SYSTEM } from './prompt';

const round1 = (x: number) => Math.round(x * 10) / 10;

export const explain: ExplainFn = async (pos, question, prober, opts) => {
  const t0 = Date.now();
  const visits = opts.thinking === 'off' ? 100 : opts.thinking === 'low' ? 200 : opts.thinking === 'medium' ? 400 : 800;
  const read = await prober.read(pos, { visits, maxMs: 8000 });
  const out: Explanation = {
    position: pos,
    model: opts.model,
    version: KAMI_VERSION,
    thinking: opts.thinking,
    question,
    summary: 'KataGo could not read this position.',
    sections: [],
    facts: [],
    concepts: [],
    variations: [],
    thoughts: [],
    reads: read ? 1 : 0,
    totalVisits: read?.visits ?? 0,
    ms: 0,
  };
  if (read && read.candidates.length) {
    const best = read.candidates[0];
    const name = (l: number) => (l === PASS ? 'pass' : locToGtp(l, pos.size));
    let color = pos.toPlay;
    const moves: Move[] = best.pv.map((loc) => {
      const m = { color, loc };
      color = other(color);
      return m;
    });
    const v: Variation = { id: 'v1', label: name(best.loc), kind: 'best', moves };
    out.variations.push(v);
    out.facts.push({ id: 'f1', text: `KataGo's best move is ${name(best.loc)}, winrate ${Math.round(best.winrate * 100)}%, lead ${round1(best.scoreLead)} points.` });
    out.summary = `KataGo prefers ${name(best.loc)} [[v1]].`;
    out.thoughts.push({ text: `Read the position (${read.visits} visits)`, ms: Date.now() - t0, visits: read.visits, variation: 'v1' });
  }
  out.ms = Date.now() - t0;
  return out;
};
