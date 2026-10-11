/**
 * What the last move did for the player who made it: the change in their winrate (and
 * score lead), toned like the move badges (a small loss is normal, 5% or more is a mistake).
 */
export function moveChange(mover: 1 | 2, bWinBefore: number, bWinAfter: number, bLeadBefore: number | null, bLeadAfter: number | null) {
  const sign = mover === 1 ? 1 : -1;
  const win = sign * (bWinAfter - bWinBefore);
  const pts = bLeadBefore != null && bLeadAfter != null ? sign * (bLeadAfter - bLeadBefore) : null;
  const pct = Math.round(win * 1000) / 10;
  const text = `${pct > 0 ? '+' : pct < 0 ? '−' : '±'}${Math.abs(pct).toFixed(1)}%`;
  const points = pts == null ? '' : `${pts > 0 ? '+' : pts < 0 ? '−' : '±'}${Math.abs(pts).toFixed(1)}`;
  const tone = win >= -0.02 ? 'good' : win > -0.05 ? 'meh' : win > -0.12 ? 'bad' : 'awful';
  return { win, text, points, tone };
}
