#!/usr/bin/env node
/**
 * Regenerates the procedural sunrise-meadow artwork in public/art/.
 *
 *   node tools/art/render-meadow.mjs                        # all outputs (about a minute)
 *   node tools/art/render-meadow.mjs --only landscape,tall   # a subset (landscape | tall | clouds)
 *   node tools/art/render-meadow.mjs --preview /some/dir     # also write lossless PNG previews there
 *
 * The painting itself is produced by tools/art/meadow.html (deterministic, seeded, no network);
 * this script only drives it in headless Chromium through Playwright and writes the WebP files.
 * Playwright is looked up in the project first, then in the global npm root. Override with
 * PLAYWRIGHT_NODE_PATH=/path/to/node_modules and CHROMIUM_PATH=/path/to/chrome if needed.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const outDir = path.join(repoRoot, 'public/art');
const pageUrl = pathToFileURL(path.join(here, 'meadow.html')).href + '?noauto';

// Each job paints one source canvas; every output is resized from it, grained and encoded.
// Byte budgets (1 KB = 1000 B) sit a little under the limits the UI was designed around.
const JOBS = {
  landscape: {
    kind: 'scene', preset: 'landscape', w: 2560, h: 1440,
    outputs: [
      { file: 'meadow.webp', maxBytes: 440_000 },
      { file: 'meadow-1280.webp', w: 1280, h: 720, maxBytes: 155_000 },
    ],
  },
  tall: {
    kind: 'scene', preset: 'tall', w: 1080, h: 1920,
    outputs: [{ file: 'meadow-tall.webp', maxBytes: 290_000 }],
  },
  clouds: {
    kind: 'clouds', w: 2560, h: 720,
    outputs: [{ file: 'clouds.webp', maxBytes: 195_000 }],
  },
};

function parseArgs(argv) {
  const a = { only: Object.keys(JOBS), preview: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') a.only = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (argv[i] === '--preview') a.preview = path.resolve(argv[++i]);
    else if (argv[i] === '--help' || argv[i] === '-h') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); process.exit(0); }
  }
  for (const k of a.only) if (!JOBS[k]) throw new Error(`unknown output "${k}" (expected ${Object.keys(JOBS).join(', ')})`);
  return a;
}

function loadPlaywright() {
  const roots = [];
  if (process.env.PLAYWRIGHT_NODE_PATH) roots.push(process.env.PLAYWRIGHT_NODE_PATH);
  roots.push(path.join(repoRoot, 'node_modules'));
  try { roots.push(execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch { /* npm missing */ }
  roots.push('/opt/node22/lib/node_modules');
  for (const r of roots) {
    const req = createRequire(path.join(r, 'noop.js'));
    for (const name of ['playwright', 'playwright-core']) {
      try { return req(name); } catch { /* try next */ }
    }
  }
  throw new Error('Playwright not found: install it (npm i -D playwright && npx playwright install chromium) or set PLAYWRIGHT_NODE_PATH.');
}

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const known = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  return fs.existsSync(known) ? known : undefined; // undefined: Playwright's own download
}

function writeDataURL(file, dataURL) {
  const buf = Buffer.from(dataURL.slice(dataURL.indexOf(',') + 1), 'base64');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return buf.length;
}

const args = parseArgs(process.argv.slice(2));
const { chromium } = loadPlaywright();
const browser = await chromium.launch({
  executablePath: chromiumPath(),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-networking', '--disable-component-update'],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', e => { console.error('[page error]', e.message); });
  await page.goto(pageUrl);
  await page.waitForFunction(() => !!window.MeadowArt);
  for (const key of args.only) {
    const job = JOBS[key];
    const t0 = Date.now();
    const results = await page.evaluate(({ job, preview }) => {
      const src = job.kind === 'clouds'
        ? MeadowArt.renderClouds(job.w, job.h)
        : MeadowArt.render(job.preset, job.w, job.h);
      return job.outputs.map(o => {
        const out = MeadowArt.finalize(src, o.w || job.w, o.h || job.h, job.kind);
        const enc = MeadowArt.encode(out, 'image/webp', o.maxBytes);
        return { file: o.file, webp: enc.dataURL, quality: enc.quality, w: out.width, h: out.height, png: preview ? out.toDataURL('image/png') : null };
      });
    }, { job, preview: !!args.preview });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    for (const r of results) {
      const bytes = writeDataURL(path.join(outDir, r.file), r.webp);
      if (args.preview) writeDataURL(path.join(args.preview, r.file.replace(/\.webp$/, '.png')), r.png);
      console.log(`${r.file.padEnd(18)} ${`${r.w}x${r.h}`.padEnd(10)} ${(bytes / 1000).toFixed(1).padStart(6)} KB  q=${r.quality.toFixed(3)}`);
    }
    console.log(`  (${key}: ${secs} s)`);
  }
} finally {
  await browser.close();
}
