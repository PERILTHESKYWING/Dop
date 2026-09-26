/*
 * ArtKit: the shared toolbox of the procedural theme paintings (sakura.html, mist.html, aurora.html).
 * Seeded PRNG and gradient noise, OKLab colour ramps, float image buffers with blur and bilinear
 * sampling, Canvas layer compositing, bloom, tone mapping, film grain and budgeted WebP encoding.
 * Most of it is lifted from meadow.html (which keeps its own copy so the sunrise never changes).
 * Everything is deterministic and needs no network or external assets.
 */
'use strict';
const ArtKit = (() => {

// ------------------------------------------------------------------ math
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => { let t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
const sq = (x) => x * x;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng) { return (rng() + rng() + rng() + rng() - 2) * 1.732; }
function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
const GX = new Float32Array(256), GY = new Float32Array(256);
for (let i = 0; i < 256; i++) { const a = (i + 0.5) / 256 * TAU; GX[i] = Math.cos(a); GY[i] = Math.sin(a); }

// Gradient (Perlin) noise, range ~[-1, 1].
function perlin(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi, s) & 255, b = hash2(xi + 1, yi, s) & 255;
  const c = hash2(xi, yi + 1, s) & 255, d = hash2(xi + 1, yi + 1, s) & 255;
  const n00 = GX[a] * xf + GY[a] * yf, n10 = GX[b] * (xf - 1) + GY[b] * yf;
  const n01 = GX[c] * xf + GY[c] * (yf - 1), n11 = GX[d] * (xf - 1) + GY[d] * (yf - 1);
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const x0 = n00 + u * (n10 - n00), x1 = n01 + u * (n11 - n01);
  return (x0 + v * (x1 - x0)) * 1.4142;
}
// Same, periodic in x with integer period P.
function perlinP(x, y, s, P) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const x0 = ((xi % P) + P) % P, x1 = (x0 + 1) % P;
  const a = hash2(x0, yi, s) & 255, b = hash2(x1, yi, s) & 255;
  const c = hash2(x0, yi + 1, s) & 255, d = hash2(x1, yi + 1, s) & 255;
  const n00 = GX[a] * xf + GY[a] * yf, n10 = GX[b] * (xf - 1) + GY[b] * yf;
  const n01 = GX[c] * xf + GY[c] * (yf - 1), n11 = GX[d] * (xf - 1) + GY[d] * (yf - 1);
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const x0v = n00 + u * (n10 - n00), x1v = n01 + u * (n11 - n01);
  return (x0v + v * (x1v - x0v)) * 1.4142;
}
// 1D gradient noise.
function noise1(x, s) { return perlin(x, 0.37, s); }
function fbm1(x, oct, s, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) { sum += amp * perlin(x * f + i * 7.7, 0.37 + i * 3.1, s + i * 131); norm += amp; amp *= gain; f *= 2.03; }
  return sum / norm;
}
const RC = Math.cos(0.62), RS = Math.sin(0.62);
// fBm with per-octave rotation; `oct` may be fractional (level of detail).
function fbm(x, y, oct, s, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0;
  const n = Math.ceil(oct);
  for (let i = 0; i < n; i++) {
    let w = amp;
    if (i === n - 1 && oct < n) w *= oct - (n - 1);
    sum += w * perlin(x, y, s + i * 131);
    norm += amp;
    const nx = (x * RC - y * RS) * 2.03 + 17.13, ny = (x * RS + y * RC) * 2.03 - 5.71;
    x = nx; y = ny; amp *= gain;
  }
  return sum / norm;
}
// Periodic fBm (period P cells at octave 0, lacunarity exactly 2).
function fbmP(x, y, oct, s, gain, P) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    sum += amp * perlinP(x * f, y * f + i * 7.31, s + i * 131, P * f);
    norm += amp; amp *= gain; f *= 2;
  }
  return sum / norm;
}
// Ridged multifractal-ish noise in [0, 1] (sharp crests).
function ridged(x, y, oct, s, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, prev = 1;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(perlin(x, y, s + i * 131));
    n *= n;
    sum += n * amp * (0.5 + 0.5 * prev); norm += amp;
    prev = n;
    const nx = (x * RC - y * RS) * 2.03 + 17.13, ny = (x * RS + y * RC) * 2.03 - 5.71;
    x = nx; y = ny; amp *= gain;
  }
  return sum / norm;
}
// Axis-aligned fBm with per-axis footprint filtering (distant surfaces at grazing angles).
function fbmA(x, y, fx, fy, oct, s, gain) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    norm += amp;
    const cy = fy * f;
    if (cy < 0.4) {
      const cx = fx * f;
      let sx = 1, a = amp * (cy > 0.25 ? (0.4 - cy) / 0.15 : 1);
      if (cx > 0.4) { sx = 0.4 / cx; a *= Math.sqrt(sx); }
      sum += a * perlin(x * f * sx + i * 17.3, y * f + i * 5.1, s + i * 131);
    }
    amp *= gain; f *= 2;
  }
  return sum / norm;
}

