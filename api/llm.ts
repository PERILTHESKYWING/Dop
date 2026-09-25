/**
 * Vercel serverless function: POST /api/llm (pattern discovery), GET /api/llm (status).
 * LLM_API_KEY, LLM_MODEL and LLM_PROVIDER are read from the server environment only.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleLlmRequest } from '../shared/llmServer.js';

export const config = { maxDuration: 60 };

async function readBody(req: IncomingMessage & { body?: unknown }): Promise<string> {
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 300_000) break;
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  const body = req.method === 'POST' ? await readBody(req) : undefined;
  const result = await handleLlmRequest(req.method ?? 'GET', body, process.env, fetch as never);
  res.statusCode = result.status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(result.body));
}
