// Remote MCP server (Streamable HTTP, stateless JSON replies) that gives any
// Claude on any account the hub tools: claude.ai chats (web, desktop, phone),
// cloud Claude Code sessions and routines, and Claude Code on a PC.
const WAIT_MAX_S = 45; // stays under the 60 s function limit on Vercel Hobby
// Waiting agents check this often, with one small read (the hub's seq).
const POLL_MS = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Sleep until anything new lands in the hub, or until end. Returns the new
// seq, or 0 when time ran out.
async function nextChange(hub, from, end) {
  while (Date.now() < end) {
    await sleep(Math.min(POLL_MS, end - Date.now()));
    const s = await hub.nextSeq();
    if (s !== from) return s;
  }
  return 0;
}
// Tools whose replies also carry the caller's news, and which argument names its thread.
const NEWS_ARG = { hub_post: 'thread', hub_checkpoint: 'thread', hub_ask: 'from_thread', hub_learn: 'thread' };

export function toolsFor(hub) {
  const num = { type: 'number' };
  const str = { type: 'string' };
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
              properties: { title: str, brief: str, model: { type: 'string', enum: ['opus', 'sonnet', 'haiku', 'fable'] }, thinking: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'] }, code: { type: 'boolean' }, account: str, thread_id: num },
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
      description: 'Coordinator: open a thread for one piece of work and start an agent on it. model: opus, sonnet, haiku or fable. code=false for work that needs no repo.',
      inputSchema: {
        type: 'object',
        properties: { title: str, brief: str, model: { type: 'string', enum: ['opus', 'sonnet', 'haiku', 'fable'] }, thinking: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'] }, account: str, code: { type: 'boolean' } },
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
      description: 'Post in a thread (thread 0 = the main project chat). kind: progress, question (to XIAO), answer (with reply_to), note, done (final result; closes the thread).',
      inputSchema: {
        type: 'object',
        properties: { thread: num, text: str, kind: { type: 'string', enum: ['progress', 'question', 'answer', 'note', 'done'] }, reply_to: num },
        required: ['thread', 'text'],
      },
      run: (a, x) => hub.agentPost(a, x),
    },
    {
      name: 'hub_checkpoint',
      description: 'Save a handover for your thread: what is done, the exact next step, and the branch. Another account continues from it if you stop.',
      inputSchema: { type: 'object', properties: { thread: num, done: str, next: str, branch: str }, required: ['thread', 'done', 'next'] },
      run: (a, x) => hub.checkpoint(a, x),
    },
    {
      name: 'hub_ask',
      description: 'Ask another thread a question and wait (up to wait_s, max 45) for its answer. If nobody is working there, the hub starts a short session to answer.',
      inputSchema: { type: 'object', properties: { from_thread: num, to_thread: num, question: str, wait_s: num }, required: ['to_thread', 'question'] },
      run: async (a, x) => {
        const q = await hub.ask(a, x);
        const end = Date.now() + Math.min(WAIT_MAX_S, x.wait_s ?? 40) * 1000;
        // seq is read before each look, so an answer landing in between still wakes us.
        let seq = await hub.nextSeq();
        for (;;) {
          const ans = await hub.answerFor(q.id);
          if (ans) return hub.msgLine(ans);
          if (!(seq = await nextChange(hub, seq, end))) break;
        }
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
        const [, n] = await Promise.all([tid && hub.heartbeat(tid), hub.news(a, tid)]);
        return n.text || 'Nothing new.';
      },
    },
    {
      name: 'hub_wait',
      description: 'Wait up to wait_s (max 45) for anything new for your thread: questions for you, answers to your questions, new prompts from XIAO, new team lessons. Returns the moment something arrives.',
      inputSchema: { type: 'object', properties: { thread: num, after: num, wait_s: num }, required: ['thread'] },
      run: async (a, x) => {
        const tid = Number(x.thread) || 0;
        const end = Date.now() + Math.min(WAIT_MAX_S, x.wait_s ?? 20) * 1000;
        // The agent is alive while it waits; marking that first keeps it off the way back.
        let [, n] = await Promise.all([tid && hub.heartbeat(tid), hub.news(a, tid, { after: x.after })]);
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
      description: 'Report your account\'s usage: state "low" when you see a usage warning (new work then goes to other accounts), "ok" when it has reset, "report" to just share numbers. Optional percent (5-hour), five_hour_pct, seven_day_pct.',
      inputSchema: { type: 'object', properties: { state: { type: 'string', enum: ['low', 'ok', 'report'] }, percent: num, five_hour_pct: num, seven_day_pct: num, five_hour_resets: str, seven_day_resets: str, note: str }, required: ['state'] },
      run: async (a, x) => {
        const five = typeof x.five_hour_pct === 'number' ? x.five_hour_pct : typeof x.percent === 'number' ? x.percent : null;
        const week = typeof x.seven_day_pct === 'number' ? x.seven_day_pct : null;
        if (five != null || week != null) {
          const usage = { five_hour_pct: five, seven_day_pct: week, five_hour_resets: x.five_hour_resets || null, seven_day_resets: x.seven_day_resets || null, at: Date.now(), source: 'pc' };
          await hub.touchAccount(a.name, { usage, usageErr: '' });
        }
        if (x.state === 'report') return 'Thanks.';
        await hub.setLow(a.name, x.state === 'low', x.note || (five != null ? `${five}% used` : ''));
        return x.state === 'low' ? 'Marked low. Write your hub_checkpoint now, then stop.' : 'Marked ok.';
      },
    },
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
      serverInfo: { name: 'dop-hub', version: '2.0.0' },
      instructions: `You are connected to XIAO's Dop hub as account ${agent.name}. Call hub_start first.`,
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
    try {
      await hub.sweep();
      let text = String(await tool.run(agent, args));
      if (NEWS_ARG[tool.name]) {
        const n = await hub.news(agent, args[NEWS_ARG[tool.name]]);
        if (n.text) text += `\n\n${n.text}`;
      }
      await hub.countTraffic(JSON.stringify(args).length + text.length);
      return ok({ content: [{ type: 'text', text }] });
    } catch (e) {
      return ok({ content: [{ type: 'text', text: `Hub error: ${e.message}` }], isError: true });
    }
  }
  return fail(-32601, `Method ${method} not supported`);
}
