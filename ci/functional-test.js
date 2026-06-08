/* ═══════════════════════════════════════════════════════════════════════════
   CRM Functional Test Harness  v1.0
   ───────────────────────────────────────────────────────────────────────────
   HOW TO USE:
     1. Start dev server:  python -m http.server 8082
     2. Open http://localhost:8082 and log in as Super Admin (Level 1)
     3. Open DevTools → Console (F12 → Console tab)
     4. Paste this ENTIRE file into the console and press Enter
     5. Watch the right-side panel  (~4–6 min for full suite)
     6. Click "Copy Report" at the end to export JSON

   WHAT IT TESTS:
     Phase 1 — Function Registry:  every expected app.fn() exists and isn't a stub
     Phase 2 — View Navigation:    all 40 views render without silent failures
     Phase 3 — Post-Chunk Audit:   re-checks functions after chunks lazy-loaded
     Phase 4 — Modal Open Tests:   key modal openers produce a visible modal
   ═══════════════════════════════════════════════════════════════════════════ */

(async function __CRM_FUNCTIONAL_TEST__() {
'use strict';

// ── Config ───────────────────────────────────────────────────────────────────
const CFG = {
  VIEW_TIMEOUT:  4000,   // ms to wait for view content after navigateTo()
  MODAL_TIMEOUT: 2000,   // ms to wait for a modal to appear
  BETWEEN_MS:     350,   // pause between tests so the app can breathe
  CONTENT_SEL:  '#content-viewport',  // the main <main> tag that gets swapped
};

// ── Expected app.fn() names (must exist in window.app after all chunks load) ─
const EXPECTED_FNS = [
  // Core
  'navigateTo','logout','init','isMobile','getCurrentUserId',
  'toggleMobileNav','closeMobileDrawer','openMobileDrawer',
  // Prospects
  'showProspectsView','showProspectsViewSmart','showProspectDetail',
  'openAddProspectModal','saveProspect','editProspect','deleteProspect',
  'filterProspects','convertToCustomer','downloadProspectVCard',
  'setProspectGrade','bulkDeleteProspects','bulkReassignProspects',
  'transferProspect','reassignProspect','quickReassign','openReviveProspectModal',
  // Customers
  'showCustomersView','showCustomerDetail','openAddCustomerModal','saveCustomer',
  'filterCustomers','openCustomerReferralModal','saveCustomerReferral',
  'openEditPlatformIdsModal','savePlatformIds','updatePurchaseDelivery',
  // Agents
  'showAgentsView','showAgentProfile','openAddAgentModal','openEditAgentModal',
  'saveAgent','generatePassword','deleteAgent','deactivateAgent','renewLicense',
  // Pipeline
  'showPipelineView','refreshPipeline','setPipelineFilter','addToFocusList',
  'handleDragStart','handleDrop','saveManualOrder','savePipelineConfig',
  // Activities / Calendar
  'openActivityModal','openPostMeetupNotesModal','savePostMeetupNotes',
  'openAttendeeOutcomeModal','openAttendeeNotesModal',
  // Journey
  'renderJourneyTab','markJourneyTouchpointDone','skipJourneyTouchpoint',
  'snoozeJourneyTouchpoint','sendJourneyWhatsApp','switchJourneyTrack',
  'openSpawnTouchpointsModal','showAgentJourneyDashboard',
  // Import / Protection
  'showImportDashboard','openImportWizard','startImport','showImportHistory',
  'showProtectionMonitoringView','renderTeamSummaryCards',
  // Admin / Security
  'showSecurityDashboard','showAuditLogs','showComplianceCenter',
  'showAdminDashboard','showTwoFactorSetup','verifyAndEnable2FA',
  // Forms / CPS
  'openCustomerSurveyModal','saveCustomerSurvey','openCpsAnalysisModal',
  'openApuAppraisalModal','openDestinyBlueprintModal','saveDestinyBlueprint',
  'renderFormsTab','cfSearchProspects',
  // Booking
  'showBookingSettingsView','openAddSlotModal','saveBookingSlot',
  'toggleSlotActive','renderPendingCpsIntakes','scanCpsForm','parseCpsPastedText',
  // Marketing
  'editTemplate','editCampaign','openCreateTemplateModal','openCreateCampaignModal',
  // Search
  'toggleSearchPanel','showSearchPanel','hideSearchPanel','executeSearch',
  'clearAllFilters','addConditionGroup','removeCondition','updateConditionField',
  'openSaveSearchModal','loadSavedSearch','deleteSavedSearch','loadPreset',
  // Milestones / Fude
  'showMilestonesView','showFudeView','markMilestoneCompleted',
  'openHighlightModal','saveHighlight','deleteHighlight','syncFudiSummary',
  'openRewardModal','saveReward',
  // Performance / Scoring
  'addScoreToProspect','addScoreToCustomer','applyActivityScoring',
  'openScoreAdjustmentModal','calculateCustomerHealthScore','renderHealthBadge',
  'sendBirthdayWish','scheduleBirthdayFollowup','openKPITargetsModal','saveKPITargets',
  // AI
  'initAIAnalytics','ensureAIModelsExist',
  // WhatsApp
  'initWhatsAppIntegration','addWhatsAppButtonToProfile',
  // Offline
  'initOfflineSupport','addToOfflineQueue','processOfflineQueue',
  'offlineCreate','offlineUpdate',
];

// ── All views to navigate (view key → chunk name for reporting) ───────────────
const ALL_VIEWS = [
  { view:'home',                chunk:'script-mobile'             },
  { view:'calendar',            chunk:'script-calendar'           },
  { view:'month',               chunk:'script-calendar'           },
  { view:'prospects',           chunk:'script-prospects'          },
  { view:'customers',           chunk:'script-prospects'          },
  { view:'agents',              chunk:'script-prospects'          },
  { view:'purchases_history',   chunk:'script-prospects'          },
  { view:'pipeline',            chunk:'script-pipeline'           },
  { view:'lead_forms',          chunk:'script-forms'              },
  { view:'surveys',             chunk:'script-forms'              },
  { view:'contracts',           chunk:'script-forms'              },
  { view:'custom_fields',       chunk:'script-forms'              },
  { view:'booking_settings',    chunk:'script-cps'                },
  { view:'cps_intake',          chunk:'script-cps'                },
  { view:'search',              chunk:'script-search'             },
  { view:'import',              chunk:'script-import'             },
  { view:'protection',          chunk:'script-import'             },
  { view:'milestones',          chunk:'script-features2'          },
  { view:'fude',                chunk:'script-fude'               },
  { view:'knowledge',           chunk:'script-knowledge'          },
  { view:'cases',               chunk:'script-cases'              },
  { view:'referrals',           chunk:'script-referrals'          },
  { view:'ranking',             chunk:'script-performance'        },
  { view:'performance',         chunk:'script-performance'        },
  { view:'noticeboard',         chunk:'script-performance'        },
  { view:'marketing_automation',chunk:'script-marketing'          },
  { view:'marketing_lists',     chunk:'script-marketing'          },
  { view:'workflows',           chunk:'script-marketing'          },
  { view:'reports',             chunk:'script-reporting'          },
  { view:'documents',           chunk:'script-documents'          },
  { view:'order_form_extract',  chunk:'script-order-form-extract' },
  { view:'journey',             chunk:'script-journey'            },
  { view:'whatsapp',            chunk:'script-whatsapp'           },
  { view:'ai_insights',         chunk:'script-ai'                 },
  { view:'integrations',        chunk:'script-gcal'               },
  // Admin-only views (Level 1 required)
  { view:'admin',               chunk:'script-admin'              },
  { view:'security',            chunk:'script-admin'              },
  { view:'org_chart',           chunk:'script-org'                },
  { view:'boss_report',         chunk:'script-boss-report'        },
  { view:'stock_take',          chunk:'script-stock-take'         },
];

// ── Modal open tests (view-agnostic, non-destructive) ─────────────────────────
const MODAL_TESTS = [
  { name:'Add Prospect',    nav:'prospects',  fn: () => window.app.openAddProspectModal?.()   },
  { name:'Add Customer',    nav:'customers',  fn: () => window.app.openAddCustomerModal?.()   },
  { name:'Add Agent',       nav:'agents',     fn: () => window.app.openAddAgentModal?.()      },
  { name:'Search Panel',    nav:null,         fn: () => window.app.showSearchPanel?.()         },
  { name:'Create Template', nav:'marketing_automation', fn: () => window.app.openCreateTemplateModal?.() },
  { name:'Create Campaign', nav:'marketing_automation', fn: () => window.app.openCreateCampaignModal?.() },
  { name:'KPI Targets',     nav:'performance',fn: () => window.app.openKPITargetsModal?.()    },
  { name:'Add Slot',        nav:'booking_settings', fn: () => window.app.openAddSlotModal?.() },
];

// ─────────────────────────────────────────────────────────────────────────────
// UI — Overlay panel (right edge)
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('__CRM_TEST__')?.remove();

const overlay = document.createElement('div');
overlay.id = '__CRM_TEST__';
overlay.innerHTML = `
<div style="position:fixed;top:0;right:0;width:440px;height:100vh;
  background:#08101e;color:#cbd5e1;font:11px/1.75 'Courier New',monospace;
  z-index:2147483647;display:flex;flex-direction:column;
  border-left:3px solid #1d4ed8;box-shadow:-8px 0 32px #000000bb;
  user-select:text">

  <!-- Header -->
  <div style="background:#1e3a8a;padding:10px 16px;display:flex;
    justify-content:space-between;align-items:center;flex-shrink:0;
    border-bottom:1px solid #2563eb">
    <div style="font:bold 13px monospace;color:#93c5fd">🧪 CRM Functional Test</div>
    <div style="display:flex;gap:8px;align-items:center">
      <code id="__t_status" style="font-size:10px;color:#475569;background:#0f172a;
        padding:2px 6px;border-radius:3px">Starting…</code>
      <button id="__t_copy" style="background:#2563eb;border:none;color:#bfdbfe;
        padding:3px 10px;border-radius:4px;cursor:pointer;font:10px monospace">
        📋 Copy Report</button>
      <button onclick="document.getElementById('__CRM_TEST__').remove()"
        style="background:none;border:none;color:#f87171;cursor:pointer;
        font-size:22px;line-height:1;padding:0 2px">×</button>
    </div>
  </div>

  <!-- Stats bar -->
  <div style="background:#0f172a;padding:5px 16px;display:flex;gap:20px;
    flex-shrink:0;border-bottom:1px solid #1e3a5f;font-size:10px">
    <span id="__t_p" style="color:#22c55e">✅ 0</span>
    <span id="__t_f" style="color:#ef4444">❌ 0</span>
    <span id="__t_w" style="color:#f59e0b">⚠️ 0</span>
    <span id="__t_m" style="color:#818cf8">🔍 0 missing</span>
    <span id="__t_e" style="color:#f97316">🐛 0 errors</span>
  </div>

  <!-- Log area -->
  <div id="__t_log" style="flex:1;overflow-y:auto;padding:8px 16px;
    scrollbar-color:#1e3a5f #08101e"></div>
</div>`;
document.body.appendChild(overlay);

const LOG   = document.getElementById('__t_log');
const tStat = document.getElementById('__t_status');
const tP    = document.getElementById('__t_p');
const tF    = document.getElementById('__t_f');
const tW    = document.getElementById('__t_w');
const tM    = document.getElementById('__t_m');
const tE    = document.getElementById('__t_e');

const R = { pass:[], fail:[], warn:[], miss:[], errs:[] };

function stats() {
  tP.textContent = `✅ ${R.pass.length}`;
  tF.textContent = `❌ ${R.fail.length}`;
  tW.textContent = `⚠️ ${R.warn.length}`;
  tM.textContent = `🔍 ${R.miss.length} missing`;
  tE.textContent = `🐛 ${R.errs.length} errors`;
}

function log(msg, type = 'info') {
  const COLOR = { pass:'#22c55e', fail:'#f87171', warn:'#fbbf24',
                  info:'#475569', section:'#60a5fa', dim:'#1e3a5f' };
  const ICON  = { pass:'✅', fail:'❌', warn:'⚠️', info:'·', section:'━', dim:'' };
  const el = document.createElement('div');
  const c = COLOR[type] || COLOR.info;
  const bold = (type === 'fail' || type === 'section') ? 'font-weight:bold;' : '';
  el.style.cssText = `color:${c};${bold}white-space:pre-wrap;word-break:break-all;padding:1px 0`;
  el.textContent = `${ICON[type]||'›'} ${msg}`;
  LOG.appendChild(el);
  LOG.scrollTop = LOG.scrollHeight;
}

function section(title) {
  const el = document.createElement('div');
  el.style.cssText = 'color:#3b82f6;font-weight:bold;padding:8px 0 3px;' +
                     'border-top:1px solid #1e3a5f;margin-top:8px';
  el.textContent = `━━ ${title} ━━`;
  LOG.appendChild(el);
  LOG.scrollTop = LOG.scrollHeight;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Error / chunk-fail capture ────────────────────────────────────────────────
const _origCE = console.error.bind(console);
console.error = (...a) => { R.errs.push('[CE] ' + a.join(' ')); _origCE(...a); };
window.addEventListener('error',
  e => R.errs.push(`[JS] ${e.message} @ ${(e.filename||'').split('/').pop()}:${e.lineno}`));
window.addEventListener('unhandledrejection',
  e => R.errs.push(`[P]  ${String(e.reason).slice(0, 200)}`));

// Intercept dynamic script appends to detect chunk load failures
const _origAC = Element.prototype.appendChild;
Element.prototype.appendChild = function(node) {
  if (node?.tagName === 'SCRIPT' && node.src && node.src.includes('chunks/')) {
    const short = node.src.split('/').pop();
    node.addEventListener('error', () => {
      R.errs.push(`[CHUNK LOAD FAIL] ${short}`);
      log(`Chunk failed to load: ${short}`, 'fail');
      R.fail.push(`chunk-load:${short}`);
      stats();
    });
  }
  return _origAC.call(this, node);
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function watchContent(el, ms) {
  return new Promise(resolve => {
    let n = 0;
    const obs = new MutationObserver(m => { n += m.length; });
    obs.observe(el, { childList:true, subtree:true, attributes:true, characterData:true });
    setTimeout(() => { obs.disconnect(); resolve(n); }, ms);
  });
}

function rateContent(el) {
  const text = (el.innerText || '').trim();
  if (text.length < 20)  return 'EMPTY';
  const bad = ['typeerror','cannot read','is not a function','is not defined',
               'failed to fetch','null is not','undefined is not'];
  if (bad.some(w => text.toLowerCase().includes(w))) return 'ERROR_TEXT';
  // Check for an unresolved spinner as the only content
  const spinner = el.querySelector('[class*="spin"],[class*="load"],.skeleton');
  if (spinner && text.length < 60) return 'SPINNER_STUCK';
  return 'OK';
}

function detectModal() {
  const sel = [
    '.modal:not([style*="display: none"]):not([style*="display:none"])',
    '[role="dialog"]',
    '.modal-overlay.active',
    '.modal-container',
    '#modal-overlay',
    '.sheet-panel',
    '.drawer',
  ].join(',');
  const el = document.querySelector(sel);
  return el && (el.innerText || '').trim().length > 10 ? el : null;
}

function closeModal() {
  document.querySelectorAll('.modal-close,[data-dismiss],[aria-label="Close"]')
    .forEach(b => { try { b.click(); } catch(_){} });
  const bg = document.querySelector('.modal-backdrop,.modal-overlay,.overlay-bg');
  if (bg) { try { bg.click(); } catch(_){} }
  document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
}

// ── Guard: window.app must exist ─────────────────────────────────────────────
await sleep(500);
const app = window.app;
if (!app) {
  log('window.app is UNDEFINED — please log in first, then re-run.', 'fail');
  return;
}
tStat.textContent = 'Running…';
log(`window.app found  (${Object.keys(app).length} exported keys)`, 'pass');
R.pass.push('app-exists');

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — Function Registry (pre-chunk-load snapshot)
// ─────────────────────────────────────────────────────────────────────────────
section('PHASE 1 · Function Registry  (pre-chunk)');

function auditFunctions(label) {
  let missing = [], stubs = [], present = 0;
  for (const fn of EXPECTED_FNS) {
    const v = app[fn];
    if (v === undefined || v === null) {
      missing.push(fn);
    } else if (typeof v !== 'function') {
      log(`NOT_FUNC  app.${fn}  (${typeof v})`, 'warn');
      R.warn.push(`${label}:not-fn:${fn}`);
    } else {
      const src = v.toString();
      if (src.includes("todo('") || src.includes('todo("') || src.includes('todo(`')) {
        stubs.push(fn);
      } else {
        present++;
      }
    }
  }
  return { missing, stubs, present };
}

const pre = auditFunctions('pre');
pre.missing.forEach(fn => { log(`MISSING   app.${fn}`, 'fail'); R.miss.push(fn); R.fail.push(`fn:${fn}`); });
pre.stubs.forEach(fn  => { log(`STUB      app.${fn}  → todo() placeholder`, 'warn'); R.warn.push(`stub:${fn}`); });
log(`${pre.present}/${EXPECTED_FNS.length} present  |  ${pre.missing.length} missing  |  ${pre.stubs.length} stubs`,
    pre.missing.length ? 'warn' : 'pass');
if (pre.present === EXPECTED_FNS.length) R.pass.push('registry-pre:all-present');
stats();

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — View Navigation  (lazy chunks load here)
// ─────────────────────────────────────────────────────────────────────────────
const viewEst = Math.ceil(ALL_VIEWS.length * (CFG.VIEW_TIMEOUT + CFG.BETWEEN_MS) / 60000);
section(`PHASE 2 · View Navigation  (${ALL_VIEWS.length} views, ~${viewEst} min)`);

if (typeof app.navigateTo !== 'function') {
  log('app.navigateTo missing — skipping all view tests', 'fail');
  R.fail.push('no-navigateTo');
} else {
  const contentEl = document.querySelector(CFG.CONTENT_SEL) || document.body;
  log(`Content container: ${CFG.CONTENT_SEL}  (${contentEl.id || contentEl.className})`, 'dim');

  // Warm up: go home first so the skeleton grid clears
  app.navigateTo('home');
  await sleep(1800);

  for (const { view, chunk } of ALL_VIEWS) {
    tStat.textContent = view;
    const errsBefore = R.errs.length;

    const watching = watchContent(contentEl, CFG.VIEW_TIMEOUT);
    let navErr = null;
    try {
      app.navigateTo(view);
    } catch(e) {
      navErr = e.message;
    }
    const mutations = await watching;
    const newErrs   = R.errs.slice(errsBefore);

    const label = view.padEnd(26);

    if (navErr) {
      log(`${label} ❌ navigateTo() threw: ${navErr}`, 'fail');
      R.fail.push(`view:${view}:nav-threw`);
    } else if (mutations === 0) {
      log(`${label} ⚠️ NO DOM CHANGE after ${CFG.VIEW_TIMEOUT}ms  [${chunk}]`, 'warn');
      R.warn.push(`view:${view}:no-dom-change`);
    } else {
      const quality = rateContent(contentEl);
      if (quality === 'OK') {
        log(`${label} ✅ OK  (${mutations} mutations)`, 'pass');
        R.pass.push(`view:${view}`);
      } else if (quality === 'EMPTY') {
        log(`${label} ⚠️ EMPTY — view rendered nothing  [${chunk}]`, 'warn');
        R.warn.push(`view:${view}:empty`);
      } else if (quality === 'SPINNER_STUCK') {
        log(`${label} ⚠️ Spinner stuck — data never loaded  [${chunk}]`, 'warn');
        R.warn.push(`view:${view}:spinner-stuck`);
      } else {
        log(`${label} ❌ ERROR text found in rendered content  [${chunk}]`, 'fail');
        R.fail.push(`view:${view}:error-text`);
      }
    }

    if (newErrs.length) {
      newErrs.slice(0, 3).forEach(e => log(`   ↳ ${e.slice(0, 130)}`, 'fail'));
      if (!R.fail.includes(`view:${view}:console-errors`))
        R.fail.push(`view:${view}:console-errors`);
    }

    stats();
    await sleep(CFG.BETWEEN_MS);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 — Post-Chunk Function Audit
// Check which functions are STILL missing now that all chunks have loaded
// ─────────────────────────────────────────────────────────────────────────────
section('PHASE 3 · Post-Chunk Function Audit');
await sleep(500);

const post = auditFunctions('post');
const nowPresent  = post.present - pre.present;
const stillMissing = post.missing;

if (nowPresent > 0)
  log(`+${nowPresent} functions appeared after chunks loaded`, 'pass');

if (stillMissing.length) {
  log(`${stillMissing.length} still missing after all chunks loaded — not patched into window.app:`, 'fail');
  stillMissing.forEach(fn => {
    const wasAlreadyFlagged = pre.missing.includes(fn);
    log(`  ${wasAlreadyFlagged ? '(same)' : 'NEW ↑'} app.${fn}`, 'fail');
    if (!R.miss.includes(fn)) { R.miss.push(fn); R.fail.push(`fn-post:${fn}`); }
  });
} else {
  log('All expected functions present after chunk loading', 'pass');
  R.pass.push('registry-post:all-present');
}

post.stubs.forEach(fn => {
  if (!R.warn.some(w => w.includes(fn)))
    log(`STUB  app.${fn} still a todo() placeholder`, 'warn');
});

stats();

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4 — Modal Open Tests
// ─────────────────────────────────────────────────────────────────────────────
section(`PHASE 4 · Modal Open Tests  (${MODAL_TESTS.length} modals)`);

for (const t of MODAL_TESTS) {
  tStat.textContent = t.name;
  const errsBefore = R.errs.length;

  // Navigate to the right view first if specified
  if (t.nav && typeof app.navigateTo === 'function') {
    app.navigateTo(t.nav);
    await sleep(1200);
  }

  let threw = false;
  try {
    t.fn();
  } catch(e) {
    log(`${t.name.padEnd(20)} ❌ threw: ${e.message}`, 'fail');
    R.fail.push(`modal:${t.name}:threw`);
    threw = true;
  }

  if (!threw) {
    await sleep(CFG.MODAL_TIMEOUT);
    const modal = detectModal();
    const newErrs = R.errs.slice(errsBefore);

    if (modal) {
      log(`${t.name.padEnd(20)} ✅ modal appeared`, 'pass');
      R.pass.push(`modal:${t.name}`);
    } else if (newErrs.length) {
      log(`${t.name.padEnd(20)} ❌ no modal + console errors`, 'fail');
      newErrs.slice(0, 2).forEach(e => log(`   ↳ ${e.slice(0, 110)}`, 'fail'));
      R.fail.push(`modal:${t.name}:error`);
    } else {
      log(`${t.name.padEnd(20)} ⚠️ silent — function ran but no modal appeared`, 'warn');
      R.warn.push(`modal:${t.name}:silent`);
    }

    closeModal();
    await sleep(400);
  }
  stats();
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
console.error = _origCE;  // restore

section('SUMMARY');

const score = R.pass.length;
const total = score + R.fail.length + R.warn.length;
const pct   = total ? Math.round(score / total * 100) : 0;

log(`Total checks : ${total}`, 'info');
log(`✅ PASS       : ${R.pass.length}  (${pct}%)`, 'pass');
log(`❌ FAIL       : ${R.fail.length}`, R.fail.length ? 'fail' : 'pass');
log(`⚠️  WARN       : ${R.warn.length}`, R.warn.length ? 'warn' : 'pass');
log(`🔍 Missing fns: ${R.miss.length}`, R.miss.length ? 'fail' : 'pass');
log(`🐛 JS Errors  : ${R.errs.length}`, R.errs.length ? 'warn' : 'pass');

if (R.miss.length) {
  log('\n── Missing functions (add to script.js return statement) ──', 'fail');
  R.miss.forEach(fn => log(`  app.${fn}`, 'fail'));
}
if (R.fail.filter(f => f.startsWith('view:')).length) {
  log('\n── Failed views ──', 'fail');
  R.fail.filter(f => f.startsWith('view:')).forEach(f => log(`  ${f}`, 'fail'));
}
if (R.warn.filter(f => f.startsWith('view:')).length) {
  log('\n── Warned views (check manually) ──', 'warn');
  R.warn.filter(f => f.startsWith('view:')).forEach(f => log(`  ${f}`, 'warn'));
}
if (R.errs.length) {
  log('\n── Console errors (first 8) ──', 'warn');
  R.errs.slice(0, 8).forEach(e => log(`  ${e.slice(0, 130)}`, 'warn'));
}

tStat.textContent = `Done — ${R.fail.length}F / ${R.warn.length}W`;
stats();

// Copy report button
document.getElementById('__t_copy').onclick = () => {
  const report = {
    timestamp:        new Date().toISOString(),
    score_pct:        pct,
    summary:          { pass:R.pass.length, fail:R.fail.length, warn:R.warn.length,
                        missing:R.miss.length, js_errors:R.errs.length },
    missing_functions: R.miss,
    failures:         R.fail,
    warnings:         R.warn,
    js_errors:        R.errs.slice(0, 60),
  };
  const json = JSON.stringify(report, null, 2);
  navigator.clipboard.writeText(json)
    .then(() => log('\n📋 Report copied to clipboard!', 'pass'))
    .catch(() => {
      console.log('%c[CRM Test Report]', 'color:cyan;font-weight:bold', report);
      log('\nReport printed to console (clipboard blocked)', 'warn');
    });
};

log('\n✅ Test complete.  Click "Copy Report" to export JSON.', 'pass');

})();
