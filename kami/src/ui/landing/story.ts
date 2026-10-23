/**
 * The landing's words and the numbers behind them. Every number and every point named here is
 * taken from the recorded engine data (demo.json, see data.ts) by code, and the words are a
 * plain rewording of Kiai's own recorded answers; tests/kiai-landing.test.ts checks both.
 */
import { answer, DEMO, FINAL, loc, SWINGS } from './data';

const COORD = /\b([A-HJ-T](?:1[0-9]|[1-9]))\b/g;
/** The points an answer names, in order. */
export const pointsIn = (text: string) => [...text.replace(/\s*\[\[v\d+\]\]/g, '').matchAll(COORD)].map((m) => m[1]);

/** The answers at ultraGO's depth (its engine text: the move and numbers are KataGo's at any level of wording). */
export const LEVEL = 'ultraGO';
export const PLAY = answer('What should Black play here?', LEVEL);
export const SCORE = answer('Who is ahead, and why?', LEVEL);

/** Kiai's pick for Black, and the black group it says the move makes safer. */
// the answer opens with the position ("White leads by about 10 points. White's Q11 attaches...");
// its move is the first line it shows ([[v1]]), and the group is the one it says gets safer
export const PICK = PLAY.variations.find((v) => v.id === 'v1')?.moves[0] ?? pointsIn(PLAY.summary)[0];
export const GROUP = /black group at ([A-HJ-T]\d{1,2}) safer/.exec(PLAY.summary)?.[1] ?? '';
/** The answer's own first words: who leads, and by how much. */
export const PLAY_LEAD = Number(/^White leads by about (\d+) points/.exec(PLAY.summary)?.[1] ?? NaN);

/** The score answer's own numbers: White's lead and Black's win chance (out of 100). */
const scoreNums = /White leads by ([\d.]+) points \(Black.s winrate (\d+)%\)/.exec(SCORE.sections.find((x) => x.title === "KataGo's numbers")?.text ?? '');
export const LEAD = scoreNums ? Math.round(Number(scoreNums[1])) : Math.round(-FINAL.bLead);
export const BLACK_WINS = scoreNums ? Number(scoreNums[2]) : Math.round(FINAL.bWin * 100);

/** How KataGo's choice changed as it read: the first read's favourite and the last's. */
export const FIRST = DEMO.reads[0];
export const FIRST_PICK = FIRST.cands[0].at;
export const LAST_PICK = FINAL.cands[0].at;

/** The line of play Kiai showed with its pick. */
export const LINE: string[] = PLAY.variations.find((v) => v.moves[0] === PICK)?.moves.filter((m) => m !== 'pass') ?? [];

/** The review's biggest swing. */
export const TURN = [...SWINGS].sort((a, b) => b.drop - a.drop)[0];
const w = DEMO.review.bWin;
export const TURN_FROM = Math.round(w[TURN.n - 1] * 100);
export const TURN_TO = Math.round(w[TURN.n] * 100);

export const TAGLINE = 'KataGo, in plain words.';
/** Who made it, said once on the last screen. The KataGo credit is as in THIRD_PARTY_NOTICES.md. */
export const COLOPHON = 'Made by a professional Go player. The engine is KataGo, open source, by David J. Wu.';
/** What does what, said once on the last screen (the language model is never named: XIAO's rule). */
export const HOW =
  'KataGo does the reading in your browser. A language model only puts its numbers into words, and the app works without it. No AI-generated images: the calligraphy is the Yuji Syuku typeface and the board is rendered from code.';

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

/** The question and answer the first screen shows (a plain rewording of Kiai's answer). */
export const ASK = {
  q: PLAY.question,
  a: `White leads by about ${PLAY_LEAD} points. Black’s best try is ${PICK}: it takes away some of White’s area on the right and makes the black stones below it safer.`,
};

/** The reads KataGo grew through, for the reading chart: its top moves' share of the looking. */
export const READS = DEMO.reads.map((r) => {
  const total = r.cands.reduce((s, c) => s + c.visits, 0);
  return { visits: r.visits, cands: r.cands.slice(0, 4).map((c) => ({ at: c.at, share: c.visits / Math.max(1, total), win: c.win })) };
});
/** The moves the chart has a row for: every move that was KataGo's favourite at some point, the final pick first. */
export const READ_ROWS: string[] = [...new Set([LAST_PICK, ...[...DEMO.reads].reverse().map((r) => r.cands[0].at)])];

export const locOf = loc;
