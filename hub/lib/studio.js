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
const K = {
  seq: 'hub:studio:seq',
  index: 'hub:studio:index',
  rules: 'hub:studio:rules',
  log: 'hub:studio:log',
  proj: (id) => `hub:studio:p:${id}`,
  revs: (id) => `hub:studio:r:${id}`,
  notes: (id) => `hub:studio:n:${id}`,
  sheet: (id) => `hub:studio:sheet:${id}`,
};
const ID_RE = /^s\d{1,8}$/;
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
    '- studio_get(id): the project, the style rules XIAO has taught the studio, and his latest feedback. Read it first and obey the rules.',
    '- studio_put(id, project, note): save the next version. It is checked; fix every problem it lists. The page redraws it live and uploads a contact sheet of the frames.',
    '- studio_look(id, wait_s): the latest sheet as an image plus lint warnings. Look at it before you call a version good.',
    '- studio_note(id, text): a short remark XIAO sees (what you changed, what you doubt).',
    '',
    'Team: the lead is the director and writes the storyboard. The other account is the critic: it looks at each sheet and notes drawing, pose, movement and consistency problems (same character, same colours, same size across shots). At most 2 critique rounds per request; stop after that and let XIAO react. Keep each tool call small and each note to one or two sentences: this runs on free-tier usage.',
    'Style target: hand-made storytime animation. Few simple reusable movements, poses held on 2s and 3s, slightly wobbly redrawn lines, small imperfections. Convincing handmade beats smooth and polished.',
    'Order of work: (1) a short SAMPLE (one or two shots) for XIAO to review; (2) when feedback arrives as a message in this thread, revise that sample and show it again; (3) only when XIAO asks for the full video, extend the project to the whole story. Never invent features the schema lacks.',
    'Feedback arrives as thread messages that start with "Studio feedback". Treat any line marked RULE as a permanent rule.',
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

  async function check(project) {
    if (project == null || typeof project !== 'object' || Array.isArray(project)) return ['The project must be a JSON object.'];
    const s = await sch();
    return typeof s.validateProject === 'function' ? lines(s.validateProject(project)) : [];
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

  async function create({ idea, title, team = 2, model = 'opus' }) {
    idea = clean(idea, 4000);
    if (!idea) throw fail('Say what the story is about.');
    const id = `s${Number(await store.cmd('INCR', K.seq))}`;
    const m = { id, title: clean(title, 80) || clean(idea.split('\n')[0], 60), idea, stage: 'sample', rev: 0, thread: 0, createdAt: now(), updatedAt: now(), by: '', rating: null, sheetRev: 0 };
    await store.cmd('HSET', K.index, id, JSON.stringify(m));
    const t = await hub.createThread({ title: `Studio: ${m.title}`, brief: studioBrief(m), model, thinking: 'xhigh', team: Math.max(1, Math.min(4, Number(team) || 2)), code: true, from: 'XIAO' });
    m.thread = t.id;
    await store.cmd('HSET', K.index, id, JSON.stringify(m));
    return { id, thread: t.id };
  }

  async function get(id, since) {
    const m = await meta(id);
    if (since != null && since !== '' && Number(since) === m.rev) return { same: true, rev: m.rev };
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
    const problems = await check(project);
    if (problems.length) return { ok: false, problems };
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
    return { ok: true, rev: m.rev };
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

  // ---- the page's side (password) ----
  async function pageOp(method, op, query, body) {
    if (!op.startsWith('studio-')) return null;
    try {
      if (method === 'GET') {
        if (op === 'studio-list') return { status: 200, body: { projects: await list() } };
        if (op === 'studio-get') return { status: 200, body: await get(String(query.id || ''), query.since) };
        if (op === 'studio-rules') return { status: 200, body: await rulesNow() };
        if (op === 'studio-log') return { status: 200, body: { log: await logSince(query.since), now: now() } };
        return null;
      }
      if (op === 'studio-new') return { status: 200, body: await create(body) };
      if (op === 'studio-feedback') return { status: 200, body: await feedback(String(body.id || ''), body.text, !!body.rule) };
      if (op === 'studio-full') return { status: 200, body: await full(String(body.id || '')) };
      if (op === 'studio-sheet') return { status: 200, body: await sheet(String(body.id || ''), body.rev, body.png) };
      if (op === 'studio-rate') return { status: 200, body: await rate(String(body.id || ''), body.rev, body.good, body.note) };
      if (op === 'studio-rules') return { status: 200, body: await saveRules(body) };
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
          format: typeof s.FORMAT_HELP === 'string' ? s.FORMAT_HELP : undefined,
          rules: { version: r.version, text: r.text, style: r.style },
          feedback: g.feedback.slice(-8),
          notes: g.notes.slice(-8),
          rating: g.meta.rating,
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
        return `Saved rev ${r.rev}. The page redraws it and uploads a sheet within about 10 seconds (it must be open); then studio_look(id: "${x.id}", wait_s: 25) shows it.`;
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
  ];

  return { pageOp, tools, create, get, put, feedback, full, sheet, rate, saveRules, rulesNow, logSince, list, lint, check };
}

// One studio per hub object (the tools list is rebuilt on every MCP call).
const studios = new WeakMap();
export function studioOf(hub) {
  if (!studios.has(hub)) studios.set(hub, createStudio(hub));
  return studios.get(hub);
}
export const studioTools = (hub) => studioOf(hub).tools;
