import { describe, expect, it } from 'vitest';
import { Board } from '../src/lib/go/board';
import { gtpToLoc } from '../src/lib/go/coords';
import { buildContext, phaseOf, pointFeatures } from '../src/lib/go/features';
import { classifyMove, signatureById } from '../src/lib/profile/signatures';
import { mf } from './helpers';

const at = (s: string) => gtpToLoc(s, 19);

describe('Go features', () => {
  it('detects local replies, tenuki, contact and line', () => {
    const b = new Board(19);
    b.play(at('Q16'), 1);
    b.play(at('R14'), 2);
    const ctx = buildContext(b, null);
    const local = pointFeatures(ctx, at('Q13'), 1, at('R14'));
    expect(local.local).toBe(true);
    expect(local.contact).toBe(false);
    expect(local.line).toBe(4);
    const far = pointFeatures(ctx, at('D4'), 1, at('R14'));
    expect(far.tenuki).toBe(true);
    expect(far.region).toBe('corner');
    expect(pointFeatures(ctx, at('R15'), 1, at('R14')).contact).toBe(true);
  });

  it('finds captures, ataris and saving moves', () => {
    const b = new Board(19);
    b.play(at('K10'), 2);
    for (const p of ['J10', 'L10', 'K9']) b.play(at(p), 1);
    const ctx = buildContext(b, null);
    expect(pointFeatures(ctx, at('K11'), 1, null).captures).toBe(1);
    expect(pointFeatures(ctx, at('K11'), 2, null).savesAtari).toBe(true);
  });

  it('classifies game phase', () => {
    expect(phaseOf(10, 19, 0.1)).toBe('opening');
    expect(phaseOf(240, 19, 0.8)).toBe('endgame');
  });

  it('matches decision signatures to features', () => {
    // A local answer when KataGo tenukis, losing 4 points.
    const f = mf({ local: true, distLast: 1 }, { tenuki: true, local: false, distLast: 9 }, { phase: 'middlegame' });
    const { contexts, errors } = classifyMove(f, 4, 0.08);
    expect(contexts).toContain('local_over_tenuki');
    expect(errors).toContain('local_over_tenuki');
    // Same move with no loss is not an error.
    expect(classifyMove(f, 0.2, 0).errors).not.toContain('local_over_tenuki');
    expect(signatureById.get('local_over_tenuki')!.axis).toBe('tenuki');
  });
});
