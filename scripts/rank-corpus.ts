/**
 * Rank calibration corpus: analyse rank-labelled games with the bundled network (the
 * network pass the app runs first) and write one line per player per game with the
 * level statistics the app measures (src/lib/level/stats.ts).
 *
 *   npx tsx scripts/rank-corpus.ts --list files.txt --part 0 --parts 4 --out corpus/part-0.jsonl
 *
 * `files.txt` holds one SGF path per line. Ranks come from the SGF's BR/WR (Fox writes
 * them as 3级 / 5段). Resumable: games already in the output file are skipped.
 * The fitted calibration is made by scripts/rank-fit.ts.
 */
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNodeEngine } from './nodeEngine';
import { parseSgfFile } from '../src/lib/go/sgf';
import { gameFromParsed } from '../src/lib/games';
import { analyzeGame, MemoryStore } from '../src/lib/analysis/pipeline';
import { networkRecords, gameLevelSample } from '../src/lib/level/stats';
import { parseRank } from '../src/lib/level/ranks';
import { WINRATE_FROM_SCORE } from '../src/lib/engine/models';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};

const MODEL = path.join(here, '..', 'public', 'models', 'g170e-b10c128-s1141046784-d204142634.bin.gz');
export const CORPUS_MODEL_ID = 'g170e-b10c128';

async function main() {
  const files = readFileSync(arg('list')!, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  const part = Number(arg('part', '0'));
  const parts = Number(arg('parts', '1'));
  const out = arg('out')!;
  mkdirSync(path.dirname(out), { recursive: true });
  const done = new Set<string>();
  if (existsSync(out))
    for (const l of readFileSync(out, 'utf8').split('\n')) {
      try {
        if (l) done.add(JSON.parse(l).file);
      } catch {
        /* a line cut off by a stopped run */
      }
    }
  const mine = files.filter((_, i) => i % parts === part).filter((f) => !done.has(path.basename(f)));
  const engine = await loadNodeEngine(MODEL, CORPUS_MODEL_ID, 19, 1, WINRATE_FROM_SCORE);
  let k = 0;
  for (const file of mine) {
    const t0 = Date.now();
    try {
      const parsed = parseSgfFile(readFileSync(file, 'utf8')).games[0];
      if (!parsed || parsed.size !== 19) throw new Error('not a 19x19 game');
      const game = gameFromParsed(parsed, path.basename(file), 'opponent', []);
      game.playerColor = null;
      const store = new MemoryStore();
      const analysis = await analyzeGame(game, engine, store, { visits: 0 });
      const records = networkRecords(game, analysis);
      const lines: string[] = [];
      for (const color of [1, 2] as const) {
        const rank = parseRank(color === 1 ? parsed.blackRank : parsed.whiteRank);
        const sample = gameLevelSample(records, color);
        if (rank === null || !sample) continue;
        lines.push(JSON.stringify({ file: path.basename(file), color, rank, handicap: parsed.handicap, moves: game.moves.length, ...sample }));
      }
      if (!lines.length) lines.push(JSON.stringify({ file: path.basename(file), skipped: 'no ranks' }));
      appendFileSync(out, lines.join('\n') + '\n');
    } catch (e) {
      appendFileSync(out, JSON.stringify({ file: path.basename(file), skipped: String((e as Error).message ?? e) }) + '\n');
    }
    k++;
    if (k % 10 === 0) console.log(`part ${part}: ${k}/${mine.length} (${((Date.now() - t0) / 1000).toFixed(1)} s last game)`);
  }
  console.log(`part ${part}: done`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
