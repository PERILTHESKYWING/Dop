/// <reference types="node" />
/**
 * Kami's own Vite config: run from the repo root with `npm run kami:dev` / `kami:build`
 * (or by Vercel with Root Directory = kami, see kami/vercel.json). It imports Dop's code
 * from ../src and serves Dop's engine files, copied (not committed) into kami/public.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { handleLlmRequest } from '../shared/llmServer.js';
import { loaderHtml } from './src/ui/brand/loader';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');

/** Copy one file when it is missing or older/different in size (the network is 11 MB). */
function copyIfChanged(from: string, to: string) {
  const a = statSync(from);
  if (existsSync(to)) {
    const b = statSync(to);
    if (b.size === a.size && b.mtimeMs >= a.mtimeMs) return;
  }
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(from, to);
}

/**
 * Dop's engine worker + WebAssembly, the bundled b10 network, the board's wood texture and
 * the rank calibration, copied into kami/public (git-ignored). BrowserEngine loads them from /engine/ and /models/,
 * and ENGINE_FILES in src/lib/engine/browserEngine.ts busts the week-long /engine cache on
 * both sites, so nothing here needs bumping by hand.
 */
export function copyEngineFiles() {
  const pub = path.join(here, 'public');
  const engineSrc = path.join(repo, 'public', 'engine');
  const engineDst = path.join(pub, 'engine');
  const want = new Set(readdirSync(engineSrc));
  for (const f of want) copyIfChanged(path.join(engineSrc, f), path.join(engineDst, f));
  for (const f of readdirSync(engineDst)) if (!want.has(f)) rmSync(path.join(engineDst, f), { recursive: true });
  const models = path.join(repo, 'public', 'models');
  for (const f of readdirSync(models)) {
    if (f.startsWith('g170e-b10c128-') && f.endsWith('.bin.gz')) copyIfChanged(path.join(models, f), path.join(pub, 'models', f));
  }
  copyIfChanged(path.join(repo, 'public', 'art', 'kaya.webp'), path.join(pub, 'art', 'kaya.webp'));
  // The rank calibration behind the Performance tab's game rating (src/lib/level).
  copyIfChanged(path.join(repo, 'public', 'level', 'calibration.json'), path.join(pub, 'level', 'calibration.json'));
}

/** /api/llm during `vite dev` and `vite preview`, with the same handler as kami/api/llm.ts. */
function llmApi(env: Record<string, string>): Plugin {
  const handler: Connect.NextHandleFunction = async (req, res) => {
    let body = '';
    if (req.method === 'POST') {
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 300_000) break;
      }
    }
    const url = new URL(req.originalUrl ?? req.url ?? '/', 'http://localhost');
    const result = await handleLlmRequest(req.method ?? 'GET', body || undefined, { ...process.env, ...env }, fetch as never, Object.fromEntries(url.searchParams));
    res.statusCode = result.status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(result.body));
  };
  return {
    name: 'kami-llm-api',
    configureServer(server) {
      server.middlewares.use('/api/llm', handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/llm', handler);
    },
  };
}

/** The 気合 loading sheet, inlined so it shows before any script loads (src/ui/brand/loader.ts). */
function kiaiLoader(): Plugin {
  return { name: 'kiai-loader', transformIndexHtml: (html) => html.replace('<!--kiai-loader-->', loaderHtml()) };
}

const katagoProxy = {
  target: 'https://media.katagotraining.org',
  changeOrigin: true,
  rewrite: (p: string) => p.replace(/^\/katago-models/, '/uploaded/networks/models/kata1'),
};

export default defineConfig(({ mode }) => {
  copyEngineFiles();
  // Every variable (no VITE_ prefix) for the dev server only; none reach the client bundle.
  const env = loadEnv(mode, repo, '');
  return {
    root: here,
    publicDir: 'public',
    plugins: [react(), llmApi(env), kiaiLoader()],
    worker: { format: 'es' },
    // The strong network (kata1 b18) downloads through /katago-models, as on Dop (vercel.json has the same rewrite).
    server: { port: 5174, fs: { allow: [repo] }, proxy: { '/katago-models': katagoProxy } },
    preview: { port: 4174, proxy: { '/katago-models': katagoProxy } },
    build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 900 },
  };
});
