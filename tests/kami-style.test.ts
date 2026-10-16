/** Kami's style memory (kami/src/lib/style.ts) and the student profile it feeds the explainer. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { PlayStyle } from '../src/lib/coach/explain/types';
import { gtpToLoc } from '../src/lib/go/coords';
import { PASS } from '../src/lib/go/types';
import { emptyBoard, playAt } from '../kami/src/lib/position';
import { resetSettings, setSetting } from '../kami/src/lib/settings';
import { dominantStyle, learnedStyle, observeMove, recordStyle, resetStyle, STYLE_KEEP, STYLE_MIN, studentProfile } from '../kami/src/lib/style';

const many = (s: PlayStyle, n: number): PlayStyle[] => Array.from({ length: n }, () => s);

describe('dominantStyle', () => {
  it('needs at least eight moves', () => {
    expect(STYLE_MIN).toBe(8);
    expect(dominantStyle(many('fighting', 7))).toEqual({ style: null, count: 0, total: 7 });
    expect(dominantStyle(many('fighting', 8))).toEqual({ style: 'fighting', count: 8, total: 8 });
    expect(dominantStyle([])).toEqual({ style: null, count: 0, total: 0 });
  });

  it('names a style only with a 45% share', () => {
    // 4 of 9 is 44%: no guess. 5 of 11 is 45.5%: fighting.
    expect(dominantStyle([...many('fighting', 4), ...many('solid', 3), ...many('territory', 2)]).style).toBeNull();
    expect(dominantStyle([...many('fighting', 5), ...many('solid', 3), ...many('territory', 3)])).toEqual({ style: 'fighting', count: 5, total: 11 });
  });

  it('treats a tie as no preference', () => {
    expect(dominantStyle([...many('solid', 5), ...many('influence', 5)]).style).toBeNull();
  });

  it('only counts the most recent moves, so a preference can change', () => {
    const old = many('territory', STYLE_KEEP);
    expect(dominantStyle(old).style).toBe('territory');
    expect(dominantStyle([...old, ...many('fighting', STYLE_KEEP)]).style).toBe('fighting');
    expect(dominantStyle([...old, ...many('fighting', 30)]).style).toBeNull();
  });
});

describe('style memory', () => {
  beforeEach(() => {
    resetStyle();
    resetSettings('profile');
  });

  it('learns from repeated moves and forgets on reset', () => {
    for (let i = 0; i < 7; i++) recordStyle('influence');
    expect(learnedStyle()).toEqual({ style: null, count: 0, total: 7 });
    recordStyle('influence');
    expect(learnedStyle()).toEqual({ style: 'influence', count: 8, total: 8 });
    resetStyle();
    expect(learnedStyle()).toEqual({ style: null, count: 0, total: 0 });
  });

  it('keeps at most the last moves', () => {
    for (let i = 0; i < STYLE_KEEP + 20; i++) recordStyle('solid');
    expect(learnedStyle().total).toBe(STYLE_KEEP);
  });

  it('records a clicked move from the board before it, and ignores passes and stones', () => {
    const b = playAt(emptyBoard(19), gtpToLoc('Q16', 19))!;
    observeMove(b, gtpToLoc('D4', 19));
    expect(learnedStyle().total).toBe(1);
    observeMove(b, PASS);
    observeMove(b, gtpToLoc('Q16', 19));
    expect(learnedStyle().total).toBe(1);
  });

  it('feeds the profile; an explicit choice in Settings wins', () => {
    expect(studentProfile()).toEqual({ level: 'intermediate', style: null });
    for (let i = 0; i < 10; i++) recordStyle('fighting');
    expect(studentProfile()).toEqual({ level: 'intermediate', style: 'fighting' });
    setSetting('profile.style', 'territory');
    setSetting('profile.level', 'beginner');
    expect(studentProfile()).toEqual({ level: 'beginner', style: 'territory' });
    setSetting('profile.style', 'auto');
    expect(studentProfile().style).toBe('fighting');
  });
});
