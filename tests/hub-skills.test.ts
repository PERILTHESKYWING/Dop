// Shared skills and ask_user (hub/lib/tools-skills.js) on the in-memory store.
import { beforeAll, describe, expect, it } from 'vitest';

const lib = (p: string) => import(/* @vite-ignore */ `../hub/lib/${p}` as string) as Promise<any>;

let hub: any, tools: any[], t: number;
const A = { name: 'ME' };
const B = { name: 'Dad' };
const run = (who: any, name: string, args: any = {}) => tools.find((x) => x.name === name).run(who, args) as Promise<string>;
const qs = (n = 2) => [{ header: 'Scope', question: 'What is in scope?', options: Array.from({ length: n }, (_, i) => ({ label: `Opt ${i}`, description: 'd' })) }];

beforeAll(async () => {
  const { createHub } = await lib('hub.js');
  const { memoryStore } = await lib('store.js');
  const sk = await lib('tools-skills.js');
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
