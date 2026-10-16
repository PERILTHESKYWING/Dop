/**
 * The rubric: how Kami's answers are scored after the truth check (eval/coach/rubric.json).
 * XIAO critiques a batch of Kami's analyses once; that critique becomes the rules here, and
 * every later training run scores answers with them. Rules with a `check` are scored by this
 * code; every rule's text also goes to the judge (scripts/coachlm/judge.py), which scores the
 * rest. Truth still comes first: an answer that invents a move or a number scores 0 whatever
 * the rubric says.
 */
import type { Explanation } from './explain/types';

export type RubricCheck =
  /** The text must match `pattern` (with `flags`). */
  | { kind: 'require'; pattern: string; flags?: string }
  /** The text must not match `pattern`. */
  | { kind: 'forbid'; pattern: string; flags?: string }
  /** Word count within min..max. */
  | { kind: 'words'; min?: number; max?: number }
  /** The first two sentences name the asked move, the best move, or link a line. */
  | { kind: 'leadsWithAnswer' }
  /** When the explanation has a diagram, the text shows one ([[dN]]). */
  | { kind: 'refsDiagram' }
  /** Mentions at least `min` of `terms` (case-insensitive words). */
  | { kind: 'terms'; terms: string[]; min: number };

export interface RubricRule {
  id: string;
  /** What a good answer does, in plain words (the judge reads this). */
  text: string;
  weight: number;
  check?: RubricCheck;
  /** Which tasks it applies to (default: all). */
  applies?: 'position' | 'concept' | 'all';
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
  // Overview questions are answered by who is ahead.
  return ex.question.kind === 'overview' && /\b(ahead|leads?|behind|trails?|even)\b/i.test(lead);
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
    case 'terms': {
      const lower = text.toLowerCase();
      return c.terms.filter((t) => lower.includes(t.toLowerCase())).length >= c.min;
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
      ok = checkRule(r.check, text, ex);
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

/** The rubric as the judge reads it: one numbered rule per line. */
export function rubricText(rubric: Rubric): string {
  return rubric.rules.map((r, i) => `${i + 1}. ${r.text}${r.weight >= 3 ? ' (most important)' : ''}`).join('\n');
}
