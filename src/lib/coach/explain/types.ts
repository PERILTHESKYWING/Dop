/**
 * Kami's shared contract (Kami = the Go coach site in kami/, built on Dop's engine): the
 * engine side (src/lib/coach/explain), the Kami site (kami/), the task factory and verifier
 * (scripts/coachlm/*.ts) and the training kit (scripts/coachlm/*.py, via tasks.jsonl) all
 * speak these types.
 * Change them only together with every user.
 *
 * Idea: KataGo does all the thinking. A planner in code decides which lines to read, the
 * reads become checked facts and variations, and text is built from those facts. A language
 * model (Gemini today, Kami's own small model later) may only reword the facts and refer to
 * the variations by id; it never adds moves or numbers of its own.
 */
import type { Color, Loc, Move } from '../../go/types';

/** Kami's "models": the same KataGo with different planners and budgets. */
export type ModelId = 'hane' | 'tesuji' | 'myoshu';
/** Claude-style thinking levels: how many reads and how deep. */
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

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
  { id: 'hane', name: 'Quick', blurb: 'Answers right away.', llm: false, defaultThinking: 'off' },
  { id: 'tesuji', name: 'Careful', blurb: 'Takes a few seconds.', llm: false, defaultThinking: 'medium' },
  { id: 'myoshu', name: 'Deep', blurb: 'Takes the longest, up to half a minute.', llm: true, defaultThinking: 'high' },
];

/** Version shown next to the model name; bumped only when the coach test set score goes up. */
export const KAMI_VERSION = '1.0';

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

/**
 * What the student is really after, when the words say more than the kind: "Can I kill this
 * group?" is a 'best' question with intent 'kill' (answered Yes/No first, no winrates).
 */
export type QuestionIntent = 'live' | 'kill' | 'tesuji' | 'ahead' | 'biggest';

export interface Question {
  kind: QuestionKind;
  /** The move asked about (for why-move / why-not). */
  move?: Loc;
  /** The student's words, kept for the text. */
  text: string;
  intent?: QuestionIntent;
}

/** How much the student knows (Kami's Settings › Profile; XIAO's global rules §6). */
export type StudentLevel = 'beginner' | 'intermediate' | 'strong';
/** The kind of game a player likes (learned from repeated choices, never from one move). */
export type PlayStyle = 'solid' | 'territory' | 'influence' | 'fighting';

export interface StudentProfile {
  level: StudentLevel;
  /** null or absent: not known yet. */
  style?: PlayStyle | null;
}

/**
 * What kind of position and answer this is. The teacher text picks its voice from it, and
 * the rubric's conditional rules (eval/coach/rubric.json, `when`) read it.
 */
