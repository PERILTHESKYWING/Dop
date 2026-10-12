import { create } from 'zustand';
import type { PositionSpec } from '../lib/analysis/analyzer';
import { pairingCode, pcLinkOf } from '../../shared/pcLink';
import { BUNDLED_ID, WINRATE_FROM_SCORE } from '../lib/engine/models';
import type { EngineBackend, EngineRequest, RawSearchResult } from '../lib/engine/types';
import type { PostProcessParams, RawNetOutput } from '../lib/engine/parse';
import { gtpToLoc, locToGtp } from '../lib/go/coords';
import { PASS, type Color, type Loc, type Move } from '../lib/go/types';
import type { SearchCandidate, SearchSnapshot } from '../lib/engine/mcts';
import { encodeOwnership, round, topPolicy } from '../lib/engine/parse';
import type { Candidate, EngineInfo, GameRecord, PositionEval, Settings } from '../lib/types';
import { engineKomi } from '../lib/go/rules';
import { isPhoneLike } from '../lib/engine/governor';
import { get as getApp } from './store';
import { setPcAnswer } from './brain';

/**
 * The PC helper (pc-helper/dop_pc.py): native KataGo with a big network on the user's own
 * graphics card, at http://127.0.0.1:7474 on that computer, and for a phone (at home or
 * away) at the Cloudflare quick tunnel address the helper opens. A phone browser cannot
 * reach the PC over the home network directly: the site is https and the helper plain
 * http, which phones block. While it answers, the site uses it for live analysis and game
 * analysis, and (with the site's own small network, also on the PC) for the first look
 * at games and the Doppelgänger copy's moves; when it does not, everything runs here.
 *
 * Linking a phone: the PC's Settings page shows a QR code with the tunnel address and the
 * pairing code (pcLinkUrl). The tunnel address changes whenever the helper restarts; the
 * helper then announces the new one to the site (/api/account?action=pc-here, keyed by the
 * code), and a linked phone looks it up (pc-where) when the old one stops answering.
 */

export interface PcState {
  status: 'off' | 'connected' | 'error';
  address: string;
  network?: string;
  backend?: string;
  note?: string;
  /** The helper's public address for phones (its tunnel), when it has one. */
  tunnel?: string;
  /** The pairing code, when this computer read it from the helper itself. */
  code?: string;
  /** The site's small network is running on the PC too. */
  small?: boolean;
  /** Positions it has analysed for this browser. */
  analysed: number;
}

export const LOCAL_PC = 'http://127.0.0.1:7474';
export const usePc = create<PcState>(() => ({ status: 'off', address: LOCAL_PC, analysed: 0 }));

const addressOf = () => (getApp().settings.pcAddress || LOCAL_PC).replace(/\/+$/, '');
const codeOf = () => getApp().settings.pcCode || pairedCode || '';
let pairedCode = '';

export const pcReady = () => usePc.getState().status === 'connected';
/** The PC answers with the site's small network as well (see pcSmallEngine). */
export const pcSmallReady = () => pcReady() && !!usePc.getState().small;

type SaveSettings = (patch: Partial<Settings>) => Promise<void>;
let saveSettings: SaveSettings | null = null;

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
  // Chrome's names: 'loopback' for this computer, 'local' for the home network.
  if (host === 'localhost' || host === '[::1]' || /^127\./.test(host)) return { targetAddressSpace: 'loopback' };
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ? { targetAddressSpace: 'local' } : {};
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
export async function probePc(fresh = false): Promise<boolean> {
  if (fresh) lastLookup = 0;
  if (await probeOnce()) return true;
  // A linked phone: the helper may have restarted with a new tunnel address.
  if (await relocate()) return probeOnce();
  return false;
}

