/**
 * Generate the games the live broadcast plays back: KataGo against itself, with the real
 * engine (kataeval.wasm on the CPU under Node) and our tree search.
 *
 * Each move is chosen among the candidates the search found that lose almost nothing
 * against the best one (by score and by winrate), weighted by visits, so the games vary
 * from one to the next but contain no mistakes by the engine's own judgement. The side
 * that is behind plays its best move, which keeps the games close. A move that turns out
 * to lose more than a couple of points once the next position is read is taken back and
 * replaced by the best move of a much longer search.
 *
 *   npx tsx scripts/generate-broadcast.ts --model public/models/<net>.bin.gz --games 36 --seed 1 --part 0 --parts 4
 *   npx tsx scripts/generate-broadcast.ts --merge --seed 1
 *
 * `--seed` changes the whole set (.github/workflows/broadcast-games.yml passes its run number).
 */
import { writeFileSync, readFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNodeEngine } from './nodeEngine';
import { Board } from '../src/lib/go/board';
import { PASS, type Color, type Loc, type Move, other } from '../src/lib/go/types';
import { engineEvaluator, Search } from '../src/lib/engine/mcts';
import { safeChoices } from '../src/lib/broadcast/choose';
import { processRawOutput } from '../src/lib/engine/parse';
import { WINRATE_FROM_SCORE } from '../src/lib/engine/models';
import { encodeMoves, type BroadcastFile, type BroadcastGame } from '../src/lib/broadcast/data';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'public', 'broadcast');
const TMP = path.join(here, '..', '.broadcast-parts');
const args = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};

const SIZE = 19;
const KOMI = 7.5;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

async function playGame(engine: Awaited<ReturnType<typeof loadNodeEngine>>, idx: number, seed: number, visits: number): Promise<BroadcastGame> {
  const r = rng(seed * 7919 + idx * 104729 + 17);
  let board = new Board(SIZE);
  const moves: Move[] = [];
  const wr: number[] = [];
  const lead: number[] = [];
  const cands: number[][] = [];
  let color: Color = 1;
  let passes = 0;
  const losing = [0, 0, 0];
  let result = '';
  let end: BroadcastGame['end'] = 'score';
  const evaluator = engineEvaluator(engine);
  const search = new Search(evaluator, { size: SIZE, komi: KOMI, moves: [], toPlay: 1, board: board.clone() }, { batch: engine.batch ?? 1 });

  // Hindsight check: when a move turns out to lose more than DROP points once the next position
  // is searched, take it back and pick the best move of a search DEEP times longer instead.
  const DROP = 2.5;
  const DEEP = 6;
  let deep = false;
  let lastDeep = false;
  let before: { board: Board; passes: number; lead: number } | null = null;

  while (moves.length < 360) {
    search.setPosition({ size: SIZE, komi: KOMI, moves: [...moves], toPlay: color, board: board.clone() });
    const snap = await search.run({ visits: deep ? visits * DEEP : visits });
    if (!deep && !lastDeep && before && moves.length) {
      const last = moves[moves.length - 1];
      const lost = last.color === 1 ? before.lead - snap.bLead : snap.bLead - before.lead;
      if (lost > DROP) {
        moves.pop();
        board = before.board;
        passes = before.passes;
        color = last.color;
        wr.pop();
        lead.pop();
        cands.pop();
        deep = true;
        continue;
      }
    }
    const verified = deep;
    deep = false;
    wr.push(Math.round(snap.bWin * 1000));
    lead.push(Math.round(snap.bLead * 10));
    const list = snap.candidates;
    cands.push(list.slice(0, 4).flatMap((c) => [c.loc, Math.round(c.winrate * 1000), Math.round(c.scoreLead * 10), c.visits]));

    const mover = color === 1 ? snap.bWin : 1 - snap.bWin;
    // Resign a game that has been hopeless for a while, rather than play it out.
    losing[color] = mover < 0.02 && moves.length > 120 ? losing[color] + 1 : 0;
    if (losing[color] >= 8) {
      result = `${color === 1 ? 'W' : 'B'}+R`;
      end = 'resign';
      cands.pop();
      wr.pop();
      lead.pop();
      break;
    }

    // The side ahead may vary among moves that lose next to nothing; the side behind plays its
    // best. Small differences still add up, so the games stay close and hard to call.
    const n = moves.length;
    const opening = n < 12;
    const behind = !opening && mover < 0.4;
    const choices = behind || verified ? list.slice(0, 1) : safeChoices(list, opening ? 1.0 : n < 60 ? 0.6 : 0.4, opening ? 0.05 : 0.03);
    const temp = opening ? 1.4 : n < 60 ? 1.0 : 0.6;
    // Once passing itself is among the safe choices, nothing left on the board is worth
    // more than a couple of points either way: take it rather than filling dame, so games
    // end by both sides passing instead of playing out neutral points to move 300+.
    const passSafe = !opening && !behind && !verified && choices.some((c) => c.loc === PASS);
    let loc: Loc = passSafe ? PASS : (choices[0]?.loc ?? PASS);
    if (!passSafe && choices.length > 1) {
      const w = choices.map((c) => Math.pow(c.visits, 1 / temp));
      let x = r() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < choices.length; i++) {
        x -= w[i];
        if (x <= 0) {
          loc = choices[i].loc;
          break;
        }
      }
    }
    if (loc !== PASS && !board.isLegal(loc, color)) loc = PASS;
    before = { board: board.clone(), passes, lead: snap.bLead };
    lastDeep = verified;
    passes = loc === PASS ? passes + 1 : 0;
    board.play(loc, color, true);
    moves.push({ color, loc });
    color = other(color);
    if (passes >= 2) break;
  }

  if (!result) {
    // Score the final position by area, with dead stones as the network's ownership sees them.
    const raw = await engine.evalRaw({ size: SIZE, komi: KOMI, moves, toPlay: color }, true);
    const net = processRawOutput(raw, color, (l) => board.isLegal(l, color), engine.postProcess);
    const own = net.ownership!;
    let diff = -KOMI;
    for (let i = 0; i < SIZE * SIZE; i++) diff += own[i] > 0.3 ? 1 : own[i] < -0.3 ? -1 : 0;
    result = diff > 0 ? `B+${diff}` : `W+${-diff}`;
    wr.push(Math.round((diff > 0 ? 1 : 0) * 1000));
    lead.push(Math.round(diff * 10));
  } else {
    wr.push(result.startsWith('B') ? 1000 : 0);
    lead.push(lead[lead.length - 1] ?? 0);
  }
  return { id: `s${seed}-${idx}`, size: SIZE, komi: KOMI, rules: 'chinese', moves: encodeMoves(moves.map((m) => m.loc), SIZE), wr, lead, cands, result, end };
}

