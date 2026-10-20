/**
 * Pro notes and their games, kept in this browser (IndexedDB, its own database so the chats
 * are never touched). Export from the Notes page to keep a copy anywhere else.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { GameInfo, ProNote } from './notes';

export interface NoteGame {
  id: string;
  /** The SGF as opened, so the game can be shown again and exported with the notes. */
  sgf: string;
  info: GameInfo;
  added: number;
}

let db: Promise<IDBPDatabase> | null = null;

function idb(): Promise<IDBPDatabase> {
  db ??= openDB('kiai-notes', 1, {
    upgrade(d) {
      d.createObjectStore('games', { keyPath: 'id' });
      const notes = d.createObjectStore('notes', { keyPath: 'id' });
      notes.createIndex('gameId', 'gameId');
    },
  });
  db.catch(() => (db = null));
  return db;
}

export async function allGames(): Promise<NoteGame[]> {
  const games = (await (await idb()).getAll('games')) as NoteGame[];
  return games.sort((a, b) => b.added - a.added);
}

export async function saveGame(g: NoteGame): Promise<void> {
  await (await idb()).put('games', g);
}

/** Removes a game and every note on it. */
export async function deleteGame(id: string): Promise<void> {
  const d = await idb();
  const tx = d.transaction(['games', 'notes'], 'readwrite');
  const keys = await tx.objectStore('notes').index('gameId').getAllKeys(id);
  await Promise.all([tx.objectStore('games').delete(id), ...keys.map((k) => tx.objectStore('notes').delete(k)), tx.done]);
}

export async function allNotes(): Promise<ProNote[]> {
  return (await (await idb()).getAll('notes')) as ProNote[];
}

export async function saveNote(n: ProNote): Promise<void> {
  await (await idb()).put('notes', n);
}

export async function deleteNote(id: string): Promise<void> {
  await (await idb()).delete('notes', id);
}

/** Adds imported notes; a note with the same id is replaced only when the import is newer. */
export async function importNotes(notes: ProNote[]): Promise<number> {
  const d = await idb();
  let n = 0;
  for (const note of notes) {
    const had = (await d.get('notes', note.id)) as ProNote | undefined;
    if (had && had.updated >= note.updated) continue;
    await d.put('notes', note);
    n++;
  }
  return n;
}
