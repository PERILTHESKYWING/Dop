import type { LevelCalibration } from '../level/model';
import { MAX_RANK, MIN_RANK } from '../level/ranks';
import type { Loc } from '../go/types';
import type { DoppelPrediction } from './doppel';

/**
 * The strength dial: the copy keeps choosing the way the player chooses, but each move's
 * cost (points lost by KataGo's reckoning) is weighed against a budget set by the target
 * level. A move's weight is the copy's probability times exp(−loss / budget): at a strong
 * setting only near-best moves stay in play, and among those the one the player would
 * pick wins; at a weak setting the copy may make mistakes, but the mistakes it would make.
 */

/** "Full strength": only moves KataGo rates as (nearly) best. */
export const FULL_STRENGTH = MAX_RANK + 1;

const FALLBACK = (rank: number) => 0.35 + ((MAX_RANK - rank) / (MAX_RANK - MIN_RANK)) * 2.4;

/**
 * Points a player of `rank` loses per move on average (from the rank calibration, measured
 * the same way as the copy's candidates are), used as the budget.
 */
export function lossBudget(rank: number, cal: LevelCalibration | null): number {
  if (rank >= FULL_STRENGTH) return 0.12;
  const buckets = (cal?.buckets ?? []).filter((b) => b.games >= 8).sort((a, b) => a.rank - b.rank);
  if (buckets.length < 2) return FALLBACK(rank);
  if (rank <= buckets[0].rank) return buckets[0].features.loss;
  if (rank >= buckets[buckets.length - 1].rank) return buckets[buckets.length - 1].features.loss;
  for (let i = 1; i < buckets.length; i++) {
    const a = buckets[i - 1], b = buckets[i];
    if (rank <= b.rank) {
      const t = (rank - a.rank) / (b.rank - a.rank);
      return a.features.loss + t * (b.features.loss - a.features.loss);
    }
  }
  return FALLBACK(rank);
}

/** Points that one network look per move cannot reliably tell apart. */
const NOISE = 0.3;

export interface StyledChoice {
  loc: Loc;
  /** The copy's own probability for it. */
  p: number;
  loss: number;
}

/**
 * Pick a move among the copy's candidates whose loss is known. `sample` false takes the
 * heaviest; otherwise draw in proportion to the weights. Moves costing far more than the
 * budget are never chosen when something cheaper exists.
 */
export function chooseStyled(
  preds: readonly DoppelPrediction[],
  losses: ReadonlyMap<Loc, number>,
  budget: number,
  opts: { sample?: boolean; rng?: () => number } = {},
): StyledChoice | null {
  const known = preds.filter((p) => losses.has(p.loc)).map((p) => ({ loc: p.loc, p: p.p, loss: Math.max(0, losses.get(p.loc)!) }));
  if (!known.length) return null;
  const cap = 4 * budget + 1.5;
  const pool = known.some((k) => k.loss <= cap) ? known.filter((k) => k.loss <= cap) : [known.reduce((a, b) => (b.loss < a.loss ? b : a))];
  // Differences this small are within the noise of KataGo's quick look, so they don't count against a move.
  const w = pool.map((k) => Math.max(k.p, 1e-4) * Math.exp(-Math.max(0, k.loss - NOISE) / Math.max(budget, 0.05)));
  if (!opts.sample) return pool[w.indexOf(Math.max(...w))];
  const z = w.reduce((a, b) => a + b, 0);
  let r = (opts.rng ?? Math.random)() * z;
  for (let i = 0; i < pool.length; i++) {
    r -= w[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}
