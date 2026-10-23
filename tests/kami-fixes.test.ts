import { describe, expect, it } from 'vitest';
import { engineAttempts, shouldTune } from '../kami/src/lib/engine';
import { emptyBoard, playAt, type BoardState } from '../kami/src/lib/position';
import { askFor, parseQuestion, routeQuestion } from '../kami/src/lib/question';
import { gtpToLoc } from '../src/lib/go/coords';

const g = (s: string) => gtpToLoc(s, 19);

function board(...pts: string[]): BoardState {
  let b = emptyBoard(19);
  for (const p of pts) b = playAt(b, g(p))!;
  return b;
}

describe('Kami questions about moves already played', () => {
  const b = board('Q16', 'D4', 'Q3', 'D16', 'C10');

  it('"why was my move bad?" asks about the last move, before it was played', () => {
    const a = askFor(b, parseQuestion('Why was my move bad?', 19));
    expect(a.question.kind).toBe('why-move');
    expect(a.question.move).toBe(g('C10'));
    expect(a.upTo).toBe(4);
    expect(a.pos.toPlay).toBe(1);
    expect(a.pos.moves.length).toBe(4);
  });

  it('"what should I have played?" asks for the best move before the last move', () => {
    const a = askFor(b, parseQuestion('What should I have played?', 19));
    expect(a.question.kind).toBe('best');
    expect(a.question.move).toBeUndefined();
    expect(a.upTo).toBe(4);
  });

  it('"what should I play?" still means now', () => {
    const a = askFor(b, parseQuestion('What should I play?', 19));
    expect(a.question.kind).toBe('best');
    expect(a.upTo).toBe(5);
    expect(a.pos.toPlay).toBe(2);
  });

  it('an earlier move named by its point goes back to when it was played', () => {
    const a = askFor(b, parseQuestion('Why was Q3 bad?', 19));
    expect(a.question.move).toBe(g('Q3'));
    expect(a.upTo).toBe(2);
    expect(a.pos.toPlay).toBe(1);
  });

  it('"my move" questions go to the engine, not the concept library', () => {
    expect(routeQuestion('Why was my move bad?', b, () => []).type).toBe('position');
  });

  it('"what should my move be" is the best move now, not the last one', () => {
    expect(parseQuestion('What should my move be?', 19)).toMatchObject({ kind: 'best' });
    expect(parseQuestion("What's wrong with it?", 19)).toMatchObject({ kind: 'why-move', lastMove: true });
  });
});

describe('Kami picks the strongest network the device can run', () => {
  it('b18 on the GPU of a computer, then b10 on the CPU', () => {
    const a = engineAttempts(true, false, false);
    expect(a.map((x) => [x.spec.id, x.forceCpu])).toEqual([
      ['kata1-b18c384nbt', false],
      ['g170e-b10c128', true],
    ]);
  });
  it('only b10 on phones, without WebGPU, or after a GPU crash', () => {
    for (const [webgpu, phone, broken] of [
      [true, true, false],
      [false, false, false],
      [true, false, true],
    ] as const) {
      expect(engineAttempts(webgpu, phone, broken).map((x) => x.spec.id)).toEqual(['g170e-b10c128']);
    }
  });
});

describe('Kiai background tuning', () => {
  it('measures an untuned device, but not again within a week of a failed try', () => {
    const now = 1_000_000_000_000;
    expect(shouldTune(false, null, now)).toBe(true);
    expect(shouldTune(true, null, now)).toBe(false);
    expect(shouldTune(false, String(now - 3600_000), now)).toBe(false);
    expect(shouldTune(false, String(now - 8 * 24 * 3600_000), now)).toBe(true);
    expect(shouldTune(false, 'garbage', now)).toBe(true);
  });
});
