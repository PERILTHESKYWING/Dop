/**
 * The landing page's live demos, recorded from real reads: KataGo (the bundled b10 network
 * through the WASM engine in Node, the same search the site runs, with the win chance taken
 * from the score lead as the site does for b10, WINRATE_FROM_SCORE, so the numbers are the ones
 * the app shows) on the landing's game (demo game g70dd864b0bcbfc05, 34 moves, Black to play),
 * and Kiai's own engine text for three questions at four of the app's levels (Low, Medium, Max,
 * and ultraGO's reading without its writer, which is what ultraGO shows when no language model is set up).
 * Nothing here calls a language model. The game review is of another demo game, read at the
 * app's own graph depth (60 visits a move, analysis.ts TREND_VISITS). g02b639852ab783a8 was
 * used until 2026-10-23, but from move 75 to 95 its lead swings about 3 points to whoever is to
 * move (also at 400 visits: a real feature of that game, not a bug), which drew a comb that read
 * as a bug. Seven other demo games were read the same way on 2026-10-23 and
 * gcf9da495b40ea48c was the cleanest: no comb, no spike, and one clear turn on Black's own
 * move (55: 52% to 16%). Pick another with --review-game.
 *
 *   npx tsx scripts/kiai-demo.ts --out kami/src/ui/landing/demo.json
 *   npx tsx scripts/kiai-demo.ts --review-only   (keep the reads and answers, redo the review)
 *   npx tsx scripts/kiai-demo.ts --keep-review   (redo the reads and answers, keep the review)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { explain, type ExplainPosition, type Question, type ThinkingLevel } from '../src/lib/coach/explain';
import { conceptById } from '../src/lib/coach/library';
import { replay } from '../src/lib/go/board';
import { gtpToLoc, locToGtp } from '../src/lib/go/coords';
import { PASS, type Color, type Loc, type Move } from '../src/lib/go/types';
import type { EngineRead, ModelId } from '../src/lib/coach/explain/types';
import { reviewMoves, accuracy } from '../kami/src/lib/review';
import { nodeProber } from './explainNode';
import { WINRATE_FROM_SCORE } from '../src/lib/engine/models';

const { values: arg } = parseArgs({
  options: {
    out: { type: 'string', default: 'kami/src/ui/landing/demo.json' },
    review: { type: 'string', default: '60' },
    'review-game': { type: 'string', default: 'gcf9da495b40ea48c' },
    'review-only': { type: 'boolean', default: false },
    'keep-review': { type: 'boolean', default: false },
  },
});
const root = new URL('../', import.meta.url);
const games = (JSON.parse(readFileSync(new URL('public/demo/demo.json', root), 'utf8')) as { games: { id: string; komi: number; moves: Move[] }[] }).games;
const game = games.find((g) => g.id === 'g70dd864b0bcbfc05')!;
const rgame = games.find((g) => g.id === arg['review-game'])!;
const TURN = 34;
const name = (l: Loc) => (l === PASS ? 'pass' : locToGtp(l, 19));
const posIn = (g: typeof game, n: number): ExplainPosition => ({ size: 19, komi: g.komi, setup: [], moves: g.moves.slice(0, n), toPlay: (n < g.moves.length ? g.moves[n].color : n % 2 ? 2 : 1) as Color });
const posAt = (n: number) => posIn(game, n);
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

const prober = await nodeProber(19, WINRATE_FROM_SCORE);
const pos = posAt(TURN);
const b = replay(19, [], pos.moves, pos.moves.length);
const stones: [string, number][] = [];
for (let l = 0; l < 361; l++) if (b.stones[l]) stones.push([name(l), b.stones[l]]);

// 1. KataGo thinking: the same position read with more and more visits.
const pack = (r: EngineRead) => ({
  visits: r.visits,
  bWin: r3(r.bWin),
  bLead: r2(r.bLead),
  cands: r.candidates.slice(0, 8).map((c) => ({ at: name(c.loc), win: r3(c.winrate), lead: r2(c.scoreLead), visits: c.visits, pv: c.pv.slice(0, 8).map(name) })),
  own: r.ownership ? Array.from(r.ownership, (o) => r2(o)) : null,
});
// --review-only keeps the reads and answers already recorded
const prev = arg['review-only'] && existsSync(arg.out!) ? (JSON.parse(readFileSync(arg.out!, 'utf8')) as { reads: unknown[]; answers: unknown[] }) : null;
const reads: unknown[] = prev?.reads ?? [];
for (const v of prev ? [] : [32, 128, 512, 2048]) {
  const r = await prober.read(pos, { visits: v, maxMs: 600_000 });
  if (r) reads.push(pack(r));
  console.log(`read ${v}: ${r?.candidates.slice(0, 3).map((c) => `${name(c.loc)} ${(c.winrate * 100).toFixed(1)}%`).join(', ')}`);
}

// 2. Kiai's answers, three questions at each depth (engine text, no language model).
const QUESTIONS: { text: string; q: Question }[] = [
  { text: 'Why is Q9 good here?', q: { kind: 'why-move', move: gtpToLoc('Q9', 19), text: 'Why is Q9 good here?' } },
  { text: 'What should Black play here?', q: { kind: 'best', text: 'What should Black play here?' } },
  { text: 'Who is ahead, and why?', q: { kind: 'overview', text: 'Who is ahead, and why?', intent: 'ahead' } },
];
const DEPTHS: { model: ModelId; name: string; thinking: ThinkingLevel }[] = [
  // the app's levels (kami/src/lib/levels.ts), engine text only: no language model is called
  { model: 'hane', name: 'Low', thinking: 'medium' },
  { model: 'tesuji', name: 'Medium', thinking: 'medium' },
  { model: 'tesuji', name: 'Max', thinking: 'max' },
  // ultraGO's reading (Myoshu at max) and its engine text: what ultraGO shows without its writer
  { model: 'myoshu', name: 'ultraGO', thinking: 'max' },
];
const answers: unknown[] = prev?.answers ?? [];
for (const { text, q } of prev ? [] : QUESTIONS) {
  for (const d of DEPTHS) {
    const t = Date.now();
    const ex = await explain(pos, q, prober, { model: d.model, thinking: d.thinking, examplesFor: (id) => conceptById(id)?.examples ?? [] });
    answers.push({
      question: text,
      depth: d.name,
      summary: ex.summary,
      sections: ex.sections,
      variations: ex.variations.map((v) => ({ id: v.id, moves: v.moves.map((m) => name(m.loc)) })),
      reads: ex.reads,
      visits: ex.totalVisits,
      ms: Date.now() - t,
    });
    console.log(`${d.name} "${text}": ${ex.totalVisits} visits, ${ex.reads} reads`);
  }
}

// 3. The whole game reviewed at a small, fixed number of visits per position (--keep-review: the recorded one).
const kept = arg['keep-review'] && existsSync(arg.out!) ? (JSON.parse(readFileSync(arg.out!, 'utf8')) as { review: unknown }).review : null;
async function reviewGame() {
  const RV = Number(arg.review);
  const positions = Array.from({ length: rgame.moves.length + 1 }, (_, i) => posIn(rgame, i));
  const gameReads: (EngineRead | undefined)[] = [];
  for (const p of positions) gameReads.push((await prober.read(p, { visits: RV, maxMs: 600_000 })) ?? undefined);
  const review = reviewMoves(positions, gameReads, rgame.moves, 19);
  return {
    game: rgame.id,
    visits: RV,
    moves: rgame.moves.map((m) => [m.color, name(m.loc)]),
    bWin: gameReads.map((r) => (r ? r3(r.bWin) : null)),
    bLead: gameReads.map((r) => (r ? Math.round(r.bLead * 10) / 10 : null)),
    classes: review.map((m) => [m.index, m.cls]),
    accuracy: { black: accuracy(review, 1), white: accuracy(review, 2) },
  };
}
const out = {
  game: game.id,
  turn: TURN,
  toPlay: pos.toPlay,
  komi: pos.komi,
  last: name(pos.moves[pos.moves.length - 1].loc),
  stones,
  // the order the position's stones were played in (the hero drops them in this order)
  order: game.moves.slice(0, TURN).map((m) => name(m.loc)),
  reads,
  answers,
  review: kept ?? (await reviewGame()),
};
writeFileSync(arg.out!, JSON.stringify(out));
console.log(`wrote ${arg.out}`);
