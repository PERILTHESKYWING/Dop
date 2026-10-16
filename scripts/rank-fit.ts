/**
 * Fit the rank calibration from the corpus made by scripts/rank-corpus.ts and write
 * public/level/calibration.json, which the app loads to estimate a player's level.
 *
 *   npx tsx scripts/rank-fit.ts corpus/rank.jsonl corpus/elite.jsonl
 *
 * The model (src/lib/level/model.ts) is a ridge regression from a game's numbers to a
 * score, and a table of how that score spreads around each true rank. Accuracy is
 * measured on held-out games (5-fold, split by game so both sides of a game stay in the
 * same fold), for one game and for several games of the same rank combined.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURE_KEYS, PHASES, poolFeatures, type GameLevelSample, type LevelFeatures } from '../src/lib/level/stats';
import {
  combineTiered,
  TOP_TRAIN_FROM,
  LENGTH_BUCKETS,
  lengthBucket,
  MIN_GAME_MOVES,
  MIN_PHASE_MOVES,
  debias as debiasRank,
  predictOne,
  ridgeFeatures,
  ridgeScore,
  type LevelCalibration,
  type RankBucket,
  type RidgeInput,
  type RidgeModel,
} from '../src/lib/level/model';
import { MAX_RANK, MIN_RANK } from '../src/lib/level/ranks';
import type { Phase } from '../src/lib/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'public', 'level', 'calibration.json');

interface Row extends GameLevelSample {
  file: string;
  color: number;
  rank: number;
  handicap: number;
  /** "ogs": an OGS rank, mapped onto Fox's below. Otherwise a Fox (or 10d-12d) rank. */
  src?: string;
  date?: string;
}

const rows: Row[] = [];
const seen = new Set<string>();
for (const f of process.argv.slice(2))
  for (const l of readFileSync(f, 'utf8').split('\n')) {
    if (!l) continue;
    let r;
    try {
      r = JSON.parse(l);
    } catch {
      continue; // a line cut off when a measuring run was stopped
    }
    const id = `${String(r.file).split('/').pop()}:${r.color}`;
    if (r.skipped || r.all === undefined || seen.has(id) || r.rank < MIN_RANK || r.rank > MAX_RANK) continue;
    seen.add(id);
    rows.push(r);
  }
console.log(`${rows.length} game sides from ${new Set(rows.map((r) => r.file)).size} games`);
const t0 = Date.now();

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const foldOf = (r: Row) => hash(r.file) % 5;

/**
 * Games from RECENT_FROM on count RECENT_WEIGHT times as much: today's players open and
 * fight differently from 2019's (AI openings everywhere), and the app measures today's.
 */
const RECENT_FROM = 2022;
const RECENT_WEIGHT = 2;
function yearOf(r: Row): number | null {
  const y = Number((r.date ?? '').slice(0, 4));
  if (y > 1900) return y;
  // Fox file names start with the game's Unix time.
  const unix = Number(String(r.file).split('/').pop()!.slice(0, 10));
  return unix > 1e9 && unix < 4e9 ? new Date(unix * 1000).getUTCFullYear() : null;
}
const recency = new Map(rows.map((r) => [r, (yearOf(r) ?? 0) >= RECENT_FROM ? RECENT_WEIGHT : 1]));
{
  const years = new Map<string, number>();
  for (const r of rows) {
    const y = yearOf(r);
    const k = `${r.src ?? 'fox/pro/ai'} ${y === null ? 'undated' : y >= RECENT_FROM ? `${RECENT_FROM}+` : `before ${RECENT_FROM}`}`;
    years.set(k, (years.get(k) ?? 0) + 1);
  }
  console.log('game sides by source and age:', [...years].map(([k, v]) => `${k}: ${v}`).join(', '));
}

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

const LAMBDA = 1000;

