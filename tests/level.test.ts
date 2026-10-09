import { describe, expect, it } from 'vitest';
import { parseRank, rankLabel, rankRangeLabel, rankTier } from '../src/lib/level/ranks';
import { levelFeatures, poolFeatures, type LevelFeatures } from '../src/lib/level/stats';
import { combine, estimateLevel, predictOne, ridgeFeatures, type LevelCalibration, type RidgeModel } from '../src/lib/level/model';
import { peerComparison, weaknessPriority } from '../src/lib/level/peers';
import { chooseStyled, FULL_STRENGTH, lossBudget } from '../src/lib/profile/strength';
import type { MoveRecord, Weakness } from '../src/lib/types';

describe('ranks', () => {
  it('parses kyu, dan and Fox ranks onto one scale', () => {
    expect(parseRank('1k')).toBe(0);
    expect(parseRank('18级')).toBe(-17);
    expect(parseRank('5段')).toBe(5);
    expect(parseRank('3 dan')).toBe(3);
    expect(parseRank('P9')).toBe(10);
    expect(parseRank('P9段')).toBe(10);
    expect(parseRank('10d')).toBeNull();
    expect(parseRank('')).toBeNull();
    expect(parseRank('?')).toBeNull();
  });
  it('labels ranks and ranges with one decimal, up to 12d', () => {
    expect(rankLabel(0.4)).toBe('1.0k');
    expect(rankLabel(0.6)).toBe('1.0d');
    expect(rankLabel(2.64)).toBe('2.6d');
    expect(rankLabel(8.74)).toBe('8.7d');
    expect(rankLabel(-4.2)).toBe('5.2k');
    expect(rankLabel(14)).toBe('12.0d');
    expect(rankRangeLabel(-1.4, 1.2)).toBe('2.4k – 1.2d');
    expect(rankTier(9.2)).toBeNull();
    expect(rankTier(10.1)).toBe('Pro');
    expect(rankTier(11)).toBe('Top pro');
    expect(rankTier(11.8)).toBe('AI');
  });
});

const rec = (over: Partial<MoveRecord>): MoveRecord => ({ playedRank: 1, playedPolicy: 0.5, scoreLoss: 0, winBefore: 0.5, ...over }) as MoveRecord;

describe('level statistics', () => {
  it('measures match rates and losses, skipping decided positions', () => {
    const f = levelFeatures([rec({}), rec({ playedRank: 3, playedPolicy: 0.1, scoreLoss: 3 }), rec({ playedRank: 20, playedPolicy: 0, scoreLoss: 30 }), rec({ winBefore: 0.99, scoreLoss: 50 })])!;
    expect(f.n).toBe(3);
    expect(f.top1).toBeCloseTo(1 / 3);
    expect(f.top3).toBeCloseTo(2 / 3);
    expect(f.loss).toBeCloseTo((0 + 3 + 10) / 3); // capped at 10
    expect(f.mistakes).toBeCloseTo(2 / 3);
    expect(f.blunders).toBeCloseTo(1 / 3);
  });
  it('pools games by move count', () => {
    const a = { n: 10, top1: 0.2, top3: 0.5, logp: -2, loss: 1, mistakes: 0.1, blunders: 0 };
    const b = { n: 30, top1: 0.6, top3: 0.9, logp: -1, loss: 0.5, mistakes: 0.05, blunders: 0 };
    expect(poolFeatures([a, b])!.top1).toBeCloseTo(0.5);
  });
});

/** A toy model: a game's score is 40·top1 − 16 on the rank scale (top1 0.4 is 1k), ±3 ranks. */
function toyModel(): RidgeModel {
  const shape = { phase: null, sigs: [] as string[] };
  const d = ridgeFeatures(shape, { all: feats(0.4, 1), phases: {}, signatures: {} }).length;
  const beta = new Array(d + 1).fill(0);
  beta[0] = 0.4 * 40 - 16;
  beta[1] = 40; // top1 is the first feature; mean 0.4, sd 1 below
  const mean = new Array(d).fill(0);
  mean[0] = 0.4;
  return { ...shape, mean, sd: new Array(d).fill(1), beta, centre: Array.from({ length: 30 }, (_, i) => i - 17), lo: -17, spread: [[3, 3, 3, 3]], top: 12, maeGame: 2.4 };
}
const sample = (f: LevelFeatures) => ({ all: f, phases: {}, signatures: {} });
function feats(top1: number, loss: number, n = 60): LevelFeatures {
  return { n, top1, top3: 0.6, logp: -2, loss, mistakes: 0.1, blunders: 0.03 };
}
const model = toyModel();

