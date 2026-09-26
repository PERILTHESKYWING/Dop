import { replay, type Board } from '../go/board';
import { buildContext, pointFeatures, type PositionContext } from '../go/features';
import { PASS, type Color, type Loc, type Move } from '../go/types';
import { decodeOwnership, moverView } from '../engine/parse';
import type { MoveRecord, PointFeatures, PolicyEntry, PositionEval } from '../types';

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
] as const;

export const NF = DOPPEL_FEATURES.length;

/**
 * Training method. 2: learns only from choices among KataGo's candidates (a move outside
 * that list says nothing about how the player ranks them, and flattened the model), and
 * counts such moves as misses when measuring accuracy. Models without it used method 1.
 */
export const DOPPEL_ALGO = 2;

/** How many of KataGo's top policy moves the copy chooses among. */
export const CANDIDATES = 10;

/** The copy is trained once this many of the player's moves are analysed (see rebuildProfile). */
export const MIN_COPY_MOVES = 30;

export function featureVector(p: PointFeatures, prior: number, isTop: boolean): Float32Array {
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
}

/** Candidate set: KataGo's top policy moves plus the played move. */
export function buildExample(
  ctx: PositionContext,
  policy: PolicyEntry[],
  color: Color,
  lastOpp: Loc | null,
  played: Loc | null,
  gameId = '',
): DoppelExample | null {
  const cands: { loc: Loc; p: number }[] = policy.filter((e) => e.loc !== PASS).slice(0, CANDIDATES);
  let outside = false;
  if (played !== null && played !== PASS && !cands.some((c) => c.loc === played)) {
    cands.push({ loc: played, p: 0.0005 });
    outside = true;
  }
  if (cands.length < 2) return null;
  const top = cands[0].loc;
  const x = cands.map((c) => featureVector(pointFeatures(ctx, c.loc, color, lastOpp), c.p, c.loc === top));
  const y = played === null ? -1 : cands.findIndex((c) => c.loc === played);
  return { gameId, candidates: cands.map((c) => c.loc), x, y, outside };
}

export interface DoppelModel {
  version: number;
  weights: number[];
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
  };
  /** Training method (DOPPEL_ALGO); absent on models trained by the first method. */
  algo?: number;
  /** All of the player's moves seen, including those outside KataGo's candidates. */
  moves?: number;
  /** The games those moves came from. */
  gameIds?: string[];
  /** Share of the player's moves that were not among KataGo's top candidates. */
  outsideRate?: number;
}

export function initialWeights(): Float32Array {
  const w = new Float32Array(NF);
  w[0] = 1; // start as KataGo's policy
  return w;
}

export function scores(w: ArrayLike<number>, ex: DoppelExample): number[] {
  const s = ex.x.map((v) => {
    let t = 0;
    for (let k = 0; k < NF; k++) t += (w[k] ?? 0) * v[k];
    return t;
  });
  const m = Math.max(...s);
  const e = s.map((v) => Math.exp(v - m));
  const z = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / z);
}

/**
 * Accuracy as the copy is used: it only ever proposes KataGo's candidates, so a move
 * outside them is a miss for it (and for KataGo's policy). Log-loss is over the rest.
 */
