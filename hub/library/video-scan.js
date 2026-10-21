// Pure helpers that turn a video into numbers an agent can read: where the
// cuts are, how much moves, where the sound hits, the beat, and which moments
// deserve a still frame. The browser measures (files.js); the hub server
// renders the same numbers as text (timelineText) for lib_get and for Gemini.
// No DOM here, so tests and the server can import it.

export const MAX_FRAMES = 48;
export const SCAN_MAX = 300; // motion samples per clip
export const AUDIO_STEP = 0.05; // seconds per loudness window

const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Seconds between motion samples: at most SCAN_MAX samples, never finer than 0.1 s.
export function scanStep(duration) {
  if (!(duration > 0)) return 0.5;
  return Math.max(0.1, Math.ceil((duration / SCAN_MAX) * 20) / 20);
}
export function scanTimes(duration) {
  const step = scanStep(duration);
  const out = [];
  for (let t = 0; t < duration - 0.02; t += step) out.push(r2(t));
  return out.length ? out : [0];
}

// Mean absolute difference of two grey thumbnails, 0-1.
export function greyDiff(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length / 255;
}

// diffs[i] = change from sample i-1 to i. A cut is a big jump that stands
// well above the motion around it (so fast action is not a cut).
export function findCuts(times, diffs) {
  const cuts = [];
  for (let i = 1; i < diffs.length; i++) {
    const d = diffs[i];
    if (d < 0.08) continue;
    const near = [];
    for (let j = Math.max(1, i - 4); j <= Math.min(diffs.length - 1, i + 4); j++) if (j !== i) near.push(diffs[j]);
    if (d < 3 * median(near) + 0.05) continue;
    const t = r2((times[i - 1] + times[i]) / 2);
    if (cuts.length && t - cuts[cuts.length - 1] < 0.3) continue;
    cuts.push(t);
  }
  return cuts;
}

export function shotsOf(duration, cuts) {
  const edges = [0, ...cuts.filter((c) => c > 0 && c < duration), duration];
  const out = [];
  for (let i = 0; i + 1 < edges.length; i++) if (edges[i + 1] - edges[i] > 0.01) out.push({ start: r2(edges[i]), end: r2(edges[i + 1]) });
  return out;
}

// Which moments get a full still: the first and last moment of every shot
// (so transitions show), the middle of each shot, then an even spread.
export function pickTimes(duration, cuts = [], max = MAX_FRAMES) {
  if (!(duration > 0)) return [0];
  const n = Math.min(max, Math.max(8, Math.ceil(duration * 2)));
  const gap = Math.min(0.12, duration / (n * 2));
  const last = Math.max(0, duration - 0.05);
  const picked = [];
  const add = (t) => {
    const x = r2(Math.min(last, Math.max(0, t)));
    if (picked.length < n && !picked.some((p) => Math.abs(p - x) < gap)) picked.push(x);
  };
  const shots = shotsOf(duration, cuts);
  for (const s of shots) add(s.start + 0.06);
  for (const s of shots) add(s.end - 0.06);
  for (const s of shots) add((s.start + s.end) / 2);
  for (const k of [n, n * 2, n * 4]) for (let i = 0; i < k; i++) add((duration * (i + 0.5)) / k);
  return picked.sort((a, b) => a - b);
}

// Loudness (RMS) of mono samples in fixed windows.
export function rmsWindows(samples, rate, step = AUDIO_STEP) {
  const w = Math.max(1, Math.round(rate * step));
  const out = [];
  for (let i = 0; i < samples.length; i += w) {
    let s = 0;
    const end = Math.min(samples.length, i + w);
    for (let j = i; j < end; j++) s += samples[j] * samples[j];
    out.push(Math.sqrt(s / (end - i)));
  }
  return out;
}

