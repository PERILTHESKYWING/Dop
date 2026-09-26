#!/usr/bin/env node
/**
 * Copies the loader rules of src/styles/brand.css (between the splash:begin and splash:end comments) into the
 * inline <style id="splash-css"> of index.html, so the pre-JS splash animates exactly like <BrandLoader>.
 * The copy is renamed so it can never touch the React loader: .brand-loader -> #dop-splash, bl- -> sp-.
 *
 *   node tools/brand/sync-splash.mjs          # rewrite index.html
 *   node tools/brand/sync-splash.mjs --check  # exit 1 if index.html is out of date
 *
 * The splash's SVG markup in index.html is written by hand and mirrors BrandLoader in src/components/Brand.tsx.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cssFile = path.join(repoRoot, 'src/styles/brand.css');
const htmlFile = path.join(repoRoot, 'index.html');

const css = fs.readFileSync(cssFile, 'utf8');
const m = css.match(/\/\* splash:begin[^*]*\*\/([\s\S]*?)\/\* splash:end \*\//);
if (!m) throw new Error('brand.css: splash:begin / splash:end markers not found');

const splashCss = m[1]
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\.brand-loader/g, '#dop-splash')
  .replace(/\bbl-/g, 'sp-')
  .replace(/\s+/g, ' ')
  .replace(/\s*([{};,])\s*/g, '$1')
  .replace(/:\s+/g, ':')
  .replace(/;}/g, '}')
  .trim();

const html = fs.readFileSync(htmlFile, 'utf8');
const re = /(<style id="splash-css">)([\s\S]*?)(<\/style>)/;
if (!re.test(html)) throw new Error('index.html: <style id="splash-css"> not found');
const next = html.replace(re, (_, open, _old, close) => `${open}${splashCss}${close}`);

if (process.argv.includes('--check')) {
  if (next !== html) {
    console.error('index.html splash CSS is out of date: run node tools/brand/sync-splash.mjs');
    process.exit(1);
  }
  console.log('index.html splash CSS is up to date');
} else {
  fs.writeFileSync(htmlFile, next);
  console.log(`index.html splash CSS: ${(splashCss.length / 1000).toFixed(1)} KB`);
}
