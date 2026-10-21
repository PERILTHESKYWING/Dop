// The hub core (named after its project, HUB_PROJECT; Dop by default): accounts, threads, messages, dispatch and handover.
// Storage is a small Redis-like store (lib/store.js). Everything runs inside
// short serverless calls, so there are no timers: stale work is noticed
// whenever the page or an agent next talks to the hub.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const MODELS = ['opus', 'sonnet', 'haiku', 'fable'];
// Thinking level per thread. Routines have no effort setting the hub can
// change, so the level travels as words Claude Code reads: a keyword at the
// top of the session's first message, and a line in the brief.
// The levels and names are Claude's own effort levels.
export const THINKING = ['low', 'medium', 'high', 'xhigh', 'max'];
const THINK_WORD = { low: '', medium: 'think', high: 'think hard', xhigh: 'think harder', max: 'ultrathink' };
const THINK_LINE = {
  low: 'Thinking: Low. Work quickly and keep your reasoning short.',
  medium: 'Thinking: Medium. Think before each step.',
  high: 'Thinking: High. Think hard before each important step and check your work.',
  xhigh: 'Thinking: xHigh. Think harder: reason carefully before every step, weigh alternatives and check your work.',
  max: 'Thinking: Max. Ultrathink: reason as deeply as you can, weigh alternatives and verify before acting.',
};
// seq counts messages; rev counts thread and account changes. The page polls both.
const K = { seq: 'hub:seq', rev: 'hub:rev', swept: 'hub:swept', feed: 'hub:feed', threads: 'hub:threads', accounts: 'hub:accounts', settings: 'hub:settings', fires: 'hub:fires', conn: 'hub:conn', deleted: 'hub:deleted' };
const KEEP_FEED = 3000;
const FIVE_H = 5 * 3600_000;
// A thread whose agent has said nothing for this long is treated as stopped.
export const STALL_MS = 15 * 60_000;
// An agent that touched its thread this recently is still running and will
// see new messages itself, so the hub does not start another session for it.
const ACTIVE_MS = 3 * 60_000;
const RESUME_GAP_MS = 30 * 60_000;
const ROUTINE_FIRES_PER_HOUR = 28; // Claude allows 30; keep a little spare.

export const DEFAULT_SETTINGS = {
  coordinatorModel: 'haiku', // cheapest; it only routes
  coordinatorAccount: '', // '' = pick automatically
  // Hub overhead budget per 5 hours: tokens of hub tool traffic (estimate:
  // characters / 4) plus a fixed cost per coordinator session. Over budget, new
  // prompts skip the coordinator and become one thread each.
  // Measured 2026-10-20 with Claude Code on Haiku: one routing run took 4 turns,
  // 3-15k new tokens (input + cache writes + output) and ~180k cached reads.
  overheadTokens: 60_000,
  coordinatorSessionTokens: 12_000,
  autoResume: true,
  // New work only goes to accounts with at least this much of both their
  // 5-hour and weekly limits left (XIAO edits it in Settings). 15 = the old
  // fixed "low at 85% used" rule.
  minLeftPct: 15,
};
// Most accounts that may work one thread together (lead + members).
export const TEAM_MAX = 4;

const json = (v) => JSON.stringify(v);
const parse = (s, fallback = null) => {
  try {
    return s == null ? fallback : JSON.parse(s);
  } catch {
    return fallback;
  }
};
const hashToObj = (arr) => {
  const out = {};
  for (let i = 0; i < (arr || []).length; i += 2) out[arr[i]] = parse(arr[i + 1]);
  return out;
};
const clean = (s, max) => String(s ?? '').trim().slice(0, max);
const cleanList = (v) => [...new Set((Array.isArray(v) ? v : v ? [v] : []).map((x) => clean(x, 24)).filter(Boolean))].slice(0, 12);
const thinkingOf = (v, fallback = 'medium') => (THINKING.includes(v) ? v : fallback);
const teamOf = (v, fallback = 1) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Math.max(1, Math.min(TEAM_MAX, Math.round(Number(v)))) : fallback);
// Highest share of either limit used, or null when the hub has no numbers.
export const usedPct = (a) => (a.usage && (a.usage.five_hour_pct != null || a.usage.seven_day_pct != null) ? Math.max(a.usage.five_hour_pct ?? 0, a.usage.seven_day_pct ?? 0) : null);
// Below the usage-left threshold: no new work, even before the low flag is set.
// A team member on this thread (not its lead).
const isMember = (t, name) => t.crew?.[name]?.role === 'member' && name !== t.account;
const underMin = (a, s) => a.low || (usedPct(a) ?? 0) >= 100 - s.minLeftPct;

export function safeEqual(a, b) {
  const x = createHash('sha256').update(String(a)).digest();
  const y = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(x, y);
}

