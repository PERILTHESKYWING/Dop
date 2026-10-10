import { analysisIsCurrent, analyzeGame, AnalysisStopped, type AnalysisStore } from '../lib/analysis/pipeline';
import { Corpus } from '../lib/corpus';
import { clearAll, db, deleteGames, idbAnalysisStore, kvGet, kvSet } from '../lib/db/db';
import { BrowserEngine, cacheKeyFor, detectCapabilities, isEngineFailure, type Capabilities, type StartAttempt } from '../lib/engine/browserEngine';
import { bundledModel, modelOrderFor } from '../lib/engine/models';
import { coolModeFor, governEngine, isCool, pace, setCool } from '../lib/engine/governor';
import { forgetTunings } from '../lib/engine/tuning';
import { generateItems } from '../lib/forge/generator';
import { balancedItems } from '../lib/forge/balance';
import { practiceItems } from '../lib/forge/worth';
import { answerCovered, gradeAnswer, itemBoard, type LiveCheck } from '../lib/forge/grading';
import { newMastery, scoreBlindTest, updateMastery } from '../lib/forge/scheduler';
import { makeVariation } from '../lib/forge/variations';
import { detectPlayerColor, gameId, guessPlayerName, importSgfTexts } from '../lib/games';
import { buildContext } from '../lib/go/features';
import { PASS, type Color, type Loc, type Move } from '../lib/go/types';
import { toSgf } from '../lib/go/sgf';
import { allPositions, type Board } from '../lib/go/board';
import { decodeOwnership } from '../lib/engine/parse';
import { ANALYSIS_VERSION, engineMoves, searchedEval } from '../lib/analysis/analyzer';
import { engineEvaluator, nnCacheFor, Search, type SearchSnapshot } from '../lib/engine/mcts';
import type { CacheRow } from '../lib/engine/nncache';
import { engineKomi, standardKomi } from '../lib/go/rules';
import { buildDiscoveryRequest, discoverPatterns, llmStatus, mergePatterns } from '../lib/llm/client';
import { buildExample, trainDoppel, type DoppelExample, type DoppelModel } from '../lib/profile/doppel';
import { computeFingerprint } from '../lib/profile/fingerprint';
import { detectWeaknesses } from '../lib/profile/weaknesses';
import { weaknessPriority, withPeers } from '../lib/level/peers';
import { levelCalibration, levelOf } from './level';
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
import { decodeSgfBytes } from '../lib/util/charset';
import { get, set, toast } from './store';
import { anchorFor, knownAnswer } from './brain';
import { searchEvaluator, startStudent, stopStudent, studentVisits } from './student';
import { pcPrefetchGame, pcReady, watchPc } from './pc';
import './shared';

const DEMO_PLAYER = 'Mira';
const DEMO_RIVAL_ID = 'opp-demo-rival';

let engine: BrowserEngine | null = null;
let engineStarting: Promise<BrowserEngine | null> | null = null;
let corpusCache: { version: number; corpus: Corpus } | null = null;

const tick = () => new Promise((r) => setTimeout(r, 0));
export const isPlayerGame = (g: GameRecord) => (g.source === 'user' || g.source === 'demo') && g.playerColor !== null;

/** The loaded engine, or null when none is running (it may have been stopped after a crash). */
export function getEngine() {
  return engine && !engine.dead ? engine : null;
}

/** Demo games count only until the user's own games have been analysed. */
export function usesDemoData(s = get()): boolean {
  const own = s.games.some((g) => g.source === 'user' && g.playerColor !== null && s.analyses[g.id]);
  return !own && s.games.some((g) => g.source === 'demo');
}

/** The corpus of the studied player's analysed games (memoised per analysis version). */
export function corpus(): Corpus {
  const s = get();
  if (corpusCache && corpusCache.version === s.corpusVersion) return corpusCache.corpus;
  const demo = usesDemoData(s);
  const games = s.games.filter((g) => isPlayerGame(g) && (demo || g.source === 'user'));
  const analyses = games.map((g) => s.analyses[g.id]).filter((a): a is GameAnalysis => !!a);
  const c = new Corpus(games, analyses);
  corpusCache = { version: s.corpusVersion, corpus: c };
  return c;
}

// ---------------------------------------------------------------- startup

/**
 * Bring games stored by older versions up to date: read RU[] from the SGF, fix Fox's
 * missing komi (KM[0]) and its komi in stones (KM[375]), and send games whose analysis
 * was made the old way back to the queue. Demo games keep their bundled analysis.
 */
