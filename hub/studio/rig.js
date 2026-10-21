// Characters for the studio, drawn as turning solids. skel.js places the
// joints in 3D from the pose, body.js builds the torso, limbs, hands and shoes
// as shaded silhouettes, and this file draws the head: a skull-and-jaw solid,
// a face whose features sit on its surface (so they slide, squash and hide as
// the head turns), ears, and hair with a real hairline. Everything is then
// painted back to front. The cast spec dresses it, so a character is the same
// drawing in every shot.
import { curve, ellipse, hash, lerp, loop, mix } from './draw.js';
import { castShadow } from './render.js';
import { add, mul, skeleton, restHead } from './skel.js';
import { bodyParts, hull, solid, tube } from './body.js';

export const BASE_H = 390; // character height in stage px at height 1, scale 1
const INK_SKIN = 0.55; // how dark the inner lines on skin are (mix of skin to ink)
// The ground shadow uses a higher light than the shading, so it stays short.
const SHADOW_LIGHT = [-0.36, -0.93];
const VIEW_S = Math.sin((9 * Math.PI) / 180);
const VIEW_C = Math.cos((9 * Math.PI) / 180);

// Expressions: brows, eyes and mouth, plus the mouths used while talking.
export const FACE = {
  neutral: { brow: 0, browY: 0, eyes: 'open', mouth: 'flat', talk: ['open', 'flat', 'o'] },
  happy: { brow: -6, browY: -0.04, eyes: 'open', mouth: 'smile', talk: ['grin', 'smile', 'open'] },
  sad: { brow: 18, browY: 0, eyes: 'sad', mouth: 'frown', talk: ['open', 'frown'], tilt: 6 },
  angry: { brow: -24, browY: 0.05, eyes: 'angry', mouth: 'grit', talk: ['wide', 'grit', 'open'], fx: 'vein' },
  surprised: { brow: -4, browY: -0.12, eyes: 'wide', mouth: 'o', talk: ['wide', 'o'] },
  worried: { brow: 16, browY: -0.03, eyes: 'open', mouth: 'wavy', talk: ['open', 'wavy'], fx: 'sweat' },
  smug: { brow: -8, browY: 0, eyes: 'lidded', mouth: 'smirk', talk: ['smirk', 'open'], browOne: true },
  tired: { brow: 4, browY: 0.05, eyes: 'lidded', mouth: 'flat', talk: ['open', 'flat'], tilt: 4 },
};

const smooth = (x) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

// The face surface in head units (radius 1): a ball that narrows into the jaw.
function faceZ(u, v) {
  const q = 1 - u * u - v * v;
  return Math.sqrt(Math.max(0, q)) * (1 - 0.2 * smooth((v - 0.15) / 0.8));
}

// Hairlines per style: [angle from the front in degrees, height] knots
// (height in head units, -1 = crown, +1 = chin level), mirrored left/right.
const HAIRLINE = {
  short: [[0, -0.5], [35, -0.5], [62, -0.25], [85, 0.08], [110, 0.12], [140, 0.42], [180, 0.5]],
  spiky: [[0, -0.6], [40, -0.55], [70, -0.25], [90, 0.02], [115, 0.08], [150, 0.35], [180, 0.42]],
  curly: [[0, -0.55], [40, -0.48], [70, -0.15], [92, 0.12], [140, 0.5], [180, 0.58]],
  bob: [[0, -0.32], [48, -0.3], [62, 0.2], [80, 0.62], [180, 0.7]],
  long: [[0, -0.6], [30, -0.42], [62, -0.05], [80, 0.45], [180, 0.75]],
  bun: [[0, -0.6], [45, -0.5], [72, -0.18], [92, 0.06], [140, 0.36], [180, 0.42]],
  ponytail: [[0, -0.58], [45, -0.48], [72, -0.18], [92, 0.06], [140, 0.36], [180, 0.42]],
  // Fringe styles: the cap stops high and pointed locks hang over the forehead.
  shag: [[0, -0.5], [40, -0.48], [66, -0.2], [84, 0.45], [100, 0.62], [180, 0.62]],
  flowing: [[0, -0.5], [40, -0.48], [66, -0.2], [84, 0.45], [100, 0.62], [180, 0.62]],
};
// Locks for the fringe styles in face units: [centre u, half width, tip v, tip lean u].
const FRINGE = [[-0.66, 0.16, -0.16, 0.05], [-0.4, 0.17, -0.06, 0.07], [-0.12, 0.16, 0.1, 0.06], [0.14, 0.16, -0.08, -0.05], [0.4, 0.17, -0.02, -0.07], [0.68, 0.15, -0.18, -0.06]];
// Back hair outline for the fringe styles: length below the head centre
// (head radii), half width at the ends, and the end lengths of each lock.
const BACK = {
  // side: the left edge from the bottom up as [half width, height]; heights
  // over 0.3 are shares of len (choppy layers stick out, then tuck in).
  shag: { len: 1.75, w: 1.0, ends: [0.86, 1.0, 0.8, 0.95, 0.78, 1.0, 0.84], side: [[1.06, 0.97], [0.96, 0.78], [1.16, 0.62], [1.06, 0.48], [1.14, 0.34], [1.08, 0.1]] },
  flowing: { len: 3.1, w: 0.98, ends: [0.92, 1.0, 0.95, 0.99, 0.93, 1.0], side: [[1.02, 0.97], [1.06, 0.6], [1.16, 0.34], [1.1, 0.1]] },
};
const knot = (tab, a) => {
  const x = Math.min(180, Math.abs(a));
  for (let i = 1; i < tab.length; i++)
    if (x <= tab[i][0]) {
      const [a0, v0] = tab[i - 1];
      const [a1, v1] = tab[i];
      return lerp(v0, v1, smooth((x - a0) / (a1 - a0 || 1)));
    }
  return tab[tab.length - 1][1];
};

