/**
 * Fit the rank calibration from the corpus made by scripts/rank-corpus.ts and write
 * public/level/calibration.json, which the app loads to estimate a player's level.
 *
 *   npx tsx scripts/rank-fit.ts corpus/out/*.jsonl
 *
 * Accuracy is measured on held-out games (5-fold, split by game so both sides of a game
 * stay in the same fold), for one game and for several games of the same rank averaged.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURE_KEYS, PHASES, poolFeatures, type GameLevelSample, type LevelFeatures } from '../src/lib/level/stats';
import { combine, MIN_GAME_MOVES, predictOne, type LevelCalibration, type LevelModel, type RankBucket } from '../src/lib/level/model';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'public', 'level', 'calibration.json');

interface Row extends GameLevelSample {
  file: string;
  color: number;
  rank: number;
  handicap: number;
}

const rows: Row[] = [];
const seen = new Set<string>();
for (const f of process.argv.slice(2))
  for (const l of readFileSync(f, 'utf8').split('\n')) {
    if (!l) continue;
    const r = JSON.parse(l);
    if (r.skipped || r.all === undefined || seen.has(`${r.file}:${r.color}`)) continue;
    seen.add(`${r.file}:${r.color}`);
    rows.push(r);
  }
console.log(`${rows.length} game sides from ${new Set(rows.map((r) => r.file)).size} games`);

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const foldOf = (r: Row) => hash(r.file) % 5;

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Inverse and log determinant of a symmetric positive definite matrix. */
function invert(A: number[][]): { inv: number[][]; logdet: number } {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  let logdet = 0;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c];
    logdet += Math.log(Math.abs(piv));
    for (let j = 0; j < 2 * n; j++) M[c][j] /= piv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c];
      for (let j = 0; j < 2 * n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return { inv: M.map((row) => row.slice(n)), logdet };
}

const DEGREE = 3;
const BANDS = [-9, 0, 99];
const N_REF = 60;

function fit(data: { f: LevelFeatures; y: number }[]): Omit<LevelModel, 'residualSd' | 'maeGame'> {
  const k = FEATURE_KEYS.length;
  const w = data.map((d) => Math.min(d.f.n, 80));
  // Typical value of each feature at each rank: a weighted polynomial fit.
  const mu = FEATURE_KEYS.map((key) => {
    const p = DEGREE + 1;
    const A = Array.from({ length: p }, () => new Array(p).fill(0));
    const b = new Array(p).fill(0);
    data.forEach((d, r) => {
      const x = Array.from({ length: p }, (_, i) => d.y ** i);
      for (let i = 0; i < p; i++) {
        b[i] += w[r] * x[i] * d.f[key];
        for (let j = 0; j < p; j++) A[i][j] += w[r] * x[i] * x[j];
      }
    });
    return solve(A, b);
  });
  // Spread around it, scaled to a game of N_REF moves, per band of ranks.
  const bands = BANDS.map((upTo, bi) => {
    const lo = bi ? BANDS[bi - 1] : -Infinity;
    const inBand = data.filter((d) => d.y > lo && d.y <= upTo);
    const C = Array.from({ length: k }, () => new Array(k).fill(0));
    for (const d of inBand) {
      const m = mu.map((c) => c.reduce((a, ci, i) => a + ci * d.y ** i, 0));
      const x = FEATURE_KEYS.map((key, i) => (d.f[key] - m[i]) * Math.sqrt(d.f.n / N_REF));
      for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) C[i][j] += (x[i] * x[j]) / inBand.length;
    }
    for (let i = 0; i < k; i++) C[i][i] *= 1.02; // a little shrinkage keeps it invertible
    const { inv, logdet } = invert(C);
    return { upTo, prec: inv.flat(), logdet };
  });
  return { mu, bands, nRef: N_REF };
}

type Pick = (r: Row) => LevelFeatures | undefined;

function crossValidate(pick: Pick) {
  const errs: { r: Row; pred: number }[] = [];
  const folds: LevelModel[] = [];
  for (let fold = 0; fold < 5; fold++) {
    const train = rows.filter((r) => foldOf(r) !== fold && (pick(r)?.n ?? 0) >= MIN_GAME_MOVES);
    const m = fit(train.map((r) => ({ f: pick(r)!, y: r.rank })));
    const full: LevelModel = { ...m, residualSd: 0, maeGame: 0 };
    folds.push(full);
    for (const r of rows.filter((r) => foldOf(r) === fold && (pick(r)?.n ?? 0) >= MIN_GAME_MOVES)) errs.push({ r, pred: predictOne(full, pick(r)!) });
  }
  const mae = errs.reduce((a, e) => a + Math.abs(e.pred - e.r.rank), 0) / errs.length;
  const sd = Math.sqrt(errs.reduce((a, e) => a + (e.pred - e.r.rank) ** 2, 0) / errs.length);
  const bias = errs.reduce((a, e) => a + e.pred - e.r.rank, 0) / errs.length;
  return { errs, mae, sd, bias, folds };
}

