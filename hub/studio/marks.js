// Scene marks: the little hand-drawn extras on top of a shot (labels with
// arrows, sound-effect words, sweat drops, sparkles, shock lines, hearts, "!").
// Drawn in the style's pen so they boil like everything else.
import { Pen, curve, ellipse, hash, lerp, loop, mix, rng } from './draw.js';

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

function star(cx, cy, r, rot = 0) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = rot + (i * Math.PI) / 4;
    const rr = i % 2 ? r * 0.28 : r;
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
const RED = '#d9453d';

// A white card with a goal written on it ("1000 Follower"); cross:true scribbles a red X
// over its first character only, as f2 strikes the 1.
function board(pen, id, x, y, k, m, st, t) {
  const w = 270 * k;
  const h = 120 * k;
  const face = rrect(x - w, y - h / 2, x + w, y + h / 2, 12 * k);
  pen.shape(id + 'b', face, '#ffffff');
  const lines = (m.text || '').split('|');
  lines.forEach((l, i) => pen.text(l, x, y + (i - (lines.length - 1) / 2) * 46 * k + 14 * k, 44 * k));
  // cross-out: two strokes drawn one after the other, 0.2 s apart
  const crossed = m.cross !== false;
  const u1 = Math.min(1, Math.max(0, (t - (m.t || 0) - 0.35) / 0.12));
  const u2 = Math.min(1, Math.max(0, (t - (m.t || 0) - 0.5) / 0.12));
  const seg = (a, b, u) => [a, [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]];
  const cw = 0.5 * 44 * k; // about one character of the hand font
  const cx = x - (lines[0].length * cw) / 2 + cw / 2;
  const r = 0.75 * cw;
  if (crossed && u1 > 0) pen.stroke(id + 'x1', seg([cx - r, y - r * 1.3], [cx + r, y + r * 1.3], u1), { width: st.line * 1.6 * k, color: RED, round: true });
  if (crossed && u2 > 0) pen.stroke(id + 'x2', seg([cx - r, y + r * 1.3], [cx + r, y - r * 1.3], u2), { width: st.line * 1.6 * k, color: RED, round: true });
}

