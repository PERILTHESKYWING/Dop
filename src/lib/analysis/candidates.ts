/**
 * Candidate moves as the board draws them: the discs for Dop's study and review boards and
 * for Kami's board panel, and the line a candidate plays out. Pure: no engine, no store.
 */
import { PASS, other, type Color, type Loc, type Move } from '../go/types';

/** What the board needs of a candidate: its winrate and score for the side to move. */
export interface CandidateLike {
  loc: Loc;
  winrate: number;
  scoreLead: number;
  visits: number;
}

/** A candidate disc: the same fields the board's CandidateMark has. */
export interface CandidateDisc {
  loc: Loc;
  /** 0 = KataGo's choice (most visits). */
  rank: number;
  winrate: number;
  scoreLead: number;
  visits: number;
  /** Visits relative to the most visited move (0..1). */
  share: number;
  /** 0 = as good as the best move, 1 = clearly worse. */
  badness: number;
}

/**
 * Candidate discs for the board, as Lizzie draws them: moves with a meaningful share of
 * the visits, the most visited one first. Colour says how much worse than the best a
 * move is (by winrate, or by score once the game is decided).
 */
export function candidateMarks(cands: CandidateLike[], max = 10): CandidateDisc[] {
  const list = cands.filter((c) => c.loc !== PASS);
  if (!list.length) return [];
  const best = list[0];
  const top = best.visits || 1;
  return list
    .filter((c, i) => i < 3 || c.visits >= Math.max(2, top * 0.02))
    .slice(0, max)
    .map((c, i) => ({
      loc: c.loc,
      rank: i,
      winrate: c.winrate,
      scoreLead: c.scoreLead,
      visits: c.visits,
      share: c.visits / top,
      badness: Math.max((best.winrate - c.winrate) / 0.12, (best.scoreLead - c.scoreLead) / 6, 0),
    }));
}

/** A candidate's line as moves (colours alternate from the side to move). */
export function lineOf(pv: Loc[], toPlay: Color): Move[] {
  let c = toPlay;
  return pv.map((loc) => {
    const m = { color: c, loc };
    c = other(c);
    return m;
  });
}
