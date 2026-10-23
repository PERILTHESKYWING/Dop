import { useState } from 'react';
import type { Conversation } from '../lib/store';
import { useSetting } from '../lib/settings';
import { ago, useAccountView } from '../lib/accountView';
import { usePathLine } from '../lib/pathLine';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { Popover } from './Popover';
import type { SettingsPage } from './Settings';

const REPO = 'https://github.com/PERILTHESKYWING/Dop';

interface Props {
  convs: Conversation[];
  currentId: string;
  /** Wide screens: folded to a thin rail of icons. */
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onSettings: (page?: SettingsPage) => void;
}

/** The account button at the foot of the sidebar and the menu that opens above it. */
function Account({ compact, onSettings }: { compact: boolean; onSettings: (page?: SettingsPage) => void }) {
  const name = useSetting<string>('profile.name').trim();
  const shown = name || 'Guest';
  const initial = (shown.match(/\p{L}|\p{N}/u)?.[0] ?? 'K').toUpperCase();
  // The study path under the name (Settings › Journey), else "Synced" when signed in.
  const line = usePathLine();
  const pathOn = useSetting<boolean>('journey.on');
  const pathShown = useSetting<boolean>('journey.sidebar');
  const acct = useAccountView();
  const plan = pathOn && pathShown && line ? line : acct.signedIn ? 'Synced' : 'Free · on this device';
  const head = acct.signedIn && acct.email ? `${acct.email}${acct.lastSync ? ` · synced ${ago(acct.lastSync, Date.now(), true)}` : ''}` : name ? `${shown} · this browser` : 'Guest · saved in this browser';
  return (
    <Popover
      className="account"
      place="up-stretch"
      label="Account"
      trigger={({ open, toggle }) => (
        <button type="button" className={`account-btn${open ? ' on' : ''}`} onClick={toggle} aria-haspopup="menu" aria-expanded={open} title={compact ? `${shown} · ${plan}` : undefined}>
          <span className="avatar" aria-hidden="true">
            {initial}
          </span>
          {!compact && (
            <>
              <span className="account-text">
                <span className="account-name">{shown}</span>
                <span className="account-plan">{plan}</span>
              </span>
              <Icon name="updown" size={16} />
            </>
          )}
        </button>
      )}
    >
      {(close) => {
        const go = (page?: SettingsPage) => () => {
          close();
          onSettings(page);
        };
        return (
          <>
            <div className="pop-head">{head}</div>
            <button type="button" role="menuitem" className="pop-item" onClick={go('general')}>
              <Icon name="gear" />
              <span className="grow">Settings</span>
              <kbd>Ctrl+,</kbd>
            </button>
            {pathOn && (
              <button type="button" role="menuitem" className="pop-item" onClick={go('journey')}>
                <Icon name="seal" />
                <span className="grow">Journey</span>
              </button>
            )}
            {(acct.available || acct.signedIn) && (
              <button type="button" role="menuitem" className="pop-item" onClick={go('account')}>
                <Icon name="key" />
                <span className="grow">{acct.signedIn ? 'Account' : 'Sync across devices'}</span>
              </button>
            )}
            <button type="button" role="menuitem" className="pop-item" onClick={go('usage')}>
              <Icon name="usage" />
              <span className="grow">Usage</span>
            </button>
            <a role="menuitem" className="pop-item" href={`${REPO}/issues`} target="_blank" rel="noreferrer" onClick={close}>
              <Icon name="help" />
              <span className="grow">Get help</span>
            </a>
            <hr />
            <Popover
              className="sub"
              place="up"
              label="Learn more"
              trigger={({ open, toggle }) => (
                <button type="button" role="menuitem" className={`pop-item${open ? ' on' : ''}`} onClick={toggle} aria-haspopup="menu" aria-expanded={open}>
                  <Icon name="info" />
                  <span className="grow">Learn more</span>
                  <Icon name="right" size={16} />
                </button>
              )}
            >
              {(closeSub) => (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="pop-item"
                    onClick={() => {
                      closeSub();
                      go('about')();
                    }}
                  >
                    About Kiai
                  </button>
                  <a role="menuitem" className="pop-item" href="https://github.com/lightvector/KataGo" target="_blank" rel="noreferrer">
                    <span className="grow">KataGo</span>
                    <Icon name="external" size={15} />
                  </a>
                  <a role="menuitem" className="pop-item" href={`${REPO}/blob/main/THIRD_PARTY_NOTICES.md`} target="_blank" rel="noreferrer">
                    <span className="grow">Third-party notices</span>
                    <Icon name="external" size={15} />
                  </a>
                  <a role="menuitem" className="pop-item" href={REPO} target="_blank" rel="noreferrer">
                    <span className="grow">Source code</span>
                    <Icon name="external" size={15} />
                  </a>
                </>
              )}
            </Popover>
          </>
        );
      }}
    </Popover>
  );
}

