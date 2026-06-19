#!/usr/bin/env node
/**
 * ci/escape-grep.js — the #1 XSS guard (template-literal → HTML sink scan)
 *
 * Catches the single most common injection class in this codebase: a
 * `${...}` interpolation embedded in an HTML string that reaches a sink
 * (`.innerHTML =`, `insertAdjacentHTML(...)`, a `UI.showModal(title, <content>)`
 * body, or a returned HTML string) WITHOUT being routed through one of the
 * blessed escapers:
 *
 *     escapeHtml( · escJsAttr( · requireNumericId( · UI.escapeHtml( · UI.escJsAttr(
 *
 * Heuristic, line-based (no AST dep), scoped to canonical source only
 * (script.js + chunks/*.js — never *.min.js). To keep false positives low we
 * ONLY consider a `${...}` a candidate when its surrounding string literal also
 * contains an HTML tag opener `<` (i.e. it is plausibly HTML, not a log line or
 * a SQL/URL fragment), AND the line/nearby context looks like an HTML sink.
 *
 * ADVISORY by default — exit(0) always so it can never break the existing gate.
 * Pass --strict to exit(1) when (and only when) violations exist.
 *
 * Usage:
 *   node ci/escape-grep.js            # report-mode: prints offenders, exit 0
 *   node ci/escape-grep.js --strict   # exit 1 if any violation found
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT   = path.resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');

// Canonical source files only (never *.min.js, never temp/_ scratch) — mirrors
// the walker in ci/lint-patterns.js and ci/size-budget.js.
function sourceFiles() {
  const out = [];
  if (fs.existsSync(path.join(ROOT, 'script.js'))) out.push('script.js');
  const chunkDir = path.join(ROOT, 'chunks');
  if (fs.existsSync(chunkDir)) {
    for (const f of fs.readdirSync(chunkDir)) {
      if (f.endsWith('.js') && !f.includes('.min')) out.push(path.join('chunks', f));
    }
  }
  return out;
}

// The blessed escapers — any interpolation whose inner expression is wrapped in
// one of these is considered safe and is NOT flagged.
const SAFE = /\b(?:UI\.)?escapeHtml\s*\(|\b(?:UI\.)?escJsAttr\s*\(|\brequireNumericId\s*\(/;

// A line participates in an HTML sink if it assigns to .innerHTML, calls
// insertAdjacentHTML, opens a UI.showModal content body, or returns a string.
const reSink = /\.innerHTML\s*\+?=|insertAdjacentHTML\s*\(|UI\.showModal\s*\(|\breturn\b/;

// Pull out every `${ ... }` (balanced one level) from a line.
function interpolations(line) {
  const out = [];
  let i = 0;
  while ((i = line.indexOf('${', i)) !== -1) {
    let depth = 1, j = i + 2;
    for (; j < line.length && depth > 0; j++) {
      if (line[j] === '{') depth++;
      else if (line[j] === '}') depth--;
    }
    out.push(line.slice(i, j));
    i = j;
  }
  return out;
}

function scan(file) {
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
  const hits = [];
  lines.forEach((raw, idx) => {
    if (/^\s*\*/.test(raw)) return;           // block-comment body
    const line = raw.replace(/\/\/.*$/, '');  // strip trailing line-comment
    if (line.indexOf('${') === -1) return;    // no interpolation at all
    if (line.indexOf('<') === -1) return;     // not plausibly HTML — skip
    if (!reSink.test(line)) return;           // not flowing into an HTML sink

    for (const expr of interpolations(line)) {
      // expr looks like "${ foo.bar }". Strip the ${ } wrapper for the check.
      const inner = expr.slice(2, -1);
      if (SAFE.test(inner)) continue;         // wrapped in a blessed escaper
      if (!/[A-Za-z_$]/.test(inner)) continue;// pure punctuation / empty — ignore
      const snippet = raw.trim().slice(0, 100) + (raw.trim().length > 100 ? '…' : '');
      hits.push({ line: idx + 1, expr: expr.slice(0, 60), snippet });
    }
  });
  return hits;
}

const files = sourceFiles();
let total = 0;
console.log('\nescape-grep  (template-literal → HTML sink, canonical source only)');
for (const f of files) {
  const hits = scan(f);
  if (!hits.length) continue;
  total += hits.length;
  console.log(`\n  ${f}  (${hits.length})`);
  for (const h of hits) {
    console.log(`    ${f}:${h.line}  ${h.expr}`);
    console.log(`        ${h.snippet}`);
  }
}

console.log(`\n  TOTAL unescaped interpolations in HTML sinks: ${total}`);

if (!STRICT) {
  console.log('  (advisory mode — not enforcing; pass --strict to fail on violations)\n');
  process.exit(0);
}
if (total > 0) {
  console.error(`  FAIL  ${total} unescaped interpolation(s) reaching an HTML sink\n`);
  process.exit(1);
}
console.log('  PASS  no unescaped interpolations found\n');
process.exit(0);
