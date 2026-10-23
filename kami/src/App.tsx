import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEvent } from './lib/useEvent';
import type { ThoughtStep } from '../../src/lib/coach/explain/types';
import { decodeSgfBytes } from '../../src/lib/util/charset';
import { untilAborted } from './lib/untilAborted';
import { getAnswerProber, positionKey } from './lib/analysis';
import { questionStarted } from './lib/engine';
import { loadJourney, onPathNote } from './lib/pathLine';
import { callKamiWrite, llmConfigured, LlmUnavailable, type CallLlm } from './lib/llm';
import { localAvailable, localWrite } from './lib/local';
import { NOTES } from './lib/writer';
import { boardFromSgf, emptyBoard, explainPositionOf, goTo, looksLikeSgf, playAt, undo, type BoardState } from './lib/position';
import { deleteConversation, loadConversations, newConversation, newId, saveConversation, titleFrom, type Answer, type ChatMessage, type Conversation } from './lib/store';
import { DEFAULT_LEVEL, levelById, levelFromOld, levelList, type LevelId } from './lib/levels';
import { BoardPanel as BoardPanelView, type Preview } from './ui/BoardPanel';
import { Composer as ComposerView } from './ui/Composer';
import { Icon } from './ui/Icon';
import { Messages as MessagesView, type Running } from './ui/Messages';
import type { SettingsPage } from './ui/Settings';
import { Sidebar as SidebarView } from './ui/Sidebar';
import { Boundary, LoadFailed } from './ui/Boundary';
import { Splitter } from './ui/Splitter';
import { markReady } from './lib/ready';
import { getSetting, useSetting } from './lib/settings';
import { observeMove, studentProfile } from './lib/style';

const Settings = lazy(() => import('./ui/Settings').then((m) => ({ default: m.Settings })));

/** The answer pipeline (lib/coach.ts), fetched once: when the browser is idle, or at the first question. */
let coach: Promise<typeof import('./lib/coach')> | null = null;
const loadCoach = () =>
  (coach ??= import('./lib/coach').catch((e) => {
    coach = null; // a failed fetch (offline for a moment) is tried again at the next question
    throw e;
  }));

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

/**
 * The big panes skip re-rendering unless their own props change: a keystroke in the composer
 * or a hover over a board point no longer redraws the chat, the board and the sidebar.
 */
const BoardPanel = memo(BoardPanelView);
const Composer = memo(ComposerView);
const Messages = memo(MessagesView);
const Sidebar = memo(SidebarView);

/** The server said it has no key: skip the call and use engine text. */
const noLlm: CallLlm = async () => {
  throw new LlmUnavailable('not configured');
};

