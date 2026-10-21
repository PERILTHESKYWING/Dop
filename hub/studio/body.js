// The body as drawn solids: the torso is one silhouette taken around rings
// (neck, shoulders, chest, waist, hips) that turn with the spine; limbs are
// tapered tubes with muscle on the right side (biceps, calf); hands and shoes
// have real shapes. Each part comes back with a depth so the rig can paint
// back to front and an arm can pass in front of or behind the body.
import { curve, ellipse, loop, mix } from './draw.js';
import { add, mul, unit } from './skel.js';

const TAU = Math.PI * 2;

// Fill, shade and outline a solid. Pen.form adds the light and shadow; with
// a plain pen it falls back to fill + outline.
export function solid(pen, id, pts, color, opts = {}) {
  if (pen.form) return pen.form(id, pts, color, opts);
  pen.shape(id, pts, color, { width: opts.width });
  return pts;
}

// 2D helpers.
const v2 = (a, b) => [b[0] - a[0], b[1] - a[1]];
const n2 = (a) => {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
};

// Points of a horizontal ring (cross-section) of the body, in 3D.
function ring(c, fr, w, d, n = 18, zOff = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    out.push(add(c, fr([Math.cos(t) * w, 0, Math.sin(t) * d + zOff])));
  }
  return out;
}

// Outline around a stack of rings, top to bottom: the extremes of each ring
// across the body's axis, closed by the front arc of the bottom ring (or a
// given point) and the back arc of the top ring.
function stackOutline(rings, Pj, { bottom = null } = {}) {
  const pr = rings.map((r) => r.map(Pj));
  const ctr = pr.map((r) => [r.reduce((s, q) => s + q[0], 0) / r.length, r.reduce((s, q) => s + q[1], 0) / r.length]);
  const L = [];
  const Rt = [];
  const ext = [];
  pr.forEach((r, i) => {
    const ax = n2(v2(ctr[Math.max(0, i - 1)], ctr[Math.min(pr.length - 1, i + 1)]));
    const nrm = [-ax[1], ax[0]];
    let lo = 0;
    let hi = 0;
    r.forEach((q, k) => {
      const s = (q[0] - ctr[i][0]) * nrm[0] + (q[1] - ctr[i][1]) * nrm[1];
      const sl = (r[lo][0] - ctr[i][0]) * nrm[0] + (r[lo][1] - ctr[i][1]) * nrm[1];
      const sh = (r[hi][0] - ctr[i][0]) * nrm[0] + (r[hi][1] - ctr[i][1]) * nrm[1];
      if (s < sl) lo = k;
      if (s > sh) hi = k;
    });
    L.push(r[lo]);
    Rt.push(r[hi]);
    ext.push([lo, hi]);
  });
  // An arc of ring i between its two extremes: the lower one on screen
  // (front, as the camera looks a little down) or the upper one (back).
  const arc = (i, lowerSide) => {
    const r = pr[i];
    const [lo, hi] = ext[i];
    const n = r.length;
    const a = [];
    const b = [];
    for (let k = hi; k !== lo; k = (k + 1) % n) a.push(r[k]);
    for (let k = hi; k !== lo; k = (k - 1 + n) % n) b.push(r[k]);
    const meanY = (s) => s.reduce((t, q) => t + q[1], 0) / (s.length || 1);
    const pick = (meanY(a) > meanY(b)) === lowerSide ? a : b;
    return pick.slice(1);
  };
  const last = pr.length - 1;
  const bot = bottom ? [Pj(bottom)] : arc(last, true);
  const top = arc(0, false).reverse();
  const pts = [...L, ...bot.reverse(), ...[...Rt].reverse(), ...top];
  return { pts: [...pts, pts[0]], left: L, right: Rt, frontArc: (i) => arc(i, true) };
}

