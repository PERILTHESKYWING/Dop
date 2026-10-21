#!/usr/bin/env node
// Run the hub on this computer for testing: node hub/dev.mjs  (password: dev)
// Uses memory storage unless KV_REST_API_URL / KV_REST_API_TOKEN are set.
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.HUB_DEV_MEMORY ||= '1';
process.env.HUB_PASSWORD ||= 'dev';
// HUB_FAKE_CLAUDE=1: pretend every routine start works (for trying the page).
if (process.env.HUB_FAKE_CLAUDE === '1') {
  const real = globalThis.fetch;
  let n = 0;
  const later = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  globalThis.fetch = (url, init) => {
    if (!String(url).startsWith('https://api.anthropic.com/')) return real(url, init);
    if (String(url).includes('/api/oauth/usage')) {
      // Made-up usage that differs per token, so the Team panel shows different bars.
      const k = [...String(init?.headers?.authorization || '')].reduce((x, c) => x + c.charCodeAt(0), 0);
      return Promise.resolve(new Response(JSON.stringify({ five_hour: { utilization: (k * 7) % 96, resets_at: later(2) }, seven_day: { utilization: (k * 3) % 90, resets_at: later(80) } })));
    }
    return Promise.resolve(new Response(JSON.stringify({ type: 'routine_fire', claude_code_session_url: `https://claude.ai/code/session_demo${++n}` })));
  };
}
const here = path.dirname(fileURLToPath(import.meta.url));
const { default: hubApi } = await import('./api/hub.js');
const { default: mcpApi } = await import('./api/mcp.js');
const { default: pathApi } = await import('./api/c/[account]/[key].js');
const port = Number(process.env.PORT || 7791);

createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    req.body = Buffer.concat(chunks).toString('utf8');
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/api/hub') return hubApi(req, res);
    if (p === '/api/mcp') return mcpApi(req, res);
    if (p.startsWith('/api/c/')) return pathApi(req, res);
    // The icons sit next to index.html, as Vercel serves them.
    const icon = { '/apple-touch-icon.png': 'image/png', '/logo.svg': 'image/svg+xml' }[p];
    if (icon) { res.setHeader('content-type', icon); return res.end(readFileSync(path.join(here, p.slice(1)))); }
    // The studio and library pages and their modules, also plain static files on Vercel.
    if (p === '/studio.html' || p === '/library.html' || /^\/(studio|library)\/[a-z]+\.js$/.test(p)) {
      if (!existsSync(path.join(here, p.slice(1)))) return (res.statusCode = 404), res.end('Not found');
      res.setHeader('content-type', p.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
      return res.end(readFileSync(path.join(here, p.slice(1))));
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(readFileSync(path.join(here, 'index.html')));
  });
}).listen(port, () => console.log(`Dop hub (dev) on http://localhost:${port}  password: ${process.env.HUB_PASSWORD}`));
