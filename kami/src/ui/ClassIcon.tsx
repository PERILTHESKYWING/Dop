import type { MoveClass } from '../../../src/lib/coach/classify';

/**
 * Move-class icons as chess.com's game review draws them: a round coin in the class colour
 * with a darker rim along its lower edge, and a bold white sign.
 */
export const CLASS_LOOK: Record<MoveClass, { name: string; color: string; rim: string }> = {
  brilliant: { name: 'Brilliant', color: '#26c2a3', rim: '#1a9a80' },
  great: { name: 'Great', color: '#749bbf', rim: '#56799b' },
  best: { name: 'Best', color: '#81b64c', rim: '#5f8f33' },
  excellent: { name: 'Excellent', color: '#96bc4b', rim: '#719437' },
  good: { name: 'Good', color: '#95b776', rim: '#728f57' },
  book: { name: 'Book', color: '#a88865', rim: '#82674a' },
  inaccuracy: { name: 'Inaccuracy', color: '#f7c631', rim: '#c99a12' },
  mistake: { name: 'Mistake', color: '#ffa459', rim: '#d97f35' },
  miss: { name: 'Miss', color: '#ff7769', rim: '#d4544a' },
  blunder: { name: 'Blunder', color: '#fa412d', rim: '#c42b1c' },
};

const TEXT: Partial<Record<MoveClass, string>> = { brilliant: '!!', great: '!', inaccuracy: '?!', mistake: '?', blunder: '??' };

function star() {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 2.35 : 5.3;
    pts.push(`${(10 + r * Math.cos(a)).toFixed(2)},${(9.7 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}
const STAR = star();

function Sign({ cls }: { cls: MoveClass }) {
  const t = TEXT[cls];
  if (t)
    return (
      <text
        x={10}
        y={9.8}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={t.length > 1 ? 9.6 : 12}
        fontWeight={800}
        letterSpacing={t.length > 1 ? -0.9 : 0}
        fill="#fff"
        fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
      >
        {t}
      </text>
    );
  switch (cls) {
    case 'best':
      return <path d={STAR} fill="#fff" stroke="#fff" strokeWidth={0.9} strokeLinejoin="round" />;
    case 'excellent':
      return (
        <g fill="#fff">
          <rect x={4.6} y={9} width={2.4} height={6.2} rx={0.7} />
          <path d="M7.8 15.2h5.1c.7 0 1.2-.4 1.4-1.1l1.1-4c.3-.9-.4-1.7-1.3-1.7h-2.6l.4-2.1c.1-.8-.3-1.5-1-1.7l-.4-.1L7.8 8.8z" />
        </g>
      );
    case 'good':
      return <path d="M5.6 10.4l3 3 5.8-6.2" fill="none" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />;
    case 'book':
      return (
        <g fill="#fff">
          <path d="M4.2 6.8c2-1 4-.9 5.4.3v7.8c-1.5-1-3.4-1.1-5.4-.3z" />
          <path d="M15.8 6.8c-2-1-4-.9-5.4.3v7.8c1.5-1 3.4-1.1 5.4-.3z" />
        </g>
      );
    case 'miss':
      return <path d="M6.8 7.1l6.4 6.4M13.2 7.1l-6.4 6.4" fill="none" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" />;
    default:
      return null;
  }
}

export function ClassIcon({ cls, size = 20, title }: { cls: MoveClass; size?: number; title?: string }) {
  const look = CLASS_LOOK[cls];
  return (
    <svg className="class-icon" width={size} height={size} viewBox="0 0 20 20" role="img" aria-label={title ?? look.name}>
      {title !== undefined && <title>{title}</title>}
      <circle cx={10} cy={10.6} r={9.2} fill={look.rim} />
      <circle cx={10} cy={9.6} r={9.2} fill={look.color} />
      <Sign cls={cls} />
    </svg>
  );
}
