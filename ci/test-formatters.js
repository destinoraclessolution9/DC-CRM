// ci/test-formatters.js — characterization tests for the pure display formatters.
//
// WHY: the en-MY / RM money + date string-builders are what users actually read
// on every card, table cell and report. They are PURE (no DOM / Supabase / this),
// so they are cheaply pinnable — and a silent drift (locale, fraction digits,
// the "—" empty sentinel, the RM/K/M compaction thresholds) would change every
// rendered figure without throwing. These tests PIN the current behavior.
//
// HARNESS (the gold-standard pattern from test-authz-roles.js): we SLICE the real
// source out of ui.js / chunks/script-ai.js by stable string markers and eval it
// AS-IS inside a stubbed `new Function` scope — NO refactor, NO duplicate impl.
// If the markers drift, extraction fails loudly (factory throws) → the gate goes
// red and this test is updated deliberately.
//
// Targets (all genuinely pure):
//   ui.js                  formatDate, formatNumber, formatCurrency, formatCompact
//   chunks/script-ai.js    _daysSince   (wall-clock killed: Date.now stubbed to a
//                                         fixed epoch so the test is deterministic)
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function eq(name, got, exp) {
  if (got === exp) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} expected ${JSON.stringify(exp)}`); }
}
function slice(src, startMarker, endMarker, label) {
  const s = src.indexOf(startMarker);
  if (s === -1) { console.error(`FAIL extraction: start marker for ${label} not found — update test-formatters.js markers.`); process.exit(1); }
  const e = src.indexOf(endMarker, s);
  if (e === -1) { console.error(`FAIL extraction: end marker for ${label} not found — update test-formatters.js markers.`); process.exit(1); }
  return src.slice(s, e + endMarker.length);
}

// ─────────────────────────────────────────────────────────────────────────────
//  ui.js — date / number formatters
// ─────────────────────────────────────────────────────────────────────────────
// Normalize CRLF → LF so the multi-line end markers match regardless of how the
// source file was checked out (the repo currently ships ui.js with CRLF).
const readLF = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const uiSrc = readLF(path.join(__dirname, '..', 'ui.js'));

// Block A: formatDate + formatNumber (contiguous in source).
const blockDateNum = slice(
  uiSrc,
  'const formatDate = (d) => {',
  "return num.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });\n    };",
  'formatDate/formatNumber'
);

// Block B: country registry + formatCurrency + formatCompact (contiguous;
// formatCurrency now reads the _CURRENCY map derived from COUNTRIES, and
// formatCompact calls formatCurrency, so they must be eval'd together).
const blockCurrency = slice(
  uiSrc,
  'const COUNTRIES = [',
  'return formatCurrency(num, opts);\n    };',
  'country-registry/formatCurrency/formatCompact'
);

let DN, CUR;
try {
  // eslint-disable-next-line no-new-func
  DN = new Function(`${blockDateNum}\n return { formatDate, formatNumber };`)();
  // eslint-disable-next-line no-new-func
  CUR = new Function(`${blockCurrency}\n return { formatCurrency, formatCompact };`)();
} catch (e) {
  console.error('FAIL eval of sliced ui.js formatters: ' + e.message);
  process.exit(1);
}
const { formatDate, formatNumber } = DN;
const { formatCurrency, formatCompact } = CUR;

// ── formatDate: null/empty → em-dash sentinel; invalid → passthrough ─────────
eq('date-null',      formatDate(null), '—');
eq('date-undefined', formatDate(undefined), '—');
eq('date-empty',     formatDate(''), '—');
eq('date-zero',      formatDate(0), '—');            // 0 is falsy → sentinel (NOT epoch)
// Unparseable string → returns the input verbatim (NaN guard).
eq('date-garbage',   formatDate('not-a-date'), 'not-a-date');
// Valid ISO date → en-MY long-ish form. Pin the exact rendered string so a
// locale / option drift fails the gate. en-MY day-month-year, short month.
eq('date-iso',       formatDate('2026-06-19'), '19 Jun 2026');
eq('date-jan',       formatDate('2026-01-01'), '1 Jan 2026');

// ── formatNumber: NaN → '0'; else 2dp en-MY grouping ─────────────────────────
eq('num-nan',        formatNumber('abc'), '0');
eq('num-null',       formatNumber(null), '0');
eq('num-undefined',  formatNumber(undefined), '0');
eq('num-zero',       formatNumber(0), '0.00');
eq('num-int',        formatNumber(5), '5.00');
eq('num-thousands',  formatNumber(1234.5), '1,234.50');
eq('num-million',    formatNumber(1234567.891), '1,234,567.89'); // rounds to 2dp
eq('num-string',     formatNumber('42'), '42.00');               // parseFloat path
eq('num-neg',        formatNumber(-9.005), '-9.01');

// ── formatCurrency: non-finite → '—'; default 0dp; opts.dp overrides ─────────
eq('cur-null',       formatCurrency(null), 'RM 0');              // Number(null)=0 finite → NOT sentinel (gotcha)
eq('cur-empty-str',  formatCurrency(''), 'RM 0');                // Number('')=0 finite → NOT sentinel (gotcha)
eq('cur-nan',        formatCurrency('abc'), '—');                // Number('abc')=NaN → sentinel
eq('cur-undefined',  formatCurrency(undefined), '—');            // Number(undefined)=NaN → sentinel
eq('cur-infinity',   formatCurrency(Infinity), '—');
eq('cur-zero',       formatCurrency(0), 'RM 0');
eq('cur-int',        formatCurrency(1500), 'RM 1,500');          // default dp=0
eq('cur-rounds',     formatCurrency(1500.7), 'RM 1,501');        // 0dp rounds
eq('cur-dp2',        formatCurrency(1500.5, { dp: 2 }), 'RM 1,500.50');
eq('cur-million',    formatCurrency(1234567), 'RM 1,234,567');
eq('cur-string',     formatCurrency('2500'), 'RM 2,500');        // Number('2500')=2500
eq('cur-neg',        formatCurrency(-300), 'RM -300');
// ── Multi-country: opts.currency switches symbol + locale; default stays MYR ──
eq('cur-myr-explicit', formatCurrency(1500, { currency: 'MYR' }), 'RM 1,500');
eq('cur-sgd',          formatCurrency(1500, { currency: 'SGD' }), 'S$ 1,500');
eq('cur-aud',          formatCurrency(1500, { currency: 'AUD' }), 'A$ 1,500');
eq('cur-sgd-dp2',      formatCurrency(1500.5, { currency: 'SGD', dp: 2 }), 'S$ 1,500.50');
eq('cur-unknown-cur',  formatCurrency(1500, { currency: 'XXX' }), 'RM 1,500'); // unknown → MYR fallback

// ── formatCompact: K/M suffix thresholds + sentinel ──────────────────────────
eq('comp-nan',       formatCompact('x'), '—');
eq('comp-small',     formatCompact(950), 'RM 950');              // < 1e3 → falls to formatCurrency (0dp)
eq('comp-1k',        formatCompact(1500), 'RM 1.5K');            // 1e3..1e4 → 1dp K
eq('comp-10k',       formatCompact(12000), 'RM 12K');            // >= 1e4 → 0dp K
eq('comp-1m',        formatCompact(1500000), 'RM 1.5M');         // 1e6..1e7 → 1dp M
eq('comp-10m',       formatCompact(12000000), 'RM 12M');         // >= 1e7 → 0dp M
eq('comp-neg-1m',    formatCompact(-1500000), 'RM -1.5M');       // sign preserved (abs drives threshold)
eq('comp-boundary-1k', formatCompact(1000), 'RM 1.0K');         // exactly 1e3 → K branch, 1dp
// ── formatCompact: currency-aware too (default MYR unchanged) ─────────────────
eq('comp-sgd-1k',    formatCompact(1500, { currency: 'SGD' }), 'S$ 1.5K');
eq('comp-aud-1m',    formatCompact(1500000, { currency: 'AUD' }), 'A$ 1.5M');
eq('comp-sgd-small', formatCompact(950, { currency: 'SGD' }), 'S$ 950');

// ─────────────────────────────────────────────────────────────────────────────
//  chunks/script-ai.js — _daysSince (relative-time; wall-clock made deterministic)
// ─────────────────────────────────────────────────────────────────────────────
const aiSrc = readLF(path.join(__dirname, '..', 'chunks', 'script-ai.js'));

// _daysSince references _DAY_MS (sliced too) and Date.now(). We inject a fixed
// Date.now so the floor-of-elapsed-days math is reproducible — NO wall clock.
const blockDaysSince = slice(
  aiSrc,
  'const _DAY_MS = 24 * 60 * 60 * 1000;',
  'return Math.max(0, Math.floor((Date.now() - t) / _DAY_MS));\n    };',
  '_daysSince'
);

// Fixed "now": 2026-06-19T00:00:00.000Z.
const NOW_MS = Date.UTC(2026, 5, 19, 0, 0, 0, 0);
let DS;
try {
  // eslint-disable-next-line no-new-func
  DS = new Function('FIXED_NOW', `
    const Date = (function (RealDate) {
      function D(...a) { return a.length ? new RealDate(...a) : new RealDate(FIXED_NOW); }
      D.now = () => FIXED_NOW;
      D.UTC = RealDate.UTC; D.parse = RealDate.parse;
      D.prototype = RealDate.prototype;
      return new Proxy(D, { construct(_t, a) { return a.length ? new RealDate(...a) : new RealDate(FIXED_NOW); } });
    })(globalThis.Date);
    ${blockDaysSince}
    return { _daysSince };
  `)(NOW_MS);
} catch (e) {
  console.error('FAIL eval of sliced _daysSince: ' + e.message);
  process.exit(1);
}
const { _daysSince } = DS;
const DAY = 24 * 60 * 60 * 1000;

// ── _daysSince: falsy / unparseable → Infinity; else floored elapsed days ─────
eq('ds-null',        _daysSince(null), Infinity);
eq('ds-undefined',   _daysSince(undefined), Infinity);
eq('ds-empty',       _daysSince(''), Infinity);
eq('ds-garbage',     _daysSince('not-a-date'), Infinity);
eq('ds-now',         _daysSince(NOW_MS), 0);
eq('ds-1day',        _daysSince(NOW_MS - DAY), 1);
eq('ds-10day',       _daysSince(NOW_MS - 10 * DAY), 10);
// Partial day rounds DOWN (floor): 1.5 days ago → 1.
eq('ds-floor',       _daysSince(NOW_MS - Math.floor(1.5 * DAY)), 1);
// Future date → clamped to 0 (Math.max(0, …)), never negative.
eq('ds-future',      _daysSince(NOW_MS + 5 * DAY), 0);
// Accepts an ISO string at the fixed-now boundary.
eq('ds-iso-now',     _daysSince('2026-06-19T00:00:00.000Z'), 0);
eq('ds-iso-prior',   _daysSince('2026-06-09T00:00:00.000Z'), 10);

console.log(`\nformatters-test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
