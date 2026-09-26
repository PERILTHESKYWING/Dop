import { computeMoveRecords } from '../analysis/records';
import type { GameAnalysis, GameRecord, MoveRecord, Phase, PositionEval } from '../types';
import type { Color } from '../go/types';

/**
 * Level statistics are measured on the network's own evaluation (one look, no search),
 * because that is what the rank calibration corpus was measured with: the same network
 * and the same arithmetic on both sides, so a player's numbers are comparable with the
 * corpus's numbers. Searched values are more accurate for review, but using them here
 * would compare two different rulers.
 */

/** The position as the network alone judged it, or null when that was not kept. */
export function networkEval(e: PositionEval | null): PositionEval | null {
  if (!e) return null;
  if (e.net) return { ...e, bWin: e.net.bWin, bLead: e.net.bLead, searched: false, depth: 'fast', candidates: undefined };
  // Only a tree search replaces the network's values; older "deep" evaluations kept them.
  if (e.searched) return null;
  return e.depth === 'fast' ? e : { ...e, depth: 'fast', candidates: undefined };
}

/** A game's analysis seen through the network pass only. */
export function networkAnalysis(a: GameAnalysis): GameAnalysis {
  return { ...a, evals: a.evals.map(networkEval) };
}

/** Per-move records from the network pass (see networkEval). */
export function networkRecords(game: GameRecord, analysis: GameAnalysis): MoveRecord[] {
  return computeMoveRecords(game, networkAnalysis(analysis)).records;
}

/** Share of a game's analysed moves that have network values. */
export function networkCoverage(a: GameAnalysis): number {
  if (!a.evals.length) return 0;
  return a.evals.filter((e) => networkEval(e) !== null).length / a.evals.length;
}

export interface LevelFeatures {
  /** Moves measured. */
  n: number;
  /** Played KataGo's first choice (network policy). */
  top1: number;
  /** Played one of its first three. */
  top3: number;
  /** Mean log-probability the network gave the played move (floored at 1e-4). */
  logp: number;
  /** Mean points lost per move, each move capped at LOSS_CAP. */
  loss: number;
  /** Share of moves losing more than 2 points. */
  mistakes: number;
  /** Share of moves losing more than 5 points. */
  blunders: number;
}

export const LOSS_CAP = 10;
/** Moves in positions this one-sided say little about skill. */
const DECIDED = 0.03;

export const FEATURE_KEYS = ['top1', 'top3', 'logp', 'loss', 'mistakes', 'blunders'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export function levelFeatures(records: readonly MoveRecord[]): LevelFeatures | null {
  const rs = records.filter((r) => r.winBefore > DECIDED && r.winBefore < 1 - DECIDED);
  if (!rs.length) return null;
  let top1 = 0, top3 = 0, logp = 0, loss = 0, mistakes = 0, blunders = 0;
  for (const r of rs) {
    if (r.playedRank === 1) top1++;
    if (r.playedRank <= 3) top3++;
    logp += Math.log(Math.max(r.playedPolicy, 1e-4));
    const l = Math.min(r.scoreLoss, LOSS_CAP);
    loss += l;
    if (r.scoreLoss > 2) mistakes++;
    if (r.scoreLoss > 5) blunders++;
  }
  const n = rs.length;
  return { n, top1: top1 / n, top3: top3 / n, logp: logp / n, loss: loss / n, mistakes: mistakes / n, blunders: blunders / n };
}

export const PHASES: Phase[] = ['opening', 'middlegame', 'endgame'];

export interface GameLevelSample {
  all: LevelFeatures;
  phases: Partial<Record<Phase, LevelFeatures>>;
  /** Per signature: [times the decision arose, times it was got wrong]. */
  signatures: Record<string, [number, number]>;
}

/** Everything the level model needs from one side of one game. */
export function gameLevelSample(records: readonly MoveRecord[], color: Color): GameLevelSample | null {
  const mine = records.filter((r) => r.color === color);
  const all = levelFeatures(mine);
  if (!all) return null;
  const phases: Partial<Record<Phase, LevelFeatures>> = {};
  for (const p of PHASES) {
    const f = levelFeatures(mine.filter((r) => r.features.phase === p));
    if (f) phases[p] = f;
  }
  const signatures: Record<string, [number, number]> = {};
  for (const r of mine) {
    for (const c of r.contexts) (signatures[c] ??= [0, 0])[0]++;
    for (const e of r.errors) (signatures[e] ??= [0, 0])[1]++;
  }
  return { all, phases, signatures };
}

/** Pool several games' features, weighting each by its move count. */
export function poolFeatures(list: readonly LevelFeatures[]): LevelFeatures | null {
  const n = list.reduce((a, f) => a + f.n, 0);
  if (!n) return null;
  const out: LevelFeatures = { n, top1: 0, top3: 0, logp: 0, loss: 0, mistakes: 0, blunders: 0 };
  for (const f of list) for (const k of FEATURE_KEYS) out[k] += (f[k] * f.n) / n;
  return out;
}