export function Sidebar({ convs, currentId, collapsed, onToggle, onSelect, onNew, onRename, onDelete, onClose, onSettings }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);

  const startRename = (c: Conversation) => {
    setEditing(c.id);
    setName(c.title);
    setConfirm(null);
  };
  const finish = () => {
    if (editing) onRename(editing, name);
    setEditing(null);
  };

  if (collapsed) {
    return (
      <nav className="sidebar rail" aria-label="Conversations">
        <button className="icon-btn" aria-label="Open sidebar" title="Open sidebar" onClick={onToggle}>
          <Icon name="sidebar" size={20} />
        </button>
        <button className="icon-btn new-dot" aria-label="New board" title="New board" onClick={onNew}>
          <Icon name="plus" size={16} />
        </button>
        <button className="icon-btn" aria-label="Boards" title="Boards" onClick={onToggle}>
          <Icon name="chat" size={19} />
        </button>
        <span className="grow" />
        <Account compact onSettings={onSettings} />
      </nav>
    );
  }

  return (
    <nav className="sidebar" aria-label="Conversations">
      <div className="side-head">
        <span className="brand">
          <Logo size={24} />
          <span className="wordmark">Kiai</span>
        </span>
        <button className="icon-btn side-fold" aria-label="Close sidebar" title="Close sidebar" onClick={onToggle}>
          <Icon name="sidebar" size={20} />
        </button>
        <button className="icon-btn side-close" aria-label="Close" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <button className="new-chat" onClick={onNew}>
        <span className="new-dot" aria-hidden="true">
          <Icon name="plus" size={14} />
        </span>
        New board
      </button>
      <div className="side-label">Boards</div>
      <ul className="conv-list">
        {!convs.length && <li className="conv-empty">Your boards show here. They stay in this browser.</li>}
        {convs.map((c) => (
          <li key={c.id} className={`conv${c.id === currentId ? ' on' : ''}`}>
            {editing === c.id ? (
              <form
                className="conv-rename"
                onSubmit={(e) => {
                  e.preventDefault();
                  finish();
                }}
              >
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={finish} aria-label="Board name" maxLength={80} />
              </form>
            ) : confirm === c.id ? (
              <div className="conv-confirm">
                <span className="grow">Delete this board?</span>
                <button className="link danger" onClick={() => onDelete(c.id)}>
                  Delete
                </button>
                <button className="link" onClick={() => setConfirm(null)}>
                  Keep
                </button>
              </div>
            ) : (
              <>
                <button className="conv-title" onClick={() => onSelect(c.id)} onDoubleClick={() => startRename(c)} title={c.title}>
                  {c.title}
                </button>
                <span className="conv-tools">
                  <button className="icon-btn sm" aria-label="Rename" title="Rename" onClick={() => startRename(c)}>
                    <Icon name="edit" size={15} />
                  </button>
                  <button
                    className="icon-btn sm"
                    aria-label="Delete"
                    title="Delete"
                    onClick={() => {
                      setConfirm(c.id);
                      setEditing(null);
                    }}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="side-foot">
        <Account compact={false} onSettings={onSettings} />
      </div>
    </nav>
  );
}
