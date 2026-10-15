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

export const PROMPT_VERSION = 1;

export const LM_SYSTEM = `You are Kami, a Go (baduk) teacher. Turn the checked facts below into a clear, deep explanation for the student.
Rules:
- Use only moves, coordinates and numbers that appear in the facts, concepts or variations. Never add your own.
- Point to variations by writing their id in double brackets, like [[v1]]; the student can hover them to see the moves on the board.
- Explain why: the ideas behind the numbers (shape, weak groups, sente and gote, territory against influence, what happens later).
- Start with a direct answer in one or two sentences, then go deeper. Plain language, pitched at the student's level.`;

const MAX_LINE = 30;

const name = (loc: number, size: number) => (loc === PASS || loc < 0 ? 'pass' : locToGtp(loc, size));

function line(moves: readonly Move[], size: number): string {
  const shown = moves.slice(0, MAX_LINE).map((m) => `${m.color === 1 ? 'B' : 'W'} ${name(m.loc, size)}`);
  return shown.join(', ') + (moves.length > MAX_LINE ? ` … (${moves.length} moves)` : '');
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
  return out.join('\n');
}
