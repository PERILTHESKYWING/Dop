/* DOPPELGÄNGER engine worker.
 *
 * Hosts KataGo's network evaluation (kataeval.wasm, built from saigo-online/katago-webgpu
 * with engine/build-engine.sh) in a dedicated Web Worker so the UI never blocks. One
 * binary contains the WebGPU backend and the Eigen CPU backend; kataeval probes for a
 * WebGPU adapter and falls back to CPU by itself.
 *
 * The module is built with ASYNCIFY, which allows only one suspended call at a time, so
 * every request is serialised through a promise chain.
 */
/* eslint-disable no-restricted-globals */
'use strict';

const CACHE_NAME = 'doppelganger-models-v1';
const MAX_MOVES = 1024;
const PV_CAP = 24;
const ROOT_CAP = 32;

let M = null;
let size = 19;
let loadedModelKey = null;
let bufs = null;
let postProcess = { outputScale: 1, scoreMeanMultiplier: 20, leadMultiplier: 20 };

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

async function ensureModule() {
  if (M) return M;
  importScripts(new URL('kataeval.js', self.location.href).href);
  // eslint-disable-next-line no-undef
  M = await createKata({
    locateFile: (p) => new URL(p, self.location.href).href,
    print: () => {},
    printErr: (t) => post({ type: 'log', text: String(t) }),
  });
  return M;
}

async function openCache() {
  try {
    return await caches.open(CACHE_NAME);
  } catch (_) {
    return null;
  }
}

/** Download a model with progress, trying each URL in turn. Cached under a stable key. */
async function fetchModel(id, cacheKey, urls) {
  const cache = await openCache();
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      post({ type: 'progress', id, stage: 'cache', loaded: 1, total: 1 });
      return new Uint8Array(await hit.arrayBuffer());
    }
  }
  const errors = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get('content-type') || '';
      if (type.includes('text/html')) throw new Error('got an HTML page instead of a network file');
      const total = Number(res.headers.get('content-length')) || 0;
      let bytes;
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        const chunks = [];
        let loaded = 0;
        let lastPost = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.length;
          const now = Date.now();
          if (now - lastPost > 150) {
            lastPost = now;
            post({ type: 'progress', id, stage: 'download', loaded, total, url });
          }
        }
        bytes = new Uint8Array(loaded);
        let off = 0;
        for (const c of chunks) {
          bytes.set(c, off);
          off += c.length;
        }
      } else {
        bytes = new Uint8Array(await res.arrayBuffer());
      }
      if (bytes.length < 1000 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error('not a gzip network file');
      if (cache) {
        try {
          await cache.put(cacheKey, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }));
        } catch (_) {
          /* quota: keep going without caching */
        }
      }
      return bytes;
    } catch (e) {
      errors.push(`${url}: ${e && e.message ? e.message : e}`);
    }
  }
  throw new Error('could not download network. ' + errors.join(' | '));
}

function allocBuffers() {
  const hw = size * size;
  if (bufs) for (const k of Object.keys(bufs)) M._free(bufs[k]);
  bufs = {
    ml: M._malloc(MAX_MOVES * 4),
    mc: M._malloc(MAX_MOVES * 4),
    board: M._malloc(hw * 4),
    pol: M._malloc((hw + 1) * 4),
    val: M._malloc(8 * 4),
    own: M._malloc(hw * 4),
    best: M._malloc(4),
    wr: M._malloc(4),
    pv: M._malloc(PV_CAP * 4),
    pvLen: M._malloc(4),
    visits: M._malloc(4),
    rMoves: M._malloc(ROOT_CAP * 4),
    rVisits: M._malloc(ROOT_CAP * 4),
    rWr: M._malloc(ROOT_CAP * 4),
    rPrior: M._malloc(ROOT_CAP * 4),
    pp: M._malloc(4 * 4),
  };
}

let modelBytesSource = null; // { id, cacheKey, urls } for reloading on board-size change

async function loadNet(bytes, boardSize) {
  M.FS.writeFile('/model.bin.gz', bytes);
  const ok = await M.ccall('kgeLoad', 'number', ['string', 'number'], ['/model.bin.gz', boardSize], { async: true });
  try {
    M.FS.unlink('/model.bin.gz');
  } catch (_) {
    /* ignore */
  }
  if (!ok) throw new Error('KataGo could not load this network: ' + M.ccall('kgeError', 'string', [], []));
  size = boardSize;
  allocBuffers();
  if (M.ccall('kgePostProcessParams', 'number', ['number'], [bufs.pp])) {
    const f = M.HEAPF32;
    const b = bufs.pp >> 2;
    postProcess = { outputScale: f[b] || 1, scoreMeanMultiplier: f[b + 1] || 20, leadMultiplier: f[b + 2] || 20 };
  }
}

