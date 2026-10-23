/**
 * Kiai accounts on Dop's /api/account (actions `kiai-…`): email + password, a recovery code
 * instead of email resets, and one small synced document (the study path and a few settings).
 *
 * Kiai lives on another vercel.app site, which is cross-site to Dop, so there are no cookies:
 * the session is a bearer token sent in the JSON body, and every call is a CORS "simple request"
 * (POST, text/plain, no custom headers), so no preflight. The server keeps only a SHA-256
 * fingerprint of the email (`'@' + sha256('kiai-email-v1:' + email)`), never the address,
 * because no email is ever sent. Kiai tokens use their own `ksess:` keys, so they can never read
 * or write Dop's snapshots.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  checkPassword,
  hashPassword,
  json,
  limited,
  needsRehash,
  parseBody,
  SCRYPT,
  type AccountHttpResult,
  type AccountRequest,
  type Kv,
  type UserRecord,
} from './accountServer.js';
import { emptyDoc, LIMITS, mergeDoc, sanitizeDoc, type KiaiDoc } from './kiaiJourney.js';

/** Kiai's sites: production and preview aliases on vercel.app, and local dev. */
export const KIAI_ORIGIN = /^https:\/\/(?:kami|kiai)(?:-[a-z0-9-]+)?\.vercel\.app$|^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;

/**
 * Headers for a Kiai call from `origin`; {} for other actions or origins. `extra`: optional env
 * ACCOUNT_ORIGINS, comma-separated exact origins (a custom domain later). Never allows
 * credentials: Kiai sends no cookies. This is not the security boundary (anyone can curl the
 * API); it only stops random pages using Dop's store from their visitors' browsers.
 */
export function kiaiCors(origin: string | undefined, action: string, extra = ''): Record<string, string> {
  if (!origin || !action.startsWith('kiai-')) return {};
  const listed = extra
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!KIAI_ORIGIN.test(origin) && !listed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    vary: 'Origin',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '7200',
  };
}

export const KIAI_ERRORS = {
  email: 'Enter an email address like name@example.com.',
  password: 'Passwords need at least 8 characters.',
  taken: 'An account with this email already exists. Sign in instead.',
  wrong: 'Wrong email or password.',
  wrongPassword: 'Wrong password.',
  recover: "That email and recovery code don't match.",
  limited: 'Too many tries. Wait 15 minutes and try again.',
  signedOut: 'Signed out. Sign in again to keep syncing.',
  tooBig: 'Your path is too large to sync (over 256 KB).',
  badDoc: 'That path could not be read.',
  notConfigured: 'Sync is not set up on the server. Everything still works on this device.',
  storage: 'The sync storage did not answer. Try again later.',
  method: 'Use POST.',
  unknown: 'Unknown request.',
} as const;

type Code = 'bad' | 'taken' | 'wrong' | 'signed-out' | 'limited' | 'too-big' | 'not-configured' | 'storage';
const fail = (status: number, error: string, code?: Code) => json(status, code ? { error, code } : { error });

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const SESSION_DAYS = 60;
const MAX_SESSIONS = 10;

/** An email as Kiai compares it, or null. No Gmail dot or plus folding: those are different addresses. */
export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().normalize('NFKC').toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return null;
  if (e.slice(0, e.lastIndexOf('@')).length > 64) return null;
  return e;
}

/** The account id for an email: '@' can never start a Dop username, so the two cannot collide. */
export const emailId = (email: string) => '@' + sha('kiai-email-v1:' + email).slice(0, 32);

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A new recovery code: 20 Crockford base32 characters (100 bits), shown XXXXX-XXXXX-XXXXX-XXXXX. */
export function newRecoveryCode(): string {
  const b = randomBytes(20);
  let s = '';
  for (let i = 0; i < 20; i++) s += CROCKFORD[b[i] & 31];
  return s.match(/.{5}/g)!.join('-');
}

/** A typed code as stored: uppercase, only [0-9A-Z], O→0, I→1, L→1. */
export function normaliseCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

interface KiaiUser extends UserRecord {
  kind: 'email';
  /** sha256 of the normalised recovery code. */
  rc: string;
  rcAt: number;
}

/**
 * A fixed record so an unknown email costs the same scrypt time as a wrong password. A function,
 * not a constant: accountServer.ts and this file import each other, so SCRYPT is read at call time.
 */
const dummy = (): Pick<UserRecord, 'salt' | 'hash' | 'params'> => ({
  salt: Buffer.alloc(16, 7).toString('base64'),
  hash: Buffer.alloc(64, 1).toString('base64'),
  params: SCRYPT,
});

const userKey = (id: string) => `user:${id}`;
const docKey = (id: string) => `kiai:${id}`;
const listKey = (id: string) => `ksessions:${id}`;
const sessKey = (hash: string) => `ksess:${hash}`;
const today = () => new Date().toISOString().slice(0, 10);

