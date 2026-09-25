import { describe, expect, it } from 'vitest';
import { resolveLlmConfig, safeJson, validatePatterns, type DiscoveryRequest } from '../shared/llm';
import { handleLlmRequest } from '../shared/llmServer';

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
