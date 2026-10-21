// hub/usage-probe.mjs: reading usage from Claude Code's stream-json output.
import { describe, expect, it } from 'vitest';

const probe = () => import(/* @vite-ignore */ '../hub/usage-probe.mjs' as string) as Promise<any>;

const event = (info: any) => JSON.stringify({ type: 'rate_limit_event', rate_limit_info: info });
const windows = (five: number, week: number) => ({
  status: 'allowed',
  unifiedWindows: { five_hour: { utilization: five, resetsAt: 1792578000 }, seven_day: { utilization: week, resetsAt: 1792645200 } },
});

describe('usage probe', () => {
  it('keeps the last rate_limit_event, as percent with ISO reset times', async () => {
    const { parseProbe } = await probe();
    const text = ['{"type":"system"}', event(windows(0.13, 0.62)), 'not json', event(windows(0.14, 0.62)), '{"type":"result"}'].join('\n');
    expect(parseProbe(text)).toEqual({
      five_hour_pct: 14,
      five_hour_resets: '2026-10-21T10:20:00.000Z',
      seven_day_pct: 62,
      seven_day_resets: '2026-10-22T05:00:00.000Z',
    });
  });

  it('says why when there are no numbers', async () => {
    const { parseProbe } = await probe();
    expect(parseProbe('{"type":"result"}').error).toMatch(/no rate limits/);
    expect(parseProbe(event({ status: 'allowed', unifiedWindows: {} })).error).toMatch(/no usage numbers/);
  });

  it('passes a non-allowed status on', async () => {
    const { parseProbe } = await probe();
    expect(parseProbe(event({ ...windows(1, 0.7), status: 'rejected' }))).toMatchObject({ five_hour_pct: 100, status: 'rejected' });
  });
});
