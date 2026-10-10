/// <reference lib="webworker" />
import { DopnetRuntime } from './runtime';
import { studentRaw, type StudentRequest } from './backend';

/** One lane of the student network (engine.ts): its own copy of the runtime. */
let rt: DopnetRuntime | null = null;

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      rt = await DopnetRuntime.create(m.wasm, m.net);
      postMessage({ id: m.id, ok: true, result: { name: rt.header.name } });
    } else if (m.type === 'eval') {
      if (!rt) throw new Error('not loaded');
      const t0 = performance.now();
      const outs = (m.reqs as StudentRequest[]).map((r) => studentRaw(rt!, r, { allowExit: m.allowExit }));
      const ms = performance.now() - t0;
      const transfer: Transferable[] = [];
      for (const o of outs) {
        transfer.push(o.policyLogits.buffer, o.value.buffer);
        if (o.ownership) transfer.push(o.ownership.buffer);
      }
      postMessage({ id: m.id, ok: true, result: { outs, ms, stats: rt.stats() } }, transfer);
    }
  } catch (err) {
    postMessage({ id: m.id, ok: false, error: (err as Error).message });
  }
};
