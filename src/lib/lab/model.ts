import { allPositions, type Board } from '../go/board';
import { chebyshev, lineOf } from '../go/coords';
import { PASS, type Color, type Loc } from '../go/types';
import type { GameAnalysis, GameRecord } from '../types';
import { hashString } from '../util/hash';

/**
 * Self-improving lightweight model ("PatternNet-lite").
 *
 * KataGo analyses → training dataset → small model → benchmark → the positions the
 * model gets most wrong are sent back for deeper KataGo analysis → next dataset.
 *
 * The model is a log-linear move predictor over 3x3 shape patterns, line, distance
 * to the last move and liberty/capture features, plus a logistic value head. It is
 * orders of magnitude weaker than KataGo and is benchmarked against it, never
 * presented as a replacement. Its job is to be a cheap, versioned learner whose
 * improvement can be measured.
 */

export const PATTERN_SPACE = 1 << 16;
const DIST_BUCKETS = 6;
const LINE_BUCKETS = 6;

export interface LiteExample {
  gameId: string;
  index: number;
  size: number;
  toPlay: Color;
  legal: Loc[];
  /** Per legal point: [pattern, line, distBucket, flags] */
  feats: Uint32Array;
  /** KataGo policy target over legal points (sparse). */
  target: { i: number; p: number }[];
  bestIdx: number;
  value: number;
  valueFeats: Float32Array;
  deep: boolean;
}

export interface LiteWeights {
  pattern: Float32Array;
  line: Float32Array;
  dist: Float32Array;
  flags: Float32Array; // captures, atari, self-atari, saves atari
  value: Float32Array; // bias + 5 features
}

export interface LiteModelRecord {
  id: string;
  version: number;
  createdAt: number;
  datasetId: string;
  datasetSize: number;
  trainPositions: number;
  epochs: number;
  weights: { pattern: number[]; line: number[]; dist: number[]; flags: number[]; value: number[] };
  benchmark: Benchmark;
  parentId?: string;
  notes: string;
}

export interface Benchmark {
  positions: number;
  top1: number;
  top5: number;
  crossEntropy: number;
  valueMae: number;
  baselines: { uniformTop1: number; nearLastTop1: number; uniformCrossEntropy: number };
  referenceEngine: string;
}

export interface DatasetMeta {
  id: string;
  version: number;
  createdAt: number;
  positions: number;
  deepPositions: number;
  games: number;
  engineModels: string[];
  fingerprint: string;
}

/** 3x3 neighbourhood code (mover-relative, 2 bits per neighbour), canonical over symmetries. */
export function patternCode(board: Board, loc: Loc, mover: Color): number {
  const n = board.size;
  const x = loc % n, y = (loc - x) / n;
  const cell = (dx: number, dy: number) => {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= n || yy >= n) return 3;
    const c = board.stones[yy * n + xx];
    return c === 0 ? 0 : c === mover ? 1 : 2;
  };
  // neighbours in a fixed ring order
  const ring = [
    [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0],
  ];
  let best = Infinity;
  for (let sym = 0; sym < 8; sym++) {
    let code = 0;
    for (const [dx0, dy0] of ring) {
      let dx = dx0, dy = dy0;
      if (sym & 1) dx = -dx;
      if (sym & 2) dy = -dy;
      if (sym & 4) [dx, dy] = [dy, dx];
      code = (code << 2) | cell(dx, dy);
    }
    if (code < best) best = code;
  }
  return best;
}

function flagsFor(board: Board, loc: Loc, mover: Color): number {
  let caps = 0, atari = 0, selfAtari = 0, saves = 0;
  for (const q of board.neighbors(loc)) {
    const c = board.stones[q];
    if (c === 0) continue;
    const libs = board.libertyCount(q);
    if (c !== mover && libs === 1) caps = 1;
    if (c !== mover && libs === 2) atari = 1;
    if (c === mover && libs === 1) saves = 1;
  }
  let empty = 0;
  for (const q of board.neighbors(loc)) if (board.stones[q] === 0) empty++;
  if (!caps && empty <= 1 && !board.neighbors(loc).some((q) => board.stones[q] === mover && board.libertyCount(q) > 2)) selfAtari = 1;
  return caps | (atari << 1) | (selfAtari << 2) | (saves << 3);
}

function valueFeatures(board: Board, mover: Color, moveNumber: number, komi: number): Float32Array {
  const [, b, w] = board.counts();
  const own = mover === 1 ? b : w;
  const opp = mover === 1 ? w : b;
  const k = mover === 1 ? -komi : komi;
  const caps = board.captures[mover] - board.captures[mover === 1 ? 2 : 1];
  return new Float32Array([1, (own - opp) / 20, caps / 10, k / 10, Math.min(moveNumber, 300) / 300, mover === 1 ? 1 : 0]);
}

