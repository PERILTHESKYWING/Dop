// Linked repos (hub/lib/tools-repos.js) with a fake GitHub.
import { beforeAll, describe, expect, it } from 'vitest';

const lib = (p: string) => import(/* @vite-ignore */ `../hub/lib/${p}` as string) as Promise<any>;

let hub: any, repos: any, parseRepo: any;
const calls: string[] = [];
const A = { name: 'ME' };
const json = (body: any, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const README = '# Kami\nExplains Go positions.';

// Just enough of the GitHub API for the tools.
async function fakeGithub(url: string, init: any) {
  calls.push(url);
  const u = new URL(url);
  const p = decodeURIComponent(u.pathname);
  if (p === '/repos/periltheskywing/kami') return json({ full_name: 'PERILTHESKYWING/Kami', default_branch: 'main', private: false, description: 'Kami site' });
  if (p === '/repos/someone/secret') return json({ message: 'Not Found' }, 404);
  if (p === '/repos/busy/repo') return json({ message: 'rate limited' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1792566000' });
  if (p === '/repos/PERILTHESKYWING/Kami/contents/') return json([{ name: 'src', type: 'dir' }, { name: 'README.md', type: 'file', size: README.length }, { name: 'logo.png', type: 'file', size: 4 }]);
  if (p === '/repos/PERILTHESKYWING/Kami/contents/README.md') return json({ type: 'file', name: 'README.md', path: 'README.md', size: README.length, encoding: 'base64', content: Buffer.from(README).toString('base64') });
  if (p === '/repos/PERILTHESKYWING/Kami/contents/logo.png') return json({ type: 'file', name: 'logo.png', path: 'logo.png', size: 4, encoding: 'base64', content: Buffer.from([1, 2, 3, 4]).toString('base64') });
  if (p === '/repos/PERILTHESKYWING/Kami/contents/big.bin' && init.headers.accept.includes('raw')) return new Response(new Uint8Array([0, 1, 2, 0]));
  if (p === '/repos/PERILTHESKYWING/Kami/contents/big.bin') return json({ type: 'file', name: 'big.bin', path: 'big.bin', size: 4, encoding: 'none', content: '' });
  if (p === '/repos/PERILTHESKYWING/Kami/git/trees/dev') return json({ tree: [{ path: 'src', type: 'tree' }, { path: 'src/a.ts', type: 'blob', size: 10 }, { path: 'README.md', type: 'blob', size: 30 }] });
  return json({ message: 'Not Found' }, 404);
}
const tool = (name: string, args: any) => repos.tools.find((t: any) => t.name === name).run(A, args);
const page = (op: string, body?: any) => repos.pageOp(body ? 'POST' : 'GET', op, {}, body || {});

beforeAll(async () => {
  const { createHub } = await lib('hub.js');
  const { memoryStore } = await lib('store.js');
  const m = await lib('tools-repos.js');
  parseRepo = m.parseRepo;
  hub = createHub({ store: memoryStore(), fetchImpl: (async () => { throw new Error('offline'); }) as any, now: () => Date.parse('2026-10-21T09:00:00Z') });
  repos = m.createRepos(hub, { fetchImpl: fakeGithub as any });
});

describe('hub linked repos', () => {
  it('reads owner/name from the ways people paste a repo', () => {
    expect(parseRepo('PERILTHESKYWING/Kami')).toEqual({ repo: 'PERILTHESKYWING/Kami', ref: '' });
    expect(parseRepo('https://github.com/a-b/c.d.git')).toEqual({ repo: 'a-b/c.d', ref: '' });
    expect(parseRepo('github.com/a/b/tree/dev/src/x')).toEqual({ repo: 'a/b', ref: 'dev' });
    expect(parseRepo('git@github.com:a/b.git').repo).toBe('a/b');
    expect(() => parseRepo('https://gitlab.com/a/b')).toThrow('GitHub');
    expect(() => parseRepo('just words')).toThrow();
  });

  it('links a repo, keeps GitHub\'s name, and lists it for agents and the page', async () => {
    const r = (await page('repo-add', { repo: 'https://github.com/periltheskywing/kami/tree/dev', note: 'explain engine', threads: [5] })).body;
    expect(r).toMatchObject({ repo: 'PERILTHESKYWING/Kami', ref: 'dev', readable: true, defaultBranch: 'main', threads: [5] });
    const list = (await page('repo-list')).body;
    expect(list.repos).toHaveLength(1);
    expect(list.token).toBe(false);
    const out = await tool('repo_list', {});
    expect(out).toContain('PERILTHESKYWING/Kami @dev');
    expect(out).toContain('explain engine');
    expect(out).toContain('add_repo');
    expect(await tool('repo_list', { thread: 9 })).toBe('No repos linked yet.');
    // Checking again keeps the note, threads and branch.
    expect((await page('repo-add', { repo: 'PERILTHESKYWING/Kami' })).body).toMatchObject({ ref: 'dev', note: 'explain engine', threads: [5] });
  });

  it('still links a repo the hub cannot read, and says why', async () => {
    const r = (await page('repo-add', { repo: 'someone/secret' })).body;
    expect(r.readable).toBe(false);
    expect(r.problem).toContain('GITHUB_TOKEN');
    expect(await tool('repo_list', {})).toContain("hub can't read it");
    expect((await page('repo-delete', { repo: 'someone/secret' })).status).toBe(200);
    expect((await page('repo-delete', { repo: 'someone/secret' })).status).toBe(400);
  });

  it('lists folders, reads text, shows pictures, refuses binaries', async () => {
    const top = await tool('repo_read', { repo: 'PERILTHESKYWING/Kami', ref: '' });
    expect(top).toMatch(/entries\):\nsrc\/\n/); // folders first
    expect(top).toContain('README.md  ');
    const readme = await tool('repo_read', { repo: 'periltheskywing/kami', path: '/README.md' });
    expect(readme).toContain('Explains Go positions.');
    expect(calls.at(-1)).toContain('ref=dev'); // the linked branch
    const img = await tool('repo_read', { repo: 'PERILTHESKYWING/Kami', path: 'logo.png' });
    expect(img.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(await tool('repo_read', { repo: 'PERILTHESKYWING/Kami', path: 'big.bin' })).toContain('binary');
    await expect(tool('repo_read', { repo: 'PERILTHESKYWING/Kami', path: '../x' })).rejects.toThrow('..');
  });

  it('lists the whole tree', async () => {
    const t = await tool('repo_read', { repo: 'PERILTHESKYWING/Kami', tree: true });
    expect(t).toContain('2 file(s)');
    expect(t).toContain('src/a.ts');
  });

  it('explains GitHub\'s hourly limit', async () => {
    await expect(tool('repo_read', { repo: 'busy/repo', tree: true })).rejects.toThrow(/hourly limit.*add_repo/);
  });
});
