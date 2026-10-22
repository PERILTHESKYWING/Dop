// Remote MCP server (Streamable HTTP, stateless JSON replies) that gives any
// Claude on any account the hub tools: claude.ai chats (web, desktop, phone),
// cloud Claude Code sessions and routines, and Claude Code on a PC.
import { webTools } from './tools-web.js';
import { fileTools } from './tools-files.js';
import { skillTools } from './tools-skills.js';
import { studioTools } from './studio.js';
import { libraryTools } from './library.js';
import { repoTools } from './tools-repos.js';
import { nextChange, waitAnswer, wakeWaiters } from './wake.js';

const WAIT_MAX_S = 45; // stays under the 60 s function limit on Vercel Hobby

// What a warm function instance remembers between calls (a cold one starts
// empty, which is always safe). Keyed by project: production makes a new
// hub and store object for every request.
// The stopped-agent check (sweep: reads every thread) runs at most this
// often per instance; stalls take 15 minutes, and open pages and the
// hub-wake workflow check too.
const SWEEP_MS = 30_000;
const lastSweep = new Map();
// Hub traffic (the overhead budget estimate) is counted in the background:
// a call's characters are added to the next call's store work instead of
// costing a round trip of their own. Big replies are counted at once.
const TRAFFIC_FLUSH = 8000;
const pendingTraffic = new Map();

function sweepDue(hub) {
  const t = hub.now();
  const last = lastSweep.get(hub.project);
  if (last != null && t >= last && t - last < SWEEP_MS) return false;
  lastSweep.set(hub.project, t);
  return true;
}
function flushTraffic(hub) {
  const n = pendingTraffic.get(hub.project) || 0;
  if (!n) return null;
  pendingTraffic.set(hub.project, 0);
  return hub.countTraffic(n).catch(() => pendingTraffic.set(hub.project, (pendingTraffic.get(hub.project) || 0) + n));
}
function addTraffic(hub, chars) {
  pendingTraffic.set(hub.project, (pendingTraffic.get(hub.project) || 0) + chars);
  return pendingTraffic.get(hub.project) >= TRAFFIC_FLUSH ? flushTraffic(hub) : null;
}
// Tools that post something a waiting teammate may want: their waiters on
// this instance check at once.
const WAKES = new Set(['hub_post', 'hub_learn', 'hub_checkpoint', 'hub_route', 'hub_routed', 'hub_create_thread', 'image_gen']);
// Tools whose replies also carry the caller's news, and which argument names its thread.
const NEWS_ARG = { hub_post: 'thread', hub_checkpoint: 'thread', hub_ask: 'from_thread', hub_learn: 'thread' };

