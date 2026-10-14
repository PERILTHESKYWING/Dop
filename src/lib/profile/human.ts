import type { PositionContext } from '../go/features';
import { moveFeatures, pointFeatures } from '../go/features';
import { PASS, type Color, type Loc } from '../go/types';
import type { PointFeatures } from '../types';
import type { CopyDials } from './dials';
import { DEFAULT_DIALS } from './dials';
import { DEFAULT_GENOME, type Genome } from './genome';
import type { PhaseIndex, SituationIndex } from './doppel';
import { shapeOf } from './shape';
import { SIGNATURES } from './signatures';

/**
 * How the copy turns habits into a move, mistakes included. A person's mistake is rarely
 * a random move: it is a move that looks natural and fails when read out. So the copy
 * weighs each candidate by
 *   its habits' probability × exp(−points lost / τ) × (KataGo's instinct for it)^γ
 * where τ is set so the copy loses as many points per move as the player does in that
 * phase and situation, and the blunder guard removes moves nobody at that level plays by
 * accident. Mistakes of the kinds the player makes are favoured, and if the player tilts
 * after a mistake, so does the copy.
 */

/** Points that one network look per move cannot reliably tell apart. */
export const NOISE = 0.3;
/** Losses above this rank alike (a huge "loss" is usually a group whose fate the network misreads). */
export const CAP = 15;
/** A mistake and a blunder, in points. */
export const MISTAKE = 2;
export const BLUNDER = 5;
/**
 * An obvious blunder: a move of the kinds the guard stops (self-atari, filling an own eye,
 * leaving a big group in atari, diving into settled territory) that loses this much.
 */
export const OBVIOUS_LOSS = 1.5;
/** The previous own move lost this much: the next one may come from a tilted player. */
export const TILT_LOSS = 3;

export const FLAG = {
  contact: 1,
  atari: 2,
  cut: 4,
  hane: 8,
  invasion: 16,
  low: 32,
  high: 64,
  tenuki: 128,
  /** Guard: puts two or more of its own stones in atari. */
  selfAtari: 256,
  /** Guard: fills one of its own eyes. */
  ownEye: 512,
  /** Guard: leaves a living group of three or more stones in atari that KataGo's move saves. */
  ignoresAtari: 1024,
  /** Guard: lands deep in settled enemy territory with no contact. */
  deepEnemy: 2048,
} as const;
export const GUARD_FLAGS = FLAG.selfAtari | FLAG.ownEye | FLAG.ignoresAtari | FLAG.deepEnemy;
const FIGHT_FLAGS = FLAG.contact | FLAG.atari | FLAG.cut | FLAG.hane | FLAG.invasion;

/** A candidate as the chooser sees it. */
export interface CandInfo {
  loc: Loc;
  /** The copy's habits' probability (0 for a book move outside its candidates). */
  p: number;
  /** KataGo's policy prior. */
  prior: number;
  /** Points lost against the best candidate, when measured. */
  loss?: number;
  flags: number;
  /** Mistake kinds (SIGNATURES indices as bits) the move makes in this position. */
  sigs: number;
  /** Times the player played it here (opening book). */
  book?: number;
}

/**
 * The parts of a position the guard and style leanings look at. `bestSaves`: KataGo's
 * preferred move saves (or captures to save) a group in atari, so ignoring it is a blunder.
 */
export function candidateFlags(ctx: PositionContext, loc: Loc, color: Color, pf: PointFeatures, bestSaves = false): number {
  let f = 0;
  if (loc === PASS) return 0;
  const sh = shapeOf(ctx.board, loc, color);
  if (pf.contact) f |= FLAG.contact;
  if (pf.atari) f |= FLAG.atari;
  if (sh.cut) f |= FLAG.cut;
  if (sh.hane) f |= FLAG.hane;
  if (pf.invasion) f |= FLAG.invasion;
  if (pf.line <= 3) f |= FLAG.low;
  else f |= FLAG.high;
  if (pf.tenuki) f |= FLAG.tenuki;
  const b = ctx.board;
  if (pf.selfAtari) {
    const after = b.clone();
    after.koPoint = PASS;
    after.play(loc, color, true);
    const g = after.groupAt(loc);
    if (g && g.stones.length >= 2 && g.liberties.length === 1) f |= FLAG.selfAtari;
  }
  if (!pf.captures && !pf.savesAtari && pf.ownership > 0.8 && b.neighbors(loc).every((q) => b.stones[q] === color)) f |= FLAG.ownEye;
  if (bestSaves && !pf.savesAtari && !pf.captures && ctx.groups.some((g) => g.color === color && g.stones.length >= 3 && g.liberties.length === 1)) f |= FLAG.ignoresAtari;
  if (!pf.contact && !pf.captures && pf.ownership < -0.85 && ctx.hasEngineOwnership) f |= FLAG.deepEnemy;
  return f;
}

