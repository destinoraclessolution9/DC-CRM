// Phase 4.0/4.1/4.2 (#13) — React beachhead → data layer → first real view.
//
// Strangler-fig entry. Opt-in only (index.html injects this bundle for
// ?react=1 / localStorage crm_react_island=1), so the React bundle stays off
// normal users' loads until a real view is promoted to default.
//
// 4.0/4.1: a demo island (#react-island-root) fetches customers through React
//   Query → the BFF, proving React + TanStack Query + BFF end-to-end in prod.
// 4.2: exposes window.CRMReact.mountCustomersTable(container, opts) — the real
//   Customers table, rendered by chunks/script-prospects.js into the live view
//   (behind a flag, legacy table as fallback). React Query owns the cache, which
//   is what lets Phase 3 retire the bespoke per-view sync for migrated views.
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCustomers } from './data/useCustomers.js';
import { CustomersTable } from './views/CustomersTable.jsx';
import { ProspectsTable } from './views/ProspectsTable.jsx';
import { AgentsTable } from './views/AgentsTable.jsx';
import { SecurityDashboard } from './views/SecurityDashboard.jsx';
import { RankingView } from './views/RankingView.jsx';
import { NoticeboardGrid } from './views/NoticeboardGrid.jsx';
import { LeadFormsView, SurveysView, ContractsView } from './views/FormsViews.jsx';
import { PurchasesHistoryView } from './views/PurchasesHistoryView.jsx';
import { KnowledgeDashboardCards } from './views/KnowledgeDashboardCards.jsx';
import { KnowledgeAllEntries } from './views/KnowledgeAllEntries.jsx';
import { CustomFieldsAdmin } from './views/CustomFieldsAdmin.jsx';
import { OrgChartView } from './views/OrgChartView.jsx';
import { BookingSettingsView } from './views/BookingSettingsView.jsx';
import { MilestonesView } from './views/MilestonesView.jsx';
import { CasesGrid } from './views/CasesGrid.jsx';
import { BossReportView } from './views/BossReportView.jsx';
import { ProtectionMonitoringView } from './views/ProtectionMonitoringView.jsx';
import { MonthlyPromotionView } from './views/MonthlyPromotionView.jsx';
import { MarketingListsView } from './views/MarketingListsView.jsx';
import { DocumentManagementView } from './views/DocumentManagementView.jsx';
import { StockTakeView } from './views/StockTakeView.jsx';
import { EggPurchasingView } from './views/EggPurchasingView.jsx';
import { FormulaPurchaserView } from './views/FormulaPurchaserView.jsx';
import { ReportsView } from './views/ReportsView.jsx';
import { PipelineView } from './views/PipelineView.jsx';
import { MarketingAutomationView } from './views/MarketingAutomationView.jsx';
import { CalendarView } from './views/CalendarView.jsx';
import { ReferralsView } from './views/ReferralsView.jsx';
import { MobileHomeView } from './views/MobileHomeView.jsx';
import { AIInsightsView } from './views/AIInsightsView.jsx';
import { SearchPanelView } from './views/SearchPanelView.jsx';

const queryClient = new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

// ── 4.1 demo probe (kept for the existing end-to-end proof) ──────────────────
function CustomersProbe() {
    const { data, isLoading, error } = useCustomers({ limit: 5 });
    if (isLoading) {
        window.__REACT_ISLAND_STATE = 'loading';
        return <span data-react-island="loading" aria-hidden="true">react-island: loading…</span>;
    }
    if (error) {
        window.__REACT_ISLAND_STATE = 'error';
        return <span data-react-island="error" aria-hidden="true">react-island error: {String(error.message)}</span>;
    }
    const rows = (data && data.rows) || [];
    const sample = rows.map((r) => r.full_name).filter(Boolean).slice(0, 3).join(', ');
    window.__REACT_ISLAND_STATE = 'ready';
    window.__REACT_ISLAND_COUNT = data && data.count;
    return (
        <span data-react-island="ready" data-count={(data && data.count) ?? 0} aria-hidden="true">
            react-island: {(data && data.count) ?? 0} customers via React Query + BFF; sample: {sample}
        </span>
    );
}

function ProbeApp() {
    return (
        <QueryClientProvider client={queryClient}>
            <CustomersProbe />
        </QueryClientProvider>
    );
}

