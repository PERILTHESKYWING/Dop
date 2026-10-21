// Characters for the studio: one simple body plan (big head, bean body,
// noodle limbs with round hands) dressed from the cast spec, so a character
// is the same drawing in every shot. A pose bends it; a face sets the
// expression. Everything is built facing right, then mirrored for facing -1.
import { curve, deg, ellipse, hash, lerp, loop, mix, tf } from './draw.js';

export const BASE_H = 390; // character height in stage px at height 1, scale 1
const INK_SKIN = 0.55; // how dark the inner lines on skin are (mix of skin to ink)

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

const BUILD = { slim: [0.25, 0.27], average: [0.27, 0.33], round: [0.3, 0.44] }; // [top, bottom] torso width / H

// Solve a two-bone limb: from root to target with lengths a and b,
// bending toward side (+1 or -1). Returns the joint.
function ik(root, target, a, b, side) {
  const dx = target[0] - root[0];
  const dy = target[1] - root[1];
  const d = Math.max(Math.abs(a - b) + 0.01, Math.min(a + b - 0.01, Math.hypot(dx, dy)));
  const base = Math.atan2(dy, dx);
  const c = Math.acos(Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d))));
  const ang = base + side * c;
  return [root[0] + Math.cos(ang) * a, root[1] + Math.sin(ang) * a];
}

// Arm angles: degrees from hanging straight down, positive swings outward
// (to the front for the front arm, to the back for the back arm).
const swing = (root, len, angle, out) => [root[0] + Math.sin(deg(angle)) * len * out, root[1] + Math.cos(deg(angle)) * len];

