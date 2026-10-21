// Storytime studio renderer (hub/studio/*.js): pure functions, rendered in Node.
import { beforeAll, describe, expect, it } from 'vitest';

const lib = (p: string) => import(/* @vite-ignore */ `../hub/studio/${p}` as string) as Promise<any>;
let S: any, R: any;
beforeAll(async () => {
  S = await lib('schema.js');
  R = await lib('render.js');
});

const project = (patch: any = {}) => S.validateProject({ ...S.SAMPLE_PROJECT, ...patch }).project;
const paths = (f: any) => [...(f.bg || []), ...f.world, ...f.overlay].map((o: any) => o.d ?? o.text).join('|');
const one = (beat: any, extra: any = {}) =>
  project({ scenes: [{ id: 'x', duration: 6, actors: [{ who: 'mia', x: 0.3, facing: 1, beats: [{ t: 0, ...beat }] }], ...extra }] });

describe('studio schema', () => {
  it('cleans what agents write and refuses only an empty project', () => {
    const r = S.validateProject({ cast: { 'Big Al': { hairStyle: 'mohawk', top: 'red', height: 9 } }, scenes: [{ bg: 'moon', actors: [{ who: 'big al', beats: [{ t: 2, move: 'moonwalk' }] }, { who: 'nobody' }] }] });
    expect(r.ok).toBe(true);
    const al = r.project.cast['big-al'];
    expect(al).toMatchObject({ hairStyle: 'short', top: '#6b8fc7', height: 1.3 });
    expect(r.project.scenes[0].bg.kind).toBe('plain');
    // A beat at 0 is added so every actor has a pose from the start.
    expect(r.project.scenes[0].actors[0].beats.map((b: any) => [b.t, b.move])).toEqual([[0, 'idle'], [2, 'idle']]);
    expect(r.problems.join('\n')).toMatch(/mohawk[\s\S]*moon[\s\S]*moonwalk[\s\S]*nobody/);
    expect(S.validateProject({}).ok).toBe(false);
    expect(S.validateProject('{oops').ok).toBe(false);
    expect(S.validateProject(S.SAMPLE_PROJECT).problems).toEqual([]);
  });

  it('lints craft problems', () => {
    const p = project({
      cast: { ...S.SAMPLE_PROJECT.cast, twin: { ...S.SAMPLE_PROJECT.cast.mia, name: 'Twin' } },
      scenes: [{ id: 'a', duration: 2, narration: 'x'.repeat(80), actors: [{ who: 'mia', x: 0.5, beats: [{ t: 0, move: 'walk' }, { t: 1, move: 'talk', say: 'A rather long line that needs time.' }] }, { who: 'leo', x: 0.55 }] }],
    });
    const lint = S.lintProject(p).join('\n');
    expect(lint).toContain('narration needs');
    expect(lint).toContain('walks at 0 s with no "to"');
    expect(lint).toContain('needs about');
    expect(lint).toContain('will overlap');
    expect(lint).toContain('mia and twin look alike');
    expect(lint).toContain('cast.twin: never appears');
    expect(S.lintProject(project())).toEqual([]);
  });
});

