import type { EngineBackend, EngineRequest, RawSearchResult } from '../engine/types';
import { DEFAULT_POSTPROCESS, type RawNetOutput } from '../engine/parse';
import type { EngineInfo } from '../types';
import type { StudentRequest } from './backend';
import type { DopnetHeader } from './runtime';

/**
 * The student network as an engine backend: one Web Worker per lane, each with its own
 * runtime (runtime.ts, WebAssembly SIMD). Only 19x19; the caller keeps the main KataGo
 * engine for other sizes and for judging the top of the tree.
 */

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
}

class StudentLane {
  readonly worker: Worker;
  private pending = new Map<number, Pending>();
  private next = 1;
  dead: string | null = null;
  load = 0;
  onCompute?: (positions: number, ms: number) => void;

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'student' });
    this.worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else p.reject(new Error(m.error));
    };
    this.worker.onerror = (e) => {
      e.preventDefault?.();
      this.kill(`student network crashed${e.message ? `: ${e.message}` : ''}`);
    };
  }

  call<T>(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
    if (this.dead) return Promise.reject(new Error(this.dead));
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id }, transfer);
    });
  }

  kill(reason: string) {
    if (this.dead) return;
    this.dead = reason;
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error(reason));
    this.pending.clear();
  }
}

export class StudentEngine implements EngineBackend {
  readonly info: EngineInfo;
  readonly postProcess = DEFAULT_POSTPROCESS;
  dead: string | null = null;
  /** Positions evaluated, and how many the early exit answered. */
  evalCount = 0;
  exitCount = 0;
  evalBusyMs = 0;
  /** Lanes to use now (the main engine's, which the power governor sets). */
  lanesNow: () => number = () => this.lanes.length;
  allowExit = true;
  private lanes: StudentLane[] = [];

  private constructor(readonly header: DopnetHeader) {
    this.info = { engine: 'dopnet', backend: 'cpu', modelId: header.name, modelName: `DopNet ${header.C}x${header.N}`, modelVersion: 1 };
  }

  static async load(wasm: ArrayBuffer, net: ArrayBuffer, header: DopnetHeader, lanes: number): Promise<StudentEngine> {
    const eng = new StudentEngine(header);
    for (let i = 0; i < Math.max(1, lanes); i++) {
      const lane = new StudentLane();
      eng.lanes.push(lane);
      await lane.call({ type: 'init', wasm: wasm.slice(0), net: net.slice(0) });
    }
    return eng;
  }

  get batch() {
    return Math.max(1, Math.min(this.lanes.length, this.lanesNow())) * 4;
  }

  terminate() {
    this.dead = 'stopped';
    for (const l of this.lanes) l.kill('stopped');
  }

  async evalRaw(req: EngineRequest, ownership: boolean): Promise<RawNetOutput> {
    const [r] = await this.evalSeqBatchRaw([{ ...req, ownership }]);
    return r;
  }

  /** Contiguous chunks per lane: a search sends sibling leaves together, which share most of their work. */
  async evalSeqBatchRaw(reqs: (EngineRequest & { ownership?: boolean; symmetry?: number })[]): Promise<RawNetOutput[]> {
    if (this.dead) throw new Error(this.dead);
    const lanes = this.lanes.filter((l) => !l.dead).slice(0, Math.max(1, this.lanesNow()));
    if (!lanes.length) throw new Error('student network stopped');
    const per = Math.ceil(reqs.length / lanes.length);
    const parts = await Promise.all(
      lanes.map(async (lane, i) => {
        const chunk = reqs.slice(i * per, (i + 1) * per);
        if (!chunk.length) return [] as RawNetOutput[];
        const sreqs: StudentRequest[] = chunk.map((r) => ({ komi: r.komi, moves: r.moves, toPlay: r.toPlay, ownership: r.ownership, symmetry: r.symmetry }));
        const res = await lane.call<{ outs: (RawNetOutput & { exited: boolean })[]; ms: number }>({ type: 'eval', reqs: sreqs, allowExit: this.allowExit });
        this.evalCount += res.outs.length;
        this.exitCount += res.outs.filter((o) => o.exited).length;
        this.evalBusyMs += res.ms;
        return res.outs;
      }),
    );
    return parts.flat();
  }

  async searchRaw(): Promise<RawSearchResult> {
    throw new Error('the student network is searched by the site (mcts.ts)');
  }
}
