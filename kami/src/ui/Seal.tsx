import type { DayKey, Seal } from '../../../shared/kiaiJourney';
import './journey.css';

/** "12 Oct" (short) or "12 October" (long), from a day key. */
export function dayLabel(day: DayKey, long = false): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString('en-GB', { day: 'numeric', month: long ? 'long' : 'short' });
}

/**
 * A seal (hanko). Earned: a white-text seal (白文印), solid vermilion with the characters left in
 * paper colour. Not yet: an outline only. One character large; two to four set in columns of
 * two, read right to left as carved seals are. No gradient, glow, animation or sound.
 */
export function SealMark({ seal, size = 64 }: { seal: Seal; size?: number }) {
  const chars = [...seal.kanji];
  const days = seal.id === 'sanrensei' || seal.id === 'shicho' ? ' days' : '';
  const label = seal.earned
    ? `${seal.kanji}, ${seal.title}: stamped ${dayLabel(seal.earned, true)}`
    : `${seal.kanji}, ${seal.title}: not yet, ${seal.progress[0]} of ${seal.progress[1]}${days}`;
  return (
    <span
      className={`seal-badge${seal.earned ? ' on' : ''}${chars.length === 1 ? ' one' : ''}`}
      style={{ width: size, height: size, fontSize: chars.length === 1 ? size * 0.53 : size * 0.3 }}
      role="img"
      aria-label={label}
    >
      <span className="seal-glyphs" aria-hidden="true">
        {chars.map((c, i) => (
          <span key={i}>{c}</span>
        ))}
      </span>
    </span>
  );
}
