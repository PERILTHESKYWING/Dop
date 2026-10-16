/**
 * The critique batch: Kami's analyses of many kinds of positions, for XIAO to mark once. The
 * marks become the rubric in eval/coach/rubric.json that every later training run scores
 * answers with (see docs/handoff/kami-factory.md, "Rubric").
 *
 *   npx tsx scripts/kami-critique.ts --out critique.json [--only 3,7] [--thinking high]
 *
 * Every answer is the engine's own text (Tesuji, the bundled b10 network through the WASM
 * engine in Node, the same search the site runs) with its variations and diagrams; concept
 * questions are the library's entries. Nothing here calls a language model.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { explain, type ExplainPosition, type Explanation, type Question, type ThinkingLevel } from '../src/lib/coach/explain';
import { conceptById, findConcepts, type ConceptEntry } from '../src/lib/coach/library';
import { replay } from '../src/lib/go/board';
import { gtpToLoc, locToGtp } from '../src/lib/go/coords';
import { PASS, type Color, type Loc, type Move } from '../src/lib/go/types';
import { problemBoard } from '../src/lib/problems/play';
import type { Problem } from '../src/lib/problems/types';
import { nodeProber } from './explainNode';
import type { Prober } from '../src/lib/coach/explain/types';

const { values: arg } = parseArgs({ options: { out: { type: 'string', default: 'critique.json' }, only: { type: 'string' }, thinking: { type: 'string', default: 'high' } } });
const root = new URL('../', import.meta.url);
const readJson = <T>(p: string): T => JSON.parse(readFileSync(new URL(p, root), 'utf8')) as T;

interface Item {
  id: number;
  area: string;
  title: string;
  question: string;
  kind: 'position' | 'concept';
  pos?: ExplainPosition;
  q?: Question;
  /** Find the komi that makes a framed problem even first. */
  evenKomi?: boolean;
}

const g = (s: string, size = 19) => gtpToLoc(s, size);
const alt = (list: string[], size = 19, first: Color = 1): Move[] => list.map((s, i) => ({ color: (i % 2 ? 3 - first : first) as Color, loc: g(s, size) }));

const bench = readJson<{ positions: { game: string; turn: number; moves: [number, number][]; toPlay: 1 | 2; komi: number }[] }>('public/engine/bench-positions.json');
function benchPos(game: string, turn: number): ExplainPosition {
  const p = bench.positions.find((x) => x.game === game && x.turn === turn)!;
  return { size: 19, komi: p.komi, setup: [], moves: p.moves.map(([c, l]) => ({ color: c as Color, loc: l })), toPlay: p.toPlay };
}

const demo = readJson<{ games: { id: string; size: number; komi: number; setup: Move[]; moves: Move[] }[] }>('public/demo/demo.json').games;
function demoPos(i: number, move: number): ExplainPosition {
  const d = demo[i];
  return { size: d.size, komi: d.komi, setup: d.setup, moves: d.moves.slice(0, move), toPlay: d.moves[move].color };
}

const bank = readJson<{ problems: Problem[] }>('public/problems/bank.json').problems;
function problemPos(pred: (p: Problem) => boolean): { pos: ExplainPosition; p: Problem } {
  const p = bank.find(pred)!;
  const b = problemBoard(p);
  const setup: Move[] = [];
  for (let l = 0; l < b.stones.length; l++) if (b.stones[l]) setup.push({ color: b.stones[l] as Color, loc: l });
  return { pos: { size: p.size, komi: 0, setup, moves: [], toPlay: p.toPlay === 'B' ? 1 : 2 }, p };
}

const life = problemPos((p) => p.cat === 'life' && p.goal === 'live' && p.level <= -5 && p.level >= -10);
const kill = problemPos((p) => p.cat === 'life' && p.goal === 'kill' && p.level <= -3);
const tesuji = problemPos((p) => p.cat === 'tesuji' && p.tags.includes('throw-in'));
const endgame = problemPos((p) => p.cat === 'endgame' && !p.view && p.stakes >= 3);

