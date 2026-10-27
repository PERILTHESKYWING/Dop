/**
 * What the numbers on KataGo's candidate marks say, and the key under the board.
 *
 * Normally each candidate shows how often the side to play wins after it (out of 100). Once
 * every candidate's win chance rounds to 0-2 or 98-100 those numbers are all the same, so each
 * candidate shows what it loses against KataGo's choice in points instead (critics, rounds 1
 * and 2): KataGo's choice (the most visited move, the answer's "best move", drawn with the
 * thick ring) shows its own win chance with a % sign ("1%"), the others "−0.9", "−1.3" in the
 * same rounding as the answer's text ("Q12 is 1.1 points worse" is Q12's "−1.1"), a move as
 * good as the choice "≈". One sign convention on every width: a phone shows "−0.9" too
 * (critics, 2026-10-26: the phone's "0.9" and the desktop's "−0.9" read as different numbers);
 * the board sets a long label narrower to fit its mark. "The game is decided" is said only
 * when gameDecided() agrees: late in the game, from the point lead.
 */
import { fmt1 } from '../../../src/lib/coach/explain/geometry';

interface Cand {
  winrate: number;
  scoreLead: number;
  /** 0 = KataGo's choice (most visits). */
  rank?: number;
  /** The point (row-major on the board), for spacing a phone's numbered marks. */
  loc?: number;
}

/** A move as good as KataGo's choice at the label's precision. */
export const SAME = '≈';

/** Every candidate's win chance rounds to 0-2 or 98-100: win chances no longer tell the moves apart. */
export function lopsidedRead(cands: readonly Cand[] | null | undefined): boolean {
  return (
    !!cands?.length &&
    cands.every((c) => {
      const w = Math.round(c.winrate * 100);
      return w <= 2 || w >= 98;
    })
  );
}

/**
 * A candidate's label against KataGo's choice: "−0.9" (one decimal, the answer's rounding, with
 * a true minus sign); "≈" when it rounds to no difference; "+0.4" for a thinner read that came
 * out ahead (honest, rare). `compact` (a phone's small marks) gives whole points from 10 up
 * ("−19"), so a big loss still fits; below 10 it is the same one decimal (critics, round 4:
 * whole points made −0.9 and −1.3 both "−1").
 */
export function lossLabel(c: Cand, best: Cand, compact = false): string {
  const loss = best.scoreLead - c.scoreLead;
  const shown = compact && Math.abs(loss) >= 9.95 ? String(Math.round(Math.abs(loss))) : fmt1(Math.abs(loss));
  if (Number(shown) === 0) return SAME;
  return `${loss > 0 ? '−' : '+'}${shown}`;
}

/** KataGo's choice among loss labels: its win chance for the side to play, "1%" (the % tells it from a loss in points). */
export const bestLabel = (best: Cand): string => `${Math.round(best.winrate * 100)}%`;

/** How many marks carry a number on a phone, and how far apart (in points) two of them sit at full size. */
export const PHONE_NUMBERED = 3;
const PHONE_GAP = 1.6;
/** A phone's numbered mark: its radius in points at full size, and the most it moves off its point. */
export const BIG_R = 0.76;
const MAX_SHIFT = 0.2;
/** A candidate this close to KataGo's choice in points is "about as good" and numbered first when no answer names the moves. */
const NEAR = 0.3;

const dist = (a: number, b: number, size: number) => Math.hypot((a % size) - (b % size), Math.floor(a / size) - Math.floor(b / size));

/**
 * Which candidates carry a number on a phone (critics, 2026-10-27 round 1: every label was
 * unreadable at 390 px, about 15 px a point), as points. A numbered mark is drawn larger than its
 * point, so at most three: KataGo's choice; then the moves the answer names (`named`: the
 * answer's points, round 2: "R12 is about as good as Q10" must show R12's number, even next to
 * Q10), those within 0.3 points of the choice first, or with no answer the ones within 0.3 points; then the next in KataGo's
 * order that sit 1.6 points or more from every numbered one. The others are small bare rings.
 */
export function phonePick(cands: readonly Cand[], size: number, named?: ReadonlySet<number> | null): number[] {
  const ranked = [...cands].filter((c) => c.loc !== undefined).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  if (!ranked.length) return [];
  const best = ranked[0];
  const out: number[] = [best.loc!];
  // named moves about as good as the choice first (an answer naming five moves still shows the
  // "about as good" one), then other named moves; with no answer, the near ones
  const near = (c: Cand) => Math.abs(best.scoreLead - c.scoreLead) <= NEAR;
  const tiers: ((c: Cand) => boolean)[] = named ? [(c) => named.has(c.loc!) && near(c), (c) => named.has(c.loc!)] : [near];
  for (const t of tiers) for (const c of ranked.slice(1)) if (out.length < PHONE_NUMBERED && !out.includes(c.loc!) && t(c)) out.push(c.loc!);
  for (const c of ranked.slice(1)) {
    if (out.length >= PHONE_NUMBERED) break;
    if (!out.includes(c.loc!) && out.every((o) => dist(o, c.loc!, size) >= PHONE_GAP)) out.push(c.loc!);
  }
  return out;
}

