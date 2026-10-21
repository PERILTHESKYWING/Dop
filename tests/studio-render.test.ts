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

  it('holds each drawing for `hold` frames, then boils', () => {
    const p = project(); // 12 fps on twos: a drawing lasts 1/6 s
    const a = paths(R.renderFrame(p, 0, 0.5));
    expect(paths(R.renderFrame(p, 0, 0.5 + 0.05))).toBe(a);
    expect(paths(R.renderFrame(p, 0, 0.5 + 1 / 6))).not.toBe(a);
    // Boil 0: an idle hold keeps its lines; only the pose changes.
    const still = project({ style: { boil: 0 } });
    const head = (f: any) => f.world.filter((o: any) => o.d).slice(0, 4).map((o: any) => o.d).join();
    expect(head(R.renderFrame(still, 0, 0.0))).toBe(head(R.renderFrame(still, 0, 0.2)));
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
  });

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
});