/** The mistake kinds (as bits over SIGNATURES) playing `loc` makes where KataGo prefers `best`. */
export function signatureMask(ctx: PositionContext, loc: Loc, best: Loc, color: Color, lastOpp: Loc | null, moveNumber: number, leadBefore: number): number {
  if (loc === best || loc === PASS) return 0;
  const f = moveFeatures(ctx, loc, best, color, lastOpp, moveNumber, leadBefore);
  let m = 0;
  SIGNATURES.forEach((s, i) => {
    if (s.context(f) && s.commits(f)) m |= 1 << i;
  });
  return m;
}

/** Flags and mistake kinds of each candidate, with KataGo's preferred move as `best`. */
export function describeCandidates(
  ctx: PositionContext,
  locs: readonly Loc[],
  color: Color,
  lastOpp: Loc | null,
  moveNumber: number,
  leadBefore: number,
  best: Loc,
): { flags: number; sigs: number }[] {
  const bf = best === PASS ? null : pointFeatures(ctx, best, color, lastOpp);
  const bestSaves = !!bf && (bf.savesAtari || (bf.captures > 0 && ctx.groups.some((g) => g.color === color && g.stones.length >= 3 && g.liberties.length === 1)));
  return locs.map((loc) => {
    if (loc === PASS) return { flags: 0, sigs: 0 };
    const pf = loc === best && bf ? bf : pointFeatures(ctx, loc, color, lastOpp);
    return { flags: candidateFlags(ctx, loc, color, pf, bestSaves), sigs: signatureMask(ctx, loc, best, color, lastOpp, moveNumber, leadBefore) };
  });
}

// ------------------------------------------------------------------ the player's mistakes

export interface PhaseMistakes {
  moves: number;
  /** Points lost per move (huge losses capped). */
  meanLoss: number;
  /** Share of moves losing MISTAKE / BLUNDER points or more. */
  mistakes: number;
  blunders: number;
}

export interface MistakeProfile {
  /** Points the player loses per move in each phase × situation cell (phase*3 + situation). */
  meanLoss: number[];
  moves: number[];
  /** The copy's τ in each cell, set so it loses as much as the player there. */
  tau: number[];
  /** All the player's moves, per phase. */
  byPhase: PhaseMistakes[];
  /**
   * The player's moves outside the copy's candidates (KataGo's top 10): the copy never plays
   * such moves, so its mistakes are matched to the player's moves among the candidates.
   */
  outside: { share: number; meanLoss: number };
  /** How much more the player loses on the move after a mistake (1: no tilt). */
  tilt: number;
  /** Mistake kinds: how much more (or less) often the player makes each than the copy would by itself. */
  types: { id: string; mult: number; you: number; copy: number }[];
}

export interface ChoiceState {
  phase: PhaseIndex;
  sit: SituationIndex;
  /** The copy's (or player's) previous move was a mistake of TILT_LOSS points or more. */
  afterMistake: boolean;
}

export interface ChoiceOptions {
  /** Use this τ instead of the profile's (calibration). */
  tau?: number;
  /** Points per move a target level loses (the strength dial), instead of the player's own rate. */
  budget?: number;
  /** Leave out the mistake kinds (calibration does this first). */
  noTypes?: boolean;
}

const cell = (s: ChoiceState) => s.phase * 3 + s.sit;
const fallbackTau = (meanLoss: number) => 0.1 + 0.6 * meanLoss;

/** τ for a state: calibrated for the player, scaled by the dials and the mood. */
export function tauFor(profile: MistakeProfile | undefined, state: ChoiceState, dials: CopyDials, genome: Genome, opts: ChoiceOptions = {}): number {
  let tau = opts.tau ?? (opts.budget !== undefined ? opts.budget : profile ? profile.tau[cell(state)] ?? fallbackTau(profile.meanLoss[cell(state)] ?? 1) : 0.8);
  if (opts.tau === undefined) {
    tau *= dials.mistakes;
    const tilted = dials.mood === 'tilted' || (dials.mood === 'auto' && state.afterMistake);
    if (tilted && profile && opts.budget === undefined) tau *= Math.pow(dials.mood === 'tilted' ? Math.max(profile.tilt, 1.3) : profile.tilt, genome.tiltK);
  }
  return Math.max(tau, 0.02);
}

