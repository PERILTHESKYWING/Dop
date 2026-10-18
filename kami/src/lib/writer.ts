/**
 * Who words the answer. Hane and Tesuji use the engine's own text. Myoshu makes one LLM call
 * (kami-write) and Kami Local runs the small model in the browser; both answers must pass
 * checkAnswer, otherwise the engine's text is shown with a short note. The engine's text is
 * always there, so every tier works with no LLM.
 */
import type { AnswerScore } from '../../../src/lib/coach/answerCheck';
import type { ConceptEntry } from '../../../src/lib/coach/library';
import type { DiagramSpec, Verified } from '../../../src/lib/coach/explain/illustrate';
import { buildLmPrompt, nextDiagramId } from '../../../src/lib/coach/explain/prompt';
import { MODELS, type Explanation, type Fact, type Illustration, type ModelId, type ThinkingLevel } from '../../../src/lib/coach/explain/types';
import { dropDiagramRefs, parseWriterDiagram } from '../../../src/lib/coach/explain/writerDiagram';
import { hasCoordinates } from '../../../shared/kami';
import { LlmUnavailable, type CallLlm } from './llm';

/** What the picker offers: Kami's three tiers, and Kami Local when it is configured. */
export type PickId = ModelId | 'local';

export interface Tier {
  id: PickId;
  name: string;
  blurb: string;
  /** The planner the engine runs for this pick. */
  model: ModelId;
  defaultThinking: ThinkingLevel;
}

export const LOCAL_PICK: Tier = { id: 'local', name: 'Night Dive', blurb: 'Beta. Kiai’s own small model, on this device.', model: 'tesuji', defaultThinking: 'medium' };

export function picks(withLocal: boolean): Tier[] {
  const tiers: Tier[] = MODELS.map((m) => ({ id: m.id, name: m.name, blurb: m.blurb, model: m.id, defaultThinking: m.defaultThinking }));
  return withLocal ? [...tiers, LOCAL_PICK] : tiers;
}

export const pickById = (id: PickId): Tier => (id === 'local' ? LOCAL_PICK : picks(false).find((p) => p.id === id) ?? picks(false)[1]);

export interface Writing {
  /** The model's checked text; absent = show the engine's summary and sections. */
  text?: string;
  by: 'engine' | 'gemini' | 'local';
  /** Short note under the answer (why the engine's text is shown). */
  note?: string;
  model?: string;
  score?: Pick<AnswerScore, 'truth' | 'coverage' | 'depth'>;
  /** The writer's own diagram, when it asked for one and every check passed (add it to the explanation). */
  diagram?: { illustration: Illustration; facts: Fact[] };
  /** Why the writer's diagram was left out. */
  diagramNote?: string;
}

export interface WriterDeps {
  callLlm: CallLlm;
  checkAnswer: (ex: Explanation, text: string) => AnswerScore;
  localWrite?: (prompt: string, signal?: AbortSignal) => Promise<string>;
  /** Checks a diagram the writer asked for (illustrate.ts, KataGo's final read last). Absent: such diagrams are dropped. */
  verifyDiagram?: (spec: DiagramSpec, id: string) => Promise<Verified>;
  signal?: AbortSignal;
  /** The student's level (Settings › Profile), passed to the writer's prompt. */
  level?: string;
}

const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError';

export const NOTES = {
  unchecked: 'Wording unchecked, showing engine text.',
  failed: 'Wording failed the fact check, showing engine text.',
  noLlm: 'No language model on this server, showing engine text.',
  llmError: 'The language model did not answer, showing engine text.',
  localError: 'Night Dive could not run here, showing engine text.',
} as const;

/**
 * The writer's own DIAGRAM block: parsed, checked (KataGo last) and kept, or removed together
 * with every sentence that refers to it. Returns the explanation the text is checked against.
 */
