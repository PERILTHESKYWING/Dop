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
import { governEngine, isPhoneLike, setCool } from '../../../src/lib/engine/governor';
import { engineEvaluator } from '../../../src/lib/engine/mcts';
import { bundledModel, MODELS, type ModelSpec } from '../../../src/lib/engine/models';
import { searchProber } from '../../../src/lib/coach/explain/searchProber';
import type { Prober } from '../../../src/lib/coach/explain/types';
import { getSetting } from './settings';

export type EngineStatus = { state: 'idle' } | { state: 'loading'; text: string; pct?: number } | { state: 'ready'; text: string } | { state: 'failed'; text: string };

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

type Attempt = { spec: ModelSpec; forceCpu: boolean };

/** Reads running now, and when the last one ended (the background tune waits for a pause). */
let reading = 0;
let lastRead = 0;
/** Quiet time before the background tune starts. */
const TUNE_IDLE_MS = 4000;

function adopt(loaded: BrowserEngine): BrowserEngine {
  // Heat and battery: fewer workers while the device is hot, low or below half its battery.
  governEngine(loaded, { burst: true });
  loaded.onDeath = (reason) => {
    engine = null;
    // A GPU that crashed once is not tried again on this device: next time b10 on the CPU.
    if (loaded.info.backend === 'webgpu') lsSet(GPU_BROKEN, String(Date.now()));
    set({ state: 'failed', text: `KataGo stopped: ${reason}. It restarts on the next question.` });
  };
  set({ state: 'ready', text: `KataGo ${shortName(loaded)} · ${loaded.info.backend === 'webgpu' ? 'GPU' : `CPU × ${loaded.laneCount}`}` });
  return loaded;
}

/**
 * First visit: measuring the device (tuning.ts) took 10-25 s before the first answer could
 * start. Now the first answers run on one worker straight away, and the measuring waits for
 * a pause with nothing to read: then the plain engine is stopped (never two copies of the
 * network in memory at once, which phones cannot afford), the tuned one loads and is
 * remembered, so later visits start tuned. A read asked for during the measuring waits for it.
 */
function tuneWhenIdle(plain: BrowserEngine, attempt: Attempt) {
  const tick = () => {
    if (engine === null || plain.dead) return; // the plain engine died: the next question boots again
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (reading > 0 || Date.now() - lastRead < TUNE_IDLE_MS || hidden) {
      setTimeout(tick, 1000);
      return;
    }
    plain.onDeath = undefined;
    plain.kill('replaced');
    const onProgress = (p: LoadProgress) => set(progressText(p));
    engine = BrowserEngine.load(attempt, onProgress, { tune: true }).then(adopt, (e) => {
      // Measuring failed: start as before, untuned, so the site keeps working.
      if (!attempt.forceCpu) lsSet(GPU_BROKEN, String(Date.now()));
      engine = null;
      throw e;
    });
    engine.catch(() => {});
  };
  setTimeout(tick, TUNE_IDLE_MS);
}

async function boot(): Promise<BrowserEngine> {
  set({ state: 'loading', text: 'Starting KataGo' });
  const caps = await detectCapabilities();
  const onProgress = (p: LoadProgress) => set(progressText(p));
  // Settings › KataGo › Network: 'b10' never tries the GPU; 'b18' tries it on phones too.
  const pref = getSetting<string>('katago.network');
  const phone = isPhoneLike();
  // Cool mode, as on Dop: a phone has no fan, so it tunes and runs at most two workers
  // (fewer workers to load and measure on the first visit, and the cores stay cooler).
  setCool(phone);
  const attempts = engineAttempts(caps.webgpu && pref !== 'b10', pref !== 'b18' && phone, !!lsGet(GPU_BROKEN));
  let eng: BrowserEngine | null = null;
  let used: Attempt | null = null;
  let lastError: unknown = null;
  for (const a of attempts) {
    try {
      // The remembered tuning if this device has one; else untuned now, measured later.
      eng = await BrowserEngine.load(a, onProgress, { tune: 'remembered' });
      used = a;
      break;
    } catch (e) {
      lastError = e;
      if (!a.forceCpu) lsSet(GPU_BROKEN, String(Date.now()));
    }
  }
  if (!eng || !used) throw lastError ?? new Error('no network could be loaded');
  adopt(eng);
  if (!eng.tuning) tuneWhenIdle(eng, used);
  return eng;
}

/**
 * The engine as a Prober, loading it the first time. Each read takes the engine current at
 * that moment, so an answer started on the untuned engine carries on with the tuned one.
 */
export async function getProber(): Promise<Prober> {
  await current();
  return {
    async read(pos, budget) {
      const eng = await current();
      reading++;
      try {
        return await searchProber(engineEvaluator(eng), { batch: eng.batch }).read(pos, budget);
      } finally {
        reading--;
        lastRead = Date.now();
      }
    },
  };
}

async function current(): Promise<BrowserEngine> {
  engine ??= boot();
  try {
    return await engine;
  } catch (e) {
    engine = null;
    set({ state: 'failed', text: `KataGo could not start: ${(e as Error).message}` });
    throw e;
  }
}
