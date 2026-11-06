import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { GlossaryEntry } from '../../../src/lib/coach/glossary';
import { termCard } from '../lib/terms';
import { inlineArrow, placeTip, revealBy, revealTarget, snapTop, type Box } from '../lib/tipPlace';

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

/** Marks that end a sentence or a clause, where a card may open in the text. */
const ENDS = '.!?;:';

/**
 * Puts an in-chat card's `host` right under the term: after the end of the term's sentence or
 * clause when that is on the term's line or the next one (designer and pro teacher, 2026-11-06:
 * "at" / "R11." no longer split from their sentence), else at the start of the next line, where
 * the line already wrapped. The lines before stay as they were and the text after moves down
 * whole. A text node may be split there. On the paragraph's last line the host goes after the
 * paragraph (inside a list item, at its end).
 *
 * Returns the undo: the host out and the split text joined again, exactly as React drew it. The
 * caller undoes before every one of its renders commits (a layout effect's cleanup runs in the
 * commit's DOM pass, at the term, before React touches the text after it), so React only ever
 * changes its own DOM.
 */
function placeSlot(host: HTMLElement, el: HTMLElement, stop: Element): () => void {
  const block = blockOf(el, stop);
  host.classList.remove('after');
  const rects = el.getClientRects();
  const last = rects[rects.length - 1] ?? el.getBoundingClientRect();
  const below = last.top + last.height / 2;
  /** The host before `at` in `node`'s text (a split), or after the node at its end. */
  const putAt = (node: Text, at: number): (() => void) => {
    if (at >= (node.nodeValue ?? '').length) {
      node.after(host);
      return () => host.remove();
    }
    const rest = node.splitText(at);
    rest.before(host);
    return () => {
      host.remove();
      if (rest.parentNode && rest.parentNode === node.parentNode) {
        node.nodeValue = (node.nodeValue ?? '') + (rest.nodeValue ?? '');
        rest.remove();
      }
    };
  };
  if (block !== el) {
    const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let nextTop: number | null = null;
    let lineStart: { node: Text; at: number } | null = null;
    let end: { node: Text; at: number } | null = null;
    scan: for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
      if (el.contains(n) || !(el.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      const whole = n.parentElement?.closest(WHOLE);
      const inWhole = !!whole && block.contains(whole);
      const text = n.nodeValue ?? '';
      for (let i = 0; i < text.length; i++) {
        if (/\s/.test(text[i])) continue;
        range.setStart(n, i);
        range.setEnd(n, i + 1);
        const r = range.getBoundingClientRect();
        if (!r.height) continue;
        if (nextTop === null && r.top > below) {
          nextTop = r.top;
          lineStart = { node: n, at: i };
        } else if (nextTop !== null && r.top > nextTop + r.height / 2) break scan; // past the next line
        // a sentence's or clause's end: a mark followed by a space or the end of this text ("0.9" is not one)
        if (!inWhole && ENDS.includes(text[i]) && (i + 1 === text.length || /\s/.test(text[i + 1]))) {
          end = { node: n, at: i + 1 };
          break scan;
        }
      }
    }
    if (end) return putAt(end.node, end.at);
    if (lineStart) {
      const first = lineStart.node;
      const whole = first.parentElement?.closest(WHOLE);
      if (whole && block.contains(whole)) {
        // the next line starts inside a chip or a term: the card goes before it when it starts
        // that line, else after it
        if ((whole.getClientRects()[0]?.top ?? 0) > below) whole.before(host);
        else whole.after(host);
      } else if (lineStart.at === 0) {
        // before the outermost element this text starts (a span, a <strong>), never inside it
        let start: Node = first;
        while (start.parentNode && start.parentNode !== block && start.parentNode.firstChild === start) start = start.parentNode;
        start.parentNode?.insertBefore(host, start);
      } else return putAt(first, lineStart.at);
      return () => host.remove();
    }
  }
  host.classList.add('after');
  if (block.tagName === 'LI') block.appendChild(host);
  else block.after(host);
  return () => host.remove();
}

/** The text's line boxes in a message (what is read: the answer, its sections and chips, not folded parts). */
function messageLines(msg: Element): Box[] {
  const range = document.createRange();
  const out: Box[] = [];
  for (const part of msg.querySelectorAll('.rich, .ans-section, .tags')) {
    range.selectNodeContents(part);
    for (const r of range.getClientRects()) if (r.width && r.height) out.push(r);
  }
  return out;
}

/**
 * A Go term in answer text with a dotted underline: hovering (mouse) or keyboard focus shows
 * its short definition; a tap, click, Enter or Space pins it until the next press elsewhere,
 * Escape or its close button (both hand focus back to the term).
 *
 * One card everywhere: the title, the Chinese and Japanese names on their own line, the
 * definition, a pointer at the term, and × when pinned. Where it goes:
 * - pinned in the chat, and on a phone also when shown by keyboard focus: inside the text, a
 *   block right under the term's line, so the text after it moves down and no answer line or
 *   KataGo's numbers row is covered (critics, 2026-11-05 and 11-06). The chat moves only to show
 *   the card and the line after it, never past the term.
 * - a desktop's hover or focus, and the note under the board: floating as a tooltip just under
 *   the term's line, or over it when under would cover KataGo's numbers or there is no room (a
 *   phone's board note prefers over, so the answer stays clear); never half over a button,
 *   inside the window, and the chat never scrolls.
 * A pinned card is a labelled group, and a keyboard pin moves focus to its ×.
 */
export function Term({ entry, children }: { entry: GlossaryEntry; children: ReactNode }) {
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean; arrow: number } | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  /** Set while focus is handed back to the term, so that focus does not reopen the card. */
  const quiet = useRef(false);
  /** A pin from the keyboard: focus goes to the card's × once it shows. */
  const keyPin = useRef(false);
  const id = useId();
  const ask = useContext(AskContext);
  const open = pinned || hover;
  // decided as the card opens: the span exists from the first render on
  const inChat = open && !!ref.current?.closest('.messages');
  const inline = inChat && (pinned || narrow());

  /** Close a pinned card and give focus back to its term (× and Escape). */
  const close = () => {
    setPinned(false);
    setHover(false);
    quiet.current = true;
    ref.current?.focus({ preventScroll: true });
    quiet.current = false;
  };
  const pin = (fromKey: boolean) => {
    keyPin.current = fromKey && !pinned;
    setPinned((p) => !p);
  };

  // In the chat: one host element while the card is open inline (the card renders into it).
  useLayoutEffect(() => {
    if (!inline) return;
    hostRef.current ??= Object.assign(document.createElement('div'), { className: 'term-slot' });
    setSlot(hostRef.current);
    return () => setSlot(null);
  }, [inline]);

  // ...placed under the term's line after every render and taken out (text joined) before the
  // next one commits, so a message that re-renders while the card is open (streaming, Read
  // longer, redo) never meets a split text node or a foreign element.
  useLayoutEffect(() => {
    const el = ref.current;
    const msg = el?.closest('.msg') ?? el?.closest('.messages');
    if (!slot || !el || !msg) return;
    const undo = placeSlot(slot, el, msg);
    const t = tip.current;
    if (t) {
      const lines = el.getClientRects();
      const line = lines[lines.length - 1] ?? el.getBoundingClientRect();
      const c = t.getBoundingClientRect();
      t.style.setProperty('--arrow', `${inlineArrow(line.left, line.right, c.left, c.width)}px`);
    }
    return undo;
  });

  // ...and once, as it opens: the card and the line after it in view (at most up to the term)
  useLayoutEffect(() => {
    const el = ref.current;
    const t = tip.current;
    const pane = el?.closest('.messages');
    if (!slot || !el || !t || !pane) return;
    const p = pane.getBoundingClientRect();
    const c = t.getBoundingClientRect();
    const msg = el.closest('.msg');
    const toggle = msg?.querySelector('.facts > summary')?.getBoundingClientRect() ?? null;
    const target = revealTarget(c.bottom, msg ? messageLines(msg) : [], p.bottom, toggle && toggle.height ? toggle : null);
    const termTop = el.getClientRects()[0]?.top ?? el.getBoundingClientRect().top;
    // ...with the pane's top edge between rows, never through the header, a chip or a line
    const rows: Box[] = [...pane.querySelectorAll('.msg.user, .msg.kami > .who, .read-row, .msg-tools, .tags, .facts > summary, .rich .pt, .rich .chip')].map((x) => x.getBoundingClientRect() as Box);
    for (const m of pane.querySelectorAll('.msg.kami')) rows.push(...messageLines(m));
    const by = snapTop(revealBy(target, p.bottom, termTop, p.top, 4), p.top, rows.filter((r) => r.bottom > r.top), Math.floor(termTop - p.top));
    if (by) pane.scrollTop += by;
  }, [slot]);

  // Floating (a desktop's hover or focus, or the board's note).
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
      // KataGo's numbers stay readable and the chat's buttons ("Read longer") stay clear: the
      // card takes the side of the line that covers less of them (a button counts double)
      const keep = [
        ...[...document.querySelectorAll<HTMLElement>('.messages .facts')].map((b) => b.getBoundingClientRect()),
        ...[...document.querySelectorAll<HTMLElement>('.messages button:not(.pt):not(.chip):not(.tag)')].filter((b) => !t.contains(b)).map((b) => Object.assign(b.getBoundingClientRect().toJSON() as Box, { weight: 2 })),
      ].filter((b) => b.right > b.left && b.bottom > b.top);
      const { left, top, below } = placeTip(line, w, h, window.innerWidth, window.innerHeight, avoid, prefer, keep);
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

  // A keyboard pin hands focus to the card's × once the card is shown (Tab could not reach it
  // first: the rest of the term's line comes before the card, and a floating card sits in <body>).
  useEffect(() => {
    if (!pinned || !keyPin.current) return;
    const x = tip.current?.querySelector<HTMLElement>('.term-close');
    if (x && (inline ? slot : pos)) {
      keyPin.current = false;
      x.focus({ preventScroll: true });
    }
  }, [pinned, inline, slot, pos]);

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
  const titleId = `${id}-t`;
  const body = (
    <div
      ref={tip}
      id={id}
      // a pinned card (with its ×) is a labelled group; a hover or focus card is a tooltip, no controls
      role={pinned ? 'group' : 'tooltip'}
      aria-labelledby={pinned ? titleId : undefined}
      className={`term-tip${inline ? ' inline' : ''}${pinned ? ' pinned' : ''}${!inline && pos && !pos.below ? ' above' : ''}`}
      style={inline ? undefined : pos ? ({ left: pos.left, top: pos.top, '--arrow': `${pos.arrow}px` } as React.CSSProperties) : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {pinned && (
        // a pinned card says how it closes: this button, a press anywhere else, or Escape
        <button type="button" className="term-close" aria-label={`Close ${card.title}`} title="Close (or press anywhere else, or Escape)" onClick={close}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}
      <div className="term-tip-title" id={titleId}>
        {card.title}
      </div>
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
        aria-controls={pinned ? id : undefined}
        aria-describedby={open && !pinned ? id : undefined}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
        onFocus={(e) => !quiet.current && e.currentTarget.matches(':focus-visible') && setHover(true)}
        onBlur={() => setHover(false)}
        onClick={(e) => {
          e.stopPropagation();
          pin(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pin(true);
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
