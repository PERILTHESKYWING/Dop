/** One question to one answer: route it, read the position with the engine, word it. */
import { verifyDiagram } from '../../../src/lib/coach/explain/illustrate';
import { illustrateDefaults } from '../../../src/lib/coach/explain/diagrams';
import { conceptById, type ConceptEntry } from '../../../src/lib/coach/library';
import type { ExplainFn, IllustrateOptions, Prober, StudentProfile, ThinkingLevel, ThoughtStep } from '../../../src/lib/coach/explain/types';
import type { BoardState } from './position';
import { askFor, routeQuestion } from './question';
import type { Answer } from './store';
import { expandConcept, pickById, writeAnswer, type PickId, type WriterDeps } from './writer';

export { untilAborted } from './untilAborted';

export interface AnswerDeps extends Omit<WriterDeps, 'signal'> {
  explain: ExplainFn;
  getProber: () => Promise<Prober>;
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
    const expansion = await expandConcept(route.entries[0], text, deps.callLlm, signal);
    return { type: 'concept', ids, expansion };
  }
  const { pos, question, upTo } = askFor(board, route.parsed);
  ev.onStage?.('engine');
  const prober = await deps.getProber();
  if (signal?.aborted) throw new DOMException('stopped', 'AbortError');
  ev.onStage?.('thinking');
  const model = pickById(pick).model;
  const settings = deps.illustrate?.() ?? {};
  const examplesFor = (id: string) => conceptById(id)?.examples ?? [];
  const student = deps.student?.();
  const explanation = await deps.explain(pos, question, prober, { model, thinking, signal, onThought: ev.onThought, illustrate: settings, examplesFor, ...(student ? { student } : {}) });
  if (signal?.aborted) throw new DOMException('stopped', 'AbortError');
  if (pick === 'myoshu' || pick === 'local') ev.onStage?.('writing');
  const checkOpts: Partial<IllustrateOptions> = { ...(illustrateDefaults(model, thinking) ?? illustrateDefaults('tesuji', 'medium')!), ...(settings || {}) };
  const verify = settings === false || deps.writerDiagrams?.() === false ? undefined : (spec: Parameters<typeof verifyDiagram>[0], id: string) => verifyDiagram(spec, prober, id, checkOpts, signal);
  const writing = await writeAnswer(explanation, pick, { ...deps, signal, verifyDiagram: verify, level: student?.level });
  if (writing.diagram) {
    explanation.illustrations = [...(explanation.illustrations ?? []), writing.diagram.illustration];
    explanation.facts = [...explanation.facts, ...writing.diagram.facts];
  }
  return { type: 'explain', explanation, writing, upTo };
}
