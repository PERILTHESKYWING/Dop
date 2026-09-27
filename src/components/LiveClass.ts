import { useEffect, useState } from 'react';
import type { PositionSpec } from '../lib/analysis/analyzer';
import { classifyMove, lossFromEvals, type MoveClass } from '../lib/coach/classify';
import { PASS, type Move } from '../lib/go/types';
import { recall } from '../state/evalMemory';
import { moveDifficulty, proAt } from '../state/insight';

export interface LiveMove {
  /** Live keys of the position before the move, after it, and before the opponent's previous move. */
  parentKey: string;
  childKey: string;
  grandKey?: string | null;
  move: Move;
  /** The opponent's previous move (for Miss). */
  prevMove?: Move | null;
  /** Moves played before `move` from the empty board (Book applies to the first 40). */
  moveIndex: number;
  /** The position before the move, for the difficulty look. */
  spec: () => PositionSpec | null;
}

/**
 * The class of the last move on a live board, from what KataGo read before and after it
 * (see state/evalMemory). Book and Brilliant are looked up in the background.
 */
export function useLiveMoveClass(m: LiveMove | null): MoveClass | null {
  const [extra, setExtra] = useState<{ key: string; book?: boolean; strongFind?: number | null }>({ key: '' });
  const id = m ? `${m.parentKey}>${m.move.loc}` : '';
  const parent = recall(m?.parentKey);
  const child = recall(m?.childKey);
  const loss = m && parent && m.move.loc !== PASS ? lossFromEvals(parent, m.move.loc, child) : null;
  const grand = recall(m?.grandKey);
  const prevLoss = m?.prevMove && grand && parent && m.prevMove.loc !== PASS ? lossFromEvals(grand, m.prevMove.loc, parent) : null;
  const ex = extra.key === id ? extra : { key: id };
  const cls = loss ? classifyMove({ ...loss, prev: prevLoss, book: ex.book, strongFind: ex.strongFind }) : null;
  const needsDifficulty = cls === 'great' && ex.strongFind === undefined;

  useEffect(() => {
    if (!m || m.move.loc === PASS || m.moveIndex >= 40) return;
    const s = m.spec();
    if (!s || s.size !== 19 || s.setup.length) return;
    let live = true;
    void proAt(s.board.stones, m.move.color, 19, m.move.loc).then((st) => {
      const hit = st?.moves.find((x) => x.loc === m.move.loc);
      if (live) setExtra((e) => ({ ...(e.key === id ? e : { key: id }), book: !!st && !!hit && hit.count >= 10 && hit.count / st.games >= 0.03 }));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!m || !needsDifficulty) return;
    const s = m.spec();
    if (!s) return;
    let live = true;
    const t = setTimeout(() => {
      moveDifficulty(`live|${m.parentKey}`, s, [m.move.loc])
        .then(([d]) => live && setExtra((e) => ({ ...(e.key === id ? e : { key: id }), strongFind: d?.strong ?? null })))
        .catch(() => live && setExtra((e) => ({ ...(e.key === id ? e : { key: id }), strongFind: null })));
    }, 600);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, needsDifficulty]);

  return cls;
}
