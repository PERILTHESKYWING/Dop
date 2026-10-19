import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ThinkingLevel } from '../../../src/lib/coach/explain/types';
import { useSetting } from '../lib/settings';
import type { PickId, Tier } from '../lib/writer';
import { Icon } from './Icon';

const LEVELS: { id: ThinkingLevel; name: string; blurb: string }[] = [
  { id: 'off', name: 'Off', blurb: 'No extra reading. Fastest.' },
  { id: 'low', name: 'Low', blurb: 'A little extra reading.' },
  { id: 'medium', name: 'Medium', blurb: 'Reads the most likely moves.' },
  { id: 'high', name: 'High', blurb: 'Reads more moves. Slowest.' },
];

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
  tiers: Tier[];
  tier: Tier;
  onPick: (id: PickId) => void;
  thinking: ThinkingLevel;
  onThinking: (t: ThinkingLevel) => void;
  running: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function Composer({ value, onChange, tiers, tier, onPick, thinking, onThinking, running, onSend, onStop }: Props) {
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
          className="pick-menu"
          label={
            <>
              Depth: {tier.name}
            </>
          }
        >
          {(close) => [
            <div key="head" className="menu-head">Depth: how long KataGo reads</div>,
            ...tiers.map((t) => (
              <button
                key={t.id}
                type="button"
                role="menuitemradio"
                aria-checked={t.id === tier.id}
                className="menu-item"
                onClick={() => {
                  onPick(t.id);
                  close();
                }}
              >
                <span className="mi-main">
                  <span className="mi-name">
                    {t.name}
                    {t.id === 'tesuji' && <span className="mi-tag">Recommended</span>}
                  </span>
                  <span className="mi-blurb">{t.blurb}</span>
                </span>
                {t.id === tier.id && <Icon name="check" size={16} />}
              </button>
            )),
          ]}
        </Menu>
        <Menu className="think-menu" label={<>Thinking: {LEVELS.find((l) => l.id === thinking)?.name}</>}>
          {(close) => [
            <div key="head" className="menu-head">Thinking: how much extra reading Kiai does</div>,
            ...LEVELS.map((l) => (
              <button
                key={l.id}
                type="button"
                role="menuitemradio"
                aria-checked={l.id === thinking}
                className="menu-item"
                onClick={() => {
                  onThinking(l.id);
                  close();
                }}
              >
                <span className="mi-main">
                  <span className="mi-name">
                    {l.name}
                    {l.id === 'medium' && <span className="mi-tag">Recommended</span>}
                  </span>
                  <span className="mi-blurb">{l.blurb}</span>
                </span>
                {l.id === thinking && <Icon name="check" size={16} />}
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
