import { replay } from '../go/board';
import type { Color, Loc, Move } from '../go/types';
import { BrowserEngine } from './browserEngine';
import { engineEvaluator, Search, type SearchSnapshot } from './mcts';
import { bundledModel } from './models';
import { NNCache } from './nncache';

/**
 * Device benchmark: the engine as it ships now ("tuned") against the plain setup it
 * replaced ("baseline": the build without SIMD, one worker, one network call per
 * position, no evaluation cache), both scored against unmodified native KataGo.
 *
 * Reference answers (public/engine/bench-positions.json, scripts/engine-reference.ts)
 * come from the official KataGo binary with the same built-in network: a deep search
 * (what the right answer is) and a small one (what KataGo's own search finds with a
 * budget the browser can afford).
 *
 * Measured per setup:
 *  - strength at equal visits: how often the best move matches the deep reference, next
 *    to how often KataGo's own search does at the same visits;
 *  - strength at equal time: visits reached and agreement in a fixed time per position;
 *  - latency: wall time to analyse a position at a fixed number of visits;
 *  - memory: WebAssembly memory of all engine workers;
 *  - energy: network compute time per position (summed over workers); the browser cannot
 *    read power draw, so this is the stand-in, plus the battery level change where the
 *    browser reports it;
 *  - sustained speed: positions per second at the start and the end of a long run.
 */

interface RefMove {
  loc: Loc;
  visits: number;
  winrate: number;
  scoreLead: number;
}

interface RefSearch {
  visits: number;
  /** Black's winrate and score lead. */
  winrate: number;
  scoreLead: number;
  top: RefMove[];
}

export interface BenchPosition {
  moves: [Color, Loc][];
  toPlay: Color;
  komi: number;
  ref: RefSearch;
  katago: RefSearch;
}

export interface BenchFile {
  engine: string;
  network: string;
  deepVisits: number;
  lightVisits: number;
  positions: BenchPosition[];
}

export interface BenchOptions {
  /** Positions for the equal-visits test (each costs `visits` evaluations per setup). */
  visitPositions: number;
  /** Positions for the equal-time test. */
  timePositions: number;
  /** Milliseconds per position in the equal-time test. */
  msPerPosition: number;
  /** Seconds of continuous searching for the sustained test (tuned setup only). */
  sustainedSeconds: number;
  forceCpu: boolean;
  shouldStop?: () => boolean;
  onProgress?: (text: string, done: number, total: number) => void;
}

export const QUICK_BENCH: Omit<BenchOptions, 'forceCpu'> = { visitPositions: 4, timePositions: 16, msPerPosition: 1000, sustainedSeconds: 30 };

export interface SetupResult {
  label: 'baseline' | 'tuned';
  build: string;
  backend: string;
  lanes: number;
  laneBatch: number;
  fp16: boolean;
  loadMs: number;
  heapMB: number;
  /** Equal visits (the reference file's light budget). */
  visits: number;
  agreeAtVisits: number;
  /** KataGo's own search at the same visits, on the same positions. */
  katagoAgreeAtVisits: number;
  msPerPositionAtVisits: number;
  scoreErrAtVisits: number;
  winrateErrAtVisits: number;
  /** Equal time. */
  avgVisitsInTime: number;
  agreeInTime: number;
  top3InTime: number;
  scoreErrInTime: number;
  winrateErrInTime: number;
  evalsPerSec: number;
  /** Network compute milliseconds (all workers) per evaluated position. */
  computeMsPerEval: number;
  cacheHitRate: number;
  sustained?: { firstEvalsPerSec: number; lastEvalsPerSec: number; seconds: number };
}

export interface BenchReport {
  device: { cores: number; memoryGB?: number; userAgent: string; webgpu: boolean };
  reference: { engine: string; network: string; deepVisits: number; lightVisits: number };
  baseline: SetupResult;
  tuned: SetupResult;
  battery?: { start: number; end: number; charging: boolean };
  at: number;
}

export async function loadBenchFile(): Promise<BenchFile> {
  const res = await fetch(new URL('/engine/bench-positions.json', location.href));
  if (!res.ok) throw new Error(`benchmark positions: HTTP ${res.status}`);
  return res.json();
}

function rootOf(p: BenchPosition) {
  const moves: Move[] = p.moves.map(([color, loc]) => ({ color, loc }));
  return { size: 19, komi: p.komi, moves, toPlay: p.toPlay, board: replay(19, [], moves) };
}

const best = (s: SearchSnapshot) => s.candidates[0]?.loc;

async function battery(): Promise<{ level: number; charging: boolean } | null> {
  try {
    const get = (navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> }).getBattery;
    if (!get) return null;
    const b = await get.call(navigator);
    return { level: b.level, charging: b.charging };
  } catch {
    return null;
  }
}

