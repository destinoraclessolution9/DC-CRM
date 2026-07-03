// ci/test-dormancy.js — characterization tests for the prospect dormancy /
// active-set decision in data.js.
//
// WHY: getActiveProspects (~line 2715) is the load-time visibility gate for the
// prospects list. The documented ops rule (2026-04-23) is:
//   • a prospect whose last_activity_date is OLDER than dormantDays (default
//     500) is hidden as DORMANT and not loaded on first render;
//   • BUT a never-contacted prospect (no last_activity_date) is KEPT (active),
//     because the activity trigger may not have seeded the date yet;
//   • includeDormant:true opts out entirely and returns the full set.
// The same rule is mirrored server-side: the .or() PostgREST filter in the
// network path (line 2756) and the prospects_page RPC params (p_include_dormant
// / p_dormant_days, line 2617-2618).
//
// HARNESS: we SLICE the real source by stable string markers and eval it as-is,
// so any drift in the cutoff math or the keep/hide predicate fails this gate.
//   1. CUTOFF expr  — the Date.now()-based cutoff (line 2747-2748). Date.now()
//      is shimmed to a FIXED reference so day-deltas are deterministic; the
//      arithmetic + .toISOString().slice(0,10) runs verbatim from source.
//   2. KEEP predicate — the client-fallback .filter(p => {...}) body
//      (line 2802-2808): the actual active/dormant decision.
//   3. SERVER filter — the dormantFilter template literal (line 2756): proves
//      the server path encodes the same "gte cutoff OR is null" rule.
// No source is modified; no duplicate rule is re-implemented.
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');

function slice(startMarker, endMarker, label) {
  const s = src.indexOf(startMarker);
  if (s === -1) {
    console.error(`FAIL extraction: start marker for ${label} not found in data.js — update test-dormancy.js markers.`);
    process.exit(1);
  }
  const e = src.indexOf(endMarker, s);
  if (e === -1) {
    console.error(`FAIL extraction: end marker for ${label} not found in data.js — update test-dormancy.js markers.`);
    process.exit(1);
  }
  return src.slice(s, e + endMarker.length);
}

// ── 1. CUTOFF expression (verbatim source, deterministic via Date shim) ──────
// Real source (line 2747-2748):
//   const cutoff = new Date(Date.now() - dormantDays * 86400000)
//       .toISOString().slice(0, 10); // YYYY-MM-DD
const cutoffBlock = slice(
  'const cutoff = new Date(Date.now() - dormantDays * 86400000)',
  '.toISOString().slice(0, 10);',
  'cutoff-expr'
);

let computeCutoffRaw;
try {
  // Run the sliced expr as-is against an injected `Date` (a Proxy over the real
  // ctor whose `.now` returns the fixed reference) and an injected `dormantDays`.
  // `Date` is a PARAMETER (not a `const`), so there's no TDZ and the source's
  // `Date.now()` + `new Date(...).toISOString()` both resolve through the shim.
  // eslint-disable-next-line no-new-func
  computeCutoffRaw = new Function('Date', 'dormantDays', `
    ${cutoffBlock}
    return cutoff;
  `);
} catch (e) {
  console.error('FAIL eval of sliced cutoff expr: ' + e.message);
  process.exit(1);
}
// computeCutoff(nowMs, dormantDays): shim Date.now() to nowMs, keep real ctor.
function computeCutoff(nowMs, dormantDays) {
  const shim = new Proxy(Date, {
    get(t, p) { return p === 'now' ? () => nowMs : t[p]; },
  });
  return computeCutoffRaw(shim, dormantDays);
}

// ── 2. KEEP predicate (the client-fallback active/dormant decision) ──────────
// Real source (line 2802-2808):
//   all.filter(p => {
//       if (!p.last_activity_date) return true;
//       return p.last_activity_date >= cutoff;
//   });
const keepBody = slice(
  'return all.filter(p => {',
  'return p.last_activity_date >= cutoff;',
  'keep-predicate'
);
// Re-close the sliced arrow body. We stop the slice at the final `return`
// statement (CRLF-agnostic) and append the closing `});` ourselves, so the
// predicate BODY remains verbatim source.
const keepBlock = keepBody + '\n            });';

// The keep-predicate calls the closure helper `_activeStatus(p.status)` (excludes
// converted/lost), which lives outside the sliced body. Supply it as a named
// parameter so the verbatim predicate evaluates instead of throwing ReferenceError.
// Mirrors data.js getActiveProspects' `_activeStatus`.
const _activeStatusFn = (s) => { const v = String(s || '').toLowerCase(); return v !== 'converted' && v !== 'lost'; };

let keepFactory;
try {
  // Re-host the sliced `all.filter(p => {...})` as a pure predicate factory:
  // bind `all` to a single-element array and `cutoff` to the injected value,
  // then read back whether that one row survived. The predicate BODY is
  // verbatim source.
  // eslint-disable-next-line no-new-func
  keepFactory = new Function('all', 'cutoff', '_activeStatus', `${keepBlock}`);
} catch (e) {
  console.error('FAIL eval of sliced keep predicate: ' + e.message);
  process.exit(1);
}
// isKept(row, cutoff) -> true if the row stays in the active set.
function isKept(row, cutoff) {
  const out = keepFactory([row], cutoff, _activeStatusFn);
  return out.length === 1;
}

