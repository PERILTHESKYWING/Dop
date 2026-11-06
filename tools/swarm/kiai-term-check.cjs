// Term card checks on a 390 px phone: node kiai-term-check.cjs <outdir>   (PORT=4291 by default)
// 1. Tap-to-card time with the CPU slowed 4x (CDP), median of 10 taps: from the tap's pointerdown
//    to the frame after the card is in the page.
// 2. A message that re-renders while its card is open (Term.tsx takes the card out and joins the
//    text before each render commits): (a) pin a term's card, then Tab through the board points
//    after it (each previews on the board and re-renders the chat); (b) pin, then "Read longer"
//    from the keyboard (a press elsewhere would close the card first). Checks: no page or console
//    error, no host left without its card, and the answer's text and text-node count are the same
//    as before the card opened (no split, doubled or lost text).
const { chromium } = (() => { try { return require('playwright'); } catch { return require('/opt/node-tools/node_modules/playwright'); } })();
const fs = require('fs');
const path = require('path');
const out = process.argv[2];
const PORT = process.env.PORT || 4291;
const demo = JSON.parse(fs.readFileSync(path.join(__dirname, '../../kami/src/ui/landing/demo.json'), 'utf8'));
const L = 'ABCDEFGHJKLMNOPQRST';
const sgfc = (g) => 'abcdefghijklmnopqrs'[L.indexOf(g[0])] + 'abcdefghijklmnopqrs'[19 - Number(g.slice(1))];
const sgf = '(;GM[1]FF[4]SZ[19]KM[7.5]' + demo.order.map((m, i) => `;${i % 2 ? 'W' : 'B'}[${sgfc(m)}]`).join('') + ')';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('kiai.entered', '1');
      localStorage.setItem('kiai.level', 'medium');
    } catch {}
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text().slice(0, 200)));
  const R = {};
  const waitAnswer = async () => {
    for (let i = 0; i < 150; i++) {
      if (!(await page.$('[aria-label="Stop"]')) && i > 1) break;
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(2000);
  };
  await page.goto(`http://localhost:${PORT}/?kiai3d`, { waitUntil: 'load' });
  await page.waitForSelector('textarea', { timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.fill('textarea', sgf);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(8000);
  await page.fill('textarea', 'What should Black play here?');
  await page.keyboard.press('Enter');
  await waitAnswer();

  /** The first term a reader can see in the last answer. */
  const visibleTerm = async () => {
    const h = await page.evaluateHandle(() => {
      const m = document.querySelector('.messages').getBoundingClientRect();
      const all = [...document.querySelectorAll('.msg.kami')].pop().querySelectorAll('.term');
      return (
        [...all].find((e) => {
          const b = e.getBoundingClientRect();
          return b.width > 0 && b.top >= m.top && b.bottom <= m.bottom && e.checkVisibility({ visibilityProperty: true });
        }) || null
      );
    });
    return h.asElement();
  };
  /** The last answer's text without any open card. */
  const answerText = () =>
    page.evaluate(() => {
      const k = [...document.querySelectorAll('.msg.kami')].pop().querySelector('.rich').cloneNode(true);
      k.querySelectorAll('.term-slot').forEach((s) => s.remove());
      return k.textContent.replace(/\s+/g, ' ').trim();
    });
  const hosts = () => page.evaluate(() => ({ slots: document.querySelectorAll('.term-slot').length, cards: document.querySelectorAll('.term-slot > .term-tip').length, attached: [...document.querySelectorAll('.term-slot')].every((s) => s.isConnected) }));

  // 1. tap-to-card with the CPU 4x slower
  await page.evaluate(() => {
    window.__t = [];
    document.addEventListener('pointerdown', (e) => e.target.closest && e.target.closest('.term') && !document.querySelector('.term-tip') && (window.__t0 = performance.now()), true);
    new MutationObserver(() => {
      if (window.__t0 && document.querySelector('.term-tip.inline')) {
        const t0 = window.__t0;
        window.__t0 = 0;
        requestAnimationFrame(() => setTimeout(() => window.__t.push(performance.now() - t0), 0));
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const base = await answerText();
  for (let i = 0; i < 10; i++) {
    const term = await visibleTerm();
    if (!term) break;
    const b = await term.boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(700);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const ts = (await page.evaluate(() => window.__t)).sort((a, b) => a - b);
  R.tapToCard4x = { n: ts.length, medianMs: ts.length ? Math.round(ts[Math.floor(ts.length / 2)]) : null, minMs: Math.round(ts[0]), maxMs: Math.round(ts[ts.length - 1]) };
  R.textAfterTenOpenClose = { same: (await answerText()) === base, ...(await hosts()) };

  /** The answer's text nodes (a split left behind would add one). */
  const textNodes = () =>
    page.evaluate(() => {
      const k = [...document.querySelectorAll('.msg.kami')].pop().querySelector('.rich');
      const w = document.createTreeWalker(k, NodeFilter.SHOW_TEXT);
      let n = 0;
      for (let t = w.nextNode(); t; t = w.nextNode()) if (!t.parentElement.closest('.term-slot')) n++;
      return n;
    });
  const nodes0 = await textNodes();

  // 2a. the same message re-renders with the card open: pin by tap, then Tab through the board
  //     points after it (each one previews on the board, which re-renders the chat)
  let term = await visibleTerm();
  let b = await term.boundingBox();
  await page.evaluate(() => {
    window.__moves = 0;
    new MutationObserver((ms) => ms.forEach((m) => [...m.removedNodes].forEach((n) => n.classList && n.classList.contains('term-slot') && window.__moves++))).observe(document.querySelector('.messages'), { childList: true, subtree: true });
  });
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(500);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
  }
  R.rerenderOpen = {
    open: !!(await page.$('.term-tip.inline.pinned')),
    hostReplaced: await page.evaluate(() => window.__moves),
    textSameWhileOpen: (await answerText()) === base,
    ...(await hosts()),
  };
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  R.rerenderOpen.afterClose = { textSame: (await answerText()) === base, textNodesSame: (await textNodes()) === nodes0, ...(await hosts()) };

  // 2b. the message is redone with the card open: pin, then Read longer from the keyboard (a
  //     press elsewhere would close the card first)
  term = await visibleTerm();
  b = await term.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(500);
  R.redo = { openBefore: !!(await page.$('.term-tip.inline.pinned')) };
  const longer = await page.$('.read-longer');
  if (longer) {
    await longer.focus();
    await page.keyboard.press('Enter');
    const samples = [];
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(700);
      samples.push(await hosts());
    }
    R.redo.during = samples;
    await waitAnswer();
    R.redo.after = await hosts();
    // the new answer: open and close a card, its text is unchanged
    const t2 = await answerText();
    const n2 = await textNodes();
    term = await visibleTerm();
    if (term) {
      b = await term.boundingBox();
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      R.redo.newAnswer = { textSame: (await answerText()) === t2, textNodesSame: (await textNodes()) === n2, ...(await hosts()) };
    }
  } else R.redo.note = 'no Read longer button';
  R.errors = errors;
  console.log(JSON.stringify(R, null, 1));
  fs.writeFileSync(path.join(out, 'term-check.json'), JSON.stringify(R, null, 1));
  await browser.close();
})();