// A tapered tube from a to b (3D). prof(t) gives the radius; bulge pushes
// one side out (toward the 3D direction toward). Returns screen outline and depth.
export function tube(Pj, a, b, prof, { toward = null, bulge = () => 0, end = null } = {}) {
  const A = Pj(a);
  const B = Pj(b);
  const fa = A[3] || 1;
  const fb = B[3] || 1;
  let ax = v2(A, B);
  const L = Math.hypot(ax[0], ax[1]);
  ax = L < 1e-3 ? [0, 1] : [ax[0] / L, ax[1] / L];
  const nrm = [-ax[1], ax[0]];
  let side = 0;
  if (toward) {
    const m = mul(add(a, b), 0.5);
    const M = Pj(m);
    const T = Pj(add(m, mul(toward, 10)));
    side = Math.sign((T[0] - M[0]) * nrm[0] + (T[1] - M[1]) * nrm[1]);
  }
  const N = 8;
  const left = [];
  const right = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const c = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
    const f = fa + (fb - fa) * t;
    const r = prof(t) * f;
    const bl = bulge(t) * r;
    const rl = r + (side > 0 ? bl : side < 0 ? 0 : bl * 0.5);
    const rr = r + (side < 0 ? bl : side > 0 ? 0 : bl * 0.5);
    left.push([c[0] + nrm[0] * rl, c[1] + nrm[1] * rl]);
    right.push([c[0] - nrm[0] * rr, c[1] - nrm[1] * rr]);
  }
  const cap = (c, r, from) => {
    const out = [];
    for (let k = 1; k < 7; k++) {
      const ang = from + (k / 7) * Math.PI;
      out.push([c[0] + Math.cos(ang) * r, c[1] + Math.sin(ang) * r]);
    }
    return out;
  };
  const angN = Math.atan2(nrm[1], nrm[0]);
  const rB = prof(1) * fb;
  const rA = prof(0) * fa;
  const endPts = end ? end(left[N], right[N], nrm) : cap(B, rB, angN + Math.PI).reverse();
  const pts = [...left, ...endPts, ...[...right].reverse(), ...cap(A, rA, angN).reverse()];
  // Caps go the short way round the far side of each end.
  return { pts: [...pts, pts[0]], z: (A[2] + B[2]) / 2, axis: [[A[0], A[1]], [B[0], B[1]]], A, B };
}

// A whole limb (shoulder-elbow-wrist or hip-knee-ankle) as one outline, so
// the joint reads as a bend in one arm rather than two pipes. Returns null
// when the bend is too sharp or a segment points at the camera; the caller
// then draws the two segments overlapping (a folded arm).
export function limb(Pj, a, j, c, profA, profB, { towardA = null, towardB = null, bulgeA = () => 0, bulgeB = () => 0, end = null } = {}) {
  const [A, J, C] = [Pj(a), Pj(j), Pj(c)];
  const l1 = Math.hypot(J[0] - A[0], J[1] - A[1]);
  const l2 = Math.hypot(C[0] - J[0], C[1] - J[1]);
  const r0 = Math.max(profA(0) * (A[3] || 1), profB(0) * (J[3] || 1));
  if (Math.min(l1, l2) < r0 * 1.3) return null;
  const d1 = n2(v2(A, J));
  const d2 = n2(v2(J, C));
  const bend = Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1])));
  if (bend > (105 * Math.PI) / 180) return null;
  const sideOf = (p0, p1, toward, d) => {
    if (!toward) return 0;
    const m = mul(add(p0, p1), 0.5);
    const M = Pj(m);
    const T = Pj(add(m, mul(toward, 10)));
    return Math.sign((T[0] - M[0]) * -d[1] + (T[1] - M[1]) * d[0]);
  };
  const sA = sideOf(a, j, towardA, d1);
  const sB = sideOf(j, c, towardB, d2);
  const path = curve([[A[0], A[1]], [J[0], J[1]], [C[0], C[1]]], 12);
  const tot = l1 + l2;
  const sJ = l1 / tot;
  const nrmAt = normalsOf(path);
  const left = [];
  const right = [];
  let acc = 0;
  path.forEach((q, i) => {
    if (i) acc += Math.hypot(q[0] - path[i - 1][0], q[1] - path[i - 1][1]);
    const s = Math.min(1, acc / tot);
    const first = s < sJ;
    const t = first ? s / sJ : (s - sJ) / (1 - sJ);
    const f = first ? (A[3] || 1) + ((J[3] || 1) - (A[3] || 1)) * t : (J[3] || 1) + ((C[3] || 1) - (J[3] || 1)) * t;
    const r = (first ? profA(t) : profB(t)) * f;
    const bl = (first ? bulgeA(t) : bulgeB(t)) * r;
    const sd = first ? sA : sB;
    const rl = r + (sd > 0 ? bl : sd < 0 ? 0 : bl * 0.5);
    const rr = r + (sd < 0 ? bl : sd > 0 ? 0 : bl * 0.5);
    const [nx, ny] = nrmAt[i];
    left.push([q[0] + nx * rl, q[1] + ny * rl]);
    right.push([q[0] - nx * rr, q[1] - ny * rr]);
  });
  // Drop points that run backwards (the inside of a bend folding over itself).
  const tidy = (side) => side.filter((q, i) => {
    if (!i || i === side.length - 1) return true;
    const k = Math.min(path.length - 1, i);
    const tg = v2(path[Math.max(0, k - 1)], path[Math.min(path.length - 1, k + 1)]);
    return (q[0] - side[i - 1][0]) * tg[0] + (q[1] - side[i - 1][1]) * tg[1] > 0;
  });
  const L = tidy(left);
  const R = tidy(right);
  const cap = (c0, r, ang) => Array.from({ length: 6 }, (_, k) => [c0[0] + Math.cos(ang + ((k + 1) / 7) * Math.PI) * r, c0[1] + Math.sin(ang + ((k + 1) / 7) * Math.PI) * r]);
  const nE = nrmAt[nrmAt.length - 1];
  const nS = nrmAt[0];
  const rEnd = profB(1) * (C[3] || 1);
  const rSt = profA(0) * (A[3] || 1);
  const endPts = end ? end(L[L.length - 1], R[R.length - 1], nE) : cap(C, rEnd, Math.atan2(nE[1], nE[0]) + Math.PI).reverse();
  const pts = [...L, ...endPts, ...[...R].reverse(), ...cap(A, rSt, Math.atan2(nS[1], nS[0])).reverse()];
  return { pts: [...pts, pts[0]], z: (A[2] + J[2] + C[2]) / 3, axis: [[A[0], A[1]], [C[0], C[1]]] };
}

