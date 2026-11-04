/**
 * Rows for "KataGo's numbers" for every move with a mark on the board that the answer's own
 * facts do not already cover (critics, 2026-11-04: the list showed Q10 and Q12 while the board
 * marked six moves and the text judged R12). Made only from the answer's KataGo read (the read
 * the board's marks come from), in the board labels' rounding: within 0.3 points either way is
 * "about as good". No language model.
 */
import { candidateMarks } from '../../../src/lib/analysis/candidates';
import { fmt1, winPct } from '../../../src/lib/coach/explain/geometry';
import type { Explanation } from '../../../src/lib/coach/explain/types';
import { locToGtp } from '../../../src/lib/go/coords';
import { NOISE } from './candLabels';

export function markFacts(ex: Pick<Explanation, 'root' | 'position'>, facts: readonly { text: string }[], max: number): string[] {
  const marks = ex.root ? candidateMarks(ex.root.candidates, max) : [];
  if (!marks.length) return [];
  const size = ex.position.size;
  const side = ex.position.toPlay === 1 ? 'Black' : 'White';
  const best = marks[0];
  const B = locToGtp(best.loc, size);
  const covered = (at: string) => facts.some((f) => f.text.startsWith(`${at} is `) || f.text.includes(` is ${at}:`) || f.text.includes(` is ${at} `));
  const out: string[] = [];
  for (const m of marks) {
    const at = locToGtp(m.loc, size);
    if (covered(at)) continue;
    const win = `${side}'s win chance ${winPct(m.winrate)}`;
    if (m === best) {
      out.push(`KataGo's choice for ${side} is ${B} (${win}).`);
      continue;
    }
    const loss = Number(fmt1(best.scoreLead - m.scoreLead));
    const pts = (n: number) => `${fmt1(Math.abs(n))} ${fmt1(Math.abs(n)) === '1.0' ? 'point' : 'points'}`;
    out.push(
      loss >= NOISE
        ? `${at} is ${pts(loss)} worse than ${B} (${win}).`
        : loss <= -NOISE
          ? `${at} is ${pts(loss)} ahead of ${B} on a shorter read (${win}).`
          : `${at} is about as good as ${B} (${pts(loss)} apart; ${win}).`,
    );
  }
  return out;
}
