#!/usr/bin/env node
/**
 * Renders the procedural kaya texture (tools/art/kaya.html) in headless Chromium and writes
 * public/art/kaya.webp, lowering the WebP quality until the file fits the size budget.
 *
 *   node tools/art/render-kaya.mjs [--seed 7] [--size 1024] [--max-kb 150] [--quality 0.92] [--out public/art/kaya.webp]
 *
 * Needs Playwright with a Chromium build. It uses the project's `playwright` package when
 * installed, otherwise a global install (PLAYWRIGHT_MODULE_DIR, default /opt/node22/lib/node_modules).
 * Set CHROMIUM_PATH to launch a specific Chromium binary.
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    /* not a project dependency: try a global install */
  }
  const dirs = [process.env.PLAYWRIGHT_MODULE_DIR, '/opt/node22/lib/node_modules', '/usr/local/lib/node_modules', '/usr/lib/node_modules'].filter(Boolean);
  for (const d of dirs) {
    try {
      return createRequire(resolve(d) + '/')('playwright');
    } catch {
      /* keep looking */
    }
  }
  throw new Error('Playwright not found. Install it (npm i -D playwright) or set PLAYWRIGHT_MODULE_DIR.');
}

const seed = Number(arg('seed', 7));
const size = Number(arg('size', 1024));
const maxBytes = Number(arg('max-kb', 150)) * 1024;
let quality = Number(arg('quality', 0.92));
const out = resolve(root, arg('out', 'public/art/kaya.webp'));

const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(resolve(here, 'kaya.html')).href + '?headless=1');
  await page.waitForFunction(() => window.kayaReady === true);
  let bytes;
  for (;;) {
    const url = await page.evaluate((o) => window.exportKaya(o), { seed, size, quality, type: 'image/webp' });
    if (!url.startsWith('data:image/webp')) throw new Error('This Chromium cannot encode WebP from a canvas.');
    bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    if (bytes.length <= maxBytes || quality <= 0.3) break;
    quality = Math.round((quality - 0.04) * 100) / 100;
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  console.log(`wrote ${out} · ${size}x${size} · seed ${seed} · quality ${quality} · ${(bytes.length / 1024).toFixed(1)} KB`);
} finally {
  await browser.close();
}
