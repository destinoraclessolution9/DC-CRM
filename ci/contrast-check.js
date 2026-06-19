#!/usr/bin/env node
/**
 * ci/contrast-check.js — WCAG contrast guard for the design-token system
 *
 * Parses styles-theme.css and, for every FOREGROUND (text / icon / glyph)
 * token, computes the WCAG 2.x contrast ratio against the surface it is
 * actually rendered on, then reports whether it clears AA body-text
 * (>= 4.5:1). This locks in the *-text status tokens that were hand-tuned
 * for AA in the theme header — a future palette tweak that drops one of them
 * below 4.5:1 shows up here instead of in a screen-reader-less production UI.
 *
 *   --text-primary / -secondary / -muted   vs the surface (and the app bg in
 *                                           light) they sit on
 *   --danger-text / -warning-text /         the AA-compliant status FOREGROUND
 *   --success-text / -info-text             variants
 *   --accent                                brand text / link color
 *
 * Surfaces:
 *   light  →  --bg-surface (#FFFFFF) and --bg-app (#FDF5F9)
 *   dark   →  --bg-surface (its dark card)
 *
 * The raw --danger / --warning / --success / --info are FILL tokens (tuned
 * for backgrounds & borders, several fail AA as text) — they are listed but
 * labelled 'fill — use *-text for text', not graded.
 *
 * Modes:
 *   node ci/contrast-check.js            # report-mode: prints table, exit 0
 *   node ci/contrast-check.js --strict   # fail (exit 1) if any *-text token < 4.5
 *
 * ADVISORY by default: exit(0) always, so this never breaks the existing
 * `node ci/regression.js` gate. Only --strict + a real violation exits 1.
 *
 * Pure node built-ins (fs, path). The WCAG relative-luminance + contrast
 * formula is implemented inline; only #rrggbb hex is parsed and one level of
 * var() aliasing is resolved (e.g. --accent: var(--maroon)).
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');
const CSS_PATH = path.join(ROOT, 'styles-theme.css');

// ── CSS token parsing ─────────────────────────────────────────────────────
// Pull the body of the first matching `<selector> { … }` block (non-nested —
// the :root / [data-theme] token blocks are flat lists of `--x: …;`).
function blockBody(css, selectorRe) {
  const m = css.match(selectorRe);
  if (!m) return '';
  const start = css.indexOf('{', m.index);
  if (start === -1) return '';
  const end = css.indexOf('}', start);
  if (end === -1) return '';
  return css.slice(start + 1, end);
}

// Parse `--name: value;` declarations out of a block body into a flat map.
function parseTokens(body) {
  const tokens = {};
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    tokens[m[1].trim()] = m[2].trim();
  }
  return tokens;
}

// Resolve one level of `var(--alias)` against the same token map, then again
// (covers e.g. --accent → var(--maroon) → #E84393). Returns a #rrggbb hex or
// null if the value isn't a flat hex color we can grade.
function resolveHex(value, tokens) {
  let v = value;
  for (let depth = 0; depth < 3; depth++) {
    const varMatch = v.match(/^var\(\s*(--[\w-]+)\s*\)$/);
    if (!varMatch) break;
    const next = tokens[varMatch[1]];
    if (next === undefined) return null;
    v = next.trim();
  }
  const hex = v.match(/^#([0-9a-fA-F]{6})$/);
  if (hex) return '#' + hex[1].toUpperCase();
  const short = v.match(/^#([0-9a-fA-F]{3})$/);
  if (short) {
    const s = short[1];
    return ('#' + s[0] + s[0] + s[1] + s[1] + s[2] + s[2]).toUpperCase();
  }
  return null; // rgba(), gradient, etc. — not a gradeable flat color
}

// ── WCAG 2.x relative luminance + contrast ratio ──────────────────────────
function channelLinear(c8) {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relLuminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channelLinear(r) + 0.7152 * channelLinear(g) + 0.0722 * channelLinear(b);
}

function contrastRatio(fgHex, bgHex) {
  const l1 = relLuminance(fgHex);
  const l2 = relLuminance(bgHex);
  const lighter = Math.max(l1, l2);
  const darker  = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ── Build the theme token maps ────────────────────────────────────────────
const css = fs.readFileSync(CSS_PATH, 'utf8');

// Light tokens live in the `:root, [data-theme="light"] {` block; dark in the
// `[data-theme="dark"] {` block. Match each block's opening selector.
const lightTokens = parseTokens(blockBody(css, /:root\s*,\s*\n?\s*\[data-theme="light"\]\s*\{/));
const darkTokens  = parseTokens(blockBody(css, /\[data-theme="dark"\]\s*\{/));

if (Object.keys(lightTokens).length === 0) {
  console.warn('  WARN  could not parse :root/[data-theme="light"] tokens from styles-theme.css');
  process.exit(0);
}

// FOREGROUND tokens to grade, in report order.
const FG_TOKENS = [
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  '--danger-text',
  '--warning-text',
  '--success-text',
  '--info-text',
  '--accent',
];

// Raw FILL tokens — listed for context, never graded as text.
const FILL_TOKENS = ['--danger', '--warning', '--success', '--info'];

// Which *-text tokens count toward the --strict gate.
const TEXT_GATED = new Set(['--danger-text', '--warning-text', '--success-text', '--info-text']);

const AA = 4.5;

// One graded row.
function grade(token, theme, fgHex, surfaceLabel, surfaceHex) {
  const ratio = contrastRatio(fgHex, surfaceHex);
  const pass = ratio >= AA;
  return { token, theme, surfaceLabel, ratio, pass };
}

const rows = [];
let textPassCount = 0;
let textTotal = 0;
let violations = 0;

// LIGHT: grade against --bg-surface (#FFFFFF) AND --bg-app.
const lightSurfaces = [
  ['surface', resolveHex(lightTokens['--bg-surface'] || '#FFFFFF', lightTokens) || '#FFFFFF'],
  ['bg-app',  resolveHex(lightTokens['--bg-app']     || '#FDF5F9', lightTokens) || '#FDF5F9'],
];
// DARK: grade against its --bg-surface.
const darkSurfaces = [
  ['surface', resolveHex(darkTokens['--bg-surface'] || '#1E1115', darkTokens) || '#1E1115'],
];

function gradeTheme(themeName, tokens, surfaces) {
  for (const token of FG_TOKENS) {
    const raw = tokens[token];
    if (raw === undefined) continue;
    const fgHex = resolveHex(raw, tokens);
    if (!fgHex) { rows.push({ token, theme: themeName, surfaceLabel: '—', ratio: null, pass: null, note: 'non-hex (skipped)' }); continue; }
    for (const [label, surfaceHex] of surfaces) {
      const row = grade(token, themeName, fgHex, label, surfaceHex);
      rows.push(row);
      if (TEXT_GATED.has(token)) {
        textTotal++;
        if (row.pass) textPassCount++; else violations++;
      }
    }
  }
}

gradeTheme('light', lightTokens, lightSurfaces);
gradeTheme('dark', darkTokens, darkSurfaces);

// FILL token rows (labelled, not graded).
const fillRows = [];
for (const [themeName, tokens] of [['light', lightTokens], ['dark', darkTokens]]) {
  for (const token of FILL_TOKENS) {
    const raw = tokens[token];
    if (raw === undefined) continue;
    const fgHex = resolveHex(raw, tokens);
    fillRows.push({ token, theme: themeName, hex: fgHex || raw });
  }
}

// ── Report ────────────────────────────────────────────────────────────────
console.log('\ncontrast-check  (WCAG 2.x — styles-theme.css token system)');
console.log('  ' + pad('token', 18) + pad('theme', 7) + pad('surface', 10) + pad('ratio', 9) + 'AA-text (>=4.5)');
console.log('  ' + '-'.repeat(60));

function pad(s, n) { s = String(s); return s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length); }

for (const r of rows) {
  if (r.ratio === null) {
    console.log('  ' + pad(r.token, 18) + pad(r.theme, 7) + pad(r.surfaceLabel, 10) + pad('—', 9) + (r.note || '—'));
    continue;
  }
  const ratioStr = r.ratio.toFixed(2) + ':1';
  const verdict = r.pass ? 'PASS' : 'FAIL';
  console.log('  ' + pad(r.token, 18) + pad(r.theme, 7) + pad(r.surfaceLabel, 10) + pad(ratioStr, 9) + verdict);
}

console.log('  ' + '-'.repeat(60));
for (const fr of fillRows) {
  console.log('  ' + pad(fr.token, 18) + pad(fr.theme, 7) + pad(fr.hex, 19) + 'fill — use *-text for text');
}

console.log('');
console.log(`  *-text tokens passing AA: ${textPassCount}/${textTotal}`);
if (violations) {
  console.log(`  *-text tokens FAILING AA: ${violations}`);
  for (const r of rows) {
    if (r.pass === false && TEXT_GATED.has(r.token)) {
      console.log(`       ${r.token} (${r.theme} on ${r.surfaceLabel}): ${r.ratio.toFixed(2)}:1`);
    }
  }
}

if (!STRICT) {
  console.log('  (advisory — not enforcing; run with --strict to fail on AA violations)\n');
  process.exit(0);
}

if (violations > 0) {
  console.error(`  FAIL  ${violations} *-text token(s) below WCAG AA 4.5:1\n`);
  process.exit(1);
}
console.log(`  PASS  all ${textTotal} *-text tokens clear WCAG AA 4.5:1\n`);
process.exit(0);
