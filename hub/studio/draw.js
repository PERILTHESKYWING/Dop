// Hand-drawn line engine for the studio. No DOM: shapes become "ops"
// ({ d: SVG path, fill, alpha? } or { text, x, y, size, fill, align }) that
// the page paints on a canvas and the tests turn into SVG.
//
// What makes it look drawn rather than vector-perfect:
// - every line is a filled ribbon whose width swells and thins like a pen,
//   tapering at both ends;
// - lines wander off the true shape by a little low-frequency noise;
// - closed outlines start and stop at a seam and overshoot it slightly;
// - colour fills are a separate, rougher shape that slips off the outline;
// - "boil": each new drawing reseeds part of the noise, so even a held pose
//   shimmers the way traced frames do.

// ---------- seeded randomness ----------
export function hash(...parts) {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x9e3779b9;
  }
  return h >>> 0;
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth 1D noise in [-1, 1]: random values at whole numbers, eased between.
export function noise1(seed) {
  const knots = new Map();
  const at = (i) => {
    if (!knots.has(i)) knots.set(i, rng(hash(seed, i))() * 2 - 1);
    return knots.get(i);
  };
  return (x) => {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    return at(i) * (1 - u) + at(i + 1) * u;
  };
}

// ---------- point helpers ----------
const TAU = Math.PI * 2;
export const deg = (d) => (d * Math.PI) / 180;
export const lerp = (a, b, t) => a + (b - a) * t;

export function ellipse(cx, cy, rx, ry, { rot = 0, from = 0, to = TAU, n = 0 } = {}) {
  const steps = n || Math.max(12, Math.ceil(((Math.abs(to - from) / TAU) * (rx + ry) * Math.PI) / 9));
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    pts.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return pts;
}

// Catmull-Rom through the given points, so a few control points make a soft curve.
export function curve(ctrl, perSeg = 8) {
  if (ctrl.length < 3) return ctrl.map((p) => [...p]);
  const out = [];
  const P = (i) => ctrl[Math.max(0, Math.min(ctrl.length - 1, i))];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const [p0, p1, p2, p3] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push([...ctrl[ctrl.length - 1]]);
  return out;
}

// Closed Catmull-Rom loop through the control points.
export function loop(ctrl, perSeg = 8) {
  const n = ctrl.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [ctrl[(i - 1 + n) % n], ctrl[i], ctrl[(i + 1) % n], ctrl[(i + 2) % n]];
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push([...out[0]]);
  return out;
}

// Move, turn, scale and mirror points: p' = origin + R(rot) * (s * (p - pivot)).
export function tf(pts, { x = 0, y = 0, rot = 0, sx = 1, sy = 1, px = 0, py = 0 } = {}) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return pts.map(([u, v]) => {
    const a = (u - px) * sx;
    const b = (v - py) * sy;
    return [x + a * c - b * s, y + a * s + b * c];
  });
}

function resample(pts, step) {
  const out = [pts[0]];
  const lens = [0];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const seg = Math.hypot(bx - ax, by - ay);
    if (!seg) continue;
    let d = step - carry;
    while (d <= seg) {
      const t = d / seg;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
      lens.push(lens[lens.length - 1] + step);
      d += step;
    }
    carry = seg - (d - step);
  }
  const last = pts[pts.length - 1];
  const prev = out[out.length - 1];
  const tail = Math.hypot(last[0] - prev[0], last[1] - prev[1]);
  if (tail > step * 0.25 || out.length < 2) {
    out.push([...last]);
    lens.push(lens[lens.length - 1] + tail);
  }
  return { pts: out, lens, total: lens[lens.length - 1] };
}

function normals(pts) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  });
}

const f1 = (v) => (Math.round(v * 10) / 10).toString();
export function pathOf(pts, close = true) {
  if (!pts.length) return '';
  let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += `L${f1(pts[i][0])} ${f1(pts[i][1])}`;
  return close ? d + 'Z' : d;
}

// ---------- the pen ----------
// A Pen carries the look (wobble, boil, line width, ink) and the drawing
// number, so one call site draws the same stroke slightly differently on
// each new drawing while staying the same stroke.
export class Pen {
  constructor({ style, drawing = 0, seed = 1, ops = [], scale = 1 }) {
    this.style = style;
    this.drawing = drawing;
    this.seed = seed;
    this.ops = ops;
    this.scale = scale; // characters drawn smaller get thinner lines, like a real pen at a fixed size
    this.boilKey = style.boil > 0 ? drawing % 3 : 0; // three line-boil variants, as traced frames repeat
  }

  // Same page and drawing, another seed or size (one per character, so two
  // characters never wobble in step).
  child({ seed = this.seed, scale = this.scale } = {}) {
    const p = new Pen({ style: this.style, drawing: this.drawing, seed, ops: this.ops, scale });
    p.boilKey = this.boilKey;
    return p;
  }

