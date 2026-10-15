/**
 * Scores written answers against their tasks with the same checker the Kami site uses.
 *
 *   npx tsx scripts/coachlm/verify.ts --tasks tasks.jsonl[.gz] --answers answers.jsonl --out scores.jsonl
 *   npx tsx scripts/coachlm/verify.ts --tasks eval.jsonl.gz --self --out scores.jsonl   (score the references)
 *
 * answers: {"id", "member", "text"} per line. scores: {"id", "member", "truth", "coverage",
 * "depth", "unsupported", "pass"} per line. Position tasks use checkAnswer on the task's
 * explanation; concept tasks score truth 0 for any board coordinate and coverage as the share
 * of the concept's key terms used (checkConceptAnswer). Answers for unknown ids are skipped.
 */
import { parseArgs } from 'node:util';
import { checkAnswer, checkConceptAnswer, type AnswerScore, type ConceptLike } from '../../src/lib/coach/answerCheck';
import { conceptById } from '../../src/lib/coach/library';
import { readJsonl, writeJsonl, type Task } from './tasks';

export interface Answer {
  id: string;
  member: string;
  text: string;
}

export interface Score extends AnswerScore {
  id: string;
  member: string;
}

/** The concept a task is about: the library entry, or (when the library no longer has it) one read back from the task's prompt. */
function conceptOf(t: Task): ConceptLike {
  const c = t.concept ? conceptById(t.concept) : undefined;
  if (c) return c;
  const name = /^Concept: ([^(\n]+)/m.exec(t.prompt)?.[1]?.trim() ?? t.concept ?? '';
  const short = /^Facts:\n- (.*)$/m.exec(t.prompt)?.[1] ?? t.reference.split('\n')[0];
  const related = /^Related concepts: (.*)$/m.exec(t.prompt)?.[1]?.split(', ') ?? [];
  return { id: t.concept ?? name, name, aliases: [], short, related };
}

export function scoreAnswer(t: Task, text: string): AnswerScore {
  if (t.kind === 'concept' || !t.explanation) return checkConceptAnswer(conceptOf(t), text);
  return checkAnswer(t.explanation, text);
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/coachlm/verify.ts');
if (isMain) {
  const { values: arg } = parseArgs({ options: { tasks: { type: 'string' }, answers: { type: 'string' }, out: { type: 'string' }, self: { type: 'boolean', default: false } } });
  if (!arg.tasks || !arg.out || (!arg.answers && !arg.self)) throw new Error('usage: verify.ts --tasks tasks.jsonl[.gz] (--answers answers.jsonl | --self) --out scores.jsonl');
  const t0 = Date.now();
  const tasks = new Map(readJsonl<Task>(arg.tasks).map((t) => [t.id, t]));
  const answers: Answer[] = arg.self ? [...tasks.values()].map((t) => ({ id: t.id, member: 'reference', text: t.reference })) : readJsonl<Answer>(arg.answers!);
  const t1 = Date.now();
  const scores: Score[] = [];
  let unknown = 0;
  for (const a of answers) {
    const t = tasks.get(a.id);
    if (!t || typeof a.text !== 'string') {
      unknown++;
      continue;
    }
    scores.push({ id: a.id, member: String(a.member ?? ''), ...scoreAnswer(t, a.text) });
  }
  writeJsonl(arg.out, scores);
  const ms = Date.now() - t1;
  const mean = (k: 'truth' | 'coverage' | 'depth') => (scores.length ? scores.reduce((s, x) => s + x[k], 0) / scores.length : 0).toFixed(3);
  const passed = scores.filter((s) => s.pass).length;
  console.log(
    `verify: ${scores.length} answers on ${tasks.size} tasks (load ${Date.now() - t0 - ms} ms, check ${ms} ms = ${scores.length ? ((ms * 1000) / scores.length).toFixed(0) : '-'} µs each); ` +
      `pass ${passed}/${scores.length}, truth ${mean('truth')}, coverage ${mean('coverage')}, depth ${mean('depth')}; ${unknown} unknown ids skipped`,
  );
  const bad = new Map<string, number>();
  for (const s of scores) for (const u of s.unsupported) bad.set(u, (bad.get(u) ?? 0) + 1);
  if (bad.size) console.log(`  most common unsupported: ${[...bad].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([u, n]) => `${u} x${n}`).join(', ')}`);
}
