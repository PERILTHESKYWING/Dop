// App shots + board-rect measurements: node app.cjs <outdir> [light|dark] [desktop|phone|both]
const { chromium } = (() => { try { return require('playwright'); } catch { return require('/opt/node-tools/node_modules/playwright'); } })();
const fs = require('fs');
const path = require('path');
const out = process.argv[2];
const scheme = process.argv[3] || 'light';
const which = process.argv[4] || 'both';
const PORT = process.env.PORT || 4291;
const demo = JSON.parse(fs.readFileSync(require('path').join(__dirname, '../../kami/src/ui/landing/demo.json'), 'utf8'));
const L = 'ABCDEFGHJKLMNOPQRST';
const sgfc = (g) => 'abcdefghijklmnopqrs'[L.indexOf(g[0])] + 'abcdefghijklmnopqrs'[19 - Number(g.slice(1))];
const sgf = '(;GM[1]FF[4]SZ[19]KM[7.5]' + demo.order.map((m, i) => `;${i % 2 ? 'W' : 'B'}[${sgfc(m)}]`).join('') + ')';
const vps = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  { name: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
].filter((v) => which === 'both' || v.name === which);
const rects = async (p) =>
  p.evaluate(() => {
    const r = (s) => {
      const e = document.querySelector(s);
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return [Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10, Math.round(b.width * 10) / 10, Math.round(b.height * 10) / 10];
    };
    return { square: r('.bp-square'), canvas: r('.bp-square canvas') || r('.bp-square svg'), head: r('.bp-head'), eval: r('.bp-eval'), foot: r('.bp-foot'), chip: r('.engine-chip'), players: r('.bp-players'), msgs: r('.messages'), composer: r('.composer') };
  });
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const report = {};
  for (const vp of vps) {
    const ctx = await browser.newContext({ viewport: vp.viewport, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch, reducedMotion: 'reduce', colorScheme: scheme });
    await ctx.addInitScript((LEVEL) => {
      try {
        localStorage.setItem('kiai.entered', '1');
        if (LEVEL !== 'default') localStorage.setItem('kiai.level', LEVEL);
      } catch {}
    }, process.env.LEVEL || 'medium');
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 200)));
    const shot = (n) => page.screenshot({ path: path.join(out, `app-${scheme}-${vp.name}-${n}.png`), timeout: 30000 }).catch((e) => console.log('fail', n, e.message.slice(0, 100)));
    const R = (report[vp.name] = {});
    await page.goto(`http://localhost:${PORT}/?kiai3d`, { waitUntil: 'load' });
    await page.waitForSelector('textarea', { timeout: 30000 });
    await page.waitForTimeout(4000);
    R.empty = await rects(page);
    R.emptyIdeas = await page.evaluate(() => {
      const c = document.querySelector('.composer').getBoundingClientRect();
      return [...document.querySelectorAll('.idea')].map((e) => { const b = e.getBoundingClientRect(); return { t: e.textContent, bottom: Math.round(b.bottom), composerTop: Math.round(c.top), visible: b.bottom <= c.top }; });
    });
    await shot('0-empty');
    await page.fill('textarea', sgf);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(9000);
    R.game = await rects(page);
    await shot('1-game');
    await page.fill('textarea', 'What should Black play here?');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(Number(process.env.THINK_MS || 900));
    R.thinking = await rects(page);
    await shot('2-thinking');
    for (let i = 0; i < 120; i++) {
      if (!(await page.$('[aria-label="Stop"]')) && i > 1) break;
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(2500);
    R.answer = await rects(page);
    R.answerLines = await page.evaluate(() => {
      const m = document.querySelector('.messages').getBoundingClientRect();
      const c = document.querySelector('.composer').getBoundingClientRect();
      const k = [...document.querySelectorAll('.msg.kami')].pop();
      const p = k && k.querySelector('.rich');
      if (!p) return null;
      const range = document.createRange();
      range.selectNodeContents(p);
      const ys = new Set();
      for (const r of range.getClientRects()) if (r.bottom <= Math.min(m.bottom, c.top) && r.top >= m.top) ys.add(Math.round(r.top));
      return { visibleLines: ys.size, msgsBottom: Math.round(m.bottom), composerTop: Math.round(c.top) };
    });
    R.chipText = await page.evaluate(() => document.querySelector('.engine-slot')?.textContent || '');
    R.players = await page.evaluate(() => [...document.querySelectorAll('.pl-name')].map((e) => ({ t: e.textContent, clipped: e.scrollWidth > e.clientWidth })));
    await shot('3-answer');
    // hover (desktop) or tap (phone) the first idea chip / point in the answer
    const tag = (await page.$('.msg.kami .tags .tag')) || (await page.$('.msg.kami .rich .pt'));
    if (tag) {
      if (vp.name === 'phone') await tag.tap();
      else await tag.hover();
      await page.waitForTimeout(2000);
      R.hover = await rects(page);
      R.hoverStyle = await page.evaluate(() => ({ eval: document.querySelector('.bp-eval')?.className + ' ' + getComputedStyle(document.querySelector('.bp-eval')).opacity, foot: getComputedStyle(document.querySelector('.bp-foot')).opacity }));
      await shot('4-hover');
    } else console.log('no tag to hover');
    // a candidate stone on the board: its line
    console.log(vp.name, scheme, JSON.stringify(R));
    await ctx.close();
  }
  fs.writeFileSync(path.join(out, `measure-${scheme}-${which}.json`), JSON.stringify(report, null, 1));
  await browser.close();
})();
