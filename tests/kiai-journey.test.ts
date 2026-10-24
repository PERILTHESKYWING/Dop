import { describe, expect, it } from 'vitest';
import {
  addDays,
  COPY,
  dayPoints,
  emptyDoc,
  emptyJourney,
  fill,
  LIMITS,
  mergeDoc,
  mergeJourney,
  PATH,
  pathLine,
  PER_DAY,
  POINTS,
  record,
  REVIEW_MIN_MOVES,
  RESTS,
  sanitizeDoc,
  SEALS,
  sealsOf,
  stationAt,
  streakOf,
  summarise,
  totalPoints,
  type AskedLog,
  type DayCounts,
  type Journey,
  type KiaiDoc,
} from '../shared/kiaiJourney';

const D0 = '2026-10-01';
const A = 'deviceaaaaaa';
const B = 'devicebbbbbb';
const NOW = Date.UTC(2026, 9, 23, 12);
const NO = { solve: false, guided: false };

/** A journey with counts set directly: {device: {day: counts}}. */
const j = (dev: Record<string, Record<string, DayCounts>>, seen: Record<string, string> = {}, gen = 0): Journey => ({ v: 1, gen, dev, seen });
const asks = (n: number, day = D0, device = A, start: Journey = emptyJourney()) => {
  let x = start;
  for (let i = 0; i < n; i++) x = record(x, device, day, 'ask').journey;
  return x;
};
const studyDays = (days: string[]) => j({ [A]: Object.fromEntries(days.map((d) => [d, [0, 1, 0, 0, 0] as DayCounts])) });

// A small seeded PRNG so the property tests are repeatable.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
function randomJourney(r: () => number, gen = 0): Journey {
  const devs = ['deviceaaaaaa', 'devicebbbbbb', 'devicecccccc'];
  const dev: Journey['dev'] = {};
  for (const d of devs) {
    if (r() < 0.3) continue;
    const days: Record<string, DayCounts> = {};
    for (let i = 0; i < 6; i++) if (r() < 0.5) days[addDays(D0, Math.floor(r() * 10))] = [0, 0, 0, 0, 0].map(() => Math.floor(r() * 4)) as DayCounts;
    dev[d] = days;
  }
  const seen: Record<string, string> = {};
  for (let i = 0; i < 4; i++) if (r() < 0.6) seen[`r:game${Math.floor(r() * 6)}`] = addDays(D0, Math.floor(r() * 10));
  return { v: 1, gen, dev, seen };
}
const S = (x: unknown) => JSON.stringify(x);

describe('points', () => {
  it('pins the values (only ever raise them: points are re-derived from history)', () => {
    expect(POINTS).toEqual({ review: 30, ask: 5, guided: 40, solve: 10, firstOfDay: 10 });
    expect(PER_DAY).toEqual({ review: 3, ask: 12, guided: 2, solve: 10, total: 150 });
    expect(REVIEW_MIN_MOVES).toBe(30);
    expect(RESTS).toEqual({ start: 1, every: 7, max: 2 });
  });

  it('one answer is 15, asks cap at 12, reviews at 3, the day at 150', () => {
    expect(totalPoints(asks(1))).toBe(15);
    expect(totalPoints(asks(13))).toBe(70);
    let x = emptyJourney();
    for (let i = 0; i < 4; i++) x = record(x, A, D0, 'review', { id: `r:game${i}` }).journey;
    expect(totalPoints(x)).toBe(100);
    expect(dayPoints([3, 12, 2, 10, 0])).toBe(150);
    expect(dayPoints([0, 0, 0, 0, 0])).toBe(0);
  });

  it('counts the first study of the day once across two devices', () => {
    const x = asks(1, D0, B, asks(1, D0, A));
    expect(totalPoints(x)).toBe(20);
  });
});

describe('record', () => {
  it('counts a game once, ever', () => {
    const a = record(emptyJourney(), A, D0, 'review', { id: 'r:abcdef' });
    expect(a.counted).toBe(true);
    const b = record(a.journey, A, addDays(D0, 3), 'review', { id: 'r:abcdef' });
    expect(b.counted).toBe(false);
    expect(b.journey).toBe(a.journey);
    expect(a.journey.seen['r:abcdef']).toBe(D0);
    expect(record(emptyJourney(), A, D0, 'review').counted).toBe(false);
  });

  it('counts the same question on the same position once a day', () => {
    let asked: AskedLog | null = null;
    const one = record(emptyJourney(), A, D0, 'ask', { id: 'a:q1', asked });
    asked = one.asked!;
    const two = record(one.journey, A, D0, 'ask', { id: 'a:q1', asked });
    expect(two.counted).toBe(false);
    const other = record(one.journey, A, D0, 'ask', { id: 'a:q2', asked });
    expect(other.counted).toBe(true);
    const next = record(one.journey, A, addDays(D0, 1), 'ask', { id: 'a:q1', asked });
    expect(next.counted).toBe(true);
    expect(next.asked).toEqual({ day: addDays(D0, 1), ids: ['a:q1'] });
  });

  it('counts life-and-death asks in their own field', () => {
    const x = record(emptyJourney(), A, D0, 'ask', { lifeDeath: true }).journey;
    expect(x.dev[A][D0]).toEqual([0, 1, 0, 0, 1]);
  });
});

