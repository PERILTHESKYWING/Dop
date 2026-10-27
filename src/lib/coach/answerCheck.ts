/**
 * Checks a written answer (Gemini's, Kami's own model's, or a training sample) against the
 * explanation it was written from. Shared by the Kami site (Myoshu falls back to the engine's
 * own text when an answer fails), scripts/coachlm/verify.ts and the training kit's scores.
 * Pure code, no engine and no LLM.
 *
 * truth: every coordinate, number and [[vN]] in the answer must come from the explanation
 *   (facts, concept hits, variations, the question). Numbers get a rounding tolerance:
 *   winrates within 1 (3 for a hedged round number: "about 60%"), points within 0.6 (or 15%
 *   when hedged), either player's view (100 - x) and differences of two KataGo figures.
 *   "3-3", "4-4" point names, "3rd line", ranks ("3k") and the board size are not claims.
 *   "move 31" must be a move of the game or of a variation; "after 25 moves" must fit in a
 *   variation. Bare integers 0-2 and point figures up to 1 are not checked.
 * coverage: share of the key items the answer uses: facts (up to 6), variations (up to 4),
 *   concepts (up to 3) and the move asked about, averaged over the groups present.
 * depth: simple signals, capped at 1: causal links (0.1 each, max 0.3), references to
 *   refutation / consequence / what-if lines or worked examples (0.15 / 0.1 each, max 0.3),
 *   Go concept words (0.1 each, max 0.3), and 0.1 for three or more sentences that are not
 *   mostly figures.
 * wording: phrases that contradict KataGo or the board (wordingProblems, below).
 * pass: truth === 1, coverage >= COVERAGE_FLOOR and no wording problem.
 */
import { replay } from '../go/board';
import { gtpToLoc, locToGtp } from '../go/coords';
import { PASS, type Loc } from '../go/types';
import { shapeOf, type ShapeId } from './explain/shapes';
import { gameDecided } from './explain/situation';
import { xy } from '../go/coords';
import type { Explanation, Illustration, Variation } from './explain/types';
import type { ConceptEntry } from './library';

export interface AnswerScore {
  /** 0–1: share of coordinates, numbers and [[vN]] refs that exist in the explanation. 1 = nothing invented. */
  truth: number;
  /** 0–1: share of the key facts, concepts and variations the answer uses. */
  coverage: number;
  /** 0–1: how far it goes past restating numbers (why, consequences, concepts), by simple checkable signals. */
  depth: number;
  /** The coordinates, numbers or refs that were not in the explanation. */
  unsupported: string[];
  /** Wording that contradicts KataGo or names what the board does not show (wordingProblems); absent when none. */
  wording?: string[];
  /** truth === 1 and the answer is usable. */
  pass: boolean;
}

/** Lowest coverage that still passes. */
export const COVERAGE_FLOOR = 0.4;

const COLS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
const HEDGE = /\b(about|around|roughly|nearly|almost|approximately|approx\.?|over|under|more than|less than|close to|some|just over|just under|above|below)\s*$|~\s*$/i;
const round1 = (x: number) => Math.round(x * 10) / 10;

type Kind = 'ref' | 'coord' | 'badcoord' | 'size' | 'line' | 'pct' | 'pts' | 'moveIndex' | 'moveCount' | 'visits' | 'num';

interface Hit {
  kind: Kind;
  raw: string;
  value: number;
  /** For coords: "Q16"; for refs: the id. */
  key: string;
  hedged: boolean;
}

/**
 * Every figure in a text, in reading order of the passes below. Each pass blanks what it
 * matched, so later passes never see a coordinate's digits or a "3-3" again.
 */