// Meme card with a title and a dropdown that is open: options below, the last one highlighted.
// text = "Gender|Female|Male|Artist girl" (title, then options).
function card(pen, id, x, y, k, m, st) {
  const [title = 'Gender', ...opts] = (m.text || 'Gender').split('|');
  const w = 250 * k;
  const rows = opts.length;
  const top = y - 70 * k;
  const h = (150 + rows * 52) * k;
  pen.shape(id + 'c', rrect(x - w, top - 20 * k, x + w, top - 20 * k + h + 40 * k, 18 * k), '#ffffff');
  pen.text(title, x - w + 26 * k, top + 36 * k, 46 * k, { align: 'left' });
  const bx0 = x - w + 24 * k;
  const bx1 = x + w - 24 * k;
  pen.shape(id + 'dd', rrect(bx0, top + 56 * k, bx1, top + 118 * k, 10 * k), '#f1efe8');
  pen.fill(id + 'tri', [[bx1 - 56 * k, top + 76 * k], [bx1 - 22 * k, top + 76 * k], [bx1 - 39 * k, top + 102 * k], [bx1 - 56 * k, top + 76 * k]], st.ink, { slip: 0 });
  pen.stroke(id + 'sel', [[bx0 + 16 * k, top + 87 * k], [bx0 + 130 * k, top + 87 * k]], { width: st.line * 0.8, color: mix(st.ink, '#ffffff', 0.55) });
  opts.forEach((o, i) => {
    const yy = top + 128 * k + i * 52 * k;
    if (i === rows - 1) pen.fill(id + 'hl', rect(bx0, yy, bx1, yy + 48 * k), '#bfe0f7', { slip: 0.2 });
    pen.text(o, bx0 + 14 * k, yy + 34 * k, 34 * k, { align: 'left' });
  });
  const lastY = top + 128 * k + (rows - 1) * 52 * k;
  const c = [bx1 - 70 * k, lastY + 24 * k];
  pen.shape(id + 'ptr', [[c[0], c[1]], [c[0] + 8 * k, c[1] + 46 * k], [c[0] + 20 * k, c[1] + 33 * k], [c[0] + 36 * k, c[1] + 44 * k], [c[0] + 42 * k, c[1] + 36 * k], [c[0] + 26 * k, c[1] + 25 * k], [c[0] + 42 * k, c[1] + 18 * k], [c[0], c[1]]], '#ffffff');
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

// Frying pan seen from the side, with fire licking up from it.
function pan(pen, id, x, y, k, m, st) {
  pen.shape(id + 'handle', loop([[x + 80 * k, y - 10 * k], [x + 250 * k, y - 22 * k], [x + 252 * k, y + 2 * k], [x + 80 * k, y + 14 * k]], 3), '#4a4650');
  pen.shape(id + 'pan', loop([[x - 110 * k, y - 22 * k], [x + 100 * k, y - 22 * k], [x + 84 * k, y + 40 * k], [x - 94 * k, y + 40 * k]], 4), '#5a5660');
  if (m.text) pen.text(m.text, x - 6 * k, y + 22 * k, 22 * k, { color: '#ffffff', weight: 700 });
  const flame = (cx, hgt, col, j) => loop([[cx - 34 * k, y - 22 * k], [cx - 30 * k, y - hgt * 0.5 * k], [cx - 4 * k + j, y - hgt * k], [cx + 8 * k, y - hgt * 0.55 * k], [cx + 34 * k, y - 22 * k]], 5);
  [[-50, 150, '#f6a23a'], [8, 200, '#f27a2a'], [58, 130, '#f6a23a']].forEach(([dx, hg, col], i) => {
    const wob = ((hash('fl', i, pen.boilKey) % 7) - 3) * 2 * k;
    pen.shape(id + 'fl' + i, flame(x + dx * k, hg, col, wob), col);
  });
  pen.shape(id + 'core', flame(x + 8 * k, 100, '#ffe08a', 0), '#ffe08a');
}

// A shrimp standing up straight like a person ("after" the posture fix): tall segmented
// body, tail fan as feet, head with eye and feelers on top, one little arm on the hip.
function shrimpUp(pen, id, x, y, k, m, st) {
  const n = 7; // spine points, bottom (tail) to top (head)
  const spine = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    spine.push([x + Math.sin(u * Math.PI) * 6 * k, y + 120 * k - u * 230 * k]);
  }
  const half = (u) => (24 + 22 * Math.sin(Math.min(1, u * 1.15) * Math.PI * 0.9)) * k; // thin tail, full chest
  const L = spine.map(([sx, sy], i) => [sx - half(i / (n - 1)), sy]);
  const R = spine.map(([sx, sy], i) => [sx + half(i / (n - 1)), sy]);
  const top = spine[n - 1];
  const body = curve([...L, [top[0] - 30 * k, top[1] - 34 * k], [top[0], top[1] - 52 * k], [top[0] + 30 * k, top[1] - 34 * k], ...R.reverse()], 4);
  // tail fan under it: two lobes splayed like feet
  const [bx, by] = spine[0];
  for (const s2 of [-1, 1]) pen.shape(id + 'tf' + s2, loop([[bx, by - 4 * k], [bx + s2 * 58 * k, by + 20 * k], [bx + s2 * 46 * k, by + 38 * k], [bx + s2 * 8 * k, by + 22 * k]], 4), '#f08a77');
  pen.shape(id + 'sh', [...body, body[0]], '#f5a58f');
  for (let i = 1; i < n - 2; i++) {
    const [sx, sy] = spine[i];
    const h = half(i / (n - 1));
    pen.stroke(id + 'sg' + i, curve([[sx - h * 0.92, sy], [sx, sy + 7 * k], [sx + h * 0.92, sy]], 4), { width: st.line * 0.55 });
  }
  // little legs down the front (her left), the arm on the hip (right)
  for (let i = 1; i < 4; i++) {
    const [sx, sy] = spine[i];
    pen.stroke(id + 'lg' + i, [[sx - half(i / (n - 1)) + 4 * k, sy - 10 * k], [sx - half(i / (n - 1)) - 16 * k, sy - 2 * k]], { width: st.line * 0.55, round: true });
  }
  const [cx, cy] = spine[3];
  const h3 = half(3 / (n - 1));
  pen.stroke(id + 'arm', [[cx + h3 - 4 * k, cy - 40 * k], [cx + h3 + 30 * k, cy - 16 * k], [cx + h3 - 2 * k, cy + 6 * k]], { width: st.line * 0.75, round: true });
  // head: eye and two feelers sweeping up and back
  pen.dot(id + 'eye', top[0] - 10 * k, top[1] - 18 * k, 7 * k);
  pen.stroke(id + 'f1', curve([[top[0] - 6 * k, top[1] - 48 * k], [top[0] - 30 * k, top[1] - 110 * k], [top[0] + 20 * k, top[1] - 150 * k]], 5), { width: st.line * 0.6 });
  pen.stroke(id + 'f2', curve([[top[0] + 6 * k, top[1] - 48 * k], [top[0] + 10 * k, top[1] - 100 * k], [top[0] + 60 * k, top[1] - 124 * k]], 5), { width: st.line * 0.6 });
}

