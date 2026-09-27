/**
 * The coach's training record (public/coach/progress.json), written by the daily cloud
 * run (.github/workflows/coach-training.yml, scripts/coach-progress.ts).
 */
export interface CoachProgressEntry {
  at: string;
  run: number;
  /** Rank-labelled games measured for the level estimate. */
  rankGames: number;
  /** Held-out rank error from one game and from ten (ranks). */
  rankError1: number | null;
  rankError10: number | null;
  /** Positions measured for move difficulty. */
  positions: number;
  /** Held-out gap between predicted and observed find rates (percentage points). */
  calibrationGap: number | null;
}

export interface CoachProgress {
  version: 1;
  entries: CoachProgressEntry[];
}
