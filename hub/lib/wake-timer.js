// Timed wake: asks Upstash QStash (free: 1,000 messages a day) to post
// { op: 'tick', due } to this hub at a given time, so an account whose usage
// limit resets is back at work within a minute even with every page closed.
// Optional: set QSTASH_TOKEN in the hub's Vercel project (Vercel adds it, with
// QSTASH_URL, when you connect Upstash QStash under Storage). Without it the
// hub still wakes on page visits, agents' calls and the hub-wake workflow.
export function qstashTimer(env = process.env, fetchImpl = fetch) {
  const token = env.QSTASH_TOKEN;
  const host = env.HUB_PUBLIC_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  if (!token || !host) return null;
  const qstash = (env.QSTASH_URL || 'https://qstash.upstash.io').replace(/\/$/, '');
  const target = `${host.replace(/\/$/, '')}/api/hub`;
  return async (at) => {
    const res = await fetchImpl(`${qstash}/v2/publish/${target}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'Upstash-Not-Before': String(Math.ceil(at / 1000)),
        'Upstash-Retries': '2',
        // One message per minute at most, however often the same time is planned.
        'Upstash-Deduplication-Id': `hub-wake-${Math.ceil(at / 60_000)}`,
      },
      body: JSON.stringify({ op: 'tick', due: at }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`QStash answered ${res.status}`);
  };
}