async function runSetup(label: SetupResult['label'], file: BenchFile, o: BenchOptions, step: (t: string) => void): Promise<SetupResult> {
  const baseline = label === 'baseline';
  step(`${label}: starting KataGo`);
  const t0 = performance.now();
  const eng = await BrowserEngine.load({ spec: bundledModel(), forceCpu: o.forceCpu }, undefined, baseline ? { baseline: true } : { tune: true });
  const loadMs = performance.now() - t0;
  let computeMs = 0;
  let computed = 0;
  eng.onCompute = (n, ms) => {
    computeMs += ms;
    computed += n;
  };
  const evaluator = () => engineEvaluator(eng, baseline ? { cache: null, batched: false } : { cache: new NNCache() });
  const stop = () => !!o.shouldStop?.();
  try {
    // Equal visits.
    const V = file.lightVisits;
    const vp = file.positions.slice(0, o.visitPositions);
    let agree = 0;
    let kgAgree = 0;
    let msAtVisits = 0;
    let scoreErrV = 0;
    let winErrV = 0;
    for (const [i, p] of vp.entries()) {
      if (stop()) throw new Error('stopped');
      step(`${label}: ${V} visits, position ${i + 1} of ${vp.length}`);
      const s = new Search(evaluator(), rootOf(p));
      const t = performance.now();
      const snap = await s.run({ visits: V });
      msAtVisits += performance.now() - t;
      if (best(snap) === p.ref.top[0]?.loc) agree++;
      if (p.katago.top[0]?.loc === p.ref.top[0]?.loc) kgAgree++;
      scoreErrV += Math.abs(snap.bLead - p.ref.scoreLead);
      winErrV += Math.abs(snap.bWin - p.ref.winrate);
    }
    // Equal time (a fresh cache: nothing carried over from the test above).
    const tp = file.positions.slice(0, o.timePositions);
    const timeCache = baseline ? null : new NNCache();
    const ev = engineEvaluator(eng, baseline ? { cache: null, batched: false } : { cache: timeCache });
    let visits = 0;
    let agreeT = 0;
    let top3 = 0;
    let scoreErr = 0;
    let winErr = 0;
    const evalsBefore = computed;
    const tTime = performance.now();
    for (const [i, p] of tp.entries()) {
      if (stop()) throw new Error('stopped');
      step(`${label}: ${o.msPerPosition / 1000} s per position, position ${i + 1} of ${tp.length}`);
      const s = new Search(ev, rootOf(p));
      const snap = await s.run({ visits: 1e9, maxMs: o.msPerPosition });
      visits += snap.visits;
      const b = best(snap);
      if (b === p.ref.top[0]?.loc) agreeT++;
      if (p.ref.top.slice(0, 3).some((m) => m.loc === b)) top3++;
      scoreErr += Math.abs(snap.bLead - p.ref.scoreLead);
      winErr += Math.abs(snap.bWin - p.ref.winrate);
    }
    const timeSpent = (performance.now() - tTime) / 1000;
    const evalsInTime = computed - evalsBefore;
    let sustained: SetupResult['sustained'];
    if (!baseline && o.sustainedSeconds > 0) {
      const ev2 = engineEvaluator(eng, { cache: null });
      const windows: number[] = [];
      const end = performance.now() + o.sustainedSeconds * 1000;
      let k = 0;
      while (performance.now() < end && !stop()) {
        const p = file.positions[k++ % file.positions.length];
        const c0 = computed;
        const w0 = performance.now();
        step(`tuned: sustained load, ${Math.max(0, Math.round((end - performance.now()) / 1000))} s left`);
        await new Search(ev2, rootOf(p)).run({ visits: 1e9, maxMs: 2000 });
        windows.push(((computed - c0) * 1000) / (performance.now() - w0));
      }
      const q = Math.max(1, Math.floor(windows.length / 4));
      const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
      sustained = { firstEvalsPerSec: avg(windows.slice(0, q)), lastEvalsPerSec: avg(windows.slice(-q)), seconds: o.sustainedSeconds };
    }
    const n = Math.max(1, tp.length);
    const cs = timeCache?.stats();
    return {
      label,
      build: eng.build,
      backend: eng.info.backend,
      lanes: eng.laneCount,
      laneBatch: eng.laneBatch,
      fp16: !!eng.tuning?.fp16,
      loadMs: Math.round(loadMs),
      heapMB: Math.round(eng.heapBytes / 1e6),
      visits: V,
      agreeAtVisits: agree / Math.max(1, vp.length),
      katagoAgreeAtVisits: kgAgree / Math.max(1, vp.length),
      msPerPositionAtVisits: msAtVisits / Math.max(1, vp.length),
      scoreErrAtVisits: scoreErrV / Math.max(1, vp.length),
      winrateErrAtVisits: winErrV / Math.max(1, vp.length),
      avgVisitsInTime: visits / n,
      agreeInTime: agreeT / n,
      top3InTime: top3 / n,
      scoreErrInTime: scoreErr / n,
      winrateErrInTime: winErr / n,
      evalsPerSec: evalsInTime / Math.max(0.001, timeSpent),
      computeMsPerEval: computeMs / Math.max(1, computed),
      cacheHitRate: cs ? cs.hits / Math.max(1, cs.hits + cs.misses) : 0,
      sustained,
    };
  } finally {
    eng.terminate();
  }
}

/** Run the whole benchmark: baseline first, then the tuned engine. */
export async function runBenchmark(o: BenchOptions): Promise<BenchReport> {
  const file = await loadBenchFile();
  const total = 2 * (Math.min(o.visitPositions, file.positions.length) + Math.min(o.timePositions, file.positions.length)) + Math.ceil(o.sustainedSeconds / 2) + 2;
  let done = 0;
  const step = (t: string) => o.onProgress?.(t, Math.min(total, done++), total);
  const b0 = await battery();
  const baseline = await runSetup('baseline', file, o, step);
  const tuned = await runSetup('tuned', file, o, step);
  const b1 = await battery();
  const nav = navigator as Navigator & { deviceMemory?: number; gpu?: unknown };
  return {
    device: { cores: nav.hardwareConcurrency || 0, memoryGB: nav.deviceMemory, userAgent: nav.userAgent, webgpu: !!nav.gpu && !o.forceCpu },
    reference: { engine: file.engine, network: file.network, deepVisits: file.deepVisits, lightVisits: file.lightVisits },
    baseline,
    tuned,
    battery: b0 && b1 ? { start: b0.level, end: b1.level, charging: b0.charging || b1.charging } : undefined,
    at: Date.now(),
  };
}