function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

function readJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function getUser(kv: Kv, id: string): Promise<KiaiUser | null> {
  return readJson<KiaiUser>(await kv.get(userKey(id)));
}

async function sessionList(kv: Kv, id: string): Promise<string[]> {
  const l = readJson<unknown>(await kv.get(listKey(id)));
  return Array.isArray(l) ? l.filter((x): x is string => typeof x === 'string') : [];
}

async function startSession(kv: Kv, id: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const h = sha(token);
  await kv.set(sessKey(h), `${id}|${today()}`, { ex: SESSION_DAYS * 86400 });
  const list = [...(await sessionList(kv, id)), h];
  const drop = list.length > MAX_SESSIONS ? list.splice(0, list.length - MAX_SESSIONS) : [];
  if (drop.length) await kv.del(...drop.map(sessKey));
  await kv.set(listKey(id), JSON.stringify(list));
  return token;
}

async function revokeAll(kv: Kv, id: string): Promise<void> {
  const list = await sessionList(kv, id);
  await kv.del(...list.map(sessKey), listKey(id));
}

async function auth(kv: Kv, token: unknown): Promise<{ id: string; day: string; hash: string } | null> {
  if (typeof token !== 'string' || !token || token.length > 200) return null;
  const hash = sha(token);
  const v = await kv.get(sessKey(hash));
  if (!v) return null;
  const [id, day] = v.split('|');
  return id ? { id, day: day ?? '', hash } : null;
}

async function storedDoc(kv: Kv, id: string): Promise<{ doc: KiaiDoc | null; at: number | null }> {
  const s = readJson<{ at?: unknown; doc?: unknown }>(await kv.get(docKey(id)));
  const doc = s ? sanitizeDoc(s.doc) : null;
  return { doc, at: doc && typeof s?.at === 'number' ? s.at : null };
}

const passwordOk = (pw: unknown): pw is string => typeof pw === 'string' && pw.length >= 8 && pw.length <= 200;

async function newCode(kv: Kv, rec: KiaiUser): Promise<string> {
  const code = newRecoveryCode();
  await kv.set(userKey(rec.name), JSON.stringify({ ...rec, rc: sha(normaliseCode(code)), rcAt: Date.now() }));
  return code;
}