/** Turn analysed games into training examples (KataGo policy/value as targets). */
export function buildExamples(games: GameRecord[], analyses: Map<string, GameAnalysis>, maxPerGame = 400): LiteExample[] {
  const out: LiteExample[] = [];
  for (const g of games) {
    const a = analyses.get(g.id);
    if (!a) continue;
    const boards = allPositions(g.size, g.setup, g.moves);
    const step = Math.max(1, Math.ceil(g.moves.length / maxPerGame));
    for (let i = 0; i < g.moves.length; i += step) {
      const e = a.evals[i];
      if (!e || !e.policy.length) continue;
      const board = boards[i];
      const mover = e.toPlay;
      const prev = i > 0 ? g.moves[i - 1].loc : PASS;
      const legal: Loc[] = [];
      for (let l = 0; l < g.size * g.size; l++) if (board.isLegal(l, mover)) legal.push(l);
      if (!legal.length) continue;
      const feats = new Uint32Array(legal.length * 4);
      const index = new Map<Loc, number>();
      legal.forEach((l, j) => {
        index.set(l, j);
        const d = prev === PASS ? DIST_BUCKETS - 1 : Math.min(DIST_BUCKETS - 1, chebyshev(l, prev, g.size) - 1);
        feats[j * 4] = patternCode(board, l, mover);
        feats[j * 4 + 1] = Math.min(LINE_BUCKETS - 1, lineOf(l, g.size) - 1);
        feats[j * 4 + 2] = Math.max(0, d);
        feats[j * 4 + 3] = flagsFor(board, l, mover);
      });
      const target: { i: number; p: number }[] = [];
      let z = 0;
      for (const p of e.policy) {
        const j = index.get(p.loc);
        if (j === undefined) continue;
        target.push({ i: j, p: p.p });
        z += p.p;
      }
      if (!target.length) continue;
      for (const t of target) t.p /= z;
      const bestIdx = index.get(e.bestLoc) ?? target[0].i;
      out.push({
        gameId: g.id,
        index: i,
        size: g.size,
        toPlay: mover,
        legal,
        feats,
        target,
        bestIdx,
        value: mover === 1 ? e.bWin : 1 - e.bWin,
        valueFeats: valueFeatures(board, mover, i + 1, g.komi),
        deep: e.depth === 'deep',
      });
    }
  }
  return out;
}

export function datasetMeta(examples: LiteExample[], _games: GameRecord[], analyses: Map<string, GameAnalysis>, version: number): DatasetMeta {
  const models = new Set<string>();
  for (const a of analyses.values()) if (a.engine) models.add(a.engine.modelId);
  const fp = hashString(examples.map((e) => `${e.gameId}:${e.index}:${e.deep ? 1 : 0}`).join('|'));
  return {
    id: `ds-${version}-${fp.slice(0, 8)}`,
    version,
    createdAt: Date.now(),
    positions: examples.length,
    deepPositions: examples.filter((e) => e.deep).length,
    games: new Set(examples.map((e) => e.gameId)).size,
    engineModels: [...models],
    fingerprint: fp,
  };
}

export function emptyWeights(): LiteWeights {
  return {
    pattern: new Float32Array(PATTERN_SPACE),
    line: new Float32Array(LINE_BUCKETS),
    dist: new Float32Array(DIST_BUCKETS),
    flags: new Float32Array(4),
    value: new Float32Array(6),
  };
}

function logits(w: LiteWeights, ex: LiteExample): Float32Array {
  const n = ex.legal.length;
  const out = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const f = ex.feats;
    let s = w.pattern[f[j * 4]] + w.line[f[j * 4 + 1]] + w.dist[f[j * 4 + 2]];
    const fl = f[j * 4 + 3];
    for (let b = 0; b < 4; b++) if (fl & (1 << b)) s += w.flags[b];
    out[j] = s;
  }
  return out;
}

function softmax(x: Float32Array): Float32Array {
  let m = -Infinity;
  for (const v of x) if (v > m) m = v;
  let z = 0;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    out[i] = Math.exp(x[i] - m);
    z += out[i];
  }
  for (let i = 0; i < x.length; i++) out[i] /= z;
  return out;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function splitExamples(examples: LiteExample[]) {
  const test = examples.filter((e) => parseInt(e.gameId.slice(-2), 16) % 5 === 0);
  const train = examples.filter((e) => parseInt(e.gameId.slice(-2), 16) % 5 !== 0);
  if (!test.length || !train.length) return { train: examples.filter((_, i) => i % 5), test: examples.filter((_, i) => !(i % 5)) };
  return { train, test };
}

