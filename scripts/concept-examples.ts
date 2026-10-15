/**
 * Builds src/lib/coach/library/examples.ts: example positions for Kami's concept library,
 * each claim checked by KataGo (the site's WASM engine with the bundled b10 net, through
 * nodeProber). Every number in a note comes from these reads. An example whose check fails
 * is dropped and logged, never kept with a softened claim.
 *
 *   npx tsx scripts/concept-examples.ts                 # check all, write the file
 *   npx tsx scripts/concept-examples.ts --only ladder   # check some concepts, print, write nothing
 *   npx tsx scripts/concept-examples.ts --inspect --only ladder   # also print top moves
 *
 * Positions: small textbook diagrams (rows of X = Black, O = White, . = empty, top row first)
 * or real ones from public/problems/bank.json. Coordinates in specs are GTP ("D4"; column
 * letters skip I, row 1 is the bottom). Loc = y * size + x with y = 0 at the top.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Board, replay } from '../src/lib/go/board';
import { gtpToLoc, locToGtp, locToSgf } from '../src/lib/go/coords';
import { PASS, type Color, type Loc, type Move } from '../src/lib/go/types';
import { framePosition } from '../src/lib/problems/frame';
import { problemBoard } from '../src/lib/problems/play';
import type { Problem } from '../src/lib/problems/types';
import type { EngineRead, ExplainPosition, Prober } from '../src/lib/coach/explain/types';
import type { ExampleRecord } from '../src/lib/coach/library/types';
import { nodeProber } from './explainNode';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'src', 'lib', 'coach', 'library', 'examples.ts');
const TEXTBOOK = 'textbook diagram, checked by KataGo';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = opt('--only')?.split(',');
const VISITS = Number(opt('--visits') ?? 800);
const inspect = flag('--inspect');

const colorOf = (c: 'B' | 'W'): Color => (c === 'B' ? 1 : 2);
const otherColor = (c: Color): Color => (c === 1 ? 2 : 1);
const name = (c: Color) => (c === 1 ? 'Black' : 'White');

let bankCache: Problem[] | null = null;
function bankProblem(id: string): Problem {
  bankCache ??= (JSON.parse(readFileSync(path.join(root, 'public', 'problems', 'bank.json'), 'utf8')) as { problems: Problem[] }).problems;
  const p = bankCache.find((q) => q.id === id);
  if (!p) throw new Error(`no problem ${id} in the bank`);
  return p;
}

type View = [number, number, number, number];

const toSetup = (stones: ArrayLike<number>): Move[] => {
  const setup: Move[] = [];
  for (let l = 0; l < stones.length; l++) if (stones[l]) setup.push({ color: stones[l] as Color, loc: l });
  return setup;
};

/** Rows of X / O / . placed with their top-left at (x0, y0). */
function paint(stones: Int8Array, size: number, rows: string[], x0: number, y0: number, title: string) {
  rows.forEach((row, dy) => {
    const cells = row.replace(/\s+/g, '');
    [...cells].forEach((ch, dx) => {
      const x = x0 + dx, y = y0 + dy;
      if (x >= size || y >= size) throw new Error(`${title}: diagram runs off the board`);
      if (ch === 'X') stones[y * size + x] = 1;
      else if (ch === 'O') stones[y * size + x] = 2;
      else if (ch !== '.' && ch !== '+') throw new Error(`${title}: bad cell ${ch}`);
    });
  });
}

