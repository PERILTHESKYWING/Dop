// Storytime studio: the storyboard format agents write and the page draws.
// Plain JS with no DOM, so the page, the hub server and the tests share it.
//
// A project is a cast of code-drawn characters (so they look the same in
// every shot) and a list of scenes. Each scene places actors and gives each
// one beats: at time t, do this move with this face (and maybe say a line).

export const MOVES = ['idle', 'talk', 'walk', 'wave', 'nod', 'shake', 'shrug', 'point', 'jump', 'think', 'facepalm', 'cheer', 'cry', 'laugh', 'sigh', 'stomp', 'gasp', 'fidget', 'crossarms', 'hips', 'bow', 'slump', 'lookaround'];
export const FACES = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'worried', 'smug', 'tired', 'shock', 'cat', 'joy', 'shy', 'panic'];
export const BACKGROUNDS = ['plain', 'room', 'bedroom', 'kitchen', 'classroom', 'street', 'park', 'night'];
export const HAIR = ['short', 'bob', 'long', 'spiky', 'bun', 'ponytail', 'curly', 'bald'];
export const MARK_KINDS = ['label', 'sfx', 'sweat', 'sparkle', 'lines', 'heart', 'exclaim'];
export const BUILDS = ['slim', 'average', 'round'];
export const EYES = ['dot', 'oval', 'sleepy'];
export const EXTRAS = ['glasses', 'freckles', 'beard', 'cap', 'blush', 'bow'];
export const PROPS = ['table', 'chair', 'bed', 'door', 'window', 'tree', 'phone', 'sign', 'lamp', 'box'];

// How the drawing looks. Agents may tune these; XIAO's rules set the defaults.
export const STYLE_RANGES = {
  fps: [8, 24], // frames per second of the video
  hold: [1, 4], // frames each drawing is held (2 = "on twos", 3 = "on threes")
  boil: [0, 1], // how much lines move between redraws of the same pose
  wobble: [0, 4], // how far lines wander from the true shape (px at 1600 wide)
  line: [2, 9], // ink width (px at 1600 wide)
  grain: [0, 1], // paper texture
  misregister: [0, 1], // colour fills slipping off the outlines
  shade: [0, 1], // how strongly the 3D shading (form shadow, rim light) shows
};
export const DEFAULT_STYLE = { fps: 12, hold: 2, boil: 0.55, wobble: 1.6, line: 4.5, grain: 0.5, misregister: 0.5, shade: 0.6, paper: '#f7f1e3', ink: '#2a2420', captions: true };

const LIMITS = { scenes: 40, actors: 4, beats: 24, props: 6, marks: 6, cast: 6, say: 140, narration: 300, title: 80, idea: 2000, duration: [1, 30] };
const SAMPLE_MAX_SECONDS = 25;
const READ_CHARS_PER_SEC = 14; // a comfortable reading speed for captions and bubbles

