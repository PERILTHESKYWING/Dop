#!/usr/bin/env node
// MCP server (stdio) that gives a Claude Code session the hub tools.
// Who the agent is comes from the environment set by start-agent:
//   HUB_AGENT=A  HUB_ACCOUNT="main account"  HUB_URL=http://localhost:7790
// With HUB_CHANNEL=1 it also pushes new hub messages straight into the session
// (Claude Code "channels"), so an idle agent wakes the moment a message lands.
import { createInterface } from 'node:readline';

const HUB = (process.env.HUB_URL || 'http://localhost:7790').replace(/\/$/, '');
const AGENT = process.env.HUB_AGENT || 'A';
const ACCOUNT = process.env.HUB_ACCOUNT || '';
const CHANNEL = process.env.HUB_CHANNEL === '1';

// Newest message handed out, kept apart for tool calls and for live push, so a
// message pushed to a session that ignores channels is still there for hub_wait.
const cursor = { tool: 0, push: 0 };

async function hub(pathname, body, timeoutMs = 15_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(HUB + pathname, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `hub ${res.status}`);
    return json;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('hub timed out');
    if (e.cause?.code === 'ECONNREFUSED') throw new Error(`hub is not running at ${HUB}. Start it with tools/hub/start-hub.`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function fmt(m) {
  const re = m.replyTo ? ` (reply to #${m.replyTo})` : '';
  return `#${m.id} ${m.kind} from ${m.from} to ${m.to}${re}:\n${m.text}`;
}

async function waitFor(timeoutS, which = 'tool') {
  const r = await hub(`/api/wait?agent=${encodeURIComponent(AGENT)}&after=${cursor[which]}&timeout=${timeoutS}`, null, (timeoutS + 15) * 1000);
  for (const m of r.messages) cursor[which] = Math.max(cursor[which], m.id);
  return r.messages;
}

const tools = [
  {
    name: 'hub_wait',
    description:
      'Wait for the next hub messages addressed to you (prompts from XIAO, questions or answers from the other agent, alerts). Returns as soon as one arrives, or empty after timeout_s. Call it whenever you are free.',
    inputSchema: { type: 'object', properties: { timeout_s: { type: 'number', description: 'Max seconds to wait (default 300, max 600).' } } },
    run: async ({ timeout_s = 300 }) => {
      await hub('/api/status', { agent: AGENT, account: ACCOUNT, state: 'idle' });
      const list = await waitFor(Math.max(0, Math.min(600, timeout_s)));
      return list.length ? list.map(fmt).join('\n\n') : 'No new messages.';
    },
  },
  {
    name: 'hub_send',
    description:
      'Post to the hub. to: the other agent name, "all", "any" (first free agent takes it) or "XIAO". kind: note, done, ask, answer, alert. Use reply_to with the message id you are answering.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        text: { type: 'string' },
        kind: { type: 'string', enum: ['note', 'done', 'ask', 'answer', 'alert'] },
        reply_to: { type: 'number' },
      },
      required: ['to', 'text'],
    },
    run: async ({ to, text, kind = 'note', reply_to }) => {
      const m = await hub('/api/post', { from: AGENT, to, text, kind, replyTo: reply_to ?? null });
      return `Posted #${m.id}.`;
    },
  },
  {
    name: 'hub_ask',
    description:
      'Ask the other agent (or "any") a question and wait for its answer, up to timeout_s (default 300). Other messages that arrive meanwhile are returned too.',
    inputSchema: {
      type: 'object',
      properties: { to: { type: 'string' }, question: { type: 'string' }, timeout_s: { type: 'number' } },
      required: ['to', 'question'],
    },
    run: async ({ to, question, timeout_s = 300 }) => {
      const q = await hub('/api/post', { from: AGENT, to, text: question, kind: 'ask' });
      const deadline = Date.now() + Math.min(600, timeout_s) * 1000;
      const seen = [];
      while (Date.now() < deadline) {
        const list = await waitFor(Math.max(1, Math.round((deadline - Date.now()) / 1000)));
        seen.push(...list);
        const answer = list.find((m) => m.replyTo === q.id);
        if (answer) {
          const others = seen.filter((m) => m !== answer);
          return fmt(answer) + (others.length ? `\n\nAlso arrived:\n\n${others.map(fmt).join('\n\n')}` : '');
        }
      }
      return `No answer to #${q.id} yet.` + (seen.length ? `\n\nArrived meanwhile:\n\n${seen.map(fmt).join('\n\n')}` : '');
    },
  },
  {
    name: 'hub_status',
    description: 'Tell the hub what you are doing so XIAO and the other agent can see it. state: working or idle. task: one short line.',
    inputSchema: {
      type: 'object',
      properties: { state: { type: 'string', enum: ['working', 'idle'] }, task: { type: 'string' } },
      required: ['state'],
    },
    run: async ({ state, task = '' }) => {
      await hub('/api/status', { agent: AGENT, account: ACCOUNT, state, task });
      return 'Status updated.';
    },
  },
  {
    name: 'hub_read',
    description: 'Read the latest hub messages from everyone (the shared memory of the hivemind) plus who is online and their usage.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Messages to read (default 30).' } } },
    run: async ({ limit = 30 }) => {
      const s = await hub(`/api/state?limit=${Math.min(300, limit)}`);
      const agents = s.agents
        .map((a) => {
          const u = a.usage || {};
          const use = [u.five_hour_pct != null && `5h ${Math.round(u.five_hour_pct)}%`, u.seven_day_pct != null && `week ${Math.round(u.seven_day_pct)}%`]
            .filter(Boolean)
            .join(', ');
          return `${a.name} (${a.account || '?'}): ${a.presence}${a.task ? `, "${a.task}"` : ''}${use ? `, usage ${use}` : ''}`;
        })
        .join('\n');
      return `Agents:\n${agents || 'none'}\n\nLatest messages:\n\n${s.messages.map(fmt).join('\n\n') || 'none'}`;
    },
  },
];

