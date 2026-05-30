// Recompress static images. JPG stays JPG (quality 78, mozjpeg progressive).
// PNG stays PNG (palette + zlib level 9). Conservative — no format changes,
// so all existing references keep working without HTML/CSS/JS edits.
import sharp from 'sharp';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TARGETS = [
  'assets/milestone-scroll-bg.jpg',
  ...['icon-1-beidou','icon-2-house','icon-3-ancient','icon-4-hui','icon-5-fu',
      'icon-6-fire','icon-7-wang','icon-8-bagua','icon-9-chuan',
      'pillar-1-stars','pillar-2-identify','pillar-3-guide','pillar-4-qi']
    .map(n => `assets/milestone-icons/${n}.png`),
  // PWA icons are already very small but try anyway
  ...['icon-72x72','icon-96x96','icon-128x128','icon-144x144','icon-152x152',
      'icon-192x192','icon-384x384','icon-512x512']
    .map(n => `icons/${n}.png`),
];

const fmt = n => n > 1024*1024 ? (n/1048576).toFixed(2)+' MB' : (n/1024).toFixed(1)+' KB';

let total = 0, totalNew = 0;
for (const rel of TARGETS) {
  const src = path.join(ROOT, rel);
  try { await fs.access(src); } catch { console.log(`  skip (missing): ${rel}`); continue; }
  const before = (await fs.stat(src)).size;
  const buf = await fs.readFile(src);
  let out;
  if (src.endsWith('.jpg') || src.endsWith('.jpeg')) {
    out = await sharp(buf).jpeg({ quality: 78, mozjpeg: true, progressive: true }).toBuffer();
  } else {
    out = await sharp(buf).png({ compressionLevel: 9, palette: true, quality: 90, effort: 10 }).toBuffer();
  }
  if (out.length < before) {
    await fs.writeFile(src, out);
    console.log(`  ${rel.padEnd(48)} ${fmt(before).padStart(10)} -> ${fmt(out.length).padStart(10)}  (${((1-out.length/before)*100).toFixed(0)}% smaller)`);
    total += before; totalNew += out.length;
  } else {
    console.log(`  ${rel.padEnd(48)} ${fmt(before).padStart(10)}  (already optimal)`);
    total += before; totalNew += before;
  }
}
console.log(`\nTotal: ${fmt(total)} -> ${fmt(totalNew)}  (saved ${fmt(total-totalNew)})`);
