import { describe, expect, it } from 'vitest';
import { Board } from '../src/lib/go/board';
import { gtpToLoc } from '../src/lib/go/coords';
import { PASS, type Loc } from '../src/lib/go/types';
import {
  copyStatus,
  copyVsKataGo,
  describeHabits,
  featureVector,
  habitCost,
  initialWeights,
  isTellingDisagreement,
  moveCost,
  NF,
  predictForPosition,
  rankDisagreements,
  sampleMove,
  trainDoppel,
  type Disagreement,
  type DoppelExample,
} from '../src/lib/profile/doppel';
import type { PositionEval } from '../src/lib/types';
import { pf } from './helpers';

const at19 = (s: string) => gtpToLoc(s, 19);
const at9 = (s: string) => gtpToLoc(s, 9);
const base = () => ({ weights: Array.from(initialWeights()) });
/** Deterministic RNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('predictForPosition', () => {
  const history = [
    { color: 1 as const, loc: at19('Q16') },
    { color: 2 as const, loc: at19('R14') },
  ];
  const policy = [
    { loc: at19('D4'), p: 0.31 },
    { loc: at19('Q13'), p: 0.29 },
    { loc: at19('C16'), p: 0.2 },
    { loc: PASS, p: 0.05 },
  ];

  it('is empty without a model', () => {
    expect(predictForPosition(null, { size: 19, history, toPlay: 1, policy })).toEqual([]);
  });

  it("reduces to KataGo's policy over its candidates with the initial weights", () => {
    const all = predictForPosition(base(), { size: 19, history, toPlay: 1, policy }, 10);
    expect(all.map((p) => p.loc)).toEqual([at19('D4'), at19('Q13'), at19('C16')]);
    expect(all.reduce((a, p) => a + p.p, 0)).toBeCloseTo(1, 6);
    expect(all[0].p).toBeCloseTo(0.31 / 0.8, 3);
    expect(predictForPosition(base(), { size: 19, history, toPlay: 1, policy })).toHaveLength(3);
    expect(predictForPosition(base(), { size: 19, history, toPlay: 1, policy }, 1)).toHaveLength(1);
  });

  it('takes the full policy array as well as a list, and ignores occupied points', () => {
    const full = new Float32Array(19 * 19 + 1);
    for (const e of policy) full[e.loc === PASS ? 361 : e.loc] = e.p;
    full[at19('Q16')] = 0.5; // occupied: not a candidate
    const fromList = predictForPosition(base(), { size: 19, history, toPlay: 1, policy: [...policy, { loc: at19('R14'), p: 0.4 }] }, 10);
    const fromArray = predictForPosition(base(), { size: 19, history, toPlay: 1, policy: full }, 10);
    expect(fromArray.map((p) => p.loc)).toEqual(fromList.map((p) => p.loc));
    expect(fromArray[0].p).toBeCloseTo(fromList[0].p, 5);
    expect(fromList.some((p) => p.loc === at19('R14'))).toBe(false);
  });

  it("answers relative to the opponent's last move", () => {
    const w = initialWeights();
    w[1] = 3; // strongly prefers local answers
    const model = { weights: Array.from(w) };
    // Q13 is next to White's R14: the local answer wins.
    expect(predictForPosition(model, { size: 19, history, toPlay: 1, policy })[0].loc).toBe(at19('Q13'));
    // With White to play, R14 is its own move, so nothing is "local" and the policy decides.
    expect(predictForPosition(model, { size: 19, history, toPlay: 2, policy })[0].loc).toBe(at19('D4'));
  });

  it('accepts a given board and ownership in either form', () => {
    const board = new Board(19);
    for (const m of history) board.play(m.loc, m.color);
    const own = new Float32Array(361).fill(0.2);
    const a = predictForPosition(base(), { size: 19, history, toPlay: 1, policy, board, ownership: own });
    const b = predictForPosition(base(), { size: 19, history, toPlay: 1, policy, ownership: btoa(String.fromCharCode(...Array.from(own, (x) => Math.round(x * 127)))) });
    const c = predictForPosition(base(), { size: 19, history, toPlay: 1, policy, ownership: new Float32Array(5) }); // wrong size: ignored
    expect(a.map((p) => p.loc)).toEqual(b.map((p) => p.loc));
    expect(c).toHaveLength(3);
  });
});

describe('sampleMove', () => {
  const preds = [
    { loc: 1, p: 0.5 },
    { loc: 2, p: 0.3 },
    { loc: 3, p: 0.17 },
    { loc: 4, p: 0.03 },
  ];

  it('handles the edges', () => {
    expect(sampleMove([])).toBeNull();
    expect(sampleMove(preds, () => 0.99, { temperature: 0 })!.loc).toBe(1);
    expect(sampleMove(preds, () => 0)!.loc).toBe(1);
    // The 3% move is under a tenth of the favourite's 50%: never played.
    expect(sampleMove(preds, () => 0.999999)!.loc).toBe(3);
    expect(sampleMove(preds, () => 0.999999, { floor: 0 })!.loc).toBe(4);
  });

  it('plays each move about as often as the copy expects', () => {
    const r = rng(7);
    const counts = new Map<number, number>();
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const m = sampleMove(preds, r, { floor: 0 })!.loc;
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    for (const p of preds) expect((counts.get(p.loc) ?? 0) / n).toBeCloseTo(p.p, 1);
  });

  it('is sharper at a lower temperature', () => {
    const r = rng(3);
    let top = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) if (sampleMove(preds, r, { temperature: 0.5 })!.loc === 1) top++;
    // Weights p^2 over the three kept moves: 0.25 / (0.25 + 0.09 + 0.0289).
    expect(top / n).toBeCloseTo(0.25 / 0.3689, 1);
  });
});

/** A synthetic example: 4 candidates with falling priors, `local` marks the local one. */
function example(gameId: string, local: number, y: number, outside = false): DoppelExample {
  const priors = [0.4, 0.3, 0.2, 0.1];
  const x = priors.map((p, i) => featureVector(pf({ local: i === local, tenuki: i !== local, distLast: i === local ? 1 : 8 }), p, i === 0));
  const candidates = [10, 11, 12, 13];
  if (outside) {
    x.push(featureVector(pf({ local: false, tenuki: true, distLast: 9, invasion: true }), 0.0005, false));
    candidates.push(14);
    return { gameId, candidates, x, y: 4, outside: true };
  }
  return { gameId, candidates, x, y };
}

