// Turns a validated project into frames. renderFrame() is pure (no DOM) and
// gives layers of ops; paint() draws them on a canvas, toSVG() makes an SVG.
import { LIGHT, Pen, curve, ellipse, hash, loop, mix, pathOf, rng, wrap } from './draw.js';
import { drawCharacter, headSpot, seedFor, FACE } from './rig.js';
import { poseFor, MOVE_SET, WALK_SPEED } from './moves.js';

export const W = 1600;
export const H = 900;
export const GROUND = 774;
const HORIZON = 640;
export const FONT = '"Patrick Hand", "Comic Neue", "Comic Sans MS", "Chalkboard SE", cursive';

// ---------- time ----------
export function timeline(p) {
  let t = 0;
  return p.scenes.map((s, i) => {
    const start = t;
    t += s.duration;
    return { i, start, end: t };
  });
}
export const totalSeconds = (p) => p.scenes.reduce((s, x) => s + x.duration, 0);
export function locate(p, t) {
  const tl = timeline(p);
  for (const x of tl) if (t < x.end) return { scene: x.i, t: Math.max(0, t - x.start) };
  const last = tl[tl.length - 1];
  return last ? { scene: last.i, t: Math.max(0, last.end - last.start - 1e-3) } : { scene: 0, t: 0 };
}
// Drawings change every `hold` frames; between them the picture holds.
export function quantize(style, t) {
  const frame = Math.floor(t * style.fps + 1e-6);
  const drawing = Math.floor(frame / style.hold);
  return { frame, drawing, tq: (drawing * style.hold) / style.fps };
}

// ---------- actors ----------
// Where an actor stands at time t, which way they face, and whether they are mid-walk.
export function actorState(scene, actor, t) {
  let x = actor.x;
  let facing = actor.facing;
  let walking = false;
  let beat = actor.beats[0];
  let beatIndex = 0;
  for (let k = 0; k < actor.beats.length; k++) {
    const b = actor.beats[k];
    if (b.t > t) break;
    beat = b;
    beatIndex = k;
    const nextT = actor.beats[k + 1]?.t ?? Infinity;
    if (b.move === 'walk' && b.to != null) {
      const end = Math.min(t, nextT);
      const dist = b.to - x;
      const travel = WALK_SPEED * (end - b.t);
      if (Math.abs(dist) > 1e-3) facing = dist > 0 ? 1 : -1;
      walking = end === t && Math.abs(dist) > travel;
      x += Math.sign(dist) * Math.min(Math.abs(dist), travel);
    }
  }
  if (beat.look) facing = beat.look;
  if (beat.at) {
    const other = scene.actors.find((a) => a.who === beat.at);
    if (other && other !== actor) {
      const ox = actorState({ actors: [] }, other, t).x;
      if (Math.abs(ox - x) > 0.01) facing = ox > x ? 1 : -1;
    }
  }
  return { x, facing, walking, beat, beatIndex, phase: t - beat.t };
}

// ---------- backgrounds and props (static per scene, so the page caches them) ----------
const BG = {
  plain: { wall: '#f3ead8', floor: null },
  room: { wall: '#efe2cc', floor: '#d6bf9c' },
  bedroom: { wall: '#e4ddef', floor: '#cdb79a' },
  kitchen: { wall: '#f0e6c6', floor: '#c9cfc4' },
  classroom: { wall: '#e2ead6', floor: '#cdb38f' },
  street: { wall: '#cfe4ef', floor: '#b9b6ae' },
  park: { wall: '#d4eaf1', floor: '#a8cf8e' },
  night: { wall: '#2e3a5c', floor: '#3e4a4a' },
};

