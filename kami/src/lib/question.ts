/**
 * The student's words to a Question for the explainer, or to the concept library.
 * Plain pattern matching: coordinates (R16), "move 37", "why not X", "what should I play".
 */
import type { ConceptEntry } from '../../../src/lib/coach/library';
import type { ExplainPosition, Question, QuestionKind } from '../../../src/lib/coach/explain/types';
import { PASS, type Loc } from '../../../src/lib/go/types';
import { explainPositionOf, hasPosition, type BoardState } from './position';

const COLS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
const COORD_G = /\b([A-HJ-Za-hj-z])(\d{1,2})\b/g;

export interface ParsedQuestion {
  kind: QuestionKind;
  /** The point named in the text, valid on this board. */
  move?: Loc;
  /** "move 37": the 37th move of the line (1-based). */
  moveNumber?: number;
  text: string;
}

/** Every coordinate in the text that exists on a board of `size`, in order, with its index. */
export function findCoords(text: string, size: number): { loc: Loc; at: number; label: string }[] {
  const out: { loc: Loc; at: number; label: string }[] = [];
  for (const m of text.matchAll(COORD_G)) {
    const x = COLS.indexOf(m[1].toUpperCase());
    const row = parseInt(m[2], 10);
    if (x < 0 || x >= size || row < 1 || row > size) continue;
    out.push({ loc: (size - row) * size + x, at: m.index ?? 0, label: `${m[1].toUpperCase()}${row}` });
  }
  return out;
}

const WHY_NOT = /\bwhy\s+(?:not|didn'?t|don'?t|doesn'?t|can'?t|shouldn'?t|wouldn'?t|isn'?t)\b|\bwhat\s+about\b|\bhow\s+about\b|\bwhat\s+if\b|\b(?:can|could|may)\s+(?:i|black|white)\s+(?:play|try)\b|\binstead\b|\bisn'?t\s+\S+\s+better\b/i;
const BEST =
  /\bwhat\s+(?:should|do|would|can|could)\s+(?:i|we|you|black|white)\s+(?:play|do)\b|\bbest\s+move\b|\bwhere\s+(?:should|do|would|can|to)\b|\bwhat(?:'s|\s+is)\s+the\s+(?:best|right|correct|next)\s+(?:move|play)\b|\bnext\s+move\b|\bwhat\s+now\b|\bwhat\s+to\s+play\b|\bhow\s+(?:should|do)\s+(?:i|we|black|white)\s+(?:play|continue|respond|answer)\b|\bwhich\s+move\b|\bmy\s+move\b/i;

export function parseQuestion(text: string, size: number): ParsedQuestion {
  const t = text.trim().replace(/[’‘]/g, "'");
  const coords = findCoords(t, size);
  const num = t.match(/\bmove\s*(?:#|no\.?|number)?\s*(\d{1,3})\b/i);
  const moveNumber = num ? parseInt(num[1], 10) : undefined;
  const whyNot = WHY_NOT.exec(t);
  if (whyNot && coords.length) {
    // "Why not R16?" / "What about R16 instead?": the point after the phrase, else the first one.
    const after = coords.find((c) => c.at >= whyNot.index) ?? coords[0];
    return { kind: 'why-not', move: after.loc, text: t };
  }
  if (coords.length) return { kind: 'why-move', move: coords[0].loc, text: t };
  if (moveNumber !== undefined && moveNumber > 0) return { kind: 'why-move', moveNumber, text: t };
  if (BEST.test(t)) return { kind: 'best', text: t };
  return { kind: 'overview', text: t };
}

/** "What is miai?", "What does tenuki mean?": asks what an idea is, not about this board. */
const CONCEPT_Q = /\b(?:what\s+(?:is|are|does)|what's|define|definition\s+of|meaning\s+of|explain\s+(?:the\s+)?(?:idea|concept|term)\s+of|tell\s+me\s+about|how\s+does\s+\S+\s+work)\b/i;
const ABOUT_BOARD = /\b(?:this|here|now|position|board|moves?|stones?|groups?|game|black|white|plan|score|lead|winning|losing|ahead|behind|happening|going\s+on|wrong|mistake)\b/i;

export const isConceptQuestion = (text: string) => CONCEPT_Q.test(text) && !ABOUT_BOARD.test(text);

export type Route =
  | { type: 'position'; parsed: ParsedQuestion }
  | { type: 'concept'; entries: ConceptEntry[] };

/**
 * Where a question goes. A named point, a move number or "what should I play" goes to the
 * engine. Otherwise a named concept goes to the library, and so do "what is X?" questions and
 * anything asked with an empty board (with an honest fallback when the library has nothing).
 */
export function routeQuestion(text: string, board: BoardState, findConcepts: (t: string) => ConceptEntry[]): Route {
  const parsed = parseQuestion(text, board.size);
  if (parsed.move !== undefined || parsed.moveNumber !== undefined || parsed.kind === 'best') return { type: 'position', parsed };
  const entries = findConcepts(text);
  if (entries.length || !hasPosition(board) || isConceptQuestion(text)) return { type: 'concept', entries };
  return { type: 'position', parsed };
}

export interface Asked {
  pos: ExplainPosition;
  question: Question;
  /** Moves of the line in `pos` (the board steps here while answering). */
  upTo: number;
}

/**
 * The position and Question to explain. A move that is already on the board ("why was R16
 * bad?" right after R16, or "move 37") is asked about in the position before it was played,
 * since the engine can only judge a move on an empty point.
 */
export function askFor(board: BoardState, parsed: ParsedQuestion): Asked {
  let upTo = board.cursor;
  let move = parsed.move;
  if (parsed.moveNumber !== undefined && parsed.move === undefined) {
    const n = Math.min(parsed.moveNumber, board.moves.length);
    if (n >= 1 && board.moves[n - 1].loc !== PASS) {
      upTo = n - 1;
      move = board.moves[n - 1].loc;
    }
  } else if (parsed.kind === 'why-move' && move !== undefined && upTo > 0 && board.moves[upTo - 1].loc === move) {
    upTo -= 1;
  }
  const kind: QuestionKind = parsed.kind === 'why-move' && move === undefined ? 'overview' : parsed.kind;
  const question: Question = { kind, text: parsed.text, ...(move !== undefined && kind !== 'overview' && kind !== 'best' ? { move } : {}) };
  return { pos: explainPositionOf(board, upTo), question, upTo };
}