// Draw one character. pen: a child Pen for this character; ch: cast entry;
// pose: see skel.js / moves.js; at: { x, ground, scale, facing }.
export function drawCharacter(pen, ch, pose, { x, ground, scale = 1, facing = 1 }) {
  const H = BASE_H * ch.height * scale;
  const sk = skeleton(ch, pose, H);
  const p = sk.p;
  const Pj = sk.projector({ x, ground, facing });
  const ink = pen.style.ink;
  const line = pen.style.line;
  const skinLine = mix(ch.skin, ink, INK_SKIN);
  const face = FACE[p.face] || FACE.neutral;
  const r = sk.r;
  const fH = sk.frames.head;

  // Head space: (u, v, w) in head radii -> stage point; and how much a
  // surface normal faces the camera (below 0 it is round the back).
  const HP = (q) => Pj(add(sk.head, fH(mul(q, r))));
  const facingCam = (nrm) => {
    const w = fH(nrm);
    const l = Math.hypot(w[0], w[1], w[2]) || 1;
    return (-w[1] * VIEW_S + w[2] * VIEW_C) / l;
  };
  // A point drawn on the face: (u, v) across it, h lifted off the surface.
  const onFace = (u, v, h = 0) => {
    let [a, b] = [u, v];
    const m = Math.hypot(a, b);
    if (m > 0.995) [a, b] = [(a / m) * 0.995, (b / m) * 0.995];
    const z = faceZ(a, b);
    return HP([u * (1 + h), v * (1 + h), z * (1 + h)]);
  };
  const F = (pts, h = 0) => pts.map(([u, v]) => onFace(u, v, h));
  const seen = (u, v) => facingCam([u, v, faceZ(u, v) + 0.05]);

  const n0 = pen.ops.length;
  const { parts, neck } = bodyParts(pen, ch, sk, Pj, facing);
  const headZ = Pj(sk.head)[2];

  // The cranium on screen: centre, which way is up, hair radius.
  const C = [0, -0.06, -0.05]; // centre of the cranium ball
  const style = ch.hairStyle;
  const fringe = style === 'shag' || style === 'flowing';
  const hs = style === 'curly' ? 1.13 : style === 'bob' || fringe ? 1.09 : 1.06;
  const Cp = HP(C);
  const upP = HP([C[0], C[1] - 1, C[2]]);
  const up = Math.atan2(upP[1] - Cp[1], upP[0] - Cp[0]);
  const rimR = r * hs * (Cp[3] || 1);

  // Fringe styles, back: a choppy mass behind the head and shoulders drawn
  // in screen space round the skull (it reads the same from any turn), with
  // pointed lock ends that swing, a few flow lines and optional ombre ends.
  const backHair = () => {
    const spec = BACK[style];
    const d = [-Math.cos(up), -Math.sin(up)];
    const ac = [d[1], -d[0]];
    const sway = p.hairSwing || 0;
    const at = (a, b) => [Cp[0] + (ac[0] * a + d[0] * b + ac[0] * sway * 0.18 * Math.max(0, b)) * rimR, Cp[1] + (ac[1] * a + d[1] * b + ac[1] * sway * 0.18 * Math.max(0, b)) * rimR];
    const L = spec.len;
    const n = spec.ends.length;
    const pts = [];
    // Left side up, over the top, right side down, then the lock ends right to left.
    for (const [a, b] of spec.side) pts.push(at(-a, b > 0.3 ? b * L : b));
    for (let k = 1; k < 10; k++) {
      const t = Math.PI * (1 - k / 10);
      pts.push(at(Math.cos(t) * 0.97, -Math.sin(t) * 0.97)); // hidden under the cap
    }
    for (const [a, b] of [...spec.side].reverse()) pts.push(at(a, b > 0.3 ? b * L : b));
    for (let i = n - 1; i >= 0; i--) {
      const a = -spec.w + (2 * spec.w * (i + 0.5)) / n;
      const flick = style === 'shag' ? Math.sign(a) * Math.abs(a) ** 2 * 0.12 : 0;
      pts.push(at(a + flick, L * spec.ends[i]));
      if (i) pts.push(at(-spec.w + (2 * spec.w * i) / n, L * (style === 'shag' ? 0.7 : 0.84)));
    }
    pts.push(pts[0]);
    const col = mix(ch.hair, ink, 0.12);
    solid(pen, 'hairB', pts, col, { width: line * 0.9, slip: ch.hair2 ? 0 : 1 });
    if (ch.hair2) {
      // Ombre in soft steps toward the lock ends.
      for (let k = 0; k < 6; k++) {
        const f = 0.45 + k * 0.08;
        pen.shade('hairTipB' + k, [at(-3, L * f), at(3, L * f), at(3, L * 1.2), at(-3, L * 1.2)], pts, { color: ch.hair2, alpha: 0.18 });
      }
      pen.stroke('hairB', pts, { width: line * 0.9, closed: true });
    }
    for (const a of [-0.7, 0.15, 0.75]) pen.stroke('flowB' + a, curve([at(a * 0.9, 0.6), at(a, L * 0.5), at(a * 1.05, L * 0.78)], 4), { width: line * 0.4, color: mix(col, ink, 0.45) });
  };

  // ---- the head as one group of layers ----
  const drawHead = () => {

    // Back hair: masses behind the skull (bob sides, long fall, curls).
    const sphere = (c, rad, from = -1, to = 1, n = 10) => {
      const out = [];
      for (let i = 0; i <= n; i++) {
        const v = lerp(from, to, i / n);
        const rho = Math.sqrt(Math.max(0, 1 - v * v));
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * Math.PI * 2;
          out.push(add(c, [Math.sin(a) * rho * rad, v * rad, Math.cos(a) * rho * rad]));
        }
      }
      return out;
    };
    const back = [];
    if (style === 'bob') {
      back.push(...sphere(C, hs, -1, 0.3));
      for (let k = 0; k < 16; k++) {
        const a = Math.PI * (0.32 + (1.36 * k) / 15);
        back.push([Math.sin(a) * 1.16, 0.78, -0.05 + Math.cos(a) * 1.0]);
      }
    } else if (style === 'long') {
      back.push(...sphere(C, hs, -1, 0.3));
      const sway = p.hairSwing || 0;
      for (const [v, w, d] of [[0.9, 1.08, 0.85], [1.7, 1.1, 0.7], [2.45, 1.0, 0.5]])
        for (let k = 0; k < 14; k++) {
          const a = Math.PI * (0.38 + (1.24 * k) / 13);
          back.push([Math.sin(a) * w + sway * (v - 0.5) * 0.25, v, -0.2 + Math.cos(a) * d]);
        }
    } else if (style === 'curly') back.push(...sphere(C, hs * 1.04, -1, 0.55));
    const behindParts = [];
    const frontParts = [];
    const bun = () => {
      const c = [0, -0.9, -0.62];
      const pts = sphere(c, 0.4, -1, 1, 6).map(HP);
      return { z: HP(c)[2], draw: () => solid(pen, 'bun', loop(hull(pts), 2), ch.hair, { width: line * 0.85 }) };
    };
    const tail = () => {
      const sway = p.hairSwing || 0;
      const a = add(sk.head, fH(mul([0, -0.42, -1.02], r)));
      const b = add(sk.head, fH(mul([sway * 0.5, 0.45, -1.3], r)));
      const c = add(sk.head, fH(mul([sway * 1.1, 1.35, -1.15], r)));
      const t1 = tube(Pj, a, b, (t) => (0.3 - 0.06 * t) * r);
      const t2 = tube(Pj, b, c, (t) => (0.27 - 0.15 * t) * r);
      return { z: HP([0, 0.4, -1.25])[2], draw: () => { solid(pen, 'tail2', t2.pts, ch.hair, { axis: t2.axis, width: line * 0.8 }); solid(pen, 'tail1', t1.pts, ch.hair, { axis: t1.axis, width: line * 0.8 }); } };
    };
    const extra = style === 'bun' ? bun() : style === 'ponytail' ? tail() : null;
    if (extra) (extra.z < headZ ? behindParts : frontParts).push(extra.draw);

    behindParts.forEach((d) => d());
    if (back.length) solid(pen, 'hairB', loop(hull(back.map(HP)), 2), mix(ch.hair, ink, 0.12), { width: line * 0.9 });

    // Ears: thin when seen from the front, full in profile; the far one behind the skull.
    const ear = (s) => {
      const pts = [];
      for (let k = 0; k < 14; k++) {
        const t = (k / 14) * Math.PI * 2;
        pts.push([s * (0.92 + 0.14 * (0.5 + 0.5 * Math.cos(t))), 0.12 - 0.21 * Math.cos(t), -0.1 + 0.14 * Math.sin(t)]);
      }
      const pr = pts.map(HP);
      const z = HP([s * 1.0, 0.12, -0.1])[2];
      const draw = () => {
        solid(pen, 'ear' + s, loop(hull(pr), 2), ch.skin, { width: line * 0.7, round: 0.6 });
        if (facingCam([s, 0, -0.1]) > 0.15) pen.stroke('earin' + s, curve([[s * 1.0, 0.0, -0.06], [s * 1.04, 0.14, -0.12], [s * 0.99, 0.26, -0.08]].map(HP), 4), { width: line * 0.45, color: skinLine });
      };
      return { z, draw };
    };
    const ears = [ear(-1), ear(1)];
    const hideEars = style === 'bob' || style === 'long' || style === 'curly' || fringe;
    if (!hideEars) ears.filter((e) => e.z < headZ).forEach((e) => e.draw());

    // The skull and jaw: the hull of the cranium, the face and the jaw line.
    const pts = [];
    for (const q of sphere(C, 1, -1, 0.25, 8)) pts.push(q);
    for (let i = -6; i <= 6; i++)
      for (let j = -2; j <= 8; j++) {
        const u = i / 6.4;
        const v = j / 9.4;
        if (u * u + v * v < 1) pts.push([u, v, faceZ(u, v)]);
      }
    // A "v" jaw narrows earlier to a small, slightly pointed chin.
    const vJaw = ch.jaw === 'v';
    const jawRings = vJaw ? [[0.56, 0.68, 0.56, -0.08], [0.8, 0.36, 0.3, 0.14]] : [[0.6, 0.72, 0.6, -0.08], [0.84, 0.42, 0.36, 0.14]];
    for (const [y, w, d, zc] of jawRings)
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        pts.push([Math.cos(a) * w, y, zc + Math.sin(a) * d]);
      }
    if (vJaw) pts.push([0, 1.0, 0.38], [0.11, 0.98, 0.36], [-0.11, 0.98, 0.36]);
    else pts.push([0, 0.99, 0.4], [0.18, 0.97, 0.36], [-0.18, 0.97, 0.36]);
    const skull = loop(hull(pts.map(HP)), 2);
    // A soft shadow under the jaw on the neck.
    if (neck) pen.shade('chin', skull.map(([px, py]) => [px, py + r * 0.22]), neck, { alpha: 0.18 });
    solid(pen, 'head', skull, ch.skin, { width: line, round: 0.5 });
    if (!hideEars) ears.filter((e) => e.z >= headZ).forEach((e) => e.draw());

    // ---- face ----
    const big = ch.eyes === 'anime';
    const lashes = big || ch.extras.includes('lashes');
    const ey = (big ? 0.12 : 0.06) + (p.eyeY || 0);
    const gap = big ? 0.37 : 0.35;
    const g = Array.isArray(p.gaze) ? p.gaze : [p.gaze ?? 0.15, 0];
    if (ch.extras.includes('blush') || p.fx === 'blush')
      for (const sx of [-1, 1]) if (seen(sx * 0.5, 0.3) > 0.1) pen.fill('blush' + sx, F(ellipse(sx * 0.52, ey + 0.27, 0.15, 0.075, { n: 12 })), mix(ch.skin, '#ff6f7d', 0.4), { slip: 0.2, alpha: 0.75 });
    // Hatched blush: three short slanted strokes on each cheek.
    if (ch.extras.includes('blushlines') || p.fx === 'blush')
      for (const sx of [-1, 1])
        for (let i = 0; i < 3; i++) {
          const u = sx * (0.42 + i * 0.08);
          if (seen(u, ey + 0.27) > 0.15) pen.stroke('hatch' + sx + i, F([[u + 0.035, ey + 0.21], [u - 0.035, ey + 0.33]], 0.02), { width: line * 0.45, color: mix('#e0606e', ink, 0.25) });
        }
    if (ch.extras.includes('freckles'))
      for (let i = 0; i < 6; i++) {
        const sx = i < 3 ? -1 : 1;
        const u = sx * (0.44 + (i % 3) * 0.08);
        const v = ey + 0.2 + ((i * 7) % 3) * 0.05;
        if (seen(u, v) > 0.12) {
          const [qx, qy] = onFace(u, v);
          pen.dot('frk' + i, qx, qy, 0.022 * r, skinLine);
        }
      }

    // Eyes: a white with lids, an iris clipped by the lids, a catch light.
    const kind = p.eyes || face.eyes;
    const blink = p.blink && kind !== 'wide';
    const irisC = ch.eyeColor || (ch.hair2 && big ? mix(ch.hair2, '#3b2a1c', 0.25) : mix(ch.hair, '#3b2a1c', 0.55));
    for (const sx of [-1, 1]) {
      const ex = sx * gap;
      const vis = seen(ex, ey);
      if (vis < 0.08) continue;
      const ew = big ? 0.2 : 0.165;
      const eh = big ? 0.25 : ch.eyes === 'oval' ? 0.17 : 0.14;
      const at = (pts) => F(pts.map(([a, b]) => [ex + a, ey + b]));
      if (blink || kind === 'closed') {
        pen.stroke('eye' + sx, curve(at([[-ew * 1.05, 0.0], [0, eh * 0.45], [ew * 1.05, 0]]), 4), { width: line * 0.9 });
        continue;
      }
      if (kind === 'happy') {
        pen.stroke('eye' + sx, curve(at([[-ew, eh * 0.35], [0, -eh * 0.65], [ew, eh * 0.35]]), 4), { width: line * 0.95 });
        continue;
      }
      let open = { wide: 1.25, lidded: 0.5, sad: 0.85, angry: 0.78 }[kind] ?? 1;
      if (ch.eyes === 'sleepy') open = Math.min(open, 0.62);
      // Lid slant: + lowers the inner corner (angry), - the outer (sad).
      const slant = kind === 'angry' ? 0.55 : kind === 'sad' ? -0.5 : 0;
      const topY = (a) => {
        const k = 1 - (a / ew) ** 2;
        const inner = -sx * a / ew; // +1 at the inner corner
        const drop = slant > 0 ? (slant * (inner + 1)) / 2 : (-slant * (1 - inner)) / 2;
        return -eh * open * Math.pow(Math.max(0, k), 0.65) + eh * 0.5 * drop;
      };
      const botY = (a) => eh * 0.9 * Math.pow(Math.max(0, 1 - (a / ew) ** 2), 0.8);
      const N = 12;
      const upper = [];
      const lower = [];
      for (let i = 0; i <= N; i++) {
        const a = -ew + (2 * ew * i) / N;
        upper.push([a, topY(a)]);
        lower.push([a, botY(a)]);
      }
      const white = [...upper, ...[...lower].reverse().slice(1, -1)];
      pen.fill('white' + sx, at(white), '#fbf8f2', { slip: 0.15 });
      // Iris: a disc moved by the gaze, clamped inside the lids.
      const ir = eh * (big ? (kind === 'wide' ? 0.6 : 0.8) : kind === 'wide' ? 0.62 : ch.eyes === 'dot' ? 0.9 : 0.82);
      const gx = Math.max(-1, Math.min(1, g[0])) * ew * 0.42;
      const gy = Math.max(-1, Math.min(1, g[1] || 0)) * eh * 0.4 + eh * 0.08;
      const clampLid = ([a, b]) => {
        const aa = Math.max(-ew * 0.96, Math.min(ew * 0.96, a));
        return [aa, Math.max(topY(aa) + 0.004, Math.min(botY(aa) - 0.004, b))];
      };
      const irisPts = ellipse(gx, gy, ir * (big ? 0.78 : 0.9), ir, { n: 16 }).map(clampLid);
      pen.fill('iris' + sx, at(irisPts), ch.eyes === 'dot' ? mix(irisC, ink, 0.55) : irisC, { slip: 0 });
      // Big eyes: the top of the iris in the lid's shadow, a ringed edge.
      if (big) pen.fill('irisTop' + sx, at(ellipse(gx, gy - ir * 0.45, ir * 0.74, ir * 0.55, { n: 14 }).map(clampLid)), mix(irisC, ink, 0.5), { slip: 0 });
      pen.fill('pupil' + sx, at(ellipse(gx, gy, ir * (big ? 0.34 : 0.45), ir * 0.5, { n: 12 }).map(clampLid)), ink, { slip: 0 });
      if (big) pen.stroke('irisRim' + sx, at(irisPts), { width: line * 0.45, closed: true });
      const hl = clampLid([gx - ir * 0.35, gy - ir * 0.4]);
      const [hx, hy] = onFace(ex + hl[0], ey + hl[1]);
      pen.dot('glint' + sx, hx, hy, ir * r * (big ? 0.3 : 0.24) * Math.max(0.5, vis), '#ffffff');
      if (big) {
        const h2 = clampLid([gx + ir * 0.32, gy + ir * 0.45]);
        const [kx, ky] = onFace(ex + h2[0], ey + h2[1]);
        pen.dot('glint2' + sx, kx, ky, ir * r * 0.12 * Math.max(0.5, vis), '#ffffff');
      }
      // Upper lid: the strong line, with a small flick at the outer corner.
      const flick = [sx * ew * 1.15, topY(sx * ew) - eh * 0.15];
      pen.stroke('lid' + sx, at(sx > 0 ? [...upper, flick] : [flick, ...upper]), { width: line * (lashes ? 1.6 : 1.05) });
      if (lashes) {
        // Two lash flicks off the outer corner and a short lower lash.
        const o = [sx * ew, topY(sx * ew)];
        pen.stroke('lashA' + sx, at([[o[0] - sx * ew * 0.15, o[1] - eh * 0.05], [o[0] + sx * ew * 0.32, o[1] - eh * 0.42]]), { width: line * 0.7 });
        pen.stroke('lashB' + sx, at([[o[0] - sx * ew * 0.05, o[1] + eh * 0.12], [o[0] + sx * ew * 0.4, o[1] - eh * 0.06]]), { width: line * 0.6 });
        pen.stroke('lowLash' + sx, at(lower.slice(N - 4, N).map(([a, b]) => [sx > 0 ? a : -a, b])), { width: line * 0.6 });
      } else pen.stroke('low' + sx, at(lower.slice(3, -2)), { width: line * 0.4, color: skinLine });
      if (open < 0.7) pen.stroke('crease' + sx, curve(at([[-ew * 0.9, topY(-ew * 0.9) - 0.05], [0, topY(0) - 0.07], [ew * 0.9, topY(ew * 0.9) - 0.05]]), 3), { width: line * 0.4, color: skinLine });
    }
    if (ch.extras.includes('glasses')) {
      for (const sx of [-1, 1]) if (seen(sx * gap, ey) > 0.05) pen.stroke('glass' + sx, F(ellipse(sx * gap, ey, 0.21, 0.17, { n: 18 }), 0.1), { width: line * 0.7, closed: true });
      pen.stroke('bridge', curve(F([[-gap + 0.21, ey - 0.02], [0, ey - 0.07], [gap - 0.21, ey - 0.02]], 0.12), 3), { width: line * 0.6 });
    }

    // Nose: a small turn of line that sticks out of the face in profile
    // (big eyes get a tiny tick, as in the anime look).
    if (big) pen.stroke('nose', [onFace(0.035, 0.29, 0.08), onFace(-0.01, 0.325, 0.07)], { width: line * 0.6, color: skinLine });
    else pen.stroke('nose', curve([onFace(0.03, 0.14, 0.02), onFace(0.07, 0.28, 0.13), onFace(0.0, 0.335, 0.08), onFace(-0.07, 0.31, 0.03)], 4), { width: line * 0.7, color: skinLine });

    // Mouth (same shapes as before, now on the face surface).
    {
      const my = 0.5;
      const w = 0.34;
      const m = p.mouth || face.mouth;
      const at = (pts) => F(pts.map(([u, v]) => [u, my + v]));
      const dark = '#6b2a2a';
      const lw = { width: line * 0.9 };
      if (seen(0, my) > 0.05) {
        if (m === 'smile') pen.stroke('mouth', curve(at([[-w / 2, -0.03], [0, 0.09], [w / 2, -0.03]]), 4), lw);
        else if (m === 'frown') pen.stroke('mouth', curve(at([[-w / 2, 0.07], [0, -0.04], [w / 2, 0.07]]), 4), lw);
        else if (m === 'flat') pen.stroke('mouth', at([[-w * 0.38, 0.01], [w * 0.38, -0.01]]), lw);
        else if (m === 'smirk') pen.stroke('mouth', curve(at([[-w * 0.4, 0.03], [w * 0.1, 0.05], [w * 0.5, -0.07]]), 4), lw);
        else if (m === 'wavy') pen.stroke('mouth', curve(at([[-w / 2, 0.02], [-w / 4, -0.03], [0, 0.02], [w / 4, -0.03], [w / 2, 0.02]]), 4), lw);
        else if (m === 'grit') {
          pen.shape('mouth', at(loop([[-w / 2, -0.04], [w / 2, -0.04], [w / 2, 0.06], [-w / 2, 0.06]], 4)), '#ffffff', { width: line * 0.8 });
          pen.stroke('teeth', at([[-w / 2, 0.01], [w / 2, 0.01]]), { width: line * 0.5 });
        } else {
          const [rx, ry, dy] = { grin: [w * 0.55, 0.13, 0.02], open: [w * 0.3, 0.08, 0.02], wide: [w * 0.42, 0.17, 0.04], o: [w * 0.18, 0.12, 0.02] }[m] || [w * 0.3, 0.08, 0];
          const pts = m === 'grin' ? loop([[-rx, -0.04], [rx, -0.04], [rx * 0.6, ry * 0.8], [0, ry], [-rx * 0.6, ry * 0.8]], 5) : ellipse(0, dy, rx, ry, { n: 14 });
          pen.shape('mouth', at(pts), dark, { width: line * 0.8, slip: 0.2 });
          if (m === 'grin') pen.fill('teethTop', at(loop([[-rx * 0.85, -0.03], [rx * 0.85, -0.03], [rx * 0.7, 0.02], [-rx * 0.7, 0.02]], 3)), '#fbf8f2', { slip: 0 });
          if (m === 'grin' || m === 'wide') pen.fill('tongue', at(ellipse(0, m === 'grin' ? ry * 0.6 : dy + ry * 0.55, rx * 0.45, ry * 0.28, { n: 10 })), '#d9646a', { slip: 0 });
        }
      }
    }
    // Lips: a soft tint under the mouth line (only for closed mouths).
    if (ch.extras.includes('lips') && seen(0, 0.55) > 0.05 && ['smile', 'flat', 'smirk', 'frown', 'wavy'].includes(p.mouth || face.mouth))
      pen.stroke('lip', curve(F([[-0.07, 0.565], [0, 0.585], [0.07, 0.565]]), 3), { width: line * 0.9, color: mix(ch.skin, '#d9646a', 0.55) });
    if (ch.extras.includes('beard')) solid(pen, 'beard', loop(F([[-0.97, 0.12], [-0.6, 0.66], [0, 1.0], [0.6, 0.66], [0.97, 0.12], [0.62, 0.42], [0.2, 0.66], [-0.2, 0.66], [-0.62, 0.42]]), 4), ch.hair, { width: line * 0.85, round: 0.5 });

    // ---- hair on the head: the visible hairline plus the skull's rim over the top ----
    if (style !== 'bald') {
      const tab = HAIRLINE[style] || HAIRLINE.short;
      const tufts = style === 'short' || style === 'spiky' || style === 'curly';
      const part = 18;
      const loopPts = [];
      for (let a = -180; a < 180; a += 5) {
        let v = knot(tab, a - (style === 'long' ? part : 0));
        if (tufts && Math.abs(a) < 58) v += (style === 'spiky' ? 0.1 : 0.06) * Math.abs(((a + 300) / 13) % 2 - 1);
        const rho = Math.sqrt(Math.max(0.01, 1 - v * v));
        const rad = (deg) => (deg * Math.PI) / 180;
        loopPts.push({ q: add(C, [Math.sin(rad(a)) * rho * hs, v * hs, Math.cos(rad(a)) * rho * hs]), vis: facingCam([Math.sin(rad(a)) * rho, v, Math.cos(rad(a)) * rho]) });
      }
      // The longest run of visible hairline.
      const n = loopPts.length;
      let best = [0, -1];
      for (let i = 0; i < n; i++) {
        if (!(loopPts[i].vis > 0) || loopPts[(i - 1 + n) % n].vis > 0) continue;
        let j = i;
        while (loopPts[(j + 1) % n].vis > 0 && j - i < n) j++;
        if (j - i > best[1] - best[0]) best = [i, j];
      }
      const allSeen = loopPts.every((q) => q.vis > 0);
      const lumpy = (a) => (style === 'spiky' ? 0.3 * Math.max(0, Math.cos((a - up) * 7)) ** 3 : style === 'curly' ? 0.05 * Math.cos((a - up) * 11) : 0);
      const rimPt = (a) => {
        const rr = rimR * (1 + lumpy(a) * smooth(1 - Math.abs(Math.atan2(Math.sin(a - up), Math.cos(a - up))) / 2.3));
        return [Cp[0] + Math.cos(a) * rr, Cp[1] + Math.sin(a) * rr];
      };
      let cap;
      if (allSeen) cap = loopPts.map((q) => HP(q.q));
      else if (best[1] < best[0]) cap = Array.from({ length: 48 }, (_, k) => rimPt((k / 48) * Math.PI * 2));
      else {
        const run = [];
        for (let k = best[0]; k <= best[1]; k++) run.push(HP(loopPts[k % n].q));
        const a0 = Math.atan2(run[0][1] - Cp[1], run[0][0] - Cp[0]);
        const a1 = Math.atan2(run[run.length - 1][1] - Cp[1], run[run.length - 1][0] - Cp[0]);
        // Go round from the run's end back to its start the way that passes over the top.
        const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const ccw = norm(a0 - a1);
        const viaTop = norm(up - a1) < ccw;
        const span = viaTop ? ccw : ccw - 2 * Math.PI;
        const steps = Math.max(8, Math.ceil(Math.abs(span) / 0.12));
        const arc = [];
        for (let k = 1; k < steps; k++) arc.push(rimPt(a1 + (span * k) / steps));
        cap = [...run, ...arc];
      }
      if (cap.length > 3) {
        solid(pen, 'hairF', loop(cap.filter((_, i) => i % 2 === 0), 3), ch.hair, { width: line, round: 0.9 });
        // A few strands following the flow from the crown.
        for (const a of [-40, -8, 26]) {
          const v1 = knot(tab, a) - 0.12;
          const pts3 = [-0.92, (v1 - 0.92) / 2, v1].map((v, i) => {
            const rho = Math.sqrt(Math.max(0.01, 1 - v * v));
            const aa = ((a + (i - 1) * 6) * Math.PI) / 180;
            return { q: add(C, [Math.sin(aa) * rho * hs * 0.99, v * hs, Math.cos(aa) * rho * hs * 0.99]), vis: facingCam([Math.sin(aa) * rho, v, Math.cos(aa) * rho]) };
          });
          if (pts3.every((q) => q.vis > 0.15)) pen.stroke('strand' + a, curve(pts3.map((q) => HP(q.q)), 5), { width: line * 0.45, color: mix(ch.hair, ink, 0.5) });
        }
      }
      if (fringe) fringeLocks();
    } else {
      pen.stroke('strand', curve([[-0.1, -1.0, 0.1], [0.05, -1.12, 0.05], [0.25, -1.04, 0.0]].map(HP), 4), { width: line * 0.6 });
    }

    // Brows over the hair (cartoon brows show through a fringe): the inner end tilts with the feeling.
    for (const sx of [-1, 1]) {
      const ex = sx * gap;
      if (seen(ex, ey - 0.3) < 0.05) continue;
      const by = ey - 0.33 + face.browY + (p.browUp || 0);
      const b = ((face.brow * Math.PI) / 180) * (face.browOne && sx < 0 ? 0.2 : 1);
      const inner = [ex - sx * 0.13, by - Math.sin(b) * 0.17];
      const outer = [ex + sx * 0.16, by + Math.sin(b) * 0.17 - (face.browOne && sx > 0 ? 0.07 : 0)];
      pen.stroke('brow' + sx, curve(F([inner, [(inner[0] + outer[0]) / 2, (inner[1] + outer[1]) / 2 - 0.035], outer], 0.06), 4), { width: line * 1.25 });
    }

    if (ch.extras.includes('ahoge') && !ch.extras.includes('cap')) {
      // One springy strand off the crown; it bounces a little between drawings.
      const b = (pen.drawing % 3) * 0.03 + (p.hairSwing || 0) * 0.2;
      const q = [[0.04, -1.02, 0.12], [0.12, -1.32, 0.1], [0.36 + b, -1.5, 0.04], [0.42 + b, -1.36, 0.02], [0.26 + b, -1.3, 0.04]];
      pen.stroke('ahoge', curve(q.map((x) => HP([x[0], x[1] * hs, x[2]])), 5), { width: line * 0.8 });
    }
    if (ch.extras.includes('cap')) {
      const capC = mix(ch.top, ink, 0.25);
      const ring = [];
      for (let a = -180; a < 180; a += 10) {
        const rad = (a * Math.PI) / 180;
        const v = -0.36;
        const rho = Math.sqrt(1 - v * v);
        ring.push(add(C, [Math.sin(rad) * rho * 1.09, v * 1.09, Math.cos(rad) * rho * 1.09]));
      }
      const dome = sphere(C, 1.1, -1, -0.36, 5);
      solid(pen, 'cap', loop(hull([...ring, ...dome].map(HP)), 2), capC, { width: line, round: 0.9 });
      const brim = [];
      for (let k = 0; k <= 12; k++) {
        const a = Math.PI * (k / 12);
        brim.push([Math.cos(a) * 0.95, -0.38, 0.25 + Math.sin(a) * 0.95], [Math.cos(a) * 0.9, -0.43, 0.2 + Math.sin(a) * 0.5]);
      }
      solid(pen, 'brim', loop(hull(brim.map(HP)), 2), mix(ch.top, ink, 0.38), { width: line * 0.9, round: 0.4 });
    }
    if (ch.extras.includes('bow')) {
      const c = [0.5, -0.92, 0.15];
      solid(pen, 'bowL', loop(hull([[0.5, -0.92, 0.2], [0.18, -1.2, 0.05], [0.15, -0.78, 0.2]].map(HP)), 4), '#e85d75', { width: line * 0.8, round: 0.5 });
      solid(pen, 'bowR', loop(hull([[0.5, -0.92, 0.2], [0.9, -1.12, 0.0], [0.82, -0.68, 0.2]].map(HP)), 4), '#e85d75', { width: line * 0.8, round: 0.5 });
      const [kx, ky] = HP(c);
      pen.dot('bowK', kx, ky, 0.07 * r, mix('#e85d75', ink, 0.3));
    }
    frontParts.forEach((d) => d());
    effects();

    // Fringe styles, front: pointed locks over the forehead and two at each
    // side framing the face, laid on the face surface so they turn with it.
    function fringeLocks() {
      // A pointed lock from control points [a, v]; map turns them into stage points.
      const lock = (id, ctl, map, tipV, tips) => {
        const edge = [...curve(ctl.slice(0, 3), 4), ...curve(ctl.slice(2), 4).slice(1)];
        const pts = edge.map(map);
        pen.fill(id, pts, ch.hair, { slip: 0.3 });
        if (tips) {
          const tip = edge.filter(([, v]) => v > tipV).map(map);
          if (tip.length > 2) pen.shade(id + 't', tip, pts, { color: ch.hair2, alpha: 0.85 });
        }
        pen.stroke(id, pts, { width: line * 0.8 });
      };
      const shape = (c, w, vb, vt, lean) => [[c - w, vb], [c - w * 0.75 + lean * 0.4, vb * 0.4 + vt * 0.6], [c + lean, vt], [c + w * 0.6 + lean * 0.4, vb * 0.45 + vt * 0.55], [c + w, vb]];
      // Fringe: on the face surface, lifted a little.
      FRINGE.forEach(([c, w, vt, lean], i) => {
        if (seen(c, (vt - 0.62) / 2) >= 0.05) lock('fr' + i, shape(c, w, -0.62, vt, lean), ([u, v]) => onFace(u, v, 0.1), 9, false);
      });
      // Side locks: hung in 3D from the temples, turned along the head's
      // curve, so they frame the face from the front and stay locks at 3/4.
      const sideEnd = style === 'flowing' ? 1.05 : 0.88;
      for (const sx of [-1, 1])
        for (const [k, deg, w, vb, vt, lean] of [[0, 60, 0.2, -0.3, sideEnd, -0.1], [1, 78, 0.16, -0.1, sideEnd * 0.72, 0.05]]) {
          const th = (sx * deg * Math.PI) / 180;
          const nrm = [Math.sin(th), 0, Math.cos(th)];
          if (facingCam(nrm) < 0.02) continue;
          const tg = [Math.cos(th) * sx, 0, -Math.sin(th) * sx];
          const map = ([a, v]) => {
            const R = hs * (1.03 + 0.06 * Math.max(0, (v - vb) / (vt - vb)));
            return HP(add(C, [nrm[0] * R + tg[0] * a, v * hs, nrm[2] * R + tg[2] * a]));
          };
          lock('side' + k + sx, shape(0, w, vb, vt, lean * sx), map, vb + (vt - vb) * 0.62, !!ch.hair2);
        }
    }
  };

  const effects = () => {
    const fxk = p.fx || face.fx || (ch.extras.includes('sweat') ? 'sweat' : null);
    const d = pen.drawing;
    const hc = HP([0, 0, 0]);
    // Screen-space marks around the head, on the side it faces.
    const S = (u, v) => [hc[0] + facing * u * r, hc[1] + v * r];
    if (fxk === 'vein') {
      const [vx, vy] = onFace(0.55, -0.6, 0.05);
      for (let i = 0; i < 4; i++) {
        const a = ((45 + i * 90) * Math.PI) / 180;
        const s = (0.12 + (d % 2) * 0.02) * r;
        pen.stroke('vein' + i, [[vx + Math.cos(a) * s * 0.4, vy + Math.sin(a) * s * 0.4], [vx + Math.cos(a + 0.5) * s * 1.3, vy + Math.sin(a + 0.5) * s * 1.3]], { width: line * 0.9, color: '#d1453b' });
      }
    }
    if (fxk === 'sweat') {
      const [sx, sy] = S(-0.95, -0.4 + (d % 3) * 0.06);
      pen.shape('sweat', loop([[sx, sy - 0.2 * r], [sx + 0.09 * r, sy + 0.02 * r], [sx, sy + 0.1 * r], [sx - 0.09 * r, sy + 0.02 * r]], 5), '#9fd3f2', { width: line * 0.6 });
    }
    if (fxk === 'tears')
      for (const sxx of [-1, 1]) {
        const ex = sxx * 0.36;
        if (seen(ex, 0.2) < 0.1) continue;
        const run = 0.25 + ((d + (sxx > 0 ? 1 : 0)) % 3) * 0.18;
        pen.stroke('tear' + sxx, curve(F([[ex, 0.16], [ex + sxx * 0.05, 0.16 + run * 0.6], [ex + sxx * 0.02, 0.16 + run * 1.2]], 0.03), 4), { width: line * 1.6, color: '#7cc3ee', round: true });
      }
    if (fxk === 'dots')
      for (let i = 0; i < 3; i++) {
        if (i > d % 4) break;
        const [qx, qy] = S(1.1 + i * 0.32, -1.2 - i * 0.28);
        pen.shape('think' + i, ellipse(qx, qy, (0.06 + i * 0.03) * r, (0.05 + i * 0.03) * r, { n: 10 }), '#ffffff', { width: line * 0.6 });
      }
    if (fxk === 'lines')
      for (let i = 0; i < 3; i++) {
        const a = ((-60 + i * 30) * Math.PI) / 180;
        pen.stroke('emph' + i, [S(Math.sin(a) * 1.4, -Math.cos(a) * 1.4), S(Math.sin(a) * 1.72, -Math.cos(a) * 1.72)], { width: line * 0.8 });
      }
  };

  // Paint back to front: arms behind the body, legs, torso, neck, then the
  // head and the arms in front of the body in depth order.
  parts.push({ z: headZ, draw: drawHead });
  // Back hair hangs behind the body (and behind an arm held behind it).
  if (fringe) parts.push({ z: -7.5e5, draw: backHair });
  parts.sort((a, b) => a.z - b.z).forEach((pt) => pt.draw());

  // Ground shadow under everything this character drew (from the joints).
  const g0 = Pj([0, 0, 0])[1];
  const shadowPts = [];
  for (const j of [sk.head, sk.chest, sk.pelvis, sk.armF.wr, sk.armB.wr, sk.armF.el, sk.armB.el, sk.legF.knee, sk.legB.knee, sk.legF.ankle, sk.legB.ankle]) {
    const c = Pj(j);
    const rad = (j === sk.head ? r : j === sk.chest || j === sk.pelvis ? 0.1 * H : 0.04 * H) * (c[3] || 1);
    for (let k = 0; k < 8; k++) shadowPts.push([c[0] + Math.cos((k / 8) * Math.PI * 2) * rad, c[1] + Math.sin((k / 8) * Math.PI * 2) * rad]);
  }
  const n1 = pen.ops.length;
  castShadow(pen, shadowPts, g0, SHADOW_LIGHT);
  pen.ops.splice(n0, 0, ...pen.ops.splice(n1));

  const hp = Pj(sk.head);
  return { head: [hp[0], hp[1]], R: r, H, top: HP([0, -1.25, 0]) };
}

// Where a character's head will be, for speech bubble tails (no drawing).
export function headSpot(ch, { x, ground, scale = 1 }) {
  const H = BASE_H * ch.height * scale;
  const h = restHead(ch, H);
  return { x, y: ground + h.y, R: h.r, H };
}

export const seedFor = (who) => hash('actor', who);
export { lerp };