function mountProbe() {
    const el = document.getElementById('react-island-root');
    if (!el) return;
    try {
        createRoot(el).render(<ProbeApp />);
        window.__REACT_ISLAND_MOUNTED = true;
        window.__REACT_VERSION = 'bundled-19';
    } catch (e) {
        console.warn('[react-island] probe mount failed (non-fatal):', e && e.message);
    }
}

// ── 4.2 mount API — real Customers table island ──────────────────────────────
// One React root per container element (re-mounts re-render in place). The
// chunk calls this each time renderCustomersTable runs while the React path is
// active; React Query dedups + caches the underlying fetches by query key.
const _roots = new Map();

function mountCustomersTable(container, opts) {
    if (!container) return;
    let root = _roots.get(container);
    if (!root) {
        root = createRoot(container);
        _roots.set(container, root);
    }
    const o = opts || {};
    root.render(
        <QueryClientProvider client={queryClient}>
            <CustomersTable
                params={o.params || {}}
                meta={o.meta || { canReassign: false, agents: [], agentNames: {} }}
                pageSize={o.pageSize || 50}
                onNavigate={o.onNavigate || (() => {})}
            />
        </QueryClientProvider>
    );
    window.__REACT_CUSTOMERS_MOUNTED = true;
}

function unmountCustomersTable(container) {
    const root = container && _roots.get(container);
    if (root) {
        try { root.unmount(); } catch (_) {}
        _roots.delete(container);
    }
}

// ── 4.3 mount API — Prospects table island ───────────────────────────────────
// A fresh `key` per param-set remounts the component so React-local selection
// re-seeds from the chunk's _selectedProspects on page/sort/filter change.
function mountProspectsTable(container, opts) {
    if (!container) return;
    let root = _roots.get(container);
    if (!root) {
        root = createRoot(container);
        _roots.set(container, root);
    }
    const o = opts || {};
    const p = o.params || {};
    const key = `${p.page || 0}|${p.sortField || ''}|${p.sortDir || ''}|${p.q || ''}|${p.gua || ''}|${p.agent || ''}|${p.dormant ? 1 : 0}`;
    root.render(
        <QueryClientProvider client={queryClient}>
            <ProspectsTable
                key={key}
                params={p}
                meta={o.meta || { canReassign: false, canDelete: false, isAdmin: false, isMktMgr: false, agents: [], agentNames: {}, selectedIds: [] }}
                pageSize={o.pageSize || 50}
                onNavigate={o.onNavigate || (() => {})}
            />
        </QueryClientProvider>
    );
    window.__REACT_PROSPECTS_MOUNTED = true;
}

function unmountProspectsTable(container) {
    const root = container && _roots.get(container);
    if (root) {
        try { root.unmount(); } catch (_) {}
        _roots.delete(container);
    }
}

// ── Agents (Consultants) table island ────────────────────────────────────────
// The chunk computes the identity-filtered + visibility-scoped agent list (it
// owns isAgent + getVisibleUserIds) and passes it in as `agents`; the view
// applies the toolbar filters + joins per-agent counts via React Query. A fresh
// `key` per filter-set remounts so the view re-derives cleanly on filter change.
function mountAgentsTable(container, opts) {
    if (!container) return;
    let root = _roots.get(container);
    if (!root) {
        root = createRoot(container);
        _roots.set(container, root);
    }
    const o = opts || {};
    const f = o.filters || {};
    const key = `${f.search || ''}|${f.team || ''}|${f.role || ''}|${f.status || ''}|${(o.agents || []).length}`;
    root.render(
        <QueryClientProvider client={queryClient}>
            <AgentsTable
                key={key}
                agents={o.agents || []}
                counts={o.counts || {}}
                filters={f}
                meta={o.meta || { canAssignUpline: false }}
            />
        </QueryClientProvider>
    );
    window.__REACT_AGENTS_MOUNTED = true;
}

function unmountAgentsTable(container) {
    const root = container && _roots.get(container);
    if (root) {
        try { root.unmount(); } catch (_) {}
        _roots.delete(container);
    }
}

