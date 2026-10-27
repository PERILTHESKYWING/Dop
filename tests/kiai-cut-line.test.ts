import { describe, expect, it } from 'vitest';
import { cutAbove, cutBelow } from '../kami/src/lib/cutLine';

describe('no half line at the answer pane bottom (lib/cutLine.ts)', () => {
  it('hides the strip from the top of a line the edge cuts', () => {
    expect(cutBelow([{ top: 700, bottom: 726 }, { top: 770, bottom: 796 }], 784)).toBe(14);
  });
  it('leaves whole lines, and boxes too tall to be a line, alone', () => {
    expect(cutBelow([{ top: 700, bottom: 726 }, { top: 758, bottom: 784 }], 784)).toBe(0);
    expect(cutBelow([{ top: 500, bottom: 900 }], 784)).toBe(0);
  });
  it('takes the highest cut box on the line (a point chip is taller than the text)', () => {
    expect(cutBelow([{ top: 772, bottom: 796 }, { top: 768, bottom: 798 }], 784)).toBe(16);
  });
});

describe('no half line at the answer pane top (lib/cutLine.ts)', () => {
  it('hides the strip down to the bottom of a line the top edge cuts', () => {
    expect(cutAbove([{ top: 520, bottom: 546 }, { top: 560, bottom: 586 }], 537)).toBe(9);
    expect(cutAbove([{ top: 540, bottom: 566 }], 537)).toBe(0);
  });
  it('hides the rest of a bubble when only its padding would show', () => {
    // the question's text line is cut; its bubble ends 10 px under the line
    expect(cutAbove([{ top: 520, bottom: 546 }], 537, [{ top: 508, bottom: 556 }])).toBe(19);
    // a tall bubble with more lines under the cut stays
    expect(cutAbove([{ top: 520, bottom: 546 }], 537, [{ top: 508, bottom: 640 }])).toBe(9);
  });
});
