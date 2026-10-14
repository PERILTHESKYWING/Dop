import { replay, type Board } from '../go/board';
import { buildContext, phaseOf, pointFeatures, type PositionContext } from '../go/features';
import { PASS, type Color, type Loc, type Move } from '../go/types';
import { decodeOwnership, moverView } from '../engine/parse';
import { chebyshev } from '../go/coords';
import type { MoveRecord, PointFeatures, PolicyEntry, PositionEval } from '../types';
import type { OpeningBook } from './book';
import type { EvoState } from './evolve';
import type { Genome } from './genome';
import type { MistakeProfile, PlayMetrics } from './human';
import { shapeOf, type Shape } from './shape';

/**
 * The Doppelgänger: a behavioural model of which move this player is likely to choose.
 * It is a conditional-logit (softmax) model over candidate moves. Each candidate is
 * described by KataGo's prior plus a handful of Go features; the weights are learned
 * from the player's own games. With all feature weights at zero it reduces to
 * KataGo's policy, so any learned weight is a measured deviation of this player from
 * the engine. It predicts habits; it does not read minds.
 */
export const DOPPEL_FEATURES = [
  'log prior',
  'answering locally',
  'playing elsewhere',
  'moving away from the last move',
  'first/second line moves',
  'third-line moves',
  'fourth-line moves',
  'fifth line or higher',
  'contact moves',
  'moves near own weak groups',
  'moves near enemy weak groups',
  'moves next to own safe groups',
  'captures',
  'ataris',
  'saving stones in atari',
  'extending small weak stones',
  'invasions',
  'reductions',
  'corner moves',
  'centre moves',
  "KataGo's top choice",
  'hane',
  'one-point jumps',
  "knight's moves",
  'diagonal moves',
  'solid extensions',
  'connecting moves',
  'cutting moves',
  'empty triangles',
  "tiger's mouths",
  'two-space extensions',
  'crawling low',
  'following up its own last move',
  "KataGo's second or third choice",
] as const;

export const NF = DOPPEL_FEATURES.length;

/**
 * Training method. 2: learns only from choices among KataGo's candidates (a move outside
 * that list says nothing about how the player ranks them, and flattened the model), and
 * counts such moves as misses when measuring accuracy. Models without it used method 1.
 * 3: shape features, habits by phase and situation, the mistake profile, the opening book
 * and evolved settings (profile/copyTrain.ts).
 */
export const DOPPEL_ALGO = 3;

/** Game phase and how the game stands for the mover: the copy's habits can differ in each. */
export const PHASES = ['opening', 'middle game', 'endgame'] as const;
export const SITUATIONS = ['behind', 'close', 'ahead'] as const;
export type PhaseIndex = 0 | 1 | 2;
export type SituationIndex = 0 | 1 | 2;
/** The mover's winrate below / above which the game counts as behind / ahead. */
export const BEHIND = 0.3;
export const AHEAD = 0.7;
export const situationOf = (win: number): SituationIndex => (win < BEHIND ? 0 : win > AHEAD ? 2 : 1);
export function phaseIndex(moveNumber: number, size: number, certainty: number): PhaseIndex {
  const p = phaseOf(moveNumber, size, certainty);
  return p === 'opening' ? 0 : p === 'endgame' ? 2 : 1;
}

/** How many of KataGo's top policy moves the copy chooses among. */
export const CANDIDATES = 10;

/** The copy is trained once this many of the player's moves are analysed (see rebuildProfile). */
export const MIN_COPY_MOVES = 30;

export interface FeatureExtras {
  shape?: Shape;
  /** Within two points of the mover's own previous move. */
  nearOwnLast?: boolean;
  /** Place in KataGo's policy order (0 = its first choice). */
  rank?: number;
}

export function featureVector(p: PointFeatures, prior: number, isTop: boolean, extra: FeatureExtras = {}): Float32Array {
  const v = new Float32Array(NF);
  v[0] = Math.log(Math.max(prior, 1e-4));
  v[1] = p.local ? 1 : 0;
  v[2] = p.tenuki ? 1 : 0;
  v[3] = Math.min(p.distLast, 12) / 12;
  v[4] = p.line <= 2 ? 1 : 0;
  v[5] = p.line === 3 ? 1 : 0;
  v[6] = p.line === 4 ? 1 : 0;
  v[7] = p.line >= 5 ? 1 : 0;
  v[8] = p.contact ? 1 : 0;
  v[9] = p.nearOwnWeak ? 1 : 0;
  v[10] = p.nearOppWeak ? 1 : 0;
  v[11] = p.nearOwnSafe ? 1 : 0;
  v[12] = p.captures > 0 ? 1 : 0;
  v[13] = p.atari ? 1 : 0;
  v[14] = p.savesAtari ? 1 : 0;
  v[15] = p.extendsSmallWeak ? 1 : 0;
  v[16] = p.invasion ? 1 : 0;
  v[17] = p.reduction ? 1 : 0;
  v[18] = p.region === 'corner' ? 1 : 0;
  v[19] = p.region === 'center' ? 1 : 0;
  v[20] = isTop ? 1 : 0;
  const sh = extra.shape;
  if (sh) {
    v[21] = sh.hane ? 1 : 0;
    v[22] = sh.jump ? 1 : 0;
    v[23] = sh.knight ? 1 : 0;
    v[24] = sh.diagonal ? 1 : 0;
    v[25] = sh.extend ? 1 : 0;
    v[26] = sh.connect ? 1 : 0;
    v[27] = sh.cut ? 1 : 0;
    v[28] = sh.emptyTriangle ? 1 : 0;
    v[29] = sh.tigerMouth ? 1 : 0;
    v[30] = sh.twoSpace ? 1 : 0;
    v[31] = sh.crawl ? 1 : 0;
  }
  v[32] = extra.nearOwnLast ? 1 : 0;
  v[33] = extra.rank === 1 || extra.rank === 2 ? 1 : 0;
  return v;
}

