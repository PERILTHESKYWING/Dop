/**
 * Kami's serverless function (Vercel project with Root Directory = kami): the same handler as
 * Dop's api/llm.ts. POST {task:'kami-write', ...} is Myoshu's one call per answer.
 * LLM_API_KEY, LLM_MODEL and LLM_PROVIDER are read from the server environment only.
 *
 * Two speed-ups, no new infrastructure: an identical kami-write request answered in the last
 * few minutes by this warm instance is served from memory (no model call), and a browser that
 * goes away (Stop, a new question) aborts the model call instead of letting it run on.
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleLlmRequest, type LlmHttpResult } from '../../shared/llmServer.js';

export const config = { maxDuration: 60 };

const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 64;
const cache = new Map<string, { at: number; result: LlmHttpResult }>();

/** The cache key of a kami-write body, or null for every other request (never cached). */
export function cacheKey(body: string | undefined): { key: string; fresh: boolean } | null {
  if (!body || !body.includes('"kami-write"')) return null;
  try {
    const r = JSON.parse(body) as { task?: string; kind?: string; prompt?: string; fresh?: boolean };
    if (r.task !== 'kami-write' || typeof r.prompt !== 'string') return null;
    return { key: createHash('sha256').update(`${r.kind ?? 'explain'}\n${r.prompt}`).digest('base64url'), fresh: r.fresh === true };
  } catch {
    return null;
  }
}

export function cacheGet(key: string, now = Date.now()): LlmHttpResult | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.result;
}

export function cachePut(key: string, result: LlmHttpResult, now = Date.now()) {
  if (result.status !== 200) return;
  cache.delete(key);
  cache.set(key, { at: now, result });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}

async function readBody(req: IncomingMessage & { body?: unknown }): Promise<string> {
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 300_000) break;
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  const body = req.method === 'POST' ? await readBody(req) : undefined;
  const url = new URL(req.url ?? '/', 'http://localhost');
  const c = req.method === 'POST' ? cacheKey(body) : null;
  // Regenerate (fresh) skips the lookup; its new answer then replaces the cached one.
  let result = c && !c.fresh ? cacheGet(c.key) : null;
  if (!result) {
    // The browser left (Stop, or the student moved on): stop the model call too.
    const gone = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) gone.abort();
    });
    const fetchGone = ((input: string, init: RequestInit & { signal?: AbortSignal }) => {
      // Gone already: the rest of the model chain makes no request at all.
      if (gone.signal.aborted) return Promise.reject(new DOMException('client closed', 'AbortError'));
      return fetch(input, { ...init, signal: init.signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([init.signal, gone.signal]) : (init.signal ?? gone.signal) });
    }) as never;
    result = await handleLlmRequest(req.method ?? 'GET', body, process.env, fetchGone, Object.fromEntries(url.searchParams));
    if (c) cachePut(c.key, result);
  }
  res.statusCode = result.status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(result.body));
}
