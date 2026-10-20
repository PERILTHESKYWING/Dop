import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SETTINGS } from '../kami/src/lib/settings';
import { BOOK_SKIN, KIAI_SKIN } from '../kami/src/ui/skin';

const pub = (p: string) => new URL(`../kami/public${p}`, import.meta.url);

describe('Kiai board styles', () => {
  const style = SETTINGS.find((s) => s.key === 'board.style');

  it('offers kaya (default), light wood, dark wood and the book diagram', () => {
    expect(style?.type).toBe('select');
    expect(style?.default).toBe('kaya');
    expect(style && 'options' in style ? style.options.map((o) => o.value) : []).toEqual(['kaya', 'shinkaya', 'dark', 'book']);
  });

  it('ships every wood texture the 3D board asks for', () => {
    for (const prefix of ['', 'shinkaya-', 'dark-']) {
      for (const face of ['top', 'front', 'side']) expect(existsSync(pub(`/kiai/3d/${prefix}kaya-${face}.webp`)), `${prefix}kaya-${face}`).toBe(true);
    }
  });

  it('ships the flat boards’ pictures', () => {
    for (const skin of [KIAI_SKIN, BOOK_SKIN]) {
      for (const f of [skin.wood, skin.shadow, ...skin.black, ...skin.white]) expect(existsSync(pub(f)), f).toBe(true);
    }
  });

  it('keeps the angled view on by default and explains it in plain words', () => {
    const tilt = SETTINGS.find((s) => s.key === 'board.tilt');
    expect(tilt?.default).toBe(true);
    expect(tilt?.label).toBe('Angled view');
  });
});
