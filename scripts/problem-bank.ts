/**
 * Forge problem bank: finds problems in real games and verifies every one with KataGo.
 *
 * Nothing here is invented. Each problem is a moment from a real game (rank-labelled Fox
 * games and professional games) where one move mattered:
 *
 *  - Life and death: a group whose fate depends on who plays first (KataGo's ownership of it
 *    flips when the side to move passes). The fight is cut out into a corner or side window,
 *    the rest of the board becomes a settled tsumego frame (src/lib/problems/frame.ts), the
 *    komi is set so the right answer leaves the game even, and the problem is kept only if
 *    KataGo confirms, with a real search, that the goal ("Black to live", "White to kill")
 *    succeeds with the answer and fails without it.
 *  - Tesuji, endgame and best-move problems: whole-board positions where one move is clearly
 *    better than everything else, including the moves that look most natural.
 *
 * For every problem the answer tree is searched out: the moves that work, the opponent's
 * strongest resistance, the next move that works, until the problem is settled, and the
 * refutation of each tempting wrong move. The level comes from the move-difficulty model
 * fitted on real games (src/lib/problems/level.ts).
 *
 * Needs the native KataGo binary (see .github/workflows/problem-bank.yml):
 *   npx tsx scripts/problem-bank.ts --katago ./katago --model <net.bin.gz> --fox-dir sgf/ --pro pro.txt \
 *     --minutes 60 --out out/problems-0.jsonl
 *   npx tsx scripts/problem-bank.ts --merge out/ [--bank public/problems/bank.json]
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startKataGo, type KataGo, type KgResult } from './katagoAnalysis';
import { parseSgfFile, type ParsedGame } from '../src/lib/go/sgf';
import { Board } from '../src/lib/go/board';
import { gtpToLoc, locToGtp, locToSgf, xy } from '../src/lib/go/coords';
import { PASS, other, type Color, type Loc, type Move } from '../src/lib/go/types';
import { parseRank } from '../src/lib/level/ranks';
import { decodeSgfBytes } from '../src/lib/util/charset';
import type { MoveChoice } from '../src/lib/coach/choices';
import { findRate, type DifficultyModel } from '../src/lib/coach/difficulty';
import { canonicalKey, decodeStones, encodeStones, framePosition, inRect, lifeWindow, lineTags, looseGroups, shapeOk, type Rect } from '../src/lib/problems/frame';
import { clampLevel, levelsByQuantile, problemLevel, SCORE_RANK, solveChance, type AnswerStep } from '../src/lib/problems/level';
import type { Problem, ProblemBank, ProblemBranch, ProblemCategory, ProblemGoal, ProblemNode } from '../src/lib/problems/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const args = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};

const SIZE = 19;
/** Search sizes: the first look at a problem, and every later position in its tree. */
const ROOT_VISITS = Number(arg('root-visits', '500'));
const NODE_VISITS = Number(arg('node-visits', '250'));
/** Answer moves within this many points of the best one also count as right. */
const LIFE_TOL = 2;
const WHOLE_TOL = 1.2;
const ENDGAME_TOL = 0.7;
/** A life-and-death problem must be worth at least this many points. */
const LIFE_MIN_STAKES = 8;
/** A wrong move must lose at least this much to be called wrong. */
const WRONG_MIN = 3;
/** Player moves in an answer (the opponent answers in between). */
const MAX_DEPTH = 5;
/** Group ownership (from the defender's side) that counts as alive / dead. */
const ALIVE = 0.5;
/** Ownership that makes a problem settled: no need to play on. */
const SETTLED = 0.85;
const MAX_ANSWERS = 2;

// ---------------------------------------------------------------------------------------
// Positions and searches

interface Pos {
  /** Stones before `moves` (the frame, or empty for whole-board positions replayed from the game). */
  stones: Int8Array | null;
  moves: Move[];
  toPlay: Color;
  komi: number;
}

interface Cand {
  loc: Loc;
  visits: number;
  /** For the side to move at the searched position. */
  lead: number;
  win: number;
  prior: number;
  pv: Loc[];
}

interface Searched {
  toPlay: Color;
  /** Root values for the side to move. */
  lead: number;
  win: number;
  cands: Cand[];
  /** Black-positive ownership, if asked for. */
  own: number[] | null;
  policy: number[] | null;
  visits: number;
}

const colorLetter = (c: Color) => (c === 1 ? 'B' : 'W');
const gtp = (l: Loc) => (l === PASS ? 'pass' : locToGtp(l, SIZE));
const fromGtp = (s: string) => (s.toLowerCase() === 'pass' ? PASS : gtpToLoc(s, SIZE));

function initialStones(stones: Int8Array): [string, string][] {
  const out: [string, string][] = [];
  for (let l = 0; l < stones.length; l++) if (stones[l]) out.push([colorLetter(stones[l] as Color), gtp(l)]);
  return out;
}

