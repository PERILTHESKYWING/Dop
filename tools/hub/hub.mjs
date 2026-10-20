#!/usr/bin/env node
// Dop hub: a small live message board on your own PC that links Claude Code
// agents from two Claude accounts. Agents talk to it through the MCP server in
// mcp.mjs; you watch and send prompts from the page at http://localhost:7790.
// No dependencies, no cloud, nothing to configure. State lives in .data/.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = Number(argValue('--port', process.env.HUB_PORT || 7790));
const DATA_DIR = argValue('--data', process.env.HUB_DATA || path.join(here, '.data'));
const DATA_FILE = path.join(DATA_DIR, 'hub.json');
const KEEP_MESSAGES = 1000;
// Usage at or above this share of a limit tells the other agents to get ready.
const LOW_USAGE_PCT = Number(process.env.HUB_LOW_USAGE_PCT || 85);
// A working agent that sends no heartbeat for this long is treated as stalled
// (usually out of usage, or its window was closed).
const QUIET_MS = Number(process.env.HUB_QUIET_MS || 5 * 60_000);
const ONLINE_MS = 90_000;

const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,15}$/;
const KINDS = new Set(['prompt', 'ask', 'answer', 'note', 'done', 'alert']);

function load() {
  try {
    const saved = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
    const agents = saved.agents || {};
    for (const a of Object.values(agents)) a.waiting = 0;
    return { nextId: saved.nextId || 1, messages: saved.messages || [], agents };
  } catch {
    return { nextId: 1, messages: [], agents: {} };
  }
}
const state = load();

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, DATA_FILE);
  }, 200);
}

const streams = new Set(); // page SSE connections
const waiters = new Set(); // agent long-polls: { agent, after, resolve, timer }

function broadcast(event, data) {
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of streams) res.write(line);
}

function agentView(a, now = Date.now()) {
  const seenAgo = now - (a.lastSeen || 0);
  let presence = 'offline';
  if (seenAgo < ONLINE_MS || a.waiting) presence = a.state === 'working' ? 'working' : 'idle';
  if (a.stalled) presence = 'stalled';
  return { ...a, presence, seenAgo };
}

function agentsView() {
  const now = Date.now();
  return Object.values(state.agents).map((a) => agentView(a, now));
}

// Is this message one the agent should receive?
function isFor(msg, agent) {
  if (msg.from === agent) return false;
  if (msg.to === agent || msg.to === 'all') return true;
  if (msg.to === 'any') return !msg.claimedBy || msg.claimedBy === agent;
  return false;
}

function pendingFor(agent, after) {
  return state.messages.filter((m) => m.id > after && isFor(m, agent));
}

// Hand messages to one waiting agent. "any" messages go to the first agent
// that receives them and are then hidden from the others.
function deliver(waiter) {
  const list = pendingFor(waiter.agent, waiter.after);
  if (!list.length) return false;
  for (const m of list) {
    if (m.to === 'any' && !m.claimedBy) {
      m.claimedBy = waiter.agent;
      broadcast('message', m);
    }
  }
  save();
  clearTimeout(waiter.timer);
  waiters.delete(waiter);
  waiter.resolve(list);
  return true;
}

function wakeWaiters() {
  for (const w of [...waiters]) deliver(w);
}

function addMessage({ from, to, text, kind = 'note', replyTo = null }) {
  const msg = { id: state.nextId++, at: Date.now(), from, to, kind, text, replyTo };
  state.messages.push(msg);
  if (state.messages.length > KEEP_MESSAGES) state.messages.splice(0, state.messages.length - KEEP_MESSAGES);
  save();
  broadcast('message', msg);
  wakeWaiters();
  return msg;
}