function evaluate(w: ArrayLike<number>, test: DoppelExample[]) {
  let top1 = 0;
  let top3 = 0;
  let ll = 0;
  let listed = 0;
  for (const ex of test) {
    if (ex.outside) continue;
    const p = scores(w, ex);
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

type TrainOptions = { epochs?: number; lr?: number; l2?: number; version?: number };

/** Mini-batch gradient descent with L2 regularisation toward the engine prior. */
function fitWeights(examples: DoppelExample[], opts: TrainOptions): Float32Array {
  const train = examples.filter((e) => !e.outside);
  const w = initialWeights();
  const w0 = initialWeights();
  const epochs = opts.epochs ?? 40;
  const lr = opts.lr ?? 0.05;
  // Few moves to learn from: stay closer to KataGo's policy.
  const l2 = opts.l2 ?? Math.max(0.01, 3 / Math.max(train.length, 1));
  const g = new Float32Array(NF);
  for (let ep = 0; ep < epochs; ep++) {
    const rate = lr / (1 + ep * 0.05);
    for (let b = 0; b < train.length; b += 32) {
      g.fill(0);
      const batch = train.slice(b, b + 32);
      for (const ex of batch) {
        const p = scores(w, ex);
        for (let c = 0; c < ex.x.length; c++) {
          const d = p[c] - (c === ex.y ? 1 : 0);
          for (let k = 0; k < NF; k++) g[k] += d * ex.x[c][k];
        }
      }
      for (let k = 0; k < NF; k++) w[k] -= rate * (g[k] / batch.length + l2 * (w[k] - w0[k]));
    }
  }
  return w;
}

/**
 * Train the copy. Accuracy is measured on whole games held out from a first fit; the
 * copy then learns from all the moves.
 */
export function trainDoppel(examples: DoppelExample[], opts: TrainOptions = {}): DoppelModel {
  const data = examples.filter((e) => e.y >= 0);
  // Hold out whole games so the test measures generalisation to new games.
  const games = [...new Set(data.map((e) => e.gameId))];
  const testGames = new Set(games.filter((_, i) => i % 5 === 4));
  let train = data.filter((e) => !testGames.has(e.gameId));
  let test = data.filter((e) => testGames.has(e.gameId));
  if (!test.length || !train.length) {
    train = data.filter((_, i) => i % 5 !== 4);
    test = data.filter((_, i) => i % 5 === 4);
  }
  const m = evaluate(fitWeights(train, opts), test);
  const base = evaluate(initialWeights(), test);
  const w = fitWeights(data, opts);
  const listed = data.filter((e) => !e.outside).length;
  return {
    version: opts.version ?? 1,
    algo: DOPPEL_ALGO,
    weights: Array.from(w),
    trainedOn: listed,
    moves: data.length,
    gameIds: games.filter(Boolean),
    outsideRate: data.length ? (data.length - listed) / data.length : 0,
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
  };
}

export interface DoppelPrediction {
  loc: Loc;
  p: number;
}

export function predict(model: Pick<DoppelModel, 'weights'>, ex: DoppelExample): DoppelPrediction[] {
  const p = scores(model.weights, ex);
  return ex.candidates.map((loc, i) => ({ loc, p: p[i] })).sort((a, b) => b.p - a.p);
}

/** Human-readable habits: the largest learned deviations from KataGo. */
export function describeWeights(model: Pick<DoppelModel, 'weights'>): { label: string; weight: number }[] {
  return model.weights
    .map((w, i) => ({ label: DOPPEL_FEATURES[i], weight: i === 0 ? w - 1 : w }))
    .filter((d, i) => i !== 0 && i !== 20 && Math.abs(d.weight) > 0.05)
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
export function predictForPosition(model: Pick<DoppelModel, 'weights'> | null | undefined, input: PositionInput, k = 3): DoppelPrediction[] {
  if (!model) return [];
  const board = input.board ?? replay(input.size, [...(input.setup ?? [])], [...input.history]);
  const ctx = buildContext(board, ownershipArray(input.ownership, board.stones.length));
  const last = input.history.length ? input.history[input.history.length - 1] : null;
  const lastOpp = last && last.color !== input.toPlay ? last.loc : null;
  const ex = buildExample(ctx, policyEntries(input.policy, board, input.toPlay), input.toPlay, lastOpp, null);
  return ex ? predict(model, ex).slice(0, k) : [];
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
export function copyVsKataGo(model: Pick<DoppelModel, 'weights'>, src: DisagreementSource): { top: DoppelPrediction[]; disagreement: Disagreement | null } | null {
  const { record: r, eval: ev } = src;
  if (r.bestLoc === PASS) return null;
  const ctx = buildContext(src.board, decodeOwnership(ev.ownership));
  const ex = buildExample(ctx, ev.policy, r.color, src.lastOpp, null);
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
