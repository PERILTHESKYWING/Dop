import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import * as A from '../hub/studio/acting.js';
// @ts-expect-error plain JS module
import * as M from '../hub/studio/moves.js';
// @ts-expect-error plain JS module
import * as S from '../hub/studio/schema.js';

const sample = (move: string, face: string, t: number) => A.sampleMove(M.MOVE_SET[move], move, face, t);
const pose = (move: string, face: string, phase: number, opts: any = {}) => M.poseFor({ t: 0, move, face }, phase, { faceTalk: ['open', 'flat'], seed: 3, time: phase, ...opts });

function finite(v: any, where: string) {
  if (typeof v === 'number') expect(Number.isFinite(v), where).toBe(true);
  else if (Array.isArray(v)) v.forEach((x, i) => finite(x, `${where}[${i}]`));
}

describe('studio acting', () => {
  it('eases from 0 to 1, and back overshoots', () => {
    for (const e of Object.values(A.EASE) as ((u: number) => number)[]) {
      expect(e(0)).toBeCloseTo(0);
      expect(e(1)).toBeCloseTo(1);
    }
    expect(A.EASE.back(0.7)).toBeGreaterThan(1);
    expect(A.EASE.io(0.25)).toBeLessThan(0.25); // slow in
  });

  it('every move is a schema move and every schema move exists', () => {
    expect(Object.keys(M.MOVE_SET).sort()).toEqual([...S.MOVES].sort());
  });

  it('plays once and holds, or loops from its loop key', () => {
    const jump = M.MOVE_SET.jump;
    expect(A.moveTime(jump, 9)).toBe(jump.keys[jump.keys.length - 1][0]);
    const wave = M.MOVE_SET.wave;
    const span = wave.loop.end - wave.keys[wave.loop.from][0];
    expect(sample('wave', 'neutral', 1.0).armF).toEqual(sample('wave', 'neutral', 1.0 + span).armF);
    // Mid-air in a jump, the body is off the ground; it lands again.
    expect(sample('jump', 'neutral', 0.4).lift).toBeGreaterThan(0.15);
    expect(sample('jump', 'neutral', 2).lift || 0).toBe(0);
  });

  it('lays the feeling under the body: posture, grips, tempo', () => {
    const sad = pose('idle', 'sad', 1);
    const happy = pose('idle', 'happy', 1);
    const angry = pose('idle', 'angry', 1);
    expect(sad.slump).toBeGreaterThan(0.5);
    expect(happy.slump).toBeLessThan(0);
    expect(sad.headPitch).toBeGreaterThan(happy.headPitch + 4);
    expect(sad.spine).toBeGreaterThan(happy.spine);
    expect(angry.gripF).toBe('fist');
    expect(angry.weight).toBeGreaterThan(sad.weight);
    expect(pose('idle', 'smug', 1).gripB).toBe('hip');
    // Sad moves slowly: its shrug is still rising when the angry one has peaked.
    expect(pose('shrug', 'sad', 0.2).armF[0]).toBeLessThan(pose('shrug', 'angry', 0.2).armF[0] - 10);
    // Talking hands are bigger when happy than when sad.
    const reach = (p: any) => p.armF[1];
    expect(reach(sample('talk', 'happy', 0.4))).toBeGreaterThan(reach(sample('talk', 'sad', 0.4)) + 15);
  });

  it('starts a beat from where the last one ended, then lets go', () => {
    const prev = A.endPose(M.MOVE_SET, { t: 0, move: 'cheer', face: 'happy' }, 1);
    const beat = { t: 1, move: 'idle', face: 'sad' };
    const start = A.act(M.MOVE_SET, beat, 0, { prev });
    const later = A.act(M.MOVE_SET, beat, 0.5, { prev });
    const alone = A.act(M.MOVE_SET, beat, 0.5, {});
    expect(start.armF[0]).toBeGreaterThan(100); // arms still up from the cheer
    expect(later.armF).toEqual(alone.armF);
    expect(start.face ?? beat.face).toBe('sad');
  });

  it('lets the head arrive after the body (overlap)', () => {
    // Nod: at the first dip the body pose already has the head down; the drawn head lags.
    const body = sample('nod', 'neutral', 0.32).headPitch;
    const drawn = A.act(M.MOVE_SET, { move: 'nod', face: 'neutral' }, 0.32, { time: 0 }).headPitch;
    expect(drawn).toBeLessThan(body);
  });

  it('blends an arm from angles to a hand target', () => {
    const p = A.lerpPose({ armF: [6, 4, 12] }, { handF: [0.4, 0, 0.05] }, 0.3);
    expect(p.armF).toEqual([6, 4, 12]);
    expect(p.handF).toEqual([0.4, 0, 0.05]);
    expect(p.handFw).toBeCloseTo(0.3);
  });

  it('talks to the camera in faceCam: square body, small head turns, eyes in the lens', () => {
    for (const move of S.MOVES as string[])
      for (const face of S.FACES as string[])
        for (const t of [0, 0.4, 1.2, 2.5]) {
          const p = pose(move, face, t, { faceCam: true });
          expect(Math.abs(p.yaw), `${move}/${face}`).toBeLessThanOrEqual(A.CAM_YAW);
          expect(Math.abs(p.headYaw)).toBeLessThanOrEqual(5);
          // The eyes turn back against the head, so the gaze lands on the viewer.
          if (Math.abs(p.yaw + p.headYaw) > 1) expect(Math.sign(p.gaze[0])).toBe(-Math.sign(p.yaw + p.headYaw));
        }
    expect(pose('lookaround', 'neutral', 0.6).yaw).toBeGreaterThan(A.CAM_YAW); // without it she still turns
  });

  it('breathes and settles while standing still', () => {
    const a = pose('idle', 'neutral', 0.2);
    const b = pose('idle', 'neutral', 1.9);
    expect(a.breath).not.toBeCloseTo(b.breath, 2);
    const w = [0, 2, 4, 6, 8, 10].map((t) => A.settle(t, 5).weight);
    expect(Math.max(...w) - Math.min(...w)).toBeGreaterThan(0.2);
  });

  it('gives finite v2 poses with old-rig fields for every move, face and time', () => {
    for (const move of S.MOVES)
      for (const face of S.FACES)
        for (const t of [0, 0.13, 0.3, 0.55, 1.1, 2.7]) {
          const p = pose(move, face, t, { talking: move === 'talk', prev: { t: -1, move: 'wave', face: 'happy' } });
          expect(p.v).toBe(2);
          for (const [k, v] of Object.entries(p)) finite(v, `${move}/${face}/${t}/${k}`);
          expect(p.F || p.reachF).toBeTruthy();
          expect(p.B || p.reachB).toBeTruthy();
          expect(p.slump).toBeGreaterThanOrEqual(-1);
          expect(p.slump).toBeLessThanOrEqual(1);
        }
  });
});