describe('trainDoppel', () => {
  it('learns a habit and says it in words', () => {
    const r = rng(11);
    const data: DoppelExample[] = [];
    for (let i = 0; i < 400; i++) {
      const local = 1 + Math.floor(r() * 3);
      data.push(example(`g${i % 10}`, local, r() < 0.7 ? local : 0));
    }
    const m = trainDoppel(data, { version: 3 });
    expect(m.version).toBe(3);
    expect(m.algo).toBe(2);
    expect(m.weights).toHaveLength(NF);
    expect(m.weights[1]).toBeGreaterThan(0.5);
    expect(m.gameIds).toHaveLength(10);
    expect(m.moves).toBe(400);
    expect(m.trainedOn).toBe(400);
    expect(m.outsideRate).toBe(0);
    // The copy beats KataGo's policy at naming the move on held-out games.
    expect(m.metrics.top1).toBeGreaterThan(m.metrics.baselineTop1 + 0.2);
    const habits = describeHabits(m);
    const local = habits.find((h) => h.feature === 1);
    expect(local?.text).toBe("Answers the opponent's last move locally more often than KataGo");
    expect(local?.strength).toBe('strong');
  });

  it('learns only from choices among KataGo candidates, and counts other moves as misses', () => {
    const r = rng(5);
    const listed = Array.from({ length: 200 }, (_, i) => example(`g${i % 10}`, 1, r() < 0.5 ? 1 : 0));
    const outside = Array.from({ length: 50 }, (_, i) => example(`g${i % 10}`, 1, 4, true));
    const m = trainDoppel([...listed, ...outside]);
    // Only the moves off KataGo's list are invasions: they must not teach "invades".
    expect(Math.abs(m.weights[16])).toBeLessThan(1e-6);
    // Had they been learned from, invading would look like a strong habit.
    const w1 = trainDoppel([...listed, ...outside.map((e) => ({ ...e, outside: false }))]);
    expect(w1.weights[16]).toBeGreaterThan(0.3);
    expect(m.outsideRate).toBeCloseTo(0.2, 6);
    expect(m.trainedOn).toBe(200);
    expect(m.moves).toBe(250);

    const none = trainDoppel(outside);
    expect(none.trainedOn).toBe(0);
    expect(none.metrics.top1).toBe(0);
    expect(none.metrics.top3).toBe(0);
    expect(none.metrics.baselineTop1).toBe(0);
    expect(none.weights).toEqual(Array.from(initialWeights()));
  });
});

