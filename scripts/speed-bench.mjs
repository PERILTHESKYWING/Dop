/**
 * Repeatable page-speed benchmark for Kiai (kami/dist) and the Dop hub (hub/index.html).
 * Builds nothing: point it at built folders (served by a tiny static server here, with
 * brotli for text files like Vercel) or at running URLs.
 *
 *   npm run kami:build            # once, if kami/dist is missing or stale
 *   node scripts/speed-bench.mjs --kiai kami/dist --hub hub --out /tmp/bench.json --md /tmp/bench.md
 *
 * Options
 *   --kiai <dir|url>     built Kiai (kami/dist) or a URL such as http://localhost:4174
 *   --hub <dir|url>      hub folder (hub/) or URL; /api calls 404 when served from a folder
 *   --runs N             cold runs per page and profile, median reported (default 3)
 *   --profiles a,b       desktop (1280x800, no throttle) and/or phone (390x844, 4x CPU) (default both)
 *   --engine-on a,b      profiles that also time open -> first engine answer on Kiai (default desktop; "none" to skip)
 *   --engine-timeout S   seconds to wait for that answer (default 240)
 *   --pages a,b,c        subset of kiai-landing,kiai-app,hub
 *   --no-webgl           turn WebGL off (headless WebGL is SwiftShader on the CPU; see below)
 *   --idle S             seconds of idle frame sampling (default 3)
 *   --out file.json / --md file.md
 *
 * Pages: kiai-landing (fresh visitor at /, loader + landing), kiai-app (returning visitor:
 * localStorage kiai.entered=1 and kiai.seen=1, so the app opens with no landing and no
 * loader animation), hub (/ of the hub folder). Every run uses a new browser context, so the
 * cache is cold. Bytes are what crossed the wire (encodedDataLength) for the page itself;
 * worker fetches (engine wasm, network weights) are not counted.
 *
 * Engine answer: on kiai-app it clicks the first suggested question ("What should Black play
 * here?") as soon as it shows and waits for the answer's Copy button (.msg.kami .msg-tools).
 * Headless Chromium has no WebGPU, so this is the bundled b10 on the CPU, including the
 * first-visit device tuning; /api/llm is absent, so the answer is engine text only.
 *
 * Needs Playwright (global install is fine; set PLAYWRIGHT=/path/to/playwright/index.mjs otherwise).
 */
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants as zc } from 'node:zlib';

// ---------- args ----------
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const kiaiArg = opt('kiai', 'kami/dist');
const hubArg = opt('hub', 'hub');
const RUNS = Number(opt('runs', '3'));
const PROFILE_NAMES = opt('profiles', 'desktop,phone').split(',');
const ENGINE_ON = opt('engine-on', 'desktop').split(',');
const ENGINE_TIMEOUT = Number(opt('engine-timeout', '240')) * 1000;
const IDLE_MS = Number(opt('idle', '3')) * 1000;
const PAGES = opt('pages', 'kiai-landing,kiai-app,hub').split(',');
const NO_GL = argv.includes('--no-webgl');
const OUT = opt('out', null);
const MD = opt('md', null);

async function loadPlaywright() {
  if (process.env.PLAYWRIGHT) return import(process.env.PLAYWRIGHT);
  try {
    return await import('playwright');
  } catch {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return import(path.join(root, 'playwright', 'index.mjs'));
  }
}

// ---------- tiny static server (SPA fallback, brotli for text like Vercel) ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm',
  '.gz': 'application/octet-stream', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg',
};
const COMPRESS = /\.(html|js|mjs|css|json|svg|txt|webmanifest|wasm)$/;
function serveDir(dir) {
  const brCache = new Map();
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let rel = decodeURIComponent(url.pathname);
    if (rel.startsWith('/api/')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end('{"error":"no api in speed-bench"}');
    }
    let file = path.join(dir, rel);
    if (!file.startsWith(dir)) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!existsSync(file)) {
      if (existsSync(file + '.html')) file += '.html';
      else if (!path.extname(rel)) file = path.join(dir, 'index.html');
      else return res.writeHead(404).end();
    }
    const ext = path.extname(file);
    const headers = { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'no-cache' };
    let body = readFileSync(file);
    if (COMPRESS.test(file) && /\bbr\b/.test(req.headers['accept-encoding'] ?? '') && body.length > 1024) {
      let c = brCache.get(file);
      if (!c) {
        c = brotliCompressSync(body, { params: { [zc.BROTLI_PARAM_QUALITY]: body.length > 2e6 ? 5 : 9 } });
        brCache.set(file, c);
      }
      body = c;
      headers['content-encoding'] = 'br';
    }
    headers['content-length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}
async function target(arg) {
  if (/^https?:\/\//.test(arg)) return { url: arg.replace(/\/$/, ''), server: null, src: arg };
  const dir = path.resolve(arg);
  if (!existsSync(path.join(dir, 'index.html'))) throw new Error(`${dir} has no index.html (build it first)`);
  const s = await serveDir(dir);
  return { ...s, src: dir };
}

// ---------- in-page probes (installed before any page script) ----------
const PROBE = () => {
  const b = (window.__bench = { longTaskMs: 0, longTasks: 0, lcp: 0, ready: null, loaderOut: null });
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        b.longTaskMs += e.duration;
        b.longTasks++;
      }
    }).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) b.lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    /* unsupported */
  }
  addEventListener('kiai-ready', () => (b.ready ??= performance.now()));
  // When the 気合 loader sheet starts to fade (class kl-out) or is gone.
  const mo = new MutationObserver(() => {
    const el = document.getElementById('kiai-loader');
    if (b.loaderOut === null && b.sawLoader && (!el || el.classList.contains('kl-out'))) b.loaderOut = performance.now();
    if (el) b.sawLoader = true;
  });
  mo.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
};