// ── Security dashboard island (read-only; incidents passed as a prop) ─────────
function mountSecurityDashboard(container, opts) {
    if (!container) return;
    let root = _roots.get(container);
    if (!root) {
        root = createRoot(container);
        _roots.set(container, root);
    }
    const o = opts || {};
    root.render(<SecurityDashboard incidents={o.incidents || []} />);
    window.__REACT_SECURITY_MOUNTED = true;
}

function unmountSecurityDashboard(container) {
    const root = container && _roots.get(container);
    if (root) {
        try { root.unmount(); } catch (_) {}
        _roots.delete(container);
    }
}

// ── Ranking Performance island (read-only; computed agentStats passed as props) ─
function mountRankingView(container, opts) {
    if (!container) return;
    let root = _roots.get(container);
    if (!root) { root = createRoot(container); _roots.set(container, root); }
    const o = opts || {};
    root.render(<RankingView agentStats={o.agentStats || []} monthLabel={o.monthLabel || ''} />);
    window.__REACT_RANKING_MOUNTED = true;
}

function unmountRankingView(container) {
    const root = container && _roots.get(container);
    if (root) { try { root.unmount(); } catch (_) {} _roots.delete(container); }
}

// ── Noticeboard card grid island (read-only; prepared events passed as props) ──
function mountNoticeboardGrid(container, opts) {
    if (!container) return;
    let root = _roots.get(container);
    if (!root) { root = createRoot(container); _roots.set(container, root); }
    const o = opts || {};
    root.render(<NoticeboardGrid events={o.events || []} isAdmin={!!o.isAdmin} />);
    window.__REACT_NOTICEBOARD_MOUNTED = true;
}

function unmountNoticeboardGrid(container) {
    const root = container && _roots.get(container);
    if (root) { try { root.unmount(); } catch (_) {} _roots.delete(container); }
}

// ── Forms-chunk islands (Lead Forms / Surveys / Contracts) — data via props ────
function _mountSimple(container, element) {
    if (!container) return;
    let root = _roots.get(container);
    if (!root) { root = createRoot(container); _roots.set(container, root); }
    root.render(element);
}
function _unmountSimple(container) {
    const root = container && _roots.get(container);
    if (root) { try { root.unmount(); } catch (_) {} _roots.delete(container); }
}
function mountLeadFormsView(container, opts) { _mountSimple(container, <LeadFormsView forms={(opts || {}).forms || []} />); window.__REACT_LEADFORMS_MOUNTED = true; }
function mountSurveysView(container, opts) { _mountSimple(container, <SurveysView surveys={(opts || {}).surveys || []} />); window.__REACT_SURVEYS_MOUNTED = true; }
function mountContractsView(container, opts) { _mountSimple(container, <ContractsView contracts={(opts || {}).contracts || []} />); window.__REACT_CONTRACTS_MOUNTED = true; }
function mountPurchasesHistory(container, opts) { const o = opts || {}; _mountSimple(container, <PurchasesHistoryView rows={o.rows || []} agentMap={o.agentMap || {}} />); window.__REACT_PURCHASES_MOUNTED = true; }

// ── Knowledge HQ islands ──────────────────────────────────────────────────────
// Dashboard card lists (read-only; entries passed as a prop; quick-capture form
// stays vanilla in the chunk) + All-Entries (stateful chip/search table; the
// chunk passes a loadEntries(query) callback wrapping its supabase/AppDataStore
// access). Detail editor + capture + daily notes remain vanilla.
function mountKnowledgeDashboard(container, opts) { const o = opts || {}; _mountSimple(container, <KnowledgeDashboardCards entries={o.entries || []} today={o.today || ''} />); window.__REACT_KB_DASH_MOUNTED = true; }
function mountKnowledgeAllEntries(container, opts) {
    const o = opts || {};
    _mountSimple(container, <KnowledgeAllEntries loadEntries={o.loadEntries} initialFilter={o.initialFilter || 'all'} onFilterChange={o.onFilterChange} />);
    window.__REACT_KB_ALL_MOUNTED = true;
}

// ── Custom Fields admin + Org Chart list islands (read-only; data via props) ───
function mountCustomFieldsAdmin(container, opts) { const o = opts || {}; _mountSimple(container, <CustomFieldsAdmin prospectFields={o.prospectFields || []} customerFields={o.customerFields || []} />); window.__REACT_CUSTOMFIELDS_MOUNTED = true; }
function mountOrgChartView(container, opts) { const o = opts || {}; _mountSimple(container, <OrgChartView rows={o.rows || []} />); window.__REACT_ORG_MOUNTED = true; }