/** The position a spec describes (komi may still be 'even', fixed later from a read). */
function buildPosition(s: Spec): { pos: ExplainPosition; evenKomi: boolean; view?: View } {
  const komi = s.komi === 'even' ? 0 : s.komi;
  const evenKomi = s.komi === 'even';
  if (s.bank) {
    const p = bankProblem(s.bank);
    // Local problems get their tsumego frame back, as Forge plays them.
    const stones = problemBoard(p).stones;
    return { pos: { size: p.size, komi, setup: toSetup(stones), moves: [], toPlay: colorOf(p.toPlay) }, evenKomi, view: p.view };
  }
  const stones = new Int8Array(s.size * s.size);
  let view: View | undefined;
  if (s.local) {
    // A local diagram framed like Forge's problems: the attacker surrounds the window and
    // the rest of the board is settled, so the local question is the only one left.
    const { rows, at, attacker } = s.local;
    const w = rows[0].replace(/\s+/g, '').length;
    paint(stones, s.size, rows, at[0], at[1], s.title);
    view = [at[0], at[1], at[0] + w - 1, at[1] + rows.length - 1];
    const framed = framePosition(stones, s.size, { x0: view[0], y0: view[1], x1: view[2], y1: view[3] }, colorOf(attacker));
    if (!framed) throw new Error(`${s.title}: window too large to frame`);
    stones.set(framed);
  }
  if (s.diagram) {
    if (s.diagram.length !== s.size) throw new Error(`${s.title}: diagram has ${s.diagram.length} rows, size ${s.size}`);
    paint(stones, s.size, s.diagram, 0, 0, s.title);
  }
  for (const g of s.black ?? []) stones[gtpToLoc(g, s.size)] = 1;
  for (const g of s.white ?? []) stones[gtpToLoc(g, s.size)] = 2;
  return { pos: { size: s.size, komi, setup: toSetup(stones), moves: [], toPlay: colorOf(s.toPlay) }, evenKomi, view: s.view ?? view };
}

/** The line as moves, alternating from the side to move; 'pass' allowed. Throws on an illegal move. */
function lineMoves(pos: ExplainPosition, line: string[]): Move[] {
  const b = new Board(pos.size);
  for (const m of pos.setup) b.stones[m.loc] = m.color;
  // Setup must be a legal position: no chain without liberties.
  for (const g of b.groups()) if (g.liberties.length === 0) throw new Error('setup has a chain with no liberties');
  let c = pos.toPlay;
  const out: Move[] = [];
  for (const g of line) {
    const loc = g.toLowerCase() === 'pass' ? PASS : gtpToLoc(g, pos.size);
    if (!b.isLegal(loc, c)) throw new Error(`illegal move ${g} for ${name(c)}`);
    b.play(loc, c);
    out.push({ color: c, loc });
    c = otherColor(c);
  }
  return out;
}

const after = (pos: ExplainPosition, moves: Move[]): ExplainPosition => ({
  ...pos,
  moves: [...pos.moves, ...moves],
  toPlay: moves.length ? otherColor(moves[moves.length - 1].color) : pos.toPlay,
});

async function read(p: Prober, pos: ExplainPosition, visits = VISITS): Promise<EngineRead> {
  const r = await p.read(pos, { visits, maxMs: 120_000 });
  if (!r) throw new Error('engine gave no read');
  return r;
}

/** Lead for `c` (points), from a read. */
const leadFor = (r: EngineRead, c: Color) => (c === 1 ? r.bLead : -r.bLead);
const fmt = (x: number) => (Math.round(Math.abs(x) * 10) / 10).toFixed(1);
const scoreText = (r: EngineRead) => `${r.bLead >= 0 ? 'Black' : 'White'} leads by ${fmt(r.bLead)} points`;

function show(r: EngineRead, size: number) {
  return r.candidates
    .slice(0, 5)
    .map((c) => `${locToGtp(c.loc, size)} v${c.visits} ${c.scoreLead.toFixed(1)} [${c.pv.slice(0, 6).map((l) => locToGtp(l, size)).join(' ')}]`)
    .join(' | ');
}

