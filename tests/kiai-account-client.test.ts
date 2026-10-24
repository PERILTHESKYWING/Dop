import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAccountRequest, memoryKv } from '../shared/accountServer';
import { emptyDoc, record, type KiaiDoc } from '../shared/kiaiJourney';
import { createAccount, SIGNED_OUT_HERE } from '../kami/src/lib/account';

const DAY = '2026-10-20';
const T = { timeout: 30_000 };

interface Sent {
  url: string;
  init: RequestInit;
  action: string;
  body: Record<string, unknown>;
}

/** A fetch that answers from Dop's real handler and a memory store, or as `override` says. */
function fakeServer() {
  const kv = memoryKv();
  const sent: Sent[] = [];
  let override: ((s: Sent) => Promise<Response> | Response | null) | null = null;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    const action = new URL(url, 'http://x').searchParams.get('action') ?? '';
    const s: Sent = { url, init, action, body: JSON.parse(String(init.body ?? '{}')) };
    sent.push(s);
    const o = override?.(s);
    if (o) return o;
    const r = await handleAccountRequest({ method: String(init.method), action, query: {}, body: String(init.body), ip: '9.9.9.9' }, kv);
    return { status: r.status, json: async () => r.body } as Response;
  }) as unknown as typeof globalThis.fetch;
  return {
    kv,
    sent,
    fetch: fakeFetch,
    setOverride(f: typeof override) {
      override = f;
    },
  };
}

function mapStorage() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

/** A local doc store with change listeners, as journey.ts + settings.ts provide. */
function localDoc(start: KiaiDoc = emptyDoc()) {
  let doc = start;
  const subs = new Set<() => void>();
  return {
    get: () => doc,
    apply: (d: KiaiDoc) => {
      doc = d;
    },
    onChange: (cb: () => void) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    /** Study on this device: a change the account should push. */
    study(device: string) {
      doc = { ...doc, journey: record(doc.journey, device, DAY, 'ask').journey };
      for (const s of subs) s();
    },
  };
}

function events() {
  const subs: Record<string, (() => void)[]> = { online: [], hidden: [] };
  return {
    on: (e: 'online' | 'hidden', cb: () => void) => {
      subs[e].push(cb);
      return () => {};
    },
    fire: (e: 'online' | 'hidden') => subs[e].forEach((f) => f()),
  };
}

function setup(over: { storage?: ReturnType<typeof mapStorage>; server?: ReturnType<typeof fakeServer>; doc?: ReturnType<typeof localDoc> } = {}) {
  const server = over.server ?? fakeServer();
  const storage = over.storage ?? mapStorage();
  const doc = over.doc ?? localDoc();
  const ev = events();
  const acct = createAccount({ fetch: server.fetch, storage, now: () => Date.now(), doc, api: '/api/account', on: ev.on });
  return { server, storage, doc, ev, acct };
}