/** Weighted pool-adjacent-violators: the closest non-decreasing sequence. */
function isotonic(xs: { s: number; w: number }[]): number[] {
  const blocks: { s: number; w: number; n: number }[] = [];
  for (const x of xs) {
    blocks.push({ ...x, n: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].s > blocks[blocks.length - 1].s) {
      const b = blocks.pop()!;
      const a = blocks[blocks.length - 1];
      a.s = (a.s * a.w + b.s * b.w) / (a.w + b.w);
      a.w += b.w;
      a.n += b.n;
    }
  }
  return blocks.flatMap((b) => new Array(b.n).fill(b.s));
}
/** No spread below this, so a lucky table cell can't make one game look certain. */
const MIN_SPREAD = 0.8;

const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

type Pick = (r: Row) => RidgeInput | undefined;
const movesOf = (x: RidgeInput) => ('all' in x ? x.all.n : x.n);
const usable =
  (phase: Phase | null) =>
  (x: RidgeInput | undefined): x is RidgeInput =>
    !!x && movesOf(x) >= (phase ? MIN_PHASE_MOVES * 2 : MIN_GAME_MOVES);

/** Signatures common enough to be features. */
const SIGS = (() => {
  const count = new Map<string, number>();
  for (const r of rows) for (const id of Object.keys(r.signatures)) count.set(id, (count.get(id) ?? 0) + 1);
  return [...count]
    .filter(([, c]) => c >= rows.length * 0.2)
    .map(([id]) => id)
    .sort();
})();

function fit(train: Row[], pick: Pick, phase: Phase | null): Omit<RidgeModel, 'maeGame'> {
  const shape = { phase, sigs: phase ? [] : SIGS };
  const data = train.map((r) => ({ x: pick(r), y: r.rank, recency: recency.get(r) ?? 1 })).filter((d): d is { x: RidgeInput; y: number; recency: number } => usable(phase)(d.x));
  const X = data.map((d) => ridgeFeatures(shape, d.x));
  const d = X[0].length;
  const mean = new Array(d).fill(0);
  const sd = new Array(d).fill(1);
  for (let j = 0; j < d; j++) {
    mean[j] = X.reduce((a, x) => a + x[j], 0) / X.length;
    sd[j] = Math.sqrt(X.reduce((a, x) => a + (x[j] - mean[j]) ** 2, 0) / X.length) || 1;
  }
  // Ranks are not equally common in the corpus: weight each so every rank counts the
  // same, and longer games (more evidence) up to 80 measured moves.
  const perRank = new Map<number, number>();
  for (const r of data) perRank.set(Math.round(r.y), (perRank.get(Math.round(r.y)) ?? 0) + 1);
  const typical = data.length / perRank.size;
  const w = data.map((r) => Math.min(movesOf(r.x), 80) * Math.min(4, typical / perRank.get(Math.round(r.y))!) * r.recency);
  const p = d + 1;
  const A = Array.from({ length: p }, () => new Array(p).fill(0));
  const b = new Array(p).fill(0);
  X.forEach((x, n) => {
    const z = [1, ...x.map((v, j) => (v - mean[j]) / sd[j])];
    for (let i = 0; i < p; i++) {
      b[i] += w[n] * z[i] * data[n].y;
      for (let j = i; j < p; j++) A[i][j] += w[n] * z[i] * z[j];
    }
  });
  for (let i = 0; i < p; i++) for (let j = 0; j < i; j++) A[i][j] = A[j][i];
  for (let i = 1; i < p; i++) A[i][i] += LAMBDA;
  const beta = solve(A, b);
  const lo = Math.min(...data.map((r) => Math.round(r.y)));
  const top = Math.max(...data.map((r) => Math.round(r.y)));
  const m: Omit<RidgeModel, 'maeGame'> = { ...shape, mean, sd, beta, centre: [], lo, spread: [], top };
  // Where the score sits for each true rank (smoothed over neighbouring ranks and kept
  // non-decreasing: a stronger rank never has a lower typical score), then its spread
  // per rank (pooled with the neighbouring ranks) and game length.
  const pts = data.map((r, n) => ({ y: Math.round(r.y), s: ridgeScore(m as RidgeModel, r.x), b: lengthBucket(movesOf(r.x)), w: w[n] }));
  const ranks = Array.from({ length: top - lo + 1 }, (_, i) => lo + i);
  const raw = ranks.map((rank) => {
    const qs = pts.filter((q) => q.y === rank);
    const wsum = qs.reduce((a, q) => a + q.w, 0);
    return { s: wsum ? qs.reduce((a, q) => a + q.w * q.s, 0) / wsum : NaN, w: wsum };
  });
  const smooth = ranks.map((_, i) => {
    let s = 0,
      ws = 0;
    for (const [j, k] of [
      [i - 1, 0.25],
      [i, 0.5],
      [i + 1, 0.25],
    ] as const)
      if (raw[j] && raw[j].w > 0) {
        s += k * raw[j].w * raw[j].s;
        ws += k * raw[j].w;
      }
    return { s: ws ? s / ws : 0, w: raw[i].w || 1 };
  });
  m.centre = isotonic(smooth).map((x) => round(x, 4));
  for (const rank of ranks) {
    const near = pts.filter((q) => Math.abs(q.y - rank) <= 1);
    const sdOf = (qs: typeof pts) => Math.sqrt(qs.reduce((a, q) => a + (q.s - m.centre[q.y - lo]) ** 2, 0) / Math.max(1, qs.length));
    const all = sdOf(near);
    m.spread.push(
      Array.from({ length: LENGTH_BUCKETS.length + 1 }, (_, bi) => {
        const qs = near.filter((q) => q.b === bi);
        // Few games in a cell: lean on the rank's spread over all lengths.
        const k = qs.length / (qs.length + 30);
        return round(Math.max(MIN_SPREAD, k * sdOf(qs) + (1 - k) * all), 3);
      }),
    );
  }
  return m;
}