describe('level model', () => {
  it('rates stronger play higher, and finds the rank that produces the numbers', () => {
    expect(predictOne(model, sample(feats(0.5, 0.6)))).toBeGreaterThan(predictOne(model, sample(feats(0.3, 1.5))));
    // top1 0.45 scores 2: twenty such games put the player at 2d.
    expect(combine(model, Array.from({ length: 20 }, () => sample(feats(0.45, 1))))!.rank).toBeCloseTo(2, 0);
    // Far beyond anything human: capped at AI.
    expect(combine(model, Array.from({ length: 20 }, () => sample(feats(0.9, 0))))!.rank).toBeCloseTo(12, 0);
  });
  it('narrows the range as games are added', () => {
    const one = combine(model, [sample(feats(0.45, 0.8))])!;
    const ten = combine(model, Array.from({ length: 10 }, () => sample(feats(0.45, 0.8))))!;
    expect(Math.abs(ten.rank - one.rank)).toBeLessThan(1);
    expect(ten.high - ten.low).toBeLessThan(one.high - one.low);
    expect(combine(model, [sample(feats(0.45, 0.8, 5))])).toBeNull(); // too few moves
  });
  it('compares decisions with rank peers', () => {
    const cal = {
      all: model,
      phases: {},
      buckets: [
        { rank: -2, games: 50, features: feats(0.4, 1), signatures: { local_over_tenuki: [200, 40] as [number, number] } },
        { rank: -1, games: 50, features: feats(0.42, 0.9), signatures: { local_over_tenuki: [200, 36] as [number, number] } },
      ],
    } as unknown as LevelCalibration;
    const level = estimateLevel(cal, [{ all: feats(0.4, 1), phases: {}, signatures: { local_over_tenuki: [40, 20] } }])!;
    expect(level.overall.rank).toBeCloseTo(0, 0);
    level.peers = { ...cal.buckets[0], signatures: { local_over_tenuki: [400, 76] } };
    const p = peerComparison(level, 'local_over_tenuki')!;
    expect(p.peerRate).toBeCloseTo(0.19);
    expect(p.ratio).toBeGreaterThan(1.5);
    const w = { totalScoreLoss: 10, confidence: 1 } as Weakness;
    expect(weaknessPriority({ ...w, peer: { ...p, ratio: 3 } })).toBe(20); // at most doubled
    expect(weaknessPriority(w)).toBe(10);
  });
});

describe('strength dial', () => {
  const preds = [
    { loc: 1, p: 0.6 },
    { loc: 2, p: 0.3 },
    { loc: 3, p: 0.1 },
  ];
  const losses = new Map([
    [1, 4],
    [2, 0.2],
    [3, 0],
  ]);
  it('keeps the style but cuts costly moves at high strength', () => {
    expect(chooseStyled(preds, losses, 0.12)!.loc).toBe(2); // the likeliest cheap move, not KataGo's best (3)
    expect(chooseStyled(preds, losses, 10)!.loc).toBe(1); // a very weak setting plays the costly habit
    const picks = Array.from({ length: 400 }, (_, i) => chooseStyled(preds, losses, 2, { sample: true, rng: () => (i + 0.5) / 400 })!.loc);
    expect(picks.filter((l) => l === 1).length).toBeGreaterThan(40); // sampled, the habit still shows up at a weak setting
  });
  it('takes budgets from the calibration, weaker ranks losing more', () => {
    const cal = { buckets: [
      { rank: -10, games: 20, features: feats(0.3, 2) },
      { rank: 5, games: 20, features: feats(0.5, 0.5) },
    ] } as unknown as LevelCalibration;
    expect(lossBudget(-10, cal)).toBe(2);
    expect(lossBudget(-2.5, cal)).toBeCloseTo(1.25);
    expect(lossBudget(FULL_STRENGTH, cal)).toBeLessThan(0.2);
    expect(lossBudget(-15, null)).toBeGreaterThan(lossBudget(5, null));
  });
});
