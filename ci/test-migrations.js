// ci/test-migrations.js — migration-hygiene reporter (R5).
//
// The CRM applies SQL migrations by hand via the Supabase dashboard (the
// PAT-on-CLI security rule blocks automated DDL), and there is no applied-ledger.
// This guard enforces the lightweight forward-discipline documented in
// migrations/README.md. It is deliberately CONSERVATIVE — it only hard-fails on
// an unambiguous mistake (a duplicate filename) and otherwise reports hygiene
// warnings, because a noisy gate that cries wolf trains people to ignore it.
//
//   HARD FAIL : duplicate migration filename (case-insensitive).
//   WARN      : applyable migration with no idempotency guard
//               (IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS);
//               filename missing a YYYY-MM-DD stamp.
//
// Files marked DRAFT / FUTURE / TEMPLATE / _PLAN are not meant to be applied
// as-is and are excluded from the WARN checks.
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'migrations');
let fail = 0;
const warns = [];

const NOT_APPLYABLE = /(DRAFT|FUTURE|TEMPLATE|_PLAN|_skip)/i;
const GUARD = /if\s+not\s+exists|or\s+replace|drop\s+\w[\w\s]*if\s+exists/i;

const files = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.sql'))
  : [];
if (files.length === 0) { console.error('  FAIL  no migrations found'); process.exit(1); }

// ── HARD: duplicate filename (case-insensitive) ───────────────────────────
const lower = files.map((f) => f.toLowerCase());
const dups = [...new Set(lower.filter((f, i) => lower.indexOf(f) !== i))];
if (dups.length) { console.error('  FAIL  duplicate migration filename(s): ' + dups.join(', ')); fail++; }

// ── WARN: idempotency + naming hygiene on applyable migrations ────────────
let applyable = 0, guardless = 0;
for (const f of files) {
  if (NOT_APPLYABLE.test(f)) continue;
  applyable++;
  const code = fs.readFileSync(path.join(DIR, f), 'utf8')
    .replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (!GUARD.test(code)) { guardless++; warns.push(`no idempotency guard: ${f}`); }
  if (!/\d{4}-\d{2}-\d{2}/.test(f)) warns.push(`filename missing YYYY-MM-DD stamp: ${f}`);
}

console.log(`\nmigrations: ${files.length} files (${applyable} applyable, ${guardless} without idempotency guards)`);
if (warns.length) {
  console.log(`  ${warns.length} hygiene warning(s) (non-fatal — see migrations/README.md):`);
  warns.forEach((w) => console.log('   - ' + w));
}
console.log(`migrations-test: ${fail === 0 ? 'PASS' : 'FAIL'} (${fail} hard failure(s))`);
process.exit(fail === 0 ? 0 : 1);
