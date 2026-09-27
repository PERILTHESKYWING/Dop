/**
 * Fit the move-difficulty model (src/lib/coach/difficulty.ts) on the corpus written by
 * scripts/move-corpus.ts, report held-out accuracy, and write public/coach/difficulty.json.
 *
 *   npx tsx scripts/move-fit.ts moves/*.jsonl
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { choiceProbs, choiceTable, PRO_RANK, type DifficultyModel } from '../src/lib/coach/difficulty';
import { CHOICE_COUNT } from '../src/lib/coach/choices';
import { hashString } from '../src/lib/util/hash';

const here = path.dirname(fileURLToPath(import.meta.url));

interface Row {
  file: string;
  rank: number;
  played: number;
  feats: number[][];
  bestIdx: number;
}

const rows: Row[] = [];
for (const f of process.argv.slice(2)) {
  for (const l of readFileSync(f, 'utf8').split('\n')) {
    if (!l) continue;
    const j = JSON.parse(l);
    if (j.skipped || !j.c) continue;
    // The network's most natural moves; a move played outside them counts as "something else".
    const c = (j.c as [number, number, number, number][]).slice(0, CHOICE_COUNT).map(([, prior, loss, winLoss]) => ({ prior, loss, winLoss }));
    const bestLoss = Math.min(...c.map((x) => x.loss));
    rows.push({ file: j.file, rank: Math.min(j.rank, PRO_RANK), played: Math.min(j.played, c.length), feats: choiceTable(c), bestIdx: c.findIndex((x) => x.loss === bestLoss) });
  }
}
console.log(`${rows.length} positions`);
const K = 4;

/** Maximum-likelihood coefficients by Newton's method (with a little ridge). */
function fit(rs: Row[], start = [1, 0.3, 1, 0]): number[] {
  let w = [...start];
  for (let it = 0; it < 40; it++) {
    const g = new Array(K).fill(0);
    const H = Array.from({ length: K }, () => new Array(K).fill(0));
    for (const r of rs) {
      const p = choiceProbs(w, r.feats);
      const mean = new Array(K).fill(0);
      for (let i = 0; i < p.length; i++) for (let k = 0; k < K; k++) mean[k] += p[i] * r.feats[i][k];
      for (let k = 0; k < K; k++) g[k] += r.feats[r.played][k] - mean[k];
      for (let i = 0; i < p.length; i++)
        for (let a = 0; a < K; a++) for (let b = 0; b < K; b++) H[a][b] += p[i] * (r.feats[i][a] - mean[a]) * (r.feats[i][b] - mean[b]);
    }
    for (let k = 0; k < K; k++) {
      g[k] -= 0.01 * (w[k] - start[k]);
      H[k][k] += 0.01;
    }
    const step = solve(H, g);
    // Newton with backtracking, so a poor start cannot throw the fit off.
    const before = logLik(rs, w, start);
    let t = 1;
    let next = w.map((x, k) => x + step[k]);
    while (t > 1e-4 && !(logLik(rs, next, start) >= before)) {
      t /= 2;
      next = w.map((x, k) => x + t * step[k]);
    }
    w = next;
    if (Math.max(...step.map((x) => Math.abs(x * t))) < 1e-6) break;
  }
  return w;
}

