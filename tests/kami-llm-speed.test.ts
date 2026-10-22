/** Kiai's writer path, time to first words: engine draft first, cached repeats, minimal thinking, aborts. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import handler, { cacheKey } from '../kami/api/llm';
import { answerQuestion } from '../kami/src/lib/answer';
import { callKamiWrite, clearLlmCache, requestKey } from '../kami/src/lib/llm';
import { emptyBoard, playAt } from '../kami/src/lib/position';
import { NOTES } from '../kami/src/lib/writer';
import type { Answer } from '../kami/src/lib/store';
import type { ExplainFn, Explanation, Prober } from '../src/lib/coach/explain/types';
import { gtpToLoc } from '../src/lib/go/coords';
import { handleLlmRequest } from '../shared/llmServer';

const at = (s: string) => gtpToLoc(s, 19);
const game = playAt(playAt(emptyBoard(19), at('D4'))!, at('Q16'))!;

function explanation(): Explanation {
  return {
    position: { size: 19, komi: 7.5, setup: [], moves: [], toPlay: 1 },
    model: 'myoshu',
    version: '1.0',
    thinking: 'high',
    question: { kind: 'best', text: 'What should I play?' },
    summary: 'KataGo prefers Q16 [[v1]].',
    sections: [],
    facts: [{ id: 'f1', text: "KataGo's best move is Q16." }],
    concepts: [],
    variations: [{ id: 'v1', label: 'Q16', kind: 'best', moves: [{ color: 1, loc: at('Q16') }] }],
    thoughts: [],
    reads: 1,
    totalVisits: 100,
    ms: 1000,
  };
}

const pass = () => ({ truth: 1, coverage: 1, depth: 1, unsupported: [], pass: true });
const gemini = (text: string) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }), text: async () => '' });

afterEach(() => {
  vi.unstubAllGlobals();
  clearLlmCache();
});

describe('engine text first', () => {
  it('shows the engine answer before the writer replies, then the checked wording', async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const callLlm = vi.fn(async () => {
      await slow;
      return { text: 'Q16 [[v1]] takes the corner.', model: 'g' };
    });
    const drafts: Answer[] = [];
    const done = answerQuestion('What should White play?', game, 'myoshu', 'high', { explain: (async () => explanation()) as ExplainFn, getProber: async () => ({}) as Prober, findConcepts: () => [], callLlm, checkAnswer: pass }, { onDraft: (a) => drafts.push(a) });
    await vi.waitFor(() => expect(drafts).toHaveLength(1));
    // The draft is on screen while the model has not answered yet.
    expect(drafts[0]).toMatchObject({ type: 'explain', writing: { by: 'engine', note: NOTES.polishing } });
    expect(callLlm).toHaveBeenCalledTimes(1);
    release();
    expect(await done).toMatchObject({ type: 'explain', writing: { by: 'gemini', text: 'Q16 [[v1]] takes the corner.' } });
    expect(callLlm).toHaveBeenCalledTimes(1);
  });

  it('no draft for the engine-only tiers', async () => {
    const drafts: Answer[] = [];
    await answerQuestion('What should White play?', game, 'tesuji', 'medium', { explain: (async () => explanation()) as ExplainFn, getProber: async () => ({}) as Prober, findConcepts: () => [], callLlm: vi.fn(), checkAnswer: pass }, { onDraft: (a) => drafts.push(a) });
    expect(drafts).toEqual([]);
  });
});

describe('client cache', () => {
  it('asks the server once for identical requests and again for a new prompt', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: 'A.', model: 'm' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const req = { kind: 'explain' as const, prompt: 'Facts:\n- x' };
    expect(await callKamiWrite(req)).toEqual({ text: 'A.', model: 'm' });
    expect(await callKamiWrite({ ...req })).toEqual({ text: 'A.', model: 'm' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await callKamiWrite({ ...req, prompt: 'Facts:\n- y' });
    await callKamiWrite({ ...req, kind: 'concept' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(requestKey(req)).toBe(requestKey({ ...req }));
    expect(requestKey(req)).not.toBe(requestKey({ ...req, prompt: 'Facts:\n- y' }));
  });

  it('never caches an error', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'busy' }), { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);
    const req = { kind: 'explain' as const, prompt: 'p' };
    await expect(callKamiWrite(req)).rejects.toThrow('busy');
    await expect(callKamiWrite(req)).rejects.toThrow('busy');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('survives a reload of the module memory through sessionStorage', async () => {
    const store = new Map<string, string>();
    const ss = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    vi.stubGlobal('sessionStorage', new Proxy(ss, { ownKeys: () => [...store.keys()], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ text: 'B.' }), { status: 200 })));
    await callKamiWrite({ kind: 'explain', prompt: 'q' });
    expect([...store.keys()].some((k) => k.startsWith('kiai.llm.'))).toBe(true);
  });
});

describe('server: one fast call', () => {
  it('asks for minimal thinking first and steps down when a model refuses it', async () => {
    const levels: unknown[] = [];
    const res = await handleLlmRequest('POST', JSON.stringify({ task: 'kami-write', prompt: 'Facts:\n- x' }), { LLM_API_KEY: 'test-key-123456', LLM_MODEL: 'gemini-test' }, async (_url, init) => {
      const cfg = JSON.parse(init.body).generationConfig;
      levels.push(cfg.thinkingConfig?.thinkingLevel ?? null);
      if (cfg.thinkingConfig?.thinkingLevel === 'minimal') return { ok: false, status: 400, json: async () => ({}), text: async () => JSON.stringify({ error: { message: 'Thinking level minimal is not supported' } }) };
      return gemini('Q16 [[v1]].');
    });
    expect(res.status).toBe(200);
    expect(levels).toEqual(['minimal', 'low']);
  });

  it('other tasks keep low thinking', async () => {
    const levels: unknown[] = [];
    await handleLlmRequest('GET', undefined, { LLM_API_KEY: 'test-key-123456' }, async (_url, init) => {
      levels.push(JSON.parse(init.body).generationConfig.thinkingConfig?.thinkingLevel);
      return gemini('{"ok":true}');
    }, { test: '1' });
    expect(levels).toEqual(['low']);
  });
});

/** A minimal Node req/res pair for the Vercel handler. */
function reqRes(body: string) {
  const listeners: Record<string, (() => void)[]> = {};
  const res = {
    statusCode: 0,
    writableEnded: false,
    out: '',
    setHeader() {},
    on(ev: string, fn: () => void) {
      (listeners[ev] ??= []).push(fn);
      return res;
    },
    end(s: string) {
      res.out = s;
      res.writableEnded = true;
    },
    emit(ev: string) {
      for (const fn of listeners[ev] ?? []) fn();
    },
  };
  return { req: { method: 'POST', url: '/api/llm', body } as never, res };
}