/**
 * The copy's probability of playing each candidate. Candidates with a measured cost are the
 * ones it chooses among (with none measured, habits alone decide); the opening book mixes
 * in the player's own moves where the position is one they have played.
 */
export function choiceDistribution(
  cands: readonly CandInfo[],
  state: ChoiceState,
  model: { mistakes?: MistakeProfile; genome?: Genome },
  dials: CopyDials = DEFAULT_DIALS,
  opts: ChoiceOptions = {},
): number[] {
  const g = model.genome ?? DEFAULT_GENOME;
  const n = cands.length;
  if (!n) return [];
  const f = dials.faithfulness;
  const T = g.temperature * dials.variety;
  const anyLoss = cands.some((c) => c.loss !== undefined);
  const lw = new Float64Array(n);
  const out = new Array<boolean>(n).fill(false);
  const maxPrior = Math.max(...cands.map((c) => c.prior), 1e-6);
  const tau = anyLoss ? tauFor(model.mistakes, state, dials, g, opts) : 1;
  const types = !opts.noTypes && dials.types && model.mistakes?.types.length ? model.mistakes.types : null;
  for (let i = 0; i < n; i++) {
    const c = cands[i];
    let v = f * Math.log(Math.max(c.p, 1e-6)) + (1 - f) * Math.log(Math.max(c.prior, 1e-6));
    if (dials.fighting) v += dials.fighting * (c.flags & FIGHT_FLAGS ? 0.7 : -0.15);
    if (dials.territory) v += dials.territory * (c.flags & FLAG.low ? 0.5 : -0.5);
    if (dials.tenuki) v += dials.tenuki * (c.flags & FLAG.tenuki ? 0.8 : -0.2);
    v /= Math.max(T, 0.05);
    if (anyLoss) {
      // A book move nobody measured is the player's own: it costs nothing here.
      const L = c.loss ?? (c.book ? 0 : undefined);
      if (L === undefined) out[i] = true;
      else {
        const loss = Math.min(L, CAP);
        v -= Math.max(0, loss - NOISE) / tau;
        if (loss > NOISE) v += g.gamma * Math.log(Math.max(c.prior, 1e-5) / maxPrior);
        if (types && loss >= 1 && c.sigs) for (let s = 0; s < types.length; s++) if (c.sigs & (1 << s)) v += g.typeK * Math.log(types[s].mult);
        if (dials.maxMistake > 0 && L > dials.maxMistake) out[i] = true;
        if (opts.budget !== undefined && L > 4 * opts.budget + 1.5) out[i] = true;
        if (dials.guard && !c.book && ((L >= g.guardLoss && c.prior < g.guardPrior) || (L >= OBVIOUS_LOSS && c.flags & GUARD_FLAGS))) out[i] = true;
      }
    }
    lw[i] = v;
  }
  // Never leave nothing to play: drop the exclusions, keeping the cheapest move.
  if (out.every(Boolean)) {
    let best = -1;
    for (let i = 0; i < n; i++) if (cands[i].loss !== undefined && (best < 0 || cands[i].loss! < cands[best].loss!)) best = i;
    out.fill(true);
    out[best < 0 ? 0 : best] = false;
  }
  const p = new Array<number>(n).fill(0);
  if (T <= 0.01) {
    let best = -1;
    for (let i = 0; i < n; i++) if (!out[i] && (best < 0 || lw[i] > lw[best])) best = i;
    p[best] = 1;
  } else {
    let m = -Infinity;
    for (let i = 0; i < n; i++) if (!out[i]) m = Math.max(m, lw[i]);
    let z = 0;
    for (let i = 0; i < n; i++) if (!out[i]) z += p[i] = Math.exp(lw[i] - m);
    for (let i = 0; i < n; i++) p[i] /= z;
  }
  // The opening book: the player's own moves here, trusted more the more often they were played.
  let total = 0;
  for (let i = 0; i < n; i++) if (cands[i].book && !(dials.maxMistake > 0 && (cands[i].loss ?? 0) > dials.maxMistake)) total += cands[i].book!;
  if (total > 0) {
    const share = total / (total + g.bookAlpha);
    for (let i = 0; i < n; i++) {
      const b = cands[i].book && !(dials.maxMistake > 0 && (cands[i].loss ?? 0) > dials.maxMistake) ? cands[i].book! / total : 0;
      p[i] = share * b + (1 - share) * p[i];
    }
    if (T <= 0.01) {
      const best = p.indexOf(Math.max(...p));
      p.fill(0);
      p[best] = 1;
    }
  }
  return p;
}

