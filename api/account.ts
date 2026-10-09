/**
 * Vercel serverless function: /api/account?action=status|register|login|logout|part|commit|delete.
 * Accounts are optional; without KV_REST_API_URL and KV_REST_API_TOKEN (Vercel → Storage →
 * Upstash Redis) it answers "not set up" and the app keeps working locally.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleAccountRequest, kvFromEnv, MAX_PART } from '../shared/accountServer.js';

export const config = { maxDuration: 30 };

async function readBody(req: IncomingMessage & { body?: unknown }): Promise<string> {
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_PART + 10_000) break;
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const query = Object.fromEntries(url.searchParams);
  const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : undefined;
  const fwd = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? undefined;
  const result = await handleAccountRequest(
    { method: req.method ?? 'GET', action: query.action ?? '', query, body, cookie: req.headers.cookie, ip },
    kvFromEnv(process.env, fetch as never),
  );
  res.statusCode = result.status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  if (result.cookies?.length) res.setHeader('set-cookie', result.cookies);
  res.end(JSON.stringify(result.body));
}
