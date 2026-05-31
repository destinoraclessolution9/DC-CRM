// One-shot script: downloads the Google Fonts woff2 files used by the CRM,
// stores them in fonts/, and generates a local @font-face CSS with
// `font-display: optional` (kills CLS from late-arriving fonts).
//
// Run: `node _fetch_fonts.mjs`  — needs network. Idempotent: re-runs are no-ops
// if the same hashed URLs come back, but Google occasionally re-hashes its
// woff2 filenames, in which case the script downloads the new ones and regens
// fonts/local-fonts.css. Commit the resulting fonts/ + local-fonts.css.
//
// Why self-host:
//   - Privacy partitioning (Chrome 86+ / Firefox 85+) killed cross-site Google
//     Fonts cache. Every visitor to every Google-Fonts site pays a fresh DNS +
//     TLS + 2 round-trips to fonts.gstatic.com. Self-hosting from the same
//     origin runs over the already-open HTTP/2 connection — one round-trip.
//   - `font-display: swap` swaps the fallback for the real font when it arrives,
//     causing CLS. `font-display: optional` lets the browser use whichever font
//     is ready at 100ms and never swap — eliminates CLS entirely. The cost is
//     that ~5% of cold loads (slow networks, first visit) see the fallback for
//     this session. The CRM's font-style isn't load-bearing for the UI.

import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.join(ROOT, 'fonts');

// The exact families + weights the CRM uses today. Mirror what's in index.html
// + styles-theme.css. Latin subset only — CRM is bilingual (中文 + English)
// but Chinese characters come from system fonts on every modern OS, and
// shipping all of Inter's Chinese variants would be ~2 MB extra.
const FAMILIES_URL = 'https://fonts.googleapis.com/css2'
    + '?family=Inter:wght@300;400;500;600;700'
    + '&family=Space+Grotesk:wght@500;600;700'
    + '&family=JetBrains+Mono:wght@400;500;600'
    + '&display=optional';   // request the same display we want in local CSS

// Spoof a modern Chrome UA so the CSS endpoint returns woff2 (not woff or ttf).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

async function ensureDir(p) {
    await fs.mkdir(p, { recursive: true });
}

function basenameFromUrl(u) {
    return path.basename(new URL(u).pathname);
}

async function downloadFont(url) {
    const out = path.join(FONTS_DIR, basenameFromUrl(url));
    try {
        await fs.access(out);
        return { url, out, cached: true };
    } catch { /* not cached, fall through */ }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Font fetch failed (${res.status}) for ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(out, buf);
    return { url, out, cached: false, size: buf.length };
}

async function main() {
    await ensureDir(FONTS_DIR);

    console.log('Fetching CSS index…');
    const cssRes = await fetch(FAMILIES_URL, { headers: { 'User-Agent': UA } });
    if (!cssRes.ok) throw new Error(`CSS fetch failed: ${cssRes.status}`);
    const css = await cssRes.text();

    // Extract every src: url(...) from the CSS.
    const urls = Array.from(new Set(
        (css.match(/url\(([^)]+\.woff2)\)/g) || []).map(m => m.slice(4, -1))
    ));
    console.log(`Found ${urls.length} woff2 files to mirror.`);

    const results = [];
    for (const u of urls) {
        const r = await downloadFont(u);
        results.push(r);
        const tag = r.cached ? 'cached' : `${(r.size / 1024).toFixed(1)} KB`;
        console.log(`  ${basenameFromUrl(u).padEnd(40)} ${tag}`);
    }

    // Rewrite the CSS to point at /fonts/<basename>.
    const localCss = css.replace(/url\(([^)]+\.woff2)\)/g, (_m, u) => {
        return `url(/fonts/${basenameFromUrl(u)})`;
    });
    // Force optional display in every @font-face block — defensive in case
    // Google's endpoint ignored our query param for some weight.
    const finalCss = localCss.replace(/font-display:\s*\w+;/g, 'font-display: optional;');

    const out = path.join(FONTS_DIR, 'local-fonts.css');
    await fs.writeFile(out, finalCss);
    console.log(`\nWrote ${out}`);
    console.log(`\nNext step: replace the Google Fonts <link> in index.html with`);
    console.log(`  <link rel="stylesheet" href="/fonts/local-fonts.css">`);
    console.log(`and remove the @import url('https://fonts.googleapis.com/...') from styles-theme.css.`);
}

main().catch((e) => {
    console.error('FAILED:', e.message);
    process.exit(1);
});
