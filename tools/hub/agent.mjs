#!/usr/bin/env node
// Starts one Claude Code agent linked to the hub.
//   node tools/hub/agent.mjs A               agent A on the account you normally use
//   node tools/hub/agent.mjs B               agent B on your second account (asks you
//                                            to log in the first time)
//   node tools/hub/agent.mjs B nochannel     same, without live push (older Claude Code)
// Agent A works in this repo folder. Every other agent gets its own copy next to
// it (../Dop-B) so two agents never edit the same files at once.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const name = (process.argv[2] || 'A').trim();
const channel = !process.argv.includes('nochannel');
if (!/^[A-Za-z][A-Za-z0-9_-]{0,15}$/.test(name)) {
  console.error('Agent name must be a short word, like A or B.');
  process.exit(1);
}
const hubUrl = process.env.HUB_URL || 'http://localhost:7790';
// Agent A uses your normal Claude login; other agents keep their own login in
// ~/.claude-<name> so each one can be a different Claude account.
const configDir = name === 'A' ? null : path.join(os.homedir(), `.claude-${name.toLowerCase()}`);
const account = process.env.HUB_ACCOUNT || (name === 'A' ? 'main account' : `account ${name}`);

let cwd = repo;
if (name !== 'A') {
  cwd = path.resolve(repo, '..', `${path.basename(repo)}-${name}`);
  if (!existsSync(cwd)) {
    console.log(`Making a separate copy of the repo for ${name} at ${cwd} ...`);
    const r = spawnSync('git', ['worktree', 'add', '--detach', cwd], { cwd: repo, stdio: 'inherit' });
    if (r.status !== 0) {
      console.error('Could not make the copy. Agent will share this folder instead.');
      cwd = repo;
    }
  }
}

const env = { HUB_AGENT: name, HUB_ACCOUNT: account, HUB_URL: hubUrl, HUB_CHANNEL: channel ? '1' : '0' };
const node = process.execPath;
const dataDir = path.join(here, '.data');
mkdirSync(dataDir, { recursive: true });
const mcpFile = path.join(dataDir, `mcp-${name}.json`);
const settingsFile = path.join(dataDir, `settings-${name}.json`);
const q = (p) => (p.includes(' ') ? `"${p}"` : p);
writeFileSync(mcpFile, JSON.stringify({ mcpServers: { hub: { command: node, args: [path.join(here, 'mcp.mjs')], env } } }, null, 2));
writeFileSync(
  settingsFile,
  JSON.stringify(
    {
      env,
      statusLine: { type: 'command', command: `${q(node)} ${q(path.join(here, 'report.mjs'))} statusline` },
      hooks: {
        StopFailure: [
          { matcher: 'rate_limit|billing_error', hooks: [{ type: 'command', command: `${q(node)} ${q(path.join(here, 'report.mjs'))} limit` }] },
        ],
      },
    },
    null,
    2,
  ),
);

const prompt =
  `You are agent ${name} (${account}) in the Dop hub. Read ${path.join(here, 'AGENT.md')} and follow it: ` +
  `call hub_status, read the feed with hub_read, then ${channel ? 'call hub_wait with timeout_s 1 to pick up anything already waiting, then end your turn: new hub messages arrive by themselves' : 'call hub_wait with timeout_s 600 again and again'}.`;
// The prompt goes first: --allowedTools and the channels flag take several
// values and would swallow a prompt placed after them.
const args = [prompt, '--mcp-config', mcpFile, '--settings', settingsFile, '--allowedTools', 'mcp__hub__*'];
if (channel) args.push('--dangerously-load-development-channels', 'server:hub');

const childEnv = { ...process.env, ...env };
if (configDir) childEnv.CLAUDE_CONFIG_DIR = configDir;
console.log(`Starting agent ${name} (${account}) in ${cwd}${configDir ? `, login kept in ${configDir}` : ''}`);
const win = process.platform === 'win32';
const child = spawn(win ? 'claude' : 'claude', win ? args.map((a) => `"${a.replace(/"/g, '\\"')}"`) : args, {
  cwd,
  env: childEnv,
  stdio: 'inherit',
  shell: win,
});
child.on('error', () => {
  console.error('Could not start "claude". Install Claude Code first: https://code.claude.com/docs/en/setup');
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 0));
