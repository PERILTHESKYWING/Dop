/**
 * Single-thread speed of the DopNet runtime (tools/student/dopnet.c) in Node.
 *
 *   npx tsx scripts/student/bench-runtime.ts [net.dopnet] [--wasm public/student/dopnet.wasm] [--seconds 2]
 *
 * Positions: "games" made from the fixture boards (tests/fixtures/student/random.json):
 * each board's stones are played one at a time (black and white alternating, captures
 * taken, liberties and the last three moves marked), so successive positions differ the
 * way successive positions of a real game do. Modes:
 *   full trunk / always-exit, stem from scratch  (the stem cache off)
 *   full trunk / always-exit, incremental stem   (the stem cache on, positions in game order)
 *   stem only, from scratch / incremental
 */
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DopnetRuntime } from '../../src/lib/student/runtime';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(name);
  if (i < 0) return dflt;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const wasmPath = opt('--wasm', path.join(root, 'public/student/dopnet.wasm'));
const seconds = Number(opt('--seconds', '2'));
const fixturePath = opt('--fixtures', path.join(root, 'tests/fixtures/student/random.json'));
const netPath = args[0] ?? path.join(root, 'tests/fixtures/student/random.dopnet');

const S = 19;
const N = S * S;

/** Board bytes (README contract) for stones (0/1/2 per point) and the last moves, most recent first. */
function encode(stones: Uint8Array, recent: number[]): Uint8Array {
  const out = new Uint8Array(N);
  const seen = new Int32Array(N).fill(-1);
  const libMark = new Int32Array(N).fill(-1);
  let id = 0;
  for (let i = 0; i < N; i++) {
    if (!stones[i] || seen[i] >= 0) continue;
    const members = flood(stones, i, seen, id);
    let libs = 0;
    for (const p of members)
      for (const q of around(p))
        if (!stones[q] && libMark[q] !== id) {
          libMark[q] = id;
          libs++;
        }
    const cls = libs >= 4 ? 0 : libs;
    for (const p of members) out[p] = stones[p] | (cls << 2);
    id++;
  }
  recent.slice(0, 3).forEach((p, k) => {
    if (stones[p]) out[p] |= (k + 1) << 5;
  });
  return out;
}

function around(p: number): number[] {
  const x = p % S;
  const r: number[] = [];
  if (x > 0) r.push(p - 1);
  if (x < S - 1) r.push(p + 1);
  if (p >= S) r.push(p - S);
  if (p < N - S) r.push(p + S);
  return r;
}

function flood(stones: Uint8Array, start: number, seen: Int32Array, id: number): number[] {
  const c = stones[start];
  const members: number[] = [];
  const stack = [start];
  seen[start] = id;
  while (stack.length) {
    const p = stack.pop()!;
    members.push(p);
    for (const q of around(p))
      if (stones[q] === c && seen[q] !== id) {
        seen[q] = id;
        stack.push(q);
      }
  }
  return members;
}

function hasLiberty(stones: Uint8Array, chain: number[]): boolean {
  return chain.some((p) => around(p).some((q) => !stones[q]));
}

interface Pos {
  board: Uint8Array;
  toPlay: 1 | 2;
  komi: number;
}

/** One game per fixture board: its stones played one at a time, colours alternating. */
function games(boards: number[][]): Pos[] {
  const out: Pos[] = [];
  for (const b of boards) {
    const black = b.map((v, p) => ((v & 3) === 1 ? p : -1)).filter((p) => p >= 0);
    const white = b.map((v, p) => ((v & 3) === 2 ? p : -1)).filter((p) => p >= 0);
    const order: [number, 1 | 2][] = [];
    for (let i = 0; i < Math.max(black.length, white.length); i++) {
      if (i < black.length) order.push([black[i], 1]);
      if (i < white.length) order.push([white[i], 2]);
    }
    const stones = new Uint8Array(N);
    const recent: number[] = [];
    for (let k = 0; k < order.length; k++) {
      const [p, c] = order[k];
      if (stones[p]) continue;
      stones[p] = c;
      for (const q of around(p)) {
        if (stones[q] !== 3 - c) continue;
        const chain = flood(stones, q, new Int32Array(N).fill(-1), 0);
        if (!hasLiberty(stones, chain)) for (const r of chain) stones[r] = 0;
      }
      recent.unshift(p);
      const next = k + 1 < order.length ? order[k + 1][1] : ((3 - c) as 1 | 2);
      out.push({ board: encode(stones, recent), toPlay: next, komi: 7.5 });
    }
  }
  return out;
}

