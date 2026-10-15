import { useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Board, type Mark } from '../../../src/components/Board';
import { PlayersBar, REPORT_TABS, Stepper, type ScreenTool } from '../../../src/components/BoardScreen';
import { Icon as DopIcon } from '../../../src/components/Icons';
import { BlunderPanel, PerformancePanel, TrendPanel } from '../../../src/components/Report';
import { candidateMarks, lineOf } from '../../../src/lib/analysis/candidates';
import type { ExplainPosition } from '../../../src/lib/coach/explain/types';
import { replay } from '../../../src/lib/go/board';
import { colorName, PASS, type Loc, type Move } from '../../../src/lib/go/types';
import { cachedRead, useBoardRead, useLineReads } from '../lib/analysis';
import { engineStatus, onEngineStatus } from '../lib/engine';
import { emptyBoard, explainPositionOf, goTo, hasPosition, toPlayAt, type BoardState } from '../lib/position';
import { Icon } from './Icon';

/** A variation (or concept example) drawn over the position it starts from. */
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
}

/** The tabs Kami shows: the ones that need only KataGo's reads of each position. */
const LINE_TABS = REPORT_TABS.filter((t) => t.id === 'trend' || t.id === 'blunder' || t.id === 'performance');
const SIZES = [19, 13, 9];

/**
 * The board panel is Dop's study and review board (the same eval bar, candidate discs,
 * territory, step buttons, Trend, Blunder and Performance tabs and tools), in the right-hand
 * column on wide screens and at the top on phones. It never takes more than half the screen:
 * the CSS in styles.css sizes the board to what is left.
 */