async function probeOnce(): Promise<boolean> {
  const address = addressOf();
  // A phone with only the code (no address yet) asks the site where the PC is first.
  if (address === LOCAL_PC && isPhoneLike()) return false;
  try {
    const st = await call<{ app: string; ready: boolean; network: string; backend: string; tunnel?: string; small?: boolean }>('/status', {}, address === LOCAL_PC ? 1500 : 6000);
    if (st.app !== 'dop-pc') throw new Error('not the PC helper');
    if (!getApp().settings.pcCode && address === LOCAL_PC) pairedCode = (await call<{ token: string }>('/pair', {}, 1500)).token;
    usePc.setState({
      status: st.ready ? 'connected' : 'off',
      address,
      network: st.network,
      backend: st.backend,
      tunnel: st.tunnel,
      small: !!st.small,
      code: address === LOCAL_PC ? codeOf() : undefined,
      note: st.ready ? undefined : 'KataGo is starting on the PC',
    });
    // The small network starts on the PC the first time it is asked for.
    if (st.ready && !st.small) void wakeSmall();
    return st.ready;
  } catch (e) {
    const was = usePc.getState().status;
    smallAsked = false;
    usePc.setState({ status: was === 'connected' ? 'error' : 'off', address, small: false, note: was === 'connected' ? (e as Error).message : undefined });
    return false;
  }
}

let smallAsked = false;
async function wakeSmall() {
  if (smallAsked) return;
  smallAsked = true;
  await call('/analyze', { method: 'POST', body: JSON.stringify({ net: 'small', moves: [], komi: 7.5, maxVisits: 1 }) }).catch(() => {});
  // It is usually up within seconds; look again rather than at the next minute's check.
  setTimeout(() => void probeOnce(), 10_000);
}

let lastLookup = 0;
/**
 * Ask the site where the PC helper is now (it announces its tunnel address on every start),
 * at most once a minute. Returns whether the address changed.
 */