export function renderBackground(p, scene) {
  const st = p.style;
  const ops = [];
  const pen = new Pen({ style: { ...st, boil: 0, wobble: st.wobble * 0.8 }, seed: hash('bg', scene.id, scene.bg.kind), ops, scale: 1 / Math.pow(scene.camera?.zoom || 1, 0.75) });
  const k = scene.bg.kind;
  const spec = BG[k];
  const wall = scene.bg.color || spec.wall;
  const soft = mix(st.ink, wall, k === 'night' ? 0.25 : 0.45);
  const thin = { width: st.line * 0.7, color: soft };
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  const box = (id, x0, y0, x1, y1, col, o = thin) => {
    pen.fill(id, rect(x0, y0, x1, y1), col, { slip: 0.6 });
    pen.stroke(id, rect(x0, y0, x1, y1), { ...o, closed: true });
  };
  ops.push({ d: `M-20 -20H${W + 20}V${H + 20}H-20Z`, fill: wall });
  const horizon = k === 'street' || k === 'park' || k === 'night' ? 600 : HORIZON;
  if (spec.floor) {
    pen.fill('floor', rect(-20, horizon, W + 20, H + 20), scene.bg.color && k === 'plain' ? mix(wall, st.ink, 0.1) : spec.floor, { slip: 0 });
    pen.stroke('horizon', [[-10, horizon], [W * 0.5, horizon + 2], [W + 10, horizon - 1]], thin);
  } else pen.stroke('horizon', [[W * 0.06, GROUND + 8], [W * 0.94, GROUND + 6]], { ...thin, taper: 1 });

  const r = rng(hash('bgdots', scene.id));
  if (k === 'room' || k === 'bedroom') {
    box('win', 170, 200, 420, 450, '#cfe8f5');
    pen.stroke('winx', [[295, 205], [295, 445]], thin);
    pen.stroke('winy', [[175, 325], [415, 325]], thin);
    if (k === 'bedroom') {
      pen.shape('curtL', loop([[150, 185], [215, 190], [200, 330], [225, 470], [150, 470]], 5), '#e3a1b4', thin);
      pen.shape('curtR', loop([[440, 185], [375, 190], [390, 330], [365, 470], [440, 470]], 5), '#e3a1b4', thin);
      box('poster', 1080, 210, 1240, 400, '#f7d47c');
      pen.stroke('posterstar', loop([[1160, 250], [1180, 300], [1215, 305], [1185, 330], [1195, 370], [1160, 345], [1125, 370], [1135, 330], [1105, 305], [1140, 300]], 2), thin);
    } else {
      box('frame', 1150, 230, 1350, 380, '#f4c99a');
      pen.stroke('mount', [[1170, 360], [1230, 290], [1270, 330], [1300, 300], [1330, 360]], thin);
    }
    pen.stroke('base', [[-10, horizon - 16], [W + 10, horizon - 18]], thin);
  }
  if (k === 'kitchen') {
    box('upper1', 120, 130, 520, 330, '#e8d3a6');
    box('upper2', 1080, 130, 1480, 330, '#e8d3a6');
    pen.stroke('updiv1', [[320, 135], [320, 325]], thin);
    pen.stroke('updiv2', [[1280, 135], [1280, 325]], thin);
    box('counter', -20, 470, W + 20, horizon, '#d9c7a3');
    pen.stroke('countertop', [[-10, 470], [W + 10, 468]], { ...thin, width: st.line });
    for (let i = 0; i < 6; i++) pen.stroke('drawer' + i, [[120 + i * 260, 520], [190 + i * 260, 520]], thin);
    box('fridge', 1380, 250, 1560, horizon, '#eef1f2');
    pen.stroke('fridgeline', [[1385, 390], [1555, 390]], thin);
    pen.stroke('handle', [[1405, 300], [1405, 360]], { ...thin, width: st.line });
  }
  if (k === 'classroom') {
    box('board', 380, 140, 1220, 440, '#3f6b55');
    pen.stroke('chalk1', curve([[460, 220], [560, 205], [700, 230]]), { width: 4, color: '#eef3ea' });
    pen.stroke('chalk2', curve([[460, 290], [620, 280], [820, 300]]), { width: 4, color: '#eef3ea' });
    pen.stroke('chalk3', curve([[460, 360], [540, 355]]), { width: 4, color: '#eef3ea' });
    pen.shape('clock', ellipse(1390, 210, 60, 60), '#ffffff', thin);
    pen.stroke('hands', [[1390, 175], [1390, 210], [1420, 225]], thin);
  }
  if (k === 'street') {
    const cols = ['#d9a68c', '#c8b7a6', '#b9c4cf', '#e0c48f', '#c9a9b8'];
    let x = -40;
    let i = 0;
    while (x < W + 40) {
      const w = 220 + r() * 140;
      const top = 160 + r() * 220;
      box('bld' + i, x, top, x + w - 14, horizon, cols[i % cols.length]);
      for (let wy = top + 40; wy < horizon - 80; wy += 90)
        for (let wx = x + 30; wx < x + w - 70; wx += 80) box(`w${i}-${wx}-${wy}`, wx, wy, wx + 40, wy + 50, '#f3eac0', { ...thin, width: st.line * 0.5 });
      x += w;
      i++;
    }
    pen.fill('road', rect(-20, 690, W + 20, H + 20), '#8f8c86', { slip: 0 });
    pen.stroke('curb', [[-10, 690], [W + 10, 692]], thin);
    for (let i2 = 0; i2 < 6; i2++) pen.stroke('lane' + i2, [[80 + i2 * 290, 840], [220 + i2 * 290, 838]], { width: 7, color: '#f1ead2' });
  }
  if (k === 'park' || k === 'night') {
    const night = k === 'night';
    if (night) {
      for (let i = 0; i < 40; i++) pen.dot('star' + i, r() * W, r() * 420, 1.5 + r() * 2.5, '#f6f0d0');
      pen.shape('moon', ellipse(1320, 160, 62, 62), '#f6efc8', { width: st.line * 0.7, color: '#c9c2a0' });
    } else {
      pen.shape('sun', ellipse(1340, 150, 70, 70), '#f8d77a', thin);
      for (let i = 0; i < 3; i++) {
        const cx = 200 + i * 420 + r() * 80;
        const cy = 120 + r() * 80;
        pen.shape('cloud' + i, loop([[cx - 90, cy + 20], [cx - 60, cy - 25], [cx, cy - 40], [cx + 60, cy - 25], [cx + 95, cy + 15], [cx, cy + 35]], 6), '#ffffff', thin);
      }
    }
    const hill = night ? '#33463f' : '#bfe0a3';
    pen.shape('hill1', loop([[-60, horizon + 10], [300, horizon - 140], [700, horizon - 40], [700, horizon + 40], [-60, horizon + 40]], 6), hill, thin);
    pen.shape('hill2', loop([[600, horizon + 10], [1100, horizon - 170], [1700, horizon - 60], [1700, horizon + 40], [600, horizon + 40]], 6), night ? '#2c3d39' : '#b0d692', thin);
    if (night)
      for (let i = 0; i < 3; i++) {
        const x0 = 120 + i * 520;
        box('house' + i, x0, horizon - 150, x0 + 200, horizon, '#1f2a40', { ...thin, color: '#55617a' });
        box('hwin' + i, x0 + 70, horizon - 110, x0 + 120, horizon - 60, '#f2d27a', { ...thin, color: '#55617a' });
      }
    else
      for (const tx of [140, 1500]) {
        box('trunk' + tx, tx - 18, horizon - 160, tx + 18, horizon + 10, '#9a7652');
        pen.shape('crown' + tx, loop([[tx - 120, horizon - 170], [tx - 90, horizon - 300], [tx, horizon - 350], [tx + 100, horizon - 290], [tx + 120, horizon - 170], [tx, horizon - 130]], 6), '#7fb069', thin);
      }
  }
  for (const [i, pr] of scene.props.entries()) drawProp(pen, pr, i, soft, st);
  return ops;
}

