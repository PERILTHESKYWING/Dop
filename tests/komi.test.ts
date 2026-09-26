import { describe, expect, it } from 'vitest';
import { parseSgfFile, readKomi } from '../src/lib/go/sgf';
import { engineKomi, isTerritoryScoring } from '../src/lib/go/rules';
import { processRawOutput, DEFAULT_POSTPROCESS } from '../src/lib/engine/parse';

const game = (props: string) => parseSgfFile(`(;GM[1]FF[4]SZ[19]${props};B[pd];W[dp])`).games[0];

describe('komi', () => {
  it("reads Fox's KM[0] in an even game as the rules' usual komi", () => {
    const g = game('KM[0]HA[0]RU[Japanese]AP[foxwq]');
    expect(g.komi).toBe(6.5);
    expect(g.warnings.join(' ')).toMatch(/komi was 0/);
    expect(game('KM[0]HA[0]RU[Chinese]').komi).toBe(7.5);
    expect(game('KM[0]').komi).toBe(7.5);
  });

  it('keeps komi 0 in handicap games and on small boards', () => {
    expect(game('KM[0]HA[2]AB[pd][dp]').komi).toBe(0);
    expect(parseSgfFile('(;GM[1]SZ[9]KM[0];B[ee])').games[0].komi).toBe(0);
  });

  it('decodes komi stored times 100, and Chinese komi in stones', () => {
    expect(game('KM[650]RU[Japanese]').komi).toBe(6.5);
    expect(game('KM[375]RU[Chinese]').komi).toBe(7.5);
    const w: string[] = [];
    expect(readKomi('375', 0, 19, undefined, '', w)).toBe(7.5);
    expect(w[0]).toMatch(/375/);
  });

  it('keeps ordinary komi as given', () => {
    expect(game('KM[6.5]').komi).toBe(6.5);
    expect(game('KM[7.5]RU[Chinese]').komi).toBe(7.5);
    expect(game('').komi).toBe(7.5);
    expect(game('RU[Japanese]').komi).toBe(6.5);
  });

  it('gives KataGo half a point more komi for territory scoring', () => {
    expect(isTerritoryScoring('Japanese', 6.5)).toBe(true);
    expect(isTerritoryScoring('Korean', 6.5)).toBe(true);
    expect(isTerritoryScoring('Chinese', 6.5)).toBe(false);
    expect(isTerritoryScoring('koPOSITIONALscoreAREAtaxNONE', 6.5)).toBe(false);
    expect(isTerritoryScoring('koSIMPLEscoreTERRITORYtaxSEKI', 7.5)).toBe(true);
    expect(isTerritoryScoring(undefined, 6.5)).toBe(true);
    expect(isTerritoryScoring(undefined, 7.5)).toBe(false);
    expect(engineKomi(6.5, 'Japanese')).toBe(7);
    expect(engineKomi(7.5, 'Chinese')).toBe(7.5);
    expect(engineKomi(0.5, 'Japanese')).toBe(1);
  });
});

describe('winrate from score', () => {
  it('derives the winrate from the lead when the network asks for it', () => {
    const raw = { policyLogits: new Float32Array(362), value: new Float32Array([0.2, -0.2, -5, 0, 0.1]) };
    const plain = processRawOutput(raw, 1, () => true, DEFAULT_POSTPROCESS);
    const scaled = processRawOutput(raw, 1, () => true, { ...DEFAULT_POSTPROCESS, winrateScale: 2 });
    expect(plain.bLead).toBeCloseTo(2, 5);
    expect(scaled.bLead).toBeCloseTo(2, 5);
    expect(scaled.bWin).toBeCloseTo(1 / (1 + Math.exp(-1)), 5);
    // White to move with the same output: the lead is White's, so Black's winrate mirrors.
    const white = processRawOutput(raw, 2, () => true, { ...DEFAULT_POSTPROCESS, winrateScale: 2 });
    expect(white.bWin).toBeCloseTo(1 - scaled.bWin, 5);
  });
});
