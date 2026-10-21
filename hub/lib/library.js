// XIAO's library: files he uploads on the hub page (reference pictures and
// videos, notes, SGFs, any file) kept in the hub's Upstash store, so every
// agent on every account can read them. The page sends big files in base64
// chunks (a Vercel function takes at most 4.5 MB a request). For pictures it
// also sends a small 'view' copy, and for videos a few frames plus one
// contact 'sheet', because agents can look at images but cannot watch video.
const CHUNK = 900_000; // base64 characters per stored piece (one Upstash request stays under 1 MB)
const MAX_ITEM = 24 * 1024 * 1024; // bytes of one original file
const MAX_LIB = 120 * 1024 * 1024; // stored characters in all, under half of the free 256 MB
const MAX_ITEMS = 500;
const MAX_FRAMES = 16;
const READ_CHUNK = 100_000; // characters of text per lib_get
const STALE_MS = 60 * 60 * 1000; // an upload not finished in an hour is dropped
const K = {
  items: 'hub:lib:items',
  seq: 'hub:lib:seq',
  bytes: 'hub:lib:bytes',
  got: (id) => `hub:lib:got:${id}`,
  part: (id, p) => `hub:lib:part:${id}:${p}`,
  repos: 'hub:repos',
};
const PARTS = ['body', 'view', 'sheet', 'frame'];
const TEXT_EXT = /\.(md|markdown|txt|text|sgf|csv|tsv|json|jsonl|ya?ml|toml|ini|js|mjs|cjs|ts|tsx|jsx|py|sh|html?|css|svg|xml|log|srt|vtt)$/i;

const kb = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const parse = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};
const clip = (s, n) => String(s ?? '').trim().slice(0, n);

export function kindOf(name, type) {
  const t = String(type || '').toLowerCase();
  if (t === 'image/svg+xml') return 'text';
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('text/') || /json|xml|javascript|yaml|x-sgf/.test(t) || TEXT_EXT.test(String(name || ''))) return 'text';
  return 'file';
}

export function cleanTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(',');
  const out = [];
  for (const t of list) {
    const v = String(t).trim().toLowerCase().replace(/^#/, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
    if (v && !out.includes(v)) out.push(v);
  }
  return out.slice(0, 12);
}
const cleanThreads = (list) => [...new Set((Array.isArray(list) ? list : String(list || '').split(',')).map((x) => Math.floor(Number(String(x).replace('#', '')))).filter((n) => n > 0))].slice(0, 20);
const cleanFileName = (n) => clip(n, 120).replace(/[\u0000-\u001f\\]/g, '') || 'file';

// What the page and the agents see of one item.
export function publicItem(m) {
  return {
    id: m.id,
    name: m.name,
    type: m.type,
    kind: m.kind,
    size: m.size,
    note: m.note || '',
    tags: m.tags || [],
    threads: m.threads || [],
    chunks: m.chunks || 0,
    frames: m.frames || 0,
    frameTimes: m.frameTimes || [],
    hasBody: !!m.hasBody,
    hasView: !!m.hasView,
    hasSheet: !!m.hasSheet,
    status: m.status,
    at: m.at,
  };
}

function itemLine(m) {
  const extra = [m.kind === 'video' && m.frames ? `${m.frames} frames${m.hasBody ? '' : ', video not kept'}` : '', m.tags?.length ? m.tags.join(', ') : '', m.threads?.length ? m.threads.map((n) => `#${n}`).join(' ') : ''].filter(Boolean);
  return `${m.id} ${m.kind} "${m.name}" ${kb(m.size || 0)}${extra.length ? ` [${extra.join('; ')}]` : ''}${m.note ? ` — ${m.note}` : ''}`;
}