function scan(text: string, size: number): Hit[] {
  let s = text.replace(/[−–]/g, '-');
  const out: Hit[] = [];
  const letters = COLS.slice(0, size);
  const sweep = (re: RegExp, fn: (m: RegExpExecArray, before: string) => Hit | null) => {
    let next = '';
    let last = 0;
    for (const m of s.matchAll(re)) {
      const at = m.index ?? 0;
      const hit = fn(m as RegExpExecArray, s.slice(Math.max(0, at - 24), at));
      if (hit) out.push(hit);
      next += s.slice(last, at) + ' '.repeat(m[0].length);
      last = at + m[0].length;
    }
    s = next + s.slice(last);
  };
  const hit = (kind: Kind, raw: string, value = NaN, key = '', hedged = false): Hit => ({ kind, raw: raw.replace(/\s+/g, ' ').trim(), value, key, hedged });

  sweep(/\[\[\s*([^\]]*?)\s*\]\]/g, (m) => hit('ref', m[0], NaN, m[1]));
  sweep(/(?<![A-Za-z0-9])([A-Za-z])(\d{1,2})(?![A-Za-z0-9]|\.\d)/g, (m) => {
    const L = m[1].toUpperCase();
    const n = Number(m[2]);
    if (letters.includes(L)) return n >= 1 && n <= size ? hit('coord', m[0], NaN, `${L}${n}`) : hit('badcoord', m[0], NaN, `${L}${n}`);
    // "I5" is a coordinate nobody may use; other letters (v1, x2) are not coordinates.
    return m[1] === 'I' ? hit('badcoord', m[0], NaN, `I${n}`) : null;
  });
  // 1,200 -> 1200 (after coordinates, so "Q16,R17" is already gone).
  s = s.replace(/(\d),(\d{3})(?!\d)/g, '$1$2 ');
  sweep(/(?<![\d.])(\d{1,2})\s*[x×]\s*(\d{1,2})(?![\d.])/g, (m) => hit('size', m[0], Number(m[1]) === size && Number(m[2]) === size ? size : -1));
  // Point names: 3-3, 4-4, 3-4 (not "2-3 points", which is a range of figures).
  sweep(/(?<![\d.])[1-6]\s*-\s*[1-6](?![\d.])(?!\s*(?:points?|pts|%|moku|percent))/gi, () => null);
  sweep(/(?<![\d.])(\d{1,2})(?:st|nd|rd|th)?[\s-]+line\b/gi, (m) => hit('line', m[0], Number(m[1])));
  sweep(/(?<![\d.])\d{1,2}\s?-?\s?(?:kyu|dan|k|d|p)\b/gi, () => null);
  sweep(/(?<![\d.])(\d+(?:\.\d+)?)\s*(?:%|percent\b|per cent\b|percentage points?\b)/gi, (m, b) => hit('pct', m[0], Number(m[1]), '', HEDGE.test(b)));
  sweep(/(?<![\d.])(\d+(?:\.\d+)?)(?:\s*|-)(?:(?:more|fewer|extra|additional|full|whole)\s+)?(?:points?|pts|moku)\b/gi, (m, b) => hit('pts', m[0], Number(m[1]), '', HEDGE.test(b)));
  sweep(/\bmoves?\s+(?:no\.?\s*|number\s+|#)?(\d+)(?![\d.])/gi, (m) => hit('moveIndex', m[0], Number(m[1])));
  sweep(/(?<![\d.])(\d+)(?:st|nd|rd|th)\s+move\b/gi, (m) => hit('moveIndex', m[0], Number(m[1])));
  sweep(/(?<![\d.])(\d+)\s+(?:more\s+|further\s+|extra\s+)?moves?\b/gi, (m) => hit('moveCount', m[0], Number(m[1])));
  sweep(/(?<![\d.])(\d+)\s+(?:visits?|playouts?)\b/gi, (m) => hit('visits', m[0], Number(m[1])));
  sweep(/(?<![\d.])(\d+)(?:st|nd|rd|th)\b/gi, (m) => (Number(m[1]) <= 10 ? null : hit('num', m[0], Number(m[1]))));
  sweep(/(?<![\w.])(\d+(?:\.\d+)?)(?![\d])/g, (m, b) => hit('num', m[0], Number(m[1]), '', HEDGE.test(b)));
  return out;
}

const name = (loc: Loc, size: number) => (loc === PASS || loc < 0 ? '' : locToGtp(loc, size));

interface Allowed {
  coords: Set<string>;
  refs: Map<string, Variation | Illustration>;
  /** Winrates (either view) and gaps between two of them. */
  pct: number[];
  /** Point figures: leads, losses, gaps between two, komi. */
  pts: number[];
  /** Unitless numbers the texts state ("lead 3.4"). */
  nums: number[];
  /** Move numbers, move counts and visits the texts state. */
  counts: number[];
  /** Board size, komi, the move number and line lengths. */
  structural: number[];
  maxMove: number;
  maxLine: number;
  size: number;
}

/** The figures an answer may use: what the writer was shown (see explain/prompt.ts). */
function allowedFor(ex: Explanation): Allowed {
  const size = ex.position.size;
  const coords = new Set<string>();
  const add = (l: Loc | undefined) => {
    if (l === undefined) return;
    const n = name(l, size);
    if (n) coords.add(n);
  };
  const pct: number[] = [];
  const pts: number[] = [];
  const nums: number[] = [];
  const counts: number[] = [];
  const structural: number[] = [size, ex.position.komi, ex.position.moves.length, ex.position.moves.length + 1];
  const texts: string[] = [ex.question.text, ...ex.facts.map((f) => f.text)];
  add(ex.question.move);
  // The last move and the stones it touches: the engine's draft names them for a contact play.
  const last = ex.position.moves[ex.position.moves.length - 1];
  if (last && last.loc !== PASS) {
    add(last.loc);
    const b = replay(size, ex.position.setup, ex.position.moves);
    b.neighbors(last.loc).filter((q) => b.stones[q]).forEach(add);
  }
  for (const c of ex.concepts) {
    c.at.forEach(add);
    texts.push(c.evidence);
  }
  const refs = new Map<string, Variation | Illustration>();
  let maxLine = 0;
  for (const d of ex.illustrations ?? []) {
    // A diagram: its line, its highlighted points and the stones inside its window.
    refs.set(d.id, d);
    d.line.forEach((m) => add(m.loc));
    d.highlight.forEach(add);
    if (d.view) {
      const [x0, y0, x1, y1] = d.view;
      for (const m of d.base.setup) {
        const [x, y] = xy(m.loc, size);
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) add(m.loc);
      }
    }
    texts.push(d.label, d.title, d.note);
    pts.push(Math.abs(d.base.komi));
    maxLine = Math.max(maxLine, d.line.length);
    structural.push(d.line.length);
  }
  for (const v of ex.variations) {
    refs.set(v.id, v);
    v.moves.forEach((m) => add(m.loc));
    v.highlight?.forEach(add);
    texts.push(v.label, v.note ?? '');
    if (v.scoreLoss !== undefined && Number.isFinite(v.scoreLoss)) pts.push(Math.abs(v.scoreLoss), Math.abs(round1(v.scoreLoss)));
    maxLine = Math.max(maxLine, v.moves.length);
    structural.push(v.moves.length);
  }
  for (const t of texts) {
    for (const h of scan(t, size)) {
      if (h.kind === 'coord') coords.add(h.key);
      else if (h.kind === 'pct') pct.push(h.value);
      else if (h.kind === 'pts') pts.push(h.value);
      else if (h.kind === 'num') nums.push(h.value);
      else if (h.kind === 'moveIndex' || h.kind === 'moveCount' || h.kind === 'visits') counts.push(h.value);
    }
  }
  // Either player's view, and the gap between two KataGo figures.
  const basePct = [...pct];
  for (const a of basePct) pct.push(100 - a);
  for (const a of basePct) for (const b of basePct) if (a > b) pct.push(a - b, Math.abs(100 - a - b));
  const basePts = [...pts, ...nums.filter((x) => !Number.isInteger(x))];
  for (const a of basePts) for (const b of basePts) if (a > b) pts.push(round1(a - b));
  pts.push(ex.position.komi);
  return { coords, refs, pct, pts, nums, counts, structural, maxMove: ex.position.moves.length + 1 + maxLine, maxLine, size };
}

