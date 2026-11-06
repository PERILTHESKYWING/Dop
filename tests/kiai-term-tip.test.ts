import { describe, expect, it } from 'vitest';
import { inlineArrow, placeTip, revealBy, revealTarget } from '../kami/src/lib/tipPlace';

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

  it('a phone term under the board prefers to go over its line, so the answer below stays clear', () => {
    const p = placeTip(box(100, 400, 40, 24), 374, 80, 390, 844, [], 'above');
    expect(p.below).toBe(false);
    expect(p.top + 80).toBeLessThanOrEqual(400 - 3);
    // no room over it: under it after all
    expect(placeTip(box(100, 40, 40, 24), 374, 80, 390, 844, [], 'above').below).toBe(true);
  });
});

describe('the phone card inside the chat (Term.tsx inline)', () => {
  it('leaves the chat where it is when the card is in view', () => {
    expect(revealBy(700, 782, 600, 400)).toBe(0);
    expect(revealBy(774, 782, 600, 400)).toBe(0);
  });

  it('scrolls just enough to show a card that ends below the pane', () => {
    expect(revealBy(820, 782, 600, 400)).toBe(46);
  });

  it('never scrolls the tapped term off the top', () => {
    expect(revealBy(1200, 782, 450, 400)).toBe(42);
    expect(revealBy(1200, 782, 405, 400)).toBe(0);
  });

  it('points at the middle of the term, clear of the corners', () => {
    expect(inlineArrow(100, 160, 16, 358)).toBe(114);
    expect(inlineArrow(0, 10, 16, 358)).toBe(14);
    expect(inlineArrow(360, 390, 16, 358)).toBe(344);
  });
});

describe('a desktop hover card keeps KataGo’s numbers clear', () => {
  it('goes over the line when under it would cover the numbers list', () => {
    const list = box(80, 380, 580, 320);
    const p = placeTip(box(400, 340, 60, 28), 360, 120, 1440, 900, [], 'below', [list]);
    expect(p.below).toBe(false);
    expect(p.top + 120).toBeLessThanOrEqual(340 - 3);
  });

  it('stays under the line when over it would cover the list too, or does not fit', () => {
    const list = box(80, 100, 580, 600);
    expect(placeTip(box(400, 340, 60, 28), 360, 120, 1440, 900, [], 'below', [list]).below).toBe(true);
    expect(placeTip(box(400, 60, 60, 28), 360, 120, 1440, 900, [], 'below', [box(80, 100, 580, 300)]).below).toBe(true);
  });
});

describe('what the chat shows once a card opens in the text', () => {
  const line = (top: number) => box(16, top, 340, 24);
  it('the card and the whole next line', () => {
    expect(revealTarget(700, [line(600), line(708), line(732)], 900)).toBe(732);
  });
  it('up to the KataGo’s numbers toggle when it is close', () => {
    expect(revealTarget(700, [line(708), line(732)], 900, box(16, 750, 200, 26))).toBe(776);
    expect(revealTarget(700, [line(708)], 900, box(16, 900, 200, 30))).toBe(732);
  });
  it('a line the pane’s bottom edge cuts is shown whole when the rest fits', () => {
    expect(revealTarget(700, [line(708), line(732), line(756)], 770)).toBe(780);
  });
  it('with nothing after the card, the card', () => {
    expect(revealTarget(700, [line(600)], 900)).toBe(700);
  });
});
