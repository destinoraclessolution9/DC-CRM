#!/usr/bin/env node
/**
 * ci/guard-tripwires.js — assert the 2026-07-13/15 reliability guards still exist.
 *
 * The "calendar marathon" (see migrations/rls_helper_gaps_2026-07-14.sql and
 * the triage section of .claude/CLAUDE.md) shipped a set of small, easy-to-
 * lose guards across script.js / data.js / chunks. Each one below fixed a
 * REAL production incident; deleting any of them reintroduces a silent
 * failure mode (empty views, dead taps, frozen renders, poisoned caches).
 *
 * This check greps the UN-MINIFIED sources for a distinctive marker of each
 * guard and fails the gate if one vanished. If you refactor a guard, keep a
 * marker-equivalent (or update the entry here IN THE SAME COMMIT, with a
 * comment explaining how the new code covers the same incident).
 *
 * Usage: node ci/guard-tripwires.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// [file, marker, incident it prevents]
const TRIPWIRES = [
  // ── Dead-session detection & recovery (2026-07-13) ──
  ['script.js', 'serverConfirmed',
    'zombie sessions: probes may act on offline-resume users only with server-confirmed proof'],
  ['script.js', 'probeReachability',
    'mobile dead-session detection self-earns server proof via /auth/v1/health'],
  ['script.js', 'routing to login instead of offline resume',
    'boot reachability gate: dead session + reachable server → login screen, not zombie shell'],
  ['script.js', 'getSession timed out — resuming from cache',
    'boot gate must NOT wipe a session when getSession null came from our own timeout'],
  ['script.js', "localStorage.removeItem('remember_me')",
    "'Sign in again' must clear the dead session or the prompt loops forever"],
  ['script.js', 'auth_user_id backfill failed',
    'login/restore self-heal the users.auth_user_id link (RLS maps sessions through it)'],
  ['script.js', '_cache_purge_2026_07_13',
    'one-shot purge pattern for stranded PWA containers (keep as reference implementation)'],

  // ── Cache-poison prevention (2026-07-13/14) ──
  ['data.js', '_degraded',
    'client-side fallback results are flagged so callers never persist them'],
  ['data.js', 'no live auth session',
    'queryAdvanced dead-session local throw (feeds the cached-fallback + probe paths)'],
  ['chunks/script-mobile.js', '_mcalTrust',
    'mobile month caches persist only live, non-degraded fetches'],
  ['chunks/script-mobile.js', 'fresh.length > 0',
    'never cache an empty people list (hid birthdays/names for the 8h TTL)'],

  // ── Silent-failure visibility (2026-07-13/15) ──
  ['chunks/script-mobile.js', 'mcal-last-error',
    'crash/tap/timeout breadcrumbs surfaced on /diag'],
  ['chunks/script-mobile.js', 'mcal-hang-stage',
    'freeze-detector stage stamps (main-thread hangs leave no other trace)'],
  ['chunks/script-mobile.js', 'clearTimeout(t)',
    'race timers are cancelled on settle — bare Promise.race wrote FALSE timeout breadcrumbs'],
  ['chunks/script-mobile.js', 'slow-storage',
    'storage-latency probe (WebKit localStorage stalls are the leading freeze theory)'],
  ['chunks/script-mobile.js', 'ZERO synchronous localStorage before first paint',
    'calendar paint path must not sync-read localStorage (iOS main-thread block = the 07-13..15 freeze)'],
  ['chunks/script-mobile.js', '_mcalDeferEvict',
    'TTL eviction must be deferred, never a synchronous removeItem on the render path (WebKit flush = the ~10min freeze)'],
  ['chunks/script-mobile.js', '_mcalPruneStoreOnce',
    'session store-shrinker: reclaims the mobile cache cluster data.js never prunes, keeping the store small enough that sync ops stay fast'],
  ['chunks/script-calendar.js', 'calendar_rpc_denied',
    'desktop 42501-with-dead-token routes to the session flow instead of stranding skeletons'],

  // ── Diagnostics surface ──
  ['diag.html', 'crm_error_log',
    '/diag shows the global error journal (only console access on iOS standalone)'],
  ['index.html', '/diag.html',
    'drawer 🩺 link — standalone PWAs have no URL bar to reach diagnostics'],
];

let fails = 0;
const cache = new Map();
const read = (rel) => {
  if (!cache.has(rel)) {
    try { cache.set(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
    catch { cache.set(rel, null); }
  }
  return cache.get(rel);
};

for (const [rel, marker, why] of TRIPWIRES) {
  const src = read(rel);
  if (src === null) {
    console.error(`  FAIL  ${rel} unreadable (guard: ${why})`);
    fails++;
    continue;
  }
  if (!src.includes(marker)) {
    console.error(`  FAIL  ${rel} lost guard marker "${marker}"\n        → ${why}`);
    fails++;
  }
}

if (fails === 0) {
  console.log(`  PASS  all ${TRIPWIRES.length} reliability guards present`);
  process.exit(0);
}
console.error(`\n${fails} guard(s) missing — these each fixed a real production incident.`);
console.error('If a refactor legitimately replaced one, update ci/guard-tripwires.js in the same commit.');
process.exit(1);
