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
  return url && token ? upstashStore(url, token) : null;
}

export function memoryStore() {
  const kv = new Map();
  const list = (k) => (kv.has(k) ? kv.get(k) : (kv.set(k, []), kv.get(k)));
  const hash = (k) => (kv.has(k) ? kv.get(k) : (kv.set(k, new Map()), kv.get(k)));
  const idx = (arr, i) => (i < 0 ? arr.length + i : i);
  const ops = {
    GET: (k) => (kv.has(k) ? kv.get(k) : null),
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
    HDEL: (k, f) => (hash(k).delete(f) ? 1 : 0),
    HGETALL: (k) => [...hash(k).entries()].flat(),
  };
  const run = ([op, ...args]) => {
    const fn = ops[String(op).toUpperCase()];
    if (!fn) throw new Error(`memory store: ${op} not supported`);
    return fn(...args.map(String));
  };
  return {
    async cmd(...args) {
      return run(args);
    },
    async multi(cmds) {
      return cmds.map(run);
    },
  };
}
