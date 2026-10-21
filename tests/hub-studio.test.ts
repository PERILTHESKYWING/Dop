// Storytime studio backend (hub/lib/studio.js, hub/studio-nightly.mjs) on the in-memory store.
import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const lib = (p: string) => import(/* @vite-ignore */ `../hub/${p}` as string) as Promise<any>;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40, 1)]).toString('base64');

let hub: any, studio: any, api: any, nightly: any;
const A = { name: 'ME' };
const get = (op: string, query: any = {}) => api.pageApi({ hub, password: 'pw', method: 'GET', query: { op, ...query }, body: {}, headers: { 'x-hub-password': 'pw' } });
const post = (op: string, body: any = {}) => api.pageApi({ hub, password: 'pw', method: 'POST', query: { op }, body, headers: { 'x-hub-password': 'pw' } });
const tool = (name: string, args: any = {}) => studio.tools.find((t: any) => t.name === name).run(A, args);

beforeAll(async () => {
  const { createHub } = await lib('lib/hub.js');
  const { memoryStore } = await lib('lib/store.js');
  const { createStudio } = await lib('lib/studio.js');
  api = await lib('lib/api.js');
  nightly = await lib('studio-nightly.mjs');
  hub = createHub({ store: memoryStore(), fetchImpl: (async () => { throw new Error('offline'); }) as any });
  await hub.upsertAccount({ name: 'ME', plan: 'max' });
  const schema = {
    validateProject: (p: any) => (p.shots ? [] : ['shots is missing']),
    lintProject: (p: any) => (p.shots?.length > 1 ? ['shot 2 has a different colour for Mia'] : []),
  };
  studio = createStudio(hub, { schema });
  // pageApi uses the shared studio of this hub; give it the same schema.
  (await lib('lib/studio.js')).studioOf(hub);
});

