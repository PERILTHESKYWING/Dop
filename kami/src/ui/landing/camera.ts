/**
 * The landing camera, without three.js: one view per chapter and how the scroll glides between
 * them (the live board, Stage.tsx, uses it; tests check the framing in plain numbers).
 */

/** Where the board may be drawn: left, top, right, bottom, as fractions of the screen. */
export type Box = [number, number, number, number];

export interface Cam {
  elev: number;
  azim: number;
  dist: number;
  target: [number, number, number];
  fov: number;
  /** Board off centre: right (a fraction of the width) and up (of the height). */
  shift: number;
  shiftY: number;
}

/**
 * One view per chapter: the angle the camera looks from. The distance is worked out each time so
 * the whole board fills the room the words leave (`fitOrbit`), never under them and never cut
 * off. The last view comes back to the first one's angle, so the page ends where it began.
 */
interface Key {
  elev: number;
  azim: number;
  fov: number;
}
export const T = 0.055; // the board's thickness: a thick table board
// wide screens (the words on the left) and tall ones (the words below)
const WIDE: Key[] = [
  { elev: 26, azim: -16, fov: 44 },
  { elev: 50, azim: 22, fov: 40 },
  { elev: 64, azim: 36, fov: 40 },
  { elev: 84, azim: 0, fov: 38 },
  { elev: 40, azim: 24, fov: 44 },
  { elev: 30, azim: -16, fov: 44 },
];
const TALL: Key[] = [
  { elev: 30, azim: -14, fov: 42 },
  { elev: 50, azim: 18, fov: 46 },
  { elev: 64, azim: 30, fov: 46 },
  { elev: 84, azim: 0, fov: 44 },
  { elev: 38, azim: 30, fov: 48 },
  { elev: 32, azim: -14, fov: 42 },
];

// the 19×19 board's size, as kaya.ts builds it (SX, SY: line spacing; MX, MY: margins)
const SX = 0.022;
const SY = 0.0237;
const MX = (0.424 - 18 * SX) / 2;
const MY = (0.454 - 18 * SY) / 2;

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const rad = (d: number) => (d * Math.PI) / 180;

/** The camera's right, up and back axes for an orbit view (three.js lookAt with up = +y). */
export function orbitAxes(elev: number, azim: number): { x: V3; y: V3; z: V3; dir: V3 } {
  const el = rad(elev), az = rad(azim);
  const dir: V3 = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
  const z = norm(dir);
  let x = cross([0, 1, 0], z);
  if (Math.hypot(...x) < 1e-9) x = [1, 0, 0];
  x = norm(x);
  const y = cross(z, x);
  return { x, y, z, dir };
}

/**
 * KayaView.fitOrbit for the landing's 19×19 board of thickness T, in plain numbers: the distance
 * and off-centre shifts that make the whole board fill `box` on a canvas of `aspect`.
 */
export function fitOrbit(v: { elev: number; azim: number; target: V3; fov: number }, box: Box, aspect: number): { dist: number; shift: number; shiftY: number } {
  const hw = (18 * SX + 2 * MX) / 2, hl = (18 * SY + 2 * MY) / 2;
  const pts: V3[] = [];
  for (const x of [-hw, hw]) for (const y of [0, T]) for (const z of [-hl, hl]) pts.push([x, y, z]);
  const { x: ax, y: ay, z: az, dir } = orbitAxes(v.elev, v.azim);
  const t = Math.tan(rad(v.fov) / 2);
  const bounds = (dist: number) => {
    const pos: V3 = [v.target[0] + dir[0] * dist, v.target[1] + dir[1] * dist, v.target[2] + dir[2] * dist];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      const d = sub(p, pos);
      const w = -dot(d, az);
      const qx = dot(d, ax) / w / (t * aspect), qy = dot(d, ay) / w / t;
      x0 = Math.min(x0, qx); x1 = Math.max(x1, qx); y0 = Math.min(y0, qy); y1 = Math.max(y1, qy);
    }
    return { x0, x1, y0, y1 };
  };
  const bw = 2 * Math.max(0.01, box[2] - box[0]), bh = 2 * Math.max(0.01, box[3] - box[1]);
  let dist = 1;
  for (let i = 0; i < 5; i++) {
    const b = bounds(dist);
    dist *= Math.max((b.x1 - b.x0) / bw, (b.y1 - b.y0) / bh);
  }
  const b = bounds(dist);
  // the box's centre and the board's, in normalised device coordinates (y up)
  const bx = box[0] + box[2] - 1, by = 1 - (box[1] + box[3]);
  return { dist, shift: (bx - (b.x0 + b.x1) / 2) / 2, shiftY: (by - (b.y0 + b.y1) / 2) / 2 };
}

function resolve(k: Key, box: Box, aspect: number): Cam {
  const target: V3 = [0, T, 0];
  return { elev: k.elev, azim: k.azim, fov: k.fov, target, ...fitOrbit({ elev: k.elev, azim: k.azim, fov: k.fov, target }, box, aspect) };
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The camera at scroll position `p` (in chapters) on a canvas of `aspect`: it rests at each
 * chapter's view for a while on either side of it and glides between them.
 */
export function camAt(p: number, aspect: number, box: (i: number) => Box): Cam {
  const K = aspect < 0.9 ? TALL : WIDE;
  const i = Math.max(0, Math.min(K.length - 1, Math.floor(p)));
  const j = Math.min(K.length - 1, i + 1);
  const t = smooth((p - i - 0.2) / 0.6);
  const a = resolve(K[i], box(i), aspect);
  const b = t > 0 ? resolve(K[j], box(j), aspect) : a;
  return {
    elev: mix(a.elev, b.elev, t),
    azim: mix(a.azim, b.azim, t),
    dist: mix(a.dist, b.dist, t),
    target: [mix(a.target[0], b.target[0], t), mix(a.target[1], b.target[1], t), mix(a.target[2], b.target[2], t)],
    fov: mix(a.fov, b.fov, t),
    shift: mix(a.shift, b.shift, t),
    shiftY: mix(a.shiftY, b.shiftY, t),
  };
}