// Sound hits: a window clearly louder than the moment before it.
export function soundHits(rms, step = AUDIO_STEP) {
  const peak = Math.max(0, ...rms);
  if (!(peak > 0)) return [];
  const hits = [];
  for (let i = 0; i < rms.length; i++) {
    const before = rms.slice(Math.max(0, i - 6), i);
    const avg = before.length ? before.reduce((s, x) => s + x, 0) / before.length : 0;
    if (rms[i] < 0.12 * peak || rms[i] < avg * 1.6 + 0.02 * peak) continue;
    if (i + 1 < rms.length && rms[i + 1] > rms[i] * 1.15) continue; // still rising: take the top
    const t = r2(i * step);
    if (hits.length && t - hits[hits.length - 1] < 0.12) continue;
    hits.push(t);
  }
  return hits;
}

// Steady beat from the loudness rises, 60-180 BPM. 0 when there is none.
export function tempo(rms, step = AUDIO_STEP) {
  const env = rms.map((x, i) => Math.max(0, x - (rms[i - 1] ?? x)));
  const mean = env.reduce((s, x) => s + x, 0) / (env.length || 1);
  const e = env.map((x) => x - mean);
  const zero = e.reduce((s, x) => s + x * x, 0);
  if (!(zero > 0) || rms.length * step < 3) return { bpm: 0, strength: 0 };
  let best = { bpm: 0, strength: 0 };
  for (let bpm = 60; bpm <= 180; bpm++) {
    const lag = 60 / bpm / step;
    const l0 = Math.floor(lag), f = lag - l0;
    let s = 0;
    for (let i = 0; i + l0 + 1 < e.length; i++) s += e[i] * (e[i + l0] * (1 - f) + e[i + l0 + 1] * f);
    const strength = s / zero;
    if (strength > best.strength) best = { bpm, strength: r2(strength) };
  }
  return best.strength >= 0.25 ? best : { bpm: 0, strength: best.strength };
}

