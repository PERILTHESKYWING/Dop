import { describe, expect, it } from 'vitest';
import { handleAccountRequest, memoryKv } from '../shared/accountServer';
import { pairingCode, pcLinkOf, pcLinkUrl } from '../shared/pcLink';
import { PC_POSTPROCESS, pcRaw, symLoc, type KgResult } from '../src/state/pc';
import { processRawOutput } from '../src/lib/engine/parse';

const TUNNEL = 'https://quiet-river-fox-12.trycloudflare.com';

describe('phone link to the PC helper', () => {
  it('round-trips the QR link and rejects other addresses', () => {
    const url = pcLinkUrl('https://dop.vercel.app/#/study', TUNNEL, 'ab12-CD34-ef56');
    expect(pcLinkOf(url)).toEqual({ address: TUNNEL, code: 'AB12-CD34-EF56' });
    expect(url).toContain('#/settings');
    expect(pcLinkOf('https://dop.vercel.app/?pc=https://evil.example.com&pcCode=AB12-CD34-EF56')).toBeNull();
    expect(pcLinkOf(`https://dop.vercel.app/?pc=${TUNNEL}&pcCode=nope`)).toBeNull();
    expect(pcLinkOf('https://dop.vercel.app/')).toBeNull();
    expect(pairingCode(' ab12-cd34-ef56 ')).toBe('AB12-CD34-EF56');
  });

  it('remembers where the PC is by pairing code', async () => {
    const kv = memoryKv();
    const req = (action: string, body: unknown) => handleAccountRequest({ method: 'POST', action, query: {}, body: JSON.stringify(body), ip: '1.2.3.4' }, kv);
    expect((await req('pc-where', { code: 'AB12-CD34-EF56' })).status).toBe(404);
    expect((await req('pc-here', { code: 'AB12-CD34-EF56', address: 'https://evil.example.com' })).status).toBe(400);
    expect((await req('pc-here', { code: 'bad', address: TUNNEL })).status).toBe(400);
    expect((await req('pc-here', { code: 'ab12-cd34-ef56', address: TUNNEL })).status).toBe(200);
    expect((await req('pc-where', { code: 'AB12-CD34-EF56' })).body).toEqual({ address: TUNNEL });
    expect((await req('pc-where', { code: 'AB12-CD34-EF57' })).status).toBe(404);
    // Only the code's hash is stored.
    expect(await kv.get('pcaddr:AB12-CD34-EF56')).toBeNull();
    expect((await handleAccountRequest({ method: 'POST', action: 'pc-where', query: {}, body: '{}' }, null)).status).toBe(503);
  });

  it('board symmetries are one-to-one', () => {
    for (let sym = 0; sym < 8; sym++) {
      const seen = new Set<number>();
      for (let loc = 0; loc < 81; loc++) seen.add(symLoc(loc, 9, sym));
      expect(seen.size).toBe(81);
    }
  });

  it("reads the PC's small-network answer like this device's network output", () => {
    const size = 9;
    const hw = size * size;
    const policy = Array.from({ length: hw + 1 }, (_, i) => (i === 3 ? -1 : 1 + (i % 7)));
    const z = policy.filter((p) => p > 0).reduce((a, b) => a + b, 0);
    const norm = policy.map((p) => (p > 0 ? p / z : -1));
    const ownership = Array.from({ length: hw }, (_, i) => Math.sin(i) * 0.9);
    const sym = 5;
    // The PC saw the board turned by `sym`: its point symLoc(loc) is our loc.
    const sent: KgResult = {
      id: 'x',
      turnNumber: 0,
      moveInfos: [],
      rootInfo: { winrate: 0.7, scoreLead: 2.5, visits: 1, currentPlayer: 'W' },
      policy: Array.from({ length: hw + 1 }, (_, i) => (i === hw ? norm[hw] : norm[[...Array(hw).keys()].find((l) => symLoc(l, size, sym) === i)!])),
      ownership: Array.from({ length: hw }, (_, i) => ownership[[...Array(hw).keys()].find((l) => symLoc(l, size, sym) === i)!]),
    };
    const net = processRawOutput(pcRaw(sent, 2, size, sym), 2, (l) => norm[l] > 0, PC_POSTPROCESS);
    for (let l = 0; l <= hw; l++) expect(net.policy[l]).toBeCloseTo(Math.max(0, norm[l]), 5);
    for (let l = 0; l < hw; l++) expect(net.ownership![l]).toBeCloseTo(ownership[l], 4);
    expect(net.bLead).toBeCloseTo(2.5, 5);
    // The winrate comes from the score lead, as for the bundled network here.
    expect(net.bWin).toBeCloseTo(1 / (1 + Math.exp(-2.5 / PC_POSTPROCESS.winrateScale!)), 5);
  });
});
