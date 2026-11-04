// Hub activity block: an opened working thread shows its current step and last actions, built only
// from what the hub holds (posts, handovers, sub-agent reports, the session start), and says plainly
// what it waits for when nothing is reported yet.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('../hub/index.html', import.meta.url), 'utf8');
const code = page.slice(page.indexOf('const agoShort ='), page.indexOf('function activityHtml('));
type Ev = { at: number; verb: string; text: string; who?: string };
type Step = { k: string; v: string; pct?: number | null; at?: number; more?: number } | null;
const make = (S: unknown) => new Function('S', 'capModels', 'lessonProse', 'ago', 'think', 'thoughtShown',
  `${code}return { agoShort, plainLine, lastSentence, threadActions, currentStep, waitingFor };`)(
  S, (s: string) => s.replace(/\bopus\b/g, 'Opus'), (s: string) => s.replace(/^Do: /, ''), (ms: number) => `${Math.round(ms / 60e3)} min`,
  { mode: 'fold', hide: [] }, () => true,
) as {
  agoShort: (ms: number) => string; plainLine: (s: string) => string; lastSentence: (s: string) => string;
  threadActions: (t: object, msgs: object[]) => Ev[]; currentStep: (t: object, msgs: object[]) => Step; waitingFor: (t: object) => string;
};

const T0 = 1_000_000;
const msgs = [
  { id: 1, thread: 3, from: 'hub', kind: 'brief', at: T0, text: 'Task' },
  { id: 2, thread: 3, from: 'hub', kind: 'start', at: T0 + 1000, text: 'Started Main on opus.' },
  { id: 3, thread: 3, from: 'Main', kind: 'progress', at: T0 + 60e3, text: 'Measured: **first paint 2.84 s**.\n\nSplitting the `three.js` chunk now.' },
  { id: 4, thread: 3, from: 'XIAO', kind: 'prompt', at: T0 + 90e3, text: 'ok' },
  { id: 5, thread: 3, from: 'Main', kind: 'handover', at: T0 + 120e3, text: 'Done: Split the chunk.\nNext: Benchmark 5 runs.\nBranch: b' },
];

describe('hub activity', () => {
  it('lists agent actions newest first, never XIAO or the brief', () => {
    const { threadActions } = make({ agents: [] });
    const ev = threadActions({ id: 3, account: 'Main' }, msgs);
    expect(ev.map((e) => e.verb)).toEqual(['Saved a handover', 'Posted', 'Started']);
    expect(ev[0].text).toBe('Split the chunk.');
    expect(ev[1].text).toBe('Measured: first paint 2.84 s. Splitting the three.js chunk now.');
    expect(ev[2].text).toBe('Main on Opus');
  });
  it('adds sub-agent reports, and the running step is the Now line, not a list row', () => {
    const g = { id: 'b', thread: 3, account: 'Main', title: 'Benchmark', status: 'running', step: 'Run 4 of 5', pct: 70, started: T0 + 130e3, at: T0 + 200e3 };
    const { threadActions, currentStep } = make({ agents: [g] });
    const ev = threadActions({ id: 3, account: 'Main' }, msgs);
    expect(ev[0]).toMatchObject({ verb: 'Started sub-agent', text: 'Benchmark' });
    expect(ev.some((e) => e.verb === 'Sub-agent step')).toBe(false);
    expect(currentStep({ id: 3, account: 'Main' }, msgs)).toMatchObject({ k: 'Now', v: 'Benchmark · Run 4 of 5', pct: 70, at: T0 + 200e3 });
  });
  it('takes the handover next step when it is the newest word, else the last sentence of the newest update', () => {
    const { currentStep } = make({ agents: [] });
    expect(currentStep({ id: 3, account: 'Main', checkpoint: { at: T0 + 120e3, next: 'Benchmark 5 runs.' } }, msgs)).toEqual({ k: 'Next', v: 'Benchmark 5 runs.' });
    expect(currentStep({ id: 3, account: 'Main' }, msgs.slice(0, 4))).toEqual({ k: 'Latest', v: 'Splitting the three.js chunk now.' });
    expect(currentStep({ id: 3, account: 'Main' }, msgs.slice(0, 2))).toBeNull();
  });
  it('says what it waits for when nothing is reported', () => {
    const { waitingFor } = make({ agents: [] });
    expect(waitingFor({ status: 'new', account: 'Main' })).toBe("Waiting for Main's session to start. Nothing reported yet.");
    expect(waitingFor({ status: 'working', account: 'Main', lastFireAt: 5, lastAgentAt: 5 })).toMatch(/^Waiting for Main to connect/);
    expect(waitingFor({ status: 'working', account: 'Main', lastFireAt: 5, lastAgentAt: 9 })).toBe('Main is connected but has not reported a step yet.');
  });
  it('writes short ages and plain lines', () => {
    const { agoShort, plainLine } = make({ agents: [] });
    expect([agoShort(42e3), agoShort(5 * 60e3 + 10e3), agoShort(2 * 3600e3)]).toEqual(['42s', '5m', '2h']);
    expect(plainLine('See [PR 12](https://x) and `hub_sync` **now**')).toBe('See PR 12 and hub_sync now');
  });
  it('is drawn without spinners or shimmer and ticks its ages in place', () => {
    const css = page.slice(page.indexOf('.feed > .activity {'), page.indexOf('/* Phone: the newest three actions'));
    expect(css).not.toMatch(/animation|shimmer|@keyframes/);
    expect(page).toContain("live.replace(/(class=\"(?:since|ago)\"[^>]*>)[^<]*/g, '$1')");
  });
});
