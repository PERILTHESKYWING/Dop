/**
 * Measures Kami's life-and-death reader (src/lib/coach/explain/lifeDeath.ts) on the problem
 * bank, called the way the site calls it: KataGo (the bundled b10 network through the WASM
 * engine in Node) reads the problem first, and its ownership (for walls) and candidates (the
 * hint) go to the reader. Reports how often the reader can read the group at all, how often
 * it proves the result, whether a proven result ever contradicts the problem's goal, how often
 * its key move is one of the bank's correct first moves, and how long it takes.
 *
 *   npx tsx scripts/lifedeath-bench.ts [--cat life] [--n 40] [--skip 0] [--max-empty 24]
 *     [--max-ms 1200] [--visits 64] [--find] [--no-own] [--verbose]
 *
 * --find picks the group with findTarget (from KataGo's move and PV, the side to play as the
 * mover) instead of the bank's target and counts how often it lands on the bank's group.
 * --no-own leaves KataGo's ownership out of the reader's call (walls by size only).
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { findTarget, solveLifeDeath } from '../src/lib/coach/explain/lifeDeath';
import { locToGtp, sgfToLoc } from '../src/lib/go/coords';
import { PASS, type Color, type Move } from '../src/lib/go/types';
import { problemBoard } from '../src/lib/problems/play';
import type { Problem } from '../src/lib/problems/types';
import { nodeProber } from './explainNode';

const { values: arg } = parseArgs({
  options: {
    cat: { type: 'string', default: 'life' },
    n: { type: 'string', default: '40' },
    skip: { type: 'string', default: '0' },
    'max-empty': { type: 'string', default: '24' },
    'max-ms': { type: 'string', default: '1200' },
    visits: { type: 'string', default: '64' },
    find: { type: 'boolean', default: false },
    'no-own': { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
  },
});
const maxEmpty = Number(arg['max-empty']);
const maxMs = Number(arg['max-ms']);
const bank = (JSON.parse(readFileSync(new URL('../public/problems/bank.json', import.meta.url), 'utf8')) as { problems: Problem[] }).problems;
const list = bank.filter((p) => p.cat === arg.cat && p.target && p.size === 19).slice(Number(arg.skip), Number(arg.skip) + Number(arg.n));
const prober = await nodeProber(19);

const pct = (a: number[], q: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN;
};
const st = { problems: 0, notRead: 0, proven: 0, unresolved: 0, ko: 0, goalMet: 0, contradicts: 0, keyGiven: 0, keyInOk: 0, katagoInOk: 0, findHit: 0 };
const ms: number[] = [];
const provenMs: number[] = [];
const odd: string[] = [];
for (const p of list) {
  const n = p.size;
  const g = (l: number) => locToGtp(l, n);
  const b = problemBoard(p);
  const toPlay: Color = p.toPlay === 'B' ? 1 : 2;
  const setup: Move[] = [];
  for (let l = 0; l < b.stones.length; l++) if (b.stones[l]) setup.push({ color: b.stones[l] as Color, loc: l });
  const read = await prober.read({ size: n, komi: 7, setup, moves: [], toPlay }, { visits: Number(arg.visits), maxMs: 10_000 });
  const own = read?.ownership ?? null;
  const best = read?.candidates[0];
  const hint = [...new Set([...(best ? [best.loc] : []), ...(read?.candidates.map((c) => c.loc) ?? []), ...(best?.pv ?? [])])].filter((l) => l !== PASS);
  const ok = Object.keys(p.tree.ok).map((s) => sgfToLoc(s, n));
  if (best && ok.includes(best.loc)) st.katagoInOk++;
  const bankGroup = new Set<number>();
  for (let i = 0; i < p.target!.length; i += 2) bankGroup.add(sgfToLoc(p.target!.slice(i, i + 2), n));
  let target = sgfToLoc(p.target!.slice(0, 2), n);
  if (arg.find) {
    const near = best ? [best.loc, ...best.pv.slice(1, 3)].filter((l) => l !== PASS) : [];
    const t = findTarget(b, near, own, toPlay);
    if (t?.stones.some((s) => bankGroup.has(s))) st.findHit++;
    target = t ? t.stones[0] : -1;
  }
  st.problems++;
  const t0 = performance.now();
  const v = target >= 0 ? solveLifeDeath(b, target, toPlay, { maxEmpty, maxMs, own: arg['no-own'] ? null : own }, hint) : null;
  const took = performance.now() - t0;
  if (!v) {
    st.notRead++;
    continue;
  }
  ms.push(took);
  if (arg.verbose) {
    const key = v.key !== undefined ? g(v.key) : '-';
    console.log(`${p.id} ${p.goal} ${p.toPlay} ok ${ok.map(g).join(',')} -> ${v.result}/${v.ifOtherFirst} key ${key} proven ${v.proven} ${v.nodes} nodes ${took.toFixed(0)} ms`);
  }
  if (v.proven) provenMs.push(took);
  if (v.proven) st.proven++;
  if (v.result === 'unresolved') {
    st.unresolved++;
    continue;
  }
  if (v.result === 'ko') st.ko++;
  const met = p.goal === 'live' ? v.result === 'alive' || v.result === 'seki' : p.goal === 'kill' ? v.result === 'dead' : true;
  if (met) st.goalMet++;
  else if (v.result !== 'ko') {
    st.contradicts++;
    odd.push(`${p.id}: goal ${p.goal}, reader ${v.result}/${v.ifOtherFirst} (proven ${v.proven})`);
  }
  if (v.key !== undefined) {
    st.keyGiven++;
    if (ok.includes(v.key)) st.keyInOk++;
    else odd.push(`${p.id}: key ${g(v.key)} not among the bank's ${ok.map(g).join(',')} (proven ${v.proven})`);
  }
}
console.log(
  JSON.stringify({
    cat: arg.cat,
    maxEmpty,
    maxMs,
    own: !arg['no-own'],
    ...st,
    msMedian: +pct(ms, 0.5).toFixed(1),
    msP90: +pct(ms, 0.9).toFixed(1),
    provenMsMedian: +pct(provenMs, 0.5).toFixed(1),
    provenMsMax: provenMs.length ? +Math.max(...provenMs).toFixed(0) : null,
  }),
);
for (const o of odd) console.log('  ', o);
process.exit(0);
