/// <reference lib="webworker" />
import { runCopyJob, type CopyReply, type CopyRequest } from './copyJob';

self.onmessage = (e: MessageEvent<CopyRequest>) => {
  const req = e.data;
  try {
    const model = runCopyJob(req, (done, total, best) => self.postMessage({ id: req.id, type: 'progress', done, total, best } satisfies CopyReply));
    self.postMessage({ id: req.id, type: 'done', model } satisfies CopyReply);
  } catch (err) {
    self.postMessage({ id: req.id, type: 'error', error: (err as Error).message ?? String(err) } satisfies CopyReply);
  }
};
