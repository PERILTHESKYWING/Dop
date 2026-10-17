import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { KAMI_VERSION } from '../../../src/lib/coach/explain/types';
import { engineStatus, onEngineStatus } from '../lib/engine';
import { GROUPS, resetSettings, setSetting, SETTINGS, useSetting, type SettingDef, type SettingGroup } from '../lib/settings';
import type { Conversation } from '../lib/store';
import { resetStyle, STYLE_LABELS, STYLE_MIN, useLearnedStyle } from '../lib/style';
import { Icon } from './Icon';

export type SettingsPage = SettingGroup | 'usage' | 'data' | 'about';

const PAGES: { id: SettingsPage; label: string; icon: string }[] = [
  { id: 'general', label: 'General', icon: 'user' },
  { id: 'profile', label: 'Profile', icon: 'profile' },
  { id: 'board', label: 'Board', icon: 'board' },
  { id: 'katago', label: 'KataGo', icon: 'spark' },
  { id: 'positions', label: 'Positions', icon: 'stones' },
  { id: 'usage', label: 'Usage', icon: 'usage' },
  { id: 'data', label: 'Data', icon: 'folder' },
  { id: 'about', label: 'About', icon: 'info' },
];

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

/** A number box that only commits a value when it is a number (on blur or Enter). */
function NumberBox({
  value,
  min,
  max,
  step,
  onChange,
  unit,
  label,
  pct,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  unit?: string;
  label: string;
  pct?: boolean;
}) {
  const shown = pct ? Math.round(value * 100) : value;
  const [text, setText] = useState(String(shown));
  useEffect(() => setText(String(shown)), [shown]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() === '' || !Number.isFinite(n)) return setText(String(shown));
    onChange(pct ? n / 100 : n);
  };
  return (
    <span className="numbox">
      <input
        type="number"
        inputMode="decimal"
        aria-label={label}
        value={text}
        min={pct ? min * 100 : min}
        max={pct ? max * 100 : max}
        step={pct ? (step ?? 0.01) * 100 : step}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      {(pct || unit) && <span className="unit">{pct ? '%' : unit}</span>}
    </span>
  );
}

function Row({ def }: { def: SettingDef }) {
  const v = useSetting(def.key);
  const set = (x: boolean | number | string) => setSetting(def.key, x);
  let control;
  switch (def.type) {
    case 'toggle':
      control = <Toggle on={v as boolean} onChange={set} label={def.label} />;
      break;
    case 'number':
      control = <NumberBox value={v as number} min={def.min} max={def.max} step={def.step} unit={def.unit} onChange={set} label={def.label} />;
      break;
    case 'percent':
      control = (
        <span className="range-row">
          <input
            type="range"
            aria-hidden="true"
            tabIndex={-1}
            min={def.min * 100}
            max={def.max * 100}
            step={(def.step ?? 0.01) * 100}
            value={Math.round((v as number) * 100)}
            onChange={(e) => set(Number(e.target.value) / 100)}
          />
          <NumberBox pct value={v as number} min={def.min} max={def.max} step={def.step} onChange={set} label={def.label} />
        </span>
      );
      break;
    case 'select':
      control =
        def.options.length <= 3 ? (
          <span className="seg" role="radiogroup" aria-label={def.label}>
            {def.options.map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={v === o.value} className={v === o.value ? 'on' : ''} onClick={() => set(o.value)}>
                {o.label.replace(/ \(.*\)$/, '')}
              </button>
            ))}
          </span>
        ) : (
          <select aria-label={def.label} value={v as string} onChange={(e) => set(e.target.value)}>
            {def.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      break;
    case 'text':
      control = <input className="textbox" type="text" aria-label={def.label} value={v as string} maxLength={def.maxLength} placeholder={def.placeholder} onChange={(e) => set(e.target.value)} />;
      break;
  }
  const options = def.type === 'select' && def.options.length <= 3 && def.options.some((o) => / \(.*\)$/.test(o.label));
  return (
    <div className={`set-row${def.type === 'text' ? ' stack' : ''}`}>
      <div className="set-text">
        <div className="set-label">{def.label}</div>
        {def.help && <div className="set-help">{def.help}</div>}
        {options && def.type === 'select' && (
          <div className="set-help">
            {def.options
              .filter((o) => / \(.*\)$/.test(o.label))
              .map((o) => o.label)
              .join(' · ')}
          </div>
        )}
      </div>
      <div className="set-control">{control}</div>
    </div>
  );
}

