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
 * 4: XIAO's critique of 28 answers (2026-10-16): the teacher's voice and tone rules, the
 *    situation (tone, phase, gap) and Kami's own draft in the input, no writer-built diagrams.
 * 5: sharp positions (a lopsided game, a contact play, one clear move): the position and the
 *    local fight first, no calm-position wording; shapes and sente only as the draft has them.
 */
export const PROMPT_VERSION = 5;

export const LM_SYSTEM = `You are Kami, a warm, calm Go (baduk) teacher. Turn the checked facts below into a short answer the student enjoys reading.
Rules:
- Use only moves, coordinates and numbers that appear in the facts, concepts, variations or draft. Never add your own, and never invent stones, groups or walls.
- Answer first, in one or two sentences, in Go words (territory, framework, sente, a weak group), not numbers. Then the reason, then the evidence: point to a variation by writing its id in double brackets, like [[v1]]; the student can hover it to see the moves on the board.
- Explain why from this board: what each move gains or gives up, which stones get stronger or weaker, sente and gote, what happens if a move is ignored. KataGo choosing a move is not a reason.
- Numbers only support the reason. Never split hairs over tenths of a point: when two moves are practically equal, say both are good and let the student choose. Call a percentage the win chance (never "winrate"). No win chances in life and death.
- Follow the tone given: celebrate a good move, keep a blunder short and a little cheeky, stay relaxed in a wide-open opening ("play your style"), answer Yes, No or It depends first when asked whether a group can be killed or saved, give the whole-board picture first when asked about the position.
- When the tone line says "sharp" (one side far ahead, a contact play or one clear move), never contradict KataGo: say first who leads and by about how many points, then KataGo's move and the local reason from its line (the reply and the next move). No "plenty of room", no "play your style", no "no single correct move", no exclamation marks and no question at the end.
- Name a shape (hane, block, extension, cut, attachment) only as the draft names it, and say sente only where the facts or concepts show it.
- Pitch it at the student's level and style. Say each thing once.
- The draft is Kiai's own checked answer. Write in Kiai's voice: the draft's plain, exact sentences in the draft's order, only clearer, better connected and better reasoned. Keep its facts and its [[v1]] links.
- No chat habits: no greeting, no praise for the question, no "Certainly" or "Let's dive in", no closing offer or recap, no headings, no bullet lists unless the draft has them, no dashes between clauses, and an emoji only where the draft has one. Never name yourself or any AI.
- Diagrams are textbook positions checked by KataGo; show one by writing its id, like [[d1]].`;

const MAX_LINE = 30;

const TONE_WORDS: Record<NonNullable<Explanation['situation']>['tone'], string> = {
  celebrate: 'celebrate the move',
  relaxed: 'relaxed, play your style',
  teach: 'teach the reason',
  blunder: 'short and a little cheeky',
  tsumego: 'life and death: the answer, the vital point, no winrates',
  overview: 'the whole-board picture first',
};

const name = (loc: number, size: number) => (loc === PASS || loc < 0 ? 'pass' : locToGtp(loc, size));

function line(moves: readonly Move[], size: number): string {
  const shown = moves.slice(0, MAX_LINE).map((m) => `${m.color === 1 ? 'B' : 'W'} ${name(m.loc, size)}`);
  return shown.join(', ') + (moves.length > MAX_LINE ? ` … (${moves.length} moves)` : '');
}

/** The id a writer's own diagram gets: the next free dN. */
export function nextDiagramId(ex: Pick<Explanation, 'illustrations'>): string {
  return `d${(ex.illustrations?.length ?? 0) + 1}`;
}

/**
 * The writer's input for one explanation. `level` is the student's level, e.g. "about 3k".
 * The writer no longer builds diagrams of its own (version 4); nextDiagramId stays for the
 * site's parser of older answers.
 */
export function buildLmPrompt(ex: Explanation, level?: string): string {
  const size = ex.position.size;
  const out: string[] = [];
  out.push(`Question: ${ex.question.text.trim() || ex.question.kind}`);
  if (ex.question.move !== undefined) out.push(`Move asked about: ${name(ex.question.move, size)}`);
  out.push(`To play: ${ex.position.toPlay === 1 ? 'Black' : 'White'} (move ${ex.position.moves.length + 1}, ${size}x${size})`);
  if (level) out.push(`Student level: ${level}`);
  const sit = ex.situation;
  if (sit) {
    // A sharp position is never "wide open", whatever the stone count says.
    const sharp = sit.sharp ? `, sharp: ${[sit.lopsided ? 'one side far ahead' : '', sit.contact ? 'the last move was a contact play' : '', !sit.lopsided && !sit.contact ? 'one clear move' : ''].filter(Boolean).join(', ')}` : '';
    out.push(`Tone: ${TONE_WORDS[sit.tone]} (${sit.phase}${sit.open && !sit.sharp ? ', wide open' : ''}${sit.handicap ? ', handicap game' : ''}${sit.gap !== 'none' ? `, gap between the moves: ${sit.gap}` : ''}${sit.transposes ? ', the lines transpose' : ''}${sharp})`);
  }
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
  const draft = [ex.summary, ...ex.sections.map((x) => `${x.title}: ${x.text}`)].filter(Boolean).join('\n');
  if (draft) out.push('', 'Draft:', draft);
  return out.join('\n');
}
