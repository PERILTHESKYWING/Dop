/**
 * The one prompt every Kami writer sees: Gemini on Myoshu, Kami's own small model in the
 * browser, and the training kit (scripts/coachlm stores this exact text as each task's
 * `prompt`). Change it and the trained model no longer matches: bump PROMPT_VERSION so the
 * factory makes fresh tasks.
 *
 * The writer gets checked facts, concept hits and variations, never the board alone, and
 * must not add moves or numbers of its own (src/lib/coach/answerCheck.ts enforces it).
 */
import { locToGtp } from '../../go/coords';
import { PASS, type Move } from '../../go/types';
import type { Explanation } from './types';

/**
 * 2: the explainer was fixed (setup stones read correctly, ownership as percentages, key
 * points, deeper reads), so tasks and the test set made with version 1 are stale.
 * 3: diagrams (built positions checked by KataGo, [[dN]]) and the writer's own DIAGRAM block.
 */
export const PROMPT_VERSION = 3;

export const LM_SYSTEM = `You are Kami, a Go (baduk) teacher. Turn the checked facts below into a clear, deep explanation for the student.
Rules:
- Use only moves, coordinates and numbers that appear in the facts, concepts or variations. Never add your own.
- Point to variations by writing their id in double brackets, like [[v1]]; the student can hover them to see the moves on the board.
- Explain why: the ideas behind the numbers (shape, weak groups, sente and gote, territory against influence, what happens later).
- Start with a direct answer in one or two sentences, then go deeper. Plain language, pitched at the student's level.
- Diagrams are positions built to show one idea on its own, checked by KataGo; show one by writing its id, like [[d1]].
- If a small local position of your own would explain the idea better, you may ask for one diagram: end your answer with
DIAGRAM
to play: Black or White
black: the black stones, like C3 D3 E3
white: the white stones
best: the move that shows the idea
worse: a tempting move that fails (optional)
idea: a few words (optional)
END
and refer to it by the id given below. Keep it in one corner or on one side, 3 to 40 stones. KataGo checks it before it is shown; if a check fails, every sentence that mentions it is removed, so make the rest of the answer stand on its own.`;

const MAX_LINE = 30;

const name = (loc: number, size: number) => (loc === PASS || loc < 0 ? 'pass' : locToGtp(loc, size));

function line(moves: readonly Move[], size: number): string {
  const shown = moves.slice(0, MAX_LINE).map((m) => `${m.color === 1 ? 'B' : 'W'} ${name(m.loc, size)}`);
  return shown.join(', ') + (moves.length > MAX_LINE ? ` … (${moves.length} moves)` : '');
}

/** The id a writer's own diagram gets: the next free dN. */
export function nextDiagramId(ex: Pick<Explanation, 'illustrations'>): string {
  return `d${(ex.illustrations?.length ?? 0) + 1}`;
}

/** The writer's input for one explanation. `level` is the student's level, e.g. "about 3k". */
export function buildLmPrompt(ex: Explanation, level?: string): string {
  const size = ex.position.size;
  const out: string[] = [];
  out.push(`Question: ${ex.question.text.trim() || ex.question.kind}`);
  if (ex.question.move !== undefined) out.push(`Move asked about: ${name(ex.question.move, size)}`);
  out.push(`To play: ${ex.position.toPlay === 1 ? 'Black' : 'White'} (move ${ex.position.moves.length + 1}, ${size}x${size})`);
  if (level) out.push(`Student level: ${level}`);
  out.push('', 'Facts:');
  for (const f of ex.facts) out.push(`- ${f.text}`);
  if (ex.concepts.length) {
    out.push('', 'Concepts found:');
    for (const c of ex.concepts) {
      const at = c.at.map((l) => name(l, size)).join(' ');
      out.push(`- ${c.id}${at ? ` at ${at}` : ''}: ${c.evidence}${c.variation ? ` (see [[${c.variation}]])` : ''}`);
    }
  }
  if (ex.variations.length) {
    out.push('', 'Variations:');
    for (const v of ex.variations) {
      const loss = v.scoreLoss !== undefined ? `, loses ${Math.round(v.scoreLoss * 10) / 10} pts` : '';
      out.push(`- [[${v.id}]] ${v.label} (${v.kind}${loss}): ${line(v.moves, size)}${v.note ? `. ${v.note}` : ''}`);
    }
  }
  const diagrams = ex.illustrations ?? [];
  if (diagrams.length) {
    out.push('', 'Diagrams:');
    for (const d of diagrams) out.push(`- [[${d.id}]] ${d.title} (${d.source}): ${line(d.line, size)}. ${d.note}`);
  }
  out.push('', `Your own diagram, if you ask for one: [[${nextDiagramId(ex)}]]`);
  return out.join('\n');
}