function GroupPage({ group, extra }: { group: SettingGroup; extra?: ReactNode }) {
  const g = GROUPS.find((x) => x.id === group)!;
  const defs = SETTINGS.filter((d) => d.group === group);
  return (
    <>
      <p className="set-blurb">{g.blurb}</p>
      <div className="set-list">
        {defs.map((d) => (
          <Row key={d.key} def={d} />
        ))}
        {extra}
      </div>
      <button type="button" className="text-btn reset" onClick={() => resetSettings(group)}>
        Reset {g.label.toLowerCase()} to defaults
      </button>
    </>
  );
}

/** Settings › Profile: level and style, and the style Kami has learned from the student's moves. */
function ProfilePage() {
  const learned = useLearnedStyle();
  const chosen = useSetting<string>('profile.style');
  const label = learned.style ? `Kiai’s guess: ${STYLE_LABELS[learned.style]}` : 'Kiai’s guess: not sure yet';
  const help = learned.style
    ? `From ${learned.total} of your moves (${learned.count} of them ${STYLE_LABELS[learned.style].toLowerCase()}).`
    : learned.total < STYLE_MIN
      ? `${learned.total ? `${learned.total} of your moves so far. ` : ''}Kiai guesses after ${STYLE_MIN} moves you play on the board, never from one move or from games you load.`
      : `From ${learned.total} of your moves, no style stands out yet.`;
  return (
    <GroupPage
      group="profile"
      extra={
        <div className="set-row">
          <div className="set-text">
            <div className="set-label">{label}</div>
            <div className="set-help">
              {help}
              {chosen !== 'auto' && ' Your choice above is used instead.'}
            </div>
          </div>
          <div className="set-control">
            <button type="button" className="btn" onClick={resetStyle} disabled={!learned.total}>
              Reset
            </button>
          </div>
        </div>
      }
    />
  );
}

