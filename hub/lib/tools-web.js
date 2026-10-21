// Free internet tools for the hub MCP: web_fetch, web_search, image_gen.
// No API keys. Each tool returns a string, or { content: [...] } for images.
const UA = 'Mozilla/5.0 (compatible; DopHub/1.0)';
const MAX_BYTES = 1_500_000;
const MAX_TEXT = 20_000;
const TIMEOUT_MS = 20_000;

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;
export function isPrivateHost(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (PRIVATE_HOST.test(h)) return true;
  if (h.includes(':')) return h === '::1' || /^(fc|fd|fe80)/.test(h) || h.startsWith('::ffff:');
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function checkUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Not a valid URL.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https URLs.');
  if (isPrivateHost(u.hostname)) throw new Error('Private or local addresses are blocked.');
  return u;
}

async function get(f, url, headers = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    let cur = checkUrl(url);
    for (let hop = 0; hop < 5; hop++) {
      const res = await f(cur.href, { headers: { 'user-agent': UA, ...headers }, redirect: 'manual', signal: ac.signal });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        cur = checkUrl(new URL(res.headers.get('location'), cur).href); // re-check every hop
        continue;
      }
      return res;
    }
    throw new Error('Too many redirects.');
  } finally {
    clearTimeout(t);
  }
}

async function bytesOf(res) {
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf.length > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const unent = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
  }
  return ENT[e.toLowerCase()] ?? m;
});

export function htmlToText(html) {
  return unent(
    html
      .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\r]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseDuckDuckGo(html, limit) {
  const out = [];
  for (const block of html.split(/(?=<a[^>]+class="result__a")/)) {
    if (out.length >= limit) break;
    const a = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let href = unent(a[1]);
    const q = href.match(/[?&]uddg=([^&]+)/);
    if (q) href = decodeURIComponent(q[1]);
    const sn = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    out.push({ title: htmlToText(a[2]), url: href, snippet: sn ? htmlToText(sn[1]) : '' });
  }
  return out;
}

export function webTools(f = fetch) {
  const str = { type: 'string' };
  const num = { type: 'number' };
  return [
    {
      name: 'web_fetch',
      description: 'Read a web page or text file from the internet (free). Returns the page as plain text, cut to max_chars (default 20000). JSON and plain text come back as is. Private/local addresses are blocked.',
      inputSchema: { type: 'object', properties: { url: str, max_chars: num }, required: ['url'] },
      run: async (_a, x) => {
        const res = await get(f, x.url, { accept: 'text/html,application/json,text/plain,*/*;q=0.5' });
        if (!res.ok) return `HTTP ${res.status} from ${x.url}`;
        const type = String(res.headers.get('content-type') || '');
        if (/^(image|video|audio)\//i.test(type) || /pdf|zip|octet-stream/i.test(type)) return `Not readable as text (${type}).`;
        const raw = new TextDecoder().decode(await bytesOf(res));
        const text = /html/i.test(type) || /^\s*<(!doctype|html)/i.test(raw) ? htmlToText(raw) : raw;
        const cap = Math.max(500, Math.min(MAX_TEXT, Number(x.max_chars) || MAX_TEXT));
        return text.length > cap ? `${text.slice(0, cap)}\n[cut: ${text.length - cap} more characters]` : text || '(empty page)';
      },
    },
    {
      name: 'web_search',
      description: 'Search the web (free, no key). Returns up to max_results (default 6) results with title, link and snippet. Follow up with web_fetch to read one.',
      inputSchema: { type: 'object', properties: { query: str, max_results: num }, required: ['query'] },
      run: async (_a, x) => {
        const limit = Math.max(1, Math.min(10, Number(x.max_results) || 6));
        const q = encodeURIComponent(x.query);
        let results = [];
        try {
          const res = await get(f, `https://html.duckduckgo.com/html/?q=${q}`);
          if (res.ok) results = parseDuckDuckGo(new TextDecoder().decode(await bytesOf(res)), limit);
        } catch {}
        if (!results.length) {
          // Fallback: Wikipedia's search API (stable, free).
          const res = await get(f, `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${limit}&srsearch=${q}`);
          if (!res.ok) return `Search failed (HTTP ${res.status}).`;
          const j = await res.json();
          results = (j.query?.search || []).map((s) => ({ title: s.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, '_'))}`, snippet: htmlToText(s.snippet) }));
        }
        return results.length ? results.map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n') : 'No results.';
      },
    },
    {
      name: 'image_gen',
      description: 'Make an image from a text prompt (free, via Pollinations, no key). Returns the picture. Optional width/height (256-1024, default 768), seed, model (default flux).',
      inputSchema: { type: 'object', properties: { prompt: str, width: num, height: num, seed: num, model: str }, required: ['prompt'] },
      run: async (_a, x) => {
        const dim = (v) => Math.max(256, Math.min(1024, Math.round(Number(v) || 768)));
        const seed = Number.isFinite(Number(x.seed)) && x.seed !== undefined ? `&seed=${Math.floor(Number(x.seed))}` : '';
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(String(x.prompt).slice(0, 1000))}?width=${dim(x.width)}&height=${dim(x.height)}&nologo=true&enhance=true&model=${encodeURIComponent(String(x.model || 'flux').slice(0, 30))}${seed}`;
        const res = await get(f, url);
        const type = String(res.headers.get('content-type') || '');
        if (!res.ok || !/^image\//i.test(type)) return `Image service said HTTP ${res.status} (${type || 'no type'}). Try again in a minute.`;
        const buf = Buffer.from(new Uint8Array(await res.arrayBuffer()));
        return { content: [{ type: 'image', data: buf.toString('base64'), mimeType: type.split(';')[0] }, { type: 'text', text: `Image for: ${x.prompt}` }] };
      },
    },
  ];
}
