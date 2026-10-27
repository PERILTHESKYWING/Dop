import { describe, expect, it } from 'vitest';
import { cutBelow } from '../kami/src/lib/cutLine';

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
