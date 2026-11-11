// Layout shift while a long thread fills in (390 px phone, 4x CPU), main vs branch interleaved A,B / B,A.
// Seed both with BIG=1 LONG=500 IMGS=10 (a 768x512 picture every 10th message), then:
// TOP=1 SAFARI=1 DELAY=250 node hub-feed-shift.cjs URL_A URL_B [runs=6] [waitMs=8000]
// TOP=1 scrolls the reader near the top of the drawn feed while slices are prepended above it; SAFARI=1 turns
// scroll anchoring off on the feed (Safari has none). Prints CLS, and the jumps and pixels the first visible message
// moved with no input, median and p90 per server.
const { chromium } = (() => { try { return require('playwright'); } catch { return require('/opt/node22/lib/node_modules/playwright'); } })();
const [A, B, RUNS = '6', WAIT = '9000'] = process.argv.slice(2);
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };
async function one(b, base) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addInitScript(() => { try { localStorage.setItem('hubpw', 'dev'); } catch {} });
  const p = await c.newPage();
  const cdp = await c.newCDPSession(p);
  await p.goto(base + '/'); await p.waitForSelector('.trow', { state: 'attached' }); await p.waitForTimeout(1500);
  await p.click('.tabs button[data-tab="threads"]'); await p.waitForTimeout(400);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await p.evaluate(([top, safari, delay]) => {
    window.__top = top; window.__safari = safari; window.__delay = delay;
    window.__cls = 0; window.__shifts = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__cls += e.value; window.__shifts++; } }).observe({ type: 'layout-shift' });
    const row = [...document.querySelectorAll('[data-thread]')].find((x) => /Long thread/.test(x.textContent));
    row.click();
    // After the open settles, watch the newest message's place on screen every frame.
    window.__jumps = 0; window.__px = 0;
    setTimeout(() => {
      const f = document.getElementById('feed');
      let last = null, el = null;
      if (window.__safari) f.style.overflowAnchor = 'none';
      if (window.__top) f.scrollTop = 120;
      const tick = () => {
        if (!el || !el.isConnected) { el = window.__top ? [...f.querySelectorAll(':scope > .sw')].find((x) => x.getBoundingClientRect().bottom > f.getBoundingClientRect().top + 40) : [...f.querySelectorAll(':scope > .sw')].at(-1); last = null; }
        const y = el ? el.getBoundingClientRect().top : 0;
        if (last != null && Math.abs(y - last) > 0.5) { window.__jumps++; window.__px += Math.abs(y - last); }
        last = y;
        if (!window.__stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, Number(window.__delay));
  }, [process.env.TOP === '1', process.env.SAFARI === '1', process.env.DELAY || '1500']);
  await p.waitForTimeout(Number(WAIT));
  const r = await p.evaluate(() => { window.__stop = true; return { cls: +window.__cls.toFixed(4), shifts: window.__shifts, jumps: window.__jumps, px: Math.round(window.__px), pics: document.querySelectorAll('#feed img.pic[src]').length, picsAll: document.querySelectorAll('#feed img.pic').length, msgs: document.querySelectorAll('#feed > .sw').length }; });
  await c.close();
  return r;
}
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const res = { A: [], B: [] };
  for (let i = 0; i < Number(RUNS); i++) {
    const order = i % 2 ? [['B', B], ['A', A]] : [['A', A], ['B', B]];
    for (const [k, u] of order) { const r = await one(b, u); res[k].push(r); console.log(k, JSON.stringify(r)); }
  }
  for (const k of ['A', 'B']) { const col = (f) => res[k].map((x) => x[f]); console.log(k, 'cls median', pct(col('cls'), .5), 'p90', pct(col('cls'), .9), '| jumps median', pct(col('jumps'), .5), 'p90', pct(col('jumps'), .9), '| px median', pct(col('px'), .5), 'p90', pct(col('px'), .9)); }
  await b.close();
})();
