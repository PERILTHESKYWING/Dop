/**
 * The landing's real material, recorded once by `npx tsx scripts/kiai-demo.ts` (demo.json): one
 * position (move 34 of game g70dd864b0bcbfc05 from the engine benchmark set, Black to play),
 * KataGo's read of it growing from 8 to 2,048 visits, Kiai's answers to three questions at each
 * depth, and a review of the whole game. All of it comes from the bundled b10 network running in
 * the same WebAssembly engine the site uses. Nothing here is made up; the page only shortens.
 */
import { allPositions } from '../../../../src/lib/go/board';
import { gtpToLoc } from '../../../../src/lib/go/coords';
import type { CandGlow, StoneColor } from '../../three/kaya';
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
  depth: 'Skim' | 'Dive' | 'Abyss';
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
  reads: Read[];
  answers: Answer[];
  review: { visits: number; moves: [StoneColor, string][]; bWin: number[]; classes: [number, string][]; accuracy: { black: number; white: number } };
}

export const DEMO = raw as unknown as Demo;
export const FINAL = DEMO.reads[DEMO.reads.length - 1];

/** The position as a stone array, and the order its stones were played (for the opening cascade). */
export const STONES: number[] = (() => {
  const s = new Array<number>(N * N).fill(0);
  for (const [g, c] of DEMO.stones) s[loc(g)] = c;
  return s;
})();
export const PLAY_ORDER: number[] = DEMO.review.moves
  .slice(0, DEMO.turn)
  .map(([, g]) => loc(g))
  .filter((l) => STONES[l]);

/** KataGo's candidates in one read, as the board draws them. */
export function glows(read: Read, max = 6): CandGlow[] {
  const top = read.cands[0];
  return read.cands.slice(0, max).map((c, i) => ({
    loc: loc(c.at),
    rank: i,
    share: c.visits / Math.max(1, top.visits),
    badness: Math.min(1, Math.max(0, (top.win - c.win) * 8)),
  }));
}

/** A line of play as glass stones, Black first unless told otherwise; passes are skipped. */
export function line(moves: string[], first: StoneColor = DEMO.toPlay) {
  const out: { loc: number; color: StoneColor }[] = [];
  moves.forEach((g, i) => {
    if (g === 'pass') return;
    out.push({ loc: loc(g), color: (i % 2 === 0 ? first : 3 - first) as StoneColor });
  });
  return out;
}

/**
 * An answer's words as the page shows them: the [[v1]] chips that become buttons in the app are
 * removed, and so are the friendly asides (a cheer, a joke, an emoji). Nothing is reworded.
 */
const ASIDES = [/Look at you! 🎯\s*/g, /Nice move!\s*/g, /No need to copy the engine's homework when yours gets the same result!\s*/g, /Two birds with one stone! 🐦\s*/g, /Pick whichever you prefer\.\s*/g];
export function words(text: string, sentences = 9): string {
  let t = text.replace(/\s*\[\[v\d+\]\]/g, '');
  for (const a of ASIDES) t = t.replace(a, '');
  const parts = t.trim().match(/[^.!?]+[.!?]+/g) ?? [t];
  return parts.slice(0, sentences).join(' ').replace(/\s+/g, ' ').trim();
}

export function answer(question: string, depth: Answer['depth']): Answer {
  const a = DEMO.answers.find((x) => x.question === question && x.depth === depth);
  if (!a) throw new Error(`No recorded answer for ${question} at ${depth}`);
  return a;
}

/** "White leads by 9.9 points" etc., as the answer's own numbers section gives it. */
export function numbers(a: Answer): string {
  return a.sections.find((s) => s.title === "KataGo's numbers")?.text ?? '';
}

/** The whole game, position by position, for the review replay. */
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
    .slice(0, 4)
    .sort((a, b) => a.n - b.n);
})();

export const fmt = (n: number) => n.toLocaleString('en-US');
export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
