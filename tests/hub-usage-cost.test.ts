// The page's 5-minute usage read (op=usage) is cheap on Upstash: one command
// while no account is due, and a handful (not ~32) when Claude is asked.
import { describe, expect, it } from 'vitest';

const lib = (p: string) => import(/* @vite-ignore */ `../hub/lib/${p}` as string) as Promise<any>;

let clock = Date.parse('2026-10-20T09:00:00Z');
let asked = 0;
const fakeFetch = async (url: string, init: any) => {
  if (!url.endsWith('/api/oauth/usage')) throw new Error('unexpected fetch ' + url);
  asked++;
  const good = String(init.headers.authorization).includes('good');
  return new Response(JSON.stringify(good ? { five_hour: { utilization: 30 }, seven_day: { utilization: 20 } } : { error: { message: 'no' } }), { status: good ? 200 : 401 });
};
const PW = 'pw';

async function setup() {
  const { createHub } = await lib('hub.js');
  const { memoryStore } = await lib('store.js');
  const { pageApi } = await lib('api.js');
  const inner = memoryStore();
  const counter = { n: 0, writes: [] as string[] };
  const store = {
    cmd: (...a: any[]) => (counter.n++, counter.writes.push(String(a[0])), inner.cmd(...a)),
    multi: (c: any[]) => ((counter.n += c.length), c.forEach((x) => counter.writes.push(String(x[0]))), inner.multi(c)),
  };
  const h = createHub({ store, fetchImpl: fakeFetch, now: () => clock });
  // Three paid accounts (Claude answers one, refuses one, one has no token) and a free one.
  await h.upsertAccount({ name: 'Main', plan: 'max', routines: [{ model: 'opus', id: 'trig_m', token: 'good-m' }] });
  await h.upsertAccount({ name: 'Alt', plan: 'pro', routines: [{ model: 'opus', id: 'trig_a', token: 'bad-a' }] });
  await h.upsertAccount({ name: 'Bare', plan: 'pro' });
  await h.upsertAccount({ name: 'Free', plan: 'free' });
  for (const n of ['Main', 'Alt', 'Bare', 'Free']) await h.markConnected(await h.account(n));
  const usage = async (force = false) => {
    counter.n = 0; counter.writes = [];
    const r = await pageApi({ hub: h, password: PW, method: 'GET', query: { op: 'usage', ...(force ? { force: '1' } : {}) }, body: {}, headers: { 'x-hub-password': PW } });
    expect(r.status).toBe(200);
    return { n: counter.n, writes: counter.writes, body: r.body };
  };
  return { h, usage };
}

describe('hub usage read cost', () => {
  it('costs one command while nothing is due, and few when Claude is asked', async () => {
    const { h, usage } = await setup();
    asked = 0;
    const first = await usage();
    expect(asked).toBe(2); // Main and Alt; Bare has no token, so it is not fetched
    expect(first.n).toBeLessThanOrEqual(12);
    expect((await h.account('Main')).usage).toMatchObject({ five_hour_pct: 30, seven_day_pct: 20, source: 'claude' });
    expect((await h.account('Alt')).usageErr).toContain('401');
    expect((await h.account('Bare')).usageErr).toContain('no routine');
    expect((await h.connLog()).filter((e: any) => e.http === 'USAGE').length).toBe(3);

    // A minute later, another tab: nothing is due.
    clock += 60_000;
    asked = 0;
    const quiet = await usage();
    expect(quiet.n).toBe(1);
    expect(asked).toBe(0);
    expect(quiet.body.changed).toBe(false);

    // Six minutes on, only Main (Claude answered it) is due again; the refused ones wait 6 hours.
    clock += 6 * 60_000;
    asked = 0;
    const again = await usage();
    expect(asked).toBe(1);
    expect(again.n).toBeLessThanOrEqual(10);
    // Same numbers and same errors: open pages need not reload (no version bump).
    expect(again.writes).not.toContain('INCR');

    // Read usage (force) asks every paid account at once.
    asked = 0;
    await usage(true);
    expect(asked).toBe(2);
  });

  it('reads a newly added account at the next tick, not after the 6-hour wait', async () => {
    const { h, usage } = await setup();
    await usage();
    clock += 60_000;
    expect((await usage()).n).toBe(1);
    await h.upsertAccount({ name: 'New', plan: 'pro', routines: [{ model: 'sonnet', id: 'trig_n', token: 'good-n' }] });
    asked = 0;
    await usage();
    expect(asked).toBe(1);
    expect((await h.account('New')).usage).toMatchObject({ five_hour_pct: 30 });
  });

  it('never brings back an account removed while Claude was being asked', async () => {
    const { h, usage } = await setup();
    clock += 60 * 60_000;
    const p = usage(true);
    await h.removeAccount('Alt');
    await p;
    expect(await h.account('Alt')).toBeNull();
    expect(Object.keys(await h.accounts())).not.toContain('Alt');
  });
});
