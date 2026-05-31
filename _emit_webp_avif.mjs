// Emit WebP + AVIF variants alongside existing PNG/JPG assets.
// Originals are PRESERVED so existing <img src> references keep working.
// HTML/CSS can then use <picture> tags with AVIF → WebP → original fallback:
//
//   <picture>
//     <source srcset="bg.avif" type="image/avif">
//     <source srcset="bg.webp" type="image/webp">
//     <img src="bg.jpg" alt="…">
//   </picture>
//
// AVIF is ~15-30% smaller than WebP, ~40-60% smaller than original.
// WebP is ~25-35% smaller than original, supported in every modern browser.
// Browser picks the first format it can decode.
//
// Idempotent: re-running compares against existing .webp/.avif; skips if no win.
import sharp from 'sharp';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// Same TARGETS as _compress_images.mjs — keep both lists in sync.
const TARGETS = [
  'assets/milestone-scroll-bg.jpg',
  ...['icon-1-beidou','icon-2-house','icon-3-ancient','icon-4-hui','icon-5-fu',
      'icon-6-fire','icon-7-wang','icon-8-bagua','icon-9-chuan',
      'pillar-1-stars','pillar-2-identify','pillar-3-guide','pillar-4-qi']
    .map(n => `assets/milestone-icons/${n}.png`),
  // PWA icons skipped — they're already < 3KB and served via manifest.json
  // which doesn't honor <picture>. Keep PNG-only for those.
];

const WEBP_OPTS  = { quality: 78, effort: 6, alphaQuality: 80 };
// AVIF effort 4 balances encode time vs. file size; effort 6+ can take
// minutes per image. Quality 65 is visually indistinguishable from 100
// for most photographic content.
const AVIF_OPTS  = { quality: 65, effort: 4, chromaSubsampling: '4:2:0' };

const fmt = n => n > 1024*1024 ? (n/1048576).toFixed(2)+' MB' : (n/1024).toFixed(1)+' KB';

let origTotal = 0, webpTotal = 0, avifTotal = 0;
let webpEmitted = 0, avifEmitted = 0;

for (const rel of TARGETS) {
  const src = path.join(ROOT, rel);
  try { await fs.access(src); }
  catch { console.log(`  skip (missing): ${rel}`); continue; }

  const before = (await fs.stat(src)).size;
  const buf = await fs.readFile(src);
  const ext = path.extname(src);
  const stem = src.slice(0, -ext.length);

  // WebP
  const webpPath = stem + '.webp';
  const webpBuf = await sharp(buf).webp(WEBP_OPTS).toBuffer();
  if (webpBuf.length < before) {
    await fs.writeFile(webpPath, webpBuf);
    webpEmitted++;
    webpTotal += webpBuf.length;
    console.log(`  ${rel.padEnd(48)} ${fmt(before).padStart(10)} → webp ${fmt(webpBuf.length).padStart(10)} (${((1-webpBuf.length/before)*100).toFixed(0)}% smaller)`);
  } else {
    webpTotal += before;
    console.log(`  ${rel.padEnd(48)} webp (no win, keep original)`);
  }

  // AVIF
  const avifPath = stem + '.avif';
  const avifBuf = await sharp(buf).avif(AVIF_OPTS).toBuffer();
  if (avifBuf.length < before) {
    await fs.writeFile(avifPath, avifBuf);
    avifEmitted++;
    avifTotal += avifBuf.length;
    console.log(`  ${rel.padEnd(48)} ${fmt(before).padStart(10)} → avif ${fmt(avifBuf.length).padStart(10)} (${((1-avifBuf.length/before)*100).toFixed(0)}% smaller)`);
  } else {
    avifTotal += before;
    console.log(`  ${rel.padEnd(48)} avif (no win, keep original)`);
  }

  origTotal += before;
}

console.log(`\nSummary:`);
console.log(`  Originals total: ${fmt(origTotal)}`);
console.log(`  WebP emitted:    ${webpEmitted} files, total ${fmt(webpTotal)}`);
console.log(`  AVIF emitted:    ${avifEmitted} files, total ${fmt(avifTotal)}`);
console.log(`  Savings if all browsers picked AVIF: ${fmt(origTotal - avifTotal)} (${((1-avifTotal/origTotal)*100).toFixed(0)}%)`);
console.log(`  Savings if all browsers picked WebP: ${fmt(origTotal - webpTotal)} (${((1-webpTotal/origTotal)*100).toFixed(0)}%)`);
console.log(`\nNext step: update markup to use <picture> with type="image/avif" and type="image/webp" <source>s + original <img src>.`);
