// The studio's movements, acted with the whole body. A move is a few key
// poses on a timeline ([seconds, pose, ease into this key]); acting.js eases
// between them, lays the emotion posture of the beat's face under them and
// adds overlap, breathing and weight settles. Keys follow the animator's
// order: anticipation (a small move the other way), the action (often
// overshooting, ease 'back'), then a held, settling pose. Moves play once
// and hold their last key, unless `loop` ({from: key index, end: seconds})
// repeats them from that key.
//
// Pose fields: Pose v2 (see acting.js). F is the near arm/foot (on the screen
// side away from facing, closer to the camera), B the far one on the facing
// side. Hand targets: x toward facing, y down, z toward the camera, in shares
// of the character's height, from the shoulder (or from the head centre when
// the 4th item is 'head'). Options: posture (0..1, how much the feeling's posture shows),
// tempo: false (keep real time, e.g. walking), gesture (talking hands that
// scale with the feeling), settle (weight shifts while the move holds),
// talking (the mouth flaps).
import { act, endPose, toLegacy, POSTURE } from './acting.js';

const STRIDE = 0.11;
const TAU = Math.PI * 2;
// Held-pose cycles (move.cycle(pose, time, k)): small changes on the drawing
// clock while a pose holds, k (0..1) fading them in. Each nudges a copy.
const nudge = (pose, key, i, dv) => {
  if (Array.isArray(pose[key])) pose[key] = pose[key].map((v, j) => (j === i ? v + dv : v));
};
// The pump's shape over one beat (0..1): hold up, dip (anticipation), punch
// back up past the pose, settle, hold.
const PUMP = [[0, 0], [0.42, 0], [0.58, 1], [0.7, -0.35], [0.82, 0], [1, 0]];
const pump = (c) => {
  let i = 0;
  while (i < PUMP.length - 2 && PUMP[i + 1][0] <= c) i++;
  const [c0, v0] = PUMP[i];
  const [c1, v1] = PUMP[i + 1];
  const u = Math.max(0, Math.min(1, (c - c0) / (c1 - c0)));
  return v0 + (v1 - v0) * (u * u * (3 - 2 * u));
};

