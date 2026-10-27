/** Glossary hovers: Go terms in answer text get a short definition (src/lib/coach/glossary.ts). */
import { describe, expect, it } from 'vitest';
import { findTerms, GLOSSARY } from '../src/lib/coach/glossary';
import { conceptById } from '../src/lib/coach/library';
import { firstTerms, splitRich, termCard } from '../kami/src/lib/terms';
import { gtpToLoc } from '../src/lib/go/coords';

const terms = (text: string) => findTerms(text).map((h) => text.slice(h.start, h.end));
const termOf = (text: string) => findTerms(text).map((h) => h.entry.term);

describe('glossary entries', () => {
  it('covers the terms XIAO listed', () => {
    const must = [
      'sente', 'gote', 'double sente', 'ryou-sente', 'reverse sente', 'gyaku-sente', 'miai', 'moyo', 'framework', 'aji', 'ko', 'ko threat', 'seki', 'tenuki',
      'kakari', 'approach', 'shimari', 'enclosure', 'hasami', 'pincer', 'keima', "knight's move", 'ogeima', "large knight's move", 'kosumi', 'diagonal move',
      'hane', 'tsuke', 'attachment', 'atari', '3-3 invasion', 'invasion', 'reduction', 'vital point', 'eye', 'false eye', 'dragon', 'thickness', 'influence',
      'big point', 'tesuji', 'throw-in', 'snapback', 'ladder', 'net', 'geta', 'joseki', 'yose', 'endgame', 'overconcentration', 'liberty',
    ];
    for (const t of must) expect(terms(`a ${t} here`), t).toEqual([t]);
  });

  it('has short, plain definitions', () => {
    for (const e of GLOSSARY) {
      expect(e.def.length, e.term).toBeGreaterThan(20);
      expect(e.def.length, e.term).toBeLessThanOrEqual(140);
      expect(e.def, e.term).toMatch(/\.$/);
      expect(e.def, e.term).not.toMatch(/\d+(\.\d+)?%|\bpoints? lead\b/);
      if (e.concept) expect(conceptById(e.concept), e.term).toBeDefined();
    }
  });

  it("uses XIAO's own hover text for miai and double sente", () => {
    const def = (t: string) => findTerms(t)[0].entry.def;
    expect(def('miai')).toBe('Two points that achieve the same goal. If your opponent takes one, you can use the other.');
    expect(def('ryou-sente')).toBe('Double sente: a large point that either player can take first to gain sente.');
    expect(def('double sente')).toBe(def('ryou-sente'));
  });

  it('takes library definitions so the two never disagree', () => {
    const aji = GLOSSARY.find((e) => e.term === 'aji')!;
    expect(aji.def).toBe(conceptById('aji')!.hover);
    const gote = GLOSSARY.find((e) => e.term === 'gote')!;
    expect(gote.def).toBe(conceptById('gote')!.short);
  });
});

describe('findTerms', () => {
  it('matches whole words in any case, with plurals and hyphen or space', () => {
    expect(terms('Sente matters. Play in SENTE.')).toEqual(['Sente', 'SENTE']);
    expect(terms('Two ladders and three liberties')).toEqual(['ladders', 'liberties']);
    expect(termOf('this is ryou sente')).toEqual(['double sente']);
    expect(termOf('a gyaku sente move')).toEqual(['reverse sente']);
    expect(terms('the knight’s move at O3')).toEqual(['knight’s move']);
    expect(terms('presente, kosmic, ladderless, gotee')).toEqual([]);
  });

  it('prefers the longest term and never overlaps', () => {
    expect(termOf('This is double sente.')).toEqual(['double sente']);
    expect(termOf('Find a ko threat first.')).toEqual(['ko threat']);
    expect(termOf('It is only a false eye.')).toEqual(['false eye']);
    expect(termOf("The large knight's move is thin.")).toEqual(['ogeima']);
    expect(termOf('The 3-3 invasion still works.')).toEqual(['3-3 invasion']);
    expect(termOf('Sente, then the ko, then miai.')).toEqual(['sente', 'ko', 'miai']);
  });

  it('positions are offsets into the text as given', () => {
    const text = 'Aji and miai.';
    expect(findTerms(text).map((h) => [h.start, h.end])).toEqual([
      [0, 3],
      [8, 12],
    ]);
  });

  it('never matches inside chips or board points', () => {
    expect(terms('Play Q16 [[v1]] for miai [[d2]].')).toEqual(['miai']);
    expect(terms('[[ko]] and K10')).toEqual([]);
  });

  it('skips everyday phrases', () => {
    expect(terms('a net gain of a few points')).toEqual([]);
    expect(terms('keep an eye on the cut')).toEqual([]);
    expect(terms('a second eye to live')).toEqual(['eye']);
  });

  it('returns nothing for empty text', () => {
    expect(findTerms('')).toEqual([]);
  });
});

describe('Kami term rendering helpers', () => {
  it('splits text into points and terms, a term once per text', () => {
    const parts = splitRich('Miai: R16 or Q17, and miai again.', 19, { seen: new Set() });
    expect(parts.map((p) => p.type)).toEqual(['term', 'text', 'point', 'text', 'point', 'text']);
    expect(parts[2]).toMatchObject({ type: 'point', loc: gtpToLoc('R16', 19) });
    expect(splitRich('miai and sente', null, null)).toEqual([{ type: 'text', text: 'miai and sente' }]);
  });

  it('gives each term a hover only where it first appears in an answer', () => {
    const plan = firstTerms(['Play sente here.', 'Sente and miai.', 'Miai again.']);
    expect(plan.map((s) => [...s].map((e) => e.term))).toEqual([['sente'], ['miai'], []]);
    const skip = firstTerms(['Miai and sente.'], (e) => e.concept === 'miai');
    expect([...skip[0]].map((e) => e.term)).toEqual(['sente']);
    const parts = splitRich('sente, miai', null, { allow: plan[0], seen: new Set() });
    expect(parts.filter((p) => p.type === 'term').map((p) => p.text)).toEqual(['sente']);
  });

  it('cards have a title and the definition', () => {
    const card = (t: string) => termCard(findTerms(t)[0].entry);
    expect(card('ryou-sente')).toMatchObject({ title: 'Double sente', text: 'A large point that either player can take first to gain sente.' });
    expect(card('miai')).toMatchObject({ title: 'Miai', text: 'Two points that achieve the same goal. If your opponent takes one, you can use the other.' });
    expect(card('pincer').title).toBe('Hasami (pincer)');
  });
});
