/**
 * Kami's training task factory: real positions from the repo's own data, explained by
 * KataGo through the explainer (the WASM engine in Node, scripts/explainNode.ts), become
 * tasks for the writer model. Every reference text is checked with checkAnswer first; a
 * reference that names a figure the explanation does not hold is dropped and counted.
 *
 *   npx tsx scripts/coachlm/factory.ts --out tasks.jsonl [--n 200] [--split train|eval]
 *     [--requests requests.jsonl] [--minutes 30] [--existing tasks.jsonl.gz ...] [--seed s]
 *     [--sources ogs,titles,broadcast,demo] [--games ogs-recent.jsonl.gz] [--sgf-dir dir]
 *
 * Positions: only games played in 2022 or later (XIAO's rule for Kami's training data):
 * human OGS games from the "game-data" release (--games, ogs-recent.jsonl.gz, 2022+), Japanese
 * title games from cwi.nl (--sgf-dir, DT 2022+ only), and the repo's own engine games made in
 * 2026 (public/broadcast) and KataGo-policy demo games (public/demo). The pro opening walks
 * (public/pro/openings.json, games from 1940-2017) are only used when --sources names "pro".
 * Not Forge problems:
 * on their tsumego frame KataGo sees a decided game (pass, 0% or 100%, 80 points), which
 * is no position to explain. Per position: best, overview, why-not on KataGo's candidates
 * 2-5 and why-move on the move actually played.
 * Train tasks read at Tesuji/medium, eval tasks at Tesuji/high. The split is fixed per
 * position (canonical hash, about 10% eval) and per concept, so the two never mix.
 * --existing: task files whose ids are skipped (and whose positions --requests may use).
 * Requests: {"taskId", "question": {"kind", "move": "R16" | null, "text"}} asks a new
 * question on an existing task's position; a move must be one of that task's variation
 * moves (KataGo's candidates and lines) or the request is dropped.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { checkAnswer } from '../../src/lib/coach/answerCheck';
import { explain, verifyDiagram, type ExplainPosition, type Explanation, type Question, type QuestionKind } from '../../src/lib/coach/explain';
import { illustrateDefaults } from '../../src/lib/coach/explain/diagrams';
import { diagramBlock, parseWriterDiagram, withoutDiagrams } from '../../src/lib/coach/explain/writerDiagram';
import { CONCEPTS, conceptById } from '../../src/lib/coach/library';
import { parseSgfFile } from '../../src/lib/go/sgf';
import { engineKomi } from '../../src/lib/go/rules';
import { canonicalMove, canonicalPosition, proStats, type CanonicalPosition, type ProExplorer } from '../../src/lib/coach/pro';
import { Board, replay } from '../../src/lib/go/board';
import { gtpToLoc, locToGtp, sgfToLoc } from '../../src/lib/go/coords';
import { PASS, other, type Color, type Loc, type Move } from '../../src/lib/go/types';
import { hashString } from '../../src/lib/util/hash';
import { PROMPT_VERSION } from '../../src/lib/coach/explain/prompt';
import { nodeProber } from '../explainNode';
import { conceptTask, positionTask, readJsonl, splitOf, writeJsonl, type Split, type Task } from './tasks';

const { values: arg } = parseArgs({
  options: {
    out: { type: 'string' },
    n: { type: 'string', default: '200' },
    split: { type: 'string', default: 'train' },
    requests: { type: 'string' },
    minutes: { type: 'string', default: '30' },
    existing: { type: 'string', multiple: true, default: [] },
    seed: { type: 'string' },
    sources: { type: 'string' },
    games: { type: 'string' },
    'sgf-dir': { type: 'string' },
  },
});
if (!arg.out) throw new Error('usage: factory.ts --out tasks.jsonl [--n 200] [--split train|eval] [--requests requests.jsonl] [--minutes 30]');
const OUT = arg.out;
const N = Math.max(1, Number(arg.n));
const SPLIT = arg.split as Split;
if (SPLIT !== 'train' && SPLIT !== 'eval') throw new Error('--split is train or eval');
const DEADLINE = Date.now() + Number(arg.minutes) * 60_000;
const THINKING = SPLIT === 'eval' ? 'high' : 'medium';
const SEED = arg.seed ?? new Date().toISOString().slice(0, 10);

const root = new URL('../../', import.meta.url);
const readJson = <T>(p: string): T => JSON.parse(readFileSync(new URL(p, root), 'utf8')) as T;

function rng(seedText: string) {
  let s = parseInt(hashString(seedText).slice(0, 8), 16) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(`${SEED}|${SPLIT}`);
const pickOne = <T>(xs: readonly T[], key: string): T => xs[parseInt(hashString(key).slice(0, 8), 16) % xs.length];

// --- positions from the repo ---------------------------------------------------------

interface Spot {
  source: string;
  pos: ExplainPosition;
  /** The move actually played next (games and pro walks). */
  played?: Loc;
}

