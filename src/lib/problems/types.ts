/**
 * Forge problems: positions KataGo found in real games and verified, with the whole answer
 * tree (the moves that work, how the opponent resists, and how tempting wrong moves are
 * refuted). The bank is built offline by scripts/problem-bank.ts and shipped as
 * public/problems/bank.json. The language model only writes the words around a problem
 * (shared/forgeWriter.ts); it never decides what the answer is.
 */

export type ProblemCategory = 'life' | 'tesuji' | 'endgame' | 'middle';

/** What the player is asked to achieve. */
export type ProblemGoal = 'live' | 'kill' | 'best';

/**
 * A position where the player is to move. Keys are SGF coordinates ("dd").
 *  - ok: the moves that work, each with the opponent's strongest replies (one is played at
 *    random). An empty list means the problem is solved with that move.
 *  - bad: tempting moves that fail, with the refutation KataGo found (the opponent's reply
 *    first, then how it goes on).
 */
export interface ProblemNode {
  ok: Record<string, ProblemBranch[]>;
  bad?: Record<string, string[]>;
}

export interface ProblemBranch {
  /** The opponent's reply. */
  r: string;
  /** The player's next turn; absent when the reply settles the problem. */
  n?: ProblemNode;
}

export interface Problem {
  id: string;
  cat: ProblemCategory;
  goal: ProblemGoal;
  size: number;
  /** Black and white stones, SGF coordinates concatenated ("ddpq..."). */
  b: string;
  w: string;
  toPlay: 'B' | 'W';
  /** Window shown (x0, y0, x1, y1 inclusive) for local problems; absent = whole board. */
  view?: [number, number, number, number];
  tree: ProblemNode;
  /** Estimated level (rank number: 1k = 0, 1d = 1, 15k = -14), see lib/level/ranks.ts. */
  level: number;
  /** Chance a 1k player finds the whole answer, from the move-difficulty model (orders the levels). */
  score?: number;
  /**
   * The player's winrate in the problem position (0..1). Local problems are framed with a
   * komi that makes the right answer an even game, so theirs is about one half.
   */
  win: number;
  /** Local problems: the player's winrate in the real game the fight came from. */
  srcWin?: number;
  /** Points the right answer is worth over the natural alternatives. */
  stakes: number;
  /** Techniques found in the main line (see problemTags). */
  tags: string[];
  /** The group the goal is about (life and death), SGF coordinates. */
  target?: string;
  src: { kind: 'fox' | 'pro' | 'ai'; rank?: number; move: number };
  /** Local problems: the colour whose tsumego frame surrounds the window (frame.ts rebuilds it). */
  frame?: 'B' | 'W';
  /** Whole-board problems: the move just played (SGF coordinate). */
  last?: string;
  /** Same for a position and its mirror images (frame.ts canonicalKey). */
  key?: string;
}

export interface ProblemBank {
  version: 1;
  createdAt: string;
  engine: string;
  problems: Problem[];
}

export const CATEGORY_TEXT: Record<ProblemCategory | 'mine', { label: string; zh: string; blurb: string }> = {
  life: { label: 'Life and death', zh: '死活', blurb: 'Live or kill a group. Corner and side shapes from real games.' },
  tesuji: { label: 'Tesuji', zh: '手筋', blurb: 'One sharp move wins: sacrifices, throw-ins, nets and cuts.' },
  endgame: { label: 'Endgame', zh: '官子', blurb: 'Find the biggest and most precise endgame move.' },
  middle: { label: 'Best move', zh: '中盘', blurb: 'Whole-board fighting and direction: one move stands out.' },
  mine: { label: 'My mistakes', zh: '错题', blurb: 'Your own weaknesses, drilled on positions from your games.' },
};

export const GOAL_TEXT: Record<ProblemGoal, (toPlay: 'Black' | 'White') => string> = {
  live: (c) => `${c} to play and live`,
  kill: (c) => `${c} to play and kill`,
  best: (c) => `${c} to play`,
};

export const TAG_TEXT: Record<string, string> = {
  sacrifice: 'sacrifice',
  'throw-in': 'throw-in',
  snapback: 'snapback',
  atari: 'atari',
  capture: 'capture',
  'eye-steal': 'taking away an eye',
  'vital-point': 'vital point',
  hane: 'hane',
  placement: 'placement',
  connect: 'connection',
  cut: 'cut',
  'first-line': 'first-line move',
  ko: 'ko',
};