// A short line for an agent's start text: what is in the library and which
// items belong to this thread. One store round trip.
export async function libSummary(store, threadId, owner = 'XIAO') {
  const [flat, repos] = await store.multi([['HGETALL', K.items], ['HGETALL', K.repos]]);
  const items = [];
  for (let i = 0; i < (flat || []).length; i += 2) {
    const m = parse(flat[i + 1]);
    if (m?.status === 'ready') items.push(m);
  }
  const repoNames = [];
  for (let i = 0; i < (repos || []).length; i += 2) {
    const r = parse(repos[i + 1]);
    if (r && (!r.threads?.length || r.threads.includes(threadId))) repoNames.push(r.repo || repos[i]);
  }
  if (!items.length && !repoNames.length) return '';
  const mine = items.filter((m) => m.threads?.includes(threadId));
  const tags = {};
  for (const m of items) for (const t of m.tags || []) tags[t] = (tags[t] || 0) + 1;
  const lines = [
    `Library (files ${owner} uploaded; read with lib_list / lib_get, pictures and video frames come back as images): ${items.length} file(s)${Object.keys(tags).length ? `, tags ${Object.entries(tags).map(([t, n]) => `${t} ${n}`).join(', ')}` : ''}. Tag "do" = an example to follow, "dont" = what NOT to do.`,
  ];
  if (mine.length) lines.push(`Attached to this thread (read these first):\n${mine.slice(0, 20).map(itemLine).join('\n')}`);
  if (repoNames.length) lines.push(`Linked repos (repo_list / repo_read; in a cloud session, add one with your add_repo tool before coding in it): ${repoNames.slice(0, 20).join(', ')}.`);
  return lines.join('\n');
}

// ---------- files sent in the chat box ----------
// A message keeps a small copy of each file's details, so the page draws its
// chip (and thumbnail) and agents see what to read, with no extra store call.
export const MAX_CHAT_FILES = 10;
const VIEW_BYTES = 650 * 1024; // a picture this small is its own thumbnail (files.js makes a view copy above it)
export function fileRef(m) {
  const thumb = m.hasView ? 'view' : m.kind === 'image' && m.hasBody && m.chunks === 1 && (m.size || 0) <= VIEW_BYTES ? 'body' : m.kind === 'video' && m.frames ? `frame:${Math.floor((m.frames - 1) / 2)}` : m.hasSheet ? 'sheet' : '';
  return { id: m.id, name: m.name, kind: m.kind, type: m.type, size: m.size || 0, ...(thumb ? { thumb } : {}), ...(m.hasBody ? {} : { noBody: true }) };
}
const cleanIds = (ids) => [...new Set((Array.isArray(ids) ? ids : []).map((x) => String(x?.id ?? x).trim().toLowerCase()).filter((x) => /^f\d+$/.test(x)))].slice(0, MAX_CHAT_FILES);

// The library items behind file ids. strict: a missing or unfinished file is an error.
export async function chatFiles(store, ids, { strict = false } = {}) {
  const list = cleanIds(ids);
  if (Array.isArray(ids) && ids.length > MAX_CHAT_FILES && strict) throw new Error(`At most ${MAX_CHAT_FILES} files a message.`);
  if (!list.length) return [];
  const raw = await store.multi(list.map((id) => ['HGET', K.items, id]));
  const out = [];
  raw.forEach((s, i) => {
    const m = parse(s);
    if (m?.status === 'ready') out.push(fileRef(m));
    else if (strict) throw new Error(`File ${list[i]} is ${m ? 'still uploading' : 'gone'}; send it again.`);
  });
  return out;
}

// Point library files at a thread, so its agents see them first in their start text.
export async function attachFiles(store, ids, tid) {
  tid = Math.floor(Number(tid) || 0);
  const list = cleanIds(ids);
  if (!tid || !list.length) return 0;
  const raw = await store.multi(list.map((id) => ['HGET', K.items, id]));
  const saves = [];
  for (const s of raw) {
    const m = parse(s);
    if (!m || m.threads?.includes(tid)) continue;
    m.threads = [...(m.threads || []), tid].slice(-20);
    saves.push(['HSET', K.items, m.id, JSON.stringify(m)]);
  }
  if (saves.length) await store.multi(saves);
  return saves.length;
}

// One short line for an agent: which files a message carries and how to read them.
export const filesLine = (files) => (files?.length ? `Files: ${files.map((f) => `${f.id} ${f.kind} "${f.name}"`).join(', ')} (read each with lib_get)` : '');

