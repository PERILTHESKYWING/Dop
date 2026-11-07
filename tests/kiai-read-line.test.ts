/**
 * The answer's read line and its KataGo figures (critics, 2026-11-06): the game's rules and komi
 * as the game gave them, never assumed (Chinese 5d), and every KataGo figure in the text split out
 * so it can carry one number style (HN critic).
 */
import { describe, expect, it } from 'vitest';
import { boardFromSgf, emptyBoard, gameTerms, rulesName } from '../kami/src/lib/position';
import { splitFigures, splitRich } from '../kami/src/lib/terms';

describe('rules and komi on the read line', () => {
  it('names the rules an SGF gives, and nothing for rules it cannot name', () => {
    expect(rulesName('Japanese')).toBe('Japanese');
    expect(rulesName('japanese')).toBe('Japanese');
    expect(rulesName('Chinese')).toBe('Chinese');
    expect(rulesName('Korean')).toBe('Korean');
    expect(rulesName('AGA')).toBe('AGA');
    expect(rulesName('NZ')).toBe('New Zealand');
    expect(rulesName('tromp-taylor')).toBe('Tromp-Taylor');
    expect(rulesName(undefined)).toBeUndefined();
    expect(rulesName('')).toBeUndefined();
    expect(rulesName('area')).toBeUndefined(); // Kiai's own marker for an example board
    expect(rulesName('house rules')).toBeUndefined();
  });

  it('takes komi and rules from the loaded game', () => {
    const b = boardFromSgf('(;GM[1]FF[4]SZ[19]KM[6.5]RU[Japanese];B[pd];W[dp])');
    expect(gameTerms(b)).toEqual({ komi: 6.5, rules: 'Japanese' });
    expect(gameTerms(boardFromSgf('(;GM[1]FF[4]SZ[19]KM[7.5];B[pd])'))).toEqual({ komi: 7.5 });
  });

  it('leaves out a komi the SGF did not give (never an assumed value)', () => {
    const none = boardFromSgf('(;GM[1]FF[4]SZ[19];B[pd];W[dp])');
    expect(none.komiAssumed).toBe(true);
    expect(gameTerms(none)).toEqual({});
    // Fox writes KM[0] when the komi is missing in an even game
    expect(gameTerms(boardFromSgf('(;GM[1]FF[4]SZ[19]KM[0]RU[Chinese]AP[foxwq];B[pd])'))).toEqual({ rules: 'Chinese' });
  });

  it('a board set up here reads at its own komi', () => {
    expect(gameTerms(emptyBoard())).toEqual({ komi: 7.5 });
  });
});

describe("KataGo's figures in the answer text", () => {
  const figs = (t: string) => splitFigures([{ type: 'text', text: t }]).filter((p) => p.type === 'fig').map((p) => p.text.replace(/ /g, ' '));
  it('finds points and win chances', () => {
    expect(figs('White leads by about 11 points.')).toEqual(['11 points']);
    expect(figs("Black's win chance 1%, Black trails by 10.3 points.")).toEqual(['1%', '10.3 points']);
    expect(figs('R12 is 1 point worse; <1% for Black, leaning (61%).')).toEqual(['1 point', '<1%', '61%']);
  });
  it('leaves move numbers, stone counts and words alone', () => {
    expect(figs('By move 40 the 3 stones at the top are weak; checkpoints 5 pointsy.')).toEqual([]);
  });
  it('keeps a figure on one line with its unit, and the text whole', () => {
    const parts = splitFigures([{ type: 'text', text: 'Black trails by 10.3 points.' }]);
    expect(parts.map((p) => p.text).join('')).toBe('Black trails by 10.3 points.');
    expect(parts.find((p) => p.type === 'fig')?.text).toBe('10.3 points');
  });
  it('splits figures only when asked, around board points', () => {
    expect(splitRich('Q10 is 1.3 points worse.', 19, null).some((p) => p.type === 'fig')).toBe(false);
    const parts = splitRich('Q10 is 1.3 points worse.', 19, null, true);
    expect(parts.map((p) => p.type)).toEqual(['point', 'text', 'fig', 'text']);
  });
});
