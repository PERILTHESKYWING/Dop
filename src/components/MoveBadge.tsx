import { CLASS_INFO, type MoveClass } from '../lib/coach/classify';
import './movebadge.css';

/**
 * Move classification badges: a flat coin in the class colour with a white glyph, drawn
 * in a unit circle so the same drawing sits on the board (over the stone) and in text.
 */

const TEXT: Partial<Record<MoveClass, string>> = { brilliant: '!!', great: '!', inaccuracy: '?!', mistake: '?', blunder: '??' };

function star(cx: number, cy: number, r: number, r2: number) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r2 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}
const STAR = star(12, 12.6, 9.2, 3.9);

/** Glyphs drawn in a 24-unit box. */
function Glyph({ cls }: { cls: MoveClass }) {
  const t = TEXT[cls];
  if (t)
    return (
      <text className="mb-text" x={0} y={0.05} fontSize={t.length > 1 ? 1.12 : 1.45} letterSpacing={t.length > 1 ? -0.08 : 0}>
        {t}
      </text>
    );
  const body = (() => {
    switch (cls) {
      case 'best':
        return <path d={STAR} fill="#fff" stroke="#fff" strokeWidth={1.2} strokeLinejoin="round" />;
      case 'excellent':
        return (
          <g fill="#fff">
            <rect x={3.5} y={10.2} width={3.6} height={9.8} rx={1.1} />
            <path d="M8.6 20h7.9c1 0 1.8-.6 2.1-1.6l1.8-6.4c.4-1.3-.6-2.6-2-2.6h-4.1l.7-3.3c.2-1.2-.5-2.3-1.6-2.7l-.6-.2L8.6 9.8z" />
          </g>
        );
      case 'good':
        return <path d="M5.2 12.6l4.4 4.4 9.2-9.6" fill="none" stroke="#fff" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />;
      case 'book':
        return (
          <g fill="#fff">
            <path d="M2.8 6.6c3.1-1.6 6.2-1.4 8.4.5v12.2c-2.3-1.6-5.3-1.8-8.4-.4z" />
            <path d="M21.2 6.6c-3.1-1.6-6.2-1.4-8.4.5v12.2c2.3-1.6 5.3-1.8 8.4-.4z" />
          </g>
        );
      case 'miss':
        return <path d="M7 7l10 10M17 7L7 17" fill="none" stroke="#fff" strokeWidth={3.4} strokeLinecap="round" />;
      default:
        return null;
    }
  })();
  return <g transform="scale(0.074) translate(-12 -12)">{body}</g>;
}

/** The badge drawn around (0, 0) with radius 1: a flat coin in the class colour, white glyph. */
export function BadgeShape({ cls }: { cls: MoveClass }) {
  return (
    <g className={`mb mb-${cls}`}>
      <circle r={1} fill={CLASS_INFO[cls].color} />
      <circle className="mb-rim" r={0.96} fill="none" />
      <Glyph cls={cls} />
    </g>
  );
}

/** A badge in running text or a list. */
export function MoveBadge({ cls, size = 18, title }: { cls: MoveClass; size?: number; title?: string }) {
  const info = CLASS_INFO[cls];
  return (
    <svg className="move-badge" width={size} height={size} viewBox="-1.25 -1.25 2.5 2.5" role="img" aria-label={info.name}>
      <title>{title ?? `${info.name}: ${info.about}`}</title>
      <BadgeShape cls={cls} />
    </svg>
  );
}

/** Badge plus the class name, as a pill. */
export function ClassPill({ cls, title }: { cls: MoveClass; title?: string }) {
  const info = CLASS_INFO[cls];
  return (
    <span className={`class-pill cp-${cls}`} style={{ ['--cp' as string]: info.color }} title={title ?? info.about}>
      <MoveBadge cls={cls} size={16} title={title ?? info.about} />
      {info.name}
    </span>
  );
}