interface GameRow {
  size: number;
  komi: number;
  setup: Move[];
  moves: Move[];
}

let demo: GameRow[] | null = null;
let broadcast: GameRow[] | null = null;
let pro: ProExplorer | null = null;

function gameSpot(source: string, games: GameRow[]): Spot | null {
  const g = games[Math.floor(rand() * games.length)];
  if (!g || g.moves.length < 30) return null;
  const k = 8 + Math.floor(rand() * (g.moves.length - 20));
  const played = g.moves[k];
  if (!played || played.loc === PASS) return null;
  return { source, pos: { size: g.size, komi: g.komi, setup: g.setup, moves: g.moves.slice(0, k), toPlay: played.color }, played: played.loc };
}

function demoSpot(): Spot | null {
  demo ??= readJson<{ games: GameRow[] }>('public/demo/demo.json').games.filter((g) => g.size === 19);
  return gameSpot('demo', demo);
}

function broadcastSpot(): Spot | null {
  broadcast ??= readJson<{ games: { size: number; komi: number; moves: string }[] }>('public/broadcast/games.json').games.map((g) => {
    const moves: Move[] = [];
    for (let i = 0; i + 1 < g.moves.length; i += 2) moves.push({ color: (moves.length % 2 === 0 ? 1 : 2) as Color, loc: sgfToLoc(g.moves.slice(i, i + 2), g.size) });
    return { size: g.size, komi: g.komi, setup: [], moves };
  });
  return gameSpot('broadcast', broadcast);
}

/** A walk down the pro opening tree, each step a move pros played, weighted by how often. */
function proSpot(): Spot | null {
  pro ??= readJson<ProExplorer>('public/pro/openings.json');
  const depth = 2 + Math.floor(rand() * 30);
  const board = new Board(19);
  const moves: Move[] = [];
  let color: Color = 1;
  for (let i = 0; i <= depth; i++) {
    const st = proStats(pro, board.stones, color, 19);
    if (!st || !st.moves.length) break;
    let x = rand() * st.moves.reduce((s, m) => s + m.count, 0);
    let pick = st.moves[0];
    for (const m of st.moves) {
      x -= m.count;
      if (x <= 0) {
        pick = m;
        break;
      }
    }
    if (i === depth) return { source: 'pro', pos: { size: 19, komi: 7.5, setup: [], moves, toPlay: color }, played: pick.loc };
    board.play(pick.loc, color, true);
    moves.push({ color, loc: pick.loc });
    color = other(color);
  }
  return moves.length >= 2 ? { source: 'pro', pos: { size: 19, komi: 7.5, setup: [], moves, toPlay: color } } : null;
}

/** First year of games Kami trains on. */
const FROM_YEAR = 2022;
const recent = (date: string | undefined) => !!date && Number(date.slice(0, 4)) >= FROM_YEAR;

let ogs: GameRow[] | null = null;
let titles: GameRow[] | null = null;

function rowOf(sgf: string, date?: string): GameRow | null {
  const g = parseSgfFile(sgf).games[0];
  if (!g || g.size !== 19 || g.moves.length < 30 || !recent(date ?? g.date)) return null;
  return { size: g.size, komi: engineKomi(g.komi, g.rules), setup: g.setup, moves: g.moves };
}

/** Human OGS games from 2022 on (the "game-data" release, ogs-recent.jsonl.gz). */
function ogsSpot(): Spot | null {
  if (!ogs) {
    const f = arg.games;
    ogs = [];
    if (f && existsSync(f)) {
      const raw = readFileSync(f);
      const text = (f.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line) as { sgf: string; date?: string };
          const row = rowOf(r.sgf, r.date);
          if (row) ogs.push(row);
        } catch {
          /* a bad line */
        }
      }
      console.log(`  ogs: ${ogs.length} games from ${FROM_YEAR} on`);
    }
  }
  return ogs.length ? gameSpot('ogs', ogs) : null;
}

