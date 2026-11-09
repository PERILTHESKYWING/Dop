import { describe, expect, it } from 'vitest';
import { findTerms, GLOSSARY } from '../src/lib/coach/glossary';
import { TERM_NAMES, termCard } from '../kami/src/lib/terms';

describe('Go terms in Chinese and Japanese (lib/terms.ts)', () => {
  const terms = new Set(GLOSSARY.map((g) => g.term));

  it('keys every name by a glossary term', () => {
    for (const k of Object.keys(TERM_NAMES)) expect(terms.has(k), k).toBe(true);
  });

  it('shows the names on listed terms only', () => {
    for (const g of GLOSSARY) {
      const card = termCard(g);
      if (g.term in TERM_NAMES) expect(card.names, g.term).toEqual(TERM_NAMES[g.term]);
      else expect(card.names, g.term).toBeUndefined();
    }
    expect(termCard(GLOSSARY.find((g) => g.term === 'hane')!).names).toEqual({ zh: '扳', py: 'bān', ja: 'ハネ' });
  });

  it('leaves out the terms with no single standard pair', () => {
    for (const t of ['liberty', 'kikashi', 'vital point', 'dragon', 'bamboo joint', 'reverse sente', 'influence', 'overconcentration', 'probe']) {
      expect(terms.has(t), t).toBe(true);
      expect(t in TERM_NAMES, t).toBe(false);
    }
  });

  it('writes Chinese in Han characters and Japanese in Han or kana', () => {
    for (const [k, { zh, ja, also }] of Object.entries(TERM_NAMES)) {
      expect(zh, k).toMatch(/^[\p{Script=Han}]+$/u);
      if (also) expect(also.zh, k).toMatch(/^[\p{Script=Han}]+$/u);
      expect(ja, k).toMatch(/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々]+$/u);
    }
  });

  // Chinese 5d, 2026-11-06: pinyin beside the characters, 靠 beside 碰, and the crosscut
  it('gives every Chinese name its pinyin, one syllable a character, with tone marks', () => {
    // a syllable: Latin letters with or without a tone mark (neutral tone has none: 征子 zhēngzi)
    for (const [k, { zh, py, also }] of Object.entries(TERM_NAMES)) {
      for (const [h, p] of [[zh, py], ...(also ? [[also.zh, also.py]] : [])]) {
        const syll = p.match(/(?:[bcdfghjklmnpqrstwxyz]h?)?[aeiouüāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+(?:ng|n|r)?(?![aeiouüāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ])/g) ?? [];
        expect(syll.length, `${k} ${p}`).toBe([...h].length);
        expect(p, k).toMatch(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/);
      }
    }
    expect(TERM_NAMES.tsuke).toEqual({ zh: '碰', py: 'pèng', ja: 'ツケ', also: { zh: '靠', py: 'kào' } });
    expect(TERM_NAMES.crosscut).toEqual({ zh: '扭断', py: 'niǔduàn', ja: 'キリチガイ' });
    expect(TERM_NAMES.aji.zh).toBe('味道');
  });

  it('finds the crosscut as one term, never as a cut', () => {
    const hits = findTerms('Black answers the crosscut by extending; a cross-cut is not a cut.');
    expect(hits.map((h) => h.entry.term)).toEqual(['crosscut', 'crosscut', 'cut']);
  });
});
