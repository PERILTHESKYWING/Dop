/**
 * The last call to open Kiai, shown rather than told: stones are clicked onto an empty board, the
 * question is typed, and KataGo's read rises from it (the same real read as above).
 */
import { useCallback, useMemo, useState } from 'react';
import type { KayaView, ViewMode } from '../../three/kaya';
import { DEMO, FINAL, glows, loc, pct, PLAY_ORDER, STONES } from './data';
import { LiveBoard, reducedMotion, sleep, useScene, type Label } from './live';

const Q = 'What should Black play here?';
const PILLAR = 0.07;
const view = (w: number, h: number): ViewMode => {
  const aspect = w / Math.max(1, h);
  return { kind: 'orbit', elev: 52, azim: -16, fov: 26, dist: (0.27 / Math.tan((13 * Math.PI) / 180)) * Math.max(1, 1.15 / aspect), target: [0.01, 0.06, 0.01] };
};

export function CtaDemo() {
  const still = useMemo(() => reducedMotion(), []);
  const [v, setV] = useState<KayaView | null>(null);
  const [visible, setVisible] = useState(false);
  const [labels, setLabels] = useState<Label[]>([]);
  const [typed, setTyped] = useState(still ? Q.length : 0);
  const [asked, setAsked] = useState(still);

  const tags = (): Label[] =>
    FINAL.cands.slice(0, 3).map((c, i) => ({ key: `c${c.at}`, loc: loc(c.at), lift: PILLAR * Math.max(0.05, c.visits / FINAL.cands[0].visits) + 0.01, cls: `k3-cand tag${i === 0 ? ' best' : ''}`, text: pct(c.win, 0), sub: c.at }));

  const run = useCallback(
    async (sig: AbortSignal) => {
      const b = v!;
      if (still) {
        b.setStones(STONES, false);
        b.setCandidates(glows(FINAL, 3), false);
        setLabels(tags());
        return sleep(1e9, sig);
      }
      b.fadeOut(0);
      setLabels([]);
      setTyped(0);
      setAsked(false);
      b.setStones(new Array(361).fill(0), false);
      await sleep(500, sig);
      // the position is clicked in, stone by stone
      const s = new Array<number>(361).fill(0);
      for (const l of PLAY_ORDER) {
        s[l] = STONES[l];
        b.setStones(s, true);
        setLabels([{ key: 'cursor', loc: l, lift: 0.012, cls: 'k3-cursor' }]);
        await sleep(110, sig);
      }
      setLabels([]);
      await sleep(300, sig);
      // the question
      setAsked(true);
      for (let k = 1; k <= Q.length; k += 2) {
        setTyped(k);
        await sleep(30, sig);
      }
      setTyped(Q.length);
      await sleep(300, sig);
      // and KataGo reads it
      b.ping(null, 1500);
      for (const r of DEMO.reads.slice(1)) {
        b.setCandidates(glows(r, 3));
        await sleep(380, sig);
      }
      setLabels(tags());
      await sleep(4200, sig);
      b.fadeOut(600);
      setLabels([]);
      await sleep(900, sig);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v, still],
  );
  useScene(!!v && visible, v ? run : null, [v]);

  return (
    <div className="l-cta-demo">
      <LiveBoard className="l-cta-board" options={{ stage: 'void', toneMapping: 'aces', exposure: 0.95, fx: 1.15, pillars: PILLAR, lite: window.matchMedia('(pointer: coarse)').matches }} fit={view} labels={labels} onView={setV} onVisible={setVisible} />
      <p className={`l-cta-q${asked ? ' on' : ''}`} aria-hidden="true">
        {Q.slice(0, typed)}
        {asked && typed < Q.length && <span className="l-caret" />}
      </p>
    </div>
  );
}
