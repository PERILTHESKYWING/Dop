import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { handleAccountRequest, memoryKv, normaliseName, SCRYPT } from '../shared/accountServer';
import { emailId, kiaiCors, normaliseCode, normaliseEmail } from '../shared/kiaiAccount';
import { addDays, emptyDoc, record, type KiaiDoc } from '../shared/kiaiJourney';

type Kv = ReturnType<typeof memoryKv>;
const call = (kv: Kv | null, action: string, body?: unknown, method = 'POST', ip = '1.2.3.4') =>
  handleAccountRequest({ method, action, query: {}, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), ip }, kv);
const B = (r: { body: unknown }) => r.body as Record<string, unknown>;

const EMAIL = 'Xiao@Example.com';
const PW = 'correct horse battery';
const T = { timeout: 30_000 };

const docWith = (device: string, day: string, n: number): KiaiDoc => {
  let j = emptyDoc().journey;
  for (let i = 0; i < n; i++) j = record(j, device, day, 'ask').journey;
  return { v: 1, journey: j, settings: {} };
};

describe('kiai account: status and identity', () => {
  it('answers the probe with and without a store, by GET too', async () => {
    expect(B(await call(null, 'kiai-status', {}))).toEqual({ service: 'dop-account', kiai: 1, configured: false });
    expect(B(await call(memoryKv(), 'kiai-status', {}))).toEqual({ service: 'dop-account', kiai: 1, configured: true });
    expect((await call(memoryKv(), 'kiai-status', undefined, 'GET')).status).toBe(200);
    expect((await call(memoryKv(), 'kiai-login', {}, 'GET')).status).toBe(405);
    const off = await call(null, 'kiai-login', { email: EMAIL, password: PW });
    expect(off.status).toBe(503);
    expect(B(off).code).toBe('not-configured');
  });

  it('normalises emails and never lets an email id pass as a Dop name', () => {
    expect(normaliseEmail('  Xiao@Example.COM ')).toBe('xiao@example.com');
    expect(normaliseEmail('x.y+go@gmail.com')).toBe('x.y+go@gmail.com');
    expect(normaliseEmail('no-at-sign')).toBeNull();
    expect(normaliseEmail('a@b.c')).toBeNull();
    expect(normaliseEmail('x'.repeat(65) + '@example.com')).toBeNull();
    const id = emailId('xiao@example.com');
    expect(id).toMatch(/^@[0-9a-f]{32}$/);
    expect(normaliseName(id)).toBeNull();
    expect(normaliseCode('k7qm2 9xhtr-4wpza-6ndje')).toBe('K7QM29XHTR4WPZA6NDJE');
    expect(normaliseCode('O0-Il')).toBe('0011');
  });
});

describe('kiai account: register and sign in', () => {
  it(
    'registers with a recovery code and stores no email, password or code',
    T,
    async () => {
      const kv = memoryKv();
      const r = await call(kv, 'kiai-register', { email: EMAIL, password: PW });
      expect(r.status).toBe(200);
      const b = B(r);
      expect(b.recovery).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
      expect(typeof b.token).toBe('string');
      expect(b).toMatchObject({ doc: null, at: null });
      const code = String(b.recovery);
      for (const [k, v] of kv.entries()) {
        for (const secret of [EMAIL, EMAIL.toLowerCase(), PW, code, normaliseCode(code), String(b.token)]) {
          expect(k).not.toContain(secret);
          expect(v).not.toContain(secret);
        }
      }
      const dup = await call(kv, 'kiai-register', { email: '  xiao@EXAMPLE.com ', password: 'another password' });
      expect(dup.status).toBe(409);
      expect(B(dup)).toMatchObject({ code: 'taken', error: 'An account with this email already exists. Sign in instead.' });
      expect((await call(kv, 'kiai-register', { email: 'nope', password: PW })).status).toBe(400);
      expect(B(await call(kv, 'kiai-register', { email: 'a@example.com', password: 'short' })).error).toBe('Passwords need at least 8 characters.');
    },
  );

  it(
    'gives the same answer for a wrong password and an unknown email, and limits tries',
    T,
    async () => {
      const kv = memoryKv();
      await call(kv, 'kiai-register', { email: EMAIL, password: PW });
      const wrong = await call(kv, 'kiai-login', { email: EMAIL, password: 'wrong password' });
      const unknown = await call(kv, 'kiai-login', { email: 'nobody@example.com', password: 'wrong password' });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(B(wrong)).toEqual(B(unknown));
      expect(B(wrong).error).toBe('Wrong email or password.');
      const ok = await call(kv, 'kiai-login', { email: 'xiao@example.com', password: PW });
      expect(ok.status).toBe(200);
      let last = 0;
      for (let i = 0; i < 9; i++) last = (await call(kv, 'kiai-login', { email: EMAIL, password: 'wrong password' })).status;
      // Ten tries so far for this email (wrong, ok and 8 more wrong); the eleventh is refused.
      expect(last).toBe(429);
      expect(B(await call(kv, 'kiai-login', { email: EMAIL, password: PW })).error).toBe('Too many tries. Wait 15 minutes and try again.');
    },
  );
});

