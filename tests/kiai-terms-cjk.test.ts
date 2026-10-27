import { describe, expect, it } from 'vitest';
import { GLOSSARY } from '../src/lib/coach/glossary';
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
    expect(termCard(GLOSSARY.find((g) => g.term === 'hane')!).names).toEqual({ zh: '扳', ja: 'ハネ' });
  });

  it('leaves out the terms with no single standard pair', () => {
    for (const t of ['liberty', 'kikashi', 'vital point', 'dragon', 'bamboo joint', 'reverse sente', 'influence', 'overconcentration', 'probe']) {
      expect(terms.has(t), t).toBe(true);
      expect(t in TERM_NAMES, t).toBe(false);
    }
  });

  it('writes Chinese in Han characters and Japanese in Han or kana', () => {
    for (const [k, { zh, ja }] of Object.entries(TERM_NAMES)) {
      expect(zh, k).toMatch(/^[\p{Script=Han}]+$/u);
      expect(ja, k).toMatch(/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々]+$/u);
    }
  });
});
