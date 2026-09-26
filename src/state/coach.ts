import type { ProbeRequest, ProbeResult } from '../../shared/ask';
import { engineMoves } from '../lib/analysis/analyzer';
import { engineEvaluator, Search } from '../lib/engine/mcts';
import type { Board } from '../lib/go/board';
import { gtpToLoc, locToGtp } from '../lib/go/coords';
import { PASS, type Color, type Move, other } from '../lib/go/types';
import { markInteractive, startEngine } from './actions';

export interface ProbeBase {
  size: number;
  /** Komi as given to KataGo. */
  komi: number;
  setup: Move[];
  moves: Move[];
  toPlay: Color;
  board: Board;
}

/** Play a line from the position and let KataGo search where it ends. */
export async function runProbe(base: ProbeBase, p: ProbeRequest, visits = 160, maxMs = 5000): Promise<ProbeResult> {
  const board = base.board.clone();
  const line: Move[] = [];
  let color = base.toPlay;
  for (const m of p.moves) {
    let loc;
    try {
      loc = gtpToLoc(m, base.size);
    } catch {
      return { moves: p.moves, legal: false, note: `${m} is not a point on the board` };
    }
    if (loc !== PASS && !board.isLegal(loc, color)) return { moves: p.moves, legal: false, note: `${m} is not playable for ${color === 1 ? 'Black' : 'White'} there` };
    board.play(loc, color);
    line.push({ color, loc });
    color = other(color);
  }
  const eng = await startEngine();
  if (!eng) return { moves: p.moves, legal: true, note: 'KataGo is not running' };
  markInteractive(maxMs + 2000);
  const search = new Search(engineEvaluator(eng), { size: base.size, komi: base.komi, moves: engineMoves(base.setup, [...base.moves, ...line]), toPlay: color, board }, { batch: eng.batch ?? 1 });
  const snap = await search.run({ visits, maxMs });
  const best = snap.candidates[0];
  return {
    moves: p.moves,
    legal: true,
    toPlay: color === 1 ? 'Black' : 'White',
    blackWinrate: Math.round(snap.bWin * 1000) / 10,
    blackLead: Math.round(snap.bLead * 10) / 10,
    bestLine: best ? best.pv.slice(0, 6).map((l) => locToGtp(l, base.size)) : [],
    visits: snap.visits,
  };
}