const HEX = /^#[0-9a-fA-F]{6}$/;
const clamp = (v, [lo, hi], dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const color = (v, dflt) => (HEX.test(String(v || '')) ? String(v).toLowerCase() : dflt);
const pick = (v, list, dflt) => (list.includes(v) ? v : dflt);
const slug = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

export function normalizeStyle(s = {}, base = DEFAULT_STYLE) {
  const out = { ...base };
  for (const [k, r] of Object.entries(STYLE_RANGES)) out[k] = clamp(s[k], r, base[k]);
  out.hold = Math.round(out.hold);
  out.fps = Math.round(out.fps);
  out.paper = color(s.paper, base.paper);
  out.ink = color(s.ink, base.ink);
  out.captions = s.captions == null ? base.captions : !!s.captions;
  return out;
}

function normalizeCharacter(c, id, problems) {
  if (!c || typeof c !== 'object') {
    problems.push(`cast.${id}: not an object`);
    c = {};
  }
  const extras = Array.isArray(c.extras) ? c.extras.filter((e) => EXTRAS.includes(e)) : [];
  if (Array.isArray(c.extras) && extras.length < c.extras.length) problems.push(`cast.${id}: unknown extras dropped (allowed: ${EXTRAS.join(', ')})`);
  if (c.hairStyle && !HAIR.includes(c.hairStyle)) problems.push(`cast.${id}: hairStyle "${c.hairStyle}" unknown, used "short"`);
  return {
    name: text(c.name, 30) || id,
    height: clamp(c.height, [0.6, 1.3], 1),
    headSize: clamp(c.headSize, [0.8, 1.4], 1),
    build: pick(c.build, BUILDS, 'average'),
    skin: color(c.skin, '#f2c9a0'),
    hair: color(c.hair, '#3b2a20'),
    hairStyle: pick(c.hairStyle, HAIR, 'short'),
    top: color(c.top, '#6b8fc7'),
    bottom: color(c.bottom, '#4a4a58'),
    shoes: color(c.shoes, '#2f2a28'),
    eyes: pick(c.eyes, EYES, 'dot'),
    extras: [...new Set(extras)],
  };
}

function normalizeBeat(b, where, problems, castIds) {
  if (!b || typeof b !== 'object') return null;
  if (b.move && !MOVES.includes(b.move)) problems.push(`${where}: move "${b.move}" unknown, used "idle" (allowed: ${MOVES.join(', ')})`);
  if (b.face && !FACES.includes(b.face)) problems.push(`${where}: face "${b.face}" unknown, used "neutral" (allowed: ${FACES.join(', ')})`);
  const out = { t: clamp(b.t, [0, 30], 0), move: pick(b.move, MOVES, 'idle'), face: pick(b.face, FACES, 'neutral') };
  if (b.to != null) out.to = clamp(b.to, [0.05, 0.95], 0.5);
  if (b.say) out.say = text(b.say, LIMITS.say);
  if (b.look != null) out.look = Number(b.look) < 0 ? -1 : 1;
  if (b.at && castIds.includes(b.at)) out.at = b.at; // who to point or look at
  return out;
}

// Turn whatever an agent wrote into a safe, complete project. Never throws:
// unknown values fall back to defaults and are listed in problems.
// fatal problems (nothing drawable) make ok false.
export function validateProject(input, { baseStyle = DEFAULT_STYLE } = {}) {
  const problems = [];
  let doc = input;
  if (typeof doc === 'string') {
    try {
      doc = JSON.parse(doc);
    } catch (e) {
      return { ok: false, project: null, problems: [`not valid JSON: ${e.message}`] };
    }
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, project: null, problems: ['project must be an object'] };

  const cast = {};
  const castIn = doc.cast && typeof doc.cast === 'object' ? doc.cast : {};
  for (const [rawId, c] of Object.entries(castIn).slice(0, LIMITS.cast)) {
    const id = slug(rawId);
    if (!id) continue;
    cast[id] = normalizeCharacter(c, id, problems);
  }
  if (Object.keys(castIn).length > LIMITS.cast) problems.push(`cast: only the first ${LIMITS.cast} characters are kept`);
  const castIds = Object.keys(cast);
  if (!castIds.length) problems.push('cast: no characters');

  const scenes = [];
  const scenesIn = Array.isArray(doc.scenes) ? doc.scenes : [];
  if (scenesIn.length > LIMITS.scenes) problems.push(`scenes: only the first ${LIMITS.scenes} are kept`);
  scenesIn.slice(0, LIMITS.scenes).forEach((s, i) => {
    if (!s || typeof s !== 'object') return problems.push(`scenes[${i}]: not an object`);
    const where = `scenes[${i}]`;
    const bg = s.bg && typeof s.bg === 'object' ? s.bg : { kind: s.bg };
    if (bg.kind && !BACKGROUNDS.includes(bg.kind)) problems.push(`${where}: bg "${bg.kind}" unknown, used "plain" (allowed: ${BACKGROUNDS.join(', ')})`);
    const actors = [];
    (Array.isArray(s.actors) ? s.actors : []).slice(0, LIMITS.actors).forEach((a, j) => {
      const aw = `${where}.actors[${j}]`;
      const who = slug(a?.who);
      if (!castIds.includes(who)) return problems.push(`${aw}: who "${a?.who}" is not in the cast`);
      const beats = (Array.isArray(a.beats) ? a.beats : [])
        .slice(0, LIMITS.beats)
        .map((b, k) => normalizeBeat(b, `${aw}.beats[${k}]`, problems, castIds))
        .filter(Boolean)
        .sort((p, q) => p.t - q.t);
      if (!beats.length || beats[0].t > 0) beats.unshift({ t: 0, move: 'idle', face: 'neutral' });
      actors.push({ who, x: clamp(a.x, [0.05, 0.95], 0.5), facing: Number(a.facing) < 0 ? -1 : 1, scale: clamp(a.scale, [0.6, 1.4], 1), beats });
    });
    const props = (Array.isArray(s.props) ? s.props : [])
      .slice(0, LIMITS.props)
      .filter((p) => p && PROPS.includes(p.kind))
      .map((p) => ({ kind: p.kind, x: clamp(p.x, [0, 1], 0.5), scale: clamp(p.scale, [0.5, 1.6], 1), ...(p.text ? { text: text(p.text, 24) } : {}) }));
    const marks = (Array.isArray(s.marks) ? s.marks : [])
      .filter((m) => m && MARK_KINDS.includes(m.kind) && (['label', 'sfx'].includes(m.kind) ? text(m.text, 40) : true))
      .slice(0, LIMITS.marks)
      .map((m) => ({
        kind: m.kind,
        ...(['label', 'sfx'].includes(m.kind) ? { text: text(m.text, 40) } : {}),
        x: clamp(m.x, [0, 1], 0.5),
        y: clamp(m.y, [0, 1], 0.5),
        ...(Array.isArray(m.to) && m.to.length === 2 && m.to.every((v) => Number.isFinite(Number(v))) ? { to: m.to.map((v) => clamp(v, [0, 1], 0.5)) } : {}),
        ...(m.t != null ? { t: clamp(m.t, [0, LIMITS.duration[1]], 0) } : {}),
        size: clamp(m.size, [0.5, 2], 1),
      }));
    const cam = s.camera && typeof s.camera === 'object' ? s.camera : {};
    scenes.push({
      id: slug(s.id) || `s${i + 1}`,
      duration: clamp(s.duration, LIMITS.duration, 4),
      bg: { kind: pick(bg.kind, BACKGROUNDS, 'plain'), color: color(bg.color, '') || undefined },
      narration: text(s.narration, LIMITS.narration),
      camera: { zoom: clamp(cam.zoom, [1, 1.8], 1), x: clamp(cam.x, [0, 1], 0.5), y: clamp(cam.y, [0, 1], 0.6) },
      actors,
      props,
      marks,
    });
  });
  if (!scenes.length) problems.push('scenes: none');

  const project = {
    title: text(doc.title, LIMITS.title) || 'Untitled story',
    idea: text(doc.idea, LIMITS.idea),
    stage: doc.stage === 'full' ? 'full' : 'sample',
    style: normalizeStyle(doc.style || {}, normalizeStyle(baseStyle)),
    cast,
    scenes,
  };
  return { ok: castIds.length > 0 && scenes.length > 0, project, problems };
}

export const projectSeconds = (p) => (p?.scenes || []).reduce((s, x) => s + x.duration, 0);

// Things code can check about craft and consistency, for critics and agents.
// Takes a validated project. Each line says where and what to change.
export function lintProject(p) {
  const out = [];
  if (!p) return ['no project'];
  const total = projectSeconds(p);
  if (p.stage === 'sample' && total > SAMPLE_MAX_SECONDS) out.push(`sample is ${total.toFixed(0)} s; keep samples under ${SAMPLE_MAX_SECONDS} s so review is quick`);
  const used = new Set();
  p.scenes.forEach((s, i) => {
    const where = `scenes[${i}] (${s.id})`;
    const need = s.narration.length / READ_CHARS_PER_SEC + 0.5;
    if (s.narration && need > s.duration) out.push(`${where}: narration needs about ${need.toFixed(1)} s to read but the scene lasts ${s.duration} s`);
    if (!s.actors.length && !s.narration) out.push(`${where}: empty scene (no actors, no narration)`);
    const xs = [];
    for (const a of s.actors) {
      used.add(a.who);
      xs.push(a.x);
      for (let k = 0; k < a.beats.length; k++) {
        const b = a.beats[k];
        const next = a.beats[k + 1]?.t ?? s.duration;
        if (b.t >= s.duration) out.push(`${where}: ${a.who} beat at ${b.t} s starts after the scene ends (${s.duration} s)`);
        if (b.move === 'walk' && b.to == null) out.push(`${where}: ${a.who} walks at ${b.t} s with no "to"`);
        if (b.say) {
          const read = b.say.length / READ_CHARS_PER_SEC + 0.4;
          if (next - b.t < read) out.push(`${where}: ${a.who} says "${b.say.slice(0, 30)}…" for ${(next - b.t).toFixed(1)} s; needs about ${read.toFixed(1)} s`);
        }
        if ((b.move === 'point' || b.look != null) && b.at === a.who) out.push(`${where}: ${a.who} points at themself`);
      }
    }
    xs.sort((m, n) => m - n);
    for (let k = 1; k < xs.length; k++) if (xs[k] - xs[k - 1] < 0.14) out.push(`${where}: two actors stand ${Math.round((xs[k] - xs[k - 1]) * 100)}% apart and will overlap; keep at least 15%`);
    const speakers = s.actors.filter((a) => a.beats.some((b) => b.say));
    if (speakers.length > 2) out.push(`${where}: ${speakers.length} people speak in one scene; storytime scenes read best with one or two`);
  });
  for (const id of Object.keys(p.cast)) if (!used.has(id)) out.push(`cast.${id}: never appears`);
  // Characters that look too alike are hard to follow.
  const ids = Object.keys(p.cast);
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = p.cast[ids[i]];
      const b = p.cast[ids[j]];
      if (a.hairStyle === b.hairStyle && near(a.hair, b.hair) && near(a.top, b.top)) out.push(`cast: ${ids[i]} and ${ids[j]} look alike (same hair and similar top); change one`);
    }
  return out;
}

