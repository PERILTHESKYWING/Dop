/**
 * KataGo for Kami: Dop's BrowserEngine with the bundled b10 network (served from /engine and
 * /models, copied in by kami/vite.config.ts), loaded on the first position question, wrapped
 * in the explainer's Prober. Tuned once per device like Dop's main engine.
 */
import { BrowserEngine, detectCapabilities, type LoadProgress } from '../../../src/lib/engine/browserEngine';
import { engineEvaluator } from '../../../src/lib/engine/mcts';
import { bundledModel } from '../../../src/lib/engine/models';
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
      ? 'Downloading KataGo'
      : p.stage === 'cache' || p.stage === 'load'
        ? 'Loading KataGo'
        : p.stage === 'check'
          ? 'Checking KataGo'
          : 'Measuring this device (first time only)';
  return { state: 'loading', text, pct };
}

let engine: Promise<BrowserEngine> | null = null;

async function boot(): Promise<BrowserEngine> {
  set({ state: 'loading', text: 'Starting KataGo' });
  const caps = await detectCapabilities();
  const spec = bundledModel();
  const onProgress = (p: LoadProgress) => set(progressText(p));
  const eng = await BrowserEngine.load({ spec, forceCpu: !caps.webgpu }, onProgress, { tune: true }).catch((e) => {
    if (!caps.webgpu) throw e;
    return BrowserEngine.load({ spec, forceCpu: true }, onProgress, { tune: true });
  });
  eng.onDeath = (reason) => {
    engine = null;
    set({ state: 'failed', text: `KataGo stopped: ${reason}. It restarts on the next question.` });
  };
  set({ state: 'ready', text: `KataGo b10 · ${eng.info.backend === 'webgpu' ? 'GPU' : `CPU × ${eng.laneCount}`}` });
  return eng;
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
