/** One question to one answer: route it, read the position with the engine, word it. */
import { verifyDiagram } from '../../../src/lib/coach/explain/illustrate';
import { illustrateDefaults } from '../../../src/lib/coach/explain/diagrams';
import { conceptById, type ConceptEntry } from '../../../src/lib/coach/library';
import type { ExplainFn, ExplainPosition, IllustrateOptions, Prober, StudentProfile, ThinkingLevel, ThoughtStep } from '../../../src/lib/coach/explain/types';
import { locToGtp } from '../../../src/lib/go/coords';
import type { BoardState } from './position';
import { askFor, routeQuestion } from './question';
import type { Answer } from './store';
import { expandConcept, NOTES, pickById, writeAnswer, type PickId, type WriterDeps } from './writer';

import { untilAborted } from './untilAborted';

export { untilAborted };

/** The quick first read an answer shows while KataGo reads deeper (the deep read continues its tree). */
export const QUICK_VISITS = 32;
const QUICK_MS = 2500;

/**
 * A first useful line within seconds: KataGo's first choice from a quick read (or the board's
 * read, when it already has one), shown as a live thinking step while the full read runs.
 * Numbers only from KataGo; any failure here just skips the step.
 */
async function quickLook(prober: Prober, pos: ExplainPosition, onThought: (t: ThoughtStep) => void, signal?: AbortSignal): Promise<void> {
  if (typeof prober.read !== 'function') return;
  const t0 = Date.now();
  try {
    const read = prober.read(pos, { visits: QUICK_VISITS, maxMs: QUICK_MS });
    const r = signal ? await untilAborted(read, signal) : await read;
    const best = r?.candidates[0];
    if (!r || !best || signal?.aborted) return;
    const side = pos.toPlay === 1 ? 'Black' : 'White';
    const lead = best.scoreLead;
    const score = Math.abs(lead) < 0.5 ? 'about even' : `${side} ${lead > 0 ? 'ahead' : 'behind'} by about ${Math.abs(lead).toFixed(1)} points`;
    onThought({ text: `Quick look → KataGo's first choice is ${locToGtp(best.loc, pos.size)} (${score}). Reading deeper…`, ms: Date.now() - t0, visits: r.visits });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
  }
}

export interface AnswerDeps extends Omit<WriterDeps, 'signal'> {
  explain: ExplainFn;
  /** The engine for this answer; `signal` is the answer's Stop. */
  getProber: (signal?: AbortSignal) => Promise<Prober>;
  findConcepts: (text: string) => ConceptEntry[];
  /** Diagram settings (Kami's Settings: minimum winrate, reads); false turns diagrams off. */
  illustrate?: () => Partial<IllustrateOptions> | false;
  /** False: a diagram the writer sketches is dropped unchecked (Settings › Positions). */
  writerDiagrams?: () => boolean;
  /** Who is asking (Settings › Profile and the style Kami learned), read at ask time. */
  student?: () => StudentProfile;
}

export interface AnswerEvents {
  /** 'engine' while KataGo loads, 'thinking' while it reads, 'writing' while a model words it. */
  onStage?: (stage: 'engine' | 'thinking' | 'writing') => void;
  onThought?: (t: ThoughtStep) => void;
  /**
   * The engine's own answer, as soon as it is ready and before a model words it (Myoshu, Local):
   * the student reads it at once and the checked wording replaces it when it arrives.
   */
  onDraft?: (a: Answer) => void;
}

export async function answerQuestion(
  text: string,
  board: BoardState,
  pick: PickId,
  thinking: ThinkingLevel,
  deps: AnswerDeps,
  ev: AnswerEvents = {},
  signal?: AbortSignal,
): Promise<Answer> {
  const route = routeQuestion(text, board, deps.findConcepts);
  if (route.type === 'concept') {
    const ids = route.entries.map((e) => e.id);
    if (pick !== 'myoshu' || !route.entries.length) return { type: 'concept', ids };
    ev.onStage?.('writing');
    ev.onDraft?.({ type: 'concept', ids });
    const expansion = await expandConcept(route.entries[0], text, deps.callLlm, signal, deps.fresh);
    return { type: 'concept', ids, expansion };
  }
  const { pos, question, upTo } = askFor(board, route.parsed);
  ev.onStage?.('engine');
  const prober = await deps.getProber(signal);
  if (signal?.aborted) throw new DOMException('stopped', 'AbortError');
  ev.onStage?.('thinking');
  if (ev.onThought) await quickLook(prober, pos, ev.onThought, signal);
  const model = pickById(pick).model;
  const settings = deps.illustrate?.() ?? {};
  const examplesFor = (id: string) => conceptById(id)?.examples ?? [];
  const student = deps.student?.();
  const explanation = await deps.explain(pos, question, prober, { model, thinking, signal, onThought: ev.onThought, illustrate: settings, examplesFor, ...(student ? { student } : {}) });
  if (signal?.aborted) throw new DOMException('stopped', 'AbortError');
  if (pick === 'myoshu' || pick === 'local') {
    ev.onStage?.('writing');
    ev.onDraft?.({ type: 'explain', explanation, writing: { by: 'engine', note: pick === 'local' ? NOTES.polishingLocal : NOTES.polishing }, upTo });
  }
  const checkOpts: Partial<IllustrateOptions> = { ...(illustrateDefaults(model, thinking) ?? illustrateDefaults('tesuji', 'medium')!), ...(settings || {}) };
  const verify = settings === false || deps.writerDiagrams?.() === false ? undefined : (spec: Parameters<typeof verifyDiagram>[0], id: string) => verifyDiagram(spec, prober, id, checkOpts, signal);
  const writing = await writeAnswer(explanation, pick, { ...deps, signal, verifyDiagram: verify, level: student?.level });
  if (writing.diagram) {
    explanation.illustrations = [...(explanation.illustrations ?? []), writing.diagram.illustration];
    explanation.facts = [...explanation.facts, ...writing.diagram.facts];
  }
  return { type: 'explain', explanation, writing, upTo };
}