function model(pick: Pick): LevelModel & { errs: { r: Row; pred: number }[]; folds: LevelModel[] } {
  const cv = crossValidate(pick);
  const m = fit(rows.filter((r) => (pick(r)?.n ?? 0) >= MIN_GAME_MOVES).map((r) => ({ f: pick(r)!, y: r.rank })));
  return { ...m, residualSd: round(cv.sd, 3), maeGame: round(cv.mae, 3), errs: cv.errs, folds: cv.folds };
}

const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

const all = model((r) => r.all);
console.log(`one game: mean error ${all.maeGame} ranks, sd ${all.residualSd}`);
for (const band of [[-17, -9], [-8, 0], [1, 9]]) {
  const e = all.errs.filter((x) => x.r.rank >= band[0] && x.r.rank <= band[1]);
  console.log(`  ranks ${band[0]}..${band[1]}: mean error ${(e.reduce((a, x) => a + Math.abs(x.pred - x.r.rank), 0) / e.length).toFixed(2)}, bias ${(e.reduce((a, x) => a + x.pred - x.r.rank, 0) / e.length).toFixed(2)}`);
}
const phases: LevelCalibration['phases'] = {};
for (const p of PHASES) {
  if (rows.filter((r) => (r.phases[p]?.n ?? 0) >= MIN_GAME_MOVES).length < 60) {
    console.log(`${p}: too few game sides, no model`);
    continue;
  }
  const m = model((r) => r.phases[p]);
  console.log(`${p}: one game mean error ${m.maeGame} ranks`);
  const { errs: _e, folds: _f, ...rest } = m;
  phases[p] = strip(rest);
}

function strip(m: LevelModel): LevelModel {
  const r = (v: number) => Number(v.toPrecision(6));
  return { mu: m.mu.map((c) => c.map(r)), bands: m.bands.map((b) => ({ upTo: b.upTo, prec: b.prec.map(r), logdet: r(b.logdet) })), nRef: m.nRef, residualSd: m.residualSd, maeGame: m.maeGame };
}

// Several games of one player, simulated with held-out sides of the same rank.
const maeByGames: Record<string, number> = { '1': all.maeGame };
const byRank = new Map<number, Row[]>();
for (const e of all.errs) byRank.set(e.r.rank, [...(byRank.get(e.r.rank) ?? []), e.r]);
let seed = 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
for (const k of [3, 5, 10]) {
  let err = 0, n = 0;
  for (const [rank, list] of byRank)
    for (let fold = 0; fold < 5; fold++) {
      // Games of one fold, scored by the model that never saw that fold.
      const inFold = list.filter((r) => foldOf(r) === fold);
      if (inFold.length < k) continue;
      for (let t = 0; t < 8; t++) {
        const pickRows = [...inFold].sort(() => rnd() - 0.5).slice(0, k);
        const e = combine(all.folds[fold], pickRows.map((r) => r.all));
        if (!e) continue;
        err += Math.abs(e.rank - rank);
        n++;
      }
    }
  maeByGames[String(k)] = round(err / n, 3);
  console.log(`${k} games: mean error ${maeByGames[String(k)]} ranks`);
}

// Typical numbers and decision error rates per rank.
const buckets: RankBucket[] = [];
for (const rank of [...byRank.keys()].sort((a, b) => a - b)) {
  const list = rows.filter((r) => r.rank === rank);
  const signatures: Record<string, [number, number]> = {};
  for (const r of list)
    for (const [id, [c, e]] of Object.entries(r.signatures)) {
      const t = (signatures[id] ??= [0, 0]);
      t[0] += c;
      t[1] += e;
    }
  const f = poolFeatures(list.map((r) => r.all))!;
  buckets.push({
    rank,
    games: list.length,
    features: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, round(v)])) as unknown as LevelFeatures,
    signatures,
  });
}

const { errs: _errs, folds: _folds, ...allModel } = all;
const cal: LevelCalibration = {
  version: 1,
  modelId: 'g170e-b10c128',
  source: 'Fox Go dataset (github.com/featurecat/go-dataset, GPL-3.0): a random sample of even and no-komi games, ranks from BR/WR',
  samples: rows.length,
  games: new Set(rows.map((r) => r.file)).size,
  features: FEATURE_KEYS,
  all: strip(allModel),
  phases,
  buckets,
  maeByGames,
  createdAt: new Date().toISOString(),
};
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(cal));
console.log(`wrote ${OUT}`);
for (const b of buckets) console.log(b.rank, b.games, b.features.top1, b.features.loss, b.features.blunders);