function logLik(rs: Row[], w: number[], start: number[]) {
  let ll = 0;
  for (const r of rs) ll += Math.log(Math.max(choiceProbs(w, r.feats)[r.played], 1e-300));
  return ll - 0.005 * w.reduce((a, x, k) => a + (x - start[k]) ** 2, 0);
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

const AMATEUR = Array.from({ length: 27 }, (_, i) => i - 17);
const WINDOW = 1.5;
const MIN_ROWS = Number(process.env.MIN_ROWS ?? 60);
function windowRows(rs: Row[], rank: number) {
  return rank >= PRO_RANK ? rs.filter((r) => r.rank >= PRO_RANK) : rs.filter((r) => r.rank < PRO_RANK && Math.abs(r.rank - rank) <= WINDOW);
}

/** Per-rank fits, then each coefficient smoothed as a quadratic in rank (amateurs); pros kept as fitted. */
function fitAll(rs: Row[]): { ranks: number[]; coef: number[][] } {
  const pts = AMATEUR.map((rank) => ({ rank, n: windowRows(rs, rank).length })).filter((p) => p.n >= MIN_ROWS);
  const raw = pts.map((p) => fit(windowRows(rs, p.rank)));
  const coef = AMATEUR.map((rank) =>
    Array.from({ length: K }, (_, k) => {
      // weighted least squares on 1, r, r^2
      const X = pts.map((p) => [1, p.rank, p.rank * p.rank]);
      const y = raw.map((w) => w[k]);
      const A = [0, 1, 2].map((a) => [0, 1, 2].map((b) => X.reduce((s, x, i) => s + pts[i].n * x[a] * x[b], 0)));
      const bb = [0, 1, 2].map((a) => X.reduce((s, x, i) => s + pts[i].n * x[a] * y[i], 0));
      const beta = solve(A, bb);
      const r = Math.min(Math.max(rank, pts[0].rank), pts[pts.length - 1].rank);
      return beta[0] + beta[1] * r + beta[2] * r * r;
    }),
  );
  const pro = windowRows(rs, PRO_RANK);
  const ranks = [...AMATEUR];
  if (pro.length >= MIN_ROWS) {
    ranks.push(PRO_RANK);
    coef.push(fit(pro));
  }
  return { ranks, coef };
}

function coefFor(m: { ranks: number[]; coef: number[][] }, rank: number) {
  const i = m.ranks.indexOf(Math.round(Math.min(rank, PRO_RANK)));
  return m.coef[i >= 0 ? i : m.ranks.length - 1];
}

// Held-out check: 5 folds by game.
const fold = (r: Row) => parseInt(hashString(r.file).slice(0, 6), 16) % 5;
const bands: [string, (r: number) => boolean][] = [
  ['18k-10k', (r) => r <= -9],
  ['9k-1k', (r) => r > -9 && r <= 0],
  ['1d-9d', (r) => r > 0 && r < PRO_RANK],
  ['pro', (r) => r >= PRO_RANK],
];
const stat = bands.map(() => ({ n: 0, ll: 0, llPolicy: 0, bestObs: 0, bestPred: 0, hidN: 0, hidObs: 0, hidPred: 0 }));
const cal = Array.from({ length: 10 }, () => ({ n: 0, pred: 0, obs: 0 }));
for (let f = 0; f < 5; f++) {
  const m = fitAll(rows.filter((r) => fold(r) !== f));
  for (const r of rows.filter((x) => fold(x) === f)) {
    const b = bands.findIndex(([, t]) => t(r.rank));
    const s = stat[b];
    const p = choiceProbs(coefFor(m, r.rank), r.feats);
    const pp = choiceProbs([1, 0, 0, 0], r.feats);
    s.n++;
    s.ll += Math.log(p[r.played]);
    s.llPolicy += Math.log(pp[r.played]);
    if (r.bestIdx >= 0) {
      s.bestObs += +(r.played === r.bestIdx);
      s.bestPred += p[r.bestIdx];
      // "Hidden" best moves: the network's first look gives them under 10%.
      if (Math.exp(r.feats[r.bestIdx][0]) < 0.1) {
        s.hidN++;
        s.hidObs += +(r.played === r.bestIdx);
        s.hidPred += p[r.bestIdx];
      }
    }
    for (let i = 0; i < p.length; i++) {
      const c = cal[Math.min(9, Math.floor(p[i] * 10))];
      c.n++;
      c.pred += p[i];
      c.obs += +(r.played === i);
    }
  }
}
console.log('held out (per position): log-lik vs policy-only, best-move found observed/predicted, hidden best observed/predicted');
bands.forEach(([name], i) => {
  const s = stat[i];
  if (!s.n) return;
  console.log(
    `  ${name.padEnd(8)} n=${s.n}  ll ${(s.ll / s.n).toFixed(3)} vs ${(s.llPolicy / s.n).toFixed(3)}  best ${((100 * s.bestObs) / s.n).toFixed(1)}%/${((100 * s.bestPred) / s.n).toFixed(1)}%  hidden(n=${s.hidN}) ${((100 * s.hidObs) / Math.max(1, s.hidN)).toFixed(1)}%/${((100 * s.hidPred) / Math.max(1, s.hidN)).toFixed(1)}%`,
  );
});
console.log('calibration (predicted -> observed):');
for (const c of cal) if (c.n) console.log(`  ${((100 * c.pred) / c.n).toFixed(1)}% -> ${((100 * c.obs) / c.n).toFixed(1)}%  (n=${c.n})`);

const final = fitAll(rows);
for (let i = 0; i < final.ranks.length; i += final.ranks[i] >= PRO_RANK ? 1 : 3) console.log(`  rank ${final.ranks[i]}: ${final.coef[i].map((x) => x.toFixed(3)).join(' ')}`);
const out: DifficultyModel = {
  version: 2,
  modelId: 'g170e-b10c128',
  source: 'Fox 19x19 even games (github.com/featurecat/go-dataset) and professional games (github.com/yenw/computer-go-dataset); only fitted coefficients are shipped',
  ranks: final.ranks,
  coef: final.coef.map((w) => w.map((x) => +x.toFixed(4))),
  positions: rows.length,
  createdAt: new Date().toISOString(),
};
const dest = path.join(here, '..', 'public', 'coach', 'difficulty.json');
mkdirSync(path.dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(out, null, 1));
console.log('wrote', dest);
