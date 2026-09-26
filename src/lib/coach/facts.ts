import type { FactGroup, PositionFacts } from '../../../shared/ask';
import { Board } from '../go/board';
import { groupStatus } from '../go/features';
import { locToGtp } from '../go/coords';
import { PASS, type Color, type Loc } from '../go/types';

/** What the page knows about a position: the board and KataGo's reading of it. */
export interface FactInput {
  board: Board;
  komi: number;
  moveNumber: number;
  toPlay: Color;
  lastMove?: Loc | null;
  /** Black's winrate (0–1) and lead. */
  bWin: number;
  bLead: number;
  visits: number;
  /** Candidates with winrate (0–1) and lead for the side to move, most visits first. */
  candidates: readonly { loc: Loc; winrate: number; scoreLead: number; visits: number; pv: readonly Loc[] }[];
  /** Black-positive ownership, when KataGo gave one. */
  ownership?: Float32Array | null;
  played?: { loc: Loc; winrateLoss: number; scoreLoss: number; bestLoc: Loc } | null;
  level?: string;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Rows top to bottom: X Black, O White, . empty; the last move is lower case (x / o). */
export function boardDiagram(board: Board, last?: Loc | null): string {
  const n = board.size;
  const cols = 'ABCDEFGHJKLMNOPQRSTUVWXYZ'.slice(0, n);
  const rows: string[] = ['   ' + cols.split('').join(' ')];
  for (let y = 0; y < n; y++) {
    const cells: string[] = [];
    for (let x = 0; x < n; x++) {
      const loc = y * n + x;
      const c = board.stones[loc];
      const ch = c === 1 ? 'X' : c === 2 ? 'O' : '.';
      cells.push(loc === last ? ch.toLowerCase() : ch);
    }
    rows.push(`${String(n - y).padStart(2, ' ')} ${cells.join(' ')}`);
  }
  return rows.join('\n');
}

/** Everything KataGo said about a position, as the fact sheet the language model may use. */
export function buildFacts(input: FactInput): PositionFacts {
  const { board } = input;
  const n = board.size;
  const g = (l: Loc) => locToGtp(l, n);
  const own = input.ownership ?? null;
  const groups: FactGroup[] = board
    .groups()
    .map((grp) => ({ grp, status: groupStatus(grp, own) }))
    // Name the groups worth talking about: bigger ones, weak or dead ones, and anything in atari.
    .filter(({ grp, status }) => grp.stones.length >= 3 || status === 'weak' || status === 'dead' || grp.liberties.length <= 2)
    .sort((a, b) => b.grp.stones.length - a.grp.stones.length)
    .slice(0, 16)
    .map(({ grp, status }) => ({
      color: grp.color === 1 ? 'Black' : 'White',
      stones: grp.stones.length,
      at: grp.stones.slice(0, 3).map(g),
      liberties: grp.liberties.length,
      status,
    }));
  let area: PositionFacts['area'];
  if (own) {
    let b = 0, w = 0;
    for (let i = 0; i < own.length; i++) {
      if (own[i] > 0.5) b++;
      else if (own[i] < -0.5) w++;
    }
    area = { black: b, white: w };
  }
  return {
    size: n,
    komi: input.komi,
    moveNumber: input.moveNumber,
    toPlay: input.toPlay === 1 ? 'Black' : 'White',
    lastMove: input.lastMove !== undefined && input.lastMove !== null && input.lastMove !== PASS ? g(input.lastMove) : undefined,
    diagram: boardDiagram(board, input.lastMove),
    blackWinrate: round1(input.bWin * 100),
    blackLead: round1(input.bLead),
    visits: input.visits,
    candidates: input.candidates
      .filter((c) => c.visits > 0)
      .slice(0, 6)
      .map((c) => ({ move: g(c.loc), winrate: round1(c.winrate * 100), lead: round1(c.scoreLead), visits: c.visits, line: c.pv.slice(0, 8).map(g) })),
    groups,
    area,
    played:
      input.played && input.played.loc !== PASS
        ? { move: g(input.played.loc), winrateLoss: round1(input.played.winrateLoss * 100), pointsLost: round1(input.played.scoreLoss), kataGoBest: g(input.played.bestLoc) }
        : undefined,
    level: input.level,
  };
}