// ------------------------------------------------------------------ colour
function s2l(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function l2s(c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
function hexLin(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return [s2l(((n >> 16) & 255) / 255), s2l(((n >> 8) & 255) / 255), s2l((n & 255) / 255)];
}
function linToOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
          1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
          0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function oklabToLin(L, a, b) {
  const l = L + 0.3963377774 * a + 0.2158037573 * b;
  const m = L - 0.1055613458 * a - 0.0638541728 * b;
  const s = L - 0.0894841775 * a - 1.2914855480 * b;
  const l3 = l * l * l, m3 = m * m * m, s3 = s * s * s;
  return [4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
          -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
          -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3];
}
function blur1(a, n, rad, passes) {
  const tmp = new Float32Array(n);
  for (let p = 0; p < passes; p++) {
    let acc = 0; const inv = 1 / (2 * rad + 1);
    for (let k = -rad; k <= rad; k++) acc += a[clamp(k, 0, n - 1)];
    for (let i = 0; i < n; i++) {
      tmp[i] = acc * inv;
      acc += a[Math.min(n - 1, i + rad + 1)] - a[Math.max(0, i - rad)];
    }
    a.set(tmp);
  }
}
// Colour ramp LUT: stops [t, '#hex', gain?], interpolated in OKLab and softened (no Mach bands).
function makeRamp(stops, n = 1024, soft = 14) {
  const r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
  const labs = stops.map(s => { const c = hexLin(s[1]); const k = s[2] === undefined ? 1 : s[2]; return [s[0], linToOklab(c[0] * k, c[1] * k, c[2] * k)]; });
  const t0 = labs[0][0], t1 = labs[labs.length - 1][0];
  for (let i = 0; i < n; i++) {
    const t = t0 + (t1 - t0) * i / (n - 1);
    let k = 0; while (k < labs.length - 2 && t > labs[k + 1][0]) k++;
    const A = labs[k], C = labs[k + 1];
    const f = clamp((t - A[0]) / (C[0] - A[0]), 0, 1);
    const lin = oklabToLin(mix(A[1][0], C[1][0], f), mix(A[1][1], C[1][1], f), mix(A[1][2], C[1][2], f));
    r[i] = Math.max(0, lin[0]); g[i] = Math.max(0, lin[1]); b[i] = Math.max(0, lin[2]);
  }
  if (soft > 0) for (const ch of [r, g, b]) blur1(ch, n, soft, 3);
  return { n, r, g, b, t0, t1, k: (n - 1) / (t1 - t0) };
}
function rampIdx(R, t) { const i = ((t - R.t0) * R.k) | 0; return i < 0 ? 0 : i >= R.n ? R.n - 1 : i; }
function rampAt(R, t) { const i = rampIdx(R, t); return [R.r[i], R.g[i], R.b[i]]; }
function css(r, g, b, a) { // linear -> css rgb string
  const R = Math.round(clamp(l2s(r), 0, 1) * 255), G = Math.round(clamp(l2s(g), 0, 1) * 255), B = Math.round(clamp(l2s(b), 0, 1) * 255);
  return a === undefined ? `rgb(${R},${G},${B})` : `rgba(${R},${G},${B},${a.toFixed(3)})`;
}

// ------------------------------------------------------------------ buffers
function blurH(src, dst, w, h, r) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const o = y * w; let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[o + clamp(k, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      dst[o + x] = acc * inv;
      const xa = x + r + 1, xs = x - r;
      acc += src[o + (xa < w ? xa : w - 1)] - src[o + (xs > 0 ? xs : 0)];
    }
  }
}
function blurV(src, dst, w, h, r) {
  const inv = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[clamp(k, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * inv;
      const ya = y + r + 1, ys = y - r;
      acc += src[(ya < h ? ya : h - 1) * w + x] - src[(ys > 0 ? ys : 0) * w + x];
    }
  }
}
// Separable box blur (3 passes ~ gaussian). rx/ry may differ; 0 skips that axis.
function blur(buf, w, h, r, passes = 3, ry) {
  const rx = Math.round(r); ry = Math.round(ry === undefined ? r : ry);
  if (rx < 1 && ry < 1) return buf;
  const tmp = new Float32Array(buf.length);
  for (let p = 0; p < passes; p++) {
    if (rx >= 1) { blurH(buf, tmp, w, h, rx); buf.set(tmp); }
    if (ry >= 1) { blurV(buf, tmp, w, h, ry); buf.set(tmp); }
  }
  return buf;
}
// Horizontal blur that wraps around (for tileable strips).
function blurWrapH(buf, w, h, r, passes = 3) {
  r = Math.round(r); if (r < 1) return buf;
  const row = new Float32Array(w), inv = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) for (let y = 0; y < h; y++) {
    const o = y * w; let acc = 0;
    for (let k = -r; k <= r; k++) acc += buf[o + ((k % w) + w) % w];
    for (let x = 0; x < w; x++) {
      row[x] = acc * inv;
      acc += buf[o + (x + r + 1) % w] - buf[o + ((x - r) % w + w) % w];
    }
    buf.set(row, o);
  }
  return buf;
}
function downsample(src, w, h, f) {
  const w2 = Math.ceil(w / f), h2 = Math.ceil(h / f), out = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
    let s = 0, c = 0;
    for (let j = 0; j < f; j++) { const yy = y * f + j; if (yy >= h) break;
      for (let i = 0; i < f; i++) { const xx = x * f + i; if (xx >= w) break; s += src[yy * w + xx]; c++; } }
    out[y * w2 + x] = s / c;
  }
  return { buf: out, w: w2, h: h2 };
}
function bilin(buf, w, h, x, y) {
  if (x < 0) x = 0; else if (x > w - 1.001) x = w - 1.001;
  if (y < 0) y = 0; else if (y > h - 1.001) y = h - 1.001;
  const xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi, i = yi * w + xi;
  const a = buf[i] + (buf[i + 1] - buf[i]) * fx;
  const b = buf[i + w] + (buf[i + w + 1] - buf[i + w]) * fx;
  return a + (b - a) * fy;
}
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function ctx2d(c) { return c.getContext('2d', { willReadFrequently: true }); }

