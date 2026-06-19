// ci/test-authz-roles.js — characterization tests for the role/authz kernel.
//
// WHY: `_getUserLevel` + its predicates are the authz source of truth, locked
// inside the script.js IIFE. A prior refactor that "folded inline /Level/ parses"
// silently changed authz for named/Chinese role classes and had to be reverted
// (memory: feedback_role_parse_authz_trap). These tests PIN the current behavior
// across every role class so any future change to the resolver fails the gate.
//
// HARNESS: we slice the real source block (by stable markers) and eval it as-is
// in a stubbed scope — NO refactor, NO duplicate implementation. If the markers
// drift, extraction fails loudly (factory throws) → update this test deliberately.
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

const START = 'const _getUserLevel = (user) =>';
const END_MARKER =
  'const isReferrerOrCustomer = (user) => { const l = _getUserLevel(user); return l >= 13 && l <= 14; };';

const start = src.indexOf(START);
const endIdx = src.indexOf(END_MARKER);
if (start === -1 || endIdx === -1) {
  console.error('FAIL extraction: role-kernel markers not found in script.js — update test-authz-roles.js markers.');
  process.exit(1);
}
const block = src.slice(start, endIdx + END_MARKER.length);

// Eval the real source in a scope that stubs the only external it touches
// (window._crmUtils, mutated by the interspersed Object.assign calls).
let R;
try {
  // eslint-disable-next-line no-new-func
  const factory = new Function(`
    const window = { _crmUtils: {} };
    ${block}
    return { _getUserLevel, isSystemAdmin, isMarketingManager, isStockTakeStaff,
             canAccessStockTake, isAgent, isManagement, isTeamLeaderOrAbove,
             isAgentOrLeader, isCustomer, isReferrer, isReferrerOrCustomer };
  `);
  R = factory();
} catch (e) {
  console.error('FAIL eval of sliced role-kernel: ' + e.message);
  process.exit(1);
}

