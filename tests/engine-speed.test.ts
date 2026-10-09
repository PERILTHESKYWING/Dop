import { describe, expect, it } from 'vitest';
import { replay } from '../src/lib/go/board';
import { symmetric } from '../src/lib/go/coords';
import type { Color, Move } from '../src/lib/go/types';
import { NNCache, positionHash } from '../src/lib/engine/nncache';
import { engineEvaluator, Search, type LeafEvaluator, type LeafRequest } from '../src/lib/engine/mcts';
import { HeatTracker } from '../src/lib/engine/governor';
import { maxLanes, pickBatch } from '../src/lib/engine/tuning';
import type { NetEval } from '../src/lib/engine/parse';
import { FakeEngine } from './helpers';
import type { EngineRequest } from '../src/lib/engine/types';

const S = 19;
const mv = (pairs: [Color, number, number][]): Move[] => pairs.map(([color, x, y]) => ({ color, loc: y * S + x }));
const turn = (moves: Move[], sym: number): Move[] => moves.map((m) => ({ color: m.color, loc: symmetric(m.loc, S, sym) }));

describe('evaluation cache', () => {
  const line = mv([
    [1, 3, 15],
    [2, 15, 3],
    [1, 2, 3],
    [2, 16, 15],
    [1, 5, 2],
  ]);

  it('finds a rotated or mirrored position, with its policy turned to match', () => {
    const cache = new NNCache();
    const board = replay(S, [], line);
    const k = positionHash(board, 2, line, 7.5);
    const policy = new Float32Array(S * S + 1);
    policy[line[0].loc] = 0.6;
    policy[100] = 0.3;
    policy[S * S] = 0.1;
    cache.put(k, S, { policy, bWin: 0.4, bLead: -2 });
    for (let sym = 1; sym < 8; sym++) {
      const t = turn(line, sym);
      const kt = positionHash(replay(S, [], t), 2, t, 7.5);
      expect(kt.key).toBe(k.key);
      const hit = cache.get(kt, S, false)!;
      expect(hit.bWin).toBe(0.4);
      expect(hit.policy[symmetric(line[0].loc, S, sym)]).toBeCloseTo(0.6);
      expect(hit.policy[symmetric(100, S, sym)]).toBeCloseTo(0.3);
      expect(hit.policy[S * S]).toBeCloseTo(0.1);
    }
    expect(cache.stats().hits).toBe(7);
  });

  it('tells apart the same stones reached by a different recent move order, komi or side to move', () => {
    const other = [line[2], line[1], line[0], line[3], line[4]];
    const b1 = replay(S, [], line);
    const b2 = replay(S, [], other);
    expect(positionHash(b1, 2, line, 7.5).key).not.toBe(positionHash(b2, 2, other, 7.5).key);
    expect(positionHash(b1, 2, line, 7.5).key).not.toBe(positionHash(b1, 2, line, 6.5).key);
    expect(positionHash(b1, 2, line, 7.5).key).not.toBe(positionHash(b1, 1, line, 7.5).key);
  });

  it('saves opening evaluations and loads them back', () => {
    const a = new NNCache();
    const board = replay(S, [], line);
    const k = positionHash(board, 2, line, 7.5);
    const policy = new Float32Array(S * S + 1);
    policy[7] = 1;
    a.put(k, S, { policy, bWin: 0.3, bLead: -4, ownership: new Float32Array(S * S) });
    const rows = a.exportRows(40, 100);
    expect(rows).toHaveLength(1);
    expect(a.exportRows(3, 100)).toHaveLength(0);
    const b = new NNCache();
    b.importRows(rows);
    expect(b.get(k, S, false)?.bLead).toBe(-4);
    // Saved rows carry no ownership.
    expect(b.get(k, S, true)).toBeNull();
  });

  it('drops the oldest entries past its memory limit', () => {
    const cache = new NNCache(10 * (64 + (S * S + 1) * 4));
    for (let i = 0; i < 30; i++) {
      const m = mv([[1, i % S, Math.floor(i / S)]]);
      cache.put(positionHash(replay(S, [], m), 2, m, 7.5), S, { policy: new Float32Array(S * S + 1), bWin: 0.5, bLead: 0 });
    }
    expect(cache.stats().entries).toBe(10);
  });
});

/** FakeEngine with batched evaluation, counting network calls and positions. */
class BatchFake extends FakeEngine {
  calls = 0;
  positions = 0;
  batch = 8;
  async evalSeqBatchRaw(reqs: (EngineRequest & { ownership?: boolean })[]) {
    this.calls++;
    this.positions += reqs.length;
    return Promise.all(reqs.map((r) => this.evalRaw(r, !!r.ownership)));
  }
}

