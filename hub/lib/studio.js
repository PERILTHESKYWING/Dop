// Storytime studio backend: projects, revisions, notes, feedback, sheets and
// style rules, kept in the hub's store (hub:studio:*). The page (hub/studio.html)
// draws the project and uploads a contact sheet per revision; Claude agents
// read and write the project through the studio_* MCP tools. The format of a
// project is owned by hub/studio/schema.js (validateProject, lintProject).
const KEEP_REVS = 10;
const KEEP_NOTES = 100;
const KEEP_LOG = 500;
const MAX_PROJECT = 300 * 1024; // chars of JSON; a put writes it twice and Upstash caps a request at 1 MB
const MAX_SHEET = 380 * 1024; // decoded PNG bytes
const MAX_RULES = 6000;
const MAX_STYLE = 4000;
const SHEET_WAIT_MAX_S = 30;
const MAX_REFS = 60; // reference entries kept; the oldest go first
const MAX_REF_IMAGES = 4; // per entry: one picture, or up to 4 frames pulled from a video
const MAX_REF_IMAGE = 150 * 1024; // decoded bytes per image (the page shrinks pictures before upload)
const K = {
  seq: 'hub:studio:seq',
  index: 'hub:studio:index',
  rules: 'hub:studio:rules',
  log: 'hub:studio:log',
  proj: (id) => `hub:studio:p:${id}`,
  revs: (id) => `hub:studio:r:${id}`,
  notes: (id) => `hub:studio:n:${id}`,
  sheet: (id) => `hub:studio:sheet:${id}`,
  refs: 'hub:studio:refs',
  refSeq: 'hub:studio:refseq',
  refImg: (id, n) => `hub:studio:refimg:${id}:${n}`,
};
const ID_RE = /^s\d{1,8}$/;
const REF_RE = /^r\d{1,8}$/;
const IMG_MAGICS = { png: [0x89, 0x50, 0x4e, 0x47], jpeg: [0xff, 0xd8, 0xff], webp: [0x52, 0x49, 0x46, 0x46] };
const IMG_MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s, max) => String(s ?? '').trim().slice(0, max);
const parse = (s, fallback = null) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};
const fail = (message) => Object.assign(new Error(message), { studio: true });

// Plain style numbers/strings/booleans, at most two levels deep, so a bad
// nightly run (or a typo) can never store something the page can't read.
export function cleanStyle(v) {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) throw fail('style must be an object');
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(k)) throw fail(`style key "${k}" is not a plain name`);
    if (val === null) out[k] = null; // null = remove this key
    else if (typeof val === 'number') {
      if (!Number.isFinite(val)) throw fail(`style ${k} is not a finite number`);
      out[k] = val;
    } else if (typeof val === 'boolean') out[k] = val;
    else if (typeof val === 'string') out[k] = val.slice(0, 80);
    else if (typeof val === 'object' && !Array.isArray(val)) out[k] = cleanStyle(val);
    else throw fail(`style ${k} must be a number, text, true/false or a small object`);
  }
  return out;
}

function mergeStyle(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else if (v && typeof v === 'object') out[k] = mergeStyle(out[k] && typeof out[k] === 'object' ? out[k] : {}, v);
    else out[k] = v;
  }
  return out;
}

const lines = (v) => {
  if (v == null || v === true) return [];
  if (typeof v === 'string') return v.trim() ? [v.trim()] : [];
  const list = Array.isArray(v) ? v : Array.isArray(v.problems) ? v.problems : Array.isArray(v.errors) ? v.errors : Array.isArray(v.warnings) ? v.warnings : [];
  return list.map((x) => (typeof x === 'string' ? x : x?.message || JSON.stringify(x))).filter(Boolean);
};

// The format owner's checks. Loaded on first use so the backend still runs
// (with a bare object check) if the schema file is missing.
let schemaPromise = null;
async function loadSchema() {
  schemaPromise ||= import('../studio/schema.js').catch(() => ({}));
  return schemaPromise;
}