/** Run a spec's checks; returns the example, or the reason it was dropped. */
async function check(p: Prober, s: Spec): Promise<{ ex?: ExampleRecord; why?: string; log: string[] }> {
  const log: string[] = [];
  const built = buildPosition(s);
  const { evenKomi, view } = built;
  let pos = built.pos;
  if (evenKomi) {
    // As the problem bank does: komi that makes the position even for the side to move.
    const r0 = await read(p, pos, 200);
    pos = { ...pos, komi: Math.round(r0.bLead * 2) / 2 };
    log.push(`komi set to ${pos.komi}`);
  }
  let line: Move[];
  try {
    line = lineMoves(pos, s.line);
  } catch (e) {
    return { why: `illegal: ${(e as Error).message}`, log };
  }
  const mover = pos.toPlay;
  const vars: Record<string, string> = {};
  let rootRead: EngineRead | null = null;
  const getRoot = async () => (rootRead ??= await read(p, pos));
  if (inspect) log.push(`root: ${show(await getRoot(), pos.size)}`);

  for (const c of s.checks) {
    const key = c.key ?? c.kind;
    if (c.kind === 'top') {
      const r = await getRoot();
      const best = r.candidates[0];
      const mine = r.candidates.find((x) => x.loc === line[0].loc);
      const loss = mine ? best.scoreLead - mine.scoreLead : Infinity;
      log.push(`top: best ${locToGtp(best.loc, pos.size)} (${best.scoreLead.toFixed(1)}), ${s.line[0]} ${mine ? `${mine.scoreLead.toFixed(1)} v${mine.visits}` : 'not searched'}`);
      if (best.loc !== line[0].loc && !(c.maxLoss !== undefined && mine && mine.visits >= 20 && loss <= c.maxLoss))
        return { why: `${s.line[0]} is not KataGo's choice (best ${locToGtp(best.loc, pos.size)}, loss ${fmt(loss)})`, log };
      const chosen = mine ?? best;
      vars.rank = best.loc === line[0].loc ? 'is KataGo’s first choice' : `is within ${fmt(loss)} points of KataGo’s first choice`;
      vars.lead = fmt(chosen.scoreLead);
      vars.win = `${Math.round(chosen.winrate * 100)}%`;
      vars.score = `${chosen.scoreLead >= 0 ? name(mover) : name(otherColor(mover))} leads by ${fmt(chosen.scoreLead)} points`;
      vars.loss = fmt(Math.max(0, loss));
      vars.visits = String(r.visits);
    } else if (c.kind === 'beats' || c.kind === 'loses') {
      // The first move of the line against an alternative, each read with the opponent to move.
      const alt = lineMoves(pos, [c.alt]);
      const ra = await read(p, after(pos, line.slice(0, 1)));
      const rb = await read(p, after(pos, alt));
      const gain = leadFor(ra, mover) - leadFor(rb, mover);
      log.push(`${c.kind}: ${s.line[0]} ${leadFor(ra, mover).toFixed(1)} vs ${c.alt} ${leadFor(rb, mover).toFixed(1)} → ${gain.toFixed(1)}`);
      if (c.kind === 'beats' && gain < c.minGain) return { why: `${s.line[0]} beats ${c.alt} by only ${gain.toFixed(1)} (needs ${c.minGain})`, log };
      if (c.kind === 'loses' && -gain < c.minLoss) return { why: `${s.line[0]} loses only ${(-gain).toFixed(1)} against ${c.alt} (needs ${c.minLoss})`, log };
      vars[key] = fmt(gain);
      vars[`${key}Score`] = scoreText(ra);
      vars[`${key}AltScore`] = scoreText(rb);
    } else if (c.kind === 'illegal') {
      const b = replay(pos.size, pos.setup, line.slice(0, c.after));
      const side = c.after ? otherColor(line[c.after - 1].color) : mover;
      const ok = !b.isLegal(gtpToLoc(c.move, pos.size), side);
      log.push(`illegal: ${c.move} for ${name(side)} after ${c.after} moves: ${ok ? 'illegal' : 'LEGAL'}`);
      if (!ok) return { why: `${c.move} is legal after ${c.after} moves`, log };
    } else if (c.kind === 'swing') {
      // What the point is worth: the mover playing it against the opponent playing it there
      // (the mover passes first). The difference is the "deiri" (swing) value.
      const mine = await read(p, after(pos, line.slice(0, 1)));
      const theirs = await read(p, after(pos, [{ color: mover, loc: PASS }, { color: otherColor(mover), loc: line[0].loc }]));
      const swing = leadFor(mine, mover) - leadFor(theirs, mover);
      log.push(`swing: ${s.line[0]} for ${name(mover)} ${leadFor(mine, mover).toFixed(1)}, for the opponent ${leadFor(theirs, mover).toFixed(1)} → ${swing.toFixed(1)}`);
      if (swing < c.minSwing) return { why: `swing only ${swing.toFixed(1)} (needs ${c.minSwing})`, log };
      if (c.maxSwing !== undefined && swing > c.maxSwing) return { why: `swing ${swing.toFixed(1)} (more than ${c.maxSwing})`, log };
      vars[key] = fmt(swing);
      vars[`${key}Half`] = fmt(swing / 2);
    } else if (c.kind === 'owns') {
      const k = c.after ?? s.line.length;
      const r = await read(p, after(pos, line.slice(0, k)));
      if (!r.ownership) return { why: 'no ownership in read', log };
      const sign = c.color === 'B' ? 1 : -1;
      const pts = c.points.map((g) => gtpToLoc(g, pos.size));
      const avg = pts.reduce((a, l) => a + sign * r.ownership![l], 0) / pts.length;
      log.push(`owns: after ${k} moves, ${c.color} owns ${c.points.join(' ')} at ${avg.toFixed(2)}${inspect ? ` | ${show(r, pos.size)}` : ''}`);
      if (avg < c.min) return { why: `${c.color} owns ${c.points.join(' ')} only ${avg.toFixed(2)} after ${k} moves (needs ${c.min})`, log };
      vars[key] = `${Math.round(avg * 100)}%`;
      vars[`${key}Score`] = scoreText(r);
    } else if (c.kind === 'reply') {
      const k = c.after ?? 1;
      const r = await read(p, after(pos, line.slice(0, k)));
      const best = r.candidates[0];
      log.push(`reply: after ${k}, best ${locToGtp(best.loc, pos.size)} (${show(r, pos.size)})`);
      if (best.loc !== line[k].loc) return { why: `after ${k} moves KataGo answers ${locToGtp(best.loc, pos.size)}, not ${s.line[k]}`, log };
      vars[`${key}Score`] = scoreText(r);
    } else if (c.kind === 'tenuki') {
      // Cost of ignoring line[k-1]: the side that should answer passes instead (a stand-in
      // for playing elsewhere in a settled position).
      const k = c.after ?? 1;
      const answerer = otherColor(line[k - 1].color);
      const r1 = await read(p, after(pos, line.slice(0, k)));
      const r2 = await read(p, after(pos, [...line.slice(0, k), { color: answerer, loc: PASS }]));
      const cost = leadFor(r1, answerer) - leadFor(r2, answerer);
      log.push(`tenuki: answering keeps ${leadFor(r1, answerer).toFixed(1)}, ignoring gives ${leadFor(r2, answerer).toFixed(1)} → cost ${cost.toFixed(1)}`);
      if (cost < c.minCost) return { why: `ignoring costs only ${cost.toFixed(1)} (needs ${c.minCost})`, log };
      if (c.maxCost !== undefined && cost > c.maxCost) return { why: `ignoring costs ${cost.toFixed(1)} (more than ${c.maxCost})`, log };
      vars[key] = fmt(cost);
    }
  }
  const missing = [...s.note.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => !(k in vars));
  if (missing.length) throw new Error(`${s.title}: note uses ${missing.join(', ')} that no check sets`);
  const note = s.note.replace(/\{(\w+)\}/g, (_, k: string) => vars[k]);
  if (line.some((m) => m.loc === PASS)) throw new Error(`${s.title}: lines may not contain passes`);
  const stones = (c: Color) => pos.setup.filter((m) => m.color === c).map((m) => locToSgf(m.loc, pos.size)).join('');
  return {
    ex: {
      concept: s.concept,
      title: s.title,
      size: pos.size,
      komi: pos.komi,
      toPlay: pos.toPlay === 1 ? 'B' : 'W',
      black: stones(1),
      white: stones(2),
      line: line.map((m) => locToSgf(m.loc, pos.size)).join(''),
      note,
      source: s.source ?? TEXTBOOK,
      ...(view ? { view } : {}),
    },
    log,
  };
}

