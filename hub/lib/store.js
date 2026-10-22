// Tiny key-value layer for the hub. In production it talks to Upstash Redis
// over its REST API (free tier); tests use the in-memory version below, which
// implements the same handful of Redis commands.

export function upstashStore(url, token, fetchImpl = fetch) {
  const base = url.replace(/\/$/, '');
  async function call(body, path = '') {
    const res = await fetchImpl(base + path, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `store ${res.status}`);
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

export function storeFromEnv(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const store = upstashStore(url, token);
  store.id = url; // names this store for per-instance caches (lib/hub.js)
  return store;
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
    HSETNX: (k, f, v) => (hash(k).has(f) ? 0 : (hash(k).set(f, String(v)), 1)),
    SADD: (k, ...vs) => {
      const set = kv.has(k) ? kv.get(k) : (kv.set(k, new Set()), kv.get(k));
      const before = set.size;
      vs.forEach((v) => set.add(v));
      return set.size - before;
    },
    SREM: (k, ...vs) => (kv.has(k) ? vs.filter((v) => kv.get(k).delete(v)).length : 0),
    SMEMBERS: (k) => (kv.has(k) ? [...kv.get(k)] : []),
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
