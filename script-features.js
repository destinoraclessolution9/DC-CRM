// script-features.js — lazy-loaded on first navigation to a non-core view.
// Loaded AFTER script.js has fully executed, so window.app, window.AppDataStore,
// window.UI, and window._crmUtils are all available.
//
// Pattern: functions here use window.app.*, window.AppDataStore.*, window.UI.*
// and window._crmUtils.* instead of IIFE closure variables.
//
// To add a view:
//   1. Copy the showXxxView function from script.js
//   2. Replace closure var refs → window.app.* / window._crmUtils.* equivalents
//   3. Assign to window.app: window.app.showXxxView = async (container) => { ... };
//   4. Remove (or stub) the original from script.js navigateTo (script.js still
//      works as fallback if this file fails to load — _appFeaturesLoaded=true
//      is set even on error so the app never gets stuck).
//
// Views to migrate (ordered by size, smallest first):
//   showMonthlyPromotionView (~95 lines)
//   showMilestonesView       (~136 lines)
//   showRankingPerformanceView (~172 lines)
//   showLeadFormsView        (~178 lines)
//   showSurveysView          (~164 lines)
//   showContractsView        (~578 lines)
//   showDocumentManagementView (~1553 lines)
//   showReferralsView        (~1413 lines)
//   showCasesView            (~914 lines)
//   showBookingSettingsView  (~890 lines)
//   showSettingsView         (~1352 lines)
//   showPurchasesHistoryView (~1197 lines)
//   showAgentsView           (~1108 lines)
//   showProtectionMonitoringView (~1973 lines)
//   showWorkflowAutomationView (~512 lines)
//   showNoticeboardView      (~228 lines)
//   showFudeView             (~1356 lines)
//   showBossReportView       (~625 lines)
//   showStandardFunctionsView (~2487 lines)
//   showMobileProspectsView  (~4435 lines)
//   showPipelineView         (~4360 lines)
//   showMarketingAutomationView (~4111 lines)
//   showEggPurchaserView     (~1586 lines)
//   showFormulaPurchaserView (~1511 lines)
//   showStockTakeView        (~1862 lines)
//   showKnowledgeView        (~1535 lines)
//   showProspectsView + renderProspectsTable (~6090 lines)
//   showMarketingListsView   (~863 lines)

(function () {
    'use strict';

    // Shorthand aliases — all available because script.js already executed
    const app = window.app;
    const DS  = window.AppDataStore;
    const UI  = window.UI;
    const { escapeHtml, timeAgo, getScoreGrade,
            calculateProtectionDays, getProtectionStatus,
            isSystemAdmin, isMarketingManager, isMobile } = window._crmUtils || {};

    // ── VIEWS WILL BE ADDED HERE ──────────────────────────────────────────
    // Each view is assigned directly to window.app so navigateTo's existing
    // switch/case calls pick up the new implementation automatically.
    //
    // Example shape:
    //   app.showProspectsView = async (container) => {
    //     const prospects = await DS.getAll('prospects');
    //     container.innerHTML = `...`;
    //   };

    // Signal that features are ready (do this LAST so all assignments above
    // are visible before any queued navigations run).
    window._appFeaturesLoaded = true;
    if (typeof window._onFeaturesLoaded === 'function') {
        window._onFeaturesLoaded();
    }

})();
