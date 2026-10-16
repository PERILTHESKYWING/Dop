import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

/** Closes on a press outside `ref` or on Escape while `open`. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', off);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', off);
      document.removeEventListener('keydown', esc);
    };
  }, [ref, open, close]);
}

/**
 * A trigger and a floating menu card. `place` says where the card opens from the trigger:
 * 'up' (above, left edges aligned), 'down-end' (below, right edges aligned).
 */
export function Popover({
  trigger,
  children,
  place = 'up',
  className,
  label,
}: {
  trigger: (p: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  place?: 'up' | 'down-end' | 'up-stretch';
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useDismiss(ref, open, close);
  return (
    <div className={`pop-anchor ${className ?? ''}`} ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className={`pop pop-${place}`} role="menu" aria-label={label}>
          {children(close)}
        </div>
      )}
    </div>
  );
}