describe('server cache and abort (kami/api/llm.ts)', () => {
  it('serves an identical kami-write from memory: one model call for two requests', async () => {
    vi.stubEnv('LLM_API_KEY', 'test-key-123456');
    vi.stubEnv('LLM_MODEL', 'gemini-test');
    const fetchMock = vi.fn(async () => gemini('Q16 [[v1]].'));
    vi.stubGlobal('fetch', fetchMock);
    const body = JSON.stringify({ task: 'kami-write', prompt: `cache-test ${Math.random()}` });
    const a = reqRes(body);
    await handler(a.req, a.res as never);
    const b = reqRes(body);
    await handler(b.req, b.res as never);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(b.res.out)).toEqual(JSON.parse(a.res.out));
    expect(b.res.statusCode).toBe(200);
    expect(cacheKey(JSON.stringify({ task: 'chat', messages: [] }))).toBeNull();
    vi.unstubAllEnvs();
  });

  it('aborts the model call when the browser goes away', async () => {
    vi.stubEnv('LLM_API_KEY', 'test-key-123456');
    vi.stubEnv('LLM_MODEL', 'gemini-test');
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: { signal: AbortSignal }) => {
        signals.push(init.signal);
        return new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      }),
    );
    const { req, res } = reqRes(JSON.stringify({ task: 'kami-write', prompt: `abort-test ${Math.random()}` }));
    const done = handler(req, res as never);
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    res.emit('close');
    await done;
    expect(signals[0].aborted).toBe(true);
    // The rest of the model chain was not called.
    expect(signals).toHaveLength(1);
    expect(res.statusCode).toBe(502);
    vi.unstubAllEnvs();
  });
});
