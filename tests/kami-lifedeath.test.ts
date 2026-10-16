import { describe, expect, it } from 'vitest';
import { Board } from '../src/lib/go/board';
import { gtpToLoc, locToGtp } from '../src/lib/go/coords';
import { PASS, type Color } from '../src/lib/go/types';
import { findTarget, solveLifeDeath, type LifeDeathOptions } from '../src/lib/coach/explain/lifeDeath';

/** A board from an ASCII diagram (top row first): X black, O white, . empty. */
function diagram(rows: string[]): Board {
  const n = rows.length;
  const b = new Board(n);
  rows.forEach((r, y) => {
    const cells = r.replace(/\s/g, '');
    expect(cells.length).toBe(n);
    [...cells].forEach((ch, x) => (b.stones[y * n + x] = ch === 'X' ? 1 : ch === 'O' ? 2 : 0));
  });
  return b;
}

/** Black's wall over the rest of a 9x9 board, with three outside liberties (A9, J9, E7). */
const WALL = ['. X X X X X X X .', 'X X X X X X X X X', 'X X X X . X X X X', 'X X X X X X X X X', 'X X X X X X X X X', 'X X X X X X X X X'];
const W = (...bottom: string[]) => diagram([...WALL, ...bottom]);
const P = (s: string) => gtpToLoc(s, 9);
const G = (ls: number[]) => ls.map((l) => locToGtp(l, 9)).join(' ');

function solve(b: Board, at: string, toPlay: Color, opts: LifeDeathOptions = {}, hint: string[] = []) {
  const v = solveLifeDeath(b, P(at), toPlay, opts, hint.map(P));
  expect(v).not.toBeNull();
  return v!;
}

// White's straight three on the edge (C1 D1 E1): D1 is the vital point.
const STRAIGHT_THREE = W('X X X X X X X X X', 'X O O O O O X X X', 'X O . . . O X X X');
// White's bulky five in the corner (B1 C1 D1 B2 C2): C1 is the vital point.
const BULKY_FIVE = W('O O O O O X X X X', 'O . . O O X X X X', 'O . . . O X X X X');

describe('life and death: eye shapes', () => {
  it('straight three: Black kills at the vital point, White lives there', () => {
    const b = solve(STRAIGHT_THREE, 'B2', 1);
    expect(b).toMatchObject({ owner: 2, result: 'dead', ifOtherFirst: 'alive', key: P('D1'), proven: true });
    expect(b.line[0]).toBe(P('D1'));
    expect(b.missLine).toEqual([P('D1')]);
    expect(b.target[0]).toBe(P('B2'));
    expect(b.target).toHaveLength(7);

    const w = solve(STRAIGHT_THREE, 'B2', 2);
    expect(w).toMatchObject({ result: 'alive', ifOtherFirst: 'dead', key: P('D1'), proven: true });
    expect(w.line).toEqual([P('D1')]);
    // The miss line is Black's kill, played out to the capture.
    expect(w.missLine[0]).toBe(P('D1'));
  });

  it('bulky five: the vital point decides it either way', () => {
    const b = solve(BULKY_FIVE, 'A1', 1);
    expect(b).toMatchObject({ result: 'dead', ifOtherFirst: 'alive', key: P('C1'), proven: true });
    const w = solve(BULKY_FIVE, 'A1', 2);
    expect(w).toMatchObject({ result: 'alive', ifOtherFirst: 'dead', key: P('C1'), proven: true });
  });

  it('a wrong hint only changes the order of reading, not the answer', () => {
    const v = solve(BULKY_FIVE, 'A1', 1, {}, ['B1', 'D1']);
    expect(v).toMatchObject({ result: 'dead', key: P('C1'), proven: true });
  });

  it('a group with two eyes is alive with no move needed', () => {
    const b = W('X X X X X X X X X', 'X O O O O O O X X', 'X O . O O . O X X');
    for (const toPlay of [1, 2] as Color[]) {
      const v = solve(b, 'B2', toPlay);
      expect(v).toMatchObject({ result: 'alive', ifOtherFirst: 'alive', proven: true, line: [] });
      expect(v.key).toBeUndefined();
    }
  });

  it('one real eye and a false eye is dead', () => {
    // A1 is an eye; E1 is false: the stones E2 F2 F1 that make it are short of liberties, and
    // Black takes all three at E1 (no ko: three stones). Filling E1 first does not help White.
    const b = W('X X X X X X X X X', 'O O O X O O X X X', '. O O O . O X X X');
    for (const toPlay of [1, 2] as Color[]) {
      const v = solve(b, 'B2', toPlay);
      expect(v).toMatchObject({ result: 'dead', ifOtherFirst: 'dead', proven: true });
      expect(v.key).toBeUndefined();
    }
  });

  it('an eye whose stones can be taken back is a ko, not a false eye', () => {
    // Black takes F1 G1 at E1, White takes back at F1, Black ataris at G1: the eye at E1 is
    // now a ko (one stone for one).
    const b = W('X X X X X X X X X', 'X O O O O X X X X', 'X O . O . O O X X');
    const v = solve(b, 'B2', 1);
    expect(v).toMatchObject({ result: 'ko', ifOtherFirst: 'ko', key: P('E1'), proven: true });
  });
});

