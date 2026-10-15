import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Board, type Mark } from '../../../src/components/Board';
import type { ExplainPosition } from '../../../src/lib/coach/explain/types';
import { replay } from '../../../src/lib/go/board';
import { colorName, PASS, type Loc, type Move } from '../../../src/lib/go/types';
import { engineStatus, onEngineStatus } from '../lib/engine';
import { emptyBoard, goTo, stonesOf, toPlayAt, type BoardState } from '../lib/position';
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

export function BoardPanel({ board, preview, onBoard, onPlay, onUndo, onClearPreview, onSgfText, onSgfFile }: Props) {
  const status = useSyncExternalStore(onEngineStatus, engineStatus);
  const [paste, setPaste] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const view = useMemo(() => {
    if (preview) {
      const b = replay(preview.base.size, preview.base.setup, preview.base.moves);
      const last = preview.base.moves.length ? preview.base.moves[preview.base.moves.length - 1].loc : null;
      const marks: Mark[] = preview.highlight.filter((l) => l !== PASS).map((loc) => ({ loc, kind: 'evidence' }));
      return { size: preview.base.size, stones: b.stones, last, marks, variation: preview.line };
    }
    const last = board.cursor ? board.moves[board.cursor - 1].loc : null;
    return { size: board.size, stones: stonesOf(board), last, marks: [] as Mark[], variation: null };
  }, [board, preview]);

  const toPlay = toPlayAt(board);
  const n = board.moves.length;
  const lastWasPass = board.cursor > 0 && board.moves[board.cursor - 1].loc === PASS;
  const caption = preview
    ? preview.title
    : `${board.cursor ? `Move ${board.cursor}${n > board.cursor ? ` of ${n}` : ''}` : n ? `Start of ${n} moves` : 'Empty board'} · ${colorName(toPlay)} to play${lastWasPass ? ' (last move passed)' : ''}`;

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
      <div className="board-wrap">
        <Board
          size={view.size}
          stones={view.stones}
          lastMove={view.last}
          toPlay={preview ? undefined : toPlay}
          onPlay={onPlay}
          marks={view.marks}
          variation={view.variation}
          coords
          ariaLabel={preview ? `Variation: ${preview.title}` : 'Board: click to play'}
        />
      </div>
      {/* Same height as the tools row it replaces, so the chat below does not jump. */}
      {preview && <p className="bp-note">{preview.note || (preview.pinned ? 'Tap the board to go back.' : '')}</p>}
      {!preview && (
        <div className="bp-tools">
          <button className="icon-btn" aria-label="First move" disabled={!board.cursor} onClick={() => onBoard(goTo(board, 0))}>
            <Icon name="first" />
          </button>
          <button className="icon-btn" aria-label="Previous move" disabled={!board.cursor} onClick={() => onBoard(goTo(board, board.cursor - 1))}>
            <Icon name="prev" />
          </button>
          <button className="icon-btn" aria-label="Next move" disabled={board.cursor >= n} onClick={() => onBoard(goTo(board, board.cursor + 1))}>
            <Icon name="next" />
          </button>
          <button className="icon-btn" aria-label="Last move" disabled={board.cursor >= n} onClick={() => onBoard(goTo(board, n))}>
            <Icon name="last" />
          </button>
          <span className="sep" />
          <button className="icon-btn" aria-label="Undo" title="Undo" disabled={!board.cursor} onClick={onUndo}>
            <Icon name="undo" />
          </button>
          <button className="text-btn" onClick={() => onPlay(PASS)}>
            Pass
          </button>
          <span className="grow" />
          <button className="text-btn" aria-label="Paste SGF" onClick={() => setPaste(paste === null ? '' : null)}>
            <Icon name="paste" size={16} />
            <span className="lbl">Paste SGF</span>
          </button>
          <button className="text-btn" aria-label="Open SGF file" onClick={() => file.current?.click()}>
            <Icon name="upload" size={16} />
            <span className="lbl">Open</span>
          </button>
          <div className="menu">
            <button className="icon-btn" aria-label="New board" aria-expanded={more} onClick={() => setMore((m) => !m)}>
              <Icon name="more" />
            </button>
            {more && (
              <div className="menu-pop down" role="menu" onMouseLeave={() => setMore(false)}>
                {[19, 13, 9].map((s) => (
                  <button
                    key={s}
                    className="menu-item"
                    role="menuitem"
                    onClick={() => {
                      onBoard(emptyBoard(s));
                      setMore(false);
                    }}
                  >
                    New {s}×{s} board
                  </button>
                ))}
              </div>
            )}
          </div>
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
      {status.state !== 'idle' && (
        <p className={`engine-status ${status.state}`}>
          {status.text}
          {status.state === 'loading' && status.pct !== undefined ? ` ${status.pct}%` : ''}
        </p>
      )}
    </section>
  );
}
