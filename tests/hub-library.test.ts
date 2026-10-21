// XIAO's library (hub/lib/library.js): chunked uploads on the in-memory store,
// the page ops, and what agents see through lib_list / lib_get.
import { beforeAll, describe, expect, it } from 'vitest';

const lib = (p: string) => import(/* @vite-ignore */ `../hub/lib/${p}` as string) as Promise<any>;

let hub: any, library: any, pageApi: any, handleMcp: any, store: any;
let clock = Date.parse('2026-10-21T09:00:00Z');
const A = { name: 'ME', plan: 'max' };
const page = (op: string, body?: any, query: any = {}) =>
  pageApi({ hub, password: 'pw', method: body ? 'POST' : 'GET', query: { op, ...query }, body: body || {}, headers: { 'x-hub-password': 'pw' } });
const tool = (name: string, args: any = {}) => library.tools.find((t: any) => t.name === name).run(A, args);
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');

async function upload(name: string, type: string, data: Buffer, extra: any = {}) {
  const chunk = 900_000;
  const all = data.toString('base64');
  const pieces = [];
  for (let i = 0; i < all.length; i += chunk) pieces.push(all.slice(i, i + chunk));
  const put = await page('lib-put', { name, type, size: data.length, chunks: pieces.length, ...extra });
  expect(put.status).toBe(200);
  for (const [i, d] of pieces.entries()) expect((await page('lib-chunk', { id: put.body.id, part: 'body', i, data: d })).status).toBe(200);
  return put.body.id as string;
}

beforeAll(async () => {
  const { createHub } = await lib('hub.js');
  const { memoryStore } = await lib('store.js');
  ({ pageApi } = await lib('api.js'));
  ({ handleMcp } = await lib('mcp.js'));
  const { libraryOf } = await lib('library.js');
  store = memoryStore();
  hub = createHub({ store, fetchImpl: (async () => { throw new Error('offline'); }) as any, now: () => clock });
  await hub.upsertAccount({ name: 'ME', plan: 'max' });
  library = libraryOf(hub);
});