describe('merge', () => {
  it('is commutative, associative and idempotent', () => {
    const r = rng(7);
    for (let i = 0; i < 50; i++) {
      const a = randomJourney(r);
      const b = randomJourney(r);
      const c = randomJourney(r);
      expect(S(mergeJourney(a, b))).toBe(S(mergeJourney(b, a)));
      expect(S(mergeJourney(mergeJourney(a, b), c))).toBe(S(mergeJourney(a, mergeJourney(b, c))));
      const ab = mergeJourney(a, b);
      expect(S(mergeJourney(ab, ab))).toBe(S(ab));
      expect(S(mergeJourney(ab, a))).toBe(S(ab));
    }
  });

  it('adds two devices up instead of overwriting', () => {
    const m = mergeJourney(asks(2, D0, A), asks(3, D0, B));
    expect(totalPoints(m)).toBe(10 + 25);
  });

  it('lets a higher generation (a reset) win outright', () => {
    const old = asks(5);
    const fresh = emptyJourney(1);
    expect(mergeJourney(old, fresh)).toEqual(fresh);
    expect(mergeJourney(fresh, old)).toEqual(fresh);
  });

  it('keeps the earliest day for a seen id and prunes to the newest', () => {
    const m = mergeJourney(j({}, { 'r:aaaa': '2026-10-05' }), j({}, { 'r:aaaa': '2026-10-02' }));
    expect(m.seen['r:aaaa']).toBe('2026-10-02');
    const many: Record<string, string> = {};
    for (let i = 0; i < LIMITS.seen + 50; i++) many[`r:g${String(i).padStart(5, '0')}`] = addDays('2020-01-01', i);
    const p = mergeJourney(j({}, many), emptyJourney());
    expect(Object.keys(p.seen)).toHaveLength(LIMITS.seen);
    expect(p.seen['r:g00000']).toBeUndefined();
    expect(p.seen[`r:g${String(LIMITS.seen + 49).padStart(5, '0')}`]).toBeDefined();
  });

  it('merges settings by time, deterministically on a tie', () => {
    const a: KiaiDoc = { ...emptyDoc(), settings: { theme: { v: 'dark', at: 5 }, answerFont: { v: 'serif', at: 9 } } };
    const b: KiaiDoc = { ...emptyDoc(), settings: { theme: { v: 'light', at: 7 }, answerFont: { v: 'sans', at: 9 } } };
    const m = mergeDoc(a, b);
    expect(m.settings.theme.v).toBe('light');
    expect(S(mergeDoc(a, b))).toBe(S(mergeDoc(b, a)));
    expect(m.settings.answerFont.v).toBe(mergeDoc(b, a).settings.answerFont.v);
  });
});

