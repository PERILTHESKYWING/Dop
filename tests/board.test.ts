import { describe, expect, it } from 'vitest';
import { Board, replay } from '../src/lib/go/board';
import { gtpToLoc } from '../src/lib/go/coords';

const at = (s: string, size = 9) => gtpToLoc(s, size);

describe('Board', () => {
  it('captures a single stone and records captures', () => {
    const b = new Board(9);
    b.play(at('E5'), 2);
    for (const p of ['D5', 'F5', 'E4']) b.play(at(p), 1);
    const r = b.play(at('E6'), 1);
    expect(r.captured).toEqual([at('E5')]);
    expect(b.get(at('E5'))).toBe(0);
    expect(b.captures[1]).toBe(1);
  });

  it('forbids suicide and occupied points', () => {
    const b = new Board(9);
    for (const p of ['A2', 'B1']) b.play(at(p), 1);
    expect(b.isLegal(at('A1'), 2)).toBe(false);
    expect(b.isLegal(at('A2'), 2)).toBe(false);
    expect(b.isLegal(at('A1'), 1)).toBe(true);
  });

  it('enforces simple ko', () => {
    const b = new Board(9);
    // Black: D5 E4 E6 ; White: F4 F6 G5 E5 -> black captures at F5? Build a standard ko.
    for (const p of ['D5', 'E4', 'E6']) b.play(at(p), 1);
    for (const p of ['F4', 'F6', 'G5', 'E5']) b.play(at(p), 2);
    const r = b.play(at('F5'), 1);
    expect(r.captured).toEqual([at('E5')]);
    expect(b.isLegal(at('E5'), 2)).toBe(false);
    b.play(at('A9'), 2);
    b.play(at('A8'), 1);
    expect(b.isLegal(at('E5'), 2)).toBe(true);
  });

  it('counts liberties of groups', () => {
    const b = new Board(9);
    b.play(at('E5'), 1);
    b.play(at('E6'), 1);
    expect(b.groupAt(at('E5'))!.liberties.length).toBe(6);
    b.play(at('A1'), 1);
    expect(b.groupAt(at('A1'))!.liberties.length).toBe(2);
  });

  it('replays a game with setup stones', () => {
    const b = replay(9, [{ color: 1, loc: at('C3') }], [{ color: 2, loc: at('G7') }, { color: 1, loc: at('C7') }]);
    expect(b.counts()).toEqual([81 - 3, 2, 1]);
  });
});
