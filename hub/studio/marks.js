// Scene marks: the little hand-drawn extras on top of a shot (labels with
// arrows, sound-effect words, sweat drops, sparkles, shock lines, hearts, "!").
// Drawn in the style's pen so they boil like everything else.
import { Pen, curve, ellipse, hash, lerp, loop, mix, pathOf, rng } from './draw.js';

const POP = 0.15; // seconds a mark takes to pop in

const easeOutBack = (u) => 1 + 2.7 * Math.pow(u - 1, 3) + 1.7 * Math.pow(u - 1, 2);

// 1 once popped in, 0.3..1.1 while popping, 0 before it appears.
export function markScale(m, t) {
  const at = m.t || 0;
  if (t < at) return 0;
  const u = Math.min(1, (t - at) / POP);
  return lerp(0.3, 1, easeOutBack(u));
}

// Scale point sets about the mark's anchor.
const grow = (pts, [ax, ay], k) => pts.map(([x, y]) => [ax + (x - ax) * k, ay + (y - ay) * k]);
// Turn point sets about a centre (radians).
const turn = (pts, [ax, ay], a) => pts.map(([x, y]) => [ax + (x - ax) * Math.cos(a) - (y - ay) * Math.sin(a), ay + (x - ax) * Math.sin(a) + (y - ay) * Math.cos(a)]);

function star(cx, cy, r, rot = 0, n = 4, inner = 0.28) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n;
    const rr = i % 2 ? r * inner : r;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  pts.push(pts[0]);
  return pts;
}

function drop(cx, cy, r) {
  return loop([[cx, cy - r * 1.7], [cx + r * 0.8, cy + r * 0.1], [cx, cy + r], [cx - r * 0.8, cy + r * 0.1]], 5);
}

function arrow(pen, id, from, to, k, st) {
  const [x0, y0] = from;
  const [x1, y1] = to;
  const mx = (x0 + x1) / 2 + (y1 - y0) * 0.12;
  const my = (y0 + y1) / 2 - (x1 - x0) * 0.12;
  const line = grow(curve([[x0, y0], [mx, my], [x1, y1]], 8), from, k);
  pen.stroke(id + 'arr', line, { width: st.line * 0.8 });
  const e = line[line.length - 1];
  const p = line[line.length - 4] || from;
  const a = Math.atan2(e[1] - p[1], e[0] - p[0]);
  for (const s of [-1, 1]) pen.stroke(id + 'head' + s, [e, [e[0] - Math.cos(a + s * 0.5) * 24 * k, e[1] - Math.sin(a + s * 0.5) * 24 * k]], { width: st.line * 0.8, round: true });
}

// ---------- gag props (f2): drawn on screen in the pen, like the other marks ----------
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const rrect = (x0, y0, x1, y1, r) => {
  const c = (cx, cy, a0) => ellipse(cx, cy, r, r, { from: a0, to: a0 + Math.PI / 2, n: 5 });
  const pts = [...c(x1 - r, y0 + r, -Math.PI / 2), ...c(x1 - r, y1 - r, 0), ...c(x0 + r, y1 - r, Math.PI / 2), ...c(x0 + r, y0 + r, Math.PI)];
  return [...pts, pts[0]];
};
// A box drawn by hand: corners a little off square (f2's sign and dropdown).
const handBox = (x0, y0, x1, y1, j) => [[x0, y0 + j], [x1 - j, y0], [x1 + j * 0.5, y1 - j * 0.4], [x0 + j * 0.6, y1 + j * 0.3], [x0, y0 + j]];
// Points of a closed outline that lie below y = yb (cut where it crosses), for the colour fade.
function below(pts, yb) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    if (a[1] >= yb) out.push(a);
    if ((a[1] - yb) * (b[1] - yb) < 0) {
      const u = (yb - a[1]) / (b[1] - a[1]);
      out.push([a[0] + (b[0] - a[0]) * u, yb]);
    }
  }
  if (out.length) out.push(out[0]);
  return out;
}
const HAIR = '#2b2d57';
const HAIR2 = '#3fb8b0';

// The goal sign (f2 still 10): a wide hand-drawn white card, the goal in thin
// handwriting across it. A number goal gets its first digit crossed out in ink
// and the new digit written above it, one stroke after the other.
function board(pen, id, x, y, k, m, st, t) {
  const lines = (m.text || '').split('|');
  const fs = 64 * k; // f2's letters are about a tenth of the frame tall
  const cw = 0.42 * fs; // one character of the hand font
  const longest = Math.max(...lines.map((l) => l.length));
  const w = (longest * cw) / 2 + 80 * k;
  const h = (lines.length * 1.15 * fs) / 2 + 36 * k;
  pen.shape(id + 'b', handBox(x - w, y - h, x + w, y + h, 6 * k), '#ffffff', { width: st.line * 0.75 });
  // quick sketchy overshoots at two corners, as f2's sign is drawn
  pen.stroke(id + 'o1', [[x + w - 30 * k, y - h - 2 * k], [x + w + 14 * k, y - h + 1 * k]], { width: st.line * 0.6 });
  pen.stroke(id + 'o2', [[x - w - 2 * k, y + h - 30 * k], [x - w + 1 * k, y + h + 14 * k]], { width: st.line * 0.6 });
  lines.forEach((l, i) => pen.text(l, x, y + (i - (lines.length - 1) / 2) * 1.15 * fs + fs * 0.32, fs, { align: 'center' }));
  if (!/^\d/.test(lines[0])) return;
  const u = (d) => Math.min(1, Math.max(0, (t - (m.t || 0) - d) / 0.12));
  const seg = (a, b, v) => [a, [a[0] + (b[0] - a[0]) * v, a[1] + (b[1] - a[1]) * v]];
  const cx = x - (lines[0].length * cw) / 2 + cw * 0.7;
  const r = 0.42 * cw;
  const top = y - fs * 0.42;
  const bot = y + fs * 0.32;
  if (u(0.35) > 0) pen.stroke(id + 'x1', seg([cx - r, top], [cx + r, bot], u(0.35)), { width: st.line * 0.9, round: true });
  if (u(0.5) > 0) pen.stroke(id + 'x2', seg([cx + r * 0.9, top], [cx - r * 0.9, bot], u(0.5)), { width: st.line * 0.9, round: true });
  if (u(0.7) >= 1) pen.text(String(Number(lines[0][0]) + 1), cx + 2 * k, top - fs * 0.08, fs * 0.6);
}

// The "Gender" dropdown (f2 still 27), drawn by hand: the title above, the closed
// field with its first option and a "v" tab, the open list below, last row pink.
// text = "Gender|Female|Male|Artist girl" (title, then options).
function card(pen, id, x, y, k, m, st) {
  const [title = 'Gender', ...opts0] = (m.text || 'Gender').split('|');
  const opts = opts0.length ? opts0 : ['Female', 'Male'];
  const w = 184 * k;
  const fh = 62 * k; // field height
  const rh = 70 * k; // row height
  const total = 50 * k + fh + rh * opts.length;
  const top = y - total / 2;
  const x0 = x - w;
  const x1 = x + w;
  const fs = 40 * k;
  pen.text(title, x0 + 14 * k, top + 38 * k, 44 * k, { align: 'left' });
  const f0 = top + 50 * k;
  pen.shape(id + 'fd', handBox(x0, f0, x1, f0 + fh, 3 * k), '#ffffff', { width: st.line * 0.75 });
  pen.text(opts[0], x0 + 12 * k, f0 + fh * 0.72, fs, { align: 'left' });
  pen.stroke(id + 'tab', [[x1 - 64 * k, f0 + 4 * k], [x1 - 62 * k, f0 + fh - 4 * k]], { width: st.line * 0.7 });
  pen.stroke(id + 'v', [[x1 - 46 * k, f0 + fh * 0.32], [x1 - 32 * k, f0 + fh * 0.68], [x1 - 16 * k, f0 + fh * 0.3]], { width: st.line * 0.75, round: true });
  const l0 = f0 + fh;
  pen.shape(id + 'ls', handBox(x0, l0, x1, l0 + rh * opts.length, 3 * k), '#ffffff', { width: st.line * 0.75 });
  opts.forEach((o, i) => {
    const yy = l0 + i * rh;
    if (i === opts.length - 1) pen.shape(id + 'hl', rect(x0, yy, x1, yy + rh), '#dfa3ad', { width: st.line * 0.75 });
    else if (i) pen.stroke(id + 'rl' + i, [[x0, yy], [x1, yy + 1]], { width: st.line * 0.6 });
    pen.text(o, x0 + 12 * k, yy + rh * 0.68, fs, { align: 'left', color: i === opts.length - 1 ? mix(st.ink, '#ffffff', 0.25) : st.ink });
  });
}

