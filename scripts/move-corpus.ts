/**
 * Move-difficulty corpus: for sampled positions from rank-labelled games, the choices the
 * position offered (src/lib/coach/choices.ts: the network's most natural moves plus the
 * move played, each with its prior and its cost) and which one the player chose. Fitted by
 * scripts/move-fit.ts into how often players of each rank find a given kind of move.
 *
 *   npx tsx scripts/move-corpus.ts --list files.txt --part 0 --parts 4 --out moves/part-0.jsonl
 *   npx tsx scripts/move-corpus.ts --sgf-lines pro.txt --rank pro --limit 200 ...
 *
 * `--list` holds one SGF path per line (ranks from BR/WR); `--sgf-lines` holds one SGF
 * game per line (the yenw/computer-go-dataset professional collection) and `--rank` gives
 * their rank. Resumable: games already in the output are skipped.
 */
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNodeEngine } from './nodeEngine';
import { parseSgfFile } from '../src/lib/go/sgf';
import { gameFromParsed } from '../src/lib/games';
import { allPositions } from '../src/lib/go/board';
import { toPlayAt } from '../src/lib/analysis/analyzer';
import { engineKomi } from '../src/lib/go/rules';
import { positionChoices } from '../src/lib/coach/choices';
import { parseRank } from '../src/lib/level/ranks';
import { WINRATE_FROM_SCORE } from '../src/lib/engine/models';
import { PASS } from '../src/lib/go/types';
import { hashString } from '../src/lib/util/hash';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};

const MODEL = path.join(here, '..', 'public', 'models', 'g170e-b10c128-s1141046784-d204142634.bin.gz');
/** Positions sampled per game (spread over the whole game). */
const PER_GAME = Number(arg('per-game', '24'));
const DECIDED = 0.03;

async function main() {
  const part = Number(arg('part', '0'));
  const parts = Number(arg('parts', '1'));
  const limit = Number(arg('limit', '1e9'));
  const out = arg('out')!;
  const fixedRank = arg('rank') ? parseRank(arg('rank')!) : null;
  const sources: { id: string; sgf: () => string }[] = arg('sgf-lines')
    ? readFileSync(arg('sgf-lines')!, 'utf8')
        .split('\n')
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => l.startsWith('('))
        .map(({ l, i }) => ({ id: `${path.basename(arg('sgf-lines')!)}:${i}`, sgf: () => l }))
    : readFileSync(arg('list')!, 'utf8')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((f) => ({ id: f, sgf: () => readFileSync(f, 'utf8') }));
  mkdirSync(path.dirname(out), { recursive: true });
  const done = new Set<string>();
  if (existsSync(out)) for (const l of readFileSync(out, 'utf8').split('\n')) if (l) done.add(JSON.parse(l).file);
  const mine = sources.slice(0, limit).filter((_, i) => i % parts === part).filter((s) => !done.has(s.id));
  const engine = await loadNodeEngine(MODEL, 'g170e-b10c128', 19, 1, WINRATE_FROM_SCORE);
  let k = 0;
  for (const src of mine) {
    const t0 = Date.now();
    const lines: string[] = [];
    try {
      const parsed = parseSgfFile(src.sgf()).games[0];
      if (!parsed || parsed.size !== 19) throw new Error('not a 19x19 game');
      if (parsed.handicap > 1) throw new Error('handicap game');
      const game = gameFromParsed(parsed, 'x.sgf', 'opponent', []);
      const n = game.moves.length;
      if (n < 60) throw new Error('short game');
      const boards = allPositions(game.size, game.setup, game.moves);
      const komi = engineKomi(game.komi, game.rules);
      const ranks = { 1: fixedRank ?? parseRank(parsed.blackRank), 2: fixedRank ?? parseRank(parsed.whiteRank) };
      const last = Math.min(n - 1, 280);
      // A spread of positions, offset per game so different games cover different move numbers.
      const off = parseInt(hashString(src.id).slice(0, 6), 16) % 7 || 0;
      const idx = [...new Set(Array.from({ length: PER_GAME }, (_, j) => Math.round(4 + off + (j * (last - 4 - off)) / PER_GAME)))];
      for (const i of idx) {
        const move = game.moves[i];
        if (!move || move.loc === PASS) continue;
        const rank = ranks[move.color];
        if (rank === null) continue;
        const toPlay = toPlayAt(game.setup, game.moves, i, game.handicap);
        const pc = await positionChoices(engine, { size: 19, komi, setup: game.setup, history: game.moves.slice(0, i), toPlay, board: boards[i] }, [move.loc]);
        if (pc.win < DECIDED || pc.win > 1 - DECIDED) continue;
        const played = pc.choices.findIndex((c) => c.loc === move.loc);
        if (played < 0) continue;
        lines.push(
          JSON.stringify({
            file: src.id,
            rank,
            move: i,
            win: +pc.win.toFixed(3),
            played,
            c: pc.choices.map((c) => [c.loc, +c.prior.toPrecision(3), +c.loss.toFixed(2), +c.winLoss.toFixed(3)]),
          }),
        );
      }
      if (!lines.length) lines.push(JSON.stringify({ file: src.id, skipped: 'no positions' }));
    } catch (e) {
      lines.push(JSON.stringify({ file: src.id, skipped: String((e as Error).message ?? e) }));
    }
    appendFileSync(out, lines.join('\n') + '\n');
    k++;
    if (k % 5 === 0) console.log(`part ${part}: ${k}/${mine.length} (${((Date.now() - t0) / 1000).toFixed(1)} s last game)`);
  }
  console.log(`part ${part}: done`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