describe('studio renderer', () => {
  it('is deterministic', () => {
    const p = project();
    expect(paths(R.renderFrame(p, 0, 2.3))).toBe(paths(R.renderFrame(p, 0, 2.3)));
  });

  it('holds each drawing for `hold` frames, then boils', async () => {
    const p = project(); // 12 fps on twos: a drawing lasts 1/6 s
    const a = paths(R.renderFrame(p, 0, 0.5));
    expect(paths(R.renderFrame(p, 0, 0.5 + 0.05))).toBe(a);
    expect(paths(R.renderFrame(p, 0, 0.5 + 1 / 6))).not.toBe(a);
    // Boil 0: the same line on the next drawing keeps its wobble; with boil it shimmers.
    const D = await lib('draw.js');
    const line = (boil: number, drawing: number) => {
      const ops: any[] = [];
      new D.Pen({ style: { ...S.DEFAULT_STYLE, boil }, drawing, seed: 5, ops }).stroke('l', [[0, 0], [200, 40], [400, 0]]);
      return ops[0].d;
    };
    expect(line(0, 0)).toBe(line(0, 1));
    expect(line(0.6, 0)).not.toBe(line(0.6, 1));
  });

  it('draws every move, face, background, hair, extra and prop without bad numbers', () => {
    const cast = Object.fromEntries(S.HAIR.map((h: string, i: number) => [`c${i}`, { hairStyle: h, extras: S.EXTRAS, build: S.BUILDS[i % 3], eyes: S.EYES[i % 3] }]));
    for (const kind of S.BACKGROUNDS) {
      const actors = Object.keys(cast).slice(0, 4).map((who, i) => ({ who, x: 0.15 + i * 0.23, beats: S.MOVES.map((move: string, k: number) => ({ t: k * 0.4, move, face: S.FACES[k % S.FACES.length], to: 0.5, say: k % 5 ? undefined : 'Hi there' })) }));
      const p = S.validateProject({ cast, scenes: [{ id: kind, duration: 7, bg: { kind }, narration: 'Once upon a time.', props: S.PROPS.slice(0, 6).map((k: string, i: number) => ({ kind: k, x: i / 6, text: 'Shop' })), actors }] }).project;
      for (let t = 0; t < 7; t += 0.37) {
        const f = R.renderFrame(p, 0, t);
        const all = paths(f);
        expect(all).not.toMatch(/NaN|Infinity|undefined/);
        expect(f.world.length).toBeGreaterThan(40);
      }
    }
    const p2 = S.validateProject({ cast: { a: {} }, scenes: [{ props: S.PROPS.slice(6).map((k: string) => ({ kind: k, x: 0.5 })), actors: [{ who: 'a' }] }] }).project;
    expect(paths(R.renderFrame(p2, 0, 1))).not.toMatch(/NaN/);
  }, 30000);

  it('walks to "to" and stops; "at" turns toward the target', () => {
    const p = one({ move: 'walk', to: 0.7 });
    const a = p.scenes[0].actors[0];
    expect(R.actorState(p.scenes[0], a, 1).walking).toBe(true);
    expect(R.actorState(p.scenes[0], a, 1).x).toBeCloseTo(0.3 + 0.17, 5);
    const end = R.actorState(p.scenes[0], a, 5);
    expect(end).toMatchObject({ x: 0.7, walking: false, facing: 1 });
    const back = one({ move: 'walk', to: 0.1 });
    expect(R.actorState(back.scenes[0], back.scenes[0].actors[0], 0.5).facing).toBe(-1);

    const sc = project().scenes[0];
    const mia = sc.actors.find((x: any) => x.who === 'mia');
    expect(R.actorState(sc, mia, 2).facing).toBe(1); // pointing at Leo on her right
    const flipped = { ...sc, actors: sc.actors.map((x: any) => (x.who === 'leo' ? { ...x, x: 0.1 } : x)) };
    expect(R.actorState(flipped, mia, 2).facing).toBe(-1);
  });

  it('validates scene marks and clamps them', async () => {
    const S = await lib('schema.js');
    const base = project();
    base.scenes[0].marks = [
      { kind: 'sfx', text: 'RAHHH', x: 2, y: -1, size: 9, t: 1 },
      { kind: 'label', text: 'Never animated before', x: 0.2, y: 0.3, to: [0.5, 0.6] },
      { kind: 'label', x: 0.2, y: 0.3 },
      { kind: 'bogus', x: 0.5, y: 0.5 },
      ...Array.from({ length: 9 }, () => ({ kind: 'sparkle', x: 0.5, y: 0.5 })),
    ];
    const v = S.validateProject(base);
    const marks = v.project.scenes[0].marks;
    expect(marks.length).toBe(6);
    expect(marks[0]).toMatchObject({ kind: 'sfx', x: 1, y: 0, size: 2, t: 1 });
    expect(marks[1].to).toEqual([0.5, 0.6]);
    expect(marks.some((m: any) => m.kind === 'bogus' || (m.kind === 'label' && !m.text))).toBe(false);
    expect(S.schemaText()).toContain('marks?');
  });

  it('draws marks through the SVG painter and pops them in at t', async () => {
    const S = await lib('schema.js');
    const M = await lib('marks.js');
    const base = project();
    base.scenes[0].marks = [{ kind: 'sfx', text: 'shock', x: 0.5, y: 0.3, t: 2 }, { kind: 'sweat', x: 0.3, y: 0.3, t: 2 }, { kind: 'label', text: 'Embarrased', x: 0.2, y: 0.8, to: [0.4, 0.5] }];
    const p = S.validateProject(base).project;
    const svgAt = (t: number) => R.toSVG(R.renderFrame(p, 0, t), 800);
    expect(svgAt(1)).not.toContain('SHOCK');
    expect(svgAt(1)).toContain('Embarrased');
    expect(svgAt(2.5)).toContain('SHOCK');
    expect(M.markScale({ t: 2 }, 1.9)).toBe(0);
    expect(M.markScale({ t: 2 }, 2)).toBeCloseTo(0.3, 5);
    expect(M.markScale({ t: 2 }, 2.15)).toBe(1);
    expect(M.markScale({ t: 2 }, 2.075)).toBeGreaterThan(0.3);
    for (const kind of ['lines', 'heart', 'exclaim', 'sparkle']) {
      const q = S.validateProject({ ...base, scenes: [{ ...base.scenes[0], marks: [{ kind, x: 0.5, y: 0.5 }] }] }).project;
      expect(R.renderFrame(q, 0, 1).overlay.length).toBeGreaterThan(R.renderFrame({ ...q, scenes: [{ ...q.scenes[0], marks: [] }] }, 0, 1).overlay.length);
    }
  });

  it('has the reference-video faces, each drawn differently and with a posture', async () => {
    const S = await lib('schema.js');
    const A = await lib('acting.js');
    const faces = ['shock', 'cat', 'joy', 'shy', 'panic'];
    for (const f of faces) {
      expect(S.FACES).toContain(f);
      expect(A.POSTURE[f]).toBeTruthy();
    }
    expect(S.schemaText()).toContain('panic');
    const base = project();
    const draw = (face: string) => {
      const q = S.validateProject({ ...base, scenes: [{ ...base.scenes[0], actors: [{ who: 'mia', x: 0.5, beats: [{ t: 0, move: 'idle', face }] }] }] }).project;
      return R.toSVG(R.renderFrame(q, 0, 1), 800);
    };
    const drawn = [...faces, 'neutral'].map(draw);
    expect(new Set(drawn).size).toBe(drawn.length);
    expect(drawn.every((d) => !/NaN|undefined/.test(d))).toBe(true);
  });

  it('maps time to scenes and quantizes it', () => {
    const p = project();
    expect(R.totalSeconds(p)).toBe(13);
    expect(R.locate(p, 8)).toEqual({ scene: 1, t: 1 });
    expect(R.locate(p, 99).scene).toBe(1);
    expect(R.quantize({ fps: 12, hold: 3 }, 0.3)).toEqual({ frame: 3, drawing: 1, tq: 0.25 });
  });

  it('makes a cast sheet with every name and a valid SVG', () => {
    const p = project();
    const sheet = R.renderCastSheet(p);
    const names = sheet.world.filter((o: any) => o.text).map((o: any) => o.text);
    expect(names).toEqual(['Mia', 'Leo']);
    const svg = R.toSVG(R.renderFrame(p, 0, 4), 800);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain("That one's mine.");
    expect((svg.match(/<path /g) || []).length).toBeGreaterThan(100);
  });

  it('shades a form inside its own shape and honours clips in SVG', async () => {
    const D = await lib('draw.js');
    const style = { line: 3, ink: '#222222', wobble: 1, misregister: 1, boil: 0 };
    const ball = D.ellipse(100, 100, 40, 40, { n: 24 });
    const ops: any[] = [];
    new D.Pen({ style, seed: 2, ops }).form('b', ball, '#e8b48c');
    const clipped = ops.filter((o) => o.clip);
    expect(clipped.length).toBeGreaterThanOrEqual(3); // soft shadow, core, rim
    expect(clipped[0].d.match(/M/g).length).toBe(2); // shape with a lit hole cut out
    const flat: any[] = [];
    new D.Pen({ style: { ...style, shade: 0 }, seed: 2, ops: flat }).form('b', ball, '#e8b48c', { rim: false });
    expect(flat.some((o) => o.clip)).toBe(false);
    // light from the upper left puts the shadow on the lower right of a ball
    const shadow = clipped[0].d.split('M').filter(Boolean)[0].split('L').map((q: string) => q.replace('Z', '').split(' ').map(Number));
    expect(shadow.length).toBeGreaterThan(8);
    const svg = R.toSVG({ paper: '#fff', camera: { zoom: 1, tx: 0, ty: 0 }, world: ops, overlay: [] }, 400);
    expect((svg.match(/<clipPath /g) || []).length).toBe(clipped.length);
    expect(svg).toContain('clip-path="url(#cl0)"');
  });

  it('throws a flat cast shadow on the ground away from the light', async () => {
    const D = await lib('draw.js');
    const style = { line: 3, ink: '#222222', wobble: 1, misregister: 1, boil: 0 };
    const ops: any[] = [];
    const pen = new D.Pen({ style, seed: 1, ops });
    R.castShadow(pen, [[100, 100], [140, 100], [140, 300], [100, 300]], 300);
    expect(ops.length).toBe(2);
    const xs = ops[0].d.match(/[ML]([\d.-]+) ([\d.-]+)/g).map((q: string) => q.slice(1).split(' ').map(Number));
    expect(Math.max(...xs.map((q: number[]) => q[0]))).toBeGreaterThan(140); // thrown to the right
    expect(Math.min(...xs.map((q: number[]) => q[1]))).toBeGreaterThan(270); // flattened onto the floor
  });
});

