/**
 * Go ranks on one number line: 1 kyu is 0, 18 kyu is -17, 1 dan is 1, 9 dan is 9.
 * Kyu and dan meet without a gap, as on Fox, where 1k → 1d is one step.
 */

export const MIN_RANK = -17; // 18k
export const MAX_RANK = 9; // 9d (Fox amateur)

/** Parse "3k", "3 kyu", "3級", "3级", "5d", "5段", "5 dan", "P9", "9p", "职业". Null if unknown. */
export function parseRank(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s || s === '-' || s === '?') return null;
  if (/^(p\d|\d+p|pro|职业|職業)/.test(s)) return MAX_RANK + 1;
  const m = s.match(/(\d+)\s*(k|kyu|级|級|d|dan|段)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const kyu = /k|kyu|级|級/.test(m[2]);
  if (kyu) return n > 30 ? null : 1 - n;
  return n > 9 ? null : n;
}

/** 0.4 → "1k", 2.6 → "3d", -4.2 → "5k". */
export function rankLabel(r: number): string {
  const n = Math.round(r);
  if (n > MAX_RANK) return 'pro';
  if (n >= 1) return `${n}d`;
  return `${1 - n}k`;
}

export function clampRank(r: number): number {
  return Math.max(MIN_RANK, Math.min(MAX_RANK, r));
}

/** "2k – 1d" for a range. */
export function rankRangeLabel(lo: number, hi: number): string {
  const a = rankLabel(clampRank(lo));
  const b = rankLabel(clampRank(hi));
  return a === b ? a : `${a} – ${b}`;
}
