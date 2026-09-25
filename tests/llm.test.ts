import { describe, expect, it } from 'vitest';
import { GEMINI_CHAIN, resolveLlmConfig, safeJson, validatePatterns, type DiscoveryRequest } from '../shared/llm';
import { generateJson, handleLlmRequest } from '../shared/llmServer';

const req: DiscoveryRequest = {
  task: 'discover-patterns',
  player: { games: 10, moves: 1000, avgScoreLoss: 1.2, accuracy: 0.5, axes: [] },
  clusters: [
    {
      id: 'C1', signature: 'too_low', label: 'x', opportunities: 40, occurrences: 12, games: 6, avgScoreLoss: 3, statConfidence: 0.9,
      representatives: ['E1', 'E2', 'E3', 'E4'].map((id) => ({
        id, game: 'g', move: 50, phase: 'middlegame', color: 'Black' as const, played: 'C3', best: 'D4', scoreLoss: 3, winrateLoss: 0.05, playedTraits: [], bestTraits: [], diagram: '',
      })),
    },
  ],
};

describe('LLM layer', () => {
  it('keeps only patterns backed by real evidence ids and caps confidence', () => {
    const raw = {
      patterns: [
        { title: 'Plays third line under enemy influence', description: 'd', axis: 'territoryInfluence', clusterId: 'C1', evidenceIds: ['E1', 'E2', 'E3'], confidence: 0.99, trainingFocus: 'f' },
        { title: 'Invented', description: 'd', axis: 'territoryInfluence', clusterId: 'C1', evidenceIds: ['E9', 'E10', 'E11'], confidence: 0.9 },
        { title: 'Bad axis', description: 'd', axis: 'vibes', clusterId: 'C1', evidenceIds: ['E1', 'E2', 'E3'], confidence: 0.9 },
        { title: 'Unknown cluster', description: 'd', axis: 'tactics', clusterId: 'C7', evidenceIds: ['E1', 'E2', 'E3'], confidence: 0.9 },
      ],
    };
    const { patterns, rejected } = validatePatterns(raw, req);
    expect(patterns).toHaveLength(1);
    expect(rejected).toBe(3);
        expect(patterns[0].confidence).toBeLessThanOrEqual(req.clusters[0].statConfidence + 0.1);
  });

  it('extracts JSON from chatty output', () => {
    expect(safeJson('Sure! ```json\n{"patterns": []}\n```')).toEqual({ patterns: [] });
    expect(safeJson('nope')).toBeNull();
  });

  it('maps "Gemini" to a real model id and requires a key', () => {
    const c = resolveLlmConfig({ LLM_API_KEY: 'k', LLM_MODEL: 'Gemini', LLM_PROVIDER: 'Google AI Studio' });
    expect(c.configured).toBe(true);
    expect(c.provider).toBe('google');
    expect(c.models[0]).toMatch(/^gemini-/);
    expect(resolveLlmConfig({ LLM_MODEL: 'gemini-2.5-pro' }).configured).toBe(false);
    expect(resolveLlmConfig({ LLM_API_KEY: 'k', LLM_MODEL: 'gemini-2.5-pro' }).models[0]).toBe('gemini-2.5-pro');
  });

  it('never returns the key and refuses when unconfigured', async () => {
    const env = { LLM_API_KEY: 'secret-key-123', LLM_MODEL: 'Gemini', LLM_PROVIDER: 'Google AI Studio' };
    const status = await handleLlmRequest('GET', undefined, env, async () => { throw new Error('no network'); });
    expect(JSON.stringify(status.body)).not.toContain('secret-key-123');
    const off = await handleLlmRequest('POST', JSON.stringify(req), {}, async () => { throw new Error('no network'); });
    expect(off.status).toBe(503);
  });

  it('sends the key only in a header and validates the model output', async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;
    const env = { LLM_API_KEY: 'secret-key-123', LLM_MODEL: 'Gemini', LLM_PROVIDER: 'Google AI Studio' };
    const res = await handleLlmRequest('POST', JSON.stringify(req), env, async (url, init) => {
      seen = { url, headers: init.headers };
      const text = JSON.stringify({ patterns: [{ title: 'T', description: 'D', axis: 'tactics', clusterId: 'C1', evidenceIds: ['E1', 'E2', 'E3'], confidence: 0.7 }] });
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }), text: async () => '' };
    });
    expect(res.status).toBe(200);
    expect(seen!.url).not.toContain('secret-key-123');
    expect(seen!.headers['x-goog-api-key']).toBe('secret-key-123');
    expect((res.body as { patterns: unknown[] }).patterns).toHaveLength(1);
  });
});

