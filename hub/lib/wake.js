// Waiting agents (hub_wait, hub_post wait_s, hub_ask, ask_user) sleep until
// the hub's seq moves. Each check is one small store read (GET seq), so the
// Upstash free tier (500K commands a month) is not spent on idle waits.
// A post made through this same warm function instance wakes its waiters
// at once instead of at their next check (no extra store command).
const waiters = new Set();

// Something was just written here: waiters check now.
export function wakeWaiters() {
  for (const w of [...waiters]) w();
}

// Sleep ms, or less if wakeWaiters is called.
export function nap(ms) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      waiters.delete(done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, ms));
    waiters.add(done);
  });
}

// Sleep until anything new lands in the hub, or until end. Returns the new
// seq, or 0 when time ran out.
export async function nextChange(hub, from, end, pollMs = 1000) {
  while (Date.now() < end) {
    await nap(Math.min(pollMs, end - Date.now()));
    const s = await hub.nextSeq();
    if (s !== from) return s;
  }
  return 0;
}

// The same test as hub.js answerFor: an answer, or the owner's plain reply.
const isAnswer = (m, owner) => m.kind === 'answer' || (m.kind === 'prompt' && m.from === owner);
const MARGIN = 8; // a message can get its id before an earlier one is pushed

// Wait for an answer to question qid until end. Reads only the messages that
// arrived since the last look (hub.feed(n)), never the whole 400-message
// window each time. Returns the answer message or null.
// clock: a caller that times its wait on the hub's clock (ask_user; tests
// move it) passes it, and then sleeps plainly between checks.
export async function waitAnswer(hub, qid, end, { pollMs = 1000, clock = null } = {}) {
  let looked = Number(qid);
  let seq = await hub.nextSeq();
  for (;;) {
    if (seq > looked) {
      const msgs = await hub.feed(Math.min(400, seq - looked + MARGIN));
      const ans = msgs.find((m) => m.replyTo === Number(qid) && isAnswer(m, 'XIAO'));
      if (ans) return ans;
      looked = seq;
    }
    if (clock) {
      if (clock() >= end) return null;
      await nap(pollMs);
      seq = await hub.nextSeq();
      continue;
    }
    const s = await nextChange(hub, seq, end, pollMs);
    if (!s) return null;
    seq = s;
  }
}