function touchAgent(name, patch = {}) {
  const a = state.agents[name] || { name, account: '', state: 'idle', task: '', usage: null };
  const wasStalled = a.stalled;
  const now = Date.now();
  // lastActive = the agent itself did something (status, post, statusline).
  // lastSeen also counts its MCP server waiting for messages.
  Object.assign(a, patch, { lastSeen: now, lastActive: now });
  if (wasStalled) {
    a.stalled = false;
    addMessage({ from: 'hub', to: 'all', kind: 'alert', text: `${name} is back.` });
  }
  state.agents[name] = a;
  checkUsage(a);
  save();
  broadcast('agent', agentView(a));
  return a;
}

function otherAgents(name) {
  return Object.keys(state.agents).filter((n) => n !== name);
}

// Tell the other agents (and the page) when an account is nearly out of usage.
function checkUsage(a) {
  const pct = maxUsagePct(a.usage);
  if (pct === null) return;
  if (pct >= LOW_USAGE_PCT && !a.lowWarned) {
    a.lowWarned = true;
    const which = a.usage?.five_hour_pct >= LOW_USAGE_PCT ? '5-hour' : 'weekly';
    const resets = a.usage?.resets_at ? `, resets ${new Date(a.usage.resets_at).toLocaleTimeString()}` : '';
    const task = a.task ? ` Its current task: "${a.task}".` : '';
    for (const other of otherAgents(a.name)) {
      addMessage({
        from: 'hub',
        to: other,
        kind: 'alert',
        text: `${a.name} (${a.account || 'other account'}) has used ${Math.round(pct)}% of its ${which} limit${resets}.${task} Be ready to take over; ask ${a.name} for a handover now.`,
      });
    }
    if (!otherAgents(a.name).length) {
      addMessage({ from: 'hub', to: 'all', kind: 'alert', text: `${a.name} has used ${Math.round(pct)}% of its ${which} limit.` });
    }
  } else if (pct < LOW_USAGE_PCT - 10 && a.lowWarned) {
    a.lowWarned = false;
  }
}

function maxUsagePct(u) {
  if (!u) return null;
  const vals = [u.five_hour_pct, u.seven_day_pct].filter((v) => typeof v === 'number');
  return vals.length ? Math.max(...vals) : null;
}

// A working agent that has gone silent is probably out of usage.
function checkQuiet() {
  const now = Date.now();
  for (const a of Object.values(state.agents)) {
    if (a.state !== 'working' || a.stalled) continue;
    if (now - (a.lastActive || 0) < QUIET_MS) continue;
    a.stalled = true;
    const task = a.task ? ` mid-task ("${a.task}")` : '';
    const mins = Math.round((now - a.lastActive) / 60_000);
    for (const other of otherAgents(a.name)) {
      addMessage({
        from: 'hub',
        to: other,
        kind: 'alert',
        text: `${a.name} went quiet${task} ${mins} min ago. It may be out of usage. Read the feed and pick up its task if you can.`,
      });
    }
    broadcast('agent', agentView(a));
    save();
  }
}
setInterval(checkQuiet, Math.min(15_000, Math.max(100, QUIET_MS / 2))).unref();
// Refresh online/offline on the page.
setInterval(() => broadcast('agents', agentsView()), 20_000).unref();

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 200_000) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('bad json'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

// Names an agent can't take: they mean you, the hub itself, or a group.
const RESERVED = new Set(['xiao', 'hub', 'all', 'any']);
function cleanName(v, extra = []) {
  const s = String(v || '').trim();
  if (extra.includes(s)) return s;
  return NAME_RE.test(s) && !RESERVED.has(s.toLowerCase()) ? s : null;
}

function cleanUsage(u) {
  if (!u || typeof u !== 'object') return null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : undefined);
  const out = { five_hour_pct: num(u.five_hour_pct), seven_day_pct: num(u.seven_day_pct) };
  if (typeof u.resets_at === 'number') out.resets_at = u.resets_at;
  if (typeof u.cost_usd === 'number') out.cost_usd = u.cost_usd;
  return out;
}

