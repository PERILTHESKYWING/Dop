/**
 * Runs the device benchmark (src/lib/engine/benchmark.ts) in headless Chromium and prints
 * the report as JSON: the shipped engine against the plain setup it replaced, scored
 * against native KataGo's answers in public/engine/bench-positions.json.
 *
 *   npm run dev -- --port 5199 &
 *   node scripts/engine-bench.mjs [http://localhost:5199] [full|quick] [--gpu]
 *
 * Needs Playwright (npm i -g playwright). In the browser itself, Settings > KataGo engine
 * > Benchmark runs the same thing on any device.
 */
const url = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : 'http://localhost:5199';
const full = process.argv.includes('full');
const gpu = process.argv.includes('--gpu');
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
const args = gpu ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--ignore-gpu-blocklist'] : [];
const browser = await chromium.launch({ args });
const page = await browser.newPage();
page.on('console', (m) => m.type() === 'error' && console.error('browser:', m.text().slice(0, 300)));
await page.goto(`${url}/#/settings`);
await page.waitForTimeout(1000);
const report = await page.evaluate(
  async ({ full, gpu }) => {
    const { runBenchmark, QUICK_BENCH } = await import('/src/lib/engine/benchmark.ts');
    const { forgetTunings } = await import('/src/lib/engine/tuning.ts');
    forgetTunings();
    const opts = full ? { visitPositions: 30, timePositions: 30, msPerPosition: 1000, sustainedSeconds: 120 } : QUICK_BENCH;
    return runBenchmark({ ...opts, forceCpu: !gpu, onProgress: (t) => console.log(t) });
  },
  { full, gpu },
);
console.log(JSON.stringify(report, null, 1));
await browser.close();