  // Wander along a line: a still part (the same every drawing) plus a boiling part.
  wander(id, total, amp, freq = 1) {
    const still = noise1(hash(this.seed, id, 'still'));
    const fine = noise1(hash(this.seed, id, 'fine'));
    const boil = noise1(hash(this.seed, id, 'boil', this.boilKey));
    const b = this.style.boil;
    return (s) => amp * (still((s / 140) * freq) * 0.8 + fine((s / 38) * freq) * 0.25 + boil((s / 90) * freq) * b * 0.9);
  }

  // An inked line along pts. width in px at full stage size.
  // round: round ends instead of tapered ones (limbs).
  stroke(id, pts, { width = this.style.line, color = this.style.ink, closed = false, taper = 1, wobble = 1, alpha, round = false } = {}) {
    if (pts.length < 2) return;
    let src = pts;
    if (closed) {
      // Start at a seam and run a little past it, as a pen loop does.
      const r = rng(hash(this.seed, id, 'seam'))();
      const k = Math.floor(r * (pts.length - 1));
      const ring = [...pts.slice(k, -1), ...pts.slice(0, k + 1)];
      const extra = Math.max(2, Math.round(ring.length * 0.06));
      src = [...ring, ...ring.slice(1, extra + 1)];
    }
    const w = width * this.scale;
    const { pts: p, lens, total } = resample(src, Math.max(3, Math.min(9, total0(src) / 14)));
    if (p.length < 2) return;
    const nrm = normals(p);
    const off = this.wander(id, total, this.style.wobble * wobble * this.scale);
    const pressure = noise1(hash(this.seed, id, 'press', this.boilKey));
    const end = Math.min(total * 0.3, 10 + w * 2);
    const left = [];
    const right = [];
    for (let i = 0; i < p.length; i++) {
      const s = lens[i];
      const o = off(s);
      const cx = p[i][0] + nrm[i][0] * o;
      const cy = p[i][1] + nrm[i][1] * o;
      let t = 1;
      if (taper > 0 && end > 0 && !round) {
        const e = Math.min(s, total - s) / end;
        t = e >= 1 ? 1 : lerp(1 - taper * 0.8, 1, Math.sin((Math.min(1, e) * Math.PI) / 2));
      }
      const hw = (w / 2) * t * (0.82 + 0.3 * pressure(s / 70));
      left.push([cx + nrm[i][0] * hw, cy + nrm[i][1] * hw]);
      right.push([cx - nrm[i][0] * hw, cy - nrm[i][1] * hw]);
    }
    let outline = [...left, ...[...right].reverse()];
    if (round) {
      const cap = (i, back) => {
        const c = [(left[i][0] + right[i][0]) / 2, (left[i][1] + right[i][1]) / 2];
        const hw = Math.hypot(left[i][0] - c[0], left[i][1] - c[1]);
        const [nx, ny] = nrm[i];
        const [tx, ty] = back ? [-ny, nx] : [ny, -nx];
        const sgn = back ? -1 : 1;
        const arc = [];
        for (let k = 1; k < 6; k++) {
          const a = (k / 6) * Math.PI;
          arc.push([c[0] + hw * (sgn * nx * Math.cos(a) + tx * Math.sin(a)), c[1] + hw * (sgn * ny * Math.cos(a) + ty * Math.sin(a))]);
        }
        return arc;
      };
      const n = left.length;
      const rightBack = outline.slice(n);
      outline = [...left, ...cap(n - 1, false), ...rightBack, ...cap(0, true)];
    }
    this.ops.push({ d: pathOf(outline), fill: color, ...(alpha != null ? { alpha } : {}) });
  }

  // A flat colour fill for a closed shape, rougher than the outline and slipped off it.
  fill(id, pts, color, { slip = 1, alpha } = {}) {
    if (pts.length < 3 || !color) return;
    const st = this.style;
    if (st.fill != null && st.fill < 1 && st.paper) color = mix(st.paper, color, st.fill);
    const r = rng(hash(this.seed, 'slip', this.boilKey));
    const a = r() * TAU;
    const m = st.misregister * slip * this.scale * (2.2 + st.line * 0.35);
    const dx = Math.cos(a) * m;
    const dy = Math.sin(a) * m;
    const { pts: p, lens, total } = resample(pts, Math.max(4, total0(pts) / 24));
    const nrm = normals(p);
    const off = this.wander(id + ':f', total, st.wobble * 0.7 * this.scale, 0.7);
    const out = p.map(([x, y], i) => [x + dx + nrm[i][0] * off(lens[i]), y + dy + nrm[i][1] * off(lens[i])]);
    this.ops.push({ d: pathOf(out), fill: color, ...(alpha != null ? { alpha } : {}) });
    return out;
  }

  // Fill then outline: the usual way a shape is drawn.
  shape(id, pts, fillColor, opts = {}) {
    this.fill(id, pts, fillColor, opts);
    this.stroke(id, pts, { ...opts, closed: true });
  }