export function studioBrief(p) {
  return [
    `Storytime animation studio, project ${p.id} "${p.title}". XIAO's idea: ${p.idea}`,
    '',
    'You work only through the studio_* tools (and hub_* to talk to your team). Never draw by hand outside the project file: characters are code-drawn rigs in the project JSON, so they stay identical in every shot.',
    '- studio_get(id): the project, the style rules XIAO has taught the studio, and the latest feedback from XIAO. Read it first and obey the rules.',
    '- studio_put(id, project, note): save the next version. It is checked; fix every problem it lists. The page redraws it live and uploads a contact sheet of the frames.',
    '- studio_look(id, wait_s): the latest sheet as an image plus lint warnings. Look at it before you call a version good.',
    '- studio_note(id, text): a short remark XIAO sees (what you changed, what you doubt).',
    '- studio_refs(kind?, ref?): XIAO\'s reference pictures and video frames: DO = copy this look and acting, DON\'T = avoid this. Call it ONCE at the start (it is empty until XIAO adds some) and again if a note says refs changed.',
    '',
    'Team: the lead is the director and writes the storyboard. The other account is the critic: it looks at each sheet and notes drawing, pose, movement and consistency problems (same character, same colours, same size across shots). At most 2 critique rounds per request; stop after that and let XIAO react. Keep each tool call small and each note to one or two sentences: this runs on free-tier usage.',
    'Style target: hand-made storytime animation. Few simple reusable movements, poses held on 2s and 3s, slightly wobbly redrawn lines, small imperfections. Convincing handmade beats smooth and polished.',
    'Order of work: (1) a short SAMPLE (one or two shots) for XIAO to review; (2) when feedback arrives as a message in this thread, revise that sample and show it again; (3) only when XIAO asks for the full video, extend the project to the whole story. Never invent features the schema lacks.',
    'Feedback arrives as thread messages that start with "Studio feedback". Treat any line marked RULE as a permanent rule.',
    'References: the director reads studio_refs before drawing and follows every DO and avoids every DON\'T (note one line on how). The critic compares each sheet to the refs and names the biggest gap, e.g. "Leo still reads as stacked shapes like DON\'T #3". References are XIAO\'s taste: never overrule them.',
    'Critic: call studio_look(id, wait_s: 25). If no sheet arrives (XIAO\'s page is closed), critique from the lint and the JSON instead and say so.',
    'This thread has no code: no branch, no commits, no pull request, no repo checks, whatever the general team rules say. When the version for this request is saved and noted, post kind "done" with one line (e.g. "Sample rev 2 ready: Leo angrier, point held 1 s longer").',
  ].join('\n');
}

