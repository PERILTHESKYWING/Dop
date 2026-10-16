import { useEffect, useRef } from 'react';

const KEY_W = 'kami.boardWidth';
const KEY_H = 'kami.boardHeight';
const phone = () => window.matchMedia('(max-width: 899px)').matches;

const read = (k: string) => {
  try {
    const v = Number(localStorage.getItem(k));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
};
const write = (k: string, v: number) => {
  try {
    localStorage.setItem(k, String(v));
  } catch {
    /* blocked */
  }
};

/**
 * The handle between the chat and the board. Drag it (or use the arrow keys on it) to give
 * either side more room. Wide screens: it sets the board column's width. Phones, where the
 * board sits on top: it sets the board's height. Both are remembered in this browser.
 */
export function Splitter() {
  const ref = useRef<HTMLDivElement>(null);

  // Wide: a board width in px. Phone: the board's share of the height (0.25 to 0.75).
  const apply = (split: HTMLElement, value: number, isPhone: boolean) => {
    if (isPhone) {
      const f = Math.min(0.75, Math.max(0.25, value));
      split.style.setProperty('--board-h', `${(f * 100).toFixed(1)}dvh`);
      return f;
    }
    const total = split.clientWidth;
    const w = Math.round(Math.min(total - 340, Math.max(300, value)));
    split.style.setProperty('--board-w', `${w}px`);
    return w;
  };

  useEffect(() => {
    const split = ref.current?.parentElement;
    if (!split) return;
    const restore = () => {
      const p = phone();
      const saved = read(p ? KEY_H : KEY_W);
      if (saved) apply(split, saved, p);
      else {
        split.style.removeProperty('--board-w');
        split.style.removeProperty('--board-h');
      }
    };
    restore();
    window.addEventListener('resize', restore);
    return () => window.removeEventListener('resize', restore);
  }, []);

  const valueAt = (split: HTMLElement, x: number, y: number, p: boolean) => {
    const r = split.getBoundingClientRect();
    return p ? (y - r.top) / window.innerHeight : r.right - x;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const split = ref.current?.parentElement;
    if (!split) return;
    e.preventDefault();
    const p = phone();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    split.classList.add('dragging');
    let last = 0;
    const move = (ev: PointerEvent) => {
      last = apply(split, valueAt(split, ev.clientX, ev.clientY, p), p);
    };
    const up = () => {
      split.classList.remove('dragging');
      if (last) write(p ? KEY_H : KEY_W, last);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const split = ref.current?.parentElement;
    const board = split?.querySelector('.board-panel') as HTMLElement | null;
    if (!split || !board) return;
    const p = phone();
    const step = e.shiftKey ? 80 : 24;
    let v: number | null = null;
    if (p && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) v = (board.offsetHeight + (e.key === 'ArrowDown' ? step : -step)) / window.innerHeight;
    if (!p && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) v = board.offsetWidth + (e.key === 'ArrowLeft' ? step : -step);
    if (v === null) return;
    e.preventDefault();
    write(p ? KEY_H : KEY_W, apply(split, v, p));
  };

  return (
    <div
      ref={ref}
      className="splitter"
      role="separator"
      aria-label="Resize the board and the chat"
      aria-orientation="vertical"
      tabIndex={0}
      title="Drag to resize"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        const split = ref.current?.parentElement;
        if (!split) return;
        split.style.removeProperty('--board-w');
        split.style.removeProperty('--board-h');
        try {
          localStorage.removeItem(phone() ? KEY_H : KEY_W);
        } catch {
          /* blocked */
        }
      }}
    >
      <span />
    </div>
  );
}
