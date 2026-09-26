/**
 * Background themes. Each theme is a painted, animated scene (components/Scenery.tsx,
 * styles/scenery.css, art in public/art/<id>/ rendered by tools/art) plus its colour
 * tokens ([data-theme] in the stylesheets). The bright sunrise is the default.
 */
export type ThemeId = 'sunrise' | 'sakura' | 'mist' | 'aurora';

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  description: string;
  /** Dark panels and light text. */
  dark: boolean;
}

export const THEMES: ThemeInfo[] = [
  { id: 'sunrise', name: 'Sunrise meadow', description: 'Morning light over a meadow and a lone tree.', dark: false },
  { id: 'sakura', name: 'Sakura dusk', description: 'Cherry blossoms at dusk, petals drifting past.', dark: false },
  { id: 'mist', name: 'Misty peaks', description: 'Ink-wash mountains with slow-moving fog.', dark: false },
  { id: 'aurora', name: 'Aurora night', description: 'Northern lights over snowy peaks, stars turning.', dark: true },
];

export const DEFAULT_THEME: ThemeId = 'sunrise';
export const THEME_PREF = 'dop.theme';

export const isThemeId = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v);
export const themeInfo = (id: ThemeId) => THEMES.find((t) => t.id === id) ?? THEMES[0];
