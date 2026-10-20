/**
 * Pro notes (#annotate): open recent pro games, let KataGo find the moves where each game
 * turned, and write a pro's verdict, better move and reason on each. Built for speed: one
 * game read in the background, keys 1 2 3 0 for the verdict, a click on the board for the
 * better move, Ctrl+Enter for the next moment. Notes stay in this browser until exported.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Board, type Mark } from '../../../src/components/Board';
import type { EngineRead, ExplainPosition } from '../../../src/lib/coach/explain/types';
import { gtpToLoc, locToGtp } from '../../../src/lib/go/coords';
import { replay } from '../../../src/lib/go/board';
import { parseSgfCollection } from '../../../src/lib/go/sgf';
import { PASS } from '../../../src/lib/go/types';
import { readPosition } from '../lib/analysis';
import { engineStatus, onEngineStatus } from '../lib/engine';
import { allGames, allNotes, deleteGame, importNotes, saveGame, saveNote, type NoteGame } from '../lib/noteStore';
import {
  agreement,
  fromJsonl,
  gameIdOf,
  isDone,
  keyMoments,
  momentAt,
  noteId,
  NOTES_FORMAT,
  TAGS,
  toJsonl,
  VERDICTS,
  type GameInfo,
  type KeyMoment,
  type ProNote,
  type Verdict,
} from '../lib/notes';
import { boardFromSgf, explainPositionOf, type BoardState } from '../lib/position';
import { KIAI_SKIN } from './skin';
import './annotate.css';

/** XIAO's target for the first reference set. */
const GOAL = 150;
const DEPTHS = [100, 200, 400, 800];
const READ_MS = 30000;

function gameInfo(sgf: string, b: BoardState): GameInfo {
  const root = parseSgfCollection(sgf)[0];
  const prop = (k: string) => root?.props[k]?.[0]?.trim() ?? '';
  return { black: b.black ?? prop('PB'), white: b.white ?? prop('PW'), date: prop('DT'), event: prop('EV') || prop('GN'), size: b.size };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const pts = (x: number) => x.toFixed(1);

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-ndjson' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable);
};

