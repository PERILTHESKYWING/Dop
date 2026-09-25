import { describe, expect, it } from 'vitest';
import { decodeOwnership, encodeOwnership, moverView, processRawOutput, topPolicy } from '../src/lib/engine/parse';

describe('engine output post-processing', () => {
  const hw = 9 * 9;
  const logits = () => {
    const l = new Float32Array(hw + 1).fill(0);
    l[40] = 5;
    l[0] = 10; // illegal in the tests below
    return l;
  };

  it('softmaxes policy over legal moves only', () => {
    const out = processRawOutput({ policyLogits: logits(), value: new Float32Array([0, 0, -20, 0, 0]) }, 1, (l) => l !== 0);
    expect(out.policy[0]).toBe(0);
    const sum = out.policy.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
    expect(topPolicy(out.policy, 1)[0].loc).toBe(40);
  });

  it('converts side-to-move values to Black perspective and scales the lead', () => {
    const v = new Float32Array([2, 0, -20, 0, 0.25]);
    const b = processRawOutput({ policyLogits: logits(), value: v }, 1, () => true);
    const w = processRawOutput({ policyLogits: logits(), value: v }, 2, () => true);
    expect(b.bWin).toBeGreaterThan(0.85);
    expect(w.bWin).toBeCloseTo(1 - b.bWin, 6);
    expect(b.bLead).toBeCloseTo(5, 5);
    expect(w.bLead).toBeCloseTo(-5, 5);
  });

  it('tanh-squashes ownership into Black perspective', () => {
    const own = new Float32Array(hw).fill(3);
    const w = processRawOutput({ policyLogits: logits(), value: new Float32Array(5), ownership: own }, 2, () => true);
    expect(w.ownership![0]).toBeCloseTo(-Math.tanh(3), 5);
  });

  it('round-trips ownership through the compact encoding', () => {
    const own = new Float32Array([1, -1, 0, 0.5, -0.25]);
    const back = decodeOwnership(encodeOwnership(own))!;
    for (let i = 0; i < own.length; i++) expect(back[i]).toBeCloseTo(own[i], 1);
  });

  it('gives the mover view', () => {
    expect(moverView(0.7, 3, 2)).toEqual({ win: 0.30000000000000004, lead: -3 });
  });
});
