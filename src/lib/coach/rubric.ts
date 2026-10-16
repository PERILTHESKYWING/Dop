/**
 * The rubric: how Kami's answers are scored after the truth check (eval/coach/rubric.json).
 * XIAO critiques a batch of Kami's analyses once; that critique becomes the rules here, and
 * every later training run scores answers with them. Rules with a `check` are scored by this
 * code; every rule's text also goes to the judge (scripts/coachlm/judge.py), which scores the
 * rest. Truth still comes first: an answer that invents a move or a number scores 0 whatever
 * the rubric says.
 *
 * A rule may hold only in some situations (`when`, read from the explanation's `situation` and
 * `question`): "no winrates in a tsumego", "say both moves are fine when the gap is negligible".
 * A rule whose `when` does not match is skipped, so it neither helps nor hurts the score.
 */
import type { Explanation, QuestionIntent, QuestionKind, Situation } from './explain/types';

export type RubricCheck =
  /** The text must match `pattern` (with `flags`). */
  | { kind: 'require'; pattern: string; flags?: string }
  /** The text must not match `pattern`. */
  | { kind: 'forbid'; pattern: string; flags?: string }
  /** Word count within min..max. */
  | { kind: 'words'; min?: number; max?: number }
  /** The first two sentences answer: name the asked or best move, link a line, or give the verdict. */
  | { kind: 'leadsWithAnswer' }
  /** When the explanation has a diagram, the text shows one ([[dN]]). */
  | { kind: 'refsDiagram' }
  /** When the explanation has variations or diagrams, the text links at least one ([[vN]] / [[dN]]). */
  | { kind: 'refsLine' }
  /** Mentions at least `min` of `terms` (case-insensitive words). */
  | { kind: 'terms'; terms: string[]; min: number }
  /** At most `max` numbers (board coordinates, [[v1]] refs, "3-3", "19x19", "3rd line", ranks and list markers do not count). */
  | { kind: 'maxNumbers'; max: number }
  /** `pattern` matches at most `max` times (the g flag is added). */
  | { kind: 'maxMatches'; pattern: string; flags?: string; max: number }
  /** No two sentences say the same thing, and no "X is N points worse" or "Black leads by N" is stated twice. */
  | { kind: 'noRepeats' }
  /** The first sentence (markdown and refs stripped) matches `pattern`. */
  | { kind: 'leadsWith'; pattern: string; flags?: string };

/** When a rule applies. Every given field must match; absent fields match anything. */
export interface RubricWhen {
  tsumego?: boolean;
  open?: boolean;
  handicap?: boolean;
  styleChoice?: boolean;
  transposes?: boolean;
  phase?: Situation['phase'][];
  gap?: Situation['gap'][];
  tone?: Situation['tone'][];
  kind?: QuestionKind[];
  intent?: QuestionIntent[];
  /** Pattern (case-insensitive) on the student's own words, e.g. a yes/no question. */
  ask?: string;
}

export type RubricTopic = 'tone' | 'teaching' | 'accuracy' | 'structure' | 'diagrams';

export interface RubricRule {
  id: string;
  /** What a good answer does, in plain words (the judge reads this). */
  text: string;
  weight: number;
  check?: RubricCheck;
  /** Which tasks it applies to (default: all). */
  applies?: 'position' | 'concept' | 'all';
  /** Only in these situations (default: always). */
  when?: RubricWhen;
  /** What the rule is about; a reviewer can read one topic (rubricText(rubric, 'tone')). */
  topic?: RubricTopic;
  /** Where the rule came from ("XIAO, item 7"). */
  from?: string;
}

export interface Rubric {
  version: number;
  updated: string;
  about?: string;
  rules: RubricRule[];
}

export interface RubricScore {
  /** 0-1: weighted share of code-checked rules passed; null when no rule could be checked. */
  rubric: number | null;
  /** Ids of code-checked rules the text broke. */
  broken: string[];
}

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

const REF = /\[\[\s*[vd]\d+\s*\]\]/g;
const COORD = /\b[A-HJ-Z](?:2[0-5]|1\d|[1-9])\b/g;

