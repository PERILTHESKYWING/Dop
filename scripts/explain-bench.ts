/**
 * Explainer bench: runs Kami's explain (src/lib/coach/explain) through the WASM engine in
 * Node (as scripts/explainNode.ts, bundled b10, a cold cache per answer) on real positions from
 * public/engine/bench-positions.json plus one hand-made opening, and reports per model and
 * thinking level: reads, visits, ms, whether a turning point was found. Prints one full
 * example at the end.
 *
 *   npx tsx scripts/explain-bench.ts
 *   npx tsx scripts/explain-bench.ts --combos tesuji:medium,hane:off --positions 0,1 --example 0   (--example all prints each)
 *   npx tsx scripts/explain-bench.ts --time-scale 2   # 2x every maxMs (a machine half as fast as the target)
 *
 * Node runs one engine thread (about 20 visits/s with a cold cache on the 2-core cloud box); a laptop browser
 * runs several workers, so its times are lower. Report what this prints, not guesses.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gtpToLoc } from '../src/lib/go/coords';
import type { Loc, Move } from '../src/lib/go/types';
import { budgetFor, explainWithBudget, searchProber, type Explanation, type ExplainPosition, type ModelId, type Question, type ThinkingLevel } from '../src/lib/coach/explain';
import { engineEvaluator } from '../src/lib/engine/mcts';
import { NNCache } from '../src/lib/engine/nncache';
import { loadNodeEngine } from './nodeEngine';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

interface Case {
  name: string;
  pos: ExplainPosition;
  q: Question;
}

function benchCases(): Case[] {
  const data = JSON.parse(readFileSync(path.join(root, 'public', 'engine', 'bench-positions.json'), 'utf8')) as {
    positions: { game: string; turn: number; moves: [number, number][]; toPlay: 1 | 2; komi: number }[];
  };
  const find = (game: string, turn: number): ExplainPosition => {
    const p = data.positions.find((x) => x.game === game && x.turn === turn);
    if (!p) throw new Error(`no bench position ${game}@${turn}`);
    return { size: 19, komi: p.komi, setup: [], moves: p.moves.map(([c, l]) => ({ color: c as 1 | 2, loc: l })), toPlay: p.toPlay };
  };
  const g = (s: string) => gtpToLoc(s, 19);
  const L = (loc: Loc) => loc;
  // Asked moves are candidates native KataGo (1600 visits) rated 0.4-43 points below its best.
  const cases: Case[] = [
    { name: 'opening, slow move (native: -1.4)', pos: find('g57f06f9b89160d29', 26), q: { kind: 'why-not', move: L(48), text: 'Why not this move?' } },
    { name: 'opening, slow move (native: -1.8)', pos: find('g3f348b70b9340f13', 22), q: { kind: 'why-not', move: L(110), text: 'Why not here?' } },
    { name: 'opening, near-equal (native: -0.4)', pos: find('g6796c60b99577cc5', 20), q: { kind: 'why-not', move: L(187), text: 'Is this as good?' } },
    { name: 'opening, best move', pos: find('g98223d20d0fdb2ea', 23), q: { kind: 'best', text: 'What should I play?' } },
    { name: 'early middle game (native: -3.2)', pos: find('g0783aafe8c7b34f8', 39), q: { kind: 'why-not', move: L(71), text: 'Why not this?' } },
    { name: 'middle game (native: -4.3)', pos: find('g02b639852ab783a8', 80), q: { kind: 'why-not', move: L(70), text: 'Why is this bad?' } },
    { name: 'middle game (native: -3.8)', pos: find('g66d5515df4a1520d', 70), q: { kind: 'why-not', move: L(278), text: 'Why not here?' } },
    { name: 'middle game, why the best move', pos: find('g70dd864b0bcbfc05', 34), q: { kind: 'why-move', move: L(205), text: 'Why is this good?' } },
    { name: 'middle game overview', pos: find('g00b4c7faa10642f7', 62), q: { kind: 'overview', text: 'Explain this position.' } },
    { name: 'late game blunder (native: -43)', pos: find('ga2e9a253761d68bc', 206), q: { kind: 'why-not', move: L(343), text: 'Why not here?' } },
  ];
  // A hand-made opening: four corners taken, Black asks about a low third-line move.
  const opening: Move[] = ['Q16', 'D4', 'Q3', 'D16'].map((s, i) => ({ color: (i % 2 ? 2 : 1) as 1 | 2, loc: g(s) }));
  cases.push({ name: 'hand-made opening, low approach', pos: { size: 19, komi: 7.5, setup: [], moves: opening, toPlay: 1 }, q: { kind: 'why-not', move: g('C10'), text: 'Why not C10?' } });
  return cases;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const ALL: [ModelId, ThinkingLevel][] = [
  ['hane', 'off'],
  ['hane', 'medium'],
  ['tesuji', 'off'],
  ['tesuji', 'low'],
  ['tesuji', 'medium'],
  ['tesuji', 'high'],
  ['myoshu', 'medium'],
];

function printExample(c: Case, ex: Explanation) {
  const out: string[] = [];
  out.push(`\n=== Example: ${c.name} (${ex.model}/${ex.thinking}) ===`);
  out.push(`Q: ${c.q.text}`);
  out.push(`Thought for ${(ex.ms / 1000).toFixed(1)} s, ${ex.reads} reads, ${ex.totalVisits} visits:`);
  for (const t of ex.thoughts) out.push(`  - ${t.text} (${t.visits} visits, ${t.ms} ms)${t.variation ? ` [[${t.variation}]]` : ''}`);
  out.push(`\nSummary: ${ex.summary}`);
  for (const s of ex.sections) out.push(`\n## ${s.title}\n${s.text}`);
  out.push('\nVariations:');
  for (const v of ex.variations) out.push(`  [[${v.id}]] ${v.kind} "${v.label}" ${v.moves.length} moves${v.highlight ? `, highlight ${v.highlight.length} pts` : ''}${v.scoreLoss !== undefined ? `, loss ${v.scoreLoss}` : ''}${v.note ? ` — ${v.note}` : ''}`);
  out.push('Concepts:');
  for (const h of ex.concepts) out.push(`  ${h.id}: ${h.evidence}`);
  out.push('Facts:');
  for (const f of ex.facts) out.push(`  ${f.id}: ${f.text}`);
  console.log(out.join('\n'));
}

async function main() {
  const cases = benchCases();
  const pick = arg('positions')?.split(',').map(Number);
  const chosen = pick ? pick.map((i) => cases[i]) : cases;
  const combos = arg('combos')
    ? arg('combos')!.split(',').map((s) => s.split(':') as [ModelId, ThinkingLevel])
    : ALL;
  const scale = Number(arg('time-scale') ?? 1);
  const exampleIdx = Number(arg('example') ?? 0);
  const t0 = Date.now();
  // The same engine as scripts/explainNode.ts, but a cold evaluation cache for every answer:
  // with one shared cache, later runs reuse earlier runs' evaluations and look faster.
  const models = path.join(root, 'public', 'models');
  const file = readdirSync(models).find((f) => f.startsWith('g170e-b10c128') && f.endsWith('.bin.gz'));
  if (!file) throw new Error(`no bundled network in ${models}`);
  const eng = await loadNodeEngine(path.join(models, file), 'g170e-b10c128', 19, 1);
  const freshProber = () => searchProber(engineEvaluator(eng, { cache: new NNCache() }));
  const { loadavg } = await import('node:os');
  console.log(`engine loaded in ${Date.now() - t0} ms; ${chosen.length} positions; time scale ${scale}; load average ${loadavg()[0].toFixed(1)}`);
  const examples: { c: Case; ex: Explanation }[] = [];
  const all = arg('example') === 'all';
  for (const [model, thinking] of combos) {
    const budget = budgetFor(model, thinking);
    budget.maxMs = Math.round(budget.maxMs * scale);
    console.log(`\n## ${model}/${thinking}: budget reads ${budget.reads}, visits ${budget.visits}, line ${budget.lineVisits}x${budget.lineDepth}, maxMs ${budget.maxMs}`);
    console.log('case | variations | reads | visits | ms | cpu ms | loss | turning point | concepts');
    const rows: { reads: number; visits: number; ms: number; cpu: number; tp: boolean | null }[] = [];
    for (const c of chosen) {
      const cpu0 = process.cpuUsage();
      const ex = await explainWithBudget(c.pos, c.q, freshProber(), budget, { model, thinking });
      const du = process.cpuUsage(cpu0);
      const cpu = Math.round((du.user + du.system) / 1000);
      const v = ex.variations.find((x) => x.kind === 'consequence');
      const hasLine = !!v;
      const tp = hasLine ? !!v!.highlight?.length : null;
      const mode = ex.variations.map((x) => x.kind[0]).join('');
      const loss = ex.variations.find((x) => x.kind === 'refutation' || x.kind === 'consequence' || x.kind === 'what-if')?.scoreLoss;
      rows.push({ reads: ex.reads, visits: ex.totalVisits, ms: ex.ms, cpu, tp });
      console.log(`${c.name} | ${mode} | ${ex.reads} | ${ex.totalVisits} | ${ex.ms} | ${cpu} | ${loss ?? '-'} | ${tp === null ? '-' : tp ? 'yes' : 'no'} | ${ex.concepts.map((h) => h.id).join(' ') || '-'}`);
      if (all) examples.push({ c, ex });
      else if (!examples.length && chosen.indexOf(c) === exampleIdx && ((model === 'tesuji' && thinking === 'medium') || combos.length === 1)) examples.push({ c, ex });
    }
    const n = rows.length;
    const avg = (k: 'reads' | 'visits' | 'ms' | 'cpu') => Math.round(rows.reduce((t, r) => t + r[k], 0) / n);
    const lines = rows.filter((r) => r.tp !== null);
    console.log(
      `=> mean reads ${avg('reads')}, mean visits ${avg('visits')}, mean ms ${avg('ms')} (cpu ${avg('cpu')}), max ms ${Math.max(...rows.map((r) => r.ms))}; turning points ${lines.filter((r) => r.tp).length}/${lines.length} consequence lines`,
    );
  }
  for (const e of examples) printExample(e.c, e.ex);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
