import type { EngineInfo } from '../types';
import type { ModelSpec } from './models';
import { DEFAULT_POSTPROCESS, type PostProcessParams, type RawNetOutput } from './parse';
import type { EngineBackend, EngineRequest, RawSearchResult } from './types';

export const ENGINE_BUILD = 'katago-webgpu@d5ad1c0';

export interface Capabilities {
  webgpu: boolean;
  webgpuAdapter?: string;
  wasm: boolean;
  workers: boolean;
  indexedDB: boolean;
  cacheApi: boolean;
  secureContext: boolean;
}

export async function detectCapabilities(): Promise<Capabilities> {
  const caps: Capabilities = {
    webgpu: false,
    wasm: typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function',
    workers: typeof Worker !== 'undefined',
    indexedDB: typeof indexedDB !== 'undefined',
    cacheApi: typeof caches !== 'undefined',
    secureContext: typeof isSecureContext === 'boolean' ? isSecureContext : true,
  };
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: { vendor?: string; architecture?: string } } | null> } }).gpu;
    if (gpu) {
      const adapter = await withTimeout(gpu.requestAdapter(), 5000, null);
      if (adapter) {
        caps.webgpu = true;
        const info = adapter.info;
        caps.webgpuAdapter = [info?.vendor, info?.architecture].filter(Boolean).join(' ') || 'available';
      }
    }
  } catch {
    caps.webgpu = false;
  }
  return caps;
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

export interface LoadProgress {
  modelId: string;
  stage: 'cache' | 'download' | 'load' | 'check';
  loaded: number;
  total: number;
  /** Which download source is being tried. */
  source?: string;
}

/** The engine died (crash, hang or trap) and must be restarted before it can be used again. */
export class EngineFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineFailure';
  }
}

export const isEngineFailure = (e: unknown) => e instanceof EngineFailure;

export interface StartAttempt {
  spec: ModelSpec;
  forceCpu: boolean;
}

/** How long a request may run once the worker has started on it. */
const EVAL_TIMEOUT_MS = 90_000;
const SEARCH_GRACE_MS = 90_000;
/** Loading: no progress for this long means the worker is stuck. */
const DOWNLOAD_QUIET_MS = 70_000;
const LOAD_STAGE_MS = 180_000;

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timeoutMs: number; what: string };

