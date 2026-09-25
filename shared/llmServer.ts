/**
 * Server-side LLM call. Runs only in the serverless function (and the Vite dev
 * middleware). The API key comes from environment variables and never leaves here.
 *
 * Google retires Gemini model ids for new keys and the popular ones often answer
 * 503 "high demand", so every request walks a chain of models, retries overloads
 * with a short backoff, and stops at a total time budget that fits the function limit.
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

export interface CallOptions {
  /** Total time budget for the whole request, in ms. */
  budgetMs?: number;
  /** Timeout for one model attempt, in ms. */
  attemptMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const MAX_BODY = 250_000;
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';

export interface GenerateResult {
  ok: boolean;
  text?: string;
  model?: string;
  errors: string[];
  ms: number;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  modelVersion?: string;
  error?: { code?: number; message?: string };
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function redact(s: string, key: string) {
  return key.length >= 8 ? s.split(key).join('***') : s;
}

/**
 * Generate JSON text with the first model in the chain that answers. Overloaded
 * models (429/500/503) are retried once after a short pause, retired ids (404) are
 * skipped, and a 400 about the thinking settings is retried without them.
 */
export async function generateJson(
  prompt: { system: string; user: string; maxOutputTokens?: number },
  env: Record<string, string | undefined>,
  fetchImpl: FetchLike,
  opts: CallOptions = {},
): Promise<GenerateResult> {
  const cfg = resolveLlmConfig(env);
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const start = now();
  const deadline = start + (opts.budgetMs ?? 52_000);
  const errors: string[] = [];
  for (const model of cfg.models) {
    let thinking = true;
    for (let attempt = 0; attempt < 3; attempt++) {
      const left = deadline - now();
      if (left < 2500) {
        errors.push('stopped: time budget used up');
        return { ok: false, errors, ms: now() - start };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(opts.attemptMs ?? 30_000, left - 500));
      try {
        const generationConfig: Record<string, unknown> = {
          responseMimeType: 'application/json',
          temperature: 0.3,
          maxOutputTokens: prompt.maxOutputTokens ?? 8192,
        };
        // Low thinking keeps answers fast and stops the thinking tokens from eating the output budget.
        if (thinking) generationConfig.thinkingConfig = { thinkingLevel: 'low' };
        const res = await fetchImpl(`${ENDPOINT}${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: prompt.system }] },
            contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
            generationConfig,
          }),
          signal: controller.signal,
        });
        if (res.ok) {
          const data = (await res.json()) as GeminiResponse;
          const cand = data.candidates?.[0];
          const text = cand?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('') ?? '';
          if (!text.trim()) {
            errors.push(`${model}: empty answer (${cand?.finishReason ?? 'no candidate'})`);
            break;
          }
          return { ok: true, text, model: data.modelVersion || model, errors, ms: now() - start };
        }
        const body = redact((await res.text().catch(() => '')).slice(0, 400), cfg.key);
        const message = (safeJson(body) as GeminiResponse | null)?.error?.message ?? body;
        const short = message.replace(/\s+/g, ' ').slice(0, 160);
        if (res.status === 400 && thinking && /think/i.test(message)) {
          thinking = false;
          continue;
        }
        errors.push(`${model}: HTTP ${res.status} ${short}`);
        // A bad or unauthorised key fails the same way on every model.
        if (res.status === 401 || res.status === 403 || (res.status === 400 && /api key/i.test(message))) {
          return { ok: false, errors, ms: now() - start };
        }
        if (res.status === 429 || res.status === 500 || res.status === 503) {
          if (attempt === 0) {
            await sleep(Math.min(1200, Math.max(0, deadline - now() - 3000)));
            continue;
          }
        }
        break; // 404 (retired id), other 4xx, or a second overload: next model
      } catch (e) {
        const name = (e as Error).name;
        errors.push(`${model}: ${name === 'AbortError' ? 'timed out' : redact((e as Error).message, cfg.key)}`);
        break;
      } finally {
        clearTimeout(timer);
      }
    }
  }
  return { ok: false, errors, ms: now() - start };
}

export async function handleLlmRequest(
  method: string,
  rawBody: string | undefined,
  env: Record<string, string | undefined>,
  fetchImpl: FetchLike,
  query: Record<string, string | undefined> = {},
  opts: CallOptions = {},
): Promise<LlmHttpResult> {
  const cfg = resolveLlmConfig(env);
  if (method === 'GET') {
    const base = { configured: cfg.configured, provider: cfg.provider, model: cfg.models[0], models: cfg.models };
    if (!query.test) return { status: 200, body: base };
    if (!cfg.configured) return { status: 200, body: { ...base, test: { ok: false, errors: ['LLM_API_KEY is not set on the server.'] } } };
    // Live check: a tiny request through the same model chain.
    const r = await generateJson({ system: 'Answer with JSON only.', user: 'Return {"ok":true}', maxOutputTokens: 256 }, env, fetchImpl, { budgetMs: 25_000, attemptMs: 12_000, ...opts });
    return { status: 200, body: { ...base, test: { ok: r.ok, model: r.model, ms: r.ms, errors: r.errors } } };
  }
  if (method !== 'POST') return { status: 405, body: { error: 'method not allowed' } };
  if (!cfg.configured) return { status: 503, body: { error: 'The LLM is not configured on the server: set LLM_API_KEY in the host environment variables and redeploy.' } };
  if (!rawBody || rawBody.length > MAX_BODY) return { status: 413, body: { error: 'request too large or empty' } };
  const req = safeJson(rawBody) as DiscoveryRequest | null;
  if (!req || req.task !== 'discover-patterns' || !Array.isArray(req.clusters) || !req.player) {
    return { status: 400, body: { error: 'invalid request' } };
  }
  if (req.clusters.length > 20) req.clusters = req.clusters.slice(0, 20);

  const r = await generateJson({ system: SYSTEM_PROMPT, user: buildUserPrompt(req) }, env, fetchImpl, opts);
  if (!r.ok || !r.text) {
    const overloaded = r.errors.some((e) => /HTTP (429|503)/.test(e));
    return {
      status: 502,
      body: {
        error: overloaded ? 'Google says its Gemini models are overloaded right now. Try again in a minute.' : 'The Gemini call failed.',
        details: r.errors,
      },
    };
  }
  const { patterns, rejected } = validatePatterns(r.text, req);
  const body: DiscoveryResponse = { patterns, model: r.model ?? 'gemini', rejected };
  return { status: 200, body };
}
