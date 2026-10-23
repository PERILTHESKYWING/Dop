/**
 * The landing's real material, recorded once by `npx tsx scripts/kiai-demo.ts` (demo.json): one
 * position (move 34 of game g70dd864b0bcbfc05 from the engine benchmark set, Black to play),
 * KataGo's read of it growing from 32 to 2,048 visits, Kiai's answers to three questions at four
 * of the app's levels, and a review of a whole game at the app's graph depth. All of it comes
 * from the bundled b10 network running in the same WebAssembly engine the site uses, with the
 * win chance taken from the score lead as the site does (WINRATE_FROM_SCORE), so the landing's
 * numbers are the ones the app shows. Nothing here is made up; the page only shortens.
 */
import { allPositions } from '../../../../src/lib/go/board';
import { gtpToLoc } from '../../../../src/lib/go/coords';
import type { StoneColor } from '../../three/kaya';
import raw from './demo.json';

export const N = 19;
export const loc = (g: string) => gtpToLoc(g, N);

export interface Cand {
  at: string;
  win: number;
  lead: number;
  visits: number;
  pv: string[];
}
export interface Read {
  visits: number;
  bWin: number;
  bLead: number;
  cands: Cand[];
  own: number[];
}
export interface Answer {
  question: string;
  /** The app's level it was asked at (kami/src/lib/levels.ts); engine text, no language model. */
  depth: 'Low' | 'Medium' | 'Max' | 'ultraGO';
  summary: string;
  sections: { title: string; text: string }[];
  variations: { id: string; moves: string[] }[];
  reads: number;
  visits: number;
  ms: number;
}
interface Demo {
  game: string;
  turn: number;
  toPlay: StoneColor;
  komi: number;
  last: string;
  stones: [string, StoneColor][];
  /** The order the position's stones were played in. */
  order: string[];
  reads: Read[];
  answers: Answer[];
  /** A whole game reviewed (another game than the position's: one whose lead changes hands). */
  review: { game: string; visits: number; moves: [StoneColor, string][]; bWin: number[]; classes: [number, string][]; accuracy: { black: number; white: number } };
}

export const DEMO = raw as unknown as Demo;
export const FINAL = DEMO.reads[DEMO.reads.length - 1];

/** The position as a stone array. */
export const STONES: number[] = (() => {
  const s = new Array<number>(N * N).fill(0);
  for (const [g, c] of DEMO.stones) s[loc(g)] = c;
  return s;
})();

export function answer(question: string, depth: Answer['depth']): Answer {
  const a = DEMO.answers.find((x) => x.question === question && x.depth === depth);
  if (!a) throw new Error(`No recorded answer for ${question} at ${depth}`);
  return a;
}

/** The whole game, position by position (boards[i] is the board after i moves). */
export const GAME = (() => {
  const moves = DEMO.review.moves.map(([c, g]) => ({ color: c, loc: g === 'pass' ? -1 : loc(g) }));
  const boards = allPositions(N, [], moves).map((b) => b.stones);
  return { moves, boards };
})();

/** The moves that cost the mover the most win rate in the review, biggest first. */
export const SWINGS = (() => {
  const w = DEMO.review.bWin;
  const cls = new Map(DEMO.review.classes);
  return DEMO.review.moves
    .map(([c, g], i) => ({ n: i + 1, color: c, at: g, drop: c === 1 ? w[i] - w[i + 1] : w[i + 1] - w[i], cls: cls.get(i) ?? '' }))
    .sort((a, b) => b.drop - a.drop)
    .slice(0, 4);
})();
