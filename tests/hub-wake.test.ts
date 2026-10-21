// Cloud hub: threads continue on their own once an account's usage limit
// resets (wake check, op=tick from the hub-wake workflow). Claude mocked.
import { beforeEach, describe, expect, it } from 'vitest';

const lib = (p: string) => import(/* @vite-ignore */ `../hub/lib/${p}` as string) as Promise<any>;

const fires: any[] = [];
let clock = Date.parse('2026-10-21T09:00:00Z');
const fakeFetch = async (url: string, init: any) => {
  if (url.endsWith('/api/oauth/usage')) throw new Error('offline');
  const m = /routines\/([^/]+)\/fire/.exec(url);
  if (!m) throw new Error('unexpected fetch ' + url);
  const text = JSON.parse(init.body).text as string;
  fires.push({ routine: m[1], payload: JSON.parse(text.slice(text.indexOf('{'))) });
  return new Response(JSON.stringify({ claude_code_session_url: `https://claude.ai/code/session_${fires.length}` }), { status: 200 });
};

let hub: any, pageApi: any, mcpApi: any;
const PW = 'pw';
const keys: Record<string, string> = {};
const page = (op: string, body?: any, pw = PW) =>
  pageApi({ hub, password: PW, method: body ? 'POST' : 'GET', query: Object.fromEntries(new URLSearchParams(`op=${op}`)), body: body || {}, headers: { 'x-hub-password': pw } });
let rpc = 1;
async function tool(account: string, name: string, args: any = {}) {
  const r = await mcpApi({ hub, method: 'POST', query: { account, key: keys[account] }, body: { jsonrpc: '2.0', id: rpc++, method: 'tools/call', params: { name, arguments: args } }, headers: {} });
  return r.body.result.content[0].text as string;
}
const iso = (ms: number) => new Date(ms).toISOString();
const min = 60_000;
const alerts = async (): Promise<string[]> => (await hub.feed()).filter((m: any) => m.kind === 'alert').map((m: any) => m.text as string);

beforeEach(async () => {
  fires.length = 0;
  clock = Date.parse('2026-10-21T09:00:00Z');
  const { createHub } = await lib('hub.js');
  const { memoryStore } = await lib('store.js');
  ({ pageApi, mcpApi } = await lib('api.js'));
  hub = createHub({ store: memoryStore(), fetchImpl: fakeFetch, now: () => clock });
  await page('account', { name: 'A', plan: 'max', routines: [{ model: 'sonnet', id: 'trig_a', token: 'good-a' }] });
  await page('account', { name: 'B', plan: 'pro', routines: [{ model: 'sonnet', id: 'trig_b', token: 'good-b' }] });
  for (const n of ['A', 'B']) keys[n] = (await page(`connect&account=${n}`)).body.key;
});

// Both accounts report their limit nearly used, resetting in 2 hours (A) and 3 hours (B).
async function bothAtLimit() {
  await tool('A', 'hub_usage', { state: 'report', five_hour_pct: 97, seven_day_pct: 40, five_hour_resets: iso(clock + 120 * min), seven_day_resets: iso(clock + 3 * 86400_000) });
  await tool('B', 'hub_usage', { state: 'report', five_hour_pct: 99, seven_day_pct: 30, five_hour_resets: iso(clock + 180 * min), seven_day_resets: iso(clock + 4 * 86400_000) });
  expect(Object.values(await hub.accounts()).every((a: any) => a.low)).toBe(true);
}