/** Every `kiai-…` action (see the table in docs/handoff/kami.md, "Account and path"). */
export async function handleKiaiRequest(req: AccountRequest, kv: Kv | null): Promise<AccountHttpResult> {
  const { action, method } = req;
  if (action === 'kiai-status') {
    if (method !== 'GET' && method !== 'POST') return fail(405, KIAI_ERRORS.method);
    return json(200, { service: 'dop-account', kiai: 1, configured: !!kv });
  }
  if (method !== 'POST') return fail(405, KIAI_ERRORS.method);
  if (!kv) return fail(503, KIAI_ERRORS.notConfigured, 'not-configured');
  const ip = req.ip ?? 'unknown';
  try {
    const b = parseBody(req.body);

    if (action === 'kiai-register' || action === 'kiai-login') {
      const email = normaliseEmail(b.email);
      if (!email) return fail(400, KIAI_ERRORS.email, 'bad');
      if (!passwordOk(b.password)) return fail(400, KIAI_ERRORS.password, 'bad');
      const id = emailId(email);
      if (action === 'kiai-register') {
        if ((await limited(kv, [`rl:kreg:ip:${ip}`], 10)) || (await limited(kv, ['rl:kreg:all'], 200))) return fail(429, KIAI_ERRORS.limited, 'limited');
        const code = newRecoveryCode();
        const rec: KiaiUser = { name: id, ...(await hashPassword(b.password)), createdAt: Date.now(), kind: 'email', rc: sha(normaliseCode(code)), rcAt: Date.now() };
        if (!(await kv.set(userKey(id), JSON.stringify(rec), { nx: true }))) return fail(409, KIAI_ERRORS.taken, 'taken');
        return json(200, { token: await startSession(kv, id), recovery: code, doc: null, at: null });
      }
      if ((await limited(kv, [`rl:klogin:${id}`], 10)) || (await limited(kv, [`rl:klogin:ip:${ip}`], 30))) return fail(429, KIAI_ERRORS.limited, 'limited');
      const rec = await getUser(kv, id);
      // The same answer and about the same time for an unknown email and a wrong password.
      const ok = await checkPassword(b.password, rec ?? dummy());
      if (!rec || !ok) return fail(401, KIAI_ERRORS.wrong, 'wrong');
      if (needsRehash(rec)) await kv.set(userKey(id), JSON.stringify({ ...rec, ...(await hashPassword(b.password)) }));
      const { doc, at } = await storedDoc(kv, id);
      return json(200, { token: await startSession(kv, id), doc, at });
    }

    if (action === 'kiai-recover') {
      const email = normaliseEmail(b.email);
      if (!email) return fail(400, KIAI_ERRORS.email, 'bad');
      if (!passwordOk(b.newPassword)) return fail(400, KIAI_ERRORS.password, 'bad');
      const id = emailId(email);
      if ((await limited(kv, [`rl:krec:${id}`], 5)) || (await limited(kv, [`rl:krec:ip:${ip}`], 10))) return fail(429, KIAI_ERRORS.limited, 'limited');
      const rec = await getUser(kv, id);
      const typed = sha(normaliseCode(b.code));
      const match = sameHex(typed, rec?.rc ?? sha('no account'));
      if (!rec || !match) return fail(401, KIAI_ERRORS.recover, 'wrong');
      await revokeAll(kv, id);
      const fresh: KiaiUser = { ...rec, ...(await hashPassword(b.newPassword)) };
      const recovery = await newCode(kv, fresh);
      const { doc, at } = await storedDoc(kv, id);
      return json(200, { token: await startSession(kv, id), recovery, doc, at });
    }

    if (action === 'kiai-logout') {
      const s = await auth(kv, b.token);
      if (s) {
        await kv.del(sessKey(s.hash));
        const list = (await sessionList(kv, s.id)).filter((h) => h !== s.hash);
        await kv.set(listKey(s.id), JSON.stringify(list));
      }
      return json(200, { ok: true });
    }

    const s = await auth(kv, b.token);
    if (!s) return fail(401, KIAI_ERRORS.signedOut, 'signed-out');

    if (action === 'kiai-sync') {
      if (await limited(kv, [`rl:ksync:${s.id}`], 200)) return fail(429, KIAI_ERRORS.limited, 'limited');
      let incoming: KiaiDoc | null = null;
      if (b.doc !== undefined && b.doc !== null) {
        incoming = sanitizeDoc(b.doc);
        if (!incoming) return fail(400, KIAI_ERRORS.badDoc, 'bad');
      }
      const prev = await storedDoc(kv, s.id);
      const stored = prev.doc ?? emptyDoc();
      const merged = incoming ? mergeDoc(stored, incoming) : stored;
      const text = JSON.stringify(merged);
      if (text.length > LIMITS.docChars) return fail(413, KIAI_ERRORS.tooBig, 'too-big');
      let at = prev.at ?? Date.now();
      if (!prev.doc || text !== JSON.stringify(stored)) {
        at = Date.now();
        await kv.set(docKey(s.id), JSON.stringify({ at, doc: merged }));
      }
      // Sliding sessions: stay signed in while Kiai is opened within 60 days.
      if (s.day !== today()) await kv.set(sessKey(s.hash), `${s.id}|${today()}`, { ex: SESSION_DAYS * 86400 });
      return json(200, { doc: merged, at });
    }

    const rec = await getUser(kv, s.id);
    if (!rec) return fail(401, KIAI_ERRORS.signedOut, 'signed-out');
    const pwRight = async () => typeof b.password === 'string' && b.password.length <= 200 && (await checkPassword(b.password, rec));

    if (action === 'kiai-password') {
      if (!passwordOk(b.newPassword)) return fail(400, KIAI_ERRORS.password, 'bad');
      if (await limited(kv, [`rl:klogin:${s.id}`], 10)) return fail(429, KIAI_ERRORS.limited, 'limited');
      if (!(await pwRight())) return fail(401, KIAI_ERRORS.wrongPassword, 'wrong');
      await kv.set(userKey(s.id), JSON.stringify({ ...rec, ...(await hashPassword(b.newPassword)) }));
      await revokeAll(kv, s.id);
      return json(200, { token: await startSession(kv, s.id) });
    }

    if (action === 'kiai-recovery') {
      if (await limited(kv, [`rl:klogin:${s.id}`], 10)) return fail(429, KIAI_ERRORS.limited, 'limited');
      if (!(await pwRight())) return fail(401, KIAI_ERRORS.wrongPassword, 'wrong');
      return json(200, { recovery: await newCode(kv, rec) });
    }

    if (action === 'kiai-delete') {
      if (await limited(kv, [`rl:klogin:${s.id}`], 10)) return fail(429, KIAI_ERRORS.limited, 'limited');
      if (!(await pwRight())) return fail(401, KIAI_ERRORS.wrongPassword, 'wrong');
      await revokeAll(kv, s.id);
      await kv.del(userKey(s.id), docKey(s.id), sessKey(s.hash));
      return json(200, { ok: true });
    }

    return fail(404, KIAI_ERRORS.unknown);
  } catch {
    // Never echo the request (it can hold a password) or the storage error text.
    return fail(502, KIAI_ERRORS.storage, 'storage');
  }
}