function drawProp(pen, pr, i, soft, st) {
  const x = pr.x * W;
  const s = pr.scale;
  const id = `prop${i}`;
  const o = { width: st.line * 0.85 };
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  const box = (k, x0, y0, x1, y1, col) => {
    pen.fill(id + k, rect(x0, y0, x1, y1), col, { slip: 0.6 });
    pen.stroke(id + k, rect(x0, y0, x1, y1), { ...o, closed: true });
  };
  const g = GROUND;
  if (pr.kind === 'table') {
    box('top', x - 170 * s, g - 150 * s, x + 170 * s, g - 128 * s, '#b98a5e');
    box('l1', x - 150 * s, g - 128 * s, x - 132 * s, g, '#a27650');
    box('l2', x + 132 * s, g - 128 * s, x + 150 * s, g, '#a27650');
  } else if (pr.kind === 'chair') {
    box('back', x - 60 * s, g - 230 * s, x - 44 * s, g - 100 * s, '#c48f62');
    box('seat', x - 60 * s, g - 108 * s, x + 50 * s, g - 92 * s, '#c48f62');
    box('l1', x - 56 * s, g - 92 * s, x - 44 * s, g, '#a9764d');
    box('l2', x + 34 * s, g - 92 * s, x + 46 * s, g, '#a9764d');
  } else if (pr.kind === 'bed') {
    box('frame', x - 230 * s, g - 110 * s, x + 230 * s, g - 30 * s, '#b6865c');
    box('sheet', x - 220 * s, g - 150 * s, x + 220 * s, g - 105 * s, '#9cc1e6');
    pen.shape(id + 'pillow', ellipse(x - 160 * s, g - 160 * s, 60 * s, 26 * s), '#ffffff', o);
    box('head', x - 250 * s, g - 230 * s, x - 226 * s, g, '#a27650');
  } else if (pr.kind === 'door') {
    box('door', x - 90 * s, g - 360 * s, x + 90 * s, g, '#b07d55');
    pen.dot(id + 'knob', x + 60 * s, g - 180 * s, 9 * s, '#e8c35a');
  } else if (pr.kind === 'window') {
    box('win', x - 110 * s, g - 470 * s, x + 110 * s, g - 260 * s, '#cfe8f5');
    pen.stroke(id + 'x', [[x, g - 465 * s], [x, g - 265 * s]], o);
  } else if (pr.kind === 'tree') {
    box('trunk', x - 22 * s, g - 220 * s, x + 22 * s, g, '#9a7652');
    pen.shape(id + 'crown', loop([[x - 150 * s, g - 220 * s], [x - 110 * s, g - 380 * s], [x, g - 440 * s], [x + 120 * s, g - 370 * s], [x + 150 * s, g - 220 * s], [x, g - 170 * s]], 6), '#7fb069', o);
  } else if (pr.kind === 'phone') {
    box('ph', x - 22 * s, g - 190 * s, x + 22 * s, g - 110 * s, '#3b3f4a');
    box('scr', x - 16 * s, g - 182 * s, x + 16 * s, g - 122 * s, '#9fd3f2');
  } else if (pr.kind === 'sign') {
    box('post', x - 9 * s, g - 260 * s, x + 9 * s, g, '#9a7652');
    box('board', x - 120 * s, g - 330 * s, x + 120 * s, g - 230 * s, '#f4e3b8');
    if (pr.text) pen.text(pr.text, x, g - 268 * s, 38 * s);
  } else if (pr.kind === 'lamp') {
    pen.stroke(id + 'pole', [[x, g], [x, g - 300 * s]], { ...o, width: st.line * 1.4 });
    pen.shape(id + 'shade', loop([[x - 50 * s, g - 300 * s], [x - 30 * s, g - 380 * s], [x + 30 * s, g - 380 * s], [x + 50 * s, g - 300 * s]], 3), '#f6d77f', o);
  } else if (pr.kind === 'box') {
    box('box', x - 80 * s, g - 130 * s, x + 80 * s, g, '#d2a86f');
    pen.stroke(id + 'tape', [[x - 80 * s, g - 100 * s], [x + 80 * s, g - 102 * s]], { width: st.line * 0.6, color: soft });
  }
}

