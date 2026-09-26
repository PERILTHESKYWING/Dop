import { describe, expect, it } from 'vitest';
import { analyzeGame, AnalysisStopped, MemoryStore } from '../src/lib/analysis/pipeline';
import { ANALYSIS_VERSION } from '../src/lib/analysis/analyzer';
import { computeMoveRecords } from '../src/lib/analysis/records';
import { importSgfTexts } from '../src/lib/games';
import { FakeEngine } from './helpers';

const sgf = `(;GM[1]SZ[9]KM[7]PB[me]PW[you];B[ee];W[cc];B[gc];W[cg];B[gg];W[ec];B[dd];W[ce];B[fe];W[eg])`;
const game = () => importSgfTexts([{ name: 'g.sgf', text: sgf }], 'user', ['me']).games[0];
const opts = { visits: 8 };

describe('analysis pipeline', () => {
  it('evaluates every position, then searches every position', async () => {
    const eng = new FakeEngine();
    const store = new MemoryStore();
    const g = game();
    const a = await analyzeGame(g, eng, store, opts);
    expect(a.evals).toHaveLength(g.moves.length + 1);
    expect(a.evals.every((e) => e !== null && e.searched && e.depth === 'deep' && e.visits >= 8)).toBe(true);
    // The played move is always among the candidates.
    g.moves.forEach((m, i) => expect(a.evals[i]!.candidates!.some((c) => c.loc === m.loc)).toBe(true));
    expect(a.evals[0]!.engine.modelId).toBe('fake-net');
    expect(a.version).toBe(ANALYSIS_VERSION);
    expect(store.games.get(g.id)!.status).toBe('done');
    const { records } = computeMoveRecords(g, a);
    expect(records.filter((r) => r.isPlayer).length).toBe(5);
    expect(records.every((r) => r.depth === 'deep')).toBe(true);
  });

  it('can stop after the network pass and search later', async () => {
    const store = new MemoryStore();
    const g = game();
    const a = await analyzeGame(g, new FakeEngine(), store, { ...opts, stage: 'fast' });
    expect(a.evals.every((e) => e && !e.searched)).toBe(true);
    expect(store.games.get(g.id)!.status).toBe('fast');
    const eng = new FakeEngine();
    const b = await analyzeGame(g, eng, store, opts);
    expect(b.evals.every((e) => e?.searched)).toBe(true);
  });

  it('redoes analyses made with an older version or another komi', async () => {
    const store = new MemoryStore();
    const g = game();
    await analyzeGame(g, new FakeEngine(), store, opts);
    store.analyses.set(g.id, { ...store.analyses.get(g.id)!, version: 2 });
    store.cache.clear();
    const eng = new FakeEngine();
    await analyzeGame(g, eng, store, opts);
    expect(eng.evals).toBeGreaterThan(g.moves.length);
  });

  it('reuses the position cache', async () => {
    const eng = new FakeEngine();
    const store = new MemoryStore();
    await analyzeGame(game(), eng, store, opts);
    const first = eng.evals + eng.searches;
    const store2 = new MemoryStore();
    store2.cache = store.cache;
    const eng2 = new FakeEngine();
    await analyzeGame(game(), eng2, store2, opts);
    expect(eng2.evals + eng2.searches).toBeLessThan(first / 4);
  });

  it('resumes after being stopped', async () => {
    const eng = new FakeEngine();
    const store = new MemoryStore();
    let calls = 0;
    await expect(analyzeGame(game(), eng, store, { ...opts, checkpointEvery: 2, shouldStop: () => ++calls > 4 })).rejects.toBeInstanceOf(AnalysisStopped);
    const partial = store.analyses.get(game().id)!;
    const done = partial.evals.filter(Boolean).length;
    expect(done).toBeGreaterThan(0);
    const eng2 = new FakeEngine();
    const a = await analyzeGame(game(), eng2, store, opts);
    expect(a.evals.every(Boolean)).toBe(true);
  });
});
