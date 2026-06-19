#!/usr/bin/env node
/**
 * ci/a11y-grep.js — accessibility lint for the React island sources
 *
 * A grep-grade (no-AST, regex + small windowed-scan) accessibility guard scoped
 * to the React migration sources only (src/react/**.jsx + .js). It catches the
 * three a11y regressions that keep sneaking back into hand-written JSX:
 *
 *   A1  icon-only button with NO accessible name — a <button> whose only child
 *       is an <i …/> (or a Font Awesome glyph) and that carries neither
 *       aria-label nor aria-labelledby. Such a control is announced as just
 *       "button" by a screen reader.
 *   A2  ARIA role missing its required companion attribute —
 *         role="dialog"   without aria-modal / aria-label / aria-labelledby
 *         role="tab"      without aria-selected
 *         role="combobox" without aria-expanded
 *       (companions are looked for across the element's whole attribute block,
 *       not just the role= line, since JSX spreads attrs over many lines.)
 *   A3  inline status color using a raw hex on `color:` — e.g.
 *       color: '#dc2626' — instead of a semantic var(--*-text) token.
 *
 * This is a sibling of ci/lint-patterns.js (same CommonJS shape, same node
 * built-ins only, same grouped report + TOTAL). It is ADVISORY: it always
 * exits 0 so it can never break the existing ci/regression.js gate — UNLESS
 * invoked with --strict AND at least one violation exists, in which case it
 * exits 1 so it can be opted into a stricter check deliberately.
 *
 * Usage:
 *   node ci/a11y-grep.js            # report-mode: prints findings, exit 0
 *   node ci/a11y-grep.js --strict   # exit 1 if any violations exist
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT   = path.resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');
const SCAN_DIR = path.join(ROOT, 'src', 'react');

// Recursively collect .jsx/.js sources under src/react, skipping node_modules.
function sourceFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(jsx|js)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const snippet = (s) => {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > 110 ? t.slice(0, 107) + '…' : t;
};
const isCommentLine = (raw) => /^\s*(\*|\/\/|\/\*|\{\/\*)/.test(raw);

// --- A1: icon-only <button> without aria-label/aria-labelledby --------------
// Match a self-contained <button …>…</button> on one line whose inner content
// is exactly one icon (an <i …/> or <i …></i>) and nothing else textual.
const reButtonInline = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
const reHasAriaLabel = /\baria-label(?:ledby)?\s*=/;
// Inner content that is "only an icon": one <i …> tag and no other visible text.
function isIconOnly(inner) {
  // Strip JSX comments and whitespace-only expressions.
  const stripped = inner
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\{['"`]\s*['"`]\}/g, '')
    .trim();
  const icons = stripped.match(/<i\b[^>]*\/?>(?:<\/i>)?/g);
  if (!icons || icons.length === 0) return false;
  // Remove the icon tag(s); whatever remains must have no letters/digits
  // (i.e. no visible text label, no {someTextVar}).
  const rest = stripped.replace(/<i\b[^>]*\/?>(?:<\/i>)?/g, '').trim();
  if (/[A-Za-z0-9]/.test(rest)) return false; // there is a text label → fine
  return true;
}

// --- A2: ARIA role missing a required companion ------------------------------
const ROLE_COMPANIONS = {
  dialog:   { needsAny: ['aria-modal', 'aria-label', 'aria-labelledby'], label: 'aria-modal/aria-label/aria-labelledby' },
  tab:      { needsAny: ['aria-selected'], label: 'aria-selected' },
  combobox: { needsAny: ['aria-expanded'], label: 'aria-expanded' },
};
// Require the role to be a genuine JSX attribute: preceded by whitespace and
// NOT embedded in a CSS-selector string like '[role="tab"]' (preceded by `[`)
// — those are passed to roving-tabindex helpers, not real ARIA roles.
const reRoleAttr = /(^|\s)role\s*=\s*["'](dialog|tab|combobox)["']/;
const reRoleInSelector = /\[\s*role\s*=/;

// Collect the element's attribute block: from the role= line forward until the
// opening tag is closed (a line whose remainder contains an unquoted > or />).
// This lets companions on later lines (the common JSX style) count.
function attrBlock(lines, startIdx) {
  const buf = [];
  for (let i = startIdx; i < lines.length && i < startIdx + 40; i++) {
    buf.push(lines[i]);
    // crude tag-close detector: a line ending the open tag
    if (/\/?>\s*$/.test(lines[i]) || /\/?>[^<]*$/.test(lines[i])) break;
  }
  return buf.join('\n');
}

// --- A3: raw hex on a `color:` (not a var(--*-text) token) -------------------
// Matches  color: '#dc2626'  / color:"#fff" / color: `#abc` inside inline style.
const reColorHex = /\bcolor\s*:\s*["'`]#[0-9a-fA-F]{3,8}["'`]/g;

const findings = { a1: [], a2: [], a3: [] };

for (const file of sourceFiles(SCAN_DIR)) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const r = rel(file);

  // A1 — scan whole-file text so multi-attr single-line buttons are caught,
  // then map the match offset back to a line number for the report.
  let m;
  reButtonInline.lastIndex = 0;
  while ((m = reButtonInline.exec(src)) !== null) {
    const attrs = m[1];
    const inner = m[2];
    if (reHasAriaLabel.test(attrs)) continue;          // labelled → ok
    if (!isIconOnly(inner)) continue;                  // has text/child → ok
    const lineNo = src.slice(0, m.index).split('\n').length;
    findings.a1.push({ file: r, line: lineNo, snippet: snippet(m[0]) });
  }

  // A2 + A3 — line-oriented.
  lines.forEach((raw, i) => {
    if (isCommentLine(raw)) return;

    const roleMatch = raw.match(reRoleAttr);
    if (roleMatch && !reRoleInSelector.test(raw)) {
      const role = roleMatch[2];
      const spec = ROLE_COMPANIONS[role];
      const block = attrBlock(lines, i);
      const ok = spec.needsAny.some((attr) => new RegExp('\\b' + attr + '\\s*=').test(block));
      if (!ok) {
        findings.a2.push({
          file: r, line: i + 1, role,
          missing: spec.label,
          snippet: snippet(raw),
        });
      }
    }

    reColorHex.lastIndex = 0;
    if (reColorHex.test(raw)) {
      findings.a3.push({ file: r, line: i + 1, snippet: snippet(raw) });
    }
  });
}

const A1 = findings.a1.length;
const A2 = findings.a2.length;
const A3 = findings.a3.length;
const total = A1 + A2 + A3;

function printGroup(title, rows, fmt) {
  console.log(`\n  ${title}: ${rows.length}`);
  const SHOW = 12;
  rows.slice(0, SHOW).forEach((row) => console.log('       ' + fmt(row)));
  if (rows.length > SHOW) console.log(`       … and ${rows.length - SHOW} more`);
}

console.log('\na11y-grep  (src/react/**.jsx, **.js)');
printGroup('A1 icon-only button w/o aria-label', findings.a1,
  (x) => `${x.file}:${x.line}  ${x.snippet}`);
printGroup('A2 role missing companion attr', findings.a2,
  (x) => `${x.file}:${x.line}  role="${x.role}" needs ${x.missing} — ${x.snippet}`);
printGroup('A3 raw hex on color: (use var(--*-text))', findings.a3,
  (x) => `${x.file}:${x.line}  ${x.snippet}`);
console.log(`\n  TOTAL: ${total}`);

if (STRICT && total > 0) {
  console.error(`  FAIL  ${total} a11y violation(s) (--strict)\n`);
  process.exit(1);
}
console.log(STRICT ? '  PASS  no a11y violations\n' : '  (advisory — exit 0; run with --strict to enforce)\n');
process.exit(0);