export interface DoppelExample {
  gameId: string;
  candidates: Loc[];
  x: Float32Array[];
  /** Index of the played move in candidates. */
  y: number;
  /** The played move was not among KataGo's candidates (it was appended to the list). */
  outside?: boolean;
  /** Game phase and the mover's situation (unset: the copy's habits for the whole game apply). */
  phase?: PhaseIndex;
  sit?: SituationIndex;
  /** KataGo's policy prior of each candidate. */
  prior?: number[];
  /** How much this example counts in training (recent games, corrections). Default 1. */
  w?: number;
  /** A "not me" correction from a game against the copy (not one of the player's own moves). */
  fix?: boolean;
  /** For a correction without the player's own move: the copy's candidate the player rejected. */
  neg?: number;
  /** Points each candidate loses (null: not measured), for the mistake model (profile/human.ts). */
  loss?: (number | null)[];
  /** Guard and style flags and mistake kinds of each candidate (human.ts FLAG, SIGNATURES bits). */
  flags?: number[];
  sigs?: number[];
  /** Points the move played lost, when known. */
  playedLoss?: number;
  /** The player's previous move in the game was a mistake (TILT_LOSS points or more). */
  afterMistake?: boolean;
  /** Games between this one and the player's most recent game (0: the most recent). */
  age?: number;
  /** The position's opening-book key, for positions early enough (profile/book.ts). */
  bookAt?: { key: string; sym: number; size: number; moveNumber: number };
}

/** Where a position stands in its game; it lets the copy use its habits for that phase and situation. */
export interface ExampleContext {
  /** Moves played before this position. */
  moveNumber?: number;
  /** The mover's winrate before the move. */
  win?: number;
  /** The mover's own previous move. */
  lastOwn?: Loc | null;
}

/** Candidate set: KataGo's top policy moves plus the played move. */
export function buildExample(
  ctx: PositionContext,
  policy: PolicyEntry[],
  color: Color,
  lastOpp: Loc | null,
  played: Loc | null,
  gameId = '',
  more: ExampleContext = {},
): DoppelExample | null {
  const cands: { loc: Loc; p: number }[] = policy.filter((e) => e.loc !== PASS).slice(0, CANDIDATES);
  let outside = false;
  if (played !== null && played !== PASS && !cands.some((c) => c.loc === played)) {
    cands.push({ loc: played, p: 0.0005 });
    outside = true;
  }
  if (cands.length < 2) return null;
  const top = cands[0].loc;
  const own = more.lastOwn ?? null;
  const x = cands.map((c, i) =>
    featureVector(pointFeatures(ctx, c.loc, color, lastOpp), c.p, c.loc === top, {
      shape: shapeOf(ctx.board, c.loc, color),
      nearOwnLast: own !== null && own !== PASS && chebyshev(c.loc, own, ctx.size) <= 2,
      rank: outside && i === cands.length - 1 ? CANDIDATES : i,
    }),
  );
  const y = played === null ? -1 : cands.findIndex((c) => c.loc === played);
  const ex: DoppelExample = { gameId, candidates: cands.map((c) => c.loc), x, y, outside, prior: cands.map((c) => c.p) };
  if (more.moveNumber !== undefined) ex.phase = phaseIndex(more.moveNumber, ctx.size, ctx.certainty);
  if (more.win !== undefined) ex.sit = situationOf(more.win);
  return ex;
}

export interface DoppelModel {
  version: number;
  /** The copy's habits for the whole game (one weight per feature). */
  weights: number[];
  /** Differences from `weights` in each game phase and situation (algo 3). */
  phaseWeights?: number[][];
  sitWeights?: number[][];
  /** Moves the weights were learned from. */
  trainedOn: number;
  trainedAt: number;
  metrics: {
    /** Share of held-out moves the copy (or KataGo's policy alone) names exactly / in its top 3. */
    top1: number;
    top3: number;
    baselineTop1: number;
    baselineTop3: number;
    logLoss: number;
    baselineLogLoss: number;
    /** Held-out moves, from games the measured model did not learn from when there are enough games. */
    testSize: number;
    /** How the copy plays on held-out games, mistakes included, next to the player (algo 3). */
    play?: PlayMetrics;
  };
  /** Training method (DOPPEL_ALGO); absent on models trained by the first method. */
  algo?: number;
  /** All of the player's moves seen, including those outside KataGo's candidates. */
  moves?: number;
  /** The games those moves came from. */
  gameIds?: string[];
  /** Share of the player's moves that were not among KataGo's top candidates. */
  outsideRate?: number;
  /** How often and how badly the player goes wrong, and how (profile/human.ts). */
  mistakes?: MistakeProfile;
  /** The player's own openings (profile/book.ts). */
  book?: OpeningBook;
  /** The settings the copy evolved for this player, and the evolution so far (profile/evolve.ts). */
  genome?: Genome;
  evo?: EvoState;
  /** "Not me" corrections it learned from. */
  corrections?: number;
}