function crossValidate(pick: Pick, phase: Phase | null, train: (r: Row) => boolean) {
  const errs: { r: Row; pred: number }[] = [];
  const folds: RidgeModel[] = [];
  for (let fold = 0; fold < 5; fold++) {
    const m: RidgeModel = {
      ...fit(
        rows.filter((r) => foldOf(r) !== fold && train(r)),
        pick,
        phase,
      ),
      maeGame: 0,
    };
    folds.push(m);
    for (const r of rows.filter((r) => foldOf(r) === fold)) {
      const x = pick(r);
      if (usable(phase)(x)) errs.push({ r, pred: predictOne(m, x) });
    }
  }
  const mae = errs.reduce((a, e) => a + Math.abs(e.pred - e.r.rank), 0) / errs.length;
  return { errs, mae, folds };
}

function strip(m: RidgeModel): RidgeModel {
  const r = (v: number) => Number(v.toPrecision(6));
  return { ...m, mean: m.mean.map(r), sd: m.sd.map(r), beta: m.beta.map(r) };
}

const everyone = () => true;
const strong = (r: Row) => r.rank >= TOP_TRAIN_FROM;

function model(pick: Pick, phase: Phase | null, train: (r: Row) => boolean = everyone) {
  const cv = crossValidate(pick, phase, train);
  const m: RidgeModel = { ...fit(rows.filter(train), pick, phase), maeGame: round(cv.mae, 3) };
  return { model: strip(m), ...cv };
}

/**
 * The all-rank model with the strong-player model taking over at the top (as the app
 * combines them), scored on held-out games: one game, and k games of one rank together.
 */
type Gate = (rows: Row[], fold: number) => number | undefined;