// Phone held up to the viewer: screen full of comment bubbles.
function phone(pen, id, x, y, k, m, st, t) {
  const w = 120 * k;
  const h = 210 * k;
  pen.shape(id + 'ph', rrect(x - w, y - h, x + w, y + h, 26 * k), '#3b3f4a');
  pen.shape(id + 'sc', rrect(x - w + 14 * k, y - h + 26 * k, x + w - 14 * k, y + h - 26 * k, 10 * k), '#cfeaf8');
  const n = 4;
  for (let i = 0; i < n; i++) {
    if (t - (m.t || 0) < 0.15 + i * 0.12) break;
    const yy = y - h + 62 * k + i * 82 * k;
    pen.dot(id + 'av' + i, x - w + 48 * k, yy + 14 * k, 12 * k, mix('#f08a9b', '#8ec5e6', i / n));
    pen.shape(id + 'bub' + i, rrect(x - w + 70 * k, yy - 10 * k, x + w - 30 * k - (i % 2) * 18 * k, yy + 38 * k, 10 * k), '#ffffff');
    pen.stroke(id + 'tx' + i, [[x - w + 84 * k, yy + 14 * k], [x + w - 56 * k - (i % 2) * 18 * k, yy + 14 * k]], { width: st.line * 0.5, color: mix(st.ink, '#ffffff', 0.5) });
  }
}

// The pan on the stove (f2 still 38): a dark pan seen from above at a slant, the
// handle out to the front right, a tall coral fire with two labelled jars in it
// (text "A|B" names the jars) and smoke curls rising.
function pan(pen, id, x, y, k, m, st) {
  pen.shape(id + 'handle', loop([[x + 70 * k, y + 14 * k], [x + 190 * k, y + 64 * k], [x + 196 * k, y + 88 * k], [x + 170 * k, y + 90 * k], [x + 64 * k, y + 34 * k]], 3), '#2b2529');
  pen.shape(id + 'pan', ellipse(x, y, 150 * k, 46 * k, { n: 22 }), '#2b2529');
  pen.fill(id + 'in', ellipse(x - 4 * k, y - 4 * k, 128 * k, 34 * k, { n: 20 }), '#4a4248', { slip: 0.2 });
  const flame = (cx, w, hgt, j) => loop([[cx - w, y], [cx - w * 1.05, y - hgt * 0.45], [cx - w * 0.5, y - hgt * 0.7], [cx - w * 0.2 + j, y - hgt], [cx + w * 0.1, y - hgt * 0.62], [cx + w * 0.5 + j, y - hgt * 0.88], [cx + w * 0.8, y - hgt * 0.5], [cx + w, y]], 5);
  const wob = (i) => ((hash('fl', i, pen.boilKey) % 7) - 3) * 3 * k;
  pen.fill(id + 'fl0', flame(x - 10 * k, 120 * k, 270 * k, wob(0)), '#f07a5a', { slip: 0.3 });
  pen.fill(id + 'fl1', flame(x + 10 * k, 90 * k, 200 * k, wob(1)), '#f5a080', { slip: 0.3 });
  pen.stroke(id + 'fl', flame(x - 10 * k, 120 * k, 270 * k, wob(0)), { width: st.line * 0.5, color: '#d0583e' });
  const names = (m.text || '').split('|').filter(Boolean);
  names.slice(0, 2).forEach((nm, i) => {
    const jx = x + (i ? 62 : -62) * k;
    pen.shape(id + 'jar' + i, rect(jx - 46 * k, y - 96 * k, jx + 46 * k, y + 4 * k), '#f3dcc8', { width: st.line * 0.7 });
    pen.stroke(id + 'lid' + i, [[jx - 46 * k, y - 82 * k], [jx + 46 * k, y - 82 * k]], { width: st.line * 0.6 });
    nm.split(' ').slice(0, 2).forEach((wd, j) => pen.text(wd, jx, y - 52 * k + j * 26 * k, 22 * k, { color: '#a0402e' }));
  });
  for (let i = 0; i < 2; i++) {
    const sx = x + (i ? 50 : 4) * k;
    pen.stroke(id + 'sm' + i, curve([[sx, y - 300 * k], [sx + 14 * k, y - 340 * k], [sx - 6 * k, y - 380 * k], [sx + 8 * k, y - 420 * k]], 5), { width: st.line * 1.6 * k, color: '#f3a08a', round: true });
  }
}

// The cooker (f2 still 38): a light grey counter seen from its front-left corner,
// a dark hob plate on the top, a front with two drawer handles, rough grey marker
// shading. (x, y) = the front corner of the top; it runs off the left edge.
function stove(pen, id, x, y, k, m, st) {
  const W = 1600;
  const H = 900;
  const R = x + 0.32 * W * k; // right end of the front
  const back = y - 0.15 * H * k; // back edge of the top
  const top = [[-40, y - 0.13 * H * k], [x - 0.12 * W * k, back + 6 * k], [R - 10 * k, back - 10 * k], [R + 6 * k, y - 4 * k], [x, y], [-40, y + 0.05 * H * k], [-40, y - 0.13 * H * k]];
  pen.shape(id + 'top', top, '#dcdcde', { width: st.line * 0.7 });
  pen.shape(id + 'front', [[x, y], [R + 6 * k, y - 4 * k], [R + 6 * k, H + 40], [x, H + 40], [x, y]], '#c9c9cc', { width: st.line * 0.7 });
  pen.shape(id + 'side', [[-40, y + 0.05 * H * k], [x, y], [x, H + 40], [-40, H + 40], [-40, y + 0.05 * H * k]], '#b4b4b8', { width: st.line * 0.7 });
  pen.stroke(id + 'lip', [[x + 4 * k, y + 22 * k], [R, y + 18 * k]], { width: st.line * 0.6, color: mix(st.ink, '#ffffff', 0.4) });
  // grey marker strokes along the top, like f2's quick shading
  const r = rng(hash('stove', id));
  for (let i = 0; i < 5; i++) {
    const yy = back + (0.03 + i * 0.022) * H * k;
    pen.stroke(id + 'mk' + i, [[20 + r() * 60, yy + 20 * k], [x + (0.05 + r() * 0.1) * W * k, yy]], { width: 10 * k, color: '#c4c4c8', round: true });
  }
  // hob plate
  const hx = x + 0.02 * W * k;
  pen.shape(id + 'hob', [[hx, y - 0.02 * H * k], [hx + 0.04 * W * k, back + 0.02 * H * k], [R - 0.02 * W * k, back + 0.015 * H * k], [R - 0.035 * W * k, y - 0.02 * H * k], [hx, y - 0.02 * H * k]], '#3c373f', { width: st.line * 0.7 });
  // drawer handles
  for (const f of [0.14, 0.27]) {
    const yy = y + f * H * k;
    pen.shape(id + 'dr' + f, rect(x + 0.045 * W * k, yy, R - 0.02 * W * k, yy + 16 * k), '#77757c', { width: st.line * 0.6 });
  }
  pen.stroke(id + 'seam', [[x + 0.03 * W * k, y + 0.07 * H * k], [R, y + 0.065 * H * k]], { width: st.line * 0.5, color: mix(st.ink, '#ffffff', 0.45) });
}