/** The parts of a model that score candidates. */
export type CopyWeights = Pick<DoppelModel, 'weights' | 'phaseWeights' | 'sitWeights'>;

export function initialWeights(): Float32Array {
  const w = new Float32Array(NF);
  w[0] = 1; // start as KataGo's policy
  return w;
}

function softmax(s: number[]): number[] {
  const m = Math.max(...s);
  const e = s.map((v) => Math.exp(v - m));
  const z = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / z);
}

export function scores(w: ArrayLike<number>, ex: DoppelExample): number[] {
  return softmax(
    ex.x.map((v) => {
      let t = 0;
      for (let k = 0; k < NF; k++) t += (w[k] ?? 0) * v[k];
      return t;
    }),
  );
}

/** The weights that apply to an example: the whole-game habits plus its phase's and situation's differences. */
export function weightsFor(model: CopyWeights, ex: Pick<DoppelExample, 'phase' | 'sit'>): ArrayLike<number> {
  const ph = ex.phase !== undefined ? model.phaseWeights?.[ex.phase] : undefined;
  const st = ex.sit !== undefined ? model.sitWeights?.[ex.sit] : undefined;
  if (!ph && !st) return model.weights;
  const w = new Float32Array(NF);
  for (let k = 0; k < NF; k++) w[k] = (model.weights[k] ?? 0) + (ph?.[k] ?? 0) + (st?.[k] ?? 0);
  return w;
}

/** The copy's probability for each candidate of an example. */
export const copyProbs = (model: CopyWeights, ex: DoppelExample) => scores(weightsFor(model, ex), ex);

/**
 * Accuracy as the copy is used: it only ever proposes KataGo's candidates, so a move
 * outside them is a miss for it (and for KataGo's policy). Log-loss is over the rest.
 */
export function evaluate(model: CopyWeights, test: DoppelExample[]) {
  let top1 = 0;
  let top3 = 0;
  let ll = 0;
  let listed = 0;
  for (const ex of test) {
    if (ex.outside) continue;
    const p = copyProbs(model, ex);
    const order = p.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
    const rank = order.findIndex(([, i]) => i === ex.y);
    if (rank === 0) top1++;
    if (rank >= 0 && rank < 3) top3++;
    ll -= Math.log(Math.max(p[ex.y], 1e-9));
    listed++;
  }
  const n = Math.max(test.length, 1);
  return { top1: top1 / n, top3: top3 / n, logLoss: ll / Math.max(listed, 1) };
}

export interface FitOptions {
  epochs?: number;
  lr?: number;
  /** Pull of the whole-game habits toward KataGo's policy (default: stronger with fewer moves). */
  l2?: number;
  /** How much more the phase and situation differences are pulled toward none (0 leaves them out). */
  l2Phase?: number;
  l2Sit?: number;
}

/**
 * Mini-batch gradient descent with L2 regularisation toward the engine prior. Phase and
 * situation differences are learned alongside, pulled harder toward zero so they only
 * appear where the moves show them. Corrections push their candidate down.
 */
