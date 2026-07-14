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
    const renderHealthBadge            = (...a) => (window.app.renderHealthBadge            || (() => ''))(...a);
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

    // ── Duplicated from prospects-core: shared server-pagination helper.    // Reads only header globals (getVisibleUserIds/_state.cu/AppDataStore),    // so a verbatim copy is safe and keeps _bffGetCustomers an intra-chunk call.
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

            ${(_getUserLevel(_state.cu) <= 4) ? `
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
                <td data-label="Name"><strong>${escapeHtml(c.full_name || '')}</strong></td>
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
    _state.pvd = _fromView;
    _state.cdv = { type: 'customer', id: customerId };

    setTimeout(async () => {
        await addWhatsAppButtonToProfile('customer', customerId);
    }, 100);

    const health = await calculateCustomerHealthScore(customer);

    const iconBtn = (title, icon, onclick, opts = {}) => {
        const bg = opts.bg || '#fff';
        const color = opts.color || 'var(--gray-500)';
        const border = opts.border || '1px solid var(--gray-300)';
        return `<button title="${title}" onclick="event.stopPropagation();${onclick}" style="width:24px;height:24px;border-radius:50%;border:${border};background:${bg};color:${color};cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'"><i class="${icon}"></i></button>`;
    };

    const container = document.getElementById('content-viewport');
    container.innerHTML = `
        <div class="pv-wrap">
            <style>
                .pv-wrap{background:#fff;border-radius:12px;box-shadow:var(--shadow-md);overflow:hidden;padding-bottom:80px;}
                .pv-back{padding:14px 16px 0;}
                .pv-hdr{padding:12px 16px 16px;border-bottom:1px solid var(--gray-200);}
                .pv-hdr h1{font-size:22px;font-weight:700;margin:6px 0 8px;line-height:1.2;}
                .pv-hdr-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px;color:var(--gray-500);}
                .acc-container{display:flex;flex-direction:column;gap:8px;padding:12px;}
                .acc-item{border:1px solid var(--gray-200);border-radius:12px;overflow:hidden;}
                .acc-hdr{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;cursor:pointer;background:var(--gray-50);font-weight:600;font-size:15px;user-select:none;-webkit-tap-highlight-color:transparent;gap:8px;}
                .acc-hdr:active{opacity:.85;}
                .acc-item.open>.acc-hdr{background:var(--primary);color:#fff;}
                .acc-item.open>.acc-hdr .acc-chev{color:#fff;transform:rotate(180deg);}
                .acc-chev{transition:transform .25s;color:var(--gray-500);flex-shrink:0;}
                .acc-body{padding:16px 14px;background:#fff;}
                .acc-loading{text-align:center;padding:24px;color:var(--gray-400);font-size:14px;}
                .pv-row{display:flex;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--gray-100);font-size:14px;gap:8px;}
                .pv-row:last-child{border-bottom:none;}
                .pv-lbl{color:var(--gray-500);font-weight:500;min-width:110px;flex-shrink:0;}
                .pv-val{flex:1;color:var(--gray-800);word-break:break-word;}
                .pv-sub{font-size:12px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 6px;padding-top:12px;border-top:1px solid var(--gray-100);}
                .pv-sub:first-child{margin-top:0;padding-top:0;border-top:none;}
            </style>
            <div class="pv-back">
                <button class="btn secondary btn-sm" onclick="app.goBackFromDetail()">
                    <i class="fas fa-arrow-left"></i> Back to List
                </button>
            </div>
            <div class="pv-hdr" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
                <div style="flex:1;min-width:0;">
                    <div class="pv-hdr-meta">
                        <span>ID: C${customer.id}</span>
                        <span class="badge success">Customer</span>
                        ${renderHealthBadge(health)}
                        <span style="font-size:11px;color:var(--gray-400);"><i class="fas fa-lock"></i> Permanent</span>
                    </div>
                    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin:6px 0 4px;min-width:0;">
                        <span style="font-size:22px;font-weight:700;line-height:1.3;word-break:break-word;">${escapeHtml(customer.full_name)}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0 0 4px;">
                        ${(isSystemAdmin(_state.cu) || isMarketingManager(_state.cu)) && customer.converted_from_prospect_id != null ? iconBtn('Edit', 'fas fa-edit', `app.openProspectModal(${customer.converted_from_prospect_id})`) : ''}
                        ${iconBtn('Add Purchase', 'fas fa-plus', `app.openAddPurchaseModal(${customer.id})`)}
                        ${iconBtn('Refer a Friend', 'fas fa-user-plus', `app.openCustomerReferralModal(${customer.id})`)}
                        ${iconBtn('WhatsApp', 'fab fa-whatsapp', `app.openSendWhatsAppModal('customer',${customer.id})`, {color:'#25d366'})}
                        ${iconBtn('Portal Link', 'fas fa-external-link-alt', `app.sendPortalLink(${customer.id})`)}
                        ${iconBtn('Recruit as Agent', 'fas fa-user-tie', `app.openRecruitModal(${customer.id})`, {bg:'#6b21a8',color:'#fff',border:'none'})}
                    </div>
                    <div style="font-size:12px;color:var(--gray-500);margin-top:2px;">
                        Customer since ${customer.customer_since || '-'}${customer.conversion_amount != null ? ` · Converted at ${UI.money(customer.conversion_amount, customer.country)}` : ''}
                    </div>
                </div>
            </div>

            <div class="acc-container" id="cust-acc-container-${customer.id}">

                <!-- 1 Basic Information — open by default -->
                <div class="acc-item open" id="cust-acc-info-${customer.id}">
                    <div class="acc-hdr" onclick="app.toggleCustomerAccordion('info',${customer.id},this.parentElement)">
                        <span><i class="fas fa-info-circle"></i> Basic Information</span>
                        <i class="fas fa-chevron-down acc-chev"></i>
                    </div>
                    <div class="acc-body" id="cust-acc-body-info-${customer.id}">
                        <div class="acc-loading"><i class="fas fa-spinner fa-spin"></i> Loading…</div>
                    </div>
                </div>

                <!-- 2 Bank & Payment -->
                <div class="acc-item" id="cust-acc-bank-${customer.id}">
                    <div class="acc-hdr" onclick="app.toggleCustomerAccordion('bank',${customer.id},this.parentElement)">
                        <span><i class="fas fa-university"></i> Bank &amp; Payment</span>
                        <i class="fas fa-chevron-down acc-chev"></i>
                    </div>
                    <div class="acc-body" id="cust-acc-body-bank-${customer.id}" style="display:none" data-loaded="false"></div>
                </div>

                <!-- 3 Platform IDs -->
                <div class="acc-item" id="cust-acc-platforms-${customer.id}">
                    <div class="acc-hdr" onclick="app.toggleCustomerAccordion('platforms',${customer.id},this.parentElement)">
                        <span><i class="fas fa-id-badge"></i> Platform IDs</span>
                        <i class="fas fa-chevron-down acc-chev"></i>
                    </div>
                    <div class="acc-body" id="cust-acc-body-platforms-${customer.id}" style="display:none" data-loaded="false"></div>
                </div>

                <!-- 5 Referrals Made -->
                <div class="acc-item" id="cust-acc-referrals-${customer.id}">
                    <div class="acc-hdr" onclick="app.toggleCustomerAccordion('referrals',${customer.id},this.parentElement)">
                        <span><i class="fas fa-user-plus"></i> Referrals Made</span>
                        <i class="fas fa-chevron-down acc-chev"></i>
                    </div>
                    <div class="acc-body" id="cust-acc-body-referrals-${customer.id}" style="display:none" data-loaded="false"></div>
                </div>

                <!-- 6 Activity History -->
                <div class="acc-item" id="cust-acc-activity-${customer.id}">
                    <div class="acc-hdr" onclick="app.toggleCustomerAccordion('activity',${customer.id},this.parentElement)">
                        <span><i class="fas fa-history"></i> Activity History</span>
                        <i class="fas fa-chevron-down acc-chev"></i>
                    </div>
                    <div class="acc-body" id="cust-acc-body-activity-${customer.id}" style="display:none" data-loaded="false"></div>
                </div>

                <!-- 7 Events Attended -->
                <div class="acc-item" id="cust-acc-events-${customer.id}">
                    <div class="acc-hdr" onclick="app.toggleCustomerAccordion('events',${customer.id},this.parentElement)">
                        <span><i class="fas fa-calendar-check"></i> Events Attended</span>
                        <i class="fas fa-chevron-down acc-chev"></i>
                    </div>
                    <div class="acc-body" id="cust-acc-body-events-${customer.id}" style="display:none" data-loaded="false"></div>
                </div>

                <!-- 8 Agent Eligibility -->
                <div class="acc-item" id="cust-acc-eligibility-${customer.id}">
                    <div class="acc-hdr" onclick="app.toggleCustomerAccordion('eligibility',${customer.id},this.parentElement)">
                        <span><i class="fas fa-user-tie"></i> Agent Eligibility</span>
                        <i class="fas fa-chevron-down acc-chev"></i>
                    </div>
                    <div class="acc-body" id="cust-acc-body-eligibility-${customer.id}" style="display:none" data-loaded="false"></div>
                </div>

                <!-- 9 Contracts -->
                <div class="acc-item" id="cust-acc-contracts-${customer.id}">
                    <div class="acc-hdr" onclick="app.toggleCustomerAccordion('contracts',${customer.id},this.parentElement)">
                        <span><i class="fas fa-file-contract"></i> Contracts</span>
                        <i class="fas fa-chevron-down acc-chev"></i>
                    </div>
                    <div class="acc-body" id="cust-acc-body-contracts-${customer.id}" style="display:none" data-loaded="false"></div>
                </div>

                <!-- DC Closing Record -->
                <div class="acc-item" id="cust-acc-closing-${customer.id}">
                    <div class="acc-hdr" onclick="app.toggleCustomerAccordion('closing',${customer.id},this.parentElement)">
                        <span><i class="fas fa-handshake"></i> DC Closing Record</span>
                        <i class="fas fa-chevron-down acc-chev"></i>
                    </div>
                    <div class="acc-body" id="cust-acc-body-closing-${customer.id}" style="display:none" data-loaded="false"></div>
                </div>

                <!-- 10 Notes -->
                <div class="acc-item" id="cust-acc-notes-${customer.id}">
                    <div class="acc-hdr" onclick="app.toggleCustomerAccordion('notes',${customer.id},this.parentElement)">
                        <span><i class="fas fa-sticky-note"></i> Notes</span>
                        <i class="fas fa-chevron-down acc-chev"></i>
                    </div>
                    <div class="acc-body" id="cust-acc-body-notes-${customer.id}" style="display:none" data-loaded="false"></div>
                </div>

                <!-- 11 Tags -->
                <div class="acc-item" id="cust-acc-tags-${customer.id}">
                    <div class="acc-hdr" onclick="app.toggleCustomerAccordion('tags',${customer.id},this.parentElement)">
                        <span><i class="fas fa-tags"></i> Tags</span>
                        <i class="fas fa-chevron-down acc-chev"></i>
                    </div>
                    <div class="acc-body" id="cust-acc-body-tags-${customer.id}" style="display:none" data-loaded="false"></div>
                </div>

                <!-- 12 Journey Tracker -->
                <div class="acc-item" id="cust-acc-journey-${customer.id}">
                    <div class="acc-hdr" onclick="app.toggleCustomerAccordion('journey',${customer.id},this.parentElement)">
                        <span><i class="fas fa-route" style="color:#7c3aed;"></i> Journey Tracker <span id="cust-jny-badge-${customer.id}" style="display:none;background:#dc2626;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px;margin-left:6px;vertical-align:middle;"></span></span>
                        <i class="fas fa-chevron-down acc-chev"></i>
                    </div>
                    <div class="acc-body" id="cust-acc-body-journey-${customer.id}" style="display:none" data-loaded="false"></div>
                </div>

            </div>
        </div>
    `;
    // Pre-load the Info accordion body (open by default)
    await switchCustomerProfileTab('info', customerId, document.getElementById(`cust-acc-body-info-${customerId}`));
    // Async: populate journey overdue badge
    AppDataStore.getJourneyTouchpoints('customer', customer.id).then(tps => {
        const overdue = tps.filter(t => t.status === 'overdue').length;
        const badge = document.getElementById(`cust-jny-badge-${customer.id}`);
        if (badge && overdue > 0) {
            badge.textContent = `${overdue} overdue`;
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
    else if (tabName === 'contracts') await (window.app.renderCustomerContractsTab || (() => {}))(customer);
    else if (tabName === 'events') {
        const [allRegs, allEvents] = await Promise.all([
            AppDataStore.getAll('event_registrations'),
            AppDataStore.getAll('events'),
        ]);
        const VALID_REG_STATUSES_C = new Set(['Registered', 'Attended', 'No Show']);
        const registrations = (allRegs || []).filter(
            r => r.attendee_type === 'customer'
                && r.attendee_id == customerId
                && VALID_REG_STATUSES_C.has(r.attendance_status)
        );
        const eventsById = new Map((allEvents || []).map(e => [String(e.id), e]));
        let html = '<h4>Events Attended</h4>';
        if (registrations.length === 0) {
            html += '<p>No events attended.</p>';
        } else {
            html += '<table class="events-table"><thead><tr><th scope="col">Event</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col">Points</th></tr></thead><tbody>';
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
    const customer = await AppDataStore.getById('customers', customerId);
    if (!container || !customer) return;

    if (tab === 'info') {
        container.innerHTML = `
            <div class="pv-sub">Contact</div>
            <div class="pv-row"><span class="pv-lbl">Full Name</span><span class="pv-val"><strong>${escapeHtml(customer.full_name)}</strong></span></div>
            <div class="pv-row"><span class="pv-lbl">Phone</span><span class="pv-val">${escapeHtml(customer.phone || '-')} ${customer.phone ? '<button class="btn-icon" style="margin-left:4px;"><i class="fas fa-phone"></i></button>' : ''}</span></div>
            <div class="pv-row"><span class="pv-lbl">Email</span><span class="pv-val">${escapeHtml(customer.email || '-')} ${customer.email ? '<button class="btn-icon" style="margin-left:4px;"><i class="fas fa-envelope"></i></button>' : ''}</span></div>
            <div class="pv-sub">Identity</div>
            <div class="pv-row"><span class="pv-lbl">IC Number</span><span class="pv-val">${escapeHtml(customer.ic_number || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Date of Birth</span><span class="pv-val">${escapeHtml(customer.date_of_birth || '-')}${customer.date_of_birth ? ` (Age ${Math.floor((Date.now() - new Date(customer.date_of_birth).getTime()) / 31557600000)})` : ''}</span></div>
            <div class="pv-row"><span class="pv-lbl">Ming Gua</span><span class="pv-val"><span style="color:#6b21a8;font-weight:600;">${escapeHtml(customer.ming_gua || '-')}${customer.element ? ' (' + escapeHtml(customer.element) + ')' : ''}</span></span></div>
            <div class="pv-row"><span class="pv-lbl">Gender</span><span class="pv-val">${escapeHtml(customer.gender || '-')}</span></div>
            <div class="pv-sub">Employment</div>
            <div class="pv-row"><span class="pv-lbl">Occupation</span><span class="pv-val">${escapeHtml(customer.occupation || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Company</span><span class="pv-val">${escapeHtml(customer.company_name || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Income</span><span class="pv-val">${escapeHtml(customer.income_range || '-')}</span></div>
            <div class="pv-sub">Address</div>
            <div class="pv-row"><span class="pv-lbl">Address</span><span class="pv-val">${escapeHtml([customer.address, customer.city, customer.state, customer.postal_code].filter(Boolean).join(', ') || '-')}</span></div>
            <div class="pv-sub">Referral Information</div>
            <div class="pv-row"><span class="pv-lbl">Referred By</span><span class="pv-val">${escapeHtml(customer.referred_by || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Relationship</span><span class="pv-val">${escapeHtml(customer.referral_relationship || '-')}</span></div>
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
    else if (tab === 'events') {
        const [allRegs, allEvents] = await Promise.all([
            AppDataStore.getAll('event_registrations'),
            AppDataStore.getAll('events'),
        ]);
        const VALID_REG_STATUSES_C2 = new Set(['Registered', 'Attended', 'No Show']);
        const registrations = (allRegs || []).filter(
            r => r.attendee_type === 'customer'
                && r.attendee_id == customerId
                && VALID_REG_STATUSES_C2.has(r.attendance_status)
        );
        const eventsById = new Map((allEvents || []).map(e => [String(e.id), e]));
        if (registrations.length === 0) {
            container.innerHTML = '<p style="text-align:center;padding:20px;color:var(--gray-400);">No events attended yet.</p>';
        } else {
            let totalPts = 0;
            let rows = '';
            for (const r of registrations) {
                const event = eventsById.get(String(r.event_id));
                const pts = r.points_awarded || 0;
                totalPts += pts;
                rows += `<div class="pv-row"><span class="pv-lbl">${escapeHtml(r.event_date || '-')}</span><span class="pv-val" style="display:flex;justify-content:space-between;">${escapeHtml(event?.title || 'Unknown')} <span style="color:var(--success);font-weight:600;flex-shrink:0;">+${pts} pts</span></span></div>`;
            }
            container.innerHTML = `
                ${rows}
                <div style="display:flex;justify-content:space-between;font-weight:700;margin-top:12px;padding-top:12px;border-top:1px solid var(--gray-200);">
                    <span>Total Events: ${registrations.length}</span>
                    <span style="color:var(--primary);">${totalPts} Points</span>
                </div>
            `;
        }
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
                ${_isAgentCust ? '' : `<button class="btn primary" style="width:100%;background:#6b21a8;border:none;" onclick="app.openRecruitModal(${customer.id})">Offer Agent Package</button>`}
            </div>
        `;
    }
    else if (tab === 'contracts') {
        await (window.app.renderCustomerContractsTab || (() => {}))(customer, container.id);
    }
    else if (tab === 'closing') {
        await window.app.renderCustomerClosingTab(customer, container);
    }
    else if (tab === 'notes') {
        const customerNotes = await AppDataStore.query('notes', { customer_id: customer.id });
        container.innerHTML = `
            <div class="add-note-section">
                <textarea id="customer-note-text" class="form-control" rows="3" placeholder="Add a new note..."></textarea>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
                    <button class="btn-icon" onclick="app.openVoiceRecorder('customer-note-text', 'customer', ${customer.id})" title="Record voice note" style="color:var(--primary);"><i class="fas fa-microphone"></i></button>
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
    else if (tab === 'journey') {
        await window._loadChunk('chunks/script-journey.min.js');
        await (window.app.renderJourneyTab || (() => {}))('customer', customer.id, container);
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
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
                    <button class="btn-icon" onclick="app.openVoiceRecorder('customer-note-text', 'customer', ${customer.id})" title="Record voice note" style="color:var(--primary);"><i class="fas fa-microphone"></i></button>
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
                <td>${escapeHtml(cr.closing_date || customer.customer_since || '-')}</td>
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

            ${_isAgentCust ? '' : `<button class="btn primary" style="width:100%; background:#6b21a8; border:none;" onclick="app.openRecruitModal(${customer.id})">Offer Agent Package</button>`}
        </div>
    `;
};

const renderCustomerActivityTab = async (customer, containerId = 'profile-tab-content') => {
    const container = document.getElementById(containerId);
    // Combine activities linked to this customer OR original prospect
    // Indexed dual-query: idx_activities_customer_date + idx_activities_prospect_date.
    // Previously scanned the full activities table; now bounded to the
    // customer's own rows plus (if converted) the pre-conversion prospect rows.
    const [custActs, prospActs] = await Promise.all([
        AppDataStore.getActivitiesForCustomer(customer.id, { limit: 500 }),
        customer.converted_from_prospect_id
            ? AppDataStore.getActivitiesForProspect(customer.converted_from_prospect_id, { limit: 500 })
            : Promise.resolve([]),
    ]);
    const seenIds = new Set();
    const activities = [...custActs, ...prospActs]
        .filter(a => { if (seenIds.has(a.id)) return false; seenIds.add(a.id); return true; })
        .sort((a, b) => new Date(b.activity_date || b.created_at) - new Date(a.activity_date || a.created_at));

    container.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <h4 style="font-size:16px; font-weight:600; color:var(--primary); margin:0;">Activity History</h4>
            <button class="btn primary btn-sm" onclick="app.openActivityModal(null, 'customer', ${customer.id})">+ Log Activity</button>
        </div>
        ${activities.length > 0 ? `
            <div class="activity-timeline">
                ${activities.map(a => {
        const _atype = a.activity_type || a.type;
        const icon = _atype === 'FTF' ? 'users' : (_atype === 'CALL' ? 'phone' : (_atype === 'EVENT' ? 'calendar-alt' : 'sticky-note'));
        const date = a.activity_date || a.date || (a.created_at ? a.created_at.split('T')[0] : 'N/A');
        return `
                        <div class="timeline-item" style="display:flex; gap:16px; margin-bottom:20px; position:relative;">
                            <div class="timeline-icon" style="flex-shrink:0; width:32px; height:32px; border-radius:50%; background:var(--gray-100); display:flex; align-items:center; justify-content:center; color:var(--primary); font-size:14px; z-index:1;">
                                <i class="fas fa-${icon}"></i>
                            </div>
                            <div class="timeline-content" style="flex:1; background:var(--gray-50); padding:12px; border-radius:8px; border:1px solid var(--gray-200);">
                                <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                                    <strong style="font-size:14px;">${escapeHtml(a.activity_title || _atype)}</strong>
                                    <span style="font-size:12px; color:var(--gray-500);">${escapeHtml(date)}</span>
                                </div>
                                <div style="font-size:13px; color:var(--gray-700);">${a.notes ? escapeHtml(a.notes) : 'No details provided.'}</div>
                                ${a.outcome ? `<div style="font-size:12px; margin-top:8px;"><span class="score-badge" style="background:var(--success-bg); color:var(--success); border:none;">${escapeHtml(a.outcome)}</span></div>` : ''}
                            </div>
                        </div>
                    `;
    }).join('')}
            </div>
        ` : '<p style="color:var(--gray-400); font-size:13px;">No activity history found.</p>'}
    `;
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
        customer_since: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })(),
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
const _TENURE_METHODS = ['POP', 'PCP', 'PON'];
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
    const epp = document.getElementById('epp-fields');
    if (epp) epp.style.display = val === 'EPP' ? 'block' : 'none';
    const inst = document.getElementById('installment-fields');
    if (inst) inst.style.display = _TENURE_METHODS.includes(val) ? 'block' : 'none';
    if (val === 'NPO') window.app.npoLaunchFromPurchase(customerId);
};

const openAddPurchaseModal = async (customerId) => {
    const customer = await AppDataStore.getById('customers', customerId);
    // getById can return null (RLS deny / offline / deleted id) — guard before deref.
    if (!customer) { UI.toast.error('Customer not found'); return; }
    // This customer's market drives the currency label + per-country price prefill.
    const _cur = UI.currencyForCountry(customer.country);
    const _sym = UI.countryByCode(customer.country).symbol;
    const _products = await AppDataStore.getAll('products').catch(() => []);
    const _prodOptions = (_products && _products.length)
        ? _products.map(p => {
            const price = _productPriceFor(p, customer.country);
            return `<option value="${escapeHtml(p.name)}" data-price="${price != null ? price : ''}">${escapeHtml(p.name)}${price != null ? ` (${UI.formatCurrency(price, { currency: _cur })})` : ''}</option>`;
          }).join('')
        : ['PR4 Power Ring', 'PR3 Ring', 'Office Audit', 'Harmony Painting'].map(n => `<option value="${n}">${n}</option>`).join('');
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
                            <option value="Cash">Cash</option>
                            <option value="Credit Card">Credit Card</option>
                            <option value="Bank Transfer">Bank Transfer</option>
                            <option value="EPP">EPP (Easy Payment Plan)</option>
                            <option value="POP">POP (Installment)</option>
                            <option value="PCP">PCP (Installment)</option>
                            <option value="PON">PON (Installment)</option>
                            <option value="NPO">NPO (Installment Package)</option>
                        </select>
                    </div>
                </div>
                <div id="epp-fields" style="display:none; margin-bottom:16px;">
                    <div class="form-row">
                        <div class="form-group half"><label>Months</label><select id="epp-months" class="form-control"><option>6</option><option>12</option><option>18</option><option>24</option><option>36</option></select></div>
                        <div class="form-group half"><label>Bank</label><input type="text" id="epp-bank" class="form-control" placeholder="Bank name"></div>
                    </div>
                </div>
                <div id="installment-fields" style="display:none; margin-bottom:16px;">
                    <div class="form-row">
                        <div class="form-group half"><label>Tenure (months) <span class="required">*</span></label><input type="number" id="pur-tenure" class="form-control" min="1" placeholder="e.g. 12"></div>
                        <div class="form-group half" style="display:flex; align-items:flex-end;">
                            <label class="checkbox-label" style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="pur-advance"> Deliver in advance (special package)</label>
                        </div>
                    </div>
                    <div style="font-size:12px; color:var(--gray-500);">Installment items queue for production only after full payment, unless "deliver in advance" is set. Maturity = purchase date + tenure.</div>
                </div>
                <div class="form-row">
                    <div class="form-group half"><label>Invoice No. <span class="required">*</span></label><input type="text" id="pur-inv" class="form-control" placeholder="Enter invoice number"></div>
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
        const eppMonthsRaw = purMethod === 'EPP' ? document.getElementById('epp-months')?.value : '';
        const eppMonthsInt = parseInt(eppMonthsRaw, 10);
        const eppBankRaw = purMethod === 'EPP' ? document.getElementById('epp-bank')?.value?.trim() : '';
        // Persist the explicit "Is Agent Package?" selection (is_agent_package is a real
        // boolean column on purchases — reporting RPCs exclude these from sales totals).
        const isAgentPkg = !!document.getElementById('is-agent-pkg')?.checked;
        // ── Company-financed installment (POP/PCP/PON): tenure (months) drives the
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
        // Fetch customer for the post-save re-render fallback. NOTE: purchases are
        // agent-attributed via the customers.responsible_agent_id join in the reporting
        // RPCs (no agent column on the purchase row) — do NOT add one (prior bug).
        const customer = await AppDataStore.getById('customers', customerId);
        const pur = {
            customer_id: customerId,
            // Local calendar day (MYT is UTC+8): a UTC date would stamp early-morning
            // sales with YESTERDAY, mis-bucketing them in monthly/quarterly reports
            // and the delivery-board maturity math (audit #5/#11).
            date: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })(),
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
            is_agent_package: isAgentPkg,
            // Installment tenure (months) for POP/PCP/PON — null for full-payment / NPO.
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
                date: cr.closing_date || c.customer_since || '', method: cr.payment_method || '',
                tenure: cr.installment_tenure || null, advance: !!cr.is_advance_package,
                ringSize: cr.ring_size || '', payStatus: cr.payment_status || 'PAID',
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
    const tabsHtml = `<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">${tab('all', 'All', cAll)}${tab('full', 'Full Payment', cFull)}${tab('installment', 'Installment', cInst)}</div>`;

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
            <td>${prodBadge}</td>
            <td>${statusSel}</td>
            <td><input type="text" class="form-control" style="font-size:12px;padding:4px 6px;min-width:140px;" value="${escapeHtml(l.remarks)}" placeholder="Add remark…" onchange="app.saveDeliveryRemarks('${l.kind}', ${l.id}, ${l.customerId}, this.value)"></td>
            <td>${proofCell}</td>
        </tr>`;
    });
    html += `</tbody></table></div><div style="margin-top:10px;font-size:12px;color:var(--gray-500);">${rows.length} line${rows.length !== 1 ? 's' : ''} shown</div>`;
    body.innerHTML = html;
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


    app.register('customers', {
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
        openEditPlatformIdsModal,
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
