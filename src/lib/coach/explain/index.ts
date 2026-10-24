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
import { conceptContext, detectConcepts } from './concepts';
import { buildDiagrams, illustrateDefaults } from './diagrams';
import { viewAround } from './effects';
import { readLifeDeath } from './lifeDeathRead';
import { runPlan } from './planner';
import { situationOf } from './situation';
import { teach } from './teach';
import { buildText, numberGuard } from './text';
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
  // Life and death is read move by move by the local reader, not judged by winrates.
  const ld = f.root ? readLifeDeath(f, concepts) : null;
  const situation = f.root && f.best ? situationOf(f, concepts, ld) : undefined;
  let view: Explanation['view'];
  let topics: string[] = [];
  if (situation && f.best) {
    // The teacher's voice over the same reads (teach.ts); text.ts's facts stay the evidence.
    const t = teach({ f, ctx: conceptContext(f), concepts, situation, facts: text.facts, student: opts.student, ld });
    text.facts.push(...t.facts);
    topics = t.topics;
    const clean = numberGuard(f, concepts, text.facts);
    const summary = clean(t.summary);
    if (summary) {
      text.summary = summary;
      text.sections = t.sections.map((s) => ({ title: s.title, text: clean(s.text) })).filter((s) => s.text);
    }
    if (situation.tsumego) {
      const pts = ld ? [...ld.target, ...ld.line, ...ld.missLine] : [];
      const best = f.variations.find((v) => v.id === f.vars.best);
      view = viewAround([...pts, ...(best?.moves.map((m) => m.loc) ?? [])], pos.size, 2);
    }
  }
  // A diagram of the idea on its own, after the answer's own reads (it has its own time cap).
  const defaults = illustrateDefaults(opts.model, opts.thinking);
  // The tier decides whether there is a diagram (none for Hane or thinking off/low); settings tune it.
  const io = opts.illustrate === false || !defaults ? null : { ...defaults, ...(opts.illustrate ?? {}) };
  let illustrations: Explanation['illustrations'];
  const extra = { reads: 0, visits: 0, ms: 0 };
  // A textbook diagram only for an idea the answer teaches (never for "explain this position"
  // or a problem, where the board itself is the diagram); the game is never cut out and framed.
  const central = topics.filter((id) => ['double-sente', 'reverse-sente', 'miai', 'sacrifice', 'ko', 'tenuki', 'reduction'].includes(id) && concepts.some((c) => c.id === id || id === 'tenuki'));
  if (io && f.root && situation && situation.tone !== 'overview' && !situation.tsumego && central.length) {
    const d = await buildDiagrams(f, prober, io, { signal: opts.signal, onThought: opts.onThought, examplesFor: opts.examplesFor, concepts: central });
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
    // The board's bar shows the answer's numbers: Black's side of KataGo's best move, the same
    // figures as "Black trails by 10.4" in the list and "about 10" in the first sentence.
    ...(f.root ? { root: { ...f.root, ...(f.best ? { bWin: f.mover === 1 ? f.best.win : 1 - f.best.win, bLead: f.mover === 1 ? f.best.lead : -f.best.lead } : {}), ownership: null, candidates: f.root.candidates.slice(0, 12).map((c) => ({ ...c, pv: c.pv.slice(0, 12) })) } } : {}),
    ...(illustrations ? { illustrations } : {}),
    ...(situation ? { situation } : {}),
    ...(view ? { view } : {}),
    ...(ld ? { lifeDeath: ld } : {}),
    thoughts: f.thoughts,
    reads: f.reads + extra.reads,
    totalVisits: f.visits + extra.visits,
    ms: f.ms + extra.ms,
  };
}