export const MOVE_SET = {
  idle: { settle: true, keys: [[0, {}]] },
  talk: {
    talking: true,
    gesture: true,
    settle: true,
    loop: { from: 0, end: 1.9 },
    keys: [
      [0, { armF: [12, 30, 62] }],
      [0.4, { armF: [20, 46, 84], gripF: 'open', spine: 2, headPitch: -3, twist: 4 }, 'out'],
      [0.75, { armF: [10, 26, 52], armB: [8, 8, 26], headPitch: 3, spine: 3 }, 'back'],
      [1.25, { armF: [22, 50, 76], armB: [12, 14, 34], gripF: 'open', twist: 7, headYaw: 5 }, 'io'],
      [1.6, { armF: [14, 34, 70], headPitch: 2 }, 'io'],
    ],
  },
  walk: {
    tempo: false,
    posture: 0.7,
    loop: { from: 0, end: 0.64 },
    keys: [
      // Contact (front leg forward, opposite arm forward), passing (body up,
      // back foot lifting through), the other contact, the other passing.
      [0, { footF: [STRIDE, 0, 0], footB: [-STRIDE, 0, 0], armF: [4, -34, 16], armB: [4, 34, 24], pelvis: [0, 0.014], weight: 0.3, twist: -6, spine: 4 }, 'in'],
      [0.16, { footF: [0, 0, 0], footB: [0.01, 0.055, 0], armF: [4, 0, 10], armB: [4, 0, 12], pelvis: [0, -0.012], weight: 0.6, spine: 3 }, 'out'],
      [0.32, { footF: [-STRIDE, 0, 0], footB: [STRIDE, 0, 0], armF: [4, 34, 24], armB: [4, -34, 16], pelvis: [0, 0.014], weight: -0.3, twist: 6, spine: 4, toe: 0.6 }, 'in'],
      [0.48, { footF: [0.01, 0.055, 0], footB: [0, 0, 0], armF: [4, 0, 12], armB: [4, 0, 10], pelvis: [0, -0.012], weight: -0.6, spine: 3 }, 'out'],
    ],
  },
  wave: {
    loop: { from: 2, end: 0.9 },
    keys: [
      [0, {}],
      [0.16, { armF: [120, 14, 70], gripF: 'open', spineSide: -3, pelvis: [0, 0.008] }, 'out'],
      [0.34, { armF: [150, 10, 40], gripF: 'open', headRoll: 7, spineSide: -5, weight: 0.3 }, 'back'],
      [0.62, { armF: [144, 12, 8], gripF: 'open', headRoll: 5, spineSide: -4, weight: 0.3 }, 'io'],
    ],
  },
  nod: {
    settle: true,
    keys: [
      [0, {}],
      [0.14, { headPitch: -7 }, 'out'],
      [0.32, { headPitch: 17, spine: 3 }, 'in'],
      [0.5, { headPitch: -2 }, 'io'],
      [0.66, { headPitch: 13, spine: 2 }, 'in'],
      [0.9, { headPitch: 2 }, 'io'],
    ],
  },
  shake: {
    settle: true,
    keys: [
      [0, {}],
      [0.18, { headYaw: -30, twist: 4, headPitch: 4 }, 'io'],
      [0.38, { headYaw: 28, twist: -4, headPitch: 4 }, 'io'],
      [0.58, { headYaw: -24, twist: 3, headPitch: 3 }, 'io'],
      [0.78, { headYaw: 16, headPitch: 2 }, 'io'],
      [1.0, { headYaw: 0 }, 'io'],
    ],
  },
  shrug: {
    keys: [
      [0, {}],
      [0.14, { pelvis: [0, 0.014], armF: [8, 6, 24], armB: [8, 4, 24], headPitch: 4 }, 'out'],
      [0.34, { shrug: 1, armF: [32, 22, 100], armB: [30, 20, 96], gripF: 'open', gripB: 'open', headRoll: 13, headPitch: -3, spine: -4, pelvis: [0, -0.006], fx: 'lines' }, 'back'],
      [0.7, { shrug: 0.85, armF: [30, 20, 96], armB: [28, 18, 92], gripF: 'open', gripB: 'open', headRoll: 12, spine: -3 }, 'io'],
      [1.1, { shrug: 0.45, armF: [20, 14, 70], armB: [18, 12, 66], gripF: 'open', gripB: 'open', headRoll: 7 }, 'io'],
    ],
  },
  point: {
    opensAt: 0.58,
    keys: [
      [0, {}],
      [0.18, { handB: [0.1, 0.1, 0.14], gripB: 'fist', aimB: [0.6, -0.4, 0.6], spine: -3, weight: 0.3 }, 'out'],
      [0.34, { armF: [4, 4, 6], handB: [0.08, -0.15, 0.27], gripB: 'point', aimB: [0.8, -0.6, -0.35], spine: 4, weight: -0.5, twist: 8, yaw: 14, headYaw: 6, fx: 'lines' }, 'back'],
      [0.58, { armF: [4, 4, 6], handB: [0.08, -0.15, 0.27], gripB: 'point', aimB: [0.8, -0.6, -0.35], spine: 3, weight: -0.45, twist: 7, yaw: 12, headYaw: 5 }, 'io'],
    ],
  },

  // The arms go up bent and a little forward (a cheer, not a T-pose), so
  // in a bust they stay near the body on the way up.
  jump: {
    posture: 0.3,
    keys: [
      [0, {}],
      [0.16, { pelvis: [0, 0.075], spine: 20, armF: [12, -44, 30], armB: [12, -44, 30], squash: 0.9, headPitch: 8 }, 'out'],
      [0.26, { lift: 0.12, squash: 1.08, armF: [150, 32, 46], armB: [146, 32, 48], spine: -6, footF: [0, 0.04, 0], footB: [0, 0.06, 0], headPitch: -10, toe: 1 }, 'out'],
      [0.4, { lift: 0.2, armF: [156, 26, 40], armB: [152, 26, 42], footF: [0.01, 0.07, 0], footB: [-0.01, 0.08, 0], headPitch: -6 }, 'out'],
      [0.54, { lift: 0.07, armF: [110, 34, 62], armB: [106, 34, 62], footF: [0, 0.02, 0] }, 'in'],
      [0.62, { pelvis: [0, 0.065], squash: 0.9, spine: 15, armF: [36, 22, 52], armB: [36, 20, 52], headPitch: 6 }, 'in'],
      [0.84, { pelvis: [0, 0.01], spine: 3 }, 'out'],
      [1.0, {}, 'io'],
    ],
  },
  think: {
    settle: true,
    keys: [
      [0, {}],
      [0.22, { handF: [0.06, 0.12, 0.12], gripF: 'cup', handB: [-0.08, 0.26, 0.12], headYaw: 8 }, 'io'],
      [0.42, { handF: [0.03, 0.11, 0.08, 'head'], gripF: 'cup', handB: [-0.08, 0.26, 0.12], headRoll: -8, headPitch: -7, headYaw: 14, gaze: 1, weight: -0.4, spine: -2, fx: 'dots' }, 'io'],
      [1.4, { handF: [0.03, 0.11, 0.08, 'head'], gripF: 'cup', handB: [-0.08, 0.26, 0.12], headRoll: -10, headPitch: -9, headYaw: 16, gaze: 1, weight: -0.45, spine: -3, fx: 'dots' }, 'io'],
    ],
  },
  facepalm: {
    keys: [
      [0, {}],
      [0.15, { handF: [0.08, 0.2, 0.15], gripF: 'open', headPitch: -4 }, 'out'],
      [0.3, { handF: [0.02, 0.0, 0.1, 'head'], gripF: 'open', headPitch: 18, spine: 10, slump: 0.4, eyes: 'closed', weight: -0.2 }, 'in'],
      [0.4, { handF: [0.02, 0.0, 0.1, 'head'], gripF: 'open', headPitch: 23, spine: 12, slump: 0.5, eyes: 'closed', weight: -0.2 }, 'out'],
      [0.75, { handF: [0.02, 0.0, 0.1, 'head'], gripF: 'open', headPitch: 20, headYaw: -7, spine: 11, slump: 0.45, eyes: 'closed', weight: -0.2 }, 'io'],
      [1.05, { handF: [0.02, 0.0, 0.1, 'head'], gripF: 'open', headPitch: 20, headYaw: 7, spine: 11, slump: 0.45, eyes: 'closed', weight: -0.2 }, 'io'],
      [1.35, { handF: [0.02, 0.0, 0.1, 'head'], gripF: 'open', headPitch: 21, spine: 11, slump: 0.5, eyes: 'closed', weight: -0.2 }, 'io'],
    ],
  },
  cheer: {
    posture: 0.3,
    loop: { from: 2, end: 0.66 },
    keys: [
      [0, {}],
      [0.12, { pelvis: [0, 0.045], armF: [30, -10, 100], armB: [30, -10, 100], gripF: 'fist', gripB: 'fist', spine: 9, headPitch: 6 }, 'out'],
      [0.26, { lift: 0.04, armF: [168, 0, 6], armB: [162, 4, 10], gripF: 'fist', gripB: 'fist', spine: -8, headPitch: -12, mouth: 'grin', eyes: 'happy', toe: 1 }, 'back'],
      [0.46, { pelvis: [0, 0.02], armF: [155, 0, 12], armB: [166, 4, 8], gripF: 'fist', gripB: 'fist', spine: -4, headPitch: -6, mouth: 'wide', eyes: 'happy' }, 'io'],
    ],
  },
  cry: {
    posture: 0.6,
    loop: { from: 2, end: 1.0 },
    keys: [
      [0, {}],
      [0.22, { handF: [0.15, 0.15, 0.2], handB: [-0.02, 0.15, 0.2], gripF: 'open', gripB: 'open', slump: 0.5, headPitch: 12 }, 'io'],
      [0.4, { handF: [-0.03, 0.01, 0.1, 'head'], handB: [0.06, 0.01, 0.09, 'head'], gripF: 'open', gripB: 'open', slump: 0.8, headPitch: 12, spine: 12, shrug: 0.35, eyes: 'closed', mouth: 'wide', fx: 'tears' }, 'io'],
      [0.7, { handF: [-0.03, 0.02, 0.1, 'head'], handB: [0.06, 0.02, 0.09, 'head'], gripF: 'open', gripB: 'open', slump: 0.85, headPitch: 16, spine: 14, shrug: 0.65, pelvis: [0, 0.014], eyes: 'closed', mouth: 'frown', fx: 'tears' }, 'out'],
    ],
  },
  laugh: {
    posture: 0.4,
    loop: { from: 2, end: 0.52 },
    keys: [
      [0, {}],
      [0.12, { spine: 7, headPitch: 6, shrug: 0.2 }, 'out'],
      [0.22, { spine: -14, headPitch: -16, headRoll: -6, handF: [0.06, 0.22, 0.12], handB: [-0.06, 0.23, 0.1], gripF: 'open', gripB: 'open', shrug: 0.3, mouth: 'grin', eyes: 'happy' }, 'back'],
      [0.37, { spine: -6, headPitch: -6, headRoll: -3, handF: [0.06, 0.23, 0.12], handB: [-0.06, 0.24, 0.1], gripF: 'open', gripB: 'open', shrug: 0.08, pelvis: [0, 0.012], mouth: 'wide', eyes: 'happy' }, 'io'],
    ],
  },
  // New full-body moves.
  sigh: {
    keys: [
      [0, {}],
      [0.4, { shrug: 0.5, slump: -0.3, spine: -4, headPitch: -8 }, 'io'],
      [0.6, { shrug: 0.5, slump: -0.3, spine: -4, headPitch: -8 }, 'io'],
      [1.3, { shrug: 0, slump: 0.7, spine: 12, headPitch: 9, pelvis: [0, 0.01], armF: [2, 6, 6], armB: [2, 4, 6], eyes: 'closed' }, 'out'],
      [1.8, { slump: 0.6, spine: 10, headPitch: 8, pelvis: [0, 0.008], armF: [2, 6, 6], armB: [2, 4, 6] }, 'io'],
    ],
  },
  stomp: {
    posture: 0.8,
    keys: [
      [0, {}],
      [0.2, { footF: [0.02, 0.1, 0], weight: -0.7, spine: -4, armF: [20, -10, 70], armB: [20, -10, 70], gripF: 'fist', gripB: 'fist', headPitch: -4 }, 'out'],
      [0.3, { footF: [0.04, 0, 0], weight: 0.7, spine: 14, pelvis: [0, 0.03], squash: 0.95, armF: [14, -16, 85], armB: [14, -16, 85], gripF: 'fist', gripB: 'fist', headPitch: 12, fx: 'lines' }, 'in'],
      [0.6, { footF: [0.04, 0, 0], weight: 0.6, spine: 11, pelvis: [0, 0.012], armF: [14, -12, 80], armB: [14, -12, 80], gripF: 'fist', gripB: 'fist', headPitch: 10 }, 'out'],
    ],
  },
  gasp: {
    posture: 0.7,
    keys: [
      [0, {}],
      [0.12, { pelvis: [0, 0.015], headPitch: 5, spine: 4 }, 'out'],
      [0.26, { weight: -0.9, footF: [-0.04, 0, 0], toe: 0.7, spine: -14, slump: -0.8, shrug: 0.8, headPitch: -12, handF: [0.1, 0.08, 0.15], handB: [-0.04, 0.1, 0.15], gripF: 'open', gripB: 'open', eyes: 'wide', mouth: 'o' }, 'back'],
      [0.7, { weight: -0.7, footF: [-0.02, 0, 0], spine: -9, slump: -0.6, shrug: 0.6, headPitch: -8, handF: [0.1, 0.1, 0.15], handB: [-0.04, 0.12, 0.15], gripF: 'open', gripB: 'open', eyes: 'wide', mouth: 'o' }, 'io'],
    ],
  },
  fidget: {
    loop: { from: 0, end: 2.4 },
    keys: [
      [0, { handF: [0.06, 0.19, 0.1], handB: [-0.07, 0.19, 0.1], weight: 0.4, headYaw: -10, headPitch: 8, shrug: 0.3 }, 'io'],
      [0.6, { handF: [0.03, 0.17, 0.12], handB: [-0.04, 0.2, 0.1], weight: -0.4, headYaw: 6, headPitch: 6, shrug: 0.4, gaze: -1 }, 'io'],
      [1.2, { handF: [0.07, 0.2, 0.1], handB: [-0.08, 0.18, 0.1], weight: 0.3, headYaw: 12, headPitch: 10, shrug: 0.25, footF: [0.01, 0.02, 0], toe: 0.5 }, 'io'],
      [1.8, { handF: [0.04, 0.18, 0.12], handB: [-0.05, 0.19, 0.1], weight: -0.3, headYaw: -4, headPitch: 9, shrug: 0.35, gaze: 1 }, 'io'],
    ],
  },
  crossarms: {
    settle: true,
    keys: [
      [0, {}],
      [0.3, { handF: [0.18, 0.12, 0.07], handB: [-0.08, 0.12, 0.17], gripF: 'fist', gripB: 'fist', spine: -4, slump: -0.3, weight: -0.3, headPitch: -4 }, 'io'],
      [0.45, { handF: [0.19, 0.12, 0.07], handB: [-0.08, 0.13, 0.18], gripF: 'fist', gripB: 'fist', spine: -5, slump: -0.35, weight: -0.35, headPitch: -6, headRoll: -4 }, 'out'],
    ],
  },
  hips: {
    settle: true,
    keys: [
      [0, {}],
      [0.22, { armF: [30, -45, 128], armB: [30, -45, 128], gripF: 'hip', gripB: 'hip', slump: -0.5, spine: -5, headPitch: -6, weight: 0.4 }, 'back'],
      [0.5, { armF: [30, -45, 128], armB: [30, -45, 128], gripF: 'hip', gripB: 'hip', slump: -0.55, spine: -4, headPitch: -7, weight: 0.45 }, 'io'],
    ],
  },
  bow: {
    keys: [
      [0, {}],
      [0.2, { spine: -3, headPitch: -4 }, 'out'],
      [0.55, { spine: 42, headPitch: 16, pelvis: [-0.02, 0.01], armF: [4, 10, 8], armB: [4, 8, 8], eyes: 'closed' }, 'io'],
      [0.95, { spine: 42, headPitch: 18, pelvis: [-0.02, 0.01], armF: [4, 10, 8], armB: [4, 8, 8], eyes: 'closed' }, 'io'],
      [1.35, { spine: 0, headPitch: 0 }, 'io'],
    ],
  },
  slump: {
    keys: [
      [0, {}],
      [0.2, { shrug: 0.3, headPitch: -4 }, 'out'],
      [0.6, { slump: 1, spine: 12, headPitch: 6, pelvis: [0, 0.03], stance: 0.09, armF: [0, 8, 4], armB: [0, 6, 4], weight: -0.2, eyes: 'lidded' }, 'in'],
      [0.8, { slump: 1, spine: 10, headPitch: 5, pelvis: [0, 0.025], stance: 0.09, armF: [0, 8, 4], armB: [0, 6, 4], weight: -0.2, eyes: 'lidded' }, 'out'],
    ],
  },
  lookaround: {
    settle: true,
    loop: { from: 1, end: 2.6 },
    keys: [
      [0, {}],
      [0.3, { headYaw: -40, twist: -10, gaze: -1, weight: -0.3 }, 'io'],
      [1.0, { headYaw: -36, twist: -8, gaze: -1, weight: -0.3 }, 'io'],
      [1.3, { headYaw: 30, twist: 8, gaze: 1, weight: 0.3, headPitch: -4 }, 'io'],
      [2.0, { headYaw: 26, twist: 6, gaze: 1, weight: 0.3, headPitch: -3 }, 'io'],
    ],
  },
  // Hand poses from XIAO's reference f2, acted to the camera. f2 is held
  // stills: each move reaches its pose by 0.3 s and holds it (breath, blinks
  // and the mouth go on); a shot that opens on one starts in the pose
  // (opensAt). Hand targets marked 'face' are in head radii in the head's
  // own frame (x toward facing, y down, z toward the camera), so a hand on a
  // cheek stays on it when the head tilts; aimF/aimB point the fingers (the
  // wrist bends). One anchor per move, so the hand travels, never jumps.
  // Flat palm on her cheek, the wrist waving a little (about 10 degrees).
  cheek: {
    opensAt: 0.82,
    cycle: (p, t, k) => nudge(p, 'aimF', 0, 0.18 * k * Math.sin((t / 0.84) * TAU)),
    keys: [
      [0, {}],
      [0.3, { handF: [-1.35, 2.4, 0.5, 'face'], gripF: 'edge', aimF: [0.1, -1, 0.2], elbowF: [0.05, 1, 0.1], upperF: 1.2, foreF: 1.2, shrug: 0.15 }, 'out'],
      [0.56, { handF: [-1.35, 1.75, 0.5, 'face'], gripF: 'edge', aimF: [0.12, -1, 0.05], elbowF: [0.05, 1, 0.1], upperF: 1.35, foreF: 1.35, headRoll: -9, weight: -0.2 }, 'out'],
      [0.82, { handF: [-1.35, 1.75, 0.5, 'face'], gripF: 'edge', aimF: [0.12, -1, 0.05], elbowF: [0.05, 1, 0.1], upperF: 1.35, foreF: 1.35, headRoll: -9, weight: -0.2 }, 'io'],
    ],
  },
  // A claw grip on her opposite shoulder (nervous).
  clasp: {
    opensAt: 0.82,
    keys: [
      [0, {}],
      [0.3, { handF: [0.14, 0.1, 0.12], gripF: 'drape', foreF: 1.25, shrug: 0.2 }, 'out'],
      [0.56, { handF: [0.22, 0.05, 0.12], gripF: 'drape', aimF: [0.75, -0.55, -0.35], elbowF: [0, 1, 0.1], foreF: 1.5, armB: [2, 2, 4], shrug: 0.45, shrugF: 0.8, slump: -0.2, headRoll: -6 }, 'out'],
      [0.82, { handF: [0.22, 0.05, 0.12], gripF: 'drape', aimF: [0.75, -0.55, -0.35], elbowF: [0, 1, 0.1], foreF: 1.5, armB: [2, 2, 4], shrug: 0.45, shrugF: 0.8, slump: -0.2, headRoll: -6 }, 'io'],
    ],
  },
  // Index finger on her chin (thinking, sly).
  chin: {
    opensAt: 0.82,
    keys: [
      [0, {}],
      [0.3, { handF: [-0.75, 2.4, 0.6, 'face'], gripF: 'chin', aimF: [0.4, -1, 0.3] }, 'out'],
      [0.56, { handF: [-0.75, 1.95, 0.9, 'face'], gripF: 'chin', aimF: [0.3, -1, 0.2], elbowF: [0.2, 1, 0.2], headRoll: -10, headPitch: -4, weight: -0.3 }, 'out'],
      [0.82, { handF: [-0.75, 1.95, 0.9, 'face'], gripF: 'chin', aimF: [0.3, -1, 0.2], elbowF: [0.2, 1, 0.2], headRoll: -10, headPitch: -4, weight: -0.3 }, 'io'],
    ],
  },
  // Both hands round a phone held at the chest, looking over it.
  phone: {
    opensAt: 0.82,
    keys: [
      [0, {}],
      [0.3, { handF: [0.13, 0.08, 0.2], handB: [-0.13, 0.08, 0.2], gripF: 'hold', gripB: 'hold', aimF: [0.3, -1, 0.3], aimB: [-0.3, -1, 0.3], elbowF: [0.15, 1, -0.4], elbowB: [0.15, 1, -0.4], headPitch: 4 }, 'out'],
      [0.56, { handF: [0.14, 0.045, 0.2], handB: [-0.14, 0.045, 0.2], gripF: 'hold', gripB: 'hold', aimF: [0.8, -0.6, 0.2], aimB: [-0.8, -0.6, 0.2], elbowF: [0.15, 1, -0.4], elbowB: [0.15, 1, -0.4], foreF: 1.15, foreB: 1.15, headPitch: 8, spine: 4, shrug: 0.25 }, 'out'],
      [0.82, { handF: [0.14, 0.045, 0.2], handB: [-0.14, 0.045, 0.2], gripF: 'hold', gripB: 'hold', aimF: [0.8, -0.6, 0.2], aimB: [-0.8, -0.6, 0.2], elbowF: [0.15, 1, -0.4], elbowB: [0.15, 1, -0.4], foreF: 1.15, foreB: 1.15, headPitch: 8, spine: 4, shrug: 0.25 }, 'io'],
    ],
  },
  // One fist thrown up high (pumped). The elbow folds first, the fist rises
  // past the shoulder, then the arm straightens up; it lands at 0.75 s.
  fistup: {
    opensAt: 1.0,
    // A fist pump every 1.4 s: the elbow gives (the fist drops about 4% of
    // the frame), then punches back up past the pose.
    cycle: (p, t, k) => {
      const d = pump(((t + 0.7) / 1.4) % 1) * k;
      nudge(p, 'armF', 0, -6 * d);
      nudge(p, 'armF', 2, Math.max(0, 32 * d));
      p.shrugF = Math.max(0, (p.shrugF || 0) - 0.4 * d);
      p.headPitch = (p.headPitch || 0) + 2 * d;
    },
    keys: [
      [0, {}],
      [0.22, { armF: [18, 28, 128], gripF: 'fist', spine: 2, headPitch: 3, shrug: 0.15 }, 'io'],
      [0.46, { armF: [96, 22, 118], gripF: 'fist', handB: [-0.1, 0.11, 0.16], gripB: 'fist', aimB: [0.3, -0.9, 0.3], elbowB: [-0.2, 1, 0], spine: -2, headPitch: -2 }, 'io'],
      [0.75, { armF: [174, -4, 2], gripF: 'fist', handB: [-0.11, 0.09, 0.17], gripB: 'fist', aimB: [0.3, -0.9, 0.3], elbowB: [-0.2, 1, 0], shrugF: 0.6, spine: -6, spineSide: -5, headPitch: -8, headRoll: -6, weight: 0.3 }, 'out'],
      [1.0, { armF: [174, -4, 2], gripF: 'fist', handB: [-0.11, 0.09, 0.17], gripB: 'fist', aimB: [0.3, -0.9, 0.3], elbowB: [-0.2, 1, 0], shrugF: 0.6, spine: -6, spineSide: -5, headPitch: -8, headRoll: -6, weight: 0.3 }, 'io'],
    ],
  },

  // Palms pressed together over her nose and mouth.
  cover: {
    opensAt: 0.82,
    keys: [
      [0, {}],
      [0.3, { handF: [-0.85, 2.5, 0.7, 'face'], handB: [0.85, 2.5, 0.7, 'face'], gripF: 'cup2', gripB: 'cup2', aimF: [0.3, -1, 0.2], aimB: [-0.3, -1, 0.2], elbowF: [0.3, 1, 0.1], elbowB: [0.3, 1, 0.1], upperF: 1.2, upperB: 1.2, foreF: 1.2, foreB: 1.2, shrug: 0.3 }, 'out'],
      [0.56, { handF: [-0.62, 1.6, 1.0, 'face'], handB: [0.62, 1.6, 1.0, 'face'], gripF: 'cup2', gripB: 'cup2', aimF: [0.4, -1, 0.1], aimB: [-0.4, -1, 0.1], elbowF: [0.3, 1, 0.1], elbowB: [0.3, 1, 0.1], upperF: 1.35, upperB: 1.35, foreF: 1.35, foreB: 1.35, headPitch: 6, shrug: 0.6, spine: 5 }, 'out'],
      [0.82, { handF: [-0.62, 1.6, 1.0, 'face'], handB: [0.62, 1.6, 1.0, 'face'], gripF: 'cup2', gripB: 'cup2', aimF: [0.4, -1, 0.1], aimB: [-0.4, -1, 0.1], elbowF: [0.3, 1, 0.1], elbowB: [0.3, 1, 0.1], upperF: 1.35, upperB: 1.35, foreF: 1.35, foreB: 1.35, headPitch: 6, shrug: 0.6, spine: 5 }, 'io'],
    ],
  },
  // Index finger up beside her face, thumb out (an idea).
  oneup: {
    opensAt: 0.82,
    // The finger bobs with the words.
    cycle: (p, t, k) => {
      const b = Math.sin((t / 0.66) * TAU) * k;
      nudge(p, 'handF', 1, 0.07 * b);
      nudge(p, 'aimF', 0, -0.06 * b);
    },
    keys: [
      [0, {}],
      [0.3, { handF: [-1.5, 2.2, 0.5, 'face'], gripF: 'fist', aimF: [0, -1, 0.2], headPitch: 3 }, 'out'],
      [0.56, { handF: [-1.65, 1.75, 0.7, 'face'], gripF: 'one', aimF: [0.1, -1, 0.1], headPitch: -3, headRoll: -5, spine: -2 }, 'out'],
      [0.82, { handF: [-1.65, 1.75, 0.7, 'face'], gripF: 'one', aimF: [0.1, -1, 0.1], headPitch: -3, headRoll: -5, spine: -2 }, 'io'],
    ],
  },
  // A peace sign at her chin.
  peace: {
    opensAt: 0.82,
    keys: [
      [0, {}],
      [0.3, { handF: [-0.7, 2.2, 0.6, 'face'], gripF: 'fist', aimF: [0, -1, 0.2] }, 'out'],
      [0.56, { handF: [-0.75, 1.95, 0.85, 'face'], gripF: 'peace', aimF: [-0.15, -1, 0.2], headRoll: -10, weight: -0.3 }, 'out'],
      [0.82, { handF: [-0.75, 1.95, 0.85, 'face'], gripF: 'peace', aimF: [-0.15, -1, 0.2], headRoll: -10, weight: -0.3 }, 'io'],
    ],
  },
  // Palms pressed together, seen edge-on, raised to her side under the jaw
  // (grateful, f2 still 43).
  palms: {
    opensAt: 0.82,
    keys: [
      [0, {}],
      [0.3, { handF: [0.38, 2.55, 0.9, 'face'], handB: [0.6, 2.5, 0.8, 'face'], gripF: 'edge', gripB: 'edge', aimF: [0.3, -1, 0.1], aimB: [0.3, -1, 0.1], elbowF: [-0.2, 1, 0.3], elbowB: [0.3, 1, 0.1], upperF: 1.2, upperB: 1.2, foreF: 1.2, foreB: 1.2, shrug: 0.15 }, 'out'],
      [0.56, { handF: [0.35, 1.85, 1.0, 'face'], handB: [0.55, 1.8, 0.85, 'face'], gripF: 'edge', gripB: 'edge', aimF: [0.28, -1, 0], aimB: [0.22, -1, 0], elbowF: [-0.2, 1, 0.3], elbowB: [0.3, 1, 0.1], upperF: 1.3, upperB: 1.3, foreF: 1.3, foreB: 1.3, headRoll: -10, headPitch: 4, shrug: 0.3 }, 'out'],
      [0.82, { handF: [0.35, 1.85, 1.0, 'face'], handB: [0.55, 1.8, 0.85, 'face'], gripF: 'edge', gripB: 'edge', aimF: [0.28, -1, 0], aimB: [0.22, -1, 0], elbowF: [-0.2, 1, 0.3], elbowB: [0.3, 1, 0.1], upperF: 1.3, upperB: 1.3, foreF: 1.3, foreB: 1.3, headRoll: -10, headPitch: 4, shrug: 0.3 }, 'io'],
    ],
  },
  // Two loosely curled hands tucked under her chin (cute goodbye).
  cheeks: {
    opensAt: 0.82,
    keys: [
      [0, {}],
      [0.3, { handF: [-0.6, 2.7, 0.6, 'face'], handB: [0.6, 2.7, 0.6, 'face'], gripF: 'curl', gripB: 'curl', aimF: [0.15, -1, 0.3], aimB: [-0.15, -1, 0.3], elbowF: [0.2, 1, 0.1], elbowB: [0.2, 1, 0.1], upperF: 1.15, upperB: 1.15, foreF: 1.15, foreB: 1.15, shrug: 0.2 }, 'out'],
      [0.56, { handF: [-0.62, 2.0, 0.85, 'face'], handB: [0.62, 2.0, 0.85, 'face'], gripF: 'curl', gripB: 'curl', aimF: [0.12, -1, 0.15], aimB: [-0.12, -1, 0.15], elbowF: [0.2, 1, 0.1], elbowB: [0.2, 1, 0.1], upperF: 1.3, upperB: 1.3, foreF: 1.3, foreB: 1.3, shrug: 0.5, headRoll: -9, slump: -0.2 }, 'out'],
      [0.82, { handF: [-0.62, 2.0, 0.85, 'face'], handB: [0.62, 2.0, 0.85, 'face'], gripF: 'curl', gripB: 'curl', aimF: [0.12, -1, 0.15], aimB: [-0.12, -1, 0.15], elbowF: [0.2, 1, 0.1], elbowB: [0.2, 1, 0.1], upperF: 1.3, upperB: 1.3, foreF: 1.3, foreB: 1.3, shrug: 0.5, headRoll: -9, slump: -0.2 }, 'io'],
    ],
  },
};

