import { describe, expect, it } from 'vitest';
import { addMove, blankKifu, kifuFromMoves, kifuFromSgf, kifuToSgf, lineEnd, lineThrough, movesTo, promote, removeNode, setComment, toPlayAt } from '../src/lib/kifu/kifu';
import { sgfToLoc } from '../src/lib/go/coords';

const at = (s: string) => sgfToLoc(s, 19);

describe('kifu with variations', () => {
  it('follows an existing move and branches on a new one', () => {
    let k = blankKifu();
    let a: number, b: number, c: number;
    [k, a] = addMove(k, 0, { color: 1, loc: at('pd') });
    [k, b] = addMove(k, a, { color: 2, loc: at('dp') });
    const [k2, same] = addMove(k, a, { color: 2, loc: at('dp') });
    expect(same).toBe(b);
    expect(k2).toBe(k);
    [k, c] = addMove(k, a, { color: 2, loc: at('dd') });
    expect(k.nodes[a].children).toEqual([b, c]);
    expect(movesTo(k, c).map((m) => m.loc)).toEqual([at('pd'), at('dd')]);
    expect(toPlayAt(k, c)).toBe(1);
    expect(lineThrough(k, a)).toEqual([0, a, b]);

    k = promote(k, c);
    expect(k.nodes[a].children).toEqual([c, b]);
    expect(lineEnd(k, 0)).toBe(c);

    const [k3, back] = removeNode(k, c);
    expect(back).toBe(a);
    expect(k3.nodes[a].children).toEqual([b]);
    expect(k3.nodes[c].gone).toBe(true);
  });

  it('round-trips through SGF with variations, comments and setup', () => {
    let k = kifuFromMoves({ size: 19, komi: 6.5, rules: 'japanese', black: 'Hoshi', white: 'Tengen', title: 'A study' }, [{ color: 1, loc: at('dd') }], [
      { color: 2, loc: at('pd') },
      { color: 1, loc: at('dp') },
    ]);
    const first = k.nodes[0].children[0];
    let v: number;
    [k, v] = addMove(k, first, { color: 1, loc: at('qp') });
    k = setComment(k, v, 'the other way [to] play');
    const sgf = kifuToSgf(k);
    expect(sgf).toContain('AB[dd]');
    expect(sgf).toContain('KM[6.5]');
    expect(sgf).toContain('RU[Japanese]');
    const back = kifuFromSgf(sgf);
    expect(back.title).toBe('A study');
    expect(back.black).toBe('Hoshi');
    expect(back.komi).toBe(6.5);
    expect(back.rules).toBe('japanese');
    expect(back.setup).toEqual([{ color: 1, loc: at('dd') }]);
    expect(back.first).toBe(2);
    const f = back.nodes[0].children[0];
    expect(back.nodes[f].children.length).toBe(2);
    const alt = back.nodes[f].children[1];
    expect(back.nodes[alt].move).toEqual({ color: 1, loc: at('qp') });
    expect(back.nodes[alt].comment).toBe('the other way [to] play');
  });

  it('opens a position part way through a game', () => {
    const moves = [
      { color: 1 as const, loc: at('pd') },
      { color: 2 as const, loc: at('dp') },
      { color: 1 as const, loc: at('pp') },
    ];
    const k = kifuFromMoves({ size: 19, komi: 7.5 }, [], moves, 2);
    expect(movesTo(k, k.cursor)).toEqual(moves.slice(0, 2));
    expect(lineEnd(k, 0)).not.toBe(k.cursor);
  });
});
