// Linked repos for the hub: XIAO links GitHub repos on the Library page, and
// every agent can browse and read them through the hub (repo_list,
// repo_read), from any account or chat. Public repos need nothing; the
// optional Vercel env var GITHUB_TOKEN also opens private ones and lifts
// GitHub's limit of 60 calls an hour per address. Cloud coding sessions use
// their own add_repo tool to clone one.
const API = 'https://api.github.com';
const READ_CHUNK = 100_000; // characters of text per repo_read
const MAX_IMAGE = 700 * 1024; // bytes of a picture returned as an image
const MAX_LIST = 400; // lines of a listing
const MAX_REPOS = 50;
const TIMEOUT_MS = 20_000;
const K = { repos: 'hub:repos' };
// GitHub answers stay in a warm function instance briefly, so reading the
// same file or folder again costs no GitHub call (60 an hour without a
// token) and no wait. A pinned commit never changes, so it stays longer.
const CACHE_MS = 30_000;
const CACHE_SHA_MS = 10 * 60_000;
const CACHE_MAX_BYTES = 8 * 1024 * 1024;
const ghCache = new Map(); // url|raw|token -> { until, value, size }
let ghCacheBytes = 0;
const SHA_REF = /[?/&=]([0-9a-f]{40})(?:[?&/]|$)/i;
function cacheGet(key) {
  const c = ghCache.get(key);
  if (!c) return undefined;
  if (Date.now() < c.until) return c.value;
  ghCache.delete(key);
  ghCacheBytes -= c.size;
  return undefined;
}
function cachePut(key, value, size, path) {
  if (size > CACHE_MAX_BYTES / 4) return;
  const old = ghCache.get(key);
  if (old) {
    ghCache.delete(key);
    ghCacheBytes -= old.size;
  }
  // Oldest first out (a Map keeps insertion order).
  for (const [k, c] of ghCache) {
    if (ghCacheBytes + size <= CACHE_MAX_BYTES && ghCache.size < 200) break;
    ghCache.delete(k);
    ghCacheBytes -= c.size;
  }
  ghCache.set(key, { until: Date.now() + (SHA_REF.test(path) ? CACHE_SHA_MS : CACHE_MS), value, size });
  ghCacheBytes += size;
}
const TEXT_EXT = /\.(md|markdown|txt|sgf|csv|tsv|json|jsonl|ya?ml|toml|ini|cfg|conf|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|c|h|cc|cpp|hpp|cs|swift|sh|bash|zsh|ps1|html?|css|scss|less|svg|xml|sql|graphql|lock|env\.example|gitignore|gitattributes|editorconfig|dockerfile|makefile|log)$/i;
const IMAGE_TYPE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

const kb = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const parse = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};
const clip = (s, n) => String(s ?? '').trim().slice(0, n);
const cleanThreads = (list) => [...new Set((Array.isArray(list) ? list : String(list || '').split(',')).map((x) => Math.floor(Number(String(x).replace('#', '')))).filter((n) => n > 0))].slice(0, 20);

