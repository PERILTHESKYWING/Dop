#!/usr/bin/env node
// Run the hub on this computer for testing: node hub/dev.mjs  (password: dev)
// Uses memory storage unless KV_REST_API_URL / KV_REST_API_TOKEN are set.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.HUB_DEV_MEMORY ||= '1';
process.env.HUB_PASSWORD ||= 'dev';
// HUB_FAKE_CLAUDE=1: pretend every routine start works (for trying the page).
if (process.env.HUB_FAKE_CLAUDE === '1') {
  const real = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (url, init) =>
    String(url).startsWith('https://api.anthropic.com/')
      ? Promise.resolve(new Response(JSON.stringify({ type: 'routine_fire', claude_code_session_url: `https://claude.ai/code/session_demo${++n}` })))
      : real(url, init);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const { default: hubApi } = await import('./api/hub.js');
const { default: mcpApi } = await import('./api/mcp.js');
const port = Number(process.env.PORT || 7791);

createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    req.body = Buffer.concat(chunks).toString('utf8');
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/api/hub') return hubApi(req, res);
    if (p === '/api/mcp') return mcpApi(req, res);
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(readFileSync(path.join(here, 'index.html')));
  });
}).listen(port, () => console.log(`Dop hub (dev) on http://localhost:${port}  password: ${process.env.HUB_PASSWORD}`));
