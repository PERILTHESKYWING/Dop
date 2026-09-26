#!/usr/bin/env node
/**
 * Writes the DOPPELGÄNGER app icons from one set of SVG builders:
 *
 *   public/favicon.svg                   tab icon: the sunrise tile, stones enlarged for 16 px
 *   public/icons/favicon-32.png          the same, for browsers without SVG favicons
 *   public/icons/apple-touch-icon.png    180, full bleed (iOS rounds the corners itself)
 *   public/icons/icon-192.png            rounded tile, transparent corners (manifest, purpose "any")
 *   public/icons/icon-512.png
 *   public/icons/icon-maskable-512.png   full bleed, the mark inside the 80% safe circle (purpose "maskable")
 *
 *   node tools/brand/render-icons.mjs                  # write everything
 *   node tools/brand/render-icons.mjs --preview DIR    # also write DIR/icons-preview.png, a contact sheet
 *
 * The mark is the one drawn by BrandMark in src/components/Icons.tsx (viewBox 64): a slate stone and its
 * shell-white double overlap on a diagonal, the lens where they agree glows, and a split orbit of two
 * tapered crescents surrounds them. On the tile the orbit and the lens are cream, since the tile is the sunrise.
 * Rasterising runs in headless Chromium through Playwright (project, then global npm root; override with
 * PLAYWRIGHT_NODE_PATH and CHROMIUM_PATH).
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const pub = path.join(repoRoot, 'public');

const f = (n) => +n.toFixed(2);
/** Two stones of radius r whose centres sit a·√2 either side of the middle, on the rising diagonal. */
function stones(a, r) {
  const k = Math.sqrt(r * r - 2 * a * a) / Math.SQRT2;
  const p1 = `${f(32 - k)} ${f(32 - k)}`;
  const p2 = `${f(32 + k)} ${f(32 + k)}`;
  return { black: [f(32 - a), f(32 + a)], white: [f(32 + a), f(32 - a)], r, lens: `M${p1}A${r} ${r} 0 0 1 ${p2}A${r} ${r} 0 0 1 ${p1}Z` };
}
/** The split orbit: two crescents, outer r 30, 4.2 thick in the middle, tapering to the mirror axis. */
const ORBIT =
  'M17 6.02A30 30 0 0 1 57.98 47L56.8 46.32A30 30 0 0 0 17.68 7.2ZM47 57.98A30 30 0 0 1 6.02 17L7.2 17.68A30 30 0 0 0 46.32 56.8Z';

/**
 * The sunrise tile. `a`/`r`: stone placement and size; `gap`: the cut around the lens; `orbit`: draw the
 * crescents; `scale`: shrink the artwork towards the middle (safe zones); `rx`: corner radius, 0 = full bleed.
 */