let kg: KataGo;

function convert(r: KgResult, toPlay: Color): Searched {
  const s = toPlay === 1 ? 1 : -1;
  const cands = r.moveInfos
    .map((m) => ({
      loc: fromGtp(m.move),
      visits: m.visits,
      lead: s * m.scoreLead,
      win: toPlay === 1 ? m.winrate : 1 - m.winrate,
      prior: m.prior,
      pv: m.pv.map(fromGtp),
    }))
    .sort((a, b) => b.visits - a.visits);
  return {
    toPlay,
    lead: s * r.rootInfo.scoreLead,
    win: toPlay === 1 ? r.rootInfo.winrate : 1 - r.rootInfo.winrate,
    cands,
    own: r.ownership ?? null,
    policy: r.policy ?? null,
    visits: r.rootInfo.visits,
  };
}

async function search(p: Pos, visits: number, own = false, policy = false): Promise<Searched> {
  const r = await kg.query({
    initialStones: p.stones ? initialStones(p.stones) : undefined,
    moves: p.moves.map((m) => [colorLetter(m.color), gtp(m.loc)]),
    initialPlayer: p.stones && !p.moves.length ? colorLetter(p.toPlay) : undefined,
    komi: p.komi,
    maxVisits: visits,
    includeOwnership: own,
    includePolicy: policy,
  });
  return convert(r, p.toPlay);
}

const play = (p: Pos, loc: Loc): Pos => ({ ...p, moves: [...p.moves, { color: p.toPlay, loc }], toPlay: other(p.toPlay) });

function boardOf(p: Pos): Board {
  const b = new Board(SIZE, p.stones ?? undefined);
  for (const m of p.moves) b.play(m.loc, m.color, true);
  return b;
}

/** Mean ownership of some stones from `color`'s side (+1 = theirs). */
function ownershipOf(own: number[] | null, stones: readonly Loc[], color: Color): number {
  if (!own || !stones.length) return 0;
  const s = color === 1 ? 1 : -1;
  return (stones.reduce((a, l) => a + own[l], 0) / stones.length) * s;
}

/** Candidates the search trusts enough to call right (visited enough) and within `tol` of the best. */
function goodMoves(r: Searched, tol: number, keep: (l: Loc) => boolean): Cand[] {
  const best = r.cands[0];
  if (!best) return [];
  const minVisits = Math.max(3, best.visits * 0.05);
  return r.cands.filter((c) => keep(c.loc) && c.visits >= minVisits && c.lead >= best.lead - tol);
}

/** The choices of the difficulty model, from a search (most natural moves plus the answer). */
function choicesOf(r: Searched, answer: Loc): MoveChoice[] {
  const byPrior = [...r.cands].sort((a, b) => b.prior - a.prior);
  const set = byPrior.slice(0, 8);
  if (!set.some((c) => c.loc === answer)) {
    const a = r.cands.find((c) => c.loc === answer);
    if (a) set.push(a);
  }
  const bestLead = Math.max(...set.map((c) => c.lead));
  const bestWin = Math.max(...set.map((c) => c.win));
  return set.map((c) => ({ loc: c.loc, prior: c.prior, loss: bestLead - c.lead, winLoss: bestWin - c.win }));
}

// ---------------------------------------------------------------------------------------
// Answer trees

interface TreeCtx {
  /** Moves outside this window end the problem (life and death). */
  rect?: Rect;
  tol: number;
  /** The player (who solves the problem). */
  player: Color;
  /** Is the goal reached and settled, judged after the player's move (opponent to move)? */
  settled(r: Searched): boolean;
  /** Is the goal still met at all, from a search with the player to move? */
  holds(r: Searched): boolean;
  steps: AnswerStep[];
  queries: number;
}

const local = (ctx: TreeCtx, l: Loc) => {
  if (l === PASS) return false;
  if (!ctx.rect) return true;
  const [x, y] = xy(l, SIZE);
  return inRect(ctx.rect, x, y);
};

class Reject extends Error {}

/** Why candidates were turned down (printed with the progress, to tune the filters). */
const reasons = new Map<string, number>();
function why(r: string): null {
  reasons.set(r, (reasons.get(r) ?? 0) + 1);
  return null;
}

