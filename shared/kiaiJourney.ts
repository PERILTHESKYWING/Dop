/**
 * Kiai's study path: points from real study, a 30 kyu → 9 dan path, days in a row and seals.
 * Pure (no DOM, no node imports): the browser (kami/src/lib/journey.ts) and the account server
 * (shared/kiaiAccount.ts) both use it, so a merge gives the same bytes on either side.
 *
 * Rules that keep it from nagging (they bind every screen that shows the path):
 * 1. No notifications, emails, sounds, modals, confetti, red dots or unread counters.
 * 2. Never warn about a run of days about to end. A missed day changes the number quietly;
 *    `best` stays visible.
 * 3. Only two things ever appear on their own: passing a station and stamping a seal, each a
 *    single 2.6 s toast, switchable off.
 * 4. Nothing unlocks or locks. No feature depends on points or on signing in.
 * 5. Sign-in is never prompted. It lives only in the Account menu and Settings.
 * 6. Asking at ultraGO earns the same as at Low (no reason to spend the free LLM tier).
 * 7. No word "XP", "level up", "unlock", "rank" (except in "not a rank"), no "!", no emoji.
 *    tests/kiai-journey.test.ts scans the copy.
 *
 * Data: one grow-only counter per device and day (a CRDT). Only a device raises its own
 * counts, so a merge is the max per (device, day, field) and two devices add up instead of
 * overwriting. Points, stations, days in a row and seals are all derived at read time, so the
 * daily limits hold across devices and a later change of values re-scores all history (only
 * ever raise values: the test pins them).
 */

export type DayKey = string; // 'YYYY-MM-DD', the device's local date
export type StudyKind = 'review' | 'ask' | 'guided' | 'solve';
/** One device, one day: [reviews, asks, guided, solves, lifeDeathAsks]. Only that device raises them. */
export type DayCounts = [number, number, number, number, number];
export interface Journey {
  v: 1;
  /** Raised by Reset; the higher generation wins a merge outright. */
  gen: number;
  /** device id -> day -> counts */
  dev: Record<string, Record<DayKey, DayCounts>>;
  /** review/guided/solve ids already counted ('r:…', 'g:…', 's:…') -> day first counted */
  seen: Record<string, DayKey>;
}
export interface SyncedSetting {
  v: string | number | boolean;
  at: number;
}
export interface KiaiDoc {
  v: 1;
  journey: Journey;
  settings: Record<string, SyncedSetting>;
}

export const POINTS = { review: 30, ask: 5, guided: 40, solve: 10, firstOfDay: 10 } as const;
export const PER_DAY = { review: 3, ask: 12, guided: 2, solve: 10, total: 150 } as const;
export const REVIEW_MIN_MOVES = 30;
export const RESTS = { start: 1, every: 7, max: 2 } as const;
export const LIMITS = { devices: 20, daysPerDevice: 4000, seen: 2000, settings: 40, docChars: 256_000 } as const;

const KIND_INDEX: Record<StudyKind, number> = { review: 0, ask: 1, guided: 2, solve: 3 };
const ID_PREFIX: Partial<Record<StudyKind, string>> = { review: 'r:', guided: 'g:', solve: 's:' };
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEVICE_RE = /^[a-z0-9]{6,24}$/;
const SEEN_RE = /^[rgs]:[a-z0-9]{4,30}$/;
const SETTING_RE = /^[a-z][a-zA-Z0-9.]{1,40}$/;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- copy

