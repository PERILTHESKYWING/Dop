/**
 * Measures root search methods at small budgets (src/lib/engine/mcts.ts): KataGo's PUCT
 * against Gumbel root search with sequential halving, with the bundled b10 network in
 * Node (the same kataeval.wasm the browser runs).
 *
 *   refs     reference answers: a deep search (--visits, default 1600) of each position,
 *            keeping every root move's searched winrate. Positions: the benchmark's 30
 *            (public/engine/bench-positions.json) plus --extra positions sampled from the
 *            AI broadcast games (public/broadcast/games.json). --part/--parts splits the
 *            work over processes.
 *   compare  each method at each budget (--budgets 8,16,32,64,128): how often it picks the
 *            reference's best move, and the winrate it gives up by its choice (the
 *            reference's winrate for the best move minus for the chosen one; a move the
 *            reference searched too little is measured by its own 400-visit search).
 *
 *   npx tsx scripts/search-eval.ts refs --extra 90 --out refs.json [--part 0 --parts 4]
 *   KATAGO=/path/to/katago npx tsx scripts/search-eval.ts refs --native --visits 2000 --extra 90 --out refs.json
 *            (references from unmodified native KataGo instead of this search, so they do
 *            not favour the search being measured; compare then also judges moves the
 *            reference barely searched with native KataGo)
 *   npx tsx scripts/search-eval.ts compare --refs 'refs*.json' --budgets 8,16,32,64,128 --methods puct,gumbel8,gumbel16
 *     [--part 0 --parts 4 --out rows-0.json]   (then: report --rows 'rows-*.json')
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNodeEngine } from './nodeEngine';
import { replay } from '../src/lib/go/board';
import { PASS, other, type Color, type Loc, type Move } from '../src/lib/go/types';
import { engineEvaluator, Search, type LeafEvaluator, type RootPosition, type SearchParams } from '../src/lib/engine/mcts';
import { NNCache } from '../src/lib/engine/nncache';
import { gtpToLoc, locToGtp } from '../src/lib/go/coords';
import { startKataGo, type KataGo } from './katagoAnalysis';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const [mode, ...rest] = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = rest.indexOf('--' + k);
  return i >= 0 ? rest[i + 1] : d;
};
const MODEL = path.join(root, 'public', 'models', 'g170e-b10c128-s1141046784-d204142634.bin.gz');

interface RefPos {
  id: string;
  moves: [Color, Loc][];
  toPlay: Color;
  komi: number;
  /** Winrate for the side to move, per searched root move, and the best. */
  visits: number;
  best: Loc;
  bestWin: number;
  bestLead: number;
  moveWin: Record<string, { visits: number; win: number; lead: number }>;
}

const rootOf = (p: { moves: [Color, Loc][]; toPlay: Color; komi: number }): RootPosition => {
  const moves: Move[] = p.moves.map(([color, loc]) => ({ color, loc }));
  return { size: 19, komi: p.komi, moves, toPlay: p.toPlay, board: replay(19, [], moves) };
};