describe('sanitizeDoc', () => {
  it('drops junk and keeps what fits', () => {
    const raw = {
      v: 1,
      extra: 'x',
      journey: {
        v: 1,
        gen: 2,
        junk: true,
        dev: {
          [A]: { [D0]: [1, 2, 0, 0, 0], '2099-01-01': [1, 0, 0, 0, 0], 'not-a-day': [1, 0, 0, 0, 0], '2026-10-02': [5000, -3, 1.7, 'x', 0] },
          'BAD ID': { [D0]: [1, 0, 0, 0, 0] },
          short: { [D0]: [1, 0, 0, 0, 0] },
        },
        seen: { 'r:abcdef': D0, 'x:abcdef': D0, 'r:abcdef12': '2099-01-01' },
      },
      settings: { theme: { v: 'dark', at: 3 }, 'Bad Key': { v: 1, at: 1 }, answerFont: { v: { o: 1 }, at: 1 }, 'profile.name': { v: 'x', at: NOW + 1e10 } },
    };
    const d = sanitizeDoc(raw, NOW)!;
    expect(d).not.toBeNull();
    expect(Object.keys(d)).toEqual(['v', 'journey', 'settings']);
    expect(Object.keys(d.journey)).toEqual(['v', 'gen', 'dev', 'seen']);
    expect(Object.keys(d.journey.dev)).toEqual([A]);
    expect(d.journey.dev[A]).toEqual({ [D0]: [1, 2, 0, 0, 0], '2026-10-02': [999, 0, 1, 0, 0] });
    expect(d.journey.seen).toEqual({ 'r:abcdef': D0 });
    expect(Object.keys(d.settings).sort()).toEqual(['profile.name', 'theme']);
    expect(d.settings['profile.name'].at).toBe(NOW + 86_400_000);
  });

  it('returns null for things that are not docs', () => {
    for (const x of [null, 1, 'doc', [], {}, { v: 2, journey: emptyJourney() }, { v: 1 }, { v: 1, journey: { v: 1, gen: -1, dev: {}, seen: {} } }, { v: 1, journey: { v: 1, gen: 0.5, dev: {}, seen: {} } }])
      expect(sanitizeDoc(x, NOW)).toBeNull();
    expect(sanitizeDoc(emptyDoc(), NOW)).toEqual(emptyDoc());
  });
});

describe('the path', () => {
  it('has 39 stations with rising thresholds', () => {
    expect(PATH).toHaveLength(39);
    for (let i = 1; i < PATH.length; i++) expect(PATH[i].at).toBeGreaterThan(PATH[i - 1].at);
    expect(PATH[0].label).toBe('30 kyu');
    expect(PATH[29].label).toBe('1 kyu');
    expect(PATH[30].label).toBe('1 dan');
  });

  it('places points on stations', () => {
    const at = (p: number) => stationAt(p).station.label;
    expect(at(0)).toBe('30 kyu');
    expect(at(199)).toBe('21 kyu');
    expect(at(200)).toBe('20 kyu');
    expect(at(1800)).toBe('10 kyu');
    expect(at(9900)).toBe('1 kyu');
    expect(stationAt(10800).station.classical?.kanji).toBe('守拙');
    expect(at(10800)).toBe('1 dan');
    expect(stationAt(43800).station.classical?.kanji).toBe('入神');
    expect(stationAt(99999).station.label).toBe('9 dan');
    expect(stationAt(43800).next).toBeNull();
    expect(stationAt(15)).toMatchObject({ into: 15, span: 20, next: { label: '29 kyu' } });
  });
});

describe('days in a row', () => {
  const day = (n: number) => addDays(D0, n);
  it('counts study days, and today not studied yet breaks nothing', () => {
    const x = studyDays([day(0), day(1), day(2)]);
    expect(streakOf(x, day(2))).toMatchObject({ current: 3, best: 3, todayDone: true });
    const t = streakOf(x, day(3));
    expect(t).toMatchObject({ current: 3, todayDone: false });
    expect(t.week[6]).toEqual({ day: day(3), mark: 'today' });
  });

  it('uses a rest day by itself, and two missed days with one rest end the run', () => {
    const x = studyDays([day(0), day(1), day(2), day(4)]);
    const s = streakOf(x, day(4));
    expect(s.current).toBe(4);
    expect(s.rests).toBe(0);
    expect(s.week.find((w) => w.day === day(3))?.mark).toBe('rest');
    const y = studyDays([day(0), day(1), day(2), day(5)]);
    expect(streakOf(y, day(5))).toMatchObject({ current: 1, best: 3 });
  });

  it('earns a rest at 7 and 14 study days, at most 2', () => {
    const seven = studyDays(Array.from({ length: 7 }, (_, i) => day(i)));
    expect(streakOf(seven, day(6)).rests).toBe(2);
    const fourteen = studyDays(Array.from({ length: 14 }, (_, i) => day(i)));
    expect(streakOf(fourteen, day(13)).rests).toBe(2);
    // One used, then earned back at 14 study days.
    const gap = studyDays([...Array.from({ length: 7 }, (_, i) => day(i)), ...Array.from({ length: 7 }, (_, i) => day(i + 8))]);
    expect(streakOf(gap, day(14)).rests).toBe(2);
    expect(streakOf(gap, day(14)).current).toBe(14);
  });

  it('keeps best after a break', () => {
    const x = studyDays([day(0), day(1), day(2), day(3), day(10)]);
    expect(streakOf(x, day(10))).toMatchObject({ current: 1, best: 4 });
  });
});

