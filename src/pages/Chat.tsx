import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PositionFacts, ProbeResult } from '../../shared/ask';
import { Board, type Mark } from '../components/Board';
import { useAnalysis, WinBar, type AnalysisBase } from '../components/Analysis';
import { candidateMarks, fromSnapshot, LiveHeader, lineOf, type ShownCandidate } from '../components/Live';
import { BrandSpinner } from '../components/Brand';
import { useLevelOf, usePlayerTargets } from '../components/Level';
import { gameTitle } from '../components/common';
import { Icon } from '../components/Icons';
import { buildProfile, chatTurn, namedMoves } from '../lib/coach/chat';
import { nextBestGap } from '../lib/coach/difficulty';
import { buildFacts } from '../lib/coach/facts';
import { keyMoments } from '../lib/coach/moments';
import { movesTo, type Kifu } from '../lib/kifu/kifu';
import { listKifus } from '../lib/kifu/store';
import { rankLabel } from '../lib/level/ranks';
import { replay } from '../lib/go/board';
import { gtpToLoc, locToGtp } from '../lib/go/coords';
import { engineKomi } from '../lib/go/rules';
import { other, PASS, type Loc, type Move } from '../lib/go/types';
import { corpus } from '../state/actions';
import { appendMessage, deleteConversation, dropLast, loadChats, newConversation, searchPosition, selectConversation, useChat, type ChatPosition } from '../state/chat';
import { runProbe } from '../state/coach';
import { useLive } from '../state/live';
import { gradeMoves, insightFacts, moveDifficulty, proAt, proFacts, type MoveTarget } from '../state/insight';
import { useStore } from '../state/store';
import './chat.css';
import { BackLink } from '../components/ControlSheet';
import { href } from '../router';

/** Where the chat's board comes from. */
type Source = { kind: 'empty'; size: number } | { kind: 'game'; id: string; move: number } | { kind: 'kifu'; id: string };

const DEEP_PREF = 'dop.chat.deep';
const readDeep = () => {
  try {
    return localStorage.getItem(DEEP_PREF) === '1';
  } catch {
    return false;
  }
};

const emptyBase = (size: number): AnalysisBase => ({ size, komi: size === 19 ? 7.5 : size === 13 ? 6.5 : 5.5, rules: 'chinese', setup: [], moves: [], toPlay: 1 });
const baseKey = (b: AnalysisBase) => `${b.size}|${b.komi}|${b.setup.map((m) => `${m.color}${m.loc}`).join(',')}|${b.moves.map((m) => `${m.color}${m.loc}`).join(',')}|${b.toPlay}`;

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | undefined> => Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);

const START_GENERAL = [
  'Two-week study plan',
  'Improve life and death',
  'Explain sente and gote',
  'How to review my games',
  'Thickness vs territory',
];
const START_BOARD = ['Best move and why?', 'Which groups are weak?', 'Plan for both sides?', 'What did pros play?'];

