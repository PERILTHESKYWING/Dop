// Video understanding for agents: the browser's measurements (hub/library/video-scan.js),
// how lib_get shows a video, and lib_watch (Gemini watches it with sound) on a mocked API.
import { beforeAll, describe, expect, it } from 'vitest';

const imp = (p: string) => import(/* @vite-ignore */ `../hub/${p}` as string) as Promise<any>;

let v: any, w: any;
let hub: any, library: any, pageApi: any;
const A = { name: 'ME', plan: 'max' };
const page = (op: string, body?: any, query: any = {}) =>
  pageApi({ hub, password: 'pw', method: body ? 'POST' : 'GET', query: { op, ...query }, body: body || {}, headers: { 'x-hub-password': 'pw' } });
const tool = (name: string, args: any = {}) => library.tools.find((t: any) => t.name === name).run(A, args);
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');

beforeAll(async () => {
  v = await imp('library/video-scan.js');
  w = await imp('lib/watch.js');
  const { createHub } = await imp('lib/hub.js');
  const { memoryStore } = await imp('lib/store.js');
  ({ pageApi } = await imp('lib/api.js'));
  const { libraryOf } = await imp('lib/library.js');
  hub = createHub({ store: memoryStore(), fetchImpl: (async () => { throw new Error('offline'); }) as any, now: () => Date.parse('2026-10-21T09:00:00Z') });
  hub.env = {};
  library = libraryOf(hub);
});

// A 10 s clip: still, a cut at 3 s, fast motion 6-7 s, a cut at 8 s.
function fakeScan() {
  const times = v.scanTimes(10);
  const diffs = times.map((t: number, i: number) => (i === 0 ? 0 : t >= 6 && t < 7 ? 0.09 + (i % 3) * 0.02 : 0.01));
  const at = (t: number) => times.findIndex((x: number) => x >= t);
  diffs[at(3)] = 0.6;
  diffs[at(8)] = 0.5;
  return { times, diffs };
}

describe('video measurements', () => {
  it('scans at most 300 samples, never finer than 0.1 s', () => {
    expect(v.scanStep(10)).toBe(0.1);
    expect(v.scanTimes(10)).toHaveLength(100);
    expect(v.scanTimes(600).length).toBeLessThanOrEqual(300);
    expect(v.scanTimes(0)).toEqual([0]);
  });

  it('finds hard cuts but not fast motion', () => {
    const { times, diffs } = fakeScan();
    const cuts = v.findCuts(times, diffs);
    expect(cuts).toHaveLength(2);
    expect(cuts[0]).toBeCloseTo(2.95, 1);
    expect(cuts[1]).toBeCloseTo(7.95, 1);
    expect(v.shotsOf(10, cuts)).toHaveLength(3);
    expect(v.greyDiff(new Uint8Array([0, 255]), new Uint8Array([255, 255]))).toBe(0.5);
  });

  it('picks stills at both sides of each cut, then spreads the rest', () => {
    const t = v.pickTimes(10, [3, 8]);
    expect(t).toHaveLength(20);
    expect(t.some((x: number) => x > 2.85 && x < 3)).toBe(true); // last moment before the cut
    expect(t.some((x: number) => x > 3 && x < 3.1)).toBe(true); // first moment after it
    expect([...t].sort((a, b) => a - b)).toEqual(t);
    expect(new Set(t).size).toBe(t.length);
    expect(v.pickTimes(600, [])).toHaveLength(48);
    expect(v.pickTimes(0)).toEqual([0]);
  });

  it('hears hits and a steady beat', () => {
    const step = v.AUDIO_STEP;
    // 120 BPM: a loud hit every 0.5 s for 8 s, quiet between.
    const rms = Array.from({ length: 160 }, (_, i) => (i % 10 === 0 ? 1 : 0.05));
    const hits = v.soundHits(rms, step);
    expect(hits.length).toBeGreaterThanOrEqual(14);
    expect(hits[0]).toBe(0);
    expect(hits[1]).toBeCloseTo(0.5, 2);
    const beat = v.tempo(rms, step);
    expect(beat.bpm).toBeGreaterThanOrEqual(118);
    expect(beat.bpm).toBeLessThanOrEqual(122);
    expect(v.tempo(Array(160).fill(0.3), step).bpm).toBe(0);
    expect(v.rmsWindows(new Float32Array([1, -1, 0, 0]), 40, 0.05)).toEqual([1, 0]);
  });

  it('cleans what the page sends and writes it as text', () => {
    const t = v.cleanTimeline({
      duration: 10, width: 1920, height: 1080, step: 0.1,
      motion: [0, 0.2, 9, 'x'], cuts: [3, 2, 8, 99],
      shots: [{ start: 0, end: 3, color: '#102030', light: 0.1, motion: 0.005 }, { start: 3, end: 8, color: 'red', light: 0.8, motion: 0.1 }],
      audio: { step: 0.05, loud: Array.from({ length: 200 }, (_, i) => (i % 10 === 0 ? 1 : 0.05)), hits: [0, 3, 8], bpm: 120, beat: 0.6 },
    });
    expect(t.cuts).toEqual([3, 8]);
    expect(t.motion).toEqual([0, 0.2, 1, 0]);
    expect(t.shots[1].color).toBe('');
    expect(v.cleanTimeline({ duration: 0 })).toBeNull();
    const text = v.timelineText(t);
    expect(text).toContain('0:10.0 long, 1920x1080');
    expect(text).toContain('Cuts at 0:03.0, 0:08.0');
    expect(text).toContain('1. 0:00.0-0:03.0 (3.0 s) dark #102030, still');
    expect(text).toContain('about 120 BPM');
    expect(text).toContain('Cuts on a sound hit (within 0.1 s): 2 of 2');
    expect(text).toMatch(/Loudness, average \(one character per 0.5 s[^)]*\): [0-9. ]+/);
    expect(v.timelineText({ ...t, audio: null, noAudio: 'silent' })).toContain('Sound: silent.');
  });

  it('samples more frames for short clips when Gemini watches', () => {
    expect(w.watchFps(10)).toBe(10);
    expect(w.watchFps(60)).toBe(3);
    expect(w.watchFps(600)).toBe(1);
    expect(w.watchFps(0)).toBe(0);
    expect(w.youtubeUrl('https://youtu.be/abcdefgh')).toBeTruthy();
    expect(w.youtubeUrl('https://evil.example/watch?v=abc')).toBe('');
    expect(w.watchModels({ LLM_MODEL: 'Gemini' })[0]).toBe('gemini-flash-latest');
    expect(w.watchModels({ HUB_VIDEO_MODEL: 'gemini-3.5-flash' })[0]).toBe('gemini-3.5-flash');
  });
});

