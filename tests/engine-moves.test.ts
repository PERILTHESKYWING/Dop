import { describe, expect, it } from 'vitest';
import { engineMoves } from '../src/lib/analysis/analyzer';
import { analysisIsCurrent } from '../src/lib/analysis/pipeline';
import { PASS, type Move } from '../src/lib/go/types';

const B = (loc: number): Move => ({ color: 1, loc });
const W = (loc: number): Move => ({ color: 2, loc });
const P = (color: 1 | 2): Move => ({ color, loc: PASS });

/** Colours must alternate and two passes must never follow each other (that ends a game). */
function wellFormed(ms: Move[]) {
  for (let i = 1; i < ms.length; i++) {
    expect(ms[i].color).not.toBe(ms[i - 1].color);
    expect(ms[i].loc === PASS && ms[i - 1].loc === PASS).toBe(false);
  }
}

describe('engineMoves (setup stones for the engine)', () => {
  it('leaves games without setup stones alone', () => {
    const h = [B(1), W(2), B(3)];
    expect(engineMoves([], h)).toBe(h);
  });

  it('interleaves equal setups without passes', () => {
    const out = engineMoves([B(1), B(2), W(3), W(4)], [], 1);
    expect(out).toEqual([B(1), W(3), B(2), W(4)]);
    wellFormed(out);
  });

  it('fills a missing colour with passes (handicap: White moves next, no trailing pass)', () => {
    const out = engineMoves([B(1), B(2), B(3)], [], 2);
    expect(out).toEqual([B(1), P(2), B(2), P(2), B(3)]);
    wellFormed(out);
  });

  it('adds one pass when the next mover played the last setup stone', () => {
    const out = engineMoves([B(1), W(2)], [], 2);
    expect(out).toEqual([B(1), W(2), P(1)]);
    wellFormed(out);
  });

  it('uses the first game move as the next mover', () => {
    const out = engineMoves([B(1), B(2)], [B(5), W(6)]);
    expect(out).toEqual([B(1), P(2), B(2), P(2), B(5), W(6)]);
    wellFormed(out);
  });

  it('handles White-only setups', () => {
    const out = engineMoves([W(1), W(2)], [], 1);
    expect(out).toEqual([W(1), P(1), W(2)]);
    wellFormed(out);
  });

  it('keeps every setup stone exactly once', () => {
    const setup = [B(1), W(9), B(2), B(3), W(8), B(4)];
    const out = engineMoves(setup, [], 2);
    expect(out.filter((m) => m.loc !== PASS).map((m) => m.loc).sort()).toEqual([1, 2, 3, 4, 8, 9]);
    wellFormed(out);
  });
});

describe('stored analyses after the setup fix', () => {
  const game = (setup: Move[]) => ({ komi: 7.5, rules: 'chinese', moves: [B(1)], setup }) as never;
  const analysis = (version: number) => ({ version, komi: 7.5, evals: [null, null] }) as never;
  it('keeps version-3 analyses of games without setup stones', () => {
    expect(analysisIsCurrent(analysis(3), game([]))).toBe(true);
  });
  it('redoes version-3 analyses of games with setup stones', () => {
    expect(analysisIsCurrent(analysis(3), game([B(5), B(6)]))).toBe(false);
    expect(analysisIsCurrent(analysis(4), game([B(5), B(6)]))).toBe(true);
  });
});
