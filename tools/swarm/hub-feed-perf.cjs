// Long-thread scroll speed on a phone: 390x844, 4x CPU throttle (Playwright + CDP).
// node hub-feed-perf.cjs [base=http://localhost:7791] [runs=6] [waitMs=2000]
// Needs hub-seed-server.mjs with BIG=1 (LONG=500 for a 500-message thread). ALL=1 first presses
// "Show earlier messages" until every message is drawn, then jumps back to the bottom. Per run: thread-open ms (click to the
// second frame), then a fast fling to the top after waitMs; dropped = frames lost against 60 Hz.
// Headless touch flings do not scroll the feed, so the fling is a mouse-wheel gesture (8000 px at 5000 px/s).
// Compare two servers (main and a branch), interleaved so drift in the sandbox hits both alike:
// RUNS=20 node hub-feed-perf.cjs URL_A URL_B [runs] [waitMs]   runs alternate A,B then B,A (ABBA), and it prints
// median and p90 of thread-open ms and dropped frames for each, plus B minus A.
const { chromium } = (() => { try { return require('playwright'); } catch { return require('/opt/node22/lib/node_modules/playwright'); } })();
const args = process.argv.slice(2);
const AB = /^https?:/.test(args[1] || '');
const [BASE = 'http://localhost:7791', RUNS = '', WAIT = '2000'] = AB ? [args[0], args[2], args[3]] : args;
const BASE_B = AB ? args[1] : null;
const N = Number(RUNS || process.env.RUNS || (AB ? 20 : 6));
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };

async function oneRun(b, base) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addInitScript(() => { try { localStorage.setItem('hubpw', 'dev'); } catch {} });
  const p = await c.newPage();
  const cdp = await c.newCDPSession(p);
  await p.goto(base + '/'); await p.waitForSelector('.trow', { state: 'attached' }); await p.waitForTimeout(1500);
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
  await c.close();
  return {
    openMs: Math.round(openMs),
    dropped: fr.reduce((n, d) => n + Math.max(0, Math.round(d / 16.67) - 1), 0),
    worstMs: Math.round(Math.max(...fr)),
    scrolledPx: Math.round(before - after),
    messages: drawn[0], warm: drawn[1], warmEnd, wheel,
  };
}

const summary = (runs) => {
  const col = (k) => runs.map((x) => x[k]);
  return { openMed: pct(col('openMs'), 0.5), openP90: pct(col('openMs'), 0.9), dropMed: pct(col('dropped'), 0.5), dropP90: pct(col('dropped'), 0.9), worstMed: pct(col('worstMs'), 0.5) };
};
const line = (s) => `open ms median ${s.openMed} p90 ${s.openP90} | dropped median ${s.dropMed} p90 ${s.dropP90} | worst frame median ${s.worstMed} ms`;

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  if (!AB) {
    const runs = [];
    for (let r = 0; r < N; r++) runs.push(await oneRun(b, BASE));
    await b.close();
    console.log(JSON.stringify(runs));
    console.log(line(summary(runs)));
    return;
  }
  const A = [], B = [];
  for (let r = 0; r < N; r++) {
    // ABBA: A first on even runs, B first on odd runs, so neither side always gets the warmer sandbox.
    const order = r % 2 ? [[B, BASE_B], [A, BASE]] : [[A, BASE], [B, BASE_B]];
    for (const [into, base] of order) into.push(await oneRun(b, base));
    process.stderr.write(`run ${r + 1}/${N}: A open ${A.at(-1).openMs} dropped ${A.at(-1).dropped} | B open ${B.at(-1).openMs} dropped ${B.at(-1).dropped}\n`);
  }
  await b.close();
  const sa = summary(A), sb = summary(B);
  console.log(JSON.stringify({ A, B }));
  console.log(`A ${BASE}: ${line(sa)}`);
  console.log(`B ${BASE_B}: ${line(sb)}`);
  const d = (k) => `${sb[k] - sa[k] >= 0 ? '+' : ''}${sb[k] - sa[k]}`;
  console.log(`B-A (${N} interleaved runs each): open median ${d('openMed')} ms, p90 ${d('openP90')} ms | dropped median ${d('dropMed')}, p90 ${d('dropP90')}`);
})().catch((e) => { console.error(e); process.exit(1); });
