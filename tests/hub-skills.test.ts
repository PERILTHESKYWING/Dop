// Shared skills and ask_user (hub/lib/tools-skills.js) on the in-memory store.
import { beforeAll, describe, expect, it } from 'vitest';

const lib = (p: string) => import(/* @vite-ignore */ `../hub/lib/${p}` as string) as Promise<any>;

let hub: any, tools: any[], t: number, sk: any;
const A = { name: 'ME' };
const B = { name: 'Dad' };
const run = (who: any, name: string, args: any = {}) => tools.find((x) => x.name === name).run(who, args) as Promise<string>;
const qs = (n = 2) => [{ header: 'Scope', question: 'What is in scope?', options: Array.from({ length: n }, (_, i) => ({ label: `Opt ${i}`, description: 'd' })) }];

beforeAll(async () => {
  const { createHub } = await lib('hub.js');
  const { memoryStore } = await lib('store.js');
  sk = await lib('tools-skills.js');
  hub = createHub({ store: memoryStore(), fetchImpl: (async () => { throw new Error('offline'); }) as any });
  await hub.upsertAccount({ name: 'ME', plan: 'max' });
  await hub.upsertAccount({ name: 'Dad', plan: 'max' });
  tools = sk.skillTools(hub);
  t = (await hub.createThread({ title: 't', brief: 'b', code: false })).id;
});

describe('shared skills', () => {
  it('lists the bundled skills for every account', async () => {
    const out = await run(A, 'skill_list');
    expect(out).toContain('/clarify');
    expect(out).toContain('/premortem');
    for (const n of ['be-ambitious', 'altitude', 'depth', 'range', 'outside-judge', 'keep-going']) expect(out).toMatch(new RegExp(`^/${n}[ :]`, 'm'));
    expect(await run(B, 'skill_list')).toBe(out);
  });

  it('returns a skill with the ask_user hint, accepting a leading slash', async () => {
    const out = await run(B, 'skill_get', { name: '/clarify' });
    expect(out).toContain('ask_user');
    expect(out).toContain('AskUserQuestion');
    expect(await run(B, 'skill_get', { name: 'nope' })).toContain('No skill');
  });

  it('saves a skill for everyone', async () => {
    await expect(run(A, 'skill_put', { name: 'mine', content: 'no frontmatter' })).rejects.toThrow('frontmatter');
    expect(await run(A, 'skill_put', { name: 'mine', content: '---\nname: mine\ndescription: Does a thing.\n---\nbody' })).toContain('Saved');
    expect(await run(B, 'skill_list')).toContain('/mine: Does a thing.');
    expect(await run(B, 'skill_put', { name: 'mine', content: '---\ndescription: v2\n---\nx' })).toContain('Replaced');
    expect(await run(A, 'skill_get', { name: 'mine' })).toContain('v2');
  });
});

describe('skills page ops', () => {
  const page = async (method: string, op: string, body: any = {}) => (await sk.skillsOf(hub).pageOp(method, op, {}, body)) as any;

  it('ignores other ops', async () => {
    expect(await page('GET', 'repo-list')).toBeNull();
  });

  it('lists with bundled and overridden flags', async () => {
    const r = await page('GET', 'skill-list');
    const c = r.body.skills.find((s: any) => s.name === 'clarify');
    expect(c).toMatchObject({ bundled: true, overridden: false, by: 'bundled' });
    expect(c.text).toBeUndefined(); // the list stays small; one text comes from skill-get
    expect(c.size).toBeGreaterThan(0);
    const one = await sk.skillsOf(hub).pageOp('GET', 'skill-get', { name: 'clarify' }, {}) as any;
    expect(one.body.text).toContain('---');
    expect((await sk.skillsOf(hub).pageOp('GET', 'skill-get', { name: 'nope' }, {}) as any).status).toBe(404);
  });

  it('saves, overrides a bundled skill, and reverts it on delete', async () => {
    const mk = (d: string) => `---\nname: clarify\ndescription: ${d}\n---\nx`;
    expect((await page('POST', 'skill-save', { name: 'clarify', content: mk('mine') })).body).toMatchObject({ name: 'clarify', replaced: true });
    let c = (await page('GET', 'skill-list')).body.skills.find((s: any) => s.name === 'clarify');
    expect(c).toMatchObject({ overridden: true, by: 'XIAO', description: 'mine' });
    expect((await page('POST', 'skill-delete', { name: 'clarify' })).body).toMatchObject({ reverted: true });
    c = (await page('GET', 'skill-list')).body.skills.find((s: any) => s.name === 'clarify');
    expect(c).toMatchObject({ overridden: false, by: 'bundled' });
  });

  it('removes a custom skill and rejects bad input', async () => {
    await page('POST', 'skill-save', { name: 'tmp', content: '---\ndescription: t\n---\nx' });
    expect((await page('POST', 'skill-delete', { name: 'tmp' })).body.reverted).toBe(false);
    expect(await run(A, 'skill_get', { name: 'tmp' })).toContain('No skill');
    expect((await page('POST', 'skill-delete', { name: 'tmp' })).status).toBe(400);
    expect((await page('POST', 'skill-delete', { name: 'premortem' })).status).toBe(400);
    expect((await page('POST', 'skill-save', { name: 'Bad Name', content: '---\n---' })).status).toBe(400);
    expect((await page('POST', 'skill-save', { name: 'x', content: 'nope' })).status).toBe(400);
  });
});

describe('ask_user', () => {
  it('validates the questions', async () => {
    await expect(run(A, 'ask_user', { thread: t, questions: [] })).rejects.toThrow();
    await expect(run(A, 'ask_user', { thread: t, questions: qs(1) })).rejects.toThrow('2 to 4');
    await expect(run(A, 'ask_user', { thread: t, questions: Array(5).fill(qs()[0]) })).rejects.toThrow('at most 4');
  });

  it('posts a question card and returns XIAO\'s reply', async () => {
    const p = run(A, 'ask_user', { thread: t, questions: qs(), wait_s: 20 });
    await new Promise((r) => setTimeout(r, 300));
    const q = (await hub.feed()).find((m: any) => m.kind === 'question');
    expect(q.meta.questions[0]).toMatchObject({ header: 'Scope', multiSelect: false });
    await hub.prompt({ text: 'Scope: Opt 1', thread: t, replyTo: q.id });
    expect(await p).toContain('Scope: Opt 1');
  }, 15000);

  it('gives up politely when nobody answers', async () => {
    const out = await run(A, 'ask_user', { thread: t, questions: qs(), wait_s: 0 });
    expect(out).toContain('No answer');
  });
});
