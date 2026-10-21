// Acting: how a character holds and moves its whole body, not just its arms.
// A move (moves.js) is a few key poses on a timeline; this file turns them
// into the pose for one drawing:
// - eased in-betweens between keys (sampled on the drawing clock, so the
//   result still moves on twos like the rest of the studio);
// - an emotion posture under every move (sad slumps and drops the head,
//   angry leans in with fists, smug leans back with a hand on the hip...),
//   which also sets the tempo and the size of talking gestures;
// - a short blend from the previous beat's end pose, so beats flow;
// - overlap (the head and forearms arrive a little after the body),
//   breathing, slow weight settles while standing and hair follow-through.
//
// Pose v2 fields are listed in the #363 spec (docs/handoff/studio.md):
// yaw, headYaw/Pitch/Roll, spine, spineSide, twist, slump, shrug, weight,
// pelvis, squash, lift, armF/armB [raise, forward, elbow] or handF/handB
// [x, y, z(, 'head')], gripF/gripB, footF/footB, stance, toe, breath,
// hairSwing (+ toward facing), plus the face fields. F is the near arm/foot
// (screen side away from facing), B the far one; weight +1 = on the F foot. handFw/handBw (0..1) say how far an arm
// has gone from its armF angles to its handF target while the two blend.
// toLegacy() adds the old single-plane fields so older rigs still act.

export const EASE = {
  lin: (u) => u,
  in: (u) => u * u,
  out: (u) => 1 - (1 - u) * (1 - u),
  io: (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)),
  // Goes past the target and settles back (a hit, a snap into a pose).
  back: (u) => {
    const s = 1.7;
    const v = u - 1;
    return 1 + v * v * ((s + 1) * v + s);
  },
  // Holds the old pose, then pops to the new one (a take, a blink of a move).
  snap: (u) => (u < 0.85 ? 0 : 1),
};

// Channels added on top of the move (emotion posture, breathing, settles).
const OFFSETS = ['yaw', 'headYaw', 'headPitch', 'headRoll', 'spine', 'spineSide', 'twist', 'slump', 'shrug', 'weight'];
// Channels that trail behind the body by LAG seconds (overlapping action).
const LAG = 0.1;
const TRANSITION = 0.32; // seconds to blend from the previous beat's end pose
export const DEFAULT_YAW = 25;