/** Every user-facing journey string. `{x}` marks a value filled by `fill`. */
export const COPY: Record<string, string> = {
  blurb: 'A quiet record of your study: games reviewed and questions answered. Nothing is locked behind it, and nothing reminds you.',
  off: 'Off. Nothing is counted or shown.',
  notStarted: 'Your path starts with your first reviewed game or answered question.',
  head: 'Study path · stage {n} of {of} · {label}',
  toNext: '{into} of {span} points to {next}',
  last: "The last station. The path stops here; study doesn't.",
  honesty: "The path counts study, not strength. It is not a rank. Kiai's estimate of how you play is the Strength graph of a reviewed game.",
  daysTitle: 'Days in a row',
  daysLine: '{n} days in a row',
  dayLine: '1 day in a row',
  best: 'best {best}',
  restsSaved: '{n} rest day saved',
  restsSavedMany: '{n} rest days saved',
  noRests: 'no rest day saved',
  restHelp: 'A rest day (a stone with a dash) is used by itself when you miss a day. You start with one and get another for every 7 days in a row, up to 2.',
  sealsTitle: 'Seals',
  stamped: 'stamped {date}',
  progress: '{n} of {of}',
  howTitle: 'How the path grows',
  howReview: 'Review a whole game of 30 moves or more',
  howAsk: 'Get an answer about a position or idea',
  howGuided: 'Finish a guided review',
  howSolve: 'Find the move in a built position',
  howFirst: 'First study of the day',
  howEach: '{points} points, up to {max} a day',
  howOnce: '{points} points, once a day',
  dailyLimit: 'Daily limit 150 points. The path rewards steady study, not long sessions.',
  classical: 'Dan stations carry the nine classical grades of Go, from 守拙 to 入神.',
  noteStation: 'On the path: {label}',
  noteSeal: 'Seal: {kanji} {title}',
  sidebarLine: 'Study path · {label}',
  resetConfirm: 'Reset your path? Points, days and seals go back to the start on every device you sync.',
};

/** COPY[key] with `{name}` filled in. */
export function fill(key: string, vals: Record<string, string | number> = {}): string {
  return (COPY[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vals[k] ?? ''));
}

// ---------------------------------------------------------------- days

/** The device's local date. */
export function dayKey(d: Date = new Date()): DayKey {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const dayMs = (day: DayKey) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** `day` moved by `n` calendar days (UTC arithmetic, so no daylight-saving drift). */
export function addDays(day: DayKey, n: number): DayKey {
  return utcDay(dayMs(day) + n * DAY_MS);
}

// ---------------------------------------------------------------- ids

function fnv(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Two 32-bit FNV-1a passes, base36: a short id that is not reversible to a game or a question. */
export function hashId(s: string): string {
  return fnv(s, 0x811c9dc5).toString(36).padStart(7, '0') + fnv(s, 0x9747b28c).toString(36).padStart(7, '0');
}

// ---------------------------------------------------------------- building

export function emptyJourney(gen = 0): Journey {
  return { v: 1, gen, dev: {}, seen: {} };
}

export function emptyDoc(): KiaiDoc {
  return { v: 1, journey: emptyJourney(), settings: {} };
}

/** Copy of an object with keys in sorted order, so JSON.stringify is canonical. */
function sorted<T>(o: Record<string, T>, map: (v: T, k: string) => T = (v) => v): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(o).sort()) out[k] = map(o[k], k);
  return out;
}

const zero = (): DayCounts => [0, 0, 0, 0, 0];
const clampCount = (n: number) => Math.max(0, Math.min(999, Math.floor(n)));

/** Today's question ids, kept on the device only, so the same question on the same position counts once a day. */
export interface AskedLog {
  day: DayKey;
  ids: string[];
}
const ASKED_MAX = 60;

/**
 * Count one study action. Review, guided and solve need an id ('r:…'): a game counts once,
 * ever. An ask may carry an id and `asked` (today's log): the same words on the same position
 * count once a day. Returns the journey unchanged and `counted:false` for a repeat.
 */
export function record(
  j: Journey,
  device: string,
  day: DayKey,
  kind: StudyKind,
  opts: { id?: string; lifeDeath?: boolean; asked?: AskedLog | null } = {},
): { journey: Journey; counted: boolean; asked?: AskedLog } {
  let asked: AskedLog | undefined;
  const prefix = ID_PREFIX[kind];
  if (prefix) {
    if (!opts.id || !opts.id.startsWith(prefix) || j.seen[opts.id]) return { journey: j, counted: false };
  } else if (opts.id) {
    const prev = opts.asked && opts.asked.day === day ? opts.asked.ids : [];
    if (prev.includes(opts.id)) return { journey: j, counted: false };
    asked = { day, ids: [...prev, opts.id].slice(-ASKED_MAX) };
  }
  const days = { ...(j.dev[device] ?? {}) };
  const c = [...(days[day] ?? zero())] as DayCounts;
  c[KIND_INDEX[kind]] = clampCount(c[KIND_INDEX[kind]] + 1);
  if (kind === 'ask' && opts.lifeDeath) c[4] = clampCount(c[4] + 1);
  days[day] = c;
  const journey: Journey = {
    v: 1,
    gen: j.gen,
    dev: sorted({ ...j.dev, [device]: sorted(days) }),
    seen: prefix ? sorted({ ...j.seen, [opts.id!]: day }) : j.seen,
  };
  return { journey, counted: true, asked };
}

