import { describe, expect, it } from 'vitest';
import { brushMarkup, timeline } from '../kami/src/ui/brand/brush';
import { GLYPHS, STROKES, TAGLINE, WORDMARK } from '../kami/src/ui/brand/glyphs';
import { loaderFiles, loaderHtml } from '../kami/src/ui/brand/loader';
import { sealMarkup } from '../kami/src/ui/brand/seal';

describe('Kiai brand: 気合 brush, seal and loader', () => {
  it('writes 気 in 6 strokes and 合 in 6, in that order', () => {
    expect(GLYPHS).toHaveLength(2);
    expect(STROKES.filter((s) => s.glyph === 0)).toHaveLength(6);
    expect(STROKES.filter((s) => s.glyph === 1)).toHaveLength(6);
    expect(STROKES.findIndex((s) => s.glyph === 1)).toBe(6);
  });

  it('writes the word in about two and a half seconds, strokes one after another', () => {
    const { strokes, done } = timeline();
    expect(done).toBeGreaterThan(1800);
    expect(done).toBeLessThan(2800);
    for (let i = 1; i < strokes.length; i++) expect(strokes[i].delay).toBeGreaterThanOrEqual(strokes[i - 1].delay + strokes[i - 1].dur);
  });

  it('gives each drawing its own mask and filter ids', () => {
    const a = brushMarkup({ id: 'a', write: true });
    const b = brushMarkup({ id: 'b', write: true });
    expect(a).toContain('mask="url(#a-m)"');
    expect(b).toContain('mask="url(#b-m)"');
    expect(a.match(/class="kb-s"/g)).toHaveLength(12);
    expect(brushMarkup({ id: 'c' })).not.toContain('<mask');
  });

  it('keeps the seal clean below 48 px and uses the carved small 気 at 32 px and below', () => {
    expect(sealMarkup({ id: 's', size: 16 })).not.toContain('<filter');
    expect(sealMarkup({ id: 's', size: 24 })).toContain('stroke-width="11"');
    expect(sealMarkup({ id: 's', size: 16 })).toContain('stroke-width="12"');
    expect(sealMarkup({ id: 's', size: 64 })).toContain('translate(-530 -791)');
    expect(sealMarkup({ id: 's', size: 96 })).toContain('<filter id="s-st"');
  });

  it('ships the loader as plain markup that waits for kiai-ready and never blocks for good', () => {
    const html = loaderHtml();
    expect(html).toContain('id="kiai-loader"');
    expect(html).toContain("addEventListener('kiai-ready'");
    expect(html).toContain('9000');
    expect(html).toContain(WORDMARK[0].slice(0, 20));
    expect(html).not.toMatch(/ikki|razorbill/i);
  });

  it('is no forced intro: the sheet shows only when the page is late, first visit or not', () => {
    const html = loaderHtml();
    expect(html).not.toContain('kiai.seen');
    expect(html).toContain('},450)');
    // hidden until then, and gone the moment the page is ready
    expect(html).toMatch(/d\.classList\.add\('kl-repeat'\)/);
    expect(html).toContain('function check(){if(ready)hide()}');
  });

  it('moves the seal and tagline to files when the build gives URLs, keeping the brush inline', () => {
    const html = loaderHtml({ seal: '/assets/s.svg', tagline: '/assets/t.svg' });
    expect(html).toContain('<img src="/assets/s.svg"');
    expect(html).toContain('src="/assets/t.svg"');
    expect(html).not.toContain(TAGLINE[0].slice(0, 40));
    expect(html).toContain(WORDMARK[0].slice(0, 20));
    const files = loaderFiles();
    expect(files.seal).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(files.tagline).toContain(TAGLINE[0].slice(0, 40));
  });
});
