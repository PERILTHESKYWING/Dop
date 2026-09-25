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
      const adapter = await gpu.requestAdapter();
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

export interface LoadProgress {
  modelId: string;
  stage: 'cache' | 'download' | 'load';
  loaded: number;
  total: number;
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

/** KataGo running in a Web Worker (WebGPU, or the CPU fallback built into the same WASM). */
export class BrowserEngine implements EngineBackend {
  info: EngineInfo;
  postProcess: PostProcessParams = DEFAULT_POSTPROCESS;
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private onProgress?: (p: LoadProgress) => void;
  private size = 19;

  private constructor(worker: Worker, info: EngineInfo) {
    this.worker = worker;
    this.info = info;
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'progress') {
        this.onProgress?.({ modelId: m.id, stage: m.stage, loaded: m.loaded, total: m.total });
        return;
      }
      if (m.type === 'log') return;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else p.reject(new Error(m.error));
    };
    worker.onerror = (e) => {
      const err = new Error(e.message || 'engine worker crashed');
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }

  private call<T>(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id }, transfer);
    });
  }

  /** Try each model in order until one loads. */
  static async start(models: ModelSpec[], forceCpu: boolean, onProgress?: (p: LoadProgress) => void): Promise<BrowserEngine> {
    if (!models.length) throw new Error('no compatible network available');
    const errors: string[] = [];
    for (const spec of models) {
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
        const cacheKey = new URL(`/__models__/${spec.file}`, location.href).href;
        const r = await eng.call<{ backend: 'webgpu' | 'cpu'; modelVersion: number; postProcess: PostProcessParams }>({
          type: 'init',
          urls: spec.urls.map((u) => new URL(u, location.href).href),
          cacheKey,
          boardSize: 19,
          forceCpu,
        });
        eng.info = { ...eng.info, backend: r.backend, modelVersion: r.modelVersion };
        eng.postProcess = r.postProcess;
        return eng;
      } catch (e) {
        errors.push(`${spec.name}: ${(e as Error).message}`);
        worker.terminate();
      }
    }
    throw new Error(errors.join('\n'));
  }

  async evalRaw(req: EngineRequest, ownership: boolean): Promise<RawNetOutput> {
    this.size = req.size;
    const r = await this.call<{ policy: Float32Array; value: Float32Array; ownership: Float32Array | null }>({
      type: 'eval',
      size: req.size,
      komi: req.komi,
      moves: req.moves,
      toPlay: req.toPlay,
      ownership,
    });
    return { policyLogits: r.policy, value: r.value, ownership: r.ownership };
  }

  searchRaw(req: EngineRequest, visits: number, maxMs: number): Promise<RawSearchResult> {
    this.size = req.size;
    return this.call<RawSearchResult>({ type: 'search', size: req.size, komi: req.komi, moves: req.moves, toPlay: req.toPlay, visits, maxMs });
  }

  get boardSize() {
    return this.size;
  }

  terminate() {
    this.worker.terminate();
  }
}