/** A position with the player to move and its search: the moves that work and what follows them. */
async function playerNode(ctx: TreeCtx, pos: Pos, r: Searched, depth: number): Promise<ProblemNode> {
  const good = goodMoves(r, ctx.tol, (l) => local(ctx, l));
  if (!good.length) throw new Reject('no local answer');
  if (depth === 0 && good.length > MAX_ANSWERS) throw new Reject(`${good.length} answers`);
  if (depth === 0 || ctx.steps.length === depth) ctx.steps.push({ choices: choicesOf(r, good[0].loc), answer: good[0].loc });
  const node: ProblemNode = { ok: {} };
  const answers = good.slice(0, depth === 0 ? MAX_ANSWERS : 3);
  for (const a of answers) {
    const after = play(pos, a.loc);
    const ra = await search(after, NODE_VISITS, true);
    ctx.queries++;
    // The opponent's own search finds much more than the player's search allowed for: the
    // move is not a reliable answer.
    if (ra.lead > -a.lead + 4) {
      if (a === answers[0]) throw new Reject('unstable values');
      continue;
    }
    const branches: ProblemBranch[] = [];
    const reply = ra.cands[0];
    if (ctx.settled(ra) || !reply || !local(ctx, reply.loc)) {
      node.ok[locToSgf(a.loc, SIZE)] = branches;
      continue;
    }
    // The opponent's strongest local replies (the best, and a second if it is as strong).
    const replies = ra.cands.filter((c, i) => local(ctx, c.loc) && (i === 0 || (depth === 0 && c.visits >= reply.visits * 0.3 && c.lead >= reply.lead - 0.7))).slice(0, 2);
    for (const rep of replies) {
      const next = play(after, rep.loc);
      const rn = await search(next, NODE_VISITS, true);
      ctx.queries++;
      if (!ctx.holds(rn)) {
        if (a === answers[0] && rep === replies[0]) throw new Reject('goal lost after the reply');
        continue;
      }
      const nextGood = goodMoves(rn, ctx.tol, (l) => local(ctx, l));
      const best = rn.cands[0];
      // No need to answer (the best move is elsewhere), or several moves do: settled here.
      if (!best || !local(ctx, best.loc) || nextGood.length > 3) {
        branches.push({ r: locToSgf(rep.loc, SIZE) });
        continue;
      }
      if (depth + 1 >= MAX_DEPTH) throw new Reject('too long');
      branches.push({ r: locToSgf(rep.loc, SIZE), n: await playerNode(ctx, next, rn, depth + 1) });
    }
    if (!branches.length && a === answers[0]) throw new Reject('no branch');
    if (branches.length || !replies.length) node.ok[locToSgf(a.loc, SIZE)] = branches;
  }
  if (!Object.keys(node.ok).length) throw new Reject('no answer survived');

  // Tempting wrong moves: the most natural-looking local moves that are not answers.
  const answerSet = new Set(Object.keys(node.ok));
  const tempting = [...r.cands]
    .filter((c) => local(ctx, c.loc) && !answerSet.has(locToSgf(c.loc, SIZE)) && c.prior >= 0.02)
    .sort((x, y) => y.prior - x.prior)
    .slice(0, depth === 0 ? 3 : 1);
  const bestLead = r.cands[0].lead;
  for (const w of tempting) {
    const rw = await search(play(pos, w.loc), NODE_VISITS, true);
    ctx.queries++;
    const lead = -rw.lead;
    if (lead >= bestLead - WRONG_MIN || ctx.settled(rw)) {
      // Not clearly wrong after all.
      if (depth === 0 && lead >= bestLead - ctx.tol) throw new Reject('a tempting move also works');
      continue;
    }
    const ref = rw.cands[0];
    if (!ref) continue;
    (node.bad ??= {})[locToSgf(w.loc, SIZE)] = ref.pv.slice(0, 7).filter((l) => l !== PASS).map((l) => locToSgf(l, SIZE));
  }
  return node;
}

// ---------------------------------------------------------------------------------------
// Life and death

interface LifeCandidate {
  game: ParsedGame;
  gameRank?: number;
  src: Problem['src'];
  turn: number;
  mover: Color;
  target: Loc[];
  goal: 'live' | 'kill';
}

type Found = Problem & { steps: AnswerStep[] };

