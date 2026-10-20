import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_LEVEL, levelById, type Level, type LevelId } from '../lib/levels';
import { useSetting } from '../lib/settings';
import { Icon } from './Icon';
import { LevelName } from './UltraGo';

/** A button with a small menu that opens above it. */
function Menu({ label, children, className }: { label: ReactNode; children: (close: () => void) => ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', off);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', off);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className={`menu ${className ?? ''}`} ref={ref}>
      <button type="button" className="menu-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
        <Icon name="down" size={14} />
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  levels: Level[];
  level: LevelId;
  onLevel: (id: LevelId) => void;
  running: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function Composer({ value, onChange, levels, level, onLevel, running, onSend, onStop }: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const enterSends = useSetting<boolean>('chat.enterSends');
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const submit = () => {
    if (!running && value.trim()) onSend(value);
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={ta}
        rows={1}
        value={value}
        placeholder="Ask about the board or a Go idea"
        aria-label="Message"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && (enterSends ? !e.shiftKey : e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer-row">
        <Menu
          className={`think-menu${level === 'ultrago' ? ' ultra' : ''}`}
          label={
            <>
              Thinking: <LevelName level={levelById(level)} />
            </>
          }
        >
          {(close) => [
            <div key="head" className="menu-head">Thinking: how long Kiai reads before it answers</div>,
            ...levels.map((l) => (
              <button
                key={l.id}
                type="button"
                role="menuitemradio"
                aria-checked={l.id === level}
                className={`menu-item${l.id === 'ultrago' ? ' ultra' : ''}`}
                onClick={() => {
                  onLevel(l.id);
                  close();
                }}
              >
                <span className="mi-main">
                  <span className="mi-name">
                    <LevelName level={l} />
                    {l.id === DEFAULT_LEVEL && <span className="mi-tag">Recommended</span>}
                  </span>
                  <span className="mi-blurb">{l.blurb}</span>
                </span>
                {l.id === level && <Icon name="check" size={16} />}
              </button>
            )),
          ]}
        </Menu>
        <span className="grow" />
        {running ? (
          <button type="button" className="send stop" aria-label="Stop" onClick={onStop}>
            <Icon name="stop" />
          </button>
        ) : (
          <button type="submit" className="send" aria-label="Send" disabled={!value.trim()}>
            <Icon name="send" />
          </button>
        )}
      </div>
    </form>
  );
}