// Emotion postures. Offsets add to every move (scaled by the move's
// `posture`); armF/armB/handF/handB/grip are the resting arms, used where a
// key does not place that arm. tempo speeds or slows moves, gesture scales
// talking hands, breath is [seconds per breath, depth 0..1].
export const POSTURE = {
  neutral: { spine: 2, headPitch: 2, weight: 0.35, stance: 0.12, armF: [6, 4, 12], armB: [5, -2, 14], tempo: 1, gesture: 1, breath: [3.6, 0.5] },
  happy: { slump: -0.35, spine: -2, headPitch: -6, headRoll: 4, weight: 0.3, stance: 0.13, armF: [10, 8, 24], armB: [9, 2, 22], gripF: 'open', gripB: 'open', tempo: 1.15, gesture: 1.25, breath: [3, 0.55], bounce: 0.006 },
  sad: { yaw: -8, slump: 0.75, spine: 5, headPitch: 0, headRoll: -4, weight: -0.3, stance: 0.08, armF: [2, 6, 6], armB: [2, 4, 6], tempo: 0.75, gesture: 0.5, breath: [4.6, 0.8] },
  angry: { yaw: 8, slump: -0.2, spine: 10, headPitch: 10, shrug: 0.3, weight: 0.6, stance: 0.17, armF: [16, 12, 60], armB: [16, 2, 58], gripF: 'fist', gripB: 'fist', tempo: 1.25, gesture: 1.35, breath: [1.7, 0.9] },
  surprised: { slump: -0.6, spine: -9, headPitch: -8, shrug: 0.45, weight: -0.55, stance: 0.13, armF: [26, 24, 72], armB: [24, 12, 66], gripF: 'open', gripB: 'open', tempo: 1.3, gesture: 1.2, breath: [1.4, 0.6] },
  worried: { yaw: -4, slump: 0.35, spine: 6, headPitch: 4, headRoll: 6, shrug: 0.35, weight: -0.2, stance: 0.09, handF: [0.07, 0.19, 0.1], handB: [-0.08, 0.19, 0.1], tempo: 1.1, gesture: 0.7, breath: [2.2, 0.6], fidget: 0.02 },
  smug: { slump: -0.55, spine: -7, headPitch: -10, headRoll: -7, weight: -0.5, stance: 0.15, armF: [8, 4, 12], armB: [30, -45, 128], gripB: 'hip', tempo: 0.9, gesture: 0.8, breath: [3.8, 0.5] },
  tired: { yaw: -4, slump: 0.9, spine: 8, headPitch: 2, headRoll: 8, weight: -0.2, pelvis: [0, 0.012], stance: 0.1, armF: [2, 4, 4], armB: [2, 2, 4], tempo: 0.65, gesture: 0.45, breath: [5, 0.9] },
  shock: { slump: -0.6, spine: -8, headPitch: -6, shrug: 0.5, weight: -0.5, stance: 0.12, armF: [22, 20, 70], armB: [20, 10, 64], gripF: 'open', gripB: 'open', tempo: 1.4, gesture: 0.8, breath: [1.6, 0.5] },
  cat: { yaw: 6, slump: -0.1, spine: 0, headPitch: -2, headRoll: 6, weight: 0.4, stance: 0.12, armF: [6, 4, 14], armB: [28, -40, 120], gripB: 'hip', tempo: 0.85, gesture: 0.7, breath: [4, 0.6] },
  joy: { slump: -0.45, spine: -3, headPitch: -6, headRoll: 5, weight: 0.3, stance: 0.13, armF: [14, 10, 30], armB: [12, 8, 28], tempo: 1.15, gesture: 1.2, breath: [2.8, 0.6] },
  shy: { yaw: -10, slump: 0.4, spine: 5, headPitch: 6, headRoll: 8, shrug: 0.3, weight: -0.2, stance: 0.09, armF: [20, 14, 100], armB: [8, 4, 20], tempo: 0.8, gesture: 0.5, breath: [3.2, 0.5] },
  panic: { slump: 0.1, spine: -4, headPitch: -2, headRoll: 5, shrug: 0.6, weight: -0.4, stance: 0.13, armF: [30, 24, 80], armB: [28, 16, 74], gripF: 'open', gripB: 'open', tempo: 1.5, gesture: 1.5, breath: [1.2, 0.8] },
};
const NEUTRAL_ARMS = { armF: POSTURE.neutral.armF, armB: POSTURE.neutral.armB };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Blend two poses. Numbers and number lists blend; words and flags come from
// `b` once u passes `cut` (0.5 for in-betweens, 0 when a new beat takes over).
// An arm given as angles on one side and as a hand target on the other keeps
// both, with handFw/handBw saying how far toward the target it has gone.
export function lerpPose(a, b, u, { cut = 0.5 } = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k];
    const y = b[k];
    if (x === undefined) out[k] = y;
    else if (y === undefined) out[k] = x;
    else if (isNum(x) && isNum(y)) out[k] = x + (y - x) * u;
    else if (Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v, i) => isNum(v) === isNum(y[i]))) out[k] = x.map((v, i) => (isNum(v) ? v + (y[i] - v) * u : u < cut ? v : y[i]));
    else out[k] = u < cut ? x : y;
  }
  for (const s of ['F', 'B']) {
    const hand = 'hand' + s;
    const w = 'hand' + s + 'w';
    const wa = a[hand] ? a[w] ?? (a['arm' + s] ? 0 : 1) : 0;
    const wb = b[hand] ? b[w] ?? (b['arm' + s] ? 0 : 1) : 0;
    if (wa !== wb || (out[hand] && out['arm' + s])) out[w] = wa + (wb - wa) * u;
    if (Array.isArray(a[hand]) && Array.isArray(b[hand]) && a[hand][3] !== b[hand][3]) out[hand] = u < 0.5 ? a[hand] : b[hand];
  }
  return out;
}

