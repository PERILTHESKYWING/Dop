/**
 * The explainer's entry point: an engine-only coach. KataGo does the thinking; the planner
 * (planner.ts) decides what to read inside the model's budget (budgets.ts), consequence.ts
 * plays slow losses out to their turning point, concepts.ts names what the reads clearly
 * show, and text.ts writes it all from checked facts. No language model here: Myoshu's
 * rewording happens on the site, from buildLmPrompt(explanation).
 *
 * Aborting (opts.signal) rejects with the signal's reason (an AbortError by default) and
 * makes no further reads.
 */
import { budgetFor } from './budgets';
import { detectConcepts } from './concepts';
import { buildDiagrams, illustrateDefaults } from './diagrams';
import { runPlan } from './planner';
import { buildText } from './text';
import { KAMI_VERSION, type Budget, type ExplainFn, type ExplainPosition, type Explanation, type Prober, type Question } from './types';

export * from './types';
export { searchProber } from './searchProber';
export { buildLmPrompt, LM_SYSTEM } from './prompt';
export { budgetFor } from './budgets';
export { ILLUSTRATE_DEFAULTS, verifyDiagram, staticChecks, type DiagramSpec } from './illustrate';
export { illustrateDefaults } from './diagrams';

export const explain: ExplainFn = (pos, question, prober, opts) => explainWithBudget(pos, question, prober, budgetFor(opts.model, opts.thinking), opts);

/** explain with an explicit budget (the bench and the task factory try other budgets). */
export async function explainWithBudget(pos: ExplainPosition, question: Question, prober: Prober, budget: Budget, opts: Parameters<ExplainFn>[3]): Promise<Explanation> {
  const f = await runPlan(pos, question, prober, budget, { signal: opts.signal, onThought: opts.onThought });
  const concepts = detectConcepts(f);
  const text = buildText(f, concepts);
  // A diagram of the idea on its own, after the answer's own reads (it has its own time cap).
  const defaults = illustrateDefaults(opts.model, opts.thinking);
  // The tier decides whether there is a diagram (none for Hane or thinking off/low); settings tune it.
  const io = opts.illustrate === false || !defaults ? null : { ...defaults, ...(opts.illustrate ?? {}) };
  let illustrations: Explanation['illustrations'];
  const extra = { reads: 0, visits: 0, ms: 0 };
  if (io && f.root) {
    const d = await buildDiagrams(f, prober, io, { signal: opts.signal, onThought: opts.onThought, examplesFor: opts.examplesFor, concepts: concepts.map((c) => c.id) });
    Object.assign(extra, { reads: d.reads, visits: d.visits, ms: d.ms });
    if (d.illustrations.length) {
      illustrations = d.illustrations;
      text.facts.push(...d.facts);
      if (d.section) text.sections.push(d.section);
    }
  }
  return {
    position: pos,
    model: opts.model,
    version: KAMI_VERSION,
    thinking: opts.thinking,
    question,
    summary: text.summary,
    sections: text.sections,
    facts: text.facts,
    concepts,
    variations: f.variations,
    ...(illustrations ? { illustrations } : {}),
    thoughts: f.thoughts,
    reads: f.reads + extra.reads,
    totalVisits: f.visits + extra.visits,
    ms: f.ms + extra.ms,
  };
}