describe('studio camera, captions and fill', () => {
  const cam = (camera: any) => project({ scenes: [{ id: 'x', duration: 4, camera, actors: [{ who: 'mia', x: 0.5, beats: [{ t: 0 }] }] }] });

  it('allows a bust close-up and clamps beyond 4', () => {
    expect(cam({ zoom: 3 }).scenes[0].camera.zoom).toBe(3);
    expect(cam({ zoom: 9 }).scenes[0].camera.zoom).toBe(4);
    expect(cam({}).scenes[0].camera).toEqual({ zoom: 1, x: 0.5, y: 0.6 });
  });

  it('eases a push-in over the scene', () => {
    const p = cam({ zoom: 1, x: 0.5, y: 0.5, to: { zoom: 3, x: 0.4, y: 0.4 } });
    const z = (t: number) => R.renderFrame(p, 0, t, { withBg: false }).camera.zoom;
    expect(z(0)).toBe(1);
    expect(z(2)).toBeCloseTo(2, 5);
    expect(z(3.99)).toBeGreaterThan(2.9);
    expect(z(1)).toBeLessThan(1.6); // slow start (smoothstep), not linear
    const fixed = R.renderFrame(cam({ zoom: 2 }), 0, 3, { withBg: false }).camera;
    expect(fixed.zoom).toBe(2);
  });

  it('puts the subtitle at the top, outlined, with capPos top', () => {
    const scene = { id: 'x', duration: 4, narration: 'Guys!', actors: [{ who: 'mia', x: 0.5, beats: [{ t: 0 }] }] };
    const bottom = R.renderFrame(project({ scenes: [scene] }), 0, 1).overlay.find((o: any) => o.text);
    const top = R.renderFrame(project({ style: { capPos: 'top' }, scenes: [scene] }), 0, 1).overlay.find((o: any) => o.text);
    expect(bottom.y).toBeGreaterThan(R.H / 2);
    expect(top.y).toBeLessThan(120);
    expect(top.outline).toBeTruthy();
    expect(bottom.outline).toBeUndefined();
    expect(S.normalizeStyle({ capPos: 'left' }).capPos).toBe('bottom');
  });

  it('fill 0 gives line art only; defaults are unchanged', async () => {
    const D = await lib('draw.js');
    const fillOf = (style: any) => {
      const ops: any[] = [];
      new D.Pen({ style: { ...S.DEFAULT_STYLE, ...style }, drawing: 0, seed: 1, ops }).fill('f', [[0, 0], [100, 0], [100, 100], [0, 100]], '#e07a5f');
      return ops[0].fill;
    };
    expect(fillOf({})).toBe('#e07a5f');
    expect(fillOf({ fill: 0 })).toBe(S.DEFAULT_STYLE.paper);
    expect(S.normalizeStyle({ fill: 7 }).fill).toBe(1);
    expect(S.normalizeStyle({}).fill).toBe(1);
  });
});