async function verifyLife(c: LifeCandidate, diff: DifficultyModel): Promise<Found | null> {
  const board = new Board(SIZE);
  for (const m of c.game.moves.slice(0, c.turn)) board.play(m.loc, m.color, true);
  const defender: Color = board.stones[c.target[0]] as Color;
  const attacker = other(defender);
  const rect = lifeWindow(board, c.target);
  if (!rect) return why('life: window');
  if (!shapeOk(board.stones, SIZE, rect)) return why('life: crowded window');
  const framed = framePosition(board.stones, SIZE, rect, attacker);
  if (!framed) return why('life: frame');
  const fb = new Board(SIZE, framed);
  if (fb.groups().some((g) => g.liberties.length === 0)) return why('life: frame captures');
  // Komi that makes the right answer an even game, and a first look at who wins the fight
  // with each side to play (most screened fights fail here, so it is kept short).
  const first = await search({ stones: framed, moves: [], toPlay: c.mover, komi: 0 }, 150, true);
  const komi = Math.round(first.lead * (c.mover === 1 ? 2 : -2)) / 2;
  if (Math.abs(komi) > 80) return why('life: komi');
  const base: Pos = { stones: framed, moves: [], toPlay: c.mover, komi };
  const wantAlive = c.goal === 'live';
  const statusOk = (oFirst: number, oSecond: number) => (wantAlive ? oFirst >= ALIVE && oSecond <= -ALIVE : oFirst <= -ALIVE && oSecond >= ALIVE);
  const quickPass = await search(play(base, PASS), 100, true);
  if (!statusOk(ownershipOf(first.own, c.target, defender), ownershipOf(quickPass.own, c.target, defender))) return why(`life: status ${c.goal} framed`);
  const root = await search(base, ROOT_VISITS, true, true);
  const passed = await search(play(base, PASS), NODE_VISITS, true);
  if (!statusOk(ownershipOf(root.own, c.target, defender), ownershipOf(passed.own, c.target, defender))) return why(`life: status ${c.goal} deep`);
  const stakes = root.lead + passed.lead;
  if (stakes < LIFE_MIN_STAKES) return why('life: small stakes');
  // The real game's winrate for the mover, shown as background.
  const game = await search({ stones: null, moves: c.game.moves.slice(0, c.turn), toPlay: c.mover, komi: c.game.komi }, 100);
  const goodFor = (r: Searched) => ownershipOf(r.own, c.target, defender) * (wantAlive ? 1 : -1);
  const ctx: TreeCtx = {
    rect,
    tol: LIFE_TOL,
    player: c.mover,
    settled: (r) => goodFor(r) >= SETTLED,
    holds: (r) => goodFor(r) >= ALIVE - 0.2,
    steps: [],
    queries: 3,
  };
  let tree: ProblemNode;
  try {
    tree = await playerNode(ctx, base, root, 0);
  } catch (e) {
    if (e instanceof Reject) return why('life tree: ' + e.message);
    throw e;
  }
  if (args.includes('--debug')) debugLevel(diff, ctx.steps);
  const mainLine = mainLineOf(tree);
  const tags = lineTags(fb, c.mover, mainLine.map((s) => sgfLoc(s)), true);
  tags.push(wantAlive ? 'live' : 'kill');
  if (c.goal === 'kill' && mainLine.length && isEyeSteal(fb, c.mover, sgfLoc(mainLine[0]), c.target)) tags.push('eye-steal');
  const inWindow = new Int8Array(SIZE * SIZE);
  for (let l = 0; l < SIZE * SIZE; l++) {
    const [x, y] = xy(l, SIZE);
    if (inRect(rect, x, y)) inWindow[l] = framed[l];
  }
  return {
    id: '',
    cat: 'life',
    goal: c.goal,
    size: SIZE,
    b: encodeStones(inWindow, SIZE, 1),
    w: encodeStones(inWindow, SIZE, 2),
    toPlay: colorLetter(c.mover) as 'B' | 'W',
    view: [rect.x0, rect.y0, rect.x1, rect.y1],
    frame: colorLetter(attacker) as 'B' | 'W',
    tree,
    level: clampLevel(problemLevel(diff, ctx.steps)),
    // The frame's komi makes the right answer an even game: the side that fails is the one
    // behind, at about this winrate.
    win: round3(root.win),
    srcWin: round3(game.win),
    stakes: round1(stakes),
    steps: ctx.steps,
    tags: [...new Set(tags)],
    target: c.target.map((l) => locToSgf(l, SIZE)).join(''),
    src: c.src,
    key: canonicalKey(inWindow, SIZE, c.mover, rect),
  };
}

function debugLevel(diff: DifficultyModel, steps: AnswerStep[]) {
  const rows = steps.map((st) => {
    const a = st.choices.find((c) => c.loc === st.answer);
    const rates = [-12, -6, 0, 5].map((r) => (findRate(diff, r, st.choices, st.answer) ?? 0).toFixed(2));
    return `${gtp(st.answer)} prior ${a?.prior.toFixed(3)} rates@12k/6k/1k/5d ${rates.join('/')} choices ${st.choices.map((c) => `${gtp(c.loc)}:${c.prior.toFixed(2)}/${c.loss.toFixed(1)}`).join(' ')}`;
  });
  console.log('LEVEL', problemLevel(diff, steps), '\n  ' + rows.join('\n  '));
}

function isEyeSteal(b: Board, mover: Color, loc: Loc, target: Loc[]): boolean {
  // A first move on a point the target group needs for an eye: surrounded mostly by the defender.
  const t = new Set(target);
  const n = b.neighbors(loc);
  return n.filter((q) => t.has(q) || b.stones[q] === other(mover)).length >= Math.max(2, n.length - 1);
}

const sgfLoc = (s: string) => {
  const x = s.charCodeAt(0) - 97, y = s.charCodeAt(1) - 97;
  return y * SIZE + x;
};

