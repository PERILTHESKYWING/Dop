#!/usr/bin/env node
// Nightly studio learning, run on XIAO's PC:  node hub/studio-nightly.mjs
// Needs HUB_URL (the hub's address) and HUB_PASSWORD. If nobody gave feedback
// since the last run it exits at once and spends no tokens. Otherwise it makes
// ONE small `claude -p --model haiku` call that turns the new feedback into
// updated style rules, checks the answer and saves it with studio-rules.
// Schedule it once a night: Windows  schtasks /create /sc daily /st 03:00 /tn DopStudio /tr "node C:\path\Dop\hub\studio-nightly.mjs"
// (set HUB_URL and HUB_PASSWORD with setx first); Mac/Linux  0 3 * * * node ~/Dop/hub/studio-nightly.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_ENTRIES = 40;
const MAX_ENTRY = 400;
const MAX_RULES = 4000;

export function buildPrompt(rules, entries) {
  const lines = entries.slice(-MAX_ENTRIES).map((e) => `${e.kind}${e.good === true ? ' (liked)' : e.good === false ? ' (disliked)' : ''}: ${String(e.text || '').replace(/\s+/g, ' ').slice(0, MAX_ENTRY)}`);
  return [
    'You maintain the style rules of a hand-made storytime animation studio. Below are the current rules and new feedback from the director (XIAO).',
    'Return ONLY one JSON object: {"rules": "<the full updated rules, plain text, one short imperative line per rule, max 25 lines>", "style": {<small numeric tweaks, or {}>}}.',
    'Merge the new feedback into the rules: keep rules still true, drop duplicates and contradicted ones, state each rule once and concretely. "style" holds only numbers, true/false or short words (for example {"wobble": 1.2}); use null to remove a key. No prose outside the JSON.',
    '',
    `CURRENT RULES:\n${rules.text || '(none yet)'}`,
    `CURRENT STYLE: ${JSON.stringify(rules.style || {})}`,
    '',
    `NEW FEEDBACK:\n${lines.join('\n')}`,
  ].join('\n');
}

// Pull the JSON object out of the model's answer and make sure it is safe to store.
export function parseAnswer(out) {
  const a = String(out).indexOf('{');
  const b = String(out).lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('no JSON in the answer');
  const j = JSON.parse(String(out).slice(a, b + 1));
  const text = typeof j.rules === 'string' ? j.rules.trim() : Array.isArray(j.rules) ? j.rules.map(String).join('\n').trim() : null;
  if (!text) throw new Error('"rules" is missing');
  const style = j.style ?? {};
  if (typeof style !== 'object' || Array.isArray(style)) throw new Error('"style" must be an object');
  return { text: text.slice(0, MAX_RULES), style };
}

function claudeP(prompt, model) {
  return new Promise((resolve, reject) => {
    const cmd = process.env.CLAUDE_BIN || 'claude';
    const p = spawn(cmd, ['-p', '--model', model], { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`))));
    p.stdin.end(prompt);
  });
}

export async function run({ url, password, statePath, model = 'haiku', ask = claudeP, fetchImpl = fetch, dry = false, say = console.log }) {
  if (!url || !password) throw new Error('Set HUB_URL and HUB_PASSWORD first.');
  const api = async (op, { method = 'GET', body, query = '' } = {}) => {
    const res = await fetchImpl(`${url.replace(/\/$/, '')}/api/hub?op=${op}${query}`, {
      method,
      headers: { 'x-hub-password': password, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || `${op} ${res.status}`);
    return j;
  };
  let state = { since: 0 };
  try {
    state = { ...state, ...JSON.parse(readFileSync(statePath, 'utf8')) };
  } catch {}
  const { log } = await api('studio-log', { query: `&since=${state.since}` });
  // Only things XIAO said or rated teach the studio.
  const entries = log.filter((e) => ['feedback', 'rule', 'rate'].includes(e.kind));
  if (!entries.length) {
    say('No new feedback. Nothing to do (0 tokens).');
    return { changed: false };
  }
  const rules = await api('studio-rules');
  const answer = parseAnswer(await ask(buildPrompt(rules, entries), model));
  if (dry) {
    say(JSON.stringify(answer, null, 2));
    return { changed: false, answer };
  }
  await api('studio-rules', { method: 'POST', body: answer });
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify({ since: Math.max(...log.map((e) => e.ts)) }));
  say(`Updated the rules from ${entries.length} new feedback item${entries.length > 1 ? 's' : ''}.`);
  return { changed: true, answer };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const statePath = process.env.STUDIO_STATE || path.join(os.homedir(), '.dop-studio-nightly.json');
  run({ url: process.env.HUB_URL, password: process.env.HUB_PASSWORD, statePath, model: process.env.STUDIO_MODEL || 'haiku', dry: process.argv.includes('--dry') }).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
