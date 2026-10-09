/**
 * Per-device engine settings, measured once and remembered: how many engine workers run
 * side by side (CPU cores), how many positions go into one network call, and whether the
 * GPU runs the network in half precision. Every choice is made from timings on the
 * device itself, against the plain setup (one worker, one position per call, fp32).
 */

export interface Tuning {
  /** Engine workers that evaluate in parallel (1 on a GPU). */
  lanes: number;
  /** Positions per network call in each worker. */
  laneBatch: number;
  /** WebGPU in half precision (checked against fp32 on this device first). */
  fp16: boolean;
  /** Positions per second with this setup, and with the plain setup (1 worker, batch 1). */
  evalsPerSec: number;
  baselineEvalsPerSec: number;
  /** WebAssembly memory of one worker, in bytes. */
  laneHeapBytes: number;
  /** The engine build (SIMD or compat). */
  build: string;
  measuredAt: number;
  /** One line per measurement, for Settings. */
  log: string[];
}

export interface DeviceFacts {
  cores: number;
  /** navigator.deviceMemory in GB (Chrome only), else undefined. */
  memoryGB?: number;
  backend: 'webgpu' | 'cpu' | 'none';
  adapter?: string;
}

const KEY = 'dop.tune.v1';

export function deviceFacts(backend: DeviceFacts['backend'], adapter?: string): DeviceFacts {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : undefined;
  return { cores: Math.max(1, nav?.hardwareConcurrency || 2), memoryGB: nav?.deviceMemory, backend, adapter };
}

export function tuningKey(modelId: string, build: string, d: DeviceFacts) {
  return `${KEY}:${modelId}:${build}:${d.backend}:${d.cores}:${d.adapter ?? ''}`;
}

export function loadTuning(key: string): Tuning | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const t = JSON.parse(raw) as Tuning;
    return t && t.lanes >= 1 && t.laneBatch >= 1 ? t : null;
  } catch {
    return null;
  }
}

export function saveTuning(key: string, t: Tuning) {
  try {
    localStorage.setItem(key, JSON.stringify(t));
  } catch {
    /* storage blocked: tune again next time */
  }
}

export function forgetTunings() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(KEY)) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Most workers worth trying: one per core, leaving one for the page, and only as many as
 * fit in a share of the device's memory (each worker holds its own copy of the network).
 */
export function maxLanes(d: DeviceFacts, laneHeapBytes: number): number {
  if (d.backend === 'webgpu') return 1;
  const byCores = Math.max(1, Math.min(8, d.cores - 1));
  const budget = Math.min(1.5e9, (d.memoryGB ?? 4) * 1e9 * 0.3);
  const byMemory = Math.max(1, Math.floor(budget / Math.max(laneHeapBytes, 32e6)));
  return Math.max(1, Math.min(byCores, byMemory));
}

/** A setting is kept only when it is clearly better (timings in a browser are noisy). */
export const worthIt = (better: number, base: number, margin = 1.12) => better > base * margin;

/** The batch with the best throughput, preferring smaller ones unless a bigger one clearly wins. */
export function pickBatch(perPos: { batch: number; msPerPos: number }[], maxCallMs = 400): number {
  let best = perPos[0];
  for (const p of perPos.slice(1)) {
    if (p.msPerPos * p.batch > maxCallMs) continue; // keep interactive analysis responsive
    if (worthIt(best.msPerPos, p.msPerPos, 1.08)) best = p;
  }
  return best.batch;
}
