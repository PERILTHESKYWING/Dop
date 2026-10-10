// Packs public/pc-helper/ into public/downloads/dop-pc-helper.zip (git-ignored), so the
// PC helper is one download from Settings. Runs before every build and dev start.
// A plain stored (uncompressed) zip: the files are small text.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'public', 'pc-helper');
const out = path.join(root, 'public', 'downloads', 'dop-pc-helper.zip');

const table = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const files = readdirSync(src).filter((n) => statSync(path.join(src, n)).isFile()).sort();
// The site's own addresses (Vercel sets these while building), so the helper lets the site
// in even on a custom domain (dop_pc.py site_origins).
const sites = [process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_URL].filter(Boolean).map((h) => `https://${h}`);
const extra = sites.length ? { 'site.txt': Buffer.from(sites.join('\n') + '\n') } : {};
const entries = [...files.map((n) => [n, readFileSync(path.join(src, n))]), ...Object.entries(extra)].sort((a, b) => a[0].localeCompare(b[0]));
const locals = [];
const centrals = [];
let offset = 0;
for (const [name, data] of entries) {
  const fname = Buffer.from(`dop-pc-helper/${name}`);
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8); // stored
  local.writeUInt32LE(0x00210000, 10); // a fixed date (1980-01-01)
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(fname.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, fname, data);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(0x00210000, 12);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(fname.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, fname);
  offset += 30 + fname.length + data.length;
}
const centralSize = centrals.reduce((a, b) => a + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([...locals, ...centrals, end]));
console.log(`packed ${entries.length} files -> ${path.relative(root, out)}${sites.length ? ` (site: ${sites.join(', ')})` : ''}`);
