import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icons';

/**
 * A settings panel that drops down from the top right corner, like the iPhone's Control
 * Center: rounded tiles grouped into sections over a blurred backdrop. Opened from a gear
 * button; Esc, the backdrop or the close button put it away.
 */
export function ControlSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  // Keep it mounted while it animates out.
  const [state, setState] = useState<'closed' | 'open' | 'closing'>(open ? 'open' : 'closed');
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) setState('open');
    else setState((s) => (s === 'open' ? 'closing' : s));
  }, [open]);
  useEffect(() => {
    if (state === 'closing') {
      const t = setTimeout(() => setState('closed'), 260);
      return () => clearTimeout(t);
    }
    if (state !== 'open') return;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [state, onClose]);
  if (state === 'closed') return null;
  // Rendered at the app's root, so no transformed or blurred ancestor can move or clip it.
  return createPortal(
    <div className={`csheet-wrap ${state}`}>
      <div className="csheet-backdrop" onClick={onClose} />
      <div className="csheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panel}>
        <div className="csheet-head">
          <strong>{title}</strong>
          <button className="csheet-close" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="csheet-body">{children}</div>
      </div>
    </div>,
    document.querySelector('.app') ?? document.body,
  );
}

/** A labelled group of tiles in a ControlSheet. */
export function SheetSection({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`csheet-section ${wide ? 'wide' : ''}`}>
      <h4>{title}</h4>
      <div className="csheet-tiles">{children}</div>
    </section>
  );
}

/** A round-cornered toggle tile: lit when on. */
export function ToggleTile({ on, onChange, label, sub, icon }: { on: boolean; onChange: (v: boolean) => void; label: string; sub?: string; icon?: ReactNode }) {
  return (
    <button className={`ctile toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      {icon && <span className="ctile-ico">{icon}</span>}
      <span className="ctile-text">
        <strong>{label}</strong>
        {sub && <span>{sub}</span>}
      </span>
    </button>
  );
}

/** An action tile (a button or a link). */
export function ActionTile({ onClick, href, label, sub, icon, primary, disabled }: { onClick?: () => void; href?: string; label: string; sub?: string; icon?: ReactNode; primary?: boolean; disabled?: boolean }) {
  const inner = (
    <>
      {icon && <span className="ctile-ico">{icon}</span>}
      <span className="ctile-text">
        <strong>{label}</strong>
        {sub && <span>{sub}</span>}
      </span>
    </>
  );
  return href ? (
    <a className={`ctile action ${primary ? 'primary' : ''}`} href={href}>
      {inner}
    </a>
  ) : (
    <button className={`ctile action ${primary ? 'primary' : ''}`} onClick={onClick} disabled={disabled}>
      {inner}
    </button>
  );
}

/** A tile holding any control (a select, a slider…), spanning the full width. */
export function FieldTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ctile field">
      <span className="ctile-label">{label}</span>
      <div className="ctile-control">{children}</div>
    </div>
  );
}

/** The gear button that opens a ControlSheet. */
export function GearButton({ onClick, label = 'Settings' }: { onClick: () => void; label?: string }) {
  return (
    <button className="gear-btn" onClick={onClick} aria-label={label} title={label}>
      <Icon name="gear" />
    </button>
  );
}

/**
 * Black and White's names, shown plainly; the pen turns them into fields, and ✓ (or Enter)
 * keeps the change. `onSave` is left out where the names can't be edited.
 */
export function PlayerNames({ black, white, onSave, extra }: { black: string; white: string; onSave?: (black: string, white: string) => void; extra?: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [b, setB] = useState(black);
  const [w, setW] = useState(white);
  useEffect(() => {
    if (!editing) {
      setB(black);
      setW(white);
    }
  }, [black, white, editing]);
  const done = () => {
    onSave?.(b.trim() || 'Black', w.trim() || 'White');
    setEditing(false);
  };
  if (editing)
    return (
      <form
        className="player-names editing"
        onSubmit={(e) => {
          e.preventDefault();
          done();
        }}
      >
        <label>
          <i className="stone-dot b" />
          <input value={b} onChange={(e) => setB(e.target.value)} aria-label="Black player" autoFocus />
        </label>
        <label>
          <i className="stone-dot w" />
          <input value={w} onChange={(e) => setW(e.target.value)} aria-label="White player" />
        </label>
        <button type="submit" className="pen-btn on" aria-label="Save names" title="Save">
          <Icon name="check" />
        </button>
      </form>
    );
  return (
    <div className="player-names">
      <span className="pn">
        <i className="stone-dot b" /> <strong>{black || 'Black'}</strong>
      </span>
      <span className="pn-vs">vs</span>
      <span className="pn">
        <i className="stone-dot w" /> <strong>{white || 'White'}</strong>
      </span>
      {onSave && (
        <button className="pen-btn" onClick={() => setEditing(true)} aria-label="Edit names" title="Edit names">
          <Icon name="pen" />
        </button>
      )}
      {extra}
    </div>
  );
}

/** A "go back" arrow: to `href`, or one step back in history. */
export function BackLink({ href, label = 'Back' }: { href?: string; label?: string }) {
  return (
    <a
      className="back-link"
      href={href ?? '#'}
      onClick={(e) => {
        if (href) return;
        e.preventDefault();
        history.back();
      }}
      title={label}
    >
      <Icon name="back" />
      <span>{label}</span>
    </a>
  );
}
