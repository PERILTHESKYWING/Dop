import { findRate, PRO_RANK, type DifficultyModel } from '../coach/difficulty';
import type { MoveChoice } from '../coach/choices';
import { MAX_RANK, MIN_RANK, rankLabel } from '../level/ranks';
import type { Loc } from '../go/types';

/**
 * Problem levels and the player's problem rating.
 *
 * A problem's level is the rank at which a player finds the whole answer about half the
 * time, from the move-difficulty model fitted on real Fox and professional games
 * (lib/coach/difficulty.ts): how natural each answer move looks to the network and what the
 * alternatives cost. The first move is the key; the later ones count half, since once the
 * key is found the rest is usually easier to read.
 */

export interface AnswerStep {
  choices: MoveChoice[];
  answer: Loc;
}

/** Lowest and highest levels problems are labelled with (15k to 7d, as on 101weiqi). */
export const PROBLEM_MIN_LEVEL = -14;
export const PROBLEM_MAX_LEVEL = 7;
/**
 * A problem's level: the lowest rank whose (weighted geometric) mean chance of finding
 * each answer move reaches this. The model gives even an obvious move only a 50-70%
 * find rate for weak players (they often play something else entirely), so the bar sits
 * a little below one half.
 */
export const SOLVE_SHARE = 0.45;

export function solveChance(model: DifficultyModel, rank: number, steps: readonly AnswerStep[]): number {
  let logp = 0;
  let weight = 0;
  steps.forEach((s, i) => {
    const p = findRate(model, rank, s.choices, s.answer) ?? 0.05;
    const w = i === 0 ? 1 : 0.5;
    logp += w * Math.log(Math.max(p, 1e-4));
    weight += w;
  });
  return weight ? Math.exp(logp / weight) : 0;
}

export function problemLevel(model: DifficultyModel, steps: readonly AnswerStep[]): number {
  for (let r = PROBLEM_MIN_LEVEL; r <= PRO_RANK; r++) if (solveChance(model, r, steps) >= SOLVE_SHARE) return r;
  return PROBLEM_MAX_LEVEL;
}

/** The solve chance at 1k that levels are ranked by (see levelsByQuantile). */
export const SCORE_RANK = 0;

/**
 * Levels from difficulty scores. The level model's find rates are fitted on whole-board
 * choices, where weak players often play something else entirely, so its absolute levels
 * come out too high for local problems. Its ordering is what it gets right: problems are
 * ranked by their solve chance at 1k (higher = easier) and spread over 15k to 7d within
 * each category, so every level has problems to solve.
 */
export function levelsByQuantile(scores: readonly number[]): number[] {
  const order = scores.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0]);
  const span = PROBLEM_MAX_LEVEL - PROBLEM_MIN_LEVEL + 1;
  const out = new Array<number>(scores.length);
  order.forEach(([, i], k) => {
    out[i] = PROBLEM_MIN_LEVEL + Math.min(span - 1, Math.floor(((k + 0.5) / order.length) * span));
  });
  return out;
}

export const clampLevel = (r: number) => Math.max(PROBLEM_MIN_LEVEL, Math.min(PROBLEM_MAX_LEVEL, Math.round(r)));

export const levelLabel = (r: number) => rankLabel(clampLevel(r));

/**
 * The player's problem rating, Elo style, on the rank scale ×100 (a 1k player solving 1k
 * problems half the time sits at 2000, one rank = 100 points).
 */
export const RATING_PER_RANK = 100;
export const RATING_1K = 2000;
export const rankToRating = (r: number) => RATING_1K + r * RATING_PER_RANK;
export const ratingToRank = (x: number) => Math.max(MIN_RANK, Math.min(MAX_RANK, (x - RATING_1K) / RATING_PER_RANK));

/**
 * Expected score against a problem. The scale makes a problem one rank above the player a
 * 36% solve (and one rank below a 64%), close to how the level model's solve chances fall.
 */
export const expectedSolve = (rating: number, level: number) => 1 / (1 + 10 ** ((rankToRating(level) - rating) / 400));

/**
 * New rating after a problem. Fast at first (K 48 for the first 20 problems), then steadier.
 * A hint or a second try counts as half a solve.
 */
export function updateRating(rating: number, level: number, score: number, solved: number): number {
  const k = solved < 20 ? 48 : solved < 100 ? 32 : 20;
  return rating + k * (score - expectedSolve(rating, level));
}