async function migrateGames(d: Awaited<ReturnType<typeof db>>, games: GameRecord[], analyses: GameAnalysis[]) {
  const byId = new Map(analyses.map((a) => [a.gameId, a]));
  for (const g of games) {
    let changed = false;
    if (g.rules === undefined) {
      g.rules = g.sgf.match(/RU\[([^\]]*)\]/)?.[1]?.trim() ?? '';
      changed = true;
    }
    const km = g.sgf.match(/KM\[([^\]]*)\]/)?.[1]?.trim();
    const warned = g.warnings.some((w) => w.startsWith('komi was'));
    if (!warned && g.size === 19 && g.handicap < 2 && km !== undefined) {
      const fixed = g.komi === 0 && Number(km) === 0 ? standardKomi(g.rules) : g.komi === 3.75 && Number(km) === 375 ? 7.5 : null;
      if (fixed !== null) {
        g.komi = fixed;
        g.warnings = [...g.warnings, `komi was stored as ${km}, using ${fixed}; change it in the game list if that is wrong`];
        changed = true;
      }
    }
    const a = byId.get(g.id);
    const demo = g.source === 'demo' || g.source === 'demo-opponent';
    if (a && !analysisIsCurrent(a, g)) {
      if (demo) {
        a.version = ANALYSIS_VERSION;
        a.komi = engineKomi(g.komi, g.rules);
        await d.put('analyses', a);
      } else if (g.status !== 'pending') {
        g.status = 'pending';
        changed = true;
      }
    }
    if (changed) await d.put('games', g);
  }
}

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
    const minWin = { ...DEFAULT_SETTINGS, ...settings }.minLosingWinrate;
    for (const it of balancedItems(items, minWin)) (byWeakness[it.weaknessId] ??= []).push(it);
    // Interrupted analyses resume from their checkpoint.
    for (const g of games) if (g.status === 'deep') g.status = 'pending';
    await migrateGames(d, games, analyses);
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    // Older versions saved the demo player's name as the user's own, which blocked name detection.
    if (merged.playerNames.length === 1 && merged.playerNames[0] === DEMO_PLAYER && !games.some((g) => g.source === 'user' && (g.black === DEMO_PLAYER || g.white === DEMO_PLAYER))) {
      merged.playerNames = [];
      void d.put('settings', merged);
    }
    set({
      loaded: true,
      settings: merged,
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
  setCool(coolModeFor(get().settings.coolMode));
  watchPc();
  detectCapabilities().then((caps) => set({ caps }));
  llmStatus().then((llm) => set({ llm }));
  const s = get();
  if (s.settings.autoAnalyze && s.games.some((g) => g.status === 'pending')) void runQueue();
}

const sortWeaknesses = (ws: Weakness[]) => [...ws].sort((a, b) => weaknessPriority(b) - weaknessPriority(a));

export async function saveSettings(patch: Partial<Settings>) {
  const before = get().settings;
  const settings = { ...before, ...patch };
  set({ settings });
  setCool(coolModeFor(settings.coolMode));
  if (settings.student !== before.student) stopStudent();
  try {
    await (await db()).put('settings', settings);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- engine

/*
 * Starting KataGo has to survive whatever the device does: a network host that is
 * blocked or stalls, a graphics driver that hangs or computes garbage, a tab that is
 * killed while the GPU starts. The order is: the chosen/strong network on WebGPU, the
 * built-in network on WebGPU, then the built-in network on the CPU. A GPU that failed
 * (or took the tab down) is remembered and skipped until the user asks to retry it.
 */
const GPU_TRYING = 'dop.gpuTrying';
const GPU_BROKEN = 'dop.gpuBroken';
/** After an engine failure on the CPU: only the built-in network, on the CPU. */
let safeMode = false;

function lsGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage blocked */
  }
}

/** True when the graphics card failed before, or the tab died while it was starting KataGo. */
export function gpuMarkedBroken(): boolean {
  if (lsGet(GPU_TRYING)) {
    lsSet(GPU_TRYING, null);
    lsSet(GPU_BROKEN, String(Date.now()));
  }
  return !!lsGet(GPU_BROKEN);
}

const isDownloadProblem = (msg: string) => /download|no answer|stalled|HTTP \d|not a KataGo network|web page|no longer in this browser|cut off/i.test(msg);

export function engineAttempts(settings: Settings, caps: Capabilities): StartAttempt[] {
  if (safeMode) return [{ spec: bundledModel(), forceCpu: true }];
  // Cool mode (phones): the small built-in network on two CPU workers unless a network was
  // chosen by hand. Big networks come from the opening book, the big-network helper and the
  // PC instead of running here non-stop.
  if (isCool() && settings.modelId === 'auto') return [{ spec: bundledModel(), forceCpu: true }];
  const gpu = caps.webgpu && !settings.forceCpu && !gpuMarkedBroken();
  const list: StartAttempt[] = modelOrderFor(settings.modelId, gpu).map((spec) => ({ spec, forceCpu: !gpu }));
  if (gpu) list.push({ spec: bundledModel(), forceCpu: true });
  return list;
}

function onEngineDeath(eng: BrowserEngine, reason: string) {
  if (engine !== eng) return;
  engine = null;
  if (eng.info.backend === 'webgpu') lsSet(GPU_BROKEN, String(Date.now()));
  else safeMode = true;
  set({ engine: { status: 'off', note: `KataGo stopped (${reason}). It restarts on its own in ${eng.info.backend === 'webgpu' ? 'CPU mode' : 'safe mode'} when needed.` } });
}

export async function startEngine(): Promise<BrowserEngine | null> {
  if (engine && !engine.dead) return engine;
  engine = null;
  if (engineStarting) return engineStarting;
  engineStarting = (async () => {
    set({ engine: { status: 'detecting' } });
    const caps = get().caps ?? (await detectCapabilities());
    set({ caps });
    if (!caps.wasm || !caps.workers) {
      set({ engine: { status: 'unsupported', error: 'This browser lacks WebAssembly or Web Workers, so KataGo cannot run here.' } });
      return null;
    }
    const attempts = engineAttempts(get().settings, caps);
    const failures: string[] = [];
    let gpuFailed = false;
    set({ engine: { status: 'loading' } });
    try {
      for (const a of attempts) {
        const onGpu = !a.forceCpu;
        if (onGpu && gpuFailed) continue;
        try {
          const eng = await BrowserEngine.load(
            a,
            (progress) => {
              // Only the GPU start itself can take the tab down, not the download before it.
              if (onGpu && (progress.stage === 'load' || progress.stage === 'check')) lsSet(GPU_TRYING, String(Date.now()));
              set((s) => ({ engine: { ...s.engine, status: 'loading', progress, failures: [...failures] } }));
            },
            { tune: !safeMode, retune: retuneNext },
          );
          retuneNext = false;
          lsSet(GPU_TRYING, null);
          eng.onDeath = (reason) => onEngineDeath(eng, reason);
          engine = eng;
          governEngine(eng);
          void keepOpeningCache(eng);
          set({ engine: { status: 'ready', info: eng.info, evalMs: eng.evalMs, failures } });
          if (failures.length) toast(`Using ${eng.info.modelName}${eng.info.backend === 'cpu' ? ' on CPU' : ''}. ${attempts[0].spec.name} failed (see Settings).`, 'info');
          return eng;
        } catch (e) {
          const msg = (e as Error).message;
          lsSet(GPU_TRYING, null);
          if (onGpu && !isDownloadProblem(msg)) {
            gpuFailed = true;
            lsSet(GPU_BROKEN, String(Date.now()));
          }
          failures.push(`${a.spec.name}${onGpu ? ' (WebGPU)' : ' (CPU)'}: ${msg}`);
        }
      }
      set({ engine: { status: 'error', error: failures.join('\n'), failures } });
      toast('KataGo could not start. See Settings.', 'error');
      return null;
    } finally {
      engineStarting = null;
    }
  })();
  return engineStarting;
}

/*
 * Openings recur from game to game, so the network's evaluations of early positions are
 * kept between visits (IndexedDB) and loaded into the engine's evaluation cache.
 */
const OPENING_STONES = 40;
const OPENING_ROWS = 6000;
async function keepOpeningCache(eng: BrowserEngine) {
  const key = `nncache:${eng.info.modelId}:${eng.info.engine}`;
  const cache = nnCacheFor(eng);
  try {
    const rows = await kvGet<CacheRow[]>(key);
    if (rows?.length) cache.importRows(rows);
  } catch {
    /* storage unavailable */
  }
  let saved = cache.stats().misses;
  const save = () => {
    const misses = cache.stats().misses;
    if (misses === saved || engine !== eng) return;
    saved = misses;
    void kvSet(key, cache.exportRows(OPENING_STONES, OPENING_ROWS)).catch(() => {});
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && save());
  const timer = setInterval(() => (engine === eng ? save() : clearInterval(timer)), 120_000);
}

let retuneNext = false;

/** Measure this device again (workers, batch size, half precision) and restart KataGo. */
export async function retuneEngine() {
  forgetTunings();
  retuneNext = true;
  return restartEngine();
}

/** Stop KataGo and start it again; `safe` uses only the built-in network on the CPU. */
export async function restartEngine(opts: { safe?: boolean } = {}) {
  const old = engine;
  engine = null;
  old?.terminate();
  stopStudent();
  safeMode = !!opts.safe;
  set({ engine: { status: 'off' } });
  return startEngine();
}

export const inSafeMode = () => safeMode;

/**
 * Use a KataGo network file from the user's disk (for when downloads are blocked or a
 * different network is wanted). It is stored in the browser's network cache.
 */
export async function loadNetworkFile(file: File) {
  const head = new Uint8Array(await file.slice(0, 256).arrayBuffer());
  const gz = head[0] === 0x1f && head[1] === 0x8b;
  const bin = !gz && head.indexOf(0x0a) > 2 && head.slice(0, head.indexOf(0x0a)).every((b) => b >= 0x20 && b < 0x7f);
  if (!gz && !bin) {
    toast(`${file.name} is not a KataGo network file (.bin.gz or .bin).`, 'error');
    return;
  }
  if (typeof caches === 'undefined') {
    toast('This browser cannot store network files (no Cache API), so a loaded network would not be kept.', 'error');
    return;
  }
  const name = file.name.replace(/[^\w.+-]/g, '_');
  try {
    const cache = await caches.open('doppelganger-models-v1');
    await cache.put(cacheKeyFor({ file: name }), new Response(file, { headers: { 'content-type': 'application/octet-stream' } }));
  } catch (e) {
    toast(`Could not store the network: ${(e as Error).message}`, 'error');
    return;
  }
  await saveSettings({ modelId: `file:${name}` });
  toast(`Loading ${name}…`, 'info');
  await restartEngine();
}

/** Forget that the graphics card failed and try it again. */
export async function retryGpu() {
  lsSet(GPU_BROKEN, null);
  lsSet(GPU_TRYING, null);
  await restartEngine();
}

// ---------------------------------------------------------------- import

async function readFiles(files: File[]): Promise<{ name: string; text: string }[]> {
  const out: { name: string; text: string }[] = [];
  for (const f of files) {
    if (f.size > 5_000_000) {
      toast(`${f.name} is too large to be an SGF file; skipped.`, 'error');
      continue;
    }
    try {
      // Chinese, Japanese and Korean SGFs are often GBK, Shift_JIS or EUC-KR rather than UTF-8.
      out.push({ name: f.name, text: decodeSgfBytes(new Uint8Array(await f.arrayBuffer())) });
    } catch (e) {
      toast(`Could not read ${f.name}: ${(e as Error).message}`, 'error');
    }
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
      toast(`Studying "${guess}". Change in Settings.`, 'info');
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

/**
 * Change some fields of some games. The analysis queue updates status and progress of the
 * same records while it runs, so patches apply to the current state and the stored copy is
 * written from it, never from a snapshot taken before an await.
 */
async function patchGames(patches: Map<string, Partial<GameRecord>>) {
  if (!patches.size) return;
  set((s) => ({ games: s.games.map((g) => (patches.has(g.id) ? { ...g, ...patches.get(g.id) } : g)), corpusVersion: s.corpusVersion + 1 }));
  const d = await db();
  for (const id of patches.keys()) {
    const g = get().games.find((x) => x.id === id);
    if (g) await d.put('games', g);
  }
}

export async function setPlayerNames(names: string[]) {
  await saveSettings({ playerNames: names });
  const lower = new Set(names.map((n) => n.trim().toLowerCase()));
  const patches = new Map<string, Partial<GameRecord>>();
  for (const g of get().games) {
    if (g.source !== 'user') continue;
    const b = lower.has(g.black.trim().toLowerCase());
    const w = lower.has(g.white.trim().toLowerCase());
    const playerColor = b && !w ? (1 as const) : w && !b ? (2 as const) : null;
    if (playerColor !== g.playerColor) patches.set(g.id, { playerColor });
  }
  await patchGames(patches);
  await rebuildProfile();
}

export async function setGameColor(id: string, color: 1 | 2 | null) {
  await patchGames(new Map([[id, { playerColor: color }]]));
  scheduleRebuild();
}

/**
 * Answer "which side were you?" for a game. With `remember`, that name becomes one of the
 * user's names and every other game where the side is still unknown is matched to it.
 */
/** Correct a game's komi (Fox and other servers sometimes store it wrong); the game is analysed again. */
export async function setGameKomi(id: string, komi: number) {
  const g = get().games.find((x) => x.id === id);
  if (!g || !Number.isFinite(komi) || g.komi === komi) return;
  const next: GameRecord = {
    ...g,
    komi,
    status: 'pending',
    error: undefined,
    warnings: g.warnings.filter((w) => !w.startsWith('komi')),
    progress: { fast: 0, deep: 0, deepTotal: 0, total: g.moves.length + 1 },
  };
  const d = await db();
  await d.put('games', next);
  set((s) => ({ games: s.games.map((x) => (x.id === id ? next : x)) }));
  toast(`Komi set to ${komi}. The game will be analysed again.`, 'ok');
  if (get().settings.autoAnalyze) void runQueue();
}

/** Rename a game's players (display only: the analysis and your side stay as they are). */
export async function renameGamePlayers(id: string, black: string, white: string) {
  const g = get().games.find((x) => x.id === id);
  if (!g || (g.black === black && g.white === white)) return;
  const next: GameRecord = { ...g, black, white };
  const d = await db();
  await d.put('games', next);
  set((s) => ({ games: s.games.map((x) => (x.id === id ? next : x)) }));
}

/**
 * Save a game played against a Doppelgänger copy to the library, so it can be reviewed like
 * any other game. Returns the id it was saved under (existing games with the same moves are
 * reused rather than duplicated, so calling this more than once for the same game is safe).
 */
export async function saveDoppelGame(g: {
  size: number;
  komi: number;
  setup: Move[];
  moves: Move[];
  user: Color;
  black: string;
  white: string;
  result?: string;
  /** An earlier save of the same game (fewer moves), replaced by this one. */
  replaces?: string;
}): Promise<string> {
  const parsed = { size: g.size, komi: g.komi, handicap: 0, setup: g.setup, moves: g.moves, black: g.black, white: g.white, result: g.result, event: 'Played against a Doppelgänger copy', warnings: [] };
  const sgf = toSgf(parsed);
  const rec: GameRecord = {
    id: gameId(parsed),
    source: 'doppel',
    fileName: `${g.black} vs ${g.white}.sgf`,
    sgf,
    size: parsed.size,
    komi: parsed.komi,
    handicap: parsed.handicap,
    setup: parsed.setup,
    moves: parsed.moves,
    black: parsed.black,
    white: parsed.white,
    result: parsed.result,
    event: parsed.event,
    playerColor: g.user,
    importedAt: Date.now(),
    status: 'pending',
    warnings: [],
    progress: { fast: 0, deep: 0, deepTotal: 0, total: g.moves.length + 1 },
  };
  const existing = get().games.find((x) => x.id === rec.id);
  if (existing) return existing.id;
  const d = await db();
  await d.put('games', rec);
  const old = g.replaces && g.replaces !== rec.id && get().games.some((x) => x.id === g.replaces && x.source === 'doppel') ? g.replaces : null;
  if (old) await deleteGames([old]);
  set((st) => ({ games: [...st.games.filter((x) => x.id !== old), rec] }));
  if (get().settings.autoAnalyze) void runQueue();
  return rec.id;
}

export async function chooseSide(id: string, color: 1 | 2, remember: boolean) {
  const game = get().games.find((g) => g.id === id);
  if (!game) return;
  const name = (color === 1 ? game.black : game.white).trim();
  let names = get().settings.playerNames;
  if (remember && name && !names.some((n) => n.trim().toLowerCase() === name.toLowerCase())) {
    names = [...names, name];
    await saveSettings({ playerNames: names });
  }
  const patches = new Map<string, Partial<GameRecord>>([[id, { playerColor: color }]]);
  if (remember)
    for (const g of get().games) {
      if (g.id === id || g.source !== 'user' || g.playerColor !== null) continue;
      const c = detectPlayerColor(g, names);
      if (c) patches.set(g.id, { playerColor: c });
    }
  await patchGames(patches);
  if (patches.size > 1) toast(`Matched "${name}" in ${patches.size - 1} more game${patches.size > 2 ? 's' : ''}.`, 'ok');
  scheduleRebuild();
}

let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
/** Rebuild the profile shortly after a burst of edits (e.g. answering several side questions). */
function scheduleRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => void rebuildProfile(), 700);
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
  // The demo ships its own (network-only) analysis; keep it rather than re-analysing.
  const demoGames = new Map(demo.games.map((g) => [g.id, g]));
  for (const a of demo.analyses) {
    const g = demoGames.get(a.gameId);
    if (g) Object.assign(a, { version: ANALYSIS_VERSION, komi: engineKomi(g.komi, g.rules) });
  }
  const d = await db();
  const tx = d.transaction(['games', 'analyses'], 'readwrite');
  for (const g of demo.games) await tx.objectStore('games').put(g);
  for (const a of demo.analyses) await tx.objectStore('analyses').put(a);
  await tx.done;
  const s = get();
  const opp: OpponentProfile = {
    id: DEMO_RIVAL_ID,
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

/** Remove the demo player, her rival and their analyses. */
export async function removeDemo() {
  const s = get();
  const ids = s.games.filter((g) => g.source === 'demo' || g.source === 'demo-opponent').map((g) => g.id);
  if (s.opponents.some((o) => o.id === DEMO_RIVAL_ID)) {
    await (await db()).delete('opponents', DEMO_RIVAL_ID);
    set((st) => ({ opponents: st.opponents.filter((o) => o.id !== DEMO_RIVAL_ID) }));
  }
  await removeGames(ids);
  await rebuildProfile();
  toast('Demo data removed.', 'ok');
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
const engineRetries = new Map<string, number>();

/*
 * The engine runs one request at a time. While someone is using the analysis board,
 * background game analysis waits between positions so the board answers quickly.
 */
let interactiveUntil = 0;
export function markInteractive(ms = 6000) {
  interactiveUntil = Math.max(interactiveUntil, Date.now() + ms);
}
const interactiveNow = () => Date.now() < interactiveUntil;
async function waitForInteractive() {
  while (interactiveNow() && !stopRequested) await new Promise((r) => setTimeout(r, 200));
  // Heat and battery: background analysis rests between positions (see governor.ts).
  await pace(() => stopRequested || interactiveNow());
}

/**
 * Search visits per position for background analysis: the setting, or about two and a
 * half seconds of this device's time per position (12 to 400 visits).
 */
export function searchVisitsFor(eng: { evalMs: number; batch: number; batchMs?: number; tuning?: { evalsPerSec: number } | null }, setting: number): number {
  if (setting > 0) return setting;
  const perEval = eng.tuning?.evalsPerSec ? 1000 / eng.tuning.evalsPerSec : eng.batch > 1 && eng.batchMs ? eng.batchMs / eng.batch : eng.evalMs || 150;
  return Math.max(12, Math.min(400, Math.round(2500 / perEval / 4) * 4));
}

export function pauseQueue() {
  stopRequested = true;
  set((s) => ({ queue: { ...s.queue, paused: true } }));
}

export function resumeQueue() {
  set((s) => ({ queue: { ...s.queue, paused: false } }));
  void runQueue();
}

/** The analysis queue owns only these fields of a game; the rest (side, names) can change while it runs. */
const queueFields = (g: GameRecord): Partial<GameRecord> => ({ status: g.status, error: g.error, progress: { ...g.progress } });

function showQueueState(g: GameRecord) {
  set((s) => ({ games: s.games.map((x) => (x.id === g.id ? { ...x, ...queueFields(g) } : x)) }));
}

/** Saves the queue's fields onto the current record, and nothing for a game removed meanwhile. */
const queueStore: AnalysisStore = {
  ...idbAnalysisStore,
  async saveGame(g) {
    const cur = get().games.find((x) => x.id === g.id);
    if (cur) await idbAnalysisStore.saveGame({ ...cur, ...queueFields(g) });
  },
};

/**
 * The next game to work on. Every game first gets the network's quick look (so graphs and
 * a first profile appear within minutes), then the slower search, the player's own games
 * first, then opponents'.
 */
function nextGame(): { game: GameRecord; stage: 'fast' | 'full' } | undefined {
  const games = get().games.filter((g) => g.status !== 'done' && g.status !== 'error' && g.status !== 'skipped');
  const pick = (list: GameRecord[]) => list.find((g) => g.source === 'user' && g.playerColor !== null) ?? list.find((g) => g.source === 'user') ?? list[0];
  const unseen = games.filter((g) => g.status === 'pending');
  if (unseen.length) return { game: pick(unseen), stage: 'fast' };
  return games.length ? { game: pick(games), stage: 'full' } : undefined;
}

/** Background analysis of all pending games. Safe to call repeatedly. */
export async function runQueue() {
  if (get().queue.running) return;
  stopRequested = false;
  set((s) => ({ queue: { ...s.queue, running: true, paused: false, lastError: undefined } }));
  let doneSinceRebuild = 0;
  let lastStage: 'fast' | 'full' | null = null;
  try {
    for (;;) {
      if (stopRequested) break;
      const next = nextGame();
      if (!next) break;
      const g = next.game;
      // Every game has had its first look: build the profile and the copy from it now,
      // rather than after the (much longer) search of every game.
      if (next.stage === 'full' && lastStage === 'fast' && doneSinceRebuild > 0) {
        doneSinceRebuild = 0;
        await rebuildProfile();
      }
      lastStage = next.stage;
      const eng = await startEngine();
      if (!eng) break;
      set((s) => ({ queue: { ...s.queue, currentGameId: g.id } }));
      const { settings } = get();
      const game: GameRecord = { ...g, progress: { ...g.progress } };
      try {
        // The PC helper takes the whole game at once (its positions are searched side by side).
        if (next.stage === 'full' && pcReady()) pcPrefetchGame(game);
        const stud = game.size === 19 ? await startStudent(() => eng.activeLanes) : null;
        const visits = studentVisits(searchVisitsFor(eng, settings.searchVisits), game.size);
        const analysis = await analyzeGame(game, eng, queueStore, {
          visits: game.source === 'opponent' ? Math.max(8, Math.round(visits / 2)) : visits,
          stage: next.stage,
          shouldStop: () => stopRequested,
          yieldTo: waitForInteractive,
          interrupted: interactiveNow,
          onProgress: showQueueState,
          thrifty: isCool(),
          known: knownAnswer,
          anchor: anchorFor(eng.info.modelId, engineKomi(game.komi, game.rules), game.size, eng),
          ...(stud ? { evaluator: searchEvaluator(eng, game.size), evaluatorBatch: stud.batch } : {}),
        });
        set((s) => ({
          analyses: { ...s.analyses, [game.id]: analysis },
          games: s.games.map((x) => (x.id === game.id ? { ...x, ...queueFields(game) } : x)),
          corpusVersion: s.corpusVersion + 1,
        }));
        doneSinceRebuild++;
        // An imported player's statistics and copy follow their analysed games.
        if (game.source === 'opponent') for (const o of get().opponents.filter((x) => x.gameIds.includes(game.id))) await saveOpponent(o);
        if (doneSinceRebuild >= (next.stage === 'fast' ? 6 : 3)) {
          doneSinceRebuild = 0;
          await rebuildProfile();
        }
      } catch (e) {
        if (e instanceof AnalysisStopped) {
          game.status = game.status === 'deep' ? 'fast' : 'pending';
          await queueStore.saveGame(game);
          showQueueState(game);
          break;
        }
        // The engine crashed or hung: it restarts in a safer mode and the game resumes from its checkpoint.
        if (isEngineFailure(e) && (engineRetries.get(game.id) ?? 0) < 2) {
          engineRetries.set(game.id, (engineRetries.get(game.id) ?? 0) + 1);
          game.status = 'pending';
          await queueStore.saveGame(game);
          showQueueState(game);
          toast(`KataGo stopped responding, so it was restarted in a safer mode: ${(e as Error).message}`, 'info');
          continue;
        }
        game.status = 'error';
        game.error = (e as Error).message;
        await queueStore.saveGame(game);
        showQueueState(game);
        set((s) => ({ queue: { ...s.queue, lastError: game.error } }));
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

/**
 * Keep a live analysis that read further than the stored one: the game's graph, move
 * losses and profile then use the deeper numbers. Profile and records follow after a
 * pause, since several positions are usually refined in a row.
 */
let liveCommitTimer: ReturnType<typeof setTimeout> | undefined;
export async function commitLiveAnalysis(gameId: string, index: number, snap: SearchSnapshot) {
  const s = get();
  const a = s.analyses[gameId];
  const g = s.games.find((x) => x.id === gameId);
  const cur = a?.evals[index];
  if (!a || !g || !cur || !analysisIsCurrent(a, g) || s.queue.currentGameId === gameId) return;
  if (snap.toPlay !== cur.toPlay || snap.visits < Math.max(cur.visits * 1.5, cur.visits + 16)) return;
  const evals = [...a.evals];
  evals[index] = searchedEval(cur, snap, { played: g.moves[index]?.loc });
  const next: GameAnalysis = { ...a, evals, updatedAt: Date.now() };
  try {
    await (await db()).put('analyses', next);
  } catch {
    return;
  }
  set((st) => ({ analyses: { ...st.analyses, [gameId]: next } }));
  clearTimeout(liveCommitTimer);
  liveCommitTimer = setTimeout(() => {
    set((st) => ({ corpusVersion: st.corpusVersion + 1 }));
    void rebuildProfile();
  }, 20_000);
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
      // Compare with players of the same level, so unusual weaknesses are trained first.
      await levelCalibration();
      const level = levelOf(c.gameOrder().map((id) => c.games.get(id)!).filter((g) => g.playerColor !== null).map((g) => ({ game: g, color: g.playerColor! })));
      const all = sortWeaknesses(withPeers([...weaknesses, ...llmOnly], level));

      // Doppelgänger training data.
      const examples = await copyExamples(player, (id) => c.games.get(id), (id) => c.analyses.get(id), (id) => c.boards(id));
      const version = (s.doppel?.version ?? 0) + 1;
      const doppel = examples.length >= 30 ? trainDoppel(examples, { version }) : s.doppel;

      const names = s.settings.playerNames;
      const profile: PlayerProfile = {
        id: 'me',
        name: usesDemoData(s) ? `${DEMO_PLAYER} (demo)` : names[0] ?? 'You',
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
      const minWin = s.settings.minLosingWinrate;
      for (const w of all) {
        const fresh = generateItems(c, w, { minLosingWinrate: minWin });
        const variations = practiceItems((s.items[w.id] ?? []).filter((i) => i.modification), minWin);
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
  if (!s.settings.useLlm) {
    toast('Pattern discovery is off (Settings).', 'info');
    return;
  }
  set((st) => ({ busy: { ...st.busy, llm: true } }));
  try {
    const c = corpus();
    const built = buildDiscoveryRequest(c, s.weaknesses, s.profile?.axes ?? []);
    if (!built.req.clusters.length) {
      toast('Pattern discovery needs mistakes that repeat across several analysed games. Analyse more of your games (5 or more works best) and try again.', 'info');
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

/** Re-check the LLM; `live` makes a tiny real call so a bad key or retired models show up. */
export async function refreshLlmStatus(live = false) {
  set((s) => ({ busy: { ...s.busy, llmCheck: true } }));
  try {
    set({ llm: await llmStatus(live) });
  } finally {
    set((s) => ({ busy: { ...s.busy, llmCheck: false } }));
  }
}

// ---------------------------------------------------------------- training

/**
 * Check an answer the stored analysis did not cover well: a short search of the position
 * with the answer given part of the visits, so the answer and the best move are measured
 * by the same search.
 */
async function liveEval(item: TrainingItem, loc: Loc): Promise<LiveCheck | null> {
  const eng = engine;
  if (!eng) return null;
  try {
    const board = itemBoard(item);
    if (loc !== PASS && !board.isLegal(loc, item.toPlay)) return null;
    const visits = Math.max(24, Math.min(160, Math.round(searchVisitsFor(eng, 0) / 2)));
    const search = new Search(engineEvaluator(eng), { size: item.size, komi: engineKomi(item.komi, item.rules), moves: engineMoves(item.setup, item.moves), toPlay: item.toPlay, board }, { batch: eng.batch });
    markInteractive(8000);
    const snap = await search.run({ visits, maxMs: 6000, forced: loc, forcedShare: 0.3 });
    const answer = snap.candidates.find((c) => c.loc === loc);
    const best = snap.candidates[0];
    if (!answer || !best) return null;
    return { win: answer.winrate, lead: answer.scoreLead, bestWin: best.winrate, bestLead: best.scoreLead, bestLoc: best.loc };
  } catch {
    return null;
  }
}

export async function submitAnswer(item: TrainingItem, loc: Loc, timeMs: number, mode: 'forge' | 'blind', sessionId: string, opts: { reason?: string; assisted?: boolean } = {}) {
  const live = answerCovered(item, loc) ? null : await liveEval(item, loc);
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
    reason: opts.reason,
    assisted: opts.assisted || undefined,
    at: Date.now(),
  };
  const s = get();
  const prior = s.attempts.filter((a) => a.weaknessId === item.weaknessId && !a.assisted);
  // Answers found with the analysis board open are kept but do not move mastery.
  const counts = mode === 'forge' && !attempt.assisted;
  const m = counts ? updateMastery(s.mastery[item.weaknessId] ?? newMastery(item.weaknessId), attempt, prior) : null;
  const d = await db();
  await d.put('attempts', attempt);
  if (m) await d.put('mastery', m);
  set((st) => ({ attempts: [...st.attempts, attempt], mastery: m ? { ...st.mastery, [item.weaknessId]: m } : st.mastery }));
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
  // Some shifts tip the game past the winrate limit and are dropped, so try more sources.
  const sources = list.filter((i) => (i.kind === 'original' || i.kind === 'similar') && !i.modification).slice(0, count * 3);
  const made: TrainingItem[] = [];
  const minWin = get().settings.minLosingWinrate;
  for (const src of sources) {
    if (made.length >= count) break;
    try {
      const v = await makeVariation(src, eng, Math.random, eng.info.backend === 'cpu' ? 32 : 64, minWin);
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

/** Copy training examples from the moves in `moves` (one side's moves in analysed games). */
async function copyExamples(
  moves: readonly { gameId: string; index: number; color: Color; loc: Loc }[],
  gameOf: (id: string) => GameRecord | undefined,
  analysisOf: (id: string) => GameAnalysis | undefined,
  boardsOf: (id: string) => Board[],
): Promise<DoppelExample[]> {
  const examples: DoppelExample[] = [];
  let n = 0;
  for (const r of moves) {
    const g = gameOf(r.gameId);
    const e = analysisOf(r.gameId)?.evals[r.index];
    if (!g || !e || r.loc === PASS) continue;
    const ctx = buildContext(boardsOf(r.gameId)[r.index], decodeOwnership(e.ownership));
    const prev = r.index > 0 ? g.moves[r.index - 1] : null;
    const ex = buildExample(ctx, e.policy, r.color, prev && prev.color !== r.color ? prev.loc : null, r.loc, r.gameId);
    if (ex) examples.push(ex);
    if (++n % 150 === 0) await tick();
  }
  return examples;
}

/** A copy of an imported player, learned from their analysed games (null until 30 moves). */
async function opponentCopy(o: OpponentProfile, games: GameRecord[], analyses: Record<string, GameAnalysis>): Promise<DoppelModel | undefined> {
  const names = new Set([o.name, ...o.aliases].map((x) => x.trim().toLowerCase()));
  const moves: { gameId: string; index: number; color: Color; loc: Loc }[] = [];
  const boards = new Map<string, Board[]>();
  for (const g of games) {
    if (!analyses[g.id]) continue;
    const color: Color | null = names.has(g.black.trim().toLowerCase()) ? 1 : names.has(g.white.trim().toLowerCase()) ? 2 : null;
    if (!color) continue;
    g.moves.forEach((m, index) => m.color === color && moves.push({ gameId: g.id, index, color, loc: m.loc }));
  }
  const byId = new Map(games.map((g) => [g.id, g]));
  const examples = await copyExamples(
    moves,
    (id) => byId.get(id),
    (id) => analyses[id],
    (id) => {
      let b = boards.get(id);
      if (!b) {
        const g = byId.get(id)!;
        b = allPositions(g.size, g.setup, g.moves);
        boards.set(id, b);
      }
      return b;
    },
  );
  if (examples.length < 30) return undefined;
  return trainDoppel(examples, { version: (o.copy?.version ?? 0) + 1 });
}

export async function saveOpponent(o: OpponentProfile) {
  const s = get();
  const games = s.games.filter((g) => o.gameIds.includes(g.id));
  const analyses = new Map(Object.entries(s.analyses));
  const copy = await opponentCopy(o, games, s.analyses).catch(() => undefined);
  const next = { ...o, stats: buildOpponentStats(o.name, o.aliases, games, analyses), copy: copy ?? o.copy, updatedAt: Date.now() };
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
