// Pure helpers of the library's Files tab (hub/library/files.js).
import { beforeAll, describe, expect, it } from 'vitest';

let m: any;
beforeAll(async () => {
  m = await import(/* @vite-ignore */ '../hub/library/files.js' as string);
});

describe('library files helpers', () => {
  it('keeps names simple for agents', () => {
    expect(m.cleanName('IMG_1234.HEIC')).toBe('IMG_1234.HEIC');
    expect(m.cleanName('Léo walk (final)!.mp4')).toBe('Leo walk -final.mp4');
    expect(m.cleanName('../../etc/passwd')).toBe('etc-passwd');
    expect(m.cleanName('日本.png')).toBe('file.png');
    const long = m.cleanName(`${'a'.repeat(300)}.webm`);
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith('.webm')).toBe(true);
  });

  it('cleans free tags', () => {
    expect(m.cleanTags('Leo, walk cycle;  leo ,,')).toEqual(['leo', 'walk-cycle']);
    expect(m.cleanTags('')).toEqual([]);
  });

  it('spreads up to 16 frames over a clip', () => {
    expect(m.frameTimes(0)).toEqual([0]);
    expect(m.frameTimes(1)).toEqual([0.25, 0.75]);
    const t = m.frameTimes(120);
    expect(t).toHaveLength(16);
    expect(t[0]).toBeGreaterThan(0);
    expect(t[15]).toBeLessThan(120);
  });

  it('fits the contact sheet in 1568 px', () => {
    for (const [n, w, h] of [[16, 1920, 1080], [6, 1080, 1920], [1, 640, 360], [12, 400, 3000]]) {
      const g = m.sheetGrid(n, w, h);
      expect(g.cols * g.rows).toBeGreaterThanOrEqual(n);
      expect(g.cols * g.cw).toBeLessThanOrEqual(1568);
      expect(g.rows * g.ch).toBeLessThanOrEqual(1568);
    }
    expect(m.sheetGrid(16, 1920, 1080).cols).toBe(4);
  });
});