export function createLibrary(hub) {
  const { store } = hub;
  const now = hub.now || (() => Date.now());
  const owner = hub.owner || 'XIAO';

  async function items() {
    const flat = await store.cmd('HGETALL', K.items);
    const out = [];
    for (let i = 0; i < flat.length; i += 2) {
      const m = parse(flat[i + 1]);
      if (m) out.push(m);
    }
    return out.sort((p, q) => (q.at || 0) - (p.at || 0));
  }
  const item = async (id) => parse(await store.cmd('HGET', K.items, String(id)));
  const save = (m) => store.cmd('HSET', K.items, m.id, JSON.stringify(m));

  // Every stored piece of an item: { 'body:0': chars, 'view': chars, ... }.
  async function got(id) {
    const flat = await store.cmd('HGETALL', K.got(id));
    const out = {};
    for (let i = 0; i < flat.length; i += 2) out[flat[i]] = Number(flat[i + 1]) || 0;
    return out;
  }
  const pieceKey = (part, i) => (part === 'body' || part === 'frame' ? `${part}:${i}` : part);

  async function remove(id) {
    const pieces = await got(id);
    const used = Object.values(pieces).reduce((s, n) => s + n, 0);
    await store.multi([...Object.keys(pieces).map((p) => ['DEL', K.part(id, p)]), ['DEL', K.got(id)], ['DEL', K.got(`${id}:type`)], ['HDEL', K.items, id], ['INCRBY', K.bytes, -used]]);
    return used;
  }

  // Uploads that never finished (page closed mid-way) free their space.
  async function sweepStale(list) {
    const t = now();
    const stale = list.filter((m) => m.status !== 'ready' && t - (m.at || 0) > STALE_MS);
    for (const m of stale) await remove(m.id);
    return stale.length ? list.filter((m) => !stale.includes(m)) : list;
  }

  async function begin(body) {
    const name = cleanFileName(body.name);
    const type = clip(body.type, 80).toLowerCase() || 'application/octet-stream';
    const kind = kindOf(name, type);
    const size = Math.max(0, Math.floor(Number(body.size) || 0));
    if (size > MAX_ITEM && kind !== 'video') throw new Error(`${name} is ${kb(size)}; the limit is ${kb(MAX_ITEM)} a file`);
    const list = await sweepStale(await items());
    if (list.length >= MAX_ITEMS) throw new Error(`the library already has ${MAX_ITEMS} files; delete some first`);
    // A video over the limit keeps only its frames and sheet.
    const chunks = size > MAX_ITEM ? 0 : Math.max(0, Math.min(Math.ceil((size * 4) / 3 / CHUNK) + 1, Math.floor(Number(body.chunks) || 0)));
    const id = `f${await store.cmd('INCR', K.seq)}`;
    const m = { id, name, type, kind, size, note: clip(body.note, 2000), tags: cleanTags(body.tags), threads: cleanThreads(body.threads), chunks, frames: 0, frameTimes: [], status: 'uploading', at: now(), by: owner };
    await save(m);
    return { id, chunk: CHUNK, keepsBody: chunks > 0 };
  }

  async function chunk(body) {
    const m = await item(body.id);
    if (!m) throw new Error('no such upload');
    if (m.status === 'ready') throw new Error('this file is finished; upload it again to replace it');
    const part = String(body.part || 'body');
    if (!PARTS.includes(part)) throw new Error(`part must be one of ${PARTS.join(', ')}`);
    const i = Math.floor(Number(body.i) || 0);
    if (part === 'body' && (i < 0 || i >= m.chunks)) throw new Error(`body piece ${i} is outside 0-${m.chunks - 1}`);
    if (part === 'frame' && (i < 0 || i >= MAX_FRAMES)) throw new Error(`frame must be 0-${MAX_FRAMES - 1}`);
    if (part !== 'body' && !['image', 'video'].includes(m.kind)) throw new Error(`${part} is only for pictures and videos`);
    const data = String(body.data || '');
    if (!data || data.length > CHUNK) throw new Error(`data must be 1-${CHUNK} base64 characters`);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('data is not base64');
    if (part === 'body' && i < m.chunks - 1 && data.length % 4) throw new Error('every body piece but the last must be a multiple of 4 characters');
    const p = pieceKey(part, i);
    const old = Number(await store.cmd('HGET', K.got(m.id), p)) || 0;
    const total = Number((await store.cmd('GET', K.bytes)) || 0);
    if (total - old + data.length > MAX_LIB) throw new Error(`the library is full (${kb(MAX_LIB)}); delete some files first`);
    const type = part === 'body' ? m.type : /^image\/(jpeg|png|webp|gif)$/.test(String(body.type || '')) ? body.type : 'image/jpeg';
    await store.multi([
      ['SET', K.part(m.id, p), data],
      ['HSET', K.got(m.id), p, data.length],
      ['INCRBY', K.bytes, data.length - old],
      ...(part === 'body' ? [] : [['HSET', K.got(`${m.id}:type`), p, type]]),
    ]);
    return { ok: true };
  }

  async function done(body) {
    const m = await item(body.id);
    if (!m) throw new Error('no such upload');
    const pieces = await got(m.id);
    const missing = [];
    for (let i = 0; i < m.chunks; i++) if (!pieces[`body:${i}`]) missing.push(i);
    if (missing.length) throw new Error(`body pieces missing: ${missing.join(', ')}`);
    const frames = Object.keys(pieces).filter((p) => p.startsWith('frame:')).length;
    for (let i = 0; i < frames; i++) if (!pieces[`frame:${i}`]) throw new Error(`frame ${i} missing (frames must be numbered from 0)`);
    m.hasBody = m.chunks > 0;
    m.hasView = !!pieces.view;
    m.hasSheet = !!pieces.sheet;
    m.frames = frames;
    m.frameTimes = (Array.isArray(body.frameTimes) ? body.frameTimes : []).slice(0, frames).map((s) => Math.round(Number(s) * 10) / 10 || 0);
    m.stored = Object.values(pieces).reduce((s, n) => s + n, 0);
    if (!m.hasBody && !frames && !m.hasView) throw new Error('nothing was uploaded');
    m.status = 'ready';
    m.at = now();
    await save(m);
    return publicItem(m);
  }

  async function edit(body) {
    const m = await item(body.id);
    if (!m) throw new Error('no such file');
    if (body.name != null) m.name = cleanFileName(body.name);
    if (body.note != null) m.note = clip(body.note, 2000);
    if (body.tags != null) m.tags = cleanTags(body.tags);
    if (body.threads != null) m.threads = cleanThreads(body.threads);
    await save(m);
    return publicItem(m);
  }

  async function piece(m, part, i = 0) {
    const p = pieceKey(part, i);
    const [data, type] = await store.multi([['GET', K.part(m.id, p)], ['HGET', K.got(`${m.id}:type`), p]]);
    return data == null ? null : { data, type: part === 'body' ? m.type : type || 'image/jpeg' };
  }

  async function find(ref) {
    const r = String(ref ?? '').trim();
    const byId = /^f\d+$/i.test(r) ? await item(r.toLowerCase()) : null;
    if (byId) return byId;
    const list = (await items()).filter((m) => m.status === 'ready');
    return list.find((m) => m.name === r) || list.find((m) => m.name.toLowerCase() === r.toLowerCase()) || null;
  }

  async function bodyText(m) {
    const bufs = [];
    for (let i = 0; i < m.chunks; i++) {
      const p = await piece(m, 'body', i);
      if (!p) break;
      bufs.push(Buffer.from(p.data, 'base64'));
    }
    return Buffer.concat(bufs).toString('utf8');
  }

  async function pageOp(method, op, query, body) {
    if (!op.startsWith('lib-')) return null;
    try {
      if (method === 'GET' && op === 'lib-list') {
        const list = await sweepStale(await items());
        return { status: 200, body: { items: list.map(publicItem), bytes: Number((await store.cmd('GET', K.bytes)) || 0), max: MAX_LIB, maxItem: MAX_ITEM, chunk: CHUNK } };
      }
      if (method === 'GET' && op === 'lib-raw') {
        const m = await item(query.id);
        if (!m) return { status: 404, body: { error: 'No such file.' } };
        const part = PARTS.includes(query.part) ? query.part : 'body';
        const p = await piece(m, part, Math.floor(Number(query.i) || 0));
        return p ? { status: 200, body: { ...p, chunks: m.chunks } } : { status: 404, body: { error: 'Not stored.' } };
      }
      if (method !== 'POST') return { status: 404, body: { error: 'Not found.' } };
      if (op === 'lib-put') return { status: 200, body: await begin(body) };
      if (op === 'lib-chunk') return { status: 200, body: await chunk(body) };
      if (op === 'lib-done') return { status: 200, body: await done(body) };
      if (op === 'lib-edit') return { status: 200, body: await edit(body) };
      if (op === 'lib-delete') {
        if (!(await item(body.id))) return { status: 404, body: { error: 'No such file.' } };
        await remove(String(body.id));
        return { status: 200, body: { ok: true } };
      }
    } catch (e) {
      return { status: 400, body: { error: e.message } };
    }
    return { status: 404, body: { error: 'Not found.' } };
  }

  const str = { type: 'string' };
  const num = { type: 'number' };
  const img = (p) => ({ type: 'image', data: p.data, mimeType: p.type });
  const tools = [
    {
      name: 'lib_list',
      description: `List ${owner}'s library: files he uploaded on the hub page (reference pictures and videos, notes, any file). Filter by tag (e.g. "studio", "do", "dont"), thread (files attached to that thread), kind (image, video, text, file) or words in the name or note.`,
      inputSchema: { type: 'object', properties: { tag: str, thread: num, kind: { type: 'string', enum: ['image', 'video', 'text', 'file'] }, q: str } },
      run: async (a, x) => {
        const tag = cleanTags([x.tag || ''])[0];
        const tid = Math.floor(Number(x.thread) || 0);
        const q = String(x.q || '').toLowerCase();
        const list = (await items()).filter((m) => m.status === 'ready' && (!tag || m.tags?.includes(tag)) && (!tid || m.threads?.includes(tid)) && (!x.kind || m.kind === x.kind) && (!q || `${m.name} ${m.note}`.toLowerCase().includes(q)));
        if (!list.length) return 'No files match. (Tag "do" = an example to follow, "dont" = what NOT to do.)';
        return `${list.length} file(s). Read one with lib_get(id). Tag "do" = an example to follow, "dont" = what NOT to do.\n${list.map(itemLine).join('\n')}`;
      },
    },
    {
      name: 'lib_get',
      description: 'Read one library file by id (like "f3") or name. A picture comes back as an image. A video comes back as a contact sheet of its frames (frame: n for one frame at full size). Text comes back as text (use offset for long files). Other files: their details only.',
      inputSchema: { type: 'object', properties: { id: str, frame: num, offset: num } },
      run: async (a, x) => {
        const m = await find(x.id);
        if (!m || m.status !== 'ready') return `No library file "${x.id}". See lib_list.`;
        const head = `${itemLine(m)}${m.tags?.includes('dont') ? '\nThis is a "dont": an example of what NOT to do.' : m.tags?.includes('do') ? '\nThis is a "do": an example to follow.' : ''}`;
        if (m.kind === 'image') {
          const p = m.hasView ? await piece(m, 'view') : m.chunks === 1 && /^image\/(jpeg|png|gif|webp)$/.test(m.type) ? await piece(m, 'body', 0) : null;
          if (!p) return `${head}\nThis picture is too big or in a format agents cannot open (HEIC, BMP…), and has no small copy; ask ${owner} to upload it again from the hub page.`;
          return { content: [img(p), { type: 'text', text: head }] };
        }
        if (m.kind === 'video') {
          const times = m.frameTimes || [];
          const at = (i) => (times[i] != null ? ` at ${times[i]} s` : '');
          if (x.frame != null) {
            const i = Math.floor(Number(x.frame) || 0);
            const p = i >= 0 && i < m.frames ? await piece(m, 'frame', i) : null;
            return p ? { content: [img(p), { type: 'text', text: `${head}\nFrame ${i}${at(i)} of ${m.frames}.` }] } : `${head}\nNo frame ${i}; this video has frames 0-${m.frames - 1}.`;
          }
          const list = m.frames ? `Frames 0-${m.frames - 1}${times.length ? ` at ${times.join(', ')} s` : ''}; lib_get(id: "${m.id}", frame: n) shows one at full size.` : 'No frames were saved.';
          const p = m.hasSheet ? await piece(m, 'sheet') : m.frames ? await piece(m, 'frame', 0) : null;
          const what = m.hasSheet ? 'Contact sheet of the frames, left to right, top to bottom.' : p ? 'Frame 0 (no contact sheet saved).' : '';
          return p ? { content: [img(p), { type: 'text', text: `${head}\n${what} ${list}` }] } : `${head}\n${list}`;
        }
        if (m.kind === 'text') {
          const text = await bodyText(m);
          const from = Math.max(0, Math.floor(Number(x.offset) || 0));
          const part = text.slice(from, from + READ_CHUNK);
          const end = from + part.length;
          return `${head}\n${from || end < text.length ? `Characters ${from}-${end} of ${text.length}${end < text.length ? `; ask again with offset: ${end} for the rest` : ''}:\n` : ''}${part}`;
        }
        return `${head}\n${m.type} file; agents cannot open this kind here. ${owner} can download it from the Library page.`;
      },
    },
  ];

  return { pageOp, tools, items, item, begin, chunk, done, edit, remove, find };
}

// One library per hub object (the tools list is rebuilt on every MCP call).
const libs = new WeakMap();
export function libraryOf(hub) {
  if (!libs.has(hub)) libs.set(hub, createLibrary(hub));
  return libs.get(hub);
}
export const libraryTools = (hub) => libraryOf(hub).tools;
export const LIB_LIMITS = { CHUNK, MAX_ITEM, MAX_LIB, MAX_FRAMES };
