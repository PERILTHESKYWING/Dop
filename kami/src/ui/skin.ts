import type { BoardSkin } from '../../../src/components/Board';

/**
 * Kiai's kaya board: a top-down render of masame kaya and slate and clamshell stone sprites,
 * made by tools/kiai-art/sprites.py (Blender, all procedural). Several sprites per colour so
 * neighbouring stones differ, as real ones do.
 */
const ART = '/kiai/board';
export const KIAI_SKIN: BoardSkin = {
  wood: `${ART}/wood.webp`,
  black: [0, 1, 2, 3].map((i) => `${ART}/b${i}.webp`),
  white: [0, 1, 2, 3, 4, 5].map((i) => `${ART}/w${i}.webp`),
  shadow: `${ART}/shadow.webp`,
};
