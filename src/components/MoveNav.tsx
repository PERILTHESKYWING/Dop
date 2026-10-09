import { useEffect, useRef, useState } from 'react';

/** Moving through a game with the mouse wheel over the board (down = next move). The step
 * buttons themselves are BoardScreen's plain Stepper. */

/**
 * Scroll over an element to step through moves: one step per wheel notch, trackpads
 * accumulate. Returns the ref to put on that element.
 */
export function useWheelSteps(onStep: (delta: number) => void, enabled = true) {
  const step = useRef(onStep);
  step.current = onStep;
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!el || !enabled) return;
    let acc = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // pinch zoom, sideways swipes
      e.preventDefault();
      // Lines (Firefox) count as a notch each; pixels add up until they make one.
      acc += e.deltaMode === 1 ? Math.sign(e.deltaY) * 60 : e.deltaMode === 2 ? Math.sign(e.deltaY) * 60 : e.deltaY;
      clearTimeout(idle);
      idle = setTimeout(() => (acc = 0), 220);
      while (Math.abs(acc) >= 50) {
        const d = Math.sign(acc);
        step.current(d);
        acc -= d * 60;
        if (Math.sign(acc) !== d) acc = 0;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      clearTimeout(idle);
    };
  }, [el, enabled]);
  return setEl;
}
