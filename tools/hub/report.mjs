#!/usr/bin/env node
// Tells the hub how much usage this account has left.
//   node report.mjs statusline   Claude Code status line: reads the session JSON
//                                (rate_limits is sent to Pro/Max accounts), sends
//                                it to the hub and prints a short status line.
//   node report.mjs limit        StopFailure hook: the turn stopped on a usage or
//                                rate limit, so warn the other agent right away.
const HUB = (process.env.HUB_URL || 'http://localhost:7790').replace(/\/$/, '');
const AGENT = process.env.HUB_AGENT || 'A';
const ACCOUNT = process.env.HUB_ACCOUNT || '';
const mode = process.argv[2] || 'statusline';

async function readStdin() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

async function post(pathname, body) {
  try {
    await fetch(HUB + pathname, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(800),
    });
    return true;
  } catch {
    return false;
  }
}

const input = await readStdin();

if (mode === 'statusline') {
  const rl = input.rate_limits || {};
  const usage = {
    five_hour_pct: rl.five_hour?.used_percentage,
    seven_day_pct: rl.seven_day?.used_percentage,
    // Claude Code gives seconds; the hub keeps milliseconds.
    resets_at: rl.five_hour?.resets_at ? rl.five_hour.resets_at * 1000 : undefined,
    cost_usd: input.cost?.total_cost_usd,
  };
  const live = await post('/api/status', { agent: AGENT, account: ACCOUNT, usage, model: input.model?.display_name });
  const parts = [`hub ${AGENT}${live ? '' : ' (hub off)'}`];
  if (typeof usage.five_hour_pct === 'number') parts.push(`5h ${Math.round(usage.five_hour_pct)}%`);
  if (typeof usage.seven_day_pct === 'number') parts.push(`week ${Math.round(usage.seven_day_pct)}%`);
  console.log(parts.join(' · '));
} else if (mode === 'limit') {
  const why = input.error_type || input.error || input.reason || 'a usage or rate limit';
  await post('/api/post', {
    from: AGENT,
    to: 'all',
    kind: 'alert',
    text: `${AGENT} (${ACCOUNT || 'its account'}) just stopped on ${typeof why === 'string' ? why : 'a usage limit'}. Whoever is free: read the feed and take over its task.`,
  });
}
