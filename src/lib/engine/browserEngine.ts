import type { EngineInfo } from '../types';
import type { ModelSpec } from './models';
import { DEFAULT_POSTPROCESS, type PostProcessParams, type RawNetOutput } from './parse';
import type { EngineBackend, EngineRequest, RawSearchResult, StonesPosition } from './types';
import { deviceFacts, loadTuning, maxLanes, pickBatch, saveTuning, tuningKey, worthIt, type DeviceFacts, type Tuning } from './tuning';

export const ENGINE_BUILD = 'katago-webgpu@d5ad1c0';
/**
 * Changes whenever public/engine changes, so browsers holding the old files (the host
 * caches /engine/ for a week) load the new worker and WebAssembly together.
 */
const ENGINE_FILES = 'simd-1';

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
  stage: 'cache' | 'download' | 'load' | 'check' | 'tune';
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

export interface LoadOptions {
  /**
   * Measure this device and run as many engine workers and as big network batches as pay
   * off (remembered per device and network). Off for the helper engines that run beside
   * the main one.
   */
  tune?: boolean;
  /** Measure again even if this device was measured before. */
  retune?: boolean;
  /** The pre-SIMD build with no tuning: the plain setup the benchmark compares against. */
  baseline?: boolean;
}

/** How long a request may run once the worker has started on it. */
const EVAL_TIMEOUT_MS = 90_000;
const SEARCH_GRACE_MS = 90_000;
/** Loading: no progress for this long means the worker is stuck. */
const DOWNLOAD_QUIET_MS = 70_000;
const LOAD_STAGE_MS = 180_000;
/** kataeval's largest batch. */
const MAX_CALL = 16;
const FP16_TRYING = 'dop.fp16Trying';

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timeoutMs: number; what: string; positions: number };

interface InitResult {
  backend: 'webgpu' | 'cpu';
  modelVersion: number;
  postProcess: PostProcessParams;
  build?: string;
  heapBytes?: number;
}

/** One KataGo worker. It runs one request at a time; requests queue in order. */
class Lane {
  readonly worker: Worker;
  private pending = new Map<number, Pending>();
  private order: number[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextId = 1;
  dead: string | null = null;
  onDie?: (reason: string) => void;
  onProgress?: (m: any) => void;
  /** Positions queued or running here (for spreading work over workers). */
  load = 0;
  /** Network time the worker reports for each call (for spotting a device slowing down with heat). */
  onCompute?: (positions: number, ms: number) => void;
  heapBytes = 0;

  constructor() {
    this.worker = new Worker(new URL(`/engine/kata-worker.js?v=${ENGINE_FILES}`, location.href), { name: 'katago' });
    this.worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'progress') {
        this.onProgress?.(m);
        return;
      }
      if (m.type === 'log') return;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.settle(m.id);
      if (m.ok) {
        if (m.result?.heapBytes) this.heapBytes = m.result.heapBytes;
        if (typeof m.result?.ms === 'number') this.onCompute?.(p.positions, m.result.ms);
        p.resolve(m.result);
      } else if (m.fatal) {
        const reason = `KataGo crashed: ${m.error}`;
        p.reject(new EngineFailure(reason));
        this.kill(reason);
      } else p.reject(new Error(m.error));
    };
    this.worker.onerror = (e) => {
      e.preventDefault?.();
      this.kill(`KataGo crashed${e.message ? `: ${e.message}` : ''}`);
    };
    this.worker.onmessageerror = () => this.kill('KataGo sent a message that could not be read');
  }

  kill(reason: string) {
    if (this.dead) return;
    this.dead = reason;
    clearTimeout(this.timer);
    this.worker.terminate();
    const err = new EngineFailure(reason);
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.order = [];
    this.onDie?.(reason);
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

  call<T>(msg: Record<string, unknown>, timeoutMs: number, transfer: Transferable[] = [], positions = 1): Promise<T> {
    if (this.dead) return Promise.reject(new EngineFailure(this.dead));
    const id = this.nextId++;
    this.load += positions;
    return new Promise<T>((resolve, reject) => {
      const done = () => (this.load -= positions);
      this.pending.set(id, {
        resolve: (v) => {
          done();
          resolve(v);
        },
        reject: (e) => {
          done();
          reject(e);
        },
        timeoutMs,
        what: String(msg.type),
        positions,
      });
      this.order.push(id);
      if (this.order.length === 1) this.armHead();
      this.worker.postMessage({ ...msg, id }, transfer);
    });
  }
}

