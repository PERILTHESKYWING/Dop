// Screenshots of the seeded hub. node hub-shots.cjs [outdir]
const { chromium } = (() => { try { return require('playwright'); } catch { return require('/opt/node22/lib/node_modules/playwright'); } })();
const path = require('path');
const fs = require('fs');
const OUT = process.argv[2] || path.join(__dirname, 'shots/before-hub');
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:7791';

async function ctx(browser, { w, h, dark = false, mobile = false, logged = true }) {
  const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, colorScheme: dark ? 'dark' : 'light' });
  if (logged) await c.addInitScript(() => { try { localStorage.setItem('hubpw', 'dev'); } catch {} });
  return c;
}
const settle = (p, ms = 700) => p.waitForTimeout(ms);
// A done thread whose PR the hub sees as merged can drop out of the list (seen 2026-11-03 on main too):
// open the fallback title instead of stopping the whole set.
async function openThread(p, title, fallback) {
  let row = p.locator('.trow', { hasText: title }).first();
  if (fallback && !(await row.count())) { console.log('no row', title, '-> using', fallback); row = p.locator('.trow', { hasText: fallback }).first(); }
  await row.click();
  await settle(p);
}

// Presses Tab until the focused element passes the test (or n presses), then lets the ring draw.
async function tabTo(p, test, n) {
  const src = test.toString();
  for (let i = 0; i < n; i++) {
    await p.keyboard.press('Tab');
    if (await p.evaluate((src) => { const el = document.activeElement; return !!el && el !== document.body && (0, eval)(src)(el); }, src)) break;
  }
  await settle(p, 250);
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
    // The opened working thread: its Activity block (current step, last actions with ages) sits above the composer.
    await openThread(p, 'Kiai phone review');
    await snap(p, `d-${tag}-03-thread-working`);
    // A working thread whose agent has not connected yet: the block says what it waits for.
    if (!dark) { await openThread(p, 'Library: video'); await snap(p, `d-${tag}-03b-thread-waiting`); }
    await openThread(p, 'Ko marker', 'Hub: Team panel');
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
    if (!dark) {
      await p.click('.tabs button[data-tab="threads"]'); await settle(p, 400);
      await openThread(p, 'Library: video');
      await snap(p, `m-${tag}-04b-thread-waiting`);
    }
    await p.click('.tabs button[data-tab="threads"]'); await settle(p, 400);
    await openThread(p, 'Forge: pick');
    await snap(p, `m-${tag}-05-thread-question`);
    await p.click('.tabs button[data-tab="team"]'); await settle(p, 500);
    await snap(p, `m-${tag}-06-team-tab`);
    if (!dark) { await snap(p, `m-${tag}-06b-team-tab-full`, true); }
    await p.goto(BASE + '/library.html'); await settle(p, 1500); await snap(p, `m-${tag}-07-library`);
    await p.goto(BASE + '/studio.html'); await settle(p, 1500); await snap(p, `m-${tag}-08-studio`);
    await c.close();

    // Keyboard focus (named z-focus-* so they sort after the shots above): Tab through the threads list
    // and an open thread, and show where the ring is.
    for (const phone of [false, true]) {
      const dev = phone ? 'm' : 'd';
      c = await ctx(browser, phone ? { w: 390, h: 844, dark, mobile: true } : { w: 1440, h: 900, dark });
      p = await c.newPage();
      await p.goto(BASE + '/'); await p.waitForSelector('.trow', { state: 'attached' }); await settle(p, 1200);
      if (phone) { await p.click('.tabs button[data-tab="threads"]'); await settle(p, 400); }
      await p.evaluate(() => document.activeElement?.blur());
      await tabTo(p, (el) => el.matches('.trow.t1.has-step'), 30);
      await snap(p, `z-focus-${dev}-${tag}-1-threads`);
      await openThread(p, 'Kiai phone review');
      // Start from the thread's header, as after opening it: Tabbing through the whole sidebar first would
      // scroll the list to its last row (the browser shows each focused row), hiding Project chat in the shot.
      await p.evaluate(() => [...document.querySelectorAll('#head a[href], #head button')].find((el) => el.getClientRects().length)?.focus());
      await tabTo(p, (el) => el.matches('.act-tog'), 40);
      await snap(p, `z-focus-${dev}-${tag}-2-thread`);
      await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await settle(p, 200);
      await snap(p, `z-focus-${dev}-${tag}-3-thread-composer`);
      if (!phone && !dark) {
        // A menu opened from the keyboard: focus moves into it on its picked item.
        await tabTo(p, (el) => el.matches('.chip.quiet'), 10);
        await p.keyboard.press('Enter'); await settle(p, 300);
        await snap(p, `z-focus-${dev}-${tag}-4-options-menu`);
        await p.keyboard.press('Escape');
      }
      if (phone) {
        // A Team card's ··· from the keyboard: the ring is drawn around its whole 44x44 target.
        await p.click('.tabs button[data-tab="team"]'); await settle(p, 400);
        await p.focus('#team .thead button');
        await tabTo(p, (el) => el.matches('.atop .more'), 10);
        await snap(p, `z-focus-${dev}-${tag}-4-team-more`);
      }
      await c.close();
    }
  }
  await browser.close();
  console.log(shots.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