// A shrimp standing up straight like a person ("after" the posture fix, f2 still 46):
// a tall body that fills the frame, ribbed, the tail fan as feet, the pointed head
// with an eye and feelers up top, one arm bent on the hip.
function shrimpUp(pen, id, x, y, k, m, st) {
  const n = 9; // spine points, bottom (tail) to top (head)
  const L = 400 * k; // half the height
  const spine = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    spine.push([x + Math.sin(u * Math.PI) * 14 * k - u * 10 * k, y + L - u * L * 1.75]);
  }
  const half = (u) => (18 + 66 * Math.sin(Math.min(1, u * 1.12) * Math.PI * 0.82)) * k;
  const Ls = spine.map(([sx, sy], i) => [sx - half(i / (n - 1)), sy]);
  const Rs = spine.map(([sx, sy], i) => [sx + half(i / (n - 1)) * (i > n - 4 ? 0.8 : 1), sy]);
  const top = spine[n - 1];
  const head = [[top[0] - 40 * k, top[1]], [top[0] - 22 * k, top[1] - 80 * k], [top[0] - 4 * k, top[1] - 150 * k], [top[0] + 14 * k, top[1] - 90 * k], [top[0] + 44 * k, top[1]]];
  const body = curve([...Ls, ...head, ...[...Rs].reverse()], 3);
  const col = '#e2725e';
  const [bx, by] = spine[0];
  for (const s2 of [-1, 1]) pen.shape(id + 'tf' + s2, loop([[bx, by - 10 * k], [bx + s2 * 50 * k, by + 40 * k], [bx + s2 * 30 * k, by + 70 * k], [bx + s2 * 6 * k, by + 30 * k]], 4), col, { width: st.line * 0.6 });
  pen.shape(id + 'sh', [...body, body[0]], col, { width: st.line * 0.7 });
  for (let i = 2; i < n - 2; i++) {
    const [sx, sy] = spine[i];
    const h = half(i / (n - 1));
    pen.stroke(id + 'sg' + i, curve([[sx - h * 0.9, sy + 4 * k], [sx, sy + 10 * k], [sx + h * 0.9, sy]], 4), { width: st.line * 0.5 });
  }
  // the left feeler-leg hanging down the front, the arm bent on the hip at right
  const [cx, cy] = spine[n - 3];
  const h3 = half((n - 3) / (n - 1));
  pen.shape(id + 'leg', [[cx - h3 + 4 * k, cy + 40 * k], [cx - h3 - 24 * k, cy + 240 * k], [cx - h3 + 6 * k, cy + 140 * k], [cx - h3 + 4 * k, cy + 40 * k]], col, { width: st.line * 0.6 });
  pen.shape(id + 'arm', [[cx + h3 - 10 * k, cy - 20 * k], [cx + h3 + 60 * k, cy + 30 * k], [cx + h3 + 20 * k, cy + 140 * k], [cx + h3 - 4 * k, cy + 130 * k], [cx + h3 + 30 * k, cy + 40 * k], [cx + h3 - 10 * k, cy + 20 * k], [cx + h3 - 10 * k, cy - 20 * k]], col, { width: st.line * 0.6 });
  pen.dot(id + 'eye', top[0] - 4 * k, top[1] - 70 * k, 6 * k);
  pen.stroke(id + 'f1', curve([[top[0] + 4 * k, top[1] - 140 * k], [top[0] + 24 * k, top[1] - 190 * k], [top[0] + 36 * k, top[1] - 230 * k]], 5), { width: st.line * 0.55 });
  pen.stroke(id + 'f2', curve([[top[0] + 10 * k, top[1] - 130 * k], [top[0] + 40 * k, top[1] - 170 * k], [top[0] + 52 * k, top[1] - 210 * k]], 5), { width: st.line * 0.55 });
}

// A cartoon shrimp in profile, hunched (f2 still 44): the head at the left with its
// beak, eye and a long feeler looping up, the ribbed back arching right and the
// tail curling down and back under it, little legs underneath.
// text "after": it stands up straight instead; "desk": small, on a stool at a desk.
function shrimp(pen, id, x, y, k, m, st) {
  if (m.text === 'after') return shrimpUp(pen, id, x, y, k, m, st);
  const col = '#e2725e';
  // spine: head (left) -> back (right) -> tail curling under (left)
  const sp = curve([[x - 190 * k, y - 60 * k], [x - 40 * k, y - 50 * k], [x + 110 * k, y], [x + 130 * k, y + 110 * k], [x + 40 * k, y + 170 * k], [x - 60 * k, y + 160 * k]], 6);
  const n = sp.length;
  const half = (i) => {
    const u = i / (n - 1);
    return (u < 0.15 ? 18 + u * 300 : 62 - (u - 0.15) * 56) * k;
  };
  const side = (s) => sp.map((p, i) => {
    const q = sp[Math.min(n - 1, i + 1)];
    const o = sp[Math.max(0, i - 1)];
    const dx = q[0] - o[0];
    const dy = q[1] - o[1];
    const l = Math.hypot(dx, dy) || 1;
    return [p[0] - (dy / l) * half(i) * s, p[1] + (dx / l) * half(i) * s];
  });
  const outer = side(-1);
  const inner = side(1);
  const head = sp[0];
  const body = [[head[0] - 40 * k, head[1] - 4 * k], ...outer, [sp[n - 1][0] - 30 * k, sp[n - 1][1] + 10 * k], ...[...inner].reverse(), [head[0] - 40 * k, head[1] - 4 * k]];
  // tail fan
  const tl = sp[n - 1];
  pen.shape(id + 'tail', [[tl[0] + 10 * k, tl[1] - 20 * k], [tl[0] - 70 * k, tl[1] - 26 * k], [tl[0] - 50 * k, tl[1] + 6 * k], [tl[0] - 80 * k, tl[1] + 30 * k], [tl[0] + 10 * k, tl[1] + 24 * k], [tl[0] + 10 * k, tl[1] - 20 * k]], col, { width: st.line * 0.6 });
  pen.shape(id + 'sh', body, col, { width: st.line * 0.7 });
  // beak and rib lines across the back
  pen.stroke(id + 'bk', [[head[0] - 40 * k, head[1] - 4 * k], [head[0] - 80 * k, head[1] - 8 * k]], { width: st.line * 0.6 });
  for (let i = 1; i < 6; i++) {
    const j = Math.round((n - 1) * (0.22 + i * 0.12));
    pen.stroke(id + 'sg' + i, [outer[j], inner[j]], { width: st.line * 0.5 });
  }
  pen.dot(id + 'eye', head[0] - 10 * k, head[1] - 16 * k, 6 * k);
  // feeler: a long loop up and over (f2); the big "before" shrimp's runs in a hook from
  // its mouth round to the left and straight up off the top of the frame (still 44)
  if (m.text === 'before') {
    const [mx, my] = [head[0] - 40 * k, head[1] + 4 * k];
    const D = my + 20 * k;
    const x0 = mx - 0.13 * D;
    pen.stroke(id + 'f1', curve([[mx, my], [x0 - 0.1 * D, my + 0.05 * D], [x0 - 0.25 * D, my - 0.15 * D], [x0 - 0.25 * D, my - 0.42 * D], [x0 + 0.04 * D, my - 0.7 * D], [x0, -20 * k]], 6), { width: st.line * 0.5 });
  } else pen.stroke(id + 'f1', curve([[head[0] - 30 * k, head[1] - 10 * k], [head[0] - 110 * k, head[1] + 10 * k], [head[0] - 100 * k, head[1] - 80 * k], [head[0] - 70 * k, head[1] - 170 * k], [head[0] - 80 * k, head[1] - 230 * k]], 6), { width: st.line * 0.55 });
  // little legs under the body
  for (let i = 0; i < 4; i++) {
    const j = Math.round((n - 1) * (0.12 + i * 0.07));
    const p = inner[j];
    pen.stroke(id + 'lg' + i, [p, [p[0] - 30 * k, p[1] + 34 * k]], { width: st.line * 0.55, round: true });
  }
  if (m.text === 'desk') {
    // on a bar stool, hunched at a little desk with a pen (f2 still 15)
    pen.stroke(id + 'stool', [[x + 40 * k, y + 170 * k], [x + 40 * k, y + 330 * k]], { width: st.line * 0.8 });
    pen.stroke(id + 'sbase', [[x - 20 * k, y + 330 * k], [x + 100 * k, y + 330 * k]], { width: st.line * 0.8 });
    pen.shape(id + 'sback', ellipse(x + 210 * k, y + 60 * k, 34 * k, 60 * k, { n: 14 }), '#3a2a3f', { width: st.line * 0.7 });
    pen.stroke(id + 'desk', [[head[0] - 200 * k, head[1] + 60 * k], [head[0] + 10 * k, head[1] + 56 * k]], { width: st.line * 0.8 });
    pen.stroke(id + 'dleg', [[head[0] - 160 * k, head[1] + 60 * k], [head[0] - 150 * k, head[1] + 300 * k]], { width: st.line * 0.8 });
    pen.stroke(id + 'pen', [[head[0] - 120 * k, head[1] + 50 * k], [head[0] - 40 * k, head[1] - 10 * k]], { width: st.line * 0.8, round: true });
  }
}

