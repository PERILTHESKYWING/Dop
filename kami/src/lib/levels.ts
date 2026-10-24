/**
 * Kiai's thinking levels, one picker (2026-10-20, XIAO): Low, Medium, High, xHigh, Max and
 * ultraGO. Each is a planner and a budget (src/lib/coach/explain/budgets.ts). Low to Max answer
 * from KataGo alone; ultraGO reads the most and has Kiai's writer word the answer, checked
 * against KataGo's facts like every other answer. The app never names the writer's provider.
 */
import type { ThinkingLevel } from '../../../src/lib/coach/explain/types';
import type { PickId } from './writer';

export type LevelId = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultrago' | 'local';

export interface Level {
  id: LevelId;
  name: string;
  /** One short line for the picker: what it does and how long it may take. */
  blurb: string;
  pick: PickId;
  thinking: ThinkingLevel;
}

export const LEVELS: readonly Level[] = [
  { id: 'low', name: 'Low', blurb: 'Answers in a few seconds.', pick: 'hane', thinking: 'medium' },
  { id: 'medium', name: 'Medium', blurb: 'Reads a few lines. Up to 14 seconds.', pick: 'tesuji', thinking: 'medium' },
  { id: 'high', name: 'High', blurb: 'Reads further ahead. Up to 20 seconds.', pick: 'tesuji', thinking: 'high' },
  { id: 'xhigh', name: 'xHigh', blurb: 'More lines, deeper. Up to 28 seconds.', pick: 'tesuji', thinking: 'xhigh' },
  { id: 'max', name: 'Max', blurb: 'The deepest engine read. Up to 38 seconds.', pick: 'tesuji', thinking: 'max' },
  { id: 'ultrago', name: 'ultraGO', blurb: 'Kiai’s deepest read, in its best words. Up to a minute.', pick: 'myoshu', thinking: 'max' },
];

export const LOCAL_LEVEL: Level = { id: 'local', name: 'Local', blurb: 'Beta. Kiai’s own small model, running on this device.', pick: 'local', thinking: 'medium' };

/**
 * Low by default (critics, round 2): the first answer on a phone's CPU then takes a few seconds,
 * not 13; every quick answer offers "Read longer" (longerLevel).
 */
export const DEFAULT_LEVEL: LevelId = 'low';

/** The level "Read longer" asks again at, for a quick read (null: already a long one). */
export function longerLevel(id: LevelId | null | undefined): Level | null {
  if (id === 'low' || id === 'medium' || id === 'local') return levelById('high');
  return null;
}

export function levelList(withLocal: boolean): Level[] {
  return withLocal ? [...LEVELS, LOCAL_LEVEL] : [...LEVELS];
}

export const levelById = (id: LevelId | null | undefined): Level => (id === 'local' ? LOCAL_LEVEL : LEVELS.find((l) => l.id === id) ?? LEVELS[0]);

/**
 * The level an older saved choice (a depth and a thinking level, before 2026-10-20) maps to,
 * so returning players keep roughly what they had.
 */
export function levelFromOld(pick: string | null, thinking: string | null): LevelId | null {
  if (!pick) return null;
  if (pick === 'myoshu') return 'ultrago';
  if (pick === 'local') return 'local';
  if (pick === 'hane') return 'low';
  if (pick === 'tesuji') return thinking === 'high' ? 'high' : 'medium';
  return null;
}

/** The label on an answer: its level, or for answers saved before levels, the nearest one. */
export function levelOfMessage(m: { level?: LevelId; pick?: PickId; thinking?: ThinkingLevel }): Level | null {
  if (m.level) return levelById(m.level);
  const old = levelFromOld(m.pick ?? null, m.thinking ?? null);
  return old ? levelById(old) : null;
}
