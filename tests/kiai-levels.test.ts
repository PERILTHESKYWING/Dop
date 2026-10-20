/** Kiai thinking levels (kami/src/lib/levels.ts), deeper budgets, and the ultraGO writer's voice cleanup. */
import { describe, expect, it } from 'vitest';
import { LEVELS, levelById, levelFromOld, levelList, levelOfMessage } from '../kami/src/lib/levels';
import { kiaiVoice } from '../kami/src/lib/writer';
import { budgetFor } from '../src/lib/coach/explain/budgets';
import { LM_SYSTEM } from '../src/lib/coach/explain/prompt';

describe('thinking levels', () => {
  it('runs Low to ultraGO, each reading at least as much as the one before', () => {
    expect(LEVELS.map((l) => l.name)).toEqual(['Low', 'Medium', 'High', 'xHigh', 'Max', 'ultraGO']);
    const budgets = LEVELS.map((l) => budgetFor(l.pick === 'local' ? 'tesuji' : l.pick, l.thinking));
    for (let i = 1; i < budgets.length; i++) {
      expect(budgets[i].visits).toBeGreaterThanOrEqual(budgets[i - 1].visits);
      expect(budgets[i].maxMs).toBeGreaterThanOrEqual(budgets[i - 1].maxMs);
    }
  });

  it('only ultraGO uses the writer', () => {
    expect(LEVELS.filter((l) => l.pick === 'myoshu' || l.pick === 'local').map((l) => l.id)).toEqual(['ultrago']);
  });

  it('blurbs promise no more time than the budget allows', () => {
    for (const l of LEVELS) {
      const m = /Up to (\d+) seconds/.exec(l.blurb);
      if (m) expect(budgetFor(l.pick === 'local' ? 'tesuji' : l.pick, l.thinking).maxMs).toBeLessThanOrEqual(+m[1] * 1000);
    }
    expect(budgetFor('myoshu', 'max').maxMs).toBeLessThanOrEqual(60_000);
  });

  it('maps the old depth and thinking choice to a level', () => {
    expect(levelFromOld('myoshu', 'high')).toBe('ultrago');
    expect(levelFromOld('hane', 'off')).toBe('low');
    expect(levelFromOld('tesuji', 'high')).toBe('high');
    expect(levelFromOld('tesuji', 'low')).toBe('medium');
    expect(levelFromOld(null, null)).toBeNull();
    expect(levelOfMessage({ pick: 'myoshu', thinking: 'high' })?.id).toBe('ultrago');
    expect(levelOfMessage({ level: 'xhigh' })?.name).toBe('xHigh');
  });

  it('offers Local only when it is configured, and falls back to Medium', () => {
    expect(levelList(false).some((l) => l.id === 'local')).toBe(false);
    expect(levelList(true).at(-1)?.id).toBe('local');
    expect(levelById(undefined).id).toBe('medium');
  });
});

describe('ultraGO voice', () => {
  it('drops chat-assistant openers and closers', () => {
    expect(kiaiVoice('Great question! Certainly. R16 is the key point, because it [[v1]] makes the corner solid. I hope this helps!')).toBe(
      'R16 is the key point, because it [[v1]] makes the corner solid.',
    );
    expect(kiaiVoice('Black is ahead.\nLet me know if you want more.')).toBe('Black is ahead.');
  });

  it('turns clause dashes into commas', () => {
    expect(kiaiVoice('Q3 is big — it takes the corner and stays in sente.')).toBe('Q3 is big, it takes the corner and stays in sente.');
  });

  it('leaves plain answers alone', () => {
    const t = 'D4 is fine. The lower side is still open, so [[v1]] keeps the balance.';
    expect(kiaiVoice(t)).toBe(t);
  });

  it('the prompt asks for Kiai’s voice, emoji only as the draft has them', () => {
    expect(LM_SYSTEM).toMatch(/Kiai's voice/);
    expect(LM_SYSTEM).toMatch(/emoji only where the draft has one/);
    expect(LM_SYSTEM).not.toMatch(/emoji or two/);
  });
});
