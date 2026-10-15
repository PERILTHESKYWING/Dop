/** The board a Kami conversation is about: a game line, how far into it we are, and helpers. */
import { parseSgfCollection, extractGame } from '../../../src/lib/go/sgf';
import { replay } from '../../../src/lib/go/board';
import { engineKomi } from '../../../src/lib/go/rules';
import { other, PASS, type Color, type Loc, type Move } from '../../../src/lib/go/types';
import type { ExplainPosition } from '../../../src/lib/coach/explain/types';

export interface BoardState {
  size: number;
  /** Komi as written in the game; `rules` decide what KataGo gets (engineKomi). */
  komi: number;
  rules?: string;
  setup: Move[];
  /** The whole line (a loaded game, or the moves played by clicking). */
  moves: Move[];
  /** Moves of the line on the board now. */
  cursor: number;
  /** Who plays first after the setup stones. */
  first: Color;
  /** Shown in the board panel: players of a loaded game, or an example's title. */
  title?: string;
}

export const emptyBoard = (size = 19): BoardState => ({ size, komi: 7.5, setup: [], moves: [], cursor: 0, first: 1 });

export const hasPosition = (b: BoardState) => b.setup.length > 0 || b.cursor > 0;

/** Side to move after `upTo` moves of the line. */
export function toPlayAt(b: BoardState, upTo = b.cursor): Color {
  return upTo > 0 ? other(b.moves[upTo - 1].color) : b.first;
}

export function explainPositionOf(b: BoardState, upTo = b.cursor): ExplainPosition {
  return { size: b.size, komi: engineKomi(b.komi, b.rules), setup: b.setup, moves: b.moves.slice(0, upTo), toPlay: toPlayAt(b, upTo) };
}

export const stonesOf = (b: BoardState) => replay(b.size, b.setup, b.moves, b.cursor).stones;

/** Play at `loc` (or pass) for the side to move; the line after the cursor is replaced. Null if illegal. */
export function playAt(b: BoardState, loc: Loc): BoardState | null {
  const color = toPlayAt(b);
  if (loc !== PASS) {
    const board = replay(b.size, b.setup, b.moves, b.cursor);
    if (!board.isLegal(loc, color)) return null;
  }
  const moves = [...b.moves.slice(0, b.cursor), { color, loc }];
  return { ...b, moves, cursor: moves.length };
}

/** At the end of the line: take the last move back. Inside a loaded game: step back. */
export function undo(b: BoardState): BoardState {
  if (b.cursor === 0) return b;
  if (b.cursor === b.moves.length) return { ...b, moves: b.moves.slice(0, -1), cursor: b.cursor - 1 };
  return { ...b, cursor: b.cursor - 1 };
}

export const goTo = (b: BoardState, n: number): BoardState => ({ ...b, cursor: Math.max(0, Math.min(b.moves.length, n)) });

/** First game in an SGF; setup-only positions (problems) are fine. Opens at the last move. */
export function boardFromSgf(text: string): BoardState {
  const trees = parseSgfCollection(text);
  if (!trees.length) throw new Error('No game found in that SGF.');
  const g = extractGame(trees[0]);
  if (![9, 13, 19].includes(g.size)) throw new Error(`Kami reads 9x9, 13x13 and 19x19 boards, not ${g.size}x${g.size}.`);
  const pl = (trees[0].props.PL?.[0] ?? '').toUpperCase();
  const handicapWhite = g.setup.length > 1 && g.setup.every((m) => m.color === 1);
  const first: Color = g.moves[0]?.color ?? (pl === 'W' ? 2 : pl === 'B' ? 1 : handicapWhite ? 2 : 1);
  const names = [g.black, g.white].filter(Boolean);
  return {
    size: g.size,
    komi: g.komi,
    rules: g.rules,
    setup: g.setup,
    moves: g.moves,
    cursor: g.moves.length,
    first,
    title: names.length === 2 ? `${g.black} vs ${g.white}` : names[0],
  };
}

/** A concept example (or any ExplainPosition) as a board. `komi` there is already KataGo's. */
export function boardFromPosition(p: ExplainPosition, title?: string): BoardState {
  // rules 'area' keeps the komi as it is (engineKomi adds nothing).
  return { size: p.size, komi: p.komi, rules: 'area', setup: p.setup, moves: p.moves, cursor: p.moves.length, first: p.moves[0]?.color ?? p.toPlay, title };
}

export const looksLikeSgf = (text: string) => /^\s*\(\s*;/.test(text) && /\)\s*$/.test(text);
