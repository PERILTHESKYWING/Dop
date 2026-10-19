/**
 * Kami's settings: one list of definitions, read anywhere with getSetting(), shown by the
 * Settings screen group by group. Values live in this browser (localStorage `kami.settings`);
 * a missing or out-of-range value falls back to its default.
 *
 * To add a setting, add a definition to SETTINGS. The screen draws it from the definition
 * alone, so no UI code is needed.
 */
import { useSyncExternalStore } from 'react';

export type SettingGroup = 'general' | 'profile' | 'board' | 'katago' | 'positions';

interface Base {
  key: string;
  group: SettingGroup;
  label: string;
  help?: string;
}
export type SettingDef =
  | (Base & { type: 'toggle'; default: boolean })
  | (Base & {
      type: 'number';
      default: number;
      min: number;
      max: number;
      step?: number;
      unit?: string;
    })
  /** Stored as a fraction (0.3), shown and edited as a percentage (30%). */
  | (Base & {
      type: 'percent';
      default: number;
      min: number;
      max: number;
      step?: number;
    })
  | (Base & {
      type: 'select';
      default: string;
      options: { value: string; label: string }[];
    })
  | (Base & {
      type: 'text';
      default: string;
      maxLength?: number;
      placeholder?: string;
    });

export type SettingValue = boolean | number | string;

