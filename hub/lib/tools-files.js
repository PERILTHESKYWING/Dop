// File tools for the hub MCP: every account gets a small file space in the
// hub's Upstash store (free tier: 256 MB), so agents on different accounts
// and devices can hand each other notes, logs, SGFs or small images. Each
// account writes only its own files; any account can read anyone's.
const MAX_FILE = 512 * 1024; // bytes stored per file (Upstash's smallest request cap is 1 MB)
const MAX_ACCOUNT = 8 * 1024 * 1024; // per account
const MAX_HUB = 64 * 1024 * 1024; // all accounts, a quarter of the free 256 MB
const MAX_FILES = 200; // per account
const READ_CHUNK = 100_000; // characters returned per file_get unless asked
const K = { index: (acc) => `hub:files:${acc}`, body: (acc, name) => `hub:file:${acc}:${name}`, total: 'hub:files:bytes' };

const kb = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);
const parse = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

// Names look like paths ("notes/plan.md"): letters, digits, . _ - / and
// spaces, no leading slash, no "..", at most 200 characters.
export function cleanName(name) {
  const n = String(name ?? '').trim().replace(/\/+/g, '/');
  if (!n) throw new Error('name is required');
  if (n.length > 200) throw new Error('name is longer than 200 characters');
  if (!/^[A-Za-z0-9._\- /]+$/.test(n)) throw new Error('name may use only letters, digits, . _ - / and spaces');
  if (n.startsWith('/') || n.endsWith('/') || n.split('/').some((p) => p === '..' || p === '.' || !p.trim()))
    throw new Error('name must be a relative path without . or .. parts');
  return n;
}

