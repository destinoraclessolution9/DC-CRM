#!/usr/bin/env node
/**
 * ci/test-no-getall-render.js — full-table-on-render perf-regression guard
 *
 * High-volume tables (activities, purchases, prospects, customers) grow without
 * bound on a live tenant. Loading one WHOLE table via an unbounded
 * `getAll('<table>')` from inside a render / refresh hot path means every nav,
 * redraw or list-refresh re-pulls the entire table — the exact O(table) regression
 * that keeps creeping back (see the prospects render → getVisibleProspects fix and
 * the reporting date-windowed-KPI work in MEMORY.md).
 *
 * This guard FLAGS every `getAll('activities'|'purchases'|'prospects'|'customers')`
 * that sits within ~40 lines AFTER a render/refresh function signature, i.e. inside
 * the function body of a hot-path renderer. Render/refresh functions are detected by
 * name: render*, refresh*, navigateTo, draw*, paint*, and update*View.
 *
 * It is BASELINE / regression-style (a sibling of ci/lint-patterns.js and the
 * grep guards): the current tree already contains BASELINE such call sites — those
 * are grandfathered. The guard only FAILS (exit 1) when the live count EXCEEDS the
 * baseline, i.e. a NEW unbounded full-table read was introduced on a render path.
 * To bring it green you either route the new read through a bounded/scoped reader
 * (getVisibleProspects, getActivitiesForProspect, queryAdvanced, a date-windowed
 * KPI RPC, …) or — if a new call is genuinely unavoidable — ratchet BASELINE up by
 * exactly that many with a note. Ratchet it DOWN as hot-path reads are removed.
 *
 * Heuristic, line-based (no AST dep), scoped to canonical source ONLY
 * (script.js + chunks/script-*.js — NEVER *.min.js / *.br / hashed bundles).
 * Mirrors the source walker in ci/lint-patterns.js and ci/escape-grep.js.
 *
 * Usage:
 *   node ci/test-no-getall-render.js          # enforce: exit 1 if count > BASELINE
 *   node ci/test-no-getall-render.js --report # always exit 0, just print the table
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT   = path.resolve(__dirname, '..');
const REPORT = process.argv.includes('--report');

// Baseline captured from the current tree (2026-06-20) by running this exact
// scan. This many hot-table getAll() calls already live inside a render/refresh
// window and are grandfathered; the guard fails only when the live count
// EXCEEDS this (i.e. a NEW one was introduced). Tightened to the precise live
// count so there is zero slack — the next new addition trips it.
const BASELINE = 60;

// Lines of body to consider "inside" a render/refresh function after its
// signature. Matches the windowed-scan size used by ci/a11y-grep.js (attrBlock).
const WINDOW = 40;

// The high-volume tables we never want whole-loaded on a render/refresh path.
const HOT_TABLES = ['activities', 'purchases', 'prospects', 'customers'];

// Canonical source files only (never *.min.js, never *.br, never temp/_ scratch) —
// mirrors the walker in ci/lint-patterns.js and ci/escape-grep.js.
function sourceFiles() {
  const out = [];
  if (fs.existsSync(path.join(ROOT, 'script.js'))) out.push('script.js');
  const chunkDir = path.join(ROOT, 'chunks');
  if (fs.existsSync(chunkDir)) {
    for (const f of fs.readdirSync(chunkDir)) {
      // canonical chunk sources are chunks/script-<name>.js — the build outputs
      // (chunks/script-<name>.<hash>.min.js / .br) are explicitly excluded.
      if (f.startsWith('script-') && f.endsWith('.js') && !f.includes('.min')) {
        out.push(path.join('chunks', f));
      }
    }
  }
  return out;
}

// An unbounded getAll on one of the hot tables: getAll('activities'…),
// AppDataStore.getAll("purchases"…), this.getAll('prospects'…), etc.
const reGetAllHot = new RegExp(
  "getAll\\(\\s*['\"](?:" + HOT_TABLES.join('|') + ")['\"]"
);

// A render/refresh function SIGNATURE line. Catches both declaration forms used
// in this codebase:
//   function renderFoo(            renderFoo = (             renderFoo: async (
//   const refreshBar = async (     navigateTo(               updateXView = (
// Name classes: render*, refresh*, navigateTo, draw*, paint*, update*View.
const reRenderFn = new RegExp(
  '\\b(?:function\\s+)?(' +
    'render[A-Za-z0-9_]*' +
    '|refresh[A-Za-z0-9_]*' +
    '|navigateTo' +
    '|draw[A-Za-z0-9_]*' +
    '|paint[A-Za-z0-9_]*' +
    '|update[A-Za-z0-9_]*View' +
  ')\\b\\s*(?:[:=]\\s*(?:async\\s*)?(?:function\\b)?\\s*)?\\('
);

const isCommentLine = (raw) => /^\s*(?:\*|\/\/|\/\*)/.test(raw);
const snippet = (s) => {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > 100 ? t.slice(0, 97) + '…' : t;
};

function scan(file) {
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');

  // Pass 1: collect the line indices of every render/refresh signature.
  const fnStarts = [];
  lines.forEach((raw, i) => {
    if (isCommentLine(raw)) return;
    const line = raw.replace(/\/\/.*$/, '');
    if (reRenderFn.test(line)) fnStarts.push(i);
  });

  // Pass 2: a hot-table getAll counts as a hit when it falls inside the
  // [start, start+WINDOW] body window of any render/refresh signature.
  const hits = [];
  lines.forEach((raw, i) => {
    if (isCommentLine(raw)) return;
    const line = raw.replace(/\/\/.*$/, '');
    if (!reGetAllHot.test(line)) return;
    const owner = fnStarts.filter((s) => i >= s && i <= s + WINDOW).pop();
    if (owner === undefined) return;
    hits.push({ line: i + 1, fnLine: owner + 1, snippet: snippet(raw) });
  });
  return hits;
}

const files = sourceFiles();
let total = 0;
const perFile = [];
for (const f of files) {
  const hits = scan(f);
  if (!hits.length) continue;
  total += hits.length;
  perFile.push({ file: f, hits });
}

console.log('\ntest-no-getall-render  (full-table getAll on a render/refresh path, canonical source only)');
for (const { file, hits } of perFile) {
  console.log(`\n  ${file}  (${hits.length})`);
  const SHOW = 8;
  hits.slice(0, SHOW).forEach((h) =>
    console.log(`    ${file}:${h.line}  (render fn @${h.fnLine})  ${h.snippet}`)
  );
  if (hits.length > SHOW) console.log(`    … and ${hits.length - SHOW} more`);
}
console.log(`\n  TOTAL hot-table getAll() on render/refresh paths: ${total}  (baseline ${BASELINE})`);

if (REPORT) {
  console.log('  (report mode — exit 0; omit --report to enforce against baseline)\n');
  process.exit(0);
}

if (total > BASELINE) {
  console.error(
    `  FAIL  ${total} > baseline ${BASELINE}: ${total - BASELINE} NEW unbounded ` +
    `getAll('${HOT_TABLES.join("'|'")}') introduced on a render/refresh hot path.\n` +
    '        Route it through a bounded/scoped reader (getVisibleProspects,\n' +
    '        getActivitiesForProspect, queryAdvanced, a date-windowed RPC, …),\n' +
    '        or ratchet BASELINE in this file if the read is truly unavoidable.\n'
  );
  process.exit(1);
}
console.log(`  PASS  ${total} <= baseline ${BASELINE} — no new full-table render-path reads\n`);
process.exit(0);
