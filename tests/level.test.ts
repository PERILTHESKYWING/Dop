import { describe, expect, it } from 'vitest';
import { parseRank, rankLabel, rankRangeLabel } from '../src/lib/level/ranks';
import { levelFeatures, poolFeatures, type LevelFeatures } from '../src/lib/level/stats';
import { combine, estimateLevel, predictOne, type LevelCalibration, type LevelModel } from '../src/lib/level/model';
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
    expect(parseRank('')).toBeNull();
    expect(parseRank('?')).toBeNull();
  });
  it('labels ranks and ranges', () => {
    expect(rankLabel(0.4)).toBe('1k');
    expect(rankLabel(2.6)).toBe('3d');
    expect(rankLabel(-4.2)).toBe('5k');
    expect(rankRangeLabel(-1.4, 1.2)).toBe('2k – 1d');
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

const VAR = [0.01, 0.01, 0.25, 0.25, 0.0025, 0.0009];
const model: LevelModel = {
  mu: [[0.4, 0.015], [0.6, 0.01], [-2, 0.05], [1, -0.05], [0.1, -0.004], [0.03, -0.002]],
  bands: [{ upTo: 99, prec: VAR.flatMap((v, i) => VAR.map((_, j) => (i === j ? 1 / v : 0))), logdet: VAR.reduce((a, v) => a + Math.log(v), 0) }],
  nRef: 60,
  residualSd: 3,
  maeGame: 2.4,
};
const feats = (top1: number, loss: number, n = 60): LevelFeatures => ({ n, top1, top3: 0.6, logp: -2, loss, mistakes: 0.1, blunders: 0.03 });

describe('level model', () => {
  it('rates stronger play higher, and finds the rank that produces the numbers', () => {
    expect(predictOne(model, feats(0.5, 0.6))).toBeGreaterThan(predictOne(model, feats(0.3, 1.5)));
    // Exactly what a 2-dan typically shows (per the model), over 20 games.
    const r = 2;
    const typical = { n: 60, top1: 0.4 + 0.015 * r, top3: 0.6 + 0.01 * r, logp: -2 + 0.05 * r, loss: 1 - 0.05 * r, mistakes: 0.1 - 0.004 * r, blunders: 0.03 - 0.002 * r };
    expect(combine(model, Array.from({ length: 20 }, () => typical))!.rank).toBeCloseTo(2, 0);
  });
  it('narrows the range as games are added', () => {
    const one = combine(model, [feats(0.45, 0.8)])!;
    const ten = combine(model, Array.from({ length: 10 }, () => feats(0.45, 0.8)))!;
    expect(Math.abs(ten.rank - one.rank)).toBeLessThan(1);
    expect(ten.high - ten.low).toBeLessThan(one.high - one.low);
    expect(combine(model, [feats(0.45, 0.8, 5)])).toBeNull(); // too few moves
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
