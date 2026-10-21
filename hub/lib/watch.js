// lib_watch: Gemini watches a video WITH its sound and writes a timed
// breakdown, so Claude (who only sees stills) learns the motion, timing and
// music. Free tier: one call per video, and the default answer is cached in
// the library, so asking again costs nothing. The key is a hub env var
// (GEMINI_API_KEY, or the same LLM_API_KEY Dop uses); it never leaves here.
const API = 'https://generativelanguage.googleapis.com';
// Same chain as Dop (shared/llm.ts): Google retires ids and Flash is often busy.
export const WATCH_CHAIN = ['gemini-flash-latest', 'gemini-3-flash-preview', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite'];
export const INLINE_MAX = 14 * 1024 * 1024; // raw bytes sent inline (a request may be 20 MB of base64)

export function watchKey(env = process.env) {
  return String(env.GEMINI_API_KEY || env.LLM_API_KEY || '').trim();
}
export function watchModels(env = process.env) {
  const own = [env.HUB_VIDEO_MODEL, env.LLM_MODEL].map((m) => String(m || '').trim().toLowerCase().replace(/^models\//, '').replace(/\s+/g, '-')).filter((m) => /^gemini-[\w.-]+$/.test(m));
  return [...new Set([...own, ...WATCH_CHAIN])];
}

// Frames Gemini samples per second: its default is 1, far too few for a fast
// intro. Aim for ~180 sampled frames, 1-10 per second.
export function watchFps(duration) {
  if (!(duration > 0)) return 0;
  return Math.max(1, Math.min(10, Math.floor(180 / duration)));
}

export function youtubeUrl(u) {
  const s = String(u || '').trim();
  return /^https:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{6,}/i.test(s) ? s : '';
}

const SYSTEM = [
  'You watch a reference video for a designer and an AI developer who cannot watch it themselves: they only see a few still frames and cannot hear the sound.',
  'Describe only what you can see or hear. Say "unclear" rather than guess. Never invent text, logos or sounds.',
  'Use timestamps M:SS.s for everything. A measured timeline (cuts, sound hits, beat) may be given: treat its times as exact and line your shots up with them.',
].join(' ');

export function watchPrompt({ name = '', note = '', timeline = '', ask = '' } = {}) {
  const parts = [`Video: ${name || 'reference clip'}${note ? `\nOwner's note: ${note}` : ''}`];
  if (timeline) parts.push(timeline);
  if (ask) parts.push(`Answer this about the video, in detail, with timestamps:\n${String(ask).slice(0, 2000)}`);
  else
    parts.push(
      [
        'Write these sections, plain text, under 1200 words:',
        '1. SUMMARY: one or two lines, what this is and its feel.',
        '2. SHOTS: one line per shot or major beat: start-end time; what is on screen; camera move; how things move (speed, easing such as snap, ease-out, overshoot, bounce, stagger; how long each move takes in ms); the transition into the next shot.',
        '3. TEXT AND LOGOS: exact words on screen, their style (weight, size, case, colour) and how each animates in and out, with times.',
        '4. COLOUR AND LIGHT: palette (hex guesses are fine, marked approximate), lighting, texture, grain, blur, depth of field.',
        '5. SOUND: music style, tempo, instruments, sound effects with times, silences, and exactly which picture changes land on which sounds.',
        '6. WHY IT FEELS HIGH QUALITY: concrete, timed reasons (pacing, anticipation, restraint, contrast), not adjectives.',
        '7. TO REBUILD IT ON THE WEB: the key moments as a timeline a developer could code (times in ms, easing curves, what scales, fades, moves).',
      ].join('\n'),
    );
  return parts.join('\n\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const redact = (s, key) => (key && key.length >= 8 ? String(s).split(key).join('***') : String(s));

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text.slice(0, 300) } };
  }
}

// Big videos go through the Files API (upload, wait until Google has
// processed it). Returns the file uri.
async function uploadFile(fetchImpl, key, bytes, type, name, deadline) {
  const start = await fetchImpl(`${API}/upload/v1beta/files?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.length),
      'X-Goog-Upload-Header-Content-Type': type,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: String(name || 'video').slice(0, 100) } }),
  });
  const url = start.headers?.get?.('x-goog-upload-url');
  if (!start.ok || !url) throw new Error(`upload start failed (${start.status}): ${redact((await readJson(start)).error?.message || '', key)}`);
  const up = await fetchImpl(url, { method: 'POST', headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize', 'Content-Length': String(bytes.length) }, body: bytes });
  const info = await readJson(up);
  if (!up.ok || !info.file?.uri) throw new Error(`upload failed (${up.status}): ${redact(info.error?.message || '', key)}`);
  let file = info.file;
  while (file.state === 'PROCESSING') {
    if (Date.now() > deadline - 15_000) throw new Error('Google is still processing the video; ask again in a minute');
    await sleep(2000);
    const r = await fetchImpl(`${API}/v1beta/${file.name}?key=${encodeURIComponent(key)}`, { method: 'GET' });
    file = await readJson(r);
    if (!r.ok) throw new Error(`file check failed (${r.status})`);
  }
  if (file.state === 'FAILED') throw new Error('Google could not process this video');
  return file.uri;
}

// One watch. video: { bytes: Buffer, type } or { uri } (YouTube or uploaded).
// Returns { ok, text, model } or { ok: false, error }.
export async function geminiWatch({ key, models, video, duration = 0, prompt, fetchImpl = fetch, budgetMs = 52_000 }) {
  const deadline = Date.now() + budgetMs;
  const errors = [];
  let media;
  try {
    if (video.uri) media = { file_data: { file_uri: video.uri, ...(video.type ? { mime_type: video.type } : {}) } };
    else if (video.bytes.length <= INLINE_MAX) media = { inline_data: { mime_type: video.type, data: video.bytes.toString('base64') } };
    else media = { file_data: { file_uri: await uploadFile(fetchImpl, key, video.bytes, video.type, video.name, deadline), mime_type: video.type } };
  } catch (e) {
    return { ok: false, error: redact(e.message, key) };
  }
  const fps = watchFps(duration);
  for (const model of models) {
    let withFps = fps > 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (Date.now() > deadline - 5000) return { ok: false, error: `ran out of time (${errors.join('; ') || 'slow answer'}); try a shorter clip or ask again` };
      const part = withFps ? { ...media, video_metadata: { fps } } : media;
      const body = {
        system_instruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [part, { text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
      };
      let res, data;
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), Math.max(5000, deadline - Date.now()));
        res = await fetchImpl(`${API}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
        clearTimeout(t);
        data = await readJson(res);
      } catch (e) {
        errors.push(`${model}: ${e.name === 'AbortError' ? 'timed out' : redact(e.message, key)}`);
        break;
      }
      if (res.ok) {
        const text = (data.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought && p.text).map((p) => p.text).join('').trim();
        if (text) return { ok: true, text, model: data.modelVersion || model, fps: withFps ? fps : 1 };
        errors.push(`${model}: empty answer (${data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || 'no reason'})`);
        break;
      }
      const msg = redact(data.error?.message || '', key).slice(0, 200);
      if (res.status === 400 && withFps && /fps|video_metadata|videoMetadata/i.test(msg)) {
        withFps = false;
        continue;
      }
      errors.push(`${model}: ${res.status} ${msg}`);
      if (res.status >= 500 && attempt === 0) {
        await sleep(1500);
        continue;
      }
      if (res.status === 400 || res.status === 401 || res.status === 403) return { ok: false, error: errors.join('; ') };
      break; // 404 retired id, 429 quota, or still failing: next model
    }
  }
  return { ok: false, error: errors.join('; ') || 'no model answered' };
}

export const watchHeader = (r, cached) => `Gemini (${r.model}${r.fps ? `, ${r.fps} frames/s` : ''}) watched this video with sound${r.at ? ` on ${new Date(r.at).toISOString().slice(0, 10)}` : ''}${cached ? ' (saved answer, no new call)' : ''}. Its notes may be wrong in details; check key moments against the stills.`;

export const KEY_HELP = 'Gemini can\'t watch videos yet: the hub has no Gemini key. XIAO: in Vercel open the hub project › Settings › Environment Variables, add GEMINI_API_KEY with the same Google AI Studio key Dop uses (LLM_API_KEY), Save, then Deployments › ⋯ on the newest › Redeploy. Meanwhile use lib_get for the stills and the measured timeline.';
