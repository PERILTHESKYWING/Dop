// Screenshots of the seeded hub. node hub-shots.cjs [outdir]
const { chromium } = (() => { try { return require('playwright'); } catch { return require('/opt/node22/lib/node_modules/playwright'); } })();
const path = require('path');
const fs = require('fs');
const OUT = process.argv[2] || path.join(__dirname, 'shots/before-hub');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:7791';

async function ctx(browser, { w, h, dark = false, mobile = false, logged = true }) {
  const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, colorScheme: dark ? 'dark' : 'light' });
  if (logged) await c.addInitScript(() => { try { localStorage.setItem('hubpw', 'dev'); } catch {} });
  return c;
}
const settle = (p, ms = 700) => p.waitForTimeout(ms);
async function openThread(p, title) {
  await p.locator('.trow', { hasText: title }).first().click();
  await settle(p);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const shots = [];
  const snap = async (p, name, full = false) => { const f = path.join(OUT, name + '.png'); await p.screenshot({ path: f, fullPage: full }); shots.push(f); };

  for (const dark of [false, true]) {
    const tag = dark ? 'dark' : 'light';
    // Desktop
    let c = await ctx(browser, { w: 1440, h: 900, dark, logged: false });
    let p = await c.newPage();
    await p.goto(BASE + '/'); await settle(p, 900);
    await snap(p, `d-${tag}-01-login`);
    await c.close();
    c = await ctx(browser, { w: 1440, h: 900, dark });
    p = await c.newPage();
    await p.goto(BASE + '/'); await p.waitForSelector('.trow'); await settle(p, 1200);
    await snap(p, `d-${tag}-02-project-chat`);
    await openThread(p, 'Kiai phone review');
    await snap(p, `d-${tag}-03-thread-working`);
    await openThread(p, 'Ko marker');
    await snap(p, `d-${tag}-04-thread-done-pr`);
    await openThread(p, 'Forge: pick');
    await snap(p, `d-${tag}-05-thread-question`);
    if (!dark) {
      // Options popup in composer
      const o = p.locator('.chip.quiet').first();
      if (await o.count()) { await o.click(); await settle(p, 400); await snap(p, `d-${tag}-06-options-pop`); await p.keyboard.press('Escape'); await settle(p, 300); }
      // New chat empty state
      await p.click('#newChat'); await settle(p, 500); await snap(p, `d-${tag}-07-new-chat`);
      // Settings / Look sheet
      const lookBtn = p.locator('#team button', { hasText: /Look/ }).first();
      if (await lookBtn.count()) { await lookBtn.click(); await settle(p, 500); await snap(p, `d-${tag}-08-look-sheet`); await p.keyboard.press('Escape'); await settle(p, 300); }
      const setBtn = p.locator('#team button', { hasText: /Settings/ }).first();
      if (await setBtn.count()) { await setBtn.click(); await settle(p, 500); await snap(p, `d-${tag}-09-settings-sheet`); await p.keyboard.press('Escape'); await settle(p, 300); }
      // Team panel full height
      // Close the threads sidebar so the Team panel shows Tasks (hidden while the sidebar is open), then really scroll it.
      await p.keyboard.press('['); await settle(p, 400);
      await p.evaluate(() => { const t = document.getElementById('team'); t.scrollTop = t.scrollHeight; }); await settle(p, 300);
      console.log('team scrollTop', await p.evaluate(() => document.getElementById('team').scrollTop));
      await snap(p, `d-${tag}-10-team-scrolled`);
      await p.keyboard.press('['); await settle(p, 300);
    }
    await p.goto(BASE + '/library.html'); await settle(p, 1500); await snap(p, `d-${tag}-11-library`);
    await p.goto(BASE + '/studio.html'); await settle(p, 1500); await snap(p, `d-${tag}-12-studio`);
    await c.close();

    // Phone
    c = await ctx(browser, { w: 390, h: 844, dark, mobile: true, logged: false });
    p = await c.newPage();
    await p.goto(BASE + '/'); await settle(p, 900);
    await snap(p, `m-${tag}-01-login`);
    await c.close();
    c = await ctx(browser, { w: 390, h: 844, dark, mobile: true });
    p = await c.newPage();
    await p.goto(BASE + '/'); await settle(p, 1500);
    await snap(p, `m-${tag}-02-chat-tab`);
    await p.click('.tabs button[data-tab="threads"]'); await settle(p, 500);
    await snap(p, `m-${tag}-03-threads-tab`);
    await openThread(p, 'Kiai phone review');
    await snap(p, `m-${tag}-04-thread-working`);
    await p.click('.tabs button[data-tab="threads"]'); await settle(p, 400);
    await openThread(p, 'Forge: pick');
    await snap(p, `m-${tag}-05-thread-question`);
    await p.click('.tabs button[data-tab="team"]'); await settle(p, 500);
    await snap(p, `m-${tag}-06-team-tab`);
    if (!dark) { await snap(p, `m-${tag}-06b-team-tab-full`, true); }
    await p.goto(BASE + '/library.html'); await settle(p, 1500); await snap(p, `m-${tag}-07-library`);
    await p.goto(BASE + '/studio.html'); await settle(p, 1500); await snap(p, `m-${tag}-08-studio`);
    await c.close();
  }
  await browser.close();
  console.log(shots.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
