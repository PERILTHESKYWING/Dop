// A character's skeleton in 3D. A pose (moves.js / acting.js) sets body turn,
// spine, shoulders, weight and limbs; this file places every joint in 3D and
// projects it to the stage, so the body turns, foreshortens and overlaps the
// way a solid figure does instead of a flat cut-out.
//
// Axes before the facing mirror: x toward where the character faces, y down,
// z toward the camera. Distances are in stage px. A body frame has its own
// forward (z), side (x) and up (-y); yaw 0 faces the camera, 90 is a profile.
import { deg } from './draw.js';

// ---------- small 3D helpers ----------
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a) => mul(a, 1 / (len(a) || 1));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// A rotation: roll (about forward), then pitch (+ tips the top forward), then yaw.
export function frame(yaw = 0, pitch = 0, roll = 0) {
  const [cy, sy, cp, sp, cr, sr] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch), Math.cos(roll), Math.sin(roll)];
  return ([x, y, z]) => {
    const x1 = x * cr - y * sr;
    const y1 = x * sr + y * cr;
    const y2 = y1 * cp + z * sp;
    const z2 = -y1 * sp + z * cp;
    return [x1 * cy + z2 * sy, y2, -x1 * sy + z2 * cy];
  };
}

// Two-bone IK in 3D: the joint between root and target, bent toward pole.
export function ik3(root, target, a, b, pole) {
  let d = sub(target, root);
  const dl = Math.max(Math.abs(a - b) + 0.01, Math.min(a + b - 0.01, len(d)));
  const dir = unit(d);
  d = mul(dir, dl);
  const x = (a * a - b * b + dl * dl) / (2 * dl);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  let n = sub(pole, mul(dir, dot(pole, dir)));
  if (len(n) < 1e-6) n = Math.abs(dir[1]) < 0.9 ? cross(dir, [0, 1, 0]) : cross(dir, [1, 0, 0]);
  n = unit(n);
  return { joint: add(add(root, mul(dir, x)), mul(n, h)), end: add(root, d) };
}

// Proportions as a share of height (cartoon: about four heads tall).
const PRO = { ankle: 0.045, hip: 0.47, pelvis: 0.5, waist: 0.595, chest: 0.685, shoulder: 0.735, neck: 0.765, neckLen: 0.035, thigh: 0.218, shin: 0.218, upper: 0.152, fore: 0.135, stance: 0.115 };
// Half-widths [side, depth] per build; limb is a thickness factor.
export const BUILD = {
  slim: { sh: 0.118, chest: [0.092, 0.064], waist: [0.074, 0.056], hip: [0.088, 0.064], limb: 0.88 },
  average: { sh: 0.13, chest: [0.106, 0.074], waist: [0.09, 0.068], hip: [0.1, 0.074], limb: 1 },
  round: { sh: 0.135, chest: [0.124, 0.096], waist: [0.134, 0.115], hip: [0.128, 0.1], limb: 1.18 },
  // The refs' girl, measured on f2's bust shots: shoulders about twice the
  // face's width and sloping, a neck about 0.4 of it, a narrow waist.
  petite: { sh: 0.205, chest: [0.15, 0.078], waist: [0.1, 0.064], hip: [0.115, 0.078], limb: 1, slope: 0.03, neck: 1.8 },
};
export const HEAD_R = 0.118; // head radius as a share of height, at headSize 1
const ARM_REST = [9, 0, 14];
const VIEW = (9 * Math.PI) / 180; // how far the camera looks down

// Old pose fields (F/B, reachF/B, lean, bob, tilt, nod, look, shift) mean
// what they used to; v2 fields win when both are set.
export function normalizePose(p = {}) {
  const q = { ...p };
  if (q.v === 2) return q;
  if (q.lean != null && q.spine == null) q.spine = q.lean * 0.9;
  if (q.bob != null) q.pelvis = [(q.pelvis?.[0] || 0) + (q.shift || 0), (q.pelvis?.[1] || 0) + q.bob];
  else if (q.shift) q.pelvis = [(q.pelvis?.[0] || 0) + q.shift, q.pelvis?.[1] || 0];
  if (q.tilt != null && q.headRoll == null) q.headRoll = -q.tilt;
  if (q.nod != null && q.headPitch == null) q.headPitch = q.nod * 160;
  if (q.look != null && q.headYaw == null) q.headYaw = (q.look - 0.45) * 55;
  for (const s of ['F', 'B']) {
    const old = q[s];
    if (Array.isArray(old) && !q['arm' + s]) q['arm' + s] = [old[0], old[0] > 100 ? 10 : 0, Math.max(0, old[1])];
    const reach = q['reach' + s];
    if (Array.isArray(reach) && !q['hand' + s]) q['hand' + s] = [reach[0] * HEAD_R, reach[1] * HEAD_R, 0.09, 'head'];
  }
  return q;
}

