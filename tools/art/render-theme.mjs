#!/usr/bin/env node
/**
 * Renders the procedural theme paintings into public/art/<theme>/.
 *
 *   node tools/art/render-theme.mjs sakura                  # every output of one theme
 *   node tools/art/render-theme.mjs all                     # sakura, mist, aurora and the sunrise thumbnail
 *   node tools/art/render-theme.mjs mist --only landscape   # a subset of one theme's jobs (see JOBS in its page)
 *   node tools/art/render-theme.mjs aurora --preview /dir   # also write lossless PNG previews there
 *   node tools/art/render-theme.mjs sunrise                 # only public/art/sunrise/thumb.webp, from meadow.webp
 *
 * Each painting is produced by tools/art/<theme>.html (deterministic, seeded, no network) with the
 * shared helpers in tools/art/artkit.js. The page lists its own jobs (ThemeArt.jobs); this script only
 * drives it in headless Chromium through Playwright and writes the WebP files, each at the highest
 * quality that fits its byte budget. Playwright is looked up in the project first, then in the global
 * npm root. Override with PLAYWRIGHT_NODE_PATH=/path/to/node_modules and CHROMIUM_PATH=/path/to/chrome.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const artDir = path.join(repoRoot, 'public/art');
const THEMES = ['sakura', 'mist', 'aurora'];

function parseArgs(argv) {
  const a = { themes: [], only: null, preview: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--only') a.only = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (v === '--preview') a.preview = path.resolve(argv[++i]);
    else if (v === '--help' || v === '-h') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); process.exit(0); }
    else a.themes.push(...v.split(',').map(s => s.trim()).filter(Boolean));
  }
  if (!a.themes.length || a.themes.includes('all')) a.themes = [...THEMES, 'sunrise'];
  for (const t of a.themes) if (t !== 'sunrise' && !THEMES.includes(t)) throw new Error(`unknown theme "${t}" (expected ${THEMES.join(', ')}, sunrise or all)`);
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
  return fs.existsSync(known) ? known : undefined;
}

function writeDataURL(file, dataURL) {
  const buf = Buffer.from(dataURL.slice(dataURL.indexOf(',') + 1), 'base64');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return buf.length;
}
function report(dir, r, bytes) {
  console.log(`${path.join(path.relative(artDir, dir), r.file).padEnd(26)} ${`${r.w}x${r.h}`.padEnd(10)} ${(bytes / 1000).toFixed(1).padStart(6)} KB  q=${r.quality.toFixed(3)}`);
}

const args = parseArgs(process.argv.slice(2));
const { chromium } = loadPlaywright();
const browser = await chromium.launch({
  executablePath: chromiumPath(),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-networking', '--disable-component-update'],
});
try {
  for (const theme of args.themes) {
    const page = await browser.newPage();
    page.on('pageerror', e => { console.error(`[${theme} page error]`, e.message); });
    const outDir = path.join(artDir, theme);
    if (theme === 'sunrise') {
      // The sunrise painting comes from meadow.html; its thumbnail is a downscale of the finished landscape.
      await page.goto(pathToFileURL(path.join(here, 'sakura.html')).href + '?noauto');
      await page.waitForFunction(() => !!window.ArtKit);
      const src = 'data:image/webp;base64,' + fs.readFileSync(path.join(artDir, 'meadow.webp')).toString('base64');
      const r = await page.evaluate(async ({ src, preview }) => {
        const img = new Image(); img.src = src; await img.decode();
        const c = ArtKit.makeCanvas(img.naturalWidth, img.naturalHeight); c.getContext('2d').drawImage(img, 0, 0);
        return ArtKit.outputs(c, { kind: 'thumb', w: 480, h: 270, outputs: [{ file: 'thumb.webp', maxBytes: 26_000 }] }, preview)[0];
      }, { src, preview: !!args.preview });
      const bytes = writeDataURL(path.join(outDir, r.file), r.webp);
      if (args.preview) writeDataURL(path.join(args.preview, theme, r.file.replace(/\.webp$/, '.png')), r.png);
      report(outDir, r, bytes);
      await page.close();
      continue;
    }
    await page.goto(pathToFileURL(path.join(here, `${theme}.html`)).href + '?noauto');
    await page.waitForFunction(() => !!window.ThemeArt);
    const jobs = await page.evaluate(() => Object.keys(ThemeArt.jobs));
    for (const key of args.only || jobs) {
      if (!jobs.includes(key)) throw new Error(`${theme} has no job "${key}" (expected ${jobs.join(', ')})`);
      const t0 = Date.now();
      const results = await page.evaluate(({ key, preview }) => {
        const job = ThemeArt.jobs[key];
        const src = job.strip ? ThemeArt.strip(job.strip, job.w, job.h) : ThemeArt.render(job.preset, job.w, job.h);
        return ArtKit.outputs(src, job, preview);
      }, { key, preview: !!args.preview });
      for (const r of results) {
        const bytes = writeDataURL(path.join(outDir, r.file), r.webp);
        if (args.preview) writeDataURL(path.join(args.preview, theme, r.file.replace(/\.webp$/, '.png')), r.png);
        report(outDir, r, bytes);
      }
      console.log(`  (${theme}/${key}: ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