export async function writerDiagram(ex: Explanation, text: string, deps: Pick<WriterDeps, 'verifyDiagram'>): Promise<{ ex: Explanation; text: string; diagram?: Writing['diagram']; note?: string }> {
  const id = nextDiagramId(ex);
  const parsed = parseWriterDiagram(text, ex.position.size);
  if (!parsed.found) return { ex, text: dropDiagramRefs(text, id) };
  const drop = (note: string) => ({ ex, text: dropDiagramRefs(parsed.text, id), note });
  if (!parsed.spec) return drop(`The diagram the writer asked for was left out: ${parsed.error}.`);
  if (!deps.verifyDiagram) return drop('The diagram the writer asked for was left out: no engine to check it.');
  const v = await deps.verifyDiagram(parsed.spec, id);
  if (!v.illustration) {
    const failed = v.checks.find((c) => !c.ok);
    return drop(`The diagram the writer asked for failed a check (${failed?.detail ?? 'unknown'}), so it was left out.`);
  }
  const diagram = { illustration: v.illustration, facts: v.facts };
  return { ex: { ...ex, illustrations: [...(ex.illustrations ?? []), v.illustration], facts: [...ex.facts, ...v.facts] }, text: parsed.text, diagram };
}

/** Gate a model's text: it passes checkAnswer, or the engine's text is shown. */
function gate(ex: Explanation, text: string, by: 'gemini' | 'local', check: WriterDeps['checkAnswer'], model?: string): Writing {
  let score: AnswerScore;
  try {
    score = check(ex, text);
  } catch {
    return { by: 'engine', note: NOTES.unchecked };
  }
  if (!score.pass) return { by: 'engine', note: NOTES.failed };
  return { by, text, model, score: { truth: score.truth, coverage: score.coverage, depth: score.depth } };
}

export async function writeAnswer(ex: Explanation, pick: PickId, deps: WriterDeps): Promise<Writing> {
  if (pick === 'hane' || pick === 'tesuji') return { by: 'engine' };
  const prompt = buildLmPrompt(ex, deps.level);
  /** Check the writer's diagram (if any), then gate the text against the explanation with it. */
  const finish = async (raw: string, by: 'gemini' | 'local', model?: string): Promise<Writing> => {
    const d = await writerDiagram(ex, raw, deps);
    const w = gate(d.ex, d.text, by, deps.checkAnswer, model);
    if (w.by !== 'engine' && d.diagram) w.diagram = d.diagram;
    if (d.note) w.diagramNote = d.note;
    return w;
  };
  if (pick === 'local') {
    if (!deps.localWrite) return { by: 'engine', note: NOTES.localError };
    try {
      return await finish(await deps.localWrite(prompt, deps.signal), 'local', 'kami-local');
    } catch (e) {
      if (isAbort(e)) throw e;
      return { by: 'engine', note: NOTES.localError };
    }
  }
  try {
    const r = await deps.callLlm({ kind: 'explain', prompt }, deps.signal);
    return await finish(r.text, 'gemini', r.model);
  } catch (e) {
    if (isAbort(e)) throw e;
    return { by: 'engine', note: e instanceof LlmUnavailable ? NOTES.noLlm : NOTES.llmError };
  }
}

/** The library entry as the concept writer's input (no examples: they carry coordinates). */
export function conceptPrompt(entry: ConceptEntry, question: string): string {
  const out = [`Student's question: ${question.trim()}`, '', `Concept: ${entry.name} (${entry.level})`, `Short answer: ${entry.short}`];
  for (const s of entry.body) out.push('', `${s.title}: ${s.text}`);
  if (entry.mistakes.length) out.push('', 'Common mistakes:', ...entry.mistakes.map((m) => `- ${m}`));
  return out.join('\n');
}

export interface Expansion {
  text?: string;
  note?: string;
  model?: string;
}

/** Myoshu on a concept question: one call may go deeper than the entry; any board coordinate rejects it. */
export async function expandConcept(entry: ConceptEntry, question: string, callLlm: CallLlm, signal?: AbortSignal): Promise<Expansion> {
  try {
    const r = await callLlm({ kind: 'concept', prompt: conceptPrompt(entry, question) }, signal);
    if (hasCoordinates(r.text)) return { note: 'The extra wording named board points, so it was left out.' };
    return { text: r.text, model: r.model };
  } catch (e) {
    if (isAbort(e)) throw e;
    return { note: e instanceof LlmUnavailable ? 'No language model on this server; this is the library entry.' : 'The language model did not answer; this is the library entry.' };
  }
}
