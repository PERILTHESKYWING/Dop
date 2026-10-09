/**
 * Reference answers for the engine benchmark (public/engine/bench-positions.json).
 *
 * Picks positions from the demo games and has unmodified native KataGo (the official
 * binary, same bundled network) analyse each one twice: deeply (the reference answer the
 * browser engine is scored against) and at a small fixed budget (what KataGo's own search
 * finds with the visits the browser can afford, for a like-for-like comparison).
 *
 *   KATAGO=/path/to/katago npx tsx scripts/engine-reference.ts [count] [deepVisits] [lightVisits]
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gtpToLoc, locToGtp } from '../src/lib/go/coords';
import { PASS, type Loc } from '../src/lib/go/types';
import { startKataGo } from './katagoAnalysis';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const SIZE = 19;
const KOMI = 7.5;
const count = Number(process.argv[2] ?? 40);
const deep = Number(process.argv[3] ?? 3200);
const light = Number(process.argv[4] ?? 100);
const binary = process.env.KATAGO ?? 'katago';
const model = path.join(root, 'public/models/g170e-b10c128-s1141046784-d204142634.bin.gz');

interface DemoGame {
  id: string;
  moves: { color: 1 | 2; loc: Loc }[];
  setup: unknown[];
}

const demo = JSON.parse(readFileSync(path.join(root, 'public/demo/demo.json'), 'utf8')) as { games: DemoGame[] };
const games = demo.games.filter((g) => !g.setup?.length && g.moves.length > 60);

// Spread over the games and over the game: openings, middle games, endgames.
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const picks: { game: DemoGame; turn: number }[] = [];
for (let i = 0; i < count; i++) {
  const game = games[i % games.length];
  const phase = i % 3;
  const n = game.moves.length;
  const lo = phase === 0 ? 8 : phase === 1 ? Math.floor(n * 0.3) : Math.floor(n * 0.7);
  const hi = phase === 0 ? 40 : phase === 1 ? Math.floor(n * 0.6) : n - 4;
  picks.push({ game, turn: lo + Math.floor(rand() * Math.max(1, hi - lo)) });
}

const gtp = (l: Loc) => (l === PASS ? 'pass' : locToGtp(l, SIZE));
const fromGtp = (s: string) => (s.toLowerCase() === 'pass' ? PASS : gtpToLoc(s, SIZE));

const kg = startKataGo({ binary, model, threads: 4 });
const partial = path.join(root, '.engine-reference.partial.jsonl');
writeFileSync(partial, '');
const top = (r: { moveInfos: { order: number; move: string; visits: number; winrate: number; scoreLead: number }[] }) =>
  [...r.moveInfos]
    .sort((a, b) => a.order - b.order)
    .slice(0, 5)
    .map((m) => ({ loc: fromGtp(m.move), visits: m.visits, winrate: m.winrate, scoreLead: m.scoreLead }));
let finished = 0;
const t0 = Date.now();
// All queries at once: KataGo works on one per analysis thread.
const out = await Promise.all(
  picks.map(async (p) => {
    const moves = p.game.moves.slice(0, p.turn);
    const q = {
      moves: moves.map((m) => [m.color === 1 ? 'B' : 'W', gtp(m.loc)] as [string, string]),
      komi: KOMI,
      rules: 'chinese',
      initialPlayer: 'B' as const,
    };
    const [d, l] = await Promise.all([kg.query({ ...q, maxVisits: deep }), kg.query({ ...q, maxVisits: light })]);
    const row = {
      game: p.game.id,
      turn: p.turn,
      moves: moves.map((m) => [m.color, m.loc]),
      toPlay: moves.length % 2 === 0 ? 1 : 2,
      komi: KOMI,
      /** Black's winrate and score lead. */
      ref: { visits: d.rootInfo.visits, winrate: d.rootInfo.winrate, scoreLead: d.rootInfo.scoreLead, top: top(d) },
      katago: { visits: l.rootInfo.visits, winrate: l.rootInfo.winrate, scoreLead: l.rootInfo.scoreLead, top: top(l) },
    };
    // Written as it goes, so a long run that is cut off keeps what it finished.
    appendFileSync(partial, JSON.stringify(row) + '\n');
    process.stdout.write(`\r${++finished}/${picks.length} positions (${Math.round((Date.now() - t0) / 1000)} s)`);
    return row;
  }),
);
await kg.close();
writeFileSync(
  path.join(root, 'public/engine/bench-positions.json'),
  JSON.stringify({ engine: 'KataGo v1.16.4 (native, unmodified)', network: 'g170e-b10c128', rules: 'chinese', deepVisits: deep, lightVisits: light, positions: out }),
);
console.log(`\nwrote ${out.length} positions`);
