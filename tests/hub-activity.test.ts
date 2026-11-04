// Hub activity block: an opened working thread shows its current step, the sub-agent events the
// transcript does not show, and one "N updates above" line for the posts it does; built only from what
// the hub holds. A started session that has not called the hub reads "Starting", then "Not connected · Nm",
// the same in the pill, the Team card and the block.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('../hub/index.html', import.meta.url), 'utf8');
const code = page.slice(page.indexOf('const agoShort ='), page.indexOf('const actRow ='));
type Ev = { at: number; verb: string; text: string; who?: string };
type Step = { k: string; v: string; pct?: number | null; at?: number; more?: number } | null;
type Api = {
  agoShort: (ms: number) => string; agoElapsed: (ms: number) => string; plainLine: (s: string) => string;
  threadActions: (t: object) => Ev[]; sessionUpdates: (t: object, msgs: object[]) => { id: number }[];
  currentStep: (t: object, msgs: object[]) => Step; waitingFor: (t: object) => string; threadState: (t: object) => [string, string];
};
const make = (S: unknown, think = { mode: 'fold', hide: [] as string[] }) => new Function('S', 'ago', 'think', 'thoughtShown', 'STATUS',
  `${code}return { agoShort, agoElapsed, plainLine, threadActions, sessionUpdates, currentStep, waitingFor, threadState };`)(
  S, (ms: number) => `${Math.round(ms / 60e3)} min`, think, (n: string) => !think.hide.includes(n), { working: 'Working', new: 'Starting', done: 'Done' },
) as Api;

const T0 = 1_000_000;
const msgs = [
  { id: 1, thread: 3, from: 'hub', kind: 'brief', at: T0, text: 'Task' },
  { id: 2, thread: 3, from: 'hub', kind: 'start', at: T0 + 1000, text: 'Started Main on opus.' },
  { id: 3, thread: 3, from: 'Main', kind: 'progress', at: T0 + 60e3, text: 'Measured: **first paint 2.84 s**.\n\nSplitting the `three.js` chunk now.' },
  { id: 4, thread: 3, from: 'XIAO', kind: 'prompt', at: T0 + 90e3, text: 'ok' },
  { id: 5, thread: 3, from: 'Main', kind: 'thinking', at: T0 + 100e3, text: 'why' },
  { id: 6, thread: 3, from: 'Main', kind: 'handover', at: T0 + 120e3, text: 'Done: Split the chunk.\nNext: Benchmark 5 runs.\nBranch: b' },
];
const bench = { id: 'b', thread: 3, account: 'Main', title: 'Benchmark', status: 'running', step: 'Run 4 of 5', pct: 70, started: T0 + 130e3, at: T0 + 200e3 };

describe('hub activity rows', () => {
  it('lists only what the transcript does not show: sub-agent starts, steps and finishes', () => {
    const done = { id: 'c', thread: 3, account: 'Alt', title: 'Lint', status: 'done', started: T0 + 10e3, at: T0 + 20e3, finished: T0 + 20e3 };
    const ev = make({ agents: [bench, done] }).threadActions({ id: 3, account: 'Main' });
    expect(ev.map((e) => e.verb)).toEqual(['Started sub-agent', 'Sub-agent finished', 'Started sub-agent']);
    expect(ev[1]).toMatchObject({ who: 'Alt', text: 'Lint' });
  });
  it('counts this session\'s posts for the "N updates above" line, following the thinking-notes setting', () => {
    expect(make({ agents: [] }).sessionUpdates({ id: 3 }, msgs).map((m) => m.id)).toEqual([3, 5, 6]);
    expect(make({ agents: [] }, { mode: 'hide', hide: [] }).sessionUpdates({ id: 3 }, msgs).map((m) => m.id)).toEqual([3, 6]);
  });
});