function near(v: number, pool: readonly number[], tol: number): boolean {
  return pool.some((a) => Math.abs(a - v) <= tol + 1e-9);
}

/** Whether one figure in the answer is backed by the explanation. */
function supported(h: Hit, a: Allowed): boolean {
  switch (h.kind) {
    case 'ref':
      return a.refs.has(h.key);
    case 'coord':
      return a.coords.has(h.key);
    case 'badcoord':
      return false;
    case 'size':
      return h.value === a.size;
    case 'line':
      return h.value >= 1 && h.value <= Math.ceil(a.size / 2);
    case 'pct':
      return near(h.value, a.pct, 1) || (h.hedged && h.value % 5 === 0 && near(h.value, a.pct, 3));
    case 'pts':
      if (h.value <= 1) return true;
      return near(h.value, a.pts, 0.6) || near(h.value, a.nums, 0.6) || (h.hedged && a.pts.some((p) => Math.abs(p - h.value) <= Math.max(0.6, 0.15 * p)));
    case 'moveIndex':
      return (Number.isInteger(h.value) && h.value >= 1 && h.value <= a.maxMove) || a.counts.includes(h.value);
    case 'moveCount':
      return (Number.isInteger(h.value) && h.value >= 1 && h.value <= Math.max(a.maxLine, 2)) || a.counts.includes(h.value) || a.structural.includes(h.value);
    case 'visits':
      return a.counts.includes(h.value) || a.nums.includes(h.value);
    case 'num':
      if (Number.isInteger(h.value) && h.value <= 2) return true;
      return (
        near(h.value, a.pts, 0.6) ||
        near(h.value, a.nums, 0.6) ||
        a.counts.includes(h.value) ||
        a.structural.includes(h.value) ||
        near(h.value, a.pct, 1) ||
        (h.hedged && near(h.value, a.pct, 3))
      );
  }
}