describe('life and death: seki, ko, snapback', () => {
  it('seki: neither side can fill the shared liberties', () => {
    const b = W('X X X X X X X X X', 'X O O O O O O O O', 'X O . X X X X . O');
    for (const toPlay of [1, 2] as Color[]) {
      const v = solve(b, 'B2', toPlay);
      expect(v).toMatchObject({ result: 'seki', ifOtherFirst: 'seki', proven: true, line: [] });
      expect(v.key).toBeUndefined();
    }
  });

  it('a direct ko for the second eye is a ko, and Black starts it by taking', () => {
    const b = W('X X X X X X X X X', 'X O O O O X X X X', 'X O . O . O X X X');
    const v = solve(b, 'B2', 1);
    expect(v).toMatchObject({ result: 'ko', ifOtherFirst: 'ko', key: P('E1'), proven: true });
    // Black takes E1, White (no threats in this read) has to play elsewhere, Black captures at C1.
    expect(v.line).toEqual([P('E1'), PASS, P('C1')]);
    const w = solve(b, 'B2', 2);
    expect(w.result).toBe('ko');
  });

  it('snapback: capturing the throw-in loses everything', () => {
    // Black's stone at C1 sits in White's two-point eye; White's only move is to take it at D1,
    // and Black takes back seven stones at C1 (no ko: the capture was not one stone for one).
    const b = W('X X X X X X X X X', 'X O O O O X X X X', 'X O X . O X X X X');
    const w = solve(b, 'B2', 2);
    expect(w).toMatchObject({ result: 'dead', ifOtherFirst: 'dead', proven: true });
    expect(w.line).toEqual([P('D1'), P('C1')]);
    // With a spare eye at G1 the same capture lives.
    const safe = W('X X X X X X X X X', 'X O O O O O O O X', 'X O X . O O . O X');
    expect(solve(safe, 'B2', 2)).toMatchObject({ result: 'alive', ifOtherFirst: 'alive', proven: true });
  });

  it('a two-point eye dies to a throw-in and snapback', () => {
    const b = W('X X X X X X X X X', 'X O O O O X X X X', 'X O . . O X X X X');
    const w = solve(b, 'B2', 2);
    expect(w).toMatchObject({ result: 'dead', ifOtherFirst: 'dead', proven: true });
    // Black first: the throw-in at C1, White takes at D1, Black takes back at C1.
    expect(G(w.missLine)).toBe('C1 D1 C1');
  });
});

describe('life and death: limits and open groups', () => {
  it('an open group is not a tsumego', () => {
    const b = diagram([
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . O O . . . .',
      '. . . O . O . . .',
      '. . . . O . . . .',
      '. . . . . . . . .',
      '. . X . . . X . .',
      '. . . . . . . . .',
    ]);
    expect(solveLifeDeath(b, P('D6'), 1)).toBeNull();
    expect(findTarget(b, [P('E5')], null)).toBeNull();
  });

  it('an area bigger than maxEmpty is not read', () => {
    expect(solveLifeDeath(BULKY_FIVE, P('A1'), 1, { maxEmpty: 4 })).toBeNull();
  });

  it('hitting the node limit gives unresolved, never a guess', () => {
    const v = solve(BULKY_FIVE, 'A1', 1, { maxNodes: 3 });
    expect(v).toMatchObject({ result: 'unresolved', proven: false, line: [] });
    expect(v.key).toBeUndefined();
    expect(v.nodes).toBeLessThanOrEqual(6);
  });

});

describe('findTarget', () => {
  it('finds the enclosed group next to the asked point and its area', () => {
    const t = findTarget(STRAIGHT_THREE, [P('D1')], null);
    expect(t).not.toBeNull();
    expect(t!.owner).toBe(2);
    expect(t!.stones).toContain(P('B2'));
    expect(t!.region).toEqual(expect.arrayContaining([P('C1'), P('D1'), P('E1')]));
    // The wall is not part of the area.
    expect(t!.region).not.toContain(P('A1'));
  });

  it('prefers the group KataGo calls weak', () => {
    const own = new Float32Array(81).fill(0.9);
    for (const s of ['B1', 'B2', 'C2', 'D2', 'E2', 'F2', 'F1']) own[P(s)] = -0.6;
    const t = findTarget(STRAIGHT_THREE, [P('D1'), P('G2')], own);
    expect(t?.owner).toBe(2);
    expect(t?.stones[0]).toBe(P('B2'));
  });
});