// ── Booking Settings + Milestones islands (data via props; mutations via app.*) ─
function mountBookingSettings(container, opts) { const o = opts || {}; _mountSimple(container, <BookingSettingsView slots={o.slots || []} appointments={o.appointments || []} bookingUrl={o.bookingUrl || ''} />); window.__REACT_BOOKING_MOUNTED = true; }
function mountMilestonesView(container, opts) {
    const o = opts || {};
    _mountSimple(container, <MilestonesView nineDefs={o.nineDefs || []} pillarDefs={o.pillarDefs || []} nineStatuses={o.nineStatuses || {}} pillarStatuses={o.pillarStatuses || {}} isAdmin={!!o.isAdmin} subjectUserId={o.subjectUserId} viewingOther={!!o.viewingOther} subjectName={o.subjectName || ''} adminUsers={o.adminUsers || []} targetUserId={o.targetUserId} />);
    window.__REACT_MILESTONES_MOUNTED = true;
}

// ── Cases card-grid island (Success Case Library) — data via props, mutations
// via app.*. Mounted twice per render (cps grid + closed grid), each with its
// own container/root in the _roots map. ──────────────────────────────────────
function mountCasesGrid(container, opts) {
    const o = opts || {};
    _mountSimple(container, <CasesGrid cards={o.cards || []} type={o.type || 'cps'} />);
    window.__REACT_CASES_MOUNTED = true;
}

// ── Boss Report island (Super-Admin generator form; mount-once scaffold, all
// logic stays in the chunk handlers via stable ids + app.*). ──────────────────
function mountBossReport(container, opts) {
    const o = opts || {};
    _mountSimple(container, <BossReportView runs={o.runs || []} bals={o.bals || {}} tgts={o.tgts || {}} monthLabel={o.monthLabel || ''} skusLabel={o.skusLabel || 'Not loaded'} />);
    window.__REACT_BOSSREPORT_MOUNTED = true;
}

// ── Protection Monitoring island (read-render; chunk computes the 4 model
// arrays, mutations via app.*). ───────────────────────────────────────────────
function mountProtectionMonitoring(container, opts) {
    const o = opts || {};
    _mountSimple(container, <ProtectionMonitoringView teamCards={o.teamCards || []} agentRows={o.agentRows || []} inactiveRows={o.inactiveRows || []} reassignRows={o.reassignRows || []} reassignEmpty={o.reassignEmpty || 'No reassignment history yet.'} />);
    window.__REACT_PROTECTION_MOUNTED = true;
}

// ── Monthly Promotion island (read-only promo-card display). ──────────────────
function mountMonthlyPromotion(container, opts) {
    const o = opts || {};
    _mountSimple(container, <MonthlyPromotionView promos={o.promos || []} totalPromos={o.totalPromos || 0} />);
    window.__REACT_PROMO_MOUNTED = true;
}

// ── Marketing Lists island (tabbed master-data manager). React renders the
// shell + the 5 master tables; promotions/special_programs filled by the chunk
// into #marketing-list-content. ──────────────────────────────────────────────
function mountMarketingLists(container, opts) {
    const o = opts || {};
    _mountSimple(container, <MarketingListsView tab={o.tab || 'products'} rows={o.rows || []} isTeamLeader={!!o.isTeamLeader} legacyHtml={o.legacyHtml || ''} />);
    window.__REACT_MKTLISTS_MOUNTED = true;
}

// ── Document Management scaffold-shell island (chunk populates the containers +
// owns all interactivity incl. drag-drop). ───────────────────────────────────
function mountDocuments(container, opts) {
    const o = opts || {};
    _mountSimple(container, <DocumentManagementView viewMode={o.viewMode || 'list'} onReady={o.onReady} />);
    window.__REACT_DMS_MOUNTED = true;
}

// ── Stock Take scaffold-shell island (chunk fills #st-session-chip + #st-tab-body
// via stSwitchTab on useEffect onReady; owns all 9 tabs/QR/reconcile/realtime). ──
function mountStockTake(container, opts) {
    const o = opts || {};
    _mountSimple(container, <StockTakeView tabs={o.tabs || []} onReady={o.onReady} />);
    window.__REACT_ST_MOUNTED = true;
}