describe('Gemini model chain', () => {
  const env = { LLM_API_KEY: 'test-key-0123456789', LLM_MODEL: 'Gemini', LLM_PROVIDER: 'Google AI Studio' };
  type Reply = { status: number; body: unknown };
  const fake = (plan: (model: string, body: Record<string, unknown>) => Reply) => {
    const calls: { model: string; body: Record<string, unknown> }[] = [];
    const f = async (url: string, init: { body: string }) => {
      const model = decodeURIComponent(url.split('/models/')[1].split(':')[0]);
      const body = JSON.parse(init.body) as Record<string, unknown>;
      calls.push({ model, body });
      const r = plan(model, body);
      return { ok: r.status === 200, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) };
    };
    return { f, calls };
  };
  const answer = (text: string) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text }] } }] } });
  const noSleep = { sleep: async () => {} };

  it('retries an overloaded model once, then moves on to the next one', async () => {
    const { f, calls } = fake((m) => (m === 'gemini-flash-latest' ? { status: 503, body: { error: { message: 'high demand' } } } : answer('{"ok":true}')));
    const r = await generateJson({ system: 's', user: 'u' }, env, f, noSleep);
    expect(r.ok).toBe(true);
    expect(calls.map((c) => c.model)).toEqual(['gemini-flash-latest', 'gemini-flash-latest', 'gemini-3-flash-preview']);
    expect(r.errors).toHaveLength(2);
  });

  it('skips retired model ids without retrying', async () => {
    const { f, calls } = fake((m) => (m === 'gemini-flash-latest' ? { status: 404, body: { error: { message: 'no longer available' } } } : answer('{"ok":true}')));
    await generateJson({ system: 's', user: 'u' }, env, f, noSleep);
    expect(calls.filter((c) => c.model === 'gemini-flash-latest')).toHaveLength(1);
  });

  it('drops the thinking settings when a model rejects them', async () => {
    const { f, calls } = fake((_m, body) =>
      (body.generationConfig as Record<string, unknown>).thinkingConfig ? { status: 400, body: { error: { message: 'Thinking level is not supported' } } } : answer('{"ok":true}'),
    );
    const r = await generateJson({ system: 's', user: 'u' }, env, f, noSleep);
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].model).toBe(calls[1].model);
  });

  it('stops at once on a bad key and never echoes it', async () => {
    const { f, calls } = fake(() => ({ status: 400, body: { error: { message: 'API key not valid: secret-abc-123456' } } }));
    const r = await generateJson({ system: 's', user: 'u' }, { ...env, LLM_API_KEY: 'secret-abc-123456' }, f, noSleep);
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(r.errors)).not.toContain('secret-abc-123456');
  });

  it('respects the total time budget', async () => {
    let t = 0;
    const { f } = fake(() => {
      t += 20_000;
      return { status: 503, body: { error: { message: 'busy' } } };
    });
    const r = await generateJson({ system: 's', user: 'u' }, env, f, { sleep: async (ms) => void (t += ms), now: () => t, budgetMs: 45_000 });
    expect(r.ok).toBe(false);
    expect(r.errors.at(-1)).toMatch(/time budget/);
  });

  it('puts an explicit LLM_MODEL first and normalises its spelling', () => {
    expect(resolveLlmConfig({ LLM_API_KEY: 'k', LLM_MODEL: 'Gemini 3.5 Flash' }).models[0]).toBe('gemini-3.5-flash');
    expect(resolveLlmConfig({ LLM_API_KEY: 'k', LLM_MODEL: 'models/gemini-3-flash-preview' }).models[0]).toBe('gemini-3-flash-preview');
    expect(resolveLlmConfig({ LLM_API_KEY: 'k', LLM_MODEL: 'Gemini' }).models).toEqual(GEMINI_CHAIN);
  });

  it('runs a live check on GET ?test=1', async () => {
    const { f } = fake(() => answer('{"ok":true}'));
    const r = await handleLlmRequest('GET', undefined, env, f, { test: '1' }, noSleep);
    expect((r.body as { test: { ok: boolean } }).test.ok).toBe(true);
  });
});
