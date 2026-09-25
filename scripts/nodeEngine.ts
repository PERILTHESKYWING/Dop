/**
 * Node.js host for the same kataeval.wasm the browser uses (CPU backend), for the demo
 * generator and engine integration tests.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { EngineBackend, EngineRequest, RawSearchResult } from '../src/lib/engine/types';
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

export async function loadNodeEngine(modelPath: string, modelId: string, size = 19): Promise<EngineBackend> {
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
    ml: M._malloc(4096 * 4),
    mc: M._malloc(4096 * 4),
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
  };
  M.ccall('kgePostProcessParams', 'number', ['number'], [b.pp]);
  const f = M.HEAPF32;
  const postProcess: PostProcessParams = {
    outputScale: f[b.pp >> 2] || 1,
    scoreMeanMultiplier: f[(b.pp >> 2) + 1] || 20,
    leadMultiplier: f[(b.pp >> 2) + 2] || 20,
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
  return {
    info,
    postProcess,
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
  };
}
