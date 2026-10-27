import type { DayKey, Seal } from '../../../shared/kiaiJourney';
import './journey.css';

/** "12 Oct" (short) or "12 October" (long), from a day key. */
export function dayLabel(day: DayKey, long = false): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString('en-GB', { day: 'numeric', month: long ? 'long' : 'short' });
}

/**
 * A seal (hanko). Earned: a white-text seal (白文印), solid vermilion with the characters left in
 * paper colour. Not yet: an outline only. One character large; two to four in ONE column, top to
 * bottom, on an upright seal: a square of columns read right to left (as carved seals are) reads
 * as a scrambled word to anyone reading across (三連星 came out as 星三連), and one column
 * reads the same way for every reader. No gradient, glow, animation or sound.
 */
export function SealMark({ seal, size = 72 }: { seal: Seal; size?: number }) {
  const chars = [...seal.kanji];
  const n = chars.length;
  const days = seal.id === 'sanrensei' || seal.id === 'shicho' ? ' days' : '';
  const label = seal.earned
    ? `${seal.kanji}, ${seal.title}: stamped ${dayLabel(seal.earned, true)}`
    : `${seal.kanji}, ${seal.title}: not yet, ${seal.progress[0]} of ${seal.progress[1]}${days}`;
  // Every seal is the same height on one baseline, so a row of them reads as one line: one
  // character is a square seal; more are an upright one, a column of characters that share it.
  const h = size;
  const w = n === 1 ? size : size * 0.6;
  const font = n === 1 ? size * 0.53 : (h * 0.8) / Math.max(2.6, n);
  return (
    <span className="seal-slot" style={{ height: h }}>
      <span className={`seal-badge${seal.earned ? ' on' : ''}${n === 1 ? ' one' : ''}`} style={{ width: w, height: h, fontSize: font }} role="img" aria-label={label}>
        <span className="seal-glyphs" aria-hidden="true">
          {chars.map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </span>
      </span>
    </span>
  );
}