describe('studio 3D characters', () => {
  const H = 390;
  const mia = () => S.validateProject(S.SAMPLE_PROJECT).project.cast.mia;

  it('turns the body in 3D: shoulders spread facing the camera, overlap in profile', async () => {
    const K = await lib('skel.js');
    const spread = (yaw: number) => Math.abs(K.skeleton(mia(), { yaw }, H).armF.sh[0] - K.skeleton(mia(), { yaw }, H).armB.sh[0]);
    expect(spread(0)).toBeGreaterThan(0.18 * H);
    expect(spread(90)).toBeLessThan(0.02 * H);
    // At the default 3/4 turn the near (F) arm is toward the camera.
    const s = K.skeleton(mia(), {}, H);
    expect(s.armF.sh[2]).toBeGreaterThan(s.armB.sh[2]);
  });

  it('shifts weight: pelvis over the loaded foot, the other hip drops', async () => {
    const K = await lib('skel.js');
    const even = K.skeleton(mia(), { yaw: 0 }, H);
    const onF = K.skeleton(mia(), { yaw: 0, weight: 1 }, H);
    expect(onF.pelvis[0]).toBeLessThan(even.pelvis[0] - 0.03 * H); // F foot is body side -1
    expect(onF.legB.hip[1]).toBeGreaterThan(onF.legF.hip[1]); // free hip lower (y down)
    expect(onF.legB.knee[0]).not.toBeCloseTo(even.legB.knee[0], 1);
  });

  it('reads old pose fields and v2 fields, ignoring old ones when v is 2', async () => {
    const K = await lib('skel.js');
    expect(K.normalizePose({ lean: 10, bob: 0.02, F: [140, 35] })).toMatchObject({ spine: 9, pelvis: [0, 0.02], armF: [140, 10, 35] });
    expect(K.normalizePose({ v: 2, lean: 10 }).spine).toBeUndefined();
    const up = K.skeleton(mia(), { v: 2, armF: [170, 0, 0] }, H);
    expect(up.armF.wr[1]).toBeLessThan(up.armF.sh[1] - 0.2 * H); // raised overhead
    const sl = K.skeleton(mia(), { v: 2, slump: 1 }, H);
    const st = K.skeleton(mia(), { v: 2, slump: -1 }, H);
    expect(sl.head[1]).toBeGreaterThan(st.head[1]); // slumped head is lower
  });

  it('paints a hand reaching the face over the head, and hides the far eye in profile', async () => {
    const D = await lib('draw.js');
    const G = await lib('rig.js');
    const style = { ...S.DEFAULT_STYLE, boil: 0 };
    const draw = (pose: any) => {
      const ops: any[] = [];
      G.drawCharacter(new D.Pen({ style, seed: 3, ops }), mia(), pose, { x: 400, ground: 700 });
      return ops;
    };
    // The far arm hangs behind the body, so the face is painted after it;
    // brought up to the face it is painted over the face.
    const skin = mia().skin;
    const order = (pose: any) => {
      const fills = draw(pose).map((o: any) => o.fill);
      return fills.slice(fills.lastIndexOf('#fbf8f2')).filter((f: string) => f === skin).length;
    };
    expect(order({ v: 2, handB: [0.03, 0.06, 0.14, 'head'] })).toBeGreaterThan(order({ v: 2 }));
    // White of the eye: two at 3/4, one in profile.
    const whites = (pose: any) => draw(pose).filter((o: any) => o.fill === '#fbf8f2').length;
    expect(whites({ v: 2, yaw: 25 })).toBe(2);
    expect(whites({ v: 2, yaw: 90 })).toBe(1);
  });
});