function rand(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function positions(extra: number) {
  const bench = JSON.parse(readFileSync(path.join(root, 'public', 'engine', 'bench-positions.json'), 'utf8'));
  const out: { id: string; moves: [Color, Loc][]; toPlay: Color; komi: number }[] = bench.positions.map(
    (p: { game: string; turn: number; moves: [Color, Loc][]; toPlay: Color; komi: number }) => ({ id: `bench-${p.game}-${p.turn}`, moves: p.moves, toPlay: p.toPlay, komi: p.komi }),
  );
  const games = JSON.parse(readFileSync(path.join(root, 'public', 'broadcast', 'games.json'), 'utf8')).games as { id: string; komi: string; moves: string }[];
  const r = rand(7);
  for (let i = 0; i < extra; i++) {
    const g = games[i % games.length];
    const all: [Color, Loc][] = [];
    for (let j = 0; j + 1 < g.moves.length; j += 2) {
      const x = g.moves.charCodeAt(j) - 97;
      const y = g.moves.charCodeAt(j + 1) - 97;
      all.push([(all.length % 2 === 0 ? 1 : 2) as Color, x >= 0 && x < 19 && y >= 0 && y < 19 ? y * 19 + x : PASS]);
    }
    if (all.length < 40) continue;
    // Opening to late middle game.
    const turn = 10 + Math.floor(r() * Math.min(200, all.length - 20));
    const moves = all.slice(0, turn);
    out.push({ id: `bc-${g.id}-${turn}`, moves, toPlay: (turn % 2 === 0 ? 1 : 2) as Color, komi: Number(g.komi) });
  }
  return out;
}

async function evaluator(): Promise<LeafEvaluator> {
  const eng = await loadNodeEngine(MODEL, 'g170e-b10c128', 19, 1);
  return engineEvaluator(eng, { cache: new NNCache() });
}

const moverWin = (bWin: number, toPlay: Color) => (toPlay === 1 ? bWin : 1 - bWin);

const gtp = (l: Loc) => (l === PASS ? 'pass' : locToGtp(l, 19));
const fromGtp = (m: string) => (m.toLowerCase() === 'pass' ? PASS : gtpToLoc(m, 19));
let native: KataGo | null = null;
const nativeKg = () => (native ??= startKataGo({ binary: process.env.KATAGO!, model: MODEL, threads: 4 }));
const nativeQuery = (p: { moves: [Color, Loc][]; komi: number }, visits: number) =>
  nativeKg().query({ moves: p.moves.map(([c, l]) => [c === 1 ? 'B' : 'W', gtp(l)] as [string, string]), komi: p.komi, rules: 'chinese', initialPlayer: 'B', maxVisits: visits });

/** References from native KataGo: every root move it searched, from the mover's side. */
async function nativeRefs() {
  const all = positions(Number(arg('extra', '90')));
  const visits = Number(arg('visits', '2000'));
  let done = 0;
  const out = await Promise.all(
    all.map(async (p): Promise<RefPos> => {
      const r = await nativeQuery(p, visits);
      const moveWin: RefPos['moveWin'] = {};
      for (const m of r.moveInfos) moveWin[fromGtp(m.move)] = { visits: m.visits, win: moverWin(m.winrate, p.toPlay), lead: p.toPlay === 1 ? m.scoreLead : -m.scoreLead };
      const best = [...r.moveInfos].sort((a, b) => a.order - b.order)[0];
      const loc = fromGtp(best.move);
      process.stdout.write(`\r${++done}/${all.length}`);
      return { ...p, visits, best: loc, bestWin: moveWin[loc].win, bestLead: moveWin[loc].lead, moveWin };
    }),
  );
  await native?.close();
  writeFileSync(arg('out')!, JSON.stringify({ visits, native: true, positions: out }));
  console.log(`\nwrote ${out.length} positions`);
}

async function refs() {
  if (rest.includes('--native')) return nativeRefs();
  const all = positions(Number(arg('extra', '90')));
  const part = Number(arg('part', '0'));
  const parts = Number(arg('parts', '1'));
  const visits = Number(arg('visits', '1600'));
  const ev = await evaluator();
  const out: RefPos[] = [];
  const mine = all.filter((_, i) => i % parts === part);
  for (const [i, p] of mine.entries()) {
    const t = Date.now();
    const s = new Search(ev, rootOf(p));
    const snap = await s.run({ visits });
    const moveWin: RefPos['moveWin'] = {};
    for (const c of snap.candidates) moveWin[c.loc] = { visits: c.visits, win: c.winrate, lead: c.scoreLead };
    const best = snap.candidates[0];
    out.push({ ...p, visits, best: best.loc, bestWin: best.winrate, bestLead: best.scoreLead, moveWin });
    console.log(`${i + 1}/${mine.length} ${p.id}: best ${best.loc} (${(best.winrate * 100).toFixed(1)}%), ${((Date.now() - t) / 1000).toFixed(0)} s`);
    writeFileSync(arg('out')!, JSON.stringify({ visits, positions: out }));
  }
}

const METHODS: Record<string, Partial<SearchParams>> = {
  puct: {},
  gumbel4: { gumbel: 4, gumbelMaxVisits: 1e9 },
  gumbel8: { gumbel: 8, gumbelMaxVisits: 1e9 },
  gumbel16: { gumbel: 16, gumbelMaxVisits: 1e9 },
  gumbel32: { gumbel: 32, gumbelMaxVisits: 1e9 },
  // KataGo's utility-spread exploration (its defaults: scale 0.85, prior 0.4, weight 2).
  stdev: { cpuctStdevScale: 0.85 },
  stdev50: { cpuctStdevScale: 0.5 },
};

function readGlob(pat: string): unknown[] {
  const dir = path.dirname(pat);
  const re = new RegExp('^' + path.basename(pat).replace(/[.]/g, '\\.').replace(/\*/g, '.*') + '$');
  return readdirSync(dir || '.')
    .filter((f) => re.test(f))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
}

interface Row {
  budget: number;
  method: string;
  agree: boolean;
  loss: number;
  points: number;
  /** Error of the root's averaged value, and of the chosen move's own value. */
  rootErr: number;
  pickErr: number;
}

async function compare() {
  const ps = (readGlob(arg('refs', 'refs*.json')!) as { positions: RefPos[] }[]).flatMap((f) => f.positions);
  const part = Number(arg('part', '0'));
  const parts = Number(arg('parts', '1'));
  const mine = ps.filter((_, i) => i % parts === part);
  const budgets = arg('budgets', '8,16,32,64,128')!.split(',').map(Number);
  const methods = arg('methods', 'puct,gumbel8,gumbel16')!.split(',');
  const ev = await evaluator();
  // A move the reference searched too little: its own search, from the opponent's side.
  const extraWin = new Map<string, { win: number; lead: number }>();
  const winOf = async (p: RefPos, loc: Loc): Promise<{ win: number; lead: number }> => {
    const known = p.moveWin[loc];
    if (known && known.visits >= 20) return known;
    const key = `${p.id}:${loc}`;
    if (!extraWin.has(key) && process.env.KATAGO) {
      const r = await nativeQuery({ moves: [...p.moves, [p.toPlay, loc]], komi: p.komi }, 400);
      extraWin.set(key, { win: moverWin(r.rootInfo.winrate, p.toPlay), lead: p.toPlay === 1 ? r.rootInfo.scoreLead : -r.rootInfo.scoreLead });
    }
    if (!extraWin.has(key)) {
      const r = rootOf(p);
      const board = r.board.clone();
      board.play(loc, p.toPlay, true);
      const s = new Search(ev, { ...r, moves: [...r.moves, { color: p.toPlay, loc }], toPlay: other(p.toPlay), board });
      const snap = await s.run({ visits: 400 });
      extraWin.set(key, { win: moverWin(snap.bWin, p.toPlay), lead: p.toPlay === 1 ? snap.bLead : -snap.bLead });
    }
    return extraWin.get(key)!;
  };
  const rows: Row[] = [];
  for (const [i, p] of mine.entries()) {
    for (const b of budgets) {
      for (const m of methods) {
        const s = new Search(ev, rootOf(p), METHODS[m]);
        const snap = await s.run({ visits: b });
        const pick = snap.candidates[0];
        const v = await winOf(p, pick.loc);
        rows.push({
          budget: b,
          method: m,
          agree: pick.loc === p.best,
          loss: Math.max(0, p.bestWin - v.win),
          points: Math.max(0, p.bestLead - v.lead),
          rootErr: Math.abs(moverWin(snap.bWin, p.toPlay) - p.bestWin),
          pickErr: Math.abs(pick.winrate - p.bestWin),
        });
      }
    }
    console.log(`${i + 1}/${mine.length} ${p.id}`);
    if (arg('out')) writeFileSync(arg('out')!, JSON.stringify({ rows }));
  }
  await native?.close();
  if (!arg('out')) report(rows);
}

function report(rows: Row[]) {
  const keys = [...new Set(rows.map((r) => `${r.budget}|${r.method}`))];
  const n0 = rows.filter((r) => `${r.budget}|${r.method}` === keys[0]).length;
  console.log(`${n0} positions`);
  for (const k of keys) {
    const rs = rows.filter((r) => `${r.budget}|${r.method}` === k);
    const n = rs.length;
    const avg = (f: (r: Row) => number) => rs.reduce((a, r) => a + f(r), 0) / n;
    const [b, m] = k.split('|');
    console.log(
      `${b.padStart(4)} visits  ${m.padEnd(9)} best move ${(avg((r) => +r.agree) * 100).toFixed(1).padStart(5)}%` +
        `  win rate given up ${(avg((r) => r.loss) * 100).toFixed(2)}%  points given up ${avg((r) => r.points).toFixed(2)}` +
        `  big mistakes (>5%) ${(avg((r) => +(r.loss > 0.05)) * 100).toFixed(1)}%` +
        `  value error: root ${(avg((r) => r.rootErr) * 100).toFixed(2)}%, chosen move ${(avg((r) => r.pickErr) * 100).toFixed(2)}%`,
    );
  }
}

if (!existsSync(MODEL)) throw new Error('missing ' + MODEL);
if (mode === 'refs') await refs();
else if (mode === 'compare') await compare();
else if (mode === 'report') report((readGlob(arg('rows', 'rows*.json')!) as { rows: Row[] }[]).flatMap((f) => f.rows));
else console.log('modes: refs, compare, report');
