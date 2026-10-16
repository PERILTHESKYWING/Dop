import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { GlossaryEntry } from '../../../src/lib/coach/glossary';
import { termCard } from '../lib/terms';

/** Asks Kami a question ("What is miai?"); the chat provides it so a pinned card can link to the library. */
export const AskContext = createContext<((text: string) => void) | null>(null);

/**
 * A Go term in answer text with a dotted underline: hovering (mouse) or keyboard focus shows
 * its short definition; a tap or click pins it until the next tap elsewhere or Escape. The card
 * sits under the term (over it when there is no room) and stays inside the window.
 */
export function Term({ entry, children }: { entry: GlossaryEntry; children: ReactNode }) {
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
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
      const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
      const top = r.bottom + 6 + h <= window.innerHeight - 8 ? r.bottom + 6 : Math.max(8, r.top - 6 - h);
      setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
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
            className={`term-tip${pinned ? ' pinned' : ''}`}
            style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
          >
            <div className="term-tip-title">{card.title}</div>
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
