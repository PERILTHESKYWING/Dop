/**
 * Measures the AI ideas against a stronger reference, on real positions:
 *
 *   ref        reference answers: a deep native KataGo search with a strong network on
 *              positions from professional and amateur games (all phases)
 *   anchors    "big brain at the top, small brain below": the small network searching
 *              alone, the same search with the big network judging the top of the tree,
 *              and the big network searching alone, scored against the reference
 *   selective  "search only what matters": a whole-game review with every position given
 *              the same visits, against scouting every position and deepening only where the
 *              scouts could not clear the move (pipeline.ts ADAPTIVE), both measured against a
 *              review with four times the visits everywhere: the network evaluations each
 *              costs and how many of the truth's mistakes each one finds (--try tries other
 *              settings: "scout,deepenScore,deepenWin,doubt;...")
 *
 * The student network has its own measurement: scripts/student/gate.ts.
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
import { ADAPTIVE, analyzeGame, MemoryStore } from '../src/lib/analysis/pipeline';
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
  // A review with four times the visits everywhere, as the truth the others are measured against.
  const truthVisits = Number(arg('truth', String(visits * 4)));
  // Settings to try, "scout,deepenScore,deepenWin,doubt;..." (the default: the current ones).
  const cur = [ADAPTIVE.scout, ADAPTIVE.deepenScore, ADAPTIVE.deepenWin, ADAPTIVE.doubt];
  const configs = arg('try', cur.join(','))!.split(';').map((c) => c.split(',').map(Number));
  const picks = games(arg('lines')!, n, Number(arg('seed', '11')));
  const eng: NativeBackend = nativeBackend({ binary: arg('katago')!, model: arg('model')!, modelId: 'b10', threads: 4, winrateScale: arg('wr') ? Number(arg('wr')) : 2.0 });
  const bad = (sev: string) => sev === 'mistake' || sev === 'blunder';
  type Tally = { name: string; evals: number; sameMistake: number; caught: number; flagged: number; deepened: number };
  const tally = (name: string): Tally => ({ name, evals: 0, sameMistake: 0, caught: 0, flagged: 0, deepened: 0 });
  const full = tally(`same ${visits} visits`);
  const tried = configs.map((c) => tally(`scout ${c.join('/')}`));
  let movesN = 0;
  let positions = 0;
  let truthMistakes = 0;
  const saved = { ...ADAPTIVE };
  for (const [i, pg] of picks.entries()) {
    const run = async (v: number, adaptive: boolean) => {
      const e0 = eng.evals();
      const g = asRecord(pg, i);
      // A fresh evaluation cache for every review (it is kept per engine object), so no
      // review is cheaper for the positions another one already evaluated.
      const a = await analyzeGame(g, { ...eng }, new MemoryStore(), { visits: v, adaptive });
      return { a, g, evals: eng.evals() - e0, records: computeMoveRecords(g, a).records };
    };
    const truth = await run(truthVisits, false);
    const runs: [Tally, Awaited<ReturnType<typeof run>>][] = [[full, await run(visits, false)]];
    for (const [k, c] of configs.entries()) {
      [ADAPTIVE.scout, ADAPTIVE.deepenScore, ADAPTIVE.deepenWin, ADAPTIVE.doubt] = c;
      const r = await run(visits, true);
      tried[k].deepened += r.a.evals.filter((e) => e?.searched && e.visits > visits * c[0] * 1.5).length;
      runs.push([tried[k], r]);
    }
    Object.assign(ADAPTIVE, saved);
    const m = Math.min(...[truth, ...runs.map((r) => r[1])].map((r) => r.records.length));
    movesN += m;
    positions += pg.moves.length + 1;
    for (let k = 0; k < m; k++) if (bad(truth.records[k].severity)) truthMistakes++;
    for (const [t, r] of runs) {
      t.evals += r.evals;
      for (let k = 0; k < m; k++) {
        const isBad = bad(r.records[k].severity);
        if (isBad === bad(truth.records[k].severity)) t.sameMistake++;
        if (isBad) t.flagged++;
        if (isBad && bad(truth.records[k].severity)) t.caught++;
      }
    }
    console.log(`${i + 1}/${picks.length}: ${movesN} moves so far, the truth (${truthVisits} visits everywhere) finds ${truthMistakes} mistakes`);
    for (const t of [full, ...tried]) {
      console.log(
        `  ${t.name.padEnd(26)} work ${((t.evals / full.evals) * 100).toFixed(0).padStart(4)}%, mistake-or-not as the truth ` +
          `${((t.sameMistake / movesN) * 100).toFixed(1)}%, mistakes found ${t.caught}/${truthMistakes}, false alarms ${t.flagged - t.caught}` +
          (t === full ? '' : `, deepened ${((t.deepened / positions) * 100).toFixed(0)}% of positions`),
      );
    }
  }
  await eng.close();
}

if (mode === 'ref') await makeRef();
else if (mode === 'anchors') await anchors();
else if (mode === 'selective') await selective();
else {
  console.error('usage: ai-eval.ts ref|anchors|selective ... (see the top of this file)');
  process.exit(1);
}
