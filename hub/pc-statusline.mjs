#!/usr/bin/env node
// Claude Code status line for a PC agent linked to the cloud hub. Shows this
// account's usage and, once it passes 85% of a limit, tells the hub so new work
// goes to other accounts. Set in ~/.claude/settings.json (see hub-cloud.md):
//   "statusLine": { "type": "command", "command": "node /path/to/Dop/hub/pc-statusline.mjs" }
// with HUB_MCP_URL set to this account's connector link.
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
let input = {};
try {
  input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
} catch {}
const five = input.rate_limits?.five_hour?.used_percentage;
const week = input.rate_limits?.seven_day?.used_percentage;
const pct = Math.max(five ?? 0, week ?? 0);
const parts = ['hub'];
if (typeof five === 'number') parts.push(`5h ${Math.round(five)}%`);
if (typeof week === 'number') parts.push(`week ${Math.round(week)}%`);

const url = process.env.HUB_MCP_URL;
const mark = path.join(os.tmpdir(), 'dop-hub-low');
let lastSent = 0;
try {
  lastSent = Number(readFileSync(mark, 'utf8')) || 0;
} catch {}
const low = pct >= 85;
// Share the numbers every 10 minutes so the hub page shows them, and at once
// (at most every 30 minutes) when a limit passes 85%.
const due = low ? Date.now() - lastSent > 30 * 60_000 : Date.now() - lastSent > 10 * 60_000;
if (url && (typeof five === 'number' || typeof week === 'number') && due) {
  const args = { state: low ? 'low' : 'report', source: 'pc', five_hour_pct: five, seven_day_pct: week, five_hour_resets: input.rate_limits?.five_hour?.resets_at, seven_day_resets: input.rate_limits?.seven_day?.resets_at };
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'hub_usage', arguments: args } }),
      signal: AbortSignal.timeout(1500),
    });
    writeFileSync(mark, String(Date.now()));
    if (low) parts.push('hub told');
  } catch {}
}
console.log(parts.join(' · '));
