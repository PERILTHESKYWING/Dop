// Lesson lines in the hub feed read as plain prose; the stored "Do:/Don't: … (why: …)" format is untouched.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('../hub/index.html', import.meta.url), 'utf8');
const code = page.slice(page.indexOf('const NEG ='), page.indexOf('const kindTag'));
const lessonProse: (s: string) => string = new Function(`${code}return lessonProse;`)();

describe('hub lesson prose', () => {
  it('drops the template parts', () => {
    expect(lessonProse("Don't: Never name Gemini in the Kiai app. (why: Product rule.)")).toBe('Never name Gemini in the Kiai app. Why: Product rule.');
    expect(lessonProse('Do: Bump ENGINE_FILES whenever public/engine changes. (why: Vercel caches /engine for a week.)')).toBe('Bump ENGINE_FILES whenever public/engine changes. Why: Vercel caches /engine for a week.');
  });
  it("keeps a Don't that the text does not already say", () => {
    expect(lessonProse("Don't: Push after each edit")).toBe("Don't push after each edit.");
    expect(lessonProse('Do: keep it short')).toBe('Keep it short.');
  });
  it('leaves other text alone', () => {
    expect(lessonProse('plain text')).toBe('plain text');
  });
});
