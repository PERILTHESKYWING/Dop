import { FEATURE_KEYS, PHASES, poolFeatures, type GameLevelSample, type LevelFeatures } from './stats';
import { clampRank, MAX_RANK, MIN_RANK } from './ranks';
import type { Phase } from '../types';

/**
 * Rank estimation from a player's games: "which rank would produce these numbers?"
 *
 * Each game side gives the level statistics of stats.ts (how often the player chose the
 * network's first choice, how likely the network found their moves, points lost, mistakes
 * and blunders). The calibration (scripts/rank-fit.ts, from rank-labelled Fox games) knows,
 * for every rank, what those numbers typically are and how much they vary from game to
 * game. For a player's games, every rank is scored by how likely it makes all of them; the
 * best-scoring ranks give the estimate and its range, which narrows as games are added.
 * The same is done per phase of the game.
 */

export interface LevelModel {
  /** Per feature: its typical value at rank r is c0 + c1·r + c2·r² + c3·r³. */
  mu: number[][];
  /**
   * How the features vary around that at a game of `nRef` measured moves, per band of
   * ranks (inverse covariance, flattened; and the covariance's log determinant).
   */
  bands: { upTo: number; prec: number[]; logdet: number }[];
  nRef: number;
  /** Spread of one game's estimate around the true rank, in ranks (held-out). */
  residualSd: number;
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
  all: LevelModel;
  phases: Partial<Record<Phase, LevelModel>>;
  buckets: RankBucket[];
  /** Held-out accuracy when k games are averaged: k → mean absolute error in ranks. */
  maeByGames: Record<string, number>;
  createdAt: string;
}

/** Game sides with fewer measured moves than this say too little. */
export const MIN_GAME_MOVES = 15;
/** However many games, an estimate is never tighter than this (ranks differ by server and time control). */
const SYSTEMATIC_SD = 0.8;
const STEP = 0.1;

function vector(f: LevelFeatures): number[] {
  return FEATURE_KEYS.map((k) => f[k]);
}

export function meanAt(m: LevelModel, r: number): number[] {
  return m.mu.map((c) => c.reduce((a, ci, i) => a + ci * r ** i, 0));
}

function bandAt(m: LevelModel, r: number) {
  return m.bands.find((b) => r <= b.upTo) ?? m.bands[m.bands.length - 1];
}

/** Log-likelihood of one game's statistics if the player were rank r. */
export function logLikelihood(m: LevelModel, f: LevelFeatures, r: number): number {
  const x = vector(f);
  const mu = meanAt(m, r);
  const b = bandAt(m, r);
  const k = x.length;
  // Fewer moves, noisier numbers: the covariance scales with nRef / n.
  const scale = Math.max(0.33, Math.min(3, f.n / m.nRef));
  let q = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) q += (x[i] - mu[i]) * b.prec[i * k + j] * (x[j] - mu[j]);
  return -0.5 * (q * scale + b.logdet - k * Math.log(scale));
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
  mean: number;
  q10: number;
  q90: number;
}

function posterior(m: LevelModel, list: readonly LevelFeatures[]): Posterior {
  const grid: number[] = [];
  for (let r = MIN_RANK; r <= MAX_RANK + 1e-9; r += STEP) grid.push(r);
  const ll = grid.map((r) => list.reduce((a, f) => a + logLikelihood(m, f, r), 0));
  const top = Math.max(...ll);
  const p = ll.map((l) => Math.exp(l - top));
  const z = p.reduce((a, b) => a + b, 0);
  let mean = 0;
  grid.forEach((r, i) => (mean += (r * p[i]) / z));
  const quantile = (q: number) => {
    let acc = 0;
    for (let i = 0; i < grid.length; i++) {
      acc += p[i] / z;
      if (acc >= q) return grid[i];
    }
    return grid[grid.length - 1];
  };
  return { mean, q10: quantile(0.1), q90: quantile(0.9) };
}

/** One game's estimate. */
export function predictOne(m: LevelModel, f: LevelFeatures): number {
  return posterior(m, [f]).mean;
}

/** All the games together: the estimate and an 80% range. */
export function combine(m: LevelModel, list: readonly LevelFeatures[]): LevelEstimate | null {
  const ok = list.filter((f) => f.n >= MIN_GAME_MOVES);
  if (!ok.length) return null;
  const post = posterior(m, ok);
  const sys = 1.28 * SYSTEMATIC_SD;
  const lowGap = Math.hypot(post.mean - post.q10, sys);
  const highGap = Math.hypot(post.q90 - post.mean, sys);
  return {
    rank: clampRank(post.mean),
    low: clampRank(post.mean - lowGap),
    high: clampRank(post.mean + highGap),
    games: ok.length,
    moves: ok.reduce((a, f) => a + f.n, 0),
    perGame: ok.map((f) => clampRank(predictOne(m, f))),
  };
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
  const overall = combine(cal.all, samples.map((s) => s.all));
  if (!overall) return null;
  const phases: Partial<Record<Phase, LevelEstimate>> = {};
  for (const p of PHASES) {
    const m = cal.phases[p];
    if (!m) continue;
    const e = combine(m, samples.map((s) => s.phases[p]).filter((f): f is LevelFeatures => !!f));
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