// ---------- speech bubbles and captions ----------
function bubble(pen, text, spot, placed, st) {
  const size = 34;
  const lines = wrap(text, 22);
  const tw = Math.max(...lines.map((l) => l.length)) * size * 0.47 + 50;
  const th = lines.length * size * 1.12 + 34;
  let cx = Math.max(tw / 2 + 20, Math.min(W - tw / 2 - 20, spot.x + (spot.x < W / 2 ? 60 : -60)));
  let cy = spot.y - spot.R * 1.5 - th / 2 - 30;
  // Keep bubbles off each other and on the page.
  for (const b of placed) if (Math.abs(b.cx - cx) < (b.w + tw) / 2 && Math.abs(b.cy - cy) < (b.h + th) / 2) cy = b.cy - (b.h + th) / 2 - 16;
  cy = Math.max(th / 2 + 14, cy);
  placed.push({ cx, cy, w: tw, h: th });
  const pts = ellipse(cx, cy, tw / 2 + 16, th / 2 + 8, { n: 40 });
  // Tail: replace the bottom points nearest the speaker with a point.
  const tip = [spot.x + (cx - spot.x) * 0.15, Math.min(spot.y - spot.R * 1.1, cy + th / 2 + 70)];
  const ang = Math.atan2(tip[1] - cy, tip[0] - cx);
  const n = pts.length - 1;
  const idx = Math.round(((ang < 0 ? ang + Math.PI * 2 : ang) / (Math.PI * 2)) * n);
  const ring = pts.slice(0, n);
  const a = (idx - 2 + n) % n;
  const b = (idx + 2) % n;
  const shape = [];
  for (let i = 0; i < n; i++) {
    if (i === a) shape.push(ring[a], tip);
    else if ((a < b && i > a && i < b) || (a > b && (i > a || i < b))) continue;
    else shape.push(ring[i]);
  }
  shape.push(shape[0]);
  pen.fill('bubble' + text.length, shape, '#fffdf6', { slip: 0.25 });
  pen.stroke('bubble' + text.length, shape, { closed: true, width: st.line * 0.85 });
  lines.forEach((l, i) => pen.text(l, cx, cy - th / 2 + 17 + size * 0.88 + i * size * 1.12, size));
}