function diffPoints(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < N; i++) n += a[i] !== b[i] ? 1 : 0;
  return n;
}

async function main() {
  const wasm = readFileSync(wasmPath);
  const net = readFileSync(netPath);
  const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8')) as { positions: { board: number[] }[] };
  const chain = games(fixtures.positions.map((p) => p.board));
  let changed = 0;
  for (let i = 1; i < chain.length; i++) changed += diffPoints(chain[i].board, chain[i - 1].board);

  const probe = await DopnetRuntime.create(wasm, net);
  const h = probe.header;
  const cpus = os.cpus();
  console.log(`net ${path.basename(netPath)}: C=${h.C} N=${h.N} E=${h.E} G=[${h.G}] policyC=${h.policyC}`);
  console.log(`runtime ${path.relative(root, wasmPath) || wasmPath} (${wasm.length} bytes), Node ${process.version}`);
  console.log(`cpu ${cpus[0]?.model ?? '?'} x${cpus.length} (load average ${os.loadavg().map((v) => v.toFixed(1)).join(' ')})`);
  console.log(`positions: ${chain.length} in ${fixtures.positions.length} games, ${(changed / (chain.length - 1)).toFixed(1)} changed points per move on average`);
  console.log('');

  type Mode = { name: string; incremental: boolean; run: (rt: DopnetRuntime, p: Pos) => void };
  const modes: Mode[] = [
    { name: 'full trunk, stem from scratch', incremental: false, run: (rt, p) => rt.evaluate(p.board, p.toPlay, p.komi, { allowExit: false }) },
    { name: 'full trunk, incremental stem', incremental: true, run: (rt, p) => rt.evaluate(p.board, p.toPlay, p.komi, { allowExit: false }) },
    { name: 'always-exit, stem from scratch', incremental: false, run: (rt, p) => rt.evaluate(p.board, p.toPlay, p.komi, { exitThreshold: 1 }) },
    { name: 'always-exit, incremental stem', incremental: true, run: (rt, p) => rt.evaluate(p.board, p.toPlay, p.komi, { exitThreshold: 1 }) },
    { name: 'stem only, from scratch', incremental: false, run: (rt, p) => rt.stemOnly(p.board, p.toPlay) },
    { name: 'stem only, incremental', incremental: true, run: (rt, p) => rt.stemOnly(p.board, p.toPlay) },
  ];
  for (const m of modes) {
    const rt = await DopnetRuntime.create(wasm, net);
    rt.setIncremental(m.incremental);
    for (let i = 0; i < Math.min(50, chain.length); i++) m.run(rt, chain[i]); // warm up
    const before = rt.stats();
    let n = 0;
    const t0 = performance.now();
    let t = t0;
    while (t - t0 < seconds * 1000) {
      for (let k = 0; k < 16; k++) m.run(rt, chain[n++ % chain.length]);
      t = performance.now();
    }
    const per = (t - t0) / n;
    const st = rt.stats();
    const inc = st.incremental - before.incremental;
    const full = st.full - before.full;
    console.log(
      `${m.name.padEnd(32)} ${(1000 / per).toFixed(0).padStart(7)} evals/s  ${(per * 1000).toFixed(0).padStart(6)} us/eval` +
        `   stems: ${inc} incremental, ${full} from scratch`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
