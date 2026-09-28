import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board, type Mark } from '../components/Board';
import { useAnalysisView, WinBar } from '../components/Analysis';
import { candidateMarks, CandidateTable, fromSnapshot, LiveHeader, lineOf, useLiveAnalysis } from '../components/Live';
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
import { findShowing, makeSchedule, showingMoves } from '../lib/broadcast/schedule';
import { useStore, toast } from '../state/store';
import { FocusToggle, gameTitle, useFocusMode } from '../components/common';
import { href } from '../router';
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
    const g = findShowing(makeSchedule(pool), live, query.get('g') ?? '');
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

export function Study({ id, query }: { id?: string; query: URLSearchParams }) {
  const [kifu, setKifu] = useState<Kifu | null>(null);
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>('play');
  const [focused, setFocused] = useFocusMode();
  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFocused(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focused, setFocused]);
  const [analysis, setAnalysis] = useState(() => readPref(ANALYSIS_PREF, true));
  const [numbers, setNumbers] = useState(() => readPref(NUMBERS_PREF, false));
  const [view, toggleView, setCandidateCount] = useAnalysisView();
  const [hoverPv, setHoverPv] = useState<Loc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [library, setLibrary] = useState<Kifu[]>([]);
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

  const stKey = (moves: Move[], tp: Color) => (k ? `st|${k.size}|${k.komi}|${rules}|${moveKey(k.setup)}|${moveKey(moves)}|${tp}` : '');
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
          }
        : null,
    [k, analysis, rules, played, toPlay],
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

  // Keys: ← → through the moves, ↑ ↓ between variations, Home / End.
  useEffect(() => {
    if (!k) return;
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
  }, [k, cursor]);

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
  const line = lineThrough(k, cursor);
  const depth = depthOf(k, cursor);

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
      toast(`Opened ${nk.title} (${countMoves(nk)} moves).`, 'info');
    } catch (e) {
      toast(`That SGF could not be read: ${(e as Error).message}`, 'error');
    }
  };
  const save = async () => {
    const nk = { ...k, saved: true, cursor };
    setKifu(nk);
    await saveKifu(nk);
    refreshLibrary();
    toast('Saved — find it under Library → Your kifu.', 'info');
  };
  const fresh = (sz: number) => {
    setKifu(blankKifu(sz, sz === 19 ? k.komi : sz === 13 ? 6.5 : 5.5, k.rules));
    setCursor(0);
    setMode('play');
  };

  return (
    <div className={`stage study ${focused ? 'focused' : ''}`}>
      <FocusToggle focused={focused} onChange={setFocused} />
      <div className="board-wrap">
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
      </div>
      <div className="side">
        <div className="panel stack">
          <div className="spread">
            <div className="eyebrow">Study board</div>
            <span className="tiny muted">{k.saved ? 'Saved to your kifu' : 'Draft · kept in this browser'}</span>
          </div>
          <input className="study-title" value={k.title} onChange={(e) => update({ title: e.target.value })} aria-label="Title" />
          {error && <div className="callout small">Could not open that: {error}.</div>}
          <div className="row wrap">
            <button className="btn small primary" onClick={() => void save()}>
              {k.saved ? 'Saved' : 'Save kifu'}
            </button>
            <button className="btn small" onClick={download}>
              Download SGF
            </button>
            <SgfImport onText={importText} />
            <NewMenu onNew={fresh} />
          </div>
        </div>

        <div className="panel stack">
          <div className="study-players">
            <label>
              <i className="stone-dot b" />
              <input value={k.black} onChange={(e) => update({ black: e.target.value })} aria-label="Black player" />
            </label>
            <label>
              <i className="stone-dot w" />
              <input value={k.white} onChange={(e) => update({ white: e.target.value })} aria-label="White player" />
            </label>
          </div>
          <div className="row wrap">
            <KomiPicker komi={k.komi} rules={rules} onKomi={(komi) => update({ komi })} onRules={(r) => update({ rules: r })} />
            <label className="small">
              Result <input value={k.result ?? ''} onChange={(e) => update({ result: e.target.value || undefined })} placeholder="B+R" style={{ width: 70 }} />
            </label>
          </div>
        </div>

        <div className="panel stack">
          <div className="spread">
            <div className="row">
              <button className="btn small" onClick={() => setCursor(0)} disabled={cursor === 0} aria-label="Start">
                ⏮
              </button>
              <button className="btn small" onClick={() => node.parent !== null && setCursor(node.parent)} disabled={node.parent === null} aria-label="Back">
                ◀
              </button>
              <button className="btn small" onClick={() => node.children.length && setCursor(node.children[0])} disabled={!node.children.length} aria-label="Forward">
                ▶
              </button>
              <button className="btn small" onClick={() => setCursor(lineEnd(k, cursor))} disabled={!node.children.length} aria-label="End">
                ⏭
              </button>
              <button className="btn small ghost" onClick={() => play(PASS)} disabled={mode !== 'play'}>
                Pass
              </button>
            </div>
            <span className="small mono">
              {depth ? `${depth}. ${node.move!.color === 1 ? '●' : '○'} ${node.move!.loc === PASS ? 'pass' : locToGtp(node.move!.loc, size)}` : 'Start'} · {toPlay === 1 ? 'Black' : 'White'} to play
            </span>
          </div>
          {node.children.length > 1 && (
            <div className="row wrap">
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
          {cursor !== 0 && (
            <div className="row wrap">
              {line.some((nid) => nid !== 0 && k.nodes[k.nodes[nid].parent!].children[0] !== nid) ? (
                <button className="btn small" onClick={() => setKifu(promote(k, cursor))}>
                  Make main line
                </button>
              ) : null}
              <button
                className="btn small ghost"
                onClick={() => {
                  const [nk, back] = removeNode(k, cursor);
                  setKifu(nk);
                  setCursor(back);
                }}
              >
                Delete from here
              </button>
            </div>
          )}
          <textarea className="study-comment" value={node.comment ?? ''} onChange={(e) => setKifu(setComment(k, cursor, e.target.value))} placeholder={cursor ? 'Notes on this move' : 'Notes on the game'} rows={2} />
        </div>

        <div className="panel stack">
          <div className="segmented study-modes" role="radiogroup" aria-label="What a tap on the board does">
            {(
              [
                ['play', 'Play', 'moves alternate'],
                ['black', 'Add ●', 'setup stone'],
                ['white', 'Add ○', 'setup stone'],
                ['erase', 'Erase', 'setup stone'],
              ] as const
            ).map(([m, label, sub]) => (
              <button
                key={m}
                role="radio"
                aria-checked={mode === m}
                className={mode === m ? 'on' : ''}
                onClick={() => {
                  setMode(m);
                  if (m !== 'play') setCursor(0);
                }}
              >
                <strong>{label}</strong>
                <span>{sub}</span>
              </button>
            ))}
          </div>
          {mode !== 'play' && <p className="tiny muted">Setup stones sit on the board before the first move, as in a problem. Tap a stone again to remove it.</p>}
          {cursor === 0 && !k.nodes[0].children.length && (
            <label className="small">
              First to play{' '}
              <select value={k.first} onChange={(e) => update({ first: Number(e.target.value) as Color })}>
                <option value={1}>Black</option>
                <option value={2}>White</option>
              </select>
            </label>
          )}
        </div>

        <div className="panel stack live-panel">
          <div className="spread">
            <label className="toggle">
              <input
                type="checkbox"
                checked={analysis}
                onChange={(e) => {
                  setAnalysis(e.target.checked);
                  writePref(ANALYSIS_PREF, e.target.checked);
                }}
              />{' '}
              KataGo analysis
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={numbers}
                onChange={(e) => {
                  setNumbers(e.target.checked);
                  writePref(NUMBERS_PREF, e.target.checked);
                }}
              />{' '}
              Move numbers
            </label>
          </div>
          {analysis && (
            <>
              <LiveHeader snap={snap} />
              <WinBar bWin={snap?.bWin ?? null} bLead={snap?.bLead ?? null} pending={!snap || snap.visits < 2} />
              {lastClass && lastPlayed && lastPlayed.loc !== PASS && (
                <div className="row small">
                  <span className="dim">
                    Move {played.length} {lastPlayed.color === 1 ? 'Black' : 'White'} {locToGtp(lastPlayed.loc, size)}
                  </span>
                  <ClassPill cls={lastClass} />
                </div>
              )}
              <CandidateTable cands={shown} size={size} onPick={play} onHover={(c) => setHoverPv(c ? c.pv : null)} max={view.candidateCount} resetKey={`${k.id}:${cursor}`} />
              <div className="row wrap toggles">
                <label className="toggle">
                  <input type="checkbox" checked={view.best} onChange={() => toggleView('best')} /> Best moves
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={view.heat} onChange={() => toggleView('heat')} /> Heat map
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={view.territory} onChange={() => toggleView('territory')} /> Territory
                </label>
                <label className="toggle">
                  Top
                  <input
                    className="candidate-count"
                    type="number"
                    min={3}
                    max={20}
                    value={view.candidateCount}
                    onChange={(e) => setCandidateCount(Number(e.target.value) || view.candidateCount)}
                  />
                  moves
                </label>
              </div>
            </>
          )}
        </div>

        <KifuLibrary
          items={library}
          current={k.id}
          onDelete={async (kid) => {
            await deleteKifu(kid);
            if (kid === k.id) update({ saved: false });
            refreshLibrary();
          }}
        />
        <p className="tiny muted">← → moves · ↑ ↓ variations · Space pauses KataGo</p>
      </div>
    </div>
  );
}

function SgfImport({ onText }: { onText: (text: string, name?: string) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState<string | null>(null);
  return (
    <>
      <button className="btn small" onClick={() => file.current?.click()}>
        Open SGF
      </button>
      <button className="btn small ghost" onClick={() => setPaste(paste === null ? '' : null)}>
        Paste SGF
      </button>
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
        <div className="stack tight" style={{ width: '100%' }}>
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

function NewMenu({ onNew }: { onNew: (size: number) => void }) {
  return (
    <select
      value=""
      onChange={(e) => {
        if (e.target.value) onNew(Number(e.target.value));
      }}
      aria-label="New board"
      className="study-new"
    >
      <option value="">New board…</option>
      <option value="19">19×19</option>
      <option value="13">13×13</option>
      <option value="9">9×9</option>
    </select>
  );
}

function KifuLibrary({ items, current, onDelete }: { items: Kifu[]; current: string; onDelete: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="panel stack">
      <h3>Your kifu</h3>
      <div className="study-lib">
        {items.map((it) => (
          <div key={it.id} className={`study-lib-row ${it.id === current ? 'on' : ''}`}>
            <a href={href(`study/${it.id}`)} onClick={(e) => it.id === current && e.preventDefault()}>
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
    </div>
  );
}
