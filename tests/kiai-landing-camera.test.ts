import { describe, expect, it } from 'vitest';
import { KayaView } from '../kami/src/three/kaya';
import { camAt, fitOrbit, T, type Box } from '../kami/src/ui/landing/camera';

// The landing's still sky (Poster) and its live board (Stage) share landing/camera.ts; its
// plain-number fitOrbit must place the board exactly where KayaView.fitOrbit does.
describe('Kiai landing camera', () => {
  const cases: [number, number, number, Box, number][] = [
    [26, -16, 44, [0.45, 0.46, 0.97, 0.97], 1366 / 800],
    [50, 22, 40, [0.5, 0.1, 0.97, 0.97], 1920 / 1080],
    [84, 0, 44, [0.03, 0.14, 0.97, 0.5], 390 / 844],
    [38, 30, 48, [0.03, 0.14, 0.97, 0.55], 0.7],
  ];
  it.each(cases)('fits like KayaView (elev %d, azim %d)', (elev, azim, fov, box, aspect) => {
    const fake = { size: 19, BT: T, w: aspect * 1000, h: 1000 };
    const want = KayaView.prototype.fitOrbit.call(fake as unknown as KayaView, { elev, azim, fov, target: [0, T, 0] }, box);
    const got = fitOrbit({ elev, azim, fov, target: [0, T, 0] }, box, aspect);
    expect(got.dist).toBeCloseTo(want.dist, 6);
    expect(got.shift).toBeCloseTo(want.shift, 6);
    expect(got.shiftY).toBeCloseTo(want.shiftY, 6);
  });
  it('rests on each chapter and glides between them', () => {
    const box = (): Box => [0.45, 0.1, 0.97, 0.97];
    expect(camAt(1, 1.7, box).elev).toBe(50);
    expect(camAt(1.1, 1.7, box).elev).toBe(50);
    const mid = camAt(1.5, 1.7, box).elev;
    expect(mid).toBeGreaterThan(50);
    expect(mid).toBeLessThan(64);
  });
});