function caption(ops, text, st) {
  const size = st.capPos === 'top' ? 50 : 38; // a top subtitle is read over the picture: bigger, like the references
  const lines = wrap(text, 58).slice(0, 3);
  if (st.capPos === 'top') {
    // Subtitle style: plain outlined text at the top centre, no box.
    const pen = new Pen({ style: { ...st, boil: 0 }, seed: hash('cap', text), ops });
    const white = mix(st.paper, '#ffffff', 0.9);
    lines.forEach((l, i) => pen.text(l, W / 2, 20 + size * 0.9 + i * size * 1.15, size, { color: white, outline: st.ink, weight: 700 }));
    return;
  }
  const h = lines.length * size * 1.15 + 22;
  const y0 = H - h - 14;
  const w = Math.min(W - 120, Math.max(...lines.map((l) => l.length)) * size * 0.46 + 70);
  const pen = new Pen({ style: { ...st, boil: 0 }, seed: hash('cap', text), ops });
  const x0 = (W - w) / 2;
  const pts = roundRect(x0, y0, w, h, 18);
  pen.fill('cap', pts, mix(st.paper, '#ffffff', 0.5), { slip: 0, alpha: 0.92 });
  pen.stroke('cap', pts, { closed: true, width: st.line * 0.6, color: mix(st.ink, st.paper, 0.4) });
  lines.forEach((l, i) => pen.text(l, W / 2, y0 + 11 + size * 0.9 + i * size * 1.15, size));
}

function roundRect(x0, y0, w, h, r) {
  const c = (cx, cy, a0) => ellipse(cx, cy, r, r, { from: a0, to: a0 + Math.PI / 2, n: 5 });
  const pts = [...c(x0 + w - r, y0 + r, -Math.PI / 2), ...c(x0 + w - r, y0 + h - r, 0), ...c(x0 + r, y0 + h - r, Math.PI / 2), ...c(x0 + r, y0 + r, Math.PI)];
  return [...pts, pts[0]];
}

// The camera at local time t: fixed, or eased (smoothstep) from camera to camera.to over the scene.
export function cameraAt(scene, t) {
  const c = scene.camera;
  if (!c.to) return c;
  const u = Math.min(1, Math.max(0, t / scene.duration));
  const e = u * u * (3 - 2 * u);
  return { zoom: c.zoom + (c.to.zoom - c.zoom) * e, x: c.x + (c.to.x - c.x) * e, y: c.y + (c.to.y - c.y) * e };
}

