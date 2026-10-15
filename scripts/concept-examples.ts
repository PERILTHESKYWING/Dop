/**
 * Builds src/lib/coach/library/examples.ts: example positions for Kami's concept library,
 * each claim checked by KataGo (the site's WASM engine with the bundled b10 net, through
 * nodeProber). Every number in a note comes from these reads. An example whose check fails
 * is dropped and logged, never kept with a softened claim.
 *
 *   npx tsx scripts/concept-examples.ts                 # check all, write the file
 *   npx tsx scripts/concept-examples.ts --only ladder   # check some concepts, print, write nothing
 *   npx tsx scripts/concept-examples.ts --inspect --only ladder   # also print top moves
 *   npx tsx scripts/concept-examples.ts --only ladder --merge     # replace only those in the file
 *
 * Positions: framed local diagrams (rows of X = Black, O = White, . = empty, top row first,
 * surrounded by a Forge-style tsumego frame), stones on an open board, or real positions from
 * public/problems/bank.json. Coordinates in specs are GTP ("D4"; column letters skip I, row 1
 * is the bottom). Loc = y * size + x with y = 0 at the top. Run time: about 25 minutes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Board, replay } from '../src/lib/go/board';
import { chebyshev, gtpToLoc, locToGtp, locToSgf, sgfToLoc } from '../src/lib/go/coords';
import { PASS, type Color, type Move } from '../src/lib/go/types';
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

/**
 * The position with its setup stones as alternating moves (passes pad the shorter colour).
 * Workaround: the prober feeds setup through engineMoves (all Black stones, then all White
 * ones), and the engine misreads that: the same 8 stones read B+55.6 that way and B+26.7
 * alternating, and framed problems read B+80..96 at any komi. Alternating reads correctly.
 */
export function alternating(pos: ExplainPosition): ExplainPosition {
  const q: Record<Color, Move[]> = { 1: [], 2: [] };
  for (const m of pos.setup) q[m.color].push(m);
  const seq: Move[] = [];
  let c: Color = 1;
  while (q[1].length || q[2].length) {
    seq.push(q[c].shift() ?? { color: c, loc: PASS });
    c = otherColor(c);
  }
  // The last setup move must be by the side that does not move next.
  const next = pos.moves[0]?.color ?? pos.toPlay;
  const last = seq[seq.length - 1];
  if (last && last.color === next) {
    if (last.loc === PASS) seq.pop();
    else seq.push({ color: otherColor(next), loc: PASS });
  }
  return { ...pos, setup: [], moves: [...seq, ...pos.moves] };
}

