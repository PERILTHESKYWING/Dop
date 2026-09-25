import { evaluateDeep, evaluateFast, searchedValue, type PositionSpec } from '../analysis/analyzer';
import { Board } from '../go/board';
import { chebyshev, locToGtp } from '../go/coords';
import { buildContext, moveFeatures, pointFeatures } from '../go/features';
import { PASS, type Loc } from '../go/types';
import { decodeOwnership } from '../engine/parse';
import type { EngineBackend } from '../engine/types';
import { signatureById } from '../profile/signatures';
import type { TrainingItem } from '../types';
import { DEFAULT_MIN_LOSING_WINRATE, isBalanced } from './balance';

/**
 * Engine-verified variations of a real position: the opponent's last move is shifted
 * to a nearby point, the position is re-analysed, and the correct decision is read
 * from the new analysis. Positions that look almost the same can then need a
 * different answer.
 */
export async function makeVariation(
  item: TrainingItem,
  engine: EngineBackend,
  rand: () => number = Math.random,
  visits = 32,
  minLosingWinrate = DEFAULT_MIN_LOSING_WINRATE,
): Promise<TrainingItem | null> {
  const last = item.moves[item.moves.length - 1];
  if (!last || last.loc === PASS || last.color === item.toPlay) return null;
  const base = new Board(item.size);
  for (const s of item.setup) base.stones[s.loc] = s.color;
  for (const m of item.moves.slice(0, -1)) base.play(m.loc, m.color, true);
  const options: Loc[] = [];
  for (let l = 0; l < item.size * item.size; l++) {
    if (l === last.loc) continue;
    if (chebyshev(l, last.loc, item.size) > 2) continue;
    if (!base.isLegal(l, last.color)) continue;
    options.push(l);
  }
  if (!options.length) return null;
  const alt = options[Math.floor(rand() * options.length)];
  const board = base.clone();
  board.play(alt, last.color, true);
  const history = [...item.moves.slice(0, -1), { color: last.color, loc: alt }];
  const spec: PositionSpec = { size: item.size, komi: item.komi, setup: item.setup, history, toPlay: item.toPlay, board };
  const fast = await evaluateFast(engine, spec);
  // The shifted move can tip the game; lopsided positions are not used for practice.
  if (!isBalanced(fast.bWin, minLosingWinrate)) return null;
  const deep = await evaluateDeep(engine, spec, fast, { visits, maxMs: 15000, candidateCount: 5 });
  if (!isBalanced(searchedValue(deep).bWin, minLosingWinrate)) return null;

  const sig = signatureById.get(item.signature);
  let expects = item.expectsContext;
  let kind: TrainingItem['kind'] = 'similar';
  if (sig) {
    const ctx = buildContext(board, decodeOwnership(deep.ownership));
    const f = moveFeatures(ctx, deep.bestLoc, deep.bestLoc, item.toPlay, alt, history.length + 1, 0);
    expects = sig.context(f);
    if (sig.decide) {
      const origCtx = buildContext(base, null);
      const was = sig.decide(pointFeatures(origCtx, item.eval.bestLoc, item.toPlay, last.loc), f);
      const now = sig.decide(pointFeatures(ctx, deep.bestLoc, item.toPlay, alt), f);
      if (was !== now) kind = 'boundary';
    }
  }
  return {
    ...item,
    id: `${item.id}:var:${alt}`,
    kind,
    moves: history,
    eval: deep,
    expectsContext: expects,
    difficulty: kind === 'boundary' ? 5 : 4,
    modification: {
      added: [{ color: last.color, loc: alt }],
      removed: [last.loc],
      note: `Opponent's last move shifted from ${locToGtp(last.loc, item.size)} to ${locToGtp(alt, item.size)}`,
    },
    createdAt: Date.now(),
  };
}
