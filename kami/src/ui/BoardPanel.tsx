import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Board, type Mark } from '../../../src/components/Board';
import { BlunderPanel, TrendPanel } from '../../../src/components/Report';
import '../../../src/components/boardscreen.css';
import { candidateMarks, lineOf } from '../../../src/lib/analysis/candidates';
import type { ExplainPosition } from '../../../src/lib/coach/explain/types';
import { replay } from '../../../src/lib/go/board';
import { colorName, PASS, type Loc, type Move } from '../../../src/lib/go/types';
import { cachedRead, useBoardRead, useLineReads } from '../lib/analysis';
import { engineStatus, onEngineStatus } from '../lib/engine';
import { emptyBoard, explainPositionOf, goTo, hasPosition, toPlayAt, type BoardState } from '../lib/position';
import { useGameRating } from '../lib/rating';
import { reviewMoves } from '../lib/review';
import { setSetting, useSetting } from '../lib/settings';
import { Icon } from './Icon';
import { Performance } from './Performance';
import { Popover } from './Popover';
import type { SettingsPage } from './Settings';

/** A variation, point or built position drawn over the position it starts from. */
export interface Preview {
  /** Which chip shows it (a second tap on the same chip closes it). */
  key: string;
  base: ExplainPosition;
  line: Move[];
  highlight: Loc[];
  title: string;
  note?: string;
  /** Tapped (stays until closed) rather than hovered. */
  pinned: boolean;
}

interface Props {
  board: BoardState;
  preview: Preview | null;
  onBoard: (b: BoardState) => void;
  onPlay: (loc: Loc) => void;
  onUndo: () => void;
  onClearPreview: () => void;
  onSgfText: (text: string) => boolean;
  onSgfFile: (f: File) => void;
  onSettings: (page?: SettingsPage) => void;
}

const TABS = [
  { id: 'trend', label: 'Trend', icon: 'trend' },
  { id: 'blunder', label: 'Blunders', icon: 'blunder' },
  { id: 'performance', label: 'Performance', icon: 'performance' },
] as const;
type TabId = (typeof TABS)[number]['id'];
const SIZES = [19, 13, 9];

/**
 * The largest square that fits the element after `reserve` px of rows above and below it,
 * kept up to date as the panel is resized.
 */
function useSquare(reserve: number): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setSide(Math.max(120, Math.floor(Math.min(el.clientWidth, el.clientHeight - reserve))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [reserve]);
  return [ref, side];
}