/** Draw from a distribution. */
export function drawFrom(p: readonly number[], rng: () => number = Math.random): number {
  let r = rng();
  for (let i = 0; i < p.length; i++) {
    r -= p[i];
    if (r < 0) return i;
  }
  let last = p.length - 1;
  while (last > 0 && !(p[last] > 0)) last--;
  return last;
}

// ------------------------------------------------------------------ learning the player's mistakes

/** One of the player's positions, as the mistake profile learns from it. */
export interface MistakeSample {
  cands: CandInfo[];
  /** Index of the move played in cands (-1: not among them). */
  played: number;
  /** Points the played move lost (when known). */
  playedLoss?: number;
  /** Guard flags of the played move. */
  playedFlags?: number;
  state: ChoiceState;
}

const expectedLoss = (cands: readonly CandInfo[], p: readonly number[]) => {
  let e = 0;
  let z = 0;
  for (let i = 0; i < cands.length; i++)
    if (cands[i].loss !== undefined && p[i] > 0) {
      e += p[i] * Math.min(cands[i].loss!, CAP);
      z += p[i];
    }
  return z > 0 ? e / z : NaN;
};

const playedLossOf = (s: MistakeSample) => (s.playedLoss !== undefined ? s.playedLoss : s.played >= 0 ? s.cands[s.played].loss : undefined);

/** Can the sample take part in calibration (enough measured candidates)? */
const measured = (s: MistakeSample) => playedLossOf(s) !== undefined && s.cands.filter((c) => c.loss !== undefined).length >= 2;