async function runPart(modelPath: string, part: number, parts: number) {
  const engine = await loadNodeEngine(modelPath, arg('model-id', 'g170e-b10c128')!, SIZE, 1, WINRATE_FROM_SCORE);
  const total = Number(arg('games', '40'));
  const seed = Number(arg('seed', '1'));
  const visits = Number(arg('visits', '32'));
  mkdirSync(TMP, { recursive: true });
  for (let i = part; i < total; i += parts) {
    const file = path.join(TMP, `g-${seed}-${i}.json`);
    if (existsSync(file)) continue; // resumable
    const t0 = Date.now();
    const g = await playGame(engine, i, seed, visits);
    writeFileSync(file, JSON.stringify(g));
    console.log(`part ${part}: game ${i + 1}/${total} ${g.wr.length - 1} moves ${g.result} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}

function merge() {
  const seed = arg('seed', '1');
  const files = readdirSync(TMP).filter((f) => f.startsWith(`g-${seed}-`));
  const games: BroadcastGame[] = files.map((f) => JSON.parse(readFileSync(path.join(TMP, f), 'utf8')));
  games.sort((a, b) => Number(a.id.split('-')[1]) - Number(b.id.split('-')[1]));
  const out: BroadcastFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    engine: `KataGo ${arg('model-id', 'g170e-b10c128')} · ${arg('visits', '32')} visits a move`,
    games,
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, 'games.json'), JSON.stringify(out));
  console.log(`merged ${games.length} games into public/broadcast/games.json`);
}

if (args.includes('--merge')) merge();
else
  runPart(arg('model')!, Number(arg('part', '0')), Number(arg('parts', '1'))).catch((e) => {
    console.error(e);
    process.exit(1);
  });