// The lead's head just peeking up over the bottom edge (f2 still 10): only the
// crown of her hair shows, messy, navy fading to teal toward the frame edge.
function peek(pen, id, x, y, k, m, st, t) {
  const rise = Math.min(1, Math.max(0, (t - (m.t || 0)) / 0.25));
  const top = y + (1 - rise) * 260 * k; // y = where the hair crown ends up
  const w = 168 * k;
  const hair = loop([[x - w * 1.04, top + 320 * k], [x - w, top + 150 * k], [x - w * 0.86, top + 64 * k], [x - w * 0.5, top + 14 * k], [x + w * 0.05, top], [x + w * 0.55, top + 16 * k], [x + w * 0.9, top + 70 * k], [x + w, top + 160 * k], [x + w * 1.04, top + 320 * k]], 6);
  const col = st.peekHair || HAIR;
  const filled = pen.fill(id + 'hair', hair, col);
  if (filled) {
    pen.ops.push({ d: pathOf(below(filled, top + 120 * k)), fill: mix(col, HAIR2, 0.22), alpha: 0.9, clip: pathOf(filled) });
    pen.ops.push({ d: pathOf(below(filled, top + 190 * k)), fill: mix(col, HAIR2, 0.45), alpha: 0.9, clip: pathOf(filled) });
  }
  pen.stroke(id + 'hairL', hair, { closed: true, width: st.line * 0.9 });
  // flyaway tips at the crown and the sides, and a few strand lines
  const tip = (a, b, c) => pen.stroke(id + 'tp' + a[0], curve([a, b, c], 4), { width: st.line * 0.8, round: true });
  tip([x - w * 0.86, top + 64 * k], [x - w * 1.08, top + 44 * k], [x - w * 1.2, top + 54 * k]);
  tip([x + w * 0.9, top + 70 * k], [x + w * 1.08, top + 50 * k], [x + w * 1.2, top + 62 * k]);
  tip([x + w * 0.05, top], [x + w * 0.22, top - 20 * k], [x + w * 0.4, top - 14 * k]);
  tip([x - w * 0.5, top + 14 * k], [x - w * 0.62, top - 6 * k], [x - w * 0.8, top - 2 * k]);
  for (const [dx, len] of [[-0.55, 120], [-0.1, 90], [0.3, 110], [0.7, 80]]) {
    pen.stroke(id + 'st' + dx, curve([[x + w * dx, top + 30 * k], [x + w * (dx - 0.06), top + (30 + len * 0.5) * k], [x + w * (dx - 0.02), top + (30 + len) * k]], 4), { width: st.line * 0.55, color: mix(st.ink, '#ffffff', 0.2) });
  }
}

// The thumbnail of her first video (f2 still 4): a hot-pink frame, the girl close
// up looking back over her shoulder, a hand reaching in, a white shout bubble at
// the top left (text, "|" breaks lines) and little "zz" marks.
function thumb(pen, id, x, y, k, m, st) {
  const w = 232 * k;
  const h = 132 * k;
  const box = rect(x - w, y - h, x + w, y + h);
  const bg = pen.fill(id + 'fr', box, '#e8378a', { slip: 0 });
  const clip = pathOf(bg || box);
  pen.ops.push({ d: pathOf(rect(x - w, y - h, x + w, y - h * 0.15)), fill: '#a8185a', alpha: 0.75, clip });
  pen.ops.push({ d: pathOf(rect(x - w, y - h * 0.15, x + w, y + h * 0.35)), fill: '#c81f6c', alpha: 0.6, clip });
  // the girl: hair mass, face, big eyes
  const gx = x - 10 * k;
  pen.ops.push({ d: pathOf(loop([[gx - 120 * k, y + h], [gx - 130 * k, y - 20 * k], [gx - 80 * k, y - 110 * k], [gx + 10 * k, y - 126 * k], [gx + 100 * k, y - 96 * k], [gx + 130 * k, y - 10 * k], [gx + 120 * k, y + h]], 6)), fill: '#3a1d3a', clip });
  pen.ops.push({ d: pathOf(loop([[gx - 70 * k, y - 30 * k], [gx + 70 * k, y - 30 * k], [gx + 64 * k, y + 50 * k], [gx, y + 92 * k], [gx - 64 * k, y + 50 * k]], 6)), fill: '#f2c9cf', clip });
  pen.ops.push({ d: pathOf(loop([[gx - 84 * k, y - 34 * k], [gx - 40 * k, y - 80 * k], [gx + 10 * k, y - 60 * k], [gx + 60 * k, y - 90 * k], [gx + 86 * k, y - 30 * k], [gx + 30 * k, y - 50 * k], [gx - 20 * k, y - 36 * k]], 5)), fill: '#3a1d3a', clip });
  for (const s of [-1, 1]) {
    pen.ops.push({ d: pathOf(ellipse(gx + s * 34 * k, y + 4 * k, 20 * k, 22 * k, { n: 12 })), fill: '#ffffff', clip });
    pen.ops.push({ d: pathOf(ellipse(gx + s * 34 * k, y + 6 * k, 13 * k, 16 * k, { n: 12 })), fill: '#e2245a', clip });
    pen.ops.push({ d: pathOf(ellipse(gx + s * 30 * k, y, 4 * k, 4 * k, { n: 8 })), fill: '#ffffff', clip });
  }
  pen.ops.push({ d: pathOf(ellipse(gx, y + 54 * k, 12 * k, 8 * k, { n: 10 })), fill: '#8c2a3a', clip });
  // a hand reaching in from the right
  pen.ops.push({ d: pathOf(loop([[x + w, y + 30 * k], [x + 110 * k, y - 10 * k], [x + 80 * k, y + 30 * k], [x + 96 * k, y + 70 * k], [x + w, y + 110 * k]], 5)), fill: '#e8b4bc', clip });
  pen.stroke(id + 'edge', box, { closed: true, width: st.line * 0.5, color: '#7a1040' });
  // shout bubble, top left
  const bx = x - w + 84 * k;
  const by = y - h + 58 * k;
  pen.fill(id + 'bub', [[bx - 76 * k, by - 50 * k], [bx + 74 * k, by - 50 * k], [bx + 74 * k, by + 34 * k], [bx + 92 * k, by + 58 * k], [bx + 40 * k, by + 34 * k], [bx - 76 * k, by + 34 * k], [bx - 76 * k, by - 50 * k]], '#ffffff', { slip: 0 });
  const lines = (m.text || 'WHERE YOU|GOING?').split('|');
  lines.forEach((l, i) => pen.text(l, bx, by - 14 * k + i * 26 * k, 20 * k, { color: '#b0185f', weight: 700, sans: true }));
  for (const [zx, zy] of [[x + w - 60 * k, y - h + 30 * k], [x - w + 30 * k, y + h - 40 * k]]) {
    for (let j = 0; j < 2; j++) pen.stroke(id + 'z' + zx + j, [[zx + j * 22 * k, zy], [zx + 14 * k + j * 22 * k, zy], [zx + j * 22 * k, zy + 14 * k], [zx + 14 * k + j * 22 * k, zy + 14 * k]], { width: st.line * 0.5, color: '#ffffff' });
  }
}

// Drawing tablet lying on a desk with a pen and a scribble on its screen.
function tablet(pen, id, x, y, k, m, st) {
  const w = 190 * k;
  const body = [[x - w, y + 10 * k], [x - w + 36 * k, y - 38 * k], [x + w + 36 * k, y - 38 * k], [x + w, y + 10 * k], [x - w, y + 10 * k]];
  pen.shape(id + 'tb', body, '#4a4650');
  pen.fill(id + 'scr', [[x - w + 26 * k, y + 2 * k], [x - w + 52 * k, y - 28 * k], [x + w + 18 * k, y - 28 * k], [x + w - 8 * k, y + 2 * k], [x - w + 26 * k, y + 2 * k]], '#d9edf6', { slip: 0.2 });
  pen.stroke(id + 'sc', curve([[x - 80 * k, y - 8 * k], [x - 30 * k, y - 22 * k], [x + 20 * k, y - 4 * k], [x + 80 * k, y - 20 * k]], 6), { width: st.line * 0.7, color: '#d9453d' });
  pen.stroke(id + 'pen', [[x + 120 * k, y - 4 * k], [x + 230 * k, y - 70 * k]], { width: st.line * 1.5 * k, color: '#2a2340', round: true });
}