// The key drawings of each move with the neutral posture (cast sheet, tests).
for (const [name, m] of Object.entries(MOVE_SET)) {
  Object.defineProperty(m, 'drawings', { enumerable: false, get: () => m.keys.map(([t]) => toLegacy(act(MOVE_SET, { move: name, face: 'neutral' }, t, { time: 0 }))) });
}

const TALK_EVERY = 0.16; // seconds per mouth shape while talking
const BLINK_EVERY = 3.3;

// The pose for one actor at time `phase` into a beat. prev: the beat before
// (its end pose starts this one); time: scene time, for breathing and
// settles. Mouth and blink run on their own clocks so a long line keeps
// flapping while the body holds.
export function poseFor(beat, phase, { faceTalk, seed = 0, talking = false, prev = null, time, walking = false, faceCam = false }) {
  const m = MOVE_SET[beat.move] || MOVE_SET.idle;
  const from = prev ? endPose(MOVE_SET, prev, beat.t - prev.t) : null;
  // A shot that opens on a held pose starts in it (the cut hides the reach).
  if (!prev && m.opensAt) phase += m.opensAt;
  const pose = toLegacy(act(MOVE_SET, beat, phase, { time: time ?? phase, prev: from, seed, talking, walking, faceCam }));
  pose.face = beat.face;
  if ((m.talking || talking) && !pose.mouth && faceTalk?.length) {
    const k = Math.floor(phase / TALK_EVERY);
    // Not a plain cycle: a little irregular, as real speech is.
    pose.mouth = faceTalk[(k + ((k * 7 + seed) % 3)) % faceTalk.length];
  }
  // Blink for one held drawing every few seconds (each actor at its own time).
  const off = (seed % 1000) / 1000;
  const cyc = (phase / BLINK_EVERY + off) % 1;
  if (!pose.eyes && cyc > 0.955) pose.blink = true;
  return pose;
}

export { POSTURE };
export const WALK_SPEED = 0.17; // share of stage width per second
