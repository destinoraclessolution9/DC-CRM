/**
 * CRM Quick Registry Check
 *
 * USAGE A — Chrome MCP (Co-work injects this via javascript_tool):
 *   Returns JSON immediately, no DOM changes, no navigation.
 *   Co-work reads the output and tells you what's missing.
 *
 * USAGE B — Browser Console:
 *   Paste into DevTools → Console while logged in.
 *   Prints a clean table in < 2 seconds.
 *
 * NOTE: This only checks function registry.
 *       For full view-navigation audit use ci/functional-test.js (console)
 *       or run:  npx playwright test tests/functional-audit.spec.ts
 */

(function __CRM_QUICK_CHECK__() {
  const app = window.app;
  if (!app) {
    const r = { error: 'window.app not found — not logged in or script not loaded' };
    console.error(JSON.stringify(r));
    return JSON.stringify(r);
  }

  const EXPECTED = [
    'navigateTo','logout','init','isMobile','getCurrentUserId',
    'toggleMobileNav','closeMobileDrawer','openMobileDrawer',
    'showProspectsView','showProspectsViewSmart','showProspectDetail',
    'openAddProspectModal','saveProspect','editProspect','deleteProspect',
    'filterProspects','convertToCustomer','downloadProspectVCard',
    'setProspectGrade','bulkDeleteProspects','bulkReassignProspects',
    'transferProspect','reassignProspect','quickReassign','openReviveProspectModal',
    'showCustomersView','showCustomerDetail','openAddCustomerModal','saveCustomer',
    'filterCustomers','openCustomerReferralModal','saveCustomerReferral',
    'openEditPlatformIdsModal','savePlatformIds','updatePurchaseDelivery',
    'showAgentsView','showAgentProfile','openAddAgentModal','openEditAgentModal',
    'saveAgent','generatePassword','deleteAgent','deactivateAgent','renewLicense',
    'showPipelineView','refreshPipeline','setPipelineFilter','addToFocusList',
    'handleDragStart','handleDrop','saveManualOrder','savePipelineConfig',
    'openActivityModal','openPostMeetupNotesModal','savePostMeetupNotes',
    'openAttendeeOutcomeModal','openAttendeeNotesModal',
    'renderJourneyTab','markJourneyTouchpointDone','skipJourneyTouchpoint',
    'snoozeJourneyTouchpoint','sendJourneyWhatsApp','switchJourneyTrack',
    'openSpawnTouchpointsModal','showAgentJourneyDashboard',
    'showImportDashboard','openImportWizard','startImport','showImportHistory',
    'showProtectionMonitoringView','renderTeamSummaryCards',
    'showSecurityDashboard','showAuditLogs','showComplianceCenter',
    'showAdminDashboard','showTwoFactorSetup','verifyAndEnable2FA',
    'openCustomerSurveyModal','saveCustomerSurvey','openCpsAnalysisModal',
    'openApuAppraisalModal','openDestinyBlueprintModal','saveDestinyBlueprint',
    'renderFormsTab','cfSearchProspects',
    'showBookingSettingsView','openAddSlotModal','saveBookingSlot',
    'toggleSlotActive','renderPendingCpsIntakes','scanCpsForm','parseCpsPastedText',
    'editTemplate','editCampaign','openCreateTemplateModal','openCreateCampaignModal',
    'toggleSearchPanel','showSearchPanel','hideSearchPanel','executeSearch',
    'clearAllFilters','addConditionGroup','removeCondition','updateConditionField',
    'openSaveSearchModal','loadSavedSearch','deleteSavedSearch','loadPreset',
    'showMilestonesView','showFudeView','markMilestoneCompleted',
    'openHighlightModal','saveHighlight','deleteHighlight','syncFudiSummary',
    'openRewardModal','saveReward',
    'addScoreToProspect','addScoreToCustomer','applyActivityScoring',
    'openScoreAdjustmentModal','calculateCustomerHealthScore','renderHealthBadge',
    'sendBirthdayWish','scheduleBirthdayFollowup','openKPITargetsModal','saveKPITargets',
    'initAIAnalytics','ensureAIModelsExist',
    'initWhatsAppIntegration','addWhatsAppButtonToProfile',
    'initOfflineSupport','addToOfflineQueue','processOfflineQueue',
    'offlineCreate','offlineUpdate',
  ];

  const missing = [], stubs = [], present = [];

  for (const fn of EXPECTED) {
    const v = app[fn];
    if (!v || typeof v !== 'function') {
      missing.push(fn);
    } else {
      const src = v.toString();
      if (src.includes("todo('") || src.includes('todo("') || src.includes('todo(`')) {
        stubs.push(fn);
      } else {
        present.push(fn);
      }
    }
  }

  // Loaded chunks
  const loadedChunks = Array.from(document.querySelectorAll('script[src]'))
    .map(s => s.src)
    .filter(s => s.includes('chunks/'))
    .map(s => s.split('/').pop());

  const total = EXPECTED.length;
  const score = Math.round(present.length / total * 100);

  const result = {
    score_pct:     score,
    present:       present.length,
    total,
    missing_count: missing.length,
    stub_count:    stubs.length,
    missing,
    stubs,
    loaded_chunks: loadedChunks,
    app_key_count: Object.keys(app).length,
  };

  // Pretty print for console usage
  const bar = score >= 95 ? '🟢' : score >= 75 ? '🟡' : '🔴';
  console.log(`\n%c CRM Quick Check  ${bar} ${score}% (${present.length}/${total} functions) `,
    'background:#1e40af;color:#bfdbfe;font-size:13px;padding:4px 8px;border-radius:4px');
  if (missing.length) {
    console.error(`❌ Missing (${missing.length}):\n  ${missing.join('\n  ')}`);
  } else {
    console.log('%c✅ All expected functions present', 'color:#22c55e;font-weight:bold');
  }
  if (stubs.length) {
    console.warn(`⚠️ Stubs (${stubs.length}):\n  ${stubs.join('\n  ')}`);
  }
  console.log(`📦 Chunks loaded: ${loadedChunks.length}`);

  // Return JSON string (Chrome MCP javascript_tool returns the last expression)
  return JSON.stringify(result, null, 2);
})();
