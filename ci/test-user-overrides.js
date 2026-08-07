#!/usr/bin/env node
/**
 * ci/test-user-overrides.js — behavioural model of the per-user nav override
 * resolver (Admin → Access Control, 2026-08-07).
 *
 * Slices three regions of script.js and Function-evals them together:
 *   1. the VIEWS registry block (same slice as views-derive-check.js),
 *   2. the overrides module (pure fns + session state, up to the
 *      "Chunk-facing surface" Object.assign which needs window),
 *   3. the gate fns (_isViewAllowed / _defaultViewFor).
 *
 * Invariant #1 (the release gate): with EMPTY overrides, _isViewAllowed is
 * bit-for-bit the pre-feature algorithm (oracle reimplemented below) for
 * every view × level, and _applyNavOverrides is the identity on every
 * level's nav list.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const lines = src.split('\n');

function sliceBetween(startRe, endRe, label) {
  const start = lines.findIndex((l) => startRe.test(l));
  const end = lines.findIndex((l) => endRe.test(l));
  if (start < 0 || end < 0 || end <= start) throw new Error(`slice not found: ${label} (start=${start}, end=${end})`);
  return lines.slice(start, end).join('\n');
}

const blockViews = sliceBetween(/const _VIEW_NO_NAV\s*=/, /const _CHUNK_VIEWS\s*=\s*_deriveChunkViews\(\)/, 'VIEWS');
const blockOvr = sliceBetween(/── Per-user nav overrides/, /Chunk-facing surface/, 'overrides module');
const blockGates = sliceBetween(/^\s*const _isViewAllowed\s*=\s*\(viewId, lvl\)/, /^\s*const _VIEW_REFRESH\s*=\s*\{/, 'gates');

// isMobile/_getUserLevel are free vars of _defaultViewFor — injected stubs.
// _CHUNK_VIEWS is not needed by the sliced code (its decl line is excluded).
// eslint-disable-next-line no-new-func
const mk = new Function('isMobile', '_getUserLevel', `
  ${blockViews}
  ${blockOvr}
  ${blockGates}
  return {
    VIEWS, _VIEW_NO_NAV, _NAV_MOBILE_EXTRAS,
    _navOverridesApply, _navGrantableFrom, _navIdToViewId,
    _applyNavOverrides, _isViewAllowed, _defaultViewFor, _deriveLevelPermissions,
    setOvr: (g, r) => { _navOvr = { grants: new Set(g || []), revokes: new Set(r || []) }; },
  };
`);

let _mobile = false;
const env = mk(() => _mobile, (u) => (u && u.__lvl != null ? u.__lvl : 99));

// ── Oracle: the pre-feature _isViewAllowed, verbatim semantics ─────────────
const origIsViewAllowed = (viewId, lvl) => {
  const v = env.VIEWS[viewId];
  if (!v) return true;
  if (v.exactLevels && !v.exactLevels.includes(lvl)) return false;
  if (v.minLevel != null && !(lvl <= v.minLevel)) return false;
  let nav = v.navLevels;
  if (nav === env._VIEW_NO_NAV) return true;
  if (typeof nav === 'string' && nav.charAt(0) === '@') nav = env.VIEWS[nav.slice(1)] && env.VIEWS[nav.slice(1)].navLevels;
  if (Array.isArray(nav) && !nav.includes(lvl)) return false;
  return true;
};

let pass = 0, fail = 0;
const t = (name, cond) => {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL  ${name}`); }
};

// ── 1. Empty-override no-op invariant (every view × level 1..15 + 99) ──────
env.setOvr([], []);
const levels = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 99];
let mismatches = 0;
for (const viewId of Object.keys(env.VIEWS)) {
  for (const lvl of levels) {
    if (env._isViewAllowed(viewId, lvl) !== origIsViewAllowed(viewId, lvl)) {
      mismatches++;
      console.error(`   mismatch: _isViewAllowed('${viewId}', ${lvl})`);
    }
  }
}
t('empty overrides: _isViewAllowed === pre-feature algorithm (all views × levels)', mismatches === 0);

const perms = env._deriveLevelPermissions();
let identity = true;
for (const lvl of Object.keys(perms)) {
  const base = perms[lvl];
  const out = env._applyNavOverrides(base);
  if (JSON.stringify(out) !== JSON.stringify(base)) { identity = false; console.error(`   not identity at level ${lvl}`); }
}
t('empty overrides: _applyNavOverrides is the identity on every level list', identity);

// ── 2. Revoke hides everywhere ─────────────────────────────────────────────
env.setOvr([], ['pipeline']);
t('revoke pipeline: _isViewAllowed(pipeline, L5) === false', env._isViewAllowed('pipeline', 5) === false);
t('revoke pipeline: nav list excludes it', !env._applyNavOverrides(perms[5]).includes('pipeline'));
t('revoke pipeline: calendar untouched', env._isViewAllowed('calendar', 5) === true);

// ── 3. Grant widens band gates (reports 1-10 → L11, stock-take 1+15 → L7) ──
env.setOvr(['reports'], []);
t('grant reports: L11 allowed', env._isViewAllowed('reports', 11) === true);
t('grant reports: L11 nav list gains it at the end', (() => {
  const out = env._applyNavOverrides(perms[11]);
  return out[out.length - 1] === 'reports';
})());
t('grant reports: L13 allowed too (boss ticked it — data stays RLS-scoped)', env._isViewAllowed('reports', 13) === true);
// stock-take is DENY-LISTED (its render path hard-gates L1/L15 — a grant
// would be a visible-but-dead tab, 2026-08-07 review finding):
env.setOvr(['stock-take'], []);
t('grant stock-take: still denied for L7 (deny-listed, dead-tab guard)', env._isViewAllowed('stock_take', 7) === false);
t('grant stock-take: never enters the nav list', !env._applyNavOverrides(perms[7]).includes('stock-take'));

// ── 4. Locked (admin band) ids can never be granted — incl. tampered rows ──
env.setOvr(['admin', 'security', 'boss-report', 'egg-purchasing', 'formula-purchaser', 'org-chart', 'integrations', 'marketing-automation', 'workflows', 'quarter-review'], []);
t('grant admin: L5 still denied', env._isViewAllowed('admin', 5) === false);
t('grant security: L5 still denied', env._isViewAllowed('security', 5) === false);
t('grant boss-report: L5 still denied', env._isViewAllowed('boss_report', 5) === false);
t('grant egg-purchasing: L5 still denied', env._isViewAllowed('egg_purchasing', 5) === false);
t('grant integrations (minLevel 1): L5 still denied', env._isViewAllowed('integrations', 5) === false);
t('tampered grants never reach the nav list', (() => {
  const out = env._applyNavOverrides(perms[5]);
  return !out.includes('admin') && !out.includes('security') && !out.includes('boss-report') && !out.includes('egg-purchasing');
})());

// ── 5. Revoke wins over grant ──────────────────────────────────────────────
env.setOvr(['reports'], ['reports']);
t('grant+revoke same id: revoke wins (L11 denied)', env._isViewAllowed('reports', 11) === false);

// ── 6. _VIEW_NO_NAV programmatic sub-views are immune to overrides ─────────
env.setOvr([], ['calendar', 'prospects', 'fude']);
t('NO_NAV home unaffected by revokes', env._isViewAllowed('home', 5) === true);
t('NO_NAV customers unaffected by revokes', env._isViewAllowed('customers', 5) === true);
t('NO_NAV search unaffected by revokes', env._isViewAllowed('search', 5) === true);
env.setOvr(['ranking'], []);
t('NO_NAV ranking still exactLevels-gated despite grant attempt', env._isViewAllowed('ranking', 7) === false);

// ── 7. navId mapping: revoking a navId blocks every view behind it ─────────
env.setOvr([], ['calendar']);
t("revoke navId 'calendar' blocks view 'calendar'", env._isViewAllowed('calendar', 5) === false);
t("revoke navId 'calendar' blocks alias view 'month' (@calendar)", env._isViewAllowed('month', 5) === false);

// ── 8. _defaultViewFor: revoked landing bounces, never loops ───────────────
_mobile = false;
env.setOvr([], ['calendar']);
t('L5 desktop with calendar revoked lands on next allowed (fude)', env._defaultViewFor({ __lvl: 5 }) === 'fude');
env.setOvr([], ['calendar', 'fude', 'prospects', 'referrals', 'pipeline', 'promotions', 'cases', 'milestones', 'reports']);
t('L5 with EVERYTHING revoked falls back to role default (no loop, no crash)', env._defaultViewFor({ __lvl: 5 }) === 'calendar');
_mobile = true;
t('L5 mobile keeps home (NO_NAV) even with revokes', env._defaultViewFor({ __lvl: 5 }) === 'home');
_mobile = false;
env.setOvr([], ['stock-take']);
t('L15 with stock-take revoked still returns stock_take (fallback, no crash)', env._defaultViewFor({ __lvl: 15 }) === 'stock_take');
env.setOvr([], []);
t('L13 default fude unaffected', env._defaultViewFor({ __lvl: 13 }) === 'fude');

// ── 9. Grantable set sanity ────────────────────────────────────────────────
const grantable = env._navGrantableFrom(env.VIEWS);
const mustLock = ['admin', 'security', 'boss-report', 'quarter-review', 'egg-purchasing', 'formula-purchaser', 'org-chart', 'marketing-automation', 'marketing-lists', 'workflows', 'ai-insights', 'integrations', 'stock-take'];
const mustAllow = ['calendar', 'prospects', 'referrals', 'pipeline', 'promotions', 'cases', 'reports', 'documents', 'knowledge', 'settings', 'performance', 'milestones', 'fude', 'noticeboard'];
t('locked set: none of the admin-band navIds are grantable', mustLock.every((id) => !grantable.has(id)));
t('grantable set: the working set is grantable', mustAllow.every((id) => grantable.has(id)));
t("extra-nav ids (risk/standard-functions) are not grantable (not in VIEWS)", !grantable.has('risk') && !grantable.has('standard-functions'));

// ── 10. Editor baseline union: mobile-only 'settings' for the agent band ───
t('_NAV_MOBILE_EXTRAS covers exactly L5-11 with settings', (() => {
  const keys = Object.keys(env._NAV_MOBILE_EXTRAS).map(Number).sort((a, b) => a - b);
  return JSON.stringify(keys) === JSON.stringify([5, 6, 7, 8, 9, 10, 11])
    && keys.every((k) => JSON.stringify(env._NAV_MOBILE_EXTRAS[k]) === JSON.stringify(['settings']));
})());
t("desktop L5 derivation still has NO settings (sidebar unchanged)", !perms[5].includes('settings'));

// ── 11. navId → viewId picks a renderable view ─────────────────────────────
t("_navIdToViewId('calendar') === 'calendar' (not the NO_NAV month alias)", env._navIdToViewId('calendar') === 'calendar');
t("_navIdToViewId('reports') === 'reports'", env._navIdToViewId('reports') === 'reports');
t("_navIdToViewId('ranking') is null (NO_NAV only)", env._navIdToViewId('ranking') === null);

console.log(`\ntest-user-overrides: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