describe('close-ups (talking-head shots like XIAO\'s reference videos)', () => {
  it('draws a zoomed shot with the same parts and keeps marks on the screen', () => {
    const wide = one({ move: 'talk', face: 'happy' });
    const close = one({ move: 'talk', face: 'happy' }, { camera: { zoom: 3.5, x: 0.3, y: 0.4 }, marks: [{ kind: 'sfx', text: 'shock', x: 0.85, y: 0.2 }] });
    // Same drawing, same parts, only the pen is finer.
    const w1 = R.renderFrame(wide, 0, 1).world.length;
    expect(R.renderFrame(close, 0, 1).world.length).toBe(w1);
    const f = R.renderFrame(close, 0, 1);
    expect(f.camera.zoom).toBe(3.5);
    // The mark is an overlay op (not moved by the camera), so it stays in the frame.
    expect(f.overlay.some((o: any) => o.text === 'SHOCK' || /SHOCK/.test(o.text || ''))).toBe(true);
    expect(f.world.some((o: any) => /SHOCK/.test(o.text || ''))).toBe(false);
  });
});

describe('studio female lead options (refs f1/f2)', () => {
  const lead = (patch: any = {}) =>
    S.validateProject({ cast: { a: { hairStyle: 'shag', eyes: 'anime', jaw: 'v', topStyle: 'turtleneck', bottomStyle: 'skirt', hair: '#4a2a30', hair2: '#c0507a', top: '#3a2a2a', bottom: '#6a5a8a', skin: '#f6dfd6', extras: ['lashes', 'lips', 'blushlines', 'ahoge'], ...patch } }, scenes: [{ actors: [{ who: 'a' }] }] }).project.cast.a;
  const draw = async (ch: any, pose: any = {}) => {
    const D = await lib('draw.js');
    const G = await lib('rig.js');
    const ops: any[] = [];
    G.drawCharacter(new D.Pen({ style: { ...S.DEFAULT_STYLE, boil: 0 }, seed: 3, ops }), ch, { v: 2, ...pose }, { x: 400, ground: 700 });
    return ops;
  };

  it('cleans the new cast fields and allows face close-ups', () => {
    const r = S.validateProject({ cast: { a: { eyes: 'anime', jaw: 'pointy', topStyle: 'cape', bottomStyle: 'longskirt', hair2: 'pink' } }, scenes: [{ camera: { zoom: 9 }, actors: [{ who: 'a' }] }] });
    expect(r.project.cast.a).toMatchObject({ eyes: 'anime', jaw: 'round', topStyle: 'tee', bottomStyle: 'longskirt' });
    expect(r.project.cast.a.hair2).toBeUndefined();
    expect(lead().hair2).toBe('#c0507a');
    expect(r.project.scenes[0].camera.zoom).toBe(4);
    expect(S.schemaText()).toMatch(/topStyle tee\|sleeveless\|turtleneck\|long/);
  });

  it('draws every top, bottom, eye, jaw and fringe style at every turn without bad numbers', async () => {
    for (const hairStyle of ['shag', 'flowing'])
      for (const topStyle of S.TOPS)
        for (const bottomStyle of S.BOTTOMS)
          for (const yaw of [0, 40, 90, 180]) {
            const ops = await draw(lead({ hairStyle, topStyle, bottomStyle, eyes: S.EYES[yaw % 4], jaw: S.JAWS[yaw % 2] }), { yaw, face: 'happy', hairSwing: 0.5 });
            const all = ops.map((o) => o.d).join('|');
            expect(all).not.toMatch(/NaN|Infinity|undefined/);
            expect(ops.length).toBeGreaterThan(40);
          }
  });

  it('dresses the body: no sleeves when bare, long sleeves in the top colour, bare legs under a skirt', async () => {
    const count = (ops: any[], c: string) => ops.filter((o) => o.fill === c && !o.clip).length;
    const tee = await draw(lead({ topStyle: 'tee', top: '#123456' }), { yaw: 0 });
    const bare = await draw(lead({ topStyle: 'sleeveless', top: '#123456' }), { yaw: 0 });
    const long = await draw(lead({ topStyle: 'long', top: '#123456' }), { yaw: 0 });
    expect(count(bare, '#123456')).toBe(count(tee, '#123456') - 2); // the two sleeves
    expect(count(long, '#123456')).toBeGreaterThan(count(bare, '#123456') + 1); // arms are sleeves
    const skin = '#f6dfd6';
    const trousers = await draw(lead({ bottomStyle: 'trousers' }), { yaw: 0 });
    const skirt = await draw(lead({ bottomStyle: 'skirt' }), { yaw: 0 });
    expect(count(skirt, skin)).toBeGreaterThanOrEqual(count(trousers, skin) + 2); // two bare legs
  });

  it('big eyes get two catch lights each; fringe back hair with ombre ends sits behind the body', async () => {
    const ops = await draw(lead(), { yaw: 0 });
    expect(ops.filter((o) => o.fill === '#ffffff').length).toBeGreaterThanOrEqual(4);
    const dot = await draw(lead({ eyes: 'dot', extras: [] }), { yaw: 0 });
    expect(dot.filter((o) => o.fill === '#ffffff').length).toBe(2);
    const tips = ops.findIndex((o) => o.fill === '#c0507a');
    const shirt = ops.findIndex((o) => o.fill === '#3a2a2a');
    expect(tips).toBeGreaterThan(-1);
    expect(tips).toBeLessThan(shirt);
    // Ombre paint is always clipped to a hair fill (no loose shards), in any pose.
    for (const pose of [{ yaw: 0 }, { yaw: 30, headPitch: -35, hairSwing: 1 }, { yaw: 60, spine: 20, slump: 1, hairSwing: -1 }])
      expect((await draw(lead(), pose)).filter((o) => o.fill === '#c0507a').every((o) => o.clip)).toBe(true);
    // Without hair2 there is no ombre colour anywhere.
    expect((await draw(lead({ hair2: undefined }))).some((o) => o.fill === '#c0507a')).toBe(false);
  });

  it('side locks hang from the temples: both at the front, only the near ones in profile', async () => {
    const ch = lead({ hair2: undefined, hair: '#4a2a30' });
    const locks = async (yaw: number) => (await draw(ch, { yaw })).filter((o) => o.fill === '#4a2a30' && !o.clip).length;
    expect(await locks(0)).toBeGreaterThan(await locks(90));
  });
});

