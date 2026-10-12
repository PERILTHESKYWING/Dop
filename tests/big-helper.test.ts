import { afterEach, describe, expect, it, vi } from 'vitest';

/** A fake browser: phone or computer, WebGPU or not, with working localStorage. */
function fakeBrowser(phone: boolean) {
  const ls = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => ls.get(k) ?? null,
    setItem: (k: string, v: string) => void ls.set(k, v),
    removeItem: (k: string) => void ls.delete(k),
  });
  vi.stubGlobal('navigator', {
    userAgent: phone ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Mobile/15E148 Safari/604.1' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0',
    hardwareConcurrency: 8,
    maxTouchPoints: phone ? 5 : 0,
  });
  return ls;
}

async function load(phone: boolean, webgpu: boolean) {
  vi.resetModules();
  const ls = fakeBrowser(phone);
  const store = await import('../src/state/store');
  const brain = await import('../src/state/brain');
  store.set({ caps: { webgpu, wasm: true, workers: true, indexedDB: true, cacheApi: true, secureContext: true } });
  return { brain, ls };
}

afterEach(() => vi.unstubAllGlobals());

describe('big network helper', () => {
  it('never runs on a phone, even one with WebGPU (two networks run the tab out of memory)', async () => {
    const { brain } = await load(true, true);
    expect(brain.bigHelperAllowed('g170e-b10c128')).toBe(false);
  });

  it('still runs on a computer with WebGPU', async () => {
    const { brain } = await load(false, true);
    expect(brain.bigHelperAllowed('g170e-b10c128')).toBe(true);
  });

  it('stays off after the tab died while it was loading, until turned back on', async () => {
    const { brain, ls } = await load(false, true);
    ls.set('dop.bigTrying', '1'); // left behind by a tab that was killed mid-load
    expect(brain.bigHelperAllowed('g170e-b10c128')).toBe(false);
    expect(brain.bigHelperAllowed('g170e-b10c128')).toBe(false);
    brain.clearBigHelperBroken();
    expect(brain.bigHelperAllowed('g170e-b10c128')).toBe(true);
  });
});
