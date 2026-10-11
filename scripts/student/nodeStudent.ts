/**
 * The student network as an EngineBackend under Node (one thread, the same runtime and
 * WebAssembly the browser's workers run), for the gate and experiments.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DopnetRuntime } from '../../src/lib/student/runtime';
import { studentRaw } from '../../src/lib/student/backend';
import { DEFAULT_POSTPROCESS, type RawNetOutput } from '../../src/lib/engine/parse';
import type { EngineBackend, EngineRequest, RawSearchResult } from '../../src/lib/engine/types';

const here = path.dirname(fileURLToPath(import.meta.url));
export const STUDENT_WASM = path.join(here, '..', '..', 'public', 'student', 'dopnet.wasm');

export interface NodeStudent extends EngineBackend {
  rt: DopnetRuntime;
  evals(): number;
  exits(): number;
}

export async function loadNodeStudent(netPath: string, opts: { allowExit?: boolean; wasm?: string } = {}): Promise<NodeStudent> {
  const rt = await DopnetRuntime.create(readFileSync(opts.wasm ?? STUDENT_WASM), readFileSync(netPath));
  let evals = 0;
  let exits = 0;
  const one = (req: EngineRequest & { ownership?: boolean; symmetry?: number }): RawNetOutput => {
    const r = studentRaw(rt, req, { allowExit: opts.allowExit ?? true });
    evals++;
    if (r.exited) exits++;
    return r;
  };
  return {
    rt,
    info: { engine: 'dopnet', backend: 'cpu', modelId: rt.header.name, modelName: rt.header.name, modelVersion: 1 },
    postProcess: DEFAULT_POSTPROCESS,
    batch: 1,
    evalRaw: async (req, ownership) => one({ ...req, ownership }),
    evalSeqBatchRaw: async (reqs) => reqs.map(one),
    searchRaw: async (): Promise<RawSearchResult> => {
      throw new Error('searchRaw is not used');
    },
    evals: () => evals,
    exits: () => exits,
  };
}
