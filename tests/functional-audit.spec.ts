/**
 * CRM Functional Audit — Playwright Test
 *
 * Run via Co-work:   npx playwright test tests/functional-audit.spec.ts
 * Or full suite:     npm test
 *
 * What it checks:
 *  Phase 1 — Function registry (all expected app.fn() are present & not stubs)
 *  Phase 2 — View navigation  (all 40 views render real content)
 *  Phase 3 — Post-chunk audit (functions that chunks should have patched in)
 *  Phase 4 — Modal open tests (8 key modals appear without silent failure)
 *
 * Uses expect.soft() so ALL phases run even when some checks fail.
 * Results appear in terminal + HTML report (test-results/).
 */

import { test, expect, Page } from '@playwright/test';

// ── Credentials ─────────────────────────────────────────────────────────────
const CRM_EMAIL    = 'destinoraclessolution9@gmail.com';
const CRM_PASSWORD = 'destinoraclessolution2026!';

// ── Expected functions (must exist in window.app) ────────────────────────────
const EXPECTED_FNS: string[] = [
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
  // AI / WhatsApp / Offline
  'initAIAnalytics','ensureAIModelsExist',
  'initWhatsAppIntegration','addWhatsAppButtonToProfile',
  'initOfflineSupport','addToOfflineQueue','processOfflineQueue',
  'offlineCreate','offlineUpdate',
];

// ── Views to navigate ────────────────────────────────────────────────────────
const ALL_VIEWS: Array<{ view: string; chunk: string }> = [
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
  // Admin-only (Level 1)
  { view:'admin',               chunk:'script-admin'              },
  { view:'security',            chunk:'script-admin'              },
  { view:'org_chart',           chunk:'script-org'                },
  { view:'boss_report',         chunk:'script-boss-report'        },
  { view:'stock_take',          chunk:'script-stock-take'         },
];

