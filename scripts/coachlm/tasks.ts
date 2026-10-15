/**
 * The coach-lm task format and the helpers the factory, verifier and merger share.
 * Contract (the Python trainer in scripts/coachlm/*.py reads exactly this; see
 * docs/handoff/kami-factory.md): one JSON object per line,
 *   { id, promptVersion, kind: 'position' | 'concept', split: 'train' | 'eval', system,
 *     prompt, reference, explanation: Explanation (no ownership) | null, concept: id | null }
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { LM_SYSTEM, buildLmPrompt, type Explanation } from '../../src/lib/coach/explain';
import { PROMPT_VERSION } from '../../src/lib/coach/explain/prompt';
import type { ConceptEntry } from '../../src/lib/coach/library';
import { hashString } from '../../src/lib/util/hash';

export type Split = 'train' | 'eval';

export interface Task {
  id: string;
  promptVersion: number;
  kind: 'position' | 'concept';
  split: Split;
  system: string;
  prompt: string;
  reference: string;
  explanation: Explanation | null;
  concept: string | null;
}

/** Share of positions (and concepts) held out for the test set. */
export const EVAL_SHARE = 0.1;

/** Train or eval, from a stable key (a position's canonical hash, or a concept id). Never both. */
export function splitOf(key: string): Split {
  const h = parseInt(hashString(`split|${key}`).slice(0, 8), 16) / 0x100000000;
  return h < EVAL_SHARE ? 'eval' : 'train';
}

/** The engine's own answer: summary and sections, as one text. */
export function referenceOf(ex: Pick<Explanation, 'summary' | 'sections'>): string {
  return [ex.summary.trim(), ...ex.sections.map((s) => `${s.title.trim()}\n${s.text.trim()}`)].filter(Boolean).join('\n\n');
}

/** Explanation JSON for a task line: ownership and other typed arrays dropped. */
export function storedExplanation(ex: Explanation): Explanation {
  return JSON.parse(JSON.stringify(ex, (k, v) => (k === 'ownership' || ArrayBuffer.isView(v) ? undefined : v))) as Explanation;
}

export function positionTask(id: string, split: Split, ex: Explanation): Task {
  return {
    id,
    promptVersion: PROMPT_VERSION,
    kind: 'position',
    split,
    system: LM_SYSTEM,
    prompt: buildLmPrompt(ex),
    reference: referenceOf(ex),
    explanation: storedExplanation(ex),
    concept: null,
  };
}

/** The library's own answer to a concept question. */
export function conceptReference(c: Pick<ConceptEntry, 'short' | 'body'>): string {
  return [c.short.trim(), ...c.body.map((s) => `${s.title.trim()}\n${s.text.trim()}`)].filter(Boolean).join('\n\n');
}

/**
 * The writer's input for a concept question. Same shape as buildLmPrompt's: the question,
 * then checked facts (the library's text) to reword. There is no board, so no coordinates.
 */
export function buildConceptPrompt(c: ConceptEntry, question: string): string {
  const out: string[] = [`Question: ${question.trim()}`, `Concept: ${c.name}${c.aliases.length ? ` (also called ${c.aliases.join(', ')})` : ''}`, `Level: ${c.level}`];
  out.push('There is no board for this question: do not name coordinates.', '', 'Facts:', `- ${c.short.trim()}`);
  for (const s of c.body) out.push(`- ${s.title.trim()}: ${s.text.trim()}`);
  for (const m of c.mistakes) out.push(`- Common mistake: ${m.trim()}`);
  if (c.related.length) out.push('', `Related concepts: ${c.related.join(', ')}`);
  return out.join('\n');
}

export function conceptTask(c: ConceptEntry, question: string): Task {
  return {
    id: `c-${hashString(`${PROMPT_VERSION}|concept|${c.id}|${question.trim().toLowerCase()}`)}`,
    promptVersion: PROMPT_VERSION,
    kind: 'concept',
    split: splitOf(`concept|${c.id}`),
    system: LM_SYSTEM,
    prompt: buildConceptPrompt(c, question),
    reference: conceptReference(c),
    explanation: null,
    concept: c.id,
  };
}

/** Lines of a .jsonl or .jsonl.gz file (missing file = none). Bad lines are skipped. */
export function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  let buf = readFileSync(file);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  const out: T[] = [];
  for (const line of buf.toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      /* a cut-off last line from a killed run */
    }
  }
  return out;
}

/** Write lines; gzip when the name ends in .gz. */
export function writeJsonl(file: string, rows: readonly unknown[]): void {
  const text = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  writeFileSync(file, file.endsWith('.gz') ? gzipSync(text) : text);
}