describe('videos for agents', () => {
  let id = '';
  const calls: any[] = [];
  const reply = (status: number, body: any, headers: Record<string, string> = {}) => ({ ok: status < 300, status, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, text: async () => JSON.stringify(body) });

  it('shows sheets, stills in a span, and the measured timeline', async () => {
    const put = await page('lib-put', { name: 'intro.mp4', type: 'video/mp4', size: 12, chunks: 1, note: 'logo snaps in on the beat' });
    id = put.body.id;
    await page('lib-chunk', { id, part: 'body', i: 0, data: b64('fake video!!') });
    for (let i = 0; i < 14; i++) await page('lib-chunk', { id, part: 'frame', i, data: b64(`frame${i}`) });
    await page('lib-chunk', { id, part: 'sheet', i: 0, data: b64('sheet0') });
    await page('lib-chunk', { id, part: 'sheet', i: 1, data: b64('sheet1') });
    expect((await page('lib-chunk', { id, part: 'sheet', i: 4, data: b64('x') })).status).toBe(400);
    const frameTimes = Array.from({ length: 14 }, (_, i) => i * 0.7);
    const timeline = { duration: 10, width: 1280, height: 720, step: 0.1, motion: [0, 0.1], cuts: [3], shots: [{ start: 0, end: 3, color: '#000000', light: 0, motion: 0 }, { start: 3, end: 10, color: '#ffffff', light: 1, motion: 0.1 }], audio: { step: 0.05, loud: [0, 1, 0.1], hits: [3], bpm: 0, beat: 0 } };
    const done = await page('lib-done', { id, frameTimes, timeline });
    expect(done.body).toMatchObject({ sheets: 2, hasTimeline: true, frames: 14 });
    const all = await tool('lib_get', { id });
    expect(all.content.map((c: any) => c.data).filter(Boolean)).toEqual([b64('sheet0'), b64('sheet1')]);
    const text = all.content.at(-1).text;
    expect(text).toContain('2 contact sheet(s)');
    expect(text).toContain('Cuts at 0:03.0');
    expect(text).toContain('Cuts on a sound hit (within 0.1 s): 1 of 1');
    expect(text).toContain(`lib_watch(id: "${id}")`);
    const one = await tool('lib_get', { id, sheet: 1 });
    expect(one.content[0].data).toBe(b64('sheet1'));
    const span = await tool('lib_get', { id, from: 2, to: 3 });
    expect(span.content.filter((c: any) => c.type === 'image').map((c: any) => c.data)).toEqual([b64('frame3'), b64('frame4')]);
    expect(await tool('lib_get', { id, from: 50 })).toContain('No stills between');
  });

  it('explains how to add the key when there is none', async () => {
    expect(await tool('lib_watch', { id })).toContain('GEMINI_API_KEY');
  });

  it('has Gemini watch the video with sound, saves the answer and reuses it', async () => {
    hub.env = { GEMINI_API_KEY: 'test-key-123456' };
    hub.fetch = async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      if (url.includes('gemini-flash-latest')) return reply(404, { error: { message: 'retired' } });
      return reply(200, { modelVersion: 'gemini-3-flash-preview', candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: '1. SUMMARY: a logo intro' }] } }] });
    };
    const out = await tool('lib_watch', { id });
    expect(out).toContain('1. SUMMARY: a logo intro');
    expect(out).not.toContain('thinking');
    expect(calls).toHaveLength(2); // retired id skipped
    const sent = calls[1].body.contents[0].parts;
    expect(sent[0].inline_data).toEqual({ mime_type: 'video/mp4', data: b64('fake video!!') });
    expect(sent[0].video_metadata).toEqual({ fps: 10 });
    expect(sent[1].text).toContain('Cuts at 0:03.0');
    expect(sent[1].text).toContain('logo snaps in on the beat');
    expect(calls[1].url).not.toContain('flash-latest');
    // Saved: no new call, and lib_get shows it.
    expect(await tool('lib_watch', { id })).toContain('saved answer, no new call');
    expect(calls).toHaveLength(2);
    const got = await tool('lib_get', { id });
    expect(got.content.at(-1).text).toContain('a logo intro');
    // A question is a new call and is not saved over the breakdown.
    const q = await tool('lib_watch', { id, ask: 'When does the logo appear?' });
    expect(q).toContain('Question: When does the logo appear?');
    expect(calls.at(-1).body.contents[0].parts[1].text).toContain('When does the logo appear?');
    expect(await tool('lib_watch', { id })).toContain('saved answer');
  });

  it('retries without the frame rate if Gemini refuses it, and reports failures plainly', async () => {
    const seen: any[] = [];
    hub.fetch = async (_url: string, init: any) => {
      const b = JSON.parse(init.body);
      seen.push(b);
      if (b.contents[0].parts[0].video_metadata) return reply(400, { error: { message: 'Unknown name "video_metadata"' } });
      return reply(200, { candidates: [{ content: { parts: [{ text: 'ok without fps' }] } }] });
    };
    expect(await tool('lib_watch', { id, fresh: true })).toContain('ok without fps');
    expect(seen).toHaveLength(2);
    hub.fetch = async () => reply(403, { error: { message: 'API key test-key-123456 not valid' } });
    const bad = await tool('lib_watch', { id, ask: 'x' });
    expect(bad).toContain('could not watch it');
    expect(bad).not.toContain('test-key-123456');
  });

  it('watches a YouTube link without uploading it', async () => {
    let part: any;
    hub.fetch = async (_url: string, init: any) => {
      part = JSON.parse(init.body).contents[0].parts[0];
      return reply(200, { candidates: [{ content: { parts: [{ text: 'yt notes' }] } }] });
    };
    expect(await tool('lib_watch', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })).toContain('yt notes');
    expect(part.file_data.file_uri).toContain('youtube.com');
    expect(await tool('lib_watch', { url: 'https://vimeo.com/1' })).toContain('public YouTube link');
  });

  it('sends a big video through the Files API and waits for it', async () => {
    const log: string[] = [];
    let polls = 0;
    const f = async (url: string, init: any) => {
      log.push(`${init.method} ${url.split('?')[0]}`);
      if (url.includes('/upload/v1beta/files')) return reply(200, {}, { 'x-goog-upload-url': 'https://upload.example/u1' });
      if (url === 'https://upload.example/u1') return reply(200, { file: { name: 'files/abc', uri: 'https://g/files/abc', state: 'PROCESSING' } });
      if (url.includes('/v1beta/files/abc')) return reply(200, { name: 'files/abc', uri: 'https://g/files/abc', state: ++polls > 1 ? 'ACTIVE' : 'PROCESSING' });
      return reply(200, { candidates: [{ content: { parts: [{ text: 'big ok' }] } }], body: init.body.length });
    };
    const r = await w.geminiWatch({ key: 'k', models: ['gemini-x'], video: { bytes: Buffer.alloc(w.INLINE_MAX + 10), type: 'video/mp4', name: 'big.mp4' }, duration: 30, prompt: 'p', fetchImpl: f });
    expect(r).toMatchObject({ ok: true, text: 'big ok', fps: 6 });
    expect(log[0]).toContain('/upload/v1beta/files');
    expect(log.filter((l) => l.includes('/v1beta/files/abc'))).toHaveLength(2);
    expect(log.at(-1)).toContain('gemini-x:generateContent');
  }, 20000);
});
