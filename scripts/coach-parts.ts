/**
 * Adds one coach training run's measurements to the corpus, keeping only well-formed rows,
 * so one bad line can never stop the daily refit (coach-training.yml, "learn").
 *
 *   npx tsx scripts/coach-parts.ts --parts parts --corpus corpus
 *
 * parts/rank-*.jsonl go to corpus/rank.jsonl and parts/moves-*.jsonl to corpus/moves.jsonl.
 * A row is kept when it is a "skipped" note (it stops the game being measured again) or has
 * every field the fits read, with real numbers. A line cut off when a measuring machine was
 * stopped is dropped. Drops are counted and shown as a warning on the run.
 */
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const partsDir = arg('parts') ?? 'parts';
const corpusDir = arg('corpus') ?? 'corpus';

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const allNums = (o: unknown) => isObj(o) && Object.values(o).every(isNum);

/** Why a level row can't be used, or null when it can. */
export function rankProblem(r: unknown): string | null {
  if (!isObj(r)) return 'not an object';
  if (typeof r.file !== 'string' || !r.file) return 'no file';
  if (r.skipped !== undefined) return null;
  if (r.color !== 1 && r.color !== 2) return 'bad color';
  if (!isNum(r.rank)) return 'bad rank';
  if (!allNums(r.all) || !((r.all as { n: number }).n > 0)) return 'bad whole-game numbers';
  if (!isObj(r.phases) || !Object.values(r.phases).every(allNums)) return 'bad phase numbers';
  if (!isObj(r.signatures) || !Object.values(r.signatures).every((s) => Array.isArray(s) && s.length === 2 && s.every(isNum))) return 'bad signatures';
  return null;
}

/** Why a move-difficulty row can't be used, or null when it can. */
export function moveProblem(j: unknown): string | null {
  if (!isObj(j)) return 'not an object';
  if (typeof j.file !== 'string' || !j.file) return 'no file';
  if (j.skipped !== undefined) return null;
  if (!isNum(j.rank) || !isNum(j.played) || !isNum(j.move)) return 'bad rank, move or played';
  if (!Array.isArray(j.c) || !j.c.length || !j.c.every((c) => Array.isArray(c) && c.length >= 4 && c.every(isNum))) return 'bad choices';
  return null;
}

function add(prefix: string, out: string, problem: (x: unknown) => string | null) {
  const files = existsSync(partsDir) ? readdirSync(partsDir).filter((f) => f.startsWith(prefix) && f.endsWith('.jsonl')) : [];
  const drops = new Map<string, number>();
  let kept = 0;
  const lines: string[] = [];
  for (const f of files)
    for (const l of readFileSync(path.join(partsDir, f), 'utf8').split('\n')) {
      if (!l.trim()) continue;
      let why: string | null;
      try {
        why = problem(JSON.parse(l));
      } catch {
        why = 'cut-off line';
      }
      if (why) drops.set(why, (drops.get(why) ?? 0) + 1);
      else {
        lines.push(l);
        kept++;
      }
    }
  if (lines.length) appendFileSync(path.join(corpusDir, out), lines.join('\n') + '\n');
  const dropped = [...drops.values()].reduce((a, b) => a + b, 0);
  console.log(`${out}: ${kept} rows added from ${files.length} files, ${dropped} dropped`);
  // A cut-off last line is normal (a machine stopped mid-write); anything else is worth a look.
  const odd = [...drops].filter(([why]) => why !== 'cut-off line');
  if (odd.length) console.log(`::warning title=Coach training::${out}: dropped ${odd.map(([w, n]) => `${n} (${w})`).join(', ')}`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  add('rank-', 'rank.jsonl', rankProblem);
  add('moves-', 'moves.jsonl', moveProblem);
}
