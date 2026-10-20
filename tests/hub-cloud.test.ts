// Cloud Dop hub: page API + remote MCP, with Claude's routine API mocked.
import { beforeAll, describe, expect, it } from 'vitest';

// Plain JS modules (the hub deploys without a build step).
const lib = (p: string) => import(/* @vite-ignore */ `../hub/lib/${p}` as string) as Promise<any>;

type Fire = { routine: string; token: string; payload: any };
const fires: Fire[] = [];
let clock = Date.parse('2026-10-20T09:00:00Z');
const fakeFetch = async (url: string, init: any) => {
  const m = /routines\/([^/]+)\/fire/.exec(url);
  if (!m) throw new Error('unexpected fetch ' + url);
  if (!String(init.headers.authorization).includes('good')) return new Response('{"error":"bad"}', { status: 401 });
  fires.push({ routine: m[1], token: init.headers.authorization, payload: JSON.parse(JSON.parse(init.body).text) });
  return new Response(JSON.stringify({ type: 'routine_fire', claude_code_session_url: `https://claude.ai/code/session_${fires.length}` }), { status: 200 });
};

let hub: any, pageApi: any, mcpApi: any;
const PW = 'secret pw';
const page = (op: string, body?: any, pw = PW) =>
  pageApi({ hub, password: PW, method: body ? 'POST' : 'GET', query: Object.fromEntries(new URLSearchParams(`op=${op}`)), body: body || {}, headers: { 'x-hub-password': pw } });
let rpcId = 1;
const keys: Record<string, string> = {};
async function mcp(account: string, method: string, params: any = {}, key = keys[account]) {
  return mcpApi({ hub, method: 'POST', query: { account, key }, body: { jsonrpc: '2.0', id: rpcId++, method, params }, headers: {} });
}
async function tool(account: string, name: string, args: any = {}) {
  const r = await mcp(account, 'tools/call', { name, arguments: args });
  return r.body.result.content[0].text as string;
}
const last = () => fires[fires.length - 1];

beforeAll(async () => {
  const { createHub } = await lib('hub.js');
  const { memoryStore } = await lib('store.js');
  ({ pageApi, mcpApi } = await lib('api.js'));
  hub = createHub({ store: memoryStore(), fetchImpl: fakeFetch, now: () => clock });
});

