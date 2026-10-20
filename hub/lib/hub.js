// Dop hub core: accounts, threads, messages, dispatch and handover.
// Storage is a small Redis-like store (lib/store.js). Everything runs inside
// short serverless calls, so there are no timers: stale work is noticed
// whenever the page or an agent next talks to the hub.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const MODELS = ['opus', 'sonnet', 'haiku', 'fable'];
const K = { seq: 'hub:seq', feed: 'hub:feed', threads: 'hub:threads', accounts: 'hub:accounts', settings: 'hub:settings', fires: 'hub:fires' };
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
};

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

export function safeEqual(a, b) {
  const x = createHash('sha256').update(String(a)).digest();
  const y = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(x, y);
}

export function createHub({ store, fetchImpl = fetch, now = () => Date.now() }) {
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
    await store.cmd('SET', K.settings, json(out));
    return out;
  }

  // ---------- accounts ----------
  async function accounts() {
    return hashToObj(await store.cmd('HGETALL', K.accounts));
  }
  async function account(name) {
    return parse(await store.cmd('HGET', K.accounts, name));
  }
  async function putAccount(a) {
    await store.cmd('HSET', K.accounts, a.name, json(a));
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
      routines = input.routines
        .map((r) => {
          const prev = routines.find((p) => p.id === clean(r.id, 80));
          return {
            model: MODELS.includes(r.model) ? r.model : 'sonnet',
            id: clean(r.id, 80),
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
      lastSeen: a.lastSeen || 0,
      online: t - (a.lastSeen || 0) < ACTIVE_MS,
      models: [...new Set((a.routines || []).map((r) => r.model))],
      routines: (a.routines || []).map((r) => ({ model: r.model, id: r.id, hasToken: !!r.token })),
      working: threads.filter((th) => th.account === a.name && th.status === 'working').length,
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
    Object.assign(a, patch, { lastSeen: now() });
    if (a.usage && now() - (a.usage.at || now()) > FIVE_H) a.usage = null;
    if (a.usage) {
      const pct = Math.max(a.usage.five_hour_pct ?? 0, a.usage.seven_day_pct ?? 0);
      if (pct >= 85 && !a.low) {
        a.low = true;
        a.lowNote = `${Math.round(pct)}% of its limit used`;
        await announceLow(a);
      } else if (pct < 70 && a.low && a.lowNote?.endsWith('limit used')) {
        a.low = false;
        a.lowNote = '';
      }
    }
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
    await store.cmd('HSET', K.threads, String(t.id), json(t));
    return t;
  }

  async function post({ thread: tid = 0, from, kind = 'note', text, replyTo = null }) {
    const msg = { id: await nextId(), at: now(), thread: Number(tid) || 0, from, kind, text: clean(text, 20_000), replyTo: replyTo ? Number(replyTo) : null };
    await store.multi([
      ['RPUSH', K.feed, json(msg)],
      ['LTRIM', K.feed, -KEEP_FEED, -1],
    ]);
    return msg;
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

  async function fire(a, model, payload, role) {
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
        body: json({ text: json({ hub: 'dop', ...payload }) }),
      });
    } catch (e) {
      return { ok: false, reason: `could not reach Claude: ${e.message}` };
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return { ok: false, reason: `${a.name}'s ${model} routine token was refused (${res.status})` };
      if (res.status === 429) return { ok: false, reason: `${a.name} is rate limited` };
      return { ok: false, reason: `Claude returned ${res.status}` };
    }
    const fresh = await account(a.name);
    const fr = (fresh.routines || []).find((x) => x.id === r.id);
    if (fr) fr.fires = [...(fr.fires || []).filter((f) => now() - f < 3600_000), now()];
    await putAccount(fresh);
    await store.multi([
      ['RPUSH', K.fires, json({ at: now(), account: a.name, model, role })],
      ['LTRIM', K.fires, -500, -1],
    ]);
    return { ok: true, url: body.claude_code_session_url || '', account: a.name, model };
  }

  // Best account for new work: not low, has a routine for the model, fewest
  // open threads. Accounts without routines (free plan, PC) never auto-start.
  async function chooseAccount(model, { prefer = '', exclude = [], code = true } = {}) {
    const all = Object.values(await accounts());
    const ths = await threads();
    const load = (n) => ths.filter((t) => t.account === n && t.status === 'working').length;
    const usable = all.filter((a) => !a.low && !exclude.includes(a.name) && (!code || a.plan !== 'free'));
    const fireable = usable.filter((a) => pickRoutine(a, model));
    const preferred = fireable.find((a) => a.name === prefer);
    if (preferred) return preferred;
    fireable.sort((a, b) => load(a.name) - load(b.name));
    return fireable[0] || null;
  }

  // Hand a thread to an agent: start a cloud session if we can, otherwise
  // leave it queued for an agent that checks in (PC, free-plan chat).
  async function dispatch(t, role = 'worker', extra = {}) {
    const exclude = extra.exclude || [];
    // Free helper accounts take no-code work first, saving the paid accounts.
    if (!t.account && t.code === false && role === 'worker') {
      const ths = await threads();
      const load = (n) => ths.filter((x) => x.account === n && ['queued', 'working'].includes(x.status)).length;
      const helpers = Object.values(await accounts()).filter((x) => x.plan === 'free' && !x.low && !exclude.includes(x.name));
      helpers.sort((x, y) => load(x.name) - load(y.name));
      if (helpers[0]) t.account = helpers[0].name;
    }
    let a = t.account ? await account(t.account) : null;
    // Chosen on purpose for an account the hub can't start (free plan, PC):
    // keep it there until that account checks in.
    if (a && !a.low && !exclude.includes(a.name) && !(a.routines || []).length && (a.plan !== 'free' || t.code === false)) {
      t.status = 'queued';
      await putThread(t);
      await post({ thread: t.id, from: 'hub', kind: 'alert', text: `Waiting for ${a.name} to check in (open a chat on that account and say "check the Dop hub").` });
      return { ok: false, queued: a.name };
    }
    if (a && (a.low || exclude.includes(a.name) || !pickRoutine(a, t.model))) a = null;
    if (!a) a = await chooseAccount(t.model, { prefer: t.account, exclude, code: t.code !== false });
    if (!a) {
      t.status = 'queued';
      await putThread(t);
      await post({ thread: t.id, from: 'hub', kind: 'alert', text: `Waiting for an agent: no account can start a ${t.model} session right now. A PC or chat agent can pick it up with hub_start.` });
      return { ok: false };
    }
    const r = await fire(a, t.model, { role, thread: t.id }, role);
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
    await post({ thread: t.id, from: 'hub', kind: 'start', text: `Started ${a.name} on ${t.model}${role === 'resume' ? ' to continue from the last handover' : ''}.` });
    return { ok: true, account: a.name };
  }

  async function createThread({ title, brief, account: acc = '', model = 'sonnet', code = true, from = 'coordinator', parent = null }) {
    const t = {
      id: await nextId(),
      title: clean(title, 80) || 'Untitled',
      brief: clean(brief, 8000),
      account: clean(acc, 24),
      model: MODELS.includes(model) ? model : 'sonnet',
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
  async function prompt({ text, thread: tid = 0, model, account: acc, direct = false }) {
    text = clean(text, 20_000);
    if (!text) throw new Error('Empty prompt.');
    if (tid) {
      const t = await thread(tid);
      if (!t) throw new Error('No such thread.');
      if (MODELS.includes(model)) t.model = model;
      if (typeof acc === 'string') t.account = clean(acc, 24);
      const msg = await post({ thread: t.id, from: 'XIAO', kind: 'prompt', text });
      if (t.status === 'done' || t.status === 'waiting' || t.status === 'stalled' || t.status === 'queued') t.status = 'new';
      await putThread(t);
      // A running agent sees it with hub_wait; otherwise start one.
      if (!(t.status === 'working' && now() - (t.lastAgentAt || 0) < ACTIVE_MS)) await dispatch(t);
      return msg;
    }
    const msg = await post({ thread: 0, from: 'XIAO', kind: 'prompt', text });
    const s = await settings();
    const ov = await overhead();
    if (ov.over || direct) {
      if (!direct) await post({ thread: 0, from: 'hub', kind: 'alert', text: 'Hub overhead budget for this 5 hours is used up, so this prompt skips the coordinator and becomes one thread.' });
      await createThread({ title: text.split('\n')[0].slice(0, 60), brief: text, model: MODELS.includes(model) ? model : 'sonnet', account: acc || '', from: 'hub' });
      return msg;
    }
    const a = await chooseAccount(s.coordinatorModel, { prefer: s.coordinatorAccount });
    if (!a) {
      await post({ thread: 0, from: 'hub', kind: 'alert', text: 'No account can start the coordinator right now. A PC or chat agent will see this prompt when it calls hub_start.' });
      return msg;
    }
    const r = await fire(a, s.coordinatorModel, { role: 'coordinator', prompt: msg.id }, 'coordinator');
    await post({ thread: 0, from: 'hub', kind: r.ok ? 'start' : 'alert', text: r.ok ? `Coordinator started on ${a.name} (${s.coordinatorModel}).` : `Coordinator could not start: ${r.reason}.` });
    return msg;
  }

  async function updateThread(id, patch) {
    const t = await thread(id);
    if (!t) throw new Error('No such thread.');
    if (MODELS.includes(patch.model)) t.model = patch.model;
    if (typeof patch.account === 'string') t.account = clean(patch.account, 24);
    if (['done', 'new'].includes(patch.status)) t.status = patch.status;
    if (typeof patch.title === 'string' && patch.title.trim()) t.title = clean(patch.title, 80);
    return putThread(t);
  }

  // ---------- noticing stopped agents ----------
  async function sweep() {
    const t = now();
    const s = await settings();
    for (const th of await threads()) {
      if (th.status !== 'working' || t - (th.lastAgentAt || 0) < STALL_MS) continue;
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
    return `#${t.id} [${t.status}] ${t.title} (${t.account || 'unassigned'}, ${t.model}${t.code === false ? ', chat' : ''})`;
  }
  function msgLine(m) {
    return `#${m.id} ${m.from} ${m.kind}${m.replyTo ? ` re #${m.replyTo}` : ''}: ${m.text}`;
  }
  function checkpointText(c) {
    return c ? `Last handover (${new Date(c.at).toISOString()} by ${c.by}):\nDone: ${c.done}\nNext: ${c.next}${c.branch ? `\nBranch: ${c.branch}` : ''}` : 'No handover yet.';
  }

  async function overview() {
    const ths = await threads();
    const open = ths.filter((t) => t.status !== 'done');
    const accs = Object.values(await accounts()).map((a) => publicAccount(a, ths));
    return [
      'Accounts: ' + (accs.map((a) => `${a.name} (${a.plan}${a.low ? ', LOW' : ''}${a.models.length ? `, ${a.models.join('/')}` : ', no routines'})`).join('; ') || 'none'),
      'Open threads:\n' + (open.map(threadLine).join('\n') || 'none'),
      'Recently done: ' + (ths.filter((t) => t.status === 'done').slice(-5).map((t) => `#${t.id} ${t.title}`).join('; ') || 'none'),
    ].join('\n\n');
  }

  async function threadText(t, limit = 40) {
    const msgs = (await feed(1500)).filter((m) => m.thread === t.id).slice(-limit);
    return [threadLine(t), `Brief: ${t.brief || t.title}`, checkpointText(t.checkpoint), 'Messages:\n' + msgs.map(msgLine).join('\n')].join('\n\n');
  }

  const RULES = `Rules: you are one agent in XIAO's Dop hub (several Claude accounts working as one team on the Dop repo). Keep hub posts short. Post a hub_checkpoint after each milestone (what is done, exact next step, branch), so another account can continue if you stop. Use hub_ask when another thread knows something you need. Call hub_wait between steps for questions or new prompts in your thread. Finish with hub_post kind "done" carrying the result (PR link). If you see a usage warning, call hub_usage("low") and write a checkpoint before you stop.`;

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
      t.account = agent.name;
      t.status = 'working';
      t.lastAgentAt = now();
      await putThread(t);
      const role = p.role === 'answer' ? 'Answer the open question addressed to this thread (see messages), then stop.' : p.role === 'resume' ? 'The previous agent stopped. Continue from the last handover; check its branch first.' : 'Do the work in the brief.';
      const more = agent.plan === 'free' ? '\n\nWhen this thread is done, call hub_start again (no payload) for the next piece of work.' : '';
      return `You are working on thread #${t.id} as ${agent.name}. ${role}\n\n${await threadText(t)}\n\n${RULES}${more}`;
    }
    // No payload: an agent checking in (PC agent, or a chat on any plan).
    const pending = await pendingPrompts();
    if (pending.length && agent.plan !== 'free') return coordinatorBrief(pending, await settings());
    const ths = await threads();
    const canCode = agent.plan !== 'free';
    const mine = ths.find((t) => ['queued', 'stalled', 'new'].includes(t.status) && (t.account === agent.name || !t.account) && (canCode || t.code === false));
    if (mine) return start(agent, json({ role: mine.status === 'stalled' ? 'resume' : 'worker', thread: mine.id }));
    return `No work waiting for ${agent.name}.\n\n${await overview()}`;
  }

  async function pendingPrompts() {
    const msgs = await feed(1500);
    const handled = new Set(msgs.filter((m) => m.kind === 'routed').map((m) => m.replyTo));
    return msgs.filter((m) => m.thread === 0 && m.from === 'XIAO' && m.kind === 'prompt' && !handled.has(m.id)).slice(-5);
  }

  async function coordinatorBrief(prompts, s) {
    return [
      `You are the coordinator of XIAO's Dop hub. Be brief: you are the hub's overhead, so spend as few tokens as you can and do not do the work yourself.`,
      `For each prompt below make ONE hub_route call (prompt_id, summary, threads) and then stop. Split a prompt into several threads only when parts can run in parallel or need different models; most prompts are one thread. Each thread: title (a few words), brief (XIAO's words plus anything from the overview it needs), model, code, account (usually empty). To continue an open thread instead, give its id as thread_id with the new brief. summary: one short line for XIAO.`,
      `Models: opus = hard or design work, sonnet = normal coding, haiku = small edits, lookups, checks. code=false for tasks that need no repo (questions, research, writing, reviewing text); the hub gives those to free helper accounts first. Leave account empty to let the hub choose.`,
      `Prompts:\n${prompts.map(msgLine).join('\n') || 'none (nothing to do)'}`,
      await overview(),
    ].join('\n\n');
  }

  // Coordinator: open all threads for one prompt and mark it handled, in one call.
  async function route(agent, { prompt_id, summary, threads: list = [] }) {
    const out = [];
    for (const x of list.slice(0, 8)) {
      if (x.thread_id) {
        const t = await thread(x.thread_id);
        if (!t) continue;
        await post({ thread: t.id, from: agent.name, kind: 'brief', text: x.brief || '' });
        if (!(t.status === 'working' && now() - (t.lastAgentAt || 0) < ACTIVE_MS)) await dispatch(t);
        out.push(`#${t.id} ${t.title} (continued)`);
      } else {
        const t = await createThread({ ...x, from: agent.name });
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

  async function agentPost(agent, { thread: tid, text, kind = 'note', reply_to }) {
    const allowed = ['note', 'progress', 'question', 'answer', 'done'];
    kind = allowed.includes(kind) ? kind : 'note';
    tid = Number(tid) || 0;
    const t = tid ? await thread(tid) : null;
    if (tid && !t) throw new Error('No such thread.');
    const msg = await post({ thread: tid, from: agent.name, kind, text, replyTo: reply_to });
    if (t) {
      t.lastAgentAt = now();
      if (kind === 'done') t.status = 'done';
      else if (kind === 'question' && !reply_to) t.status = 'waiting';
      else if (t.status !== 'done') t.status = 'working';
      await putThread(t);
    }
    await touchAccount(agent.name);
    return `Posted #${msg.id}.`;
  }

  async function checkpoint(agent, { thread: tid, done, next, branch = '' }) {
    const t = await thread(tid);
    if (!t) throw new Error('No such thread.');
    t.checkpoint = { at: now(), by: agent.name, done: clean(done, 3000), next: clean(next, 3000), branch: clean(branch, 120) };
    t.lastAgentAt = now();
    await putThread(t);
    await post({ thread: t.id, from: agent.name, kind: 'handover', text: `Done: ${t.checkpoint.done}\nNext: ${t.checkpoint.next}${t.checkpoint.branch ? `\nBranch: ${t.checkpoint.branch}` : ''}` });
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
  async function heartbeat(tid) {
    const t = await thread(tid);
    if (!t || t.status === 'done') return;
    t.lastAgentAt = now();
    if (t.status === 'stalled') t.status = 'working';
    await putThread(t);
  }

  async function answerFor(qid) {
    return (await feed(1500)).find((m) => m.replyTo === qid && m.kind === 'answer') || null;
  }

  return {
    settings, saveSettings, accounts, account, upsertAccount, removeAccount, publicAccount, authAgent, touchAccount, setLow,
    threads, thread, post, feed, messagesSince, overhead, countTraffic, createThread, prompt, updateThread, sweep, dispatch,
    start, route, routed, agentPost, heartbeat, checkpoint, ask, answerFor, overview, threadText, msgLine, nextSeq: async () => Number((await store.cmd('GET', K.seq)) || 0),
  };
}