// Linear-light float image.
function makeImage(W, H) { const N = W * H; return { W, H, R: new Float32Array(N), G: new Float32Array(N), B: new Float32Array(N) }; }

// Composite an sRGB canvas layer (drawn by Canvas2D) into the linear buffers.
// tint(x, y, rgb) may adjust colour per pixel; alphaOut collects coverage.
function compositeLayer(img, canvas, alphaOut, opts) {
  const { W, H, R, G, B } = img;
  const d = ctx2d(canvas).getImageData(0, 0, W, H).data;
  const lut = new Float32Array(256); for (let i = 0; i < 256; i++) lut[i] = s2l(i / 255);
  const gain = (opts && opts.gain) || 1, mode = (opts && opts.mode) || 'over';
  for (let i = 0, j = 0; i < W * H; i++, j += 4) {
    const a = d[j + 3]; if (!a) continue;
    const al = a / 255;
    if (mode === 'add') {
      R[i] += lut[d[j]] * gain * al; G[i] += lut[d[j + 1]] * gain * al; B[i] += lut[d[j + 2]] * gain * al;
    } else {
      R[i] = R[i] * (1 - al) + lut[d[j]] * gain * al;
      G[i] = G[i] * (1 - al) + lut[d[j + 1]] * gain * al;
      B[i] = B[i] * (1 - al) + lut[d[j + 2]] * gain * al;
    }
    if (alphaOut) alphaOut[i] = Math.max(alphaOut[i], al);
  }
}
// Canvas alpha channel as a float buffer.
function alphaOf(canvas) {
  const W = canvas.width, H = canvas.height, d = ctx2d(canvas).getImageData(0, 0, W, H).data;
  const a = new Float32Array(W * H);
  for (let i = 0, j = 3; i < W * H; i++, j += 4) a[i] = d[j] / 255;
  return a;
}

// ------------------------------------------------------------------ light
// Luminance-thresholded multi-radius bloom (keeps the source hue).
function bloom(img, U, opts) {
  const { W, H, R, G, B } = img, f = 4;
  const thr = (opts && opts.threshold) || 1.2, amt = (opts && opts.amount) || 1;
  const radii = (opts && opts.radii) || [[2, 0.3], [6, 0.25], [16, 0.2], [44, 0.12]];
  const kf = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) { const L = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i]; kf[i] = L > thr ? (L - thr) / L : 0; }
  const chans = [R, G, B].map(c => { const o = new Float32Array(W * H); for (let i = 0; i < W * H; i++) o[i] = c[i] * kf[i]; return downsample(o, W, H, f); });
  const w = chans[0].w, h = chans[0].h;
  const accs = chans.map(() => new Float32Array(w * h));
  for (let c = 0; c < 3; c++) {
    for (const [r, wt] of radii) {
      const b = Float32Array.from(chans[c].buf);
      blur(b, w, h, Math.max(1, Math.round(r * U / 1440)), 3);
      const A = accs[c]; for (let i = 0; i < w * h; i++) A[i] += b[i] * wt * amt;
    }
  }
  const out = [R, G, B];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, lx = (x + 0.5) / f - 0.5, ly = (y + 0.5) / f - 0.5;
    for (let c = 0; c < 3; c++) out[c][i] += bilin(accs[c], w, h, lx, ly);
  }
}