// f2's mascots. Default: the stern white ghost (still 20): a round-topped blob with
// stubby arms out to the sides, a maroon ahoge curl, big half-lidded eyes under
// heavy brows, a small frown and a little pencil held up. text "apple": the red
// apple-head chibi in a white smock (still 32), eyes squeezed shut.
function mascot(pen, id, x, y, k, m, st) {
  if (m.text === 'apple') {
    const red = '#cf5650';
    for (const s of [-1, 1]) {
      pen.shape(id + 'ft' + s, ellipse(x + s * 34 * k, y + 160 * k, 28 * k, 22 * k, { n: 12 }), red);
      pen.shape(id + 'ar' + s, ellipse(x + s * 112 * k, y + 70 * k, 22 * k, 28 * k, { n: 12 }), red);
    }
    pen.shape(id + 'smock', loop([[x - 70 * k, y - 10 * k], [x + 70 * k, y - 10 * k], [x + 110 * k, y + 40 * k], [x + 92 * k, y + 60 * k], [x + 86 * k, y + 140 * k], [x - 86 * k, y + 144 * k], [x - 92 * k, y + 60 * k], [x - 110 * k, y + 40 * k]], 4), '#ffffff');
    pen.shape(id + 'head', loop([[x, y - 170 * k], [x + 80 * k, y - 160 * k], [x + 118 * k, y - 90 * k], [x + 92 * k, y - 18 * k], [x, y + 2 * k], [x - 92 * k, y - 18 * k], [x - 118 * k, y - 90 * k], [x - 80 * k, y - 160 * k]], 5), red);
    pen.stroke(id + 'stem', curve([[x, y - 168 * k], [x - 6 * k, y - 200 * k], [x + 6 * k, y - 236 * k]], 4), { width: st.line * 1.8 * k, color: '#5a2a2a', round: true });
    pen.shape(id + 'leaf', loop([[x + 4 * k, y - 196 * k], [x + 40 * k, y - 220 * k], [x + 76 * k, y - 200 * k], [x + 40 * k, y - 186 * k]], 4), '#5f9e77');
    for (const s of [-1, 1]) {
      pen.stroke(id + 'eye' + s, [[x + s * 70 * k, y - 104 * k], [x + s * 42 * k, y - 96 * k], [x + s * 66 * k, y - 86 * k]], { width: st.line * 0.8, round: true });
      for (let j = 0; j < 3; j++) pen.stroke(id + 'bl' + s + j, [[x + s * (52 + j * 9) * k, y - 66 * k], [x + s * (48 + j * 9) * k, y - 56 * k]], { width: st.line * 0.5 });
    }
    pen.stroke(id + 'brow', [[x - 10 * k, y - 122 * k], [x, y - 116 * k], [x + 10 * k, y - 122 * k]], { width: st.line * 0.6 });
    return;
  }
  const body = loop([[x - 120 * k, y + 120 * k], [x - 112 * k, y + 20 * k], [x - 176 * k, y + 6 * k], [x - 160 * k, y - 22 * k], [x - 112 * k, y - 24 * k], [x - 96 * k, y - 120 * k], [x, y - 176 * k], [x + 100 * k, y - 120 * k], [x + 112 * k, y - 24 * k], [x + 160 * k, y - 30 * k], [x + 176 * k, y + 0 * k], [x + 116 * k, y + 20 * k], [x + 120 * k, y + 120 * k], [x, y + 128 * k]], 5);
  pen.fill(id + 'bl', body, '#ffffff');
  pen.stroke(id + 'blo', body.slice(0, Math.round(body.length * 0.9)), { width: st.line * 1.1 });
  pen.shape(id + 'ah', loop([[x - 6 * k, y - 176 * k], [x - 14 * k, y - 210 * k], [x + 20 * k, y - 226 * k], [x + 34 * k, y - 200 * k], [x + 12 * k, y - 206 * k], [x + 4 * k, y - 178 * k]], 4), '#9a3a52');
  for (const s of [-1, 1]) {
    const ex = x + s * 54 * k;
    pen.shape(id + 'ew' + s, ellipse(ex, y - 52 * k, 28 * k, 30 * k, { n: 14 }), '#ffffff', { width: st.line * 0.8 });
    pen.fill(id + 'ir' + s, ellipse(ex, y - 46 * k, 20 * k, 22 * k, { n: 12 }), '#6a3040', { slip: 0 });
    pen.fill(id + 'lid' + s, rect(ex - 30 * k, y - 84 * k, ex + 30 * k, y - 60 * k), '#ffffff', { slip: 0 });
    pen.stroke(id + 'lidl' + s, [[ex - 30 * k, y - 62 * k], [ex + 30 * k, y - 60 * k]], { width: st.line * 1.1, round: true });
    pen.stroke(id + 'br' + s, [[ex - s * 30 * k, y - 96 * k], [ex + s * 34 * k, y - 82 * k]], { width: st.line * 1.5, round: true });
  }
  pen.stroke(id + 'mo', curve([[x - 14 * k, y + 4 * k], [x, y - 2 * k], [x + 14 * k, y + 4 * k]], 3), { width: st.line * 0.7, round: true });
  // little pencil held up at the right
  const px = x + 150 * k;
  const py = y - 10 * k;
  pen.shape(id + 'pc', [[px - 8 * k, py], [px + 8 * k, py + 4 * k], [px + 28 * k, py - 60 * k], [px + 12 * k, py - 64 * k], [px - 8 * k, py]], '#ffffff', { width: st.line * 0.7 });
  pen.fill(id + 'tip', [[px + 12 * k, py - 64 * k], [px + 28 * k, py - 60 * k], [px + 24 * k, py - 82 * k], [px + 12 * k, py - 64 * k]], st.ink, { slip: 0 });
}