async function init(msg) {
  await ensureModule();
  if (msg.forceCpu) M.ccall('kgeSetForceCpu', null, ['number'], [1]);
  const bytes = await fetchModel(msg.id, msg.cacheKey, msg.urls);
  post({ type: 'progress', id: msg.id, stage: 'load', loaded: 0, total: 0 });
  await loadNet(bytes, msg.boardSize || 19);
  modelBytesSource = { id: msg.id, cacheKey: msg.cacheKey, urls: msg.urls };
  loadedModelKey = msg.cacheKey;
  return {
    backend: M.ccall('kgeBackendIsGpu', 'number', [], []) ? 'webgpu' : 'cpu',
    modelVersion: M.ccall('kgeModelVersion', 'number', [], []),
    postProcess,
    modelKey: loadedModelKey,
  };
}

async function ensureSize(boardSize) {
  if (boardSize === size) return;
  const src = modelBytesSource;
  const bytes = await fetchModel(src.id, src.cacheKey, src.urls);
  await loadNet(bytes, boardSize);
}

function writeMoves(moves) {
  const n = Math.min(moves.length, MAX_MOVES);
  const mi = bufs.ml >> 2;
  const ci = bufs.mc >> 2;
  for (let i = 0; i < n; i++) {
    M.HEAP32[mi + i] = moves[i].loc;
    M.HEAP32[ci + i] = moves[i].color;
  }
  return n;
}

async function evaluate(msg) {
  await ensureSize(msg.size);
  const n = writeMoves(msg.moves);
  const hw = size * size;
  const ok = await M.ccall(
    'kgeEvalSeq',
    'number',
    ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
    [bufs.ml, bufs.mc, n, msg.toPlay, msg.komi, bufs.board, bufs.pol, bufs.val, msg.ownership ? bufs.own : 0],
    { async: true },
  );
  if (!ok) throw new Error('evaluation failed: ' + M.ccall('kgeError', 'string', [], []));
  const policy = M.HEAPF32.slice(bufs.pol >> 2, (bufs.pol >> 2) + hw + 1);
  const value = M.HEAPF32.slice(bufs.val >> 2, (bufs.val >> 2) + 5);
  const ownership = msg.ownership ? M.HEAPF32.slice(bufs.own >> 2, (bufs.own >> 2) + hw) : null;
  const transfer = [policy.buffer, value.buffer];
  if (ownership) transfer.push(ownership.buffer);
  return { result: { policy, value, ownership }, transfer };
}

async function search(msg) {
  await ensureSize(msg.size);
  const n = writeMoves(msg.moves);
  const ok = await M.ccall(
    'kgeSearch',
    'number',
    Array(13).fill('number'),
    [bufs.ml, bufs.mc, n, msg.toPlay, msg.komi, msg.visits, msg.maxMs || 60000, bufs.best, bufs.wr, bufs.pv, PV_CAP, bufs.pvLen, bufs.visits],
    { async: true },
  );
  if (!ok) throw new Error('search failed: ' + M.ccall('kgeError', 'string', [], []));
  const pvLen = M.HEAP32[bufs.pvLen >> 2];
  const pv = Array.from(M.HEAP32.slice(bufs.pv >> 2, (bufs.pv >> 2) + pvLen));
  const k = M.ccall('kgeRootStats', 'number', Array(5).fill('number'), [bufs.rMoves, bufs.rVisits, bufs.rWr, bufs.rPrior, ROOT_CAP]);
  const children = [];
  for (let i = 0; i < k; i++) {
    children.push({
      loc: M.HEAP32[(bufs.rMoves >> 2) + i],
      visits: M.HEAP32[(bufs.rVisits >> 2) + i],
      winrate: M.HEAPF32[(bufs.rWr >> 2) + i],
      prior: M.HEAPF32[(bufs.rPrior >> 2) + i],
    });
  }
  return {
    result: {
      best: M.HEAP32[bufs.best >> 2],
      winrate: M.HEAPF32[bufs.wr >> 2],
      visits: M.HEAP32[bufs.visits >> 2],
      pv,
      children,
    },
  };
}

async function handle(msg) {
  const { id, type } = msg;
  try {
    if (type === 'init') post({ id, ok: true, result: await init(msg) });
    else if (type === 'eval') {
      const r = await evaluate(msg);
      post({ id, ok: true, result: r.result }, r.transfer);
    } else if (type === 'search') post({ id, ok: true, result: (await search(msg)).result });
    else throw new Error('unknown request ' + type);
  } catch (e) {
    post({ id, ok: false, error: String((e && e.message) || e) });
  }
}

let chain = Promise.resolve();
self.onmessage = (e) => {
  chain = chain.then(() => handle(e.data));
};
self.addEventListener('unhandledrejection', (e) => post({ type: 'log', text: 'unhandled: ' + (e.reason && e.reason.message) }));
