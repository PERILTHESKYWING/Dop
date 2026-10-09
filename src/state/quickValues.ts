import { useEffect, useState } from 'react';
import { evaluateFast, type PositionSpec } from '../lib/analysis/analyzer';
import type { PosValue } from '../lib/analysis/lineStats';
import { getEngine, startEngine } from './actions';

/**
 * A quick read of every position along a line (one network evaluation each), so the Trend,
 * Blunder and Performance tabs have something to show for a whole kifu without stepping
 * through it. Results are kept for the session by position key; the live search's deeper
 * values replace them wherever you stop and look.
 */

const cache = new Map<string, PosValue>();

export interface QuickItem {
  key: string;
  spec: () => PositionSpec;
}

export function useQuickValues(items: QuickItem[] | null) {
  const [, setTick] = useState(0);
  const [running, setRunning] = useState(false);
  const sig = items ? items.map((i) => i.key).join('\n') : '';
  useEffect(() => {
    if (!items) return;
    const todo = items.filter((i) => !cache.has(i.key));
    if (!todo.length) return;
    let alive = true;
    setRunning(true);
    (async () => {
      const eng = getEngine() ?? (await startEngine());
      if (!eng) return;
      let n = 0;
      for (const it of todo) {
        if (!alive) return;
        if (cache.has(it.key)) continue;
        try {
          const e = await evaluateFast(eng, it.spec());
          cache.set(it.key, { bWin: e.bWin, bLead: e.bLead, best: e.bestLoc });
        } catch {
          return;
        }
        // Redraw every few positions, not on each one.
        if (++n % 6 === 0) setTick((t) => t + 1);
      }
    })().finally(() => {
      if (!alive) return;
      setRunning(false);
      setTick((t) => t + 1);
    });
    return () => {
      alive = false;
      setRunning(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const done = items ? items.filter((i) => cache.has(i.key)).length : 0;
  return { get: (key: string) => cache.get(key), done, total: items?.length ?? 0, running };
}