const PROFILES = {
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, cpu: 1 },
  phone: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    cpu: 4,
  },
};

const kindOf = (type, mime) => {
  if (type === 'Script' || /javascript/.test(mime)) return 'js';
  if (type === 'Stylesheet' || /css/.test(mime)) return 'css';
  if (type === 'Font' || /font/.test(mime)) return 'font';
  if (type === 'Image' || /^image\//.test(mime)) return 'img';
  if (type === 'Document') return 'html';
  return 'other';
};

async function measure(browser, page0, profileName, opts = {}) {
  const prof = PROFILES[profileName];
  const { cpu, ...ctxOpts } = prof;
  const context = await browser.newContext({ ...ctxOpts, serviceWorkers: 'block' });
  if (opts.storage) await context.addInitScript((kv) => {
    try {
      for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  }, opts.storage);
  await context.addInitScript(PROBE);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const reqs = new Map();
  const bytes = { js: 0, css: 0, font: 0, img: 0, html: 0, other: 0, total: 0, requests: 0, failed: 0 };
  cdp.on('Network.responseReceived', (e) => reqs.set(e.requestId, kindOf(e.type, e.response.mimeType)));
  cdp.on('Network.loadingFinished', (e) => {
    const k = reqs.get(e.requestId) ?? 'other';
    bytes[k] += e.encodedDataLength;
    bytes.total += e.encodedDataLength;
    bytes.requests++;
  });
  cdp.on('Network.loadingFailed', () => bytes.failed++);

  const t0 = Date.now();
  await page.goto(page0, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(500);

  // Average frame time over IDLE_MS of whatever animates on its own.
  const frames = await page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const d = [];
        let last = performance.now();
        const start = last;
        const tick = (t) => {
          d.push(t - last);
          last = t;
          if (t - start < ms) requestAnimationFrame(tick);
          else {
            if (d.length > 1) d.shift();
            d.sort((a, b) => a - b);
            const avg = d.reduce((a, b) => a + b, 0) / d.length;
            resolve({ avg, p95: d[Math.floor(d.length * 0.95)] ?? 0, frames: d.length, over33: d.filter((x) => x > 33.4).length });
          }
        };
        requestAnimationFrame((t) => {
          last = t;
          requestAnimationFrame(tick);
        });
      }),
    IDLE_MS,
  );

  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    const b = window.__bench;
    return {
      fcp: fcp?.startTime ?? null,
      lcp: b.lcp || null,
      dcl: nav?.domContentLoadedEventEnd ?? null,
      load: nav?.loadEventEnd ?? null,
      ready: b.ready,
      loaderOut: b.loaderOut,
      longTaskMs: b.longTaskMs,
      longTasks: b.longTasks,
    };
  });

  const pageBytes = { ...bytes }; // before the engine run's reload adds its own
  let engine = null;
  if (opts.engine) engine = await engineAnswer(page);
  await context.close();
  return { ...timing, frameAvg: frames.avg, frameP95: frames.p95, frames: frames.frames, framesOver33: frames.over33, bytes: pageBytes, wallMs: Date.now() - t0, engine };
}

/** Kiai app: open -> click the first suggested question -> answer drawn. Times in ms from navigation start. */
async function engineAnswer(page) {
  try {
    // Reload so the clock starts at page open again (the idle sampling above took a few seconds).
    await page.goto(page.url(), { waitUntil: 'commit' });
    const chip = page.locator('.ideas button').first();
    await chip.waitFor({ state: 'visible', timeout: 60_000 });
    const asked = await page.evaluate(() => performance.now());
    await chip.click();
    await page.waitForSelector('.msg.kami .msg-tools', { timeout: ENGINE_TIMEOUT });
    const done = await page.evaluate(() => performance.now());
    const note = await page.locator('.msg.kami').last().innerText();
    const error = /Something went wrong|Stopped\./.test(note) ? note.slice(0, 200) : null;
    return { askedAt: asked, answerAt: done, askToAnswer: done - asked, error };
  } catch (e) {
    return { error: String(e.message ?? e).slice(0, 200) };
  }
}

