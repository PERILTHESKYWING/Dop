import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { GlossaryEntry } from '../../../src/lib/coach/glossary';
import { termCard } from '../lib/terms';
import { inlineArrow, placeTip, revealBy } from '../lib/tipPlace';

/** Asks Kami a question ("What is miai?"); the chat provides it so a pinned card can link to the library. */
export const AskContext = createContext<((text: string) => void) | null>(null);

/** The phone layout (styles.css uses the same width). */
const NARROW = '(max-width: 899px)';
const narrow = () => typeof window !== 'undefined' && !!window.matchMedia?.(NARROW).matches;

/**
 * The block a term's in-chat card goes in: the paragraph, list item or heading the term sits in
 * (its nearest ancestor that is not laid out inline), never the message itself.
 */
function blockOf(el: HTMLElement, stop: Element): HTMLElement {
  let b = el.parentElement;
  while (b && b !== stop && b.parentElement !== stop && getComputedStyle(b).display.startsWith('inline')) b = b.parentElement;
  return b && b !== stop ? b : el;
}

/** Elements a card must never open inside (a tap on the card would act on them). */
const WHOLE = '.term, .pt, button, a, .chip, .tag';

/**
 * A host for a phone's in-chat card, right under the term's line: at the start of the next line
 * of its paragraph. The line breaks where it already wrapped, so the lines before stay as they
 * were and the lines after move down whole. A text node is split there and joined again by
 * `undo`. On the paragraph's last line the host goes after the paragraph (inside a list item, at
 * its end).
 */