/** A request for batched evaluation with move history. */
export interface SeqRequest extends EngineRequest {
  ownership?: boolean;
  /** Board symmetry 0..7 the network sees the position in (outputs come back unrotated). */
  symmetry?: number;
}

/** Positions that make up the timing workloads (an opening and a fighting middle game). */
function sampleRequests(n: number): SeqRequest[] {
  const line = [72, 288, 60, 300, 42, 98, 234, 180, 255, 103, 136, 224, 262, 186, 211, 149, 175, 157, 117, 99, 80, 61, 43, 228, 266, 267, 248, 230];
  const out: SeqRequest[] = [];
  for (let i = 0; i < n; i++) {
    const k = 4 + ((i * 7) % (line.length - 4));
    const moves = line.slice(0, k).map((loc, j) => ({ color: (j % 2 === 0 ? 1 : 2) as 1 | 2, loc }));
    out.push({ size: 19, komi: 7.5, moves, toPlay: k % 2 === 0 ? 1 : 2, symmetry: i % 8 });
  }
  return out;
}

/**
 * KataGo in Web Workers (WebGPU, or the CPU fallback built into the same WASM). On the
 * CPU several workers ("lanes") evaluate side by side, one per spare core; on a GPU one
 * worker sends batches of positions per network call. How many of each pays off is
 * measured on the device (see tuning.ts).
 */
export class BrowserEngine implements EngineBackend {
  info: EngineInfo;
  postProcess: PostProcessParams = DEFAULT_POSTPROCESS;
  /** Milliseconds per network evaluation (one position, one worker), measured after loading. */
  evalMs = 0;
  /** Milliseconds for one batch of `laneBatch` positions in one worker. */
  batchMs = 0;
  /** Positions per network call in each worker. */
  laneBatch = 1;
  /** The measured setup on this device. */
  tuning: Tuning | null = null;
  /** Engine build in the workers ('kataeval' with SIMD, or 'kataeval-compat'). */
  build = 'kataeval';
  /** Set once a worker crashed, hung or trapped. */
  dead: string | null = null;
  onDeath?: (reason: string) => void;
  /** Positions evaluated and the time the network spent on them (for throughput and heat). */
  evalCount = 0;
  evalBusyMs = 0;
  private lanes: Lane[] = [];
  /** Lanes in use; the power governor can lower it while the device is hot or on battery. */
  private active = 1;
  private onProgress?: (p: LoadProgress) => void;
  private lastProgress: LoadProgress | null = null;
  private lastProgressAt = 0;
  private size = 19;
  private spec: ModelSpec | null = null;
  private initMsg: Record<string, unknown> = {};

  private constructor(info: EngineInfo) {
    this.info = info;
  }

  /** Positions per evaluator call worth sending: all active workers, each a full batch. */
  get batch(): number {
    return this.active * this.laneBatch;
  }

  get laneCount() {
    return this.lanes.length;
  }

  get activeLanes() {
    return this.active;
  }

  /** Use fewer workers (heat, battery) or all of them again. */
  setActiveLanes(n: number) {
    this.active = Math.max(1, Math.min(this.lanes.length, Math.round(n)));
  }

  /** WebAssembly memory held by all workers, in bytes. */
  get heapBytes() {
    return this.lanes.reduce((a, l) => a + l.heapBytes, 0);
  }