// A reaction photo. Default: night sky and a tiny crying figure. text "cat": f2's
// shocked-cat meme (still 32) drawn as a cartoon: a black-and-white cat with paws
// pressed to its mouth and wet eyes, on a grey-pink wall.
function photo(pen, id, x, y, k, m, st) {
  if (m.text === 'cat') {
    const w = 190 * k;
    const h = 168 * k;
    const box = rect(x - w, y - h, x + w, y + h);
    const bg = pen.fill(id + 'wall', box, '#cdbfc0', { slip: 0 });
    const clip = pathOf(bg || box);
    const P = (pts, fill) => pen.ops.push({ d: pathOf(pts), fill, clip });
    const grey = '#9a8f92';
    const L = (key, pts) => pen.stroke(id + key, pts, { closed: true, width: st.line * 0.45, color: grey });
    // body: white chest, a black patch low at the left
    P(loop([[x - 170 * k, y + h], [x - 150 * k, y + 30 * k], [x + 110 * k, y + 20 * k], [x + 150 * k, y + h]], 5), '#f2f0f0');
    P(loop([[x - w, y + 40 * k], [x - 100 * k, y + 90 * k], [x - 60 * k, y + h], [x - w, y + h]], 4), '#1f1c20');
    // ears, head (white), black cap over the top with a white blaze down the middle
    for (const s of [-1, 1]) P([[x - 20 * k + s * 60 * k, y - 110 * k], [x - 20 * k + s * 150 * k, y - 160 * k], [x - 20 * k + s * 110 * k, y - 60 * k]], '#1a171b');
    const head = ellipse(x - 20 * k, y - 40 * k, 112 * k, 86 * k, { n: 24 });
    P(head, '#f4f2f2');
    pen.ops.push({ d: pathOf(loop([[x - 140 * k, y - 50 * k], [x - 100 * k, y - 130 * k], [x - 20 * k, y - 140 * k], [x + 70 * k, y - 126 * k], [x + 100 * k, y - 50 * k], [x + 20 * k, y - 66 * k], [x - 20 * k, y - 20 * k], [x - 60 * k, y - 66 * k]], 4)), fill: '#1a171b', clip: pathOf(head) });
    for (const s of [-1, 1]) {
      const ex = x - 20 * k + s * 48 * k;
      P(ellipse(ex, y - 34 * k, 22 * k, 17 * k, { n: 12 }), '#2a2226');
      P(ellipse(ex - 6 * k, y - 40 * k, 7 * k, 6 * k, { n: 8 }), '#ffffff');
      P(ellipse(ex + 7 * k, y - 28 * k, 4 * k, 3 * k, { n: 8 }), '#ffffff');
      pen.stroke(id + 'tear' + s, [[ex + s * 4 * k, y - 16 * k], [ex + s * 6 * k, y + 2 * k]], { width: st.line * 0.5, color: '#9ec9e0', round: true });
    }
    P(ellipse(x - 20 * k, y - 6 * k, 9 * k, 6 * k, { n: 10 }), '#d89aa0');
    // paws pressed to the mouth, outlined in grey so they read on the white face
    const pawL = loop([[x - 66 * k, y + 80 * k], [x - 60 * k, y + 8 * k], [x - 30 * k, y], [x - 24 * k, y + 70 * k]], 4);
    const pawR = loop([[x - 14 * k, y + 76 * k], [x - 12 * k, y + 2 * k], [x + 18 * k, y - 2 * k], [x + 26 * k, y + 72 * k]], 4);
    P(pawL, '#ffffff');
    P(pawR, '#ffffff');
    L('pl', pawL);
    L('pr', pawR);
    L('hd', head);
    for (const px of [-48, -38, 0, 10]) pen.stroke(id + 'pw' + px, [[x + px * k, y + 6 * k], [x + px * k, y + 22 * k]], { width: st.line * 0.4, color: grey });
    return;
  }
  const w = 190 * k;
  const h = 150 * k;
  pen.shape(id + 'fr', rrect(x - w - 14 * k, y - h - 14 * k, x + w + 14 * k, y + h + 40 * k, 8 * k), '#ffffff');
  pen.fill(id + 'sky', rect(x - w, y - h, x + w, y + h), '#6f6886', { slip: 0.2 });
  pen.fill(id + 'moon', ellipse(x + 90 * k, y - 80 * k, 30 * k, 30 * k, { n: 12 }), '#fff2a8', { slip: 0.3 });
  pen.shape(id + 'bd', loop([[x - 60 * k, y + h], [x - 56 * k, y + 40 * k], [x - 20 * k, y + 20 * k], [x + 20 * k, y + 40 * k], [x + 24 * k, y + h]], 4), '#3b3040');
  pen.shape(id + 'hd', ellipse(x - 20 * k, y + 0 * k, 36 * k, 38 * k, { n: 12 }), '#f6e0da');
  for (const s2 of [-1, 1]) pen.stroke(id + 'tr' + s2, [[x - 20 * k + s2 * 14 * k, y + 8 * k], [x - 20 * k + s2 * 16 * k, y + 32 * k]], { width: st.line * 0.7, color: '#6fb6e8', round: true });
  if (m.text) pen.text(m.text, x, y + h + 24 * k, 30 * k);
}

// Speed lines (f2 still 19): long ink streaks slashing up to the right across the
// whole shot (over her), with a few pale smears between them.
function speed(pen, id, x, y, k, m, st) {
  const r = rng(hash('speed', pen.boilKey, id));
  const a = -0.5; // radians: rising to the right
  const [c, s] = [Math.cos(a), Math.sin(a)];
  for (let i = 0; i < 14; i++) {
    const off = (i - 6.5) * 52 * k + (r() - 0.5) * 30 * k;
    const along = (r() - 0.5) * 300 * k;
    const len = (420 + r() * 380) * k;
    const cx = x - s * off + c * along;
    const cy = y + c * off + s * along;
    const p0 = [cx - (c * len) / 2, cy - (s * len) / 2];
    const p1 = [cx + (c * len) / 2, cy + (s * len) / 2];
    if (i % 3 === 1) pen.stroke(id + 'sm' + i, [p0, p1], { width: 16 * k, color: mix(st.paper, '#ffffff', 0.6), round: true });
    pen.stroke(id + 'sp' + i, [[p0[0] + c * 40, p0[1] + s * 40], p1], { width: st.line * (0.5 + r() * 0.5), taper: 0.6 });
  }
}

// The desk across the bottom (f2 stills 15, 19): one hand-drawn edge that sweeps
// in from the lower left and runs level to the right, the pale top under it
// hiding her lap, the drawing tablet flat on it under her hands at x (a dark slab
// seen nearly edge-on), and a phone lying at the left. y = the edge at its level part.
function desk(pen, id, x, y, k, m, st) {
  const W = 1600;
  const H = 900;
  const edge = curve([[0.12 * W, y + 0.1 * H], [0.24 * W, y + 0.035 * H], [0.42 * W, y + 0.004 * H], [0.62 * W, y - 0.004 * H], [0.8 * W, y + 0.004 * H], [0.835 * W, y + 0.018 * H]], 6);
  pen.fill(id + 'top', [...edge, [0.84 * W, H + 30], [0.1 * W, H + 30], edge[0]], st.paper, { slip: 0 });
  pen.stroke(id + 'edge', edge, { width: st.line * 0.9 });
  // tablet: a dark slab nearly edge-on, its near edge thicker
  const ty = y + 0.012 * H;
  const w = 215 * k;
  const d = 22 * k;
  pen.shape(id + 'tb', [[x - w + 10 * k, ty - d], [x + w - 10 * k, ty - d], [x + w, ty + d], [x - w, ty + d], [x - w + 10 * k, ty - d]], '#2d2530', { width: st.line * 0.8 });
  pen.fill(id + 'scr', [[x - w + 28 * k, ty - d + 7 * k], [x + w - 28 * k, ty - d + 7 * k], [x + w - 22 * k, ty + d - 10 * k], [x - w + 22 * k, ty + d - 10 * k], [x - w + 28 * k, ty - d + 7 * k]], '#463b48', { slip: 0 });
  if (m.text === 'phone') {
    const px = x - 0.13 * W;
    const py = y + 0.07 * H;
    pen.shape(id + 'ph', [[px - 30 * k, py - 26 * k], [px + 26 * k, py - 30 * k], [px + 32 * k, py + 26 * k], [px - 26 * k, py + 30 * k], [px - 30 * k, py - 26 * k]], '#5a2a40', { width: st.line * 0.8 });
    pen.fill(id + 'phs', [[px - 20 * k, py - 18 * k], [px + 18 * k, py - 21 * k], [px + 22 * k, py + 18 * k], [px - 17 * k, py + 21 * k], [px - 20 * k, py - 18 * k]], '#7a3a58', { slip: 0 });
  }
}

// A stroke widened into a closed outline (a limb), w0 at the start to w1 at the end.
function band(ctrl, w0, w1) {
  const pts = curve(ctrl, 6);
  const n = pts.length;
  const L = [];
  const R = [];
  pts.forEach((p, i) => {
    const q = pts[Math.min(n - 1, i + 1)];
    const o = pts[Math.max(0, i - 1)];
    const l = Math.hypot(q[0] - o[0], q[1] - o[1]) || 1;
    const h = lerp(w0, w1, i / (n - 1)) / 2;
    L.push([p[0] - ((q[1] - o[1]) / l) * h, p[1] + ((q[0] - o[0]) / l) * h]);
    R.push([p[0] + ((q[1] - o[1]) / l) * h, p[1] - ((q[0] - o[0]) / l) * h]);
  });
  return [...L, ...R.reverse(), L[0]];
}

