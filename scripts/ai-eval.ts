/**
 * Measures the AI ideas against a stronger reference, on real positions:
 *
 *   ref        reference answers: a deep native KataGo search with a strong network on
 *              positions from professional and amateur games (all phases)
 *   anchors    "big brain at the top, small brain below": the small network searching
 *              alone, the same search with the big network judging the top of the tree,
 *              and the big network searching alone, scored against the reference
 *   selective  "search only what matters": a whole-game review with every position given
 *              the same visits, against the tiered budgets (pipeline.ts searchTier); the
 *              network evaluations each costs and how often the two agree on each move's verdict
 *   student    a trained student network (scripts/student/) against the network it replaces
 *
 *   npx tsx scripts/ai-eval.ts ref --katago kg/katago --model big.bin.gz --network b20 --lines pro.txt --count 40 --visits 1000 --out ref.json
 *   npx tsx scripts/ai-eval.ts anchors --katago kg/katago --ref ref.json --small b6.bin.gz --big b10.bin.gz --visits 100
 *   npx tsx scripts/ai-eval.ts selective --katago kg/katago --model b10.bin.gz --lines pro.txt --games 6 --visits 100
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { startKataGo } from './katagoAnalysis';
import { nativeBackend, type NativeBackend } from './nativeBackend';
import { parseSgfFile, type ParsedGame } from '../src/lib/go/sgf';
import { replay } from '../src/lib/go/board';
import { gtpToLoc, locToGtp } from '../src/lib/go/coords';
import { PASS, type Color, type Loc, type Move } from '../src/lib/go/types';
import { engineEvaluator, Search, type AnchorSource, type SearchSnapshot } from '../src/lib/engine/mcts';
import { analyzeGame, MemoryStore, searchTier, type SearchTier } from '../src/lib/analysis/pipeline';
import { computeMoveRecords } from '../src/lib/analysis/records';
import type { GameRecord } from '../src/lib/types';

const [mode, ...rest] = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = rest.indexOf('--' + k);
  return i >= 0 ? rest[i + 1] : d;
};
const SIZE = 19;
const gtp = (l: Loc) => (l === PASS ? 'pass' : locToGtp(l, SIZE));
const fromGtp = (s: string) => (s.toLowerCase() === 'pass' ? PASS : gtpToLoc(s, SIZE));

export interface RefPosition {
  moves: [Color, Loc][];
  toPlay: Color;
  komi: number;
  phase: 'opening' | 'middle' | 'end';
  /** Black's winrate and lead, and the top moves (winrate/lead for the side to move). */
  ref: { visits: number; bWin: number; bLead: number; top: { loc: Loc; visits: number; winrate: number; scoreLead: number }[] };
}

export interface RefFile {
  network: string;
  visits: number;
  positions: RefPosition[];
}

function games(file: string, n: number, seed: number): ParsedGame[] {
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('('));
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const out: ParsedGame[] = [];
  while (out.length < n && lines.length) {
    const g = parseSgfFile(lines.splice(Math.floor(rand() * lines.length), 1)[0]).games[0];
    if (g && g.size === SIZE && !g.setup.length && g.handicap <= 1 && g.moves.length >= 120) out.push(g);
  }
  return out;
}

async function makeRef() {
  const count = Number(arg('count', '40'));
  const visits = Number(arg('visits', '1000'));
  const komi = Number(arg('komi', '7.5'));
  const picks = games(arg('lines')!, count, Number(arg('seed', '7')));
  const kg = startKataGo({ binary: arg('katago')!, model: arg('model')!, threads: Number(arg('threads', '4')) });
  let s = 99;
  const rand = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const positions: RefPosition[] = await Promise.all(
    picks.map(async (g, i) => {
      const phase = (['opening', 'middle', 'end'] as const)[i % 3];
      const n = g.moves.length;
      const [lo, hi] = phase === 'opening' ? [10, 40] : phase === 'middle' ? [Math.floor(n * 0.3), Math.floor(n * 0.6)] : [Math.floor(n * 0.7), n - 6];
      const turn = lo + Math.floor(rand() * Math.max(1, hi - lo));
      const moves = g.moves.slice(0, turn);
      const toPlay = g.moves[turn].color;
      const r = await kg.query({ moves: moves.map((m) => [m.color === 1 ? 'B' : 'W', gtp(m.loc)]), komi, maxVisits: visits, analyzeTurns: [turn] });
      const top = [...r.moveInfos]
        .sort((a, b) => a.order - b.order)
        .slice(0, 6)
        .map((m) => ({
          loc: fromGtp(m.move),
          visits: m.visits,
          winrate: toPlay === 1 ? m.winrate : 1 - m.winrate,
          scoreLead: toPlay === 1 ? m.scoreLead : -m.scoreLead,
        }));
      console.log(`${i + 1}/${picks.length} ${phase} move ${turn}: ${gtp(top[0].loc)}`);
      return { moves: moves.map((m) => [m.color, m.loc] as [Color, Loc]), toPlay, komi, phase, ref: { visits: r.rootInfo.visits, bWin: r.rootInfo.winrate, bLead: r.rootInfo.scoreLead, top } };
    }),
  );
  await kg.close();
  const out: RefFile = { network: arg('network', '?')!, visits, positions };
  writeFileSync(arg('out', 'ref.json')!, JSON.stringify(out));
}