export function fileTools(hub) {
  const { store } = hub;
  const now = hub.now || (() => Date.now());
  const str = { type: 'string' };
  const num = { type: 'number' };
  const index = async (acc) => {
    const flat = await store.cmd('HGETALL', K.index(acc));
    const out = {};
    for (let i = 0; i < flat.length; i += 2) out[flat[i]] = parse(flat[i + 1]);
    return out;
  };
  const owner = async (a, x) => {
    const who = String(x.account || a.name).trim();
    if (who !== a.name && !(await hub.account(who))) throw new Error(`no account named ${who}`);
    return who;
  };

  return [
    {
      name: 'file_put',
      description: `Save a file in your account's hub file space (creates or replaces it). Other accounts can read it with file_get. encoding "text" (default) or "base64" for binary such as images. Up to ${kb(MAX_FILE)} per file, ${MAX_ACCOUNT / 1024 / 1024} MB per account.`,
      inputSchema: { type: 'object', properties: { name: str, content: str, encoding: { type: 'string', enum: ['text', 'base64'] }, type: { type: 'string', description: 'Optional media type, e.g. image/png.' } }, required: ['name', 'content'] },
      run: async (a, x) => {
        const name = cleanName(x.name);
        const encoding = x.encoding === 'base64' ? 'base64' : 'text';
        const content = String(x.content ?? '');
        if (encoding === 'base64' && !/^[A-Za-z0-9+/\r\n]*={0,2}\s*$/.test(content)) throw new Error('content is not valid base64');
        const size = encoding === 'base64' ? Buffer.from(content, 'base64').length : Buffer.byteLength(content);
        const stored = Buffer.byteLength(content);
        if (stored > MAX_FILE) throw new Error(`file is ${kb(stored)}; the limit is ${kb(MAX_FILE)}`);
        const files = await index(a.name);
        const old = files[name];
        const used = Object.values(files).reduce((s, f) => s + (f?.stored || 0), 0) - (old?.stored || 0);
        if (!old && Object.keys(files).length >= MAX_FILES) throw new Error(`you already have ${MAX_FILES} files; delete some first`);
        if (used + stored > MAX_ACCOUNT) throw new Error(`your files would use ${kb(used + stored)}; the limit is ${MAX_ACCOUNT / 1024 / 1024} MB. Delete some first`);
        const total = Number((await store.cmd('GET', K.total)) || 0);
        if (total - (old?.stored || 0) + stored > MAX_HUB) throw new Error(`the hub's file space is full (${MAX_HUB / 1024 / 1024} MB); delete some files first`);
        const meta = { size, stored, encoding, type: String(x.type || '').slice(0, 80), at: now() };
        await store.multi([
          ['SET', K.body(a.name, name), content],
          ['HSET', K.index(a.name), name, JSON.stringify(meta)],
          ['INCRBY', K.total, stored - (old?.stored || 0)],
        ]);
        return `${old ? 'Replaced' : 'Saved'} ${name} (${kb(size)}${encoding === 'base64' ? ', base64' : ''}). Others read it with file_get(name: "${name}", account: "${a.name}").`;
      },
    },
    {
      name: 'file_get',
      description: `Read a file from the hub file space: yours, or another account's with account. Text comes back as is (${READ_CHUNK.toLocaleString('en')} characters at a time; use offset for more), base64 files as base64.`,
      inputSchema: { type: 'object', properties: { name: str, account: str, offset: num, length: num }, required: ['name'] },
      run: async (a, x) => {
        const name = cleanName(x.name);
        const who = await owner(a, x);
        const [body, metaS] = await store.multi([['GET', K.body(who, name)], ['HGET', K.index(who), name]]);
        if (body == null) return `No file ${name} in ${who}'s files. See file_list${who === a.name ? '' : `(account: "${who}")`}.`;
        const meta = parse(metaS) || {};
        // Pictures come back as images, so the agent sees them.
        if (meta.encoding === 'base64' && /^image\/(png|jpeg|gif|webp)$/.test(meta.type || '') && !x.offset)
          return { content: [{ type: 'image', data: body, mimeType: meta.type }, { type: 'text', text: `${name} (${kb(meta.size ?? body.length)}, ${meta.type}, by ${who})` }] };
        const from = Math.max(0, Math.floor(Number(x.offset) || 0));
        const len = Math.max(1, Math.min(READ_CHUNK, Math.floor(Number(x.length) || READ_CHUNK)));
        const part = body.slice(from, from + len);
        const head = `${name} (${kb(meta.size ?? body.length)}${meta.encoding === 'base64' ? ', base64' : ''}${meta.type ? `, ${meta.type}` : ''}, by ${who})`;
        if (from === 0 && part.length === body.length) return `${head}:\n${part}`;
        const end = from + part.length;
        return `${head}, characters ${from}-${end} of ${body.length}${end < body.length ? `, ask again with offset: ${end} for the rest` : ''}:\n${part}`;
      },
    },
    {
      name: 'file_list',
      description: 'List files in the hub file space: yours, another account\'s with account, or every account\'s with account "*". Optional prefix, e.g. "notes/".',
      inputSchema: { type: 'object', properties: { account: str, prefix: str } },
      run: async (a, x) => {
        const prefix = String(x.prefix || '');
        const names = x.account === '*' ? Object.keys(await hub.accounts()) : [await owner(a, x)];
        const lines = [];
        let bytes = 0;
        for (const who of names.sort()) {
          const files = await index(who);
          for (const [n, f] of Object.entries(files).sort(([p], [q]) => p.localeCompare(q))) {
            if (!n.startsWith(prefix)) continue;
            bytes += f?.stored || 0;
            const when = f?.at ? new Date(f.at).toISOString().slice(0, 16).replace('T', ' ') : '';
            lines.push(`${names.length > 1 ? `${who}: ` : ''}${n}  ${kb(f?.size || 0)}${f?.encoding === 'base64' ? ' base64' : ''}${f?.type ? ` ${f.type}` : ''}  ${when}`);
          }
        }
        const whose = x.account === '*' ? 'any account' : names[0] === a.name ? 'your files' : `${names[0]}'s files`;
        return lines.length ? `${lines.length} file(s), ${kb(bytes)}:\n${lines.join('\n')}` : `No files${prefix ? ` under ${prefix}` : ''} in ${whose}.`;
      },
    },
    {
      name: 'file_delete',
      description: 'Delete one of your own files from the hub file space.',
      inputSchema: { type: 'object', properties: { name: str }, required: ['name'] },
      run: async (a, x) => {
        const name = cleanName(x.name);
        const meta = parse(await store.cmd('HGET', K.index(a.name), name));
        if (!meta) return `No file ${name} in your files.`;
        await store.multi([['DEL', K.body(a.name, name)], ['HDEL', K.index(a.name), name], ['INCRBY', K.total, -(meta.stored || 0)]]);
        return `Deleted ${name}.`;
      },
    },
  ];
}

// Store an image the hub made (base64) and read any stored file back, for the page.
export async function saveImage(hub, account, name, buf, type) {
  const content = buf.toString('base64');
  const meta = { size: buf.length, stored: content.length, encoding: 'base64', type, at: hub.now() };
  await hub.store.multi([
    ['SET', K.body(account, name), content],
    ['HSET', K.index(account), name, JSON.stringify(meta)],
    ['INCRBY', K.total, content.length],
  ]);
}
export async function readImage(hub, account, name) {
  const n = cleanName(name);
  const [body, metaS] = await hub.store.multi([['GET', K.body(String(account), n)], ['HGET', K.index(String(account)), n]]);
  const meta = parse(metaS) || {};
  if (body == null || meta.encoding !== 'base64' || !/^image\//.test(meta.type || '')) return null;
  return { type: meta.type, data: body };
}
