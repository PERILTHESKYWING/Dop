// Files sent in the hub's chat box: uploaded to the library first, then the
// message carries their ids. Project chat attaches them to every thread the
// coordinator opens; a reply attaches them to its thread and tells the agent.
import { beforeAll, describe, expect, it } from 'vitest';

const lib = (p: string) => import(/* @vite-ignore */ `../hub/lib/${p}` as string) as Promise<any>;

let hub: any, pageApi: any, mcpApi: any, library: any;
const clock = Date.parse('2026-10-21T10:00:00Z');
const fires: any[] = [];
const fakeFetch = async (url: string, init: any) => {
  const m = /routines\/([^/]+)\/fire/.exec(url);
  if (!m) throw new Error('offline');
  const text = JSON.parse(init.body).text as string;
  fires.push(JSON.parse(text.slice(text.indexOf('{'))));
  return new Response(JSON.stringify({ type: 'routine_fire', claude_code_session_url: `https://claude.ai/code/session_${fires.length}` }), { status: 200 });
};
const page = (op: string, body?: any, query: any = {}) =>
  pageApi({ hub, password: 'pw', method: body ? 'POST' : 'GET', query: { op, ...query }, body: body || {}, headers: { 'x-hub-password': 'pw' } });
let key = '';
let rpc = 1;
async function tool(name: string, args: any = {}) {
  const r = await mcpApi({ hub, method: 'POST', query: { account: 'ME', key }, body: { jsonrpc: '2.0', id: rpc++, method: 'tools/call', params: { name, arguments: args } }, headers: {} });
  return r.body.result.content[0].text as string;
}
async function upload(name: string, type: string, text: string) {
  const put = await page('lib-put', { name, type, size: text.length, chunks: 1 });
  await page('lib-chunk', { id: put.body.id, part: 'body', i: 0, data: Buffer.from(text).toString('base64') });
  await page('lib-done', { id: put.body.id });
  return put.body.id as string;
}
const threadsOf = async (id: string) => (await library.item(id)).threads;

beforeAll(async () => {
  const { createHub } = await lib('hub.js');
  const { memoryStore } = await lib('store.js');
  ({ pageApi, mcpApi } = await lib('api.js'));
  const { libraryOf } = await lib('library.js');
  hub = createHub({ store: memoryStore(), fetchImpl: fakeFetch as any, now: () => clock });
  const a = await hub.upsertAccount({ name: 'ME', plan: 'max', routines: [{ id: 'trig_s', model: 'sonnet', token: 'good' }, { id: 'trig_h', model: 'haiku', token: 'good' }] });
  key = a.key;
  library = libraryOf(hub);
});

describe('files in the hub chat box', () => {
  it('a project prompt keeps its files and every routed thread gets them', async () => {
    const f1 = await upload('board.png', 'image/png', 'png bytes');
    const f2 = await upload('notes.md', 'text/markdown', '# notes');
    const r = await page('prompt', { text: 'Fix both of these', thread: 0, files: [f1, f2] });
    expect(r.status).toBe(200);
    expect(r.body.meta.files.map((f: any) => f.id)).toEqual([f1, f2]);
    expect(r.body.meta.files[0]).toMatchObject({ name: 'board.png', kind: 'image', thumb: 'body' });
    // The coordinator's input names the files in one short line.
    const brief = await tool('hub_start', { payload: JSON.stringify({ role: 'coordinator', prompt: r.body.id }) });
    expect(brief).toContain(`Files: ${f1} image "board.png", ${f2} text "notes.md" (read each with lib_get)`);
    expect(brief).toContain('the hub attaches these files to every thread');
    const out = await tool('hub_route', { prompt_id: r.body.id, summary: 'Two threads', threads: [{ title: 'One', brief: 'do one', model: 'sonnet' }, { title: 'Two', brief: 'do two', model: 'haiku' }] });
    const ids = [...out.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
    expect(ids).toHaveLength(2);
    expect(await threadsOf(f1)).toEqual(ids);
    expect(await threadsOf(f2)).toEqual(ids);
    // Each worker's start text lists the files under "Attached to this thread".
    const start = await tool('hub_start', { payload: JSON.stringify({ role: 'worker', thread: ids[0] }) });
    expect(start).toContain('Attached to this thread');
    expect(start).toContain(`${f1} image "board.png"`);
  });

  it('a message may be files only, but not empty, and only finished files go', async () => {
    expect((await page('prompt', { text: '', thread: 0 })).body.error).toBe('Empty prompt.');
    const half = (await page('lib-put', { name: 'half.txt', type: 'text/plain', size: 5, chunks: 1 })).body.id;
    expect((await page('prompt', { text: 'x', thread: 0, files: [half] })).body.error).toMatch(/still uploading/);
    expect((await page('prompt', { text: 'x', thread: 0, files: ['f999'] })).body.error).toMatch(/gone/);
  });

  it('a new chat with only a file becomes a thread named after it, with the file attached', async () => {
    const f = await upload('game.sgf', 'application/x-go-sgf', '(;GM[1])');
    const r = await page('prompt', { text: '', chat: true, files: [f], model: 'sonnet' });
    expect(r.status).toBe(200);
    const t = await hub.thread(r.body.thread);
    expect(t.title).toBe('game.sgf');
    expect(await threadsOf(f)).toEqual([t.id]);
    const brief = (await hub.feed()).find((m: any) => m.thread === t.id && m.kind === 'brief');
    expect(brief.from).toBe('XIAO');
    expect(brief.meta.files[0].id).toBe(f);
  });

  it('a reply attaches its files to the thread and the working agent is told about them', async () => {
    const t = await hub.createThread({ title: 'Work', brief: 'work', model: 'sonnet' });
    await tool('hub_start', { payload: JSON.stringify({ role: 'worker', thread: t.id }) });
    await tool('hub_checkpoint', { thread: t.id, done: 'started', next: 'more' });
    const before = await hub.nextSeq();
    const f = await upload('shot.png', 'image/png', 'png');
    const r = await page('prompt', { text: 'look at this', thread: t.id, files: [f] });
    expect(r.status).toBe(200);
    expect(await threadsOf(f)).toEqual([t.id]);
    const line = `Files: ${f} image "shot.png" (read each with lib_get)`;
    expect(await tool('hub_wait', { thread: t.id, after: before, wait_s: 0 })).toContain(`look at this\n${line}`);
    expect(await tool('hub_read', { thread: t.id })).toContain(line);
    expect(await tool('hub_checkpoint', { thread: t.id, done: 'more', next: 'end' })).toContain(line);
    // Only once: the next handover does not repeat it.
    expect(await tool('hub_checkpoint', { thread: t.id, done: 'end', next: 'pr' })).not.toContain(line);
  });
});
