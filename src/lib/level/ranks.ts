/**
 * Go ranks on one number line: 1 kyu is 0, 18 kyu is -17, 1 dan is 1, 9 dan is 9.
 * Kyu and dan meet without a gap, as on Fox, where 1k → 1d is one step.
 * Above Fox's 9 dan the line goes on: 10 is a professional, 11 a top professional (or
 * half way to AI), 12 is AI.
 */

export const MIN_RANK = -17; // 18k
export const MAX_RANK = 12; // AI
/** Fox's top amateur rank. */
export const AMATEUR_TOP = 9;
export const PRO_RANK = 10;
export const TOP_PRO_RANK = 11;
export const AI_RANK = 12;

/** Parse "3k", "3 kyu", "3級", "3级", "5d", "5段", "5 dan", "P9", "9p", "职业". Null if unknown. */
export function parseRank(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s || s === '-' || s === '?') return null;
  if (/^(p\d|\d+p|pro|职业|職業)/.test(s)) return PRO_RANK;
  const m = s.match(/(\d+)\s*(k|kyu|级|級|d|dan|段)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const kyu = /k|kyu|级|級/.test(m[2]);
  if (kyu) return n > 30 ? null : 1 - n;
  return n > AMATEUR_TOP ? null : n;
}

/**
 * One decimal: 8.74 → "8.7d", -4.2 → "5.2k". The step between 1k (0) and 1d (1) has no
 * decimals of its own, so it reads as 1.0k up to half way and 1.0d after.
 */
export function rankLabel(r: number): string {
  const x = clampRank(r);
  if (x >= 0.5) return `${Math.max(1, x).toFixed(1)}d`;
  return `${Math.max(1, 1 - x).toFixed(1)}k`;
}

/** Whole ranks, for tick marks and slider stops: 3 → "3d", -4 → "5k". */
export function rankLabelWhole(r: number): string {
  const n = Math.round(clampRank(r));
  return n >= 1 ? `${n}d` : `${1 - n}k`;
}

/** What a rank means above the amateur scale: "Pro", "Top pro", "AI"; null below 10d. */
export function rankTier(r: number): string | null {
  const x = clampRank(r);
  if (x >= AI_RANK - 0.5) return 'AI';
  if (x >= TOP_PRO_RANK - 0.5) return 'Top pro';
  if (x >= PRO_RANK - 0.5) return 'Pro';
  return null;
}

export function clampRank(r: number): number {
  return Math.max(MIN_RANK, Math.min(MAX_RANK, r));
}

/** "2.3k – 1.4d" for a range. */
export function rankRangeLabel(lo: number, hi: number): string {
  const a = rankLabel(lo);
  const b = rankLabel(hi);
  return a === b ? a : `${a} – ${b}`;
}
