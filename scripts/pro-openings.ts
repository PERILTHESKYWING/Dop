/**
 * Pro game explorer (src/lib/coach/pro.ts): count the whole-board positions professionals
 * reached in their first moves and what they played, from the professional collection of
 * github.com/yenw/computer-go-dataset (one SGF per line).
 *
 *   npx tsx scripts/pro-openings.ts pro1940-1999.txt pro2000+.txt
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSgfFile } from '../src/lib/go/sgf';
import { allPositions } from '../src/lib/go/board';
import { canonicalMove, canonicalPosition, type ProExplorer } from '../src/lib/coach/pro';
import { PASS } from '../src/lib/go/types';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Moves into the game that are looked up (whole-board matches rarely go further). */
const MAX_MOVE = 40;
/** Positions reached fewer times than this are left out. */
const MIN_POSITION = 5;
const MIN_MOVE = 2;

const counts = new Map<string, { n: number; m: Map<number, [number, number]> }>();
let games = 0;
for (const file of process.argv.slice(2)) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.startsWith('(')) continue;
    const g = parseSgfFile(line).games[0];
    if (!g || g.size !== 19 || g.setup.length || g.handicap > 1 || g.moves.length < 30) continue;
    const winner = /^B\+/i.test(g.result ?? '') ? 1 : /^W\+/i.test(g.result ?? '') ? 2 : 0;
    games++;
    const boards = allPositions(19, [], g.moves.slice(0, MAX_MOVE));
    for (let i = 0; i < Math.min(MAX_MOVE, g.moves.length); i++) {
      const mv = g.moves[i];
      if (mv.loc === PASS) break;
      const c = canonicalPosition(boards[i].stones, mv.color, 19);
      const row = counts.get(c.key) ?? { n: 0, m: new Map() };
      counts.set(c.key, row);
      row.n++;
      const cm = canonicalMove(c, mv.loc, 19);
      const cell = row.m.get(cm) ?? [0, 0];
      cell[0]++;
      if (winner === mv.color) cell[1]++;
      row.m.set(cm, cell);
    }
    if (games % 5000 === 0) console.log(games, counts.size);
  }
}

const out: ProExplorer = {
  version: 1,
  source: 'github.com/yenw/computer-go-dataset (professional games, 1940 to 2017)',
  games,
  maxMove: MAX_MOVE,
  positions: {},
};
for (const [key, row] of counts) {
  if (row.n < MIN_POSITION) continue;
  const m = [...row.m]
    .filter(([, [c]]) => c >= MIN_MOVE)
    .sort((a, b) => b[1][0] - a[1][0])
    .slice(0, 8)
    .map(([loc, [c, w]]) => [loc, c, w] as [number, number, number]);
  if (m.length) out.positions[key] = { n: row.n, m };
}
const dest = path.join(here, '..', 'public', 'pro', 'openings.json');
mkdirSync(path.dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(out));
console.log(`${games} games, ${Object.keys(out.positions).length} positions kept, ${(JSON.stringify(out).length / 1e6).toFixed(1)} MB`);