  // A part with volume: flat fill, a form shadow on the side away from the
  // light (two bands, a soft step), an optional rim light, then the inked
  // outline. axis = the part's long axis [[x0,y0],[x1,y1]] so the terminator
  // runs along a limb; null = a ball (head, fist), terminator is a crescent.
  form(id, pts, color, { axis = null, round = 1, rim = true, slip = 1, alpha, ...opts } = {}) {
    const slipped = this.fill(id, pts, color, { slip, alpha });
    const k = (this.style.shade ?? 0.6) * round;
    if (slipped && k > 0) {
      const [L, wide] = lightFor(this.style.light || LIGHT, pts, axis);
      const dx = L[0];
      const dy = L[1];
      const sh = mix(color, this.style.ink, 0.28 + 0.2 * k);
      const core = mix(color, this.style.ink, 0.42 + 0.25 * k);
      const hi = mix(color, '#ffffff', 0.55);
      // lit area = the shape pushed toward the light; shadow = what is left of the fill
      const kk = Math.min(1, k + 0.15);
      const part = (d, fill) => this.ops.push({ d: holed(slipped, tf(slipped, { x: dx * d, y: dy * d })), fill, clip: pathOf(slipped), ...(alpha != null ? { alpha } : {}) });
      part(wide * 0.5 * kk, sh); // wide soft shadow
      part(wide * 0.26 * kk, core); // darker core on the far edge
      if (rim) {
        const d3 = wide * 0.1;
        this.ops.push({ d: holed(slipped, tf(slipped, { x: -dx * d3, y: -dy * d3 })), fill: hi, alpha: 0.7, clip: pathOf(slipped) });
      }
    }
    this.stroke(id, pts, { ...opts, closed: true });
  }

  // A shadow shape confined to another shape: head on neck, arm across the torso.
  shade(id, shadowPts, clipPts, { color = this.style.ink, alpha = 0.22 } = {}) {
    if (shadowPts.length < 3 || clipPts.length < 3) return;
    this.ops.push({ d: pathOf(shadowPts), fill: color, alpha, clip: pathOf(clipPts) });
  }

  // A small solid blob (eye dot, button), drawn as a filled wobbly loop.
  dot(id, x, y, r, color = this.style.ink) {
    const pts = ellipse(x, y, r, r * 1.08, { n: 10 });
    const j = noise1(hash(this.seed, id, 'dot', this.boilKey));
    const out = pts.map(([px, py], i) => [px + j(i * 0.9) * r * 0.12, py + j(i * 0.9 + 50) * r * 0.12]);
    this.ops.push({ d: pathOf(out), fill: color });
  }

  text(t, x, y, size, opts = {}) {
    this.ops.push({ text: t, x, y, size, fill: opts.color || this.style.ink, align: opts.align || 'center', ...(opts.weight ? { weight: opts.weight } : {}), ...(opts.outline ? { outline: opts.outline } : {}) });
  }
}

export const LIGHT = [-0.55, -0.83]; // the light comes FROM here (upper left)

// Unit vector from the part toward the light, and the part's width across it.
// For a limb the vector is the axis normal on the lit side, so the shadow
// terminator runs along the limb; for a ball it is the light itself.
function lightFor(light, pts, axis) {
  const l = Math.hypot(light[0], light[1]) || 1;
  let v = [light[0] / l, light[1] / l];
  if (axis) {
    const ax = axis[1][0] - axis[0][0];
    const ay = axis[1][1] - axis[0][1];
    const al = Math.hypot(ax, ay) || 1;
    let n = [-ay / al, ax / al];
    if (n[0] * v[0] + n[1] * v[1] < 0) n = [-n[0], -n[1]];
    v = n;
  }
  // width of the shape measured along v
  let lo = Infinity;
  let hi = -Infinity;
  for (const [x, y] of pts) {
    const t = x * v[0] + y * v[1];
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  return [v, hi - lo];
}

// The part of `outer` not covered by `inner`: outer plus inner wound the other way
// (the painters fill nonzero, so the reversed loop cuts a hole). Needs no clipper.
function holed(outer, inner) {
  const area = (p) => p.reduce((a, [x, y], i) => a + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0);
  const o = area(outer) >= 0 ? outer : [...outer].reverse();
  const q = area(inner) >= 0 ? [...inner].reverse() : inner;
  return pathOf(o) + pathOf(q);
}

function total0(pts) {
  let t = 0;
  for (let i = 1; i < pts.length; i++) t += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return t;
}

// Mix a colour toward another (for shades and muted backgrounds).
export function mix(a, b, t) {
  const c = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [c(a), c(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

// Rough text wrap for bubbles and captions (no DOM to measure with).
export function wrap(str, maxChars) {
  const words = String(str).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > maxChars) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}