/** Japanese title games from 2022 on (SGF files, e.g. cwi.nl's Kisei/Meijin/Honinbo). */
function titleSpot(): Spot | null {
  if (!titles) {
    titles = [];
    const dir = arg['sgf-dir'];
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.toLowerCase().endsWith('.sgf') ? [path.join(d, e.name)] : []));
    if (dir && existsSync(dir)) {
      for (const f of walk(dir)) {
        const row = rowOf(readFileSync(f, 'utf8'));
        if (row) titles.push(row);
      }
      console.log(`  titles: ${titles.length} games from ${FROM_YEAR} on`);
    }
  }
  return titles.length ? gameSpot('titles', titles) : null;
}

const ALL_SOURCES: [string, number, () => Spot | null][] = [
  ['ogs', 0.4, ogsSpot],
  ['titles', 0.2, titleSpot],
  ['broadcast', 0.25, broadcastSpot],
  ['demo', 0.15, demoSpot],
  ['pro', 0.3, proSpot],
];
// Default: everything from 2022 on that is here (the pro walks are older, so only on request).
const wanted = arg.sources ? arg.sources.split(',') : ['broadcast', 'demo', ...(arg.games && existsSync(arg.games) ? ['ogs'] : []), ...(arg['sgf-dir'] && existsSync(arg['sgf-dir']) ? ['titles'] : [])];
const SOURCES = ALL_SOURCES.filter(([n]) => wanted.includes(n));
if (!SOURCES.length) throw new Error(`--sources: pick from ${ALL_SOURCES.map(([n]) => n).join(',')}`);

function nextSpot(): Spot | null {
  let x = rand() * SOURCES.reduce((s, [, w]) => s + w, 0);
  for (const [, w, f] of SOURCES) {
    if ((x -= w) <= 0) return f();
  }
  return SOURCES[0][2]();
}

/** The position's key: the same for all eight orientations, so a rotated copy never lands in the other split. */
function positionKey(pos: ExplainPosition) {
  const board = replay(pos.size, pos.setup, pos.moves);
  return canonicalPosition(board.stones, pos.toPlay, pos.size);
}

// --- questions -----------------------------------------------------------------------

const colorName = (c: Color) => (c === 1 ? 'Black' : 'White');
const TEMPLATES: Record<QuestionKind, string[]> = {
  best: ['What should I play here?', 'What is the best move for {c}?', 'Where should {c} play now?', "What's the key point in this position?"],
  overview: ['Explain this position.', 'Who is ahead here, and why?', 'What is going on in this position?', 'Can you give me an overview of this position?'],
  'why-not': ['Why not {m}?', "What's wrong with {m}?", 'Can {c} play {m} instead?', 'Is {m} a good move here?'],
  'why-move': ['Why was {m} played here?', 'Was {m} a good move?', 'What does {m} do here?', 'Is {m} good or bad?'],
};

function questionFor(kind: QuestionKind, pos: ExplainPosition, key: string, move?: Loc): Question {
  const m = move === undefined ? '' : locToGtp(move, pos.size);
  const text = pickOne(TEMPLATES[kind], `${key}|${kind}|${m}`).replace('{m}', m).replace('{c}', colorName(pos.toPlay));
  return move === undefined ? { kind, text } : { kind, move, text };
}

// --- the run -------------------------------------------------------------------------

const t0 = Date.now();
const seen = new Set<string>();
const existing = arg.existing.flatMap((f) => readJsonl<Task>(f));
for (const t of existing) seen.add(t.id);
const existingCount = seen.size;
const plain = !OUT.endsWith('.gz');
if (plain) writeFileSync(OUT, '');
const rows: Task[] = [];
const stats = { position: 0, concept: 0, request: 0, diagram: 0, diagramFailed: 0, dup: 0, refFailed: 0, noRead: 0, explains: 0, explainMs: 0, reqDropped: 0, bySource: {} as Record<string, number> };
const refFailures: string[] = [];
const timeUp = () => Date.now() > DEADLINE;
const done = () => rows.length >= N || timeUp();

