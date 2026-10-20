/** Conversations, kept in this browser: IndexedDB, or localStorage when IndexedDB is blocked. */
import { openDB, type IDBPDatabase } from 'idb';
import type { Explanation, ThinkingLevel } from '../../../src/lib/coach/explain/types';
import type { LevelId } from './levels';
import { emptyBoard, type BoardState } from './position';
import type { Expansion, PickId, Writing } from './writer';

export type Answer =
  | { type: 'explain'; explanation: Explanation; writing: Writing; upTo: number }
  /** Library entries by id (looked up again when shown), or none (the honest fallback). */
  | { type: 'concept'; ids: string[]; expansion?: Expansion }
  | { type: 'error'; text: string };

export interface ChatMessage {
  id: string;
  role: 'user' | 'kami';
  text: string;
  at: number;
  pick?: PickId;
  thinking?: ThinkingLevel;
  /** The thinking level picked (since 2026-10-20); older answers have only pick and thinking. */
  level?: LevelId;
  answer?: Answer;
}

export interface Conversation {
  id: string;
  title: string;
  created: number;
  updated: number;
  messages: ChatMessage[];
  board: BoardState;
}

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function newConversation(board: BoardState = emptyBoard()): Conversation {
  const now = Date.now();
  return { id: newId(), title: 'New chat', created: now, updated: now, messages: [], board };
}

export const titleFrom = (text: string) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 42 ? `${t.slice(0, 40)}…` : t || 'New chat';
};

const LS_KEY = 'kami.conversations';
let db: Promise<IDBPDatabase> | null = null;

function idb(): Promise<IDBPDatabase> {
  db ??= openDB('kami', 1, {
    upgrade(d) {
      d.createObjectStore('conversations', { keyPath: 'id' });
    },
  });
  db.catch(() => (db = null));
  return db;
}

function lsAll(): Conversation[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as Conversation[];
  } catch {
    return [];
  }
}

function lsWrite(all: Conversation[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    /* storage full or blocked: this session only */
  }
}

/** Newest first. */
export async function loadConversations(): Promise<Conversation[]> {
  let all: Conversation[];
  try {
    all = (await (await idb()).getAll('conversations')) as Conversation[];
  } catch {
    all = lsAll();
  }
  return all.filter((c) => c && c.id && Array.isArray(c.messages) && c.board).sort((a, b) => b.updated - a.updated);
}

export async function saveConversation(c: Conversation): Promise<void> {
  try {
    await (await idb()).put('conversations', c);
  } catch {
    lsWrite([c, ...lsAll().filter((x) => x.id !== c.id)]);
  }
}

export async function deleteConversation(id: string): Promise<void> {
  try {
    await (await idb()).delete('conversations', id);
  } catch {
    lsWrite(lsAll().filter((x) => x.id !== id));
  }
}
