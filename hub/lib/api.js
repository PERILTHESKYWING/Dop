// Request handling shared by the Vercel functions and the tests.
import { createHub, safeEqual } from './hub.js';
import { handleMcp } from './mcp.js';
import { readImage } from './tools-files.js';
import { memoryStore, storeFromEnv } from './store.js';

let devStore = null;
export function hubFromEnv(env = process.env) {
  const store = storeFromEnv(env) || (env.HUB_DEV_MEMORY === '1' ? (devStore ||= memoryStore()) : null);
  if (!store) return null;
  return createHub({ store, project: env.HUB_PROJECT || 'Dop', owner: env.HUB_OWNER || 'XIAO' });
}

const SETUP_HELP =
  'The hub has no storage yet. In Vercel open the hub project, Storage, connect an Upstash Redis store, then redeploy (see docs/handoff/hub-cloud.md).';

// The page and its API: XIAO's password.
export async function pageApi({ hub, password, method, query, body, headers }) {
  if (!password) return { status: 500, body: { error: 'Set HUB_PASSWORD in the Vercel project settings, then redeploy.' } };
  if (!hub) return { status: 500, body: { error: SETUP_HELP } };
  const given = headers['x-hub-password'] || '';
  if (!given || !safeEqual(given, password)) return { status: 401, body: { error: 'Wrong password.' } };
  const op = query.op || '';
  if (method === 'GET' && op === 'seq') return { status: 200, body: { seq: await hub.version() } };
  if (method === 'GET' && op === 'state') {
    const t0 = Date.now();
    const body = await hub.snapshot({ since: Number(query.since) || 0, limit: Number(query.limit) || 600 });
    return { status: 200, body: { ...body, project: hub.project, owner: hub.owner, ms: Date.now() - t0 } };
  }
  // Reading usage from Claude can take seconds, so the page asks for it on its own.
  if (method === 'GET' && op === 'usage') {
    await hub.refreshUsage({ force: query.force === '1' });
    const threads = await hub.threads();
    return { status: 200, body: { accounts: Object.values(await hub.accounts()).map((a) => hub.publicAccount(a, threads)) } };
  }
  if (method === 'GET' && op === 'image') {
    try {
      const img = await readImage(hub, query.account, query.name);
      return img ? { status: 200, body: img } : { status: 404, body: { error: 'No such image.' } };
    } catch (e) {
      return { status: 400, body: { error: e.message } };
    }
  }
  if (method === 'GET' && op === 'connect') {
    // The connector link for one account, shown once on the page when asked.
    const a = await hub.account(String(query.account || ''));
    if (!a) return { status: 404, body: { error: 'No such account.' } };
    return { status: 200, body: { name: a.name, key: a.key } };
  }
  if (method !== 'POST') return { status: 404, body: { error: 'Not found.' } };
  try {
    if (op === 'prompt') return { status: 200, body: await hub.prompt(body) };
    if (op === 'account') return { status: 200, body: hub.publicAccount(await hub.upsertAccount(body)) };
    if (op === 'account-remove') return (await hub.removeAccount(String(body.name))), { status: 200, body: { ok: true } };
    if (op === 'account-newkey') return { status: 200, body: await hub.newKey(String(body.name)) };
    if (op === 'account-low') return { status: 200, body: hub.publicAccount(await hub.setLow(String(body.name), !!body.low, body.note)) };
    if (op === 'thread') return { status: 200, body: await hub.updateThread(Number(body.id), body) };
    if (op === 'thread-delete') return (await hub.deleteThread(Number(body.id))), { status: 200, body: { ok: true } };
    if (op === 'message-delete') {
      const ok = await hub.deleteMessage(Number(body.id));
      return ok ? { status: 200, body: { ok } } : { status: 404, body: { error: 'No such message.' } };
    }
    if (op === 'retry') {
      const t = await hub.thread(Number(body.id));
      if (!t) return { status: 404, body: { error: 'No such thread.' } };
      return { status: 200, body: await hub.dispatch(t, t.checkpoint ? 'resume' : 'worker') };
    }
    if (op === 'account-usage') return { status: 200, body: hub.publicAccount(await hub.setUsage(String(body.name), body)) };
    if (op === 'connlog') return { status: 200, body: await hub.connLog() };
    if (op === 'settings') return { status: 200, body: await hub.saveSettings(body) };
  } catch (e) {
    return { status: 400, body: { error: e.message } };
  }
  return { status: 404, body: { error: 'Not found.' } };
}

// The MCP endpoint: each account has its own key, sent as
//   https://<hub>/api/mcp?account=<name>&key=<key>
// or as the header  Authorization: Bearer <name>:<key>
export async function mcpApi({ hub, method, query, body, headers }) {
  // claude.ai treats a 401 as "this server needs OAuth sign-in" and fails to
  // register, so link problems answer 403 with a readable reason instead.
  const fail = (message) => ({ status: 403, body: { jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32001, message } } });
  if (method === 'DELETE') return { status: 405, body: { error: 'Use POST.' } };
  if (method === 'GET' && String(headers.accept || '').includes('text/event-stream')) return { status: 405, body: { error: 'Use POST.' } };
  if (!hub) return method === 'GET' ? { status: 200, body: { ok: false, problem: SETUP_HELP } } : fail(SETUP_HELP);
  let name = query.account;
  let key = query.key;
  const auth = headers.authorization || '';
  if (auth.startsWith('Bearer ') && auth.includes(':')) {
    const raw = auth.slice(7);
    const i = raw.indexOf(':');
    name = raw.slice(0, i);
    key = raw.slice(i + 1);
  }
  const agent = await hub.authAgent(name, key);
  try {
    await hub.logConn({
      http: method,
      account: String(name || '').slice(0, 24),
      keyOk: !!agent,
      rpc: String(body?.method || '').slice(0, 40),
      via: auth ? 'header' : key ? 'link' : 'none',
      ua: String(headers['user-agent'] || '').slice(0, 60),
    });
  } catch {}
  const bad = 'Unknown account or key. Copy the link again from the hub page.';
  // Opening the link in a browser shows whether it works.
  if (method === 'GET') return { status: 200, body: agent ? { ok: true, account: agent.name, note: 'This link works. Add it as a custom connector on claude.ai.' } : { ok: false, problem: bad } };
  if (!agent) return fail(bad);
  try {
    await hub.markConnected(agent);
  } catch {}
  const reply = await handleMcp(hub, agent, body);
  return reply ? { status: 200, body: reply } : { status: 202, body: null };
}

// Adapt to a Vercel (Node) request/response.
export async function vercel(req, res, fn) {
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      body = {};
    }
  }
  const headers = Object.fromEntries(Object.entries(req.headers || {}).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v]));
  const url = new URL(req.url, 'http://x');
  const query = Object.fromEntries(url.searchParams);
  const out = await fn({ method: req.method, query, body: body || {}, headers });
  res.statusCode = out.status;
  res.setHeader('cache-control', 'no-store');
  if (out.body === null) return res.end();
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(out.body));
}
