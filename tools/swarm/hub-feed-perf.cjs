// Long-thread scroll speed on a phone: 390x844, 4x CPU throttle (Playwright + CDP).
// node hub-feed-perf.cjs [base=http://localhost:7791] [runs=6] [waitMs=2000]
// Needs hub-seed-server.mjs with BIG=1 (LONG=500 for a 500-message thread). ALL=1 first presses
// "Show earlier messages" until every message is drawn, then jumps back to the bottom. Per run: thread-open ms (click to the
// second frame), then a fast fling to the top after waitMs; dropped = frames lost against 60 Hz.
// Headless touch flings do not scroll the feed, so the fling is a mouse-wheel gesture (8000 px at 5000 px/s).
const { chromium } = (() => { try { return require('playwright'); } catch { return require('/opt/node22/lib/node_modules/playwright'); } })();
const [BASE = 'http://localhost:7791', RUNS = '6', WAIT = '2000'] = process.argv.slice(2);
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const runs = [];
  for (let r = 0; r < Number(RUNS); r++) {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await c.addInitScript(() => { try { localStorage.setItem('hubpw', 'dev'); } catch {} });
    const p = await c.newPage();
    const cdp = await c.newCDPSession(p);
    await p.goto(BASE + '/'); await p.waitForSelector('.trow', { state: 'attached' }); await p.waitForTimeout(1500);
    await p.click('.tabs button[data-tab="threads"]'); await p.waitForTimeout(400);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const openMs = await p.evaluate(async () => {
      const row = [...document.querySelectorAll('[data-thread]')].find((x) => /Long thread/.test(x.textContent));
      const t0 = performance.now();
      row.click();
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      return performance.now() - t0;
    });
    if (process.env.ALL === '1') {
      for (let i = 0; i < 20 && await p.locator('[data-feed-more]').count(); i++) { await p.click('[data-feed-more]'); await p.waitForTimeout(300); }
      // "Show earlier" leaves the view near the top: back to the newest message, as after opening.
      await p.evaluate(() => { const f = document.getElementById('feed'); f.scrollTop = f.scrollHeight; });
    }
    await p.waitForTimeout(Number(WAIT));
    const drawn = await p.evaluate(() => [document.querySelectorAll('#feed > .sw').length, document.querySelectorAll('#feed > .sw.warm').length]);
    await p.evaluate(() => { window.__fr = []; let last = performance.now(); const tick = (t) => { window.__fr.push(t - last); last = t; if (window.__run) requestAnimationFrame(tick); }; window.__run = true; requestAnimationFrame(tick); window.__wheel = 0; document.getElementById('feed').addEventListener('wheel', () => window.__wheel++, { passive: true }); });
    const before = await p.evaluate(() => document.getElementById('feed').scrollTop);
    await cdp.send('Input.synthesizeScrollGesture', { x: 195, y: 420, yDistance: 8000, speed: 5000, gestureSourceType: 'mouse', repeatCount: 1 });
    const fr = await p.evaluate(() => { window.__run = false; return window.__fr.slice(1); });
    const [after, warmEnd, wheel] = await p.evaluate(() => [document.getElementById('feed').scrollTop, document.querySelectorAll('#feed > .sw.warm').length, window.__wheel]);
    runs.push({
      openMs: Math.round(openMs),
      dropped: fr.reduce((n, d) => n + Math.max(0, Math.round(d / 16.67) - 1), 0),
      worstMs: Math.round(Math.max(...fr)),
      scrolledPx: Math.round(before - after),
      messages: drawn[0], warm: drawn[1], warmEnd, wheel,
    });
    await c.close();
  }
  await b.close();
  const col = (k) => runs.map((x) => x[k]);
  console.log(JSON.stringify(runs));
  console.log(`open ms median ${pct(col('openMs'), 0.5)} p90 ${pct(col('openMs'), 0.9)} | dropped median ${pct(col('dropped'), 0.5)} p90 ${pct(col('dropped'), 0.9)} | worst frame median ${pct(col('worstMs'), 0.5)} ms`);
})().catch((e) => { console.error(e); process.exit(1); });