describe('hub library', () => {
  it('sorts files into kinds', async () => {
    const { kindOf } = await lib('library.js');
    expect(kindOf('a.png', 'image/png')).toBe('image');
    expect(kindOf('a.mp4', 'video/mp4')).toBe('video');
    expect(kindOf('game.sgf', '')).toBe('text');
    expect(kindOf('logo.svg', 'image/svg+xml')).toBe('text');
    expect(kindOf('a.pdf', 'application/pdf')).toBe('file');
  });

  it('uploads a text file in pieces and agents read it back', async () => {
    const text = 'Rules for Leo.\n' + 'é'.repeat(700_000); // multi-byte, over one 900k piece of base64
    const id = await upload('rules.md', 'text/markdown', Buffer.from(text), { note: 'house style', tags: 'studio, #Do', threads: [7] });
    const done = await page('lib-done', { id });
    expect(done.body).toMatchObject({ id, kind: 'text', status: 'ready', tags: ['studio', 'do'], threads: [7], hasBody: true });
    expect(done.body.chunks).toBeGreaterThan(1);
    const got = await tool('lib_get', { id });
    expect(got).toContain('house style');
    expect(got).toContain('Rules for Leo.');
    expect(got).toContain('offset: 100000');
    expect(await tool('lib_get', { id: 'rules.md' })).toContain('Rules for Leo.');
  });

  it('shows a picture as an image, using its small view copy', async () => {
    const id = await upload('pose.jpg', 'image/jpeg', Buffer.alloc(2_000_000, 7), { tags: ['studio', 'dont'] });
    expect((await page('lib-chunk', { id, part: 'view', data: b64('small'), type: 'image/jpeg' })).status).toBe(200);
    await page('lib-done', { id });
    const got = await tool('lib_get', { id });
    expect(got.content[0]).toEqual({ type: 'image', data: b64('small'), mimeType: 'image/jpeg' });
    expect(got.content[1].text).toContain('what NOT to do');
  });

  it('shows a video as its contact sheet and single frames', async () => {
    const id = await upload('walk.mp4', 'video/mp4', Buffer.from('fake video'), { tags: ['studio', 'do'] });
    for (const i of [0, 1, 2]) await page('lib-chunk', { id, part: 'frame', i, data: b64(`frame${i}`) });
    await page('lib-chunk', { id, part: 'sheet', data: b64('sheet') });
    const done = await page('lib-done', { id, frameTimes: [0, 1.25, 2.5] });
    expect(done.body).toMatchObject({ frames: 3, hasSheet: true, frameTimes: [0, 1.3, 2.5] });
    const sheet = await tool('lib_get', { id });
    expect(sheet.content[0].data).toBe(b64('sheet'));
    expect(sheet.content[1].text).toContain('Frames 0-2');
    const f = await tool('lib_get', { id, frame: 2 });
    expect(f.content[0].data).toBe(b64('frame2'));
    expect(f.content[1].text).toContain('at 2.5 s');
    expect(await tool('lib_get', { id, frame: 9 })).toContain('No frame 9');
  });

  it('keeps only frames of a video over the size limit', async () => {
    const put = await page('lib-put', { name: 'long.mov', type: 'video/quicktime', size: 200 * 1024 * 1024, chunks: 300 });
    expect(put.body.keepsBody).toBe(false);
    expect((await page('lib-chunk', { id: put.body.id, part: 'body', i: 0, data: b64('x') })).status).toBe(400);
    await page('lib-chunk', { id: put.body.id, part: 'frame', i: 0, data: b64('f0') });
    expect((await page('lib-done', { id: put.body.id })).body.hasBody).toBe(false);
    expect((await page('lib-put', { name: 'huge.zip', type: 'application/zip', size: 200 * 1024 * 1024 })).status).toBe(400);
  });

  it('refuses unfinished or bad uploads', async () => {
    const put = await page('lib-put', { name: 'two.txt', type: 'text/plain', size: 10, chunks: 1 });
    expect((await page('lib-done', { id: put.body.id })).body.error).toContain('missing');
    expect((await page('lib-chunk', { id: put.body.id, part: 'body', i: 0, data: 'not base64!' })).status).toBe(400);
    expect((await page('lib-chunk', { id: put.body.id, part: 'view', data: b64('x') })).body.error).toContain('only for pictures');
  });

  it('lists, filters, edits and deletes; the page can read pieces back', async () => {
    const list = await page('lib-list');
    expect(list.body.items.length).toBeGreaterThan(3);
    expect(list.body.bytes).toBeGreaterThan(0);
    const out = await tool('lib_list', { tag: 'studio' });
    expect(out).toContain('pose.jpg');
    expect(out).toContain('walk.mp4');
    expect(out).not.toContain('long.mov');
    expect(await tool('lib_list', { thread: 7 })).toContain('rules.md');
    const pose = list.body.items.find((m: any) => m.name === 'pose.jpg');
    const raw = await page('lib-raw', undefined, { id: pose.id, part: 'view' });
    expect(raw.body).toMatchObject({ data: b64('small'), type: 'image/jpeg' });
    expect((await page('lib-edit', { id: pose.id, note: 'arms too stiff', tags: ['studio'] })).body.note).toBe('arms too stiff');
    const before = Number(await store.cmd('GET', 'hub:lib:bytes'));
    expect((await page('lib-delete', { id: pose.id })).status).toBe(200);
    expect(Number(await store.cmd('GET', 'hub:lib:bytes'))).toBeLessThan(before);
    expect(await tool('lib_get', { id: pose.id })).toContain('No library file');
  });

  it('drops uploads left unfinished for an hour', async () => {
    const put = await page('lib-put', { name: 'half.txt', type: 'text/plain', size: 10, chunks: 1 });
    clock += 2 * 3600e3;
    const list = await page('lib-list');
    expect(list.body.items.find((m: any) => m.id === put.body.id)).toBeUndefined();
  });

  it('tells agents about the library and their thread\'s files at start', async () => {
    await store.cmd('HSET', 'hub:repos', 'periltheskywing/kami', JSON.stringify({ repo: 'periltheskywing/kami', threads: [] }));
    const t = await hub.createThread({ title: 'Look at refs', brief: 'x', from: 'XIAO' });
    const rules = (await page('lib-list')).body.items.find((m: any) => m.name === 'rules.md');
    await page('lib-edit', { id: rules.id, threads: [t.id] });
    const text = await hub.threadText(await hub.thread(t.id));
    expect(text).toContain('Library (files XIAO uploaded');
    expect(text).toContain('Attached to this thread');
    expect(text).toContain('rules.md');
    expect(text).toContain('periltheskywing/kami');
  });

  it('serves lib tools over MCP, with images as image content', async () => {
    const list = await handleMcp(hub, A, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const names = list.result.tools.map((t: any) => t.name);
    expect(names).toContain('lib_list');
    expect(names).toContain('lib_get');
    const walk = (await page('lib-list')).body.items.find((m: any) => m.name === 'walk.mp4');
    const call = await handleMcp(hub, A, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'lib_get', arguments: { id: walk.id } } });
    expect(call.result.content[0].type).toBe('image');
  });
});