/** Where a numbered mark sits: moved off its point by (dx, dy) and its radius, in points. */
export interface MarkPlace {
  dx: number;
  dy: number;
  r: number;
}

/**
 * The numbered marks' places: full size where they have room; two closer than 1.6 points (two
 * named moves side by side) each move up to 0.2 of a point apart and shrink to fit, so both keep
 * their numbers instead of one being dropped.
 */
export function phonePlaces(locs: readonly number[], size: number): Map<number, MarkPlace> {
  const out = new Map<number, MarkPlace>(locs.map((l) => [l, { dx: 0, dy: 0, r: BIG_R }]));
  for (let i = 0; i < locs.length; i++)
    for (let j = i + 1; j < locs.length; j++) {
      const a = locs[i], b = locs[j];
      const d = dist(a, b, size);
      if (!d || d >= PHONE_GAP) continue;
      const o = Math.min(MAX_SHIFT, (PHONE_GAP - d) / 2);
      const ux = ((b % size) - (a % size)) / d, uy = (Math.floor(b / size) - Math.floor(a / size)) / d;
      const r = Math.min(BIG_R, (d + 2 * o) / 2 - 0.03);
      const pa = out.get(a)!, pb = out.get(b)!;
      pa.dx -= ux * o;
      pa.dy -= uy * o;
      pb.dx += ux * o;
      pb.dy += uy * o;
      pa.r = Math.min(pa.r, r);
      pb.r = Math.min(pb.r, r);
    }
  return out;
}

/**
 * The label function for the candidate marks (undefined: the default win chance). `numbered`
 * (a phone: phonePick's points) leaves every other mark without a number ('').
 */
export function candidateLabeler<C extends Cand>(cands: readonly C[] | null | undefined, compact = false, explained = false, numbered: ReadonlySet<number> | null = null): ((c: C) => string) | undefined {
  if (!cands?.length) return undefined;
  const lopsided = lopsidedRead(cands);
  if (!lopsided && !numbered) return undefined;
  const on = (c: C) => !numbered || (c.loc !== undefined && numbered.has(c.loc));
  const winChance = (c: C) => String(Math.round(c.winrate * 100));
  if (!lopsided) return (c) => (on(c) ? winChance(c) : '');
  // KataGo's choice is the most visited move (the answer's "best move" too), not a thin read's higher lead.
  const best = cands.find((c) => c.rank === 0) ?? cands[0];
  // A thin read that came out ahead of the ring shows "+0.5" only when an answer says why
  // ("KataGo read it less, and it came out 0.5 points ahead"); before that it is "≈".
  return (c) => {
    if (!on(c)) return '';
    if (c === best) return bestLabel(best);
    const l = lossLabel(c, best, compact);
    return !explained && l.startsWith('+') ? SAME : l;
  };
}

/**
 * A phone's numbered points held steady while KataGo reads (round 2: the three numbers moved
 * between marks as ranks swapped): a new pick replaces the shown one only once it has stood for
 * `holdMs` (1 s) through every update in between, at once when KataGo's choice itself changes or
 * a shown point is no longer a candidate. `now` and the state are passed in, so it can be tested.
 */
export interface PickHold {
  shown: number[];
  next: string;
  since: number;
}
export function holdPick(prev: PickHold | null, want: number[], present: ReadonlySet<number>, now: number, holdMs = 1000): PickHold {
  const key = want.join(',');
  if (!prev || prev.shown[0] !== want[0] || prev.shown.some((l) => !present.has(l)) || prev.shown.join(',') === key) return { shown: want, next: key, since: now };
  if (prev.next !== key) return { ...prev, next: key, since: now };
  return now - prev.since >= holdMs ? { shown: want, next: key, since: now } : prev;
}

/**
 * The key under the board: two short clauses, the same words on every width, naming every
 * figure a mark can carry (critics, 2026-10-27 round 1: one name for the number, "win chance").
 * `plus` when a mark shows "+0.4" (a shorter read that came out ahead). `book`: the book
 * diagram, where marks are printed numbers and KataGo's choice is underlined.
 */
export function keyText(cands: readonly Cand[] | null | undefined, side: 'Black' | 'White', plus = false, book = false): string {
  const choice = book ? 'Underlined' : 'Thick ring';
  const others = book ? 'Other numbers' : 'Other rings';
  if (!lopsidedRead(cands)) return `${book ? 'Numbers' : 'Rings'}: KataGo’s best moves, with ${side}’s win chance. ${choice}: KataGo’s choice.`;
  return `${choice}: KataGo’s choice, with ${side}’s win chance. ${others}: points lost against it (≈ about the same${plus ? ', + ahead on a shorter read' : ''}).`;
}