// A cartoon shrimp curled in a C: thick body in segments, tail fan, legs, feelers, eye.
// text "after": it stands up straight instead.
function shrimp(pen, id, x, y, k, m, st) {
  if (m.text === 'after') return shrimpUp(pen, id, x, y, k, m, st);
  const c = [x, y];
  const ring = (rOut, rIn, a0, a1, n = 14) => {
    const out = [];
    const inn = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      const f = Math.sin((i / n) * Math.PI); // fat in the middle of the back, thin at the ends
      const ro = rOut * (0.55 + 0.45 * f);
      const ri = rIn + (rOut - rOut * (0.55 + 0.45 * f)) * 0.3;
      out.push([c[0] + Math.cos(a) * ro * k, c[1] + Math.sin(a) * ro * k * 0.9]);
      inn.push([c[0] + Math.cos(a) * ri * k, c[1] + Math.sin(a) * ri * k * 0.9]);
    }
    return [...out, ...inn.reverse()];
  };
  const A0 = Math.PI * 0.85;
  const A1 = Math.PI * 2.35;
  const body = ring(110, 50, A0, A1, 20);
  pen.shape(id + 'sh', [...body, body[0]], '#f5a58f');
  for (let i = 1; i < 6; i++) {
    const a = A0 + ((A1 - A0) * i) / 6;
    pen.stroke(id + 'sg' + i, [[c[0] + Math.cos(a) * 58 * k, c[1] + Math.sin(a) * 52 * k], [c[0] + Math.cos(a) * 104 * k, c[1] + Math.sin(a) * 94 * k]], { width: st.line * 0.55 });
  }
  // head end (left, with eye and feelers) and tail fan (right)
  const ha = A0;
  const hx = c[0] + Math.cos(ha) * 80 * k;
  const hy = c[1] + Math.sin(ha) * 72 * k;
  pen.dot(id + 'eye', hx + 4 * k, hy - 8 * k, 7 * k);
  pen.stroke(id + 'f1', curve([[hx - 6 * k, hy - 14 * k], [hx - 50 * k, hy - 60 * k], [hx - 80 * k, hy - 62 * k]], 5), { width: st.line * 0.6 });
  pen.stroke(id + 'f2', curve([[hx - 10 * k, hy - 4 * k], [hx - 56 * k, hy - 30 * k], [hx - 92 * k, hy - 24 * k]], 5), { width: st.line * 0.6 });
  const ta = A1;
  const tx = c[0] + Math.cos(ta) * 80 * k;
  const ty = c[1] + Math.sin(ta) * 72 * k;
  pen.shape(id + 'tail', loop([[tx - 10 * k, ty + 4 * k], [tx + 30 * k, ty - 26 * k], [tx + 44 * k, ty + 8 * k], [tx + 22 * k, ty + 30 * k]], 4), '#f08a77');
  for (let i = 0; i < 4; i++) {
    const a = A0 + 0.25 + i * 0.28;
    pen.stroke(id + 'lg' + i, [[c[0] + Math.cos(a) * 52 * k, c[1] + Math.sin(a) * 47 * k], [c[0] + Math.cos(a) * 30 * k, c[1] + Math.sin(a) * 28 * k + 12 * k]], { width: st.line * 0.55, round: true });
  }
  if (m.text && m.text !== 'before') pen.text(m.text, x, y + 150 * k, 42 * k);
}

