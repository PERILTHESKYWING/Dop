import { describe, expect, it } from 'vitest';
import { Board, replay } from '../src/lib/go/board';
import { PASS, type Color, type Move } from '../src/lib/go/types';
import { Search, type LeafEvaluator, type LeafRequest, type RootPosition } from '../src/lib/engine/mcts';
import type { NetEval } from '../src/lib/engine/parse';

const SIZE = 9;
const HW = SIZE * SIZE;

/**
 * A toy network: a policy over legal points that prefers the centre, and a value where
 * Black is 3 points ahead, a little more for each extra black stone.
 */
function toyNet(calls: LeafRequest[][] = []): LeafEvaluator {
  return async (leaves) => {
    calls.push(leaves);
    return leaves.map((l): NetEval => {
      const legal = l.board.legalMask(l.toPlay);
      const policy = new Float32Array(HW + 1);
      let z = 0;
      for (let i = 0; i < HW; i++) {
        if (!legal[i]) continue;
        const x = i % SIZE, y = Math.floor(i / SIZE);
        const d = Math.abs(x - 4) + Math.abs(y - 4);
        policy[i] = Math.exp(-0.4 * d);
        z += policy[i];
      }
      policy[HW] = 0.001;
      z += 0.001;
      for (let i = 0; i <= HW; i++) policy[i] /= z;
      const [, b, w] = l.board.counts();
      const lead = 3 + 0.2 * (b - w);
      return { policy, bWin: 1 / (1 + Math.exp(-lead / 3)), bLead: lead, ownership: l.ownership ? new Float32Array(HW) : undefined };
    });
  };
}

function position(moves: Move[] = [], toPlay: Color = 1): RootPosition {
  return { size: SIZE, komi: 0.5, moves, toPlay, board: replay(SIZE, [], moves) };
}

