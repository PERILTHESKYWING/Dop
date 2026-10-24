// Safe mini markdown for agents' text in the hub feed (hub/ui/md.js).
import { beforeAll, describe, expect, it } from 'vitest';

let md: any;
beforeAll(async () => {
  await import(/* @vite-ignore */ '../hub/ui/md.js' as string);
  md = (globalThis as any).hubMd;
});

describe('hub mini markdown: formatting', () => {
  it('does bold, inline code and paragraphs', () => {
    expect(md.md('first paint **2.8 s**')).toBe('<p>first paint <strong>2.8 s</strong></p>');
    expect(md.md('run `npm test` now')).toBe('<p>run <code>npm test</code> now</p>');
    expect(md.md('one\ntwo\n\nthree')).toBe('<p>one<br>two</p><p>three</p>');
    expect(md.md('a ** b ** c')).toBe('<p>a ** b ** c</p>');
  });

  it('keeps code literal, in spans and blocks', () => {
    expect(md.md('`**not bold**`')).toBe('<p><code>**not bold**</code></p>');
    expect(md.md('```ts\nif (a < b) return;\n```')).toBe('<pre><code>if (a &lt; b) return;</code></pre>');
    expect(md.md('```\nnever closed')).toBe('<pre><code>never closed</code></pre>');
  });

  it('makes lists, numbered lists and nested items', () => {
    expect(md.md('Changes:\n- one\n- two')).toBe('<p>Changes:</p><ul><li>one</li><li>two</li></ul>');
    expect(md.md('3. c\n4. d')).toBe('<ol start="3"><li>c</li><li>d</li></ol>');
    expect(md.md('1. a\n\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
    expect(md.md('- a\n  - sub')).toBe('<ul><li>a</li><li class="sub">sub</li></ul>');
    expect(md.md('**Bold** start')).toBe('<p><strong>Bold</strong> start</p>');
  });

  it('links bare URLs and [label](url), without trailing punctuation', () => {
    expect(md.md('See https://github.com/a/b/pull/2.')).toBe('<p>See <a href="https://github.com/a/b/pull/2" target="_blank" rel="noopener noreferrer">https://github.com/a/b/pull/2</a>.</p>');
    expect(md.md('[the PR](https://x.io/p?a=1&b=2)')).toBe('<p><a href="https://x.io/p?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">the PR</a></p>');
    expect(md.md('(see https://x.io/a)')).toContain('href="https://x.io/a"');
    expect(md.md('heading\n## Plan')).toBe('<p>heading</p><p class="mh">Plan</p>');
  });

  it('inline() formats one line only', () => {
    expect(md.inline('a **b**\n- c')).toBe('a <strong>b</strong> - c');
  });
});

describe('hub mini markdown: XSS', () => {
  const noTag = (h: string) => expect(h).not.toMatch(/<(script|img|iframe|svg|style)/i);
  const noHandler = (h: string) => expect(h).not.toMatch(/<[a-z]+[^>]*\son[a-z]+=/i);

  it('escapes raw HTML everywhere', () => {
    for (const x of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '**<svg onload=alert(1)>**', '- <iframe src=//e.com>', '```\n</code></pre><script>x</script>\n```', '`<style>`', '> <img src=x>']) {
      const h = md.md(x);
      noTag(h); noHandler(h);
    }
    expect(md.md('<b>hi</b>')).toBe('<p>&lt;b&gt;hi&lt;/b&gt;</p>');
  });

  it('only makes http(s) links and never breaks out of href', () => {
    for (const x of ['[x](javascript:alert(1))', '[x](data:text/html,<script>)', 'javascript:alert(1)', '[x](vbscript:msgbox)']) {
      const h = md.md(x);
      expect(h).not.toMatch(/href="(?!https?:)/);
      noTag(h);
    }
    for (const x of ['https://e.com/"onmouseover="alert(1)', "https://e.com/'onmouseover='alert(1)", '[a](https://e.com/" onclick="x)', 'https://e.com/<script>']) {
      const h = md.md(x);
      noHandler(h); noTag(h);
      for (const [, href] of h.matchAll(/href="([^"]*)"/g)) expect(href).toMatch(/^https:\/\/[^\s"'<>]*$/);
      expect(h.match(/<a /g) || []).toHaveLength(1);
    }
  });

  it('cannot fake internal placeholders', () => {
    const h = md.md('\u00000\u0000 and `x` \u00001\u0000');
    expect(h).not.toContain('undefined');
    expect(h).toBe('<p>0 and <code>x</code> 1</p>');
  });
});

describe('hub mini markdown: fold and PR cards', () => {
  it('folds only long messages, at a line end, closing a cut code block', () => {
    expect(md.fold('short message')).toBeNull();
    const long = Array.from({ length: 30 }, (_, i) => `line ${i} with some words in it`).join('\n');
    const f = md.fold(long);
    expect(f).not.toBeNull();
    expect(f.split('\n').length).toBe(12);
    const code = 'intro\n```\n' + Array.from({ length: 30 }, (_, i) => `x${i}`).join('\n') + '\n```';
    expect(md.fold(code).endsWith('\n```')).toBe(true);
    const wall = 'word '.repeat(300);
    expect(md.fold(wall).length).toBeLessThanOrEqual(600);
  });

  it('finds PR links once and drops a trailing one from the text', () => {
    const t = 'Fixed it. PR #212 is ready: https://github.com/PERILTHESKYWING/Dop/pull/212 (also https://github.com/PERILTHESKYWING/Dop/pull/212)';
    expect(md.prLinks(t)).toEqual([{ url: 'https://github.com/PERILTHESKYWING/Dop/pull/212', repo: 'PERILTHESKYWING/Dop', n: 212 }]);
    expect(md.withoutTrailingPr('Done: https://github.com/a/b/pull/7')).toBe('Done');
    expect(md.withoutTrailingPr('See https://github.com/a/b/pull/7 first')).toBe('See https://github.com/a/b/pull/7 first');
    expect(md.withoutTrailingPr('Done. Fixed. PR: https://github.com/a/b/pull/7')).toBe('Done. Fixed.');
    expect(md.withoutTrailingPr('Done, see pull request https://github.com/a/b/pull/7.')).toBe('Done, see');
    expect(md.prLinks('https://github.com/a/b/pull/7"><script>')).toEqual([{ url: 'https://github.com/a/b/pull/7', repo: 'a/b', n: 7 }]);
  });
});