function UsagePage({ convs, llmOn }: { convs: Conversation[]; llmOn: boolean | null }) {
  const status = useSyncExternalStore(onEngineStatus, engineStatus);
  const [bytes, setBytes] = useState<{ used: number; quota: number } | null>(null);
  useEffect(() => {
    navigator.storage
      ?.estimate?.()
      .then((e) => e.usage !== undefined && e.quota !== undefined && setBytes({ used: e.usage, quota: e.quota }))
      .catch(() => undefined);
  }, []);
  const chats = convs.filter((c) => c.messages.length);
  const asked = chats.reduce((n, c) => n + c.messages.filter((m) => m.role === 'user').length, 0);
  const mb = (b: number) => `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} MB`;
  const stats: [string, string][] = [
    ['Chats', String(chats.length)],
    ['Questions asked', String(asked)],
    ['KataGo', status.state === 'idle' ? 'Starts with your first position' : status.text],
    ['Gemini wording (Abyss)', llmOn === null ? 'Checking…' : llmOn ? 'On, free tier' : 'Off on this site: answers use engine text'],
  ];
  if (bytes) stats.push(['Stored in this browser', `${mb(bytes.used)} of ${mb(bytes.quota)}`]);
  return (
    <>
      <p className="set-blurb">Kiai runs KataGo on your device, so reading positions has no limit. Only Abyss’s wording calls Gemini, once per answer.</p>
      <dl className="stats">
        {stats.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {bytes && (
        <div className="meter" aria-hidden="true">
          <span
            style={{
              width: `${Math.max(1, Math.min(100, (100 * bytes.used) / bytes.quota))}%`,
            }}
          />
        </div>
      )}
    </>
  );
}

function DataPage({ convs, onDeleteAll }: { convs: Conversation[]; onDeleteAll: () => void }) {
  const [sure, setSure] = useState(false);
  const chats = convs.filter((c) => c.messages.length);
  const exportChats = () => {
    const blob = new Blob([JSON.stringify(chats, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kami-chats-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <>
      <p className="set-blurb">Chats, boards and settings are kept in this browser only. Nothing is uploaded.</p>
      <div className="set-list">
        <div className="set-row">
          <div className="set-text">
            <div className="set-label">Export chats</div>
            <div className="set-help">Every chat and its board, as one JSON file.</div>
          </div>
          <div className="set-control">
            <button type="button" className="btn" onClick={exportChats} disabled={!chats.length}>
              <Icon name="download" size={16} />
              Export
            </button>
          </div>
        </div>
        <div className="set-row">
          <div className="set-text">
            <div className="set-label">Delete all chats</div>
            <div className="set-help">This can’t be undone.</div>
          </div>
          <div className="set-control">
            {sure ? (
              <span className="confirm-row">
                <button type="button" className="btn" onClick={() => setSure(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => {
                    onDeleteAll();
                    setSure(false);
                  }}
                >
                  Delete {chats.length}
                </button>
              </span>
            ) : (
              <button type="button" className="btn danger-outline" onClick={() => setSure(true)} disabled={!chats.length}>
                Delete all
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function AboutPage() {
  return (
    <div className="about">
      <p>
        <strong>Kiai {KAMI_VERSION}</strong> is a Go analyst you can talk to. KataGo reads every position in your browser, and Kiai explains what the reading shows. When Kiai sets up a position to explain an idea,
        KataGo checks it before you see it.
      </p>
      <p>Skim and Dive answer from KataGo alone. Abyss asks Gemini to word the answer, then checks every number and move against KataGo’s facts.</p>
      <p className="set-help">Built on Dop. KataGo by David Wu (MIT). See the third-party notices for networks and libraries.</p>
    </div>
  );
}

export function Settings({
  page,
  onPage,
  onClose,
  convs,
  llmOn,
  onDeleteAll,
}: {
  page: SettingsPage;
  onPage: (p: SettingsPage) => void;
  onClose: () => void;
  convs: Conversation[];
  llmOn: boolean | null;
  onDeleteAll: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', esc);
    card.current?.focus();
    return () => document.removeEventListener('keydown', esc);
  }, []);
  const current = PAGES.find((p) => p.id === page) ?? PAGES[0];
  return (
    <div className="modal-wrap" role="presentation" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings" role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1} ref={card}>
        <header className="modal-head">
          <h2>Settings</h2>
          <button type="button" className="icon-btn" aria-label="Close settings" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>
        <div className="settings-body">
          <nav className="set-nav" aria-label="Settings pages">
            {PAGES.map((p) => (
              <button key={p.id} type="button" className={p.id === current.id ? 'on' : ''} aria-current={p.id === current.id ? 'page' : undefined} onClick={() => onPage(p.id)}>
                <Icon name={p.icon} size={17} />
                {p.label}
              </button>
            ))}
          </nav>
          <section className="set-page" aria-label={current.label}>
            <h3>{current.label}</h3>
            {current.id === 'usage' ? (
              <UsagePage convs={convs} llmOn={llmOn} />
            ) : current.id === 'data' ? (
              <DataPage convs={convs} onDeleteAll={onDeleteAll} />
            ) : current.id === 'about' ? (
              <AboutPage />
            ) : current.id === 'profile' ? (
              <ProfilePage />
            ) : (
              <GroupPage group={current.id} />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
