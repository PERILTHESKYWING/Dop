// Cloud hub: accounts stay connected through storage hiccups and failed
// routine starts, say when only XIAO can fix something, and come back the
// moment a limit resets. Claude, Upstash and QStash mocked.
import { beforeEach, describe, expect, it } from 'vitest';

const lib = (p: string) => import(/* @vite-ignore */ `../hub/lib/${p}` as string) as Promise<any>;

const min = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
let clock = Date.parse('2026-10-22T09:00:00Z');
// What each routine answers next: a status (and headers), or 'offline'.
let answers: Record<string, Array<number | 'offline' | { status: number; headers?: Record<string, string> }>> = {};
const fires: string[] = [];
const fakeFetch = async (url: string) => {
  if (url.endsWith('/api/oauth/usage')) throw new Error('offline');
  const m = /routines\/([^/]+)\/fire/.exec(url);
  if (!m) throw new Error('unexpected fetch ' + url);
  const next = answers[m[1]]?.shift() ?? 200;
  if (next === 'offline') throw new Error('socket hang up');
  const { status, headers = {} } = typeof next === 'number' ? { status: next } : next;
  if (status === 200) fires.push(m[1]);
  return new Response(status === 200 ? JSON.stringify({ claude_code_session_url: 'https://claude.ai/code/session_x' }) : '{}', { status, headers });
};

let hub: any, pageApi: any, mcpApi: any, createHub: any, memoryStore: any;
const planned: number[] = [];
const PW = 'pw';
const keys: Record<string, string> = {};
const page = (op: string, body?: any) =>
  pageApi({ hub, password: PW, method: body ? 'POST' : 'GET', query: Object.fromEntries(new URLSearchParams(`op=${op}`)), body: body || {}, headers: { 'x-hub-password': PW } });
let rpc = 1;
const call = (account: string, method: string, params: any = {}, key = keys[account]) =>
  mcpApi({ hub, method: 'POST', query: { account, key }, body: { jsonrpc: '2.0', id: rpc++, method, params }, headers: {} });
const card = async (name: string) => (await page('state')).body.accounts.find((a: any) => a.name === name);
const alerts = async (): Promise<string[]> => (await hub.feed()).filter((m: any) => m.kind === 'alert').map((m: any) => m.text as string);

beforeEach(async () => {
  answers = {};
  fires.length = 0;
  planned.length = 0;
  clock = Date.parse('2026-10-22T09:00:00Z');
  ({ createHub } = await lib('hub.js'));
  ({ memoryStore } = await lib('store.js'));
  ({ pageApi, mcpApi } = await lib('api.js'));
  hub = createHub({ store: memoryStore(), fetchImpl: fakeFetch, now: () => clock, retryMs: 1, planWake: async (at: number) => void planned.push(at) });
  await page('account', { name: 'A', plan: 'max', routines: [{ model: 'sonnet', id: 'trig_a', token: 'tok-a' }] });
  await page('account', { name: 'B', plan: 'pro', routines: [{ model: 'sonnet', id: 'trig_b', token: 'tok-b' }] });
  for (const n of ['A', 'B']) keys[n] = (await page(`connect&account=${n}`)).body.key;
});

