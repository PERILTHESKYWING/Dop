import { create } from 'zustand';
import type { Capabilities, LoadProgress } from '../lib/engine/browserEngine';
import type { LlmStatus } from '../lib/llm/client';
import type { DoppelModel } from '../lib/profile/doppel';
import type { DatasetMeta, LiteModelRecord } from '../lib/lab/model';
import {
  DEFAULT_SETTINGS,
  type Attempt,
  type BlindTest,
  type EngineInfo,
  type GameAnalysis,
  type GameRecord,
  type OpponentProfile,
  type PlayerProfile,
  type Settings,
  type TrainingItem,
  type Weakness,
  type WeaknessMastery,
} from '../lib/types';

export type EngineStatus = 'off' | 'detecting' | 'loading' | 'ready' | 'error' | 'unsupported';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'ok';
}

export interface AppState {
  loaded: boolean;
  settings: Settings;
  games: GameRecord[];
  analyses: Record<string, GameAnalysis>;
  profile: PlayerProfile | null;
  weaknesses: Weakness[];
  doppel: DoppelModel | null;
  items: Record<string, TrainingItem[]>;
  attempts: Attempt[];
  mastery: Record<string, WeaknessMastery>;
  blindTests: BlindTest[];
  opponents: OpponentProfile[];
  labModels: LiteModelRecord[];
  datasets: DatasetMeta[];
  /** Positions the lite model disagreed with KataGo most on (queued for deep analysis). */
  hardExamples: { gameId: string; index: number; pBest: number }[];

  caps: Capabilities | null;
  engine: {
    status: EngineStatus;
    info?: EngineInfo;
    progress?: LoadProgress;
    error?: string;
    /** Milliseconds per network evaluation on this device. */
    evalMs?: number;
    /** Networks/backends that were tried and failed before the one in use. */
    failures?: string[];
    note?: string;
  };
  /** The big network helper beside the main engine (state/brain.ts). */
  bigHelper: { status: 'off' | 'loading' | 'ready' | 'error'; model?: string; backend?: string; note?: string };
  llm: LlmStatus | null;
  queue: { running: boolean; paused: boolean; currentGameId?: string; lastError?: string };
  busy: { profile: boolean; llm: boolean; llmCheck?: boolean; lab: boolean; labStage?: string; labProgress?: number };
  corpusVersion: number;
  toasts: Toast[];
}

export const useStore = create<AppState>(() => ({
  loaded: false,
  settings: DEFAULT_SETTINGS,
  games: [],
  analyses: {},
  profile: null,
  weaknesses: [],
  doppel: null,
  items: {},
  attempts: [],
  mastery: {},
  blindTests: [],
  opponents: [],
  labModels: [],
  datasets: [],
  hardExamples: [],
  caps: null,
  engine: { status: 'off' },
  bigHelper: { status: 'off' },
  llm: null,
  queue: { running: false, paused: false },
  busy: { profile: false, llm: false, lab: false },
  corpusVersion: 0,
  toasts: [],
}));

export const set = useStore.setState;
export const get = useStore.getState;

let toastId = 1;
export function toast(text: string, tone: Toast['tone'] = 'info') {
  const id = toastId++;
  set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === 'error' ? 8000 : 4500);
}