function openSlot(el: HTMLElement, stop: Element): { host: HTMLElement; undo: () => void } {
  const block = blockOf(el, stop);
  const host = document.createElement('div');
  host.className = 'term-slot';
  const rects = el.getClientRects();
  const last = rects[rects.length - 1] ?? el.getBoundingClientRect();
  const below = last.top + last.height / 2;
  let undo = () => host.remove();
  if (block !== el) {
    const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
      if (el.contains(n) || !(el.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      const text = n.nodeValue ?? '';
      let at = -1;
      for (let i = 0; i < text.length; i++) {
        if (/\s/.test(text[i])) continue;
        range.setStart(n, i);
        range.setEnd(n, i + 1);
        const r = range.getBoundingClientRect();
        if (r.height && r.top > below) {
          at = i;
          break;
        }
      }
      if (at < 0) continue;
      const first = n;
      const whole = first.parentElement?.closest(WHOLE);
      if (whole && block.contains(whole)) {
        // the next line starts inside a chip or a term: the card goes before it when it starts
        // that line, else after it
        if ((whole.getClientRects()[0]?.top ?? 0) > below) whole.before(host);
        else whole.after(host);
      } else if (at === 0) {
        // before the outermost element this text starts (a span, a <strong>), never inside it
        let start: Node = first;
        while (start.parentNode && start.parentNode !== block && start.parentNode.firstChild === start) start = start.parentNode;
        start.parentNode?.insertBefore(host, start);
      } else {
        const rest = first.splitText(at);
        rest.before(host);
        undo = () => {
          host.remove();
          if (rest.parentNode && rest.parentNode === first.parentNode) {
            first.nodeValue = (first.nodeValue ?? '') + (rest.nodeValue ?? '');
            rest.remove();
          }
        };
      }
      return { host, undo };
    }
  }
  host.classList.add('after');
  if (block.tagName === 'LI') block.appendChild(host);
  else block.after(host);
  return { host, undo };
}

/**
 * A Go term in answer text with a dotted underline: hovering (mouse) or keyboard focus shows
 * its short definition; a tap or click pins it until the next tap elsewhere, Escape or its close
 * button (both hand focus back to the term).
 *
 * One card everywhere: the title, the Chinese and Japanese names on their own line, the
 * definition, a pointer at the term, and × when pinned. Where it goes:
 * - in the chat on a phone, inside the text: a block right under the term's line, so the text
 *   after it moves down and no answer line is covered (critics, 2026-11-05: a floating card
 *   covered 2-4 lines). The chat does not scroll, unless the card would end out of view.
 * - elsewhere (a desktop, the note under the board): floating just under the term's line (over
 *   it when there is no room; a phone's board note prefers over, so the answer stays clear),
 *   never half over a button, inside the window, and the chat never scrolls.
 */
export function Term({ entry, children }: { entry: GlossaryEntry; children: ReactNode }) {
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean; arrow: number } | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [arrow, setArrow] = useState<number | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  /** Set while focus is handed back to the term, so that focus does not reopen the card. */
  const quiet = useRef(false);
  const id = useId();
  const ask = useContext(AskContext);
  const open = pinned || hover;
  // decided as the card opens: the span exists from the first render on
  const inline = open && !!ref.current?.closest('.messages') && narrow();

  /** Close a pinned card and give focus back to its term (× and Escape). */
  const close = () => {
    setPinned(false);
    setHover(false);
    quiet.current = true;
    ref.current?.focus({ preventScroll: true });
    quiet.current = false;
  };

  // In the chat on a phone: a host at the start of the line under the term (openSlot), made
  // before the first paint so the card never shows anywhere else first.
  useLayoutEffect(() => {
    const el = ref.current;
    const msg = el?.closest('.msg') ?? el?.closest('.messages');
    if (!inline || !el || !msg) return;
    const { host, undo } = openSlot(el, msg);
    setSlot(host);
    return () => {
      undo();
      setSlot(null);
      setArrow(null);
    };
  }, [inline]);

  // ...its pointer under the term, and the card in view (the chat moves only if the card would
  // end below the pane's visible bottom)
  useLayoutEffect(() => {
    const el = ref.current;
    const t = tip.current;
    if (!slot || !el || !t) return;
    const lines = [...el.getClientRects()];
    const line = lines[lines.length - 1] ?? el.getBoundingClientRect();
    const c = t.getBoundingClientRect();
    setArrow(inlineArrow(line.left, line.right, c.left, c.width));
    const pane = el.closest('.messages');
    if (pane) {
      const p = pane.getBoundingClientRect();
      const by = revealBy(c.bottom, p.bottom, lines[0]?.top ?? line.top, p.top);
      if (by) pane.scrollTop += by;
    }
  }, [slot]);

  // Floating (a desktop, or the board's note).
  useLayoutEffect(() => {
    if (!open || inline) {
      setPos(null);
      return;
    }
    const prefer = narrow() && ref.current?.closest('.board-panel') ? 'above' : 'below';
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
      const { left, top, below } = placeTip(line, w, h, window.innerWidth, window.innerHeight, avoid, prefer);
      // the pointer under (or over) the term's middle, kept inside the card's rounded corners
      const arrow = inlineArrow(line.left, line.right, left, w);
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
  }, [open, pinned, inline]);

  // A pinned card closes on a press anywhere else, or on Escape (which hands focus back).
  useEffect(() => {
    if (!pinned) return;
    const off = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!ref.current?.contains(n) && !tip.current?.contains(n)) setPinned(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', off);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', off);
      document.removeEventListener('keydown', esc);
    };
  }, [pinned]);

  const card = termCard(entry);
  const more = pinned && ask && entry.concept;
  const names = card.names;
  const body = (
    <div
      ref={tip}
      id={id}
      role={more ? 'dialog' : 'tooltip'}
      aria-label={more ? card.title : undefined}
      className={`term-tip${inline ? ' inline' : ''}${pinned ? ' pinned' : ''}${!inline && pos && !pos.below ? ' above' : ''}`}
      style={
        inline
          ? ({ '--arrow': arrow === null ? undefined : `${arrow}px` } as React.CSSProperties)
          : pos
            ? ({ left: pos.left, top: pos.top, '--arrow': `${pos.arrow}px` } as React.CSSProperties)
            : { left: 0, top: 0, visibility: 'hidden' }
      }
    >
      {pinned && (
        // a pinned card says how it closes: this button, a tap anywhere else, or Escape
        <button type="button" className="term-close" aria-label="Close" title="Close (or tap anywhere else)" onClick={close}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}
      <div className="term-tip-title">{card.title}</div>
      {names && (
        // the same term as Chinese and Japanese players write it, on its own line, each named
        <div className="term-tip-names">
          {names.zh === names.ja ? (
            <>
              <span lang="zh-Hans">{names.zh}</span> <span className="term-tip-lang">in Chinese and Japanese</span>
            </>
          ) : (
            <>
              <span className="term-tip-lang">Chinese</span> <span lang="zh-Hans">{names.zh}</span>
              <span className="term-tip-sep" aria-hidden="true">
                {' · '}
              </span>
              <span className="term-tip-lang">Japanese</span> <span lang="ja">{names.ja}</span>
            </>
          )}
        </div>
      )}
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
    </div>
  );
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
        onFocus={(e) => !quiet.current && e.currentTarget.matches(':focus-visible') && setHover(true)}
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
      {open && (inline ? slot && createPortal(body, slot) : createPortal(body, document.body))}
    </>
  );
}