function tiered(name: string, pick: Pick, phase: Phase | null, ks: number[], gate?: Gate) {
  const base = model(pick, phase);
  const hasTop = rows.filter((r) => strong(r) && usable(phase)(pick(r))).length >= 300 && rows.some((r) => r.rank > 9);
  const top = hasTop ? model(pick, phase, strong) : null;
  const byRank = new Map<number, Row[]>();
  for (const e of base.errs) byRank.set(e.r.rank, [...(byRank.get(e.r.rank) ?? []), e.r]);
  let seed = 1;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  const mae: Record<string, number> = {};
  const one: { r: Row; pred: number }[] = [];
  const preds: Record<string, { rank: number; pred: number; fold: number }[]> = {};
  for (const k of [1, ...ks]) {
    let err = 0,
      n = 0;
    const kp: { rank: number; pred: number; fold: number }[] = (preds[String(k)] = []);
    for (const [rank, list] of byRank)
      for (let fold = 0; fold < 5; fold++) {
        // Games of one fold, scored by the models that never saw that fold.
        const inFold = list.filter((r) => foldOf(r) === fold);
        if (inFold.length < k) continue;
        const draws = k === 1 ? inFold.map((r) => [r]) : Array.from({ length: 8 }, () => [...inFold].sort(() => rnd() - 0.5).slice(0, k));
        for (const pickRows of draws) {
          const e = combineTiered(
            base.folds[fold],
            top?.folds[fold],
            pickRows.map((r) => pick(r)!),
            gate?.(pickRows, fold),
          );
          if (!e) continue;
          err += Math.abs(e.rank - rank);
          n++;
          kp.push({ rank, pred: e.rank, fold });
          if (k === 1) one.push({ r: pickRows[0], pred: e.rank });
        }
      }
    mae[String(k)] = round(err / n, 3);
  }
  console.log(
    `${name}: mean error ${Object.entries(mae)
      .map(([k, v]) => `${v} (${k} game${k === '1' ? '' : 's'})`)
      .join(', ')}`,
  );
  for (const band of [
    [-17, -9],
    [-8, 0],
    [1, 9],
    [10, 12],
  ]) {
    const e = one.filter((x) => x.r.rank >= band[0] && x.r.rank <= band[1]);
    if (e.length)
      console.log(
        `  ranks ${band[0]}..${band[1]}: ${e.length} sides, mean error ${(e.reduce((a, x) => a + Math.abs(x.pred - x.r.rank), 0) / e.length).toFixed(2)}, bias ${(e.reduce((a, x) => a + x.pred - x.r.rank, 0) / e.length).toFixed(2)}`,
      );
  }
  // The bias correction: for each true rank, where held-out estimates land on average.
  // Scored honestly, with tables built without the fold being scored.
  const debias: Record<string, [number, number][]> = {};
  const fixedMae: Record<string, number> = {};
  for (const [k, list] of Object.entries(preds)) {
    let err = 0;
    const fixed: { rank: number; pred: number }[] = [];
    for (let fold = 0; fold < 5; fold++) {
      const t = debiasFrom(list.filter((p) => p.fold !== fold));
      for (const p of list.filter((p) => p.fold === fold)) {
        const x = debiasRank(t, p.pred);
        err += Math.abs(x - p.rank);
        fixed.push({ rank: p.rank, pred: x });
      }
    }
    fixedMae[k] = round(err / list.length, 3);
    debias[k] = debiasFrom(list);
    if (k === '1')
      for (const band of [
        [-17, -9],
        [-8, 0],
        [1, 9],
        [10, 12],
      ]) {
        const line = (xs: { rank: number; pred: number }[]) => {
          const e = xs.filter((x) => x.rank >= band[0] && x.rank <= band[1]);
          return `mean error ${(e.reduce((a, x) => a + Math.abs(x.pred - x.rank), 0) / e.length).toFixed(2)}, bias ${(e.reduce((a, x) => a + x.pred - x.rank, 0) / e.length).toFixed(2)}`;
        };
        if (list.some((x) => x.rank >= band[0] && x.rank <= band[1])) console.log(`  ranks ${band[0]}..${band[1]}: before ${line(list)}; corrected ${line(fixed)}`);
      }
  }
  console.log(
    `  corrected mean error ${Object.entries(fixedMae)
      .map(([k, v]) => `${v} (${k} game${k === '1' ? '' : 's'})`)
      .join(', ')}`,
  );
  return { base: { ...base.model, maeGame: mae['1'] }, top: top?.model, mae, fixedMae, debias, folds: base.folds, topFolds: top?.folds };
}

