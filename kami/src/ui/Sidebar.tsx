import { useState } from 'react';
import type { Conversation } from '../lib/store';
import { Icon } from './Icon';

interface Props {
  convs: Conversation[];
  currentId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function Sidebar({ convs, currentId, onSelect, onNew, onRename, onDelete, onClose }: Props) {
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

  return (
    <nav className="sidebar" aria-label="Conversations">
      <div className="side-head">
        <span className="brand">
          <img src="/favicon.svg" alt="" width={22} height={22} />
          Kami
        </span>
        <button className="icon-btn side-close" aria-label="Close" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <button className="new-chat" onClick={onNew}>
        <Icon name="plus" size={16} /> New chat
      </button>
      <div className="side-label">Chats</div>
      <ul className="conv-list">
        {!convs.length && <li className="conv-empty">Your chats show here. They stay in this browser.</li>}
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
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={finish} aria-label="Chat name" maxLength={80} />
              </form>
            ) : confirm === c.id ? (
              <div className="conv-confirm">
                <span>Delete this chat?</span>
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
                  <button className="icon-btn sm" aria-label="Rename" onClick={() => startRename(c)}>
                    <Icon name="edit" size={15} />
                  </button>
                  <button
                    className="icon-btn sm"
                    aria-label="Delete"
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
        KataGo reads every position on your device. <a href="https://github.com/PERILTHESKYWING/Dop">Built on Dop</a>
      </div>
    </nav>
  );
}