/** Let pending promises (and the handler's scrypt) settle. */
const settle = async (ms = 0) => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  if (ms) await vi.advanceTimersByTimeAsync(ms);
};
const waitFor = async (f: () => boolean) => {
  for (let i = 0; i < 400 && !f(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(f()).toBe(true);
};

describe('the probe', () => {
  it('shows nothing for HTML, a timeout or the wrong service', async () => {
    const cases: ((s: Sent) => Response)[] = [
      () => ({ status: 200, json: async () => JSON.parse('<!doctype html>') }) as Response,
      () => {
        throw new DOMException('timed out', 'TimeoutError');
      },
      () => ({ status: 200, json: async () => ({ service: 'something-else', kiai: 1, configured: true }) }) as Response,
      () => ({ status: 200, json: async () => ({ configured: true }) }) as Response,
    ];
    for (const c of cases) {
      const { server, acct } = setup();
      server.setOverride(c);
      acct.start();
      await waitFor(() => acct.view().available !== null);
      expect(acct.view().available).toBe(false);
    }
  });

  it('shows the account when the service answers, and caches only a real "not set up"', async () => {
    const ok = setup();
    ok.acct.start();
    await waitFor(() => ok.acct.view().available !== null);
    expect(ok.acct.view().available).toBe(true);

    const storage = mapStorage();
    const off = setup({ storage });
    off.server.setOverride(() => ({ status: 200, json: async () => ({ service: 'dop-account', kiai: 1, configured: false }) }) as Response);
    off.acct.start();
    await waitFor(() => off.acct.view().available !== null);
    expect(off.acct.view().available).toBe(false);
    const again = setup({ storage });
    again.acct.start();
    await waitFor(() => again.acct.view().available !== null);
    expect(again.server.sent).toHaveLength(0);

    const offline = mapStorage();
    const a = setup({ storage: offline });
    a.server.setOverride(() => {
      throw new TypeError('Failed to fetch');
    });
    a.acct.start();
    await waitFor(() => a.acct.view().available !== null);
    const b = setup({ storage: offline });
    b.acct.start();
    await waitFor(() => b.acct.view().available !== null);
    expect(b.server.sent.map((s) => s.action)).toEqual(['kiai-status']);
    expect(b.acct.view().available).toBe(true);
  });
});

describe('signing in and syncing', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('merges the guest path into the account and pushes a change once after the debounce', T, async () => {
    const server = fakeServer();
    // Another device already synced to the account.
    const other = setup({ server });
    await other.acct.register('xiao@example.com', 'long enough pw');
    other.doc.study('deviceother1');
    await other.acct.syncNow();

    const guest = localDoc();
    guest.study('devicephone1');
    const me = setup({ server, doc: guest });
    me.acct.start();
    await settle();
    await me.acct.login('xiao@example.com', 'long enough pw');
    await settle();
    expect(Object.keys(me.doc.get().journey.dev).sort()).toEqual(['deviceother1', 'devicephone1']);
    expect(me.acct.view()).toMatchObject({ signedIn: true, email: 'xiao@example.com' });

    const before = server.sent.filter((s) => s.action === 'kiai-sync').length;
    me.doc.study('devicephone1');
    await settle(29_000);
    expect(server.sent.filter((s) => s.action === 'kiai-sync').length).toBe(before);
    await settle(32_000);
    expect(server.sent.filter((s) => s.action === 'kiai-sync').length).toBe(before + 1);
    // The server has the union of both devices.
    await other.acct.syncNow();
    expect(other.doc.get().journey.dev.devicephone1[DAY][1]).toBe(2);
  });

  it('drops the session on 401 and keeps the local path', T, async () => {
    const { acct, doc, server, storage } = setup();
    await acct.register('a@example.com', 'long enough pw');
    doc.study('devicephone1');
    const kept = JSON.stringify(doc.get());
    server.setOverride((s) => (s.action === 'kiai-sync' ? ({ status: 401, json: async () => ({ code: 'signed-out', error: 'x' }) } as Response) : null));
    await acct.syncNow();
    expect(acct.view()).toMatchObject({ signedIn: false, error: SIGNED_OUT_HERE });
    expect(storage.m.has('kiai.session')).toBe(false);
    expect(JSON.stringify(doc.get())).toBe(kept);
  });

  it('keeps a change through a network error and retries when back online', T, async () => {
    const { acct, doc, server, ev } = setup();
    acct.start();
    await settle();
    await acct.register('b@example.com', 'long enough pw');
    server.setOverride(() => {
      throw new TypeError('Failed to fetch');
    });
    doc.study('devicephone1');
    await settle(61_000);
    expect(acct.view().error).toMatch(/Not synced yet/);
    server.setOverride(null);
    ev.fire('online');
    await settle();
    await vi.waitFor(() => expect(acct.view().error).toBeNull());
    const stored = JSON.parse((await server.kv.get(server.kv.entries().find(([k]) => k.startsWith('kiai:'))![0]))!);
    expect(stored.doc.journey.dev.devicephone1[DAY][1]).toBe(1);
  });

  it('sends only simple CORS requests: POST, text/plain, no cookies, no authorization', T, async () => {
    const { acct, server, doc } = setup();
    acct.start();
    await settle();
    await acct.register('c@example.com', 'long enough pw');
    doc.study('devicephone1');
    await acct.syncNow();
    await acct.logout(true);
    expect(doc.get().journey.dev).toEqual({});
    expect(server.sent.length).toBeGreaterThanOrEqual(4);
    for (const s of server.sent) {
      expect(s.init.method).toBe('POST');
      expect(s.init.credentials).toBe('omit');
      const h = s.init.headers as Record<string, string>;
      expect(Object.keys(h)).toEqual(['content-type']);
      expect(h['content-type']).toBe('text/plain;charset=UTF-8');
      expect(s.url).toMatch(/^\/api\/account\?action=kiai-/);
    }
  });
});