async function main() {
  const specs = SPECS.filter((s) => !only || only.includes(s.concept));
  const probers = new Map<number, Prober>();
  const out: ExampleRecord[] = [];
  const dropped: string[] = [];
  const t0 = Date.now();
  for (const s of specs) {
    const size = s.bank ? bankProblem(s.bank).size : s.size;
    if (!probers.has(size)) probers.set(size, await nodeProber(size));
    const res = await check(probers.get(size)!, s);
    const head = `${res.ex ? 'KEEP' : 'DROP'} ${s.concept}: ${s.title}`;
    console.log(head);
    for (const l of res.log) console.log(`    ${l}`);
    if (res.ex) {
      console.log(`    note: ${res.ex.note}`);
      out.push(res.ex);
    } else {
      console.log(`    why: ${res.why}`);
      dropped.push(`${s.concept}: ${s.title} (${res.why})`);
    }
  }
  const kept = out.length;
  console.log(`\n${kept} kept, ${dropped.length} dropped, ${Math.round((Date.now() - t0) / 1000)} s at ${VISITS} visits`);
  for (const d of dropped) console.log(`  dropped ${d}`);
  if (only) return console.log('(--only: nothing written)');
  // One record per line: small diffs, small file (stones as SGF coordinates, like bank.json).
  const body = out.map((r) => `  ${JSON.stringify(r)},`).join('\n');
  writeFileSync(
    OUT,
    `// Generated by scripts/concept-examples.ts (KataGo g170e-b10c128 via nodeProber, ${VISITS} visits). Do not edit by hand.\n` +
      `// ${kept} examples kept, ${dropped.length} dropped. Every number in a note comes from these reads.\n` +
      `import type { ExampleRecord } from './types';\n\n` +
      `export const EXAMPLE_RECORDS: ExampleRecord[] = [\n${body}\n];\n`,
  );
  console.log(`wrote ${path.relative(root, OUT)}`);
}