export function toolsFor(hub) {
  const num = { type: 'number' };
  const str = { type: 'string' };
  const team = { type: 'number', description: 'Accounts working this thread together (1-4, default 1): a lead plus members sharing its messages and handovers.' };
  return [
    {
      name: 'hub_start',
      description:
        'Start here. Pass the routine-fire payload text if you were started by one (it names your role and thread); otherwise call it with no payload to check in and get any work waiting for this account.',
      inputSchema: { type: 'object', properties: { payload: str } },
      run: (a, x) => hub.start(a, x.payload || ''),
    },
    {
      name: 'hub_route',
      description: 'Coordinator: handle one prompt in one call. Opens its threads (or continues open ones via thread_id), starts agents, and tells XIAO where it went.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt_id: num,
          summary: str,
          threads: {
            type: 'array',
            items: {
              type: 'object',
              properties: { title: str, brief: str, model: { type: 'string', enum: ['opus', 'sonnet', 'haiku', 'fable'] }, thinking: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'] }, code: { type: 'boolean' }, account: str, team, thread_id: num },
              required: ['brief'],
            },
          },
        },
        required: ['prompt_id', 'summary', 'threads'],
      },
      run: (a, x) => hub.route(a, x),
    },
    {
      name: 'hub_create_thread',
      description: 'Coordinator: open a thread for one piece of work and start an agent on it (team > 1 starts several accounts on it). model: opus, sonnet, haiku or fable. code=false for work that needs no repo.',
      inputSchema: {
        type: 'object',
        properties: { title: str, brief: str, model: { type: 'string', enum: ['opus', 'sonnet', 'haiku', 'fable'] }, thinking: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'] }, account: str, team, code: { type: 'boolean' } },
        required: ['title', 'brief'],
      },
      run: async (a, x) => {
        const t = await hub.createThread({ ...x, from: a.name });
        return `Thread #${t.id} "${t.title}": ${t.status}${t.account ? ` on ${t.account}` : ''}.`;
      },
    },
    {
      name: 'hub_routed',
      description: 'Coordinator: mark a prompt from XIAO as handled, with one short line telling XIAO where it went.',
      inputSchema: { type: 'object', properties: { prompt_id: num, summary: str }, required: ['prompt_id', 'summary'] },
      run: (a, x) => hub.routed(a, x.prompt_id, x.summary),
    },
    {
      name: 'hub_post',
      description: 'Post in a thread (thread 0 = the main project chat). kind: progress, question (to XIAO, or to a teammate with to), answer (with reply_to), note, thinking (one or two sentences of your reasoning at a key decision; XIAO\'s page shows it only when asked, and other agents don\'t receive it), done (final result; closes the thread, or only your part if you are a team member). to: a teammate\'s account name, to address one teammate (everyone on the thread still sees it).',
      inputSchema: {
        type: 'object',
        properties: { thread: num, text: str, kind: { type: 'string', enum: ['progress', 'question', 'answer', 'note', 'thinking', 'done'] }, reply_to: num, to: str, wait_s: { type: 'number', description: 'Optional (max 45): after posting, wait this long for teammates\' replies and return them in the same call (saves a hub_wait).' } },
        required: ['thread', 'text'],
      },
      run: async (a, x) => {
        const res = await hub.agentPost(a, x);
        const wait = Number(x.wait_s) || 0;
        if (!wait || x.kind === 'thinking' || x.kind === 'done') return res;
        const tid = Number(x.thread) || 0;
        const end = Date.now() + Math.min(WAIT_MAX_S, wait) * 1000;
        wakeWaiters();
        let n = await hub.news(a, tid);
        while (!n.text && (await nextChange(hub, n.seq, end))) n = await hub.news(a, tid);
        return n.text ? `${res}\n\n${n.text}` : `${res} No replies yet.`;
      },
    },
    {
      name: 'hub_checkpoint',
      description: 'Save a handover for your thread: what is done, the exact next step, and the branch. Another account continues from it if you stop.',
      inputSchema: { type: 'object', properties: { thread: num, done: str, next: str, branch: str }, required: ['thread', 'done', 'next'] },
      run: (a, x) => hub.checkpoint(a, x),
    },
    {
      name: 'hub_agent',
      description: 'Report a sub-agent you deployed yourself (with your own Agent tool) so XIAO\'s page shows its live progress. action "start" (id, title, optional thread), "update" (id, step, pct 0-100, note), "finish" (id, status done or failed, note). Call it when you start one, at each step, and when it ends. Cheap: no model call.',
      inputSchema: {
        type: 'object',
        properties: { action: { type: 'string', enum: ['start', 'update', 'finish'] }, id: str, thread: num, title: str, step: str, pct: num, note: str, status: { type: 'string', enum: ['done', 'failed'] } },
        required: ['action', 'id'],
      },
      run: (a, x) => hub.agentRun(a, x),
    },
    {
      name: 'hub_ask',
      description: 'Ask another thread a question and wait (up to wait_s, max 45) for its answer. If nobody is working there, the hub starts a short session to answer.',
      inputSchema: { type: 'object', properties: { from_thread: num, to_thread: num, question: str, wait_s: num }, required: ['to_thread', 'question'] },
      run: async (a, x) => {
        const q = await hub.ask(a, x);
        wakeWaiters();
        const end = Date.now() + Math.min(WAIT_MAX_S, x.wait_s ?? 40) * 1000;
        // Reads only messages newer than the last look, not 400 each time.
        const ans = await waitAnswer(hub, q.id, end);
        if (ans) return hub.msgLine(ans);
        await hub.watchQuestion(a, x.from_thread, q.id);
        return `No answer to #${q.id} yet. Carry on: the answer comes with your next hub call (hub_sync between steps), or use hub_wait(thread: ${x.from_thread || 0}) if you can't go on without it.`;
      },
    },
    {
      name: 'hub_sync',
      description: 'Call between steps; answers at once. Returns anything new for your thread (XIAO\'s replies, questions for you, answers to questions you asked) and new team lessons, or "Nothing new."',
      inputSchema: { type: 'object', properties: { thread: num }, required: ['thread'] },
      run: async (a, x) => {
        const tid = Number(x.thread) || 0;
        const [, n] = await Promise.all([tid && hub.heartbeat(tid, a.name), hub.news(a, tid)]);
        return n.text || 'Nothing new.';
      },
    },
    {
      name: 'hub_wait',
      description: 'Wait up to wait_s (max 45) for anything new for your thread: questions for you, answers to your questions, teammates\' posts, new prompts from XIAO, new team lessons. Returns the moment something arrives. "→ <name>" marks a post addressed to that account.',
      inputSchema: { type: 'object', properties: { thread: num, after: num, wait_s: num }, required: ['thread'] },
      run: async (a, x) => {
        const tid = Number(x.thread) || 0;
        const end = Date.now() + Math.min(WAIT_MAX_S, x.wait_s ?? 20) * 1000;
        // The agent is alive while it waits; marking that first keeps it off the way back.
        let [, n] = await Promise.all([tid && hub.heartbeat(tid, a.name), hub.news(a, tid, { after: x.after })]);
        while (!n.text && (await nextChange(hub, n.seq, end))) n = await hub.news(a, tid);
        return n.text || 'No new messages.';
      },
    },
    {
      name: 'hub_learn',
      description: 'Teach every account at once. Save a lesson the moment you learn it: something that worked or failed that other agents would otherwise repeat (a command, a repo gotcha, a rule XIAO stated). kind "do" or "dont", one short sentence, and why. Every other agent gets it on its next hub call. Never put keys or passwords in a lesson.',
      inputSchema: { type: 'object', properties: { lesson: str, kind: { type: 'string', enum: ['do', 'dont'] }, why: str, thread: num }, required: ['lesson', 'kind'] },
      run: async (a, x) => {
        const r = await hub.learn({ text: x.lesson, kind: x.kind, why: x.why, by: a.name, thread: x.thread });
        return r.known ? `Already known as L${r.lesson.id}.` : `Saved as L${r.lesson.id}. Every account gets it on its next hub call.`;
      },
    },
    {
      name: 'hub_read',
      description: 'Read the hub: no thread = overview of accounts and threads; a thread id = its brief, handover and recent messages.',
      inputSchema: { type: 'object', properties: { thread: num } },
      run: async (a, x) => {
        if (!x.thread) return hub.overview();
        const t = await hub.thread(x.thread);
        return t ? hub.threadText(t) : 'No such thread.';
      },
    },
    {
      name: 'hub_usage',
      description: 'Report your account\'s usage. To read it: run `node hub/usage-probe.mjs` and pass what it prints (five_hour_pct, seven_day_pct, *_resets) with state "report". state "low" when you see a usage warning (new work then goes to other accounts; pass the *_resets times if you know them so the hub restarts your thread when the limit resets), "ok" when it has reset.',
      inputSchema: { type: 'object', properties: { state: { type: 'string', enum: ['low', 'ok', 'report'] }, percent: num, five_hour_pct: num, seven_day_pct: num, five_hour_resets: str, seven_day_resets: str, source: { type: 'string', enum: ['agent', 'pc'] }, note: str }, required: ['state'] },
      run: async (a, x) => {
        const five = typeof x.five_hour_pct === 'number' ? x.five_hour_pct : typeof x.percent === 'number' ? x.percent : null;
        const week = typeof x.seven_day_pct === 'number' ? x.seven_day_pct : null;
        // "ok" first: it forgets the old reading, so fresh numbers go on after it.
        // "low" last: its reset time (when the hub restarts its work) comes from them.
        if (x.state === 'ok') await hub.setLow(a.name, false);
        if (five != null || week != null) {
          const usage = { five_hour_pct: five, seven_day_pct: week, five_hour_resets: x.five_hour_resets || null, seven_day_resets: x.seven_day_resets || null, at: hub.now(), source: x.source === 'pc' ? 'pc' : 'agent' };
          await hub.touchAccount(a.name, { usage, usageErr: '' });
        }
        if (x.state === 'low') await hub.setLow(a.name, true, x.note || (five != null ? `${five}% used` : ''), { by: 'agent' });
        if (x.state === 'report') return 'Thanks.';
        return x.state === 'low' ? 'Marked low. Write your hub_checkpoint now, then stop.' : 'Marked ok.';
      },
    },
    ...webTools(fetch, hub),
    ...fileTools(hub),
    ...skillTools(hub),
    ...studioTools(hub),
    ...libraryTools(hub),
    ...repoTools(hub),
  ];
}

