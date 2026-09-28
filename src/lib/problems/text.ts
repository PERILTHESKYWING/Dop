import type { ForgeWriteRequest, ForgeWriteResponse, ProblemFacts, ProblemText } from '../../../shared/forgeWriter';
import { locToGtp, sgfToLoc } from '../go/coords';
import { colorName, other, type Loc } from '../go/types';
import { levelLabel } from './level';
import { colorOf, mainLine, rectOf, problemBoard, viewOf } from './play';
import { CATEGORY_TEXT, GOAL_TEXT, TAG_TEXT, type Problem } from './types';
import { decodeLocs } from './frame';

/**
 * The words around a problem. The app's own text needs no language model: the task, a hint
 * from the techniques KataGo's answer uses, and an explanation built from the answer and
 * refutation lines. When the LLM is set up, it writes better ones (shared/forgeWriter.ts),
 * checked against the same facts.
 */

const COLS = 'ABCDEFGHJKLMNOPQRST';

/** The problem window as text: column letters, then rows with their numbers. */
export function problemDiagram(p: Problem): string {
  const b = problemBoard(p);
  const v = viewOf(p) ?? { x0: 0, y0: 0, x1: p.size - 1, y1: p.size - 1 };
  const rows = ['   ' + COLS.slice(v.x0, v.x1 + 1).split('').join(' ')];
  for (let y = v.y0; y <= v.y1; y++) {
    let r = String(p.size - y).padStart(2) + ' ';
    const cells: string[] = [];
    for (let x = v.x0; x <= v.x1; x++) {
      const c = b.stones[y * p.size + x];
      cells.push(c === 1 ? 'X' : c === 2 ? 'O' : '.');
    }
    r += cells.join(' ');
    rows.push(r);
  }
  return rows.join('\n');
}

const gtp = (p: Problem, l: Loc) => locToGtp(l, p.size);

export function problemFacts(p: Problem): ProblemFacts {
  const me = colorOf(p);
  const line = mainLine(p.tree, p.size);
  const letter = (i: number) => ((i % 2 === 0 ? me : other(me)) === 1 ? 'B' : 'W');
  const firsts = Object.keys(p.tree.ok).map((k) => sgfToLoc(k, p.size));
  const cat = CATEGORY_TEXT[p.cat].label.toLowerCase();
  return {
    id: p.id,
    category: cat,
    task: taskLine(p),
    toPlay: colorName(me) as 'Black' | 'White',
    level: levelLabel(p.level),
    size: p.size,
    diagram: problemDiagram(p),
    answer: line.map((l, i) => `${letter(i)} ${gtp(p, l)}`),
    alsoWorks: firsts.slice(1).map((l) => gtp(p, l)),
    wrong: Object.entries(p.tree.bad ?? {}).map(([k, ref]) => ({ move: gtp(p, sgfToLoc(k, p.size)), refutation: ref.map((c, i) => `${letter(i + 1)} ${gtp(p, sgfToLoc(c, p.size))}`) })),
    techniques: p.tags.filter((t) => t !== 'live' && t !== 'kill').map((t) => TAG_TEXT[t] ?? t),
    stakes: p.stakes,
    group: p.target ? decodeLocs(p.target, p.size).slice(0, 3).map((l) => gtp(p, l)) : undefined,
    source: p.src.kind === 'pro' ? 'a professional game' : p.src.rank !== undefined ? `a ${levelLabel(p.src.rank)} game on Fox` : 'a game on Fox',
  };
}

export function taskLine(p: Problem): string {
  const c = colorName(colorOf(p)) as 'Black' | 'White';
  if (p.goal !== 'best') return `${GOAL_TEXT[p.goal](c)}.`;
  if (p.cat === 'tesuji') return `${c} to play: find the tesuji.`;
  if (p.cat === 'endgame') return `${c} to play: the biggest endgame move.`;
  return `${c} to play: find the best move.`;
}

const HINTS: Record<string, string> = {
  'throw-in': 'A stone thrown in to be captured can take away an eye or shorten liberties.',
  snapback: 'Sometimes giving a stone lets you take back more.',
  sacrifice: 'Be ready to give up a stone to get what matters.',
  placement: 'Look inside the shape, not around it.',
  'eye-steal': 'Find the point both sides need for an eye.',
  'first-line': 'The first line holds more than it seems.',
  atari: 'Check which stones are short of liberties.',
  capture: 'Some stones here are shorter of liberties than they look.',
};

/** The app's own text: no language model needed. */
export function fallbackText(p: Problem): ProblemText {
  const me = colorOf(p);
  const line = mainLine(p.tree, p.size);
  const name = colorName(me);
  const opp = colorName(other(me));
  const first = line[0] !== undefined ? gtp(p, line[0]) : '';
  const hintTag = p.tags.find((t) => HINTS[t]);
  const hint =
    hintTag !== undefined
      ? HINTS[hintTag]
      : p.goal === 'live'
        ? 'Make your eye space as large as possible, or find the vital point of the shape.'
        : p.goal === 'kill'
          ? 'Reduce the eye space from outside, or take the vital point.'
          : p.cat === 'endgame'
            ? 'Compare the moves that keep sente, and count what each is worth.'
            : 'Look for the move that works on two things at once.';
  const parts: string[] = [];
  if (line.length > 1) {
    const seq = line.slice(0, 7).map((l, i) => `${i % 2 === 0 ? name : opp} ${gtp(p, l)}`);
    parts.push(`${first} is the key. KataGo's line: ${seq.join(', ')}.`);
  } else parts.push(`${first} is the move.`);
  if (p.goal === 'live') parts.push(`With it, ${name}'s group lives; without it, ${opp} kills.`);
  if (p.goal === 'kill') parts.push(`With it, ${opp}'s group dies; without it, it lives.`);
  const alt = Object.keys(p.tree.ok).slice(1).map((k) => gtp(p, sgfToLoc(k, p.size)));
  if (alt.length) parts.push(`${alt.join(' and ')} also works.`);
  parts.push(`It is worth about ${p.stakes} points over the natural alternatives.`);
  const wrongNotes: Record<string, string> = {};
  for (const [k, ref] of Object.entries(p.tree.bad ?? {})) {
    const w = gtp(p, sgfToLoc(k, p.size));
    const r = ref[0] ? gtp(p, sgfToLoc(ref[0], p.size)) : '';
    wrongNotes[w] = r ? `${opp} answers at ${r} and ${p.goal === 'live' ? 'the group dies' : p.goal === 'kill' ? 'the group lives' : 'comes out ahead'}.` : 'KataGo refutes it.';
  }
  return { id: p.id, keep: true, instructive: 3, title: CATEGORY_TEXT[p.cat].label, question: taskLine(p), hint, explanation: parts.join(' '), wrongNotes };
}

/** Ask the LLM to write (and judge) a batch of problems. Null when it is unavailable. */
export async function writeTexts(problems: Problem[], playerLevel: number): Promise<ForgeWriteResponse | null> {
  if (!problems.length) return null;
  const req: ForgeWriteRequest = { task: 'forge-problems', playerLevel: levelLabel(playerLevel), problems: problems.map(problemFacts) };
  try {
    const res = await fetch('/api/llm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    return (await res.json()) as ForgeWriteResponse;
  } catch {
    return null;
  }
}

/** Is a point inside the problem's window (local problems)? */
export function inView(p: Problem, loc: Loc): boolean {
  const r = rectOf(p);
  if (!r) return true;
  const x = loc % p.size, y = Math.floor(loc / p.size);
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}