function mainLineOf(node: ProblemNode): string[] {
  const out: string[] = [];
  let n: ProblemNode | undefined = node;
  while (n) {
    const keys: string[] = Object.keys(n.ok);
    const mv = keys[0];
    if (!mv) break;
    out.push(mv);
    const br: ProblemBranch | undefined = n.ok[mv][0];
    if (!br) break;
    out.push(br.r);
    n = br.n;
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Whole-board problems (tesuji, endgame, best move)

interface WholeCandidate {
  game: ParsedGame;
  src: Problem['src'];
  turn: number;
  mover: Color;
}

async function verifyWhole(c: WholeCandidate, diff: DifficultyModel): Promise<Found | null> {
  const base: Pos = { stones: null, moves: c.game.moves.slice(0, c.turn), toPlay: c.mover, komi: c.game.komi };
  const root = await search(base, ROOT_VISITS, true, true);
  const best = root.cands[0];
  if (!best || best.loc === PASS || root.win < 0.08 || root.win > 0.92) return why('whole: decided game');
  const moveNo = c.turn + 1;
  const endgame = moveNo >= 150;
  const tol = endgame ? ENDGAME_TOL : WHOLE_TOL;
  // The gap to the next-best move decides whether there is one answer to find.
  const good = goodMoves(root, tol, () => true);
  if (!good.length || good.length > MAX_ANSWERS) return why('whole: several answers');
  const goodSet = new Set(good.map((g) => g.loc));
  const others = root.cands.filter((x) => !goodSet.has(x.loc) && x.visits >= 3);
  let gap = others.length ? best.lead - Math.max(...others.map((x) => x.lead)) : 0;
  // What the most natural-looking moves lose (they may be barely searched).
  const natural = [...root.cands].filter((x) => !goodSet.has(x.loc)).sort((a, b) => b.prior - a.prior).slice(0, 2);
  for (const n of natural) {
    const rn = await search(play(base, n.loc), NODE_VISITS);
    gap = Math.min(gap || Infinity, best.lead + rn.lead);
  }
  if (!Number.isFinite(gap)) return why('whole: no gap');
  const b0 = boardOf(base);
  const tags = lineTags(b0, c.mover, best.pv.slice(0, 6), false);
  const tactical = tags.some((t) => ['capture', 'atari', 'sacrifice', 'throw-in', 'snapback'].includes(t));
  let cat: ProblemCategory;
  if (endgame && gap >= 1.5 && gap <= 15) cat = 'endgame';
  else if (!endgame && tactical && gap >= 4) cat = 'tesuji';
  else if (!endgame && moveNo >= 25 && gap >= 4) cat = 'middle';
  else return why('whole: no category');
  const sharpGap = cat === 'endgame' ? 1.5 : 3;
  const ctx: TreeCtx = {
    tol,
    player: c.mover,
    // Whole-board problems end once the next move is no longer a sharp choice.
    settled: () => false,
    holds: (r) => r.cands.length > 1 && r.cands[0].lead - Math.max(...r.cands.slice(1).filter((x) => x.visits >= 3).map((x) => x.lead), -Infinity) >= sharpGap,
    steps: [],
    queries: 1,
  };
  let tree: ProblemNode;
  try {
    tree = await wholeNode(ctx, base, root, 0, sharpGap);
  } catch (e) {
    if (e instanceof Reject) return why('whole tree: ' + e.message);
    throw e;
  }
  return {
    id: '',
    cat,
    goal: 'best' as ProblemGoal,
    size: SIZE,
    b: encodeStones(b0.stones, SIZE, 1),
    w: encodeStones(b0.stones, SIZE, 2),
    toPlay: colorLetter(c.mover) as 'B' | 'W',
    tree,
    level: clampLevel(problemLevel(diff, ctx.steps)),
    win: round3(root.win),
    stakes: round1(gap),
    steps: ctx.steps,
    tags,
    src: c.src,
    last: c.turn > 0 ? locToSgf(c.game.moves[c.turn - 1].loc, SIZE) : undefined,
    key: canonicalKey(b0.stones, SIZE, c.mover),
  };
}

/** Whole-board answer: the right move(s), the opponent's reply, and on while one move stays sharp. */
async function wholeNode(ctx: TreeCtx, pos: Pos, r: Searched, depth: number, sharpGap: number): Promise<ProblemNode> {
  const good = goodMoves(r, ctx.tol, () => true);
  if (!good.length) throw new Reject('no answer');
  if (depth === 0 || ctx.steps.length === depth) ctx.steps.push({ choices: choicesOf(r, good[0].loc), answer: good[0].loc });
  const node: ProblemNode = { ok: {} };
  for (const a of good.slice(0, MAX_ANSWERS)) {
    const after = play(pos, a.loc);
    const ra = await search(after, NODE_VISITS);
    const reply = ra.cands[0];
    const branches: ProblemBranch[] = [];
    if (reply && reply.loc !== PASS && depth + 1 < 3) {
      const next = play(after, reply.loc);
      const rn = await search(next, NODE_VISITS);
      if (ctx.holds(rn) && goodMoves(rn, ctx.tol, () => true).length <= MAX_ANSWERS) {
        branches.push({ r: locToSgf(reply.loc, SIZE), n: await wholeNode(ctx, next, rn, depth + 1, sharpGap) });
      } else branches.push({ r: locToSgf(reply.loc, SIZE) });
    } else if (reply && reply.loc !== PASS) branches.push({ r: locToSgf(reply.loc, SIZE) });
    node.ok[locToSgf(a.loc, SIZE)] = branches;
  }
  if (depth === 0) {
    const answerSet = new Set(Object.keys(node.ok));
    const tempting = [...r.cands].filter((c) => !answerSet.has(locToSgf(c.loc, SIZE)) && c.loc !== PASS && c.prior >= 0.03).sort((x, y) => y.prior - x.prior).slice(0, 2);
    for (const w of tempting) {
      const rw = await search(play(pos, w.loc), NODE_VISITS);
      if (-rw.lead >= r.cands[0].lead - sharpGap * 0.75) continue;
      const ref = rw.cands[0];
      if (ref) (node.bad ??= {})[locToSgf(w.loc, SIZE)] = ref.pv.slice(0, 5).filter((l) => l !== PASS).map((l) => locToSgf(l, SIZE));
    }
  }
  return node;
}

// ---------------------------------------------------------------------------------------
// Screening games for candidates (network only, one visit per position)

async function screen(game: ParsedGame, src: (turn: number) => Problem['src']): Promise<{ life: LifeCandidate[]; whole: WholeCandidate[] }> {
  const n = game.moves.length;
  const first = 20, last = n - 4;
  if (last <= first) return { life: [], whole: [] };
  const turns: number[] = [];
  for (let t = first; t <= last; t++) turns.push(t);
  const movesGtp = game.moves.map((m) => [colorLetter(m.color), gtp(m.loc)] as [string, string]);
  const at = await kg.queryTurns({ moves: movesGtp, komi: game.komi, maxVisits: 1, includeOwnership: true, analyzeTurns: turns });
  const passed = await Promise.all(
    turns.map((t) =>
      kg.query({
        moves: [...movesGtp.slice(0, t), [colorLetter(game.moves[t].color), 'pass']],
        komi: game.komi,
        maxVisits: 1,
        includeOwnership: true,
      }),
    ),
  );
  const boards: Board[] = [];
  {
    const b = new Board(SIZE);
    for (let t = 0; t <= last; t++) {
      boards.push(b.clone());
      if (t < n) b.play(game.moves[t].loc, game.moves[t].color, true);
    }
  }
  const life: LifeCandidate[] = [];
  const recent: { turn: number; stones: Set<Loc> }[] = [];
  turns.forEach((t, k) => {
    const mover = game.moves[t].color;
    if (game.moves[t].loc === PASS) return;
    const A = at[k].ownership, B = passed[k].ownership;
    if (!A || !B) return;
    let bestScore = 0;
    let pick: LifeCandidate | null = null;
    for (const g of looseGroups(boards[t])) {
      if (g.stones.length < 3 || g.stones.length > 30) continue;
      const oA = ownershipOf(A, g.stones, g.color);
      const oB = ownershipOf(B, g.stones, g.color);
      const live = g.color === mover && oA >= 0.3 && oB <= -0.3 && oA - oB >= 0.9;
      const kill = g.color !== mover && oA <= -0.3 && oB >= 0.3 && oB - oA >= 0.9;
      if (!live && !kill) continue;
      if (!lifeWindow(boards[t], g.stones)) continue;
      if (recent.some((r) => t - r.turn < 12 && g.stones.some((s) => r.stones.has(s)))) continue;
      const score = Math.abs(oA - oB) * Math.sqrt(g.stones.length);
      if (score > bestScore) {
        bestScore = score;
        pick = { game, src: src(t), turn: t, mover, target: g.stones, goal: live ? 'live' : 'kill' };
      }
    }
    if (pick) {
      life.push(pick);
      recent.push({ turn: t, stones: new Set(pick.target) });
    }
  });
  // Whole-board: the network's value swings, a costly game move (avoid it) or a chance
  // it gave the opponent (punish it).
  const lead = (k: number) => (at[k].rootInfo.scoreLead ?? 0) * (game.moves[turns[k]].color === 1 ? 1 : -1);
  const whole: { t: number; s: number }[] = [];
  for (let k = 5; k + 1 < turns.length; k++) {
    const loss = lead(k) + lead(k + 1); // mover's lead before, minus after (opponent's view flips)
    const w = at[k].rootInfo.winrate;
    if (loss >= 3 && w > 0.12 && w < 0.88) whole.push({ t: turns[k], s: loss });
  }
  whole.sort((a, b) => b.s - a.s);
  const picked: number[] = [];
  for (const w of whole) {
    if (picked.length >= 3) break;
    if (picked.some((p) => Math.abs(p - w.t) < 8)) continue;
    picked.push(w.t);
  }
  return {
    life: life.slice(0, 4),
    whole: picked.map((t) => ({ game, src: src(t), turn: t, mover: game.moves[t].color })),
  };
}

// ---------------------------------------------------------------------------------------
// Sources

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (n.toLowerCase().endsWith('.sgf')) out.push(p);
  }
  return out;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 2 ** 32;
  };
}