// Every joint for one drawing. ch: cast entry; H: height in px.
export function skeleton(ch, pose0, H) {
  const p = normalizePose(pose0);
  const b = BUILD[ch.build] || BUILD.average;
  const r = HEAD_R * H * (ch.headSize || 1);
  const yaw = deg(p.yaw ?? 25);
  const twist = deg(p.twist || 0);
  const weight = Math.max(-1, Math.min(1, p.weight || 0));
  const slump = Math.max(-1, Math.min(1, p.slump || 0));
  const squash = p.squash || 1;
  const lift = (p.lift || 0) * H;
  const stance = (p.stance ?? PRO.stance) * H;
  const body = frame(yaw);

  // Pelvis: over the weighted foot, the other hip dropped (contrapposto).
  // The near ("F") side of the body is side -1 (toward the camera when turned).
  const hipRoll = deg(weight * 7);
  const [pdx, pdy] = p.pelvis || [0, 0];
  const restDrop = Math.abs(weight) * 0.012 * H;
  const pelvis = add(body([-weight * stance * 0.42, 0, 0]), [pdx * H, -PRO.pelvis * H + pdy * H + restDrop - lift + slump * 0.012 * H, 0]);
  const fPel = frame(yaw, deg((p.spine || 0) * 0.15), hipRoll);
  const spine = (p.spine || 0) + slump * 8;
  const side = p.spineSide || 0;
  const fWaist = frame(yaw + twist * 0.4, deg(spine * 0.4), deg(-weight * 2 + side * 0.4));
  const fChest = frame(yaw + twist, deg(spine), deg(-weight * 5 + side) - hipRoll * 0.1);
  const waist = add(pelvis, fWaist([0, -(PRO.waist - PRO.pelvis) * H * squash, 0]));
  const breath = (p.breath || 0) * 0.006 * H;
  const chest = add(waist, fChest([0, -(PRO.chest - PRO.waist) * H * squash - breath, 0]));
  const shY = -(PRO.shoulder - PRO.chest) * H * squash;
  const shrug = (s) => Math.max(0, Math.min(1, p['shrug' + s] ?? p.shrug ?? 0)) * 0.045 * H;
  const shoulderAt = (sd, s) => add(chest, fChest([sd * b.sh * 0.88 * H * (1 - slump * 0.06), shY + (0.022 + (b.slope || 0)) * H - shrug(s) + slump * 0.008 * H, slump * 0.02 * H - 0.004 * H]));
  const shF = shoulderAt(-1, 'F');
  const shB = shoulderAt(1, 'B');
  const neckBase = add(chest, fChest([0, -(PRO.neck - PRO.chest) * H * squash, slump * 0.012 * H]));
  const headPitch = deg((p.headPitch || 0) * 0.8 + slump * 5 - spine * 0.6);
  const fNeck = frame(yaw + twist + deg((p.headYaw || 0) * 0.3), deg(spine) + headPitch * 0.35 + deg(slump * 10), deg(side * 0.5 + (p.headRoll || 0) * 0.3));
  const neckTop = add(neckBase, fNeck([0, -PRO.neckLen * H, 0]));
  const fHead = frame(yaw + twist + deg(p.headYaw || 0), deg(spine) + headPitch, deg(side * 0.6 + (p.headRoll || 0)) - hipRoll * 0.15);
  const head = add(neckTop, fHead([0, -0.9 * r, 0.04 * r]));

  // Arms: angles in the chest frame, or a hand target solved with IK.
  const arm = (s) => {
    const out = s === 'F' ? -1 : 1;
    const root = s === 'F' ? shF : shB;
    const ua = PRO.upper * H;
    const fa = PRO.fore * H;
    const [ra, fw, el] = p['arm' + s] || ARM_REST;
    const [r1, f1, e1] = [deg(ra), deg(fw), deg(Math.max(0, Math.min(160, el)))];
    const dir = fChest([out * Math.sin(r1) * Math.cos(f1), Math.cos(r1) * Math.cos(f1), Math.sin(f1)]);
    // The elbow folds the forearm forward, a little inward and up.
    let bend = fChest(unit([-out * 0.45, -0.25, 1]));
    bend = sub(bend, mul(dir, dot(bend, dir)));
    if (len(bend) < 0.05) bend = sub(fChest([0, -1, 0]), mul(dir, dot(fChest([0, -1, 0]), dir)));
    bend = unit(bend);
    const fore = add(mul(dir, Math.cos(e1)), mul(bend, Math.sin(e1)));
    const elbow = add(root, mul(dir, ua));
    const wrist = add(elbow, mul(fore, fa));
    const hand = p['hand' + s];
    if (!Array.isArray(hand)) return aimed({ sh: root, el: elbow, wr: wrist });
    // A hand target (IK), blended from the angle pose by handFw/handBw.
    // 'face' targets are in head radii in the head's own frame, so a hand on
    // the cheek stays on the cheek when the head turns or tilts.
    const w = Math.max(0, Math.min(1, p['hand' + s + 'w'] ?? 1));
    const goal = hand[3] === 'face' ? add(head, fHead([hand[0] * r, hand[1] * r, (hand[2] || 0) * r]))
      : add(hand[3] === 'head' ? head : root, [hand[0] * H, hand[1] * H, (hand[2] || 0) * H]);
    const target = add(mul(wrist, 1 - w), mul(goal, w));
    const { joint, end } = ik3(root, target, ua, fa, fChest([out * 0.55, 0.7, -0.5]));
    return aimed({ sh: root, el: joint, wr: end });
  };
  // The wrist bends: aimF/aimB is where the fingers point, in the chest frame
  // (x toward facing, y down, z toward the camera); hd is the hand's direction.
  const aimed = (A) => {
    const s = A.sh === shF ? 'F' : 'B';
    const fore = unit(sub(A.wr, A.el));
    const aim = p['aim' + s];
    if (!Array.isArray(aim) || !len(aim)) return { ...A, hd: fore };
    // It comes in with the hand target (handFw/handBw), so the wrist turns as
    // the arm travels instead of snapping. At most 75 degrees from the
    // forearm, as a real wrist bends.
    const k = Array.isArray(p['hand' + s]) ? Math.max(0, Math.min(1, p['hand' + s + 'w'] ?? 1)) : 1;
    const want = unit(add(mul(fore, 1 - k), mul(unit(fChest(aim)), k)));
    const c = Math.max(-1, Math.min(1, dot(fore, want)));
    const ang = Math.acos(c);
    const lim = deg(75);
    if (ang <= lim) return { ...A, hd: want };
    let perp = sub(want, mul(fore, c));
    if (len(perp) < 1e-6) perp = fChest([0, -1, 0]);
    return { ...A, hd: unit(add(mul(fore, Math.cos(lim)), mul(unit(perp), Math.sin(lim)))) };
  };

  // Legs: feet planted on the stance (moved by footF/footB), knees by IK.
  const leg = (s) => {
    const sd = s === 'F' ? -1 : 1;
    const hipJ = add(pelvis, fPel([sd * b.hip[0] * 0.5 * H, (PRO.pelvis - PRO.hip) * H, 0]));
    const [dx, up, dz] = p['foot' + s] || [0, 0, 0];
    const ankle = add(body([sd * stance * 0.5, 0, 0]), [dx * H, -PRO.ankle * H - (up || 0) * H - lift, (dz || 0) * H]);
    const { joint, end } = ik3(hipJ, ankle, PRO.thigh * H, PRO.shin * H, body([sd * 0.18, 0, 1]));
    const toe = body(unit([sd * 0.16, 0, 1]));
    return { hip: hipJ, knee: joint, ankle: end, toe, heel: s === 'F' ? p.toe || 0 : p.toeB || 0 };
  };

  const D = 7 * H; // camera distance: a little perspective
  const cy = -0.55 * H;
  const [vc, vs] = [Math.cos(VIEW), Math.sin(VIEW)];
  return {
    p, H, r, b, yaw, frames: { body, pelvis: fPel, waist: fWaist, chest: fChest, neck: fNeck, head: fHead },
    pelvis, waist, chest, neckBase, neckTop, head, armF: arm('F'), armB: arm('B'), legF: leg('F'), legB: leg('B'),
    // Stage point, depth and size factor for a 3D point, given where the
    // character stands. The camera looks down a little, so rings (hems,
    // belts, soles) curve and the near foot sits lower than the far one.
    projector({ x, ground, facing = 1 }) {
      return (q) => {
        const y = q[1] * vc + q[2] * vs;
        const z = -q[1] * vs + q[2] * vc;
        const f = D / (D - z);
        return [x + facing * q[0] * f, ground + cy + (y - cy) * f, z, f];
      };
    },
  };
}

// Where the head sits at rest, for speech bubble tails (no drawing).
export function restHead(ch, H) {
  const s = skeleton(ch, {}, H);
  return { x: s.head[0], y: s.head[1], r: s.r };
}