describe('kiai account: sync', () => {
  it(
    'merges two devices into the union, and refuses bad tokens, big docs and junk',
    T,
    async () => {
      const kv = memoryKv();
      const t1 = String(B(await call(kv, 'kiai-register', { email: EMAIL, password: PW })).token);
      const t2 = String(B(await call(kv, 'kiai-login', { email: EMAIL, password: PW })).token);
      const day = '2026-10-20';
      const a = await call(kv, 'kiai-sync', { token: t1, doc: docWith('deviceaaaaaa', day, 2) });
      expect(a.status).toBe(200);
      const b = await call(kv, 'kiai-sync', { token: t2, doc: docWith('devicebbbbbb', day, 3) });
      const merged = B(b).doc as KiaiDoc;
      expect(Object.keys(merged.journey.dev)).toEqual(['deviceaaaaaa', 'devicebbbbbb']);
      const back = B(await call(kv, 'kiai-sync', { token: t1 })).doc as KiaiDoc;
      expect(back).toEqual(merged);
      // Login hands the doc back.
      expect(B(await call(kv, 'kiai-login', { email: EMAIL, password: PW })).doc).toEqual(merged);

      const bad = await call(kv, 'kiai-sync', { token: 'not-a-token', doc: emptyDoc() });
      expect(bad.status).toBe(401);
      expect(B(bad).code).toBe('signed-out');
      expect((await call(kv, 'kiai-sync', { token: t1, doc: { v: 1, journey: 'junk' } })).status).toBe(400);

      // 20 devices with 650 days each: over 256,000 characters.
      const big: KiaiDoc = { v: 1, journey: { v: 1, gen: 0, dev: {}, seen: {} }, settings: {} };
      for (let d = 0; d < 20; d++) {
        const days: Record<string, [number, number, number, number, number]> = {};
        for (let i = 0; i < 650; i++) days[addDays('2020-01-01', i)] = [1, 1, 0, 0, 0];
        big.journey.dev[`devicebig${String(d).padStart(3, '0')}`] = days;
      }
      const tooBig = await call(kv, 'kiai-sync', { token: t1, doc: big });
      expect(tooBig.status).toBe(413);
      expect(B(tooBig).code).toBe('too-big');
    },
  );

  it(
    'keeps Kiai tokens away from Dop snapshots',
    T,
    async () => {
      const kv = memoryKv();
      const t = String(B(await call(kv, 'kiai-register', { email: EMAIL, password: PW })).token);
      expect((await handleAccountRequest({ method: 'PUT', action: 'part', query: {}, body: JSON.stringify({ token: t, id: 'upload0001', index: 0, data: 'AAAA' }) }, kv)).status).toBe(401);
      expect((await handleAccountRequest({ method: 'POST', action: 'commit', query: {}, body: JSON.stringify({ id: 'upload0001', parts: 1 }), cookie: `dop_session=${t}` }, kv)).status).toBe(401);
    },
  );
});

