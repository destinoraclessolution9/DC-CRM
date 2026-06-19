// Minify production assets in place (foo.js -> foo.min.js, foo.css -> foo.min.css).
// Safe defaults: --keep-names because HTML onclick handlers reference app.fn(id)
// patterns, and runtime code may inspect Function.prototype.name. Property-name
// mangling is disabled (default) so the IIFE's returned `app` object literal keys
// stay intact for inline-event resolution.
//
// After minify, emit pre-compressed .br variants (brotli quality 11). Vercel
// detects them and serves with Content-Encoding: br when the client allows it,
// skipping per-request compression entirely. Offline brotli-11 beats runtime
// brotli-5/6 by 15-20% on the big script bundle (~300 KB saved on first load).
import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
const brotliCompress = promisify(zlib.brotliCompress);

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const JS_TARGETS = [
  'script.js',
  'data-helpers.js',
  'data.js',
  'app-init.js',
  'ui.js',
  'auth.js',
  'supabase-init.js',
  'two-factor.js',
  'push-notifications.js',
  // Role-gated lazy chunks — fetched only when user navigates to the view
  // AND their role level matches _CHUNK_VIEWS in script.js. The runtime
  // loader resolves hashed filenames via window.__ASSET_MANIFEST.
  'chunks/script-egg.js',
  'chunks/script-boss-report.js',
  'chunks/script-stock-take.js',
  'chunks/script-knowledge.js',
  // Phase-i role-gated chunks
  'chunks/script-formula.js',
  'chunks/script-marketing.js',
  'chunks/script-reporting.js',
  'chunks/script-cases.js',
  'chunks/script-referrals.js',
  // Phase: Ranking + Workflow + Noticeboard (extracted 2026-06-05)
  'chunks/script-performance.js',
  // Phase 4A: WhatsApp Business Integration (extracted 2026-06-05)
  'chunks/script-whatsapp.js',
  // Phase 4B: AI Analytics (extracted 2026-06-05)
  'chunks/script-ai.js',
  // Phase 4C: Document Management System (extracted 2026-06-05)
  'chunks/script-documents.js',
  // Phase 4D: Notes + Voice Recording + Mobile UI (extracted 2026-06-05)
  'chunks/script-mobile.js',
  // Phase 4E: Google Calendar + Integrations Hub (extracted 2026-06-05)
  'chunks/script-gcal.js',
  // Phase 4F-G: Lead Forms, Surveys, Contracts, Custom Fields, Portal (extracted 2026-06-05)
  'chunks/script-forms.js',
  // Phase 4H: Activity Modal + Appt + Push Notifications + Past Record (extracted 2026-06-05)
  'chunks/script-activities.js',
  // Phase 4I: Full Calendar + Follow-up Automation Engine (extracted 2026-06-05)
  'chunks/script-calendar.js',
  // Phase 4J: Prospect & Customer Management (extracted 2026-06-05)
  'chunks/script-prospects.js',
  // Phase 4J.2: split out of script-prospects.js 2026-06-18
  'chunks/script-customers.js',
  'chunks/script-agents.js',
  'chunks/script-approvals.js',
  'chunks/script-settings.js',
  // Phase 4K: Pipeline & Sales Force Module (extracted 2026-06-05)
  'chunks/script-pipeline.js',
  // Phase 4L: Import System + Follow-up Monitoring (extracted 2026-06-05)
  'chunks/script-import.js',
  // Phase 4M: Scoring + Features bundle (extracted 2026-06-05)
  'chunks/script-features2.js',
  // Phase 4N: 福德 View + Reward CRUD (extracted 2026-06-05)
  'chunks/script-fude.js',
  // Phase 5A: Notifications + Health + Scheduler + CPS (extracted 2026-06-05)
  'chunks/script-cps.js',
  // Phase 5B: Security Dashboard + System Administration (extracted 2026-06-05)
  'chunks/script-admin.js',
  // Phase 5C: Org Chart Consultant (extracted 2026-06-05)
  'chunks/script-org.js',
  // Phase 5D: Advanced Search + Filter Panel (extracted 2026-06-05)
  'chunks/script-search.js',
  // Order Form Extract — standalone scanner page
  'chunks/script-order-form-extract.js',
  // Phase 6A: Journey System — 5-year automated follow-up (2026-06-06)
  'chunks/script-journey.js',
];