function tile({ a = 6.4, r = 15.5, gap = 3, orbit = true, scale = 1, rx = 14.4, shading = true, small = false }) {
  const s = stones(a, r);
  const t = scale === 1 ? '' : ` transform="translate(32 32) scale(${scale}) translate(-32 -32)"`;
  const black = shading ? 'url(#b)' : '#18171c';
  const white = shading ? 'url(#w)' : '#fffaf2';
  // At tab size a bright highlight turns the black stone grey and a pale lens merges into the white stone,
  // so the small version keeps the black darker and the lens more golden.
  const blackStops = small ? ['#4c515c', '#1c1e23', '#060607'] : ['#6f7582', '#23262d', '#050506'];
  const lensStops = small ? ['#fff2d2', '#ffc270'] : ['#fffaf0', '#ffd59a'];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs>
<linearGradient id="t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffc46a"/><stop offset=".5" stop-color="#ff8e52"/><stop offset="1" stop-color="#f0566f"/></linearGradient>
<linearGradient id="gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient>
<radialGradient id="b" cx=".36" cy=".3" r=".78"><stop offset="0" stop-color="${blackStops[0]}"/><stop offset=".42" stop-color="${blackStops[1]}"/><stop offset="1" stop-color="${blackStops[2]}"/></radialGradient>
<radialGradient id="w" cx=".36" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".7" stop-color="#f7f2ea"/><stop offset="1" stop-color="#e0d5c4"/></radialGradient>
<radialGradient id="l" cx=".5" cy=".5" r=".62"><stop offset="0" stop-color="${lensStops[0]}"/><stop offset="1" stop-color="${lensStops[1]}"/></radialGradient>
<radialGradient id="sh"><stop offset=".68" stop-color="#7a200c" stop-opacity=".32"/><stop offset="1" stop-color="#7a200c" stop-opacity="0"/></radialGradient>
<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#fff"/><path d="${s.lens}" stroke="#000" stroke-width="${gap}"/></mask>
</defs>
<rect width="64" height="64" rx="${rx}" fill="url(#t)"/>
<rect width="64" height="64" rx="${rx}" fill="url(#gl)"/>
<g${t}>
${shading ? [s.black, s.white].map(([x, y]) => `<circle cx="${f(x + 0.8)}" cy="${f(y + 2)}" r="${f(r * 1.2)}" fill="url(#sh)"/>`).join('') : ''}
${orbit ? `<path class="orbit" d="${ORBIT}" fill="#fff6e8" transform="translate(32 32) scale(.86) translate(-32 -32)"/>` : ''}
<g mask="url(#m)"><circle cx="${s.black[0]}" cy="${s.black[1]}" r="${r}" fill="${black}"/><circle cx="${s.white[0]}" cy="${s.white[1]}" r="${r}" fill="${white}"/></g>
<path d="${s.lens}" fill="url(#l)"/>
</g>
</svg>
`;
}

// The tab icon: no orbit and bigger stones so the pair still reads at 16 px.
const favicon = tile({ a: 7.6, r: 17.5, gap: 4.2, orbit: false, rx: 14, small: true });
const app = (opts) => tile({ ...opts });

const OUTPUTS = [
  { file: 'favicon.svg', svg: favicon },
  { file: 'icons/favicon-32.png', svg: favicon, size: 32 },
  { file: 'icons/apple-touch-icon.png', svg: app({ rx: 0, scale: 0.9 }), size: 180 },
  { file: 'icons/icon-192.png', svg: app({ scale: 0.94 }), size: 192 },
  { file: 'icons/icon-512.png', svg: app({ scale: 0.94 }), size: 512 },
  // Safe zone: a circle of radius 40%. The orbit's outer edge sits at 25.8 * 0.86 = 22.2 of 64 (35%).
  { file: 'icons/icon-maskable-512.png', svg: app({ rx: 0, scale: 0.86 }), size: 512 },
];

function loadPlaywright() {
  const roots = [];
  if (process.env.PLAYWRIGHT_NODE_PATH) roots.push(process.env.PLAYWRIGHT_NODE_PATH);
  roots.push(path.join(repoRoot, 'node_modules'));
  try {
    roots.push(execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    /* npm missing */
  }
  roots.push('/opt/node22/lib/node_modules');
  for (const r of roots) {
    const req = createRequire(path.join(r, 'noop.js'));
    for (const name of ['playwright', 'playwright-core']) {
      try {
        return req(name);
      } catch {
        /* try next */
      }
    }
  }
  throw new Error('Playwright not found: install it (npm i -D playwright && npx playwright install chromium) or set PLAYWRIGHT_NODE_PATH.');
}
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const known = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  return fs.existsSync(known) ? known : undefined;
}

const argv = process.argv.slice(2);
const previewDir = argv.includes('--preview') ? path.resolve(argv[argv.indexOf('--preview') + 1]) : null;

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: chromiumPath() });
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><body></body>');
  for (const o of OUTPUTS) {
    const out = path.join(pub, o.file);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (!o.size) {
      fs.writeFileSync(out, o.svg);
      console.log(`${o.file.padEnd(30)} ${(o.svg.length / 1000).toFixed(1)} KB`);
      continue;
    }
    const dataURL = await page.evaluate(
      async ({ svg, size }) => {
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        await img.decode();
        const c = document.createElement('canvas');
        c.width = c.height = size;
        c.getContext('2d').drawImage(img, 0, 0, size, size);
        return c.toDataURL('image/png');
      },
      { svg: o.svg, size: o.size },
    );
    const buf = Buffer.from(dataURL.slice(dataURL.indexOf(',') + 1), 'base64');
    fs.writeFileSync(out, buf);
    console.log(`${o.file.padEnd(30)} ${`${o.size}x${o.size}`.padEnd(8)} ${(buf.length / 1000).toFixed(1)} KB`);
  }
  if (previewDir) {
    fs.mkdirSync(previewDir, { recursive: true });
    const dataUrl = (file) => {
      const type = file.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
      return `data:${type};base64,${fs.readFileSync(path.join(pub, file)).toString('base64')}`;
    };
    const cells = OUTPUTS.map((o) => {
      const src = dataUrl(o.file);
      const n = o.size ?? 64;
      return `<figure><div class="bg light"><img src="${src}" width="${Math.min(n, 256)}"></div><div class="bg dark"><img src="${src}" width="${Math.min(n, 256)}"></div><figcaption>${o.file}</figcaption></figure>`;
    }).join('');
    const small = [16, 32].map((n) => `<figure><div class="bg light px"><img src="${dataUrl('favicon.svg')}" width="${n}"></div><figcaption>favicon.svg @${n}</figcaption></figure>`).join('');
    await page.setContent(`<!doctype html><style>body{margin:0;padding:12px;font:12px system-ui;display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;background:#fff}
      figure{margin:0;text-align:center}.bg{padding:12px}.light{background:#f4ede4}.dark{background:#15182a}</style>${cells}${small}`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(previewDir, 'icons-preview.png'), fullPage: true });
    console.log('preview', path.join(previewDir, 'icons-preview.png'));
  }
} finally {
  await browser.close();
}
