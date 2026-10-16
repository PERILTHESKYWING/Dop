import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { checkAnswer } from '../../src/lib/coach/answerCheck';
import { explain } from '../../src/lib/coach/explain';
import { findConcepts } from '../../src/lib/coach/library';
import type { ThinkingLevel, ThoughtStep } from '../../src/lib/coach/explain/types';
import { decodeSgfBytes } from '../../src/lib/util/charset';
import { answerQuestion, untilAborted } from './lib/answer';
import { getProber } from './lib/engine';
import { callKamiWrite, llmConfigured, LlmUnavailable, type CallLlm } from './lib/llm';
import { localAvailable, localWrite } from './lib/local';
import { boardFromSgf, emptyBoard, goTo, looksLikeSgf, playAt, undo, type BoardState } from './lib/position';
import { deleteConversation, loadConversations, newConversation, newId, saveConversation, titleFrom, type Answer, type ChatMessage, type Conversation } from './lib/store';
import { pickById, picks, type PickId } from './lib/writer';
import { BoardPanel, type Preview } from './ui/BoardPanel';
import { Composer } from './ui/Composer';
import { Icon } from './ui/Icon';
import { Messages, type Running } from './ui/Messages';
import { Settings, type SettingsPage } from './ui/Settings';
import { Sidebar } from './ui/Sidebar';
import { Splitter } from './ui/Splitter';
import { useSetting } from './lib/settings';

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* blocked */
  }
}

const THINKING: ThinkingLevel[] = ['off', 'low', 'medium', 'high'];

/** The server said it has no key: skip the call and use engine text. */
const noLlm: CallLlm = async () => {
  throw new LlmUnavailable('not configured');
};