describe('tree search', () => {
  it('counts every visit once and reports values for the side to move', async () => {
    const s = new Search(toyNet(), position());
    const snap = await s.run({ visits: 60, ownership: true });
    expect(snap.visits).toBe(60);
    // The root's own evaluation is one visit; the rest went to its children.
    expect(snap.candidates.reduce((a, c) => a + c.visits, 0)).toBe(59);
    expect(snap.candidates[0].visits).toBeGreaterThanOrEqual(snap.candidates[1]?.visits ?? 0);
    // Black to move and ahead: every candidate keeps Black above 50%.
    for (const c of snap.candidates) {
      expect(c.winrate).toBeGreaterThan(0.5);
      expect(c.pv[0]).toBe(c.loc);
    }
    expect(snap.ownership).not.toBeNull();
    expect(snap.policy?.length).toBe(HW + 1);
  });

  it('keeps the explored subtree when the game moves on', async () => {
    const s = new Search(toyNet(), position());
    const first = await s.run({ visits: 80 });
    const best = first.candidates[0];
    const reused = s.setPosition(position([{ color: 1, loc: best.loc }], 2));
    expect(reused).toBe(true);
    expect(s.rootVisits).toBe(best.visits);
    const next = await s.run({ visits: best.visits + 20 });
    expect(next.visits).toBe(best.visits + 20);
    // White to move now, and behind: White's winrates are below 50%.
    expect(next.candidates[0].winrate).toBeLessThan(0.5);
    // A position off the explored line starts a fresh tree.
    expect(s.setPosition(position([{ color: 1, loc: 0 }, { color: 2, loc: 80 }], 1))).toBe(false);
    expect(s.rootVisits).toBe(0);
  });

  it('gives the forced move a share of the visits', async () => {
    const s = new Search(toyNet(), position());
    const corner = 0; // the toy policy likes the centre, not the corner
    const snap = await s.run({ visits: 101, forced: corner, forcedShare: 0.15 });
    const c = snap.candidates.find((x) => x.loc === corner);
    expect(c?.visits ?? 0).toBeGreaterThanOrEqual(12);
  });

  it('spreads batched leaves with virtual loss and leaves no loss behind', async () => {
    const calls: LeafRequest[][] = [];
    const s = new Search(toyNet(calls), position(), { batch: 8 });
    const snap = await s.run({ visits: 200 });
    expect(snap.visits).toBe(200);
    expect(Math.max(...calls.map((c) => c.length))).toBeGreaterThan(1);
    // A second run on the same tree still works (no leftover virtual loss).
    const more = await s.run({ visits: 260 });
    expect(more.visits).toBe(260);
    expect(more.candidates.reduce((a, c) => a + c.visits, 0)).toBe(259);
  });

  it('keeps one call in flight per engine worker and counts every visit once', async () => {
    const calls: LeafRequest[][] = [];
    const net = toyNet(calls);
    let inFlight = 0;
    let most = 0;
    const slow: LeafEvaluator = async (leaves) => {
      most = Math.max(most, ++inFlight);
      await new Promise((r) => setTimeout(r, 1 + (calls.length % 3)));
      const out = await net(leaves);
      inFlight--;
      return out;
    };
    slow.batch = () => 12;
    slow.pipeline = () => 3;
    const s = new Search(slow, position());
    const snap = await s.run({ visits: 300 });
    expect(most).toBe(3);
    expect(Math.max(...calls.map((c) => c.length))).toBeLessThanOrEqual(4);
    expect(snap.visits).toBe(300);
    expect(snap.candidates.reduce((a, c) => a + c.visits, 0)).toBe(299);
    const more = await s.run({ visits: 340 });
    expect(more.visits).toBe(340);
  });

  it('reports the speed over wall time when calls overlap', async () => {
    const net = toyNet();
    const slow: LeafEvaluator = async (leaves) => {
      await new Promise((r) => setTimeout(r, 20));
      return net(leaves);
    };
    slow.batch = () => 4;
    slow.pipeline = () => 4;
    const s = new Search(slow, position());
    const t = performance.now();
    const seen: number[] = [];
    const snap = await s.run({ visits: 81, updateMs: 30, onUpdate: (u) => seen.push(u.evalsPerSec) });
    const wall = (snap.visits * 1000) / (performance.now() - t);
    // Mid-search readings too, while calls are still out.
    for (const r of seen.slice(1, -1)) expect(r).toBeLessThan(2 * wall);
    // Calls of 20 ms overlap: the speed is what the wall clock saw, not one call at a time.
    expect(snap.evalsPerSec).toBeGreaterThan(0.75 * wall);
    expect(snap.evalsPerSec).toBeLessThan(1.25 * wall);
  });

  it('explores more under a node whose values disagree (utility spread)', async () => {
    // KataGo's spread factor: 1 at the prior spread, below 1 when every visit agrees.
    const s = new Search(toyNet(), position(), { cpuctStdevScale: 0.85 });
    const factor = (s as unknown as { stdevFactor: (n: object, v: number) => number }).stdevFactor.bind(s);
    expect(factor({ visits: 0, utilSqSum: 0 }, 0)).toBeCloseTo(1);
    const calm = factor({ visits: 100, utilSqSum: 100 * 0.5 * 0.5 }, 0.5);
    const sharp = factor({ visits: 100, utilSqSum: 100 * (0.5 * 0.5 + 0.6 * 0.6) }, 0.5);
    expect(calm).toBeLessThan(0.5);
    expect(sharp).toBeGreaterThan(1);
    const snap = await s.run({ visits: 120 });
    expect(snap.visits).toBe(120);
  });

  it('returns a failed evaluation as an error and can search again', async () => {
    const net = toyNet();
    let n = 0;
    const flaky: LeafEvaluator = async (leaves) => {
      if (++n === 5) throw new Error('worker lost');
      await new Promise((r) => setTimeout(r, 1));
      return net(leaves);
    };
    flaky.batch = () => 8;
    flaky.pipeline = () => 2;
    const s = new Search(flaky, position());
    await expect(s.run({ visits: 200 })).rejects.toThrow('worker lost');
    const snap = await s.run({ visits: 200 });
    expect(snap.visits).toBe(200);
    expect(snap.candidates.reduce((a, c) => a + c.visits, 0)).toBe(199);
  });

  it('ends the game after two passes', async () => {
    const s = new Search(toyNet(), position([{ color: 1, loc: 40 }, { color: 2, loc: PASS }], 1));
    const snap = await s.run({ visits: 30 });
    expect(snap.visits).toBe(30);
  });

  it('stops when asked and can be moved afterwards', async () => {
    const s = new Search(toyNet(), position());
    let n = 0;
    const snap = await s.run({ visits: 10_000, shouldStop: () => ++n > 25 });
    expect(snap.visits).toBeLessThan(10_000);
    expect(() => s.setPosition(position([{ color: 1, loc: 40 }], 2))).not.toThrow();
  });
});

describe('legal mask', () => {
  it('matches isLegal on a position with captures, ko and suicide points', () => {
    const b = new Board(9);
    const moves: [number, Color][] = [
      [10, 1], [11, 2], [18, 1], [20, 2], [28, 1], [29, 2], [19, 2], [0, 1], [1, 2], [9, 2],
    ];
    for (const [loc, c] of moves) b.play(loc, c, true);
    for (const color of [1, 2] as Color[]) {
      const mask = b.legalMask(color);
      for (let i = 0; i < 81; i++) expect(mask[i] === 1).toBe(b.isLegal(i, color));
    }
  });
});