// Fill a key with the emotion posture: offsets add, missing arms rest.
function resolveKey(key, move, posture) {
  const pf = move.posture ?? 1;
  const out = { ...key };
  for (const k of OFFSETS) {
    const v = (key[k] || 0) + (posture[k] || 0) * pf;
    if (v) out[k] = v;
  }
  if (posture.pelvis || key.pelvis) {
    const pp = posture.pelvis || [0, 0];
    const kp = key.pelvis || [0, 0];
    out.pelvis = [kp[0] + pp[0] * pf, kp[1] + pp[1] * pf];
  }
  if (out.stance == null && posture.stance != null) out.stance = posture.stance;
  for (const s of ['F', 'B']) {
    const arm = 'arm' + s;
    const hand = 'hand' + s;
    const grip = 'grip' + s;
    if (!key[arm] && !key[hand]) {
      if (posture[hand]) out[hand] = posture[hand];
      else out[arm] = posture[arm] || NEUTRAL_ARMS[arm];
      if (!key[grip] && posture[grip]) out[grip] = posture[grip];
    } else if (key[arm] && move.gesture) {
      // Talking hands: the move's gesture around the neutral rest, scaled by
      // the feeling (big open hands when happy, small ones when sad) and
      // started from this feeling's resting arm.
      const g = posture.gesture ?? 1;
      const rest = posture[arm] || NEUTRAL_ARMS[arm];
      out[arm] = key[arm].map((v, i) => clamp(rest[i] + (v - NEUTRAL_ARMS[arm][i]) * g, i === 2 ? 0 : -90, i === 2 ? 150 : 180));
      if (!key[grip] && posture[grip]) out[grip] = posture[grip];
    }
  }
  return out;
}

const cache = new Map();
// The move's keys with the posture filled in, as [time, pose, ease] (cached).
function track(move, name, face) {
  const id = name + '|' + face;
  let tr = cache.get(id);
  if (!tr) {
    const posture = POSTURE[face] || POSTURE.neutral;
    tr = move.keys.map(([t, pose, ease]) => [t, resolveKey(pose, move, posture), ease || 'io']);
    cache.set(id, tr);
  }
  return tr;
}

// Time inside a move: plays once and holds its last key, or loops from key
// `loop.from` back to it at `loop.end` seconds.
export function moveTime(move, t) {
  const keys = move.keys;
  const last = keys[keys.length - 1][0];
  if (!move.loop) return clamp(t, 0, last);
  const from = keys[move.loop.from || 0][0];
  const end = move.loop.end;
  if (t <= end) return Math.max(0, t);
  return from + ((t - from) % (end - from));
}

// The eased in-between of a move's keys at time t (seconds into the move).
export function sampleMove(move, name, face, t) {
  const tr = track(move, name, face);
  const mt = moveTime(move, t);
  let i = 0;
  while (i < tr.length - 1 && tr[i + 1][0] <= mt) i++;
  const [t0, p0] = tr[i];
  let next = tr[i + 1];
  if (!next && move.loop) next = [move.loop.end, tr[move.loop.from || 0][1], tr[move.loop.from || 0][2]];
  if (!next || next[0] <= t0) return { ...p0 };
  const u = clamp((mt - t0) / (next[0] - t0), 0, 1);
  return lerpPose(p0, next[1], (EASE[next[2]] || EASE.io)(u));
}

// Breathing: chest rise, a little shoulder lift and head bob.
export function breathe(pose, time, posture) {
  const [period, depth] = posture.breath || [3.6, 0.5];
  const s = Math.sin((time / period) * Math.PI * 2);
  pose.breath = 0.5 + 0.5 * depth * s;
  pose.shrug = (pose.shrug || 0) + 0.05 * depth * Math.max(0, s);
  pose.headPitch = (pose.headPitch || 0) - 1.2 * depth * s;
  return pose;
}

// Standing weight settles: every few seconds the weight moves to the other
// foot (eased over 0.6 s), the head turns a touch and the hips follow.
const SETTLE = [0.45, -0.3, 0.2, -0.1];
export function settle(time, seed = 0) {
  const period = 3.6 + (seed % 7) * 0.35;
  const tt = time + (seed % 13) * 0.4;
  const k = Math.floor(tt / period);
  const into = tt - k * period;
  const u = EASE.io(clamp((into - (period - 0.6)) / 0.6, 0, 1));
  const w0 = SETTLE[(k + seed) % SETTLE.length];
  const w1 = SETTLE[(k + 1 + seed) % SETTLE.length];
  const w = w0 + (w1 - w0) * u;
  return { weight: w * 0.7, headYaw: w * 6, spineSide: -w * 3 };
}

