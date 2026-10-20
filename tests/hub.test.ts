// Dop hub: two agents (as the MCP servers Claude Code would run) talk through
// a real hub process: prompts, "any" claiming, ask/answer, usage alerts,
// stalled-agent alerts and live channel push.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = path.join(__dirname, '..', 'tools', 'hub');
const PORT = 7790 + 100 + Math.floor(Math.random() * 500);
const HUB = `http://127.0.0.1:${PORT}`;
let hub: ChildProcess;
let data: string;
const kids: ChildProcess[] = [];

class Agent {
  proc: ChildProcess;
  nextId = 1;
  pending = new Map<number, (v: any) => void>();
  notes: any[] = [];
  constructor(public name: string, channel = false) {
    this.proc = spawn(process.execPath, [path.join(dir, 'mcp.mjs')], {
      env: { ...process.env, HUB_URL: HUB, HUB_AGENT: name, HUB_ACCOUNT: `acct ${name}`, HUB_CHANNEL: channel ? '1' : '0' },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    kids.push(this.proc);
    let buf = '';
    this.proc.stdout!.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (msg.id !== undefined) this.pending.get(msg.id)?.(msg);
        else this.notes.push(msg);
      }
    });
  }
  rpc(method: string, params: any = {}) {
    const id = this.nextId++;
    this.proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return new Promise<any>((r) => this.pending.set(id, r));
  }
  async init() {
    const r = await this.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    this.proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    return r.result;
  }
  async call(name: string, args: any = {}): Promise<string> {
    const r = await this.rpc('tools/call', { name, arguments: args });
    return r.result.content[0].text;
  }
}

const post = (pathname: string, body: any) =>
  fetch(HUB + pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  data = mkdtempSync(path.join(os.tmpdir(), 'hub-'));
  hub = spawn(process.execPath, [path.join(dir, 'hub.mjs'), '--port', String(PORT), '--data', data], {
    env: { ...process.env, HUB_QUIET_MS: '600' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((r) => hub.stdout!.once('data', () => r()));
});

afterAll(() => {
  for (const k of kids) k.kill();
  hub?.kill();
  rmSync(data, { recursive: true, force: true });
});

describe('dop hub', () => {
  const A = () => agents.A;
  const B = () => agents.B;
  const agents: Record<string, Agent> = {};

  it('starts agents and lists the tools', async () => {
    agents.A = new Agent('A');
    agents.B = new Agent('B');
    const init = await A().init();
    await B().init();
    expect(init.serverInfo.name).toBe('dop-hub');
    const list = await A().rpc('tools/list');
    expect(list.result.tools.map((t: any) => t.name)).toEqual(['hub_wait', 'hub_send', 'hub_ask', 'hub_status', 'hub_read']);
  });

  it('gives a prompt sent to "any" to exactly one agent', async () => {
    await post('/api/post', { from: 'XIAO', to: 'any', text: 'Fix the move slider' });
    const a = await A().call('hub_wait', { timeout_s: 2 });
    expect(a).toContain('prompt from XIAO');
    expect(a).toContain('Fix the move slider');
    const b = await B().call('hub_wait', { timeout_s: 1 });
    expect(b).toBe('No new messages.');
  });

  it('lets one agent ask the other and get the answer in the same call', async () => {
    const asking = B().call('hub_ask', { to: 'A', question: 'Which branch are you on?', timeout_s: 10 });
    const got = await A().call('hub_wait', { timeout_s: 5 });
    expect(got).toContain('ask from B to A');
    const id = Number(/#(\d+) ask/.exec(got)![1]);
    await A().call('hub_send', { to: 'B', kind: 'answer', reply_to: id, text: 'claude/slider' });
    const answer = await asking;
    expect(answer).toContain(`reply to #${id}`);
    expect(answer).toContain('claude/slider');
  });

  it('warns the other agent when an account is low on usage', async () => {
    await A().call('hub_status', { state: 'working', task: 'Fix the move slider' });
    const r = spawn(process.execPath, [path.join(dir, 'report.mjs'), 'statusline'], {
      env: { ...process.env, HUB_URL: HUB, HUB_AGENT: 'A', HUB_ACCOUNT: 'acct A' },
    });
    let line = '';
    r.stdout!.on('data', (c) => (line += c));
    r.stdin!.end(JSON.stringify({ rate_limits: { five_hour: { used_percentage: 91, resets_at: 1_900_000_000 }, seven_day: { used_percentage: 40 } } }));
    await new Promise((res) => r.on('exit', res));
    expect(line.trim()).toBe('hub A · 5h 91% · week 40%');
    const b = await B().call('hub_wait', { timeout_s: 2 });
    expect(b).toContain('alert from hub to B');
    expect(b).toContain('91% of its 5-hour limit');
    expect(b).toContain('Fix the move slider');
  });

  it('tells the other agent when a working agent goes quiet', async () => {
    await A().call('hub_status', { state: 'working', task: 'Long task' });
    let b = '';
    for (let i = 0; i < 4 && !b.includes('went quiet mid-task ("Long task")'); i++) b = await B().call('hub_wait', { timeout_s: 5 });
    expect(b).toContain('A went quiet mid-task ("Long task")');
    const s = await B().call('hub_read', { limit: 5 });
    expect(s).toContain('A (acct A): stalled');
  });

  it('pushes messages live into a channel session', async () => {
    const C = new Agent('C', true);
    const init = await C.init();
    expect(init.capabilities.experimental['claude/channel']).toEqual({});
    await sleep(200);
    await post('/api/post', { from: 'XIAO', to: 'C', text: 'Hello C' });
    for (let i = 0; i < 40 && !C.notes.length; i++) await sleep(50);
    expect(C.notes[0].method).toBe('notifications/claude/channel');
    expect(C.notes[0].params.content).toBe('Hello C');
    expect(C.notes[0].params.meta.from).toBe('XIAO');
  });

  it('keeps reserved names for XIAO, the hub and groups', async () => {
    const r = await fetch(HUB + '/api/post', { method: 'POST', body: JSON.stringify({ from: 'hub', to: 'A', text: 'fake alert' }) });
    expect(r.status).toBe(400);
  });

  it('rejects posts from other websites', async () => {
    const r = await fetch(HUB + '/api/post', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ from: 'XIAO', to: 'any', text: 'x' }),
    });
    expect(r.status).toBe(403);
  });
});
