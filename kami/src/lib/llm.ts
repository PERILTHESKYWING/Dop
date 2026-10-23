/** The site's side of `kami-write` (shared/kami.ts): one POST to /api/llm per answer, Myoshu only. */
import type { KamiWriteKind, KamiWriteResponse } from '../../../shared/kami';

/** No model on this server (no key, or a static host without /api). The answer uses engine text. */
export class LlmUnavailable extends Error {}

/** `fresh`: Regenerate, so skip every cache (this tab's and the server's) and ask the model again. */
export type CallLlm = (req: { kind: KamiWriteKind; prompt: string; fresh?: boolean }, signal?: AbortSignal) => Promise<LlmReply>;

/**
 * A reply plus the writer's verdict on it. `accept` after the wording passes the fact check
 * (only then is it cached); `reject` when it fails, so the next identical ask goes to the
 * model again, past the server's cache too. Neither: nothing is kept.
 */
export interface LlmReply extends KamiWriteResponse {
  accept?: () => void;
  reject?: () => void;
}

/**
 * Identical requests (same kind, same prompt: the same engine read) are answered from this tab's
 * cache, in memory and in sessionStorage, so asking again costs no model call and no wait.
 * Only good answers are kept; errors always go back to the server.
 */
const MEM_MAX = 40;
const SS_PREFIX = 'kiai.llm.';
const mem = new Map<string, KamiWriteResponse>();
/** Requests whose last wording failed the fact check: the next ask is fresh. */
const rejected = new Set<string>();

/** FNV-1a over the request, two 32-bit lanes: a short, stable key (not a security hash). */
export function requestKey(req: { kind: KamiWriteKind; prompt: string }): string {
  const s = `${req.kind}\n${req.prompt}`;
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}${s.length.toString(36)}`;
}

function cached(key: string): KamiWriteResponse | null {
  const hit = mem.get(key);
  if (hit) return hit;
  try {
    const raw = sessionStorage.getItem(SS_PREFIX + key);
    const r = raw ? (JSON.parse(raw) as KamiWriteResponse) : null;
    if (r && typeof r.text === 'string') {
      mem.set(key, r);
      return r;
    }
  } catch {
    /* no storage here */
  }
  return null;
}

function remember(key: string, r: KamiWriteResponse) {
  mem.set(key, r);
  while (mem.size > MEM_MAX) mem.delete(mem.keys().next().value!);
  try {
    sessionStorage.setItem(SS_PREFIX + key, JSON.stringify(r));
    const keys = Object.keys(sessionStorage).filter((k) => k.startsWith(SS_PREFIX));
    // Keep the newest ones that are still in memory; drop the rest (a tab's worth, not a history).
    if (keys.length > MEM_MAX) for (const k of keys) if (!mem.has(k.slice(SS_PREFIX.length))) sessionStorage.removeItem(k);
  } catch {
    /* full or blocked: memory only */
  }
}

function forget(key: string) {
  mem.delete(key);
  try {
    sessionStorage.removeItem(SS_PREFIX + key);
  } catch {
    /* no storage */
  }
}

/** Forget every cached answer (tests). */
export function clearLlmCache() {
  mem.clear();
  rejected.clear();
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(SS_PREFIX)) sessionStorage.removeItem(k);
  } catch {
    /* no storage */
  }
}

export const callKamiWrite: CallLlm = async (req, signal) => {
  const key = requestKey(req);
  const fresh = req.fresh || rejected.has(key);
  const hit = fresh ? null : cached(key);
  if (hit) return { ...hit };
  let res: Response;
  try {
    res = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'kami-write', kind: req.kind, prompt: req.prompt, ...(fresh ? { fresh: true } : {}) }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new LlmUnavailable('could not reach /api/llm');
  }
  const body = (await res.json().catch(() => null)) as (KamiWriteResponse & { error?: string }) | null;
  if (res.status === 503 || res.status === 404 || res.status === 405 || !body) throw new LlmUnavailable(body?.error ?? `HTTP ${res.status}`);
  if (!res.ok || typeof body.text !== 'string') throw new Error(body.error ?? `HTTP ${res.status}`);
  const out: KamiWriteResponse = { text: body.text, ...(body.model ? { model: body.model } : {}) };
  return {
    ...out,
    accept: () => {
      rejected.delete(key);
      remember(key, out);
    },
    reject: () => {
      rejected.add(key);
      forget(key);
    },
  };
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