// The lead's head peeking up over the bottom edge of the frame: hair crown and two eyes.
function peek(pen, id, x, y, k, m, st, t) {
  const rise = Math.min(1, Math.max(0, (t - (m.t || 0)) / 0.25));
  const top = y + (1 - rise) * 160 * k; // y = where the hair crown ends up
  const hair = loop([[x - 150 * k, top + 190 * k], [x - 160 * k, top + 70 * k], [x - 90 * k, top + 5 * k], [x, top - 8 * k], [x + 90 * k, top + 5 * k], [x + 160 * k, top + 70 * k], [x + 150 * k, top + 190 * k]], 6);
  pen.shape(id + 'hair', hair, st.peekHair || '#262b55');
  const face = loop([[x - 128 * k, top + 190 * k], [x - 134 * k, top + 100 * k], [x - 70 * k, top + 70 * k], [x + 70 * k, top + 70 * k], [x + 134 * k, top + 100 * k], [x + 128 * k, top + 190 * k]], 5);
  pen.shape(id + 'face', face, '#f7dfd6');
  for (const s of [-1, 1]) {
    pen.shape(id + 'ew' + s, ellipse(x + s * 52 * k, top + 130 * k, 26 * k, 22 * k, { n: 12 }), '#ffffff');
    pen.dot(id + 'ir' + s, x + s * 52 * k, top + 132 * k, 13 * k, '#2a9d9a');
    pen.dot(id + 'pu' + s, x + s * 52 * k - 3 * k, top + 126 * k, 4 * k, '#ffffff');
  }
}