// A move's pose at `phase` seconds into a beat, posture included, blended
// from where the previous beat left off.
function bodyAt(moves, beat, phase, prev) {
  const name = moves[beat.move] ? beat.move : 'idle';
  const move = moves[name];
  const posture = POSTURE[beat.face] || POSTURE.neutral;
  const tempo = move.tempo === false ? 1 : posture.tempo || 1;
  const cur = sampleMove(move, name, beat.face, Math.max(0, phase) * tempo);
  if (!prev || phase >= TRANSITION) return cur;
  const u = EASE.io(clamp(phase / TRANSITION, 0, 1));
  return lerpPose(prev, cur, u, { cut: 0 });
}

// The end pose of the previous beat (where this beat starts from).
export function endPose(moves, prevBeat, duration) {
  if (!prevBeat) return null;
  const name = prevBeat.move === 'walk' || !moves[prevBeat.move] ? 'idle' : prevBeat.move;
  const move = moves[name];
  const posture = POSTURE[prevBeat.face] || POSTURE.neutral;
  const tempo = move.tempo === false ? 1 : posture.tempo || 1;
  return sampleMove(move, name, prevBeat.face, Math.max(0, duration) * tempo);
}

// The full pose for one drawing. moves: the move set; beat: {move, face};
// phase: seconds into the beat; time: scene time (breathing, settles);
// prev: endPose of the previous beat or null; seed: per actor.
export function act(moves, beat, phase, { time = phase, prev = null, seed = 0, talking = false, walking = false, faceCam = false } = {}) {
  const name = moves[beat.move] ? beat.move : 'idle';
  const move = moves[name];
  const posture = POSTURE[beat.face] || POSTURE.neutral;
  const pose = bodyAt(moves, beat, phase, prev);
  // Overlap: head and forearms trail the body a little.
  const late = bodyAt(moves, beat, phase - LAG, prev);
  for (const k of ['headPitch', 'headRoll', 'headYaw']) if (late[k] != null || pose[k] != null) pose[k] = late[k] || 0;
  for (const s of ['armF', 'armB']) if (Array.isArray(pose[s]) && Array.isArray(late[s])) pose[s] = [pose[s][0], pose[s][1], late[s][2]];
  // Hair follows through after the upper body moves, and streams back on a walk.
  const d = (k, f) => ((pose[k] || 0) - (late[k] || 0)) * f;
  pose.hairSwing = clamp(d('spine', 0.05) + d('spineSide', 0.06) + d('headRoll', 0.04) + d('twist', 0.04) + d('weight', 0.8) - (walking || name === 'walk' ? 0.3 : 0), -1, 1);
  // A vlog holds its drawing (f2: 24 of 30 shots never change): no weight settles.
  if (move.settle && !faceCam) {
    const st = settle(time, seed);
    pose.weight = (pose.weight || 0) + st.weight;
    pose.headYaw = (pose.headYaw || 0) + st.headYaw;
    pose.spineSide = (pose.spineSide || 0) + st.spineSide;
    if (posture.bounce) pose.pelvis = [(pose.pelvis || [0, 0])[0], (pose.pelvis || [0, 0])[1] + posture.bounce * (Math.floor(time * 3) % 2)];
    if (posture.fidget) for (const h of ['handF', 'handB']) if (pose[h]) pose[h] = pose[h].map((v, i) => (i === 0 ? v + posture.fidget * Math.sin(time * 5 + (h === 'handF' ? 0 : 2)) : v));
  }
  // Speech accents: a small head dip on stressed syllables.
  if (talking || move.talking) {
    const k = Math.floor(time / 0.48);
    if ((k * 5 + seed) % 3 !== 0 && time - k * 0.48 < 0.2) pose.headPitch = (pose.headPitch || 0) + 3.5 * (posture.gesture ?? 1);
  }
  // A held pose keeps living: the move's small cycle (a wrist wave, a fist
  // pump, a finger bob) on the drawing clock, faded in as the pose lands.
  if (move.cycle) {
    const last = move.keys[move.keys.length - 1][0];
    const tempo = move.tempo === false ? 1 : posture.tempo || 1;
    const k = clamp((phase * tempo - (last - 0.3)) / 0.3, 0, 1);
    if (k > 0) move.cycle(pose, time + (seed % 11) * 0.13, k);
  }
  breathe(pose, time + (seed % 17) * 0.3, posture);
  if (faceCam) lookAtCamera(pose);
  else pose.yaw = DEFAULT_YAW + (pose.yaw || 0);
  // The beat's own head tilt (roll) and turn (a yaw the camera look keeps;
  // the eyes still find the lens).
  if (isNum(beat.roll)) pose.headRoll = (pose.headRoll || 0) + beat.roll;
  if (isNum(beat.turn)) {
    pose.headYaw = (pose.headYaw || 0) + clamp(beat.turn, -20, 20);
    if (faceCam) pose.gaze = [clamp(-(pose.yaw + pose.headYaw) / 30, -0.7, 0.7), pose.gaze[1]];
  }
  pose.slump = clamp(pose.slump || 0, -1, 1);
  pose.shrug = clamp(pose.shrug || 0, 0, 1);
  pose.weight = clamp(pose.weight || 0, -1, 1);
  if (pose.toe != null) pose.toe = clamp(pose.toe, 0, 1);
  for (const s of ['armF', 'armB']) if (pose[s]) pose[s] = [pose[s][0], pose[s][1], clamp(pose[s][2], 0, 150)];
  pose.v = 2;
  return pose;
}