// ---- minimal MCP over stdio (JSON-RPC 2.0, one message per line) ----
const write = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const ok = (id, result) => write({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });

async function onMessage(msg) {
  const { id, method, params = {} } = msg;
  if (method === 'initialize') {
    const capabilities = { tools: {} };
    if (CHANNEL) capabilities.experimental = { 'claude/channel': {} };
    ok(id, {
      protocolVersion: params.protocolVersion || '2025-06-18',
      capabilities,
      serverInfo: { name: 'dop-hub', version: '1.0.0' },
      instructions: `You are agent ${AGENT} in the Dop hub. Follow tools/hub/AGENT.md.`,
    });
    return;
  }
  if (method === 'notifications/initialized') {
    hub('/api/status', { agent: AGENT, account: ACCOUNT }).catch(() => {});
    if (CHANNEL) channelLoop();
    return;
  }
  if (method === 'ping') return ok(id, {});
  if (method === 'tools/list') return ok(id, { tools: tools.map(({ run, ...t }) => t) });
  if (method === 'tools/call') {
    const tool = tools.find((t) => t.name === params.name);
    if (!tool) return fail(id, -32602, `unknown tool ${params.name}`);
    try {
      const text = await tool.run(params.arguments || {});
      ok(id, { content: [{ type: 'text', text }] });
    } catch (e) {
      ok(id, { content: [{ type: 'text', text: `Hub error: ${e.message}` }], isError: true });
    }
    return;
  }
  if (id !== undefined) fail(id, -32601, `method ${method} not supported`);
}

// Push each new message into the session as a channel event.
let channelRunning = false;
async function channelLoop() {
  if (channelRunning) return;
  channelRunning = true;
  for (;;) {
    try {
      const list = await waitFor(300, 'push');
      for (const m of list) {
        write({
          jsonrpc: '2.0',
          method: 'notifications/claude/channel',
          params: { content: m.text, meta: { id: String(m.id), from: m.from, to: m.to, kind: m.kind, reply_to: m.replyTo ? String(m.replyTo) : '' } },
        });
      }
    } catch {
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  onMessage(msg).catch((e) => msg.id !== undefined && fail(msg.id, -32603, String(e.message || e)));
});
rl.on('close', () => process.exit(0));
