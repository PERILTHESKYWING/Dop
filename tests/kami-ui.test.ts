import { describe, expect, it } from 'vitest';
import { pointView, splitPoints } from '../kami/src/lib/points';
import { getSetting, SETTINGS, setSetting } from '../kami/src/lib/settings';
import type { ExplainPosition, Variation } from '../src/lib/coach/explain/types';

const at = (gtp: string, size = 19) => (size - parseInt(gtp.slice(1), 10)) * size + 'ABCDEFGHJKLMNOPQRST'.indexOf(gtp[0]);

describe('splitPoints', () => {
  it('finds board points and leaves other words alone', () => {
    const parts = splitPoints('Black plays R16, then Q3. Not BR16, I5 or Z9.', 19);
    expect(parts.filter((p) => p.type === 'point').map((p) => p.text)).toEqual(['R16', 'Q3']);
    expect(parts.map((p) => p.text).join('')).toBe('Black plays R16, then Q3. Not BR16, I5 or Z9.');
  });
  it('ignores points off a small board', () => {
    expect(splitPoints('C3 and R16', 9).filter((p) => p.type === 'point').map((p) => p.text)).toEqual(['C3']);
  });
});

describe('pointView', () => {
  const base: ExplainPosition = { size: 19, komi: 7.5, rules: 'area', setup: [], moves: [{ color: 1, loc: at('Q16') }], toPlay: 2 } as unknown as ExplainPosition;
  const v = { id: 'v1', label: 'D4', kind: 'best', moves: [{ color: 2, loc: at('D4') }, { color: 1, loc: at('C3') }] } as unknown as Variation;
  it('shows the line a point starts', () => {
    expect(pointView(at('D4'), base, [v]).variation).toBe(v);
  });
  it('shows the line a point is part of, marked', () => {
    const r = pointView(at('C3'), base, [v]);
    expect(r.variation).toBe(v);
    expect(r.highlight).toEqual([at('C3')]);
  });
  it('marks a stone already on the board and plays an empty point for the side to move', () => {
    expect(pointView(at('Q16'), base, [])).toEqual({ line: [], highlight: [at('Q16')] });
    expect(pointView(at('K10'), base, []).line).toEqual([{ color: 2, loc: at('K10') }]);
  });
});

describe('settings', () => {
  it('has unique keys and a 30% default for built positions', () => {
    const keys = SETTINGS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(getSetting('positions.minWinrate')).toBe(0.3);
  });
  it('clamps numbers to their range', () => {
    setSetting('positions.minWinrate', 0.9);
    expect(getSetting('positions.minWinrate')).toBe(0.5);
    setSetting('katago.boardVisits', 1);
    expect(getSetting('katago.boardVisits')).toBe(30);
  });
});