const CSS_TARGETS = [
  'styles-fixed.css',
  'styles-mobile.css',
  'styles-login-v2.css',
  'styles-theme.css',
];

// Already-minified vendored/built assets that ship eagerly but aren't in
// JS_TARGETS/CSS_TARGETS — brotli-11 IN PLACE (no re-minify, no hash), each
// existence-guarded so a missing file (e.g. react-dist) never fails the build.
const VENDOR_BR_TARGETS = [
  'react-dist/react-island.js',           // ~567 KB — built by `vite build`, may be absent
  'lunar-calendar.min.js',                // ~15 KB vendored, root
  'libs/supabase-js-2.106.2.min.js',      // ~200 KB vendored
  'libs/fontawesome/css/all.min.css',     // ~74 KB vendored (optional)
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

// Pre-compress a single file to .br alongside it. Quality 11 is the max —
// only worth it because this runs once at build time, not per request.
async function brotliFile(file) {
  const buf = await fs.readFile(file);
  const out = await brotliCompress(buf, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
    },
  });
  await fs.writeFile(file + '.br', out);
  const a = buf.length, b = out.length;
  console.log(`  ${path.basename(file).padEnd(28)} ${fmt(a).padStart(10)} -> ${fmt(b).padStart(10)}  (${((1 - b/a) * 100).toFixed(0)}% smaller)`);
}

async function compressAll() {
  for (const f of JS_TARGETS) {
    const min = path.join(ROOT, f.replace(/\.js$/, '.min.js'));
    if (await size(min)) await brotliFile(min);
  }
  for (const f of CSS_TARGETS) {
    const min = path.join(ROOT, f.replace(/\.css$/, '.min.css'));
    if (await size(min)) await brotliFile(min);
  }
  // Pre-compress already-minified vendored / externally-built assets in place.
  // Brotli-only: no re-minify, no content-hashing. Skip any that don't exist
  // (e.g. react-dist when vite wasn't run) so the build never fails.
  for (const f of VENDOR_BR_TARGETS) {
    const abs = path.join(ROOT, f);
    if (await size(abs)) await brotliFile(abs);
  }
}

// ── Content-hashed filenames ────────────────────────────────────────────
// After minify, compute a content hash for each .min.js / .min.css and write
// a hashed COPY alongside (script.abc12345.min.js). Emit a manifest mapping
// the canonical name -> hashed name. Then rewrite index.html so it loads the
// hashed names directly — perfect CDN immutability, no ?v= drift bug.
//
// Both names stay on disk: the non-hashed file is still served for any
// cached HTML referencing the old ?v= pattern (deploy-window compatibility).
// On the next build with no source change, the hashed name is identical and
// the manifest doesn't move.
//
// Hash: SHA-256 truncated to 10 hex chars — collision-safe for our ~13 assets.
async function hashFile(p) {
  const buf = await fs.readFile(p);
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
}

