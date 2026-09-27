import { engineMoves, type PositionSpec } from '../analysis/analyzer';
import { processRawOutput } from '../engine/parse';
import type { EngineBackend } from '../engine/types';
import { PASS, other, type Loc } from '../go/types';

/**
 * The choices a position offers, as the bundled network sees them at a glance: the most
 * natural-looking moves (by its policy) plus any moves asked about, each with its prior and
 * its cost in points (KataGo's look at the position after it, against the best of the set).
 * The move-difficulty corpus (scripts/move-corpus.ts) is measured with exactly this, so the
 * app's difficulty figures and the corpus use one ruler.
 */

export interface MoveChoice {
  loc: Loc;
  /** The network's policy prior for the move (how natural it looks). */
  prior: number;
  /** Points worse than the best move in the set, for the side to move (≥ 0). */
  loss: number;
  /** Winrate worse than the best move in the set, for the side to move (0..1). */
  winLoss: number;
}

export interface PositionChoices {
  /** Win probability for the side to move before the move (network). */
  win: number;
  choices: MoveChoice[];
}

/** How many of the network's most natural moves are always weighed. */
export const CHOICE_COUNT = 8;

export async function positionChoices(engine: EngineBackend, spec: PositionSpec, extra: readonly Loc[] = []): Promise<PositionChoices> {
  const req = { size: spec.size, komi: spec.komi, moves: engineMoves(spec.setup, spec.history), toPlay: spec.toPlay };
  const legal = spec.board.legalMask(spec.toPlay);
  const root = processRawOutput(await engine.evalRaw(req, false), spec.toPlay, (l) => legal[l] === 1, engine.postProcess);
  const hw = spec.size * spec.size;
  const order: Loc[] = [];
  for (let i = 0; i < hw; i++) if (legal[i] === 1 && root.policy[i] > 0) order.push(i);
  order.sort((a, b) => root.policy[b] - root.policy[a]);
  const locs = [...new Set([...order.slice(0, CHOICE_COUNT), ...extra.filter((l) => l !== PASS && l >= 0 && l < hw && legal[l] === 1)])];
  const vals: { loc: Loc; lead: number; win: number }[] = [];
  for (const loc of locs) {
    const board = spec.board.clone();
    board.play(loc, spec.toPlay);
    const next = other(spec.toPlay);
    const cl = board.legalMask(next);
    const child = processRawOutput(
      await engine.evalRaw({ ...req, moves: [...req.moves, { color: spec.toPlay, loc }], toPlay: next }, false),
      next,
      (l) => cl[l] === 1,
      engine.postProcess,
    );
    const mine = spec.toPlay === 1;
    vals.push({ loc, lead: mine ? child.bLead : -child.bLead, win: mine ? child.bWin : 1 - child.bWin });
  }
  const bestLead = Math.max(...vals.map((v) => v.lead));
  const bestWin = Math.max(...vals.map((v) => v.win));
  const win = spec.toPlay === 1 ? root.bWin : 1 - root.bWin;
  return {
    win,
    choices: vals.map((v) => ({ loc: v.loc, prior: root.policy[v.loc], loss: bestLead - v.lead, winLoss: bestWin - v.win })),
  };
}
