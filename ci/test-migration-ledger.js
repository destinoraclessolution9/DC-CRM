// ci/test-migration-ledger.js — applied-migration ledger guard.
//
// The CRM applies SQL migrations by hand via the Supabase dashboard (the
// PAT-on-CLI security rule blocks automated DDL). migrations/ledger_schema_
// migrations_2026-06-19.sql creates public.schema_migrations and backfills one
// row per already-applied migration. This guard cross-checks that ledger
// against the migrations/ dir — OFFLINE, no DB or network — and is deliberately
// CONSERVATIVE: it only hard-fails on unambiguous tampering, and otherwise
// emits warnings, because a gate that cries wolf trains people to ignore it.
//
//   HARD FAIL : a filename recorded in the ledger has NO file on disk
//               (an applied migration's record-of-truth was deleted).
//   WARN      : an applyable, non-pending migration on disk is missing from
//               the ledger (legitimately true for not-yet-applied migrations —
//               add a ledger row after applying it).
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'migrations');
const LEDGER = path.join(DIR, 'ledger_schema_migrations_2026-06-19.sql');

// Files that legitimately are NOT in the ledger and must not warn:
const NOT_APPLYABLE = /(DRAFT|FUTURE|TEMPLATE|_PLAN|_skip)/i;
const LEDGER_FILE = 'ledger_schema_migrations_2026-06-19.sql';
// README "Currently pending (owner action)" — written but not yet applied.
const PENDING = new Set([
  'redemption_requests_2026-06-17.sql',
  'monthly_focus_archive_unique_2026-06-17.sql',
]);

let fail = 0;
const warns = [];

if (!fs.existsSync(LEDGER)) {
  console.error('  FAIL  missing ledger file: migrations/' + LEDGER_FILE);
  process.exit(1);
}

// ── parse recorded filenames out of the INSERT … VALUES block ──────────────
// Each row's first quoted string is the filename: ('<filename>', '<sha>', ...).
const ledgerSrc = fs.readFileSync(LEDGER, 'utf8')
  .replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const recorded = [];
const rowRe = /\(\s*'([^']+\.sql)'\s*,/g;
let m;
while ((m = rowRe.exec(ledgerSrc)) !== null) recorded.push(m[1]);
const recordedSet = new Set(recorded);

// ── files on disk ──────────────────────────────────────────────────────────
const onDisk = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.sql'))
  : [];
const onDiskSet = new Set(onDisk);

// ── HARD: a recorded migration whose file is gone (tampering) ──────────────
const deleted = recorded.filter((f) => !onDiskSet.has(f));
if (deleted.length) {
  console.error('  FAIL  ledger records migration(s) with no file on disk (record-of-truth deleted):');
  deleted.forEach((f) => console.error('   - ' + f));
  fail++;
}

// ── WARN: applyable, non-pending migration on disk not in the ledger ───────
for (const f of onDisk) {
  if (f === LEDGER_FILE) continue;
  if (NOT_APPLYABLE.test(f)) continue;
  if (PENDING.has(f)) continue;
  if (!recordedSet.has(f)) {
    warns.push(`${f} — pending application or unrecorded — add a ledger row after applying`);
  }
}

console.log(`\nmigration-ledger: ${recorded.length} recorded, ${onDisk.length} on disk`);
if (warns.length) {
  console.log(`  ${warns.length} warning(s) (non-fatal — see migrations/README.md):`);
  warns.forEach((w) => console.log('   - ' + w));
}
console.log(`migration-ledger: ${fail === 0 ? 'PASS' : 'FAIL'} (${recorded.length} recorded, ${onDisk.length} on disk, ${warns.length} warnings)`);
process.exit(fail === 0 ? 0 : 1);