export function createStudio(hub, { schema = null } = {}) {
  const { store } = hub;
  const now = () => hub.now();
  const sch = async () => schema || loadSchema();

  const meta = async (id) => {
    if (!ID_RE.test(String(id))) throw fail('Unknown project id.');
    const m = parse(await store.cmd('HGET', K.index, id));
    if (!m) throw fail(`No project ${id}.`);
    return m;
  };
  const rulesNow = async () => ({ text: '', style: {}, version: 0, at: 0, ...parse(await store.cmd('GET', K.rules), {}) });
  const logAdd = async (entry) => {
    await store.multi([['RPUSH', K.log, JSON.stringify({ ts: now(), ...entry })], ['LTRIM', K.log, -KEEP_LOG, -1]]);
  };

  // validateProject never throws: it fills defaults (XIAO's style rules as the
  // base style) and lists what it changed. Only a project with nothing to
  // draw is refused; the rest is saved in its cleaned form.
  async function check(project) {
    if (project == null || typeof project !== 'object' || Array.isArray(project)) return { ok: false, problems: ['The project must be a JSON object.'] };
    const s = await sch();
    if (typeof s.validateProject !== 'function') return { ok: true, project, problems: [] };
    const r = await rulesNow();
    const v = s.validateProject(project, { baseStyle: s.normalizeStyle ? s.normalizeStyle(r.style || {}) : undefined });
    return { ok: !!v.ok, project: v.project, problems: lines(v.problems) };
  }
  async function lint(project) {
    const s = await sch();
    return typeof s.lintProject === 'function' ? lines(s.lintProject(project)) : [];
  }

  async function list() {
    const flat = await store.cmd('HGETALL', K.index);
    const out = [];
    for (let i = 0; i < flat.length; i += 2) out.push(parse(flat[i + 1]));
    return out.filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async function create({ idea, title, team = 2, model = 'sonnet', thinking = 'medium' }) {
    idea = clean(idea, 4000);
    if (!idea) throw fail('Say what the story is about.');
    const id = `s${Number(await store.cmd('INCR', K.seq))}`;
    const m = { id, title: clean(title, 80) || clean(idea.split('\n')[0], 60), idea, stage: 'sample', rev: 0, thread: 0, createdAt: now(), updatedAt: now(), by: '', rating: null, sheetRev: 0 };
    await store.cmd('HSET', K.index, id, JSON.stringify(m));
    const t = await hub.createThread({ title: `Studio: ${m.title}`, brief: studioBrief(m), model: ['opus', 'sonnet', 'haiku', 'fable'].includes(model) ? model : 'sonnet', thinking: ['low', 'medium', 'high', 'xhigh', 'max'].includes(thinking) ? thinking : 'medium', team: Math.max(1, Math.min(4, Number(team) || 2)), code: true, from: 'XIAO' });
    m.thread = t.id;
    await store.cmd('HSET', K.index, id, JSON.stringify(m));
    return { id, thread: t.id };
  }

  // since (a rev) and seen (the time of the newest note the page has): the
  // page polls with both and gets { same: true } while nothing changed.
  async function get(id, since, seen) {
    const m = await meta(id);
    if (since != null && since !== '' && Number(since) === m.rev) {
      const last = parse((await store.cmd('LRANGE', K.notes(id), -1, -1))[0]);
      if (!last || last.at <= Number(seen || 0)) return { same: true, rev: m.rev };
    }
    const [project, revs, notes, log, rules] = await Promise.all([
      store.cmd('GET', K.proj(id)),
      store.cmd('LRANGE', K.revs(id), 0, -1),
      store.cmd('LRANGE', K.notes(id), -30, -1),
      store.cmd('LRANGE', K.log, -KEEP_LOG, -1),
      rulesNow(),
    ]);
    const sheet = parse(await store.cmd('GET', K.sheet(id)));
    return {
      meta: m,
      project: parse(project),
      revs: revs.map((r) => parse(r)).filter(Boolean).map(({ project: _p, ...r }) => r),
      notes: notes.map((n) => parse(n)).filter(Boolean),
      feedback: log.map((l) => parse(l)).filter((l) => l && l.id === id).slice(-20),
      sheet: sheet ? { rev: sheet.rev, at: sheet.at } : null,
      rules: { version: rules.version },
    };
  }

  async function put(id, project, note, by) {
    if (typeof project === 'string') {
      project = parse(project);
      if (project == null) throw fail('project is not valid JSON.');
    }
    const v = await check(project);
    if (!v.ok) return { ok: false, problems: v.problems };
    project = v.project;
    const doc = JSON.stringify(project);
    if (doc.length > MAX_PROJECT) throw fail(`The project is ${Math.round(doc.length / 1024)} KB; the limit is ${MAX_PROJECT / 1024} KB. Reuse rigs and moves instead of repeating them.`);
    const m = await meta(id);
    m.rev += 1;
    m.updatedAt = now();
    m.by = by || '';
    const entry = JSON.stringify({ rev: m.rev, at: m.updatedAt, by: m.by, note: clean(note, 300), project });
    await store.multi([
      ['SET', K.proj(id), doc],
      ['RPUSH', K.revs(id), entry],
      ['LTRIM', K.revs(id), -KEEP_REVS, -1],
      ['HSET', K.index, id, JSON.stringify(m)],
    ]);
    return { ok: true, rev: m.rev, problems: v.problems, lint: await lint(project) };
  }

  async function addNote(id, text, by) {
    await meta(id);
    text = clean(text, 600);
    if (!text) throw fail('Empty note.');
    await store.multi([['RPUSH', K.notes(id), JSON.stringify({ at: now(), by, text })], ['LTRIM', K.notes(id), -KEEP_NOTES, -1]]);
  }

  async function feedback(id, text, rule) {
    const m = await meta(id);
    text = clean(text, 2000);
    if (!text) throw fail('Write your feedback first.');
    await logAdd({ kind: rule ? 'rule' : 'feedback', id, rev: m.rev, text });
    if (rule) {
      const r = await rulesNow();
      const body = `${r.text ? r.text.trimEnd() + '\n' : ''}- ${text.replace(/\s*\n\s*/g, ' ')}`;
      await saveRules({ text: body.slice(-MAX_RULES) });
    }
    const message = `Studio feedback on project ${id} (rev ${m.rev}${m.stage === 'full' ? ', full video' : ', sample'}):\n${rule ? 'RULE (permanent): ' : ''}${text}\n\nRead studio_get("${id}"), revise with studio_put, check with studio_look, then say what changed in studio_note. Max 2 critique rounds.`;
    await hub.prompt({ text: message, thread: m.thread });
    return { ok: true, rev: m.rev };
  }

  async function full(id) {
    const m = await meta(id);
    if (!m.rev) throw fail('There is no sample yet.');
    m.stage = 'full';
    m.updatedAt = now();
    await store.cmd('HSET', K.index, id, JSON.stringify(m));
    await logAdd({ kind: 'full', id, rev: m.rev, text: 'XIAO approved the sample and asked for the full video.' });
    await hub.prompt({ text: `Studio: XIAO approved rev ${m.rev} and wants the FULL video for project ${id}. Extend the project to the whole story with studio_put (keep the characters and moves exactly as approved), look at the sheet, note what you did. Max 2 critique rounds.`, thread: m.thread });
    return { ok: true, stage: 'full' };
  }

  async function sheet(id, rev, png) {
    const m = await meta(id);
    rev = Number(rev);
    if (!Number.isInteger(rev) || rev < 1 || rev > m.rev) throw fail('Sheet is for a revision that does not exist.');
    const b64 = String(png || '').replace(/^data:image\/png;base64,/, '').replace(/\s+/g, '');
    if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw fail('The sheet is not base64.');
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length > MAX_SHEET) throw fail(`The sheet is ${Math.round(bytes.length / 1024)} KB; the limit is ${MAX_SHEET / 1024} KB.`);
    if (!PNG_MAGIC.every((b, i) => bytes[i] === b)) throw fail('The sheet is not a PNG.');
    const old = parse(await store.cmd('GET', K.sheet(id)));
    if (old && old.rev > rev) return { ok: true, kept: old.rev }; // a newer one is already stored
    m.sheetRev = rev;
    await store.multi([['SET', K.sheet(id), JSON.stringify({ rev, at: now(), png: b64 })], ['HSET', K.index, id, JSON.stringify(m)]]);
    return { ok: true, rev };
  }

  async function rate(id, rev, good, note) {
    const m = await meta(id);
    m.rating = { rev: Number(rev) || m.rev, good: !!good, note: clean(note, 500), at: now() };
    await store.cmd('HSET', K.index, id, JSON.stringify(m));
    await logAdd({ kind: 'rate', id, rev: m.rating.rev, good: !!good, text: m.rating.note });
    return { ok: true };
  }

  // Replace the rules text and/or merge a style patch (null deletes a key).
  async function saveRules({ text, style }) {
    const r = await rulesNow();
    if (text != null) {
      if (typeof text !== 'string') throw fail('rules text must be text');
      r.text = text.trim().slice(0, MAX_RULES);
    }
    if (style != null) {
      const merged = mergeStyle(r.style, cleanStyle(style));
      if (JSON.stringify(merged).length > MAX_STYLE) throw fail('The style rules are too large.');
      r.style = merged;
    }
    r.version += 1;
    r.at = now();
    await store.cmd('SET', K.rules, JSON.stringify(r));
    return r;
  }

  async function logSince(since) {
    const all = (await store.cmd('LRANGE', K.log, -KEEP_LOG, -1)).map((l) => parse(l)).filter(Boolean);
    const ts = Number(since) || 0;
    return all.filter((l) => l.ts > ts);
  }

  async function look(id, waitS) {
    const end = now() + Math.min(SHEET_WAIT_MAX_S, Math.max(0, Number(waitS) || 0)) * 1000;
    for (;;) {
      const m = await meta(id);
      const s = parse(await store.cmd('GET', K.sheet(id)));
      if ((s && s.rev >= m.rev) || now() >= end || !waitS) return { m, s };
      await sleep(1500);
    }
  }


  // ---- references: XIAO's do / don't pictures and video frames ----
  // Studio-wide (they teach the look of every story). Meta in one hash, each
  // image in its own key so no single store request gets near Upstash's cap.
  // A video is stored as up to 4 frames the page pulled from it, plus a note.
  const refMeta = (r) => ({ id: r.id, kind: r.kind, type: r.type, title: r.title, note: r.note, tags: r.tags, url: r.url, images: r.images, at: r.at, by: r.by });
  async function refList() {
    const flat = await store.cmd('HGETALL', K.refs);
    const out = [];
    for (let i = 0; i < flat.length; i += 2) out.push(parse(flat[i + 1]));
    return out.filter(Boolean).sort((a, b) => a.at - b.at);
  }
  function decodeImage(data) {
    const m = /^data:image\/(png|jpeg|webp);base64,/.exec(String(data || ''));
    const b64 = String(data || '').replace(/^data:image\/[a-z]+;base64,/, '').replace(/\s+/g, '');
    if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw fail('A reference picture is not base64.');
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length > MAX_REF_IMAGE) throw fail(`A reference picture is ${Math.round(bytes.length / 1024)} KB; the limit is ${MAX_REF_IMAGE / 1024} KB (the page shrinks pictures for you).`);
    const type = Object.keys(IMG_MAGICS).find((t) => IMG_MAGICS[t].every((b, i) => bytes[i] === b));
    if (!type || (m && m[1] !== type)) throw fail('A reference picture must be a PNG, JPEG or WebP image.');
    return { b64, type };
  }
  async function refAdd({ kind, title, note, tags, url, images, type }, by = 'XIAO') {
    if (kind !== 'do' && kind !== 'dont') throw fail('Say whether this is a DO or a DON\'T.');
    images = Array.isArray(images) ? images : [];
    if (images.length > MAX_REF_IMAGES) throw fail(`At most ${MAX_REF_IMAGES} pictures per reference (for a video, the page picks frames).`);
    url = clean(url, 500);
    if (url && !/^https?:\/\//i.test(url)) throw fail('The link must start with http:// or https://');
    note = clean(note, 600);
    if (!images.length && !url && !note) throw fail('Add a picture, a link or a note.');
    const decoded = images.map(decodeImage);
    const id = `r${Number(await store.cmd('INCR', K.refSeq))}`;
    const entry = {
      id, kind,
      type: type === 'video' ? 'video' : decoded.length ? 'image' : url ? 'link' : 'note',
      title: clean(title, 80) || (kind === 'do' ? 'DO' : 'DON\'T'),
      note,
      tags: (Array.isArray(tags) ? tags : String(tags || '').split(/[,\s]+/)).map((t) => String(t).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24)).filter(Boolean).slice(0, 8),
      url, images: decoded.map((d) => d.type), at: now(), by: clean(by, 40),
    };
    const ops = decoded.map((d, n) => ['SET', K.refImg(id, n), d.b64]);
    ops.push(['HSET', K.refs, id, JSON.stringify(entry)]);
    await store.multi(ops);
    // Keep the newest MAX_REFS.
    const all = await refList();
    for (const old of all.slice(0, Math.max(0, all.length - MAX_REFS))) await refDel(old.id);
    return { ok: true, id };
  }
  async function refDel(id) {
    if (!REF_RE.test(String(id))) throw fail('Unknown reference.');
    const r = parse(await store.cmd('HGET', K.refs, id));
    if (!r) throw fail(`No reference ${id}.`);
    await store.multi([['HDEL', K.refs, id], ...r.images.map((_, n) => ['DEL', K.refImg(id, n)])]);
    return { ok: true };
  }
  async function refImage(id, n = 0) {
    if (!REF_RE.test(String(id))) throw fail('Unknown reference.');
    const r = parse(await store.cmd('HGET', K.refs, id));
    n = Number(n) || 0;
    if (!r || n < 0 || n >= r.images.length) throw fail('No such picture.');
    const data = await store.cmd('GET', K.refImg(id, n));
    return { type: r.images[n], mime: IMG_MIME[r.images[n]], data };
  }
  const refLine = (r) => `${r.kind === 'do' ? 'DO' : 'DON\'T'} #${r.id.slice(1)} "${r.title}"${r.tags.length ? ` [${r.tags.join(', ')}]` : ''}${r.type === 'video' ? ' (frames from a video)' : ''}: ${r.note || '(no note)'}${r.url ? ` ${r.url}` : ''}`;

  // ---- the page's side (password) ----
  async function pageOp(method, op, query, body) {
    if (!op.startsWith('studio-')) return null;
    try {
      if (method === 'GET') {
        if (op === 'studio-list') return { status: 200, body: { projects: await list() } };
        if (op === 'studio-get') return { status: 200, body: await get(String(query.id || ''), query.since, query.seen) };
        if (op === 'studio-rules') return { status: 200, body: await rulesNow() };
        if (op === 'studio-refs') return { status: 200, body: { refs: await refList() } };
        if (op === 'studio-ref') {
          const im = await refImage(String(query.id || ''), query.n);
          return { status: 200, body: { mime: im.mime, data: im.data } };
        }
        if (op === 'studio-log') return { status: 200, body: { log: await logSince(query.since), now: now() } };
        return null;
      }
      if (op === 'studio-new') return { status: 200, body: await create(body) };
      if (op === 'studio-feedback') return { status: 200, body: await feedback(String(body.id || ''), body.text, !!body.rule) };
      if (op === 'studio-full') return { status: 200, body: await full(String(body.id || '')) };
      if (op === 'studio-sheet') return { status: 200, body: await sheet(String(body.id || ''), body.rev, body.png) };
      if (op === 'studio-rate') return { status: 200, body: await rate(String(body.id || ''), body.rev, body.good, body.note) };
      if (op === 'studio-rules') return { status: 200, body: await saveRules(body) };
      if (op === 'studio-ref-add') return { status: 200, body: await refAdd(body || {}) };
      if (op === 'studio-ref-del') return { status: 200, body: await refDel(String(body.id || '')) };
    } catch (e) {
      return { status: e.studio ? 400 : 500, body: { error: e.message } };
    }
    return null;
  }

  // ---- the agents' side (MCP) ----
  const str = { type: 'string' };
  const tools = [
    {
      name: 'studio_get',
      description: 'Storytime studio: the project (null until the first studio_put), its revisions and notes, XIAO\'s latest feedback on it, and the studio\'s style rules. Read this before every revision and obey the rules.',
      inputSchema: { type: 'object', properties: { id: str }, required: ['id'] },
      run: async (a, x) => {
        const g = await get(String(x.id || ''));
        const r = await rulesNow();
        const s = await sch();
        return JSON.stringify({
          project: g.project,
          stage: g.meta.stage,
          idea: g.meta.idea,
          rev: g.meta.rev,
          thread: g.meta.thread,
          format: typeof s.schemaText === 'function' ? s.schemaText() : undefined,
          rules: { version: r.version, text: r.text, style: r.style },
          feedback: g.feedback.slice(-8),
          notes: g.notes.slice(-8),
          rating: g.meta.rating,
          refs: (await refList()).map(refLine),
        });
      },
    },
    {
      name: 'studio_put',
      description: 'Save the next version of a studio project (the whole project object). It is validated; if problems come back, nothing is saved: fix them and call again. After a save the page redraws it and uploads a contact sheet; use studio_look to see it.',
      inputSchema: { type: 'object', properties: { id: str, project: { type: 'object', description: 'The full project, as a JSON object (a JSON string also works).' }, note: { type: 'string', description: 'One line on what changed.' } }, required: ['id', 'project'] },
      run: async (a, x) => {
        const r = await put(String(x.id || ''), x.project, x.note, a.name);
        if (!r.ok) return `Not saved. Fix these ${r.problems.length} problem${r.problems.length > 1 ? 's' : ''} and call studio_put again:\n- ${r.problems.slice(0, 25).join('\n- ')}`;
        const fixed = r.problems.length ? `\nFixed for you (check these were meant):\n- ${r.problems.slice(0, 15).join('\n- ')}` : '';
        const warn = r.lint.length ? `\nLint (craft and consistency):\n- ${r.lint.slice(0, 15).join('\n- ')}` : '';
        return `Saved rev ${r.rev}.${fixed}${warn}\nThe page redraws it and uploads a sheet within about 10 seconds (it must be open); then studio_look(id: "${x.id}", wait_s: 25) shows it.`;
      },
    },
    {
      name: 'studio_look',
      description: 'The latest contact sheet of a studio project as an image, plus lint warnings (consistency and style problems found by code). wait_s (max 30) waits for the sheet of the newest revision.',
      inputSchema: { type: 'object', properties: { id: str, wait_s: { type: 'number' } }, required: ['id'] },
      run: async (a, x) => {
        const id = String(x.id || '');
        const { m, s } = await look(id, x.wait_s);
        const g = m.rev ? parse(await store.cmd('GET', K.proj(id))) : null;
        const warn = g ? await lint(g) : [];
        const text = [
          s ? (s.rev < m.rev ? `Sheet is for rev ${s.rev}; the newest is rev ${m.rev} (the page has not uploaded it yet; try wait_s).` : `Sheet for rev ${s.rev}.`) : `No sheet yet (newest rev is ${m.rev}). The studio page must be open on a phone or computer to draw it.`,
          warn.length ? `Lint:\n- ${warn.slice(0, 20).join('\n- ')}` : 'Lint: nothing found.',
        ].join('\n');
        return s ? { content: [{ type: 'image', data: s.png, mimeType: 'image/png' }, { type: 'text', text }] } : text;
      },
    },
    {
      name: 'studio_note',
      description: 'Leave a short note on a studio project that XIAO sees on the page (what you changed, what a critic found, what you doubt). One or two sentences.',
      inputSchema: { type: 'object', properties: { id: str, text: str }, required: ['id', 'text'] },
      run: async (a, x) => {
        await addNote(String(x.id || ''), x.text, a.name);
        return 'Noted.';
      },
    },
    {
      name: 'studio_refs',
      description: 'XIAO\'s reference pictures and video frames for how the characters should look and act. DO = copy this; DON\'T = avoid this. Returns the list (kind, title, tags, note) and the pictures as images (up to 6 per call; narrow with kind "do"/"dont" or ref "r3"). Read once before drawing; the critic compares sheets against them.',
      inputSchema: { type: 'object', properties: { kind: { type: 'string', description: '"do" or "dont" to filter' }, ref: { type: 'string', description: 'one reference id, like "r3"' } } },
      run: async (a, x) => {
        let list = await refList();
        if (x.kind === 'do' || x.kind === 'dont') list = list.filter((r) => r.kind === x.kind);
        if (x.ref) list = list.filter((r) => r.id === String(x.ref));
        if (!list.length) return 'No references yet. XIAO has not added any: use the schema and rules as they are, and do not invent a look from them.';
        const content = [{ type: 'text', text: `${list.length} reference${list.length > 1 ? 's' : ''}. Follow every DO, avoid every DON'T.\n${list.map(refLine).join('\n')}` }];
        let n = 0;
        for (const r of list.slice().reverse()) {
          for (let i = 0; i < r.images.length && n < 6; i++, n++) {
            const im = await refImage(r.id, i);
            content.push({ type: 'text', text: `${refLine(r).split(':')[0]} picture ${i + 1}:` }, { type: 'image', data: im.data, mimeType: im.mime });
          }
        }
        return content.length > 1 ? { content } : content[0].text;
      },
    },
  ];

  return { pageOp, tools, create, get, put, feedback, full, sheet, rate, refAdd, refDel, refList, refImage, saveRules, rulesNow, logSince, list, lint, check };
}

// One studio per hub object (the tools list is rebuilt on every MCP call).
const studios = new WeakMap();
export function studioOf(hub) {
  if (!studios.has(hub)) studios.set(hub, createStudio(hub));
  return studios.get(hub);
}
export const studioTools = (hub) => studioOf(hub).tools;