function Switch({ on, onChange, label, icon }: { on: boolean; onChange: (v: boolean) => void; label: string; icon: string }) {
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={on} className="pop-item" onClick={() => onChange(!on)}>
      <Icon name={icon} />
      <span className="grow">{label}</span>
      <span className={`switch sm${on ? ' on' : ''}`} aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

/**
 * The board column: the players along the top with the gear, a thin eval bar, the board as
 * big as the column allows (it grows when the column is dragged wider), and one row with the
 * step buttons and the Trend / Blunders / Performance graphs. Everything else (best moves,
 * territory, pass, undo, loading a game, a new board) sits behind the gear.
 */
export function BoardPanel({ board, preview, onBoard, onPlay, onUndo, onClearPreview, onSgfText, onSgfFile, onSettings }: Props) {
  const status = useSyncExternalStore(onEngineStatus, engineStatus);
  const [paste, setPaste] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId | null>(null);
  const [hoverPv, setHoverPv] = useState<Loc[] | null>(null);
  const bestOn = useSetting<boolean>('board.best');
  const bestCount = useSetting<number>('board.bestCount');
  const territoryOn = useSetting<boolean>('board.territory');
  const coords = useSetting<boolean>('board.coords');
  const file = useRef<HTMLInputElement>(null);

  const n = board.moves.length;
  const toPlay = toPlayAt(board);
  const withStones = hasPosition(board);

  // The position on the board, read by KataGo for the best moves and territory.
  const position = useMemo(() => (withStones && !preview ? explainPositionOf(board) : null), [board, preview, withStones]);
  const { read, last, pending } = useBoardRead(position);

  // Every position along the game, read quickly while a graph is open.
  const line = useMemo(
    () => (tab && n && !preview ? Array.from({ length: n + 1 }, (_, i) => explainPositionOf(board, i)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, n, preview, board.moves, board.setup, board.size, board.komi, board.rules, board.first],
  );
  const lineReads = useLineReads(line);

  const view = useMemo(() => {
    if (preview) {
      const b = replay(preview.base.size, preview.base.setup, preview.base.moves);
      const lastLoc = preview.base.moves.length ? preview.base.moves[preview.base.moves.length - 1].loc : null;
      const marks: Mark[] = preview.highlight.filter((l) => l !== PASS).map((loc) => ({ loc, kind: 'evidence' }));
      return {
        size: preview.base.size,
        stones: b.stones,
        captures: undefined as readonly number[] | undefined,
        last: lastLoc,
        marks,
        variation: preview.line.length ? (preview.line as Move[]) : null,
      };
    }
    const b = replay(board.size, board.setup, board.moves, board.cursor);
    const lastLoc = board.cursor ? board.moves[board.cursor - 1].loc : null;
    return {
      size: board.size,
      stones: b.stones,
      captures: b.captures as readonly number[] | undefined,
      last: lastLoc,
      marks: [] as Mark[],
      variation: null as Move[] | null,
    };
  }, [board, preview]);

  const hovered = !preview && hoverPv?.length ? lineOf(hoverPv, toPlay) : null;
  const variation = preview ? view.variation : hovered;
  const candidates = !preview && bestOn && read ? candidateMarks(read.candidates, bestCount) : null;
  const ownership = !preview && territoryOn && read ? read.ownership : null;

  const play = (loc: Loc) => {
    setHoverPv(null);
    onPlay(loc);
  };
  const go = (pos: number) => {
    setHoverPv(null);
    onBoard(goTo(board, Math.max(0, Math.min(n, pos))));
  };

  // Arrow keys step through the game when the focus is not in a text box.
  const goRef = useRef(go);
  goRef.current = go;
  const cursorRef = useRef(board.cursor);
  cursorRef.current = board.cursor;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.altKey || e.ctrlKey || e.metaKey || t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      const c = cursorRef.current;
      if (e.key === 'ArrowLeft') goRef.current(c - 1);
      else if (e.key === 'ArrowRight') goRef.current(c + 1);
      else if (e.key === 'Home') goRef.current(0);
      else if (e.key === 'End') goRef.current(Infinity);
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);

  const passed = board.cursor > 0 && board.moves[board.cursor - 1].loc === PASS;
  const moveLine = `${board.cursor ? `Move ${board.cursor}` : n ? 'Start' : 'Empty board'} · ${colorName(toPlay)} to play${passed ? ' (after a pass)' : ''}`;

  // The Performance tab's numbers: move classes from the graph reads, the rating from b10.
  const lineReadsFull = useMemo(
    () => (tab === 'performance' && line ? line.map((p) => cachedRead(p)) : null),
    // `lineReads.done` changes as reads land.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, line, lineReads.done],
  );
  const rating = useGameRating(board, tab === 'performance' && !preview && n > 0);
  const reviewed = useMemo(
    () => (lineReadsFull && line ? reviewMoves(line, lineReadsFull, board.moves, board.size, rating?.state === 'done' ? rating.policy : undefined) : []),
    [lineReadsFull, line, board.moves, board.size, rating],
  );

  const progress =
    lineReads.done < lineReads.total ? (
      <span>
        Reading the game… {lineReads.done}/{lineReads.total}
      </span>
    ) : null;
  const report = {
    values: lineReads.values,
    moves: board.moves,
    size: board.size,
    black: board.black ?? 'Black',
    white: board.white ?? 'White',
    cursor: board.cursor,
    onPick: go,
    progress: progress ?? undefined,
  };
  let panel: ReactNode = null;
  if (!preview && tab && n) {
    if (tab === 'trend') panel = <TrendPanel {...report} />;
    else if (tab === 'blunder') panel = <BlunderPanel {...report} />;
    else {
      const measuring = rating?.state === 'measuring' ? `Rating the game… ${rating.done}/${rating.total}` : null;
      panel = (
        <Performance
          black={report.black}
          white={report.white}
          moves={reviewed}
          rating={rating}
          cursor={board.cursor}
          onPick={go}
          progress={progress || measuring ? <span>{[progress ? `Reading the game… ${lineReads.done}/${lineReads.total}` : null, measuring].filter(Boolean).join(' · ')}</span> : null}
        />
      );
    }
  }

  // Escape closes an open graph (when nothing else has the focus).
  const tabRef = useRef(tab);
  tabRef.current = tab;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !tabRef.current || e.defaultPrevented) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [role="dialog"], [role="menu"]')) return;
      setTab(null);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);

  const caps = view.captures;
  // Only the note under a previewed line shares the stage with the board.
  const [boxRef, side] = useSquare(preview ? 42 : 0);
  const namesTitle = board.black || board.white ? `${board.black ?? 'Black'} vs ${board.white ?? 'White'}` : '';
  const title = board.title && board.title !== namesTitle ? board.title : '';
  const engineLine = status.state === 'idle' ? null : `${status.text}${status.state === 'loading' && status.pct !== undefined ? ` ${status.pct}%` : ''}`;

  // The eval bar: the read of this position, else the last one shown, faded while KataGo reads.
  const shown = withStones && !preview ? (read ?? last) : null;
  const bWin = shown ? shown.bWin : 0.5;
  const lead = shown ? shown.bLead : null;
  const leadText = lead === null ? '' : Math.abs(lead) < 0.05 ? 'Even' : `${lead > 0 ? 'B' : 'W'}+${Math.abs(lead).toFixed(1)}`;

  const player = (c: 1 | 2) => (
    <span className={`pl${toPlay === c && !preview ? ' turn' : ''}`} title={toPlay === c ? `${c === 1 ? board.black || 'Black' : board.white || 'White'} to play` : undefined}>
      <i className={`stone ${c === 1 ? 'b' : 'w'}`} />
      <span className="pl-name">{(c === 1 ? board.black : board.white) || (c === 1 ? 'Black' : 'White')}</span>
      {caps && caps[c] > 0 && (
        <span className="pl-caps" title="Stones captured">
          +{caps[c]}
        </span>
      )}
    </span>
  );
  const tabInfo = TABS.find((t) => t.id === tab);

  return (
    <section className={`board-panel${preview ? ' previewing' : ''}${panel ? ' with-graph' : ''}`} aria-label="Board">
      <div className="bp-head">
        {preview ? (
          <div className="bp-caption">
            <span>{preview.title}</span>
          </div>
        ) : (
          <div className="bp-players" title={[title, moveLine].filter(Boolean).join(' · ')}>
            {player(1)}
            <span className="pl-vs" aria-hidden="true">
              vs
            </span>
            {player(2)}
          </div>
        )}
        {status.state !== 'idle' && status.state !== 'ready' && !preview && (
          <span className={`engine-chip ${status.state}`} title={engineLine ?? undefined}>
            <span className="dot" />
            {status.state === 'failed' ? 'KataGo failed' : `KataGo${status.pct !== undefined ? ` ${status.pct}%` : ''}`}
          </span>
        )}
        {preview?.pinned ? (
          <button className="icon-btn" aria-label="Back to the board" title="Back to the board" onClick={onClearPreview}>
            <Icon name="x" />
          </button>
        ) : (
          <Popover
            className="game-gear"
            place="down-end"
            label="Game settings"
            trigger={({ open, toggle }) => (
              <button type="button" className={`icon-btn${open ? ' on' : ''}`} aria-label="Game settings" title="Game settings" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
                <Icon name="gear" size={19} />
              </button>
            )}
          >
            {(close) => (
              <>
                <div className="pop-head">{title || 'Board'}</div>
                <Switch on={bestOn} onChange={(v) => setSetting('board.best', v)} label="Best moves" icon="target" />
                <Switch on={territoryOn} onChange={(v) => setSetting('board.territory', v)} label="Territory" icon="territory" />
                <Switch on={coords} onChange={(v) => setSetting('board.coords', v)} label="Coordinates" icon="board" />
                <hr />
                <button
                  type="button"
                  role="menuitem"
                  className="pop-item"
                  onClick={() => {
                    play(PASS);
                    close();
                  }}
                >
                  <Icon name="pass" />
                  <span className="grow">Pass</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="pop-item"
                  disabled={!board.cursor}
                  onClick={() => {
                    onUndo();
                    close();
                  }}
                >
                  <Icon name="undo" />
                  <span className="grow">Undo last move</span>
                </button>
                <hr />
                <button
                  type="button"
                  role="menuitem"
                  className="pop-item"
                  onClick={() => {
                    setPaste('');
                    close();
                  }}
                >
                  <Icon name="paste" />
                  <span className="grow">Paste SGF</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="pop-item"
                  onClick={() => {
                    file.current?.click();
                    close();
                  }}
                >
                  <Icon name="upload" />
                  <span className="grow">Open SGF file</span>
                </button>
                <div className="pop-item static">
                  <Icon name="plus" />
                  <span className="grow">New board</span>
                  <span className="seg sm" role="group" aria-label="New board size">
                    {SIZES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          onBoard(emptyBoard(s));
                          close();
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </span>
                </div>
                <hr />
                <button
                  type="button"
                  role="menuitem"
                  className="pop-item"
                  onClick={() => {
                    close();
                    onSettings('board');
                  }}
                >
                  <Icon name="gear" />
                  <span className="grow">All board and KataGo settings</span>
                </button>
                {engineLine && <div className="pop-foot">{engineLine}</div>}
              </>
            )}
          </Popover>
        )}
      </div>

      {!preview && (
        <div
          className={`bp-eval${shown ? '' : ' empty'}${pending && shown ? ' stale' : ''}`}
          title={
            shown ? `Black ${(bWin * 100).toFixed(1)}% · White ${((1 - bWin) * 100).toFixed(1)}%${leadText ? ` · ${leadText}` : ''}${pending ? ' (reading)' : ''}` : 'Play a move to see who is ahead'
          }
        >
          <span className="ev-n">{shown ? `${(bWin * 100).toFixed(1)}%` : 'Black'}</span>
          <span className="ev-track" aria-hidden="true">
            <span className="ev-fill" style={{ width: `${(bWin * 100).toFixed(1)}%` }} />
            <span className="ev-mid" />
          </span>
          <span className="ev-n">{shown ? `${((1 - bWin) * 100).toFixed(1)}%` : 'White'}</span>
          {leadText && <span className="ev-lead">{leadText}</span>}
          {pending && status.state === 'ready' && <span className="ev-dot" aria-label="KataGo is reading" />}
        </div>
      )}

      <div className="bp-body">
        <div className="bp-stage" ref={boxRef}>
          <div className="bp-square" style={{ width: side, height: side }}>
            <Board
              size={view.size}
              stones={view.stones}
              lastMove={view.last}
              toPlay={preview ? undefined : toPlay}
              onPlay={play}
              marks={view.marks}
              candidates={candidates}
              onCandidateHover={(l) => setHoverPv(l === null ? null : (read?.candidates.find((c) => c.loc === l)?.pv ?? null))}
              onCandidateClick={play}
              variation={variation}
              ownership={ownership}
              coords={coords}
              ariaLabel={preview ? `Variation: ${preview.title}` : 'Board: click to play'}
            />
          </div>
          {preview && <p className="bp-note">{preview.note || (preview.pinned ? 'Tap the board or the × to go back.' : ' ')}</p>}
        </div>

        {panel && tabInfo && (
          <div className="bp-graph" role="region" aria-label={tabInfo.label}>
            <div className="bp-graph-head">
              <Icon name={tabInfo.icon} size={16} />
              <span className="grow">{tabInfo.label}</span>
              <button type="button" className="icon-btn sm" aria-label={`Close ${tabInfo.label}`} title="Close (Esc)" onClick={() => setTab(null)}>
                <Icon name="x" size={16} />
              </button>
            </div>
            <div className="bp-graph-body">{panel}</div>
          </div>
        )}
      </div>

      {!preview && (
        <div className="bp-foot">
          <div className="bp-steps" role="group" aria-label="Move through the game">
            <button type="button" className="icon-btn" onClick={() => go(0)} disabled={board.cursor <= 0} aria-label="First move" title="First move (Home)">
              <Icon name="first" />
            </button>
            <button type="button" className="icon-btn" onClick={() => go(board.cursor - 1)} disabled={board.cursor <= 0} aria-label="Previous move" title="Previous move (←)">
              <Icon name="prev" />
            </button>
            <span className="bp-count" title={moveLine}>
              {board.cursor}
              <span className="of"> / {n}</span>
            </span>
            <button type="button" className="icon-btn" onClick={() => go(board.cursor + 1)} disabled={board.cursor >= n} aria-label="Next move" title="Next move (→)">
              <Icon name="next" />
            </button>
            <button type="button" className="icon-btn" onClick={() => go(n)} disabled={board.cursor >= n} aria-label="Last move" title="Last move (End)">
              <Icon name="last" />
            </button>
          </div>
          {n > 0 && (
            <div className="bp-tabs" role="tablist" aria-label="Game graphs">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-label={t.label}
                  aria-selected={tab === t.id}
                  className={tab === t.id ? 'on' : ''}
                  title={tab === t.id ? `Close ${t.label}` : t.label}
                  onClick={() => setTab(tab === t.id ? null : t.id)}
                >
                  <Icon name={t.icon} size={16} />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {paste !== null && (
        <div className="bp-sheet" role="dialog" aria-label="Paste SGF">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (onSgfText(paste)) setPaste(null);
            }}
          >
            <div className="sheet-title">Paste an SGF</div>
            <textarea autoFocus value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="(;GM[1]SZ[19];B[pd];W[dp]...)" aria-label="SGF text" rows={6} />
            <div className="paste-row">
              <button type="button" className="btn" onClick={() => setPaste(null)}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={!paste.trim()}>
                Load game
              </button>
            </div>
          </form>
        </div>
      )}
      <input
        ref={file}
        type="file"
        accept=".sgf,application/x-go-sgf,text/plain"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onSgfFile(f);
          e.target.value = '';
        }}
      />
    </section>
  );
}
