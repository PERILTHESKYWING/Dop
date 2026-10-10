import { create } from 'zustand';
import type { PositionSpec } from '../lib/analysis/analyzer';
import { gtpToLoc, locToGtp } from '../lib/go/coords';
import { PASS, type Color, type Loc, type Move } from '../lib/go/types';
import type { SearchCandidate, SearchSnapshot } from '../lib/engine/mcts';
import { encodeOwnership, round, topPolicy } from '../lib/engine/parse';
import type { Candidate, GameRecord, PositionEval } from '../lib/types';
import { engineKomi } from '../lib/go/rules';
import { isPhoneLike } from '../lib/engine/governor';
import { get as getApp } from './store';
import { setPcAnswer } from './brain';

/**
 * The PC helper (pc-helper/dop_pc.py): native KataGo with a big network on the user's own
 * graphics card, at http://127.0.0.1:7474 on that computer (or, for a phone, at the
 * Cloudflare tunnel address the helper prints). While it answers, the site uses it for
 * live analysis and for game analysis instead of computing in the browser; when it does
 * not, everything runs here as before.
 */

export interface PcState {
  status: 'off' | 'connected' | 'error';
  address: string;
  network?: string;
  backend?: string;
  note?: string;
  /** Positions it has analysed for this browser. */
  analysed: number;
}

export const LOCAL_PC = 'http://127.0.0.1:7474';
export const usePc = create<PcState>(() => ({ status: 'off', address: LOCAL_PC, analysed: 0 }));

const addressOf = () => (getApp().settings.pcAddress || LOCAL_PC).replace(/\/+$/, '');
const codeOf = () => getApp().settings.pcCode || pairedCode || '';
let pairedCode = '';

export const pcReady = () => usePc.getState().status === 'connected';

/**
 * Chrome asks before a public site talks to this computer or the home network (Private
 * Network Access); naming the address space up front makes it ask instead of refusing. A
 * tunnel address is public, and naming it 'local' would make the request fail.
 */
function localSpace(): object {
  const host = (() => {
    try {
      return new URL(addressOf()).hostname;
    } catch {
      return '';
    }
  })();
  const local = host === 'localhost' || host === '[::1]' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  return local ? { targetAddressSpace: 'local' } : {};
}

