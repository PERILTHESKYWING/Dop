import { describe, expect, it } from 'vitest';
import { handleAccountRequest, memoryKv, normaliseName, type AccountRequest } from '../shared/accountServer';

const call = (kv: ReturnType<typeof memoryKv>, action: string, method: string, body?: unknown, cookie?: string, query: Record<string, string> = {}) =>
  handleAccountRequest({ method, action, query, body: body === undefined ? undefined : JSON.stringify(body), cookie, ip: '1.2.3.4' } as AccountRequest, kv);
const cookieOf = (cookies?: string[]) => cookies?.[0]?.split(';')[0];

describe('account server', () => {
  it('says accounts are off without a store, and the status still answers', async () => {
    expect((await handleAccountRequest({ method: 'GET', action: 'status', query: {} }, null)).body).toMatchObject({ configured: false });
    expect((await handleAccountRequest({ method: 'POST', action: 'login', query: {} }, null)).status).toBe(503);
  });

  it('registers, signs in and out, never storing the password', async () => {
    const kv = memoryKv();
    const reg = await call(kv, 'register', 'POST', { username: 'Xiao', password: 'correct horse' });
    expect(reg.status).toBe(200);
    expect(reg.body).toMatchObject({ user: { name: 'xiao' } });
    const c = cookieOf(reg.cookies)!;
    expect(reg.cookies![0]).toMatch(/HttpOnly/);
    const stored = (await kv.get('user:xiao'))!;
    expect(stored).not.toContain('correct horse');
    expect((await call(kv, 'status', 'GET', undefined, c)).body).toMatchObject({ configured: true, user: { name: 'xiao' } });
    expect((await call(kv, 'register', 'POST', { username: 'xiao', password: 'another one' })).status).toBe(409);
    expect((await call(kv, 'login', 'POST', { username: 'xiao', password: 'wrong password' })).status).toBe(401);
    const login = await call(kv, 'login', 'POST', { username: 'XIAO', password: 'correct horse' });
    expect(login.status).toBe(200);
    await call(kv, 'logout', 'POST', undefined, c);
    expect((await call(kv, 'status', 'GET', undefined, c)).body).toMatchObject({ user: null });
  });

  it('checks names and password length', async () => {
    const kv = memoryKv();
    expect(normaliseName(' Ab_c ')).toBe('ab_c');
    expect(normaliseName('a')).toBeNull();
    expect(normaliseName('has space')).toBeNull();
    expect((await call(kv, 'register', 'POST', { username: 'ok-name', password: 'short' })).status).toBe(400);
  });

  it('limits repeated sign-in attempts', async () => {
    const kv = memoryKv();
    await call(kv, 'register', 'POST', { username: 'target', password: 'long enough pw' });
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await call(kv, 'login', 'POST', { username: 'target', password: 'nope nope nope' })).status;
    expect(last).toBe(429);
  });

  it('stores an upload in parts and hands it back; a new upload replaces the old', async () => {
    const kv = memoryKv();
    const c = cookieOf((await call(kv, 'register', 'POST', { username: 'sync', password: 'long enough pw' })).cookies)!;
    expect((await call(kv, 'part', 'PUT', { id: 'upload0001', index: 0, data: 'AAAA' })).status).toBe(401);
    expect((await call(kv, 'part', 'PUT', { id: 'upload0001', index: 0, data: 'AAAA' }, c)).status).toBe(200);
    expect((await call(kv, 'commit', 'POST', { id: 'upload0001', parts: 2 }, c)).status).toBe(409);
    await call(kv, 'part', 'PUT', { id: 'upload0001', index: 1, data: 'BBBB' }, c);
    const done = await call(kv, 'commit', 'POST', { id: 'upload0001', parts: 2, device: 'Chrome on Mac' }, c);
    expect(done.body).toMatchObject({ snapshot: { id: 'upload0001', parts: 2, size: 8, device: 'Chrome on Mac' } });
    expect((await call(kv, 'part', 'GET', undefined, c, { id: 'upload0001', index: '1' })).body).toMatchObject({ data: 'BBBB' });
    await call(kv, 'part', 'PUT', { id: 'upload0002', index: 0, data: 'CCCC' }, c);
    await call(kv, 'commit', 'POST', { id: 'upload0002', parts: 1 }, c);
    expect(await kv.get('part:sync:upload0001:0')).toBeNull();
    expect((await call(kv, 'part', 'GET', undefined, c, { id: 'upload0001', index: '0' })).status).toBe(409);
    expect((await call(kv, 'part', 'PUT', { id: 'upload0003', index: 0, data: 'not base64!' }, c)).status).toBe(400);
  });

  it('deletes an account only with its password', async () => {
    const kv = memoryKv();
    const c = cookieOf((await call(kv, 'register', 'POST', { username: 'gone', password: 'long enough pw' })).cookies)!;
    expect((await call(kv, 'delete', 'POST', { password: 'wrong' }, c)).status).toBe(401);
    expect((await call(kv, 'delete', 'POST', { password: 'long enough pw' }, c)).status).toBe(200);
    expect(await kv.get('user:gone')).toBeNull();
  });
});
