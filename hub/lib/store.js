// Tiny key-value layer for the hub. In production it talks to Upstash Redis
// over its REST API (free tier); tests use the in-memory version below, which
// implements the same handful of Redis commands.

// Commands that only read: safe to send again when an answer got lost.
const READS = new Set(['GET', 'MGET', 'HGET', 'HMGET', 'HGETALL', 'HLEN', 'HEXISTS', 'LRANGE', 'LLEN', 'LINDEX', 'EXISTS', 'TTL', 'PTTL', 'TYPE', 'STRLEN', 'SCARD', 'SMEMBERS', 'ZRANGE', 'ZCARD', 'ZSCORE']);
const readOnly = (body) => (Array.isArray(body[0]) ? body : [body]).every((c) => READS.has(String(c[0]).toUpperCase()));

// A storage hiccup must not cut an agent off: busy (429) and gateway errors
// (502-504) are tried twice more, since Upstash did not run the command; a
// lost connection or a 500 only for reads, so a write never runs twice.
export function withRetry(call, { tries = 3, waitMs = 150 } = {}) {
  return async (body, path) => {
    for (let i = 1; ; i++) {
      let again;
      try {
        return await call(body, path);
      } catch (e) {
        const status = e.status || 0;
        again = i < tries && ([429, 502, 503, 504].includes(status) || ((status === 0 || status === 500) && readOnly(body)));
        if (!again) throw e;
      }
      await new Promise((r) => setTimeout(r, waitMs * 3 ** (i - 1)));
    }
  };
}

export function upstashStore(url, token, fetchImpl = fetch, retry = {}) {
  const base = url.replace(/\/$/, '');
  const call = withRetry(send, retry);
  async function send(body, path = '') {
    const res = await fetchImpl(base + path, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.error || `store ${res.status}`), { status: res.status });
    return json;
  }
  return {
    async cmd(...args) {
      const r = await call(args);
      if (r.error) throw new Error(r.error);
      return r.result;
    },
    // Several commands in one request (one round trip).
    async multi(cmds) {
      const r = await call(cmds, '/pipeline');
      return r.map((x) => {
        if (x.error) throw new Error(x.error);
        return x.result;
      });
    },
  };
}

// One store per server instance, so what it remembers between requests
// (when the wake check last ran) carries over.
let envStore = null;
export function storeFromEnv(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (envStore?.url !== url || envStore?.token !== token) {
    const store = upstashStore(url, token);
    store.id = url; // names this store for per-instance caches (lib/hub.js)
    envStore = { url, token, store };
  }
  return envStore.store;
}

// Lua scripts (EVAL): several commands in one round trip that Upstash bills
// as one command. Each has a JS twin so the memory store runs the same logic.
// The twin gets call(op, ...args), which runs one command synchronously.
const TWINS = new Map();
export function defineScript(lua, js) {
  TWINS.set(lua, js);
  return lua;
}
// ['EVAL', script, keys.length, ...keys, ...args], usable in multi() too.
export const evalCmd = (script, keys, args = []) => ['EVAL', script, keys.length, ...keys, ...args];
let memIds = 0;

export function memoryStore() {
  const kv = new Map();
  const list = (k) => (kv.has(k) ? kv.get(k) : (kv.set(k, []), kv.get(k)));
  const hash = (k) => (kv.has(k) ? kv.get(k) : (kv.set(k, new Map()), kv.get(k)));
  const idx = (arr, i) => (i < 0 ? arr.length + i : i);
  const ops = {
    GET: (k) => (kv.has(k) ? kv.get(k) : null),
    MGET: (...ks) => ks.map((k) => (kv.has(k) ? kv.get(k) : null)),
    SET: (k, v) => (kv.set(k, String(v)), 'OK'),
    DEL: (k) => (kv.delete(k) ? 1 : 0),
    INCR: (k) => {
      const v = Number(kv.get(k) || 0) + 1;
      kv.set(k, String(v));
      return v;
    },
    INCRBY: (k, n) => {
      const v = Number(kv.get(k) || 0) + Number(n);
      kv.set(k, String(v));
      return v;
    },
    RPUSH: (k, ...v) => list(k).push(...v),
    LLEN: (k) => list(k).length,
    LREM: (k, n, v) => {
      // Only n = 0 (remove every copy) is used.
      const arr = list(k);
      const before = arr.length;
      kv.set(k, arr.filter((x) => x !== v));
      return before - kv.get(k).length;
    },
    LRANGE: (k, a, b) => {
      const arr = list(k);
      const s = Math.max(0, idx(arr, Number(a)));
      const e = Math.min(arr.length - 1, idx(arr, Number(b)));
      return e < s ? [] : arr.slice(s, e + 1);
    },
    LTRIM: (k, a, b) => {
      const arr = list(k);
      const s = Math.max(0, idx(arr, Number(a)));
      const e = idx(arr, Number(b));
      kv.set(k, arr.slice(s, e + 1));
      return 'OK';
    },
    HGET: (k, f) => (hash(k).has(f) ? hash(k).get(f) : null),
    HSET: (k, ...fv) => {
      for (let i = 0; i < fv.length; i += 2) hash(k).set(fv[i], String(fv[i + 1]));
      return fv.length / 2;
    },
    HDEL: (k, ...fs) => fs.filter((f) => hash(k).delete(f)).length,
    HGETALL: (k) => [...hash(k).entries()].flat(),
    EVAL: (lua, n, ...rest) => {
      const js = TWINS.get(lua);
      if (!js) throw new Error('memory store: unknown script');
      return js(run, rest.slice(0, Number(n)), rest.slice(Number(n)));
    },
  };
  function run(op, ...args) {
    if (Array.isArray(op)) [op, ...args] = op;
    const fn = ops[String(op).toUpperCase()];
    if (!fn) throw new Error(`memory store: ${op} not supported`);
    return fn(...args.map(String));
  }
  return {
    id: `mem${++memIds}`,
    async cmd(...args) {
      return run(...args);
    },
    async multi(cmds) {
      return cmds.map((c) => run(...c));
    },
  };
}
