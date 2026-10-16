/**
 * Answer text split for rendering: board points (shown on the board when hovered) and Go
 * terms from the glossary (a short definition when hovered or tapped). Each term gets its
 * hover once per answer, where it first appears, so the text does not fill up with underlines.
 */
import { findTerms, type GlossaryEntry } from '../../../src/lib/coach/glossary';
import { conceptById } from '../../../src/lib/coach/library';
import type { Loc } from '../../../src/lib/go/types';
import { splitPoints } from './points';

export type RichPart = { type: 'text'; text: string } | { type: 'point'; text: string; loc: Loc } | { type: 'term'; text: string; entry: GlossaryEntry };

export interface TermPick {
  /** Entries that may get a hover in this text (absent: all of them). */
  allow?: ReadonlySet<GlossaryEntry>;
  /** Entries already given a hover in this text; each gets one, at its first occurrence. */
  seen?: Set<GlossaryEntry>;
}

/**
 * `text` as plain pieces, board points (when `size` is given) and glossary terms (when `terms`
 * is given). A `seen` set is filled as terms are used, so pass one set for one text.
 */
export function splitRich(text: string, size: number | null, terms: TermPick | null): RichPart[] {
  const base: RichPart[] = size ? splitPoints(text, size) : [{ type: 'text', text }];
  if (!terms) return base;
  const out: RichPart[] = [];
  for (const p of base) {
    if (p.type !== 'text') {
      out.push(p);
      continue;
    }
    let last = 0;
    for (const t of findTerms(p.text)) {
      if (terms.allow && !terms.allow.has(t.entry)) continue;
      if (terms.seen) {
        if (terms.seen.has(t.entry)) continue;
        terms.seen.add(t.entry);
      }
      if (t.start > last) out.push({ type: 'text', text: p.text.slice(last, t.start) });
      out.push({ type: 'term', text: p.text.slice(t.start, t.end), entry: t.entry });
      last = t.end;
    }
    if (last < p.text.length) out.push({ type: 'text', text: p.text.slice(last) });
  }
  return out;
}

/**
 * For texts read in order (an answer's summary and sections, a list of facts), the glossary
 * entries whose first occurrence among all of them is in each one. `skip` leaves entries out
 * (a library answer does not underline its own term).
 */
export function firstTerms(texts: readonly string[], skip?: (e: GlossaryEntry) => boolean): Set<GlossaryEntry>[] {
  const seen = new Set<GlossaryEntry>();
  return texts.map((t) => {
    const here = new Set<GlossaryEntry>();
    for (const m of findTerms(t)) {
      if (seen.has(m.entry) || skip?.(m.entry)) continue;
      seen.add(m.entry);
      here.add(m.entry);
    }
    return here;
  });
}

/**
 * The tooltip's title and text. A definition written "Double sente: a large point..." is
 * split at its colon; otherwise the title is the library entry's name, or the term.
 */
export function termCard(e: GlossaryEntry): { title: string; text: string } {
  const m = e.def.match(/^([^:.!?]{2,40}):\s+([\s\S]*)$/);
  if (m) return { title: m[1], text: m[2][0].toUpperCase() + m[2].slice(1) };
  const c = e.concept ? conceptById(e.concept) : undefined;
  return { title: c?.name ?? e.term[0].toUpperCase() + e.term.slice(1), text: e.def };
}
