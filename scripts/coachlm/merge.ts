/**
 * Joins task files for .github/workflows/coach-lm.yml:
 *
 *   npx tsx scripts/coachlm/merge.ts --split train --out tasks.jsonl.gz old.jsonl.gz new-1.jsonl ...
 *
 * Keeps the first line per id, in order, and only tasks of --split (so a test-set task can
 * never land in the training file). Missing inputs count as empty. Prints the counts.
 */
import { parseArgs } from 'node:util';
import { readJsonl, writeJsonl, type Task } from './tasks';

const { values: arg, positionals: files } = parseArgs({ allowPositionals: true, options: { split: { type: 'string' }, out: { type: 'string' } } });
if (!arg.out || (arg.split !== 'train' && arg.split !== 'eval')) throw new Error('usage: merge.ts --split train|eval --out out.jsonl.gz files...');

const seen = new Set<string>();
const rows: Task[] = [];
let dup = 0;
let wrong = 0;
for (const f of files) {
  for (const t of readJsonl<Task>(f)) {
    if (!t || typeof t.id !== 'string' || typeof t.prompt !== 'string' || typeof t.reference !== 'string' || t.split !== arg.split) {
      wrong++;
      continue;
    }
    if (seen.has(t.id)) {
      dup++;
      continue;
    }
    seen.add(t.id);
    rows.push(t);
  }
}
writeJsonl(arg.out, rows);
const v = new Map<number, number>();
for (const t of rows) v.set(t.promptVersion, (v.get(t.promptVersion) ?? 0) + 1);
console.log(`merge: ${rows.length} ${arg.split} tasks in ${arg.out} (${dup} duplicates, ${wrong} wrong split or malformed dropped); by prompt version ${JSON.stringify(Object.fromEntries(v))}`);