// ── Egg Purchasing scaffold-shell island (chunk fills #egg-tab-content via
// eggSwitchTab on useEffect onReady; owns wizard/file-IO/reconcile). ───────────
function mountEggPurchasing(container, opts) {
    const o = opts || {};
    _mountSimple(container, <EggPurchasingView tabs={o.tabs || []} activeTab={o.activeTab || 'run'} onReady={o.onReady} />);
    window.__REACT_EGG_MOUNTED = true;
}

// ── Formula Purchaser scaffold-shell island (chunk fills #fp-tab-content via
// fpLoadData + fpSwitchTab on useEffect onReady; owns imports/PO/transfers). ────
function mountFormulaPurchaser(container, opts) {
    const o = opts || {};
    _mountSimple(container, <FormulaPurchaserView tabs={o.tabs || []} activeTab={o.activeTab || 'dashboard'} onReady={o.onReady} />);
    window.__REACT_FP_MOUNTED = true;
}

// ── Reporting & KPI Dashboard scaffold-shell island (chunk fills all containers
// + Chart.js canvas via _kpiPopulate/refreshKPIDashboard on useEffect onReady). ─
function mountReports(container, opts) {
    const o = opts || {};
    _mountSimple(container, <ReportsView isTeamLeader={!!o.isTeamLeader} currentTimeFilter={o.currentTimeFilter || 'monthly'} roles={o.roles || []} currentRoleFilter={o.currentRoleFilter || 'All'} customDateFrom={o.customDateFrom || ''} customDateTo={o.customDateTo || ''} agents={o.agents || []} currentAgentFilter={o.currentAgentFilter || 'all'} loadAgents={o.loadAgents} onReady={o.onReady} />);
    window.__REACT_REPORTS_MOUNTED = true;
}

// ── Pipeline scaffold-shell island (pure static skeleton; the chunk fills the
// stable-id containers + owns drag-drop + the v6 scoring engine). ─────────────
function mountPipeline(container, opts) {
    const o = opts || {};
    _mountSimple(container, <PipelineView onReady={o.onReady} />);
    window.__REACT_PIPELINE_MOUNTED = true;
}

// ── Marketing Automation scaffold-shell island (chunk fills #marketing-tab-content
// via renderMarketingTabContent after awaiting island useEffect-ready). ──────────
function mountMarketingAutomation(container, opts) {
    const o = opts || {};
    _mountSimple(container, <MarketingAutomationView canExport={!!o.canExport} canTabs={!!o.canTabs} activeTab={o.activeTab || 'forms'} onReady={o.onReady} />);
    window.__REACT_MKTAUTO_MOUNTED = true;
}

// ── Calendar scaffold-shell island (largest shell; chunk fills the grid + all
// widgets by id after awaiting island useEffect-ready). ──────────────────────
function mountCalendar(container, opts) {
    const o = opts || {};
    _mountSimple(container, <CalendarView greeting={o.greeting || 'Hello'} userName={o.userName || 'there'} userEmail={o.userEmail || ''} onReady={o.onReady} />);
    window.__REACT_CAL_MOUNTED = true;
}

// ── Referrals scaffold-shell island (chunk keeps the D3 zoom/pan tree + summary/
// leaderboard fills + style injection; populates by id after useEffect-ready). ──
function mountReferrals(container, opts) {
    const o = opts || {};
    _mountSimple(container, <ReferralsView onReady={o.onReady} />);
    window.__REACT_REFERRALS_MOUNTED = true;
}

// ── Mobile Home scaffold-shell island (chunk keeps snapshot/fetches/_composeBody;
// fills #mhome-body by id after useEffect-ready). ──────────────────────────────
function mountMobileHome(container, opts) {
    const o = opts || {};
    _mountSimple(container, <MobileHomeView greetWord={o.greetWord || 'Hello'} userName={o.userName || 'there'} dateStr={o.dateStr || ''} avatarUrl={o.avatarUrl || ''} initBody={o.initBody || ''} onReady={o.onReady} />);
    window.__REACT_HOME_MOUNTED = true;
}

