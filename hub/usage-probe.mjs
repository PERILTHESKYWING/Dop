#!/usr/bin/env node
// Reads this account's 5-hour and weekly usage from inside a Claude Code
// session (cloud or PC), so hub agents can report it with hub_usage.
//   node hub/usage-probe.mjs  ->  {"five_hour_pct":14,"seven_day_pct":62,...}
// It runs one tiny Haiku turn (about 1.4k tokens, no tools, no repo context)
// and keeps the rate_limit_event Claude Code prints in stream-json mode. That
// event carries the same numbers as claude.ai › Settings › Usage. It uses the
// session's own login through the claude CLI and never reads a token itself.
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ARGS = ['-p', 'ok', '--model', 'haiku', '--max-turns', '1', '--system-prompt', 'Reply ok.', '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'stream-json', '--verbose'];

const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round((v <= 1 ? v * 100 : v) * 10) / 10 : null);
const iso = (s) => (typeof s === 'number' && Number.isFinite(s) ? new Date(s * 1000).toISOString() : null);

// Last rate_limit_event in Claude Code's stream-json output -> hub_usage args.
export function parseProbe(text) {
  let info = null;
  for (const line of String(text).split('\n')) {
    if (!line.includes('rate_limit_event')) continue;
    try {
      const m = JSON.parse(line);
      if (m.type === 'rate_limit_event' && m.rate_limit_info) info = m.rate_limit_info;
    } catch {}
  }
  if (!info) return { error: 'Claude Code printed no rate limits (API key login, or an older claude CLI)' };
  const w = info.unifiedWindows || {};
  const out = {
    five_hour_pct: pct(w.five_hour?.utilization),
    five_hour_resets: iso(w.five_hour?.resetsAt),
    seven_day_pct: pct(w.seven_day?.utilization),
    seven_day_resets: iso(w.seven_day?.resetsAt),
  };
  if (out.five_hour_pct == null && out.seven_day_pct == null) return { error: `Claude Code sent no usage numbers (status ${info.status || 'unknown'})` };
  if (info.status && info.status !== 'allowed') out.status = info.status;
  return out;
}

function run() {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn('claude', ARGS, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
      return resolve({ error: `could not start claude (${e.message})` });
    }
    const timer = setTimeout(() => child.kill(), 60_000);
    child.stdout.on('data', (c) => (out += c));
    child.on('error', (e) => resolve({ error: `could not start claude (${e.message})` }));
    child.on('close', () => {
      clearTimeout(timer);
      resolve(parseProbe(out));
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) console.log(JSON.stringify(await run()));