export function fitCopy(examples: DoppelExample[], opts: FitOptions = {}): CopyWeights {
  const train = examples.filter((e) => !e.outside && (e.y >= 0 || e.neg !== undefined));
  const w = initialWeights();
  const w0 = initialWeights();
  const usePh = (opts.l2Phase ?? 0) > 0;
  const useSt = (opts.l2Sit ?? 0) > 0;
  const ph = [0, 1, 2].map(() => new Float32Array(NF));
  const st = [0, 1, 2].map(() => new Float32Array(NF));
  const epochs = opts.epochs ?? 40;
  const lr = opts.lr ?? 0.05;
  // Few moves to learn from: stay closer to KataGo's policy.
  const l2 = opts.l2 ?? Math.max(0.01, 3 / Math.max(train.length, 1));
  const l2p = l2 * (opts.l2Phase ?? 0);
  const l2s = l2 * (opts.l2Sit ?? 0);
  const g = new Float32Array(NF);
  const gp = [0, 1, 2].map(() => new Float32Array(NF));
  const gs = [0, 1, 2].map(() => new Float32Array(NF));
  const cnt = new Float32Array(6);
  const eg = new Float32Array(NF);
  const wx = new Float32Array(NF);
  for (let ep = 0; ep < epochs; ep++) {
    const rate = lr / (1 + ep * 0.05);
    for (let b = 0; b < train.length; b += 32) {
      g.fill(0);
      cnt.fill(0);
      for (const a of gp) a.fill(0);
      for (const a of gs) a.fill(0);
      const batch = train.slice(b, b + 32);
      let total = 0;
      for (const ex of batch) {
        const pi = usePh ? ex.phase : undefined;
        const si = useSt ? ex.sit : undefined;
        for (let k = 0; k < NF; k++) wx[k] = w[k] + (pi !== undefined ? ph[pi][k] : 0) + (si !== undefined ? st[si][k] : 0);
        const p = scores(wx, ex);
        const weight = ex.w ?? 1;
        eg.fill(0);
        if (ex.neg !== undefined) {
          // Push the corrected move down: the gradient of -log(1 - p).
          const q = Math.min(p[ex.neg], 0.999);
          const f = q / (1 - q);
          for (let c = 0; c < ex.x.length; c++) {
            const d = f * ((c === ex.neg ? 1 : 0) - p[c]);
            for (let k = 0; k < NF; k++) eg[k] += d * ex.x[c][k];
          }
        } else
          for (let c = 0; c < ex.x.length; c++) {
            const d = p[c] - (c === ex.y ? 1 : 0);
            for (let k = 0; k < NF; k++) eg[k] += d * ex.x[c][k];
          }
        for (let k = 0; k < NF; k++) {
          g[k] += weight * eg[k];
          if (pi !== undefined) gp[pi][k] += weight * eg[k];
          if (si !== undefined) gs[si][k] += weight * eg[k];
        }
        if (pi !== undefined) cnt[pi] += weight;
        if (si !== undefined) cnt[3 + si] += weight;
        total += weight;
      }
      const n = Math.max(total, 1e-6);
      for (let k = 0; k < NF; k++) w[k] -= rate * (g[k] / n + l2 * (w[k] - w0[k]));
      for (let i = 0; i < 3; i++) {
        if (usePh && cnt[i] > 0) for (let k = 0; k < NF; k++) ph[i][k] -= rate * (gp[i][k] / n + l2p * ph[i][k]);
        if (useSt && cnt[3 + i] > 0) for (let k = 0; k < NF; k++) st[i][k] -= rate * (gs[i][k] / n + l2s * st[i][k]);
      }
    }
  }
  const out: CopyWeights = { weights: Array.from(w) };
  if (usePh) out.phaseWeights = ph.map((a) => Array.from(a));
  if (useSt) out.sitWeights = st.map((a) => Array.from(a));
  return out;
}

type TrainOptions = FitOptions & { version?: number };

/** Hold out whole games (every fifth) so a test measures generalisation to new games. */
export function splitByGame<T extends { gameId: string }>(data: T[], every = 5, slot = every - 1): { train: T[]; test: T[] } {
  const games = [...new Set(data.map((e) => e.gameId))];
  const testGames = new Set(games.filter((_, i) => i % every === slot));
  let train = data.filter((e) => !testGames.has(e.gameId));
  let test = data.filter((e) => testGames.has(e.gameId));
  if (!test.length || !train.length) {
    train = data.filter((_, i) => i % every !== slot);
    test = data.filter((_, i) => i % every === slot);
  }
  return { train, test };
}

/**
 * Train the copy's habits. Accuracy is measured on whole games held out from a first fit;
 * the copy then learns from all the moves. (profile/copyTrain.ts adds the rest of a full copy.)
 */
export function trainDoppel(examples: DoppelExample[], opts: TrainOptions = {}): DoppelModel {
  const data = examples.filter((e) => e.y >= 0 || e.neg !== undefined);
  const real = data.filter((e) => !e.fix);
  const corrections = data.filter((e) => e.fix);
  const games = [...new Set(real.map((e) => e.gameId))];
  const { train, test } = splitByGame(real);
  const m = evaluate(fitCopy([...train, ...corrections], opts), test);
  const base = evaluate({ weights: Array.from(initialWeights()) }, test);
  const w = fitCopy(data, opts);
  const listed = real.filter((e) => !e.outside).length;
  return {
    version: opts.version ?? 1,
    algo: DOPPEL_ALGO,
    ...w,
    trainedOn: listed,
    moves: real.length,
    gameIds: games.filter(Boolean),
    outsideRate: real.length ? (real.length - listed) / real.length : 0,
    trainedAt: Date.now(),
    metrics: {
      top1: m.top1,
      top3: m.top3,
      logLoss: m.logLoss,
      baselineTop1: base.top1,
      baselineTop3: base.top3,
      baselineLogLoss: base.logLoss,
      testSize: test.length,
    },
    ...(corrections.length ? { corrections: corrections.length } : {}),
  };
}

export interface DoppelPrediction {
  loc: Loc;
  p: number;
}

export function predict(model: CopyWeights, ex: DoppelExample): DoppelPrediction[] {
  const p = copyProbs(model, ex);
  return ex.candidates.map((loc, i) => ({ loc, p: p[i] })).sort((a, b) => b.p - a.p);
}

/** Human-readable habits: the largest learned deviations from KataGo. */
export function describeWeights(model: Pick<DoppelModel, 'weights'>): { label: string; weight: number }[] {
  return model.weights
    .map((w, i) => ({ label: DOPPEL_FEATURES[i], weight: i === 0 ? w - 1 : w }))
    .filter((d, i) => i !== 0 && i !== 20 && i !== 33 && Math.abs(d.weight) > 0.05)
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
}

// ------------------------------------------------------------------ habits in words

