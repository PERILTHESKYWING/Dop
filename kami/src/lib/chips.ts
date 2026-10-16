/** Answer text with [[vN]] variation references, split for rendering and flattened for copying. */
import type { Explanation } from '../../../src/lib/coach/explain/types';

export type Inline = { type: 'text'; text: string } | { type: 'bold'; text: string } | { type: 'chip'; id: string };

const CHIP = /\[\[\s*([vd]\d+)\s*\]\]/g;

/** Text and [[vN]] chips (and **bold**), in order. Empty text pieces are dropped. */
export function splitChips(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const pushText = (s: string) => {
    // **bold** inside plain text.
    let i = 0;
    for (const m of s.matchAll(/\*\*([^*]+)\*\*/g)) {
      if (m.index! > i) out.push({ type: 'text', text: s.slice(i, m.index) });
      out.push({ type: 'bold', text: m[1] });
      i = m.index! + m[0].length;
    }
    if (i < s.length) out.push({ type: 'text', text: s.slice(i) });
  };
  for (const m of text.matchAll(CHIP)) {
    if (m.index! > last) pushText(text.slice(last, m.index));
    out.push({ type: 'chip', id: m[1] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) pushText(text.slice(last));
  return out;
}

export type Block = { type: 'p'; text: string } | { type: 'ul'; items: string[] } | { type: 'h'; text: string };

/** Paragraphs, "- " lists and "## " headings: the little markdown a writer uses. */
export function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    let para: string[] = [];
    let list: string[] = [];
    const flush = () => {
      if (para.length) out.push({ type: 'p', text: para.join(' ') });
      if (list.length) out.push({ type: 'ul', items: list });
      para = [];
      list = [];
    };
    for (const l of lines) {
      const h = l.match(/^#{1,4}\s+(.*)$/);
      const li = l.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (h) {
        flush();
        out.push({ type: 'h', text: h[1].replace(/\*\*/g, '') });
      } else if (li) {
        if (para.length) flush();
        list.push(li[1]);
      } else {
        if (list.length) flush();
        para.push(l);
      }
    }
    flush();
  }
  return out;
}

/** The text with each [[vN]] / [[dN]] replaced by its label, for the clipboard. */
export function plainText(text: string, ex?: Pick<Explanation, 'variations' | 'illustrations'>): string {
  return text.replace(CHIP, (_, id: string) => {
    const v = ex?.variations.find((x) => x.id === id) ?? ex?.illustrations?.find((x) => x.id === id);
    return v ? v.label : '';
  }).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/[ \t]+([.,;:])/g, '$1');
}

/** The engine's own answer as one text: summary, then each section under its title. */
export function engineText(ex: Pick<Explanation, 'summary' | 'sections'>): string {
  return [ex.summary, ...ex.sections.map((s) => `## ${s.title}\n\n${s.text}`)].filter(Boolean).join('\n\n');
}