// ── Modal tests ───────────────────────────────────────────────────────────────
const MODAL_TESTS: Array<{ name: string; nav: string | null; fn: string }> = [
  { name:'Add Prospect',    nav:'prospects',          fn:'openAddProspectModal'    },
  { name:'Add Customer',    nav:'customers',           fn:'openAddCustomerModal'    },
  { name:'Add Agent',       nav:'agents',              fn:'openAddAgentModal'       },
  { name:'Search Panel',    nav:null,                  fn:'showSearchPanel'         },
  { name:'Create Template', nav:'marketing_automation',fn:'openCreateTemplateModal' },
  { name:'Create Campaign', nav:'marketing_automation',fn:'openCreateCampaignModal' },
  { name:'KPI Targets',     nav:'performance',         fn:'openKPITargetsModal'     },
  { name:'Add Slot',        nav:'booking_settings',    fn:'openAddSlotModal'        },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
async function login(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  const emailInput = page.locator('#loginEmail, input[type="email"]').first();
  await emailInput.waitFor({ state: 'visible', timeout: 12000 });
  await emailInput.fill(CRM_EMAIL);

  await page.locator('#loginPassword, input[type="password"]').first().fill(CRM_PASSWORD);
  await page.locator('#loginBtn, button[type="submit"]').first().click();

  // Wait until app is ready
  await page.waitForFunction(
    () => typeof (window as any).app?.navigateTo === 'function',
    { timeout: 25000 }
  );
  await page.waitForTimeout(800);
}

async function navigateTo(page: Page, view: string): Promise<void> {
  await page.evaluate((v: string) => (window as any).app.navigateTo(v), view);
}

async function closeModal(page: Page): Promise<void> {
  const closeBtn = page.locator(
    '#global-modal-overlay .close, button[aria-label="Close"], ' +
    '.modal-close, button:has-text("Cancel")'
  );
  if (await closeBtn.first().isVisible({ timeout: 400 }).catch(() => false)) {
    await closeBtn.first().click().catch(() => {});
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE
// ─────────────────────────────────────────────────────────────────────────────
test.describe('CRM Functional Audit', () => {

  // ── PHASE 1: Function Registry ─────────────────────────────────────────────
  test('Phase 1: Function Registry', async ({ page }) => {
    await login(page);

    type RegistryResult = {
      missing: string[];
      stubs: string[];
      notFn: string[];
      present: number;
      total: number;
    };

    const result: RegistryResult = await page.evaluate((fns: string[]) => {
      const app = (window as any).app;
      const missing: string[] = [], stubs: string[] = [], notFn: string[] = [];
      let present = 0;
      for (const fn of fns) {
        const v = app[fn];
        if (v === undefined || v === null) { missing.push(fn); continue; }
        if (typeof v !== 'function')       { notFn.push(fn);   continue; }
        const src = v.toString();
        if (src.includes("todo('") || src.includes('todo("') || src.includes('todo(`')) {
          stubs.push(fn);
        } else {
          present++;
        }
      }
      return { missing, stubs, notFn, present, total: fns.length };
    }, EXPECTED_FNS);

    console.log(`\n── Function Registry ──────────────────────────────`);
    console.log(`  Present : ${result.present} / ${result.total}`);

    if (result.missing.length) {
      console.error(`  MISSING  (${result.missing.length}):`);
      result.missing.forEach(f => console.error(`    ✗  app.${f}`));
    }
    if (result.stubs.length) {
      console.warn(`  STUBS    (${result.stubs.length}):`);
      result.stubs.forEach(f => console.warn(`    ~  app.${f}  (todo placeholder)`));
    }
    if (result.notFn.length) {
      console.warn(`  NOT_FUNC (${result.notFn.length}):`);
      result.notFn.forEach(f => console.warn(`    ?  app.${f}`));
    }

    expect.soft(result.missing, `Missing from window.app: ${result.missing.join(', ')}`).toHaveLength(0);
    expect.soft(result.stubs,   `Still todo() stubs: ${result.stubs.join(', ')}`).toHaveLength(0);
  });

  // ── PHASE 2: View Navigation ───────────────────────────────────────────────
  test('Phase 2: View Navigation', async ({ page }) => {
    test.setTimeout(360_000); // 6 minutes for 40 views

    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => consoleErrors.push(`[PAGEERR] ${err.message}`));

    await login(page);

    // Navigate home first to clear skeleton
    await navigateTo(page, 'home');
    await page.waitForTimeout(1500);

    const viewResults: { view: string; status: string; detail: string }[] = [];

    console.log(`\n── View Navigation (${ALL_VIEWS.length} views) ─────────────────────`);

    for (const { view, chunk } of ALL_VIEWS) {
      const errsBefore = consoleErrors.length;

      // Navigate + wait up to 4s for content
      let navError = '';
      try {
        await navigateTo(page, view);
      } catch (e: any) {
        navError = e.message;
      }

      let status = 'PASS', detail = '';

      if (navError) {
        status = 'FAIL';
        detail = `navigateTo threw: ${navError}`;
      } else {
        // Wait for content-viewport to have real text
        const hasContent = await page.waitForFunction(
          () => {
            const el = document.querySelector('#content-viewport');
            return el && (el as HTMLElement).innerText.trim().length > 30;
          },
          { timeout: 4000 }
        ).then(() => true).catch(() => false);

        if (!hasContent) {
          status = 'WARN';
          detail = `no content after 4s  [${chunk}]`;
        } else {
          // Check for error text in content
          const contentText: string = await page.evaluate(
            () => (document.querySelector('#content-viewport') as HTMLElement)?.innerText || ''
          );
          const badWords = ['typeerror','cannot read','is not a function','is not defined',
                            'failed to fetch','null is not','undefined is not'];
          const errWord = badWords.find(w => contentText.toLowerCase().includes(w));
          if (errWord) {
            status = 'FAIL';
            detail = `error text "${errWord}" in content`;
          } else {
            // Check for stuck spinner
            const stuckSpinner = await page.locator(
              '#content-viewport [class*="spin"], #content-viewport [class*="load"], ' +
              '#content-viewport .skeleton'
            ).first().isVisible({ timeout: 200 }).catch(() => false);
            if (stuckSpinner && contentText.trim().length < 50) {
              status = 'WARN';
              detail = `spinner still visible, content thin  [${chunk}]`;
            }
          }
        }
      }

      const newErrs = consoleErrors.slice(errsBefore);
      if (newErrs.length) {
        if (status === 'PASS') status = 'WARN';
        detail += (detail ? '; ' : '') + `${newErrs.length} console error(s)`;
      }

      viewResults.push({ view, status, detail });

      const icon = status === 'PASS' ? '✅' : status === 'WARN' ? '⚠️' : '❌';
      const msg = `  ${icon}  ${view.padEnd(26)} ${detail}`;
      if (status === 'FAIL') console.error(msg);
      else if (status === 'WARN') console.warn(msg);
      else console.log(msg);

      // Soft-assert per view
      if (status === 'FAIL') {
        expect.soft(false, `View "${view}" FAILED: ${detail}`).toBe(true);
      }

      await page.waitForTimeout(350);
    }

    // Summary
    const fails  = viewResults.filter(r => r.status === 'FAIL').length;
    const warns  = viewResults.filter(r => r.status === 'WARN').length;
    const passes = viewResults.filter(r => r.status === 'PASS').length;
    console.log(`\n  Views: ${passes} pass / ${warns} warn / ${fails} fail`);
    if (consoleErrors.length) {
      console.warn(`  Total console errors captured: ${consoleErrors.length}`);
      consoleErrors.slice(0, 10).forEach(e => console.warn(`    ${e.slice(0, 120)}`));
    }
  });

  // ── PHASE 3: Post-Chunk Function Audit ────────────────────────────────────
  // After navigating all views the chunks should all be loaded —
  // re-check that every chunk patched its functions into window.app.
  test('Phase 3: Post-Chunk Function Audit', async ({ page }) => {
    test.setTimeout(300_000);
    await login(page);

    // Force-load all chunks by visiting every view once
    console.log('\n── Loading all chunks… ──────────────────────────────');
    for (const { view } of ALL_VIEWS) {
      try {
        await navigateTo(page, view);
        await page.waitForTimeout(400);
      } catch (_) { /* ignore individual nav errors */ }
    }

    await page.waitForTimeout(800);

    const result: { missing: string[]; present: number; loadedChunks: string[] } =
      await page.evaluate((fns: string[]) => {
        const app = (window as any).app;
        const missing = fns.filter(fn => typeof app[fn] !== 'function');
        const present = fns.filter(fn => typeof app[fn] === 'function').length;
        const loadedChunks = Array.from(document.querySelectorAll('script[src]'))
          .map((s: any) => s.src as string)
          .filter(s => s.includes('chunks/'))
          .map(s => s.split('/').pop()!);
        return { missing, present, loadedChunks };
      }, EXPECTED_FNS);

    console.log(`\n── Post-Chunk Audit ────────────────────────────────`);
    console.log(`  Present: ${result.present} / ${EXPECTED_FNS.length}`);
    console.log(`  Chunks loaded: ${result.loadedChunks.length}`);
    result.loadedChunks.forEach(c => console.log(`    ✅  ${c}`));

    if (result.missing.length) {
      console.error(`\n  Still missing after all chunks loaded (${result.missing.length}):`);
      result.missing.forEach(f => console.error(`    ✗  app.${f}  ← not patched by its chunk`));
    }

    expect.soft(
      result.missing,
      `Functions still missing after chunk load — add to chunk patch or app return:\n  ${result.missing.join('\n  ')}`
    ).toHaveLength(0);
  });

  // ── PHASE 4: Modal Open Tests ─────────────────────────────────────────────
  test('Phase 4: Modal Open Tests', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);

    // Modal selector — covers all patterns used in the CRM
    const MODAL_SEL =
      '#global-modal-overlay, ' +
      '.modal:not([style*="display: none"]):not([style*="display:none"]), ' +
      '[role="dialog"], ' +
      '.modal-container, ' +
      '.sheet-panel, ' +
      '.drawer';

    console.log(`\n── Modal Open Tests (${MODAL_TESTS.length} modals) ──────────────────`);

    for (const { name, nav, fn } of MODAL_TESTS) {
      // Navigate to the context view if needed
      if (nav) {
        await navigateTo(page, nav);
        await page.waitForTimeout(1200);
      }

      const errsBefore: string[] = [];
      const onErr = (msg: any) => { if (msg.type() === 'error') errsBefore.push(msg.text()); };
      page.on('console', onErr);

      let threw = '';
      try {
        await page.evaluate((f: string) => (window as any).app[f]?.(), fn);
      } catch (e: any) {
        threw = e.message;
      }

      page.off('console', onErr);

      if (threw) {
        console.error(`  ❌  ${name.padEnd(22)} threw: ${threw}`);
        expect.soft(false, `Modal "${name}" threw: ${threw}`).toBe(true);
        continue;
      }

      // Wait up to 2s for modal
      const modalVisible = await page.locator(MODAL_SEL).first()
        .isVisible({ timeout: 2000 }).catch(() => false);

      if (modalVisible) {
        const hasText = await page.locator(MODAL_SEL).first()
          .evaluate(el => (el as HTMLElement).innerText.trim().length > 10)
          .catch(() => false);
        if (hasText) {
          console.log(`  ✅  ${name.padEnd(22)} modal appeared`);
        } else {
          console.warn(`  ⚠️  ${name.padEnd(22)} modal visible but near-empty`);
          expect.soft(false, `Modal "${name}" appeared but empty`).toBe(true);
        }
      } else if (errsBefore.length) {
        console.error(`  ❌  ${name.padEnd(22)} no modal + console errors:`);
        errsBefore.slice(0, 2).forEach(e => console.error(`       ${e.slice(0, 110)}`));
        expect.soft(false, `Modal "${name}" failed with errors`).toBe(true);
      } else {
        console.warn(`  ⚠️  ${name.padEnd(22)} silent — no modal appeared, no errors`);
        expect.soft(false, `Modal "${name}" silently failed`).toBe(true);
      }

      await closeModal(page);
      await page.waitForTimeout(400);
    }
  });

});