const handicap: Move[] = ['D4', 'Q4', 'D16', 'Q16'].map((s) => ({ color: 1 as Color, loc: g(s) }));

const ITEMS: Item[] = [
  // Opening
  { id: 1, area: 'Opening', title: 'Four corners taken, what next?', question: 'What should Black play?', kind: 'position', pos: { size: 19, komi: 7.5, setup: [], moves: alt(['Q16', 'D4', 'Q3', 'D16']), toPlay: 1 } },
  { id: 2, area: 'Opening', title: 'A low approach on the side', question: 'Why not C10?', kind: 'position', pos: { size: 19, komi: 7.5, setup: [], moves: alt(['Q16', 'D4', 'Q3', 'D16']), toPlay: 1 } },
  { id: 3, area: 'Opening', title: 'A slow move in the opening', question: 'Why not this move?', kind: 'position', pos: benchPos('g57f06f9b89160d29', 26), q: { kind: 'why-not', move: 48, text: 'Why not this move?' } },
  { id: 4, area: 'Opening', title: 'Another slow opening move', question: 'Why not here?', kind: 'position', pos: benchPos('g3f348b70b9340f13', 22), q: { kind: 'why-not', move: 110, text: 'Why not here?' } },
  { id: 5, area: 'Opening', title: 'Two moves of the same value', question: 'Is this as good?', kind: 'position', pos: benchPos('g6796c60b99577cc5', 20), q: { kind: 'why-not', move: 187, text: 'Is this as good?' } },
  { id: 6, area: 'Opening', title: 'Best move in a quiet opening', question: 'What should I play here?', kind: 'position', pos: benchPos('g98223d20d0fdb2ea', 23) },
  // Middle game
  { id: 7, area: 'Middle game', title: 'A move that gets refuted', question: 'Why not this?', kind: 'position', pos: benchPos('g0783aafe8c7b34f8', 39), q: { kind: 'why-not', move: 71, text: 'Why not this?' } },
  { id: 8, area: 'Middle game', title: 'A mistake that shows later', question: 'Why is this bad?', kind: 'position', pos: benchPos('g02b639852ab783a8', 80), q: { kind: 'why-not', move: 70, text: 'Why is this bad?' } },
  { id: 9, area: 'Middle game', title: 'Sente and gote in a fight', question: 'Why not here?', kind: 'position', pos: benchPos('g66d5515df4a1520d', 70), q: { kind: 'why-not', move: 278, text: 'Why not here?' } },
  { id: 10, area: 'Middle game', title: 'Why the best move is best', question: 'Why is this good?', kind: 'position', pos: benchPos('g70dd864b0bcbfc05', 34), q: { kind: 'why-move', move: 205, text: 'Why is this good?' } },
  { id: 11, area: 'Middle game', title: 'Whole-board overview', question: 'Explain this position.', kind: 'position', pos: benchPos('g00b4c7faa10642f7', 62) },
  { id: 12, area: 'Middle game', title: 'Who is ahead, and why?', question: 'Who is ahead here, and why?', kind: 'position', pos: demoPos(3, 120) },
  // Late game and endgame
  { id: 13, area: 'Late game', title: 'A big blunder', question: 'Why not here?', kind: 'position', pos: benchPos('ga2e9a253761d68bc', 206), q: { kind: 'why-not', move: 343, text: 'Why not here?' } },
  { id: 14, area: 'Endgame', title: 'The biggest endgame move', question: 'What is the biggest move now?', kind: 'position', pos: demoPos(1, 190) },
  { id: 15, area: 'Endgame', title: 'An endgame problem from a real game', question: 'What should I play here?', kind: 'position', pos: endgame.pos, evenKomi: true },
  // Life and death, tesuji
  { id: 16, area: 'Life and death', title: 'Make this group live', question: 'How does this group live?', kind: 'position', pos: life.pos, q: { kind: 'best', text: 'How does this group live?' }, evenKomi: true },
  { id: 17, area: 'Life and death', title: 'Kill the group', question: 'Can I kill this group?', kind: 'position', pos: kill.pos, q: { kind: 'best', text: 'Can I kill this group?' }, evenKomi: true },
  { id: 18, area: 'Tesuji', title: 'A throw-in', question: 'What is the tesuji here?', kind: 'position', pos: tesuji.pos, q: { kind: 'best', text: 'What is the tesuji here?' }, evenKomi: true },
  // Your own games
  { id: 19, area: 'Your games', title: 'Why was my move bad?', question: 'Why was my move bad?', kind: 'position', pos: demoPos(0, 60), q: { kind: 'why-move', move: demo[0].moves[60].loc, text: 'Why was my move bad?' } },
  { id: 20, area: 'Your games', title: 'Was my move good?', question: 'Was this a good move?', kind: 'position', pos: demoPos(2, 41), q: { kind: 'why-move', move: demo[2].moves[41].loc, text: 'Was this a good move?' } },
  // Handicap and small boards
  { id: 21, area: 'Handicap', title: 'Four-stone game, White approaches', question: 'How should Black answer?', kind: 'position', pos: { size: 19, komi: 0.5, setup: handicap, moves: alt(['R6'], 19, 2), toPlay: 1 } },
  { id: 22, area: '13x13', title: 'A 13x13 opening', question: 'What should White play?', kind: 'position', pos: { size: 13, komi: 7.5, setup: [], moves: alt(['K4', 'D10', 'C4', 'K10', 'D6'], 13), toPlay: 2 } },
  { id: 23, area: '9x9', title: 'A 9x9 opening', question: 'What should Black play?', kind: 'position', pos: { size: 9, komi: 7, setup: [], moves: alt(['E5', 'G5', 'G4', 'F4'], 9), toPlay: 1 } },
  // Concepts
  { id: 24, area: 'Concepts', title: 'Miai', question: 'What is miai?', kind: 'concept' },
  { id: 25, area: 'Concepts', title: 'Aji', question: 'What is aji?', kind: 'concept' },
  { id: 26, area: 'Concepts', title: 'Tenuki', question: 'When should I tenuki?', kind: 'concept' },
  { id: 27, area: 'Concepts', title: 'Thickness', question: 'What is thickness and how do I use it?', kind: 'concept' },
  { id: 28, area: 'Concepts', title: 'Ladders', question: 'How do I know if a ladder works?', kind: 'concept' },
];
// Item 2 asks about C10.
ITEMS[1].q = { kind: 'why-not', move: g('C10'), text: 'Why not C10?' };