describe('describeHabits', () => {
  it('phrases the sign, grades the strength and skips noise', () => {
    const w = Array.from(initialWeights());
    w[2] = -0.6; // tenuki
    w[8] = 0.3; // contact
    w[13] = 0.05; // ataris: noise
    w[0] = 1.2; // sharper than the policy: 2 * 0.2 = 0.4 on the habit scale
    const h = describeHabits({ weights: w });
    expect(h.map((x) => x.feature)).toEqual([2, 0, 8]);
    expect(h[0]).toMatchObject({ text: 'Plays elsewhere (tenuki) less often than KataGo', strength: 'strong' });
    expect(h[0].odds).toBeCloseTo(Math.exp(-0.6), 6);
    expect(h[1].strength).toBe('clear');
    expect(h[2].text).toBe('Plays contact moves (touching enemy stones) more often than KataGo');
    expect(describeHabits({ weights: Array.from(initialWeights()) })).toEqual([]);
  });
});

describe('copyStatus', () => {
  const sources: Record<string, string> = { u1: 'user', u2: 'user', d1: 'demo', d2: 'demo' };
  const ctx = (demoMode: boolean, studied: string[], playerMoves = 200) => ({ demoMode, sourceOf: (id: string) => sources[id], studiedGames: studied, playerMoves });

  it("tells the user's copy from the demo player's", () => {
    expect(copyStatus(null, ctx(false, [])).state).toBe('none');
    expect(copyStatus({ gameIds: ['u1'] }, ctx(false, ['u1', 'u2']))).toEqual({ state: 'ready', owner: 'user', newGames: 1 });
    expect(copyStatus({ gameIds: ['d1', 'd2'] }, ctx(true, ['d1', 'd2']))).toEqual({ state: 'ready', owner: 'demo', newGames: 0 });
    // The user's games took over, but the copy on file is still the demo player's.
    expect(copyStatus({ gameIds: ['d1', 'd2'] }, ctx(false, ['u1']))).toEqual({ state: 'foreign', owner: 'demo', newGames: 0 });
    // Trained on games that were removed since.
    expect(copyStatus({ gameIds: ['gone'] }, ctx(false, ['u1'])).state).toBe('foreign');
  });

  it('judges older models without a game list by what is studied now', () => {
    expect(copyStatus({}, ctx(true, ['d1']))).toMatchObject({ state: 'ready', owner: 'demo' });
    expect(copyStatus({}, ctx(false, ['u1'], 120))).toMatchObject({ state: 'ready', owner: 'user' });
    expect(copyStatus({}, ctx(false, ['u1'], 12))).toMatchObject({ state: 'foreign' });
  });
});