describe('kiai account: recovery, password, delete', () => {
  it(
    'resets the password with the recovery code, revokes old sessions and issues a new code',
    T,
    async () => {
      const kv = memoryKv();
      const reg = B(await call(kv, 'kiai-register', { email: EMAIL, password: PW }));
      const old = String(reg.token);
      const code = String(reg.recovery);
      const typed = code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'I');
      const r = await call(kv, 'kiai-recover', { email: EMAIL, code: typed, newPassword: 'a brand new password' });
      expect(r.status).toBe(200);
      expect(B(r).recovery).not.toBe(code);
      expect((await call(kv, 'kiai-sync', { token: old })).status).toBe(401);
      expect((await call(kv, 'kiai-sync', { token: String(B(r).token) })).status).toBe(200);
      const again = await call(kv, 'kiai-recover', { email: EMAIL, code, newPassword: 'yet another password' });
      expect(again.status).toBe(401);
      expect(B(again).error).toBe("That email and recovery code don't match.");
      expect((await call(kv, 'kiai-login', { email: EMAIL, password: PW })).status).toBe(401);
      expect((await call(kv, 'kiai-login', { email: EMAIL, password: 'a brand new password' })).status).toBe(200);
    },
  );

  it(
    'changes the password (other sessions end), needs the password for a new code and to delete',
    T,
    async () => {
      const kv = memoryKv();
      const t1 = String(B(await call(kv, 'kiai-register', { email: EMAIL, password: PW })).token);
      const t2 = String(B(await call(kv, 'kiai-login', { email: EMAIL, password: PW })).token);
      expect((await call(kv, 'kiai-password', { token: t1, password: 'wrong password', newPassword: 'new password 1' })).status).toBe(401);
      const ch = await call(kv, 'kiai-password', { token: t1, password: PW, newPassword: 'new password 1' });
      expect(ch.status).toBe(200);
      const t3 = String(B(ch).token);
      expect((await call(kv, 'kiai-sync', { token: t2 })).status).toBe(401);
      expect((await call(kv, 'kiai-sync', { token: t1 })).status).toBe(401);
      expect((await call(kv, 'kiai-sync', { token: t3 })).status).toBe(200);

      expect((await call(kv, 'kiai-recovery', { token: t3, password: PW })).status).toBe(401);
      const code = await call(kv, 'kiai-recovery', { token: t3, password: 'new password 1' });
      expect(B(code).recovery).toMatch(/^\w{5}-\w{5}-\w{5}-\w{5}$/);

      expect((await call(kv, 'kiai-delete', { token: t3, password: 'wrong password' })).status).toBe(401);
      expect((await call(kv, 'kiai-delete', { token: t3, password: 'new password 1' })).status).toBe(200);
      const left = kv.entries().map(([k]) => k).filter((k) => /^(user:|kiai:|ksess:|ksessions:)/.test(k));
      expect(left).toEqual([]);
      expect((await call(kv, 'kiai-logout', { token: t3 })).status).toBe(200);
      expect((await call(kv, 'kiai-logout', { token: 'unknown' })).status).toBe(200);
    },
  );

  it(
    'still signs in a record hashed with the old p:1 and rehashes it',
    T,
    async () => {
      const kv = memoryKv();
      const id = emailId('old@example.com');
      const salt = randomBytes(16);
      const params = { N: 16384, r: 8, p: 1 };
      const hash = scryptSync(PW.normalize('NFKC'), salt, 64, { ...params, maxmem: 64 * 1024 * 1024 });
      const rc = createHash('sha256').update('0000000000').digest('hex');
      await kv.set(`user:${id}`, JSON.stringify({ name: id, salt: salt.toString('base64'), hash: hash.toString('base64'), params, createdAt: 1, kind: 'email', rc, rcAt: 1 }));
      expect((await call(kv, 'kiai-login', { email: 'old@example.com', password: PW })).status).toBe(200);
      expect(JSON.parse((await kv.get(`user:${id}`))!).params).toEqual(SCRYPT);
      expect(SCRYPT).toEqual({ N: 16384, r: 8, p: 5 });
      expect((await call(kv, 'kiai-login', { email: 'old@example.com', password: PW })).status).toBe(200);
    },
  );
});

describe('kiaiCors', () => {
  it('allows Kiai sites and listed origins, refuses the rest, never credentials', () => {
    for (const o of ['https://kami-abc-periltheskywing.vercel.app', 'https://kami-ten.vercel.app', 'https://kiai.vercel.app', 'http://localhost:5174', 'http://127.0.0.1:4174']) {
      const h = kiaiCors(o, 'kiai-sync');
      expect(h['access-control-allow-origin']).toBe(o);
      expect(h.vary).toBe('Origin');
      expect(Object.keys(h).some((k) => /credentials/i.test(k))).toBe(false);
    }
    expect(kiaiCors('https://go.example.org', 'kiai-sync', 'https://go.example.org, https://other.example')['access-control-allow-origin']).toBe('https://go.example.org');
    expect(kiaiCors('https://evil.example', 'kiai-sync')).toEqual({});
    expect(kiaiCors('https://kamix.vercel.app.evil.com', 'kiai-sync')).toEqual({});
    expect(kiaiCors('https://kami-abc.vercel.app', 'login')).toEqual({});
    expect(kiaiCors(undefined, 'kiai-sync')).toEqual({});
  });
});