interface Score {
  n: number;
  agree: number;
  top3: number;
  winErr: number;
  leadErr: number;
  smallEvals: number;
  bigEvals: number;
  ms: number;
}

const newScore = (): Score => ({ n: 0, agree: 0, top3: 0, winErr: 0, leadErr: 0, smallEvals: 0, bigEvals: 0, ms: 0 });

function scoreOf(sc: Score, p: RefPosition, snap: SearchSnapshot) {
  sc.n++;
  const best = snap.candidates[0]?.loc;
  if (best === p.ref.top[0].loc) sc.agree++;
  if (p.ref.top.slice(0, 3).some((m) => m.loc === best)) sc.top3++;
  sc.winErr += Math.abs(snap.bWin - p.ref.bWin);
  sc.leadErr += Math.abs(snap.bLead - p.ref.bLead);
}

const report = (label: string, sc: Score) =>
  console.log(
    `${label.padEnd(34)} best ${((sc.agree / sc.n) * 100).toFixed(0).padStart(3)}%  top3 ${((sc.top3 / sc.n) * 100).toFixed(0).padStart(3)}%  ` +
      `win err ${((sc.winErr / sc.n) * 100).toFixed(1).padStart(4)}%  lead err ${(sc.leadErr / sc.n).toFixed(2).padStart(5)}  ` +
      `evals/pos small ${(sc.smallEvals / sc.n).toFixed(0).padStart(4)} big ${(sc.bigEvals / sc.n).toFixed(1).padStart(5)}  ${(sc.ms / sc.n / 1000).toFixed(1)} s/pos`,
  );

function rootOf(p: RefPosition) {
  const moves: Move[] = p.moves.map(([color, loc]) => ({ color, loc }));
  return { size: SIZE, komi: p.komi, moves, toPlay: p.toPlay, board: replay(SIZE, [], moves) };
}

async function anchors() {
  const ref = JSON.parse(readFileSync(arg('ref')!, 'utf8')) as RefFile;
  const visits = Number(arg('visits', '100'));
  const bigVisits = Number(arg('big-visits', String(Math.round(visits / 4))));
  const binary = arg('katago')!;
  const small = nativeBackend({ binary, model: arg('small')!, modelId: 'small', threads: 2, winrateScale: arg('small-wr') ? Number(arg('small-wr')) : undefined });
  const big = nativeBackend({ binary, model: arg('big')!, modelId: 'big', threads: 2, winrateScale: arg('big-wr') ? Number(arg('big-wr')) : undefined });
  const weights = (arg('weights', '1') ?? '1').split(',').map(Number);
  const scores = new Map<string, Score>();
  const sc = (k: string) => scores.get(k) ?? (scores.set(k, newScore()), scores.get(k)!);
  for (const [i, p] of ref.positions.entries()) {
    const root = rootOf(p);
    // Small network alone.
    {
      const s0 = small.evals();
      const t = Date.now();
      const snap = await new Search(engineEvaluator(small, { cache: null }), root, { batch: 8 }).run({ visits });
      const s = sc(`small ${visits}`);
      s.smallEvals += small.evals() - s0;
      s.ms += Date.now() - t;
      scoreOf(s, p, snap);
    }
    // Small network with the big one judging the top (several correction weights).
    for (const w of weights) {
      const s0 = small.evals();
      const b0 = big.evals();
      const t = Date.now();
      const bigEval = engineEvaluator(big, { cache: null });
      const anchor: AnchorSource = async (req) => ({ eval: (await bigEval([{ ...req, ownership: false }]))[0], policy: true });
      const search = new Search(engineEvaluator(small, { cache: null }), root, { batch: 8, anchorWeight: w });
      search.setAnchor(anchor);
      let snap = await search.run({ visits });
      // Let the anchors asked for arrive (on a real device the big network runs beside the small one).
      for (let k = 0; k < 50 && search.anchorStats.judged < search.anchorStats.asked; k++) await new Promise((r) => setTimeout(r, 20));
      snap = search.snapshot();
      const s = sc(`small ${visits} + big anchors w=${w}`);
      s.smallEvals += small.evals() - s0;
      s.bigEvals += big.evals() - b0;
      s.ms += Date.now() - t;
      scoreOf(s, p, snap);
    }
    // Big network alone, at a quarter of the visits (about the same compute when it costs ~4x).
    {
      const b0 = big.evals();
      const t = Date.now();
      const snap = await new Search(engineEvaluator(big, { cache: null }), root, { batch: 8 }).run({ visits: bigVisits });
      const s = sc(`big ${bigVisits}`);
      s.bigEvals += big.evals() - b0;
      s.ms += Date.now() - t;
      scoreOf(s, p, snap);
    }
    if ((i + 1) % 10 === 0 || i === ref.positions.length - 1) {
      console.log(`--- ${i + 1} positions (reference: ${ref.network} at ${ref.visits} visits)`);
      for (const [k, s] of scores) report(k, s);
    }
  }
  await small.close();
  await big.close();
}

