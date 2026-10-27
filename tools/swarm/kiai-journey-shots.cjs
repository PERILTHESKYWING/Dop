// Screenshots + browser check for the Kiai account and study path (run with the global playwright).
const { chromium } = (() => { try { return require('playwright'); } catch { return require('/opt/node-tools/node_modules/playwright'); } })();
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:4291/';
const OUT = process.env.OUT || 'shots/journey';
fs.mkdirSync(OUT, { recursive: true });
const SCHEME = process.env.SCHEME || 'light';
const log = (...a) => console.log(...a);

const SEED = () => {
  const p = (n) => String(n).padStart(2, '0');
  const key = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return key(d); };
  const days = {};
  for (let i = 20; i >= 4; i--) days[ago(i)] = [2, 6, 0, 0, 1];
  for (let i = 2; i >= 1; i--) days[ago(i)] = [1, 4, 0, 0, 1];
  localStorage.setItem('kiai.journey', JSON.stringify({ v: 1, gen: 0, dev: { seeddevice01: days }, seen: {} }));
};

async function drawer(page, phone) {
  if (phone && !(await page.$('.kami-app.drawer-open'))) {
    await page.click('button[aria-label="Open boards"]');
    await page.waitForTimeout(400);
  }
}
async function openMenu(page, phone) {
  await drawer(page, phone);
  await page.click('.side-foot .account-btn');
  await page.waitForTimeout(250);
}
async function menuItems(page) {
  return page.$$eval('[role="menuitem"]', (els) => els.map((e) => e.textContent.trim()));
}
// Desktop has a tab column; a phone shows a list of pages with a back button on each page.
async function goPage(page, label) {
  if (await page.$('.set-nav')) return page.click(`.set-nav button:has-text("${label}")`);
  if (await page.$('.set-back')) { await page.click('.set-back'); await page.waitForTimeout(250); }
  await page.click(`.set-index button:has-text("${label}")`);
  await page.waitForTimeout(250);
}
async function openSettingsPage(page, phone, item) {
  await openMenu(page, phone);
  await page.click(`[role="menuitem"]:has-text("${item}")`);
  await page.waitForSelector('.modal.settings');
  await page.waitForTimeout(400);
}

