/**
 * Pick this machine's share of the recent OGS games (from scripts/ogs-recent.py) not
 * measured yet, newest first, at most --per-rank game sides per rank. Output is the
 * same JSON lines, for scripts/rank-corpus.ts --jsonl. Used by
 * .github/workflows/coach-training.yml.
 *
 *   npx tsx scripts/ogs-pick.ts --jsonl ogs-recent.jsonl --seen seen.txt --part 0 --parts 8 --per-rank 130 --out ogs.jsonl
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { hashString } from '../src/lib/util/hash';

const args = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};

interface Game {
  file: string;
  b: number;
  w: number;
  date: string;
}

const seen = new Set(existsSync(arg('seen', '') ?? '') ? readFileSync(arg('seen')!, 'utf8').split('\n').filter(Boolean) : []);
const part = Number(arg('part', '0'));
const parts = Number(arg('parts', '1'));
const perRank = Number(arg('per-rank', '130'));
const lines = readFileSync(arg('jsonl')!, 'utf8').split('\n').filter(Boolean);
const games = lines
  .map((l) => ({ l, g: JSON.parse(l) as Game }))
  .filter(({ g }) => !seen.has(g.file) && parseInt(hashString(g.file).slice(0, 8), 16) % parts === part)
  .sort((a, b) => b.g.date.localeCompare(a.g.date));
const count = new Map<number, number>();
const kept: string[] = [];
for (const { l, g } of games) {
  if ((count.get(g.b) ?? 0) >= perRank && (count.get(g.w) ?? 0) >= perRank) continue;
  for (const r of [g.b, g.w]) count.set(r, (count.get(r) ?? 0) + 1);
  kept.push(l);
}
writeFileSync(arg('out')!, kept.join('\n') + '\n');
console.log(
  `${kept.length} OGS games picked from ${games.length} unmeasured (of ${lines.length}), newest ${games[0]?.g.date ?? '-'}:`,
  [...count].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' '),
);