// ---------- the numbers as text ----------
export function clock(t) {
  const s = Math.max(0, Number(t) || 0);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

const num = (x, lo, hi, d = 0) => {
  const v = Number(x);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
};
const times = (a, dur, cap) => (Array.isArray(a) ? a : []).map((x) => r2(num(x, 0, dur))).filter((x, i, l) => x < dur && (i === 0 || x > l[i - 1])).slice(0, cap);

// What the browser sent, checked and trimmed (the server stores this).
export function cleanTimeline(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const duration = r2(num(raw.duration, 0, 24 * 3600));
  if (!(duration > 0)) return null;
  const level = (a, cap) => (Array.isArray(a) ? a.slice(0, cap).map((x) => r3(num(x, 0, 1))) : []);
  const hex = (c) => (/^#[0-9a-f]{6}$/i.test(String(c)) ? String(c).toLowerCase() : '');
  const shots = (Array.isArray(raw.shots) ? raw.shots : []).slice(0, 400).map((s) => ({ start: r2(num(s?.start, 0, duration)), end: r2(num(s?.end, 0, duration)), color: hex(s?.color), light: r2(num(s?.light, 0, 1)), motion: r3(num(s?.motion, 0, 1)) })).filter((s) => s.end > s.start);
  const a = raw.audio && typeof raw.audio === 'object' ? raw.audio : null;
  return {
    duration,
    width: Math.round(num(raw.width, 0, 20000)),
    height: Math.round(num(raw.height, 0, 20000)),
    step: r2(num(raw.step, 0.05, 60, 0.5)),
    motion: level(raw.motion, 2000),
    cuts: times(raw.cuts, duration, 400),
    shots,
    audio: a
      ? { step: r2(num(a.step, 0.01, 5, AUDIO_STEP)), loud: level(a.loud, 20000), hits: times(a.hits, duration, 600), bpm: Math.round(num(a.bpm, 0, 400)), beat: r2(num(a.beat, 0, 1)) }
      : null,
    noAudio: raw.noAudio ? String(raw.noAudio).slice(0, 120) : '',
  };
}

// Max (motion) or mean (loudness) of a series sampled every `step` s, in buckets of `size` s.
function buckets(values, step, size, duration, pick = 'max') {
  const n = Math.max(1, Math.ceil(duration / size));
  const out = Array(n).fill(0), count = Array(n).fill(0);
  values.forEach((v, i) => {
    const b = Math.min(n - 1, Math.floor((i * step) / size));
    out[b] = pick === 'max' ? Math.max(out[b], v) : out[b] + v;
    count[b]++;
  });
  return pick === 'max' ? out : out.map((v, b) => (count[b] ? v / count[b] : 0));
}
const bar = (vals) => vals.map((v) => (v <= 0.02 ? '.' : String(Math.min(9, Math.round(v * 9))))).join('');
const groupBar = (s, size) => s.replace(new RegExp(`(.{${Math.max(1, Math.round(4 / size))}})`, 'g'), '$1 ').trim();

const lightWord = (l) => (l < 0.2 ? 'dark' : l < 0.4 ? 'dim' : l < 0.7 ? 'mid' : 'bright');
const moveWord = (m) => (m < 0.01 ? 'still' : m < 0.03 ? 'slow' : m < 0.08 ? 'moving' : 'fast');

export function timelineText(t) {
  if (!t) return '';
  const d = t.duration;
  const size = d <= 60 ? 0.5 : d <= 180 ? 1 : Math.ceil(d / 180);
  const lines = [`Timeline measured by code (not guessed): ${clock(d)} long${t.width ? `, ${t.width}x${t.height}` : ''}, ${t.shots.length || t.cuts.length + 1} shot(s).`];
  if (t.cuts.length) lines.push(`Cuts at ${t.cuts.map(clock).join(', ')}.`);
  if (t.shots.length) {
    lines.push('Shots:');
    for (const [i, s] of t.shots.entries()) lines.push(`  ${i + 1}. ${clock(s.start)}-${clock(s.end)} (${(s.end - s.start).toFixed(1)} s) ${lightWord(s.light)}${s.color ? ` ${s.color}` : ''}, ${moveWord(s.motion)}`);
  }
  const scale = `one character per ${size} s, 0 = none, 9 = most, . = nothing; groups of ${Math.max(1, Math.round(4 / size)) * size} s`;
  if (t.motion.length) {
    const top = Math.max(0.05, ...t.motion);
    lines.push(`Motion, peak (${scale}): ${groupBar(bar(buckets(t.motion.map((m) => m / top), t.step, size, d)), size)}`);
  }
  if (t.audio && t.audio.loud.length) {
    const a = t.audio;
    const peak = Math.max(1e-6, ...a.loud);
    const db = a.loud.map((x) => Math.max(0, 1 + (20 * Math.log10(Math.max(x, 1e-6) / peak)) / 40));
    lines.push(`Loudness, average (${scale}): ${groupBar(bar(buckets(db, a.step, size, d, 'mean')), size)}`);
    if (a.hits.length) lines.push(`Sound hits (${a.hits.length}): ${a.hits.slice(0, 80).map(clock).join(', ')}${a.hits.length > 80 ? ' …' : ''}.`);
    lines.push(a.bpm ? `Beat: steady, about ${a.bpm} BPM (one beat every ${(60 / a.bpm).toFixed(2)} s; confidence ${a.beat}).` : 'Beat: no steady beat found.');
    if (t.cuts.length && a.hits.length) {
      const synced = t.cuts.filter((c) => a.hits.some((h) => Math.abs(h - c) <= 0.1));
      lines.push(`Cuts on a sound hit (within 0.1 s): ${synced.length} of ${t.cuts.length}${synced.length ? ` (${synced.map(clock).join(', ')})` : ''}.`);
    }
  } else lines.push(`Sound: ${t.noAudio || 'not measured'}.`);
  return lines.join('\n');
}
