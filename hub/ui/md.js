// Safe mini markdown for agents' text in the hub feed: **bold**, `code`, ``` blocks ```,
// lists, headings, quotes and links. The whole text is escaped first and only then
// formatted, so no raw HTML from a message can reach the page, and only http(s) links
// are made. No library. Loaded as a plain script before the page script (window.hubMd);
// tests import it and read globalThis.hubMd.
(function (root) {
  const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => MAP[c]);
  // Placeholders hold finished HTML (code, links) while the rest is formatted.
  // NUL is removed from the input first, so a message cannot fake one.
  const NUL = '\u0000';
  const HOLE = /\u0000(\d+)\u0000/g;
  // A URL inside escaped text: no spaces, and no entity but &amp; (quotes and < > end it).
  const URL_RE = /https?:\/\/(?:[^\s&\u0000]|&amp;)+/g;
  const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/(?:[^\s&()\u0000]|&amp;)+)\)/g;
  const count = (s, c) => s.split(c).length - 1;
  // Sentence punctuation after a URL is not part of it; nor is a ")" with no "(" in the URL.
  function trimUrl(u) {
    let tail = '';
    for (;;) {
      if (u.endsWith('&amp;')) { tail = '&amp;' + tail; u = u.slice(0, -5); continue; }
      const c = u[u.length - 1];
      if ('.,;:!?*'.includes(c) || (c === ')' && count(u, '(') < count(u, ')'))) { tail = c + tail; u = u.slice(0, -1); continue; }
      return [u, tail];
    }
  }
  const link = (url, label) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  const bold = (s) => s.replace(/\*\*(\S(?:[^\n]*?\S)?)\*\*/g, '<strong>$1</strong>');
  // One escaped line: code spans, links, bare URLs, then bold.
  function inlineEscaped(line) {
    const keep = [];
    const put = (html) => `${NUL}${keep.push(html) - 1}${NUL}`;
    let s = line
      .replace(/`([^`\n]+)`/g, (_, c) => put(`<code>${c}</code>`))
      .replace(LINK_RE, (_, label, url) => put(link(url, bold(label))))
      .replace(URL_RE, (u) => { const [url, tail] = trimUrl(u); return url.length > 8 ? put(link(url, url)) + tail : u; });
    s = bold(s);
    // A link label can hold a code placeholder, so restore twice.
    for (let i = 0; i < 2; i++) s = s.replace(HOLE, (_, n) => keep[Number(n)]);
    return s;
  }
  const clean = (raw) => String(raw ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n');
  const FENCE = /^ {0,3}```/;
  const ITEM = /^( *)([-*+]|\d{1,3}[.)]) +(\S.*)$/;
  const HEAD = /^ {0,3}#{1,6} +(.+?)(?: +#+)? *$/;
  const QUOTE = /^ {0,3}&gt; ?(.*)$/;
  const isOl = (marker) => /\d/.test(marker);
  // Text to HTML: paragraphs, line breaks, lists, code blocks, headings, quotes.
  function md(raw) {
    const lines = esc(clean(raw)).split('\n');
    const out = [];
    let i = 0;
    const plain = (l) => l.trim() && !FENCE.test(l) && !HEAD.test(l) && !ITEM.test(l) && !QUOTE.test(l);
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { i++; continue; }
      if (FENCE.test(l)) {
        const code = [];
        for (i++; i < lines.length && !FENCE.test(lines[i]); i++) code.push(lines[i]);
        i++;
        out.push(`<pre><code>${code.join('\n')}</code></pre>`);
        continue;
      }
      if (HEAD.test(l)) { out.push(`<p class="mh">${inlineEscaped(HEAD.exec(l)[1])}</p>`); i++; continue; }
      if (QUOTE.test(l)) {
        const q = [];
        for (; i < lines.length && QUOTE.test(lines[i]); i++) q.push(inlineEscaped(QUOTE.exec(lines[i])[1]));
        out.push(`<blockquote>${q.join('<br>')}</blockquote>`);
        continue;
      }
      const first = ITEM.exec(l);
      if (first) {
        const ol = isOl(first[2]);
        const items = [];
        while (i < lines.length) {
          const m = ITEM.exec(lines[i]);
          const sub = m && m[1].length >= 2 && items.length > 0;
          if (m && (sub || isOl(m[2]) === ol)) { items.push(`<li${sub ? ' class="sub"' : ''}>${inlineEscaped(m[3])}</li>`); i++; continue; }
          // An indented line carries on the item above it.
          if (!m && items.length && /^ {2,}\S/.test(lines[i]) && !FENCE.test(lines[i])) {
            items[items.length - 1] = items[items.length - 1].replace(/<\/li>$/, `<br>${inlineEscaped(lines[i].trim())}</li>`);
            i++; continue;
          }
          // One blank line between items of the same list keeps the list going.
          const next = !lines[i].trim() && ITEM.exec(lines[i + 1] || '');
          if (next && isOl(next[2]) === ol) { i++; continue; }
          break;
        }
        const start = ol ? parseInt(first[2], 10) : 1;
        out.push(ol ? `<ol${start !== 1 ? ` start="${start}"` : ''}>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
        continue;
      }
      const para = [];
      for (; i < lines.length && plain(lines[i]); i++) para.push(inlineEscaped(lines[i]));
      out.push(`<p>${para.join('<br>')}</p>`);
    }
    return out.join('');
  }
  // One line of text with inline formatting only (no blocks).
  const inline = (raw) => inlineEscaped(esc(clean(raw)).replace(/\n/g, ' '));
  // The start of a long message for the folded view (null when it is short enough to show whole).
  // Cuts at a line end where it can, and closes a code block it cut open.
  function fold(raw, chars = 600, maxLines = 12) {
    const s = clean(raw).replace(/\s+$/, '');
    const lines = s.split('\n');
    if (s.length <= chars * 1.3 && lines.length <= maxLines + 4) return null;
    let cut = lines.slice(0, maxLines).join('\n');
    if (cut.length > chars) {
      cut = cut.slice(0, chars);
      const nl = cut.lastIndexOf('\n'), sp = cut.lastIndexOf(' ');
      cut = cut.slice(0, nl > chars / 2 ? nl : sp > chars / 2 ? sp : chars);
    }
    cut = cut.replace(/\s+$/, '');
    if (cut.split('\n').filter((l) => FENCE.test(l)).length % 2) cut += '\n```';
    return cut;
  }
  // GitHub pull request links in a message, once each, for the small PR cards.
  const PR_RE = /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)/g;
  function prLinks(raw) {
    const seen = new Set(), out = [];
    for (const m of clean(raw).matchAll(PR_RE)) {
      const url = `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}`;
      if (!seen.has(url)) { seen.add(url); out.push({ url, repo: `${m[1]}/${m[2]}`, n: Number(m[3]) }); }
    }
    return out;
  }
  // The text without a PR link at its very end (the card shows it instead).
  const withoutTrailingPr = (raw) => clean(raw).replace(/[\s:]*https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+\/?[.]?\s*$/, '');
  root.hubMd = { esc, md, inline, fold, prLinks, withoutTrailingPr };
})(typeof window !== 'undefined' ? window : globalThis);