export function App() {
  const [convs, setConvs] = useState<Conversation[]>(() => [newConversation()]);
  const [currentId, setCurrentId] = useState<string>(() => convs[0].id);
  const withLocal = useMemo(localAvailable, []);
  const levels = useMemo(() => levelList(withLocal), [withLocal]);
  const [level, setLevelState] = useState<LevelId>(() => {
    const saved = (lsGet('kiai.level') as LevelId | null) ?? levelFromOld(lsGet('kami.pick'), lsGet('kami.thinking'));
    return saved && levels.some((l) => l.id === saved) ? saved : DEFAULT_LEVEL;
  });
  const { pick, thinking } = levelById(level);
  const [running, setRunning] = useState<Running | null>(null);
  const [hover, setHover] = useState<Preview | null>(null);
  const [pinned, setPinned] = useState<Preview | null>(null);
  const preview = hover ?? pinned;
  const clearPreview = useCallback(() => {
    setHover(null);
    setPinned(null);
  }, []);
  const [drawer, setDrawer] = useState(false);
  const [boardHidden, setBoardHidden] = useState(false);
  const [folded, setFolded] = useState(() => lsGet('kami.sideFolded') !== '0'); // folded by default: the board comes first
  const fold = useCallback(
    () =>
      setFolded((f) => {
        lsSet('kami.sideFolded', f ? '0' : '1');
        return !f;
      }),
    [],
  );
  const [settings, setSettings] = useState<SettingsPage | null>(null);
  const theme = useSetting<string>('theme');
  const answerFont = useSetting<string>('answerFont');
  const [llmOn, setLlmOn] = useState<boolean | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const dirty = useRef(new Set<string>());
  const controller = useRef<AbortController | null>(null);

  const current = convs.find((c) => c.id === currentId) ?? convs[0];

  // in the DOM is ready enough for the loading sheet: a layout effect, before the first frame (a passive effect waits for it)
  useLayoutEffect(markReady, []);

  // Fetch the answer pipeline and Settings once the first screen is up, so neither waits later.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 1500));
    idle(() => {
      loadCoach().catch(() => {});
      import('./ui/Settings').catch(() => {});
      // The study path (keeps the sidebar line current) and the optional account (hidden unless
      // the sync server answers); neither is in the first paint.
      loadJourney().catch(() => {});
      import('./lib/account').then((m) => m.startAccount()).catch(() => {});
    });
  }, []);

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

  // A passed station or a stamped seal on the study path: one short line, switchable off.
  useEffect(() => onPathNote(setToast), []);
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

  const setBoard = useEvent((b: BoardState) => update(current.id, (c) => ({ ...c, board: b }), false));

  const setLevel = useCallback((id: LevelId) => {
    setLevelState(id);
    lsSet('kiai.level', id);
  }, []);

  const loadSgfText = useEvent((text: string) => {
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
  });

  const loadSgfFile = useCallback(
    async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      loadSgfText(decodeSgfBytes(bytes));
    },
    [loadSgfText],
  );

  /** Settings › Positions, read at ask time; the thinking tier still decides whether diagrams run. */
  const positionSettings = () =>
    getSetting<boolean>('positions.enabled')
      ? {
          minWinrate: getSetting<number>('positions.minWinrate'),
          visits: getSetting<number>('positions.visits'),
          maxKomi: getSetting<number>('positions.maxKomi'),
          maxMs: getSetting<number>('positions.maxSeconds') * 1000,
        }
      : (false as const);

  /** Ask in conversation `convId` and fill message `kamiId` with the answer. */
  /** `fresh`: Regenerate, so the writer is asked again instead of answering from a cache. */
  const run = async (convId: string, kamiId: string, text: string, board: BoardState, fresh = false) => {
    const ctrl = new AbortController();
    controller.current = ctrl;
    // KataGo never measures the device while a question is answered (it waits for a quiet moment after).
    const asked = questionStarted();
    setRunning({ convId, msgId: kamiId, stage: 'thinking', steps: [], t0: Date.now() });
    // Steps that land in the same frame are drawn together: one render per frame at most.
    let queued: ThoughtStep[] = [];
    let frame = 0;
    const flushThoughts = () => {
      frame = 0;
      const add = queued;
      queued = [];
      if (add.length) setRunning((r) => (r && r.msgId === kamiId ? { ...r, steps: [...r.steps, ...add] } : r));
    };
    const onThought = (t: ThoughtStep) => {
      queued.push(t);
      frame ||= requestAnimationFrame(flushThoughts);
    };
    const onStage = (stage: Running['stage']) => setRunning((r) => (r && r.msgId === kamiId ? { ...r, stage } : r));
    // The engine's answer shows as soon as it is ready; the checked wording replaces it.
    let draft: Answer | null = null;
    const onDraft = (a: Answer) => {
      draft = a;
      update(convId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === kamiId ? { ...m, answer: a } : m)) }));
    };
    let answer: Answer;
    try {
      const { answerQuestion, explain, findConcepts, checkAnswer } = await untilAborted(loadCoach(), ctrl.signal);
      answer = await untilAborted(
        answerQuestion(
          text,
          board,
          pick,
          thinking,
          {
            explain,
            getProber: getAnswerProber,
            findConcepts,
            callLlm: llmOn === false ? noLlm : callKamiWrite,
            checkAnswer,
            localWrite: withLocal ? localWrite : undefined,
            illustrate: positionSettings,
            writerDiagrams: () => getSetting<boolean>('positions.writerDiagrams'),
            student: studentProfile,
            fresh,
          },
          { onThought, onStage, onDraft },
          ctrl.signal,
        ),
        ctrl.signal,
      );
    } catch (e) {
      const stopped = (e as Error).name === 'AbortError';
      const d = draft as Answer | null;
      // Stopped while the writer worked: the engine's answer is already there, keep it.
      if (stopped && d?.type === 'explain') answer = { ...d, writing: { by: 'engine', note: NOTES.stopped } };
      else if (stopped && d?.type === 'concept') answer = d;
      else answer = { type: 'error', text: stopped ? 'Stopped.' : `Something went wrong: ${(e as Error).message}` };
    }
    update(convId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === kamiId ? { ...m, answer } : m)) }));
    // The study path: an answer about a position or an idea (errors and "Stopped." don't count; every level earns the same).
    if (answer.type === 'explain' || (answer.type === 'concept' && answer.ids.length)) {
      const intent = answer.type === 'explain' ? answer.explanation.question.intent : undefined;
      const key = positionKey(explainPositionOf(board));
      loadJourney()
        .then((m) => m.recordAnswer(key, text, intent === 'kill' || intent === 'live'))
        .catch(() => {});
    }
    // "Move 37": show the position the answer is about.
    if (answer.type === 'explain' && Math.abs(answer.upTo - board.cursor) > 1) {
      update(convId, (c) => (c.board.moves.length === board.moves.length ? { ...c, board: goTo(c.board, answer.upTo) } : c), false);
    }
    controller.current = null;
    asked();
    setRunning(null);
  };

  const send = useEvent((raw: string) => {
    const text = raw.trim();
    if (!text || running) return;
    if (looksLikeSgf(text)) {
      if (loadSgfText(text)) setDraft('');
      return;
    }
    setDraft('');
    const user: ChatMessage = { id: newId(), role: 'user', text, at: Date.now() };
    const kami: ChatMessage = { id: newId(), role: 'kami', text: '', at: Date.now(), pick, thinking, level };
    update(current.id, (c) => ({ ...c, title: c.messages.length ? c.title : titleFrom(text), messages: [...c.messages, user, kami] }));
    void run(current.id, kami.id, text, current.board);
  });

  /** Run the last question again (regenerate), or with new words (edit). */
  const rerun = useEvent((newText?: string) => {
    if (running) return;
    const msgs = current.messages;
    let i = msgs.length - 1;
    while (i >= 0 && msgs[i].role !== 'user') i--;
    if (i < 0) return;
    const text = (newText ?? msgs[i].text).trim();
    if (!text) return;
    const kami: ChatMessage = { id: newId(), role: 'kami', text: '', at: Date.now(), pick, thinking, level };
    update(current.id, (c) => ({
      ...c,
      title: i === 0 && newText ? titleFrom(text) : c.title,
      messages: [...c.messages.slice(0, i), { ...c.messages[i], text }, kami],
    }));
    void run(current.id, kami.id, text, current.board, true);
  });

  const stop = useCallback(() => controller.current?.abort(), []);

  const newChat = useEvent(() => {
    setDrawer(false);
    clearPreview();
    if (!current.messages.length) {
      setBoard(emptyBoard(current.board.size));
      return;
    }
    const c = newConversation();
    setConvs((cs) => [c, ...cs.filter((x) => x.messages.length)]);
    setCurrentId(c.id);
  });

  const select = useEvent((id: string) => {
    if (running) stop();
    clearPreview();
    setDrawer(false);
    setConvs((cs) => cs.filter((x) => x.messages.length || x.id === id));
    setCurrentId(id);
  });

  const rename = useCallback((id: string, title: string) => update(id, (c) => ({ ...c, title: title.trim() || c.title }), false), [update]);

  const remove = useEvent((id: string) => {
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
  });

  const removeAll = () => {
    if (running) stop();
    for (const c of convs) if (c.messages.length) void deleteConversation(c.id);
    const fresh = newConversation();
    clearPreview();
    setConvs([fresh]);
    setCurrentId(fresh.id);
    setToast('All boards deleted');
  };

  const listed = useMemo(() => convs.filter((c) => c.messages.length).sort((a, b) => b.updated - a.updated), [convs]);
  const closeDrawer = useCallback(() => setDrawer(false), []);
  const openSettings = useCallback((page?: SettingsPage) => {
    setDrawer(false);
    setSettings(page ?? 'general');
  }, []);
  const pinnedKey = pinned?.key ?? null;
  const link = useMemo(() => ({ onHover: setHover, onPin: setPinned, pinnedKey }), [pinnedKey]);
  const regenerate = useCallback(() => rerun(), [rerun]);
  const editLast = useCallback((text: string) => rerun(text), [rerun]);
  const showBoard = useCallback(
    (b: BoardState) => {
      setBoard(b);
      setBoardHidden(false);
    },
    [setBoard],
  );
  const onBoard = useCallback(
    (b: BoardState) => {
      clearPreview();
      setBoard(b);
    },
    [clearPreview, setBoard],
  );
  const onPlay = useEvent((loc: number, fromCandidate?: boolean) => {
    if (preview) return clearPreview();
    const b = playAt(current.board, loc);
    if (!b) return;
    // A move the student chose (not KataGo's disc): Kami learns their style from many of these.
    if (!fromCandidate) observeMove(current.board, loc);
    setBoard(b);
  });
  const onUndo = useEvent(() => setBoard(undo(current.board)));
  const boardSettings = useCallback((page?: SettingsPage) => setSettings(page ?? 'board'), []);

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
        onClose={closeDrawer}
        onSettings={openSettings}
      />
      <div className="scrim" onClick={() => setDrawer(false)} />
      <div className="work split">
        <header className="topbar">
          <button className="icon-btn only-phone" aria-label="Open boards" onClick={() => setDrawer(true)}>
            <Icon name="sidebar" size={20} />
          </button>
          <span className="topbar-title">{current.messages.length ? current.title : 'New board'}</span>
          <button
            className="icon-btn"
            aria-label={boardHidden ? 'Show board' : 'Hide board'}
            title={boardHidden ? 'Show board' : 'Hide board'}
            aria-pressed={!boardHidden}
            onClick={() => setBoardHidden((h) => !h)}
          >
            <Icon name="board" />
          </button>
          <button className="icon-btn only-phone" aria-label="New board" onClick={newChat}>
            <Icon name="plus" />
          </button>
        </header>
        <main className="chat">
          <Messages
            messages={current.messages}
            running={running?.convId === current.id ? running : null}
            board={current.messages.length ? null : current.board}
            link={link}
            onAsk={send}
            onRegenerate={regenerate}
            onEdit={editLast}
            onShowBoard={showBoard}
            busy={!!running}
          />
          <Composer
            value={draft}
            onChange={setDraft}
            levels={levels}
            level={level}
            onLevel={setLevel}
            running={!!running}
            onSend={send}
            onStop={stop}
          />
        </main>
        {!boardHidden && <Splitter />}
        {!boardHidden && (
          <BoardPanel
            board={current.board}
            preview={preview}
            onBoard={onBoard}
            onPlay={onPlay}
            onUndo={onUndo}
            onClearPreview={clearPreview}
            onSgfText={loadSgfText}
            onSgfFile={loadSgfFile}
            onSettings={boardSettings}
            answered={current.messages.some((m) => m.role === 'kami' && !!m.answer)}
          />
        )}
      </div>
      {settings && (
        <Boundary fallback={<LoadFailed float />}>
        <Suspense fallback={null}>
          <Settings page={settings} onPage={setSettings} onClose={() => setSettings(null)} convs={convs} llmOn={llmOn} onDeleteAll={removeAll} />
        </Suspense>
        </Boundary>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
