/**
 * Pro notes: XIAO's own commentary on key moments of recent pro games, written next to
 * KataGo's numbers. They are the reference Kiai is measured against and later learns its
 * voice from. This file is the logic (which moments to show, the note format, export);
 * `ui/Annotate.tsx` is the page and `noteStore.ts` keeps the notes in this browser.
 */
import { lossFromEvals, type EvalSummary } from '../../../src/lib/coach/classify';
import type { EngineRead, ExplainPosition } from '../../../src/lib/coach/explain/types';
import { locToGtp } from '../../../src/lib/go/coords';
import { PASS, type Color, type Move } from '../../../src/lib/go/types';

/** Bumped when a note's fields change meaning, so old exports can be told apart. */
export const NOTES_FORMAT = 1;

/** A moment is worth a look when the mover gave away at least this much... */
export const MIN_SCORE_LOSS = 2;
export const MIN_WIN_LOSS = 0.08;
/** ...but once the game is decided the win chance barely moves, so only points count there. */
const DECIDED = 0.95;
const DECIDED_SCORE_LOSS = 4;
/** Moments offered per game, biggest first (more can be added by hand). */
export const MOMENTS_PER_GAME = 8;

export interface KeyMoment {
  /** The move's index in the game: the position before it is `positions[index]`. */
  index: number;
  color: Color;
  played: string;
  best: string | null;
  /** Points and win chance (0..1) the mover gave away, by KataGo. */
  scoreLoss: number;
  winLoss: number;
  /** The mover's win chance before the move, by KataGo's best line (0..1). */
  winBefore: number;
  visits: number;
}

const summary = (p: ExplainPosition, r: EngineRead): EvalSummary => ({ toPlay: p.toPlay, bWin: r.bWin, bLead: r.bLead, visits: r.visits, cands: r.candidates });

/** KataGo's numbers for one move, or null when either side of it is unread (or it is a pass). */
export function momentAt(positions: ExplainPosition[], reads: (EngineRead | undefined | null)[], moves: Move[], i: number): KeyMoment | null {
  const m = moves[i];
  const a = reads[i];
  const b = reads[i + 1];
  if (!m || !a || m.loc === PASS) return null;
  const p = positions[i];
  const loss = lossFromEvals(summary(p, a), m.loc, b ? summary(positions[i + 1], b) : null);
  if (!loss) return null;
  const best = a.candidates[0];
  const winBefore = best ? best.winrate : m.color === 1 ? a.bWin : 1 - a.bWin;
  return {
    index: i,
    color: m.color,
    played: locToGtp(m.loc, p.size),
    best: best ? locToGtp(best.loc, p.size) : null,
    scoreLoss: loss.scoreLoss,
    winLoss: loss.winrateLoss,
    winBefore,
    visits: a.visits,
  };
}

const counts = (k: KeyMoment) => {
  const decided = k.winBefore >= DECIDED || k.winBefore <= 1 - DECIDED;
  if (decided) return k.scoreLoss >= DECIDED_SCORE_LOSS;
  return k.scoreLoss >= MIN_SCORE_LOSS || k.winLoss >= MIN_WIN_LOSS;
};

/** How big a moment is, for picking the top few: points lost, plus win chance where it still means something. */
const weight = (k: KeyMoment) => k.scoreLoss + (k.winBefore < DECIDED && k.winBefore > 1 - DECIDED ? k.winLoss * 40 : 0);

/**
 * The moves where KataGo says the game turned: the `max` biggest losses, shown in game
 * order. Moves without both reads are skipped.
 */
export function keyMoments(positions: ExplainPosition[], reads: (EngineRead | undefined | null)[], moves: Move[], max = MOMENTS_PER_GAME): KeyMoment[] {
  const all: KeyMoment[] = [];
  for (let i = 0; i < moves.length; i++) {
    const k = momentAt(positions, reads, moves, i);
    if (k && counts(k)) all.push(k);
  }
  return all
    .sort((x, y) => weight(y) - weight(x))
    .slice(0, max)
    .sort((x, y) => x.index - y.index);
}

/** What the pro says about KataGo's call on this move. */
export type Verdict = 'mistake' | 'fine' | 'katago-wrong' | 'skip';

export const VERDICTS: { id: Verdict; en: string; zh: string; key: string }[] = [
  { id: 'mistake', en: 'Mistake', zh: '失误', key: '1' },
  { id: 'fine', en: 'Not a real mistake', zh: '不算失误', key: '2' },
  { id: 'katago-wrong', en: 'KataGo is wrong', zh: 'AI 判断有误', key: '3' },
  { id: 'skip', en: 'Skip', zh: '跳过', key: '0' },
];

