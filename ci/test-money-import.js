// ci/test-money-import.js — characterization tests for the Excel-import money parser.
//
// WHY: A real past bug — "customers import dropped amount" — traced to how
// spreadsheet cells map to numeric money fields (lifetime_value / purchase amount
// that drives auto-conversion). The single pure kernel for that mapping is
// `_parseAmount` in chunks/script-import.js, wired into BOTH the customers-import
// `lifetime_value` field (line ~541) and the per-row purchase amount that gates
// prospect→customer auto-conversion (line ~848). These tests PIN its CURRENT
// behavior — comma thousands, RM prefix, decimals, blanks, junk, negatives,
// already-numeric input — so any future change to the parser fails the gate.
//
// HARNESS: we slice the REAL source line by a stable string marker and eval it
// as-is in `new Function` — NO refactor, NO re-implementation. If the marker
// drifts, extraction fails loudly (factory throws) → update this test deliberately.
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'chunks', 'script-import.js'), 'utf8');

// Stable marker: the whole one-liner arrow, sliced to end-of-statement.
const START = 'const _parseAmount = (raw) =>';
const start = src.indexOf(START);
if (start === -1) {
  console.error('FAIL extraction: `_parseAmount` marker not found in chunks/script-import.js — update test-money-import.js marker.');
  process.exit(1);
}
// End at the first `;` that closes the statement (the arrow body ends with `: 0; };`).
const endIdx = src.indexOf('};', start);
if (endIdx === -1) {
  console.error('FAIL extraction: could not find end of `_parseAmount` statement.');
  process.exit(1);
}
const block = src.slice(start, endIdx + 2); // include the closing `};`

let _parseAmount;
try {
  // eslint-disable-next-line no-new-func
  const factory = new Function(`${block}\nreturn _parseAmount;`);
  _parseAmount = factory();
} catch (e) {
  console.error('FAIL eval of sliced `_parseAmount`: ' + e.message);
  process.exit(1);
}

let pass = 0, fail = 0;
function eq(name, got, exp) {
  if (got === exp) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} expected ${JSON.stringify(exp)}`); }
}

// ── Currency strings: RM prefix + comma thousands + decimals ──────────────
// Non-[0-9.] chars (RM, comma, spaces) are stripped before parseFloat.
eq('rm-comma-decimals', _parseAmount('RM 1,234.50'), 1234.5);
eq('rm-no-space',       _parseAmount('RM1,234.50'), 1234.5);
eq('comma-thousands',   _parseAmount('1,234'), 1234);
eq('comma-millions',    _parseAmount('1,000,000'), 1000000);
eq('plain-decimal',     _parseAmount('298000.75'), 298000.75);
eq('leading-trailing-ws', _parseAmount('  RM 500 '), 500);
eq('currency-suffix',   _parseAmount('500 MYR'), 500);

// ── Empty / nullish → 0 (NOT null) — this is the "dropped amount" fallback ──
eq('empty-string',      _parseAmount(''), 0);
eq('null',              _parseAmount(null), 0);
eq('undefined',         _parseAmount(undefined), 0);
eq('whitespace-only',   _parseAmount('   '), 0);

// ── Non-numeric junk → strips to '' → parseFloat(NaN) → 0 ──────────────────
eq('pure-junk',         _parseAmount('abc'), 0);
eq('rm-only',           _parseAmount('RM'), 0);
eq('symbols-only',      _parseAmount('$-,'), 0);

// ── Negatives: a LEADING minus is preserved → value is NEGATIVE ────────────
// (2026-06-19 fix: the minus was previously stripped, silently flipping refunds/
// credits to positive; a leading '-' (after optional currency/space) now negates.)
eq('negative-plain',    _parseAmount('-50'), -50);
eq('negative-rm',       _parseAmount('-RM 1,200'), -1200);
eq('mid-string-minus',  _parseAmount('1-2'), 12);   // minus NOT leading → ignored (positive)

// ── Junk-wrapped numbers: leading text stripped, digits/dots retained ──────
eq('text-then-number',  _parseAmount('Paid: 1,500.00'), 1500); // strips to "1500.00" → 1500
eq('embedded-number',   _parseAmount('inv#42'), 42);

// ── Multiple dots: parseFloat stops at the second dot ─────────────────────
eq('two-dots',          _parseAmount('1.2.3'), 1.2);
eq('three-segments',    _parseAmount('1,2.3.4'), 12.3); // commas gone → "12.3.4" → parseFloat → 12.3

// ── Already-numeric input: toString round-trips through parseFloat ─────────
eq('numeric-int',       _parseAmount(1234), 1234);
eq('numeric-float',     _parseAmount(1234.5), 1234.5);
eq('numeric-zero',      _parseAmount(0), 0);          // 0 is falsy → (0||'') → '' → 0
eq('numeric-negative',  _parseAmount(-99), -99);      // '-99' → leading minus preserved → -99
eq('numeric-NaN',       _parseAmount(NaN), 0);        // NaN falsy → '' → 0

// ── Boolean / falsy passthrough (defensive, current behavior) ─────────────
eq('false',             _parseAmount(false), 0);      // false falsy → '' → 0
eq('true',              _parseAmount(true), 0);        // 'true' → no digits → '' → 0

console.log(`\nmoney-import-test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
