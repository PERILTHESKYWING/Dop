// Hub feed look: hub notes never read ". · time", sheets close with one icon button, long feeds warm while idle.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('../hub/index.html', import.meta.url), 'utf8');
const code = page.slice(page.indexOf('const noteText ='), page.indexOf('// A thread the coordinator made'));
const noteText: (s: string) => string = new Function(`${code}return noteText;`)();

describe('hub note text', () => {
  it('drops one trailing full stop before the time', () => {
    expect(noteText('Started Main on Opus.')).toBe('Started Main on Opus');
    expect(noteText('Coordinator started on Alt 2 (Sonnet).')).toBe('Coordinator started on Alt 2 (Sonnet)');
    expect(noteText('New work goes to other accounts. ')).toBe('New work goes to other accounts');
  });
  it('keeps an ellipsis, dots inside the text and text without a stop', () => {
    expect(noteText('Reading usage…')).toBe('Reading usage…');
    expect(noteText('Waiting...')).toBe('Waiting...');
    expect(noteText('v1.2 is out')).toBe('v1.2 is out');
  });
  it('is what the hub note draws', () => {
    expect(page).toContain('noteText(capModels(m.text))');
  });
});

describe('hub sheets and feed', () => {
  it('closes a sheet with the icon button, not a Close word', () => {
    const head = /const sHead = [^\n]*/.exec(page)?.[0] || '';
    expect(head).toContain('class="ib" data-close aria-label="Close" title="Close (Esc)"');
    expect(head).not.toMatch(/>Close</);
  });
  it('warms long feeds while idle and draws no empty task group', () => {
    expect(page).toContain('#feed > .sw.warm { content-visibility: visible; }');
    expect(page).toMatch(/if \(added\) warmFeed\(\);/);
    expect(page).not.toContain('Nothing here.');
  });
});
