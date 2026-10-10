import type { ThemeId } from './themes';
import type { Color, Loc, Move } from './go/types';
import type { Region } from './go/coords';

export type GameSource = 'user' | 'opponent' | 'demo' | 'demo-opponent' | 'doppel';
export type AnalysisStatus = 'pending' | 'fast' | 'deep' | 'done' | 'error' | 'skipped';

export interface GameRecord {
  id: string;
  source: GameSource;
  /** Opponent profile this game belongs to (source = opponent). */
  opponentId?: string;
  fileName: string;
  sgf: string;
  size: number;
  komi: number;
  handicap: number;
  setup: Move[];
  moves: Move[];
  black: string;
  white: string;
  blackRank?: string;
  whiteRank?: string;
  result?: string;
  date?: string;
  event?: string;
  /** SGF RU[] (decides how komi is given to KataGo, see go/rules.ts). */
  rules?: string;
  /** Which colour the studied player had in this game (null = unknown). */
  playerColor: Color | null;
  importedAt: number;
  status: AnalysisStatus;
  error?: string;
  warnings: string[];
  progress: { fast: number; deep: number; deepTotal: number; total: number };
}

export interface EngineInfo {
  engine: string; // e.g. "katago-webgpu@d5ad1c0"
  backend: 'webgpu' | 'cpu' | 'none';
  modelId: string;
  modelName: string;
  modelVersion: number;
}

export interface PolicyEntry {
  loc: Loc;
  p: number;
}

export interface Candidate {
  loc: Loc;
  prior: number;
  /** Winrate for the side to move after playing this candidate (0..1). */
  winrate?: number;
  /** Score lead for the side to move after this candidate (points). */
  scoreLead?: number;
  visits?: number;
  pv?: Loc[];
}

/** One analysed position (the position BEFORE a move is played). */
export interface PositionEval {
  key: string;
  toPlay: Color;
  /** Black's win probability and black's score lead (points). */
  bWin: number;
  bLead: number;
  policy: PolicyEntry[];
  /** Ownership, black positive, quantised to -127..127, base64. */
  ownership?: string;
  /** Present after deep analysis: candidate moves with evaluations for the side to move. */
  candidates?: Candidate[];
  bestLoc: Loc;
  pv: Loc[];
  visits: number;
  depth: 'fast' | 'deep';
  /** bWin/bLead are the tree search's value (analysis version 3), not the network's first guess. */
  searched?: boolean;
  engine: EngineInfo;
  analyzedAt: number;
  /** Human-like policy (only with a compatible human SL model). */
  humanPolicy?: PolicyEntry[];
  /** The network's own first look (before any search), kept for level estimation. */
  net?: { bWin: number; bLead: number };
  /** The search stopped early at this budget because more visits could not change its best move. */
  settled?: number;
  /**
   * The doubt meter (analysis/analyzer.ts doubtOf): how much two looks at the board, one of
   * them turned, disagreed in the first pass. High doubt = a hard position.
   */
  doubt?: number;
  /** Where the value came from when not this device's own search: the opening book or the PC. */
  source?: 'book' | 'pc' | 'shared';
}

export interface GameAnalysis {
  gameId: string;
  /** evals[i] is the position before move i; evals[moves.length] is the final position. */
  evals: (PositionEval | null)[];
  /** Positions that get extra search visits (the model lab's hard examples). */
  deepTargets: number[];
  engine?: EngineInfo;
  updatedAt: number;
  /** ANALYSIS_VERSION when it was made; older analyses are redone. */
  version?: number;
  /** Komi given to KataGo (see go/rules.ts); a changed komi means a new analysis. */
  komi?: number;
}

export type Phase = 'opening' | 'middlegame' | 'endgame';
export type Severity = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export interface PointFeatures {
  line: number;
  region: Region;
  zone: number;
  distLast: number;
  local: boolean;
  tenuki: boolean;
  contact: boolean;
  captures: number;
  atari: boolean;
  selfAtari: boolean;
  savesAtari: boolean;
  extendsSmallWeak: boolean;
  nearOwnWeak: boolean;
  nearOppWeak: boolean;
  nearOwnSafe: boolean;
  invasion: boolean;
  reduction: boolean;
  /** Ownership at the point from the mover's perspective (-1..1), 0 if unknown. */
  ownership: number;
}

