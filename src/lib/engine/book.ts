import type { Board } from '../go/board';
import { PASS, type Color, type Loc } from '../go/types';
import { canonicalPosition, inverseSym, transformLoc } from '../coach/pro';
import type { SearchCandidate, SearchSnapshot } from './mcts';
import type { Candidate, PositionEval } from '../types';

/**
 * The opening book: whole-board opening positions searched once, deeply, by a strong
 * network (KataGo's b18 or b28 on native KataGo, see scripts/opening-book.ts and the
 * "AI training" workflow), shipped as static files. Openings repeat from game to game, so
 * for the first moves of most games the answer is already known: it costs this device
 * nothing, and it is a much stronger answer than a phone or a browser could compute.
 *
 * Positions are stored in one canonical orientation (coach/pro.ts canonicalPosition, the
 * same key the pro game explorer uses), so all eight rotations and mirror images of a
 * position find the same entry. One file per komi (komi as KataGo is given it).
 */

/** One move as stored: [loc, visits, winrate ×1000, lead ×10, prior ×1000] for the side to move. */
export type StoredMove = [number, number, number, number, number];

export interface StoredEntry {
  /** Visits of the search. */
  v: number;
  /** Black's winrate ×1000 and Black's lead ×10. */
  w: number;
  l: number;
  /** Searched moves, most visits first. */
  c: StoredMove[];
  /** Best line (canonical frame). */
  p: number[];
  /** The network, when not the book's own (BookFile.network). */
  n?: string;
}

export interface BookFile {
  version: 1;
  size: number;
  komi: number;
  /** The network that searched it. */
  network: string;
  /** Typical visits per position. */
  visits: number;
  built: string;
  /** canonical key + ':' + side to move (1 Black, 2 White) → entry. */
  entries: Record<string, StoredEntry>;
}

export interface BookManifest {
  version: 1;
  network: string;
  books: { komi: number; size: number; file: string; positions: number; visits: number }[];
}

export interface BookMove {
  loc: Loc;
  visits: number;
  /** For the side to move after playing it. */
  winrate: number;
  scoreLead: number;
  prior: number;
}

export interface BookEntry {
  visits: number;
  bWin: number;
  bLead: number;
  moves: BookMove[];
  pv: Loc[];
  network: string;
}

/** Positions with more stones than this are never in the book. */
export const BOOK_MAX_STONES = 60;

export function bookKey(stones: ArrayLike<number>, toPlay: Color, size: number) {
  const c = canonicalPosition(stones, toPlay, size);
  return { key: `${c.key}:${toPlay}`, sym: c.syms[0] };
}

const toStored = (loc: Loc, sym: number, size: number) => (loc === PASS || loc < 0 ? -1 : transformLoc(sym, loc, size));
const fromStored = (q: number, sym: number, size: number): Loc => (q < 0 ? PASS : transformLoc(inverseSym(sym, size), q, size));

export function countStones(stones: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < stones.length; i++) if (stones[i] === 1 || stones[i] === 2) n++;
  return n;
}

/** Store a search result (actual orientation) under its canonical key. */
export function storeEntry(
  stones: ArrayLike<number>,
  toPlay: Color,
  size: number,
  r: { visits: number; bWin: number; bLead: number; moves: BookMove[]; pv: Loc[] },
): { key: string; entry: StoredEntry } {
  const { key, sym } = bookKey(stones, toPlay, size);
  return {
    key,
    entry: {
      v: r.visits,
      w: Math.round(r.bWin * 1000),
      l: Math.round(r.bLead * 10),
      c: r.moves.slice(0, 10).map((m) => [toStored(m.loc, sym, size), m.visits, Math.round(m.winrate * 1000), Math.round(m.scoreLead * 10), Math.round(m.prior * 1000)]),
      p: r.pv.slice(0, 12).map((l) => toStored(l, sym, size)),
    },
  };
}

export class OpeningBook {
  readonly size: number;
  readonly komi: number;
  readonly network: string;
  private entries: Map<string, StoredEntry>;
  hits = 0;
  lookups = 0;

  constructor(file: BookFile) {
    this.size = file.size;
    this.komi = file.komi;
    this.network = file.network;
    this.entries = new Map(Object.entries(file.entries));
  }

