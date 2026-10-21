// Storytime studio backend (hub/lib/studio.js, hub/studio-nightly.mjs) on the in-memory store.
import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const lib = (p: string) => import(/* @vite-ignore */ `../hub/${p}` as string) as Promise<any>;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40, 1)]).toString('base64');

let hub: any, studio: any, api: any, nightly: any, SAMPLE: any;
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
  SAMPLE = (await lib('studio/schema.js')).SAMPLE_PROJECT;
  // The real format checks (hub/studio/schema.js), loaded the way the server loads them.
  studio = createStudio(hub);
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
    expect(await tool('studio_put', { id, project: { a: 1 } })).toContain('cast: no characters');
    expect((await get('studio-get', { id })).body.meta.rev).toBe(0);
    expect(await tool('studio_put', { id, project: SAMPLE, note: 'first' })).toContain('Saved rev 1');
    // Unknown values are fixed, saved in their clean form and reported back.
    const odd = { ...SAMPLE, title: 'Second', scenes: [{ ...SAMPLE.scenes[0], bg: 'moon' }, SAMPLE.scenes[1]] };
    const out = await tool('studio_put', { id, project: JSON.stringify(odd), note: 'second' });
    expect(out).toContain('Saved rev 2');
    expect(out).toContain('bg "moon" unknown');
    const g = (await get('studio-get', { id })).body;
    expect(g.project.title).toBe('Second');
    expect(g.project.scenes[0].bg.kind).toBe('plain');
    expect(g.project.style.fps).toBe(12);
    expect(g.revs.map((r: any) => r.rev)).toEqual([1, 2]);
    expect(g.revs[0].project).toBeUndefined();
    expect((await get('studio-get', { id, since: 2 })).body).toEqual({ same: true, rev: 2 });
  });

  it('keeps only the last 10 revisions', async () => {
    for (let i = 0; i < 11; i++) await tool('studio_put', { id, project: { ...SAMPLE, title: `v${i}` } });
    expect((await get('studio-get', { id })).body.revs).toHaveLength(10);
  });

  it('refuses a huge project', async () => {
    const say = 'x'.repeat(140);
    const beats = Array.from({ length: 24 }, (_, t) => ({ t, move: 'talk', face: 'happy', say }));
    const scene = { duration: 30, narration: 'n'.repeat(300), actors: ['mia', 'leo', 'mia', 'leo'].map((who) => ({ who, beats })) };
    await expect(tool('studio_put', { id, project: { ...SAMPLE, scenes: Array(40).fill(scene) } })).rejects.toThrow('limit');
  });

  it('takes a sheet, rejects junk, and studio_look returns it with lint', async () => {
    const rev = (await get('studio-get', { id })).body.meta.rev;
    expect((await post('studio-sheet', { id, rev, png: Buffer.from('hello').toString('base64') })).status).toBe(400);
    expect((await post('studio-sheet', { id, rev: rev + 5, png: PNG })).status).toBe(400);
    expect((await post('studio-sheet', { id, rev, png: PNG })).status).toBe(200);
    const out = await tool('studio_look', { id });
    expect(out.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png', data: PNG });
    expect(out.content[1].text).toContain(`Sheet for rev ${rev}`);
    await tool('studio_put', { id, project: { ...SAMPLE, cast: { ...SAMPLE.cast, sam: { name: 'Sam' } } } });
    const stale = await tool('studio_look', { id });
    expect(stale.content[1].text).toContain('not uploaded');
    expect(stale.content[1].text).toContain('cast.sam: never appears');
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
    // A new note shows up even when the revision has not changed.
    const g = (await get('studio-get', { id })).body;
    const seen = g.notes[g.notes.length - 1].at;
    expect((await get('studio-get', { id, since: g.meta.rev, seen })).body.same).toBe(true);
    expect((await get('studio-get', { id, since: g.meta.rev, seen: seen - 1 })).body.same).toBeUndefined();
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

describe('studio references (do / don\'t)', () => {
  const JPG = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(40, 2)]).toString('base64');
  const PNGURL = 'data:image/png;base64,' + PNG;

  it('is empty at first and tells agents not to invent a look', async () => {
    expect((await get('studio-refs')).body.refs).toEqual([]);
    expect(await tool('studio_refs')).toContain('No references yet');
  });

  it('adds do and dont references with pictures, rejects junk', async () => {
    const a = await post('studio-ref-add', { kind: 'do', title: 'Weight shift', note: 'Hip drops on one side', tags: 'Body, hips!', images: [PNGURL] });
    expect(a.status).toBe(200);
    const b = await post('studio-ref-add', { kind: 'dont', type: 'video', title: 'Stacked shapes', note: 'Looks like circles glued together', images: [JPG, JPG] });
    expect(b.status).toBe(200);
    expect((await post('studio-ref-add', { kind: 'maybe', note: 'x' })).status).toBe(400);
    expect((await post('studio-ref-add', { kind: 'do' })).status).toBe(400);
    expect((await post('studio-ref-add', { kind: 'do', images: ['data:image/png;base64,' + Buffer.from('hello').toString('base64')] })).status).toBe(400);
    expect((await post('studio-ref-add', { kind: 'do', images: [PNGURL, PNGURL, PNGURL, PNGURL, PNGURL] })).status).toBe(400);
    expect((await post('studio-ref-add', { kind: 'do', url: 'javascript:alert(1)' })).status).toBe(400);
    const big = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(160 * 1024)]).toString('base64');
    expect((await post('studio-ref-add', { kind: 'do', images: [big] })).status).toBe(400);
    const refs = (await get('studio-refs')).body.refs;
    expect(refs.map((r: any) => r.kind)).toEqual(['do', 'dont']);
    expect(refs[0].tags).toEqual(['body', 'hips']);
    expect(refs[1].type).toBe('video');
    expect(refs[1].images).toEqual(['jpeg', 'jpeg']);
    const img = (await get('studio-ref', { id: refs[0].id, n: 0 })).body;
    expect(img.mime).toBe('image/png');
    expect(img.data).toBe(PNG);
    expect((await get('studio-ref', { id: refs[0].id, n: 3 })).status).toBe(400);
  });

  it('studio_refs returns the list with images; the brief and studio_get point at it', async () => {
    const out = await tool('studio_refs');
    expect(out.content[0].text).toContain('DO #1 "Weight shift"');
    expect(out.content[0].text).toContain("DON'T #2");
    expect(out.content.filter((c: any) => c.type === 'image')).toHaveLength(3);
    const only = await tool('studio_refs', { kind: 'dont' });
    expect(only.content.filter((c: any) => c.type === 'image')).toHaveLength(2);
    const r = await post('studio-new', { idea: 'refs story' });
    const sid = r.body.id;
    expect((await hub.thread(r.body.thread)).brief).toContain('studio_refs');
    await tool('studio_put', { id: sid, project: SAMPLE });
    expect(JSON.parse(await tool('studio_get', { id: sid })).refs[0]).toContain('DO #1');
  });

  it('lists Library files tagged studio as references for lib_get', async () => {
    const put = (m: any) => hub.store.cmd('HSET', 'hub:lib:items', m.id, JSON.stringify({ status: 'ready', kind: 'video', at: 1, ...m }));
    await put({ id: 'f9', name: 'slump.mp4', note: 'whole body sags when sad', tags: ['studio', 'dont', 'body'] });
    await put({ id: 'f10', name: 'cat.png', note: 'not for the studio', tags: ['cats'] });
    const out = await tool('studio_refs', { kind: 'dont' });
    expect(out.content[0].text).toContain('DON\'T library file "slump.mp4" (video; body): whole body sags when sad. Open with lib_get(id: "f9").');
    expect(out.content[0].text).not.toContain('cat.png');
    expect((await tool('studio_refs', { kind: 'do' })).content[0].text).not.toContain('slump.mp4');
    await hub.store.cmd('HDEL', 'hub:lib:items', 'f9', 'f10');
  });

  it('deletes a reference with its pictures and keeps only the newest 60', async () => {
    expect((await post('studio-ref-del', { id: 'r1' })).status).toBe(200);
    expect((await get('studio-ref', { id: 'r1', n: 0 })).status).toBe(400);
    expect((await post('studio-ref-del', { id: 'r1' })).status).toBe(400);
    for (let i = 0; i < 61; i++) await studio.refAdd({ kind: 'do', note: `n${i}` });
    const refs = (await get('studio-refs')).body.refs;
    expect(refs).toHaveLength(60);
    expect(refs[59].note).toBe('n60');
  });
});

