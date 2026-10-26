/**
 * The caption over the board while a move or line is previewed (critics, round 3: "a hover
 * caption that explains the previewed move"). One plain line, made only of KataGo's numbers
 * already on screen: where the move ranks in KataGo's read, the win chance after it, what it
 * loses against KataGo's choice (in the board labels' rounding, lib/candLabels.ts) and how many
 * visits it got. No language model, and nothing about the board that KataGo did not measure.
 */
import { fmt1 } from '../../../src/lib/coach/explain/geometry';
import type { EngineRead } from '../../../src/lib/coach/explain/types';
import { locToGtp } from '../../../src/lib/go/coords';
import { PASS, type Color, type Loc } from '../../../src/lib/go/types';

type Cands = EngineRead['candidates'];

const ordinal = (n: number) => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

export interface MoveStats {
  /** The move's point, e.g. "Q9". */
  at: string;
  /** "KataGo’s 2nd choice · Black 54%, 1.2 points worse · 1,200 visits" (`compact`: shorter, for a phone). */
  text: string;
}

/**
 * KataGo's numbers for `loc` played by `toPlay`, from `read` (its candidates are for the side to
 * play). Null when there is no read, the move is a pass, or `loc` is off the board. A move KataGo
 * did not list says so, with the size of the list ("not in KataGo’s top 8").
 */
export function moveStats(read: Pick<EngineRead, 'candidates'> | null | undefined, loc: Loc | undefined, toPlay: Color, size: number, compact = false): MoveStats | null {
  if (!read?.candidates.some((c) => c.loc !== PASS) || loc === undefined || loc === PASS || loc < 0 || loc >= size * size) return null;
  const at = locToGtp(loc, size);
  // Ranked in the read's own order, as the board's discs are (candidateMarks): KataGo's choice first.
  const byVisits: Cands = read.candidates.filter((c) => c.loc !== PASS);
  const i = byVisits.findIndex((c) => c.loc === loc);
  if (i < 0) return { at, text: compact ? `not in KataGo’s top ${byVisits.length}` : `Not in KataGo’s top ${byVisits.length} moves here` };
  const c = byVisits[i];
  const best = byVisits[0];
  const side = toPlay === 1 ? 'Black' : 'White';
  const rank = i === 0 ? 'KataGo’s choice' : compact ? `${ordinal(i + 1)} choice` : `KataGo’s ${ordinal(i + 1)} choice`;
  const win = `${side} ${Math.round(c.winrate * 100)}%`;
  let loss = '';
  if (i > 0) {
    const d = best.scoreLead - c.scoreLead;
    const shown = fmt1(Math.abs(d));
    const pts = shown === '1.0' ? 'point' : 'points';
    loss = Number(shown) === 0 ? 'about as good' : d > 0 ? `${shown} ${compact ? 'pts' : pts} worse` : `${shown} ${compact ? 'pts' : pts} ahead on fewer visits`;
  }
  const visits = `${c.visits.toLocaleString('en-US')} visits`;
  const text = compact ? [rank, loss || win, visits].join(' · ') : [rank, loss ? `${win}, ${loss}` : win, visits].join(' · ');
  return { at, text };
}