describe('cloud hub', () => {
  it('needs the password', async () => {
    expect((await page('state', undefined, 'nope')).status).toBe(401);
    expect((await page('state')).status).toBe(200);
  });

  it('adds accounts with routines per model, never showing tokens', async () => {
    await page('account', { name: 'A', plan: 'max', routines: [{ model: 'sonnet', id: 'trig_a_s', token: 'good-a1' }, { model: 'opus', id: 'trig_a_o', token: 'good-a2' }] });
    await page('account', { name: 'B', plan: 'pro', routines: [{ model: 'sonnet', id: 'trig_b_s', token: 'good-b1' }, { model: 'haiku', id: 'trig_b_h', token: 'good-b2' }] });
    await page('account', { name: 'Phone', plan: 'free' });
    const s = (await page('state')).body;
    expect(s.accounts.map((a: any) => a.name).sort()).toEqual(['A', 'B', 'Phone']);
    expect(JSON.stringify(s)).not.toContain('good-');
    for (const n of ['A', 'B', 'Phone']) keys[n] = (await page(`connect&account=${n}`)).body.key;
  });

  it('rejects a wrong connector key', async () => {
    expect((await mcp('A', 'tools/list', {}, 'wrong')).status).toBe(401);
  });

  it('starts the coordinator for a prompt, which opens threads on the right accounts and models', async () => {
    await page('prompt', { text: 'Fix the move slider on phones and write a changelog entry.' });
    expect(last().payload).toMatchObject({ hub: 'dop', role: 'coordinator' });
    expect(last().routine).toBe('trig_b_h'); // coordinator runs on Haiku; only B has a Haiku routine
    const init = await mcp('A', 'initialize', { protocolVersion: '2025-06-18' });
    expect(init.body.result.serverInfo.name).toBe('dop-hub');
    const list = await mcp('A', 'tools/list');
    expect(list.body.result.tools.length).toBe(10);

    const brief = await tool('A', 'hub_start', { payload: JSON.stringify(last().payload) });
    expect(brief).toContain('You are the coordinator');
    expect(brief).toContain('Fix the move slider');
    const promptId = Number(/#(\d+) XIAO prompt/.exec(brief)![1]);

    const r = await tool('A', 'hub_route', {
      prompt_id: promptId,
      summary: 'Two threads',
      threads: [
        { title: 'Move slider on phones', brief: 'Fix the slider jump', model: 'opus' },
        { title: 'Changelog entry', brief: 'Write it', model: 'haiku', code: true },
      ],
    });
    expect(r).toMatch(/Move slider on phones: working on A/);
    expect(r).toMatch(/Changelog entry: working on B/); // only B has a Haiku routine
    expect(fires.slice(-2).map((f) => f.routine)).toEqual(['trig_a_o', 'trig_b_h']);
    const routedMsg = (await hub.feed()).find((m: any) => m.kind === 'routed');
    expect(routedMsg.replyTo).toBe(promptId);
    // A handled prompt is not offered again.
    expect(await tool('B', 'hub_start')).not.toContain('You are the coordinator');
  });

  it('runs a worker: brief, handover, done', async () => {
    const t = (await hub.threads()).find((x: any) => x.title === 'Move slider on phones');
    const brief = await tool('A', 'hub_start', { payload: JSON.stringify({ hub: 'dop', role: 'worker', thread: t.id }) });
    expect(brief).toContain(`thread #${t.id}`);
    expect(brief).toContain('Fix the slider jump');
    await tool('A', 'hub_checkpoint', { thread: t.id, done: 'Found double touchmove', next: 'Debounce in MoveSlider.tsx', branch: 'claude/slider' });
    expect((await hub.thread(t.id)).checkpoint.next).toBe('Debounce in MoveSlider.tsx');
    await tool('A', 'hub_post', { thread: t.id, kind: 'done', text: 'PR #60 ready' });
    expect((await hub.thread(t.id)).status).toBe('done');
  });

  it('lets one thread ask another and get the answer back', async () => {
    const slider = (await hub.threads()).find((x: any) => x.title === 'Move slider on phones');
    const log = (await hub.threads()).find((x: any) => x.title === 'Changelog entry');
    // The changelog agent asks the finished slider thread: the hub starts a short answer session.
    const before = fires.length;
    const asking = tool('B', 'hub_ask', { from_thread: log.id, to_thread: slider.id, question: 'Which PR fixed the slider?', wait_s: 10 });
    await new Promise((r) => setTimeout(r, 300));
    expect(fires.length).toBe(before + 1);
    expect(last().payload).toMatchObject({ role: 'answer', thread: slider.id });
    const q = (await hub.feed()).filter((m: any) => m.kind === 'question').at(-1);
    await tool('A', 'hub_post', { thread: slider.id, kind: 'answer', reply_to: q.id, text: 'PR #60' });
    expect(await asking).toContain('PR #60');
  }, 15_000);

  it('moves new work away from an account that is low on usage', async () => {
    expect(await tool('A', 'hub_usage', { state: 'low', percent: 91 })).toContain('checkpoint');
    const t = await hub.createThread({ title: 'Next task', brief: 'x', model: 'sonnet' });
    expect(t.account).toBe('B');
    const alerts = (await hub.feed()).filter((m: any) => m.kind === 'alert' && m.thread === 0);
    expect(alerts.at(-1).text).toContain('A is running low');
    await tool('A', 'hub_usage', { state: 'ok' });
  });

  it('continues a stopped thread on another account from its handover', async () => {
    const t = (await hub.threads()).find((x: any) => x.title === 'Next task'); // on B, working
    await hub.checkpoint({ name: 'B' }, { thread: t.id, done: 'half', next: 'the other half' });
    clock += 20 * 60_000;
    await page('state'); // any visit notices it
    const now = await hub.thread(t.id);
    expect(now.account).toBe('A');
    expect(last().payload).toMatchObject({ role: 'resume', thread: t.id });
    const brief = await tool('A', 'hub_start', { payload: JSON.stringify(last().payload) });
    expect(brief).toContain('Next: the other half');
  });

  it('gives chat-only work to a free account that checks in', async () => {
    const t = await hub.createThread({ title: 'Explain ko rules', brief: 'Short answer', model: 'sonnet', account: 'Phone', code: false });
    expect(t).toMatchObject({ account: 'Phone', status: 'queued' }); // free accounts cannot be started remotely
    // Phone opens a chat and says "check the hub".
    const got = await tool('Phone', 'hub_start');
    expect(got).toContain('Explain ko rules');
    expect((await hub.thread(t.id)).status).toBe('working');
    // Code work is never queued for a free account.
    const c = await hub.createThread({ title: 'Code task', brief: 'x', model: 'sonnet', account: 'Phone' });
    expect(c.account).not.toBe('Phone');
  });

  it('skips the coordinator when the overhead budget is used up', async () => {
    await page('settings', { overheadTokens: 0 });
    const n = (await hub.threads()).length;
    await page('prompt', { text: 'Tidy the README' });
    expect((await hub.threads()).length).toBe(n + 1);
    expect((await hub.threads()).at(-1).title).toBe('Tidy the README');
    await page('settings', { overheadTokens: 40000 });
  });

  it('reports a refused routine token and tries another account', async () => {
    await page('account', { name: 'B', routines: [{ model: 'sonnet', id: 'trig_b_s', token: 'expired' }] });
    const t = await hub.createThread({ title: 'Token test', brief: 'x', model: 'sonnet', account: 'B' });
    expect(t.account).toBe('A');
    const msgs = (await hub.feed()).filter((m: any) => m.thread === t.id).map((m: any) => m.text).join('\n');
    expect(msgs).toContain('token was refused');
  });

  it('keeps the hub overhead estimate small for a normal prompt', async () => {
    const ov = (await page('state')).body.overhead;
    expect(ov.used).toBeGreaterThan(0);
    expect(ov.used).toBeLessThan(ov.budget);
  });
});
