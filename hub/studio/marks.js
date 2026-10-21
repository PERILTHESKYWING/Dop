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
        for (let d = 0; d < 8; d++) {
          const ang = (d * Math.PI) / 4;
          pen.text(text, x + Math.cos(ang) * 5 * k + jit(), y + Math.sin(ang) * 5 * k + jit(), size, { weight: 700, color: st.ink });
        }
        pen.text(text, x + jit(), y + jit(), size, { weight: 700, color: mix(st.paper, '#ffffff', 0.5) });
      } else pen.text(text, x + jit(), y + jit(), size);
      if (m.to) {
        const halfW = (text.length * size * 0.24) | 0;
        const [tx, ty] = [m.to[0] * W, m.to[1] * H];
        const start = [x + Math.sign(tx - x || 1) * (halfW + 10), y - size * 0.3 + (ty > y ? size * 0.6 : 0)];
        arrow(pen, id, start, [tx, ty], k, st);
      }
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
