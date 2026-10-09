/**
 * Pick rank-labelled Fox games for the coach's corpora: 19x19, even (or no-komi) games of
 * 100+ moves whose players both have a readable rank, at most `--per-rank` games per rank,
 * skipping games already measured. Used by .github/workflows/coach-training.yml.
 * `--newest` takes the newest games first (Fox file names start with the game's Unix
 * time) instead of a random sample.
 *
 *   npx tsx scripts/coach-pick.ts --dir extracted/ --per-rank 40 --seen seen.txt --seed 7 [--newest] --out list.txt
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseRank } from '../src/lib/level/ranks';

const args = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (n.toLowerCase().endsWith('.sgf')) out.push(p);
  }
  return out;
}

/** A small seeded generator, so a run's picks can be reproduced. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 2 ** 32;
  };
}

const perRank = Number(arg('per-rank', '40'));
const seen = new Set(existsSync(arg('seen', '') ?? '') ? readFileSync(arg('seen')!, 'utf8').split('\n').filter(Boolean) : []);
const files = walk(arg('dir')!);
const r = rng(Number(arg('seed', '1')));
if (args.includes('--newest')) files.sort((a, b) => path.basename(b).localeCompare(path.basename(a)));
else
  for (let i = files.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [files[i], files[j]] = [files[j], files[i]];
  }
const count = new Map<number, number>();
const kept: string[] = [];
for (const f of files) {
  if (seen.has(path.basename(f))) continue;
  const head = readFileSync(f, 'utf8').slice(0, 1200);
  const tag = (k: string) => head.match(new RegExp(`\\b${k}\\[([^\\]]*)\\]`))?.[1];
  if ((tag('SZ') ?? '19') !== '19' || !['0', '1', undefined].includes(tag('HA'))) continue;
  const b = parseRank(tag('BR') ?? ''), w = parseRank(tag('WR') ?? '');
  if (b === null || w === null || b > 9 || w > 9) continue;
  if ((count.get(b) ?? 0) >= perRank && (count.get(w) ?? 0) >= perRank) continue;
  const moves = readFileSync(f, 'utf8').match(/;[BW]\[/g)?.length ?? 0;
  if (moves < 100) continue;
  count.set(b, (count.get(b) ?? 0) + 1);
  count.set(w, (count.get(w) ?? 0) + 1);
  kept.push(f);
}
writeFileSync(arg('out')!, kept.join('\n') + '\n');
console.log(`${kept.length} games picked from ${files.length}`, [...count].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' '));
