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
import { engineEvaluator, type LeafEvaluator } from '../../../src/lib/engine/mcts';
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
/** When measuring last failed here: not tried again for a week (the untuned engine works). */
const TUNE_FAILED = 'kami.tuneFailed';
const TUNE_RETRY_MS = 7 * 24 * 3600_000;

/** Measure this device in the background now? Not within a week of a failed try. */
export function shouldTune(tuned: boolean, failedAt: string | null, now = Date.now()): boolean {
  if (tuned) return false;
  const t = Number(failedAt);
  return !failedAt || !Number.isFinite(t) || now - t > TUNE_RETRY_MS;
}

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
    const next: Promise<BrowserEngine> = BrowserEngine.load(attempt, onProgress, { tune: true }).then(adopt, () => {
      // Measuring failed: remember it (no retry for a week, see shouldTune) and start the
      // untuned engine again, so the site keeps working and the status ends ready.
      lsSet(TUNE_FAILED, String(Date.now()));
      if (!attempt.forceCpu) lsSet(GPU_BROKEN, String(Date.now()));
      return boot();
    });
    engine = next;
    next.catch((e) => {
      if (engine !== next) return;
      engine = null;
      set({ state: 'failed', text: `KataGo could not start: ${(e as Error).message}` });
    });
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
  if (shouldTune(!!eng.tuning, lsGet(TUNE_FAILED))) tuneWhenIdle(eng, used);
  return eng;
}

/** What a search over the engine needs: its evaluator (sharing the engine's NN cache), batch size and network. */
export interface SearchKit {
  evaluator: LeafEvaluator;
  batch: number;
  modelId: string;
}

const kits = new WeakMap<BrowserEngine, SearchKit>();

/**
 * The search kit of the engine current now (loading it the first time). One kit per engine,
 * so a search kept between reads (kami/src/lib/analysis.ts) starts afresh when the tuned
 * engine replaces the untuned one; reads of the same network stay cached.
 */
export async function getSearchKit(): Promise<SearchKit> {
  const eng = await current();
  let kit = kits.get(eng);
  if (!kit) {
    kit = { evaluator: engineEvaluator(eng), batch: eng.batch ?? 1, modelId: eng.info.modelId };
    kits.set(eng, kit);
  }
  return kit;
}

/** A read starts on the engine: measuring waits until it ends (call the returned function). */
export function readStarted(): () => void {
  reading++;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    reading--;
    lastRead = Date.now();
  };
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
