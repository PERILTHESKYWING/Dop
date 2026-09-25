import { describe, expect, it } from 'vitest';
import { parseSgfCollection, parseSgfFile, toSgf, extractGame } from '../src/lib/go/sgf';
import { gtpToLoc, locToGtp, locToSgf, sgfToLoc } from '../src/lib/go/coords';
import { importSgfTexts, detectPlayerColor } from '../src/lib/games';

const GAME = `(;GM[1]FF[4]SZ[19]KM[6.5]PB[Mira]PW[Tessa]RE[B+R]DT[2025-03-01]
;B[pd];W[dp](;B[pq];W[dd])(;B[dc]))`;

describe('SGF parsing', () => {
  it('reads the main line and metadata', () => {
    const { games, errors } = parseSgfFile(GAME);
    expect(errors).toEqual([]);
    const g = games[0];
    expect(g.size).toBe(19);
    expect(g.komi).toBe(6.5);
    expect(g.black).toBe('Mira');
    expect(g.moves.map((m) => locToSgf(m.loc, 19))).toEqual(['pd', 'dp', 'pq', 'dd']);
    expect(g.moves.map((m) => m.color)).toEqual([1, 2, 1, 2]);
  });

  it('handles escaped brackets, comments and whitespace', () => {
    const nodes = parseSgfCollection('(;GM[1]SZ[9]C[a \\] b]\n;B[ee]C[x]\n;W[]  )');
    const g = extractGame(nodes[0]);
    expect(g.size).toBe(9);
    expect(g.moves).toHaveLength(2);
    expect(g.moves[1].loc).toBe(-1); // pass
  });

  it('reads handicap setup stones', () => {
    const { games } = parseSgfFile('(;GM[1]SZ[19]HA[2]AB[pd][dp]KM[0.5];W[dd])');
    expect(games[0].handicap).toBe(2);
    expect(games[0].setup).toHaveLength(2);
    expect(games[0].moves[0].color).toBe(2);
  });

  it('parses multiple games in one file', () => {
    const { games } = parseSgfFile(GAME + '\n' + GAME.replace('Mira', 'Other'));
    expect(games).toHaveLength(2);
  });

  it('rejects broken or non-Go files gracefully', () => {
    expect(parseSgfFile('not an sgf').games).toHaveLength(0);
    expect(parseSgfFile('not an sgf').errors.length).toBeGreaterThan(0);
    expect(parseSgfFile('(;GM[3]SZ[8];B[aa])').games).toHaveLength(0);
    expect(parseSgfFile('(;GM[1]SZ[19];B[pd]').games.length + parseSgfFile('(;GM[1]SZ[19];B[pd]').errors.length).toBeGreaterThan(0);
  });

  it('round-trips through toSgf', () => {
    const g = parseSgfFile(GAME).games[0];
    const again = parseSgfFile(toSgf(g)).games[0];
    expect(again.moves).toEqual(g.moves);
    expect(again.komi).toBe(g.komi);
  });

  it('converts coordinates', () => {
    expect(locToGtp(sgfToLoc('aa', 19), 19)).toBe('A19');
    expect(locToGtp(sgfToLoc('ss', 19), 19)).toBe('T1');
    expect(gtpToLoc('Q16', 19)).toBe(sgfToLoc('pd', 19));
    expect(locToGtp(-1, 19)).toBe('pass');
  });

  it('imports files, dedupes, and detects the player side', () => {
    const r = importSgfTexts([{ name: 'a.sgf', text: GAME }, { name: 'b.sgf', text: GAME }, { name: 'bad.sgf', text: 'garbage' }], 'user', ['mira']);
    expect(r.games).toHaveLength(1);
    expect(r.games[0].playerColor).toBe(1);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(detectPlayerColor({ black: 'x', white: 'Mira K' }, ['mira k'])).toBe(2);
  });
});