// ---------------------------------------------------------------- merge

function pruneSeen(seen: Record<string, DayKey>): Record<string, DayKey> {
  const keys = Object.keys(seen);
  if (keys.length <= LIMITS.seen) return sorted(seen);
  // The newest ids stay: day descending, then id, a total order so every side keeps the same ones.
  keys.sort((a, b) => (seen[a] === seen[b] ? (a < b ? -1 : 1) : seen[a] > seen[b] ? -1 : 1));
  const keep: Record<string, DayKey> = {};
  for (const k of keys.slice(0, LIMITS.seen)) keep[k] = seen[k];
  return sorted(keep);
}

function lastDay(days: Record<DayKey, DayCounts>): DayKey {
  let m = '';
  for (const d in days) if (d > m) m = d;
  return m;
}

function capDevices(dev: Record<string, Record<DayKey, DayCounts>>): Record<string, Record<DayKey, DayCounts>> {
  const ids = Object.keys(dev);
  if (ids.length <= LIMITS.devices) return dev;
  // Devices seen most recently stay.
  const last = Object.fromEntries(ids.map((id) => [id, lastDay(dev[id])]));
  ids.sort((a, b) => (last[a] === last[b] ? (a < b ? -1 : 1) : last[a] > last[b] ? -1 : 1));
  const keep = new Set(ids.slice(0, LIMITS.devices));
  return sorted(Object.fromEntries(Object.entries(dev).filter(([k]) => keep.has(k))));
}

function canonical(j: Journey): Journey {
  return {
    v: 1,
    gen: j.gen,
    dev: capDevices(sorted(j.dev, (days) => sorted(days, (c) => [...c] as DayCounts))),
    seen: pruneSeen(j.seen),
  };
}

/** Higher generation wins whole; equal: max per (device, day, field); seen: union, earliest day. */
export function mergeJourney(a: Journey, b: Journey): Journey {
  if (a.gen !== b.gen) return canonical(a.gen > b.gen ? a : b);
  const dev: Record<string, Record<DayKey, DayCounts>> = {};
  for (const id of new Set([...Object.keys(a.dev), ...Object.keys(b.dev)])) {
    const x = a.dev[id] ?? {};
    const y = b.dev[id] ?? {};
    const days: Record<DayKey, DayCounts> = {};
    for (const d of new Set([...Object.keys(x), ...Object.keys(y)])) {
      const p = x[d] ?? zero();
      const q = y[d] ?? zero();
      days[d] = p.map((v, i) => Math.max(v, q[i])) as DayCounts;
    }
    dev[id] = days;
  }
  const seen: Record<string, DayKey> = { ...a.seen };
  for (const [k, d] of Object.entries(b.seen)) if (!seen[k] || d < seen[k]) seen[k] = d;
  return canonical({ v: 1, gen: a.gen, dev, seen });
}

function settingWins(a: SyncedSetting, b: SyncedSetting): boolean {
  if (a.at !== b.at) return a.at > b.at;
  return JSON.stringify(a.v) >= JSON.stringify(b.v);
}

/** Journey as mergeJourney; settings: the later `at` wins per key, a tie goes to the larger JSON. */
export function mergeDoc(a: KiaiDoc, b: KiaiDoc): KiaiDoc {
  const settings: Record<string, SyncedSetting> = {};
  for (const k of [...new Set([...Object.keys(a.settings), ...Object.keys(b.settings)])].sort()) {
    const x = a.settings[k];
    const y = b.settings[k];
    const w = !x ? y : !y ? x : settingWins(x, y) ? x : y;
    settings[k] = { v: w.v, at: w.at };
  }
  return { v: 1, journey: mergeJourney(a.journey, b.journey), settings };
}

