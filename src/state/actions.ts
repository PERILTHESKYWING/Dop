import { analyzeGame, AnalysisStopped } from '../lib/analysis/pipeline';
import { Corpus } from '../lib/corpus';
import { clearAll, db, deleteGames, idbAnalysisStore, kvGet, kvSet } from '../lib/db/db';
import { BrowserEngine, detectCapabilities } from '../lib/engine/browserEngine';
import { modelOrderFor } from '../lib/engine/models';
import { generateItems } from '../lib/forge/generator';
import { gradeAnswer, itemBoard } from '../lib/forge/grading';
import { newMastery, scoreBlindTest, updateMastery } from '../lib/forge/scheduler';
import { makeVariation } from '../lib/forge/variations';
import { guessPlayerName, importSgfTexts } from '../lib/games';
import { buildContext } from '../lib/go/features';
import { PASS, type Loc } from '../lib/go/types';
import { decodeOwnership, moverView, processRawOutput } from '../lib/engine/parse';
import { engineMoves } from '../lib/analysis/analyzer';
import { buildDiscoveryRequest, discoverPatterns, llmStatus, mergePatterns } from '../lib/llm/client';
import { buildExample, trainDoppel, type DoppelExample } from '../lib/profile/doppel';
import { computeFingerprint } from '../lib/profile/fingerprint';
import { detectWeaknesses } from '../lib/profile/weaknesses';
import { buildOpponentStats } from '../lib/opponents/profile';
import type { LabRequest } from '../lib/lab/lab.worker';
import type { DatasetMeta, LiteModelRecord } from '../lib/lab/model';
import {
  DEFAULT_SETTINGS,
  type Attempt,
  type BlindTest,
  type GameAnalysis,
  type GameRecord,
  type OpponentProfile,
  type PlayerProfile,
  type Settings,
  type TrainingItem,
  type Weakness,
} from '../lib/types';
import { uid } from '../lib/util/hash';
import { get, set, toast } from './store';

let engine: BrowserEngine | null = null;
let engineStarting: Promise<BrowserEngine | null> | null = null;
let corpusCache: { version: number; corpus: Corpus } | null = null;

const tick = () => new Promise((r) => setTimeout(r, 0));
export const isPlayerGame = (g: GameRecord) => (g.source === 'user' || g.source === 'demo') && g.playerColor !== null;

export function getEngine() {
  return engine;
}

/** The corpus of the studied player's analysed games (memoised per analysis version). */
export function corpus(): Corpus {
  const s = get();
  if (corpusCache && corpusCache.version === s.corpusVersion) return corpusCache.corpus;
  const games = s.games.filter(isPlayerGame);
  const analyses = games.map((g) => s.analyses[g.id]).filter((a): a is GameAnalysis => !!a);
  const c = new Corpus(games, analyses);
  corpusCache = { version: s.corpusVersion, corpus: c };
  return c;
}

// ---------------------------------------------------------------- startup

export async function init() {
  try {
    const d = await db();
    const [settings, games, analyses, profile, weaknesses, doppels, items, attempts, mastery, tests, opponents, labModels, datasets] = await Promise.all([
      d.get('settings', 'settings'),
      d.getAll('games'),
      d.getAll('analyses'),
      d.get('profile', 'me'),
      d.getAll('weaknesses'),
      d.getAll('doppel'),
      d.getAll('items'),
      d.getAll('attempts'),
      d.getAll('mastery'),
      d.getAll('blindTests'),
      d.getAll('opponents'),
      d.getAll('labModels'),
      d.getAll('datasets'),
    ]);
    const byWeakness: Record<string, TrainingItem[]> = {};
    for (const it of items) (byWeakness[it.weaknessId] ??= []).push(it);
    // Interrupted analyses resume from their checkpoint.
    for (const g of games) if (g.status === 'fast' || g.status === 'deep') g.status = 'pending';
    set({
      loaded: true,
      settings: { ...DEFAULT_SETTINGS, ...settings },
      games,
      analyses: Object.fromEntries(analyses.map((a) => [a.gameId, a])),
      profile: profile ?? null,
      weaknesses: sortWeaknesses(weaknesses),
      doppel: doppels.sort((a, b) => b.version - a.version)[0] ?? null,
      items: byWeakness,
      attempts: attempts.sort((a, b) => a.at - b.at),
      mastery: Object.fromEntries(mastery.map((m) => [m.weaknessId, m])),
      blindTests: tests.sort((a, b) => b.startedAt - a.startedAt),
      opponents,
      labModels: labModels.sort((a, b) => b.version - a.version),
      datasets: datasets.sort((a, b) => b.version - a.version),
      hardExamples: (await kvGet<{ gameId: string; index: number; pBest: number }[]>('hardExamples')) ?? [],
      corpusVersion: 1,
    });
  } catch (e) {
    set({ loaded: true });
    toast(`Local storage is unavailable (${(e as Error).message}). Nothing will be saved in this session.`, 'error');
  }
  detectCapabilities().then((caps) => set({ caps }));
  llmStatus().then((llm) => set({ llm }));
  const s = get();
  if (s.settings.autoAnalyze && s.games.some((g) => g.status === 'pending')) void runQueue();
}