// --- coverage and depth -------------------------------------------------------------

const STOP = new Set(
  'the a an and or but of to in on at for with by from is are was were be been this that these those it its as into than then there here which who what when where why how not no can could would should will may might more most less very just also only your their his her our black white move moves play plays played point points kataGo katago'.split(' ').map((w) => w.toLowerCase()),
);

const stem = (w: string) => (w.length > 5 ? w.slice(0, 5) : w);

function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]+/g) ?? []).filter((w) => w.length >= 4 && !STOP.has(w));
}

function stems(text: string): Set<string> {
  return new Set(words(text).map(stem));
}

const GO_TERMS = [
  'sente', 'gote', 'miai', 'weak group', 'dead', 'alive', 'life and death', 'eye', 'thickness', 'thick', 'territory', 'influence', 'moyo',
  'framework', 'overconcentration', 'overconcentrated', 'aji', 'ladder', 'net', 'snapback', 'tenuki', 'big point', 'urgent', 'shape', 'cut',
  'connect', 'invasion', 'invade', 'reduce', 'reduction', 'ko', 'liberties', 'liberty', 'seki', 'endgame', 'yose', 'joseki', 'initiative',
  'attack', 'defend', 'pincer', 'approach', 'enclosure', 'extension', 'capture', 'atari', 'hane', 'tesuji', 'fuseki', 'wall', 'connection',
];

const CAUSAL = ['because', 'so that', 'since', 'therefore', 'which means', 'that means', 'means that', 'as a result', 'otherwise', 'leads to', 'lead to', 'allows', 'lets ', 'threatens', 'prevents', 'in order to', 'if ', 'thanks to', 'due to', 'so the', 'which gives', 'in return'];

const EXAMPLES = ['for example', 'for instance', 'e.g.', 'such as', 'imagine', 'suppose'];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A Go term as a word, allowing plurals and simple endings ("cuts", "invaded", "connection"). */
const termIn = (text: string, term: string) =>
  new RegExp(`(?<![a-z])${escape(term).replace(/[- ]/g, '[- ]')}(?:s|es|d|ed|ing|ion|ions)?(?![a-z])`, 'i').test(text);

const has = (text: string, phrase: string) => new RegExp(`(?<![a-z])${escape(phrase)}`, 'i').test(text);