describe('batched, cached evaluator', () => {
  it('sends a whole batch at once and serves repeats from the cache', async () => {
    const eng = new BatchFake();
    const ev = engineEvaluator(eng);
    const root = { size: 9, komi: 7.5, moves: [] as Move[], toPlay: 1 as Color, board: replay(9, [], []) };
    const s1 = new Search(ev, root);
    await s1.run({ visits: 200 });
    const firstPositions = eng.positions;
    expect(eng.calls).toBeLessThan(firstPositions); // several positions per call
    // A second search of the same position reuses almost everything.
    const s2 = new Search(engineEvaluator(eng), root);
    await s2.run({ visits: 200 });
    expect(eng.positions - firstPositions).toBeLessThan(firstPositions / 2);
  });

  it('averages the root over symmetries', async () => {
    const eng = new BatchFake();
    const leaves: LeafRequest[][] = [];
    const base = engineEvaluator(eng);
    const spy: LeafEvaluator = Object.assign(async (l: LeafRequest[]) => {
      leaves.push(l);
      return base(l);
    }, { batch: base.batch, rootSymmetries: base.rootSymmetries });
    const s = new Search(spy, { size: 9, komi: 7.5, moves: [], toPlay: 1, board: replay(9, [], []) });
    await s.run({ visits: 10 });
    expect(leaves[0][0].symmetries).toBe(8);
    expect(eng.positions).toBeGreaterThanOrEqual(8);
  });
});

/** A net that strongly prefers one move, so the search settles early. */
function decisive(): LeafEvaluator {
  return async (leaves) =>
    leaves.map((l): NetEval => {
      const hw = l.size * l.size;
      const policy = new Float32Array(hw + 1);
      const legal = l.board.legalMask(l.toPlay);
      let z = 0;
      for (let i = 0; i < hw; i++) if (legal[i]) z += policy[i] = i === 40 ? 50 : 1;
      for (let i = 0; i < hw; i++) policy[i] /= z;
      return { policy, bWin: 0.5, bLead: 0 };
    });
}

describe('adaptive search', () => {
  it('stops once more visits cannot change the best move', async () => {
    const s = new Search(decisive(), { size: 9, komi: 7.5, moves: [], toPlay: 1, board: replay(9, [], []) });
    const snap = await s.run({ visits: 400, earlyStop: true });
    expect(snap.settled).toBe(true);
    expect(snap.visits).toBeLessThan(400);
    expect(snap.candidates[0].loc).toBe(40);
    const full = await new Search(decisive(), { size: 9, komi: 7.5, moves: [], toPlay: 1, board: replay(9, [], []) }).run({ visits: 400 });
    expect(full.visits).toBe(400);
    expect(full.candidates[0].loc).toBe(40);
  });

  it('keeps searching until the played move has its share', async () => {
    const s = new Search(decisive(), { size: 9, komi: 7.5, moves: [], toPlay: 1, board: replay(9, [], []) });
    const snap = await s.run({ visits: 400, earlyStop: true, forced: 0, forcedShare: 0.1 });
    const forced = snap.candidates.find((c) => c.loc === 0);
    expect(forced?.visits ?? 0).toBeGreaterThanOrEqual(39);
  });
});

describe('tuning and heat', () => {
  it('keeps a bigger batch only when it is clearly faster', () => {
    expect(pickBatch([{ batch: 1, msPerPos: 60 }, { batch: 4, msPerPos: 58 }])).toBe(1);
    expect(pickBatch([{ batch: 1, msPerPos: 60 }, { batch: 4, msPerPos: 40 }, { batch: 8, msPerPos: 39 }])).toBe(4);
    // A batch that would take too long per call is skipped.
    expect(pickBatch([{ batch: 1, msPerPos: 100 }, { batch: 8, msPerPos: 60 }])).toBe(1);
  });

  it('limits workers by cores and memory', () => {
    expect(maxLanes({ cores: 8, backend: 'cpu' }, 150e6)).toBe(7);
    expect(maxLanes({ cores: 8, memoryGB: 2, backend: 'cpu' }, 150e6)).toBe(4);
    expect(maxLanes({ cores: 8, backend: 'webgpu' }, 150e6)).toBe(1);
    expect(maxLanes({ cores: 1, backend: 'cpu' }, 150e6)).toBe(1);
  });

  it('notices a device slowing down and recovering', () => {
    const h = new HeatTracker();
    let t = 0;
    for (let i = 0; i < 40; i++) expect(h.add(60, (t += 500))).toBeNull();
    let hot = false;
    for (let i = 0; i < 200 && !hot; i++) hot = h.add(100, (t += 500)) === 'hot';
    expect(hot).toBe(true);
    let cool = false;
    for (let i = 0; i < 400 && !cool; i++) cool = h.add(60, (t += 500)) === 'cool';
    expect(cool).toBe(true);
  });
});