async function hashAll() {
  const manifest = {};
  const allMinified = [
    ...JS_TARGETS.map(f => f.replace(/\.js$/, '.min.js')),
    ...CSS_TARGETS.map(f => f.replace(/\.css$/, '.min.css')),
  ];
  for (const f of allMinified) {
    const src = path.join(ROOT, f);
    if (!(await size(src))) continue;
    const hash = await hashFile(src);
    const hashed = f.replace(/\.min\.(js|css)$/, `.${hash}.min.$1`);
    const dest = path.join(ROOT, hashed);
    await fs.copyFile(src, dest);
    // Pre-compress the hashed copy too so Vercel serves .br when allowed.
    await brotliFile(dest);
    manifest[f] = hashed;
    console.log(`  ${f.padEnd(28)} -> ${hashed}`);
  }
  // The dynamic loader in script.js loads script-features.min.js at runtime;
  // index.html doesn't see that string, so we also expose the manifest as a
  // global window.__ASSET_MANIFEST for script.js to look up by canonical name.
  await fs.writeFile(
    path.join(ROOT, 'dist-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );
  return manifest;
}

// Rewrite index.html:
//  1. Replace every `foo.min.<ext>?v=<anything>` with the hashed name.
//  2. Inject window.__ASSET_MANIFEST so the script-features dynamic loader
//     can resolve the hashed filename at runtime without a ?v= query string.
//     The manifest is ~400 bytes; injecting it inline saves a round-trip.
async function rewriteHtml(manifest) {
  const htmlPath = path.join(ROOT, 'index.html');
  let html = await fs.readFile(htmlPath, 'utf8');
  for (const [canonical, hashed] of Object.entries(manifest)) {
    const m = canonical.match(/^(.+?)\.min\.(js|css)$/);
    if (!m) continue;
    const base = m[1];
    const ext = m[2];
    const baseEsc = base.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${baseEsc}(?:\\.[a-f0-9]{8,12})?\\.min\\.${ext}(?:\\?v=[\\w]+)?`, 'g');
    html = html.replace(re, hashed);
  }
  // Inject / replace asset manifest inline script immediately before </head>.
  // The script-features dynamic loader uses window.__ASSET_MANIFEST['script-features.min.js']
  // to get the hashed name — eliminates the last remaining ?v= fallback.
  //
  // The same inline script also seeds the env-gated observability globals read
  // by obs-init.js: window.__SENTRY_DSN (empty string ⇒ Sentry stays a no-op)
  // and window.__APP_RELEASE (the deploy commit SHA, for release tagging).
  // Both are JSON.stringify'd so an empty value renders as a valid `""` literal.
  const sentryDsn = process.env.SENTRY_DSN || '';
  const appRelease = process.env.VERCEL_GIT_COMMIT_SHA || '';
  // Safe-inline-JSON: JSON.stringify escapes quotes but NOT a literal `</script>`
  // or bare `<`. An HTML parser terminates the inline script at the first
  // `</script>` inside the string, which would truncate this block and corrupt
  // window.__ASSET_MANIFEST + the obs-init globals. Escape `<` to `<` (and
  // `>` for symmetry against `]]>` / `-->` cases) — fully equivalent for valid JS.
  const safeJson = (x) => JSON.stringify(x).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const manifestScript = `<script>window.__ASSET_MANIFEST=${safeJson(manifest)};window.__SENTRY_DSN=${safeJson(sentryDsn)};window.__APP_RELEASE=${safeJson(appRelease)};</script>`;
  // Replace existing manifest injection if present, or insert before </head>.
  // The regex spans the whole injected block (manifest + observability globals)
  // so re-runs stay idempotent regardless of which globals were present before.
  if (html.includes('window.__ASSET_MANIFEST=')) {
    html = html.replace(/<script>window\.__ASSET_MANIFEST=[^<]*?<\/script>/, manifestScript);
  } else {
    html = html.replace('</head>', `${manifestScript}\n</head>`);
  }
  await fs.writeFile(htmlPath, html);
  console.log('  index.html rewritten to reference hashed assets + manifest injected.');
}

console.log('Minifying JS...');
for (const f of JS_TARGETS) await minifyJs(f);
console.log('\nMinifying CSS...');
for (const f of CSS_TARGETS) await minifyCss(f);
console.log('\nPre-compressing .br (brotli-11)...');
await compressAll();
console.log('\nContent-hashing assets...');
const manifest = await hashAll();
console.log('\nRewriting index.html...');
await rewriteHtml(manifest);
console.log('\nDone.');