export interface MoveFeatures {
  phase: Phase;
  moveNumber: number;
  played: PointFeatures;
  best: PointFeatures;
  ownWeakGroups: number;
  oppWeakGroups: number;
  ownSmallWeakGroups: number;
  hasTactics: boolean;
  /** Mover's score lead before the move. */
  leadBefore: number;
  sameZoneAsBest: boolean;
  distToBest: number;
  /** The opponent's last move was next to one of the mover's safe groups (a probe). */
  lastNearOwnSafe: boolean;
}

export interface MoveRecord {
  id: string;
  gameId: string;
  index: number;
  color: Color;
  loc: Loc;
  isPlayer: boolean;
  bestLoc: Loc;
  playedPolicy: number;
  playedRank: number;
  /** Losses from the mover's perspective (>= 0). */
  winrateLoss: number;
  scoreLoss: number;
  /** The mover's winrate before the move (after KataGo's search when there was one). */
  winBefore: number;
  depth: 'fast' | 'deep';
  severity: Severity;
  features: MoveFeatures;
  /** Decision contexts present in this position (see signatures). */
  contexts: string[];
  /** Signatures of the mistake the move made (empty when not a mistake). */
  errors: string[];
  size: number;
}

export interface Evidence {
  moveId: string;
  gameId: string;
  index: number;
  scoreLoss: number;
  winrateLoss: number;
}

export interface Weakness {
  id: string;
  signature: string;
  category: FingerprintAxis;
  title: string;
  description: string;
  /** Times the decision context arose / times the error was made. */
  opportunities: number;
  occurrences: number;
  games: number;
  errorRate: number;
  baselineRate: number;
  avgScoreLoss: number;
  totalScoreLoss: number;
  confidence: number;
  evidence: Evidence[];
  /** Filled when the LLM refined the description. */
  llm?: { title: string; description: string; confidence: number; trainingFocus?: string; model: string };
  /** Trend of the error rate across the game history (older half vs newer half). */
  trend: { older: number; newer: number };
  /** How the player compares with players of their level on this decision (see level/peers). */
  peer?: { rank: number; peerRate: number; playerRate: number; ratio: number; opportunities: number };
  status: 'active' | 'improving' | 'resolved';
  discoveredAt: number;
  updatedAt: number;
}

export type FingerprintAxis =
  | 'opening'
  | 'fighting'
  | 'invasion'
  | 'attackDefence'
  | 'territoryInfluence'
  | 'tenuki'
  | 'sacrifice'
  | 'direction'
  | 'weakGroups'
  | 'endgame'
  | 'tactics';

export interface AxisStats {
  axis: FingerprintAxis;
  label: string;
  n: number;
  accuracy: number;
  avgScoreLoss: number;
  mistakeRate: number;
  /** Behavioural tendencies vs KataGo on the same positions. */
  tendencies: { label: string; player: number; engine: number }[];
  summary: string;
}

export interface PlayerProfile {
  id: 'me';
  name: string;
  aliases: string[];
  games: number;
  positions: number;
  playerMoves: number;
  overallAccuracy: number;
  avgScoreLoss: number;
  axes: AxisStats[];
  updatedAt: number;
  version: number;
}

export type TrainingKind = 'original' | 'similar' | 'counterexample' | 'boundary';

export interface TrainingItem {
  id: string;
  weaknessId: string;
  signature: string;
  kind: TrainingKind;
  sourceMoveId: string;
  gameId: string;
  index: number;
  size: number;
  komi: number;
  /** The source game's rules (KataGo's komi depends on them, see go/rules.ts). */
  rules?: string;
  setup: Move[];
  /** Moves leading to the position (history matters for the engine). */
  moves: Move[];
  toPlay: Color;
  /** If the position was modified from the source, the change made. */
  modification?: { added: Move[]; removed: Loc[]; note: string };
  /** Reference evaluation for grading. */
  eval: PositionEval;
  /** The move played here in the source game and what it cost (absent on engine variations and older items). */
  played?: { loc: Loc; scoreLoss: number; winrateLoss: number; policy: number; byPlayer: boolean };
  /** Whether the correct decision in this position avoids or embraces the signature's error. */
  expectsContext: boolean;
  difficulty: number;
  createdAt: number;
}