describe('the reference copy (hub/studio/first-video.js)', () => {
  it('is a clean, lint-free copy of reference f2 that follows the reference rules', async () => {
    const { FIRST_VIDEO } = await lib('first-video.js');
    const { REF_RULES } = await lib('ref-rules.js');
    const v = S.validateProject(FIRST_VIDEO);
    expect(v.problems).toEqual([]);
    expect(S.lintProject(v.project)).toEqual([]);
    const p = v.project;
    const total = p.scenes.reduce((s: number, x: any) => s + x.duration, 0);
    expect(total).toBeGreaterThan(65);
    expect(total).toBeLessThan(90); // f2 is 76 s
    expect(p.scenes[0].duration).toBeLessThanOrEqual(1.5); // hook
    expect(p.scenes.filter((s: any) => s.duration > 1).every((s: any) => s.duration <= 8)).toBe(true);
    // Crop changes every beat: no two neighbouring shots with the same zoom and the same move.
    for (let i = 1; i < p.scenes.length; i++) {
      const [a, b] = [p.scenes[i - 1], p.scenes[i]];
      if (!a.actors.length || !b.actors.length) continue;
      expect(a.camera.zoom === b.camera.zoom && a.actors[0].beats[0].move === b.actors[0].beats[0].move).toBe(false);
    }
    expect(new Set(p.scenes.map((s: any) => s.camera.zoom)).size).toBeGreaterThanOrEqual(3);
    expect(p.cast.nami).toMatchObject({ eyes: 'anime', hairStyle: 'shag', jaw: 'v' });
    expect(p.style.capPos).toBe('top');
    expect(REF_RULES.length).toBeGreaterThanOrEqual(12);
    // Every frame draws without bad numbers.
    for (let i = 0; i < p.scenes.length; i++) expect(R.toSVG(R.renderFrame(p, i, p.scenes[i].duration / 2), 320)).not.toMatch(/NaN|Infinity/);
  });
});

describe('studio gag marks (f2)', () => {
  it('keeps and draws the screen gags: board, card, phone, pan, shrimp, peek', () => {
    const kinds = ['board', 'card', 'phone', 'pan', 'shrimp', 'peek'];
    const marks = kinds.map((kind) => ({ kind, text: 'Gender', x: 0.5, y: 0.5, t: 0 }));
    for (const m of marks) {
      const p = project({ scenes: [{ id: 'g', duration: 3, actors: [], marks: [m] }] });
      expect(p.scenes[0].marks[0].kind).toBe(m.kind);
      const f = R.renderFrame(p, 0, 2);
      expect(f.overlay.length).toBeGreaterThan(3);
    }
  });
  it('draws the top caption with a black outline', () => {
    const p = project({ style: { ...S.SAMPLE_PROJECT.style, capPos: 'top' }, scenes: [{ id: 'c', duration: 2, narration: 'Hi', actors: [] }] });
    const f = R.renderFrame(p, 0, 1);
    expect(f.overlay.some((o: any) => o.text === 'Hi' && o.outline === '#000000')).toBe(true);
  });
});
