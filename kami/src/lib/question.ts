/**
 * The student's words to a Question for the explainer, or to the concept library.
 * Plain pattern matching: coordinates (R16), "move 37", "why not X", "what should I play".
 */
import type { ConceptEntry } from '../../../src/lib/coach/library';
import type { ExplainPosition, Question, QuestionIntent, QuestionKind } from '../../../src/lib/coach/explain/types';
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
  /** "my move", "this move", "what should I have played": the last move on the board. */
  lastMove?: boolean;
  /** What the student is after when the words say more than the kind ("can Black kill this group?"). */
  intent?: QuestionIntent;
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
  /\bwhat\s+(?:should|do|would|can|could)\s+(?:i|we|you|black|white)\s+(?:play|do)\b|\bbest\s+move\b|\bwhere\s+(?:should|do|would|can|to)\b|\bwhat(?:'s|\s+is)\s+the\s+(?:best|right|correct|next)\s+(?:move|play)\b|\bnext\s+move\b|\bwhat\s+now\b|\bwhat\s+to\s+play\b|\bhow\s+(?:should|do)\s+(?:i|we|black|white)\s+(?:play|continue|respond|answer)\b|\bwhich\s+move\b|\bwhat\s+should\s+(?:my|our)\s+(?:next\s+)?move\s+be\b/i;

/** The move just played, named without a coordinate: "why was my move bad?", "is this move good?". */
const LAST_MOVE = /\b(?:my|this|that|the\s+last|my\s+last|the\s+previous|last)\s+(?:move|play|stone)\b|\bwhat(?:'s|\s+is|\s+was)\s+wrong\s+with\s+(?:it|that|this)\b|\b(?:was|is)\s+(?:it|that)\s+(?:a\s+)?(?:good|bad|mistake|wrong|ok|okay|fine)\b/i;
/** Asking what should have been played instead of the last move. */
const SHOULD_HAVE = /\b(?:should|could|would)\s+(?:i|we|black|white)\s+have\s+(?:played|done)\b|\bwhat\s+was\s+(?:the\s+)?(?:best|right|correct)\s+(?:move|play)\b|\bbetter\s+(?:move|play)\s+(?:there|instead)\b/i;

/**
 * Questions whose words say what the student is after (QuestionIntent). Kill comes before live:
 * "can Black kill this group or does it live?" is asked by the attacker.
 */
const INTENTS: [QuestionIntent, QuestionKind, RegExp][] = [
  ['kill', 'best', /\bkill(?:s|ed|ing)?\b|\b(?:is|are)\s+(?:it|this|that|they|these|those|(?:the|this|that|my|black'?s|white'?s)\s+(?:\w+\s+)?(?:group|stones?|chain|corner))\s+(?:already\s+|really\s+)?dead\b/i],
  ['live', 'best', /\b(?:live|lives|living|alive)\b|\bmake\s+(?:two\s+|an?\s+|(?:a\s+)?second\s+)?eyes?\b|\bsave\s+(?:this|the|that|my|these|those|black'?s|white'?s)\s+(?:\w+\s+)?(?:group|stones?|chain)\b/i],
  ['tesuji', 'best', /\btesujis?\b/i],
  ['ahead', 'overview', /\bwho(?:'s|\s+is)\s+(?:ahead|winning|leading|better|behind|losing)\b|\b(?:am\s+i|are\s+we|is\s+(?:black|white))\s+(?:ahead|winning|leading|behind|losing)\b/i],
  ['biggest', 'best', /\b(?:biggest|largest)\s+(?:move|point|play)s?\b/i],
];

/** A point named as a group's place ("the group at R16"), not as a move. */
const GROUP_AT = /\b(?:group|stones?|chain|corner)\s+(?:at|on|around|near)\s+[A-HJ-Za-hj-z]\d{1,2}\b/i;

function intentOf(t: string): [QuestionIntent, QuestionKind] | null {
  for (const [intent, kind, re] of INTENTS) if (re.test(t)) return [intent, kind];
  return null;
}

export function parseQuestion(text: string, size: number): ParsedQuestion {
  const t = text.trim().replace(/[’‘]/g, "'");
  const coords = findCoords(t, size);
  const num = t.match(/\bmove\s*(?:#|no\.?|number)?\s*(\d{1,3})\b/i);
  const moveNumber = num ? parseInt(num[1], 10) : undefined;
  // "What is a tesuji?" asks about the idea, not this board: no intent.
  const found = isConceptQuestion(t) ? null : intentOf(t);
  const intent = found ? { intent: found[0] } : {};
  const whyNot = WHY_NOT.exec(t);
  if (whyNot && coords.length) {
    // "Why not R16?" / "What about R16 instead?": the point after the phrase, else the first one.
    const after = coords.find((c) => c.at >= whyNot.index) ?? coords[0];
    return { kind: 'why-not', move: after.loc, ...intent, text: t };
  }
  // "Can Black kill the group at R16?": the point names the group; the question is the best move.
  if (found && found[1] === 'best' && coords.length && GROUP_AT.test(t)) return { kind: 'best', ...intent, text: t };
  if (coords.length) return { kind: 'why-move', move: coords[0].loc, ...intent, text: t };
  if (moveNumber !== undefined && moveNumber > 0) return { kind: 'why-move', moveNumber, ...intent, text: t };
  // "What should I have played?" is the best move in the position before the last move.
  if (SHOULD_HAVE.test(t)) return { kind: 'best', lastMove: true, ...intent, text: t };
  if (found) return { kind: found[1], ...intent, text: t };
  if (BEST.test(t)) return { kind: 'best', text: t };
  // "Why was my move bad?" is about the move on the board, not the opponent's next move.
  if (LAST_MOVE.test(t)) return { kind: 'why-move', lastMove: true, text: t };
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
  // "How does a group live?" on an empty board is about the idea; with stones, about this board.
  const aboutBoard = !parsed.intent || hasPosition(board);
  if (parsed.move !== undefined || parsed.moveNumber !== undefined || parsed.lastMove || (parsed.kind === 'best' && aboutBoard)) return { type: 'position', parsed };
  if (parsed.intent === 'ahead' && aboutBoard) return { type: 'position', parsed };
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
 * bad?", "move 37", "why was my move bad?") is asked about in the position before it was
 * played, since the engine can only judge a move on an empty point. "What should I have
 * played?" asks for the best move in that same earlier position.
 */
export function askFor(board: BoardState, parsed: ParsedQuestion): Asked {
  let upTo = board.cursor;
  let move = parsed.move;
  const played = (i: number) => i >= 0 && i < board.moves.length && board.moves[i].loc !== PASS;
  if (parsed.moveNumber !== undefined && parsed.move === undefined) {
    const n = Math.min(parsed.moveNumber, board.moves.length);
    if (n >= 1 && played(n - 1)) {
      upTo = n - 1;
      move = board.moves[n - 1].loc;
    }
  } else if (parsed.lastMove) {
    // "My move" / "this move": the last move on the board, judged before it was played.
    if (played(upTo - 1)) {
      upTo -= 1;
      if (parsed.kind === 'why-move') move = board.moves[upTo].loc;
    }
  } else if (parsed.kind === 'why-move' && move !== undefined) {
    // A point that was played earlier in the line ("why was R16 bad?" 30 moves later): go back
    // to just before its latest play, so the engine judges that move, not an occupied point.
    for (let i = upTo - 1; i >= 0; i--) {
      if (board.moves[i].loc === move) {
        upTo = i;
        break;
      }
    }
  }
  const kind: QuestionKind = parsed.kind === 'why-move' && move === undefined ? 'overview' : parsed.kind;
  const question: Question = {
    kind,
    text: parsed.text,
    ...(move !== undefined && kind !== 'overview' && kind !== 'best' ? { move } : {}),
    ...(parsed.intent ? { intent: parsed.intent } : {}),
  };
  return { pos: explainPositionOf(board, upTo), question, upTo };
}
