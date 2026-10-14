/**
 * The Dop explainer's shared contract: the engine side (src/lib/coach/explain), the chat UI
 * (src/pages/Chat.tsx) and the training kit (scripts/coachlm) all speak these types.
 * Change them only together with every user.
 *
 * Idea: KataGo does all the thinking. A planner in code decides which lines to read, the
 * reads become checked facts and variations, and text is built from those facts. A language
 * model (Gemini today, Dop's own small model later) may only reword the facts and refer to
 * the variations by id; it never adds moves or numbers of its own.
 */
import type { Color, Loc, Move } from '../../go/types';

/** Dop's "models": the same KataGo with different planners and budgets. */
export type ModelId = 'hane' | 'tesuji' | 'kami';
/** Claude-style thinking levels: how many reads and how deep. */
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';

export interface ModelInfo {
  id: ModelId;
  name: string;
  /** One short line for the picker. */
  blurb: string;
  /** Whether an LLM may reword the answer (one call at most). */
  llm: boolean;
  defaultThinking: ThinkingLevel;
}

export const MODELS: readonly ModelInfo[] = [
  { id: 'hane', name: 'Dop Hane', blurb: 'Instant. Engine only.', llm: false, defaultThinking: 'off' },
  { id: 'tesuji', name: 'Dop Tesuji', blurb: 'Reads ahead and shows why.', llm: false, defaultThinking: 'medium' },
  { id: 'kami', name: 'Dop Kami', blurb: 'Deepest reads, best wording.', llm: true, defaultThinking: 'high' },
];

/** Version shown next to the model name; bumped only when the coach test set score goes up. */
export const DOP_VERSION = '1.0';

/** What the planner may spend on one answer. */
export interface Budget {
  /** Engine reads (searches) at most. */
  reads: number;
  /** Visits for the root read and for "why not" reads. */
  visits: number;
  /** Visits per step when playing a line out (consequence search). */
  lineVisits: number;
  /** How many moves a consequence line may run. */
  lineDepth: number;
  /** Wall-clock cap for the whole answer. */
  maxMs: number;
}

/** A position to explain, as the engine sees it. */
export interface ExplainPosition {
  size: number;
  /** Komi as given to KataGo. */
  komi: number;
  setup: Move[];
  moves: Move[];
  toPlay: Color;
}

/** One KataGo read of a position. Winrates 0–1. */
export interface EngineRead {
  visits: number;
  /** Black's winrate and lead. */
  bWin: number;
  bLead: number;
  /** Black-positive ownership, size*size, when the engine gave one. */
  ownership: Float32Array | null;
  /** Candidates for the side to move (its winrate and lead), most visits first. */
  candidates: { loc: Loc; winrate: number; scoreLead: number; visits: number; pv: Loc[] }[];
}

/** The engine, as the planner uses it: the browser worker, native KataGo or the WASM engine in Node. */
export interface Prober {
  read(pos: ExplainPosition, budget: { visits: number; maxMs: number }): Promise<EngineRead | null>;
}

export type QuestionKind =
  /** "Why is X good / bad?" (X = move). */
  | 'why-move'
  /** "Why not X instead?" */
  | 'why-not'
  /** "What should I play here?" */
  | 'best'
  /** "Explain this position." */
  | 'overview';

export interface Question {
  kind: QuestionKind;
  /** The move asked about (for why-move / why-not). */
  move?: Loc;
  /** The student's words, kept for the text. */
  text: string;
}

export type VariationKind = 'best' | 'refutation' | 'consequence' | 'what-if' | 'alternative';

export interface Variation {
  /** 'v1', 'v2', ... referenced from text as [[v1]]. */
  id: string;
  /** Short chip text: 'R16', 'the cut', 'after 25 moves'. */
  label: string;
  kind: VariationKind;
  /** The line, starting from the asked position. */
  moves: Move[];
  /** Points that matter where the line ends (a corner that flipped, a weak group). */
  highlight?: Loc[];
  /** Points lost against the best line, for the side to move, when meaningful. */
  scoreLoss?: number;
  /** One line, from checked facts only. */
  note?: string;
}

export type ConceptId =
  | 'sente'
  | 'gote'
  | 'miai'
  | 'weak-group'
  | 'dead-group'
  | 'thickness'
  | 'territory'
  | 'influence'
  | 'overconcentration'
  | 'aji'
  | 'ladder'
  | 'tenuki'
  | 'big-point'
  | 'urgent';

export interface ConceptHit {
  id: ConceptId;
  /** Where on the board. */
  at: Loc[];
  /** Why the detector fired, with KataGo's numbers. */
  evidence: string;
  /** The variation that shows it. */
  variation?: string;
}

/** One real step of thinking, for the "Thought for 6s" panel. */
export interface ThoughtStep {
  text: string;
  ms: number;
  visits: number;
  variation?: string;
}

/** A checked statement; every number in it came from KataGo. */
export interface Fact {
  id: string;
  text: string;
}

export interface Explanation {
  model: ModelId;
  version: string;
  thinking: ThinkingLevel;
  question: Question;
  /** The answer in one short paragraph, built from facts; may contain [[vN]]. */
  summary: string;
  /** Longer parts ("What goes wrong later", "The better move"); may contain [[vN]]. */
  sections: { title: string; text: string }[];
  facts: Fact[];
  concepts: ConceptHit[];
  variations: Variation[];
  thoughts: ThoughtStep[];
  reads: number;
  totalVisits: number;
  ms: number;
}

export type ExplainFn = (
  pos: ExplainPosition,
  question: Question,
  prober: Prober,
  opts: { model: ModelId; thinking: ThinkingLevel; signal?: AbortSignal; onThought?: (t: ThoughtStep) => void },
) => Promise<Explanation>;