// ---------- one frame ----------
// sceneIndex + local time t. Returns { scene, drawing, bg (scene id for cache), world, overlay, camera }.
export function renderFrame(p, sceneIndex, t, { withBg = true } = {}) {
  const scene = p.scenes[sceneIndex];
  const st = p.style;
  const { drawing, tq } = quantize(st, t);
  const world = [];
  const cam = cameraAt(scene, t);
  // The camera magnifies the drawing; draw close-ups with a finer pen so the
  // line on screen stays close to the wide shot's (a bit heavier, as an artist would).
  const fine = 1 / Math.pow(cam.zoom, 0.75);
  const pen = new Pen({ style: st, drawing, ops: world, scale: fine });
  const placed = [];
  const states = scene.actors.map((a) => ({ a, s: actorState(scene, a, tq) }));
  const talkers = [];
  for (const { a, s } of states.sort((u, v) => u.a.scale - v.a.scale)) {
    const ch = p.cast[a.who];
    const sd = seedFor(a.who);
    const beat = s.walking ? s.beat : s.beat.move === 'walk' ? { ...s.beat, move: 'idle' } : s.beat;
    const pose = poseFor(beat, s.phase, { faceTalk: FACE[beat.face]?.talk, seed: sd % 97, talking: !!beat.say && beat.move !== 'walk', prev: a.beats[s.beatIndex - 1], time: tq, walking: s.walking });
    const at = { x: s.x * W, ground: GROUND, scale: a.scale, facing: s.facing };
    drawCharacter(pen.child({ seed: sd, scale: Math.sqrt(a.scale) * fine }), ch, pose, at);
    if (beat.say) talkers.push({ text: beat.say, spot: headSpot(ch, at) });
  }
  for (const tk of talkers) bubble(pen, tk.text, tk.spot, placed, st);
  const overlay = [];
  if (st.captions && scene.narration) caption(overlay, scene.narration, st);
  const z = cam.zoom;
  const fx = Math.max(W / 2 / z, Math.min(W - W / 2 / z, cam.x * W));
  const fy = Math.max(H / 2 / z, Math.min(H - H / 2 / z, cam.y * H));
  const camera = { zoom: z, tx: W / 2 - fx * z, ty: H / 2 - fy * z };
  return { scene: sceneIndex, drawing, bgKey: `${sceneIndex}:${scene.id}`, bg: withBg ? renderBackground(p, scene) : null, world, overlay, camera, paper: st.paper, grain: st.grain };
}

// The cast side by side with their names: the "model sheet" critics compare shots against.
export function renderCastSheet(p) {
  const ids = Object.keys(p.cast);
  const st = p.style;
  const world = [];
  const pen = new Pen({ style: st, drawing: 0, ops: world });
  ids.forEach((id, i) => {
    const x = ((i + 0.5) / ids.length) * W;
    drawCharacter(pen.child({ seed: seedFor(id) }), p.cast[id], { ...MOVE_SET.idle.drawings[0], face: 'happy' }, { x, ground: GROUND - 40, scale: 1, facing: 1 });
    pen.text(p.cast[id].name, x, GROUND + 40, 40);
  });
  return { world, overlay: [], bg: [{ d: `M0 0H${W}V${H}H0Z`, fill: st.paper }], camera: { zoom: 1, tx: 0, ty: 0 }, paper: st.paper, grain: st.grain };
}

// ---------- painters ----------
// Canvas: ctx is a 2D context of any size; it is scaled to the stage.
const pathCache = new Map();
function p2d(d) {
  let p = pathCache.get(d);
  if (!p) {
    p = new Path2D(d);
    if (pathCache.size > 6000) pathCache.clear();
    pathCache.set(d, p);
  }
  return p;
}
export function paintOps(ctx, ops) {
  for (const o of ops) {
    if (o.text != null) {
      ctx.fillStyle = o.fill;
      ctx.font = `${o.weight || 400} ${o.size}px ${FONT}`;
      ctx.textAlign = o.align || 'center';
      ctx.textBaseline = 'alphabetic';
      if (o.outline) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = o.size * 0.18;
        ctx.strokeStyle = o.outline;
        ctx.strokeText(o.text, o.x, o.y);
      }
      ctx.fillText(o.text, o.x, o.y);
      continue;
    }
    ctx.globalAlpha = o.alpha ?? 1;
    ctx.fillStyle = o.fill;
    if (o.clip) {
      ctx.save();
      ctx.clip(p2d(o.clip));
      ctx.fill(p2d(o.d));
      ctx.restore();
    } else ctx.fill(p2d(o.d));
    ctx.globalAlpha = 1;
  }
}