// ---------------------------------------------------------------------------------------
// The examples. Each check must pass or the example is dropped. Keys in {braces} in a note
// are filled from the checks (see check()); the note may not state any other number.

type Check =
  /** line[0] is KataGo's top move, or within maxLoss points of it. Sets lead, win, score, loss. */
  | { kind: 'top'; maxLoss?: number; key?: string }
  /** line[0] is better than `alt` by at least minGain points. Sets <key> (default 'beats'). */
  | { kind: 'beats'; alt: string; minGain: number; key?: string }
  /** line[0] is worse than `alt` by at least minLoss points. Sets <key> (default 'loses'). */
  | { kind: 'loses'; alt: string; minLoss: number; key?: string }
  /** After `after` moves of the line (default all), `color` owns `points` (average ownership ≥ min). */
  | { kind: 'owns'; points: string[]; color: 'B' | 'W'; min: number; after?: number; key?: string }
  /** After `after` moves (default 1), KataGo's top answer is line[after]. */
  | { kind: 'reply'; after?: number; key?: string }
  /** Ignoring move line[after-1] (a pass as stand-in for elsewhere) costs ≥ minCost points. */
  | { kind: 'tenuki'; minCost: number; maxCost?: number; after?: number; key?: string }
  /** line[0] for the mover against the same point for the opponent: the swing (deiri) value. */
  | { kind: 'swing'; minSwing: number; maxSwing?: number; key?: string }
  /** Rules check (board, not KataGo): after `after` moves, `move` is illegal for the side to move. */
  | { kind: 'illegal'; move: string; after: number; key?: string };

interface Spec {
  /** Library id the example belongs to. */
  concept: string;
  title: string;
  size: number;
  /** 'even': komi that makes the start even for the side to move (as the problem bank does). */
  komi: number | 'even';
  /** Ignored for bank positions (the problem says who plays). */
  toPlay: 'B' | 'W';
  /** Whole-board diagram, size rows. */
  diagram?: string[];
  /** A local diagram with its top-left at `at`, framed like Forge's problems (attacker surrounds it). */
  local?: { rows: string[]; at: [number, number]; attacker: 'B' | 'W' };
  black?: string[];
  white?: string[];
  /** A problem id from public/problems/bank.json (the real position, with its frame). */
  bank?: string;
  /** The window that matters, when not set by `local` or the bank. */
  view?: [number, number, number, number];
  line: string[];
  checks: Check[];
  note: string;
  source?: string;
}