// ---------------------------------------------------------------- sanitize

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** A doc from the network or storage, cleaned to fit the shapes and limits above; null if it is not one. */
export function sanitizeDoc(x: unknown, now: number = Date.now()): KiaiDoc | null {
  if (!isObj(x) || x.v !== 1 || !isObj(x.journey)) return null;
  const j = x.journey;
  if (j.v !== 1 || typeof j.gen !== 'number' || !Number.isInteger(j.gen) || j.gen < 0 || j.gen > 1e6) return null;
  if (!isObj(j.dev) || !isObj(j.seen)) return null;
  const maxDay = utcDay(now + DAY_MS);
  const okDay = (d: string) => DAY_RE.test(d) && d <= maxDay && !Number.isNaN(dayMs(d));

  const dev: Record<string, Record<DayKey, DayCounts>> = {};
  for (const [id, daysRaw] of Object.entries(j.dev)) {
    if (!DEVICE_RE.test(id) || !isObj(daysRaw)) continue;
    const entries: [DayKey, DayCounts][] = [];
    for (const [d, c] of Object.entries(daysRaw)) {
      if (!okDay(d) || !Array.isArray(c)) continue;
      const counts = Array.from({ length: 5 }, (_, i) => (typeof c[i] === 'number' && Number.isFinite(c[i]) ? clampCount(c[i] as number) : 0)) as DayCounts;
      if (counts.some((n) => n > 0)) entries.push([d, counts]);
    }
    if (!entries.length) continue;
    entries.sort((p, q) => (p[0] < q[0] ? 1 : -1));
    dev[id] = Object.fromEntries(entries.slice(0, LIMITS.daysPerDevice));
  }

  const seen: Record<string, DayKey> = {};
  for (const [k, d] of Object.entries(j.seen)) if (SEEN_RE.test(k) && typeof d === 'string' && okDay(d)) seen[k] = d;

  const settings: Record<string, SyncedSetting> = {};
  if (isObj(x.settings)) {
    let n = 0;
    for (const k of Object.keys(x.settings).sort()) {
      if (n >= LIMITS.settings) break;
      const s = x.settings[k];
      if (!SETTING_RE.test(k) || !isObj(s) || typeof s.at !== 'number' || !Number.isFinite(s.at)) continue;
      const v = s.v;
      const ok = (typeof v === 'string' && v.length <= 120) || (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean';
      if (!ok) continue;
      settings[k] = { v: v as SyncedSetting['v'], at: Math.max(0, Math.min(now + DAY_MS, s.at)) };
      n++;
    }
  }
  return { v: 1, journey: canonical({ v: 1, gen: j.gen, dev, seen }), settings };
}

// ---------------------------------------------------------------- points

export interface DayTotal {
  day: DayKey;
  counts: DayCounts;
  points: number;
}

/** A day's points from its counts summed over devices. */
export function dayPoints(c: DayCounts): number {
  const [r, a, g, s] = c;
  if (!(r || a || g || s)) return 0;
  const raw =
    POINTS.firstOfDay +
    POINTS.review * Math.min(r, PER_DAY.review) +
    POINTS.ask * Math.min(a, PER_DAY.ask) +
    POINTS.guided * Math.min(g, PER_DAY.guided) +
    POINTS.solve * Math.min(s, PER_DAY.solve);
  return Math.min(PER_DAY.total, raw);
}

/** Every day with counts, ascending, counts summed over devices. */
export function dayTotals(j: Journey): DayTotal[] {
  const by = new Map<DayKey, DayCounts>();
  for (const days of Object.values(j.dev)) {
    for (const [d, c] of Object.entries(days)) {
      const t = by.get(d) ?? zero();
      for (let i = 0; i < 5; i++) t[i] += c[i];
      by.set(d, t);
    }
  }
  return [...by.keys()]
    .sort()
    .map((day) => ({ day, counts: by.get(day)!, points: dayPoints(by.get(day)!) }))
    .filter((t) => t.counts.some((n) => n > 0));
}

export function totalPoints(j: Journey): number {
  return dayTotals(j).reduce((s, t) => s + t.points, 0);
}

// ---------------------------------------------------------------- the path

export interface Station {
  i: number;
  id: string;
  label: string;
  short: string;
  at: number;
  classical?: { kanji: string; ja: string; zh: string; gloss: string };
}

/** The nine classical grades of Go: Japanese alternative names of 1 to 9 dan. */
const CLASSICAL: Station['classical'][] = [
  { kanji: '守拙', ja: 'shuzetsu', zh: 'shǒuzhuō', gloss: 'Guarding simplicity' },
  { kanji: '若愚', ja: 'jakugu', zh: 'ruòyú', gloss: 'Seeming foolish' },
  { kanji: '闘力', ja: 'tōryoku', zh: 'dòulì', gloss: 'Fighting strength' },
  { kanji: '小巧', ja: 'shōkō', zh: 'xiǎoqiǎo', gloss: 'Small skill' },
  { kanji: '用智', ja: 'yōchi', zh: 'yòngzhì', gloss: 'Using wisdom' },
  { kanji: '通幽', ja: 'tsūyū', zh: 'tōngyōu', gloss: 'Seeing the hidden' },
  { kanji: '具体', ja: 'gutai', zh: 'jùtǐ', gloss: 'Complete in form' },
  { kanji: '坐照', ja: 'zashō', zh: 'zuòzhào', gloss: 'Seeing while seated' },
  { kanji: '入神', ja: 'nyūshin', zh: 'rùshén', gloss: 'Entering the divine' },
];
const DAN_STEPS = [2400, 2800, 3200, 3600, 4200, 4800, 5600, 6400];

function buildPath(): Station[] {
  const out: Station[] = [];
  let at = 0;
  for (let i = 0; i < 39; i++) {
    if (i > 0) at += i <= 10 ? 20 : i <= 20 ? 160 : i <= 30 ? 900 : DAN_STEPS[i - 31];
    if (i < 30) {
      const k = 30 - i;
      out.push({ i, id: `${k}k`, label: `${k} kyu`, short: `${k}k`, at });
    } else {
      const d = i - 29;
      out.push({ i, id: `${d}d`, label: `${d} dan`, short: `${d}d`, at, classical: CLASSICAL[d - 1] });
    }
  }
  return out;
}

/** 30 kyu … 1 kyu, 1 dan … 9 dan, with the points needed to reach each. */
export const PATH: Station[] = buildPath();

export function stationAt(points: number): { station: Station; next: Station | null; into: number; span: number } {
  let i = 0;
  while (i + 1 < PATH.length && PATH[i + 1].at <= points) i++;
  const station = PATH[i];
  const next = PATH[i + 1] ?? null;
  return { station, next, into: points - station.at, span: next ? next.at - station.at : 0 };
}

// ---------------------------------------------------------------- days in a row

export type DayMark = 'study' | 'rest' | 'none' | 'today';
export interface Streak {
  current: number;
  best: number;
  rests: number;
  todayDone: boolean;
  week: { day: DayKey; mark: DayMark }[];
}

interface Replay {
  streak: Streak;
  /** The first day the run of days reached n (for the seals). */
  reached: (n: number) => DayKey | null;
}

function replay(j: Journey, today: DayKey): Replay {
  const study = new Set(dayTotals(j).filter((t) => t.points > 0 && t.day <= today).map((t) => t.day));
  const restDays = new Set<DayKey>();
  const firstAt = new Map<number, DayKey>();
  let streak = 0;
  let best = 0;
  let rests: number = RESTS.start;
  let run = 0;
  const studied = (d: DayKey) => {
    streak++;
    run++;
    if (run % RESTS.every === 0) rests = Math.min(RESTS.max, rests + 1);
    best = Math.max(best, streak);
    if (!firstAt.has(streak)) firstAt.set(streak, d);
  };
  const first = [...study].sort()[0];
  if (first) {
    for (let d = first; d < today; d = addDays(d, 1)) {
      if (study.has(d)) studied(d);
      else if (rests > 0 && streak > 0) {
        rests--;
        restDays.add(d);
      } else {
        streak = 0;
        run = 0;
        rests = 0;
      }
    }
    if (study.has(today)) studied(today);
  }
  const week = Array.from({ length: 7 }, (_, k) => {
    const day = addDays(today, k - 6);
    const mark: DayMark = study.has(day) ? 'study' : day === today ? 'today' : restDays.has(day) ? 'rest' : 'none';
    return { day, mark };
  });
  return {
    streak: { current: streak, best, rests, todayDone: study.has(today), week },
    reached: (n) => firstAt.get(n) ?? null,
  };
}

/** Days in a row up to `today` (a day not yet studied today never breaks it). */
export function streakOf(j: Journey, today: DayKey): Streak {
  return replay(j, today).streak;
}

// ---------------------------------------------------------------- seals

export interface Seal {
  id: string;
  kanji: string;
  reading: string;
  title: string;
  how: string;
  earned: DayKey | null;
  progress: [number, number];
  needs?: 'solve' | 'guided';
}

interface SealDef {
  id: string;
  kanji: string;
  reading: string;
  title: string;
  how: string;
  needs?: 'solve' | 'guided';
  /** 'streak': days in a row; 'days': days with a review; else a count index summed over days. */
  by: 'streak' | 'reviewDays' | 0 | 1 | 3 | 4;
  goal: number;
}

export const SEALS: SealDef[] = [
  { id: 'sanrensei', kanji: '三連星', reading: 'sanrensei', title: 'Three in a row', how: 'Study three days in a row.', by: 'streak', goal: 3 },
  { id: 'ichinichi', kanji: '一日一局', reading: 'ichinichi ikkyoku', title: 'A game a day', how: 'Review games on 7 different days.', by: 'reviewDays', goal: 7 },
  { id: 'shicho', kanji: '征', reading: 'shichō', title: 'The ladder', how: 'Thirty days in a row. Rest days keep it going.', by: 'streak', goal: 30 },
  { id: 'narabe', kanji: '棋譜並べ', reading: 'kifu narabe', title: 'Replaying games', how: 'Review 10 whole games.', by: 0, goal: 10 },
  { id: 'hyakkyoku', kanji: '百局', reading: 'hyakkyoku', title: 'A hundred games', how: 'Review 100 whole games.', by: 0, goal: 100 },
  { id: 'shikatsu', kanji: '死活', reading: 'shikatsu', title: 'Life and death', how: 'Ask 20 times whether a group lives or can be killed.', by: 4, goal: 20 },
  { id: 'shudan', kanji: '手談', reading: 'shudan', title: 'Hand talk', how: 'Ask Kiai 100 questions. Hand talk is an old name for Go.', by: 1, goal: 100 },
  { id: 'tesuji', kanji: '手筋', reading: 'tesuji', title: 'Tesuji', how: 'Find the move in 10 built positions without seeing the answer.', by: 3, goal: 10, needs: 'solve' },
];

function sealsFrom(j: Journey, today: DayKey, features: { solve: boolean; guided: boolean }, r: Replay): Seal[] {
  const totals = dayTotals(j).filter((t) => t.day <= today);
  return SEALS.filter((s) => !s.needs || features[s.needs]).map((s) => {
    let earned: DayKey | null = null;
    let have = 0;
    if (s.by === 'streak') {
      earned = r.reached(s.goal);
      have = earned ? s.goal : Math.min(r.streak.current, s.goal);
    } else {
      for (const t of totals) {
        const add = s.by === 'reviewDays' ? (t.counts[0] > 0 ? 1 : 0) : t.counts[s.by];
        have += add;
        if (!earned && have >= s.goal) earned = t.day;
      }
      have = Math.min(have, s.goal);
    }
    const seal: Seal = { id: s.id, kanji: s.kanji, reading: s.reading, title: s.title, how: s.how, earned, progress: [have, s.goal] };
    if (s.needs) seal.needs = s.needs;
    return seal;
  });
}

export function sealsOf(j: Journey, today: DayKey, features: { solve: boolean; guided: boolean }): Seal[] {
  return sealsFrom(j, today, features, replay(j, today));
}

// ---------------------------------------------------------------- summary

export interface JourneySummary {
  points: number;
  started: boolean;
  station: Station;
  next: Station | null;
  into: number;
  span: number;
  streak: Streak;
  seals: Seal[];
}

export function summarise(j: Journey, today: DayKey, features: { solve: boolean; guided: boolean }): JourneySummary {
  const points = totalPoints(j);
  const r = replay(j, today);
  return { points, started: points > 0, ...stationAt(points), streak: r.streak, seals: sealsFrom(j, today, features, r) };
}

/** "1 dan, 守拙 Guarding simplicity" or "13 kyu": a station as a toast names it. */
export function stationName(s: Station): string {
  return s.classical ? `${s.label}, ${s.classical.kanji} ${s.classical.gloss}` : s.label;
}

/** The sidebar line: "Study path · 14 kyu" (a place on the path, never a rank; no days in a row). */
export function pathLine(s: JourneySummary): string {
  return fill('sidebarLine', { label: s.station.label });
}
