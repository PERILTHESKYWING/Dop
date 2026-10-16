/**
 * What kind of position and question this is, so the teacher text can pick its voice
 * (XIAO's critique, 2026-10-16): a wide-open opening is "play your style", two practically
 * equal moves are not split by a tenth of a point, a good move is celebrated, a blunder is
 * kept short, a life-and-death problem is solved without winrates, and "explain this
 * position" gets the board's picture first. The rubric's conditional rules read it too.
 */
import { lineOf } from '../../go/coords';
import { PASS } from '../../go/types';
import { groupOwn, looseGroups } from './geometry';
import { EQUAL_PTS, type Findings } from './planner';
import { styleOf } from './shapes';
import type { ConceptHit, LifeDeathVerdict, Situation } from './types';

/** Gaps (points for the mover) below which two moves count as practically equal, small, clear, big. */
export const NEGLIGIBLE_PTS = EQUAL_PTS;
export const NEGLIGIBLE_WIN = 0.03;
export const SMALL_PTS = 2;
export const CLEAR_PTS = 5;
export const BLUNDER_PTS = 15;
/** A mover's group of this many stones dying makes a move a blunder whatever the points. */
export const BLUNDER_STONES = 6;

export function gapClass(pts: number, win = 0): Situation['gap'] {
  if (pts < NEGLIGIBLE_PTS && win < NEGLIGIBLE_WIN) return 'negligible';
  if (pts < SMALL_PTS) return 'small';
  if (pts < CLEAR_PTS) return 'clear';
  if (pts < BLUNDER_PTS) return 'big';
  return 'blunder';
}

/** Stones on the board. */
export function stoneCount(f: Findings): number {
  let n = 0;
  for (const s of f.board.stones) if (s) n++;
  return n;
}

export function situationOf(f: Findings, concepts: ConceptHit[], ld?: LifeDeathVerdict | null): Situation {
  const size = f.pos.size;
  const area = size * size;
  const stones = stoneCount(f);
  const own = f.root?.ownership ?? null;
  let settled = 0;
  if (own) for (let p = 0; p < area; p++) if (Math.abs(own[p]) >= 0.8) settled++;
  const settledShare = own ? settled / area : 0;
  const handicap = f.pos.setup.length >= 2 && f.pos.setup.every((m) => m.color === 1) && f.pos.moves.length <= 30;
  const phase: Situation['phase'] = stones <= 0.12 * area && settledShare < 0.5 ? 'opening' : settledShare >= 0.7 || stones >= 0.45 * area ? 'endgame' : 'middle';

  // A problem: asked as one, or a set-up position whose board is settled but for one fight.
  const intent = f.question.intent;
  const setupOnly = !f.pos.moves.length && f.pos.setup.length > 0;
  const best = f.best;
  let fight = false;
  if (own && best && best.loc !== PASS) {
    fight = looseGroups(f.board).some((g) => {
      const v = groupOwn(g, own);
      return g.stones.length >= 2 && v > -0.7 && v < 0.7 && g.stones.some((s) => Math.abs((s % size) - (best.loc % size)) <= 2 && Math.abs(Math.floor(s / size) - Math.floor(best.loc / size)) <= 2);
    });
  }
  const tsumego = intent === 'live' || intent === 'kill' || intent === 'tesuji' || (setupOnly && !handicap && settledShare >= 0.75 && (fight || !!ld));

  // The gap that matters: the asked move against the best, else the best against the runner-up.
  const a = f.asked;
  let gap: Situation['gap'] = 'none';
  if (a && a.legal && !a.isBest && (a.read || f.mode === 'unchecked')) {
    gap = a.loss <= 0 ? 'negligible' : gapClass(a.loss, Math.max(0, (best?.win ?? 0) - a.win));
    const dies = concepts.some((h) => h.id === 'dead-group' && h.variation === f.vars.asked && f.board.stones[h.at[0]] === f.mover && /\((\d+) stones\)/.test(h.evidence) && Number(/\((\d+) stones\)/.exec(h.evidence)![1]) >= BLUNDER_STONES);
    if (dies && (gap === 'big' || gap === 'clear')) gap = 'blunder';
  } else if (best && (f.other || f.alternatives[0])) {
    const o = f.other ?? f.alternatives[0];
    gap = gapClass(Math.max(0, best.lead - o.lead), Math.max(0, best.win - o.win));
  }

  // Wide open: few stones and no fight, or several near-equal choices in the opening.
  const near = best ? [best, ...f.alternatives].filter((m) => best.lead - m.lead < 1 && m.loc !== PASS).length : 0;
  const weakNearBest = concepts.some((h) => h.id === 'urgent' || h.id === 'weak-group');
  const open = phase === 'opening' && !weakNearBest && (stones <= 0.035 * area || (handicap && f.pos.moves.length <= 4) || near >= 3);

  let tone: Situation['tone'];
  if (tsumego) tone = 'tsumego';
  else if (f.mode === 'overview') tone = 'overview';
  else if (gap === 'blunder') tone = 'blunder';
  else if (a && a.legal && (a.isBest || gap === 'negligible')) tone = 'celebrate';
  else if (!a && open) tone = 'relaxed';
  else if (a && phase === 'opening' && gap === 'small') tone = 'relaxed';
  else tone = 'teach';

  const out: Situation = { phase, open, handicap, tsumego, gap, tone };
  // Two good moves that make different games (a peaceful one and a fight, solid or outward).
  const pair = a && a.legal && !a.isBest && gap === 'negligible' && best ? [a.loc, best.loc] : !a && best && f.alternatives[0] && gap === 'negligible' ? [best.loc, f.alternatives[0].loc] : null;
  if (pair && !tsumego) {
    const st = pair.map((l) => styleOf(f.board, l, f.mover));
    if (st[0] !== st[1] && pair.every((l) => lineOf(l, size) >= 2)) out.styleChoice = true;
  }
  if (f.moveOrder) out.transposes = true;
  return out;
}