const pagePath = path.join(here, 'hub.html');

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  // Only this PC may talk to the hub. Browsers on other sites can't post here.
  const origin = req.headers.origin;
  if (origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return send(res, 403, { error: 'origin' });

  if (req.method === 'GET' && url.pathname === '/') {
    return send(res, 200, readFileSync(pagePath, 'utf8'), 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(`event: hello\ndata: ${JSON.stringify({ agents: agentsView(), messages: state.messages.slice(-300) })}\n\n`);
    streams.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      streams.delete(res);
    });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/state') {
    const limit = Math.min(300, Number(url.searchParams.get('limit')) || 50);
    return send(res, 200, { agents: agentsView(), messages: state.messages.slice(-limit) });
  }
  if (req.method === 'POST' && url.pathname === '/api/post') {
    const b = await readBody(req);
    const from = cleanName(b.from, ['XIAO']);
    const to = cleanName(b.to, ['all', 'any', 'XIAO']);
    const text = String(b.text || '').trim().slice(0, 20_000);
    const kind = KINDS.has(b.kind) ? b.kind : from === 'XIAO' ? 'prompt' : 'note';
    if (!from || !to || !text) return send(res, 400, { error: 'from, to and text are required' });
    if (from !== 'XIAO') touchAgent(from);
    const replyTo = Number.isInteger(b.replyTo) ? b.replyTo : null;
    return send(res, 200, addMessage({ from, to, text, kind, replyTo }));
  }
  if (req.method === 'POST' && url.pathname === '/api/status') {
    const b = await readBody(req);
    const name = cleanName(b.agent);
    if (!name) return send(res, 400, { error: 'agent required' });
    const patch = {};
    if (typeof b.account === 'string') patch.account = b.account.slice(0, 40);
    if (b.state === 'working' || b.state === 'idle') patch.state = b.state;
    if (typeof b.task === 'string') patch.task = b.task.slice(0, 300);
    if (b.usage) patch.usage = cleanUsage(b.usage);
    if (typeof b.model === 'string') patch.model = b.model.slice(0, 60);
    return send(res, 200, agentView(touchAgent(name, patch)));
  }
  if (req.method === 'GET' && url.pathname === '/api/wait') {
    const agent = cleanName(url.searchParams.get('agent'));
    if (!agent) return send(res, 400, { error: 'agent required' });
    const after = Number(url.searchParams.get('after')) || 0;
    const timeout = Math.max(0, Math.min(600, Number(url.searchParams.get('timeout')) || 0)) * 1000;
    const known = state.agents[agent] || touchAgent(agent);
    known.waiting = (known.waiting || 0) + 1;
    known.lastSeen = Date.now();
    broadcast('agent', agentView(known));
    const done = (messages) => {
      const a = state.agents[agent];
      if (a) {
        a.waiting = Math.max(0, (a.waiting || 0) - 1);
        a.lastSeen = Date.now();
        broadcast('agent', agentView(a));
      }
      if (!res.writableEnded) send(res, 200, { messages, lastId: state.nextId - 1 });
    };
    const waiter = { agent, after, resolve: done, timer: null };
    if (deliver(waiter)) return;
    if (!timeout) return done([]);
    waiters.add(waiter);
    waiter.timer = setTimeout(() => {
      waiters.delete(waiter);
      done([]);
    }, timeout);
    req.on('close', () => {
      if (waiters.delete(waiter)) {
        clearTimeout(waiter.timer);
        const a = state.agents[agent];
        if (a) a.waiting = Math.max(0, (a.waiting || 0) - 1);
      }
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/forget') {
    const b = await readBody(req);
    const name = cleanName(b.agent);
    if (name && state.agents[name]) {
      delete state.agents[name];
      save();
      broadcast('agents', agentsView());
    }
    return send(res, 200, { ok: true });
  }
  send(res, 404, { error: 'not found' });
}

const server = createServer((req, res) => {
  handle(req, res).catch((e) => send(res, 400, { error: String(e.message || e) }));
});
server.requestTimeout = 0;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Dop hub running: http://localhost:${PORT}  (data in ${DATA_DIR})`);
  if (!existsSync(DATA_FILE)) console.log('Start an agent with tools/hub/start-agent (see docs/handoff/hub.md).');
});
