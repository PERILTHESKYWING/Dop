import { describe, expect, it } from 'vitest';
import { placeTip } from '../kami/src/lib/tipPlace';

const box = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h });

describe('term card placement (Term.tsx placeTip)', () => {
  it('sits just under the tapped line, inside the window', () => {
    const p = placeTip(box(100, 600, 40, 24), 374, 80, 390, 844);
    expect(p).toMatchObject({ left: 8, top: 627, below: true });
  });

  it('goes over the line when there is no room under it', () => {
    const p = placeTip(box(100, 760, 40, 24), 374, 80, 390, 844);
    expect(p.below).toBe(false);
    expect(p.top + 80).toBeLessThanOrEqual(760 - 3);
  });

  it('never half covers a button: it takes the button in whole or leaves it clear', () => {
    const button = box(280, 650, 90, 32);
    const p = placeTip(box(100, 560, 40, 24), 374, 80, 390, 844, [button]);
    const bottom = p.top + 80;
    const cut = (button.top < p.top && button.bottom > p.top) || (button.top < bottom && button.bottom > bottom);
    expect(cut).toBe(false);
    expect(p.top).toBeGreaterThanOrEqual(560 + 24 + 3);
  });
});