/**
 * How far the correction goes (0..1), fading in from 5k to 1k. Measured on the full corpus
 * (2026-10-16, one game, held out): dan games went from 1.17 ranks too low to 0.25 (mean
 * error 2.76 → 2.89), pro-level games from 1.98 too low to 0.66 (2.06 → 1.64), kyu games
 * barely move. The full shift everywhere removed more bias but made kyu games much noisier.
 */
const DEBIAS_STRENGTH = Number(process.env.DEBIAS_STRENGTH ?? 0.75);
/** The correction fades in between these estimates (5k and 1k by default). */
const DEBIAS_FROM = Number(process.env.DEBIAS_FROM ?? -4);
const DEBIAS_FULL = Number(process.env.DEBIAS_FULL ?? 0);

/**
 * [typical estimate, true rank] for every true rank with enough held-out games, the
 * estimates made non-decreasing and ties merged, so the table can be read both ways.
 */
function debiasFrom(list: { rank: number; pred: number }[]): [number, number][] {
  const ranks = [...new Set(list.map((p) => Math.round(p.rank)))].sort((a, b) => a - b);
  const cells = ranks
    .map((r) => {
      const ps = list.filter((p) => Math.round(p.rank) === r);
      return { r, s: ps.reduce((a, p) => a + p.pred, 0) / Math.max(1, ps.length), w: ps.length };
    })
    .filter((c) => c.w >= 20);
  const mono = isotonic(cells.map((c) => ({ s: c.s, w: c.w })));
  const out: [number, number][] = [];
  cells.forEach((c, i) => {
    const p = round(mono[i], 3);
    const last = out[out.length - 1];
    if (last && p <= last[0] + 1e-6) last[1] = (last[1] + c.r) / 2;
    else out.push([p, c.r]);
  });
  // Only part of the way, and only for stronger players: the full shift removes the bias but
  // stretches the scale, which makes single kyu games noisier than the bias it removes.
  const strength = (p: number) => DEBIAS_STRENGTH * Math.min(1, Math.max(0, (p - DEBIAS_FROM) / (DEBIAS_FULL - DEBIAS_FROM)));
  return out.map(([p, r]) => [p, round(p + strength(p) * (r - p), 3)]);
}

/**
 * OGS ranks are not Fox ranks. Map them onto Fox's scale: fit the whole-game model on Fox
 * games alone, find the Fox rank whose typical score matches each OGS rank's typical
 * score (comparing typical scores, not predicted ranks, cancels the model's pull toward
 * the middle), and fit a straight line through those points. OGS games then train with
 * their mapped rank. Without enough OGS games of enough ranks they are left out.
 */
