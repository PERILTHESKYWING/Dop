/**
 * Who words the answer. Hane and Tesuji use the engine's own text. Myoshu makes one LLM call
 * (kami-write) and Kami Local runs the small model in the browser; both answers must pass
 * checkAnswer, otherwise the engine's text is shown with a short note. The engine's text is
 * always there, so every tier works with no LLM.
 */
import type { AnswerScore } from '../../../src/lib/coach/answerCheck';
import type { ConceptEntry } from '../../../src/lib/coach/library';
import { buildLmPrompt } from '../../../src/lib/coach/explain/prompt';
import { MODELS, type Explanation, type ModelId, type ThinkingLevel } from '../../../src/lib/coach/explain/types';
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

export const LOCAL_PICK: Tier = { id: 'local', name: 'Kami Local', blurb: 'Beta. Kami’s own small model, on this device.', model: 'tesuji', defaultThinking: 'medium' };

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
}

export interface WriterDeps {
  callLlm: CallLlm;
  checkAnswer: (ex: Explanation, text: string) => AnswerScore;
  localWrite?: (prompt: string, signal?: AbortSignal) => Promise<string>;
  signal?: AbortSignal;
}

const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError';

export const NOTES = {
  unchecked: 'Wording unchecked, showing engine text.',
  failed: 'Wording failed the fact check, showing engine text.',
  noLlm: 'No language model on this server, showing engine text.',
  llmError: 'The language model did not answer, showing engine text.',
  localError: 'Kami Local could not run here, showing engine text.',
} as const;

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
  const prompt = buildLmPrompt(ex);
  if (pick === 'local') {
    if (!deps.localWrite) return { by: 'engine', note: NOTES.localError };
    try {
      return gate(ex, await deps.localWrite(prompt, deps.signal), 'local', deps.checkAnswer, 'kami-local');
    } catch (e) {
      if (isAbort(e)) throw e;
      return { by: 'engine', note: NOTES.localError };
    }
  }
  try {
    const r = await deps.callLlm({ kind: 'explain', prompt }, deps.signal);
    return gate(ex, r.text, 'gemini', deps.checkAnswer, r.model);
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
