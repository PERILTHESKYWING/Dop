import type { PlateCamera } from './kaya';

/**
 * The camera that rendered the landing's sky-and-table plate (tools/kiai-art/hero.py, view
 * `plate`, which writes it as JSON). The live board is drawn with the same camera so it sits on
 * the photographed table.
 */
export const HERO_CAM: PlateCamera = {
  loc: [-0.4, -1.16, 0.36],
  target: [-0.11, 0.52, 0.12],
  lens: 39,
  sensor: 36,
  width: 2400,
  height: 1350,
  sun: { elev: 21, azim: 160 },
  board_rot_z: -9,
};

/**
 * On a phone the hero shows this part of the plate's frame: wide enough for the board and both
 * bowls (x 1120 to 2320 of 2400), at full height. The CSS shows the plate image the same way
 * (aspect 1200 / 1350, object-position 93.3%), so the two line up.
 */
export const PHONE_X0 = 1120;
export const PHONE_W = 1200;

/**
 * Which part of the plate's full frame an `object-fit: cover` image shows in a box, given its
 * object-position (0..1). `x0`/`pw` select the image's own part of the frame (the phone crop).
 */
export function coverCrop(boxW: number, boxH: number, img: { x0: number; pw: number; ph: number }, pos: [number, number]) {
  const s = Math.max(boxW / img.pw, boxH / img.ph);
  const dw = img.pw * s, dh = img.ph * s;
  return { x: img.x0 + ((dw - boxW) * pos[0]) / s, y: ((dh - boxH) * pos[1]) / s, w: boxW / s, h: boxH / s };
}
