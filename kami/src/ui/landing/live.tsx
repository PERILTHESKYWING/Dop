/**
 * The landing's moving parts: a 3D board that lives while it is on screen (LiveBoard), and a
 * way to run a scripted scene on it that stops cleanly when it scrolls away (useScene).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { KayaView, type KayaOptions, type ViewMode } from '../../three/kaya';
import '../../three/kaya3d.css';

export class Stopped extends Error {}

/** Wait, unless the scene was stopped. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Stopped());
    const t = window.setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(t);
        reject(new Stopped());
      },
      { once: true },
    );
  });
}

export const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * Run `scene` over and over while `on` is true; it is stopped (its sleeps throw) as soon as `on`
 * turns false, a dependency changes, or the component goes away.
 */
export function useScene(on: boolean, scene: ((signal: AbortSignal) => Promise<void>) | null, deps: unknown[]) {
  useEffect(() => {
    if (!on || !scene) return;
    const ctl = new AbortController();
    (async () => {
      try {
        while (!ctl.signal.aborted) await scene(ctl.signal);
      } catch (e) {
        if (!(e instanceof Stopped)) throw e;
      }
    })();
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, ...deps]);
}

export interface Label {
  key: string;
  loc: number;
  lift?: number;
  cls: string;
  text?: string;
  sub?: string;
  style?: React.CSSProperties;
}

/** The highest a bubble's top may stand in the board's layer: clear of the 72 px bar, with room. */
const SAY_TOP = 96;

interface Props {
  options: Omit<KayaOptions, 'canvas' | 'size'>;
  /** The camera for a canvas of this size. */
  fit: (w: number, h: number) => ViewMode;
  labels?: Label[];
  onView?: (v: KayaView | null) => void;
  onVisible?: (on: boolean) => void;
  /** After every frame the board draws (things that follow the board, like a leader line). */
  onFrame?: (v: KayaView) => void;
  className?: string;
  children?: ReactNode;
}

export function LiveBoard({ options, fit, labels = [], onView, onVisible, onFrame, className, children }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<KayaView | null>(null);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const frameRef = useRef(onFrame);
  frameRef.current = onFrame;
  const labelRef = useRef(labels);
  labelRef.current = labels;

  useEffect(() => {
    const c = canvas.current!;
    let v: KayaView;
    try {
      v = new KayaView({ canvas: c, size: 19, ...options });
    } catch {
      onView?.(null);
      return;
    }
    const size = () => {
      const w = c.clientWidth, h = c.clientHeight;
      v.setSize(w, h);
      v.setView(fitRef.current(w, h));
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(c);
    const io = new IntersectionObserver(([e]) => {
      v.setActive(e.isIntersecting);
      onVisible?.(e.isIntersecting);
    });
    io.observe(c);
    v.onFrame = () => {
      place(v);
      frameRef.current?.(v);
    };
    setView(v);
    onView?.(v);
    return () => {
      ro.disconnect();
      io.disconnect();
      onView?.(null);
      v.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // labels follow their points every frame the board draws
  const place = (v: KayaView) => {
    const el = layer.current;
    if (!el) return;
    const kids = el.children;
    const ls = labelRef.current;
    const a = v.project(0, 0), b = v.project(18, 0);
    const cell = Math.hypot(b.x - a.x, b.y - a.y) / 18;
    // a tag that would sit on an earlier one (they come best first) steps aside
    const kept: { x: number; y: number }[] = [];
    const gapX = Math.max(46, cell * 1.6), gapY = Math.max(30, cell * 1.1);
    for (let i = 0; i < kids.length && i < ls.length; i++) {
      const L = ls[i];
      const p = v.project(L.loc, L.lift ?? 0);
      const k = kids[i] as HTMLElement;
      // a bubble standing over its point never runs up under the page's bar
      let y = p.y;
      if (L.cls.includes('k3-say')) {
        const h = (k.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0;
        y = Math.max(y, SAY_TOP + h - 10);
      }
      k.style.transform = `translate(${p.x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      if (/\b(tag|k3-swing)\b/.test(L.cls)) {
        const hit = kept.some((q) => Math.abs(q.x - p.x) < gapX && Math.abs(q.y - p.y) < gapY);
        k.classList.toggle('k3-hide', hit);
        if (!hit) kept.push(p);
      }
    }
    el.style.setProperty('--cell', `${cell.toFixed(2)}px`);
  };
  useEffect(() => {
    if (view) {
      place(view);
      view.invalidate();
    }
  }, [labels, view]);

  return (
    <div className={`lb ${className ?? ''}`}>
      <canvas ref={canvas} className="lb-canvas" />
      <div ref={layer} className="k3-layer lb-layer" aria-hidden="true">
        {labels.map((L) => (
          <span key={L.key} className={`k3-l ${L.cls}`} style={L.style}>
            {L.text !== undefined && <b>{L.text}</b>}
            {L.sub && <i>{L.sub}</i>}
          </span>
        ))}
      </div>
      {children}
    </div>
  );
}

/** A number that eases to its new value. */
export function useTween(target: number, ms = 600): number {
  const [v, setV] = useState(target);
  const from = useRef(target);
  const cur = useRef(target);
  useEffect(() => {
    from.current = cur.current;
    if (reducedMotion()) {
      cur.current = target;
      setV(target);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const k = 1 - Math.pow(1 - t, 3);
      cur.current = from.current + (target - from.current) * k;
      setV(cur.current);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** True once the element has come into view (and stays true). */
export function useSeen<T extends Element>(margin = '0px 0px -15% 0px') {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, margin]);
  return [ref, seen] as const;
}