// YouTube-style thumbnail with a cartoon face and a title strip (text).
function thumb(pen, id, x, y, k, m, st) {
  const w = 230 * k;
  const h = 130 * k;
  pen.shape(id + 'fr', rrect(x - w, y - h, x + w, y + h, 10 * k), '#f0559a');
  pen.shape(id + 'face', ellipse(x - 60 * k, y - 10 * k, 62 * k, 66 * k, { n: 14 }), '#f6e0da');
  pen.shape(id + 'hair', loop([[x - 124 * k, y - 10 * k], [x - 110 * k, y - 70 * k], [x - 60 * k, y - 84 * k], [x - 10 * k, y - 66 * k], [x + 2 * k, y - 10 * k], [x - 30 * k, y - 40 * k], [x - 90 * k, y - 40 * k]], 5), '#2b2d57');
  for (const s2 of [-1, 1]) pen.dot(id + 'e' + s2, x - 60 * k + s2 * 24 * k, y - 4 * k, 8 * k);
  pen.stroke(id + 'm', curve([[x - 78 * k, y + 28 * k], [x - 60 * k, y + 40 * k], [x - 42 * k, y + 28 * k]], 4), { width: st.line * 0.7 });
  pen.fill(id + 'bar', rect(x - w, y + 70 * k, x + w, y + h), '#2a2340', { slip: 0 });
  pen.text(m.text || 'MY 1ST VIDEO', x, y + 112 * k, 34 * k, { color: '#ffffff', weight: 700 });
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

// A stern little white blob mascot holding a pencil.
function mascot(pen, id, x, y, k, m, st) {
  const body = loop([[x - 60 * k, y + 80 * k], [x - 74 * k, y - 10 * k], [x - 40 * k, y - 80 * k], [x + 30 * k, y - 84 * k], [x + 70 * k, y - 20 * k], [x + 64 * k, y + 80 * k], [x + 30 * k, y + 64 * k], [x, y + 84 * k], [x - 30 * k, y + 64 * k]], 6);
  pen.shape(id + 'bl', body, '#ffffff');
  for (const s2 of [-1, 1]) pen.dot(id + 'e' + s2, x + s2 * 24 * k - 4 * k, y - 20 * k, 7 * k);
  pen.stroke(id + 'br1', [[x - 44 * k, y - 40 * k], [x - 12 * k, y - 32 * k]], { width: st.line * 0.8, round: true });
  pen.stroke(id + 'br2', [[x + 36 * k, y - 40 * k], [x + 4 * k, y - 32 * k]], { width: st.line * 0.8, round: true });
  pen.stroke(id + 'mo', [[x - 14 * k, y + 14 * k], [x + 10 * k, y + 12 * k]], { width: st.line * 0.7, round: true });
  pen.stroke(id + 'pc', [[x + 56 * k, y + 20 * k], [x + 130 * k, y - 40 * k]], { width: st.line * 3 * k, color: '#e8c35a', round: true });
  pen.stroke(id + 'pcl', [[x + 56 * k, y + 20 * k], [x + 130 * k, y - 40 * k]], { width: st.line * 0.7 });
  pen.fill(id + 'tip', [[x + 130 * k, y - 40 * k], [x + 150 * k, y - 62 * k], [x + 142 * k, y - 34 * k], [x + 130 * k, y - 40 * k]], '#2a2340', { slip: 0 });
}

// A framed reaction photo: night sky and a tiny crying figure.
function photo(pen, id, x, y, k, m, st) {
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

// Speed lines: long thin streaks across the frame around (x, y).
function speed(pen, id, x, y, k, m, st, t) {
  const r = rng(hash('speed', pen.boilKey, id));
  for (let i = 0; i < 12; i++) {
    const yy = y + (i - 5.5) * 58 * k + (r() - 0.5) * 24;
    const x0 = x + (r() - 0.5) * 700 * k - 300 * k;
    const len = (260 + r() * 360) * k;
    pen.stroke(id + 'sp' + i, [[x0, yy], [x0 + len, yy + (r() - 0.5) * 8]], { width: st.line * 0.7, color: mix(st.ink, st.paper, 0.35) });
  }
}

// A desk across the whole frame in front of her: one hand-drawn edge line (curling up at
// the right end), the pale top below it, a drawing tablet lying flat at x with a stylus,
// and with text "phone" a phone lying at the left. y = the desk edge.
function desk(pen, id, x, y, k, m, st) {
  const W = 1600;
  const H = 900;
  const edge = curve([[-30, y + 6], [W * 0.3, y - 4], [W * 0.65, y + 2], [W - 70, y - 6], [W - 22, y - 30], [W + 10, y - 60]], 6);
  pen.fill(id + 'top', [...edge, [W + 30, H + 30], [-30, H + 30], edge[0]], mix(st.paper, '#ffffff', 0.55), { slip: 0.15 });
  pen.stroke(id + 'edge', edge, { width: st.line * 0.9 });
  // tablet: a dark slab in perspective (far edge narrower), screen inset, thin side edge
  const ty = y + Math.max(60, (H - y) * 0.42);
  const wf = 205 * k; // half width at the far edge
  const wn = 240 * k; // half width at the near edge
  const d = 62 * k; // half depth on screen
  const slab = [[x - wf, ty - d], [x + wf, ty - d], [x + wn, ty + d], [x - wn, ty + d], [x - wf, ty - d]];
  pen.fill(id + 'side', [[x - wn, ty + d], [x + wn, ty + d], [x + wn - 3 * k, ty + d + 12 * k], [x - wn + 3 * k, ty + d + 12 * k], [x - wn, ty + d]], '#22252d', { slip: 0 });
  pen.shape(id + 'tb', slab, '#3b3f4a');
  const f = 0.86;
  pen.fill(id + 'scr', [[x - wf * f, ty - d * 0.78], [x + wf * f, ty - d * 0.78], [x + wn * f, ty + d * 0.78], [x - wn * f, ty + d * 0.78], [x - wf * f, ty - d * 0.78]], '#4b505d', { slip: 0.1 });
  // stylus lying on it at a slant, thin, with a lighter tip
  pen.stroke(id + 'sty', [[x + 40 * k, ty + d * 0.55], [x + 230 * k, ty - d * 0.2]], { width: st.line * 0.9, round: true });
  pen.stroke(id + 'nib', [[x + 40 * k, ty + d * 0.55], [x + 58 * k, ty + d * 0.48]], { width: st.line * 0.9, color: '#c9ced8', round: true });
  if (m.text === 'phone') {
    const px = 0.2 * W;
    const py = ty + 10 * k;
    const ph = [[px - 34 * k, py - 30 * k], [px + 30 * k, py - 34 * k], [px + 42 * k, py + 34 * k], [px - 30 * k, py + 40 * k], [px - 34 * k, py - 30 * k]];
    pen.shape(id + 'ph', ph, '#2f323b');
    pen.fill(id + 'phs', [[px - 26 * k, py - 22 * k], [px + 22 * k, py - 26 * k], [px + 32 * k, py + 26 * k], [px - 22 * k, py + 31 * k], [px - 26 * k, py - 22 * k]], '#454a57', { slip: 0 });
  }
}

const GAGS = { board, card, phone, pan, shrimp, peek, speed, desk };
export const GAG_KINDS = Object.keys(GAGS);
// Props (drawn in the scene background, static): the same drawers, at stage coordinates.
const PROP_DRAWERS = { sign: board, dropdown: card, phone, pan, shrimp, thumb, tablet, mascot, photo };
export const PROP_KINDS = Object.keys(PROP_DRAWERS);
// A prop with a y is placed on the screen (behind the actors), not in the camera's world.
export const isScreenProp = (pr) => pr.y != null && PROP_KINDS.includes(pr.kind);
export function drawGagProp(pen, pr, i, st, W, H) {
  const f = PROP_DRAWERS[pr.kind];
  const defY = { tablet: 0.7, sign: 0.3 }[pr.kind] ?? 0.5;
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
    const a = [x, y];
    if (m.kind === 'label' || m.kind === 'sfx') {
      const sfx = m.kind === 'sfx';
      const size = (sfx ? 96 : 40) * k;
      const text = sfx ? m.text.toUpperCase() : m.text;
      if (sfx) {
        // f2 writes it by hand: thin ink letters (no outline, not bold), wide apart, on a
        // baseline tipped -4 degrees. One op for the whole word; painters that know
        // rotate / spacing tip it and space the letters.
        pen.ops.push({ text, x: x + jit(), y: y + jit(), size, fill: st.ink, align: 'center', rotate: -4, spacing: size * 0.14 });
      } else pen.text(text, x + jit(), y + jit(), size);
      if (m.to) {
        const halfW = (text.length * size * (sfx ? 0.31 : 0.24)) | 0;
        const [tx, ty] = [m.to[0] * W, m.to[1] * H];
        const start = [x + Math.sign(tx - x || 1) * (halfW + 10), y - size * 0.3 + (ty > y ? size * 0.6 : 0)];
        arrow(pen, id, start, [tx, ty], k, st);
      }
    } else if (GAGS[m.kind]) {
      GAGS[m.kind](pen, id, x, y, k, m, st, t);
    } else if (m.kind === 'sweat') {
      [[-30, 0, 11], [14, 28, 9], [40, -14, 7]].forEach(([dx, dy, rr], j) => {
        const pts = drop(x + dx * k, y + dy * k, rr * k);
        pen.fill(id + j, pts, '#bfe3f5', { slip: 0.3 });
        pen.stroke(id + j, pts, { closed: true, width: st.line * 0.6 });
      });
    } else if (m.kind === 'sparkle') {
      [[0, 0, 34, 0], [-52, 36, 20, 0.3], [46, -34, 16, 0.2]].forEach(([dx, dy, rr, rot], j) => {
        const pts = star(x + dx * k, y + dy * k, rr * k, rot);
        pen.fill(id + j, pts, '#fff2a8', { slip: 0.4 });
        pen.stroke(id + j, pts, { closed: true, width: st.line * 0.55 });
      });
    } else if (m.kind === 'lines') {
      // three zigzag shock strokes fanning up and out
      [-0.7, 0, 0.7].forEach((fan, j) => {
        const ang = -Math.PI / 2 + fan;
        const pts = [0, 1, 2, 3, 4].map((s) => {
          const d = (30 + s * 22) * k;
          const side = (s % 2 ? 1 : -1) * 7 * k;
          return [x + Math.cos(ang) * d - Math.sin(ang) * side, y + Math.sin(ang) * d + Math.cos(ang) * side];
        });
        pen.stroke(id + j, pts, { width: st.line * 0.8, round: true });
      });
    } else if (m.kind === 'heart') {
      const s = 34 * k;
      const pts = loop([[x, y + s * 0.9], [x + s * 0.95, y - s * 0.1], [x + s * 0.5, y - s * 0.85], [x, y - s * 0.4], [x - s * 0.5, y - s * 0.85], [x - s * 0.95, y - s * 0.1]], 6);
      pen.fill(id, pts, '#f08a9b', { slip: 0.4 });
      pen.stroke(id, pts, { closed: true, width: st.line * 0.7 });
    } else if (m.kind === 'exclaim') {
      pen.stroke(id + 'bar', [[x, y - 70 * k], [x + 3 * k, y - 18 * k]], { width: st.line * 1.9 * k, taper: 0.5, round: true });
      pen.fill(id + 'dot', ellipse(x + 4 * k, y + 8 * k, 9 * k, 9 * k), st.ink, { slip: 0 });
    }
  }
}