describe('studio rules from the reference videos, studio_new, studio_rules', () => {
  it('ships the reference rules to agents and the page without touching XIAO\'s rules', async () => {
    const { REF_RULES_TEXT } = await lib('studio/ref-rules.js');
    expect(REF_RULES_TEXT).toContain('One focus point per shot');
    const before = (await get('studio-rules')).body;
    expect(before.fromRefs).toBe(REF_RULES_TEXT);
    const r = await post('studio-new', { idea: 'ref rules story' });
    expect((await hub.thread(r.body.thread)).brief).toContain('rules.fromRefs');
    await tool('studio_put', { id: r.body.id, project: SAMPLE });
    expect(JSON.parse(await tool('studio_get', { id: r.body.id })).rules.fromRefs).toBe(REF_RULES_TEXT);
    expect(JSON.parse(await tool('studio_rules')).fromRefs).toBe(REF_RULES_TEXT);
  });

  it('studio_new makes a project on the caller\'s thread without a new team', async () => {
    const t = await hub.createThread({ title: 'worker thread', brief: 'x' });
    const threads = (await hub.threads()).length;
    const out = await tool('studio_new', { idea: 'First video, new character', title: 'First video', thread: t.id });
    const id = /project (s\d+)/.exec(out)![1];
    expect((await hub.threads()).length).toBe(threads);
    const m = (await get('studio-get', { id })).body.meta;
    expect(m).toMatchObject({ title: 'First video', thread: t.id, rev: 0, stage: 'sample' });
    await expect(tool('studio_new', { idea: ' ', thread: t.id })).rejects.toThrow('Say what');
    await expect(tool('studio_new', { idea: 'x', thread: 99999 })).rejects.toThrow('No thread');
  });

  it('studio_rules appends or replaces rule lines', async () => {
    const v0 = (await get('studio-rules')).body;
    expect(await tool('studio_rules', { text: 'Bust close-up by default\n- Captions top centre' })).toContain(`version ${v0.version + 1}`);
    const r = (await get('studio-rules')).body;
    expect(r.text.startsWith(v0.text.trimEnd())).toBe(true);
    expect(r.text).toContain('- Bust close-up by default\n- Captions top centre');
    await tool('studio_rules', { text: 'Only this', mode: 'replace' });
    expect((await get('studio-rules')).body.text).toBe('- Only this');
    await expect(tool('studio_rules', { text: 'x'.repeat(5000) })).resolves.toContain('Saved');
    await expect(tool('studio_rules', { text: 'y'.repeat(2000) })).rejects.toThrow('limit');
  });
});
