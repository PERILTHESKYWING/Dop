/**
 * The landing's words and the numbers behind them. Every number and every point named here is
 * taken from the recorded engine data (demo.json, see data.ts) by code, and the words are a
 * plain rewording of Kiai's own recorded answers; tests/kiai-landing.test.ts checks both.
 */
import { answer, DEMO, FINAL, loc, SWINGS } from './data';

const COORD = /\b([A-HJ-T](?:1[0-9]|[1-9]))\b/g;
/** The points an answer names, in order. */
export const pointsIn = (text: string) => [...text.replace(/\s*\[\[v\d+\]\]/g, '').matchAll(COORD)].map((m) => m[1]);

export const PLAY = answer('What should Black play here?', 'Deep');
export const SCORE = answer('Who is ahead, and why?', 'Deep');

/** Kiai's Deep pick for Black, and the black group it says the move makes safer. */
export const PICK = pointsIn(PLAY.summary)[0];
export const GROUP = pointsIn(PLAY.summary)[1];

/** The score answer's own numbers: White's lead and Black's win chance (out of 100). */
const scoreNums = /White leads by ([\d.]+) points \(Black.s winrate (\d+)%\)/.exec(SCORE.sections.find((x) => x.title === "KataGo's numbers")?.text ?? '');
export const LEAD = scoreNums ? Math.round(Number(scoreNums[1])) : Math.round(-FINAL.bLead);
export const BLACK_WINS = scoreNums ? Number(scoreNums[2]) : Math.round(FINAL.bWin * 100);

/** How KataGo's choice changed as it read: the first read's favourite and the last's. */
export const FIRST = DEMO.reads[0];
export const FIRST_PICK = FIRST.cands[0].at;
export const LAST_PICK = FINAL.cands[0].at;

/** The line of play Kiai showed with its Deep pick. */
export const LINE: string[] = PLAY.variations.find((v) => v.moves[0] === PICK)?.moves.filter((m) => m !== 'pass') ?? [];

/** The review's biggest swing. */
export const TURN = [...SWINGS].sort((a, b) => b.drop - a.drop)[0];
const w = DEMO.review.bWin;
export const TURN_FROM = Math.round(w[TURN.n - 1] * 100);
export const TURN_TO = Math.round(w[TURN.n] * 100);

export const TAGLINE = 'Ask what to play in any Go position.';

export interface Chapter {
  id: string;
  /** The rail's name for it. */
  rail: string;
  title: string;
  /** A large line under the title (the chapter's answer), and a smaller one. */
  lead?: string;
  text?: string;
}

export const CHAPTERS: Chapter[] = [
  { id: 'ask', rail: 'Ask', title: TAGLINE },
  { id: 'reading', rail: 'Reading', title: 'It reads before it answers.' },
  { id: 'next', rail: 'Next moves', title: 'See what happens next.' },
  { id: 'ahead', rail: 'Who is ahead', title: 'Who is ahead?', lead: `White, by about ${LEAD} points.`, text: 'Black’s best chance: the upper right.' },
  { id: 'review', rail: 'Game review', title: 'Find where a game turned.', text: 'Load a game. The graph shows where it turned.' },
  { id: 'start', rail: 'Start', title: 'Ask about your own game.', text: 'Free. No sign-up. Runs in your browser.' },
];

/** The reading chapter's picture in words: KataGo's first favourite, then its final pick. */
export const PICKS = { first: { label: 'At first', at: FIRST_PICK }, then: { label: 'After a longer look', at: LAST_PICK } };

/** The question and answer the first screen shows (a plain rewording of Kiai's Deep answer). */
export const ASK = {
  q: PLAY.question,
  a: `Play at ${PICK}. It takes away some of White’s area on the right, and it makes the black stones below it safer.`,
};

/** The reads KataGo grew through, for the reading chart: its top moves' share of the looking. */
export const READS = DEMO.reads.map((r) => {
  const total = r.cands.reduce((s, c) => s + c.visits, 0);
  return { visits: r.visits, cands: r.cands.slice(0, 4).map((c) => ({ at: c.at, share: c.visits / Math.max(1, total), win: c.win })) };
});
/** The moves the chart has a row for: KataGo's final pick and its first favourite. */
export const READ_ROWS: string[] = [LAST_PICK, FIRST_PICK];

export const locOf = loc;