export const SETTINGS: SettingDef[] = [
  // General
  {
    key: 'profile.name',
    group: 'general',
    type: 'text',
    label: 'What should Kiai call you?',
    default: '',
    maxLength: 40,
    placeholder: 'Your name',
  },
  {
    key: 'theme',
    group: 'general',
    type: 'select',
    label: 'Appearance',
    default: 'system',
    options: [
      { value: 'system', label: 'Match system' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ],
  },
  {
    key: 'answerFont',
    group: 'general',
    type: 'select',
    label: 'Answer font',
    help: 'How Kiai’s answers are set.',
    default: 'sans',
    options: [
      { value: 'serif', label: 'Serif' },
      { value: 'sans', label: 'Sans' },
    ],
  },
  {
    key: 'chat.enterSends',
    group: 'general',
    type: 'toggle',
    label: 'Enter sends',
    help: 'Shift+Enter starts a new line. Off: Ctrl+Enter sends.',
    default: true,
  },

  // Profile: how answers are pitched (style memory itself lives in style.ts).
  {
    key: 'profile.level',
    group: 'profile',
    type: 'select',
    label: 'Your Go level',
    help: 'Kiai matches its words, terms and depth to this.',
    default: 'intermediate',
    options: [
      { value: 'beginner', label: 'Beginner (new to Go, or 20–10 kyu)' },
      { value: 'intermediate', label: 'Intermediate (single-digit kyu)' },
      { value: 'strong', label: 'Strong (dan level)' },
    ],
  },
  {
    key: 'profile.style',
    group: 'profile',
    type: 'select',
    label: 'How you like to play',
    help: 'When two moves are close, Kiai points out the one that suits your game.',
    default: 'auto',
    options: [
      { value: 'auto', label: 'Learn from my moves' },
      { value: 'solid', label: 'Solid and safe' },
      { value: 'territory', label: 'Territory' },
      { value: 'influence', label: 'Influence and moyo' },
      { value: 'fighting', label: 'Fighting' },
    ],
  },

  // Board
  {
    key: 'board.3d',
    group: 'board',
    type: 'toggle',
    label: '3D board',
    help: 'The kaya board in real light, with KataGo’s reading drawn as light on it. Off: the flat board, lighter on old phones.',
    default: true,
  },
  {
    key: 'board.tilt',
    group: 'board',
    type: 'toggle',
    label: 'Tilt when idle',
    help: 'After a while without the pointer on it, the 3D board leans back a little; it straightens as soon as you come back.',
    default: true,
  },
  {
    key: 'board.coords',
    group: 'board',
    type: 'toggle',
    label: 'Coordinates',
    help: 'Letters and numbers round the board.',
    default: true,
  },
  {
    key: 'board.best',
    group: 'board',
    type: 'toggle',
    label: 'Show best moves',
    help: 'KataGo’s candidate moves as discs on the board.',
    default: true,
  },
  {
    key: 'board.bestCount',
    group: 'board',
    type: 'number',
    label: 'Best moves shown',
    help: 'At most this many discs.',
    default: 6,
    min: 1,
    max: 15,
  },
  {
    key: 'board.territory',
    group: 'board',
    type: 'toggle',
    label: 'Show territory',
    help: 'Shade the points KataGo expects each side to own.',
    default: false,
  },
  {
    key: 'board.hoverPreview',
    group: 'board',
    type: 'toggle',
    label: 'Preview moves on hover',
    help: 'Moves and lines in Kiai’s answers show on the board while the pointer is over them.',
    default: true,
  },

  // KataGo
  {
    key: 'katago.network',
    group: 'katago',
    type: 'select',
    label: 'Network',
    help: 'Auto: the strong b18 network on a computer with a GPU, the small b10 elsewhere. Takes effect after a reload.',
    default: 'auto',
    options: [
      { value: 'auto', label: 'Auto' },
      { value: 'b18', label: 'b18 (strong, 97 MB, GPU)' },
      { value: 'b10', label: 'b10 (small, CPU)' },
    ],
  },
  {
    key: 'katago.boardVisits',
    group: 'katago',
    type: 'number',
    label: 'Visits per board read',
    help: 'Depth of the read behind the best moves. More is surer and slower.',
    default: 120,
    min: 30,
    max: 2000,
    step: 10,
  },
  {
    key: 'katago.trendVisits',
    group: 'katago',
    type: 'number',
    label: 'Visits per move for the game graph',
    help: 'Trend, Blunder and Performance read every move at this depth.',
    default: 60,
    min: 10,
    max: 800,
    step: 10,
  },
  {
    key: 'katago.maxSeconds',
    group: 'katago',
    type: 'number',
    label: 'Longest read',
    help: 'A read stops here and uses what it has.',
    default: 20,
    min: 3,
    max: 120,
    unit: 's',
  },

  // Positions Kami builds to explain an idea (the answer pipeline reads these).
  {
    key: 'positions.minWinrate',
    group: 'positions',
    type: 'percent',
    label: 'Lowest win rate in a built position',
    help: 'A position Kiai sets up to explain an idea is only shown when KataGo gives each side at least this chance.',
    default: 0.3,
    min: 0.05,
    max: 0.5,
    step: 0.01,
  },
  {
    key: 'positions.enabled',
    group: 'positions',
    type: 'toggle',
    label: 'Build positions to explain ideas',
    help: 'With Careful or Deep, thinking medium or high, Kiai may cut the fight out of the game or set up a textbook position, then show it only if every check passes with KataGo reading last.',
    default: true,
  },
  {
    key: 'positions.writerDiagrams',
    group: 'positions',
    type: 'toggle',
    label: 'Let the writer propose positions',
    help: 'The AI writer may sketch its own position; KataGo checks it the same way, and it is dropped (with every sentence about it) if any check fails.',
    default: true,
  },
  {
    key: 'positions.visits',
    group: 'positions',
    type: 'number',
    label: 'KataGo visits for the final check',
    help: 'More visits make the last check stricter and slower.',
    default: 200,
    min: 50,
    max: 1000,
    step: 50,
    unit: 'visits',
  },
  {
    key: 'positions.maxKomi',
    group: 'positions',
    type: 'number',
    label: 'Largest komi to even a position',
    help: 'A built position gets a komi so neither side is far ahead. Positions that need more than this are not shown.',
    default: 30,
    min: 5,
    max: 60,
    step: 5,
    unit: 'points',
  },
  {
    key: 'positions.maxSeconds',
    group: 'positions',
    type: 'number',
    label: 'Time limit for building positions',
    default: 12,
    min: 3,
    max: 40,
    step: 1,
    unit: 's',
  },
];

export const GROUPS: { id: SettingGroup; label: string; blurb: string }[] = [
  { id: 'general', label: 'General', blurb: 'Your name, look and typing.' },
  {
    id: 'profile',
    label: 'Profile',
    blurb: 'What Kiai knows about you, so answers fit your level and the way you play. Kept in this browser only.',
  },
  { id: 'board', label: 'Board', blurb: 'What the board shows.' },
  {
    id: 'katago',
    label: 'KataGo',
    blurb: 'How deep the engine reads on this device.',
  },
  {
    id: 'positions',
    label: 'Positions',
    blurb: 'Positions Kiai sets up to explain an idea. Each one is checked by KataGo before it is shown.',
  },
];

const STORE = 'kami.settings';
let values: Record<string, SettingValue> = load();
let version = 0;
const listeners = new Set<() => void>();

function load(): Record<string, SettingValue> {
  try {
    const raw = localStorage.getItem(STORE);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export const settingDef = (key: string) => SETTINGS.find((d) => d.key === key);

/** A stored value if it still fits its definition, else the default. */
function valid(d: SettingDef, v: unknown): SettingValue {
  switch (d.type) {
    case 'toggle':
      return typeof v === 'boolean' ? v : d.default;
    case 'number':
    case 'percent':
      return typeof v === 'number' && Number.isFinite(v) ? Math.min(d.max, Math.max(d.min, v)) : d.default;
    case 'select':
      return typeof v === 'string' && d.options.some((o) => o.value === v) ? v : d.default;
    case 'text':
      return typeof v === 'string' ? v.slice(0, d.maxLength ?? 200) : d.default;
  }
}

export function getSetting<T extends SettingValue = SettingValue>(key: string): T {
  const d = settingDef(key);
  if (!d) throw new Error(`Unknown setting ${key}`);
  return valid(d, values[key]) as T;
}

export function setSetting(key: string, v: SettingValue) {
  const d = settingDef(key);
  if (!d) return;
  values = { ...values, [key]: valid(d, v) };
  save();
}

export function resetSettings(group?: SettingGroup) {
  const next = { ...values };
  for (const d of SETTINGS) if (!group || d.group === group) delete next[d.key];
  values = next;
  save();
}

function save() {
  version++;
  try {
    localStorage.setItem(STORE, JSON.stringify(values));
  } catch {
    /* blocked: the values last for this visit */
  }
  for (const l of listeners) l();
}

export function onSettings(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** A setting that re-renders the component when it changes. */
export function useSetting<T extends SettingValue = SettingValue>(key: string): T {
  useSyncExternalStore(onSettings, () => version);
  return getSetting<T>(key);
}
