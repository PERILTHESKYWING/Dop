/**
 * Kiai's live 3D board: a kaya board, slate and shell stones and mulberry bowls drawn with
 * three.js in real sizes (metres, as tools/kiai-art/scene.py builds the rendered set), and
 * KataGo's reading drawn as light on it: candidate rings with a beam on the best move,
 * territory as lit dots, a variation as glass stones joined by arcs of light.
 *
 * It draws only when something changes (render on demand), so a still board costs nothing,
 * which matters on phones. Text (winrates, move numbers, coordinates) is not drawn here: the
 * owner places HTML over the canvas with project().
 */
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  AgXToneMapping,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  EquirectangularReflectionMapping,
  FloatType,
  Group,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NormalBlending,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Points,
  PointsMaterial,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  RGBAFormat,
  RingGeometry,
  Scene,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  ShadowMaterial,
  SRGBColorSpace,
  CanvasTexture,
  Texture,
  TextureLoader,
  TubeGeometry,
  CurvePath,
  LineCurve3,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type ToneMapping,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// ------------------------------------------------------------------ real sizes (metres)

/** Line spacing across and along: real boards are a touch longer than wide. */
export const SX = 0.022;
export const SY = 0.0237;
/** Margin from the outer lines to the edge, across and along (a 19x19 board is 424 x 454 mm). */
const MX = (0.424 - 18 * SX) / 2;
const MY = (0.454 - 18 * SY) / 2;
const LINE = 0.0009;
const FRAME = 0.0013;
const STONE_B = { d: 0.0223, t: 0.0086 };
const STONE_W = { d: 0.022, t: 0.0088 };
const BOWL: [number, number][] = [[0.0, 0.0], [0.04, 0.0], [0.05, 0.004], [0.06, 0.014], [0.067, 0.03], [0.069, 0.045], [0.066, 0.06], [0.06, 0.072], [0.0565, 0.0765], [0.053, 0.0765], [0.0525, 0.072], [0.058, 0.06], [0.0605, 0.045], [0.059, 0.03], [0.053, 0.018], [0.04, 0.011], [0.0, 0.009]];

const ART = '/kiai/3d';

export type Loc = number;
export type StoneColor = 1 | 2;
/** The wood: honey kaya like XIAO's reference board, pale shin-kaya, or deep aged wood. */
export type BoardWood = 'kaya' | 'shinkaya' | 'dark';
const WOOD: Record<BoardWood, { prefix: string; tint: number; lines: number }> = {
  kaya: { prefix: '', tint: 0xccad8f, lines: 0x1a120c },
  shinkaya: { prefix: 'shinkaya-', tint: 0xfffae0, lines: 0x221a12 },
  dark: { prefix: 'dark-', tint: 0xf2f2f2, lines: 0x0d0805 },
};

/**
 * A translucent stone with an optional number printed on it, the way Go books mark a line of
 * play or a choice of moves: KataGo's candidates (the win chance on each) and a variation (the
 * order of the moves). No glow, no rings: the number is drawn on the stone's face, so it leans
 * and shades with the board.
 */
export interface PaleMark {
  loc: Loc;
  color: StoneColor;
  text?: string;
  /** How solid the stone is, 0..1. */
  alpha: number;
  /** A cream stone with a dark number whatever the colour (KataGo's choices, not a real stone). */
  cream?: boolean;
}

/** Printed numbers, one canvas each, kept for the page's life (a few dozen at most). */
const numberTex = new Map<string, Texture>();
let numberFontReady: Promise<void> | null = null;
function numberTexture(text: string, ink: string): Texture {
  const key = `${text}|${ink}`;
  let t = numberTex.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  drawNumber(c, text, ink);
  t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  t.userData = { text, ink };
  numberTex.set(key, t);
  return t;
}
function drawNumber(c: HTMLCanvasElement, text: string, ink: string) {
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // as big as the stone allows: a number should read at a glance even on a small board
  const px = text.length >= 3 ? 76 : text.length === 2 ? 112 : 118;
  g.font = `800 ${px}px "Alegreya Sans", ui-sans-serif, system-ui, sans-serif`;
  g.fillText(text, 64, 71, 118);
}

export interface CandGlow {
  loc: Loc;
  /** 0 = KataGo's choice. */
  rank: number;
  /** Visits relative to the most visited move, 0..1. */
  share: number;
  /** 0 = as good as the best, 1 = clearly worse. */
  badness: number;
  /** An earlier pick kept for comparison: dim and grey-blue, so the live one stands out. */
  ghost?: boolean;
}

export interface PlateCamera {
  /** Blender camera (Z up): location, target, lens over a 36 mm sensor width. */
  loc: [number, number, number];
  target: [number, number, number];
  lens: number;
  sensor: number;
  width: number;
  height: number;
  sun: { elev: number; azim: number };
  board_rot_z: number;
}

export type ViewMode =
  | { kind: 'top'; tilt?: number; crop?: { x0: number; y0: number; x1: number; y1: number } | null; pad?: number }
  | { kind: 'plate'; cam: PlateCamera; crop: { x: number; y: number; w: number; h: number } }
  | { kind: 'orbit'; elev: number; azim: number; dist?: number; target?: [number, number, number]; fov?: number; spin?: number; shift?: number; shiftY?: number };

export interface KayaOptions {
  canvas: HTMLCanvasElement;
  size: number;
  /** Board thickness in metres (a table board is 0.06; floor boards up to 0.18). */
  thickness?: number;
  wood?: BoardWood;
  /** A faint ring spreads from each stone set down (the landing). Off in the app. */
  ripples?: boolean;
  bowls?: boolean;
  /** Catch the set's shadows on an invisible table (when drawn over a photographed table). */
  shadowCatcher?: boolean;
  /** Sun direction: elevation and azimuth in degrees (Blender convention, Z up). */
  sun?: { elev: number; azim: number };
  toneMapping?: 'agx' | 'aces';
  exposure?: number;
  /** How much the sky lights and reflects in the set (0.85 by default). */
  envIntensity?: number;
  /** The sun's strength (2.6 by default). */
  sunStrength?: number;
  /** Lower pixel ratio and shadow map, for phones and thumbnails. */
  lite?: boolean;
  /** Size of the light effects (halos, ripples, arcs); above 1 for a board seen from afar. */
  fx?: number;
  /** 'void': the board floats in the dark, with a cool rim light and a glow under it. */
  stage?: 'void';
  /**
   * A 360° panorama (an equirectangular image's URL) around the set: seen behind it exactly as
   * rendered (not tone mapped again) and lighting it. Its sun should be where `sun` puts the light.
   */
  skyUrl?: string;
  /**
   * Turns the panorama about the vertical by this many degrees (so its sun can be put anywhere).
   * Note three.js turns an equirectangular background against the angle: a feature at azimuth A
   * (KayaOptions.sun's convention) as rendered shows at A + skyTurn.
   */
  skyTurn?: number;
  /** A honed marble table under the board, catching its shadows (the landing). */
  table?: boolean;
  /** A soft warm light from everywhere above (0 by default): shade under a blue sky stays grey. */
  fill?: number;
  /**
   * Candidate moves stand up as columns of light this tall (metres, for the most visited move),
   * for boards seen from the side. 0 (the default) keeps them flat, for boards seen from above.
   */
  pillars?: number;
}

// ------------------------------------------------------------------ shared assets

const loader = new TextureLoader();
const texCache = new Map<string, Texture>();
/** Views to redraw when a texture arrives (they only draw on demand). */
const liveViews = new Set<{ invalidate(shadows?: boolean): void }>();
function tex(name: string, color = true, variant = ''): Texture {
  const key = `${name}|${color}|${variant}`;
  let t = texCache.get(key);
  if (!t) {
    t = loader.load(`${ART}/${name}`, () => liveViews.forEach((v) => v.invalidate()));
    if (color) t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    texCache.set(key, t);
  }
  return t;
}

/** A soft round spot (white, alpha falling off): the glow of rings, dots and halos. */
let glowTex: Texture | null = null;
function glowTexture(): Texture {
  if (glowTex) return glowTex;
  const n = 128;
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
      const a = r >= 1 ? 0 : Math.exp(-r * r * 4.2) * (1 - r * r);
      const i = (y * n + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(a * 255);
    }
  glowTex = new DataTexture(d, n, n, RGBAFormat);
  glowTex.magFilter = LinearFilter;
  glowTex.minFilter = LinearFilter;
  glowTex.needsUpdate = true;
  return glowTex;
}

/** A thin ring of light with soft edges (ripples). */
let ringTex: Texture | null = null;
function ringTexture(): Texture {
  if (ringTex) return ringTex;
  const n = 128;
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
      const a = r >= 1 ? 0 : Math.exp(-Math.pow((r - 0.82) / 0.07, 2)) + 0.18 * Math.exp(-Math.pow((r - 0.82) / 0.2, 2));
      const i = (y * n + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  ringTex = new DataTexture(d, n, n, RGBAFormat);
  ringTex.magFilter = LinearFilter;
  ringTex.minFilter = LinearFilter;
  ringTex.needsUpdate = true;
  return ringTex;
}

/**
 * A ring of light on the board, `uR` metres from `uC`: the grid ping. Drawn on the grid lines
 * (they light up as it passes) and, fainter and wider, on the wood.
 */
function waveMaterial(width: number, alpha: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(0x5fdcff) }, uC: { value: new Vector2() }, uR: { value: 0 }, uW: { value: width }, uA: { value: 0 }, uMax: { value: alpha } },
    vertexShader: 'varying vec2 vP; void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader:
      'uniform vec3 uColor; uniform vec2 uC; uniform float uR; uniform float uW; uniform float uA; uniform float uMax; varying vec2 vP;' +
      'void main() { float d = length(vP - uC); float k = exp(-pow((d - uR) / uW, 2.0)) + 0.25 * smoothstep(uR, 0.0, d) * step(d, uR);' +
      ' gl_FragColor = vec4(uColor, clamp(k * uA * uMax, 0.0, 1.0)); }',
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
}

/** A tile with a lit edge and a dimmer middle (the faces of territory blocks). */
let tileTex: Texture | null = null;
function tileTexture(): Texture {
  if (tileTex) return tileTex;
  const n = 64;
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const e = Math.min(x + 0.5, n - x - 0.5, y + 0.5, n - y - 0.5) / n; // 0 at the edge
      const a = 0.5 + 0.5 * Math.exp(-e * 22);
      const i = (y * n + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.round(180 + 75 * Math.exp(-e * 22));
      d[i + 3] = Math.round(a * 255);
    }
  tileTex = new DataTexture(d, n, n, RGBAFormat);
  tileTex.magFilter = LinearFilter;
  tileTex.minFilter = LinearFilter;
  tileTex.colorSpace = SRGBColorSpace;
  tileTex.needsUpdate = true;
  return tileTex;
}

/** A rounded square with soft edges (territory marks). */
let squareTex: Texture | null = null;
function squareTexture(): Texture {
  if (squareTex) return squareTex;
  const n = 64;
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = Math.abs(x + 0.5 - n / 2) / (n / 2), v = Math.abs(y + 0.5 - n / 2) / (n / 2);
      const r = Math.pow(Math.pow(u, 6) + Math.pow(v, 6), 1 / 6); // superellipse: a square with round corners
      const a = MathUtils.clamp((1 - r) / 0.12, 0, 1);
      const i = (y * n + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(a * 255);
    }
  squareTex = new DataTexture(d, n, n, RGBAFormat);
  squareTex.magFilter = LinearFilter;
  squareTex.minFilter = LinearFilter;
  squareTex.needsUpdate = true;
  return squareTex;
}

