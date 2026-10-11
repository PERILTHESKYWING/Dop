/**
 * Opening book builder (src/lib/engine/book.ts): finds the whole-board opening positions
 * that come up again and again in real games and searches each one deeply, once, with
 * native KataGo and a strong network. The site then answers those positions instantly and
 * at that strength, with no work on the device.
 *
 *   # search (one machine of several: --shard i --shards n)
 *   npx tsx scripts/opening-book.ts search --katago ./katago --model b18.bin.gz --network kata1-b18c384nbt \
 *     --lines pro.txt --sgf-dir fox/ --komi 7 --visits 400 --minutes 300 --book public/book/k70.json --out part-0.json
 *   # merge the parts into the shipped book and its manifest
 *   npx tsx scripts/opening-book.ts merge --book public/book/k70.json --komi 7 part-*.json
 *
 * Komi is as KataGo is given it (go/rules.ts engineKomi): 7 for Japanese 6.5, 7.5 for
 * Chinese. Positions are searched with area scoring, as the browser engine scores.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { startKataGo } from './katagoAnalysis';
import { parseSgfFile } from '../src/lib/go/sgf';
import { Board } from '../src/lib/go/board';
import { gtpToLoc, locToGtp } from '../src/lib/go/coords';
import { PASS, type Color, type Loc, type Move } from '../src/lib/go/types';
import { decodeSgfBytes } from '../src/lib/util/charset';
import { BOOK_MAX_STONES, bookKey, storeEntry, type BookFile, type BookManifest, type BookMove, type StoredEntry } from '../src/lib/engine/book';

const [mode, ...rest] = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = rest.indexOf('--' + k);
  return i >= 0 ? rest[i + 1] : d;
};
const args = (k: string) => rest.flatMap((a, i) => (rest[i - 1] === '--' + k ? [a] : []));
const SIZE = 19;
const gtp = (l: Loc) => (l === PASS ? 'pass' : locToGtp(l, SIZE));
const fromGtp = (s: string) => (s.toLowerCase() === 'pass' ? PASS : gtpToLoc(s, SIZE));
const letter = (c: Color) => (c === 1 ? 'B' : 'W');

function readBook(file: string | undefined, komi: number, network: string): BookFile {
  if (file && existsSync(file)) {
    const b = JSON.parse(readFileSync(file, 'utf8')) as BookFile;
    if (b.version === 1 && b.komi === komi) return b;
  }
  return { version: 1, size: SIZE, komi, network, visits: 0, built: '', entries: {} };
}

// ---------------------------------------------------------------------------------- search

interface Seen {
  n: number;
  moves: Move[];
  toPlay: Color;
  stones: number;
}

function* sgfTexts(): Generator<string> {
  for (const f of args('lines')) for (const line of readFileSync(f, 'utf8').split('\n')) if (line.startsWith('(')) yield line;
  const walk = function* (dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) yield* walk(p);
      else if (/\.sgf$/i.test(name)) yield decodeSgfBytes(readFileSync(p));
    }
  };
  for (const d of args('sgf-dir')) if (existsSync(d)) yield* walk(d);
}

/** Every whole-board position in the first `maxMove` moves of every game, counted by canonical key. */
function collect(maxMove: number): Map<string, Seen> {
  const seen = new Map<string, Seen>();
  let games = 0;
  for (const text of sgfTexts()) {
    let parsed;
    try {
      parsed = parseSgfFile(text).games;
    } catch {
      continue;
    }
    for (const g of parsed) {
      if (g.size !== SIZE || g.setup.length || g.handicap > 1 || g.moves.length < 20) continue;
      games++;
      const b = new Board(SIZE);
      for (let i = 0; i < Math.min(maxMove, g.moves.length); i++) {
        const mv = g.moves[i];
        if (mv.loc === PASS) break;
        const { key } = bookKey(b.stones, mv.color, SIZE);
        const row = seen.get(key);
        if (row) row.n++;
        else seen.set(key, { n: 1, moves: g.moves.slice(0, i), toPlay: mv.color, stones: i });
        if (b.stones[mv.loc]) break; // a broken record
        b.play(mv.loc, mv.color, true);
      }
    }
  }
  console.log(`${games} games, ${seen.size} distinct positions in their first ${maxMove} moves`);
  return seen;
}

