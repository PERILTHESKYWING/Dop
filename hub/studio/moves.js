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
    keys: [
      [0, {}],
      [0.18, { handB: [-0.06, 0.13, 0.1], gripB: 'fist', spine: -4, weight: 0.35, twist: -8, yaw: -6 }, 'out'],
      [0.32, { handB: [0.42, 0.0, 0.06], gripB: 'point', spine: 7, weight: -0.6, twist: 12, yaw: 22, headYaw: 10, fx: 'lines' }, 'back'],
      [0.55, { handB: [0.39, 0.02, 0.06], gripB: 'point', spine: 5, weight: -0.5, twist: 10, yaw: 18, headYaw: 8 }, 'io'],
    ],
  },
  jump: {
    posture: 0.3,
    keys: [
      [0, {}],
      [0.16, { pelvis: [0, 0.075], spine: 20, armF: [12, -44, 30], armB: [12, -44, 30], squash: 0.9, headPitch: 8 }, 'out'],
      [0.26, { lift: 0.12, squash: 1.08, armF: [160, 20, 10], armB: [155, 20, 12], spine: -6, footF: [0, 0.04, 0], footB: [0, 0.06, 0], headPitch: -10, toe: 1 }, 'out'],
      [0.4, { lift: 0.2, armF: [165, 12, 20], armB: [160, 12, 20], footF: [0.01, 0.07, 0], footB: [-0.01, 0.08, 0], headPitch: -6 }, 'out'],
      [0.54, { lift: 0.07, armF: [120, 10, 30], armB: [115, 10, 30], footF: [0, 0.02, 0] }, 'in'],
      [0.62, { pelvis: [0, 0.065], squash: 0.9, spine: 15, armF: [40, 12, 30], armB: [40, 10, 30], headPitch: 6 }, 'in'],
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
