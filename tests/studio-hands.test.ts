// Studio arms and hands (hub/studio/body.js, skel.js, moves.js): a hand must
// never come apart from its arm, in any drawing of the ref copy or any move.
import { beforeAll, describe, expect, it } from 'vitest';

const lib = (p: string) => import(/* @vite-ignore */ `../hub/studio/${p}` as string) as Promise<any>;
let S: any, R: any, M: any, K: any, B: any, D: any, V: any;
beforeAll(async () => {
  [S, R, M, K, B, D, V] = await Promise.all(['schema.js', 'render.js', 'moves.js', 'skel.js', 'body.js', 'draw.js', 'first-video.js'].map(lib));
});

const HAND_MOVES = ['cheek', 'clasp', 'chin', 'phone', 'fistup', 'cover', 'oneup', 'peace', 'palms', 'cheeks'];

// Even-odd point in polygon.
function inside(pts: number[][], [x, y]: number[]) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// The arms of one drawing: skeleton and body geometry, as the rig builds them.
function arms(ch: any, pose: any, facing = 1) {
  const H = 600;
  const sk = K.skeleton(ch, pose, H);
  const Pj = sk.projector({ x: 800, ground: 774, facing });
  const pen = new D.Pen({ style: { line: 3.5, ink: '#2a2340', wobble: 1, boil: 0.35, misregister: 0.15 } });
  return { sk, H, hands: B.bodyParts(pen, ch, sk, Pj, facing).hands };
}

// Every problem with the hands of one drawing (empty = fine).
function handProblems(ch: any, pose: any, facing: number, where: string) {
  const out: string[] = [];
  const { hands } = arms(ch, pose, facing);
  for (const s of ['F', 'B']) {
    const h = hands[s];
    const bare = ch.topStyle === 'sleeveless' || ch.topStyle === 'turtleneck';
    // Bare arms: forearm and hand are one outline, unless the forearm points
    // at the camera (then the hand sits over its round end).
    const joined = bare && h.foreshort > 0.3;
    if (joined !== !!h.joined) out.push(`${where} ${s}: hand ${joined ? 'not ' : ''}joined to the forearm outline`);
    if (!inside(h.outline, h.wrist)) out.push(`${where} ${s}: wrist outside the arm`);
    const c = h.shape.closed;
    const mid = [c.reduce((a: number, q: number[]) => a + q[0], 0) / c.length, c.reduce((a: number, q: number[]) => a + q[1], 0) / c.length];
    if (joined && !inside(h.outline, mid)) out.push(`${where} ${s}: hand off the arm`);
    // A separate hand covers the wrist (or its outline passes within a few px of it).
    if (!h.joined && !inside(c, h.wrist) && Math.min(...c.map((q: number[]) => Math.hypot(q[0] - h.wrist[0], q[1] - h.wrist[1]))) > 4) out.push(`${where} ${s}: hand apart from the wrist`);
  }
  return out;
}