// Handle one JSON-RPC message (or batch). Returns the reply body, or null
// for notifications.
export async function handleMcp(hub, agent, body) {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((b) => handleMcp(hub, agent, b)))).filter(Boolean);
    return out.length ? out : null;
  }
  const { id, method, params = {} } = body || {};
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (method === 'initialize') {
    return ok({
      protocolVersion: params.protocolVersion || '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: `${hub.project.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-hub`, version: '2.0.0' },
      instructions: `You are connected to ${hub.owner}'s ${hub.project} hub as account ${agent.name}. Call hub_start first.`,
    });
  }
  if (id === undefined) return null; // notifications
  if (method === 'ping') return ok({});
  const tools = toolsFor(hub);
  if (method === 'tools/list') return ok({ tools: tools.map(({ run, ...t }) => t) });
  if (method === 'tools/call') {
    const tool = tools.find((t) => t.name === params.name);
    if (!tool) return fail(-32602, `Unknown tool ${params.name}`);
    const args = params.arguments || {};
    const flushing = flushTraffic(hub);
    // News rides along with these tools. hub_post that waited has already
    // read it; hub_ask reads it after its wait; the rest read it while the
    // tool runs (both are independent store work).
    const newsArg = NEWS_ARG[tool.name];
    const waited = tool.name === 'hub_post' && Number(args.wait_s) > 0 && args.kind !== 'thinking' && args.kind !== 'done';
    const newsNow = newsArg && !waited && tool.name !== 'hub_ask';
    let news = null;
    try {
      if (sweepDue(hub)) await hub.sweep();
      news = newsNow ? hub.news(agent, args[newsArg]) : null;
      // A failed tool must not lose the news it already marked as seen.
      if (news) news.catch(() => {});
      const out = await tool.run(agent, args);
      if (WAKES.has(tool.name)) wakeWaiters();
      if (out && typeof out === 'object' && Array.isArray(out.content)) {
        // Rich result (images). Only the text parts count as hub traffic.
        const t = out.content.map((c) => c.text || '').join('');
        await Promise.all([flushing, addTraffic(hub, JSON.stringify(args).length + t.length)]);
        return ok({ content: out.content });
      }
      let text = String(out);
      if (newsArg && !waited) {
        const n = news ? await news.catch(() => ({ text: '' })) : await hub.news(agent, args[newsArg]);
        if (n.text) text += `\n\n${n.text}`;
      }
      await Promise.all([flushing, addTraffic(hub, JSON.stringify(args).length + text.length)]);
      return ok({ content: [{ type: 'text', text }] });
    } catch (e) {
      let text = `Hub error: ${e.message}`;
      const n = news && (await news.catch(() => null));
      if (n?.text) text += `\n\n${n.text}`;
      await flushing;
      return ok({ content: [{ type: 'text', text }], isError: true });
    }
  }
  return fail(-32601, `Method ${method} not supported`);
}