// grainCanvas: an optional small canvas of paper texture made once by the page.
export function paint(ctx, frame, { width, height, bgCanvas = null, grainCanvas = null }) {
  const k = width / W;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = frame.paper;
  ctx.fillRect(0, 0, width, height);
  const c = frame.camera;
  ctx.setTransform(k * c.zoom, 0, 0, k * c.zoom, k * c.tx, k * c.ty);
  if (bgCanvas) {
    ctx.drawImage(bgCanvas, 0, 0, W, H);
  } else if (frame.bg) paintOps(ctx, frame.bg);
  paintOps(ctx, frame.world);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  if (grainCanvas && frame.grain > 0) {
    ctx.globalAlpha = 0.5 * frame.grain;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = ctx.createPattern(grainCanvas, 'repeat');
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  paintOps(ctx, frame.overlay);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// Paper texture: speckles and faint fibres, made once per page.
export function makeGrain(doc, seed = 7) {
  const c = doc.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  const r = rng(seed);
  for (let i = 0; i < 2600; i++) {
    const v = 200 + Math.floor(r() * 55);
    g.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
    g.fillRect(r() * 256, r() * 256, 1 + r() * 1.5, 1 + r() * 1.5);
  }
  g.strokeStyle = 'rgba(150,130,100,0.18)';
  for (let i = 0; i < 40; i++) {
    const x = r() * 256;
    const y = r() * 256;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + r() * 20 - 10, y + r() * 20 - 10, x + r() * 30 - 15, y + r() * 30 - 15);
    g.stroke();
  }
  return c;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let clipN = 0;
function svgOps(ops) {
  return ops
    .map((o) => {
      if (o.text != null)
        return `<text x="${o.x}" y="${o.y}" font-size="${o.size}" fill="${o.fill}"${o.outline ? ` stroke="${o.outline}" stroke-width="${o.size * 0.18}" stroke-linejoin="round" paint-order="stroke"` : ''}${o.weight ? ` font-weight="${o.weight}"` : ''} text-anchor="${o.align === 'left' ? 'start' : 'middle'}" font-family='${FONT}'>${esc(o.text)}</text>`;
      const path = `<path d="${o.d}" fill="${o.fill}"${o.alpha != null ? ` fill-opacity="${o.alpha}"` : ''}/>`;
      if (!o.clip) return path;
      const id = `cl${clipN++}`;
      return `<clipPath id="${id}"><path d="${o.clip}"/></clipPath><g clip-path="url(#${id})">${path}</g>`;
    })
    .join('');
}

// Ground shadow: every point of the figure thrown along the light onto the
// floor and flattened, then one convex outline (so overlapping parts never
// double-darken). pts = all the figure's outline points; groundY = the floor
// under the feet; light as in Pen.style.light (the direction it comes FROM).
export function castShadow(pen, pts, groundY, light = LIGHT) {
  if (pts.length < 3) return;
  const [lx, ly] = light;
  const run = ly < -0.05 ? -lx / -ly : 0; // sideways travel per unit of height
  const flat = pts.map(([x, y]) => {
    const h = Math.max(0, groundY - y);
    return [x + h * run * 0.85, groundY - h * 0.07];
  });
  const hull = convexHull(flat);
  const k = pen.style.shade ?? 0.6;
  pen.ops.push({ d: pathOf(hull), fill: pen.style.ink, alpha: 0.1 + 0.12 * k });
  const core = hull.map(([x, y]) => [x * 0.85 + (hull.reduce((a, p) => a + p[0], 0) / hull.length) * 0.15, y]);
  pen.ops.push({ d: pathOf(core), fill: pen.style.ink, alpha: 0.08 + 0.1 * k });
}

function convexHull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
export function toSVG(frame, width = W) {
  clipN = 0;
  const c = frame.camera;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${width}" height="${Math.round((width * H) / W)}"><rect width="${W}" height="${H}" fill="${frame.paper}"/><g transform="matrix(${c.zoom} 0 0 ${c.zoom} ${c.tx} ${c.ty})">${svgOps(frame.bg || [])}${svgOps(frame.world)}</g>${svgOps(frame.overlay)}</svg>`;
}