describe('where the copy and KataGo disagree', () => {
  const A = at9('C3');
  const B = at9('G7');
  const C = at9('E5');
  const evalWith = (bestLoc: Loc, candidates = true): PositionEval => ({
    key: 'k',
    toPlay: 1,
    bWin: 0.5,
    bLead: 0,
    policy: [
      { loc: A, p: 0.5 },
      { loc: B, p: 0.3 },
      { loc: C, p: 0.2 },
    ],
    candidates: candidates
      ? [
          { loc: B, prior: 0.3, winrate: 0.6, scoreLead: 2.5, visits: 40 },
          { loc: A, prior: 0.5, winrate: 0.52, scoreLead: 1.0, visits: 20 },
          { loc: C, prior: 0.2, winrate: 0.45, scoreLead: -1.0, visits: 4 },
        ]
      : undefined,
    bestLoc,
    pv: [],
    visits: 64,
    depth: candidates ? 'deep' : 'fast',
    engine: { engine: 'fake', backend: 'cpu', modelId: 'm', modelName: 'm', modelVersion: 1 },
    analyzedAt: 0,
  });
  const record = (bestLoc: Loc, loc = A) => ({ gameId: 'g', index: 60, color: 1 as const, loc, bestLoc, scoreLoss: 1.8, winrateLoss: 0.04, size: 9, winBefore: 0.5 });

  it("measures a move's cost against KataGo's move", () => {
    const ev = evalWith(B);
    expect(moveCost(ev, A, null, B)).toEqual({ scoreLoss: 1.5, winrateLoss: expect.closeTo(0.08, 6), from: 'candidates' });
    expect(moveCost(ev, C)!.scoreLoss).toBeCloseTo(3.5, 6); // against the best-valued candidate
    expect(moveCost(ev, B, null, B)!.scoreLoss).toBe(0);
    const fast = evalWith(A, false);
    expect(moveCost(fast, A, { loc: A, scoreLoss: 1.8, winrateLoss: 0.04 })).toEqual({ scoreLoss: 1.8, winrateLoss: 0.04, from: 'played' });
    expect(moveCost(fast, B, { loc: A, scoreLoss: 1.8, winrateLoss: 0.04 })).toBeNull();
  });

  it("finds where the copy's first choice is not KataGo's", () => {
    const board = new Board(9);
    const src = (bestLoc: Loc, ev = evalWith(bestLoc)) => ({ record: record(bestLoc), eval: ev, board, lastOpp: null });
    // With the initial weights the copy follows the policy (A); KataGo's search prefers B.
    const res = copyVsKataGo(base(), src(B))!;
    const d = res.disagreement!;
    expect(d.copy).toMatchObject({ loc: A, prior: 0.5 });
    expect(d.copy.p).toBeCloseTo(0.5, 6);
    expect(d.kata).toMatchObject({ loc: B, prior: 0.3, value: { win: 0.6, lead: 2.5 } });
    expect(d.kata.p).toBeCloseTo(0.3, 6);
    expect(d.cost).toMatchObject({ scoreLoss: 1.5, from: 'candidates' });
    expect(d.expectedLoss).toBeCloseTo(0.75, 6);
    expect(d.top.map((p) => p.loc)).toEqual([A, B, C]);
    expect(d.id).toBe('g:60');
    // Agreement, and positions where KataGo passes, are not disagreements.
    expect(copyVsKataGo(base(), src(A))!.disagreement).toBeNull();
    expect(copyVsKataGo(base(), src(PASS))).toBeNull();
  });

  const dis = (id: string, p: number, loss: number | null, extra: Partial<Disagreement> = {}): Disagreement => ({
    id,
    gameId: 'g',
    index: 80,
    color: 1,
    size: 19,
    kata: { loc: 1, prior: 0.3, p: 0.1 },
    copy: { loc: 2, prior: 0.1, p },
    top: [],
    played: 2,
    winBefore: 0.5,
    cost: loss === null ? null : { scoreLoss: loss, winrateLoss: loss / 50, from: 'candidates' },
    expectedLoss: loss === null ? null : p * loss,
    ...extra,
  });

  it('ranks the telling ones by what the habit costs', () => {
    const list = [
      dis('small', 0.9, 0.6), // under a point
      dis('unknown', 0.9, null),
      dis('likely', 0.8, 3), // 2.4
      dis('costly', 0.3, 9), // 2.7
      dis('huge', 0.2, 60), // capped at 15: 3.0
      dis('rare', 0.1, 5), // 0.5
      dis('decided', 0.9, 8, { winBefore: 0.97 }),
      dis('opening-small', 0.9, 2, { index: 12 }),
      dis('opening-big', 0.5, 4, { index: 12 }), // 2.0
    ];
    expect(rankDisagreements(list).map((d) => d.id)).toEqual(['huge', 'costly', 'likely', 'opening-big', 'rare']);
    expect(habitCost(list[4])).toBeCloseTo(3, 6);
    // A looser winrate floor keeps the fairly decided game; a 9x9 opening is shorter.
    expect(isTellingDisagreement(list[6], { minLosingWinrate: 0.02 })).toBe(true);
    expect(isTellingDisagreement(dis('nine', 0.9, 2, { index: 12, size: 9 }))).toBe(true);
    expect(rankDisagreements(list, { minLoss: 0.5 }).map((d) => d.id)).toContain('small');
  });
});