/** A beam's falloff: bright at the foot, gone at the top, soft at the sides. */
let beamTex: Texture | null = null;
function beamTexture(): Texture {
  if (beamTex) return beamTex;
  const w = 16, h = 128;
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = y / (h - 1); // 0 = bottom
      const a = Math.pow(1 - v, 2.2) * (0.6 + 0.4 * Math.sin((x / (w - 1)) * Math.PI));
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(a * 255);
    }
  beamTex = new DataTexture(d, w, h, RGBAFormat);
  beamTex.magFilter = LinearFilter;
  beamTex.minFilter = LinearFilter;
  beamTex.wrapS = RepeatWrapping;
  beamTex.needsUpdate = true;
  return beamTex;
}

/** A column of light: a bright band at the top (the level), a soft glow below it (a bright foot, added to the orange wood, turned a warm smear). */
let pillarTex: Texture | null = null;
function pillarTexture(): Texture {
  if (pillarTex) return pillarTex;
  const w = 4, h = 128;
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1); // 0 = bottom
    const a = Math.min(1, 0.16 + 0.12 * Math.pow(1 - v, 6) + 0.25 * Math.pow(v, 4) + (v > 0.955 ? 0.85 : 0));
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(a * 255);
    }
  }
  pillarTex = new DataTexture(d, w, h, RGBAFormat);
  pillarTex.magFilter = LinearFilter;
  pillarTex.minFilter = LinearFilter;
  pillarTex.needsUpdate = true;
  return pillarTex;
}

/** The bright core of a column: strongest at the top (its level), fading toward the foot. */
let coreTex: Texture | null = null;
function coreTexture(): Texture {
  if (coreTex) return coreTex;
  const w = 4, h = 128;
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1); // 0 = bottom
    const a = Math.min(1, 0.3 + 0.55 * v * v + 0.25 * Math.pow(1 - v, 10) + (v > 0.965 ? 0.6 : 0));
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(a * 255);
    }
  }
  coreTex = new DataTexture(d, w, h, RGBAFormat);
  coreTex.magFilter = LinearFilter;
  coreTex.minFilter = LinearFilter;
  coreTex.needsUpdate = true;
  return coreTex;
}

/**
 * The sky the stones reflect: blue overhead, bright haze at the horizon, a white sea of cloud
 * below and the sun, as on the landing's plate. HDR, so the sun gives real highlights.
 */
