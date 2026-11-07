// Hub cold load on a phone: 390x844, 4x CPU throttle from the first byte (Playwright + CDP).
// node hub-cold-load.cjs [base=http://localhost:7791] [runs=10]
// RUNS=20 node hub-cold-load.cjs URL_A URL_B   runs A and B interleaved (A,B then B,A) and prints median and p90
// for each, plus B minus A. Needs hub-seed-server.mjs (BIG=1 for the 65-thread list).
// Each run is a fresh browser context signed in with the saved password only, so there is no reload cache
// (localStorage "hub-cache"): the page paints its shell, asks the hub for state, then draws the list.
// Measures, in ms from navigation start:
//   fcp    first contentful paint
//   row    the first thread row in the DOM plus two frames (drawn; on the phone it sits in the Threads tab)
//   ready  the Project chat feed has its first message plus two frames
//   tbt    total blocking time (long tasks past 50 ms) up to "ready", a stand-in for time to interactive
// With CACHE=1 the run loads the page once, then measures a second load that starts from the reload cache.
const { chromium } = (() => { try { return require('playwright'); } catch { return require('/opt/node22/lib/node_modules/playwright'); } })();
const args = process.argv.slice(2);
const AB = /^https?:/.test(args[1] || '');
const BASE = args[0] || 'http://localhost:7791';
const BASE_B = AB ? args[1] : null;
const N = Number((AB ? args[2] : args[1]) || process.env.RUNS || (AB ? 20 : 10));
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };

async function oneRun(b, base) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addInitScript(() => {
    try { localStorage.setItem('hubpw', 'dev'); } catch {}
    const m = (window.__m = { lt: [] });
    const twoFrames = (k) => requestAnimationFrame(() => requestAnimationFrame(() => { m[k] = performance.now(); }));
    new PerformanceObserver((l) => { for (const e of l.getEntries()) m.lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
    const mo = new MutationObserver(() => {
      if (!m.rowAt && document.querySelector('#threads .trow.t1')) { m.rowAt = performance.now(); twoFrames('row'); }
      if (!m.feedAt && document.querySelector('#feed > .sw, #feed > .row')) { m.feedAt = performance.now(); twoFrames('ready'); }
      if (m.rowAt && m.feedAt) mo.disconnect();
    });
    mo.observe(document, { childList: true, subtree: true });
  });
  const p = await c.newPage();
  const cdp = await c.newCDPSession(p);
  if (process.env.CACHE === '1') { await p.goto(base + '/'); await p.waitForSelector('#threads .trow.t1', { state: 'attached' }); await p.waitForTimeout(2500); }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await p.goto(base + '/');
  await p.waitForFunction(() => window.__m.row && window.__m.ready, null, { timeout: 30_000 });
  await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const m = window.__m;
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0;
    const tbt = m.lt.filter(([s]) => s < m.ready).reduce((n, [, d]) => n + Math.max(0, d - 50), 0);
    return { fcp: Math.round(fcp), row: Math.round(m.row), ready: Math.round(m.ready), tbt: Math.round(tbt) };
  });
  await c.close();
  return r;
}

const KEYS = ['fcp', 'row', 'ready', 'tbt'];
const summary = (runs) => Object.fromEntries(KEYS.flatMap((k) => [[k + 'Med', pct(runs.map((x) => x[k]), 0.5)], [k + 'P90', pct(runs.map((x) => x[k]), 0.9)]]));
const line = (s) => KEYS.map((k) => `${k} median ${s[k + 'Med']} p90 ${s[k + 'P90']}`).join(' | ');

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
    const order = r % 2 ? [[B, BASE_B], [A, BASE]] : [[A, BASE], [B, BASE_B]];
    for (const [into, base] of order) into.push(await oneRun(b, base));
    process.stderr.write(`run ${r + 1}/${N}: A ${JSON.stringify(A.at(-1))} | B ${JSON.stringify(B.at(-1))}\n`);
  }
  await b.close();
  const sa = summary(A), sb = summary(B);
  console.log(JSON.stringify({ A, B }));
  console.log(`A ${BASE}: ${line(sa)}`);
  console.log(`B ${BASE_B}: ${line(sb)}`);
  const d = (k) => `${sb[k] - sa[k] >= 0 ? '+' : ''}${sb[k] - sa[k]}`;
  console.log(`B-A (${N} interleaved runs each, ms): ${KEYS.map((k) => `${k} median ${d(k + 'Med')} p90 ${d(k + 'P90')}`).join(' | ')}`);
})().catch((e) => { console.error(e); process.exit(1); });