function normalsOf(pts) {
  return pts.map((q, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const d = n2(v2(a, b));
    return [-d[1], d[0]];
  });
}

const bump = (t, at, w) => Math.max(0, 1 - Math.abs(t - at) / w);
const smooth = (x) => x * x * (3 - 2 * x);

// Hand shapes in hand space: u from the wrist (0) to the fingertips (1),
// v across, thumb on +v. Outline control points and inner lines.
const HANDS = {
  // The wrist end (u < 0.15) is about as wide as the forearm's wrist, so the
  // hand flares out of the arm; the palm is twice that.
  relaxed: {
    out: [[0.05, -0.15], [0.3, -0.3], [0.62, -0.32], [0.9, -0.25], [1.03, -0.09], [0.99, 0.07], [0.82, 0.17], [0.63, 0.2], [0.62, 0.35], [0.5, 0.42], [0.33, 0.31], [0.12, 0.16]],
    lines: [[[1.0, -0.16], [0.78, -0.15]], [[1.02, -0.01], [0.8, -0.01]], [[0.94, 0.11], [0.78, 0.1]]],
  },
  // A ball fist, as f2 draws it: round knuckles, the thumb across the front.
  fist: {
    out: [[0.05, -0.15], [0.25, -0.3], [0.5, -0.37], [0.72, -0.31], [0.84, -0.13], [0.84, 0.08], [0.74, 0.26], [0.56, 0.35], [0.36, 0.31], [0.2, 0.21], [0.08, 0.15]],
    lines: [[[0.78, -0.22], [0.64, -0.19]], [[0.8, -0.04], [0.64, -0.03]], [[0.38, 0.27], [0.64, 0.12]]],
  },
  // Index finger out, the others curled, the thumb tucked across them.
  point: {
    out: [[0.05, -0.15], [0.3, -0.29], [0.6, -0.31], [1.22, -0.27], [1.29, -0.19], [1.23, -0.1], [0.68, -0.09], [0.74, 0.07], [0.68, 0.23], [0.52, 0.32], [0.34, 0.3], [0.18, 0.21], [0.08, 0.15]],
    lines: [[[0.68, -0.05], [0.72, 0.17]], [[0.36, 0.24], [0.62, 0.12]]],
  },
  // Fingers together and straight, the palm toward the camera (hand on a
  // cheek, palms together, hands over the face).
  flat: {
    out: [[0.05, -0.15], [0.32, -0.3], [0.8, -0.31], [1.08, -0.25], [1.19, -0.13], [1.21, 0.0], [1.13, 0.12], [0.9, 0.18], [0.63, 0.2], [0.67, 0.34], [0.57, 0.43], [0.4, 0.36], [0.2, 0.22], [0.08, 0.15]],
    lines: [[[1.15, -0.19], [0.84, -0.17]], [[1.2, -0.06], [0.86, -0.05]], [[1.15, 0.07], [0.86, 0.07]]],
  },
  // Index and middle finger up in a V, the others curled under the thumb.
  peace: {
    out: [[0.05, -0.15], [0.3, -0.3], [0.6, -0.31], [1.12, -0.47], [1.21, -0.39], [0.8, -0.17], [1.19, -0.07], [1.2, 0.05], [0.72, 0.08], [0.72, 0.26], [0.54, 0.36], [0.33, 0.32], [0.12, 0.16]],
    lines: [[[0.7, 0.1], [0.66, 0.24]]],
  },
  // Fingers curled round something held (a phone, a shoulder).
  hold: {
    out: [[0.05, -0.15], [0.3, -0.32], [0.66, -0.37], [0.9, -0.23], [0.94, 0.0], [0.82, 0.18], [0.6, 0.22], [0.62, 0.38], [0.47, 0.46], [0.28, 0.34], [0.1, 0.16]],
    lines: [[[0.86, -0.14], [0.64, -0.11]], [[0.88, 0.04], [0.64, 0.05]]],
  },
};
HANDS.hip = HANDS.fist;
HANDS.cup = HANDS.relaxed;
HANDS.open = HANDS.flat;
HANDS.up = HANDS.point;
// Grips that show the palm, the thumb on the outer side.
const PALM = new Set(['open', 'flat', 'peace', 'point', 'up']);

