// Hub web tools (web_fetch, web_search, image_gen) with fetch mocked.
import { describe, expect, it } from 'vitest';

const lib = (p: string) => import(/* @vite-ignore */ `../hub/lib/${p}` as string) as Promise<any>;

const png = new Uint8Array([137, 80, 78, 71]);
const seen: string[] = [];
const fake = async (url: string) => {
  seen.push(url);
  if (url.startsWith('https://redir.test/')) return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/secret' } });
  if (url.startsWith('https://page.test/')) return new Response('<html><head><title>x</title><style>a{}</style></head><body><h1>Go &amp; Baduk</h1><p>Hello</p><script>evil()</script></body></html>', { headers: { 'content-type': 'text/html' } });
  if (url.startsWith('https://html.duckduckgo.com/')) return new Response('<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&rut=1">Example <b>A</b></a><a class="result__snippet" href="x">About A</a>', { headers: { 'content-type': 'text/html' } });
  if (url.startsWith('https://image.pollinations.ai/')) return new Response(png, { headers: { 'content-type': 'image/png' } });
  if (url.startsWith('https://gen.pollinations.ai/image/')) return new Response(png, { headers: { 'content-type': 'image/png' } });
  return new Response('nope', { status: 404 });
};

describe('hub web tools', () => {
  it('reads pages as text and blocks private addresses', async () => {
    const { webTools } = await lib('tools-web.js');
    const t = Object.fromEntries(webTools(fake).map((x: any) => [x.name, x]));
    expect(await t.web_fetch.run({}, { url: 'https://page.test/a' })).toBe('Go & Baduk\nHello');
    await expect(t.web_fetch.run({}, { url: 'http://localhost:3000' })).rejects.toThrow(/blocked/);
    await expect(t.web_fetch.run({}, { url: 'file:///etc/passwd' })).rejects.toThrow(/http/);
    await expect(t.web_fetch.run({}, { url: 'https://redir.test/x' })).rejects.toThrow(/blocked/); // redirect into a private IP
  });
  it('searches and makes images', async () => {
    const { webTools } = await lib('tools-web.js');
    const t = Object.fromEntries(webTools(fake).map((x: any) => [x.name, x]));
    const s = await t.web_search.run({}, { query: 'go' });
    expect(s).toContain('1. Example A\nhttps://example.com/a\nAbout A');
    const img = await t.image_gen.run({}, { prompt: 'a black stone', width: 5000 });
    expect(img.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png', data: Buffer.from(png).toString('base64') });
    expect(seen.at(-1)).toContain('width=1024');
    expect(seen.at(-1)).toContain('model=flux');
    expect(img.content[1].text).not.toContain('http'); // the picture is shown, not linked
  });
  it('shows a made image in the thread on the hub page', async () => {
    const { webTools } = await lib('tools-web.js');
    const { readImage } = await lib('tools-files.js');
    const posts: any[] = [];
    const cmds: any[][] = [];
    const kv = new Map<string, string>();
    const hub = {
      now: () => 5,
      post: async (m: any) => posts.push(m),
      store: {
        multi: async (c: any[][]) => c.map(([op, k, a, b]) => {
          cmds.push([op, k]);
          if (op === 'SET') kv.set(k, a);
          if (op === 'HSET') kv.set(`${k}|${a}`, b);
          if (op === 'GET') return kv.get(k) ?? null;
          if (op === 'HGET') return kv.get(`${k}|${a}`) ?? null;
          return 1;
        }),
      },
    };
    const t = Object.fromEntries(webTools(fake, hub).map((x: any) => [x.name, x]));
    await t.image_gen.run({ name: 'ME' }, { prompt: 'stone', thread: 7 });
    expect(posts[0]).toMatchObject({ thread: 7, from: 'ME', meta: { image: { account: 'ME', name: 'images/5.png' } } });
    expect(await readImage(hub, 'ME', 'images/5.png')).toEqual({ type: 'image/png', data: Buffer.from(png).toString('base64') });
    expect(await readImage(hub, 'ME', 'images/9.png')).toBeNull();
  });
  it('uses the Pollinations key from the server environment, only as a header', async () => {
    const { webTools } = await lib('tools-web.js');
    const calls: { url: string; auth: string }[] = [];
    const f = async (url: string, init: any) => { calls.push({ url, auth: init?.headers?.authorization || '' }); return fake(url); };
    process.env.POLLINATIONS_API_KEY = 'sk_test123';
    try {
      const t = Object.fromEntries(webTools(f).map((x: any) => [x.name, x]));
      await t.image_gen.run({}, { prompt: 'stone' });
    } finally { delete process.env.POLLINATIONS_API_KEY; }
    expect(calls[0].url.startsWith('https://gen.pollinations.ai/image/stone')).toBe(true);
    expect(calls[0].url).not.toContain('sk_test123');
    expect(calls[0].auth).toBe('Bearer sk_test123');
  });
});
