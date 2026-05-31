// Minify production assets in place (foo.js -> foo.min.js, foo.css -> foo.min.css).
// Safe defaults: --keep-names because HTML onclick handlers reference app.fn(id)
// patterns, and runtime code may inspect Function.prototype.name. Property-name
// mangling is disabled (default) so the IIFE's returned `app` object literal keys
// stay intact for inline-event resolution.
import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const JS_TARGETS = [
  'script.js',
  'script-features.js',
  'data.js',
  'app-init.js',
  'ui.js',
  'auth.js',
  'supabase-init.js',
  'two-factor.js',
  'push-notifications.js',
];

const CSS_TARGETS = [
  'styles-fixed.css',
  'styles-mobile.css',
  'styles-mobile-v2.css',
  'styles-theme.css',
];

async function size(p) {
  try { return (await fs.stat(p)).size; } catch { return 0; }
}

function fmt(n) {
  if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB';
  if (n > 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

async function minifyJs(file) {
  const src = path.join(ROOT, file);
  const out = src.replace(/\.js$/, '.min.js');
  await build({
    entryPoints: [src],
    outfile: out,
    minify: true,
    keepNames: true,
    target: ['es2020'],
    legalComments: 'none',
    bundle: false,
    sourcemap: false,
    logLevel: 'warning',
  });
  const a = await size(src), b = await size(out);
  console.log(`  ${file.padEnd(28)} ${fmt(a).padStart(10)} -> ${fmt(b).padStart(10)}  (${((1 - b/a) * 100).toFixed(0)}% smaller)`);
}

async function minifyCss(file) {
  const src = path.join(ROOT, file);
  const out = src.replace(/\.css$/, '.min.css');
  await build({
    entryPoints: [src],
    outfile: out,
    minify: true,
    loader: { '.css': 'css' },
    legalComments: 'none',
    logLevel: 'warning',
  });
  const a = await size(src), b = await size(out);
  console.log(`  ${file.padEnd(28)} ${fmt(a).padStart(10)} -> ${fmt(b).padStart(10)}  (${((1 - b/a) * 100).toFixed(0)}% smaller)`);
}

console.log('Minifying JS...');
for (const f of JS_TARGETS) await minifyJs(f);
console.log('\nMinifying CSS...');
for (const f of CSS_TARGETS) await minifyCss(f);
console.log('\nDone.');
