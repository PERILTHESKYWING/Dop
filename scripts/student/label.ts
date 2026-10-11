/**
 * Teacher labels for the student network: positions sampled from real games, each looked at
 * by native KataGo with a strong network, written as fixed 840-byte `.dpd` records
 * (scripts/student/README.md).
 *
 *   --visits 1     the teacher network's own output (policy, value, lead, ownership)
 *   --visits 400   the teacher's search: visit shares as the policy target, the searched
 *                  value and lead ("search inside the network": the student learns to say in
 *                  one look what the search found)
 *
 *   npx tsx scripts/student/label.ts --katago kg/katago --model b18.bin.gz \
 *     (--lines pro.txt | --sgf-dir fox/) --source pro|amateur|ai --per-game 6 --visits 1 \
 *     [--shard 0 --shards 8] [--minutes 300] [--threads 4] [--seed 1] --out labels.dpd
 */
import { appendFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { startKataGo, type KgResult } from '../katagoAnalysis';
import { parseSgfFile, type ParsedGame } from '../../src/lib/go/sgf';
import { gtpToLoc, locToGtp } from '../../src/lib/go/coords';
import { PASS, type Loc } from '../../src/lib/go/types';
import { engineKomi } from '../../src/lib/go/rules';
import { encodeMoves } from '../../src/lib/student/encode';

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 ? argv[i + 1] : d;
};

export const RECORD = 840;
const SIZE = 19;
const SOURCE: Record<string, number> = { pro: 1, amateur: 2, ai: 3 };

function* sgfFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* sgfFiles(p);
    else if (/\.sgf$/i.test(name)) yield p;
  }
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
}

/** One record (README.md, `.dpd`). */
export function record(board: Uint8Array, toPlay: 1 | 2, source: number, komi: number, r: KgResult, visits: number): Buffer {
  const buf = Buffer.alloc(RECORD);
  buf.set(board, 0);
  buf[361] = toPlay;
  buf[362] = source;
  buf.writeFloatLE(komi, 364);
  const black = toPlay === 1;
  buf.writeFloatLE(black ? r.rootInfo.winrate : 1 - r.rootInfo.winrate, 368);
  buf.writeFloatLE(black ? r.rootInfo.scoreLead : -r.rootInfo.scoreLead, 372);
  buf.writeUInt32LE(visits, 376);
  // Policy target: the raw policy at one visit, the visit shares of a search.
  let pol: [number, number][] = [];
  if (visits <= 1 && r.policy) {
    pol = r.policy.map((p, i) => [i === SIZE * SIZE ? 361 : i, p] as [number, number]).filter(([, p]) => p > 0);
  } else {
    const total = r.moveInfos.reduce((a, m) => a + m.visits, 0) || 1;
    pol = r.moveInfos.map((m) => [m.move.toLowerCase() === 'pass' ? 361 : gtpToLoc(m.move, SIZE), m.visits / total] as [number, number]);
  }
  pol.sort((a, b) => b[1] - a[1]);
  pol = pol.slice(0, 24);
  for (let k = 0; k < 24; k++) {
    const [loc, p] = pol[k] ?? [65535, 0];
    buf.writeUInt16LE(loc, 380 + k * 4);
    buf.writeUInt16LE(Math.round(Math.min(1, p) * 65535), 382 + k * 4);
  }
  if (r.ownership?.length === SIZE * SIZE) {
    for (let i = 0; i < SIZE * SIZE; i++) buf.writeInt8(Math.round(Math.max(-1, Math.min(1, black ? r.ownership[i] : -r.ownership[i])) * 127), 476 + i);
    buf[837] = 1;
  }
  return buf;
}

