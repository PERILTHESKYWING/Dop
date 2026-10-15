/**
 * KataGo for Kami, loaded on the first position question and wrapped in the explainer's
 * Prober. Tuned once per device like Dop's main engine.
 *
 * The network decides how good the answers are, so Kami takes the strongest one the device
 * can run, by Dop's own rule (src/state/brain.ts): kata1 b18 (about 97 MB, downloaded once
 * through /katago-models) on a computer with WebGPU; the bundled b10 (served from /models)
 * on phones and tablets, without WebGPU, or after the GPU failed here once.
 */
import { BrowserEngine, detectCapabilities, type LoadProgress } from '../../../src/lib/engine/browserEngine';
import { isPhoneLike } from '../../../src/lib/engine/governor';
import { engineEvaluator } from '../../../src/lib/engine/mcts';
import { bundledModel, MODELS, type ModelSpec } from '../../../src/lib/engine/models';
import { searchProber } from '../../../src/lib/coach/explain/searchProber';
import type { Prober } from '../../../src/lib/coach/explain/types';

export type EngineStatus =
  | { state: 'idle' }
  | { state: 'loading'; text: string; pct?: number }
  | { state: 'ready'; text: string }
  | { state: 'failed'; text: string };

let status: EngineStatus = { state: 'idle' };
const listeners = new Set<() => void>();

function set(s: EngineStatus) {
  status = s;
  for (const l of listeners) l();
}

export const engineStatus = () => status;
export function onEngineStatus(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function progressText(p: LoadProgress): EngineStatus {
  const pct = p.total ? Math.round((100 * p.loaded) / p.total) : undefined;
  const text =
    p.stage === 'download'
      ? 'Downloading KataGo (first time only)'
      : p.stage === 'cache' || p.stage === 'load'
        ? 'Loading KataGo'
        : p.stage === 'check'
          ? 'Checking KataGo'
          : 'Measuring this device (first time only)';
  return { state: 'loading', text, pct };
}

let engine: Promise<BrowserEngine> | null = null;

const STRONG_ID = 'kata1-b18c384nbt';
const GPU_BROKEN = 'kami.gpuBroken';

const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

/** What to try, best first: the strong network on the GPU of a computer, then b10. */
export function engineAttempts(webgpu: boolean, phone: boolean, gpuBroken: boolean): { spec: ModelSpec; forceCpu: boolean }[] {
  const strong = MODELS.find((m) => m.id === STRONG_ID);
  const list: { spec: ModelSpec; forceCpu: boolean }[] = [];
  if (strong && webgpu && !phone && !gpuBroken) list.push({ spec: strong, forceCpu: false });
  list.push({ spec: bundledModel(), forceCpu: true });
  return list;
}

const shortName = (eng: BrowserEngine) => (eng.info.modelId === STRONG_ID ? 'b18 (strong)' : 'b10 (small)');

async function boot(): Promise<BrowserEngine> {
  set({ state: 'loading', text: 'Starting KataGo' });
  const caps = await detectCapabilities();
  const onProgress = (p: LoadProgress) => set(progressText(p));
  const attempts = engineAttempts(caps.webgpu, isPhoneLike(), !!lsGet(GPU_BROKEN));
  let eng: BrowserEngine | null = null;
  let lastError: unknown = null;
  for (const a of attempts) {
    try {
      eng = await BrowserEngine.load(a, onProgress, { tune: true });
      break;
    } catch (e) {
      lastError = e;
      if (!a.forceCpu) lsSet(GPU_BROKEN, String(Date.now()));
    }
  }
  if (!eng) throw lastError ?? new Error('no network could be loaded');
  const loaded = eng;
  loaded.onDeath = (reason) => {
    engine = null;
    // A GPU that crashed once is not tried again on this device: next time b10 on the CPU.
    if (loaded.info.backend === 'webgpu') lsSet(GPU_BROKEN, String(Date.now()));
    set({ state: 'failed', text: `KataGo stopped: ${reason}. It restarts on the next question.` });
  };
  set({ state: 'ready', text: `KataGo ${shortName(loaded)} · ${loaded.info.backend === 'webgpu' ? 'GPU' : `CPU × ${loaded.laneCount}`}` });
  return loaded;
}

/** The engine as a Prober, loading it the first time. */
export async function getProber(): Promise<Prober> {
  engine ??= boot();
  let eng: BrowserEngine;
  try {
    eng = await engine;
  } catch (e) {
    engine = null;
    set({ state: 'failed', text: `KataGo could not start: ${(e as Error).message}` });
    throw e;
  }
  return searchProber(engineEvaluator(eng), { batch: eng.batch });
}
