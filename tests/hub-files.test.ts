// Hub file tools (hub/lib/tools-files.js) on the in-memory store.
import { beforeAll, describe, expect, it } from 'vitest';

const lib = (p: string) => import(/* @vite-ignore */ `../hub/lib/${p}` as string) as Promise<any>;

let hub: any, tools: any[], cleanName: (n: string) => string;
const A = { name: 'ME' };
const B = { name: 'Dad' };
const run = (who: any, name: string, args: any = {}) => tools.find((t) => t.name === name).run(who, args) as Promise<string>;

beforeAll(async () => {
  const { createHub } = await lib('hub.js');
  const { memoryStore } = await lib('store.js');
  const files = await lib('tools-files.js');
  cleanName = files.cleanName;
  hub = createHub({ store: memoryStore(), fetchImpl: (async () => { throw new Error('offline'); }) as any, now: () => Date.parse('2026-10-21T09:00:00Z') });
  await hub.upsertAccount({ name: 'ME', plan: 'max' });
  await hub.upsertAccount({ name: 'Dad', plan: 'max' });
  tools = files.fileTools(hub);
});

describe('hub file tools', () => {
  it('lists the four tools with schemas', () => {
    expect(tools.map((t) => t.name)).toEqual(['file_put', 'file_get', 'file_list', 'file_delete']);
    for (const t of tools) expect(t.inputSchema.type).toBe('object');
  });

  it('saves, reads and replaces a text file', async () => {
    expect(await run(A, 'file_put', { name: 'notes/plan.md', content: '# Plan\nstep 1' })).toContain('Saved notes/plan.md');
    expect(await run(A, 'file_get', { name: 'notes/plan.md' })).toContain('# Plan\nstep 1');
    expect(await run(A, 'file_put', { name: 'notes/plan.md', content: 'v2' })).toContain('Replaced');
    expect(await run(A, 'file_get', { name: 'notes/plan.md' })).toMatch(/:\nv2$/);
  });

  it('lets other accounts read but not write or delete', async () => {
    expect(await run(B, 'file_get', { name: 'notes/plan.md', account: 'ME' })).toMatch(/v2$/);
    expect(await run(B, 'file_get', { name: 'notes/plan.md' })).toContain('No file');
    expect(await run(B, 'file_delete', { name: 'notes/plan.md' })).toContain('No file');
    expect(await run(A, 'file_get', { name: 'notes/plan.md' })).toMatch(/v2$/);
    await expect(run(B, 'file_get', { name: 'x', account: 'Nobody' })).rejects.toThrow('no account');
  });

  it('keeps base64 files and their media type', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64');
    expect(await run(B, 'file_put', { name: 'img/a.png', content: png, encoding: 'base64', type: 'image/png' })).toContain('7 B, base64');
    // Pictures come back as image content, so the agent sees them.
    const got: any = await run(A, 'file_get', { name: 'img/a.png', account: 'Dad' });
    expect(got.content[0]).toEqual({ type: 'image', data: png, mimeType: 'image/png' });
    expect(got.content[1].text).toContain('image/png');
    await expect(run(B, 'file_put', { name: 'bad.bin', content: 'not base64!', encoding: 'base64' })).rejects.toThrow('base64');
  });

  it('lists yours, another account\'s, or everyone\'s, with a prefix', async () => {
    await run(A, 'file_put', { name: 'logs/run.txt', content: 'ok' });
    const mine = await run(A, 'file_list');
    expect(mine).toContain('2 file(s)');
    expect(mine).toContain('logs/run.txt');
    expect(await run(A, 'file_list', { prefix: 'notes/' })).not.toContain('logs/run.txt');
    expect(await run(A, 'file_list', { account: 'Dad' })).toContain('img/a.png');
    const all = await run(A, 'file_list', { account: '*' });
    expect(all).toContain('Dad: img/a.png');
    expect(all).toContain('ME: notes/plan.md');
    expect(await run(A, 'file_list', { prefix: 'zzz/' })).toContain('No files under zzz/');
  });

  it('reads long text in chunks with offset', async () => {
    const big = 'a'.repeat(100_000) + 'b'.repeat(50_000);
    await run(A, 'file_put', { name: 'big.txt', content: big });
    const first = await run(A, 'file_get', { name: 'big.txt' });
    expect(first).toContain('characters 0-100000 of 150000, ask again with offset: 100000');
    expect(first.endsWith('a')).toBe(true);
    const rest = await run(A, 'file_get', { name: 'big.txt', offset: 100_000 });
    expect(rest).toContain('characters 100000-150000 of 150000:');
    expect(rest.endsWith('b'.repeat(50_000))).toBe(true);
    await run(A, 'file_delete', { name: 'big.txt' });
  });

  it('rejects bad names and oversized files', async () => {
    for (const bad of ['', '../x', '/abs', 'a/../b', 'dir/', 'semi;colon', 'x'.repeat(201)]) expect(() => cleanName(bad)).toThrow();
    expect(cleanName('a//b c.txt')).toBe('a/b c.txt');
    await expect(run(A, 'file_put', { name: 'huge.txt', content: 'x'.repeat(512 * 1024 + 1) })).rejects.toThrow('limit');
  });

  it('enforces the per-account cap and frees space on delete', async () => {
    const chunk = 'y'.repeat(500 * 1024);
    let i = 0;
    let err = '';
    try {
      for (; i < 40; i++) await run(B, 'file_put', { name: `fill/${i}.txt`, content: chunk });
    } catch (e: any) {
      err = e.message;
    }
    expect(err).toContain('limit is 8 MB');
    expect(i).toBeGreaterThan(10);
    expect(i).toBeLessThan(17);
    expect(await run(B, 'file_delete', { name: 'fill/0.txt' })).toBe('Deleted fill/0.txt.');
    expect(await run(B, 'file_put', { name: 'fill/again.txt', content: chunk })).toContain('Saved');
    // The hub-wide byte counter follows puts, replaces and deletes.
    const total = Number(await hub.store.cmd('GET', 'hub:files:bytes'));
    const meA = Object.values(Object.fromEntries(chunkPairs(await hub.store.cmd('HGETALL', 'hub:files:ME'))));
    const meB = Object.values(Object.fromEntries(chunkPairs(await hub.store.cmd('HGETALL', 'hub:files:Dad'))));
    const expected = [...meA, ...meB].reduce((s: number, f: any) => s + JSON.parse(f).stored, 0);
    expect(total).toBe(expected);
  });
});

function chunkPairs(flat: string[]) {
  const out: [string, string][] = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}
