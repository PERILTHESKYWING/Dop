/**
 * How "you" the Doppelgänger copy is, before and after the human-copy work, measured on
 * a real player's games it did not learn from (data from scripts/doppel-data.ts).
 *
 *   npx tsx scripts/doppel-eval.ts data-0.jsonl data-1.jsonl [--generations 4] [--json out.json]
 *
 * Every fifth game is held out. Reported for the old copy (21 habits, sampling its own
 * distribution as Natural mode did), the new copy with default settings, and the new copy
 * after evolution, next to the player: chance of playing the player's exact move, points
 * lost per move and mistake rates per phase, and obvious blunders.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { replay } from '../src/lib/go/board';
import { buildContext } from '../src/lib/go/features';
import { decodeOwnership } from '../src/lib/engine/parse';
import { PASS, type Color, type Loc, type Move } from '../src/lib/go/types';
import { buildExample, evaluate, fitCopy, splitByGame, type DoppelExample } from '../src/lib/profile/doppel';
import { bookFromExamples, describeExample, fitWith, mistakesWith, sampleOf } from '../src/lib/profile/copyTrain';
import { bestGenome, evolve, fitnessOf } from '../src/lib/profile/evolve';
import { DEFAULT_GENOME, type Genome } from '../src/lib/profile/genome';
import { DEFAULT_DIALS, type CopyDials } from '../src/lib/profile/dials';
import { measurePlay, TILT_LOSS, type PlayMetrics } from '../src/lib/profile/human';

const args = process.argv.slice(2);
const flag = (k: string, d?: string) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));

interface Pos {
  i: number;
  pol: [number, number][];
  own?: string;
  bWin: number;
  bLead: number;
  loss: [number, number][];
}
interface Game {
  file: string;
  color: Color;
  size: number;
  setup: Move[];
  moves: Move[];
  positions: Pos[];
}

const games: Game[] = files
  .flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)))
  .filter((g) => !g.skipped && g.positions?.length)
  .sort((a, b) => a.file.localeCompare(b.file));
console.log(`${games.length} games, ${games.reduce((a, g) => a + g.positions.length, 0)} of the player's moves`);

const examples: DoppelExample[] = [];
games.forEach((g, gi) => {
  const age = games.length - 1 - gi;
  let prevLoss = 0;
  for (const p of g.positions) {
    const board = replay(g.size, g.setup, g.moves, p.i);
    const ctx = buildContext(board, decodeOwnership(p.own));
    const prev = p.i > 0 ? g.moves[p.i - 1] : null;
    const lastOpp = prev && prev.color !== g.color ? prev.loc : null;
    const own = p.i > 1 && g.moves[p.i - 2].color === g.color ? g.moves[p.i - 2].loc : null;
    const win = g.color === 1 ? p.bWin : 1 - p.bWin;
    const played = g.moves[p.i].loc;
    const policy = p.pol.map(([loc, pr]) => ({ loc, p: pr })).filter((e) => e.loc === PASS || board.isLegal(e.loc, g.color));
    const ex = buildExample(ctx, policy, g.color, lastOpp, played, g.file, { moveNumber: p.i, win, lastOwn: own });
    if (!ex) continue;
    const losses = new Map<Loc, number>(p.loss.map(([l, v]) => [l, v]));
    const playedLoss = losses.get(played);
    describeExample(ex, {
      ctx,
      board,
      color: g.color,
      lastOpp,
      moveNumber: p.i,
      leadBefore: g.color === 1 ? p.bLead : -p.bLead,
      losses,
      playedLoss,
      afterMistake: prevLoss >= TILT_LOSS,
      age,
    });
    examples.push(ex);
    prevLoss = playedLoss ?? 0;
  }
});

const { train, test } = splitByGame(examples);
console.log(`learn from ${new Set(train.map((e) => e.gameId)).size} games (${train.length} moves), test on ${new Set(test.map((e) => e.gameId)).size} games (${test.length} moves)\n`);

// The old copy: the 21 original habits, one set for the whole game, no book, no mistake model.
const OLD_NF = 21;
const strip = (e: DoppelExample): DoppelExample => ({ ...e, x: e.x.map((v) => v.map((x, k) => (k < OLD_NF ? x : 0))), bookAt: undefined });
const oldModel = fitCopy(train.map(strip));
const oldHabits = evaluate(oldModel, test.map(strip));
const old = measurePlay(test.map((e) => sampleOf(oldModel, strip(e))), {});

function build(genome: Genome) {
  const w = fitWith(train, genome);
  const book = bookFromExamples(train);
  const mistakes = mistakesWith(w, train, genome, book);
  return { w, book, mistakes, genome };
}
function play(c: ReturnType<typeof build>, dials: CopyDials = DEFAULT_DIALS): PlayMetrics {
  return measurePlay(test.map((e) => sampleOf(c.w, e, c.book, dials.book)), { mistakes: c.mistakes, genome: c.genome }, dials);
}

const t0 = Date.now();
const base = build(DEFAULT_GENOME);
const baseHabits = evaluate(base.w, test);
const basePlay = play(base);
console.log(`new copy built in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const gens = Number(flag('generations', '4'));
const t1 = Date.now();
const evo = evolve(train, null, DEFAULT_GENOME, { generations: gens, seed: 7, onProgress: (d, t, b) => d % 8 === 0 && console.log(`  evolution ${d}/${t}, best ${b?.toFixed(4)}`) });
const g = bestGenome(evo)!;
console.log(`evolution: ${gens} generations in ${((Date.now() - t1) / 1000).toFixed(0)} s; best settings ${JSON.stringify(g, (_, v) => (typeof v === 'number' ? +v.toPrecision(3) : v))}`);
const evolved = build(g);
const evoPlay = play(evolved);

const kata = evaluate({ weights: [1] }, test);
const pct = (v: number) => (100 * v).toFixed(1) + '%';
const row = (name: string, m: PlayMetrics, side: 'copy' | 'habits' = 'copy') => {
  const ph = m.byPhase.map((p) => `${p[side].meanLoss.toFixed(2)} / ${pct(p[side].mistakes)} / ${pct(p[side].blunders)}`);
  const match = side === 'copy' ? m.match : m.habitsMatch;
  const ll = side === 'copy' ? m.logLik : m.habitsLogLik;
  return `| ${name} | ${pct(match)} | ${ll.toFixed(3)} | ${ph.join(' | ')} | ${pct(m.obvious[side])} |`;
};
const you = (m: PlayMetrics) => `| The player | 100% | 0 | ${m.byPhase.map((p) => `${p.you.meanLoss.toFixed(2)} / ${pct(p.you.mistakes)} / ${pct(p.you.blunders)}`).join(' | ')} | ${pct(m.obvious.you)} |`;

const lines = [
  `Held-out games: ${new Set(test.map((e) => e.gameId)).size} (${test.length} moves).`,
  '',
  '| Copy | Plays your exact move | Log-likelihood | Opening: pts/move / mistakes / blunders | Middle game | Endgame | Obvious blunders |',
  '|---|---|---|---|---|---|---|',
  row('Old copy (Natural mode)', old, 'habits'),
  row('New copy, default settings', basePlay),
  row('New copy, evolved settings', evoPlay),
  you(evoPlay),
  '',
  `Habits alone, top-1 / top-3 exact move: KataGo policy ${pct(kata.top1)} / ${pct(kata.top3)}, old ${pct(oldHabits.top1)} / ${pct(oldHabits.top3)}, new ${pct(baseHabits.top1)} / ${pct(baseHabits.top3)}.`,
  `Fitness (log-likelihood + 1.5 x exact-move rate - loss-gap penalty): old ${fitnessOf({ ...old, match: old.habitsMatch, logLik: old.habitsLogLik, byPhase: old.byPhase.map((p) => ({ ...p, copy: p.habits })) }).toFixed(3)}, default ${fitnessOf(basePlay).toFixed(3)}, evolved ${fitnessOf(evoPlay).toFixed(3)}.`,
  `The player's moves outside KataGo's top 10 (the copy never plays those): ${pct(evoPlay.outside.share)}, ${evoPlay.outside.meanLoss.toFixed(2)} pts/move; the table's "player" row is their other moves.`,
  `Tilt measured: ${base.mistakes.tilt.toFixed(2)}x points lost after a mistake. Book: ${base.book.positions} positions.`,
  '',
  'Ablations (evolved copy, one part switched off):',
  '',
  '| Copy | Plays your exact move | Log-likelihood | Opening | Middle game | Endgame | Obvious blunders |',
  '|---|---|---|---|---|---|---|',
  row('No opening book', play(evolved, { ...DEFAULT_DIALS, book: 0 })),
  row('No blunder guard', play(evolved, { ...DEFAULT_DIALS, guard: false })),
  row('No mistake kinds', play(evolved, { ...DEFAULT_DIALS, types: false })),
  row('No tilt', play(evolved, { ...DEFAULT_DIALS, mood: 'calm' })),
  row('Presets: good day', play(evolved, { ...DEFAULT_DIALS, mistakes: 0.55, maxMistake: 6, variety: 0.85, mood: 'calm' })),
  row('Presets: bad day', play(evolved, { ...DEFAULT_DIALS, mistakes: 1.6, variety: 1.15, mood: 'tilted' })),
];
console.log(lines.join('\n'));
const out = flag('json');
if (out) writeFileSync(out, JSON.stringify({ old, basePlay, evoPlay, genome: g, evo: evo.history, lines }, null, 1));