// "Footage of last night" (f2 still 34): the lead collapsed, a small figure folded
// over with her feet at the left, her back arched up, her head upside down on the
// floor facing us, eyes shut, both arms wrapped round it. The rig cannot fold like
// this, so it is a gag drawing in her colours. Drawn in f2 pixels (768 wide) about
// the point (225, 250); x, y = that point on screen.
const SKIN = '#f6e0da';
const SKIN_B = '#e9cbc6'; // the far side, a shade darker
function collapse(pen, id, x, y, k, m, st) {
  const s = 2.083 * k;
  const P = ([px, py]) => [x + (px - 225) * s, y + (py - 250) * s];
  const Ps = (pts) => pts.map(P);
  const w = st.line * 0.75;
  // legs: bare, from the feet at the left up to her hips; shoes on the floor
  pen.shape(id + 'legB', Ps(band([[142, 292], [137, 236], [166, 182]], 22, 26)), SKIN_B, { width: w });
  pen.shape(id + 'shB', Ps(loop([[104, 298], [126, 288], [150, 292], [148, 302], [110, 304]], 4)), '#2a2340', { width: w });
  pen.shape(id + 'legF', Ps(band([[204, 292], [208, 236], [196, 182]], 24, 28)), SKIN, { width: w });
  pen.shape(id + 'shF', Ps(loop([[168, 300], [190, 290], [214, 293], [212, 304], [174, 306]], 4)), '#2a2340', { width: w });
  // grey shorts over the hips and the tops of both legs
  pen.shape(id + 'skirt', Ps(loop([[126, 222], [134, 186], [170, 158], [212, 156], [224, 216], [198, 222], [184, 196], [168, 196], [152, 226]], 5)), '#8e8f9c', { width: w });
  // the dark top: her back arching over to the shoulders
  pen.shape(id + 'top', Ps(loop([[196, 156], [238, 146], [278, 160], [306, 190], [318, 232], [296, 250], [268, 238], [242, 214], [214, 198]], 5)), '#3b3040', { width: w });
  // far arm, down past the head to the floor
  pen.shape(id + 'armB', Ps(band([[268, 232], [240, 262], [236, 300]], 20, 16)), SKIN_B, { width: w });
  pen.shape(id + 'hB', Ps(ellipse(240, 304, 11, 9, { n: 10 })), SKIN_B, { width: w });
  // the head, upside down: chin up by the shoulders, the hair spilling onto the floor
  pen.shape(id + 'face', Ps(loop([[283, 238], [312, 252], [318, 280], [300, 300], [266, 300], [250, 280], [256, 252]], 5)), SKIN, { width: w });
  const hair = Ps(curve([[247, 266], [250, 298], [236, 320], [224, 340], [248, 330], [254, 352], [272, 334], [284, 358], [296, 338], [314, 354], [316, 330], [338, 342], [326, 304], [319, 264], [308, 290], [299, 274], [290, 293], [279, 277], [268, 294], [258, 280], [247, 266]], 3));
  const filled = pen.fill(id + 'hair', hair, HAIR);
  if (filled) {
    [[302, 0.25], [318, 0.55], [334, 0.85]].forEach(([yy, u]) => pen.ops.push({ d: pathOf(below(filled, P([0, yy])[1])), fill: mix(HAIR, HAIR2, u), alpha: 0.85, clip: pathOf(filled) }));
  }
  pen.stroke(id + 'hairL', hair, { closed: true, width: w });
  // shut eyes and a small mouth, upside down; a little blush
  for (const ex of [268, 300]) pen.stroke(id + 'eye' + ex, Ps(curve([[ex - 9, 268], [ex, 264], [ex + 9, 268]], 4)), { width: st.line * 0.8, round: true });
  pen.stroke(id + 'mouth', Ps(curve([[278, 250], [284, 254], [290, 250]], 3)), { width: st.line * 0.6, round: true });
  for (const bx of [264, 304]) pen.fill(id + 'bl' + bx, Ps(ellipse(bx, 258, 7, 3, { n: 8 })), '#f0a3a8', { slip: 0.2, alpha: 0.7 });
  // near arm wrapped over the top of her head, the hand in her hair
  pen.shape(id + 'armF', Ps(band([[300, 214], [342, 230], [354, 270], [334, 306]], 22, 18)), SKIN, { width: w });
  pen.shape(id + 'hF', Ps(loop([[322, 300], [340, 296], [346, 312], [330, 320], [318, 312]], 4)), SKIN, { width: w });
}

// A thin scribbled loop in the air by her head (f2 still 27's "thinking" curl): a
// stroke from (x, y) out to the left that winds once round and trails off.
function curl(pen, id, x, y, k, m, st) {
  const r = 26 * k;
  const pts = [[x, y], [x - 40 * k, y - 4 * k]];
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI / 2 + (i / 12) * Math.PI * 2.1;
    pts.push([x - 60 * k + Math.cos(a) * r, y - 22 * k - Math.sin(a) * r * 0.9]);
  }
  pen.stroke(id + 'c', curve(pts, 3), { width: st.line * 0.6, round: true });
}

// A tear falling (f2 still 14): a short drip line, the drop, a small ring below it.
function tear(pen, id, x, y, k, m, st) {
  pen.stroke(id + 'dr', [[x, y - 48 * k], [x, y - 22 * k]], { width: st.line * 0.6, round: true });
  const pts = drop(x, y, 11 * k);
  pen.fill(id + 'd', pts, '#ffffff', { slip: 0.2 });
  pen.stroke(id + 'd', pts, { closed: true, width: st.line * 0.6 });
  pen.stroke(id + 'r', ellipse(x, y + 34 * k, 8 * k, 11 * k, { n: 12 }), { closed: true, width: st.line * 0.55 });
}

const GAGS = { board, card, phone, pan, shrimp, peek, speed, desk, collapse, curl, tear };
export const GAG_KINDS = Object.keys(GAGS);
// Props (drawn in the scene background, static): the same drawers, at stage coordinates.
const PROP_DRAWERS = { sign: board, dropdown: card, phone, pan, shrimp, thumb, tablet, mascot, photo, stove };
export const PROP_KINDS = Object.keys(PROP_DRAWERS);
// A prop with a y is placed on the screen (behind the actors), not in the camera's world.
export const isScreenProp = (pr) => pr.y != null && PROP_KINDS.includes(pr.kind);
export function drawGagProp(pen, pr, i, st, W, H) {
  const f = PROP_DRAWERS[pr.kind];
  const defY = { tablet: 0.7, sign: 0.3, stove: 0.68 }[pr.kind] ?? 0.5;
  f(pen, `prop${i}`, pr.x * W, (pr.y ?? defY) * H, pr.scale, { text: pr.text, cross: !!pr.cross }, st, 99);
}