function step(r, ...a) { r.push(...a); for (const x of a) console.log('  .', name0, JSON.stringify(x)); }
let name0 = '';
async function run(name, viewport, phone) {
  name0 = name;
  console.log('start', name);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const results = [];
  // 1. Server unreachable: no account item anywhere.
  {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: phone ? 2 : 1, colorScheme: SCHEME });
    await ctx.addInitScript(() => { localStorage.setItem('kiai.entered', '1'); localStorage.setItem('kami.sideFolded', '0'); });
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
    await page.route('**/api/account**', (r) => r.abort());
    await page.goto(BASE);
    await page.waitForSelector('.side-foot .account-btn', { state: 'attached' });
    await page.waitForTimeout(2500);
    const plan = await page.textContent('.side-foot .account-plan');
    await openMenu(page, phone);
    const items = await menuItems(page);
    step(results, ['unreachable: plan', plan], ['unreachable: menu has account item', items.some((t) => /Sync across|Account/.test(t))]);
    await ctx.close();
  }
  // 2. Seeded path: sidebar line, Journey page, Account page and the full sign-up flow.
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: phone ? 2 : 1, colorScheme: SCHEME });
  await ctx.addInitScript(() => { localStorage.setItem('kiai.entered', '1'); localStorage.setItem('kami.sideFolded', '0'); });
  const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => log('pageerror', e.message));
  await page.goto(BASE);
  await page.evaluate(SEED);
  await page.reload();
  await page.waitForSelector('.side-foot .account-btn', { state: 'attached' });
  await page.waitForTimeout(2500);
  await drawer(page, phone);
  step(results, ['seeded: plan', await page.textContent('.side-foot .account-plan')]);
  await page.screenshot({ path: `${OUT}/${name}-sidebar.png` });
  const foot = await page.$('.side-foot');
  await foot.screenshot({ path: `${OUT}/${name}-sidebar-foot.png` });
  await openMenu(page, phone);
  await page.screenshot({ path: `${OUT}/${name}-menu.png` });
  step(results, ['seeded: menu', (await menuItems(page)).join(' | ')]);
  await page.click(`[role="menuitem"]:has-text("Journey")`);
  await page.waitForSelector('.journey');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}-settings-journey.png` });
  const scroller = '.set-page';
  const h = await page.$eval(scroller, (e) => e.scrollHeight);
  const ch = await page.$eval(scroller, (e) => e.clientHeight);
  let n = 1;
  for (let y = ch * 0.85; y < h; y += ch * 0.85) {
    await page.$eval(scroller, (e, y) => (e.scrollTop = y), y);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/${name}-settings-journey-${++n}.png` });
  }
  // Open "How the path grows" at the end.
  await page.click('.journey-how summary');
  await page.$eval(scroller, (e) => (e.scrollTop = e.scrollHeight));
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/${name}-settings-journey-how.png` });
  step(results, ['journey text', (await page.textContent('.journey-station')).slice(0, 160)]);

  // Account, signed out.
  await goPage(page, 'Account');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}-account-signed-out.png` });
  // Create account.
  await page.click('.acct-seg button:has-text("Create account")');
  const email = `xiao${phone ? 'p' : 'd'}${Date.now() % 100000}@example.com`;
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'long enough password');
  await page.screenshot({ path: `${OUT}/${name}-account-create.png` });
  await page.click('.acct-form button[type="submit"]');
  await page.waitForSelector('.acct-code-value', { timeout: 15000 });
  await page.waitForTimeout(200);
  const code = await page.textContent('.acct-code-value');
  step(results, ['recovery code', code]);
  await page.screenshot({ path: `${OUT}/${name}-account-recovery-code.png` });
  await page.click('.acct-code button:has-text("Done")');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${name}-account-signed-in.png` });
  step(results, ['signed in blurb', await page.textContent('.set-page .set-blurb')]);
  // Data page copy.
  await goPage(page, 'Data');
  await page.waitForTimeout(200);
  step(results, ['data blurb', await page.textContent('.set-page .set-blurb')]);
  // Sign out, removing the path here; sign in again: the path comes back.
  await goPage(page, 'Account');
  await page.check('.acct-check input');
  await page.click('.set-row button:has-text("Sign out")');
  await page.waitForTimeout(500);
  await goPage(page, 'Journey');
  await page.waitForTimeout(200);
  step(results, ['after sign-out (path removed here)', await page.textContent('.journey-head').catch(() => 'n/a')]);
  await goPage(page, 'Account');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'long enough password');
  await page.click('.acct-form button[type="submit"]');
  await page.waitForSelector('.acct-state', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await goPage(page, 'Journey');
  await page.waitForTimeout(200);
  step(results, ['after sign-in (path back)', await page.textContent('.journey-head')]);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await drawer(page, phone);
  step(results, ['signed-in plan', await page.textContent('.side-foot .account-plan')]);
  await page.click('.side-foot .account-btn');
  await page.waitForTimeout(250);
  step(results, ['signed-in popover head', await page.textContent('.pop-head')]);
  await page.screenshot({ path: `${OUT}/${name}-menu-signed-in.png` });

  await browser.close();
  return results;
}

(async () => {
  for (const [name, vp, phone] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['phone', { width: 390, height: 844 }, true],
  ]) {
    try {
      const r = await run(`${name}-${SCHEME}`, vp, phone);
      log(`== ${name}`);
      for (const [k, v] of r) log(`  ${k}: ${JSON.stringify(v)}`);
    } catch (e) {
      log(`== ${name} FAILED`, e.message);
    }
  }
})();