export default function Annotate() {
  const [games, setGames] = useState<NoteGame[]>([]);
  const [notes, setNotes] = useState<Map<string, ProNote>>(new Map());
  const [gameId, setGameId] = useState<string | null>(null);
  const [depth, setDepth] = useState(200);
  const [reads, setReads] = useState<(EngineRead | null)[]>([]);
  const [readUpTo, setReadUpTo] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const [after, setAfter] = useState(false);
  const [msg, setMsg] = useState('');
  const engine = useSyncExternalStore(onEngineStatus, engineStatus);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    document.title = 'Pro notes · Kiai';
    Promise.all([allGames(), allNotes()]).then(
      ([g, n]) => {
        setGames(g);
        setNotes(new Map(n.map((x) => [x.id, x])));
        if (g[0]) setGameId(g[0].id);
      },
      (e) => setMsg(`This browser could not open its storage: ${(e as Error).message}`),
    );
  }, []);

  const game = games.find((g) => g.id === gameId) ?? null;
  const board = useMemo(() => (game ? boardFromSgf(game.sgf) : null), [game]);
  const positions = useMemo<ExplainPosition[]>(() => (board ? Array.from({ length: board.moves.length + 1 }, (_, i) => explainPositionOf(board, i)) : []), [board]);

  // Read the whole game once, in order, so moments appear as the read goes.
  useEffect(() => {
    if (!positions.length) return;
    let alive = true;
    setReads(new Array(positions.length).fill(null));
    setReadUpTo(0);
    (async () => {
      for (let i = 0; i < positions.length; i++) {
        if (!alive) return;
        let r: EngineRead | null = null;
        try {
          r = await readPosition(positions[i], depth, READ_MS, () => alive);
        } catch (e) {
          if (alive) setMsg(`KataGo stopped: ${(e as Error).message}`);
          return;
        }
        if (!alive) return;
        setReads((rs) => {
          const next = rs.slice();
          next[i] = r;
          return next;
        });
        setReadUpTo(i + 1);
      }
    })();
    return () => {
      alive = false;
    };
  }, [positions, depth]);

  const gameNotes = useMemo(() => [...notes.values()].filter((n) => n.gameId === gameId).sort((a, b) => a.index - b.index), [notes, gameId]);
  const moments = useMemo(() => (board ? keyMoments(positions, reads, board.moves) : []), [board, positions, reads]);
  /** Moments to work through: KataGo's picks plus any move noted by hand. */
  const queue = useMemo(() => {
    const idx = new Set([...moments.map((m) => m.index), ...gameNotes.map((n) => n.index)]);
    return [...idx].sort((a, b) => a - b);
  }, [moments, gameNotes]);

  useEffect(() => {
    if (sel === null && queue.length) setSel(queue[0]);
  }, [queue, sel]);
  useEffect(() => {
    setSel(null);
    setAfter(false);
  }, [gameId]);

  const allList = [...notes.values()];
  const done = allList.filter((n) => n.verdict !== 'skip' && isDone(n)).length;
  const agree = agreement(allList);

  const moment: KeyMoment | null = board && sel !== null ? (moments.find((m) => m.index === sel) ?? momentAt(positions, reads, board.moves, sel)) : null;
  const note = board && sel !== null && gameId ? (notes.get(noteId(gameId, sel)) ?? null) : null;

  const update = useCallback(
    (patch: Partial<ProNote>) => {
      if (!board || !game || sel === null) return;
      const m = board.moves[sel];
      if (!m || m.loc === PASS) return;
      const now = Date.now();
      const base: ProNote = note ?? {
        format: NOTES_FORMAT,
        id: noteId(game.id, sel),
        gameId: game.id,
        game: game.info,
        index: sel,
        moveNumber: sel + 1,
        color: m.color === 1 ? 'B' : 'W',
        played: locToGtp(m.loc, board.size),
        katago: { best: null, scoreLoss: 0, winLoss: 0, winBefore: 0.5, visits: 0, network: '' },
        verdict: 'mistake',
        better: moment?.best ?? null,
        reason: '',
        tags: [],
        byHand: !moments.some((k) => k.index === sel),
        created: now,
        updated: now,
      };
      const katago = moment
        ? { best: moment.best, scoreLoss: +moment.scoreLoss.toFixed(2), winLoss: +moment.winLoss.toFixed(4), winBefore: +moment.winBefore.toFixed(4), visits: moment.visits, network: engine.state === 'ready' ? engine.text : base.katago.network }
        : base.katago;
      const next: ProNote = { ...base, katago, ...patch, updated: now };
      setNotes((ns) => new Map(ns).set(next.id, next));
      saveNote(next).catch((e) => setMsg(`Not saved: ${(e as Error).message}`));
    },
    [board, game, sel, note, moment, moments, engine],
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      if (sel === null) return;
      const i = queue.indexOf(sel);
      const target = i < 0 ? queue.find((q) => (dir > 0 ? q > sel : q < sel)) : queue[i + dir];
      if (target !== undefined) {
        setSel(target);
        setAfter(false);
      }
    },
    [queue, sel],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        step(1);
        return;
      }
      if (typing(e)) return;
      const v = VERDICTS.find((x) => x.key === e.key);
      if (v) {
        // Without this the key would also land in the reason box once it has focus.
        e.preventDefault();
        update({ verdict: v.id });
        if (v.id !== 'skip') reasonRef.current?.focus();
        return;
      }
      if (e.key === 'ArrowRight' && board && sel !== null) setSel(Math.min(board.moves.length - 1, sel + 1));
      else if (e.key === 'ArrowLeft' && sel !== null) setSel(Math.max(0, sel - 1));
      else if (e.key === 'j') step(1);
      else if (e.key === 'k') step(-1);
      else if (e.key === ' ') {
        e.preventDefault();
        setAfter((a) => !a);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [update, step, board, sel]);

  async function openFiles(files: FileList | null) {
    if (!files) return;
    const added: NoteGame[] = [];
    const errors: string[] = [];
    for (const f of [...files]) {
      try {
        const sgf = await f.text();
        const b = boardFromSgf(sgf);
        if (b.moves.length < 20) throw new Error('fewer than 20 moves');
        const id = gameIdOf(b.size, b.setup, b.moves);
        if (games.some((g) => g.id === id) || added.some((g) => g.id === id)) continue;
        const g: NoteGame = { id, sgf, info: gameInfo(sgf, b), added: Date.now() };
        await saveGame(g);
        added.push(g);
      } catch (e) {
        errors.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    if (added.length) {
      setGames((gs) => [...added, ...gs]);
      setGameId(added[0].id);
    }
    setMsg(errors.length ? `Not opened: ${errors.join('; ')}` : added.length ? `Opened ${added.length} game${added.length > 1 ? 's' : ''}.` : 'Those games are already here.');
  }

  async function importFile(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    const { notes: got, bad } = fromJsonl(await f.text());
    const n = await importNotes(got);
    const all = await allNotes();
    setNotes(new Map(all.map((x) => [x.id, x])));
    setMsg(`Imported ${n} note${n === 1 ? '' : 's'}${bad ? `, skipped ${bad} unreadable line${bad === 1 ? '' : 's'}` : ''}. Games for imported notes have to be opened again.`);
  }

  function exportAll() {
    const day = new Date().toISOString().slice(0, 10);
    download(`kiai-pro-notes-${day}.jsonl`, toJsonl(allList));
    download(`kiai-pro-games-${day}.jsonl`, games.map((g) => JSON.stringify({ id: g.id, info: g.info, sgf: g.sgf })).join('\n') + '\n');
  }

  async function removeGame(id: string) {
    const count = [...notes.values()].filter((n) => n.gameId === id).length;
    if (!confirm(count ? `Remove this game and its ${count} note${count === 1 ? '' : 's'}?` : 'Remove this game?')) return;
    await deleteGame(id);
    setGames((gs) => gs.filter((g) => g.id !== id));
    setNotes((ns) => new Map([...ns].filter(([, n]) => n.gameId !== id)));
    if (gameId === id) setGameId(null);
  }

  // The board: the position before the move (or after it, with Space).
  const view = useMemo(() => {
    if (!board || sel === null) return null;
    const upTo = after ? sel + 1 : sel;
    const b = replay(board.size, board.setup, board.moves, upTo);
    const marks: Mark[] = [];
    const m = board.moves[sel];
    if (m && m.loc !== PASS && !after) marks.push({ loc: m.loc, kind: 'played', label: String(sel + 1) });
    const best = moment?.best ? gtpToLoc(moment.best, board.size) : null;
    if (best !== null && best !== PASS && !after) marks.push({ loc: best, kind: 'best', label: 'K' });
    const better = note?.better ? gtpToLoc(note.better, board.size) : null;
    if (better !== null && better !== PASS && better !== best && !after) marks.push({ loc: better, kind: 'doppel', label: 'P' });
    const last = upTo > 0 ? board.moves[upTo - 1].loc : null;
    return { stones: b.stones, marks, last: last === PASS ? null : last };
  }, [board, sel, after, moment, note]);

  const readNote = board ? (readUpTo < positions.length ? `KataGo reading move ${readUpTo} of ${positions.length - 1}` : `Read at ${depth} visits`) : '';

  return (
    <div className="notes-page">
      <header className="notes-top">
        <a className="notes-back" href="#">
          Kiai
        </a>
        <h1>Pro notes</h1>
        <div className="notes-progress" aria-label="Moments done">
          <div className="notes-bar">
            <span style={{ width: `${Math.min(100, (done / GOAL) * 100)}%` }} />
          </div>
          <b>{done}</b> / {GOAL} moments
        </div>
        {agree.judged > 0 && (
          <div className="notes-agree" title="How your verdicts compare with KataGo so far">
            KataGo right {pct(agree.mistake / agree.judged)} · wrong {pct(agree.katagoWrong / agree.judged)} · same better move {pct(agree.sameMove / agree.judged)}
          </div>
        )}
        <div className="notes-actions">
          <label className="btn">
            Open SGFs
            <input type="file" accept=".sgf,application/x-go-sgf,text/plain" multiple hidden onChange={(e) => openFiles(e.target.files)} />
          </label>
          <button className="btn primary" onClick={exportAll} disabled={!allList.length}>
            Export
          </button>
          <label className="btn">
            Import
            <input type="file" accept=".jsonl,.json,text/plain" hidden onChange={(e) => importFile(e.target.files)} />
          </label>
        </div>
      </header>
      {msg && (
        <p className="notes-msg" role="status">
          {msg} <button onClick={() => setMsg('')}>×</button>
        </p>
      )}
      <div className="notes-body">
        <aside className="notes-games">
          {games.length === 0 && <p className="notes-empty">Open SGFs of pro games from 2024 on. Kiai keeps them in this browser.</p>}
          {games.map((g) => {
            const n = [...notes.values()].filter((x) => x.gameId === g.id && isDone(x) && x.verdict !== 'skip').length;
            return (
              <div key={g.id} className={`notes-game${g.id === gameId ? ' on' : ''}`}>
                <button className="notes-game-main" onClick={() => setGameId(g.id)}>
                  <span className="notes-players">
                    {g.info.black || 'Black'} – {g.info.white || 'White'}
                  </span>
                  <span className="notes-meta">
                    {[g.info.date, g.info.event].filter(Boolean).join(' · ') || 'No date'} · {n} done
                  </span>
                </button>
                <button className="notes-x" aria-label="Remove game" onClick={() => removeGame(g.id)}>
                  ×
                </button>
              </div>
            );
          })}
        </aside>
        <main className="notes-board">
          {board && view ? (
            <>
              <Board size={board.size} stones={view.stones} lastMove={view.last} marks={view.marks} coords skin={KIAI_SKIN} animate={false} onPlay={after ? undefined : (l) => update({ better: locToGtp(l, board.size) })} ariaLabel="Click a point to set the better move" />
              <p className="notes-legend">
                <span className="lg-played">Played</span> <span className="lg-kata">K KataGo</span> <span className="lg-pro">P Your move</span>
              </p>
              <div className="notes-strip" aria-label="Moments in this game">
                {queue.map((q) => {
                  const nn = gameId ? notes.get(noteId(gameId, q)) : undefined;
                  return (
                    <button key={q} className={`notes-dot${q === sel ? ' on' : ''}${nn && isDone(nn) ? ' done' : ''}`} onClick={() => (setSel(q), setAfter(false))}>
                      {q + 1}
                    </button>
                  );
                })}
                {!queue.length && <span className="notes-meta">{readNote}</span>}
              </div>
              <p className="notes-meta">
                {readNote} · {engine.state === 'ready' || engine.state === 'loading' ? engine.text : ''} · depth{' '}
                <select value={depth} onChange={(e) => setDepth(+e.target.value)}>
                  {DEPTHS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </p>
            </>
          ) : (
            <p className="notes-empty">{games.length ? 'Pick a game.' : 'No game yet.'}</p>
          )}
        </main>
        {board && sel !== null && (
          <section className="notes-form">
            <div className="notes-head">
              <button className="btn" onClick={() => step(-1)} aria-label="Previous moment">
                ←
              </button>
              <h2>
                Move {sel + 1} · {board.moves[sel]?.color === 1 ? 'Black' : 'White'} {board.moves[sel] && board.moves[sel].loc !== PASS ? locToGtp(board.moves[sel].loc, board.size) : 'pass'}
              </h2>
              <button className="btn" onClick={() => step(1)} aria-label="Next moment">
                →
              </button>
            </div>
            {moment ? (
              <p className="notes-kata">
                KataGo: <b>{moment.best ?? '—'}</b> was best. This move lost <b>{pts(moment.scoreLoss)}</b> points and <b>{pct(moment.winLoss)}</b> win chance (from {pct(moment.winBefore)}), {moment.visits} visits.
              </p>
            ) : (
              <p className="notes-kata">KataGo has not read this move yet.</p>
            )}
            <div className="notes-verdicts" role="radiogroup" aria-label="Your verdict">
              {VERDICTS.map((v) => (
                <button key={v.id} role="radio" aria-checked={note?.verdict === v.id} className={`btn${note?.verdict === v.id ? ' primary' : ''}`} onClick={() => update({ verdict: v.id as Verdict })}>
                  <kbd>{v.key}</kbd> {v.en} <small>{v.zh}</small>
                </button>
              ))}
            </div>
            <div className="notes-better">
              Better move: <b>{note?.better ?? moment?.best ?? '—'}</b>
              <span className="notes-meta"> click the board to change</span>
              <button className="btn" onClick={() => update({ better: null })}>
                No single move
              </button>
              <button className="btn" onClick={() => setAfter((a) => !a)}>
                {after ? 'Show before' : 'Show after'} <kbd>Space</kbd>
              </button>
            </div>
            <textarea
              ref={reasonRef}
              className="notes-reason"
              placeholder="Why, in your words. 中文或英文都可以。"
              value={note?.reason ?? ''}
              onChange={(e) => update({ reason: e.target.value })}
              rows={5}
            />
            <div className="notes-tags">
              {TAGS.map((t) => {
                const on = !!note?.tags.includes(t.id);
                return (
                  <button key={t.id} className={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => update({ tags: on ? note!.tags.filter((x) => x !== t.id) : [...(note?.tags ?? []), t.id] })}>
                    {t.en} <small>{t.zh}</small>
                  </button>
                );
              })}
            </div>
            <p className="notes-meta">
              <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>0</kbd> verdict · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> next moment · <kbd>←</kbd> <kbd>→</kbd> any move · saved as you type
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
