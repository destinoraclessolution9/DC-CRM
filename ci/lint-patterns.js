#!/usr/bin/env node
/**
 * ci/lint-patterns.js — anti-duplication pattern guard
 *
 * Mechanically prevents the duplication classes the Wave-1 refactor removes
 * from creeping back in. Three rules, all regex-based (no AST dep), scoped to
 * canonical (non-minified) source only:
 *
 *   R1  inline role-level parsing   — use _getUserLevel(user) / role predicates,
 *                                     never a raw  role.match(/Level/)  or
 *                                     parseInt(...role...) at a call site.
 *   R2  local escapeHtml redefinition — use the shared window._crmUtils.escapeHtml
 *                                     (or a one-line alias to it), never a fresh
 *                                     hand-rolled implementation.
 *   R3  getAll() inside a loop/map/filter body — N+1 / full-table-per-row smell.
 *
 * Modes:
 *   node ci/lint-patterns.js            # report-mode: prints counts, exit 0
 *   node ci/lint-patterns.js --enforce  # fail (exit 1) if total > allowance
 *
 * Allowance lives in ci/lint-allowance.json (the canonical definitions that are
 * SUPPOSED to exist, e.g. the single _getUserLevel and the single escapeHtml).
 * Ratchet it DOWN as Wave 1 lands; never up.
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENFORCE = process.argv.includes('--enforce');
const ALLOWANCE_PATH = path.join(__dirname, 'lint-allowance.json');

// Canonical source files only (never *.min.js, never temp/_ scratch).
function sourceFiles() {
  const out = [];
  for (const f of ['script.js', 'data-helpers.js', 'data.js', 'ui.js', 'app-init.js', 'auth.js', 'supabase-init.js']) {
    if (fs.existsSync(path.join(ROOT, f))) out.push(f);
  }
  const chunkDir = path.join(ROOT, 'chunks');
  if (fs.existsSync(chunkDir)) {
    for (const f of fs.readdirSync(chunkDir)) {
      if (f.endsWith('.js') && !f.includes('.min')) out.push(path.join('chunks', f));
    }
  }
  return out;
}

// R1: a raw "Level N" extraction at a USE site. The single canonical definition
// is _getUserLevel in script.js — that one line is allowed; everything else is a
// duplicate parse. We flag `.match(/Level\s*\\d/)` and `parseInt(... role ...)`.
const reRole = /\.match\(\s*\/.*Level\\?s?\\?\*?\s*\\?d|parseInt\([^)]*\.role\b|\.role[^=\n]*\.match\(/i;
// R2: a hand-rolled HTML escaper — a local def of esc/escapeHtml/escapeHTML
// whose body actually does the escaping (contains &amp; or replace(/&/)). A
// one-line alias to the shared helper (… => _utils.escapeHtml(…)) has no such
// body and is NOT a violation.
const reEscDef  = /(?:function\s+(?:esc|escapeHt?ml)\b|(?:const|let|var)\s+(?:esc|escapeHt?ml)\s*=)/;
const reEscBody = /&amp;|replace\(\s*\/&\//; // the tell-tale escaping body
const reEscAlias = /(?:esc|escapeHt?ml)\s*=\s*\([^)]*\)\s*=>\s*[_A-Za-z.]*\.escapeHt?ml\(/;
// R3: getAll( appearing on a line that is clearly inside an iteration callback.
const reGetAllLoop = /\.(?:map|filter|forEach|reduce|some|every)\([^)]*\bgetAll\(/;

function classify(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const lines = src.split('\n');
  let r1 = 0, r2 = 0, r3 = 0;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, '');
    if (/^\s*\*/.test(raw)) return; // block-comment body
    // R1 — but exempt the single canonical definition line in script.js
    const isCanonicalRoleDef = file === 'script.js' && /_getUserLevel\s*=/.test(raw);
    if (!isCanonicalRoleDef && reRole.test(line)) r1++;
    // R2 — a hand-rolled escaper (def + escaping body), not an alias, and not
    // the two canonical homes (ui.js, script.js's _crmUtils registration).
    if (reEscDef.test(line) && reEscBody.test(line) && !reEscAlias.test(line)) {
      const canonicalHome = (file === 'ui.js') || (file === 'script.js');
      if (!canonicalHome) r2++;
    }
    if (reGetAllLoop.test(line)) r3++;
  });
  return { r1, r2, r3 };
}

const files = sourceFiles();
let R1 = 0, R2 = 0, R3 = 0;
const offenders = { r1: [], r2: [], r3: [] };
for (const f of files) {
  const c = classify(f);
  if (c.r1) { R1 += c.r1; offenders.r1.push(`${f} (${c.r1})`); }
  if (c.r2) { R2 += c.r2; offenders.r2.push(`${f} (${c.r2})`); }
  if (c.r3) { R3 += c.r3; offenders.r3.push(`${f} (${c.r3})`); }
}

const total = R1 + R2 + R3;
console.log('\nlint-patterns  (canonical source only)');
console.log(`  R1 inline role parsing      : ${R1}`);
if (offenders.r1.length) console.log('       ' + offenders.r1.join(', '));
console.log(`  R2 escapeHtml redefinitions : ${R2}`);
if (offenders.r2.length) console.log('       ' + offenders.r2.join(', '));
console.log(`  R3 getAll() in loop/map     : ${R3}`);
if (offenders.r3.length) console.log('       ' + offenders.r3.join(', '));
console.log(`  TOTAL: ${total}`);

let allowance = null;
if (fs.existsSync(ALLOWANCE_PATH)) {
  allowance = JSON.parse(fs.readFileSync(ALLOWANCE_PATH, 'utf8'));
}

if (!ENFORCE) {
  console.log('  (report-mode — not enforcing; run with --enforce after Wave 1)\n');
  process.exit(0);
}

const cap = allowance ? (allowance.R1 + allowance.R2 + allowance.R3) : 0;
if (total > cap) {
  console.error(`  FAIL  ${total} pattern violations exceed allowance ${cap} (ci/lint-allowance.json)\n`);
  process.exit(1);
}
console.log(`  PASS  ${total} <= allowance ${cap}\n`);
process.exit(0);
