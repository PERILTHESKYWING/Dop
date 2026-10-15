/** One question to one answer: route it, read the position with the engine, word it. */
import type { ConceptEntry } from '../../../src/lib/coach/library';
import type { ExplainFn, Prober, ThinkingLevel, ThoughtStep } from '../../../src/lib/coach/explain/types';
import type { BoardState } from './position';
import { askFor, routeQuestion } from './question';
import type { Answer } from './store';
import { expandConcept, pickById, writeAnswer, type PickId, type WriterDeps } from './writer';

/** Settle as soon as `signal` aborts (Stop is instant even while the engine finishes a read). */
export function untilAborted<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('stopped', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('stopped', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export interface AnswerDeps extends Omit<WriterDeps, 'signal'> {
  explain: ExplainFn;
  getProber: () => Promise<Prober>;
  findConcepts: (text: string) => ConceptEntry[];
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
  const explanation = await deps.explain(pos, question, prober, { model: pickById(pick).model, thinking, signal, onThought: ev.onThought });
  if (signal?.aborted) throw new DOMException('stopped', 'AbortError');
  if (pick === 'myoshu' || pick === 'local') ev.onStage?.('writing');
  const writing = await writeAnswer(explanation, pick, { ...deps, signal });
  return { type: 'explain', explanation, writing, upTo };
}
