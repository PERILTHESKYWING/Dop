import type { AskResponse, AskTurn, PositionFacts, ProbeRequest, ProbeResult } from '../../../shared/ask';

export interface AskOutcome {
  answer: string;
  /** Figures the checker could not find in KataGo's facts. */
  unsupported: string[];
  /** Lines KataGo checked for this answer. */
  probes: ProbeResult[];
  model?: string;
}

type Post = (body: unknown) => Promise<AskResponse>;

async function postAsk(body: unknown): Promise<AskResponse> {
  const res = await fetch('/api/llm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) throw new Error('this host has no /api/llm function');
  const j = (await res.json()) as AskResponse & { error?: string };
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j;
}

/**
 * Ask a question about a position. The model may ask KataGo to check up to three lines
 * first (`runProbe` searches them); the second round must answer.
 */
export async function askPosition(
  question: string,
  facts: PositionFacts,
  runProbe: (p: ProbeRequest) => Promise<ProbeResult>,
  history: AskTurn[] = [],
  post: Post = postAsk,
): Promise<AskOutcome> {
  const first = await post({ task: 'ask-position', question, facts, history });
  if (first.answer) return { answer: first.answer, unsupported: first.unsupported ?? [], probes: [], model: first.model };
  const probes: ProbeResult[] = [];
  for (const p of first.probes ?? []) probes.push(await runProbe(p));
  const second = await post({ task: 'ask-position', question, facts, history, probes, final: true });
  if (!second.answer) throw new Error('the model gave no answer');
  return { answer: second.answer, unsupported: second.unsupported ?? [], probes, model: second.model };
}