async function main() {
  const visits = Number(arg('visits', '1'));
  const perGame = Number(arg('per-game', '6'));
  const shard = Number(arg('shard', '0'));
  const shards = Number(arg('shards', '1'));
  const minutes = Number(arg('minutes', '0'));
  const threads = Number(arg('threads', '4'));
  const source = SOURCE[arg('source', 'pro')!] ?? 1;
  const out = arg('out')!;
  const rand = rng(Number(arg('seed', '1')) * 7919 + shard);
  const deadline = minutes > 0 ? Date.now() + minutes * 60_000 : Infinity;

  // Games: one SGF per line, or a folder of SGF files; this shard takes every shards-th.
  const items: string[] = [];
  if (arg('lines')) items.push(...readFileSync(arg('lines')!, 'utf8').split('\n').filter((l) => l.startsWith('(')));
  if (arg('sgf-dir')) items.push(...sgfFiles(arg('sgf-dir')!));
  const mine = items.filter((_, i) => i % shards === shard);
  // Shuffle so a run cut short by --minutes still covers every era and rank.
  for (let i = mine.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [mine[i], mine[j]] = [mine[j], mine[i]];
  }
  console.log(`${items.length} games, this shard ${mine.length}; ${perGame} positions each at ${visits} visit${visits > 1 ? 's' : ''}`);

  const kg = startKataGo({
    binary: arg('katago')!,
    model: arg('model')!,
    threads,
    oneSymmetry: visits <= 1,
  });
  const gtp = (l: Loc) => (l === PASS ? 'pass' : locToGtp(l, SIZE));
  let written = 0;
  let games = 0;
  const t0 = Date.now();
  const inFlight = new Set<Promise<void>>();
  const maxInFlight = Math.max(2, threads * 2);

  const one = async (item: string) => {
    let g: ParsedGame | undefined;
    try {
      g = parseSgfFile(item.startsWith('(') ? item : readFileSync(item, 'utf8')).games[0];
    } catch {
      return;
    }
    if (!g || g.size !== SIZE || g.moves.length < 20) return;
    const komi = Math.abs(g.komi) <= 30 ? engineKomi(g.komi, g.rules) : 7.5;
    const n = g.moves.length;
    const turns = new Set<number>();
    for (let k = 0; k < perGame * 3 && turns.size < perGame; k++) {
      // Few opening positions (the opening book covers them), the rest uniform.
      const t = rand() < 0.1 ? Math.floor(rand() * 6) : 6 + Math.floor(rand() * Math.max(1, n - 6));
      if (t < n) turns.add(t);
    }
    const setup = g.setup.filter((m) => m.loc !== PASS);
    let rs: KgResult[];
    try {
      rs = await kg.queryTurns({
        initialStones: setup.map((m) => [m.color === 1 ? 'B' : 'W', gtp(m.loc)] as [string, string]),
        moves: g.moves.map((m) => [m.color === 1 ? 'B' : 'W', gtp(m.loc)] as [string, string]),
        komi,
        rules: 'chinese',
        boardXSize: SIZE,
        boardYSize: SIZE,
        maxVisits: visits,
        includePolicy: true,
        includeOwnership: true,
        analyzeTurns: [...turns].sort((a, b) => a - b),
      });
    } catch {
      return;
    }
    const bufs: Buffer[] = [];
    for (const r of rs) {
      const t = r.turnNumber;
      const toPlay = r.rootInfo.currentPlayer === 'B' ? 1 : 2;
      bufs.push(record(encodeMoves(g.moves.slice(0, t), setup), toPlay, source, komi, r, visits));
    }
    if (bufs.length) appendFileSync(out, Buffer.concat(bufs));
    written += bufs.length;
    games++;
  };

  const progress = setInterval(() => {
    const min = (Date.now() - t0) / 60000;
    console.log(`${games} games, ${written} positions (${(written / min).toFixed(0)}/min)`);
  }, 60_000);
  for (const item of mine) {
    if (Date.now() > deadline) break;
    const p = one(item).finally(() => inFlight.delete(p));
    inFlight.add(p);
    if (inFlight.size >= maxInFlight) await Promise.race(inFlight);
  }
  await Promise.all(inFlight);
  clearInterval(progress);
  await kg.close();
  const min = (Date.now() - t0) / 60000;
  console.log(`done: ${games} games, ${written} positions in ${min.toFixed(1)} min -> ${out}`);
}

if (process.argv[1] && /label\.ts$/.test(process.argv[1])) void main();
