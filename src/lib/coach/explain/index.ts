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
import { runPlan } from './planner';
import { buildText } from './text';
import { KAMI_VERSION, type Budget, type ExplainFn, type ExplainPosition, type Explanation, type Prober, type Question } from './types';

export * from './types';
export { searchProber } from './searchProber';
export { buildLmPrompt, LM_SYSTEM } from './prompt';
export { budgetFor } from './budgets';

export const explain: ExplainFn = (pos, question, prober, opts) => explainWithBudget(pos, question, prober, budgetFor(opts.model, opts.thinking), opts);

/** explain with an explicit budget (the bench and the task factory try other budgets). */
export async function explainWithBudget(pos: ExplainPosition, question: Question, prober: Prober, budget: Budget, opts: Parameters<ExplainFn>[3]): Promise<Explanation> {
  const f = await runPlan(pos, question, prober, budget, { signal: opts.signal, onThought: opts.onThought });
  const concepts = detectConcepts(f);
  const text = buildText(f, concepts);
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
    thoughts: f.thoughts,
    reads: f.reads,
    totalVisits: f.visits,
    ms: f.ms,
  };
}