async function relocate(): Promise<boolean> {
  const code = pairingCode(getApp().settings.pcCode);
  if (!code || !saveSettings || Date.now() - lastLookup < 60_000) return false;
  if (!isPhoneLike() && !getApp().settings.pcAddress) return false;
  lastLookup = Date.now();
  try {
    const r = await fetch('/api/account?action=pc-where', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
    if (!r.ok) return false;
    const { address } = (await r.json()) as { address?: string };
    if (!address || address === getApp().settings.pcAddress) return false;
    await saveSettings({ pcAddress: address });
    return true;
  } catch {
    return false;
  }
}

/**
 * A link from the PC's QR code (?pc=…&pcCode=…), read once when the site opens and taken
 * out of the address bar; the settings load applies it.
 */
const urlLink: { address: string; code: string } | null = (() => {
  if (typeof location === 'undefined' || typeof history === 'undefined') return null;
  const link = pcLinkOf(location.href);
  const u = new URL(location.href);
  if (u.searchParams.has('pc') || u.searchParams.has('pcCode')) {
    u.searchParams.delete('pc');
    u.searchParams.delete('pcCode');
    history.replaceState(null, '', u.toString());
  }
  return link;
})();
export const pcLinkFromUrl = () => urlLink;

let watching = false;
/**
 * Keep looking for the helper: on a computer always (it may be started any time), on a
 * phone only when an address was entered. Every 20 seconds while absent, every minute
 * while present.
 */
export function watchPc(save: SaveSettings) {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  saveSettings = save;
  setPcAnswer(pcAnswer);
  const loop = async () => {
    const { pcAddress, pcCode } = getApp().settings;
    const wanted = !isPhoneLike() || !!pcAddress || !!pcCode;
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


// ------------------------------------------------- the site's small network, on the PC

/** Board symmetry `sym` (0..7: bit 0 flips rows, bit 1 flips columns, bit 2 swaps them). */
export function symLoc(loc: Loc, size: number, sym: number): Loc {
  if (loc === PASS || loc < 0) return loc;
  let x = loc % size;
  let y = (loc - x) / size;
  if (sym & 1) y = size - 1 - y;
  if (sym & 2) x = size - 1 - x;
  if (sym & 4) [x, y] = [y, x];
  return y * size + x;
}

/**
 * One answer of the PC's small network as the raw network output the site's analyser
 * expects (with PC_POSTPROCESS): the policy as log-probabilities, the winrate as value
 * logits, scores unscaled, ownership before tanh, all for the side to move. Policy and
 * ownership are turned back from the board symmetry the position was sent in.
 */
export function pcRaw(r: KgResult, toPlay: Color, size: number, sym = 0): RawNetOutput {
  const hw = size * size;
  const root = r.rootInfo as KgResult['rootInfo'] & { rawWinrate?: number; rawLead?: number; rawScoreSelfplay?: number };
  const bWin = root.rawWinrate ?? root.winrate;
  const bLead = root.rawLead ?? root.scoreLead;
  const side = toPlay === 1 ? 1 : -1;
  const win = Math.min(1 - 1e-6, Math.max(1e-6, toPlay === 1 ? bWin : 1 - bWin));
  const policyLogits = new Float32Array(hw + 1).fill(-Infinity);
  for (let loc = 0; loc <= hw; loc++) {
    const p = r.policy?.[loc === hw ? hw : symLoc(loc, size, sym)] ?? -1;
    if (p > 0) policyLogits[loc] = Math.log(p);
  }
  let ownership: Float32Array | null = null;
  if (r.ownership?.length === hw) {
    ownership = new Float32Array(hw);
    for (let loc = 0; loc < hw; loc++) ownership[loc] = Math.atanh(Math.max(-0.999999, Math.min(0.999999, side * r.ownership[symLoc(loc, size, sym)])));
  }
  return { policyLogits, value: Float32Array.of(Math.log(win), Math.log(1 - win), -Infinity, side * (root.rawScoreSelfplay ?? bLead), side * bLead), ownership };
}

/** How pcRaw's numbers are read: unscaled, and the winrate from the score lead as for the bundled network. */
export const PC_POSTPROCESS: PostProcessParams = { outputScale: 1, scoreMeanMultiplier: 1, leadMultiplier: 1, winrateScale: WINRATE_FROM_SCORE };

/** The PC stopped answering in the middle of a job; the caller carries on here. */
export class PcGone extends Error {}

/**
 * The site's own small network (the bundled g170e-b10c128) running on the PC, as an
 * engine the analyser can use: the same network as on this device, so the first look at
 * games and the copy's moves are the same, but the phone does none of the work. Positions
 * go out side by side (the PC batches them).
 */
export const pcSmallEngine: EngineBackend = {
  info: { engine: 'katago-native (PC helper)', backend: 'pc', modelId: BUNDLED_ID, modelName: 'g170e b10 (on your PC)', modelVersion: 8 } satisfies EngineInfo,
  postProcess: PC_POSTPROCESS,
  batch: 16,
  pipeline: 4,
  async evalRaw(req: EngineRequest) {
    return (await pcSmallMany([req]))[0];
  },
  async evalSeqBatchRaw(reqs) {
    return pcSmallMany(reqs);
  },
  async searchRaw(): Promise<RawSearchResult> {
    throw new Error('searches on the PC go through the big network (pcAnswer)');
  },
};

async function pcSmallMany(reqs: (EngineRequest & { symmetry?: number })[]): Promise<RawNetOutput[]> {
  try {
    return await Promise.all(
      reqs.map(async (q) => {
        const sym = (q.symmetry ?? 0) & 7;
        const moves = q.moves.map((m) => ({ ...m, loc: symLoc(m.loc, q.size, sym) }));
        const [r] = await call<KgResult[]>(
          '/analyze',
          { method: 'POST', body: JSON.stringify(body({ size: q.size, komi: q.komi, setup: [], moves, toPlay: q.toPlay }, { net: 'small', maxVisits: 1, includePolicy: true, includeOwnership: true })) },
          20_000,
        );
        if (!r?.moveInfos && !r?.rootInfo) throw new Error('no answer');
        return pcRaw(r, q.toPlay, q.size, sym);
      }),
    );
  } catch (e) {
    usePc.setState({ small: false });
    void probePc();
    throw new PcGone(`the PC stopped answering: ${(e as Error).message}`);
  }
}