function depthScore(text: string, deepRefs: number, conceptNames: readonly string[], figures: number): number {
  const causal = CAUSAL.filter((c) => has(text, c)).length;
  const examples = EXAMPLES.filter((c) => has(text, c)).length;
  const terms = new Set([...GO_TERMS, ...conceptNames].map((t) => t.toLowerCase().replace(/-/g, ' ')).filter((t) => termIn(text, t)));
  const sentences = text.split(/[.!?](?:\s|$)/).filter((x) => x.trim().split(/\s+/).length >= 3).length;
  const wordCount = Math.max(1, text.split(/\s+/).filter(Boolean).length);
  const body = sentences >= 3 && figures / wordCount < 0.15 ? 0.1 : 0;
  const d = Math.min(0.3, 0.1 * causal) + Math.min(0.3, 0.15 * deepRefs + 0.1 * examples) + Math.min(0.3, 0.1 * terms.size) + body;
  return Math.round(Math.min(1, d) * 1000) / 1000;
}

const share = (used: number, total: number, cap: number) => Math.min(1, used / Math.min(total, cap));

function coverageOf(ex: Explanation, text: string, hits: readonly Hit[]): number {
  const size = ex.position.size;
  const refIds = new Set(hits.filter((h) => h.kind === 'ref').map((h) => h.key));
  const coords = new Set(hits.filter((h) => h.kind === 'coord').map((h) => h.key));
  // A referenced line counts as naming its first move.
  for (const v of ex.variations) if (refIds.has(v.id) && v.moves.length) coords.add(name(v.moves[0].loc, size));
  const nums = hits.filter((h) => h.kind === 'pct' || h.kind === 'pts' || h.kind === 'num').map((h) => h.value);
  const textStems = stems(text);
  const groups: number[] = [];

  if (ex.facts.length) {
    let used = 0;
    for (const f of ex.facts) {
      const fh = scan(f.text, size);
      const fc = fh.filter((h) => h.kind === 'coord').map((h) => h.key);
      const fn = fh.filter((h) => (h.kind === 'pct' || h.kind === 'pts' || h.kind === 'num') && h.value > 2).map((h) => h.value);
      const fw = [...stems(f.text)];
      const hitWords = fw.filter((w) => textStems.has(w)).length;
      if (fc.some((c) => coords.has(c)) || fn.some((v) => near(v, nums, 0.6)) || (fw.length > 0 && hitWords / fw.length >= 0.5)) used++;
    }
    groups.push(share(used, ex.facts.length, 6));
  }
  if (ex.variations.length) groups.push(share(ex.variations.filter((v) => refIds.has(v.id)).length, ex.variations.length, 4));
  // A diagram the answer was given should be shown to the student.
  if (ex.illustrations?.length) groups.push(ex.illustrations.some((d) => refIds.has(d.id)) ? 1 : 0);
  if (ex.concepts.length) {
    const used = ex.concepts.filter((c) => (c.variation && refIds.has(c.variation)) || termIn(text, c.id)).length;
    groups.push(share(used, ex.concepts.length, 3));
  }
  if (ex.question.move !== undefined && ex.question.move !== PASS) groups.push(coords.has(name(ex.question.move, size)) ? 1 : 0);
  if (!groups.length) return 1;
  return Math.round((groups.reduce((a, b) => a + b, 0) / groups.length) * 1000) / 1000;
}

function truthOf(hits: readonly Hit[], ok: (h: Hit) => boolean): { truth: number; unsupported: string[] } {
  const bad = new Set<string>();
  let good = 0;
  for (const h of hits) {
    if (ok(h)) good++;
    else bad.add(h.kind === 'ref' ? `[[${h.key}]]` : h.kind === 'coord' || h.kind === 'badcoord' ? h.key : h.raw);
  }
  const truth = hits.length ? good / hits.length : 1;
  return { truth: Math.round(truth * 1000) / 1000, unsupported: [...bad] };
}

// --- wording that contradicts KataGo or names what the board does not show ---------------

