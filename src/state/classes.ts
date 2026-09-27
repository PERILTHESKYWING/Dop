import { useEffect, useMemo, useState } from 'react';
import { engineKomi } from '../lib/go/rules';
import { classifyMove, type ClassInput, type MoveClass } from '../lib/coach/classify';
import { nextBestGap } from '../lib/coach/difficulty';
import { fromStoredCandidates } from '../lib/coach/stored';
import { proStats } from '../lib/coach/pro';
import type { Board } from '../lib/go/board';
import { PASS } from '../lib/go/types';
import type { GameAnalysis, GameRecord, MoveRecord } from '../lib/types';
import { moveDifficulty, proExplorer } from './insight';

/**
 * Classifications for every move of an analysed game. The grading comes straight from the
 * stored analysis; two upgrades follow in the background: Book (pro games, openings only)
 * and Brilliant (how hard each Great move is to find, which needs a quick engine look).
 */

/** Book: professionals chose it at least this often from the position (and in this many games). */
const BOOK_SHARE = 0.03;
const BOOK_GAMES = 10;
const BOOK_MOVES = 40;

export function classInputs(records: ReadonlyMap<number, MoveRecord>, analysis: GameAnalysis | undefined): Map<number, ClassInput> {
  const out = new Map<number, ClassInput>();
  for (const [i, r] of records) {
    if (r.loc === PASS) continue;
    const e = analysis?.evals[i];
    const cands = e?.searched ? fromStoredCandidates(e.candidates) : [];
    const isBest = r.severity === 'best';
    const gap = isBest && cands[0]?.loc === r.loc ? nextBestGap(cands, e?.visits ?? 0) : null;
    const prev = records.get(i - 1);
    out.set(i, { scoreLoss: r.scoreLoss, winrateLoss: r.winrateLoss, isBest, gap, prev: prev ? { scoreLoss: prev.scoreLoss, winrateLoss: prev.winrateLoss } : null });
  }
  return out;
}

const upgrades = new Map<string, Map<number, Partial<ClassInput>>>();

async function runUpgrades(key: string, game: GameRecord, boards: readonly Board[], inputs: Map<number, ClassInput>, onChange: () => void, alive: () => boolean) {
  const up = upgrades.get(key) ?? new Map<number, Partial<ClassInput>>();
  upgrades.set(key, up);
  const set = (i: number, patch: Partial<ClassInput>) => {
    up.set(i, { ...up.get(i), ...patch });
    onChange();
  };
  if (game.size === 19 && !game.setup.length) {
    const ex = await proExplorer();
    if (ex && alive()) {
      for (const i of inputs.keys()) {
        if (i >= BOOK_MOVES || up.get(i)?.book !== undefined) continue;
        const m = game.moves[i];
        const st = proStats(ex, boards[i].stones, m.color, 19, m.loc);
        const hit = st?.moves.find((x) => x.loc === m.loc);
        set(i, { book: !!st && !!hit && hit.count >= BOOK_GAMES && hit.count / st.games >= BOOK_SHARE });
      }
    }
  }
  // Great moves: are they hard enough to find to be brilliant?
  const komi = engineKomi(game.komi, game.rules);
  for (const [i, inp] of inputs) {
    if (!alive()) return;
    if (up.get(i)?.strongFind !== undefined || classifyMove({ ...inp, ...up.get(i), strongFind: null }) !== 'great') continue;
    const m = game.moves[i];
    try {
      const [d] = await moveDifficulty(`${game.id}|${i}|${komi}`, { size: game.size, komi, setup: game.setup, history: game.moves.slice(0, i), toPlay: m.color, board: boards[i] }, [m.loc]);
      set(i, { strongFind: d?.strong ?? null });
    } catch {
      return;
    }
  }
}

/** Every move's class (by move index), filling in Book and Brilliant as they are worked out. */
export function useGameClasses(game: GameRecord | undefined, records: ReadonlyMap<number, MoveRecord>, analysis: GameAnalysis | undefined, boards: readonly Board[]): Map<number, MoveClass> {
  const inputs = useMemo(() => (game ? classInputs(records, analysis) : new Map<number, ClassInput>()), [game, records, analysis]);
  const key = game ? `${game.id}|${game.komi}|${analysis?.updatedAt ?? 0}` : '';
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!game || !inputs.size) return;
    let live = true;
    let pending = false;
    const onChange = () => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        if (live) setTick((t) => t + 1);
      }, 250);
    };
    // Give the page a moment before starting background work.
    const t = setTimeout(() => void runUpgrades(key, game, boards, inputs, onChange, () => live), 1200);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, inputs]);
  return useMemo(() => {
    const up = upgrades.get(key);
    const out = new Map<number, MoveClass>();
    for (const [i, inp] of inputs) out.set(i, classifyMove({ ...inp, ...up?.get(i) }));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, key, tick]);
}