// Draw one character. pen: a child Pen for this character; ch: cast entry;
// pose: see moves.js; at: { x, ground, scale, facing }.
export function drawCharacter(pen, ch, pose, { x, ground, scale = 1, facing = 1 }) {
  const H = BASE_H * ch.height * scale;
  const R = 0.19 * H * ch.headSize;
  const P = (pts) => tf(pts, { x, y: ground, sx: facing });
  const ink = pen.style.ink;
  const skinLine = mix(ch.skin, ink, INK_SKIN);
  const line = pen.style.line;
  const face = FACE[pose.face] || FACE.neutral;

  // Body plan (local, feet at 0, up is negative y).
  const lift = (pose.lift || 0) * H;
  const legLen = 0.23 * H;
  const crouch = (pose.bob || 0) * H;
  const hip = [(pose.shift || 0) * H, -legLen - lift + crouch];
  const T = 0.3 * H * (pose.squash || 1);
  const [wt, wb] = BUILD[ch.build].map((f) => f * H);
  const lean = deg((pose.lean || 0) + (face.lean || 0));
  const tor = (pts) => tf(pts, { x: hip[0], y: hip[1], rot: lean });
  const shoulderY = -0.86 * T;
  const shF = tor([[wt * 0.42, shoulderY]])[0];
  const shB = tor([[-wt * 0.42, shoulderY]])[0];
  const neck = tor([[0, -T]])[0];
  const tilt = deg((pose.tilt || 0) + (face.tilt || 0));
  const hc = [neck[0] + Math.sin(lean + tilt) * R * 0.92, neck[1] - Math.cos(lean + tilt) * R * 0.92 + (pose.nod || 0) * R];
  const head = (pts) => tf(pts, { x: hc[0], y: hc[1], rot: tilt + lean * 0.5 });
  const look = Math.max(-1, Math.min(1, pose.look ?? 0.45)); // where the face points: 0 front, 1 toward facing
  const fx = look * 0.22 * R;

  // Ground shadow keeps feet planted (and shows a jump).
  pen.fill('shadow', P(ellipse(0, 2, wb * 0.75 * (1 - Math.min(0.5, lift / H)), 7 * scale, { n: 16 })), mix(pen.style.paper, ink, 0.14), { slip: 0 });

  // Limbs: an inked noodle with colour inside and a round hand or shoe.
  const armW = 0.075 * H;
  const legW = 0.085 * H;
  const limb = (id, pts, w, colors) => {
    const lp = P(curve(pts, 6));
    pen.stroke(id + ':o', lp, { width: w + line * 1.6 * pen.scale, round: true, wobble: 0.8 });
    if (colors.length === 1) pen.stroke(id + ':c', lp, { width: w - line * 0.2, color: colors[0], round: true, wobble: 0.5 });
    else {
      const k = Math.ceil(lp.length * 0.52);
      pen.stroke(id + ':c2', lp.slice(k - 1), { width: w * 0.86, color: colors[1], round: true, wobble: 0.5 });
      pen.stroke(id + ':c1', lp.slice(0, k + 1), { width: w * 1.02, color: colors[0], round: true, wobble: 0.5 });
    }
  };
  const arm = (side) => {
    const front = side === 'F';
    const root = front ? shF : shB;
    const out = front ? 1 : -1;
    const seg = 0.135 * H;
    let elbow;
    let hand;
    const reach = pose['reach' + side];
    if (reach) {
      hand = [hc[0] + reach[0] * R, hc[1] + reach[1] * R];
      elbow = ik(root, hand, seg, seg, front ? 1 : -1);
      if (elbow[1] < root[1] - seg * 0.2) elbow = ik(root, hand, seg, seg, front ? -1 : 1);
    } else {
      const [a, e] = pose[side] || [8, 8];
      elbow = swing(root, seg, a, out);
      hand = swing(elbow, seg, a + e, out);
    }
    const mid = [(root[0] + elbow[0]) / 2, (root[1] + elbow[1]) / 2];
    limb('arm' + side, [root, mid, elbow, hand], armW, [ch.top, ch.skin]);
    const hp = P([hand])[0];
    pen.shape('hand' + side, ellipse(hp[0], hp[1], armW * 0.62, armW * 0.66, { n: 12 }), ch.skin, { width: line * 0.85 });
  };
  const leg = (side) => {
    const front = side === 'F';
    const [dx, up] = pose['foot' + side] || [0, 0];
    const root = [hip[0] + (front ? 1 : -1) * wb * 0.22, hip[1] - 0.02 * H];
    const foot = [(front ? 1 : -1) * wb * 0.22 + dx * H + hip[0] * 0.3, -lift - up * H];
    const knee = ik(root, foot, legLen * 0.54, legLen * 0.54, -1);
    limb('leg' + side, [root, knee, foot], legW, [ch.bottom]);
    const fp = P([[foot[0] + legW * 0.35, foot[1] - legW * 0.05]])[0];
    pen.shape('shoe' + side, ellipse(fp[0], fp[1], legW * 0.95, legW * 0.5, { n: 14, rot: facing * deg(up > 0.02 ? -12 : 0) }), ch.shoes, { width: line * 0.85 });
  };

  // Hair behind the head.
  const hairBack = () => {
    const s = ch.hairStyle;
    const k = 'hairB';
    if (s === 'bob') pen.shape(k, P(head(loop([[-1.12 * R, 0.1 * R], [-1.05 * R, -0.75 * R], [0, -1.18 * R], [1.05 * R, -0.75 * R], [1.12 * R, 0.1 * R], [0.95 * R, 0.62 * R], [0.2 * R, 0.5 * R], [-0.95 * R, 0.62 * R]]))), ch.hair);
    if (s === 'long') pen.shape(k, P(head(loop([[-1.12 * R, 0], [-1.02 * R, -0.8 * R], [0, -1.18 * R], [1.02 * R, -0.8 * R], [1.12 * R, 0], [1.1 * R, 1.25 * R], [0.5 * R, 1.35 * R], [-0.5 * R, 1.35 * R], [-1.1 * R, 1.25 * R]]))), ch.hair);
    if (s === 'bun') pen.shape(k, P(head(ellipse(-0.1 * R, -1.15 * R, 0.42 * R, 0.36 * R, { n: 16 }))), ch.hair);
    if (s === 'ponytail') {
      const sway = pose.sway || 0;
      pen.shape(k, P(head(loop([[-0.75 * R, -0.65 * R], [-1.35 * R, -0.3 * R], [-1.55 * R + sway * R, 0.45 * R], [-1.2 * R + sway * R, 0.85 * R], [-1.1 * R, 0.2 * R], [-0.85 * R, -0.25 * R]]))), ch.hair);
    }
  };

  // Hair in front: a cap with a fringe, shaped per style.
  const hairFront = () => {
    const s = ch.hairStyle;
    if (s === 'bald') {
      pen.stroke('strand', P(head(curve([[-0.1 * R, -0.98 * R], [0.05 * R, -1.18 * R], [0.25 * R, -1.08 * R]]))), { width: line * 0.7 });
      return;
    }
    const top = [];
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI + (i / 10) * Math.PI;
      const r = s === 'curly' ? R * (1.1 + 0.07 * Math.cos(i * 2.6)) : R * 1.07;
      top.push([Math.cos(a) * r, Math.sin(a) * r * 1.02]);
    }
    if (s === 'spiky') {
      const spikes = [];
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * (1.08 + (i / 6) * 0.84);
        const r = i % 2 ? R * 1.05 : R * 1.42;
        spikes.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      top.splice(1, top.length - 2, ...spikes);
    }
    // Fringe: comes down to brow level, parted toward where the face looks.
    const part = fx * 0.6;
    const fy = (s === 'short' || s === 'spiky') ? -0.58 * R : -0.52 * R;
    const fringe = [
      [1.04 * R, -0.08 * R],
      [0.7 * R, fy - 0.05 * R],
      [part + 0.25 * R, fy + 0.04 * R],
      [part, fy - 0.18 * R],
      [part - 0.35 * R, fy + 0.02 * R],
      [-0.78 * R, fy - 0.06 * R],
      [-1.04 * R, -0.08 * R],
    ];
    const pts = loop([...top.filter((_, i) => i % 2 === 0 || s === 'spiky'), ...fringe], 6);
    pen.shape('hairF', P(head(pts)), ch.hair);
    if (s === 'curly') for (let i = 0; i < 3; i++) pen.stroke('curl' + i, P(head(ellipse((-0.5 + i * 0.45) * R, -0.75 * R, 0.13 * R, 0.1 * R, { from: 0.5, to: 5.5, n: 10 }))), { width: line * 0.6 });
    if (s === 'bun') pen.stroke('bunline', P(head(curve([[-0.35 * R, -1.08 * R], [-0.1 * R, -1.0 * R], [0.15 * R, -1.08 * R]]))), { width: line * 0.6 });
  };

  const eyes = () => {
    const ey = (pose.eyeY || 0) * R + 0.02 * R;
    const gap = 0.33 * R;
    const r = 0.1 * R * (ch.eyes === 'oval' ? 1.1 : 1);
    const kind = pose.eyes || face.eyes;
    const blink = pose.blink && kind !== 'wide';
    for (const [k, sx] of [['L', -1], ['R', 1]]) {
      const ex = fx + sx * gap + (pose.gaze || 0) * 0.06 * R;
      const at = (pts) => P(head(pts));
      if (blink || kind === 'closed') pen.stroke('eye' + k, at(curve([[ex - r * 1.2, ey], [ex, ey + r * 0.5], [ex + r * 1.2, ey]])), { width: line * 0.85 });
      else if (kind === 'happy') pen.stroke('eye' + k, at(curve([[ex - r * 1.2, ey + r * 0.4], [ex, ey - r * 0.8], [ex + r * 1.2, ey + r * 0.4]])), { width: line * 0.85 });
      else if (kind === 'wide') {
        pen.shape('eyew' + k, at(ellipse(ex, ey - r * 0.3, r * 1.9, r * 2.2, { n: 16 })), '#ffffff', { width: line * 0.7, slip: 0.3 });
        pen.dot('eyed' + k, ...at([[ex + (pose.gaze || 0) * r * 0.4, ey - r * 0.2]])[0], r * 0.85);
      } else {
        const [px, py] = at([[ex, ey]])[0];
        if (ch.eyes === 'oval') {
          pen.shape('eyeo' + k, at(ellipse(ex, ey, r * 0.85, r * 1.35, { n: 12 })), ink, { width: line * 0.4, slip: 0 });
          pen.dot('eyeh' + k, ...at([[ex + r * 0.25, ey - r * 0.45]])[0], r * 0.3, '#ffffff');
        } else pen.dot('eyed' + k, px, py, r);
        const lid = ch.eyes === 'sleepy' || kind === 'lidded';
        if (lid) pen.stroke('lid' + k, at(curve([[ex - r * 1.5, ey - r * 0.25], [ex, ey - r * 0.55], [ex + r * 1.5, ey - r * 0.25]])), { width: line * 0.8 });
        if (kind === 'angry') pen.stroke('lid' + k, at([[ex - sx * r * 1.6, ey - r * 1.5], [ex + sx * r * 1.3, ey - r * 0.4]]), { width: line * 0.7 });
        if (kind === 'sad') pen.stroke('lid' + k, at([[ex - sx * r * 1.4, ey - r * 1.3], [ex + sx * r * 1.4, ey - r * 0.5]]), { width: line * 0.6 });
      }
    }
    if (ch.extras.includes('blush') || pose.fx === 'blush')
      for (const sx of [-1, 1]) pen.fill('blush' + sx, P(head(ellipse(fx + sx * 0.5 * R, ey + 0.27 * R, 0.14 * R, 0.07 * R, { n: 12 }))), mix(ch.skin, '#ff6f7d', 0.45), { slip: 0.2, alpha: 0.8 });
    if (ch.extras.includes('freckles'))
      for (let i = 0; i < 6; i++) {
        const sx = i < 3 ? -1 : 1;
        const [qx, qy] = P(head([[fx + sx * (0.42 + (i % 3) * 0.08) * R, ey + (0.2 + ((i * 7) % 3) * 0.05) * R]]))[0];
        pen.dot('frk' + i, qx, qy, 0.022 * R, skinLine);
      }
    if (ch.extras.includes('glasses')) {
      for (const sx of [-1, 1]) pen.stroke('glass' + sx, P(head(ellipse(fx + sx * gap, ey, 0.2 * R, 0.17 * R, { n: 16 }))), { width: line * 0.7, closed: true });
      pen.stroke('bridge', P(head(curve([[fx - gap + 0.2 * R, ey - 0.02 * R], [fx, ey - 0.07 * R], [fx + gap - 0.2 * R, ey - 0.02 * R]]))), { width: line * 0.6 });
    }
  };

  // Brows go over the fringe (cartoon brows show through hair): the inner
  // end tilts with the feeling, which carries most of the expression.
  const brows = () => {
    const ey = (pose.eyeY || 0) * R + 0.02 * R;
    for (const [k, sx] of [['L', -1], ['R', 1]]) {
      const ex = fx + sx * 0.33 * R + (pose.gaze || 0) * 0.06 * R;
      const by = ey - 0.33 * R + face.browY * R + (pose.browUp || 0) * R;
      const b = deg(face.brow) * (face.browOne && sx < 0 ? 0.2 : 1);
      // brow > 0 lifts the inner end (sad, worried); < 0 pulls it down (angry).
      const inner = [ex - sx * 0.12 * R, by - Math.sin(b) * 0.17 * R];
      const outer = [ex + sx * 0.15 * R, by + Math.sin(b) * 0.17 * R - (face.browOne && sx > 0 ? 0.07 * R : 0)];
      pen.stroke('brow' + k, P(head(curve([inner, [(inner[0] + outer[0]) / 2, (inner[1] + outer[1]) / 2 - 0.03 * R], outer]))), { width: line * 1.15 });
    }
  };

  const mouth = () => {
    const my = 0.45 * R;
    const w = 0.34 * R;
    const m = pose.mouth || face.mouth;
    const at = (pts) => P(head(pts.map(([u, v]) => [fx * 1.05 + u, my + v])));
    const dark = '#6b2a2a';
    const lw = { width: line * 0.9 };
    if (m === 'smile') pen.stroke('mouth', at(curve([[-w / 2, -0.03 * R], [0, 0.09 * R], [w / 2, -0.03 * R]])), lw);
    else if (m === 'frown') pen.stroke('mouth', at(curve([[-w / 2, 0.07 * R], [0, -0.04 * R], [w / 2, 0.07 * R]])), lw);
    else if (m === 'flat') pen.stroke('mouth', at([[-w * 0.38, 0.01 * R], [w * 0.38, -0.01 * R]]), lw);
    else if (m === 'smirk') pen.stroke('mouth', at(curve([[-w * 0.4, 0.03 * R], [w * 0.1, 0.05 * R], [w * 0.5, -0.07 * R]])), lw);
    else if (m === 'wavy') pen.stroke('mouth', at(curve([[-w / 2, 0.02 * R], [-w / 4, -0.03 * R], [0, 0.02 * R], [w / 4, -0.03 * R], [w / 2, 0.02 * R]])), lw);
    else if (m === 'grit') {
      pen.shape('mouth', at(loop([[-w / 2, -0.04 * R], [w / 2, -0.04 * R], [w / 2, 0.06 * R], [-w / 2, 0.06 * R]], 4)), '#ffffff', { width: line * 0.8 });
      pen.stroke('teeth', at([[-w / 2, 0.01 * R], [w / 2, 0.01 * R]]), { width: line * 0.5 });
    } else {
      const [rx, ry, dy] = { grin: [w * 0.55, 0.13 * R, 0.02 * R], open: [w * 0.3, 0.08 * R, 0.02 * R], wide: [w * 0.42, 0.17 * R, 0.04 * R], o: [w * 0.18, 0.12 * R, 0.02 * R] }[m] || [w * 0.3, 0.08 * R, 0];
      const pts = m === 'grin' ? loop([[-rx, -0.04 * R], [rx, -0.04 * R], [rx * 0.6, ry * 0.8], [0, ry], [-rx * 0.6, ry * 0.8]], 5) : ellipse(0, dy, rx, ry, { n: 14 });
      pen.shape('mouth', at(pts), dark, { width: line * 0.8, slip: 0.2 });
      if (m === 'grin' || m === 'wide') pen.fill('tongue', at(ellipse(0, m === 'grin' ? ry * 0.55 : dy + ry * 0.55, rx * 0.45, ry * 0.3, { n: 10 })), '#d9646a', { slip: 0 });
    }
  };

  const extrasOnHead = () => {
    if (ch.extras.includes('beard')) pen.shape('beard', P(head(loop([[-0.98 * R, 0.05 * R], [-0.55 * R, 0.62 * R], [fx, 1.08 * R], [0.55 * R, 0.62 * R], [0.98 * R, 0.05 * R], [0.6 * R, 0.4 * R], [fx, 0.62 * R], [-0.6 * R, 0.4 * R]]))), ch.hair);
    if (ch.extras.includes('cap')) {
      pen.shape('cap', P(head(loop([[-1.06 * R, -0.35 * R], [-0.9 * R, -0.95 * R], [0, -1.2 * R], [0.9 * R, -0.95 * R], [1.06 * R, -0.35 * R]], 6))), mix(ch.top, ink, 0.25));
      pen.shape('brim', P(head(loop([[0.2 * R, -0.42 * R], [1.6 * R, -0.42 * R], [1.55 * R, -0.3 * R], [0.2 * R, -0.3 * R]], 4))), mix(ch.top, ink, 0.35));
    }
    if (ch.extras.includes('bow')) {
      pen.shape('bowL', P(head(loop([[0.55 * R, -0.95 * R], [0.25 * R, -1.25 * R], [0.2 * R, -0.8 * R]], 5))), '#e85d75');
      pen.shape('bowR', P(head(loop([[0.55 * R, -0.95 * R], [0.95 * R, -1.15 * R], [0.85 * R, -0.7 * R]], 5))), '#e85d75');
    }
  };

  const effects = () => {
    const fxk = pose.fx || face.fx;
    const d = pen.drawing;
    if (fxk === 'vein') {
      const [vx, vy] = P(head([[0.62 * R, -0.62 * R]]))[0];
      for (let i = 0; i < 4; i++) {
        const a = deg(45 + i * 90);
        const s = (0.12 + (d % 2) * 0.02) * R;
        pen.stroke('vein' + i, [[vx + Math.cos(a) * s * 0.4, vy + Math.sin(a) * s * 0.4], [vx + Math.cos(a + 0.5) * s * 1.3, vy + Math.sin(a + 0.5) * s * 1.3]], { width: line * 0.9, color: '#d1453b' });
      }
    }
    if (fxk === 'sweat') {
      const [sx, sy] = P(head([[-0.85 * R, -0.4 * R + (d % 3) * 0.06 * R]]))[0];
      pen.shape('sweat', loop([[sx, sy - 0.2 * R], [sx + 0.09 * R, sy + 0.02 * R], [sx, sy + 0.1 * R], [sx - 0.09 * R, sy + 0.02 * R]], 5), '#9fd3f2', { width: line * 0.6 });
    }
    if (fxk === 'tears')
      for (const sxx of [-1, 1]) {
        const ex = fx + sxx * 0.33 * R;
        const run = 0.25 + ((d + (sxx > 0 ? 1 : 0)) % 3) * 0.18;
        pen.stroke('tear' + sxx, P(head(curve([[ex, 0.12 * R], [ex + sxx * 0.05 * R, (0.12 + run * 0.6) * R], [ex + sxx * 0.02 * R, (0.12 + run * 1.2) * R]]))), { width: line * 1.6, color: '#7cc3ee', round: true });
      }
    if (fxk === 'dots') {
      for (let i = 0; i < 3; i++) {
        if (i > d % 4) break;
        const [qx, qy] = P(head([[1.05 * R + i * 0.32 * R, -1.15 * R - i * 0.28 * R]]))[0];
        pen.shape('think' + i, ellipse(qx, qy, (0.06 + i * 0.03) * R, (0.05 + i * 0.03) * R, { n: 10 }), '#ffffff', { width: line * 0.6 });
      }
    }
    if (fxk === 'lines') {
      for (let i = 0; i < 3; i++) {
        const a = deg(-60 + i * 30);
        const [cx, cy] = P(head([[Math.sin(a) * 1.35 * R, -Math.cos(a) * 1.35 * R]]))[0];
        const [ox, oy] = P(head([[Math.sin(a) * 1.65 * R, -Math.cos(a) * 1.65 * R]]))[0];
        pen.stroke('emph' + i, [[cx, cy], [ox, oy]], { width: line * 0.8 });
      }
    }
  };

  // Paint order: back arm, legs, body, front arm (unless it crosses the
  // face), back hair, head, face, front hair, effects, then a crossing arm.
  if (!pose.overB) arm('B');
  leg('B');
  leg('F');
  const body = loop([[-wb / 2, -0.02 * T], [-wb * 0.48, -0.42 * T], [-wt / 2, -0.78 * T], [-wt * 0.32, -T], [wt * 0.32, -T], [wt / 2, -0.78 * T], [wb * 0.48, -0.42 * T], [wb / 2, -0.02 * T], [0, 0.06 * T]], 6);
  const pants = loop([[-wb * 0.49, -0.26 * T], [wb * 0.49, -0.26 * T], [wb * 0.5, -0.02 * T], [0, 0.06 * T], [-wb * 0.5, -0.02 * T]], 5);
  pen.fill('body', P(tor(body)), ch.top);
  pen.fill('pants', P(tor(pants)), ch.bottom, { slip: 0.5 });
  pen.stroke('body', P(tor(body)), { closed: true });
  pen.stroke('waist', P(tor(curve([[-wb * 0.48, -0.26 * T], [0, -0.23 * T], [wb * 0.48, -0.26 * T]]))), { width: line * 0.75 });
  if (!pose.overF) arm('F');
  hairBack();
  // An ear on the side away from the look, a small sign of the turn.
  pen.shape('ear', P(head(ellipse(-0.98 * R + fx * 0.3, 0.08 * R, 0.14 * R, 0.2 * R, { n: 10 }))), ch.skin, { width: line * 0.7 });
  const headPts = loop([[0, -R], [0.72 * R, -0.72 * R], [R * 1.0, 0], [0.74 * R, 0.72 * R], [0, R * 1.02], [-0.74 * R, 0.72 * R], [-R * 1.0, 0], [-0.72 * R, -0.72 * R]], 7);
  pen.fill('head', P(head(headPts)), ch.skin);
  pen.stroke('head', P(head(headPts)), { closed: true });
  eyes();
  mouth();
  hairFront();
  brows();
  extrasOnHead();
  if (pose.overB) arm('B');
  if (pose.overF) arm('F');
  effects();
  return { head: P([hc])[0], R, H, top: P([[hc[0], hc[1] - R * 1.2]])[0] };
}

// Where a character's head will be, for speech bubble tails (no drawing).
export function headSpot(ch, { x, ground, scale = 1 }) {
  const H = BASE_H * ch.height * scale;
  const R = 0.19 * H * ch.headSize;
  return { x, y: ground - 0.23 * H - 0.3 * H - R * 0.92, R, H };
}

export const seedFor = (who) => hash('actor', who);
export { lerp };
