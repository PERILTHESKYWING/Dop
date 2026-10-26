import { describe, expect, it } from 'vitest';
import { moveProblem, rankProblem } from '../scripts/coach-parts';

const feats = { n: 37, top1: 0.48, top3: 0.81, logp: -1.64, loss: 1.46, mistakes: 0.21, blunders: 0.13 };
const rankRow = { file: 'a.sgf', color: 1, rank: -3, handicap: 0, moves: 200, all: feats, phases: { opening: feats }, signatures: { ladder: [3, 1] } };
const moveRow = { file: 'b.sgf', rank: -16, move: 9, win: 0.07, played: 8, c: [[317, 0.274, 0.37, 0.016]] };

describe('coach training rows', () => {
  it('keeps good rows and skipped notes', () => {
    expect(rankProblem(rankRow)).toBeNull();
    expect(rankProblem({ file: 'c.sgf', skipped: 'not a 19x19 game' })).toBeNull();
    expect(moveProblem(moveRow)).toBeNull();
    expect(moveProblem({ file: 'c.sgf', skipped: 'no ranks' })).toBeNull();
  });
  it('drops rows the fits would trip on', () => {
    expect(rankProblem(null)).not.toBeNull();
    expect(rankProblem(42)).not.toBeNull();
    expect(rankProblem({ ...rankRow, file: undefined })).not.toBeNull();
    expect(rankProblem({ ...rankRow, rank: 'P9' })).not.toBeNull();
    expect(rankProblem({ ...rankRow, all: { ...feats, loss: null } })).not.toBeNull();
    expect(rankProblem({ ...rankRow, all: { ...feats, n: 0 } })).not.toBeNull();
    expect(rankProblem({ ...rankRow, signatures: undefined })).not.toBeNull();
    expect(rankProblem({ ...rankRow, phases: { opening: { n: null } } })).not.toBeNull();
    expect(moveProblem({ ...moveRow, c: [] })).not.toBeNull();
    expect(moveProblem({ ...moveRow, played: null })).not.toBeNull();
    expect(moveProblem({ ...moveRow, c: [[1, 2, null, 4]] })).not.toBeNull();
  });
});