const SPECS: Spec[] = [
  {
    concept: 'ladder',
    title: 'A ladder that works',
    size: 19,
    komi: 7.5,
    toPlay: 'B',
    black: ['E6', 'F5', 'G5', 'Q16', 'Q4'],
    white: ['F6', 'D16', 'C4'],
    line: ['F7', 'G6', 'H6', 'G7', 'G8', 'H7', 'J7', 'H8'],
    checks: [{ kind: 'owns', after: 1, points: ['F6'], color: 'B', min: 0.8 }],
    note: 'After the atari at F7, KataGo already counts the White stone as Black’s ({owns}): every escape leaves two liberties and the chase runs to Black’s stone at Q16.',
  },
  {
    concept: 'ladder',
    title: 'A ladder breaker',
    size: 19,
    komi: 7.5,
    toPlay: 'B',
    black: ['E6', 'F5', 'G5', 'D16', 'Q4'],
    white: ['F6', 'Q16', 'C4'],
    line: ['F7', 'G6', 'H6', 'G7', 'G8', 'H7', 'J7', 'H8'],
    checks: [{ kind: 'owns', after: 2, points: ['F6', 'G6'], color: 'W', min: 0.3 }],
    note: 'Same shape, but White owns Q16 on the ladder’s path: after F7 and G6, KataGo gives the White stones to White ({owns}).',
  },
  {
    concept: 'net',
    title: 'The net when the ladder fails',
    size: 19,
    komi: 7.5,
    toPlay: 'B',
    black: ['E6', 'F5', 'G5', 'D16', 'Q4'],
    white: ['F6', 'Q16', 'C4'],
    line: ['G7'],
    checks: [
      { kind: 'top', maxLoss: 1 },
      { kind: 'owns', points: ['F6'], color: 'B', min: 0.8 },
    ],
    note: 'G7 blocks both ways out at once; KataGo gives the White stone to Black ({owns}) without any ladder.',
  },
  {
    concept: 'eyes',
    title: 'Straight three: the middle point',
    size: 19,
    komi: 'even',
    toPlay: 'B',
    local: { rows: ['OOOOOOO', 'OXXXXXO', 'OX...XO'], at: [0, 16], attacker: 'W' },
    line: ['D1'],
    checks: [
      { kind: 'top' },
      { kind: 'owns', points: ['B2', 'C2', 'D2', 'E2', 'F2'], color: 'B', min: 0.8 },
    ],
    note: 'D1 splits the three-point space into two separate eyes; KataGo then counts the Black stones as alive ({owns}).',
  },
  {
    concept: 'life-and-death',
    title: 'The same point kills',
    size: 19,
    komi: 'even',
    toPlay: 'W',
    local: { rows: ['OOOOOOO', 'OXXXXXO', 'OX...XO'], at: [0, 16], attacker: 'W' },
    line: ['D1'],
    checks: [
      { kind: 'top' },
      { kind: 'owns', points: ['B2', 'C2', 'D2', 'E2', 'F2'], color: 'W', min: 0.8 },
    ],
    note: 'White takes the vital point first and the space can no longer be split into two eyes; KataGo counts the Black group as dead ({owns}).',
  },
  {
    concept: 'opening-principles',
    title: 'Corner first',
    size: 19,
    komi: 7.5,
    toPlay: 'B',
    line: ['Q16'],
    checks: [
      { kind: 'top', maxLoss: 0.5 },
      { kind: 'beats', alt: 'K10', minGain: 0.5, key: 'tengen' },
      { kind: 'beats', alt: 'Q10', minGain: 0.5, key: 'side' },
    ],
    note: 'On the empty board the 4-4 point {rank} ({score}); the center point costs {tengen} points and the side star point {side}.',
  },
  {
    concept: 'three-three-invasion',
    title: 'Early 3-3 under a lone star point',
    size: 19,
    komi: 7.5,
    toPlay: 'W',
    black: ['Q16', 'D4', 'Q4'],
    white: ['D16'],
    line: ['R17'],
    checks: [{ kind: 'top', maxLoss: 1 }],
    note: 'The immediate 3-3 invasion {rank} here, on move 5.',
  },
];

await main();