export function createHub({ store, fetchImpl = fetch, now = () => Date.now(), project = 'Dop', owner = 'XIAO' }) {
  // The project this hub serves and the person it works for. Only the words
  // agents and the page read change; stored messages keep from: 'XIAO'.
  const slug = project.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'hub';
  async function nextId() {
    return Number(await store.cmd('INCR', K.seq));
  }

  async function settings() {
    return { ...DEFAULT_SETTINGS, ...parse(await store.cmd('GET', K.settings), {}) };
  }

  async function saveSettings(patch) {
    const s = await settings();
    const out = { ...s };
    if (MODELS.includes(patch.coordinatorModel)) out.coordinatorModel = patch.coordinatorModel;
    if (typeof patch.coordinatorAccount === 'string') out.coordinatorAccount = clean(patch.coordinatorAccount, 24);
    if (Number.isFinite(Number(patch.overheadTokens)) && patch.overheadTokens !== '') out.overheadTokens = Math.max(0, Math.round(Number(patch.overheadTokens)));
    if (typeof patch.autoResume === 'boolean') out.autoResume = patch.autoResume;
    if (Number.isFinite(Number(patch.minLeftPct)) && patch.minLeftPct !== '' && patch.minLeftPct != null) out.minLeftPct = Math.max(0, Math.min(95, Math.round(Number(patch.minLeftPct))));
    await store.cmd('SET', K.settings, json(out));
    // A new threshold re-marks (or clears) accounts from their last numbers.
    if (out.minLeftPct !== s.minLeftPct) {
      for (const a of Object.values(await accounts())) {
        const was = !!a.low;
        await applyUsage(a, out);
        if (!!a.low !== was) await putAccount(a);
      }
    }
    return out;
  }

  // ---------- accounts ----------
  async function accounts() {
    return hashToObj(await store.cmd('HGETALL', K.accounts));
  }
  async function account(name) {
    return parse(await store.cmd('HGET', K.accounts, name));
  }
  async function putAccount(a, { quiet = false } = {}) {
    await store.multi([['HSET', K.accounts, a.name, json(a)], ...(quiet ? [] : [['INCR', K.rev]])]);
    return a;
  }

  async function upsertAccount(input) {
    const name = clean(input.name, 24);
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,23}$/.test(name)) throw new Error('Account name: letters, numbers, spaces, - or _.');
    const old = (await account(name)) || { name, key: randomBytes(18).toString('base64url'), createdAt: now(), low: false };
    // Reusing a key lets a connector made for a deleted account work again.
    const reuse = String(input.key || '').trim();
    if (reuse) {
      if (!/^[A-Za-z0-9_-]{16,64}$/.test(reuse)) throw new Error('Key: paste the last part of an old connector link.');
      old.key = reuse;
    }
    const plan = ['free', 'pro', 'max', 'team'].includes(input.plan) ? input.plan : old.plan || 'pro';
    let routines = old.routines || [];
    if (Array.isArray(input.routines)) {
      // Accept the whole trigger URL too: keep only its trig_... part.
      const routineId = (v) => {
        const raw = clean(v, 300);
        return (/trig_[A-Za-z0-9_-]+/.exec(raw) || [raw])[0].slice(0, 80);
      };
      routines = input.routines
        .map((r) => {
          const prev = routines.find((p) => p.id === routineId(r.id));
          return {
            model: MODELS.includes(r.model) ? r.model : 'sonnet',
            id: routineId(r.id),
            // A blank token keeps the one saved before (the page never sees it).
            token: clean(r.token, 300) || prev?.token || '',
            fires: prev?.fires || [],
          };
        })
        .filter((r) => r.id && r.token);
    }
    return putAccount({ ...old, plan, routines, label: clean(input.label ?? old.label ?? '', 40) });
  }

  async function removeAccount(name) {
    await store.cmd('HDEL', K.accounts, name);
  }

  function publicAccount(a, threads = []) {
    const t = now();
    return {
      name: a.name,
      label: a.label || '',
      plan: a.plan,
      low: !!a.low,
      lowNote: a.lowNote || '',
      usage: a.usage || null,
      usageErr: a.usageErr || '',
      lastSeen: a.lastSeen || 0,
      online: t - (a.lastSeen || 0) < ACTIVE_MS,
      connected: !!(a.connectedAt || a.lastSeen),
      models: [...new Set((a.routines || []).map((r) => r.model))],
      routines: (a.routines || []).map((r) => ({ model: r.model, id: r.id, hasToken: !!r.token })),
      working: threads.filter((th) => (th.account === a.name || isMember(th, a.name)) && th.status === 'working').length,
    };
  }

  // Who is calling the MCP endpoint: account name + its connector key.
  async function authAgent(name, key) {
    const a = name && (await account(String(name)));
    if (!a || !key || !safeEqual(a.key, key)) return null;
    return a;
  }

  async function touchAccount(name, patch = {}) {
    const a = await account(name);
    if (!a) return null;
    // A plain "still here" doesn't need the page to refresh.
    const quiet = !Object.keys(patch).length && now() - (a.lastSeen || 0) < 60_000;
    Object.assign(a, patch, { lastSeen: now() });
    a.connectedAt ||= now();
    await applyUsage(a);
    return putAccount(a, { quiet });
  }

  // First call with the right key: the connector on claude.ai works.
  async function markConnected(a) {
    if (a.connectedAt) return;
    a.connectedAt = now();
    await putAccount(a);
  }

  // Marks an account low once less than minLeftPct (default 15%) of either
  // limit is left, and clears it once 15 points more are free again.
  async function applyUsage(a, s = null) {
    if (a.usage && now() - (a.usage.at || now()) > FIVE_H) a.usage = null;
    if (a.usage) {
      const lowAt = 100 - (s || (await settings())).minLeftPct;
      const pct = usedPct(a) ?? 0;
      if (pct >= lowAt && !a.low) {
        a.low = true;
        a.lowNote = `${Math.round(pct)}% of its limit used`;
        await announceLow(a);
      } else if (pct < lowAt - 15 && a.low && a.lowNote?.endsWith('limit used')) {
        a.low = false;
        a.lowNote = '';
      }
    }
  }

  // ---------- usage from Claude ----------
  // Reads an account's 5-hour and weekly use the way Claude Code's /usage does,
  // with one of its routine tokens. Not a documented API: if Claude refuses
  // the token, the page says so and usage can still come from a PC status line
  // or be typed in by hand.
  const USAGE_EVERY_MS = 5 * 60_000;
  const pctOf = (x) => {
    const v = Number(x?.utilization ?? x?.used_percentage);
    if (!Number.isFinite(v)) return null;
    return v <= 1 && v > 0 && !Number.isInteger(v) ? v * 100 : v;
  };
  async function readUsage(a) {
    const token = (a.routines || []).find((r) => r.token)?.token;
    if (!token) return { error: (a.routines || []).length ? 'its routine has no token saved (Edit the account and paste it)' : 'no routine added, so there is nothing to read from' };
    try {
      const res = await fetchImpl('https://api.anthropic.com/api/oauth/usage', {
        headers: { authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        if (res.status === 401 || res.status === 403) return { error: `Claude refused this token (${res.status}); a routine token may not be allowed to read usage` };
        return { error: `Claude answered ${res.status}${e?.error?.message ? ': ' + clean(e.error.message, 140) : ''}` };
      }
      const b = await res.json();
      const five = pctOf(b.five_hour);
      const week = pctOf(b.seven_day);
      if (five == null && week == null) return { error: 'Claude sent no usage numbers' };
      return {
        usage: {
          five_hour_pct: five,
          five_hour_resets: b.five_hour?.resets_at || null,
          seven_day_pct: week,
          seven_day_resets: b.seven_day?.resets_at || null,
          opus_week_pct: pctOf(b.seven_day_opus),
          at: now(),
          source: 'claude',
        },
      };
    } catch (e) {
      return { error: `could not reach Claude (${e.name === 'TimeoutError' ? 'timeout' : e.message})` };
    }
  }
  async function refreshUsage({ force = false } = {}) {
    // Connectors added before the hub tracked connections show up in the log.
    const seen = new Map((await connLog()).filter((e) => e.keyOk && e.account && e.http === 'POST').map((e) => [e.account, e.at]));
    for (const a of Object.values(await accounts())) if (!a.connectedAt && seen.has(a.name)) await putAccount({ ...a, connectedAt: seen.get(a.name) });
    const all = Object.values(await accounts()).filter((a) => a.plan !== 'free');
    const due = all.filter((a) => force || now() - (a.usageTriedAt || 0) > USAGE_EVERY_MS);
    // Claim the slot first so overlapping page polls don't all ask Claude.
    for (const a of due) await putAccount({ ...a, usageTriedAt: now() });
    await Promise.all(
      due.map(async (a0) => {
        const got = await readUsage(a0);
        const a = await account(a0.name);
        if (!a || !got) return;
        a.usageTriedAt = now();
        if (got.usage) {
          a.usage = got.usage;
          a.usageErr = '';
          await applyUsage(a);
        } else a.usageErr = got.error;
        await putAccount(a);
        try {
          await logConn({ http: 'USAGE', account: a.name, keyOk: !!got.usage, via: got.usage ? `5h ${got.usage.five_hour_pct}%, week ${got.usage.seven_day_pct}%` : got.error });
        } catch {}
      }),
    );
  }
  // Typed in on the page (free plans, or when Claude won't share it).
  async function setUsage(name, { five_hour_pct, seven_day_pct }) {
    const a = await account(name);
    if (!a) throw new Error('No such account.');
    const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.min(100, Number(v))));
    a.usage = { five_hour_pct: num(five_hour_pct), seven_day_pct: num(seven_day_pct), at: now(), source: 'manual' };
    if (a.usage.five_hour_pct == null && a.usage.seven_day_pct == null) a.usage = null;
    await applyUsage(a);
    return putAccount(a);
  }

  async function announceLow(a) {
    const ths = (await threads()).filter((t) => t.account === a.name && t.status === 'working');
    await post({
      thread: 0,
      from: 'hub',
      kind: 'alert',
      text: `${a.name} is running low (${a.lowNote || 'reported by its agent'}). New work goes to other accounts.${ths.length ? ` Its open threads: ${ths.map((t) => `#${t.id} ${t.title}`).join(', ')}. Their agents should write a handover now.` : ''}`,
    });
    for (const t of ths) {
      await post({ thread: t.id, from: 'hub', kind: 'alert', text: `This account (${a.name}) is low on usage. Call hub_checkpoint now with what is done and exactly what to do next, then stop.` });
    }
  }

  // A fresh connector link: connectors made with the old one stop working.
  async function newKey(name) {
    const a = await account(name);
    if (!a) throw new Error('No such account.');
    a.key = randomBytes(18).toString('base64url');
    await putAccount(a);
    return { name: a.name, key: a.key };
  }

  async function setLow(name, low, note = '') {
    const a = await account(name);
    if (!a) throw new Error('No such account.');
    const was = a.low;
    a.low = !!low;
    a.lowNote = low ? clean(note, 120) || 'marked low' : '';
    // "Usage is back": forget the old reading so it does not re-mark the account.
    if (!low) a.usage = null;
    await putAccount(a);
    if (low && !was) await announceLow(a);
    return a;
  }

  // ---------- threads & messages ----------
  async function threads() {
    return Object.values(hashToObj(await store.cmd('HGETALL', K.threads))).sort((a, b) => a.id - b.id);
  }
  async function thread(id) {
    return parse(await store.cmd('HGET', K.threads, String(id)));
  }
  async function putThread(t) {
    t.updatedAt = now();
    await store.multi([['HSET', K.threads, String(t.id), json(t)], ['INCR', K.rev]]);
    return t;
  }

  async function post({ thread: tid = 0, from, kind = 'note', text, replyTo = null, meta = null, to = '' }) {
    const msg = { id: await nextId(), at: now(), thread: Number(tid) || 0, from, kind, text: clean(text, 20_000), replyTo: replyTo ? Number(replyTo) : null };
    if (meta) msg.meta = meta;
    if (to) msg.to = clean(to, 24);
    await store.multi([
      ['RPUSH', K.feed, json(msg)],
      ['LTRIM', K.feed, -KEEP_FEED, -1],
    ]);
    return msg;
  }

  // Connection log: what each connector request looked like, to debug claude.ai setup.
  async function logConn(entry) {
    await store.multi([
      ['RPUSH', K.conn, json({ at: now(), ...entry })],
      ['LTRIM', K.conn, -40, -1],
    ]);
  }
  async function connLog() {
    return (await store.cmd('LRANGE', K.conn, 0, -1)).map((s) => parse(s)).filter(Boolean).reverse();
  }

  async function feed(limit = 400) {
    return (await store.cmd('LRANGE', K.feed, -limit, -1)).map((s) => parse(s)).filter(Boolean);
  }

  async function messagesSince(after, filter = () => true, limit = 400) {
    return (await feed(limit)).filter((m) => m.id > after && filter(m));
  }

  // ---------- overhead budget ----------
  async function overhead() {
    const t = now();
    const fires = (await store.cmd('LRANGE', K.fires, 0, -1)).map((s) => parse(s)).filter((f) => f && t - f.at < FIVE_H);
    const window = Math.floor(t / FIVE_H);
    const traffic = Number((await store.cmd('GET', `hub:tok:${window}`)) || 0);
    const s = await settings();
    const coordinatorSessions = fires.filter((f) => f.role === 'coordinator').length;
    const used = traffic + coordinatorSessions * s.coordinatorSessionTokens;
    return { used, budget: s.overheadTokens, traffic, coordinatorSessions, fires: fires.length, over: used >= s.overheadTokens };
  }

  async function countTraffic(chars) {
    const key = `hub:tok:${Math.floor(now() / FIVE_H)}`;
    await store.cmd('INCRBY', key, Math.ceil(chars / 4));
  }

  // ---------- starting cloud sessions ----------
  // A routine is a saved Claude Code task on one account with one model.
  // Firing it starts a new cloud session with our payload as its input.
  function pickRoutine(a, model) {
    const t = now();
    const ok = (r) => (r.fires || []).filter((f) => t - f < 3600_000).length < ROUTINE_FIRES_PER_HOUR;
    const rs = (a.routines || []).filter(ok);
    return rs.find((r) => r.model === model) || null;
  }

  // Claude's subscription rate-limit headers, if a reply carries them.
  function usageFromHeaders(h) {
    const get = (k) => h?.get?.(`anthropic-ratelimit-unified-${k}`);
    const pct = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) <= 1 ? Number(v) * 100 : Number(v)));
    const when = (v) => (v && Number.isFinite(Number(v)) ? new Date(Number(v) * 1000).toISOString() : null);
    const five = pct(get('5h-utilization'));
    const week = pct(get('7d-utilization'));
    if (five == null && week == null) return null;
    return { five_hour_pct: five, five_hour_resets: when(get('5h-reset')), seven_day_pct: week, seven_day_resets: when(get('7d-reset')), at: now(), source: 'claude' };
  }

  async function fire(a, model, payload, role, thinking = 'low') {
    const out = await fireOnce(a, model, payload, role, thinking);
    try {
      await logConn({ http: 'START', account: a.name, rpc: `${role} on ${model}`, keyOk: out.ok, via: out.ok ? 'routine started' : 'failed: ' + String(out.reason).slice(0, 160) });
    } catch {}
    return out;
  }

  async function fireOnce(a, model, payload, role, thinking) {
    const r = pickRoutine(a, model);
    if (!r) return { ok: false, reason: `${a.name} has no ${model} routine with fires left` };
    let res;
    try {
      res = await fetchImpl(`https://api.anthropic.com/v1/claude_code/routines/${encodeURIComponent(r.id)}/fire`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${r.token}`,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'experimental-cc-routine-2026-04-01',
          'content-type': 'application/json',
        },
        body: json({ text: `${THINK_WORD[thinking] ? THINK_WORD[thinking] + '\n' : ''}${json({ hub: slug, ...payload })}` }),
      });
    } catch (e) {
      return { ok: false, reason: `could not reach Claude: ${e.message}` };
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return { ok: false, reason: `${a.name}'s ${model} routine token was refused (${res.status})` };
      if (res.status === 429) return { ok: false, reason: `${a.name} is rate limited` };
      return { ok: false, reason: `Claude returned ${res.status}: ${JSON.stringify(body).slice(0, 120)}` };
    }
    const fresh = await account(a.name);
    const fr = (fresh.routines || []).find((x) => x.id === r.id);
    if (fr) fr.fires = [...(fr.fires || []).filter((f) => now() - f < 3600_000), now()];
    const fromHeaders = usageFromHeaders(res.headers);
    if (fromHeaders) {
      fresh.usage = fromHeaders;
      fresh.usageErr = '';
      await applyUsage(fresh);
    }
    await putAccount(fresh);
    await store.multi([
      ['RPUSH', K.fires, json({ at: now(), account: a.name, model, role })],
      ['LTRIM', K.fires, -500, -1],
    ]);
    return { ok: true, url: body.claude_code_session_url || '', account: a.name, model };
  }

  // Best account for new work: at least minLeftPct of its limits left, has a
  // routine for the model, fewest open threads, then the most usage left.
  // Accounts without routines (free plan, PC) never auto-start.
  async function chooseAccount(model, { prefer = '', exclude = [], code = true, only = [] } = {}) {
    const all = Object.values(await accounts());
    const ths = await threads();
    const s = await settings();
    const load = (n) => ths.filter((t) => (t.account === n || t.crew?.[n]?.role === 'member') && t.status === 'working').length;
    const usable = all.filter((a) => !underMin(a, s) && !exclude.includes(a.name) && (!code || a.plan !== 'free') && (!only.length || only.includes(a.name)));
    const fireable = usable.filter((a) => pickRoutine(a, model));
    const preferred = fireable.find((a) => a.name === prefer);
    if (preferred) return preferred;
    fireable.sort((a, b) => load(a.name) - load(b.name) || (usedPct(a) ?? 50) - (usedPct(b) ?? 50));
    return fireable[0] || null;
  }

  // Like chooseAccount, but when no account has a routine for the wanted
  // model, use the nearest model some account can start.
  async function chooseAccountAnyModel(model, opts = {}) {
    const order = [model, ...(model === 'haiku' ? ['sonnet', 'opus'] : model === 'opus' ? ['sonnet', 'haiku'] : ['opus', 'haiku'])];
    for (const m of order) {
      const a = await chooseAccount(m, opts);
      if (a) return { a, model: m };
    }
    return { a: null, model };
  }

  // Hand a thread to an agent: start a cloud session if we can, otherwise
  // leave it queued for an agent that checks in (PC, free-plan chat).
  async function dispatch(t, role = 'worker', extra = {}) {
    const exclude = extra.exclude || [];
    const s = await settings();
    // Free helper accounts take no-code work first, saving the paid accounts.
    if (!t.account && t.code === false && role === 'worker') {
      const ths = await threads();
      const load = (n) => ths.filter((x) => x.account === n && !x.archived && ['queued', 'working'].includes(x.status)).length;
      const only = t.accounts || [];
      const helpers = Object.values(await accounts()).filter((x) => x.plan === 'free' && !underMin(x, s) && !exclude.includes(x.name) && (!only.length || only.includes(x.name)));
      helpers.sort((x, y) => load(x.name) - load(y.name));
      if (helpers[0]) t.account = helpers[0].name;
    }
    let a = t.account ? await account(t.account) : null;
    if (a && t.accounts?.length && !t.accounts.includes(a.name)) a = null;
    // Chosen on purpose for an account the hub can't start (free plan, PC):
    // keep it there until that account checks in.
    if (a && !underMin(a, s) && !exclude.includes(a.name) && !(a.routines || []).length && (a.plan !== 'free' || t.code === false)) {
      t.status = 'queued';
      await putThread(t);
      await post({ thread: t.id, from: 'hub', kind: 'alert', text: `Waiting for ${a.name} to check in (open a chat on that account and say "check the ${project} hub").` });
      return { ok: false, queued: a.name };
    }
    if (a && (underMin(a, s) || exclude.includes(a.name) || !pickRoutine(a, t.model))) a = null;
    let useModel = t.model;
    if (!a) ({ a, model: useModel } = await chooseAccountAnyModel(t.model, { prefer: t.account, exclude, code: t.code !== false, only: t.accounts || [] }));
    if (!a) {
      t.status = 'queued';
      await putThread(t);
      const who = t.accounts?.length ? t.accounts.join(', ') : 'no account';
      await post({ thread: t.id, from: 'hub', kind: 'alert', text: t.accounts?.length ? `Waiting: ${who} can't start a session right now. Pick more accounts, or open a chat on one and say "check the ${project} hub".` : `Waiting for an agent: no account can start a ${t.model} session right now. A PC or chat agent can pick it up with hub_start.` });
      return { ok: false };
    }
    const r = await fire(a, useModel, { role, thread: t.id }, role, thinkingOf(t.thinking));
    if (!r.ok) {
      await post({ thread: t.id, from: 'hub', kind: 'alert', text: `Could not start ${a.name}: ${r.reason}.` });
      return dispatch(t, role, { exclude: [...exclude, a.name] });
    }
    t.account = a.name;
    t.status = 'working';
    t.lastAgentAt = now();
    t.lastFireAt = now();
    t.sessionUrl = r.url;
    t.fires = (t.fires || 0) + 1;
    await putThread(t);
    await post({ thread: t.id, from: 'hub', kind: 'start', text: `Started ${a.name} on ${useModel}${useModel !== t.model ? ` (no ${t.model} routine)` : ''}${role === 'resume' ? ' to continue from the last handover' : ''}${teamOf(t.team) > 1 ? ' as team lead' : ''}.` });
    if (role === 'worker' || role === 'resume') await fillTeam(t);
    return { ok: true, account: a.name };
  }

  // ---------- teams: several accounts on one thread ----------
  // The lead is t.account: it owns the thread's handover and closes it.
  // Members are extra sessions on other accounts, kept in t.crew with their
  // own last-seen time, handover and done flag. Every post in the thread
  // reaches all of them through hub_wait.
  function activeMembers(t) {
    return Object.keys(t.crew || {}).filter((n) => {
      const c = t.crew[n];
      return c.role === 'member' && n !== t.account && !c.done && !c.gone && now() - (c.at || 0) < STALL_MS;
    });
  }

  // Note a sign of life. Members keep their own clock, so a quiet lead is
  // still noticed while members talk.
  function seen(t, name) {
    if (isMember(t, name)) {
      Object.assign(t.crew[name], { at: now(), gone: false });
      return;
    }
    t.lastAgentAt = now();
  }

  // Start member sessions on other accounts until the thread has team - 1
  // members (finished parts count). replaces: members who stopped, whose
  // parts the new sessions take over, one each.
  async function fillTeam(t, { replaces = [] } = {}) {
    const team = teamOf(t.team);
    if (team < 2 || t.status === 'done' || t.archived || !t.account) return 0;
    t.crew ||= {};
    const s = await settings();
    const counted = () => Object.keys(t.crew).filter((n) => n !== t.account && (activeMembers(t).includes(n) || (t.crew[n].role === 'member' && t.crew[n].done)));
    let need = team - 1 - counted().length;
    if (need <= 0) return 0;
    const tried = [];
    const left = replaces.slice();
    let started = 0;
    while (need > 0) {
      const exclude = [t.account, ...Object.keys(t.crew).filter((n) => t.crew[n].role === 'member' && (activeMembers(t).includes(n) || t.crew[n].done || t.crew[n].gone)), ...tried];
      const { a, model } = await chooseAccountAnyModel(t.model, { exclude, code: t.code !== false, only: t.accounts || [] });
      if (!a) break;
      tried.push(a.name);
      const rep = left[0] || '';
      const r = await fire(a, model, { role: 'member', thread: t.id, ...(rep ? { replaces: rep } : {}) }, 'member', thinkingOf(t.thinking));
      if (!r.ok) {
        await post({ thread: t.id, from: 'hub', kind: 'alert', text: `Could not start team member ${a.name}: ${r.reason}.` });
        continue;
      }
      left.shift();
      t.crew[a.name] = { role: 'member', at: now(), startedAt: now(), replaces: rep, checkpoint: rep ? t.crew[rep]?.checkpoint || null : null };
      need--;
      started++;
      await post({ thread: t.id, from: 'hub', kind: 'start', text: `Started ${a.name} on ${model} as team member ${counted().length} of ${team - 1}${rep ? `, taking over ${rep}'s part from its handover` : ''}.` });
    }
    if (need > 0) await post({ thread: t.id, from: 'hub', kind: 'alert', text: `Team: ${need} more account${need > 1 ? 's' : ''} wanted, but no other account can start a ${t.model} session with at least ${s.minLeftPct}% usage left. The thread goes on with ${team - need} for now.` });
    await putThread(t);
    return started;
  }

  async function createThread({ title, brief, account: acc = '', accounts: only = [], model = 'sonnet', thinking = 'medium', team = 1, code = true, from = 'coordinator', parent = null }) {
    only = cleanList(only);
    if (only.length === 1 && !acc) acc = only[0];
    const t = {
      id: await nextId(),
      title: clean(title, 80) || 'Untitled',
      brief: clean(brief, 8000),
      account: clean(acc, 24),
      accounts: only,
      model: MODELS.includes(model) ? model : 'sonnet',
      thinking: thinkingOf(thinking),
      team: teamOf(team),
      crew: {},
      code: code !== false,
      status: 'new',
      checkpoint: null,
      createdAt: now(),
      parent,
    };
    await putThread(t);
    await post({ thread: t.id, from, kind: 'brief', text: t.brief || t.title });
    await dispatch(t);
    return thread(t.id);
  }

  // ---------- XIAO's prompts ----------
  async function prompt({ text, thread: tid = 0, model, account: acc, accounts: only, thinking, team, direct = false, chat = false }) {
    text = clean(text, 20_000);
    if (!text) throw new Error('Empty prompt.');
    // New chat: a clean thread that goes straight to one agent. Nothing is posted in Project chat
    // and no coordinator runs; the first message is the brief, shown as XIAO's own words.
    if (chat && !tid) {
      const t = await createThread({ title: text.split('\n')[0].slice(0, 60), brief: text, model: MODELS.includes(model) ? model : 'sonnet', thinking, team: teamOf(team, 1), accounts: only, account: acc || '', from: 'XIAO' });
      return { thread: t.id };
    }
    if (tid) {
      const t = await thread(tid);
      if (!t) throw new Error('No such thread.');
      if (MODELS.includes(model)) t.model = model;
      if (typeof acc === 'string') t.account = clean(acc, 24);
      if (THINKING.includes(thinking)) t.thinking = thinking;
      if (Array.isArray(only)) t.accounts = cleanList(only);
      if (team != null) t.team = teamOf(team, t.team);
      const msg = await post({ thread: t.id, from: 'XIAO', kind: 'prompt', text });
      t.archived = false;
      if (t.status === 'done' || t.status === 'waiting' || t.status === 'stalled' || t.status === 'queued') t.status = 'new';
      await putThread(t);
      // A running agent sees it with hub_wait; otherwise start one.
      if (!(t.status === 'working' && now() - (t.lastAgentAt || 0) < ACTIVE_MS)) await dispatch(t);
      else await fillTeam(t);
      return msg;
    }
    // What XIAO picked in the composer; the coordinator's threads keep it.
    const meta = { model: MODELS.includes(model) ? model : '', thinking: thinkingOf(thinking), accounts: cleanList(only), team: teamOf(team, 0) };
    const msg = await post({ thread: 0, from: 'XIAO', kind: 'prompt', text, meta });
    const s = await settings();
    const ov = await overhead();
    if (ov.over || direct) {
      if (!direct) await post({ thread: 0, from: 'hub', kind: 'alert', text: 'Hub overhead budget for this 5 hours is used up, so this prompt skips the coordinator and becomes one thread.' });
      const t = await createThread({ title: text.split('\n')[0].slice(0, 60), brief: text, model: meta.model || 'sonnet', thinking: meta.thinking, team: meta.team || 1, accounts: meta.accounts, account: acc || '', from: 'hub' });
      // Mark the prompt handled so a coordinator never picks it up again.
      await post({ thread: 0, from: 'hub', kind: 'routed', replyTo: msg.id, text: `One thread (#${t.id})` });
      return msg;
    }
    // The coordinator runs on the chosen accounts when it can, else anywhere.
    let { a, model: coordModel } = await chooseAccountAnyModel(s.coordinatorModel, { prefer: s.coordinatorAccount, only: meta.accounts });
    if (!a && meta.accounts.length) ({ a, model: coordModel } = await chooseAccountAnyModel(s.coordinatorModel, { prefer: s.coordinatorAccount }));
    if (!a) {
      await post({ thread: 0, from: 'hub', kind: 'alert', text: 'No account can start the coordinator right now. A PC or chat agent will see this prompt when it calls hub_start.' });
      return msg;
    }
    const r = await fire(a, coordModel, { role: 'coordinator', prompt: msg.id }, 'coordinator');
    await post({ thread: 0, from: 'hub', kind: r.ok ? 'start' : 'alert', text: r.ok ? `Coordinator started on ${a.name} (${coordModel}).` : `Coordinator could not start: ${r.reason}.` });
    return msg;
  }

  async function updateThread(id, patch) {
    const t = await thread(id);
    if (!t) throw new Error('No such thread.');
    if (MODELS.includes(patch.model)) t.model = patch.model;
    if (typeof patch.account === 'string') t.account = clean(patch.account, 24);
    if (THINKING.includes(patch.thinking)) t.thinking = patch.thinking;
    const grow = patch.team != null && teamOf(patch.team, t.team || 1) > teamOf(t.team);
    if (patch.team != null) t.team = teamOf(patch.team, t.team || 1);
    if (Array.isArray(patch.accounts)) {
      t.accounts = cleanList(patch.accounts);
      if (t.accounts.length && t.account && !t.accounts.includes(t.account) && t.status !== 'working') t.account = '';
    }
    if (['done', 'new'].includes(patch.status)) t.status = patch.status;
    // Archived threads leave the lists and get no new sessions until restored.
    if (typeof patch.archived === 'boolean') t.archived = patch.archived;
    if (typeof patch.title === 'string' && patch.title.trim()) t.title = clean(patch.title, 80);
    await putThread(t);
    // A bigger team on a running thread gets its new members now.
    if (grow && t.status === 'working') await fillTeam(t);
    return thread(t.id);
  }

  // Removes a thread and its messages for good. A session still working on it
  // gets "No such thread" on its next hub call and stops.
  async function deleteThread(id) {
    const tid = Number(id);
    const mine = (await store.cmd('LRANGE', K.feed, 0, -1)).filter((x) => parse(x)?.thread === tid);
    await store.multi([['HDEL', K.threads, String(tid)], ...mine.map((x) => ['LREM', K.feed, 0, x]), ['INCR', K.rev]]);
  }

  // Removes one message. Its id is kept on a short list so pages that already
  // hold it drop it on their next refresh, and a deleted coordinator reply
  // still counts its prompt as handled (so the prompt is not routed again).
  async function deleteMessage(id) {
    const mid = Number(id);
    const raw = (await store.cmd('LRANGE', K.feed, 0, -1)).find((x) => parse(x)?.id === mid);
    if (!raw) return false;
    const m = parse(raw);
    await store.multi([
      ['LREM', K.feed, 0, raw],
      ['RPUSH', K.deleted, json({ id: mid, kind: m.kind, replyTo: m.replyTo ?? null })],
      ['LTRIM', K.deleted, -500, -1],
      ['INCR', K.rev],
    ]);
    return true;
  }

  // Everything the page shows, read in one round trip. With since, only
  // messages newer than that id come back.
  async function snapshot({ since = 0, limit = 600 } = {}) {
    const [th, ac, fd, st, fi, tok, seq, rev, del] = await store.multi([
      ['HGETALL', K.threads],
      ['HGETALL', K.accounts],
      ['LRANGE', K.feed, since ? -150 : -limit, -1],
      ['GET', K.settings],
      ['LRANGE', K.fires, 0, -1],
      ['GET', `hub:tok:${Math.floor(now() / FIVE_H)}`],
      ['GET', K.seq],
      ['GET', K.rev],
      ['LRANGE', K.deleted, -200, -1],
    ]);
    const t = now();
    const ths = Object.values(hashToObj(th)).sort((a, b) => a.id - b.id);
    // A stopped agent is noticed here; only then is a second read needed.
    if (ths.some((x) => x.status === 'working' && !x.archived && (t - (x.lastAgentAt || 0) >= STALL_MS || quietMembers(x, t).length))) {
      await sweep();
      return snapshot({ since, limit });
    }
    let messages = (fd || []).map((x) => parse(x)).filter(Boolean);
    // Too far behind for the short read: send the full window instead.
    if (since && (fd || []).length >= 150 && messages[0]?.id > since) return snapshot({ limit });
    if (since) messages = messages.filter((m) => m.id > since);
    const s = { ...DEFAULT_SETTINGS, ...parse(st, {}) };
    const fires = (fi || []).map((x) => parse(x)).filter((f) => f && t - f.at < FIVE_H);
    const coordinatorSessions = fires.filter((f) => f.role === 'coordinator').length;
    const used = Number(tok || 0) + coordinatorSessions * s.coordinatorSessionTokens;
    return {
      seq: `${Number(seq || 0)}.${Number(rev || 0)}`,
      full: !since,
      threads: ths,
      accounts: Object.values(hashToObj(ac)).map((a) => publicAccount(a, ths)),
      messages,
      deleted: (del || []).map((x) => parse(x)?.id).filter(Boolean),
      settings: s,
      overhead: { used, budget: s.overheadTokens, traffic: Number(tok || 0), coordinatorSessions, fires: fires.length, over: used >= s.overheadTokens },
    };
  }

  // ---------- noticing stopped agents ----------
  function quietMembers(th, t = now()) {
    return Object.keys(th.crew || {}).filter((n) => {
      const c = th.crew[n];
      return c.role === 'member' && n !== th.account && !c.done && !c.gone && t - (c.at || 0) >= STALL_MS;
    });
  }

  async function sweep() {
    const t = now();
    const s = await settings();
    for (const th of await threads()) {
      if (th.status !== 'working' || th.archived) continue;
      // A stopped team member: its part moves to another account.
      const quiet = quietMembers(th, t);
      if (quiet.length) {
        for (const n of quiet) th.crew[n].gone = true;
        await putThread(th);
        await post({ thread: th.id, from: 'hub', kind: 'alert', text: `Team member${quiet.length > 1 ? 's' : ''} ${quiet.join(', ')} quiet for ${Math.round(STALL_MS / 60_000)}+ min (out of usage, or the session ended).` });
        if (s.autoResume && !(await overhead()).over) await fillTeam(th, { replaces: quiet });
      }
      if (t - (th.lastAgentAt || 0) < STALL_MS) continue;
      th.status = 'stalled';
      await putThread(th);
      const mins = Math.round((t - (th.lastAgentAt || t)) / 60_000);
      await post({ thread: th.id, from: 'hub', kind: 'alert', text: `${th.account || 'The agent'} has been quiet for ${mins} min (out of usage, or its session ended).` });
      if (s.autoResume && t - (th.lastResumeAt || 0) > RESUME_GAP_MS && !(await overhead()).over) {
        th.lastResumeAt = t;
        await putThread(th);
        await dispatch(th, 'resume', { exclude: th.account ? [th.account] : [] });
      }
    }
  }

  // ---------- what an agent sees ----------
  function threadLine(t) {
    const crew = activeMembers(t);
    return `#${t.id} [${t.status}] ${t.title} (${t.account || 'unassigned'}${crew.length ? ` + ${crew.join(', ')}` : ''}, ${t.model}, thinking ${thinkingOf(t.thinking)}${teamOf(t.team) > 1 ? `, team of ${teamOf(t.team)}` : ''}${t.code === false ? ', chat' : ''})`;
  }
  function msgLine(m) {
    return `#${m.id} ${m.from}${m.to ? ` → ${m.to}` : ''} ${m.kind}${m.replyTo ? ` re #${m.replyTo}` : ''}: ${m.text}`;
  }
  function checkpointText(c) {
    return c ? `Last handover (${new Date(c.at).toISOString()} by ${c.by}):\nDone: ${c.done}\nNext: ${c.next}${c.branch ? `\nBranch: ${c.branch}` : ''}` : 'No handover yet.';
  }

  async function overview() {
    const ths = await threads();
    const open = ths.filter((t) => t.status !== 'done' && !t.archived);
    const raw = Object.values(await accounts());
    const s = await settings();
    const accs = raw.map((a) => ({ ...publicAccount(a, ths), used: usedPct(a), under: underMin(a, s) }));
    return [
      `Accounts (new work only goes to accounts with at least ${s.minLeftPct}% usage left): ` +
        (accs.map((a) => `${a.name} (${a.plan}${a.under ? ', LOW' : ''}${a.used != null ? `, ${Math.round(100 - a.used)}% left` : ''}${a.models.length ? `, ${a.models.join('/')}` : ', no routines'})`).join('; ') || 'none'),
      'Open threads:\n' + (open.map(threadLine).join('\n') || 'none'),
      'Recently done: ' + (ths.filter((t) => t.status === 'done').slice(-5).map((t) => `#${t.id} ${t.title}`).join('; ') || 'none'),
    ].join('\n\n');
  }

  async function threadText(t, limit = 40) {
    // Thinking notes are for XIAO's page, not other agents' context.
    const msgs = (await feed(1500)).filter((m) => m.thread === t.id && m.kind !== 'thinking').slice(-limit);
    const parts = Object.keys(t.crew || {}).filter((n) => t.crew[n].role === 'member' && t.crew[n].checkpoint);
    const memberHandovers = parts.map((n) => `Member ${n}${t.crew[n].done ? ' (part done)' : t.crew[n].gone ? ' (stopped)' : ''}: ${checkpointText(t.crew[n].checkpoint)}`);
    return [threadLine(t), `Brief: ${t.brief || t.title}`, checkpointText(t.checkpoint), ...memberHandovers, 'Messages:\n' + msgs.map(msgLine).join('\n')].join('\n\n');
  }

  const RULES = `Rules: you are one agent in ${owner}'s ${project} hub (several Claude accounts working as one team on the ${project} repo). Keep hub posts short. Post a hub_checkpoint after each milestone (what is done, exact next step, branch), so another account can continue if you stop. Use hub_ask when another thread knows something you need. Call hub_wait between steps for questions or new prompts in your thread. At each key decision you may post kind "thinking" with one or two sentences of why (${owner} can show these on the page; at most one per milestone). Finish with hub_post kind "done" carrying the result (PR link). If you see a usage warning, call hub_usage("low") and write a checkpoint before you stop. Repo skills in .claude/skills load in your session; ${slug === 'dop' ? 'use the dop-* one that fits, e.g. dop-verify before a PR' : 'use the one that fits, e.g. a verify skill before a PR'}.`;

  // How a team shares one thread. me: this session's account.
  function teamText(t, me, replaces = '') {
    const members = activeMembers(t).filter((n) => n !== me);
    const lead = t.account === me;
    const done = Object.keys(t.crew || {}).filter((n) => t.crew[n].role === 'member' && t.crew[n].done);
    return [
      `Team: ${teamOf(t.team)} accounts work this thread together. Lead: ${t.account}${lead ? ' (you)' : ''}. Members: ${[...(lead ? [] : [`${me} (you)`]), ...members].join(', ') || 'starting'}${done.length ? `. Parts done: ${done.join(', ')}` : ''}.`,
      lead
        ? 'You are the lead. First post a plan (hub_post kind "progress", text starting "Plan:"): one part per member by account name (members you do not see yet are on their way; give them parts as "member 2", "member 3"), each on its own branch off yours, and what done means. Do your own part, answer members, merge their branches, run the checks, open the PR and post the thread\'s "done".'
        : `You are a team member. ${replaces ? `You replace ${replaces}, who stopped: take over its part from its handover above, on its branch. ` : 'Wait (hub_wait) for the lead\'s plan, then '}work only on your part, on your own branch. When it is pushed, post kind "done" with the branch (that closes your part only), then keep calling hub_wait until the lead posts done or nobody needs you for 10 minutes.`,
      'Every post here reaches the whole team; hub_wait(thread) shows teammates\' posts. To speak to one teammate, add to: "<account>" to hub_post. Save your own hub_checkpoint after each milestone: if you stop, another account continues your part from it.',
    ].join('\n');
  }

  async function start(agent, payloadText = '') {
    const p = parse(String(payloadText || '').match(/\{[\s\S]*\}/)?.[0] || '', {}) || {};
    await touchAccount(agent.name);
    if (p.role === 'coordinator') {
      const s = await settings();
      const m = (await feed(1500)).find((x) => x.id === Number(p.prompt));
      const pending = await pendingPrompts();
      const prompts = m ? [m, ...pending.filter((x) => x.id !== m.id)] : pending;
      return coordinatorBrief(prompts, s);
    }
    if (p.thread) {
      const t = await thread(p.thread);
      if (!t) return 'That thread no longer exists. Nothing to do.';
      if (p.role === 'member') {
        if (t.status === 'done' || t.archived) return `Thread #${t.id} is finished. Nothing to do.`;
        t.crew ||= {};
        t.crew[agent.name] = { ...(t.crew[agent.name] || {}), role: 'member', at: now(), startedAt: now(), gone: false, done: false };
        await putThread(t);
        return `You are working on thread #${t.id} as ${agent.name}, a team member.\n${THINK_LINE[thinkingOf(t.thinking)]}\n\n${await threadText(t)}\n\n${teamText(t, agent.name, clean(p.replaces, 24))}\n\n${RULES}`;
      }
      // The lead's own account is no longer one of its members.
      if (t.crew?.[agent.name]) t.crew[agent.name].role = 'lead';
      for (const n of Object.keys(t.crew || {})) if (n !== agent.name && t.crew[n].role === 'lead') t.crew[n].role = 'past';
      t.account = agent.name;
      t.status = 'working';
      t.lastAgentAt = now();
      t.startedAt = now();
      await putThread(t);
      const role = p.role === 'answer' ? 'Answer the open question addressed to this thread (see messages), then stop.' : p.role === 'resume' ? 'The previous agent stopped. Continue from the last handover; check its branch first.' : 'Do the work in the brief.';
      const more = agent.plan === 'free' ? '\n\nWhen this thread is done, call hub_start again (no payload) for the next piece of work.' : '';
      const team = teamOf(t.team) > 1 ? `\n\n${teamText(t, agent.name)}` : '';
      return `You are working on thread #${t.id} as ${agent.name}. ${role}\n${THINK_LINE[thinkingOf(t.thinking)]}\n\n${await threadText(t)}${team}\n\n${RULES}${more}`;
    }
    // No payload: an agent checking in (PC agent, or a chat on any plan).
    const pending = await pendingPrompts();
    if (pending.length && agent.plan !== 'free') return coordinatorBrief(pending, await settings());
    const ths = await threads();
    const canCode = agent.plan !== 'free';
    const mine = ths.find((t) => !t.archived && ['queued', 'stalled', 'new'].includes(t.status) && (t.account === agent.name || !t.account) && (canCode || t.code === false));
    if (mine) return start(agent, json({ role: mine.status === 'stalled' ? 'resume' : 'worker', thread: mine.id }));
    return `No work waiting for ${agent.name}.\n\n${await overview()}`;
  }

  async function pendingPrompts() {
    const [msgs, gone] = await Promise.all([feed(1500), store.cmd('LRANGE', K.deleted, 0, -1)]);
    const routed = [...msgs, ...gone.map((x) => parse(x)).filter(Boolean)].filter((m) => m.kind === 'routed');
    const handled = new Set(routed.map((m) => m.replyTo));
    return msgs.filter((m) => m.thread === 0 && m.from === 'XIAO' && m.kind === 'prompt' && !handled.has(m.id)).slice(-5);
  }

  function promptLine(m) {
    const x = m.meta || {};
    const picks = [x.model && `model ${x.model}`, x.thinking && x.thinking !== 'medium' && `thinking ${x.thinking}`, x.accounts?.length && `accounts ${x.accounts.join(', ')}`, x.team && `team of ${x.team}`].filter(Boolean);
    return msgLine(m) + (picks.length ? `\n  (${owner} picked: ${picks.join('; ')})` : '');
  }

  async function coordinatorBrief(prompts, s) {
    return [
      `You are the coordinator of ${owner}'s ${project} hub. Be brief: you are the hub's overhead, so spend as few tokens as you can and do not do the work yourself.`,
      `For each prompt below make ONE hub_route call (prompt_id, summary, threads) and then stop. Split a prompt into several threads only when parts can run in parallel or need different models; most prompts are one thread. Each thread: title (a few words), brief (${owner}'s words plus anything from the overview it needs), model, code, account (usually empty). To continue an open thread instead, give its id as thread_id with the new brief. summary: one short line for ${owner}.`,
      `Models: opus = hard or design work, sonnet = normal coding, haiku = small edits, lookups, checks. code=false for tasks that need no repo (questions, research, writing, reviewing text); the hub gives those to free helper accounts first. Leave account empty to let the hub choose. team (1-${TEAM_MAX}, default 1): how many accounts work one thread together, sharing its messages and handovers; use 2-${TEAM_MAX} only for big tasks that split into parts, since each member costs a session.`,
      `If ${owner} picked a model, thinking level, accounts or team size for a prompt (shown after it), the hub applies them to its threads, so you don't need to. Otherwise choose thinking per thread: low for small tasks, medium normally, high, xhigh or max for hard ones.`,
      `Prompts:\n${prompts.map(promptLine).join('\n') || 'none (nothing to do)'}`,
      await overview(),
    ].join('\n\n');
  }

  // Coordinator: open all threads for one prompt and mark it handled, in one call.
  async function route(agent, { prompt_id, summary, threads: list = [] }) {
    const out = [];
    const meta = (await feed(1500)).find((m) => m.id === Number(prompt_id))?.meta || {};
    const picked = cleanList(meta.accounts);
    for (const x of list.slice(0, 8)) {
      if (x.thread_id) {
        const t = await thread(x.thread_id);
        if (!t) continue;
        await post({ thread: t.id, from: agent.name, kind: 'brief', text: x.brief || '' });
        if (!(t.status === 'working' && now() - (t.lastAgentAt || 0) < ACTIVE_MS)) await dispatch(t);
        out.push(`#${t.id} ${t.title} (continued)`);
      } else {
        const t = await createThread({
          ...x,
          model: meta.model || x.model,
          thinking: meta.thinking && meta.thinking !== 'medium' ? meta.thinking : thinkingOf(x.thinking, meta.thinking || 'medium'),
          team: meta.team || teamOf(x.team),
          accounts: picked,
          account: picked.length && !picked.includes(x.account) ? '' : x.account,
          from: agent.name,
        });
        out.push(`#${t.id} ${t.title}: ${t.status}${t.account ? ` on ${t.account}` : ''}`);
      }
    }
    await routed(agent, prompt_id, `${clean(summary, 400)}${out.length ? ` (${out.map((o) => o.split(':')[0]).join(', ')})` : ''}`);
    return out.join('\n') || 'Routed with no threads.';
  }

  async function routed(agent, promptId, summary) {
    await post({ thread: 0, from: agent.name, kind: 'routed', replyTo: Number(promptId), text: clean(summary, 600) || 'Routed.' });
    return 'Noted.';
  }

  async function agentPost(agent, { thread: tid, text, kind = 'note', reply_to, to = '' }) {
    const allowed = ['note', 'progress', 'question', 'answer', 'thinking', 'done'];
    kind = allowed.includes(kind) ? kind : 'note';
    tid = Number(tid) || 0;
    const t = tid ? await thread(tid) : null;
    if (tid && !t) throw new Error('No such thread.');
    // A thinking note only shows the agent is alive; it never changes the thread's state.
    if (kind === 'thinking') {
      const msg = await post({ thread: tid, from: agent.name, kind, text: clean(text, 1200) });
      if (t) { seen(t, agent.name); await putThread(t); }
      await touchAccount(agent.name);
      return `Posted #${msg.id}.`;
    }
    const member = t && isMember(t, agent.name);
    // A member's "done" finishes its part; only the lead closes the thread.
    if (member && kind === 'done') {
      t.crew[agent.name].done = true;
      kind = 'progress';
      text = `Part done: ${text}`;
    }
    const msg = await post({ thread: tid, from: agent.name, kind, text, replyTo: reply_to, to });
    if (t) {
      seen(t, agent.name);
      if (kind === 'done') t.status = 'done';
      else if (kind === 'question' && !reply_to && !to) t.status = 'waiting';
      else if (t.status !== 'done' && !member) t.status = 'working';
      await putThread(t);
    }
    await touchAccount(agent.name);
    return `Posted #${msg.id}.`;
  }

  async function checkpoint(agent, { thread: tid, done, next, branch = '' }) {
    const t = await thread(tid);
    if (!t) throw new Error('No such thread.');
    const cp = { at: now(), by: agent.name, done: clean(done, 3000), next: clean(next, 3000), branch: clean(branch, 120) };
    // Members keep their own handover, so each part can be continued alone.
    if (isMember(t, agent.name)) t.crew[agent.name].checkpoint = cp;
    else t.checkpoint = cp;
    seen(t, agent.name);
    await putThread(t);
    await post({ thread: t.id, from: agent.name, kind: 'handover', text: `Done: ${cp.done}\nNext: ${cp.next}${cp.branch ? `\nBranch: ${cp.branch}` : ''}` });
    return 'Handover saved.';
  }

  // Ask another thread (or XIAO). If nobody is running on the target thread,
  // start a short session there to answer.
  async function ask(agent, { from_thread, to_thread, question }) {
    const target = await thread(to_thread);
    if (!target) throw new Error('No such thread.');
    const msg = await post({ thread: target.id, from: `${agent.name}${from_thread ? ` (thread #${from_thread})` : ''}`, kind: 'question', text: question });
    if (target.status !== 'working' || now() - (target.lastAgentAt || 0) >= ACTIVE_MS) {
      if (target.status === 'done') {
        const t2 = { ...target, status: 'new' };
        await putThread(t2);
        await dispatch(t2, 'answer');
      } else await dispatch(target, 'answer');
    }
    return msg;
  }

  // An agent is still alive on this thread (it is waiting for messages).
  async function heartbeat(tid, name = '') {
    const t = await thread(tid);
    if (!t || t.status === 'done') return;
    seen(t, name);
    if (t.status === 'stalled' && !isMember(t, name)) t.status = 'working';
    await putThread(t);
  }

  async function answerFor(qid) {
    return (await feed(1500)).find((m) => m.replyTo === qid && m.kind === 'answer') || null;
  }

  return {
    project, owner, store, now, // store + clock for tool modules (tools-files.js)
    settings, saveSettings, accounts, account, upsertAccount, removeAccount, newKey, publicAccount, authAgent, touchAccount, markConnected, setLow, refreshUsage, setUsage,
    logConn, connLog,
    threads, thread, post, feed, messagesSince, overhead, countTraffic, createThread, prompt, updateThread, deleteThread, deleteMessage, snapshot, sweep, dispatch,
    start, route, routed, agentPost, heartbeat, checkpoint, ask, answerFor, overview, threadText, msgLine, nextSeq: async () => Number((await store.cmd('GET', K.seq)) || 0),
    // What the page compares to know whether to fetch again.
    version: async () => {
      const [seq, rev] = await store.multi([['GET', K.seq], ['GET', K.rev]]);
      return `${Number(seq || 0)}.${Number(rev || 0)}`;
    },
  };
}
