import { searchedValue } from '../analysis/analyzer';
import type { TrainingItem } from '../types';

/**
 * Practice positions must still be a real game: the side that is behind keeps at least
 * this winrate. Lopsided positions teach little (almost any move "wins") and grading in
 * them is noisy, so Forge, blind tests and variations leave them out.
 */
export const DEFAULT_MIN_LOSING_WINRATE = 0.3;

/** Is the side that is behind still at `min` or better? `win` can be either side's winrate. */
export function isBalanced(win: number | undefined, min = DEFAULT_MIN_LOSING_WINRATE): boolean {
  return typeof win === 'number' && Number.isFinite(win) && Math.min(win, 1 - win) >= min - 1e-9;
}

/** Items whose position passes the floor, judged by KataGo's searched value where there is one. */
export const balancedItems = (items: TrainingItem[], min = DEFAULT_MIN_LOSING_WINRATE) => items.filter((it) => isBalanced(searchedValue(it.eval).bWin, min));