async function read(p: Prober, pos: ExplainPosition, visits = VISITS): Promise<EngineRead> {
  const r = await p.read(alternating(pos), { visits, maxMs: 120_000 });
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
  // {m1}, {m2}, ...: the line's moves as board coordinates, so notes never spell them by hand.
  const vars: Record<string, string> = Object.fromEntries(line.map((m, i) => [`m${i + 1}`, locToGtp(m.loc, pos.size)]));
  let rootRead: EngineRead | null = null;
  const getRoot = async () => (rootRead ??= await read(p, pos));
  if (inspect) {
    log.push(`root: ${show(await getRoot(), pos.size)}`);
    const b = replay(pos.size, pos.setup, []);
    log.push(`line: ${line.map((m) => `${locToGtp(m.loc, pos.size)}${(n => (n ? `(x${n})` : ''))(b.play(m.loc, m.color).captured.length)}`).join(' ')}`);
  }

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
      vars.rank =
        best.loc === line[0].loc
          ? 'is KataGo’s first choice'
          : loss < 0.15
            ? 'is level with KataGo’s first choice'
            : `is within ${fmt(loss)} points of KataGo’s first choice`;
      vars.rankShort = vars.rank.replace(/^is /, '');
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
    } else if (c.kind === 'costs') {
      // Playing the whole line (even length, so the mover is to play again) against not playing it.
      if (line.length % 2) throw new Error(`${s.title}: 'costs' needs a line of even length`);
      const before = leadFor(await getRoot(), mover);
      const r = await read(p, after(pos, line));
      const cost = before - leadFor(r, mover);
      log.push(`costs: ${name(mover)} ${before.toFixed(1)} before, ${leadFor(r, mover).toFixed(1)} after the line → ${cost.toFixed(1)}`);
      if (cost < c.min) return { why: `the line costs only ${cost.toFixed(1)} (needs ${c.min})`, log };
      vars[key] = fmt(cost);
      vars[`${key}Score`] = scoreText(r);
    } else if (c.kind === 'local') {
      // The best move near `near` (within maxDist lines) against KataGo's first choice.
      const r = await getRoot();
      const nearLoc = gtpToLoc(c.near, pos.size);
      const best = r.candidates[0];
      const cand = r.candidates.find((x) => x.loc !== PASS && x.visits >= 10 && chebyshev(x.loc, nearLoc, pos.size) <= (c.maxDist ?? 3));
      if (!cand) return { why: `no searched move near ${c.near}`, log };
      const loss = best.scoreLead - cand.scoreLead;
      log.push(`local: best near ${c.near} is ${locToGtp(cand.loc, pos.size)} (${cand.scoreLead.toFixed(1)}), ${loss.toFixed(1)} behind ${locToGtp(best.loc, pos.size)}`);
      if (c.maxLoss !== undefined && loss > c.maxLoss) return { why: `local move ${loss.toFixed(1)} behind (more than ${c.maxLoss})`, log };
      if (c.minLoss !== undefined && loss < c.minLoss) return { why: `local move only ${loss.toFixed(1)} behind (needs ${c.minLoss})`, log };
      vars[key] = fmt(Math.max(0, loss));
      vars[`${key}Move`] = locToGtp(cand.loc, pos.size);
      if (chebyshev(line[0].loc, nearLoc, pos.size) <= (c.maxDist ?? 3)) throw new Error(`${s.title}: line[0] is itself near ${c.near}`);
    } else if (c.kind === 'captures') {
      const b = replay(pos.size, pos.setup, line.slice(0, c.after - 1));
      const n = b.play(line[c.after - 1].loc, line[c.after - 1].color).captured.length;
      log.push(`captures: move ${c.after} (${s.line[c.after - 1]}) captures ${n}`);
      if (n < c.min || (c.max !== undefined && n > c.max)) return { why: `move ${c.after} captures ${n} stones`, log };
      vars[key] = String(n);
    } else if (c.kind === 'illegal') {
      const b = replay(pos.size, pos.setup, line.slice(0, c.after));
      const side = c.after ? otherColor(line[c.after - 1].color) : mover;
      const ok = !b.isLegal(gtpToLoc(c.move, pos.size), side);
      log.push(`illegal: ${c.move} for ${name(side)} after ${c.after} moves: ${ok ? 'illegal' : 'LEGAL'}`);
      if (!ok) return { why: `${c.move} is legal after ${c.after} moves`, log };
    } else if (c.kind === 'swing') {
      // What the point is worth: the mover playing it (then the opponent passes) against the
      // opponent playing it (after the mover passes). Both reads have the mover to play, so
      // the tempo cancels and the difference is the "deiri" (swing) value.
      const mine = await read(p, after(pos, [line[0], { color: otherColor(mover), loc: PASS }]));
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
      // Cost of ignoring line[k-1]: KataGo's best answer against its best move at least four
      // lines away (or a pass, in framed positions where everything else is settled).
      // With after: 0 it is the mover's own choice: line[0] against the best move far from it.
      const k = c.after ?? 1;
      const answerer = k === 0 ? mover : otherColor(line[k - 1].color);
      const ref = k === 0 ? line[0].loc : line[k - 1].loc;
      const r1 = k === 0 ? await getRoot() : await read(p, after(pos, line.slice(0, k)));
      const far = view ? undefined : r1.candidates.find((x) => x.loc !== PASS && chebyshev(x.loc, ref, pos.size) >= 4);
      const elsewhere = far?.loc ?? PASS;
      vars[`${key}Far`] = locToGtp(elsewhere, pos.size);
      const r2 = await read(p, after(pos, [...line.slice(0, k), { color: answerer, loc: elsewhere }]));
      const cost = leadFor(r1, answerer) - leadFor(r2, answerer);
      log.push(`tenuki: best answer keeps ${leadFor(r1, answerer).toFixed(1)}, elsewhere (${locToGtp(elsewhere, pos.size)}) gives ${leadFor(r2, answerer).toFixed(1)} → cost ${cost.toFixed(1)}`);
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
  let records = out;
  if (only) {
    if (!flag('--merge')) return console.log('(--only: nothing written; add --merge to replace these concepts in examples.ts)');
    const { EXAMPLE_RECORDS } = await import('../src/lib/coach/library/examples');
    const order = (r: ExampleRecord) => SPECS.findIndex((s) => s.concept === r.concept && s.title === r.title);
    records = [...EXAMPLE_RECORDS.filter((r) => !only.includes(r.concept)), ...out].sort((a, b) => order(a) - order(b));
  }
  // One record per line: small diffs, small file (stones as SGF coordinates, like bank.json).
  const body = records.map((r) => `  ${JSON.stringify(r)},`).join('\n');
  writeFileSync(
    OUT,
    `// Generated by scripts/concept-examples.ts (KataGo g170e-b10c128 via nodeProber, ${VISITS} visits). Do not edit by hand.\n` +
      `// ${records.length} examples. Every number in a note comes from these reads; failed checks are dropped.\n` +
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
  /** Playing out the whole line (even length) costs the mover at least `min` points. */
  | { kind: 'costs'; min: number; key?: string }
  /** The best searched move near `near` against KataGo's first choice; line[0] must be far from it. Sets <key> (loss), <key>Move. */
  | { kind: 'local'; near: string; maxDist?: number; minLoss?: number; maxLoss?: number; key?: string }
  /** Rules check (board): move number `after` (1-based) captures min..max stones. Sets <key> to the count. */
  | { kind: 'captures'; after: number; min: number; max?: number; key?: string }
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

/** SGF coordinates ("ra sa kf") as GTP, for lines copied from bank.json. */
const sgf = (s: string, size = 19) => s.split(' ').map((c) => locToGtp(sgfToLoc(c, size), size));
const bankSource = (id: string) => {
  const p = bankProblem(id);
  return `problem bank (${p.src.kind === 'pro' ? 'professional' : 'Fox'} game, move ${p.src.move})`;
};

// The ladder diagrams: a White cutting stone at G7; Black's ataris chase it toward Q16.
// K3 and R10 are off the ladder's path; they only balance the material.
const LADDER_B = ['F7', 'G6', 'F8', 'H6', 'Q4'];
const LADDER_W = ['G7', 'C4', 'K3', 'R10'];
const LADDER_LINE = 'H7 G8 G9 H8 J8 H9 H10 J9 K9 J10 J11 K10 L10 K11 K12 L11 M11 L12 L13 M12 N12 M13 M14 N13 O13 N14 N15 O14 P14 O15 O16 P15 Q15 P16'.split(' ');
// Bottom-left corner diagrams (framed): straight three, a false eye, seki, straight four, a dead group.
const STRAIGHT_THREE = ['OOOOOOO', 'OXXXXXO', 'OX...XO'];
const FALSE_EYE = ['OOOOOOOO', 'OXXXX.OO', 'OX.X.XOO'];
const SEKI = ['XXXXXXXXX', 'XOOOOOOOX', 'XO.XXX.OX'];
const STRAIGHT_FOUR = ['OOOOOOOO', 'OXXXXXXO', 'OX....XO'];
const DEAD = ['OOOOOOO', 'OXXXXXO', 'OX.O.XO'];
const CORNER_GROUP = ['B2', 'C2', 'D2', 'E2', 'F2'];

const SPECS: Spec[] = [
  {
    concept: 'ladder',
    title: 'A ladder that works',
    size: 19,
    komi: 7.5,
    toPlay: 'B',
    black: [...LADDER_B, 'Q16'],
    white: [...LADDER_W, 'D16'],
    line: [...LADDER_LINE, 'P17'],
    checks: [
      { kind: 'captures', after: 35, min: 17 },
      { kind: 'owns', points: ['G7', 'K10', 'P16'], color: 'B', min: 0.8 },
    ],
    note: 'Black starts with the atari at {m1}. Every escape leaves White two liberties, the chase runs diagonally across the board, and at the end Black’s stone at Q16 blocks the way: {m35} captures {captures} stones, and KataGo gives the whole diagonal to Black ({owns}).',
  },
  {
    concept: 'ladder',
    title: 'A ladder breaker',
    size: 19,
    komi: 7.5,
    toPlay: 'B',
    black: [...LADDER_B, 'D16'],
    white: [...LADDER_W, 'Q16'],
    line: LADDER_LINE,
    checks: [
      { kind: 'costs', min: 5 },
      { kind: 'owns', points: ['G7', 'K10', 'P16'], color: 'W', min: 0.5 },
    ],
    note: 'Same shape, but White’s Q16 sits on the ladder’s path. Chasing anyway costs Black {costs} points by KataGo’s count: White connects at {m34} (the chased stones are {owns} White’s) and Black is left with cutting points all along the line.',
  },
  {
    concept: 'net',
    title: 'The net when the ladder fails',
    size: 19,
    komi: 7.5,
    toPlay: 'B',
    black: [...LADDER_B, 'D16'],
    white: [...LADDER_W, 'Q16'],
    line: ['H8', 'H7', 'J7', 'G8', 'G9'],
    checks: [
      { kind: 'beats', alt: 'H7', minGain: 2 },
      { kind: 'reply', after: 2 },
      { kind: 'captures', after: 5, min: 3 },
    ],
    note: 'With the ladder broken, the loose move {m1} still works: if White pushes at {m2}, KataGo answers {m3}, and after {m4} the stones run into Black’s net and {m5} captures {captures}. {m1} is {beats} points better than starting the failed ladder at H7.',
  },
  {
    concept: 'life-and-death',
    title: 'Straight three: Black lives',
    size: 19,
    komi: 'even',
    toPlay: 'B',
    local: { rows: STRAIGHT_THREE, at: [0, 16], attacker: 'W' },
    line: ['D1'],
    checks: [
      { kind: 'top' },
      { kind: 'owns', points: CORNER_GROUP, color: 'B', min: 0.8 },
    ],
    note: '{m1}, the middle of the three points, splits the space into two separate eyes. It {rank}, and afterwards KataGo counts the group as alive ({owns}).',
  },
  {
    concept: 'life-and-death',
    title: 'Straight three: White kills',
    size: 19,
    komi: 'even',
    toPlay: 'W',
    local: { rows: STRAIGHT_THREE, at: [0, 16], attacker: 'W' },
    line: ['D1'],
    checks: [
      { kind: 'top' },
      { kind: 'owns', points: CORNER_GROUP, color: 'W', min: 0.8 },
    ],
    note: 'The same point kills when White gets it first: the space can no longer become two eyes. {m1} {rank} and KataGo counts the Black group as dead ({owns}).',
  },
  {
    concept: 'eyes',
    title: 'Making the second eye real',
    size: 19,
    komi: 'even',
    toPlay: 'B',
    local: { rows: FALSE_EYE, at: [0, 16], attacker: 'W' },
    line: ['F2'],
    checks: [
      { kind: 'top' },
      { kind: 'owns', points: ['B2', 'C2', 'D2', 'E2'], color: 'B', min: 0.8 },
    ],
    note: '{m1} joins the lone stone at F1 to the group, so E1 becomes a real eye next to C1. {m1} {rank} and the group lives ({owns}).',
  },
  {
    concept: 'eyes',
    title: 'A false eye',
    size: 19,
    komi: 'even',
    toPlay: 'W',
    local: { rows: FALSE_EYE, at: [0, 16], attacker: 'W' },
    line: ['F2', 'E1'],
    checks: [
      { kind: 'top' },
      { kind: 'owns', after: 1, points: ['B2', 'C2', 'D2', 'E2'], color: 'W', min: 0.8 },
    ],
    note: 'With White on {m1}, the stone at F1 is in atari and Black must fill {m2} to save it, so E1 was never an eye. {m1} {rank} and KataGo counts the group as dead ({owns}).',
  },
  {
    concept: 'dead-group',
    title: 'Dead even with the move',
    size: 19,
    komi: 'even',
    toPlay: 'B',
    local: { rows: DEAD, at: [0, 16], attacker: 'W' },
    line: ['C1', 'E1'],
    checks: [
      { kind: 'owns', after: 0, points: CORNER_GROUP, color: 'W', min: 0.8 },
      { kind: 'captures', after: 2, min: 7 },
    ],
    note: 'White’s stone at D1 sits on the vital point. Even with Black to move, KataGo already counts the group as White’s ({owns}); if Black tries {m1}, {m2} captures {captures} stones. White does not need to spend a move here.',
  },
  {
    concept: 'seki',
    title: 'Two shared liberties, no eyes',
    size: 19,
    komi: 'even',
    toPlay: 'B',
    local: { rows: SEKI, at: [0, 16], attacker: 'B' },
    line: ['C1', 'G1'],
    checks: [
      { kind: 'owns', after: 0, points: ['D1', 'E1', 'F1'], color: 'B', min: 0.5, key: 'ownB' },
      { kind: 'owns', after: 0, points: ['B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'H2'], color: 'W', min: 0.5, key: 'ownW' },
      { kind: 'loses', alt: 'pass', minLoss: 5 },
      { kind: 'captures', after: 2, min: 4 },
    ],
    note: 'Neither side can fill C1 or G1 without putting itself in atari, so both groups stay on the board (KataGo: Black’s inside stones {ownB} Black, the White group {ownW} White). If Black fills {m1} anyway, {m2} captures {captures} stones and Black loses {loses} points against leaving it alone.',
  },
  {
    concept: 'miai',
    title: 'Straight four: the middle points are miai',
    size: 19,
    komi: 'even',
    toPlay: 'W',
    local: { rows: STRAIGHT_FOUR, at: [0, 16], attacker: 'W' },
    line: ['D1', 'E1'],
    checks: [
      { kind: 'reply' },
      { kind: 'owns', after: 2, points: ['B2', 'C2', 'D2', 'E2', 'F2', 'G2'], color: 'B', min: 0.8 },
    ],
    note: 'The two middle points are miai: when White takes {m1}, KataGo answers at {m2}, the other one, and the group keeps two eyes ({owns}).',
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
    note: 'On the empty board the 4-4 point {rank} ({score}); the center point costs {tengen} points and the star point on the side {side}.',
  },
  {
    concept: 'three-three-invasion',
    title: 'Early 3-3 under a lone star point',
    size: 19,
    komi: 7.5,
    toPlay: 'B',
    black: ['Q16', 'Q4'],
    white: ['D16', 'D4'],
    line: ['C17'],
    checks: [{ kind: 'top', maxLoss: 1 }],
    note: 'On move 5 the immediate 3-3 invasion at {m1} {rank} ({score}).',
  },
  {
    concept: 'tenuki',
    title: 'Ignoring an approach',
    size: 19,
    komi: 7.5,
    toPlay: 'B',
    black: ['Q16', 'Q4'],
    white: ['D16', 'R14'],
    line: ['D4'],
    checks: [
      { kind: 'top' },
      { kind: 'beats', alt: 'R15', minGain: 0.2, key: 'local' },
    ],
    note: 'On move 4 White approached Black’s corner at R14. KataGo’s first choice ignores it and takes the last empty corner at {m1} ({score}). Answering at R15, the local move it looked at most, reads {local} points worse, so the approach can wait.',
  },
  {
    concept: 'ko',
    title: 'A ko in a real game',
    size: 19,
    komi: 7.5,
    toPlay: 'W',
    bank: 'pjfvdaq7jhi5g',
    line: sgf('ra sa'),
    checks: [
      { kind: 'top' },
      { kind: 'captures', after: 2, min: 1, max: 1 },
      { kind: 'illegal', move: sgf('ra')[0], after: 2 },
    ],
    note: 'White throws a stone in at {m1} ({rankShort}) and Black captures it with {m2}. White may not take back at {m1} at once, because that would repeat the position: this is a ko, and White must play elsewhere first.',
    source: bankSource('pjfvdaq7jhi5g'),
  },
  {
    concept: 'ko-threats',
    title: 'A ko threat, answered',
    size: 19,
    komi: 7.5,
    toPlay: 'W',
    bank: 'pjfvdaq7jhi5g',
    line: sgf('ra sa kf ke ra'),
    checks: [
      { kind: 'illegal', move: sgf('ra')[0], after: 2 },
      { kind: 'reply', after: 3 },
      { kind: 'tenuki', after: 3, minCost: 3 },
      { kind: 'captures', after: 5, min: 1, max: 1 },
    ],
    note: 'After Black takes the ko at {m2}, White may not retake at {m1} at once, so White plays a threat at {m3}. Ignoring it would cost Black {tenuki} points by KataGo’s read, so Black answers at {m4} and White retakes the ko at {m5}.',
    source: bankSource('pjfvdaq7jhi5g'),
  },
  {
    concept: 'sacrifice',
    title: 'Giving up a stone (professional game)',
    size: 19,
    komi: 7.5,
    toPlay: 'W',
    bank: 'pr53j62y2hrtc',
    line: sgf('fo gn do dp ep'),
    checks: [
      { kind: 'top' },
      { kind: 'reply', after: 1 },
      { kind: 'reply', after: 3 },
      { kind: 'captures', after: 4, min: 1, max: 1 },
    ],
    note: 'White’s {m1} {rank}. After {m2}, White plays {m3}, a stone meant to be captured: KataGo’s answer is to take it with {m4}, and White follows with {m5}.',
    source: bankSource('pr53j62y2hrtc'),
  },
  {
    concept: 'tesuji',
    title: 'A first-line tesuji (real game)',
    size: 19,
    komi: 7.5,
    toPlay: 'B',
    bank: 'ph8fn1rv495d',
    line: sgf('ja ia ka'),
    checks: [{ kind: 'top' }, { kind: 'reply', after: 1 }, { kind: 'reply', after: 2 }],
    note: 'The first-line move {m1} {rank} ({score}). KataGo’s best answer for White is {m2}, and Black follows with {m3}.',
    source: bankSource('ph8fn1rv495d'),
  },
  {
    concept: 'sente',
    title: 'A sente endgame move',
    size: 19,
    komi: 7.5,
    toPlay: 'B',
    bank: 'p1t7mq8h1y2f3',
    line: ['A7'],
    checks: [{ kind: 'top' }, { kind: 'tenuki', minCost: 2 }],
    note: 'Late in a professional game, Black’s {m1} {rank}. White should answer it: KataGo’s best move elsewhere ({tenukiFar}) would cost White {tenuki} points compared with its best answer. Black keeps sente.',
    source: bankSource('p1t7mq8h1y2f3'),
  },
  {
    concept: 'gote',
    title: 'A gote endgame move',
    size: 19,
    komi: 7.5,
    toPlay: 'B',
    bank: 'p1t7mq8h1y2f3',
    line: ['A7'],
    checks: [{ kind: 'top' }, { kind: 'tenuki', minCost: -100, maxCost: 0.5 }],
    note: 'Late in a professional game, Black’s {m1} {rank}, but it threatens nothing big afterwards: White can play elsewhere ({tenukiFar}) and lose only {tenuki} points against answering. The move ends in gote.',
    source: bankSource('p1t7mq8h1y2f3'),
  },
  {
    concept: 'endgame',
    title: 'The biggest endgame move',
    size: 19,
    komi: 7.5,
    toPlay: 'B',
    bank: 'p1t7mq8h1y2f3',
    line: ['A7'],
    // A swing over 30 points means a group's life is at stake: not a typical endgame lesson.
    checks: [{ kind: 'top' }, { kind: 'swing', minSwing: 1, maxSwing: 30 }],
    note: 'At move 261 of a professional game, KataGo’s first choice is {m1}. With Black to move in both reads, Black on {m1} against White on {m1} differs by {swing} points: that is what the point is worth to both sides (its swing, or deiri).',
    source: bankSource('p1t7mq8h1y2f3'),
  },
  {
    concept: 'move-value',
    title: 'Measuring a big point',
    size: 19,
    komi: 7.5,
    toPlay: 'B',
    bank: 'p1xu0bq81i59t',
    line: sgf('id'),
    checks: [{ kind: 'top' }, { kind: 'swing', minSwing: 2, maxSwing: 30 }],
    note: 'KataGo’s first choice here is {m1}. Its lead with Black on {m1} and with White on {m1}, both read with Black to move, differs by {swing} points: that swing is the point’s value in deiri counting. If the move is gote, miai counting halves it, to about {swingHalf}.',
    source: bankSource('p1xu0bq81i59t'),
  },
];

await main();