describe('seals', () => {
  const day = (n: number) => addDays(D0, n);
  const seal = (x: Journey, today: string, id: string, f = NO) => sealsOf(x, today, f).find((s) => s.id === id);
  it('stamps Sanrensei on the third day', () => {
    const x = studyDays([day(0), day(1), day(2)]);
    expect(seal(x, day(1), 'sanrensei')).toMatchObject({ earned: null, progress: [2, 3] });
    expect(seal(x, day(2), 'sanrensei')?.earned).toBe(day(2));
  });

  it('stamps Kifu narabe at the tenth whole game', () => {
    let x = emptyJourney();
    for (let i = 0; i < 9; i++) x = record(x, A, day(i), 'review', { id: `r:game${i}` }).journey;
    expect(seal(x, day(9), 'narabe')).toMatchObject({ earned: null, progress: [9, 10] });
    x = record(x, A, day(9), 'review', { id: 'r:game9' }).journey;
    expect(seal(x, day(9), 'narabe')?.earned).toBe(day(9));
    expect(seal(x, day(9), 'ichinichi')?.earned).toBe(day(6));
  });

  it('shows Tesuji only when "find the move" exists', () => {
    expect(seal(emptyJourney(), D0, 'tesuji')).toBeUndefined();
    expect(seal(emptyJourney(), D0, 'tesuji', { solve: true, guided: false })).toMatchObject({ needs: 'solve' });
    expect(sealsOf(emptyJourney(), D0, NO)).toHaveLength(7);
  });

  it('counts only life-and-death questions for Shikatsu', () => {
    let x = emptyJourney();
    for (let i = 0; i < 20; i++) x = record(x, A, day(Math.floor(i / 10)), 'ask').journey;
    expect(seal(x, day(1), 'shikatsu')?.progress[0]).toBe(0);
    for (let i = 0; i < 20; i++) x = record(x, A, day(2), 'ask', { lifeDeath: true }).journey;
    expect(seal(x, day(2), 'shikatsu')?.earned).toBe(day(2));
  });

  it('summarises a fresh path as not started', () => {
    expect(summarise(emptyJourney(), D0, NO)).toMatchObject({ points: 0, started: false, station: { label: '30 kyu' } });
    expect(summarise(asks(1), D0, NO)).toMatchObject({ points: 15, started: true, into: 15, span: 20 });
  });
});

describe('copy', () => {
  const strings = [
    ...Object.values(COPY),
    ...PATH.flatMap((p) => [p.label, p.short, p.classical?.gloss ?? '']),
    ...SEALS.flatMap((s) => [s.title, s.how, s.reading]),
  ];
  it('never says XP, level up or unlock, never shouts and has no emoji', () => {
    for (const s of strings) {
      expect(s).not.toMatch(/\bxp\b|level up|unlock|!|you are (a )?\d+ ?(kyu|dan)/i);
      expect(s).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
  it('says "rank" only to say the path is not one', () => {
    const withRank = Object.entries(COPY).filter(([, v]) => /rank/i.test(v));
    expect(withRank.map(([k]) => k)).toEqual(['honesty']);
    expect(COPY.honesty).toContain('It is not a rank.');
    expect(strings.filter((s) => /rank/i.test(s))).toHaveLength(1);
  });
});

describe('presented with restraint', () => {
  const studied = (n: number) => j({ [A]: Object.fromEntries(Array.from({ length: n }, (_, i) => [addDays(D0, i), [2, 6, 0, 0, 1] as DayCounts])) });
  it('names a place on the path, never a rank: the sidebar line has no days in a row', () => {
    const s = summarise(studied(17), addDays(D0, 16), NO);
    expect(s.streak.current).toBe(17);
    expect(pathLine(s)).toBe(`Study path · ${s.station.label}`);
    expect(pathLine(s)).not.toMatch(/day/);
  });
  it('heads the Journey page with the stage on the path, the kyu last', () => {
    const s = summarise(studied(17), addDays(D0, 16), NO);
    const head = fill('head', { n: s.station.i + 1, of: PATH.length, label: s.station.label });
    expect(head).toMatch(new RegExp(`^Study path · stage \\d+ of ${PATH.length} · \\d+ kyu$`));
  });
  it('uses real Go words for its seals', () => {
    // each checked by hand: the sanrensei opening, ladder, replaying game records, life and death,
    // "hand talk" (an old name for Go), tesuji; 一日一局 and 百局 are plain phrases a player reads at once
    expect(SEALS.map((x) => x.kanji)).toEqual(['三連星', '一日一局', '征', '棋譜並べ', '百局', '死活', '手談', '手筋']);
  });
});
