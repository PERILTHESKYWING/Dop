/**
 * Tells the 気合 loader (ui/brand/loader.ts, inlined in index.html) that the page is drawn and
 * it can fade. Safe to call more than once.
 */
export function markReady() {
  const w = window as Window & { __kiaiReady?: boolean };
  if (w.__kiaiReady) return;
  w.__kiaiReady = true;
  // wait two frames so the page under the sheet has painted
  requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new Event('kiai-ready'))));
}