interface Source {
  name: string;
  game: ParsedGame;
  kind: 'fox' | 'pro';
  rank?: number;
}

function* sources(r: () => number): Generator<Source> {
  const fox = arg('fox-dir') ? walk(arg('fox-dir')!) : [];
  const pro = arg('pro') ? readFileSync(arg('pro')!, 'utf8').split('\n').filter((l) => l.startsWith('(')) : [];
  const shuffle = <T>(xs: T[]) => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs;
  };
  shuffle(fox);
  shuffle(pro);
  const part = Number(arg('part', '0')), parts = Number(arg('parts', '1'));
  let i = 0, j = 0, k = 0;
  // Three Fox games for every professional one: amateur games are where most everyday
  // life-and-death fights happen, at every level.
  while (i < fox.length || j < pro.length) {
    const takePro = (k++ % 4 === 3 && j < pro.length) || i >= fox.length;
    let text: string, name: string, kind: 'fox' | 'pro';
    if (takePro) {
      name = `pro:${j}`;
      text = pro[j++];
      kind = 'pro';
    } else {
      name = path.basename(fox[i]);
      text = decodeSgfBytes(new Uint8Array(readFileSync(fox[i++])));
      kind = 'fox';
    }
    if ((k - 1) % parts !== part) continue;
    const g = parseSgfFile(text).games[0];
    if (g) g.komi = Math.max(-150, Math.min(150, Math.round(g.komi * 2) / 2));
    if (!g || g.size !== SIZE || g.setup.length || g.handicap > 1 || g.moves.length < 60) continue;
    let rank: number | undefined;
    if (kind === 'fox') {
      const b = parseRank(g.blackRank), w = parseRank(g.whiteRank);
      if (b === null || w === null || b > 9 || w > 9) continue;
      rank = Math.round((b + w) / 2);
    } else rank = 10;
    yield { name, game: g, kind, rank };
  }
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round3 = (x: number) => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------------------------------
// Main