export interface Habit {
  /** Index in DOPPEL_FEATURES. */
  feature: number;
  /** The habit as behaviour, e.g. "Plays elsewhere (tenuki) less often than KataGo". */
  text: string;
  /** Learned deviation from KataGo on the log-odds scale (positive: more often). */
  weight: number;
  /** How many times more (above 1) or less (below 1) likely such a move is for the player than KataGo's policy suggests. */
  odds: number;
  strength: 'slight' | 'clear' | 'strong';
}

/** [more often, less often] than KataGo, per feature. */
const HABIT_TEXT: Record<number, readonly [string, string]> = {
  0: ["Favours KataGo's likeliest candidates over its long shots, even more than the policy does", "Tries KataGo's long shots more often than its policy suggests"],
  1: ["Answers the opponent's last move locally more often than KataGo", "Answers the opponent's last move locally less often than KataGo"],
  2: ['Plays elsewhere (tenuki) more often than KataGo', 'Plays elsewhere (tenuki) less often than KataGo'],
  3: ["Plays farther from the opponent's last move than KataGo", "Stays closer to the opponent's last move than KataGo"],
  4: ['Plays on the first and second lines more often than KataGo', 'Plays on the first and second lines less often than KataGo'],
  5: ['Plays on the third line more often than KataGo', 'Plays on the third line less often than KataGo'],
  6: ['Plays on the fourth line more often than KataGo', 'Plays on the fourth line less often than KataGo'],
  7: ['Plays high (fifth line and up) more often than KataGo', 'Plays high (fifth line and up) less often than KataGo'],
  8: ['Plays contact moves (touching enemy stones) more often than KataGo', 'Plays contact moves (touching enemy stones) less often than KataGo'],
  9: ['Tends to its own weak groups more often than KataGo', 'Leaves its own weak groups alone more often than KataGo'],
  10: ["Goes after the opponent's weak groups more often than KataGo", "Attacks the opponent's weak groups less often than KataGo"],
  11: ['Adds stones next to its own strong groups more often than KataGo', 'Adds stones next to its own strong groups less often than KataGo'],
  12: ['Captures stones more often than KataGo', 'Captures stones less often than KataGo'],
  13: ['Plays atari more often than KataGo', 'Plays atari less often than KataGo'],
  14: ['Saves stones in atari more often than KataGo', 'Lets stones in atari go more readily than KataGo'],
  15: ['Extends small, weak stones that KataGo would rather give up', 'Gives up small, weak stones more readily than KataGo'],
  16: ['Invades more often than KataGo', 'Invades less often than KataGo'],
  17: ['Reduces from the outside more often than KataGo', 'Reduces from the outside less often than KataGo'],
  18: ['Plays in the corners more often than KataGo', 'Plays in the corners less often than KataGo'],
  19: ['Plays in the middle of the board more often than KataGo', 'Plays in the middle of the board less often than KataGo'],
  20: ["Picks KataGo's first choice more often than its policy suggests", "Passes over KataGo's first choice more often than its policy suggests"],
  21: ['Plays hane more often than KataGo', 'Plays hane less often than KataGo'],
  22: ['Likes one-point jumps more than KataGo', 'Plays one-point jumps less often than KataGo'],
  23: ["Likes knight's moves more than KataGo", "Plays knight's moves less often than KataGo"],
  24: ['Plays diagonal moves more often than KataGo', 'Plays diagonal moves less often than KataGo'],
  25: ['Extends solidly from its own stones more often than KataGo', 'Extends solidly from its own stones less often than KataGo'],
  26: ['Connects its groups more often than KataGo', 'Connects its groups less often than KataGo'],
  27: ['Cuts more often than KataGo', 'Cuts less often than KataGo'],
  28: ['Makes empty triangles (heavy shape) more often than KataGo', 'Avoids empty triangles more than KataGo'],
  29: ["Makes tiger's mouths more often than KataGo", "Makes tiger's mouths less often than KataGo"],
  30: ['Makes two-space extensions more often than KataGo', 'Makes two-space extensions less often than KataGo'],
  31: ['Crawls along the low lines more often than KataGo', 'Crawls along the low lines less often than KataGo'],
  32: ['Keeps following up its own last move more often than KataGo', 'Switches away from its own last move more often than KataGo'],
};

/**
 * Typical size of a feature's difference between two candidates, so that weights on
 * different scales compare: the log prior differs by about 2 between KataGo's 1st and
 * 5th candidate, and the distance feature by about 0.75 between a local and a far move.
 */
const HABIT_SCALE: Record<number, number> = { 0: 2, 3: 0.75 };

/** The copy's habits in plain words, strongest first (only clear enough deviations). */
export function describeHabits(model: Pick<DoppelModel, 'weights'>, limit = 8): Habit[] {
  const out: Habit[] = [];
  model.weights.forEach((raw, i) => {
    const text = HABIT_TEXT[i];
    if (!text || !Number.isFinite(raw)) return;
    const weight = (i === 0 ? raw - 1 : raw) * (HABIT_SCALE[i] ?? 1);
    const a = Math.abs(weight);
    if (a < 0.08) return;
    out.push({
      feature: i,
      text: weight > 0 ? text[0] : text[1],
      weight,
      odds: Math.exp(weight),
      strength: a < 0.2 ? 'slight' : a < 0.5 ? 'clear' : 'strong',
    });
  });
  return out.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, limit);
}

