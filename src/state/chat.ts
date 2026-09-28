import { create } from 'zustand';
import type { ProbeResult } from '../../shared/ask';
import type { AnalysisBase } from '../components/Analysis';
import { kvGet, kvSet } from '../lib/db/db';
import { engineMoves } from '../lib/analysis/analyzer';
import { engineEvaluator, Search, type SearchSnapshot } from '../lib/engine/mcts';
import { replay } from '../lib/go/board';
import { engineKomi } from '../lib/go/rules';
import { markInteractive, startEngine } from './actions';

/**
 * Go chat conversations, kept in this browser (IndexedDB). A message sent with a board keeps
 * the position it was about, so the board can go back to it later.
 */

export interface ChatPosition {
  /** "Move 41 of Mira vs Kai", "Empty 19×19 board + 3 moves". */
  label: string;
  base: AnalysisBase;
}

export interface StoredMessage {
  role: 'user' | 'coach';
  text: string;
  at: number;
  pos?: ChatPosition;
  probes?: ProbeResult[];
  unsupported?: string[];
  followups?: string[];
  meta?: { deep: boolean; corrected: boolean; reviewed: boolean; calls: number; model?: string; visits?: number };
  error?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  created: number;
  updated: number;
  messages: StoredMessage[];
}

interface ChatState {
  loaded: boolean;
  list: Conversation[];
  currentId: string | null;
}

const KEY = 'chat:conversations';
const MAX_CONVERSATIONS = 40;
const MAX_MESSAGES = 80;

export const useChat = create<ChatState>(() => ({ loaded: false, list: [], currentId: null }));

let loading: Promise<void> | null = null;
export function loadChats(): Promise<void> {
  return (loading ??= kvGet<Conversation[]>(KEY)
    .then((list) => useChat.setState({ loaded: true, list: Array.isArray(list) ? list : [] }))
    .catch(() => useChat.setState({ loaded: true })));
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void kvSet(KEY, useChat.getState().list).catch(() => {}), 300);
}

export function newConversation(): string {
  const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const now = Date.now();
  const list = [{ id, title: 'New chat', created: now, updated: now, messages: [] }, ...useChat.getState().list].slice(0, MAX_CONVERSATIONS);
  useChat.setState({ list, currentId: id });
  persist();
  return id;
}

export function selectConversation(id: string | null) {
  useChat.setState({ currentId: id });
}

export function deleteConversation(id: string) {
  const s = useChat.getState();
  useChat.setState({ list: s.list.filter((c) => c.id !== id), currentId: s.currentId === id ? null : s.currentId });
  persist();
}

const titleOf = (text: string) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 48 ? t.slice(0, 46).replace(/\s\S*$/, '') + '…' : t || 'New chat';
};

export function appendMessage(id: string, m: StoredMessage) {
  const list = useChat.getState().list.map((c) =>
    c.id === id
      ? {
          ...c,
          title: c.messages.length === 0 && m.role === 'user' ? titleOf(m.text) : c.title,
          updated: m.at,
          messages: [...c.messages, m].slice(-MAX_MESSAGES),
        }
      : c,
  );
  // Most recent first.
  list.sort((a, b) => b.updated - a.updated);
  useChat.setState({ list });
  persist();
}

/** Remove the last message (a failed reply, before retrying). */
export function dropLast(id: string) {
  useChat.setState({ list: useChat.getState().list.map((c) => (c.id === id ? { ...c, messages: c.messages.slice(0, -1) } : c)) });
  persist();
}

/** Search a position with KataGo until `visits` or `maxMs` (the chat's own read when live analysis is off or shallow). */
export async function searchPosition(base: AnalysisBase, visits: number, maxMs: number): Promise<SearchSnapshot | null> {
  const eng = await startEngine();
  if (!eng) return null;
  markInteractive(maxMs + 2000);
  const board = replay(base.size, base.setup, base.moves);
  const search = new Search(
    engineEvaluator(eng),
    { size: base.size, komi: engineKomi(base.komi, base.rules), moves: engineMoves(base.setup, base.moves), toPlay: base.toPlay, board },
    { batch: eng.batch ?? 1 },
  );
  return search.run({ visits, maxMs });
}