async function build() {
  const out = arg('out', path.join(ROOT, '.problem-parts', 'problems.jsonl'))!;
  mkdirSync(path.dirname(out), { recursive: true });
  const seen = new Set<string>();
  for (const f of (arg('seen', '') ?? '').split(',').filter(Boolean)) {
    if (!existsSync(f)) continue;
    for (const p of readBank(f)) seen.add(p.key ?? '');
  }
  const diff = JSON.parse(readFileSync(path.join(ROOT, 'public', 'coach', 'difficulty.json'), 'utf8')) as DifficultyModel;
  kg = startKataGo({ binary: arg('katago', 'katago')!, model: arg('model')!, threads: Number(arg('threads', '4')) });
  const deadline = Date.now() + Number(arg('minutes', '60')) * 60_000;
  const maxGames = Number(arg('games', '100000'));
  const r = rng(Number(arg('seed', '1')));
  const stats = { games: 0, lifeTried: 0, wholeTried: 0, life: 0, tesuji: 0, endgame: 0, middle: 0, dup: 0 };
  const t0 = Date.now();
  const inflight = new Set<Promise<void>>();
  const LIMIT = Number(arg('concurrency', '6'));

  const work = async (s: Source) => {
    const srcOf = (t: number): Problem['src'] => ({ kind: s.kind, rank: s.rank, move: t + 1 });
    const c = await screen(s.game, srcOf);
    const keep = (p: Found | null) => {
      if (!p) return;
      const key = p.key!;
      if (seen.has(key)) {
        stats.dup++;
        return;
      }
      seen.add(key);
      p.id = 'p' + hash(key);
      p.score = round3(solveChance(diff, SCORE_RANK, p.steps));
      stats[p.cat]++;
      // The level's inputs go to a side file, so levels can be refitted without searching again.
      const { steps, ...problem } = p;
      appendFileSync(out, JSON.stringify(problem) + '\n');
      appendFileSync(out.replace(/\.jsonl$/, '') + '.steps.jsonl', JSON.stringify({ id: p.id, steps }) + '\n');
    };
    for (const lc of c.life) {
      if (Date.now() > deadline) return;
      stats.lifeTried++;
      keep(await verifyLife(lc, diff));
    }
    for (const wc of c.whole) {
      if (Date.now() > deadline) return;
      stats.wholeTried++;
      keep(await verifyWhole(wc, diff));
    }
    stats.games++;
    if (stats.games % 5 === 0) {
      const min = (Date.now() - t0) / 60000;
      console.log(
        `${min.toFixed(1)} min, ${stats.games} games: life ${stats.life}/${stats.lifeTried}, tesuji ${stats.tesuji}, endgame ${stats.endgame}, best move ${stats.middle} of ${stats.wholeTried}, dup ${stats.dup}, ${(kg.visits() / (min * 60)).toFixed(0)} visits/s`,
      );
      if (stats.games % 25 === 0) console.log('  turned down:', JSON.stringify(Object.fromEntries([...reasons].sort((a, b) => b[1] - a[1]))));
    }
  };

  for (const s of sources(r)) {
    if (Date.now() > deadline || stats.games >= maxGames) break;
    const p: Promise<void> = work(s)
      .catch((e) => console.error(`${s.name}: ${(e as Error).message}`))
      .finally(() => inflight.delete(p));
    inflight.add(p);
    if (inflight.size >= LIMIT) await Promise.race(inflight);
  }
  await Promise.all(inflight);
  await kg.close();
  console.log('done', JSON.stringify(stats));
  console.log('turned down:', JSON.stringify(Object.fromEntries([...reasons].sort((a, b) => b[1] - a[1]))));
}