/** KataGo running in a Web Worker (WebGPU, or the CPU fallback built into the same WASM). */
export class BrowserEngine implements EngineBackend {
  info: EngineInfo;
  postProcess: PostProcessParams = DEFAULT_POSTPROCESS;
  /** Milliseconds per network evaluation, measured after loading. */
  evalMs = 0;
  /** Set once the worker crashed, hung or trapped. */
  dead: string | null = null;
  onDeath?: (reason: string) => void;
  private worker: Worker;
  private pending = new Map<number, Pending>();
  /** Requests in the order the worker runs them (it handles one at a time). */
  private order: number[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextId = 1;
  private onProgress?: (p: LoadProgress) => void;
  private lastProgress: LoadProgress | null = null;
  private lastProgressAt = 0;
  private size = 19;

  private constructor(worker: Worker, info: EngineInfo) {
    this.worker = worker;
    this.info = info;
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'progress') {
        const p: LoadProgress = { modelId: m.id, stage: m.stage, loaded: m.loaded, total: m.total, source: m.url ? sourceName(m.url) : undefined };
        this.lastProgress = p;
        this.lastProgressAt = Date.now();
        this.onProgress?.(p);
        return;
      }
      if (m.type === 'log') return;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.settle(m.id);
      if (m.ok) p.resolve(m.result);
      else if (m.fatal) {
        const reason = `KataGo crashed: ${m.error}`;
        p.reject(new EngineFailure(reason));
        this.kill(reason);
      } else p.reject(new Error(m.error));
    };
    worker.onerror = (e) => {
      e.preventDefault?.();
      this.kill(`KataGo crashed${e.message ? `: ${e.message}` : ''}`);
    };
    worker.onmessageerror = () => this.kill('KataGo sent a message that could not be read');
  }

  /** Stop the worker and fail everything still waiting. */
  kill(reason: string) {
    if (this.dead) return;
    this.dead = reason;
    clearTimeout(this.timer);
    this.worker.terminate();
    const err = new EngineFailure(reason);
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.order = [];
    this.onDeath?.(reason);
  }

  private settle(id: number) {
    this.pending.delete(id);
    const wasHead = this.order[0] === id;
    this.order = this.order.filter((x) => x !== id);
    if (wasHead) this.armHead();
  }

  /** Time only the request the worker is running now; queued ones wait their turn. */
  private armHead() {
    clearTimeout(this.timer);
    const id = this.order[0];
    if (id === undefined) return;
    const p = this.pending.get(id)!;
    if (!p.timeoutMs) return;
    this.timer = setTimeout(() => this.kill(`KataGo stopped responding (${p.what} took longer than ${Math.round(p.timeoutMs / 1000)} s)`), p.timeoutMs);
  }

  private call<T>(msg: Record<string, unknown>, timeoutMs: number, transfer: Transferable[] = []): Promise<T> {
    if (this.dead) return Promise.reject(new EngineFailure(this.dead));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, timeoutMs, what: String(msg.type) });
      this.order.push(id);
      if (this.order.length === 1) this.armHead();
      this.worker.postMessage({ ...msg, id }, transfer);
    });
  }

  /** Load a network, watching for a stuck download or a load that never finishes. */
  private async init(spec: ModelSpec, forceCpu: boolean) {
    const cacheKey = cacheKeyFor(spec);
    this.lastProgressAt = Date.now();
    const watchdog = setInterval(() => {
      const quiet = Date.now() - this.lastProgressAt;
      const loading = this.lastProgress?.stage === 'load';
      if (quiet > (loading ? LOAD_STAGE_MS : DOWNLOAD_QUIET_MS)) {
        this.kill(loading ? `loading the network took longer than ${LOAD_STAGE_MS / 1000} s` : `the network download stopped (nothing for ${DOWNLOAD_QUIET_MS / 1000} s)`);
      }
    }, 2000);
    try {
      return await this.call<{ backend: 'webgpu' | 'cpu'; modelVersion: number; postProcess: PostProcessParams }>(
        { type: 'init', modelId: spec.id, urls: spec.urls.map((u) => new URL(u, location.href).href), cacheKey, boardSize: 19, forceCpu },
        0,
      );
    } finally {
      clearInterval(watchdog);
    }
  }

  /** One evaluation of the empty board: catches backends that load but compute garbage. */
  private async healthCheck() {
    this.onProgress?.({ modelId: this.info.modelId, stage: 'check', loaded: 0, total: 0 });
    const t0 = performance.now();
    const raw = await this.evalRaw({ size: 19, komi: 7.5, moves: [], toPlay: 1 }, true);
    // Second call is the steady-state speed (the first one includes warm-up).
    const t1 = performance.now();
    await this.evalRaw({ size: 19, komi: 7.5, moves: [{ color: 1, loc: 72 }], toPlay: 2 }, false);
    this.evalMs = Math.round(performance.now() - t1) || Math.round(t1 - t0);
    const finite = (a: ArrayLike<number> | null | undefined) => {
      if (!a) return true;
      for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
      return true;
    };
    if (!finite(raw.policyLogits) || !finite(raw.value) || !finite(raw.ownership)) throw new Error('the network returned invalid numbers on this device');
  }

  /** Load one network on one backend and check that it computes sensible numbers. */
  static async load(attempt: StartAttempt, onProgress?: (p: LoadProgress) => void): Promise<BrowserEngine> {
    const { spec, forceCpu } = attempt;
    const worker = new Worker(new URL('/engine/kata-worker.js', location.href), { name: 'katago' });
    const eng = new BrowserEngine(worker, {
      engine: ENGINE_BUILD,
      backend: 'none',
      modelId: spec.id,
      modelName: spec.name,
      modelVersion: spec.modelVersion,
    });
    eng.onProgress = onProgress;
    try {
      const r = await eng.init(spec, forceCpu);
      eng.info = { ...eng.info, backend: r.backend, modelVersion: r.modelVersion };
      eng.postProcess = r.postProcess;
      await eng.healthCheck();
      eng.onProgress = undefined;
      return eng;
    } catch (e) {
      eng.kill('replaced');
      throw e;
    }
  }

  async evalRaw(req: EngineRequest, ownership: boolean): Promise<RawNetOutput> {
    this.size = req.size;
    const r = await this.call<{ policy: Float32Array; value: Float32Array; ownership: Float32Array | null }>(
      { type: 'eval', size: req.size, komi: req.komi, moves: req.moves, toPlay: req.toPlay, ownership },
      EVAL_TIMEOUT_MS,
    );
    return { policyLogits: r.policy, value: r.value, ownership: r.ownership };
  }

  searchRaw(req: EngineRequest, visits: number, maxMs: number): Promise<RawSearchResult> {
    this.size = req.size;
    return this.call<RawSearchResult>(
      { type: 'search', size: req.size, komi: req.komi, moves: req.moves, toPlay: req.toPlay, visits, maxMs },
      maxMs + SEARCH_GRACE_MS,
    );
  }

  get boardSize() {
    return this.size;
  }

  terminate() {
    this.kill('stopped');
  }
}

export const cacheKeyFor = (spec: Pick<ModelSpec, 'file'>) => new URL(`/__models__/${spec.file}`, location.href).href;

function sourceName(url: string) {
  try {
    const u = new URL(url);
    return u.host === location.host ? 'this site' : u.host;
  } catch {
    return url;
  }
}