function asRecord(g: ParsedGame, i: number): GameRecord {
  return {
    id: `g${i}`,
    source: 'user',
    sgf: '',
    black: g.black ?? 'B',
    white: g.white ?? 'W',
    size: g.size,
    komi: 7.5,
    rules: 'chinese',
    handicap: 0,
    setup: [],
    moves: g.moves,
    result: g.result ?? '',
    date: '',
    playerColor: 1,
    importedAt: 0,
    status: 'pending',
    progress: { total: 0, fast: 0, deep: 0, deepTotal: 0 },
    warnings: [],
  } as unknown as GameRecord;
}

async function selective() {
  const n = Number(arg('games', '4'));
  const visits = Number(arg('visits', '100'));
  const picks = games(arg('lines')!, n, Number(arg('seed', '11')));
  const eng: NativeBackend = nativeBackend({ binary: arg('katago')!, model: arg('model')!, modelId: 'b10', threads: 4, winrateScale: arg('wr') ? Number(arg('wr')) : 2.0 });
  let evalsFull = 0;
  let evalsSel = 0;
  let movesN = 0;
  let same = 0;
  let sameMistake = 0;
  let mistakesFull = 0;
  let mistakesSel = 0;
  let caught = 0;
  const tiers = new Map<SearchTier, number>();
  for (const [i, pg] of picks.entries()) {
    const run = async (adaptive: boolean) => {
      const e0 = eng.evals();
      const g = asRecord(pg, i);
      const a = await analyzeGame(g, eng, new MemoryStore(), { visits, adaptive });
      return { a, g, evals: eng.evals() - e0 };
    };
    const full = await run(false);
    const sel = await run(true);
    evalsFull += full.evals;
    evalsSel += sel.evals;
    const rf = computeMoveRecords(full.g, full.a).records;
    const rs = computeMoveRecords(sel.g, sel.a).records;
    for (let k = 0; k < Math.min(rf.length, rs.length); k++) {
      movesN++;
      const bad = (sev: string) => sev === 'mistake' || sev === 'blunder';
      if (rf[k].severity === rs[k].severity) same++;
      if (bad(rf[k].severity) === bad(rs[k].severity)) sameMistake++;
      if (bad(rf[k].severity)) {
        mistakesFull++;
        if (bad(rs[k].severity)) caught++;
      }
      if (bad(rs[k].severity)) mistakesSel++;
    }
    for (let k = 0; k <= pg.moves.length; k++) {
      const t = searchTier(sel.a, sel.g, k);
      tiers.set(t, (tiers.get(t) ?? 0) + 1);
    }
    console.log(
      `${i + 1}/${picks.length}: evals ${full.evals} (same visits) vs ${sel.evals} (tiers) = ${(full.evals / sel.evals).toFixed(2)}x less work; ` +
        `verdicts same ${((same / movesN) * 100).toFixed(1)}%, mistake-or-not same ${((sameMistake / movesN) * 100).toFixed(1)}%, ` +
        `mistakes caught ${caught}/${mistakesFull} (tiers flag ${mistakesSel})`,
    );
  }
  console.log(`tiers: ${[...tiers.entries()].map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`overall: ${(evalsFull / evalsSel).toFixed(2)}x fewer network evaluations`);
  await eng.close();
}

if (mode === 'ref') await makeRef();
else if (mode === 'anchors') await anchors();
else if (mode === 'selective') await selective();
else {
  console.error('usage: ai-eval.ts ref|anchors|selective ... (see the top of this file)');
  process.exit(1);
}