/** τ at which the copy loses `target` points per move on these positions (bisection on log τ). */
function solveTau(samples: readonly MistakeSample[], target: number, model: { genome?: Genome; mistakes?: MistakeProfile }, noTypes: boolean): number {
  let lo = Math.log(0.03);
  let hi = Math.log(60);
  const lossAt = (tau: number) => {
    let s = 0;
    let n = 0;
    for (const x of samples) {
      const e = expectedLoss(x.cands, choiceDistribution(x.cands, x.state, model, DEFAULT_DIALS, { tau, noTypes }));
      if (Number.isFinite(e)) {
        s += e;
        n++;
      }
    }
    return n ? s / n : NaN;
  };
  if (!(lossAt(Math.exp(hi)) > target)) return Math.exp(hi);
  if (!(lossAt(Math.exp(lo)) < target)) return Math.exp(lo);
  for (let it = 0; it < 18; it++) {
    const mid = (lo + hi) / 2;
    if (lossAt(Math.exp(mid)) > target) hi = mid;
    else lo = mid;
  }
  return Math.exp((lo + hi) / 2);
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

function phaseStats(losses: number[]): PhaseMistakes {
  return {
    moves: losses.length,
    meanLoss: losses.length ? mean(losses.map((l) => Math.min(l, CAP))) : 0,
    mistakes: losses.length ? losses.filter((l) => l >= MISTAKE).length / losses.length : 0,
    blunders: losses.length ? losses.filter((l) => l >= BLUNDER).length / losses.length : 0,
  };
}

/** Moves a phase × situation cell needs before it gets its own τ (else its phase's, else the whole game's). */
const MIN_CELL = 40;

/**
 * Learn how often and how badly the player goes wrong, in each phase and situation, and
 * which kinds of mistakes, from their positions; then set τ so the copy matches it.
 */
export function learnMistakes(samples: readonly MistakeSample[], genome: Genome = DEFAULT_GENOME): MistakeProfile {
  const loss = (s: MistakeSample) => Math.min(playedLossOf(s)!, CAP);
  const withLoss = samples.filter((s) => playedLossOf(s) !== undefined);
  // The target: what the player loses on the moves the copy could have played.
  const known = withLoss.filter((s) => s.played >= 0);
  const outsideMoves = withLoss.filter((s) => s.played < 0);
  const all = mean(known.map(loss));
  const byCell = [...Array(9)].map((_, c) => known.filter((s) => cell(s.state) === c));
  const byPh = [0, 1, 2].map((p) => known.filter((s) => s.state.phase === p));
  // Means shrunk toward the phase's (and the phase's toward the whole game's).
  const K = 25;
  const phaseMean = byPh.map((a) => (a.length ? (mean(a.map(loss)) * a.length + all * K) / (a.length + K) : all));
  const meanLoss = byCell.map((a, c) => (a.length ? (mean(a.map(loss)) * a.length + phaseMean[Math.floor(c / 3)] * K) / (a.length + K) : phaseMean[Math.floor(c / 3)]));

  // Tilt: the move after a mistake against the rest.
  const after = withLoss.filter((s) => s.state.afterMistake).map(loss);
  const rest = withLoss.filter((s) => !s.state.afterMistake).map(loss);
  const rawTilt = after.length && rest.length ? (mean(after) + 0.3) / (mean(rest) + 0.3) : 1;
  const w = after.length / (after.length + 30);
  const tilt = Math.min(2.5, Math.max(0.6, 1 + (rawTilt - 1) * w));

  const profile: MistakeProfile = {
    meanLoss: meanLoss.map((v) => (Number.isFinite(v) ? v : 1)),
    moves: byCell.map((a) => a.length),
    tau: [],
    byPhase: [0, 1, 2].map((p) => phaseStats(withLoss.filter((s) => s.state.phase === p).map((s) => playedLossOf(s)!))),
    outside: { share: withLoss.length ? outsideMoves.length / withLoss.length : 0, meanLoss: outsideMoves.length ? mean(outsideMoves.map(loss)) : 0 },
    tilt,
    types: [],
  };
  const calib = samples.filter(measured);
  const solveAll = (noTypes: boolean) => {
    const model = { genome, mistakes: profile };
    const whole = calib.length ? solveTau(calib, Number.isFinite(all) ? all : 1, model, noTypes) : fallbackTau(all);
    const ph = [0, 1, 2].map((p) => {
      const a = calib.filter((s) => s.state.phase === p);
      return a.length >= MIN_CELL ? solveTau(a, phaseMean[p], model, noTypes) : whole;
    });
    profile.tau = profile.meanLoss.map((m, c) => {
      const a = calib.filter((s) => cell(s.state) === c);
      return a.length >= MIN_CELL ? solveTau(a, m, model, noTypes) : ph[Math.floor(c / 3)];
    });
  };
  solveAll(true);

  // Mistake kinds: how often the player makes each, against how often the copy would by itself.
  const you = new Float64Array(SIGNATURES.length);
  const copy = new Float64Array(SIGNATURES.length);
  for (const s of calib) {
    const pl = s.played >= 0 ? s.cands[s.played] : null;
    if (pl && (pl.loss ?? 0) >= 1) for (let k = 0; k < SIGNATURES.length; k++) if (pl.sigs & (1 << k)) you[k]++;
    const p = choiceDistribution(s.cands, s.state, { genome, mistakes: profile }, DEFAULT_DIALS, { noTypes: true });
    s.cands.forEach((c, i) => {
      if ((c.loss ?? 0) >= 1 && c.sigs) for (let k = 0; k < SIGNATURES.length; k++) if (c.sigs & (1 << k)) copy[k] += p[i];
    });
  }
  profile.types = SIGNATURES.map((sig, k) => ({ id: sig.id, mult: Math.min(3, Math.max(0.33, (you[k] + 2) / (copy[k] + 2))), you: you[k], copy: copy[k] }));
  // τ again, now with the mistake kinds shaping which mistakes are made.
  if (calib.length) solveAll(false);
  return profile;
}

// ------------------------------------------------------------------ measuring

export interface PlayMetrics {
  positions: number;
  /** Chance the copy plays exactly the player's move, on average, and the mean log-likelihood. */
  match: number;
  logLik: number;
  /** The same for the copy's habits alone (how it chose before the mistake model). */
  habitsMatch: number;
  habitsLogLik: number;
  /**
   * Per phase: the player's moves among the copy's candidates, the copy (expected) and its
   * habits alone, points lost per move and mistake rates.
   */
  byPhase: { you: PhaseMistakes; copy: PhaseMistakes; habits: PhaseMistakes }[];
  /** The player's moves outside the candidates: share of all moves and points lost per move. */
  outside: { share: number; meanLoss: number };
  /** Share of moves that are obvious blunders (see OBVIOUS_LOSS). */
  obvious: { you: number; copy: number; habits: number };
}

/** The old way: the habits' own distribution, leaving out moves under a tenth of the favourite. */
export function habitsDistribution(cands: readonly CandInfo[]): number[] {
  const best = Math.max(...cands.map((c) => c.p));
  const p = cands.map((c) => (c.p >= 0.1 * best ? c.p : 0));
  const z = p.reduce((a, b) => a + b, 0);
  return p.map((v) => v / z);
}

/** How the copy plays on these positions (expected, from its choice distribution) next to the player. */
export function measurePlay(samples: readonly MistakeSample[], model: { mistakes?: MistakeProfile; genome?: Genome }, dials: CopyDials = DEFAULT_DIALS): PlayMetrics {
  const EPS = 1e-3;
  let match = 0, ll = 0, hm = 0, hll = 0;
  const ph = [0, 1, 2].map(() => ({ you: [] as number[], copy: [] as number[][], habits: [] as number[][] }));
  let oy = 0, oc = 0, oh = 0, on = 0;
  const out: number[] = [];
  const obviousShare = (cands: readonly CandInfo[], p: readonly number[]) => {
    let s = 0, z = 0;
    cands.forEach((c, i) => {
      if (c.loss === undefined || !(p[i] > 0)) return;
      z += p[i];
      if (c.loss >= OBVIOUS_LOSS && c.flags & GUARD_FLAGS) s += p[i];
    });
    return z > 0 ? s / z : 0;
  };
  // Expected stats: mean loss, P(loss >= MISTAKE), P(loss >= BLUNDER) under p.
  const stats = (cands: readonly CandInfo[], p: readonly number[]) => {
    let e = 0, m = 0, b = 0, z = 0;
    cands.forEach((c, i) => {
      if (c.loss === undefined || !(p[i] > 0)) return;
      z += p[i];
      e += p[i] * Math.min(c.loss, CAP);
      if (c.loss >= MISTAKE) m += p[i];
      if (c.loss >= BLUNDER) b += p[i];
    });
    return z > 0 ? [e / z, m / z, b / z] : null;
  };
  for (const s of samples) {
    const p = choiceDistribution(s.cands, s.state, model, dials);
    const h = habitsDistribution(s.cands);
    const pp = s.played >= 0 ? p[s.played] : 0;
    const hp = s.played >= 0 ? h[s.played] : 0;
    match += pp;
    hm += hp;
    ll += Math.log(Math.max(pp, EPS));
    hll += Math.log(Math.max(hp, EPS));
    const yl = playedLossOf(s);
    const a = stats(s.cands, p);
    const hb = stats(s.cands, h);
    if (yl !== undefined && s.played < 0) out.push(yl);
    if (yl !== undefined && a && hb) {
      if (s.played >= 0) ph[s.state.phase].you.push(yl);
      ph[s.state.phase].copy.push(a);
      ph[s.state.phase].habits.push(hb);
      const flags = s.playedFlags ?? (s.played >= 0 ? s.cands[s.played].flags : 0);
      oy += yl >= OBVIOUS_LOSS && flags & GUARD_FLAGS ? 1 : 0;
      oc += obviousShare(s.cands, p);
      oh += obviousShare(s.cands, h);
      on++;
    }
  }
  const n = Math.max(samples.length, 1);
  const agg = (rows: number[][]): PhaseMistakes => ({
    moves: rows.length,
    meanLoss: rows.length ? mean(rows.map((r) => r[0])) : 0,
    mistakes: rows.length ? mean(rows.map((r) => r[1])) : 0,
    blunders: rows.length ? mean(rows.map((r) => r[2])) : 0,
  });
  return {
    positions: samples.length,
    match: match / n,
    logLik: ll / n,
    habitsMatch: hm / n,
    habitsLogLik: hll / n,
    byPhase: ph.map((x) => ({ you: phaseStats(x.you), copy: agg(x.copy), habits: agg(x.habits) })),
    obvious: { you: on ? oy / on : 0, copy: on ? oc / on : 0, habits: on ? oh / on : 0 },
    outside: { share: samples.length ? out.length / samples.length : 0, meanLoss: out.length ? mean(out.map((l) => Math.min(l, CAP))) : 0 },
  };
}
