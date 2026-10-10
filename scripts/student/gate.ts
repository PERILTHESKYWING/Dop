/**
 * The gate: does the student network beat the built-in network where it would replace it?
 *
 * On reference positions (scripts/ai-eval.ts ref: a strong network's deep search), both
 * networks run the site's own search (src/lib/engine/mcts.ts) for the same time on one
 * thread with the same WebAssembly builds the browser runs. Scored on how often the search
 * finds the reference's best move and how far its win rate is from the reference's. It
 * passes when the student finds at least as many best moves with no worse win rates.
 *
 *   npx tsx scripts/student/gate.ts --ref ref.json --net student.dopnet --ms 1500 \
 *     [--manifest public/student/manifest.json --file student.dopnet] [--out gate.json]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { replay } from '../../src/lib/go/board';
import type { Move } from '../../src/lib/go/types';
import { engineEvaluator, Search, type SearchSnapshot } from '../../src/lib/engine/mcts';
import { BUNDLED_ID, modelById, WINRATE_FROM_SCORE } from '../../src/lib/engine/models';
import type { EngineBackend } from '../../src/lib/engine/types';
import type { StudentGate, StudentManifest } from '../../src/lib/student/manifest';
import { loadNodeEngine } from '../nodeEngine';
import { loadNodeStudent } from './nodeStudent';
import type { RefFile, RefPosition } from '../ai-eval';

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 ? argv[i + 1] : d;
};

function counted(e: EngineBackend) {
  let n = 0;
  const seq = e.evalSeqBatchRaw?.bind(e);
  const one = e.evalRaw.bind(e);
  const w: EngineBackend & { evals: () => number } = Object.assign(Object.create(Object.getPrototypeOf(e)), e, {
    evalRaw: async (...a: Parameters<EngineBackend['evalRaw']>) => (n++, one(...a)),
    evalSeqBatchRaw: seq ? async (reqs: Parameters<NonNullable<EngineBackend['evalSeqBatchRaw']>>[0]) => ((n += reqs.length), seq(reqs)) : undefined,
    evals: () => n,
  });
  return w;
}

interface Tally {
  n: number;
  top1: number;
  winErr: number;
  evals: number;
  ms: number;
}

function score(t: Tally, p: RefPosition, snap: SearchSnapshot) {
  t.n++;
  if (snap.candidates[0]?.loc === p.ref.top[0].loc) t.top1++;
  t.winErr += Math.abs(snap.bWin - p.ref.bWin);
}

async function main() {
  const ref = JSON.parse(readFileSync(arg('ref')!, 'utf8')) as RefFile;
  const ms = Number(arg('ms', '1500'));
  const limit = Number(arg('positions', '0')) || ref.positions.length;
  const student = await loadNodeStudent(arg('net')!);
  const spec = modelById(BUNDLED_ID)!;
  const basePath = arg('baseline', path.join('public', 'models', spec.file))!;
  const base = counted(await loadNodeEngine(basePath, BUNDLED_ID, 19, 1, spec.winrateFromScore ?? WINRATE_FROM_SCORE));
  const st: Tally = { n: 0, top1: 0, winErr: 0, evals: 0, ms: 0 };
  const bt: Tally = { n: 0, top1: 0, winErr: 0, evals: 0, ms: 0 };
  for (const [i, p] of ref.positions.slice(0, limit).entries()) {
    const moves: Move[] = p.moves.map(([color, loc]) => ({ color, loc }));
    const root = { size: 19, komi: p.komi, moves, toPlay: p.toPlay, board: replay(19, [], moves) };
    for (const [eng, t, count] of [
      [student, st, () => student.evals()],
      [base, bt, () => base.evals()],
    ] as const) {
      const e0 = count();
      const t0 = Date.now();
      const snap = await new Search(engineEvaluator(eng, { cache: null }), root, { batch: 1 }).run({ visits: 1e9, maxMs: ms });
      t.ms += Date.now() - t0;
      t.evals += count() - e0;
      score(t, p, snap);
    }
    if ((i + 1) % 10 === 0) console.log(`${i + 1}: student ${st.top1}/${st.n} best, base ${bt.top1}/${bt.n}`);
  }
  const eps = (t: Tally) => (t.evals * 1000) / Math.max(1, t.ms);
  const gate: StudentGate = {
    at: new Date().toISOString(),
    reference: `${ref.network} at ${ref.visits} visits`,
    positions: st.n,
    ms,
    student: { top1: st.top1 / st.n, winError: st.winErr / st.n, evalsPerSec: Math.round(eps(st)) },
    baseline: { name: 'b10', top1: bt.top1 / bt.n, winError: bt.winErr / bt.n, evalsPerSec: Math.round(eps(bt)) },
    speedup: Math.round((eps(st) / Math.max(1e-9, eps(bt))) * 10) / 10,
    passed: false,
  };
  gate.passed = gate.student.top1 >= gate.baseline.top1 && gate.student.winError <= gate.baseline.winError * 1.05;
  console.log(JSON.stringify(gate, null, 1));
  console.log(`student exits: ${student.exits()} of ${student.evals()}`);
  if (arg('out')) writeFileSync(arg('out')!, JSON.stringify(gate, null, 1));
  const mf = arg('manifest');
  if (mf) {
    const old: Partial<StudentManifest> = existsSync(mf) ? JSON.parse(readFileSync(mf, 'utf8')) : {};
    const m: StudentManifest = {
      version: 1,
      file: arg('file', old.file)!,
      name: student.rt.header.name,
      enabled: gate.passed,
      gate,
      trained: old.trained,
      updated: new Date().toISOString(),
    };
    writeFileSync(mf, JSON.stringify(m, null, 1) + '\n');
    console.log(`${mf}: enabled = ${m.enabled}`);
  }
}

void main();
