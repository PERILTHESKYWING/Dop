import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Board, type Mark } from '../components/Board';
import { useAnalysisView } from '../components/Analysis';
import { candidateMarks, CandidateTable, fromSnapshot, LiveHeader, lineOf, useLiveAnalysis } from '../components/Live';
import type { SearchSnapshot } from '../lib/engine/mcts';
import { KomiPicker } from '../components/Komi';
import { useLiveMoveClass } from '../components/LiveClass';
import { ClassPill } from '../components/MoveBadge';
import { replay } from '../lib/go/board';
import { locToGtp } from '../lib/go/coords';
import { engineKomi } from '../lib/go/rules';
import { PASS, type Color, type Loc, type Move } from '../lib/go/types';
import {
  addMove,
  blankKifu,
  countMoves,
  depthOf,
  kifuFromMoves,
  kifuFromSgf,
  kifuToSgf,
  lineEnd,
  lineThrough,
  movesTo,
  promote,
  removeNode,
  setComment,
  toPlayAt,
  type Kifu,
} from '../lib/kifu/kifu';
import { deleteKifu, getKifu, listKifus, loadDraft, saveDraft, saveKifu } from '../lib/kifu/store';
import { loadBroadcast } from '../lib/broadcast/data';
import { findShowing, floorOfKey, makeSchedule, showingMoves } from '../lib/broadcast/schedule';
import { useStore, toast } from '../state/store';
import { gameTitle } from '../components/common';
import { ActionTile, SheetSection } from '../components/ControlSheet';
import { useWheelSteps } from '../components/MoveNav';
import { BoardScreen, HeadButton, Notice, PlayersBar, REPORT_TABS, type ScreenTool } from '../components/BoardScreen';
import { BlunderPanel, PerformancePanel, TrendPanel } from '../components/Report';
import { SkillPanel } from '../components/Skill';
import type { PosValue } from '../lib/analysis/lineStats';
import { useQuickValues, type QuickItem } from '../state/quickValues';
import { Icon } from '../components/Icons';
import { go, href } from '../router';
import './study.css';

type Mode = 'play' | 'black' | 'white' | 'erase';

const ANALYSIS_PREF = 'dop.study.analysis';
const NUMBERS_PREF = 'dop.study.numbers';
const readPref = (k: string, d: boolean) => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : v === '1';
  } catch {
    return d;
  }
};
const writePref = (k: string, v: boolean) => {
  try {
    localStorage.setItem(k, v ? '1' : '0');
  } catch {
    /* private mode */
  }
};
const moveKey = (ms: Move[]) => ms.map((m) => `${m.color}${m.loc}`).join(',');

/** Where the study board opens: a saved kifu, a live AI game, one of your games, or the last draft. */
async function openKifu(id: string | undefined, query: URLSearchParams): Promise<Kifu> {
  const live = query.get('live');
  if (live) {
    const pool = await loadBroadcast();
    const g = findShowing(makeSchedule(pool, floorOfKey(live)), live, query.get('g') ?? '');
    if (!g) throw new Error('that live game is no longer being broadcast');
    // Only the moves already played: the rest of the game stays unseen.
    const n = Math.max(0, Math.min(g.total, Number(query.get('n') ?? 0) || 0));
    const moves = showingMoves(g)
      .slice(0, n)
      .map((loc, i) => ({ color: (i % 2 === 0 ? 1 : 2) as Color, loc }));
    return {
      ...kifuFromMoves({ size: g.game.size, komi: g.game.komi, rules: 'chinese', black: g.black, white: g.white, title: `Live table ${g.table + 1}: ${g.black} vs ${g.white}`, event: 'Live AI broadcast', date: new Date(g.start).toISOString().slice(0, 10) }, [], moves),
      source: 'live',
    };
  }
  const gameId = query.get('game');
  if (gameId) {
    const g = useStore.getState().games.find((x) => x.id === gameId);
    if (!g) throw new Error('that game is not in your library');
    const at = Math.max(0, Math.min(g.moves.length, Number(query.get('move') ?? 0) || 0));
    return {
      ...kifuFromMoves(
        { size: g.size, komi: g.komi, rules: g.rules && /jap|kor|territory/i.test(g.rules) ? 'japanese' : 'chinese', black: g.black, white: g.white, title: gameTitle(g), result: g.result, date: g.date, event: g.event },
        g.setup,
        g.moves,
        at,
      ),
      source: 'review',
    };
  }
  if (id) {
    const k = await getKifu(id);
    if (!k) throw new Error('that kifu was deleted');
    return k;
  }
  return (await loadDraft()) ?? blankKifu();
}