function hash(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519);
  }
  return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)).slice(0, 12);
}

function readBank(f: string): Problem[] {
  if (f.endsWith('.jsonl')) return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return (JSON.parse(readFileSync(f, 'utf8')) as ProblemBank).problems;
}

/**
 * Merge new problems into the bank (deduplicated), then set every problem's level from its
 * difficulty score (levelsByQuantile, per category) and sort by level.
 */
function merge() {
  const dir = arg('merge')!;
  const bankFile = arg('bank', path.join(ROOT, 'public', 'problems', 'bank.json'))!;
  const diff = JSON.parse(readFileSync(path.join(ROOT, 'public', 'coach', 'difficulty.json'), 'utf8')) as DifficultyModel;
  const old = existsSync(bankFile) ? readBank(bankFile) : [];
  const byKey = new Map<string, Problem>();
  const keyOf = (p: Problem) =>
    canonicalKey(decodeStones(p.b, p.w, p.size), p.size, p.toPlay === 'B' ? 1 : 2, p.view ? { x0: p.view[0], y0: p.view[1], x1: p.view[2], y1: p.view[3] } : undefined);
  for (const p of old) byKey.set(keyOf(p), p);
  let added = 0;
  const files = statSync(dir).isDirectory() ? walkJsonl(dir) : [dir];
  // Problems made before a quality rule changed are held to it too.
  const good = (p: Problem) => !p.view || shapeOk(decodeStones(p.b, p.w, p.size), p.size, { x0: p.view[0], y0: p.view[1], x1: p.view[2], y1: p.view[3] });
  for (const [k, p] of byKey) if (!good(p)) byKey.delete(k);
  for (const f of files) {
    // Scores for problems written before they were stored, from the level side file.
    const stepsFile = f.replace(/\.jsonl$/, '.steps.jsonl');
    const steps = new Map<string, AnswerStep[]>();
    if (existsSync(stepsFile))
      for (const l of readFileSync(stepsFile, 'utf8').split('\n').filter(Boolean)) {
        const j = JSON.parse(l) as { id: string; steps: AnswerStep[] };
        steps.set(j.id, j.steps);
      }
    for (const p of readBank(f)) {
      if (!good(p)) continue;
      if (p.score === undefined && steps.has(p.id)) p.score = round3(solveChance(diff, SCORE_RANK, steps.get(p.id)!));
      p.key = keyOf(p);
      const key = p.key;
      if (byKey.has(key)) continue;
      byKey.set(key, p);
      added++;
    }
  }
  const problems = [...byKey.values()];
  for (const cat of ['life', 'tesuji', 'endgame', 'middle'] as ProblemCategory[]) {
    const inCat = problems.filter((p) => p.cat === cat && p.score !== undefined);
    const levels = levelsByQuantile(inCat.map((p) => p.score!));
    inCat.forEach((p, i) => (p.level = levels[i]));
  }
  problems.sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
  const bank: ProblemBank = { version: 1, createdAt: new Date().toISOString(), engine: arg('engine', 'KataGo 1.18.1, g170e-b10c128')!, problems };
  mkdirSync(path.dirname(bankFile), { recursive: true });
  writeFileSync(bankFile, JSON.stringify(bank));
  const count = (c: string) => problems.filter((p) => p.cat === c).length;
  console.log(`bank: ${problems.length} problems (+${added}): life ${count('life')}, tesuji ${count('tesuji')}, endgame ${count('endgame')}, best move ${count('middle')}`);
}

function walkJsonl(dir: string): string[] {
  return readdirSync(dir)
    .filter((n) => n.endsWith('.jsonl') && !n.endsWith('.steps.jsonl'))
    .map((n) => path.join(dir, n));
}

if (arg('merge')) merge();
else await build();
