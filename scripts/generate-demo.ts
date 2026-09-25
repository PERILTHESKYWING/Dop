/**
 * Generate the bundled demo data with the real engine (CPU, kataeval.wasm under Node).
 *
 * The demo player "Mira" is a KataGo-policy player with a few injected habits, so the
 * pipeline has real, recurring weaknesses to discover:
 *   - answers locally when the best move is elsewhere
 *   - reinforces safe groups while a weak group matters
 *   - rescues small stones that should be given up
 *   - plays low in the opening
 * "Tessa" is an opponent with her own style (early 3-3 invasions, high play, contact).
 * Every game is then analysed by the same pipeline the app uses.
 *
 *   npx tsx scripts/generate-demo.ts --model <net.bin.gz> --part 0 --parts 4
 *   npx tsx scripts/generate-demo.ts --merge 4
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNodeEngine } from './nodeEngine';
import { Board } from '../src/lib/go/board';
import { buildContext, pointFeatures } from '../src/lib/go/features';
import { chebyshev, lineOf, xy } from '../src/lib/go/coords';
import { PASS, type Color, type Loc, type Move, other } from '../src/lib/go/types';
import { processRawOutput, moverView } from '../src/lib/engine/parse';
import type { EngineBackend } from '../src/lib/engine/types';
import { toSgf } from '../src/lib/go/sgf';
import { gameFromParsed } from '../src/lib/games';
import { analyzeGame, MemoryStore } from '../src/lib/analysis/pipeline';
import type { GameRecord } from '../src/lib/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'public', 'demo');
const args = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};

type Style = 'mira' | 'tessa' | 'club';
interface GameSpec {
  idx: number;
  black: string;
  white: string;
  bStyle: Style;
  wStyle: Style;
  date: string;
  source: 'demo' | 'demo-opponent';
}

const PLAYER = 'Mira';
const RIVAL = 'Tessa';
const CLUB = ['Arin', 'Bex', 'Cato', 'Dara', 'Eli', 'Fenn', 'Gus', 'Hana'];

function specs(): GameSpec[] {
  const out: GameSpec[] = [];
  const nMira = 12;
  for (let i = 0; i < nMira; i++) {
    const opp = CLUB[i % CLUB.length];
    const miraBlack = i % 2 === 0;
    out.push({
      idx: i,
      black: miraBlack ? PLAYER : opp,
      white: miraBlack ? opp : PLAYER,
      bStyle: miraBlack ? 'mira' : 'club',
      wStyle: miraBlack ? 'club' : 'mira',
      date: `2026-0${1 + Math.floor(i / 2)}-${String(3 + (i % 2) * 14).padStart(2, '0')}`,
      source: 'demo',
    });
  }
  for (let i = 0; i < 4; i++) {
    const opp = CLUB[(i + 3) % CLUB.length];
    const tBlack = i % 2 === 1;
    out.push({
      idx: nMira + i,
      black: tBlack ? RIVAL : opp,
      white: tBlack ? opp : RIVAL,
      bStyle: tBlack ? 'tessa' : 'club',
      wStyle: tBlack ? 'club' : 'tessa',
      date: `2026-0${2 + i}-20`,
      source: 'demo-opponent',
    });
  }
  return out;
}

// Deterministic RNG per game.
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function sample(cands: { loc: Loc; p: number }[], temp: number, r: () => number): Loc {
  const w = cands.map((c) => Math.pow(Math.max(c.p, 1e-9), 1 / temp));
  const z = w.reduce((a, b) => a + b, 0);
  let x = r() * z;
  for (let i = 0; i < cands.length; i++) {
    x -= w[i];
    if (x <= 0) return cands[i].loc;
  }
  return cands[0].loc;
}

async function chooseMove(
  engine: EngineBackend,
  board: Board,
  moves: Move[],
  color: Color,
  style: Style,
  r: () => number,
  counts: Record<string, number>,
): Promise<{ loc: Loc; win: number }> {
  const size = board.size;
  const raw = await engine.evalRaw({ size, komi: 7.5, moves, toPlay: color }, true);
  const net = processRawOutput(raw, color, (l) => board.isLegal(l, color), engine.postProcess);
  const win = moverView(net.bWin, net.bLead, color).win;
  const hw = size * size;
  const all: { loc: Loc; p: number }[] = [];
  for (let i = 0; i < hw; i++) if (net.policy[i] > 0.0005) all.push({ loc: i, p: net.policy[i] });
  all.sort((a, b) => b.p - a.p);
  if (!all.length || net.policy[hw] > all[0].p) return { loc: PASS, win };
  const top = all[0];
  const mn = moves.length + 1;
  const last = moves.length ? moves[moves.length - 1] : null;
  const lastOpp = last && last.color !== color ? last.loc : null;

  if (style === 'mira') {
    const ctx = buildContext(board, net.ownership ?? null);
    const pf = (l: Loc) => pointFeatures(ctx, l, color, lastOpp);
    const tf = pf(top.loc);
    // Habit 1: answer locally when the best move is elsewhere.
    if (lastOpp !== null && lastOpp !== PASS && mn > 20 && tf.tenuki && r() < 0.5) {
      const local = all.find((c) => chebyshev(c.loc, lastOpp, size) <= 2 && c.p > 0.004);
      if (local) {
        counts.local++;
        return { loc: local.loc, win };
      }
    }
    // Habit 2: when the opponent probes a safe group, answer there even though a
    // weak group elsewhere is the real issue.
    const probeAtSafe = lastOpp !== null && lastOpp !== PASS && !!ctx.nearSafe[color][lastOpp] && !ctx.nearWeak[color][lastOpp];
    if (probeAtSafe && (tf.nearOwnWeak || tf.nearOppWeak) && r() < 0.7) {
      const safe = all.slice(0, 60).find((c) => {
        const f = pf(c.loc);
        return f.nearOwnSafe && !f.nearOwnWeak && !f.nearOppWeak && chebyshev(c.loc, lastOpp!, size) <= 3 && c.p > 0.001;
      });
      if (safe) {
        counts.safe++;
        return { loc: safe.loc, win };
      }
    }
    // Habit 3: rescue small weak stones instead of sacrificing them.
    if (ctx.smallWeak[color].length && !tf.extendsSmallWeak && r() < 0.3) {
      for (const g of ctx.smallWeak[color]) {
        const ext = g.liberties.find((l) => board.isLegal(l, color));
        if (ext !== undefined && (net.policy[ext] > 0.0005 || g.liberties.length === 1)) {
          counts.cling++;
          return { loc: ext, win };
        }
      }
    }
    // Habit 4: play low in the opening.
    if (mn <= 40 && lineOf(top.loc, size) >= 4 && r() < 0.45) {
      const low = all.find((c) => lineOf(c.loc, size) === 3 && c.p > 0.01);
      if (low) {
        counts.low++;
        return { loc: low.loc, win };
      }
    }
    return { loc: sample(all.slice(0, 3), 0.4, r), win };
  }
  if (style === 'tessa') {
    // Early 3-3 invasions.
    if (mn >= 6 && mn <= 40 && r() < 0.35) {
      const three = all.slice(0, 30).find((c) => {
        const [x, y] = xy(c.loc, size);
        const lx = Math.min(x, size - 1 - x), ly = Math.min(y, size - 1 - y);
        return lx === 2 && ly === 2 && c.p > 0.001;
      });
      if (three) return { loc: three.loc, win };
    }
    // High play and contact fights.
    if (mn <= 60 && r() < 0.4) {
      const high = all.slice(0, 8).find((c) => lineOf(c.loc, size) >= 4 && c.p > 0.02);
      if (high) return { loc: high.loc, win };
    }
    if (r() < 0.35) {
      const contact = all.slice(0, 10).find((c) => board.neighbors(c.loc).some((q) => board.stones[q] === other(color)) && c.p > 0.01);
      if (contact) return { loc: contact.loc, win };
    }
    return { loc: sample(all.slice(0, 4), 0.5, r), win };
  }
  // Club opponents: decent, a little random.
  if (r() < 0.12) return { loc: sample(all.slice(0, 15), 1, r), win };
  return { loc: sample(all.slice(0, 8), 1, r), win };
}

async function playGame(engine: EngineBackend, spec: GameSpec, counts: Record<string, number>) {
  const size = 19;
  const r = rng(1000 + spec.idx * 7919);
  const board = new Board(size);
  const moves: Move[] = [];
  let color: Color = 1;
  let passes = 0;
  let result = '';
  const maxMoves = 230 + Math.floor(r() * 50);
  while (moves.length < maxMoves) {
    const style = color === 1 ? spec.bStyle : spec.wStyle;
    const { loc, win } = await chooseMove(engine, board, moves, color, style, r, counts);
    if (moves.length > 200 && win < 0.005 && r() < 0.5) {
      result = `${color === 1 ? 'W' : 'B'}+R`;
      break;
    }
    if (loc === PASS) passes++;
    else passes = 0;
    board.play(loc, color, true);
    moves.push({ color, loc });
    if (passes >= 2) break;
    color = other(color);
  }
  if (!result) {
    const raw = await engine.evalRaw({ size, komi: 7.5, moves, toPlay: color }, false);
    const net = processRawOutput(raw, color, (l) => board.isLegal(l, color), engine.postProcess);
    const lead = Math.round(net.bLead * 2) / 2 || 0.5;
    result = lead > 0 ? `B+${Math.abs(lead)}` : `W+${Math.abs(lead)}`;
  }
  const parsed = {
    size,
    komi: 7.5,
    handicap: 0,
    setup: [],
    moves,
    black: spec.black,
    white: spec.white,
    blackRank: spec.black === PLAYER ? '3k' : spec.black === RIVAL ? '2k' : '3k',
    whiteRank: spec.white === PLAYER ? '3k' : spec.white === RIVAL ? '2k' : '3k',
    result,
    date: spec.date,
    event: spec.source === 'demo' ? 'Club league (demo)' : 'Open tournament (demo)',
    warnings: [],
  };
  const sgf = toSgf(parsed);
  return gameFromParsed(parsed, `demo-${spec.idx + 1}.sgf`, spec.source, [PLAYER], sgf);
}

async function runPart(modelPath: string, part: number, parts: number) {
  const engine = await loadNodeEngine(modelPath, arg('model-id', 'g170e-b10c128')!);
  const mine = specs().filter((s) => s.idx % parts === part);
  const store = new MemoryStore();
  const games: GameRecord[] = [];
  const counts = { local: 0, safe: 0, cling: 0, low: 0 };
  for (const spec of mine) {
    const t0 = Date.now();
    const g = await playGame(engine, spec, counts);
    if (spec.source === 'demo-opponent') g.playerColor = null;
    const t1 = Date.now();
    const focus = spec.source === 'demo' ? g.playerColor : spec.black === RIVAL ? 1 : 2;
    await analyzeGame(g, engine, store, {
      deepVisits: Number(arg('visits', '1')),
      deepPerGame: spec.source === 'demo' ? Number(arg('deep', '30')) : 10,
      maxSearchMs: 20000,
      focusColor: focus as 1 | 2,
    });
    games.push(store.games.get(g.id)!);
    console.log(`part ${part}: game ${spec.idx + 1} ${g.moves.length} moves ${g.result} play ${(t1 - t0) / 1000}s analyse ${(Date.now() - t1) / 1000}s`, counts);
  }
  mkdirSync(OUT, { recursive: true });
  const analyses = games.map((g) => store.analyses.get(g.id)!);
  writeFileSync(path.join(OUT, `part-${part}.json`), JSON.stringify({ games, analyses }));
}

function merge(parts: number) {
  const games: GameRecord[] = [];
  const analyses: unknown[] = [];
  for (let p = 0; p < parts; p++) {
    const d = JSON.parse(readFileSync(path.join(OUT, `part-${p}.json`), 'utf8'));
    games.push(...d.games);
    analyses.push(...d.analyses);
  }
  games.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const out = {
    version: 1,
    generatedAt: new Date().toISOString(),
    player: PLAYER,
    rival: RIVAL,
    note: 'Synthetic games played by KataGo-policy bots with injected habits, analysed by the real engine.',
    games,
    analyses,
  };
  writeFileSync(path.join(OUT, 'demo.json'), JSON.stringify(out));
  console.log(`merged ${games.length} games`);
}

if (arg('merge')) merge(Number(arg('merge')));
else runPart(arg('model')!, Number(arg('part', '0')), Number(arg('parts', '1'))).catch((e) => {
  console.error(e);
  process.exit(1);
});