async function search() {
  const komi = Number(arg('komi', '7'));
  const visits = Number(arg('visits', '400'));
  const minutes = Number(arg('minutes', '60'));
  const minCount = Number(arg('min-count', '2'));
  const maxMove = Number(arg('max-move', '36'));
  const shard = Number(arg('shard', '0'));
  const shards = Number(arg('shards', '1'));
  const threads = Number(arg('threads', '4'));
  const network = arg('network', 'g170e-b10c128')!;
  const out = arg('out')!;
  const limit = Number(arg('limit', '1000000'));
  const book = readBook(arg('book'), komi, network);
  const started = Date.now();

  // Most-played first; every position of the first moves is in, however rare.
  const all = [...collect(maxMove).entries()]
    .filter(([, s]) => s.stones <= BOOK_MAX_STONES && (s.n >= minCount || s.stones < 6))
    .sort((a, b) => b[1].n - a[1].n || a[1].stones - b[1].stones);
  const todo = all.filter(([k], i) => i % shards === shard && !((book.entries[k]?.v ?? 0) >= visits * 0.9)).slice(0, limit);
  console.log(`${all.length} positions qualify; this machine searches up to ${todo.length} of them at ${visits} visits (${minutes} min)`);

  const kg = startKataGo({ binary: arg('katago')!, model: arg('model')!, threads });
  const part: Record<string, StoredEntry> = {};
  let done = 0;
  const save = () => {
    mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    const f: BookFile = { version: 1, size: SIZE, komi, network, visits, built: new Date().toISOString(), entries: part };
    writeFileSync(out, JSON.stringify(f));
  };
  let next = 0;
  const worker = async () => {
    while (next < todo.length && Date.now() - started < minutes * 60_000) {
      const [key, s] = todo[next++];
      const r = await kg.query({
        moves: s.moves.map((m) => [letter(m.color), gtp(m.loc)]),
        komi,
        maxVisits: visits,
        analyzeTurns: [s.moves.length],
      });
      const mover = s.toPlay;
      const fromBlack = (w: number) => (mover === 1 ? w : 1 - w);
      const leadFor = (l: number) => (mover === 1 ? l : -l);
      const moves: BookMove[] = r.moveInfos
        .filter((m) => m.visits > 0)
        .sort((a, b) => b.visits - a.visits)
        .map((m) => ({ loc: fromGtp(m.move), visits: m.visits, winrate: fromBlack(m.winrate), scoreLead: leadFor(m.scoreLead), prior: m.prior }));
      const b = new Board(SIZE);
      for (const m of s.moves) b.play(m.loc, m.color, true);
      const best = r.moveInfos.find((m) => m.order === 0) ?? r.moveInfos[0];
      const stored = storeEntry(b.stones, mover, SIZE, {
        visits: r.rootInfo.visits,
        bWin: r.rootInfo.winrate,
        bLead: r.rootInfo.scoreLead,
        moves,
        pv: (best?.pv ?? []).map(fromGtp),
      });
      if (stored.key !== key) throw new Error('book key mismatch');
      part[key] = stored.entry;
      if (++done % 50 === 0) {
        save();
        const rate = (done / (Date.now() - started)) * 60_000;
        console.log(`${done} positions (${rate.toFixed(1)}/min, ${kg.visits()} visits)`);
      }
    }
  };
  await Promise.all(Array.from({ length: threads * 2 }, worker));
  save();
  await kg.close();
  console.log(`searched ${done} positions in ${((Date.now() - started) / 60_000).toFixed(1)} min -> ${out}`);
}

// ---------------------------------------------------------------------------------- merge

/** Stronger networks' answers replace weaker ones'; among equals, deeper searches win. */
const STRENGTH: Record<string, number> = { 'g170e-b10c128': 1, 'g170e-b20c256x2': 1.5, 'kata1-b18c384nbt': 2, 'kata1-b28c512nbt': 3 };
const strength = (n: string | undefined) => STRENGTH[n ?? ''] ?? 0;

function merge() {
  const komi = Number(arg('komi', '7'));
  const file = arg('book')!;
  const parts = rest.filter((a, i) => a.endsWith('.json') && !rest[i - 1]?.startsWith('--'));
  const book = readBook(file, komi, 'g170e-b10c128');
  // Each entry remembers its network when it differs from the book's own.
  const netOf = (e: StoredEntry, fileNet: string) => e.n ?? fileNet;
  const entries = new Map(Object.entries(book.entries).map(([k, e]) => [k, { ...e, n: netOf(e, book.network) }]));
  let added = 0;
  let better = 0;
  for (const p of parts) {
    const f = JSON.parse(readFileSync(p, 'utf8')) as BookFile;
    if (f.komi !== komi || f.size !== book.size) continue;
    for (const [k, e0] of Object.entries(f.entries)) {
      const e = { ...e0, n: netOf(e0, f.network) };
      const old = entries.get(k);
      if (!old) added++;
      else if (strength(e.n) > strength(old.n) || (strength(e.n) === strength(old.n) && e.v > old.v)) better++;
      else continue;
      entries.set(k, e);
    }
    book.visits = Math.max(book.visits, f.visits);
  }
  // The book's network is its most common one; entries from others keep their own name.
  const tally = new Map<string, number>();
  for (const e of entries.values()) tally.set(e.n!, (tally.get(e.n!) ?? 0) + 1);
  book.network = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? book.network;
  book.entries = {};
  for (const [k, e] of entries) {
    const { n, ...restE } = e;
    book.entries[k] = n === book.network ? restE : { ...restE, n };
  }
  book.built = new Date().toISOString();
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, JSON.stringify(book));
  // The manifest lists every book file next to it.
  const dir = path.dirname(path.resolve(file));
  const books: BookManifest['books'] = [];
  for (const name of readdirSync(dir).filter((x) => /^k\d+\.json$/.test(x)).sort()) {
    const b = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as BookFile;
    books.push({ komi: b.komi, size: b.size, file: name, positions: Object.keys(b.entries).length, visits: b.visits });
  }
  const manifest: BookManifest = { version: 1, network: book.network, books };
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  console.log(`book k${komi}: ${entries.size} positions (+${added} new, ${better} improved), network ${book.network}`);
}

if (mode === 'search') await search();
else if (mode === 'merge') merge();
else {
  console.error('usage: opening-book.ts search|merge ... (see the top of this file)');
  process.exit(1);
}
