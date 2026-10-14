/**
 * How a game against the copy is set up: dials that bend the copy away from (or toward)
 * the player as measured, and presets for the usual moods.
 */
export type Mood = 'auto' | 'calm' | 'tilted' | 'behind' | 'ahead';

export interface CopyDials {
  preset: PresetId | 'custom';
  /** 1: the player's own habits; 0: KataGo's instinct. */
  faithfulness: number;
  /** How often the copy goes wrong, times the player's own rate (0: never on purpose). */
  mistakes: number;
  /** The biggest mistake allowed, in points (0: no limit beyond the player's own). */
  maxMistake: number;
  /** Never the obvious blunders a player at this level wouldn't make by accident. */
  guard: boolean;
  /** Moves into a 19x19 game the player's own opening book is used (0: off). */
  book: number;
  /** Variety: 0 always plays its likeliest move, 1 varies as the player does, 2 twice as much. */
  variety: number;
  /** Leanings on top of the player's habits, -1..1. */
  fighting: number;
  territory: number;
  tenuki: number;
  /** auto: as the game goes (tilts after a mistake if the player does). */
  mood: Mood;
  /** Mistakes of the kinds the player makes. */
  types: boolean;
  /** Target level (profile/strength.ts) instead of the player's own mistake rate; null: the player's. */
  strength: number | null;
}

export type PresetId = 'me' | 'good' | 'bad' | 'behind' | 'stronger';

export const DEFAULT_DIALS: CopyDials = {
  preset: 'me',
  faithfulness: 1,
  mistakes: 1,
  maxMistake: 0,
  guard: true,
  book: 40,
  variety: 1,
  fighting: 0,
  territory: 0,
  tenuki: 0,
  mood: 'auto',
  types: true,
  strength: null,
};

export const PRESETS: { id: PresetId; label: string; sub: string; dials: Partial<CopyDials> }[] = [
  { id: 'me', label: 'Me', sub: 'As your games show', dials: {} },
  { id: 'good', label: 'Me on a good day', sub: 'Fewer, smaller mistakes', dials: { mistakes: 0.55, maxMistake: 6, variety: 0.85, mood: 'calm' } },
  { id: 'bad', label: 'Me on a bad day', sub: 'More mistakes, tilts after one', dials: { mistakes: 1.6, variety: 1.15, mood: 'tilted' } },
  { id: 'behind', label: 'Me when behind', sub: 'Plays as you do when losing', dials: { mood: 'behind', fighting: 0.3 } },
  { id: 'stronger', label: 'Stronger me', sub: 'Your style, a few stones stronger', dials: { mistakes: 0.35, maxMistake: 3, variety: 0.8, mood: 'calm' } },
];

export function presetDials(id: PresetId, keep: Pick<CopyDials, 'strength'> = { strength: null }): CopyDials {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
  return { ...DEFAULT_DIALS, ...p.dials, strength: keep.strength, preset: p.id };
}

/** Dials as stored (older or partial values filled from the defaults). */
export function readDials(v: unknown): CopyDials {
  const d = (v && typeof v === 'object' ? v : {}) as Partial<CopyDials>;
  const num = (x: unknown, lo: number, hi: number, def: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : def);
  const moods: Mood[] = ['auto', 'calm', 'tilted', 'behind', 'ahead'];
  return {
    preset: d.preset && (d.preset === 'custom' || PRESETS.some((p) => p.id === d.preset)) ? d.preset : 'me',
    faithfulness: num(d.faithfulness, 0, 1, DEFAULT_DIALS.faithfulness),
    mistakes: num(d.mistakes, 0, 2, DEFAULT_DIALS.mistakes),
    maxMistake: num(d.maxMistake, 0, 30, DEFAULT_DIALS.maxMistake),
    guard: typeof d.guard === 'boolean' ? d.guard : DEFAULT_DIALS.guard,
    book: num(d.book, 0, 120, DEFAULT_DIALS.book),
    variety: num(d.variety, 0, 2, DEFAULT_DIALS.variety),
    fighting: num(d.fighting, -1, 1, 0),
    territory: num(d.territory, -1, 1, 0),
    tenuki: num(d.tenuki, -1, 1, 0),
    mood: moods.includes(d.mood as Mood) ? (d.mood as Mood) : 'auto',
    types: typeof d.types === 'boolean' ? d.types : DEFAULT_DIALS.types,
    strength: typeof d.strength === 'number' && Number.isFinite(d.strength) ? d.strength : null,
  };
}