let pass = 0, fail = 0;
function eq(name, got, exp) {
  if (got === exp) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} expected ${JSON.stringify(exp)}`); }
}
const u = (role) => ({ role });

// ── _getUserLevel: missing / empty → 99 (lowest) ──────────────────────────
eq('null-user',        R._getUserLevel(null), 99);
eq('undefined-user',   R._getUserLevel(undefined), 99);
eq('no-role',          R._getUserLevel({}), 99);
eq('role-null',        R._getUserLevel(u(null)), 99);
eq('role-empty',       R._getUserLevel(u('')), 99);

// ── "Level N" form (case-insensitive, word-boundary) ──────────────────────
eq('level-1',          R._getUserLevel(u('Level 1 Super Admin')), 1);
eq('level-2',          R._getUserLevel(u('Level 2 Marketing Manager')), 2);
eq('level-5-lower',    R._getUserLevel(u('level 5 team leader')), 5);
eq('level-7-senior',   R._getUserLevel(u('Level 7 Senior')), 7);
eq('level-12',         R._getUserLevel(u('Level 12 传福大使')), 12);
eq('level-13',         R._getUserLevel(u('Level 13 Customer')), 13);
eq('level-14',         R._getUserLevel(u('Level 14 Referrer')), 14);
eq('level-15',         R._getUserLevel(u('Level 15 Stock Take')), 15);
// THE TRAP: 'Level 10' must resolve to 10, never 1 (word boundary).
eq('level-10-trap',    R._getUserLevel(u('Level 10 Agent')), 10);
eq('level-11-trap',    R._getUserLevel(u('Level 11 Agent')), 11);
// No space after "Level" → regex needs \s+ → falls through to named → 99.
eq('level-nospace',    R._getUserLevel(u('Level5')), 99);

// ── Legacy named English roles ────────────────────────────────────────────
eq('named-super_admin', R._getUserLevel(u('super_admin')), 1);
eq('named-admin',       R._getUserLevel(u('admin')), 1);
eq('named-mkt-mgr',     R._getUserLevel(u('marketing_manager')), 2);
eq('named-manager',     R._getUserLevel(u('manager')), 4);
eq('named-team_leader', R._getUserLevel(u('team_leader')), 5);
eq('named-consultant',  R._getUserLevel(u('consultant')), 7);
eq('named-agent',       R._getUserLevel(u('agent')), 10);
eq('named-stock1',      R._getUserLevel(u('stock_take_staff')), 15);
eq('named-stock2',      R._getUserLevel(u('stock_take')), 15);
eq('named-customer',    R._getUserLevel(u('customer')), 13);
eq('named-referrer',    R._getUserLevel(u('referrer')), 14);
eq('named-unknown',     R._getUserLevel(u('foobar')), 99);

// ── Chinese-only role names (no "Level X" prefix) ─────────────────────────
eq('cn-ambassador',     R._getUserLevel(u('传福大使')), 12);
eq('cn-customer',       R._getUserLevel(u('改命客户')), 13);
eq('cn-pre-ambassador', R._getUserLevel(u('准传福大使')), 14);

// ── Predicates: the authz decisions that ride on the resolver ─────────────
eq('admin-L1',          R.isSystemAdmin(u('Level 1 Super Admin')), true);
eq('admin-named',       R.isSystemAdmin(u('admin')), true);
// Regression guard for the reverted bug: L10 is NOT a system admin.
eq('admin-not-L10',     R.isSystemAdmin(u('Level 10 Agent')), false);
eq('mktmgr-L2',         R.isMarketingManager(u('Level 2 X')), true);
eq('mktmgr-not-L1',     R.isMarketingManager(u('Level 1 X')), false);

eq('agent-L3',          R.isAgent(u('Level 3 X')), true);
eq('agent-L10',         R.isAgent(u('Level 10 Agent')), true);
eq('agent-L12',         R.isAgent(u('Level 12 X')), true);
eq('agent-not-L2',      R.isAgent(u('Level 2 X')), false);
eq('agent-not-L13',     R.isAgent(u('Level 13 X')), false);

eq('mgmt-L1',           R.isManagement(u('Level 1 X')), true);
eq('mgmt-L3',           R.isManagement(u('Level 3 X')), true);
eq('mgmt-L4',           R.isManagement(u('Level 4 X')), true);   // owner-confirmed 2026-06-19: L4 Manager is management
eq('mgmt-not-L5',       R.isManagement(u('Level 5 X')), false);  // Team Leader (L5) is NOT management (isTeamLeaderOrAbove only)

eq('tl-L5',             R.isTeamLeaderOrAbove(u('Level 5 X')), true);
eq('tl-not-L6',         R.isTeamLeaderOrAbove(u('Level 6 X')), false);

eq('stock-L15',         R.isStockTakeStaff(u('Level 15 X')), true);
eq('stock-not-L1',      R.isStockTakeStaff(u('Level 1 X')), false);
eq('canstock-admin',    R.canAccessStockTake(u('admin')), true);
eq('canstock-L15',      R.canAccessStockTake(u('Level 15 X')), true);
eq('canstock-not-agent',R.canAccessStockTake(u('Level 10 Agent')), false);

eq('cust-L13',          R.isCustomer(u('Level 13 X')), true);
eq('ref-L14',           R.isReferrer(u('Level 14 X')), true);
eq('refcust-L13',       R.isReferrerOrCustomer(u('Level 13 X')), true);
eq('refcust-L14',       R.isReferrerOrCustomer(u('Level 14 X')), true);
eq('refcust-not-L12',   R.isReferrerOrCustomer(u('Level 12 X')), false);
eq('refcust-not-L15',   R.isReferrerOrCustomer(u('Level 15 X')), false);

// isAgentOrLeader: agent band OR explicit team_leader string OR includes('Level 7')
eq('aol-agent',         R.isAgentOrLeader(u('Level 10 Agent')), true);
eq('aol-team_leader',   R.isAgentOrLeader(u('team_leader')), true);
eq('aol-level7-string', R.isAgentOrLeader(u('Level 7 Senior')), true);
eq('aol-not-admin',     R.isAgentOrLeader(u('Level 1 Super Admin')), false);
eq('aol-not-customer',  R.isAgentOrLeader(u('Level 13 Customer')), false);

console.log(`\nauthz-roles-test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