const only = arg.only?.split(',').map(Number);
const thinking = arg.thinking as ThinkingLevel;
// The WASM engine is built for one board size, so keep one per size.
const probers = new Map<number, Prober>();
const proberFor = async (size: number) => {
  if (!probers.has(size)) probers.set(size, await nodeProber(size));
  return probers.get(size)!;
};
const name = (l: Loc, size: number) => (l === PASS || l < 0 ? 'pass' : locToGtp(l, size));

function stonesOf(pos: ExplainPosition) {
  const b = replay(pos.size, pos.setup, pos.moves);
  const black: string[] = [];
  const white: string[] = [];
  for (let l = 0; l < b.stones.length; l++) if (b.stones[l] === 1) black.push(name(l, pos.size));
  else if (b.stones[l] === 2) white.push(name(l, pos.size));
  return { black, white };
}

function packExplanation(ex: Explanation) {
  const size = ex.position.size;
  return {
    summary: ex.summary,
    sections: ex.sections,
    facts: ex.facts.map((f) => f.text),
    concepts: ex.concepts.map((c) => ({ id: c.id, at: c.at.map((l) => name(l, size)), evidence: c.evidence, variation: c.variation })),
    variations: ex.variations.map((v) => ({ id: v.id, label: v.label, kind: v.kind, moves: v.moves.map((m) => name(m.loc, size)), first: v.moves[0]?.color ?? 1, highlight: (v.highlight ?? []).map((l) => name(l, size)), note: v.note, scoreLoss: v.scoreLoss })),
    illustrations: (ex.illustrations ?? []).map((d) => ({
      id: d.id,
      label: d.label,
      title: d.title,
      note: d.note,
      source: d.source,
      komi: d.base.komi,
      toPlay: d.base.toPlay,
      ...stonesOf(d.base),
      view: d.view,
      line: d.line.map((m) => name(m.loc, size)),
      highlight: d.highlight.map((l) => name(l, size)),
      checks: d.checks,
      read: d.read,
    })),
    thoughts: ex.thoughts.map((t) => ({ text: t.text, ms: t.ms, visits: t.visits })),
    reads: ex.reads,
    visits: ex.totalVisits,
    ms: ex.ms,
  };
}

