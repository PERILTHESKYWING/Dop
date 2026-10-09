/**
 * Accounts and sync, server side (the /api/account function and the Vite dev middleware).
 *
 * A username and password, so the same kifu, games and player data can be opened on
 * another device. The app stays local-first: everything works signed out, and the
 * account only stores a compressed copy of the browser's data ("snapshot") that the
 * client uploads in parts and downloads again elsewhere.
 *
 * Storage is a Redis database reached over Upstash's REST API (free tier; on Vercel it is
 * one click under Storage, which sets KV_REST_API_URL and KV_REST_API_TOKEN). Passwords are
 * hashed with scrypt and a per-user salt, and never stored or logged; sessions are random
 * tokens in an httpOnly cookie, kept server-side only as a SHA-256 hash.
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

export interface AccountHttpResult {
  status: number;
  body: unknown;
  /** Set-Cookie header values. */
  cookies?: string[];
}

export interface AccountRequest {
  method: string;
  /** ?action=… */
  action: string;
  query: Record<string, string>;
  body?: string;
  cookie?: string;
  /** The caller's address, for rate limits. */
  ip?: string;
}

/** The few Redis commands used here. */
export interface Kv {
  get(key: string): Promise<string | null>;
  /** SET with optional expiry (seconds) and NX; returns false when NX found the key taken. */
  set(key: string, value: string, opts?: { ex?: number; nx?: boolean }): Promise<boolean>;
  del(...keys: string[]): Promise<void>;
  /** INCR and set the expiry on the first increment; returns the new count. */
  incr(key: string, ex: number): Promise<number>;
  persist(key: string): Promise<void>;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const SESSION_COOKIE = 'dop_session';
const SESSION_DAYS = 30;
/** One part of a snapshot: base64 text, kept well under Upstash's per-value and Vercel's body limits. */
export const MAX_PART = 900_000;
export const MAX_PARTS = 40;
const UPLOAD_TTL = 3600;
const NAME_RE = /^[a-z0-9][a-z0-9_.-]{2,31}$/;

/** Upstash's REST API (or Vercel KV, which is the same service). */
export function upstashKv(url: string, token: string, fetchFn: FetchLike): Kv {
  const call = async (cmd: (string | number)[]) => {
    const r = await fetchFn(url.replace(/\/$/, ''), { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
    const j = (await r.json().catch(() => ({}))) as { result?: unknown; error?: string };
    if (!r.ok || j.error) throw new Error(`storage error: ${j.error ?? r.status}`);
    return j.result;
  };
  return {
    async get(key) {
      const v = await call(['GET', key]);
      return typeof v === 'string' ? v : null;
    },
    async set(key, value, opts) {
      const cmd: (string | number)[] = ['SET', key, value];
      if (opts?.ex) cmd.push('EX', opts.ex);
      if (opts?.nx) cmd.push('NX');
      return (await call(cmd)) === 'OK';
    },
    async del(...keys) {
      if (keys.length) await call(['DEL', ...keys]);
    },
    async incr(key, ex) {
      const n = Number(await call(['INCR', key]));
      if (n === 1) await call(['EXPIRE', key, ex]);
      return n;
    },
    async persist(key) {
      await call(['PERSIST', key]);
    },
  };
}

/** An in-memory store, for tests and for trying accounts in `vite dev` (ACCOUNT_STORE=memory). */
export function memoryKv(): Kv {
  const m = new Map<string, { v: string; until?: number }>();
  const live = (k: string) => {
    const e = m.get(k);
    if (e && e.until && e.until < Date.now()) {
      m.delete(k);
      return undefined;
    }
    return e;
  };
  return {
    async get(k) {
      return live(k)?.v ?? null;
    },
    async set(k, v, o) {
      if (o?.nx && live(k)) return false;
      m.set(k, { v, until: o?.ex ? Date.now() + o.ex * 1000 : undefined });
      return true;
    },
    async del(...ks) {
      ks.forEach((k) => m.delete(k));
    },
    async incr(k, ex) {
      const e = live(k);
      const n = (e ? Number(e.v) : 0) + 1;
      m.set(k, { v: String(n), until: e?.until ?? Date.now() + ex * 1000 });
      return n;
    },
    async persist(k) {
      const e = live(k);
      if (e) e.until = undefined;
    },
  };
}

/** The store from the environment, or null when accounts are not set up. */
export function kvFromEnv(env: Record<string, string | undefined>, fetchFn: FetchLike): Kv | null {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return upstashKv(url, token, fetchFn);
  if (env.ACCOUNT_STORE === 'memory') return devMemory ?? (devMemory = memoryKv());
  return null;
}
let devMemory: Kv | null = null;

// ---------------------------------------------------------------- passwords and sessions

const scrypt = (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number }) =>
  new Promise<Buffer>((res, rej) => scryptCb(pw.normalize('NFKC'), salt, len, { ...opts, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));

const SCRYPT = { N: 16384, r: 8, p: 1 };

interface UserRecord {
  name: string;
  salt: string;
  hash: string;
  params: { N: number; r: number; p: number };
  createdAt: number;
}

export async function hashPassword(pw: string): Promise<Pick<UserRecord, 'salt' | 'hash' | 'params'>> {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, 64, SCRYPT);
  return { salt: salt.toString('base64'), hash: hash.toString('base64'), params: SCRYPT };
}

export async function checkPassword(pw: string, u: Pick<UserRecord, 'salt' | 'hash' | 'params'>): Promise<boolean> {
  const want = Buffer.from(u.hash, 'base64');
  const got = await scrypt(pw, Buffer.from(u.salt, 'base64'), want.length, u.params);
  return got.length === want.length && timingSafeEqual(got, want);
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function sessionCookie(token: string, maxAge: number) {
  return `${SESSION_COOKIE}=${token}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function normaliseName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const n = raw.trim().toLowerCase();
  return NAME_RE.test(n) ? n : null;
}

// ---------------------------------------------------------------- snapshots

/** What the account holds: the last complete upload. */
export interface SnapshotMeta {
  id: string;
  parts: number;
  /** Characters of base64 text, all parts together. */
  size: number;
  updatedAt: number;
  /** A label from the uploading device ("Chrome on iPhone"), for the "last synced from" line. */
  device?: string;
}

const userKey = (n: string) => `user:${n}`;
const sessKey = (t: string) => `sess:${sha(t)}`;
const snapKey = (n: string) => `snap:${n}`;
const partKey = (n: string, id: string, i: number) => `part:${n}:${id}:${i}`;

const json = (status: number, body: unknown, cookies?: string[]): AccountHttpResult => ({ status, body, cookies });

function parse(body: string | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(body ?? '{}');
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function currentUser(kv: Kv, cookie: string | undefined): Promise<string | null> {
  const t = readCookie(cookie, SESSION_COOKIE);
  if (!t || t.length > 200) return null;
  return kv.get(sessKey(t));
}

async function startSession(kv: Kv, name: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await kv.set(sessKey(token), name, { ex: SESSION_DAYS * 86400 });
  return sessionCookie(token, SESSION_DAYS * 86400);
}

async function snapshotOf(kv: Kv, name: string): Promise<SnapshotMeta | null> {
  const raw = await kv.get(snapKey(name));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SnapshotMeta;
  } catch {
    return null;
  }
}

/** Too many tries from one name or one address: wait a while. */
async function limited(kv: Kv, keys: string[], max: number): Promise<boolean> {
  let over = false;
  for (const k of keys) if ((await kv.incr(k, 900)) > max) over = true;
  return over;
}

export async function handleAccountRequest(req: AccountRequest, kv: Kv | null): Promise<AccountHttpResult> {
  const { method, action } = req;
  if (!kv) {
    if (action === 'status') return json(200, { configured: false, user: null, snapshot: null });
    return json(503, { error: 'Accounts are not set up on this site yet. Everything still works and stays in this browser.', code: 'not-configured' });
  }
  try {
    const me = await currentUser(kv, req.cookie);

    if (action === 'status' && method === 'GET') {
      return json(200, { configured: true, user: me ? { name: me } : null, snapshot: me ? await snapshotOf(kv, me) : null });
    }

    if ((action === 'register' || action === 'login') && method === 'POST') {
      const b = parse(req.body);
      const name = normaliseName(b.username);
      const pw = typeof b.password === 'string' ? b.password : '';
      if (!name) return json(400, { error: 'Usernames are 3 to 32 letters, digits, dots, dashes or underscores, starting with a letter or digit.' });
      if (pw.length < 8 || pw.length > 200) return json(400, { error: 'Passwords need at least 8 characters.' });
      if (await limited(kv, [`rl:${action}:${name}`, `rl:ip:${req.ip ?? 'unknown'}`], action === 'login' ? 10 : 20)) {
        return json(429, { error: 'Too many tries. Wait 15 minutes and try again.' });
      }
      if (action === 'register') {
        const rec: UserRecord = { name, ...(await hashPassword(pw)), createdAt: Date.now() };
        if (!(await kv.set(userKey(name), JSON.stringify(rec), { nx: true }))) return json(409, { error: 'That username is taken.' });
        return json(200, { user: { name }, snapshot: null }, [await startSession(kv, name)]);
      }
      const raw = await kv.get(userKey(name));
      const rec = raw ? (JSON.parse(raw) as UserRecord) : null;
      // The same answer for an unknown name and a wrong password.
      if (!rec || !(await checkPassword(pw, rec))) return json(401, { error: 'Wrong username or password.' });
      return json(200, { user: { name }, snapshot: await snapshotOf(kv, name) }, [await startSession(kv, name)]);
    }

    if (action === 'logout' && method === 'POST') {
      const t = readCookie(req.cookie, SESSION_COOKIE);
      if (t) await kv.del(sessKey(t));
      return json(200, { user: null }, [sessionCookie('', 0)]);
    }

    if (!me) return json(401, { error: 'Sign in first.', code: 'signed-out' });

    // Upload: parts first (each kept an hour), then a commit that makes them the account's copy.
    if (action === 'part' && method === 'PUT') {
      const b = parse(req.body);
      const id = typeof b.id === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(b.id) ? b.id : null;
      const i = Number(b.index);
      const data = typeof b.data === 'string' ? b.data : null;
      if (!id || !Number.isInteger(i) || i < 0 || i >= MAX_PARTS || !data || data.length > MAX_PART || !/^[A-Za-z0-9+/=]*$/.test(data)) return json(400, { error: 'Bad upload part.' });
      if (await limited(kv, [`rl:part:${me}`], 400)) return json(429, { error: 'Too many uploads. Wait 15 minutes and try again.' });
      await kv.set(partKey(me, id, i), data, { ex: UPLOAD_TTL });
      return json(200, { ok: true });
    }

    if (action === 'commit' && method === 'POST') {
      const b = parse(req.body);
      const id = typeof b.id === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(b.id) ? b.id : null;
      const parts = Number(b.parts);
      if (!id || !Number.isInteger(parts) || parts < 1 || parts > MAX_PARTS) return json(400, { error: 'Bad upload.' });
      let size = 0;
      for (let i = 0; i < parts; i++) {
        const p = await kv.get(partKey(me, id, i));
        if (p === null) return json(409, { error: `Part ${i + 1} of the upload is missing. Try syncing again.` });
        size += p.length;
      }
      for (let i = 0; i < parts; i++) await kv.persist(partKey(me, id, i));
      const prev = await snapshotOf(kv, me);
      const meta: SnapshotMeta = { id, parts, size, updatedAt: Date.now(), device: typeof b.device === 'string' ? b.device.slice(0, 60) : undefined };
      await kv.set(snapKey(me), JSON.stringify(meta));
      if (prev && prev.id !== id) await kv.del(...Array.from({ length: prev.parts }, (_, i) => partKey(me, prev.id, i)));
      return json(200, { snapshot: meta });
    }

    if (action === 'part' && method === 'GET') {
      const snap = await snapshotOf(kv, me);
      const i = Number(req.query.index);
      if (!snap) return json(404, { error: 'Nothing synced to this account yet.' });
      if (req.query.id !== snap.id) return json(409, { error: 'The account was synced from another device just now. Try again.', snapshot: snap });
      if (!Number.isInteger(i) || i < 0 || i >= snap.parts) return json(400, { error: 'Bad part.' });
      const data = await kv.get(partKey(me, snap.id, i));
      if (data === null) return json(409, { error: 'The account copy changed while downloading. Try again.' });
      return json(200, { index: i, data });
    }

    if (action === 'delete' && method === 'POST') {
      const b = parse(req.body);
      const raw = await kv.get(userKey(me));
      const rec = raw ? (JSON.parse(raw) as UserRecord) : null;
      if (!rec || typeof b.password !== 'string' || !(await checkPassword(b.password, rec))) return json(401, { error: 'Wrong password.' });
      const snap = await snapshotOf(kv, me);
      if (snap) await kv.del(...Array.from({ length: snap.parts }, (_, i) => partKey(me, snap.id, i)));
      await kv.del(snapKey(me), userKey(me));
      const t = readCookie(req.cookie, SESSION_COOKIE);
      if (t) await kv.del(sessKey(t));
      return json(200, { user: null }, [sessionCookie('', 0)]);
    }

    return json(404, { error: 'Unknown request.' });
  } catch (e) {
    // Never echo request bodies (they can hold a password).
    return json(502, { error: `The account storage did not answer (${(e as Error).message.slice(0, 120)}).`, code: 'storage' });
  }
}