describe('studio backend', () => {
  let id = '';
  it('is password protected like the rest of the page API', async () => {
    const r = await api.pageApi({ hub, password: 'pw', method: 'GET', query: { op: 'studio-list' }, body: {}, headers: {} });
    expect(r.status).toBe(401);
  });

  it('makes a project and a team thread with the studio brief', async () => {
    const r = await post('studio-new', { idea: 'A fox who is afraid of the dark', title: 'Fox', team: 2 });
    expect(r.status).toBe(200);
    id = r.body.id;
    const t = await hub.thread(r.body.thread);
    expect(t.brief).toContain('studio_put');
    expect(t.brief).toContain('afraid of the dark');
    expect(t.team).toBe(2);
    expect((await get('studio-list')).body.projects[0].id).toBe(id);
    expect((await post('studio-new', { idea: ' ' })).status).toBe(400);
  });

  it('rejects an invalid project and saves a valid one as a new revision', async () => {
    expect(await tool('studio_put', { id, project: { a: 1 } })).toContain('shots is missing');
    expect((await get('studio-get', { id })).body.meta.rev).toBe(0);
    expect(await tool('studio_put', { id, project: { shots: [1] }, note: 'first' })).toContain('Saved rev 1');
    expect(await tool('studio_put', { id, project: JSON.stringify({ shots: [1, 2] }), note: 'second' })).toContain('Saved rev 2');
    const g = (await get('studio-get', { id })).body;
    expect(g.project.shots).toHaveLength(2);
    expect(g.revs.map((r: any) => r.rev)).toEqual([1, 2]);
    expect(g.revs[0].project).toBeUndefined();
    expect((await get('studio-get', { id, since: 2 })).body).toEqual({ same: true, rev: 2 });
  });

  it('keeps only the last 10 revisions', async () => {
    for (let i = 0; i < 11; i++) await tool('studio_put', { id, project: { shots: [i] } });
    expect((await get('studio-get', { id })).body.revs).toHaveLength(10);
  });

  it('refuses a huge project', async () => {
    await expect(tool('studio_put', { id, project: { shots: ['x'.repeat(310 * 1024)] } })).rejects.toThrow('limit');
  });

  it('takes a sheet, rejects junk, and studio_look returns it with lint', async () => {
    const rev = (await get('studio-get', { id })).body.meta.rev;
    expect((await post('studio-sheet', { id, rev, png: Buffer.from('hello').toString('base64') })).status).toBe(400);
    expect((await post('studio-sheet', { id, rev: rev + 5, png: PNG })).status).toBe(400);
    expect((await post('studio-sheet', { id, rev, png: PNG })).status).toBe(200);
    const out = await tool('studio_look', { id });
    expect(out.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png', data: PNG });
    expect(out.content[1].text).toContain(`Sheet for rev ${rev}`);
    await tool('studio_put', { id, project: { shots: [1, 2] } });
    const stale = await tool('studio_look', { id });
    expect(stale.content[1].text).toContain('not uploaded');
    expect(stale.content[1].text).toContain('different colour');
  });

  it('logs feedback, prompts the thread, and turns RULE feedback into a rule', async () => {
    const m = (await get('studio-get', { id })).body.meta;
    expect((await post('studio-feedback', { id, text: 'Make the fox eyes bigger' })).status).toBe(200);
    expect((await post('studio-feedback', { id, text: 'Never use smooth easing', rule: true })).status).toBe(200);
    const msgs = (await hub.feed(50)).filter((x: any) => x.thread === m.thread && x.kind === 'prompt');
    expect(msgs.map((x: any) => x.text).join('\n')).toContain('RULE (permanent): Never use smooth easing');
    const rules = (await get('studio-rules')).body;
    expect(rules.text).toContain('Never use smooth easing');
    expect(rules.version).toBe(1);
    const got = JSON.parse(await tool('studio_get', { id }));
    expect(got.rules.text).toContain('smooth easing');
    expect(got.feedback.map((f: any) => f.text)).toContain('Make the fox eyes bigger');
    expect((await post('studio-feedback', { id, text: '' })).status).toBe(400);
  });

  it('rates a revision and approves the full video', async () => {
    expect((await post('studio-rate', { id, rev: 3, good: true, note: 'lovely walk' })).status).toBe(200);
    expect((await get('studio-get', { id })).body.meta.rating).toMatchObject({ good: true, note: 'lovely walk' });
    expect((await post('studio-full', { id })).body.stage).toBe('full');
  });

  it('stores notes for the page', async () => {
    expect(await tool('studio_note', { id, text: 'Critic: legs too long in shot 2' })).toBe('Noted.');
    expect((await get('studio-get', { id })).body.notes[0]).toMatchObject({ by: 'ME', text: 'Critic: legs too long in shot 2' });
  });

  it('merges style patches and rejects unsafe ones', async () => {
    await post('studio-rules', { style: { wobble: 1.2, boil: { every: 3 } } });
    await post('studio-rules', { style: { wobble: null, grain: 0.3 } });
    const r = (await get('studio-rules')).body;
    expect(r.style).toEqual({ boil: { every: 3 }, grain: 0.3 });
    expect((await post('studio-rules', { style: { bad: [1] } })).status).toBe(400);
    expect((await post('studio-rules', { style: { 'x y': 1 } })).status).toBe(400);
  });

  it('gives the log since a time', async () => {
    const all = (await get('studio-log', { since: 0 })).body.log;
    expect(all.map((l: any) => l.kind)).toEqual(expect.arrayContaining(['feedback', 'rule', 'rate', 'full']));
    expect((await get('studio-log', { since: Date.now() + 1000 })).body.log).toEqual([]);
  });

  it('works through the MCP endpoint', async () => {
    const agent = await hub.authAgent('ME', (await hub.account('ME')).key);
    const { handleMcp } = await lib('lib/mcp.js');
    const list = await handleMcp(hub, agent, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(list.result.tools.map((t: any) => t.name)).toEqual(expect.arrayContaining(['studio_get', 'studio_put', 'studio_look', 'studio_note']));
  });
});

describe('nightly script', () => {
  const entries = [{ ts: 5, kind: 'feedback', id: 's1', text: 'Too smooth' }, { ts: 6, kind: 'rate', id: 's1', good: false, text: 'floaty' }];
  const rules = { text: '- hold poses on 2s', style: { wobble: 1 }, version: 1 };

  it('builds a small prompt and parses/validates the answer', () => {
    const p = nightly.buildPrompt(rules, entries);
    expect(p).toContain('Too smooth');
    expect(p).toContain('hold poses on 2s');
    expect(p.length).toBeLessThan(3000);
    expect(nightly.parseAnswer('Sure!\n{"rules":"- hold on 3s","style":{"wobble":1.4}}')).toEqual({ text: '- hold on 3s', style: { wobble: 1.4 } });
    expect(() => nightly.parseAnswer('nothing')).toThrow();
    expect(() => nightly.parseAnswer('{"style":{}}')).toThrow('rules');
  });

  it('spends no tokens when there is no new feedback, and calls the model once otherwise', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'studio-'));
    const statePath = path.join(dir, 'state.json');
    let asked = 0;
    const posted: any[] = [];
    const mkFetch = (log: any[]) => (async (url: string, init: any) => {
      const op = new URL(url).searchParams.get('op');
      const since = Number(new URL(url).searchParams.get('since') || 0);
      if (op === 'studio-log') return new Response(JSON.stringify({ log: log.filter((e) => e.ts > since) }));
      if (op === 'studio-rules' && init.method === 'POST') return posted.push(JSON.parse(init.body)), new Response(JSON.stringify({}));
      return new Response(JSON.stringify(rules));
    }) as any;
    const ask = async () => (asked++, '{"rules":"- hold on 3s","style":{"wobble":1.4}}');
    const base = { url: 'http://hub', password: 'pw', statePath, ask, say: () => {} };
    expect((await nightly.run({ ...base, fetchImpl: mkFetch([]) })).changed).toBe(false);
    expect(asked).toBe(0);
    expect((await nightly.run({ ...base, fetchImpl: mkFetch(entries) })).changed).toBe(true);
    expect(asked).toBe(1);
    expect(posted[0]).toEqual({ text: '- hold on 3s', style: { wobble: 1.4 } });
    // The next night nothing is new again.
    await nightly.run({ ...base, fetchImpl: mkFetch(entries) });
    expect(asked).toBe(1);
  });
});