// W, H = stage size. t = quantized local time, so marks pop on the drawing clock.
export function drawMarks(ops, marks, t, st, W, H) {
  for (const [i, m] of (marks || []).entries()) {
    const k = markScale(m, t) * m.size;
    if (!k) continue;
    const id = `mk${i}${m.kind}`;
    const pen = new Pen({ style: st, drawing: Math.floor(t * st.fps / st.hold), seed: hash('mark', i, m.kind, m.text || ''), ops });
    const r = rng(hash('markjit', i, pen.boilKey));
    const jit = () => (r() - 0.5) * 3; // marker text jitters a little each drawing
    const x = m.x * W;
    const y = m.y * H;
    if (m.kind === 'label' || m.kind === 'sfx') {
      const sfx = m.kind === 'sfx';
      const size = (sfx ? 96 : 54) * k;
      const lines = (sfx ? m.text.toUpperCase() : m.text).split('|');
      const lh = size * 1.15;
      if (sfx) {
        // f2 writes it by hand: thin ink letters (no outline, not bold), wide apart, on a
        // baseline tipped -4 degrees, or rising toward `to` (RAHHH!!!). One op per word;
        // painters that know rotate / spacing tip it and space the letters.
        const rot = m.to ? Math.max(-30, Math.min(30, (Math.atan2(m.to[1] * H - y, m.to[0] * W - x) * 180) / Math.PI)) : -4;
        lines.forEach((l, j) => pen.ops.push({ text: l, x: x + jit(), y: y + jit() + j * lh, size, fill: st.ink, align: 'center', rotate: rot, spacing: size * 0.14 }));
        continue;
      }
      // labels: "|" breaks lines (f2 writes "Woahh!! / So many / comments!!!")
      const y0 = y - ((lines.length - 1) * lh) / 2;
      lines.forEach((l, j) => pen.text(l, x + jit(), y0 + j * lh + jit(), size));
      if (m.to) {
        const halfW = (Math.max(...lines.map((l) => l.length)) * size * 0.24) | 0;
        const [tx, ty] = [m.to[0] * W, m.to[1] * H];
        const start = [x + Math.sign(tx - x || 1) * (halfW + 10), y - size * 0.3 + (ty > y ? size * 0.6 : 0)];
        arrow(pen, id, start, [tx, ty], k, st);
      }
    } else if (m.kind === 'bubble') {
      // A hand-drawn speech bubble: a short shout ("Aww!") in a round cloud with its
      // tail toward `to` (f2 still 30); longer text in a small tilted tag ("Message", still 19).
      const text = m.text || '';
      const short = text.length <= 5;
      const fs = (short ? 84 : 36) * k;
      const rx = short ? 160 * k : (text.length * fs * 0.5) / 2 + 30 * k;
      const ry = short ? 118 * k : fs * 0.95;
      const [tx, ty] = m.to ? [m.to[0] * W, m.to[1] * H] : [x + rx * 1.3, y + ry * 0.9];
      const ang = Math.atan2(ty - y, tx - x);
      let outline;
      if (short) {
        const pts = [];
        const n = 11;
        for (let j = 0; j < n; j++) {
          const a = (j / n) * Math.PI * 2;
          const bump = 1 + 0.07 * Math.sin(j * 2.3);
          pts.push([x + Math.cos(a) * rx * bump, y + Math.sin(a) * ry * bump]);
        }
        outline = loop(pts, 5);
        // tail: two lines from the rim toward the target
        const rim = (da) => [x + Math.cos(ang + da) * rx * 0.96, y + Math.sin(ang + da) * ry * 0.96];
        const tip = [x + Math.cos(ang) * rx * 1.28, y + Math.sin(ang) * ry * 1.28];
        pen.fill(id + 'b', outline, '#ffffff');
        pen.fill(id + 'tl', [rim(-0.16), tip, rim(0.16), rim(-0.16)], '#ffffff', { slip: 0 });
        pen.stroke(id + 'b', outline, { closed: true, width: st.line * 0.75 });
        pen.stroke(id + 'tl', [rim(-0.16), tip, rim(0.16)], { width: st.line * 0.75 });
        pen.text(text, x, y + fs * 0.32, fs);
      } else {
        const tilt = -0.12;
        outline = turn([[x - rx, y - ry], [x + rx, y - ry + 4 * k], [x + rx - 2 * k, y + ry], [x - rx * 0.55, y + ry], [x - rx * 0.7, y + ry + 26 * k], [x - rx * 0.8, y + ry], [x - rx, y + ry - 2 * k], [x - rx, y - ry]], [x, y], tilt);
        pen.shape(id + 'b', outline, '#ffffff', { width: st.line * 0.75 });
        pen.ops.push({ text, x, y: y + fs * 0.3, size: fs, fill: st.ink, align: 'center', rotate: (tilt * 180) / Math.PI });
      }
    } else if (m.kind === 'star') {
      // f2's wink star (still 47): a small orange five-point star thrown off with a
      // trail line back toward `to` (her eye), spinning a little each drawing.
      const rot = -0.3 + (pen.boilKey - 1) * 0.12;
      const pts = star(x, y, 30 * k, rot, 5, 0.45);
      pen.fill(id + 's', pts, '#f2a03a', { slip: 0.3 });
      pen.stroke(id + 's', pts, { closed: true, width: st.line * 0.7 });
      pen.dot(id + 'c', x, y, 5 * k, '#d9453d');
      const [tx, ty] = m.to ? [m.to[0] * W, m.to[1] * H] : [x + 80 * k, y - 110 * k];
      const d = Math.hypot(tx - x, ty - y) || 1;
      const [ux, uy] = [(tx - x) / d, (ty - y) / d];
      pen.stroke(id + 'tr', [[x + ux * 44 * k, y + uy * 44 * k], [tx, ty]], { width: st.line * 0.75, round: true });
    } else if (m.kind === 'shades') {
      // Dark sunglasses over her eyes (f2 still 38's smug "cool" look): two lenses and
      // a bridge, a white glint on each. x, y = between the eyes on screen.
      const lw = 64 * k;
      const lh2 = 34 * k;
      const gap = 18 * k;
      const tilt = -0.1;
      for (const s of [-1, 1]) {
        const cx = x + s * (gap + lw);
        const lens = turn([[cx - lw, y - lh2], [cx + lw, y - lh2 * 0.9], [cx + lw * 0.9, y + lh2 * 0.6], [cx + lw * 0.4, y + lh2], [cx - lw * 0.5, y + lh2], [cx - lw, y + lh2 * 0.5], [cx - lw, y - lh2]], [x, y], tilt);
        pen.shape(id + 'l' + s, lens, '#211c24', { width: st.line * 0.9 });
        pen.stroke(id + 'g' + s, turn([[cx - lw * 0.6, y - lh2 * 0.3], [cx - lw * 0.25, y - lh2 * 0.6]], [x, y], tilt), { width: st.line * 0.9, color: '#ffffff', round: true });
      }
      pen.stroke(id + 'br', turn([[x - gap, y - lh2 * 0.7], [x, y - lh2 * 0.85], [x + gap, y - lh2 * 0.7]], [x, y], tilt), { width: st.line * 1.1 });
      for (const s of [-1, 1]) pen.stroke(id + 'arm' + s, turn([[x + s * (gap + 2 * lw), y - lh2 * 0.8], [x + s * (gap + 2 * lw + 40 * k), y - lh2 * 0.6]], [x, y], tilt), { width: st.line * 1.1 });
    } else if (GAGS[m.kind]) {
      GAGS[m.kind](pen, id, x, y, k, m, st, t);
    } else if (m.kind === 'sweat') {
      [[-30, 0, 11], [14, 28, 9], [40, -14, 7]].forEach(([dx, dy, rr], j) => {
        const pts = drop(x + dx * k, y + dy * k, rr * k);
        pen.fill(id + j, pts, '#ffffff', { slip: 0.3 }); // f2: small white drops outlined in ink
        pen.stroke(id + j, pts, { closed: true, width: st.line * 0.6 });
      });
    } else if (m.kind === 'sparkle') {
      [[0, 0, 34, 0], [-52, 36, 20, 0.3], [46, -34, 16, 0.2]].forEach(([dx, dy, rr, rot], j) => {
        const pts = star(x + dx * k, y + dy * k, rr * k, rot);
        pen.fill(id + j, pts, '#fff2a8', { slip: 0.4 });
        pen.stroke(id + j, pts, { closed: true, width: st.line * 0.55 });
      });
    } else if (m.kind === 'lines') {
      // f2's shock squiggle (still 6): one tall zigzag drawn in a single stroke, two
      // short ticks above it and a small hook below. (x, y) = its middle.
      const zig = curve([[x - 20 * k, y - 120 * k], [x + 40 * k, y - 84 * k], [x - 44 * k, y - 40 * k], [x + 44 * k, y + 10 * k], [x - 30 * k, y + 56 * k]], 3);
      pen.stroke(id + 'z', zig, { width: st.line * 0.85, round: true });
      pen.stroke(id + 't1', [[x + 6 * k, y - 196 * k], [x + 16 * k, y - 172 * k]], { width: st.line * 0.75, round: true });
      pen.stroke(id + 't2', [[x + 40 * k, y - 190 * k], [x + 48 * k, y - 168 * k]], { width: st.line * 0.75, round: true });
      pen.stroke(id + 'hk', [[x + 8 * k, y + 106 * k], [x + 18 * k, y + 134 * k], [x + 2 * k, y + 136 * k]], { width: st.line * 0.75, round: true });
    } else if (m.kind === 'heart') {
      // f2 still 43: a small pink heart tossed off, two dashes behind it up to the right.
      const s = 34 * k;
      const pts = loop([[x, y + s * 0.9], [x + s * 0.95, y - s * 0.1], [x + s * 0.5, y - s * 0.85], [x, y - s * 0.4], [x - s * 0.5, y - s * 0.85], [x - s * 0.95, y - s * 0.1]], 6);
      pen.fill(id, pts, '#e0707e', { slip: 0.4 });
      pen.stroke(id, pts, { closed: true, width: st.line * 0.7 });
      pen.stroke(id + 'd1', [[x + s * 1.3, y - s * 0.9], [x + s * 1.9, y - s * 1.6]], { width: st.line * 0.6, round: true });
      pen.stroke(id + 'd2', [[x + s * 2.2, y - s * 2], [x + s * 2.7, y - s * 2.6]], { width: st.line * 0.6, round: true });
    } else if (m.kind === 'exclaim') {
      // "!" in a little square speech box (f2 still 17)
      const b = 34 * k;
      pen.shape(id + 'box', [[x - b, y - b * 1.1], [x + b, y - b * 1.15], [x + b, y + b * 0.9], [x - b * 0.2, y + b * 0.9], [x - b * 0.5, y + b * 1.4], [x - b * 0.55, y + b * 0.9], [x - b, y + b * 0.9], [x - b, y - b * 1.1]], '#ffffff', { width: st.line * 0.7 });
      pen.stroke(id + 'bar', [[x, y - b * 0.7], [x + 2 * k, y + b * 0.2]], { width: st.line * 1.1, round: true });
      pen.dot(id + 'dot', x + 2 * k, y + b * 0.55, 4 * k);
    }
  }
}
