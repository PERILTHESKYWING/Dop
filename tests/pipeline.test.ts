import { describe, expect, it } from 'vitest';
import { analyzeGame, AnalysisStopped, MemoryStore } from '../src/lib/analysis/pipeline';
import { computeMoveRecords } from '../src/lib/analysis/records';
import { importSgfTexts } from '../src/lib/games';
import { FakeEngine } from './helpers';

const sgf = `(;GM[1]SZ[9]KM[7]PB[me]PW[you];B[ee];W[cc];B[gc];W[cg];B[gg];W[ec];B[dd];W[ce];B[fe];W[eg])`;
const game = () => importSgfTexts([{ name: 'g.sgf', text: sgf }], 'user', ['me']).games[0];
const opts = { deepVisits: 8, deepPerGame: 3, maxSearchMs: 1000, focusColor: 1 as const };

describe('analysis pipeline', () => {
  it('analyses every position and deep-analyses a few', async () => {
    const eng = new FakeEngine();
    const store = new MemoryStore();
    const g = game();
    const a = await analyzeGame(g, eng, store, opts);
    expect(a.evals).toHaveLength(g.moves.length + 1);
    expect(a.evals.every((e) => e !== null)).toBe(true);
    expect(a.deepTargets.length).toBeGreaterThan(0);
    expect(a.deepTargets.length).toBeLessThanOrEqual(3);
    for (const i of a.deepTargets) expect(a.evals[i]!.depth).toBe('deep');
    expect(a.evals[0]!.engine.modelId).toBe('fake-net');
    expect(store.games.get(g.id)!.status).toBe('done');
    const { records } = computeMoveRecords(g, a);
    expect(records.filter((r) => r.isPlayer).length).toBe(5);
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
