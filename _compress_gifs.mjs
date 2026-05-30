// One-shot GIF compressor for docs/user-guide. Uses gifsicle's lossy mode
// + colormap reduction to cut size 40-70% with imperceptible visual loss.
// Overwrites in place; commit the smaller files.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import gifsicle from 'gifsicle';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIR  = path.join(ROOT, 'docs', 'user-guide');
const BIN  = gifsicle.default || gifsicle;

const fmt = n => n > 1024*1024 ? (n/1048576).toFixed(2)+' MB' : (n/1024).toFixed(1)+' KB';

async function main() {
  const files = (await fs.readdir(DIR)).filter(f => f.toLowerCase().endsWith('.gif'));
  let total = 0, totalNew = 0;
  for (const f of files) {
    const src = path.join(DIR, f);
    const tmp = src + '.tmp';
    const before = (await fs.stat(src)).size;
    await exec(BIN, ['-O3', '--lossy=80', '--colors=128', '-o', tmp, src]);
    const after = (await fs.stat(tmp)).size;
    if (after < before) {
      await fs.rename(tmp, src);
      console.log(`  ${f.padEnd(40)} ${fmt(before).padStart(10)} -> ${fmt(after).padStart(10)}  (${((1-after/before)*100).toFixed(0)}% smaller)`);
      total += before; totalNew += after;
    } else {
      await fs.unlink(tmp);
      console.log(`  ${f.padEnd(40)} ${fmt(before).padStart(10)}  (no improvement, kept original)`);
      total += before; totalNew += before;
    }
  }
  console.log(`\nTotal: ${fmt(total)} -> ${fmt(totalNew)}  (saved ${fmt(total-totalNew)})`);
}
main().catch(e => { console.error(e); process.exit(1); });