export function trainLite(
  train: LiteExample[],
  opts: { epochs?: number; lr?: number; init?: LiteWeights; onEpoch?: (e: number, loss: number) => void } = {},
): LiteWeights {
  const w = opts.init ?? emptyWeights();
  const epochs = opts.epochs ?? 6;
  const lr = opts.lr ?? 0.4;
  for (let ep = 0; ep < epochs; ep++) {
    let loss = 0;
    const rate = lr / (1 + ep * 0.3);
    for (const ex of train) {
      const p = softmax(logits(w, ex));
      const t = new Float32Array(p.length);
      for (const { i, p: q } of ex.target) t[i] = q;
      // Deep-analysed positions carry more weight: their best move is search-verified.
      const weight = ex.deep ? 1.5 : 1;
      for (const { i, p: q } of ex.target) loss -= q * Math.log(Math.max(p[i], 1e-9));
      for (let j = 0; j < p.length; j++) {
        const g = (p[j] - t[j]) * rate * weight;
        if (Math.abs(g) < 1e-7) continue;
        const f = ex.feats;
        w.pattern[f[j * 4]] -= g;
        w.line[f[j * 4 + 1]] -= g * 0.1;
        w.dist[f[j * 4 + 2]] -= g * 0.1;
        const fl = f[j * 4 + 3];
        for (let b = 0; b < 4; b++) if (fl & (1 << b)) w.flags[b] -= g * 0.1;
      }
      // Value head: logistic regression toward KataGo's winrate.
      let s = 0;
      for (let k = 0; k < w.value.length; k++) s += w.value[k] * ex.valueFeats[k];
      const err = sigmoid(s) - ex.value;
      for (let k = 0; k < w.value.length; k++) w.value[k] -= 0.05 * err * ex.valueFeats[k];
    }
    opts.onEpoch?.(ep, loss / Math.max(train.length, 1));
  }
  return w;
}

export function benchmark(w: LiteWeights, test: LiteExample[], engineName: string): Benchmark {
  let top1 = 0, top5 = 0, ce = 0, mae = 0, uniTop1 = 0, nearTop1 = 0, uniCe = 0;
  for (const ex of test) {
    const p = softmax(logits(w, ex));
    const order = Array.from(p.keys()).sort((a, b) => p[b] - p[a]);
    const rank = order.indexOf(ex.bestIdx);
    if (rank === 0) top1++;
    if (rank >= 0 && rank < 5) top5++;
    for (const { i, p: q } of ex.target) ce -= q * Math.log(Math.max(p[i], 1e-9));
    uniCe += Math.log(ex.legal.length);
    uniTop1 += 1 / ex.legal.length;
    // "Play next to the last move" heuristic.
    let nearest = 0, bestD = Infinity;
    for (let j = 0; j < ex.legal.length; j++) {
      const d = ex.feats[j * 4 + 2];
      if (d < bestD) {
        bestD = d;
        nearest = j;
      }
    }
    if (nearest === ex.bestIdx) nearTop1++;
    let s = 0;
    for (let k = 0; k < w.value.length; k++) s += w.value[k] * ex.valueFeats[k];
    mae += Math.abs(sigmoid(s) - ex.value);
  }
  const n = Math.max(test.length, 1);
  return {
    positions: test.length,
    top1: top1 / n,
    top5: top5 / n,
    crossEntropy: ce / n,
    valueMae: mae / n,
    baselines: { uniformTop1: uniTop1 / n, nearLastTop1: nearTop1 / n, uniformCrossEntropy: uniCe / n },
    referenceEngine: engineName,
  };
}

/** Positions where the model disagrees most with KataGo: candidates for deeper analysis. */
export function hardExamples(w: LiteWeights, examples: LiteExample[], k = 30): { gameId: string; index: number; pBest: number }[] {
  return examples
    .filter((e) => !e.deep)
    .map((ex) => ({ gameId: ex.gameId, index: ex.index, pBest: softmax(logits(w, ex))[ex.bestIdx] }))
    .sort((a, b) => a.pBest - b.pBest)
    .slice(0, k);
}

export const weightsToRecord = (w: LiteWeights) => ({
  pattern: Array.from(w.pattern),
  line: Array.from(w.line),
  dist: Array.from(w.dist),
  flags: Array.from(w.flags),
  value: Array.from(w.value),
});

export const weightsFromRecord = (r: LiteModelRecord['weights']): LiteWeights => ({
  pattern: Float32Array.from(r.pattern),
  line: Float32Array.from(r.line),
  dist: Float32Array.from(r.dist),
  flags: Float32Array.from(r.flags),
  value: Float32Array.from(r.value),
});
