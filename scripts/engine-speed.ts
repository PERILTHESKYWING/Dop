/**
 * Speed and agreement of a build of the browser engine (kataeval.wasm) in Node, on the
 * CPU: milliseconds per network evaluation one at a time and in batches of 8, and, with
 * --compare, how far its answers are from another build's on the same positions (the
 * policy's top move, the largest policy difference, the win rate difference).
 *
 *   npx tsx scripts/engine-speed.ts [--engine out/kataeval.js] [--compare public/engine/kataeval.js] [--positions 60]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_JS, loadNodeEngine } from './nodeEngine';
import type { Color, Loc } from '../src/lib/go/types';
import type { EngineBackend } from '../src/lib/engine/types';
import type { RawNetOutput } from '../src/lib/engine/parse';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const args = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const MODEL = arg('model', path.join(root, 'public', 'models', 'g170e-b10c128-s1141046784-d204142634.bin.gz'))!;

interface Pos {
  moves: { color: Color; loc: Loc }[];
  toPlay: Color;
  komi: number;
}

function positions(n: number): Pos[] {
  const bench = JSON.parse(readFileSync(path.join(root, 'public', 'engine', 'bench-positions.json'), 'utf8'));
  const out: Pos[] = [];
  // Every bench game cut at several points.
  for (let cut = 1; out.length < n && cut <= 8; cut++) {
    for (const p of bench.positions as { moves: [Color, Loc][]; komi: number }[]) {
      const k = Math.floor((p.moves.length * cut) / 8);
      out.push({ moves: p.moves.slice(0, k).map(([color, loc]) => ({ color, loc })), toPlay: (k % 2 === 0 ? 1 : 2) as Color, komi: p.komi });
      if (out.length >= n) break;
    }
  }
  return out;
}

const softmax = (x: Float32Array, n: number) => {
  let m = -Infinity;
  for (let i = 0; i < n; i++) m = Math.max(m, x[i]);
  const e = new Float64Array(n);
  let s = 0;
  for (let i = 0; i < n; i++) s += e[i] = Math.exp(x[i] - m);
  for (let i = 0; i < n; i++) e[i] /= s;
  return e;
};

async function run(eng: EngineBackend, batchEng: EngineBackend, ps: Pos[]) {
  const req = (p: Pos) => ({ size: 19, komi: p.komi, moves: p.moves, toPlay: p.toPlay });
  for (const p of ps.slice(0, 3)) await eng.evalRaw!(req(p), false); // warm up
  let t = performance.now();
  const outs: RawNetOutput[] = [];
  for (const p of ps) outs.push(await eng.evalRaw!(req(p), false));
  const one = (performance.now() - t) / ps.length;
  await batchEng.evalSeqBatchRaw!(ps.slice(0, 8).map(req));
  t = performance.now();
  for (let i = 0; i < ps.length; i += 8) await batchEng.evalSeqBatchRaw!(ps.slice(i, i + 8).map(req));
  const eight = (performance.now() - t) / ps.length;
  return { one, eight, outs };
}

const ps = positions(Number(arg('positions', '60')));
const engineJs = path.resolve(arg('engine', ENGINE_JS)!);
const load = (js: string, batch: number) => loadNodeEngine(MODEL, 'b10', 19, batch, undefined, js);
const a = await run(await load(engineJs, 1), await load(engineJs, 8), ps);
console.log(`${engineJs}\n  one at a time: ${a.one.toFixed(1)} ms per evaluation; batches of 8: ${a.eight.toFixed(1)} ms per evaluation`);
const other = arg('compare') && path.resolve(arg('compare')!);
if (other) {
  const b = await run(await load(other, 1), await load(other, 8), ps);
  console.log(`${other}\n  one at a time: ${b.one.toFixed(1)} ms per evaluation; batches of 8: ${b.eight.toFixed(1)} ms per evaluation`);
  let same = 0;
  let maxP = 0;
  let sumP = 0;
  let maxW = 0;
  let sumW = 0;
  for (let i = 0; i < ps.length; i++) {
    const pa = softmax(a.outs[i].policyLogits, 362);
    const pb = softmax(b.outs[i].policyLogits, 362);
    let ia = 0;
    let ib = 0;
    let d = 0;
    for (let j = 0; j < 362; j++) {
      if (pa[j] > pa[ia]) ia = j;
      if (pb[j] > pb[ib]) ib = j;
      d = Math.max(d, Math.abs(pa[j] - pb[j]));
    }
    if (ia === ib) same++;
    maxP = Math.max(maxP, d);
    sumP += d;
    const wa = softmax(a.outs[i].value, 3)[0];
    const wb = softmax(b.outs[i].value, 3)[0];
    maxW = Math.max(maxW, Math.abs(wa - wb));
    sumW += Math.abs(wa - wb);
  }
  const n = ps.length;
  console.log(`agreement on ${n} positions: same top move ${same}/${n}; policy difference mean ${(sumP / n).toFixed(5)}, max ${maxP.toFixed(5)}; win rate difference mean ${(sumW / n).toFixed(5)}, max ${maxW.toFixed(5)}`);
  console.log(`speed: ${(b.one / a.one).toFixed(2)}x one at a time, ${(b.eight / a.eight).toFixed(2)}x in batches (above 1 = the first build is faster)`);
}
