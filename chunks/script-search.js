/**
 * CRM Lazy Chunk: Advanced Search + Filter Panel
 * Covers: toggleSearchPanel, showSearchPanel, filter renderers (agent/prospect/
 *   activity/transaction/event/product/formula), condition groups, executeSearch,
 *   performProspectSearch/CustomerSearch/ActivitySearch, pagination, saved searches,
 *   search history, export results.
 * Loaded on-demand when user first opens the search panel.
 * Extracted 2026-06-05 (~1725 lines).
 */
(() => {
    const _state = window._appState;
    const _utils = window._crmUtils;
    const esc    = (...a) => _utils.escapeHtml(...a);
    const escapeHtml = esc;
    const getVisibleUserIds = (u) => _utils.getVisibleUserIds(u);
    const isSystemAdmin        = (u) => _utils.isSystemAdmin(u || _state.cu);
    const isMarketingManager   = (u) => _utils.isMarketingManager(u || _state.cu);
    const isAgent              = (u) => _utils.isAgent(u || _state.cu);
    const isManagement         = (u) => _utils.isManagement(u || _state.cu);
    const isTeamLeaderOrAbove  = (u) => _utils.isTeamLeaderOrAbove(u || _state.cu);
    const _getUserLevel        = (u) => _utils.getUserLevel(u);
    const getAgentsAndLeaders  = () => _utils.getAgentsAndLeaders();
    const getVisibleProspects  = (...a) => _utils.getVisibleProspects(...a);
    const getVisibleCustomers  = (...a) => _utils.getVisibleCustomers(...a);
    const getVisibleActivities = (...a) => _utils.getVisibleActivities(...a);
    const navigateTo           = (v) => window.app.navigateTo(v);
    // Live user reference
    let _currentUser = _state.cu;
    window._syncSearchUser = () => { _currentUser = _state.cu; };
    // Chunk-local search state (mirrors IIFE vars)
    let _searchPanelVisible = false;
    let _currentSearchEntity = 'prospects';
    let _conditionGroups = [{ logic: 'AND', conditions: [{ field: 'name', op: 'contains', value: '' }] }];
    let _savedSearches = [];
    let _searchHistory = [];
    let _currentSearchResults = [];
    let _currentPage = 1;
    let _pageSize = 10;
    let _totalResults = 0;
    let _currentSelectedPerson = null;

    // React-island flag — DEFAULT-ON (parity-verified live, SW-87). Kill-switch:
    // window.__REACT_SEARCH=false | ?react_search=0 | localStorage crm_react_search
    // ='0' (plus the global ?react=0 / crm_react_off='1').
    const _reactSearchOn = () => {
        try {
            if (/[?&]react=0/.test(location.search)) return false;
            if (localStorage.getItem('crm_react_off') === '1') return false;
            if (!(window.CRMReact && typeof window.CRMReact.mountSearchPanel === 'function')) return false;
            if (window.__REACT_SEARCH === false) return false;
            if (/[?&]react_search=0/.test(location.search)) return false;
            if (localStorage.getItem('crm_react_search') === '0') return false;
            return true;
        } catch (_) { return false; }
    };

// Ensure referrals have the new fields (id, referrer_id, referrer_type, referred_prospect_id)
const ensureReferralFields = async () => {
    const referrals = await AppDataStore.getAll('referrals');
    for (const r of referrals) {
        let needsUpdate = false;
        const updates = {};
        if (r.referrer_customer_id && !r.referrer_id) {
            // Old format: convert
            updates.referrer_id = r.referrer_customer_id;
            updates.referrer_type = 'customer';
            needsUpdate = true;
        }
        if (!r.referrer_id && !updates.referrer_id) {
            updates.referrer_id = null;
            updates.referrer_type = null;
        }
        if (!r.created_at) {
            updates.created_at = r.date || new Date().toISOString();
            needsUpdate = true;
        }
        if (needsUpdate) {
            // Persist via Supabase — data.js handles localStorage cache update automatically
            await AppDataStore.update('referrals', r.id, updates).catch(() => {});
        }
    }
};

const ENTITY_FIELDS = {
    agents: [
        { value: 'full_name', label: 'Name', type: 'text' },
        { value: 'agent_code', label: 'Agent Code', type: 'text' },
        { value: 'team', label: 'Team', type: 'select', options: Array.from({length: 26}, (_, i) => 'Team ' + String.fromCharCode(65 + i)) },
        { value: 'status', label: 'Status', type: 'select', options: ['active', 'probation', 'inactive'] },
        { value: 'email', label: 'Email', type: 'text' },
        { value: 'join_date', label: 'Join Date', type: 'date' }
    ],
    prospects: [
        { value: 'full_name', label: 'Name', type: 'text' },
        { value: 'phone', label: 'Phone', type: 'text' },
        { value: 'email', label: 'Email', type: 'text' },
        { value: 'ming_gua', label: 'Ming Gua', type: 'select', options: ['MG1', 'MG2', 'MG3', 'MG4', 'MG5', 'MG6', 'MG7', 'MG8', 'MG9'] },
        { value: 'score', label: 'Score', type: 'number' },
        { value: 'status', label: 'Status', type: 'select', options: ['active', 'converted', 'lost'] },
        { value: 'responsible_agent_id', label: 'Agent', type: 'select', options: 'dynamic' },
        { value: 'has_purchased_product', label: 'Has Purchased', type: 'product' }, // Special type
        { value: 'has_not_purchased_product', label: 'Has Not Purchased', type: 'product' } // Special type
    ],
    customers: [
        { value: 'full_name', label: 'Name', type: 'text' },
        { value: 'phone', label: 'Phone', type: 'text' },
        { value: 'email', label: 'Email', type: 'text' },
        { value: 'lifetime_value', label: 'Lifetime Value', type: 'number' },
        { value: 'customer_since', label: 'Customer Since', type: 'date' },
        { value: 'ming_gua', label: 'Ming Gua', type: 'select', options: ['MG1', 'MG2', 'MG3', 'MG4', 'MG5', 'MG6', 'MG7', 'MG8', 'MG9'] }
    ],
    activities: [
        { value: 'activity_type', label: 'Type', type: 'select', options: ['CPS', 'FTF', 'FSA', 'EVENT', 'CALL', 'EMAIL', 'WHATSAPP'] },
        { value: 'activity_title', label: 'Title', type: 'text' },
        { value: 'activity_date', label: 'Date', type: 'date' },
        { value: 'lead_agent_id', label: 'Agent', type: 'select', options: 'dynamic' },
        { value: 'prospect_id', label: 'Prospect', type: 'select', options: 'dynamic' },
        { value: 'status', label: 'Status', type: 'select', options: ['scheduled', 'completed', 'cancelled'] }
    ],
    transactions: [
        { value: 'date', label: 'Date', type: 'date' },
        { value: 'invoice', label: 'Invoice', type: 'text' },
        { value: 'item', label: 'Product', type: 'text' },
        { value: 'amount', label: 'Amount', type: 'number' },
        { value: 'status', label: 'Status', type: 'select', options: ['PENDING', 'COMPLETED', 'COLLECTED'] },
        { value: 'payment_method', label: 'Payment Method', type: 'select', options: ['Cash', 'Credit Card', 'Bank Transfer', 'EPP', 'POP'] },
        { value: 'customer_id', label: 'Customer', type: 'select', options: 'dynamic' }
    ],
    events: [
        { value: 'event_title', label: 'Title', type: 'text' },
        { value: 'event_date', label: 'Date', type: 'date' },
        { value: 'event_category_id', label: 'Category', type: 'select', options: 'dynamic' },
        { value: 'location', label: 'Location', type: 'text' },
        { value: 'status', label: 'Status', type: 'select', options: ['upcoming', 'ongoing', 'completed', 'cancelled'] }
    ],
    products: [
        { value: 'name', label: 'Name', type: 'text' },
        { value: 'category', label: 'Category', type: 'text' },
        { value: 'price', label: 'Price', type: 'number' },
        { value: 'is_active', label: 'Status', type: 'select', options: ['true', 'false'] }
    ],
    bujishu: [
        { value: 'name', label: 'Name', type: 'text' },
        { value: 'category', label: 'Category', type: 'text' },
        { value: 'price', label: 'Price', type: 'number' },
        { value: 'is_active', label: 'Status', type: 'select', options: ['true', 'false'] }
    ],
    formula: [
        { value: 'name', label: 'Name', type: 'text' },
        { value: 'category', label: 'Category', type: 'text' },
        { value: 'price', label: 'Price', type: 'number' },
        { value: 'daily_dosage', label: 'Daily Dosage', type: 'number' },
        { value: 'is_active', label: 'Status', type: 'select', options: ['true', 'false'] }
    ]
};


// Section 10.4: Search Panel Toggle
const toggleSearchPanel = async () => {
    _searchPanelVisible = !_searchPanelVisible;
    if (_searchPanelVisible) {
        await showSearchPanel();
    } else {
        hideSearchPanel();
    }
};

const buildSearchPanelHTML = () => {
    return `
        <div class="search-panel-overlay" id="search-panel-overlay" onclick="app.hideSearchPanel()"></div>
        <div class="search-panel" id="search-panel">
            <div class="search-panel-header">
                <h2>Search</h2>
                <button class="close-btn" onclick="app.hideSearchPanel()">&times;</button>
            </div>

            <div class="filter-sections" id="filter-sections">
                <!-- Dynamic filters will be rendered here -->
            </div>

            <details id="search-advanced-options" style="margin-top:4px;">
                <summary style="cursor:pointer; font-weight:600; color:#8B0000; padding:10px 0; list-style:none; display:flex; align-items:center; gap:6px; user-select:none;">
                    <i class="fas fa-sliders-h"></i> Advanced Options
                </summary>

                <div class="search-presets">
                    <h3>Quick Presets</h3>
                    <div class="preset-buttons">
                        <button class="preset-btn" onclick="(async()=>{try{await app.loadPreset('agent-monthly');}catch(e){console.error(e);}})()">Agent Monthly Report</button>
                        <button class="preset-btn" onclick="(async()=>{try{await app.loadPreset('high-score');}catch(e){console.error(e);}})()">High Score Prospects</button>
                        <button class="preset-btn" onclick="(async()=>{try{await app.loadPreset('recent-activities');}catch(e){console.error(e);}})()">Recent Activities</button>
                        <button class="preset-btn" onclick="(async()=>{try{await app.loadPreset('cai-ku-not-purchased');}catch(e){console.error(e);}})()">CAI KU Painting Not Purchased</button>
                    </div>
                </div>

                <div class="search-entity-selector">
                    <label>Search in:</label>
                    <select id="search-entity" onchange="(async()=>{try{await app.updateFilterSections();}catch(e){console.error(e);}})()">
                        <option value="agents">Agents</option>
                        <option value="prospects" selected>Prospects</option>
                        <option value="customers">Customers</option>
                        <option value="activities">Activities</option>
                        <option value="transactions">Transactions</option>
                        <option value="events">Events</option>
                        <option value="products">Products</option>
                        <option value="bujishu">Bujishu</option>
                        <option value="formula">Formula</option>
                    </select>
                </div>

                <div class="date-range-filter">
                    <h3>Date Range</h3>
                    <div class="date-range-group">
                        <input type="date" id="search-date-from" class="form-control" placeholder="From">
                        <span>to</span>
                        <input type="date" id="search-date-to" class="form-control" placeholder="To">
                    </div>
                </div>

                <div id="extra-filter-sections">
                    <!-- Extra dynamic filters will be rendered here -->
                </div>

                <div class="condition-builder" id="condition-builder">
                    <h3>Advanced Conditions</h3>
                    <div id="condition-groups">
                        <!-- Condition groups rendered here -->
                    </div>
                    <button class="btn secondary btn-sm" onclick="app.addConditionGroup()">
                        <i class="fas fa-plus"></i> Add Condition Group
                    </button>
                    <div class="condition-logic-toggle">
                        <label>Group Logic:</label>
                        <select id="group-logic" onchange="app.updateGroupLogic(0, this.value)">
                            <option value="AND">AND</option>
                            <option value="OR">OR</option>
                        </select>
                    </div>
                </div>

                <div style="display:flex; gap:8px; margin:8px 0; flex-wrap:wrap;">
                    <button class="btn secondary" onclick="(async()=>{try{await app.openSaveSearchModal();}catch(e){console.error(e);}})()">
                        <i class="fas fa-save"></i> Save Search
                    </button>
                    <button class="btn secondary" onclick="app.exportResults('csv')">
                        <i class="fas fa-download"></i> Export
                    </button>
                </div>

                <div class="saved-searches">
                    <h3>Saved Searches</h3>
                    <div id="saved-searches-list">
                        <!-- Saved searches will be rendered here -->
                    </div>
                </div>

                <div class="search-history">
                    <h3>Recent Searches</h3>
                    <div id="search-history-list">
                        <!-- Search history will be rendered here -->
                    </div>
                </div>
            </details>

            <div class="search-actions">
                <button class="btn primary" onclick="(async()=>{try{await app.executeSearch();}catch(e){console.error(e);}})()">
                    <i class="fas fa-search"></i> Apply Filters
                </button>
                <button class="btn secondary" onclick="app.clearAllFilters()">
                    <i class="fas fa-times"></i> Clear All
                </button>
            </div>

            <div class="search-results" id="search-results">
                <!-- Results will be rendered here -->
            </div>

            <div class="pagination" id="search-pagination">
                <!-- Pagination will be rendered here -->
            </div>
        </div>
    `;
};

const showSearchPanel = async () => {
    const viewport = document.getElementById('content-viewport');

    // Create overlay and panel
    const searchHTML = buildSearchPanelHTML();

    if (!viewport) return;

    if (_reactSearchOn()) {
        // Scaffold-shell: React renders the drawer shell (overlay + panel chrome
        // + stable-id containers) into a host div; the chunk fills the containers
        // (filter sections / condition groups / saved searches) after the island
        // signals onReady. The overlay/panel are position:fixed so the wrapping
        // host div doesn't affect layout.
        let host = document.getElementById('search-panel-react-host');
        if (host) { try { window.CRMReact.unmountSearchPanel(); } catch (_) {} host.remove(); }
        host = document.createElement('div');
        host.id = 'search-panel-react-host';
        viewport.insertAdjacentElement('beforebegin', host);
        try {
            let _sReady; const _sReadyP = new Promise(res => { _sReady = res; });
            const _sGuard = setTimeout(() => _sReady(), 4000);
            window.CRMReact.mountSearchPanel(host, {
                onReady: () => { clearTimeout(_sGuard); _sReady(); },
            });
            await _sReadyP;
            await renderSavedSearches();
            await updateFilterSections();
            renderConditionGroups();
            return;
        } catch (e) {
            console.warn('[search] island mount failed, falling back to legacy:', e && e.message);
            try { window.CRMReact.unmountSearchPanel(); } catch (_) {}
            host.remove();
            // fall through to the legacy insert below
        }
    }

    // Insert panel before the main content (legacy / fallback)
    viewport.insertAdjacentHTML('beforebegin', searchHTML);

    // Load saved searches
    await renderSavedSearches();

    // Initial filter render
    await updateFilterSections();

    // Render condition groups
    renderConditionGroups();
};

const hideSearchPanel = () => {
    // React path: unmount the island + remove its host.
    const host = document.getElementById('search-panel-react-host');
    if (host) {
        try { window.CRMReact && window.CRMReact.unmountSearchPanel && window.CRMReact.unmountSearchPanel(); } catch (_) {}
        host.remove();
    }
    // Legacy path (also clears any stray nodes).
    const overlay = document.getElementById('search-panel-overlay');
    const panel = document.getElementById('search-panel');
    if (overlay) overlay.remove();
    if (panel) panel.remove();
    _searchPanelVisible = false;
};

// Section 10.5: Dynamic Filter Rendering
const updateFilterSections = async () => {
    const entity = document.getElementById('search-entity')?.value || 'prospects';
    _currentSearchEntity = entity;

    const container = document.getElementById('filter-sections');
    const extraContainer = document.getElementById('extra-filter-sections');
    if (!container) return;

    let basicHtml = '';
    let extraHtml = '';

    switch (entity) {
        case 'agents':
            basicHtml = renderAgentFilters();
            break;
        case 'prospects': {
            const r = await renderProspectCustomerFilters();
            basicHtml = r.basic;
            extraHtml = r.extra;
            break;
        }
        case 'customers': {
            const r = await renderProspectCustomerFilters(true);
            basicHtml = r.basic;
            extraHtml = r.extra;
            break;
        }
        case 'activities':
            basicHtml = renderActivityFilters();
            break;
        case 'transactions':
            basicHtml = renderTransactionFilters();
            break;
        case 'events':
            basicHtml = renderEventFilters();
            break;
        case 'products':
            basicHtml = renderProductFilters();
            break;
        case 'bujishu':
            basicHtml = renderBujishuFilters();
            break;
        case 'formula':
            basicHtml = renderFormulaFilters();
            break;
    }

    container.innerHTML = basicHtml;
    if (extraContainer) extraContainer.innerHTML = extraHtml;

    // Populate dynamic agent dropdowns — only show agents visible to the current user
    // (admins see all; managers/agents see only their own downline team)
    const agentSelects = [...container.querySelectorAll('select[id$="-agent"]'), ...container.querySelectorAll('select[id$="-responsible-agent"]')];
    if (agentSelects.length > 0) {
        try {
            const allUsers = await AppDataStore.getAll('users');
            const visibleIds = await getVisibleUserIds(_currentUser);
            const agents = allUsers.filter(u => {
                if (!(isAgent(u) || u.role === 'team_leader' || u.role?.includes('Level 7'))) return false;
                if (visibleIds === 'all') return true;
                return visibleIds.includes(u.id);
            });
            agentSelects.forEach(sel => {
                agents.forEach(a => {
                    const opt = document.createElement('option');
                    opt.value = a.id;
                    opt.textContent = a.full_name;
                    sel.appendChild(opt);
                });
            });
        } catch(e) { /* offline */ }
    }

    // Update condition builder options
    renderConditionGroups();
};

const renderAgentFilters = () => {
    return `
        <div class="filter-row">
            <div class="filter-group">
                <label>Name</label>
                <input type="text" id="filter-agent-name" class="form-control" placeholder="Agent name...">
            </div>
            <div class="filter-group">
                <label>Team</label>
                <select id="filter-agent-team" class="form-control">
                    <option value="">All Teams</option>
                    ${Array.from({length: 26}, (_, i) => String.fromCharCode(65 + i)).map(L => `<option value="Team ${L}">Team ${L}</option>`).join('')}
                </select>
            </div>
        </div>
        <div class="filter-row">
            <div class="filter-group">
                <label>Status</label>
                <select id="filter-agent-status" class="form-control">
                    <option value="">All Status</option>
                    <option value="active">Active</option>
                    <option value="probation">Probation</option>
                    <option value="inactive">Inactive</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Agent Code</label>
                <input type="text" id="filter-agent-code" class="form-control" placeholder="e.g., AGN-2026-001">
            </div>
        </div>
        <div class="filter-row">
            <div class="filter-group">
                <label>Email</label>
                <input type="text" id="filter-agent-email" class="form-control" placeholder="Email...">
            </div>
        </div>
    `;
};

const renderProspectCustomerFilters = async (isCustomer = false) => {
    const type = isCustomer ? 'customer' : 'prospect';
    const products = (await AppDataStore.getAll('products')).filter(p => p.is_active !== false);

    const basic = `
        <div class="filter-row">
            <div class="filter-group">
                <label>Name</label>
                <input type="text" id="filter-${type}-name" class="form-control" placeholder="Full name...">
            </div>
            <div class="filter-group">
                <label>Ming Gua</label>
                <select id="filter-${type}-minggua" class="form-control">
                    <option value="">All</option>
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
            </div>
        </div>
    `;

    const extra = `
        <div class="filter-row">
            <div class="filter-group">
                <label>Phone</label>
                <input type="text" id="filter-${type}-phone" class="form-control" placeholder="Phone number...">
            </div>
            <div class="filter-group">
                <label>Email</label>
                <input type="text" id="filter-${type}-email" class="form-control" placeholder="Email...">
            </div>
        </div>
        <div class="filter-row">
            <div class="filter-group">
                <label>Score (Min)</label>
                <input type="number" id="filter-${type}-score-min" class="form-control" placeholder="Min score...">
            </div>
            <div class="filter-group">
                <label>Score (Max)</label>
                <input type="number" id="filter-${type}-score-max" class="form-control" placeholder="Max score...">
            </div>
        </div>
        <div class="filter-row">
            <div class="filter-group">
                <label>Status</label>
                <select id="filter-${type}-status" class="form-control">
                    <option value="">All</option>
                    ${isCustomer ? `
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    ` : `
                    <option value="active">Active</option>
                    <option value="converted">Converted</option>
                    <option value="lost">Lost</option>
                    `}
                </select>
            </div>
            <div class="filter-group">
                <label>Responsible Agent</label>
                <select id="filter-${type}-agent" class="form-control">
                    <option value="">All Agents</option>
                </select>
            </div>
        </div>
        ${!isCustomer ? `
        <div class="filter-row">
            <div class="filter-group">
                <label>Pipeline Stage</label>
                <select id="filter-prospect-pipeline" class="form-control">
                    <option value="">All Stages</option>
                    <option value="new">New</option>
                    <option value="contacted">Contacted</option>
                    <option value="qualified">Qualified</option>
                    <option value="proposal">Proposal</option>
                    <option value="negotiation">Negotiation</option>
                    <option value="closed_won">Closed Won</option>
                    <option value="closed_lost">Closed Lost</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Deal Value Range (RM)</label>
                <div style="display:flex; gap:8px;">
                    <input type="number" id="filter-prospect-deal-min" class="form-control" placeholder="Min">
                    <input type="number" id="filter-prospect-deal-max" class="form-control" placeholder="Max">
                </div>
            </div>
        </div>
        <div class="filter-row">
            <div class="filter-group">
                <label>Has Purchased</label>
                <select id="filter-prospect-has-purchased" class="form-control">
                    <option value="">Select Product</option>
                    ${products.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('')}
                </select>
            </div>
            <div class="filter-group">
                <label>Has Not Purchased</label>
                <select id="filter-prospect-not-purchased" class="form-control">
                    <option value="">Select Product</option>
                    ${products.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('')}
                </select>
            </div>
        </div>
        ` : `
        <div class="filter-row">
            <div class="filter-group">
                <label>Lifetime Value Min (RM)</label>
                <input type="number" id="filter-customer-ltv-min" class="form-control" placeholder="Min...">
            </div>
            <div class="filter-group">
                <label>Lifetime Value Max (RM)</label>
                <input type="number" id="filter-customer-ltv-max" class="form-control" placeholder="Max...">
            </div>
        </div>
        `}
        <div class="filter-row">
            <div class="filter-group">
                <label>Gender</label>
                <select id="filter-${type}-gender" class="form-control">
                    <option value="">All</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Occupation</label>
                <input type="text" id="filter-${type}-occupation" class="form-control" placeholder="Occupation...">
            </div>
        </div>
        <div class="filter-row">
            <div class="filter-group">
                <label>Income Range</label>
                <select id="filter-${type}-income" class="form-control">
                    <option value="">All</option>
                    <option value="Below RM3,000">Below RM3,000</option>
                    <option value="RM3,000 - RM5,000">RM3,000 - RM5,000</option>
                    <option value="RM5,000 - RM10,000">RM5,000 - RM10,000</option>
                    <option value="RM10,000 - RM20,000">RM10,000 - RM20,000</option>
                    <option value="Above RM20,000">Above RM20,000</option>
                </select>
            </div>
            <div class="filter-group">
                <label>City</label>
                <input type="text" id="filter-${type}-city" class="form-control" placeholder="City...">
            </div>
        </div>
        <div class="filter-row">
            <div class="filter-group">
                <label>State</label>
                <select id="filter-${type}-state" class="form-control">
                    <option value="">All States</option>
                    <option value="Johor">Johor</option>
                    <option value="Kedah">Kedah</option>
                    <option value="Kelantan">Kelantan</option>
                    <option value="Kuala Lumpur">Kuala Lumpur</option>
                    <option value="Labuan">Labuan</option>
                    <option value="Melaka">Melaka</option>
                    <option value="Negeri Sembilan">Negeri Sembilan</option>
                    <option value="Pahang">Pahang</option>
                    <option value="Penang">Penang</option>
                    <option value="Perak">Perak</option>
                    <option value="Perlis">Perlis</option>
                    <option value="Putrajaya">Putrajaya</option>
                    <option value="Sabah">Sabah</option>
                    <option value="Sarawak">Sarawak</option>
                    <option value="Selangor">Selangor</option>
                    <option value="Terengganu">Terengganu</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Referred By</label>
                <input type="text" id="filter-${type}-referred" class="form-control" placeholder="Referrer name...">
            </div>
        </div>
        <div class="filter-row">
            <div class="filter-group">
                <label>Tags (Select multiple)</label>
                <select id="filter-${type}-tags" class="form-control" multiple style="height: 80px;">
                    <option value="Career Focused">Career Focused</option>
                    <option value="High Score">High Score</option>
                    <option value="VIP">VIP</option>
                    <option value="Urgent">Urgent</option>
                    <option value="Follow-up">Follow-up</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Needs (Select multiple)</label>
                <select id="filter-${type}-needs" class="form-control" multiple style="height: 80px;">
                    <option value="Career">Career</option>
                    <option value="Financial">Financial</option>
                    <option value="Relationship">Relationship</option>
                    <option value="Health">Health</option>
                    <option value="Wealth">Wealth</option>
                </select>
            </div>
        </div>
        <div class="filter-row">
            <div class="filter-group">
                <label>Keyword Search</label>
                <input type="text" id="filter-${type}-keyword" class="form-control" placeholder="Search across fields...">
            </div>
            <div class="filter-group">
                <label>Age Range</label>
                <div style="display:flex; gap:10px;">
                    <input type="number" id="filter-${type}-age-min" class="form-control" placeholder="Min (0)" min="0" max="100">
                    <input type="number" id="filter-${type}-age-max" class="form-control" placeholder="Max (100)" min="0" max="100">
                </div>
            </div>
        </div>
    `;

    return { basic, extra };
};

const renderActivityFilters = () => {
    return `
        <div class="filter-row">
            <div class="filter-group">
                <label>Activity Type</label>
                <select id="filter-activity-type" class="form-control" onchange="document.getElementById('event-attendance-row').style.display = this.value === 'EVENT' ? '' : 'none'">
                    <option value="">All Types</option>
                    <option value="CPS">CPS</option>
                    <option value="FTF">FTF</option>
                    <option value="FSA">FSA</option>
                    <option value="EVENT">Event</option>
                    <option value="CALL">Call</option>
                    <option value="EMAIL">Email</option>
                    <option value="WHATSAPP">WhatsApp</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Title</label>
                <input type="text" id="filter-activity-title" class="form-control" placeholder="Activity title...">
            </div>
        </div>
        <div class="filter-row">
            <div class="filter-group">
                <label>Agent</label>
                <select id="filter-activity-agent" class="form-control">
                    <option value="">All Agents</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Status</label>
                <select id="filter-activity-status" class="form-control">
                    <option value="">All</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                </select>
            </div>
        </div>
        <div class="filter-row" id="event-attendance-row" style="display:none;">
            <div class="filter-group">
                <label>Attendance</label>
                <select id="filter-activity-attendance" class="form-control">
                    <option value="">All</option>
                    <option value="Attended">Attended</option>
                    <option value="No Show">No Show</option>
                    <option value="Registered">Registered only</option>
                </select>
            </div>
        </div>
    `;
};

const renderTransactionFilters = () => {
    return `
        <div class="filter-row">
            <div class="filter-group">
                <label>Product</label>
                <input type="text" id="filter-transaction-product" class="form-control" placeholder="Product name...">
            </div>
            <div class="filter-group">
                <label>Invoice</label>
                <input type="text" id="filter-transaction-invoice" class="form-control" placeholder="Invoice number...">
            </div>
        </div>
        <div class="filter-row">
            <div class="filter-group">
                <label>Payment Method</label>
                <select id="filter-transaction-payment" class="form-control">
                    <option value="">All</option>
                    <option value="Cash">Cash</option>
                    <option value="Credit Card">Credit Card</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="EPP">EPP</option>
                    <option value="POP">POP</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Status</label>
                <select id="filter-transaction-status" class="form-control">
                    <option value="">All</option>
                    <option value="PENDING">Pending</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="COLLECTED">Collected</option>
                </select>
            </div>
        </div>
        <div class="filter-row">
            <div class="filter-group">
                <label>Min Amount</label>
                <input type="number" id="filter-transaction-amount-min" class="form-control" placeholder="Min RM...">
            </div>
            <div class="filter-group">
                <label>Max Amount</label>
                <input type="number" id="filter-transaction-amount-max" class="form-control" placeholder="Max RM...">
            </div>
        </div>
    `;
};

const renderEventFilters = () => {
    return `
        <div class="filter-row">
            <div class="filter-group">
                <label>Event Title</label>
                <input type="text" id="filter-event-title" class="form-control" placeholder="Event title...">
            </div>
            <div class="filter-group">
                <label>Category</label>
                <select id="filter-event-category" class="form-control">
                    <option value="">All Categories</option>
                </select>
            </div>
        </div>
        <div class="filter-row">
            <div class="filter-group">
                <label>Location</label>
                <input type="text" id="filter-event-location" class="form-control" placeholder="Location...">
            </div>
            <div class="filter-group">
                <label>Status</label>
                <select id="filter-event-status" class="form-control">
                    <option value="">All</option>
                    <option value="upcoming">Upcoming</option>
                    <option value="ongoing">Ongoing</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                </select>
            </div>
        </div>
    `;
};


const renderProductFilters = () => {
    return `
        <div class="filter-row">
            <div class="filter-group">
                <label>Name</label>
                <input type="text" id="filter-product-name" class="form-control" placeholder="Product name...">
            </div>
            <div class="filter-group">
                <label>Category</label>
                <input type="text" id="filter-product-category" class="form-control" placeholder="Category...">
            </div>
        </div>
        <div class="filter-row">
            <div class="filter-group">
                <label>Min Price (RM)</label>
                <input type="number" id="filter-product-price-min" class="form-control" placeholder="Min...">
            </div>
            <div class="filter-group">
                <label>Max Price (RM)</label>
                <input type="number" id="filter-product-price-max" class="form-control" placeholder="Max...">
            </div>
        </div>
        <div class="filter-row">
            <div class="filter-group">
                <label>Status</label>
                <select id="filter-product-status" class="form-control">
                    <option value="">All</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                </select>
            </div>
        </div>
    `;
};

const renderBujishuFilters = () => {
    return `
        <div class="filter-row">
            <div class="filter-group">
                <label>Name</label>
                <input type="text" id="filter-bujishu-name" class="form-control" placeholder="Bujishu name...">
            </div>
            <div class="filter-group">
                <label>Category</label>
                <input type="text" id="filter-bujishu-category" class="form-control" placeholder="Category...">
            </div>
        </div>
        <div class="filter-row">
            <div class="filter-group">
                <label>Min Price (RM)</label>
                <input type="number" id="filter-bujishu-price-min" class="form-control" placeholder="Min...">
            </div>
            <div class="filter-group">
                <label>Max Price (RM)</label>
                <input type="number" id="filter-bujishu-price-max" class="form-control" placeholder="Max...">
            </div>
        </div>
        <div class="filter-row">
            <div class="filter-group">
                <label>Status</label>
                <select id="filter-bujishu-status" class="form-control">
                    <option value="">All</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                </select>
            </div>
        </div>
    `;
};

const renderFormulaFilters = () => {
    return `
        <div class="filter-row">
            <div class="filter-group">
                <label>Name</label>
                <input type="text" id="filter-formula-name" class="form-control" placeholder="Formula name...">
            </div>
            <div class="filter-group">
                <label>Category</label>
                <input type="text" id="filter-formula-category" class="form-control" placeholder="Category...">
            </div>
        </div>
        <div class="filter-row">
            <div class="filter-group">
                <label>Min Price (RM)</label>
                <input type="number" id="filter-formula-price-min" class="form-control" placeholder="Min...">
            </div>
            <div class="filter-group">
                <label>Max Price (RM)</label>
                <input type="number" id="filter-formula-price-max" class="form-control" placeholder="Max...">
            </div>
        </div>
        <div class="filter-row">
            <div class="filter-group">
                <label>Daily Dosage (max capsules/day)</label>
                <input type="number" id="filter-formula-dosage-max" class="form-control" placeholder="e.g. 4">
            </div>
            <div class="filter-group">
                <label>Status</label>
                <select id="filter-formula-status" class="form-control">
                    <option value="">All</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                </select>
            </div>
        </div>
    `;
};

// Section 10.6: Condition Builder Logic
const renderConditionGroups = () => {
    const container = document.getElementById('condition-groups');
    if (!container) return;

    container.innerHTML = _conditionGroups.map((group, gIdx) => `
        <div class="condition-group" data-group-index="${gIdx}">
            <div class="group-header">
                <span>Condition Group ${gIdx + 1}</span>
                <button class="btn btn-sm" onclick="app.removeConditionGroup(${gIdx})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
            <div class="conditions-list">
                ${group.conditions.map((cond, cIdx) => `
                    <div class="condition-row">
                        <select class="condition-field" onchange="app.updateConditionField(${gIdx}, ${cIdx}, this.value)">
                            <option value="">Select Field</option>
                            ${ENTITY_FIELDS[_currentSearchEntity]?.map(f => `
                                <option value="${f.value}" ${cond.field === f.value ? 'selected' : ''}>${f.label}</option>
                            `).join('') || ''}
                        </select>
                        
                        <select class="condition-operator" onchange="app.updateConditionOperator(${gIdx}, ${cIdx}, this.value)">
                            <option value="=" ${cond.operator === '=' ? 'selected' : ''}>=</option>
                            <option value="!=" ${cond.operator === '!=' ? 'selected' : ''}>!=</option>
                            <option value=">" ${cond.operator === '>' ? 'selected' : ''}>&gt;</option>
                            <option value="<" ${cond.operator === '<' ? 'selected' : ''}>&lt;</option>
                            <option value="contains" ${cond.operator === 'contains' ? 'selected' : ''}>Contains</option>
                            <option value="not_contains" ${cond.operator === 'not_contains' ? 'selected' : ''}>Not Contains</option>
                        </select>
                        
                        <input type="text" class="condition-value" value="${esc(cond.value || '')}"
                               onchange="app.updateConditionValue(${gIdx}, ${cIdx}, this.value)"
                               placeholder="Value...">
                               
                        <button class="btn btn-sm" onclick="app.removeCondition(${gIdx}, ${cIdx})">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                `).join('')}
            </div>
            <button class="btn btn-sm secondary" onclick="app.addCondition(${gIdx})">
                <i class="fas fa-plus"></i> Add Condition
            </button>
        </div>
    `).join('');
};

const addConditionGroup = () => {
    _conditionGroups.push({
        logic: 'AND',
        conditions: [{ field: '', operator: '=', value: '' }]
    });
    renderConditionGroups();
};

const removeConditionGroup = (idx) => {
    if (_conditionGroups.length > 1) {
        _conditionGroups.splice(idx, 1);
        renderConditionGroups();
    }
};

const addCondition = (gIdx) => {
    _conditionGroups[gIdx].conditions.push({ field: '', operator: '=', value: '' });
    renderConditionGroups();
};

const removeCondition = (gIdx, cIdx) => {
    _conditionGroups[gIdx].conditions.splice(cIdx, 1);
    if (_conditionGroups[gIdx].conditions.length === 0) {
        removeConditionGroup(gIdx);
    } else {
        renderConditionGroups();
    }
};

const updateGroupLogic = (gIdx, logic) => {
    _conditionGroups[gIdx].logic = logic;
};

const updateConditionField = (gIdx, cIdx, field) => {
    _conditionGroups[gIdx].conditions[cIdx].field = field;
};

const updateConditionOperator = (gIdx, cIdx, op) => {
    _conditionGroups[gIdx].conditions[cIdx].operator = op;
};

const updateConditionValue = (gIdx, cIdx, val) => {
    _conditionGroups[gIdx].conditions[cIdx].value = val;
};



// Section 10.7: Presets & Search Execution
const loadPreset = async (presetId) => {
    clearAllFilters();

    switch (presetId) {
        case 'agent-monthly': {
            const seEl = document.getElementById('search-entity');
            if (seEl) seEl.value = 'agents';
            await updateFilterSections();
            const fasEl = document.getElementById('filter-agent-status');
            if (fasEl) fasEl.value = 'active';
            break;
        }
        case 'high-score': {
            const seEl = document.getElementById('search-entity');
            if (seEl) seEl.value = 'prospects';
            await updateFilterSections();
            const fsmEl = document.getElementById('filter-prospect-score-min');
            if (fsmEl) fsmEl.value = 800;
            break;
        }
        case 'cai-ku-not-purchased': {
            const seEl = document.getElementById('search-entity');
            if (seEl) seEl.value = 'prospects';
            await updateFilterSections();
            const fnpEl = document.getElementById('filter-prospect-not-purchased');
            if (fnpEl) fnpEl.value = 'CAI KU Painting';
            break;
        }
        case 'recent-activities': {
            const seEl = document.getElementById('search-entity');
            if (seEl) seEl.value = 'activities';
            await updateFilterSections();
            const today = new Date().toISOString().split('T')[0];
            const sdfEl = document.getElementById('search-date-from');
            if (sdfEl) sdfEl.value = today;
            break;
        }
    }

    await executeSearch();
};

const collectFilters = () => {
    const entity = document.getElementById('search-entity')?.value || 'prospects';
    const filters = {
        entity,
        dateRange: {
            from: document.getElementById('search-date-from')?.value || '',
            to: document.getElementById('search-date-to')?.value || ''
        },
        basic: {},
        complex: _conditionGroups
    };

    // Collect basic filters based on entity
    const prefix = 'filter-' + entity.slice(0, -1) + '-';
    const collectInputs = (section) => {
        if (!section) return;
        section.querySelectorAll('input, select').forEach(input => {
            if (input.multiple) {
                const selected = Array.from(input.selectedOptions).map(opt => opt.value);
                if (selected.length > 0) {
                    filters.basic[input.id.replace(prefix, '')] = selected;
                }
            } else if (input.value) {
                filters.basic[input.id.replace(prefix, '')] = input.value;
            }
        });
    };
    collectInputs(document.getElementById('filter-sections'));
    collectInputs(document.getElementById('extra-filter-sections'));

    return filters;
};

const executeSearch = async () => {
    const filters = collectFilters();
    let results = [];

    switch (filters.entity) {
        case 'agents': results = await performAgentSearch(filters); break;
        case 'prospects': results = await performProspectSearch(filters); break;
        case 'customers': results = await performCustomerSearch(filters); break;
        case 'activities': results = await performActivitySearch(filters); break;
        case 'transactions': results = await performTransactionSearch(filters); break;
        case 'events': results = await performEventSearch(filters); break;
        case 'products': results = await performProductSearch(filters); break;
        case 'bujishu': results = await performBujishuSearch(filters); break;
        case 'formula': results = await performFormulaSearch(filters); break;
    }

    _currentSearchResults = results;
    _totalResults = results.length;
    _currentPage = 1;

    await renderSearchResults();
    addToSearchHistory(filters);
};

const performAgentSearch = async (filters) => {
    const allAgentUsers = await getAgentsAndLeaders();
    const visibleAgentIds = await getVisibleUserIds(_currentUser);
    let items = visibleAgentIds === 'all' ? allAgentUsers : allAgentUsers.filter(u => visibleAgentIds.map(String).includes(String(u.id)));

    if (filters.basic.name) {
        const q = filters.basic.name.toLowerCase();
        items = items.filter(i => i.full_name && i.full_name.toLowerCase().includes(q));
    }
    if (filters.basic.team) {
        items = items.filter(i => i.team === filters.basic.team);
    }
    if (filters.basic.status) {
        items = items.filter(i => i.status === filters.basic.status);
    }
    if (filters.basic.code) {
        const q = filters.basic.code.toLowerCase();
        items = items.filter(i => i.agent_code && i.agent_code.toLowerCase().includes(q));
    }
    if (filters.basic.email) {
        const q = filters.basic.email.toLowerCase();
        items = items.filter(i => i.email && i.email.toLowerCase().includes(q));
    }
    if (filters.dateRange.from) {
        items = items.filter(i => i.join_date && i.join_date >= filters.dateRange.from);
    }
    if (filters.dateRange.to) {
        items = items.filter(i => i.join_date && i.join_date <= filters.dateRange.to);
    }

    return applyComplexConditions(items, filters.complex);
};

const performProspectSearch = async (filters) => {
    // Scale-safe SOURCE: instead of downloading the ENTIRE visible set (up to 200k)
    // per search, push the provably-equivalent predicates to Supabase so we fetch
    // only the matching+visible subset. Mirrors the proven performTransactionSearch
    // pattern. SCOPE is enforced with the SAME mechanism as getVisibleProspects:
    //   • visibleIds === 'all' (admin)        → no scope filter (admin sees all)
    //   • visibleIds is a non-empty array     → scopeField responsible_agent_id IN visibleIds
    //                                            (identical column + IN to getVisibleProspects)
    //   • visibleIds is empty []              → no visible prospects → return []
    //   • visibleIds unobtainable / unknown   → fall back to getVisibleProspects() (legacy)
    // Pushed search predicates are AND-combined and equivalent-or-looser than the
    // client filters below, so {server result} ⊇ {client matches}; the UNCHANGED
    // client chain narrows to the exact legacy set. On cap-overflow / error /
    // unknown-scope we fall back to getVisibleProspects() (byte-identical to legacy).
    const FETCH_CAP = 10000;
    let items;
    try {
        const visibleIds = await getVisibleUserIds(_currentUser);
        if (Array.isArray(visibleIds) && visibleIds.length === 0) {
            // No visible prospects — matches getVisibleProspects → empty set.
            return applyComplexConditions([], filters.complex);
        }
        if (visibleIds !== 'all' && !(Array.isArray(visibleIds) && visibleIds.length)) {
            // Scope could not be reliably obtained — never push an unscoped query.
            throw new Error('prospect visibility scope unavailable — visibility-scoped fallback');
        }
        const opts = { sort: 'id', sortDir: 'asc', countMode: null, limit: FETCH_CAP + 1, offset: 0, filters: {}, gte: {}, lte: {} };
        // SCOPE — identical to getVisibleProspects' `.in(responsible_agent_id, visibleIds)`.
        // queryAdvanced's `filters` use `.eq()` (no array-IN), so the scope IN must
        // go through scopeField/scopeValues, which compiles to `.in()`. Admin ('all')
        // pushes NO scope.
        if (Array.isArray(visibleIds)) {
            opts.scopeField = 'responsible_agent_id';
            opts.scopeValues = visibleIds;
        }
        // eq filters (scalars; == the client === / === String checks below).
        if (filters.basic.minggua)  opts.filters.ming_gua = filters.basic.minggua;
        if (filters.basic.status)   opts.filters.status = filters.basic.status;
        if (filters.basic.agent)    opts.filters.responsible_agent_id = filters.basic.agent; // within scope; AND-combined with scope .in()
        if (filters.basic.pipeline) opts.filters.pipeline_stage = filters.basic.pipeline;
        if (filters.basic.gender)   opts.filters.gender = filters.basic.gender;
        if (filters.basic.income)   opts.filters.income_range = filters.basic.income;
        if (filters.basic.state)    opts.filters.state = filters.basic.state;
        // ranges (== the client parseInt/parseFloat >= / <= checks below).
        if (filters.basic['score-min']) { const v = parseInt(filters.basic['score-min']); if (!isNaN(v)) opts.gte.score = v; }
        if (filters.basic['score-max']) { const v = parseInt(filters.basic['score-max']); if (!isNaN(v)) opts.lte.score = v; }
        if (filters.basic['deal-min'])  { const v = parseFloat(filters.basic['deal-min']); if (!isNaN(v)) opts.gte.deal_value = v; }
        if (filters.basic['deal-max'])  { const v = parseFloat(filters.basic['deal-max']); if (!isNaN(v)) opts.lte.deal_value = v; }
        // ONE text group — name (client matches full_name OR nickname) pushed in full
        // via searchFields. phone/email/occupation/city contains-filters are left to
        // the client re-filter (unnecessary to push; superset still holds AND-wise).
        if (filters.basic.name) { opts.search = filters.basic.name; opts.searchFields = ['full_name', 'nickname']; }
        const res = await AppDataStore.queryAdvanced('prospects', opts);
        const data = (res && Array.isArray(res.data)) ? res.data : null;
        if (data && data.length <= FETCH_CAP) {
            items = data;
        } else {
            throw new Error('matched prospects exceed fetch cap — visibility-scoped fallback for completeness');
        }
    } catch (e) {
        console.warn('performProspectSearch: server filter unavailable — getVisibleProspects fallback', e);
        items = await getVisibleProspects();
    }

    if (filters.basic.name) {
        const q = filters.basic.name.toLowerCase();
        items = items.filter(i => (i.full_name && i.full_name.toLowerCase().includes(q)) || (i.nickname && i.nickname.toLowerCase().includes(q)));
    }
    if (filters.basic.minggua) {
        items = items.filter(i => i.ming_gua === filters.basic.minggua);
    }
    if (filters.basic.phone) {
        const q = filters.basic.phone.toLowerCase();
        items = items.filter(i => i.phone && i.phone.toLowerCase().includes(q));
    }
    if (filters.basic.email) {
        const q = filters.basic.email.toLowerCase();
        items = items.filter(i => i.email && i.email.toLowerCase().includes(q));
    }
    if (filters.basic['score-min']) {
        items = items.filter(i => i.score >= parseInt(filters.basic['score-min']));
    }
    if (filters.basic['score-max']) {
        items = items.filter(i => i.score <= parseInt(filters.basic['score-max']));
    }
    if (filters.basic.status) {
        items = items.filter(i => i.status === filters.basic.status);
    }
    if (filters.basic.agent) {
        items = items.filter(i => String(i.responsible_agent_id) === String(filters.basic.agent));
    }
    if (filters.basic.pipeline) {
        items = items.filter(i => i.pipeline_stage === filters.basic.pipeline);
    }
    if (filters.basic['deal-min']) {
        items = items.filter(i => parseFloat(i.deal_value) >= parseFloat(filters.basic['deal-min']));
    }
    if (filters.basic['deal-max']) {
        items = items.filter(i => parseFloat(i.deal_value) <= parseFloat(filters.basic['deal-max']));
    }
    if (filters.basic.gender) {
        items = items.filter(i => i.gender === filters.basic.gender);
    }
    if (filters.basic.occupation) {
        const q = filters.basic.occupation.toLowerCase();
        items = items.filter(i => i.occupation && i.occupation.toLowerCase().includes(q));
    }
    if (filters.basic.income) {
        items = items.filter(i => i.income_range === filters.basic.income);
    }
    if (filters.basic.city) {
        const q = filters.basic.city.toLowerCase();
        items = items.filter(i => i.city && i.city.toLowerCase().includes(q));
    }
    if (filters.basic.state) {
        items = items.filter(i => i.state === filters.basic.state);
    }
    if (filters.basic.referred) {
        const q = filters.basic.referred.toLowerCase();
        items = items.filter(i => i.referred_by && i.referred_by.toLowerCase().includes(q));
    }
    if (filters.basic['has-purchased']) {
        const product = filters.basic['has-purchased'];
        const purchasedIds = await _buildPurchasedProductIdSet(product, items.map(i => i.id));
        items = items.filter(i => purchasedIds.has(i.id));
    }
    if (filters.basic['not-purchased']) {
        const product = filters.basic['not-purchased'];
        const purchasedIds = await _buildPurchasedProductIdSet(product, items.map(i => i.id));
        items = items.filter(i => !purchasedIds.has(i.id));
    }
    if (filters.basic.keyword) {
        const kw = filters.basic.keyword.toLowerCase();
        items = items.filter(i =>
            (i.full_name && i.full_name.toLowerCase().includes(kw)) ||
            (i.nickname && i.nickname.toLowerCase().includes(kw)) ||
            (i.phone && i.phone.toLowerCase().includes(kw)) ||
            (i.email && i.email.toLowerCase().includes(kw)) ||
            (i.occupation && i.occupation.toLowerCase().includes(kw)) ||
            (i.company_name && i.company_name.toLowerCase().includes(kw)) ||
            (i.notes && i.notes.toLowerCase().includes(kw))
        );
    }
    if (filters.basic.tags && filters.basic.tags.length > 0) {
        items = items.filter(i => {
            const itemTags = i.tags ? (Array.isArray(i.tags) ? i.tags : i.tags.split(',').map(t => t.trim())) : [];
            return filters.basic.tags.every(tag => itemTags.includes(tag));
        });
    }
    if (filters.basic.needs && filters.basic.needs.length > 0) {
        items = items.filter(i => {
            const itemNeeds = i.needs ? (Array.isArray(i.needs) ? i.needs : i.needs.split(',').map(t => t.trim())) : [];
            return filters.basic.needs.every(need => itemNeeds.includes(need));
        });
    }
    if (filters.basic['age-min'] || filters.basic['age-max']) {
        items = items.filter(i => {
            if (!i.date_of_birth) return false;
            const age = Math.floor((Date.now() - new Date(i.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
            if (filters.basic['age-min'] && age < parseInt(filters.basic['age-min'])) return false;
            if (filters.basic['age-max'] && age > parseInt(filters.basic['age-max'])) return false;
            return true;
        });
    }
    if (filters.dateRange.from) {
        items = items.filter(i => i.cps_assignment_date && i.cps_assignment_date >= filters.dateRange.from);
    }
    if (filters.dateRange.to) {
        items = items.filter(i => i.cps_assignment_date && i.cps_assignment_date <= filters.dateRange.to);
    }

    return applyComplexConditions(items, filters.complex);
};

const hasProspectPurchasedProduct = async (prospectId, productName) => {
    const purchases = await AppDataStore.getAll('purchases');
    if (purchases.some(p => p.customer_id === prospectId && p.item && p.item.includes(productName))) return true;

    const activities = await AppDataStore.getAll('activities');
    return activities.some(a => (a.prospect_id === prospectId || a.customer_id === prospectId) && a.is_closing && a.solution_sold === productName);
};

const _buildPurchasedProductIdSet = async (productName, candidateIds) => {
    const want = candidateIds instanceof Set ? candidateIds : new Set(candidateIds);
    const set = new Set();
    const [purchases, activities] = await Promise.all([
        AppDataStore.getAll('purchases'),
        AppDataStore.getAll('activities'),
    ]);
    for (const p of purchases) {
        if (p.item && p.item.includes(productName) && want.has(p.customer_id)) {
            set.add(p.customer_id);
        }
    }
    for (const a of activities) {
        if (!a.is_closing || a.solution_sold !== productName) continue;
        if (want.has(a.prospect_id)) set.add(a.prospect_id);
        if (want.has(a.customer_id)) set.add(a.customer_id);
    }
    return set;
};

const performCustomerSearch = async (filters) => {
    // Scale-safe SOURCE: instead of downloading the ENTIRE visible customer set per
    // search, push the provably-equivalent predicates to Supabase so we fetch only the
    // matching+visible subset. Mirrors performProspectSearch, but customers are scoped
    // by an OR over TWO columns (responsible_agent_id OR legacy agent_id) — identical
    // to getVisibleCustomers (script.js:823, two queryPaged calls merged+deduped).
    // SCOPE replication:
    //   • visibleIds === 'all' (admin)     → ONE unscoped query (admin sees all)
    //   • visibleIds non-empty array       → TWO queries, scopeField responsible_agent_id
    //                                          and scopeField agent_id (same predicates),
    //                                          merged + deduped by id → reproduces the OR
    //   • visibleIds empty []              → no visible customers → return []
    //   • visibleIds unobtainable / error  → fall back to getVisibleCustomers() (legacy)
    // Pushed predicates are AND-combined and equivalent-or-looser than the client filters
    // below, so {server result} ⊇ {client matches}; the UNCHANGED client chain narrows to
    // the exact legacy set. KEYWORD is deliberately NOT pushed: the client keyword ORs
    // over full_name/nickname/phone/email/occupation/company_name/notes, but `notes` is a
    // separate table on customers (no customers.notes column — see script-customers.js
    // notes-tab uses AppDataStore.query('notes', …)), so an ilike on it would either error
    // or under-return. Leaving keyword fully client-side is still superset-safe (it only
    // AND-narrows). On cap-overflow / error / unknown-scope we fall back to
    // getVisibleCustomers() (byte-identical to legacy).
    const FETCH_CAP = 10000;
    let items;
    try {
        const visibleIds = await getVisibleUserIds(_currentUser);
        if (Array.isArray(visibleIds) && visibleIds.length === 0) {
            // No visible customers — matches getVisibleCustomers → empty set.
            return applyComplexConditions([], filters.complex);
        }
        if (visibleIds !== 'all' && !(Array.isArray(visibleIds) && visibleIds.length)) {
            // Scope could not be reliably obtained — never push an unscoped query.
            throw new Error('customer visibility scope unavailable — visibility-scoped fallback');
        }
        // Shared search predicates (AND-combined, equivalent-or-looser than the client
        // filters). eq filters (scalars; == the client === checks below).
        const baseFilters = {};
        if (filters.basic.minggua) baseFilters.ming_gua = filters.basic.minggua;
        if (filters.basic.status)  baseFilters.status = filters.basic.status;
        if (filters.basic.agent)   baseFilters.responsible_agent_id = filters.basic.agent; // == client resp==agent; union over both scope branches stays exact
        if (filters.basic.gender)  baseFilters.gender = filters.basic.gender;
        if (filters.basic.income)  baseFilters.income_range = filters.basic.income;
        if (filters.basic.state)   baseFilters.state = filters.basic.state;
        const baseGte = {}, baseLte = {};
        if (filters.basic['score-min']) { const v = parseInt(filters.basic['score-min']);   if (!isNaN(v)) baseGte.score = v; }
        if (filters.basic['score-max']) { const v = parseInt(filters.basic['score-max']);   if (!isNaN(v)) baseLte.score = v; }
        if (filters.basic['ltv-min'])   { const v = parseFloat(filters.basic['ltv-min']);   if (!isNaN(v)) baseGte.lifetime_value = v; }
        if (filters.basic['ltv-max'])   { const v = parseFloat(filters.basic['ltv-max']);   if (!isNaN(v)) baseLte.lifetime_value = v; }
        // ONE text group — name (client matches full_name OR nickname) pushed in full via
        // searchFields. phone/email/occupation/city contains-filters AND keyword are left
        // to the client re-filter (superset still holds AND-wise).
        const baseSearch = filters.basic.name ? filters.basic.name : null;
        const baseSearchFields = filters.basic.name ? ['full_name', 'nickname'] : null;
        const mkOpts = (scopeField) => {
            const o = { sort: 'id', sortDir: 'asc', countMode: null, limit: FETCH_CAP + 1, offset: 0,
                filters: { ...baseFilters }, gte: { ...baseGte }, lte: { ...baseLte } };
            if (scopeField) { o.scopeField = scopeField; o.scopeValues = visibleIds; }
            if (baseSearch) { o.search = baseSearch; o.searchFields = baseSearchFields; }
            return o;
        };
        if (visibleIds === 'all') {
            // Admin — ONE unscoped query.
            const res = await AppDataStore.queryAdvanced('customers', mkOpts(null));
            const data = (res && Array.isArray(res.data)) ? res.data : null;
            if (data && data.length <= FETCH_CAP) {
                items = data;
            } else {
                throw new Error('matched customers exceed fetch cap — visibility-scoped fallback for completeness');
            }
        } else {
            // Scoped — TWO queries (responsible_agent_id OR legacy agent_id), merged + deduped
            // by id, mirroring getVisibleCustomers' OR-scope (script.js:838-844).
            const [byResp, byAgent] = await Promise.all([
                AppDataStore.queryAdvanced('customers', mkOpts('responsible_agent_id')),
                AppDataStore.queryAdvanced('customers', mkOpts('agent_id')),
            ]);
            const dResp  = (byResp  && Array.isArray(byResp.data))  ? byResp.data  : null;
            const dAgent = (byAgent && Array.isArray(byAgent.data)) ? byAgent.data : null;
            if (!dResp || !dAgent || dResp.length > FETCH_CAP || dAgent.length > FETCH_CAP) {
                throw new Error('matched customers exceed fetch cap — visibility-scoped fallback for completeness');
            }
            const seen = new Set();
            const out = [];
            for (const c of [...dResp, ...dAgent]) {
                const k = String(c.id);
                if (!seen.has(k)) { seen.add(k); out.push(c); }
            }
            items = out;
        }
    } catch (e) {
        console.warn('performCustomerSearch: server filter unavailable — getVisibleCustomers fallback', e);
        items = await getVisibleCustomers();
    }

    if (filters.basic.name) {
        const q = filters.basic.name.toLowerCase();
        items = items.filter(i => (i.full_name && i.full_name.toLowerCase().includes(q)) || (i.nickname && i.nickname.toLowerCase().includes(q)));
    }
    if (filters.basic.minggua) {
        items = items.filter(i => i.ming_gua === filters.basic.minggua);
    }
    if (filters.basic.phone) {
        const q = filters.basic.phone.toLowerCase();
        items = items.filter(i => i.phone && i.phone.toLowerCase().includes(q));
    }
    if (filters.basic.email) {
        const q = filters.basic.email.toLowerCase();
        items = items.filter(i => i.email && i.email.toLowerCase().includes(q));
    }
    if (filters.basic['score-min']) {
        items = items.filter(i => i.score >= parseInt(filters.basic['score-min']));
    }
    if (filters.basic['score-max']) {
        items = items.filter(i => i.score <= parseInt(filters.basic['score-max']));
    }
    if (filters.basic.status) {
        items = items.filter(i => i.status === filters.basic.status);
    }
    if (filters.basic.agent) {
        items = items.filter(i => String(i.responsible_agent_id) === String(filters.basic.agent));
    }
    if (filters.basic['ltv-min']) {
        items = items.filter(i => parseFloat(i.lifetime_value) >= parseFloat(filters.basic['ltv-min']));
    }
    if (filters.basic['ltv-max']) {
        items = items.filter(i => parseFloat(i.lifetime_value) <= parseFloat(filters.basic['ltv-max']));
    }
    if (filters.basic.gender) {
        items = items.filter(i => i.gender === filters.basic.gender);
    }
    if (filters.basic.occupation) {
        const q = filters.basic.occupation.toLowerCase();
        items = items.filter(i => i.occupation && i.occupation.toLowerCase().includes(q));
    }
    if (filters.basic.income) {
        items = items.filter(i => i.income_range === filters.basic.income);
    }
    if (filters.basic.city) {
        const q = filters.basic.city.toLowerCase();
        items = items.filter(i => i.city && i.city.toLowerCase().includes(q));
    }
    if (filters.basic.state) {
        items = items.filter(i => i.state === filters.basic.state);
    }
    if (filters.basic.referred) {
        const q = filters.basic.referred.toLowerCase();
        items = items.filter(i => i.referred_by && i.referred_by.toLowerCase().includes(q));
    }
    if (filters.basic.keyword) {
        const kw = filters.basic.keyword.toLowerCase();
        items = items.filter(i =>
            (i.full_name && i.full_name.toLowerCase().includes(kw)) ||
            (i.nickname && i.nickname.toLowerCase().includes(kw)) ||
            (i.phone && i.phone.toLowerCase().includes(kw)) ||
            (i.email && i.email.toLowerCase().includes(kw)) ||
            (i.occupation && i.occupation.toLowerCase().includes(kw)) ||
            (i.company_name && i.company_name.toLowerCase().includes(kw)) ||
            (i.notes && i.notes.toLowerCase().includes(kw))
        );
    }
    if (filters.basic.tags && filters.basic.tags.length > 0) {
        items = items.filter(i => {
            const itemTags = i.tags ? (Array.isArray(i.tags) ? i.tags : i.tags.split(',').map(t => t.trim())) : [];
            return filters.basic.tags.every(tag => itemTags.includes(tag));
        });
    }
    if (filters.basic.needs && filters.basic.needs.length > 0) {
        items = items.filter(i => {
            const itemNeeds = i.needs ? (Array.isArray(i.needs) ? i.needs : i.needs.split(',').map(t => t.trim())) : [];
            return filters.basic.needs.every(need => itemNeeds.includes(need));
        });
    }
    if (filters.basic['age-min'] || filters.basic['age-max']) {
        items = items.filter(i => {
            if (!i.date_of_birth) return false;
            const age = Math.floor((Date.now() - new Date(i.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
            if (filters.basic['age-min'] && age < parseInt(filters.basic['age-min'])) return false;
            if (filters.basic['age-max'] && age > parseInt(filters.basic['age-max'])) return false;
            return true;
        });
    }
    if (filters.dateRange.from) {
        items = items.filter(i => i.customer_since && i.customer_since >= filters.dateRange.from);
    }
    if (filters.dateRange.to) {
        items = items.filter(i => i.customer_since && i.customer_since <= filters.dateRange.to);
    }

    return applyComplexConditions(items, filters.complex);
};

const performActivitySearch = async (filters) => {
    let items = await getVisibleActivities();

    // activity entity doesn't strip prefix cleanly, check both key forms
    const type = filters.basic['filter-activity-type'] || filters.basic.type;
    if (type) {
        items = items.filter(i => i.activity_type === type);
    }
    const title = filters.basic['filter-activity-title'] || filters.basic.title;
    if (title) {
        const q = title.toLowerCase();
        items = items.filter(i => i.activity_title && i.activity_title.toLowerCase().includes(q));
    }
    const agentId = filters.basic['filter-activity-agent'] || filters.basic.agent;
    if (agentId) {
        items = items.filter(i => String(i.lead_agent_id) === String(agentId));
    }
    const status = filters.basic['filter-activity-status'] || filters.basic.status;
    if (status) {
        items = items.filter(i => i.status === status);
    }
    const attendance = filters.basic['filter-activity-attendance'] || filters.basic.attendance;
    if (attendance) {
        const allAttendees = await AppDataStore.getAll('event_attendees');
        items = items.filter(i => {
            if (i.activity_type !== 'EVENT' || !i.event_id) return false;
            return allAttendees.some(a => a.event_id === i.event_id && a.attendance_status === attendance);
        });
    }
    if (filters.dateRange.from) {
        items = items.filter(i => i.activity_date && i.activity_date >= filters.dateRange.from);
    }
    if (filters.dateRange.to) {
        items = items.filter(i => i.activity_date && i.activity_date <= filters.dateRange.to);
    }

    return applyComplexConditions(items, filters.complex);
};

const performTransactionSearch = async (filters) => {
    // Scale-safe SOURCE: push the provably-equivalent predicates to Supabase so we
    // fetch only matching purchases instead of the whole table:
    //   • payment_method / status — exact eq (== the client === checks below)
    //   • product — ilike %term% (== the client case-insensitive .includes below)
    //   • date range — WIDENED ±1 day so the server result is ALWAYS a superset of
    //     what the client date filter keeps (guards against date/tz boundary parity).
    // EVERY original client filter below still runs on the result, so the returned
    // set is identical. If the matched set exceeds the fetch cap (or anything errors)
    // we fall back to the exact legacy whole-table scan for completeness.
    const FETCH_CAP = 10000;
    const _ymdShift = (ymd, days) => {
        try {
            const [y, m, d] = String(ymd).split('-').map(Number);
            if (!y || !m || !d) return null;
            return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
        } catch (_) { return null; }
    };
    let items;
    try {
        const opts = { sort: 'id', sortDir: 'asc', countMode: null, limit: FETCH_CAP + 1, offset: 0, filters: {}, gte: {}, lte: {} };
        if (filters.basic.payment) opts.filters.payment_method = filters.basic.payment;
        if (filters.basic.status)  opts.filters.status = filters.basic.status;
        if (filters.basic.product) { opts.search = filters.basic.product; opts.searchFields = ['item']; }
        if (filters.dateRange.from) { const w = _ymdShift(filters.dateRange.from, -1); if (w) opts.gte.date = w; }
        if (filters.dateRange.to)   { const w = _ymdShift(filters.dateRange.to, 1);    if (w) opts.lte.date = w; }
        const res = await AppDataStore.queryAdvanced('purchases', opts);
        const data = (res && Array.isArray(res.data)) ? res.data : null;
        if (data && data.length <= FETCH_CAP) {
            items = data;
        } else {
            throw new Error('matched purchases exceed fetch cap — full scan for completeness');
        }
    } catch (e) {
        console.warn('performTransactionSearch: server filter unavailable — full-table fallback', e);
        items = await AppDataStore.getAll('purchases');
    }

    if (filters.basic.product) {
        const q = filters.basic.product.toLowerCase();
        items = items.filter(i => i.item && i.item.toLowerCase().includes(q));
    }
    if (filters.basic.invoice) {
        const q = filters.basic.invoice.toLowerCase();
        items = items.filter(i => i.invoice && i.invoice.toLowerCase().includes(q));
    }
    if (filters.basic.payment) {
        items = items.filter(i => i.payment_method === filters.basic.payment);
    }
    if (filters.basic.status) {
        items = items.filter(i => i.status === filters.basic.status);
    }
    if (filters.basic['amount-min']) {
        items = items.filter(i => parseFloat(i.amount) >= parseFloat(filters.basic['amount-min']));
    }
    if (filters.basic['amount-max']) {
        items = items.filter(i => parseFloat(i.amount) <= parseFloat(filters.basic['amount-max']));
    }
    if (filters.dateRange.from) {
        items = items.filter(i => i.date && i.date >= filters.dateRange.from);
    }
    if (filters.dateRange.to) {
        items = items.filter(i => i.date && i.date <= filters.dateRange.to);
    }

    return applyComplexConditions(items, filters.complex);
};

const performEventSearch = async (filters) => {
    let items = await AppDataStore.getAll('events');

    if (filters.basic.title) {
        const query = filters.basic.title.toLowerCase();
        items = items.filter(i => i.event_title && i.event_title.toLowerCase().includes(query));
    }
    if (filters.basic.category) {
        items = items.filter(i => String(i.event_category_id) === String(filters.basic.category));
    }
    if (filters.basic.location) {
        const q = filters.basic.location.toLowerCase();
        items = items.filter(i => i.location && i.location.toLowerCase().includes(q));
    }
    if (filters.basic.status) {
        items = items.filter(i => i.status === filters.basic.status);
    }
    if (filters.dateRange.from) {
        items = items.filter(i => i.event_date && i.event_date >= filters.dateRange.from);
    }
    if (filters.dateRange.to) {
        items = items.filter(i => i.event_date && i.event_date <= filters.dateRange.to);
    }
    if (filters.basic.speaker) {
        const q = filters.basic.speaker.toLowerCase();
        items = items.filter(i => i.speaker && i.speaker.toLowerCase().includes(q));
    }

    return applyComplexConditions(items, filters.complex);
};

const performProductSearch = async (filters) => {
    let items = await AppDataStore.getAll('products');

    if (filters.basic.name) {
        const q = filters.basic.name.toLowerCase();
        items = items.filter(i => i.name && i.name.toLowerCase().includes(q));
    }
    if (filters.basic.category) {
        const q = filters.basic.category.toLowerCase();
        items = items.filter(i => i.category && i.category.toLowerCase().includes(q));
    }
    if (filters.basic['price-min']) {
        items = items.filter(i => parseFloat(i.price) >= parseFloat(filters.basic['price-min']));
    }
    if (filters.basic['price-max']) {
        items = items.filter(i => parseFloat(i.price) <= parseFloat(filters.basic['price-max']));
    }
    if (filters.basic.status) {
        const active = filters.basic.status === 'active';
        items = items.filter(i => (i.is_active !== false) === active);
    }

    return applyComplexConditions(items, filters.complex);
};

const performBujishuSearch = async (filters) => {
    let items = await AppDataStore.getAll('bujishu');

    if (filters.basic.name) {
        const q = filters.basic.name.toLowerCase();
        items = items.filter(i => i.name && i.name.toLowerCase().includes(q));
    }
    if (filters.basic.category) {
        const q = filters.basic.category.toLowerCase();
        items = items.filter(i => i.category && i.category.toLowerCase().includes(q));
    }
    if (filters.basic['price-min']) {
        items = items.filter(i => parseFloat(i.price) >= parseFloat(filters.basic['price-min']));
    }
    if (filters.basic['price-max']) {
        items = items.filter(i => parseFloat(i.price) <= parseFloat(filters.basic['price-max']));
    }
    if (filters.basic.status) {
        const active = filters.basic.status === 'active';
        items = items.filter(i => (i.is_active !== false) === active);
    }

    return applyComplexConditions(items, filters.complex);
};

const performFormulaSearch = async (filters) => {
    let items = await AppDataStore.getAll('formula');

    if (filters.basic.name) {
        const q = filters.basic.name.toLowerCase();
        items = items.filter(i => i.name && i.name.toLowerCase().includes(q));
    }
    if (filters.basic.category) {
        const q = filters.basic.category.toLowerCase();
        items = items.filter(i => i.category && i.category.toLowerCase().includes(q));
    }
    if (filters.basic['price-min']) {
        items = items.filter(i => parseFloat(i.price) >= parseFloat(filters.basic['price-min']));
    }
    if (filters.basic['price-max']) {
        items = items.filter(i => parseFloat(i.price) <= parseFloat(filters.basic['price-max']));
    }
    if (filters.basic['dosage-max']) {
        items = items.filter(i => i.daily_dosage && parseFloat(i.daily_dosage) <= parseFloat(filters.basic['dosage-max']));
    }
    if (filters.basic.status) {
        const active = filters.basic.status === 'active';
        items = items.filter(i => (i.is_active !== false) === active);
    }

    return applyComplexConditions(items, filters.complex);
};

const applyComplexConditions = (items, groups) => {
    if (!groups || groups.length === 0 || groups[0].conditions.length === 0) return items;

    return items.filter(item => {
        // Group logic (AND/OR for multiple groups)
        // Simplified: we only support one group logic at the top level for now or specific per-group
        return groups.every(group => {
            const results = group.conditions.map(cond => evaluateCondition(item, cond));
            return group.logic === 'AND' ? results.every(r => r) : results.some(r => r);
        });
    });
};

const evaluateCondition = (item, cond) => {
    if (!cond.field) return true;

    const itemValue = item[cond.field];
    const val = cond.value;

    switch (cond.operator) {
        case '=': return itemValue == val;
        case '!=': return itemValue != val;
        case '>': return parseFloat(itemValue) > parseFloat(val);
        case '<': return parseFloat(itemValue) < parseFloat(val);
        case 'contains': return String(itemValue).toLowerCase().includes(String(val).toLowerCase());
        case 'not_contains': return !String(itemValue).toLowerCase().includes(String(val).toLowerCase());
        default: return true;
    }
};

// Section 10.9: Results Rendering
const buildSearchResultsTable = (pageItems, _searchUserMap) => {
    return `
        <h3>Search Results (${_totalResults} found)</h3>
        <table class="search-results-table table-hover">
            <thead>
                <tr>
                    <th scope="col">Name/Title</th>
                    <th scope="col">Identifier/Contact</th>
                    <th scope="col">Agent Name</th>
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                </tr>
            </thead>
            <tbody>
                ${pageItems.map(item => {
        const agentId = item.lead_agent_id || item.responsible_agent_id;
        const agentName = agentId ? (_searchUserMap.get(String(agentId)) || '-') : '-';

        let displayStatus = item.status || item.activity_type || item.team || 'Active';
        if (_currentSearchEntity === 'prospects') displayStatus = item.status || 'Prospect';
        if (_currentSearchEntity === 'customers') displayStatus = 'Customer';
        if (item.status === 'converted' && _currentSearchEntity === 'prospects') displayStatus = 'Customer';
        if (['products','bujishu','formula'].includes(_currentSearchEntity)) {
            displayStatus = item.is_active === false ? 'Inactive' : 'Active';
        }

        const nameCol = item.full_name || item.activity_title || item.event_title || item.item || item.name || 'N/A';
        const identifierCol = (() => {
            if (['products','bujishu','formula'].includes(_currentSearchEntity)) return item.category ? `${item.category} — RM${item.price || '-'}` : `RM${item.price || '-'}`;
            return item.phone || item.agent_code || item.invoice || item.location || 'N/A';
        })();

        return `
                    <tr style="cursor: pointer;" onclick="app.viewEntityDetail('${_currentSearchEntity}', ${item.id})">
                        <td><strong>${esc(nameCol)}</strong></td>
                        <td>${esc(identifierCol)}</td>
                        <td>${esc(agentName)}</td>
                        <td>${esc(displayStatus)}</td>
                        <td>
                            <button class="btn-icon" title="View Detail" onclick="app.viewEntityDetail('${_currentSearchEntity}', ${item.id}); event.stopPropagation();">
                                <i class="fas fa-eye"></i>
                            </button>
                        </td>
                    </tr>
                    `;
    }).join('')}
            </tbody>
        </table>
    `;
};

const renderSearchResults = async () => {
    const container = document.getElementById('search-results');
    if (!container) return;

    if (_totalResults === 0) {
        container.innerHTML = '<div class="no-results">No matches found for your criteria.</div>';
        return;
    }

    const start = (_currentPage - 1) * _pageSize;
    const pageItems = _currentSearchResults.slice(start, start + _pageSize);

    const _searchUserMap = new Map((await AppDataStore.getAll('users')).map(u => [String(u.id), u.full_name]));

    let html = buildSearchResultsTable(pageItems, _searchUserMap);

    container.innerHTML = html;
    await renderPagination();
};

const renderPagination = async () => {
    const container = document.getElementById('search-pagination');
    if (!container) return;

    const totalPages = Math.ceil(_totalResults / _pageSize);
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <div class="pagination-controls">
            <button ${_currentPage === 1 ? 'disabled' : ''} onclick="(async()=>{try{await app.goToPage(${_currentPage - 1});}catch(e){console.error(e);}})()">Prev</button>
            <span>Page ${_currentPage} of ${totalPages}</span>
            <button ${_currentPage === totalPages ? 'disabled' : ''} onclick="(async()=>{try{await app.goToPage(${_currentPage + 1});}catch(e){console.error(e);}})()">Next</button>
        </div>
    `;
};

const goToPage = async (page) => {
    _currentPage = page;
    await renderSearchResults();
};

// Section 10.10: Saved Searches & History
const renderSavedSearches = async () => {
    const container = document.getElementById('saved-searches-list');
    if (!container) return;

    const searches = await AppDataStore.getAll('saved_searches');
    if (searches.length === 0) {
        container.innerHTML = '<p class="text-muted" style="font-size: 12px; margin: 12px 0;">No saved searches yet.</p>';
        return;
    }

    container.innerHTML = searches.map(s => `
        <div class="saved-search-item">
            <div class="saved-search-info" onclick="(async()=>{try{await app.loadSavedSearch(${s.id});}catch(e){console.error(e);}})()">
                <i class="fas fa-bookmark"></i>
                <span>${esc(s.search_name || '')}</span>
                <small>${esc(s.entity || '')}</small>
            </div>
            <button class="btn-icon" onclick="(async()=>{try{await app.deleteSavedSearch(${s.id});}catch(e){console.error(e);}})()">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `).join('');
};

const openSaveSearchModal = async () => {
    const name = prompt('Enter a name for this search:');
    if (name) {
        await saveCurrentSearch(name);
    }
};

const saveCurrentSearch = async (name) => {
    const filters = collectFilters();
    const savedSearch = {
        search_name: name,
        entity: filters.entity,
        filter_data: JSON.stringify(filters),
        created_at: new Date().toISOString()
    };

    try {
        await AppDataStore.create('saved_searches', savedSearch);
        UI.toast.success('Search saved successfully');
    } catch (e) {
        UI.toast.error('Failed to save search: ' + (e?.message || e));
    }
    await renderSavedSearches();
};

const loadSavedSearch = async (id) => {
    const search = await AppDataStore.getById('saved_searches', id);
    if (!search) return;

    UI.toast.info(`Loading search: ${search.search_name}`);
    const filters = JSON.parse(search.filter_data);

    // Restore UI
    const seEl = document.getElementById('search-entity');
    if (seEl) seEl.value = filters.entity;
    await updateFilterSections();

    const sdfEl = document.getElementById('search-date-from');
    if (sdfEl) sdfEl.value = filters.dateRange.from || '';
    const sdtEl = document.getElementById('search-date-to');
    if (sdtEl) sdtEl.value = filters.dateRange.to || '';

    _conditionGroups = filters.complex;
    renderConditionGroups();

    // Execute
    await executeSearch();
};

const deleteSavedSearch = async (id) => {
    if (confirm('Are you sure you want to delete this saved search?')) {
        try {
            await AppDataStore.delete('saved_searches', id);
            UI.toast.success('Search deleted');
        } catch (e) {
            UI.toast.error('Failed to delete search: ' + (e?.message || e));
        }
        await renderSavedSearches();
    }
};

const addToSearchHistory = (filters) => {
    _searchHistory.unshift({
        timestamp: new Date().toLocaleTimeString(),
        entity: filters.entity,
        summary: filters.entity + ' search'
    });

    if (_searchHistory.length > 5) _searchHistory.pop();
    renderSearchHistory();
};

const renderSearchHistory = () => {
    const container = document.getElementById('search-history-list');
    if (!container) return;

    container.innerHTML = _searchHistory.map(h => `
        <div class="history-item">
            <div class="history-info">
                <small>${h.timestamp}</small>
                <span>${h.summary}</span>
            </div>
        </div>
    `).join('');
};

const clearAllFilters = () => {
    // Reset basic filters
    const section = document.getElementById('filter-sections');
    if (section) {
        const inputs = section.querySelectorAll('input, select');
        inputs.forEach(input => input.value = '');
    }

    // Reset date
    const sdfEl = document.getElementById('search-date-from');
    if (sdfEl) sdfEl.value = '';
    const sdtEl = document.getElementById('search-date-to');
    if (sdtEl) sdtEl.value = '';

    // Reset conditions
    _conditionGroups = [{ logic: 'AND', conditions: [] }];
    renderConditionGroups();

    UI.toast.info('Filters cleared');
};

const exportResults = (format) => {
    if (_currentSearchResults.length === 0) {
        UI.toast.warning('No results to export');
        return;
    }

    if (format === 'csv') {
        const keys = Object.keys(_currentSearchResults[0]);
        // CSV-safe cell: double embedded quotes, and neutralize leading
        // =,+,-,@ so spreadsheets don't execute a value as a formula.
        const csvCell = (v) => {
            const cell = String(v ?? '');
            const safe = /^[=+\-@]/.test(cell) ? "'" + cell : cell;
            return '"' + safe.replace(/"/g, '""') + '"';
        };
        const header = keys.join(',');
        const rows = _currentSearchResults.map(row =>
            keys.map(key => csvCell(row[key])).join(',')
        );

        const csv = [header, ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.setAttribute('hidden', '');
        a.setAttribute('href', url);
        a.setAttribute('download', `search_results_${_currentSearchEntity}.csv`);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        UI.toast.success('Exporting CSV...');
    }
};


// --- PHASE 11: DOCUMENT MANAGEMENT SYSTEM FUNCTIONS ---
// [CHUNK: documents] ~981 lines extracted to chunks/script-documents.js
// Loaded lazily by navigateTo("documents"). Registered via Object.assign.



    // viewEntityDetail: opening a search result row. Previously this lived ONLY
    // in the Super-Admin-gated admin chunk, so for every non-admin the result
    // rows were dead buttons. Define it here (search chunk loads for all roles)
    // and lazy-load the prospects chunk which owns the detail views.
    const viewEntityDetail = async (entity, id) => {
        if (window.app.hideSearchPanel) window.app.hideSearchPanel();
        if (typeof window._loadChunk === 'function' && ['prospects','customers','agents'].includes(entity)) {
            try { await window._loadChunk('chunks/script-prospects.min.js'); } catch (_) {}
        }
        switch (entity) {
            case 'prospects': if (window.app.showProspectDetail) await window.app.showProspectDetail(id); break;
            case 'customers': if (window.app.showCustomerDetail) await window.app.showCustomerDetail(id); break;
            case 'agents':    if (window.app.showAgentDetail) await window.app.showAgentDetail(id); break;
            case 'products':
            case 'bujishu':
            case 'formula':
                if (window.app.navigateTo) await window.app.navigateTo('marketing');
                UI.toast.info('Navigate to Marketing → Lists to manage ' + entity);
                break;
            case 'activities': if (window.app.viewActivityDetails) await window.app.viewActivityDetails(id); break;
            case 'events':     if (window.app.showEventDetail) await window.app.showEventDetail(id); else UI.toast.info('Event #' + id); break;
            default: UI.toast.info(`${entity} #${id}`);
        }
    };

    app.register('search', {
        ensureReferralFields,
        viewEntityDetail,
        toggleSearchPanel,
        showSearchPanel,
        hideSearchPanel,
        updateFilterSections,
        renderAgentFilters,
        renderProspectCustomerFilters,
        renderActivityFilters,
        renderTransactionFilters,
        renderEventFilters,
        renderProductFilters,
        renderBujishuFilters,
        renderFormulaFilters,
        renderConditionGroups,
        addConditionGroup,
        removeConditionGroup,
        addCondition,
        removeCondition,
        updateGroupLogic,
        updateConditionField,
        updateConditionOperator,
        updateConditionValue,
        loadPreset,
        collectFilters,
        executeSearch,
        performAgentSearch,
        performProspectSearch,
        hasProspectPurchasedProduct,
        performCustomerSearch,
        performActivitySearch,
        performTransactionSearch,
        performEventSearch,
        performProductSearch,
        performBujishuSearch,
        performFormulaSearch,
        applyComplexConditions,
        evaluateCondition,
        renderSearchResults,
        renderPagination,
        goToPage,
        renderSavedSearches,
        openSaveSearchModal,
        saveCurrentSearch,
        loadSavedSearch,
        deleteSavedSearch,
        addToSearchHistory,
        renderSearchHistory,
        clearAllFilters,
        exportResults,
    });
})();