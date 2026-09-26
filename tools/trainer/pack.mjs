// Packs trainer/ into public/downloads/dop-trainer.zip, the download on the Home Trainer page.
// Runs before every build, so the zip always matches the trainer code in the repo.
// It also bundles the MIT-licensed b10 network from public/models as the rating reference.
import { deflateRawSync } from 'node:zlib';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = join(root, 'trainer');
const out = join(root, 'public', 'downloads', 'dop-trainer.zip');
const PREFIX = 'dop-trainer/';

/** [path in zip, contents] */
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    if (name === '__pycache__' || name === 'tests' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push([PREFIX + relative(src, p).split('\\').join('/'), readFileSync(p)]);
  }
};
walk(src);
// cmd.exe wants CRLF line endings in batch files.
for (const f of files) if (f[0].endsWith('.bat')) f[1] = Buffer.from(f[1].toString('utf8').replace(/\r?\n/g, '\r\n'));
for (const name of readdirSync(join(root, 'public', 'models'))) {
  if (name.endsWith('.bin.gz')) files.push([PREFIX + 'reference/' + name, readFileSync(join(root, 'public', 'models', name))]);
}
files.push([PREFIX + 'reference/LICENSE-KataGo.txt', readFileSync(join(root, 'public', 'engine', 'LICENSE-KataGo.txt'))]);

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// A fixed timestamp keeps the zip identical between builds of the same code.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

const locals = [];
const centrals = [];
let offset = 0;
for (const [name, data] of files) {
  const nameBuf = Buffer.from(name, 'utf8');
  const packed = name.endsWith('.gz') ? data : deflateRawSync(data, { level: 9 });
  const method = packed === data ? 0 : 8;
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, nameBuf, packed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0314, 4); // made by: Unix, zip 2.0
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(((name.endsWith('.sh') ? 0o100755 : 0o100644) * 0x10000) >>> 0, 38);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, nameBuf);
  offset += 30 + nameBuf.length + packed.length;
}
const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(dirname(out), { recursive: true });
const zip = Buffer.concat([...locals, ...centrals, end]);
writeFileSync(out, zip);
console.log(`trainer: packed ${files.length} files into ${relative(root, out)} (${(zip.length / 1e6).toFixed(1)} MB)`);
