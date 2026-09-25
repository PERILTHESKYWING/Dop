import { pointFeatures, type PositionContext } from '../go/features';
import { PASS, type Color, type Loc } from '../go/types';
import type { PolicyEntry, PointFeatures } from '../types';

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
  const cands: { loc: Loc; p: number }[] = policy.filter((e) => e.loc !== PASS).slice(0, 10);
  if (played !== null && played !== PASS && !cands.some((c) => c.loc === played)) cands.push({ loc: played, p: 0.0005 });
  if (cands.length < 2) return null;
  const top = cands[0].loc;
  const x = cands.map((c) => featureVector(pointFeatures(ctx, c.loc, color, lastOpp), c.p, c.loc === top));
  const y = played === null ? -1 : cands.findIndex((c) => c.loc === played);
  return { gameId, candidates: cands.map((c) => c.loc), x, y };
}

export interface DoppelModel {
  version: number;
  weights: number[];
  trainedOn: number;
  trainedAt: number;
  metrics: {
    top1: number;
    top3: number;
    baselineTop1: number;
    baselineTop3: number;
    logLoss: number;
    baselineLogLoss: number;
    testSize: number;
  };
}

export function initialWeights(): Float32Array {
  const w = new Float32Array(NF);
  w[0] = 1; // start as KataGo's policy
  return w;
}

export function scores(w: ArrayLike<number>, ex: DoppelExample): number[] {
  const s = ex.x.map((v) => {
    let t = 0;
    for (let k = 0; k < NF; k++) t += w[k] * v[k];
    return t;
  });
  const m = Math.max(...s);
  const e = s.map((v) => Math.exp(v - m));
  const z = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / z);
}

function evaluate(w: ArrayLike<number>, test: DoppelExample[]) {
  let top1 = 0;
  let top3 = 0;
  let ll = 0;
  for (const ex of test) {
    const p = scores(w, ex);
    const order = p.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
    const rank = order.findIndex(([, i]) => i === ex.y);
    if (rank === 0) top1++;
    if (rank >= 0 && rank < 3) top3++;
    ll -= Math.log(Math.max(p[ex.y], 1e-9));
  }
  const n = Math.max(test.length, 1);
  return { top1: top1 / n, top3: top3 / n, logLoss: ll / n };
}

/** Train with mini-batch gradient descent and L2 regularisation toward the engine prior. */
export function trainDoppel(examples: DoppelExample[], opts: { epochs?: number; lr?: number; l2?: number; version?: number } = {}): DoppelModel {
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
  const w = initialWeights();
  const w0 = initialWeights();
  const epochs = opts.epochs ?? 40;
  const lr = opts.lr ?? 0.05;
  const l2 = opts.l2 ?? 0.01;
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
  const m = evaluate(w, test);
  const base = evaluate(w0, test);
  return {
    version: opts.version ?? 1,
    weights: Array.from(w),
    trainedOn: train.length,
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