function emit(t: Task, source: string) {
  rows.push(t);
  seen.add(t.id);
  stats.bySource[source] = (stats.bySource[source] ?? 0) + 1;
  if (plain) appendFileSync(OUT, JSON.stringify(t) + '\n');
  if (rows.length % 10 === 0) {
    const min = (Date.now() - t0) / 60_000;
    console.log(`  ${rows.length} tasks, ${(rows.length / min).toFixed(1)}/min, ${stats.explains ? (stats.explainMs / stats.explains / 1000).toFixed(1) : '-'} s per explain`);
  }
}

console.log(`factory: split ${SPLIT}, Tesuji/${THINKING}, up to ${N} tasks or ${arg.minutes} min, seed ${SEED}, ${existingCount} existing ids, prompt v${PROMPT_VERSION}`);

// Concept tasks: cheap (no engine), at most a fifth of the run.
if (!CONCEPTS.length) console.log('  concept library is empty: no concept tasks');
const conceptCap = Math.ceil(N * 0.2);
for (const c of CONCEPTS) {
  const qs = [`What is ${c.name}?`, `Can you explain ${c.name} in Go?`, `When does ${c.name} matter in a game?`, `What do players often get wrong about ${c.name}?`];
  if (c.aliases[0]) qs.push(`What does ${c.aliases[0]} mean?`);
  for (const q of qs) {
    if (stats.concept >= conceptCap || done()) break;
    const t = conceptTask(c, q);
    if (t.split !== SPLIT) continue;
    if (seen.has(t.id)) {
      stats.dup++;
      continue;
    }
    stats.concept++;
    emit(t, 'concept');
  }
}

const prober = await nodeProber();

/** One task: explain, check the engine's own text, keep it. Ids ignore the template wording, so a position and question are made once. */
function taskId(pos: ExplainPosition, q: Question, c: CanonicalPosition, custom: boolean): string {
  const cm = q.move === undefined ? '' : String(canonicalMove(c, q.move, pos.size));
  return `p-${hashString(`${PROMPT_VERSION}|${c.key}|${pos.komi}|${q.kind}|${cm}|${custom ? q.text.trim().toLowerCase() : ''}`)}`;
}

async function make(pos: ExplainPosition, q: Question, split: Split, c: CanonicalPosition, source: string, custom = false): Promise<boolean> {
  const id = taskId(pos, q, c, custom);
  if (seen.has(id)) {
    stats.dup++;
    return false;
  }
  if (done()) return false;
  const t1 = Date.now();
  let ex: Explanation;
  try {
    ex = await explain(pos, q, prober, { model: 'tesuji', thinking: THINKING, examplesFor });
  } catch (e) {
    console.log(`  explain failed: ${(e as Error).message}`);
    stats.noRead++;
    return false;
  }
  stats.explains++;
  stats.explainMs += Date.now() - t1;
  if (!ex.facts.length || !ex.variations.length) {
    stats.noRead++;
    return false;
  }
  const t = positionTask(id, split, ex);
  const score = checkAnswer(ex, t.reference);
  if (score.truth < 1) {
    stats.refFailed++;
    if (refFailures.length < 8) refFailures.push(`${q.kind}: ${score.unsupported.join(', ')}`);
    return false;
  }
  emit(t, source);
  if (ex.illustrations?.length) await diagramTask(id, split, ex, source);
  return true;
}

const examplesFor = (id: string) => conceptById(id)?.examples ?? [];

/**
 * The writer asking for a diagram itself: the explanation without its checked diagram, and a
 * reference that ends with that diagram as a DIAGRAM block. Kept only when the block, parsed
 * back as the site parses it, passes every check again (KataGo's final read last) and the
 * whole reference passes checkAnswer against the explanation with it.
 */
async function diagramTask(baseId: string, split: Split, ex: Explanation, source: string) {
  const d = ex.illustrations![0];
  const id = `${baseId}-own-diagram`;
  if (seen.has(id) || done()) return;
  const bare = withoutDiagrams(ex);
  const block = diagramBlock(d);
  if (!block) return;
  const t = positionTask(id, split, bare);
  const parsed = parseWriterDiagram(`${t.reference}\n\n${block}`, ex.position.size);
  if (!parsed.spec) return;
  const io = illustrateDefaults('tesuji', THINKING) ?? undefined;
  const v = await verifyDiagram(parsed.spec, prober, d.id, io, undefined);
  if (!v.illustration) {
    stats.diagramFailed++;
    return;
  }
  const lead = `A diagram shows the idea on its own [[${d.id}]]: ${v.facts.map((f) => f.text.replace(/^In diagram \[\[d\d+\]\], /, '')).join(' ')}`;
  const reference = `${t.reference}\n\n${lead}\n\n${block}`;
  const withD: Explanation = { ...bare, illustrations: [v.illustration], facts: [...bare.facts, ...v.facts] };
  if (checkAnswer(withD, `${t.reference}\n\n${lead}`).truth < 1) {
    stats.diagramFailed++;
    return;
  }
  stats.diagram++;
  emit({ ...t, reference }, source);
}

