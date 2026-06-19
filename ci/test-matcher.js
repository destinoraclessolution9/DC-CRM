// ci/test-matcher.js — characterization tests for the ranking "matcher" /
// fit-scoring kernel in chunks/script-performance.js.
//
// WHAT IS THE "MATCHER": the grep target (matcher/matchScore/fitScore) in
// script-performance.js resolves to the agent leaderboard *fit/performance
// score*. showRankingPerformanceView buckets each agent's activities,
// purchases and prospects, derives two rate metrics, then collapses five
// signals into a single ordering scalar `performanceScore` (line ~156).
// That scalar is the real ranking kernel — agentStats.sort() orders the whole
// leaderboard by it. There is NO agent<->prospect or referral matcher here;
// the "match" hits elsewhere in the file are icon→category display matchers.
//
// The scoring math is a set of PURE single-line expressions (inputs -> number)
// with no DOM / Supabase / `this`. They are, however, embedded inside the big
// async showRankingPerformanceView method. So rather than re-implement the
// weights (which would let drift pass silently), we SLICE the three real
// source expressions by stable markers and eval them as-is. If the source
// formula changes, the slice still evals the NEW math and these pinned
// expectations fail the gate — exactly the drift signal we want.
//
// HARNESS: source-slice (the gold standard from test-authz-roles.js). No
// existing file is modified; no new deps.
'use strict';
const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '..', 'chunks', 'script-performance.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

// ── Slice helper: extract the RHS of a marked single-line assignment/property,
// up to (and including) its balanced closing. We grab from the marker to the
// end of that source line, which for these one-liners is the full expression.
function sliceLineAfter(marker) {
  const i = src.indexOf(marker);
  if (i === -1) return null;
  const lineEnd = src.indexOf('\n', i);
  const rawEnd = lineEnd === -1 ? src.length : lineEnd;
  return src.slice(i + marker.length, rawEnd).trim();
}

// performanceScore: property value is the whole Math.round(...) call with a
// trailing ')' (object literal) — no trailing comma/semicolon on that line.
const SCORE_MARKER = 'performanceScore: ';
let scoreExpr = sliceLineAfter(SCORE_MARKER);

// followupRate / closingRate: ternary expressions terminated by ';'.
function sliceAssignExpr(marker) {
  const raw = sliceLineAfter(marker);
  if (raw == null) return null;
  // strip a single trailing ';' if present
  return raw.replace(/;\s*$/, '');
}
let followupExpr = sliceAssignExpr('const followupRate = ');
let closingExpr = sliceAssignExpr('const closingRate = ');

if (!scoreExpr || !followupExpr || !closingExpr) {
  console.error('FAIL extraction: matcher/fit-score markers not found in chunks/script-performance.js — update test-matcher.js markers.');
  console.error('  scoreExpr=' + JSON.stringify(scoreExpr));
  console.error('  followupExpr=' + JSON.stringify(followupExpr));
  console.error('  closingExpr=' + JSON.stringify(closingExpr));
  process.exit(1);
}

// Build pure functions out of the REAL sliced expressions. Each expression's
// free variables become the function parameters — we eval the source math,
// we do NOT re-author it.
let perfScore, followupRate, closingRate;
try {
  // eslint-disable-next-line no-new-func
  perfScore = new Function(
    'cpsCount', 'totalSales', 'meetingCount', 'followupRate', 'closingRate',
    'return (' + scoreExpr + ');'
  );
  // eslint-disable-next-line no-new-func
  followupRate = new Function(
    'prospects', 'followedUp',
    'return (' + followupExpr + ');'
  );
  // eslint-disable-next-line no-new-func
  closingRate = new Function(
    'cpsCount', 'purchases',
    'return (' + closingExpr + ');'
  );
} catch (e) {
  console.error('FAIL eval of sliced matcher expressions: ' + e.message);
  console.error('  scoreExpr=' + scoreExpr);
  console.error('  followupExpr=' + followupExpr);
  console.error('  closingExpr=' + closingExpr);
  process.exit(1);
}