describe('accounts stay connected', () => {
  it('retries Upstash when it is busy, and never sends a write twice after a lost answer', async () => {
    const { upstashStore } = await lib('store.js');
    const sent: any[] = [];
    let script: Array<number | 'drop'> = [];
    const up = upstashStore('https://kv.example', 't', async (_u: string, init: any) => {
      sent.push(JSON.parse(init.body));
      const next = script.shift() ?? 200;
      if (next === 'drop') throw new TypeError('fetch failed');
      return new Response(JSON.stringify(next === 200 ? { result: 'ok' } : { error: 'busy' }), { status: next });
    }, { waitMs: 1 });
    script = [503, 429];
    expect(await up.cmd('INCR', 'x')).toBe('ok'); // busy twice, then done
    expect(sent).toHaveLength(3);
    sent.length = 0;
    script = ['drop'];
    expect(await up.cmd('GET', 'x')).toBe('ok'); // a read is simply asked again
    expect(sent).toHaveLength(2);
    sent.length = 0;
    script = ['drop'];
    await expect(up.cmd('RPUSH', 'feed', 'm')).rejects.toThrow(); // a write may have run: not sent again
    expect(sent).toHaveLength(1);
    script = [503, 503, 503];
    await expect(up.cmd('GET', 'x')).rejects.toThrow('busy'); // three tries at most
  });

  it('answers 503 instead of dropping the connector when storage is down', async () => {
    const broken = { cmd: async () => { throw new Error('store 503'); }, multi: async () => { throw new Error('store 503'); } };
    const h = createHub({ store: broken, fetchImpl: fakeFetch, now: () => clock });
    const r = await mcpApi({ hub: h, method: 'POST', query: { account: 'A', key: keys.A }, body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, headers: {} });
    expect(r.status).toBe(503);
    expect(r.body.error.message).toContain('Try again');
  });

  it('starts on the second try when Claude has a hiccup', async () => {
    answers.trig_a = [503];
    const t = await hub.createThread({ title: 'Hiccup', brief: 'x', model: 'sonnet', account: 'A' });
    expect(t.account).toBe('A');
    expect(fires).toEqual(['trig_a']);
    expect((await card('A')).pausedUntil).toBe(0);
  });

  it('pauses a rate-limited routine until Retry-After, uses another account, then retries by itself', async () => {
    answers.trig_a = [{ status: 429, headers: { 'retry-after': '600' } }];
    const t = await hub.createThread({ title: 'Busy', brief: 'x', model: 'sonnet', account: 'A', accounts: ['A'] });
    expect(t.status).toBe('queued'); // only A was allowed, and A is paused
    const a = await card('A');
    expect(a.pausedUntil).toBe(clock + 10 * min);
    expect(a.problem).toBe(''); // nothing for XIAO to do
    expect(planned.at(-1)).toBe(clock + 10 * min + 15_000); // a timed wake right after
    clock += 5 * min;
    await page('tick');
    expect(fires).toEqual([]); // still paused
    clock += 6 * min;
    expect((await page('tick')).body.resumed).toBe(1);
    expect(fires).toEqual(['trig_a']);
    expect((await hub.thread(t.id)).status).toBe('working');
    expect((await card('A')).pausedUntil).toBe(0);
  });

  it('pauses briefly when Claude does not answer twice', async () => {
    answers.trig_a = ['offline', 'offline'];
    const t = await hub.createThread({ title: 'Down', brief: 'x', model: 'sonnet', account: 'A' });
    expect(t.account).toBe('B'); // went elsewhere at once
    expect((await card('A')).pausedUntil).toBe(clock + 2 * min);
  });

  it('says once when only XIAO can fix a refused token, retries every 30 min, and a new token clears it', async () => {
    answers.trig_a = [401];
    await hub.createThread({ title: 'One', brief: 'x', model: 'sonnet', account: 'A' });
    let a = await card('A');
    expect(a.problem).toContain('Claude refused its Sonnet routine token (401)');
    expect(a.problem).toContain('then Edit');
    // The next task skips A without trying it again.
    await hub.createThread({ title: 'Two', brief: 'x', model: 'sonnet', account: 'A' });
    expect(fires).toEqual(['trig_b', 'trig_b']);
    // After 30 min the hub tries A again; still refused: no second project alert.
    clock += 31 * min;
    answers.trig_a = [401];
    await hub.createThread({ title: 'Three', brief: 'x', model: 'sonnet', account: 'A' });
    expect((await alerts()).filter((x) => x.startsWith('A: Claude refused'))).toHaveLength(1);
    // Saving the account with the same token keeps the warning; a new token clears it.
    await page('account', { name: 'A', routines: [{ model: 'sonnet', id: 'trig_a', token: '' }] });
    expect((await card('A')).problem).not.toBe('');
    await page('account', { name: 'A', routines: [{ model: 'sonnet', id: 'trig_a', token: 'tok-a2' }] });
    a = await card('A');
    expect(a.problem).toBe('');
    const t = await hub.createThread({ title: 'Four', brief: 'x', model: 'sonnet', account: 'A' });
    expect(t.account).toBe('A');
  });

  it('notices a connector that still uses an old link', async () => {
    await call('A', 'tools/list'); // the real connector works
    let a = await card('A');
    expect([a.connected, a.oldLink]).toEqual([true, false]);
    clock += min;
    expect((await call('A', 'tools/list', {}, 'stale-key-0000000000')).status).toBe(403);
    a = await card('A');
    expect(a.oldLink).toBe(true);
    expect(a.problem).toContain('old link');
    clock += 2 * min;
    await call('A', 'tools/list'); // a good call afterwards clears it
    expect((await card('A')).oldLink).toBe(false);
  });

  it('plans a timed wake at a known reset, and the timed tick runs even right after another check', async () => {
    const reset = clock + 90 * min;
    await call('A', 'tools/call', { name: 'hub_usage', arguments: { state: 'low', five_hour_pct: 95, five_hour_resets: iso(reset) } });
    expect(planned).toContain(reset + 15_000);
    clock = reset - 30_000;
    await page('tick'); // a check just before the reset
    clock = reset + 15_000;
    expect((await page('tick')).body.skipped).toBe(true); // a plain tick waits a minute
    const timed = await pageApi({ hub, password: PW, method: 'POST', query: {}, body: { op: 'tick', due: reset + 15_000 }, headers: {} });
    expect(timed.body.skipped).toBe(false);
    expect((await hub.account('A')).low).toBe(false);
    // Once it has run after its due time, the same timed tick is a no-op.
    clock += 20_000;
    expect((await pageApi({ hub, password: PW, method: 'POST', query: {}, body: { op: 'tick', due: reset + 15_000 }, headers: {} })).body.skipped).toBe(true);
  });

  it('asks QStash to post the tick at the planned time, once per minute', async () => {
    const { qstashTimer } = await lib('wake-timer.js');
    expect(qstashTimer({ VERCEL_PROJECT_PRODUCTION_URL: 'dop-hub.vercel.app' })).toBeNull(); // no token: off
    const sent: any[] = [];
    const timer = qstashTimer({ QSTASH_TOKEN: 'q', VERCEL_PROJECT_PRODUCTION_URL: 'dop-hub.vercel.app' }, async (url: string, init: any) => (sent.push({ url, ...init }), new Response('{}', { status: 201 })));
    const at = Date.parse('2026-10-22T14:00:20Z');
    await timer(at);
    expect(sent[0].url).toBe('https://qstash.upstash.io/v2/publish/https://dop-hub.vercel.app/api/hub');
    expect(sent[0].headers).toMatchObject({ authorization: 'Bearer q', 'Upstash-Not-Before': String(at / 1000), 'Upstash-Deduplication-Id': `hub-wake-${Math.ceil(at / min)}` });
    expect(JSON.parse(sent[0].body)).toEqual({ op: 'tick', due: at });
  });

  it("brings an account back on any agent's hub call after its reset", async () => {
    const reset = clock + 60 * min;
    await call('A', 'tools/call', { name: 'hub_usage', arguments: { state: 'low', five_hour_resets: iso(reset) } });
    expect((await hub.account('A')).low).toBe(true);
    clock = reset + min;
    await call('B', 'tools/call', { name: 'hub_sync', arguments: {} });
    expect((await hub.account('A')).low).toBe(false);
    expect(await alerts()).toContain('Usage limit reset: A can work again.');
  });

  it("does not rest an account whose other sessions reach the hub", async () => {
    const t = await hub.createThread({ title: 'Silent', brief: 'x', model: 'sonnet', account: 'A' });
    clock += 5 * min;
    await call('A', 'tools/call', { name: 'hub_usage', arguments: { state: 'report', five_hour_pct: 20 } }); // another session of A
    clock += 15 * min;
    await page('tick');
    expect((await hub.thread(t.id)).account).toBe('B'); // continued elsewhere
    expect((await hub.account('A')).low).toBe(false);
    // Silent everywhere since its start: rested, and back by itself.
    const u = await hub.createThread({ title: 'Silent 2', brief: 'x', model: 'sonnet', account: 'A' });
    expect(u.account).toBe('A');
    clock += 20 * min;
    await page('tick');
    const a = await hub.account('A');
    expect(a.low).toBe(true);
    expect(a.lowUntil).toBeGreaterThan(clock);
  });
});
