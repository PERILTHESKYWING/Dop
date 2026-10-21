/**
 * Background themes. Each theme is a quiet backdrop colour (components/Scenery.tsx,
 * styles/scenery.css) plus its colour tokens ([data-theme] in the stylesheets). The ids
 * are kept from the old painted scenes so saved settings still match. Paper is the default.
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
  { id: 'sunrise', name: 'Paper', description: 'Warm off-white, terracotta accent.', dark: false },
  { id: 'sakura', name: 'Clay', description: 'Dusty rose, plum accent.', dark: false },
  { id: 'mist', name: 'Slate', description: 'Cool grey-blue, ink-blue accent.', dark: false },
  { id: 'aurora', name: 'Ink', description: 'Near-black, teal accent.', dark: true },
];

export const DEFAULT_THEME: ThemeId = 'sunrise';
export const THEME_PREF = 'dop.theme';

export const isThemeId = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v);
export const themeInfo = (id: ThemeId) => THEMES.find((t) => t.id === id) ?? THEMES[0];

/** The theme this browser showed last (App keeps it in localStorage), for the first paint. */
export function storedTheme(): ThemeId | null {
  try {
    const v = localStorage.getItem(THEME_PREF);
    return isThemeId(v) ? v : null;
  } catch {
    return null;
  }
}