let pass = 0, fail = 0;
function eq(name, got, exp) {
  if (got === exp) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} expected ${JSON.stringify(exp)}`); }
}

// ── Sanity: the sliced source matches the weights we are pinning. If anyone
// re-tunes the formula these literal checks document the diff intent.
eq('slice-has-cps5',      /cpsCount\s*\*\s*5/.test(scoreExpr), true);
eq('slice-has-sales1000', /totalSales\s*\/\s*1000/.test(scoreExpr), true);
eq('slice-has-meet3',     /meetingCount\s*\*\s*3/.test(scoreExpr), true);
eq('slice-has-follow05',  /followupRate\s*\*\s*0\.5/.test(scoreExpr), true);
eq('slice-has-close08',   /closingRate\s*\*\s*0\.8/.test(scoreExpr), true);
eq('slice-rounds',        /^Math\.round\(/.test(scoreExpr), true);

// ── performanceScore = round(cps*5 + sales/1000 + meetings*3 + follow*0.5 + close*0.8)

// all-zero → 0 (the floor / empty-agent baseline)
eq('score-zero', perfScore(0, 0, 0, 0, 0), 0);

// single-signal isolation (each weight, characterized independently)
eq('score-cps-only',      perfScore(1, 0, 0, 0, 0), 5);     // 1*5
eq('score-cps-10',        perfScore(10, 0, 0, 0, 0), 50);   // 10*5
eq('score-sales-only',    perfScore(0, 1000, 0, 0, 0), 1);  // 1000/1000
eq('score-sales-2500',    perfScore(0, 2500, 0, 0, 0), 3);  // 2.5 -> round 3
eq('score-sales-2499',    perfScore(0, 2499, 0, 0, 0), 2);  // 2.499 -> round 2
eq('score-meet-only',     perfScore(0, 0, 4, 0, 0), 12);    // 4*3
eq('score-follow-only',   perfScore(0, 0, 0, 100, 0), 50);  // 100*0.5
eq('score-follow-odd',    perfScore(0, 0, 0, 33, 0), 17);   // 16.5 -> round 17 (half-up)
eq('score-close-only',    perfScore(0, 0, 0, 0, 100), 80);  // 100*0.8

// typical mid agent: 8 CPS, RM 42,000 sales, 6 meetings, 50% follow, 25% close
// 40 + 42 + 18 + 25 + 20 = 145
eq('score-typical', perfScore(8, 42000, 6, 50, 25), 145);

// strong agent (boundary-ish max in a month): 30 CPS, RM 300k, 20 meet, 100/100
// 150 + 300 + 60 + 50 + 80 = 640
eq('score-strong', perfScore(30, 300000, 20, 100, 100), 640);

// fractional accumulation rounds the SUM once (not per-term):
// cps*5=5 ; sales/1000 = 1.4 ; rest 0 => 6.4 -> 6
eq('score-sum-rounds-once', perfScore(1, 1400, 0, 0, 0), 6);
// 5 + 1.6 = 6.6 -> 7
eq('score-sum-round-up', perfScore(1, 1600, 0, 0, 0), 7);

// missing/garbage numeric inputs characterize current (un-guarded) behavior:
// the formula does no coercion guards — NaN propagates.
eq('score-nan-cps', Number.isNaN(perfScore(NaN, 0, 0, 0, 0)), true);
// negative sales (refund-skewed) is allowed through, lowering the score:
// 10*5 + (-5000/1000) = 50 - 5 = 45
eq('score-neg-sales', perfScore(10, -5000, 0, 0, 0), 45);

// ── followupRate = prospects.length>0 ? round(followedUp/prospects.length*100) : 0
// modeled with array-likes carrying .length (the only field the expr reads).
const P = (n) => ({ length: n });

eq('follow-empty', followupRate(P(0), 0), 0);          // guard: no prospects -> 0
eq('follow-all',   followupRate(P(10), 10), 100);      // 10/10
eq('follow-half',  followupRate(P(10), 5), 50);        // 5/10
eq('follow-third', followupRate(P(3), 1), 33);         // 33.33 -> 33
eq('follow-twothirds', followupRate(P(3), 2), 67);     // 66.67 -> 67
eq('follow-over',  followupRate(P(4), 6), 150);        // no clamp: 6/4 -> 150
eq('follow-zero-num', followupRate(P(7), 0), 0);       // none followed up

// ── closingRate = cpsCount>0 ? round(purchases.length/cpsCount*100) : 0
eq('close-zero-cps', closingRate(0, P(5)), 0);         // guard: no CPS -> 0 (even with sales)
eq('close-full',     closingRate(5, P(5)), 100);       // 5/5
eq('close-typical',  closingRate(8, P(2)), 25);        // 2/8
eq('close-eighth',   closingRate(8, P(1)), 13);        // 12.5 -> round 13 (half-up)
eq('close-over100',  closingRate(2, P(5)), 250);       // no clamp: 5/2 -> 250
eq('close-zero-num', closingRate(10, P(0)), 0);        // CPS but no purchases

// ── end-to-end: rates feed the score (chaining the three real expressions)
// agent: cps=8, sales=42000, meet=6, prospects 10/5 followed, purchases 2/8 cps
const fr = followupRate(P(10), 5);   // 50
const cr = closingRate(8, P(2));     // 25
eq('chain-follow', fr, 50);
eq('chain-close',  cr, 25);
eq('chain-score',  perfScore(8, 42000, 6, fr, cr), 145);

console.log(`\nmatcher-test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