// Talking to the camera (a vlog, style faceCam): the body stays square to the
// viewer with only a small sway left of each turn, the head turns at most a
// few degrees, and the eyes turn back against both, so she looks into the
// lens in every drawing. Rolls, pitches and arm poses keep their acting.
export const CAM_YAW = 7;
export function lookAtCamera(pose) {
  pose.yaw = clamp((pose.yaw || 0) * 0.3, -CAM_YAW, CAM_YAW);
  pose.headYaw = clamp((pose.headYaw || 0) * 0.3, -5, 5);
  pose.twist = clamp((pose.twist || 0) * 0.3, -6, 6);
  pose.gaze = [clamp(-(pose.yaw + pose.headYaw) / 30, -0.5, 0.5), clamp(-(pose.headPitch || 0) / 40, -0.4, 0.4)];
  return pose;
}

// The old single-plane fields from a v2 pose (lean, bob, tilt, nod, look,
// shift, F/B, reachF/B, overF/overB) so a rig that only knows those still
// shows the posture. A v2 rig ignores them.
// The old rig draws its F arm on the facing side: that is the v2 far arm (B).
const SHOULDER = { x: 0.113, up: 0.217 }; // shoulder: out from and down from the head centre, share of H (old rig)
const HEAD_R = 0.19; // head radius, share of H (old rig)
export function toLegacy(pose) {
  const out = { ...pose };
  const slump = pose.slump || 0;
  out.lean = (pose.spine || 0) * 0.6 + slump * 5;
  out.tilt = (pose.headRoll || 0) + (pose.spineSide || 0) * 0.5;
  out.nod = Math.max(-0.05, (pose.headPitch || 0) * 0.006 + Math.max(0, slump) * 0.04);
  if (pose.look == null) out.look = clamp(((pose.yaw ?? DEFAULT_YAW) + (pose.headYaw || 0)) / 55, -1, 1);
  out.shift = -(pose.weight || 0) * 0.035 + (pose.pelvis?.[0] || 0);
  out.bob = (pose.pelvis?.[1] || 0) + Math.max(0, slump) * 0.01;
  out.lift = pose.lift || 0;
  for (const s of ['F', 'B']) {
    const front = s === 'F'; // old rig side
    const v = front ? 'B' : 'F'; // the same arm in v2
    const hand = pose['hand' + v];
    const w = hand ? pose['hand' + v + 'w'] ?? (pose['arm' + v] ? 0 : 1) : 0;
    if (hand && w >= 0.5) {
      const onHead = hand[3] === 'head';
      const [x, y, z] = hand;
      out['reach' + s] = onHead ? [x / HEAD_R, y / HEAD_R] : [(x + (front ? 1 : -1) * SHOULDER.x) / HEAD_R, (y + SHOULDER.up) / HEAD_R];
      if (onHead && z > 0) out['over' + s] = true;
      delete out[s];
    } else {
      const [raise, fwd, elbow] = pose['arm' + v] || NEUTRAL_ARMS['arm' + v];
      const a = clamp(raise + (front ? 1 : -1) * fwd * 0.8 + (pose.shrug || 0) * 6, -60, 178);
      out[s] = [a, elbow * (front ? 1 : 0.7)];
      delete out['reach' + s];
    }
  }
  // Feet swap sides the same way.
  out.footF = pose.footB ? [pose.footB[0], pose.footB[1]] : undefined;
  out.footB = pose.footF ? [pose.footF[0], pose.footF[1]] : undefined;
  return out;
}