let ogsMap: { a: number; b: number; ranks: number } | null = null;
{
  const ogs = rows.filter((r) => r.src === 'ogs');
  if (ogs.length) {
    const fox = rows.filter((r) => r.src !== 'ogs' && r.rank <= 9);
    const m = fit(fox, (r) => r, null) as RidgeModel;
    const foxRankAt = (s: number) => {
      const c = m.centre;
      if (s <= c[0]) return m.lo;
      for (let i = 1; i < c.length; i++) if (s <= c[i]) return m.lo + i - 1 + (c[i] > c[i - 1] ? (s - c[i - 1]) / (c[i] - c[i - 1]) : 0);
      return m.lo + c.length - 1;
    };
    const pts: { q: number; r: number; n: number }[] = [];
    for (const q of [...new Set(ogs.map((r) => r.rank))].sort((a, b) => a - b)) {
      const list = ogs.filter((r) => r.rank === q && usable(null)(r));
      if (list.length < 30) continue;
      const s = list.reduce((a, r) => a + ridgeScore(m, r), 0) / list.length;
      const r = foxRankAt(s);
      // Points at the very ends of Fox's range are clipped, so they say little about the slope.
      if (r > m.lo && r < m.lo + m.centre.length - 1) pts.push({ q, r, n: list.length });
    }
    const slope = (ps: typeof pts) => {
      const W = ps.reduce((a, p) => a + p.n, 0);
      const mq = ps.reduce((a, p) => a + p.n * p.q, 0) / W;
      const mr = ps.reduce((a, p) => a + p.n * p.r, 0) / W;
      return { mq, mr, b: ps.reduce((a, p) => a + p.n * (p.q - mq) * (p.r - mr), 0) / ps.reduce((a, p) => a + p.n * (p.q - mq) ** 2, 0) };
    };
    // A map that runs backwards or nearly flat means the labels are not usable.
    if (pts.length >= 4 && slope(pts).b > 0.3) {
      const { mq, mr, b } = slope(pts);
      ogsMap = { a: round(mr - b * mq, 3), b: round(b, 3), ranks: pts.length };
      console.log(`OGS → Fox: fox = ${ogsMap.a} + ${ogsMap.b} × ogs (from ${pts.length} ranks):`, pts.map((p) => `${p.q}→${p.r.toFixed(1)}`).join(' '));
    }
    const map = ogsMap;
    if (map) for (const r of ogs) r.rank = Math.round(Math.max(MIN_RANK, Math.min(9, map.a + map.b * r.rank)));
    else {
      let k = 0;
      for (const r of rows) if (r.src !== 'ogs') rows[k++] = r;
      rows.length = k;
    }
    if (!map) console.log(`OGS: ${ogs.length} game sides left out (too few ranks with 30+ sides to map onto Fox's scale)`);
  }
}

const all = tiered('whole game', (r) => r, null, [3, 5, 10]);
const maeByGames = all.fixedMae;
const debias: NonNullable<LevelCalibration['debias']> = { all: all.debias };
const phases: LevelCalibration['phases'] = {};
const topPhases: NonNullable<LevelCalibration['top']>['phases'] = {};
for (const p of PHASES) {
  if (rows.filter((r) => usable(p)(r.phases[p])).length < 60) {
    console.log(`${p}: too few game sides, no model`);
    continue;
  }
  // A phase is judged strong when the whole game is (as the app does).
  const m = tiered(
    p,
    (r) => r.phases[p],
    p,
    [],
    (rs, fold) => combineTiered(all.folds[fold], all.topFolds?.[fold], rs)?.rank,
  );
  phases[p] = { ...m.base, maeGame: m.fixedMae['1'] };
  debias[p] = m.debias;
  if (m.top) topPhases[p] = m.top;
}

// Typical numbers and decision error rates per rank.
const buckets: RankBucket[] = [];
for (const rank of [...new Set(rows.map((r) => r.rank))].sort((a, b) => a - b)) {
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

const cal: LevelCalibration = {
  version: 2,
  modelId: 'g170e-b10c128',
  source:
    'Fox Go dataset (github.com/featurecat/go-dataset, GPL-3.0): even and no-komi games, ranks from BR/WR' +
    (ogsMap ? `; OGS games from 2022 on (za3k.com/ogs, public domain), ranks mapped onto Fox's as ${ogsMap.a} + ${ogsMap.b} × OGS rank` : '') +
    `; professional and AI games (github.com/yenw/computer-go-dataset, katagoarchive.org, homepages.cwi.nl/~aeb) for 10d (pro), 11d (top pro) and 12d (AI); games from ${RECENT_FROM} on weigh ${RECENT_WEIGHT}x`,
  samples: rows.length,
  games: new Set(rows.map((r) => r.file)).size,
  features: FEATURE_KEYS,
  all: { ...all.base, maeGame: all.fixedMae['1'] },
  phases,
  top: all.top ? { all: all.top, phases: topPhases } : undefined,
  buckets,
  maeByGames,
  debias,
  createdAt: new Date().toISOString(),
};
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(cal));
console.log(`wrote ${OUT} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
for (const b of buckets) console.log(b.rank, b.games, b.features.top1, b.features.loss, b.features.blunders);
