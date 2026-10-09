import { FEATURE_KEYS, PHASES, poolFeatures, type GameLevelSample, type LevelFeatures } from './stats';
import { clampRank, MAX_RANK, MIN_RANK } from './ranks';
import type { Phase } from '../types';

/**
 * Rank estimation from a player's games: "which rank would produce these numbers?"
 *
 * Each game side gives the level statistics of stats.ts (how often the player chose the
 * network's first choice, how likely the network found their moves, points lost, mistakes
 * and blunders, per phase, and how often they got each kind of decision wrong). A ridge
 * regression fitted on rank-labelled games (scripts/rank-fit.ts) turns one game's numbers
 * into a raw score; the calibration also knows how that score spreads around each true
 * rank, for games of each length. For a player's games, every rank from 18k to AI is
 * scored by how likely it makes all of their games' scores; the best-scoring ranks give
 * the estimate and its range, which narrows as games are added. The same is done per
 * phase of the game with models that only see that phase.
 */

export interface RidgeModel {
  /** Whole game (with phases and decision errors) or one phase only. */
  phase: Phase | null;
  /** Decision signatures used as features (whole-game model only). */
  sigs: string[];
  /** Feature standardisation and coefficients (see ridgeFeatures). */
  mean: number[];
  sd: number[];
  beta: number[];
  /** A game's typical score per true rank (index rank - lo, never decreasing) ... */
  centre: number[];
  /** ... give or take spread[rank - lo][length bucket] (see LENGTH_BUCKETS). */
  lo: number;
  spread: number[][];
  /** Highest rank the model was fitted on; estimates do not go beyond it. */
  top: number;
  /** Mean absolute error of one game's estimate on held-out games. */
  maeGame: number;
}

export interface RankBucket {
  rank: number;
  games: number;
  features: LevelFeatures;
  /** Per signature: [times the decision arose, times it was got wrong], pooled over the corpus at this rank. */
  signatures: Record<string, [number, number]>;
}

export interface LevelCalibration {
  version: number;
  /** Network the corpus was measured with; other networks shift the numbers. */
  modelId: string;
  source: string;
  samples: number;
  games: number;
  features: readonly string[];
  all: RidgeModel;
  phases: Partial<Record<Phase, RidgeModel>>;
  /**
   * The same, fitted on strong players only (TOP_TRAIN_FROM and up): what tells a 9 dan, a
   * professional, a top professional and AI apart is lost in a model of every rank.
   */
  top?: { all: RidgeModel; phases: Partial<Record<Phase, RidgeModel>> };
  buckets: RankBucket[];
  /** Held-out accuracy when k games are averaged: k → mean absolute error in ranks. */
  maeByGames: Record<string, number>;
  createdAt: string;
}

/** Game sides with fewer measured moves than this say too little. */
export const MIN_GAME_MOVES = 15;
/** Phases with fewer measured moves than this are left out of a game's features. */
export const MIN_PHASE_MOVES = 5;
/** However many games, an estimate is never tighter than this (ranks differ by server and time control). */
const SYSTEMATIC_SD = 0.6;
const STEP = 0.1;
/** Measured moves at which a game's spread changes: under 30, under 50, under 80, more. */
export const LENGTH_BUCKETS = [30, 50, 80];

export const lengthBucket = (n: number) => {
  const i = LENGTH_BUCKETS.findIndex((b) => n < b);
  return i < 0 ? LENGTH_BUCKETS.length : i;
};

/** What a level model is fed: the whole-game sample, or one phase's numbers. */
export type RidgeInput = GameLevelSample | LevelFeatures;

const isSample = (x: RidgeInput): x is GameLevelSample => 'all' in x;

/** The six level numbers, the move count, and their pairwise products. */
function core(f: LevelFeatures, v: number[]) {
  const start = v.length;
  for (const k of FEATURE_KEYS) v.push(f[k]);
  v.push(Math.log(f.n));
  const end = v.length;
  for (let i = start; i < end; i++) for (let j = i; j < end; j++) v.push(v[i] * v[j]);
}

/**
 * The regression's inputs (before standardisation). Whole game: the level numbers, how
 * each phase differs from them, and each kind of decision's error rate (smoothed) and
 * frequency. One phase: that phase's numbers only.
 */
