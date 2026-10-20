// Logs claude.ai's sign-in discovery probes (/.well-known/...), then says "none".
import { hubFromEnv, vercel } from '../lib/api.js';

export default function handler(req, res) {
  return vercel(req, res, async (r) => {
    const hub = hubFromEnv();
    try {
      await hub?.logConn({ http: r.method, path: '/.well-known/' + String(r.query.p || '').slice(0, 60), via: 'probe', ua: String(r.headers['user-agent'] || '').slice(0, 60) });
    } catch {}
    return { status: 404, body: { error: 'No sign-in: this hub uses the key in the connector link.' } };
  });
}