/** Text with **bold**, "- " lists and clickable coordinates. */
function Rich({ text, size, onCoord }: { text: string; size?: number; onCoord?: (gtp: string) => void }) {
  const inline = (s: string, key: string): ReactNode[] => {
    const out: ReactNode[] = [];
    s.split(/(\*\*[^*]+\*\*)/g).forEach((part, i) => {
      const bold = /^\*\*[^*]+\*\*$/.test(part);
      const body = bold ? part.slice(2, -2) : part;
      const pieces: ReactNode[] = [];
      if (size && onCoord) {
        const letters = 'ABCDEFGHJKLMNOPQRSTUVWXYZ'.slice(0, size);
        const re = new RegExp(`(?<![A-Za-z0-9])([${letters}])(\\d{1,2})(?![A-Za-z0-9])`, 'g');
        let last = 0;
        for (const m of body.matchAll(re)) {
          if (Number(m[2]) < 1 || Number(m[2]) > size) continue;
          pieces.push(body.slice(last, m.index));
          const g = m[0];
          pieces.push(
            <button key={`${key}-${i}-${m.index}`} className="coord" onClick={() => onCoord(g)} title={`Show ${g}`}>
              {g}
            </button>,
          );
          last = m.index! + g.length;
        }
        pieces.push(body.slice(last));
      } else pieces.push(body);
      out.push(bold ? <strong key={`${key}-${i}`}>{pieces}</strong> : <Fragment key={`${key}-${i}`}>{pieces}</Fragment>);
    });
    return out;
  };
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/);
  return (
    <>
      {blocks.map((b, bi) => {
        const lines = b.split('\n').filter((l) => l.trim());
        if (lines.length && lines.every((l) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l))) {
          const ordered = /^\s*\d/.test(lines[0]);
          const items = lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''), `${bi}-${li}`)}</li>);
          return ordered ? <ol key={bi}>{items}</ol> : <ul key={bi}>{items}</ul>;
        }
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {inline(l.replace(/^#+\s*/, ''), `${bi}-${li}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}

function probeText(p: ProbeResult) {
  if (!p.legal || p.blackWinrate === undefined) return `${p.moves.join(' ')}: ${p.note ?? 'not playable'}`;
  return `${p.moves.join(' ')} → Black ${p.blackWinrate.toFixed(0)}%, ${p.blackLead! >= 0 ? 'B' : 'W'}+${Math.abs(p.blackLead!).toFixed(1)}`;
}

export function Chat({ query }: { query: URLSearchParams }) {
  const games = useStore((s) => s.games);
  const analyses = useStore((s) => s.analyses);
  const weaknesses = useStore((s) => s.weaknesses);
  const llm = useStore((s) => s.llm);
  const useLlm = useStore((s) => s.settings.useLlm);
  const targets = usePlayerTargets();
  const { level } = useLevelOf(targets);
  const { loaded, list, currentId } = useChat();
  const conv = list.find((c) => c.id === currentId) ?? null;

  const [source, setSource] = useState<Source | null>(null);
  const [base, setBase] = useState<AnalysisBase | null>(null);
  const [boardOn, setBoardOn] = useState(false);
  const [showBest, setShowBest] = useState(true);
  const [kifus, setKifus] = useState<Kifu[]>([]);
  const [highlight, setHighlight] = useState<Loc | null>(null);
  const [shownLine, setShownLine] = useState<Move[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [deep, setDeep] = useState(readDeep);
  const [showList, setShowList] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const a = useAnalysis(boardOn ? base : null, boardOn);
  const evRef = useRef(a.eval);
  evRef.current = a.eval;

  useEffect(() => {
    void loadChats();
    void listKifus()
      .then(setKifus)
      .catch(() => {});
  }, []);

  // #/chat?game=<id>&move=<n>: open with that game position on the board (from Game Review).
  const qGame = query.get('game');
  const qMove = query.get('move');
  useEffect(() => {
    if (!qGame) return;
    const g = games.find((x) => x.id === qGame);
    if (!g) return;
    pickSource({ kind: 'game', id: g.id, move: Math.max(0, Math.min(g.moves.length, Number(qMove) || 0)) });
    setBoardOn(true);
    if (loaded && query.get('new') !== '0') newConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qGame, qMove, loaded]);

  useEffect(() => {
    const last = logRef.current?.lastElementChild as HTMLElement | null | undefined;
    if (conv?.messages.length || busy) last?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [conv?.messages.length, busy]);

  useEffect(() => {
    setHighlight(null);
    setShownLine(null);
  }, [a.cursor, a.line.length, base]);

  function pickSource(s: Source) {
    setSource(s);
    if (s.kind === 'empty') setBase(emptyBase(s.size));
    else if (s.kind === 'game') {
      const g = games.find((x) => x.id === s.id);
      if (!g) return;
      const moves = g.moves.slice(0, s.move);
      const toPlay = g.moves[s.move]?.color ?? (moves.length ? other(moves[moves.length - 1].color) : g.setup.some((m) => m.color === 1) && g.handicap > 1 ? 2 : 1);
      setBase({ size: g.size, komi: g.komi, rules: g.rules, setup: g.setup, moves, toPlay });
    } else {
      const k = kifus.find((x) => x.id === s.id);
      if (!k) return;
      const moves = movesTo(k, k.cursor);
      setBase({ size: k.size, komi: k.komi, rules: k.rules, setup: k.setup, moves, toPlay: moves.length ? other(moves[moves.length - 1].color) : k.first });
    }
  }

  const game = source?.kind === 'game' ? games.find((g) => g.id === source.id) : undefined;
  /** The position on the board now (starting position plus the moves tried on it). */
  const flat: AnalysisBase | null = base && a.board ? { ...base, moves: [...base.moves, ...a.played], toPlay: a.toPlay } : null;
  const flatRef = useRef(flat);
  flatRef.current = flat;
  const positionLabel = (): string => {
    if (!flat) return '';
    const tried = a.played.length ? ` +${a.played.length}` : '';
    if (source?.kind === 'game' && game) return `Move ${source.move + 1} of ${gameTitle(game)}${tried}`;
    if (source?.kind === 'kifu') return `${kifus.find((k) => k.id === source.id)?.title ?? 'Kifu'}${tried}`;
    return `${flat.size}×${flat.size}${flat.moves.length ? `, move ${flat.moves.length}` : ''}`;
  };

  /** KataGo's fact sheet for the board: its own read (deeper in deep mode), pro games, difficulty, the game's key moments. */
  async function gatherFacts(pos: AnalysisBase, from: Source | null, useDeep: boolean): Promise<PositionFacts> {
    const want = useDeep ? 1200 : 300;
    let cands: ShownCandidate[];
    let bWin: number, bLead: number, visits: number;
    let ownership: Float32Array | null;
    const same = () => !!flatRef.current && baseKey(flatRef.current) === baseKey(pos);
    let live = same() ? evRef.current : null;
    if (same() && useLive.getState().on && (!live || live.visits < want)) {
      // Live analysis is already reading this position: let it read on rather than start a second search.
      setBusy(`Reading${useDeep ? ' deep' : ''}…`);
      const until = Date.now() + (useDeep ? 10_000 : 4000);
      while (Date.now() < until && same() && (!evRef.current || evRef.current.visits < want)) await new Promise((r) => setTimeout(r, 250));
      live = same() ? evRef.current : null;
    }
    if (live && live.shown.length && (live.visits >= want * 0.25 || useLive.getState().on)) {
      ({ bWin, bLead, visits, ownership } = live);
      cands = live.shown;
    } else {
      setBusy(`Reading${useDeep ? ' deep' : ''}…`);
      const snap = await searchPosition(pos, want, useDeep ? 10_000 : 4000);
      if (!snap || !snap.candidates.length) throw new Error('KataGo failed to read the position. Check Settings.');
      ({ bWin, bLead, visits, ownership } = snap);
      cands = fromSnapshot(snap);
    }
    const board = replay(pos.size, pos.setup, pos.moves);
    const komi = engineKomi(pos.komi, pos.rules);
    const g = from?.kind === 'game' ? games.find((x) => x.id === from.id) : undefined;
    const atGame = g && from?.kind === 'game' && pos.moves.length === from.move ? from.move : null;
    const rec = atGame !== null && g ? corpus().records.find((r) => r.gameId === g.id && r.index === atGame) : undefined;
    const next = atGame !== null && g ? g.moves[atGame] : undefined;
    const last = pos.moves[pos.moves.length - 1];
    const facts = buildFacts({
      board,
      komi,
      moveNumber: pos.moves.length + 1,
      toPlay: pos.toPlay,
      lastMove: last ? last.loc : null,
      bWin,
      bLead,
      visits,
      candidates: cands,
      ownership,
      played: next && rec ? { loc: next.loc, winrateLoss: rec.winrateLoss, scoreLoss: rec.scoreLoss, bestLoc: rec.bestLoc } : null,
      level: level ? `about ${rankLabel(level.overall.rank)}` : undefined,
    });
    setBusy('Checking pro games…');
    const best = cands[0];
    const tgts: MoveTarget[] = [];
    if (best && best.loc !== PASS) tgts.push({ loc: best.loc, role: 'KataGo', input: { scoreLoss: 0, winrateLoss: 0, isBest: true, gap: nextBestGap(cands, visits) } });
    if (next && rec && next.loc !== PASS && next.loc !== best?.loc) tgts.push({ loc: next.loc, role: 'played', input: { scoreLoss: rec.scoreLoss, winrateLoss: rec.winrateLoss, isBest: false } });
    const spec = { size: pos.size, komi, setup: pos.setup, history: pos.moves, toPlay: pos.toPlay, board };
    const [pro, diffs] = await Promise.all([
      withTimeout(proAt(board.stones, pos.toPlay, pos.size, next?.loc).catch(() => null), 3000),
      tgts.length
        ? withTimeout(
            moveDifficulty(`chat|${baseKey(pos)}`, spec, tgts.map((t) => t.loc), level ? [level.overall.rank] : []).catch(() => null),
            useDeep ? 9000 : 5000,
          )
        : Promise.resolve(null),
    ]);
    if (pro) facts.pro = proFacts(pro, pos.size);
    if (diffs?.length) facts.insights = insightFacts(gradeMoves(tgts, diffs), pos.size);
    if (g) {
      const records = corpus().records.filter((r) => r.gameId === g.id);
      facts.keyMoments = keyMoments(records, analyses[g.id]).map((k) => ({
        move: k.index + 1,
        player: k.color === 1 ? ('Black' as const) : ('White' as const),
        kind: k.kind === 'only-move' ? ('only move' as const) : ('turning point' as const),
        played: locToGtp(k.played, g.size),
        kataGo: locToGtp(k.best, g.size),
        found: k.found,
        winrateLoss: Math.round(k.winrateLoss * 1000) / 10,
        pointsLost: Math.round(k.scoreLoss * 10) / 10,
        gap: k.gap ? { points: Math.round(k.gap.points * 10) / 10, winrate: Math.round(k.gap.win * 1000) / 10 } : undefined,
      }));
    }
    return facts;
  }

  async function send(raw: string) {
    const q = raw.trim();
    if (!q || busy) return;
    const id = useChat.getState().currentId && useChat.getState().list.some((c) => c.id === useChat.getState().currentId) ? useChat.getState().currentId! : newConversation();
    const pos: ChatPosition | undefined = boardOn && flat ? { label: positionLabel(), base: flat } : undefined;
    const from = source;
    const useDeep = deep;
    appendMessage(id, { role: 'user', text: q, at: Date.now(), pos });
    setText('');
    setBusy(pos ? 'Reading…' : 'Thinking…');
    try {
      const facts = pos ? await gatherFacts(pos.base, from, useDeep) : undefined;
      const board = pos ? replay(pos.base.size, pos.base.setup, pos.base.moves) : null;
      const convo = useChat.getState().list.find((c) => c.id === id);
      const messages = (convo?.messages ?? []).filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
      const pre =
        facts && board && pos
          ? namedMoves(q, facts, (gtp) => {
              const loc = gtpToLoc(gtp, pos.base.size);
              return loc !== PASS && board.stones[loc] === 0 && board.isLegal(loc, pos.base.toPlay);
            })
          : [];
      const probeBase = pos && board ? { size: pos.base.size, komi: engineKomi(pos.base.komi, pos.base.rules), setup: pos.base.setup, moves: pos.base.moves, toPlay: pos.base.toPlay, board } : null;
      const out = await chatTurn(
        { messages, position: facts, profile: buildProfile(level, weaknesses, targets.length), deep: useDeep, pre },
        (p) => (probeBase ? runProbe(probeBase, p, useDeep ? 500 : 180, useDeep ? 9000 : 5000) : Promise.resolve({ moves: p.moves, legal: false, note: 'no board' })),
        setBusy,
      );
      appendMessage(id, {
        role: 'coach',
        text: out.answer,
        at: Date.now(),
        pos,
        probes: out.probes.length ? out.probes : undefined,
        unsupported: out.unsupported.length ? out.unsupported : undefined,
        followups: out.followups.length ? out.followups : undefined,
        meta: { deep: useDeep, corrected: out.corrected, reviewed: out.reviewed, calls: out.calls, model: out.model, visits: facts?.visits },
      });
    } catch (e) {
      appendMessage(id, { role: 'coach', text: (e as Error).message || 'Error.', at: Date.now(), error: true });
    } finally {
      setBusy(null);
    }
  }

  const retry = () => {
    if (!conv || busy) return;
    const msgs = conv.messages;
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    dropLast(conv.id);
    if (msgs[msgs.length - 1].role === 'coach') dropLast(conv.id);
    if (lastUser.pos) showPosition(lastUser.pos);
    void send(lastUser.text);
  };

  function showPosition(p: ChatPosition) {
    setSource(null);
    setBase(p.base);
    setBoardOn(true);
  }

  /** Point at a coordinate (or show a line) on the position the message was about. */
  const focus = (p: ChatPosition | undefined, act: () => void) => {
    if (p && (!flat || baseKey(flat) !== baseKey(p.base))) {
      showPosition(p);
      setTimeout(act, 60);
    } else act();
  };

  const off = !useLlm ? 'LLM is off in Settings.' : llm && !llm.configured ? 'LLM_API_KEY is not set on the server.' : null;

  // Board marks.
  const ev = a.eval;
  const marks: Mark[] = [];
  if (highlight !== null) marks.push({ loc: highlight, kind: 'evidence' });
  const candidates = ev && showBest && !shownLine && ev.shown.length ? candidateMarks(ev.shown, 6) : null;
  const lastLoc = a.played.length ? a.played[a.played.length - 1].loc : base?.moves.length ? base.moves[base.moves.length - 1].loc : null;

  const sortedGames = useMemo(() => [...games].sort((x, y) => y.importedAt - x.importedAt).slice(0, 60), [games]);
  const sourceValue = !source ? '' : source.kind === 'empty' ? `empty:${source.size}` : `${source.kind}:${source.id}`;

  const boardPanel = boardOn && base && a.board && (
    <div className="chat-board">
      <div className="board-frame">
        <Board
          size={base.size}
          stones={a.board.stones}
          lastMove={lastLoc}
          toPlay={a.toPlay}
          onPlay={(l) => a.play(l)}
          marks={marks}
          candidates={candidates}
          variation={shownLine}
          coords
          ariaLabel="Chat board"
        />
      </div>
      <div className="panel stack tight chat-board-panel">
        <LiveHeader snap={a.snap} />
        <WinBar bWin={ev?.bWin ?? null} bLead={ev?.bLead ?? null} pending={!ev?.searched} />
        <div className="row wrap">
          <button className="btn small" onClick={a.undo} disabled={a.cursor === 0}>
            ◀ Undo
          </button>
          <button className="btn small" onClick={a.redo} disabled={a.cursor >= a.line.length}>
            Redo ▶
          </button>
          <button className="btn small" onClick={a.reset} disabled={a.cursor === 0}>
            ⟲ Start
          </button>
          <label className="toggle small">
            <input type="checkbox" checked={showBest} onChange={(e) => setShowBest(e.target.checked)} /> Hints
          </label>
          {shownLine && (
            <button className="btn small ghost" onClick={() => setShownLine(null)}>
              Hide
            </button>
          )}
        </div>
        <div className="tiny muted">{a.toPlay === 1 ? 'Black' : 'White'} to play · {positionLabel()}</div>
      </div>
    </div>
  );

  return (
    <div className={`chat-page ${boardOn ? 'with-board' : ''}`}>
      <aside className={`chat-list panel ${showList ? 'open' : ''}`}>
        <button
          className="btn primary small"
          onClick={() => {
            newConversation();
            setShowList(false);
            inputRef.current?.focus();
          }}
        >
          + New
        </button>
        <div className="chat-list-items">
          {list.map((c) => (
            <div key={c.id} className={`chat-list-item ${c.id === currentId ? 'on' : ''}`}>
              <button
                className="chat-list-title"
                onClick={() => {
                  selectConversation(c.id);
                  setShowList(false);
                }}
              >
                {c.title}
              </button>
              <button className="chat-list-del" onClick={() => deleteConversation(c.id)} title="Delete" aria-label={`Delete ${c.title}`}>
                ×
              </button>
            </div>
          ))}
          {loaded && !list.length && <div className="tiny muted">No chats.</div>}
        </div>
      </aside>

      <section className="chat-main">
        <header className="chat-head">
          {qGame && <BackLink href={href(`review/${qGame}?move=${(Number(qMove) || 0) + 1}`)} label="Review" />}
          <button className="btn small ghost chat-list-toggle" onClick={() => setShowList((v) => !v)} aria-expanded={showList}>
            ☰ Chats
          </button>
          <div className="chat-title">
            <Icon name="chat" />
            <div>
              <strong>Coach</strong>
              <span className="tiny muted">{conv && conv.messages.length ? conv.title : 'Backed by KataGo'}</span>
            </div>
          </div>
          <div className="row">
            <select
              className="chat-source"
              value={boardOn ? sourceValue : ''}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return setBoardOn(false);
                const [kind, id] = v.split(':');
                if (kind === 'empty') pickSource({ kind: 'empty', size: Number(id) });
                else if (kind === 'game') {
                  const g = games.find((x) => x.id === id);
                  pickSource({ kind: 'game', id, move: g ? Math.min(g.moves.length, Math.floor(g.moves.length / 2)) : 0 });
                } else pickSource({ kind: 'kifu', id });
                setBoardOn(true);
              }}
              aria-label="Board"
            >
              <option value="">No board</option>
              {boardOn && !source && <option value="">{positionLabel() || 'Chat position'}</option>}
              <optgroup label="Empty">
                <option value="empty:19">19×19</option>
                <option value="empty:13">13×13</option>
                <option value="empty:9">9×9</option>
              </optgroup>
              {sortedGames.length > 0 && (
                <optgroup label="Games">
                  {sortedGames.map((g) => (
                    <option key={g.id} value={`game:${g.id}`}>
                      {gameTitle(g)}
                    </option>
                  ))}
                </optgroup>
              )}
              {kifus.length > 0 && (
                <optgroup label="Kifu">
                  {kifus.map((k) => (
                    <option key={k.id} value={`kifu:${k.id}`}>
                      {k.title}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {boardOn && source?.kind === 'game' && game && (
              <label className="chat-move tiny">
                Move
                <input
                  type="number"
                  min={1}
                  max={game.moves.length + 1}
                  value={source.move + 1}
                  title="Next move"
                  onChange={(e) => pickSource({ kind: 'game', id: game.id, move: Math.max(0, Math.min(game.moves.length, (Number(e.target.value) || 1) - 1)) })}
                />
              </label>
            )}
          </div>
        </header>

        <div className="chat-log" ref={logRef}>
          {(!conv || conv.messages.length === 0) && (
            <div className="chat-empty">
              <h2>Ask the coach</h2>
              <p className="small dim">Every number is checked against KataGo.</p>
              <div className="chat-starters">
                {(boardOn ? START_BOARD : START_GENERAL).map((s) => (
                  <button key={s} className="chip click" onClick={() => void send(s)} disabled={!!off || !!busy}>
                    {s}
                  </button>
                ))}
              </div>
              {!boardOn && (
                <button className="btn small" onClick={() => (pickSource({ kind: 'empty', size: 19 }), setBoardOn(true))}>
                  Add board
                </button>
              )}
            </div>
          )}
          {conv?.messages.map((m, i) => {
            const isLast = i === conv.messages.length - 1;
            return (
              <div key={i} className={`msg ${m.role} ${m.error ? 'error' : ''}`}>
                {m.role === 'user' && m.pos && (
                  <button className="msg-pos tiny" onClick={() => showPosition(m.pos!)} title="Show position">
                    ◉ {m.pos.label}
                  </button>
                )}
                <div className="msg-body">
                  {m.role === 'coach' && !m.error ? (
                    <Rich text={m.text} size={m.pos?.base.size} onCoord={m.pos ? (g) => focus(m.pos, () => (setShownLine(null), setHighlight(gtpToLoc(g, m.pos!.base.size)))) : undefined} />
                  ) : (
                    <p>{m.text}</p>
                  )}
                </div>
                {m.probes && m.pos && (
                  <div className="msg-probes">
                    <span className="tiny muted">Checked:</span>
                    {m.probes.map((p, k) => (
                      <button
                        key={k}
                        className="chip click tiny"
                        disabled={!p.legal}
                        onClick={() =>
                          focus(m.pos, () => {
                            const locs = [...p.moves, ...(p.bestLine ?? [])].map((x) => (x === 'PASS' ? PASS : gtpToLoc(x, m.pos!.base.size)));
                            setHighlight(null);
                            setShownLine(lineOf(locs, m.pos!.base.toPlay));
                          })
                        }
                        title="Show line"
                      >
                        {probeText(p)}
                      </button>
                    ))}
                  </div>
                )}
                {m.unsupported && <div className="tiny warn-text">Unverified: {m.unsupported.join('; ')}</div>}
                {m.meta && (
                  <div className="msg-meta tiny muted">
                    {m.meta.visits ? `${m.meta.visits} visits · ` : ''}
                    {m.meta.deep ? 'deep · ' : ''}
                    {m.meta.reviewed ? 'reviewed · ' : ''}
                    {m.meta.corrected ? 'corrected · ' : 'checked · '}
                    {m.meta.calls} call{m.meta.calls === 1 ? '' : 's'}
                  </div>
                )}
                {m.error && isLast && (
                  <button className="btn small" onClick={retry} disabled={!!busy}>
                    Retry
                  </button>
                )}
                {m.followups && isLast && !busy && (
                  <div className="chat-starters">
                    {m.followups.map((f) => (
                      <button key={f} className="chip click" onClick={() => void send(f)}>
                        {f}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {busy && (
            <div className="msg coach pending">
              <div className="row small">
                <BrandSpinner /> {busy}
              </div>
            </div>
          )}
        </div>

        <form
          className="chat-compose"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          {off ? (
            <div className="small dim">{off}</div>
          ) : (
            <>
              <textarea
                ref={inputRef}
                value={text}
                rows={2}
                maxLength={1800}
                placeholder={boardOn ? 'Ask about this position…' : 'Ask anything…'}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send(text);
                  }
                }}
                aria-label="Message"
              />
              <div className="chat-compose-bar">
                <div className="chat-mode" role="radiogroup" aria-label="Answer mode">
                  {(
                    [
                      [false, 'Fast', 'One call, a few seconds'],
                      [true, 'Deep', '4x longer read, answer reviewed'],
                    ] as const
                  ).map(([v, label, title]) => (
                    <button
                      key={label}
                      type="button"
                      role="radio"
                      aria-checked={deep === v}
                      className={deep === v ? 'on' : ''}
                      title={title}
                      onClick={() => {
                        setDeep(v);
                        try {
                          localStorage.setItem(DEEP_PREF, v ? '1' : '0');
                        } catch {
                          /* private mode */
                        }
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {!boardOn && (
                  <button type="button" className="btn small ghost" onClick={() => (pickSource(source ?? { kind: 'empty', size: 19 }), setBoardOn(true))}>
                    + Board
                  </button>
                )}
                {boardOn && (
                  <button type="button" className="btn small ghost" onClick={() => setBoardOn(false)}>
                    Hide board
                  </button>
                )}
                <button className="btn small primary" disabled={!text.trim() || !!busy}>
                  Send
                </button>
              </div>
            </>
          )}
          <p className="tiny muted">Chats stay local. Messages go to Gemini via this server.</p>
        </form>
      </section>

      {boardPanel && <div className="chat-board-side">{boardPanel}</div>}
    </div>
  );
}