export function ridgeFeatures(m: Pick<RidgeModel, 'phase' | 'sigs'>, x: RidgeInput): number[] {
  const v: number[] = [];
  if (!isSample(x)) {
    core(x, v);
    return v;
  }
  const a = x.all;
  core(a, v);
  for (const p of PHASES) {
    const f = x.phases[p];
    const has = !!f && f.n >= MIN_PHASE_MOVES;
    v.push(has ? 1 : 0);
    for (const k of FEATURE_KEYS) v.push(has ? f![k] - a[k] : 0);
  }
  for (const id of m.sigs) {
    const [c, e] = x.signatures[id] ?? [0, 0];
    v.push((e + 0.3) / (c + 3));
    v.push(Math.log1p(c));
  }
  return v;
}

/** One game's raw score (on the rank scale). */
export function ridgeScore(m: RidgeModel, x: RidgeInput): number {
  const v = ridgeFeatures(m, x);
  let s = m.beta[0];
  for (let j = 0; j < v.length; j++) s += m.beta[j + 1] * ((v[j] - m.mean[j]) / m.sd[j]);
  return s;
}

const movesOf = (x: RidgeInput) => (isSample(x) ? x.all.n : x.n);

/** Typical score at rank r, between the whole ranks. */
export function centreAt(m: Pick<RidgeModel, 'centre' | 'lo'>, r: number): number {
  const x = Math.max(0, Math.min(m.centre.length - 1, r - m.lo));
  const i = Math.min(m.centre.length - 2, Math.floor(x));
  if (i < 0) return m.centre[0];
  return m.centre[i] + (x - i) * (m.centre[i + 1] - m.centre[i]);
}

function spreadAt(m: RidgeModel, r: number, n: number): number {
  const row = m.spread[Math.max(0, Math.min(m.spread.length - 1, Math.round(r) - m.lo))];
  return row[Math.min(row.length - 1, lengthBucket(n))];
}

/** Log-likelihood of one game's score if the player were rank r. */
export function logLikelihood(m: RidgeModel, score: number, n: number, r: number): number {
  const s = spreadAt(m, r, n);
  const z = (score - centreAt(m, r)) / s;
  return -0.5 * z * z - Math.log(s);
}

export interface LevelEstimate {
  rank: number;
  /** 80% range. */
  low: number;
  high: number;
  games: number;
  moves: number;
  /** Per game estimates, oldest first, for the trend. */
  perGame: number[];
}

interface Posterior {
  median: number;
  q10: number;
  q90: number;
}

function posterior(m: RidgeModel, list: readonly { score: number; n: number }[]): Posterior {
  const grid: number[] = [];
  const top = Math.min(MAX_RANK, m.top);
  for (let r = Math.max(MIN_RANK, m.lo); r <= top + 1e-9; r += STEP) grid.push(r);
  const ll = grid.map((r) => list.reduce((a, g) => a + logLikelihood(m, g.score, g.n, r), 0));
  const best = Math.max(...ll);
  const p = ll.map((l) => Math.exp(l - best));
  const z = p.reduce((a, b) => a + b, 0);
  const quantile = (q: number) => {
    let acc = 0;
    for (let i = 0; i < grid.length; i++) {
      acc += p[i] / z;
      if (acc >= q) {
        // Interpolate inside the step, so estimates are not stuck on the grid.
        const over = (acc - q) / (p[i] / z);
        return grid[i] + STEP * (0.5 - over);
      }
    }
    return grid[grid.length - 1];
  };
  return { median: quantile(0.5), q10: quantile(0.1), q90: quantile(0.9) };
}

/** One game's estimate. */
export function predictOne(m: RidgeModel, x: RidgeInput): number {
  return posterior(m, [{ score: ridgeScore(m, x), n: movesOf(x) }]).median;
}

/** All the games together: the estimate and an 80% range. */
export function combine(m: RidgeModel, list: readonly RidgeInput[]): LevelEstimate | null {
  const ok = list.filter((x) => movesOf(x) >= (m.phase ? MIN_PHASE_MOVES * 2 : MIN_GAME_MOVES));
  if (!ok.length) return null;
  const scored = ok.map((x) => ({ score: ridgeScore(m, x), n: movesOf(x) }));
  const post = posterior(m, scored);
  const sys = 1.28 * SYSTEMATIC_SD;
  const lowGap = Math.hypot(post.median - post.q10, sys);
  const highGap = Math.hypot(post.q90 - post.median, sys);
  return {
    rank: clampRank(post.median),
    low: clampRank(post.median - lowGap),
    high: clampRank(post.median + highGap),
    games: ok.length,
    moves: scored.reduce((a, g) => a + g.n, 0),
    perGame: scored.map((g) => clampRank(posterior(m, [g]).median)),
  };
}

