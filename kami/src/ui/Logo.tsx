/**
 * Kiai's mark: the vermilion 気 seal (ui/brand/seal.ts). It never animates; when Kiai is
 * working, the reply says so in words.
 */
import { useId, useMemo } from 'react';
import { brushMarkup } from './brand/brush';
import { sealMarkup } from './brand/seal';

export function Logo({ size = 22, className }: { size?: number; className?: string }) {
  const id = `s${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const html = useMemo(() => sealMarkup({ id, size }), [id, size]);
  return <span className={['logo', className].filter(Boolean).join(' ')} style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * 気合 in brush ink. `write` writes it stroke by stroke once (about two seconds), otherwise it
 * is drawn finished. `layout` 'h' sets the two characters side by side, 'v' (default) stacked.
 */
export function Calligraphy({ height, layout = 'v', write = false, className }: { height: number; layout?: 'v' | 'h'; write?: boolean; className?: string }) {
  const id = `k${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const html = useMemo(() => brushMarkup({ id, layout, write, texture: height >= 80 }), [id, layout, write, height]);
  return <span className={['brush', className].filter(Boolean).join(' ')} style={{ '--brush-h': `${height}px` } as React.CSSProperties} role="img" aria-label="気合 (Kiai)" dangerouslySetInnerHTML={{ __html: html }} />;
}