/** The ideas a reason can name. Tags make the notes easy to score against Kiai's answers. */
export const TAGS: { id: string; en: string; zh: string }[] = [
  { id: 'direction', en: 'Direction', zh: '方向' },
  { id: 'thickness', en: 'Thickness', zh: '厚薄' },
  { id: 'weak-group', en: 'Weak group', zh: '弱棋' },
  { id: 'sente', en: 'Sente / gote', zh: '先后手' },
  { id: 'overconcentrated', en: 'Overconcentrated', zh: '重复' },
  { id: 'shape', en: 'Shape', zh: '棋形' },
  { id: 'life-death', en: 'Life and death', zh: '死活' },
  { id: 'fight', en: 'Fighting', zh: '战斗' },
  { id: 'territory', en: 'Territory / balance', zh: '实地与势' },
  { id: 'timing', en: 'Timing / move order', zh: '时机次序' },
  { id: 'aji', en: 'Aji', zh: '味道' },
  { id: 'endgame', en: 'Endgame size', zh: '官子' },
  { id: 'reading', en: 'Reading error', zh: '计算' },
  { id: 'too-slow', en: 'Too slow', zh: '缓手' },
  { id: 'overplay', en: 'Overplay', zh: '过分' },
];

export interface GameInfo {
  black: string;
  white: string;
  /** As written in the SGF (DT), often YYYY-MM-DD. */
  date: string;
  event: string;
  size: number;
}

export interface ProNote {
  format: number;
  /** `${gameId}#${index}`: one note per move per game. */
  id: string;
  gameId: string;
  game: GameInfo;
  index: number;
  /** Move number as printed on a kifu (index + 1). */
  moveNumber: number;
  color: 'B' | 'W';
  played: string;
  katago: { best: string | null; scoreLoss: number; winLoss: number; winBefore: number; visits: number; network: string };
  verdict: Verdict;
  /** The pro's better move (GTP), or null for "no single better move". */
  better: string | null;
  /** The pro's own words, in any language. */
  reason: string;
  tags: string[];
  /** Added by hand rather than picked by KataGo. */
  byHand: boolean;
  created: number;
  updated: number;
}

export const noteId = (gameId: string, index: number) => `${gameId}#${index}`;

/** A short stable id for a game: the hash of its moves, so the same game opened twice is one game. */
export function gameIdOf(size: number, setup: Move[], moves: Move[]): string {
  const s = `${size}|${setup.map((m) => `${m.color}${m.loc}`).join(',')}|${moves.map((m) => `${m.color}${m.loc}`).join(',')}`;
  // FNV-1a, 32 bit, twice with different seeds: plenty for a few hundred games.
  const fnv = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
  };
  return `g${fnv(0x811c9dc5)}${fnv(0x01000193)}`;
}

/** A note is done when it has a verdict and, unless skipped, a reason or at least one tag. */
export const isDone = (n: ProNote) => n.verdict === 'skip' || (n.reason.trim().length > 0 || n.tags.length > 0);

/** One JSON object per line, sorted by game then move, ready to upload or commit. */
export function toJsonl(notes: ProNote[]): string {
  return [...notes]
    .sort((a, b) => (a.gameId === b.gameId ? a.index - b.index : a.gameId < b.gameId ? -1 : 1))
    .map((n) => JSON.stringify(n))
    .join('\n')
    .concat(notes.length ? '\n' : '');
}

/** Reads an export back. Lines that are not notes are skipped and counted. */
export function fromJsonl(text: string): { notes: ProNote[]; bad: number } {
  const notes: ProNote[] = [];
  let bad = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const n = JSON.parse(line) as ProNote;
      if (typeof n.id === 'string' && typeof n.gameId === 'string' && typeof n.index === 'number' && typeof n.reason === 'string') notes.push(n);
      else bad++;
    } catch {
      bad++;
    }
  }
  return { notes, bad };
}

/** How the notes compare with KataGo so far: the share of moments where the pro agrees it is a mistake. */
export function agreement(notes: ProNote[]): { judged: number; mistake: number; fine: number; katagoWrong: number; sameMove: number } {
  const judged = notes.filter((n) => n.verdict !== 'skip');
  return {
    judged: judged.length,
    mistake: judged.filter((n) => n.verdict === 'mistake').length,
    fine: judged.filter((n) => n.verdict === 'fine').length,
    katagoWrong: judged.filter((n) => n.verdict === 'katago-wrong').length,
    sameMove: judged.filter((n) => n.better !== null && n.better === n.katago.best).length,
  };
}
