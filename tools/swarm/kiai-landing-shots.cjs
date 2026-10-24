// Landing shots: node landing.cjs <outdir> <webgl:0|1>
const { chromium } = (() => { try { return require('playwright'); } catch { return require('/opt/node-tools/node_modules/playwright'); } })();
const path = require('path');
const out = process.argv[2];
const webgl = process.argv[3] === '1';
const URL = 'http://localhost:4291/' + (process.argv[4] || '');
const vps = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  { name: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];
(async () => {
  const args = webgl ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--disable-webgl', '--disable-webgl2'];
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args });
  for (const vp of vps) {
    const ctx = await browser.newContext({ viewport: vp.viewport, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') console.log('console', vp.name, m.text().slice(0, 200)); });
    const t0 = Date.now();
    await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('.landing', { timeout: 30000 });
    console.log(vp.name, 'landing at', Date.now() - t0, 'ms');
    await page.waitForTimeout(process.argv[4] ? 15000 : 4000);
    // skip loader if still up
    await page.mouse.move(5, 5);
    const n = await page.$$eval('.l-anchor', (a) => a.length);
    for (let i = 0; i < n; i++) {
      await page.evaluate((i) => { const a = document.querySelectorAll('.l-anchor')[i]; window.scrollTo({ top: a.offsetTop, behavior: 'auto' }); }, i);
      await page.waitForTimeout(i === 1 || i === 2 ? 5000 : 3000);
      const file = path.join(out, `landing-${vp.name}-${i}.png`);
      try {
        await page.screenshot({ path: file, timeout: 20000 });
        console.log('shot', file);
      } catch (e) { console.log('fail', file, e.message.slice(0, 120)); }
    }
    // measure text sizes and overlaps in chapter 0
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => {
      const r = [];
      document.querySelectorAll('.l-ch.l-ask *').forEach((el) => {
        if (!el.childNodes.length) return;
        const t = [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent.trim()).join(' ');
        if (!t) return;
        const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
        r.push({ tag: el.tagName, cls: el.className && el.className.baseVal === undefined ? el.className : '', t: t.slice(0, 60), fs: cs.fontSize, fw: cs.fontWeight, color: cs.color, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) });
      });
      return r;
    });
    console.log(vp.name, JSON.stringify(info, null, 0));
    await ctx.close();
  }
  await browser.close();
})();