/** What the panel under the board shows while recording. */
type Pane = 'notes' | 'info' | 'kifu' | 'setup';

export function Study({ id, query }: { id?: string; query: URLSearchParams }) {
  const [kifu, setKifu] = useState<Kifu | null>(null);
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>('play');
  const [analysis, setAnalysis] = useState(() => readPref(ANALYSIS_PREF, false));
  const [numbers, setNumbers] = useState(() => readPref(NUMBERS_PREF, false));
  const [view, toggleView, setCandidateCount] = useAnalysisView();
  const [hoverPv, setHoverPv] = useState<Loc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [library, setLibrary] = useState<Kifu[]>([]);
  const [pane, setPane] = useState<Pane>('notes');
  const [tab, setTab] = useState<string | null>('data');
  const [notice, setNotice] = useState<null | 'save' | 'leave' | { newSize: number }>(null);
  const [saveTitle, setSaveTitle] = useState('');
  const qs = query.toString();

  // Open whatever the address asks for; a live game or a game from the library becomes a new draft.
  useEffect(() => {
    let alive = true;
    setError(null);
    openKifu(id, query)
      .then((k) => {
        if (!alive) return;
        setKifu(k);
        setCursor(k.nodes[k.cursor] && !k.nodes[k.cursor].gone ? k.cursor : 0);
        setMode('play');
        if (query.get('live') || query.get('game')) history.replaceState(null, '', '#/study');
      })
      .catch((e) => {
        if (!alive) return;
        setError((e as Error).message);
        setKifu((k) => k ?? blankKifu());
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, qs]);

  const refreshLibrary = useCallback(() => void listKifus().then(setLibrary).catch(() => undefined), []);
  useEffect(refreshLibrary, [refreshLibrary]);

  // Keep the working copy (and a saved kifu) up to date as you go.
  useEffect(() => {
    if (!kifu) return;
    const t = setTimeout(() => {
      const k = { ...kifu, cursor };
      void saveDraft(k).catch(() => undefined);
      if (k.saved) void saveKifu(k).then(refreshLibrary).catch(() => undefined);
    }, 500);
    return () => clearTimeout(t);
  }, [kifu, cursor, refreshLibrary]);

  const k = kifu;
  const played = useMemo(() => (k ? movesTo(k, cursor) : []), [k, cursor]);
  const board = useMemo(() => (k ? replay(k.size, k.setup, played) : null), [k, played]);
  const toPlay: Color = k ? toPlayAt(k, cursor) : 1;
  const rules = k?.rules === 'japanese' ? 'japanese' : 'chinese';
  const line = useMemo(() => (k ? lineThrough(k, cursor) : [0]), [k, cursor]);

  const stKey = (moves: Move[], tp: Color) => (k ? `st|${k.size}|${k.komi}|${rules}|${moveKey(k.setup)}|${moveKey(moves)}|${tp}` : '');
  // Every position read long enough, kept by node id: deeper than the quick pass below.
  const [seen, setSeen] = useState<Map<number, PosValue>>(() => new Map());
  const onLeaveNode = useCallback((snap: SearchSnapshot, node: number) => {
    if (snap.visits < 2) return;
    setSeen((m) => {
      const prev = m.get(node);
      const best = snap.candidates[0]?.loc ?? null;
      if (prev && prev.bWin === snap.bWin && prev.bLead === snap.bLead && prev.best === best) return m;
      return new Map(m).set(node, { bWin: snap.bWin, bLead: snap.bLead, best });
    });
  }, []);
  const target = useMemo(
    () =>
      k && analysis
        ? {
            key: stKey(played, toPlay),
            size: k.size,
            komi: engineKomi(k.komi, rules),
            setup: k.setup,
            moves: played,
            toPlay,
            onLeave: (snap: SearchSnapshot) => onLeaveNode(snap, cursor),
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [k, analysis, rules, played, toPlay, cursor, onLeaveNode],
  );
  const live = useLiveAnalysis(target, analysis);
  // The class of the move that led here, from what KataGo read before and after it.
  const lastPlayed = played.length ? played[played.length - 1] : null;
  const lastClass = useLiveMoveClass(
    k && analysis && lastPlayed
      ? {
          parentKey: stKey(played.slice(0, -1), lastPlayed.color),
          childKey: stKey(played, toPlay),
          grandKey: played.length >= 2 ? stKey(played.slice(0, -2), played[played.length - 2].color) : null,
          move: lastPlayed,
          prevMove: played.length >= 2 ? played[played.length - 2] : null,
          moveIndex: played.length - 1,
          spec: () => ({
            size: k.size,
            komi: engineKomi(k.komi, rules),
            setup: k.setup,
            history: played.slice(0, -1),
            toPlay: lastPlayed.color,
            board: replay(k.size, k.setup, played.slice(0, -1)),
          }),
        }
      : null,
  );
  const snap = live.snap;
  const shown = snap ? fromSnapshot(snap) : [];

  // The whole line, read once quickly, for the Trend, Blunder and Performance tabs.
  const lineMoves = useMemo(() => (k ? movesTo(k, line[line.length - 1]) : []), [k, line]);
  const wantsLine = analysis && (tab === 'trend' || tab === 'blunder' || tab === 'performance');
  const quickItems = useMemo<QuickItem[] | null>(() => {
    if (!k || !wantsLine) return null;
    const komi = engineKomi(k.komi, rules);
    return line.map((_, i) => {
      const ms = lineMoves.slice(0, i);
      const tp: Color = i < lineMoves.length ? lineMoves[i].color : ms.length ? (ms[ms.length - 1].color === 1 ? 2 : 1) : k.first;
      return { key: stKey(ms, tp), spec: () => ({ size: k.size, komi, setup: k.setup, history: ms, toPlay: tp, board: replay(k.size, k.setup, ms) }) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, wantsLine, line, lineMoves, rules]);
  const quick = useQuickValues(quickItems);

  const play = useCallback(
    (loc: Loc) => {
      if (!k || !board) return;
      if (mode !== 'play') {
        if (loc === PASS) return;
        const setup = k.setup.filter((m) => m.loc !== loc);
        const had = k.setup.find((m) => m.loc === loc);
        const color: Color | 0 = mode === 'black' ? 1 : mode === 'white' ? 2 : 0;
        if (color && had?.color !== color) setup.push({ color, loc });
        setKifu({ ...k, setup, updatedAt: Date.now() });
        return;
      }
      if (loc !== PASS && !board.isLegal(loc, toPlay)) return;
      const [nk, nid] = addMove(k, cursor, { color: toPlay, loc });
      setKifu(nk);
      setCursor(nid);
      setHoverPv(null);
    },
    [k, board, mode, cursor, toPlay],
  );

  // Scroll over the board: down goes forward along the current line, up goes back.
  const boardWrap = useWheelSteps((d) => {
    if (!k) return;
    setCursor((c) => {
      const nd = k.nodes[c];
      if (!nd) return c;
      if (d < 0) return nd.parent ?? c;
      return nd.children.length ? nd.children[0] : c;
    });
    setHoverPv(null);
  });

  // Keys: ← → through the moves, ↑ ↓ between variations, Home / End.
  useEffect(() => {
    if (!k || notice) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      const node = k.nodes[cursor];
      if (e.key === 'ArrowLeft' && node.parent !== null) setCursor(node.parent);
      else if (e.key === 'ArrowRight' && node.children.length) setCursor(node.children[0]);
      else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && node.parent !== null) {
        const sib = k.nodes[node.parent].children;
        const i = sib.indexOf(cursor) + (e.key === 'ArrowUp' ? -1 : 1);
        if (i < 0 || i >= sib.length) return;
        setCursor(sib[i]);
      } else if (e.key === 'Home') setCursor(0);
      else if (e.key === 'End') setCursor(lineEnd(k, cursor));
      else return;
      e.preventDefault();
      setHoverPv(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [k, cursor, notice]);

  if (!k || !board)
    return (
      <div className="page">
        <div className="empty">{error ?? 'Opening the study board…'}</div>
      </div>
    );

  const node = k.nodes[cursor];
  const last = node.move && node.move.loc !== PASS ? node.move.loc : null;
  const update = (patch: Partial<Kifu>) => setKifu({ ...k, ...patch, updatedAt: Date.now() });
  const size = k.size;
  const depth = depthOf(k, cursor);
  // Unsaved work worth asking about before leaving: a draft with moves or setup stones.
  const unsaved = !k.saved && (countMoves(k) > 0 || k.setup.length > 0);

  const marks: Mark[] = [];
  if (numbers) {
    // The number of the last move played on each point along this line.
    const at = new Map<Loc, number>();
    played.forEach((m, i) => m.loc !== PASS && at.set(m.loc, i + 1));
    for (const [loc, n] of at) if (board.stones[loc]) marks.push({ loc, kind: 'num', label: String(n) });
  }
  if (mode === 'play' && !hoverPv?.length) {
    node.children.forEach((c, i) => {
      const m = k.nodes[c].move!;
      if (node.children.length > 1 && m.loc !== PASS) marks.push({ loc: m.loc, kind: 'var', label: String.fromCharCode(65 + i) });
    });
  }
  const candidates = analysis && view.best && !hoverPv?.length && mode === 'play' && shown.length ? candidateMarks(shown) : null;
  // Black's winrate at every position along the line: the live search where you are, a
  // deeper read where you've been, the quick pass elsewhere.
  const values: (PosValue | null)[] = line.map((nid, i) => {
    if (nid === cursor && snap && snap.visits > 1) return { bWin: snap.bWin, bLead: snap.bLead, best: snap.candidates[0]?.loc ?? null };
    return seen.get(nid) ?? (quickItems ? (quick.get(quickItems[i].key) ?? null) : null);
  });

  const download = () => {
    const blob = new Blob([kifuToSgf(k)], { type: 'application/x-go-sgf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(k.title || 'kifu').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'kifu'}.sgf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importText = (text: string, name?: string) => {
    try {
      const nk = kifuFromSgf(text, name);
      setKifu(nk);
      setCursor(0);
      setPane('notes');
      toast(`Opened ${nk.title} (${countMoves(nk)} moves).`, 'info');
    } catch (e) {
      toast(`That SGF could not be read: ${(e as Error).message}`, 'error');
    }
  };
  const save = async (title = k.title) => {
    const nk = { ...k, title: title.trim() || k.title, saved: true, cursor, updatedAt: Date.now() };
    setKifu(nk);
    await saveKifu(nk);
    refreshLibrary();
    toast(`Saved "${nk.title}". Find it under Your kifu.`, 'ok');
  };
  const askSave = () => {
    setSaveTitle(k.title);
    setNotice('save');
  };
  const fresh = (sz: number) => {
    setKifu(blankKifu(sz, sz === 19 ? k.komi : sz === 13 ? 6.5 : 5.5, k.rules));
    setCursor(0);
    setMode('play');
    setPane('notes');
  };
  const setAnalysisPref = (v: boolean) => {
    setAnalysis(v);
    writePref(ANALYSIS_PREF, v);
    setHoverPv(null);
    if (v) setMode('play');
  };
  const setNumbersPref = (v: boolean) => {
    setNumbers(v);
    writePref(NUMBERS_PREF, v);
  };
  const goPos = (p: number) => {
    setCursor(line[Math.max(0, Math.min(line.length - 1, p))] ?? cursor);
    setHoverPv(null);
  };
  const deleteHere = () => {
    const [nk, back] = removeNode(k, cursor);
    setKifu(nk);
    setCursor(back);
  };
  const report = { values, moves: lineMoves, size, black: k.black, white: k.white, cursor: depth, onPick: goPos, progress: quickItems && quick.done < quick.total ? <span>Reading the game… {quick.done}/{quick.total}</span> : undefined };

  // ---------------------------------------------------------------- the panel under the board
  let panel: ReactNode;
  if (analysis) {
    if (tab === 'data')
      panel = (
        <>
          <LiveHeader snap={snap} />
          {lastClass && lastPlayed && lastPlayed.loc !== PASS && (
            <div className="bs-row small">
              <span className="dim">
                Move {played.length} {lastPlayed.color === 1 ? 'Black' : 'White'} {locToGtp(lastPlayed.loc, size)}
              </span>
              <ClassPill cls={lastClass} />
            </div>
          )}
          <CandidateTable cands={shown} size={size} onPick={play} onHover={(c) => setHoverPv(c ? c.pv : null)} max={view.candidateCount} resetKey={`${k.id}:${cursor}`} />
          {!shown.length && <p className="tiny muted">KataGo's candidate moves appear here as it reads. Tap one to see its line.</p>}
          <label className="small">
            Candidates listed: top {view.candidateCount}{' '}
            <input type="range" min={3} max={20} value={view.candidateCount} onChange={(e) => setCandidateCount(Number(e.target.value))} aria-label="Candidate moves listed" />
          </label>
        </>
      );
    else if (tab === 'trend') panel = <TrendPanel {...report} />;
    else if (tab === 'blunder') panel = <BlunderPanel {...report} />;
    else if (tab === 'performance') panel = <PerformancePanel {...report} />;
    else if (tab === 'skill') panel = <SkillPanel size={size} komi={k.komi} rules={rules} setup={k.setup} moves={lineMoves} black={k.black} white={k.white} />;
  } else if (pane === 'info') {
    panel = (
      <div className="study-info">
        <h3>Game info</h3>
        <label>
          Title
          <input value={k.title} onChange={(e) => update({ title: e.target.value })} />
        </label>
        <div className="study-players">
          <label>
            <i className="stone-dot b" />
            <input value={k.black} onChange={(e) => update({ black: e.target.value })} aria-label="Black player" placeholder="Black" />
          </label>
          <label>
            <i className="stone-dot w" />
            <input value={k.white} onChange={(e) => update({ white: e.target.value })} aria-label="White player" placeholder="White" />
          </label>
        </div>
        <label>
          Date
          <input value={k.date ?? ''} onChange={(e) => update({ date: e.target.value || undefined })} placeholder="2026-10-09" />
        </label>
        <label>
          Result
          <input value={k.result ?? ''} onChange={(e) => update({ result: e.target.value || undefined })} placeholder="B+R" />
        </label>
        <div>
          <span className="small muted">Komi and rules</span>
          <KomiPicker komi={k.komi} rules={rules} onKomi={(komi) => update({ komi })} onRules={(r) => update({ rules: r })} />
        </div>
        {cursor === 0 && !k.nodes[0].children.length && (
          <label>
            First to play
            <select value={k.first} onChange={(e) => update({ first: Number(e.target.value) as Color })}>
              <option value={1}>Black</option>
              <option value={2}>White</option>
            </select>
          </label>
        )}
      </div>
    );
  } else if (pane === 'kifu') {
    panel = (
      <>
        <SheetSection title="Files">
          <ActionTile onClick={download} icon={<Icon name="download" />} label="Download SGF" sub="To your own files" />
          <SgfImport onText={importText} />
        </SheetSection>
        <KifuLibrary
          items={library}
          current={k.id}
          onDelete={async (kid) => {
            await deleteKifu(kid);
            if (kid === k.id) update({ saved: false });
            refreshLibrary();
          }}
        />
        {!library.length && <p className="small muted">No saved kifu yet. Press Save to keep this one.</p>}
      </>
    );
  } else if (pane === 'setup') {
    panel = (
      <>
        <div className="segmented study-modes" role="radiogroup" aria-label="What a tap on the board does">
          {(
            [
              ['black', 'Add ●', 'black stone'],
              ['white', 'Add ○', 'white stone'],
              ['erase', 'Erase', 'remove a stone'],
              ['play', 'Done', 'back to moves'],
            ] as const
          ).map(([m, label, sub]) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              className={mode === m ? 'on' : ''}
              onClick={() => {
                setMode(m);
                if (m === 'play') setPane('notes');
                else setCursor(0);
              }}
            >
              <strong>{label}</strong>
              <span>{sub}</span>
            </button>
          ))}
        </div>
        <p className="tiny muted">Setup stones sit on the board before the first move, as in a handicap game or a problem. Tap a stone again to remove it.</p>
      </>
    );
  } else {
    panel = (
      <>
        <span className="small mono">
          {depth ? `${depth}. ${node.move!.color === 1 ? '●' : '○'} ${node.move!.loc === PASS ? 'pass' : locToGtp(node.move!.loc, size)}` : 'Start'} · {toPlay === 1 ? 'Black' : 'White'} to play
        </span>
        {error && <div className="callout small">Could not open that: {error}.</div>}
        {node.children.length > 1 && (
          <div className="bs-row">
            <span className="tiny muted">Variations here:</span>
            {node.children.map((c, i) => (
              <button key={c} className="chip click" onClick={() => setCursor(c)}>
                {String.fromCharCode(65 + i)} {k.nodes[c].move!.loc === PASS ? 'pass' : locToGtp(k.nodes[c].move!.loc, size)}
              </button>
            ))}
          </div>
        )}
        <div className="study-line" aria-label="Moves along this line">
          {line.slice(1).map((nid, i) => {
            const n = k.nodes[nid];
            const branch = k.nodes[n.parent!].children.length > 1;
            return (
              <button
                key={nid}
                className={`chip click ${n.move!.color === 1 ? 'b' : 'w'} ${nid === cursor ? 'on' : ''} ${i + 1 > depth ? 'ahead' : ''} ${branch ? 'branch' : ''} ${n.comment ? 'noted' : ''}`}
                onClick={() => setCursor(nid)}
                title={branch ? 'A variation starts here' : undefined}
              >
                {i + 1}. {n.move!.loc === PASS ? 'pass' : locToGtp(n.move!.loc, size)}
              </button>
            );
          })}
          {line.length === 1 && <span className="tiny muted">Tap the board to play. Every move you try is kept; playing a different move starts a variation.</span>}
        </div>
        {cursor !== 0 && line.some((nid) => nid !== 0 && k.nodes[k.nodes[nid].parent!].children[0] !== nid) && (
          <button className="btn small" onClick={() => setKifu(promote(k, cursor))}>
            Make this the main line
          </button>
        )}
        <textarea className="study-comment" value={node.comment ?? ''} onChange={(e) => setKifu(setComment(k, cursor, e.target.value))} placeholder={cursor ? 'Notes on this move' : 'Notes on the game'} rows={2} />
      </>
    );
  }

  const paneTool = (p: Pane, label: string, icon: ScreenTool['icon']): ScreenTool => ({ id: p, label, icon, on: pane === p, onClick: () => (setPane(pane === p ? 'notes' : p), p !== 'setup' && setMode('play')) });
  const tools: ScreenTool[] = analysis
    ? [
        { id: 'best', label: 'Best moves', icon: 'target', on: view.best, onClick: () => toggleView('best') },
        { id: 'territory', label: 'Territory', icon: 'territory', on: view.territory, onClick: () => toggleView('territory') },
        { id: 'heat', label: 'Heat map', icon: 'spark', on: view.heat, onClick: () => toggleView('heat') },
        { id: 'numbers', label: 'Numbers', icon: 'numbers', on: numbers, onClick: () => setNumbersPref(!numbers) },
        { id: 'pass', label: 'Pass', icon: 'pass', onClick: () => play(PASS) },
        { id: 'ai', label: 'AI analysis', icon: 'ai', on: true, onClick: () => setAnalysisPref(false), title: 'Back to recording' },
      ]
    : [
        { id: 'new', label: 'New', icon: 'plus', onClick: () => setNotice({ newSize: k.size }) },
        { id: 'numbers', label: 'Numbers', icon: 'numbers', on: numbers, onClick: () => setNumbersPref(!numbers) },
        { id: 'ai', label: 'AI analysis', icon: 'ai', onClick: () => setAnalysisPref(true) },
        paneTool('info', 'Edit info', 'pen'),
        { ...paneTool('setup', 'Setup stones', 'setup'), onClick: () => (pane === 'setup' ? (setPane('notes'), setMode('play')) : (setPane('setup'), setMode('black'), setCursor(0))) },
        { id: 'pass', label: 'Pass', icon: 'pass', onClick: () => play(PASS), disabled: mode !== 'play' },
        paneTool('kifu', 'Your kifu', 'library'),
      ];

  const leave = () => go('dashboard');
  return (
    <BoardScreen
      className={`study ${analysis ? 'analysing' : 'recording'}`}
      title={k.title || 'Untitled kifu'}
      sub={[k.date, k.saved ? 'saved' : 'draft', analysis ? 'AI analysis' : 'recording'].filter(Boolean).join(' · ')}
      onHome={unsaved ? () => setNotice('leave') : undefined}
      head={<HeadButton icon="save" label={k.saved ? 'Saved' : 'Save'} onClick={() => (k.saved ? void save() : askSave())} title={k.saved ? 'Saved; keeps saving as you go' : 'Save to Your kifu'} />}
      players={<PlayersBar black={k.black} white={k.white} captures={board.captures} showEval={analysis} bWin={snap?.bWin ?? seen.get(cursor)?.bWin ?? null} bLead={snap?.bLead ?? seen.get(cursor)?.bLead ?? null} pending={!snap || snap.visits < 2} />}
      boardRef={boardWrap}
      board={
        <Board
          size={size}
          stones={board.stones}
          lastMove={last}
          badge={last !== null && lastClass ? { loc: last, cls: lastClass } : null}
          toPlay={mode === 'play' ? toPlay : mode === 'white' ? 2 : 1}
          onPlay={play}
          marks={marks}
          candidates={candidates}
          onCandidateHover={(l) => setHoverPv(l === null ? null : (shown.find((c) => c.loc === l)?.pv ?? null))}
          onCandidateClick={play}
          variation={hoverPv?.length ? lineOf(hoverPv, toPlay) : null}
          heat={analysis && view.heat && !candidates && !hoverPv?.length && snap ? snap.policy : null}
          ownership={analysis && view.territory && snap ? snap.ownership : null}
          coords
          ariaLabel="Study board"
        />
      }
      steps={{
        pos: depth,
        total: line.length - 1,
        onGo: goPos,
        extra:
          cursor !== 0 ? (
            <button onClick={deleteHere} aria-label="Delete this move and what follows" title="Delete this move and what follows">
              <Icon name="trash" />
            </button>
          ) : null,
      }}
      tabs={analysis ? REPORT_TABS : null}
      tab={tab}
      onTab={setTab}
      panel={panel}
      tools={tools}
      notice={
        notice === 'save' ? (
          <Notice
            title="Save this kifu"
            onClose={() => setNotice(null)}
            actions={
              <>
                <button className="btn ghost" onClick={() => setNotice(null)}>
                  Cancel
                </button>
                <button className="btn primary" onClick={() => (setNotice(null), void save(saveTitle))}>
                  Save
                </button>
              </>
            }
          >
            <label>
              Name
              <input value={saveTitle} onChange={(e) => setSaveTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (setNotice(null), void save(saveTitle))} />
            </label>
            <span className="small">It goes to Your kifu, and keeps saving as you go.</span>
          </Notice>
        ) : notice === 'leave' ? (
          <Notice
            title="Leave without saving?"
            onClose={() => setNotice(null)}
            actions={
              <>
                <button className="btn ghost" onClick={() => setNotice(null)}>
                  Stay
                </button>
                <button className="btn" onClick={leave}>
                  Leave without saving
                </button>
                <button className="btn primary" onClick={() => void save().then(leave)}>
                  Save and leave
                </button>
              </>
            }
          >
            <span>This kifu isn't in Your kifu yet. If you leave, it stays here as a draft only until you start a new one.</span>
          </Notice>
        ) : notice && typeof notice === 'object' ? (
          <Notice
            title="Start a new board"
            onClose={() => setNotice(null)}
            actions={
              <>
                <button className="btn ghost" onClick={() => setNotice(null)}>
                  Cancel
                </button>
                <button className="btn primary" onClick={() => (setNotice(null), fresh(notice.newSize))}>
                  {unsaved ? 'Start without saving' : 'Start'}
                </button>
              </>
            }
          >
            <div className="segmented" role="radiogroup" aria-label="Board size">
              {[19, 13, 9].map((sz) => (
                <button key={sz} role="radio" aria-checked={notice.newSize === sz} className={notice.newSize === sz ? 'on' : ''} onClick={() => setNotice({ newSize: sz })}>
                  <strong>
                    {sz}×{sz}
                  </strong>
                </button>
              ))}
            </div>
            {unsaved && <span className="small warn-text">The board you have now isn't saved; a new board replaces its draft.</span>}
          </Notice>
        ) : null
      }
    />
  );
}

function SgfImport({ onText }: { onText: (text: string, name?: string) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState<string | null>(null);
  return (
    <>
      <ActionTile onClick={() => file.current?.click()} icon={<Icon name="upload" />} label="Open SGF" sub="From your files" />
      <ActionTile onClick={() => setPaste(paste === null ? '' : null)} icon="⎘" label="Paste SGF" sub="From the clipboard" />
      <input
        ref={file}
        type="file"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onText(await f.text(), f.name.replace(/\.sgf$/i, ''));
        }}
      />
      {paste !== null && (
        <div className="stack tight" style={{ gridColumn: '1 / -1' }}>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={4} placeholder="(;GM[1]SZ[19]…)" aria-label="SGF text" />
          <div className="row">
            <button
              className="btn small primary"
              disabled={!paste.trim()}
              onClick={() => {
                onText(paste);
                setPaste(null);
              }}
            >
              Open
            </button>
            <button className="btn small ghost" onClick={() => setPaste(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function KifuLibrary({ items, current, onDelete, onOpen }: { items: Kifu[]; current: string; onDelete: (id: string) => void; onOpen?: () => void }) {
  if (!items.length) return null;
  return (
    <section className="csheet-section">
      <h4>Your kifu</h4>
      <div className="study-lib">
        {items.map((it) => (
          <div key={it.id} className={`study-lib-row ${it.id === current ? 'on' : ''}`}>
            <a href={href(`study/${it.id}`)} onClick={(e) => (it.id === current ? e.preventDefault() : onOpen?.())}>
              <strong>{it.title || 'Untitled'}</strong>
              <span className="tiny muted">
                {it.size}×{it.size} · {countMoves(it)} moves · {new Date(it.updatedAt).toLocaleDateString()}
                {it.source === 'live' ? ' · from the live broadcast' : ''}
              </span>
            </a>
            <button
              className="btn small ghost"
              onClick={() => {
                if (confirm(`Delete "${it.title || 'Untitled'}"?`)) onDelete(it.id);
              }}
              aria-label={`Delete ${it.title}`}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
