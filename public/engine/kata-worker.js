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
/** kataeval evaluates at most this many positions per batch. */
const BATCH_CAP = 16;
/** Give up on a URL that sends no response headers for this long. */
const CONNECT_MS = 20000;
/** Give up on a download that sends no bytes for this long. */
const STALL_MS = 25000;

let M = null;
let size = 19;
let loadedModelKey = null;
let bufs = null;
let postProcess = { outputScale: 1, scoreMeanMultiplier: 20, leadMultiplier: 20 };

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

/** WebAssembly SIMD (every current browser; the -compat build is for older ones). */
function hasSimd() {
  try {
    // (module (func (result v128) i32.const 0 i8x16.splat i8x16.popcnt))
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch (_) {
    return false;
  }
}

let buildName = 'kataeval';

async function ensureModule(compat) {
  if (M) return M;
  buildName = compat || !hasSimd() ? 'kataeval-compat' : 'kataeval';
  // The worker's own ?v= goes on the engine files too, so a new release never mixes with cached old ones.
  const v = self.location.search;
  importScripts(new URL(buildName + '.js' + v, self.location.href).href);
  // eslint-disable-next-line no-undef
  M = await createKata({
    locateFile: (p) => new URL(p + v, self.location.href).href,
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

async function cachedBytes(cacheKey) {
  const cache = await openCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(cacheKey);
    return hit ? new Uint8Array(await hit.arrayBuffer()) : null;
  } catch (_) {
    return null;
  }
}

async function putCached(cacheKey, bytes) {
  const cache = await openCache();
  if (!cache) return;
  try {
    await cache.put(cacheKey, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }));
  } catch (_) {
    /* quota: keep going without caching */
  }
}

async function dropCached(cacheKey) {
  const cache = await openCache();
  if (!cache) return;
  try {
    await cache.delete(cacheKey);
  } catch (_) {
    /* ignore */
  }
}

/** gzip network file, or an uncompressed .bin network (starts with its name on one line). */
function networkKind(bytes) {
  if (bytes.length > 1000 && bytes[0] === 0x1f && bytes[1] === 0x8b) return 'gz';
  if (bytes.length > 100000) {
    let i = 0;
    while (i < 200 && bytes[i] >= 0x20 && bytes[i] < 0x7f) i++;
    if (i >= 3 && bytes[i] === 0x0a) return 'bin';
  }
  return null;
}

/** Download one URL with progress. Aborts when the server goes quiet. */
async function download(url, id) {
  const ctrl = new AbortController();
  let why = 'connect';
  let timer = setTimeout(() => ctrl.abort(), CONNECT_MS);
  const rearm = () => {
    clearTimeout(timer);
    why = 'stall';
    timer = setTimeout(() => ctrl.abort(), STALL_MS);
  };
  try {
    const res = await fetch(url, { mode: 'cors', signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (type.includes('text/html')) throw new Error('got a web page instead of a network file');
    const total = Number(res.headers.get('content-length')) || 0;
    const encoded = !!(res.headers.get('content-encoding') || '').replace(/identity/i, '');
    rearm();
    let bytes;
    if (res.body && res.body.getReader) {
      const reader = res.body.getReader();
      const chunks = [];
      let loaded = 0;
      let lastPost = 0;
      post({ type: 'progress', id, stage: 'download', loaded: 0, total, url });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        rearm();
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
    // A connection that closes early looks like a normal end of stream.
    if (total && !encoded && bytes.length < total * 0.97) throw new Error(`download cut off at ${Math.round(bytes.length / 1e6)} of ${Math.round(total / 1e6)} MB`);
    if (!networkKind(bytes)) throw new Error('the file is not a KataGo network');
    return bytes;
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error(why === 'connect' ? `no answer within ${CONNECT_MS / 1000} s` : `download stalled (no data for ${STALL_MS / 1000} s)`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** The network bytes: from the browser cache, else from the first URL that works. */
async function fetchModel(id, cacheKey, urls, skipCache) {
  if (!skipCache) {
    const hit = await cachedBytes(cacheKey);
    if (hit && networkKind(hit)) {
      post({ type: 'progress', id, stage: 'cache', loaded: 1, total: 1 });
      return { bytes: hit, fromCache: true };
    }
  }
  const errors = [];
  for (const url of urls) {
    try {
      return { bytes: await download(url, id), fromCache: false, url };
    } catch (e) {
      errors.push(`${shortUrl(url)}: ${e && e.message ? e.message : e}`);
      post({ type: 'log', text: `network download failed: ${errors[errors.length - 1]}` });
    }
  }
  throw new Error(urls.length ? 'could not download the network. ' + errors.join(' | ') : 'the network file is no longer in this browser; load it again');
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.host === self.location.host ? u.pathname : u.host;
  } catch (_) {
    return url;
  }
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
    bStones: M._malloc(BATCH_CAP * hw * 4),
    bPlas: M._malloc(BATCH_CAP * 4),
    bPol: M._malloc(BATCH_CAP * (hw + 1) * 4),
    bVal: M._malloc(BATCH_CAP * 5 * 4),
    sOff: M._malloc((BATCH_CAP + 1) * 4),
    sSym: M._malloc(BATCH_CAP * 4),
    sOwn: M._malloc(BATCH_CAP * hw * 4),
  };
  if (seqMl) {
    M._free(seqMl);
    M._free(seqMc);
  }
  seqCap = 0;
  seqMl = seqMc = 0;
}

/** Move buffers for batched sequence evaluation (grown as needed). */
let seqCap = 0;
let seqMl = 0;
let seqMc = 0;

let modelSource = null; // { id, cacheKey, urls } for reloading on board-size change

async function loadNet(bytes, boardSize) {
  const path = networkKind(bytes) === 'bin' ? '/model.bin' : '/model.bin.gz';
  M.FS.writeFile(path, bytes);
  const ok = await M.ccall('kgeLoad', 'number', ['string', 'number'], [path, boardSize], { async: true });
  try {
    M.FS.unlink(path);
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
  await ensureModule(msg.compat);
  if (msg.forceCpu) M.ccall('kgeSetForceCpu', null, ['number'], [1]);
  if (msg.fp16) M.ccall('kgeSetFp16', null, ['number'], [1]);
  const boardSize = msg.boardSize || 19;
  const modelId = msg.modelId;
  let got = await fetchModel(modelId, msg.cacheKey, msg.urls, false);
  post({ type: 'progress', id: modelId, stage: 'load', loaded: 0, total: 0 });
  try {
    await loadNet(got.bytes, boardSize);
  } catch (e) {
    // A damaged cached copy: forget it and download a fresh one once.
    if (!got.fromCache || !msg.urls.length) {
      if (got.fromCache) await dropCached(msg.cacheKey);
      throw e;
    }
    await dropCached(msg.cacheKey);
    got = await fetchModel(modelId, msg.cacheKey, msg.urls, true);
    post({ type: 'progress', id: modelId, stage: 'load', loaded: 0, total: 0 });
    await loadNet(got.bytes, boardSize);
  }
  // Only networks that actually loaded are kept, so a cut-off download is never reused.
  if (!got.fromCache) await putCached(msg.cacheKey, got.bytes);
  modelSource = { id: modelId, cacheKey: msg.cacheKey, urls: msg.urls };
  loadedModelKey = msg.cacheKey;
  return {
    backend: M.ccall('kgeBackendIsGpu', 'number', [], []) ? 'webgpu' : 'cpu',
    modelVersion: M.ccall('kgeModelVersion', 'number', [], []),
    postProcess,
    modelKey: loadedModelKey,
    source: got.fromCache ? 'cache' : got.url,
    build: buildName,
    simd: buildName === 'kataeval',
    heapBytes: M.HEAPF32.length * 4,
  };
}

async function ensureSize(boardSize) {
  if (boardSize === size) return;
  const src = modelSource;
  const got = await fetchModel(src.id, src.cacheKey, src.urls, false);
  await loadNet(got.bytes, boardSize);
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
  const t0 = performance.now();
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
  return { result: { policy, value, ownership, ms: performance.now() - t0 }, transfer };
}

/**
 * Several positions in one network call (stones only, no move history). On a GPU this
 * costs about as much as one evaluation. kataeval returns White's perspective here;
 * convert back to the side to move, like kgeEvalSeq.
 */
async function evaluateBatch(msg) {
  await ensureSize(msg.size);
  const hw = size * size;
  const list = msg.positions;
  if (!list.length || list.length > BATCH_CAP) throw new Error('batch size out of range');
  const si = bufs.bStones >> 2;
  for (let j = 0; j < list.length; j++) {
    const st = list[j].stones;
    for (let p = 0; p < hw; p++) M.HEAP32[si + j * hw + p] = st[p];
    M.HEAP32[(bufs.bPlas >> 2) + j] = list[j].toPlay;
  }
  const ok = await M.ccall(
    'kgeEvalBatch',
    'number',
    Array(6).fill('number'),
    [bufs.bStones, bufs.bPlas, list.length, msg.komi, bufs.bPol, bufs.bVal],
    { async: true },
  );
  if (!ok) throw new Error('batch evaluation failed: ' + M.ccall('kgeError', 'string', [], []));
  const policy = M.HEAPF32.slice(bufs.bPol >> 2, (bufs.bPol >> 2) + list.length * (hw + 1));
  const value = M.HEAPF32.slice(bufs.bVal >> 2, (bufs.bVal >> 2) + list.length * 5);
  for (let j = 0; j < list.length; j++) {
    if (list[j].toPlay !== 1) continue;
    const v = j * 5;
    const w = value[v];
    value[v] = value[v + 1];
    value[v + 1] = w;
    value[v + 3] = -value[v + 3];
    value[v + 4] = -value[v + 4];
  }
  return { result: { policy, value }, transfer: [policy.buffer, value.buffer] };
}

/**
 * Several positions with their full move history in one network call (kgeEvalSeqBatch).
 * msg.locs / msg.cols hold every position's moves back to back, msg.offsets[i] where
 * position i starts (numPos + 1 entries). Values come back for the side to move, like
 * evaluate(); ownership (when asked) for every position.
 */
async function evaluateSeqBatch(msg) {
  await ensureSize(msg.size);
  const hw = size * size;
  const B = msg.toPlay.length;
  if (!B || B > BATCH_CAP) throw new Error('batch size out of range');
  const total = msg.locs.length;
  if (total > seqCap) {
    if (seqMl) {
      M._free(seqMl);
      M._free(seqMc);
    }
    seqCap = Math.max(total, 4096);
    seqMl = M._malloc(seqCap * 4);
    seqMc = M._malloc(seqCap * 4);
  }
  M.HEAP32.set(msg.locs, seqMl >> 2);
  M.HEAP32.set(msg.cols, seqMc >> 2);
  M.HEAP32.set(msg.offsets, bufs.sOff >> 2);
  M.HEAP32.set(msg.toPlay, bufs.bPlas >> 2);
  M.HEAP32.set(msg.syms, bufs.sSym >> 2);
  const t0 = performance.now();
  const ok = await M.ccall(
    'kgeEvalSeqBatch',
    'number',
    Array(10).fill('number'),
    [seqMl, seqMc, bufs.sOff, bufs.bPlas, bufs.sSym, B, msg.komi, bufs.bPol, bufs.bVal, msg.ownership ? bufs.sOwn : 0],
    { async: true },
  );
  if (!ok) throw new Error('batch evaluation failed: ' + M.ccall('kgeError', 'string', [], []));
  const policy = M.HEAPF32.slice(bufs.bPol >> 2, (bufs.bPol >> 2) + B * (hw + 1));
  const value = M.HEAPF32.slice(bufs.bVal >> 2, (bufs.bVal >> 2) + B * 5);
  const ownership = msg.ownership ? M.HEAPF32.slice(bufs.sOwn >> 2, (bufs.sOwn >> 2) + B * hw) : null;
  const transfer = [policy.buffer, value.buffer];
  if (ownership) transfer.push(ownership.buffer);
  return { result: { policy, value, ownership, heapBytes: M.HEAPF32.length * 4, ms: performance.now() - t0 }, transfer };
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
    } else if (type === 'evalSeqBatch') {
      const r = await evaluateSeqBatch(msg);
      post({ id, ok: true, result: r.result }, r.transfer);
    } else if (type === 'evalBatch') {
      const r = await evaluateBatch(msg);
      post({ id, ok: true, result: r.result }, r.transfer);
    } else if (type === 'search') post({ id, ok: true, result: (await search(msg)).result });
    else throw new Error('unknown request ' + type);
  } catch (e) {
    const text = String((e && e.message) || e);
    // After a WebAssembly trap or abort the module cannot be used again.
    const fatal = e instanceof WebAssembly.RuntimeError || /Aborted\(|unreachable|out of bounds|out of memory|device (was )?lost/i.test(text);
    post({ id, ok: false, error: text, fatal });
  }
}

let chain = Promise.resolve();
self.onmessage = (e) => {
  chain = chain.then(() => handle(e.data));
};
self.addEventListener('unhandledrejection', (e) => post({ type: 'log', text: 'unhandled: ' + (e.reason && e.reason.message) }));