// ── AI Insights modal-content island (scaffold-shell; rendered inside a
// fullscreen UI.showModal). Modals are destroyed/recreated on each open, so we
// keep a single dedicated root and unmount the prior one before mounting fresh
// (NOT the _roots Map, which would leak a stale detached-node root per open). ──
let _aiInsightsRoot = null;
function mountAIInsights(container, opts) {
    if (!container) return;
    if (_aiInsightsRoot) { try { _aiInsightsRoot.unmount(); } catch (_) {} _aiInsightsRoot = null; }
    const o = opts || {};
    const root = createRoot(container);
    _aiInsightsRoot = root;
    root.render(<AIInsightsView onReady={o.onReady} />);
    window.__REACT_AI_MOUNTED = true;
}
function unmountAIInsights() {
    if (_aiInsightsRoot) { try { _aiInsightsRoot.unmount(); } catch (_) {} _aiInsightsRoot = null; }
}

// ── Advanced Search overlay-drawer island (scaffold-shell; mounted into a host
// div the chunk inserts, destroyed/recreated per open → dedicated single root,
// unmount-prior-before-fresh, NOT the _roots Map). ───────────────────────────
let _searchPanelRoot = null;
function mountSearchPanel(container, opts) {
    if (!container) return;
    if (_searchPanelRoot) { try { _searchPanelRoot.unmount(); } catch (_) {} _searchPanelRoot = null; }
    const o = opts || {};
    const root = createRoot(container);
    _searchPanelRoot = root;
    root.render(<SearchPanelView onReady={o.onReady} />);
    window.__REACT_SEARCH_MOUNTED = true;
}
function unmountSearchPanel() {
    if (_searchPanelRoot) { try { _searchPanelRoot.unmount(); } catch (_) {} _searchPanelRoot = null; }
}

window.CRMReact = Object.assign(window.CRMReact || {}, {
    queryClient,
    mountCustomersTable,
    unmountCustomersTable,
    mountProspectsTable,
    unmountProspectsTable,
    mountAgentsTable,
    unmountAgentsTable,
    mountSecurityDashboard,
    unmountSecurityDashboard,
    mountRankingView,
    unmountRankingView,
    mountNoticeboardGrid,
    unmountNoticeboardGrid,
    mountLeadFormsView,
    mountSurveysView,
    mountContractsView,
    unmountLeadFormsView: _unmountSimple,
    unmountSurveysView: _unmountSimple,
    unmountContractsView: _unmountSimple,
    mountPurchasesHistory,
    unmountPurchasesHistory: _unmountSimple,
    mountKnowledgeDashboard,
    unmountKnowledgeDashboard: _unmountSimple,
    mountKnowledgeAllEntries,
    unmountKnowledgeAllEntries: _unmountSimple,
    mountCustomFieldsAdmin,
    unmountCustomFieldsAdmin: _unmountSimple,
    mountOrgChartView,
    unmountOrgChartView: _unmountSimple,
    mountBookingSettings,
    unmountBookingSettings: _unmountSimple,
    mountMilestonesView,
    unmountMilestonesView: _unmountSimple,
    mountCasesGrid,
    unmountCasesGrid: _unmountSimple,
    mountBossReport,
    unmountBossReport: _unmountSimple,
    mountProtectionMonitoring,
    unmountProtectionMonitoring: _unmountSimple,
    mountMonthlyPromotion,
    unmountMonthlyPromotion: _unmountSimple,
    mountMarketingLists,
    unmountMarketingLists: _unmountSimple,
    mountDocuments,
    unmountDocuments: _unmountSimple,
    mountStockTake,
    unmountStockTake: _unmountSimple,
    mountEggPurchasing,
    unmountEggPurchasing: _unmountSimple,
    mountFormulaPurchaser,
    unmountFormulaPurchaser: _unmountSimple,
    mountReports,
    unmountReports: _unmountSimple,
    mountPipeline,
    unmountPipeline: _unmountSimple,
    mountMarketingAutomation,
    unmountMarketingAutomation: _unmountSimple,
    mountCalendar,
    unmountCalendar: _unmountSimple,
    mountReferrals,
    unmountReferrals: _unmountSimple,
    mountMobileHome,
    unmountMobileHome: _unmountSimple,
    mountAIInsights,
    unmountAIInsights,
    mountSearchPanel,
    unmountSearchPanel,
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountProbe, { once: true });
} else {
    mountProbe();
}