const median = (xs) => {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

function summarize(runs) {
  const pick = (f) => median(runs.map(f));
  const s = {
    fcp: pick((r) => r.fcp),
    lcp: pick((r) => r.lcp),
    dcl: pick((r) => r.dcl),
    load: pick((r) => r.load),
    ready: pick((r) => r.ready),
    loaderOut: pick((r) => r.loaderOut),
    longTaskMs: pick((r) => r.longTaskMs),
    frameAvg: pick((r) => r.frameAvg),
    frameP95: pick((r) => r.frameP95),
    framesOver33: pick((r) => r.framesOver33),
    bytes: {},
  };
  for (const k of Object.keys(runs[0].bytes)) s.bytes[k] = pick((r) => r.bytes[k]);
  const eng = runs.map((r) => r.engine).filter(Boolean);
  if (eng.length) s.engine = eng[0];
  return s;
}

// ---------- main ----------
const { chromium } = await loadPlaywright();
const kiai = await target(kiaiArg);
const hub = await target(hubArg);
// Headless Chromium draws WebGL with SwiftShader on the CPU (much slower than any real GPU);
// --no-webgl turns WebGL off so Kiai takes its flat-board path instead.
const browser = await chromium.launch({ args: NO_GL ? ['--disable-3d-apis'] : [] });
const chromiumVersion = browser.version();
const pages = [
  { id: 'kiai-landing', url: `${kiai.url}/`, storage: null },
  { id: 'kiai-app', url: `${kiai.url}/`, storage: { 'kiai.entered': '1', 'kiai.seen': '1' }, engine: true },
  { id: 'hub', url: `${hub.url}/`, storage: null },
].filter((p) => PAGES.includes(p.id));
const results = [];
for (const prof of PROFILE_NAMES) {
  for (const p of pages) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const wantEngine = p.engine && ENGINE_ON.includes(prof) && i === 0;
      process.stderr.write(`${p.id} ${prof} run ${i + 1}/${RUNS}${wantEngine ? ' + engine answer' : ''}\n`);
      runs.push(await measure(browser, p.url, prof, { storage: p.storage, engine: wantEngine }));
    }
    results.push({ page: p.id, profile: prof, median: summarize(runs), runs });
  }
}
await browser.close();
kiai.server?.close();
hub.server?.close();

const report = {
  when: new Date().toISOString(),
  sources: { kiai: kiai.src, hub: hub.src },
  runs: RUNS,
  idleMs: IDLE_MS,
  chromium: chromiumVersion,
  webgl: NO_GL ? 'off (--disable-3d-apis)' : 'SwiftShader (software)',
  note: 'medians of cold runs; ms from navigation start; bytes = encoded (br for text when served from a folder); phone = 390x844 @3x, 4x CPU throttle, no network throttle',
  results,
};

const ms = (x) => (x == null ? '–' : Math.round(x).toString());
const kb = (x) => (x == null ? '–' : (x / 1024).toFixed(0));
const md = [
  `Speed bench ${report.when} · ${RUNS} cold run(s) each, medians · phone = 390x844, 4x CPU · WebGL ${report.webgl} · ${report.chromium}`,
  '',
  '| page | profile | FCP | LCP | DCL | load | ready | long tasks ms | frame avg / p95 ms | >33ms frames | JS KB | CSS KB | font KB | img KB | total KB | reqs | first answer |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...results.map(({ page, profile, median: m }) => {
    const e = m.engine;
    const ans = !e ? '' : e.error ? `failed: ${e.error.slice(0, 60)}` : `${(e.answerAt / 1000).toFixed(1)} s (ask→answer ${(e.askToAnswer / 1000).toFixed(1)} s)`;
    return `| ${page} | ${profile} | ${ms(m.fcp)} | ${ms(m.lcp)} | ${ms(m.dcl)} | ${ms(m.load)} | ${ms(m.ready)} | ${ms(m.longTaskMs)} | ${m.frameAvg?.toFixed(1) ?? '–'} / ${m.frameP95?.toFixed(1) ?? '–'} | ${ms(m.framesOver33)} | ${kb(m.bytes.js)} | ${kb(m.bytes.css)} | ${kb(m.bytes.font)} | ${kb(m.bytes.img)} | ${kb(m.bytes.total)} | ${ms(m.bytes.requests)} | ${ans} |`;
  }),
  '',
  'ready = Kiai `kiai-ready` event (app/landing drawn under the loader). All times in ms from navigation start unless marked s.',
].join('\n');

if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 1));
if (MD) writeFileSync(MD, md + '\n');
console.log(md);