/** Sentences (line by line), list markers, bold and refs stripped, empty ones dropped. */
function sentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.replace(/\r/g, '').split(/\n+/)) {
    for (const s of line.replace(/^\s*(?:#+|[-*>]|\d+[.)])\s+/, '').split(/(?<=[.!?])\s+/)) {
      const t = s.replace(REF, ' ').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/**
 * The numbers a reader sees, as explain/text.ts numbersIn counts them (refs and coordinates
 * are not numbers), minus names that are not figures: "3-3" points, board sizes, "3rd line",
 * ranks ("5k"), "4-stone" and list markers. Copied, not imported: explain/ changes often.
 */
export function numbersIn(text: string): string[] {
  const t = text
    .replace(REF, ' ')
    .replace(COORD, ' ')
    .replace(/^\s*\d+[.)]\s/gm, ' ')
    .replace(/(?<![\d.])\d{1,2}\s*[x×]\s*\d{1,2}(?![\d.])/g, ' ')
    .replace(/(?<![\d.])[1-6]\s*-\s*[1-6](?![\d.])(?!\s*(?:points|pts|%|moku|percent))/gi, ' ')
    .replace(/(?<![\d.])\d{1,2}(?:st|nd|rd|th)?[\s-]+line\b/gi, ' ')
    .replace(/(?<![\d.])\d{1,2}\s?-?\s?(?:kyu|dan|k|d|p)\b/gi, ' ')
    .replace(/(?<![\d.])\d{1,2}-stones?\b/gi, ' ');
  return (t.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));
}

/** Words for "this sentence says the same as that one": lower case, refs and punctuation gone. */
function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/(\d)\.(\d)/g, '$1_$2')
    .replace(/[^\p{L}\p{N}_\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

const MARGIN = /(?<![\w.-])(\d+(?:\.\d+)?)\s*(?:points?|pts|moku)\s+(?:worse|better|slower|faster|bigger|smaller|less|more|apart|behind)\b|\bloses\s+(?:about\s+)?(\d+(?:\.\d+)?)\s*(?:points?|pts|moku)\b/gi;
const LEAD = /\b(black|white)\s+(leads|trails|is ahead|is behind)\s+by\s+(?:about\s+)?(\d+(?:\.\d+)?)/gi;

/** The claims a sentence makes that must not be made twice ("margin|C10|1": C10 is 1 point worse). */
function claims(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(MARGIN)) {
    // The move the margin is about: the last coordinate in the same clause, before the number.
    const head = s.slice(0, m.index);
    const clause = head.slice(Math.max(head.lastIndexOf(','), head.lastIndexOf(';'), head.lastIndexOf(':')) + 1);
    const cs = clause.match(COORD);
    out.push(`margin|${cs ? cs[cs.length - 1] : ''}|${Number(m[1] ?? m[2])}`);
  }
  for (const m of s.matchAll(LEAD)) out.push(`lead|${m[1].toLowerCase()}|${/lead|ahead/i.test(m[2]) ? 'leads' : 'trails'}|${Number(m[3])}`);
  return out;
}

/** The first pair of sentences that repeat each other, or null. */
export function findRepeat(text: string): [string, string] | null {
  const ss = sentences(text);
  const toks = ss.map(tokens);
  const seen = new Map<string, number>();
  for (let i = 0; i < ss.length; i++) {
    for (const c of new Set(claims(ss[i]))) {
      const j = seen.get(c);
      if (j !== undefined) return [ss[j], ss[i]];
      seen.set(c, i);
    }
    for (let j = 0; j < i; j++) {
      const [a, b] = toks[j].length <= toks[i].length ? [toks[j], toks[i]] : [toks[i], toks[j]];
      if (a.length < 3) continue;
      if (a.join(' ') === b.join(' ')) return [ss[j], ss[i]];
      // The shorter sentence (5+ words) says nothing the longer one does not.
      const inB = new Set(b);
      if (a.length >= 5 && a.filter((w) => inB.has(w)).length / a.length >= 0.9) return [ss[j], ss[i]];
    }
  }
  return null;
}

/** "Yes", "a good move", "the board is wide open": a lead that gives the verdict in words. */
const VERDICT = /\b(?:it depends|good|bad|fine|nice|great move|well (?:done|played|found)|mistake|slow|blunder|oops|ouch|gift|donat\w*|gives? away|throws? away|dies|dead|better|worse|best|as good|playable|reasonable|overplay|no single|plenty|wide open|ahead|leads?|leading|behind|trails?|even|close game)\b/i;

function leadsWithAnswer(text: string, ex: Explanation | null): boolean {
  const lead = text.replace(/\r/g, '').split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim()).slice(0, 2).join(' ');
  if (/\[\[[vd]\d+\]\]/.test(lead)) return true;
  if (!ex) return lead.length > 0;
  const size = ex.position.size;
  const cols = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
  const name = (l: number) => `${cols[l % size]}${size - Math.floor(l / size)}`;
  const names = new Set<string>();
  if (ex.question.move !== undefined && ex.question.move >= 0) names.add(name(ex.question.move));
  const best = ex.variations.find((v) => v.kind === 'best')?.moves[0];
  if (best && best.loc >= 0) names.add(name(best.loc));
  if ([...names].some((n) => new RegExp(`\\b${n}\\b`, 'i').test(lead))) return true;
  // A verdict in words answers too ("Yes!", "Both moves are good!", "The board is wide open").
  return /^\W*(?:yes|no)\b/i.test(lead.replace(/\*\*/g, '')) || VERDICT.test(lead);
}

const SITUATION_KEYS = ['tsumego', 'open', 'handicap', 'styleChoice', 'transposes', 'phase', 'gap', 'tone'] as const;

/**
 * Whether a rule's `when` holds for this answer. Concept answers (no explanation) match no
 * `when`; answers made before `situation` existed match only conditions on the question.
 */
export function whenMatches(w: RubricWhen | undefined, ex: Explanation | null): boolean {
  if (!w) return true;
  if (!ex) return false;
  const s = ex.situation;
  if (SITUATION_KEYS.some((k) => w[k] !== undefined)) {
    if (!s) return false;
    for (const k of ['tsumego', 'open', 'handicap', 'styleChoice', 'transposes'] as const) {
      if (w[k] !== undefined && Boolean(s[k]) !== w[k]) return false;
    }
    if (w.phase && !w.phase.includes(s.phase)) return false;
    if (w.gap && !w.gap.includes(s.gap)) return false;
    if (w.tone && !w.tone.includes(s.tone)) return false;
  }
  const q = ex.question;
  if (w.kind && !w.kind.includes(q.kind)) return false;
  if (w.intent && !(q.intent && w.intent.includes(q.intent))) return false;
  if (w.ask !== undefined && !new RegExp(w.ask, 'i').test(q.text ?? '')) return false;
  return true;
}

/** One code check; null when it does not apply to this answer. */
export function checkRule(c: RubricCheck, text: string, ex: Explanation | null): boolean | null {
  switch (c.kind) {
    case 'require':
      return new RegExp(c.pattern, c.flags).test(text);
    case 'forbid':
      return !new RegExp(c.pattern, c.flags).test(text);
    case 'words': {
      const n = words(text);
      return n >= (c.min ?? 0) && n <= (c.max ?? Infinity);
    }
    case 'leadsWithAnswer':
      return leadsWithAnswer(text, ex);
    case 'refsDiagram':
      if (!ex?.illustrations?.length) return null;
      return ex.illustrations.some((d) => text.includes(`[[${d.id}]]`));
    case 'refsLine': {
      const ids = [...(ex?.variations ?? []), ...(ex?.illustrations ?? [])].map((v) => v.id);
      if (!ids.length) return null;
      return ids.some((id) => text.includes(`[[${id}]]`));
    }
    case 'terms': {
      const lower = text.toLowerCase();
      return c.terms.filter((t) => lower.includes(t.toLowerCase())).length >= c.min;
    }
    case 'maxNumbers':
      return numbersIn(text).length <= c.max;
    case 'maxMatches': {
      const flags = c.flags?.includes('g') ? c.flags : `${c.flags ?? ''}g`;
      return (text.match(new RegExp(c.pattern, flags))?.length ?? 0) <= c.max;
    }
    case 'noRepeats':
      return findRepeat(text) === null;
    case 'leadsWith': {
      const first = sentences(text)[0];
      return first !== undefined && new RegExp(c.pattern, c.flags).test(first);
    }
  }
}

/** The code-checked part of the rubric for one answer. `ex` is null for concept answers. */
export function scoreRubric(rubric: Rubric, text: string, ex: Explanation | null): RubricScore {
  const kind = ex ? 'position' : 'concept';
  let total = 0;
  let got = 0;
  const broken: string[] = [];
  for (const r of rubric.rules) {
    if (!r.check || (r.applies && r.applies !== 'all' && r.applies !== kind)) continue;
    let ok: boolean | null;
    try {
      ok = whenMatches(r.when, ex) ? checkRule(r.check, text, ex) : null;
    } catch {
      ok = null; // a bad pattern in the file is skipped, not fatal
    }
    if (ok === null) continue;
    total += r.weight;
    if (ok) got += r.weight;
    else broken.push(r.id);
  }
  return { rubric: total ? Math.round((got / total) * 1000) / 1000 : null, broken };
}

/** The rubric as the judge reads it: one numbered rule per line (only `topic`'s rules when given). */
export function rubricText(rubric: Rubric, topic?: RubricTopic): string {
  return rubric.rules
    .filter((r) => !topic || r.topic === topic)
    .map((r, i) => `${i + 1}. ${r.text}${r.weight >= 3 ? ' (most important)' : ''}`)
    .join('\n');
}