export function App() {
  const [convs, setConvs] = useState<Conversation[]>(() => [newConversation()]);
  const [currentId, setCurrentId] = useState<string>(() => convs[0].id);
  const withLocal = useMemo(localAvailable, []);
  const tiers = useMemo(() => picks(withLocal), [withLocal]);
  const [pick, setPickState] = useState<PickId>(() => {
    const saved = lsGet('kami.pick') as PickId | null;
    return saved && tiers.some((t) => t.id === saved) ? saved : 'tesuji';
  });
  const [thinking, setThinkingState] = useState<ThinkingLevel>(() => {
    const saved = lsGet('kami.thinking') as ThinkingLevel | null;
    return saved && THINKING.includes(saved) ? saved : pickById(pick).defaultThinking;
  });
  const [running, setRunning] = useState<Running | null>(null);
  const [hover, setHover] = useState<Preview | null>(null);
  const [pinned, setPinned] = useState<Preview | null>(null);
  const preview = hover ?? pinned;
  const clearPreview = () => {
    setHover(null);
    setPinned(null);
  };
  const [drawer, setDrawer] = useState(false);
  const [boardHidden, setBoardHidden] = useState(false);
  const [folded, setFolded] = useState(() => lsGet('kami.sideFolded') === '1');
  const fold = () =>
    setFolded((f) => {
      lsSet('kami.sideFolded', f ? '0' : '1');
      return !f;
    });
  const [settings, setSettings] = useState<SettingsPage | null>(null);
  const theme = useSetting<string>('theme');
  const answerFont = useSetting<string>('answerFont');
  const [llmOn, setLlmOn] = useState<boolean | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const dirty = useRef(new Set<string>());
  const controller = useRef<AbortController | null>(null);

  const current = convs.find((c) => c.id === currentId) ?? convs[0];

  useEffect(() => {
    loadConversations().then((saved) => {
      if (saved.length) setConvs((cs) => [...cs.filter((c) => !saved.some((s) => s.id === c.id)), ...saved]);
    });
    llmConfigured().then(setLlmOn);
  }, []);

  // Save conversations that changed and have something in them.
  useEffect(() => {
    for (const id of dirty.current) {
      const c = convs.find((x) => x.id === id);
      if (c && c.messages.length) saveConversation(c);
    }
    dirty.current.clear();
  }, [convs]);

  // Settings › Appearance, and Ctrl+, (Cmd+, on a Mac) for Settings as in Claude.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setSettings((p) => (p ? null : 'general'));
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const update = useCallback((id: string, fn: (c: Conversation) => Conversation, bump = true) => {
    setConvs((cs) =>
      cs.map((c) => {
        if (c.id !== id) return c;
        dirty.current.add(id);
        const next = fn(c);
        return bump ? { ...next, updated: Date.now() } : next;
      }),
    );
  }, []);

  const setBoard = useCallback((b: BoardState) => update(current.id, (c) => ({ ...c, board: b }), false), [current.id, update]);

  const setPick = (id: PickId) => {
    setPickState(id);
    lsSet('kami.pick', id);
    const t = pickById(id).defaultThinking;
    setThinkingState(t);
    lsSet('kami.thinking', t);
  };
  const setThinking = (t: ThinkingLevel) => {
    setThinkingState(t);
    lsSet('kami.thinking', t);
  };

  const loadSgfText = (text: string) => {
    try {
      const b = boardFromSgf(text);
      clearPreview();
      setBoard(b);
      setToast(`Loaded ${b.title ? `${b.title}, ` : ''}${b.moves.length} moves`);
      return true;
    } catch (e) {
      setToast(`Could not read that SGF: ${(e as Error).message}`);
      return false;
    }
  };

  const loadSgfFile = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    loadSgfText(decodeSgfBytes(bytes));
  };

  /** Ask in conversation `convId` and fill message `kamiId` with the answer. */
  const run = async (convId: string, kamiId: string, text: string, board: BoardState) => {
    const ctrl = new AbortController();
    controller.current = ctrl;
    setRunning({ convId, msgId: kamiId, stage: 'thinking', steps: [], t0: Date.now() });
    const onThought = (t: ThoughtStep) => setRunning((r) => (r && r.msgId === kamiId ? { ...r, steps: [...r.steps, t] } : r));
    const onStage = (stage: Running['stage']) => setRunning((r) => (r && r.msgId === kamiId ? { ...r, stage } : r));
    let answer: Answer;
    try {
      answer = await untilAborted(
        answerQuestion(
          text,
          board,
          pick,
          thinking,
          { explain, getProber, findConcepts, callLlm: llmOn === false ? noLlm : callKamiWrite, checkAnswer, localWrite: withLocal ? localWrite : undefined },
          { onThought, onStage },
          ctrl.signal,
        ),
        ctrl.signal,
      );
    } catch (e) {
      answer = { type: 'error', text: (e as Error).name === 'AbortError' ? 'Stopped.' : `Something went wrong: ${(e as Error).message}` };
    }
    update(convId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === kamiId ? { ...m, answer } : m)) }));
    // "Move 37": show the position the answer is about.
    if (answer.type === 'explain' && Math.abs(answer.upTo - board.cursor) > 1) {
      update(convId, (c) => (c.board.moves.length === board.moves.length ? { ...c, board: goTo(c.board, answer.upTo) } : c), false);
    }
    controller.current = null;
    setRunning(null);
  };

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || running) return;
    if (looksLikeSgf(text)) {
      if (loadSgfText(text)) setDraft('');
      return;
    }
    setDraft('');
    const user: ChatMessage = { id: newId(), role: 'user', text, at: Date.now() };
    const kami: ChatMessage = { id: newId(), role: 'kami', text: '', at: Date.now(), pick, thinking };
    update(current.id, (c) => ({ ...c, title: c.messages.length ? c.title : titleFrom(text), messages: [...c.messages, user, kami] }));
    void run(current.id, kami.id, text, current.board);
  };

  /** Run the last question again (regenerate), or with new words (edit). */
  const rerun = (newText?: string) => {
    if (running) return;
    const msgs = current.messages;
    let i = msgs.length - 1;
    while (i >= 0 && msgs[i].role !== 'user') i--;
    if (i < 0) return;
    const text = (newText ?? msgs[i].text).trim();
    if (!text) return;
    const kami: ChatMessage = { id: newId(), role: 'kami', text: '', at: Date.now(), pick, thinking };
    update(current.id, (c) => ({
      ...c,
      title: i === 0 && newText ? titleFrom(text) : c.title,
      messages: [...c.messages.slice(0, i), { ...c.messages[i], text }, kami],
    }));
    void run(current.id, kami.id, text, current.board);
  };

  const stop = () => controller.current?.abort();

  const newChat = () => {
    setDrawer(false);
    clearPreview();
    if (!current.messages.length) {
      setBoard(emptyBoard(current.board.size));
      return;
    }
    const c = newConversation();
    setConvs((cs) => [c, ...cs.filter((x) => x.messages.length)]);
    setCurrentId(c.id);
  };

  const select = (id: string) => {
    if (running) stop();
    clearPreview();
    setDrawer(false);
    setConvs((cs) => cs.filter((x) => x.messages.length || x.id === id));
    setCurrentId(id);
  };

  const rename = (id: string, title: string) => update(id, (c) => ({ ...c, title: title.trim() || c.title }), false);

  const remove = (id: string) => {
    if (running?.convId === id) stop();
    void deleteConversation(id);
    if (id !== current.id) {
      setConvs((cs) => cs.filter((c) => c.id !== id));
      return;
    }
    const fresh = newConversation();
    clearPreview();
    setConvs((cs) => [fresh, ...cs.filter((c) => c.id !== id)]);
    setCurrentId(fresh.id);
  };

  const removeAll = () => {
    if (running) stop();
    for (const c of convs) if (c.messages.length) void deleteConversation(c.id);
    const fresh = newConversation();
    clearPreview();
    setConvs([fresh]);
    setCurrentId(fresh.id);
    setToast('All chats deleted');
  };

  const listed = convs.filter((c) => c.messages.length).sort((a, b) => b.updated - a.updated);
  const tier = pickById(pick);

  return (
    <div className={`kami-app${drawer ? ' drawer-open' : ''}${boardHidden ? ' board-hidden' : ''}${folded ? ' side-folded' : ''} font-${answerFont}`}>
      <Sidebar
        convs={listed}
        currentId={current.id}
        collapsed={folded}
        onToggle={fold}
        onSelect={select}
        onNew={newChat}
        onRename={rename}
        onDelete={remove}
        onClose={() => setDrawer(false)}
        onSettings={(page) => {
          setDrawer(false);
          setSettings(page ?? 'general');
        }}
      />
      <div className="scrim" onClick={() => setDrawer(false)} />
      <div className="work split">
        <header className="topbar">
          <button className="icon-btn only-phone" aria-label="Open chats" onClick={() => setDrawer(true)}>
            <Icon name="sidebar" size={20} />
          </button>
          <span className="topbar-title">{current.messages.length ? current.title : 'Kami'}</span>
          <button
            className="icon-btn"
            aria-label={boardHidden ? 'Show board' : 'Hide board'}
            title={boardHidden ? 'Show board' : 'Hide board'}
            aria-pressed={!boardHidden}
            onClick={() => setBoardHidden((h) => !h)}
          >
            <Icon name="board" />
          </button>
          <button className="icon-btn only-phone" aria-label="New chat" onClick={newChat}>
            <Icon name="plus" />
          </button>
        </header>
        <main className="chat">
          <Messages
            messages={current.messages}
            running={running?.convId === current.id ? running : null}
            board={current.board}
            link={{ onHover: setHover, onPin: setPinned, pinnedKey: pinned?.key ?? null }}
            onAsk={send}
            onRegenerate={() => rerun()}
            onEdit={(text) => rerun(text)}
            onShowBoard={(b) => {
              setBoard(b);
              setBoardHidden(false);
            }}
            busy={!!running}
          />
          <Composer
            value={draft}
            onChange={setDraft}
            tiers={tiers}
            tier={tier}
            onPick={setPick}
            thinking={thinking}
            onThinking={setThinking}
            running={!!running}
            onSend={send}
            onStop={stop}
            llmOn={llmOn}
          />
        </main>
        {!boardHidden && <Splitter />}
        {!boardHidden && (
          <BoardPanel
            board={current.board}
            preview={preview}
            onBoard={(b) => {
              clearPreview();
              setBoard(b);
            }}
            onPlay={(loc) => {
              if (preview) return clearPreview();
              const b = playAt(current.board, loc);
              if (b) setBoard(b);
            }}
            onUndo={() => setBoard(undo(current.board))}
            onClearPreview={clearPreview}
            onSgfText={loadSgfText}
            onSgfFile={loadSgfFile}
            onSettings={(page) => setSettings(page ?? 'board')}
          />
        )}
      </div>
      {settings && <Settings page={settings} onPage={setSettings} onClose={() => setSettings(null)} convs={convs} llmOn={llmOn} onDeleteAll={removeAll} />}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