describe('continuing after a usage limit resets', () => {
  it('starts a thread that waited because every account was at its limit', async () => {
    await bothAtLimit();
    const t = await hub.createThread({ title: 'Waits', brief: 'x', model: 'sonnet' });
    expect(t.status).toBe('queued');
    expect(t.wait).toBe('usage');
    expect(fires).toHaveLength(0);

    clock += 60 * min; // nothing has reset yet
    expect((await page('tick', undefined, '')).body).toMatchObject({ ok: true, resumed: 0 });
    expect(fires).toHaveLength(0);

    clock += 61 * min; // A's 5-hour limit has reset
    const r = (await page('tick', undefined, '')).body;
    expect(r).toMatchObject({ ok: true, back: 1, resumed: 1 });
    const now = await hub.thread(t.id);
    expect(now).toMatchObject({ status: 'working', account: 'A', wait: '' });
    expect(fires.at(-1).payload).toMatchObject({ role: 'worker', thread: t.id });
    expect((await alerts()).some((x) => x.includes('Usage limit reset: A'))).toBe(true);
    // A's 5-hour number is gone (it reset); its weekly one stays.
    const a = await hub.account('A');
    expect(a.usage).toMatchObject({ five_hour_pct: null, seven_day_pct: 40 });
  });

  it('continues a stopped thread from its handover when a limit resets', async () => {
    const t = await hub.createThread({ title: 'Long job', brief: 'x', model: 'sonnet' });
    await tool(t.account, 'hub_start', { payload: JSON.stringify(fires.at(-1).payload) });
    await tool(t.account, 'hub_checkpoint', { thread: t.id, done: 'half', next: 'the rest', branch: 'claude/long' });
    await bothAtLimit();
    clock += 20 * min;
    await page('state'); // the stall check: nobody can take it
    expect((await hub.thread(t.id)).status).toBe('queued');
    const before = fires.length;

    clock += 101 * min; // past A's reset
    await page('state'); // an open page also wakes it
    expect((await hub.thread(t.id)).status).toBe('working');
    expect(fires.length).toBe(before + 1);
    expect(fires.at(-1).payload).toMatchObject({ role: 'resume', thread: t.id });
  });

  it('wakes at most once a minute', async () => {
    await bothAtLimit();
    expect((await page('tick', undefined, '')).body.skipped).toBe(false);
    expect((await page('tick', undefined, '')).body.skipped).toBe(true);
    clock += min;
    expect((await page('tick', undefined, '')).body.skipped).toBe(false);
  });

  it('lets only tick through without the password', async () => {
    expect((await page('tick', undefined, '')).status).toBe(200);
    expect((await page('state', undefined, '')).status).toBe(401);
    expect((await page('prompt', { text: 'hi' }, '')).status).toBe(401);
  });

  it('brings back an account its agent marked low after its reset, or 5 hours without one', async () => {
    await tool('A', 'hub_usage', { state: 'low', five_hour_pct: 92, five_hour_resets: iso(clock + 90 * min) });
    await tool('B', 'hub_usage', { state: 'low' }); // no numbers, no reset time
    expect((await hub.account('A')).lowUntil).toBe(clock + 90 * min);
    expect((await hub.account('B')).lowUntil).toBe(clock + 5 * 60 * min);
    clock += 91 * min;
    await hub.wake({ force: true });
    expect((await hub.account('A')).low).toBe(false);
    expect((await hub.account('B')).low).toBe(true);
    clock += 4 * 60 * min;
    await hub.wake({ force: true });
    expect((await hub.account('B')).low).toBe(false);
  });

  it('keeps an account XIAO marked low by hand until its known reset or until XIAO clears it', async () => {
    await page('account-low', { name: 'A', low: true });
    clock += 24 * 60 * min;
    await hub.wake({ force: true });
    expect((await hub.account('A')).low).toBe(true);
  });

  it('rests an account whose restarted session never reached the hub', async () => {
    await bothAtLimit();
    const t = await hub.createThread({ title: 'Waits', brief: 'x', model: 'sonnet' });
    clock += 121 * min;
    await page('tick', undefined, '');
    expect((await hub.thread(t.id)).account).toBe('A');
    clock += 20 * min; // A's session never called the hub
    await page('tick', undefined, '');
    const a = await hub.account('A');
    expect(a.low).toBe(true);
    expect(a.lowUntil).toBe(clock + 60 * min);
    // Not started again on A in the meantime.
    clock += 30 * min;
    await page('tick', undefined, '');
    expect(fires.filter((f) => f.routine === 'trig_a')).toHaveLength(1);
  });

  it('starts the coordinator for a prompt that came in while every account was at its limit', async () => {
    await bothAtLimit();
    await page('prompt', { text: 'Fix two things' });
    expect(fires).toHaveLength(0);
    clock += 121 * min;
    await page('tick', undefined, '');
    expect(fires.at(-1).payload).toMatchObject({ role: 'coordinator' });
  });

  it('leaves alone a thread waiting for a free account to check in', async () => {
    await page('account', { name: 'Phone', plan: 'free' });
    const t = await hub.createThread({ title: 'Chat job', brief: 'x', code: false, account: 'Phone' });
    expect((await hub.thread(t.id)).wait).toBe('checkin');
    clock += 121 * min;
    await page('tick', undefined, '');
    expect((await hub.thread(t.id)).status).toBe('queued');
    expect(fires).toHaveLength(0);
  });
});