function packConcept(c: ConceptEntry) {
  return {
    id: c.id,
    name: c.name,
    level: c.level,
    short: c.short,
    body: c.body,
    mistakes: c.mistakes,
    related: c.related,
    examples: c.examples.map((e) => ({ title: e.title, note: e.note, source: e.source, size: e.position.size, toPlay: e.position.toPlay, ...stonesOf(e.position), view: e.view, line: e.line.map((m) => name(m.loc, e.position.size)) })),
  };
}

const out: unknown[] = [];
const t0 = Date.now();
for (const it of ITEMS) {
  if (only && !only.includes(it.id)) continue;
  if (it.kind === 'concept') {
    const c = findConcepts(it.question)[0] ?? conceptById(it.title.toLowerCase());
    out.push({ id: it.id, area: it.area, title: it.title, question: it.question, kind: 'concept', concept: c ? packConcept(c) : null });
    console.log(`${it.id} ${it.title}: ${c ? c.name : 'no library entry'}`);
    continue;
  }
  const pos = { ...it.pos! };
  const prober = await proberFor(pos.size);
  if (it.evenKomi) {
    // A framed problem: the komi that makes the right answer an even game (as the bank does).
    const r = await prober.read(pos, { visits: 200, maxMs: 30_000 });
    if (r) pos.komi = Math.round((pos.komi + r.bLead) * 2) / 2;
  }
  const q: Question = it.q ?? { kind: /explain|ahead/i.test(it.question) ? 'overview' : 'best', text: it.question };
  const t = Date.now();
  const ex = await explain(pos, q, prober, { model: 'tesuji', thinking, examplesFor: (id) => conceptById(id)?.examples ?? [] });
  const last = pos.moves[pos.moves.length - 1];
  out.push({
    id: it.id,
    area: it.area,
    title: it.title,
    question: it.question,
    kind: 'position',
    size: pos.size,
    komi: pos.komi,
    toPlay: pos.toPlay,
    ...stonesOf(pos),
    last: last ? name(last.loc, pos.size) : null,
    asked: q.move !== undefined ? name(q.move, pos.size) : null,
    view: it.evenKomi ? (problemFor(it)?.view ?? null) : null,
    answer: packExplanation(ex),
  });
  console.log(`${it.id} ${it.title}: ${((Date.now() - t) / 1000).toFixed(1)} s, ${ex.variations.length} lines, ${ex.illustrations?.length ?? 0} diagrams, concepts ${ex.concepts.map((c) => c.id).join(' ') || '-'}`);
}

function problemFor(it: Item): Problem | null {
  if (it.id === 15) return endgame.p;
  if (it.id === 16) return life.p;
  if (it.id === 17) return kill.p;
  if (it.id === 18) return tesuji.p;
  return null;
}

writeFileSync(arg.out!, JSON.stringify({ made: new Date().toISOString(), engine: 'KataGo g170e-b10c128 (WASM, Node)', model: `Kami Tesuji, thinking ${thinking}`, items: out }, null, 1));
console.log(`wrote ${out.length} items to ${arg.out} in ${((Date.now() - t0) / 60_000).toFixed(1)} min`);
process.exit(0);