export interface Situation {
  phase: 'opening' | 'middle' | 'endgame';
  /** Few stones and several near-equal moves: no single right answer. */
  open: boolean;
  handicap: boolean;
  /** A life-and-death or tesuji problem: answered without winrates or points. */
  tsumego: boolean;
  /** How far apart the compared moves are in practice ('none' when nothing was compared). */
  gap: 'none' | 'negligible' | 'small' | 'clear' | 'big' | 'blunder';
  /** The voice: celebrate a (nearly) best move, relax in open positions, teach a real difference, keep a blunder short, solve a problem, picture the board. */
  tone: 'celebrate' | 'relaxed' | 'teach' | 'blunder' | 'tsumego' | 'overview';
  /** Two good moves that lead to different kinds of game (peaceful or fighting). */
  styleChoice?: boolean;
  /** The two compared lines meet again (same position or the same moves in another order). */
  transposes?: boolean;
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
  | 'urgent'
  /** Sente for both sides at the same point (ryou-sente). */
  | 'double-sente'
  /** Gote for the mover, but it stops the opponent's sente move there (gyaku-sente). */
  | 'reverse-sente'
  /** The move saves stones that die without it. */
  | 'save-stones'
  /** A line runs into a ko. */
  | 'ko'
  /** A group too hard to save: giving it up and playing elsewhere beats helping the opponent get strong. */
  | 'sacrifice'
  /** The move reduces the opponent's framework (moyo). */
  | 'reduction'
  /** The move presses an opponent group while building (two purposes). */
  | 'attack';

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

/** One check a built position passed or failed, for the "checked by" list under a diagram. */
export interface IllustrationCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * A position built to show an idea on its own (a diagram), referenced from text as [[d1]].
 * Built by code (the real fight cut out and framed, a library or bank position, or a set-up
 * the writer asked for) and shown only after every check passed, KataGo's final read last.
 * Same shape as the board's preview minus key/pinned: base, line, highlight, title, note.
 */
export interface Illustration {
  /** 'd1', 'd2', ... referenced from text as [[d1]]. */
  id: string;
  /** Short chip text. */
  label: string;
  /** The diagram itself (setup stones, no moves), with the komi KataGo read it at. */
  base: ExplainPosition;
  /** KataGo's line from the diagram (its best move first). */
  line: Move[];
  highlight: Loc[];
  title: string;
  /** One or two lines, from KataGo's reads of the diagram only. */
  note: string;
  concept?: ConceptId | string;
  source: 'isolated' | 'library' | 'bank' | 'writer';
  /** The part of the board that matters (x0, y0, x1, y1), for zooming. */
  view?: [number, number, number, number];
  checks: IllustrationCheck[];
  /** KataGo's final read of the diagram. */
  read: { bWin: number; bLead: number; visits: number };
}

export interface Explanation {
  /** The position explained (variations start here). */
  position: ExplainPosition;
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
  /** Built positions that passed every check (absent or empty: none). */
  illustrations?: Illustration[];
  thoughts: ThoughtStep[];
  reads: number;
  totalVisits: number;
  ms: number;
  /** What kind of position and answer this was (absent in answers made before it existed). */
  situation?: Situation;
  /** The part of the board that matters (x0, y0, x1, y1) for a local problem: the board zooms there. */
  view?: [number, number, number, number];
  /** A life-and-death verdict from the local reader (lifeDeath.ts), when it ran. */
  lifeDeath?: LifeDeathVerdict;
}

/** The local life-and-death reader's verdict for one group. */
export interface LifeDeathVerdict {
  /** The group's stones (its anchor first). */
  target: Loc[];
  /** Whose group it is. */
  owner: Color;
  /** With the side to move playing first: the group's fate under best play. */
  result: 'alive' | 'dead' | 'ko' | 'seki' | 'unresolved';
  /** The same, when the other side plays first (the vital point's value). */
  ifOtherFirst: 'alive' | 'dead' | 'ko' | 'seki' | 'unresolved';
  /** The first move that achieves `result` (absent when no move is needed or unresolved). */
  key?: Loc;
  /** The proving line from `key`, both sides' best replies. */
  line: Loc[];
  /** The other side's line when it plays first (what happens if the key move is missed). */
  missLine: Loc[];
  /** Whether the search finished (true: proven within the local area; false: limits hit). */
  proven: boolean;
  nodes: number;
}

export type ExplainFn = (
  pos: ExplainPosition,
  question: Question,
  prober: Prober,
  opts: {
    model: ModelId;
    thinking: ThinkingLevel;
    signal?: AbortSignal;
    onThought?: (t: ThoughtStep) => void;
    /** Build a diagram of the idea on its own (false: never). Defaults by model and thinking. */
    illustrate?: Partial<IllustrateOptions> | false;
    /** Textbook positions for a concept id (Kami passes the library's examples). */
    examplesFor?: (concept: string) => import('../library/types').ConceptExample[];
    /** Who is asking: level and remembered style shape the wording (default intermediate, style unknown). */
    student?: StudentProfile;
  },
) => Promise<Explanation>;

/** How built positions are checked (Kami's settings feed these). */
export interface IllustrateOptions {
  /** Neither side may have less than this winrate in the shown diagram (0.3 = 30%). */
  minWinrate: number;
  /** Visits for KataGo's first read and its final read of a diagram. */
  firstVisits: number;
  visits: number;
  /** Largest komi (either way) a framed diagram may need to start even. */
  maxKomi: number;
  /** Wall-clock cap for building and checking one diagram. */
  maxMs: number;
  /** Most diagrams per answer. */
  max: number;
}
