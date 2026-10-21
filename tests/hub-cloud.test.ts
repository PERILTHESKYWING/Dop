// Cloud Dop hub: page API + remote MCP, with Claude's routine API mocked.
import { beforeAll, describe, expect, it } from 'vitest';

// Plain JS modules (the hub deploys without a build step).
const lib = (p: string) => import(/* @vite-ignore */ `../hub/lib/${p}` as string) as Promise<any>;

type Fire = { routine: string; token: string; payload: any; text: string };
const fires: Fire[] = [];
let clock = Date.parse('2026-10-20T09:00:00Z');
let usageReply: any = null;
const fakeFetch = async (url: string, init: any) => {
  if (url.endsWith('/api/oauth/usage')) {
    if (!usageReply) throw new Error('offline');
    return new Response(JSON.stringify(usageReply), { status: String(init.headers.authorization).includes('good') ? 200 : 401 });
  }
  const m = /routines\/([^/]+)\/fire/.exec(url);
  if (!m) throw new Error('unexpected fetch ' + url);
  if (!String(init.headers.authorization).includes('good')) return new Response('{"error":"bad"}', { status: 401 });
  const text = JSON.parse(init.body).text as string;
  fires.push({ routine: m[1], token: init.headers.authorization, payload: JSON.parse(text.slice(text.indexOf('{'))), text });
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

  it('can take back an old connector key', async () => {
    await page('account', { name: 'Old', plan: 'free', key: 'reusedKey_1234567890' });
    expect((await page('connect&account=Old')).body.key).toBe('reusedKey_1234567890');
    await page('account-remove', { name: 'Old' });
  });

  it('makes a new connector link and stops the old one', async () => {
    await page('account', { name: 'Re', plan: 'free' });
    const old = (await page('connect&account=Re')).body.key;
    const fresh = (await page('account-newkey', { name: 'Re' })).body.key;
    expect(fresh).not.toBe(old);
    expect((await page('connect&account=Re')).body.key).toBe(fresh);
    expect((await mcp('Re', 'tools/list', {}, old)).status).toBe(403);
    expect((await mcp('Re', 'tools/list', {}, fresh)).status).toBe(200);
    await page('account-remove', { name: 'Re' });
  });

  it('rejects a wrong connector key', async () => {
    expect((await mcp('A', 'tools/list', {}, 'wrong')).status).toBe(403); // never 401: claude.ai would try OAuth
    const ok = await mcpApi({ hub, method: 'GET', query: { account: 'A', key: keys.A }, body: {}, headers: {} });
    expect(ok.body.ok).toBe(true);
  });

  it('logs connector calls for debugging', async () => {
    const log = (await page('connlog', {})).body;
    expect(log.some((r: any) => r.account === 'A' && !r.keyOk)).toBe(true);
    expect(log.some((r: any) => r.account === 'A' && r.keyOk)).toBe(true);
  });

  it('starts the coordinator for a prompt, which opens threads on the right accounts and models', async () => {
    await page('prompt', { text: 'Fix the move slider on phones and write a changelog entry.' });
    expect(last().payload).toMatchObject({ hub: 'dop', role: 'coordinator' });
    expect(last().routine).toBe('trig_b_h'); // coordinator runs on Haiku; only B has a Haiku routine
    const init = await mcp('A', 'initialize', { protocolVersion: '2025-06-18' });
    expect(init.body.result.serverInfo.name).toBe('dop-hub');
    const list = await mcp('A', 'tools/list');
    expect(list.body.result.tools.length).toBe(30);

    const brief = await tool('A', 'hub_start', { payload: JSON.stringify(last().payload) });
    expect(brief).toContain('You are the coordinator');
    expect(brief).toContain('Fix the move slider');
    // It splits independent parts into parallel threads, and keeps a single task to one thread.
    expect(brief).toMatch(/independent/i);
    expect(brief).toMatch(/parallel/i);
    expect(brief).toMatch(/(one|single) task[^.]*one thread/i);
    expect(brief).not.toContain('most prompts are one thread');
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

  it('shows sub-agents an account deploys itself', async () => {
    expect(await tool('A', 'hub_agent', { action: 'start', id: 'scan1', title: 'Scan tests', thread: 0 })).toMatch(/running/);
    await tool('A', 'hub_agent', { action: 'update', id: 'scan1', step: 'reading', pct: 40 });
    let snap = (await page('state')).body;
    expect(snap.agents.find((x: any) => x.id === 'scan1')).toMatchObject({ account: 'A', status: 'running', step: 'reading', pct: 40, title: 'Scan tests' });
    await tool('A', 'hub_agent', { action: 'finish', id: 'scan1' });
    snap = (await page('state')).body;
    expect(snap.agents.find((x: any) => x.id === 'scan1')).toMatchObject({ status: 'done', pct: 100 });
    expect(await tool('A', 'hub_agent', { action: 'update', id: 'nope' })).toMatch(/Unknown agent id/);
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

  it('tells agents to use the repo skills', async () => {
    const t = await hub.createThread({ title: 'Skills hint', brief: 'x', model: 'sonnet', account: 'A' });
    const got = await tool('A', 'hub_start', { payload: JSON.stringify({ hub: 'dop', role: 'member', thread: t.id }) });
    expect(got).toContain('.claude/skills');
    expect(got).toContain('dop-verify');
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

  it('hands no-code work to free helper accounts first, spread across them', async () => {
    await page('account', { name: 'Helper2', plan: 'free' });
    keys.Helper2 = (await page('connect&account=Helper2')).body.key;
    const before = fires.length;
    const a = await hub.createThread({ title: 'Research 1', brief: 'x', model: 'sonnet', code: false });
    const b = await hub.createThread({ title: 'Research 2', brief: 'x', model: 'sonnet', code: false });
    expect(fires.length).toBe(before); // no paid session started
    expect([a.account, b.account].sort()).toEqual(['Helper2', 'Phone'].sort());
    expect(await tool('Helper2', 'hub_start')).toContain('call hub_start again');
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

describe('cloud hub with a single Opus routine', () => {
  it('starts the coordinator and threads on Opus when no other model exists', async () => {
    const { createHub } = await lib('hub.js');
    const { memoryStore } = await lib('store.js');
    const before = fires.length;
    const h = createHub({ store: memoryStore(), fetchImpl: fakeFetch, now: () => clock });
    await h.upsertAccount({ name: 'Dad', plan: 'pro', routines: [{ model: 'opus', id: 'https://api.anthropic.com/v1/claude_code/routines/trig_dad_o/fire', token: 'good-dad' }] });
    await h.prompt({ text: 'Fix the slider' });
    expect(fires.length).toBe(before + 1);
    expect(fires.at(-1)!.routine).toBe('trig_dad_o');
    const t = await h.createThread({ title: 'x', brief: 'x', model: 'sonnet' });
    expect(t).toMatchObject({ account: 'Dad', status: 'working' });
    expect((await h.connLog())[0]).toMatchObject({ http: 'START', keyOk: true });
  });
});

describe('cloud hub: any project', () => {
  it('names itself after HUB_PROJECT and HUB_OWNER in what agents and the page read', async () => {
    const { createHub } = await lib('hub.js');
    const { memoryStore } = await lib('store.js');
    const { handleMcp } = await lib('mcp.js');
    const before = fires.length;
    const h = createHub({ store: memoryStore(), fetchImpl: fakeFetch, now: () => clock, project: 'Garden App', owner: 'Sam' });
    await h.upsertAccount({ name: 'P', plan: 'pro', routines: [{ model: 'sonnet', id: 'trig_p', token: 'good-p' }] });
    const t = await h.createThread({ title: 'x', brief: 'x', model: 'sonnet' });
    expect(fires.length).toBe(before + 1);
    expect(fires.at(-1)!.payload).toMatchObject({ hub: 'garden-app', role: 'worker', thread: t.id });
    const init = await handleMcp(h, { name: 'P' }, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(init.result.serverInfo.name).toBe('garden-app-hub');
    expect(init.result.instructions).toContain("Sam's Garden App hub");
    const r = await pageApi({ hub: h, password: PW, method: 'GET', query: { op: 'state' }, body: {}, headers: { 'x-hub-password': PW } });
    expect(r.body).toMatchObject({ project: 'Garden App', owner: 'Sam' });
  });
});

describe('cloud hub: thinking level and chosen accounts', () => {
  it('keeps XIAO\'s picks on the coordinator\'s threads and only uses the chosen accounts', async () => {
    const { createHub } = await lib('hub.js');
    const { memoryStore } = await lib('store.js');
    const h = createHub({ store: memoryStore(), fetchImpl: fakeFetch, now: () => clock });
    await h.upsertAccount({ name: 'Main', plan: 'max', routines: [{ model: 'opus', id: 'trig_m_o', token: 'good-m' }, { model: 'haiku', id: 'trig_m_h', token: 'good-mh' }] });
    await h.upsertAccount({ name: 'Second', plan: 'pro', routines: [{ model: 'opus', id: 'trig_s_o', token: 'good-s' }] });
    const msg = await h.prompt({ text: 'Make the board faster', thinking: 'max', accounts: ['Second'] });
    expect(msg.meta).toMatchObject({ thinking: 'max', accounts: ['Second'] });
    // Coordinator runs on a chosen account (falls back to its Opus routine).
    expect(fires.at(-1)!.routine).toBe('trig_s_o');
    expect(fires.at(-1)!.text.startsWith('{')).toBe(true); // coordinator gets no thinking keyword
    const agent = await h.account('Main');
    expect(await h.start(agent, JSON.stringify(fires.at(-1)!.payload))).toContain('XIAO picked: thinking max; accounts Second');
    await h.route(agent, { prompt_id: msg.id, summary: 'One thread', threads: [{ title: 'Faster board', brief: 'x', model: 'opus', account: 'Main' }] });
    const t = (await h.threads()).find((x: any) => x.title === 'Faster board');
    expect(t).toMatchObject({ thinking: 'max', accounts: ['Second'], account: 'Second', status: 'working' });
    expect(fires.at(-1)!.routine).toBe('trig_s_o');
    expect(fires.at(-1)!.text.startsWith('ultrathink\n')).toBe(true);
    expect(await h.start(agent, JSON.stringify(fires.at(-1)!.payload))).toContain('Thinking: Max');
  });

  it('lets a thread change its thinking level and accounts', async () => {
    const { createHub } = await lib('hub.js');
    const { memoryStore } = await lib('store.js');
    const h = createHub({ store: memoryStore(), fetchImpl: fakeFetch, now: () => clock });
    await h.upsertAccount({ name: 'Main', plan: 'max', routines: [{ model: 'sonnet', id: 'trig_m', token: 'good-m' }] });
    await h.upsertAccount({ name: 'Helper', plan: 'free' });
    const t = await h.createThread({ title: 'x', brief: 'x', model: 'sonnet', thinking: 'low', accounts: ['Main', 'Helper'] });
    expect(t).toMatchObject({ account: 'Main', thinking: 'low' });
    expect(fires.at(-1)!.text.startsWith('{')).toBe(true);
    const u = await h.updateThread(t.id, { thinking: 'high', accounts: ['Helper'] });
    expect(u).toMatchObject({ thinking: 'high', accounts: ['Helper'] });
  });

  it('starts a New chat as its own thread, with no coordinator and nothing in Project chat', async () => {
    const { createHub } = await lib('hub.js');
    const { memoryStore } = await lib('store.js');
    const h = createHub({ store: memoryStore(), fetchImpl: fakeFetch, now: () => clock });
    await h.upsertAccount({ name: 'Main', plan: 'max', routines: [{ model: 'opus', id: 'trig_c', token: 'good-c' }] });
    const fired = fires.length;
    const r = await h.prompt({ text: 'Why is the board slow?\nDetails here', chat: true, model: 'opus', thinking: 'high' });
    const t = (await h.threads()).find((x: any) => x.id === r.thread);
    expect(t).toMatchObject({ title: 'Why is the board slow?', model: 'opus', thinking: 'high', account: 'Main', status: 'working' });
    expect(fires.length).toBe(fired + 1);
    expect(fires.at(-1)!.payload).toMatchObject({ role: 'worker', thread: r.thread });
    const feed = await h.feed();
    expect(feed.filter((m: any) => m.thread === 0)).toEqual([]);
    expect(feed.find((m: any) => m.thread === r.thread)).toMatchObject({ from: 'XIAO', kind: 'brief', text: 'Why is the board slow?\nDetails here' });
  });

  it('uses Claude\'s five effort levels, xhigh as "think harder"', async () => {
    const { createHub } = await lib('hub.js');
    const { memoryStore } = await lib('store.js');
    const h = createHub({ store: memoryStore(), fetchImpl: fakeFetch, now: () => clock });
    await h.upsertAccount({ name: 'Main', plan: 'max', routines: [{ model: 'sonnet', id: 'trig_x', token: 'good-x' }] });
    const t = await h.createThread({ title: 'x', brief: 'x', model: 'sonnet', thinking: 'xhigh' });
    expect(t.thinking).toBe('xhigh');
    expect(fires.at(-1)!.text.startsWith('think harder\n{')).toBe(true);
  });

  it('deletes one message, tells pages that hold it, and never re-routes its prompt', async () => {
    const { createHub } = await lib('hub.js');
    const { memoryStore } = await lib('store.js');
    const h = createHub({ store: memoryStore(), fetchImpl: fakeFetch, now: () => clock });
    const t = await h.createThread({ title: 'x', brief: 'x', model: 'sonnet' });
    const keep = await h.post({ thread: t.id, from: 'XIAO', kind: 'prompt', text: 'keep me' });
    const drop = await h.post({ thread: t.id, from: 'XIAO', kind: 'prompt', text: 'drop me' });
    const ask = await h.post({ thread: 0, from: 'XIAO', kind: 'prompt', text: 'route me once' });
    const routed = await h.post({ thread: 0, from: 'hub', kind: 'routed', replyTo: ask.id, text: 'One thread (#9)' });
    const before = await h.snapshot();
    expect(await h.deleteMessage(drop.id)).toBe(true);
    expect(await h.deleteMessage(drop.id)).toBe(false);
    expect(await h.deleteMessage(routed.id)).toBe(true);
    const feed = await h.feed();
    expect(feed.map((m: any) => m.id)).toContain(keep.id);
    expect(feed.map((m: any) => m.id)).not.toContain(drop.id);
    const after = await h.snapshot({ since: keep.id });
    expect(after.seq).not.toBe(before.seq);
    expect(after.deleted).toEqual([drop.id, routed.id]);
    // The coordinator's reply is gone, but its prompt still counts as handled.
    expect(await h.start({ name: 'Main', plan: 'max' }, '')).not.toContain('route me once');
    const p = (op: string, body: any) => pageApi({ hub: h, password: PW, method: 'POST', query: { op }, body, headers: { 'x-hub-password': PW } });
    expect((await p('message-delete', { id: keep.id })).status).toBe(200);
    expect((await p('message-delete', { id: keep.id })).status).toBe(404);
  });

  it('archives, restores and deletes threads, and the page reads only what is new', async () => {
    const { createHub } = await lib('hub.js');
    const { memoryStore } = await lib('store.js');
    const h = createHub({ store: memoryStore(), fetchImpl: fakeFetch, now: () => clock });
    const a = await h.createThread({ title: 'keep', brief: 'a', model: 'sonnet' });
    const b = await h.createThread({ title: 'gone', brief: 'b', model: 'sonnet' });
    const first = await h.snapshot();
    expect(first.full).toBe(true);
    const last = first.messages.at(-1).id;
    await h.post({ thread: a.id, from: 'XIAO', kind: 'prompt', text: 'new one' });
    const next = await h.snapshot({ since: last });
    expect(next.full).toBe(false);
    expect(next.messages.map((m: any) => m.text)).toEqual(['new one']);
    expect(next.seq).not.toBe(first.seq);
    await h.updateThread(a.id, { archived: true });
    expect((await h.thread(a.id)).archived).toBe(true);
    expect(await h.overview()).not.toContain('#' + a.id + ' ');
    await h.updateThread(a.id, { archived: false });
    expect(await h.overview()).toContain('#' + a.id + ' ');
    await h.deleteThread(b.id);
    expect(await h.thread(b.id)).toBeNull();
    expect((await h.feed()).some((m: any) => m.thread === b.id)).toBe(false);
    expect((await h.feed()).some((m: any) => m.thread === a.id)).toBe(true);
  });

  it('marks an account connected once its link is used', async () => {
    await page('account', { name: 'Conn', plan: 'free' });
    const before = (await page('state')).body.accounts.find((x: any) => x.name === 'Conn');
    expect(before.connected).toBe(false);
    const key = (await page('connect&account=Conn')).body.key;
    await mcp('Conn', 'tools/list', {}, key);
    const after = (await page('state')).body.accounts.find((x: any) => x.name === 'Conn');
    expect(after.connected).toBe(true);
    await page('account-remove', { name: 'Conn' });
  });
});

describe('cloud hub: usage per account', () => {
  it('reads 5-hour and weekly use from Claude and marks an account low at 85%', async () => {
    const { createHub } = await lib('hub.js');
    const { memoryStore } = await lib('store.js');
    const h = createHub({ store: memoryStore(), fetchImpl: fakeFetch, now: () => clock });
    await h.upsertAccount({ name: 'Main', plan: 'max', routines: [{ model: 'opus', id: 'trig_u', token: 'good-u' }] });
    await h.upsertAccount({ name: 'Bad', plan: 'pro', routines: [{ model: 'opus', id: 'trig_b', token: 'nope' }] });
    await h.upsertAccount({ name: 'Free1', plan: 'free' });
    usageReply = { five_hour: { utilization: 91, resets_at: '2026-10-20T15:00:00Z' }, seven_day: { utilization: 40, resets_at: '2026-10-24T00:00:00Z' } };
    await h.refreshUsage({ force: true });
    const main = h.publicAccount(await h.account('Main'));
    expect(main.usage).toMatchObject({ five_hour_pct: 91, seven_day_pct: 40, source: 'claude', five_hour_resets: '2026-10-20T15:00:00Z' });
    expect(main.low).toBe(true);
    expect(h.publicAccount(await h.account('Bad')).usageErr).toContain('401');
    expect((await h.connLog()).some((e: any) => e.http === 'USAGE' && e.account === 'Main' && e.keyOk)).toBe(true);
    await h.setUsage('Free1', { five_hour_pct: '20', seven_day_pct: '' });
    expect(h.publicAccount(await h.account('Free1')).usage).toMatchObject({ five_hour_pct: 20, seven_day_pct: null, source: 'manual' });
    usageReply = null;
  });
  it('keeps thinking notes for the page: no state change, not in agents\' context or hub_wait', async () => {
    const t = await hub.createThread({ title: 'Think test', brief: 'Try thinking notes', model: 'sonnet' });
    const before = (await hub.thread(t.id)).status;
    const r = await tool('A', 'hub_post', { thread: t.id, kind: 'thinking', text: 'Debounce beats throttle here' });
    const id = Number(/#(\d+)/.exec(r)![1]);
    const msg = (await hub.feed()).find((m: any) => m.id === id);
    expect(msg.kind).toBe('thinking');
    expect((await hub.thread(t.id)).status).toBe(before);
    expect(await tool('B', 'hub_wait', { thread: t.id, after: id - 1, wait_s: 0 })).toBe('No new messages.');
    const brief = await tool('B', 'hub_start', { payload: JSON.stringify({ hub: 'dop', role: 'worker', thread: t.id }) });
    expect(brief).not.toContain('Debounce beats throttle');
    expect(brief).toContain('kind "thinking"');
    expect((await hub.thread(t.id)).startedAt).toBe(clock);
  });
});

describe('cloud hub: usage-left threshold and team threads', () => {
  let h: any;
  const fresh = async () => {
    const { createHub } = await lib('hub.js');
    const { memoryStore } = await lib('store.js');
    h = createHub({ store: memoryStore(), fetchImpl: fakeFetch, now: () => clock });
    for (const n of ['P1', 'P2', 'P3']) await h.upsertAccount({ name: n, plan: 'max', routines: [{ model: 'sonnet', id: `trig_${n}`, token: `good-${n}` }] });
  };

  it('only gives new work to accounts with at least the minimum usage left, which XIAO can change', async () => {
    await fresh();
    expect((await h.settings()).minLeftPct).toBe(15);
    await h.setUsage('P1', { five_hour_pct: 70, seven_day_pct: 10 }); // 30% left
    await h.setUsage('P2', { five_hour_pct: 20, seven_day_pct: 20 });
    await h.setUsage('P3', { five_hour_pct: 50, seven_day_pct: 50 });
    expect((await h.account('P1')).low).toBe(false);
    // Raise the bar to 40% left: P1 (30% left) is now low and gets nothing.
    await h.saveSettings({ minLeftPct: 40 });
    expect((await h.account('P1')).low).toBe(true);
    const a = await h.createThread({ title: 'T1', brief: 'x', model: 'sonnet' });
    const b = await h.createThread({ title: 'T2', brief: 'x', model: 'sonnet' });
    expect([a.account, b.account].sort()).toEqual(['P2', 'P3']);
    // The freest account goes first when loads are equal.
    expect(a.account).toBe('P2');
    expect(await h.overview()).toContain('at least 40% usage left');
    // Lowering it again clears the automatic low mark.
    await h.saveSettings({ minLeftPct: 5 });
    expect((await h.account('P1')).low).toBe(false);
    expect((await h.saveSettings({ minLeftPct: 500 })).minLeftPct).toBe(95);
  });

  it('runs one thread on several accounts that share messages and hand over per member', async () => {
    await fresh();
    const before = fires.length;
    const t = await h.createThread({ title: 'Big job', brief: 'Split me', model: 'sonnet', team: 3 });
    const started = fires.slice(before);
    expect(started.map((f) => f.payload.role)).toEqual(['worker', 'member', 'member']);
    expect(new Set(started.map((f) => f.routine)).size).toBe(3); // three different accounts
    const lead = t.account;
    const [m1, m2] = Object.keys((await h.thread(t.id)).crew);
    expect([lead, m1, m2].sort()).toEqual(['P1', 'P2', 'P3']);

    const leadBrief = await h.start({ name: lead, plan: 'max' }, JSON.stringify(started[0].payload));
    expect(leadBrief).toContain('You are the lead');
    const memberBrief = await h.start({ name: m1, plan: 'max' }, JSON.stringify(started[1].payload));
    expect(memberBrief).toContain('You are a team member');
    await h.start({ name: m2, plan: 'max' }, JSON.stringify(started[2].payload));

    // The lead addresses one member; everyone sees it.
    await h.agentPost({ name: lead }, { thread: t.id, kind: 'progress', text: `Plan: ${m1} does the UI`, to: m1 });
    expect(h.msgLine((await h.feed()).at(-1))).toContain(`→ ${m1}`);
    // A member's handover is kept apart from the lead's.
    await h.checkpoint({ name: m1 }, { thread: t.id, done: 'UI half', next: 'UI rest', branch: 'b/ui' });
    await h.checkpoint({ name: lead }, { thread: t.id, done: 'core', next: 'merge', branch: 'b/lead' });
    let th = await h.thread(t.id);
    expect(th.checkpoint.next).toBe('merge');
    expect(th.crew[m1].checkpoint.next).toBe('UI rest');
    // A member's done closes only its part.
    await h.agentPost({ name: m2 }, { thread: t.id, kind: 'done', text: 'b/docs pushed' });
    th = await h.thread(t.id);
    expect(th.status).toBe('working');
    expect(th.crew[m2].done).toBe(true);

    // m1 goes quiet while the lead keeps talking: its part moves to another account.
    await h.upsertAccount({ name: 'P4', plan: 'max', routines: [{ model: 'sonnet', id: 'trig_P4', token: 'good-P4' }] });
    clock += 10 * 60_000;
    await h.heartbeat(t.id, lead);
    clock += 6 * 60_000;
    await h.heartbeat(t.id, lead);
    await h.sweep();
    expect(last().payload).toMatchObject({ role: 'member', thread: t.id, replaces: m1 });
    expect(last().routine).toBe('trig_P4');
    th = await h.thread(t.id);
    expect(th.crew[m1].gone).toBe(true);
    expect(th.status).toBe('working'); // the lead is fine
    const repl = await h.start({ name: 'P4', plan: 'max' }, JSON.stringify(last().payload));
    expect(repl).toContain(`You replace ${m1}`);
    expect(repl).toContain('UI rest');

    // Only the lead closes the thread.
    await h.agentPost({ name: lead }, { thread: t.id, kind: 'done', text: 'PR ready' });
    expect((await h.thread(t.id)).status).toBe('done');
  });

  it('says when fewer accounts can join a team than asked', async () => {
    await fresh();
    await h.setUsage('P2', { five_hour_pct: 99 });
    await h.setUsage('P3', { five_hour_pct: 99 });
    const t = await h.createThread({ title: 'Wants three', brief: 'x', model: 'sonnet', team: 3 });
    expect(t.account).toBe('P1');
    const alert = (await h.feed()).filter((m: any) => m.thread === t.id && m.kind === 'alert').at(-1);
    expect(alert.text).toContain('2 more accounts wanted');
  });
});

describe('cloud hub: usage cards explain why numbers are missing', () => {
  it('says why when an account has no token, and reads paid accounts without one as an error not silence', async () => {
    const { createHub } = await lib('hub.js');
    const { memoryStore } = await lib('store.js');
    const h = createHub({ store: memoryStore(), fetchImpl: fakeFetch, now: () => clock });
    await h.upsertAccount({ name: 'NoTok', plan: 'pro', routines: [{ model: 'opus', id: 'trig_n' }] });
    await h.upsertAccount({ name: 'Bare', plan: 'max' });
    await h.refreshUsage({ force: true });
    expect(h.publicAccount(await h.account('NoTok')).usageErr).toContain('no routine');
    expect(h.publicAccount(await h.account('Bare')).usageErr).toContain('no routine');
  });
  it('hub_post with wait_s returns teammates\' replies in the same call', async () => {
    const t = await hub.createThread({ title: 'Post wait', brief: 'Fast comms', model: 'sonnet' });
    const none = await tool('A', 'hub_post', { thread: t.id, text: 'hello?', wait_s: 0.01 });
    expect(none).toContain('Posted #');
    await tool('B', 'hub_post', { thread: t.id, text: 'earlier note' });
    const first = Number(/#(\d+)/.exec(none)![1]);
    const both = await tool('A', 'hub_wait', { thread: t.id, after: first, wait_s: 0 });
    expect(both).toContain('earlier note');
  });
});
