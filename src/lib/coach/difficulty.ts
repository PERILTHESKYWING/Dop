import type { Loc } from '../go/types';
import { rankLabel } from '../level/ranks';
import type { MoveChoice } from './choices';

/**
 * How hard a move is to find, by level. Fitted on rank-labelled Fox games and professional
 * games (scripts/move-fit.ts): among the choices a position offers (choices.ts), a player of
 * a given rank picks move i with probability proportional to
 *   exp(a·log(prior_i) − b·loss_i − c·winLoss_i)
 * so weaker players follow what looks natural (a) and stronger ones also weigh what a move
 * is worth (b, c). A move the network's first look undervalues, and that only a careful read
 * shows to be right, comes out rare at every level: that is what makes it hard.
 */

export const DIFFICULTY_FEATURES = ['logPrior', 'loss', 'winLoss', 'other'] as const;

export interface DifficultyModel {
  version: 2;
  modelId: string;
  source: string;
  /** Ranks (1k = 0, 1d = 1, pro = 10) with fitted coefficients, ascending. */
  ranks: number[];
  coef: number[][];
  positions: number;
  /** Held-out accuracy of the fit (scripts/move-fit.ts). */
  heldOut?: { positions: number; logLik: number; logLikPolicy: number; calibrationGap: number };
  createdAt: string;
}

export const PRO_RANK = 10;
const PRIOR_FLOOR = 1e-5;
export const LOSS_CAP = 15;

type ChoiceLike = Pick<MoveChoice, 'prior' | 'loss' | 'winLoss'> & { top?: boolean };

export function choiceFeatures(c: Pick<MoveChoice, 'prior' | 'loss' | 'winLoss'>): number[] {
  return [Math.log(Math.max(c.prior, PRIOR_FLOOR)), -Math.min(Math.max(c.loss, 0), LOSS_CAP), -Math.max(c.winLoss, 0), 0];
}

/**
 * The alternatives a player chooses among: each listed move, plus "something else" (every
 * move not listed, weighted by the network's total prior for them). Players who often play
 * unusual moves put their weight on "something else", not on any one unusual move, so a
 * hidden good move does not look easy just because weak players play at random.
 */
export function choiceTable(choices: readonly ChoiceLike[]): number[][] {
  const rest = 1 - choices.reduce((a, c) => a + c.prior, 0);
  return [...choices.map(choiceFeatures), [Math.log(Math.max(rest, PRIOR_FLOOR)), 0, 0, 1]];
}

/** Probability of each choice for coefficients `w`. */
export function choiceProbs(w: readonly number[], feats: readonly number[][]): number[] {
  const u = feats.map((f) => f.reduce((a, x, k) => a + x * w[k], 0));
  const m = Math.max(...u);
  const e = u.map((x) => Math.exp(x - m));
  const z = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / z);
}

function coefAt(model: DifficultyModel, rank: number): number[] {
  const rs = model.ranks;
  if (rank <= rs[0]) return model.coef[0];
  if (rank >= rs[rs.length - 1]) return model.coef[rs.length - 1];
  const i = rs.findIndex((r) => r >= rank);
  const t = (rank - rs[i - 1]) / (rs[i] - rs[i - 1]);
  return model.coef[i].map((c, k) => model.coef[i - 1][k] + t * (c - model.coef[i - 1][k]));
}

/** How often a player of `rank` plays `loc` in this position (0..1), or null if it is not among the choices. */
export function findRate(model: DifficultyModel, rank: number, choices: readonly MoveChoice[], loc: Loc): number | null {
  const i = choices.findIndex((c) => c.loc === loc);
  if (i < 0) return null;
  return choiceProbs(coefAt(model, rank), choiceTable(choices))[i];
}

/** Levels the difficulty is reported at. */
export const REPORT_RANKS = [-14, -9, -4, 1, 5, PRO_RANK];

export interface FindRates {
  rank: number;
  label: string;
  rate: number;
}

export function findRates(model: DifficultyModel, choices: readonly MoveChoice[], loc: Loc, ranks = REPORT_RANKS): FindRates[] {
  return ranks.flatMap((rank) => {
    const rate = findRate(model, rank, choices, loc);
    return rate === null ? [] : [{ rank, label: rank >= PRO_RANK ? 'pro' : rankLabel(rank), rate }];
  });
}

/** The lowest listed rank that finds the move at least `share` of the time, or null (not even pros, usually). */
export function levelThatFinds(model: DifficultyModel, choices: readonly MoveChoice[], loc: Loc, share = 0.5): number | null {
  for (let r = -17; r <= PRO_RANK; r++) {
    const p = findRate(model, r, choices, loc);
    if (p !== null && p >= share) return r;
  }
  return null;
}

/** Gap to the next-best move that makes the best move the only right one. */
export const ONLY_GAP_POINTS = 2;
export const ONLY_GAP_WIN = 0.08;
/** An only move strong amateurs (5d) find less often than this is brilliant. */
export const BRILLIANT_5D = 0.2;
export const STRONG_AMATEUR = 5;

/**
 * How much worse the next-best move is than KataGo's first choice, from a search's
 * candidates (winrate 0..1 and score for the side to move, most visits first). Null when
 * the search is too short to say or offers no alternative.
 */
export function nextBestGap(cands: readonly { loc: Loc; winrate: number; scoreLead: number; visits: number }[], visits: number, minVisits = 50): { points: number; win: number } | null {
  if (visits < minVisits || cands.length < 2) return null;
  const [best, ...rest] = cands;
  const others = rest.filter((c) => c.visits >= 2);
  if (!others.length) return null;
  return {
    points: Math.max(0, best.scoreLead - Math.max(...others.map((c) => c.scoreLead))),
    win: Math.max(0, best.winrate - Math.max(...others.map((c) => c.winrate))),
  };
}