describe('hub activity Now line', () => {
  it('drops a percent that would contradict "Run 4 of 5", keeps one for a step without a count', () => {
    const api = make({ agents: [bench] });
    expect(api.currentStep({ id: 3, account: 'Main' }, msgs)).toMatchObject({ k: 'Now', v: 'Benchmark · Run 4 of 5', pct: null, at: T0 + 200e3 });
    const api2 = make({ agents: [{ ...bench, step: 'Profiling' }] });
    expect(api2.currentStep({ id: 3, account: 'Main' }, msgs)).toMatchObject({ pct: 70 });
  });
  it('takes the handover next step when it is the newest word, else the last sentence of the newest update', () => {
    const { currentStep } = make({ agents: [] });
    expect(currentStep({ id: 3, account: 'Main', checkpoint: { at: T0 + 120e3, next: 'Benchmark 5 runs.' } }, msgs)).toEqual({ k: 'Next', v: 'Benchmark 5 runs.' });
    expect(currentStep({ id: 3, account: 'Main' }, msgs.slice(0, 4))).toEqual({ k: 'Latest', v: 'Splitting the three.js chunk now.' });
    expect(currentStep({ id: 3, account: 'Main' }, msgs.slice(0, 2))).toBeNull();
  });
});

describe('hub thread state while a session connects', () => {
  it('says Starting, then Not connected with whole minutes, then Working once the agent calls', () => {
    const { threadState, waitingFor } = make({ agents: [] });
    const fired = Date.now() - 30e3;
    expect(threadState({ status: 'working', account: 'Alt 2', lastFireAt: fired, lastAgentAt: fired })).toEqual(['starting', 'Starting']);
    const old = Date.now() - 4.5 * 60e3;
    expect(threadState({ status: 'working', account: 'Alt 2', lastFireAt: old, lastAgentAt: old })).toEqual(['noconn', 'Not connected · 4m']);
    expect(waitingFor({ status: 'working', account: 'Alt 2', lastFireAt: old, lastAgentAt: old })).toMatch(/^Alt 2's session was started 4m ago/);
    expect(threadState({ status: 'working', account: 'Alt 2', lastFireAt: old, lastAgentAt: old + 1 })).toEqual(['working', 'Working']);
    expect(threadState({ status: 'new', account: 'Alt 2' })).toEqual(['starting', 'Starting']);
  });
  it('uses the same state words in the pill, the sidebar, the Team card and Tasks', () => {
    expect(page).toContain("pill(`st-${threadState(t)[0]}`, '', threadState(t)[1])");
    expect(page).toContain('const [ss, st] = threadState(t);');
    expect(page).toContain("['noconn', `Not connected · ${Math.min(...late.map(unheardMin))}m`]");
    // The one real action: the hub's existing retry (a new session), offered in the block.
    expect(page).toContain(`\${stCls === 'noconn' ? \`<div class="act-acts"><button type="button" class="btn small" data-act="retry"`);
    // WORKING and "N threads running" count only threads whose agent has called; the silent ones get an amber group.
    expect(page).toContain("['Not connected', by(isNoconn), 'noconn'],");
    expect(page).toContain("['Working', by(isRunning)],");
    expect(page).toContain('const running = S.threads.filter(isRunning).length;');
  });
});

describe('hub activity look', () => {
  it('writes short ages, minutes-only elapsed after the first minute, and plain lines', () => {
    const { agoShort, agoElapsed, plainLine } = make({ agents: [] });
    expect([agoShort(42e3), agoShort(5 * 60e3 + 10e3), agoShort(2 * 3600e3)]).toEqual(['42s', '5m', '2h']);
    expect([agoElapsed(42e3), agoElapsed(9 * 60e3 + 43e3), agoElapsed(65 * 60e3)]).toEqual(['42s', '9m', '1h 5m']);
    expect(plainLine('See [PR 12](https://x) and `hub_sync` **now**')).toBe('See PR 12 and hub_sync now');
  });
  it('is drawn without spinners or shimmer, 13 px+ labels, and ticks its ages in place', () => {
    const css = page.slice(page.indexOf('.feed > .activity {'), page.indexOf('/* Phone: the newest three actions'));
    expect(css).not.toMatch(/animation|shimmer|@keyframes/);
    expect(css).not.toMatch(/font-size: 1[0-2]px/);
    expect(page).toContain("live.replace(/(class=\"(?:since|ago)\"[^>]*>)[^<]*/g, '$1')");
  });
});
