/** The site's side of `kami-write` (shared/kami.ts): one POST to /api/llm per answer, Myoshu only. */
import type { KamiWriteKind, KamiWriteResponse } from '../../../shared/kami';

/** No model on this server (no key, or a static host without /api). The answer uses engine text. */
export class LlmUnavailable extends Error {}

export type CallLlm = (req: { kind: KamiWriteKind; prompt: string }, signal?: AbortSignal) => Promise<KamiWriteResponse>;

export const callKamiWrite: CallLlm = async (req, signal) => {
  let res: Response;
  try {
    res = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'kami-write', ...req }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new LlmUnavailable('could not reach /api/llm');
  }
  const body = (await res.json().catch(() => null)) as (KamiWriteResponse & { error?: string }) | null;
  if (res.status === 503 || res.status === 404 || res.status === 405 || !body) throw new LlmUnavailable(body?.error ?? `HTTP ${res.status}`);
  if (!res.ok || typeof body.text !== 'string') throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
};

/** Whether /api/llm has a key (a status GET; no model call). Null when unknown. */
export async function llmConfigured(): Promise<boolean | null> {
  try {
    const res = await fetch('/api/llm', { headers: { accept: 'application/json' } });
    const body = (await res.json()) as { configured?: boolean };
    return typeof body.configured === 'boolean' ? body.configured : null;
  } catch {
    return null;
  }
}