  /** Stop every worker and fail everything still waiting. */
  kill(reason: string) {
    if (this.dead) return;
    this.dead = reason;
    for (const l of this.lanes) l.kill(reason);
    this.onDeath?.(reason);
  }

  /** Called with the network time of every call (see governor.ts). */
  onCompute?: (positions: number, ms: number) => void;

  private addLane(): Lane {
    const lane = new Lane();
    lane.onDie = (reason) => {
      if (reason !== 'replaced') this.kill(reason);
    };
    lane.onCompute = (n, ms) => this.onCompute?.(n, ms);
    this.lanes.push(lane);
    return lane;
  }

  /** Load a network in a new worker, watching for a stuck download or a load that never finishes. */
  private async initLane(lane: Lane, msg: Record<string, unknown>): Promise<InitResult> {
    this.lastProgressAt = Date.now();
    lane.onProgress = (m) => {
      const p: LoadProgress = { modelId: m.id, stage: m.stage, loaded: m.loaded, total: m.total, source: m.url ? sourceName(m.url) : undefined };
      this.lastProgress = p;
      this.lastProgressAt = Date.now();
      this.onProgress?.(p);
    };
    const watchdog = setInterval(() => {
      const quiet = Date.now() - this.lastProgressAt;
      const loading = this.lastProgress?.stage === 'load';
      if (quiet > (loading ? LOAD_STAGE_MS : DOWNLOAD_QUIET_MS)) {
        lane.kill(loading ? `loading the network took longer than ${LOAD_STAGE_MS / 1000} s` : `the network download stopped (nothing for ${DOWNLOAD_QUIET_MS / 1000} s)`);
      }
    }, 2000);
    try {
      const r = await lane.call<InitResult>({ type: 'init', ...msg }, 0);
      if (r.heapBytes) lane.heapBytes = r.heapBytes;
      return r;
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
    // Batched evaluation must give the same numbers as a single one.
    const [b] = await this.laneSeqBatch(this.lanes[0], [{ size: 19, komi: 7.5, moves: [], toPlay: 1, ownership: true }]);
    if (Math.abs(b.value[0] - raw.value[0]) > 0.05 || Math.abs(b.value[4] - raw.value[4]) > 0.05) throw new Error('batched evaluation disagrees with single evaluation on this device');
  }

  /** Milliseconds per position for `n` positions in batches of `batch`, over the given lanes. */
  private async timeWorkload(lanes: Lane[], batch: number, perLane: number): Promise<number> {
    const work = sampleRequests(batch * perLane);
    // Warm-up: shader compilation / first allocation for this batch size.
    await Promise.all(lanes.map((l) => this.laneSeqBatch(l, work.slice(0, batch))));
    const t0 = performance.now();
    await Promise.all(
      lanes.map(async (l) => {
        for (let k = 0; k < perLane; k++) await this.laneSeqBatch(l, work.slice(k * batch, (k + 1) * batch));
      }),
    );
    return (performance.now() - t0) / (batch * perLane * lanes.length);
  }

  /**
   * Measure this device: the batch size per network call, then (on the CPU) how many
   * workers in parallel still add throughput, then (on a GPU, for networks that allow it)
   * half precision. Each step is kept only if it clearly beats the plain setup.
   */
  private async tune(key: string, facts: DeviceFacts): Promise<Tuning> {
    this.onProgress?.({ modelId: this.info.modelId, stage: 'tune', loaded: 0, total: 3 });
    const log: string[] = [];
    const first = this.lanes[0];
    const gpu = this.info.backend === 'webgpu';
    const batches = gpu ? [1, 4, 8, 16] : [1, 2, 4, 8];
    const perPos: { batch: number; msPerPos: number }[] = [];
    const started = performance.now();
    for (const b of batches) {
      // A very slow device gets a shorter measurement (bigger batches would take too long per call anyway).
      if (perPos.length && (performance.now() - started > 8000 || perPos[0].msPerPos * b > 2000)) break;
      const ms = await this.timeWorkload([first], b, b === 1 ? 4 : 2);
      perPos.push({ batch: b, msPerPos: ms });
      log.push(`batch ${b}: ${ms.toFixed(1)} ms per position`);
    }
    const baselineMs = perPos[0].msPerPos;
    this.laneBatch = pickBatch(perPos);
    let bestMs = perPos.find((p) => p.batch === this.laneBatch)!.msPerPos;
    this.batchMs = bestMs * this.laneBatch;
    this.onProgress?.({ modelId: this.info.modelId, stage: 'tune', loaded: 1, total: 3 });

    if (!gpu) {
      const most = maxLanes(facts, first.heapBytes);
      while (this.lanes.length < most) {
        const lane = this.addLane();
        try {
          await this.initLane(lane, this.initMsg);
        } catch {
          this.dropLane(lane);
          break;
        }
        const ms = await this.timeWorkload(this.lanes, this.laneBatch, 3);
        log.push(`${this.lanes.length} workers: ${ms.toFixed(1)} ms per position`);
        if (!worthIt(bestMs, ms)) {
          this.dropLane(lane);
          break;
        }
        bestMs = ms;
      }
    } else if (this.info.modelVersion >= 10 && !lsGet(FP16_TRYING)) {
      // g170 networks overflow in fp16; newer ones are trained to be fp16-safe.
      lsSet(FP16_TRYING, '1');
      const lane = new Lane();
      try {
        await lane.call({ type: 'init', ...this.initMsg, fp16: true }, LOAD_STAGE_MS);
        const probe = sampleRequests(4);
        const ref = await this.laneSeqBatch(first, probe);
        const half = await this.laneSeqBatch(lane, probe);
        const agree = probe.every((_, i) => {
          const a = ref[i], h = half[i];
          return Math.abs(a.value[0] - h.value[0]) < 0.1 && Math.abs(a.value[4] - h.value[4]) < 0.1 && argmax(a.policyLogits) === argmax(h.policyLogits);
        });
        const ms = await this.timeWorkload([lane], this.laneBatch, 3);
        log.push(`half precision: ${ms.toFixed(1)} ms per position, ${agree ? 'same answers' : 'different answers'}`);
        if (agree && worthIt(bestMs, ms)) {
          lane.onDie = (reason) => {
            if (reason !== 'replaced') this.kill(reason);
          };
          lane.onCompute = (n, ms) => this.onCompute?.(n, ms);
          this.lanes = [lane];
          first.kill('replaced');
          bestMs = ms;
        } else lane.kill('replaced');
      } catch (e) {
        lane.kill('replaced');
        log.push(`half precision failed: ${(e as Error).message}`);
      } finally {
        lsSet(FP16_TRYING, null);
      }
    }
    this.active = this.lanes.length;
    const t: Tuning = {
      lanes: this.lanes.length,
      laneBatch: this.laneBatch,
      fp16: this.lanes[0] !== first,
      evalsPerSec: 1000 / bestMs,
      baselineEvalsPerSec: 1000 / baselineMs,
      laneHeapBytes: first.heapBytes,
      build: this.build,
      measuredAt: Date.now(),
      log,
    };
    saveTuning(key, t);
    this.onProgress?.({ modelId: this.info.modelId, stage: 'tune', loaded: 3, total: 3 });
    return t;
  }

  /** Start the remembered number of workers (no measuring). */
  private async applyTuning(t: Tuning) {
    this.laneBatch = t.laneBatch;
    this.batchMs = this.laneBatch * (1000 / t.evalsPerSec);
    if (t.fp16 && this.info.backend === 'webgpu') {
      const lane = this.addLane();
      try {
        await this.initLane(lane, { ...this.initMsg, fp16: true });
        const first = this.lanes[0];
        this.lanes = [lane];
        first.kill('replaced');
      } catch {
        this.dropLane(lane);
      }
    }
    while (this.lanes.length < t.lanes) {
      const lane = this.addLane();
      try {
        await this.initLane(lane, this.initMsg);
      } catch {
        this.dropLane(lane);
        break;
      }
    }
    this.active = this.lanes.length;
  }

  private dropLane(lane: Lane) {
    this.lanes = this.lanes.filter((l) => l !== lane);
    lane.kill('replaced');
  }

  /** Load one network on one backend and check that it computes sensible numbers. */
  static async load(attempt: StartAttempt, onProgress?: (p: LoadProgress) => void, opts: LoadOptions = {}): Promise<BrowserEngine> {
    const { spec, forceCpu } = attempt;
    const eng = new BrowserEngine({
      engine: ENGINE_BUILD,
      backend: 'none',
      modelId: spec.id,
      modelName: spec.name,
      modelVersion: spec.modelVersion,
    });
    eng.spec = spec;
    eng.onProgress = onProgress;
    eng.initMsg = {
      modelId: spec.id,
      urls: spec.urls.map((u) => new URL(u, location.href).href),
      cacheKey: cacheKeyFor(spec),
      boardSize: 19,
      forceCpu,
      compat: !!opts.baseline,
    };
    try {
      const r = await eng.initLane(eng.addLane(), eng.initMsg);
      eng.info = { ...eng.info, backend: r.backend, modelVersion: r.modelVersion };
      eng.build = r.build ?? 'kataeval';
      eng.postProcess = { ...r.postProcess, winrateScale: spec.winrateFromScore };
      await eng.healthCheck();
      if (opts.tune && !opts.baseline) {
        const facts = deviceFacts(r.backend, undefined);
        const key = tuningKey(spec.id, eng.build, facts);
        const known = opts.retune ? null : loadTuning(key);
        if (known) {
          await eng.applyTuning(known);
          eng.tuning = known;
        } else eng.tuning = await eng.tune(key, facts);
      }
      eng.onProgress = undefined;
      return eng;
    } catch (e) {
      eng.kill('replaced');
      throw e;
    }
  }

  /** The least busy active worker. */
  private pickLane(): Lane {
    let best = this.lanes[0];
    for (let i = 1; i < this.active; i++) if (this.lanes[i].load < best.load) best = this.lanes[i];
    return best;
  }

  private track<T>(p: Promise<T>, positions: number): Promise<T> {
    const t0 = performance.now();
    return p.then((v) => {
      this.evalCount += positions;
      this.evalBusyMs += performance.now() - t0;
      return v;
    });
  }

  async evalRaw(req: EngineRequest, ownership: boolean): Promise<RawNetOutput> {
    this.size = req.size;
    const r = await this.track(
      this.pickLane().call<{ policy: Float32Array; value: Float32Array; ownership: Float32Array | null }>(
        { type: 'eval', size: req.size, komi: req.komi, moves: req.moves, toPlay: req.toPlay, ownership },
        EVAL_TIMEOUT_MS,
      ),
      1,
    );
    return { policyLogits: r.policy, value: r.value, ownership: r.ownership };
  }

  /** Up to 16 positions with their move history in one network call on one worker. */
  private async laneSeqBatch(lane: Lane, reqs: SeqRequest[]): Promise<RawNetOutput[]> {
    const size = reqs[0].size;
    const komi = reqs[0].komi;
    const hw = size * size;
    let total = 0;
    for (const r of reqs) total += r.moves.length;
    const locs = new Int32Array(total);
    const cols = new Int32Array(total);
    const offsets = new Int32Array(reqs.length + 1);
    let k = 0;
    reqs.forEach((r, i) => {
      offsets[i] = k;
      for (const m of r.moves) {
        locs[k] = m.loc;
        cols[k] = m.color;
        k++;
      }
    });
    offsets[reqs.length] = k;
    const toPlay = Int32Array.from(reqs, (r) => r.toPlay);
    const syms = Int32Array.from(reqs, (r) => (r.symmetry ?? 0) & 7);
    const ownership = reqs.some((r) => r.ownership);
    const r = await lane.call<{ policy: Float32Array; value: Float32Array; ownership: Float32Array | null }>(
      { type: 'evalSeqBatch', size, komi, locs, cols, offsets, toPlay, syms, ownership },
      EVAL_TIMEOUT_MS,
      [locs.buffer, cols.buffer, offsets.buffer, toPlay.buffer, syms.buffer],
      reqs.length,
    );
    // A graphics driver that loses the device can hand back garbage instead of failing.
    for (let i = 0; i < r.value.length; i++) {
      if (!Number.isFinite(r.value[i])) {
        lane.kill('the network returned invalid numbers');
        throw new EngineFailure('the network returned invalid numbers');
      }
    }
    return reqs.map((q, j) => ({
      policyLogits: r.policy.subarray(j * (hw + 1), (j + 1) * (hw + 1)),
      value: r.value.subarray(j * 5, j * 5 + 5),
      ownership: q.ownership && r.ownership ? r.ownership.subarray(j * hw, (j + 1) * hw) : null,
    }));
  }

  /**
   * Many positions with history: spread over the active workers in network calls of
   * `laneBatch` (at most 16), all in flight at once. Results are side-to-move, as evalRaw.
   */
  async evalSeqBatchRaw(reqs: SeqRequest[]): Promise<RawNetOutput[]> {
    if (!reqs.length) return [];
    this.size = reqs[0].size;
    const out: RawNetOutput[] = new Array(reqs.length);
    const groups = new Map<number, number[]>();
    for (let i = 0; i < reqs.length; i++) {
      const k = reqs[i].komi * 1000 + reqs[i].size;
      const g = groups.get(k);
      if (g) g.push(i);
      else groups.set(k, [i]);
    }
    const per = Math.max(1, Math.min(MAX_CALL, this.laneBatch));
    const jobs: Promise<void>[] = [];
    for (const idx of groups.values()) {
      for (let a = 0; a < idx.length; a += per) {
        const chunk = idx.slice(a, a + per);
        const lane = this.pickLane();
        jobs.push(
          this.track(this.laneSeqBatch(lane, chunk.map((i) => reqs[i])), chunk.length).then((res) => {
            chunk.forEach((i, j) => (out[i] = res[j]));
          }),
        );
      }
    }
    await Promise.all(jobs);
    return out;
  }

  async evalBatchRaw(size: number, komi: number, positions: StonesPosition[]): Promise<RawNetOutput[]> {
    this.size = size;
    const hw = size * size;
    const r = await this.lanes[0].call<{ policy: Float32Array; value: Float32Array }>(
      { type: 'evalBatch', size, komi, positions: positions.map((p) => ({ stones: Int8Array.from(p.stones), toPlay: p.toPlay })) },
      EVAL_TIMEOUT_MS,
    );
    return positions.map((_, j) => ({
      policyLogits: r.policy.subarray(j * (hw + 1), (j + 1) * (hw + 1)),
      value: r.value.subarray(j * 5, j * 5 + 5),
      ownership: null,
    }));
  }

  searchRaw(req: EngineRequest, visits: number, maxMs: number): Promise<RawSearchResult> {
    this.size = req.size;
    return this.lanes[0].call<RawSearchResult>(
      { type: 'search', size: req.size, komi: req.komi, moves: req.moves, toPlay: req.toPlay, visits, maxMs },
      maxMs + SEARCH_GRACE_MS,
    );
  }

  get boardSize() {
    return this.size;
  }

  get modelSpec() {
    return this.spec;
  }

  terminate() {
    this.kill('stopped');
  }
}

function argmax(a: ArrayLike<number>) {
  let b = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i;
  return b;
}

function lsGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function lsSet(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage blocked */
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
