/**
 * Server-side LLM call. Runs only in the serverless function (and the Vite dev
 * middleware). The API key comes from environment variables and never leaves here.
 */
import { buildUserPrompt, resolveLlmConfig, safeJson, SYSTEM_PROMPT, validatePatterns, type DiscoveryRequest, type DiscoveryResponse } from './llm.js';

export interface LlmHttpResult {
  status: number;
  body: unknown;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

const MAX_BODY = 250_000;

export async function handleLlmRequest(method: string, rawBody: string | undefined, env: Record<string, string | undefined>, fetchImpl: FetchLike): Promise<LlmHttpResult> {
  const cfg = resolveLlmConfig(env);
  if (method === 'GET') {
    return { status: 200, body: { configured: cfg.configured, provider: cfg.provider, model: cfg.models[0] } };
  }
  if (method !== 'POST') return { status: 405, body: { error: 'method not allowed' } };
  if (!cfg.configured) return { status: 503, body: { error: 'LLM is not configured on the server (set LLM_API_KEY and LLM_PROVIDER).' } };
  if (!rawBody || rawBody.length > MAX_BODY) return { status: 413, body: { error: 'request too large or empty' } };
  const req = safeJson(rawBody) as DiscoveryRequest | null;
  if (!req || req.task !== 'discover-patterns' || !Array.isArray(req.clusters) || !req.player) {
    return { status: 400, body: { error: 'invalid request' } };
  }
  if (req.clusters.length > 20) req.clusters = req.clusters.slice(0, 20);

  const prompt = buildUserPrompt(req);
  const errors: string[] = [];
  for (const model of cfg.models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55_000);
    try {
      const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.3, maxOutputTokens: 4096 },
        }),
        signal: controller.signal,
      });
      if (res.status === 404) {
        errors.push(`${model}: not found`);
        continue;
      }
      if (!res.ok) {
        const text = (await res.text()).slice(0, 300);
        // Never echo anything that could contain the key.
        errors.push(`${model}: HTTP ${res.status} ${text.replace(cfg.key, '***')}`);
        if (res.status === 401 || res.status === 403) break;
        continue;
      }
      const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      const { patterns, rejected } = validatePatterns(text, req);
      const body: DiscoveryResponse = { patterns, model, rejected };
      return { status: 200, body };
    } catch (e) {
      errors.push(`${model}: ${(e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: 502, body: { error: 'LLM call failed', details: errors } };
}
