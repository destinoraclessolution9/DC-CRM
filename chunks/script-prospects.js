/**
 * CRM Lazy Chunk: Prospect & Customer Management
 * Covers: Prospect/Customer views, Manager Approval Queue, Purchases History,
 *   Phone deduplication, Push notifications, Notification preferences, Agent management.
 * Loaded on-demand when navigating to prospects/customers/agents views.
 * Extracted 2026-06-05 (~9557 lines).
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
    // Live reference to current user (refreshed on each navigation via _syncProspectsUser)
    let _currentUser = _state.cu;
    const _syncUser = () => { _currentUser = _state.cu; };
    window._syncProspectsUser = _syncUser;
    // Current view (read-only reference)
    const _getCurrentView = () => _state.cv;

// ========== PHASE 3: PROSPECT MANAGEMENT FUNCTIONS ==========

let _sortField = 'score';
let _sortDirection = 'desc';
// ── Pagination state for prospects table ──
let _prospectPage = 0;
const _prospectPageSize = 50;
let _prospectViewMode = 'table';
const _selectedProspects = new Set();
// ── Purchases history cache (chunk-local) ──
let _purchasesHistoryCache = null;
let _purchasesHistoryCacheTs = 0;
let _phFilter = { search: '', agent: 'all', delivery: 'all', from: '', to: '' };
let _phPage = 0;

const sortProspects = async (field) => {
    if (_sortField === field) {
        _sortDirection = _sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        _sortField = field;
        _sortDirection = 'desc';
    }
    _prospectPage = 0; // reset to first page on sort change
    await renderProspectsTable();
};

const showProspectsView = async (container) => {
    container.innerHTML = `
        <div class="prospects-view">
            <div class="tab-navigation">
                <button class="tab-btn active" onclick="app.switchCustomerTab('prospects')">Prospects</button>
                <button class="tab-btn" onclick="app.switchCustomerTab('customers')">Customers</button>
            </div>

            <div id="prospects-tab-content">
                <div class="prospects-header">
                    <div>
                        <h1>Prospects Management</h1>
                        <p>Track and manage potential customers through the lifecycle.</p>
                    </div>
                    <div class="header-actions">
                        <button class="btn secondary" onclick="app.openImportWizard()">
                            <i class="fas fa-file-import"></i> Import
                        </button>
                        <button class="btn primary" onclick="app.openAddProspectModal()">
                            <i class="fas fa-plus"></i> Add Prospect
                        </button>
                    </div>
                </div>

                <!-- Stats row -->
                <div class="prospect-stats-row" id="prospect-stats-row"></div>

            <div class="filter-bar">
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <div class="search-group" style="flex:1;min-width:180px;">
                        <i class="fas fa-search"></i>
                        <input type="text" id="prospect-search" placeholder="Search by name, phone, email, or ID..." oninput="app.debounceCall('prospect-search', app.filterProspects, 220)">
                    </div>
                    <button id="prospect-filter-btn" class="btn secondary btn-sm" onclick="app.toggleProspectFilters(this)" style="white-space:nowrap;position:relative;">
                        <i class="fas fa-sliders-h"></i> Filters
                    </button>
                    <div class="prospect-view-toggle">
                        <button id="prospect-view-table" class="active" onclick="app.toggleProspectView('table')" title="Table view"><i class="fas fa-table"></i> Table</button>
                        <button id="prospect-view-card" onclick="app.toggleProspectView('card')" title="Card view"><i class="fas fa-th-large"></i> Card</button>
                    </div>
                    <select id="prospect-sort-select" class="form-control" style="width:auto;font-size:13px;padding:6px 10px;" onchange="app.sortProspectsBySelect(this.value)">
                        <option value="score_desc">Sort: Score (High → Low)</option>
                        <option value="score_asc">Sort: Score (Low → High)</option>
                        <option value="name_asc">Sort: Name (A → Z)</option>
                        <option value="name_desc">Sort: Name (Z → A)</option>
                        <option value="activity_desc">Sort: Recent Activity</option>
                        <option value="activity_asc">Sort: Oldest Activity</option>
                        <option value="protection_asc">Sort: Protection (Urgent first)</option>
                        <option value="protection_desc">Sort: Protection (Latest first)</option>
                    </select>
                </div>
                <div id="prospect-adv-filters" style="display:none;margin-top:10px;">
                    <div class="filter-group">
                        <select id="filter-score" onchange="app.filterProspects()">
                            <option value="">All Scores</option>
                            <option value="A+">Grade A+ (800-1000)</option>
                            <option value="A">Grade A (600-799)</option>
                            <option value="B">Grade B (400-599)</option>
                            <option value="C">Grade C (200-399)</option>
                            <option value="D">Grade D (0-199)</option>
                        </select>
                        <select id="filter-gua" onchange="app.filterProspects()">
                            <option value="">All Ming Gua</option>
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
                        <select id="filter-status" onchange="app.filterProspects()">
                            <option value="">All Status</option>
                            <option value="active">Active</option>
                            <option value="attention">Needs Attention</option>
                            <option value="reassign">Reassignable</option>
                            <option value="critical">Critical</option>
                        </select>
                        <select id="filter-agent" onchange="app.filterProspects()">
                            <option value="">All Agents</option>
                        </select>
                        <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--text-secondary);cursor:pointer;user-select:none;" title="By default, prospects inactive for 500+ days are hidden. Type a name/phone in the search box to find them, or check this to load them all.">
                            <input type="checkbox" id="filter-include-dormant" onchange="app.filterProspects()" style="margin:0;">
                            Include dormant (500+ days)
                        </label>
                        <button class="btn primary" onclick="app.filterProspects()">Apply Filters</button>
                    </div>
                </div>
            </div>

            <!-- Bulk action bar -->
            <div class="prospect-bulk-bar" id="prospect-bulk-bar" style="display:none;">
                <span class="bulk-count" id="prospect-bulk-count">0</span>&nbsp;selected
                <button class="btn-bulk" onclick="app.bulkReassignProspects()"><i class="fas fa-user-tag"></i> Reassign</button>
                <button class="btn-bulk danger" id="prospect-bulk-delete-btn" onclick="app.bulkDeleteProspects()"><i class="fas fa-trash"></i> Delete</button>
                <button class="btn-bulk ml-auto" onclick="app.clearProspectSelection()"><i class="fas fa-times"></i> Clear</button>
            </div>

            <div class="prospects-table-container" id="prospects-table-view">
                <table class="prospects-table" id="prospects-table">
                    <thead>
                        <tr>
                            <th scope="col" class="prospect-select-cell"><input type="checkbox" id="prospect-select-all" onclick="app.toggleProspectSelectAll()" title="Select all"></th>
                            <th scope="col" data-sort-field="name" onclick="app.sortProspects('name')" style="cursor:pointer;">PROSPECT <i class="fas fa-sort sort-icon"></i></th>
                            <th scope="col">AGENT</th>
                            <th scope="col" data-sort-field="score" onclick="app.sortProspects('score')" style="cursor:pointer;">SCORE <i class="fas fa-sort sort-icon active"></i></th>
                            <th scope="col">MING GUA</th>
                            <th scope="col">OCCUPATION/COMPANY</th>
                            <th scope="col" data-sort-field="activity" onclick="app.sortProspects('activity')" style="cursor:pointer;">LAST ACTIVITY <i class="fas fa-sort sort-icon"></i></th>
                            <th scope="col" data-sort-field="protection" onclick="app.sortProspects('protection')" style="cursor:pointer;">PROTECTION <i class="fas fa-sort sort-icon"></i></th>
                            <th scope="col">ACTIONS</th>
                        </tr>
                    </thead>
                    <tbody id="prospects-table-body">
                        <!-- Populated by renderProspectsTable() -->
                    </tbody>
                </table>
            </div>

            <!-- Card view container -->
            <div id="prospects-card-view" style="display:none;">
                <div class="prospect-cards-grid" id="prospect-cards-container"></div>
                <div id="prospects-card-pagination"></div>
            </div>

            </div>
            <div id="customers-tab-content" style="display: none;">
                <!-- Customer view content will be injected here -->
            </div>
        </div>
    `;
    await renderProspectsTable();
};

const switchCustomerTab = async (tabName) => {
    const pTab = document.getElementById('prospects-tab-content');
    const cTab = document.getElementById('customers-tab-content');
    const btns = document.querySelectorAll('.tab-btn');

    btns.forEach(b => b.classList.remove('active'));
    if (tabName === 'prospects') {
        pTab.style.display = 'block';
        cTab.style.display = 'none';
        btns[0].classList.add('active');
        await renderProspectsTable();
    } else {
        pTab.style.display = 'none';
        cTab.style.display = 'block';
        btns[1].classList.add('active');
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
                    <button class="btn primary" onclick="app.openAddCustomerModal()">
                        <i class="fas fa-plus"></i> Add Customer
                    </button>
                </div>
            </div>

            <div class="warning-banner">
                <i class="fas fa-exclamation-triangle"></i>
                <span>⚠️ DELETE IS NOT AVAILABLE - Customer records are permanent and cannot be deleted under any circumstances.</span>
            </div>

            ${(_getUserLevel(_currentUser) <= 4) ? `
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

            <div class="prospects-table-container">
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
    await renderApprovalQueue();
};

// ── Pagination state for customers table ──
let _customerPage = 0;
const _customerPageSize = 50;

// Live app-state bridge for lazy-loaded chunks.
// Every getter/setter delegates to the private IIFE `let` — the local
// variable remains authoritative; chunks read/write via this object.
//
// Key conventions (short to minimise minified output):
//   cu    → _currentUser        cv    → _currentView
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

const renderCustomersTable = async () => {
    const tbody = document.getElementById('customers-table-body');
    if (!tbody) return;

    // ── Use getAll() with cache (proven reliable) ──
    const customers = await getVisibleCustomers();
    const allUsers = await AppDataStore.getAll('users');
    const userById = new Map(allUsers.map(u => [String(u.id), u]));

    const _custUserLevel = _getUserLevel(_currentUser);
    const canReassignCust = _custUserLevel <= 5;
    let activeAgentsCust = [];
    if (canReassignCust) {
        const _custScopeIds = _custUserLevel <= 2
            ? null
            : await getVisibleUserIds(_currentUser);
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

    let allEventRegs = [];
    if (minEventsFilter > 0) allEventRegs = await AppDataStore.getAll('event_registrations');

    // ── Apply filters ──
    let filtered = [];
    for (const c of customers) {
        if (searchQuery && !(
            (c.full_name || '').toLowerCase().includes(searchQuery) ||
            (c.nickname && c.nickname.toLowerCase().includes(searchQuery)) ||
            (c.phone && c.phone.includes(searchQuery)) ||
            (c.email && c.email.toLowerCase().includes(searchQuery))
        )) continue;
        if (guaFilter && c.ming_gua !== guaFilter) continue;
        if (typeFilter === 'VIP' && (c.lifetime_value || 0) < 5000) continue;
        if (deficiencyFilter) {
            const needs = c.needs ? (Array.isArray(c.needs) ? c.needs : c.needs.split(',').map(t => t.trim())) : [];
            if (!needs.includes(deficiencyFilter)) continue;
        }
        if (houseAuditFilter) {
            const auditStatus = c.house_audit_status || 'None';
            if (auditStatus !== houseAuditFilter) continue;
        }
        if (minEventsFilter > 0) {
            const attendedCount = allEventRegs.filter(r => r.attendee_id === c.id).length;
            if (attendedCount < minEventsFilter) continue;
        }
        filtered.push(c);
    }

    // ── Client-side pagination ──
    const totalCount = filtered.length;
    const pageStart = _customerPage * _customerPageSize;
    const pageCustomers = filtered.slice(pageStart, pageStart + _customerPageSize);

    let html = '';
    for (const c of pageCustomers) {
        const agent = userById.get(String(c.responsible_agent_id || c.agent_id));
        const agentName = agent ? agent.full_name : '—';

        html += `
            <tr onclick="app.showCustomerDetail(${c.id})">
                <td data-label="Name"><strong>${c.full_name}</strong></td>
                <td data-label="Lifetime Value">RM ${(c.lifetime_value || 0).toLocaleString()} <span style="color:var(--success); font-size:12px;"><i class="fas fa-caret-up"></i></span></td>
                <td data-label="Customer Since">${c.customer_since || '—'}</td>
                <td data-label="Ming Gua">${c.ming_gua || '—'}</td>
                <td data-label="Agent" onclick="event.stopPropagation()">${canReassignCust
                    ? `<select class="form-control" style="padding:2px 6px;font-size:12px;min-width:120px;border:1px solid var(--border);border-radius:4px;background:var(--surface);cursor:pointer;" onchange="app.quickReassign(${c.id}, this.value, 'customer')" title="Reassign agent">${(() => {
                        const cid = (c.responsible_agent_id || c.agent_id) ? String(c.responsible_agent_id || c.agent_id) : '';
                        if (!cid) return '<option value="" selected></option>';
                        if (activeAgentsCust.some(a => String(a.id) === cid)) return '';
                        const u = userById.get(cid);
                        if (!u || !u.full_name) return '<option value="" selected></option>';
                        return `<option value="${escapeHtml(cid)}" selected>${escapeHtml(u.full_name)}</option>`;
                    })()}${activeAgentsCust.map(a => `<option value="${a.id}" ${String(a.id) === String(c.responsible_agent_id || c.agent_id) ? 'selected' : ''}>${escapeHtml(a.full_name || 'Agent')}</option>`).join('')}</select>`
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
    const paginationText = document.getElementById('customers-pagination')?.textContent || '';
    const totalMatch = paginationText.match(/of (\d+)/);
    const total = totalMatch ? parseInt(totalMatch[1]) : 9999;
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

const renderApprovalQueue = async () => {
    const tbody = document.getElementById('approval-queue-body');
    if (!tbody) return;

    // Fetch all three tables in parallel. Previously these awaited
    // sequentially and then the rendering loop did `await getAgentName()`
    // per pending entry (one getById per row). Now we do 3 queries total.
    const [allEntries, allProspects, allUsers] = await Promise.all([
        AppDataStore.getAll('approval_queue'),
        AppDataStore.getAll('prospects'),
        AppDataStore.getAll('users'),
    ]);
    // Hide stale info_update entries for prospects that were never converted
    // to customers — those should never have reached the queue (a previous
    // bug created them on every prospect edit). Approval gating only makes
    // sense once the prospect is a customer, so filter them out here too.
    const convertedIds = new Set(
        (allProspects || []).filter(p => p?.status === 'converted').map(p => String(p.id))
    );
    const userMap = new Map((allUsers || []).map(u => [String(u.id), u]));
    const pending = allEntries
        .filter(e => e.status === 'pending')
        .filter(e => e.approval_type !== 'info_update' || convertedIds.has(String(e.prospect_id)))
        .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));

    const countEl = document.getElementById('approval-queue-count');
    if (countEl) countEl.textContent = pending.length;

    if (pending.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--gray-400);"><i class="fas fa-check-circle" style="margin-right:6px;"></i>No pending approvals</td></tr>';
        return;
    }

    let html = '';
    for (const entry of pending) {
        const agentName = userMap.get(String(entry.submitted_by))?.full_name || 'Unknown';
        const name = entry.snapshot_after?.full_name || '-';
        const typeConfig = {
            new_customer: { label: 'New Customer', icon: 'fa-user-plus', bg: '#dbeafe', color: '#1e40af' },
            info_update: { label: 'Info Update', icon: 'fa-edit', bg: '#fef3c7', color: '#92400e' },
            new_sale: { label: 'New Sale', icon: 'fa-dollar-sign', bg: '#d1fae5', color: '#065f46' }
        };
        const tc = typeConfig[entry.approval_type] || { label: entry.approval_type, icon: 'fa-question', bg: '#f3f4f6', color: '#374151' };
        const dateStr = entry.submitted_at ? new Date(entry.submitted_at).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

        html += `<tr>
            <td><span style="background:${tc.bg}; color:${tc.color}; padding:3px 10px; border-radius:6px; font-size:12px; font-weight:600; white-space:nowrap;"><i class="fas ${tc.icon}" style="margin-right:4px;"></i>${tc.label}</span></td>
            <td><strong>${escapeHtml(name)}</strong></td>
            <td>${escapeHtml(agentName)}</td>
            <td style="font-size:12px; white-space:nowrap;">${dateStr}</td>
            <td style="max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px;">${escapeHtml(entry.description || '-')}</td>
            <td onclick="event.stopPropagation()">
                <button class="btn-icon" title="View Details" onclick="event.stopPropagation();app.showApprovalDetail(${entry.id})"><i class="fas fa-eye"></i></button>
                <button class="btn-icon" title="Approve" style="color:#16a34a;" onclick="event.stopPropagation();app.approveQueueEntry(${entry.id})"><i class="fas fa-check-circle"></i></button>
                <button class="btn-icon" title="Reject" style="color:#dc2626;" onclick="event.stopPropagation();app.rejectQueueEntry(${entry.id})"><i class="fas fa-times-circle"></i></button>
            </td>
        </tr>`;
    }
    tbody.innerHTML = html;
};

const showApprovalDetail = async (entryId) => {
    const entry = await AppDataStore.getById('approval_queue', entryId);
    if (!entry) return UI.toast.error('Approval entry not found');

    const agentName = await (window.app.getAgentName || (() => Promise.resolve('')))(entry.submitted_by);
    const snapshot = entry.snapshot_after || {};
    let detailHtml = '';

    if (entry.approval_type === 'new_customer') {
        const cr = snapshot.closing_record;
        const saleAmount = parseFloat(cr?.sale_amount) || 0;
        detailHtml = `
            <div style="background:#dbeafe; border:1px solid #93c5fd; border-radius:8px; padding:12px; font-size:13px; color:#1e40af; margin-bottom:14px;">
                <i class="fas fa-user-plus" style="margin-right:6px;"></i>
                New customer conversion requested by <strong>${agentName}</strong>. Approving will create a permanent Customer profile.
            </div>
            <div style="font-size:13px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                <div><span style="color:var(--gray-500);">Name:</span> <strong>${snapshot.full_name || '-'}</strong></div>
                <div><span style="color:var(--gray-500);">Phone:</span> ${snapshot.phone || '-'}</div>
                <div><span style="color:var(--gray-500);">IC:</span> ${snapshot.ic_number || '-'}</div>
                <div><span style="color:var(--gray-500);">DOB:</span> ${snapshot.date_of_birth || '-'}</div>
                <div><span style="color:var(--gray-500);">Email:</span> ${snapshot.email || '-'}</div>
                <div><span style="color:var(--gray-500);">Occupation:</span> ${snapshot.occupation || '-'}</div>
                <div><span style="color:var(--gray-500);">Ming Gua:</span> ${snapshot.ming_gua || '-'}</div>
                <div><span style="color:var(--gray-500);">Referrer:</span> ${snapshot.referred_by || '-'}</div>
            </div>
            ${cr ? `
                <div style="border-top:1px solid var(--gray-200); padding-top:12px; margin-top:12px;">
                    <div style="font-weight:600; margin-bottom:8px; font-size:13px;">Sales Record</div>
                    <div style="font-size:13px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <div><span style="color:var(--gray-500);">Product:</span> ${cr.product || '-'}</div>
                        <div><span style="color:var(--gray-500);">Amount:</span> <strong style="color:#166534;">RM ${saleAmount.toLocaleString()}</strong></div>
                        <div><span style="color:var(--gray-500);">Invoice:</span> ${cr.invoice_number || '-'}</div>
                        <div><span style="color:var(--gray-500);">Date:</span> ${cr.closing_date || '-'}</div>
                    </div>
                </div>
            ` : ''}`;
    } else if (entry.approval_type === 'info_update') {
        const before = entry.snapshot_before || {};
        const after = entry.snapshot_after || {};
        const fields = ['full_name','nickname','phone','email','ic_number','date_of_birth','lunar_birth','ming_gua','occupation','company_name','income_range','address','city','state','postal_code','title','gender','nationality','referred_by','referral_relationship'];
        const changedFields = fields.filter(f => before[f] !== undefined && after[f] !== undefined && String(before[f] || '') !== String(after[f] || ''));

        detailHtml = `
            <div style="background:#fef3c7; border:1px solid #fcd34d; border-radius:8px; padding:12px; font-size:13px; color:#92400e; margin-bottom:14px;">
                <i class="fas fa-edit" style="margin-right:6px;"></i>
                Information updated by <strong>${agentName}</strong>. Review changes below.
            </div>
            ${changedFields.length > 0 ? `
                <table style="width:100%; border-collapse:collapse; font-size:13px;">
                    <thead><tr>
                        <th scope="col" style="text-align:left; padding:6px 8px; border-bottom:2px solid var(--gray-200); color:var(--gray-500);">Field</th>
                        <th scope="col" style="text-align:left; padding:6px 8px; border-bottom:2px solid var(--gray-200); color:#dc2626;">Before</th>
                        <th scope="col" style="text-align:left; padding:6px 8px; border-bottom:2px solid var(--gray-200); color:#16a34a;">After</th>
                    </tr></thead>
                    <tbody>${changedFields.map(f => `<tr>
                        <td style="padding:6px 8px; border-bottom:1px solid var(--gray-100); font-weight:500;">${f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</td>
                        <td style="padding:6px 8px; border-bottom:1px solid var(--gray-100); color:#dc2626; text-decoration:line-through;">${before[f] || '<em>empty</em>'}</td>
                        <td style="padding:6px 8px; border-bottom:1px solid var(--gray-100); color:#16a34a; font-weight:600;">${after[f] || '<em>empty</em>'}</td>
                    </tr>`).join('')}</tbody>
                </table>
            ` : '<div style="color:var(--gray-400); font-size:13px; font-style:italic; padding:12px;">No field differences detected.</div>'}`;
    } else if (entry.approval_type === 'new_sale') {
        const cr = entry.snapshot_after || {};
        const saleAmount = parseFloat(cr.sale_amount) || 0;
        detailHtml = `
            <div style="background:#d1fae5; border:1px solid #6ee7b7; border-radius:8px; padding:12px; font-size:13px; color:#065f46; margin-bottom:14px;">
                <i class="fas fa-dollar-sign" style="margin-right:6px;"></i>
                New sale submitted by <strong>${agentName}</strong>. Review closing record below.
            </div>
            <div style="font-size:13px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                <div><span style="color:var(--gray-500);">Prospect:</span> <strong>${cr.full_name || snapshot.prospect_name || '-'}</strong></div>
                <div><span style="color:var(--gray-500);">Product:</span> ${cr.product || '-'}</div>
                <div><span style="color:var(--gray-500);">Sale Amount:</span> <strong style="color:#166534;">RM ${saleAmount.toLocaleString()}</strong></div>
                <div><span style="color:var(--gray-500);">Payment:</span> ${cr.payment_method || '-'}</div>
                <div><span style="color:var(--gray-500);">Invoice:</span> ${cr.invoice_number || '-'}</div>
                <div><span style="color:var(--gray-500);">Closing Date:</span> ${cr.closing_date || '-'}</div>
                ${cr.sales_idea ? `<div style="grid-column:1/-1;"><span style="color:var(--gray-500);">Sales Idea:</span> ${cr.sales_idea}</div>` : ''}
            </div>`;
    }

    UI.showModal('Approval Details', `
        <div style="display:flex; flex-direction:column; gap:14px;">
            ${detailHtml}
            <div style="font-size:12px; color:var(--gray-400); border-top:1px solid var(--gray-100); padding-top:8px;">
                Submitted: ${new Date(entry.submitted_at).toLocaleString('en-MY')} | By: ${agentName}
            </div>
        </div>
    `, [
        { label: '<i class="fas fa-times-circle"></i> Reject', type: 'secondary', action: `(async () => { UI.hideModal(); await app.rejectQueueEntry(${entryId}); })()` },
        { label: '<i class="fas fa-check-circle"></i> Approve', type: 'primary', action: `(async () => { await app.approveQueueEntry(${entryId}); })()` }
    ]);
};

const approveQueueEntry = async (entryId) => {
    const entry = await AppDataStore.getById('approval_queue', entryId);
    if (!entry || entry.status !== 'pending') return UI.toast.error('Entry not found or already processed.');

    const now = new Date().toISOString();

    if (entry.approval_type === 'new_customer') {
        await approveProspectConversion(entry.prospect_id);
    } else if (entry.approval_type === 'info_update') {
        const prospect = await AppDataStore.getById('prospects', entry.prospect_id);
        if (prospect?.status === 'converted') {
            const customers = await AppDataStore.getAll('customers');
            const customer = customers.find(c => c.converted_from_prospect_id == entry.prospect_id);
            if (customer) {
                const syncable = ['title','full_name','nickname','gender','nationality','phone','email','ic_number','date_of_birth','lunar_birth','ming_gua','occupation','company_name','income_range','address','city','state','postal_code','referred_by','referred_by_id','referred_by_type','referral_relationship'];
                const syncFields = {};
                for (const field of syncable) {
                    if (entry.snapshot_after[field] !== undefined) {
                        syncFields[field] = entry.snapshot_after[field];
                    }
                }
                if (Object.keys(syncFields).length > 0) {
                    await AppDataStore.update('customers', customer.id, syncFields);
                }
            }
        }
    } else if (entry.approval_type === 'new_sale') {
        const prospect = await AppDataStore.getById('prospects', entry.prospect_id);
        if (prospect?.status === 'converted') {
            const customers = await AppDataStore.getAll('customers');
            const customer = customers.find(c => c.converted_from_prospect_id == entry.prospect_id);
            if (customer) {
                const cr = entry.snapshot_after;
                const amt = parseFloat(cr.sale_amount) || 0;
                await AppDataStore.create('purchases', {
                    id: Date.now(),
                    customer_id: customer.id,
                    date: cr.closing_date || now.split('T')[0],
                    invoice: cr.invoice_number || '',
                    item: cr.product || '',
                    amount: amt,
                    status: 'COMPLETED',
                    payment_method: cr.payment_method || 'Cash'
                });
                await AppDataStore.update('customers', customer.id, {
                    lifetime_value: (customer.lifetime_value || 0) + amt
                });
            }
        }
        if (prospect?.closing_record?.status === 'submitted') {
            const approvedCr = { ...prospect.closing_record, status: 'approved', approved_at: now };
            const existingHistory = Array.isArray(prospect.closing_records_history) ? prospect.closing_records_history : [];
            await AppDataStore.update('prospects', entry.prospect_id, {
                closing_record: null,
                closing_records_history: [...existingHistory, approvedCr]
            });
        }
    }

    await AppDataStore.update('approval_queue', entryId, {
        status: 'approved',
        reviewed_by: _currentUser?.id,
        reviewed_at: now
    });

    UI.hideModal();
    UI.toast.success('Approved successfully!');
    await renderApprovalQueue();
    await renderCustomersTable();
};

const rejectQueueEntry = async (entryId) => {
    const entry = await AppDataStore.getById('approval_queue', entryId);
    if (!entry || entry.status !== 'pending') return UI.toast.error('Entry not found or already processed.');

    UI.showModal('Reject Approval', `
        <div style="display:flex; flex-direction:column; gap:12px;">
            <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:12px; font-size:13px; color:#991b1b;">
                <i class="fas fa-exclamation-circle" style="margin-right:6px;"></i>
                You are rejecting: <strong>${entry.description || 'this entry'}</strong>
            </div>
            <div class="form-group">
                <label>Reason for rejection</label>
                <textarea id="reject-reason" class="form-control" rows="3" placeholder="Explain why this is being rejected..." style="width:100%;"></textarea>
            </div>
        </div>
    `, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: '<i class="fas fa-times"></i> Confirm Reject', type: 'primary', action: `(async () => { await app.confirmRejectQueueEntry(${entryId}); })()` }
    ]);
};

const confirmRejectQueueEntry = async (entryId) => {
    const reason = document.getElementById('reject-reason')?.value?.trim() || '';
    const entry = await AppDataStore.getById('approval_queue', entryId);
    if (!entry) return;

    if (entry.approval_type === 'info_update' && entry.snapshot_before) {
        const revertFields = {};
        for (const key of Object.keys(entry.snapshot_after)) {
            if (entry.snapshot_before[key] !== undefined) {
                revertFields[key] = entry.snapshot_before[key];
            }
        }
        if (Object.keys(revertFields).length > 0) {
            await AppDataStore.update('prospects', entry.prospect_id, revertFields);
        }
    }

    if (entry.approval_type === 'new_customer') {
        await AppDataStore.update('prospects', entry.prospect_id, {
            conversion_status: 'rejected',
            conversion_rejected_at: new Date().toISOString(),
            conversion_rejected_by: _currentUser?.id
        });
    }

    if (entry.approval_type === 'new_sale') {
        const prospect = await AppDataStore.getById('prospects', entry.prospect_id);
        if (prospect?.closing_record?.status === 'submitted') {
            await AppDataStore.update('prospects', entry.prospect_id, {
                closing_record: { ...prospect.closing_record, status: 'draft', rejected_at: new Date().toISOString(), reject_reason: reason }
            });
        }
    }

    await AppDataStore.update('approval_queue', entryId, {
        status: 'rejected',
        reviewed_by: _currentUser?.id,
        reviewed_at: new Date().toISOString(),
        reject_reason: reason
    });

    UI.hideModal();
    UI.toast.info('Approval rejected.');
    await renderApprovalQueue();
};

const _downloadSheet = async (cols, rows, sheetName, filename, format) => {
    if (format === 'xlsx') {
        await window._ensureXlsx();
        const ws = XLSX.utils.aoa_to_sheet([cols, ...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        XLSX.writeFile(wb, `${filename}.xlsx`);
    } else {
        const csvRows = [cols, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `${filename}.csv`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
};

// _confirmLargeExport — guards exports that would download too much data
// into the browser and risk an OOM tab crash. At 30k+ prospects with
// activities, the in-memory XLSX builder needs ~3× the row size in heap.
// Returns true if the user accepts (or the size is below the warn
// threshold), false if they cancel.
const EXPORT_WARN_THRESHOLD = 5000;
const EXPORT_HARD_LIMIT = 50000;
const _confirmLargeExport = async (rowCount, label) => {
    if (rowCount > EXPORT_HARD_LIMIT) {
        UI.toast.error(`Export blocked: ${rowCount} ${label} exceeds the ${EXPORT_HARD_LIMIT.toLocaleString()} hard limit. Use a server-side report or filter the list first.`);
        return false;
    }
    if (rowCount > EXPORT_WARN_THRESHOLD) {
        const ok = confirm(
            `You are about to export ${rowCount.toLocaleString()} ${label}.\n\n` +
            `Large exports keep the entire dataset in browser memory ` +
            `while the spreadsheet is built — this may take 30–60 ` +
            `seconds and can crash the tab on a low-memory device.\n\n` +
            `Continue?`
        );
        if (!ok) UI.toast.success('Export cancelled');
        return ok;
    }
    return true;
};

// _getAllProspectsForExport — uses getAllPaged so we genuinely get
// every row, not the silently-truncated 1000-row first page that
// getAll() returns. Then applies the same role-scope filter as
// getVisibleProspects() so non-admins only export what they can see.
const _getAllProspectsForExport = async () => {
    const all = await AppDataStore.getAllPaged('prospects', { pageSize: 1000 });
    if (!_currentUser) return [];
    if (isSystemAdmin(_currentUser)) return all;
    const visibleIds = await getVisibleUserIds(_currentUser);
    if (visibleIds === 'all') return all;
    const visible = new Set(visibleIds.map(String));
    return all.filter(p => visible.has(String(p.responsible_agent_id)));
};

const _getAllActivitiesForExport = async () => {
    const all = await AppDataStore.getAllPaged('activities', { pageSize: 1000 });
    if (!_currentUser) return [];
    if (isSystemAdmin(_currentUser)) return all;
    const allUsersForVis = await AppDataStore.getAll('users');
    const canView = await buildActivityVisibilityChecker(allUsersForVis);
    return all.filter(canView);
};

const exportData = async (type, format) => {
    const today = new Date().toISOString().split('T')[0];
    const filename = `${type}_export_${today}`;

    if (type === 'prospects') {
        const data = await _getAllProspectsForExport();
        if (!data.length) { UI.toast.error('No prospects to export'); return; }
        if (!(await _confirmLargeExport(data.length, 'prospects'))) return;
        const cols = ['Full Name','Phone','Email','IC Number','Date of Birth','Occupation','Company','Income Range','Address','City','State','Postal Code','Ming Gua','Pipeline Stage','Deal Value (RM)','Score','Source','Status','Created At'];
        const rows = data.map(p => [p.full_name||'', p.phone||'', p.email||'', p.ic_number||'', p.date_of_birth||'', p.occupation||'', p.company_name||'', p.income_range||'', p.address||'', p.city||'', p.state||'', p.postal_code||'', p.ming_gua||'', p.pipeline_stage||'', p.deal_value||'', p.score||'', p.source||'', p.status||'', p.created_at?p.created_at.split('T')[0]:'']);
        await _downloadSheet(cols, rows, 'Prospects', filename, format);
        UI.toast.success(`Exported ${data.length} prospects`);

    } else if (type === 'prospects_activities') {
        const prospects = await _getAllProspectsForExport();
        if (!prospects.length) { UI.toast.error('No prospects to export'); return; }
        const activities = await _getAllActivitiesForExport();
        const total = prospects.length + activities.length;
        if (!(await _confirmLargeExport(total, 'prospects+activities rows'))) return;
        const pCols = ['Full Name','Phone','Email','IC Number','Date of Birth','Occupation','Company','Income Range','Address','City','State','Postal Code','Ming Gua','Pipeline Stage','Deal Value (RM)','Score','Source','Status','Created At'];
        const pRows = prospects.map(p => [p.full_name||'', p.phone||'', p.email||'', p.ic_number||'', p.date_of_birth||'', p.occupation||'', p.company_name||'', p.income_range||'', p.address||'', p.city||'', p.state||'', p.postal_code||'', p.ming_gua||'', p.pipeline_stage||'', p.deal_value||'', p.score||'', p.source||'', p.status||'', p.created_at?p.created_at.split('T')[0]:'']);
        const prospectMap = Object.fromEntries(prospects.map(p => [p.id, p.full_name]));
        const aCols = ['Prospect Name','Date','Type','Title','Start Time','End Time','Status','Notes','Lead Agent ID'];
        const aRows = activities.map(a => [prospectMap[a.prospect_id]||'', a.activity_date||'', a.activity_type||'', a.activity_title||'', a.start_time||'', a.end_time||'', a.status||'', a.notes||'', a.lead_agent_id||'']);
        await window._ensureXlsx();
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([pCols, ...pRows]), 'Prospects');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([aCols, ...aRows]), 'Activities');
        XLSX.writeFile(wb, `${filename}.xlsx`);
        UI.toast.success(`Exported ${prospects.length} prospects and ${activities.length} activities`);

    } else if (type === 'customers') {
        const all = await AppDataStore.getAllPaged('customers', { pageSize: 1000 });
        const data = isSystemAdmin(_currentUser)
            ? all
            : await (async () => {
                const visIds = await getVisibleUserIds(_currentUser);
                if (visIds === 'all') return all;
                const vis = new Set(visIds.map(String));
                return all.filter(c => vis.has(String(c.responsible_agent_id)) || vis.has(String(c.agent_id)));
            })();
        if (!data.length) { UI.toast.error('No customers to export'); return; }
        if (!(await _confirmLargeExport(data.length, 'customers'))) return;
        const cols = ['Full Name','Phone','Email','IC Number','Date of Birth','Address','City','State','Lifetime Value (RM)','Status','Customer Since','Created At'];
        const rows = data.map(c => [c.full_name||'', c.phone||'', c.email||'', c.ic_number||'', c.date_of_birth||'', c.address||'', c.city||'', c.state||'', c.lifetime_value||'', c.status||'', c.customer_since||'', c.created_at?c.created_at.split('T')[0]:'']);
        await _downloadSheet(cols, rows, 'Customers', filename, format);
        UI.toast.success(`Exported ${data.length} customers`);

    } else if (type === 'agents') {
        const allUsers = await AppDataStore.getAll('users');
        const data = allUsers.filter(u => u.full_name);
        if (!data.length) { UI.toast.error('No agents to export'); return; }
        const cols = ['Full Name','Role','Agent Code','Phone','Email','IC Number','Team','Commission Rate (%)','License Start','License Expiry','Status','Join Date'];
        const rows = data.map(a => [a.full_name||'', a.role||'', a.agent_code||'', a.phone||'', a.email||'', a.ic_number||'', a.team||'', a.commission_rate||'', a.license_start||'', a.license_expiry||'', a.status||'', a.join_date||'']);
        await _downloadSheet(cols, rows, 'Agents', filename, format);
        UI.toast.success(`Exported ${data.length} consultants/agents`);

    } else if (['products','events','promotions'].includes(type)) {
        _state.cmlt = type;
        await exportMarketingList(format);
    }
};

const renderProspectsTable = async () => {
    const tbody = document.getElementById('prospects-table-body');
    if (!tbody) return;

    // ── Perf timing (temp diagnostic) ──────────────────────────────────
    // Logs wall-clock for each phase to the console so we can see where
    // the cold-load time is going. Remove once perf is sorted.
    const _perf = { t0: performance.now(), marks: {} };
    const _mark = (label) => {
        _perf.marks[label] = performance.now() - _perf.t0;
    };

    // ── Read UI filter values (search term drives the load strategy) ──
    const searchQueryRaw = document.getElementById('prospect-search')?.value?.trim() || '';
    const searchQuery = searchQueryRaw.toLowerCase();
    const scoreFilter = document.getElementById('filter-score')?.value || '';
    const guaFilter = document.getElementById('filter-gua')?.value || '';
    const statusFilter = document.getElementById('filter-status')?.value || '';
    const agentFilter = document.getElementById('filter-agent')?.value || '';
    const includeDormantToggle = document.getElementById('filter-include-dormant')?.checked || false;

    // ── Instant skeleton paint (cold-load only) ────────────────────────
    // If the body is empty (first visit, no cache) the user otherwise
    // stares at a totally blank table for the 1–2 s it takes to fetch
    // prospects + users + latest-activities. Paint shimmer rows the
    // moment render starts so the page feels alive. On subsequent
    // re-renders (filter change, sort) we leave the existing rows in
    // place — swapping them feels faster than flashing a skeleton.
    if (tbody.children.length === 0) {
        const skelCell = (w) => `<td><span class="skeleton-block skeleton-row" style="width:${w}%;"></span></td>`;
        let skelHtml = '';
        for (let i = 0; i < 8; i++) {
            skelHtml += `<tr class="skeleton-prospect-row">${skelCell(70)}${skelCell(80)}${skelCell(50)}${skelCell(40)}${skelCell(75)}${skelCell(60)}${skelCell(65)}${skelCell(55)}</tr>`;
        }
        tbody.innerHTML = skelHtml;
    }

    // ── Dormancy-aware load ────────────────────────────────────────────
    // Ops rule (2026-04-23): prospects inactive for >500 days are NOT
    // loaded by default. They remain searchable by phone/name/email — a
    // non-empty search term routes through searchProspects() which uses
    // the pg_trgm indexes and INCLUDES dormant records. Toggle the
    // "Include dormant" checkbox to load them unconditionally.
    //
    // activities is fetched per visible-page row below (indexed lookup)
    // to avoid downloading the entire activities table just to show a
    // last-activity column. prospects + users are independent and run
    // in parallel — saves ~one round-trip on cold load.
    _mark('skeleton-painted');
    // When filtering by a specific agent, always include dormant so the admin
    // sees the agent's full prospect list, not just the "active" subset.
    // Also force a fresh DB fetch (bypass SWR cache) so newly-imported prospects
    // for that agent are immediately visible without waiting for background sync.
    const prospectsPromise = searchQueryRaw
        ? AppDataStore.searchProspects(searchQueryRaw, { includeDormant: true, limit: 200 })
        : AppDataStore.getActiveProspects({ includeDormant: includeDormantToggle || !!agentFilter, fresh: !!agentFilter });
    const [allProspects, allUsers] = await Promise.all([
        prospectsPromise,
        // includeDeleted: the active-users cache hides status='deleted'
        // staff, but prospects may still reference them as owning agent.
        // Merging deleted users into the lookup keeps the Agent column
        // populated; activeAgents below stays restricted so the reassign
        // dropdown options don't expose deleted records.
        AppDataStore.getAll('users', { includeDeleted: true }),
    ]);
    _mark('prospects+users-loaded');

    // ── Scope by role hierarchy ──
    let prospects;
    let _scopeVisibleIds = 'all'; // 'all' = no restriction; array = restrict to these agent IDs
    if (isSystemAdmin(_currentUser)) {
        prospects = allProspects;
    } else {
        _scopeVisibleIds = await getVisibleUserIds(_currentUser);
        if (_scopeVisibleIds === 'all') {
            prospects = allProspects;
        } else {
            const visibleIdSet = new Set(_scopeVisibleIds.map(String));
            prospects = allProspects.filter(p => visibleIdSet.has(String(p.responsible_agent_id)));
        }
    }

    // Per-page latest-activity lookup; populated after pagination below.
    const latestActivityByProspect = new Map();
    const userById = new Map(allUsers.map(u => [String(u.id), u]));

    // Safety net: any responsible_agent_id we still can't resolve gets a
    // targeted fetch (covers users excluded from getAll for any reason,
    // not just soft-deletes). Patches userById in place before render.
    const missingAgentIds = [];
    for (const p of allProspects) {
        const aid = p.responsible_agent_id;
        if (aid && !userById.has(String(aid))) missingAgentIds.push(aid);
    }
    if (missingAgentIds.length) {
        try {
            const extras = await AppDataStore.getUsersByIds(missingAgentIds);
            for (const u of extras) userById.set(String(u.id), u);
        } catch (_) { /* non-fatal — column just stays blank */ }
    }

    // ── Populate agent filter dropdown (lazy — only when panel is open) ──
    // Rebuilding a 1000-option <select> on every render is expensive DOM
    // work. Skip it when the filter panel is hidden; populate on first open
    // via the panel toggle onclick, and mark it hydrated so we don't redo
    // it on the next render unless the user list actually changed.
    const agentFilterEl = document.getElementById('filter-agent');
    const filterPanelOpen = document.getElementById('prospect-adv-filters')?.style.display !== 'none';
    const agentDropdownStale = agentFilterEl && !agentFilterEl.dataset.hydrated;
    if (agentFilterEl && (filterPanelOpen || agentDropdownStale)) {
        const currentAgentVal = agentFilterEl.value;
        const scopeIdSet = (_scopeVisibleIds !== 'all' && Array.isArray(_scopeVisibleIds))
            ? new Set(_scopeVisibleIds.map(String)) : null;
        const visibleAgents = allUsers.filter(u => {
            const lvl = _getUserLevel(u);
            if (!(lvl >= 3 && lvl <= 11 && u.status !== 'deleted')) return false;
            // For non-admins, only show agents whose prospects this user can actually see.
            if (scopeIdSet) return scopeIdSet.has(String(u.id));
            return true;
        }).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
        agentFilterEl.innerHTML = '<option value="">All Agents</option>' +
            visibleAgents.map(a => `<option value="${a.id}"${String(a.id) === currentAgentVal ? ' selected' : ''}>${a.full_name || 'Agent'}</option>`).join('');
        agentFilterEl.dataset.hydrated = '1';
    }

    const _userLvlMatch = _currentUser?.role?.match(/Level\s+(\d+)/i);
    const _userLevel = _userLvlMatch ? parseInt(_userLvlMatch[1]) : 99;
    const canDelete = _userLevel <= 5;
    const canReassign = _userLevel <= 5;
    const activeAgents = canReassign ? allUsers.filter(u => {
        const lvl = _getUserLevel(u);
        return lvl >= 3 && lvl <= 11 && u.status !== 'deleted';
    }) : [];

    // ── Apply sorting ──
    prospects.sort((a, b) => {
        let valA, valB;
        if (_sortField === 'name') {
            valA = a.full_name || ''; valB = b.full_name || '';
            return _sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else if (_sortField === 'score') {
            valA = a.score || 0; valB = b.score || 0;
            return _sortDirection === 'asc' ? valA - valB : valB - valA;
        } else if (_sortField === 'activity') {
            valA = a.last_activity_date || '0000-00-00';
            valB = b.last_activity_date || '0000-00-00';
            return _sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else if (_sortField === 'protection') {
            valA = calculateDaysLeft(a.protection_deadline);
            valB = calculateDaysLeft(b.protection_deadline);
            return _sortDirection === 'asc' ? valA - valB : valB - valA;
        }
        return 0;
    });

    // ── Apply filters, then paginate ──
    let filtered = [];
    for (const p of prospects) {
        if (searchQuery && !(
            (p.full_name || '').toLowerCase().includes(searchQuery) ||
            (p.nickname && p.nickname.toLowerCase().includes(searchQuery)) ||
            (p.phone && p.phone.includes(searchQuery)) ||
            (p.email && p.email.toLowerCase().includes(searchQuery)) ||
            (p.id && p.id.toString().includes(searchQuery))
        )) continue;

        const grade = getScoreGrade(p.score);
        if (scoreFilter && scoreFilter !== grade) continue;
        if (guaFilter && p.ming_gua !== guaFilter) continue;
        if (agentFilter && String(p.responsible_agent_id) !== agentFilter) continue;

        const daysLeft = calculateProtectionDays(p);
        const protectionStatus = getProtectionStatus(daysLeft);
        if (statusFilter) {
            if (statusFilter === 'active' && protectionStatus !== 'normal') continue;
            if (statusFilter === 'attention' && protectionStatus !== 'warning') continue;
            if (statusFilter === 'reassign' && p.responsible_agent_id) continue;
            if (statusFilter === 'critical' && protectionStatus !== 'critical') continue;
        }
        filtered.push(p);
    }

    // ── Client-side pagination ──
    const totalCount = filtered.length;
    const pageStart = _prospectPage * _prospectPageSize;
    const pageProspects = filtered.slice(pageStart, pageStart + _prospectPageSize);

    // ── Progressive Last Activity render ──────────────────────────────
    // `last_activity_date` is already a column on prospects rows (kept in
    // sync by a DB trigger on activities inserts). Use it for instant
    // first render — no extra round-trip. We fire getLatestActivities in
    // the background ONLY for the activity_type suffix (e.g. "Meet Up").
    // When it resolves, we patch just those cells via data-la-id selectors.
    // This decouples the 307 ms activities query from the table's first paint.
    _mark('latest-activities-loaded'); // updated once background fetch resolves

    let html = '';
    for (const p of pageProspects) {
        const grade = getScoreGrade(p.score);
        const daysLeft = calculateProtectionDays(p);
        const protectionStatus = getProtectionStatus(daysLeft);
        const protFillClass = daysLeft <= 0 ? 'expired' : protectionStatus;
        const daysClass = daysLeft <= 0 ? 'days-expired' : (daysLeft <= 7 ? 'days-critical' : (daysLeft <= 14 ? 'days-warning' : 'days-normal'));
        const daysLabel = daysLeft <= 0 ? 'Expired' : `${daysLeft}d left`;
        const relTime = timeAgo(p.last_activity_date);
        const lastActivityHtml = p.last_activity_date
            ? `<span style="font-weight:600;color:var(--text-primary);">${relTime}</span><br><span class="la-date" style="font-size:11px;color:var(--text-secondary);">${p.last_activity_date}</span>`
            : '<span style="color:var(--text-secondary);font-style:italic;">No activity</span>';
        const agent = userById.get(String(p.responsible_agent_id));
        const agentName = agent ? agent.full_name : '—';
        const isSelected = _selectedProspects.has(p.id);

        html += `
            <tr onclick="app.showProspectDetail(${p.id})" class="${p.unable_to_serve ? 'row-unable' : ''}">
                <td class="prospect-select-cell" onclick="event.stopPropagation()">
                    <input type="checkbox" data-pid="${p.id}" ${isSelected ? 'checked' : ''} onchange="app.toggleProspectSelect(${p.id})">
                </td>
                <td data-label="Name">
                    <strong class="${p.unable_to_serve ? 'name-unable' : ''}">${p.full_name || '(No Name)'}</strong>
                    ${p.phone ? `<br><span style="font-size:12px;color:var(--text-secondary);">${escapeHtml(p.phone)}</span>` : ''}
                    ${p.unable_to_serve ? `<br><span class="badge-unable">Unable to Serve</span>` : ''}
                </td>
                <td data-label="Agent" onclick="event.stopPropagation()">${canReassign
                    ? `<select class="form-control" style="padding:2px 6px;font-size:12px;min-width:120px;border:1px solid var(--border);border-radius:4px;background:var(--surface);cursor:pointer;" onchange="app.quickReassign(${p.id}, this.value, 'prospect')" title="Reassign agent">${(() => {
                        // Render a selected placeholder so the dropdown can't fall back to showing
                        // the alphabetically-first agent (e.g. "Lim Chi Kin") for unassigned or
                        // off-list-owned prospects. Truly unassigned → blank label. Owner is an
                        // admin/lead/deleted user → show the real name.
                        const cid = p.responsible_agent_id ? String(p.responsible_agent_id) : '';
                        if (!cid) return '<option value="" selected></option>';
                        if (activeAgents.some(a => String(a.id) === cid)) return '';
                        const u = userById.get(cid);
                        if (!u || !u.full_name) return '<option value="" selected></option>';
                        return `<option value="${escapeHtml(cid)}" selected>${escapeHtml(u.full_name)}</option>`;
                    })()}${activeAgents.map(a => `<option value="${a.id}" ${String(a.id) === String(p.responsible_agent_id) ? 'selected' : ''}>${escapeHtml(a.full_name || 'Agent')}</option>`).join('')}</select>`
                    : (p.responsible_agent_id ? escapeHtml(agentName) : '')}</td>
                <td data-label="Score">
                    <span class="score-badge score-${grade.replace('+', '-plus')}">${p.score || 0} (${grade})</span>
                </td>
                <td data-label="Ming Gua">${p.ming_gua || 'MG4'}</td>
                <td data-label="Occupation">${p.occupation || ''}${p.company_name ? ' · ' + p.company_name : ''}</td>
                <td data-label="Last Activity" data-la-id="${p.id}">${lastActivityHtml}</td>
                <td data-label="Protection">
                    <div class="${daysClass}">${daysLabel}</div>
                    <div class="protection-bar">
                        <div class="protection-fill ${protFillClass}" style="width:${Math.min(100, daysLeft <= 0 ? 100 : (daysLeft / 30) * 100)}%"></div>
                    </div>
                </td>
                <td onclick="event.stopPropagation()">
                    <button class="btn-icon" title="Edit" onclick="app.openProspectModal(${p.id})"><i class="fas fa-edit"></i></button>
                    <button class="btn-icon" title="Add Activity" onclick="app.openActivityModal('', ${p.id})"><i class="fas fa-calendar-plus"></i></button>
                    ${p.conversion_status === 'pending_approval' ? `
                        <span title="Conversion pending manager approval" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;background:#fef3c7;border-radius:6px;cursor:default;"><i class="fas fa-user-clock" style="color:#d97706;font-size:12px;"></i></span>
                        ${(isSystemAdmin(_currentUser) || isMarketingManager(_currentUser)) ? `<button class="btn-icon" title="Review & Approve Conversion" style="color:#d97706;" onclick="event.stopPropagation();app.showConversionApprovalModal(${p.id})"><i class="fas fa-check-circle"></i></button>` : ''}
                    ` : (p.status !== 'converted' ? `
                        <button class="btn-icon" title="Convert to Customer" onclick="app.convertToCustomer(${p.id})"><i class="fas fa-user-check"></i></button>
                    ` : '')}
                    ${canDelete ? `<button class="btn-icon" title="Delete" style="color:var(--red-500);" onclick="app.deleteProspect(${p.id})"><i class="fas fa-trash"></i></button>` : ''}
                </td>
            </tr>
        `;
    }

    if (pageProspects.length === 0) {
        const hint = searchQueryRaw
            ? `No prospects matched "<strong>${searchQueryRaw.replace(/</g, '&lt;')}</strong>". Dormant records were included in this search.`
            : (agentFilter
                ? 'No prospects found for this agent.'
                : (includeDormantToggle
                    ? 'No prospects found. Click "Add Prospect" to create one.'
                    : 'No active prospects. Check "Include dormant" or type a name/phone to search older records.'));
        html = `<tr><td colspan="9" style="text-align:center; padding:40px;">${hint}</td></tr>`;
    }

    tbody.innerHTML = html;

    // ── Stats row ──────────────────────────────────────────────────────
    const statsEl = document.getElementById('prospect-stats-row');
    if (statsEl) {
        const totalAll = prospects.length;
        const highScore = prospects.filter(p => (p.score || 0) >= 70).length;
        const now = Date.now();
        const active30 = prospects.filter(p => {
            if (!p.last_activity_date) return false;
            return (now - new Date(p.last_activity_date).getTime()) <= 30 * 86400000;
        }).length;
        const avgScore = totalAll ? Math.round(prospects.reduce((s, p) => s + (p.score || 0), 0) / totalAll) : 0;
        statsEl.innerHTML = `
            <div class="prospect-stat-card">
                <div class="prospect-stat-icon pink"><i class="fas fa-users"></i></div>
                <div><div class="prospect-stat-value">${totalAll}</div><div class="prospect-stat-label">Total Prospects</div></div>
            </div>
            <div class="prospect-stat-card">
                <div class="prospect-stat-icon star"><i class="fas fa-star"></i></div>
                <div><div class="prospect-stat-value">${highScore}</div><div class="prospect-stat-label">High Score (70+)</div></div>
            </div>
            <div class="prospect-stat-card">
                <div class="prospect-stat-icon green"><i class="fas fa-bolt"></i></div>
                <div><div class="prospect-stat-value">${active30}</div><div class="prospect-stat-label">Active (Last 30 Days)</div></div>
            </div>
            <div class="prospect-stat-card">
                <div class="prospect-stat-icon blue"><i class="fas fa-chart-line"></i></div>
                <div><div class="prospect-stat-value">${avgScore}</div><div class="prospect-stat-label">Avg. Score</div></div>
            </div>
            <div class="prospect-stat-card">
                <div class="prospect-stat-icon rose"><i class="fas fa-filter"></i></div>
                <div><div class="prospect-stat-value">${totalCount}</div><div class="prospect-stat-label">Filtered Results</div></div>
            </div>
        `;
    }

    // ── Update sort icons in thead ─────────────────────────────────────
    document.querySelectorAll('#prospects-table thead th[data-sort-field]').forEach(th => {
        const field = th.dataset.sortField;
        const icon = th.querySelector('.sort-icon');
        if (!icon) return;
        if (_sortField === field) {
            icon.className = `fas fa-sort-${_sortDirection === 'asc' ? 'up' : 'down'} sort-icon active`;
        } else {
            icon.className = 'fas fa-sort sort-icon';
        }
    });

    // ── Sync sort dropdown ─────────────────────────────────────────────
    const sortSel = document.getElementById('prospect-sort-select');
    if (sortSel) sortSel.value = `${_sortField}_${_sortDirection}`;

    // ── Card view ──────────────────────────────────────────────────────
    if (_prospectViewMode === 'card') {
        renderProspectCards(pageProspects, userById, canReassign, activeAgents);
    }

    // ── Bulk bar visibility ────────────────────────────────────────────
    updateProspectBulkBar();

    // ── Background activity-type fill-in ───────────────────────────────
    // Table is already visible with dates. Now fetch the activity TYPE
    // in the background (SWR-cached in data.js) and patch only the
    // Last Activity cells that exist in the current tbody. Uses
    // data-la-id to target cells without a full re-render.
    if (pageProspects.length > 0) {
        AppDataStore.getLatestActivitiesForProspects(pageProspects.map(p => p.id))
            .then(latestMap => {
                _mark('latest-activities-loaded');
                for (const [pid, act] of latestMap) {
                    const cell = document.querySelector(`td[data-la-id="${pid}"]`);
                    if (cell) {
                        const datePart = act.activity_date || '';
                        const suffix = act.activity_type ? ` ${act.activity_type}` : '';
                        cell.innerHTML = datePart
                            ? `<span style="font-weight:600;color:var(--text-primary);">${timeAgo(datePart)}</span><br><span class="la-date" style="font-size:11px;color:var(--text-secondary);">${datePart}${suffix}</span>`
                            : '<span style="color:var(--text-secondary);font-style:italic;">No activity</span>';
                    }
                }
            })
            .catch(() => {});
    }

    // ── Instagram-style next-page prefetch ─────────────────────────────
    // While the user reads page N, silently warm the activity cache for
    // page N+1 so clicking "Next" feels instant. Fire-and-forget with a
    // 300 ms delay to stay off the critical render path.
    const nextPageStart = (pageStart + _prospectPageSize);
    const nextPageProspects = filtered.slice(nextPageStart, nextPageStart + _prospectPageSize);
    if (nextPageProspects.length > 0) {
        setTimeout(() => {
            AppDataStore.getLatestActivitiesForProspects(nextPageProspects.map(p => p.id))
                .catch(() => {});
        }, 300);
    }

    // ── Dormancy info line ──
    // Tells the user why some records might not be visible, and offers a
    // one-click path to reveal them. Only shown on the "plain list" path
    // (no search term, toggle off) — when searching or when the toggle is
    // on, the dormant set is already being considered, so no nudge needed.
    const dormantNote = (!searchQueryRaw && !includeDormantToggle && !agentFilter)
        ? `<span style="color:var(--text-secondary);font-size:12px;margin-left:12px;">
             <i class="fas fa-moon" style="opacity:0.6;"></i>
             Prospects inactive 500+ days are hidden. Search by name/phone to find them.
           </span>`
        : '';

    // ── Render pagination controls ──
    const totalPages = Math.ceil(totalCount / _prospectPageSize);
    let paginationEl = document.getElementById('prospects-pagination');
    if (!paginationEl) {
        paginationEl = document.createElement('div');
        paginationEl.id = 'prospects-pagination';
        paginationEl.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;padding:16px 0;flex-wrap:wrap;';
        const pgParent = _prospectViewMode === 'card'
            ? (document.getElementById('prospects-card-pagination') || tbody.closest('.prospects-table-container'))
            : tbody.closest('.prospects-table-container');
        pgParent?.appendChild(paginationEl);
    }
    if (totalPages <= 1) {
        paginationEl.innerHTML = `<span style="color:var(--text-secondary);font-size:13px;">${totalCount} prospect${totalCount !== 1 ? 's' : ''}</span>${dormantNote}`;
    } else {
        const currentPage = _prospectPage + 1;
        const from = pageStart + 1;
        const to = Math.min(pageStart + _prospectPageSize, totalCount);
        let pgHtml = `<span style="color:var(--text-secondary);font-size:13px;">Showing ${from}–${to} of ${totalCount}</span>`;
        pgHtml += `<button class="btn secondary btn-sm" ${_prospectPage === 0 ? 'disabled' : ''} onclick="app.prospectPageNav('first')" title="First page"><i class="fas fa-angle-double-left"></i></button>`;
        pgHtml += `<button class="btn secondary btn-sm" ${_prospectPage === 0 ? 'disabled' : ''} onclick="app.prospectPageNav('prev')"><i class="fas fa-angle-left"></i> Prev</button>`;
        pgHtml += `<span style="font-weight:600;font-size:14px;">Page ${currentPage} of ${totalPages}</span>`;
        pgHtml += `<button class="btn secondary btn-sm" ${currentPage >= totalPages ? 'disabled' : ''} onclick="app.prospectPageNav('next')">Next <i class="fas fa-angle-right"></i></button>`;
        pgHtml += `<button class="btn secondary btn-sm" ${currentPage >= totalPages ? 'disabled' : ''} onclick="app.prospectPageNav('last')" title="Last page"><i class="fas fa-angle-double-right"></i></button>`;
        pgHtml += dormantNote;
        paginationEl.innerHTML = pgHtml;
    }
    _mark('done');
    console.table({
        'skeleton-painted (ms)': Math.round(_perf.marks['skeleton-painted'] || 0),
        'prospects+users-loaded (ms)': Math.round(_perf.marks['prospects+users-loaded'] || 0),
        'latest-activities-loaded (ms)': Math.round(_perf.marks['latest-activities-loaded'] || 0),
        'done (ms)': Math.round(_perf.marks['done'] || 0),
        'rows rendered': pageProspects.length,
        'total filtered': totalCount,
        'all prospects fetched': allProspects.length,
    });
};

const prospectPageNav = async (dir) => {
    // Estimate total to compute last page — use cached count from last render
    const paginationText = document.getElementById('prospects-pagination')?.textContent || '';
    const totalMatch = paginationText.match(/of (\d+)/);
    const total = totalMatch ? parseInt(totalMatch[1]) : 9999;
    const lastPage = Math.max(0, Math.ceil(total / _prospectPageSize) - 1);
    if (dir === 'first') _prospectPage = 0;
    else if (dir === 'prev') _prospectPage = Math.max(0, _prospectPage - 1);
    else if (dir === 'next') _prospectPage = Math.min(lastPage, _prospectPage + 1);
    else if (dir === 'last') _prospectPage = lastPage;
    await renderProspectsTable();
};

const deleteProspect = async (id) => {
    // Server-side gate: Supabase RLS restrictive policy
    // `prospects_delete_lead_only` rejects DELETEs from users with Level > 5.
    // The client-side check below is still a UX/defence-in-depth layer.
    const userLvlMatch = _currentUser?.role?.match(/Level\s+(\d+)/i);
    const userLevel = userLvlMatch ? parseInt(userLvlMatch[1]) : 99;
    if (userLevel > 5) {
        UI.toast.error('You do not have permission to delete prospects.');
        return;
    }
    UI.showModal('Delete Prospect', '<p>This will permanently delete this prospect and all linked activities, notes, and names. This cannot be undone. Continue?</p>', [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Delete', type: 'primary', action: `(async () => { await app.confirmDeleteProspect(${id}); })()` }
    ]);
};
const confirmDeleteProspect = async (id) => {
    // Re-check the role here too — the modal action runs through a global
    // callback and could theoretically be invoked directly.
    const userLvlMatch = _currentUser?.role?.match(/Level\s+(\d+)/i);
    const userLevel = userLvlMatch ? parseInt(userLvlMatch[1]) : 99;
    if (userLevel > 5) {
        UI.hideModal();
        UI.toast.error('You do not have permission to delete prospects.');
        return;
    }
    UI.hideModal();
    try {
        const [acts, allNotes, names, referrals] = await Promise.all([
            AppDataStore.query('activities', { prospect_id: id }).catch(() => []),
            AppDataStore.getAll('notes').catch(() => []),
            AppDataStore.query('names', { prospect_id: id }).catch(() => []),
            AppDataStore.query('referrals', { referred_prospect_id: id }).catch(() => []),
        ]);
        const notes = allNotes.filter(n =>
            String(n.prospect_id) === String(id) ||
            (n.entity_type === 'prospect' && String(n.entity_id) === String(id))
        );
        // Bulk-delete related records in parallel (was sequential — O(N) round trips)
        await Promise.all([
            acts.length ? AppDataStore.deleteMany('activities', acts.map(a => a.id)) : Promise.resolve(),
            notes.length ? AppDataStore.deleteMany('notes', notes.map(n => n.id)) : Promise.resolve(),
            names.length ? AppDataStore.deleteMany('names', names.map(n => n.id)) : Promise.resolve(),
            referrals.length ? AppDataStore.deleteMany('referrals', referrals.map(r => r.id)) : Promise.resolve(),
        ]);
        await AppDataStore.delete('prospects', id);
        UI.toast.success('Prospect deleted.');
        await app.renderProspectsTable();
    } catch (err) {
        UI.toast.error('Failed to delete: ' + (err.message || 'Unknown error'));
    }
};

const getScoreGrade = (score) => {
    if (!score) return 'D';
    if (score >= 800) return 'A+';
    if (score >= 600) return 'A';
    if (score >= 400) return 'B';
    if (score >= 200) return 'C';
    return 'D';
};

// Manual prospect grade picker. Agents set A–G manually from the prospect
// detail header badge. Stored in prospects.manual_grade (nullable TEXT).
const openProspectGradePicker = async (prospectId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) { UI.toast.error('Prospect not found'); return; }
    const currentUser = _currentUser || await Auth.getCurrentUser();
    const isAdmin = isSystemAdmin(currentUser) || isMarketingManager(currentUser) || currentUser.role?.includes('Level 3') || currentUser.role?.includes('Level 7') || currentUser.role === 'team_leader';
    const isOwner = prospect.responsible_agent_id == currentUser.id;
    if (!isAdmin && !isOwner) {
        UI.toast.error('You cannot set the grade for this prospect.');
        return;
    }
    const current = prospect.manual_grade || '';
    const grades = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const btn = (g) => {
        const active = g === current;
        return `<button type="button" onclick="(async () => { await app.setProspectGrade(${prospectId}, '${g}'); })()" style="padding:14px;font-weight:700;font-size:18px;border-radius:10px;border:2px solid ${active ? 'var(--primary)' : 'var(--gray-300)'};background:${active ? 'var(--primary)' : '#fff'};color:${active ? '#fff' : 'var(--gray-800)'};cursor:pointer;transition:all .15s;" onmouseover="if(!${active}){this.style.background='var(--gray-100)';this.style.borderColor='var(--gray-400)';}" onmouseout="if(!${active}){this.style.background='#fff';this.style.borderColor='var(--gray-300)';}">${g}</button>`;
    };
    const content = `
        <div style="padding:4px 0;">
            <p style="margin:0 0 14px;color:var(--gray-600);font-size:14px;">Select a grade for <strong>${prospect.full_name || 'this prospect'}</strong>.</p>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">
                ${grades.map(btn).join('')}
                <button type="button" onclick="(async () => { await app.setProspectGrade(${prospectId}, null); })()" style="padding:14px;font-weight:600;font-size:14px;border-radius:10px;border:2px solid var(--gray-300);background:#fff;color:var(--gray-500);cursor:pointer;" title="Clear grade">None</button>
            </div>
        </div>
    `;
    UI.showModal('Set Prospect Grade', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }
    ]);
};

const setProspectGrade = async (prospectId, grade) => {
    try {
        await AppDataStore.update('prospects', prospectId, { manual_grade: grade });
        UI.toast.success(grade ? `Grade set to ${grade}` : 'Grade cleared');
        UI.hideModal();
        await showProspectDetail(prospectId);
    } catch (err) {
        UI.toast.error('Failed to update grade: ' + (err.message || 'Unknown error'));
    }
};

const calculateProtectionDays = (prospect) => {
    if (!prospect.protection_deadline) return 0;
    const deadline = new Date(prospect.protection_deadline);
    const today = new Date();
    const diffTime = deadline - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
};

const getProtectionStatus = (days) => {
    if (days > 7) return 'normal';
    if (days > 0) return 'warning';
    return 'critical';
};

const calculateDaysLeft = (deadline) => {
    if (!deadline) return 0;
    const diff = new Date(deadline) - new Date();
    const d = Math.ceil(diff / 86400000);
    return d > 0 ? d : 0;
};

const timeAgo = (dateStr) => {
    if (!dateStr) return '—';
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const d = Math.floor(diffMs / 86400000);
    if (d < 0) return 'Today';
    if (d === 0) return 'Today';
    if (d === 1) return 'Yesterday';
    if (d < 7)  return `${d}d ago`;
    if (d < 30) return `${Math.floor(d / 7)}w ago`;
    if (d < 365) return `${Math.floor(d / 30)}mo ago`;
    return `${Math.floor(d / 365)}y ago`;
};
// Expose remaining utils after they're defined — all needed by script-features.js
Object.assign(window._crmUtils, {
    timeAgo, getScoreGrade, calculateProtectionDays, getProtectionStatus,
});

const _avatarColors = ['#ef4444','#f97316','#f59e0b','#10b981','#14b8a6','#3b82f6','#8b5cf6','#ec4899','#be185d','#0d9488'];
const getAvatarColor = (name) => {
    let h = 0;
    for (const c of (name || '?')) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
    return _avatarColors[h % _avatarColors.length];
};
const getInitials = (name) => {
    if (!name) return '?';
    return name.trim().split(/\s+/).map(w => w[0]?.toUpperCase() || '').slice(0, 2).join('');
};
Object.assign(window._crmUtils, { getAvatarColor, getInitials });

const toggleProspectView = (mode) => {
    _prospectViewMode = mode;
    const tableView = document.getElementById('prospects-table-view');
    const cardView  = document.getElementById('prospects-card-view');
    const btnTable  = document.getElementById('prospect-view-table');
    const btnCard   = document.getElementById('prospect-view-card');
    if (tableView) tableView.style.display = mode === 'table' ? '' : 'none';
    if (cardView)  cardView.style.display  = mode === 'card'  ? '' : 'none';
    if (btnTable) btnTable.classList.toggle('active', mode === 'table');
    if (btnCard)  btnCard.classList.toggle('active', mode === 'card');
    // Remove cached pagination so it re-attaches in the right container
    document.getElementById('prospects-pagination')?.remove();
    renderProspectsTable();
};

const renderProspectCards = (pageProspects, userById, canReassign, activeAgents) => {
    const container = document.getElementById('prospect-cards-container');
    if (!container) return;
    if (pageProspects.length === 0) {
        container.innerHTML = '<p style="text-align:center;padding:40px;color:var(--text-secondary);">No prospects found.</p>';
        return;
    }
    container.innerHTML = pageProspects.map(p => {
        const grade = getScoreGrade(p.score);
        const daysLeft = calculateProtectionDays(p);
        const protFillClass = daysLeft <= 0 ? 'expired' : getProtectionStatus(daysLeft);
        const daysClass = daysLeft <= 0 ? 'days-expired' : (daysLeft <= 7 ? 'days-critical' : (daysLeft <= 14 ? 'days-warning' : 'days-normal'));
        const daysLabel = daysLeft <= 0 ? 'Expired' : `${daysLeft}d left`;
        const agent = userById.get(String(p.responsible_agent_id));
        const agentName = agent ? agent.full_name : '—';
        const relTime = timeAgo(p.last_activity_date);
        const color = getAvatarColor(p.full_name);
        const initials = getInitials(p.full_name);
        const pct = Math.min(100, daysLeft <= 0 ? 100 : (daysLeft / 30) * 100);
        return `
            <div class="prospect-card${p.unable_to_serve ? ' row-unable' : ''}" onclick="app.showProspectDetail(${p.id})">
                <div class="prospect-card-header">
                    <div class="prospect-card-avatar" style="background:${color};">${initials}</div>
                    <div style="flex:1;min-width:0;">
                        <div class="prospect-card-name${p.unable_to_serve ? ' name-unable' : ''}">${escapeHtml(p.full_name || '(No Name)')}</div>
                        ${p.phone ? `<div class="prospect-card-phone">${escapeHtml(p.phone)}</div>` : ''}
                        ${p.unable_to_serve ? `<span class="badge-unable">Unable to Serve</span>` : ''}
                    </div>
                    <div class="prospect-card-score"><span class="score-badge score-${grade.replace('+','-plus')}">${p.score || 0} (${grade})</span></div>
                </div>
                <div class="prospect-card-row"><span>Ming Gua</span><span class="val">${p.ming_gua || '—'}</span></div>
                <div class="prospect-card-row"><span>Agent</span><span class="val">${escapeHtml(agentName)}</span></div>
                <div class="prospect-card-row"><span>Last Activity</span><span class="val">${p.last_activity_date ? relTime : '—'}</span></div>
                ${p.occupation || p.company_name ? `<div class="prospect-card-row"><span>Company</span><span class="val">${escapeHtml((p.occupation || '') + (p.company_name ? ' · ' + p.company_name : ''))}</span></div>` : ''}
                <div class="prospect-card-protection">
                    <div class="${daysClass}" style="font-size:12px;margin-bottom:4px;">${daysLabel}</div>
                    <div class="protection-bar" style="width:100%;"><div class="protection-fill ${protFillClass}" style="width:${pct}%"></div></div>
                </div>
            </div>`;
    }).join('');
};

const toggleProspectSelect = (id) => {
    if (_selectedProspects.has(id)) {
        _selectedProspects.delete(id);
    } else {
        _selectedProspects.add(id);
    }
    updateProspectBulkBar();
};

const toggleProspectSelectAll = () => {
    const master = document.getElementById('prospect-select-all');
    const checked = master?.checked;
    document.querySelectorAll('#prospects-table-body input[type="checkbox"]').forEach(cb => {
        const idAttr = cb.dataset.pid;
        if (!idAttr) return;
        const id = parseInt(idAttr, 10);
        cb.checked = !!checked;
        if (checked) _selectedProspects.add(id);
        else _selectedProspects.delete(id);
    });
    updateProspectBulkBar();
};

const updateProspectBulkBar = () => {
    const bar = document.getElementById('prospect-bulk-bar');
    const countEl = document.getElementById('prospect-bulk-count');
    if (!bar) return;
    const n = _selectedProspects.size;
    bar.style.display = n > 0 ? 'flex' : 'none';
    if (countEl) countEl.textContent = n;
    const delBtn = document.getElementById('prospect-bulk-delete-btn');
    if (delBtn) {
        const lvl = _getUserLevel(_currentUser);
        delBtn.style.display = lvl <= 5 ? '' : 'none';
    }
};

const clearProspectSelection = () => {
    _selectedProspects.clear();
    document.querySelectorAll('#prospects-table-body input[type="checkbox"]').forEach(cb => cb.checked = false);
    const master = document.getElementById('prospect-select-all');
    if (master) master.checked = false;
    updateProspectBulkBar();
};

const bulkDeleteProspects = async () => {
    const lvl = _getUserLevel(_currentUser);
    if (lvl > 5) { UI.toast.error('You do not have permission to delete prospects.'); return; }
    const n = _selectedProspects.size;
    if (!n) return;
    if (!confirm(`Delete ${n} selected prospect${n > 1 ? 's' : ''}? This cannot be undone.`)) return;
    let errors = 0;
    for (const id of _selectedProspects) {
        try { await AppDataStore.delete('prospects', id); }
        catch { errors++; }
    }
    _selectedProspects.clear();
    if (errors) UI.toast.error(`${errors} prospect${errors > 1 ? 's' : ''} could not be deleted.`);
    else UI.toast.success(`${n} prospect${n > 1 ? 's' : ''} deleted.`);
    await renderProspectsTable();
};

const bulkReassignProspects = async () => {
    const n = _selectedProspects.size;
    if (!n) return;
    const [allUsers, allCustomers] = await Promise.all([
        AppDataStore.getAll('users'),
        AppDataStore.getAll('customers')
    ]);
    const agents = allUsers.filter(u => { const lvl = _getUserLevel(u); return lvl >= 3 && lvl <= 11 && u.status !== 'deleted'; })
        .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
    const selectedIds = Array.from(_selectedProspects).map(String);
    const linkedCount = (allCustomers || []).filter(c => selectedIds.includes(String(c.converted_from_prospect_id))).length;
    const content = `
        <div style="padding:4px 0 8px;">
            <p style="margin-bottom:12px;color:var(--text-secondary);">Reassigning <strong>${n}</strong> prospect${n > 1 ? 's' : ''} to:</p>
            <select id="bulk-reassign-agent" class="form-control">
                <option value="">— Select agent —</option>
                ${agents.map(a => `<option value="${a.id}">${escapeHtml(a.full_name || 'Agent')}</option>`).join('')}
            </select>
            <div style="margin-top:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;">
                <label style="font-weight:600;display:block;margin-bottom:8px;font-size:13px;">What else should follow the new agent?</label>
                <label class="checkbox-label" style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;">
                    <input type="checkbox" id="bulk-cascade-customer" checked style="margin-top:3px;">
                    <span>
                        <strong>Transfer linked customer records</strong> ${linkedCount > 0 ? `(${linkedCount} converted customer${linkedCount > 1 ? 's' : ''} linked)` : '(none of the selected prospects are converted)'}
                        <div style="font-size:11px;color:#475569;margin-top:2px;">Recommended — keeps prospect ownership and customer commission aligned.</div>
                    </span>
                </label>
                <label class="checkbox-label" style="display:flex;align-items:flex-start;gap:8px;">
                    <input type="checkbox" id="bulk-cascade-activities" style="margin-top:3px;">
                    <span>
                        <strong>Transfer activity credit</strong>
                        <div style="font-size:11px;color:#92400e;margin-top:2px;">⚠️ Off by default — flipping this rewrites who gets KPI credit for past CPS / calls / visits. Only enable when correcting a wrong-assignment.</div>
                        <div style="margin-top:6px;display:flex;align-items:center;gap:6px;font-size:12px;">
                            <span style="color:#475569;">From date:</span>
                            <input type="date" id="bulk-cascade-activities-from" class="form-control" style="font-size:12px;padding:2px 6px;width:auto;" value="${new Date(Date.now() - 365*24*60*60*1000).toISOString().split('T')[0]}">
                        </div>
                    </span>
                </label>
            </div>
        </div>`;
    UI.showModal('Bulk Reassign', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Reassign', type: 'primary', action: '(async () => { await app.confirmBulkReassign(); })()' }
    ]);
};

const confirmBulkReassign = async () => {
    const agentId = parseInt(document.getElementById('bulk-reassign-agent')?.value);
    if (!agentId) { UI.toast.error('Please select an agent.'); return; }
    const cascadeCustomer = document.getElementById('bulk-cascade-customer')?.checked ?? true;
    const cascadeActivitiesChecked = document.getElementById('bulk-cascade-activities')?.checked ?? false;
    const cascadeFromDate = document.getElementById('bulk-cascade-activities-from')?.value || null;

    const selectedIds = Array.from(_selectedProspects);
    const [allUsers, allCustomers] = await Promise.all([
        AppDataStore.getAll('users'),
        AppDataStore.getAll('customers')
    ]);
    const toAgentName = ((allUsers || []).find(u => String(u.id) === String(agentId))?.full_name)
        || `Agent #${agentId}`;
    const selectedSet = new Set(selectedIds.map(String));
    const linkedCount = (allCustomers || []).filter(c =>
        selectedSet.has(String(c.converted_from_prospect_id))).length;

    _state._pendingReassign = {
        kind: 'bulkProspects',
        agentId,
        cascadeCustomer,
        cascadeActivitiesAfter: cascadeActivitiesChecked ? cascadeFromDate : null,
        selectedIds
    };

    const summaryHtml = _renderReassignSummary({
        kind: 'bulk',
        toAgentName,
        bulkCount: selectedIds.length,
        bulkLinkedCustomers: linkedCount,
        bulkCustomerCascadeEnabled: cascadeCustomer,
        bulkActivityCascadeEnabled: cascadeActivitiesChecked
    });
    _showReassignConfirmPopup('Confirm Bulk Reassignment', summaryHtml, 'executeConfirmedBulkReassign');
};

const executeConfirmedBulkReassign = async () => {
    const p = _state._pendingReassign;
    if (!p || p.kind !== 'bulkProspects') return;
    _state._pendingReassign = null;
    UI.hideModal();
    let errors = 0, totalCust = 0, totalActs = 0;
    for (const id of p.selectedIds) {
        try {
            const result = await cascadeProspectReassign(id, p.agentId, {
                reason: 'bulk_reassignment',
                reasonNotes: 'Bulk reassign from prospects table',
                cascadeCustomer: p.cascadeCustomer,
                cascadeActivitiesAfter: p.cascadeActivitiesAfter
            });
            totalCust += result.customersCascaded || 0;
            totalActs += result.activitiesCascaded || 0;
        } catch { errors++; }
    }
    _selectedProspects.clear();
    if (errors) {
        UI.toast.error(`${errors} could not be reassigned.`);
    } else {
        const bits = [];
        if (totalCust) bits.push(`${totalCust} customer record${totalCust > 1 ? 's' : ''}`);
        if (totalActs) bits.push(`${totalActs} activit${totalActs > 1 ? 'ies' : 'y'}`);
        UI.toast.success(bits.length
            ? `Prospects reassigned (also transferred: ${bits.join(', ')})`
            : 'Prospects reassigned.');
    }
    await renderProspectsTable();
};

const toggleProspectFilters = (btn) => {
    const panel = document.getElementById('prospect-adv-filters');
    if (!panel) return;
    const open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'block';
    btn.innerHTML = open
        ? '<i class="fas fa-sliders-h"></i> Filters'
        : '<i class="fas fa-sliders-h"></i> Filters <i class="fas fa-chevron-up"></i>';
    updateProspectFilterBadge();
};

const updateProspectFilterBadge = () => {
    const btn = document.getElementById('prospect-filter-btn');
    if (!btn) return;
    const score  = document.getElementById('filter-score')?.value || '';
    const gua    = document.getElementById('filter-gua')?.value || '';
    const status = document.getElementById('filter-status')?.value || '';
    const agent  = document.getElementById('filter-agent')?.value || '';
    const count  = [score, gua, status, agent].filter(Boolean).length;
    const existing = btn.querySelector('.filter-count-badge');
    if (existing) existing.remove();
    if (count > 0) {
        btn.insertAdjacentHTML('beforeend', `<span class="filter-count-badge">${count}</span>`);
    }
};

const sortProspectsBySelect = async (val) => {
    const [field, dir] = val.split('_');
    _sortField = field;
    _sortDirection = dir;
    _prospectPage = 0;
    await renderProspectsTable();
};

const openProspectModal = async (prospectId = null) => {
    const prospect = prospectId ? await AppDataStore.getById('prospects', prospectId) : null;
    if (prospectId) {
        if (!prospect) {
            UI.toast.error('Prospect not found.');
            return;
        }
        const currentUser = _currentUser || await Auth.getCurrentUser();
        const isAdmin = isSystemAdmin(currentUser) || isMarketingManager(currentUser) || currentUser.role?.includes('Level 3') || currentUser.role?.includes('Level 7') || currentUser.role === 'team_leader';
        const isOwner = String(prospect.responsible_agent_id) === String(currentUser.id);
        if (!isAdmin && !isOwner) {
            UI.toast.error('You cannot edit this prospect.');
            return;
        }
    }
    _state.sprr = prospect?.referred_by ? { name: prospect.referred_by, id: prospect.referred_by_id || null, type: prospect.referred_by_type || null } : null;
    const allUsers = await AppDataStore.getAll('users');
    const isEdit = !!prospect;

    const content = `
        <div class="prospect-form">
            <input type="hidden" id="edit-prospect-id" value="${prospectId || ''}">
            <div class="form-section">
                <h4>Basic Information</h4>
                ${(window.app.buildBasicInfoBlock || (() => ''))('prospect', prospect)}
            </div>
        </div>
    `;

    UI.showModal(isEdit ? 'Edit Prospect' : 'Add New Prospect', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: isEdit ? 'Update Prospect' : 'Create Prospect', type: 'primary', action: '(async () => { await app.saveProspect(); })()' }
    ]);

    // Pre-populate children rows after modal mounts
    setTimeout(() => (window.app.prefillProspectChildren || (() => {}))(prospect?.children), 0);
};


const showFieldError = (fieldId, message) => {
    const field = document.getElementById(fieldId);
    if (field) {
        field.classList.add('error');
        const errorDiv = document.createElement('div');
        errorDiv.className = 'validation-error';
        errorDiv.textContent = message;
        field.parentNode.appendChild(errorDiv);
    }
};

const saveProspect = async () => {
    const editId = document.getElementById('edit-prospect-id')?.value;
    const name = document.getElementById('prospect-name')?.value?.trim();
    const phone = document.getElementById('prospect-phone')?.value?.trim();
    const email = document.getElementById('prospect-email')?.value?.trim();

    // Clear previous validation errors
    document.querySelectorAll('.validation-error').forEach(el => el.remove());
    document.querySelectorAll('.form-control.error').forEach(el => el.classList.remove('error'));

    let hasError = false;

    if (!name) {
        await showFieldError('prospect-name', 'Name is required');
        hasError = true;
    }

    if (!phone) {
        await showFieldError('prospect-phone', 'Phone is required');
        hasError = true;
    } else if (!/^[0-9\+\-\s]{8,}$/.test(phone)) {
        await showFieldError('prospect-phone', 'Enter a valid phone number (min 8 digits)');
        hasError = true;
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        await showFieldError('prospect-email', 'Invalid email format');
        hasError = true;
    }

    if (hasError) {
        UI.toast.error('Please fill in the required fields');
        document.querySelector('.form-control.error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    // Duplicate detection (scale-safe):
    // - Use indexed phone / IC lookups (idx_prospects_phone, and the
    //   existing light-select includes ic_number). At 100K+ prospects the
    //   old getAll('prospects') approach downloaded the whole table on
    //   every save; these targeted queries return ≤5 rows.
    // - HARD BLOCK: same name + (same IC OR same phone) — this is an
    //   unambiguous duplicate-entry mistake.
    // - SOFT WARN (confirm dialog): phone reused by a DIFFERENT person.
    //   Real-world: family members often share a phone (e.g. the BA DB
    //   has Kueh Mok Yong + Kueh Sheau Yan at 0197285828). Agents can
    //   proceed deliberately, but the warning prevents unintended dupes.
    if (!editId) {
        const ic = document.getElementById('prospect-ic')?.value?.trim();
        const normalize = str => str ? str.toLowerCase().replace(/\s+/g, '') : '';
        const normName = normalize(name);

        // Parallel, bounded lookups: 6× limit-5 queries against indexed
        // columns (idx_prospects_phone, idx_prospects_ic_number,
        // idx_prospects_email + customer twins). Returns in <50 ms even
        // on a 1M-row table.
        const [
            prospectPhoneMatches, customerPhoneMatches,
            prospectIcMatches, customerIcMatches,
            prospectEmailMatches, customerEmailMatches,
        ] = await Promise.all([
            phone ? AppDataStore.queryAdvanced('prospects', { filters: { phone }, limit: 5, countMode: null }).then(r => r.data) : [],
            phone ? AppDataStore.queryAdvanced('customers', { filters: { phone }, limit: 5, countMode: null }).then(r => r.data) : [],
            ic ? AppDataStore.queryAdvanced('prospects', { filters: { ic_number: ic }, limit: 5, countMode: null }).then(r => r.data) : [],
            ic ? AppDataStore.queryAdvanced('customers', { filters: { ic_number: ic }, limit: 5, countMode: null }).then(r => r.data) : [],
            email ? AppDataStore.queryAdvanced('prospects', { filters: { email }, limit: 5, countMode: null }).then(r => r.data) : [],
            email ? AppDataStore.queryAdvanced('customers', { filters: { email }, limit: 5, countMode: null }).then(r => r.data) : [],
        ]);

        const phoneMatches = [...(prospectPhoneMatches || []), ...(customerPhoneMatches || [])];
        const icMatches = [...(prospectIcMatches || []), ...(customerIcMatches || [])];
        const emailMatches = [...(prospectEmailMatches || []), ...(customerEmailMatches || [])];

        // Hard block: same name + same phone, or same name + same IC.
        const hardDup = [...phoneMatches, ...icMatches].find(p => normalize(p.full_name) === normName);
        if (hardDup) {
            const isCustomer = [...customerPhoneMatches, ...customerIcMatches].some(c => c.id === hardDup.id);
            const matchedOn = (ic && hardDup.ic_number && normalize(hardDup.ic_number) === normalize(ic)) ? 'IC number' : 'phone number';
            UI.toast.error(`Duplicate detected: "${hardDup.full_name}" already exists as a ${isCustomer ? 'Customer' : 'Prospect'} with the same name and ${matchedOn}.`);
            return;
        }

        // Hard block: phone reused by a DIFFERENT person. Every phone in
        // prospects.phone is enforced unique at the DB level (see
        // migrations/phone_unique_constraint.sql — idx_prospects_phone_unique,
        // partial WHERE phone IS NOT NULL AND phone <> ''). Prior to that
        // migration this was a soft confirm() warn; now the insert would
        // fail with a 23505 from PostgREST, so we reject client-side with
        // a clearer message and point the agent at the fix.
        //
        // Family / shared-household: the primary holder keeps the number,
        // others leave phone blank (NULL is allowed to repeat) or enter a
        // different mobile. Use the Data Quality → Phone Duplicates review
        // (Settings page) to see who already owns a given number.
        const phoneSharedWith = phoneMatches.filter(p => normalize(p.full_name) !== normName);
        if (phoneSharedWith.length > 0) {
            const names = phoneSharedWith.slice(0, 3).map(p => p.full_name || '(unnamed)').join(', ');
            const more = phoneSharedWith.length > 3 ? ` and ${phoneSharedWith.length - 3} more` : '';
            UI.toast.error(
                `Phone ${phone} already used by ${names}${more}. ` +
                `Use a different number, leave it blank, or ask admin to clear the other record.`
            );
            await showFieldError('prospect-phone', `Already used by ${names}${more}`);
            return;
        }

        // Soft warn: email reused by a DIFFERENT person. Unlike phone,
        // there's no hard unique index on email because ~3 legitimate
        // couples in the existing DB share an address (e.g. spouses
        // sharing one gmail). Let the agent confirm rather than block.
        const emailSharedWith = emailMatches.filter(p =>
            normalize(p.full_name) !== normName
            && (p.email || '').toLowerCase() === email.toLowerCase()
        );
        if (email && emailSharedWith.length > 0) {
            const names = emailSharedWith.slice(0, 3).map(p => p.full_name || '(unnamed)').join(', ');
            const more = emailSharedWith.length > 3 ? ` and ${emailSharedWith.length - 3} more` : '';
            const ok = confirm(
                `Email ${email} is already used by ${names}${more}.\n\n` +
                `This is OK for couples/families sharing an inbox. Click OK to continue, Cancel to review.`
            );
            if (!ok) return;
        }
    }

    // Validate compulsory referral fields (create only — edits keep the existing referrer)
    if (!editId && !_state.sprr) {
        UI.toast.error('Referred By is required. Please search and select a referrer.');
        return;
    }
    const relationship = document.getElementById('prospect-relationship')?.value;
    if (!editId && !relationship) {
        UI.toast.error('Relationship is required.');
        return;
    }
    // All Basic Info fields pulled via the shared collector — keeps
    // CPS + Prospect forms in lockstep. Prospect-specific metadata
    // (responsible_agent_id, referred_by_*, pipeline_stage, score) below.
    const basic = (window.app.collectBasicInfoData || (() => ({})))('prospect');
    const data = {
        ...basic,
        full_name: name, // validated above
        phone: phone,    // validated above
        referred_by: _state.sprr?.name || null,
        referred_by_id: _state.sprr?.id || null,
        referred_by_type: _state.sprr?.type || null,
        // responsible_agent_id / cps_assignment_date / pipeline_stage are create-only fields.
        // They are added below in the `else` branch so edits never overwrite the original agent.
        score: editId ? undefined : 200,
        expected_close_date: editId ? undefined : null,
        deal_value: editId ? undefined : 0,
    };

    // Capture snapshot before update for approval queue
    let snapshotBefore = null;
    if (editId) {
        snapshotBefore = await AppDataStore.getById('prospects', parseInt(editId));
    }

    try {
        if (editId) {
            await AppDataStore.update('prospects', parseInt(editId), data);
            UI.toast.success('Prospect updated successfully');

            // Create approval entry for non-manager edits — but ONLY when the
            // prospect has been converted to a customer. Pure prospects can be
            // edited freely; the approval queue exists to protect customer data,
            // not to gate every agent's edit on a prospect that isn't even a
            // customer yet. (Without this guard the super admin's queue gets
            // flooded with meaningless "Info Update" entries.)
            const isManager = isSystemAdmin(_currentUser) || isMarketingManager(_currentUser);
            const isConverted = snapshotBefore?.status === 'converted';
            if (!isManager && isConverted) {
                try {
                    await AppDataStore.create('approval_queue', {
                        id: Date.now(),
                        approval_type: 'info_update',
                        status: 'pending',
                        prospect_id: parseInt(editId),
                        customer_id: null,
                        submitted_by: _currentUser?.id,
                        submitted_at: new Date().toISOString(),
                        snapshot_before: snapshotBefore,
                        snapshot_after: data,
                        description: `Information update for ${name}`
                    });
                } catch (e) { /* approval queue write failed silently */ }
            }
        } else {
            data.id = Date.now();
            data.protection_deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            data.score = SCORING_RULES.CREATE_PROSPECT;
            // Create-only fields — never overwritten on edit so the original agent keeps ownership
            data.responsible_agent_id = _currentUser?.id || null;
            data.cps_assignment_date  = new Date().toISOString().split('T')[0];
            data.pipeline_stage       = 'new';
            data.created_at = new Date().toISOString();
            const newProspect = await AppDataStore.create('prospects', data);
            UI.toast.success('Prospect created successfully');
            document.dispatchEvent(new CustomEvent('prospectCreated', { detail: data }));
            // Silent upload of CPS form photo if one was scanned this session.
            // Fire-and-forget — does not block the save flow.
            // Access via _appState bridge (cppf) — _cpsPendingPhotoFiles lives in the main IIFE.
            const _cppf = (window._appState && window._appState.cppf) || {};
            if (_cppf.prospect) {
                const _pendingScanFile = _cppf.prospect;
                delete _cppf.prospect;
                const prospectId = newProspect?.id || data.id;
                _uploadCpsFormFile(_pendingScanFile, prospectId).catch(() => {});
            }
            // Trigger new_prospect workflow
            try { await executeWorkflows('new_prospect', { name: data.full_name }); } catch (e) { /* ignore */ }
        }
    } catch (err) {
        UI.toast.error('Save failed: ' + (err.message || 'Unknown error'));
        return;
    }

    UI.hideModal();
    await renderProspectsTable();
    if (editId) await showProspectDetail(parseInt(editId));
};


const filterProspects = async () => {
    _prospectPage = 0;
    updateProspectFilterBadge();
    await renderProspectsTable();
};

const showCustomerDetail = async (customerId) => {
    const customer = await AppDataStore.getById('customers', customerId);
    if (!customer || !await canViewCustomer(customer)) {
        UI.toast.error('You do not have permission to view this customer.');
        await navigateTo('prospects');
        return;
    }
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
                <button class="btn secondary btn-sm" onclick="app.navigateTo('prospects')">
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
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:6px 0 4px;">
                        <span style="font-size:22px;font-weight:700;line-height:1.3;flex-shrink:0;">${customer.full_name}</span>
                        ${(isSystemAdmin(_currentUser) || isMarketingManager(_currentUser)) ? iconBtn('Edit', 'fas fa-edit', `app.openProspectModal(${customer.id})`) : ''}
                        ${iconBtn('Add Purchase', 'fas fa-plus', `app.openAddPurchaseModal(${customer.id})`)}
                        ${iconBtn('Refer a Friend', 'fas fa-user-plus', `app.openCustomerReferralModal(${customer.id})`)}
                        ${iconBtn('WhatsApp', 'fab fa-whatsapp', `app.openSendWhatsAppModal('customer',${customer.id})`, {color:'#25d366'})}
                        ${iconBtn('Portal Link', 'fas fa-external-link-alt', `app.sendPortalLink(${customer.id})`)}
                        ${iconBtn('Recruit as Agent', 'fas fa-user-tie', `app.openRecruitModal(${customer.id})`, {bg:'#6b21a8',color:'#fff',border:'none'})}
                    </div>
                    <div style="font-size:12px;color:var(--gray-500);margin-top:2px;">
                        Customer since ${customer.customer_since || '-'} · Converted at RM ${customer.conversion_amount?.toLocaleString() || '2,200'}
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
                html += `<tr><td>${event?.title || 'Unknown'}</td><td>${r.event_date || '-'}</td><td>${r.attendance_status}</td><td>${r.points_awarded || 0}</td></tr>`;
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
            <div class="pv-row"><span class="pv-lbl">Full Name</span><span class="pv-val"><strong>${customer.full_name}</strong></span></div>
            <div class="pv-row"><span class="pv-lbl">Phone</span><span class="pv-val">${customer.phone || '-'} ${customer.phone ? '<button class="btn-icon" style="margin-left:4px;"><i class="fas fa-phone"></i></button>' : ''}</span></div>
            <div class="pv-row"><span class="pv-lbl">Email</span><span class="pv-val">${customer.email || '-'} ${customer.email ? '<button class="btn-icon" style="margin-left:4px;"><i class="fas fa-envelope"></i></button>' : ''}</span></div>
            <div class="pv-sub">Identity</div>
            <div class="pv-row"><span class="pv-lbl">IC Number</span><span class="pv-val">${customer.ic_number || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Date of Birth</span><span class="pv-val">${customer.date_of_birth || '-'}${customer.date_of_birth ? ` (Age ${Math.floor((Date.now() - new Date(customer.date_of_birth).getTime()) / 31557600000)})` : ''}</span></div>
            <div class="pv-row"><span class="pv-lbl">Ming Gua</span><span class="pv-val"><span style="color:#6b21a8;font-weight:600;">${customer.ming_gua || '-'}${customer.element ? ' (' + customer.element + ')' : ''}</span></span></div>
            <div class="pv-row"><span class="pv-lbl">Gender</span><span class="pv-val">${customer.gender || '-'}</span></div>
            <div class="pv-sub">Employment</div>
            <div class="pv-row"><span class="pv-lbl">Occupation</span><span class="pv-val">${customer.occupation || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Company</span><span class="pv-val">${customer.company_name || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Income</span><span class="pv-val">${customer.income_range || '-'}</span></div>
            <div class="pv-sub">Address</div>
            <div class="pv-row"><span class="pv-lbl">Address</span><span class="pv-val">${[customer.address, customer.city, customer.state, customer.postal_code].filter(Boolean).join(', ') || '-'}</span></div>
            <div class="pv-sub">Referral Information</div>
            <div class="pv-row"><span class="pv-lbl">Referred By</span><span class="pv-val">${customer.referred_by || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Relationship</span><span class="pv-val">${customer.referral_relationship || '-'}</span></div>
        `;
        const cfDisplay = await (window.app.renderCustomFieldDisplay || (() => ''))('customer', customer.id);
        if (cfDisplay) container.insertAdjacentHTML('beforeend', cfDisplay);
    }
    else if (tab === 'bank') {
        container.innerHTML = `
            <div class="pv-sub">Bank &amp; Payment</div>
            <div class="pv-row"><span class="pv-lbl">Bank Name</span><span class="pv-val">${customer.bank_name || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Account Number</span><span class="pv-val">${customer.account_number ? customer.account_number.replace(/^(\d{4}).*(\d{4})$/, '$1-****-$2') : '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Account Holder</span><span class="pv-val">${customer.account_holder || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Payment Method</span><span class="pv-val">${customer.payment_methods || '-'}</span></div>
            <div class="pv-sub">Customer Metrics</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px;">
                <div style="background:var(--gray-50);padding:12px;border-radius:8px;text-align:center;">
                    <div style="font-size:12px;color:var(--gray-500);">Lifetime Value</div>
                    <div style="font-size:18px;font-weight:700;color:var(--primary);">RM ${(customer.lifetime_value || 0).toLocaleString()}</div>
                </div>
                <div style="background:var(--gray-50);padding:12px;border-radius:8px;text-align:center;">
                    <div style="font-size:12px;color:var(--gray-500);">Total Purchases</div>
                    <div style="font-size:18px;font-weight:700;color:var(--primary);">${customer.total_purchases || 0}</div>
                </div>
                <div style="background:var(--gray-50);padding:12px;border-radius:8px;text-align:center;">
                    <div style="font-size:12px;color:var(--gray-500);">Avg Order Value</div>
                    <div style="font-size:18px;font-weight:700;color:var(--primary);">RM ${customer.total_purchases ? Math.round((customer.lifetime_value || 0) / customer.total_purchases).toLocaleString() : '0'}</div>
                </div>
                <div style="background:var(--gray-50);padding:12px;border-radius:8px;text-align:center;">
                    <div style="font-size:12px;color:var(--gray-500);">Last Purchase</div>
                    <div style="font-size:14px;font-weight:600;">${customer.last_purchase_date || '-'}</div>
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
                rows += `<div class="pv-row"><span class="pv-lbl">${r.event_date || '-'}</span><span class="pv-val" style="display:flex;justify-content:space-between;">${event?.title || 'Unknown'} <span style="color:var(--success);font-weight:600;flex-shrink:0;">+${pts} pts</span></span></div>`;
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
        container.innerHTML = `
            <div style="text-align:center;padding:8px 0;">
                <div style="font-size:13px;color:#6b21a8;margin-bottom:8px;">Current Status: <strong>Not an Agent</strong></div>
                <div style="font-size:12px;color:#7e22ce;margin-bottom:12px;">To become agent: Purchase Agent Package (min RM 3,000)</div>
                <div style="display:inline-flex;flex-direction:column;align-items:center;gap:6px;margin-bottom:12px;">
                    <div style="width:64px;height:64px;border-radius:50%;background:#f3e8ff;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:#6b21a8;">85%</div>
                    <div style="font-size:13px;font-weight:600;color:#6b21a8;">Good candidate</div>
                </div>
                <div style="font-size:12px;color:#7e22ce;font-style:italic;margin-bottom:12px;">
                    Recommendations: Active participant, makes referrals, good purchase history.
                </div>
                <button class="btn primary" style="width:100%;background:#6b21a8;border:none;" onclick="app.openRecruitModal(${customer.id})">Offer Agent Package</button>
            </div>
        `;
    }
    else if (tab === 'contracts') {
        await (window.app.renderCustomerContractsTab || (() => {}))(customer, container.id);
    }
    else if (tab === 'closing') {
        await renderCustomerClosingTab(customer, container);
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
                        <span style="font-size:12px;color:var(--gray-500);">${n.date} - ${n.author}${n.is_voice_note ? ' <i class="fas fa-microphone voice-note-icon" title="Voice note"></i>' : ''}</span>
                        <button class="btn-icon" onclick="app.deleteCustomerNote(${customer.id}, ${n.id})"><i class="fas fa-trash"></i></button>
                    </div>
                    <div style="font-size:13px;color:var(--gray-700);">${n.text}</div>
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
                return tag ? `<span class="score-badge" style="background:${tag.color || 'var(--primary)'};color:white;display:flex;align-items:center;gap:4px;font-size:11px;">${tag.name} <span style="cursor:pointer;" onclick="app.removeTagFromCustomer(${customer.id},${tag.id})">&times;</span></span>` : '';
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
    container.innerHTML = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:32px;">
            <div>
                <h4 style="font-size:16px; font-weight:600; margin-bottom:16px; color:var(--primary);">Customer Information</h4>
                <div style="display:flex; flex-direction:column; gap:12px;">
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Full Name:</span> <strong>${customer.full_name}</strong></div>
                    <div style="display:flex; justify-content:space-between;">
                        <span style="color:var(--gray-500);">Phone:</span> 
                        <span>${customer.phone} <button class="btn-icon"><i class="fas fa-phone"></i></button></span>
                    </div>
                    <div style="display:flex; justify-content:space-between;">
                        <span style="color:var(--gray-500);">Email:</span> 
                        <span>${customer.email} <button class="btn-icon"><i class="fas fa-envelope"></i></button></span>
                    </div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">IC Number:</span> <span>${customer.ic_number}</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Date of Birth:</span> <span>${customer.date_of_birth} (Age 44)</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Ming Gua:</span> <span style="color:#6b21a8; font-weight:600;">${customer.ming_gua} (${customer.element})</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Gender:</span> <span>${customer.gender}</span></div>
                    <hr style="border:none; border-top:1px solid var(--gray-100); margin:8px 0;">
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Occupation:</span> <span>${customer.occupation || '-'}</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Company:</span> <span>${customer.company_name || '-'}</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Income:</span> <span>${customer.income_range || '-'}</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Address:</span> <span style="text-align:right;">${customer.address || '-'} ${customer.city || ''} ${customer.state || ''} ${customer.postal_code || ''}</span></div>
                </div>

                <h4 style="font-size:16px; font-weight:600; margin-top:24px; margin-bottom:16px; color:var(--primary);">Referral Information</h4>
                <div style="display:flex; flex-direction:column; gap:12px;">
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Referred By:</span> <a href="#" style="color:var(--primary); text-decoration:none;">Tan Ah Kow</a></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Relationship:</span> <span>Friend</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Referral Date:</span> <span>15 Feb 2026</span></div>
                </div>
            </div>

            <div>
                <h4 style="font-size:16px; font-weight:600; margin-bottom:16px; color:var(--primary);">Bank and Payment Information</h4>
                <div style="display:flex; flex-direction:column; gap:12px; background:var(--gray-50); padding:16px; border-radius:8px;">
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Bank Name:</span> <strong>${customer.bank_name}</strong></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Account Number:</span> <span>5123-****-8901</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Account Holder:</span> <span>${customer.account_holder}</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Payment Method:</span> <span>${customer.payment_methods}</span></div>
                </div>

                <h4 style="font-size:16px; font-weight:600; margin-top:24px; margin-bottom:16px; color:var(--primary);">Customer Metrics</h4>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div style="background:var(--gray-50); padding:12px; border-radius:8px; text-align:center;">
                        <div style="font-size:12px; color:var(--gray-500);">Lifetime Value</div>
                        <div style="font-size:18px; font-weight:700; color:var(--primary);">RM ${(customer.lifetime_value || 0).toLocaleString()}</div>
                    </div>
                    <div style="background:var(--gray-50); padding:12px; border-radius:8px; text-align:center;">
                        <div style="font-size:12px; color:var(--gray-500);">Total Purchases</div>
                        <div style="font-size:18px; font-weight:700; color:var(--primary);">4</div>
                    </div>
                    <div style="background:var(--gray-50); padding:12px; border-radius:8px; text-align:center;">
                        <div style="font-size:12px; color:var(--gray-500);">Avg Order Value</div>
                        <div style="font-size:18px; font-weight:700; color:var(--primary);">RM 788</div>
                    </div>
                    <div style="background:var(--gray-50); padding:12px; border-radius:8px; text-align:center;">
                        <div style="font-size:12px; color:var(--gray-500);">Last Purchase</div>
                        <div style="font-size:14px; font-weight:600;">04 Mar 2026</div>
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
                        <span class="platform-label">${p.platform} ID</span>
                        <span class="platform-value">${p.platform_id} <button class="copy-btn" onclick="app.copyToClipboard('${p.platform_id}')"><i class="fas fa-copy"></i></button></span>
                    </div>
                `).join('')}
            </div>
            <div class="platform-card">
                <h4>External Platforms</h4>
                ${external.map(p => `
                    <div class="platform-row">
                        <span class="platform-label">${p.platform} ID</span>
                        <span class="platform-value">${p.platform_id} <button class="copy-btn" onclick="app.copyToClipboard('${p.platform_id}')"><i class="fas fa-copy"></i></button></span>
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
        uploaded_by: _currentUser?.id
    });
    UI.hideModal();
    UI.toast.success('Document saved.');
};

const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
        UI.toast.success('Copied!');
    });
};

const renderPurchaseHistoryTab = async (customer, containerId = 'profile-tab-content') => {
    const purchases = await AppDataStore.query('purchases', { customer_id: customer.id });
    const container = document.getElementById(containerId);

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
                <td>${cr.closing_date || customer.customer_since || '-'}</td>
                <td>${cr.invoice_number || '-'}</td>
                <td><strong>${cr.product || '-'}</strong> <span style="font-size:11px;color:var(--gray-400);">(Conversion Sale)</span></td>
                <td>RM ${amt.toLocaleString()}</td>
                <td><span class="score-badge" style="font-size:11px;background:#dcfce7;color:#166534;">PAID</span></td>
                <td>${cr.invoice_file ? `<a href="${cr.invoice_file}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);">View</a>` : '-'}</td>
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
        if (p.status !== 'PENDING') totalPaid += p.amount;
        else totalPending += p.amount;

        const badgeClass = `badge-${p.status.toLowerCase().replace('/', '')}`;
        return `
                        <tr>
                            <td>${p.date}</td>
                            <td>${p.invoice}</td>
                            <td>${p.item}</td>
                            <td>RM ${p.amount.toLocaleString()}</td>
                            <td><span class="score-badge ${badgeClass}" style="font-size:11px;">${p.status}</span></td>
                            <td>${p.proof ? `<a href="#" style="color:var(--primary);">${p.proof.endsWith('.pdf') ? 'View Report' : 'View Image'}</a>` : `<button class="btn-sm secondary" onclick="app.uploadPaymentProof(${p.id}, ${customer.id})">Upload Image</button>`}</td>
                            <td>
                                <button class="btn-icon"><i class="fas fa-download"></i></button>
                                ${p.status === 'PENDING' ? '<button class="btn-icon"><i class="fas fa-edit"></i></button><button class="btn-icon"><i class="fas fa-trash"></i></button>' : ''}
                            </td>
                        </tr>
                    `;
    }).join('')}
                ${!cr && purchases.length === 0 ? '<tr><td colspan="7" style="text-align:center;color:var(--gray-400);padding:16px;">No purchase records yet.</td></tr>' : ''}
            </tbody>
        </table>
        <div class="purchase-summary">
            <div>Total Paid: <span style="color:var(--success);">RM ${totalPaid.toLocaleString()}</span></div>
            <div>Pending: <span style="color:var(--error);">RM ${totalPending.toLocaleString()}</span></div>
            <div style="font-size:18px;">Lifetime Total: <span style="color:var(--primary);">RM ${(totalPaid + totalPending).toLocaleString()}</span></div>
        </div>
        <div style="margin-top:16px;">
            <button class="btn primary" onclick="app.openAddPurchaseModal(${customer.id})">Add Purchase</button>
        </div>
    `;
};

const renderReferralsTab = async (customer, containerId = 'profile-tab-content') => {
    const refs = await AppDataStore.query('referrals', { referrer_customer_id: customer.id });
    const container = document.getElementById(containerId);

    const rowsPromises = refs.map(async (r) => {
        const prospect = await AppDataStore.getById('prospects', r.referred_prospect_id);
        return `
            <tr>
                <td><strong>${prospect?.full_name || 'N/A'}</strong></td>
                <td>${r.relationship}</td>
                <td>${r.date}</td>
                <td><span class="score-badge ${r.status === 'Active' ? 'score-A+' : 'score-A'}">${r.status}</span></td>
                <td>${r.reward_status}</td>
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

const openCustomerReferralModal = async (customerId) => {
    const allProspects = await AppDataStore.getAll('prospects');
    const prospectOptions = allProspects.map(p => `<option value="${p.id}">${escapeHtml(p.full_name)} (${p.phone || 'no phone'})</option>`).join('');
    const content = `
        <div class="form-group" style="margin-bottom:14px;">
            <label>Referred Person (Prospect) <span class="required">*</span></label>
            <select id="referral-prospect-id" class="form-control">
                <option value="">-- Select Prospect --</option>
                ${prospectOptions}
            </select>
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
            <input type="date" id="referral-date" class="form-control" value="${new Date().toISOString().slice(0,10)}">
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
            <div><strong>Phone:</strong> ${prospect?.phone || '—'}</div>
            <div><strong>Relationship:</strong> ${ref.relationship}</div>
            <div><strong>Referral Date:</strong> ${ref.date}</div>
            <div><strong>Status:</strong> <span class="score-badge ${ref.status === 'Active' ? 'score-A+' : 'score-A'}">${ref.status}</span></div>
            <div><strong>Reward Status:</strong> ${ref.reward_status}</div>
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
            row.innerHTML='<input type=\\'text\\' class=\\'form-control\\' placeholder=\\'Platform name\\' style=\\'flex:1;\\'><input type=\\'text\\' class=\\'form-control\\' placeholder=\\'Platform ID\\' style=\\'flex:1;\\'><button class=\\'btn error btn-sm\\' onclick=\\'this.closest(\\'.form-row\\').remove()\\'>×</button>';
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

    for (const row of existingRows) {
        const id = parseInt(row.getAttribute('data-platform-row-id'));
        const inputs = row.querySelectorAll('input');
        const platform = inputs[0]?.value?.trim();
        const platform_id = inputs[1]?.value?.trim();
        if (platform && platform_id) {
            await AppDataStore.update('platform_ids', id, { platform, platform_id });
        } else {
            await AppDataStore.delete('platform_ids', id);
        }
    }
    for (const row of newRows) {
        const inputs = row.querySelectorAll('input');
        const platform = inputs[0]?.value?.trim();
        const platform_id = inputs[1]?.value?.trim();
        if (platform && platform_id) {
            await AppDataStore.create('platform_ids', { customer_id: customerId, platform, platform_id });
        }
    }
    UI.hideModal();
    UI.toast.success('Platform IDs saved');
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

const savePaymentProof = async (purchaseId, customerId) => {
    const file = document.getElementById('proof-upload')?.files[0];
    if (!file) { UI.toast.error('Please select a file'); return; }
    if (file.size > 5 * 1024 * 1024) { UI.toast.error('File too large (max 5MB)'); return; }
    const fileName = `proof_${purchaseId}_${Date.now()}_${file.name}`;
    try {
        if (window.supabase) {
            await window.supabase.storage.from('attachments').upload(fileName, file);
        }
        await AppDataStore.update('purchases', purchaseId, { proof: fileName, status: 'COLLECTED' });
        UI.hideModal();
        UI.toast.success('Payment proof uploaded');
        const customer = await AppDataStore.getById('customers', customerId);
        if (customer) { const cid = `cust-acc-body-purchases-${customerId}`; await renderPurchaseHistoryTab(customer, document.getElementById(cid) ? cid : 'profile-tab-content'); }
    } catch (err) {
        await AppDataStore.update('purchases', purchaseId, { proof: fileName });
        UI.hideModal();
        UI.toast.success('Proof filename saved (offline mode)');
        const customer = await AppDataStore.getById('customers', customerId);
        if (customer) { const cid = `cust-acc-body-purchases-${customerId}`; await renderPurchaseHistoryTab(customer, document.getElementById(cid) ? cid : 'profile-tab-content'); }
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
    container.innerHTML = `
        <div class="eligibility-card">
            <h3>Agent Package Eligibility</h3>
            <div style="font-size:13px; color:#6b21a8; margin-bottom:8px;">Current Status: <strong>Not an Agent</strong></div>
            <div style="font-size:12px; color:#7e22ce;">To become agent: Purchase Agent Package (min RM 3,000)</div>
            
            <div class="eligibility-score">
                <div class="score-circle">85%</div>
                <div style="font-size:13px; font-weight:600; color:#6b21a8;">Good candidate</div>
            </div>
            
            <div style="font-size:12px; color:#7e22ce; font-style:italic; margin-bottom:12px;">
                Recommendations: Active participant, makes referrals, good purchase history.
            </div>
            
            <button class="btn primary" style="width:100%; background:#6b21a8; border:none;" onclick="app.openRecruitModal(${customer.id})">Offer Agent Package</button>
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
        .sort((a, b) => new Date(b.date || b.created_at) - new Date(a.date || a.created_at));

    container.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <h4 style="font-size:16px; font-weight:600; color:var(--primary); margin:0;">Activity History</h4>
            <button class="btn primary btn-sm" onclick="app.openActivityModal(null, 'customer', ${customer.id})">+ Log Activity</button>
        </div>
        ${activities.length > 0 ? `
            <div class="activity-timeline">
                ${activities.map(a => {
        const icon = a.type === 'FTF' ? 'users' : (a.type === 'CALL' ? 'phone' : (a.type === 'EVENT' ? 'calendar-alt' : 'sticky-note'));
        const date = a.date || (a.created_at ? a.created_at.split('T')[0] : 'N/A');
        return `
                        <div class="timeline-item" style="display:flex; gap:16px; margin-bottom:20px; position:relative;">
                            <div class="timeline-icon" style="flex-shrink:0; width:32px; height:32px; border-radius:50%; background:var(--gray-100); display:flex; align-items:center; justify-content:center; color:var(--primary); font-size:14px; z-index:1;">
                                <i class="fas fa-${icon}"></i>
                            </div>
                            <div class="timeline-content" style="flex:1; background:var(--gray-50); padding:12px; border-radius:8px; border:1px solid var(--gray-200);">
                                <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                                    <strong style="font-size:14px;">${a.activity_title || a.type}</strong>
                                    <span style="font-size:12px; color:var(--gray-500);">${date}</span>
                                </div>
                                <div style="font-size:13px; color:var(--gray-700);">${a.notes || 'No details provided.'}</div>
                                ${a.outcome ? `<div style="font-size:12px; margin-top:8px;"><span class="score-badge" style="background:var(--success-bg); color:var(--success); border:none;">${a.outcome}</span></div>` : ''}
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
                <span class="score-badge" style="background:${tag.color || 'var(--primary)'}; color:white; display:flex; align-items:center; gap:4px; font-size:11px;">
                    ${tag.name} <span style="cursor:pointer;" onclick="app.removeTagFromCustomer(${customer.id}, ${tag.id})">&times;</span>
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

const showProspectDetail = async (prospectId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) {
        UI.toast.error('Prospect not found. They may not have been added to the system yet.');
        // Purge stale SWR caches so the ghost row disappears from the list on re-render
        AppDataStore.invalidateCache('prospects');
        renderProspectsTable().catch(() => {});
        return;
    }
    // Single source of truth for prospect visibility: canViewProspect walks
    // the reporting tree, so team leaders / uplines (Level 3–11) can open any
    // prospect owned by someone in their subordinate chain. The previous
    // duplicate "isAdmin || isOwner" check here blocked mid-level leads like
    // Level 4/5/6/8 from viewing their own team's prospects.
    if (!await canViewProspect(prospect)) {
        UI.toast.error('You do not have permission to view this prospect.');
        await navigateTo('prospects');
        return;
    }
    _state.cdv = { type: 'prospect', id: prospectId };

    const container = document.getElementById('content-viewport');
    if (!container) return;

    // Only the CPS photo lookup needs activities on the header critical path.
    // Previously also fetched proposed_solutions/notes/names, but those results
    // were never used here — each was an extra serial uncached Supabase round
    // trip that made opening a prospect feel laggy.
    const activities = await AppDataStore.getActivitiesForProspect(prospectId, { limit: 500 });

    const daysLeft = calculateProtectionDays(prospect);
    const protectionStatus = getProtectionStatus(daysLeft);
    const statusColor = protectionStatus === 'normal' ? 'success' : protectionStatus === 'warning' ? 'secondary' : 'error';
    const statusLabel = protectionStatus === 'normal' ? 'Normal' : protectionStatus === 'warning' ? 'Expiring Soon' : 'Critical';

    const cpsPhoto = activities
        .filter(a => a.type === 'CPS' && a.cps_attachment?.url && a.cps_attachment?.type?.startsWith('image/'))
        .sort((a, b) => (b.id || 0) - (a.id || 0))[0]?.cps_attachment;

    setTimeout(async () => {
        await addWhatsAppButtonToProfile('prospect', prospectId);
        // Badge: count pending proposed solutions for this prospect
        try {
            const sols = await AppDataStore.getAll('proposed_solutions');
            const pendingCount = (sols || []).filter(s => String(s.prospect_id) === String(prospectId) && s.status === 'Proposed').length;
            const badge = document.getElementById(`pending-sol-badge-${prospectId}`);
            if (badge) {
                if (pendingCount > 0) {
                    badge.textContent = pendingCount;
                    badge.style.display = 'inline-block';
                } else {
                    badge.style.display = 'none';
                }
            }
        } catch (e) {}
    }, 100);

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
                .meet-card{background:var(--gray-50);border-radius:8px;padding:12px;margin-bottom:10px;border:1px solid var(--gray-100);}
                .meet-card-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
                .meet-type{font-weight:600;font-size:13px;color:var(--primary);margin-right:6px;}
                .meet-date{font-size:12px;color:var(--gray-400);}
                .meet-section{margin-bottom:8px;}
                .meet-lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--gray-400);margin-bottom:2px;}
                .meet-txt{font-size:13px;color:var(--gray-700);line-height:1.5;}
                .meet-actions{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;}
                .meet-photos{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;}
                .meet-summary{padding:10px 0 4px;border-top:1px solid var(--gray-100);margin-top:2px;}
                .meet-summary-hdr{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--gray-400);margin-bottom:10px;}
                .msf{margin-bottom:10px;}
                .msf:last-child{margin-bottom:4px;}
                .msf-lbl{display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--primary);margin-bottom:3px;}
                .msf-txt{margin:0;font-size:13px;line-height:1.6;color:var(--gray-700);white-space:pre-wrap;word-break:break-word;}
                .msf-txt.action{color:var(--primary);font-weight:500;}
                .msf-empty{font-size:12.5px;color:var(--gray-400);font-style:italic;text-align:center;padding:4px 0 10px;}
                .na-item{display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--gray-100);}
                .na-item:last-child{border-bottom:none;}
                .na-item input[type=checkbox]{width:18px;height:18px;margin-top:1px;flex-shrink:0;accent-color:var(--primary);cursor:pointer;}
                .na-item.done .na-text{text-decoration:line-through;color:var(--gray-400);}
                .na-text{font-size:14px;color:var(--gray-800);flex:1;}
                .na-meta{font-size:11px;color:var(--gray-400);margin-top:2px;}
                .cr-row{margin-bottom:10px;}
                .cr-label{display:block;font-size:12px;font-weight:600;color:var(--gray-500);margin-bottom:4px;}
                .cr-status{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:20px;font-size:13px;font-weight:600;}
                .cr-status.draft{background:#f3f4f6;color:#6b7280;}
                .cr-status.submitted{background:#fef3c7;color:#92400e;}
                .cr-status.approved{background:#d1fae5;color:#065f46;}
            </style>
            <div class="pv-back">
                <button class="btn secondary btn-sm" onclick="app.showProspectsViewSmart(document.getElementById('content-viewport'))">
                    <i class="fas fa-arrow-left"></i> Back to List
                </button>
            </div>
            ${prospect.unable_to_serve ? `
            <div style="background:#f1f5f9;border-bottom:2px solid #94a3b8;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
                <div>
                    <span style="font-weight:700;color:#475569;font-size:14px;">⛔ Unable to Serve</span>
                    ${prospect.unable_reason ? `<span style="color:#64748b;font-size:13px;margin-left:8px;">${escapeHtml(prospect.unable_reason)}</span>` : ''}
                </div>
                <button class="btn secondary btn-sm" onclick="app.openReviveProspectModal(${prospect.id})" style="flex-shrink:0;">
                    🔄 Revive Profile
                </button>
            </div>` : ''}
            <div class="pv-hdr" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;${prospect.unable_to_serve ? 'opacity:0.6;' : ''}">
                <div style="flex:1;min-width:0;">
                    <div class="pv-hdr-meta">
                        <span>ID: P100${prospect.id}</span>
                        ${prospect.unable_to_serve
                            ? `<span class="badge" style="background:#94a3b8;color:#fff;">Unable to Serve</span>`
                            : `<span class="badge success">Active</span>`}
                        <span class="badge info" onclick="event.stopPropagation();app.openProspectGradePicker(${prospect.id})" style="cursor:pointer;user-select:none;" title="Click to set grade">Grade ${prospect.manual_grade || '—'} <i class="fas fa-caret-down" style="font-size:10px;opacity:.7;"></i></span>
                        <span class="badge" onclick="event.stopPropagation();app.openScoreAdjustmentModal('prospect',${prospect.id})" style="background:var(--primary);color:#fff;cursor:pointer;user-select:none;" title="Click to adjust score">⭐ ${prospect.score || 0} pts (${getScoreGrade(prospect.score || 0)}) <i class="fas fa-pen" style="font-size:9px;opacity:.8;margin-left:2px;"></i></span>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:6px 0 8px;">
                        <span style="font-size:22px;font-weight:700;line-height:1.3;flex-shrink:0;">${prospect.full_name}</span>${prospect.nickname ? `<span style="font-size:15px;font-weight:400;color:var(--gray-500);">"${prospect.nickname}"</span>` : ''}
                        <button title="Edit" aria-label="Edit prospect" onclick="app.editProspect(${prospect.id})" style="width:30px;height:30px;border-radius:50%;border:1px solid var(--gray-300);background:#fff;color:var(--gray-500);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;" onmouseover="this.style.background='var(--gray-100)'" onmouseout="this.style.background='#fff'"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></button><button title="Convert to Customer" aria-label="Convert to customer" onclick="app.convertToCustomer(${prospect.id})" style="width:30px;height:30px;border-radius:50%;border:none;background:var(--primary);color:#fff;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'"><i class="fa-solid fa-user-check" aria-hidden="true"></i></button><button title="Meet-Up History" aria-label="Meet-up history" onclick="app.openMeetupHistoryModal(${prospect.id})" style="width:30px;height:30px;border-radius:50%;border:1px solid var(--gray-300);background:#fff;color:var(--primary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;" onmouseover="this.style.background='var(--gray-100)'" onmouseout="this.style.background='#fff'"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i></button><button title="Save to Phone Contacts" aria-label="Save to phone contacts" onclick="app.downloadProspectVCard(${prospect.id})" style="width:30px;height:30px;border-radius:50%;border:1px solid var(--gray-300);background:#fff;color:var(--success);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;" onmouseover="this.style.background='var(--gray-100)'" onmouseout="this.style.background='#fff'"><i class="fa-solid fa-address-book" aria-hidden="true"></i></button>
                    </div>
                </div>
                ${cpsPhoto ? `<img loading="lazy" decoding="async" data-attach-src="${cpsPhoto.url}" onclick="event.stopPropagation();app.zoomCpsPhoto('${cpsPhoto.url}')" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:2px solid var(--gray-200);cursor:zoom-in;flex-shrink:0;margin-top:4px;" title="CPS Photo — click to enlarge">` : ''}
            </div>

                <div class="acc-container" id="acc-container-${prospect.id}" ${prospect.unable_to_serve ? 'style="opacity:0.6;pointer-events:none;"' : ''}>

                    <!-- ① Basic Information — collapsed by default -->
                    <div class="acc-item" id="acc-info-${prospect.id}">
                        <div class="acc-hdr" onclick="app.toggleAccordion('info',${prospect.id},this.parentElement)">
                            <span><i class="fas fa-info-circle"></i> Basic Information</span>
                            <i class="fas fa-chevron-down acc-chev"></i>
                        </div>
                        <div class="acc-body" id="acc-body-info-${prospect.id}" style="display:none" data-loaded="false"></div>
                    </div>

                    <!-- ② Personal Details -->
                    <div class="acc-item" id="acc-personal-${prospect.id}">
                        <div class="acc-hdr" onclick="app.toggleAccordion('personal',${prospect.id},this.parentElement)">
                            <span><i class="fas fa-user"></i> Personal Details</span>
                            <i class="fas fa-chevron-down acc-chev"></i>
                        </div>
                        <div class="acc-body" id="acc-body-personal-${prospect.id}" style="display:none" data-loaded="false"></div>
                    </div>

                    <!-- ③ Meet Up History -->
                    <div class="acc-item" id="acc-activity-${prospect.id}">
                        <div class="acc-hdr" onclick="app.toggleAccordion('activity',${prospect.id},this.parentElement)">
                            <span><i class="fas fa-user-friends"></i> Meet Up History</span>
                            <i class="fas fa-chevron-down acc-chev"></i>
                        </div>
                        <div class="acc-body" id="acc-body-activity-${prospect.id}" style="display:none" data-loaded="false"></div>
                    </div>

                    <!-- ④ Activities and Events -->
                    <div class="acc-item" id="acc-events-${prospect.id}">
                        <div class="acc-hdr" onclick="app.toggleAccordion('events',${prospect.id},this.parentElement)">
                            <span><i class="fas fa-calendar-alt"></i> Activities and Events</span>
                            <i class="fas fa-chevron-down acc-chev"></i>
                        </div>
                        <div class="acc-body" id="acc-body-events-${prospect.id}" style="display:none" data-loaded="false"></div>
                    </div>

                    <!-- ⑤ Potential & Opportunities -->
                    <div class="acc-item" id="acc-potential-${prospect.id}">
                        <div class="acc-hdr" onclick="app.toggleAccordion('potential',${prospect.id},this.parentElement)">
                            <span><i class="fas fa-bolt"></i> Potential &amp; Opportunities <span id="pending-sol-badge-${prospect.id}" style="display:none;background:#f59e0b;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px;margin-left:6px;vertical-align:middle;"></span></span>
                            <i class="fas fa-chevron-down acc-chev"></i>
                        </div>
                        <div class="acc-body" id="acc-body-potential-${prospect.id}" style="display:none" data-loaded="false"></div>
                    </div>

                    <!-- ⑥ Next Actions -->
                    <div class="acc-item" id="acc-nextactions-${prospect.id}">
                        <div class="acc-hdr" onclick="app.toggleAccordion('nextactions',${prospect.id},this.parentElement)">
                            <span><i class="fas fa-tasks"></i> Next Actions</span>
                            <i class="fas fa-chevron-down acc-chev"></i>
                        </div>
                        <div class="acc-body" id="acc-body-nextactions-${prospect.id}" style="display:none" data-loaded="false"></div>
                    </div>

                    <!-- ⑦ DC Closing Record -->
                    <div class="acc-item" id="acc-closing-${prospect.id}">
                        <div class="acc-hdr" onclick="app.toggleAccordion('closing',${prospect.id},this.parentElement)">
                            <span><i class="fas fa-handshake"></i> DC Closing Record</span>
                            <i class="fas fa-chevron-down acc-chev"></i>
                        </div>
                        <div class="acc-body" id="acc-body-closing-${prospect.id}" style="display:none" data-loaded="false"></div>
                    </div>

                    <!-- ⑦a Bujishu Product Purchase History -->
                    <div class="acc-item" id="acc-bujishu-${prospect.id}">
                        <div class="acc-hdr" onclick="app.toggleAccordion('bujishu',${prospect.id},this.parentElement)">
                            <span><i class="fas fa-gem"></i> Bujishu Product Purchase History</span>
                            <i class="fas fa-chevron-down acc-chev"></i>
                        </div>
                        <div class="acc-body" id="acc-body-bujishu-${prospect.id}" style="display:none" data-loaded="false"></div>
                    </div>

                    <!-- ⑦b Formula Healthcare Product Purchase History -->
                    <div class="acc-item" id="acc-formula-${prospect.id}">
                        <div class="acc-hdr" onclick="app.toggleAccordion('formula',${prospect.id},this.parentElement)">
                            <span><i class="fas fa-heartbeat"></i> Formula Healthcare Product Purchase History</span>
                            <i class="fas fa-chevron-down acc-chev"></i>
                        </div>
                        <div class="acc-body" id="acc-body-formula-${prospect.id}" style="display:none" data-loaded="false"></div>
                    </div>

                    <!-- ⑦c Feng Shui Audit -->
                    <div class="acc-item" id="acc-fengshui-${prospect.id}">
                        <div class="acc-hdr" onclick="app.toggleAccordion('fengshui',${prospect.id},this.parentElement)">
                            <span><i class="fas fa-compass"></i> Feng Shui Audit</span>
                            <i class="fas fa-chevron-down acc-chev"></i>
                        </div>
                        <div class="acc-body" id="acc-body-fengshui-${prospect.id}" style="display:none" data-loaded="false"></div>
                    </div>

                    <!-- ⑦d Customer Forms (Survey / CPS / APU) -->
                    <div class="acc-item" id="acc-forms-${prospect.id}">
                        <div class="acc-hdr" onclick="app.toggleAccordion('forms',${prospect.id},this.parentElement)">
                            <span><i class="fas fa-clipboard-list"></i> Customer Forms <span style="color:#7C3AED;">客户表格</span></span>
                            <i class="fas fa-chevron-down acc-chev"></i>
                        </div>
                        <div class="acc-body" id="acc-body-forms-${prospect.id}" style="display:none" data-loaded="false"></div>
                    </div>

                    <!-- ⑧ Notes -->
                    <div class="acc-item" id="acc-notes-${prospect.id}">
                        <div class="acc-hdr" onclick="app.toggleAccordion('notes',${prospect.id},this.parentElement)">
                            <span><i class="fas fa-sticky-note"></i> Notes</span>
                            <i class="fas fa-chevron-down acc-chev"></i>
                        </div>
                        <div class="acc-body" id="acc-body-notes-${prospect.id}" style="display:none" data-loaded="false"></div>
                    </div>

                    <!-- ⑨ Protection Period -->
                    <div class="acc-item" id="acc-protection-${prospect.id}">
                        <div class="acc-hdr" onclick="app.toggleAccordion('protection',${prospect.id},this.parentElement)">
                            <span><i class="fas fa-shield-alt"></i> Protection Period</span>
                            <i class="fas fa-chevron-down acc-chev"></i>
                        </div>
                        <div class="acc-body" id="acc-body-protection-${prospect.id}" style="display:none" data-loaded="false"></div>
                    </div>

                    <!-- ⑩ Tags -->
                    <div class="acc-item" id="acc-tags-${prospect.id}">
                        <div class="acc-hdr" onclick="app.toggleAccordion('tags',${prospect.id},this.parentElement)">
                            <span><i class="fas fa-tags"></i> Tags</span>
                            <i class="fas fa-chevron-down acc-chev"></i>
                        </div>
                        <div class="acc-body" id="acc-body-tags-${prospect.id}" style="display:none" data-loaded="false"></div>
                    </div>

                    <!-- ⑪ Name List -->
                    <div class="acc-item" id="acc-names-${prospect.id}">
                        <div class="acc-hdr" onclick="app.toggleAccordion('names',${prospect.id},this.parentElement)">
                            <span><i class="fas fa-users"></i> Name List</span>
                            <i class="fas fa-chevron-down acc-chev"></i>
                        </div>
                        <div class="acc-body" id="acc-body-names-${prospect.id}" style="display:none" data-loaded="false"></div>
                    </div>

                    <!-- ⑫ Journey Tracker -->
                    <div class="acc-item" id="acc-journey-${prospect.id}">
                        <div class="acc-hdr" onclick="app.toggleAccordion('journey',${prospect.id},this.parentElement)">
                            <span><i class="fas fa-route" style="color:#7c3aed;"></i> Journey Tracker <span id="jny-badge-${prospect.id}" style="display:none;background:#dc2626;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px;margin-left:6px;vertical-align:middle;"></span></span>
                            <i class="fas fa-chevron-down acc-chev"></i>
                        </div>
                        <div class="acc-body" id="acc-body-journey-${prospect.id}" style="display:none" data-loaded="false"></div>
                    </div>

                </div>
        </div>
    `;
    // All accordions start collapsed — no pre-load needed
    // Async: populate journey overdue badge if touchpoints exist
    AppDataStore.getJourneyTouchpoints('prospect', prospect.id).then(tps => {
        const overdue = tps.filter(t => t.status === 'overdue').length;
        const badge = document.getElementById(`jny-badge-${prospect.id}`);
        if (badge && overdue > 0) {
            badge.textContent = `${overdue} overdue`;
            badge.style.display = 'inline';
        }
    }).catch(() => {});
};

const switchProspectTab = async (tab, prospectId, btn, containerOverride) => {
    // Legacy tab-button styling (harmless no-op in accordion mode)
    document.querySelectorAll('.profile-tab').forEach(t => {
        t.classList.remove('active');
        t.style.color = 'var(--gray-800)';
        t.style.fontWeight = 'normal';
    });
    if (btn && btn.classList?.contains('profile-tab')) {
        btn.classList.add('active');
        btn.style.color = 'var(--primary)';
        btn.style.fontWeight = '600';
    }

    // CPS form file now lives in Storage (cps_form_url). Both tabs can
    // therefore use the lean cached getById — no need to ship the heavy
    // base64 column over the wire just to render an <img src="...">.
    const prospect = await AppDataStore.getById('prospects', prospectId);
    const container = containerOverride || document.getElementById('prospect-tab-content');
    if (!container || !prospect) return;

    if (tab === 'info') {
        const cpsUrl = prospect.cps_form_url || '';
        const isImage = cpsUrl && /\.(jpe?g|png|gif|webp|heic|heif)(\?|$)/i.test(cpsUrl);
        const cpsHtml = cpsUrl ? `
            <div class="pv-sub">CPS Form</div>
            <div class="pv-row"><span class="pv-lbl">Uploaded</span><span class="pv-val">${prospect.cps_form_date || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">File</span><span class="pv-val">${prospect.cps_form_name || 'CPS Form'}</span></div>
            ${isImage ? `
                <div style="margin-top:10px;text-align:center;">
                    <img loading="lazy" decoding="async" src="${cpsUrl}" alt="CPS Form" style="max-width:100%;max-height:280px;border-radius:8px;border:1px solid var(--border);cursor:pointer;" onclick="window.open(this.src,'_blank')">
                    <div style="font-size:11px;color:var(--gray-400);margin-top:4px;">Tap to view full size</div>
                </div>
            ` : `
                <div style="margin-top:8px;">
                    <a href="${cpsUrl}" target="_blank" rel="noopener" download="${prospect.cps_form_name || 'cps_form.pdf'}" class="btn secondary btn-sm"><i class="fas fa-download"></i> Download</a>
                </div>
            `}
        ` : '';
        container.innerHTML = `
            <div class="pv-sub">Contact</div>
            <div class="pv-row"><span class="pv-lbl">Phone</span><span class="pv-val">${prospect.phone || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Email</span><span class="pv-val">${prospect.email || '-'}</span></div>
            <div class="pv-sub">Identity</div>
            <div class="pv-row"><span class="pv-lbl">Title</span><span class="pv-val">${prospect.title || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Gender</span><span class="pv-val">${prospect.gender || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Nationality</span><span class="pv-val">${prospect.nationality || '-'}</span></div>
            <div class="pv-sub">Registration</div>
            <div class="pv-row"><span class="pv-lbl">Referrer</span><span class="pv-val">${prospect.referred_by || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Relation</span><span class="pv-val">${prospect.referral_relationship || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Created</span><span class="pv-val">${new Date(prospect.created_at).toLocaleDateString()}</span></div>
            ${cpsHtml}
        `;
    }
    else if (tab === 'personal') {
        container.innerHTML = `
            <div class="pv-sub">Birth &amp; Identity</div>
            <div class="pv-row"><span class="pv-lbl" style="${prospect.life_chart_type === 'solar' ? 'font-weight:700;' : ''}">Date of Birth</span><span class="pv-val" style="display:flex;align-items:center;gap:8px;"><input type="checkbox" ${prospect.life_chart_type === 'solar' ? 'checked' : ''} onchange="event.stopPropagation();app.toggleLifeChartType(${prospect.id},'solar',this.checked)" title="Use for life chart">${prospect.date_of_birth || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl" style="${prospect.life_chart_type === 'lunar' ? 'font-weight:700;' : ''}">Lunar Birth</span><span class="pv-val" style="display:flex;align-items:center;gap:8px;"><input type="checkbox" ${prospect.life_chart_type === 'lunar' ? 'checked' : ''} onchange="event.stopPropagation();app.toggleLifeChartType(${prospect.id},'lunar',this.checked)" title="Use for life chart">${prospect.lunar_birth || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">IC Number</span><span class="pv-val">${prospect.ic_number || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Ming Gua</span><span class="pv-val"><span class="badge info">${prospect.ming_gua || 'MG4'}</span></span></div>
            <div class="pv-sub">Family</div>
            <div class="pv-row"><span class="pv-lbl">Marital Status</span><span class="pv-val">${prospect.marital_status || '-'}</span></div>
            ${(() => {
                let kids = [];
                try { kids = Array.isArray(prospect.children) ? prospect.children : (prospect.children ? JSON.parse(prospect.children) : []); } catch(e) { kids = []; }
                const count = kids.length;
                let html = `<div class="pv-row"><span class="pv-lbl">Children</span><span class="pv-val">${count}</span></div>`;
                kids.forEach((c, i) => {
                    const age = c.age || '-';
                    const gender = c.gender || '-';
                    html += `<div class="pv-row"><span class="pv-lbl">Child ${i + 1}</span><span class="pv-val">${age} y/o · ${gender}</span></div>`;
                });
                return html;
            })()}
            <div class="pv-sub">Employment</div>
            <div class="pv-row"><span class="pv-lbl">Occupation</span><span class="pv-val">${prospect.occupation || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Company</span><span class="pv-val">${prospect.company_name || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Job Description</span><span class="pv-val">${prospect.job_description || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Title &amp; Role</span><span class="pv-val">${prospect.emp_title_role || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Income Range</span><span class="pv-val">${prospect.income_range || '-'}</span></div>
            <div class="pv-sub">Own Business</div>
            <div class="pv-row"><span class="pv-lbl">Own Business?</span><span class="pv-val">${prospect.is_own_business ? '✅ Yes' : (prospect.is_own_business === false ? 'No' : '-')}</span></div>
            ${prospect.is_own_business ? `
            <div class="pv-row"><span class="pv-lbl">Business Name</span><span class="pv-val">${prospect.business_name || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Industry</span><span class="pv-val">${prospect.business_industry || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Business Area</span><span class="pv-val">${prospect.business_area || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Customer Title</span><span class="pv-val">${prospect.business_title_role || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Operating Since</span><span class="pv-val">${prospect.business_started || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Company Size</span><span class="pv-val">${prospect.company_size || '-'}</span></div>
            ` : ''}
            <div class="pv-sub">Address</div>
            <div class="pv-row"><span class="pv-lbl">Address</span><span class="pv-val">${prospect.address || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">City</span><span class="pv-val">${prospect.city || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">State</span><span class="pv-val">${prospect.state || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Postal Code</span><span class="pv-val">${prospect.postal_code || '-'}</span></div>
        `;
    }
    else if (tab === 'forms') {
        // Customer Forms accordion — Survey / CPS / APU per prospect.
        // Each fetch races a 4s timeout so a missing row never hangs the panel.
        const _qf = (t) => Promise.race([
            AppDataStore.query(t, { prospect_id: prospectId }).catch(() => []),
            new Promise(r => setTimeout(() => r([]), 4000))
        ]);
        const [surveys, cpsRows, apuRows, blueprintRows] = await Promise.all([
            _qf('customer_surveys'), _qf('cps_analyses'), _qf('apu_appraisals'), _qf('destiny_blueprints')
        ]);
        const survey    = surveys[0] || null;
        const cps       = cpsRows[0] || null;
        const apu       = apuRows[0] || null;
        const blueprint = blueprintRows[0] || null;
        const fmtDate = (iso) => { try { return iso ? new Date(iso).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : ''; } catch(_) { return iso || ''; } };
        const card = (kind, label, zhLabel, color, row) => {
            // DestinyBlueprint opens in a new tab; all other forms open a modal in-place.
            const handler = kind === 'DestinyBlueprint'
                ? `app.openDestinyBlueprintInTab(${prospect.id}${row ? ',' + row.id : ''})`
                : `app.open${kind}Modal(${prospect.id}${row ? ',' + row.id : ''})`;
            const icon = kind === 'DestinyBlueprint' ? 'external-link-alt' : (row ? 'edit' : 'pen');
            return `
            <div style="background:white;border:1px solid var(--gray-200);border-radius:10px;padding:14px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
                <div style="flex:1;min-width:180px;">
                    <div style="font-weight:600;font-size:14px;color:${color};">${label} <span style="color:#7C3AED;font-weight:500;">${zhLabel}</span></div>
                    <div style="font-size:12px;color:var(--gray-500);margin-top:2px;">
                        ${row ? `<i class="fas fa-check-circle" style="color:#10B981;margin-right:4px;"></i> Completed · ${fmtDate(row.created_at)}` : `<i class="far fa-circle" style="color:#9CA3AF;margin-right:4px;"></i> Not yet filled`}
                    </div>
                </div>
                <button class="btn ${row ? 'secondary' : 'primary'} btn-sm" onclick="event.stopPropagation(); ${handler}">
                    <i class="fas fa-${icon}"></i> ${row ? 'Edit' : 'Fill'}
                </button>
            </div>
        `;
        };
        container.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:10px;">
                <div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:8px;padding:10px 14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12px;color:#374151;">
                    <span style="display:inline-flex;width:20px;height:20px;border-radius:50%;background:#7C3AED;color:white;font-weight:700;font-size:11px;align-items:center;justify-content:center;">1</span> Survey
                    <i class="fas fa-arrow-right" style="color:#9CA3AF;font-size:10px;"></i>
                    <span style="display:inline-flex;width:20px;height:20px;border-radius:50%;background:#7C3AED;color:white;font-weight:700;font-size:11px;align-items:center;justify-content:center;">2</span> CPS
                    <i class="fas fa-arrow-right" style="color:#9CA3AF;font-size:10px;"></i>
                    <span style="display:inline-flex;width:20px;height:20px;border-radius:50%;background:#7C3AED;color:white;font-weight:700;font-size:11px;align-items:center;justify-content:center;">3</span> APU
                    <i class="fas fa-arrow-right" style="color:#9CA3AF;font-size:10px;"></i>
                    <span style="display:inline-flex;width:20px;height:20px;border-radius:50%;background:#7C3AED;color:white;font-weight:700;font-size:11px;align-items:center;justify-content:center;">4</span> Blueprint
                </div>
                ${card('CustomerSurvey',   'New Customer Survey',  '新客户调查表',     '#4338CA', survey)}
                ${card('CpsAnalysis',      'CPS Analysis',         '細解命盤',         '#92400E', cps)}
                ${card('ApuAppraisal',     'APU Appraisal',        '反馈评估',         '#9D174D', apu)}
                ${card('DestinyBlueprint', '3-Year Blueprint',     '九運改命藍圖表',   '#3730A3', blueprint)}
            </div>
        `;
    }
    else if (tab === 'names') {
        const [names, allAttachments] = await Promise.all([
            AppDataStore.query('names', { prospect_id: prospectId }),
            AppDataStore.query('prospect_attachments', { prospect_id: prospectId })
        ]);
        const appraisalCount = allAttachments.filter(a => a.attachment_type === 'appraisal_form').length;
        const apuUrls = allAttachments.filter(a => a.attachment_type === 'apu_form').map(a => a.file_url);
        container.innerHTML = `
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
                <button class="btn secondary btn-sm" onclick="app.attachAppraisalForm(${prospect.id})"><i class="fas fa-file-image"></i> Appraisal Form${appraisalCount ? ` (${appraisalCount})` : ''}</button>
                <button class="btn secondary btn-sm" onclick="app.uploadAPUForm(null, ${prospect.id})"><i class="fas fa-paperclip"></i> APU Form${apuUrls.length ? ` (${apuUrls.length})` : ''}</button>
                <button class="btn primary btn-sm" onclick="app.openAddNameModal(${prospect.id})"><i class="fas fa-plus"></i> Add Name</button>
            </div>
            ${names.length > 0 ? names.map(n => `
                <div style="background:var(--gray-50);border-radius:8px;padding:12px;margin-bottom:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <span style="font-weight:600;font-size:15px;">${n.full_name}</span>
                        <div style="display:flex;gap:6px;">
                            <button class="btn-icon" onclick="app.openAddNameModal(${prospect.id},${n.id})"><i class="fas fa-edit"></i></button>
                            <button class="btn-icon" onclick="app.deleteName(${prospect.id},${n.id})"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                    <div style="font-size:13px;color:var(--gray-600);">
                        <span style="margin-right:12px;"><i class="fas fa-user-tag" style="color:var(--gray-400);margin-right:4px;"></i>${n.relation}</span>
                        ${n.date_of_birth ? `<span><i class="fas fa-birthday-cake" style="color:var(--gray-400);margin-right:4px;"></i>${n.date_of_birth}</span>` : ''}
                    </div>
                    ${n.notes ? `<div style="font-size:13px;color:var(--gray-500);margin-top:6px;font-style:italic;">${n.notes}</div>` : ''}
                </div>
            `).join('') : '<p style="text-align:center;padding:20px;color:var(--gray-400);">No names added yet.</p>'}
        `;
    }
    else if (tab === 'activity') {
        const MEETUP_TYPES = ['CPS','FTF','FSA','GR','XG','CALL','EMAIL','WHATSAPP'];
        const _prospectActs = await AppDataStore.getActivitiesForProspect(prospectId, { limit: 500 });
        const activities = _prospectActs.filter(a => MEETUP_TYPES.includes(a.activity_type));

        // Always fetch fresh photo_urls directly — the SWR localStorage cache
        // serves stale activity rows (without photo_urls) so we can't rely on
        // getAll() here. This is a tiny 2-column query filtered to one prospect.
        const _sb = window.supabase || window.supabaseClient;
        const photoMap = {};
        if (_sb) {
            try {
                const { data: _pd } = await _sb.from('activities').select('id,photo_urls').eq('prospect_id', prospectId);
                if (_pd) _pd.forEach(r => { if (r.photo_urls?.length) photoMap[r.id] = r.photo_urls; });
            } catch (_) {}
        }
        activities.forEach(a => { if (photoMap[a.id]) a.photo_urls = photoMap[a.id]; });

        const sorted = activities.sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date) || b.id - a.id);
        container.innerHTML = `
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px;">
                <button class="btn secondary btn-sm" onclick="app.openPastRecordModal(${prospect.id})" title="Log a historical meet up for an old customer"><i class="fas fa-history"></i> Past Record</button>
                <button class="btn primary btn-sm" onclick="app.openActivityModal('', ${prospect.id})"><i class="fas fa-plus"></i> Add Meet Up</button>
            </div>
            ${sorted.length > 0 ? sorted.map(a => `
                <div class="meet-card">
                    <div class="meet-card-hdr">
                        <div>
                            <span class="meet-type"><i class="fas fa-user-friends"></i> ${a.activity_type || 'Meeting'}${a.activity_title ? ' — ' + a.activity_title : ''}</span>
                            ${a.co_agents && a.co_agents.length > 0 ? `<span style="font-size:11px;color:var(--gray-500);margin-top:2px;display:block;"><i class="fas fa-user-plus"></i> ${a.co_agents.map(c => c.name || c.full_name).join(', ')}</span>` : ''}
                            ${a.consultants && a.consultants.length > 0 ? `<span style="font-size:11px;color:var(--gray-500);margin-top:2px;display:block;">${a.consultants.map(c => {
                                const icon = c.status === 'accepted' ? '✅' : c.status === 'rejected' ? '❌' : '⏳';
                                return `${icon} ${c.name}`;
                            }).join(' &nbsp; ')}</span>` : ''}
                            <span class="meet-date">${a.activity_date || ''}</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:6px;">
                            ${(a.photo_urls && a.photo_urls.length > 0) ? `<button class="btn btn-sm secondary" style="font-size:12px;padding:4px 8px;color:var(--primary);border-color:var(--primary);" title="${a.photo_urls.length} discussion photo${a.photo_urls.length > 1 ? 's' : ''}" onclick="event.stopPropagation();app.viewActivityPhotos(${a.id})"><i class="fas fa-camera"></i> ${a.photo_urls.length}</button>` : ''}
                            <button class="btn btn-sm secondary" style="font-size:12px;padding:4px 8px;" onclick="event.stopPropagation();app.viewActivityDetails(${a.id})">Details</button>
                        </div>
                    </div>
                    ${(() => {
                        const _esc = s => s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : '';
                        const fields = [
                            { lbl: 'Core Problem',            val: a.core_problem || a.summary },
                            { lbl: 'Key Points Discussed',    val: a.note_key_points },
                            { lbl: 'Customer Needs',          val: a.note_needs },
                            { lbl: 'Pain Points',             val: a.note_pain_points },
                            { lbl: 'Opportunity / Potential', val: a.opportunity_potential },
                            { lbl: 'Next Steps',              val: a.note_next_steps,  action: true },
                            { lbl: 'Next Action',             val: a.next_action,      action: true },
                            { lbl: 'Outcome',                 val: a.note_outcome },
                        ].filter(f => f.val);
                        if (!fields.length) return `<div class="meet-summary"><div class="msf-empty">No discussion notes yet — tap <b>Minutes</b> to add.</div></div>`;
                        return `<div class="meet-summary">
                            <div class="meet-summary-hdr"><i class="fas fa-file-alt"></i>&nbsp; Discussion Notes</div>
                            ${fields.map(f => `<div class="msf"><span class="msf-lbl">${f.lbl}</span><p class="msf-txt${f.action ? ' action' : ''}">${_esc(f.val)}</p></div>`).join('')}
                        </div>`;
                    })()}
                    ${a.score_value ? `<div style="margin-bottom:6px;"><span class="badge success" style="font-size:11px;">+${a.score_value} pts</span></div>` : ''}
                    <div class="meet-actions">
                        ${(a.photo_urls && a.photo_urls.length > 0) ? `<button class="btn btn-sm secondary" onclick="event.stopPropagation();app.viewActivityPhotos(${a.id})"><i class="fas fa-images"></i> Photos (${a.photo_urls.length})</button>` : `<button class="btn btn-sm secondary" onclick="event.stopPropagation();app.attachActivityPhoto(${a.id})"><i class="fas fa-camera"></i> Attach Photo</button>`}
                        <button class="btn btn-sm secondary" onclick="event.stopPropagation();app.openPostMeetupNotesModal(${a.id}, ${prospect.id})"><i class="fas fa-sticky-note"></i> Minutes</button>
                        ${a.is_closed ? `<span class="badge success" style="align-self:center;font-size:12px;"><i class="fas fa-handshake"></i> Sale Closed</span>` : `<button class="btn btn-sm primary" onclick="event.stopPropagation();app.openMeetingOutcomeModal(${a.id})"><i class="fas fa-handshake"></i> Close Sale</button>`}
                    </div>
                </div>
            `).join('') : '<p style="text-align:center;padding:20px;color:var(--gray-400);">No meet up history recorded yet.</p>'}
        `;
    }
    else if (tab === 'notes') {
        const notes = await AppDataStore.query('notes', { prospect_id: prospectId });
        container.innerHTML = `
            <div class="add-note-section">
                <textarea id="new-note-text" class="form-control" rows="3" placeholder="Add a new note..."></textarea>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
                    <button class="btn-icon" onclick="app.openVoiceRecorder('new-note-text', 'prospect', ${prospect.id})" title="Record voice note" style="color:var(--primary);"><i class="fas fa-microphone"></i></button>
                    <button class="btn primary btn-sm" onclick="app.addNote(${prospect.id})">Add Note</button>
                </div>
            </div>
            <div style="margin-top:16px;">
                ${notes.length > 0 ? notes.map(n => `
                    <div class="notes-item">
                        <div class="notes-header">
                            <span>${n.date} - ${n.author}${n.is_voice_note ? ' <i class="fas fa-microphone voice-note-icon" title="Voice note"></i>' : ''}</span>
                            <button class="btn-icon" onclick="app.deleteNote(${prospect.id}, ${n.id})"><i class="fas fa-trash"></i></button>
                        </div>
                        <div>"${n.text}"</div>
                    </div>
                `).join('') : '<p style="text-align:center;padding:20px;color:var(--gray-400);">No notes yet.</p>'}
            </div>
            <div style="margin-top:16px;border-top:1px solid var(--gray-200);padding-top:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <span style="font-weight:600;font-size:14px;"><i class="fas fa-folder"></i> Documents</span>
                    <button class="btn primary btn-sm" onclick="app.uploadProspectDocument(${prospect.id})"><i class="fas fa-upload"></i> Upload</button>
                </div>
                <p style="text-align:center;padding:16px;color:var(--gray-400);">No documents uploaded.</p>
            </div>
        `;
    }
    else if (tab === 'events') {
        const EVENT_TYPES = ['EVENT','AGENT_MEETING','AGENT_TRAINING','SITE'];
        // Fetch events + registrations + per-prospect activities + attendee notes in parallel
        const [allEvents, allRegs, _eventActs, _attendeeNotes] = await Promise.all([
            AppDataStore.getAll('events'),
            AppDataStore.getAll('event_registrations'),
            AppDataStore.getActivitiesForProspect(prospectId, { limit: 500 }),
            (window.app.getProspectAttendeeNotes || (() => Promise.resolve([])))(prospectId),
        ]);
        const eventsById = new Map((allEvents || []).map(e => [String(e.id), e]));
        const validEventIds = new Set(eventsById.keys());
        const ownEvents = _eventActs.filter(
            a => EVENT_TYPES.includes(a.activity_type)
                && (a.activity_type !== 'EVENT' || !a.event_id || validEventIds.has(String(a.event_id)))
        );
        // Drop attendee-notes whose parent activity is already in ownEvents
        // (the prospect both hosted and attended) — the owner row wins.
        const ownActivityIds = new Set(ownEvents.map(a => String(a.id)));
        const attendeeEvents = _attendeeNotes.filter(a => !ownActivityIds.has(String(a._parentActivityId)));
        const activityEvents = [...ownEvents, ...attendeeEvents]
            .sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date));

        const VALID_REG_STATUSES = new Set(['Registered', 'Attended', 'No Show']);
        const registrations = (allRegs || []).filter(
            r => r.attendee_type === 'prospect'
                && r.attendee_id == prospectId
                && VALID_REG_STATUSES.has(r.attendance_status)
        );

        const typeIcon = { EVENT: 'fa-calendar-star', AGENT_MEETING: 'fa-handshake', AGENT_TRAINING: 'fa-graduation-cap', SITE: 'fa-map-marker-alt' };
        const typeLabel = { EVENT: 'Event', AGENT_MEETING: 'Agent Meeting', AGENT_TRAINING: 'Training', SITE: 'Site Visit' };

        if (activityEvents.length === 0 && registrations.length === 0) {
            container.innerHTML = '<p style="text-align:center;padding:20px;color:var(--gray-400);">No activities or events recorded yet.</p>';
        } else {
            let html = `<div style="display:flex;justify-content:flex-end;margin-bottom:12px;"><button class="btn primary btn-sm" onclick="app.openActivityModal('', ${prospect.id})"><i class="fas fa-plus"></i> Add Activity</button></div>`;
            for (const a of activityEvents) {
                const icon = typeIcon[a.activity_type] || 'fa-calendar';
                const label = typeLabel[a.activity_type] || a.activity_type;
                const detailsId = a._isAttendeeNote ? a._parentActivityId : a.id;
                const notesBtn = a._isAttendeeNote
                    ? `<button class="btn btn-sm secondary" onclick="event.stopPropagation();app.openAttendeePostEventModal(${a._attendeeRowId}, ${a._parentActivityId}, ${prospect.id})"><i class="fas fa-sticky-note"></i> Post Event Notes</button>`
                    : `<button class="btn btn-sm secondary" onclick="event.stopPropagation();app.openPostMeetupNotesModal(${a.id}, ${prospect.id})"><i class="fas fa-sticky-note"></i> Post Event Notes</button>`;
                const sourceTag = a._isAttendeeNote
                    ? `<span style="font-size:10px;background:var(--gray-100);color:var(--gray-600);padding:1px 6px;border-radius:10px;margin-left:6px;">attended</span>`
                    : '';
                html += `
                    <div class="meet-card" style="margin-bottom:10px;">
                        <div class="meet-card-hdr">
                            <div>
                                <span class="meet-type"><i class="fas ${icon}"></i> ${label}${a.activity_title ? ' — ' + a.activity_title : ''}${sourceTag}</span>
                                <span class="meet-date">${a.activity_date || ''}</span>
                            </div>
                            <button class="btn btn-sm secondary" style="font-size:12px;padding:4px 8px;" onclick="event.stopPropagation();app.viewActivityDetails(${detailsId})">Details</button>
                        </div>
                        ${a.summary || a.note_key_points ? `<div class="meet-section"><div class="meet-lbl">Key Points</div><div class="meet-txt">${a.summary || a.note_key_points}</div></div>` : ''}
                        ${a.note_needs ? `<div class="meet-section"><div class="meet-lbl">Needs</div><div class="meet-txt">${a.note_needs}</div></div>` : ''}
                        ${a.note_pain_points ? `<div class="meet-section"><div class="meet-lbl">Pain Points</div><div class="meet-txt">${a.note_pain_points}</div></div>` : ''}
                        ${a.opportunity_potential ? `<div class="meet-section"><div class="meet-lbl">Opportunity / Potential</div><div class="meet-txt">${a.opportunity_potential}</div></div>` : ''}
                        ${a.next_action ? `<div class="meet-section"><div class="meet-lbl">Next Action</div><div class="meet-txt" style="color:var(--primary);font-weight:500;">${a.next_action}</div></div>` : ''}
                        ${a.location_address ? `<div class="meet-section"><div class="meet-lbl">Location</div><div class="meet-txt">${a.location_address}</div></div>` : ''}
                        ${a.score_value ? `<div style="margin-bottom:6px;"><span class="badge success" style="font-size:11px;">+${a.score_value} pts</span></div>` : ''}
                        <div class="meet-actions">
                            ${notesBtn}
                        </div>
                    </div>
                `;
            }
            if (registrations.length > 0) {
                html += `<div class="pv-sub" style="margin-top:8px;">Event Registrations</div>`;
                html += '<div style="overflow-x:auto;"><table class="events-table" style="width:100%;"><thead><tr><th scope="col">Event</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col">Pts</th></tr></thead><tbody>';
                for (const r of registrations) {
                    const ev = eventsById.get(String(r.event_id));
                    html += `<tr><td>${ev?.event_title || ev?.title || 'Unknown'}</td><td>${r.event_date || '-'}</td><td>${r.attendance_status}</td><td>${r.points_awarded || 0}</td></tr>`;
                }
                html += '</tbody></table></div>';
            }
            container.innerHTML = html;
        }
    }
    else if (tab === 'protection') {
        const daysLeft = calculateProtectionDays(prospect);
        const protectionStatus = getProtectionStatus(daysLeft);
        const statusColor = protectionStatus === 'normal' ? 'success' : protectionStatus === 'warning' ? 'secondary' : 'error';
        const statusLabel = protectionStatus === 'normal' ? 'Normal' : protectionStatus === 'warning' ? 'Expiring Soon' : 'Critical';
        const statusEmoji = protectionStatus === 'normal' ? '🟢' : protectionStatus === 'warning' ? '🟡' : '🔴';

        // Resolve real assigned agent name
        const agentRec = prospect.responsible_agent_id
            ? await AppDataStore.getById('users', prospect.responsible_agent_id)
            : null;
        const agentName = agentRec?.full_name || 'Unassigned';

        // Format dates consistently (handles ISO + falsy values)
        const assignedStr = prospect.cps_assignment_date
            ? UI.formatDate(prospect.cps_assignment_date)
            : (prospect.created_at ? UI.formatDate(prospect.created_at) : '—');
        const deadlineStr = prospect.protection_deadline ? UI.formatDate(prospect.protection_deadline) : '—';

        // Real last-contact based on this prospect's activities (indexed).
        const protActivities = await AppDataStore.getActivitiesForProspect(prospectId, { limit: 500 });
        const lastAct = protActivities
            .slice()
            .sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date))[0];
        let lastContactLabel = 'Never';
        if (lastAct?.activity_date) {
            const diffMs = Date.now() - new Date(lastAct.activity_date).getTime();
            const d = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            lastContactLabel = d <= 0 ? 'Today' : (d === 1 ? '1 day ago' : `${d} days ago`);
        }

        container.innerHTML = `
            <div class="pv-row"><span class="pv-lbl">Agent</span><span class="pv-val">${agentName}</span></div>
            <div class="pv-row"><span class="pv-lbl">Assigned</span><span class="pv-val">${assignedStr}</span></div>
            <div class="pv-row"><span class="pv-lbl">Deadline</span><span class="pv-val">${deadlineStr}</span></div>
            <div class="pv-row"><span class="pv-lbl">Days Left</span><span class="pv-val" style="font-size:16px;font-weight:700;color:var(--${statusColor});">${daysLeft} days</span></div>
            <div class="pv-row"><span class="pv-lbl">Status</span><span class="pv-val">${statusEmoji} ${statusLabel}</span></div>
            <div class="pv-row"><span class="pv-lbl">Last Contact</span><span class="pv-val">${lastContactLabel}</span></div>
            <div class="progress-bar" style="margin:12px 0;">
                <div class="progress-fill" style="width:${Math.min(100, (daysLeft / 30) * 100)}%;background:var(--${statusColor});"></div>
            </div>
            <div style="display:flex;gap:8px;margin-top:4px;">
                <button class="btn secondary btn-sm" style="flex:1;" onclick="app.extendProtection(${prospect.id})">Extend</button>
                <button class="btn secondary btn-sm" style="flex:1;" onclick="app.transferProspect(${prospect.id})">Transfer</button>
                <button class="btn secondary btn-sm" style="flex:1;" onclick="app.reassignProspect(${prospect.id})">Reassign</button>
            </div>
        `;
    }
    else if (tab === 'tags') {
        container.innerHTML = `
            <div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
                <button class="btn primary btn-sm" onclick="app.openAddTagModal(${prospect.id})"><i class="fas fa-plus"></i> Add Tag</button>
            </div>
            <div class="tags-container" id="prospect-tags-container">
                ${prospect.tags && prospect.tags.length > 0 ? prospect.tags.map(t => `
                    <span class="tag ${t.color}">${t.name} <i class="fas fa-times remove" onclick="app.removeTagFromProspect(${prospect.id}, ${t.id})"></i></span>
                `).join('') : '<span style="color:var(--gray-400);">No tags yet</span>'}
            </div>
        `;
    }
    else if (tab === 'potential') {
        const MEETUP_TYPES = ['CPS','FTF','FSA','GR','XG','CALL','EMAIL','WHATSAPP','EVENT'];
        const [allActivities, attendeeNotes] = await Promise.all([
            AppDataStore.getActivitiesForProspect(prospectId, { limit: 500 }),
            (window.app.getProspectAttendeeNotes || (() => Promise.resolve([])))(prospectId),
        ]);
        const meetups = [
            ...allActivities.filter(a => MEETUP_TYPES.includes(a.activity_type)),
            ...attendeeNotes,
        ].sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date));

        // Feng Shui Audit product selections flow into Solutions (same format as post-meetup notes)
        const fengShuiAudits = _readFengShuiAudits(prospect);
        const auditSolutions = fengShuiAudits
            .map(a => a.products)
            .filter(Boolean);
        const auditNeeds = fengShuiAudits
            .map(a => a.key_notes)
            .filter(Boolean);

        // Aggregate across all meetings (+ feng shui audits for solutions/needs)
        const allPains = [...new Set(meetups.flatMap(a => [a.note_pain_points, a.core_problem].filter(Boolean)))];
        const allNeeds = [...new Set([
            ...meetups.flatMap(a => [a.note_needs, a.note_key_points].filter(Boolean)),
            ...auditNeeds,
        ])];
        const allSolutions = [...new Set([
            ...meetups.flatMap(a => [a.opportunity_potential, a.note_outcome].filter(Boolean)),
            ...auditSolutions,
        ])];
        const allNextSteps = [...new Set(meetups.flatMap(a => [a.next_action, a.note_next_steps].filter(Boolean)))];

        const dealCards = meetups.filter(a =>
            a.note_pain_points || a.note_needs || a.note_key_points || a.core_problem ||
            a.opportunity_potential || a.note_outcome || a.next_action || a.note_next_steps
        );

        container.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <div>
                    <span class="badge ${(prospect.potential_level === 'High') ? 'success' : prospect.potential_level === 'Medium' ? 'warning' : prospect.potential_level === 'Low' ? 'secondary' : 'secondary'}" style="font-size:13px;">${prospect.potential_level || 'NOT SET'} POTENTIAL</span>
                </div>
                <div style="display:flex;gap:6px;align-items:center;">
                    <button class="btn secondary btn-sm" onclick="app.openLatestMeetupNotes(${prospect.id})"><i class="fas fa-edit"></i> Edit Notes</button>
                    <button class="btn secondary btn-sm" onclick="app.openEditPotentialModal(${prospect.id})" title="Edit Forecast"><i class="fas fa-cog"></i></button>
                </div>
            </div>
            <div class="pv-row"><span class="pv-lbl">Close Prob.</span><span class="pv-val">${prospect.close_probability || 0}%</span></div>
            <div class="progress-bar" style="margin-bottom:12px;">
                <div class="progress-fill" style="width:${prospect.close_probability || 0}%;background:var(--${(prospect.close_probability || 0) >= 60 ? 'success' : (prospect.close_probability || 0) >= 30 ? 'warning' : 'danger'});"></div>
            </div>
            <div class="pv-row"><span class="pv-lbl">Est. Value</span><span class="pv-val">${prospect.estimated_value_min || prospect.estimated_value_max ? 'RM ' + (prospect.estimated_value_min || 0).toLocaleString() + ' – RM ' + (prospect.estimated_value_max || 0).toLocaleString() : '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Budget</span><span class="pv-val">${prospect.budget_range || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Timeline</span><span class="pv-val">${prospect.decision_timeline || '-'}</span></div>
            <div class="pv-row"><span class="pv-lbl">Decision Maker</span><span class="pv-val">${prospect.decision_maker === 'yes' ? 'Yes' : prospect.decision_maker === 'no' ? 'No' : 'Unknown'}</span></div>

            ${(meetups.length > 0 || fengShuiAudits.length > 0) ? `
            <div class="pv-sub" style="margin-top:12px;">Deal Analysis from ${meetups.length} Meet Up${meetups.length !== 1 ? 's' : ''}${fengShuiAudits.length > 0 ? ` + ${fengShuiAudits.length} Feng Shui Audit${fengShuiAudits.length !== 1 ? 's' : ''}` : ''}</div>

            ${allPains.length > 0 ? `
            <div style="background:#fff3f3;border-left:3px solid #ef4444;border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:8px;">
                <div class="meet-lbl" style="color:#ef4444;margin-bottom:4px;"><i class="fas fa-exclamation-circle"></i> Pain Points / Core Problem</div>
                ${allPains.map(p => `<div style="font-size:13px;color:var(--gray-700);margin-bottom:3px;">• ${p}</div>`).join('')}
            </div>` : ''}

            ${allNeeds.length > 0 ? `
            <div style="background:#fff8e1;border-left:3px solid #f59e0b;border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:8px;">
                <div class="meet-lbl" style="color:#d97706;margin-bottom:4px;"><i class="fas fa-lightbulb"></i> Customer Needs / Interests</div>
                ${allNeeds.map(n => `<div style="font-size:13px;color:var(--gray-700);margin-bottom:3px;">• ${n}</div>`).join('')}
            </div>` : ''}

            ${allSolutions.length > 0 ? `
            <div style="background:#f0fdf4;border-left:3px solid #22c55e;border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:8px;">
                <div class="meet-lbl" style="color:#16a34a;margin-bottom:4px;"><i class="fas fa-hand-holding-heart"></i> Solution Proposed / Opportunity</div>
                ${allSolutions.map(s => `<div style="font-size:13px;color:var(--gray-700);margin-bottom:3px;">• ${s}</div>`).join('')}
            </div>` : ''}

            ${allNextSteps.length > 0 ? `
            <div style="background:#eff6ff;border-left:3px solid var(--primary);border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:8px;">
                <div class="meet-lbl" style="color:var(--primary);margin-bottom:4px;"><i class="fas fa-arrow-right"></i> Next Steps to Close</div>
                ${allNextSteps.map(s => `<div style="font-size:13px;color:var(--gray-700);margin-bottom:3px;">• ${s}</div>`).join('')}
            </div>` : ''}

            ${(dealCards.length === 0 && allNeeds.length === 0 && allSolutions.length === 0) ? '<p style="text-align:center;padding:12px;color:var(--gray-400);font-size:13px;">No deal analysis recorded yet. Add notes during meet ups or log a feng shui audit.</p>' : ''}
            ` : '<p style="text-align:center;padding:20px;color:var(--gray-400);font-size:13px;">No meet ups or feng shui audits recorded yet.</p>'}
        `;
    }
    else if (tab === 'nextactions') {
        const [_ownActs, _attendeeNotes] = await Promise.all([
            AppDataStore.getActivitiesForProspect(prospectId, { limit: 500 }),
            (window.app.getProspectAttendeeNotes || (() => Promise.resolve([])))(prospectId),
        ]);
        const activities = [..._ownActs, ..._attendeeNotes]
            .sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date) || ((b.id || 0) > (a.id || 0) ? 1 : -1));

        // Collect action items: next_action field + note_next_steps field, deduplicated per activity
        const actionItems = [];
        for (const a of activities) {
            if (a.next_action?.trim()) {
                actionItems.push({ id: `${a.id}_na`, activityId: a.id, text: a.next_action.trim(), date: a.activity_date, type: a.activity_type, title: a.activity_title, source: 'Next Action' });
            }
            if (a.note_next_steps?.trim() && a.note_next_steps.trim() !== (a.next_action || '').trim()) {
                actionItems.push({ id: `${a.id}_ns`, activityId: a.id, text: a.note_next_steps.trim(), date: a.activity_date, type: a.activity_type, title: a.activity_title, source: 'Next Steps' });
            }
        }

        if (actionItems.length === 0) {
            container.innerHTML = '<p style="text-align:center;padding:20px;color:var(--gray-400);">No next actions recorded yet. Add during meet ups via Next Action or Next Steps fields.</p>';
            return;
        }

        const rows = actionItems.map(item => {
            const _act = activities.find(a => String(a.id) === String(item.activityId));
            const isDone = (item.id.endsWith('_na') ? _act?.next_action_done : _act?.note_next_steps_done)
                || localStorage.getItem(`na_done_${prospectId}_${item.id}`) === '1';
            return `
                <div class="na-item${isDone ? ' done' : ''}" id="na-item-${item.id}">
                    <input type="checkbox" class="na-cb" id="na-cb-${item.id}" ${isDone ? 'checked' : ''}
                        onchange="app.toggleNextActionItem(${prospectId}, '${item.id}', this.checked)">
                    <div style="flex:1;">
                        <div class="na-text" id="na-text-${item.id}">${item.text}</div>
                        <div style="font-size:11px;color:var(--gray-400);margin-top:2px;">${item.date || ''} — ${item.type || 'Meeting'}${item.title ? ' · ' + item.title : ''} <span style="background:var(--gray-100);border-radius:3px;padding:1px 4px;">${item.source}</span></div>
                    </div>
                </div>
            `;
        }).join('');

        const total = actionItems.length;
        const done = actionItems.filter(item => {
            const _act = activities.find(a => String(a.id) === String(item.activityId));
            return (item.id.endsWith('_na') ? _act?.next_action_done : _act?.note_next_steps_done)
                || localStorage.getItem(`na_done_${prospectId}_${item.id}`) === '1';
        }).length;
        container.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <span data-na-count style="font-size:13px;color:var(--gray-500);">${done} of ${total} completed</span>
                <div class="progress-bar" style="flex:1;margin:0 12px;height:6px;">
                    <div class="progress-fill" style="width:${total > 0 ? Math.round((done/total)*100) : 0}%;background:var(--success);transition:width 0.3s;"></div>
                </div>
                <span style="font-size:13px;font-weight:600;color:var(--success);">${total > 0 ? Math.round((done/total)*100) : 0}%</span>
            </div>
            ${rows}
        `;
    }
    else if (tab === 'closing') {
        const cr = prospect.closing_record || null;
        const status = cr?.status || 'draft';
        const isManager = isSystemAdmin(_currentUser) || isMarketingManager(_currentUser);
        const products = (await AppDataStore.getAll('products')).filter(p => p.is_active !== false);
        const productOptions = products.length
            ? products.map(p => `<option value="${p.name}" ${(cr?.product === p.name) ? 'selected' : ''}>${p.name}</option>`).join('')
            : '<option value="">No products available</option>';

        // ── Before 2025 Purchase Record (stored inside closing_record to reuse existing JSONB column) ──
        const pid = prospect.id;
        let pre2025 = [];
        try {
            const src = prospect.closing_record?.pre2025_purchases || prospect.pre2025_purchases;
            pre2025 = Array.isArray(src) ? src : JSON.parse(src || '[]');
        } catch(_) {}
        const pre2025Rows = pre2025.length
            ? pre2025.map((r, i) => `
                <tr>
                    <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;">${escapeHtml(r.product || '')}</td>
                    <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;color:var(--gray-500);">${escapeHtml(r.notes || '-')}</td>
                    <td style="padding:4px 8px;border-bottom:1px solid #f3f4f6;text-align:center;">
                        ${r.attachment_data
                            ? `<a href="${r.attachment_data}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(r.attachment_name||'View attachment')}" style="color:var(--primary);margin-right:4px;"><i class="fas fa-paperclip"></i></a>`
                            : `<label for="pre2025-att-${pid}-${i}" title="Attach file" style="cursor:pointer;color:var(--gray-400);margin-right:4px;"><i class="fas fa-paperclip"></i></label>`
                        }
                        <input type="file" id="pre2025-att-${pid}-${i}" style="display:none" accept="image/*,application/pdf" onchange="event.stopPropagation();app.addPrePurchaseAttachment(${pid},${i},this)">
                    </td>
                    <td style="padding:4px 8px;border-bottom:1px solid #f3f4f6;text-align:center;">
                        <button class="btn-icon" style="color:var(--error);" onclick="event.stopPropagation();app.deletePrePurchaseRecord(${pid},${i})" title="Remove"><i class="fas fa-times"></i></button>
                    </td>
                </tr>`).join('')
            : `<tr><td colspan="4" style="padding:10px;text-align:center;color:var(--gray-400);font-size:12px;font-style:italic;">No past records yet</td></tr>`;
        const pre2025Html = `
            <div style="margin-bottom:16px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
                <div style="background:#fef9ec;padding:8px 12px;font-weight:600;font-size:13px;border-bottom:1px solid #e5e7eb;color:#78400b;">
                    📋 Before 2025 Purchase Record
                </div>
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead><tr style="background:#fafafa;">
                        <th scope="col" style="padding:6px 10px;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:600;">Product / Service</th>
                        <th scope="col" style="padding:6px 10px;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:600;">Notes</th>
                        <th scope="col" style="padding:4px;width:36px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:600;font-size:11px;">File</th>
                        <th scope="col" style="padding:4px;width:36px;border-bottom:1px solid #e5e7eb;"></th>
                    </tr></thead>
                    <tbody id="pre2025-rows-${pid}">${pre2025Rows}</tbody>
                </table>
                <div style="padding:8px 10px;border-top:1px solid #e5e7eb;display:flex;gap:6px;align-items:center;">
                    <input id="pre2025-product-${pid}" class="form-control" style="flex:1;height:32px;font-size:12px;" placeholder="Product / Service">
                    <input id="pre2025-notes-${pid}" class="form-control" style="flex:1;height:32px;font-size:12px;" placeholder="Notes (optional)">
                    <label for="pre2025-file-${pid}" title="Attach a file (AI will auto-read)" style="cursor:pointer;height:32px;padding:0 10px;display:flex;align-items:center;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb;color:var(--gray-500);">
                        <i class="fas fa-paperclip"></i>
                    </label>
                    <input id="pre2025-file-${pid}" type="file" style="display:none" accept="image/*,application/pdf" onchange="app.scanInvoiceWithAI(this,${pid},'pre2025')">
                    <button class="btn secondary btn-sm" onclick="event.stopPropagation();app.addPrePurchaseRow(${pid})" style="white-space:nowrap;height:32px;"><i class="fas fa-plus"></i> Add</button>
                </div>
            </div>`;

        const isConverted = prospect.status === 'converted' || prospect.conversion_status === 'approved';

        // Closing history (archived approved records)
        const crHistory = Array.isArray(prospect.closing_records_history) ? prospect.closing_records_history : [];
        const _crStatusBadge = (h) => {
            if (h.case_completed) return `<span style="background:#dcfce7;color:#166534;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;"><i class="fas fa-check-circle"></i> Completed</span>`;
            const s = h.delivery_status || 'pending';
            if (s === 'delivered') return `<span style="background:#dbeafe;color:#1e40af;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;"><i class="fas fa-truck"></i> Delivered</span>`;
            return `<span style="background:#fef9c3;color:#854d0e;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;"><i class="fas fa-clock"></i> Pending</span>`;
        };
        const historyHtml = crHistory.length ? `
            <div style="margin-bottom:16px;border:1px solid #e5e7eb;border-radius:8px;">
                <div style="background:#f0fdf4;padding:8px 12px;font-weight:600;font-size:13px;border-bottom:1px solid #e5e7eb;color:#166534;border-radius:8px 8px 0 0;">
                    <i class="fas fa-history"></i> Closing History (${crHistory.length} record${crHistory.length>1?'s':''})
                </div>
                ${crHistory.map((h, hi) => `
                    <details style="border-bottom:1px solid #f3f4f6;">
                        <summary style="padding:8px 12px;cursor:pointer;font-size:13px;font-weight:600;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:8px;">
                            <span style="flex:1;">#${hi+1} — ${escapeHtml(h.product||'N/A')} · RM ${h.sale_amount ? parseFloat(h.sale_amount).toLocaleString() : '0'}</span>
                            ${_crStatusBadge(h)}
                            <span style="font-size:11px;color:var(--gray-400);font-weight:400;">${h.closing_date || (h.approved_at ? h.approved_at.split('T')[0] : '')}</span>
                        </summary>
                        <div style="padding:10px 12px;background:#fafafa;font-size:12px;border-top:1px solid #f3f4f6;">
                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;margin-bottom:10px;">
                                <div><span style="color:var(--gray-400);">Payment:</span> ${escapeHtml(h.payment_method||'-')}</div>
                                <div><span style="color:var(--gray-400);">Invoice:</span> ${escapeHtml(h.invoice_number||'-')}</div>
                                <div style="grid-column:1/-1;">
                                    ${h.invoice_file
                                        ? `<a href="${h.invoice_file}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);"><i class="fas fa-paperclip"></i> ${escapeHtml(h.invoice_file_name||'View invoice')}</a>`
                                        : `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11px;background:#fffbeb;border:1px dashed #f59e0b;border-radius:6px;padding:6px 8px;">
                                            <span style="color:#92400e;"><i class="fas fa-exclamation-triangle"></i> No invoice attached.</span>
                                            <input type="file" id="crh-inv-${pid}-${hi}" accept="image/*,application/pdf" style="font-size:11px;flex:1;min-width:140px;">
                                            <button class="btn secondary btn-sm" style="padding:2px 8px;font-size:11px;height:24px;" onclick="event.stopPropagation();app.uploadHistoryInvoice(${pid},${hi})"><i class="fas fa-upload"></i> Upload</button>
                                          </div>`}
                                </div>
                                ${h.closing_remarks ? `<div style="grid-column:1/-1;"><span style="color:var(--gray-400);">Sale Remarks:</span> ${escapeHtml(h.closing_remarks)}</div>` : ''}
                            </div>
                            <div style="border-top:1px solid #e5e7eb;padding-top:10px;">
                                <div style="font-size:11px;font-weight:700;color:var(--gray-500);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">📦 Delivery Tracking</div>
                                <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
                                    <select id="crh-status-${pid}-${hi}" class="form-control" style="flex:1;min-width:120px;font-size:12px;">
                                        <option value="pending" ${(!h.delivery_status||h.delivery_status==='pending')?'selected':''}>Pending Delivery</option>
                                        <option value="delivered" ${h.delivery_status==='delivered'?'selected':''}>Delivered</option>
                                        <option value="completed" ${h.delivery_status==='completed'?'selected':''}>Completed</option>
                                    </select>
                                    <label style="display:flex;align-items:center;gap:5px;cursor:pointer;white-space:nowrap;font-weight:600;color:${h.case_completed?'#166534':'var(--gray-600)'};">
                                        <input type="checkbox" id="crh-completed-${pid}-${hi}" ${h.case_completed?'checked':''} style="width:15px;height:15px;cursor:pointer;">
                                        Case Completed
                                    </label>
                                </div>
                                <div style="margin-bottom:8px;">
                                    <label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:4px;">Delivery Proof Attachment</label>
                                    ${h.delivery_proof ? `<div style="margin-bottom:4px;"><a href="${h.delivery_proof}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);font-size:12px;"><i class="fas fa-paperclip"></i> ${escapeHtml(h.delivery_proof_name||'View proof')}</a> <span style="color:var(--gray-400);font-size:11px;">(upload new to replace)</span></div>` : ''}
                                    <input type="file" id="crh-proof-${pid}-${hi}" accept="image/*,application/pdf" style="font-size:11px;width:100%;" onchange="(function(el){var f=el.files[0];if(!f)return;var r=new FileReader();r.onload=function(e){el.dataset.b64=e.target.result;el.dataset.fname=f.name;};r.readAsDataURL(f);})(this)">
                                </div>
                                <div style="margin-bottom:8px;">
                                    <label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:4px;">Remarks</label>
                                    <textarea id="crh-remarks-${pid}-${hi}" class="form-control" rows="2" style="font-size:12px;" placeholder="Post-sale notes, delivery details...">${escapeHtml(h.delivery_remarks||'')}</textarea>
                                </div>
                                <button class="btn primary btn-sm" style="width:100%;height:30px;" onclick="event.stopPropagation();app.saveClosingHistoryEntry(${pid},${hi})"><i class="fas fa-save"></i> Save</button>
                            </div>
                        </div>
                    </details>`).join('')}
            </div>` : '';

        if (!cr || status === 'draft') {
            const d = cr || {};
            const isPOP = d.payment_method === 'POP';
            container.innerHTML = pre2025Html + historyHtml + `
                <div class="cr-status draft" style="margin-bottom:14px;padding:8px 12px;border-radius:8px;background:#fff8e1;border:1px solid #ffc107;color:#856404;font-size:13px;font-weight:600;">
                    <i class="fas fa-edit"></i> Draft — Fill in details and submit for manager approval
                </div>
                <div class="pv-sub">Customer Information</div>
                <div class="form-group" style="margin-bottom:10px;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Full Name</label><input id="cr-full-name" class="form-control" value="${d.full_name || prospect.full_name || ''}" placeholder="Full name"></div>
                <div class="form-row" style="display:flex;gap:8px;margin-bottom:10px;">
                    <div class="form-group" style="flex:1;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Phone</label><input id="cr-phone" class="form-control" value="${d.phone || prospect.phone || ''}" placeholder="Phone"></div>
                    <div class="form-group" style="flex:1;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Email</label><input id="cr-email" class="form-control" value="${d.email || prospect.email || ''}" placeholder="Email"></div>
                </div>
                <div class="form-row" style="display:flex;gap:8px;margin-bottom:10px;">
                    <div class="form-group" style="flex:1;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">IC Number</label><input id="cr-ic" class="form-control" value="${d.ic_number || prospect.ic_number || ''}" placeholder="NRIC/Passport"></div>
                    <div class="form-group" style="flex:1;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Date of Birth</label><input id="cr-dob" type="date" class="form-control" value="${d.date_of_birth || prospect.date_of_birth || ''}"></div>
                </div>
                <div class="form-group" style="margin-bottom:14px;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Address</label><textarea id="cr-address" class="form-control" rows="2" placeholder="Full address">${d.address || [prospect.address, prospect.city, prospect.state, prospect.postal_code].filter(Boolean).join(', ') || ''}</textarea></div>

                <div class="pv-sub">📝 Meeting Outcome</div>
                <div class="form-row" style="display:flex;gap:8px;margin-bottom:10px;">
                    <div class="form-group" style="flex:1;">
                        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Product/Service Sold</label>
                        <select id="cr-product" class="form-control">${productOptions}</select>
                    </div>
                    <div class="form-group" style="flex:1;">
                        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Order Date</label>
                        <input id="cr-order-date" type="date" class="form-control" value="${d.order_date || ''}">
                    </div>
                </div>
                <div class="form-row" style="display:flex;gap:8px;margin-bottom:10px;">
                    <div class="form-group" style="flex:1;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Amount Closed (RM)</label><input id="cr-amount" type="number" class="form-control" value="${d.sale_amount || ''}" placeholder="0.00"></div>
                    <div class="form-group" style="flex:1;">
                        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Payment Method</label>
                        <select id="cr-payment-method" class="form-control" onchange="document.getElementById('cr-pop-fields').style.display=this.value==='POP'?'block':'none'">
                            <option value="Cash" ${d.payment_method==='Cash'?'selected':''}>Cash</option>
                            <option value="Bank Transfer" ${d.payment_method==='Bank Transfer'?'selected':''}>Bank Transfer</option>
                            <option value="Credit Card" ${d.payment_method==='Credit Card'?'selected':''}>Credit Card</option>
                            <option value="Cheque" ${d.payment_method==='Cheque'?'selected':''}>Cheque</option>
                            <option value="EPP" ${d.payment_method==='EPP'?'selected':''}>EPP</option>
                            <option value="POP" ${d.payment_method==='POP'?'selected':''}>POP</option>
                        </select>
                    </div>
                </div>
                <div id="cr-pop-fields" style="display:${isPOP?'block':'none'};background:var(--gray-50);padding:12px;border-radius:6px;margin-bottom:10px;">
                    <div class="form-row" style="display:flex;gap:8px;margin-bottom:8px;">
                        <div class="form-group" style="flex:1;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Monthly Amount (RM)</label><input id="cr-pop-monthly" type="number" class="form-control" value="${d.pop_monthly || ''}" placeholder="0.00"></div>
                        <div class="form-group" style="flex:1;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Tenure (months)</label><input id="cr-pop-tenure" type="number" class="form-control" value="${d.pop_tenure || ''}" placeholder="12"></div>
                    </div>
                    <div class="form-group"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Down Payment (RM)</label><input id="cr-pop-down" type="number" class="form-control" value="${d.pop_down_payment || ''}" placeholder="0.00"></div>
                </div>
                <div class="form-row" style="display:flex;gap:8px;margin-bottom:10px;">
                    <div class="form-group" style="flex:1;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Invoice Number</label><input id="cr-invoice" class="form-control" value="${d.invoice_number || ''}" placeholder="INV-2026-001"></div>
                    <div class="form-group" style="flex:1;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Collection Date</label><input id="cr-close-date" type="date" class="form-control" value="${d.closing_date || ''}"></div>
                </div>
                <div class="form-group" style="margin-bottom:10px;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Remarks</label><textarea id="cr-remarks" class="form-control" rows="2" placeholder="e.g. Ring Size, Special Request...">${d.closing_remarks || ''}</textarea></div>
                <div class="form-group" style="margin-bottom:14px;">
                    <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Upload Purchased Invoice <span style="font-size:11px;color:var(--gray-400);font-weight:normal;">(AI auto-fill on upload)</span></label>
                    <input id="cr-invoice-file" type="file" class="form-control" accept="image/png,image/jpeg,application/pdf" onchange="app.scanInvoiceWithAI(this,'cr','cr')">
                    ${d.invoice_file ? `<div style="margin-top:6px;font-size:11px;color:var(--gray-500);"><i class="fas fa-paperclip"></i> Current: <a href="${d.invoice_file}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);">${escapeHtml(d.invoice_file_name || 'view')}</a> <span style="color:var(--gray-400);">(choosing a new file will replace it)</span></div>` : ''}
                </div>

                <div class="pv-sub">📁 Case Study (Optional)</div>
                <div class="form-group" style="margin-bottom:10px;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Sales Idea</label><textarea id="cr-sales-idea" class="form-control" rows="2" placeholder="Describe the sales idea...">${d.sales_idea || ''}</textarea></div>
                <div class="form-group" style="margin-bottom:10px;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Plan Details</label><textarea id="cr-plan-details" class="form-control" rows="2" placeholder="Details of the plan proposed...">${d.plan_details || ''}</textarea></div>
                <div class="form-group" style="margin-bottom:14px;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Success Story</label><textarea id="cr-success-story" class="form-control" rows="2" placeholder="What made this a success?">${d.success_story || ''}</textarea></div>

                <div style="display:flex;gap:8px;">
                    <button class="btn secondary btn-sm" style="flex:1;" onclick="event.stopPropagation();app.saveClosingRecord(${prospect.id})"><i class="fas fa-save"></i> Save Draft</button>
                    <button class="btn primary btn-sm" style="flex:1;" onclick="event.stopPropagation();app.submitClosingRecord(${prospect.id})"><i class="fas fa-paper-plane"></i> Submit for Approval</button>
                </div>
            `;
        } else if (status === 'submitted') {
            const d = cr;
            const approveLabel = isConverted ? 'Approve Sale' : 'Approve & Create Customer';
            const managerButtons = isManager ? `
                <div style="display:flex;gap:8px;margin-top:14px;">
                    <button class="btn primary btn-sm" style="flex:1;" onclick="event.stopPropagation();app.approveClosingRecord(${prospect.id})"><i class="fas fa-check"></i> ${approveLabel}</button>
                    <button class="btn danger btn-sm" style="flex:1;" onclick="event.stopPropagation();app.rejectClosingRecord(${prospect.id})"><i class="fas fa-times"></i> Reject</button>
                </div>
            ` : `<p style="text-align:center;color:var(--gray-400);font-size:13px;margin-top:12px;"><i class="fas fa-clock"></i> Awaiting manager review.</p>`;
            container.innerHTML = pre2025Html + historyHtml + `
                <div class="cr-status submitted" style="margin-bottom:14px;padding:8px 12px;border-radius:8px;background:#e3f2fd;border:1px solid #2196f3;color:#1565c0;font-size:13px;font-weight:600;">
                    <i class="fas fa-clock"></i> Submitted — Pending manager approval
                </div>
                <div class="pv-sub">Customer Information</div>
                <div class="pv-row"><span class="pv-lbl">Full Name</span><span class="pv-val">${d.full_name || '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Phone</span><span class="pv-val">${d.phone || '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Email</span><span class="pv-val">${d.email || '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">IC Number</span><span class="pv-val">${d.ic_number || '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Date of Birth</span><span class="pv-val">${d.date_of_birth || '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Address</span><span class="pv-val">${d.address || '-'}</span></div>
                <div class="pv-sub">Meeting Outcome</div>
                <div class="pv-row"><span class="pv-lbl">Product/Service</span><span class="pv-val">${d.product || '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Order Date</span><span class="pv-val">${d.order_date || '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Amount Closed</span><span class="pv-val">${d.sale_amount ? 'RM ' + parseFloat(d.sale_amount).toLocaleString() : '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Payment Method</span><span class="pv-val">${d.payment_method || '-'}</span></div>
                ${d.payment_method === 'POP' ? `
                <div class="pv-row"><span class="pv-lbl">Monthly (RM)</span><span class="pv-val">${d.pop_monthly || '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Tenure</span><span class="pv-val">${d.pop_tenure ? d.pop_tenure + ' months' : '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Down Payment</span><span class="pv-val">${d.pop_down_payment ? 'RM ' + parseFloat(d.pop_down_payment).toLocaleString() : '-'}</span></div>
                ` : ''}
                <div class="pv-row"><span class="pv-lbl">Invoice No.</span><span class="pv-val">${d.invoice_number || '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Collection Date</span><span class="pv-val">${d.closing_date || '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Invoice File</span><span class="pv-val">${d.invoice_file ? `<a href="${d.invoice_file}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);"><i class="fas fa-paperclip"></i> ${escapeHtml(d.invoice_file_name || 'View')}</a>` : '-'}</span></div>
                ${(d.sales_idea || d.plan_details || d.success_story) ? `
                <div class="pv-sub">Case Study</div>
                ${d.sales_idea ? `<div class="pv-row"><span class="pv-lbl">Sales Idea</span><span class="pv-val">${d.sales_idea}</span></div>` : ''}
                ${d.plan_details ? `<div class="pv-row"><span class="pv-lbl">Plan Details</span><span class="pv-val">${d.plan_details}</span></div>` : ''}
                ${d.success_story ? `<div class="pv-row"><span class="pv-lbl">Success Story</span><span class="pv-val">${d.success_story}</span></div>` : ''}
                ` : ''}
                ${managerButtons}
            `;
        } else {
            // Legacy: closing_record still has status='approved' (not yet archived).
            // Show the record and allow starting a new closing.
            const d = cr || {};
            container.innerHTML = pre2025Html + historyHtml + `
                <div class="cr-status approved" style="margin-bottom:14px;padding:8px 12px;border-radius:8px;background:#e8f5e9;border:1px solid #4caf50;color:#2e7d32;font-size:13px;font-weight:600;display:flex;justify-content:space-between;align-items:center;">
                    <span><i class="fas fa-check-circle"></i> Approved — Converted to Customer Profile</span>
                    <button class="btn secondary btn-sm" style="font-size:11px;" onclick="event.stopPropagation();app.archiveAndNewClosingRecord(${prospect.id})"><i class="fas fa-plus"></i> New Closing</button>
                </div>
                <div class="pv-sub">Last Closing</div>
                <div class="pv-row"><span class="pv-lbl">Product/Service</span><span class="pv-val">${d.product || '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Order Date</span><span class="pv-val">${d.order_date || '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Amount Closed</span><span class="pv-val">${d.sale_amount ? 'RM ' + parseFloat(d.sale_amount).toLocaleString() : '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Payment Method</span><span class="pv-val">${d.payment_method || '-'}</span></div>
                ${d.payment_method === 'POP' ? `
                <div class="pv-row"><span class="pv-lbl">Monthly (RM)</span><span class="pv-val">${d.pop_monthly || '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Tenure</span><span class="pv-val">${d.pop_tenure ? d.pop_tenure + ' months' : '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Down Payment</span><span class="pv-val">${d.pop_down_payment ? 'RM ' + parseFloat(d.pop_down_payment).toLocaleString() : '-'}</span></div>
                ` : ''}
                <div class="pv-row"><span class="pv-lbl">Invoice No.</span><span class="pv-val">${d.invoice_number || '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Collection Date</span><span class="pv-val">${d.closing_date || '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Invoice File</span><span class="pv-val">${d.invoice_file ? `<a href="${d.invoice_file}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);"><i class="fas fa-paperclip"></i> ${escapeHtml(d.invoice_file_name || 'View')}</a>` : '-'}</span></div>
                ${(d.sales_idea || d.plan_details || d.success_story) ? `
                <div class="pv-sub">Case Study</div>
                ${d.sales_idea ? `<div class="pv-row"><span class="pv-lbl">Sales Idea</span><span class="pv-val">${d.sales_idea}</span></div>` : ''}
                ${d.plan_details ? `<div class="pv-row"><span class="pv-lbl">Plan Details</span><span class="pv-val">${d.plan_details}</span></div>` : ''}
                ${d.success_story ? `<div class="pv-row"><span class="pv-lbl">Success Story</span><span class="pv-val">${d.success_story}</span></div>` : ''}
                ` : ''}
                <div class="pv-sub" style="margin-top:14px;">📦 Service Delivery Status</div>
                <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-top:6px;">
                    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap;">
                        <select id="cr-active-status-${prospect.id}" class="form-control" style="flex:1;min-width:140px;font-size:12px;">
                            <option value="pending" ${(!d.delivery_status||d.delivery_status==='pending')?'selected':''}>Pending Delivery</option>
                            <option value="delivered" ${d.delivery_status==='delivered'?'selected':''}>Delivered</option>
                            <option value="completed" ${d.delivery_status==='completed'?'selected':''}>Completed</option>
                        </select>
                        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap;font-size:13px;font-weight:600;color:${d.case_completed?'#166534':'var(--gray-600)'};">
                            <input type="checkbox" id="cr-active-completed-${prospect.id}" ${d.case_completed?'checked':''} style="width:15px;height:15px;cursor:pointer;">
                            Case Closed
                        </label>
                    </div>
                    <div style="margin-bottom:10px;">
                        <label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:4px;">Delivery Proof / Photo Attachment</label>
                        ${d.delivery_proof ? `<div style="margin-bottom:5px;"><a href="${d.delivery_proof}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);font-size:12px;"><i class="fas fa-paperclip"></i> ${escapeHtml(d.delivery_proof_name||'View proof')}</a> <span style="color:var(--gray-400);font-size:11px;">(upload new to replace)</span></div>` : ''}
                        <input type="file" id="cr-active-proof-${prospect.id}" accept="image/*,application/pdf" style="font-size:11px;width:100%;" onchange="(function(el){var f=el.files[0];if(!f)return;var r=new FileReader();r.onload=function(e){el.dataset.b64=e.target.result;el.dataset.fname=f.name;};r.readAsDataURL(f);})(this)">
                    </div>
                    <div style="margin-bottom:10px;">
                        <label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:4px;">Remarks</label>
                        <textarea id="cr-active-remarks-${prospect.id}" class="form-control" rows="2" style="font-size:12px;" placeholder="Post-sale notes, delivery details, special requests...">${escapeHtml(d.delivery_remarks||'')}</textarea>
                    </div>
                    <button class="btn primary btn-sm" style="width:100%;height:32px;" onclick="event.stopPropagation();app.saveClosingDeliveryStatus(${prospect.id})"><i class="fas fa-save"></i> Save Delivery Status</button>
                </div>
            `;
        }
    }
    else if (tab === 'bujishu' || tab === 'formula') {
        const cfg = tab === 'bujishu'
            ? { key: 'bujishu_purchases', title: '💎 Bujishu Product Purchase History', headerBg: '#f3e8ff', headerColor: '#6b21a8' }
            : { key: 'formula_healthcare_purchases', title: '🧬 Formula Healthcare Product Purchase History', headerBg: '#dcfce7', headerColor: '#15803d' };
        const pid = prospect.id;
        let records = [];
        try {
            const src = prospect.closing_record?.[cfg.key];
            records = Array.isArray(src) ? src : JSON.parse(src || '[]');
        } catch(_) {}

        // ── Formula Healthcare: include refill reminder columns + product dropdown ──
        // Reads from the 'formula' Marketing List table (Marketing → Lists → Formula).
        // Only items with capsules_per_bottle + daily_dosage configured are eligible
        // for refill reminders.
        const isFormula = tab === 'formula';
        let hcProducts = [];
        if (isFormula) {
            try {
                hcProducts = ((await AppDataStore.getAll('formula')) || [])
                    .filter(f => f.is_active !== false && f.capsules_per_bottle && f.daily_dosage);
            } catch(_) { hcProducts = []; }
        }

        const fmtFinish = (r) => {
            if (!r.estimated_finish_date) return '-';
            if (r.reminder_dismissed_at) return `<span style="color:var(--gray-400);text-decoration:line-through;">${r.estimated_finish_date}</span>`;
            const today = new Date(); today.setHours(0,0,0,0);
            const finish = new Date(r.estimated_finish_date);
            const days = Math.round((finish - today) / 86400000);
            let color = 'var(--gray-600)';
            let suffix = '';
            if (days < 0) { color = '#dc2626'; suffix = ` <span style="font-size:10px;">(${Math.abs(days)}d overdue)</span>`; }
            else if (days <= 7) { color = '#d97706'; suffix = ` <span style="font-size:10px;">(${days}d left)</span>`; }
            else { suffix = ` <span style="font-size:10px;color:var(--gray-400);">(${days}d left)</span>`; }
            return `<span style="color:${color};">${r.estimated_finish_date}${suffix}</span>`;
        };

        const rowsHtml = records.length
            ? records.map((r, i) => `
                <tr>
                    <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;">
                        ${escapeHtml(r.product || '')}
                        ${isFormula && r.quantity ? `<div style="font-size:10px;color:var(--gray-400);">qty ${r.quantity}${r.daily_dosage_override ? ' · '+r.daily_dosage_override+'/day' : ''}</div>` : ''}
                    </td>
                    <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;color:var(--gray-600);">${escapeHtml(r.purchase_date || '-')}</td>
                    ${isFormula ? `<td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:12px;">${fmtFinish(r)}</td>` : ''}
                    <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;text-align:right;">${r.amount ? 'RM ' + parseFloat(r.amount).toLocaleString() : '-'}</td>
                    <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;color:var(--gray-500);">${escapeHtml(r.notes || '-')}</td>
                    <td style="padding:4px 8px;border-bottom:1px solid #f3f4f6;text-align:center;">
                        ${r.attachment_data
                            ? `<a href="${r.attachment_data}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(r.attachment_name||'View attachment')}" style="color:var(--primary);margin-right:4px;"><i class="fas fa-paperclip"></i></a>`
                            : `<label for="${tab}-att-${pid}-${i}" title="Attach file" style="cursor:pointer;color:var(--gray-400);margin-right:4px;"><i class="fas fa-paperclip"></i></label>`
                        }
                        <input type="file" id="${tab}-att-${pid}-${i}" style="display:none" accept="image/*,application/pdf" onchange="event.stopPropagation();app.addProductPurchaseAttachment(${pid},'${tab}',${i},this)">
                    </td>
                    <td style="padding:4px 8px;border-bottom:1px solid #f3f4f6;text-align:center;">
                        <button class="btn-icon" style="color:var(--error);" onclick="event.stopPropagation();app.deleteProductPurchaseRecord(${pid},'${tab}',${i})" title="Remove"><i class="fas fa-times"></i></button>
                    </td>
                </tr>`).join('')
            : `<tr><td colspan="${isFormula ? 7 : 6}" style="padding:10px;text-align:center;color:var(--gray-400);font-size:12px;font-style:italic;">No purchase records yet</td></tr>`;
        const totalAmount = records.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);

        // Product input: dropdown for Formula Healthcare (if items configured), text field otherwise
        const productInputHtml = isFormula && hcProducts.length > 0
            ? `<select id="${tab}-product-${pid}" class="form-control" style="flex:2;min-width:160px;height:32px;font-size:12px;">
                    <option value="">-- Select Formula product --</option>
                    ${hcProducts.map(p => `<option value="${p.id}" data-caps="${p.capsules_per_bottle || ''}" data-dose="${p.daily_dosage || ''}" data-name="${escapeHtml(p.name)}">${escapeHtml(p.name)} (${p.capsules_per_bottle || '?'} caps · ${p.daily_dosage || '?'}/day)</option>`).join('')}
                </select>`
            : `<input id="${tab}-product-${pid}" class="form-control" style="flex:2;min-width:140px;height:32px;font-size:12px;" placeholder="Product name">`;

        const emptyProductsBanner = isFormula && hcProducts.length === 0
            ? `<div style="padding:8px 10px;background:#fef3c7;border-bottom:1px solid #fde68a;font-size:12px;color:#92400e;">
                    <i class="fas fa-info-circle"></i> No Formula products configured yet. Go to <strong>Marketing → Lists → Formula</strong> → Add New Formula → fill in <strong>Capsules per bottle</strong> and <strong>Daily dosage</strong> to enable refill reminders.
                </div>`
            : '';

        container.innerHTML = `
            <div style="margin-bottom:12px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
                <div style="background:${cfg.headerBg};padding:8px 12px;font-weight:600;font-size:13px;border-bottom:1px solid #e5e7eb;color:${cfg.headerColor};display:flex;justify-content:space-between;align-items:center;">
                    <span>${cfg.title}</span>
                    <span style="font-size:12px;">Total: RM ${totalAmount.toLocaleString()}</span>
                </div>
                ${emptyProductsBanner}
                <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:${isFormula ? 680 : 560}px;">
                    <thead><tr style="background:#fafafa;">
                        <th scope="col" style="padding:6px 10px;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:600;">Product</th>
                        <th scope="col" style="padding:6px 10px;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:600;">Date</th>
                        ${isFormula ? `<th scope="col" style="padding:6px 10px;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:600;">Est. Finish</th>` : ''}
                        <th scope="col" style="padding:6px 10px;text-align:right;border-bottom:1px solid #e5e7eb;font-weight:600;">Amount</th>
                        <th scope="col" style="padding:6px 10px;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:600;">Notes</th>
                        <th scope="col" style="padding:4px;width:36px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:600;font-size:11px;">File</th>
                        <th scope="col" style="padding:4px;width:36px;border-bottom:1px solid #e5e7eb;"></th>
                    </tr></thead>
                    <tbody id="${tab}-rows-${pid}">${rowsHtml}</tbody>
                </table>
                </div>
                <div style="padding:8px 10px;border-top:1px solid #e5e7eb;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                    ${productInputHtml}
                    ${isFormula ? `<input id="${tab}-qty-${pid}" type="number" min="1" step="1" class="form-control" style="width:70px;height:32px;font-size:12px;" placeholder="Qty" value="1">` : ''}
                    <input id="${tab}-date-${pid}" type="date" class="form-control" style="flex:1;min-width:120px;height:32px;font-size:12px;" value="${new Date().toISOString().slice(0,10)}">
                    <input id="${tab}-amount-${pid}" type="number" step="0.01" class="form-control" style="flex:1;min-width:100px;height:32px;font-size:12px;" placeholder="Amount (RM)">
                    ${isFormula ? `<input id="${tab}-dosage-${pid}" type="number" step="0.5" class="form-control" style="width:100px;height:32px;font-size:12px;" placeholder="Dosage/day" title="Override default dosage for this customer">` : ''}
                    <input id="${tab}-notes-${pid}" class="form-control" style="flex:2;min-width:140px;height:32px;font-size:12px;" placeholder="Notes (optional)">
                    <label for="${tab}-file-${pid}" title="Attach a file" style="cursor:pointer;height:32px;padding:0 10px;display:flex;align-items:center;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb;color:var(--gray-500);">
                        <i class="fas fa-paperclip"></i>
                    </label>
                    <input id="${tab}-file-${pid}" type="file" style="display:none" accept="image/*,application/pdf">
                    <button class="btn secondary btn-sm" onclick="event.stopPropagation();app.addProductPurchaseRow(${pid},'${tab}')" style="white-space:nowrap;height:32px;"><i class="fas fa-plus"></i> Add</button>
                </div>
            </div>
        `;
    }
    else if (tab === 'fengshui') {
        // ── ⑦c Feng Shui Audit — sequence per audit event: layout plan file, audit report file,
        //    key notes, product selections (products/bujishu/formula — auto-flow to Potential),
        //    Before photos (up to 50 w/ remarks), After photos (up to 50 w/ remarks),
        //    Site Review entries (multi-date, remarks, up to 5 photos each).
        const pid = prospect.id;
        let audits = [];
        try {
            const src = prospect.feng_shui_audits;
            audits = Array.isArray(src) ? src : JSON.parse(src || '[]');
        } catch(_) { audits = []; }
        // Newest first
        audits = [...audits].sort((a, b) =>
            new Date(b.audit_date || 0) - new Date(a.audit_date || 0) || (b.id || 0) - (a.id || 0)
        );

        const renderAuditCard = (a) => {
            const beforePhotos = Array.isArray(a.before_photos) ? a.before_photos : [];
            const afterPhotos  = Array.isArray(a.after_photos)  ? a.after_photos  : [];
            const siteReviews  = Array.isArray(a.site_reviews)  ? a.site_reviews  : [];
            const parsedProducts = (window.app.parseSelectedItems || (() => []))(a.products || '');
            const productBadges = parsedProducts.selected.length
                ? parsedProducts.selected.map(p => `<span class="badge info" style="font-size:11px;margin:2px;">${escapeHtml(p)}</span>`).join('')
                : '<span style="color:var(--gray-400);font-size:12px;font-style:italic;">No products selected</span>';

            const renderPhotoRow = (photos, phase) => {
                const label = phase === 'before' ? 'before' : 'after';
                if (!photos.length) return `<p style="font-size:12px;color:var(--gray-400);font-style:italic;padding:8px;">No ${label} photos yet</p>`;
                return `<button class="btn btn-sm secondary" onclick="event.stopPropagation();app.openFengShuiPhotosModal(${pid},${a.id},'${phase}')" style="font-size:11px;margin-top:2px;">
                    <i class="fas fa-images"></i> ${photos.length} ${label} photo${photos.length > 1 ? 's' : ''}
                </button>`;
            };

            const renderSiteReviews = () => {
                if (!siteReviews.length) return `<p style="font-size:12px;color:var(--gray-400);font-style:italic;padding:8px;">No site reviews yet. Add one below.</p>`;
                return siteReviews
                    .slice()
                    .sort((x, y) => new Date(y.date || 0) - new Date(x.date || 0) || (y.id || 0) - (x.id || 0))
                    .map(sr => {
                        const srPhotos = Array.isArray(sr.photos) ? sr.photos : [];
                        return `
                        <div style="background:#fff;border:1px solid var(--gray-200);border-radius:6px;padding:10px;margin-bottom:8px;">
                            <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap;">
                                <input type="date" class="form-control" value="${sr.date || ''}" style="width:150px;height:30px;font-size:12px;" onchange="event.stopPropagation();app.updateFengShuiSiteReviewField(${pid},${a.id},${sr.id},'date',this.value)">
                                <span style="font-size:11px;color:var(--gray-400);">${srPhotos.length}/5 photos</span>
                                <div style="flex:1;"></div>
                                ${srPhotos.length < 5 ? `
                                    <label for="fsa-sr-photos-${a.id}-${sr.id}" class="btn secondary btn-sm" style="height:30px;font-size:11px;padding:0 8px;cursor:pointer;"><i class="fas fa-camera"></i> Add Photo</label>
                                    <input id="fsa-sr-photos-${a.id}-${sr.id}" type="file" accept="image/*" multiple style="display:none" onchange="event.stopPropagation();app.uploadFengShuiSitePhotos(${pid},${a.id},${sr.id},this)">
                                ` : ''}
                                <button class="btn btn-sm" style="height:30px;font-size:11px;padding:0 8px;color:var(--error);background:transparent;border:1px solid var(--gray-200);" onclick="event.stopPropagation();app.removeFengShuiSiteReview(${pid},${a.id},${sr.id})"><i class="fas fa-trash"></i></button>
                            </div>
                            <textarea class="form-control" rows="2" placeholder="Site review key notes / remarks..." style="font-size:12px;margin-bottom:6px;" onchange="event.stopPropagation();app.updateFengShuiSiteReviewField(${pid},${a.id},${sr.id},'remarks',this.value)">${escapeHtml(sr.remarks || '')}</textarea>
                            ${srPhotos.length > 0 ? `
                            <button class="btn btn-sm secondary" onclick="event.stopPropagation();app.openFengShuiSitePhotosModal(${pid},${a.id},${sr.id})" style="font-size:11px;margin-top:4px;">
                                <i class="fas fa-images"></i> ${srPhotos.length} photo${srPhotos.length > 1 ? 's' : ''}
                            </button>
                            ` : ''}
                        </div>`;
                    }).join('');
            };

            const fileLink = (url, name) => url
                ? `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);"><i class="fas fa-paperclip"></i> ${escapeHtml(name || 'View file')}</a>`
                : '<span style="color:var(--gray-400);font-style:italic;">Not uploaded</span>';

            return `
                <div class="fsa-card" style="border:1px solid var(--gray-200);border-radius:10px;margin-bottom:14px;overflow:hidden;background:#fafafa;">
                    <div style="background:linear-gradient(135deg,#e0f2fe,#ede9fe);padding:10px 14px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--gray-200);">
                        <div style="flex:1;min-width:200px;">
                            <div style="font-weight:600;font-size:14px;color:#1e3a8a;"><i class="fas fa-compass"></i> ${escapeHtml(a.audit_title || 'Feng Shui Audit')}</div>
                            <div style="font-size:12px;color:var(--gray-500);margin-top:2px;"><i class="fas fa-calendar"></i> ${a.audit_date || '—'}</div>
                        </div>
                        <div style="display:flex;gap:6px;">
                            <button class="btn secondary btn-sm" onclick="event.stopPropagation();app.openFengShuiAuditModal(${pid},${a.id})"><i class="fas fa-edit"></i> Edit</button>
                            <button class="btn btn-sm" style="color:var(--error);background:#fff;border:1px solid var(--gray-200);" onclick="event.stopPropagation();app.deleteFengShuiAudit(${pid},${a.id})"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>

                    <div style="padding:12px 14px;">
                        <div class="pv-row"><span class="pv-lbl">Layout Plan</span><span class="pv-val">
                            ${fileLink(a.layout_plan_url, a.layout_plan_name)}
                            <label for="fsa-layout-${a.id}" class="btn secondary btn-sm" style="margin-left:8px;height:26px;font-size:11px;padding:0 8px;cursor:pointer;"><i class="fas fa-upload"></i> ${a.layout_plan_url ? 'Replace' : 'Upload'}</label>
                            <input id="fsa-layout-${a.id}" type="file" accept=".doc,.docx,.pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf" style="display:none" onchange="event.stopPropagation();app.uploadFengShuiFile(${pid},${a.id},'layout_plan',this)">
                            ${a.layout_plan_url ? `<button class="btn btn-sm" style="margin-left:4px;height:26px;font-size:11px;padding:0 8px;color:var(--error);background:transparent;border:1px solid var(--gray-200);" onclick="event.stopPropagation();app.removeFengShuiFile(${pid},${a.id},'layout_plan')"><i class="fas fa-times"></i></button>` : ''}
                        </span></div>
                        <div class="pv-row"><span class="pv-lbl">Audit Report</span><span class="pv-val">
                            ${fileLink(a.audit_report_url, a.audit_report_name)}
                            <label for="fsa-report-${a.id}" class="btn secondary btn-sm" style="margin-left:8px;height:26px;font-size:11px;padding:0 8px;cursor:pointer;"><i class="fas fa-upload"></i> ${a.audit_report_url ? 'Replace' : 'Upload'}</label>
                            <input id="fsa-report-${a.id}" type="file" accept=".doc,.docx,.pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf" style="display:none" onchange="event.stopPropagation();app.uploadFengShuiFile(${pid},${a.id},'audit_report',this)">
                            ${a.audit_report_url ? `<button class="btn btn-sm" style="margin-left:4px;height:26px;font-size:11px;padding:0 8px;color:var(--error);background:transparent;border:1px solid var(--gray-200);" onclick="event.stopPropagation();app.removeFengShuiFile(${pid},${a.id},'audit_report')"><i class="fas fa-times"></i></button>` : ''}
                        </span></div>

                        <div class="pv-sub" style="margin-top:12px;"><i class="fas fa-key"></i> Key Notes for House / Needs</div>
                        <div style="background:#fff;border:1px solid var(--gray-200);border-radius:6px;padding:8px 10px;font-size:13px;color:var(--gray-700);white-space:pre-wrap;min-height:32px;">${escapeHtml(a.key_notes || '') || '<span style="color:var(--gray-400);font-style:italic;">No notes yet — click Edit to add</span>'}</div>

                        <div class="pv-sub" style="margin-top:12px;"><i class="fas fa-bolt"></i> Product Potential Needed
                            <span style="font-size:10px;font-weight:400;color:var(--gray-400);margin-left:6px;"><i class="fas fa-link"></i> Auto-links to Potential &amp; Opportunities</span>
                        </div>
                        <div style="background:#fff;border:1px solid var(--gray-200);border-radius:6px;padding:8px 10px;min-height:32px;">
                            ${productBadges}
                            ${parsedProducts.remarks ? `<div style="font-size:12px;color:var(--gray-600);margin-top:6px;font-style:italic;">Remarks: ${escapeHtml(parsedProducts.remarks)}</div>` : ''}
                        </div>

                        <div class="pv-sub" style="margin-top:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">
                            <span><i class="fas fa-camera-retro"></i> Before Photos <span style="font-size:10px;color:var(--gray-400);">(${beforePhotos.length}/50)</span></span>
                            ${beforePhotos.length < 50 ? `
                                <label for="fsa-before-${a.id}" class="btn secondary btn-sm" style="height:28px;font-size:11px;padding:0 8px;cursor:pointer;"><i class="fas fa-upload"></i> Upload Before</label>
                                <input id="fsa-before-${a.id}" type="file" accept="image/*" multiple style="display:none" onchange="event.stopPropagation();app.uploadFengShuiPhotos(${pid},${a.id},'before',this)">
                            ` : ''}
                        </div>
                        ${renderPhotoRow(beforePhotos, 'before')}

                        <div class="pv-sub" style="margin-top:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">
                            <span><i class="fas fa-camera-retro"></i> After Photos <span style="font-size:10px;color:var(--gray-400);">(${afterPhotos.length}/50)</span></span>
                            ${afterPhotos.length < 50 ? `
                                <label for="fsa-after-${a.id}" class="btn secondary btn-sm" style="height:28px;font-size:11px;padding:0 8px;cursor:pointer;"><i class="fas fa-upload"></i> Upload After</label>
                                <input id="fsa-after-${a.id}" type="file" accept="image/*" multiple style="display:none" onchange="event.stopPropagation();app.uploadFengShuiPhotos(${pid},${a.id},'after',this)">
                            ` : ''}
                        </div>
                        ${renderPhotoRow(afterPhotos, 'after')}

                        <div class="pv-sub" style="margin-top:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">
                            <span><i class="fas fa-clipboard-check"></i> Site Review Key Notes <span style="font-size:10px;color:var(--gray-400);">(${siteReviews.length} ${siteReviews.length === 1 ? 'entry' : 'entries'})</span></span>
                            <button class="btn secondary btn-sm" style="height:28px;font-size:11px;padding:0 8px;" onclick="event.stopPropagation();app.addFengShuiSiteReview(${pid},${a.id})"><i class="fas fa-plus"></i> Add Site Review</button>
                        </div>
                        ${renderSiteReviews()}
                    </div>
                </div>
            `;
        };

        container.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <div style="font-size:12px;color:var(--gray-500);"><i class="fas fa-info-circle"></i> ${audits.length} audit ${audits.length === 1 ? 'event' : 'events'} recorded</div>
                <button class="btn primary btn-sm" onclick="event.stopPropagation();app.openFengShuiAuditModal(${pid})"><i class="fas fa-plus"></i> New Audit Event</button>
            </div>
            ${audits.length > 0 ? audits.map(renderAuditCard).join('') : `
                <div style="text-align:center;padding:28px 14px;color:var(--gray-400);font-size:13px;background:#fafafa;border:1px dashed var(--gray-200);border-radius:8px;">
                    <i class="fas fa-compass" style="font-size:28px;display:block;margin-bottom:8px;opacity:.5;"></i>
                    No feng shui audits recorded yet.<br>
                    <span style="font-size:12px;">Click <strong>New Audit Event</strong> to log a layout plan, audit report, before/after photos, and site reviews.</span>
                </div>
            `}
        `;
    }
    else if (tab === 'journey') {
        // Lazy-load the journey chunk then render
        await window._loadChunk('chunks/script-journey.min.js');
        await (window.app.renderJourneyTab || (() => {}))('prospect', prospectId, container);
    }
};

const _refreshCustClosingAfterProspectSave = async (prospectId) => {
    const els = document.querySelectorAll('[id^="cust-acc-body-closing-"]');
    for (const el of els) {
        if (el.dataset.prospectId == prospectId) {
            const custId = el.id.replace('cust-acc-body-closing-', '');
            const cust = await AppDataStore.getById('customers', custId);
            if (cust) await renderCustomerClosingTab(cust, el);
        }
    }
};

const renderCustomerClosingTab = async (customer, container) => {
    if (!container) return;

    // ── Section 1: Purchases table (merged from former Purchase History tab) ──
    const purchases = await AppDataStore.query('purchases', { customer_id: customer.id }).catch(() => []);
    let totalPaid = 0, totalPending = 0;

    // Pull the original conversion sale from the linked prospect closing_record
    let conversionRow = '';
    if (customer.converted_from_prospect_id) {
        const origP = await AppDataStore.getById('prospects', customer.converted_from_prospect_id);
        if (origP?.closing_record) {
            const cr0 = origP.closing_record;
            const amt0 = parseFloat(cr0.sale_amount) || 0;
            totalPaid += amt0;
            conversionRow = `
                <tr style="background:#f0fdf4;">
                    <td style="padding:6px 10px;">${cr0.closing_date || customer.customer_since || '-'}</td>
                    <td style="padding:6px 10px;">${escapeHtml(cr0.invoice_number || '-')}</td>
                    <td style="padding:6px 10px;"><strong>${escapeHtml(cr0.product || '-')}</strong> <span style="font-size:11px;color:var(--gray-400);">(Conversion)</span></td>
                    <td style="padding:6px 10px;">RM ${amt0.toLocaleString('en-MY',{minimumFractionDigits:2})}</td>
                    <td style="padding:6px 10px;"><span style="background:#dcfce7;color:#166534;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;">PAID</span></td>
                    <td style="padding:6px 10px;">${(()=>{ const ds=cr0.delivery_status||'Pending Delivery'; const dc={'Pending Delivery':'background:#fef3c7;color:#92400e','Dispatched':'background:#dbeafe;color:#1e40af','Delivered':'background:#dcfce7;color:#166534'}; return `<span style="${dc[ds]||dc['Pending Delivery']};border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;cursor:pointer;" onclick="app.updateConversionDelivery(${origP.id},${customer.id})" title="Click to update">${ds} ✎</span>`; })()}</td>
                    <td style="padding:6px 10px;">${cr0.invoice_file ? `<a href="${cr0.invoice_file}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);font-size:12px;"><i class="fas fa-paperclip"></i> View</a>` : '-'}</td>
                    <td style="padding:6px 10px;font-size:11px;color:var(--gray-400);">Locked</td>
                </tr>`;
        }
    }

    const purchaseRows = purchases.map(p => {
        const amt = parseFloat(p.amount) || 0;
        if (p.status !== 'PENDING') totalPaid += amt; else totalPending += amt;
        const statusColor = p.status === 'PAID' ? '#dcfce7;color:#166534' : p.status === 'PENDING' ? '#fef9c3;color:#854d0e' : '#e0e7ff;color:#3730a3';
        return `
            <tr>
                <td style="padding:6px 10px;">${p.date || '-'}</td>
                <td style="padding:6px 10px;">${escapeHtml(p.invoice || '-')}</td>
                <td style="padding:6px 10px;">${escapeHtml(p.item || '-')}</td>
                <td style="padding:6px 10px;">RM ${amt.toLocaleString('en-MY',{minimumFractionDigits:2})}</td>
                <td style="padding:6px 10px;"><span style="background:${statusColor};border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;">${p.status}</span></td>
                <td style="padding:6px 10px;">${(()=>{ const ds=p.delivery_status||'Pending Delivery'; const dc={'Pending Delivery':'background:#fef3c7;color:#92400e','Dispatched':'background:#dbeafe;color:#1e40af','Delivered':'background:#dcfce7;color:#166534'}; return `<span style="${dc[ds]||dc['Pending Delivery']};border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;cursor:pointer;" onclick="app.updatePurchaseDelivery(${p.id},${customer.id})" title="Click to update">${ds} ✎</span>`; })()}</td>
                <td style="padding:6px 10px;">${p.proof
                    ? `<a href="#" style="color:var(--primary);font-size:12px;"><i class="fas fa-paperclip"></i> ${p.proof.endsWith('.pdf') ? 'Report' : 'Image'}</a>`
                    : `<button class="btn secondary btn-sm" style="font-size:11px;padding:2px 8px;" onclick="app.uploadPaymentProof(${p.id},${customer.id})">Upload</button>`}</td>
                <td style="padding:6px 10px;">
                    ${p.status === 'PENDING' ? `<button class="btn-icon" title="Delete" onclick="app.deletePurchase(${p.id},${customer.id})"><i class="fas fa-trash" style="color:var(--error);font-size:12px;"></i></button>` : ''}
                </td>
            </tr>`;
    }).join('');

    const purchasesHtml = `
        <div style="margin-bottom:16px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
            <div style="background:#f8fafc;padding:8px 12px;font-weight:600;font-size:13px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;">
                <span><i class="fas fa-shopping-cart" style="color:var(--primary);margin-right:6px;"></i>Purchase Records</span>
                <button class="btn primary btn-sm" style="font-size:12px;" onclick="app.openAddPurchaseModal(${customer.id})"><i class="fas fa-plus"></i> Add Purchase</button>
            </div>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead><tr style="background:#fafafa;border-bottom:1px solid #e5e7eb;">
                        <th style="padding:6px 10px;text-align:left;font-weight:600;">Date</th>
                        <th style="padding:6px 10px;text-align:left;font-weight:600;">Invoice #</th>
                        <th style="padding:6px 10px;text-align:left;font-weight:600;">Item / Product</th>
                        <th style="padding:6px 10px;text-align:left;font-weight:600;">Amount</th>
                        <th style="padding:6px 10px;text-align:left;font-weight:600;">Payment</th>
                        <th style="padding:6px 10px;text-align:left;font-weight:600;">Delivery</th>
                        <th style="padding:6px 10px;text-align:left;font-weight:600;">Proof</th>
                        <th style="padding:4px;width:32px;"></th>
                    </tr></thead>
                    <tbody style="border-bottom:1px solid #e5e7eb;">
                        ${conversionRow}${purchaseRows}
                        ${!conversionRow && !purchaseRows ? `<tr><td colspan="8" style="padding:14px;text-align:center;color:var(--gray-400);font-size:12px;font-style:italic;">No purchase records yet.</td></tr>` : ''}
                    </tbody>
                </table>
            </div>
            <div style="padding:10px 12px;display:flex;gap:16px;font-size:13px;flex-wrap:wrap;background:#fafafa;">
                <span>Paid: <strong style="color:#166534;">RM ${totalPaid.toLocaleString('en-MY',{minimumFractionDigits:2})}</strong></span>
                <span>Pending: <strong style="color:#854d0e;">RM ${totalPending.toLocaleString('en-MY',{minimumFractionDigits:2})}</strong></span>
                <span style="margin-left:auto;">Lifetime Total: <strong style="color:var(--primary);">RM ${(totalPaid+totalPending).toLocaleString('en-MY',{minimumFractionDigits:2})}</strong></span>
            </div>
        </div>`;

    const prospectId = customer.converted_from_prospect_id;
    if (!prospectId) {
        container.innerHTML = purchasesHtml;
        return;
    }
    container.dataset.prospectId = prospectId;
    const prospect = await AppDataStore.getByIdFull('prospects', prospectId);
    if (!prospect) {
        container.innerHTML = '<p style="text-align:center;padding:20px;color:var(--gray-400);">Linked prospect not found.</p>';
        return;
    }

    const cr = prospect.closing_record || null;
    const status = cr?.status || 'draft';
    const isManager = isSystemAdmin(_currentUser) || isMarketingManager(_currentUser);
    const pid = prospect.id;

    // Before 2025 Purchase Record
    let pre2025 = [];
    try {
        const src = prospect.closing_record?.pre2025_purchases || prospect.pre2025_purchases;
        pre2025 = Array.isArray(src) ? src : JSON.parse(src || '[]');
    } catch(_) {}
    const pre2025Rows = pre2025.length
        ? pre2025.map((r, i) => `
            <tr>
                <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;">${escapeHtml(r.product || '')}</td>
                <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;color:var(--gray-500);">${escapeHtml(r.notes || '-')}</td>
                <td style="padding:4px 8px;border-bottom:1px solid #f3f4f6;text-align:center;">
                    ${r.attachment_data
                        ? `<a href="${r.attachment_data}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(r.attachment_name||'View attachment')}" style="color:var(--primary);margin-right:4px;"><i class="fas fa-paperclip"></i></a>`
                        : `<label for="pre2025-att-${pid}-${i}" title="Attach file" style="cursor:pointer;color:var(--gray-400);margin-right:4px;"><i class="fas fa-paperclip"></i></label>`
                    }
                    <input type="file" id="pre2025-att-${pid}-${i}" style="display:none" accept="image/*,application/pdf" onchange="event.stopPropagation();app.addPrePurchaseAttachment(${pid},${i},this)">
                </td>
                <td style="padding:4px 8px;border-bottom:1px solid #f3f4f6;text-align:center;">
                    <button class="btn-icon" style="color:var(--error);" onclick="event.stopPropagation();app.deletePrePurchaseRecord(${pid},${i})" title="Remove"><i class="fas fa-times"></i></button>
                </td>
            </tr>`).join('')
        : `<tr><td colspan="4" style="padding:10px;text-align:center;color:var(--gray-400);font-size:12px;font-style:italic;">No past records yet</td></tr>`;
    const pre2025Html = `
        <div style="margin-bottom:16px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
            <div style="background:#fef9ec;padding:8px 12px;font-weight:600;font-size:13px;border-bottom:1px solid #e5e7eb;color:#78400b;">
                📋 Before 2025 Purchase Record
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#fafafa;">
                    <th scope="col" style="padding:6px 10px;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:600;">Product / Service</th>
                    <th scope="col" style="padding:6px 10px;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:600;">Notes</th>
                    <th scope="col" style="padding:4px;width:36px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:600;font-size:11px;">File</th>
                    <th scope="col" style="padding:4px;width:36px;border-bottom:1px solid #e5e7eb;"></th>
                </tr></thead>
                <tbody id="pre2025-rows-${pid}">${pre2025Rows}</tbody>
            </table>
            <div style="padding:8px 10px;border-top:1px solid #e5e7eb;display:flex;gap:6px;align-items:center;">
                <input id="pre2025-product-${pid}" class="form-control" style="flex:1;height:32px;font-size:12px;" placeholder="Product / Service">
                <input id="pre2025-notes-${pid}" class="form-control" style="flex:1;height:32px;font-size:12px;" placeholder="Notes (optional)">
                <label for="pre2025-file-${pid}" title="Attach a file (AI will auto-read)" style="cursor:pointer;height:32px;padding:0 10px;display:flex;align-items:center;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb;color:var(--gray-500);">
                    <i class="fas fa-paperclip"></i>
                </label>
                <input id="pre2025-file-${pid}" type="file" style="display:none" accept="image/*,application/pdf" onchange="app.scanInvoiceWithAI(this,${pid},'pre2025')">
                <button class="btn secondary btn-sm" onclick="event.stopPropagation();app.addPrePurchaseRow(${pid})" style="white-space:nowrap;height:32px;"><i class="fas fa-plus"></i> Add</button>
            </div>
        </div>`;

    // Closing History
    const crHistory = Array.isArray(prospect.closing_records_history) ? prospect.closing_records_history : [];
    const _crBadge = (h) => {
        if (h.case_completed) return `<span style="background:#dcfce7;color:#166534;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;"><i class="fas fa-check-circle"></i> Completed</span>`;
        const s = h.delivery_status || 'pending';
        if (s === 'delivered') return `<span style="background:#dbeafe;color:#1e40af;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;"><i class="fas fa-truck"></i> Delivered</span>`;
        return `<span style="background:#fef9c3;color:#854d0e;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;"><i class="fas fa-clock"></i> Pending</span>`;
    };
    const historyHtml = crHistory.length ? `
        <div style="margin-bottom:16px;border:1px solid #e5e7eb;border-radius:8px;">
            <div style="background:#f0fdf4;padding:8px 12px;font-weight:600;font-size:13px;border-bottom:1px solid #e5e7eb;color:#166534;border-radius:8px 8px 0 0;">
                <i class="fas fa-history"></i> Closing History (${crHistory.length} record${crHistory.length>1?'s':''})
            </div>
            ${crHistory.map((h, hi) => `
                <details style="border-bottom:1px solid #f3f4f6;">
                    <summary style="padding:8px 12px;cursor:pointer;font-size:13px;font-weight:600;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:8px;">
                        <span style="flex:1;">#${hi+1} — ${escapeHtml(h.product||'N/A')} · RM ${h.sale_amount ? parseFloat(h.sale_amount).toLocaleString() : '0'}</span>
                        ${_crBadge(h)}
                        <span style="font-size:11px;color:var(--gray-400);font-weight:400;">${h.closing_date || (h.approved_at ? h.approved_at.split('T')[0] : '')}</span>
                    </summary>
                    <div style="padding:10px 12px;background:#fafafa;font-size:12px;border-top:1px solid #f3f4f6;">
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;margin-bottom:10px;">
                            <div><span style="color:var(--gray-400);">Payment:</span> ${escapeHtml(h.payment_method||'-')}</div>
                            <div><span style="color:var(--gray-400);">Invoice:</span> ${escapeHtml(h.invoice_number||'-')}</div>
                            <div style="grid-column:1/-1;">
                                ${h.invoice_file
                                    ? `<a href="${h.invoice_file}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);"><i class="fas fa-paperclip"></i> ${escapeHtml(h.invoice_file_name||'View invoice')}</a>`
                                    : `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11px;background:#fffbeb;border:1px dashed #f59e0b;border-radius:6px;padding:6px 8px;">
                                        <span style="color:#92400e;"><i class="fas fa-exclamation-triangle"></i> No invoice attached.</span>
                                        <input type="file" id="crh-inv-${pid}-${hi}" accept="image/*,application/pdf" style="font-size:11px;flex:1;min-width:140px;">
                                        <button class="btn secondary btn-sm" style="padding:2px 8px;font-size:11px;height:24px;" onclick="event.stopPropagation();app.uploadHistoryInvoice(${pid},${hi})"><i class="fas fa-upload"></i> Upload</button>
                                      </div>`}
                            </div>
                            ${h.closing_remarks ? `<div style="grid-column:1/-1;"><span style="color:var(--gray-400);">Sale Remarks:</span> ${escapeHtml(h.closing_remarks)}</div>` : ''}
                        </div>
                        <div style="border-top:1px solid #e5e7eb;padding-top:10px;">
                            <div style="font-size:11px;font-weight:700;color:var(--gray-500);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">📦 Delivery Tracking</div>
                            <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
                                <select id="crh-status-${pid}-${hi}" class="form-control" style="flex:1;min-width:120px;font-size:12px;">
                                    <option value="pending" ${(!h.delivery_status||h.delivery_status==='pending')?'selected':''}>Pending Delivery</option>
                                    <option value="delivered" ${h.delivery_status==='delivered'?'selected':''}>Delivered</option>
                                    <option value="completed" ${h.delivery_status==='completed'?'selected':''}>Completed</option>
                                </select>
                                <label style="display:flex;align-items:center;gap:5px;cursor:pointer;white-space:nowrap;font-weight:600;color:${h.case_completed?'#166534':'var(--gray-600)'};">
                                    <input type="checkbox" id="crh-completed-${pid}-${hi}" ${h.case_completed?'checked':''} style="width:15px;height:15px;cursor:pointer;">
                                    Case Completed
                                </label>
                            </div>
                            <div style="margin-bottom:8px;">
                                <label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:4px;">Delivery Proof Attachment</label>
                                ${h.delivery_proof ? `<div style="margin-bottom:4px;"><a href="${h.delivery_proof}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);font-size:12px;"><i class="fas fa-paperclip"></i> ${escapeHtml(h.delivery_proof_name||'View proof')}</a> <span style="color:var(--gray-400);font-size:11px;">(upload new to replace)</span></div>` : ''}
                                <input type="file" id="crh-proof-${pid}-${hi}" accept="image/*,application/pdf" style="font-size:11px;width:100%;" onchange="(function(el){var f=el.files[0];if(!f)return;var r=new FileReader();r.onload=function(e){el.dataset.b64=e.target.result;el.dataset.fname=f.name;};r.readAsDataURL(f);})(this)">
                            </div>
                            <div style="margin-bottom:8px;">
                                <label style="font-size:11px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:4px;">Remarks</label>
                                <textarea id="crh-remarks-${pid}-${hi}" class="form-control" rows="2" style="font-size:12px;" placeholder="Post-sale notes, delivery details...">${escapeHtml(h.delivery_remarks||'')}</textarea>
                            </div>
                            <button class="btn primary btn-sm" style="width:100%;height:30px;" onclick="event.stopPropagation();app.saveClosingHistoryEntry(${pid},${hi})"><i class="fas fa-save"></i> Save</button>
                        </div>
                    </div>
                </details>`).join('')}
        </div>` : '';

    // Active closing record (submitted, awaiting approval)
    let activeHtml = '';
    if (cr && status === 'submitted') {
        const d = cr;
        if (isManager) {
            const isConverted = prospect.status === 'converted' || prospect.conversion_status === 'approved';
            activeHtml = `
                <div style="margin-bottom:10px;padding:8px 12px;border-radius:8px;background:#e3f2fd;border:1px solid #2196f3;color:#1565c0;font-size:13px;font-weight:600;">
                    <i class="fas fa-clock"></i> Active submission pending approval
                </div>
                <div class="pv-sub">Meeting Outcome</div>
                <div class="pv-row"><span class="pv-lbl">Product/Service</span><span class="pv-val">${d.product || '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Amount</span><span class="pv-val">${d.sale_amount ? 'RM ' + parseFloat(d.sale_amount).toLocaleString() : '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Payment</span><span class="pv-val">${d.payment_method || '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Invoice</span><span class="pv-val">${d.invoice_number || '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Collection Date</span><span class="pv-val">${d.closing_date || '-'}</span></div>
                <div style="display:flex;gap:8px;margin-top:12px;">
                    <button class="btn primary btn-sm" style="flex:1;" onclick="event.stopPropagation();app.approveClosingRecord(${pid})"><i class="fas fa-check"></i> ${isConverted ? 'Approve Sale' : 'Approve & Create Customer'}</button>
                    <button class="btn danger btn-sm" style="flex:1;" onclick="event.stopPropagation();app.rejectClosingRecord(${pid})"><i class="fas fa-times"></i> Reject</button>
                </div>`;
        } else {
            activeHtml = `
                <div style="padding:8px 12px;border-radius:8px;background:#e3f2fd;border:1px solid #2196f3;color:#1565c0;font-size:13px;font-weight:600;margin-bottom:12px;">
                    <i class="fas fa-clock"></i> Active closing record pending manager approval.
                </div>`;
        }
    }

    container.innerHTML = pre2025Html + historyHtml + activeHtml ||
        pre2025Html + '<p style="text-align:center;padding:16px;color:var(--gray-400);font-size:13px;">No closing records yet.</p>';
};

// Accordion toggle — expand/collapse a prospect profile section.
// Content is lazy-loaded on first open via switchProspectTab.
const toggleAccordion = async (tab, prospectId, itemEl) => {
    const bodyEl = document.getElementById(`acc-body-${tab}-${prospectId}`);
    if (!bodyEl) return;
    const isOpen = itemEl.classList.contains('open');
    if (isOpen) {
        bodyEl.style.display = 'none';
        itemEl.classList.remove('open');
    } else {
        bodyEl.style.display = 'block';
        itemEl.classList.add('open');
        if (bodyEl.dataset.loaded === 'false') {
            bodyEl.dataset.loaded = 'true';
            bodyEl.innerHTML = '<div class="acc-loading"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';
            await switchProspectTab(tab, prospectId, null, bodyEl);
        }
    }
};

const toggleCustomerAccordion = async (tab, customerId, itemEl) => {
    const bodyEl = document.getElementById(`cust-acc-body-${tab}-${customerId}`);
    if (!bodyEl) return;
    const isOpen = itemEl.classList.contains('open');
    if (isOpen) {
        bodyEl.style.display = 'none';
        itemEl.classList.remove('open');
    } else {
        bodyEl.style.display = 'block';
        itemEl.classList.add('open');
        if (bodyEl.dataset.loaded === 'false') {
            bodyEl.dataset.loaded = 'true';
            bodyEl.innerHTML = '<div class="acc-loading"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';
            await switchCustomerProfileTab(tab, customerId, bodyEl);
        }
    }
};

const editProspect = async (prospectId) => await openProspectModal(prospectId);

// Export prospect as a vCard 3.0 (.vcf) so the user can save the contact
// straight into their phone address book. iOS Safari and Android Chrome
// both open the downloaded file in the native Contacts app.
const downloadProspectVCard = async (prospectId) => {
    const p = await AppDataStore.getById('prospects', prospectId);
    if (!p) { UI.toast.error('Prospect not found'); return; }
    if (!p.phone && !p.email) {
        UI.toast.error('Prospect has no phone or email to save');
        return;
    }

    // RFC 2426 escape: backslash, newline, comma, semicolon
    const esc = (v) => String(v || '')
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;');

    const fullName = p.full_name || '';
    const displayName = p.nickname ? `${fullName} (${p.nickname})` : fullName;

    const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
    lines.push(`FN:${esc(displayName)}`);
    // Put the whole name in the surname slot — no surname/first-name split
    lines.push(`N:${esc(fullName)};;;;`);
    if (p.nickname)  lines.push(`NICKNAME:${esc(p.nickname)}`);
    if (p.phone)     lines.push(`TEL;TYPE=CELL:${esc(p.phone)}`);
    if (p.email)     lines.push(`EMAIL;TYPE=INTERNET:${esc(p.email)}`);

    const org = p.is_own_business && p.business_name
        ? `${p.company_name || ''};${p.business_name}`
        : (p.company_name || '');
    if (org.replace(/;/g, '')) lines.push(`ORG:${esc(org)}`);

    const title = p.emp_title_role || p.occupation;
    if (title) lines.push(`TITLE:${esc(title)}`);

    if (p.address || p.city || p.state || p.postal_code) {
        lines.push(
            `ADR;TYPE=HOME:;;${esc(p.address)};${esc(p.city)};${esc(p.state)};${esc(p.postal_code)};${esc(p.nationality)}`
        );
    }

    if (p.date_of_birth && /^\d{4}-\d{2}-\d{2}$/.test(p.date_of_birth)) {
        lines.push(`BDAY:${p.date_of_birth}`);
    }

    lines.push('NOTE:DC CRM');
    lines.push('URL:https://destinoraclessolution.com');
    lines.push(`REV:${new Date().toISOString()}`);
    lines.push('END:VCARD');

    // RFC 2426 requires CRLF line endings
    const vcard = lines.join('\r\n');
    const blob  = new Blob([vcard], { type: 'text/vcard;charset=utf-8' });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href = url;
    a.download = `${(fullName || 'contact').replace(/[^\w\-]+/g, '_')}.vcf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    UI.toast.success('Contact downloaded — tap the file to save to your phone');
};

const addNote = async (prospectId) => {
    const text = document.getElementById('new-note-text')?.value?.trim();
    if (!text) return;
    const currentUser = await Auth.getCurrentUser();

    // Auto-link to the most recent meet-up so the note surfaces under
    // Meet Up History too — otherwise notes-tab entries get orphaned
    // from the activity context the agent was actually referring to.
    const MEETUP_TYPES = ['CPS','FTF','FSA','GR','XG','CALL','EMAIL','WHATSAPP'];
    // Indexed: returns this prospect's rows pre-sorted activity_date DESC.
    const _latestActs = await AppDataStore.getActivitiesForProspect(prospectId, { limit: 100 });
    const latestActivity = _latestActs.find(a => MEETUP_TYPES.includes(a.activity_type));

    await AppDataStore.create('notes', {
        id: Date.now(),
        prospect_id: prospectId,
        activity_id: latestActivity?.id || null,
        text: text,
        author: currentUser?.full_name || 'Michelle Tan',
        date: new Date().toISOString().split('T')[0]
    });

    // Mirror the text into the activity's summary so the Meet Up History
    // card renders it (the card reads activity columns, not the notes table).
    if (latestActivity) {
        const existing = (latestActivity.summary || '').trim();
        const appended = existing ? `${existing}\n${text}` : text;
        try {
            await AppDataStore.update('activities', latestActivity.id, { summary: appended });
            AppDataStore.invalidateCache?.('activities');
        } catch (e) {
            console.warn('addNote: failed to mirror into activity summary:', e);
        }
    }

    document.getElementById('new-note-text').value = '';
    UI.toast.success('Note added');
    await switchProspectTab('notes', prospectId, null, document.getElementById(`acc-body-notes-${prospectId}`));
};


const deleteNote = async (prospectId, noteId) => {
UI.confirm('Delete Note?', 'Are you sure you want to delete this note?', async () => {
    await AppDataStore.delete('notes', noteId);
    UI.toast.success('Note deleted');
    await switchProspectTab('notes', prospectId, null, document.getElementById(`acc-body-notes-${prospectId}`));
});
};

// Shows a modal with SQL that adds the photo_urls column. Pattern follows migratePromotionsTable.
const showPhotoUrlsMigrationModal = () => {
    const migrationSQL = `ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS photo_urls jsonb DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';`;
    const escaped = migrationSQL.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    UI.showModal('⚠️ One-time Database Setup Required', `
        <p style="margin-bottom:12px;">The <strong>activities</strong> table is missing the <code>photo_urls</code> column needed to store meet-up photos so they sync across devices. Run this SQL once in your <a href="https://supabase.com/dashboard/project/remuwhxvzkzjtgbzqjaa/sql/new" target="_blank" rel="noopener noreferrer" style="color:var(--primary);font-weight:600;">Supabase SQL Editor ↗</a>:</p>
        <textarea class="form-control" rows="6" id="photo-migration-sql" style="font-family:monospace;font-size:12px;background:#1e1e1e;color:#d4d4d4;border:none;resize:none;width:100%;">${escaped}</textarea>
        <button class="btn secondary" style="margin-top:8px;" onclick="document.getElementById('photo-migration-sql').select();document.execCommand('copy');UI.toast.success('SQL copied to clipboard!')">
            <i class="fas fa-copy"></i> Copy SQL
        </button>
        <p style="margin-top:12px;font-size:12px;color:var(--gray-600);">After running the SQL, come back and click the Photo button again.</p>
    `, [{ label: 'Close', type: 'primary', action: 'UI.hideModal()' }]);
};

// Probes whether activities.photo_urls exists by writing a no-op update. Returns true if column exists.
const checkPhotoUrlsColumn = async () => {
    try {
        const sb = window.supabase || window.supabaseClient;
        if (!sb) return false;
        const { error } = await sb.from('activities').select('photo_urls').limit(1);
        if (!error) return true;
        if (error.message && /photo_urls/i.test(error.message)) return false;
        return false;
    } catch (e) { return false; }
};

const attachActivityPhoto = async (activityId) => {
    // Use the robust lookup chain so consultants/co-agents whose RLS scope
    // doesn't expose the row directly can still attach photos — the row is
    // already in _hotActivityCache / pin board from the calendar render.
    const activity = await _lookupActivityRobust(activityId);
    if (!activity) { UI.toast.error('Meet up record not found'); return; }

    // Verify the Supabase schema is ready — otherwise photos would only live in localStorage
    const columnOk = await checkPhotoUrlsColumn();
    if (!columnOk) { showPhotoUrlsMigrationModal(); return; }

    const existing = Array.isArray(activity.photo_urls) ? activity.photo_urls : [];
    const content = `
        <div class="form-group">
            <label>Select one or more photos</label>
            <input type="file" id="activity-photo-upload" class="form-control" accept="image/*" multiple>
            <p style="color:var(--gray-500);font-size:12px;margin-top:6px;">JPG/PNG, max 5MB each. You can pick multiple files.</p>
        </div>
        ${existing.length > 0 ? `
        <div class="form-group">
            <label>Existing Photos (${existing.length})</label>
            <div style="display:flex;flex-wrap:wrap;gap:8px;max-height:180px;overflow:auto;padding:6px;border:1px solid var(--gray-200);border-radius:6px;">
                ${existing.map((url, i) => `
                    <div style="position:relative;">
                        <img loading="lazy" decoding="async" data-attach-src="${url}" style="height:70px;border-radius:4px;object-fit:cover;cursor:pointer;" onclick="window._openAttachment('${url}')">
                        <button type="button" class="btn-icon" style="position:absolute;top:-6px;right:-6px;background:var(--error);color:white;border-radius:50%;width:20px;height:20px;font-size:10px;padding:0;" title="Remove" onclick="app.removeActivityPhoto(${activityId}, '${url}', 'upload')"><i class="fas fa-times"></i></button>
                    </div>
                `).join('')}
            </div>
        </div>` : ''}
    `;
    UI.showModal('Attach Meet Up Photo', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Upload', type: 'primary', action: `(async () => { await app.saveActivityPhoto(${activityId}); })()` }
    ]);
};

// Photo VIEWER for a meet-up activity — opens a gallery of existing photos.
// Falls back to the upload flow when there are no photos yet.
const viewActivityPhotos = async (activityId) => {
    const activity = await _lookupActivityRobust(activityId);
    if (!activity) { UI.toast.error('Meet up record not found'); return; }
    const photos = Array.isArray(activity.photo_urls) ? activity.photo_urls : [];

    // Nothing to view → jump straight to the upload modal so the tap still feels useful.
    if (photos.length === 0) {
        return attachActivityPhoto(activityId);
    }

    const content = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;max-height:60vh;overflow:auto;padding:4px;">
            ${photos.map((url, i) => `
                <div style="position:relative;">
                    <img loading="lazy" decoding="async" src="${escapeHtml(url)}" style="width:100%;height:120px;border-radius:6px;object-fit:cover;cursor:zoom-in;border:1px solid var(--gray-200);" onclick="window._openAttachment && window._openAttachment('${escapeHtml(url)}')">
                    <button type="button" class="btn-icon" style="position:absolute;top:-6px;right:-6px;background:var(--error);color:white;border-radius:50%;width:22px;height:22px;font-size:11px;padding:0;" title="Remove" onclick="event.stopPropagation();app.removeActivityPhoto(${activityId}, '${escapeHtml(url)}', 'view')"><i class="fas fa-times"></i></button>
                </div>
            `).join('')}
        </div>
        <p style="color:var(--gray-500);font-size:12px;margin-top:10px;text-align:center;">Tap a photo to view full size. Tap × to remove.</p>
    `;
    UI.showModal(`Photos (${photos.length})`, content, [
        { label: 'Close', type: 'secondary', action: 'UI.hideModal()' },
        { label: '+ Add more', type: 'primary', action: `(async () => { UI.hideModal(); await app.attachActivityPhoto(${activityId}); })()` }
    ]);
};

// Compress image to max 1920px wide at 80% JPEG quality using canvas.
// Handles large mobile camera photos (often 5-15MB) before upload.
const compressImageFile = (file) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const MAX_W = 1920;
            let w = img.width, h = img.height;
            if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            canvas.toBlob((blob) => {
                resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
            }, 'image/jpeg', 0.8);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
});

const saveActivityPhoto = async (activityId) => {
    const input = document.getElementById('activity-photo-upload');
    const files = input?.files;
    if (!files || files.length === 0) { UI.toast.error('Please select at least one photo'); return; }

    const activity = await _lookupActivityRobust(activityId);
    if (!activity) { UI.toast.error('Meet up record not found'); return; }
    const existing = Array.isArray(activity.photo_urls) ? activity.photo_urls : [];
    const newUrls = [];

    const sb = window.supabase || window.supabaseClient;
    if (!sb || !sb.storage) { UI.toast.error('Supabase not connected — cannot upload photos'); return; }

    UI.toast.success('Uploading photo(s)…');
    try {
        for (const file of files) {
            if (!file.type.startsWith('image/')) {
                UI.toast.error(`"${file.name}" is not an image`);
                continue;
            }
            // Compress mobile camera photos before upload (handles 5-15MB phone images)
            const compressed = await compressImageFile(file);
            const safeName = compressed.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const path = `activity_photos/${activityId}_${Date.now()}_${safeName}`;
            const { error: upErr } = await sb.storage.from('attachments').upload(path, compressed, { upsert: false, contentType: 'image/jpeg' });
            if (upErr) { throw upErr; }
            const { data: urlData } = sb.storage.from('attachments').getPublicUrl(path);
            if (urlData?.publicUrl) newUrls.push(urlData.publicUrl);
        }

        if (newUrls.length === 0) { UI.toast.error('No photos were uploaded'); return; }

        const updated = [...existing, ...newUrls];
        await AppDataStore.update('activities', activityId, { photo_urls: updated });

        UI.hideModal();
        UI.toast.success(`${newUrls.length} photo(s) uploaded`);

        const prospectId = activity.prospect_id;
        const bodyEl = document.getElementById(`acc-body-activity-${prospectId}`);
        if (bodyEl) {
            await switchProspectTab('activity', prospectId, null, bodyEl);
        }
    } catch (err) {
        console.error('Activity photo upload failed:', err);
        UI.toast.error('Upload failed: ' + (err.message || 'Unknown error'));
    }
};

// source: 'view'   → after delete, reopen the gallery viewer with fresh
//                    data (or close it when no photos remain).
//         'upload' → reopen the upload modal so the user can keep adding
//                    photos in the same flow.
//         undefined → default to 'view' behaviour for back-compat.
// Per-activity serialization lock for photo removal. Rapid × taps fire
// multiple removeActivityPhoto calls before any of them commits — without
// serialization, each call would read the same starting photo_urls,
// compute its own filtered copy, and the last write would overwrite all
// earlier writes (last-write-wins ⇒ deletions silently undone).
//
// The map holds the currently-running tail Promise per activityId; each
// new call chains onto it so the read-modify-write happens sequentially.
// Entries are cleared when their tail completes so the Map doesn't grow
// unboundedly over a long session.
const _photoRemoveLocks = new Map();

// photoTarget: the URL string of the photo to remove. Identification by URL
//     (not index) keeps the operation idempotent — re-removing an
//     already-gone URL is a no-op rather than removing the wrong photo.
// source: see removeActivityPhoto reference below.
//
// (Accepts a legacy numeric `index` too — any cached HTML from a prior
//  build will still work; treated as an index into the freshly-fetched
//  photo_urls array.)
const removeActivityPhoto = async (activityId, photoTarget, source) => {
    // Serialize per activity: wait for the prior in-flight remove on this
    // activity (if any) to commit before we read photo_urls. This is what
    // makes 5 concurrent × taps end up with all 5 photos actually gone
    // instead of just the last-clicked one surviving the overwrite race.
    const prev = _photoRemoveLocks.get(activityId) || Promise.resolve();
    const job = prev.catch(() => {}).then(async () => {
        // Robust lookup so the delete actually fires for activities the user
        // sees via the hot RPC but can't SELECT directly under RLS.
        const activity = await _lookupActivityRobust(activityId);
        if (!activity) return { updated: [], skipped: true };
        const existing = Array.isArray(activity.photo_urls) ? activity.photo_urls : [];

        // Resolve target → URL string regardless of how the caller addressed
        // the photo. Legacy numeric callers use the freshly-fetched array,
        // so the index is interpreted against live state.
        let targetUrl;
        if (typeof photoTarget === 'number') {
            if (photoTarget < 0 || photoTarget >= existing.length) return { updated: existing, skipped: true };
            targetUrl = existing[photoTarget];
        } else {
            targetUrl = String(photoTarget);
        }

        const updated = existing.filter(u => u !== targetUrl);
        // If the URL is already gone (an earlier serialized remove won the
        // race), skip the DB round-trip — nothing to update.
        if (updated.length !== existing.length) {
            await AppDataStore.update('activities', activityId, { photo_urls: updated });
            AppDataStore.invalidateCache('activities');
        }
        return { activity, updated, skipped: false };
    });
    _photoRemoveLocks.set(activityId, job);
    let result;
    try {
        result = await job;
    } finally {
        // Only clear if we're still the tail — a later remove might have
        // already chained onto our promise.
        if (_photoRemoveLocks.get(activityId) === job) {
            _photoRemoveLocks.delete(activityId);
        }
    }
    if (!result || result.skipped) return;
    const { activity, updated } = result;

    UI.toast.success('Photo removed');

    // Refresh the activity row in the background so the Photo button count updates.
    const prospectId = activity.prospect_id;
    const bodyEl = document.getElementById(`acc-body-activity-${prospectId}`);
    if (bodyEl) {
        await switchProspectTab('activity', prospectId, null, bodyEl);
    }

    // Reopen the originating modal so consecutive deletions don't force
    // the user to re-tap Photos between each ×.
    if (source === 'upload') {
        await attachActivityPhoto(activityId);
    } else if (updated.length > 0) {
        await viewActivityPhotos(activityId);
    } else {
        UI.hideModal();
    }
};

// Appraisal Form upload — stores file rows in prospect_attachments (attachment_type='appraisal_form').
const attachAppraisalForm = async (prospectId) => {
    const existing = await AppDataStore.query('prospect_attachments', { prospect_id: prospectId, attachment_type: 'appraisal_form' });
    const content = `
        <div class="form-group">
            <label>Select one or more photos</label>
            <input type="file" id="appraisal-form-upload" class="form-control" accept="image/*" multiple>
            <p style="color:var(--gray-500);font-size:12px;margin-top:6px;">JPG/PNG, max 5MB each. You can pick multiple files.</p>
        </div>
        ${existing.length > 0 ? `
        <div class="form-group">
            <label>Existing Appraisal Forms (${existing.length})</label>
            <div style="display:flex;flex-wrap:wrap;gap:8px;max-height:180px;overflow:auto;padding:6px;border:1px solid var(--gray-200);border-radius:6px;">
                ${existing.map(row => `
                    <div style="position:relative;">
                        <img loading="lazy" decoding="async" data-attach-src="${row.file_url}" style="height:70px;border-radius:4px;object-fit:cover;cursor:pointer;" onclick="window._openAttachment('${row.file_url}')">
                        <button type="button" class="btn-icon" style="position:absolute;top:-6px;right:-6px;background:var(--error);color:white;border-radius:50%;width:20px;height:20px;font-size:10px;padding:0;" title="Remove" onclick="app.removeAppraisalForm(${prospectId}, ${row.id})"><i class="fas fa-times"></i></button>
                    </div>
                `).join('')}
            </div>
        </div>` : ''}
    `;
    UI.showModal('Upload Appraisal Form', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Upload', type: 'primary', action: `(async () => { await app.saveAppraisalForm(${prospectId}); })()` }
    ]);
};

const saveAppraisalForm = async (prospectId) => {
    const input = document.getElementById('appraisal-form-upload');
    const files = input?.files;
    if (!files || files.length === 0) { UI.toast.error('Please select at least one photo'); return; }

    const sb = window.supabase || window.supabaseClient;
    if (!sb || !sb.storage) { UI.toast.error('Supabase not connected — cannot upload photos'); return; }

    try {
        let uploaded = 0;
        for (const file of files) {
            if (file.size > 5 * 1024 * 1024) { UI.toast.error(`"${file.name}" too large (max 5MB)`); continue; }
            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const path = `appraisal_forms/${prospectId}_${Date.now()}_${safeName}`;
            const { error: upErr } = await sb.storage.from('attachments').upload(path, file, { upsert: false, contentType: file.type });
            if (upErr) { throw upErr; }
            const { data: urlData } = sb.storage.from('attachments').getPublicUrl(path);
            if (urlData?.publicUrl) {
                await AppDataStore.create('prospect_attachments', {
                    prospect_id: prospectId,
                    attachment_type: 'appraisal_form',
                    file_url: urlData.publicUrl,
                    filename: safeName
                });
                uploaded++;
            }
        }

        if (uploaded === 0) { UI.toast.error('No photos were uploaded'); return; }

        UI.hideModal();
        UI.toast.success(`${uploaded} appraisal form photo(s) uploaded`);

        const bodyEl = document.getElementById(`acc-body-names-${prospectId}`);
        if (bodyEl) await switchProspectTab('names', prospectId, null, bodyEl);
    } catch (err) {
        console.error('Appraisal form upload failed:', err);
        UI.toast.error('Upload failed: ' + (err.message || 'Unknown error'));
    }
};

const removeAppraisalForm = async (prospectId, attachmentId) => {
    await AppDataStore.delete('prospect_attachments', attachmentId);
    UI.hideModal();
    UI.toast.success('Appraisal form photo removed');
    const bodyEl = document.getElementById(`acc-body-names-${prospectId}`);
    if (bodyEl) await switchProspectTab('names', prospectId, null, bodyEl);
};

// APU Form upload — stores file rows in prospect_attachments (attachment_type='apu_form').
const uploadAPUForm = async (activityId, prospectId) => {
    const existing = await AppDataStore.query('prospect_attachments', { prospect_id: prospectId, attachment_type: 'apu_form' });
    const content = `
        <div class="form-group">
            <label>Attach or take a photo of APU</label>
            <input type="file" id="apu-form-upload" class="form-control" accept="image/*">
            <p style="color:var(--gray-500);font-size:12px;margin-top:6px;">JPG/PNG, max 5MB. Use camera or choose a file.</p>
        </div>
        ${existing.length > 0 ? `
        <div class="form-group">
            <label>Existing APU Files (${existing.length})</label>
            <div style="display:flex;flex-wrap:wrap;gap:8px;max-height:180px;overflow:auto;padding:6px;border:1px solid var(--gray-200);border-radius:6px;">
                ${existing.map(row => `
                    <div style="position:relative;">
                        <img loading="lazy" decoding="async" data-attach-src="${row.file_url}" style="height:70px;border-radius:4px;object-fit:cover;cursor:pointer;" onclick="window._openAttachment('${row.file_url}')">
                        <button type="button" class="btn-icon" style="position:absolute;top:-6px;right:-6px;background:var(--error);color:white;border-radius:50%;width:20px;height:20px;font-size:10px;padding:0;" title="Remove" onclick="app.removeAPUForm(${prospectId}, ${row.id})"><i class="fas fa-times"></i></button>
                    </div>
                `).join('')}
            </div>
        </div>` : ''}
    `;
    UI.showModal('Upload APU', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Upload', type: 'primary', action: `(async () => { await app.saveAPUForm(${prospectId}); })()` }
    ]);
};

const saveAPUForm = async (prospectId) => {
    const input = document.getElementById('apu-form-upload');
    const file = input?.files?.[0];
    if (!file) { UI.toast.error('Please select a photo'); return; }
    if (file.size > 5 * 1024 * 1024) { UI.toast.error('File too large (max 5MB)'); return; }

    const sb = window.supabase || window.supabaseClient;
    if (!sb || !sb.storage) { UI.toast.error('Supabase not connected — cannot upload photo'); return; }

    try {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `apu_forms/${prospectId}_${Date.now()}_${safeName}`;
        const { error: upErr } = await sb.storage.from('attachments').upload(path, file, { upsert: false, contentType: file.type });
        if (upErr) throw upErr;
        const { data: urlData } = sb.storage.from('attachments').getPublicUrl(path);
        if (!urlData?.publicUrl) { UI.toast.error('Upload succeeded but could not get URL'); return; }

        await AppDataStore.create('prospect_attachments', {
            prospect_id: prospectId,
            attachment_type: 'apu_form',
            file_url: urlData.publicUrl,
            filename: safeName
        });

        UI.hideModal();
        UI.toast.success('APU photo uploaded');

        (window.app.dispatchOnApuPhotoTriggers || (() => {}))(prospectId).catch(e => console.warn('APU follow-up triggers failed:', e));

        const bodyEl = document.getElementById(`acc-body-names-${prospectId}`);
        if (bodyEl) await switchProspectTab('names', prospectId, null, bodyEl);
    } catch (err) {
        console.error('APU upload failed:', err);
        UI.toast.error('Upload failed: ' + (err.message || 'Unknown error'));
    }
};

const removeAPUForm = async (prospectId, attachmentId) => {
    await AppDataStore.delete('prospect_attachments', attachmentId);
    UI.hideModal();
    UI.toast.success('APU photo removed');
    const bodyEl = document.getElementById(`acc-body-names-${prospectId}`);
    if (bodyEl) await switchProspectTab('names', prospectId, null, bodyEl);
};

const recordSalesClosure = (prospectId, activityId) => {
    // Scroll/open the Closing Record accordion
    const closingItem = document.getElementById(`acc-closing-${prospectId}`);
    if (closingItem) {
        if (!closingItem.classList.contains('open')) {
            const bodyEl = document.getElementById(`acc-body-closing-${prospectId}`);
            if (bodyEl) {
                closingItem.classList.add('open');
                bodyEl.style.display = 'block';
                if (bodyEl.dataset.loaded === 'false') {
                    bodyEl.dataset.loaded = 'true';
                    bodyEl.innerHTML = '<div class="acc-loading"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';
                    switchProspectTab('closing', prospectId, null, bodyEl);
                }
            }
        }
        closingItem.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    UI.toast.success('Fill in the Closing Record below to record this sale');
};

const toggleNextAction = (prospectId, activityId, isDone) => {
    // Legacy: kept for backward compatibility
    toggleNextActionItem(prospectId, activityId, isDone);
};

const toggleNextActionItem = async (prospectId, itemId, isDone) => {
    // Persist to Supabase so completion state syncs across users/devices.
    // itemId is like "${activityId}_na" or "${activityId}_ns"
    const isNa = itemId.endsWith('_na');
    const activityId = parseInt(itemId.slice(0, -3));
    const field = isNa ? 'next_action_done' : 'note_next_steps_done';
    if (!isNaN(activityId)) {
        try {
            await AppDataStore.update('activities', activityId, { [field]: isDone });
        } catch (err) {
            console.warn('toggleNextActionItem persist failed:', err);
        }
    }
    // Keep localStorage key for immediate UI feedback and backward compatibility
    const key = `na_done_${prospectId}_${itemId}`;
    localStorage.setItem(key, isDone ? '1' : '0');
    const itemEl = document.getElementById(`na-item-${itemId}`);
    const textEl = document.getElementById(`na-text-${itemId}`);
    if (itemEl) itemEl.classList.toggle('done', isDone);
    if (textEl) textEl.style.textDecoration = isDone ? 'line-through' : '';
    // Update progress bar
    const container = document.getElementById(`acc-body-nextactions-${prospectId}`);
    if (container) {
        const allCbs = container.querySelectorAll('.na-cb');
        const total = allCbs.length;
        const done = [...allCbs].filter(cb => cb.checked).length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const fill = container.querySelector('.progress-fill');
        const countEl = container.querySelector('[data-na-count]');
        if (fill) fill.style.width = pct + '%';
        if (countEl) countEl.textContent = `${done} of ${total} completed`;
    }
};

const gatherClosingFormData = async (existingCr = {}) => {
    const paymentMethod = document.getElementById('cr-payment-method')?.value || 'Cash';

    // Read newly-selected invoice file (if any). Otherwise preserve the one
    // already on the record so re-saving a draft doesn't wipe it.
    const fileInput = document.getElementById('cr-invoice-file');
    const file = fileInput?.files?.[0] || null;
    let invoice_file = existingCr.invoice_file || null;
    let invoice_file_name = existingCr.invoice_file_name || null;
    if (file) {
        const sb = window.supabase || window.supabaseClient;
        if (sb && sb.storage) {
            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const path = `invoices/${Date.now()}_${safeName}`;
            const { error: upErr } = await sb.storage.from('attachments').upload(path, file, { upsert: false, contentType: file.type });
            if (upErr) throw new Error('Invoice upload failed: ' + upErr.message);
            const { data: urlData } = sb.storage.from('attachments').getPublicUrl(path);
            invoice_file = urlData?.publicUrl || null;
        } else {
            // Fallback to Base64 if storage unavailable
            invoice_file = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
            });
        }
        invoice_file_name = file.name;
    }

    return {
        full_name: document.getElementById('cr-full-name')?.value?.trim() || '',
        phone: document.getElementById('cr-phone')?.value?.trim() || '',
        email: document.getElementById('cr-email')?.value?.trim() || '',
        ic_number: document.getElementById('cr-ic')?.value?.trim() || '',
        date_of_birth: document.getElementById('cr-dob')?.value || '',
        address: document.getElementById('cr-address')?.value?.trim() || '',
        product: document.getElementById('cr-product')?.value || '',
        sale_amount: document.getElementById('cr-amount')?.value || '',
        payment_method: paymentMethod,
        pop_monthly: paymentMethod === 'POP' ? (document.getElementById('cr-pop-monthly')?.value || '') : '',
        pop_tenure: paymentMethod === 'POP' ? (document.getElementById('cr-pop-tenure')?.value || '') : '',
        pop_down_payment: paymentMethod === 'POP' ? (document.getElementById('cr-pop-down')?.value || '') : '',
        invoice_number: document.getElementById('cr-invoice')?.value?.trim() || '',
        closing_remarks: document.getElementById('cr-remarks')?.value?.trim() || '',
        closing_date: document.getElementById('cr-close-date')?.value || '',
        order_date: document.getElementById('cr-order-date')?.value || '',
        sales_idea: document.getElementById('cr-sales-idea')?.value?.trim() || '',
        plan_details: document.getElementById('cr-plan-details')?.value?.trim() || '',
        success_story: document.getElementById('cr-success-story')?.value?.trim() || '',
        invoice_file,
        invoice_file_name,
    };
};

const addPrePurchaseRow = async (prospectId) => {
    const productInput = document.getElementById(`pre2025-product-${prospectId}`);
    const notesInput = document.getElementById(`pre2025-notes-${prospectId}`);
    const fileInput = document.getElementById(`pre2025-file-${prospectId}`);
    const product = productInput?.value?.trim();
    if (!product) { UI.toast.error('Please enter a product / service name'); return; }
    const notes = notesInput?.value?.trim() || '';
    const file = fileInput?.files[0] || null;

    const saveRow = async (attachment_data, attachment_name) => {
        const prospect = await AppDataStore.getById('prospects', prospectId);
        if (!prospect) return;
        let records = [];
        try {
            const src = prospect.closing_record?.pre2025_purchases || prospect.pre2025_purchases;
            records = Array.isArray(src) ? [...src] : JSON.parse(src || '[]');
        } catch(_) {}
        records.push({ product, notes, attachment_data: attachment_data || null, attachment_name: attachment_name || null });
        const cr = { ...(prospect.closing_record || {}), pre2025_purchases: records };
        await AppDataStore.update('prospects', prospectId, { closing_record: cr });
        UI.toast.success('Record added');
        const bodyEl = document.getElementById(`acc-body-closing-${prospectId}`);
        if (bodyEl) await switchProspectTab('closing', prospectId, null, bodyEl);
        await _refreshCustClosingAfterProspectSave(prospectId);
    };

    if (file) {
        const sb = window.supabase || window.supabaseClient;
        if (sb && sb.storage) {
            try {
                const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                const path = `pre2025_purchases/${prospectId}_${Date.now()}_${safeName}`;
                const { error: upErr } = await sb.storage.from('attachments').upload(path, file, { upsert: false, contentType: file.type });
                if (upErr) throw upErr;
                const { data: urlData } = sb.storage.from('attachments').getPublicUrl(path);
                await saveRow(urlData?.publicUrl || null, file.name);
            } catch (err) {
                UI.toast.error('Attachment upload failed: ' + (err.message || 'Unknown error'));
            }
        } else {
            const reader = new FileReader();
            reader.onload = async (e) => await saveRow(e.target.result, file.name);
            reader.readAsDataURL(file);
        }
    } else {
        await saveRow(null, null);
    }
};

const addPrePurchaseAttachment = async (prospectId, index, fileInput) => {
    const file = fileInput?.files[0];
    if (!file) return;

    const saveAttachment = async (attachmentData, attachmentName) => {
        const prospect = await AppDataStore.getById('prospects', prospectId);
        if (!prospect) return;
        let records = [];
        try {
            const src = prospect.closing_record?.pre2025_purchases || prospect.pre2025_purchases;
            records = Array.isArray(src) ? [...src] : JSON.parse(src || '[]');
        } catch(_) {}
        if (records[index]) {
            records[index].attachment_name = attachmentName;
            records[index].attachment_data = attachmentData;
        }
        const cr = { ...(prospect.closing_record || {}), pre2025_purchases: records };
        await AppDataStore.update('prospects', prospectId, { closing_record: cr });
        UI.toast.success('Attachment saved');
        const bodyEl = document.getElementById(`acc-body-closing-${prospectId}`);
        if (bodyEl) await switchProspectTab('closing', prospectId, null, bodyEl);
        await _refreshCustClosingAfterProspectSave(prospectId);
    };

    const sb = window.supabase || window.supabaseClient;
    if (sb && sb.storage) {
        try {
            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const path = `pre2025_purchases/${prospectId}_${Date.now()}_${safeName}`;
            const { error: upErr } = await sb.storage.from('attachments').upload(path, file, { upsert: false, contentType: file.type });
            if (upErr) throw upErr;
            const { data: urlData } = sb.storage.from('attachments').getPublicUrl(path);
            await saveAttachment(urlData?.publicUrl || null, file.name);
        } catch (err) {
            UI.toast.error('Attachment upload failed: ' + (err.message || 'Unknown error'));
        }
    } else {
        const reader = new FileReader();
        reader.onload = async (e) => await saveAttachment(e.target.result, file.name);
        reader.readAsDataURL(file);
    }
};

const deletePrePurchaseRecord = async (prospectId, index) => {
    if (!confirm('Remove this record?')) return;
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;
    let records = [];
    try {
        const src = prospect.closing_record?.pre2025_purchases || prospect.pre2025_purchases;
        records = Array.isArray(src) ? [...src] : JSON.parse(src || '[]');
    } catch(_) {}
    records.splice(index, 1);
    const cr = { ...(prospect.closing_record || {}), pre2025_purchases: records };
    await AppDataStore.update('prospects', prospectId, { closing_record: cr });
    UI.toast.success('Record removed');
    const bodyEl = document.getElementById(`acc-body-closing-${prospectId}`);
    if (bodyEl) await switchProspectTab('closing', prospectId, null, bodyEl);
    await _refreshCustClosingAfterProspectSave(prospectId);
};

// ── Bujishu / Formula Healthcare Product Purchase History ──
const _productPurchaseKey = (type) => type === 'bujishu' ? 'bujishu_purchases' : 'formula_healthcare_purchases';
const _readProductPurchases = (prospect, type) => {
    try {
        const src = prospect.closing_record?.[_productPurchaseKey(type)];
        return Array.isArray(src) ? [...src] : JSON.parse(src || '[]');
    } catch(_) { return []; }
};
const _writeProductPurchases = async (prospectId, prospect, type, records) => {
    const cr = { ...(prospect.closing_record || {}), [_productPurchaseKey(type)]: records };
    await AppDataStore.update('prospects', prospectId, { closing_record: cr });
};
const _refreshProductPurchaseTab = async (prospectId, type) => {
    const bodyEl = document.getElementById(`acc-body-${type}-${prospectId}`);
    if (bodyEl) await switchProspectTab(type, prospectId, null, bodyEl);
};

// Compute the estimated finish date for a Formula Healthcare purchase.
// Source-of-truth fields come from the 'formula' Marketing List table:
//   - capsules_per_bottle (INTEGER)
//   - daily_dosage (NUMERIC, default per product)
//   - reminder_buffer_percent (NUMERIC, defaults to 0.10 = 10%)
// Returns null if the formula item is missing capsule/dosage config.
// Uses integer arithmetic (percentage x100) to avoid IEEE754 rounding
// errors — e.g. 90 * 1.1 yields 99.00000000000001 in FP, which would
// ceil to 100 instead of 99.
const _computeFinishDate = (product, quantity, dosageOverride) => {
    if (!product || !product.capsules_per_bottle) return null;
    const dosage = parseFloat(dosageOverride) || parseFloat(product.daily_dosage) || 0;
    if (dosage <= 0) return null;
    const bufferRaw = parseFloat(product.reminder_buffer_percent);
    const bufferPct = Math.round((Number.isFinite(bufferRaw) ? bufferRaw : 0.10) * 100); // e.g. 10 for 10%
    const totalCapsules = (parseInt(quantity) || 1) * parseInt(product.capsules_per_bottle);
    // days = ceil(totalCapsules * (100 + bufferPct) / (dosage * 100))
    const days = Math.ceil((totalCapsules * (100 + bufferPct)) / (dosage * 100));
    const finish = new Date(Date.now() + days * 86400000);
    return finish.toISOString().slice(0, 10);
};

// Fire-and-forget: ask Supabase to recompute refill_reminders immediately so
// the dashboard widget reflects the new purchase without waiting for cron.
const _triggerRefillRpc = async () => {
    try {
        const sb = window.supabase || window.supabaseClient;
        if (sb && sb.rpc) {
            await sb.rpc('compute_refill_reminders');
        }
    } catch (_) { /* silent — widget will still pick up on next cron run */ }
};

const addProductPurchaseRow = async (prospectId, type) => {
    const productInput = document.getElementById(`${type}-product-${prospectId}`);
    const dateInput = document.getElementById(`${type}-date-${prospectId}`);
    const amountInput = document.getElementById(`${type}-amount-${prospectId}`);
    const notesInput = document.getElementById(`${type}-notes-${prospectId}`);
    const fileInput = document.getElementById(`${type}-file-${prospectId}`);
    const qtyInput = document.getElementById(`${type}-qty-${prospectId}`);
    const dosageInput = document.getElementById(`${type}-dosage-${prospectId}`);

    // For Formula Healthcare with a dropdown, productInput is a <select> whose
    // value is the product ID. Extract both the ID (to link the record to the
    // products table) and the display name (to preserve readability even if the
    // product is later deleted).
    const isFormula = type === 'formula';
    let productId = null;
    let productName = '';
    if (isFormula && productInput?.tagName === 'SELECT') {
        const selOpt = productInput.options[productInput.selectedIndex];
        if (!productInput.value) { UI.toast.error('Please select a healthcare product'); return; }
        productId = parseInt(productInput.value) || null;
        productName = selOpt?.dataset?.name || selOpt?.textContent?.trim() || '';
    } else {
        productName = productInput?.value?.trim() || '';
        if (!productName) { UI.toast.error('Please enter a product name'); return; }
    }

    const purchase_date = dateInput?.value || '';
    const amount = amountInput?.value || '';
    const notes = notesInput?.value?.trim() || '';
    const file = fileInput?.files[0] || null;
    const quantity = isFormula ? (parseInt(qtyInput?.value) || 1) : null;
    const dosageOverride = isFormula && dosageInput?.value ? parseFloat(dosageInput.value) : null;

    // Fetch Formula master from the 'formula' Marketing List table for finish-date calc
    let productRecord = null;
    if (isFormula && productId) {
        try { productRecord = await AppDataStore.getById('formula', productId); } catch(_) {}
    }

    const estimated_finish_date = isFormula
        ? _computeFinishDate(productRecord, quantity, dosageOverride)
        : null;

    const saveRow = async (attachment_data, attachment_name) => {
        const prospect = await AppDataStore.getById('prospects', prospectId);
        if (!prospect) return;
        const records = _readProductPurchases(prospect, type);

        // For Formula Healthcare: when adding a new purchase for the same product,
        // auto-dismiss any still-active previous records for that product. This matches
        // the v1 "finish date moves forward each time new stock is added" behavior.
        if (isFormula && productId) {
            const now = new Date().toISOString();
            records.forEach(r => {
                if (r.product_id === productId && !r.reminder_dismissed_at && r.estimated_finish_date) {
                    r.reminder_dismissed_at = now;
                    r.superseded_by_new_purchase = true;
                }
            });
        }

        const newRecord = {
            product: productName,
            purchase_date,
            amount,
            notes,
            attachment_data: attachment_data || null,
            attachment_name: attachment_name || null
        };
        if (isFormula) {
            newRecord.product_id = productId;
            newRecord.quantity = quantity;
            newRecord.daily_dosage_override = dosageOverride;
            newRecord.estimated_finish_date = estimated_finish_date;
            newRecord.reminder_dismissed_at = null;
        }
        records.push(newRecord);
        await _writeProductPurchases(prospectId, prospect, type, records);

        // Ask Supabase to recompute refill_reminders right away
        if (isFormula && estimated_finish_date) {
            _triggerRefillRpc();
        }

        const finishMsg = estimated_finish_date
            ? ` (est. finish: ${estimated_finish_date})`
            : '';
        UI.toast.success('Record added' + finishMsg);
        await _refreshProductPurchaseTab(prospectId, type);
    };

    if (file) {
        const reader = new FileReader();
        reader.onload = async (e) => await saveRow(e.target.result, file.name);
        reader.readAsDataURL(file);
    } else {
        await saveRow(null, null);
    }
};

const addProductPurchaseAttachment = async (prospectId, type, index, fileInput) => {
    const file = fileInput?.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        const prospect = await AppDataStore.getById('prospects', prospectId);
        if (!prospect) return;
        const records = _readProductPurchases(prospect, type);
        if (records[index]) {
            records[index].attachment_name = file.name;
            records[index].attachment_data = e.target.result;
        }
        await _writeProductPurchases(prospectId, prospect, type, records);
        UI.toast.success('Attachment saved');
        await _refreshProductPurchaseTab(prospectId, type);
    };
    reader.readAsDataURL(file);
};

const deleteProductPurchaseRecord = async (prospectId, type, index) => {
    if (!confirm('Remove this record?')) return;
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;
    const records = _readProductPurchases(prospect, type);
    records.splice(index, 1);
    await _writeProductPurchases(prospectId, prospect, type, records);
    UI.toast.success('Record removed');
    await _refreshProductPurchaseTab(prospectId, type);
};

// ── ⑦c Feng Shui Audit helpers ───────────────────────────────────────
// Storage model: prospects.feng_shui_audits (JSONB array). Each audit event has:
//   { id, audit_date, audit_title, layout_plan_url/name, audit_report_url/name,
//     key_notes, products (serialized same as post-meetup notes),
//     before_photos [{url, remarks}], after_photos [{url, remarks}],
//     site_reviews [{ id, date, remarks, photos: [url] }] }
// Product selections auto-flow into Potential & Opportunities (see potential tab
// aggregation, which reads from prospect.feng_shui_audits[].products).
const _readFengShuiAudits = (prospect) => {
    try {
        const src = prospect?.feng_shui_audits;
        return Array.isArray(src) ? src.map(x => ({ ...x })) : JSON.parse(src || '[]');
    } catch(_) { return []; }
};

const _writeFengShuiAudits = async (prospectId, audits) => {
    await AppDataStore.update('prospects', prospectId, { feng_shui_audits: audits });
    AppDataStore.invalidateCache?.('prospects');
};

const _refreshFengShuiTab = async (prospectId) => {
    const bodyEl = document.getElementById(`acc-body-fengshui-${prospectId}`);
    if (bodyEl) await switchProspectTab('fengshui', prospectId, null, bodyEl);
};

const _uploadFengShuiToBucket = async (file, pathPrefix) => {
    const sb = window.supabase || window.supabaseClient;
    if (!sb || !sb.storage) {
        // Fallback: store as data URL so the UI still works offline
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${pathPrefix}_${Date.now()}_${safeName}`;
    const { error: upErr } = await sb.storage.from('attachments').upload(path, file, { upsert: false, contentType: file.type });
    if (upErr) throw upErr;
    const { data: urlData } = sb.storage.from('attachments').getPublicUrl(path);
    return urlData?.publicUrl || null;
};

// Open modal to create (no auditId) or edit (with auditId) an audit header —
// date, title, key notes, and product selections (checkbox groups mirroring
// Post-Meetup Notes exactly so the data format is reusable in the Potential tab).
const openFengShuiAuditModal = async (prospectId, auditId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) { UI.toast.error('Prospect not found'); return; }
    const audits = _readFengShuiAudits(prospect);
    const existing = auditId ? audits.find(a => a.id === auditId) : null;

    // Same data sources as Post-Meetup Notes → Potential & Opportunities
    const [products, bujishuItems, formulaItems] = await Promise.all([
        AppDataStore.getAll('products').then(r => r.filter(p => p.is_active !== false)),
        AppDataStore.getAll('bujishu').then(r => r.filter(b => b.is_active !== false)),
        AppDataStore.getAll('formula').then(r => r.filter(f => f.is_active !== false)),
    ]);
    const parsedProducts = (window.app.parseSelectedItems || (() => []))(existing?.products || '');

    const makeCheckbox = (value, group) => {
        const checked = parsedProducts.selected.includes(value) ? 'checked' : '';
        return `<label style="display:flex;align-items:center;gap:6px;margin-bottom:4px;cursor:pointer;font-size:13px;padding:3px 8px;border-radius:4px;" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background=''">
            <input type="checkbox" name="fsa-products" value="${escapeHtml(value)}" data-group="${escapeHtml(group)}" ${checked}> ${escapeHtml(value)}
        </label>`;
    };
    const productCheckboxes = [
        ...(products.length ? [`<div style="font-weight:600;font-size:12px;color:var(--primary);margin-bottom:4px;border-bottom:1px solid var(--gray-200);padding-bottom:3px;">Products</div>`] : []),
        ...products.map(p => makeCheckbox(p.name, 'Products')),
        ...(bujishuItems.length ? [`<div style="font-weight:600;font-size:12px;color:var(--primary);margin:8px 0 4px;border-bottom:1px solid var(--gray-200);padding-bottom:3px;">Bujishu</div>`] : []),
        ...bujishuItems.map(b => makeCheckbox(b.name, 'Bujishu')),
        ...(formulaItems.length ? [`<div style="font-weight:600;font-size:12px;color:var(--primary);margin:8px 0 4px;border-bottom:1px solid var(--gray-200);padding-bottom:3px;">Formula</div>`] : []),
        ...formulaItems.map(f => makeCheckbox(f.name, 'Formula')),
    ];

    const today = new Date().toISOString().slice(0, 10);
    const content = `
        <div class="form-row" style="display:flex;gap:8px;">
            <div class="form-group" style="flex:1;">
                <label>Audit Date</label>
                <input type="date" id="fsa-modal-date" class="form-control" value="${existing?.audit_date || today}">
            </div>
            <div class="form-group" style="flex:2;">
                <label>Audit Title</label>
                <input type="text" id="fsa-modal-title" class="form-control" placeholder="e.g. Main House Audit — Level 1" value="${escapeHtml(existing?.audit_title || '')}">
            </div>
        </div>
        <div class="form-group">
            <label><i class="fas fa-key"></i> Important Key Notes for the House / Needs</label>
            <textarea id="fsa-modal-notes" class="form-control" rows="4" placeholder="Observations, needs, client concerns, compass readings, key flying-star sectors...">${escapeHtml(existing?.key_notes || '')}</textarea>
        </div>
        <div class="form-group">
            <label><i class="fas fa-bolt"></i> Product Potential Needed
                <span style="font-size:11px;font-weight:400;color:var(--gray-400);margin-left:4px;">— auto-flows to Potential &amp; Opportunities</span>
            </label>
            <div style="border:1px solid var(--gray-300);border-radius:6px;padding:10px;max-height:220px;overflow-y:auto;background:#fafafa;">
                ${productCheckboxes.length > 0 ? productCheckboxes.join('') : '<p style="color:var(--gray-400);font-size:12px;margin:0;">No products/items available in marketing list.</p>'}
            </div>
            <textarea id="fsa-modal-product-remarks" class="form-control" rows="2" placeholder="Additional product remarks..." style="margin-top:6px;">${escapeHtml(parsedProducts.remarks || '')}</textarea>
            <div style="font-size:11px;color:var(--gray-400);margin-top:3px;"><i class="fas fa-link"></i> Linked to prospect profile → Potential &amp; Opportunities</div>
        </div>
        <p style="font-size:12px;color:var(--gray-500);margin-top:8px;background:#eff6ff;border-left:3px solid var(--primary);padding:6px 10px;border-radius:4px;">
            <i class="fas fa-info-circle"></i> After saving, you can upload the layout-plan file, audit report, before/after photos, and add site review entries from the audit card.
        </p>
    `;
    UI.showModal(auditId ? '✏️ Edit Feng Shui Audit' : '➕ New Feng Shui Audit', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: auditId ? 'Save' : 'Create Audit', type: 'primary', action: `(async () => { await app.saveFengShuiAudit(${prospectId}, ${auditId || 'null'}); })()` }
    ]);
};

const saveFengShuiAudit = async (prospectId, auditId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) { UI.toast.error('Prospect not found'); return; }
    const audits = _readFengShuiAudits(prospect);

    const audit_date = document.getElementById('fsa-modal-date')?.value || '';
    const audit_title = document.getElementById('fsa-modal-title')?.value?.trim() || '';
    const key_notes = document.getElementById('fsa-modal-notes')?.value?.trim() || '';
    const products = (window.app.serializeMultiSelectToText || (() => ''))('fsa-products', 'fsa-modal-product-remarks');

    if (!audit_date) { UI.toast.error('Audit date is required'); return; }
    if (!audit_title) { UI.toast.error('Audit title is required'); return; }

    if (auditId) {
        const idx = audits.findIndex(a => a.id === auditId);
        if (idx === -1) { UI.toast.error('Audit not found'); return; }
        audits[idx] = { ...audits[idx], audit_date, audit_title, key_notes, products };
    } else {
        audits.push({
            id: Date.now(),
            audit_date,
            audit_title,
            layout_plan_url: null,
            layout_plan_name: null,
            audit_report_url: null,
            audit_report_name: null,
            key_notes,
            products,
            before_photos: [],
            after_photos: [],
            site_reviews: [],
            created_at: new Date().toISOString(),
        });
    }
    await _writeFengShuiAudits(prospectId, audits);
    UI.hideModal();
    UI.toast.success(auditId ? 'Feng shui audit updated' : 'Feng shui audit created');
    await _refreshFengShuiTab(prospectId);
    // Auto-refresh the Potential tab if currently open — product selections flow there
    const potentialBody = document.getElementById(`acc-body-potential-${prospectId}`);
    if (potentialBody && potentialBody.dataset.loaded === 'true') {
        await switchProspectTab('potential', prospectId, null, potentialBody);
    }
};

const deleteFengShuiAudit = async (prospectId, auditId) => {
    if (!confirm('Delete this feng shui audit? All uploaded files and photos will be unlinked (files remain in storage).')) return;
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;
    const audits = _readFengShuiAudits(prospect).filter(a => a.id !== auditId);
    await _writeFengShuiAudits(prospectId, audits);
    UI.toast.success('Feng shui audit deleted');
    await _refreshFengShuiTab(prospectId);
    const potentialBody = document.getElementById(`acc-body-potential-${prospectId}`);
    if (potentialBody && potentialBody.dataset.loaded === 'true') {
        await switchProspectTab('potential', prospectId, null, potentialBody);
    }
};

const uploadFengShuiFile = async (prospectId, auditId, fileType, fileInput) => {
    const file = fileInput?.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { UI.toast.error('File too large (max 20MB)'); return; }

    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;
    const audits = _readFengShuiAudits(prospect);
    const idx = audits.findIndex(a => a.id === auditId);
    if (idx === -1) { UI.toast.error('Audit not found'); return; }

    try {
        const url = await _uploadFengShuiToBucket(file, `feng_shui_audits/${prospectId}_${auditId}_${fileType}`);
        if (!url) { UI.toast.error('Upload failed'); return; }
        audits[idx][`${fileType}_url`] = url;
        audits[idx][`${fileType}_name`] = file.name;
        await _writeFengShuiAudits(prospectId, audits);
        UI.toast.success(`${fileType === 'layout_plan' ? 'Layout plan' : 'Audit report'} uploaded`);
        await _refreshFengShuiTab(prospectId);
    } catch (err) {
        console.error('Feng shui file upload failed:', err);
        UI.toast.error('Upload failed: ' + (err.message || 'Unknown error'));
    }
};

const removeFengShuiFile = async (prospectId, auditId, fileType) => {
    if (!confirm('Remove this file from the audit?')) return;
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;
    const audits = _readFengShuiAudits(prospect);
    const idx = audits.findIndex(a => a.id === auditId);
    if (idx === -1) return;
    audits[idx][`${fileType}_url`] = null;
    audits[idx][`${fileType}_name`] = null;
    await _writeFengShuiAudits(prospectId, audits);
    UI.toast.success('File removed');
    await _refreshFengShuiTab(prospectId);
};

const uploadFengShuiPhotos = async (prospectId, auditId, phase, fileInput) => {
    const files = fileInput?.files;
    if (!files || !files.length) return;

    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;
    const audits = _readFengShuiAudits(prospect);
    const idx = audits.findIndex(a => a.id === auditId);
    if (idx === -1) { UI.toast.error('Audit not found'); return; }

    const key = `${phase}_photos`;
    const existing = Array.isArray(audits[idx][key]) ? audits[idx][key] : [];
    const remaining = 50 - existing.length;
    if (remaining <= 0) { UI.toast.error(`Already at 50 ${phase} photos`); return; }

    const toUpload = Array.from(files).slice(0, remaining);
    let uploaded = 0;
    try {
        for (const file of toUpload) {
            if (file.size > 5 * 1024 * 1024) {
                UI.toast.error(`"${file.name}" too large (max 5MB) — skipped`);
                continue;
            }
            const url = await _uploadFengShuiToBucket(file, `feng_shui_audits/${prospectId}_${auditId}_${phase}`);
            if (url) {
                existing.push({ url, remarks: '' });
                uploaded++;
            }
        }
        if (uploaded === 0) { UI.toast.error('No photos uploaded'); return; }
        audits[idx][key] = existing;
        await _writeFengShuiAudits(prospectId, audits);
        UI.toast.success(`${uploaded} ${phase} photo${uploaded > 1 ? 's' : ''} uploaded`);
        await _refreshFengShuiTab(prospectId);
    } catch (err) {
        console.error(`Feng shui ${phase} photo upload failed:`, err);
        UI.toast.error('Upload failed: ' + (err.message || 'Unknown error'));
    }
};

const removeFengShuiPhoto = async (prospectId, auditId, phase, index) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;
    const audits = _readFengShuiAudits(prospect);
    const idx = audits.findIndex(a => a.id === auditId);
    if (idx === -1) return;
    const key = `${phase}_photos`;
    const arr = Array.isArray(audits[idx][key]) ? audits[idx][key] : [];
    if (index < 0 || index >= arr.length) return;
    arr.splice(index, 1);
    audits[idx][key] = arr;
    await _writeFengShuiAudits(prospectId, audits);
    UI.toast.success('Photo removed');
    await _refreshFengShuiTab(prospectId);
};

const updateFengShuiPhotoRemark = async (prospectId, auditId, phase, index, remarks) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;
    const audits = _readFengShuiAudits(prospect);
    const idx = audits.findIndex(a => a.id === auditId);
    if (idx === -1) return;
    const key = `${phase}_photos`;
    const arr = Array.isArray(audits[idx][key]) ? audits[idx][key] : [];
    if (!arr[index]) return;
    arr[index].remarks = (remarks || '').trim();
    audits[idx][key] = arr;
    await _writeFengShuiAudits(prospectId, audits);
    // Silent save — no toast so it doesn't spam when typing across many photos
};

const openFengShuiPhotosModal = async (prospectId, auditId, phase) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;
    const audits = _readFengShuiAudits(prospect);
    const audit = audits.find(a => a.id === auditId);
    if (!audit) return;
    const photos = Array.isArray(audit[`${phase}_photos`]) ? audit[`${phase}_photos`] : [];
    const label = phase === 'before' ? 'Before' : 'After';
    const content = photos.length === 0
        ? `<p style="text-align:center;padding:20px;color:var(--gray-400);">No ${phase} photos yet</p>`
        : `<div style="display:flex;flex-wrap:wrap;gap:10px;">
            ${photos.map((p, i) => `
                <div style="width:120px;border:1px solid var(--gray-200);border-radius:6px;overflow:hidden;background:#fff;">
                    <div style="position:relative;">
                        <img loading="lazy" decoding="async" data-attach-src="${p.url}" style="width:100%;height:90px;object-fit:cover;cursor:pointer;" onclick="window._openAttachment('${p.url}')">
                        <button type="button" title="Remove" onclick="event.stopPropagation();app.removeFengShuiPhoto(${prospectId},${auditId},'${phase}',${i});UI.hideModal();" style="position:absolute;top:-6px;right:-6px;background:var(--error);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;"><i class="fas fa-times"></i></button>
                    </div>
                    <input type="text" class="form-control" value="${escapeHtml(p.remarks || '')}" placeholder="Remark..." style="font-size:11px;height:26px;border:none;border-top:1px solid var(--gray-200);border-radius:0;" onchange="event.stopPropagation();app.updateFengShuiPhotoRemark(${prospectId},${auditId},'${phase}',${i},this.value)">
                </div>
            `).join('')}
        </div>`;
    UI.showModal(`${label} Photos (${photos.length})`, content, [
        { label: 'Close', type: 'primary', action: 'UI.hideModal()' }
    ]);
};

const openFengShuiSitePhotosModal = async (prospectId, auditId, srId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;
    const audits = _readFengShuiAudits(prospect);
    const audit = audits.find(a => a.id === auditId);
    if (!audit) return;
    const sr = (Array.isArray(audit.site_reviews) ? audit.site_reviews : []).find(s => s.id === srId);
    if (!sr) return;
    const photos = Array.isArray(sr.photos) ? sr.photos : [];
    const content = photos.length === 0
        ? `<p style="text-align:center;padding:20px;color:var(--gray-400);">No photos for this site review</p>`
        : `<div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${photos.map((url, i) => `
                <div style="position:relative;">
                    <img loading="lazy" decoding="async" data-attach-src="${url}" style="width:90px;height:90px;object-fit:cover;border-radius:4px;cursor:pointer;border:1px solid var(--gray-200);" onclick="window._openAttachment('${url}')">
                    <button type="button" title="Remove" onclick="event.stopPropagation();app.removeFengShuiSitePhoto(${prospectId},${auditId},${srId},${i});UI.hideModal();" style="position:absolute;top:-6px;right:-6px;background:var(--error);color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:9px;cursor:pointer;"><i class="fas fa-times"></i></button>
                </div>
            `).join('')}
        </div>`;
    UI.showModal(`Site Review Photos (${photos.length})`, content, [
        { label: 'Close', type: 'primary', action: 'UI.hideModal()' }
    ]);
};

const addFengShuiSiteReview = async (prospectId, auditId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;
    const audits = _readFengShuiAudits(prospect);
    const idx = audits.findIndex(a => a.id === auditId);
    if (idx === -1) return;
    if (!Array.isArray(audits[idx].site_reviews)) audits[idx].site_reviews = [];
    audits[idx].site_reviews.push({
        id: Date.now(),
        date: new Date().toISOString().slice(0, 10),
        remarks: '',
        photos: [],
    });
    await _writeFengShuiAudits(prospectId, audits);
    UI.toast.success('Site review entry added');
    await _refreshFengShuiTab(prospectId);
};

const updateFengShuiSiteReviewField = async (prospectId, auditId, siteId, field, value) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;
    const audits = _readFengShuiAudits(prospect);
    const idx = audits.findIndex(a => a.id === auditId);
    if (idx === -1) return;
    const sr = (audits[idx].site_reviews || []).find(s => s.id === siteId);
    if (!sr) return;
    sr[field] = (value || '').toString();
    await _writeFengShuiAudits(prospectId, audits);
};

const uploadFengShuiSitePhotos = async (prospectId, auditId, siteId, fileInput) => {
    const files = fileInput?.files;
    if (!files || !files.length) return;

    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;
    const audits = _readFengShuiAudits(prospect);
    const idx = audits.findIndex(a => a.id === auditId);
    if (idx === -1) return;
    const sr = (audits[idx].site_reviews || []).find(s => s.id === siteId);
    if (!sr) return;
    if (!Array.isArray(sr.photos)) sr.photos = [];
    const remaining = 5 - sr.photos.length;
    if (remaining <= 0) { UI.toast.error('Already at 5 photos for this site review'); return; }

    const toUpload = Array.from(files).slice(0, remaining);
    let uploaded = 0;
    try {
        for (const file of toUpload) {
            if (file.size > 5 * 1024 * 1024) {
                UI.toast.error(`"${file.name}" too large (max 5MB) — skipped`);
                continue;
            }
            const url = await _uploadFengShuiToBucket(file, `feng_shui_audits/${prospectId}_${auditId}_sr${siteId}`);
            if (url) { sr.photos.push(url); uploaded++; }
        }
        if (uploaded === 0) { UI.toast.error('No photos uploaded'); return; }
        await _writeFengShuiAudits(prospectId, audits);
        UI.toast.success(`${uploaded} photo${uploaded > 1 ? 's' : ''} uploaded`);
        await _refreshFengShuiTab(prospectId);
    } catch (err) {
        console.error('Feng shui site review photo upload failed:', err);
        UI.toast.error('Upload failed: ' + (err.message || 'Unknown error'));
    }
};

const removeFengShuiSitePhoto = async (prospectId, auditId, siteId, index) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;
    const audits = _readFengShuiAudits(prospect);
    const idx = audits.findIndex(a => a.id === auditId);
    if (idx === -1) return;
    const sr = (audits[idx].site_reviews || []).find(s => s.id === siteId);
    if (!sr || !Array.isArray(sr.photos)) return;
    if (index < 0 || index >= sr.photos.length) return;
    sr.photos.splice(index, 1);
    await _writeFengShuiAudits(prospectId, audits);
    UI.toast.success('Photo removed');
    await _refreshFengShuiTab(prospectId);
};

const removeFengShuiSiteReview = async (prospectId, auditId, siteId) => {
    if (!confirm('Remove this site review entry?')) return;
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;
    const audits = _readFengShuiAudits(prospect);
    const idx = audits.findIndex(a => a.id === auditId);
    if (idx === -1) return;
    audits[idx].site_reviews = (audits[idx].site_reviews || []).filter(s => s.id !== siteId);
    await _writeFengShuiAudits(prospectId, audits);
    UI.toast.success('Site review removed');
    await _refreshFengShuiTab(prospectId);
};

// Mirror a prospect's closing_record back onto its linked activity row so
// the calendar's "✓ CLOSED" badge (and anything else keyed on
// activities.closing_amount) shows up regardless of which path the agent
// used to record the sale. The Meeting Outcome flow already writes the
// activity directly; this covers the DC Closing Record tab path, which
// otherwise only touches prospect.closing_record.
// Picks an activity already flagged as the closing one if present;
// otherwise falls back to the most recent meeting activity for the
// prospect (CPS/FTF/FSA/EVENT).
const _mirrorCrToActivity = async (prospectId, cr) => {
    if (!prospectId || !cr) return;
    const saleAmount = parseFloat(cr.sale_amount) || 0;
    if (saleAmount <= 0) return;

    let acts = [];
    try { acts = await AppDataStore.query('activities', { prospect_id: prospectId }); }
    catch (_) { return; }
    if (!Array.isArray(acts) || !acts.length) return;

    const meetingTypes = new Set(['CPS', 'FTF', 'FSA', 'EVENT']);
    const meetings = acts.filter(a => meetingTypes.has(a.activity_type));
    if (!meetings.length) return;

    const sortByRecency = (a, b) => {
        const ka = `${a.activity_date || ''} ${a.start_time || ''}`;
        const kb = `${b.activity_date || ''} ${b.start_time || ''}`;
        return kb.localeCompare(ka);
    };
    const flagged = meetings.filter(a => a.is_closing || (parseFloat(a.closing_amount) || 0) > 0);
    const target = (flagged.length ? flagged : meetings).sort(sortByRecency)[0];
    if (!target) return;

    const updates = {
        is_closing: true,
        solution_sold: cr.product || target.solution_sold || '',
        amount_closed: saleAmount,
        closing_amount: saleAmount,
    };
    if (cr.payment_method) updates.payment_method = cr.payment_method;
    if (cr.invoice_number) updates.invoice_number = cr.invoice_number;
    if (cr.closing_date)   updates.collection_date = cr.closing_date;
    if (cr.order_date)     updates.order_date = cr.order_date;
    if (cr.payment_method === 'POP') {
        if (cr.pop_monthly) updates.pop_monthly_amount = cr.pop_monthly;
        if (cr.pop_tenure)  updates.pop_tenure = cr.pop_tenure;
        if (cr.pop_down)    updates.pop_down_payment = cr.pop_down;
    }

    try { await AppDataStore.update('activities', target.id, updates); }
    catch (e) { console.warn('mirror closing_record → activity failed:', e); }
};

const saveClosingRecord = async (prospectId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    const existingCr = prospect?.closing_record || {};
    const data = await gatherClosingFormData(existingCr);
    if (!data.full_name) return UI.toast.error('Full name is required');
    // Spread existingCr first so fields like pre2025_purchases survive a draft re-save.
    const mergedCr = { ...existingCr, ...data, status: 'draft' };
    await AppDataStore.update('prospects', prospectId, {
        closing_record: mergedCr
    });
    await _mirrorCrToActivity(prospectId, mergedCr);
    UI.toast.success('Draft saved');
    const bodyEl = document.getElementById(`acc-body-closing-${prospectId}`);
    if (bodyEl) await switchProspectTab('closing', prospectId, null, bodyEl);
};

const submitClosingRecord = async (prospectId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    const existingCr = prospect?.closing_record || {};
    const data = await gatherClosingFormData(existingCr);
    if (!data.full_name) return UI.toast.error('Full name is required');
    if (!data.product) return UI.toast.error('Product/service is required');
    if (!data.sale_amount) return UI.toast.error('Amount closed is required');
    if (!data.invoice_number) return UI.toast.error('Invoice number is required');
    if (!data.invoice_file) {
        UI.showModal(
            '📎 Invoice Upload Required',
            `<div style="padding:8px 0;">
                <p style="font-size:15px;color:var(--gray-700);margin-bottom:12px;">Please upload the <strong>purchase invoice</strong> before submitting for approval.</p>
                <div style="background:#fef9c3;border:1px solid #fcd34d;border-radius:8px;padding:12px;font-size:13px;color:#92400e;">
                    <i class="fas fa-exclamation-triangle" style="margin-right:6px;"></i>
                    The invoice is required as proof of purchase. Save a draft first, attach the invoice file, then submit.
                </div>
            </div>`,
            [{ label: 'OK, I\'ll Upload It', type: 'primary', action: 'UI.hideModal()' }]
        );
        return;
    }

    const saleAmount = parseFloat(data.sale_amount) || 0;
    const isAlreadyConverted = prospect.status === 'converted' || prospect.conversion_status === 'approved';
    const submittedCr = { ...existingCr, ...data, status: 'submitted', submitted_at: new Date().toISOString() };
    const updates = {
        closing_record: submittedCr
    };

    // Auto-trigger conversion approval only for first-time conversions
    if (saleAmount >= 2000 && !isAlreadyConverted) {
        updates.conversion_status = 'pending_approval';
        updates.conversion_requested_at = new Date().toISOString();
        updates.conversion_requested_by = _currentUser?.id;
    }

    await AppDataStore.update('prospects', prospectId, updates);
    await _mirrorCrToActivity(prospectId, submittedCr);

    // Create approval queue entries for non-managers
    const isManager = isSystemAdmin(_currentUser) || isMarketingManager(_currentUser);
    if (!isManager) {
        // Re-fetch post-update so snapshot captures the freshly submitted closing_record
        const freshProspect = await AppDataStore.getById('prospects', prospectId);
        try {
            // New sale approval entry
            await AppDataStore.create('approval_queue', {
                id: Date.now(),
                approval_type: 'new_sale',
                status: 'pending',
                prospect_id: prospectId,
                customer_id: null,
                submitted_by: _currentUser?.id,
                submitted_at: new Date().toISOString(),
                snapshot_before: null,
                snapshot_after: { ...data, sale_amount: saleAmount, prospect_name: freshProspect?.full_name },
                description: `New sale RM ${saleAmount.toLocaleString()} for ${freshProspect?.full_name || 'prospect'}`
            });
            // If auto-conversion triggered and not already a customer, create new_customer entry
            if (saleAmount >= 2000 && !isAlreadyConverted) {
                await AppDataStore.create('approval_queue', {
                    id: Date.now() + 1,
                    approval_type: 'new_customer',
                    status: 'pending',
                    prospect_id: prospectId,
                    customer_id: null,
                    submitted_by: _currentUser?.id,
                    submitted_at: new Date().toISOString(),
                    snapshot_before: null,
                    snapshot_after: freshProspect,
                    description: `New customer conversion for ${freshProspect?.full_name} (auto-triggered by sale RM ${saleAmount.toLocaleString()})`
                });
            }
        } catch (e) { /* approval queue write failed silently */ }
    }

    if (saleAmount >= 2000 && !isAlreadyConverted) {
        UI.toast.success('Closing record submitted. Sale ≥ RM 2,000 — conversion request auto-submitted for manager approval!');
    } else {
        UI.toast.success('Closing record submitted for approval');
    }
    const bodyEl = document.getElementById(`acc-body-closing-${prospectId}`);
    if (bodyEl) await switchProspectTab('closing', prospectId, null, bodyEl);
};

// Attach an invoice file to an archived history record. Used by the
// "Upload" button rendered when a history entry has no invoice_file —
// happens when the original close didn't capture a URL (e.g. storage
// upload failed silently, or the record was archived before invoice_file
// was tracked). Tries Supabase storage first, falls back to base64 data
// URL so the file still survives offline / RLS-blocked sessions.
const uploadHistoryInvoice = async (prospectId, historyIndex) => {
    const fileInput = document.getElementById(`crh-inv-${prospectId}-${historyIndex}`);
    const file = fileInput?.files?.[0];
    if (!file) return UI.toast.error('Please choose a file first');

    const prospect = await AppDataStore.getByIdFull
        ? await AppDataStore.getByIdFull('prospects', prospectId)
        : await AppDataStore.getById('prospects', prospectId);
    const history = [...(Array.isArray(prospect?.closing_records_history) ? prospect.closing_records_history : [])];
    if (historyIndex < 0 || historyIndex >= history.length) return UI.toast.error('Record not found');

    let invoice_file = null;
    const invoice_file_name = file.name;
    try {
        const sb = window.supabase || window.supabaseClient;
        if (sb && sb.storage) {
            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const path = `invoices/${Date.now()}_${safeName}`;
            const { error: upErr } = await sb.storage
                .from('attachments')
                .upload(path, file, { upsert: false, contentType: file.type });
            if (upErr) throw upErr;
            const { data: urlData } = sb.storage.from('attachments').getPublicUrl(path);
            invoice_file = urlData?.publicUrl || null;
        }
        if (!invoice_file) {
            invoice_file = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
            });
        }
    } catch (e) {
        console.warn('uploadHistoryInvoice: storage upload failed:', e);
        try {
            invoice_file = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e2 => resolve(e2.target.result);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
            });
        } catch (e2) {
            UI.toast.error('Upload failed: ' + (e.message || e));
            return;
        }
    }

    history[historyIndex] = { ...history[historyIndex], invoice_file, invoice_file_name };
    await AppDataStore.update('prospects', prospectId, { closing_records_history: history });
    UI.toast.success('Invoice attached');
    const bodyEl = document.getElementById(`acc-body-closing-${prospectId}`);
    if (bodyEl) await switchProspectTab('closing', prospectId, null, bodyEl);
    await _refreshCustClosingAfterProspectSave(prospectId);
};

const saveClosingHistoryEntry = async (prospectId, index) => {
    const prospect = await AppDataStore.getByIdFull('prospects', prospectId);
    const history = [...(Array.isArray(prospect.closing_records_history) ? prospect.closing_records_history : [])];
    if (index < 0 || index >= history.length) return UI.toast.error('Record not found');
    const pid = prospectId;
    const hi = index;
    const statusEl = document.getElementById(`crh-status-${pid}-${hi}`);
    const completedEl = document.getElementById(`crh-completed-${pid}-${hi}`);
    const remarksEl = document.getElementById(`crh-remarks-${pid}-${hi}`);
    const proofEl = document.getElementById(`crh-proof-${pid}-${hi}`);
    const updates = {
        delivery_status: statusEl?.value || history[hi].delivery_status || 'pending',
        case_completed: completedEl?.checked ?? (history[hi].case_completed || false),
        delivery_remarks: remarksEl?.value ?? (history[hi].delivery_remarks || '')
    };
    if (proofEl?.dataset.b64) {
        updates.delivery_proof = proofEl.dataset.b64;
        updates.delivery_proof_name = proofEl.dataset.fname || 'proof';
    }
    history[index] = { ...history[index], ...updates };
    await AppDataStore.update('prospects', prospectId, { closing_records_history: history });
    UI.toast.success('Delivery info saved');
    const bodyEl = document.getElementById(`acc-body-closing-${prospectId}`);
    if (bodyEl) await switchProspectTab('closing', prospectId, null, bodyEl);
    await _refreshCustClosingAfterProspectSave(prospectId);
};

const saveClosingDeliveryStatus = async (prospectId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect?.closing_record) return UI.toast.error('No active closing record found');
    const statusEl = document.getElementById(`cr-active-status-${prospectId}`);
    const completedEl = document.getElementById(`cr-active-completed-${prospectId}`);
    const remarksEl = document.getElementById(`cr-active-remarks-${prospectId}`);
    const proofEl = document.getElementById(`cr-active-proof-${prospectId}`);
    const updates = {
        delivery_status: statusEl?.value || prospect.closing_record.delivery_status || 'pending',
        case_completed: completedEl?.checked ?? (prospect.closing_record.case_completed || false),
        delivery_remarks: remarksEl?.value ?? (prospect.closing_record.delivery_remarks || '')
    };
    if (proofEl?.dataset.b64) {
        updates.delivery_proof = proofEl.dataset.b64;
        updates.delivery_proof_name = proofEl.dataset.fname || 'proof';
    }
    await AppDataStore.update('prospects', prospectId, {
        closing_record: { ...prospect.closing_record, ...updates }
    });
    UI.toast.success('Delivery status saved');
    const bodyEl = document.getElementById(`acc-body-closing-${prospectId}`);
    if (bodyEl) await switchProspectTab('closing', prospectId, null, bodyEl);
};

const archiveAndNewClosingRecord = async (prospectId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect?.closing_record) return;
    const cr = prospect.closing_record;
    const existingHistory = Array.isArray(prospect.closing_records_history) ? prospect.closing_records_history : [];
    await AppDataStore.update('prospects', prospectId, {
        closing_records_history: [...existingHistory, cr],
        closing_record: null
    });
    const bodyEl = document.getElementById(`acc-body-closing-${prospectId}`);
    if (bodyEl) await switchProspectTab('closing', prospectId, null, bodyEl);
};

// ========== PURCHASES HISTORY VIEW ==========

const showPurchasesHistoryView = async (viewport) => {
    viewport.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:200px;color:var(--gray-400);"><i class="fas fa-spinner fa-spin" style="font-size:24px;"></i></div>`;
    const now = Date.now();
    if (!_purchasesHistoryCache || now - _purchasesHistoryCacheTs > 300_000) {
        await _loadPurchasesHistory();
    }
    _renderPurchasesHistory(viewport);
};

const _loadPurchasesHistory = async () => {
    try {
        const allProspects = await AppDataStore.getAll('prospects');
        console.log('[PH] total prospects from getAll:', (allProspects||[]).length);
        const convertedIds = (allProspects || [])
            .filter(p => p.status === 'converted' || p.conversion_status === 'approved')
            .map(p => p.id);
        console.log('[PH] convertedIds:', convertedIds);
        let data = [];
        if (convertedIds.length) {
            const { data: rows, error } = await AppDataStore._readClient()
                .from('prospects')
                .select('id,full_name,responsible_agent_id,closing_records_history,closing_record,conversion_status')
                .in('id', convertedIds);
            console.log('[PH] .in() query result:', rows, 'error:', error);
            if (error) throw error;
            data = rows || [];
        }
        console.log('[PH] data rows to process:', data.length);
        const allUsers = await AppDataStore.getAll('users');
        const agentMap = Object.fromEntries((allUsers||[]).map(u => [String(u.id), u.full_name || u.name || u.email || 'Unknown']));
        const rows = [];
        for (const p of (data || [])) {
            const history = Array.isArray(p.closing_records_history) ? p.closing_records_history : [];
            history.forEach((h, hi) => {
                rows.push({
                    prospectId: p.id,
                    customerName: p.full_name || '-',
                    agentId: h.lead_agent_id || p.responsible_agent_id,
                    agentName: agentMap[String(h.lead_agent_id || p.responsible_agent_id)] || '-',
                    date: h.closing_date || (h.approved_at ? h.approved_at.split('T')[0] : ''),
                    invoiceNo: h.invoice_number || '-',
                    product: h.product || '-',
                    amount: parseFloat(h.sale_amount) || 0,
                    deliveryStatus: h.delivery_status || 'pending',
                    remarks: h.delivery_remarks || '',
                    caseCompleted: !!h.case_completed,
                    isHistory: true,
                    historyIndex: hi,
                });
            });
            if (p.closing_record && p.conversion_status === 'approved' && (p.closing_record.sale_amount || p.closing_record.invoice_number)) {
                const h = p.closing_record;
                rows.push({
                    prospectId: p.id,
                    customerName: p.full_name || '-',
                    agentId: h.lead_agent_id || p.responsible_agent_id,
                    agentName: agentMap[String(h.lead_agent_id || p.responsible_agent_id)] || '-',
                    date: h.closing_date || (h.approved_at ? h.approved_at.split('T')[0] : ''),
                    invoiceNo: h.invoice_number || '-',
                    product: h.product || '-',
                    amount: parseFloat(h.sale_amount) || 0,
                    deliveryStatus: h.delivery_status || 'pending',
                    remarks: h.delivery_remarks || '',
                    caseCompleted: !!h.case_completed,
                    isHistory: false,
                    historyIndex: -1,
                });
            }
        }
        rows.sort((a, b) => {
            if (!a.date && !b.date) return 0;
            if (!a.date) return 1;
            if (!b.date) return -1;
            return b.date.localeCompare(a.date);
        });
        _purchasesHistoryCache = { rows, agentMap };
        _purchasesHistoryCacheTs = Date.now();
    } catch (e) {
        console.error('Purchases history load error:', e);
        _purchasesHistoryCache = { rows: [], agentMap: {} };
        _purchasesHistoryCacheTs = Date.now();
    }
};

const _renderPurchasesHistory = (viewport) => {
    const { rows = [], agentMap = {} } = _purchasesHistoryCache || {};
    const f = _phFilter;
    const filtered = rows.filter(r => {
        if (f.search) {
            const q = f.search.toLowerCase();
            if (!r.customerName.toLowerCase().includes(q) && !r.invoiceNo.toLowerCase().includes(q) && !r.product.toLowerCase().includes(q)) return false;
        }
        if (f.agent !== 'all' && String(r.agentId) !== f.agent) return false;
        if (f.delivery !== 'all' && r.deliveryStatus !== f.delivery) return false;
        if (f.from && r.date && r.date < f.from) return false;
        if (f.to && r.date && r.date > f.to) return false;
        return true;
    });
    const totalCount = filtered.length;
    const totalAmt = filtered.reduce((s, r) => s + r.amount, 0);
    const start = _phPage * _PH_PAGE_SIZE;
    const pageRows = filtered.slice(start, start + _PH_PAGE_SIZE);
    const totalPages = Math.ceil(totalCount / _PH_PAGE_SIZE);
    const uniqueAgentIds = [...new Set(rows.map(r => r.agentId).filter(Boolean))];
    const agentOptions = uniqueAgentIds.map(id => `<option value="${id}" ${f.agent===String(id)?'selected':''}>${escapeHtml(agentMap[String(id)]||String(id))}</option>`).join('');
    const tableRows = pageRows.map((r, i) => {
        const sn = start + i + 1;
        const rk = `${r.prospectId}-${r.historyIndex}`;
        const rowBg = r.caseCompleted ? 'background:#f0fdf4;' : '';
        return `<tr style="border-bottom:1px solid #f3f4f6;${rowBg}">
            <td style="padding:8px 10px;font-size:12px;color:var(--gray-400);text-align:center;">${sn}</td>
            <td style="padding:8px 10px;font-size:12px;white-space:nowrap;">${r.date||'-'}</td>
            <td style="padding:8px 10px;font-size:12px;white-space:nowrap;">${escapeHtml(r.agentName)}</td>
            <td style="padding:8px 10px;font-size:12px;white-space:nowrap;">${escapeHtml(r.invoiceNo)}</td>
            <td style="padding:8px 10px;font-size:12px;">
                <span style="color:var(--primary);cursor:pointer;text-decoration:underline;font-weight:500;" onclick="event.stopPropagation();app.showProspectDetail(${r.prospectId})">${escapeHtml(r.customerName)}</span>
            </td>
            <td style="padding:8px 10px;font-size:12px;">${escapeHtml(r.product)}</td>
            <td style="padding:8px 10px;font-size:12px;text-align:right;font-weight:600;white-space:nowrap;">RM ${r.amount.toLocaleString()}</td>
            <td style="padding:8px 10px;">
                <select id="ph-ds-${rk}" class="form-control" style="font-size:11px;min-width:130px;">
                    <option value="pending" ${r.deliveryStatus==='pending'?'selected':''}>Pending Delivery</option>
                    <option value="delivered" ${r.deliveryStatus==='delivered'?'selected':''}>Delivered</option>
                    <option value="completed" ${r.deliveryStatus==='completed'?'selected':''}>Completed</option>
                </select>
            </td>
            <td style="padding:8px 10px;">
                <input id="ph-rem-${rk}" class="form-control" value="${escapeHtml(r.remarks)}" placeholder="Remarks..." style="height:28px;font-size:11px;min-width:150px;">
            </td>
            <td style="padding:8px 10px;text-align:center;">
                <input type="checkbox" id="ph-cc-${rk}" ${r.caseCompleted?'checked':''} style="width:16px;height:16px;cursor:pointer;">
            </td>
            <td style="padding:8px 10px;text-align:center;">
                <button class="btn primary btn-sm" style="height:28px;padding:0 12px;font-size:11px;" onclick="event.stopPropagation();app.savePurchasesHistoryRow(${r.prospectId},${r.historyIndex},${r.isHistory})"><i class="fas fa-save"></i></button>
            </td>
        </tr>`;
    }).join('');
    const pager = totalPages > 1 ? `
        <div style="display:flex;align-items:center;justify-content:center;gap:12px;padding:16px;border-top:1px solid #e5e7eb;">
            <button class="btn secondary btn-sm" ${_phPage===0?'disabled':''} onclick="app.phSetPage(${_phPage-1})"><i class="fas fa-chevron-left"></i> Prev</button>
            <span style="font-size:13px;color:var(--gray-600);">Page ${_phPage+1} of ${totalPages}</span>
            <button class="btn secondary btn-sm" ${_phPage>=totalPages-1?'disabled':''} onclick="app.phSetPage(${_phPage+1})">Next <i class="fas fa-chevron-right"></i></button>
        </div>` : '';
    viewport.innerHTML = `
        <div style="padding:16px 20px 10px;background:#fff;border-bottom:1px solid #e5e7eb;position:sticky;top:0;z-index:10;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
                <div>
                    <div style="font-size:18px;font-weight:700;color:var(--gray-800);">🧾 Purchases History</div>
                    <div style="font-size:12px;color:var(--gray-400);margin-top:2px;">${totalCount} record${totalCount!==1?'s':''} · Total: <strong style="color:var(--gray-700);">RM ${totalAmt.toLocaleString()}</strong></div>
                </div>
                <button class="btn secondary btn-sm" onclick="app.refreshPurchasesHistory()"><i class="fas fa-sync-alt"></i> Refresh</button>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                <input class="form-control" placeholder="🔍 Customer / invoice / product" value="${escapeHtml(f.search)}" style="flex:1;min-width:180px;height:32px;font-size:12px;" oninput="app.phSetFilter('search',this.value)">
                <select class="form-control" style="height:32px;font-size:12px;min-width:130px;" onchange="app.phSetFilter('agent',this.value)">
                    <option value="all" ${f.agent==='all'?'selected':''}>All Consultants</option>
                    ${agentOptions}
                </select>
                <select class="form-control" style="height:32px;font-size:12px;min-width:120px;" onchange="app.phSetFilter('delivery',this.value)">
                    <option value="all" ${f.delivery==='all'?'selected':''}>All Status</option>
                    <option value="pending" ${f.delivery==='pending'?'selected':''}>Pending</option>
                    <option value="delivered" ${f.delivery==='delivered'?'selected':''}>Delivered</option>
                    <option value="completed" ${f.delivery==='completed'?'selected':''}>Completed</option>
                </select>
                <input type="date" class="form-control" value="${f.from}" style="height:32px;font-size:12px;width:130px;" onchange="app.phSetFilter('from',this.value)">
                <span style="font-size:12px;color:var(--gray-400);">–</span>
                <input type="date" class="form-control" value="${f.to}" style="height:32px;font-size:12px;width:130px;" onchange="app.phSetFilter('to',this.value)">
            </div>
        </div>
        <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;min-width:1000px;">
                <thead>
                    <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
                        <th scope="col" style="padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-500);text-align:center;white-space:nowrap;">SN</th>
                        <th scope="col" style="padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-500);white-space:nowrap;">Date</th>
                        <th scope="col" style="padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-500);white-space:nowrap;">Consultant</th>
                        <th scope="col" style="padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-500);white-space:nowrap;">Invoice No</th>
                        <th scope="col" style="padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-500);white-space:nowrap;">Customer Name</th>
                        <th scope="col" style="padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-500);white-space:nowrap;">Product / Service</th>
                        <th scope="col" style="padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-500);text-align:right;white-space:nowrap;">Amount (RM)</th>
                        <th scope="col" style="padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-500);white-space:nowrap;">Delivery Tracking</th>
                        <th scope="col" style="padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-500);white-space:nowrap;">Remarks</th>
                        <th scope="col" style="padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-500);text-align:center;white-space:nowrap;">Case Completed</th>
                        <th scope="col" style="padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-500);text-align:center;white-space:nowrap;">Save</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows || `<tr><td colspan="11" style="padding:48px;text-align:center;color:var(--gray-400);font-size:13px;"><i class="fas fa-receipt" style="font-size:36px;display:block;margin-bottom:10px;opacity:.4;"></i>No purchase records found</td></tr>`}
                </tbody>
            </table>
        </div>
        ${pager}
    `;
};

const phSetFilter = (key, val) => {
    _phFilter[key] = val;
    _phPage = 0;
    const vp = document.getElementById('content-viewport');
    if (vp) _renderPurchasesHistory(vp);
};

const phSetPage = (page) => {
    _phPage = page;
    const vp = document.getElementById('content-viewport');
    if (vp) _renderPurchasesHistory(vp);
};

const refreshPurchasesHistory = async () => {
    _purchasesHistoryCache = null;
    _purchasesHistoryCacheTs = 0;
    const vp = document.getElementById('content-viewport');
    if (vp) await showPurchasesHistoryView(vp);
};

const savePurchasesHistoryRow = async (prospectId, historyIndex, isHistory) => {
    const rk = `${prospectId}-${historyIndex}`;
    const statusEl = document.getElementById(`ph-ds-${rk}`);
    const remarksEl = document.getElementById(`ph-rem-${rk}`);
    const completedEl = document.getElementById(`ph-cc-${rk}`);
    const updates = {
        delivery_status: statusEl?.value || 'pending',
        delivery_remarks: remarksEl?.value || '',
        case_completed: completedEl?.checked || false,
    };
    const prospect = await AppDataStore.getByIdFull('prospects', prospectId);
    if (!prospect) return UI.toast.error('Prospect not found');
    if (isHistory) {
        const history = Array.isArray(prospect.closing_records_history) ? [...prospect.closing_records_history] : [];
        if (historyIndex < 0 || historyIndex >= history.length) return UI.toast.error('Record not found');
        history[historyIndex] = { ...history[historyIndex], ...updates };
        await AppDataStore.update('prospects', prospectId, { closing_records_history: history });
    } else {
        if (!prospect.closing_record) return UI.toast.error('No active closing record');
        await AppDataStore.update('prospects', prospectId, { closing_record: { ...prospect.closing_record, ...updates } });
    }
    if (_purchasesHistoryCache?.rows) {
        const row = _purchasesHistoryCache.rows.find(r => r.prospectId == prospectId && r.historyIndex == historyIndex && r.isHistory === isHistory);
        if (row) Object.assign(row, updates);
    }
    UI.toast.success('Saved');
};

const approveClosingRecord = async (prospectId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect?.closing_record) return UI.toast.error('No closing record found');
    const isAlreadyConverted = prospect.status === 'converted' || prospect.conversion_status === 'approved';
    if (isAlreadyConverted) {
        // Additional sale on existing customer — add purchase, archive CR, reset
        const cr = prospect.closing_record;
        const now = new Date().toISOString();
        const saleAmount = parseFloat(cr.sale_amount) || 0;
        const customers = await AppDataStore.getAll('customers', { fresh: true });
        let customer = customers.find(c => c.converted_from_prospect_id == prospectId);
        if (!customer) {
            // Prospect was marked converted but no customer record exists — create one now
            const newCust = await AppDataStore.create('customers', {
                id: Date.now(),
                full_name: prospect.full_name,
                phone: prospect.phone,
                email: prospect.email,
                ic_number: prospect.ic_number,
                date_of_birth: prospect.date_of_birth,
                responsible_agent_id: prospect.responsible_agent_id,
                status: 'active',
                lifetime_value: 0,
                customer_since: cr.closing_date || cr.order_date || now.split('T')[0],
                converted_from_prospect_id: prospectId,
            });
            customer = newCust;
        }
        if (customer) {
            await AppDataStore.create('purchases', {
                id: Date.now(),
                customer_id: customer.id,
                date: cr.closing_date || cr.order_date || now.split('T')[0],
                invoice: cr.invoice_number || '',
                item: cr.product || '',
                amount: saleAmount,
                status: 'COMPLETED',
                payment_method: cr.payment_method || 'Cash'
            });
            await AppDataStore.update('customers', customer.id, {
                lifetime_value: (customer.lifetime_value || 0) + saleAmount
            });
        }
        const existingHistory = Array.isArray(prospect.closing_records_history) ? prospect.closing_records_history : [];
        await AppDataStore.update('prospects', prospectId, {
            closing_records_history: [...existingHistory, { ...cr, status: 'approved', approved_at: now }],
            closing_record: null
        });
        UI.toast.success(`Sale of RM ${saleAmount.toLocaleString()} approved!`);
    } else {
        // First conversion — reuse full-copy conversion
        await approveProspectConversion(prospectId);
    }
    _purchasesHistoryCache = null;
    const bodyEl = document.getElementById(`acc-body-closing-${prospectId}`);
    if (bodyEl) await switchProspectTab('closing', prospectId, null, bodyEl);
};

const rejectClosingRecord = async (prospectId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect?.closing_record) return UI.toast.error('No closing record found');
    const cr = prospect.closing_record;
    await AppDataStore.update('prospects', prospectId, {
        closing_record: { ...cr, status: 'draft', rejected_at: new Date().toISOString() }
    });
    UI.toast.success('Record sent back to agent for revision');
    const bodyEl = document.getElementById(`acc-body-closing-${prospectId}`);
    if (bodyEl) await switchProspectTab('closing', prospectId, null, bodyEl);
};

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
    await AppDataStore.create('customers', {
        full_name: name,
        phone: document.getElementById('cust-phone')?.value,
        email: document.getElementById('cust-email')?.value,
        ic_number: document.getElementById('cust-ic')?.value,
        date_of_birth: document.getElementById('cust-dob')?.value,
        lifetime_value: parseFloat(document.getElementById('cust-init-amt')?.value) || 0,
        status: 'active',
        customer_since: new Date().toISOString().split('T')[0],
        responsible_agent_id: _currentUser?.id || null,
    });
    UI.hideModal();
    UI.toast.success('Customer created (Legacy)');
    if (document.getElementById('customers-table-body')) await renderCustomersTable();
};

const openAddPurchaseModal = async (customerId) => {
    const customer = await AppDataStore.getById('customers', customerId);
    const content = `
<div class="form-section">
                <div class="form-group">
                    <label>Product</label>
                    <select id="pur-product" class="form-control">
                        <option value="PR4 Power Ring">PR4 Power Ring</option>
                        <option value="PR3 Ring">PR3 Ring</option>
                        <option value="Office Audit">Office Audit</option>
                        <option value="Harmony Painting">Harmony Painting</option>
                        <option value="Other">Other (Type below)</option>
                    </select>
                </div>
                <div class="form-group"><label>Product Name (if Other)</label><input type="text" id="pur-other" class="form-control"></div>
                <div class="form-row">
                    <div class="form-group half"><label>Amount (RM) <span class="required">*</span></label><input type="number" id="pur-amt" class="form-control"></div>
                    <div class="form-group half">
                        <label>Payment Method</label>
                        <select id="pur-method" class="form-control" onchange="const epp = document.getElementById('epp-fields'); if(this.value==='EPP') epp.style.display='block'; else epp.style.display='none';">
                            <option value="Cash">Cash</option>
                            <option value="Credit Card">Credit Card</option>
                            <option value="Bank Transfer">Bank Transfer</option>
                            <option value="EPP">EPP (Easy Payment Plan)</option>
                            <option value="POP">POP (Pre-Owned Plan)</option>
                        </select>
                    </div>
                </div>
                <div id="epp-fields" style="display:none; margin-bottom:16px;">
                    <div class="form-row">
                        <div class="form-group half"><label>Months</label><select id="epp-months" class="form-control"><option>6</option><option>12</option><option>18</option><option>24</option><option>36</option></select></div>
                        <div class="form-group half"><label>Bank</label><input type="text" id="epp-bank" class="form-control" placeholder="Bank name"></div>
                    </div>
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
                    <div class="form-group"><label>Package Name</label><input type="text" class="form-control"></div>
                    <div class="form-group"><label>Description</label><textarea class="form-control" rows="2"></textarea></div>
                </div>
            </div>
`;
    UI.showModal(`Add Purchase for ${customer.full_name}`, content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Add Purchase', type: 'primary', action: `(async () => { await app.savePurchase(${customerId}); })()` }
    ]);
};

const savePurchase = async (customerId) => {
    const amt = parseFloat(document.getElementById('pur-amt')?.value);
    if (!amt) return UI.toast.error('Amount is required');
    const invoiceNo = document.getElementById('pur-inv')?.value?.trim();
    if (!invoiceNo) return UI.toast.error('Invoice No. is required');

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
if (found) {
    matchingPkg = p;
    break;
}
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
    // Fetch customer first so we can attribute the purchase to the responsible agent
    const customer = await AppDataStore.getById('customers', customerId);
    const pur = {
        customer_id: customerId,
        agent_id: customer?.responsible_agent_id || null,
        date: new Date().toISOString().split('T')[0],
        invoice: invoiceNo,
        item: item,
        amount: amt,
        status: document.getElementById('pur-status')?.value,
        delivery_status: document.getElementById('pur-delivery')?.value || 'Pending Delivery',
        proof: document.getElementById('pur-file')?.value ? 'image_uploaded.png' : '',
        package_id: packageId,
        payment_method: purMethod,
        epp_months: Number.isFinite(eppMonthsInt) ? eppMonthsInt : null,
        epp_bank: eppBankRaw || null,
    };
    await AppDataStore.create('purchases', pur);

    // Update lifetime value
    await AppDataStore.update('customers', customerId, { lifetime_value: (customer.lifetime_value || 0) + amt });

    UI.hideModal();
    UI.toast.success('Purchase added');
    const closingBody = document.getElementById(`cust-acc-body-closing-${customerId}`);
    if (closingBody) await renderCustomerClosingTab(customer, closingBody);
    else if (document.getElementById('customers-table-body')) await renderCustomersTable();
};

const _deliveryStatusColors = { 'Pending Delivery': 'background:#fef3c7;color:#92400e', 'Dispatched': 'background:#dbeafe;color:#1e40af', 'Delivered': 'background:#dcfce7;color:#166534' };
const _deliveryStatusIcons = { 'Pending Delivery': 'fa-clock', 'Dispatched': 'fa-truck', 'Delivered': 'fa-check-circle' };

const _setDelivery = async (mode, id, customerId, newStatus) => {
    if (mode === 'purchase') {
        await AppDataStore.update('purchases', id, { delivery_status: newStatus });
    } else {
        const prospect = await AppDataStore.getById('prospects', id);
        const cr = { ...(prospect?.closing_record || {}), delivery_status: newStatus };
        await AppDataStore.update('prospects', id, { closing_record: cr });
    }
    UI.toast.success('Delivery updated: ' + newStatus);
    const customer = await AppDataStore.getById('customers', customerId);
    const closingBody = document.getElementById(`cust-acc-body-closing-${customerId}`);
    if (closingBody) await renderCustomerClosingTab(customer, closingBody);
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

const updateConversionDelivery = async (prospectId, customerId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    const current = prospect?.closing_record?.delivery_status || 'Pending Delivery';
    const statuses = ['Pending Delivery', 'Dispatched', 'Delivered'];
    const content = `<div style="display:flex;flex-direction:column;gap:10px;padding:4px 0;">
        ${statuses.map(s => `<button class="btn ${s === current ? 'primary' : 'secondary'}" style="text-align:left;justify-content:flex-start;gap:10px;" onclick="(async()=>{await app._setDelivery('conversion',${prospectId},${customerId},'${s}');UI.hideModal();})()"><i class="fas ${_deliveryStatusIcons[s]||'fa-circle'}" style="width:16px;"></i> ${s}${s===current?' ✓':''}</button>`).join('')}
    </div>`;
    UI.showModal('Update Delivery Status', content, [{ label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }]);
};

const openRecruitModal = async (customerId) => {
    const customer = await AppDataStore.getById('customers', customerId);
    const content = `
<div class="form-section">
                <h4 style="margin-bottom:12px;">Package Selection</h4>
                <div class="form-row">
                    <div class="form-group half"><label>Package Type</label><select id="rec-pkg" class="form-control"><option>Premium</option><option>Standard</option><option>Basic</option></select></div>
                    <div class="form-group half"><label>Package Amount</label><input type="number" id="rec-amt" class="form-control" value="3000"></div>
                </div>
                <div class="form-group"><label>Description</label><textarea class="form-control" rows="2"></textarea></div>
                
                <h4 style="margin-top:20px; margin-bottom:12px;">License & Assignment</h4>
                <div class="form-row">
                    <div class="form-group half"><label>License Start</label><input type="date" class="form-control" value="${new Date().toISOString().split('T')[0]}"></div>
                    <div class="form-group half"><label>License Expiry</label><input type="date" class="form-control" value="${new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}"></div>
                </div>
                <div class="form-row">
                    <div class="form-group half"><label>Commission Rate (%)</label><input type="number" class="form-control" value="30"></div>
                    <div class="form-group half"><label>Team Assignment</label><select class="form-control">${Array.from({length: 26}, (_, i) => String.fromCharCode(65 + i)).map(L => `<option>Team ${L}</option>`).join('')}</select></div>
                </div>
                <div class="form-group"><label>Reporting To</label><select class="form-control"><option>Michelle Tan</option></select></div>
                
                <div class="form-section" style="background:#fefce8; border:1px solid #fde047;">
                    <h4 style="color:#854d0e;">Approval Section</h4>
                    <label class="checkbox-label" style="display:flex; align-items:center; gap:8px;">
                        <input type="checkbox" checked disabled> Requires Super Admin Approval
                    </label>
                    <div class="form-group" style="margin-top:8px;"><label>Notes for Approval</label><textarea class="form-control" rows="2"></textarea></div>
                </div>
            </div>
`;
    UI.showModal('Convert Customer to Agent', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Submit for Approval', type: 'primary', action: '(async () => { await app.submitRecruitmentApproval(); })()' }
    ]);
};


const confirmDelete = async (id) => {
    UI.showModal('Delete Confirmation',
        '<p>Are you sure you want to delete this prospect? This action cannot be undone.</p>', [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Confirm Delete', type: 'primary', action: `(async () => { await app.executeDelete(${id}); })()` }
    ]
    );
};

const executeDelete = async (id) => {
    UI.hideModal();
    try {
        const [acts, allNotes, names, referrals] = await Promise.all([
            AppDataStore.query('activities', { prospect_id: id }).catch(() => []),
            AppDataStore.getAll('notes').catch(() => []),
            AppDataStore.query('names', { prospect_id: id }).catch(() => []),
            AppDataStore.query('referrals', { referred_prospect_id: id }).catch(() => []),
        ]);
        const notes = allNotes.filter(n =>
            String(n.prospect_id) === String(id) ||
            (n.entity_type === 'prospect' && String(n.entity_id) === String(id))
        );
        // Bulk-delete related records in parallel (was sequential — O(N) round trips)
        await Promise.all([
            acts.length ? AppDataStore.deleteMany('activities', acts.map(a => a.id)) : Promise.resolve(),
            notes.length ? AppDataStore.deleteMany('notes', notes.map(n => n.id)) : Promise.resolve(),
            names.length ? AppDataStore.deleteMany('names', names.map(n => n.id)) : Promise.resolve(),
            referrals.length ? AppDataStore.deleteMany('referrals', referrals.map(r => r.id)) : Promise.resolve(),
        ]);
        await AppDataStore.delete('prospects', id);
        UI.toast.success('Prospect deleted successfully');
        await (window.app.showProspectsViewSmart || (() => {}))(document.getElementById('content-viewport'));
    } catch (err) {
        UI.toast.error('Failed to delete: ' + (err.message || 'Unknown error'));
    }
};

const calculateAge = (dob) => {
    if (!dob) return 35;
    const birthDate = new Date(dob);
    const diff = Date.now() - birthDate.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
};

// Tag Functions
const openAddTagModal = async (entityId, entityType = 'prospect') => {
    const allTags = await AppDataStore.getAll('tags');
    const existingTagMappings = await AppDataStore.query('entity_tags', { entity_type: entityType, entity_id: entityId });
    const existingTagIds = existingTagMappings.map(et => et.tag_id);
    const availableTags = allTags.filter(t => !existingTagIds.includes(t.id));

    const content = `
<div class="form-group">
            <label>Select Tag</label>
            <select id="tag-select" class="form-control">
                <option value="">-- Select existing tag --</option>
                ${availableTags.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
            </select>
        </div>
        <div class="form-group">
            <label>Or create new tag</label>
            <input type="text" id="new-tag-name" class="form-control" placeholder="New tag name">
        </div>
        <div class="form-group">
            <label>Tag Color</label>
            <select id="new-tag-color" class="form-control">
                <option value="blue">Blue</option>
                <option value="purple">Purple</option>
                <option value="green">Green</option>
                <option value="orange">Orange</option>
                <option value="teal">Teal</option>
                <option value="gray">Gray</option>
            </select>
        </div>
`;

    UI.showModal('Add Tag', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Add Tag', type: 'primary', action: `(async () => { await app.addTagToEntity(${entityId}, '${entityType}'); })()` }
    ]);
};

const addTagToEntity = async (entityId, entityType) => {
    const tagSelect = document.getElementById('tag-select');
    const newTagName = document.getElementById('new-tag-name')?.value;
    const newTagColor = document.getElementById('new-tag-color')?.value;

    let tagId = null;

    if (tagSelect && tagSelect.value) {
        tagId = parseInt(tagSelect.value);
    } else if (newTagName) {
        const newTag = await AppDataStore.create('tags', {
            name: newTagName,
            color: newTagColor || 'blue'
        });
        tagId = newTag.id;
    } else {
        UI.toast.error('Please select or create a tag');
        return;
    }

    await AppDataStore.create('entity_tags', {
        entity_type: entityType,
        entity_id: entityId,
        tag_id: tagId
    });

    UI.hideModal();
    if (entityType === 'prospect') {
        await app.showProspectDetail(entityId);
    } else if (entityType === 'customer') {
        await app.showCustomerDetail(entityId);
    }
    UI.toast.success('Tag added');
};

const removeTagFromCustomer = async (customerId, tagId) => {
    const mappings = await AppDataStore.query('entity_tags', {
        entity_type: 'customer',
        entity_id: customerId,
        tag_id: tagId
    });
    if (mappings.length > 0) {
        await AppDataStore.delete('entity_tags', mappings[0].id);
        await app.showCustomerDetail(customerId);
        UI.toast.success('Tag removed');
    }
};

const removeTagFromProspect = async (prospectId, tagId) => {
    const mappings = await AppDataStore.query('entity_tags', {
        entity_type: 'prospect',
        entity_id: prospectId,
        tag_id: tagId
    });
    if (mappings.length > 0) {
        await AppDataStore.delete('entity_tags', mappings[0].id);
        await app.showProspectDetail(prospectId);
        UI.toast.success('Tag removed');
    }
};

// Solution Functions
const openAddSolutionModal = async (prospectId) => {
const today = new Date().toISOString().split('T')[0];
const nextWeek = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];

const content = `
    <div class="form-group">
        <label>Solution / Product</label>
        <select id="solution-name" class="form-control">
            <option value="Harmony Painting">🖼️ Harmony Painting (画作)</option>
            <option value="PR4 Power Ring">PR4 Power Ring</option>
            <option value="PR3 Ring">PR3 Ring</option>
            <option value="PR5 Ring">PR5 Ring</option>
            <option value="Office Audit">Office Audit</option>
            <option value="Home Audit">Home Audit</option>
            <option value="Career Consultation">Career Consultation</option>
        </select>
    </div>
    <div class="form-group">
        <label>Proposed Date</label>
        <input type="date" id="solution-date" class="form-control" value="${today}">
    </div>
    <div class="form-group">
        <label>Status</label>
        <select id="solution-status" class="form-control">
            <option value="Proposed">Proposed</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
            <option value="Purchased">Purchased</option>
        </select>
    </div>
    <div class="form-group">
        <label>Next Follow-Up Date <span style="color:#6b7280;font-size:12px;">(auto-reminders will fire on this date)</span></label>
        <input type="date" id="solution-followup-date" class="form-control" value="${nextWeek}">
    </div>
    <div class="form-group">
        <label>Notes</label>
        <textarea id="solution-notes" class="form-control" rows="2" placeholder="e.g. Customer prefers size 80x120cm, mountain motif"></textarea>
    </div>
`;

UI.showModal('Add Proposed Solution', content, [
    { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
    { label: 'Save', type: 'primary', action: `(async () => { await app.saveSolution(${prospectId}); })()` }
]);
};


const saveSolution = async (prospectId) => {
    const solution = document.getElementById('solution-name')?.value;
    const date = document.getElementById('solution-date')?.value;
    const status = document.getElementById('solution-status')?.value;
    const notes = document.getElementById('solution-notes')?.value;
    const followUpDate = document.getElementById('solution-followup-date')?.value || null;

    if (!solution || !date) {
        UI.toast.error('Solution and date are required');
        return;
    }

    await AppDataStore.create('proposed_solutions', {
        prospect_id: prospectId,
        solution: solution,
        proposed_date: date,
        status: status,
        notes: notes || null,
        next_follow_up_date: followUpDate,
        follow_up_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    });

    // Dispatch after_solution_proposed triggers immediately for day-0 / day-1 drafts
    (window.app.dispatchPendingSolutionReminders || (() => {}))().catch(() => {});

    UI.hideModal();
    await app.showProspectDetail(prospectId);
    UI.toast.success('Solution added');
};

const openEditSolutionModal = async (solutionId, entityId, isProspect = true) => {
    let sol;
    try { sol = (await AppDataStore.getAll('proposed_solutions')).find(s => String(s.id) === String(solutionId)); } catch (e) {}
    if (!sol) { UI.toast.error('Solution not found'); return; }

    const content = `
        <div class="form-group">
            <label>Solution / Product</label>
            <select id="edit-solution-name" class="form-control">
                <option value="Harmony Painting" ${sol.solution === 'Harmony Painting' ? 'selected' : ''}>🖼️ Harmony Painting (画作)</option>
                <option value="PR4 Power Ring" ${sol.solution === 'PR4 Power Ring' ? 'selected' : ''}>PR4 Power Ring</option>
                <option value="PR3 Ring" ${sol.solution === 'PR3 Ring' ? 'selected' : ''}>PR3 Ring</option>
                <option value="PR5 Ring" ${sol.solution === 'PR5 Ring' ? 'selected' : ''}>PR5 Ring</option>
                <option value="Office Audit" ${sol.solution === 'Office Audit' ? 'selected' : ''}>Office Audit</option>
                <option value="Home Audit" ${sol.solution === 'Home Audit' ? 'selected' : ''}>Home Audit</option>
                <option value="Career Consultation" ${sol.solution === 'Career Consultation' ? 'selected' : ''}>Career Consultation</option>
            </select>
        </div>
        <div class="form-group">
            <label>Status</label>
            <select id="edit-solution-status" class="form-control">
                <option value="Proposed" ${sol.status === 'Proposed' ? 'selected' : ''}>Proposed</option>
                <option value="Approved" ${sol.status === 'Approved' ? 'selected' : ''}>Approved</option>
                <option value="Rejected" ${sol.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                <option value="Purchased" ${sol.status === 'Purchased' ? 'selected' : ''}>Purchased</option>
            </select>
        </div>
        <div class="form-group">
            <label>Next Follow-Up Date</label>
            <input type="date" id="edit-solution-followup-date" class="form-control" value="${sol.next_follow_up_date || ''}">
        </div>
        <div class="form-group">
            <label>Notes</label>
            <textarea id="edit-solution-notes" class="form-control" rows="2">${escapeHtml(sol.notes || '')}</textarea>
        </div>
        ${sol.escalated_at ? `<div style="background:#fef2f2;border-radius:6px;padding:8px 12px;font-size:12px;color:#dc2626;margin-top:4px;"><i class="fas fa-exclamation-triangle"></i> Escalated ${sol.escalated_at.split('T')[0]}: ${escapeHtml(sol.escalation_notes || '')}</div>` : ''}
        ${sol.follow_up_count ? `<div style="font-size:12px;color:#6b7280;margin-top:6px;"><i class="fas fa-clock"></i> ${sol.follow_up_count} follow-up${sol.follow_up_count > 1 ? 's' : ''} sent${sol.last_follow_up_date ? ' · Last: ' + sol.last_follow_up_date : ''}</div>` : ''}
    `;

    UI.showModal('Edit Proposed Solution', content, [
        { label: 'Delete', type: 'danger', action: `(async () => { await app.deleteSolution(${solutionId}, ${entityId}, ${isProspect}); })()` },
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Save', type: 'primary', action: `(async () => { await app.saveSolutionEdit(${solutionId}, ${entityId}, ${isProspect}); })()` }
    ]);
};

const saveSolutionEdit = async (solutionId, entityId, isProspect = true) => {
    const solution    = document.getElementById('edit-solution-name')?.value;
    const status      = document.getElementById('edit-solution-status')?.value;
    const followUpDate = document.getElementById('edit-solution-followup-date')?.value || null;
    const notes       = document.getElementById('edit-solution-notes')?.value;

    await AppDataStore.update('proposed_solutions', solutionId, {
        solution,
        status,
        next_follow_up_date: followUpDate,
        notes: notes || null,
        // Clear escalation if agent explicitly marks as something other than Proposed
        ...(status !== 'Proposed' ? { escalated_at: null, escalation_notes: null } : {}),
        updated_at: new Date().toISOString()
    });

    UI.hideModal();
    if (isProspect) await app.showProspectDetail(entityId);
    else await app.showCustomerDetail(entityId);
    await (window.app.renderPendingSolutionsWidget || (() => {}))();
    UI.toast.success('Solution updated');
};

const deleteSolution = async (solutionId, entityId, isProspect = true) => {
    if (!confirm('Delete this proposed solution?')) return;
    await AppDataStore.delete('proposed_solutions', solutionId);
    UI.hideModal();
    if (isProspect) await app.showProspectDetail(entityId);
    else await app.showCustomerDetail(entityId);
    await (window.app.renderPendingSolutionsWidget || (() => {}))();
    UI.toast.success('Solution removed');
};

// Name List Functions
const confirmConvertToCustomer = async (prospectId, isManual = false) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;

    const amount = isManual
        ? parseFloat(document.getElementById('manual-conversion-amount')?.value) || 0
        : parseFloat(document.getElementById('conversion-amount')?.value) || 0;

    const date = isManual
        ? document.getElementById('manual-customer-since')?.value
        : document.getElementById('customer-since')?.value;

    const customer = {
        id: Date.now(),
        full_name: prospect.full_name,
        nickname: prospect.nickname || '',
        phone: prospect.phone,
        email: prospect.email,
        ic_number: prospect.ic_number,
        date_of_birth: prospect.date_of_birth,
        lunar_birth: prospect.lunar_birth,
        ming_gua: prospect.ming_gua,
        occupation: prospect.occupation,
        company_name: prospect.company_name,
        income_range: prospect.income_range,
        address: prospect.address,
        city: prospect.city,
        state: prospect.state,
        postal_code: prospect.postal_code,
        lifetime_value: amount,
        status: 'active',
        customer_since: date || new Date().toISOString().split('T')[0],
        responsible_agent_id: prospect.responsible_agent_id || 5,
        converted_from_prospect_id: prospectId,
        referred_by: prospect.referred_by,
        referred_by_id: prospect.referred_by_id,
        referred_by_type: prospect.referred_by_type,
        referral_relationship: prospect.referral_relationship
    };

    const newCustomer = await AppDataStore.create('customers', customer);
    await AppDataStore.update('prospects', prospectId, { status: 'converted' });

    // Phase X: Create purchase record for conversion amount
    // BUG FIX 2026-04-11: removed stray double `await`
    if (amount > 0) {
        await AppDataStore.create('purchases', {
            customer_id: newCustomer.id,
            date: customer.customer_since,
            item: 'Conversion Package / First Deal',
            amount: amount,
            status: 'PAID',
            invoice: `INV - ${new Date().getFullYear()} -${Math.floor(1000 + Math.random() * 9000)} `,
            notes: 'Created during prospect conversion'
        });
    }

    UI.hideModal();
    UI.toast.success('Converted to customer successfully!');

    const content = document.getElementById('main-content');
    if (content) await (window.app.showProspectsViewSmart || (() => {}))(content);
};

const extendProtection = async (prospectId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;
    const currentDeadline = new Date(prospect.protection_deadline || Date.now());
    const newDeadline = new Date(currentDeadline.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    await AppDataStore.update('prospects', prospectId, { protection_deadline: newDeadline });
    UI.toast.success('Protection extended by 30 days');
    await app.showProspectDetail(prospectId);
};

const transferProspect = (prospectId) => {
    UI.toast.info('Transfer workflow: Select target agent to initiate transfer request.');
};

const reassignProspect = (prospectId) => {
    UI.toast.info('Reassign workflow: Administrator override required.');
};


const openReviveProspectModal = async (prospectId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;
    UI.showModal('Revive Prospect Profile', `
        <div style="margin-bottom:12px;padding:12px;background:#f1f5f9;border-radius:8px;border-left:4px solid #94a3b8;">
            <div style="font-weight:600;color:#475569;font-size:13px;margin-bottom:4px;">Current reason (Unable to Serve):</div>
            <div style="color:#64748b;font-size:13px;">${escapeHtml(prospect.unable_reason || '—')}</div>
        </div>
        <div class="form-group">
            <label style="font-weight:600;">Revive Notes <span style="color:#9CA3AF;font-weight:400;">(why are you re-activating this profile?)</span></label>
            <textarea id="revive-notes-input" class="form-control" rows="3" placeholder="e.g. Reconnected after 6 months, prospect now interested again..."></textarea>
        </div>
    `, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: '🔄 Confirm Revive', type: 'primary', action: `(async () => { await app.saveReviveProspect(${prospectId}); })()` }
    ]);
};

const saveReviveProspect = async (prospectId) => {
    const notes = document.getElementById('revive-notes-input')?.value?.trim() || '';
    await AppDataStore.update('prospects', prospectId, {
        unable_to_serve: false,
        unable_reason: null,
        revived_at: new Date().toISOString(),
        revive_notes: notes || null,
        updated_at: new Date().toISOString()
    });
    UI.hideModal();
    UI.toast.success('Profile revived — prospect is now active again.');
    await showProspectDetail(prospectId);
};

const convertToCustomer = async (prospectId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;
    if (prospect.status === 'converted') return UI.toast.info('This prospect has already been converted to a customer.');
    if (prospect.conversion_status === 'pending_approval') return UI.toast.info('Conversion is already pending manager approval.');

    const isManager = isSystemAdmin(_currentUser) || isMarketingManager(_currentUser);

    if (isManager) {
        await showConversionApprovalModal(prospectId);
    } else {
        const saleAmount = parseFloat(prospect.closing_record?.sale_amount) || 0;
        UI.showModal('Request Conversion to Customer', `
            <div style="display:flex; flex-direction:column; gap:12px;">
                <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:12px; font-size:13px; color:#1e40af;">
                    <i class="fas fa-info-circle" style="margin-right:6px;"></i>
                    Your request will be reviewed by a manager before the customer profile is created.
                </div>
                <div style="font-size:13px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                    <div><span style="color:var(--gray-500);">Prospect:</span> <strong>${prospect.full_name}</strong></div>
                    <div><span style="color:var(--gray-500);">Phone:</span> ${prospect.phone}</div>
                    ${saleAmount > 0 ? `<div><span style="color:var(--gray-500);">Sale Amount:</span> <strong>RM ${saleAmount.toLocaleString()}</strong></div>` : ''}
                    <div><span style="color:var(--gray-500);">Referrer:</span> ${prospect.referred_by || '-'}</div>
                </div>
            </div>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: '<i class="fas fa-paper-plane"></i> Submit for Approval', type: 'primary', action: `(async () => { await app.requestProspectConversion(${prospectId}); })()` }
        ]);
    }
};

const requestProspectConversion = async (prospectId) => {
    await AppDataStore.update('prospects', prospectId, {
        conversion_status: 'pending_approval',
        conversion_requested_at: new Date().toISOString(),
        conversion_requested_by: _currentUser?.id
    });

    // Create approval queue entry for new customer conversion
    try {
        const prospect = await AppDataStore.getById('prospects', prospectId);
        await AppDataStore.create('approval_queue', {
            id: Date.now(),
            approval_type: 'new_customer',
            status: 'pending',
            prospect_id: prospectId,
            customer_id: null,
            submitted_by: _currentUser?.id,
            submitted_at: new Date().toISOString(),
            snapshot_before: null,
            snapshot_after: prospect,
            description: `New customer conversion for ${prospect?.full_name || 'prospect'}`
        });
    } catch (e) { /* approval queue write failed silently */ }

    UI.hideModal();
    UI.toast.success('Conversion request submitted. A manager will review and approve shortly.');
    await renderProspectsTable();
};

const showConversionApprovalModal = async (prospectId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;
    const cr = prospect.closing_record;
    const saleAmount = parseFloat(cr?.sale_amount) || 0;
    const requestedBy = prospect.conversion_requested_by
        ? await (window.app.getAgentName || (() => Promise.resolve('')))(prospect.conversion_requested_by)
        : 'Agent';

    UI.showModal('Review & Approve Conversion', `
        <div style="display:flex; flex-direction:column; gap:14px;">
            <div style="background:#fef3c7; border:1px solid #fcd34d; border-radius:8px; padding:12px; font-size:13px; color:#92400e;">
                <i class="fas fa-user-clock" style="margin-right:6px;"></i>
                Conversion requested by <strong>${requestedBy}</strong>. Review all data before approving.
            </div>
            <div style="font-size:13px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                <div><span style="color:var(--gray-500);">Name:</span> <strong>${prospect.full_name}</strong></div>
                <div><span style="color:var(--gray-500);">Phone:</span> ${prospect.phone}</div>
                <div><span style="color:var(--gray-500);">IC:</span> ${prospect.ic_number || '-'}</div>
                <div><span style="color:var(--gray-500);">DOB:</span> ${prospect.date_of_birth || '-'}</div>
                <div><span style="color:var(--gray-500);">Occupation:</span> ${prospect.occupation || '-'}</div>
                <div><span style="color:var(--gray-500);">Ming Gua:</span> ${prospect.ming_gua || '-'}</div>
                <div><span style="color:var(--gray-500);">Referrer:</span> ${prospect.referred_by || '-'}</div>
                <div><span style="color:var(--gray-500);">Relation:</span> ${prospect.referral_relationship || '-'}</div>
            </div>
            ${cr ? `
                <div style="border-top:1px solid var(--gray-200); padding-top:12px;">
                    <div style="font-weight:600; margin-bottom:8px; font-size:13px;">Sales Record</div>
                    <div style="font-size:13px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <div><span style="color:var(--gray-500);">Product:</span> ${cr.product || '-'}</div>
                        <div><span style="color:var(--gray-500);">Amount:</span> <strong style="color:#166534;">RM ${saleAmount.toLocaleString()}</strong></div>
                        <div><span style="color:var(--gray-500);">Invoice:</span> ${cr.invoice_number || '-'}</div>
                        <div><span style="color:var(--gray-500);">Date:</span> ${cr.closing_date || '-'}</div>
                    </div>
                </div>
            ` : '<div style="color:var(--gray-400); font-size:13px; font-style:italic;">No closing record submitted yet.</div>'}
            <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:12px; font-size:13px; color:#166534;">
                <i class="fas fa-copy" style="margin-right:6px;"></i>
                Approving will <strong>copy all prospect data</strong> into a permanent Customer profile. The prospect will be marked Converted.
            </div>
        </div>
    `, [
        { label: 'Reject', type: 'secondary', action: `(async () => { await app.rejectProspectConversion(${prospectId}); })()` },
        { label: '<i class="fas fa-user-check"></i> Approve Conversion', type: 'primary', action: `(async () => { await app.approveProspectConversion(${prospectId}); })()` }
    ]);
};

const approveProspectConversion = async (prospectId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;
    const cr = prospect.closing_record;
    const saleAmount = parseFloat(cr?.sale_amount) || 0;
    const now = new Date().toISOString();

    // Full data copy — every field from prospect goes to customer
    const customer = {
        id: Date.now(),
        title: prospect.title || '',
        full_name: prospect.full_name,
        nickname: prospect.nickname || '',
        gender: prospect.gender || '',
        nationality: prospect.nationality || '',
        phone: prospect.phone,
        email: prospect.email || '',
        ic_number: prospect.ic_number || '',
        date_of_birth: prospect.date_of_birth || '',
        lunar_birth: prospect.lunar_birth || '',
        ming_gua: prospect.ming_gua || '',
        occupation: prospect.occupation || '',
        company_name: prospect.company_name || '',
        income_range: prospect.income_range || '',
        address: prospect.address || '',
        city: prospect.city || '',
        state: prospect.state || '',
        postal_code: prospect.postal_code || '',
        referred_by: prospect.referred_by || '',
        referred_by_id: prospect.referred_by_id || null,
        referred_by_type: prospect.referred_by_type || '',
        referral_relationship: prospect.referral_relationship || '',
        responsible_agent_id: prospect.responsible_agent_id || null,
        lifetime_value: saleAmount,
        status: 'active',
        customer_since: cr?.closing_date || now.split('T')[0],
        converted_from_prospect_id: prospectId,
        approved_by: _currentUser?.id,
        approved_at: now,
        created_at: now
    };

    await AppDataStore.create('customers', customer);

    const updatedFields = {
        status: 'converted',
        conversion_status: 'approved',
        conversion_approved_at: now,
        conversion_approved_by: _currentUser?.id
    };
    // Archive closing record to history and reset so a new closing can be started
    if (cr) {
        const existingHistory = Array.isArray(prospect.closing_records_history) ? prospect.closing_records_history : [];
        updatedFields.closing_records_history = [...existingHistory, { ...cr, status: 'approved', approved_at: now }];
        updatedFields.closing_record = null;
    }
    await AppDataStore.update('prospects', prospectId, updatedFields);
    _purchasesHistoryCache = null;

    // Sync approval queue — mark matching new_customer entry as approved
    try {
        const allQueue = await AppDataStore.getAll('approval_queue');
        const matchingEntry = allQueue.find(e => e.prospect_id == prospectId && e.approval_type === 'new_customer' && e.status === 'pending');
        if (matchingEntry) {
            await AppDataStore.update('approval_queue', matchingEntry.id, {
                status: 'approved',
                reviewed_by: _currentUser?.id,
                reviewed_at: now
            });
        }
    } catch (e) { /* queue sync failed silently */ }

    UI.hideModal();
    UI.toast.success(`${prospect.full_name} is now a Customer!`);
    const viewport = document.getElementById('content-viewport');
    if (viewport && _state.cv === 'prospects') await (window.app.showProspectsViewSmart || (() => {}))(viewport);
};

const rejectProspectConversion = async (prospectId) => {
    const now = new Date().toISOString();
    await AppDataStore.update('prospects', prospectId, {
        conversion_status: 'rejected',
        conversion_rejected_at: now,
        conversion_rejected_by: _currentUser?.id
    });

    // Sync approval queue — mark matching new_customer entry as rejected
    try {
        const allQueue = await AppDataStore.getAll('approval_queue');
        const matchingEntry = allQueue.find(e => e.prospect_id == prospectId && e.approval_type === 'new_customer' && e.status === 'pending');
        if (matchingEntry) {
            await AppDataStore.update('approval_queue', matchingEntry.id, {
                status: 'rejected',
                reviewed_by: _currentUser?.id,
                reviewed_at: now
            });
        }
    } catch (e) { /* queue sync failed silently */ }

    UI.hideModal();
    UI.toast.info('Conversion rejected. Agent can resubmit after reviewing.');
    await renderProspectsTable();
};

const showAgentsView = async (container) => {

    container.innerHTML = `
<div class="agents-view">
            <div class="agents-header">
                <div>
                    <h1>Agent Management</h1>
                    <p>Monitor agent performance, licenses, and assignments.</p>
                </div>
                <div class="header-actions">
                    <button class="btn primary" onclick="app.openAddAgentModal()">
                        <i class="fas fa-plus"></i> Add Agent
                    </button>
                </div>
            </div>

            <div class="agent-filters">
                <div class="search-group" style="flex:1; min-width:200px; display:flex; align-items:center; gap:8px; background:var(--gray-50); padding:8px 12px; border-radius:6px; border:1px solid var(--gray-200);">
                    <i class="fas fa-search" style="color:var(--gray-400);"></i>
                    <input type="text" id="agent-search" placeholder="Search agents by name, code, or phone" oninput="app.debounceCall('agent-search', app.filterAgents, 220)" style="border:none; background:transparent; outline:none; width:100%;">
                </div>
                <label for="filter-agent-team" class="sr-only">Filter by team</label>
                <select id="filter-agent-team" aria-label="Filter by team" onchange="app.filterAgents()" class="form-control" style="width:140px;">
                    <option value="">All Teams</option>
                    ${Array.from({length: 26}, (_, i) => String.fromCharCode(65 + i)).map(L => `<option value="Team ${L}">Team ${L}</option>`).join('')}
                </select>
                <label for="filter-agent-role" class="sr-only">Filter by role</label>
                <select id="filter-agent-role" aria-label="Filter by role" onchange="app.filterAgents()" class="form-control" style="width:160px;">
                    <option value="">All Roles</option>
                    ${USER_ROLES.map(r => `<option value="${r}">${r}</option>`).join('')}
                </select>
                <label for="filter-agent-status" class="sr-only">Filter by status</label>
                <select id="filter-agent-status" aria-label="Filter by status" onchange="app.filterAgents()" class="form-control" style="width:140px;">
                    <option value="">All Status</option>
                    <option value="active">Active</option>
                    <option value="probation">Probation</option>
                    <option value="inactive">Inactive</option>
                    <option value="expired">License Expired</option>
                </select>
            </div>

            <div class="agents-table-container">
                <table class="agents-table">
                    <thead>
                        <tr>
                            <th scope="col">Name / Agent ID</th>
                            <th scope="col">Team</th>
                            <th scope="col">Status</th>
                            <th scope="col">License Expiry</th>
                            <th scope="col">Assigned Prospects</th>
                            <th scope="col">Customers</th>
                            <th scope="col">Follow-up Rate</th>
                            <th scope="col">Actions</th>
                        </tr>
                    </thead>
                    <tbody id="agents-table-body">
                        ${Array(8).fill(0).map(() => `<tr>${Array(8).fill(0).map((_, i) => `<td style="padding:10px 12px;"><div class="skeleton" style="height:14px;border-radius:4px;width:${[75,45,50,60,40,35,45,30][i]}%;"></div></td>`).join('')}</tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </div>
`;
    await renderAgentsTable();
};

const renderAgentsTable = async () => {
    const tbody = document.getElementById('agents-table-body');
    if (!tbody) {
        console.error('agents-table-body not found');
        return;
    }

    const allAgents = (await AppDataStore.getAll('users')).filter(u => isAgent(u) || u.agent_code);
    const visibleIds = await getVisibleUserIds(_currentUser);
    const agents = visibleIds === 'all' ? allAgents : allAgents.filter(a => visibleIds.map(String).includes(String(a.id)));
    const searchQuery = document.getElementById('agent-search')?.value.toLowerCase() || '';
    const teamFilter = document.getElementById('filter-agent-team')?.value || '';
    const roleFilter = document.getElementById('filter-agent-role')?.value || '';
    const statusFilter = document.getElementById('filter-agent-status')?.value || '';

    const curLvlMatch = _currentUser?.role?.match(/Level\s+(\d+)/i);
    const canAssignUpline = curLvlMatch ? parseInt(curLvlMatch[1]) <= 4 : false;

    // Pre-fetch prospects, customers AND agent_stats once, then look up per agent.
    // Previously this loop fired one Supabase query per agent for agent_stats
    // — N+1 round trips that dominated render time on the Agents page.
    // getAll() hits the in-memory + SWR cache, so this is one shared fetch
    // for the whole page instead of one network call per row.
    const [allProspects, allCustomers, allAgentStats] = await Promise.all([
        AppDataStore.getAll('prospects'),
        AppDataStore.getAll('customers'),
        AppDataStore.getAll('agent_stats')
    ]);
    const prospectCountMap = {};
    const customerCountMap = {};
    for (const p of allProspects) {
        const aid = String(p.responsible_agent_id);
        prospectCountMap[aid] = (prospectCountMap[aid] || 0) + 1;
    }
    for (const c of allCustomers) {
        const aid = String(c.responsible_agent_id || c.agent_id);
        if (aid) customerCountMap[aid] = (customerCountMap[aid] || 0) + 1;
    }
    const statsByAgentId = new Map();
    for (const s of allAgentStats) {
        statsByAgentId.set(String(s.agent_id), s);
    }

    let html = '';
    for (const agent of agents) {
        if (searchQuery && !agent.full_name?.toLowerCase().includes(searchQuery) && !agent.agent_code?.toLowerCase().includes(searchQuery) && !agent.phone?.toLowerCase().includes(searchQuery)) continue;
        if (teamFilter && agent.team !== teamFilter) continue;
        if (roleFilter && agent.role !== roleFilter) continue;
        if (statusFilter && agent.status !== statusFilter) continue;

        const prospectCount = prospectCountMap[String(agent.id)] || 0;
        const customerCount = customerCountMap[String(agent.id)] || 0;
        const stats = statsByAgentId.get(String(agent.id)) || { followup_rate: 0 };
        const rateClass = stats.followup_rate >= 90 ? 'rate-good' : (stats.followup_rate >= 70 ? 'rate-warning' : 'rate-critical');
        const status = agent.status || 'active';

        // escapeHtml is synchronous — `await` here just yields a microtask
        // per call, ~6 yields per row times N agents = hundreds of needless
        // event-loop ticks during render.
        html += `
            <tr data-agent-id="${agent.id}" class="agent-row">
                <td data-label="Name">
                    <div style="font-weight:600;">${escapeHtml(agent.full_name)}</div>
                    <div style="font-size:12px; color:var(--gray-500);">${escapeHtml(agent.agent_code) || 'N/A'}</div>
                </td>
                <td data-label="Team">${escapeHtml(agent.team) || 'Unassigned'}</td>
                <td data-label="Status"><span class="status-badge status-${status}">${status.toUpperCase()}</span></td>
                <td data-label="License Expiry">${escapeHtml(agent.license_expiry) || 'N/A'}</td>
                <td data-label="Prospects">${prospectCount} prospects</td>
                <td data-label="Customers">${customerCount} customers</td>
                <td data-label="Follow-up">
                    <div class="followup-rate">
                        <span class="rate-indicator ${rateClass}"></span>
                        <span>${stats.followup_rate ?? 0}%</span>
                    </div>
                </td>
                <td onclick="event.stopPropagation()">
                    <button class="btn-icon view-detail-btn" onclick="event.stopPropagation(); app.showAgentProfile('${agent.id}')" title="View Detail"><i class="fas fa-eye"></i></button>
                    <button class="btn-icon edit-agent-btn" onclick="event.stopPropagation(); app.openEditAgentModal('${agent.id}')" title="Edit Agent"><i class="fas fa-edit"></i></button>
                    ${canAssignUpline ? `<button class="btn-icon" onclick="event.stopPropagation(); app.openAssignUplineModal('${agent.id}')" title="Assign Upline"><i class="fas fa-sitemap"></i></button>` : ''}
                    ${canAssignUpline ? `<button class="btn-icon" onclick="event.stopPropagation(); app.openResetPasswordModal('${agent.id}')" title="Reset Password"><i class="fas fa-key"></i></button>` : ''}
                    ${canAssignUpline ? `<button class="btn-icon" onclick="event.stopPropagation(); app.deleteAgent('${agent.id}')" title="Delete Agent" style="color:var(--error);"><i class="fas fa-trash"></i></button>` : ''}
                </td>
            </tr>
        `;
    }

    tbody.innerHTML = '';
    tbody.insertAdjacentHTML('beforeend', html || '<tr><td colspan="8" style="text-align:center; padding:20px;">No agents found</td></tr>');
};

const showAgentProfile = async (agentId) => {
const agent = await AppDataStore.getById('users', agentId);
if (!agent) {
    UI.toast.error('Agent not found');
    return;
}

const lvlMatch = _currentUser?.role?.match(/Level\s+(\d+)/i);
const isAdminOrLead = lvlMatch ? parseInt(lvlMatch[1]) <= 4 : false;

// Resolve reporting_to name dynamically
const allUsers = await AppDataStore.getAll('users');
const reportingToUser = agent.reporting_to ? allUsers.find(u => u.id == agent.reporting_to) : null;
const reportingToName = reportingToUser ? reportingToUser.full_name : '—';
const calculateDaysDiff = (expiryDate) => {
    if (!expiryDate) return 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const datePart = String(expiryDate).slice(0, 10);
    const expiry = new Date(datePart + 'T00:00:00');
    if (isNaN(expiry.getTime())) return 0;
    const diff = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 0;
};

const renderFollowupStats = async (agentId) => {
    // Your existing implementation – ensure it returns a string
    return `<div class="stat-row"><span>Follow-up rate: 85%</span></div>`;
};
const renderCurrentAssignments = async (agentId) => {
    // fresh:true bypasses SWR cache so stale localStorage data never hides prospects
    const allP = await AppDataStore.getAll('prospects', { fresh: true });
    const agentProspects = allP.filter(p => String(p.responsible_agent_id) === String(agentId));
    if (agentProspects.length === 0) return '<p style="color:var(--gray-400);font-size:13px;">No prospects assigned.</p>';
    agentProspects.sort((a, b) => (b.last_activity_date || '').localeCompare(a.last_activity_date || ''));
    return `
        <div class="assignments-list">
            ${agentProspects.map(p => `
                <div class="assignment-item" onclick="app.showProspectDetail(${p.id})" style="cursor:pointer;">
                    <div>
                        <div class="assignment-prospect">${escapeHtml(p.full_name || '(No Name)')}</div>
                        <div class="next-action" style="font-size:12px;color:var(--gray-500);">
                            ${p.last_activity_date ? 'Last: ' + p.last_activity_date : 'No activity yet'}
                        </div>
                    </div>
                    <span class="assignment-status status-${(p.status || 'prospect').toLowerCase()}">${p.status || 'Prospect'}</span>
                </div>
            `).join('')}
        </div>
        <p style="font-size:12px;color:var(--gray-400);margin-top:8px;">${agentProspects.length} prospect${agentProspects.length !== 1 ? 's' : ''} total</p>
    `;
};
const renderPerformanceTargets = async (agentId) => {
    return `<div>Monthly target: RM 50,000</div>`;
};
const renderCustomerHistory = async (agentId) => {
    return `<div>12 customers converted</div>`;
};

const viewport = document.getElementById('content-viewport');
viewport.innerHTML = `
<div class="agent-profile-view">
    <div class="header-actions" style="margin-bottom:16px;">
        <button class="btn secondary" onclick="app.navigateTo('agents')"><i class="fas fa-arrow-left"></i> Back to Agents</button>
    </div>

    <div class="profile-header" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px;">
        <div>
            <div style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
                <h1 style="font-size:32px; font-weight:700;">${escapeHtml(agent.full_name)}</h1>
                <span class="status-badge status-${agent.status}">${agent.status?.toUpperCase() || 'ACTIVE'}</span>
            </div>
            <div style="display:flex; gap:12px; color:var(--gray-500); font-size:14px;">
                <span>Agent ID: ${agent.agent_code || '—'}</span>
                <span><i class="fas fa-user-tie"></i> ${agent.role || 'Consultant'}</span>
                <span><i class="fas fa-users"></i> ${agent.team || 'Sales'}</span>
            </div>
        </div>
        <div class="header-actions">
            <button class="btn secondary" onclick="app.resetAgentPassword(${agentId})">Reset Password</button>
            <button class="btn secondary" onclick="app.openAddAgentModal(${agentId})">Edit Profile</button>
            <button class="btn error" onclick="app.deactivateAgent(${agentId})">Deactivate</button>
        </div>
    </div>

    ${agent.id === 9 || agent.username === 'ong.beeling' ? `
    <div class="conversion-banner">
        <i class="fas fa-award"></i>
        <span>Converted from Customer on 05 Mar 2026 via <strong>Premium Package (RM 5,500)</strong></span>
    </div>
    ` : ''}

    ${isAdminOrLead ? `
    <div class="license-dashboard">
        <h3><i class="fas fa-id-card"></i> License Renewal Dashboard</h3>
        <div class="license-stats">
            <div class="license-stat">
                <span class="license-stat-label">License Expiry</span>
                <span class="license-stat-value">${agent.license_expiry || '2026-12-31'}</span>
            </div>
            <div class="license-stat">
                <span class="license-stat-label">Days Remaining</span>
                <span class="license-stat-value" style="color:${calculateDaysDiff(agent.license_expiry || '2026-12-31') < 30 ? '#ef4444' : '#0369a1'}">${calculateDaysDiff(agent.license_expiry || '2026-12-31')} Days</span>
            </div>
            <div class="license-stat">
                <span class="license-stat-label">Renewal Status</span>
                <span class="license-stat-value">${agent.renewal_status || 'ELIGIBLE'}</span>
            </div>
        </div>
        <div class="license-actions">
            <button class="btn primary" onclick="app.renewLicense(${agent.id})" ${calculateDaysDiff(agent.license_expiry || '2026-12-31') > 60 ? 'disabled' : ''}>Renew Now</button>
            <button class="btn secondary" onclick="app.sendRenewalReminder(${agent.id})">Send Reminder</button>
        </div>
    </div>
    ` : ''}

    <div class="performance-grid">
        <div class="performance-card">
            <h4><i class="fas fa-info-circle"></i> Agent Information</h4>
            <div class="performance-stats">
                <div class="stat-row">
                    <span class="stat-label">Phone:</span>
                    <span class="stat-value">${agent.phone || '012-1234567'}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Email:</span>
                    <span class="stat-value">${agent.email || 'agent@fengshui.com'}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Join Date:</span>
                    <span class="stat-value">${agent.join_date || '2026-01-01'}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Comm. Rate:</span>
                    <span class="stat-value">${(agent.commission_rate != null && !isNaN(parseFloat(agent.commission_rate))) ? parseFloat(agent.commission_rate) + '%' : '—'}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Reporting To:</span>
                    <span class="stat-value">${escapeHtml(reportingToName)}</span>
                </div>
            </div>
        </div>

        <div class="performance-card">
            <h4><i class="fas fa-chart-line"></i> Follow-up Performance</h4>
            ${await renderFollowupStats(agent.id)}
        </div>
    </div>

    <div class="performance-grid">
        <div class="performance-card">
            <h4><i class="fas fa-list-check"></i> Current Assignments</h4>
            ${await renderCurrentAssignments(agent.id)}
        </div>
        <div class="performance-card">
            <h4><i class="fas fa-bullseye"></i> Performance Targets (March)</h4>
            ${await renderPerformanceTargets(agent.id)}
        </div>
    </div>

    <div class="performance-grid">
        <div class="performance-card">
            <h4><i class="fas fa-history"></i> Customer History</h4>
            ${await renderCustomerHistory(agent.id)}
        </div>
        <div class="performance-card">
            <h4><i class="fas fa-clock-rotate-left"></i> Agent Activity History</h4>
            <div class="performance-stats">
                <div class="stat-row">
                    <span class="stat-label">05 Mar 10:00:</span>
                    <span>Login via Web Portal</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">04 Mar 16:30:</span>
                    <span>Commission rate updated to 30%</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">04 Mar 15:45:</span>
                    <span>Renewed license for 2026</span>
                </div>
            </div>
        </div>
    </div>

    <!-- Agent Notes Card -->
    <div class="performance-grid">
        <div class="performance-card">
            <h4><i class="fas fa-sticky-note"></i> Agent Notes</h4>
            <div class="add-note-section">
                <textarea id="agent-note-text-${agent.id}" class="form-control" rows="3" placeholder="Add note about agent performance..."></textarea>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
                    <button class="btn-icon" onclick="app.openVoiceRecorder('agent-note-text-${agent.id}', 'agent', ${agent.id})" title="Record voice note" style="color:var(--primary);"><i class="fas fa-microphone"></i></button>
                    <button class="btn primary btn-sm" onclick="app.addAgentNote(${agent.id})">Add Note</button>
                </div>
            </div>
            <div id="agent-notes-list-${agent.id}" style="margin-top:12px;"></div>
        </div>
    </div>
</div>
`;  // <-- THIS CLOSES THE OUTER TEMPLATE LITERAL

// Populate agent notes after the DOM is ready
setTimeout(async () => {
    const agentNotes = await AppDataStore.query('notes', { agent_id: agent.id });
    const notesHtml = agentNotes.length 
        ? agentNotes.map(n => `
            <div class="notes-item" style="margin-top:8px;">
                <div class="notes-header">
                    <span>${escapeHtml(n.date)} - ${escapeHtml(n.author)}${n.is_voice_note ? ' <i class="fas fa-microphone voice-note-icon" title="Voice note"></i>' : ''}</span>
                    <button class="btn-icon" onclick="app.deleteAgentNote(${agent.id}, ${n.id})"><i class="fas fa-trash"></i></button>
                </div>
                <div>"${escapeHtml(n.text)}"</div>
            </div>
        `).join('')
        : '<p style="color:var(--gray-400); font-size:13px;">No notes yet.</p>';
    const notesContainer = document.getElementById(`agent-notes-list-${agent.id}`);
    if (notesContainer) notesContainer.innerHTML = notesHtml;
}, 100);
};

const showAgentDetail = showAgentProfile;

  /*  const filterAgents = async () => await renderAgentsTable();

const showAgentDetail = async (agentId) => {
    const agent = await AppDataStore.getById('users', agentId);
    if (!agent) return;

    // --- NEW: define isAdminOrLead ---
    const currentUser = _currentUser || await Auth.getCurrentUser();
    const isAdminOrLead = isSystemAdmin(currentUser) || isMarketingManager(currentUser) || 
                          currentUser?.role?.includes('Level 3') || 
                          currentUser?.role?.includes('Level 7') || 
                          currentUser?.role === 'team_leader';
    const isSelf = agent.id == currentUser?.id;
    if (!isAdminOrLead && !isSelf) {
        UI.toast.error('You do not have permission to view this agent profile');
        return;
    }

    const viewport = document.getElementById('content-viewport');
    viewport.innerHTML = `
<div class="agent-profile-view">
            <div class="header-actions" style="margin-bottom:16px;">
                <button class="btn secondary" onclick="app.navigateTo('agents')"><i class="fas fa-arrow-left"></i> Back to Agents</button>
            </div>

            <div class="profile-header" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px;">
                <div>
                    <div style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
                        <h1 style="font-size:32px; font-weight:700;">${agent.full_name}</h1>
                        <span class="status-badge status-${agent.status}">${agent.status.toUpperCase()}</span>
                    </div>
                    <div style="display:flex; gap:12px; color:var(--gray-500); font-size:14px;">
                        <span>Agent ID: ${agent.agent_code || '—'}</span>
                        <span><i class="fas fa-user-tie"></i> Senior Consultant</span>
                        <span><i class="fas fa-users"></i> ${agent.team}</span>
                    </div>
                </div>
                <div class="header-actions">
                    <button class="btn secondary" onclick="app.resetAgentPassword(${agentId})">Reset Password</button>
                    <button class="btn secondary" onclick="app.openAddAgentModal(${agentId})">Edit Profile</button>
                    <button class="btn error" onclick="app.deactivateAgent(${agentId})">Deactivate</button>
                </div>
            </div>

            ${agent.id === 9 || agent.username === 'ong.beeling' ? `
            <div class="conversion-banner">
                <i class="fas fa-award"></i>
                <span>Converted from Customer on 05 Mar 2026 via <strong>Premium Package (RM 5,500)</strong></span>
            </div>
            ` : ''
        }

            ${isAdminOrLead ? `
            <div class="license-dashboard">
                <h3><i class="fas fa-id-card"></i> License Renewal Dashboard</h3>
                <div class="license-stats">
                    <div class="license-stat">
                        <span class="license-stat-label">License Expiry</span>
                        <span class="license-stat-value">${agent.license_expiry || '—'}</span>
                    </div>
                    <div class="license-stat">
                        <span class="license-stat-label">Days Remaining</span>
                        <span class="license-stat-value" style="color:${calculateDaysDiff(agent.license_expiry || '2026-12-31') < 30 ? '#ef4444' : '#0369a1'}">${calculateDaysDiff(agent.license_expiry || '2026-12-31')} Days</span>
                    </div>
                    <div class="license-stat">
                        <span class="license-stat-label">Renewal Status</span>
                        <span class="license-stat-value">${agent.renewal_status || 'ELIGIBLE'}</span>
                    </div>
                </div>
                <div class="license-actions">
                    <button class="btn primary" onclick="app.renewLicense(${agent.id})" ${calculateDaysDiff(agent.license_expiry || '2026-12-31') > 60 ? 'disabled' : ''}>Renew Now</button>
                    <button class="btn secondary" onclick="app.sendRenewalReminder(${agent.id})">Send Reminder</button>
                </div>
            </div>
            ` : ''
        }

            <div class="performance-grid">
                <div class="performance-card">
                    <h4><i class="fas fa-info-circle"></i> Agent Information</h4>
                    <div class="performance-stats">
                        <div class="stat-row">
                            <span class="stat-label">Phone:</span>
                            <span class="stat-value">${agent.phone || '012-1234567'}</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Email:</span>
                            <span class="stat-value">${agent.email || 'agent@fengshui.com'}</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Join Date:</span>
                            <span class="stat-value">${agent.join_date || '2026-01-01'}</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Comm. Rate:</span>
                            <span class="stat-value">${(agent.commission_rate != null && !isNaN(parseFloat(agent.commission_rate))) ? parseFloat(agent.commission_rate) + '%' : '—'}</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Reporting To:</span>
                            <span class="stat-value">Michelle Tan</span>
                        </div>
                    </div>
                </div>

                <div class="performance-card">
                    <h4><i class="fas fa-chart-line"></i> Follow-up Performance</h4>
                    ${await renderFollowupStats(agent.id)}
                </div>
            </div>

            <div class="performance-grid">
               <div class="performance-card">
                    <h4><i class="fas fa-list-check"></i> Current Assignments</h4>
                    ${await renderCurrentAssignments(agent.id)}
                </div>
                <div class="performance-card">
                    <h4><i class="fas fa-bullseye"></i> Performance Targets (March)</h4>
                    ${await renderPerformanceTargets(agent.id)}
                </div>
            </div>

            <div class="performance-grid">
                <div class="performance-card">
                    <h4><i class="fas fa-history"></i> Customer History</h4>
                    ${await renderCustomerHistory(agent.id)}
                </div>
                <div class="performance-card">
                    <h4><i class="fas fa-clock-rotate-left"></i> Agent Activity History</h4>
                    <div class="performance-stats">
                        <div class="stat-row">
                            <span class="stat-label">05 Mar 10:00:</span>
                            <span>Login via Web Portal</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">04 Mar 16:30:</span>
                            <span>Commission rate updated to 30%</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">04 Mar 15:45:</span>
                            <span>Renewed license for 2026</span>
                        </div>
                    </div>
                </div>



const html = `
<div class="performance-card">
<h4><i class="fas fa-sticky-note"></i> Agent Notes</h4>
<div class="add-note-section">
    <textarea id="agent-note-text-${agent.id}" class="form-control" rows="3" placeholder="Add note about agent performance..."></textarea>
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
        <button class="btn-icon" onclick="app.openVoiceRecorder('agent-note-text-${agent.id}', 'agent', ${agent.id})" title="Record voice note" style="color:var(--primary);"><i class="fas fa-microphone"></i></button>
        <button class="btn primary btn-sm" onclick="app.addAgentNote(${agent.id})">Add Note</button>
    </div>
</div>
<div id="agent-notes-list-${agent.id}" style="margin-top:12px;"></div>
</div>
`;



// Populate agent notes after the DOM is ready
 setTimeout(async () => {
const agentNotes = await AppDataStore.query('notes', { agent_id: agent.id });
const notesHtml = agentNotes.length 
    ? agentNotes.map(n => `
        <div class="notes-item" style="margin-top:8px;">
            <div class="notes-header">
                <span>${n.date} - ${n.author}${n.is_voice_note ? ' <i class="fas fa-microphone voice-note-icon" title="Voice note"></i>' : ''}</span>
                <button class="btn-icon" onclick="app.deleteAgentNote(${agent.id}, ${n.id})"><i class="fas fa-trash"></i></button>
            </div>
            <div>"${n.text}"</div>
        </div>
    `).join('')
    : '<p style="color:var(--gray-400); font-size:13px;">No notes yet.</p>';
const notesContainer = document.getElementById(`agent-notes-list-${agent.id}`);
if (notesContainer) notesContainer.innerHTML = notesHtml;
}, 100);
*/


// That’s it – no extra code after this point
//</div> <!-- close the performance-grid div -->
//</div> <!-- close the viewport.innerHTML -->
//`;
//};


            
const renderCustomerHistory = async (agentId) => {
    const customers = (await getVisibleCustomers()).filter(c => c.responsible_agent_id === agentId);
    if (customers.length === 0) return '<p>No converted customers yet.</p>';

    return `
<div class="assignments-list">
    ${customers.map(c => `
                <div class="assignment-item" onclick="app.showCustomerDetail(${c.id})">
                    <div>
                        <div class="assignment-prospect">${c.full_name}</div>
                        <div class="next-action">Customer Since: ${c.customer_since}</div>
                    </div>
                    <span class="assignment-status status-active">RM ${c.lifetime_value.toLocaleString()}</span>
                </div>
            `).join('')
        }
        </div>
`;
};

const renewLicense = async (agentId) => {
    const content = `
<div class="renewal-form">
            <p>Select a renewal package to extend your agent license for 12 months.</p>
            <div class="renewal-package" style="border:2px solid var(--primary); padding:16px; border-radius:8px; margin-bottom:12px; cursor:pointer;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong>Standard Renewal</strong>
                    <span style="color:var(--primary); font-weight:700;">RM 1,500</span>
                </div>
                <p style="font-size:12px; color:var(--gray-500); margin-top:4px;">12 months license extension + Basic marketing tools.</p>
            </div>
            <div class="renewal-package" style="border:1px solid var(--gray-200); padding:16px; border-radius:8px; cursor:pointer;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong>Premium Renewal</strong>
                    <span style="color:var(--primary); font-weight:700;">RM 2,800</span>
                </div>
                <p style="font-size:12px; color:var(--gray-500); margin-top:4px;">12 months license extension + Advanced CRM features + Priority support.</p>
            </div>
        </div>
`;

    UI.showModal('License Renewal', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Purchase Package', type: 'primary', action: `(async () => { await app.executeRenewal(${agentId}); })()` }
    ]);
};

const executeRenewal = async (agentId) => {
    const agent = await AppDataStore.getById('users', agentId);
    if (agent) {
        await AppDataStore.update('users', agentId, {
            renewal_status: 'PENDING_REVIEW',
            license_renewal_requested: true,
            license_renewal_date: new Date().toISOString().split('T')[0]
        });
    }
    UI.hideModal();
    UI.toast.success('Renewal request submitted for admin review.');
    await showAgentDetail(agentId);
};

const calculateDaysDiff = (dateStr) => {
    if (!dateStr) return 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const expiry = new Date(dateStr + 'T00:00:00');
    if (isNaN(expiry.getTime())) return 0;
    const diff = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 0;
};

const renderFollowupStats = async (agentId) => {
    const stats = (await AppDataStore.query('agent_stats', { agent_id: agentId }))[0];
    if (!stats) return '<p>No performance data available.</p>';

    return `
<div class="performance-stats">
            <div class="stat-row">
                <span class="stat-label">Total Assigned:</span>
                <span class="stat-value">${stats.total_assigned}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">Followed up (7d):</span>
                <span class="stat-value">${stats.followed_up_7d} (${stats.followup_rate}%)</span>
            </div>
            <hr style="border:none; border-top:1px solid var(--gray-200); margin:8px 0;">
            <div class="inactive-list">
                <div class="inactive-item warning">
                    <span>Inactive 3-7 Days:</span>
                    <strong>${stats.inactive_3_7d}</strong>
                </div>
                <div class="inactive-item critical">
                    <span>Inactive 8-14 Days:</span>
                    <strong>${stats.inactive_8_14d}</strong>
                </div>
                <div class="inactive-item critical" style="background:#fee2e2;">
                    <span>Inactive 15+ Days:</span>
                    <strong>${stats.inactive_15d_plus}</strong>
                </div>
            </div>
            <button class="btn secondary btn-sm" style="margin-top:12px;" onclick="app.viewInactiveProspects(${agentId})">View Inactive List</button>
        </div>
`;
};


const renderCurrentAssignments = async (agentId) => {
const [assignments, allProspectsCA] = await Promise.all([
    AppDataStore.query('assignments', { agent_id: agentId }),
    AppDataStore.getAll('prospects'),
]);
if (assignments.length === 0) return '<p>No active assignments.</p>';
const prospectMapCA = new Map((allProspectsCA || []).map(p => [String(p.id), p]));

let itemsHtml = '';
for (const a of assignments) {
    const p = prospectMapCA.get(String(a.prospect_id));
    itemsHtml += `
        <div class="assignment-item" onclick="app.showProspectDetail(${a.prospect_id})">
            <div>
                <div class="assignment-prospect">${p ? escapeHtml(p.full_name) : 'Unknown'}</div>
                <div class="next-action">Next: ${a.next_action || 'None'}</div>
            </div>
            <span class="assignment-status status-${(a.status || 'active').toLowerCase()}">${a.status || 'Active'}</span>
        </div>
    `;
}

return `<div class="assignments-list">${itemsHtml}</div>`;
};
/*
const renderCurrentAssignments = async (agentId) => {
    const assignments = await AppDataStore.query('assignments', { agent_id: agentId });
    if (assignments.length === 0) return '<p>No active assignments.</p>';

    return `
<div class="assignments-list">
    ${assignments.map(a => {
        const p = await AppDataStore.getById('prospects', a.prospect_id);
        return `
                <div class="assignment-item" onclick="app.showProspectDetail(${a.prospect_id})">
                    <div>
                        <div class="assignment-prospect">${p.full_name}</div>
                        <div class="next-action">Next: ${a.next_action}</div>
                    </div>
                    <span class="assignment-status status-${a.status.toLowerCase()}">${a.status}</span>
                </div>
                `;
    }).join('')
        }
        </div>
`;
};
*/
const renderPerformanceTargets = async (agentId) => {
    const target = (await AppDataStore.query('agent_targets', { agent_id: agentId }))[0];
    if (!target) return '<p>No targets set for this month.</p>';

    return `
<div class="performance-stats">
            <div class="stat-row">
                <span class="stat-label">Sales Amount:</span>
                <span>RM ${target.current_amount.toLocaleString()} / ${target.target_amount.toLocaleString()}</span>
            </div>
            <div class="target-progress">
                <div class="fill" style="width: ${(target.current_amount / target.target_amount) * 100}%"></div>
            </div>
            
            <div class="stat-row">
                <span class="stat-label">CPS Conducted:</span>
                <span>${target.current_cps} / ${target.target_cps}</span>
            </div>
            <div class="target-progress">
                <div class="fill" style="width: ${(target.current_cps / target.target_cps) * 100}%"></div>
            </div>

            <div class="stat-row">
                <span class="stat-label">Meetings:</span>
                <span>${target.current_meetings} / ${target.target_meetings}</span>
            </div>
            <div class="target-progress">
                <div class="fill" style="width: ${(target.current_meetings / target.target_meetings) * 100}%"></div>
            </div>
            
            <button class="btn primary btn-sm" style="margin-top:12px;" onclick="app.updateAgentTargets(${agentId})">Update Targets</button>
        </div>
`;
};

const generatePassword = () => {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const digits = '23456789';
    const special = '@#$%!';
    const all = upper + lower + digits + special;
    let pwd = upper[Math.floor(Math.random()*upper.length)]
            + lower[Math.floor(Math.random()*lower.length)]
            + digits[Math.floor(Math.random()*digits.length)]
            + special[Math.floor(Math.random()*special.length)];
    for (let i = 0; i < 8; i++) pwd += all[Math.floor(Math.random()*all.length)];
    return pwd.split('').sort(() => Math.random() - 0.5).join('');
};

const openAddAgentModal = async (agentId = null) => {
    const agent = agentId ? await AppDataStore.getById('users', agentId) : null;
    const isEdit = !!agent;

    const allUsers = await AppDataStore.getAll('users');
    const reportingOptions = allUsers
        .filter(u => u.id != agentId)
        .map(u => `<option value="${u.id}" ${isEdit && agent.reporting_to == u.id ? 'selected' : ''}>${escapeHtml(u.full_name)} (${u.role || 'Agent'})</option>`)
        .join('');

    const content = `
<div class="add-agent-form">
            <input type="hidden" id="edit-agent-id" value="${isEdit ? agent.id : ''}">
            <div class="form-section">
                <h4>Basic Information</h4>
                <div class="form-row">
                    <div class="form-group half">
                        <label>Full Name <span class="required">*</span></label>
                        <input type="text" id="agent-name" class="form-control" required value="${isEdit ? (agent.full_name || '') : ''}">
                    </div>
                    <div class="form-group half">
                        <label>IC Number <span class="required">*</span></label>
                        <input type="text" id="agent-ic" class="form-control" required value="${isEdit ? (agent.ic_number || '') : ''}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group half">
                        <label>Phone <span class="required">*</span></label>
                        <input type="tel" id="agent-phone" class="form-control" required value="${isEdit ? (agent.phone || '') : ''}">
                    </div>
                    <div class="form-group half">
                        <label>Email <span class="required">*</span></label>
                        <input type="email" id="agent-email" class="form-control" required value="${isEdit ? (agent.email || '') : ''}">
                    </div>
                </div>
            </div>

            <div class="form-section">
                <h4>Business Information</h4>
                <div class="form-row">
                    <div class="form-group half">
                        <label>Agent Role <span class="required">*</span></label>
                        <select id="agent-role-select" class="form-control" required>
                            ${USER_ROLES.map(r => `<option value="${r}" ${isEdit && agent.role === r ? 'selected' : ''}>${r}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group half">
                        <label>Agent Code</label>
                        <input type="text" id="agent-code-new" class="form-control" placeholder="AGN-2026-XXX" value="${isEdit ? (agent.agent_code || '') : ''}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group half">
                        <label>Commission Rate (%)</label>
                        <input type="number" id="agent-comm" class="form-control" value="${isEdit ? (agent.commission_rate ?? 30) : 30}">
                    </div>
                    <div class="form-group half">
                        <label>Reporting To</label>
                        <select id="agent-reporting-to" class="form-control">
                            <option value="">— None —</option>
                            ${reportingOptions}
                        </select>
                    </div>
                </div>
            </div>

            <div class="form-section">
                <h4>License Information</h4>
                <div class="form-row">
                    <div class="form-group half">
                        <label>License Start Date</label>
                        <input type="date" id="agent-license-start" class="form-control" value="${isEdit ? (agent.license_start || '') : ''}">
                    </div>
                    <div class="form-group half">
                        <label>License Expiry Date</label>
                        <input type="date" id="agent-license-expiry" class="form-control" value="${isEdit ? (agent.license_expiry || '') : ''}">
                    </div>
                </div>
            </div>

            <div class="form-section">
                <h4>Team & Status</h4>
                <div class="form-row">
                    <div class="form-group half">
                        <label>Team</label>
                        <select id="agent-team" class="form-control">
                            <option value="">— Unassigned —</option>
                            ${Array.from({length: 26}, (_, i) => String.fromCharCode(65 + i)).map(L => `<option value="Team ${L}" ${isEdit && agent.team === 'Team ' + L ? 'selected' : ''}>Team ${L}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group half">
                        <label>Status</label>
                        <select id="agent-status" class="form-control">
                            <option value="active" ${(isEdit ? agent.status : 'probation') === 'active' ? 'selected' : ''}>Active</option>
                            <option value="probation" ${(isEdit ? agent.status : 'probation') === 'probation' ? 'selected' : ''}>Probation</option>
                            <option value="inactive" ${isEdit && agent.status === 'inactive' ? 'selected' : ''}>Inactive</option>
                            <option value="expired" ${isEdit && agent.status === 'expired' ? 'selected' : ''}>License Expired</option>
                        </select>
                    </div>
                </div>
            </div>

            ${!isEdit ? `
            <div class="form-section">
                <h4>Login Credentials</h4>
                <div class="form-group">
                    <label>Initial Password <span class="required">*</span></label>
                    <div style="display:flex; gap:8px;">
                        <input type="text" id="agent-initial-password" class="form-control" placeholder="Min 8 characters">
                        <button type="button" class="btn secondary" style="white-space:nowrap" onclick="(()=>{ const p=app.generatePassword(); document.getElementById('agent-initial-password').value=p; })()">Auto-generate</button>
                    </div>
                    <small style="color:var(--gray-500); margin-top:4px; display:block;">Login uses email address. Agent must change password on first login.</small>
                </div>
            </div>
            ` : `
            <div class="form-section">
                <h4>Password Management</h4>
                <p style="color:var(--gray-600); margin-bottom:8px;">Use the "Reset Password" button from the agent list to reset this agent's login credentials.</p>
            </div>
            `}
        </div>
`;

    UI.showModal(isEdit ? 'Edit Agent' : 'Add New Agent', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: isEdit ? 'Save Changes' : 'Create Agent Account', type: 'primary', action: '(async () => { await app.saveAgent(); })()' }
    ]);
};

const openEditAgentModal = (agentId) => openAddAgentModal(agentId);

const saveAgent = async () => {
    const name = document.getElementById('agent-name').value;
    if (!name) return UI.toast.error('Agent name is required');

    const editId = document.getElementById('edit-agent-id')?.value;
    const reportingToVal = document.getElementById('agent-reporting-to').value;
    const fields = {
        full_name: name,
        role: document.getElementById('agent-role-select').value,
        agent_code: document.getElementById('agent-code-new').value,
        phone: document.getElementById('agent-phone').value,
        email: document.getElementById('agent-email').value,
        ic_number: document.getElementById('agent-ic').value,
        commission_rate: parseInt(document.getElementById('agent-comm').value),
        license_start: document.getElementById('agent-license-start').value || null,
        license_expiry: document.getElementById('agent-license-expiry').value || null,
        reporting_to: reportingToVal ? parseInt(reportingToVal) : null,
        team: document.getElementById('agent-team')?.value || null,
        status: document.getElementById('agent-status')?.value || 'active',
    };

    if (editId) {
        await AppDataStore.update('users', editId, fields);
        UI.hideModal();
        UI.toast.success('Agent updated successfully');
    } else {
        // Username derived from email (part before @)
        const usernameVal = fields.email?.split('@')[0] || name.toLowerCase().replace(/\s+/g, '.');
        const initialPassword = document.getElementById('agent-initial-password')?.value?.trim();

        if (!initialPassword || initialPassword.length < 8) {
            return UI.toast.error('Initial password must be at least 8 characters');
        }
        if (!fields.email) {
            return UI.toast.error('Email is required to create login credentials');
        }

        const newAgent = {
            id: Date.now(),
            username: usernameVal,
            password: initialPassword,
            join_date: new Date().toISOString().split('T')[0],
            ...fields
        };
        await AppDataStore.create('users', newAgent);

        // Create Supabase Auth account via the admin-auth-ops Edge Function,
        // which holds service_role as a server-side secret. If it already
        // exists, the function updates the password instead.
        try {
            const { data: res, error } = await window.supabase.functions.invoke('admin-auth-ops', {
                body: { op: 'create-user', email: fields.email, password: initialPassword, full_name: name },
            });
            if (error || (res && res.ok === false)) {
                console.warn('Auth account creation warning:', error?.message || res?.error || 'unknown');
            }
        } catch (authErr) {
            console.warn('Supabase Auth account creation skipped:', authErr?.message || authErr);
        }

        UI.hideModal();
        UI.showModal('Agent Created', `
            <div style="text-align:center; padding:8px 0;">
                <i class="fas fa-check-circle" style="font-size:48px; color:#22c55e; margin-bottom:12px;"></i>
                <p style="margin-bottom:16px;">Account created for <strong>${escapeHtml(name)}</strong></p>
                <div style="background:var(--gray-100); border-radius:8px; padding:16px; text-align:left;">
                    <div style="margin-bottom:8px;"><span style="color:var(--gray-500)">Username:</span> <strong>${escapeHtml(usernameVal)}</strong></div>
                    <div style="margin-bottom:8px;"><span style="color:var(--gray-500)">Email:</span> <strong>${escapeHtml(fields.email)}</strong></div>
                    <div><span style="color:var(--gray-500)">Temp Password:</span> <strong id="show-temp-pwd">${escapeHtml(initialPassword)}</strong></div>
                </div>
                <p style="margin-top:12px; color:var(--gray-500); font-size:13px;">Agent must change their password on first login.</p>
                <div style="margin-top:12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;font-size:12px;color:#92400e;text-align:left;">
                    <strong>⚠ Email confirmation required</strong><br>
                    A confirmation email was sent to <strong>${escapeHtml(fields.email)}</strong>. The agent must click the link before they can log in.<br>
                    <span style="color:#6b7280;">To skip this step: Supabase Dashboard → Authentication → Providers → Email → uncheck <em>Confirm email</em>.</span>
                </div>
            </div>`, [
            { label: 'Close', type: 'primary', action: 'UI.hideModal()' }
        ]);
    }
    await renderAgentsTable();
};

const openAssignUplineModal = async (agentId) => {
    const agent = await AppDataStore.getById('users', agentId);
    if (!agent) return UI.toast.error('Agent not found');

    const allUsers = await AppDataStore.getAll('users');
    const options = allUsers
        .filter(u => u.id != agentId)
        .map(u => `<option value="${u.id}" ${agent.reporting_to == u.id ? 'selected' : ''}>${escapeHtml(u.full_name)} (${u.role || 'Agent'})</option>`)
        .join('');

    const content = `
        <div class="form-group">
            <p style="margin-bottom:12px; color:var(--gray-600);">Assigning upline for <strong>${escapeHtml(agent.full_name)}</strong>. Same-level reporting is allowed.</p>
            <label>Reports To</label>
            <select id="upline-select" class="form-control">
                <option value="">— None —</option>
                ${options}
            </select>
        </div>`;

    UI.showModal('Assign Upline', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Save Assignment', type: 'primary', action: `(async () => { await app.saveUplineAssignment('${agentId}'); })()` }
    ]);
};

const saveUplineAssignment = async (agentId) => {
    const val = document.getElementById('upline-select').value;
    await AppDataStore.update('users', agentId, { reporting_to: val ? parseInt(val) : null });
    UI.hideModal();
    UI.toast.success('Upline assignment saved');
    await renderAgentsTable();
};

// ── Credential / Password Management ──────────────────────────────────────

const showForcePasswordChangeModal = () => {
    const content = `
        <div style="text-align:center; margin-bottom:16px;">
            <i class="fas fa-lock" style="font-size:36px; color:var(--primary);"></i>
            <p style="margin-top:8px; color:var(--gray-600);">You must set a new password before continuing.</p>
        </div>
        <div class="form-group">
            <label>New Password <span class="required">*</span></label>
            <input type="password" id="force-new-pwd" class="form-control" placeholder="Min 8 characters">
        </div>
        <div class="form-group">
            <label>Confirm New Password <span class="required">*</span></label>
            <input type="password" id="force-confirm-pwd" class="form-control" placeholder="Re-enter new password">
        </div>`;
    UI.showModal('Set Your Password', content, [
        { label: 'Set Password', type: 'primary', action: '(async () => { await app.submitForcePasswordChange(); })()' }
    ]);
};

const submitForcePasswordChange = async () => {
    const newPwd = document.getElementById('force-new-pwd')?.value;
    const confirmPwd = document.getElementById('force-confirm-pwd')?.value;
    if (!newPwd || newPwd.length < 8) return UI.toast.error('Password must be at least 8 characters');
    if (newPwd !== confirmPwd) return UI.toast.error('Passwords do not match');

    try {
        const r = await window.supabase.auth.updateUser({ password: newPwd });
        const error = r && r.error;
        if (error) throw error;
    } catch (e) {
        // Offline fallback — update users table only
        console.warn('Supabase updateUser failed (offline?):', e?.message || e);
    }
    await AppDataStore.update('users', _currentUser.id, {
        force_password_change: false,
        password: newPwd
    });
    _currentUser.force_password_change = false;
    UI.hideModal();
    UI.toast.success('Password set successfully. Welcome!');
    await navigateTo('calendar');
};

const selfChangePassword = async () => {
    const currentPwd = document.getElementById('settings-current-pwd')?.value;
    const newPwd = document.getElementById('settings-new-pwd')?.value;
    const confirmPwd = document.getElementById('settings-confirm-pwd')?.value;
    if (!currentPwd) return UI.toast.error('Enter your current password');
    if (!newPwd || newPwd.length < 8) return UI.toast.error('New password must be at least 8 characters');
    if (newPwd !== confirmPwd) return UI.toast.error('Passwords do not match');
    if (newPwd === currentPwd) return UI.toast.error('New password must differ from current password');

    // Verify current password via re-auth
    try {
        const verifyRes = await window.supabase.auth.signInWithPassword({
            email: _currentUser.email,
            password: currentPwd
        });
        const verifyErr = verifyRes && verifyRes.error;
        if (verifyErr) return UI.toast.error('Current password is incorrect');
        const updateRes = await window.supabase.auth.updateUser({ password: newPwd });
        const updateErr = updateRes && updateRes.error;
        if (updateErr) throw updateErr;
    } catch (e) {
        console.warn('Supabase password change (offline?):', e?.message || e);
    }
    await AppDataStore.update('users', _currentUser.id, {
        password: newPwd,
        force_password_change: false
    });
    _currentUser.force_password_change = false;
    document.getElementById('settings-current-pwd').value = '';
    document.getElementById('settings-new-pwd').value = '';
    document.getElementById('settings-confirm-pwd').value = '';
    UI.toast.success('Password changed successfully');
};

const saveSelfPreferredName = async () => {
    if (!_currentUser) return UI.toast.error('Not logged in');
    const input = document.getElementById('settings-preferred-name');
    const newName = (input?.value || '').trim();
    if (newName.length > 60) return UI.toast.error('Preferred name must be 60 characters or less');
    try {
        await AppDataStore.update('users', _currentUser.id, { preferred_name: newName || null });
        _currentUser.preferred_name = newName || null;
        updateUserDisplay();
        UI.toast.success(newName ? 'Display name updated' : 'Display name cleared');
    } catch (e) {
        console.error('saveSelfPreferredName failed', e);
        UI.toast.error('Failed to save display name');
    }
};

const showSettingsView = (container) => {
    const viewport = container || document.getElementById('content-viewport');
    viewport.innerHTML = `
    <div style="max-width:640px; margin:32px auto; padding:0 16px;">
        <h2 style="font-size:24px; font-weight:700; margin-bottom:24px;"><i class="fas fa-cog"></i> Account Settings</h2>

        <div class="performance-card" style="margin-bottom:24px;">
            <h4><i class="fas fa-user"></i> Profile</h4>
            <div class="performance-stats">
                <div class="stat-row"><span class="stat-label">Name:</span><span class="stat-value">${escapeHtml(_currentUser?.full_name || '')}</span></div>
                <div class="stat-row"><span class="stat-label">Email:</span><span class="stat-value">${escapeHtml(_currentUser?.email || '')}</span></div>
                <div class="stat-row"><span class="stat-label">Role:</span><span class="stat-value">${escapeHtml(_currentUser?.role || '')}</span></div>
                <div class="stat-row"><span class="stat-label">Agent Code:</span><span class="stat-value">${escapeHtml(_currentUser?.agent_code || '—')}</span></div>
            </div>
        </div>

        <div class="performance-card" style="margin-bottom:24px;">
            <h4><i class="fas fa-id-badge"></i> Display Name</h4>
            <p style="color:var(--gray-500); font-size:13px; margin:8px 0 12px;">This is the name shown in the top-right header. Leave blank to use your full name.</p>
            <div class="form-group" style="margin-bottom:12px;">
                <label>Preferred Name</label>
                <input type="text" id="settings-preferred-name" class="form-control" placeholder="e.g. Mian" value="${escapeHtml(_currentUser?.preferred_name || '')}" maxlength="60">
            </div>
            <button class="btn primary" onclick="(async()=>{ await app.saveSelfPreferredName(); })()">
                <i class="fas fa-save"></i> Save Display Name
            </button>
        </div>

        <div class="performance-card">
            <h4><i class="fas fa-key"></i> Change Password</h4>
            <div style="margin-top:12px;">
                <div class="form-group" style="margin-bottom:12px;">
                    <label>Current Password</label>
                    <input type="password" id="settings-current-pwd" class="form-control" placeholder="Enter current password">
                </div>
                <div class="form-group" style="margin-bottom:12px;">
                    <label>New Password</label>
                    <input type="password" id="settings-new-pwd" class="form-control" placeholder="Min 8 characters">
                </div>
                <div class="form-group" style="margin-bottom:16px;">
                    <label>Confirm New Password</label>
                    <input type="password" id="settings-confirm-pwd" class="form-control" placeholder="Re-enter new password">
                </div>
                <button class="btn primary" onclick="(async()=>{ await app.selfChangePassword(); })()">
                    <i class="fas fa-save"></i> Update Password
                </button>
            </div>
        </div>

        <!-- ========== Push Notifications ========== -->
        <div class="performance-card" style="margin-top:24px;">
            <h4><i class="fas fa-bell"></i> Phone Push Notifications</h4>
            <p style="color:var(--gray-500); font-size:13px; margin:8px 0 12px;">
                Get a notification on your phone whenever a new calendar activity is added.
                To receive notifications on iPhone or Android, open this site in your mobile browser,
                tap <strong>Share → Add to Home Screen</strong>, then enable notifications below.
                <span id="notif-ios-hint" style="display:block; margin-top:4px; color:var(--warning);">
                    iOS 16.4 or newer is required.
                </span>
            </p>
            <div id="notif-status-box" style="background:var(--gray-100); border-radius:8px; padding:12px; margin-bottom:12px;">
                <div class="stat-row"><span class="stat-label">Browser support:</span><span class="stat-value" id="notif-support">—</span></div>
                <div class="stat-row"><span class="stat-label">Permission:</span><span class="stat-value" id="notif-permission">—</span></div>
                <div class="stat-row"><span class="stat-label">Subscribed:</span><span class="stat-value" id="notif-subscribed">—</span></div>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button id="notif-enable-btn" class="btn primary" onclick="(async()=>{ await app.enablePushNotifications(); })()">
                    <i class="fas fa-bell"></i> Enable Notifications
                </button>
                <button id="notif-disable-btn" class="btn secondary" onclick="(async()=>{ await app.disablePushNotifications(); })()" style="display:none;">
                    <i class="fas fa-bell-slash"></i> Disable
                </button>
                <button class="btn secondary" onclick="(async()=>{ await app.sendTestPushNotification(); })()">
                    <i class="fas fa-paper-plane"></i> Send Test
                </button>
            </div>

            <!-- Reminder timing preferences -->
            <div style="margin-top:20px; border-top:1px solid var(--gray-200); padding-top:16px;">
                <h5 style="margin:0 0 4px; font-size:14px; font-weight:600;">Reminder Timing</h5>
                <p style="color:var(--gray-500); font-size:12px; margin:0 0 12px;">
                    How far in advance do you want to be reminded? Choose one or more.
                </p>
                <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px;">
                    <label style="display:flex; align-items:center; gap:8px; font-size:14px; cursor:pointer;">
                        <input type="checkbox" id="reminder-1440" value="1440" onchange="app.onReminderCheckboxChange()">
                        <span>1 day before</span>
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; font-size:14px; cursor:pointer;">
                        <input type="checkbox" id="reminder-60" value="60" onchange="app.onReminderCheckboxChange()">
                        <span>1 hour before</span>
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; font-size:14px; cursor:pointer;">
                        <input type="checkbox" id="reminder-15" value="15" onchange="app.onReminderCheckboxChange()">
                        <span>15 minutes before</span>
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; font-size:14px; cursor:pointer;">
                        <input type="checkbox" id="reminder-10" value="10" onchange="app.onReminderCheckboxChange()">
                        <span>10 minutes before</span>
                    </label>
                </div>
                <label style="display:flex; align-items:center; gap:8px; font-size:14px; cursor:pointer; margin-bottom:14px;">
                    <input type="checkbox" id="reminder-daily-summary" onchange="app.onReminderCheckboxChange()">
                    <span>Daily summary at 10:00 AM (today's events)</span>
                </label>
                <button id="notif-prefs-save-btn" class="btn primary" style="display:none;" onclick="(async()=>{ await app.saveNotificationPreferences(); })()">
                    <i class="fas fa-save"></i> Save Reminder Preferences
                </button>
                <span id="notif-prefs-saved" style="display:none; color:var(--success); font-size:13px; margin-left:8px;">
                    <i class="fas fa-check"></i> Saved
                </span>
            </div>
        </div>

        ${isSystemAdmin(_currentUser) ? `
        <!-- ========== Data Quality (Super Admin only) ========== -->
        <div class="performance-card" style="margin-top:24px;">
            <h4><i class="fas fa-broom"></i> Data Quality</h4>
            <p style="color:var(--gray-500); font-size:13px; margin:8px 0 12px;">
                Review prospects that share the same phone number. Family
                members often legitimately share a phone; obvious duplicates
                should be merged before a DB-level unique constraint is
                enforced.
            </p>
            <button class="btn primary" onclick="(async()=>{ await app.showPhoneDupesModal(); })()">
                <i class="fas fa-search"></i> Review Contact Duplicates
            </button>
        </div>
        ` : ''}
    </div>`;

    // Populate status asynchronously
    setTimeout(() => refreshPushNotificationStatus(), 50);
};

// ========== Phone-duplicate review (Super Admin only) ==========
// Lists every phone held by 2+ prospects. Offers per-row actions:
//   • Edit phone   — open the prospect modal prefilled so the agent can
//                    give this person a distinct number.
//   • Clear phone  — NULL out this prospect's phone (keeps the record).
//   • Delete       — hard-delete the prospect (true duplicate records).
// When the count drops to zero the admin can request the unique-index
// migration via the footer button (Claude/DBA applies the DDL).
const _loadPhoneDupes = async () => {
    // Use the indexed light-select query. At 100K+ rows the old
    // getAll('prospects') approach would be unacceptable here; this groups
    // on the server and returns only the dupe rows.
    try {
        const { data, error } = await Promise.resolve(window.supabase.rpc('_fs_phone_dupes')).catch(() => ({ data: null, error: 'no-rpc' }));
        if (data && !error) return data;
    } catch (_) {}
    // Fallback: pull phone list via PostgREST, group client-side. Uses the
    // light-select cache if available so subsequent opens are instant.
    const rows = await AppDataStore.getActiveProspects({ includeDormant: true, limit: 50000 });
    const byPhone = new Map();
    for (const p of rows) {
        const ph = (p.phone || '').trim();
        if (!ph) continue;
        if (!byPhone.has(ph)) byPhone.set(ph, []);
        byPhone.get(ph).push(p);
    }
    const dupes = [];
    for (const [phone, group] of byPhone.entries()) {
        if (group.length > 1) {
            dupes.push({ phone, group: group.sort((a, b) => String(a.id).localeCompare(String(b.id))) });
        }
    }
    return dupes.sort((a, b) => b.group.length - a.group.length);
};

// Mirror for email — grouping is case-insensitive.
// Prefers server-side RPC `_fs_email_dupes` (added 2026-04-24), falls
// back to a client-side scan if the RPC isn't available yet (so the
// feature still works pre-migration).
const _loadEmailDupes = async () => {
    try {
        const { data, error } = await Promise.resolve(window.supabase.rpc('_fs_email_dupes')).catch(() => ({ data: null, error: 'no-rpc' }));
        if (data && !error) {
            return data.map(row => ({
                email: row.email,
                group: Array.isArray(row.group_json) ? row.group_json : (row.group_json || [])
            }));
        }
    } catch (_) {}
    const rows = await AppDataStore.getActiveProspects({ includeDormant: true, limit: 50000 });
    const byEmail = new Map();
    for (const p of rows) {
        const em = (p.email || '').trim().toLowerCase();
        if (!em) continue;
        if (!byEmail.has(em)) byEmail.set(em, []);
        byEmail.get(em).push(p);
    }
    const dupes = [];
    for (const [email, group] of byEmail.entries()) {
        if (group.length > 1) {
            dupes.push({ email, group: group.sort((a, b) => String(a.id).localeCompare(String(b.id))) });
        }
    }
    return dupes.sort((a, b) => b.group.length - a.group.length);
};

const _renderDupeGroup = (label, icon, color, keyField, items, users) => {
    const userById = new Map((users || []).map(u => [String(u.id), u]));
    const agentName = (id) => userById.get(String(id))?.full_name || '—';
    let html = '';
    for (const item of items) {
        const key = item[keyField];
        const group = item.group;
        html += `
            <div style="border:1px solid var(--border); border-radius:8px; padding:12px; margin-bottom:12px; background:var(--surface);">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
                    <i class="fas ${icon}" style="color:${color};"></i>
                    <strong style="font-family:monospace; font-size:14px; word-break:break-all;">${escapeHtml(key)}</strong>
                    <span style="color:var(--text-secondary); font-size:12px;">(${group.length} prospects)</span>
                </div>
        `;
        const isEmailGroup = keyField === 'email';
        for (const p of group) {
            const last = p.last_activity_date || '—';
            // For email dupes the "clear" action clears email instead of phone.
            const clearFn = isEmailGroup ? 'dedupeClearEmail' : 'dedupeClearPhone';
            const clearLabel = isEmailGroup ? 'Clear email' : 'Clear phone';
            html += `
                <div style="display:flex; align-items:center; gap:8px; padding:8px; border-top:1px solid var(--border); flex-wrap:wrap;">
                    <div style="flex:1; min-width:200px;">
                        <strong>${escapeHtml(p.full_name || '(no name)')}</strong>
                        <div style="font-size:11px; color:var(--text-secondary);">
                            Agent: ${escapeHtml(agentName(p.responsible_agent_id))} · Last activity: ${last} · ID ${p.id}
                        </div>
                    </div>
                    <button class="btn secondary btn-sm" onclick="app.dedupeEditPhone(${p.id})" title="Open profile">
                        <i class="fas fa-pen"></i> Edit
                    </button>
                    <button class="btn secondary btn-sm" onclick="app.${clearFn}(${p.id})" title="${clearLabel}">
                        <i class="fas fa-eraser"></i> ${clearLabel}
                    </button>
                    <button class="btn secondary btn-sm" style="color:var(--red-500);" onclick="app.dedupeDeleteProspect(${p.id})" title="Hard-delete this prospect">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            `;
        }
        html += `</div>`;
    }
    return html;
};

const _renderPhoneDupesBody = (phoneDupes, emailDupes, users) => {
    const phoneCount = phoneDupes?.length || 0;
    const emailCount = emailDupes?.length || 0;
    if (phoneCount === 0 && emailCount === 0) {
        return `
            <div style="text-align:center; padding:32px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px;">
                <i class="fas fa-check-circle" style="color:#16a34a; font-size:28px;"></i>
                <p style="margin:12px 0 4px; font-size:15px; font-weight:600;">No contact duplicates</p>
                <p style="color:#166534; font-size:13px;">No shared phones or emails across prospects.</p>
            </div>
        `;
    }
    let html = `
        <p style="font-size:13px; color:var(--text-secondary); margin-bottom:16px;">
            <strong>${phoneCount}</strong> phone${phoneCount !== 1 ? 's' : ''} and
            <strong>${emailCount}</strong> email${emailCount !== 1 ? 's' : ''} shared by 2+ prospects.
            Phone sharing is hard-blocked at the DB level — resolve all phone dupes. Email
            sharing is allowed (couples often share an inbox) but shown here for audit.
        </p>
    `;
    if (phoneCount > 0) {
        html += `<h5 style="margin:16px 0 8px; font-size:13px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.05em;">Phone duplicates</h5>`;
        html += _renderDupeGroup('phone', 'fa-phone', '#d97706', 'phone', phoneDupes, users);
    }
    if (emailCount > 0) {
        html += `<h5 style="margin:16px 0 8px; font-size:13px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.05em;">Email duplicates (shared inboxes — usually OK)</h5>`;
        html += _renderDupeGroup('email', 'fa-envelope', '#2563eb', 'email', emailDupes, users);
    }
    return html;
};

const showPhoneDupesModal = async () => {
    if (!isSystemAdmin(_currentUser)) {
        UI.toast.error('Super Admin only.');
        return;
    }
    UI.showModal(
        'Contact Duplicates Review',
        `<div id="phone-dupes-body" style="min-height:200px; max-height:60vh; overflow-y:auto;">
            <div style="text-align:center; padding:32px; color:var(--text-secondary);">
                <i class="fas fa-spinner fa-spin"></i> Scanning prospects…
            </div>
        </div>`,
        [
            { label: 'Refresh', type: 'secondary', action: '(async()=>{ await app.refreshPhoneDupes(); })()' },
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Verify phone constraint', type: 'primary', action: '(async()=>{ await app.verifyAndPreparePhoneConstraint(); })()' },
        ]
    );
    await refreshPhoneDupes();
};

const refreshPhoneDupes = async () => {
    const body = document.getElementById('phone-dupes-body');
    if (!body) return;
    body.innerHTML = `<div style="text-align:center; padding:32px; color:var(--text-secondary);"><i class="fas fa-spinner fa-spin"></i> Scanning prospects…</div>`;
    try {
        const [phoneDupes, emailDupes, users] = await Promise.all([
            _loadPhoneDupes(),
            _loadEmailDupes(),
            AppDataStore.getAll('users'),
        ]);
        body.innerHTML = _renderPhoneDupesBody(phoneDupes, emailDupes, users);
    } catch (e) {
        console.error('[contact-dupes]', e);
        body.innerHTML = `<div style="color:var(--red-500); padding:16px;">Error: ${escapeHtml(e.message || String(e))}</div>`;
    }
};

const dedupeClearEmail = async (prospectId) => {
    const ok = confirm(`Clear the email for prospect ${prospectId}?\n\nThe record stays; only the email field is nulled.`);
    if (!ok) return;
    try {
        await AppDataStore.update('prospects', parseInt(prospectId), { email: null, updated_at: new Date().toISOString() });
        UI.toast.success('Email cleared.');
        await refreshPhoneDupes();
    } catch (e) {
        UI.toast.error('Failed to clear email: ' + (e.message || e));
    }
};

const dedupeEditPhone = async (prospectId) => {
    UI.hideModal();
    // Tiny delay so the close animation doesn't fight the next modal open.
    setTimeout(() => openProspectModal(prospectId), 120);
};

const dedupeClearPhone = async (prospectId) => {
    const ok = confirm(`Clear the phone number for prospect ${prospectId}?\n\nThe record stays; only the phone field is nulled.`);
    if (!ok) return;
    try {
        await AppDataStore.update('prospects', parseInt(prospectId), { phone: null, updated_at: new Date().toISOString() });
        UI.toast.success('Phone cleared.');
        await refreshPhoneDupes();
    } catch (e) {
        UI.toast.error('Failed to clear phone: ' + (e.message || e));
    }
};

const dedupeDeleteProspect = async (prospectId) => {
    const ok = confirm(`PERMANENTLY DELETE prospect ${prospectId}?\n\nThis cannot be undone. Use this only for true duplicate records.`);
    if (!ok) return;
    try {
        await AppDataStore.delete('prospects', parseInt(prospectId));
        UI.toast.success('Prospect deleted.');
        await refreshPhoneDupes();
    } catch (e) {
        UI.toast.error('Failed to delete: ' + (e.message || e));
    }
};

const verifyAndPreparePhoneConstraint = async () => {
    const body = document.getElementById('phone-dupes-body');
    if (body) body.innerHTML = `<div style="text-align:center; padding:32px;"><i class="fas fa-spinner fa-spin"></i> Re-checking…</div>`;
    const dupes = await _loadPhoneDupes();
    if (dupes.length > 0) {
        await refreshPhoneDupes();
        UI.toast.error(`Still ${dupes.length} duplicate${dupes.length > 1 ? 's' : ''}. Resolve them first.`);
        return;
    }
    if (body) {
        body.innerHTML = `
            <div style="text-align:center; padding:32px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px;">
                <i class="fas fa-check-circle" style="color:#16a34a; font-size:28px;"></i>
                <p style="margin:12px 0 4px; font-size:15px; font-weight:600;">No phone duplicates remaining.</p>
                <p style="color:#166534; font-size:13px; margin-bottom:12px;">
                    Ready to apply the unique constraint. Ask the DBA (or Claude) to run:
                </p>
                <pre style="background:#fff; border:1px solid #bbf7d0; border-radius:6px; padding:12px; font-size:12px; text-align:left; white-space:pre-wrap; word-break:break-all;">CREATE UNIQUE INDEX CONCURRENTLY idx_prospects_phone_unique
  ON prospects (phone)
  WHERE phone IS NOT NULL AND phone <> '';</pre>
                <p style="color:var(--text-secondary); font-size:12px; margin-top:8px;">
                    Migration file: <code>migrations/phone_unique_constraint.sql</code>
                </p>
            </div>
        `;
    }
    UI.toast.success('All clean — ready for the unique constraint.');
};

// ========== Push notification settings handlers ==========
const refreshPushNotificationStatus = async () => {
    const supEl  = document.getElementById('notif-support');
    const permEl = document.getElementById('notif-permission');
    const subEl  = document.getElementById('notif-subscribed');
    const enableBtn  = document.getElementById('notif-enable-btn');
    const disableBtn = document.getElementById('notif-disable-btn');
    if (!supEl || !permEl || !subEl) return;

    if (!window.PushNotif) {
        supEl.textContent = 'Not loaded';
        permEl.textContent = '—';
        subEl.textContent = '—';
        return;
    }
    try {
        const s = await window.PushNotif.getStatus();
        supEl.textContent = s.supported ? 'Yes' : 'No (use a modern browser)';
        permEl.textContent = s.permission || 'default';
        subEl.textContent = s.subscribed ? 'Yes' : 'No';
        if (enableBtn && disableBtn) {
            enableBtn.style.display = s.subscribed ? 'none' : '';
            disableBtn.style.display = s.subscribed ? '' : 'none';
        }
    } catch (e) {
        supEl.textContent = 'Error: ' + (e.message || e);
    }
    // Load reminder preferences into checkboxes
    await loadNotificationPreferences();
};

const enablePushNotifications = async () => {
    if (!window.PushNotif) { UI.toast.error('Push module not loaded'); return; }
    try {
        await window.PushNotif.subscribe();
        UI.toast.success('Notifications enabled on this device');
        await refreshPushNotificationStatus();
    } catch (e) {
        const msg = (e && e.message) || String(e);
        if (msg === 'permission_denied') {
            UI.toast.error('Permission denied — enable notifications for this site in your browser settings');
        } else if (msg === 'push_unsupported') {
            UI.toast.error('This browser does not support push notifications');
        } else if (msg === 'no_user') {
            UI.toast.error('Log in first, then enable notifications');
        } else {
            UI.toast.error('Failed to enable: ' + msg);
        }
        await refreshPushNotificationStatus();
    }
};

const disablePushNotifications = async () => {
    if (!window.PushNotif) return;
    try {
        await window.PushNotif.unsubscribe();
        UI.toast.success('Notifications disabled on this device');
    } catch (e) {
        UI.toast.error('Failed to disable: ' + (e.message || e));
    }
    await refreshPushNotificationStatus();
};

const sendTestPushNotification = async () => {
    if (!window.PushNotif) { UI.toast.error('Push module not loaded'); return; }
    if (!_currentUser?.id) { UI.toast.error('Log in first'); return; }
    try {
        const res = await window.PushNotif.sendActivityPush(
            { id: 'test_' + Date.now(), activity_type: 'Test', activity_title: 'Test notification' },
            [String(_currentUser.id)],
            {
                title: 'Feng Shui CRM — Test',
                body: 'If you can read this on your phone, notifications are working.',
                url: './index.html#calendar',
            }
        );
        if (res && res.ok && (res.sent > 0)) {
            UI.toast.success(`Test sent to ${res.sent} device(s)`);
        } else if (res && res.reason === 'no_subscriptions') {
            UI.toast.error('No subscribed device found — enable notifications first');
        } else {
            UI.toast.error('Test failed: ' + JSON.stringify(res));
        }
    } catch (e) {
        UI.toast.error('Test failed: ' + (e.message || e));
    }
};

// ========== Notification reminder preferences ==========
const loadNotificationPreferences = async () => {
    if (!_currentUser?.id) return;
    try {
        const { data } = await window.supabase
            .from('notification_preferences')
            .select('reminder_minutes,daily_summary')
            .eq('user_id', _currentUser.id)
            .maybeSingle();
        const minutes = (data && data.reminder_minutes) ? data.reminder_minutes : [15];
        const dailySummary = data ? !!data.daily_summary : true;
        [1440, 60, 15, 10].forEach(m => {
            const el = document.getElementById(`reminder-${m}`);
            if (el) el.checked = minutes.includes(m);
        });
        const dsel = document.getElementById('reminder-daily-summary');
        if (dsel) dsel.checked = dailySummary;
    } catch (e) {
        console.warn('[Prefs] load failed:', e);
    }
};

const saveNotificationPreferences = async () => {
    if (!_currentUser?.id) { UI.toast.error('Log in first'); return; }
    const minutes = [1440, 60, 15, 10].filter(m => {
        const el = document.getElementById(`reminder-${m}`);
        return el && el.checked;
    });
    if (minutes.length === 0) { UI.toast.error('Please select at least one reminder time'); return; }
    const dailySummary = !!(document.getElementById('reminder-daily-summary')?.checked);
    try {
        const { error } = await window.supabase
            .from('notification_preferences')
            .upsert({ user_id: _currentUser.id, reminder_minutes: minutes, daily_summary: dailySummary, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
        if (error) throw error;
        const saveBtn = document.getElementById('notif-prefs-save-btn');
        const savedMsg = document.getElementById('notif-prefs-saved');
        if (saveBtn) saveBtn.style.display = 'none';
        if (savedMsg) { savedMsg.style.display = ''; setTimeout(() => { savedMsg.style.display = 'none'; }, 2500); }
        UI.toast.success('Reminder preferences saved');
    } catch (e) {
        UI.toast.error('Failed to save: ' + (e.message || e));
    }
};

const onReminderCheckboxChange = () => {
    const saveBtn = document.getElementById('notif-prefs-save-btn');
    const savedMsg = document.getElementById('notif-prefs-saved');
    if (saveBtn) saveBtn.style.display = '';
    if (savedMsg) savedMsg.style.display = 'none';
};

// Admin: reset another agent's password
const openResetPasswordModal = async (agentId) => {
    const agent = await AppDataStore.getById('users', agentId);
    if (!agent) return UI.toast.error('Agent not found');
    const tempPwd = generatePassword();
    const content = `
        <div class="form-group">
            <p style="margin-bottom:12px;">Reset credentials for <strong>${escapeHtml(agent.full_name)}</strong> (${escapeHtml(agent.email || 'no email')})</p>
            <div style="margin-bottom:16px;">
                <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                    <input type="radio" name="pwd-reset-type" value="email" ${agent.email ? 'checked' : 'disabled'}
                        onchange="document.getElementById('manual-reset-section').style.display='none'"> Send password reset email to agent
                </label>
                <label style="display:flex;align-items:center;gap:8px;">
                    <input type="radio" name="pwd-reset-type" value="manual" ${!agent.email ? 'checked' : ''}
                        onchange="document.getElementById('manual-reset-section').style.display=''"> Set temporary password manually
                </label>
            </div>
            <div id="manual-reset-section" style="${!agent.email ? '' : 'display:none;'}">
                <label>Temporary Password</label>
                <div style="display:flex; gap:8px; margin-top:4px;">
                    <input type="text" id="reset-temp-pwd" class="form-control" value="${escapeHtml(tempPwd)}">
                    <button type="button" class="btn secondary" style="white-space:nowrap" onclick="document.getElementById('reset-temp-pwd').value=app.generatePassword()">Regenerate</button>
                </div>
                <small style="color:var(--gray-500); margin-top:4px; display:block;">Agent must change password on next login.</small>
            </div>
        </div>`;
    UI.showModal('Reset Agent Password', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Reset Password', type: 'primary', action: `(async () => { await app.executePasswordReset('${agentId}'); })()` }
    ]);
};

const executePasswordReset = async (agentId) => {
    const agent = await AppDataStore.getById('users', agentId);
    if (!agent) return UI.toast.error('Agent not found');

    const resetType = document.querySelector('[name=pwd-reset-type]:checked')?.value || 'manual';

    if (resetType === 'email' && agent.email) {
        try {
            const r = await window.supabase.auth.resetPasswordForEmail(agent.email, {
                redirectTo: window.location.origin + window.location.pathname + '?reset=true'
            });
            const error = r && r.error;
            if (error) throw error;
            UI.hideModal();
            UI.toast.success(`Password reset email sent to ${agent.email}`);
        } catch (e) {
            UI.toast.error('Failed to send reset email: ' + e.message);
        }
    } else {
        const tempPwd = document.getElementById('reset-temp-pwd')?.value?.trim();
        if (!tempPwd || tempPwd.length < 8) return UI.toast.error('Temporary password must be at least 8 characters');

        // Update CRM database
        await AppDataStore.update('users', agentId, { password: tempPwd, force_password_change: true });

        // Update Supabase Auth (create account if missing, update password if exists)
        // via the admin-auth-ops Edge Function (holds service_role as a secret).
        let authUpdated = false;
        try {
            if (agent.email) {
                const { data: res, error } = await window.supabase.functions.invoke('admin-auth-ops', {
                    body: { op: 'reset-password', email: agent.email, new_password: tempPwd },
                });
                authUpdated = !error && res && res.ok !== false;
                if (!authUpdated) console.warn('Supabase Auth update failed:', error?.message || res?.error || 'unknown');
            }
        } catch (authErr) {
            console.warn('Supabase Auth update failed:', authErr?.message || authErr);
        }

        UI.hideModal();
        UI.showModal('Password Reset', `
            <div style="text-align:center; padding:8px;">
                <i class="fas fa-check-circle" style="font-size:36px; color:#22c55e; margin-bottom:12px;"></i>
                <p>Password reset for <strong>${escapeHtml(agent.full_name)}</strong></p>
                <div style="background:var(--gray-100); border-radius:8px; padding:12px; margin-top:12px;">
                    <div><span style="color:var(--gray-500)">Email:</span> <strong>${escapeHtml(agent.email || '—')}</strong></div>
                    <div style="margin-top:4px;"><span style="color:var(--gray-500)">Temp Password:</span> <strong>${escapeHtml(tempPwd)}</strong></div>
                    <div style="margin-top:8px;font-size:12px;color:${authUpdated ? '#16a34a' : '#dc2626'};">
                        ${authUpdated ? '✅ Login credentials updated — agent can log in now.' : '⚠️ CRM updated but Supabase Auth sync failed. Try the "Send reset email" option instead.'}
                    </div>
                </div>
                <p style="margin-top:8px; color:var(--gray-500); font-size:13px;">Agent must change password on next login.</p>
            </div>`, [{ label: 'Done', type: 'primary', action: 'UI.hideModal()' }]);
    }
};

const deleteAgent = async (agentId) => {
    // Re-check role here. RLS policies also gate writes, but client-side
    // gating gives a cleaner error and avoids wasting a round trip.
    if (!(isSystemAdmin(_currentUser) || isMarketingManager(_currentUser))) {
        return UI.toast.error('You do not have permission to delete agents.');
    }
    const agent = await AppDataStore.getById('users', agentId);
    if (!agent) return UI.toast.error('Agent not found');
    UI.showModal('Delete Agent', `
        <div style="text-align:center; padding:8px 0;">
            <i class="fas fa-exclamation-triangle" style="font-size:40px; color:var(--error); margin-bottom:12px;"></i>
            <p>Are you sure you want to delete <strong>${escapeHtml(agent.full_name)}</strong>?</p>
            <p style="color:var(--gray-500); font-size:13px; margin-top:8px;">This will permanently remove the agent and cannot be undone.</p>
        </div>`, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Delete', type: 'primary', action: `(async () => { await app.confirmDeleteAgent('${agentId}'); })()` }
    ]);
};

const confirmDeleteAgent = async (agentId) => {
    if (!(isSystemAdmin(_currentUser) || isMarketingManager(_currentUser))) {
        UI.hideModal();
        return UI.toast.error('You do not have permission to delete agents.');
    }
    try {
        // Fetch agent BEFORE deleting so we have the email for auth deletion
        const agent = await AppDataStore.getById('users', agentId);
        // FK cleanup runs with the caller's JWT; RLS policies must allow
        // admin-level updates/deletes on these tables (see rls_replace_allow_all_*.sql).
        const wc = AppDataStore._writeClient();
        // Clear reporting_to references pointing to this agent
        await wc.from('users').update({ reporting_to: null }).eq('reporting_to', agentId);
        // Clear prospects assigned to this agent
        await wc.from('prospects').update({ responsible_agent_id: null }).eq('responsible_agent_id', agentId);
        // Clear activities linked to this agent
        await wc.from('activities').update({ lead_agent_id: null }).eq('lead_agent_id', agentId);
        // Delete agent_targets and agent_stats rows for this agent
        await wc.from('agent_targets').delete().eq('agent_id', agentId);
        await wc.from('agent_stats').delete().eq('agent_id', agentId);
        await AppDataStore.delete('users', agentId);
        // Remove from Supabase Auth via the `admin-auth-ops` Edge Function,
        // which holds service_role as a server-side secret. If this step
        // fails (e.g. function not deployed, caller not admin) the DB row
        // is still gone — we just surface a warning so the admin can do a
        // manual cleanup.
        if (agent?.email) {
            try {
                const { data: res, error } = await window.supabase.functions.invoke('admin-auth-ops', {
                    body: { op: 'delete-auth-user', email: agent.email },
                });
                if (error || (res && res.ok === false)) {
                    UI.toast.error('Agent deleted from CRM, but auth user cleanup failed: ' + (error?.message || res?.error || 'unknown'));
                }
            } catch (e) {
                UI.toast.error('Agent deleted from CRM, but auth user cleanup errored: ' + (e?.message || e));
            }
        }
        UI.hideModal();
        UI.toast.success('Agent deleted successfully');
        await renderAgentsTable();
    } catch (err) {
        UI.toast.error('Failed to delete agent: ' + err.message);
    }
};

const updateAgentTargets = async (agentId) => {
    const target = (await AppDataStore.query('agent_targets', { agent_id: agentId }))[0];
    const content = `
<div class="form-group" style="margin-bottom:15px;">
            <label>Monthly Sales target (RM)</label>
            <input type="number" id="target-sales" class="form-control" value="${target?.target_amount || 50000}">
        </div>
        <div class="form-group" style="margin-bottom:15px;">
            <label>Monthly CPS Target</label>
            <input type="number" id="target-cps" class="form-control" value="${target?.target_cps || 20}">
        </div>
        <div class="form-group">
            <label>Monthly Meetings Target</label>
            <input type="number" id="target-meetings" class="form-control" value="${target?.target_meetings || 40}">
        </div>
`;
    UI.showModal('Update Agent Targets', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Save Targets', type: 'primary', action: `(async () => { await app.saveAgentTargets(${agentId}); })()` }
    ]);
};

const saveAgentTargets = async (agentId) => {
    const target = (await AppDataStore.query('agent_targets', { agent_id: agentId }))[0];
    const data = {
        target_amount: parseInt(document.getElementById('target-sales').value),
        target_cps: parseInt(document.getElementById('target-cps').value),
        target_meetings: parseInt(document.getElementById('target-meetings').value)
    };
    if (target) {
        await AppDataStore.update('agent_targets', target.id, data);
    } else {
        data.agent_id = agentId;
        data.current_amount = 0;
        data.current_cps = 0;
        data.current_meetings = 0;
        await AppDataStore.create('agent_targets', data);
    }
    UI.hideModal();
    UI.toast.success('Agent targets updated');
    await showAgentDetail(agentId);
};

  


const deactivateAgent = async (agentId) => {
UI.confirm('Deactivate Agent?', 'This will prevent the agent from logging in. You should reassign their active prospects first.', async () => {
    await AppDataStore.update('users', agentId, { status: 'inactive' });
    UI.toast.success('Agent deactivated');
    const main = document.getElementById('main-content');
    if (main) await showAgentsView(main);
});
};


const resetAgentPassword = async (agentId) => {
    const agent = await AppDataStore.getById('users', agentId);
    if (!agent) return;
    const newPassword = generatePassword();
    UI.confirm(
        'Reset Password',
        `Generate a new temporary password for <strong>${escapeHtml(agent.full_name)}</strong>? They will need to change it on next login.`,
        async () => {
            try {
                await AppDataStore.update('users', agentId, { password: newPassword });
                // Update the Supabase Auth password via the admin-auth-ops
                // Edge Function. Without this, the DB's password column
                // changes but the actual login password does not — so
                // surface failures loudly rather than swallowing them.
                let authOk = false;
                if (agent.email) {
                    try {
                        const { data: res, error } = await window.supabase.functions.invoke('admin-auth-ops', {
                            body: { op: 'reset-password', email: agent.email, new_password: newPassword },
                        });
                        authOk = !error && res && res.ok !== false;
                        if (!authOk) {
                            UI.toast.error('Auth password update failed: ' + (error?.message || res?.error || 'unknown'));
                        }
                    } catch (e) {
                        UI.toast.error('Auth password update errored: ' + (e?.message || e));
                    }
                }
                UI.showModal('Password Reset', `
                    <p style="margin-bottom:12px;">New temporary password for <strong>${escapeHtml(agent.full_name)}</strong>:</p>
                    <div style="background:var(--gray-100);padding:12px 16px;border-radius:8px;font-family:monospace;font-size:18px;letter-spacing:2px;text-align:center;">${newPassword}</div>
                    <p style="margin-top:12px;color:var(--gray-500);font-size:13px;">Share this with the agent securely. It is shown only once.</p>
                `, [{ label: 'Done', type: 'primary', action: 'UI.hideModal()' }]);
            } catch (err) {
                UI.toast.error('Failed to reset password: ' + err.message);
            }
        }
    );
};

const assignProspectToAgent = async (prospectId, agentId) => {
    // Legacy entry — historically used by the agent-deactivation cascade.
    // Routed through cascadeProspectReassign so all writes go through the
    // single audited path, hit the reassignment_history audit table, and
    // respect rollback semantics. No confirmation popup here because the
    // caller (deactivation flow) already gates this action.
    try {
        const earliest = '1970-01-01'; // capture all activity dates
        await cascadeProspectReassign(prospectId, agentId, {
            reason: 'system_reassign',
            reasonNotes: 'Programmatic reassign (assignProspectToAgent)',
            cascadeCustomer: true,
            cascadeActivitiesAfter: earliest
        });
        UI.toast.success('Prospect reassigned');
        await app.showProspectDetail(prospectId);
    } catch (err) {
        UI.toast.error('Reassignment failed: ' + err.message);
    }
};

const sendRenewalReminder = (agentId) => {

    UI.toast.success('Renewal reminder sent via Email/WhatsApp.');
};

const viewInactiveProspects = (agentId) => {
    UI.toast.info('Opening inactive prospects list...');
};

    // Attach to window.app
    Object.assign(window.app, {
        sortProspects,
        showProspectsView,
        switchCustomerTab,
        showCustomersView,
        renderCustomersTable,
        customerPageNav,
        filterCustomers,
        renderApprovalQueue,
        showApprovalDetail,
        approveQueueEntry,
        rejectQueueEntry,
        confirmRejectQueueEntry,
        _downloadSheet,
        _confirmLargeExport,
        _getAllProspectsForExport,
        _getAllActivitiesForExport,
        exportData,
        renderProspectsTable,
        prospectPageNav,
        deleteProspect,
        confirmDeleteProspect,
        getScoreGrade,
        openProspectGradePicker,
        setProspectGrade,
        calculateProtectionDays,
        getProtectionStatus,
        calculateDaysLeft,
        timeAgo,
        getAvatarColor,
        getInitials,
        toggleProspectView,
        renderProspectCards,
        toggleProspectSelect,
        toggleProspectSelectAll,
        updateProspectBulkBar,
        clearProspectSelection,
        bulkDeleteProspects,
        bulkReassignProspects,
        confirmBulkReassign,
        executeConfirmedBulkReassign,
        toggleProspectFilters,
        updateProspectFilterBadge,
        sortProspectsBySelect,
        openProspectModal,
        showFieldError,
        saveProspect,
        filterProspects,
        showCustomerDetail,
        switchProfileTab,
        switchCustomerProfileTab,
        renderBasicBankTab,
        renderPlatformIdsTab,
        openUploadRedemptionImageModal,
        saveRedemptionImage,
        openUploadDocumentModal,
        saveDocument,
        copyToClipboard,
        renderPurchaseHistoryTab,
        renderReferralsTab,
        openCustomerReferralModal,
        saveCustomerReferral,
        viewReferralDetail,
        editReferral,
        saveEditReferral,
        openEditPlatformIdsModal,
        savePlatformIds,
        uploadPaymentProof,
        savePaymentProof,
        renderEventHistory,
        renderAgentEligibility,
        renderCustomerActivityTab,
        renderCustomerTags,
        zoomCpsPhoto,
        showProspectDetail,
        switchProspectTab,
        _refreshCustClosingAfterProspectSave,
        renderCustomerClosingTab,
        toggleAccordion,
        toggleCustomerAccordion,
        editProspect,
        downloadProspectVCard,
        addNote,
        showPhotoUrlsMigrationModal,
        checkPhotoUrlsColumn,
        attachActivityPhoto,
        viewActivityPhotos,
        compressImageFile,
        saveActivityPhoto,
        removeActivityPhoto,
        attachAppraisalForm,
        saveAppraisalForm,
        removeAppraisalForm,
        uploadAPUForm,
        saveAPUForm,
        removeAPUForm,
        recordSalesClosure,
        toggleNextAction,
        toggleNextActionItem,
        gatherClosingFormData,
        addPrePurchaseRow,
        addPrePurchaseAttachment,
        deletePrePurchaseRecord,
        _productPurchaseKey,
        _readProductPurchases,
        _writeProductPurchases,
        _refreshProductPurchaseTab,
        _computeFinishDate,
        _triggerRefillRpc,
        addProductPurchaseRow,
        addProductPurchaseAttachment,
        deleteProductPurchaseRecord,
        _readFengShuiAudits,
        _writeFengShuiAudits,
        _refreshFengShuiTab,
        _uploadFengShuiToBucket,
        openFengShuiAuditModal,
        saveFengShuiAudit,
        deleteFengShuiAudit,
        uploadFengShuiFile,
        removeFengShuiFile,
        uploadFengShuiPhotos,
        removeFengShuiPhoto,
        updateFengShuiPhotoRemark,
        openFengShuiPhotosModal,
        openFengShuiSitePhotosModal,
        addFengShuiSiteReview,
        updateFengShuiSiteReviewField,
        uploadFengShuiSitePhotos,
        removeFengShuiSitePhoto,
        removeFengShuiSiteReview,
        _mirrorCrToActivity,
        saveClosingRecord,
        submitClosingRecord,
        uploadHistoryInvoice,
        saveClosingHistoryEntry,
        saveClosingDeliveryStatus,
        archiveAndNewClosingRecord,
        showPurchasesHistoryView,
        _loadPurchasesHistory,
        _renderPurchasesHistory,
        phSetFilter,
        phSetPage,
        refreshPurchasesHistory,
        savePurchasesHistoryRow,
        approveClosingRecord,
        rejectClosingRecord,
        openAddCustomerModal,
        saveCustomer,
        openAddPurchaseModal,
        savePurchase,
        _setDelivery,
        updatePurchaseDelivery,
        updateConversionDelivery,
        openRecruitModal,
        confirmDelete,
        executeDelete,
        calculateAge,
        openAddTagModal,
        addTagToEntity,
        removeTagFromCustomer,
        removeTagFromProspect,
        saveSolution,
        openEditSolutionModal,
        saveSolutionEdit,
        deleteSolution,
        confirmConvertToCustomer,
        extendProtection,
        transferProspect,
        reassignProspect,
        openReviveProspectModal,
        saveReviveProspect,
        convertToCustomer,
        requestProspectConversion,
        showConversionApprovalModal,
        approveProspectConversion,
        rejectProspectConversion,
        showAgentsView,
        renderAgentsTable,
        calculateDaysDiff,
        renderFollowupStats,
        renderCurrentAssignments,
        renderPerformanceTargets,
        renderCustomerHistory,
        showAgentDetail,
        renewLicense,
        executeRenewal,
        generatePassword,
        openAddAgentModal,
        openEditAgentModal,
        saveAgent,
        openAssignUplineModal,
        saveUplineAssignment,
        showForcePasswordChangeModal,
        submitForcePasswordChange,
        selfChangePassword,
        saveSelfPreferredName,
        showSettingsView,
        _loadPhoneDupes,
        _loadEmailDupes,
        _renderDupeGroup,
        _renderPhoneDupesBody,
        showPhoneDupesModal,
        refreshPhoneDupes,
        dedupeClearEmail,
        dedupeEditPhone,
        dedupeClearPhone,
        dedupeDeleteProspect,
        verifyAndPreparePhoneConstraint,
        refreshPushNotificationStatus,
        enablePushNotifications,
        disablePushNotifications,
        sendTestPushNotification,
        loadNotificationPreferences,
        saveNotificationPreferences,
        onReminderCheckboxChange,
        openResetPasswordModal,
        executePasswordReset,
        deleteAgent,
        confirmDeleteAgent,
        updateAgentTargets,
        saveAgentTargets,
        resetAgentPassword,
        assignProspectToAgent,
        sendRenewalReminder,
        viewInactiveProspects,
        EXPORT_WARN_THRESHOLD,
        EXPORT_HARD_LIMIT,
        // Previously missing from export list (caught by audit 2026-06-06):
        deleteNote,
        showAgentProfile,
        deactivateAgent,
        openAddSolutionModal,
    });
})();