export function BoardPanel({ board, preview, onBoard, onPlay, onUndo, onClearPreview, onSgfText, onSgfFile }: Props) {
  const status = useSyncExternalStore(onEngineStatus, engineStatus);
  const [paste, setPaste] = useState<string | null>(null);
  const [sizes, setSizes] = useState(false);
  const [tab, setTab] = useState<string | null>(null);
  const [bestOn, setBestOn] = useState(true);
  const [territoryOn, setTerritoryOn] = useState(false);
  const [hoverPv, setHoverPv] = useState<Loc[] | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const n = board.moves.length;
  const toPlay = toPlayAt(board);
  const withStones = hasPosition(board);

  // The position on the board, read by KataGo for the eval bar and the best moves.
  const position = useMemo(() => (withStones && !preview ? explainPositionOf(board) : null), [board, preview, withStones]);
  const { read, last, pending } = useBoardRead(position);

  // Every position along the game, read quickly while a trend tab is open.
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
      return { size: preview.base.size, stones: b.stones, captures: undefined, last: lastLoc, marks, variation: preview.line as Move[] | null };
    }
    const b = replay(board.size, board.setup, board.moves, board.cursor);
    const lastLoc = board.cursor ? board.moves[board.cursor - 1].loc : null;
    return { size: board.size, stones: b.stones, captures: b.captures, last: lastLoc, marks: [] as Mark[], variation: null as Move[] | null };
  }, [board, preview]);

  // The eval bar shows the last number while a new one loads, and the move before's change.
  const evalRead = read ?? last;
  const lastMover = !preview && board.cursor > 0 ? board.moves[board.cursor - 1].color : null;
  const prev = !preview && board.cursor > 0 ? cachedRead(explainPositionOf(board, board.cursor - 1)) : undefined;
  const before = lastMover && prev ? { mover: lastMover, bWin: prev.bWin, bLead: prev.bLead } : null;

  const hovered = !preview && hoverPv?.length ? lineOf(hoverPv, toPlay) : null;
  const variation = preview ? view.variation : hovered;
  const candidates = !preview && bestOn && read ? candidateMarks(read.candidates) : null;
  const ownership = !preview && territoryOn && read ? read.ownership : null;

  const play = (loc: Loc) => {
    setHoverPv(null);
    onPlay(loc);
  };
  const go = (pos: number) => {
    setHoverPv(null);
    onBoard(goTo(board, pos));
  };

  const caption = preview
    ? preview.title
    : `${board.cursor ? `Move ${board.cursor}${n > board.cursor ? ` of ${n}` : ''}` : n ? `Start of ${n} moves` : 'Empty board'} · ${colorName(toPlay)} to play${board.cursor && board.moves[board.cursor - 1].loc === PASS ? ' (last move passed)' : ''}`;

  const report = {
    values: lineReads.values,
    moves: board.moves,
    size: board.size,
    black: board.black ?? 'Black',
    white: board.white ?? 'White',
    cursor: board.cursor,
    onPick: go,
    progress: (
      <span>
        Reading the game… {lineReads.done}/{lineReads.total}
      </span>
    ),
  };
  let panel: ReactNode = null;
  if (!preview && tab && n) {
    if (tab === 'trend') panel = <TrendPanel {...report} />;
    else if (tab === 'blunder') panel = <BlunderPanel {...report} />;
    else if (tab === 'performance') panel = <PerformancePanel {...report} />;
  }

  const tools: ScreenTool[] = [
    { id: 'best', label: 'Best moves', icon: 'target', on: bestOn, onClick: () => setBestOn((v) => !v), disabled: !withStones },
    { id: 'territory', label: 'Territory', icon: 'territory', on: territoryOn, onClick: () => setTerritoryOn((v) => !v), disabled: !withStones },
    { id: 'pass', label: 'Pass', icon: 'pass', onClick: () => play(PASS) },
    { id: 'undo', label: 'Undo', icon: 'back', onClick: onUndo, disabled: !board.cursor },
    { id: 'paste', label: 'Paste', icon: 'pen', on: paste !== null, onClick: () => setPaste(paste === null ? '' : null) },
    { id: 'open', label: 'Open', icon: 'upload', onClick: () => file.current?.click() },
    { id: 'new', label: 'New', icon: 'plus', on: sizes, onClick: () => setSizes((s) => !s) },
  ];

  return (
    <section className={`board-panel${preview ? ' previewing' : ''}`} aria-label="Board">
      <div className="bp-head">
        <span className="bp-caption">
          {board.title && !preview && <span className="bp-title">{board.title}</span>}
          {caption}
        </span>
        {preview?.pinned && (
          <button className="icon-btn sm" aria-label="Back to the board" onClick={onClearPreview}>
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
      <div className="kami-bscreen">
        <PlayersBar
          black={board.black ?? ''}
          white={board.white ?? ''}
          captures={view.captures}
          showEval={!preview && withStones}
          bWin={evalRead?.bWin ?? null}
          bLead={evalRead?.bLead ?? null}
          pending={pending}
          before={before}
        />
        <div className="bs-board">
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
            coords
            ariaLabel={preview ? `Variation: ${preview.title}` : 'Board: click to play'}
          />
        </div>
        {preview && <p className="bp-note">{preview.note || (preview.pinned ? 'Tap the board to go back.' : '')}</p>}
        {!preview && <Stepper pos={board.cursor} total={n} onGo={go} />}
        {!preview && n > 0 && (
          <div className="bs-tabs" role="tablist" style={{ gridTemplateColumns: `repeat(${LINE_TABS.length}, minmax(0, 1fr))` }}>
            {LINE_TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(tab === t.id ? null : t.id)}>
                <DopIcon name={t.icon} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        )}
        {panel && <div className="bs-panel">{panel}</div>}
        {!preview && (
          <div className="bs-tools" role="toolbar" aria-label="Board tools">
            {tools.map((t) => (
              <button key={t.id} className={t.on ? 'on' : ''} onClick={t.onClick} disabled={t.disabled} aria-pressed={t.on ?? undefined} title={t.title ?? t.label}>
                <DopIcon name={t.icon} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        )}
        {sizes && !preview && (
          <div className="bs-tools kami-sizes" role="group" aria-label="New board size">
            {SIZES.map((s) => (
              <button
                key={s}
                onClick={() => {
                  onBoard(emptyBoard(s));
                  setSizes(false);
                }}
              >
                <span>
                  {s}×{s}
                </span>
              </button>
            ))}
          </div>
        )}
        {paste !== null && !preview && (
          <form
            className="paste"
            onSubmit={(e) => {
              e.preventDefault();
              if (onSgfText(paste)) setPaste(null);
            }}
          >
            <textarea autoFocus value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="(;GM[1]SZ[19];B[pd];W[dp]...)" aria-label="SGF text" rows={3} />
            <div className="paste-row">
              <button type="button" className="text-btn" onClick={() => setPaste(null)}>
                Cancel
              </button>
              <button type="submit" className="pill" disabled={!paste.trim()}>
                Load
              </button>
            </div>
          </form>
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
      </div>
      {status.state !== 'idle' && (
        <p className={`engine-status ${status.state}`}>
          {status.text}
          {status.state === 'loading' && status.pct !== undefined ? ` ${status.pct}%` : ''}
        </p>
      )}
    </section>
  );
}