export type Grade = 'excellent' | 'good' | 'inaccurate' | 'mistake' | 'blunder';

export interface Attempt {
  id: string;
  itemId: string;
  weaknessId: string;
  signature: string;
  kind: TrainingKind;
  mode: 'forge' | 'blind';
  sessionId: string;
  loc: Loc;
  timeMs: number;
  scoreLoss: number;
  winrateLoss: number;
  grade: Grade;
  /** Did the move make the right kind of decision for this weakness? */
  conceptCorrect: boolean;
  /** Did the move repeat the weakness's specific error? */
  repeatedError: boolean;
  reason?: string;
  /** The analysis board was opened before answering: kept, but not counted in mastery or blind scores. */
  assisted?: boolean;
  at: number;
}

export interface BlindTest {
  id: string;
  weaknessId: string;
  itemIds: string[];
  startedAt: number;
  finishedAt?: number;
  attempts: string[];
  result?: { accuracy: number; conceptAccuracy: number; baseline: number; pValue: number; verdict: 'learned' | 'partial' | 'not-yet' };
}

export interface WeaknessMastery {
  weaknessId: string;
  level: number;
  mastery: number;
  attempts: number;
  lastPracticed: number;
  history: { at: number; mastery: number }[];
}

export interface OpponentProfile {
  id: string;
  name: string;
  aliases: string[];
  gameIds: string[];
  createdAt: number;
  updatedAt: number;
  stats?: import('./opponents/profile').OpponentStats;
  /** A copy of this player's move choices, learned from their analysed games. */
  copy?: import('./profile/doppel').DoppelModel;
}

export interface Settings {
  id: 'settings';
  playerNames: string[];
  modelId: string;
  forceCpu: boolean;
  fastVisits: number;
  /** Search visits per position in background analysis (0 = automatic, from this device's speed). */
  searchVisits: number;
  /** Live analysis stops at this many visits (0 = keeps going). */
  ponderLimit: number;
  /** Older settings, no longer used. */
  deepVisits: number;
  deepPerGame: number;
  autoAnalyze: boolean;
  useLlm: boolean;
  onboarded: boolean;
  /** Practice positions keep the side that is behind at this winrate or better (0.3 = 30%). */
  minLosingWinrate: number;
  /** Background animation and glass blur: auto = light on slower devices. */
  effects: 'auto' | 'full' | 'light';
  /** Background theme (lib/themes.ts). */
  theme: ThemeId;
  /**
   * Cool mode (lib/engine/governor.ts): fewer workers, rests between positions, no work in
   * the background, a live-analysis limit. Auto = on for phones and tablets.
   */
  coolMode: 'auto' | 'on' | 'off';
  /**
   * A big network (kata1 b18) beside the small one, judging the top of every search
   * (state/brain.ts). Auto = where a GPU or a strong computer can run it.
   */
  bigHelper: 'auto' | 'off';
  /** PC helper (pc-helper/dop_pc.py): address ('' = this computer), pairing code, use it or not, visits per position. */
  pcAddress: string;
  pcCode: string;
  pcUse: 'auto' | 'off';
  pcVisits: number;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  playerNames: [],
  modelId: 'auto',
  forceCpu: false,
  fastVisits: 1,
  searchVisits: 0,
  ponderLimit: 0,
  deepVisits: 64,
  deepPerGame: 24,
  autoAnalyze: true,
  useLlm: true,
  onboarded: false,
  minLosingWinrate: 0.3,
  effects: 'auto',
  theme: 'sunrise',
  coolMode: 'auto',
  bigHelper: 'auto',
  pcAddress: '',
  pcCode: '',
  pcUse: 'auto',
  pcVisits: 800,
};
