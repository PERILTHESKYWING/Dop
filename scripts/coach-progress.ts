/**
 * Append today's coach training numbers to public/coach/progress.json (shown on the
 * dashboard): how much the coach has measured and how accurate its models are.
 *
 *   npx tsx scripts/coach-progress.ts --run 12
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CoachProgress } from '../src/lib/coach/progress';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '..', 'public');
const args = process.argv.slice(2);
const run = Number(args[args.indexOf('--run') + 1] ?? 0) || 0;

const cal = JSON.parse(readFileSync(path.join(pub, 'level', 'calibration.json'), 'utf8'));
const diff = JSON.parse(readFileSync(path.join(pub, 'coach', 'difficulty.json'), 'utf8'));
const file = path.join(pub, 'coach', 'progress.json');
const prog: CoachProgress = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1, entries: [] };
prog.entries.push({
  at: new Date().toISOString(),
  run,
  rankGames: cal.games,
  rankError1: cal.maeByGames?.['1'] ?? null,
  rankError10: cal.maeByGames?.['10'] ?? null,
  positions: diff.positions,
  calibrationGap: diff.heldOut?.calibrationGap ?? null,
});
prog.entries = prog.entries.slice(-400);
writeFileSync(file, JSON.stringify(prog, null, 1));
console.log(prog.entries[prog.entries.length - 1]);
