import { useEffect, useRef, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icons';
import { fmtPct } from './common';
import { href } from '../router';
import './boardscreen.css';

/**
 * The one layout every board uses, after Fox's game screens: a Home button and the page's
 * own buttons on top, the players and the evaluation bar above the board, the board as
 * big as the screen allows, plain step buttons under it, then the tabs (Data, Trend,
 * Blunder, Performance), the open tab's panel and a row of tools. Nothing is ever drawn
 * over the board except a `notice` (saving, or leaving without saving). No sidebar, no
 * tab bar and no app name: App.tsx hides them while a `.bscreen` is on the page.
 */

export interface ScreenTab {
  id: string;
  label: string;
  icon: IconName;
}

export interface ScreenTool {
  id: string;
  label: string;
  icon: IconName;
  onClick: () => void;
  on?: boolean;
  disabled?: boolean;
  title?: string;
}

export interface StepperProps {
  /** Moves from the start along the line shown. */
  pos: number;
  total: number;
  onGo: (pos: number) => void;
  /** Extra buttons at the end of the row (Study's delete-from-here). */
  extra?: ReactNode;
}

export function BoardScreen({
  className,
  title,
  sub,
  onHome,
  homeHref = href('dashboard'),
  homeLabel = 'Home',
  head,
  players,
  board,
  boardRef,
  steps,
  tabs,
  tab,
  onTab,
  panel,
  tools,
  notice,
}: {
  className?: string;
  title?: ReactNode;
  sub?: ReactNode;
  /** Called instead of following the Home link, e.g. to ask about unsaved work first. */
  onHome?: () => void;
  homeHref?: string;
  homeLabel?: string;
  /** Buttons at the right of the top row (Save). */
  head?: ReactNode;
  /** The players and the evaluation bar, above the board. */
  players?: ReactNode;
  board: ReactNode;
  boardRef?: Ref<HTMLDivElement>;
  steps?: StepperProps | null;
  tabs?: ScreenTab[] | null;
  tab?: string | null;
  onTab?: (id: string | null) => void;
  panel?: ReactNode;
  tools?: ScreenTool[] | null;
  notice?: ReactNode;
}) {
  return (
    <div className={`bscreen ${className ?? ''}`}>
      <header className="bs-head">
        <a
          className="bs-btn bs-home"
          href={homeHref}
          onClick={(e) => {
            if (onHome) {
              e.preventDefault();
              onHome();
            }
          }}
        >
          <Icon name="home" />
          <span>{homeLabel}</span>
        </a>
        <div className="bs-title">
          {title && <strong>{title}</strong>}
          {sub && <span>{sub}</span>}
        </div>
        {head && <div className="bs-head-right">{head}</div>}
      </header>
      <div className="bs-main">
        {players}
        <div className="bs-board" ref={boardRef}>
          {board}
        </div>
        {steps && <Stepper {...steps} />}
      </div>
      <div className="bs-side">
        {tabs && tabs.length > 0 && (
          <div className="bs-tabs" role="tablist" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
            {tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => onTab?.(tab === t.id ? null : t.id)}>
                <Icon name={t.icon} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        )}
        {panel && <div className="bs-panel">{panel}</div>}
        {tools && tools.length > 0 && (
          <div className="bs-tools" role="toolbar">
            {tools.map((t) => (
              <button key={t.id} className={t.on ? 'on' : ''} onClick={t.onClick} disabled={t.disabled} aria-pressed={t.on ?? undefined} title={t.title}>
                <Icon name={t.icon} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {notice}
    </div>
  );
}

/** A plain button for the top row (Save, and the like). */
export function HeadButton({ icon, label, onClick, on, disabled, title }: { icon: IconName; label: string; onClick: () => void; on?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button className={`bs-btn ${on ? 'on' : ''}`} onClick={onClick} disabled={disabled} title={title} aria-pressed={on ?? undefined}>
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
}

/** Slider, ⏮ ◀ ▶ ⏭ and the move count: plain buttons, no animation. */
export function Stepper({ pos, total, onGo, extra }: StepperProps) {
  const go = (p: number) => onGo(Math.max(0, Math.min(total, p)));
  return (
    <div className="bs-steps" role="group" aria-label="Move through the game">
      <input type="range" min={0} max={Math.max(total, 0)} value={pos} onChange={(e) => go(Number(e.target.value))} aria-label="Move" disabled={total === 0} />
      <div className="bs-step-btns">
        <button onClick={() => go(0)} disabled={pos <= 0} aria-label="First move" title="Start (Home)">
          <StepGlyph kind="first" />
        </button>
        <button onClick={() => go(pos - 1)} disabled={pos <= 0} aria-label="Previous move" title="Back (←)">
          <StepGlyph kind="back" />
        </button>
        <button onClick={() => go(pos + 1)} disabled={pos >= total} aria-label="Next move" title="Forward (→)">
          <StepGlyph kind="forward" />
        </button>
        <button onClick={() => go(total)} disabled={pos >= total} aria-label="Last move" title="End (End)">
          <StepGlyph kind="last" />
        </button>
        {extra}
        <span className="bs-count mono">
          {pos}/{total}
        </span>
      </div>
    </div>
  );
}

function StepGlyph({ kind }: { kind: 'first' | 'back' | 'forward' | 'last' }) {
  const flip = kind === 'first' || kind === 'back';
  return (
    <svg viewBox="0 0 24 24" aria-hidden style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M7 4.5 18 12 7 19.5z" fill="currentColor" />
      {(kind === 'first' || kind === 'last') && <rect x="18.5" y="4.5" width="2.6" height="15" rx="1" fill="currentColor" />}
    </svg>
  );
}

/**
 * Names, captures and (when analysis is on) the Black/White winrate bar, as Fox shows them
 * above the board.
 */
export function PlayersBar({
  black,
  white,
  captures,
  bWin,
  bLead,
  pending,
  showEval,
  black2,
  white2,
}: {
  black: string;
  white: string;
  /** Stones each side has captured: [unused, black's, white's], as Board.captures. */
  captures?: readonly number[];
  bWin?: number | null;
  bLead?: number | null;
  pending?: boolean;
  showEval?: boolean;
  /** Small text under a name (rank, "you"). */
  black2?: ReactNode;
  white2?: ReactNode;
}) {
  const b = bWin ?? 0.5;
  return (
    <div className="bs-players">
      <div className="bs-names">
        <span className="bs-name">
          <i className="stone-dot b" />
          <span>
            <strong>{black || 'Black'}</strong>
            {black2 && <small>{black2}</small>}
          </span>
        </span>
        {captures && (
          <span className="bs-caps mono" title="Stones captured">
            {captures[1] ?? 0} <small>captures</small> {captures[2] ?? 0}
          </span>
        )}
        <span className="bs-name w">
          <span>
            <strong>{white || 'White'}</strong>
            {white2 && <small>{white2}</small>}
          </span>
          <i className="stone-dot w" />
        </span>
      </div>
      {showEval && (
        <div className={`bs-eval ${pending ? 'pending' : ''}`} aria-label={bWin == null ? 'Winrate unknown' : `Black ${fmtPct(b, 1)}, White ${fmtPct(1 - b, 1)}`}>
          <span className="bs-eval-b" style={{ width: `${b * 100}%` }}>
            {bWin == null ? '…' : fmtPct(b, 1)}
          </span>
          <span className="bs-eval-w">{bWin == null ? '…' : fmtPct(1 - b, 1)}</span>
          {bLead != null && <span className="bs-eval-lead mono">{`${bLead >= 0 ? 'B' : 'W'}+${Math.abs(bLead).toFixed(1)}`}</span>}
        </div>
      )}
    </div>
  );
}

/**
 * The one thing allowed over the board: a notice that asks something (save, or leave
 * without saving). Esc and the backdrop dismiss it.
 */
export function Notice({ title, children, actions, onClose }: { title: string; children?: ReactNode; actions: ReactNode; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('input, button.primary, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return createPortal(
    <div className="bs-notice-wrap">
      <div className="bs-notice-backdrop" onClick={onClose} />
      <div className="bs-notice" role="dialog" aria-modal="true" aria-label={title} ref={box}>
        <strong className="bs-notice-title">{title}</strong>
        {children && <div className="bs-notice-body">{children}</div>}
        <div className="bs-notice-actions">{actions}</div>
      </div>
    </div>,
    document.querySelector('.app') ?? document.body,
  );
}

/** Data, Trend, Blunder and Performance: the four report tabs every analysed board offers. */
export const REPORT_TABS: ScreenTab[] = [
  { id: 'data', label: 'Data', icon: 'data' },
  { id: 'trend', label: 'Trend', icon: 'trend' },
  { id: 'blunder', label: 'Blunder', icon: 'blunder' },
  { id: 'performance', label: 'Performance', icon: 'performance' },
];

/**
 * The top row for the practice boards (Forge, problem sets, blind tests), which keep their
 * own `.stage` layout: the same Home button, and no sidebar or app name around them.
 */
export function StageHead({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className="bs-head stage-head">
      <a className="bs-btn bs-home" href={href('dashboard')}>
        <Icon name="home" />
        <span>Home</span>
      </a>
      <div className="bs-title">
        <strong>{title}</strong>
      </div>
      {children && <div className="bs-head-right">{children}</div>}
    </header>
  );
}
