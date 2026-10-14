/**
 * Test data for the Doppelgänger copy (scripts/doppel-eval.ts): one player's games,
 * analysed with the bundled network the way the app reads a position in a game against
 * the copy. For each of the player's moves it keeps KataGo's policy, ownership and
 * winrate, and what each of KataGo's top candidates (and the move played) loses by the
 * network's look at the position after it.
 *
 *   npx tsx scripts/doppel-data.ts --list games.txt --player NAME --out data.jsonl [--part 0 --parts 4] [--max 80]
 *
 * `games.txt` holds one SGF path per line. Resumable: games already in the output are skipped.
 * Nothing it writes is shipped; the games stay wherever they were downloaded.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNodeEngine } from './nodeEngine';
import { parseSgfFile } from '../src/lib/go/sgf';
import { gameFromParsed } from '../src/lib/games';
import { analyzeGame, MemoryStore } from '../src/lib/analysis/pipeline';
import { evaluateFast } from '../src/lib/analysis/analyzer';
import { allPositions } from '../src/lib/go/board';
import { engineKomi } from '../src/lib/go/rules';
import { PASS, other } from '../src/lib/go/types';
import { WINRATE_FROM_SCORE } from '../src/lib/engine/models';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const MODEL = path.join(here, '..', 'public', 'models', 'g170e-b10c128-s1141046784-d204142634.bin.gz');
const CANDS = 10;

async function main() {
  const player = arg('player')!;
  const out = arg('out')!;
  const part = Number(arg('part', '0'));
  const parts = Number(arg('parts', '1'));
  const max = Number(arg('max', '1000000'));
  mkdirSync(path.dirname(out), { recursive: true });
  const done = new Set<string>();
  if (existsSync(out))
    for (const l of readFileSync(out, 'utf8').split('\n'))
      try {
        if (l) done.add(JSON.parse(l).file);
      } catch {
        /* cut-off line */
      }
  const files = readFileSync(arg('list')!, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, max);
  const mine = files.filter((_, i) => i % parts === part).filter((f) => !done.has(path.basename(f)));
  const engine = await loadNodeEngine(MODEL, 'g170e-b10c128', 19, 1, WINRATE_FROM_SCORE);
  let k = 0;
  for (const f of mine) {
    const file = path.basename(f);
    const t0 = Date.now();
    try {
      const parsed = parseSgfFile(readFileSync(f, 'utf8')).games[0];
      if (!parsed || parsed.size !== 19) throw new Error('not 19x19');
      const color = parsed.black === player ? 1 : parsed.white === player ? 2 : null;
      if (!color) throw new Error('player not in game');
      const game = gameFromParsed(parsed, file, 'opponent', []);
      if (game.moves.length < 40) throw new Error('short game');
      const analysis = await analyzeGame(game, engine, new MemoryStore(), { visits: 0 });
      const komi = engineKomi(game.komi, game.rules);
      const boards = allPositions(game.size, game.setup, game.moves);
      const positions = [];
      for (let i = 0; i < game.moves.length; i++) {
        const m = game.moves[i];
        if (m.color !== color || m.loc === PASS) continue;
        const ev = analysis.evals[i];
        if (!ev) continue;
        const board = boards[i];
        const cands = ev.policy.filter((e) => e.loc !== PASS && board.isLegal(e.loc, color)).slice(0, CANDS).map((e) => e.loc);
        if (!cands.includes(m.loc) && board.isLegal(m.loc, color)) cands.push(m.loc);
        const history = game.moves.slice(0, i);
        const leads: [number, number][] = [];
        for (const loc of cands) {
          const after = board.clone();
          after.play(loc, color);
          const e = await evaluateFast(engine, { size: game.size, komi, setup: game.setup, history: [...history, { color, loc }], toPlay: other(color), board: after });
          leads.push([loc, color === 1 ? e.bLead : -e.bLead]);
        }
        const best = Math.max(...leads.map((x) => x[1]));
        positions.push({
          i,
          pol: ev.policy.slice(0, 24).map((e) => [e.loc, +e.p.toFixed(5)]),
          own: ev.ownership,
          bWin: +ev.bWin.toFixed(4),
          bLead: +ev.bLead.toFixed(2),
          loss: leads.map(([loc, lead]) => [loc, +(best - lead).toFixed(2)]),
        });
      }
      appendFileSync(out, JSON.stringify({ file, color, size: game.size, komi: game.komi, rules: game.rules, setup: game.setup, moves: game.moves, positions }) + '\n');
    } catch (e) {
      appendFileSync(out, JSON.stringify({ file, skipped: String((e as Error).message ?? e) }) + '\n');
    }
    k++;
    console.log(`part ${part}: ${k}/${mine.length} ${file} ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
