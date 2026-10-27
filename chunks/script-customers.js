/**
 * CRM Lazy Chunk: Customer Management
 * Covers: Customers list/table, customer detail + profile tabs, customer/purchase/
 *   delivery modals. Split out of script-prospects.js 2026-06-18.
 */
(() => {
    const _state = window._appState;
    const _utils = window._crmUtils;
    const esc     = (...a) => _utils.escapeHtml(...a);
    const escapeHtml = esc;
    const getVisibleUserIds = (u) => _utils.getVisibleUserIds(u);
    const isMobile = () => _utils.isMobile();
    const isSystemAdmin        = (u) => _utils.isSystemAdmin(u || _state.cu);
    const isMarketingManager   = (u) => _utils.isMarketingManager(u || _state.cu);
    const isAgent              = (u) => _utils.isAgent(u || _state.cu);
    const isManagement         = (u) => _utils.isManagement(u || _state.cu);
    const isTeamLeaderOrAbove  = (u) => _utils.isTeamLeaderOrAbove(u || _state.cu);
    const isStockTakeStaff     = (u) => _utils.isStockTakeStaff(u || _state.cu);
    const isCustomer           = (u) => _utils.isCustomer(u || _state.cu);
    const isReferrer           = (u) => _utils.isReferrer(u || _state.cu);
    const isAgentOrLeader      = (u) => _utils.isAgentOrLeader(u || _state.cu);
    const getAgentsAndLeaders  = () => _utils.getAgentsAndLeaders();
    const getUserLevel         = (u) => _utils.getUserLevel(u);
    const _getUserLevel        = (u) => _utils.getUserLevel(u);
    const canAccessStockTake   = (u) => _utils.isSystemAdmin(u) || _utils.isStockTakeStaff(u);
    const debounce             = _utils.debounce;
    const debounceCall         = _utils.debounceCall;
    const waPhone              = (raw) => _utils.waPhone(raw);
    // Permission helpers — defined in script.js IIFE, exported to _crmUtils after line ~755.
    const canViewProspect     = (p) => _utils.canViewProspect(p);
    const canViewCustomer     = (c) => _utils.canViewCustomer(c);
    const getVisibleCustomers = ()  => _utils.getVisibleCustomers();
    // navigateTo lives in the script.js IIFE — reach it via window.app.
    const navigateTo          = (v) => window.app.navigateTo(v);
    // Constants defined in script.js IIFE — redeclare locally for chunk scope.
    const USER_ROLES    = _utils.USER_ROLES || [];
    const _PH_PAGE_SIZE = 50;
    // Cross-chunk reassign helpers — defined in script-import.js, exported to window.app.
    // Guards use || noop so callers don't throw if the import chunk hasn't loaded yet
    // (e.g. user opens Prospects view without ever visiting Import/Protection).
    const cascadeProspectReassign   = (...a) => (window.app.cascadeProspectReassign   || (() => Promise.resolve(null)))(...a);
    const _renderReassignSummary    = (...a) => (window.app._renderReassignSummary    || (() => '<p style="color:var(--gray-400)">Loading…</p>'))(...a);
    const _showReassignConfirmPopup = (...a) => (window.app._showReassignConfirmPopup || (() => {}))(...a);
    // Robust activity lookup — defined in script-calendar.js. Falls back to plain
    // AppDataStore.getById when the calendar chunk hasn't loaded yet (e.g. user
    // jumps straight into a prospect detail before opening calendar).
    const _lookupActivityRobust = (...a) => (window.app._lookupActivityRobust || AppDataStore.getById.bind(AppDataStore, 'activities'))(...a);
    // CPS-photo silent uploader — defined in script-cps.js. Fire-and-forget.
    const _uploadCpsFormFile    = (...a) => (window.app._uploadCpsFormFile || (() => Promise.resolve()))(...a);
    // CPS health helpers — defined in script-cps.js, exported to window.app.
    const renderQuickHealthBadge       = (...a) => (window.app.renderQuickHealthBadge       || (() => ''))(...a);
    // The real badge lives in the cps chunk; when that chunk isn't loaded yet the
    // script.js lazy stub is async and returned a Promise → "[object Promise]" in
    // the customer header. Render the same badge locally in that case.
    const renderHealthBadge = (health) => {
        const out = window.app.renderHealthBadge ? window.app.renderHealthBadge(health) : '';
        if (out && typeof out.then !== 'function') return out;
        if (!health || health.score == null) return '';
        const cls = health.grade === 'green' ? 'is-success' : health.grade === 'yellow' ? 'is-warning' : 'is-danger';
        return `<span class="pv-chip ${cls}" title="Health Score: ${Number(health.score)}/100"><i class="fas fa-heart-pulse" aria-hidden="true"></i> ${escapeHtml(health.label || '')} ${Number(health.score)}</span>`;
    };
    const calculateCustomerHealthScore = (...a) => (window.app.calculateCustomerHealthScore || (() => 0))(...a);
    // Import / workflow helpers — defined in script-import.js and script-features2.js.
    const exportMarketingList          = (...a) => (window.app.exportMarketingList          || (() => Promise.resolve()))(...a);
    const executeWorkflows             = (...a) => (window.app.executeWorkflows             || (() => Promise.resolve()))(...a);
    // SCORING_RULES constant — exported by script-features2.js. Fallback guards against load order.
    const SCORING_RULES = window.app.SCORING_RULES || { CREATE_PROSPECT: 5, MARK_NOT_INTERESTED: -500 };
    // addWhatsAppButtonToProfile — defined in script.js IIFE, exported to window.app.
    const addWhatsAppButtonToProfile = (...a) => (window.app.addWhatsAppButtonToProfile || (() => Promise.resolve()))(...a);
    // Current view (read-only reference)
    const _getCurrentView = () => _state.cv;

    // URL-scheme guard for user-supplied file/link values interpolated into href.
    // Returns the escaped URL only when it is an http(s) absolute URL; otherwise ''
    // (callers render '-' / no link). Blocks javascript:/data: and attribute breakout.
    const _safeHref = (u) => {
        const s = (u == null ? '' : String(u)).trim();
        return /^https?:\/\//i.test(s) ? escapeHtml(s) : '';
    };

    // Mask a bank account number, FAILING CLOSED. The old inline
    // /^(\d{4}).*(\d{4})$/ regex returned the input UNCHANGED (fully exposed) for
    // any value that didn't start AND end with exactly 4 digits (bank prefixes,
    // trailing spaces, <8 digits). Strategy: strip to digits; if ≥8 digits, show
    // first-4/last-4; if 4–7 digits, show only the last 4; otherwise mask entirely.
    const _maskAccount = (raw) => {
        const digits = String(raw == null ? '' : raw).replace(/\D/g, '');
        if (digits.length >= 8) return `${digits.slice(0, 4)}-****-${digits.slice(-4)}`;
        if (digits.length >= 4) return `****${digits.slice(-4)}`;
        return '****';
    };

    // ── Duplicated from prospects-core: shared server-pagination helper.
    // Reads only header globals (getVisibleUserIds/_state.cu/AppDataStore),
    // so a verbatim copy is safe and keeps _bffGetCustomers an intra-chunk call.
const _serverPage = async (table, opts = {}) => {
    try {
        const o = { countMode: 'planned', ...opts };
        o.filters = { ...(opts.filters || {}) };
        const scopeBy = opts.scopeBy;
        delete o.scopeBy;
        if (scopeBy && !o.scopeFields && !o.scopeField) {
            const visible = await getVisibleUserIds(_state.cu);
            if (visible && visible !== 'all' && Array.isArray(visible)) {
                o.scopeFields = scopeBy.map(field => ({ field, values: visible }));
            }
        }
        const res = await AppDataStore.queryAdvanced(table, o);
        return { data: res.data || [], count: res.count || 0, used: true };
    } catch (e) {
        console.warn(`[serverPage] ${table} → client fallback:`, e?.message || e);
        return { used: false };
    }
};

const switchCustomerTab = async (tabName) => {
    const pTab = document.getElementById('prospects-tab-content');
    const cTab = document.getElementById('customers-tab-content');
    if (!pTab || !cTab) return;
    const btns = document.querySelectorAll('.tab-btn');

    btns.forEach(b => b.classList.remove('active'));
    if (tabName === 'prospects') {
        pTab.style.display = 'block';
        cTab.style.display = 'none';
        if (btns[0]) btns[0].classList.add('active');
        await window.app.renderProspectsTable();
    } else {
        pTab.style.display = 'none';
        cTab.style.display = 'block';
        if (btns[1]) btns[1].classList.add('active');
        await showCustomersView(cTab);
    }
};

const showCustomersView = async (container) => {
    // Management (L<=4) as before, plus anyone the Super Admin granted "approve
    // sales" (can_approve_sales RPC — the same check the database enforces).
    let _showApprovalQueue = _getUserLevel(_state.cu) <= 4;
    if (!_showApprovalQueue && window.supabase?.rpc) {
        try { const { data, error } = await window.supabase.rpc('can_approve_sales'); _showApprovalQueue = !error && data === true; }
        catch (_) { _showApprovalQueue = false; }
    }
    container.innerHTML = `
        <div class="customers-view">
            <div class="prospects-header">
                <div>
                    <h1>Customer Database</h1>
                    <p>Manage converted customers and their lifecycle events. Customer records are permanent.</p>
                </div>
                <div class="header-actions">
                    <button class="btn secondary" onclick="app.openDeliveryListing()">
                        <i class="fas fa-truck"></i> Product Delivery Listing
                    </button>
                    <button class="btn primary" onclick="app.openAddCustomerModal()">
                        <i class="fas fa-plus"></i> Add Customer
                    </button>
                </div>
            </div>

            <div class="warning-banner">
                <i class="fas fa-exclamation-triangle"></i>
                <span>⚠️ DELETE IS NOT AVAILABLE - Customer records are permanent and cannot be deleted under any circumstances.</span>
            </div>

            ${_showApprovalQueue ? `
            <div id="approval-queue-section" style="margin-bottom:24px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                    <h2 style="font-size:18px; font-weight:600; display:flex; align-items:center; gap:8px; margin:0;">
                        <i class="fas fa-clipboard-check" style="color:#d97706;"></i>
                        Manager Approval Queue
                        <span id="approval-queue-count" style="background:#fef3c7; color:#92400e; padding:2px 10px; border-radius:12px; font-size:12px; font-weight:600;">0</span>
                    </h2>
                    <button class="btn secondary" onclick="app.refreshApprovalQueue()" style="font-size:12px; padding:4px 12px;">
                        <i class="fas fa-sync-alt"></i> Refresh
                    </button>
                </div>
                <div class="prospects-table-container">
                    <table class="prospects-table">
                        <thead>
                            <tr>
                                <th scope="col">Type</th>
                                <th scope="col">Prospect / Customer</th>
                                <th scope="col">Submitted By</th>
                                <th scope="col">Date</th>
                                <th scope="col">Description</th>
                                <th scope="col">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="approval-queue-body">
                        </tbody>
                    </table>
                </div>
            </div>
            ` : ''}

            <div class="filter-bar" style="flex-direction:column; align-items:stretch; gap:8px;">
                <div class="search-group">
                    <i class="fas fa-search"></i>
                    <input type="text" id="customer-search" placeholder="Search customers by name, phone, email, or ID" oninput="app.debounceCall('customer-search', app.filterCustomers, 220)">
                </div>
                <div>
                    <button type="button" onclick="(function(){var p=document.getElementById('customer-adv-filters');var i=document.getElementById('customer-adv-icon');if(p.style.display==='none'){p.style.display='flex';i.className='fas fa-chevron-up';}else{p.style.display='none';i.className='fas fa-chevron-down';}})()" style="background:none;border:none;cursor:pointer;color:var(--primary);font-size:13px;padding:0;display:flex;align-items:center;gap:6px;">
                        <i id="customer-adv-icon" class="fas fa-chevron-down"></i> Advanced Search
                    </button>
                    <div id="customer-adv-filters" style="display:none; flex-wrap:wrap; gap:8px; margin-top:8px;">
                        <select id="filter-customer-type" onchange="app.filterCustomers()">
                            <option value="">Customer Type: All</option>
                            <option value="Regular">Regular</option>
                            <option value="VIP">VIP</option>
                            <option value="Agent Eligible">Agent Eligible</option>
                        </select>
                        <select id="filter-customer-gua" onchange="app.filterCustomers()">
                            <option value="">Ming Gua: All</option>
                            <option value="MG1">MG1 坎</option>
                            <option value="MG2">MG2 坤</option>
                            <option value="MG3">MG3 震</option>
                            <option value="MG4">MG4 巽</option>
                            <option value="MG5">MG5</option>
                            <option value="MG6">MG6 乾</option>
                            <option value="MG7">MG7 兑</option>
                            <option value="MG8">MG8 艮</option>
                            <option value="MG9">MG9 离</option>
                        </select>
                        <select id="filter-purchase-status" onchange="app.filterCustomers()">
                            <option value="">Purchase Status: All</option>
                            <option value="30d">Purchased Last 30 Days</option>
                            <option value="90d">Purchased Last 90 Days</option>
                            <option value="no90d">No Purchase 90+ Days</option>
                        </select>
                        <select id="filter-customer-deficiency" onchange="app.filterCustomers()">
                            <option value="">Star Deficiency: All</option>
                            <option value="Wealth">Wealth</option>
                            <option value="Career">Career</option>
                            <option value="Relationship">Romance/Relationship</option>
                            <option value="Health">Health</option>
                        </select>
                        <select id="filter-customer-house-audit" onchange="app.filterCustomers()">
                            <option value="">House Audit: All</option>
                            <option value="Pending">Pending</option>
                            <option value="Scheduled">Scheduled</option>
                            <option value="Completed">Completed</option>
                            <option value="None">Not Done</option>
                        </select>
                        <input type="number" id="filter-customer-min-events" min="0" placeholder="Min events attended" onchange="app.filterCustomers()" style="width:160px; padding:6px 10px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--text);">
                        <button class="btn primary" onclick="app.filterCustomers()">Apply Filters</button>
                    </div>
                </div>
            </div>

            <!-- Phase 4.2 (#13): React island mount target. renderCustomersTable
                 swaps visibility between this and the legacy table below when the
                 opt-in React customers path is active. -->
            <div id="customers-react-root" style="display:none;"></div>

            <div class="prospects-table-container" id="customers-table-container">
                <table class="prospects-table">
                    <thead>
                        <tr>
                            <th scope="col">Name</th>
                            <th scope="col">Lifetime Value</th>
                            <th scope="col">Customer Since</th>
                            <th scope="col">Ming Gua</th>
                            <th scope="col">Agent</th>
                            <th scope="col">Health</th>
                            <th scope="col">Status</th>
                            <th scope="col">Actions</th>
                        </tr>
                    </thead>
                    <tbody id="customers-table-body">
                        <!-- Populated by await renderCustomersTable() -->
                    </tbody>
                </table>
            </div>
        </div>
    `;
    await renderCustomersTable();
    await window.app.renderApprovalQueue();
};

// ── Pagination state for customers table ──
let _customerPage = 0;
const _customerPageSize = 50;
// Last total-row count computed by renderCustomersTable — customerPageNav reads
// this directly instead of scraping the rendered pagination DOM text (which has
// two "of N" tokens and is order-fragile). Set on every table render.
let _customerTotalCount = 0;

// ── Phase 4.2 (#13): React-island customers path ─────────────────────────────
// The real Customers table can render via a React island (window.CRMReact,
// loaded only by the opt-in island bundle). Engages when the island bundle is
// present AND the flag is on (?react=1 / localStorage crm_react_island=1 /
// window.__REACT_CUSTOMERS===true) and not explicitly killed
// (window.__REACT_CUSTOMERS===false). Because the bundle is opt-in, this never
// engages for normal users — the legacy table stays the only path until promoted.
const _reactCustomersOn = () => {
    try {
        // DEFAULT ON (promoted 2026-06-14). Kill-switch → legacy table:
        //   window.__REACT_CUSTOMERS===false, ?react=0, or localStorage crm_react_off='1'.
        if (window.__REACT_CUSTOMERS === false) return false;
        if (/[?&]react=0/.test(location.search)) return false;
        if (localStorage.getItem('crm_react_off') === '1') return false;
        return !!(window.CRMReact && typeof window.CRMReact.mountCustomersTable === 'function');
    } catch (_) { /* intentional: feature-detection probe — any failure means React island unavailable */ return false; }
};

// Swap visibility between the React mount root and the legacy table container.
const _showCustomersReactRoot = (useReact) => {
    const root   = document.getElementById('customers-react-root');
    const legacy = document.getElementById('customers-table-container');
    if (root)   root.style.display   = useReact ? '' : 'none';
    if (legacy) legacy.style.display = useReact ? 'none' : '';
};

// Live app-state bridge for lazy-loaded chunks.
// Every getter/setter delegates to the private IIFE `let` — the local
// variable remains authoritative; chunks read/write via this object.
//
// Key conventions (short to minimise minified output):
//   cu    → _state.cu        cv    → _currentView
//   pp    → _prospectPage       cp    → _customerPage
//   cmt   → _currentMarketingTab  cmlt → _currentMarketingListTab
//   ial   → isAdminOrL2 check
//   se    → _selectedEntity     sat   → _selectedAttendees
//   sca   → _selectedCoAgents   scon  → _selectedConsultants
//   sr    → _selectedReferrer   cd    → _currentDate
//   flt   → _filters            cdv   → _currentDetailView
//   hac   → _hotActivityCache   vc    → _venuesCache
//   pc    → _productsCache      rct   → _renderCalendarToken
//   pii   → _pendingIntakeId    pir   → _pendingIntakeRow
//   cppf  → _cpsPendingPhotoFiles

// Phase 2 (#11): fetch a customers page through the BFF (/api/customers). The
// server verifies the JWT and applies the visibility scope (bff_visible_agent_ids),
// so RLS becomes defense-in-depth rather than the only guard. Returns
// {data, count, used:true} or {used:false} on any guard/error so the caller
// falls back to _serverPage/legacy. Behind window.__USE_BFF_CUSTOMERS (default
// OFF). Offset-paginated to match the page-number UI.
const _bffGetCustomers = async ({ limit, offset, search, gua, type }) => {
    try {
        if (!window.supabase?.auth) return { used: false };
        const { data: sess } = await window.supabase.auth.getSession();
        const token = sess?.session?.access_token;
        if (!token) return { used: false };
        const p = new URLSearchParams();
        p.set('limit', String(limit));
        p.set('offset', String(offset));
        if (search) p.set('q', search);
        if (gua) p.set('gua', gua);
        if (type) p.set('type', type);
        const res = await fetch('/api/customers?' + p.toString(), { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) return { used: false };
        const j = await res.json();
        return { data: j.rows || [], count: j.count || 0, used: true };
    } catch (_) {
        /* intentional: BFF unreachable → signal caller to fall back to _serverPage/legacy */
        return { used: false };
    }
};

const renderCustomersTable = async () => {
    const tbody = document.getElementById('customers-table-body');
    if (!tbody) return;

    const allUsers = await AppDataStore.getAll('users');
    const userById = new Map(allUsers.map(u => [String(u.id), u]));

    const _custUserLevel = _getUserLevel(_state.cu);
    const canReassignCust = _custUserLevel <= 5;
    let activeAgentsCust = [];
    if (canReassignCust) {
        const _custScopeIds = _custUserLevel <= 2
            ? null
            : await getVisibleUserIds(_state.cu);
        const _custScopeSet = (_custScopeIds && _custScopeIds !== 'all' && Array.isArray(_custScopeIds))
            ? new Set(_custScopeIds.map(String)) : null;
        activeAgentsCust = allUsers.filter(u => {
            const lvl = _getUserLevel(u);
            if (!(lvl >= 3 && lvl <= 11 && u.status !== 'deleted')) return false;
            if (_custScopeSet) return _custScopeSet.has(String(u.id));
            return true;
        });
    }

    const searchQuery = document.getElementById('customer-search')?.value?.trim()?.toLowerCase() || '';
    const typeFilter = document.getElementById('filter-customer-type')?.value || '';
    const guaFilter = document.getElementById('filter-customer-gua')?.value || '';
    const purchaseFilter = document.getElementById('filter-purchase-status')?.value || '';
    const deficiencyFilter = document.getElementById('filter-customer-deficiency')?.value || '';
    const houseAuditFilter = document.getElementById('filter-customer-house-audit')?.value || '';
    const minEventsFilter = parseInt(document.getElementById('filter-customer-min-events')?.value || '0');

    const pageStart = _customerPage * _customerPageSize;
    let pageCustomers = [];
    let totalCount = 0;

    // ── PHASE 1 (#12): server-side pagination via queryAdvanced ────────────
    // Behind the window.__SERVER_TABLES flag (default OFF → identical legacy
    // behavior). Fetches ONE page (≈50 rows) server-filtered/sorted/paginated
    // instead of pulling the whole customers table to the browser and filtering
    // in JS — the change that lets this view scale to a 500k customer base.
    // Falls through to the legacy client path for filters not yet expressible
    // server-side (Regular null-edge, deficiency arrays, event-count aggregation).
    // Market scope (boss/mgmt drill-down). ALL → no scoping (agents always ALL).
    // A specific market forces the legacy client-filter path (the BFF/server page
    // query has no country param yet) so the filter below actually applies.
    const _mktScope = window._crmUtils.listCountryScope();
    const _mktScoped = _mktScope !== window._crmUtils.ALL_COUNTRIES;
    const _serverUnsupported = typeFilter === 'Regular' || !!deficiencyFilter || minEventsFilter > 0 || !!purchaseFilter || _mktScoped;

    // ── Phase 4.2 (#13): React-island render path (opt-in bundle + flag) ───────
    // Same eligibility as the BFF branch below (the island fetches the same lean
    // BFF page via React Query). For unsupported filters / house-audit /
    // Agent-Eligible we fall through to the legacy DOM render (and hide the root).
    if (_reactCustomersOn() && !_serverUnsupported && !houseAuditFilter && typeFilter !== 'Agent Eligible') {
        const reactRoot = document.getElementById('customers-react-root');
        if (reactRoot) {
            try {
                _showCustomersReactRoot(true);
                window.CRMReact.mountCustomersTable(reactRoot, {
                    params: {
                        q: searchQuery,
                        gua: guaFilter,
                        type: typeFilter === 'VIP' ? 'VIP' : '',
                        page: _customerPage,
                    },
                    pageSize: _customerPageSize,
                    meta: {
                        canReassign: canReassignCust,
                        agents: activeAgentsCust.map(a => ({ id: a.id, full_name: a.full_name || 'Agent' })),
                        agentNames: Object.fromEntries(allUsers.map(u => [String(u.id), u.full_name || ''])),
                    },
                    onNavigate: async (page) => { _customerPage = Math.max(0, page | 0); await renderCustomersTable(); },
                });
                return;
            } catch (e) {
                console.warn('[react-customers] mount failed → legacy:', e?.message || e);
                _showCustomersReactRoot(false);
            }
        }
    }
    // Not using the React path → ensure the legacy table is the visible one.
    _showCustomersReactRoot(false);

    let _usedServer = false;
    // ── PHASE 2 (#11): BFF path (DEFAULT ON; set window.__USE_BFF_CUSTOMERS=false to disable) ──
    // Routes through /api/customers, which verifies the JWT + applies the
    // visibility scope server-side (RLS becomes defense-in-depth). Engages for
    // the BFF-supported filter set (search / ming_gua / VIP); house-audit +
    // Agent-Eligible have no column so they fall through to _serverPage/legacy.
    // Any guard/error → {used:false} → _serverPage/legacy fallback (verified
    // end-to-end live 2026-06-14: count 164, scoped rows render).
    if (window.__USE_BFF_CUSTOMERS !== false && !_serverUnsupported && !houseAuditFilter && typeFilter !== 'Agent Eligible') {
        const r = await _bffGetCustomers({
            limit: _customerPageSize, offset: pageStart,
            search: searchQuery, gua: guaFilter,
            type: typeFilter === 'VIP' ? 'VIP' : '',
        });
        if (r.used) { pageCustomers = r.data; totalCount = r.count; _usedServer = true; }
    }
    if (window.__SERVER_TABLES && !_serverUnsupported && !_usedServer) {
        const opts = {
            limit: _customerPageSize, offset: pageStart,
            sort: 'full_name', sortDir: 'asc',
            searchFields: ['full_name', 'nickname', 'phone', 'email'],
            filters: {}, scopeBy: ['responsible_agent_id', 'agent_id'],
        };
        if (searchQuery) opts.search = searchQuery;
        if (guaFilter) opts.filters.ming_gua = guaFilter;
        if (houseAuditFilter) opts.filters.house_audit_status = houseAuditFilter;
        if (typeFilter === 'VIP') opts.gte = { lifetime_value: 5000 };
        else if (typeFilter === 'Agent Eligible') opts.filters.agent_eligible = true;
        const r = await _serverPage('customers', opts);
        if (r.used) { pageCustomers = r.data; totalCount = r.count; _usedServer = true; }
    }

    if (!_usedServer) {
        // ── Legacy client path (full-table fetch + filter + slice) ──
        const customers = await getVisibleCustomers();
        // REND-11 DE-QUAD: bucket event_registrations by attendee_id ONCE into a
        // count Map (only the .length per customer is consumed) instead of a full
        // per-customer array scan (N×M). Raw key preserves the original strict
        // `r.attendee_id === c.id` comparison (Map distinguishes 5 from "5").
        let eventCountByAttendee = null;
        if (minEventsFilter > 0) {
            const allEventRegs = await AppDataStore.getAll('event_registrations');
            // Match the Events tab: only count CUSTOMER-type registrations in a valid
            // attendance status (prospects share an independent id sequence, and
            // cancelled/invalid registrations must not inflate the count).
            const VALID_REG_STATUSES_MIN = new Set(['Registered', 'Attended', 'No Show']);
            eventCountByAttendee = new Map();
            for (const r of allEventRegs) {
                if (r.attendee_type !== 'customer') continue;
                if (!VALID_REG_STATUSES_MIN.has(r.attendance_status)) continue;
                eventCountByAttendee.set(r.attendee_id, (eventCountByAttendee.get(r.attendee_id) || 0) + 1);
            }
        }
        let filtered = [];
        for (const c of customers) {
            if (_mktScoped && window._crmUtils.recordCountry(c) !== _mktScope) continue;
            if (searchQuery && !(
                (c.full_name || '').toLowerCase().includes(searchQuery) ||
                (c.nickname && c.nickname.toLowerCase().includes(searchQuery)) ||
                (c.phone && c.phone.includes(searchQuery)) ||
                (c.email && c.email.toLowerCase().includes(searchQuery))
            )) continue;
            if (guaFilter && c.ming_gua !== guaFilter) continue;
            if (typeFilter === 'VIP' && (c.lifetime_value || 0) < 5000) continue;
            if (typeFilter === 'Regular' && (c.lifetime_value || 0) >= 5000) continue;
            if (typeFilter === 'Agent Eligible' && !(c.agent_eligible || c.is_agent_eligible)) continue;
            if (deficiencyFilter) {
                const needs = c.needs ? (Array.isArray(c.needs) ? c.needs : c.needs.split(',').map(t => t.trim())) : [];
                if (!needs.includes(deficiencyFilter)) continue;
            }
            if (houseAuditFilter) {
                const auditStatus = c.house_audit_status || 'None';
                if (auditStatus !== houseAuditFilter) continue;
            }
            if (minEventsFilter > 0) {
                const attendedCount = eventCountByAttendee.get(c.id) || 0;
                if (attendedCount < minEventsFilter) continue;
            }
            filtered.push(c);
        }
        totalCount = filtered.length;
        pageCustomers = filtered.slice(pageStart, pageStart + _customerPageSize);
    }

    // REND-5: build the agent <option> pieces ONCE (escapeHtml + value are
    // agent-only) instead of rebuilding the full <select> option list in every
    // row. Per row only the ` selected` token varies — `head` ends right where
    // the original placed it (`value="X" `) and `tail` carries the rest, so the
    // emitted markup (incl. the trailing space before `>` on non-selected
    // options) is byte-identical to the previous inline .map().join('').
    const _custAgentOptPieces = activeAgentsCust.map(a => ({
        idStr: String(a.id),
        head: `<option value="${a.id}" `,
        tail: `>${escapeHtml(a.full_name || 'Agent')}</option>`,
    }));

    let html = '';
    for (const c of pageCustomers) {
        const agent = userById.get(String(c.responsible_agent_id || c.agent_id));
        const agentName = agent ? agent.full_name : '—';

        html += `
            <tr onclick="app.showCustomerDetail(${c.id})">
                <td data-label="Name"><strong>${escapeHtml(c.full_name || '')}</strong>${c.converted_from_prospect_id != null ? `<span data-pot-chip="${Number(c.converted_from_prospect_id)}"></span>` : ''}</td>
                <td data-label="Lifetime Value">${UI.money(c.lifetime_value || 0, c.country)} <span style="color:var(--success); font-size:12px;"><i class="fas fa-caret-up"></i></span></td>
                <td data-label="Customer Since">${escapeHtml(c.customer_since || '—')}</td>
                <td data-label="Ming Gua">${escapeHtml(c.ming_gua || '—')}</td>
                <td data-label="Agent" onclick="event.stopPropagation()">${canReassignCust
                    ? `<select class="form-control" style="padding:2px 6px;font-size:12px;min-width:120px;border:1px solid var(--border);border-radius:4px;background:var(--surface);cursor:pointer;" onchange="app.quickReassign(${c.id}, this.value, 'customer')" title="Reassign agent">${(() => {
                        const cid = (c.responsible_agent_id || c.agent_id) ? String(c.responsible_agent_id || c.agent_id) : '';
                        if (!cid) return '<option value="" selected></option>';
                        if (activeAgentsCust.some(a => String(a.id) === cid)) return '';
                        const u = userById.get(cid);
                        if (!u || !u.full_name) return '<option value="" selected></option>';
                        return `<option value="${escapeHtml(cid)}" selected>${escapeHtml(u.full_name)}</option>`;
                    })()}${(() => {
                        const _selId = String(c.responsible_agent_id || c.agent_id);
                        return _custAgentOptPieces.map(o => o.head + (o.idStr === _selId ? 'selected' : '') + o.tail).join('');
                    })()}</select>`
                    : ((c.responsible_agent_id || c.agent_id) ? escapeHtml(agentName) : '')}</td>
                <td data-label="Health">${renderQuickHealthBadge(c)}</td>
                <td data-label="Status"><span class="score-badge score-A+">${(c.status || 'active').toUpperCase()}</span></td>
                <td onclick="event.stopPropagation()">
                    <button class="btn-icon" title="Edit"><i class="fas fa-edit"></i></button>
                    <button class="btn-icon" title="Add Purchase" onclick="app.openAddPurchaseModal(${c.id})"><i class="fas fa-shopping-cart"></i></button>
                    <button class="btn-icon" title="Referral" onclick="event.stopPropagation(); app.openCustomerReferralModal(${c.id})"><i class="fas fa-user-plus"></i></button>
                    <button class="btn-icon" title="Recruit" onclick="app.openRecruitModal(${c.id})"><i class="fas fa-user-tie"></i></button>
                    ${(() => {
                        // Desktop-only WhatsApp shortcut. Opens the chat directly (wa.me),
                        // NOT the Meta Business API modal the detail view uses. Number is
                        // normalized at render so the inline onclick carries digits only.
                        const _wa = waPhone(c.phone);
                        return _wa ? `<button class="btn-icon" title="WhatsApp ${escapeHtml(c.phone)}" style="color:#25d366;" onclick="app.openWaChat('${_wa}')"><i class="fab fa-whatsapp"></i></button>` : '';
                    })()}
                </td>
            </tr>
        `;
    }
    tbody.innerHTML = html || '<tr><td colspan="8" style="text-align:center; padding:20px;">No customers found</td></tr>';

    // ── Render pagination controls ──
    _customerTotalCount = totalCount; // remember for customerPageNav (no DOM scraping)
    const totalPages = Math.ceil(totalCount / _customerPageSize);
    let paginationEl = document.getElementById('customers-pagination');
    if (!paginationEl) {
        paginationEl = document.createElement('div');
        paginationEl.id = 'customers-pagination';
        paginationEl.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;padding:16px 0;flex-wrap:wrap;';
        tbody.closest('.prospects-table-container')?.appendChild(paginationEl);
    }
    if (totalPages <= 1) {
        paginationEl.innerHTML = `<span style="color:var(--text-secondary);font-size:13px;">${totalCount} customer${totalCount !== 1 ? 's' : ''}</span>`;
    } else {
        const currentPage = _customerPage + 1;
        const from = pageStart + 1;
        const to = Math.min(pageStart + _customerPageSize, totalCount);
        let pgHtml = `<span style="color:var(--text-secondary);font-size:13px;">Showing ${from}–${to} of ${totalCount}</span>`;
        pgHtml += `<button class="btn secondary btn-sm" ${_customerPage === 0 ? 'disabled' : ''} onclick="app.customerPageNav('first')" title="First page"><i class="fas fa-angle-double-left"></i></button>`;
        pgHtml += `<button class="btn secondary btn-sm" ${_customerPage === 0 ? 'disabled' : ''} onclick="app.customerPageNav('prev')"><i class="fas fa-angle-left"></i> Prev</button>`;
        pgHtml += `<span style="font-weight:600;font-size:14px;">Page ${currentPage} of ${totalPages}</span>`;
        pgHtml += `<button class="btn secondary btn-sm" ${currentPage >= totalPages ? 'disabled' : ''} onclick="app.customerPageNav('next')">Next <i class="fas fa-angle-right"></i></button>`;
        pgHtml += `<button class="btn secondary btn-sm" ${currentPage >= totalPages ? 'disabled' : ''} onclick="app.customerPageNav('last')" title="Last page"><i class="fas fa-angle-double-right"></i></button>`;
        paginationEl.innerHTML = pgHtml;
    }
};

const customerPageNav = async (dir) => {
    // Use the in-memory row total from the last render rather than scraping the
    // pagination DOM text (which contains two "of N" tokens and is order-fragile).
    const total = _customerTotalCount || 0;
    const lastPage = Math.max(0, Math.ceil(total / _customerPageSize) - 1);
    if (dir === 'first') _customerPage = 0;
    else if (dir === 'prev') _customerPage = Math.max(0, _customerPage - 1);
    else if (dir === 'next') _customerPage = Math.min(lastPage, _customerPage + 1);
    else if (dir === 'last') _customerPage = lastPage;
    await renderCustomersTable();
};

const filterCustomers = async () => {
    _customerPage = 0; // reset to first page when filters change
    await renderCustomersTable();
};

// ========== MANAGER APPROVAL QUEUE ==========

// Sections whose records are stored under the person's ORIGINAL prospect id
// (forms, name list + appraisal photos, feng shui audits, Bujishu / Formula
// purchase history). After conversion the customer profile is the only profile
// anyone opens, so it shows them — rendered by the prospect chunk's own section
// renderer against the linked prospect id. The body ids deliberately use the
// prospect-profile pattern (acc-body-<tab>-<pid>): those renderers' post-save
// refreshes look elements up by exactly that id, so edits refresh in place here.
const _LINKED_PROSPECT_SECTIONS = [
    ['forms',    'fas fa-clipboard-list', 'Customer Forms'],
    ['names',    'fas fa-users',          'Name List'],
    ['fengshui', 'fas fa-compass',        'Feng Shui Audit'],
    ['bujishu',  'fas fa-gem',            'Bujishu purchases'],
    ['formula',  'fas fa-heartbeat',      'Formula Healthcare purchases'],
    ['docs',     'fas fa-folder',         'Documents'],
];
// Contracts renderer lives in the lazily-loaded forms chunk. It was called
// without loading it (since the chunk split), so the section sat on
// "Loading…" forever whenever the forms chunk hadn't been opened yet.
const _renderCustomerContracts = async (customer, containerId) => {
    if (!window.app.renderCustomerContractsTab && typeof window._loadChunk === 'function') {
        try { await window._loadChunk('chunks/script-forms.min.js'); } catch (_) { /* intentional: handled below */ }
    }
    if (typeof window.app.renderCustomerContractsTab === 'function') {
        return window.app.renderCustomerContractsTab(customer, ...(containerId ? [containerId] : []));
    }
    const el = containerId && document.getElementById(containerId);
    if (el) el.innerHTML = '<p style="color:var(--gray-500);font-size:13px;">Could not load contracts. Please reload and try again.</p>';
};

const _linkedProspectSectionsHtml = (prospectId, tabs = null, pane = '') => {
    if (prospectId == null) return '';
    const pid = Number(prospectId);
    if (!Number.isFinite(pid)) return '';
    return (tabs || _LINKED_PROSPECT_SECTIONS.map(s => s[0])).map(t => _LINKED_PROSPECT_SECTIONS.find(s => s[0] === t)).filter(Boolean).map(([tab, icon, label]) => `
                <div class="acc-item" id="acc-${tab}-${pid}"${pane ? ` data-pane="${pane}"` : ''}>
                    <div class="acc-hdr" role="button" tabindex="0" aria-expanded="false" onclick="app.toggleAccordion('${tab}',${pid},this.parentElement);this.setAttribute('aria-expanded',this.parentElement.classList.contains('open'))" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">
                        <span><i class="${icon}" aria-hidden="true"></i> ${label}</span>
                        <i class="fas fa-chevron-down acc-chev" aria-hidden="true"></i>
                    </div>
                    <div class="acc-body" id="acc-body-${tab}-${pid}" style="display:none" data-loaded="false"></div>
                </div>`).join('');
};

// One customer profile section. Ids (cust-acc-<key>-<id> / cust-acc-body-<key>-<id>)
// are looked up by refreshes elsewhere — only order and grouping may change.
const _cvAccItem = (key, cid, icon, title, open = false, pane = '') => `
                <div class="acc-item${open ? ' open' : ''}" id="cust-acc-${key}-${cid}"${pane ? ` data-pane="${pane}"` : ''}>
                    <div class="acc-hdr" role="button" tabindex="0" aria-expanded="${open}" onclick="app.toggleCustomerAccordion('${key}',${cid},this.parentElement);this.setAttribute('aria-expanded',this.parentElement.classList.contains('open'))" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">
                        <span><i class="fas ${icon}" aria-hidden="true"></i> ${title}</span>
                        <i class="fas fa-chevron-down acc-chev" aria-hidden="true"></i>
                    </div>
                    ${open
                        ? `<div class="acc-body pv-compact" id="cust-acc-body-${key}-${cid}"><div class="acc-loading"><i class="fas fa-spinner fa-spin"></i> Loading…</div></div>`
                        : `<div class="acc-body" id="cust-acc-body-${key}-${cid}" style="display:none" data-loaded="false"></div>`}
                </div>`;

const showCustomerDetail = async (customerId) => {
    // Snapshot originating view BEFORE any await — a concurrent navigateTo during
    // the async gap would overwrite _state.cv, corrupting the back-destination.
    const _fromView = _state.cv;
    const customer = await AppDataStore.getById('customers', customerId);
    if (!customer || !await canViewCustomer(customer)) {
        UI.toast.error('You do not have permission to view this customer.');
        await navigateTo('prospects');
        return;
    }
    // The linked-prospect sections, the accordion toggles and the profile
    // snapshot header are rendered by the prospects chunk — warm it so the first
    // tap on a section isn't a no-op. _loadChunk is load-once (a cached promise),
    // so this is free when it's warm.
    if (typeof window._loadChunk === 'function') {
        try { await window._loadChunk('chunks/script-prospects.min.js'); } catch (_) { /* intentional: sections stay inert, profile still renders */ }
    }
    _state.pvd = _fromView;
    _state.cdv = { type: 'customer', id: customerId };

    setTimeout(async () => {
        await addWhatsAppButtonToProfile('customer', customerId);
    }, 100);

    const health = await calculateCustomerHealthScore(customer);

    const cid = customer.id;
    const lpid = customer.converted_from_prospect_id;
    // Count badges are revealed below (display + text) — keep the ids.
    const impBadge  = `<span id="cust-imp-badge-${cid}" class="acc-count is-success" style="display:none;"></span>`;
    const hostBadge = `<span id="cust-host-badge-${cid}" class="acc-count" style="display:none;"></span>`;

    // WhatsApp opens the customer's chat directly (not the Business API
    // composer). The number is normalized so the onclick carries digits only;
    // an empty string makes openWaChat toast.
    const container = document.getElementById('content-viewport');
    container.innerHTML = `
        <div class="pv-wrap">
            <div class="pv-back">
                <button class="btn secondary btn-sm" onclick="app.goBackFromDetail()">
                    <i class="fas fa-arrow-left" aria-hidden="true"></i> Back to List
                </button>
            </div>
            <div class="pv-hdr pv-hdr-flex">
                <div style="flex:1;min-width:0;">
                    <div class="pv-hdr-meta">
                        <span class="pv-id">ID: C${cid}</span>
                        <span class="pv-chip is-success"><i class="fas fa-circle" aria-hidden="true" style="font-size:7px;"></i> Customer</span>
                        ${renderHealthBadge(health)}
                        <span class="pv-chip"><i class="fas fa-lock" aria-hidden="true"></i> Permanent</span>
                    </div>
                    <h1 class="pv-name">${escapeHtml(customer.full_name)}${(window.app.pvDetailsBtnHtml || (() => ''))('customer', cid)}</h1>
                    ${(window.app.pvFactsHtml || (() => ''))(customer, [
                        `<span class="pv-fact">Customer since ${escapeHtml(customer.customer_since || '-')}${customer.conversion_amount != null ? ` · ${escapeHtml(UI.money(customer.conversion_amount, customer.country))}` : ''}</span>`,
                    ])}
                    <div class="pv-actions">
                        <button class="btn primary btn-sm pv-cta" onclick="app.openActivityModal(null, 'customer', ${cid})"><i class="fas fa-calendar-plus" aria-hidden="true"></i> Book follow-up</button>
                        <button class="pv-act is-whatsapp" title="WhatsApp" aria-label="Open WhatsApp chat with customer" onclick="event.stopPropagation();app.openWaChat('${waPhone(customer.phone)}')"><i class="fab fa-whatsapp" aria-hidden="true"></i></button>
                        ${waPhone(customer.phone) ? `<a class="pv-act" href="tel:${escapeHtml(String(customer.phone || '').replace(/[^\d+]/g, ''))}" title="Call" aria-label="Call customer"><i class="fas fa-phone" aria-hidden="true"></i></a>` : ''}
                        ${(window.app.pvMenuHtml || (() => ''))([
                            ['fas fa-plus', 'Add purchase', `app.openAddPurchaseModal(${cid})`],
                            ['fas fa-user-friends', 'Log a meet up', `app.openActivityModal(null, 'customer', ${cid})`],
                            /* Edits the CUSTOMER (2026-10-16) — the customer is the one
                               editable record; a converted prospect's profile is frozen. */
                            ['fas fa-edit', 'Edit profile', `app.openCustomerEditModal(${cid})`],
                            null,
                            ['fas fa-user-plus', 'Refer a friend', `app.openCustomerReferralModal(${cid})`],
                            ['fas fa-external-link-alt', 'Send portal link', `app.sendPortalLink(${cid})`],
                            ['fas fa-user-tie', 'Recruit as agent', `app.openRecruitModal(${cid})`],
                        ])}
                    </div>
                </div>
            </div>
            ${(window.app.pvSnapHtml || (() => ''))('customer', cid, lpid != null ? Number(lpid) : null)}

            ${/* Tabs — same four areas as the prospect profile (prospects chunk). */
              (window.app.pvTabsHtml || (() => ''))('customer', cid)}
            <div class="acc-container" id="cust-acc-container-${cid}" data-tab="engagement">
                ${_cvAccItem('tasks', cid, 'fa-list-check', `Next up <span id="cust-tasks-badge-${cid}" class="acc-count" style="display:none;"></span>`, false, 'engagement')}
                ${_cvAccItem('activity', cid, 'fa-user-friends', 'Meet Ups &amp; Events', false, 'engagement')}
                ${_cvAccItem('improvements', cid, 'fa-seedling', `改命后的进步 ${impBadge}`, false, 'engagement')}
                ${/* 汇集接待 rows come from event_huiji_details, whose RLS already
                      scopes to the viewer's own created events (managers L≤5 see all). */
                  _cvAccItem('hosting', cid, 'fa-home', `汇集接待 Hosting ${hostBadge}`, false, 'engagement')}
                ${_cvAccItem('notes', cid, 'fa-sticky-note', 'Notes', false, 'engagement')}

                ${_cvAccItem('potential', cid, 'fa-bolt', 'Opportunities', false, 'opportunities')}
                ${_cvAccItem('journey', cid, 'fa-route', 'Journey stage', false, 'opportunities')}
                ${_linkedProspectSectionsHtml(lpid, ['fengshui'], 'opportunities')}
                ${_cvAccItem('referrals', cid, 'fa-user-plus', 'Referrals Made', false, 'opportunities')}
                ${_linkedProspectSectionsHtml(lpid, ['names'], 'opportunities')}
                ${_cvAccItem('eligibility', cid, 'fa-user-tie', 'Agent Eligibility', false, 'opportunities')}

                ${_cvAccItem('closing', cid, 'fa-handshake', 'DC Closing Record', false, 'records')}
                ${_linkedProspectSectionsHtml(lpid, ['bujishu', 'formula'], 'records')}
                ${_cvAccItem('contracts', cid, 'fa-file-contract', 'Contracts', false, 'records')}
                ${_linkedProspectSectionsHtml(lpid, ['forms', 'docs'], 'records')}

                ${_cvAccItem('info', cid, 'fa-info-circle', 'Basic Information', false, 'details')}
                ${_cvAccItem('bank', cid, 'fa-university', 'Bank &amp; Payment', false, 'details')}
                ${_cvAccItem('platforms', cid, 'fa-id-badge', 'Platform IDs', false, 'details')}
                ${_cvAccItem('tags', cid, 'fa-tags', 'Tags', false, 'details')}
            </div>
        </div>
    `;
    // Opens on Engagement: Next up + the timeline load now, every other section
    // when its tab is first shown. (Overdue journey steps are counted in Next
    // up — the Journey Tracker no longer carries its own badge.)
    Promise.resolve((window.app.fillProfileSnapshot || (() => {}))({ kind: 'customer', id: cid, pid: lpid != null ? Number(lpid) : null })).catch(() => {});
    Promise.resolve((window.app.pvShowTab || (() => {}))('customer', cid, 'engagement')).catch(() => {});
    // Async: populate 改命后的进步 count badge. id-only count — the full rows
    // (story bodies) are only fetched when the section is actually opened.
    AppDataStore.queryAdvanced('customer_improvements', { select: 'id', filters: { customer_id: customer.id }, limit: 1, countMode: 'exact' }).then(res => {
        const n = (res && res.count) || 0;
        const badge = document.getElementById(`cust-imp-badge-${customer.id}`);
        if (badge && n > 0) {
            badge.textContent = n;
            badge.style.display = 'inline';
        }
    }).catch(() => {});
    // Async: populate 汇集接待 hosting count badge (RLS-scoped per viewer).
    AppDataStore.queryAdvanced('event_huiji_details', { select: 'id', filters: { owner_customer_id: customer.id }, limit: 1, countMode: 'exact' }).then(res => {
        const n = (res && res.count) || 0;
        const badge = document.getElementById(`cust-host-badge-${customer.id}`);
        if (badge && n > 0) {
            badge.textContent = n;
            badge.style.display = 'inline';
        }
    }).catch(() => {});
};

const switchProfileTab = async (btn, tabName, cId) => {
    document.querySelectorAll('.profile-tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    const customerId = cId || 101; // Mocking fallback
    const customer = await AppDataStore.getById('customers', customerId);
    if (!customer) return;

    if (tabName === 'basic') await renderBasicBankTab(customer);
    else if (tabName === 'platforms') await renderPlatformIdsTab(customer);
    else if (tabName === 'purchases') await renderPurchaseHistoryTab(customer);
    else if (tabName === 'activity') await renderCustomerActivityTab(customer);
    else if (tabName === 'referrals') await renderReferralsTab(customer);
    else if (tabName === 'contracts') await _renderCustomerContracts(customer);
    else if (tabName === 'events') {
        // Legacy tab UI only — the accordion profile now shows events inside the
        // merged renderCustomerActivityTab timeline. event_attendees is the row
        // the event modal writes, event_registrations only the Attended-tick
        // side-effect. Read both, attendees first, and never list an event twice.
        const [allRegs, allEvents, attendeeRows] = await Promise.all([
            AppDataStore.getAll('event_registrations'),
            AppDataStore.getAll('events'),
            (window.app.getProspectAttendeeNotes || (() => Promise.resolve([])))(
                customerId, { includeWithoutNotes: true, attendeeType: 'customer' }
            ),
        ]);
        const eventsById = new Map((allEvents || []).map(e => [String(e.id), e]));
        const coveredEventIdsC = new Set(
            (attendeeRows || []).map(a => a.event_id).filter(v => v != null).map(String)
        );
        const VALID_REG_STATUSES_C = new Set(['Registered', 'Attended', 'No Show']);
        const registrations = (allRegs || []).filter(
            r => r.attendee_type === 'customer'
                && r.attendee_id == customerId
                && VALID_REG_STATUSES_C.has(r.attendance_status)
                && !coveredEventIdsC.has(String(r.event_id))
        );
        const _tsC = (d) => { const t = Date.parse(d || ''); return Number.isNaN(t) ? 0 : t; };
        const sortedAttendeesC = [...(attendeeRows || [])]
            .sort((a, b) => _tsC(b.activity_date) - _tsC(a.activity_date));
        let html = '<h4>Events Attended</h4>';
        if (registrations.length === 0 && sortedAttendeesC.length === 0) {
            html += '<p>No events attended.</p>';
        } else {
            html += '<table class="events-table"><thead><tr><th scope="col">Event</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col">Points</th></tr></thead><tbody>';
            for (const a of sortedAttendeesC) {
                const event = eventsById.get(String(a.event_id));
                const title = a.activity_title || event?.title || event?.event_title || 'Event';
                const status = a.attendance_status === 'No Show' ? 'No Show'
                    : a.attendance_status === 'Late' ? 'Late'
                    : (a.attended || a.attendance_status === 'Attended') ? 'Attended'
                    : 'Registered';
                const flags = [a.paid ? 'Paid' : null, a.ticket_created ? 'Ticket' : null]
                    .filter(Boolean).join(' · ');
                html += `<tr><td>${escapeHtml(title)}</td><td>${escapeHtml(a.activity_date || '-')}</td><td>${escapeHtml(status)}${flags ? ` <span style="color:var(--gray-500);font-size:11px;">(${escapeHtml(flags)})</span>` : ''}</td><td>-</td></tr>`;
            }
            for (const r of registrations) {
                const event = eventsById.get(String(r.event_id));
                // escape attendance_status like every sibling field (defense in depth;
                // normally a controlled enum but rendered raw was an inconsistency).
                html += `<tr><td>${escapeHtml(event?.title || 'Unknown')}</td><td>${escapeHtml(r.event_date || '-')}</td><td>${escapeHtml(r.attendance_status || '')}</td><td>${r.points_awarded || 0}</td></tr>`;
            }
            html += '</tbody></table>';
        }
        document.getElementById('profile-tab-content').innerHTML = html;
    }
};

const switchCustomerProfileTab = async (tab, customerId, container) => {
    // Basic Information reads the live row first (a cached snapshot can lag an
    // edit); other tabs use the cached copy. Offline → cache.
    const customer = (tab === 'info' ? await AppDataStore.getByIdFull('customers', customerId) : null)
        || await AppDataStore.getById('customers', customerId);
    if (!container || !customer) return;

    if (tab === 'info') {
        let _agentName = 'Unassigned';
        if (customer.responsible_agent_id) {
            const _agent = await AppDataStore.getById('users', customer.responsible_agent_id).catch(() => null);
            _agentName = _agent?.full_name || 'Unassigned';
        }
        container.innerHTML = `
            <div class="pv-sub">Contact</div>
            <div class="pv-row"><span class="pv-lbl">Full Name</span><span class="pv-val"><strong>${escapeHtml(customer.full_name)}</strong></span></div>
            <div class="pv-row"><span class="pv-lbl">Phone</span><span class="pv-val">${escapeHtml(customer.phone || '-')}${customer.phone ? ` <a class="pv-inline-act" href="tel:${escapeHtml(String(customer.phone).replace(/[^\d+]/g, ''))}" aria-label="Call ${escapeHtml(customer.full_name || '')}"><i class="fas fa-phone" aria-hidden="true"></i></a>` : ''}</span></div>
            <div class="pv-row"><span class="pv-lbl">Email</span><span class="pv-val">${escapeHtml(customer.email || '-')}${customer.email ? ` <a class="pv-inline-act" href="mailto:${escapeHtml(String(customer.email).trim())}" aria-label="Email ${escapeHtml(customer.full_name || '')}"><i class="fas fa-envelope" aria-hidden="true"></i></a>` : ''}</span></div>
            <div class="pv-sub">Identity</div>
            ${customer.title ? `<div class="pv-row"><span class="pv-lbl">Title</span><span class="pv-val">${escapeHtml(customer.title)}</span></div>` : ''}
            ${customer.nickname ? `<div class="pv-row"><span class="pv-lbl">Nickname</span><span class="pv-val">${escapeHtml(customer.nickname)}</span></div>` : ''}
            <div class="pv-row"><span class="pv-lbl">Gender</span><span class="pv-val">${escapeHtml(customer.gender || '-')}</span></div>
            ${customer.nationality ? `<div class="pv-row"><span class="pv-lbl">Nationality</span><span class="pv-val">${escapeHtml(customer.nationality)}</span></div>` : ''}
            <div class="pv-row"><span class="pv-lbl">IC Number</span><span class="pv-val">${escapeHtml(customer.ic_number || '-')}</span></div>
            ${(() => {
                // Life-chart birth date(s) in red — same marking as the prospect profile
                // ('both' = solar + lunar). Changed via Edit.
                const hi = 'font-weight:700;color:#dc2626;';
                const sol = ['solar', 'both'].includes(customer.life_chart_type);
                const lun = ['lunar', 'both'].includes(customer.life_chart_type);
                const tag = '<span title="Used for the life chart" style="font-size:10px;font-weight:700;color:#dc2626;margin-left:6px;">CHART</span>';
                return `<div class="pv-row"><span class="pv-lbl" style="${sol ? hi : ''}">Date of Birth</span><span class="pv-val" style="${sol ? hi : ''}">${escapeHtml(customer.date_of_birth || '-')}${customer.date_of_birth ? ` (Age ${Math.floor((Date.now() - new Date(customer.date_of_birth).getTime()) / 31557600000)})` : ''}${sol ? tag : ''}</span></div>
                    <div class="pv-row"><span class="pv-lbl" style="${lun ? hi : ''}">Lunar Birth</span><span class="pv-val" style="${lun ? hi : ''}">${escapeHtml(customer.lunar_birth || '-')}${lun ? tag : ''}</span></div>`;
            })()}
            <div class="pv-row"><span class="pv-lbl">Ming Gua</span><span class="pv-val"><span style="color:#6b21a8;font-weight:600;">${escapeHtml(customer.ming_gua || '-')}${customer.element ? ' (' + escapeHtml(customer.element) + ')' : ''}</span></span></div>
            <div class="pv-sub">Family</div>
            <div class="pv-row"><span class="pv-lbl">Marital Status</span><span class="pv-val">${escapeHtml(customer.marital_status || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Spouse</span><span class="pv-val">${escapeHtml(customer.spouse_name || '-')}</span></div>
            ${(() => {
                // children: JSON [{ name, birth_year, gender }] (older rows: { age, gender }),
                // copied from the prospect on conversion.
                let kids = [];
                try { kids = Array.isArray(customer.children) ? customer.children : (customer.children ? JSON.parse(customer.children) : []); } catch (_) { kids = []; }
                if (!Array.isArray(kids)) kids = [];
                return `<div class="pv-row"><span class="pv-lbl">Children</span><span class="pv-val">${kids.length}</span></div>` + kids.map((c, i) => {
                    c = c || {};
                    const parts = [c.name, c.birth_year ? `b. ${c.birth_year}` : (c.age != null && c.age !== '' ? `age ${c.age}` : ''), c.gender].filter(Boolean);
                    return `<div class="pv-row"><span class="pv-lbl">Child ${i + 1}</span><span class="pv-val">${escapeHtml(parts.join(' · ') || '-')}</span></div>`;
                }).join('');
            })()}
            <div class="pv-sub">Employment</div>
            <div class="pv-row"><span class="pv-lbl">Occupation</span><span class="pv-val">${escapeHtml(customer.occupation || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Company</span><span class="pv-val">${escapeHtml(customer.company_name || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Income</span><span class="pv-val">${escapeHtml(customer.income_range || '-')}</span></div>
            ${(customer.is_own_business || customer.business_name) ? `
            <div class="pv-row"><span class="pv-lbl">Own Business?</span><span class="pv-val">✅ Yes</span></div>
            <div class="pv-row"><span class="pv-lbl">Business Name</span><span class="pv-val">${escapeHtml(customer.business_name || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Industry</span><span class="pv-val">${escapeHtml(customer.business_industry || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Business Area</span><span class="pv-val">${escapeHtml(customer.business_area || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Customer Title</span><span class="pv-val">${escapeHtml(customer.business_title_role || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Operating Since</span><span class="pv-val">${escapeHtml(customer.business_started || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Company Size</span><span class="pv-val">${escapeHtml(customer.company_size || '-')}</span></div>` : ''}
            <div class="pv-sub">Address</div>
            <div class="pv-row"><span class="pv-lbl">Address</span><span class="pv-val">${escapeHtml([customer.address, customer.city, customer.state, customer.postal_code].filter(Boolean).join(', ') || '-')}</span></div>
            <div class="pv-sub">Referral Information</div>
            <div class="pv-row"><span class="pv-lbl">Agent</span><span class="pv-val">${escapeHtml(_agentName)}</span></div>
            <div class="pv-row"><span class="pv-lbl">Referred By</span><span class="pv-val">${escapeHtml(customer.referred_by || '-')}${(customer.referred_by && customer.referred_by_id == null) ? ' <span title="Typed by hand — not linked to a record" style="font-size:11px;font-weight:400;color:var(--gray-400);">(not linked)</span>' : ''}</span></div>
            <div class="pv-row"><span class="pv-lbl">Relationship</span><span class="pv-val">${escapeHtml(customer.referral_relationship || '-')}</span></div>
            ${(customer.source || customer.original_source) ? `<div class="pv-row"><span class="pv-lbl">Lead Source</span><span class="pv-val">${escapeHtml([customer.source, customer.original_source && customer.original_source !== customer.source ? customer.original_source : ''].filter(Boolean).join(' · '))}</span></div>` : ''}
            ${(() => {
                // Background carried over from the prospect (2026-10-16), editable via Edit.
                const rows = [
                    ['Interest', customer.cps_interest], ['Interests', customer.interests],
                    ['Pain Points', customer.pain_points], ['Budget', customer.budget_range],
                    ['Decision Maker', customer.decision_maker],
                    ['Tags', Array.isArray(customer.tags) ? customer.tags.join(', ') : customer.tags],
                    ['Notes', customer.notes],
                ].filter(([, v]) => v != null && String(v).trim() !== '');
                return rows.length ? `<div class="pv-sub">Background</div>` + rows.map(([l, v]) =>
                    `<div class="pv-row"><span class="pv-lbl">${l}</span><span class="pv-val" style="white-space:pre-wrap;">${escapeHtml(String(v))}</span></div>`).join('') : '';
            })()}
            ${(() => {
                // CPS form carried over from the prospect (stored in the private bucket).
                const url = customer.cps_form_url || '';
                if (!url) return '';
                const isImg = /\.(jpe?g|png|gif|webp|heic|heif)(\?|$)/i.test(url);
                return `<div class="pv-sub">CPS Form</div>
                    <div class="pv-row"><span class="pv-lbl">Uploaded</span><span class="pv-val">${escapeHtml(customer.cps_form_date || '-')}</span></div>
                    <div class="pv-row"><span class="pv-lbl">File</span><span class="pv-val"><a href="#" onclick="event.preventDefault();window._openAttachment&&window._openAttachment('${UI.escJsAttr(String(url))}')">${isImg ? '<i class="fas fa-image"></i>' : '<i class="fas fa-download"></i>'} ${escapeHtml(customer.cps_form_name || 'CPS Form')}</a></span></div>`;
            })()}
        `;
        const cfDisplay = await (window.app.renderCustomFieldDisplay || (() => ''))('customer', customer.id);
        if (cfDisplay) container.insertAdjacentHTML('beforeend', cfDisplay);
    }
    else if (tab === 'bank') {
        // Derive last-purchase date from the purchases table (max(date)) — customers
        // carry no maintained last_purchase_date column, so reading it always yields '-'.
        let _lastPur = '-';
        try {
            const _purs = await AppDataStore.query('purchases', { customer_id: customer.id });
            const _dates = (_purs || []).map(p => p.date).filter(Boolean).sort();
            if (_dates.length) _lastPur = _dates[_dates.length - 1];
        } catch (_e) { /* offline / RLS — leave as '-' */ }
        container.innerHTML = `
            <div class="pv-sub">Bank &amp; Payment</div>
            <div class="pv-row"><span class="pv-lbl">Bank Name</span><span class="pv-val">${escapeHtml(customer.bank_name || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Account Number</span><span class="pv-val">${customer.account_number ? escapeHtml(_maskAccount(customer.account_number)) : '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Account Holder</span><span class="pv-val">${escapeHtml(customer.account_holder || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Payment Method</span><span class="pv-val">${escapeHtml(customer.payment_methods || '-')}</span></div>
            <div class="pv-sub">Customer Metrics</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px;">
                <div style="background:var(--gray-50);padding:12px;border-radius:8px;text-align:center;">
                    <div style="font-size:12px;color:var(--gray-500);">Lifetime Value</div>
                    <div style="font-size:18px;font-weight:700;color:var(--primary);">${UI.money(customer.lifetime_value || 0, customer.country)}</div>
                </div>
                <div style="background:var(--gray-50);padding:12px;border-radius:8px;text-align:center;">
                    <div style="font-size:12px;color:var(--gray-500);">Total Purchases</div>
                    <div style="font-size:18px;font-weight:700;color:var(--primary);">${customer.total_purchases || 0}</div>
                </div>
                <div style="background:var(--gray-50);padding:12px;border-radius:8px;text-align:center;">
                    <div style="font-size:12px;color:var(--gray-500);">Avg Order Value</div>
                    <div style="font-size:18px;font-weight:700;color:var(--primary);">${customer.total_purchases ? UI.money(Math.round((customer.lifetime_value || 0) / customer.total_purchases), customer.country) : UI.money(0, customer.country)}</div>
                </div>
                <div style="background:var(--gray-50);padding:12px;border-radius:8px;text-align:center;">
                    <div style="font-size:12px;color:var(--gray-500);">Last Purchase</div>
                    <div style="font-size:14px;font-weight:600;">${escapeHtml(_lastPur)}</div>
                </div>
            </div>
        `;
    }
    else if (tab === 'platforms') {
        await renderPlatformIdsTab(customer, container.id);
    }
    else if (tab === 'purchases') {
        await renderPurchaseHistoryTab(customer, container.id);
    }
    else if (tab === 'referrals') {
        await renderReferralsTab(customer, container.id);
    }
    else if (tab === 'activity') {
        await renderCustomerActivityTab(customer, container.id);
    }
    else if (tab === 'eligibility') {
        // Derive status + eligibility from REAL customer data instead of the old
        // hardcoded "Not an Agent / 85% Good candidate" block (audit #18). The
        // agent-package threshold is RM 3,000 (per the copy below).
        const _isAgentCust = !!(customer.is_agent || customer.agent_eligible || customer.is_agent_eligible);
        const _ltv = customer.lifetime_value || 0;
        const _AGENT_THRESHOLD = 3000;
        const _meetsThreshold = _ltv >= _AGENT_THRESHOLD;
        const _statusLabel = _isAgentCust ? 'Agent' : 'Not an Agent';
        const _eligLabel = _isAgentCust
            ? 'Already an agent'
            : (_meetsThreshold ? 'Meets purchase threshold' : 'Below purchase threshold');
        container.innerHTML = `
            <div style="text-align:center;padding:8px 0;">
                <div style="font-size:13px;color:#6b21a8;margin-bottom:8px;">Current Status: <strong>${escapeHtml(_statusLabel)}</strong></div>
                <div style="font-size:12px;color:#7e22ce;margin-bottom:12px;">To become agent: Purchase Agent Package (min RM 3,000)</div>
                <div style="display:inline-flex;flex-direction:column;align-items:center;gap:6px;margin-bottom:12px;">
                    <div style="font-size:13px;color:var(--gray-600);">Lifetime Value: <strong>${UI.money(_ltv, customer.country)}</strong></div>
                    <div style="font-size:13px;font-weight:600;color:#6b21a8;">${escapeHtml(_eligLabel)}</div>
                </div>
                ${_isAgentCust ? '' : `<button class="btn primary" style="width:100%;justify-content:center;" onclick="app.openRecruitModal(${customer.id})">Offer Agent Package</button>`}
            </div>
        `;
    }
    else if (tab === 'contracts') {
        await _renderCustomerContracts(customer, container.id);
    }
    else if (tab === 'closing') {
        await window.app.renderCustomerClosingTab(customer, container);
    }
    else if (tab === 'notes') {
        const customerNotes = await AppDataStore.query('notes', { customer_id: customer.id });
        container.innerHTML = `
            <div class="add-note-section">
                <textarea id="customer-note-text" class="form-control" rows="3" placeholder="Add a new note..."></textarea>
                <div style="display:flex;justify-content:flex-end;align-items:center;margin-top:8px;">
                    <button class="btn primary btn-sm" onclick="app.addCustomerNote(${customer.id})">Add Note</button>
                </div>
            </div>
            ${customerNotes.length > 0 ? customerNotes.map(n => `
                <div style="margin-top:10px;background:var(--gray-50);border-radius:8px;padding:12px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                        <span style="font-size:12px;color:var(--gray-500);">${escapeHtml(n.date)} - ${escapeHtml(n.author)}${n.is_voice_note ? ' <i class="fas fa-microphone voice-note-icon" title="Voice note"></i>' : ''}</span>
                        <button class="btn-icon" onclick="app.deleteCustomerNote(${customer.id}, ${n.id})"><i class="fas fa-trash"></i></button>
                    </div>
                    <div style="font-size:13px;color:var(--gray-700);">${escapeHtml(n.text)}</div>
                </div>
            `).join('') : '<p style="color:var(--gray-400);font-size:13px;margin-top:8px;">No notes yet.</p>'}
        `;
    }
    else if (tab === 'tags') {
        const entityTags = await AppDataStore.query('entity_tags', { entity_type: 'customer', entity_id: customer.id });
        let tagsHtml = '<p style="color:var(--gray-400);font-size:12px;">No tags yet.</p>';
        if (entityTags.length > 0) {
            const tagSpans = await Promise.all(entityTags.map(async (et) => {
                const tag = await AppDataStore.getById('tags', et.tag_id);
                return tag ? `<span class="score-badge" style="background:${/^#[0-9a-f]{3,8}$|^[a-z]+$/i.test(String(tag.color || '')) ? tag.color : 'var(--primary)'};color:white;display:flex;align-items:center;gap:4px;font-size:11px;">${escapeHtml(tag.name)} <span style="cursor:pointer;" onclick="app.removeTagFromCustomer(${customer.id},${tag.id})">&times;</span></span>` : '';
            }));
            tagsHtml = tagSpans.join('');
        }
        container.innerHTML = `
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
                ${tagsHtml}
                <button class="btn-sm secondary" style="border-radius:20px;font-size:11px;" onclick="app.openAddTagModal(${customer.id},'customer')">+ Add Tag</button>
            </div>
        `;
    }
    else if (tab === 'potential') {
        // Opportunities — open potential + deals live on the linked prospect;
        // shared renderer in the prospects chunk.
        if (!window.app.renderProfileOpportunities && typeof window._loadChunk === 'function') {
            try { await window._loadChunk('chunks/script-prospects.min.js'); } catch (_) { /* handled below */ }
        }
        if (typeof window.app.renderProfileOpportunities !== 'function') {
            container.innerHTML = '<p style="color:var(--gray-500);font-size:13px;">Could not load opportunities. Please reload and try again.</p>';
            return;
        }
        await window.app.renderProfileOpportunities('customer', customer.id, customer.converted_from_prospect_id != null ? Number(customer.converted_from_prospect_id) : null, container);
    }
    else if (tab === 'tasks') {
        // Next up — the one task list, shared with the prospect profile
        // (prospects chunk). Includes tasks still keyed to the linked prospect.
        if (!window.app.renderProfileTasks && typeof window._loadChunk === 'function') {
            try { await window._loadChunk('chunks/script-prospects.min.js'); } catch (_) { /* handled below */ }
        }
        if (typeof window.app.renderProfileTasks !== 'function') {
            container.innerHTML = '<p style="color:var(--gray-500);font-size:13px;">Could not load tasks. Please reload and try again.</p>';
            return;
        }
        await window.app.renderProfileTasks('customer', customer.id, customer.converted_from_prospect_id != null ? Number(customer.converted_from_prospect_id) : null, container);
    }
    else if (tab === 'journey') {
        await window._loadChunk('chunks/script-journey.min.js');
        await (window.app.renderJourneyTab || (() => {}))('customer', customer.id, container);
    }
    else if (tab === 'improvements') {
        await renderImprovementsTab(customer, container);
    }
    else if (tab === 'hosting') {
        await renderHuijiHostingTab(customer, container);
    }
};

const renderBasicBankTab = async (customer, containerId = 'profile-tab-content') => {
    const container = document.getElementById(containerId);
    if (!container) return; // target tab body may be absent in some detail layouts

    // ── Compute the previously-hardcoded metrics from real customer/purchase data ──
    // Age from date_of_birth (matches the React-shell 'info' tab formula).
    const _age = customer.date_of_birth
        ? Math.floor((Date.now() - new Date(customer.date_of_birth).getTime()) / 31557600000)
        : null;
    const _ageStr = (Number.isFinite(_age) && _age >= 0) ? ` (Age ${_age})` : '';
    // Mask a real account number (first 4 / last 4) instead of emitting a fake one.
    const _acctMasked = customer.account_number
        ? escapeHtml(_maskAccount(customer.account_number))
        : '-';
    // Real purchase metrics. Last-purchase date is derived from the purchases table
    // (max(date)) since customers carry no maintained last_purchase_date column.
    const _totalPurchases = customer.total_purchases || 0;
    const _avgOrder = _totalPurchases
        ? Math.round((customer.lifetime_value || 0) / _totalPurchases)
        : 0;
    let _lastPurchase = '-';
    try {
        const _purs = await AppDataStore.query('purchases', { customer_id: customer.id });
        const _dates = (_purs || []).map(p => p.date).filter(Boolean).sort();
        if (_dates.length) _lastPurchase = _dates[_dates.length - 1];
    } catch (_e) { /* offline / RLS — leave as '-' */ }

    container.innerHTML = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:32px;">
            <div>
                <h4 style="font-size:16px; font-weight:600; margin-bottom:16px; color:var(--primary);">Customer Information</h4>
                <div style="display:flex; flex-direction:column; gap:12px;">
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Full Name:</span> <strong>${escapeHtml(customer.full_name)}</strong></div>
                    <div style="display:flex; justify-content:space-between;">
                        <span style="color:var(--gray-500);">Phone:</span>
                        <span>${escapeHtml(customer.phone || '')} <button class="btn-icon"><i class="fas fa-phone"></i></button></span>
                    </div>
                    <div style="display:flex; justify-content:space-between;">
                        <span style="color:var(--gray-500);">Email:</span>
                        <span>${escapeHtml(customer.email || '')} <button class="btn-icon"><i class="fas fa-envelope"></i></button></span>
                    </div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">IC Number:</span> <span>${escapeHtml(customer.ic_number || '')}</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Date of Birth:</span> <span>${escapeHtml(customer.date_of_birth || '-')}${_ageStr}</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Ming Gua:</span> <span style="color:#6b21a8; font-weight:600;">${escapeHtml(customer.ming_gua || '')} (${escapeHtml(customer.element || '')})</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Gender:</span> <span>${escapeHtml(customer.gender || '')}</span></div>
                    <hr style="border:none; border-top:1px solid var(--gray-100); margin:8px 0;">
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Occupation:</span> <span>${escapeHtml(customer.occupation || '-')}</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Company:</span> <span>${escapeHtml(customer.company_name || '-')}</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Income:</span> <span>${escapeHtml(customer.income_range || '-')}</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Address:</span> <span style="text-align:right;">${escapeHtml((customer.address || '-') + ' ' + (customer.city || '') + ' ' + (customer.state || '') + ' ' + (customer.postal_code || ''))}</span></div>
                </div>

                <h4 style="font-size:16px; font-weight:600; margin-top:24px; margin-bottom:16px; color:var(--primary);">Referral Information</h4>
                <div style="display:flex; flex-direction:column; gap:12px;">
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Referred By:</span> <span>${escapeHtml(customer.referred_by || '-')}</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Relationship:</span> <span>${escapeHtml(customer.referral_relationship || '-')}</span></div>
                </div>
            </div>

            <div>
                <h4 style="font-size:16px; font-weight:600; margin-bottom:16px; color:var(--primary);">Bank and Payment Information</h4>
                <div style="display:flex; flex-direction:column; gap:12px; background:var(--gray-50); padding:16px; border-radius:8px;">
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Bank Name:</span> <strong>${escapeHtml(customer.bank_name || '')}</strong></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Account Number:</span> <span>${_acctMasked}</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Account Holder:</span> <span>${escapeHtml(customer.account_holder || '')}</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Payment Method:</span> <span>${escapeHtml(customer.payment_methods || '')}</span></div>
                </div>

                <h4 style="font-size:16px; font-weight:600; margin-top:24px; margin-bottom:16px; color:var(--primary);">Customer Metrics</h4>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div style="background:var(--gray-50); padding:12px; border-radius:8px; text-align:center;">
                        <div style="font-size:12px; color:var(--gray-500);">Lifetime Value</div>
                        <div style="font-size:18px; font-weight:700; color:var(--primary);">${UI.money(customer.lifetime_value || 0, customer.country)}</div>
                    </div>
                    <div style="background:var(--gray-50); padding:12px; border-radius:8px; text-align:center;">
                        <div style="font-size:12px; color:var(--gray-500);">Total Purchases</div>
                        <div style="font-size:18px; font-weight:700; color:var(--primary);">${_totalPurchases.toLocaleString()}</div>
                    </div>
                    <div style="background:var(--gray-50); padding:12px; border-radius:8px; text-align:center;">
                        <div style="font-size:12px; color:var(--gray-500);">Avg Order Value</div>
                        <div style="font-size:18px; font-weight:700; color:var(--primary);">${UI.money(_avgOrder, customer.country)}</div>
                    </div>
                    <div style="background:var(--gray-50); padding:12px; border-radius:8px; text-align:center;">
                        <div style="font-size:12px; color:var(--gray-500);">Last Purchase</div>
                        <div style="font-size:14px; font-weight:600;">${escapeHtml(_lastPurchase)}</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Append custom field values
    const cfDisplay = await (window.app.renderCustomFieldDisplay || (() => ''))('customer', customer.id);
    if (cfDisplay) container.insertAdjacentHTML('beforeend', cfDisplay);

    // Phase 14: Append Internal Notes section
    const customerNotes = await AppDataStore.query('notes', { customer_id: customer.id });
    container.insertAdjacentHTML('beforeend', `
        <div class="profile-section" style="margin-top:24px; border:1px solid var(--gray-200); border-radius:12px; padding:20px; background:var(--white);">
            <h4 style="font-size:16px; font-weight:600; margin-bottom:16px; color:var(--primary);"><i class="fas fa-sticky-note"></i> Internal Notes</h4>
            <div class="add-note-section">
                <textarea id="customer-note-text" class="form-control" rows="3" placeholder="Add a new note..."></textarea>
                <div style="display:flex; justify-content:flex-end; align-items:center; margin-top:8px;">
                    <button class="btn primary btn-sm" onclick="app.addCustomerNote(${customer.id})">Add Note</button>
                </div>
            </div>
            ${customerNotes.length > 0 ? customerNotes.map(n => `
                <div class="notes-item" style="margin-top:10px;">
                    <div class="notes-header">
                        <span>${escapeHtml(n.date)} - ${escapeHtml(n.author)}${n.is_voice_note ? ' <i class="fas fa-microphone voice-note-icon" title="Voice note"></i>' : ''}</span>
                        <button class="btn-icon" onclick="app.deleteCustomerNote(${customer.id}, ${n.id})"><i class="fas fa-trash"></i></button>
                    </div>
                    <div>"${escapeHtml(n.text)}"</div>
                </div>
            `).join('') : '<p style="color:var(--gray-400); font-size:13px; margin-top:8px;">No notes yet.</p>'}
        </div>
    `);
};

const renderPlatformIdsTab = async (customer, containerId = 'profile-tab-content') => {
    const platformData = await AppDataStore.query('platform_ids', { customer_id: customer.id });
    const internal = platformData.slice(0, 4);
    const external = platformData.slice(4);

    const container = document.getElementById(containerId);
    container.innerHTML = `
        <div class="platform-ids-grid">
            <div class="platform-card">
                <h4>Internal Platforms</h4>
                ${internal.map(p => `
                    <div class="platform-row">
                        <span class="platform-label">${escapeHtml(p.platform || '')} ID</span>
                        <span class="platform-value">${escapeHtml(p.platform_id || '')} <button class="copy-btn" data-copy="${escapeHtml(p.platform_id || '')}" onclick="app.copyToClipboard(this.dataset.copy)"><i class="fas fa-copy"></i></button></span>
                    </div>
                `).join('')}
            </div>
            <div class="platform-card">
                <h4>External Platforms</h4>
                ${external.map(p => `
                    <div class="platform-row">
                        <span class="platform-label">${escapeHtml(p.platform || '')} ID</span>
                        <span class="platform-value">${escapeHtml(p.platform_id || '')} <button class="copy-btn" data-copy="${escapeHtml(p.platform_id || '')}" onclick="app.copyToClipboard(this.dataset.copy)"><i class="fas fa-copy"></i></button></span>
                    </div>
                `).join('')}
            </div>
        </div>
        <div style="margin-top:20px; text-align:center;">
            <button class="btn secondary" onclick="app.openEditPlatformIdsModal(${customer.id})">Edit Platform IDs</button>
        </div>
    `;
};

const openUploadRedemptionImageModal = async (purchaseId) => {
    const content = `
        <div class="form-section">
            <div class="form-group">
                <label>Payment Proof / Receipt URL</label>
                <input type="text" id="upload-proof-url" class="form-control" placeholder="Paste image or PDF URL here">
            </div>
            <p style="font-size:12px; color:var(--gray-500); margin-top:8px;">Paste a URL to the image or PDF uploaded to Google Drive or cloud storage.</p>
        </div>
    `;
    UI.showModal('Upload Payment Proof', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Save', type: 'primary', action: `(async () => { await app.saveRedemptionImage(${purchaseId}); })()` }
    ]);
};

const saveRedemptionImage = async (purchaseId) => {
    const url = document.getElementById('upload-proof-url')?.value?.trim();
    if (!url) { UI.toast.error('Please enter a URL.'); return; }
    await AppDataStore.update('purchases', purchaseId, { proof: url });
    UI.hideModal();
    UI.toast.success('Payment proof saved.');
    const purchase = await AppDataStore.getById('purchases', purchaseId);
    if (purchase?.customer_id) {
        const customer = await AppDataStore.getById('customers', purchase.customer_id);
        if (customer && document.getElementById('profile-tab-content')) {
            await renderPurchaseHistoryTab(customer);
        }
    }
};

const openUploadDocumentModal = async (entityId, entityType) => {
    const content = `
        <div class="form-section">
            <div class="form-group">
                <label>Document Name</label>
                <input type="text" id="doc-name" class="form-control" placeholder="e.g. IC Copy, Signed Agreement">
            </div>
            <div class="form-group">
                <label>Document Type</label>
                <select id="doc-type" class="form-control">
                    <option>IC / Passport</option>
                    <option>Agreement</option>
                    <option>Proof of Payment</option>
                    <option>Medical Report</option>
                    <option>Other</option>
                </select>
            </div>
            <div class="form-group">
                <label>File URL</label>
                <input type="text" id="doc-url" class="form-control" placeholder="Paste Google Drive or cloud storage URL">
            </div>
            <div class="form-group">
                <label>Notes</label>
                <textarea id="doc-notes" class="form-control" rows="2" placeholder="Optional notes..."></textarea>
            </div>
        </div>
    `;
    UI.showModal('Upload Document', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Save Document', type: 'primary', action: `(async () => { await app.saveDocument(${entityId}, '${entityType}'); })()` }
    ]);
};

const saveDocument = async (entityId, entityType) => {
    const name = document.getElementById('doc-name')?.value?.trim();
    const type = document.getElementById('doc-type')?.value;
    const url = document.getElementById('doc-url')?.value?.trim();
    const notes = document.getElementById('doc-notes')?.value?.trim();
    if (!name) { UI.toast.error('Document name is required.'); return; }
    await AppDataStore.create('documents', {
        entity_id: entityId,
        entity_type: entityType,
        name,
        type,
        url,
        notes,
        uploaded_at: new Date().toISOString(),
        uploaded_by: _state.cu?.id
    });
    UI.hideModal();
    UI.toast.success('Document saved.');
};

const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
        UI.toast.success('Copied!');
    }).catch(() => UI.toast.error('Copy failed'));
};

const renderPurchaseHistoryTab = async (customer, containerId = 'profile-tab-content') => {
    const purchases = await AppDataStore.query('purchases', { customer_id: customer.id });
    const container = document.getElementById(containerId);
    if (!container) return; // target tab body may be absent (detail view has no such id)
    // Render every amount in this customer's market currency. A purchase row may
    // carry its own `currency` (stamped at sale time); fall back to the customer's.
    const _custCur = UI.currencyForCountry(customer.country);

    // Fetch original closing record from the prospect this customer was converted from
    let cr = null;
    if (customer.converted_from_prospect_id) {
        const origProspect = await AppDataStore.getById('prospects', customer.converted_from_prospect_id);
        if (origProspect?.closing_record) cr = origProspect.closing_record;
    }

    let totalPaid = 0;
    let totalPending = 0;

    // Build closing record row (the original sale that triggered conversion)
    const crRow = cr ? (() => {
        const amt = parseFloat(cr.sale_amount) || 0;
        totalPaid += amt;
        return `
            <tr style="background:#f0fdf4;">
                <td>${escapeHtml(cr.order_date || cr.closing_date || customer.customer_since || '-')}</td>
                <td>${escapeHtml(cr.invoice_number || '-')}</td>
                <td><strong>${escapeHtml(cr.product || '-')}</strong> <span style="font-size:11px;color:var(--gray-400);">(Conversion Sale)</span></td>
                <td>${UI.formatCurrency(amt, { currency: _custCur })}</td>
                <td><span class="score-badge" style="font-size:11px;background:#dcfce7;color:#166534;">PAID</span></td>
                <td>${cr.invoice_file ? `<a href="#" onclick="event.preventDefault();window._openAttachment&&window._openAttachment('${UI.escJsAttr(String(cr.invoice_file))}')" style="color:var(--primary);cursor:pointer;">View</a>` : '-'}</td>
                <td><span style="font-size:11px;color:var(--gray-400);">Locked</span></td>
            </tr>`;
    })() : '';

    container.innerHTML = `
        <table class="purchase-table">
            <thead>
                <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Invoice Number</th>
                    <th scope="col">Item/Product</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Status</th>
                    <th scope="col">Proof/Image</th>
                    <th scope="col">Actions</th>
                </tr>
            </thead>
            <tbody>
                ${crRow}
                ${purchases.map(p => {
        const _pstatus = p.status || 'PENDING';
        if (_pstatus !== 'PENDING') totalPaid += (p.amount || 0);
        else totalPending += (p.amount || 0);

        const badgeClass = `badge-${_pstatus.toLowerCase().replace('/', '')}`;
        // Scheme-validated proof URL (savePaymentProof now stores a public URL, not a
        // bare object key). View + download both point at it; absent → no link/button.
        // C2 (audit): proof is stored as a private storage path — open via a
        // short-lived signed URL (window._openAttachment) instead of a raw href.
        const _hasProof = !!p.proof;
        const _proofOpen = `event.preventDefault();window._openAttachment&&window._openAttachment('${UI.escJsAttr(String(p.proof || ''))}')`;
        return `
                        <tr>
                            <td>${escapeHtml(p.date || '')}</td>
                            <td>${escapeHtml(p.invoice || '')}</td>
                            <td>${escapeHtml(p.item || '')}</td>
                            <td>${UI.formatCurrency(p.amount || 0, { currency: p.currency || _custCur })}</td>
                            <td><span class="score-badge ${badgeClass}" style="font-size:11px;">${escapeHtml(_pstatus)}</span></td>
                            <td>${_hasProof ? `<a href="#" onclick="${_proofOpen}" style="color:var(--primary);cursor:pointer;">${String(p.proof).endsWith('.pdf') ? 'View Report' : 'View Image'}</a>` : `<button class="btn-sm secondary" onclick="app.uploadPaymentProof(${p.id}, ${customer.id})">Upload Image</button>`}</td>
                            <td>
                                ${_hasProof ? `<a class="btn-icon" href="#" onclick="${_proofOpen}" title="View proof"><i class="fas fa-download"></i></a>` : ''}
                                ${p.status === 'PENDING' ? `<button class="btn-icon" title="Delete purchase" onclick="event.stopPropagation(); app.deletePurchase(${p.id}, ${customer.id})"><i class="fas fa-trash"></i></button>` : ''}
                            </td>
                        </tr>
                    `;
    }).join('')}
                ${!cr && purchases.length === 0 ? '<tr><td colspan="7" style="text-align:center;color:var(--gray-400);padding:16px;">No purchase records yet.</td></tr>' : ''}
            </tbody>
        </table>
        <div class="purchase-summary">
            <div>Total Paid: <span style="color:var(--success);">${UI.formatCurrency(totalPaid, { currency: _custCur })}</span></div>
            <div>Pending: <span style="color:var(--error);">${UI.formatCurrency(totalPending, { currency: _custCur })}</span></div>
            <div style="font-size:18px;">Lifetime Total: <span style="color:var(--primary);">${UI.formatCurrency(totalPaid + totalPending, { currency: _custCur })}</span></div>
        </div>
        <div style="margin-top:16px;">
            <button class="btn primary" onclick="app.openAddPurchaseModal(${customer.id})">Add Purchase</button>
        </div>
    `;
};

const renderReferralsTab = async (customer, containerId = 'profile-tab-content') => {
    const refs = await AppDataStore.query('referrals', { referrer_customer_id: customer.id });
    const container = document.getElementById(containerId);
    if (!container) return; // target tab body may be absent in some detail layouts

    const rowsPromises = refs.map(async (r) => {
        const prospect = await AppDataStore.getById('prospects', r.referred_prospect_id);
        return `
            <tr>
                <td><strong>${escapeHtml(prospect?.full_name || 'N/A')}</strong></td>
                <td>${escapeHtml(r.relationship || '')}</td>
                <td>${escapeHtml(r.date || '')}</td>
                <td><span class="score-badge ${r.status === 'Active' ? 'score-A+' : 'score-A'}">${escapeHtml(r.status || '')}</span></td>
                <td>${escapeHtml(r.reward_status || '')}</td>
                <td>
                    <button class="btn-sm secondary" onclick="app.viewReferralDetail(${r.id})">View</button>
                    <button class="btn-sm secondary" onclick="app.editReferral(${r.id}, ${customer.id})">Update</button>
                </td>
            </tr>
        `;
    });

    const rowsHtml = (await Promise.all(rowsPromises)).join('');

    container.innerHTML = `
        <table class="purchase-table">
            <thead>
                <tr>
                    <th scope="col">Referred Person</th>
                    <th scope="col">Relationship</th>
                    <th scope="col">Referral Date</th>
                    <th scope="col">Status</th>
                    <th scope="col">Reward Status</th>
                    <th scope="col">Actions</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>
        <div style="margin-top:16px;">
            <button class="btn primary" onclick="app.openCustomerReferralModal(${customer.id})">Refer a Friend</button>
        </div>
    `;
};

// Debounced dispatcher — was firing a server trigram search on every keystroke.
const searchReferralProspect = () => {
    clearTimeout(searchReferralProspect._t);
    searchReferralProspect._t = setTimeout(() => _runReferralProspectSearch(), 220);
};
const _runReferralProspectSearch = async () => {
    try {
        const term = (document.getElementById('referral-prospect-search')?.value || '').trim();
        const resultsDiv = document.getElementById('referral-prospect-results');
        if (!resultsDiv) return;
        if (!term) { resultsDiv.style.display = 'none'; return; }
        let rows = [];
        try {
            const sr = await AppDataStore.searchProspects(term, { includeDormant: true, limit: 50 });
            rows = Array.isArray(sr) ? sr : ((sr && sr.data) || []);
        } catch (e) {
            rows = (await AppDataStore.getAll('prospects'));
        }
        const q = term.toLowerCase();
        const matched = (rows || []).filter(p =>
            (p.full_name || '').toLowerCase().includes(q) || (p.phone || '').includes(term)
        ).slice(0, 8);
        if (!matched.length) {
            resultsDiv.innerHTML = '<div style="padding:10px 12px;color:#6b7280;font-size:13px;">No prospects found</div>';
        } else {
            resultsDiv.innerHTML = matched.map(p => {
                const label = `${p.full_name || ''} (${p.phone || 'no phone'})`;
                return `<div style="cursor:pointer;padding:8px 12px;border-bottom:1px solid #f3f4f6;" data-id="${p.id}" data-name="${escapeHtml(label)}" onmousedown="app.selectReferralProspect(this.dataset.id, this.dataset.name)"><strong>${escapeHtml(p.full_name || '')}</strong><br><small style="color:#6b7280;">${escapeHtml(p.phone || 'no phone')}</small></div>`;
            }).join('');
        }
        resultsDiv.style.display = 'block';
    } catch (e) { console.error('searchReferralProspect:', e); }
};

const selectReferralProspect = (id, name) => {
    const hid = document.getElementById('referral-prospect-id');
    const search = document.getElementById('referral-prospect-search');
    const results = document.getElementById('referral-prospect-results');
    if (hid) hid.value = id;
    if (search) search.value = name;
    if (results) results.style.display = 'none';
};

const openCustomerReferralModal = async (customerId) => {
    // Scale-safe: type-to-search instead of a <select> that lists EVERY prospect
    // (which would render 100k+ <option>s at scale and freeze the modal).
    const content = `
        <div class="form-group" style="margin-bottom:14px;position:relative;">
            <label>Referred Person (Prospect) <span class="required">*</span></label>
            <input type="hidden" id="referral-prospect-id" value="">
            <input type="text" id="referral-prospect-search" class="form-control" autocomplete="off" placeholder="Type a name or phone to search…" oninput="app.searchReferralProspect()" onblur="setTimeout(function(){var r=document.getElementById('referral-prospect-results');if(r)r.style.display='none';},200)">
            <div id="referral-prospect-results" style="display:none;position:absolute;z-index:10;left:0;right:0;background:#fff;border:1px solid #e5e7eb;border-radius:8px;max-height:220px;overflow:auto;box-shadow:0 6px 18px rgba(0,0,0,0.10);"></div>
        </div>
        <div class="form-group" style="margin-bottom:14px;">
            <label>Relationship to Customer <span class="required">*</span></label>
            <select id="referral-relationship" class="form-control">
                <option value="Family">Family</option>
                <option value="Friend">Friend</option>
                <option value="Colleague">Colleague</option>
                <option value="Business Partner">Business Partner</option>
                <option value="Other">Other</option>
            </select>
        </div>
        <div class="form-group">
            <label>Referral Date</label>
            <input type="date" id="referral-date" class="form-control" value="${(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })()}">
        </div>
    `;
    UI.showModal('Refer a Friend', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Save Referral', type: 'primary', action: `(async () => { await app.saveCustomerReferral(${customerId}); })()` }
    ]);
};

const saveCustomerReferral = async (customerId) => {
    const prospectId = document.getElementById('referral-prospect-id')?.value;
    const relationship = document.getElementById('referral-relationship')?.value;
    const date = document.getElementById('referral-date')?.value;
    if (!prospectId) { UI.toast.error('Please select a prospect'); return; }
    await AppDataStore.create('referrals', {
        referrer_customer_id: customerId,
        referred_prospect_id: parseInt(prospectId),
        relationship,
        date,
        status: 'Active',
        reward_status: 'Pending',
        created_at: new Date().toISOString()
    });
    UI.hideModal();
    UI.toast.success('Referral saved');
    const customer = await AppDataStore.getById('customers', customerId);
    if (customer) { const cid = `cust-acc-body-referrals-${customerId}`; await renderReferralsTab(customer, document.getElementById(cid) ? cid : 'profile-tab-content'); }
};

const viewReferralDetail = async (referralId) => {
    const ref = await AppDataStore.getById('referrals', referralId);
    if (!ref) { UI.toast.error('Referral not found'); return; }
    const prospect = await AppDataStore.getById('prospects', ref.referred_prospect_id);
    UI.showModal('Referral Detail', `
        <div style="display:grid;gap:12px;">
            <div><strong>Referred Person:</strong> ${escapeHtml(prospect?.full_name || 'N/A')}</div>
            <div><strong>Phone:</strong> ${escapeHtml(prospect?.phone || '—')}</div>
            <div><strong>Relationship:</strong> ${escapeHtml(ref.relationship || '')}</div>
            <div><strong>Referral Date:</strong> ${escapeHtml(ref.date || '')}</div>
            <div><strong>Status:</strong> <span class="score-badge ${ref.status === 'Active' ? 'score-A+' : 'score-A'}">${escapeHtml(ref.status || '')}</span></div>
            <div><strong>Reward Status:</strong> ${escapeHtml(ref.reward_status || '')}</div>
        </div>
    `, [{ label: 'Close', type: 'primary', action: 'UI.hideModal()' }]);
};

const editReferral = async (referralId, customerId) => {
    const ref = await AppDataStore.getById('referrals', referralId);
    if (!ref) { UI.toast.error('Referral not found'); return; }
    const content = `
        <div class="form-group" style="margin-bottom:14px;">
            <label>Status</label>
            <select id="edit-referral-status" class="form-control">
                ${['Active', 'Converted', 'Inactive', 'Lost'].map(s => `<option value="${s}" ${ref.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
        </div>
        <div class="form-group">
            <label>Reward Status</label>
            <select id="edit-referral-reward" class="form-control">
                ${['Pending', 'Approved', 'Paid', 'Not Eligible'].map(s => `<option value="${s}" ${ref.reward_status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
        </div>
    `;
    UI.showModal('Update Referral', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Save', type: 'primary', action: `(async () => { await app.saveEditReferral(${referralId}, ${customerId}); })()` }
    ]);
};

const saveEditReferral = async (referralId, customerId) => {
    const status = document.getElementById('edit-referral-status')?.value;
    const reward_status = document.getElementById('edit-referral-reward')?.value;
    await AppDataStore.update('referrals', referralId, { status, reward_status });
    UI.hideModal();
    UI.toast.success('Referral updated');
    const customer = await AppDataStore.getById('customers', customerId);
    if (customer) { const cid = `cust-acc-body-referrals-${customerId}`; await renderReferralsTab(customer, document.getElementById(cid) ? cid : 'profile-tab-content'); }
};

// ========== 改命后的进步 (CUSTOMER IMPROVEMENT LOG) ==========
// Write access mirrors the cimp_* RLS policies: responsible agent or management (L4+).
const _canWriteImprovement = (customer) => {
    const u = _state.cu;
    if (!u || !customer) return false;
    return (customer.responsible_agent_id != null && String(customer.responsible_agent_id) === String(u.id))
        || _getUserLevel(u) <= 4;
};

const renderImprovementsTab = async (customer, container) => {
    if (typeof container === 'string') container = document.getElementById(container);
    if (!container) return;
    let rows;
    try {
        rows = await AppDataStore.query('customer_improvements', { customer_id: customer.id });
    } catch (e) {
        container.innerHTML = '<p style="color:var(--gray-400);font-size:13px;">Could not load improvements. Please try again.</p>';
        return;
    }
    rows = (rows || []).slice().sort((a, b) => String(b.improve_date || '').localeCompare(String(a.improve_date || '')));
    const canWrite = _canWriteImprovement(customer);
    const btns = `
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
            ${canWrite ? `<button class="btn primary btn-sm" onclick="event.stopPropagation();app.openImprovementModal(${customer.id})"><i class="fas fa-plus"></i> 记录进步</button>` : ''}
            ${rows.length ? `<button class="btn secondary btn-sm" onclick="event.stopPropagation();app.openImprovementStoryMode(${customer.id})"><i class="fas fa-play"></i> 回顾模式</button>` : ''}
        </div>`;
    const timeline = rows.length ? `
        <div style="border-left:2px solid var(--gray-200);margin-left:5px;padding-left:14px;display:flex;flex-direction:column;gap:14px;">
            ${rows.map(r => `
                <div>
                    <div style="font-size:12px;color:var(--gray-500);display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                        <span>${escapeHtml(r.improve_date || '-')}</span>
                        ${r.solution ? `<span style="background:#ecfdf5;color:#047857;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600;">${escapeHtml(r.solution)}</span>` : ''}
                        ${canWrite ? `
                            <button class="btn-icon" title="Edit" onclick="event.stopPropagation();app.openImprovementModal(${customer.id}, ${r.id})" style="font-size:12px;"><i class="fas fa-edit"></i></button>
                            <button class="btn-icon" title="Delete" onclick="event.stopPropagation();app.deleteCustomerImprovement(${customer.id}, ${r.id})" style="font-size:12px;color:var(--danger);"><i class="fas fa-trash"></i></button>` : ''}
                    </div>
                    <div style="font-size:14px;color:var(--gray-800);margin-top:2px;white-space:pre-wrap;word-break:break-word;">${escapeHtml(r.story || '')}</div>
                </div>`).join('')}
        </div>`
        : '<p style="color:var(--gray-400);font-size:13px;">还没有记录 — 记录第一个进步吧。</p>';
    container.innerHTML = btns + timeline;
    const badge = document.getElementById(`cust-imp-badge-${customer.id}`);
    if (badge) {
        if (rows.length > 0) { badge.textContent = rows.length; badge.style.display = 'inline'; }
        else { badge.style.display = 'none'; }
    }
};

// ========== 汇集接待 (HUIJI HOSTING HISTORY) ==========
// Events where this customer was the house owner. Rows come from
// event_huiji_details — RLS already scopes them per viewer (agents see only
// visits they created; managers L≤5 see all), so no extra gating here.
const renderHuijiHostingTab = async (customer, container) => {
    if (typeof container === 'string') container = document.getElementById(container);
    if (!container) return;
    let rows;
    try {
        rows = (await AppDataStore.query('event_huiji_details', { owner_customer_id: customer.id })) || [];
    } catch (e) {
        container.innerHTML = '<p style="color:var(--gray-400);font-size:13px;">Could not load hosting history. Please try again.</p>';
        return;
    }
    if (!rows.length) {
        container.innerHTML = '<p style="color:var(--gray-400);font-size:13px;">还没有汇集记录 — no visits hosted at this house (that you can see).</p>';
        return;
    }
    const events = await Promise.all(rows.map(r => AppDataStore.getById('events', r.event_id).catch(() => null)));
    const _sols = (raw) => (window.app.huijiNormalizeSolutions ? window.app.huijiNormalizeSolutions(raw) : []);
    const items = rows.map((r, i) => ({ r, ev: events[i] }))
        .sort((a, b) => String(b.ev?.date || b.ev?.event_date || '').localeCompare(String(a.ev?.date || a.ev?.event_date || '')));
    container.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:10px;">
            ${items.map(({ r, ev }) => `
                <div style="border:1px solid var(--gray-200);border-radius:8px;padding:10px 12px;background:#fff;">
                    <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
                        <strong style="font-size:13px;">🏠 ${escapeHtml(ev?.event_title || ev?.title || ('Event #' + r.event_id))}</strong>
                        <span style="font-size:12px;color:var(--gray-500);">${escapeHtml(ev?.date || ev?.event_date || '')}</span>
                    </div>
                    ${_sols(r.solutions).length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">${_sols(r.solutions).map(s => `<span style="background:#ecfdf5;color:#047857;padding:1px 8px;border-radius:10px;font-size:11px;">${escapeHtml(s.label)}</span>`).join('')}</div>` : ''}
                </div>`).join('')}
        </div>`;
};

const openImprovementModal = async (customerId, improvementId = null) => {
    const customer = await AppDataStore.getById('customers', customerId);
    if (!customer) { UI.toast.error('Customer not found'); return; }
    if (!_canWriteImprovement(customer)) { UI.toast.error('Only the responsible agent or management can record improvements.'); return; }
    let existing = null;
    if (improvementId) {
        existing = await AppDataStore.getById('customer_improvements', improvementId);
        if (!existing) { UI.toast.error('Record not found'); return; }
    }
    // Solution options = what THIS customer actually bought (distinct purchases.item),
    // so nothing is re-keyed. "Other" keeps a free-text escape hatch.
    let items = [];
    try {
        const purs = await AppDataStore.query('purchases', { customer_id: customerId });
        items = [...new Set((purs || []).map(p => (p.item || '').trim()).filter(Boolean))];
    } catch (_) { items = []; }
    const sel = existing?.solution || '';
    const selInList = !!sel && items.includes(sel);
    const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
    const content = `
        <div class="form-group" style="margin-bottom:14px;">
            <label>日期 Date <span class="required">*</span></label>
            <input type="date" id="imp-date" class="form-control" value="${escapeHtml(existing?.improve_date || today)}">
        </div>
        <div class="form-group" style="margin-bottom:14px;">
            <label>使用方案 Solution Used</label>
            <select id="imp-solution" class="form-control" onchange="document.getElementById('imp-solution-other').style.display = this.value === 'Other' ? 'block' : 'none'">
                <option value="">— Select —</option>
                ${items.map(n => `<option value="${escapeHtml(n)}" ${n === sel ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}
                <option value="Other" ${sel && !selInList ? 'selected' : ''}>Other (type below)</option>
            </select>
            <input type="text" id="imp-solution-other" class="form-control" placeholder="Solution name…" value="${sel && !selInList ? escapeHtml(sel) : ''}" style="margin-top:8px;display:${sel && !selInList ? 'block' : 'none'};">
        </div>
        <div class="form-group">
            <label>进步故事 Improvement Story <span class="required">*</span></label>
            <textarea id="imp-story" class="form-control" rows="4" placeholder="e.g. 生意收入增加40%，现金流稳定">${escapeHtml(existing?.story || '')}</textarea>
        </div>`;
    UI.showModal(improvementId ? '编辑进步 Edit Improvement' : '记录进步 Record Improvement', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Save', type: 'primary', action: `(async () => { await app.saveCustomerImprovement(${customerId}, ${improvementId ?? 'null'}); })()` }
    ]);
};

const saveCustomerImprovement = async (customerId, improvementId = null) => {
    const date = document.getElementById('imp-date')?.value;
    const selVal = document.getElementById('imp-solution')?.value || '';
    const other = (document.getElementById('imp-solution-other')?.value || '').trim();
    const story = (document.getElementById('imp-story')?.value || '').trim();
    if (!date) { UI.toast.error('Please pick a date'); return; }
    if (!story) { UI.toast.error('Please write the improvement story'); return; }
    const solution = selVal === 'Other' ? other : selVal;
    try {
        if (improvementId) {
            await AppDataStore.update('customer_improvements', improvementId, {
                improve_date: date, solution: solution || null, story
            });
        } else {
            await AppDataStore.create('customer_improvements', {
                customer_id: customerId,
                improve_date: date,
                solution: solution || null,
                story,
                created_by: _state.cu?.id ?? null,
            });
        }
    } catch (e) {
        UI.toast.error('Save failed: ' + (e?.message || e));
        return;
    }
    UI.hideModal();
    UI.toast.success(improvementId ? 'Improvement updated' : 'Improvement recorded');
    const customer = await AppDataStore.getById('customers', customerId);
    const body = document.getElementById(`cust-acc-body-improvements-${customerId}`);
    if (customer && body) await renderImprovementsTab(customer, body);
};

const deleteCustomerImprovement = (customerId, improvementId) => {
    UI.confirm('Delete Improvement?', 'This record will be permanently removed.', async () => {
        try {
            await AppDataStore.delete('customer_improvements', improvementId);
        } catch (e) {
            UI.toast.error('Delete failed: ' + (e?.message || e));
            return;
        }
        UI.toast.success('Improvement deleted');
        const customer = await AppDataStore.getById('customers', customerId);
        const body = document.getElementById(`cust-acc-body-improvements-${customerId}`);
        if (customer && body) await renderImprovementsTab(customer, body);
    });
};

// Full-screen customer-facing review: oldest → newest, grouped by year — the
// customer reads their story from the first consultation to today.
const openImprovementStoryMode = async (customerId) => {
    const customer = await AppDataStore.getById('customers', customerId);
    if (!customer) { UI.toast.error('Customer not found'); return; }
    let rows;
    try { rows = await AppDataStore.query('customer_improvements', { customer_id: customerId }); } catch (_) { rows = []; }
    rows = (rows || []).slice().sort((a, b) => String(a.improve_date || '').localeCompare(String(b.improve_date || '')));
    if (!rows.length) { UI.toast.error('No improvements recorded yet'); return; }
    closeImprovementStoryMode();
    const years = [...new Set(rows.map(r => String(r.improve_date || '').slice(0, 4)))];
    const span = years.length > 1 ? `${years[0]} – ${years[years.length - 1]}` : (years[0] || '');
    let body = '';
    let lastYear = '';
    for (const r of rows) {
        const y = String(r.improve_date || '').slice(0, 4);
        if (y !== lastYear) {
            body += `<div style="font-size:14px;font-weight:700;color:#16a34a;letter-spacing:1px;margin:18px 0 2px;">${escapeHtml(y)}</div>`;
            lastYear = y;
        }
        body += `
            <div style="padding:10px 0;">
                <div style="font-size:12px;color:#9ca3af;">${escapeHtml(r.improve_date || '')}${r.solution ? ` · <span style="color:#047857;font-weight:600;">${escapeHtml(r.solution)}</span>` : ''}</div>
                <div style="font-size:17px;color:#1f2937;line-height:1.5;margin-top:2px;white-space:pre-wrap;word-break:break-word;">${escapeHtml(r.story || '')}</div>
            </div>`;
    }
    const overlay = document.createElement('div');
    overlay.id = 'imp-story-overlay';
    // safe-area padding: index.html sets viewport-fit=cover, so without it the
    // close button hides under the iOS notch on the home-screen PWA.
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding-top:env(safe-area-inset-top);';
    overlay.innerHTML = `
        <div style="max-width:560px;margin:0 auto;padding:20px 20px 60px;">
            <div style="display:flex;justify-content:flex-end;position:sticky;top:0;background:#fff;padding:8px 0;">
                <button onclick="app.closeImprovementStoryMode()" style="border:none;background:var(--gray-100);width:36px;height:36px;border-radius:50%;font-size:16px;cursor:pointer;color:var(--gray-600);"><i class="fas fa-times"></i></button>
            </div>
            <div style="text-align:center;margin-bottom:8px;">
                <i class="fas fa-seedling" style="color:#16a34a;font-size:28px;"></i>
                <div style="font-size:24px;font-weight:700;margin-top:8px;">${escapeHtml(customer.full_name || '')}的改命之路</div>
                <div style="font-size:13px;color:#6b7280;margin-top:4px;">${escapeHtml(span)} · ${rows.length} 个进步</div>
            </div>
            <div style="border-left:3px solid #16a34a;padding-left:18px;margin-left:6px;">${body}</div>
        </div>`;
    document.body.appendChild(overlay);
};

const closeImprovementStoryMode = () => {
    document.getElementById('imp-story-overlay')?.remove();
};

const openEditPlatformIdsModal = async (customerId) => {
    const existing = await AppDataStore.query('platform_ids', { customer_id: customerId });
    const rowsHtml = existing.map(p => `
        <div class="form-row" style="display:flex;gap:8px;margin-bottom:8px;" data-platform-row-id="${p.id}">
            <input type="text" class="form-control" placeholder="Platform name" value="${escapeHtml(p.platform || '')}" style="flex:1;">
            <input type="text" class="form-control" placeholder="Platform ID" value="${escapeHtml(p.platform_id || '')}" style="flex:1;">
            <button class="btn error btn-sm" onclick="this.closest('[data-platform-row-id]').remove()">×</button>
        </div>
    `).join('');
    const content = `
        <div id="platform-rows">${rowsHtml}</div>
        <button class="btn secondary btn-sm" style="margin-top:8px;" onclick="
            const row = document.createElement('div');
            row.className='form-row';
            row.style='display:flex;gap:8px;margin-bottom:8px;';
            row.innerHTML='<input type=\\'text\\' class=\\'form-control\\' placeholder=\\'Platform name\\' style=\\'flex:1;\\'><input type=\\'text\\' class=\\'form-control\\' placeholder=\\'Platform ID\\' style=\\'flex:1;\\'><button class=\\'btn error btn-sm\\' onclick=\\'this.parentElement.remove()\\'>×</button>';
            document.getElementById('platform-rows').appendChild(row);
        ">+ Add Row</button>
    `;
    UI.showModal('Edit Platform IDs', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Save', type: 'primary', action: `(async () => { await app.savePlatformIds(${customerId}); })()` }
    ]);
};

const savePlatformIds = async (customerId) => {
    const existingRows = document.querySelectorAll('#platform-rows [data-platform-row-id]');
    const newRows = document.querySelectorAll('#platform-rows .form-row:not([data-platform-row-id])');

    // Rows the user removed via the × button are gone from the DOM entirely, so
    // the loop below never sees them and their DB row would survive. Compute the
    // set of ids the user KEPT, then delete every original row not in that set
    // (audit #9). All deletes are guarded because AppDataStore.delete THROWS on
    // error / zero-deleted (audit #21) — an unguarded throw would abort mid-save
    // with no feedback and a partial write.
    const keptIds = new Set();
    let hadError = false;

    for (const row of existingRows) {
        const id = parseInt(row.getAttribute('data-platform-row-id'));
        const inputs = row.querySelectorAll('input');
        const platform = inputs[0]?.value?.trim();
        const platform_id = inputs[1]?.value?.trim();
        keptIds.add(id);
        try {
            if (platform && platform_id) {
                await AppDataStore.update('platform_ids', id, { platform, platform_id });
            } else {
                await AppDataStore.delete('platform_ids', id);
            }
        } catch (e) { hadError = true; console.warn('[savePlatformIds] row', id, e?.message || e); }
    }

    // Delete rows the user removed from the modal (present in DB, absent from DOM).
    let originalRows = [];
    try { originalRows = await AppDataStore.query('platform_ids', { customer_id: customerId }); } catch (_) { originalRows = []; }
    for (const orig of originalRows) {
        if (keptIds.has(orig.id)) continue;
        try { await AppDataStore.delete('platform_ids', orig.id); } catch (e) { hadError = true; console.warn('[savePlatformIds] delete', orig.id, e?.message || e); }
    }

    for (const row of newRows) {
        const inputs = row.querySelectorAll('input');
        const platform = inputs[0]?.value?.trim();
        const platform_id = inputs[1]?.value?.trim();
        if (platform && platform_id) {
            try { await AppDataStore.create('platform_ids', { customer_id: customerId, platform, platform_id }); } catch (e) { hadError = true; console.warn('[savePlatformIds] create', e?.message || e); }
        }
    }
    UI.hideModal();
    if (hadError) UI.toast.error('Some platform IDs could not be saved. Please reopen and retry.');
    else UI.toast.success('Platform IDs saved');
    const customer = await AppDataStore.getById('customers', customerId);
    if (customer) { const cid = `cust-acc-body-platforms-${customerId}`; await renderPlatformIdsTab(customer, document.getElementById(cid) ? cid : 'profile-tab-content'); }
};

const uploadPaymentProof = async (purchaseId, customerId) => {
    const content = `
        <div class="form-group">
            <label>Select proof image or PDF</label>
            <input type="file" id="proof-upload" class="form-control" accept="image/*,.pdf">
            <p style="color:var(--gray-500);font-size:12px;margin-top:6px;">Accepted: JPG, PNG, PDF (max 5MB)</p>
        </div>
    `;
    UI.showModal('Upload Payment Proof', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Upload', type: 'primary', action: `(async () => { await app.savePaymentProof(${purchaseId}, ${customerId}); })()` }
    ]);
};

// Refresh the purchases UI after a proof/delete change. The detail view exposes
// purchases via the 'closing' accordion (cust-acc-body-closing-…) + renderCustomerClosingTab,
// NOT a 'purchases' body — the old code targeted a non-existent id and fell back to
// 'profile-tab-content' (also absent) → getElementById null → innerHTML threw.
const _refreshPurchasesUI = async (customerId) => {
    const customer = await AppDataStore.getById('customers', customerId);
    if (!customer) return;
    const closingBody = document.getElementById(`cust-acc-body-closing-${customerId}`);
    if (closingBody) { await window.app.renderCustomerClosingTab(customer, closingBody); return; }
    // Legacy profile-tab layout (if present) still renders via renderPurchaseHistoryTab.
    if (document.getElementById('profile-tab-content')) await renderPurchaseHistoryTab(customer, 'profile-tab-content');
};

const savePaymentProof = async (purchaseId, customerId) => {
    const file = document.getElementById('proof-upload')?.files[0];
    if (!file) { UI.toast.error('Please select a file'); return; }
    if (file.size > 5 * 1024 * 1024) { UI.toast.error('File too large (max 5MB)'); return; }
    const fileName = `proof_${purchaseId}_${Date.now()}_${file.name}`;
    try {
        if (window.supabase) {
            // Supabase storage returns errors in the RESOLVED value, not by throwing —
            // must inspect { error } or a failed upload is silently treated as success.
            const { error: upErr } = await window.supabase.storage.from('attachments').upload(fileName, file);
            if (upErr) { UI.toast.error('Upload failed: ' + (upErr.message || upErr)); return; }
            // C2 (audit): store the storage PATH (object key), not a public URL —
            // rendered via a signed URL so the private bucket stays private.
            await AppDataStore.update('purchases', purchaseId, { proof: fileName, status: 'COLLECTED' });
        } else {
            // Offline / no Supabase client: record the filename only, don't claim COLLECTED.
            await AppDataStore.update('purchases', purchaseId, { proof: fileName });
        }
        UI.hideModal();
        UI.toast.success('Payment proof uploaded');
        await _refreshPurchasesUI(customerId);
    } catch (err) {
        UI.toast.error('Failed to save proof: ' + (err?.message || err));
    }
};

const renderEventHistory = (customer) => {
    const container = document.getElementById('event-attendance-section');
    container.innerHTML = `
        <div style="background:var(--white); padding:16px; border-radius:12px; border:1px solid var(--gray-200);">
            <h4 style="font-size:14px; font-weight:600; margin-bottom:12px; color:var(--gray-500);"><i class="fas fa-calendar-check" style="margin-right:8px;"></i> EVENT ATTENDANCE</h4>
            <div style="display:flex; flex-direction:column; gap:8px;">
                <div style="display:flex; justify-content:space-between; font-size:13px;"><span>15 Jan 2026: New Year Blessing</span> <span style="color:var(--success);">+15 pts</span></div>
                <div style="display:flex; justify-content:space-between; font-size:13px;"><span>10 Feb 2026: Wealth Workshop</span> <span style="color:var(--success);">+20 pts</span></div>
                <div style="display:flex; justify-content:space-between; font-size:13px;"><span>22 Mar 2026: Feng Shui Course</span> <span style="color:var(--success);">+40 pts</span></div>
            </div>
            <hr style="border:none; border-top:1px solid var(--gray-100); margin:12px 0;">
            <div style="display:flex; justify-content:space-between; font-weight:700;">
                <span>Total Events: 3</span>
                <span style="color:var(--primary);">75 Points</span>
            </div>
        </div>
    `;
};

const renderAgentEligibility = async (customer) => {
    const container = document.getElementById('agent-eligibility-section');
    // Real status/eligibility from customer data instead of a hardcoded 85% (audit #18).
    const _isAgentCust = !!(customer.is_agent || customer.agent_eligible || customer.is_agent_eligible);
    const _ltv = customer.lifetime_value || 0;
    const _meetsThreshold = _ltv >= 3000;
    const _statusLabel = _isAgentCust ? 'Agent' : 'Not an Agent';
    const _eligLabel = _isAgentCust
        ? 'Already an agent'
        : (_meetsThreshold ? 'Meets purchase threshold' : 'Below purchase threshold');
    container.innerHTML = `
        <div class="eligibility-card">
            <h3>Agent Package Eligibility</h3>
            <div style="font-size:13px; color:#6b21a8; margin-bottom:8px;">Current Status: <strong>${escapeHtml(_statusLabel)}</strong></div>
            <div style="font-size:12px; color:#7e22ce;">To become agent: Purchase Agent Package (min RM 3,000)</div>

            <div class="eligibility-score">
                <div style="font-size:13px;color:var(--gray-600);">Lifetime Value: <strong>${UI.money(_ltv, customer.country)}</strong></div>
                <div style="font-size:13px; font-weight:600; color:#6b21a8;">${escapeHtml(_eligLabel)}</div>
            </div>

            ${_isAgentCust ? '' : `<button class="btn primary" style="width:100%;justify-content:center;" onclick="app.openRecruitModal(${customer.id})">Offer Agent Package</button>`}
        </div>
    `;
};

const renderCustomerActivityTab = async (customer, containerId = 'profile-tab-content') => {
    const container = document.getElementById(containerId);
    // ── Meet Ups & Events — ONE merged timeline (2026-08-16) ─────────────────
    // Absorbs the old separate "Events Attended" section. Both data pipelines
    // are preserved verbatim; only the presentation changed to compact
    // expandable rows (same design as the prospect profile).
    // Activities: indexed dual-query bounded to the customer's own rows plus
    // (if converted) the pre-conversion prospect rows, deduped by id.
    // Events: event_attendees is the row the event modal actually writes when
    // a customer is added to an event; event_registrations is only a
    // side-effect of the "Attended" tick, so attendees are primary and
    // registrations a supplement for events attendees does not already cover.
    const customerId = customer.id;
    // Minutes / photo / "Before you meet" renderers are shared with the
    // prospect timeline (script-prospects.js) — load it if this is the first
    // profile opened this session. Rendering still works without it.
    if (!window.app.meetupBriefHtml && typeof window._loadChunk === 'function') {
        try { await window._loadChunk('chunks/script-prospects.min.js'); } catch (_) { /* intentional: brief is optional */ }
    }
    const _lpid = customer.converted_from_prospect_id != null ? Number(customer.converted_from_prospect_id) : null;
    const [custActs, prospActs, allRegs, allEvents, attendeeRows, taskMaps] = await Promise.all([
        AppDataStore.getActivitiesForCustomer(customer.id, { limit: 500 }),
        customer.converted_from_prospect_id
            ? AppDataStore.getActivitiesForProspect(customer.converted_from_prospect_id, { limit: 500 })
            : Promise.resolve([]),
        AppDataStore.getAll('event_registrations'),
        AppDataStore.getAll('events'),
        (window.app.getProspectAttendeeNotes || (() => Promise.resolve([])))(
            customerId, { includeWithoutNotes: true, attendeeType: 'customer' }
        ),
        // Each meeting's next action is ONE task now — the row shows its state.
        (window.app.pvTaskMaps || (() => Promise.resolve(null)))('customer', customer.id, _lpid).catch(() => null),
    ]);
    // Inside the profile the snapshot already says what happened last; the
    // "Before you meet" brief stays for the Meet-Up History pop-up only.
    const _inProfile = /^cust-acc-body-/.test(String(containerId || ''));
    const seenIds = new Set();
    const activities = [...custActs, ...prospActs]
        .filter(a => { if (seenIds.has(a.id)) return false; seenIds.add(a.id); return true; });
    const eventsById = new Map((allEvents || []).map(e => [String(e.id), e]));

    // Fresh minutes + photos for the customer's own rows (the activity list
    // caches a light select without meeting_minutes / photo_urls). Falls back
    // to photos-only when the meeting_minutes column is not there.
    const _sb = window.supabase || window.supabaseClient;
    const _ownIdsNum = activities.map(a => a.id).filter(id => id != null && !Number.isNaN(Number(id)));
    if (_sb && _ownIdsNum.length) {
        try {
            const _cols = 'id,photo_urls,meeting_minutes,note_key_points,note_needs,note_pain_points,next_action,next_actions,opportunity_potential,outcome';
            let { data: _fd, error: _fe } = await _sb.from('activities').select(_cols).in('id', _ownIdsNum);
            if (_fe) ({ data: _fd } = await _sb.from('activities').select('id,photo_urls').in('id', _ownIdsNum));
            const _fm = new Map((_fd || []).map(r => [String(r.id), r]));
            activities.forEach(a => {
                const r = _fm.get(String(a.id));
                if (!r) return;
                ['photo_urls', 'meeting_minutes', 'note_key_points', 'note_needs', 'note_pain_points', 'next_action', 'next_actions', 'opportunity_potential', 'outcome']
                    .forEach(k => { if (r[k] != null && r[k] !== '' && !(Array.isArray(r[k]) && !r[k].length)) a[k] = r[k]; });
            });
        } catch (_) { /* intentional: optional enrichment — rows still render */ }
    }

    // Owner-wins dedup: drop attendee rows whose parent activity is already an
    // own activity row (customer both hosted and attended).
    const ownIds = new Set(activities.map(a => String(a.id)));
    const attendees = (attendeeRows || []).filter(a => !ownIds.has(String(a._parentActivityId)));

    // Attended + closed at the SAME event → ONE row, joined only via
    // closing_activity_id (never date/title). The EVENT_CLOSING child renders
    // as a sub-block inside the attendee row and is never dropped.
    const closingById = new Map(activities.filter(a => a.activity_type === 'EVENT_CLOSING').map(a => [String(a.id), a]));
    const pairedClosingIds = new Set();
    attendees.forEach(a => {
        if (a.closing_activity_id != null && closingById.has(String(a.closing_activity_id))) {
            a._closing = closingById.get(String(a.closing_activity_id));
            pairedClosingIds.add(String(a.closing_activity_id));
        }
    });
    const rows = [
        ...activities.filter(a => !pairedClosingIds.has(String(a.id))),
        ...attendees,
    ];
    // NaN-safe date sort (missing date sorts oldest) + NaN-safe id tiebreak
    // (attendee ids are strings like 'att12').
    const _ts = (d) => { const t = Date.parse(d || ''); return Number.isNaN(t) ? 0 : t; };
    const _idNum = (x) => { const n = Number(x); return Number.isNaN(n) ? 0 : n; };
    rows.sort((a, b) => (_ts(b.activity_date || b.created_at) - _ts(a.activity_date || a.created_at))
        || (_idNum(b.id) - _idNum(a.id))
        || String(b.id).localeCompare(String(a.id)));

    // Registrations the attendee rows do not already cover.
    const coveredEventIds = new Set(
        rows.map(a => a.event_id).filter(v => v != null).map(String)
    );
    const VALID_REG_STATUSES_C2 = new Set(['Registered', 'Attended', 'No Show']);
    const registrations = (allRegs || []).filter(
        r => r.attendee_type === 'customer'
            && r.attendee_id == customerId
            && VALID_REG_STATUSES_C2.has(r.attendance_status)
            && !coveredEventIds.has(String(r.event_id))
    );

    const EVENT_TYPES_C = ['EVENT','AGENT_MEETING','AGENT_TRAINING','SITE'];
    const typeLabelC = { EVENT: 'Event', AGENT_MEETING: 'Agent Meeting', AGENT_TRAINING: 'Training', SITE: 'Site Visit' };
    const _kind = (a) => (a._isAttendeeNote || EVENT_TYPES_C.includes(a.activity_type)) ? 'event' : 'meetup';
    const _chip = (a) => {
        const t = a.activity_type || a.type;
        if (t === 'EVENT_CLOSING') return 'CLOSING';
        if (t === 'AGENT_MEETING') return 'MEETING';
        if (t === 'AGENT_TRAINING') return 'TRAINING';
        return t || 'NOTE';
    };
    const _attChip = (on, label) =>
        `<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:${on ? '#dcfce7' : 'var(--gray-100)'};color:${on ? '#166534' : 'var(--gray-500)'};">${on ? '✓' : '—'} ${label}</span>`;
    // Notes read as numbered points (shared renderer, prospects chunk).
    const _sec = (lbl, val, extra) => val ? `<div class="meet-section"><div class="meet-lbl">${lbl}</div>${window.app.pvPointsHtml ? window.app.pvPointsHtml(val, 'meet-txt') : `<div class="meet-txt"${extra || ''}>${escapeHtml(val)}</div>`}</div>` : '';
    const _mmC = (a) => (window.app.meetupMinutesOf || (() => ({})))(a);
    const _photosC = (a, viewCall) => (window.app.meetupPhotoStripHtml || (() => ''))(a, viewCall);
    const _OUTCOME_C = { positive: '👍 Positive', neutral: '😐 Neutral', negative: '👎 Negative', not_interested: '🚫 Not interested' };
    const _pre = ' style="white-space:pre-wrap;"';
    const _noteFieldsHtml = (a) => `
        ${_sec('Customer Background', _mmC(a).background, _pre)}
        ${_sec('Key Points', a.note_key_points)}
        ${_sec('Needs', a.note_needs)}
        ${_sec('Pain Points', a.note_pain_points)}
        ${_sec('Advisor Observations', _mmC(a).advisor, _pre)}
        ${_sec('Customer Reaction', _mmC(a).reaction, _pre)}
        ${_sec('Opportunity / Potential', a.opportunity_potential)}
        ${(window.app.pvTaskLineHtml || ((x) => _sec('Next Action', x.next_action)))(a, taskMaps)}`;

    const _rowHtml = (a) => {
        const _atype = a.activity_type || a.type;
        const date = a.activity_date || a.date || (a.created_at ? String(a.created_at).split('T')[0] : '');
        const event = a.event_id != null ? eventsById.get(String(a.event_id)) : null;
        const label = _atype === 'EVENT_CLOSING' ? 'Event Closing' : (typeLabelC[_atype] || _atype || 'Note');
        const title = a.activity_title || (event ? (event.title || event.event_title) : '') || label;
        const badges = [];
        if (a._isAttendeeNote) {
            const st = a.attendance_status === 'No Show' ? 'no show'
                : a.attendance_status === 'Late' ? 'late'
                : (a.attended || a.attendance_status === 'Attended') ? 'attended'
                : 'registered';
            badges.push(`<span class="mu-badge ${st === 'attended' || st === 'late' ? 'ok' : st === 'no show' ? 'bad' : ''}">${st === 'attended' ? '✓ ' : st === 'late' ? '⏰ ' : ''}${st}</span>`);
        }
        if (a.is_closed || (a._closing && a._closing.is_closed)) badges.push(`<span class="mu-badge ok"><i class="fas fa-handshake"></i> Sale Closed</span>`);
        const _nPhotos = Array.isArray(a.photo_urls) ? a.photo_urls.length : 0;
        if (_nPhotos) badges.push(`<span class="mu-badge"><i class="fas fa-camera"></i> ${_nPhotos}</span>`);

        let detail;
        if (a._isAttendeeNote) {
            detail = `
                <div class="meet-section"><div class="meet-lbl">Attendance</div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:2px;">
                        ${_attChip(a.paid, 'Paid')}
                        ${_attChip(a.ticket_created, 'Ticket')}
                        ${_attChip(a.attended || a.attendance_status === 'Attended', 'Attended')}
                        ${a.added_by_name ? `<span style="font-size:11px;color:var(--gray-500);">Added by ${escapeHtml(a.added_by_name)}</span>` : ''}
                    </div>
                </div>
                ${_sec('Summary', a.summary)}
                ${_noteFieldsHtml(a)}
                ${_photosC(a, `app.viewAttendeePhotos(${Number(a._attendeeRowId)})`)}
                <div class="meet-actions">
                    <button class="btn btn-sm secondary" onclick="event.stopPropagation();app.openAttendeePostEventModal(${Number(a._attendeeRowId)}, ${Number(a._parentActivityId)}, ${Number(customer.id)})"><i class="fas fa-sticky-note"></i> Post Event Notes</button>
                </div>
                ${a._closing ? `<div class="mu-close-sub"><div class="meet-lbl" style="color:var(--primary);"><i class="fas fa-handshake"></i> Event Closing${a._closing.is_closed ? ' — Sale Closed' : ''}</div>${_sec('Notes', a._closing.summary || a._closing.note_key_points)}</div>` : ''}`;
        } else {
            detail = `
                ${_sec('Notes', a.notes || '') || '<div class="meet-txt" style="color:var(--gray-400);font-style:italic;">No details provided.</div>'}
                ${_noteFieldsHtml(a)}
                ${_photosC(a, `app.viewActivityPhotos(${Number(a.id)})`)}
                ${a.id != null && !Number.isNaN(Number(a.id)) ? `<div class="meet-actions">
                    <button class="btn btn-sm secondary" onclick="event.stopPropagation();app.openPostMeetupNotesModal(${Number(a.id)}, ${Number(customer.id)})"><i class="fas fa-sticky-note"></i> Minutes</button>
                    ${_nPhotos ? '' : `<button class="btn btn-sm secondary" onclick="event.stopPropagation();app.attachActivityPhoto(${Number(a.id)})"><i class="fas fa-camera"></i> Attach Photo</button>`}
                </div>` : ''}`;
        }
        return `
            <div class="mu-item" data-kind="${_kind(a)}" data-muid="${(window.app.meetupRowId || (() => ''))(a)}">
                <button type="button" class="mu-row" aria-expanded="false" onclick="this.closest('.mu-item').classList.toggle('open');this.setAttribute('aria-expanded',this.closest('.mu-item').classList.contains('open'))">
                    <i class="fas fa-chevron-right mu-caret"></i>
                    <span class="mu-date">${escapeHtml(date || '—')}</span>
                    <span class="mu-tchip">${escapeHtml(_chip(a))}</span>
                    <span class="mu-title">${escapeHtml(title)}</span>
                    <span class="mu-badges">${badges.join('')}</span>
                    ${window.app.pvMeetingSummaryHtml ? window.app.pvMeetingSummaryHtml(a, taskMaps)
                        : (a.outcome ? `<span class="mu-badge ok">${escapeHtml(_OUTCOME_C[a.outcome] || a.outcome)}</span>` : '')}
                </button>
                <div class="mu-detail">${detail}</div>
            </div>`;
    };

    // Points footer — same formula as the old Events Attended section:
    // count = attendee rows + supplemental registrations; points come from
    // registrations only.
    let totalPts = 0;
    registrations.forEach(r => { totalPts += (r.points_awarded || 0); });
    const totalEvents = (attendeeRows || []).length + registrations.length;

    const nMeet = rows.filter(a => _kind(a) === 'meetup').length;
    const nEvent = rows.length - nMeet;
    let html = `
        <div class="mu-wrap" data-muf="all">
            <div class="mu-toolbar">
                <div class="mu-fchips" role="group" aria-label="Filter meet ups and events">
                    <button type="button" class="mu-fchip" data-f="all" onclick="this.closest('.mu-wrap').dataset.muf='all'">All (${rows.length})</button>
                    <button type="button" class="mu-fchip" data-f="meetup" onclick="this.closest('.mu-wrap').dataset.muf='meetup'">Meet Ups (${nMeet})</button>
                    <button type="button" class="mu-fchip" data-f="event" onclick="this.closest('.mu-wrap').dataset.muf='event'">Events (${nEvent})</button>
                </div>
                <button class="btn secondary btn-sm" onclick="app.openActivityModal(null, 'customer', ${customer.id})">+ Log Activity</button>
            </div>
            ${_inProfile ? '' : (window.app.meetupBriefHtml || (() => ''))(rows, { typeLabel: typeLabelC })}
            ${rows.length > 0
                ? `<div class="mu-list">${rows.map(_rowHtml).join('')}</div>`
                : '<p style="color:var(--gray-400); font-size:13px;">No meet ups or events recorded yet.</p>'}
        </div>`;
    if (registrations.length > 0) {
        html += `<div class="pv-sub" style="margin-top:12px;">Event Registrations</div>`;
        for (const r of registrations) {
            const event = eventsById.get(String(r.event_id));
            html += `<div class="pv-row"><span class="pv-lbl">${escapeHtml(r.event_date || '-')}</span><span class="pv-val" style="display:flex;justify-content:space-between;">${escapeHtml(event?.title || 'Unknown')} <span style="color:var(--success);font-weight:600;flex-shrink:0;">+${r.points_awarded || 0} pts</span></span></div>`;
        }
    }
    if (totalEvents > 0) {
        html += `
            <div style="display:flex;justify-content:space-between;font-weight:700;margin-top:12px;padding-top:12px;border-top:1px solid var(--gray-200);">
                <span>Total Events: ${totalEvents}</span>
                <span style="color:var(--primary);">${totalPts} Points</span>
            </div>`;
    }
    container.innerHTML = html;
    // Inline discussion-paper thumbs → signed URLs (also inside modals).
    try { window._resolveAttachmentImages && setTimeout(() => window._resolveAttachmentImages(), 0); } catch (_) { /* best-effort */ }
    // A re-render follows a save — the DB may have made or closed a task.
    if (_inProfile) {
        if (container.dataset.pvRendered && window.app.pvRefreshTasks) window.app.pvRefreshTasks('customer', customer.id).catch(() => {});
        container.dataset.pvRendered = '1';
    }
};

const renderCustomerTags = async (customer) => {
    const container = document.getElementById('customer-tags-section');
    const entityTags = await AppDataStore.query('entity_tags', { entity_type: 'customer', entity_id: customer.id });

    let tagsHtml = '<p style="color:var(--gray-400); font-size:12px;">No tags yet.</p>';
    if (entityTags.length > 0) {
        const tagSpans = await Promise.all(entityTags.map(async (et) => {
            const tag = await AppDataStore.getById('tags', et.tag_id);
            return tag ? `
                <span class="score-badge" style="background:${/^#[0-9a-f]{3,8}$|^[a-z]+$/i.test(String(tag.color || '')) ? tag.color : 'var(--primary)'}; color:white; display:flex; align-items:center; gap:4px; font-size:11px;">
                    ${escapeHtml(tag.name)} <span style="cursor:pointer;" onclick="app.removeTagFromCustomer(${customer.id}, ${tag.id})">&times;</span>
                </span>
            ` : '';
        }));
        tagsHtml = tagSpans.join('');
    }

    container.innerHTML = `
        <div style="background:var(--white); padding:16px; border-radius:12px; border:1px solid var(--gray-200);">
            <h4 style="font-size:13px; font-weight:700; color:var(--gray-500); margin-bottom:12px;">TAGS</h4>
            <div style="display:flex; flex-wrap:wrap; gap:8px;">
                ${tagsHtml}
                <button class="btn-sm secondary" style="border-radius:20px; font-size:11px;" onclick="app.openAddTagModal(${customer.id}, 'customer')">+ Add Tag</button>
            </div>
        </div>
    `;
};

const zoomCpsPhoto = (url) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:zoom-out;';
    overlay.onclick = () => overlay.remove();
    overlay.innerHTML = `<img loading="lazy" decoding="async" data-attach-src="${escapeHtml(url)}" style="max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.5);" onclick="event.stopPropagation()">`;
    document.body.appendChild(overlay);
    if (window._resolveAttachmentImages) window._resolveAttachmentImages(overlay);
};

// ── Internal render-builders (extracted from showProspectDetail) ───────────
// Pure string assembly for the prospect-detail view. The header builder owns
// the <style> block, the back button, the unable-to-serve banner and the
// identity header (badges + name + action buttons + CPS photo). The tabs
// builder owns the accordion shell. Both are byte-for-byte equivalent to the
// inline templates they replace; the orchestrator concatenates them in order.
// ── Edit customer profile (2026-10-16) ───────────────────────────────────────
// After conversion the customer is the ONE editable record (the prospect's
// profile is frozen). Same edit policy as prospects: L1-2 anything, L3-10 their
// team's records, L11+ their own. L1-5 (admin, marketing manager, management,
// team leaders) save straight through; L6+ files an Info Update for approval.
const _customerEditSavesDirect = () => !!_state.cu && _getUserLevel(_state.cu) <= 5;

const _canEditCustomer = async (customer) => {
    const user = _state.cu;
    if (!user || !customer) return false;
    const level = _getUserLevel(user);
    if (level <= 2) return true;
    if (level <= 10) {
        const visibleIds = await getVisibleUserIds(user);
        if (visibleIds === 'all') return true;
        return visibleIds.some(id => String(id) === String(customer.responsible_agent_id));
    }
    return String(customer.responsible_agent_id) === String(user.id);
};

const _custBgField = (id, label, value, opts = {}) => {
    const v = value == null ? '' : String(value);
    if (opts.textarea) return `<div class="form-group"><label>${label}</label><textarea id="${id}" class="form-control" rows="${opts.rows || 2}">${escapeHtml(v)}</textarea></div>`;
    return `<div class="form-group${opts.half ? ' half' : ''}"><label>${label}</label><input type="${opts.type || 'text'}" id="${id}" class="form-control" value="${escapeHtml(v)}"></div>`;
};

const openCustomerEditModal = async (customerId) => {
    // The basic-info form (shared with the prospect + CPS forms) lives in the
    // activities chunk — warm it first or the modal opens empty.
    if (typeof window._loadChunk === 'function') {
        try { await window._loadChunk('chunks/script-activities.min.js'); } catch (_) { /* intentional: guarded below */ }
    }
    if (typeof window.app.buildBasicInfoBlock !== 'function') {
        UI.toast.error('Could not load the edit form. Please reload and try again.');
        return;
    }
    // FULL row: the form is save-the-whole-record, so a column missing from the
    // prefill would be written back blank.
    const customer = (AppDataStore.getByIdFull ? await AppDataStore.getByIdFull('customers', customerId).catch(() => null) : null)
        || await AppDataStore.getById('customers', customerId);
    if (!customer) { UI.toast.error('Customer not found.'); return; }
    if (!(await _canEditCustomer(customer))) { UI.toast.error('You cannot edit this customer.'); return; }
    // The form's referrer search/clear handlers are keyed to the 'prospect' prefix
    // and keep the pick in _state.sprr — same as Edit Prospect.
    _state.sprr = customer.referred_by ? { name: customer.referred_by, id: customer.referred_by_id || null, type: customer.referred_by_type || null } : null;
    const isManager = _customerEditSavesDirect();
    const c = customer;
    const content = `
        <div class="prospect-form form-compact">
            <input type="hidden" id="edit-customer-id" value="${Number(customer.id)}">
            ${isManager ? '' : `<div class="pv-notice is-warning"><div class="pv-notice-title" style="margin:0;"><i class="fas fa-user-check" aria-hidden="true"></i> Changes are sent to a manager for approval before they show on the profile.</div></div>`}
            <div class="form-section">
                <h4>Basic Information</h4>
                ${window.app.buildBasicInfoBlock('prospect', customer)}
            </div>
            <div class="form-section">
                <h4>Business &amp; Background</h4>
                <div class="form-group"><label style="display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer;"><input type="checkbox" id="cust-bg-own-business" ${c.is_own_business ? 'checked' : ''}> Own business</label></div>
                <div class="form-row">${_custBgField('cust-bg-business-name', 'Business Name', c.business_name, { half: true })}${_custBgField('cust-bg-business-industry', 'Industry', c.business_industry, { half: true })}</div>
                <div class="form-row">${_custBgField('cust-bg-business-area', 'Business Area', c.business_area, { half: true })}${_custBgField('cust-bg-business-title', 'Customer Title / Role', c.business_title_role, { half: true })}</div>
                <div class="form-row">${_custBgField('cust-bg-business-started', 'Operating Since', c.business_started, { half: true, type: 'date' })}${_custBgField('cust-bg-company-size', 'Company Size', c.company_size, { half: true })}</div>
                <div class="form-row">${_custBgField('cust-bg-source', 'Lead Source', c.source, { half: true })}${_custBgField('cust-bg-budget', 'Budget', c.budget_range, { half: true })}</div>
                ${_custBgField('cust-bg-decision-maker', 'Decision Maker', c.decision_maker)}
                ${_custBgField('cust-bg-interests', 'Interests', c.interests, { textarea: true })}
                ${_custBgField('cust-bg-pain-points', 'Pain Points', c.pain_points, { textarea: true })}
                ${_custBgField('cust-bg-notes', 'Notes', c.notes, { textarea: true, rows: 3 })}
            </div>
        </div>`;
    UI.showModal('Edit Customer', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: isManager ? 'Save' : 'Submit for Approval', type: 'primary', action: `(async () => { await app.saveCustomerProfile(${Number(customer.id)}); })()` }
    ], window.matchMedia('(max-width: 768px)').matches ? 'fullscreen' : '');
    setTimeout(() => { (window.app.prefillProspectChildren || (() => {}))(customer.children, customer.created_at); }, 0);
};

const _custSaveInFlight = new Set();
const saveCustomerProfile = async (customerId) => {
    const key = String(customerId);
    if (_custSaveInFlight.has(key)) return;
    _custSaveInFlight.add(key);
    try {
        const name = document.getElementById('prospect-name')?.value?.trim();
        const phone = document.getElementById('prospect-phone')?.value?.trim();
        const email = document.getElementById('prospect-email')?.value?.trim();
        if (!name) { UI.toast.error('Name is required'); return; }
        if (!phone) { UI.toast.error('Phone is required'); return; }
        if (!/^[0-9\+\-\s]{8,}$/.test(phone)) { UI.toast.error('Enter a valid phone number (min 8 digits)'); return; }
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { UI.toast.error('Invalid email format'); return; }

        const before = (AppDataStore.getByIdFull ? await AppDataStore.getByIdFull('customers', customerId).catch(() => null) : null)
            || await AppDataStore.getById('customers', customerId);
        if (!before) { UI.toast.error('Customer not found'); return; }
        if (!(await _canEditCustomer(before))) { UI.toast.error('You do not have permission to edit this customer.'); return; }

        const basic = (window.app.collectBasicInfoData || (() => ({})))('prospect');
        delete basic.manual_grade; // a prospect pipeline grade — not a customer field
        const val = (id) => document.getElementById(id)?.value?.trim() || null;
        const data = {
            ...basic,
            full_name: name,
            phone,
            referred_by: _state.sprr?.name || null,
            referred_by_id: _state.sprr?.id || null,
            referred_by_type: _state.sprr?.type || null,
            is_own_business: !!document.getElementById('cust-bg-own-business')?.checked,
            business_name: val('cust-bg-business-name'),
            business_industry: val('cust-bg-business-industry'),
            business_area: val('cust-bg-business-area'),
            business_title_role: val('cust-bg-business-title'),
            business_started: val('cust-bg-business-started'),
            company_size: val('cust-bg-company-size'),
            source: val('cust-bg-source'),
            budget_range: val('cust-bg-budget'),
            decision_maker: val('cust-bg-decision-maker'),
            interests: val('cust-bg-interests'),
            pain_points: val('cust-bg-pain-points'),
            notes: val('cust-bg-notes'),
        };
        // Only what actually changed — the approval diff and the update both stay small.
        const _same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
            || (String(a ?? '') === '' && String(b ?? '') === '');
        const changed = {};
        Object.keys(data).forEach(k => { if (!_same(data[k], before[k])) changed[k] = data[k]; });
        if (Object.keys(changed).length === 0) { UI.hideModal(); UI.toast.info('No changes to save.'); return; }

        const isManager = _customerEditSavesDirect();
        if (isManager) {
            try {
                await AppDataStore.update('customers', customerId, changed);
            } catch (e) {
                const msg = String(e?.message || e);
                UI.toast.error(/duplicate|unique/i.test(msg) ? 'Not saved — that phone/email already belongs to another record.' : 'Save failed: ' + msg);
                return;
            }
            UI.hideModal();
            UI.toast.success('Customer updated');
        } else {
            const snapBefore = {};
            Object.keys(changed).forEach(k => { snapBefore[k] = before[k] ?? null; });
            try {
                await AppDataStore.create('approval_queue', {
                    approval_type: 'info_update',
                    status: 'pending',
                    prospect_id: null,
                    customer_id: Number(customerId),
                    submitted_by: _state.cu?.id,
                    submitted_at: new Date().toISOString(),
                    snapshot_before: { full_name: before.full_name, ...snapBefore },
                    snapshot_after: { full_name: name, ...changed },
                    description: `Information update for ${name}`,
                });
            } catch (e) {
                UI.toast.error('Could not send for approval: ' + String(e?.message || e));
                return;
            }
            UI.hideModal();
            UI.toast.success('Sent to a manager for approval');
        }
        _state.sprr = null;
        // Repaint Basic Information in place (it reads the live row).
        const infoBody = document.getElementById(`cust-acc-body-info-${customerId}`);
        if (infoBody) await switchCustomerProfileTab('info', customerId, infoBody);
    } finally {
        _custSaveInFlight.delete(key);
    }
};

// Local (MYT) calendar day as YYYY-MM-DD — a UTC date would be yesterday before 08:00.
const _custLocalDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

const openAddCustomerModal = async () => {
    const content = `
<div class="warning-banner" style="background:#fff3cd; border:1px solid #ffc107; color:#856404; padding:12px; border-radius:8px; margin-bottom:16px;">
                <i class="fas fa-exclamation-triangle"></i>
                <span>⚠️ Manually adding a customer is for legacy data import only. New customers should be converted automatically from Prospects when lifetime value reaches RM 2,000.</span>
            </div>
<div class="form-section">
    <div class="form-group"><label>Full Name <span class="required">*</span></label><input type="text" id="cust-name" class="form-control" placeholder="Full name"></div>
    <div class="form-row">
        <div class="form-group half"><label>Phone <span class="required">*</span></label><input type="tel" id="cust-phone" class="form-control"></div>
        <div class="form-group half"><label>Email</label><input type="email" id="cust-email" class="form-control"></div>
    </div>
    <div class="form-row">
        <div class="form-group half"><label>IC Number</label><input type="text" id="cust-ic" class="form-control"></div>
        <div class="form-group half"><label>Date of Birth</label><input type="date" id="cust-dob" class="form-control"></div>
    </div>
    <div class="form-row">
        <div class="form-group half"><label>Previous Prospect ID</label><input type="text" id="cust-prev-id" class="form-control"></div>
        <div class="form-group half"><label>Initial Purchase Amt</label><input type="number" id="cust-init-amt" class="form-control"></div>
    </div>
    <div class="form-row">
        <div class="form-group half"><label>Customer Since</label><input type="date" id="cust-since" class="form-control" value="${_custLocalDay()}" max="${_custLocalDay()}"></div>
    </div>
    <div class="form-row">
        <div class="form-group half"><label>Market / Country</label>
            <select id="cust-country" class="form-control">
                ${(UI.countries || []).map(c => `<option value="${c.code}" ${c.code === window._crmUtils.cuHomeCountry() ? 'selected' : ''}>${escapeHtml(c.name)} (${escapeHtml(c.symbol)})</option>`).join('')}
            </select>
        </div>
    </div>
    <div class="form-group"><label>Notes</label><textarea id="cust-notes" class="form-control" rows="2" placeholder="Legacy data notes..."></textarea></div>
</div>
`;
    UI.showModal('Add New Customer (Legacy Import)', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Create Customer', type: 'primary', action: '(async () => { await app.saveCustomer(); })()' }
    ]);
};

const saveCustomer = async () => {
    const name = document.getElementById('cust-name')?.value;
    if (!name) return UI.toast.error('Name is required');
    // Persist the Previous Prospect ID (converted_from_prospect_id) and Notes the
    // modal collects — the old payload silently dropped both, breaking the
    // pre-conversion history linkage for legacy imports (audit #10). `notes` is
    // written best-effort: if the customers table has no such column the store's
    // schema-error retry strips it, but we no longer claim it saved when it didn't.
    const _prevIdRaw = document.getElementById('cust-prev-id')?.value?.trim();
    const _prevId = _prevIdRaw ? parseInt(_prevIdRaw, 10) : null;
    const _notes = document.getElementById('cust-notes')?.value?.trim() || null;
    const _custPayload = {
        full_name: name,
        phone: document.getElementById('cust-phone')?.value,
        email: document.getElementById('cust-email')?.value,
        ic_number: document.getElementById('cust-ic')?.value,
        date_of_birth: document.getElementById('cust-dob')?.value,
        lifetime_value: parseFloat(document.getElementById('cust-init-amt')?.value) || 0,
        status: 'active',
        // The real date they became a customer (NC in the weekly report), not the key-in day.
        customer_since: document.getElementById('cust-since')?.value || _custLocalDay(),
        responsible_agent_id: _state.cu?.id || null,
        country: UI.countryByCode(document.getElementById('cust-country')?.value).code,
    };
    if (_prevId != null && Number.isFinite(_prevId)) _custPayload.converted_from_prospect_id = _prevId;
    if (_notes) _custPayload.notes = _notes;
    // Guard the create: an RLS deny / offline / validation reject must surface an error
    // and keep the modal open, not throw an unhandled rejection + close silently.
    try {
        await AppDataStore.create('customers', _custPayload);
    } catch (e) {
        UI.toast.error('Failed to create customer: ' + (e?.message || e));
        return; // keep modal open so the user can retry
    }
    UI.hideModal();
    UI.toast.success('Customer created (Legacy)');
    if (document.getElementById('customers-table-body')) await renderCustomersTable();
};

// NPO is NOT a normal purchase — it never creates a `purchases` row, never
// touches savePurchase / lifetime_value / leaderboard. Selecting "NPO" in the
// Add-Purchase modal is purely a launch point: close this modal, lazy-load the
// NPO chunk, then open the NPO order wizard pre-linked to the SAME customer.
const npoLaunchFromPurchase = async (customerId) => {
    UI.hideModal();
    try {
        if (typeof window._loadChunk === 'function') {
            await window._loadChunk('chunks/script-npo.min.js');
        }
    } catch (_) { /* fall through — guard below reports if the fn is still missing */ }
    const open = window.app && window.app.npoOpenOrderModal;
    if (typeof open !== 'function') {
        UI.toast.error('NPO module unavailable — please try again');
        return;
    }
    await open(customerId);
};

// Resolve a product's ABSOLUTE price for a market from its per-country price map.
// No FX conversion: prices[country] is a number typed per market. Falls back to the
// base `price` only for the default market; other markets with no price → null.
const _productPriceFor = (p, country) => {
    const m = (p && p.prices) || {};
    if (m[country] != null) return m[country];
    if (country === UI.defaultCountry) return p?.price ?? null;
    return null;
};

// ── Installment / Power-Ring helpers (shared by the Add Purchase modal and the
// Product Delivery Listing board) ────────────────────────────────────────────
// EPP is a BANK plan (the bank pays us up front) → treated as full payment.
// Company-financed installments (POP/PCP/PON/NPO) must be fully paid before the
// item can be queued for production — their tenure drives the maturity date.
const _INSTALLMENT_METHODS = new Set(['POP', 'PCP', 'PON', 'NPO']);
const _isInstallmentMethod = (m) => _INSTALLMENT_METHODS.has(String(m || '').toUpperCase());
// Inline-tenure plans (keyed on the purchase modal). NPO has its own order flow
// with a real npo_installments schedule, so it's excluded here.
const _TENURE_METHODS = ['POP']; // PCP / PON retired 2026-10-15 (never used)
// Power Ring detection: explicit "Power Ring" wording or the PR# SKU line.
const _isPowerRingName = (name) => /power\s*ring/i.test(name || '') || /^\s*PR\d/i.test(name || '');
// purchase date (YYYY-MM-DD) + N months → maturity date string. Parse and shift
// in UTC so toISOString() doesn't roll the day back by the local TZ offset.
const _addMonths = (dateStr, months) => {
    if (!dateStr || !(months > 0)) return '';
    const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00Z');
    if (isNaN(d.getTime())) return '';
    // Clamp day-of-month overflow so month-end dates don't spill into the next
    // month (Aug 31 + 6mo → Feb 31 → Mar 3). Matches the NPO chunk's _addMonths
    // (audit #22): Jan 31 + 1mo → Feb 28/29, not Mar 3.
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + Number(months));
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, lastDay));
    return d.toISOString().split('T')[0];
};

// Show the Power Ring size field only when the chosen/typed product is a Power Ring.
const _syncRingSizeField = () => {
    const sel = document.getElementById('pur-product');
    const other = document.getElementById('pur-other');
    const name = sel?.value === 'Other' ? (other?.value || '') : (sel?.value || '');
    const wrap = document.getElementById('ring-size-field');
    if (wrap) wrap.style.display = _isPowerRingName(name) ? 'block' : 'none';
};

// Product <select> change: prefill the price (kept from the original inline fn)
// and toggle the ring-size field.
const _onPurchaseProductChange = (sel) => {
    const o = sel.options[sel.selectedIndex];
    const amt = document.getElementById('pur-amt');
    if (sel.value !== 'Other' && o && o.dataset && o.dataset.price !== '' && o.dataset.price != null && amt) {
        amt.value = o.dataset.price;
    }
    _syncRingSizeField();
};

// Payment method change: toggle EPP fields, installment (tenure+advance) fields,
// and launch the NPO order flow when NPO is picked.
const _onPurchaseMethodChange = (val, customerId) => {
    UI.toggleEppFields('pur', val);
    const inst = document.getElementById('installment-fields');
    if (inst) inst.style.display = _TENURE_METHODS.includes(val) ? 'block' : 'none';
    if (val === 'NPO') window.app.npoLaunchFromPurchase(customerId);
};

const openAddPurchaseModal = async (customerId) => {
    if (!window.app.bjcAttachSelect && window._loadChunk) window._loadChunk('chunks/script-activities.min.js').catch(() => {});
    const customer = await AppDataStore.getById('customers', customerId);
    // getById can return null (RLS deny / offline / deleted id) — guard before deref.
    if (!customer) { UI.toast.error('Customer not found'); return; }
    // This customer's market drives the currency label + per-country price prefill.
    const _cur = UI.currencyForCountry(customer.country);
    const _sym = UI.countryByCode(customer.country).symbol;
    const _products = await AppDataStore.getAll('products').catch(() => []);
    const _prodOptions = UI.productOptionsHtml(_products, {
            renderOption: (p) => {
                const price = _productPriceFor(p, customer.country);
                return `<option value="${escapeHtml(p.name)}" data-price="${price != null ? price : ''}">${escapeHtml(p.name)}${price != null ? ` (${UI.formatCurrency(price, { currency: _cur })})` : ''}</option>`;
            },
        })
        || ['PR4 Power Ring', 'PR3 Ring', 'Office Audit', 'Harmony Painting'].map(n => `<option value="${n}">${n}</option>`).join('');
    const content = `
<div class="form-section">
                <div class="form-group">
                    <label>Product</label>
                    <select id="pur-product" class="form-control" onchange="app._onPurchaseProductChange(this)">
                        ${_prodOptions}
                        <option value="Other">Other (Type below)</option>
                    </select>
                </div>
                <div class="form-group"><label>Product Name (if Other)</label><input type="text" id="pur-other" class="form-control" oninput="app._syncRingSizeField()"></div>
                <div class="form-group" id="ring-size-field" style="display:none;">
                    <label>Power Ring Size <span class="required">*</span></label>
                    <input type="number" id="pur-ring-size" class="form-control" step="0.5" min="1" placeholder="Ring size (numeric)">
                </div>
                <input type="hidden" id="pur-currency" value="${_cur}">
                <div class="form-row">
                    <div class="form-group half"><label>Amount (${escapeHtml(_sym)}) <span class="required">*</span></label><input type="number" id="pur-amt" class="form-control"></div>
                    <div class="form-group half">
                        <label>Payment Method</label>
                        <select id="pur-method" class="form-control" onchange="app._onPurchaseMethodChange(this.value, ${customerId})">
                            ${UI.paymentMethodOptionsHtml('Cash')}
                        </select>
                    </div>
                </div>
                ${UI.eppFieldsHtml('pur', { show: false })}
                <div id="installment-fields" style="display:none; margin-bottom:16px;">
                    <div class="form-row">
                        <div class="form-group half"><label>Tenure (months) <span class="required">*</span></label><input type="number" id="pur-tenure" class="form-control" min="1" placeholder="e.g. 12"></div>
                        <div class="form-group half"><label>Down Payment (RM)</label><input type="number" id="pur-down" class="form-control" min="0" step="0.01" placeholder="0.00"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group half" style="display:flex; align-items:flex-end;">
                            <label class="checkbox-label" style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="pur-advance"> Deliver in advance (special package)</label>
                        </div>
                    </div>
                    <div style="font-size:12px; color:var(--gray-500);">Installment items queue for production only after full payment, unless "deliver in advance" is set. Maturity = purchase date + tenure.</div>
                </div>
                <div class="form-row">
                    <div class="form-group half"><label>Invoice Date <span class="required">*</span></label><input type="date" id="pur-date" class="form-control" value="${_custLocalDay()}" max="${_custLocalDay()}"></div>
                    <div class="form-group half"><label>Invoice No. <span class="required">*</span></label><input type="text" id="pur-inv" class="form-control" placeholder="Enter invoice number"></div>
                </div>
                <div class="form-row">
                    <div class="form-group half"><label>Expected Ready (Collection) Date</label><input type="date" id="pur-ready" class="form-control">
                        <small style="color:var(--gray-500);display:block;margin-top:4px;">When the custom item should be ready — the delivery board reminds the agent 30 days before.</small></div>
                </div>
                <div class="form-row">
                    <div class="form-group half"><label>Payment Status</label>
                        <select id="pur-status" class="form-control">
                            <option value="PENDING">Pending</option>
                            <option value="COMPLETED">Completed</option>
                            <option value="COLLECTED">Collected</option>
                            <option value="N/A">N/A</option>
                        </select>
                    </div>
                </div>
                <div class="form-group"><label>Delivery Status</label>
                    <select id="pur-delivery" class="form-control">
                        <option value="Pending Delivery">Pending Delivery</option>
                        <option value="Dispatched">Dispatched</option>
                        <option value="Delivered">Delivered</option>
                    </select>
                </div>
                <div class="form-group"><label>Redemption Image</label><input type="file" id="pur-file" class="form-control"></div>
                <div class="form-group">
                    <label class="checkbox-label" style="display:flex; align-items:center; gap:8px;">
                        <input type="checkbox" id="is-agent-pkg" onchange="const pkg = document.getElementById('pkg-fields'); if(this.checked) pkg.style.display='block'; else pkg.style.display='none';"> Is Agent Package?
                    </label>
                </div>
                <div id="pkg-fields" style="display:none;">
                    <div class="form-group"><label>Package Name</label><input type="text" id="pur-pkg-name" class="form-control"></div>
                    <div class="form-group"><label>Description</label><textarea id="pur-pkg-desc" class="form-control" rows="2"></textarea></div>
                </div>
            </div>
`;
    UI.showModal(`Add Purchase for ${escapeHtml(customer.full_name || '')}`, content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Add Purchase', type: 'primary', action: `(async () => { await app.savePurchase(${customerId}); })()` }
    ]);
};

// Delegates to the shared, race-free LTV + total_purchases adjuster on _crmUtils so
// the customers chunk and the approvals chunk apply lifetime_value identically.
// (audit #8/#16/#22 — see window._crmUtils.adjustCustomerLtv in script.js.)
const _adjustCustomerLtv = (customerId, amountDelta, countDelta) =>
    _utils.adjustCustomerLtv(customerId, amountDelta, countDelta);

// Synchronous double-submit guard for savePurchase — mirrors _convInFlight in
// approveProspectConversion. Set BEFORE the first await, released in finally, so a
// rapid second click on "Add Purchase" can't double-insert + double-bump LTV.
const _savePurchaseInFlight = new Set();

const savePurchase = async (customerId) => {
    const amt = parseFloat(document.getElementById('pur-amt')?.value);
    if (!(amt > 0)) return UI.toast.error('Amount must be a positive number');
    const invoiceNo = document.getElementById('pur-inv')?.value?.trim();
    if (!invoiceNo) return UI.toast.error('Invoice No. is required');
    // Reports bucket a sale by its INVOICE date, so a backdated entry lands in the
    // week it was actually sold — never the day it was keyed in.
    const invoiceDate = document.getElementById('pur-date')?.value || _custLocalDay();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) return UI.toast.error('Invoice Date is required');
    if (invoiceDate > _custLocalDay()) return UI.toast.error('Invoice Date cannot be in the future');

    // ── Double-submit guard (synchronous, set before any await) ──
    const _key = String(customerId);
    if (_savePurchaseInFlight.has(_key)) return; // a save for this customer is already running
    _savePurchaseInFlight.add(_key);

    try {
        const item = document.getElementById('pur-product')?.value === 'Other' ? document.getElementById('pur-other')?.value : document.getElementById('pur-product')?.value;

        // Match with promotion package if exists
        let packageId = null;
        const allPackages = await AppDataStore.getAll('promotion_packages');
        const allProductsForPkg = await AppDataStore.getAll('products');
        const productNameMap = new Map(allProductsForPkg.map(pr => [pr.id, pr.name]));
        let matchingPkg = null;
        for (const p of allPackages) {
            if (!p.is_active) continue;
            const found = (p.product_ids || []).some(pid => productNameMap.get(pid) === item);
            if (found) { matchingPkg = p; break; }
        }
        if (matchingPkg) packageId = matchingPkg.id;

        const purMethod = document.getElementById('pur-method')?.value || 'Cash';
        // epp_months is an integer column — send null (not '') when not EPP, otherwise
        // the Supabase insert fails with "invalid input syntax for type integer" (22P02),
        // the purchase gets written to localStorage only, and subsequent query() calls
        // read from Supabase and show RM 0.
        const eppMonthsRaw = purMethod === 'EPP' ? document.getElementById('pur-epp-months')?.value : '';
        const eppMonthsInt = parseInt(eppMonthsRaw, 10);
        const eppBankRaw = purMethod === 'EPP' ? document.getElementById('pur-epp-bank')?.value?.trim() : '';
        const popDownRaw = parseFloat(document.getElementById('pur-down')?.value);
        // Persist the explicit "Is Agent Package?" selection (is_agent_package is a real
        // boolean column on purchases — reporting RPCs exclude these from sales totals).
        const isAgentPkg = !!document.getElementById('is-agent-pkg')?.checked;
        // ── Company-financed installment (POP): tenure (months) drives the
        // maturity date the delivery board uses to gate production queueing. Required. ──
        const isInstMethod = _TENURE_METHODS.includes(purMethod);
        const tenureInt = parseInt(document.getElementById('pur-tenure')?.value, 10);
        if (isInstMethod && !(tenureInt > 0)) { UI.toast.error('Tenure (months) is required for installment plans'); return; }
        const isAdvancePkg = isInstMethod && !!document.getElementById('pur-advance')?.checked;
        // ── Power Ring size — mandatory for every Power Ring (esp. installments, which
        // have a long lead time before production). ──
        const ringSize = (document.getElementById('pur-ring-size')?.value || '').trim();
        if (_isPowerRingName(item) && !ringSize) { UI.toast.error('Power Ring size is required'); return; }
        // Redemption image: capture the actual File now (the modal closes after save).
        // The old code stored the fake string 'image_uploaded.png' and dropped the
        // bytes (audit #12) — we upload the real file post-insert and store its URL.
        const _proofFile = document.getElementById('pur-file')?.files?.[0] || null;
        // Fetch customer for the post-save re-render fallback AND to stamp the
        // credited agent below.
        //
        // NOTE (supersedes the old "purchases have no agent column — do NOT add one"
        // warning): purchases.agent_id now EXISTS and is created by
        // migrations/purchases_frozen_agent_credit_2026-07-28.sql. The original 2026-04
        // bug was a PHANTOM column — code wrote and read agent_id with no migration
        // behind it, causing a silent strip-retry on every save and an always-zero
        // leaderboard. The column is real now and every reader resolves
        // coalesce(agent_id, customers.responsible_agent_id), so writing it is correct.
        // Network-first for the CREDIT source: a cached row from before a
        // reassignment would freeze the wrong agent onto this sale forever. Falls
        // back to the cached read (which also feeds currency + the post-save
        // re-render) when the network read is unavailable.
        const customer = (await AppDataStore.getByIdFull('customers', customerId).catch(() => null))
                       || await AppDataStore.getById('customers', customerId);
        const pur = {
            customer_id: customerId,
            // Freeze sale credit at booking time so a later reassignment of this
            // customer cannot restate historical revenue. This is the OWNER now, not
            // the closer — owner attribution is deliberate.
            agent_id: customer?.responsible_agent_id ?? null,
            // The invoice date the agent picked (defaults to today, local MYT day).
            // Reports, maturity math and the delivery board all key off this.
            date: invoiceDate,
            invoice: invoiceNo,
            item: item,
            amount: amt,
            // Currency the sale was booked in — from the modal's hidden field
            // (customer's market), falling back to the customer's country.
            currency: document.getElementById('pur-currency')?.value || UI.currencyForCountry(customer?.country),
            status: document.getElementById('pur-status')?.value,
            delivery_status: document.getElementById('pur-delivery')?.value || 'Pending Delivery',
            proof: '', // set below via a real upload if a file was chosen (audit #12)
            package_id: packageId,
            payment_method: purMethod,
            epp_months: Number.isFinite(eppMonthsInt) ? eppMonthsInt : null,
            epp_bank: eppBankRaw || null,
            // Down payment collected on a Normal Installment Plan (weekly PORT).
            pop_down_payment: purMethod === 'POP' && Number.isFinite(popDownRaw) ? popDownRaw : null,
            is_agent_package: isAgentPkg,
            // Installment tenure (months) for POP — null for full-payment / NPO.
            installment_tenure: isInstMethod && tenureInt > 0 ? tenureInt : null,
            is_advance_package: isAdvancePkg,
            ring_size: ringSize || null,
        };

        // ── Atomic-ish create + LTV adjust: guard both so a failure surfaces an error,
        // keeps the modal open, and reverses the LTV bump if the purchase row was
        // created but the adjust failed (otherwise LTV is permanently wrong, audit #9). ──
        let created = false;
        let createdRow = null;
        try {
            createdRow = await AppDataStore.create('purchases', pur);
            // create() resolves with the saved row on success and throws on a
            // permanent server rejection. A falsy return means no row was written —
            // do NOT bump LTV or report success (audit #13), else the LTV RPC would
            // inflate lifetime_value with no purchase row behind it.
            if (!createdRow || createdRow.id == null) {
                throw new Error('Purchase was not saved (no row returned)');
            }
            created = true;
            // Update lifetime value + purchase count atomically (race-free; symmetric with
            // deletePurchase). Agent-package purchases are EXCLUDED from LTV so it stays
            // consistent with the sales-reporting RPCs (which exclude them) — otherwise
            // LTV-based VIP / agent-eligibility thresholds drift from the sales view.
            // (Business decision: LTV = sales-eligible spend. deletePurchase mirrors this.)
            if (!isAgentPkg) {
                await _adjustCustomerLtv(customerId, amt, 1);
            }
        } catch (e) {
            if (created && !isAgentPkg) {
                // create succeeded but LTV adjust failed — try to reverse so LTV stays consistent.
                try { await _adjustCustomerLtv(customerId, -amt, -1); } catch (_re) { /* best-effort */ }
            }
            UI.toast.error('Failed to save purchase: ' + (e?.message || e));
            return; // leave the modal open so the user can retry (no double-insert thanks to the guard)
        }

        // One delivery item for the per-item delivery board (best effort).
        const _readyVal = document.getElementById('pur-ready')?.value || '';
        await (window._crmUtils.createDeliveryItem || (async () => {}))({ ...pur, ...createdRow, customer_id: customerId }, _readyVal);

        // Upload the redemption image (if any) now that we have the purchase id, and
        // store its resolvable public URL — the old code stored a fake placeholder
        // string and silently dropped the bytes (audit #12).
        if (_proofFile && createdRow?.id != null) {
            try {
                if (window.supabase) {
                    const _pn = `proof_${createdRow.id}_${Date.now()}_${_proofFile.name}`;
                    const { error: _upErr } = await window.supabase.storage.from('attachments').upload(_pn, _proofFile);
                    if (!_upErr) {
                        // C2 (audit): store the storage PATH, not a public URL.
                        await AppDataStore.update('purchases', createdRow.id, { proof: _pn });
                    } else {
                        UI.toast.error('Purchase saved, but image upload failed: ' + (_upErr.message || _upErr));
                    }
                }
            } catch (_pe) {
                UI.toast.error('Purchase saved, but image upload failed: ' + (_pe?.message || _pe));
            }
        }

        UI.hideModal();
        UI.toast.success('Purchase added');
        const closingBody = document.getElementById(`cust-acc-body-closing-${customerId}`);
        if (closingBody) {
            // Re-fetch: the RPC updated the server row, so the cached `customer` (read
            // before the adjust) now has a stale lifetime_value/total_purchases.
            const _freshCustomer = await AppDataStore.getById('customers', customerId);
            await window.app.renderCustomerClosingTab(_freshCustomer || customer, closingBody);
        } else if (document.getElementById('customers-table-body')) await renderCustomersTable();
    } finally {
        _savePurchaseInFlight.delete(_key);
    }
};

const _deliveryStatusColors = { 'Pending Delivery': 'background:#fef3c7;color:#92400e', 'Dispatched': 'background:#dbeafe;color:#1e40af', 'Delivered': 'background:#dcfce7;color:#166534' };
const _deliveryStatusIcons = { 'Pending Delivery': 'fa-clock', 'Dispatched': 'fa-truck', 'Delivered': 'fa-check-circle' };

const _setDelivery = async (mode, id, customerId, newStatus) => {
    // Guard the underlying update: only toast success after the write resolves, else a
    // failed update would falsely report a change that never persisted.
    try {
        if (mode === 'purchase') {
            await AppDataStore.update('purchases', id, { delivery_status: newStatus });
        } else {
            // Atomic single-key merge via set_closing_record_field so a concurrent
            // remarks edit isn't clobbered by a whole-JSON read-modify-write. Fall back
            // to the RMW path if the RPC is unavailable (older DB).
            const _sb = AppDataStore._writeClient && AppDataStore._writeClient();
            let _merged = false;
            if (_sb) {
                try {
                    const { error } = await _sb.rpc('set_closing_record_field', { p_prospect_id: id, p_key: 'delivery_status', p_value: newStatus });
                    if (!error) { _merged = true; try { AppDataStore.invalidateCache && AppDataStore.invalidateCache('prospects'); } catch (_) {} }
                } catch (_) { /* fall back to RMW below */ }
            }
            if (!_merged) {
                const prospect = await AppDataStore.getById('prospects', id);
                const cr = { ...(prospect?.closing_record || {}), delivery_status: newStatus };
                await AppDataStore.update('prospects', id, { closing_record: cr });
            }
        }
    } catch (e) {
        UI.toast.error('Failed to update delivery: ' + (e?.message || e));
        return;
    }
    UI.toast.success('Delivery updated: ' + newStatus);
    const customer = await AppDataStore.getById('customers', customerId);
    const closingBody = document.getElementById(`cust-acc-body-closing-${customerId}`);
    if (closingBody) await window.app.renderCustomerClosingTab(customer, closingBody);
};

const updatePurchaseDelivery = async (purchaseId, customerId) => {
    const p = await AppDataStore.getById('purchases', purchaseId);
    const current = p?.delivery_status || 'Pending Delivery';
    const statuses = ['Pending Delivery', 'Dispatched', 'Delivered'];
    const content = `<div style="display:flex;flex-direction:column;gap:10px;padding:4px 0;">
        ${statuses.map(s => `<button class="btn ${s === current ? 'primary' : 'secondary'}" style="text-align:left;justify-content:flex-start;gap:10px;" onclick="(async()=>{await app._setDelivery('purchase',${purchaseId},${customerId},'${s}');UI.hideModal();})()"><i class="fas ${_deliveryStatusIcons[s]||'fa-circle'}" style="width:16px;"></i> ${s}${s===current?' ✓':''}</button>`).join('')}
    </div>`;
    UI.showModal('Update Delivery Status', content, [{ label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }]);
};

// Delete a row from the `purchases` table (PENDING rows show a trash button in
// renderCustomerClosingTab). Was wired to app.deletePurchase which did not exist.
const deletePurchase = async (purchaseId, customerId) => {
    if (!confirm('Delete this purchase record? This cannot be undone.')) return;
    try {
        const p = await AppDataStore.getById('purchases', purchaseId);
        await AppDataStore.delete('purchases', purchaseId);
        // Reverse this purchase's contribution to lifetime_value + total_purchases.
        // Symmetric with savePurchase, which adds EVERY purchase incl. PENDING: the old
        // `status !== 'PENDING'` skip meant a pending purchase was added to LTV on save
        // but never subtracted on delete, permanently inflating it (audit #8).
        if (p) {
            const amt = parseFloat(p.amount) || 0;
            // Mirror savePurchase: agent-package purchases never contributed to LTV, so
            // don't reverse them here (else deleting one would wrongly decrement LTV).
            if (amt && !p.is_agent_package) await _adjustCustomerLtv(customerId, -amt, -1);
        }
        UI.toast.success('Purchase deleted');
        const customer = await AppDataStore.getById('customers', customerId);
        const closingBody = document.getElementById(`cust-acc-body-closing-${customerId}`);
        if (customer && closingBody) await window.app.renderCustomerClosingTab(customer, closingBody);
    } catch (e) {
        UI.toast.error('Delete failed: ' + (e?.message || e));
    }
};

const updateConversionDelivery = async (prospectId, customerId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    const current = prospect?.closing_record?.delivery_status || 'Pending Delivery';
    const statuses = ['Pending Delivery', 'Dispatched', 'Delivered'];
    const content = `<div style="display:flex;flex-direction:column;gap:10px;padding:4px 0;">
        ${statuses.map(s => `<button class="btn ${s === current ? 'primary' : 'secondary'}" style="text-align:left;justify-content:flex-start;gap:10px;" onclick="(async()=>{await app._setDelivery('conversion',${prospectId},${customerId},'${s}');UI.hideModal();})()"><i class="fas ${_deliveryStatusIcons[s]||'fa-circle'}" style="width:16px;"></i> ${s}${s===current?' ✓':''}</button>`).join('')}
    </div>`;
    UI.showModal('Update Delivery Status', content, [{ label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }]);
};

// ── Product Delivery Listing (cross-customer delivery monitoring board) ───────
// One row per undelivered PRODUCT line, gathered from BOTH sources of truth:
//   • purchases rows — each row is already one product line, so a multi-product
//     invoice is naturally several rows sharing the same invoice number (each
//     tracked independently because items may arrive on different days);
//   • prospects.closing_record conversion sales — the very first sale isn't in
//     `purchases`, it lives on the originating prospect.
// Scope follows getVisibleCustomers() (own + team), so an agent sees only their
// own customers' deliveries. A line drops off once it's Delivered, unless the
// "Show delivered" toggle is on.
const _DELIVERY_STATUSES = ['Pending Delivery', 'Dispatched', 'Delivered'];
let _deliveryShowDelivered = false;
let _deliveryPayFilter = 'all'; // 'all' | 'full' | 'installment'

const openDeliveryListing = async () => {
    UI.showModal('Product Delivery Listing',
        `<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:12px;">
            <label class="checkbox-label" style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;">
                <input type="checkbox" id="delivery-show-delivered" ${_deliveryShowDelivered ? 'checked' : ''} onchange="app._toggleDeliveryDelivered(this.checked)"> Show delivered
            </label>
            <input type="text" id="delivery-search" class="form-control" placeholder="Search name / agent / product / invoice" style="flex:1;min-width:220px;" oninput="app.debounceCall('delivery-search', app._renderDeliveryListing, 220)">
        </div>
        <div id="delivery-listing-body"><div class="acc-loading" style="text-align:center;padding:24px;color:var(--gray-400);"><i class="fas fa-spinner fa-spin"></i> Loading deliveries…</div></div>`,
        [{ label: 'Close', type: 'secondary', action: 'UI.hideModal()' }],
        'fullscreen');
    await _renderDeliveryListing();
};

const _toggleDeliveryDelivered = async (checked) => {
    _deliveryShowDelivered = !!checked;
    await _renderDeliveryListing();
};

const _setDeliveryPayFilter = async (f) => {
    _deliveryPayFilter = f;
    await _renderDeliveryListing();
};

const _renderDeliveryListing = async () => {
    const body = document.getElementById('delivery-listing-body');
    if (!body) return; // modal closed mid-flight
    const search = (document.getElementById('delivery-search')?.value || '').trim().toLowerCase();

    // Visible customers — own + team scope already applied by getVisibleCustomers().
    const customers = await getVisibleCustomers();
    const custById = new Map(customers.map(c => [String(c.id), c]));
    const allUsers = await AppDataStore.getAll('users');
    const userById = new Map(allUsers.map(u => [String(u.id), u]));
    const agentNameFor = (c) => {
        const a = userById.get(String(c.responsible_agent_id || c.agent_id));
        return a ? (a.full_name || 'Agent') : '—';
    };

    const lines = [];

    // Source 1: purchases for visible customers (one row = one product line). Scope to
    // the visible customer ids server-side (was getAll over the whole purchases table +
    // client filter, re-run on every search keystroke).
    const _dlCustIds = [...custById.keys()];
    let purchases = [];
    if (_dlCustIds.length) {
        try { purchases = await AppDataStore.queryPaged('purchases', { filters: { customer_id: _dlCustIds } }); } catch (_) { purchases = []; }
    }
    for (const p of purchases) {
        const c = custById.get(String(p.customer_id));
        if (!c) continue; // out of scope / not a customer
        lines.push({
            kind: 'purchase', id: p.id, customerId: c.id,
            name: c.full_name || '', agent: agentNameFor(c),
            product: p.item || '-', invoice: p.invoice || '',
            status: p.delivery_status || 'Pending Delivery',
            remarks: p.delivery_remarks || '', proof: p.proof || '',
            date: p.date || '', method: p.payment_method || '',
            tenure: p.installment_tenure || null, advance: !!p.is_advance_package,
            ringSize: p.ring_size || '', payStatus: p.status || '',
        });
    }

    // Source 2: conversion sales (prospects.closing_record) for converted customers.
    const convCustomers = customers.filter(c => c.converted_from_prospect_id);
    if (convCustomers.length) {
        // Scope to just the source prospects we need (was getAll over the whole table).
        const _dlProspIds = [...new Set(convCustomers.map(c => c.converted_from_prospect_id).filter(Boolean))];
        let prospects = [];
        if (_dlProspIds.length) {
            try { prospects = await AppDataStore.queryPaged('prospects', { filters: { id: _dlProspIds } }); } catch (_) { prospects = []; }
        }
        const prospById = new Map(prospects.map(pr => [String(pr.id), pr]));
        for (const c of convCustomers) {
            const pr = prospById.get(String(c.converted_from_prospect_id));
            const cr = pr?.closing_record;
            if (!cr || !cr.product) continue;
            lines.push({
                kind: 'conversion', id: pr.id, customerId: c.id,
                name: c.full_name || '', agent: agentNameFor(c),
                product: cr.product || '-', invoice: cr.invoice_number || '',
                status: cr.delivery_status || 'Pending Delivery',
                remarks: cr.delivery_remarks || '', proof: cr.invoice_file || '',
                date: cr.order_date || cr.closing_date || c.customer_since || '', method: cr.payment_method || '',
                tenure: cr.installment_tenure || null, advance: !!cr.is_advance_package,
                ringSize: cr.ring_size || '', payStatus: cr.payment_status || 'PAID',
                crReady: _diReadyFromCr(cr),
            });
        }
    }

    // NPO maturity = its last installment due date. Only fetch the NPO ledger when
    // an NPO line lacks an inline tenure (NPO is keyed via its own order flow).
    let npoMatByCust = new Map();
    if (lines.some(l => String(l.method).toUpperCase() === 'NPO' && !l.tenure)) {
        try {
            const [sales, insts] = await Promise.all([
                AppDataStore.getAll('npo_sales').catch(() => []),
                AppDataStore.getAll('npo_installments').catch(() => []),
            ]);
            const saleCust = new Map((sales || []).map(s => [String(s.id), String(s.customer_id)]));
            for (const it of (insts || [])) {
                const cust = saleCust.get(String(it.sale_id));
                if (!cust || !it.due_date) continue;
                const cur = npoMatByCust.get(cust);
                if (!cur || it.due_date > cur) npoMatByCust.set(cust, it.due_date);
            }
        } catch (_) { /* npo tables absent / offline — leave empty */ }
    }

    // Per-item delivery: each line's items (or one virtual item until the order is
    // opened), its expected ready date and how many items are already handed over.
    const _diByLine = await _diLoadForLines(lines);
    for (const l of lines) {
        const its = _diByLine.get(_diKey(l.kind, l.id)) || [];
        l.diTotal = its.length || 1;
        l.diDone = its.length ? its.filter(r => r.status !== 'pending').length : (l.status === 'Delivered' ? 1 : 0);
        const pendDates = its.filter(r => r.status === 'pending' && r.expected_ready_date).map(r => r.expected_ready_date).sort();
        l.readyDate = its.length ? (pendDates[0] || its.map(r => r.expected_ready_date).filter(Boolean).sort().pop() || '') : (l.crReady || '');
    }

    // Derive payment type, maturity + production-readiness per line.
    for (const l of lines) {
        l.inst = _isInstallmentMethod(l.method);
        l.maturity = '';
        if (l.inst) {
            if (l.tenure && l.date) l.maturity = _addMonths(l.date, l.tenure);
            else if (String(l.method).toUpperCase() === 'NPO') l.maturity = npoMatByCust.get(String(l.customerId)) || '';
        }
        const fullyPaid = ['COMPLETED', 'COLLECTED', 'PAID'].includes(String(l.payStatus || '').toUpperCase());
        // Full payment (incl. EPP) → always ready. Installment → only when fully paid
        // OR flagged as a special "deliver in advance" package.
        l.ready = !l.inst || l.advance || fullyPaid;
        l.ptype = l.inst ? (l.advance ? 'Installment · advance' : 'Installment') : 'Full payment';
    }

    // Hide delivered unless toggled; apply payment-type tab; apply free-text search.
    let rows = lines.filter(l => _deliveryShowDelivered || l.status !== 'Delivered');
    if (_deliveryPayFilter === 'full') rows = rows.filter(l => !l.inst);
    else if (_deliveryPayFilter === 'installment') rows = rows.filter(l => l.inst);
    if (search) {
        rows = rows.filter(l =>
            l.name.toLowerCase().includes(search) ||
            l.agent.toLowerCase().includes(search) ||
            (l.product || '').toLowerCase().includes(search) ||
            (l.invoice || '').toLowerCase().includes(search));
    }
    // Sort: pending first, dispatched next, delivered last; then by name.
    const order = { 'Pending Delivery': 0, 'Dispatched': 1, 'Delivered': 2 };
    rows.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.name.localeCompare(b.name));

    // Payment-type filter tabs (counts reflect the delivered toggle but not the tab).
    const _afterDelivered = lines.filter(l => _deliveryShowDelivered || l.status !== 'Delivered');
    const cAll = _afterDelivered.length;
    const cFull = _afterDelivered.filter(l => !l.inst).length;
    const cInst = _afterDelivered.filter(l => l.inst).length;
    const tab = (key, label, n) => `<button class="btn btn-sm ${_deliveryPayFilter === key ? 'primary' : 'secondary'}" onclick="app._setDeliveryPayFilter('${key}')">${label} (${n})</button>`;
    const _advN = await _advOwedCount();
    const tabsHtml = `<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">${tab('all', 'All', cAll)}${tab('full', 'Full Payment', cFull)}${tab('installment', 'Installment', cInst)}<button class="btn btn-sm secondary" style="margin-left:auto;" onclick="app.openAgentAdvances('owed')">🤝 Agent advances${_advN ? ` (${_advN} owed)` : ''}</button><button class="btn btn-sm secondary" onclick="app.openCancellations('requested')">❌ Cancellations</button></div>`;

    if (!rows.length) {
        body.innerHTML = tabsHtml + `<div style="text-align:center;color:var(--gray-400);padding:32px;">${_deliveryShowDelivered ? 'No product lines found.' : 'No pending deliveries. 🎉'}</div>`;
        return;
    }

    let html = tabsHtml + `<div class="prospects-table-container"><table class="prospects-table"><thead><tr>
        <th scope="col">SN</th>
        <th scope="col">Name</th>
        <th scope="col">Agent</th>
        <th scope="col">Product</th>
        <th scope="col">Purchase Date</th>
        <th scope="col">Payment</th>
        <th scope="col">Maturity</th>
        <th scope="col">Expected Ready</th>
        <th scope="col">Production</th>
        <th scope="col">Delivery Status</th>
        <th scope="col">Remarks</th>
        <th scope="col">Invoice / Photo</th>
    </tr></thead><tbody>`;
    rows.forEach((l, i) => {
        // C2 (audit): proof/invoice_file are now stored as private storage PATHS —
        // open via a signed URL (window._openAttachment). _safeHref only accepted
        // http(s) URLs, so a path-stored proof showed "Upload" as if none existed.
        const statusStyle = _deliveryStatusColors[l.status] || '';
        const statusSel = `<select class="form-control" style="font-size:12px;padding:4px 6px;border-radius:6px;${statusStyle};" title="Update delivery status" onchange="app._setDeliveryFromListing('${l.kind}', ${l.id}, ${l.customerId}, this.value)">${_DELIVERY_STATUSES.map(s => `<option value="${s}" ${s === l.status ? 'selected' : ''}>${s}</option>`).join('')}</select>`;
        const proofCell = l.proof
            ? `<a href="#" onclick="event.preventDefault();window._openAttachment&&window._openAttachment('${UI.escJsAttr(String(l.proof))}')" class="btn-sm secondary" style="cursor:pointer;"><i class="fas fa-image"></i> View</a>`
            : (l.kind === 'purchase'
                ? `<button class="btn-sm secondary" onclick="app.uploadPaymentProof(${l.id}, ${l.customerId})"><i class="fas fa-upload"></i> Upload</button>`
                : '<span style="color:var(--gray-400);">—</span>');
        // Ring-size sub-line under the product, red when a Power Ring is missing it.
        const isPR = _isPowerRingName(l.product);
        const ringHtml = isPR
            ? (l.ringSize
                ? `<div style="font-size:11px;color:var(--gray-500);">Ring size: <strong>${escapeHtml(String(l.ringSize))}</strong></div>`
                : `<div style="font-size:11px;color:var(--error);font-weight:600;"><i class="fas fa-exclamation-triangle"></i> Ring size missing</div>`)
            : '';
        const payBadge = l.inst
            ? `<span class="score-badge" style="font-size:11px;background:#ede9fe;color:#5b21b6;">${escapeHtml(l.ptype)}</span>`
            : `<span class="score-badge" style="font-size:11px;background:#dcfce7;color:#166534;">Full payment</span>`;
        const prodBadge = l.ready
            ? `<span class="score-badge" style="font-size:11px;background:#dcfce7;color:#166534;"><i class="fas fa-check-circle"></i> Ready${l.inst && l.advance ? ' (advance)' : ''}</span>`
            : `<span class="score-badge" style="font-size:11px;background:#fef3c7;color:#92400e;"><i class="fas fa-hourglass-half"></i> Awaiting full payment</span>`;
        html += `<tr>
            <td>${i + 1}</td>
            <td><strong style="cursor:pointer;color:var(--primary);" onclick="UI.hideModal(); app.showCustomerDetail(${l.customerId})">${escapeHtml(l.name)}</strong>${l.invoice ? `<div style="font-size:11px;color:var(--gray-400);">${escapeHtml(l.invoice)}</div>` : ''}</td>
            <td>${escapeHtml(l.agent)}</td>
            <td>${escapeHtml(l.product)}${ringHtml}</td>
            <td style="white-space:nowrap;">${escapeHtml(l.date || '—')}</td>
            <td>${payBadge}</td>
            <td style="white-space:nowrap;">${l.inst ? escapeHtml(l.maturity || '—') : '<span style="color:var(--gray-400);">—</span>'}</td>
            <td>${_diReadyCell(l.readyDate, l.diDone >= l.diTotal)}</td>
            <td>${prodBadge}</td>
            <td>${statusSel}<button class="btn-sm secondary" style="margin-top:4px;white-space:nowrap;" title="Items, handover date and photo proof" onclick="event.stopPropagation(); app.openDeliveryItems('${l.kind}', ${l.id}, ${l.customerId})"><i class="fas fa-box"></i> Items ${l.diDone}/${l.diTotal}</button></td>
            <td><input type="text" class="form-control" style="font-size:12px;padding:4px 6px;min-width:140px;" value="${escapeHtml(l.remarks)}" placeholder="Add remark…" onchange="app.saveDeliveryRemarks('${l.kind}', ${l.id}, ${l.customerId}, this.value)"></td>
            <td>${proofCell}</td>
        </tr>`;
    });
    html += `</tbody></table></div><div style="margin-top:10px;font-size:12px;color:var(--gray-500);">${rows.length} line${rows.length !== 1 ? 's' : ''} shown</div>`;
    body.innerHTML = html;
    // Mobile renders .prospects-table as stacked cards keyed off td[data-label];
    // the labeler normally runs on navigateTo, not on modal renders. No-op on desktop.
    (window.app.applyMobileTableLabels || (() => {}))();
};

// Inline status change from the listing — reuses the shared _setDelivery writer
// (mode 'purchase' keys the purchases row; anything else keys the prospect's
// closing_record), then re-renders so a Delivered line drops off the board.
const _setDeliveryFromListing = async (kind, id, customerId, newStatus) => {
    await _setDelivery(kind === 'purchase' ? 'purchase' : 'conversion', id, customerId, newStatus);
    await _renderDeliveryListing();
};

const saveDeliveryRemarks = async (kind, id, customerId, value) => {
    const v = (value || '').trim();
    try {
        if (kind === 'purchase') {
            await AppDataStore.update('purchases', id, { delivery_remarks: v });
        } else {
            // Atomic single-key merge (set_closing_record_field) so a concurrent
            // status edit isn't clobbered by a whole-JSON read-modify-write. RMW fallback.
            const _sb = AppDataStore._writeClient && AppDataStore._writeClient();
            let _merged = false;
            if (_sb) {
                try {
                    const { error } = await _sb.rpc('set_closing_record_field', { p_prospect_id: id, p_key: 'delivery_remarks', p_value: v });
                    if (!error) { _merged = true; try { AppDataStore.invalidateCache && AppDataStore.invalidateCache('prospects'); } catch (_) {} }
                } catch (_) { /* fall back to RMW below */ }
            }
            if (!_merged) {
                const prospect = await AppDataStore.getById('prospects', id);
                const cr = { ...(prospect?.closing_record || {}), delivery_remarks: v };
                await AppDataStore.update('prospects', id, { closing_record: cr });
            }
        }
        UI.toast.success('Remark saved');
    } catch (e) {
        UI.toast.error('Failed to save remark: ' + (e?.message || e));
    }
};


// ── Per-item delivery / pick-up (owner 2026-10-19) ───────────────────────────
// One order can hold several custom-made items handed over on different days (or
// together). Each item lives in public.delivery_items with its expected ready date
// (the closing form's Collection Date), status pending → delivered | picked_up,
// handover date and photo proof. A handover REQUIRES a date + at least one photo
// (the table's check constraint enforces it too). Read/written straight through
// supabase — no AppDataStore cache, so the board always shows the latest handover.
const _DI_STATUS_LABEL = { pending: 'Pending', delivered: 'Delivered', picked_up: 'Picked up' };
const _DI_MAX_PHOTOS = 10;
const _diSb = () => window.supabase || window.supabaseClient || null;
const _diIsDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
// The Collection Date counts as a ready date only when it is AFTER the order date —
// many records repeat the order date there.
const _diReadyFromCr = (cr) => (cr && _diIsDay(cr.closing_date) && (!_diIsDay(cr.order_date) || cr.closing_date > cr.order_date)) ? cr.closing_date : '';
const _diKey = (kind, id) => `${kind === 'purchase' ? 'p' : 'c'}:${id}`;
let _diCtx = null; // { kind, id, customerId, title }

// All items for the board's lines, keyed by line (scoped queries, 200 ids a call).
const _diLoadForLines = async (lines) => {
    const out = new Map();
    const sb = _diSb();
    if (!sb) return out;
    const pIds = lines.filter(l => l.kind === 'purchase').map(l => l.id);
    const cIds = lines.filter(l => l.kind !== 'purchase').map(l => l.id);
    const pull = async (col, ids, kind) => {
        for (let i = 0; i < ids.length; i += 200) {
            const { data, error } = await sb.from('delivery_items').select('*').in(col, ids.slice(i, i + 200)).order('id');
            if (error) throw error;
            for (const r of data || []) {
                const k = _diKey(kind, r[col]);
                if (!out.has(k)) out.set(k, []);
                out.get(k).push(r);
            }
        }
    };
    try {
        if (pIds.length) await pull('purchase_id', pIds, 'purchase');
        if (cIds.length) await pull('prospect_id', cIds, 'conversion');
    } catch (e) { console.warn('[delivery] items load failed:', e); }
    return out;
};

const _diReadyCell = (ready, allDone) => {
    if (!ready) return '<span style="color:var(--gray-400);">—</span>';
    const today = _custLocalDay();
    const days = Math.round((new Date(ready + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
    let style = '', note = '';
    if (!allDone && days < 0) { style = 'color:var(--error,#dc2626);font-weight:600;'; note = ` <span style="font-size:11px;">(${-days}d late)</span>`; }
    else if (!allDone && days <= 30) { style = 'color:#b45309;font-weight:600;'; note = ` <span style="font-size:11px;">(in ${days}d)</span>`; }
    return `<span style="white-space:nowrap;${style}">${escapeHtml(ready)}${note}</span>`;
};

// The order behind a board line: item text, ring size, ready date, title, status.
const _diOrderInfo = async (kind, id, customerId) => {
    const customer = await AppDataStore.getById('customers', customerId).catch(() => null);
    const name = customer?.full_name || '';
    if (kind === 'purchase') {
        const p = await AppDataStore.getById('purchases', id);
        let ready = '';
        // Ready date = the matching closing record's Collection Date (by invoice).
        try {
            if (customer?.converted_from_prospect_id && String(p?.invoice || '').trim() && AppDataStore.getByIdFull) {
                const pr = await AppDataStore.getByIdFull('prospects', customer.converted_from_prospect_id).catch(() => null);
                const crs = [...(Array.isArray(pr?.closing_records_history) ? pr.closing_records_history : []), pr?.closing_record].filter(c => c && typeof c === 'object');
                const inv = String(p.invoice).trim().toLowerCase();
                ready = _diReadyFromCr(crs.find(c => String(c.invoice_number || '').trim().toLowerCase() === inv));
            }
        } catch (_) { /* no ready date */ }
        return { item: p?.item || 'Item', ringSize: p?.ring_size || '', ready, invoice: p?.invoice || '', name, status: p?.delivery_status || 'Pending Delivery', agentId: p?.agent_id || customer?.responsible_agent_id || null };
    }
    const pr = await AppDataStore.getById('prospects', id);
    const cr = pr?.closing_record || {};
    return { item: cr.product || 'Item', ringSize: cr.ring_size || '', ready: _diReadyFromCr(cr), invoice: cr.invoice_number || '', name, status: cr.delivery_status || 'Pending Delivery', agentId: customer?.responsible_agent_id || pr?.responsible_agent_id || null };
};

const _diFetchItems = async (kind, id) => {
    const col = kind === 'purchase' ? 'purchase_id' : 'prospect_id';
    const { data, error } = await _diSb().from('delivery_items').select('*').eq(col, id).order('id');
    if (error) throw error;
    return data || [];
};

const _diOpenInFlight = new Set();
const openDeliveryItems = async (kind, id, customerId, opts = {}) => {
    const sb = _diSb();
    if (!sb) return UI.toast.error('Offline — cannot open delivery items right now');
    const key = _diKey(kind, id);
    if (_diOpenInFlight.has(key)) return;
    _diOpenInFlight.add(key);
    try {
        const info = await _diOrderInfo(kind, id, customerId);
        let items = await _diFetchItems(kind, id);
        if (!items.length) {
            // First time this order is opened: it becomes one item (split it below
            // if the order holds several products).
            const row = { customer_id: Number(customerId), item_name: String(info.item || 'Item').slice(0, 300), ring_size: info.ringSize || null,
                expected_ready_date: info.ready || null, created_by: _state.cu?.id || null };
            row[kind === 'purchase' ? 'purchase_id' : 'prospect_id'] = Number(id);
            const { error } = await sb.from('delivery_items').insert(row);
            if (error) throw error;
            items = await _diFetchItems(kind, id);
        }
        _diCtx = { kind, id, customerId, title: `${info.name}${info.invoice ? ' · ' + info.invoice : ''}`, saleAgentId: info.agentId || null,
            from: opts && opts.from === 'profile' ? 'profile' : 'list' };
        await _diLoadAdv(items);
        UI.showModal('Delivery items', _diRenderItems(items), [
            _diCtx.from === 'profile'
                ? { label: 'Close', type: 'secondary', action: 'app.diClose()' }
                : { label: '← Back to list', type: 'secondary', action: 'app.openDeliveryListing()' },
        ], 'fullscreen');
        (window.app.applyMobileTableLabels || (() => {}))();
    } catch (e) {
        UI.toast.error('Could not open delivery items: ' + (e?.message || e));
    } finally {
        _diOpenInFlight.delete(key);
    }
};

const _diRenderItems = (items) => {
    const today = _custLocalDay();
    const pending = items.filter(r => r.status === 'pending');
    const done = items.length - pending.length;
    const canSplit = items.length === 1 && pending.length === 1 && /\+/.test(items[0].item_name);
    const rows = items.map(r => {
        const isPending = r.status === 'pending';
        const photos = Array.isArray(r.photos) ? r.photos : [];
        const photoLinks = photos.map((p, i) => `<a href="#" onclick="event.preventDefault();window._openAttachment&&window._openAttachment('${UI.escJsAttr(String(p))}')" style="margin-right:6px;white-space:nowrap;"><i class="fas fa-image"></i> ${i + 1}</a>`).join('');
        const statusBadge = isPending
            ? '<span class="score-badge" style="font-size:11px;background:#fef3c7;color:#92400e;">Pending</span>'
            : `<span class="score-badge" style="font-size:11px;background:#dcfce7;color:#166534;"><i class="fas fa-check-circle"></i> ${_DI_STATUS_LABEL[r.status] || escapeHtml(r.status)}</span>`;
        const dis = isPending ? '' : 'disabled';
        const action = isPending
            ? (items.length > 1 ? `<button class="btn-sm secondary" title="Remove this item" onclick="event.stopPropagation(); app.diDeleteItem(${r.id})"><i class="fas fa-trash"></i></button>` : '')
            : `<button class="btn-sm secondary" title="Undo handover" onclick="event.stopPropagation(); app.diUndoHandover(${r.id})"><i class="fas fa-undo"></i> Undo</button>${_diAdvAction(r)}`;
        return `<tr>
            <td data-label="Pick">${isPending ? `<input type="checkbox" class="di-pick" value="${r.id}" aria-label="Select item for handover">` : ''}</td>
            <td data-label="Item"><input type="text" class="form-control" style="font-size:12px;min-width:160px;" value="${escapeHtml(r.item_name)}" ${dis} onchange="app.diSaveField(${r.id}, 'item_name', this.value)"></td>
            <td data-label="Qty"><input type="number" min="1" class="form-control" style="font-size:12px;width:64px;" value="${r.qty || 1}" ${dis} onchange="app.diSaveField(${r.id}, 'qty', this.value)"></td>
            <td data-label="Ring size"><input type="text" class="form-control" style="font-size:12px;width:80px;" value="${escapeHtml(r.ring_size || '')}" ${dis} onchange="app.diSaveField(${r.id}, 'ring_size', this.value)"></td>
            <td data-label="Expected ready"><input type="date" class="form-control" style="font-size:12px;" value="${escapeHtml(r.expected_ready_date || '')}" ${dis} onchange="app.diSaveField(${r.id}, 'expected_ready_date', this.value)"></td>
            <td data-label="Status">${statusBadge}${_diAdvLine(r)}</td>
            <td data-label="Handover date" style="white-space:nowrap;">${escapeHtml(r.handover_date || '—')}</td>
            <td data-label="Photos">${photoLinks || '<span style="color:var(--gray-400);">—</span>'}</td>
            <td data-label="Remarks"><input type="text" class="form-control" style="font-size:12px;min-width:120px;" value="${escapeHtml(r.remarks || '')}" placeholder="Remark…" onchange="app.diSaveField(${r.id}, 'remarks', this.value)"></td>
            <td data-label="">${action}</td>
        </tr>`;
    }).join('');
    const handover = pending.length ? `
        <div style="border:1px solid var(--border,#e5e0d8);border-radius:8px;padding:12px;">
            <div style="font-weight:600;margin-bottom:8px;"><i class="fas fa-box-open"></i> Hand over the ticked item(s)</div>
            <div class="form-row">
                <div class="form-group half"><label>Handover date <span class="required">*</span></label><input type="date" id="di-date" class="form-control" value="${today}" max="${today}"></div>
                <div class="form-group half"><label>How</label>
                    <select id="di-how" class="form-control"><option value="delivered">Delivered to customer</option><option value="picked_up">Customer picked up</option></select></div>
            </div>
            ${_diSourceHtml(pending)}
            <div class="form-group"><label>Photo proof <span class="required">*</span> <span style="font-weight:400;color:var(--gray-500);font-size:12px;">(at least 1, max ${_DI_MAX_PHOTOS})</span></label>
                <input type="file" id="di-photos" class="form-control" accept="image/*" multiple></div>
            <div class="form-group"><label>Remark</label><input type="text" id="di-remark" class="form-control" placeholder="e.g. received by wife"></div>
            <div id="di-status" style="font-size:12px;color:var(--primary);margin-bottom:6px;"></div>
            <button class="btn primary" onclick="(async () => { await app.diHandover(); })()"><i class="fas fa-check"></i> Confirm handover</button>
        </div>` : '<div style="color:#166534;font-weight:600;"><i class="fas fa-check-circle"></i> Every item in this order has been handed over.</div>';
    return `<div id="di-panel">
        <div style="margin-bottom:10px;"><strong>${escapeHtml(_diCtx?.title || '')}</strong>
            <span style="margin-left:8px;font-size:12px;color:var(--gray-500);">${done}/${items.length} handed over</span></div>
        <div class="prospects-table-container"><table class="prospects-table"><thead><tr>
            <th scope="col"></th><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Ring size</th>
            <th scope="col">Expected ready</th><th scope="col">Status</th><th scope="col">Handover date</th>
            <th scope="col">Photos</th><th scope="col">Remarks</th><th scope="col"></th>
        </tr></thead><tbody>${rows}</tbody></table></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 16px;">
            <button class="btn btn-sm secondary" onclick="app.diAddItem()"><i class="fas fa-plus"></i> Add item</button>
            ${canSplit ? `<button class="btn btn-sm secondary" onclick="app.diSplitItem(${items[0].id})"><i class="fas fa-cut"></i> Split into separate items</button>` : ''}
        </div>
        ${handover}
    </div>`;
};

const _diRefresh = async () => {
    if (!_diCtx) return [];
    const items = await _diFetchItems(_diCtx.kind, _diCtx.id);
    await _diLoadAdv(items);
    const panel = document.getElementById('di-panel');
    if (panel) panel.outerHTML = _diRenderItems(items);
    (window.app.applyMobileTableLabels || (() => {}))();
    return items;
};

// Keep the order's own delivery status in step with its items: all handed over →
// Delivered; an undo / new item on a Delivered order → back to Pending Delivery.
const _diSyncOrderStatus = async (items) => {
    if (!_diCtx || !items || !items.length) return;
    const { kind, id, customerId } = _diCtx;
    const allDone = items.every(r => r.status !== 'pending');
    const info = await _diOrderInfo(kind, id, customerId);
    const mode = kind === 'purchase' ? 'purchase' : 'conversion';
    if (allDone && info.status !== 'Delivered') await _setDelivery(mode, id, customerId, 'Delivered');
    else if (!allDone && info.status === 'Delivered') await _setDelivery(mode, id, customerId, 'Pending Delivery');
};

const diSaveField = async (itemId, field, value) => {
    const allowed = ['item_name', 'qty', 'ring_size', 'expected_ready_date', 'remarks'];
    if (!allowed.includes(field)) return;
    let v = typeof value === 'string' ? value.trim() : value;
    if (field === 'item_name' && !v) return UI.toast.error('Item name cannot be empty');
    if (field === 'qty') { v = parseInt(v, 10); if (!(v > 0)) return UI.toast.error('Qty must be 1 or more'); }
    if (field === 'expected_ready_date') { if (v && !_diIsDay(v)) return UI.toast.error('Invalid date'); v = v || null; }
    if ((field === 'ring_size' || field === 'remarks') && !v) v = null;
    const { error } = await _diSb().from('delivery_items').update({ [field]: v }).eq('id', itemId);
    if (error) return UI.toast.error('Not saved: ' + error.message);
    UI.toast.success('Saved');
};

const diAddItem = async () => {
    if (!_diCtx) return;
    const { kind, id, customerId } = _diCtx;
    const items = await _diFetchItems(kind, id);
    const row = { customer_id: Number(customerId), item_name: 'New item', expected_ready_date: items[0]?.expected_ready_date || null, created_by: _state.cu?.id || null };
    row[kind === 'purchase' ? 'purchase_id' : 'prospect_id'] = Number(id);
    const { error } = await _diSb().from('delivery_items').insert(row);
    if (error) return UI.toast.error('Could not add item: ' + error.message);
    await _diSyncOrderStatus(await _diRefresh());
};

// "圣智+ PR 6" → two items, both keeping the same ready date.
const diSplitItem = async (itemId) => {
    if (!_diCtx) return;
    const sb = _diSb();
    const items = await _diFetchItems(_diCtx.kind, _diCtx.id);
    const src = items.find(r => String(r.id) === String(itemId));
    if (!src || src.status !== 'pending') return;
    const parts = src.item_name.split(/\s*\+\s*/).map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) return;
    const { error: e1 } = await sb.from('delivery_items').update({ item_name: parts[0] }).eq('id', src.id);
    if (e1) return UI.toast.error('Split failed: ' + e1.message);
    const extra = parts.slice(1).map(name => ({ customer_id: src.customer_id, purchase_id: src.purchase_id, prospect_id: src.prospect_id,
        item_name: name, expected_ready_date: src.expected_ready_date, created_by: _state.cu?.id || null }));
    const { error: e2 } = await sb.from('delivery_items').insert(extra);
    if (e2) return UI.toast.error('Split failed: ' + e2.message);
    UI.toast.success(`Split into ${parts.length} items`);
    await _diRefresh();
};

const diDeleteItem = async (itemId) => {
    if (!_diCtx) return;
    if (!confirm('Remove this item from the order?')) return;
    const { error } = await _diSb().from('delivery_items').delete().eq('id', itemId).eq('status', 'pending');
    if (error) return UI.toast.error('Could not remove: ' + error.message);
    await _diSyncOrderStatus(await _diRefresh());
};

// Opened from a profile's DC Closing Record: close and show the new status there.
const diClose = () => {
    const fromProfile = _diCtx && _diCtx.from === 'profile';
    UI.hideModal();
    if (fromProfile && typeof window.app.pvRefreshClosing === 'function') window.app.pvRefreshClosing();
};

const diUndoHandover = async (itemId) => {
    if (!_diCtx) return;
    if (!confirm('Undo this handover? The photos stay on the item.')) return;
    const { error } = await _diSb().from('delivery_items').update({ status: 'pending', handover_date: null, handed_over_by: null }).eq('id', itemId);
    if (error) return UI.toast.error('Could not undo: ' + error.message);
    await _diSyncOrderStatus(await _diRefresh());
};

let _diHandoverBusy = false;
const diHandover = async () => {
    if (!_diCtx || _diHandoverBusy) return;
    const sb = _diSb();
    const ids = Array.from(document.querySelectorAll('.di-pick:checked')).map(cb => Number(cb.value));
    const date = document.getElementById('di-date')?.value || '';
    const how = document.getElementById('di-how')?.value === 'picked_up' ? 'picked_up' : 'delivered';
    const remark = (document.getElementById('di-remark')?.value || '').trim();
    const files = Array.from(document.getElementById('di-photos')?.files || []).filter(f => f.type && f.type.startsWith('image/'));
    if (!ids.length) return UI.toast.error('Tick the item(s) being handed over');
    const fromAgent = document.getElementById('di-source')?.value === 'agent';
    const lenderId = fromAgent ? document.getElementById('di-lender')?.value : null;
    if (fromAgent && !lenderId) return UI.toast.error("Pick whose stock it was");
    if (fromAgent && ids.some(x => !(_diCtx.eligible && _diCtx.eligible.has(String(x))))) {
        return UI.toast.error("Only calligraphy, artistic masterpieces and 财库 / 财托 can come from an agent's stock — untick the others");
    }
    if (!_diIsDay(date)) return UI.toast.error('Handover date is required');
    if (date > _custLocalDay()) return UI.toast.error('Handover date cannot be in the future');
    if (!files.length) return UI.toast.error('Add at least one photo as proof of handover');
    if (files.length > _DI_MAX_PHOTOS) return UI.toast.error(`Max ${_DI_MAX_PHOTOS} photos per handover`);
    _diHandoverBusy = true;
    const status = document.getElementById('di-status');
    const uploaded = [];
    let saved = 0;
    try {
        // Phone photos are often over the bucket's 5 MB limit — compress first.
        if (!window.app.compressImageFile && typeof window._loadChunk === 'function') {
            try { await window._loadChunk('chunks/script-prospects.min.js'); } catch (_) { /* raw file fallback */ }
        }
        const compress = window.app.compressImageFile || (f => Promise.resolve(f));
        for (let i = 0; i < files.length; i++) {
            if (status) status.textContent = `Uploading photo ${i + 1}/${files.length}…`;
            const c = await compress(files[i]);
            const safe = String(c.name || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
            const path = `delivery/${_diCtx.customerId}/${date}/${Date.now()}_${i}_${safe}`;
            const { error } = await sb.storage.from('attachments').upload(path, c, { upsert: false, contentType: c.type || 'image/jpeg' });
            if (error) throw error;
            uploaded.push(path);
        }
        if (status) status.textContent = 'Saving…';
        const items = await _diFetchItems(_diCtx.kind, _diCtx.id);
        for (const itemId of ids) {
            const cur = items.find(r => r.id === itemId);
            if (!cur || cur.status !== 'pending') continue;
            const patch = {
                status: how, handover_date: date, handed_over_by: _state.cu?.id || null,
                photos: [...(Array.isArray(cur.photos) ? cur.photos : []), ...uploaded],
            };
            if (remark) patch.remarks = cur.remarks ? `${cur.remarks} · ${remark}` : remark;
            const { error } = await sb.from('delivery_items').update(patch).eq('id', itemId).eq('status', 'pending');
            if (error) throw error;
            saved++;
        }
        let lent = 0;
        if (fromAgent && saved) {
            try { lent = await _diCreateAdvances(ids, lenderId, date); }
            catch (e) { UI.toast.error('Handed over, but the agent-stock record was not saved: ' + (e?.message || e) + " — use 🤝 Agent's stock on the item"); }
        }
        UI.toast.success(`${saved} item(s) marked ${_DI_STATUS_LABEL[how].toLowerCase()}${lent ? ` · 🤝 ${lent} from agent's stock (owed back)` : ''}`);
        await _diSyncOrderStatus(await _diRefresh());
    } catch (e) {
        // Nothing saved → don't leave orphan photos in storage. (A partly-saved
        // handover keeps them: the saved items point at those photos.)
        if (uploaded.length && saved === 0) { try { await sb.storage.from('attachments').remove(uploaded); } catch (_) { /* best-effort */ } }
        if (status) status.textContent = '';
        UI.toast.error((saved ? `Only ${saved} item(s) saved: ` : 'Handover not saved: ') + (e?.message || e));
        if (saved) await _diRefresh();
    } finally {
        _diHandoverBusy = false;
    }
};

// ── 🤝 Agent stock advances (owner 2026-10-21) ───────────────────────────────
// Calligraphy / Artistic Masterpieces / 财库·财托 only: an agent may hand the
// customer a piece from THEIR OWN stock before the office piece arrives. The
// customer handover is recorded as usual; public.delivery_advances keeps the
// IOU (same piece back, item for item) until the LENDER ticks "returned to me".
// The DB refuses rings / Feng Shui and a lend before the handover.
const _advFmt = (d) => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const _advUsers = async () => {
    const all = await AppDataStore.getAll('users').catch(() => []) || [];
    return all.filter(u => { const l = _getUserLevel(u); return l >= 3 && l <= 12 && !/inactive|deleted|resign|terminat/i.test(String(u.status || '')); })
        .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
};
const _advUserName = (users, id) => { const u = users.find(x => String(x.id) === String(id)); return u ? (u.full_name || u.username || 'Agent') : 'Agent'; };

// Eligible items + their advances, for the Items screen
const _diLoadAdv = async (items) => {
    if (!_diCtx) return;
    const sb = _diSb();
    const ids = items.map(r => r.id);
    _diCtx.eligible = new Set();
    _diCtx.adv = new Map();
    if (!ids.length || !sb) return;
    try {
        const [el, ad] = await Promise.all([
            sb.rpc('delivery_advance_eligible', { p_item_ids: ids }),
            sb.from('delivery_advances').select('*').in('delivery_item_id', ids),
        ]);
        ((el && el.data) || []).forEach(x => _diCtx.eligible.add(String(typeof x === 'object' ? x.delivery_advance_eligible : x)));
        ((ad && ad.data) || []).forEach(a => _diCtx.adv.set(String(a.delivery_item_id), a));
    } catch (_) { /* no advance options */ }
    if (!_diCtx.users) _diCtx.users = await _advUsers();
};

const _diAdvLine = (r) => {
    const a = _diCtx && _diCtx.adv && _diCtx.adv.get(String(r.id));
    if (!a) return '';
    const who = escapeHtml(_advUserName(_diCtx.users || [], a.lender_agent_id));
    if (a.status === 'returned') return `<div style="font-size:11px;color:#166534;margin-top:3px;">🤝 From ${who}'s stock · ✅ returned ${escapeHtml(_advFmt(a.returned_date))}</div>`;
    const late = a.expected_back && a.expected_back < _custLocalDay();
    return `<div style="font-size:11px;margin-top:3px;color:${late ? 'var(--error,#dc2626)' : '#92400e'};">🤝 From ${who}'s stock · owed back ~${escapeHtml(_advFmt(a.expected_back))}${late ? ' (late)' : ''}
        <a href="javascript:void(0)" title="Remove (recorded by mistake)" onclick="event.stopPropagation();app.diAdvanceRemove(${Number(r.id)})" style="margin-left:4px;color:var(--gray-500);">✕</a></div>`;
};

const _diAdvAction = (r) => {
    if (r.status === 'pending' || !_diCtx || !_diCtx.eligible || !_diCtx.eligible.has(String(r.id)) || _diCtx.adv.has(String(r.id))) return '';
    return `<button class="btn-sm secondary" title="This piece came from an agent's own stock" onclick="event.stopPropagation(); app.diMarkAdvance(${r.id})">🤝 Agent's stock</button>`;
};

const _diSourceHtml = (pending) => {
    if (!_diCtx || !_diCtx.eligible || !pending.some(r => _diCtx.eligible.has(String(r.id)))) return '';
    const users = _diCtx.users || [];
    const def = String(_diCtx.saleAgentId || _state.cu?.id || '');
    return `
        <div class="form-row">
            <div class="form-group half"><label>Given from</label>
                <select id="di-source" class="form-control" onchange="document.getElementById('di-lender-wrap').style.display=this.value==='agent'?'':'none'">
                    <option value="office">🏢 Office stock</option>
                    <option value="agent">🤝 Agent's own stock (office piece goes back to the agent)</option>
                </select></div>
            <div class="form-group half" id="di-lender-wrap" style="display:none;"><label>Whose stock?</label>
                <select id="di-lender" class="form-control">${users.map(u => `<option value="${u.id}" ${String(u.id) === def ? 'selected' : ''}>${escapeHtml(u.full_name || u.username || '')}</option>`).join('')}</select></div>
        </div>
        <div style="font-size:11px;color:var(--gray-500);margin:-4px 0 8px;">Agent's stock is only for calligraphy, artistic masterpieces and 财库 / 财托.</div>`;
};

const _diCreateAdvances = async (itemIds, lenderId, givenDate) => {
    const sb = _diSb();
    let n = 0;
    for (const itemId of itemIds) {
        const { error } = await sb.from('delivery_advances').insert({ delivery_item_id: Number(itemId), lender_agent_id: Number(lenderId), given_date: givenDate, created_by: _state.cu?.id || null });
        if (error) throw error;
        n++;
    }
    return n;
};

// An item already handed over → "it came from an agent's stock" (also for
// advances that happened before this feature existed)
const diMarkAdvance = async (itemId) => {
    if (!_diCtx) return;
    const items = await _diFetchItems(_diCtx.kind, _diCtx.id);
    const r = items.find(x => String(x.id) === String(itemId));
    if (!r) return;
    const users = _diCtx.users || await _advUsers();
    const def = String(_diCtx.saleAgentId || _state.cu?.id || '');
    const back = { kind: _diCtx.kind, id: _diCtx.id, customerId: _diCtx.customerId };
    UI.showModal('🤝 From an agent\'s own stock', `
        <p style="font-size:13px;margin:0 0 10px;"><strong>${escapeHtml(r.item_name)}</strong> was handed over on ${escapeHtml(_advFmt(r.handover_date))}. Record whose own stock it came from — the office piece goes back to them when it arrives.</p>
        <div class="form-group"><label>Whose stock?</label>
            <select id="adv-lender" class="form-control">${users.map(u => `<option value="${u.id}" ${String(u.id) === def ? 'selected' : ''}>${escapeHtml(u.full_name || u.username || '')}</option>`).join('')}</select></div>
        <div class="form-group"><label>Date given</label><input type="date" id="adv-date" class="form-control" value="${escapeHtml(r.handover_date || _custLocalDay())}" max="${_custLocalDay()}"></div>`,
        [{ label: 'Cancel', type: 'secondary', action: `app.openDeliveryItems('${back.kind}', ${Number(back.id)}, ${Number(back.customerId)})` },
         { label: 'Save', type: 'primary', action: `(async () => { await app.diSaveAdvance(${Number(itemId)}, '${back.kind}', ${Number(back.id)}, ${Number(back.customerId)}); })()` }]);
};
const diSaveAdvance = async (itemId, kind, id, customerId) => {
    const lender = document.getElementById('adv-lender')?.value;
    const date = document.getElementById('adv-date')?.value;
    if (!lender) return UI.toast.error('Pick whose stock it was');
    if (!_diIsDay(date)) return UI.toast.error('Date given is required');
    try {
        await _diCreateAdvances([itemId], lender, date);
        UI.toast.success('Recorded — the office piece now goes back to the agent');
    } catch (e) {
        return UI.toast.error('Not saved: ' + (e?.message || e));
    }
    await openDeliveryItems(kind, id, customerId);
};
const diAdvanceRemove = async (itemId) => {
    if (!confirm('Remove this agent-stock record? (Only if it was recorded by mistake.)')) return;
    const { error } = await _diSb().from('delivery_advances').delete().eq('delivery_item_id', itemId).eq('status', 'owed');
    if (error) return UI.toast.error('Could not remove: ' + error.message);
    UI.toast.success('Removed');
    await _diRefresh();
};

// ── 🤝 Agent advances board ──
let _advTab = 'owed';
const _advOwedCount = async () => {
    try {
        const { count } = await _diSb().from('delivery_advances').select('id', { count: 'exact', head: true }).eq('status', 'owed');
        return count || 0;
    } catch (_) { return 0; }
};
const openAgentAdvances = async (tab) => {
    if (tab) _advTab = tab;
    const sb = _diSb();
    if (!sb) return UI.toast.error('Offline — try again in a moment');
    let rows = [];
    try {
        const { data, error } = await sb.from('delivery_advances').select('*,customers(full_name)').order('expected_back', { ascending: true }).limit(1000);
        if (error) throw error;
        rows = data || [];
    } catch (e) {
        return UI.toast.error('Could not load advances: ' + (e?.message || e));
    }
    const users = await AppDataStore.getAll('users').catch(() => []) || [];
    const today = _custLocalDay();
    const me = String(_state.cu?.id || '');
    const isAdmin = _getUserLevel(_state.cu) <= 2;
    const owed = rows.filter(a => a.status === 'owed');
    const due = owed.filter(a => a.expected_back && a.expected_back <= today);
    const shown = _advTab === 'returned' ? rows.filter(a => a.status === 'returned').reverse()
        : _advTab === 'due' ? due : owed;
    const tabBtn = (t, label, n) => `<button class="btn btn-sm ${_advTab === t ? 'primary' : 'secondary'}" onclick="app.openAgentAdvances('${t}')">${label} (${n})</button>`;
    const list = shown.length ? `<div class="prospects-table-container"><table class="prospects-table"><thead><tr>
            <th scope="col">Agent (lender)</th><th scope="col">Item</th><th scope="col">Customer</th><th scope="col">Given</th>
            <th scope="col">Office piece due</th><th scope="col">Status</th><th scope="col"></th></tr></thead><tbody>${shown.map(a => {
        const late = a.status === 'owed' && a.expected_back && a.expected_back < today;
        const days = late ? Math.round((new Date(today + 'T00:00:00') - new Date(a.expected_back + 'T00:00:00')) / 864e5) : 0;
        const canTick = a.status === 'owed' && (isAdmin || String(a.lender_agent_id) === me);
        const st = a.status === 'returned'
            ? `<span class="score-badge" style="font-size:11px;background:#dcfce7;color:#166534;">✅ Returned ${escapeHtml(_advFmt(a.returned_date))}</span>`
            : (a.expected_back && a.expected_back <= today
                ? `<span class="score-badge" style="font-size:11px;background:#fee2e2;color:#b91c1c;">🔴 Due back${days ? ` · ${days}d late` : ''}</span>`
                : '<span class="score-badge" style="font-size:11px;background:#fef3c7;color:#92400e;">🟠 Owed</span>');
        return `<tr>
            <td data-label="Agent"><strong>${escapeHtml(_advUserName(users, a.lender_agent_id))}</strong>${a.sale_agent_id && String(a.sale_agent_id) !== String(a.lender_agent_id) ? `<div style="font-size:11px;color:var(--gray-500);">sale: ${escapeHtml(_advUserName(users, a.sale_agent_id))}</div>` : ''}</td>
            <td data-label="Item">${escapeHtml(a.item_name || '')}</td>
            <td data-label="Customer"><a href="javascript:void(0)" onclick="UI.hideModal(); app.showCustomerDetail(${Number(a.customer_id)})">${escapeHtml((a.customers && a.customers.full_name) || '—')}</a></td>
            <td data-label="Given" style="white-space:nowrap;">${escapeHtml(_advFmt(a.given_date))}</td>
            <td data-label="Office piece due" style="white-space:nowrap;${late ? 'color:var(--error,#dc2626);font-weight:600;' : ''}">${escapeHtml(_advFmt(a.expected_back))}</td>
            <td data-label="Status">${st}</td>
            <td data-label="">${canTick ? `<button class="btn-sm primary" onclick="app.advReturn(${Number(a.id)})">↩ Returned to me</button>` : ''}</td>
        </tr>`;
    }).join('')}</tbody></table></div>`
        : `<div style="text-align:center;color:var(--gray-400);padding:28px;">${_advTab === 'returned' ? 'Nothing returned yet.' : 'No stock owed to agents. 🎉'}</div>`;
    UI.showModal('🤝 Agent stock advances', `
        <div style="font-size:13px;margin-bottom:8px;"><strong>${owed.length}</strong> piece${owed.length === 1 ? '' : 's'} owed back to agents${due.length ? ` · <span style="color:#b91c1c;font-weight:600;">${due.length} due now</span>` : ''}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">${tabBtn('owed', 'Owed', owed.length)}${tabBtn('due', 'Due back', due.length)}${tabBtn('returned', 'Returned', rows.length - owed.length)}</div>
        ${list}
        <div style="margin-top:10px;font-size:12px;color:var(--gray-500);">The agent ticks <strong>↩ Returned to me</strong> when the office piece is back in their hands. To record an advance that happened earlier: open the order's <strong>Items</strong> and tap <strong>🤝 Agent's stock</strong> on the handed-over piece.</div>`,
        [{ label: '← Back to list', type: 'secondary', action: 'app.openDeliveryListing()' }], 'fullscreen');
    (window.app.applyMobileTableLabels || (() => {}))();
};

const advReturn = (advId) => {
    UI.showModal('↩ Office piece returned to me', `
        <div class="form-group"><label>Date returned</label><input type="date" id="adv-ret-date" class="form-control" value="${_custLocalDay()}" max="${_custLocalDay()}"></div>
        <div class="form-group"><label>Photo <span style="font-weight:400;color:var(--gray-500);font-size:12px;">(optional)</span></label><input type="file" id="adv-ret-photos" class="form-control" accept="image/*" multiple></div>
        <div class="form-group"><label>Note</label><input type="text" id="adv-ret-note" class="form-control" placeholder="e.g. collected at office"></div>
        <div id="adv-ret-status" style="font-size:12px;color:var(--primary);"></div>`,
        [{ label: 'Cancel', type: 'secondary', action: 'app.openAgentAdvances()' },
         { label: 'Confirm returned', type: 'primary', action: `(async () => { await app.advSaveReturn(${Number(advId)}); })()` }]);
};
const advSaveReturn = async (advId) => {
    const sb = _diSb();
    const date = document.getElementById('adv-ret-date')?.value;
    const note = (document.getElementById('adv-ret-note')?.value || '').trim();
    const files = Array.from(document.getElementById('adv-ret-photos')?.files || []).filter(f => f.type && f.type.startsWith('image/')).slice(0, _DI_MAX_PHOTOS);
    if (!_diIsDay(date)) return UI.toast.error('Date returned is required');
    const status = document.getElementById('adv-ret-status');
    const uploaded = [];
    try {
        if (files.length && !window.app.compressImageFile && typeof window._loadChunk === 'function') {
            try { await window._loadChunk('chunks/script-prospects.min.js'); } catch (_) { /* raw file fallback */ }
        }
        const compress = window.app.compressImageFile || (f => Promise.resolve(f));
        for (let i = 0; i < files.length; i++) {
            if (status) status.textContent = `Uploading photo ${i + 1}/${files.length}…`;
            const c = await compress(files[i]);
            const path = `delivery/advances/${advId}/${Date.now()}_${i}_${String(c.name || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
            const { error } = await sb.storage.from('attachments').upload(path, c, { upsert: false, contentType: c.type || 'image/jpeg' });
            if (error) throw error;
            uploaded.push(path);
        }
        const patch = { status: 'returned', returned_date: date, returned_by: _state.cu?.id || null };
        if (uploaded.length) patch.return_photos = uploaded;
        if (note) patch.note = note;
        const { data, error } = await sb.from('delivery_advances').update(patch).eq('id', advId).eq('status', 'owed').select('id');
        if (error) throw error;
        if (!data || !data.length) throw new Error('Only the agent who lent the piece (or admin) can mark it returned');
        UI.toast.success('Marked returned ✓');
    } catch (e) {
        if (uploaded.length) { try { await sb.storage.from('attachments').remove(uploaded); } catch (_) { /* best-effort */ } }
        if (status) status.textContent = '';
        return UI.toast.error('Not saved: ' + (e?.message || e));
    }
    await openAgentAdvances();
};


    app.register('customers', {
        openDeliveryItems,
        diClose,
        diMarkAdvance,
        diSaveAdvance,
        diAdvanceRemove,
        openAgentAdvances,
        advReturn,
        advSaveReturn,
        diSaveField,
        diAddItem,
        diSplitItem,
        diDeleteItem,
        diUndoHandover,
        diHandover,
        _setDelivery,
        _setDeliveryFromListing,
        _setDeliveryPayFilter,
        _renderDeliveryListing,
        _toggleDeliveryDelivered,
        _onPurchaseProductChange,
        _onPurchaseMethodChange,
        _syncRingSizeField,
        copyToClipboard,
        customerPageNav,
        deletePurchase,
        editReferral,
        filterCustomers,
        npoLaunchFromPurchase,
        openAddCustomerModal,
        openAddPurchaseModal,
        openDeliveryListing,
        saveDeliveryRemarks,
        openCustomerReferralModal,
        openCustomerEditModal,
        saveCustomerProfile,
        openEditPlatformIdsModal,
        openImprovementModal,
        saveCustomerImprovement,
        deleteCustomerImprovement,
        openImprovementStoryMode,
        closeImprovementStoryMode,
        renderImprovementsTab,
        openUploadDocumentModal,
        openUploadRedemptionImageModal,
        renderAgentEligibility,
        renderBasicBankTab,
        renderCustomerActivityTab,
        renderCustomerTags,
        renderCustomersTable,
        renderEventHistory,
        renderPlatformIdsTab,
        renderPurchaseHistoryTab,
        renderReferralsTab,
        saveCustomer,
        saveCustomerReferral,
        saveDocument,
        saveEditReferral,
        savePaymentProof,
        savePlatformIds,
        savePurchase,
        saveRedemptionImage,
        searchReferralProspect,
        selectReferralProspect,
        showCustomerDetail,
        showCustomersView,
        switchCustomerProfileTab,
        switchCustomerTab,
        switchProfileTab,
        updateConversionDelivery,
        updatePurchaseDelivery,
        uploadPaymentProof,
        viewReferralDetail,
        zoomCpsPhoto,
    });
})();