// A hand at the wrist W (screen) along dir (screen unit), thumb toward thumb
// (+1/-1), length Lpx, foreshortened by fs (0.4..1). Returns the outline
// without its wrist end (to join the forearm's two sides, so hand and arm
// are one drawn shape and can never come apart), the closed outline, and
// the finger lines.
function handShape(W, dir, thumb, Lpx, fs, grip) {
  const h = HANDS[grip] || HANDS.relaxed;
  const U = [dir[0] * Lpx * fs, dir[1] * Lpx * fs];
  const V = [-dir[1] * Lpx * thumb, dir[0] * Lpx * thumb];
  const at = ([u, v]) => [W[0] + U[0] * u + V[0] * v, W[1] + U[1] * u + V[1] * v];
  // Rounded through the knuckles and fingertips; the wrist end is open.
  const open = curve(h.out.filter(([u]) => u >= 0.15).map(at), 4);
  // Drawn on its own (a sleeve, or a forearm pointing at the camera), the
  // hand starts a little inside the arm, so its base covers the wrist.
  const closed = loop([[-0.1, 0.13], [-0.1, -0.13], ...h.out].map(at), 4);
  return { open, closed, lines: h.lines.map((l) => curve(l.map(at), 3)), V };
}

// Every body part of one character as { z, draw }; the rig sorts and paints.
// sk: skeleton(); Pj: 3D -> [x, y, z, scale]; ch: cast entry; facing: 1/-1.
export function bodyParts(pen, ch, sk, Pj, facing) {
  const { H, b, frames, p } = sk;
  const line = pen.style.line;
  const ink = pen.style.ink;
  const lim = b.limb;
  const parts = [];
  const skin = ch.skin;
  const top = ch.top;
  const bottom = ch.bottom;
  const skirt = ch.bottomStyle === 'skirt' || ch.bottomStyle === 'longskirt';
  const bare = ch.topStyle === 'sleeveless' || ch.topStyle === 'turtleneck';
  const longSleeve = ch.topStyle === 'long';
  const legC = skirt ? skin : bottom; // bare legs under a skirt
  const fwdChest = frames.chest([0, 0, 1]);
  const fwdBody = frames.body([0, 0, 1]);

  // ---- legs (always behind the hips) ----
  for (const s of ['B', 'F']) {
    const L = sk['leg' + s];
    const thighR = (t) => (0.056 - 0.017 * t) * H * lim;
    const shinR = (t) => (0.039 - 0.014 * smooth(t)) * H * lim;
    const thighB = (t) => 0.16 * bump(t, 0.4, 0.5);
    const shinB = (t) => 0.38 * bump(t, 0.28, 0.4);
    const whole = limb(Pj, L.hip, L.knee, L.ankle, thighR, shinR, { towardA: fwdBody, towardB: mul(fwdBody, -1), bulgeA: thighB, bulgeB: shinB });
    const thigh = tube(Pj, L.hip, L.knee, thighR, { toward: fwdBody, bulge: thighB });
    const shin = tube(Pj, L.knee, L.ankle, shinR, { toward: mul(fwdBody, -1), bulge: shinB });
    parts.push({
      z: -1e6 + Pj(L.knee)[2],
      draw: () => {
        if (whole) solid(pen, 'leg' + s, whole.pts, legC, { axis: whole.axis, width: line });
        else {
          solid(pen, 'shin' + s, shin.pts, legC, { axis: shin.axis, width: line });
          solid(pen, 'thigh' + s, thigh.pts, legC, { axis: thigh.axis, width: line });
        }
        shoe(s, L);
      },
    });
  }

  // A shoe: a solid with a heel, a rounded toe box and a little toe spring,
  // turned with the foot; its outline is the hull of the projected solid.
  function shoe(s, L) {
    const fw = L.toe;
    const sd = unit([-fw[2], 0, fw[0]]);
    const sole = L.ankle[1] + 0.045 * H;
    const pts3 = [];
    const heel = L.heel || 0;
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const along = (-0.034 + 0.13 * t) * H * lim ** 0.3;
      const w = (0.026 + 0.012 * Math.sin(Math.PI * Math.min(1, t * 1.25))) * H * (t > 0.85 ? Math.sqrt(1 - (t - 0.85) / 0.17) : 1);
      const hgt = (t < 0.35 ? 0.062 : 0.062 - 0.034 * smooth((t - 0.35) / 0.65)) * H;
      const spring = t > 0.75 ? ((t - 0.75) / 0.25) ** 2 * 0.012 * H : 0;
      const lift = heel * (1 - t) * 0.06 * H;
      for (const k of [-1, 1]) {
        const base = add(add([L.ankle[0], sole - spring - lift, L.ankle[2]], mul(fw, along)), mul(sd, k * w));
        pts3.push(base, add(base, [0, -hgt * 0.92, 0]));
      }
    }
    const P2 = pts3.map(Pj);
    solid(pen, 'shoe' + s, loop(hull(P2), 2), ch.shoes, { width: line * 0.95, round: 0.6, axis: [Pj(add(L.ankle, mul(fw, -0.03 * H))), Pj(add(L.ankle, mul(fw, 0.09 * H)))] });
    // Sole edge along the front of the shoe.
    const soleLine = [];
    for (let i = 3; i <= 10; i++) soleLine.push(P2[i * 4 + 0]);
    const soleR = [];
    for (let i = 10; i >= 3; i--) soleR.push(P2[i * 4 + 2]);
    pen.stroke('sole' + s, curve([...soleLine, ...soleR].filter((_, i) => i % 2 === 0), 3), { width: line * 0.5, color: mix(ch.shoes, ink, 0.55) });
  }

  // ---- torso: trousers, then the shirt over them ----
  const fP = frames.pelvis;
  const fW = frames.waist;
  const fC = frames.chest;
  const [cw, cd] = b.chest;
  const [ww, wd] = b.waist;
  const [hw, hd] = b.hip;
  const crotch = add(sk.pelvis, fP([0, 0.072 * H, 0.004 * H]));
  const pantsRings = [
    ring(add(sk.waist, fW([0, 0.035 * H, 0])), fW, ww * 1.02 * H, wd * 1.02 * H),
    ring(sk.pelvis, fP, hw * H, hd * H),
    ring(add(sk.pelvis, fP([0, 0.04 * H, 0])), fP, hw * 0.96 * H, hd * 0.95 * H),
  ];
  const pants = stackOutline(pantsRings, Pj, { bottom: crotch });
  const shirtRings = [
    ring(sk.neckBase, fC, 0.05 * H, 0.046 * H),
    ring(add(sk.chest, fC([0, -0.036 * H, -0.006 * H])), fC, b.sh * 1.0 * H, cd * 0.8 * H),
    ring(sk.chest, fC, cw * H, cd * H, 18, 0.006 * H),
    ring(sk.waist, fW, ww * H, wd * H),
    ring(add(sk.pelvis, fP([0, 0.012 * H, 0])), fP, hw * 1.05 * H, hd * 1.08 * H),
  ];
  const shirt = stackOutline(shirtRings, Pj);
  // A skirt: rings from the waist flaring to a hem at the knee or the ankle.
  let skirtO = null;
  if (skirt) {
    const long = ch.bottomStyle === 'longskirt';
    const drop = (long ? 0.4 : 0.2) * H;
    const flare = long ? 1.55 : 1.42;
    const sway = (p.hairSwing || 0) * 0.02 * H;
    skirtO = stackOutline([
      ring(add(sk.waist, fW([0, 0.03 * H, 0])), fW, ww * 1.04 * H, wd * 1.04 * H),
      ring(add(sk.pelvis, fP([0, 0.01 * H, 0])), fP, hw * 1.08 * H, hd * 1.1 * H),
      ring(add(sk.pelvis, fP([sway, drop, 0])), fP, hw * flare * H, hd * flare * 1.1 * H, 24),
    ], Pj);
  }
  const chestZ = Pj(sk.chest)[2];
  const axisT = [Pj(sk.pelvis), Pj(sk.neckBase)];
  parts.push({
    z: -5e5,
    draw: () => {
      if (skirtO) {
        solid(pen, 'skirt', skirtO.pts, bottom, { axis: axisT, width: line, round: 0.75 });
        // Hem and two folds running down from the hips.
        const hem = skirtO.frontArc(2);
        if (hem.length > 4) {
          const q = hem.filter((_, i) => i % 2 === 0);
          pen.stroke('skirtHem', curve(q, 3), { width: line * 0.5, color: mix(bottom, ink, 0.55) });
          const L = skirtO.left;
          const R = skirtO.right;
          for (const f of [0.33, 0.66]) {
            const lo = q[Math.round(f * (q.length - 1))];
            const hi = [L[1][0] + (R[1][0] - L[1][0]) * f, L[1][1] + (R[1][1] - L[1][1]) * f];
            pen.stroke('fold' + f, [[hi[0] + (lo[0] - hi[0]) * 0.35, hi[1] + (lo[1] - hi[1]) * 0.35], lo], { width: line * 0.45, color: mix(bottom, ink, 0.5) });
          }
        }
      } else solid(pen, 'pants', pants.pts, bottom, { axis: axisT, width: line, round: 0.75 });
      solid(pen, 'shirt', shirt.pts, top, { axis: axisT, width: line, round: 0.75 });
      // Hem and a crease where the spine bends.
      const hem = shirt.frontArc(4);
      if (hem.length > 2) pen.stroke('hem', curve(hem.filter((_, i) => i % 2 === 0), 3), { width: line * 0.55, color: mix(top, ink, 0.6) });
      const bend = (p.spine || 0) + (p.slump || 0) * 8;
      if (bend > 8) {
        const cr = shirt.frontArc(3);
        if (cr.length > 4) pen.stroke('crease', curve(cr.slice(1, -1).filter((_, i) => i % 2 === 0), 3), { width: line * 0.45, color: mix(top, ink, 0.55) });
      }
    },
  });

  // ---- neck and collar ----
  const nk = tube(Pj, add(sk.neckBase, fC([0, 0.01 * H, -0.006 * H])), sk.neckTop, () => 0.033 * H * lim ** 0.5 * (b.neck || 1));
  parts.push({
    z: -4e5,
    draw: () => {
      solid(pen, 'neck', nk.pts, skin, { axis: nk.axis, width: line * 0.85 });
      // Collar rings grow with the neck, so a wide neck never swallows them.
      const nw = lim ** 0.5 * (b.neck || 1);
      const col = ring(add(sk.neckBase, fC([0, 0.004 * H, 0])), fC, 0.052 * H * Math.max(1, nw * 0.9), 0.05 * H * Math.max(1, nw * 0.9), 24).map(Pj);
      const inner = ring(add(sk.neckBase, fC([0, -0.004 * H, 0])), fC, 0.037 * H * Math.max(1, nw * 0.9), 0.036 * H * Math.max(1, nw * 0.9), 24).map(Pj);
      // Front half of the collar band, as seen from a little above.
      const front = (pts) => pts.filter((_, i) => i >= 2 && i <= 10);
      const band = [...front(col), ...front(inner).reverse()];
      const toCam = Pj(add(sk.neckBase, mul(fwdChest, 10)))[2] - Pj(sk.neckBase)[2];
      const up = unit([sk.neckTop[0] - sk.neckBase[0], sk.neckTop[1] - sk.neckBase[1], sk.neckTop[2] - sk.neckBase[2]]);
      // A high collar hugging the neck: a rolled turtleneck, or the low
      // mock neck of f2's sleeveless top (a soft band in the top's colour,
      // one thin line along its top edge).
      const high = (hgt, fold) => {
        const rad = 0.041 * H * nw;
        const tn = tube(Pj, add(sk.neckBase, fC([0, 0.012 * H, 0])), add(sk.neckBase, mul(up, hgt * H)), () => rad);
        solid(pen, 'turtle', tn.pts, top, { axis: tn.axis, width: line * 0.7 });
        if (toCam > -3) pen.stroke('turtleFold', curve(front(ring(add(sk.neckBase, mul(up, (hgt - fold) * H)), fC, rad * 1.02, rad, 24).map(Pj)).filter((_, i) => i % 2 === 0), 3), { width: line * 0.35, color: mix(top, ink, 0.4) });
      };
      if (ch.topStyle === 'turtleneck') high(0.032, 0.04);
      else if (ch.topStyle === 'sleeveless') high(0.014, 0.011);
      else if (band.length > 4 && toCam > -3) solid(pen, 'collar', loop(band.filter((_, i) => i % 2 === 0), 3), top, { width: line * 0.7, round: 0.4 });
    },
  });

  // ---- arms: one bending outline, or two overlapping segments when folded.
  // The hand is part of the forearm's outline (bare arms), so the two are
  // one shape in every drawing: no seam across the wrist, no gap.
  const headP = Pj(sk.head);
  const hands = {};
  for (const s of ['F', 'B']) {
    const A = sk['arm' + s];
    const fore = unit([A.wr[0] - A.el[0], A.wr[1] - A.el[1], A.wr[2] - A.el[2]]);
    const upR = (t) => (0.033 - 0.011 * t) * H * lim;
    // The forearm tapers to a slim wrist, narrower than the hand.
    const foR = (t) => (0.025 - 0.011 * smooth(t)) * H * lim;
    const upB = (t) => 0.2 * bump(t, 0.5, 0.45);
    const foB = (t) => 0.16 * bump(t, 0.25, 0.35);
    const grip = p['grip' + s] || 'relaxed';
    // The hand on screen: its direction (the wrist bends toward aimF/aimB),
    // foreshortening and which side the thumb is on.
    const W = Pj(A.wr);
    const hd = A.hd || fore;
    const T = Pj(add(A.wr, mul(hd, 0.1 * H)));
    const hl = Math.hypot(T[0] - W[0], T[1] - W[1]);
    let dir = hl > 1e-3 ? [(T[0] - W[0]) / hl, (T[1] - W[1]) / hl] : n2(v2(Pj(A.el), W));
    if (!Number.isFinite(dir[0]) || (!dir[0] && !dir[1])) dir = [0, 1];
    // On screen the hand never folds back over its own forearm: at most 80
    // degrees off it. A forearm pointing at the camera is a short stub; the
    // hand then sits over its round end instead of joining its sides.
    const E = Pj(A.el);
    const fl = Math.hypot(W[0] - E[0], W[1] - E[1]);
    const foreshort = fl / (0.135 * H * (W[3] || 1));
    if (foreshort > 0.3) {
      const f2 = [(W[0] - E[0]) / fl, (W[1] - E[1]) / fl];
      const cr = f2[0] * dir[1] - f2[1] * dir[0];
      const ang = Math.atan2(cr, f2[0] * dir[0] + f2[1] * dir[1]);
      const lim80 = (80 * Math.PI) / 180;
      if (Math.abs(ang) > lim80) {
        const a2 = Math.atan2(f2[1], f2[0]) + Math.sign(ang) * lim80;
        dir = [Math.cos(a2), Math.sin(a2)];
      }
    }
    const fs = Math.max(0.45, Math.min(1, (hl / (0.1 * H * (W[3] || 1))) * 1.1));
    const nrm = [-dir[1], dir[0]];
    const side = (v3) => {
      const q = Pj(add(A.wr, mul(v3, 10)));
      return (q[0] - W[0]) * nrm[0] + (q[1] - W[1]) * nrm[1];
    };
    // A palm shown to the camera has its thumb on the outer side; a fist or a
    // relaxed hand has it forward.
    const outer = frames.chest([s === 'F' ? -1 : 1, 0, 0]);
    const th = PALM.has(grip) ? side(outer) : side(fwdChest) || side(outer);
    const thumb = Math.sign(th) || (s === 'F' ? 1 : -1) * facing;
    // Hands grow with the head, as cartoon hands do: f2's hand is about half
    // the face's height.
    const Lpx = 0.068 * H * (ch.headSize || 1) ** 2;
    const hs = handShape(W, dir, thumb, Lpx, fs, grip);
    hands[s] = { wrist: [W[0], W[1]], shape: hs, foreshort };
    // Join the hand to the forearm's sides: start from whichever side the
    // first hand point is on, so the outline never crosses itself.
    const joined = bare && foreshort > 0.3 ? (l, r) => {
      const o = hs.open;
      const d = (q, z) => Math.hypot(q[0] - z[0], q[1] - z[1]);
      const pts = d(o[0], l) + d(o[o.length - 1], r) <= d(o[0], r) + d(o[o.length - 1], l) ? o : [...o].reverse();
      hands[s].joined = true;
      return pts;
    } : null;
    const whole = limb(Pj, A.sh, A.el, A.wr, upR, foR, { towardA: fore, bulgeA: upB, bulgeB: foB, end: joined });
    const upper = tube(Pj, A.sh, A.el, upR, { toward: fore, bulge: upB });
    const sleeve = tube(Pj, add(A.sh, mul(unit([A.el[0] - A.sh[0], A.el[1] - A.sh[1], A.el[2] - A.sh[2]]), 0.012 * H)), add(A.sh, mul(unit([A.el[0] - A.sh[0], A.el[1] - A.sh[1], A.el[2] - A.sh[2]]), 0.075 * H)), (t) => (0.039 + 0.003 * t) * H * lim, {});
    const foreT = tube(Pj, A.el, A.wr, foR, { bulge: foB, end: joined });
    const behind = (z) => z < chestZ - 0.02 * H;
    // A hand up at the face (cheek, chin, mouth) is drawn over the head.
    const atFace = Math.hypot(W[0] - headP[0], W[1] - headP[1]) < sk.r * 1.35 * (headP[3] || 1) && W[2] > headP[2] - 0.4 * sk.r;
    const depth = (z) => (atFace ? Math.max(z, headP[2] + 1) : behind(z) ? -7e5 + z : z);
    const fingers = () => hs.lines.forEach((l, i) => pen.stroke('hand' + s + ':l' + i, l, { width: line * 0.45, color: mix(skin, ink, 0.6) }));
    const drawHand = () => {
      // Sleeved arms: the hand is its own shape, its wrist under the cuff.
      if (!hands[s].joined) solid(pen, 'hand' + s, hs.closed, skin, { width: line * 0.85, round: 0.8, axis: [W, hs.closed[Math.floor(hs.closed.length / 2)]] });
      fingers();
    };
    const drawSleeve = () => {
      if (bare) return;
      if (longSleeve) {
        // The arm itself is the sleeve; a cuff line near the wrist.
        const E = Pj(A.el);
        const k = 0.86;
        const c = [E[0] + (W[0] - E[0]) * k, E[1] + (W[1] - E[1]) * k];
        const nn = n2([-(W[1] - E[1]), W[0] - E[0]]);
        const rr = 0.024 * H * lim * (W[3] || 1);
        pen.stroke('cuff' + s, [[c[0] + nn[0] * rr, c[1] + nn[1] * rr], [c[0] - nn[0] * rr, c[1] - nn[1] * rr]], { width: line * 0.5, color: mix(top, ink, 0.55) });
        return;
      }
      solid(pen, 'sleeve' + s, sleeve.pts, top, { axis: sleeve.axis, width: line * 0.9 });
    };
    const armC = longSleeve ? top : skin;
    if (whole) {
      hands[s].outline = whole.pts;
      parts.push({
        z: depth(whole.z),
        draw: () => {
          solid(pen, 'arm' + s, whole.pts, armC, { axis: whole.axis, width: line * 0.9 });
          drawSleeve();
          drawHand();
        },
      });
      continue;
    }
    hands[s].outline = foreT.pts;
    const zU = Math.max(upper.z, sleeve.z);
    parts.push({
      z: behind(zU) ? -7e5 + zU : zU,
      draw: () => {
        solid(pen, 'uarm' + s, upper.pts, armC, { axis: upper.axis, width: line * 0.9 });
        drawSleeve();
      },
    });
    const zF = foreT.z;
    // The forearm and hand go over the upper arm when they come toward the camera.
    const order = zF >= zU - 0.01 * H ? 0.001 : -0.001;
    parts.push({
      z: depth(zF) + order,
      draw: () => {
        solid(pen, 'farm' + s, foreT.pts, armC, { axis: foreT.axis, width: line * 0.9 });
        drawHand();
      },
    });
  }

  // Both hands holding (the phone move): the phone between them, over the
  // chest and the palms, with the fingers showing at its sides as in f2.
  if (p.gripF === 'hold' && p.gripB === 'hold' && hands.F && hands.B) {
    const a = hands.F.wrist, b = hands.B.wrist;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const up = n2(v2(mid, headP));
    const Lpx = 0.068 * H * (ch.headSize || 1) ** 2 * (headP[3] || 1);
    const w = Math.max(Lpx * 0.95, Math.hypot(a[0] - b[0], a[1] - b[1]) * 0.62);
    const h = w * 1.25;
    const c = [mid[0] + up[0] * Lpx * 0.75, mid[1] + up[1] * Lpx * 0.75];
    const rt = [-up[1], up[0]];
    const rr = w * 0.14;
    const corner = (sx, sy, a0) => Array.from({ length: 4 }, (_, i) => {
      const ang = a0 + (i / 3) * (Math.PI / 2);
      const lx = sx * (w / 2 - rr) + Math.cos(ang) * rr;
      const ly = sy * (h / 2 - rr) + Math.sin(ang) * rr;
      return [c[0] + rt[0] * lx + up[0] * ly, c[1] + rt[1] * lx + up[1] * ly];
    });
    const pts = [...corner(1, 1, 0), ...corner(-1, 1, Math.PI / 2), ...corner(-1, -1, Math.PI), ...corner(1, -1, 1.5 * Math.PI)];
    // Fingers curl round its long sides and the thumbs rest on its face near the bottom.
    const at = (lx, ly) => [c[0] + rt[0] * lx + up[0] * ly, c[1] + rt[1] * lx + up[1] * ly];
    const rot = Math.atan2(up[1], up[0]);
    const grips = [];
    for (const sx of [-1, 1]) {
      for (const [i, ly] of [-0.3, -0.12, 0.06].entries()) {
        const q = at(sx * (w / 2 - w * 0.03), ly * h);
        grips.push(['fg' + sx + i, ellipse(q[0], q[1], w * 0.09, w * 0.14, { rot: rot + Math.PI / 2, n: 12 })]);
      }
      const q = at(sx * w * 0.3, -h * 0.36);
      grips.push(['th' + sx, ellipse(q[0], q[1], w * 0.1, w * 0.2, { rot: rot - sx * 0.5, n: 14 })]);
    }
    parts.push({
      z: Math.max(...parts.map((q) => q.z)) + 1,
      draw: () => {
        solid(pen, 'phone', pts, '#2e3150', { width: line * 0.9, round: 0.5 });
        for (const [id, g] of grips) solid(pen, 'phone' + id, g, skin, { width: line * 0.7, round: 0.8 });
      },
    });
  }

  return { parts, chestZ, neck: nk.pts, hands };
}

// Convex hull (monotone chain) of 2D points.
export function hull(pts) {
  const P = pts.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return P;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const q of P) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up = [];
  for (let i = P.length - 1; i >= 0; i--) {
    const q = P[i];
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  up.pop();
  lo.pop();
  return [...lo, ...up];
}

export { ellipse };
