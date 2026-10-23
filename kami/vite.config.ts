/// <reference types="node" />
/**
 * Kami's own Vite config: run from the repo root with `npm run kami:dev` / `kami:build`
 * (or by Vercel with Root Directory = kami, see kami/vercel.json). It imports Dop's code
 * from ../src and serves Dop's engine files, copied (not committed) into kami/public.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Connect, type Plugin, type Rollup } from 'vite';
import react from '@vitejs/plugin-react';
import { handleLlmRequest } from '../shared/llmServer.js';
import { handleAccountRequest, kvFromEnv } from '../shared/accountServer.js';
import { loaderFiles, loaderHtml, type LoaderAssets } from './src/ui/brand/loader';

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

/**
 * /api/account during `vite dev` and `vite preview` (Dop's handler, which serves Kiai's kiai-…
 * actions), with an in-memory store unless KV_REST_API_URL/TOKEN are set: accounts work locally
 * and are forgotten on restart. Production Kiai calls Dop's /api/account cross-origin (src/config.ts).
 */
function accountApi(env: Record<string, string>): Plugin {
  const handler: Connect.NextHandleFunction = async (req, res) => {
    let body = '';
    if (req.method === 'POST' || req.method === 'PUT') {
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1_000_000) break;
      }
    }
    const url = new URL(req.originalUrl ?? req.url ?? '/', 'http://localhost');
    const query = Object.fromEntries(url.searchParams);
    const result = await handleAccountRequest(
      { method: req.method ?? 'GET', action: query.action ?? '', query, body: body || undefined, cookie: req.headers.cookie, ip: req.socket.remoteAddress },
      kvFromEnv({ ACCOUNT_STORE: 'memory', ...process.env, ...env }, fetch as never),
    );
    res.statusCode = result.status;
    res.setHeader('content-type', 'application/json');
    if (result.cookies?.length) res.setHeader('set-cookie', result.cookies);
    res.end(JSON.stringify(result.body));
  };
  return {
    name: 'kiai-account-api',
    configureServer(server) {
      server.middlewares.use('/api/account', handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/account', handler);
    },
  };
}

/**
 * The 気合 loading sheet, inlined so it shows before any script loads (src/ui/brand/loader.ts).
 * In the build it also makes that sheet the first paint:
 * - the seal and tagline (not seen until ~2.9 s) go to hashed /assets SVGs, cached for a year;
 * - the app's stylesheets move from <head> to just above #root, so the sheet paints without
 *   waiting for ~70 KB of CSS (the app's module script still waits for them, as before);
 * - a tiny inline body colour (light/dark, as styles.css) covers the moment before they arrive;
 * - on a first visit, the landing's chunks (Landing, its CSS, Stage, the 3D kit) are preloaded at
 *   once instead of one after another as each import runs. Return visits skip it (main.tsx logic).
 */
function kiaiLoader(): Plugin {
  let build = false;
  const files = Object.entries(loaderFiles()).map(([k, source]) => ({
    key: k as keyof LoaderAssets,
    source,
    fileName: `assets/kiai-${k}-${createHash('sha256').update(source).digest('base64url').slice(0, 8)}.svg`,
  }));
  return {
    name: 'kiai-loader',
    configResolved(c) {
      build = c.command === 'build';
    },
    generateBundle() {
      for (const f of files) this.emitFile({ type: 'asset', fileName: f.fileName, source: f.source });
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!build) return html.replace('<!--kiai-loader-->', loaderHtml());
        const assets = Object.fromEntries(files.map((f) => [f.key, '/' + f.fileName])) as unknown as LoaderAssets;
        const sheets: string[] = [];
        html = html.replace(/[ \t]*<link rel="stylesheet"[^>]*>\n?/g, (tag) => (sheets.push(tag.trim()), ''));
        const critical = "<style>body{background:#f6f8fb}@media (prefers-color-scheme:dark){body{background:#0a0e14}}</style>";
        html = html.replace('<!--kiai-loader-->', critical + loaderHtml(assets) + landingPreload(ctx.bundle) + sheets.join(''));
        return html;
      },
    },
  };
}

/**
 * Preload the first screen's lazy chunks so they download beside the entry instead of one after
 * another as each import runs: the landing's on a first visit (or #welcome), the app's on a return
 * visit (same rule as main.tsx). The landing's 3D scene (Stage, three.js) is left out on purpose:
 * it loads once the landing has painted (Landing.tsx), and not at all on a software-only WebGL.
 */
function landingPreload(bundle: Rollup.OutputBundle | undefined): string {
  if (!bundle) return '';
  const chunks = Object.values(bundle).filter((c): c is Rollup.OutputChunk => c.type === 'chunk');
  const entry = chunks.find((c) => c.isEntry);
  const landing = chunks.find((c) => c.facadeModuleId?.endsWith('/kami/src/ui/Landing.tsx'));
  const app = chunks.find((c) => c.facadeModuleId?.endsWith('/kami/src/App.tsx'));
  if (!entry) return '';
  const list = (root: Rollup.OutputChunk | undefined) => {
    if (!root) return '[]';
    const have = new Set([entry.fileName, ...entry.imports]);
    const js: string[] = [];
    const css = new Set<string>();
    const add = (c: Rollup.OutputChunk | undefined) => {
      if (!c || have.has(c.fileName)) return;
      have.add(c.fileName);
      js.push(c.fileName);
      c.viteMetadata?.importedCss.forEach((f) => css.add(f));
      c.imports.forEach((f) => add(chunks.find((x) => x.fileName === f)));
    };
    add(root);
    return JSON.stringify([...css].map((f) => '/' + f).concat(js.map((f) => '/' + f)));
  };
  return (
    `<script>try{var h=location.hash,e=true;try{e=localStorage.getItem('kiai.entered')==='1'}catch(x){}` +
    `(h==='#annotate'?[]:h==='#welcome'||!e?${list(landing)}:${list(app)})` +
    `.forEach(function(u){var l=document.createElement('link'),c=/\\.css$/.test(u);l.rel=c?'preload':'modulepreload';if(c)l.as='style';l.crossOrigin='';l.href=u;document.head.appendChild(l)})}catch(e){}</script>`
  );
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
    plugins: [react(), llmApi(env), accountApi(env), kiaiLoader()],
    worker: { format: 'es' },
    // The strong network (kata1 b18) downloads through /katago-models, as on Dop (vercel.json has the same rewrite).
    server: { port: 5174, fs: { allow: [repo] }, proxy: { '/katago-models': katagoProxy } },
    preview: { port: 4174, proxy: { '/katago-models': katagoProxy } },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      target: 'es2022',
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          // React (and zustand) in its own file: it changes far less often than Kiai, so browsers keep it across deploys.
          manualChunks: (id) => (/[\\/]node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/.test(id) ? 'react' : undefined),
        },
      },
    },
  };
});