// ── 3. SERVER filter string (the PostgREST .or() encoding of the same rule) ──
// Real source (line 2756):
//   const dormantFilter = `last_activity_date.gte.${cutoff},last_activity_date.is.null`;
const serverBlock = slice(
  'const dormantFilter = `last_activity_date.gte.',
  'last_activity_date.is.null`;',
  'server-filter'
);
let buildServerFilter;
try {
  // eslint-disable-next-line no-new-func
  buildServerFilter = new Function('cutoff', `${serverBlock}\n            return dormantFilter;`);
} catch (e) {
  console.error('FAIL eval of sliced server filter: ' + e.message);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function eq(name, got, exp) {
  if (got === exp) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} expected ${JSON.stringify(exp)}`); }
}

const DAY = 86400000;
// FIXED reference "now" — no wall-clock dependency. 2026-06-19T12:00:00Z.
const NOW = Date.UTC(2026, 5, 19, 12, 0, 0);
const DORMANT_DAYS = 500; // documented default

// Helper: an ISO date (YYYY-MM-DD) for `daysAgo` days before NOW.
const dateDaysAgo = (daysAgo) =>
  new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10);

// ── Cutoff math: 500 days before the fixed NOW ───────────────────────────────
const cutoff = computeCutoff(NOW, DORMANT_DAYS);
eq('cutoff-shape', /^\d{4}-\d{2}-\d{2}$/.test(cutoff), true);
eq('cutoff-equals-500d-ago', cutoff, dateDaysAgo(DORMANT_DAYS));
// Cutoff tracks dormantDays (90-day variant lands on a different boundary).
eq('cutoff-90d', computeCutoff(NOW, 90), dateDaysAgo(90));

// ── KEEP predicate: never-contacted is always kept (active) ──────────────────
eq('never-null',      isKept({ last_activity_date: null }, cutoff), true);
eq('never-undefined', isKept({ last_activity_date: undefined }, cutoff), true);
eq('never-missing',   isKept({}, cutoff), true);
eq('never-empty-str', isKept({ last_activity_date: '' }, cutoff), true); // '' is falsy → kept

// ── KEEP predicate: recent activity stays active ─────────────────────────────
eq('today-active',    isKept({ last_activity_date: dateDaysAgo(0) }, cutoff), true);
eq('1d-active',       isKept({ last_activity_date: dateDaysAgo(1) }, cutoff), true);
eq('499d-active',     isKept({ last_activity_date: dateDaysAgo(499) }, cutoff), true);

// ── KEEP predicate: the 500-day boundary (>= cutoff is INCLUSIVE → active) ───
eq('500d-boundary-active', isKept({ last_activity_date: dateDaysAgo(500) }, cutoff), true);
eq('cutoff-exact-active',  isKept({ last_activity_date: cutoff }, cutoff), true);

// ── KEEP predicate: older than 500 days is DORMANT (hidden) ──────────────────
eq('501d-dormant',  isKept({ last_activity_date: dateDaysAgo(501) }, cutoff), false);
eq('700d-dormant',  isKept({ last_activity_date: dateDaysAgo(700) }, cutoff), false);
eq('2yr-dormant',   isKept({ last_activity_date: dateDaysAgo(800) }, cutoff), false);
// One ISO-day below the cutoff string is dormant; exactly cutoff is active.
const dayBeforeCutoff = new Date(Date.parse(cutoff + 'T00:00:00Z') - DAY)
  .toISOString().slice(0, 10);
eq('one-day-below-cutoff-dormant', isKept({ last_activity_date: dayBeforeCutoff }, cutoff), false);

// ── SERVER filter string: same rule, encoded for PostgREST .or() ─────────────
// Must include BOTH the gte-cutoff branch (active window) AND the is.null
// branch (never-contacted kept) — i.e. the server path can never silently drop
// never-contacted rows.
eq('server-filter-string', buildServerFilter(cutoff),
   `last_activity_date.gte.${cutoff},last_activity_date.is.null`);
eq('server-has-gte-cutoff', buildServerFilter(cutoff).includes(`gte.${cutoff}`), true);
eq('server-keeps-null',     buildServerFilter(cutoff).includes('last_activity_date.is.null'), true);

// ── Cross-check: server .or() admits exactly the rows the client predicate keeps
// (parity between the network path and the fallback path). We re-derive the
// server decision from its filter string and compare to isKept() row-by-row.
function serverAdmits(row, cutoffVal) {
  const f = buildServerFilter(cutoffVal); // "...gte.<cutoff>,...is.null"
  const gteMatch = /gte\.(\d{4}-\d{2}-\d{2})/.exec(f);
  const gteCutoff = gteMatch[1];
  const hasNullBranch = /is\.null/.test(f);
  const v = row.last_activity_date;
  if (v == null || v === '') return hasNullBranch; // never-contacted → null branch
  return v >= gteCutoff;
}
for (const days of [0, 1, 499, 500, 501, 700]) {
  const row = { last_activity_date: dateDaysAgo(days) };
  eq(`parity-${days}d`, serverAdmits(row, cutoff), isKept(row, cutoff));
}
eq('parity-null', serverAdmits({ last_activity_date: null }, cutoff), isKept({ last_activity_date: null }, cutoff));

// ── prospects_page RPC defaults: dormantDays default is 500, include is false ─
// Characterize the documented server-RPC defaults straight from source so a
// silent change to the 500 default / include-dormant default trips the gate.
const rpcBlock = slice(
  "p_include_dormant:   opts.includeDormant ?? false,",
  "p_dormant_days:      opts.dormantDays ?? 500,",
  'rpc-defaults'
);
eq('rpc-include-default-false', /p_include_dormant:\s*opts\.includeDormant \?\? false/.test(rpcBlock), true);
eq('rpc-dormant-default-500',   /p_dormant_days:\s*opts\.dormantDays \?\? 500/.test(rpcBlock), true);

console.log(`\ndormancy-test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