// "owner/name", "https://github.com/owner/name(.git)", or a link inside the
// repo (".../tree/<branch>/..." gives the branch too).
export function parseRepo(input) {
  const raw = String(input ?? '').trim().replace(/^git@github\.com:/i, 'https://github.com/');
  const m = /^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?(?:\/(?:tree|blob)\/([^/?#]+))?(?:[/?#].*)?$/i.exec(raw);
  if (!m || (/^https?:/i.test(raw) && !/github\.com/i.test(raw))) throw new Error('give a GitHub repo as owner/name or its github.com link');
  if (m[2] === '.' || m[2] === '..') throw new Error('not a repo name');
  return { repo: `${m[1]}/${m[2]}`, ref: m[3] ? decodeURIComponent(m[3]) : '' };
}
const repoKey = (repo) => repo.toLowerCase();
const cleanPath = (p) => {
  const s = String(p ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (s.split('/').some((x) => x === '..')) throw new Error('path may not contain ..');
  return s;
};
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

export function createRepos(hub, { fetchImpl = fetch, token = '' } = {}) {
  const { store } = hub;
  const now = hub.now || (() => Date.now());

  async function gh(path, { raw = false } = {}) {
    const key = `${raw ? 'raw' : 'json'}|${token ? 't' : ''}|${path}`;
    const hit = cacheGet(key);
    if (hit !== undefined) return raw ? hit : structuredClone(hit);
    const value = await ghLive(path, { raw });
    const size = raw ? value.length : JSON.stringify(value).length;
    cachePut(key, raw ? value : structuredClone(value), size, path);
    return value;
  }

  async function ghLive(path, { raw = false } = {}) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${API}${path}`, {
        headers: { 'user-agent': 'dop-hub', accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        signal: ac.signal,
      });
      if (res.ok) return raw ? Buffer.from(await res.arrayBuffer()) : res.json();
      const left = res.headers?.get?.('x-ratelimit-remaining');
      if ((res.status === 403 || res.status === 429) && left === '0') {
        const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
        throw new Error(`GitHub's hourly limit for the hub is used up${reset ? ` until ${new Date(reset).toISOString().slice(11, 16)} UTC` : ''}${token ? '' : ' (60 calls an hour without GITHUB_TOKEN)'}. In a cloud session, add the repo with your add_repo tool instead.`);
      }
      if (res.status === 404) throw new Error(`not found on GitHub${token ? '' : ' (or private: the hub reads private repos only when GITHUB_TOKEN is set in Vercel)'}`);
      throw new Error(`GitHub answered ${res.status}`);
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('GitHub did not answer in time');
      throw e;
    } finally {
      clearTimeout(t);
    }
  }

  async function all() {
    const flat = await store.cmd('HGETALL', K.repos);
    const out = [];
    for (let i = 0; i < flat.length; i += 2) {
      const r = parse(flat[i + 1]);
      if (r?.repo) out.push(r);
    }
    return out.sort((p, q) => p.repo.localeCompare(q.repo));
  }

  async function add(body) {
    const { repo, ref: fromLink } = parseRepo(body.repo);
    const list = await all();
    const old = list.find((r) => repoKey(r.repo) === repoKey(repo));
    if (!old && list.length >= MAX_REPOS) throw new Error(`already ${MAX_REPOS} repos linked; remove one first`);
    // Check it once, so the page can say whether the hub itself can read it.
    let info = null;
    let problem = '';
    try {
      info = await gh(`/repos/${enc(repo)}`);
    } catch (e) {
      problem = e.message;
    }
    const r = {
      repo: info?.full_name || repo,
      ref: clip(body.ref, 100) || fromLink || (body.ref == null ? old?.ref || '' : ''),
      defaultBranch: info?.default_branch || old?.defaultBranch || '',
      description: clip(info?.description, 200),
      private: info ? !!info.private : !!old?.private,
      readable: !!info,
      problem,
      note: clip(body.note ?? old?.note, 2000),
      threads: body.threads != null ? cleanThreads(body.threads) : old?.threads || [],
      at: now(),
    };
    if (old && repoKey(old.repo) !== repoKey(r.repo)) await store.cmd('HDEL', K.repos, repoKey(old.repo));
    await store.cmd('HSET', K.repos, repoKey(r.repo), JSON.stringify(r));
    return r;
  }

  async function remove(input) {
    const { repo } = parseRepo(input);
    const n = await store.cmd('HDEL', K.repos, repoKey(repo));
    if (!n) throw new Error(`${repo} is not linked`);
    return { ok: true };
  }

  async function pageOp(method, op, query, body) {
    if (!op.startsWith('repo-')) return null;
    try {
      if (method === 'GET' && op === 'repo-list') return { status: 200, body: { repos: await all(), token: !!token } };
      if (method === 'POST' && op === 'repo-add') return { status: 200, body: await add(body) };
      if (method === 'POST' && op === 'repo-delete') return { status: 200, body: await remove(body.repo) };
    } catch (e) {
      return { status: 400, body: { error: e.message } };
    }
    return null;
  }

  const line = (r) => `${r.repo}${r.ref ? ` @${r.ref}` : ''}${r.private ? ' (private)' : ''}${r.threads?.length ? ` [${r.threads.map((n) => `#${n}`).join(' ')}]` : ''}${r.description ? `: ${r.description}` : ''}${r.note ? ` — ${r.note}` : ''}${r.readable ? '' : ` (the hub can't read it: ${r.problem || 'unknown'})`}`;
  const HOWTO = 'Read one with repo_read(repo, path). In a cloud coding session, add it with your add_repo tool before you clone, edit or push.';

  const str = { type: 'string' };
  const tools = [
    {
      name: 'repo_list',
      description: `List the GitHub repos ${hub.owner || 'XIAO'} linked on the hub's Library page, with his note on each. thread: only those pointed at that thread (plus the ones for every thread).`,
      inputSchema: { type: 'object', properties: { thread: { type: 'number' } } },
      run: async (a, x) => {
        const tid = Math.floor(Number(x.thread) || 0);
        const list = (await all()).filter((r) => !tid || !r.threads?.length || r.threads.includes(tid));
        return list.length ? `${list.length} linked repo(s). ${HOWTO}\n${list.map(line).join('\n')}` : 'No repos linked yet.';
      },
    },
    {
      name: 'repo_read',
      description: 'Read a GitHub repo through the hub: no path = its top folder, a folder path = what is in it, a file path = the file (text, or a picture as an image). tree: true lists every file in the repo. ref: a branch, tag or commit (default: the linked ref, else the default branch). offset: for long files. Works for any public repo; linked ones are in repo_list.',
      inputSchema: { type: 'object', properties: { repo: str, path: str, ref: str, tree: { type: 'boolean' }, offset: { type: 'number' } }, required: ['repo'] },
      run: async (a, x) => {
        const { repo: asked, ref: fromLink } = parseRepo(x.repo);
        const linked = (await all()).find((r) => repoKey(r.repo) === repoKey(asked));
        const repo = linked?.repo || asked;
        const ref = clip(x.ref, 100) || fromLink || linked?.ref || '';
        const path = cleanPath(x.path);
        const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
        if (x.tree) {
          const branch = ref || linked?.defaultBranch || (await gh(`/repos/${enc(repo)}`)).default_branch;
          const t = await gh(`/repos/${enc(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
          const files = (t.tree || []).filter((e) => e.type === 'blob' && (!path || e.path.startsWith(`${path}/`)));
          const shown = files.slice(0, MAX_LIST).map((e) => `${e.path}  ${kb(e.size || 0)}`);
          return `${repo}@${branch}${path ? ` under ${path}/` : ''}: ${files.length} file(s)${files.length > MAX_LIST || t.truncated ? `, first ${shown.length} shown (narrow it with path)` : ''}.\n${shown.join('\n')}`;
        }
        const c = await gh(`/repos/${enc(repo)}/contents/${enc(path)}${q}`);
        if (Array.isArray(c)) {
          const rows = c
            .sort((p, r) => (p.type === r.type ? p.name.localeCompare(r.name) : p.type === 'dir' ? -1 : 1))
            .slice(0, MAX_LIST)
            .map((e) => (e.type === 'dir' ? `${e.name}/` : `${e.name}  ${kb(e.size || 0)}`));
          return `${repo}${ref ? `@${ref}` : ''}/${path}${path ? '/' : ''} (${c.length} entries):\n${rows.join('\n')}`;
        }
        if (c?.type !== 'file') return `${repo}/${path} is a ${c?.type || 'thing'} the hub can't open.`;
        const head = `${repo}${ref ? `@${ref}` : ''}/${c.path} (${kb(c.size || 0)})`;
        const ext = (/\.([A-Za-z0-9]+)$/.exec(c.name)?.[1] || '').toLowerCase();
        const buf = c.content && c.encoding === 'base64' ? Buffer.from(c.content, 'base64') : await gh(`/repos/${enc(repo)}/contents/${enc(path)}${q}`, { raw: true });
        if (IMAGE_TYPE[ext]) {
          if (buf.length > MAX_IMAGE) return `${head}: a picture over ${kb(MAX_IMAGE)}, too big to show here.`;
          return { content: [{ type: 'image', data: buf.toString('base64'), mimeType: IMAGE_TYPE[ext] }, { type: 'text', text: head }] };
        }
        // Text unless it has NUL bytes in its first 8 KB (how git spots binary files).
        if (!TEXT_EXT.test(c.name) && buf.subarray(0, 8192).includes(0)) return `${head}: a binary file; the hub shows text and pictures only.`;
        const text = buf.toString('utf8');
        const from = Math.max(0, Math.floor(Number(x.offset) || 0));
        const part = text.slice(from, from + READ_CHUNK);
        const end = from + part.length;
        return `${head}${from || end < text.length ? `, characters ${from}-${end} of ${text.length}${end < text.length ? `; ask again with offset: ${end} for the rest` : ''}` : ''}:\n${part}`;
      },
    },
  ];

  return { pageOp, tools, all, add, remove };
}

// One per hub object (the tools list is rebuilt on every MCP call).
const made = new WeakMap();
export function reposOf(hub, env = process.env) {
  if (!made.has(hub)) made.set(hub, createRepos(hub, { token: env.GITHUB_TOKEN || '' }));
  return made.get(hub);
}
export const repoTools = (hub) => reposOf(hub).tools;