async function call<T>(path: string, init: RequestInit = {}, timeoutMs = 4000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(addressOf() + path, {
      ...init,
      signal: init.signal ?? ctl.signal,
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), 'x-dop-token': codeOf(), ...(init.headers ?? {}) },
      ...localSpace(),
    });
    if (!r.ok) throw new Error(`PC helper: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Look for the helper once; returns whether it answers. */
export async function probePc(): Promise<boolean> {
  const address = addressOf();
  try {
    const st = await call<{ app: string; ready: boolean; network: string; backend: string }>('/status', {}, 1500);
    if (st.app !== 'dop-pc') throw new Error('not the PC helper');
    if (!codeOf() && address === LOCAL_PC) pairedCode = (await call<{ token: string }>('/pair', {}, 1500)).token;
    usePc.setState({ status: st.ready ? 'connected' : 'off', address, network: st.network, backend: st.backend, note: st.ready ? undefined : 'KataGo is starting on the PC' });
    return st.ready;
  } catch (e) {
    const was = usePc.getState().status;
    usePc.setState({ status: was === 'connected' ? 'error' : 'off', address, note: was === 'connected' ? (e as Error).message : undefined });
    return false;
  }
}

let watching = false;
/**
 * Keep looking for the helper: on a computer always (it may be started any time), on a
 * phone only when an address was entered. Every 20 seconds while absent, every minute
 * while present.
 */
export function watchPc() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  setPcAnswer(pcAnswer);
  const loop = async () => {
    const wanted = !isPhoneLike() || !!getApp().settings.pcAddress;
    const ok = wanted && getApp().settings.pcUse !== 'off' ? await probePc() : false;
    if (!wanted) usePc.setState({ status: 'off' });
    setTimeout(loop, ok ? 60_000 : 20_000);
  };
  void loop();
}

// ------------------------------------------------------------------ KataGo's answers

interface KgMoveInfo {
  move: string;
  visits: number;
  winrate: number;
  scoreLead: number;
  prior: number;
  order: number;
  pv: string[];
}

export interface KgResult {
  id: string;
  isDuringSearch?: boolean;
  turnNumber: number;
  moveInfos: KgMoveInfo[];
  rootInfo: { winrate: number; scoreLead: number; visits: number; currentPlayer: 'B' | 'W' };
  ownership?: number[];
  policy?: number[];
  error?: string;
}

const gtp = (l: Loc, size: number) => (l === PASS || l < 0 ? 'pass' : locToGtp(l, size));
const fromGtp = (s: string, size: number) => (s.toLowerCase() === 'pass' ? PASS : gtpToLoc(s, size));
const letter = (c: Color) => (c === 1 ? 'B' : 'W');

interface PcQuery {
  size: number;
  komi: number;
  setup: Move[];
  moves: Move[];
  toPlay: Color;
}

function body(q: PcQuery, extra: Record<string, unknown>) {
  return {
    initialStones: q.setup.map((m) => [letter(m.color), gtp(m.loc, q.size)]),
    moves: q.moves.map((m) => [letter(m.color), gtp(m.loc, q.size)]),
    initialPlayer: q.moves.length ? undefined : letter(q.toPlay),
    komi: q.komi,
    rules: 'chinese',
    boardXSize: q.size,
    boardYSize: q.size,
    ...extra,
  };
}

/** KataGo's answer as a live-analysis result. */
export function pcSnapshot(r: KgResult, toPlay: Color, size: number, elapsedMs = 0): SearchSnapshot {
  const hw = size * size;
  const mover = (bWin: number) => (toPlay === 1 ? bWin : 1 - bWin);
  const lead = (bLead: number) => (toPlay === 1 ? bLead : -bLead);
  const candidates: SearchCandidate[] = [...r.moveInfos]
    .sort((a, b) => a.order - b.order)
    .map((m) => ({ loc: fromGtp(m.move, size), visits: m.visits, winrate: mover(m.winrate), scoreLead: lead(m.scoreLead), prior: m.prior, pv: m.pv.slice(0, 24).map((s) => fromGtp(s, size)) }));
  let policy: Float32Array | null = null;
  if (r.policy?.length === hw + 1) policy = Float32Array.from(r.policy, (p) => Math.max(0, p));
  else {
    policy = new Float32Array(hw + 1);
    for (const c of candidates) policy[c.loc === PASS ? hw : c.loc] = c.prior;
  }
  const ownership = r.ownership?.length === hw ? Float32Array.from(r.ownership) : null;
  return { toPlay, visits: r.rootInfo.visits, bWin: r.rootInfo.winrate, bLead: r.rootInfo.scoreLead, candidates, policy, ownership, nodes: 0, evalsPerSec: elapsedMs > 0 ? (r.rootInfo.visits * 1000) / elapsedMs : 0, elapsedMs };
}

/** KataGo's answer as a stored analysis of a position, on top of this device's first look. */
export function pcEval(r: KgResult, fast: PositionEval, size: number, played?: Loc): PositionEval {
  const snap = pcSnapshot(r, fast.toPlay, size);
  const keep = snap.candidates.slice(0, 10);
  const p = played !== undefined ? snap.candidates.find((c) => c.loc === played) : undefined;
  if (p && !keep.includes(p)) keep.push(p);
  const cands: Candidate[] = keep.map((c) => ({ loc: c.loc, prior: round(c.prior, 5), winrate: round(c.winrate), scoreLead: round(c.scoreLead, 2), visits: c.visits, pv: c.pv.slice(0, 16) }));
  const net = fast.net ?? (fast.searched ? undefined : { bWin: fast.bWin, bLead: fast.bLead });
  return {
    ...fast,
    ...(net ? { net } : {}),
    bWin: round(snap.bWin),
    bLead: round(snap.bLead, 2),
    candidates: cands,
    bestLoc: snap.candidates[0]?.loc ?? fast.bestLoc,
    pv: snap.candidates[0]?.pv.slice(0, 20) ?? [],
    visits: snap.visits,
    depth: 'deep',
    searched: true,
    source: 'pc',
    ...(snap.ownership ? { ownership: encodeOwnership(snap.ownership) } : {}),
    ...(r.policy ? { policy: topPolicy(snap.policy!, 12) } : {}),
    analyzedAt: Date.now(),
  };
}

/** Visits per position the PC spends on game analysis. */
export const pcVisits = () => getApp().settings.pcVisits || 800;

// --------------------------------------------------------------- game analysis on the PC

/** A whole game sent at once (KataGo searches its positions side by side), by game id. */
const prefetched = new Map<string, { moves: Move[]; results: Promise<Map<number, KgResult>> }>();

/** Ask the PC to analyse every position of a game in one go; positions arrive in the cache below. */
export function pcPrefetchGame(game: GameRecord) {
  if (!pcReady() || prefetched.has(game.id)) return;
  const turns = Array.from({ length: game.moves.length + 1 }, (_, i) => i);
  const komi = engineKomi(game.komi, game.rules);
  const p = call<KgResult[]>(
    '/analyze',
    { method: 'POST', body: JSON.stringify(body({ size: game.size, komi, setup: game.setup, moves: game.moves, toPlay: game.moves[0]?.color ?? 1 }, { maxVisits: pcVisits(), analyzeTurns: turns, includeOwnership: true, includePolicy: true })) },
    30 * 60_000,
  )
    .then((rs) => new Map(rs.map((r) => [r.turnNumber, r])))
    .catch(() => {
      prefetched.delete(game.id);
      return new Map<number, KgResult>();
    });
  prefetched.set(game.id, { moves: game.moves, results: p });
  // Forget it once the game is done.
  setTimeout(() => prefetched.delete(game.id), 60 * 60_000);
}

/** The PC's answer for a position of a game being analysed (pipeline.ts `known`). */
async function pcAnswer(spec: PositionSpec, fast: PositionEval): Promise<PositionEval | null> {
  if (!pcReady()) return null;
  const turn = spec.history.length;
  for (const p of prefetched.values()) {
    // The same game: the PC's answer is for exactly these moves.
    if (p.moves.length < turn || !spec.history.every((m, i) => m.loc === p.moves[i].loc && m.color === p.moves[i].color)) continue;
    const r = (await p.results).get(turn);
    if (r && r.rootInfo.currentPlayer === letter(spec.toPlay)) {
      usePc.setState((s) => ({ analysed: s.analysed + 1 }));
      return pcEval(r, fast, spec.size, p.moves[turn]?.loc);
    }
  }
  try {
    const [r] = await call<KgResult[]>('/analyze', { method: 'POST', body: JSON.stringify(body({ ...spec, moves: spec.history }, { maxVisits: pcVisits(), includeOwnership: true, includePolicy: true })) }, 120_000);
    usePc.setState((s) => ({ analysed: s.analysed + 1 }));
    return pcEval(r, fast, spec.size);
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------- live analysis on the PC

/**
 * Search a position on the PC, reporting as it goes (about four times a second) until
 * `visits` or until stopped. Resolves with the last result.
 */
export async function pcPonder(
  q: PcQuery,
  visits: number,
  onUpdate: (snap: SearchSnapshot) => void,
  shouldStop: () => boolean,
): Promise<SearchSnapshot | null> {
  const ctl = new AbortController();
  const t0 = performance.now();
  let last: SearchSnapshot | null = null;
  let queryId = '';
  const r = await fetch(addressOf() + '/analyze', {
    method: 'POST',
    signal: ctl.signal,
    headers: { 'content-type': 'application/json', 'x-dop-token': codeOf() },
    body: JSON.stringify(body(q, { maxVisits: Math.min(visits, 5_000_000), reportDuringSearchEvery: 0.25, includeOwnership: true, includePolicy: true })),
    ...localSpace(),
  });
  if (!r.ok || !r.body) throw new Error(`PC helper: HTTP ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const stopTimer = setInterval(() => {
    if (shouldStop()) {
      clearInterval(stopTimer);
      if (queryId) void call('/stop', { method: 'POST', body: JSON.stringify({ id: queryId }) }).catch(() => {});
      ctl.abort();
    }
  }, 100);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line) as KgResult & { queryId?: string };
        if (msg.queryId) queryId = msg.queryId;
        else if (msg.error) throw new Error(`PC helper: ${msg.error}`);
        else if (msg.moveInfos) {
          last = pcSnapshot(msg, q.toPlay, q.size, performance.now() - t0);
          onUpdate(last);
        }
      }
    }
  } catch (e) {
    if (!ctl.signal.aborted) throw e;
  } finally {
    clearInterval(stopTimer);
  }
  return last;
}

/** Positions for the PC: the stones before the moves (setup) and the moves. */
export function pcQueryOf(size: number, komi: number, setup: Move[], moves: Move[], toPlay: Color): PcQuery {
  return { size, komi, setup, moves, toPlay };
}

