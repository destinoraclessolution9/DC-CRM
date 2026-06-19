// ci/test-view-authz.js — characterization tests for the per-view access gate.
//
// WHY: navigateTo previously enforced ONLY the chunk-load exactLevels gate, so
// ~15 nav-restricted views (purchases_history, import, protection, agents,
// custom_fields, lead_forms…) were reachable by any logged-in user via URL hash
// (deep audit 2026-06-20). The fix added _isViewAllowed()/_defaultViewFor() which
// enforce the full VIEWS authz contract (exactLevels + minLevel + navLevels).
// These tests PIN that matrix: every role's default view must be self-allowed (no
// bounce loop) and the sensitive admin/financial/PII views must stay restricted.
//
// HARNESS: slice the real VIEWS literal from script.js (no duplicate registry)
// and re-implement the small _isViewAllowed predicate verbatim. If the VIEWS
// marker drifts, extraction fails loudly.
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const vStart = src.indexOf('const VIEWS = {');
if (vStart === -1) { console.error('FAIL extraction: `const VIEWS = {` not found in script.js'); process.exit(1); }
const vEnd = src.indexOf('\n    };', vStart);
if (vEnd === -1) { console.error('FAIL extraction: end of VIEWS literal not found'); process.exit(1); }
const viewsSrc = src.slice(src.indexOf('{', vStart), vEnd + 6).replace(/_VIEW_NO_NAV/g, 'null');
let VIEWS;
try { VIEWS = eval('(' + viewsSrc + ')'); } catch (e) { console.error('FAIL eval VIEWS: ' + e.message); process.exit(1); }

// Mirror of script.js _isViewAllowed (kept in lockstep — see that function).
const _isViewAllowed = (viewId, lvl) => {
  const v = VIEWS[viewId];
  if (!v) return true;
  if (v.exactLevels && !v.exactLevels.includes(lvl)) return false;
  if (v.minLevel != null && !(lvl <= v.minLevel)) return false;
  let nav = v.navLevels;
  if (nav === null) return true;
  if (typeof nav === 'string' && nav.charAt(0) === '@') nav = VIEWS[nav.slice(1)] && VIEWS[nav.slice(1)].navLevels;
  if (Array.isArray(nav) && !nav.includes(lvl)) return false;
  return true;
};
// Mirror of _defaultViewFor (desktop branch — mobile only swaps calendar→home,
// which is navLevels:null = always allowed, so it never affects allow-ness).
const _defaultViewFor = (lvl) => (lvl === 15 ? 'stock_take' : (lvl >= 12 ? 'fude' : 'calendar'));

let pass = 0, fail = 0;
function eq(name, got, exp) { if (got === exp) pass++; else { fail++; console.error(`FAIL ${name}: got ${got} expected ${exp}`); } }

// 1. Every level's default landing view must be allowed for that level (else the
//    navigateTo bounce would loop / strand the user).
for (let lvl = 1; lvl <= 15; lvl++) eq(`default-allowed-L${lvl}`, _isViewAllowed(_defaultViewFor(lvl), lvl), true);

// 2. Sensitive views stay locked to their intended levels (deep-link bypass closed).
eq('purchases_history-L1',  _isViewAllowed('purchases_history', 1), true);
eq('purchases_history-L10', _isViewAllowed('purchases_history', 10), false);
eq('purchases_history-L2',  _isViewAllowed('purchases_history', 2), false);
eq('import-L2',             _isViewAllowed('import', 2), true);
eq('import-L10',            _isViewAllowed('import', 10), false);
eq('agents-L2',             _isViewAllowed('agents', 2), true);
eq('agents-L10',            _isViewAllowed('agents', 10), false);
eq('custom_fields-L2',      _isViewAllowed('custom_fields', 2), true);
eq('custom_fields-L10',     _isViewAllowed('custom_fields', 10), false);
eq('integrations-L1',       _isViewAllowed('integrations', 1), true);
eq('integrations-L2',       _isViewAllowed('integrations', 2), false); // minLevel:1
eq('protection-L4',         _isViewAllowed('protection', 4), true);
eq('protection-L5',         _isViewAllowed('protection', 5), false);
eq('boss_report-L2',        _isViewAllowed('boss_report', 2), false);  // exactLevels[1,2] but navLevels[1]
eq('stock_take-L15',        _isViewAllowed('stock_take', 15), true);

// 3. Operational views remain reachable by ordinary agents (no over-blocking).
eq('prospects-L10',         _isViewAllowed('prospects', 10), true);
eq('calendar-L10',          _isViewAllowed('calendar', 10), true);
eq('settings-L10',          _isViewAllowed('settings', 10), true);
eq('fude-L13',              _isViewAllowed('fude', 13), true);
eq('calendar-L13',          _isViewAllowed('calendar', 13), false);

console.log(`\nview-authz-test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