describe('studio hands', () => {
  it('keeps every hand on its arm in every drawing of the ref copy', () => {
    const p = S.validateProject(V.FIRST_VIDEO).project;
    const step = p.style.hold / p.style.fps;
    const bad: string[] = [];
    let n = 0;
    p.scenes.forEach((scene: any) => {
      for (let t = 0; t < scene.duration; t += step) {
        const { tq } = R.quantize(p.style, t);
        for (const a of scene.actors) {
          const s = R.actorState(scene, a, tq);
          const pose = M.poseFor(s.beat, s.phase, { seed: 7, talking: !!s.beat.say, prev: a.beats[s.beatIndex - 1], time: tq, walking: s.walking });
          bad.push(...handProblems(p.cast[a.who], pose, s.facing, `${scene.id} @${t.toFixed(2)}`));
          n++;
        }
      }
    });
    expect(n).toBeGreaterThan(300);
    expect(bad).toEqual([]);
  });

  it('keeps hands on in every move, both facings, sleeved and bare', () => {
    const nami = S.validateProject(V.FIRST_VIDEO).project.cast.nami;
    const bad: string[] = [];
    for (const ch of [nami, { ...nami, topStyle: 'tee' }]) {
      for (const move of Object.keys(M.MOVE_SET)) {
        for (let t = 0; t < 2.5; t += 1 / 6) {
          for (const facing of [1, -1]) bad.push(...handProblems(ch, M.poseFor({ t: 0, move, face: 'happy' }, t, { time: t }), facing, `${ch.topStyle} ${move} @${t.toFixed(2)}`));
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('acts the ref hand poses: hands travel smoothly and land where they should', () => {
    const ch = S.validateProject(V.FIRST_VIDEO).project.cast.nami;
    const idle = { t: 0, move: 'idle', face: 'happy' };
    for (const move of HAND_MOVES) {
      expect(M.MOVE_SET[move], move).toBeTruthy();
      // After another beat the hand travels there on the drawing clock (a
      // beat starts between drawings, so sample as the renderer does): less
      // than 0.28 of the height per drawing, then it is in the pose and
      // holds.
      let last: number[] | null;
      const at = (t: number) => arms(ch, M.poseFor({ t: 1, move, face: 'neutral' }, t, { time: 1 + t, prev: idle })).sk.armF.wr;
      for (const off of [0, 0.07, 0.12]) {
        last = null;
        for (let t = off; t <= 0.9; t += 1 / 6) {
          const w = at(t);
          if (last) expect(Math.hypot(w[0] - last[0], w[1] - last[1], w[2] - last[2]) / 600, `${move} @${t.toFixed(2)}`).toBeLessThan(0.28);
          last = w;
        }
      }
      const [a, b] = [at(move === 'fistup' ? 1.05 : 0.85), at(2)];
      expect(Math.hypot(a[0] - b[0], a[1] - b[1]) / 600, `${move} holds`).toBeLessThan(0.02);
      // A shot that opens on it starts in the pose.
      const open = arms(ch, M.poseFor({ t: 0, move, face: 'neutral' }, 0, { time: 0 })).sk.armF.wr;
      expect(Math.hypot(open[0] - b[0], open[1] - b[1]) / 600, `${move} opens posed`).toBeLessThan(0.02);
    }
    const held = (move: string) => arms(ch, M.poseFor({ t: 0, move, face: 'happy' }, 1.5, { time: 1.5 }));
    // Face poses put the wrist at the head (the fingers reach the face), in front of the face; fist up raises it above the head.
    for (const move of ['cheek', 'chin', 'cover', 'cheeks', 'peace', 'oneup', 'palms']) {
      const { sk } = held(move);
      expect(Math.hypot(sk.armF.wr[0] - sk.head[0], sk.armF.wr[1] - sk.head[1]) / sk.r, move).toBeLessThan(2);
      expect(sk.armF.wr[2], move).toBeGreaterThan(sk.head[2]);
    }
    const up = held('fistup').sk;
    expect(up.armF.wr[1]).toBeLessThan(up.head[1]);
    // Fingers point up in the face poses (the wrist bends).
    for (const move of ['cheek', 'oneup', 'peace', 'cover', 'palms']) expect(held(move).sk.armF.hd[1], move).toBeLessThan(-0.5);
    // Two-handed poses bring both hands together; the phone is held at the chest.
    for (const move of ['phone', 'palms', 'cover']) {
      const { sk, H } = held(move);
      expect(Math.hypot(sk.armF.wr[0] - sk.armB.wr[0], sk.armF.wr[1] - sk.armB.wr[1]) / H, move).toBeLessThan(0.09);
    }
    const ph = held('phone').sk;
    expect(ph.armF.wr[1]).toBeGreaterThan(ph.neckBase[1]);
    // The grip lands on the opposite shoulder: the fingers (a hand's length
    // past the wrist) reach it.
    const cl = held('clasp').sk;
    const tip = cl.armF.wr.map((v: number, i: number) => v + cl.armF.hd[i] * 0.105 * 600 * ch.headSize ** 2 * 0.7);
    expect(Math.hypot(tip[0] - cl.armB.sh[0], tip[1] - cl.armB.sh[1]) / 600).toBeLessThan(0.07);
  });
});
