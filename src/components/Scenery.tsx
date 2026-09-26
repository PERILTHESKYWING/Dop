import { useMemo, type CSSProperties } from 'react';
import type { ThemeId } from '../lib/themes';

/** The painted sunrise behind everything, with slow light rays, drifting clouds and floating motes. */
function SunriseScene() {
  const motes = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => {
        const r = (k: number) => {
          const x = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453;
          return x - Math.floor(x);
        };
        return {
          '--x': `${(r(1) * 100).toFixed(1)}%`,
          '--s': `${(3 + r(2) * 6).toFixed(1)}px`,
          '--d': `${(16 + r(3) * 18).toFixed(1)}s`,
          '--delay': `${(-r(4) * 30).toFixed(1)}s`,
          '--dx': `${((r(5) - 0.5) * 120).toFixed(0)}px`,
        } as CSSProperties;
      }),
    [],
  );
  return (
    <div className="scenery" aria-hidden>
      <div className="scenery-art">
        <div className="scenery-img" />
        <div className="scenery-glow" />
        <div className="scenery-rays" />
        <div className="scenery-rays two" />
        <div className="scenery-clouds" />
      </div>
      {motes.map((style, i) => (
        <span key={i} className="mote" style={style} />
      ))}
      <div className="scenery-veil" />
    </div>
  );
}

/** The animated background of the chosen theme (lib/themes.ts). */
export function Scenery({ theme }: { theme: ThemeId }) {
  switch (theme) {
    default:
      return <SunriseScene />;
  }
}