const sortWeaknesses = (ws: Weakness[]) => [...ws].sort((a, b) => b.totalScoreLoss * b.confidence - a.totalScoreLoss * a.confidence);

export async function saveSettings(patch: Partial<Settings>) {
  const settings = { ...get().settings, ...patch };
  set({ settings });
  try {
    await (await db()).put('settings', settings);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- engine

export async function startEngine(): Promise<BrowserEngine | null> {
  if (engine) return engine;
  if (engineStarting) return engineStarting;
  engineStarting = (async () => {
    set({ engine: { status: 'detecting' } });
    const caps = get().caps ?? (await detectCapabilities());
    set({ caps });
    if (!caps.wasm || !caps.workers) {
      set({ engine: { status: 'unsupported', error: 'This browser lacks WebAssembly or Web Workers, so KataGo cannot run here.' } });
      return null;
    }
    const { settings } = get();
    const order = modelOrderFor(settings.modelId, caps.webgpu && !settings.forceCpu);
    set({ engine: { status: 'loading' } });
    try {
      engine = await BrowserEngine.start(order, settings.forceCpu, (progress) => set((s) => ({ engine: { ...s.engine, status: 'loading', progress } })));
      set({ engine: { status: 'ready', info: engine.info } });
      if (engine.info.modelId !== order[0].id) toast(`Using ${engine.info.modelName}: the preferred network could not be loaded.`, 'info');
      return engine;
    } catch (e) {
      set({ engine: { status: 'error', error: (e as Error).message } });
      toast('KataGo could not start. See Engine & Settings for details.', 'error');
      return null;
    } finally {
      engineStarting = null;
    }
  })();
  return engineStarting;
}

export async function restartEngine() {
  engine?.terminate();
  engine = null;
  set({ engine: { status: 'off' } });
  await startEngine();
}

// ---------------------------------------------------------------- import

async function readFiles(files: File[]): Promise<{ name: string; text: string }[]> {
  const out: { name: string; text: string }[] = [];
  for (const f of files) {
    if (f.size > 5_000_000) {
      toast(`${f.name} is too large to be an SGF file; skipped.`, 'error');
      continue;
    }
    out.push({ name: f.name, text: await f.text() });
  }
  return out;
}

export async function importFiles(files: File[]) {
  const texts = await readFiles(files);
  const s = get();
  let names = s.settings.playerNames;
  const { games, errors } = importSgfTexts(texts, 'user', names);
  if (!names.length) {
    const guess = guessPlayerName([...games, ...s.games.filter((g) => g.source === 'user')]);
    if (guess) {
      names = [guess];
      await saveSettings({ playerNames: names });
      for (const g of games) g.playerColor = g.black === guess ? 1 : g.white === guess ? 2 : null;
      toast(`Studying "${guess}" (appears in most games). Change it in Engine & Settings.`, 'info');
    }
  }
  const existing = new Set(s.games.map((g) => g.id));
  const fresh = games.filter((g) => !existing.has(g.id));
  const d = await db();
  const tx = d.transaction('games', 'readwrite');
  for (const g of fresh) await tx.store.put(g);
  await tx.done;
  set((st) => ({ games: [...st.games, ...fresh] }));
  if (errors.length) toast(`${errors.length} problem${errors.length > 1 ? 's' : ''} while reading: ${errors.slice(0, 2).map((e) => `${e.file}: ${e.message}`).join('; ')}`, 'error');
  if (fresh.length) toast(`Imported ${fresh.length} game${fresh.length > 1 ? 's' : ''}.`, 'ok');
  else if (games.length) toast('Those games are already in the library.', 'info');
  if (fresh.length && get().settings.autoAnalyze) void runQueue();
  return { imported: fresh.length, errors };
}

export async function setPlayerNames(names: string[]) {
  await saveSettings({ playerNames: names });
  const lower = new Set(names.map((n) => n.trim().toLowerCase()));
  const d = await db();
  const games = get().games.map((g) => {
    if (g.source !== 'user') return g;
    const b = lower.has(g.black.trim().toLowerCase());
    const w = lower.has(g.white.trim().toLowerCase());
    return { ...g, playerColor: b && !w ? (1 as const) : w && !b ? (2 as const) : null };
  });
  for (const g of games) await d.put('games', g);
  set((s) => ({ games, corpusVersion: s.corpusVersion + 1 }));
  await rebuildProfile();
}

export async function setGameColor(id: string, color: 1 | 2 | null) {
  const games = get().games.map((g) => (g.id === id ? { ...g, playerColor: color } : g));
  const g = games.find((x) => x.id === id);
  if (g) await (await db()).put('games', g);
  set((s) => ({ games, corpusVersion: s.corpusVersion + 1 }));
}

export async function removeGames(ids: string[]) {
  await deleteGames(ids);
  set((s) => {
    const analyses = { ...s.analyses };
    for (const id of ids) delete analyses[id];
    return { games: s.games.filter((g) => !ids.includes(g.id)), analyses, corpusVersion: s.corpusVersion + 1 };
  });
}

export async function loadDemo() {
  const res = await fetch('/demo/demo.json');
  if (!res.ok) throw new Error('demo data missing');
  const demo = (await res.json()) as { games: GameRecord[]; analyses: GameAnalysis[]; player: string; rival: string };
  const d = await db();
  const tx = d.transaction(['games', 'analyses'], 'readwrite');
  for (const g of demo.games) await tx.objectStore('games').put(g);
  for (const a of demo.analyses) await tx.objectStore('analyses').put(a);
  await tx.done;
  const s = get();
  if (!s.settings.playerNames.length) await saveSettings({ playerNames: [demo.player] });
  const opp: OpponentProfile = {
    id: 'opp-demo-rival',
    name: demo.rival,
    aliases: [],
    gameIds: demo.games.filter((g) => g.source === 'demo-opponent').map((g) => g.id),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const existing = new Set(s.games.map((g) => g.id));
  set((st) => ({
    games: [...st.games, ...demo.games.filter((g) => !existing.has(g.id))],
    analyses: { ...st.analyses, ...Object.fromEntries(demo.analyses.map((a) => [a.gameId, a])) },
    corpusVersion: st.corpusVersion + 1,
  }));
  await saveOpponent(opp);
  await rebuildProfile();
  toast('Demo data loaded: 12 games by "Mira" and 4 by her rival "Tessa".', 'ok');
}

export async function resetEverything() {
  await clearAll();
  engine?.terminate();
  engine = null;
  corpusCache = null;
  set({
    settings: DEFAULT_SETTINGS,
    games: [],
    analyses: {},
    profile: null,
    weaknesses: [],
    doppel: null,
    items: {},
    attempts: [],
    mastery: {},
    blindTests: [],
    opponents: [],
    labModels: [],
    datasets: [],
    hardExamples: [],
    engine: { status: 'off' },
    corpusVersion: 1,
  });
}

// ---------------------------------------------------------------- analysis queue

let stopRequested = false;

export function pauseQueue() {
  stopRequested = true;
  set((s) => ({ queue: { ...s.queue, paused: true } }));
}

export function resumeQueue() {
  set((s) => ({ queue: { ...s.queue, paused: false } }));
  void runQueue();
}

function nextGame(): GameRecord | undefined {
  const games = get().games.filter((g) => g.status !== 'done' && g.status !== 'error' && g.status !== 'skipped');
  // The player's own games first, then opponents'.
  return games.find((g) => g.source === 'user' && g.playerColor !== null) ?? games.find((g) => g.source === 'user') ?? games[0];
}

/** Background analysis of all pending games. Safe to call repeatedly. */
export async function runQueue() {
  if (get().queue.running) return;
  stopRequested = false;
  set((s) => ({ queue: { ...s.queue, running: true, paused: false, lastError: undefined } }));
  let doneSinceRebuild = 0;
  try {
    for (;;) {
      if (stopRequested) break;
      const g = nextGame();
      if (!g) break;
      const eng = await startEngine();
      if (!eng) break;
      set((s) => ({ queue: { ...s.queue, currentGameId: g.id } }));
      const { settings } = get();
      const game: GameRecord = { ...g, progress: { ...g.progress } };
      try {
        const cpu = eng.info.backend === 'cpu';
        const analysis = await analyzeGame(game, eng, idbAnalysisStore, {
          deepVisits: cpu ? Math.min(settings.deepVisits, 16) : settings.deepVisits,
          deepPerGame: game.source === 'opponent' ? Math.round(settings.deepPerGame / 3) : settings.deepPerGame,
          maxSearchMs: cpu ? 8000 : 20000,
          focusColor: game.playerColor,
          shouldStop: () => stopRequested,
          onProgress: (pg) => set((s) => ({ games: s.games.map((x) => (x.id === pg.id ? { ...pg, progress: { ...pg.progress } } : x)) })),
        });
        set((s) => ({
          analyses: { ...s.analyses, [game.id]: analysis },
          games: s.games.map((x) => (x.id === game.id ? { ...game } : x)),
          corpusVersion: s.corpusVersion + 1,
        }));
        doneSinceRebuild++;
        if (doneSinceRebuild >= 3) {
          doneSinceRebuild = 0;
          await rebuildProfile();
        }
      } catch (e) {
        if (e instanceof AnalysisStopped) {
          game.status = 'pending';
          await idbAnalysisStore.saveGame(game);
          set((s) => ({ games: s.games.map((x) => (x.id === game.id ? { ...game } : x)) }));
          break;
        }
        game.status = 'error';
        game.error = (e as Error).message;
        await idbAnalysisStore.saveGame(game);
        set((s) => ({ games: s.games.map((x) => (x.id === game.id ? { ...game } : x)), queue: { ...s.queue, lastError: game.error } }));
      }
    }
  } finally {
    set((s) => ({ queue: { ...s.queue, running: false, currentGameId: undefined } }));
    if (doneSinceRebuild > 0) await rebuildProfile();
  }
}

export async function retryGame(id: string) {
  const g = get().games.find((x) => x.id === id);
  if (!g) return;
  const next = { ...g, status: 'pending' as const, error: undefined };
  await idbAnalysisStore.saveGame(next);
  set((s) => ({ games: s.games.map((x) => (x.id === id ? next : x)) }));
  void runQueue();
}

/** Ask for deeper analysis of specific positions (used by the model lab's hard examples). */
export async function queueDeepPositions(targets: { gameId: string; index: number }[]) {
  const d = await db();
  const byGame = new Map<string, number[]>();
  for (const t of targets) byGame.set(t.gameId, [...(byGame.get(t.gameId) ?? []), t.index]);
  for (const [gameId, idx] of byGame) {
    const a = get().analyses[gameId];
    const g = get().games.find((x) => x.id === gameId);
    if (!a || !g) continue;
    const next = { ...a, deepTargets: [...new Set([...a.deepTargets, ...idx])].sort((x, y) => x - y) };
    await d.put('analyses', next);
    const game = { ...g, status: 'pending' as const };
    await d.put('games', game);
    set((s) => ({ analyses: { ...s.analyses, [gameId]: next }, games: s.games.map((x) => (x.id === gameId ? game : x)) }));
  }
  void runQueue();
}

// ---------------------------------------------------------------- profile

let rebuilding: Promise<void> | null = null;

export function rebuildProfile(): Promise<void> {
  if (rebuilding) return rebuilding.then(() => rebuildProfile());
  rebuilding = (async () => {
    set((s) => ({ busy: { ...s.busy, profile: true } }));
    try {
      await tick();
      const c = corpus();
      const player = c.playerRecords();
      const s = get();
      const d = await db();
      if (!player.length) {
        set({ profile: null });
        return;
      }
      const axes = computeFingerprint(c.records);
      const weaknesses = detectWeaknesses(c.records, { gameOrder: c.gameOrder(), previous: s.weaknesses });
      // Keep LLM-discovered weaknesses whose evidence still exists.
      const llmOnly = s.weaknesses.filter((w) => w.signature.startsWith('llm-') && w.evidence.every((e) => c.byId.has(e.moveId)));
      const all = sortWeaknesses([...weaknesses, ...llmOnly]);

      // Doppelgänger training data.
      const examples: DoppelExample[] = [];
      let n = 0;
      for (const r of player) {
        const g = c.games.get(r.gameId)!;
        const e = c.analyses.get(r.gameId)?.evals[r.index];
        if (!e) continue;
        const ctx = buildContext(c.boards(r.gameId)[r.index], decodeOwnership(e.ownership));
        const prev = r.index > 0 ? g.moves[r.index - 1] : null;
        const ex = buildExample(ctx, e.policy, r.color, prev && prev.color !== r.color ? prev.loc : null, r.loc, r.gameId);
        if (ex) examples.push(ex);
        if (++n % 150 === 0) await tick();
      }
      const version = (s.doppel?.version ?? 0) + 1;
      const doppel = examples.length >= 30 ? trainDoppel(examples, { version }) : s.doppel;

      const names = s.settings.playerNames;
      const profile: PlayerProfile = {
        id: 'me',
        name: names[0] ?? 'You',
        aliases: names.slice(1),
        games: new Set(player.map((r) => r.gameId)).size,
        positions: c.records.length,
        playerMoves: player.length,
        overallAccuracy: player.filter((r) => r.scoreLoss < 1 && r.winrateLoss < 0.03).length / player.length,
        avgScoreLoss: player.reduce((a, r) => a + r.scoreLoss, 0) / player.length,
        axes,
        updatedAt: Date.now(),
        version: (s.profile?.version ?? 0) + 1,
      };

      // Forge positions for every weakness (keep engine-made variations).
      const items: Record<string, TrainingItem[]> = {};
      for (const w of all) {
        const fresh = generateItems(c, w);
        const variations = (s.items[w.id] ?? []).filter((i) => i.modification);
        items[w.id] = [...fresh, ...variations];
        await tick();
      }

      const tx = d.transaction(['weaknesses', 'profile', 'doppel', 'items'], 'readwrite');
      await tx.objectStore('weaknesses').clear();
      for (const w of all) await tx.objectStore('weaknesses').put(w);
      await tx.objectStore('profile').put(profile);
      if (doppel && doppel !== s.doppel) await tx.objectStore('doppel').put(doppel);
      await tx.objectStore('items').clear();
      for (const list of Object.values(items)) for (const it of list) await tx.objectStore('items').put(it);
      await tx.done;
      set({ profile, weaknesses: all, doppel: doppel ?? null, items });
    } catch (e) {
      toast(`Could not rebuild the player model: ${(e as Error).message}`, 'error');
    } finally {
      set((s) => ({ busy: { ...s.busy, profile: false } }));
      rebuilding = null;
    }
  })();
  return rebuilding;
}

// ---------------------------------------------------------------- LLM

export async function runLlmDiscovery() {
  const s = get();
  if (!s.settings.useLlm) return;
  set((st) => ({ busy: { ...st.busy, llm: true } }));
  try {
    const c = corpus();
    const built = buildDiscoveryRequest(c, s.weaknesses, s.profile?.axes ?? []);
    if (!built.req.clusters.length) {
      toast('Not enough repeated evidence yet for pattern discovery.', 'info');
      return;
    }
    const resp = await discoverPatterns(built.req);
    const merged = sortWeaknesses(mergePatterns(c, built, resp, s.weaknesses));
    const d = await db();
    for (const w of merged) await d.put('weaknesses', w);
    set({ weaknesses: merged });
    const added = merged.length - s.weaknesses.length;
    toast(`${resp.model}: ${resp.patterns.length} pattern${resp.patterns.length === 1 ? '' : 's'} described${added > 0 ? `, ${added} new` : ''}${resp.rejected ? `, ${resp.rejected} rejected for weak evidence` : ''}.`, 'ok');
    if (added > 0) await rebuildProfile();
  } catch (e) {
    toast(`Pattern discovery failed: ${(e as Error).message}. The statistical weaknesses still apply.`, 'error');
  } finally {
    set((st) => ({ busy: { ...st.busy, llm: false } }));
  }
}

export async function refreshLlmStatus() {
  set({ llm: await llmStatus() });
}

// ---------------------------------------------------------------- training

/** Live one-ply evaluation of an answer that the stored analysis did not cover. */
async function liveEval(item: TrainingItem, loc: Loc) {
  const eng = engine;
  if (!eng || loc === PASS) return null;
  try {
    const board = itemBoard(item);
    board.play(loc, item.toPlay, true);
    const opp = item.toPlay === 1 ? 2 : 1;
    const raw = await eng.evalRaw(
      { size: item.size, komi: item.komi, moves: engineMoves(item.setup, [...item.moves, { color: item.toPlay, loc }]), toPlay: opp },
      false,
    );
    const net = processRawOutput(raw, opp, (l) => board.isLegal(l, opp), eng.postProcess);
    return moverView(net.bWin, net.bLead, item.toPlay);
  } catch {
    return null;
  }
}

export async function submitAnswer(item: TrainingItem, loc: Loc, timeMs: number, mode: 'forge' | 'blind', sessionId: string, reason?: string) {
  const covered = item.eval.candidates?.some((c) => c.loc === loc);
  const live = covered ? null : await liveEval(item, loc);
  const g = gradeAnswer(item, loc, live);
  const attempt: Attempt = {
    id: uid('a'),
    itemId: item.id,
    weaknessId: item.weaknessId,
    signature: item.signature,
    kind: item.kind,
    mode,
    sessionId,
    loc,
    timeMs,
    scoreLoss: g.scoreLoss,
    winrateLoss: g.winrateLoss,
    grade: g.grade,
    conceptCorrect: g.conceptCorrect,
    repeatedError: g.repeatedError,
    reason,
    at: Date.now(),
  };
  const s = get();
  const prior = s.attempts.filter((a) => a.weaknessId === item.weaknessId);
  const m = updateMastery(s.mastery[item.weaknessId] ?? newMastery(item.weaknessId), attempt, prior);
  const d = await db();
  await d.put('attempts', attempt);
  if (mode === 'forge') await d.put('mastery', m);
  set((st) => ({ attempts: [...st.attempts, attempt], mastery: mode === 'forge' ? { ...st.mastery, [item.weaknessId]: m } : st.mastery }));
  return { attempt, grade: g };
}

export async function addReason(attemptId: string, reason: string) {
  const s = get();
  const a = s.attempts.find((x) => x.id === attemptId);
  if (!a) return;
  const next = { ...a, reason };
  await (await db()).put('attempts', next);
  set({ attempts: s.attempts.map((x) => (x.id === attemptId ? next : x)) });
}

/** Engine-made variations for a weakness (boundary cases from modified real positions). */
export async function generateVariations(weaknessId: string, count = 4) {
  const eng = await startEngine();
  if (!eng) return 0;
  const list = get().items[weaknessId] ?? [];
  const sources = list.filter((i) => (i.kind === 'original' || i.kind === 'similar') && !i.modification).slice(0, count * 2);
  const made: TrainingItem[] = [];
  for (const src of sources) {
    if (made.length >= count) break;
    try {
      const v = await makeVariation(src, eng, Math.random, eng.info.backend === 'cpu' ? 1 : 32);
      if (v) made.push(v);
    } catch {
      /* skip */
    }
  }
  const d = await db();
  for (const it of made) await d.put('items', it);
  set((s) => ({ items: { ...s.items, [weaknessId]: [...(s.items[weaknessId] ?? []), ...made] } }));
  return made.length;
}

export async function saveBlindTest(t: BlindTest) {
  const s = get();
  let next = t;
  if (t.finishedAt) {
    const items = s.items[t.weaknessId] ?? [];
    next = { ...t, result: scoreBlindTest(t, s.attempts, items) };
    // A clearly learned weakness that no longer shows up in recent games is resolved.
    const w = s.weaknesses.find((x) => x.id === t.weaknessId);
    if (w && next.result?.verdict === 'learned' && w.status === 'improving') {
      const resolved = { ...w, status: 'resolved' as const };
      await (await db()).put('weaknesses', resolved);
      set({ weaknesses: s.weaknesses.map((x) => (x.id === w.id ? resolved : x)) });
    }
  }
  await (await db()).put('blindTests', next);
  set((st) => ({ blindTests: [next, ...st.blindTests.filter((x) => x.id !== t.id)] }));
  return next;
}

// ---------------------------------------------------------------- opponents

export async function saveOpponent(o: OpponentProfile) {
  const s = get();
  const games = s.games.filter((g) => o.gameIds.includes(g.id));
  const analyses = new Map(Object.entries(s.analyses));
  const next = { ...o, stats: buildOpponentStats(o.name, o.aliases, games, analyses), updatedAt: Date.now() };
  await (await db()).put('opponents', next);
  set((st) => ({ opponents: [...st.opponents.filter((x) => x.id !== o.id), next] }));
  return next;
}

export async function importOpponentFiles(files: File[], name?: string, existing?: OpponentProfile) {
  const texts = await readFiles(files);
  const { games, errors } = importSgfTexts(texts, 'opponent', []);
  if (!games.length) {
    toast(errors[0] ? `No games imported: ${errors[0].message}` : 'No games found in those files.', 'error');
    return null;
  }
  const who = name || existing?.name || guessPlayerName(games) || games[0].black;
  const id = existing?.id ?? uid('opp-');
  for (const g of games) g.opponentId = id;
  const known = new Set(get().games.map((g) => g.id));
  const fresh = games.filter((g) => !known.has(g.id));
  const d = await db();
  for (const g of fresh) await d.put('games', g);
  set((s) => ({ games: [...s.games, ...fresh] }));
  const profile: OpponentProfile = existing
    ? { ...existing, gameIds: [...new Set([...existing.gameIds, ...games.map((g) => g.id)])] }
    : { id, name: who, aliases: [], gameIds: games.map((g) => g.id), createdAt: Date.now(), updatedAt: Date.now() };
  const saved = await saveOpponent(profile);
  toast(`${games.length} game${games.length > 1 ? 's' : ''} added to ${saved.name}'s profile.`, 'ok');
  return saved;
}

export async function deleteOpponent(id: string) {
  const o = get().opponents.find((x) => x.id === id);
  if (!o) return;
  await (await db()).delete('opponents', id);
  const own = get().games.filter((g) => g.opponentId === id).map((g) => g.id);
  await removeGames(own);
  set((s) => ({ opponents: s.opponents.filter((x) => x.id !== id) }));
}

export async function renameOpponent(id: string, name: string) {
  const o = get().opponents.find((x) => x.id === id);
  if (o) await saveOpponent({ ...o, name });
}

// ---------------------------------------------------------------- model lab

export function trainLabModel(epochs = 6): Promise<LiteModelRecord | null> {
  const s = get();
  const games = s.games.filter((g) => s.analyses[g.id]);
  if (!games.length) {
    toast('Analyse some games first: the lab learns from KataGo analyses.', 'info');
    return Promise.resolve(null);
  }
  set((st) => ({ busy: { ...st.busy, lab: true, labStage: 'Starting', labProgress: 0 } }));
  const parent = s.labModels[0];
  const version = (parent?.version ?? 0) + 1;
  const req: LabRequest = {
    games,
    analyses: games.map((g) => s.analyses[g.id]),
    version,
    parent,
    epochs,
    engineName: Object.values(s.analyses)[0]?.engine?.modelName ?? 'KataGo',
  };
  return new Promise((resolve) => {
    const worker = new Worker(new URL('../lib/lab/lab.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = async (e) => {
      const m = e.data;
      if (m.type === 'progress') {
        set((st) => ({ busy: { ...st.busy, labStage: m.stage, labProgress: m.value } }));
        return;
      }
      worker.terminate();
      set((st) => ({ busy: { ...st.busy, lab: false } }));
      if (m.type === 'error') {
        toast(`Model training failed: ${m.error}`, 'error');
        resolve(null);
        return;
      }
      const model = m.model as LiteModelRecord;
      const dataset = m.dataset as DatasetMeta;
      const d = await db();
      await d.put('labModels', model);
      await d.put('datasets', dataset);
      // Keep the last 6 versions.
      const keep = [model, ...get().labModels].slice(0, 6);
      for (const old of get().labModels.slice(5)) await d.delete('labModels', old.id);
      await kvSet('hardExamples', m.hard);
      set((st) => ({ labModels: keep, datasets: [dataset, ...st.datasets.filter((x) => x.id !== dataset.id)], hardExamples: m.hard }));
      resolve(model);
    };
    worker.onerror = (e) => {
      worker.terminate();
      set((st) => ({ busy: { ...st.busy, lab: false } }));
      toast(`Model training failed: ${e.message}`, 'error');
      resolve(null);
    };
    worker.postMessage(req);
  });
}