function skyTexture(sunElev: number, sunAzim: number): DataTexture {
  const w = 256, h = 128;
  const d = new Float32Array(w * h * 4);
  const se = MathUtils.degToRad(sunElev), sa = MathUtils.degToRad(sunAzim);
  const sun = new Vector3(Math.cos(se) * Math.cos(sa), Math.sin(se), -Math.cos(se) * Math.sin(sa));
  const dir = new Vector3();
  const zen = [0.32, 0.5, 0.82], hor = [0.86, 0.91, 0.97], cloud = [0.9, 0.92, 0.95], deep = [0.62, 0.67, 0.74];
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI; // +pi/2 at the top row
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w) * Math.PI * 2 - Math.PI;
      dir.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
      let c: number[];
      if (lat > 0) {
        const t = Math.pow(1 - lat / (Math.PI / 2), 3);
        c = zen.map((z, k) => z + (hor[k] - z) * t);
      } else {
        const t = Math.min(1, -lat / 0.5);
        c = cloud.map((z, k) => z + (deep[k] - z) * t);
      }
      const cs = dir.dot(sun);
      const glow = Math.pow(Math.max(0, cs), 64) * 3 + Math.pow(Math.max(0, cs), 8) * 0.35;
      const disc = cs > 0.9995 ? 400 : 0;
      const i = (y * w + x) * 4;
      d[i] = c[0] * 1.2 + glow + disc;
      d[i + 1] = c[1] * 1.2 + glow * 0.96 + disc * 0.95;
      d[i + 2] = c[2] * 1.2 + glow * 0.88 + disc * 0.88;
      d[i + 3] = 1;
    }
  }
  const t = new DataTexture(d, w, h, RGBAFormat, FloatType);
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Double-convex stone, as tools/kiai-art/kl.py stone_profile: z = h (1 - u^2)^0.8. */
function stoneGeometry(d: number, t: number, segments: number): BufferGeometry {
  const R = d / 2, h = t / 2, steps = 22;
  // from the centre of the bottom face out to the rim, then in to the centre of the top face
  const pts: Vector2[] = [];
  const dz = (u: number) => h * Math.pow(Math.max(0, 1 - u * u), 0.8);
  for (let i = 0; i <= steps; i++) {
    const u = Math.sin(((i / steps) * Math.PI) / 2); // points crowd towards the rim, where it curves most
    pts.push(new Vector2(R * u, h - dz(u)));
  }
  for (let i = steps - 1; i >= 0; i--) {
    const u = Math.sin(((i / steps) * Math.PI) / 2);
    pts.push(new Vector2(R * u, h + dz(u)));
  }
  const g = new LatheGeometry(pts, segments);
  // planar UVs across the face, so the shell's stripes run straight over it
  const pos = g.getAttribute('position') as BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / d + 0.5;
    uv[i * 2 + 1] = pos.getZ(i) / d + 0.5;
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function hash(i: number): number {
  let x = (i + 1) * 2654435761;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** A stone landing: falls, a small bounce, settles. */
function dropCurve(t: number): number {
  if (t < 0.62) {
    const k = t / 0.62;
    return 1 - k * k;
  }
  const k = (t - 0.62) / 0.38;
  return 0.06 * Math.sin(k * Math.PI) * (1 - k);
}

interface Anim {
  /** Returns false when finished. */
  step(now: number): boolean;
}

/** How one candidate looks; tweened when KataGo's read changes. */
interface CandLook {
  /** 0..1 presence (grows in, shrinks out). */
  on: number;
  strength: number;
  /** Share of the most visited move's visits: the lit part of the dial. */
  share: number;
  /** 1 for KataGo's choice. */
  best: number;
  col: Color;
}
interface CandFx {
  loc: Loc;
  g: Group;
  lens: Mesh<CircleGeometry, MeshBasicMaterial>;
  track: Mesh<RingGeometry, MeshBasicMaterial>;
  arc: Mesh<RingGeometry, MeshBasicMaterial>;
  halo: Mesh<PlaneGeometry, MeshBasicMaterial>;
  pillar: Mesh<CylinderGeometry, MeshBasicMaterial> | null;
  cap: Mesh<RingGeometry, MeshBasicMaterial> | null;
  /** The column's solid core (normal blending, so it reads on a bright sky as well as in the dark). */
  core: Mesh<CylinderGeometry, MeshBasicMaterial> | null;
  /** Soft light around the column and a flare at its top: the bloom, faked with sprites. */
  bloom: Sprite | null;
  flare: Sprite | null;
  from: CandLook;
  to: CandLook;
  cur: CandLook;
  t0: number;
  delay: number;
}

const DIAL_SEGS = 72;
const C_BEST = 0x2fd3ff, C_GOOD = 0x8fdcff, C_MID = 0xe4f1ff, C_BAD = 0xffb057, C_GHOST = 0x4f87a3;
// smoked blue glass, a clear step lighter than a black stone so a candidate never reads as one
const LENS_BEST = new Color(0x2eb4ee), LENS = new Color(0xb4def3);
const WHITE = new Color(0xffffff);

// ------------------------------------------------------------------ the view

export class KayaView {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(30, 1, 0.01, 50);
  readonly set = new Group();
  size: number;
  readonly BT: number;
  private w = 1;
  private h = 1;
  private raf = 0;
  private anims: Anim[] = [];
  private continuous = 0;
  private active = true;
  private disposed = false;
  private view: ViewMode = { kind: 'top' };
  private camFrom: { pos: Vector3; quat: Quaternion; fov: number } | null = null;
  private camTween: { t0: number; dur: number; to: { pos: Vector3; quat: Quaternion; fov: number } } | null = null;
  /** Called after every frame (overlay labels follow the camera). */
  onFrame: (() => void) | null = null;

  private board!: Mesh;
  private lines!: Mesh;
  private stoneMesh: Record<StoneColor, InstancedMesh>;
  private stoneAt = new Int8Array(0);
  /** Instance slot of each point's stone, per colour. */
  private slot = new Int16Array(0);
  private stoneGeo: Record<StoneColor, BufferGeometry>;
  private stoneMat: Record<StoneColor, MeshPhysicalMaterial>;
  private ao!: InstancedMesh;
  private ghost: Record<StoneColor, MeshPhysicalMaterial>;
  private hoverMesh: Mesh | null = null;
  private glow = new Group();
  private candGroup = new Group();
  private ownMesh: InstancedMesh[] = [];
  private varGroup = new Group();
  private paleGroup = new Group();
  private paleMats = new Map<string, MeshPhysicalMaterial>();
  private ownMats = new Map<string, Material>();
  private faceMats = new Map<Texture, MeshBasicMaterial>();
  private faceGeos: Partial<Record<StoneColor, PlaneGeometry>> = {};
  private hoverMats: Partial<Record<StoneColor, MeshPhysicalMaterial>> = {};
  /** The shadow map is redrawn only when something that casts a shadow may have moved. */
  private shadowsDirty = true;
  /** Shaders still compiling: no frame until they are done (see precompile). */
  private compiling = true;
  private warmFace: MeshBasicMaterial | null = null;
  private resolveDrawn: () => void = () => undefined;
  /** Settles once the first frame is on the canvas. */
  readonly drawn = new Promise<void>((r) => (this.resolveDrawn = r));
  private beam: Mesh<CylinderGeometry, MeshBasicMaterial> | null = null;
  private beamLoc: Loc = -1;
  private cands = new Map<Loc, CandFx>();
  private candAnim = false;
  private motes: Points<BufferGeometry, PointsMaterial> | null = null;
  private wave: { lines: Mesh<BufferGeometry, ShaderMaterial>; wood: Mesh<PlaneGeometry, ShaderMaterial>; t0: number; dur: number; max: number } | null = null;
  private pulses: { mesh: Mesh; t0: number; period: number; base: number }[] = [];
  private sunLight: DirectionalLight;
  private fx: number;
  private under: Mesh<PlaneGeometry, MeshBasicMaterial> | null = null;
  readonly pillarH: number;
  private ripples: boolean;
  /** Keep drawing for the pulses and motes (at most ~45 frames a second) while on screen. */
  private ambient = false;
  private lastDraw = 0;
  private lastNow = 0;
  private tmpM = new Matrix4();
  private tmpQ = new Quaternion();
  private tmpV = new Vector3();
  private tmpS = new Vector3();
  private ray = new Raycaster();
  private lite: boolean;

  constructor(o: KayaOptions) {
    this.size = o.size;
    this.BT = o.thickness ?? 0.06;
    this.fx = o.fx ?? 1;
    this.pillarH = o.pillars ?? 0;
    const lite = !!o.lite;
    this.lite = lite;
    this.renderer = new WebGLRenderer({ canvas: o.canvas, antialias: true, alpha: true, powerPreference: lite ? 'low-power' : 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = (o.toneMapping === 'aces' ? ACESFilmicToneMapping : AgXToneMapping) as ToneMapping;
    this.renderer.toneMappingExposure = o.exposure ?? 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    // redrawn only when a shadow caster may have moved (see shadowsDirty): hovering, the camera
    // easing and the labels moving leave the light and its casters where they were
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1.5 : 2));

    const sunDir = o.sun ?? { elev: 48, azim: 135 };
    const pm = new PMREMGenerator(this.renderer);
    const sky = skyTexture(sunDir.elev, sunDir.azim);
    this.scene.environment = pm.fromEquirectangular(sky).texture;
    this.scene.environmentIntensity = o.envIntensity ?? 0.85;
    sky.dispose();
    pm.dispose();

    const se = MathUtils.degToRad(sunDir.elev), sa = MathUtils.degToRad(sunDir.azim);
    this.sunLight = new DirectionalLight(0xfff3e4, o.sunStrength ?? 2.6);
    this.sunLight.position.set(Math.cos(se) * Math.cos(sa), Math.sin(se), -Math.cos(se) * Math.sin(sa)).multiplyScalar(2);
    this.sunLight.castShadow = true;
    const sh = this.sunLight.shadow;
    sh.mapSize.set(lite ? 1024 : 2048, lite ? 1024 : 2048);
    sh.camera.left = -0.6;
    sh.camera.right = 0.6;
    sh.camera.top = 0.6;
    sh.camera.bottom = -0.6;
    sh.camera.near = 0.5;
    sh.camera.far = 4;
    sh.bias = -0.0004;
    sh.normalBias = 0.0006;
    sh.radius = 3;
    this.scene.add(this.sunLight, this.sunLight.target);
    this.scene.add(this.set);

    this.stoneGeo = { 1: stoneGeometry(STONE_B.d, STONE_B.t, 48), 2: stoneGeometry(STONE_W.d, STONE_W.t, 48) };
    this.stoneMat = {
      1: new MeshPhysicalMaterial({ color: 0x0c0d0f, roughness: 0.22, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.07, specularIntensity: 0.9 }),
      2: new MeshPhysicalMaterial({ color: 0xf4eadb, map: tex('shell.webp'), roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.25, sheenColor: new Color(0xfff6ea), sheenRoughness: 0.5 }),
    };
    this.ghost = {
      1: new MeshPhysicalMaterial({ color: 0x10161d, roughness: 0.2, clearcoat: 0.6, transparent: true, opacity: 0.82, emissive: new Color(0x0a5a7c), emissiveIntensity: 0.5 }),
      2: new MeshPhysicalMaterial({ color: 0xf2f7fa, roughness: 0.22, clearcoat: 0.6, transparent: true, opacity: 0.85, emissive: new Color(0x1f8fbf), emissiveIntensity: 0.22 }),
    };
    this.stoneMesh = { 1: this.instStones(1), 2: this.instStones(2) };
    this.ripples = o.ripples ?? true;
    this.buildBoard(o.shadowCatcher ?? false, WOOD[o.wood ?? 'kaya']);
    this.set.add(this.paleGroup);
    if (o.bowls) this.buildBowls();
    if (o.stage === 'void') this.buildVoid();
    if (o.table) this.buildTable();
    if (o.fill) this.scene.add(new HemisphereLight(0xfff4e6, 0xd9d2c6, o.fill));
    if (o.skyUrl) this.loadSky(o.skyUrl, o.envIntensity ?? 0.85, o.skyTurn ?? 0);
    this.set.add(this.glow);
    this.glow.add(this.candGroup, this.varGroup);
    this.resizeArrays();
    liveViews.add(this);
    this.precompile();
  }

  // ---------------------------------------------------------------- building

  private instStones(c: StoneColor): InstancedMesh {
    const m = new InstancedMesh(this.stoneGeo[c], this.stoneMat[c], 400);
    m.count = 0;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    this.set.add(m);
    return m;
  }

  /** Board-space position of a point (x across from the left, y down from the top row). */
  pointAt(loc: Loc, lift = 0, out = new Vector3()): Vector3 {
    const n = this.size;
    const x = loc % n, y = Math.floor(loc / n);
    return out.set((x - (n - 1) / 2) * SX, this.BT + lift, (y - (n - 1) / 2) * SY);
  }

  private buildBoard(catcher: boolean, wood: (typeof WOOD)[BoardWood]) {
    const n = this.size;
    const W = (n - 1) * SX + 2 * MX, L = (n - 1) * SY + 2 * MY, T = this.BT;
    const g = new RoundedBoxGeometry(W, T, L, 4, 0.0036);
    // the top texture is cut to this board's size from a 19x19 board's top
    const fx = W / 0.424, fy = L / 0.454;
    const top = tex(`${wood.prefix}kaya-top.webp`, true, `n${n}`);
    top.repeat.set(fx, fy);
    top.offset.set((1 - fx) / 2, (1 - fy) / 2);
    const bump = tex('kaya-bump.webp', false, `n${n}`);
    bump.repeat.copy(top.repeat);
    bump.offset.copy(top.offset);
    // an oiled, almost matte finish, as on the reference board: a bright sky must not veil the wood's colour
    const topMat = new MeshPhysicalMaterial({ map: top, color: wood.tint, bumpMap: bump, bumpScale: 0.35, roughness: 0.62, clearcoat: 0.05, clearcoatRoughness: 0.5, specularIntensity: 0.18 });
    const front = new MeshPhysicalMaterial({ map: tex(`${wood.prefix}kaya-front.webp`), roughness: 0.66, specularIntensity: 0.3 });
    const side = new MeshPhysicalMaterial({ map: tex(`${wood.prefix}kaya-side.webp`), roughness: 0.66, specularIntensity: 0.3 });
    const under = new MeshPhysicalMaterial({ color: 0x6b4120, roughness: 0.9 });
    // BoxGeometry groups: +x, -x, +y, -y, +z, -z
    this.board = new Mesh(g, [side, side, topMat, under, front, front]);
    this.board.position.y = T / 2;
    this.board.receiveShadow = true;
    this.board.castShadow = true;
    this.set.add(this.board);

    // lacquered lines and star points, a hair above the wood
    const quads: number[] = [];
    const quad = (x0: number, z0: number, x1: number, z1: number) => quads.push(x0, z0, x1, z1);
    const ox = ((n - 1) / 2) * SX, oz = ((n - 1) / 2) * SY;
    for (let i = 0; i < n; i++) {
      const w = i === 0 || i === n - 1 ? FRAME : LINE;
      const x = -ox + i * SX;
      quad(x - w / 2, -oz - FRAME / 2, x + w / 2, oz + FRAME / 2);
      const z = -oz + i * SY;
      quad(-ox - FRAME / 2, z - w / 2, ox + FRAME / 2, z + w / 2);
    }
    const pos: number[] = [];
    for (let k = 0; k < quads.length; k += 4) {
      const [x0, z0, x1, z1] = quads.slice(k, k + 4);
      pos.push(x0, 0, z0, x0, 0, z1, x1, 0, z1, x0, 0, z0, x1, 0, z1, x1, 0, z0);
    }
    const hoshi = n === 19 ? [3, 9, 15] : n === 13 ? [3, 6, 9] : n === 9 ? [2, 4, 6] : [];
    const r = 0.002;
    for (const hx of hoshi)
      for (const hy of hoshi) {
        if (n === 9 && (hx === 4) !== (hy === 4)) continue;
        const cx = -ox + hx * SX, cz = -oz + hy * SY;
        for (let a = 0; a < 24; a++) {
          const a0 = (a / 24) * Math.PI * 2, a1 = ((a + 1) / 24) * Math.PI * 2;
          pos.push(cx, 0, cz, cx + r * Math.cos(a1), 0, cz + r * Math.sin(a1), cx + r * Math.cos(a0), 0, cz + r * Math.sin(a0));
        }
      }
    const lg = new BufferGeometry();
    lg.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    lg.computeVertexNormals();
    const nrm = lg.getAttribute('normal') as BufferAttribute;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    const lm = new MeshPhysicalMaterial({ color: wood.lines, roughness: 0.62, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: DoubleSide });
    this.lines = new Mesh(lg, lm);
    this.lines.position.y = T + 0.00004;
    this.lines.receiveShadow = true;
    this.set.add(this.lines);

    // a soft dark spot under each stone where it touches the wood, a little down and right of it (the
    // light comes from the upper left), so a stone seen straight down still stands on the board
    const aoMat = new MeshBasicMaterial({ color: 0x000000, map: glowTexture(), transparent: true, opacity: 0.46, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const aoGeo = new PlaneGeometry(SX * 1.3, SX * 1.3).rotateX(-Math.PI / 2);
    this.ao = new InstancedMesh(aoGeo, aoMat, 800);
    this.ao.count = 0;
    this.ao.frustumCulled = false;
    this.ao.position.y = T + 0.00008;
    this.set.add(this.ao);

    if (catcher) {
      const c = new Mesh(new PlaneGeometry(4, 4).rotateX(-Math.PI / 2), new ShadowMaterial({ opacity: 0.44 }));
      c.receiveShadow = true;
      c.position.y = 0.0002;
      this.scene.add(c);
    }
  }

  /**
   * The landing's table: a pillar of honed white marble (tools/kiai-art/marble.py) a hand wider
   * than the board, standing out of sight far below, so the cloud sea shows all round it.
   */
  private buildTable() {
    const top = tex('marble.webp', true, 'top');
    top.wrapS = top.wrapT = RepeatWrapping;
    top.repeat.set(1 / 1.2, 1 / 1.2);
    const side = tex('marble.webp', true, 'side');
    side.wrapS = side.wrapT = RepeatWrapping;
    side.repeat.set(1 / 1.2, 3 / 1.2);
    const look = { roughness: 0.42, clearcoat: 0.15, clearcoatRoughness: 0.3, specularIntensity: 0.45 };
    const topMat = new MeshPhysicalMaterial({ map: top, ...look });
    const sideMat = new MeshPhysicalMaterial({ map: side, ...look });
    const g = new RoundedBoxGeometry(0.64, 3, 0.66, 3, 0.006);
    // BoxGeometry groups: +x, -x, +y, -y, +z, -z
    const pillar = new Mesh(g, [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
    pillar.position.set(0, -1.5, 0.02);
    pillar.receiveShadow = true;
    this.scene.add(pillar);
  }

  /** The panorama as the world: background and light (see KayaOptions.skyUrl). */
  private loadSky(url: string, env: number, turn: number) {
    loader.load(url, (t) => {
      if (this.disposed) {
        t.dispose();
        return;
      }
      t.colorSpace = SRGBColorSpace;
      t.mapping = EquirectangularReflectionMapping;
      this.scene.background = t;
      this.scene.backgroundRotation.y = MathUtils.degToRad(turn);
      const pm = new PMREMGenerator(this.renderer);
      this.scene.environment = pm.fromEquirectangular(t).texture;
      this.scene.environmentIntensity = env;
      this.scene.environmentRotation.y = MathUtils.degToRad(turn);
      pm.dispose();
      this.skyReady = true;
      this.onSky?.();
      this.invalidate();
    });
  }
  /** True once the panorama is in; `onSky` is called when it arrives. */
  skyReady = false;
  onSky: (() => void) | null = null;

  private buildBowls() {
    const wood = new MeshPhysicalMaterial({ map: tex('bowl.webp'), roughness: 0.5, clearcoat: 0.85, clearcoatRoughness: 0.14, specularIntensity: 0.45 });
    const prof = BOWL.map(([r, z]) => new Vector2(r, z));
    const lathe = new LatheGeometry(prof, 96);
    // two bowls behind the board, near Blender's (tools/kiai-art/hero.py; the black one pulled in so a wide crop keeps it whole), not turned with it
    const spots: [number, number, StoneColor, number][] = [
      [0.17, 0.335, 2, 2],
      [0.36, 0.15, 1, 3],
    ];
    for (const [bx, by, c, seed] of spots) {
      const bowl = new Mesh(lathe, wood);
      bowl.castShadow = true;
      bowl.receiveShadow = true;
      bowl.position.set(bx, 0, -by);
      this.scene.add(bowl);
      // a full bowl: a bed of stones up to the rim and a heap domed just above it, so it reads as full from a low camera
      const bed = new Mesh(new CircleGeometry(0.058, 40).rotateX(-Math.PI / 2), this.stoneMat[c]);
      bed.position.set(bx, 0.05, -by);
      this.scene.add(bed);
      const heap = new InstancedMesh(this.stoneGeo[c], this.stoneMat[c], 140);
      heap.castShadow = true;
      heap.receiveShadow = true;
      let k = 0;
      const rnd = (i: number) => hash(i * 97 + seed * 1013);
      // [height, how far from the middle a stone's centre may sit (the wall less a stone's radius)]
      const layers: [number, number][] = [[0.052, 0.046], [0.058, 0.045], [0.064, 0.043], [0.07, 0.039], [0.076, 0.03], [0.082, 0.018], [0.087, 0.006]];
      for (const [y, rmax] of layers) {
        const ringN = Math.floor(6 + rmax * 360);
        for (let i = 0; i < ringN && k < 140; i++, k++) {
          const a = rnd(k) * Math.PI * 2, rr = rmax * Math.sqrt(rnd(k + 500));
          this.tmpQ.setFromAxisAngle(this.tmpV.set(rnd(k + 9) - 0.5, 0, rnd(k + 19) - 0.5).normalize(), (rnd(k + 29) - 0.5) * 0.9);
          this.tmpM.compose(this.tmpS.set(bx + rr * Math.cos(a), y + rnd(k + 39) * 0.003, -by + rr * Math.sin(a)), this.tmpQ, new Vector3(1, 1, 1));
          heap.setMatrixAt(k, this.tmpM);
        }
      }
      heap.count = k;
      heap.instanceMatrix.needsUpdate = true;
      this.scene.add(heap);
    }
  }

  private resizeArrays() {
    const n = this.size * this.size;
    this.stoneAt = new Int8Array(n);
    this.slot = new Int16Array(n).fill(-1);
  }

  // ---------------------------------------------------------------- stones

  private stoneMatrix(loc: Loc, c: StoneColor, lift = 0, scale = 1): Matrix4 {
    const p = this.pointAt(loc, lift, this.tmpV);
    // real stones never sit dead centre, and the shell's stripes turn with each stone
    p.x += (hash(loc * 3 + 1) - 0.5) * 0.0012;
    p.z += (hash(loc * 3 + 2) - 0.5) * 0.0012;
    this.tmpQ.setFromAxisAngle(new Vector3(0, 1, 0), hash(loc * 7 + c) * Math.PI * 2);
    return this.tmpM.compose(p, this.tmpQ, this.tmpS.set(scale, scale, scale));
  }

  private rebuildInstances() {
    const n = this.size * this.size;
    const count: Record<StoneColor, number> = { 1: 0, 2: 0 };
    let a = 0;
    this.slot.fill(-1);
    for (let l = 0; l < n; l++) {
      const c = this.stoneAt[l] as StoneColor | 0;
      if (!c) continue;
      const k = count[c]++;
      this.slot[l] = k;
      this.stoneMesh[c].setMatrixAt(k, this.stoneMatrix(l, c));
      const p = this.pointAt(l, 0, this.tmpV);
      this.ao.setMatrixAt(a++, this.tmpM.makeTranslation(p.x + 0.0019, 0, p.z + 0.0024));
    }
    for (const c of [1, 2] as StoneColor[]) {
      this.stoneMesh[c].count = count[c];
      this.stoneMesh[c].instanceMatrix.needsUpdate = true;
    }
    this.ao.count = a;
    this.ao.instanceMatrix.needsUpdate = true;
  }

  /**
   * The stones on the board. With `animate`, one or two new stones drop in and captured stones
   * lift away; bigger jumps (stepping far through a game) just appear.
   */
  setStones(stones: ArrayLike<number>, animate = true) {
    const n = this.size * this.size;
    const added: Loc[] = [];
    const removed: { loc: Loc; c: StoneColor }[] = [];
    for (let l = 0; l < n; l++) {
      const was = this.stoneAt[l], now = (stones[l] ?? 0) as number;
      if (was === now) continue;
      if (was) removed.push({ loc: l, c: was as StoneColor });
      if (now) added.push(l);
    }
    if (!added.length && !removed.length) return;
    for (let l = 0; l < n; l++) this.stoneAt[l] = (stones[l] ?? 0) as number;
    this.rebuildInstances();
    if (animate && added.length <= 2 && added.length + removed.length <= 40) {
      for (const l of added) {
        this.animateDrop(l, this.stoneAt[l] as StoneColor);
        if (this.ripples) window.setTimeout(() => !this.disposed && this.ripple(l, 0xd8f4ff, 1.8, 750, 0.45), 210);
      }
      for (const r of removed) this.animateCapture(r.loc, r.c);
    }
    this.invalidate();
  }

  /** Drop one or more stones in, one after another (the landing's opening). */
  cascade(locs: Loc[], gapMs = 45, ripples = true) {
    const now = performance.now();
    locs.forEach((l, i) => {
      this.animateDrop(l, this.stoneAt[l] as StoneColor, now + i * gapMs);
      if (ripples) window.setTimeout(() => !this.disposed && this.ripple(l, 0xd8f4ff, 1.6, 700, 0.4), i * gapMs + 210);
    });
    this.invalidate();
  }

  private animateDrop(loc: Loc, c: StoneColor, start = performance.now()) {
    if (!c) return;
    const k = this.slot[loc];
    const mesh = this.stoneMesh[c];
    const dur = 340;
    // hidden above the board until its turn
    mesh.setMatrixAt(k, this.stoneMatrix(loc, c, 0.05, 0.0001));
    mesh.instanceMatrix.needsUpdate = true;
    this.anims.push({
      step: (now) => {
        if (this.slot[loc] !== k || this.stoneAt[loc] !== c) return false;
        const t = Math.min(1, Math.max(0, (now - start) / dur));
        if (now < start) return true;
        mesh.setMatrixAt(k, this.stoneMatrix(loc, c, 0.03 * dropCurve(t), 1));
        mesh.instanceMatrix.needsUpdate = true;
        return t < 1;
      },
    });
  }

  private animateCapture(loc: Loc, c: StoneColor) {
    const m = new Mesh(this.stoneGeo[c], this.stoneMat[c].clone());
    const mat = m.material as MeshPhysicalMaterial;
    mat.transparent = true;
    m.applyMatrix4(this.stoneMatrix(loc, c));
    this.set.add(m);
    const t0 = performance.now(), dur = 380;
    const y0 = m.position.y;
    this.anims.push({
      step: (now) => {
        const t = Math.min(1, (now - t0) / dur);
        m.position.y = y0 + 0.02 * easeOut(t);
        mat.opacity = 1 - t;
        if (t >= 1) {
          this.set.remove(m);
          mat.dispose();
          return false;
        }
        return true;
      },
    });
  }

  /** A see-through stone where the next move would go. */
  setHover(loc: Loc | null, c: StoneColor | null) {
    if (loc === null || !c || this.stoneAt[loc]) {
      if (this.hoverMesh) {
        this.set.remove(this.hoverMesh);
        this.hoverMesh = null;
        this.invalidate(false);
      }
      return;
    }
    if (!this.hoverMesh || this.hoverMesh.userData.c !== c) {
      if (this.hoverMesh) this.set.remove(this.hoverMesh);
      // the ghost stone casts no shadow, so moving it leaves the shadow map alone
      this.hoverMesh = new Mesh(this.stoneGeo[c], this.hoverMat(c));
      this.hoverMesh.userData.c = c;
      this.set.add(this.hoverMesh);
    }
    this.hoverMesh.matrixAutoUpdate = false;
    this.hoverMesh.matrix.copy(this.stoneMatrix(loc, c));
    this.invalidate(false);
  }

  // ---------------------------------------------------------------- KataGo's reading, as light

  /** A soft round glow; laid over the wood unblended (`add` false) it tints it instead of bleaching it. */
  private glowMat(color: number, opacity = 1, add = true): MeshBasicMaterial {
    return new MeshBasicMaterial({ color, map: glowTexture(), transparent: true, opacity, blending: add ? AdditiveBlending : NormalBlending, depthWrite: false });
  }

  private clearGroup(g: Group, keep: Material[] = []) {
    for (const c of [...g.children]) {
      g.remove(c);
      const m = c as Mesh;
      if (m.geometry !== this.stoneGeo[1] && m.geometry !== this.stoneGeo[2]) m.geometry?.dispose();
      const mat = m.material as Material | Material[] | undefined;
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) if (!keep.includes(x)) x.dispose();
    }
  }

  /**
   * Candidate moves, each a dial of light: a dark glass lens (so the light reads on pale wood),
   * a faint track, a lit arc for its share of KataGo's visits and a soft halo. KataGo's choice
   * is cyan and gets a beam with motes rising in it. When the read changes, the dials ease to
   * their new values; a new favourite sends out a ripple. `reveal` grows new ones in, best first.
   */
  setCandidates(cands: CandGlow[] | null, reveal = true) {
    const now = performance.now();
    const want = new Map<Loc, CandGlow>();
    for (const c of cands ?? []) if (!this.stoneAt[c.loc] && !want.has(c.loc)) want.set(c.loc, c);
    let order = 0;
    for (const [loc, fx] of this.cands) {
      if (want.has(loc)) continue;
      this.retarget(fx, { ...fx.cur, on: 0 }, now, 0);
    }
    const sorted = [...want.values()].sort((a, b) => a.rank - b.rank);
    for (const c of sorted) {
      const best = c.rank === 0 ? 1 : 0;
      const look: CandLook = {
        on: 1,
        strength: best ? 1 : c.ghost ? 0.05 : 0.45 + 0.55 * Math.sqrt(MathUtils.clamp(c.share, 0, 1)),
        share: best ? 1 : MathUtils.clamp(c.share, 0.04, 1),
        best,
        col: new Color(best ? C_BEST : c.ghost ? C_GHOST : c.badness > 0.6 ? C_BAD : c.badness > 0.3 ? C_MID : C_GOOD),
      };
      let fx = this.cands.get(c.loc);
      if (!fx) {
        fx = this.makeCand(c.loc);
        const start = { ...look, on: 0, share: 0, col: look.col.clone() };
        fx.cur = { ...start, col: start.col.clone() };
        this.retarget(fx, look, now, reveal ? order++ * 70 : 0, start);
        if (!reveal) this.applyCand(fx, (fx.cur = { ...look, col: look.col.clone() }));
      } else this.retarget(fx, look, now, 0);
    }
    // the beam follows KataGo's choice
    const top = sorted.find((c) => c.rank === 0)?.loc ?? -1;
    if (top !== this.beamLoc) {
      if (this.beam) {
        this.fadeAway(this.beam, 350);
        this.beam = null;
      }
      if (top >= 0 && !this.pillarH) {
        const p = this.pointAt(top, 0.0003);
        const h = 0.12 * this.fx;
        const beam = new Mesh(
          new CylinderGeometry(SX * 0.34, SX * 0.46, h, 40, 1, true).translate(0, h / 2, 0),
          new MeshBasicMaterial({ color: C_BEST, map: beamTexture(), transparent: true, opacity: 0.5 * this.beamK(), blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
        );
        beam.position.copy(p);
        beam.renderOrder = 5;
        this.beam = beam;
        this.glow.add(beam);
        if (reveal || this.beamLoc >= 0) this.grow([beam], now + (this.beamLoc >= 0 ? 0 : 120), 700, true);
      }
      if (top >= 0 && this.beamLoc >= 0) this.ripple(top, C_BEST, 2.6);
      this.beamLoc = top;
      this.setMotes(top);
    }
    this.startCandAnim();
    this.invalidate();
  }

  private makeCand(loc: Loc): CandFx {
    const g = new Group();
    const lens = new Mesh(new CircleGeometry(SX * 0.45, 48).rotateX(-Math.PI / 2), new MeshBasicMaterial({ transparent: true, depthWrite: false }));
    const ringGeo = () => new RingGeometry(SX * 0.36, SX * (0.36 + 0.12 * Math.min(1.4, this.fx)), DIAL_SEGS, 1, Math.PI / 2, Math.PI * 2).rotateX(-Math.PI / 2).scale(-1, 1, 1);
    const track = new Mesh(ringGeo(), new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide }));
    const arc = new Mesh(ringGeo(), new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide }));
    const hs = SX * 2.1 * this.fx;
    // the pool of light on the wood: cyan laid over it, not added (added to orange wood, cyan turns a warm white)
    const halo = new Mesh(new PlaneGeometry(hs, hs).rotateX(-Math.PI / 2), this.glowMat(C_BEST, 0, false));
    halo.renderOrder = 1;
    lens.renderOrder = 2;
    track.renderOrder = 3;
    arc.renderOrder = 3;
    track.position.y = arc.position.y = 0.00005;
    halo.position.y = 0.0001;
    g.add(lens, track, arc, halo);
    let pillar: CandFx['pillar'] = null, cap: CandFx['cap'] = null, core: CandFx['core'] = null, bloom: CandFx['bloom'] = null, flare: CandFx['flare'] = null;
    if (this.pillarH) {
      pillar = new Mesh(new CylinderGeometry(SX * 0.46, SX * 0.46, 1, 32, 1, true).translate(0, 0.5, 0), new MeshBasicMaterial({ map: pillarTexture(), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
      core = new Mesh(new CylinderGeometry(SX * 0.21, SX * 0.21, 1, 24, 1, true).translate(0, 0.5, 0), new MeshBasicMaterial({ map: coreTexture(), transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }));
      cap = new Mesh(new RingGeometry(SX * 0.2, SX * 0.4, 40).rotateX(-Math.PI / 2), new MeshBasicMaterial({ transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
      const spr = () => new Sprite(new SpriteMaterial({ map: glowTexture(), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
      bloom = spr();
      flare = spr();
      pillar.renderOrder = 5;
      core.renderOrder = 5;
      cap.renderOrder = 6;
      bloom.renderOrder = 6;
      flare.renderOrder = 7;
      g.add(bloom, core, pillar, cap, flare);
    }
    g.position.copy(this.pointAt(loc, 0.0003));
    this.candGroup.add(g);
    const blank: CandLook = { on: 0, strength: 0, share: 0, best: 0, col: new Color(C_GOOD) };
    const fx: CandFx = { loc, g, lens, track, arc, halo, pillar, cap, core, bloom, flare, from: blank, to: blank, cur: blank, t0: 0, delay: 0 };
    this.cands.set(loc, fx);
    return fx;
  }

  private retarget(fx: CandFx, to: CandLook, now: number, delay: number, from?: CandLook) {
    fx.from = from ?? { ...fx.cur, col: fx.cur.col.clone() };
    fx.to = to;
    fx.t0 = now;
    fx.delay = delay;
  }

  private applyCand(fx: CandFx, k: CandLook) {
    const s = Math.max(0.0001, k.on);
    fx.g.scale.setScalar(s * (1 + 0.12 * Math.sin(Math.min(1, k.on) * Math.PI)));
    fx.lens.material.color.copy(LENS).lerp(LENS_BEST, k.best);
    fx.lens.material.opacity = ((0.88 + 0.08 * k.strength) * (1 - k.best) + 0.95 * k.best) * Math.min(1, k.on);
    fx.track.material.color.copy(k.col);
    fx.track.material.opacity = (0.18 + 0.14 * k.strength) * Math.min(1, k.on);
    fx.arc.material.color.copy(k.col);
    fx.arc.material.opacity = Math.min(1, k.strength + 0.45) * Math.min(1, k.on);
    fx.arc.geometry.setDrawRange(0, Math.round(DIAL_SEGS * MathUtils.clamp(k.share, 0, 1)) * 6);
    fx.halo.material.color.copy(k.col);
    fx.halo.material.opacity = ((this.pillarH ? 0.32 : 0.3) * k.strength * (1 - k.best) + (this.pillarH ? 0.4 : 0.55) * k.best) * Math.min(1, k.on);
    if (fx.pillar && fx.cap && fx.core && fx.bloom && fx.flare) {
      const on = Math.min(1, k.on);
      const h = Math.max(0.0005, this.pillarH * Math.max(0.05, k.share) * on);
      const lit = Math.min(1, k.strength + 0.35) * on;
      fx.pillar.scale.set(1, h / s, 1);
      fx.pillar.material.color.copy(k.col);
      fx.pillar.material.opacity = (0.3 + 0.34 * k.best) * lit;
      fx.core.scale.set(1, h / s, 1);
      // only the favourite's core runs toward white; the others keep their blue, so their tops never read as stones
      fx.core.material.color.copy(k.col).lerp(WHITE, 0.08 + 0.22 * k.best);
      fx.core.material.opacity = (0.62 + 0.33 * k.best) * lit;
      fx.cap.position.y = h / s;
      fx.cap.material.color.copy(k.col);
      fx.cap.material.opacity = Math.min(1, k.strength + 0.25) * on;
      // the bloom: a soft glow round the column's upper part (kept off the stones at its foot) and a flare at its top
      fx.bloom.position.y = (h / s) * 0.62;
      fx.bloom.scale.set(SX * (0.95 + 0.4 * k.best) * this.fx, (h / s) * 0.8 + SX, 1);
      fx.bloom.material.color.copy(k.col);
      fx.bloom.material.opacity = (0.18 + 0.16 * k.best) * lit;
      fx.flare.position.y = h / s;
      // kept small: a big flare washes out the tag that stands on the column's top
      const fs = SX * (0.9 + 0.7 * k.best) * this.fx;
      fx.flare.scale.set(fs, fs, 1);
      fx.flare.material.color.copy(k.col);
      fx.flare.material.opacity = (0.35 + 0.3 * k.best) * lit;
    }
  }

  /** The beam's strength for this view: faint when the board is seen straight down. */
  private beamK(): number {
    const v = this.view;
    return v.kind === 'top' && (v.tilt ?? 0) < 8 ? 0.3 : 1;
  }

  /** How high a candidate's column stands now (metres above the wood), for labels on top of it. */
  pillarTop(loc: Loc): number {
    const fx = this.cands.get(loc);
    if (!fx || !fx.pillar) return 0;
    return this.pillarH * Math.max(0.05, fx.to.share) * Math.min(1, fx.to.on);
  }

  private startCandAnim() {
    if (this.candAnim) return;
    this.candAnim = true;
    const dur = 480;
    this.anims.push({
      step: (now) => {
        let busy = false;
        for (const [loc, fx] of this.cands) {
          const t = MathUtils.clamp((now - fx.t0 - fx.delay) / dur, 0, 1);
          const k = easeInOut(t);
          const a = fx.from, b = fx.to;
          fx.cur = {
            on: a.on + (b.on - a.on) * (b.on > a.on ? easeOut(t) : k),
            strength: a.strength + (b.strength - a.strength) * k,
            share: a.share + (b.share - a.share) * k,
            best: a.best + (b.best - a.best) * k,
            col: fx.cur.col.copy(a.col).lerp(b.col, k),
          };
          this.applyCand(fx, fx.cur);
          if (t < 1) busy = true;
          else if (b.on === 0) {
            this.candGroup.remove(fx.g);
            for (const m of [fx.lens, fx.track, fx.arc, fx.halo, fx.pillar, fx.cap, fx.core]) {
              if (!m) continue;
              m.geometry.dispose();
              m.material.dispose();
            }
            fx.bloom?.material.dispose();
            fx.flare?.material.dispose();
            this.cands.delete(loc);
          }
        }
        if (!busy) this.candAnim = false;
        return busy;
      },
    });
  }

  /** Motes of light rising in the beam over KataGo's choice. */
  private setMotes(loc: Loc) {
    if (this.motes) {
      this.fadeAway(this.motes, 350);
      this.motes = null;
    }
    if (loc < 0) return;
    const N = this.lite ? 16 : 30;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(N * 3), 3));
    const m = new Points(g, new PointsMaterial({ size: 0.0032 * this.fx, map: glowTexture(), vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    m.position.copy(this.pointAt(loc, 0));
    m.renderOrder = 6;
    m.frustumCulled = false;
    this.motes = m;
    this.glow.add(m);
    this.stepMotes(performance.now());
  }

  private stepMotes(now: number) {
    const m = this.motes;
    if (!m) return;
    const pos = m.geometry.getAttribute('position') as BufferAttribute;
    const col = m.geometry.getAttribute('color') as BufferAttribute;
    const c = new Color(C_BEST);
    const H = this.pillarH ? this.pillarH * 1.15 : 0.1 * this.fx;
    for (let i = 0; i < pos.count; i++) {
      const t = (now / 3200 + hash(i)) % 1;
      const a = hash(i + 50) * Math.PI * 2 + t * 2.2;
      const r = SX * (0.12 + 0.3 * hash(i + 90)) * (1 - 0.4 * t);
      pos.setXYZ(i, Math.cos(a) * r, 0.002 + t * H, Math.sin(a) * r);
      const f = Math.sin(Math.PI * t) * (0.5 + 0.5 * hash(i + 7));
      col.setXYZ(i, c.r * f, c.g * f, c.b * f);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  /** A ring of light spreading from a point, as when a stone lands or KataGo changes its mind. */
  ripple(loc: Loc, color: number = 0xbfefff, cells = 2.4, dur = 900, opacity = 0.6) {
    const size = SX * 2 * cells * this.fx;
    const m = new Mesh(new PlaneGeometry(size, size).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color, map: ringTexture(), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
    m.position.copy(this.pointAt(loc, this.stoneAt[loc] ? 0.0002 : 0.0004));
    m.renderOrder = 7;
    this.glow.add(m);
    const t0 = performance.now();
    this.anims.push({
      step: (now) => {
        const t = Math.min(1, (now - t0) / dur);
        m.scale.setScalar(0.12 + 0.88 * easeOut(t));
        m.material.opacity = opacity * Math.pow(1 - t, 1.6);
        if (t >= 1) {
          this.glow.remove(m);
          m.geometry.dispose();
          m.material.dispose();
          return false;
        }
        return true;
      },
    });
    this.invalidate();
  }

  /**
   * A ping: a ring of light runs out from a point (or the centre) across the board, lighting
   * the grid lines as it passes. Marks the start of a read. `soft` lights only the lines, more
   * faintly (the app's flat board, where a band of light over the wood reads as a smear).
   */
  ping(loc: Loc | null = null, dur = 1500, soft = false) {
    if (!this.wave) {
      const lines = new Mesh(this.lines.geometry, waveMaterial(0.006, 1.6));
      lines.position.y = this.BT + 0.0001;
      lines.renderOrder = 6;
      const W = (this.size - 1) * SX + 2 * MX, L = (this.size - 1) * SY + 2 * MY;
      const wood = new Mesh(new PlaneGeometry(W, L).rotateX(-Math.PI / 2), waveMaterial(0.02, 0.28));
      wood.position.y = this.BT + 0.00012;
      wood.renderOrder = 6;
      this.set.add(lines, wood);
      this.wave = { lines, wood, t0: 0, dur, max: 0 };
    }
    const w = this.wave;
    const c = loc === null ? new Vector3(0, 0, 0) : this.pointAt(loc, 0);
    for (const m of [w.lines, w.wood]) m.material.uniforms.uC.value.set(c.x, c.z);
    const half = new Vector2(((this.size - 1) / 2) * SX + MX, ((this.size - 1) / 2) * SY + MY);
    w.max = Math.hypot(half.x + Math.abs(c.x), half.y + Math.abs(c.z));
    w.t0 = performance.now();
    w.dur = dur;
    const run = w.t0;
    this.anims.push({
      step: (now) => {
        if (w.t0 !== run) return false;
        const t = Math.min(1, (now - w.t0) / w.dur);
        const r = w.max * easeOut(t);
        const a = Math.min(1, t * 6) * Math.pow(1 - t, 0.8);
        w.lines.material.uniforms.uA.value = a * (soft ? 0.55 : 1);
        w.wood.material.uniforms.uA.value = soft ? 0 : a;
        for (const m of [w.lines, w.wood]) m.material.uniforms.uR.value = r;
        return t < 1;
      },
    });
    this.invalidate();
  }

  /** Two sparks of light running round the board's edge (the board waking up). */
  edgeSweep(dur = 1700) {
    const W = (this.size - 1) * SX + 2 * MX, L = (this.size - 1) * SY + 2 * MY;
    const hx = W / 2 - 0.0035, hz = L / 2 - 0.0035, y = this.BT + 0.0005;
    const corners = [new Vector3(-hx, y, -hz), new Vector3(hx, y, -hz), new Vector3(hx, y, hz), new Vector3(-hx, y, hz)];
    const segs = 360;
    for (const start of [0, 2]) {
      const path = new CurvePath<Vector3>();
      for (let i = 0; i < 4; i++) path.add(new LineCurve3(corners[(start + i) % 4], corners[(start + i + 1) % 4]));
      const geo = new TubeGeometry(path, segs, 0.0007 * this.fx, 5, false);
      const m = new Mesh(geo, new MeshBasicMaterial({ color: 0x7fe6ff, transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false }));
      m.renderOrder = 7;
      this.set.add(m);
      const per = 5 * 6;
      const win = Math.floor(segs * 0.16);
      const t0 = performance.now();
      geo.setDrawRange(0, 0);
      this.anims.push({
        step: (now) => {
          const t = Math.min(1, (now - t0) / dur);
          // the spark runs half way round (its partner does the other half), then fades
          const head = Math.floor(easeInOut(t) * (segs / 2 + win));
          const tail = Math.max(0, head - win);
          geo.setDrawRange(tail * per, (Math.min(head, segs) - tail) * per);
          m.material.opacity = 0.95 * (t < 0.85 ? 1 : (1 - t) / 0.15);
          if (t >= 1) {
            this.set.remove(m);
            geo.dispose();
            m.material.dispose();
            return false;
          }
          return true;
        },
      });
    }
    this.invalidate();
  }

  /** The dark stage: a cool light from behind the board, and a soft glow under it. */
  private buildVoid() {
    const rim = new DirectionalLight(0x6fd4ff, 1.4);
    rim.position.set(-0.6, 0.5, -1.2);
    this.scene.add(rim);
    const W = (this.size - 1) * SX + 2 * MX, L = (this.size - 1) * SY + 2 * MY;
    const under = new Mesh(new PlaneGeometry(W * 2.2, L * 2.2).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0x1590c8, map: glowTexture(), transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false }));
    under.position.y = -0.004;
    this.set.add(under);
    this.under = under;
  }

  /** How strongly the void stage glows under the board (0 on a light page, where it would wash out). */
  setUnderglow(k: number, ms = 1200) {
    const u = this.under;
    if (!u) return;
    const from = u.material.opacity, to = 0.55 * k, t0 = performance.now();
    this.anims.push({
      step: (now) => {
        const t = Math.min(1, (now - t0) / ms);
        u.material.opacity = from + (to - from) * easeInOut(t);
        return t < 1;
      },
    });
    this.invalidate();
  }

  /** Fade one light out and drop it (its geometry and material are its own). */
  private fadeAway(m: Mesh | Points, ms: number) {
    const mat = m.material as MeshBasicMaterial;
    const base = mat.opacity, t0 = performance.now();
    this.anims.push({
      step: (now) => {
        const t = Math.min(1, (now - t0) / ms);
        mat.opacity = base * (1 - t);
        if (t < 1) return true;
        m.parent?.remove(m);
        m.geometry.dispose();
        mat.dispose();
        return false;
      },
    });
    this.invalidate();
  }

  /** Let all of KataGo's reading fade off the board: candidates, territory, a line, highlights. */
  fadeOut(ms = 600) {
    this.setCandidates(null);
    const t0 = performance.now();
    const own = this.ownMesh;
    this.ownMesh = [];
    const hl = this.pulses.filter((p) => p.mesh.userData.hl).map((p) => p.mesh);
    this.pulses = this.pulses.filter((p) => !p.mesh.userData.hl);
    const vars = [...this.varGroup.children] as Mesh[];
    this.varGroup = new Group();
    this.glow.add(this.varGroup);
    const mats = new Map<Material & { opacity: number }, number>();
    // the fading territory takes its materials with it; the next territory makes fresh ones
    this.ownMats.clear();
    for (const m of [...own, ...hl, ...vars]) {
      const ms = (Array.isArray(m.material) ? m.material : [m.material]) as (Material & { opacity: number })[];
      for (const x of ms) if (!mats.has(x)) mats.set(x, x.opacity);
    }
    this.anims.push({
      step: (now) => {
        const t = Math.min(1, (now - t0) / ms);
        for (const [x, o] of mats) x.opacity = o * (1 - t);
        if (t < 1) return true;
        for (const m of [...own, ...hl, ...vars]) {
          m.parent?.remove(m);
          if (m.geometry !== this.stoneGeo[1] && m.geometry !== this.stoneGeo[2]) m.geometry.dispose();
        }
        // the glass stones share their material: put it back for the next line
        for (const [x, o] of mats) {
          if (x === this.ghost[1] || x === this.ghost[2]) x.opacity = o;
          else x.dispose();
        }
        return false;
      },
    });
    this.invalidate();
  }

  /**
   * Territory, as Go programs show it: a square on each point sized by how sure KataGo is,
   * dark for Black and light for White, revealed by a scan of light across the board. `scale`
   * makes the squares larger (the landing, seen from afar).
   */
  setOwnership(own: ArrayLike<number> | null, reveal = true, scale = 1) {
    // the materials are kept (ownMat): ownership changes with every KataGo update, and a disposed
    // material's shader would be compiled again for the next one
    for (const m of this.ownMesh) {
      this.glow.remove(m);
      m.geometry.dispose();
    }
    this.ownMesh = [];
    if (!own) {
      this.invalidate();
      return;
    }
    const n = this.size * this.size;
    const cells: { loc: Loc; s: number; h: number; mesh: InstancedMesh; k: number; pad: InstancedMesh | null }[] = [];
    // seen from the side (columns on), territory stands up as a relief of glass blocks, one per
    // point and nearly touching, so each side's area reads as one terraced region: the surer the
    // point, the taller its block, in three clear steps (likely, sure, settled)
    const relief = this.pillarH > 0;
    // rounded corners, so the relief reads as glass tiles rather than toy bricks
    const geo = relief ? new RoundedBoxGeometry(SX, 1, SY, 2, SX * 0.2).translate(0, 0.5, 0) : new PlaneGeometry(SX, SX).rotateX(-Math.PI / 2);
    const meshes = ([1, 2] as StoneColor[]).map((side) => {
      const mat = relief
        ? this.ownMat(`true|${side}`, () => new MeshStandardMaterial({ map: tileTexture(), color: side === 1 ? 0x0f5f98 : 0xdcecff, emissive: side === 1 ? 0x18aaf2 : 0xa8dcff, emissiveMap: tileTexture(), emissiveIntensity: side === 1 ? 1.35 : 1.3, roughness: 0.2, transparent: true, opacity: side === 1 ? 0.92 : 0.88, depthWrite: false }))
        : this.ownFlatMat(side);
      const m = new InstancedMesh(geo, mat, n);
      m.count = 0;
      m.frustumCulled = false;
      m.renderOrder = 1;
      return m;
    });
    // standing blocks cast a soft pool of their own light on the wood
    const pads = relief
      ? ([1, 2] as StoneColor[]).map((side) => {
          const m = new InstancedMesh(new PlaneGeometry(SX * 1.5, SX * 1.5).rotateX(-Math.PI / 2), this.ownMat(`pad|${side}`, () => new MeshBasicMaterial({ color: side === 1 ? 0x1aa8f0 : 0xbfe6ff, map: glowTexture(), transparent: true, opacity: side === 1 ? 0.5 : 0.42, blending: AdditiveBlending, depthWrite: false })), n);
          m.count = 0;
          m.frustumCulled = false;
          m.renderOrder = 1;
          return m;
        })
      : [];
    for (let l = 0; l < n; l++) {
      const o = own[l] ?? 0;
      const a = Math.abs(o);
      const side: StoneColor = o > 0 ? 1 : 2;
      // a block standing on a stone (even a dead one) hides it, so the relief leaves every stone clear
      if (a < 0.2 || (relief ? this.stoneAt[l] : this.stoneAt[l] === side)) continue;
      const s = Math.min(1, (a - 0.2) / 0.7);
      const mesh = meshes[side - 1];
      const k = mesh.count++;
      if (relief) pads[side - 1].count++;
      const tier = s < 0.4 ? 0.22 : s < 0.8 ? 0.55 : 1;
      cells.push({ loc: l, s: relief ? 0.94 : Math.min(0.9, (0.22 + 0.36 * Math.sqrt(s)) * scale), h: relief ? (0.0018 + 0.019 * tier) * this.fx : 1, mesh, k, pad: relief ? pads[side - 1] : null });
    }
    const place = (sweep: number) => {
      for (const c of cells) {
        const x = (c.loc % this.size) / (this.size - 1);
        const k = MathUtils.clamp((sweep - x) / 0.18, 0, 1);
        const e = easeOut(k);
        this.tmpM.compose(this.pointAt(c.loc, relief ? 0.0002 : 0.0007, this.tmpV), this.tmpQ.identity(), this.tmpS.set(c.s * e + 0.0001, relief ? c.h * (k * k * (3 - 2 * k)) + 0.00001 : 1, c.s * e + 0.0001));
        c.mesh.setMatrixAt(c.k, this.tmpM);
        if (c.pad) {
          this.tmpM.compose(this.pointAt(c.loc, 0.00015, this.tmpV), this.tmpQ.identity(), this.tmpS.set(e + 0.0001, 1, e + 0.0001));
          c.pad.setMatrixAt(c.k, this.tmpM);
        }
      }
      for (const m of [...meshes, ...pads]) m.instanceMatrix.needsUpdate = true;
    };
    for (const m of [...pads, ...meshes]) this.glow.add(m);
    this.ownMesh = [...meshes, ...pads];
    if (!reveal) {
      place(2);
      this.invalidate();
      return;
    }
    place(-1);
    // the scan: a thin sheet of light crossing the board, left to right
    const half = ((this.size - 1) / 2) * SY + MY;
    const scan = new Mesh(new PlaneGeometry(SX * 0.5, half * 2).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0x7fe4ff, map: glowTexture(), transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }));
    scan.scale.set(3, 1, 1);
    scan.renderOrder = 6;
    this.glow.add(scan);
    const t0 = performance.now(), dur = 1100;
    const xw = ((this.size - 1) / 2) * SX + MX;
    this.anims.push({
      step: (now) => {
        const t = Math.min(1, (now - t0) / dur);
        const sweep = -0.1 + 1.3 * easeInOut(t);
        place(sweep);
        scan.position.set(-xw + 2 * xw * MathUtils.clamp(sweep, 0, 1), this.BT + 0.0006, 0);
        (scan.material as MeshBasicMaterial).opacity = 0.9 * Math.sin(Math.PI * t);
        if (t >= 1) {
          this.glow.remove(scan);
          scan.geometry.dispose();
          (scan.material as Material).dispose();
          return false;
        }
        return true;
      },
    });
    this.invalidate();
  }

  /**
   * A line of play: glass stones that rise in order, joined by arcs of light. `stepMs` paces
   * them (0 = all at once).
   */
  setVariation(moves: { loc: Loc; color: StoneColor }[] | null, stepMs = 0) {
    this.clearGroup(this.varGroup, [this.ghost[1], this.ghost[2]]);
    if (!moves?.length) {
      this.invalidate();
      return;
    }
    const now = performance.now();
    const seen = new Set<Loc>();
    const pts: Vector3[] = [];
    moves.forEach((m, i) => {
      if (seen.has(m.loc) || m.loc < 0) return;
      seen.add(m.loc);
      const over = !!this.stoneAt[m.loc];
      const g = new Mesh(this.stoneGeo[m.color], this.ghost[m.color]);
      g.applyMatrix4(this.stoneMatrix(m.loc, m.color, over ? 0.0095 : 0.0012));
      this.varGroup.add(g);
      const rim = new Mesh(new PlaneGeometry(SX * 1.7 * this.fx, SX * 1.7 * this.fx).rotateX(-Math.PI / 2), this.glowMat(0x3ccfff, 0.5));
      rim.position.copy(this.pointAt(m.loc, 0.0005));
      this.varGroup.add(rim);
      pts.push(this.pointAt(m.loc, 0.012));
      if (stepMs) this.grow([g, rim], now + i * stepMs, 300, false, true);
    });
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const mid = a.clone().add(b).multiplyScalar(0.5);
      mid.y += 0.004 + a.distanceTo(b) * 0.18;
      const curve = new CatmullRomCurve3([a, mid, b]);
      const tube = new Mesh(new TubeGeometry(curve, 32, 0.0011 * this.fx, 6, false), new MeshBasicMaterial({ color: 0xbff3ff, transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false }));
      // and a wide faint tube round it: the line's glow
      const haze = new Mesh(new TubeGeometry(curve, 32, 0.0042 * this.fx, 8, false), new MeshBasicMaterial({ color: 0x2fc6ff, transparent: true, opacity: 0.3, blending: AdditiveBlending, depthWrite: false }));
      tube.renderOrder = haze.renderOrder = 6;
      this.varGroup.add(haze, tube);
      if (stepMs) {
        this.drawOn(tube, now + i * stepMs - stepMs * 0.4, stepMs * 0.8);
        this.drawOn(haze, now + i * stepMs - stepMs * 0.4, stepMs * 0.8);
      }
    }
    this.invalidate();
  }

  /**
   * Translucent stones with numbers on their faces (see PaleMark). Replaces what was shown;
   * null clears. If the site's font has not loaded yet, they are drawn again once it has.
   */
  setPale(marks: PaleMark[] | null) {
    // materials and the number planes are kept and reused (see paleMat): disposing them would
    // drop their compiled shaders, and the next update (several a second while KataGo reads)
    // would compile them again
    const castBefore = this.paleGroup.children.some((o) => o.castShadow);
    this.paleGroup.clear();
    if (marks?.length && typeof document !== 'undefined' && document.fonts && !numberFontReady) {
      numberFontReady = document.fonts.load('800 64px "Alegreya Sans"').then(
        () => {
          // redraw the printed numbers in place, now in the real face
          numberTex.forEach((t) => {
            const u = t.userData as { text: string; ink: string };
            drawNumber(t.image as HTMLCanvasElement, u.text, u.ink);
            t.needsUpdate = true;
          });
          liveViews.forEach((v) => v.invalidate(false));
        },
        () => undefined,
      );
    }
    const seen = new Set<Loc>();
    for (const m of marks ?? []) {
      if (m.loc < 0 || seen.has(m.loc)) continue;
      seen.add(m.loc);
      // a mark on a point that already has a stone (a line that recaptures) sits on top of it
      const over = this.stoneAt[m.loc] ? 0.0095 : 0;
      const black = m.color === 1 && !m.cream;
      const color = black ? 0x101113 : m.cream ? 0xf7f0e3 : 0xf4eadb;
      const stone = new Mesh(this.stoneGeo[m.color], this.paleMat(color, m.alpha));
      stone.applyMatrix4(this.stoneMatrix(m.loc, m.color, over));
      stone.renderOrder = 4;
      // a solid one is a real stone with its number printed on it: it casts its shadow too
      stone.castShadow = m.alpha >= 0.99;
      this.paleGroup.add(stone);
      if (!m.text) continue;
      const map = numberTexture(m.text, black ? '#f3eee4' : '#17140f');
      let faceMat = this.faceMats.get(map);
      if (!faceMat) this.faceMats.set(map, (faceMat = new MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false })));
      const face = new Mesh(this.faceGeo(m.color), faceMat);
      face.position.copy(this.pointAt(m.loc, over + (m.color === 1 ? STONE_B : STONE_W).t + 0.0003));
      face.renderOrder = 5;
      this.paleGroup.add(face);
    }
    // only solid marks cast shadows, so see-through candidates leave the shadow map as it is
    this.invalidate(castBefore || this.paleGroup.children.some((o) => o.castShadow));
  }

  private ownMat(key: string, make: () => Material): Material {
    let m = this.ownMats.get(key);
    if (!m) this.ownMats.set(key, (m = make()));
    return m;
  }

  private hoverMat(c: StoneColor): MeshPhysicalMaterial {
    let mat = this.hoverMats[c];
    if (!mat) {
      mat = this.hoverMats[c] = this.stoneMat[c].clone();
      mat.transparent = true;
      mat.opacity = 0.5;
      mat.depthWrite = false;
    }
    return mat;
  }

  /** The flat territory squares' material (the app's 2D-style ownership), one per side. */
  private ownFlatMat(side: StoneColor): Material {
    return this.ownMat(`false|${side}`, () => new MeshBasicMaterial({ color: side === 1 ? 0x061423 : 0xffffff, map: squareTexture(), transparent: true, opacity: side === 1 ? 0.58 : 0.78, depthWrite: false }));
  }

  /**
   * Compile every shader the board needs before its first frame, off the main thread where the
   * browser can (KHR_parallel_shader_compile), including the ones that only appear later
   * (hover stone, candidates, numbers, territory). Compiling them on first use froze the page
   * for a moment each time; on a slow GPU, for seconds.
   */
  private precompile() {
    const warm = new Scene();
    const g = this.stoneGeo[1];
    warm.add(new Mesh(g, this.hoverMat(1)), new Mesh(g, this.hoverMat(2)), new Mesh(g, this.paleMat(0xf7f0e3, 0.86)));
    this.warmFace = new MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, toneMapped: false });
    warm.add(new Mesh(g, this.warmFace));
    if (!this.pillarH) for (const side of [1, 2] as const) warm.add(new InstancedMesh(g, this.ownFlatMat(side), 1));
    const r = this.renderer;
    Promise.all([r.compileAsync(this.scene, this.camera), r.compileAsync(warm, this.camera, this.scene)])
      .catch(() => undefined)
      .then(() => {
        this.compiling = false;
        this.invalidate();
      });
  }

  /** One material per colour and opacity, kept for the view's life (a handful at most). */
  private paleMat(color: number, alpha: number): MeshPhysicalMaterial {
    const key = `${color}|${alpha}`;
    let mat = this.paleMats.get(key);
    if (!mat) {
      mat = new MeshPhysicalMaterial({ color, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.2, transparent: true, opacity: alpha, depthWrite: alpha > 0.8 });
      this.paleMats.set(key, mat);
    }
    return mat;
  }

  /** The plane a number is printed on, one per stone size. */
  private faceGeo(c: StoneColor): PlaneGeometry {
    let g = this.faceGeos[c];
    if (!g) {
      const d = (c === 1 ? STONE_B : STONE_W).d * 0.96;
      g = this.faceGeos[c] = new PlaneGeometry(d, d).rotateX(-Math.PI / 2);
    }
    return g;
  }

  /** Pulsing rings on a few points (the move a question is about). */
  setHighlights(locs: Loc[], color = 0xffffff) {
    for (const p of this.pulses.filter((x) => x.mesh.userData.hl)) {
      this.glow.remove(p.mesh);
      p.mesh.geometry.dispose();
      (p.mesh.material as Material).dispose();
    }
    this.pulses = this.pulses.filter((x) => !x.mesh.userData.hl);
    const now = performance.now();
    for (const l of locs) {
      const lift = this.stoneAt[l] ? STONE_B.t + 0.0006 : 0.0005;
      const ring = new Mesh(new RingGeometry(SX * 0.44, SX * 0.5, 48).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false }));
      ring.position.copy(this.pointAt(l, lift));
      ring.userData.hl = true;
      this.glow.add(ring);
      this.pulses.push({ mesh: ring, t0: now, period: 1400, base: 1 });
      this.grow([ring], now, 360);
    }
    this.invalidate();
  }

  private grow(meshes: Object3D[], start: number, dur: number, vertical = false, rise = false) {
    const base = meshes.map((m) => ({ m, s: m.scale.clone(), y: m.position.y }));
    for (const b of base) b.m.scale.set(vertical ? b.s.x : 0.0001, vertical ? 0.0001 : b.s.y, vertical ? b.s.z : 0.0001);
    this.anims.push({
      step: (now) => {
        if (now < start) return true;
        const t = Math.min(1, (now - start) / dur);
        const k = easeOut(t);
        for (const b of base) {
          if (vertical) b.m.scale.set(b.s.x, Math.max(0.0001, k), b.s.z);
          else b.m.scale.setScalar(Math.max(0.0001, k * (1 + 0.12 * Math.sin(t * Math.PI))));
          if (rise) b.m.position.y = b.y + 0.01 * (1 - k);
        }
        return t < 1;
      },
    });
  }

  private drawOn(tube: Mesh, start: number, dur: number) {
    const g = tube.geometry as BufferGeometry;
    const total = g.index ? g.index.count : 0;
    g.setDrawRange(0, 0);
    this.anims.push({
      step: (now) => {
        if (now < start) return true;
        const t = Math.min(1, (now - start) / dur);
        g.setDrawRange(0, Math.floor((easeInOut(t) * total) / 3) * 3);
        return t < 1;
      },
    });
  }

  // ---------------------------------------------------------------- camera

  /** Fit or move the camera; `ms` eases to the new view. */
  setView(v: ViewMode, ms = 0) {
    this.view = v;
    const to = this.cameraFor(v);
    if (ms > 0 && this.w > 1) {
      this.camFrom = { pos: this.camera.position.clone(), quat: this.camera.quaternion.clone(), fov: this.camera.fov };
      this.camTween = { t0: performance.now(), dur: ms, to };
    } else {
      this.camTween = null;
      this.applyCam(to);
    }
    this.invalidate(false);
  }

  /**
   * For an orbit view: the distance and off-centre shifts that make the whole board (its top and
   * its foot) fill `box` (left, top, right, bottom as fractions of the canvas) as fully as it can
   * without leaving it. The owner can then keep the board clear of words laid over the canvas.
   */
  fitOrbit(v: { elev: number; azim: number; target?: [number, number, number]; fov?: number }, box: [number, number, number, number]): { dist: number; shift: number; shiftY: number } {
    const n = this.size;
    const hw = ((n - 1) * SX + 2 * MX) / 2, hl = ((n - 1) * SY + 2 * MY) / 2;
    const pts: Vector3[] = [];
    for (const x of [-hw, hw]) for (const y of [0, this.BT]) for (const z of [-hl, hl]) pts.push(new Vector3(x, y, z));
    const cam = new PerspectiveCamera(v.fov ?? 26, this.w / Math.max(1, this.h), 0.01, 50);
    const tgt = new Vector3(...(v.target ?? [0, this.BT, 0]));
    const el = MathUtils.degToRad(v.elev), az = MathUtils.degToRad(v.azim);
    const dir = new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    const q = new Vector3();
    const bounds = (dist: number) => {
      cam.position.copy(tgt).addScaledVector(dir, dist);
      cam.lookAt(tgt);
      cam.updateMatrixWorld();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of pts) {
        q.copy(p).project(cam);
        x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
      }
      return { x0, x1, y0, y1 };
    };
    const bw = 2 * Math.max(0.01, box[2] - box[0]), bh = 2 * Math.max(0.01, box[3] - box[1]);
    let dist = 1;
    for (let i = 0; i < 5; i++) {
      const b = bounds(dist);
      dist *= Math.max((b.x1 - b.x0) / bw, (b.y1 - b.y0) / bh);
    }
    const b = bounds(dist);
    // the box's centre and the board's, in normalised device coordinates (y up)
    const bx = box[0] + box[2] - 1, by = 1 - (box[1] + box[3]);
    return { dist, shift: (bx - (b.x0 + b.x1) / 2) / 2, shiftY: (by - (b.y0 + b.y1) / 2) / 2 };
  }

  private applyCam(c: { pos: Vector3; quat: Quaternion; fov: number }) {
    this.camera.position.copy(c.pos);
    this.camera.quaternion.copy(c.quat);
    this.camera.fov = c.fov;
    this.camera.updateProjectionMatrix();
  }

  private cameraFor(v: ViewMode): { pos: Vector3; quat: Quaternion; fov: number } {
    const aspect = this.w / this.h;
    const n = this.size;
    if (v.kind === 'plate') {
      const c = v.cam;
      const hfov = 2 * Math.atan(c.sensor / 2 / c.lens);
      const vfov = 2 * Math.atan(Math.tan(hfov / 2) * (c.height / c.width));
      // the plate's whole frame sets the projection; the view offset picks the part on screen
      this.camera.aspect = c.width / c.height;
      this.camera.setViewOffset(c.width, c.height, v.crop.x, v.crop.y, v.crop.w, v.crop.h);
      const pos = new Vector3(c.loc[0], c.loc[2], -c.loc[1]);
      const tgt = new Vector3(c.target[0], c.target[2], -c.target[1]);
      const m = new Matrix4().lookAt(pos, tgt, new Vector3(0, 1, 0));
      return { pos, quat: new Quaternion().setFromRotationMatrix(m), fov: MathUtils.radToDeg(vfov) };
    }
    this.camera.clearViewOffset();
    this.camera.aspect = aspect;
    if (v.kind === 'orbit') {
      const fov = v.fov ?? 26;
      const tgt = new Vector3(...(v.target ?? [0, this.BT, 0]));
      const half = (((n - 1) / 2) * SY + MY) * 1.05;
      const dist = v.dist ?? (half / Math.tan(MathUtils.degToRad(fov) / 2)) * 1.15 * Math.max(1, 1.1 / aspect);
      const el = MathUtils.degToRad(v.elev), az = MathUtils.degToRad(v.azim);
      const pos = new Vector3(tgt.x + dist * Math.cos(el) * Math.sin(az), tgt.y + dist * Math.sin(el), tgt.z + dist * Math.cos(el) * Math.cos(az));
      const m = new Matrix4().lookAt(pos, tgt, new Vector3(0, 1, 0));
      // `shift` moves the board off centre (a fraction of the width), leaving room for text;
      // `shiftY` moves it up (a fraction of the height), for text below it on a phone
      if (v.shift || v.shiftY) this.camera.setViewOffset(this.w, this.h, -(v.shift ?? 0) * this.w, (v.shiftY ?? 0) * this.h, this.w, this.h);
      return { pos, quat: new Quaternion().setFromRotationMatrix(m), fov };
    }
    // straight down (or leaning back by `tilt` degrees, so the board's front edge shows as it does
    // on a table), fitted to the board or a crop of it plus a margin for the coordinates
    const fov = 20;
    const crop = v.crop ?? { x0: 0, y0: 0, x1: n - 1, y1: n - 1 };
    const pad = v.pad ?? 0;
    const cx = ((crop.x0 + crop.x1) / 2 - (n - 1) / 2) * SX;
    const cz = ((crop.y0 + crop.y1) / 2 - (n - 1) / 2) * SY;
    const whole = !v.crop;
    const hw = ((crop.x1 - crop.x0) / 2) * SX + (whole ? MX : SX * 0.7) + pad * SX;
    const hh = ((crop.y1 - crop.y0) / 2) * SY + (whole ? MY : SY * 0.7) + pad * SY;
    const t = Math.tan(MathUtils.degToRad(fov) / 2);
    const tilt = MathUtils.degToRad(v.tilt ?? 0);
    const look = (dist: number, shiftZ: number) => {
      const tgt = new Vector3(cx, this.BT, cz + shiftZ);
      const pos = new Vector3(cx, this.BT + dist * Math.cos(tilt), cz + shiftZ + dist * Math.sin(tilt));
      const m = new Matrix4().lookAt(pos, tgt, new Vector3(0, 0, -1));
      return { pos, quat: new Quaternion().setFromRotationMatrix(m), fov };
    };
    let dist = Math.max(hh / t, hw / (t * aspect));
    if (!tilt) return look(dist, 0);
    // leaning: project the corners (with the front face for a whole board), then rescale and recentre
    const pts = [
      new Vector3(cx - hw, this.BT, cz - hh), new Vector3(cx + hw, this.BT, cz - hh),
      new Vector3(cx - hw, this.BT, cz + hh), new Vector3(cx + hw, this.BT, cz + hh),
    ];
    if (whole) pts.push(new Vector3(cx - hw, 0, cz + hh), new Vector3(cx + hw, 0, cz + hh));
    const cam = this.camera.clone();
    cam.aspect = aspect;
    cam.fov = fov;
    let shift = 0;
    for (let i = 0; i < 3; i++) {
      const c = look(dist, shift);
      cam.position.copy(c.pos);
      cam.quaternion.copy(c.quat);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of pts) {
        const q = p.clone().project(cam);
        x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
      }
      const span = Math.max((x1 - x0) / 2, (y1 - y0) / 2);
      dist *= span;
      // move the aim so the board sits in the middle of the frame (y is up on screen, z toward the viewer)
      shift -= ((y0 + y1) / 2) * hh * 1.1;
    }
    return look(dist, shift);
  }

  // ---------------------------------------------------------------- picking and projecting

  /**
   * Screen position (CSS px, relative to the canvas) of a point, `lift` metres above the wood,
   * optionally moved by (dx, dy) grid cells (coordinates sit outside the grid).
   */
  project(loc: Loc, lift = 0, dx = 0, dy = 0): { x: number; y: number } {
    const p = this.pointAt(loc, lift, this.tmpV);
    p.x += dx * SX;
    p.z += dy * SY;
    this.set.updateMatrixWorld();
    this.set.localToWorld(p);
    p.project(this.camera);
    return { x: ((p.x + 1) / 2) * this.w, y: ((1 - p.y) / 2) * this.h };
  }

  /** Grid coordinates (fractional) under a CSS pixel of the canvas, or null off the board plane. */
  gridAt(px: number, py: number): { gx: number; gy: number } | null {
    this.ray.setFromCamera(new Vector2((px / this.w) * 2 - 1, -(py / this.h) * 2 + 1), this.camera);
    const o = this.ray.ray;
    const inv = new Matrix4().copy(this.set.matrixWorld).invert();
    const origin = o.origin.clone().applyMatrix4(inv);
    const dir = o.direction.clone().transformDirection(inv);
    if (Math.abs(dir.y) < 1e-6) return null;
    const t = (this.BT - origin.y) / dir.y;
    if (t < 0) return null;
    const x = origin.x + dir.x * t, z = origin.z + dir.z * t;
    const n = this.size;
    return { gx: x / SX + (n - 1) / 2, gy: z / SY + (n - 1) / 2 };
  }

  // ---------------------------------------------------------------- frame loop

  setSize(w: number, h: number) {
    if (w < 2 || h < 2) return;
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.setView(this.view);
  }

  /** Keep drawing every frame (a pulsing best move) for this many ms; 0 stops at once. */
  keepAlive(ms: number) {
    this.continuous = ms > 0 ? performance.now() + ms : 0;
    this.invalidate();
  }

  /** Off: draw nothing (the board is off screen or the tab hidden); on: catch up with one frame. */
  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    if (on) this.invalidate(false);
    else if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.lastNow = 0;
    }
  }

  /** Draw a frame soon. `shadows` false: nothing that casts a shadow moved (hover, camera). */
  invalidate(shadows = true) {
    if (shadows) this.shadowsDirty = true;
    if (this.disposed || this.raf || !this.active) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (this.disposed || this.compiling) return;
    const dt = this.lastNow ? Math.min(100, now - this.lastNow) : 16;
    this.lastNow = now;
    const busy = this.anims.length > 0 || !!this.camTween;
    const live = this.continuous > now || this.ambient;
    // ambient motion alone (pulses, motes, a slow orbit) runs at up to ~45 frames a second
    if (!busy && live && now - this.lastDraw < (this.lite ? 32 : 21)) {
      this.invalidate(false);
      return;
    }
    this.lastDraw = now;
    const stepped = this.anims.length > 0;
    this.anims = this.anims.filter((a) => a.step(now));
    if (this.camTween && this.camFrom) {
      const t = Math.min(1, (now - this.camTween.t0) / this.camTween.dur);
      const k = easeInOut(t);
      const to = this.camTween.to;
      this.camera.position.lerpVectors(this.camFrom.pos, to.pos, k);
      this.camera.quaternion.slerpQuaternions(this.camFrom.quat, to.quat, k);
      const fov = this.camFrom.fov + (to.fov - this.camFrom.fov) * k;
      if (fov !== this.camera.fov) {
        this.camera.fov = fov;
        this.camera.updateProjectionMatrix();
      }
      if (t >= 1) this.camTween = null;
    } else if (live && this.view.kind === 'orbit' && this.view.spin) {
      this.view = { ...this.view, azim: this.view.azim + (this.view.spin * dt) / 1000 };
      this.applyCam(this.cameraFor(this.view));
    }
    if (live) {
      for (const p of this.pulses) {
        const k = 1 + 0.16 * Math.sin(((now - p.t0) / p.period) * Math.PI * 2);
        if (p.mesh.scale.x > 0.5) p.mesh.scale.setScalar(p.base * k);
      }
      if (this.beam) this.beam.material.opacity = (0.42 + 0.14 * Math.sin((now / 1800) * Math.PI * 2)) * this.beamK();
      for (const fx of this.cands.values())
        if (fx.cur.best > 0.5 && fx.cur.on >= 1) {
          const k = Math.sin((now / 1800) * Math.PI * 2);
          fx.halo.scale.setScalar(1 + 0.14 * k);
          if (fx.flare) fx.flare.material.opacity = 0.9 * (0.82 + 0.18 * k);
        }
      this.stepMotes(now);
    }
    // animations and ambient motion may move casters (a dropping stone, pulsing rings), so they redraw shadows
    if (this.shadowsDirty || stepped || live) this.renderer.shadowMap.needsUpdate = true;
    this.shadowsDirty = false;
    this.renderer.render(this.scene, this.camera);
    this.resolveDrawn();
    this.onFrame?.();
    if (this.anims.length || this.camTween || live) this.invalidate(false);
  };

  /** Keep the board gently alive (pulsing best move, motes, a slow orbit) while it is on screen. */
  setAmbient(on: boolean) {
    this.ambient = on;
    if (on) this.invalidate();
  }

  /** Render once now (for tests and screenshots). */
  renderNow() {
    this.compiling = false;
    this.frame(performance.now());
  }

  dispose() {
    this.disposed = true;
    liveViews.delete(this);
    if (this.raf) cancelAnimationFrame(this.raf);
    // geometries, materials, this view's sky light and shadow map; the textures shared by all views
    // (wood, shell, glow, printed numbers) stay for the next board
    const mats = new Set<Material>([...this.paleMats.values(), ...this.faceMats.values(), ...this.ownMats.values()]);
    if (this.warmFace) mats.add(this.warmFace);
    for (const c of [1, 2] as const) {
      this.faceGeos[c]?.dispose();
      const h = this.hoverMats[c];
      if (h) mats.add(h);
    }
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as Material | Material[] | undefined;
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) mats.add(x);
    });
    mats.forEach((m) => m.dispose());
    this.scene.environment?.dispose();
    this.sunLight.shadow.dispose();
    this.renderer.dispose();
  }
}