// ------------------------------------------------------------------ tone map & output
// Soft-knee tone map, vignette, saturation, triangular dither -> opaque canvas.
function finish(img, seed, opts) {
  opts = opts || {};
  const { W, H, R, G, B } = img;
  const canvas = makeCanvas(W, H), ctx = ctx2d(canvas);
  const out = ctx.createImageData(W, H), d = out.data;
  const LUTN = 4096, lut = new Float32Array(LUTN + 1);
  const contrast = opts.contrast === undefined ? 0.12 : opts.contrast;
  for (let i = 0; i <= LUTN; i++) { const v = l2s(i / LUTN); lut[i] = mix(v, v * v * (3 - 2 * v), contrast) * 255; }
  const rng = mulberry32(seed + 999);
  const exposure = opts.exposure || 1, sat = opts.saturation || 1.1;
  const knee = opts.knee || 0.7;
  const tone = (x) => x <= knee ? x : knee + (1 - knee) * (1 - Math.exp(-(x - knee) / (1 - knee)));
  const vig = opts.vignette === undefined ? 0.3 : opts.vignette, vt = opts.vignetteTint || [1, 1, 1];
  const cxv = W * (opts.vcx || 0.5), cyv = H * (opts.vcy || 0.5), vr = Math.hypot(W * 0.5, H * 0.5);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let r = R[i] * exposure, g = G[i] * exposure, b = B[i] * exposure;
    const vd = Math.hypot((x - cxv) / vr, (y - cyv) / vr * 1.1);
    const v = vig * smoothstep(0.45, 1.1, vd);
    r *= 1 - v * vt[0]; g *= 1 - v * vt[1]; b *= 1 - v * vt[2];
    r = tone(r); g = tone(g); b = tone(b);
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = clamp(l + (r - l) * sat, 0, 1); g = clamp(l + (g - l) * sat, 0, 1); b = clamp(l + (b - l) * sat, 0, 1);
    const sr = lut[(r * LUTN) | 0], sg = lut[(g * LUTN) | 0], sb = lut[(b * LUTN) | 0];
    const dn = rng() + rng() - 1;
    const j = i * 4;
    d[j] = clamp(Math.round(sr + dn), 0, 255);
    d[j + 1] = clamp(Math.round(sg + dn), 0, 255);
    d[j + 2] = clamp(Math.round(sb + dn), 0, 255);
    d[j + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}
// Transparent layer from linear colour + alpha buffers (straight alpha), dithered.
// alphaDither: false leaves the alpha channel smooth (it is stored losslessly, so noise costs bytes).
function finishRGBA(W, H, R, G, B, A, seed, alphaDither = true) {
  const canvas = makeCanvas(W, H), ctx = ctx2d(canvas);
  const out = ctx.createImageData(W, H), d = out.data;
  const rng = mulberry32(seed + 77);
  for (let i = 0, j = 0; i < W * H; i++, j += 4) {
    const a = clamp(A[i], 0, 1);
    const dn = rng() + rng() - 1;
    d[j] = clamp(Math.round(l2s(clamp(R[i], 0, 1)) * 255 + dn), 0, 255);
    d[j + 1] = clamp(Math.round(l2s(clamp(G[i], 0, 1)) * 255 + dn), 0, 255);
    d[j + 2] = clamp(Math.round(l2s(clamp(B[i], 0, 1)) * 255 + dn), 0, 255);
    const an = rng() - 0.5;
    d[j + 3] = a <= 0 ? 0 : clamp(Math.round(a * 255 + (alphaDither ? an : 0)), 0, 255);
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

function addGrain(src, amount, seed) {
  const w = src.width, h = src.height;
  const c = makeCanvas(w, h), x = ctx2d(c);
  x.drawImage(src, 0, 0);
  const img = x.getImageData(0, 0, w, h), d = img.data;
  const rng = mulberry32(seed);
  for (let j = 0; j < d.length; j += 4) {
    const l = (d[j] * 0.3 + d[j + 1] * 0.59 + d[j + 2] * 0.11) / 255;
    const k = amount * (1 - Math.abs(l * 2 - 1) * 0.65);
    const n = (rng() + rng() - 1) * k;
    d[j] = clamp(Math.round(d[j] + n), 0, 255); d[j + 1] = clamp(Math.round(d[j + 1] + n), 0, 255); d[j + 2] = clamp(Math.round(d[j + 2] + n), 0, 255);
  }
  x.putImageData(img, 0, 0);
  return c;
}
function resize(src, w, h) {
  let c = src;
  while (c.width / 2 >= w * 1.0001 && c.height / 2 >= h * 1.0001) {
    const n = makeCanvas(Math.round(c.width / 2), Math.round(c.height / 2));
    const x = ctx2d(n); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(c, 0, 0, n.width, n.height); c = n;
  }
  if (c.width !== w || c.height !== h) {
    const n = makeCanvas(w, h); const x = ctx2d(n); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(c, 0, 0, w, h); c = n;
  }
  return c;
}
// Resized copy; opaque scenes get a touch of film grain (it also keeps WebP from banding).
function finalize(src, w, h, kind, grain) {
  let c = (src.width === w && src.height === h) ? src : resize(src, w, h);
  if (kind === 'scene') c = addGrain(c, grain === undefined ? 2.4 : grain, 4242 + w);
  return c;
}
function dataURLBytes(u) { const b64 = u.slice(u.indexOf(',') + 1); return Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0); }
// Highest WebP quality that fits maxBytes (binary search).
function encode(canvas, mime, maxBytes, qMax = 0.92, qMin = 0.3) {
  if (mime === 'image/png') { const u = canvas.toDataURL('image/png'); return { dataURL: u, quality: 1, bytes: dataURLBytes(u) }; }
  let lo = qMin, hi = qMax, best = null;
  let u = canvas.toDataURL(mime, hi);
  if (!maxBytes || dataURLBytes(u) <= maxBytes) return { dataURL: u, quality: hi, bytes: dataURLBytes(u) };
  for (let it = 0; it < 8; it++) {
    const q = (lo + hi) / 2; u = canvas.toDataURL(mime, q);
    const b = dataURLBytes(u);
    if (b <= maxBytes) { best = { dataURL: u, quality: q, bytes: b }; lo = q; } else hi = q;
  }
  if (!best) { u = canvas.toDataURL(mime, qMin); best = { dataURL: u, quality: qMin, bytes: dataURLBytes(u) }; }
  return best;
}

// Runs a job list the way render-theme.mjs asks: [{ file, w, h, maxBytes, kind, grain }] from one source canvas.
function outputs(src, job, preview) {
  return job.outputs.map(o => {
    const out = finalize(src, o.w || job.w, o.h || job.h, o.kind || job.kind, o.grain === undefined ? job.grain : o.grain);
    const enc = encode(out, 'image/webp', o.maxBytes, o.qMax || 0.92);
    return { file: o.file, webp: enc.dataURL, quality: enc.quality, w: out.width, h: out.height, png: preview ? out.toDataURL('image/png') : null };
  });
}

// Interactive preview helper for the generator pages: ?preset=tall&w=540&h=960 (or ?strip=name).
function preview(Art, defaults) {
  if (/[?&]noauto/.test(location.search)) return;
  setTimeout(() => {
    const q = new URLSearchParams(location.search);
    const strip = q.get('strip');
    const preset = q.get('preset') || 'landscape';
    const tall = preset === 'tall';
    const w = +(q.get('w') || (tall ? 540 : 1280)), h = +(q.get('h') || (tall ? 960 : 720));
    const t0 = performance.now();
    const c = strip ? Art.strip(strip, w, h) : Art.render(preset, w, h);
    const out = document.getElementById('out');
    out.width = c.width; out.height = c.height; out.getContext('2d').drawImage(c, 0, 0);
    document.getElementById('info').textContent = `${defaults.title}: ${strip || preset} ${c.width}×${c.height} in ${Math.round(performance.now() - t0)} ms`;
  }, 30);
}

return {
  clamp, mix, smoothstep, TAU, sq, mulberry32, gauss, hash2, perlin, perlinP, noise1, fbm1, fbm, fbmP, ridged, fbmA,
  s2l, l2s, hexLin, linToOklab, oklabToLin, makeRamp, rampIdx, rampAt, css,
  blur, blurWrapH, downsample, bilin, makeCanvas, ctx2d, makeImage, compositeLayer, alphaOf,
  bloom, finish, finishRGBA, addGrain, resize, finalize, encode, outputs, preview,
};
})();
window.ArtKit = ArtKit;