// Requests: new questions on positions the trainer already has.
if (arg.requests) {
  const byId = new Map<string, Task>();
  for (const t of existing) byId.set(t.id, t);
  for (const r of readJsonl<{ taskId: string; question: { kind: QuestionKind; move: string | null; text: string } }>(arg.requests)) {
    if (done()) break;
    const base = byId.get(r.taskId);
    const ex = base?.explanation;
    const kind = r.question?.kind;
    if (!base || !ex || base.split !== SPLIT || !['best', 'overview', 'why-not', 'why-move'].includes(kind) || !r.question.text?.trim()) {
      stats.reqDropped++;
      continue;
    }
    const pos = ex.position;
    const q: Question = { kind, text: r.question.text.trim().slice(0, 300) };
    if (kind === 'why-not' || kind === 'why-move') {
      const known = new Set<Loc>(ex.variations.flatMap((v) => v.moves.map((m) => m.loc)));
      if (ex.question.move !== undefined) known.add(ex.question.move);
      const loc = r.question.move ? gtpToLoc(r.question.move, pos.size) : PASS;
      if (loc === PASS || Number.isNaN(loc) || loc < 0 || loc >= pos.size * pos.size || !known.has(loc)) {
        stats.reqDropped++;
        continue;
      }
      q.move = loc;
    }
    if (await make(pos, q, base.split, positionKey(pos), 'request', true)) stats.request++;
  }
}

// Positions.
let misses = 0;
const used = new Set<string>();
while (!done() && misses < 20_000) {
  const spot = nextSpot();
  if (!spot) {
    misses++;
    continue;
  }
  const c = positionKey(spot.pos);
  if (splitOf(`pos|${c.key}`) !== SPLIT || used.has(c.key)) {
    misses++;
    continue;
  }
  used.add(c.key);
  // A position whose "best" task exists was made on an earlier run: skip it before reading.
  if (seen.has(taskId(spot.pos, questionFor('best', spot.pos, c.key), c, false))) {
    stats.dup++;
    misses++;
    continue;
  }
  const read = await prober.read(spot.pos, { visits: 200, maxMs: 6000 });
  if (!read || !read.candidates.length) {
    stats.noRead++;
    continue;
  }
  const qs: Question[] = [questionFor('best', spot.pos, c.key), questionFor('overview', spot.pos, c.key)];
  for (const cand of read.candidates.slice(1, 5)) if (cand.loc !== PASS && cand.visits >= 2) qs.push(questionFor('why-not', spot.pos, c.key, cand.loc));
  if (spot.played !== undefined && spot.played !== PASS) qs.push(questionFor('why-move', spot.pos, c.key, spot.played));
  for (const q of qs) {
    if (done()) break;
    if (await make(spot.pos, q, SPLIT, c, spot.source)) stats.position++;
  }
}

if (!plain) writeJsonl(OUT, rows);
const min = (Date.now() - t0) / 60_000;
console.log(
  `factory: ${rows.length} tasks (${stats.position} position, ${stats.request} from requests, ${stats.concept} concept, ${stats.diagram} own-diagram, ${stats.diagramFailed} own-diagram failed) in ${min.toFixed(1)} min = ${(rows.length / Math.max(min, 1e-9)).toFixed(1)} tasks/min; ` +
    `${stats.explains} explains at ${stats.explains ? (stats.explainMs / stats.explains / 1000).toFixed(1) : '-'} s each`,
);
console.log(`  by source ${JSON.stringify(stats.bySource)}; skipped: ${stats.dup} duplicates, ${stats.refFailed} references that failed the check, ${stats.noRead} empty reads, ${stats.reqDropped} requests dropped`);
for (const f of refFailures) console.log(`  reference failed: ${f}`);
process.exit(0);
