/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { handleLlmRequest } from './shared/llmServer.js';

/** Serves /api/llm during `vite dev` and `vite preview` with the same handler the serverless function uses. */
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
    name: 'doppelganger-llm-api',
    configureServer(server) {
      server.middlewares.use('/api/llm', handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/llm', handler);
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load every variable (no VITE_ prefix) for the dev server only; none of them reach the client bundle.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), llmApi(env)],
    worker: { format: 'es' },
    server: {
      proxy: {
        '/katago-models': {
          target: 'https://media.katagotraining.org',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/katago-models/, '/uploaded/networks/models/kata1'),
        },
      },
    },
    build: { target: 'es2022', chunkSizeWarningLimit: 900 },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  };
});