/** The strong-player models are fitted from this rank up ... */
export const TOP_TRAIN_FROM = 6;
/** ... and take over from the all-rank estimate between these ranks. */
const TOP_BLEND: [number, number] = [6.5, 8.5];

const mix = (a: number, b: number, w: number) => a + (b - a) * w;

/**
 * The all-rank estimate, handed over to the strong-player model for strong players. Who
 * counts as strong is decided by `gate` (a phase follows the whole game's estimate), or by
 * the all-rank estimate itself.
 */
export function combineTiered(base: RidgeModel, top: RidgeModel | undefined, list: readonly RidgeInput[], gate?: number): LevelEstimate | null {
  const b = combine(base, list);
  if (!b || !top) return b;
  const w = Math.max(0, Math.min(1, ((gate ?? b.rank) - TOP_BLEND[0]) / (TOP_BLEND[1] - TOP_BLEND[0])));
  if (w === 0) return b;
  const t = combine(top, list);
  if (!t) return b;
  return {
    ...b,
    rank: mix(b.rank, t.rank, w),
    low: mix(b.low, t.low, w),
    high: mix(b.high, t.high, w),
    perGame: b.perGame.map((r, i) => mix(r, t.perGame[i] ?? r, gate !== undefined ? w : Math.max(0, Math.min(1, (r - TOP_BLEND[0]) / (TOP_BLEND[1] - TOP_BLEND[0]))))),
  };
}

/** Estimate from games (whole game when `phase` is null, else that phase's numbers). */
export function estimateWith(cal: LevelCalibration, phase: Phase | null, list: readonly RidgeInput[], gate?: number): LevelEstimate | null {
  const base = phase ? cal.phases[phase] : cal.all;
  if (!base) return null;
  return combineTiered(base, phase ? cal.top?.phases[phase] : cal.top?.all, list, gate);
}

export interface PlayerLevel {
  overall: LevelEstimate;
  phases: Partial<Record<Phase, LevelEstimate>>;
  /** The corpus rank bucket closest to the estimate (for "typical at your level"). */
  peers: RankBucket | null;
  /** Pooled signature counts of this player (network-pass records). */
  signatures: Record<string, [number, number]>;
  /** The player's statistics over all measured games. */
  pooled: LevelFeatures;
}

export function estimateLevel(cal: LevelCalibration, samples: readonly GameLevelSample[]): PlayerLevel | null {
  const overall = estimateWith(cal, null, samples);
  if (!overall) return null;
  const phases: Partial<Record<Phase, LevelEstimate>> = {};
  for (const p of PHASES) {
    const e = estimateWith(cal, p, samples.map((s) => s.phases[p]).filter((f): f is LevelFeatures => !!f), overall.rank);
    if (e) phases[p] = e;
  }
  const signatures: Record<string, [number, number]> = {};
  for (const s of samples)
    for (const [id, [c, e]] of Object.entries(s.signatures)) {
      const t = (signatures[id] ??= [0, 0]);
      t[0] += c;
      t[1] += e;
    }
  return { overall, phases, peers: peerBucket(cal, overall.rank), signatures, pooled: poolFeatures(samples.map((s) => s.all))! };
}

/** The rank bucket nearest to `rank`, with its neighbours' counts pooled in for stability. */
export function peerBucket(cal: LevelCalibration, rank: number): RankBucket | null {
  if (!cal.buckets.length) return null;
  const r = Math.round(rank);
  const near = cal.buckets.filter((b) => Math.abs(b.rank - r) <= 1);
  const centre = cal.buckets.reduce((a, b) => (Math.abs(b.rank - r) < Math.abs(a.rank - r) ? b : a));
  if (!near.length) return centre;
  const signatures: Record<string, [number, number]> = {};
  for (const b of near)
    for (const [id, [c, e]] of Object.entries(b.signatures)) {
      const t = (signatures[id] ??= [0, 0]);
      t[0] += c;
      t[1] += e;
    }
  return { ...centre, signatures };
}