/** "than usual" texts for a phase's or situation's difference from the player's whole-game habits. */
const usual = (t: string) => t.replace(/ than KataGo('s)?.*$/, ' than usual').replace(/ more than usual$/, ' more than usual');

export interface ContextHabit {
  /** e.g. "When behind" or "In the opening". */
  when: string;
  text: string;
  weight: number;
}

/**
 * Where the player's habits change with the game: the largest differences between a phase
 * or situation and their whole-game habits (algo 3 models), strongest first.
 */
export function describeContextHabits(model: CopyWeights, limit = 6): ContextHabit[] {
  const out: ContextHabit[] = [];
  const add = (blocks: number[][] | undefined, names: readonly string[], prefix: string) =>
    blocks?.forEach((b, j) =>
      b.forEach((raw, i) => {
        const text = HABIT_TEXT[i];
        if (!text || i === 0 || i === 20 || !Number.isFinite(raw)) return;
        const weight = raw * (HABIT_SCALE[i] ?? 1);
        if (Math.abs(weight) < 0.15) return;
        out.push({ when: `${prefix} ${names[j]}`, text: usual(weight > 0 ? text[0] : text[1]), weight });
      }),
    );
  add(model.phaseWeights, PHASES, 'In the');
  add(model.sitWeights, ['behind', 'level', 'ahead'], 'When');
  return out.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, limit);
}

// ------------------------------------------------------------------ predicting any position

export interface PositionInput {
  size: number;
  /** Setup (handicap) stones. */
  setup?: readonly Move[];
  /** Moves that led to the position; the last one decides what counts as local. */
  history: readonly Move[];
  toPlay: Color;
  /** KataGo's policy here: its top entries, or the full array over size*size + 1 points (pass last). */
  policy: readonly PolicyEntry[] | ArrayLike<number>;
  /** KataGo's ownership (Black positive, -1..1), as an array or as stored (base64). Sharpens the weak-group features. */
  ownership?: ArrayLike<number> | string | null;
  /** The position itself when the caller has it already (saves replaying the moves). */
  board?: Board;
  /** The mover's winrate (selects the copy's habits for being behind, level or ahead). */
  win?: number;
}

const isEntryList = (p: readonly PolicyEntry[] | ArrayLike<number>): p is readonly PolicyEntry[] =>
  Array.isArray(p) && (p.length === 0 || typeof p[0] === 'object');

function policyEntries(policy: readonly PolicyEntry[] | ArrayLike<number>, board: Board, toPlay: Color): PolicyEntry[] {
  let list: PolicyEntry[];
  if (isEntryList(policy)) list = [...policy];
  else {
    const hw = policy.length - 1;
    list = [];
    for (let i = 0; i <= hw; i++) if (policy[i] >= 0.001) list.push({ loc: i === hw ? PASS : i, p: policy[i] });
  }
  return list.filter((e) => e.loc === PASS || board.isLegal(e.loc, toPlay)).sort((a, b) => b.p - a.p);
}

function ownershipArray(own: PositionInput['ownership'], n: number): Float32Array | null {
  if (own == null) return null;
  const arr = typeof own === 'string' ? decodeOwnership(own) : Float32Array.from(own);
  return arr && arr.length === n ? arr : null;
}

/**
 * What the copy expects the player to play in any position, given KataGo's policy there
 * (e.g. from the live analysis board): its `k` most likely moves with probabilities, most
 * likely first. Empty without a model or when KataGo offers fewer than two moves.
 */
export function predictForPosition(model: CopyWeights | null | undefined, input: PositionInput, k = 3): DoppelPrediction[] {
  if (!model) return [];
  const ex = positionExample(input);
  return ex ? predict(model, ex.example).slice(0, k) : [];
}

/** The copy's view of a position: its candidates (with features) and the position's context. */
export function positionExample(input: PositionInput): { example: DoppelExample; ctx: PositionContext; lastOpp: Loc | null; policy: PolicyEntry[] } | null {
  const board = input.board ?? replay(input.size, [...(input.setup ?? [])], [...input.history]);
  const ctx = buildContext(board, ownershipArray(input.ownership, board.stones.length));
  const h = input.history;
  const last = h.length ? h[h.length - 1] : null;
  const lastOpp = last && last.color !== input.toPlay ? last.loc : null;
  const ownPrev = h.length >= 2 && h[h.length - 2].color === input.toPlay ? h[h.length - 2].loc : null;
  const policy = policyEntries(input.policy, board, input.toPlay);
  const moveNumber = h.length;
  const example = buildExample(ctx, policy, input.toPlay, lastOpp, null, '', { moveNumber, win: input.win, lastOwn: ownPrev });
  return example ? { example, ctx, lastOpp, policy } : null;
}

/**
 * Pick a move the way the player might: at random in proportion to the copy's
 * probabilities (sharper below temperature 1; temperature 0 always takes the likeliest).
 * Candidates under `floor` times the likeliest one's probability are left out, so the
 * copy never plays a move it barely considers.
 */
export function sampleMove(
  preds: readonly DoppelPrediction[],
  rng: () => number = Math.random,
  opts: { temperature?: number; floor?: number } = {},
): DoppelPrediction | null {
  if (!preds.length) return null;
  const best = preds.reduce((a, b) => (b.p > a.p ? b : a));
  const t = opts.temperature ?? 1;
  if (t <= 0 || !(best.p > 0)) return best;
  const floor = (opts.floor ?? 0.1) * best.p;
  const pool = preds.filter((x) => x.p >= floor);
  const w = pool.map((x) => Math.pow(x.p / best.p, 1 / t));
  const z = w.reduce((a, b) => a + b, 0);
  let r = rng() * z;
  for (let i = 0; i < pool.length; i++) {
    r -= w[i];
    if (r < 0) return pool[i];
  }
  return pool[pool.length - 1];
}

// ------------------------------------------------------------------ whose copy

export type CopyOwner = 'user' | 'demo' | 'unknown';

export interface CopyStatus {
  /**
   * none: no copy yet. ready: learned from the games the app studies now (the user's, or
   * the demo player's while only demo games are analysed). foreign: learned from other
   * games, e.g. the demo player's after the user's own games took over.
   */
  state: 'none' | 'ready' | 'foreign';
  owner: CopyOwner;
  /** Studied games the copy has not learned from yet (0 when unknown). */
  newGames: number;
}

export function copyStatus(
  model: Pick<DoppelModel, 'gameIds'> | null,
  ctx: {
    /** Only the demo player's games are studied (no own game analysed yet). */
    demoMode: boolean;
    sourceOf: (gameId: string) => string | undefined;
    /** The studied player's analysed games. */
    studiedGames: readonly string[];
    /** The studied player's analysed moves. */
    playerMoves: number;
  },
): CopyStatus {
  if (!model) return { state: 'none', owner: 'unknown', newGames: 0 };
  let owner: CopyOwner;
  let newGames = 0;
  if (model.gameIds?.length) {
    const sources = model.gameIds.map(ctx.sourceOf);
    owner = sources.includes('user') ? 'user' : sources.includes('demo') ? 'demo' : 'unknown';
    const known = new Set(model.gameIds);
    newGames = ctx.studiedGames.filter((id) => !known.has(id)).length;
  } else {
    // Older models do not list their games: judge from what is studied now.
    owner = ctx.demoMode ? 'demo' : ctx.playerMoves >= MIN_COPY_MOVES ? 'user' : 'unknown';
  }
  const ready = ctx.demoMode ? owner === 'demo' : owner === 'user';
  return { state: ready ? 'ready' : 'foreign', owner, newGames: ready ? newGames : 0 };
}

// ------------------------------------------------------------------ where the copy and KataGo disagree

export interface MoveValue {
  /** Winrate and score lead for the side to move after the move. */
  win: number;
  lead: number;
}

export interface MoveCost {
  /** Points and winrate the move loses against KataGo's best, for the side to move (>= 0). */
  scoreLoss: number;
  winrateLoss: number;
  /** candidates: KataGo evaluated the move as one of its candidates; played: the loss measured for the move actually played. */
  from: 'candidates' | 'played';
}

const valued = (ev: Pick<PositionEval, 'candidates'>) => (ev.candidates ?? []).filter((c) => c.winrate !== undefined && c.scoreLead !== undefined);

/** KataGo's evaluation of a candidate move, when it has one. */
export function candidateValue(ev: Pick<PositionEval, 'candidates'>, loc: Loc): MoveValue | undefined {
  const c = valued(ev).find((x) => x.loc === loc);
  return c ? { win: c.winrate!, lead: c.scoreLead! } : undefined;
}

/**
 * What playing `loc` costs against KataGo's move `best` (default: its best-valued
 * candidate): from KataGo's candidate evaluations, or, for the move actually played,
 * its measured loss (the same measure as the move records).
 */
export function moveCost(
  ev: Pick<PositionEval, 'candidates'>,
  loc: Loc,
  played?: Pick<MoveRecord, 'loc' | 'scoreLoss' | 'winrateLoss'> | null,
  best?: Loc,
): MoveCost | null {
  const cands = valued(ev);
  const c = cands.find((x) => x.loc === loc);
  if (c) {
    const ref = best === undefined ? undefined : cands.find((x) => x.loc === best);
    const refLead = ref ? ref.scoreLead! : Math.max(...cands.map((x) => x.scoreLead!));
    const refWin = ref ? ref.winrate! : Math.max(...cands.map((x) => x.winrate!));
    return { scoreLoss: Math.max(0, refLead - c.scoreLead!), winrateLoss: Math.max(0, refWin - c.winrate!), from: 'candidates' };
  }
  if (played && played.loc === loc) return { scoreLoss: played.scoreLoss, winrateLoss: played.winrateLoss, from: 'played' };
  return null;
}

export interface DisagreementSource {
  record: Pick<MoveRecord, 'gameId' | 'index' | 'color' | 'loc' | 'bestLoc' | 'scoreLoss' | 'winrateLoss' | 'size' | 'winBefore'>;
  /** The analysis of the position before the move, and of the one after it (if any). */
  eval: PositionEval;
  next?: PositionEval | null;
  /** The position before the move. */
  board: Board;
  /** The opponent's previous move. */
  lastOpp: Loc | null;
}

export interface Disagreement {
  /** Move record id: `${gameId}:${index}`. */
  id: string;
  gameId: string;
  index: number;
  color: Color;
  size: number;
  /** KataGo's move: its policy prior, the copy's probability for it, and its value when known. */
  kata: { loc: Loc; prior: number; p: number; value?: MoveValue };
  /** The copy's most likely move. */
  copy: { loc: Loc; prior: number; p: number; value?: MoveValue };
  /** The copy's three most likely moves. */
  top: DoppelPrediction[];
  /** The move actually played. */
  played: Loc;
  /** The player's winrate before the move. */
  winBefore: number;
  /** What the copy's move costs, when known. */
  cost: MoveCost | null;
  /** What the habit costs here on average: the copy's probability times its move's loss in points. */
  expectedLoss: number | null;
}

/**
 * The copy's view of one of the player's positions. `disagreement` is set when its most
 * likely move is not KataGo's; null overall when it cannot predict there.
 */
export function copyVsKataGo(model: CopyWeights, src: DisagreementSource): { top: DoppelPrediction[]; disagreement: Disagreement | null } | null {
  const { record: r, eval: ev } = src;
  if (r.bestLoc === PASS) return null;
  const ctx = buildContext(src.board, decodeOwnership(ev.ownership));
  const ex = buildExample(ctx, ev.policy, r.color, src.lastOpp, null, r.gameId, { moveNumber: r.index, win: r.winBefore });
  if (!ex) return null;
  const preds = predict(model, ex);
  const top = preds.slice(0, 3);
  if (preds[0].loc === r.bestLoc) return { top, disagreement: null };
  const prior = (loc: Loc) => ev.policy.find((e) => e.loc === loc)?.p ?? ev.candidates?.find((c) => c.loc === loc)?.prior ?? 0;
  const copyLoc = preds[0].loc;
  const cost = moveCost(ev, copyLoc, r, r.bestLoc);
  // Values: KataGo's candidate evaluations; without them, the network's view before and after the move played.
  let kataValue = candidateValue(ev, r.bestLoc);
  let copyValue = candidateValue(ev, copyLoc);
  if (!copyValue && copyLoc === r.loc && src.next && cost?.from === 'played') {
    copyValue = moverView(src.next.bWin, src.next.bLead, r.color);
    if (!kataValue && !ev.candidates?.length) kataValue = moverView(ev.bWin, ev.bLead, r.color);
  }
  return {
    top,
    disagreement: {
      id: `${r.gameId}:${r.index}`,
      gameId: r.gameId,
      index: r.index,
      color: r.color,
      size: r.size,
      kata: { loc: r.bestLoc, prior: prior(r.bestLoc), p: preds.find((x) => x.loc === r.bestLoc)?.p ?? 0, value: kataValue },
      copy: { loc: copyLoc, prior: prior(copyLoc), p: preds[0].p, value: copyValue },
      top,
      played: r.loc,
      winBefore: r.winBefore,
      cost,
      expectedLoss: cost ? preds[0].p * cost.scoreLoss : null,
    },
  };
}

/** Early opening on 19×19 (scaled by board area): choices there are mostly style, so a disagreement must cost more. */
export const OPENING_MOVES_19 = 30;
export const OPENING_MIN_LOSS = 3;
/** Losses above this many points rank alike (a huge "loss" is usually a group whose fate the network misreads). */
export const LOSS_CAP = 15;

export interface RankOptions {
  /** Points the copy's move must lose to count (default 1). */
  minLoss?: number;
  /** Leave out decided games: the side that is behind must keep this winrate (default 0.3, as in practice). */
  minLosingWinrate?: number;
}

/** Is the disagreement worth showing: a real game, and a real cost for its phase? */
export function isTellingDisagreement(d: Disagreement, opts: RankOptions = {}): boolean {
  if (!d.cost || d.expectedLoss === null) return false;
  const minWin = opts.minLosingWinrate ?? 0.3;
  if (!(Math.min(d.winBefore, 1 - d.winBefore) >= minWin - 1e-9)) return false;
  const opening = Math.round((OPENING_MOVES_19 * d.size * d.size) / 361);
  const min = Math.max(opts.minLoss ?? 1, d.index < opening ? OPENING_MIN_LOSS : 0);
  return d.cost.scoreLoss >= min;
}

/** What the habit costs in points, with huge losses capped so misreads do not dominate. */
export const habitCost = (d: Disagreement) => (d.cost ? d.copy.p * Math.min(d.cost.scoreLoss, LOSS_CAP) : 0);

/**
 * The telling disagreements (see isTellingDisagreement), the most expensive habit first:
 * the copy's probability times the points its move loses.
 */
export function rankDisagreements(list: readonly Disagreement[], opts: RankOptions = {}): Disagreement[] {
  return list
    .filter((d) => isTellingDisagreement(d, opts))
    .sort((a, b) => habitCost(b) - habitCost(a) || b.cost!.scoreLoss - a.cost!.scoreLoss || b.copy.p - a.copy.p || a.id.localeCompare(b.id));
}
