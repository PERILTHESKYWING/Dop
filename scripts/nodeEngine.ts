/**
 * Node.js host for the same kataeval.wasm the browser uses (CPU backend), for the demo
 * generator and engine integration tests.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { EngineBackend, EngineRequest, RawSearchResult, StonesPosition } from '../src/lib/engine/types';
import type { PostProcessParams, RawNetOutput } from '../src/lib/engine/parse';
import type { EngineInfo } from '../src/lib/types';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ENGINE_JS = path.join(here, '..', 'public', 'engine', 'kataeval.js');

type Kata = {
  ccall: (name: string, ret: string | null, types: string[], args: unknown[], opts?: { async: boolean }) => any;
  FS: { writeFile: (p: string, d: Uint8Array) => void; unlink: (p: string) => void };
  HEAP32: Int32Array;
  HEAPF32: Float32Array;
  _malloc: (n: number) => number;
};

/**
 * `batch` > 1 makes the tree search use batched (stones-only) evaluation, as on a GPU.
 * `winrateScale` derives winrates from the score (as the app does for small networks).
 */
export async function loadNodeEngine(modelPath: string, modelId: string, size = 19, batch = 1, winrateScale?: number): Promise<EngineBackend> {
  if (!existsSync(ENGINE_JS)) throw new Error(`missing ${ENGINE_JS}; run engine/build-engine.sh`);
  const require = createRequire(import.meta.url);
  const createKata = require(ENGINE_JS);
  const M: Kata = await createKata({ print: () => {}, printErr: () => {} });
  M.ccall('kgeSetForceCpu', null, ['number'], [1]);
  M.FS.writeFile('/m.bin.gz', new Uint8Array(readFileSync(modelPath)));
  const ok = await M.ccall('kgeLoad', 'number', ['string', 'number'], ['/m.bin.gz', size], { async: true });
  if (!ok) throw new Error('kgeLoad: ' + M.ccall('kgeError', 'string', [], []));
  M.FS.unlink('/m.bin.gz');
  const hw = size * size;
  const b = {
    // Room for 16 positions' move lists (batched evaluation).
    ml: M._malloc(16 * 1024 * 4),
    mc: M._malloc(16 * 1024 * 4),
    board: M._malloc(hw * 4),
    pol: M._malloc((hw + 1) * 4),
    val: M._malloc(32),
    own: M._malloc(hw * 4),
    best: M._malloc(4),
    wr: M._malloc(4),
    pv: M._malloc(96),
    pvLen: M._malloc(4),
    vis: M._malloc(4),
    rm: M._malloc(128),
    rv: M._malloc(128),
    rw: M._malloc(128),
    rp: M._malloc(128),
    pp: M._malloc(16),
    bs: M._malloc(16 * hw * 4),
    bp: M._malloc(16 * 4),
    bpol: M._malloc(16 * (hw + 1) * 4),
    bval: M._malloc(16 * 5 * 4),
  };
  M.ccall('kgePostProcessParams', 'number', ['number'], [b.pp]);
  const f = M.HEAPF32;
  const postProcess: PostProcessParams = {
    outputScale: f[b.pp >> 2] || 1,
    scoreMeanMultiplier: f[(b.pp >> 2) + 1] || 20,
    leadMultiplier: f[(b.pp >> 2) + 2] || 20,
    winrateScale,
  };
  const info: EngineInfo = {
    engine: 'katago-webgpu@d5ad1c0',
    backend: 'cpu',
    modelId,
    modelName: path.basename(modelPath),
    modelVersion: M.ccall('kgeModelVersion', 'number', [], []),
  };
  const write = (req: EngineRequest) => {
    req.moves.forEach((m, i) => {
      M.HEAP32[(b.ml >> 2) + i] = m.loc;
      M.HEAP32[(b.mc >> 2) + i] = m.color;
    });
    return req.moves.length;
  };
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn);
    chain = p.catch(() => undefined);
    return p;
  };
  const evalOne = async (req: EngineRequest, ownership: boolean): Promise<RawNetOutput> => {
    if (req.size !== size) throw new Error('board size mismatch');
    const n = write(req);
    const ok = await M.ccall('kgeEvalSeq', 'number', Array(9).fill('number'), [b.ml, b.mc, n, req.toPlay, req.komi, b.board, b.pol, b.val, ownership ? b.own : 0], {
      async: true,
    });
    if (!ok) throw new Error('kgeEvalSeq: ' + M.ccall('kgeError', 'string', [], []));
    return {
      policyLogits: M.HEAPF32.slice(b.pol >> 2, (b.pol >> 2) + hw + 1),
      value: M.HEAPF32.slice(b.val >> 2, (b.val >> 2) + 5),
      ownership: ownership ? M.HEAPF32.slice(b.own >> 2, (b.own >> 2) + hw) : null,
    };
  };
  // Batched evaluation with move history (kgeEvalSeqBatch), up to 16 positions.
  const sb = { off: M._malloc(17 * 4), pl: M._malloc(16 * 4), sy: M._malloc(16 * 4), own: M._malloc(16 * hw * 4) };
  const evalSeq = async (reqs: (EngineRequest & { ownership?: boolean; symmetry?: number })[]): Promise<RawNetOutput[]> => {
    let k = 0;
    reqs.forEach((r, j) => {
      M.HEAP32[(sb.off >> 2) + j] = k;
      M.HEAP32[(sb.pl >> 2) + j] = r.toPlay;
      M.HEAP32[(sb.sy >> 2) + j] = (r.symmetry ?? 0) & 7;
      for (const m of r.moves) {
        M.HEAP32[(b.ml >> 2) + k] = m.loc;
        M.HEAP32[(b.mc >> 2) + k] = m.color;
        k++;
      }
    });
    M.HEAP32[(sb.off >> 2) + reqs.length] = k;
    const own = reqs.some((r) => r.ownership);
    const ok = await M.ccall('kgeEvalSeqBatch', 'number', Array(10).fill('number'), [b.ml, b.mc, sb.off, sb.pl, sb.sy, reqs.length, reqs[0].komi, b.bpol, b.bval, own ? sb.own : 0], {
      async: true,
    });
    if (!ok) throw new Error('kgeEvalSeqBatch: ' + M.ccall('kgeError', 'string', [], []));
    return reqs.map((r, j) => ({
      policyLogits: M.HEAPF32.slice((b.bpol >> 2) + j * (hw + 1), (b.bpol >> 2) + (j + 1) * (hw + 1)),
      value: M.HEAPF32.slice((b.bval >> 2) + j * 5, (b.bval >> 2) + j * 5 + 5),
      ownership: r.ownership ? M.HEAPF32.slice((sb.own >> 2) + j * hw, (sb.own >> 2) + (j + 1) * hw) : null,
    }));
  };
  return {
    info,
    postProcess,
    batch,
    evalBatchRaw: (sz: number, komi: number, positions: StonesPosition[]) =>
      serial(async (): Promise<RawNetOutput[]> => {
        if (sz !== size) throw new Error('board size mismatch');
        positions.forEach((p, j) => {
          for (let i = 0; i < hw; i++) M.HEAP32[(b.bs >> 2) + j * hw + i] = p.stones[i];
          M.HEAP32[(b.bp >> 2) + j] = p.toPlay;
        });
        const ok = await M.ccall('kgeEvalBatch', 'number', Array(6).fill('number'), [b.bs, b.bp, positions.length, komi, b.bpol, b.bval], { async: true });
        if (!ok) throw new Error('kgeEvalBatch: ' + M.ccall('kgeError', 'string', [], []));
        return positions.map((p, j) => {
          const v = M.HEAPF32.slice((b.bval >> 2) + j * 5, (b.bval >> 2) + j * 5 + 5);
          // kataeval's batch values are White's perspective; evalRaw's are the side to move's.
          const value = p.toPlay === 1 ? Float32Array.from([v[1], v[0], v[2], -v[3], -v[4]]) : v;
          return { policyLogits: M.HEAPF32.slice((b.bpol >> 2) + j * (hw + 1), (b.bpol >> 2) + (j + 1) * (hw + 1)), value, ownership: null };
        });
      }),
    evalRaw: (req, ownership) =>
      serial(async (): Promise<RawNetOutput> => {
        if (req.size !== size) throw new Error('board size mismatch');
        const n = write(req);
        const ok = await M.ccall(
          'kgeEvalSeq',
          'number',
          Array(9).fill('number'),
          [b.ml, b.mc, n, req.toPlay, req.komi, b.board, b.pol, b.val, ownership ? b.own : 0],
          { async: true },
        );
        if (!ok) throw new Error('kgeEvalSeq: ' + M.ccall('kgeError', 'string', [], []));
        return {
          policyLogits: M.HEAPF32.slice(b.pol >> 2, (b.pol >> 2) + hw + 1),
          value: M.HEAPF32.slice(b.val >> 2, (b.val >> 2) + 5),
          ownership: ownership ? M.HEAPF32.slice(b.own >> 2, (b.own >> 2) + hw) : null,
        };
      }),
    searchRaw: (req, visits, maxMs) =>
      serial(async (): Promise<RawSearchResult> => {
        const n = write(req);
        const ok = await M.ccall(
          'kgeSearch',
          'number',
          Array(13).fill('number'),
          [b.ml, b.mc, n, req.toPlay, req.komi, visits, maxMs, b.best, b.wr, b.pv, 24, b.pvLen, b.vis],
          { async: true },
        );
        if (!ok) throw new Error('kgeSearch: ' + M.ccall('kgeError', 'string', [], []));
        const k = M.ccall('kgeRootStats', 'number', Array(5).fill('number'), [b.rm, b.rv, b.rw, b.rp, 32]);
        const children = [];
        for (let i = 0; i < k; i++)
          children.push({
            loc: M.HEAP32[(b.rm >> 2) + i],
            visits: M.HEAP32[(b.rv >> 2) + i],
            winrate: M.HEAPF32[(b.rw >> 2) + i],
            prior: M.HEAPF32[(b.rp >> 2) + i],
          });
        const pvLen = M.HEAP32[b.pvLen >> 2];
        return {
          best: M.HEAP32[b.best >> 2],
          winrate: M.HEAPF32[b.wr >> 2],
          visits: M.HEAP32[b.vis >> 2],
          pv: Array.from(M.HEAP32.slice(b.pv >> 2, (b.pv >> 2) + pvLen)),
          children,
        };
      }),
    evalSeqBatchRaw: async (reqs) => {
      if (batch <= 1) return Promise.all(reqs.map((r) => serial(async () => evalOne(r, !!r.ownership))));
      const out: RawNetOutput[] = [];
      for (let a = 0; a < reqs.length; a += 16) out.push(...(await serial(() => evalSeq(reqs.slice(a, a + 16)))));
      return out;
    },
  };
}