function near(a, b) {
  const c = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [c(a), c(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 60;
}

// The format in a few lines, for agent briefs (kept short to save tokens).
export function schemaText() {
  return [
    'Project JSON: {title, idea, stage:"sample"|"full", style?, cast:{id:Character}, scenes:[Scene]}.',
    `Character: {name, height 0.6-1.3, headSize 0.8-1.4, build ${BUILDS.join('|')}, skin, hair, top, bottom, shoes (#rrggbb), hairStyle ${HAIR.join('|')}, eyes ${EYES.join('|')}, extras [${EXTRAS.join(', ')}]}.`,
    `Scene: {id, duration 1-30 s, bg {kind ${BACKGROUNDS.join('|')}, color?}, narration (caption, ~${READ_CHARS_PER_SEC} chars/s), camera? {zoom 1-1.8, x 0-1, y 0-1}, props? [{kind ${PROPS.join('|')}, x 0-1, scale?, text?}], marks? [{kind ${MARK_KINDS.join('|')}, text? (label/sfx, ≤40 chars), x 0-1, y 0-1, to? [x,y] arrow target, t? pop-in time s, size? 0.5-2}] (max ${LIMITS.marks}), actors: [Actor] (max ${LIMITS.actors})}.`,
    `Actor: {who: cast id, x 0.05-0.95, facing 1|-1, scale?, beats: [{t s, move ${MOVES.join('|')}, face ${FACES.join('|')}, say? (bubble, ≤${LIMITS.say} chars; the mouth moves with any move, talk adds hand gestures), to? (walk target x), at? (cast id to point/look at)}]}.`,
    `style? {fps 8-24, hold 1-4 (frames per drawing), boil 0-1, wobble 0-4, line 2-9, grain 0-1, misregister 0-1, paper, ink}. Omit style to use XIAO's defaults.`,
    `A sample is 1-2 scenes under ${SAMPLE_MAX_SECONDS} s.`,
  ].join('\n');
}

// A tiny story used by the page's demo and the tests.
export const SAMPLE_PROJECT = {
  title: 'The Last Cookie',
  idea: 'Two roommates both want the last cookie.',
  stage: 'sample',
  cast: {
    mia: { name: 'Mia', hairStyle: 'bob', hair: '#5a3a2a', top: '#e07a5f', bottom: '#3d405b', skin: '#f2c9a0', extras: ['blush'] },
    leo: { name: 'Leo', hairStyle: 'spiky', hair: '#2d2d2d', top: '#81b29a', bottom: '#4a4e69', skin: '#c99872', height: 1.1, build: 'slim', extras: ['glasses'] },
  },
  scenes: [
    {
      id: 'kitchen',
      duration: 7,
      bg: { kind: 'kitchen' },
      narration: 'So there was one cookie left. Just one.',
      props: [{ kind: 'table', x: 0.5 }],
      actors: [
        { who: 'mia', x: 0.28, facing: 1, beats: [{ t: 0, move: 'idle', face: 'neutral' }, { t: 1.5, move: 'point', face: 'surprised', at: 'leo' }, { t: 3.2, move: 'talk', face: 'smug', say: "That one's mine." }] },
        { who: 'leo', x: 0.74, facing: -1, beats: [{ t: 0, move: 'idle', face: 'neutral' }, { t: 3.4, move: 'shake', face: 'worried' }, { t: 5, move: 'talk', face: 'angry', say: 'No way!' }] },
      ],
    },
    {
      id: 'standoff',
      duration: 6,
      bg: { kind: 'kitchen' },
      narration: 'Neither of us was going to back down.',
      camera: { zoom: 1.25, x: 0.5, y: 0.55 },
      actors: [
        { who: 'mia', x: 0.32, facing: 1, beats: [{ t: 0, move: 'facepalm', face: 'tired' }, { t: 3, move: 'walk', to: 0.4, face: 'angry' }] },
        { who: 'leo', x: 0.7, facing: -1, beats: [{ t: 0, move: 'shrug', face: 'smug' }, { t: 3.5, move: 'laugh', face: 'happy' }] },
      ],
    },
  ],
};
