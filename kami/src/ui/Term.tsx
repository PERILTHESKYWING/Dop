import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { GlossaryEntry } from '../../../src/lib/coach/glossary';
import { termCard } from '../lib/terms';
import { placeTip } from '../lib/tipPlace';

/** Asks Kami a question ("What is miai?"); the chat provides it so a pinned card can link to the library. */
export const AskContext = createContext<((text: string) => void) | null>(null);

/**
 * A Go term in answer text with a dotted underline: hovering (mouse) or keyboard focus shows
 * its short definition; a tap or click pins it until the next tap elsewhere, Escape or its close
 * button. The card sits just under the term's line (over it when there is no room), points at the
 * term, never half covers a button, stays inside the window, and never scrolls the chat.
 */
export function Term({ entry, children }: { entry: GlossaryEntry; children: ReactNode }) {
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean; arrow: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const id = useId();
  const ask = useContext(AskContext);
  const open = pinned || hover;

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = ref.current?.getBoundingClientRect();
      const t = tip.current;
      if (!r || !t) return;
      const w = t.offsetWidth;
      const h = t.offsetHeight;
      // the term's own line (a wrapped term: the line tapped or the first)
      const lines = [...(ref.current?.getClientRects() ?? [])];
      const line = lines[0] ?? r;
      const avoid = [...document.querySelectorAll<HTMLElement>('button:not(.pt):not(.chip):not(.tag), textarea, summary')].filter((b) => !t.contains(b)).map((b) => b.getBoundingClientRect()).filter((b) => b.width && b.height);
      const { left, top, below } = placeTip(line, w, h, window.innerWidth, window.innerHeight, avoid);
      // the pointer under (or over) the term's middle, kept inside the card's rounded corners
      const arrow = Math.round(Math.max(14, Math.min(w - 14, (line.left + line.right) / 2 - left)));
      setPos((p) => (p && p.left === left && p.top === top && p.below === below && p.arrow === arrow ? p : { left, top, below, arrow }));
    };
    place();
    // at most one placement per frame while scrolling (it measures the page's buttons)
    let raf = 0;
    const onMove = () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), place()));
    };
    window.addEventListener('scroll', onMove, { capture: true, passive: true });
    window.addEventListener('resize', onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, pinned]);

  // A pinned card closes on a press anywhere else, or on Escape.
  useEffect(() => {
    if (!pinned) return;
    const off = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!ref.current?.contains(n) && !tip.current?.contains(n)) setPinned(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPinned(false);
    document.addEventListener('pointerdown', off);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', off);
      document.removeEventListener('keydown', esc);
    };
  }, [pinned]);

  const card = termCard(entry);
  const more = pinned && ask && entry.concept;
  return (
    <>
      <span
        ref={ref}
        className={`term${open ? ' on' : ''}`}
        role="button"
        tabIndex={0}
        aria-expanded={pinned}
        aria-describedby={open ? id : undefined}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
        onFocus={(e) => e.currentTarget.matches(':focus-visible') && setHover(true)}
        onBlur={() => setHover(false)}
        onClick={(e) => {
          e.stopPropagation();
          setPinned((p) => !p);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setPinned((p) => !p);
          } else if (e.key === 'Escape') {
            setPinned(false);
            setHover(false);
          }
        }}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={tip}
            id={id}
            role={more ? 'dialog' : 'tooltip'}
            aria-label={more ? card.title : undefined}
            className={`term-tip${pinned ? ' pinned' : ''}${pos && !pos.below ? ' above' : ''}`}
            style={pos ? ({ left: pos.left, top: pos.top, '--arrow': `${pos.arrow}px` } as React.CSSProperties) : { left: 0, top: 0, visibility: 'hidden' }}
          >
            {pinned && (
              // a pinned card says how it closes: this button, a tap anywhere else, or Escape
              <button type="button" className="term-close" aria-label="Close" title="Close (or tap anywhere else)" onClick={() => setPinned(false)}>
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            )}
            <div className="term-tip-title">
              {card.title}
              {card.names && (
                // the same term in Chinese and Japanese (once when both write it alike)
                <span className="term-tip-names">
                  {card.names.zh === card.names.ja ? (
                    <span lang="zh-Hans" title="Chinese and Japanese">
                      {card.names.zh}
                    </span>
                  ) : (
                    <>
                      <span lang="zh-Hans" title="Chinese">
                        {card.names.zh}
                      </span>
                      {' · '}
                      <span lang="ja" title="Japanese">
                        {card.names.ja}
                      </span>
                    </>
                  )}
                </span>
              )}
            </div>
            <div className="term-tip-text">{card.text}</div>
            {more && (
              <button
                type="button"
                className="term-more"
                onClick={() => {
                  setPinned(false);
                  ask(`What is ${entry.term}?`);
                }}
              >
                More about {entry.term}
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
