// The studio's movements: a few drawings each, held for a while, the way
// limited TV animation reuses poses. A move is a list of key drawings with
// how long each one shows; "loop" moves repeat, the rest hold their last
// drawing (an anticipation drawing, the action, then the held pose).
//
// Pose fields (all optional, see rig.js): lean deg, bob (crouch, share of
// height), lift (feet off the ground), tilt deg, nod (head drop, share of
// head size), look (-1..1 face turn), F/B [shoulder deg, elbow deg] for the
// front/back arm, reachF/reachB [x, y] hand target in head radii from the
// head centre, overF/overB (arm drawn over the face), footF/footB [dx, up],
// eyes, mouth, fx, gaze, blink.

const IDLE_ARMS = { F: [8, 10], B: [7, 12] };

export const MOVE_SET = {
  idle: { loop: true, each: 0.9, drawings: [{ ...IDLE_ARMS }, { F: [9, 14], B: [8, 15], bob: 0.006 }] },
  talk: { loop: true, each: 0.55, drawings: [{ F: [26, 52], B: [9, 12] }, { F: [36, 70], B: [10, 14], lean: 2 }, { F: [22, 40], B: [12, 18] }], talking: true },
  walk: {
    loop: true,
    each: 0.16,
    drawings: [
      { footF: [0.09, 0], footB: [-0.09, 0], F: [-18, 10], B: [-18, 14], bob: 0.012 },
      { footF: [0.0, 0.0], footB: [0.02, 0.05], F: [0, 8], B: [2, 10], lift: 0.015 },
      { footF: [-0.09, 0], footB: [0.09, 0], F: [20, 14], B: [-16, 10], bob: 0.012 },
      { footF: [0.02, 0.05], footB: [0.0, 0.0], F: [2, 10], B: [0, 8], lift: 0.015 },
    ],
  },
  wave: { loop: true, each: 0.2, drawings: [{ F: [140, 35], B: [8, 12], look: 0.6 }, { F: [148, -18], B: [8, 12], look: 0.6 }] },
  nod: { loop: false, each: 0.22, drawings: [{ nod: 0.0, ...IDLE_ARMS }, { nod: 0.12, tilt: 4, ...IDLE_ARMS }, { nod: 0.0, ...IDLE_ARMS }, { nod: 0.12, tilt: 4, ...IDLE_ARMS }, { nod: 0.02, ...IDLE_ARMS }] },
  shake: { loop: false, each: 0.18, drawings: [{ look: -0.7, ...IDLE_ARMS }, { look: 0.9, ...IDLE_ARMS }, { look: -0.7, ...IDLE_ARMS }, { look: 0.9, ...IDLE_ARMS }, { look: 0.2, ...IDLE_ARMS }] },
  shrug: { loop: false, each: 0.16, drawings: [{ F: [14, 30], B: [14, 30], bob: 0.01 }, { F: [42, 68], B: [42, 68], bob: -0.012, tilt: 8, look: 0.2, fx: 'lines' }, { F: [40, 64], B: [40, 64], tilt: 9, look: 0.2 }] },
  point: { loop: false, each: 0.14, drawings: [{ F: [30, 40], B: [10, 12], lean: -3 }, { F: [92, -4], B: [12, 18], lean: 6, fx: 'lines' }, { F: [86, 0], B: [10, 16], lean: 4 }] },
  jump: {
    loop: false,
    each: 0.12,
    drawings: [
      { bob: 0.06, F: [-30, 20], B: [-30, 20], lean: 6 },
      { lift: 0.14, F: [150, 10], B: [150, 10], footF: [0, 0.03], footB: [0, 0.05] },
      { lift: 0.2, F: [160, 0], B: [155, 0], footF: [0.01, 0.06], footB: [-0.01, 0.06] },
      { lift: 0.08, F: [120, 10], B: [120, 10] },
      { bob: 0.04, F: [40, 20], B: [40, 20] },
      { ...IDLE_ARMS },
    ],
  },
  think: { loop: false, each: 0.25, drawings: [{ ...IDLE_ARMS, look: 0.6 }, { reachF: [0.25, 1.15], overF: true, B: [10, 80], tilt: -6, gaze: 1, eyeY: -0.05, fx: 'dots' }] },
  facepalm: { loop: false, each: 0.15, drawings: [{ F: [40, 60], B: [8, 12] }, { reachF: [0.1, 0.05], overF: true, B: [8, 12], nod: 0.12, tilt: 6, eyes: 'closed', lean: 4 }] },
  cheer: { loop: true, each: 0.2, drawings: [{ F: [160, 10], B: [155, -10], lift: 0.03, mouth: 'grin', eyes: 'happy' }, { F: [150, -15], B: [160, 10], bob: 0.02, mouth: 'wide', eyes: 'happy' }] },
  cry: {
    loop: true,
    each: 0.18,
    drawings: [
      { reachF: [0.55, 1.0], reachB: [-0.55, 1.0], overF: true, overB: true, mouth: 'wide', fx: 'tears', nod: 0.05, eyes: 'closed' },
      { reachF: [0.6, 1.05], reachB: [-0.5, 1.05], overF: true, overB: true, mouth: 'frown', fx: 'tears', nod: 0.08, bob: 0.008, eyes: 'closed' },
    ],
  },
  laugh: { loop: true, each: 0.15, drawings: [{ lean: -7, F: [30, 70], B: [30, 70], mouth: 'grin', eyes: 'happy', tilt: -6 }, { lean: -3, F: [24, 60], B: [24, 60], mouth: 'wide', eyes: 'happy', tilt: -2, bob: 0.01 }] },
};

const TALK_EVERY = 0.16; // seconds per mouth shape while talking
const BLINK_EVERY = 3.3;

// The pose for one actor at time `phase` into a beat. Mouth and blink run on
// their own clocks so a long line keeps flapping while the body holds.
export function poseFor(beat, phase, { faceTalk, seed = 0, talking = false }) {
  const m = MOVE_SET[beat.move] || MOVE_SET.idle;
  const n = m.drawings.length;
  let i = Math.floor(phase / m.each);
  i = m.loop ? i % n : Math.min(n - 1, i);
  const pose = { ...m.drawings[i], face: beat.face };
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

export const WALK_SPEED = 0.17; // share of stage width per second
