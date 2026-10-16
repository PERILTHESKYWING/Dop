/**
 * When to call the local life-and-death reader (lifeDeath.ts) and on which group: a question
 * asked as a problem ("Can I kill this group?", "How does this group live?", "What is the
 * tesuji?"), or a set-up position whose board is settled except for one enclosed group next
 * to KataGo's move. KataGo's candidates are tried first; the reader proves or fails to prove
 * the result. Open fights (a group that can run) are left to KataGo.
 */
import { PASS, type Loc } from '../../go/types';
// TEMP until lifeDeath.ts lands
const findTarget = (..._a: unknown[]): { stones: Loc[] } | null => null;
const solveLifeDeath = (..._a: unknown[]): LifeDeathVerdict | null => null;
import type { Findings } from './planner';
import type { ConceptHit, LifeDeathVerdict } from './types';

/** Time for the reader inside one answer (it runs on the page's main thread). */
export const LD_MS = 1500;

export function readLifeDeath(f: Findings, concepts: ConceptHit[]): LifeDeathVerdict | null {
  const best = f.best;
  const own = f.root?.ownership ?? null;
  if (!best || best.loc === PASS) return null;
  const intent = f.question.intent;
  const asked = intent === 'live' || intent === 'kill' || intent === 'tesuji';
  if (!asked) {
    // Only a set-up problem with one fight left: the rest of the board settled.
    if (f.pos.moves.length || !own) return null;
    let settled = 0;
    for (const v of own) if (Math.abs(v) >= 0.8) settled++;
    if (settled < 0.75 * own.length) return null;
    if (!concepts.some((h) => h.id === 'urgent' || h.id === 'weak-group' || h.id === 'save-stones' || h.id === 'dead-group')) return null;
  }
  const near: Loc[] = [best.loc, ...best.pv.slice(1, 3)].filter((l) => l !== PASS);
  const target = findTarget(f.board, near, own);
  if (!target) return null;
  const hint = [...new Set([...best.pv.slice(0, 1), ...(f.root?.candidates.map((c) => c.loc) ?? []), ...best.pv])].filter((l) => l !== PASS);
  try {
    return solveLifeDeath(f.board, target.stones[0], f.mover, { maxMs: LD_MS }, hint);
  } catch {
    return null; // never let the reader break an answer
  }
}
