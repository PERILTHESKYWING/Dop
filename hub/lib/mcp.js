// Remote MCP server (Streamable HTTP, stateless JSON replies) that gives any
// Claude on any account the hub tools: claude.ai chats (web, desktop, phone),
// cloud Claude Code sessions and routines, and Claude Code on a PC.
const WAIT_MAX_S = 45; // stays under the 60 s function limit on Vercel Hobby
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
        while (Date.now() < end) {
          const ans = await hub.answerFor(q.id);
          if (ans) return hub.msgLine(ans);
          await sleep(2500);
        }
        return `No answer to #${q.id} yet. Carry on and check later with hub_wait(thread: ${x.from_thread || 0}, after: ${q.id - 1}), or hub_read(${x.to_thread}).`;
      },
    },
    {
      name: 'hub_wait',
      description: 'Wait up to wait_s (max 45) for new messages in a thread after message id `after` (questions for you, answers, new prompts from XIAO). Returns at once if there are any.',
      inputSchema: { type: 'object', properties: { thread: num, after: num, wait_s: num }, required: ['thread'] },
      run: async (a, x) => {
        const tid = Number(x.thread) || 0;
        const after = Number(x.after) || 0;
        const end = Date.now() + Math.min(WAIT_MAX_S, x.wait_s ?? 20) * 1000;
        const mine = (m) => m.thread === tid && m.from !== a.name;
        for (;;) {
          const list = await hub.messagesSince(after, mine);
          if (list.length || Date.now() >= end) {
            if (tid) await hub.heartbeat(tid);
            return list.length ? list.map(hub.msgLine).join('\n') : 'No new messages.';
          }
          await sleep(3000);
        }
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
      const text = String(await tool.run(agent, args));
      await hub.countTraffic(JSON.stringify(args).length + text.length);
      return ok({ content: [{ type: 'text', text }] });
    } catch (e) {
      return ok({ content: [{ type: 'text', text: `Hub error: ${e.message}` }], isError: true });
    }
  }
  return fail(-32601, `Method ${method} not supported`);
}