  get positions() {
    return this.entries.size;
  }

  /** The book's answer for this position (in the board's own orientation), or null. */
  lookup(board: Pick<Board, 'stones' | 'size'>, toPlay: Color): BookEntry | null {
    if (board.size !== this.size || countStones(board.stones) > BOOK_MAX_STONES) return null;
    this.lookups++;
    const { key, sym } = bookKey(board.stones, toPlay, board.size);
    const e = this.entries.get(key);
    if (!e) return null;
    this.hits++;
    const size = this.size;
    return {
      visits: e.v,
      bWin: e.w / 1000,
      bLead: e.l / 10,
      moves: e.c.map(([q, visits, w, l, p]) => ({ loc: fromStored(q, sym, size), visits, winrate: w / 1000, scoreLead: l / 10, prior: p / 1000 })),
      pv: e.p.map((q) => fromStored(q, sym, size)),
      network: e.n ?? this.network,
    };
  }
}

/** The book's answer as a live-analysis result (what the search would show after reading this deep). */
export function bookSnapshot(e: BookEntry, toPlay: Color, size: number): SearchSnapshot {
  const hw = size * size;
  const policy = new Float32Array(hw + 1);
  for (const m of e.moves) policy[m.loc === PASS ? hw : m.loc] = m.prior;
  const candidates: SearchCandidate[] = e.moves.map((m, i) => ({
    loc: m.loc,
    visits: m.visits,
    winrate: m.winrate,
    scoreLead: m.scoreLead,
    prior: m.prior,
    pv: i === 0 && e.pv[0] === m.loc ? e.pv : [m.loc],
  }));
  return { toPlay, visits: e.visits, bWin: e.bWin, bLead: e.bLead, candidates, policy, ownership: null, nodes: 0, evalsPerSec: 0, elapsedMs: 0, settled: true };
}

/**
 * The book's answer as a stored analysis of a position, on top of this device's first look
 * (`fast` keeps its policy and ownership). The move played is kept among the candidates when
 * the book searched it.
 */
export function bookEval(e: BookEntry, fast: PositionEval): PositionEval {
  const cands: Candidate[] = e.moves.map((m, i) => ({
    loc: m.loc,
    prior: m.prior,
    winrate: m.winrate,
    scoreLead: m.scoreLead,
    visits: m.visits,
    pv: i === 0 && e.pv[0] === m.loc ? e.pv.slice(0, 16) : [m.loc],
  }));
  const net = fast.net ?? (fast.searched ? undefined : { bWin: fast.bWin, bLead: fast.bLead });
  return {
    ...fast,
    ...(net ? { net } : {}),
    bWin: e.bWin,
    bLead: e.bLead,
    candidates: cands,
    bestLoc: e.moves[0]?.loc ?? fast.bestLoc,
    pv: e.pv.slice(0, 20),
    visits: e.visits,
    depth: 'deep',
    searched: true,
    source: 'book',
    analyzedAt: Date.now(),
  };
}

// ------------------------------------------------------------------ loading (browser)

let manifest: Promise<BookManifest | null> | null = null;
const books = new Map<string, Promise<OpeningBook | null>>();

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: 'default' });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/** The book for this komi and board size (loaded once per visit, then from the browser's cache), or null. */
export function loadBook(komi: number, size = 19): Promise<OpeningBook | null> {
  const id = `${size}:${komi}`;
  let p = books.get(id);
  if (!p) {
    manifest ??= fetchJson<BookManifest>('/book/manifest.json');
    p = manifest.then(async (m) => {
      const b = m?.books.find((x) => x.komi === komi && x.size === size);
      if (!b) return null;
      const f = await fetchJson<BookFile>(`/book/${b.file}?n=${b.positions}`);
      return f && f.version === 1 ? new OpeningBook(f) : null;
    });
    books.set(id, p);
  }
  return p;
}

/** A book already loaded for this komi (no waiting), for lookups inside a search. */
const ready = new Map<string, OpeningBook>();
export function bookIfLoaded(komi: number, size = 19): OpeningBook | null {
  const id = `${size}:${komi}`;
  const hit = ready.get(id);
  if (hit) return hit;
  void loadBook(komi, size).then((b) => b && ready.set(id, b));
  return null;
}