/** Calm-position phrases that a lopsided game or a local fight contradicts. */
const CALM_PHRASES: [RegExp, string][] = [
  [/\bplenty of room\b/i, 'plenty of room'],
  [/\bno (?:single |one )?(?:correct|right|best|perfect) (?:move|answer)\b/i, 'no single correct move'],
  [/\bplay (?:to )?(?:your|whatever) (?:own )?style\b|\bplay your style\b/i, 'play your style'],
  [/\b(?:board|game|position) is (?:still )?wide open\b/i, 'wide open'],
  [/\bsplitting hairs\b/i, 'splitting hairs'],
  [/\b(?:play|pick) whichever\b/i, 'play whichever'],
  [/\bdon'?t stress\b|\bso relax\b/i, 'relax'],
  [/\bwhat kind of game\b|\bpeaceful game or a fight\b/i, 'style question'],
];

/** Shape words a writer may use, and the shapes (explain/shapes.ts) each one names. */
const SHAPE_WORDS: [RegExp, ShapeId[]][] = [
  [/^hane$/i, ['hane']],
  [/^(?:stretch(?:es)?|extends?|nobi)$/i, ['extend']],
  [/^(?:block|blocks|osae)$/i, ['block']],
  [/^(?:descent|descends|sagari)$/i, ['descent']],
  [/^(?:attachment|attach(?:es)?|tsuke|contact play)$/i, ['attach']],
  [/^(?:cut|cuts)$/i, ['cut']],
  [/^atari$/i, ['atari']],
  [/^(?:connection|connects?)$/i, ['connect']],
  [/^(?:capture|captures)$/i, ['capture']],
  [/^(?:diagonal move|kosumi)$/i, ['kosumi']],
  [/^(?:knight'?s move|keima)$/i, ['keima']],
  [/^(?:large knight'?s move|ogeima)$/i, ['large-keima']],
  [/^one-space jump$/i, ['one-space-jump']],
  [/^two-space (?:jump|extension)$/i, ['two-space-jump']],
  [/^(?:pincer|hasami)$/i, ['pincer']],
  [/^(?:approach|kakari)$/i, ['approach']],
  [/^(?:corner )?enclosure$|^shimari$/i, ['enclosure']],
  [/^3-3 invasion$/i, ['three-three']],
];
const SHAPE_ALT = "hane|stretch(?:es)?|extension|extends?|nobi|block|blocks|osae|descent|descends|sagari|attachment|attach(?:es)?|tsuke|contact play|cut|cuts|atari|connection|connects?|capture|captures|diagonal move|kosumi|large knight'?s move|knight'?s move|keima|ogeima|one-space jump|two-space (?:jump|extension)|pincer|hasami|approach|kakari|(?:corner )?enclosure|shimari|3-3 invasion";
const COORD = '[A-HJ-Za-hj-z](?:2[0-5]|1\\d|[1-9])';
/** Shapes in contact with other stones: never an extension (a hiraki). */
const CONTACT: ShapeId[] = ['capture', 'atari', 'connect', 'cut', 'hane', 'block', 'descent', 'extend', 'attach'];

/**
 * Where a point is played in the explanation and what shape each play makes there: as the
 * mover's move on the board (any candidate), as a move of a variation (on the board where it
 * comes), and as the game's last move. A shape word is grounded when one of them matches.
 */
function shapesAt(ex: Explanation, at: Loc): Set<ShapeId> {
  const { size, setup, moves, toPlay } = ex.position;
  const out = new Set<ShapeId>();
  const add = (s: ReturnType<typeof shapeOf>) => s && out.add(s.id);
  const root = replay(size, setup, moves);
  add(shapeOf(root, at, toPlay));
  const last = moves[moves.length - 1];
  if (last && last.loc === at) add(shapeOf(replay(size, setup, moves, moves.length - 1), at, last.color));
  for (const v of [...ex.variations, ...(ex.illustrations ?? []).map((d) => ({ moves: d.line, base: d.base }))]) {
    const b = 'base' in v ? replay(size, v.base.setup, v.base.moves) : root.clone();
    for (const m of v.moves) {
      if (m.loc === at) add(shapeOf(b, at, m.color));
      if (m.loc !== PASS) b.play(m.loc, m.color, true);
    }
  }
  return out;
}

/** Sentences of a text, refs and markdown removed. */
const sentences = (text: string) =>
  text
    .replace(/\[\[[^\]]*\]\]/g, '')
    .replace(/[*_`]/g, '')
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Wording a writer may not use for this explanation, whatever its figures (empty: none):
 * - in a sharp position where the engine teaches (situation.sharp, tone teach: one side far ahead,
 *   a contact play, one clear move) no calm-position phrases ("plenty of room", "play your
 *   style"), no "!" and no closing question, unless the engine's own draft has them;
 * - who leads must match KataGo's lead, and "close" or "even" is wrong at 5+ points;
 * - "the game is decided" only when gameDecided() says so (late, from the point lead);
 * - "sente" only when a sente / double-sente / reverse-sente concept or the engine's own text has it;
 * - a shape word at a point ("the hane at Q10", "R10 is a block") must be the shape that point
 *   makes on the board where it is played (explain/shapes.ts).
 */
export function wordingProblems(ex: Explanation, text: string): string[] {
  const out: string[] = [];
  const sit = ex.situation;
  const draft = [ex.summary, ...ex.sections.map((x) => x.text)].join(' ');
  const plain = text.replace(/\[\[[^\]]*\]\]/g, '');
  // The voice rules hold where the engine teaches (a celebration, a blunder or a problem keeps
  // its own voice), and the writer may not add what the engine's own draft does not say.
  if (sit?.sharp && (sit.tone === 'teach' || sit.tone === 'relaxed')) {
    for (const [re, label] of CALM_PHRASES) if (re.test(plain) && !re.test(draft)) out.push(`calm wording in a sharp position: "${label}"`);
    if (/!/.test(plain) && !/!/.test(draft)) out.push('exclamation mark in a sharp position');
    const ss = sentences(text);
    const ds = sentences(draft);
    if (ss.length && /\?$/.test(ss[ss.length - 1]) && !(ds.length && /\?$/.test(ds[ds.length - 1]))) out.push('closing question in a sharp position');
  }
  const lead = sit?.lead;
  if (lead !== undefined) {
    const mover = ex.position.toPlay === 1 ? 'black' : 'white';
    const opp = mover === 'black' ? 'white' : 'black';
    const leader = lead >= 0 ? mover : opp;
    const abs = Math.abs(lead);
    if (abs >= 5 && /\b(?:game is (?:still )?(?:close|even|balanced)|close game|(?:an |still )even game|evenly (?:matched|balanced)|neck and neck)\b/i.test(plain)) out.push(`"close" or "even" with a ${Math.round(abs)}-point lead`);
    if (abs >= 2) {
      for (const m of plain.matchAll(/\b(black|white)(?:'s)?\s+(?:is\s+(?:still\s+|clearly\s+|far\s+|well\s+|slightly\s+|a little\s+)?)?(ahead|leads|leading|behind|trails|trailing)\b/gi)) {
        const who = m[1].toLowerCase();
        const ahead = /^(?:ahead|lead)/i.test(m[2]);
        if ((ahead && who !== leader) || (!ahead && who === leader)) out.push(`wrong side ahead: "${m[0]}"`);
      }
    }
    const moveNo = ex.position.moves.length + 1;
    if (/\b(?:game is (?:already )?(?:decided|over)|already (?:lost|won)|nothing (?:left )?to play for)\b/i.test(plain) && !gameDecided(moveNo, lead, ex.position.size)) out.push('"decided" before the game is decided');
  }
  if (/\bsente\b/i.test(plain)) {
    const grounded = ex.concepts.some((c) => c.id === 'sente' || c.id === 'double-sente' || c.id === 'reverse-sente') || /\bsente\b/i.test(draft);
    if (!grounded) out.push('"sente" without KataGo evidence');
  }
  const size = ex.position.size;
  const shapeAt = new RegExp(`\\b(?:the |a |an )?(${SHAPE_ALT})\\s+(?:at|on|of)\\s+(${COORD})\\b|\\b(${COORD})\\s+(?:is|was|would be)\\s+(?:a|an|the)\\s+(?:\\w+\\s+)?(${SHAPE_ALT})\\b|\\b(${COORD})\\s+(attaches|cuts|blocks|descends|extends|connects|captures)\\b`, 'gi');
  for (const m of plain.matchAll(shapeAt)) {
    const word = (m[1] ?? m[4] ?? m[6]).toLowerCase();
    const at = (m[2] ?? m[3] ?? m[5]).toUpperCase();
    let loc: Loc;
    try {
      loc = gtpToLoc(at, size);
    } catch {
      continue; // not on this board: the truth check already counts it
    }
    if (loc < 0) continue;
    // An extension is a hiraki: a move along the side away from your stones, which no shape
    // here names exactly, so the word is wrong only for a contact play. In contact with the
    // mover's own stone ("the extension at Q9" after Q10) it is a stretch (nobi).
    if (word === 'extension') {
      const there = shapesAt(ex, loc);
      const away = there.has('two-space-jump') || there.has('open-point');
      if (!away && there.has('extend')) out.push(`"extension" at ${at} is a stretch (nobi), not an extension`);
      else if (!away && CONTACT.some((id) => there.has(id))) out.push(`"extension" at ${at} does not match the board (${[...there].join(', ')})`);
      continue;
    }
    const ids = SHAPE_WORDS.find(([re]) => re.test(word))?.[1] ?? [];
    if (!ids.length) continue;
    const there = shapesAt(ex, loc);
    if (!ids.some((id) => there.has(id))) out.push(`"${word}" at ${at} does not match the board${there.size ? ` (${[...there].join(', ')})` : ''}`);
  }
  return [...new Set(out)];
}

export function checkAnswer(ex: Explanation, text: string): AnswerScore {
  const allowed = allowedFor(ex);
  const hits = scan(text, ex.position.size);
  const { truth, unsupported } = truthOf(hits, (h) => supported(h, allowed));
  const coverage = text.trim() ? coverageOf(ex, text, hits) : 0;
  const deepRefs = new Set(
    hits.filter((h) => {
      const r = h.kind === 'ref' ? allowed.refs.get(h.key) : undefined;
      // A diagram counts as a worked example.
      return !!r && ('source' in r || ['refutation', 'consequence', 'what-if'].includes(r.kind));
    }).map((h) => h.key),
  ).size;
  const figures = hits.filter((h) => h.kind !== 'ref').length;
  const depth = depthScore(text, deepRefs, ex.concepts.map((c) => c.id), figures);
  const wording = wordingProblems(ex, text);
  return { truth, coverage, depth, unsupported, ...(wording.length ? { wording } : {}), pass: truth === 1 && coverage >= COVERAGE_FLOOR && !!text.trim() && !wording.length };
}

// --- concept answers ------------------------------------------------------------------

export type ConceptLike = Pick<ConceptEntry, 'id' | 'name' | 'aliases' | 'short' | 'related'>;

/** The terms a concept answer should use: the concept's name (any alias), the short answer's key words and related concepts. */
export function conceptKeyTerms(entry: ConceptLike): string[][] {
  const groups: string[][] = [[entry.name, entry.id.replace(/-/g, ' '), ...entry.aliases]];
  const nameStems = stems(groups[0].join(' '));
  const seen = new Set<string>();
  for (const w of words(entry.short)) {
    const st = stem(w);
    if (w.length < 5 || nameStems.has(st) || seen.has(st)) continue;
    seen.add(st);
    groups.push([w]);
    if (groups.length >= 7) break;
  }
  for (const r of entry.related.slice(0, 3)) groups.push([r.replace(/-/g, ' ')]);
  return groups;
}

/**
 * A concept answer (no board): truth is 0 when it names any board coordinate (there is no
 * board to point at), else 1; coverage is the share of the key terms it uses.
 */
export function checkConceptAnswer(entry: ConceptLike, text: string, size = 19): AnswerScore {
  const coords = scan(text, size).filter((h) => h.kind === 'coord' || h.kind === 'badcoord');
  const truth = coords.length ? 0 : 1;
  const terms = conceptKeyTerms(entry);
  const lower = text.toLowerCase();
  const textStems = stems(text);
  const used = terms.filter((g) => g.some((t) => (t.includes(' ') || t.length < 5 ? lower.includes(t.toLowerCase()) : textStems.has(stem(t.toLowerCase()))))).length;
  const coverage = text.trim() ? Math.round((used / terms.length) * 1000) / 1000 : 0;
  const depth = depthScore(text, 0, [entry.id, entry.name, ...entry.related], coords.length);
  return { truth, coverage, depth, unsupported: [...new Set(coords.map((c) => c.key))], pass: truth === 1 && coverage >= COVERAGE_FLOOR && !!text.trim() };
}
