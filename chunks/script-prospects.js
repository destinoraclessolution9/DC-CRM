/**
 * CRM Lazy Chunk: Prospect Management (core)
 * Covers: prospect table/sort/bulk/modal/save, prospect detail + closing/feng-shui/
 *   product tabs, purchases-history, tags/solutions/protection/convert. Customer,
 *   agent, approval-queue, and settings clusters were split into sibling chunks
 *   (script-customers/agents/approvals/settings.js) 2026-06-18.
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
    // buildActivityVisibilityChecker — private const in the script.js IIFE, exported to
    // _crmUtils in Wave A. Bare identifier here would ReferenceError on the non-admin
    // Prospects+Activities export path. Fallback denies-all visibility if not yet exported.
    const buildActivityVisibilityChecker = (...a) => (window._crmUtils.buildActivityVisibilityChecker || (async () => () => false))(...a);
    // canEditProspect — edit-policy predicate. Mirrors script.js canEditProspect
    // (script.js:1095): L1-2 edit anything, L3-10 edit team/subordinate records,
    // L11+ own records only. Implemented locally because the core predicate is not
    // exported to _crmUtils; falls back to the exported one if it ever appears.
    const canEditProspect = async (prospect) => {
        if (window._crmUtils.canEditProspect) return await window._crmUtils.canEditProspect(prospect);
        const user = _state.cu;
        if (!user || !prospect) return false;
        const level = _getUserLevel(user);
        if (level <= 2) return true;
        if (level <= 10) {
            const visibleIds = await getVisibleUserIds(user);
            if (visibleIds === 'all') return true;
            return visibleIds.some(id => String(id) === String(prospect.responsible_agent_id));
        }
        return String(prospect.responsible_agent_id) === String(user.id);
    };
    // Current view (read-only reference)
    const _getCurrentView = () => _state.cv;
    // safeUrl — for stored/agent-controllable values interpolated into href/src.
    // Drops dangerous schemes (javascript:/vbscript:/file:) to prevent click-XSS,
    // then HTML-escapes so a value with a double-quote can't break out of the
    // attribute. Allows http(s), data:, blob:, and relative/anchor URLs.
    const safeUrl = (u) => {
        const s = String(u == null ? '' : u).trim();
        if (/^\s*(javascript|vbscript|data:text\/html|file):/i.test(s)) return '#';
        return escapeHtml(s);
    };

let _sortField = 'score';
let _sortDirection = 'desc';
// ── Pagination state for prospects table ──
let _prospectPage = 0;
const _prospectPageSize = 50;
let _prospectViewMode = 'table';
const _selectedProspects = new Set();
// ── Purchases history cache (chunk-local) ──
// _purchasesHistoryCache / _purchasesHistoryCacheTs promoted to window._appState.phc/phcts (SEAM-3) — shared prospects-core <-> approvals.
// (backed by `let` in script.js; both chunks reference _state.phc / _state.phcts)
let _phFilter = { search: '', agent: 'all', delivery: 'all', from: '', to: '' };
let _phPage = 0;

// ── Phase 1 (#12): shared server-pagination helper ───────────────────────────
// Fetch ONE page (server-filtered/sorted/paginated) via queryAdvanced, with the
// role-visibility scope injected SERVER-side (pass scopeBy: [columns]). Returns
// { data, count, used:true } on success, or { used:false } on the hasLiveSession
// guard / any error so the caller cleanly falls back to its legacy client path.
// Shared by the customers + prospects lists; promote to _crmUtils when a 3rd
// chunk adopts it (UPGRADE.md Phase 4).
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

// Dormancy-curated, scoped, server-side prospect page via the prospects_page
// RPC. Unlike _serverPage (plain queryAdvanced), this hides >500-day-dormant
// prospects while KEEPING never-contacted ones — exact parity with the legacy
// getActiveProspects rule — and scopes by role hierarchy in the same call.
// Resolves the visibility scope to a bigint[] (null = unrestricted for
// admin/manager). Returns { data, count, used } or { used:false } on any
// guard/error so renderProspectsTable cleanly falls back to its legacy path.
const _serverProspectsPage = async ({ search, mingGua, agentFilter, includeDormant, sortField, sortDir, limit, offset }) => {
    try {
        let visibleAgentIds = null; // null = unrestricted (admin/manager)
        if (!isSystemAdmin(_state.cu)) {
            const visible = await getVisibleUserIds(_state.cu);
            if (visible && visible !== 'all' && Array.isArray(visible)) {
                visibleAgentIds = visible.map(Number).filter(n => Number.isFinite(n));
            }
        }
        const sortMap = { name: 'full_name', score: 'score', activity: 'last_activity_date' };
        const res = await AppDataStore.prospectsPage({
            visibleAgentIds,
            search:  search || null,
            mingGua: mingGua || null,
            agentId: agentFilter ? Number(agentFilter) : null,
            includeDormant: !!includeDormant,
            sort:    sortMap[sortField] || 'score',
            sortDir: sortDir || 'desc',
            limit, offset,
        });
        return { data: res.data || [], count: res.count || 0, used: true };
    } catch (e) {
        console.warn('[prospectsPage] RPC → client fallback:', e?.message || e);
        return { used: false };
    }
};

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

            <!-- Phase 4.3 (#13): React island mount target. renderProspectsTable
                 swaps visibility between this and the legacy table below when the
                 opt-in React prospects path is active (server-eligible only). -->
            <div id="prospects-react-root" style="display:none;"></div>

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

const _downloadSheet = async (cols, rows, sheetName, filename, format) => {
    if (format === 'xlsx') {
        await window._ensureXlsx();
        const ws = XLSX.utils.aoa_to_sheet([cols, ...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        XLSX.writeFile(wb, `${filename}.xlsx`);
    } else {
        // Neutralize CSV/formula injection: a cell that a spreadsheet would treat as
        // a formula (leading = + - @, or a leading tab/CR) is prefixed with a single
        // quote so it opens as literal text — but genuine numbers (incl. negatives
        // like -500) are left intact so amount columns still parse.
        const _csvCell = (v) => {
            let s = String(v == null ? '' : v);
            if (/^[=+\-@\t\r]/.test(s) && !/^[-+]?\d[\d,.]*$/.test(s)) s = "'" + s;
            return `"${s.replace(/"/g, '""')}"`;
        };
        const csvRows = [cols, ...rows].map(r => r.map(_csvCell).join(','));
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
    if (!_state.cu) return [];
    if (isSystemAdmin(_state.cu)) return all;
    const visibleIds = await getVisibleUserIds(_state.cu);
    if (visibleIds === 'all') return all;
    const visible = new Set(visibleIds.map(String));
    return all.filter(p => visible.has(String(p.responsible_agent_id)));
};

const _getAllActivitiesForExport = async () => {
    const all = await AppDataStore.getAllPaged('activities', { pageSize: 1000 });
    if (!_state.cu) return [];
    if (isSystemAdmin(_state.cu)) return all;
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
        const data = isSystemAdmin(_state.cu)
            ? all
            : await (async () => {
                const visIds = await getVisibleUserIds(_state.cu);
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
        // Authz: the agents export leaks IC numbers, emails, and commission rates for
        // every user. Gate it to Super Admin / Management — siblings (prospects/customers)
        // scope by getVisibleUserIds, but staff PII must not be exported by the agent band.
        if (!(isSystemAdmin(_state.cu) || isManagement(_state.cu))) {
            UI.toast.error('You do not have permission to export staff records');
            return;
        }
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

// ── Phase 4.3 (#13): React-island prospects path ─────────────────────────────
// Engages when the opt-in island bundle is loaded AND the flag is on (?react=1 /
// localStorage crm_react_island=1 / window.__REACT_PROSPECTS===true) and not
// killed (window.__REACT_PROSPECTS===false). Opt-in bundle → never normal users.
const _reactProspectsOn = () => {
    try {
        // DEFAULT ON (promoted 2026-06-14). Kill-switch → legacy table:
        //   window.__REACT_PROSPECTS===false, ?react=0, or localStorage crm_react_off='1'.
        if (window.__REACT_PROSPECTS === false) return false;
        if (/[?&]react=0/.test(location.search)) return false;
        if (localStorage.getItem('crm_react_off') === '1') return false;
        return !!(window.CRMReact && typeof window.CRMReact.mountProspectsTable === 'function');
    } catch (_) { /* intentional: feature-detection probe — any failure means React island unavailable */ return false; }
};
const _showProspectsReactRoot = (useReact) => {
    const root   = document.getElementById('prospects-react-root');
    if (root) root.style.display = useReact ? '' : 'none';
    // Only manage the legacy table-view visibility in TABLE mode — in card mode
    // toggleProspectView owns the table-view/card-view swap, so don't fight it.
    const legacy = document.getElementById('prospects-table-view');
    if (legacy && _prospectViewMode !== 'card') legacy.style.display = useReact ? 'none' : '';
};

// ── Internal render-builders (extracted from renderProspectsTable) ─────────
// Pure string assembly — no DOM mutation, no fetches, no control-flow side
// effects. Kept byte-for-byte equivalent to the inline templates they replace.
// REND-5: the agent <select> renders one <option> per active agent in EVERY
// row. The value + escaped name are identical across rows — only the `selected`
// flag varies by p.responsible_agent_id. Build the per-agent option parts ONCE
// (pre/post split so we inject `selected` without re-escaping names per row) and
// reuse them. Output is byte-identical to the old inline map: not-selected →
// `<option value="ID" >NAME</option>`, selected → `<option value="ID" selected>NAME</option>`.
const _buildAgentOptionParts = (activeAgents) =>
    activeAgents.map(a => ({
        idStr: String(a.id),
        pre: `<option value="${a.id}" `,
        post: `>${escapeHtml(a.full_name || 'Agent')}</option>`,
    }));

const buildProspectRowHtml = (p, ctx) => {
    const { userById, canReassign, canDelete, activeAgents } = ctx;
    // Reuse the cached option parts when present (built once per render); fall
    // back to building them on the fly so the function stays correct if called
    // without a prepared cache (e.g. future callers).
    const _agentOptParts = ctx.agentOptionParts || _buildAgentOptionParts(activeAgents);
    const grade = getScoreGrade(p.score);
    const daysLeft = calculateProtectionDays(p);
    const protectionStatus = getProtectionStatus(daysLeft);
    const _protTerminal = p.status === 'converted' || p.status === 'lost'; // #8: closed deals aren't "Expired"
    const _noProt = !p.protection_deadline; // #13: an unset deadline isn't "Expired", it's "Not set"
    const protFillClass = (_protTerminal || _noProt) ? 'normal' : (daysLeft <= 0 ? 'expired' : protectionStatus);
    const daysClass = (_protTerminal || _noProt) ? 'days-normal' : (daysLeft <= 0 ? 'days-expired' : (daysLeft <= 7 ? 'days-critical' : (daysLeft <= 14 ? 'days-warning' : 'days-normal')));
    const daysLabel = _protTerminal ? (p.status === 'converted' ? '✓ Customer' : 'Closed') : (_noProt ? 'Not set' : (daysLeft <= 0 ? 'Expired' : `${daysLeft}d left`));
    const relTime = timeAgo(p.last_activity_date);
    const lastActivityHtml = p.last_activity_date
        ? `<span style="font-weight:600;color:var(--text-primary);">${relTime}</span><br><span class="la-date" style="font-size:11px;color:var(--text-secondary);">${escapeHtml(p.last_activity_date)}</span>`
        : '<span style="color:var(--text-secondary);font-style:italic;">No activity</span>';
    const agent = userById.get(String(p.responsible_agent_id));
    const agentName = agent ? agent.full_name : '—';
    const isSelected = _selectedProspects.has(p.id);

    return `
            <tr onclick="app.showProspectDetail(${p.id})" class="${(p.unable_to_serve || p.manual_grade === 'F') ? 'row-unable' : ''}">
                <td class="prospect-select-cell" onclick="event.stopPropagation()">
                    <input type="checkbox" data-pid="${p.id}" ${isSelected ? 'checked' : ''} onchange="app.toggleProspectSelect(${p.id})">
                </td>
                <td data-label="Name">
                    <strong class="${(p.unable_to_serve || p.manual_grade === 'F') ? 'name-unable' : ''}">${escapeHtml(p.full_name || '(No Name)')}</strong>
                    ${p.phone ? `<br><span style="font-size:12px;color:var(--text-secondary);">${escapeHtml(p.phone)}</span>` : ''}
                    ${p.unable_to_serve ? `<br><span class="badge-unable">Unable to Serve</span>` : ''}${p.manual_grade === 'F' ? `<br><span class="badge-unable">Dropped (F)</span>` : ''}
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
                    })()}${(() => {
                        const _pid = String(p.responsible_agent_id);
                        let _opts = '';
                        for (const o of _agentOptParts) _opts += o.pre + (o.idStr === _pid ? 'selected' : '') + o.post;
                        return _opts;
                    })()}</select>`
                    : (p.responsible_agent_id ? escapeHtml(agentName) : '')}</td>
                <td data-label="Score">
                    <span class="score-badge score-${grade.replace('+', '-plus')}">${p.score || 0} (${grade})</span>
                </td>
                <td data-label="Ming Gua">${p.ming_gua || '—'}</td>
                <td data-label="Occupation">${escapeHtml((p.occupation || '') + (p.company_name ? ' · ' + p.company_name : ''))}</td>
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
                        ${(isSystemAdmin(_state.cu) || isMarketingManager(_state.cu)) ? `<button class="btn-icon" title="Review & Approve Conversion" style="color:#d97706;" onclick="event.stopPropagation();app.showConversionApprovalModal(${p.id})"><i class="fas fa-check-circle"></i></button>` : ''}
                    ` : (p.status !== 'converted' ? `
                        <button class="btn-icon" title="Convert to Customer" onclick="app.convertToCustomer(${p.id})"><i class="fas fa-user-check"></i></button>
                    ` : '')}
                    ${canDelete ? `<button class="btn-icon" title="Delete" style="color:var(--red-500);" onclick="app.deleteProspect(${p.id})"><i class="fas fa-trash"></i></button>` : ''}
                </td>
            </tr>
        `;
};

const buildProspectsEmptyHtml = (searchQueryRaw, agentFilter, includeDormantToggle) => {
    const hint = searchQueryRaw
        ? `No prospects matched "<strong>${searchQueryRaw.replace(/</g, '&lt;')}</strong>". Dormant records were included in this search.`
        : (agentFilter
            ? 'No prospects found for this agent.'
            : (includeDormantToggle
                ? 'No prospects found. Click "Add Prospect" to create one.'
                : 'No active prospects. Check "Include dormant" or type a name/phone to search older records.'));
    return `<tr><td colspan="9" style="text-align:center; padding:40px;">${hint}</td></tr>`;
};

const buildProspectsStatsHtml = (prospects, totalCount) => {
    // REND-6: fold the three full-array passes (highScore filter + active30
    // filter + avgScore reduce) into a single loop over the whole set so we
    // scan `prospects` once per render instead of three times. Numbers are
    // identical — same per-item predicates, same `now` captured once.
    const totalAll = prospects.length;
    const now = Date.now();
    let highScore = 0, active30 = 0, scoreSum = 0;
    for (const p of prospects) {
        const s = p.score || 0;
        scoreSum += s;
        if (s >= 70) highScore++;
        if (p.last_activity_date && (now - new Date(p.last_activity_date).getTime()) <= 30 * 86400000) active30++;
    }
    const avgScore = totalAll ? Math.round(scoreSum / totalAll) : 0;
    return `
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
    // ── PHASE 1 (#12): server-side pagination (flagged, default OFF) ────────
    // Engages only when no DERIVED filter is active (score-grade / protection-
    // status are computed client-side, not columns) and the sort key is a real
    // column. Paginates the scoped/searched/filtered set server-side via
    // queryAdvanced — ONE page, not the whole active-prospect set. NOTE: this
    // page is not dormancy-curated (pagination already bounds the load, and
    // hiding never-contacted prospects via a date cutoff would wrongly drop
    // brand-new ones). With the prospects_page RPC applied (2026-06-14) the
    // server path now routes through _serverProspectsPage, which DOES curate
    // dormancy server-side (hide >500-day-dormant, keep never-contacted) — exact
    // parity with the legacy getActiveProspects rule. An agent filter (or the
    // "include dormant" toggle) forces include-dormant so the agent's full list
    // shows, mirroring the legacy includeDormant:!!agentFilter behavior.
    const _sortColMap = { name: 'full_name', score: 'score', activity: 'last_activity_date' };
    // Market scope (boss/mgmt drill-down). A specific market forces the legacy
    // client-filter path (server/BFF page query has no country param yet); ALL =
    // no-op (agents are always ALL).
    const _mktScope = window._crmUtils.listCountryScope();
    const _mktScoped = _mktScope !== window._crmUtils.ALL_COUNTRIES;
    const _pUnsupported = !!scoreFilter || !!statusFilter || !_sortColMap[_sortField] || _mktScoped;

    // ── Phase 4.3 (#13): React-island render path (opt-in bundle + flag) ───────
    // Server-eligible only — same gate as the BFF/server path: table view, no
    // derived score/status filter, sort ∈ name/score/activity. Card view +
    // unsupported filters / protection sort fall through to the legacy DOM render.
    if (_reactProspectsOn() && !_pUnsupported && _prospectViewMode !== 'card') {
        const reactRoot = document.getElementById('prospects-react-root');
        if (reactRoot) {
            try {
                const allUsersR = await AppDataStore.getAll('users', { includeDeleted: true });
                const _lvlR = _getUserLevel(_state.cu);
                const _canReassignR = _lvlR <= 5;
                const _scopeIdsR = _lvlR <= 2 ? null : await getVisibleUserIds(_state.cu);
                const _scopeSetR = (_scopeIdsR && _scopeIdsR !== 'all' && Array.isArray(_scopeIdsR)) ? new Set(_scopeIdsR.map(String)) : null;
                const _visAgentsR = allUsersR.filter(u => {
                    const lvl = _getUserLevel(u);
                    if (!(lvl >= 3 && lvl <= 11 && u.status !== 'deleted')) return false;
                    if (_scopeSetR) return _scopeSetR.has(String(u.id));
                    return true;
                });
                // Populate the agent-filter dropdown (mirrors the legacy path) so
                // agent filtering works on the React path too.
                const agentFilterEl = document.getElementById('filter-agent');
                const filterPanelOpen = document.getElementById('prospect-adv-filters')?.style.display !== 'none';
                if (agentFilterEl && (filterPanelOpen || !agentFilterEl.dataset.hydrated)) {
                    const curVal = agentFilterEl.value;
                    const sorted = _visAgentsR.slice().sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
                    agentFilterEl.innerHTML = '<option value="">All Agents</option>' +
                        sorted.map(a => `<option value="${a.id}"${String(a.id) === curVal ? ' selected' : ''}>${esc(a.full_name || 'Agent')}</option>`).join('');
                    agentFilterEl.dataset.hydrated = '1';
                }
                _showProspectsReactRoot(true);
                window.CRMReact.mountProspectsTable(reactRoot, {
                    params: {
                        q: searchQueryRaw,
                        gua: guaFilter,
                        agent: agentFilter,
                        sortField: _sortField,
                        sortDir: _sortDirection,
                        // A search term must reach dormant/older records too — mirrors the
                        // legacy searchProspects({ includeDormant: true }) contract (see the
                        // dormancy comment above + the empty-state "type a name/phone to
                        // search older records" hint). Without this, phone/name searches on
                        // the React path silently miss prospects inactive > 500 days.
                        dormant: includeDormantToggle || !!agentFilter || !!searchQueryRaw,
                        page: _prospectPage,
                    },
                    pageSize: _prospectPageSize,
                    meta: {
                        canReassign: _canReassignR,
                        canDelete: _lvlR <= 5,
                        isAdmin: isSystemAdmin(_state.cu),
                        isMktMgr: isMarketingManager(_state.cu),
                        agents: _canReassignR ? _visAgentsR.map(a => ({ id: a.id, full_name: a.full_name || 'Agent' })) : [],
                        agentNames: Object.fromEntries(allUsersR.map(u => [String(u.id), u.full_name || ''])),
                        selectedIds: Array.from(_selectedProspects),
                    },
                    onNavigate: async (page) => { _prospectPage = Math.max(0, page | 0); await renderProspectsTable(); },
                });
                updateProspectBulkBar();
                return;
            } catch (e) {
                console.warn('[react-prospects] mount failed → legacy:', e?.message || e);
                _showProspectsReactRoot(false);
            }
        }
    }
    // Not using the React path → ensure the legacy table is the visible one.
    _showProspectsReactRoot(false);

    let allProspects, allUsers, _usedServerP = false, _serverProspectCount = 0;
    if (window.__SERVER_TABLES && !_pUnsupported) {
        const [r, users] = await Promise.all([
            _serverProspectsPage({
                search: searchQuery,
                mingGua: guaFilter,
                agentFilter,
                // Search term → include dormant (same contract as the React path + legacy).
                includeDormant: includeDormantToggle || !!agentFilter || !!searchQueryRaw,
                sortField: _sortField,
                sortDir: _sortDirection,
                limit: _prospectPageSize,
                offset: _prospectPage * _prospectPageSize,
            }),
            AppDataStore.getAll('users', { includeDeleted: true }),
        ]);
        allUsers = users;
        if (r.used) { allProspects = r.data; _serverProspectCount = r.count; _usedServerP = true; }
    }
    if (!_usedServerP) {
        const prospectsPromise = searchQueryRaw
            ? AppDataStore.searchProspects(searchQueryRaw, { includeDormant: true, limit: 200 })
            : AppDataStore.getActiveProspects({ includeDormant: includeDormantToggle || !!agentFilter, fresh: !!agentFilter });
        // includeDeleted users so deleted-staff owners still resolve in the Agent column.
        const [_p, _u] = await Promise.all([
            prospectsPromise,
            allUsers ? Promise.resolve(allUsers) : AppDataStore.getAll('users', { includeDeleted: true }),
        ]);
        allProspects = _p; allUsers = _u;
    }
    _mark('prospects+users-loaded');

    // ── Scope by role hierarchy ──
    let prospects;
    let _scopeVisibleIds = 'all'; // 'all' = no restriction; array = restrict to these agent IDs
    if (isSystemAdmin(_state.cu)) {
        prospects = allProspects;
    } else {
        _scopeVisibleIds = await getVisibleUserIds(_state.cu);
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
            visibleAgents.map(a => `<option value="${a.id}"${String(a.id) === currentAgentVal ? ' selected' : ''}>${escapeHtml(a.full_name || 'Agent')}</option>`).join('');
        agentFilterEl.dataset.hydrated = '1';
    }

    const _userLevel = _getUserLevel(_state.cu);
    const canDelete = _userLevel <= 5;
    const canReassign = _userLevel <= 5;
    const activeAgents = canReassign ? allUsers.filter(u => {
        const lvl = _getUserLevel(u);
        return lvl >= 3 && lvl <= 11 && u.status !== 'deleted';
    }) : [];

    // ── Apply sorting (skipped on the server path — already sorted server-side) ──
    // Sort a COPY: on the admin / 'all'-scope legacy path `prospects` aliases the
    // getActiveProspects/searchProspects SWR cache array, so sorting in place would
    // reorder the shared cache for every other reader. slice() decouples it.
    if (!_usedServerP) prospects = prospects.slice();
    if (!_usedServerP) prospects.sort((a, b) => {
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

    // ── Apply filters (skipped on the server path — already filtered server-side) ──
    let filtered = prospects;
    if (!_usedServerP) { filtered = []; for (const p of prospects) {
        if (_mktScoped && window._crmUtils.recordCountry(p) !== _mktScope) continue;
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
    } }

    // ── Pagination (server path already returned exactly one page) ──
    const pageStart = _prospectPage * _prospectPageSize;
    const totalCount = _usedServerP ? _serverProspectCount : filtered.length;
    const pageProspects = _usedServerP ? filtered : filtered.slice(pageStart, pageStart + _prospectPageSize);

    // ── Progressive Last Activity render ──────────────────────────────
    // `last_activity_date` is already a column on prospects rows (kept in
    // sync by a DB trigger on activities inserts). Use it for instant
    // first render — no extra round-trip. We fire getLatestActivities in
    // the background ONLY for the activity_type suffix (e.g. "Meet Up").
    // When it resolves, we patch just those cells via data-la-id selectors.
    // This decouples the 307 ms activities query from the table's first paint.
    _mark('latest-activities-loaded'); // updated once background fetch resolves

    // REND-5: build the agent <select> option parts ONCE (escapes each agent
    // name a single time) and share them across every row via the ctx, instead
    // of re-mapping + re-escaping activeAgents inside buildProspectRowHtml per row.
    const _rowCtx = {
        userById, canReassign, canDelete, activeAgents,
        agentOptionParts: canReassign ? _buildAgentOptionParts(activeAgents) : [],
    };
    let html = '';
    for (const p of pageProspects) {
        html += buildProspectRowHtml(p, _rowCtx);
    }

    if (pageProspects.length === 0) {
        html = buildProspectsEmptyHtml(searchQueryRaw, agentFilter, includeDormantToggle);
    }

    tbody.innerHTML = html;

    // ── Stats row ──────────────────────────────────────────────────────
    const statsEl = document.getElementById('prospect-stats-row');
    if (statsEl) {
        statsEl.innerHTML = buildProspectsStatsHtml(prospects, totalCount);
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
    const userLevel = _getUserLevel(_state.cu);
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
    const userLevel = _getUserLevel(_state.cu);
    if (userLevel > 5) {
        UI.hideModal();
        UI.toast.error('You do not have permission to delete prospects.');
        return;
    }
    UI.hideModal();
    try {
        const [acts, notesByFk, notesByEntity, names, referrals] = await Promise.all([
            AppDataStore.query('activities', { prospect_id: id }).catch(() => []),
            // Indexed lookups instead of downloading the whole notes table.
            AppDataStore.query('notes', { prospect_id: id }).catch(() => []),
            AppDataStore.query('notes', { entity_type: 'prospect', entity_id: id }).catch(() => []),
            AppDataStore.query('names', { prospect_id: id }).catch(() => []),
            AppDataStore.query('referrals', { referred_prospect_id: id }).catch(() => []),
        ]);
        const notesMap = new Map();
        for (const n of [...notesByFk, ...notesByEntity]) notesMap.set(n.id, n);
        const notes = [...notesMap.values()];
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
    // Use the documented edit policy (canEditProspect) — same as the edit modal
    // and saveProspect — so L6-L10 uplines can grade a subordinate's record
    // instead of being blocked by the stricter lvl<=5-or-owner gate.
    if (!(await canEditProspect(prospect))) {
        UI.toast.error('You cannot set the grade for this prospect.');
        return;
    }
    const current = prospect.manual_grade || '';
    // A–F potential grade — sets the follow-up RHYTHM (drives the cadence engine).
    // F = drop: greyed out, off all reminders. (Legacy E/G map nowhere; collapsed to A–F.)
    const GRADE_META = {
        A: { label: 'Close now',  sub: 'very high · ~3d',  color: '#16a34a' },
        B: { label: 'Warming up', sub: 'needs time · ~10d', color: '#2563eb' },
        C: { label: 'Half-half',  sub: 'either way · ~21d', color: '#d97706' },
        D: { label: 'Very far',   sub: 'long-shot · ~30d',  color: '#6b7280' },
        F: { label: 'Drop it',    sub: 'off monitoring',    color: '#dc2626' },
    };
    const grades = ['A', 'B', 'C', 'D', 'F'];
    const btn = (g) => {
        const m = GRADE_META[g];
        const active = g === current;
        return `<button type="button" onclick="(async () => { await app.setProspectGrade(${prospectId}, '${g}'); })()" style="display:flex;flex-direction:column;align-items:center;gap:2px;padding:12px 6px;border-radius:10px;border:2px solid ${active ? m.color : 'var(--gray-300)'};background:${active ? m.color : '#fff'};color:${active ? '#fff' : 'var(--gray-800)'};cursor:pointer;transition:all .15s;">
            <span style="font-size:20px;font-weight:700;line-height:1;">${g}</span>
            <span style="font-size:12px;font-weight:600;">${m.label}</span>
            <span style="font-size:10px;opacity:.85;">${m.sub}</span>
        </button>`;
    };
    const content = `
        <div style="padding:4px 0;">
            <p style="margin:0 0 14px;color:var(--gray-600);font-size:14px;">Grade <strong>${escapeHtml(prospect.full_name || 'this prospect')}</strong> — sets the follow-up rhythm. <span style="color:var(--gray-400);">F greys them out (off all reminders).</span></p>
            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;">
                ${grades.map(btn).join('')}
            </div>
            <div style="text-align:center;margin-top:14px;">
                <button type="button" onclick="(async () => { await app.setProspectGrade(${prospectId}, null); })()" style="padding:8px 18px;font-size:13px;border-radius:8px;border:1px solid var(--gray-300);background:#fff;color:var(--gray-500);cursor:pointer;" title="Clear grade">Clear grade</button>
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
    // Parse 'YYYY-MM-DD' as LOCAL midnight (not UTC) so the deadline day isn't
    // marked Expired from 08:00 MYT. Compare whole local calendar days.
    const parts = String(prospect.protection_deadline).split('T')[0].split('-');
    const deadline = new Date(+parts[0], (+parts[1] || 1) - 1, +parts[2] || 1);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round((deadline - today) / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
};

const getProtectionStatus = (days) => {
    if (days > 7) return 'normal';
    if (days > 0) return 'warning';
    return 'critical';
};

const calculateDaysLeft = (deadline) => {
    if (!deadline) return 0;
    // Parse date-only 'YYYY-MM-DD' as LOCAL midnight (not UTC) and diff whole
    // local calendar days, so a same-day deadline isn't shown Expired at 08:00 MYT.
    const parts = String(deadline).split('T')[0].split('-');
    const dl = new Date(+parts[0], (+parts[1] || 1) - 1, +parts[2] || 1);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const d = Math.round((dl - today) / 86400000);
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
        const _protTerminal = p.status === 'converted' || p.status === 'lost'; // #8: closed deals aren't "Expired"
        const _noProt = !p.protection_deadline; // #13: an unset deadline isn't "Expired", it's "Not set"
        const protFillClass = (_protTerminal || _noProt) ? 'normal' : (daysLeft <= 0 ? 'expired' : getProtectionStatus(daysLeft));
        const daysClass = (_protTerminal || _noProt) ? 'days-normal' : (daysLeft <= 0 ? 'days-expired' : (daysLeft <= 7 ? 'days-critical' : (daysLeft <= 14 ? 'days-warning' : 'days-normal')));
        const daysLabel = _protTerminal ? (p.status === 'converted' ? '✓ Customer' : 'Closed') : (_noProt ? 'Not set' : (daysLeft <= 0 ? 'Expired' : `${daysLeft}d left`));
        const agent = userById.get(String(p.responsible_agent_id));
        const agentName = agent ? agent.full_name : '—';
        const relTime = timeAgo(p.last_activity_date);
        const color = getAvatarColor(p.full_name);
        const initials = getInitials(p.full_name);
        const pct = Math.min(100, daysLeft <= 0 ? 100 : (daysLeft / 30) * 100);
        return `
            <div class="prospect-card${(p.unable_to_serve || p.manual_grade === 'F') ? ' row-unable' : ''}" onclick="app.showProspectDetail(${p.id})">
                <div class="prospect-card-header">
                    <div class="prospect-card-avatar" style="background:${color};">${initials}</div>
                    <div style="flex:1;min-width:0;">
                        <div class="prospect-card-name${(p.unable_to_serve || p.manual_grade === 'F') ? ' name-unable' : ''}">${escapeHtml(p.full_name || '(No Name)')}</div>
                        ${p.phone ? `<div class="prospect-card-phone">${escapeHtml(p.phone)}</div>` : ''}
                        ${p.unable_to_serve ? `<span class="badge-unable">Unable to Serve</span>` : ''}${p.manual_grade === 'F' ? `<span class="badge-unable">Dropped (F)</span>` : ''}
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
        const lvl = _getUserLevel(_state.cu);
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
    const lvl = _getUserLevel(_state.cu);
    if (lvl > 5) { UI.toast.error('You do not have permission to delete prospects.'); return; }
    const n = _selectedProspects.size;
    if (!n) return;
    if (!confirm(`Delete ${n} selected prospect${n > 1 ? 's' : ''}? This cannot be undone.`)) return;
    let errors = 0;
    for (const id of _selectedProspects) {
        try {
            // Match the single-delete path: clean up linked children first so
            // activities/notes/names/referrals don't dangle after the prospect goes.
            const [acts, notesByFk, notesByEntity, names, referrals] = await Promise.all([
                AppDataStore.query('activities', { prospect_id: id }).catch(() => []),
                AppDataStore.query('notes', { prospect_id: id }).catch(() => []),
                AppDataStore.query('notes', { entity_type: 'prospect', entity_id: id }).catch(() => []),
                AppDataStore.query('names', { prospect_id: id }).catch(() => []),
                AppDataStore.query('referrals', { referred_prospect_id: id }).catch(() => []),
            ]);
            const notesMap = new Map();
            for (const nn of [...notesByFk, ...notesByEntity]) notesMap.set(nn.id, nn);
            const notes = [...notesMap.values()];
            await Promise.all([
                acts.length ? AppDataStore.deleteMany('activities', acts.map(a => a.id)) : Promise.resolve(),
                notes.length ? AppDataStore.deleteMany('notes', notes.map(nn => nn.id)) : Promise.resolve(),
                names.length ? AppDataStore.deleteMany('names', names.map(nn => nn.id)) : Promise.resolve(),
                referrals.length ? AppDataStore.deleteMany('referrals', referrals.map(r => r.id)) : Promise.resolve(),
            ]);
            await AppDataStore.delete('prospects', id);
        }
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
    // The form body (buildBasicInfoBlock) + its handlers (searchBasicInfoReferrers,
    // collectBasicInfoData, prefillProspectChildren) are owned by the activities chunk
    // and referenced synchronously below. If that chunk hasn't loaded yet the template's
    // `(window.app.buildBasicInfoBlock || (() => ''))` fallback fires → an empty modal
    // (only the "Basic Information" header, no fields). Warm the chunk first.
    if (typeof window._loadChunk === 'function') {
        try { await window._loadChunk('chunks/script-activities.min.js'); } catch (_) { /* intentional: fall through to the guard below */ }
    }
    if (typeof window.app.buildBasicInfoBlock !== 'function') {
        UI.toast.error('Could not load the prospect form. Please reload and try again.');
        return;
    }
    const prospect = prospectId ? await AppDataStore.getById('prospects', prospectId) : null;
    if (prospectId) {
        if (!prospect) {
            UI.toast.error('Prospect not found.');
            return;
        }
        // Use the documented edit policy (canEditProspect) that saveProspect
        // enforces at save time — L1-2 anything, L3-10 team/subordinate records,
        // L11+ own only. The previous lvl<=5-or-owner gate was stricter than the
        // save path and blocked L6-L10 uplines editing a subordinate's record.
        if (!(await canEditProspect(prospect))) {
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

    // Pre-populate children rows after modal mounts; reveal the assign-on-behalf
    // picker (leader keying for an agent) — both owned by the activities chunk.
    setTimeout(() => {
        (window.app.prefillProspectChildren || (() => {}))(prospect?.children);
        (window.app.populateAssignAgentPicker || (() => {}))('prospect');
    }, 0);
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
        if (!snapshotBefore) { UI.toast.error('Prospect not found'); return; }
        // Enforce the documented edit policy (canEditProspect): view-scope (L3-11
        // upline) is broader than edit-scope (L11+ = own records only), so re-check
        // here — canViewProspect upstream is NOT a sufficient edit gate.
        if (!(await canEditProspect(snapshotBefore))) {
            UI.toast.error('You do not have permission to edit this prospect.');
            return;
        }
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
            const isManager = isSystemAdmin(_state.cu) || isMarketingManager(_state.cu);
            const isConverted = snapshotBefore?.status === 'converted';
            if (!isManager && isConverted) {
                try {
                    await AppDataStore.create('approval_queue', {
                        approval_type: 'info_update',
                        status: 'pending',
                        prospect_id: parseInt(editId),
                        customer_id: null,
                        submitted_by: _state.cu?.id,
                        submitted_at: new Date().toISOString(),
                        snapshot_before: snapshotBefore,
                        snapshot_after: data,
                        description: `Information update for ${name}`
                    });
                } catch (e) {
                    console.warn('[approval_queue] info_update insert failed', e);
                    try { if (window.UI && UI.toast) (UI.toast.warning || UI.toast.error)('Changes saved, but the approval record could not be created. Please retry or notify an admin.'); } catch (_) {}
                }
            }
        } else {
            data.id = window.AppDataStore._generateId();
            data.protection_deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            data.score = SCORING_RULES.CREATE_PROSPECT;
            // Create-only fields — never overwritten on edit so the original agent keeps ownership
            // Assign-on-behalf (Phase 1): a leader may key this for one of their
            // agents via the picker → ownership lands on that agent. Falls back to
            // self when the picker is absent (normal agents) or left on "(me)".
            const _selfId = _state.cu?.id || null;
            const _assignSel = document.getElementById('prospect-assign-agent');
            const _assignedAgentId = (_assignSel && _assignSel.value) ? parseInt(_assignSel.value) : _selfId;
            data.responsible_agent_id = _assignedAgentId;
            data.cps_assignment_date  = new Date().toISOString().split('T')[0];
            data.pipeline_stage       = 'new';
            data.created_at = new Date().toISOString();
            const newProspect = await AppDataStore.create('prospects', data);
            // Phase 3 — trail: log the key-on-behalf handover so it's queryable
            // alongside real reassignments. Best-effort; never blocks the save.
            if (_assignedAgentId != null && String(_assignedAgentId) !== String(_selfId)) {
                const _now = new Date().toISOString();
                try {
                    await AppDataStore.create('reassignment_history', {
                        prospect_id: newProspect?.id || data.id,
                        from_agent_id: _selfId,
                        to_agent_id: _assignedAgentId,
                        reassigned_by: _selfId,
                        reassignment_date: _now,
                        reassignment_reason: 'assigned_at_creation',
                        reason_notes: `Keyed via Add Prospect by ${_state.cu?.full_name || 'leader'} for agent`,
                        days_inactive: 0,
                        protection_deadline: data.protection_deadline || '',
                        created_at: _now
                    });
                } catch (_h) { /* trail best-effort */ }
            }
            UI.toast.success(_assignedAgentId != null && String(_assignedAgentId) !== String(_selfId)
                ? 'Prospect created & assigned'
                : 'Prospect created successfully');
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
            // Fire configured Slack/Discord webhook for a new lead — guarded +
            // non-blocking: the gcal chunk (which owns dispatchWebhookEvent) may
            // not be loaded, and a webhook failure must never break the save.
            try {
                if (typeof window.app.dispatchWebhookEvent === 'function') {
                    window.app.dispatchWebhookEvent('new_lead', `New lead: ${data.full_name || 'Unnamed'}`, {
                        id: newProspect?.id || data.id,
                        name: data.full_name || '',
                        phone: data.phone || '',
                        email: data.email || '',
                        agent_id: data.responsible_agent_id || null,
                    });
                }
            } catch (e) { console.warn('new_lead webhook dispatch failed:', e); }
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

const buildProspectDetailHeaderHtml = (prospect, cpsPhoto) => {
    return `
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
                <button class="btn secondary btn-sm" onclick="app.goBackFromDetail()">
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
                    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin:6px 0 8px;min-width:0;">
                        <span style="font-size:22px;font-weight:700;line-height:1.3;word-break:break-word;">${escapeHtml(prospect.full_name)}</span>${prospect.nickname ? `<span style="font-size:15px;font-weight:400;color:var(--gray-500);">"${escapeHtml(prospect.nickname)}"</span>` : ''}
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 8px;">
                        <button title="Edit" aria-label="Edit prospect" onclick="app.editProspect(${prospect.id})" style="width:30px;height:30px;border-radius:50%;border:1px solid var(--gray-300);background:#fff;color:var(--gray-500);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;" onmouseover="this.style.background='var(--gray-100)'" onmouseout="this.style.background='#fff'"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></button><button title="Convert to Customer" aria-label="Convert to customer" onclick="app.convertToCustomer(${prospect.id})" style="width:30px;height:30px;border-radius:50%;border:none;background:var(--primary);color:#fff;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'"><i class="fa-solid fa-user-check" aria-hidden="true"></i></button><button title="Meet-Up History" aria-label="Meet-up history" onclick="app.openMeetupHistoryModal(${prospect.id})" style="width:30px;height:30px;border-radius:50%;border:1px solid var(--gray-300);background:#fff;color:var(--primary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;" onmouseover="this.style.background='var(--gray-100)'" onmouseout="this.style.background='#fff'"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i></button><button title="Save to Phone Contacts" aria-label="Save to phone contacts" onclick="app.downloadProspectVCard(${prospect.id})" style="width:30px;height:30px;border-radius:50%;border:1px solid var(--gray-300);background:#fff;color:var(--success);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;" onmouseover="this.style.background='var(--gray-100)'" onmouseout="this.style.background='#fff'"><i class="fa-solid fa-address-book" aria-hidden="true"></i></button><button title="WhatsApp Prospect" aria-label="Open WhatsApp chat with prospect" onclick="app.openProspectWhatsApp(${prospect.id}, '${UI.escJsAttr(_evWaPhone(prospect.phone))}')" style="width:30px;height:30px;border-radius:50%;border:1px solid var(--gray-300);background:#fff;color:#25D366;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;" onmouseover="this.style.background='var(--gray-100)'" onmouseout="this.style.background='#fff'"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i></button>
                    </div>
                </div>
                ${cpsPhoto ? `<img loading="lazy" decoding="async" data-attach-src="${escapeHtml(String(cpsPhoto.url))}" onclick="event.stopPropagation();app.zoomCpsPhoto('${UI.escJsAttr(String(cpsPhoto.url))}')" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:2px solid var(--gray-200);cursor:zoom-in;flex-shrink:0;margin-top:4px;" title="CPS Photo — click to enlarge">` : ''}
            </div>
`;
};

const buildProspectDetailTabsHtml = (prospect) => {
    return `
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

                    <!-- ⑦c Sales Orders (Destiny Code) -->
                    <div class="acc-item" id="acc-orders-${prospect.id}">
                        <div class="acc-hdr" onclick="app.toggleAccordion('orders',${prospect.id},this.parentElement)">
                            <span><i class="fas fa-shopping-cart"></i> Sales Orders (Destiny Code)</span>
                            <i class="fas fa-chevron-down acc-chev"></i>
                        </div>
                        <div class="acc-body" id="acc-body-orders-${prospect.id}" style="display:none" data-loaded="false"></div>
                    </div>

                    <!-- ⑦d Feng Shui Audit -->
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
};

const showProspectDetail = async (prospectId) => {
    // Snapshot originating view BEFORE any await — a concurrent navigateTo during
    // the async gap would overwrite _state.cv, corrupting the back-destination.
    const _fromView = _state.cv;
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
    _state.pvd = _fromView;
    _state.cdv = { type: 'prospect', id: prospectId };

    const container = document.getElementById('content-viewport');
    if (!container) return;

    const daysLeft = calculateProtectionDays(prospect);
    const protectionStatus = getProtectionStatus(daysLeft);
    const statusColor = protectionStatus === 'normal' ? 'success' : protectionStatus === 'warning' ? 'secondary' : 'error';
    const statusLabel = protectionStatus === 'normal' ? 'Normal' : protectionStatus === 'warning' ? 'Expiring Soon' : 'Critical';

    // CPS photo lives on the prospects.cps_attachment column (NOT on activity
    // rows, which have no such field and use activity_type not type). The old
    // activities.filter(a => a.type === 'CPS' && a.cps_attachment...) never
    // matched, so the thumbnail never rendered and the 500-row activities fetch
    // it required was pure waste on the header critical path. Read the column
    // directly and normalize to the { url } shape the header renderer expects.
    let cpsPhoto = prospect.cps_attachment || null;
    if (typeof cpsPhoto === 'string') cpsPhoto = cpsPhoto ? { url: cpsPhoto } : null;
    else if (cpsPhoto && !cpsPhoto.url) cpsPhoto = null;

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
        } catch (e) { /* intentional: best-effort pending-solution badge — absent badge is harmless */ }
    }, 100);

    container.innerHTML = buildProspectDetailHeaderHtml(prospect, cpsPhoto) + buildProspectDetailTabsHtml(prospect);
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
            <div class="pv-row"><span class="pv-lbl">Uploaded</span><span class="pv-val">${escapeHtml(prospect.cps_form_date || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">File</span><span class="pv-val">${escapeHtml(prospect.cps_form_name || 'CPS Form')}</span></div>
            ${isImage ? `
                <div style="margin-top:10px;text-align:center;">
                    <img loading="lazy" decoding="async" src="${safeUrl(cpsUrl)}" alt="CPS Form" style="max-width:100%;max-height:280px;border-radius:8px;border:1px solid var(--border);cursor:pointer;" onclick="window.open(this.src,'_blank')">
                    <div style="font-size:11px;color:var(--gray-400);margin-top:4px;">Tap to view full size</div>
                </div>
            ` : `
                <div style="margin-top:8px;">
                    <a href="${safeUrl(cpsUrl)}" target="_blank" rel="noopener" download="${escapeHtml(prospect.cps_form_name || 'cps_form.pdf')}" class="btn secondary btn-sm"><i class="fas fa-download"></i> Download</a>
                </div>
            `}
        ` : '';
        container.innerHTML = `
            <div class="pv-sub">Contact</div>
            <div class="pv-row"><span class="pv-lbl">Phone</span><span class="pv-val">${escapeHtml(prospect.phone || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Email</span><span class="pv-val">${escapeHtml(prospect.email || '-')}</span></div>
            <div class="pv-sub">Identity</div>
            <div class="pv-row"><span class="pv-lbl">Title</span><span class="pv-val">${escapeHtml(prospect.title || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Gender</span><span class="pv-val">${escapeHtml(prospect.gender || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Nationality</span><span class="pv-val">${escapeHtml(prospect.nationality || '-')}</span></div>
            <div class="pv-sub">Registration</div>
            <div class="pv-row"><span class="pv-lbl">Referrer</span><span class="pv-val">${escapeHtml(prospect.referred_by || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Relation</span><span class="pv-val">${escapeHtml(prospect.referral_relationship || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Created</span><span class="pv-val">${prospect.created_at ? new Date(prospect.created_at).toLocaleDateString() : '-'}</span></div>
            ${cpsHtml}
        `;
    }
    else if (tab === 'personal') {
        container.innerHTML = `
            <div class="pv-sub">Birth &amp; Identity</div>
            <div class="pv-row"><span class="pv-lbl" style="${prospect.life_chart_type === 'solar' ? 'font-weight:700;color:#dc2626;' : ''}">Date of Birth</span><span class="pv-val" style="display:flex;align-items:center;gap:8px;${prospect.life_chart_type === 'solar' ? 'font-weight:700;color:#dc2626;' : ''}"><input type="checkbox" ${prospect.life_chart_type === 'solar' ? 'checked' : ''} onchange="event.stopPropagation();app.toggleLifeChartType(${prospect.id},'solar',this.checked)" title="Use for life chart">${escapeHtml(prospect.date_of_birth || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl" style="${prospect.life_chart_type === 'lunar' ? 'font-weight:700;color:#dc2626;' : ''}">Lunar Birth</span><span class="pv-val" style="display:flex;align-items:center;gap:8px;${prospect.life_chart_type === 'lunar' ? 'font-weight:700;color:#dc2626;' : ''}"><input type="checkbox" ${prospect.life_chart_type === 'lunar' ? 'checked' : ''} onchange="event.stopPropagation();app.toggleLifeChartType(${prospect.id},'lunar',this.checked)" title="Use for life chart">${escapeHtml(prospect.lunar_birth || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">IC Number</span><span class="pv-val">${escapeHtml(prospect.ic_number || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Ming Gua</span><span class="pv-val"><span class="badge info">${prospect.ming_gua || '—'}</span></span></div>
            <div class="pv-sub">Family</div>
            <div class="pv-row"><span class="pv-lbl">Marital Status</span><span class="pv-val">${escapeHtml(prospect.marital_status || '-')}</span></div>
            ${(() => {
                let kids = [];
                try { kids = Array.isArray(prospect.children) ? prospect.children : (prospect.children ? JSON.parse(prospect.children) : []); } catch(e) { kids = []; }
                const count = kids.length;
                let html = `<div class="pv-row"><span class="pv-lbl">Children</span><span class="pv-val">${count}</span></div>`;
                kids.forEach((c, i) => {
                    const age = c.age || '-';
                    const gender = c.gender || '-';
                    html += `<div class="pv-row"><span class="pv-lbl">Child ${i + 1}</span><span class="pv-val">${escapeHtml(String(age))} y/o · ${escapeHtml(String(gender))}</span></div>`;
                });
                return html;
            })()}
            <div class="pv-sub">Employment</div>
            <div class="pv-row"><span class="pv-lbl">Occupation</span><span class="pv-val">${escapeHtml(prospect.occupation || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Company</span><span class="pv-val">${escapeHtml(prospect.company_name || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Job Description</span><span class="pv-val">${escapeHtml(prospect.job_description || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Title &amp; Role</span><span class="pv-val">${escapeHtml(prospect.emp_title_role || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Income Range</span><span class="pv-val">${escapeHtml(prospect.income_range || '-')}</span></div>
            <div class="pv-sub">Own Business</div>
            <div class="pv-row"><span class="pv-lbl">Own Business?</span><span class="pv-val">${prospect.is_own_business ? '✅ Yes' : (prospect.is_own_business === false ? 'No' : '-')}</span></div>
            ${prospect.is_own_business ? `
            <div class="pv-row"><span class="pv-lbl">Business Name</span><span class="pv-val">${escapeHtml(prospect.business_name || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Industry</span><span class="pv-val">${escapeHtml(prospect.business_industry || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Business Area</span><span class="pv-val">${escapeHtml(prospect.business_area || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Customer Title</span><span class="pv-val">${escapeHtml(prospect.business_title_role || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Operating Since</span><span class="pv-val">${escapeHtml(prospect.business_started || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Company Size</span><span class="pv-val">${escapeHtml(prospect.company_size || '-')}</span></div>
            ` : ''}
            <div class="pv-sub">Address</div>
            <div class="pv-row"><span class="pv-lbl">Address</span><span class="pv-val">${escapeHtml(prospect.address || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">City</span><span class="pv-val">${escapeHtml(prospect.city || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">State</span><span class="pv-val">${escapeHtml(prospect.state || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Postal Code</span><span class="pv-val">${escapeHtml(prospect.postal_code || '-')}</span></div>
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
                ${kind === 'ApuAppraisal' ? `<button class="btn secondary btn-sm" onclick="event.stopPropagation(); app.openGenerateEvoucherModal(${prospect.id})"><i class="fas fa-ticket-alt"></i> E-Voucher</button>` : ''}
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
        const vouchers = allAttachments.filter(a => a.attachment_type === 'evoucher');
        const nameIdSet = new Set(names.map(n => String(n.id)));
        // Per-name vouchers render on each name's row below. The strip here lists only
        // "loose" vouchers — ad-hoc ones (typed via the top button) or vouchers whose
        // Name List entry was deleted — so nothing is duplicated or orphaned off-screen.
        const looseVouchers = vouchers.filter(v => !(v.metadata && v.metadata.name_id != null && nameIdSet.has(String(v.metadata.name_id))));
        // Uniform circular icon-button: flex-shrink:0 stops the action row from
        // squeezing buttons into tall "pill" ovals when several share a narrow card.
        const vBtn = (bg, icon, fs, title, handler) =>
            `<button class="btn-icon" title="${title}" style="flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;background:${bg};color:#fff;width:30px;height:30px;min-width:30px;min-height:30px;border-radius:50%;font-size:${fs}px;padding:0;" onclick="event.stopPropagation(); ${handler}"><i class="${icon}"></i></button>`;
        const vouchersHtml = looseVouchers.length > 0 ? `
            <div style="background:var(--gray-50);border-radius:10px;padding:14px;margin-bottom:14px;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
                    <div style="font-weight:600;font-size:13px;"><i class="fas fa-ticket-alt" style="color:#7C3AED;margin-right:6px;"></i>Other E-Vouchers (${looseVouchers.length})</div>
                    ${looseVouchers.length > 1 ? `
                    <div style="display:flex;gap:8px;align-items:center;">
                        <label style="font-size:12px;color:var(--gray-600);display:flex;align-items:center;gap:5px;cursor:pointer;"><input type="checkbox" id="ev-selall-${prospect.id}" onclick="app.toggleAllEvouchers(${prospect.id}, this.checked)" style="cursor:pointer;"> Select all</label>
                        <button id="ev-fwd-${prospect.id}" class="btn primary btn-sm" disabled style="opacity:0.5;" onclick="app.forwardSelectedVouchers(${prospect.id}, '${UI.escJsAttr(String(prospect.phone || ''))}')" title="Forward all selected vouchers to ${escapeHtml(prospect.full_name || 'this person')} in one WhatsApp message"><i class="fab fa-whatsapp"></i> Forward (<span id="ev-cnt-${prospect.id}">0</span>)</button>
                    </div>` : ''}
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(164px,1fr));gap:14px;">
                    ${looseVouchers.map(v => {
                        const code = (v.metadata && v.metadata.voucher_code) || '';
                        const rname = (v.metadata && v.metadata.recipient_name) || (prospect.full_name || '');
                        const fname = `evoucher_${code || v.id}.png`;
                        const redeemed = !!(v.metadata && v.metadata.redeemed_at);
                        return `
                        <div style="position:relative;background:#fff;border:1px solid var(--gray-200);border-radius:10px;padding:10px;display:flex;flex-direction:column;align-items:center;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                            ${looseVouchers.length > 1 ? `<input type="checkbox" class="ev-sel-cb" data-att="${v.id}" data-code="${escapeHtml(code)}" data-rname="${escapeHtml(rname)}" data-url="${escapeHtml(String(v.file_url))}" data-fname="${escapeHtml(fname)}" onchange="app.updateEvoucherSelection(${prospect.id})" title="Select to forward together" style="position:absolute;top:8px;left:8px;width:18px;height:18px;cursor:pointer;z-index:2;accent-color:var(--primary);">` : ''}
                            <img loading="lazy" decoding="async" data-attach-src="${escapeHtml(String(v.file_url))}" style="width:100%;height:auto;border-radius:6px;border:1px solid var(--gray-100);cursor:pointer;" onclick="window._openAttachment && window._openAttachment('${UI.escJsAttr(String(v.file_url))}')">
                            <div style="display:flex;align-items:center;gap:6px;margin-top:8px;">
                                <span style="font-size:10px;color:var(--gray-500);font-family:monospace;">${escapeHtml(code)}</span>
                                ${redeemed ? `<span title="已使用" style="font-size:9px;background:#dcfce7;color:#059669;padding:2px 6px;border-radius:10px;white-space:nowrap;"><i class="fas fa-check"></i> 已用</span>` : ''}
                            </div>
                            <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;width:100%;margin-top:8px;">
                                ${vBtn('#25D366','fab fa-whatsapp',14,'Share via WhatsApp',`app.sendVoucherWhatsApp(${prospect.id}, ${v.id}, '${UI.escJsAttr(code)}', '${UI.escJsAttr(rname)}', '${UI.escJsAttr(String(prospect.phone || ''))}', '${UI.escJsAttr(String(v.file_url))}')`)}
                                ${vBtn('var(--gray-400)','fas fa-download',13,'Download',`app.downloadVoucher('${UI.escJsAttr(String(v.file_url))}','${UI.escJsAttr(fname)}')`)}
                                ${redeemed ? '' : vBtn('#059669','fas fa-check',13,'标记为已使用 (Mark redeemed)',`app.markVoucherRedeemed(${prospect.id}, ${v.id})`)}
                                ${vBtn('var(--error)','fas fa-times',13,'Remove',`app.removeEvoucher(${prospect.id}, ${v.id})`)}
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        ` : '';
        container.innerHTML = `
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
                <button class="btn secondary btn-sm" onclick="app.attachAppraisalForm(${prospect.id})"><i class="fas fa-file-image"></i> Appraisal Form${appraisalCount ? ` (${appraisalCount})` : ''}</button>
                <button class="btn secondary btn-sm" onclick="app.uploadAPUForm(null, ${prospect.id})"><i class="fas fa-paperclip"></i> APU Form${apuUrls.length ? ` (${apuUrls.length})` : ''}</button>
                <button class="btn secondary btn-sm" onclick="app.openGenerateEvoucherModal(${prospect.id})"><i class="fas fa-ticket-alt"></i> E-Voucher${vouchers.length ? ` (${vouchers.length})` : ''}</button>
                <button class="btn primary btn-sm" onclick="app.openAddNameModal(${prospect.id})"><i class="fas fa-plus"></i> Add Name</button>
            </div>
            ${vouchersHtml}
            ${names.length > 0 ? names.map(n => { const nv = vouchers.find(v => v.metadata && String(v.metadata.name_id) === String(n.id)); const nvCode = nv ? ((nv.metadata && nv.metadata.voucher_code) || '') : ''; return `
                <div style="background:var(--gray-50);border-radius:8px;padding:12px;margin-bottom:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <span style="font-weight:600;font-size:15px;">${escapeHtml(n.full_name || '')}</span>
                        <div style="display:flex;gap:6px;align-items:center;">
                            ${nv ? `
                                <img loading="lazy" decoding="async" data-attach-src="${escapeHtml(String(nv.file_url))}" title="View voucher ${escapeHtml(nvCode)}" style="height:34px;border-radius:4px;border:1px solid var(--gray-200);cursor:pointer;" onclick="event.stopPropagation(); window._openAttachment && window._openAttachment('${UI.escJsAttr(String(nv.file_url))}')">
                                <button class="btn-icon" title="Share voucher via WhatsApp" style="background:#25D366;color:#fff;border-radius:50%;width:28px;height:28px;font-size:13px;padding:0;" onclick="event.stopPropagation(); app.sendVoucherWhatsApp(${prospect.id}, ${nv.id}, '${UI.escJsAttr(nvCode)}', '${UI.escJsAttr(n.full_name || '')}', '${UI.escJsAttr(String(prospect.phone || ''))}', '${UI.escJsAttr(String(nv.file_url))}')"><i class="fab fa-whatsapp"></i></button>
                                ${(nv.metadata && nv.metadata.redeemed_at)
                                    ? `<span title="已使用" style="font-size:11px;background:#dcfce7;color:#059669;padding:3px 8px;border-radius:10px;white-space:nowrap;"><i class="fas fa-check"></i> 已用</span>`
                                    : `<button class="btn-icon" title="标记为已使用 (Mark redeemed)" style="background:#059669;color:#fff;border-radius:50%;width:28px;height:28px;font-size:12px;padding:0;" onclick="event.stopPropagation(); app.markVoucherRedeemed(${prospect.id}, ${nv.id})"><i class="fas fa-check"></i></button>`}
                            ` : `
                                <button class="btn secondary btn-sm" title="Generate this name's referral e-voucher" onclick="event.stopPropagation(); app.generateEvoucherForName(${prospect.id}, '${UI.escJsAttr(n.full_name || '')}', ${n.id})"><i class="fas fa-ticket-alt"></i> E-Voucher</button>
                            `}
                            <button class="btn-icon" onclick="app.openAddNameModal(${prospect.id},${n.id})"><i class="fas fa-edit"></i></button>
                            <button class="btn-icon" onclick="app.deleteName(${prospect.id},${n.id})"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                    <div style="font-size:13px;color:var(--gray-600);">
                        <span style="margin-right:12px;"><i class="fas fa-user-tag" style="color:var(--gray-400);margin-right:4px;"></i>${escapeHtml(n.relation || '')}</span>
                        ${n.date_of_birth ? `<span><i class="fas fa-birthday-cake" style="color:var(--gray-400);margin-right:4px;"></i>${escapeHtml(n.date_of_birth)}</span>` : ''}
                    </div>
                    ${n.notes ? `<div style="font-size:13px;color:var(--gray-500);margin-top:6px;font-style:italic;">${escapeHtml(n.notes)}</div>` : ''}
                </div>
            `; }).join('') : '<p style="text-align:center;padding:20px;color:var(--gray-400);">No names added yet.</p>'}
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
            } catch (_) { /* intentional: optional photo_urls enrichment — activities still render without it */ }
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
                            <span class="meet-type"><i class="fas fa-user-friends"></i> ${a.activity_type || 'Meeting'}${a.activity_title ? ' — ' + escapeHtml(a.activity_title) : ''}</span>
                            ${a.co_agents && a.co_agents.length > 0 ? `<span style="font-size:11px;color:var(--gray-500);margin-top:2px;display:block;"><i class="fas fa-user-plus"></i> ${escapeHtml(a.co_agents.map(c => c.name || c.full_name).join(', '))}</span>` : ''}
                            ${a.consultants && a.consultants.length > 0 ? `<span style="font-size:11px;color:var(--gray-500);margin-top:2px;display:block;">${a.consultants.map(c => {
                                const icon = c.status === 'accepted' ? '✅' : c.status === 'rejected' ? '❌' : '⏳';
                                return `${icon} ${escapeHtml(c.name || '')}`;
                            }).join(' &nbsp; ')}</span>` : ''}
                            <span class="meet-date">${escapeHtml(a.activity_date || '')}</span>
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
                            <span>${escapeHtml(n.date || '')} - ${escapeHtml(n.author || '')}${n.is_voice_note ? ' <i class="fas fa-microphone voice-note-icon" title="Voice note"></i>' : ''}</span>
                            <button class="btn-icon" onclick="app.deleteNote(${prospect.id}, ${n.id})"><i class="fas fa-trash"></i></button>
                        </div>
                        <div>"${escapeHtml(n.text || '')}"</div>
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
                // Discussion-paper photos: attendee notes live on event_attendees
                // (own-event notes live on activities.photo_urls) — route each to
                // its matching viewer so uploaded papers are findable here too.
                const photoCount = Array.isArray(a.photo_urls) ? a.photo_urls.length : 0;
                const photosBtn = photoCount > 0
                    ? (a._isAttendeeNote
                        ? `<button class="btn btn-sm secondary" style="color:var(--primary);border-color:var(--primary);" onclick="event.stopPropagation();app.viewAttendeePhotos(${a._attendeeRowId})"><i class="fas fa-images"></i> Photos (${photoCount})</button>`
                        : `<button class="btn btn-sm secondary" style="color:var(--primary);border-color:var(--primary);" onclick="event.stopPropagation();app.viewActivityPhotos(${a.id})"><i class="fas fa-images"></i> Photos (${photoCount})</button>`)
                    : '';
                const sourceTag = a._isAttendeeNote
                    ? `<span style="font-size:10px;background:var(--gray-100);color:var(--gray-600);padding:1px 6px;border-radius:10px;margin-left:6px;">attended</span>`
                    : '';
                html += `
                    <div class="meet-card" style="margin-bottom:10px;">
                        <div class="meet-card-hdr">
                            <div>
                                <span class="meet-type"><i class="fas ${icon}"></i> ${escapeHtml(label)}${a.activity_title ? ' — ' + escapeHtml(a.activity_title) : ''}${sourceTag}</span>
                                <span class="meet-date">${escapeHtml(a.activity_date || '')}</span>
                            </div>
                            <button class="btn btn-sm secondary" style="font-size:12px;padding:4px 8px;" onclick="event.stopPropagation();app.viewActivityDetails(${detailsId})">Details</button>
                        </div>
                        ${a.summary || a.note_key_points ? `<div class="meet-section"><div class="meet-lbl">Key Points</div><div class="meet-txt">${escapeHtml(a.summary || a.note_key_points)}</div></div>` : ''}
                        ${a.note_needs ? `<div class="meet-section"><div class="meet-lbl">Needs</div><div class="meet-txt">${escapeHtml(a.note_needs)}</div></div>` : ''}
                        ${a.note_pain_points ? `<div class="meet-section"><div class="meet-lbl">Pain Points</div><div class="meet-txt">${escapeHtml(a.note_pain_points)}</div></div>` : ''}
                        ${a.opportunity_potential ? `<div class="meet-section"><div class="meet-lbl">Opportunity / Potential</div><div class="meet-txt">${escapeHtml(a.opportunity_potential)}</div></div>` : ''}
                        ${a.next_action ? `<div class="meet-section"><div class="meet-lbl">Next Action</div><div class="meet-txt" style="color:var(--primary);font-weight:500;">${escapeHtml(a.next_action)}</div></div>` : ''}
                        ${a.location_address ? `<div class="meet-section"><div class="meet-lbl">Location</div><div class="meet-txt">${escapeHtml(a.location_address)}</div></div>` : ''}
                        ${a.score_value ? `<div style="margin-bottom:6px;"><span class="badge success" style="font-size:11px;">+${a.score_value} pts</span></div>` : ''}
                        <div class="meet-actions">
                            ${notesBtn}
                            ${photosBtn}
                        </div>
                    </div>
                `;
            }
            if (registrations.length > 0) {
                html += `<div class="pv-sub" style="margin-top:8px;">Event Registrations</div>`;
                html += '<div style="overflow-x:auto;"><table class="events-table" style="width:100%;"><thead><tr><th scope="col">Event</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col">Pts</th></tr></thead><tbody>';
                for (const r of registrations) {
                    const ev = eventsById.get(String(r.event_id));
                    html += `<tr><td>${escapeHtml(ev?.event_title || ev?.title || 'Unknown')}</td><td>${escapeHtml(r.event_date || '-')}</td><td>${escapeHtml(r.attendance_status || '')}</td><td>${r.points_awarded || 0}</td></tr>`;
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
        // Escape: full_name is a user-controlled profile value rendered into innerHTML
        // below (every other pv-val in this file is escaped — this was the lone omission).
        const agentName = escapeHtml(agentRec?.full_name || 'Unassigned');

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
                    <span class="tag ${t.color}">${escapeHtml(t.name)} <i class="fas fa-times remove" onclick="app.removeTagFromProspect(${prospect.id}, ${t.id})"></i></span>
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
            <div class="pv-row"><span class="pv-lbl">Budget</span><span class="pv-val">${escapeHtml(prospect.budget_range || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Timeline</span><span class="pv-val">${escapeHtml(prospect.decision_timeline || '-')}</span></div>
            <div class="pv-row"><span class="pv-lbl">Decision Maker</span><span class="pv-val">${prospect.decision_maker === 'yes' ? 'Yes' : prospect.decision_maker === 'no' ? 'No' : 'Unknown'}</span></div>

            ${(meetups.length > 0 || fengShuiAudits.length > 0) ? `
            <div class="pv-sub" style="margin-top:12px;">Deal Analysis from ${meetups.length} Meet Up${meetups.length !== 1 ? 's' : ''}${fengShuiAudits.length > 0 ? ` + ${fengShuiAudits.length} Feng Shui Audit${fengShuiAudits.length !== 1 ? 's' : ''}` : ''}</div>

            ${allPains.length > 0 ? `
            <div style="background:#fff3f3;border-left:3px solid #ef4444;border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:8px;">
                <div class="meet-lbl" style="color:#ef4444;margin-bottom:4px;"><i class="fas fa-exclamation-circle"></i> Pain Points / Core Problem</div>
                ${allPains.map(p => `<div style="font-size:13px;color:var(--gray-700);margin-bottom:3px;">• ${escapeHtml(p)}</div>`).join('')}
            </div>` : ''}

            ${allNeeds.length > 0 ? `
            <div style="background:#fff8e1;border-left:3px solid #f59e0b;border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:8px;">
                <div class="meet-lbl" style="color:#d97706;margin-bottom:4px;"><i class="fas fa-lightbulb"></i> Customer Needs / Interests</div>
                ${allNeeds.map(n => `<div style="font-size:13px;color:var(--gray-700);margin-bottom:3px;">• ${escapeHtml(n)}</div>`).join('')}
            </div>` : ''}

            ${allSolutions.length > 0 ? `
            <div style="background:#f0fdf4;border-left:3px solid #22c55e;border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:8px;">
                <div class="meet-lbl" style="color:#16a34a;margin-bottom:4px;"><i class="fas fa-hand-holding-heart"></i> Solution Proposed / Opportunity</div>
                ${allSolutions.map(s => `<div style="font-size:13px;color:var(--gray-700);margin-bottom:3px;">• ${escapeHtml(s)}</div>`).join('')}
            </div>` : ''}

            ${allNextSteps.length > 0 ? `
            <div style="background:#eff6ff;border-left:3px solid var(--primary);border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:8px;">
                <div class="meet-lbl" style="color:var(--primary);margin-bottom:4px;"><i class="fas fa-arrow-right"></i> Next Steps to Close</div>
                ${allNextSteps.map(s => `<div style="font-size:13px;color:var(--gray-700);margin-bottom:3px;">• ${escapeHtml(s)}</div>`).join('')}
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
                        <div class="na-text" id="na-text-${item.id}">${escapeHtml(item.text || '')}</div>
                        <div style="font-size:11px;color:var(--gray-400);margin-top:2px;">${escapeHtml(item.date || '')} — ${item.type || 'Meeting'}${item.title ? ' · ' + escapeHtml(item.title) : ''} <span style="background:var(--gray-100);border-radius:3px;padding:1px 4px;">${item.source}</span></div>
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
        const isManager = isSystemAdmin(_state.cu) || isMarketingManager(_state.cu);
        const products = (await AppDataStore.getAll('products')).filter(p => p.is_active !== false);
        const productOptions = products.length
            ? products.map(p => `<option value="${escapeHtml(p.name)}" ${(cr?.product === p.name) ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')
            : '<option value="">No products available</option>';

        // ── Before 2025 Purchase Record (stored inside closing_record to reuse existing JSONB column) ──
        const pid = prospect.id;
        let pre2025 = [];
        try {
            const src = prospect.closing_record?.pre2025_purchases || prospect.pre2025_purchases;
            pre2025 = Array.isArray(src) ? src : JSON.parse(src || '[]');
        } catch(_) { /* intentional: JSON.parse fallback — malformed/empty stays [] */ }
        const pre2025Rows = pre2025.length
            ? pre2025.map((r, i) => `
                <tr>
                    <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;">${escapeHtml(r.product || '')}</td>
                    <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;color:var(--gray-500);">${escapeHtml(r.notes || '-')}</td>
                    <td style="padding:4px 8px;border-bottom:1px solid #f3f4f6;text-align:center;">
                        ${r.attachment_data
                            ? `<a href="${safeUrl(r.attachment_data)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(r.attachment_name||'View attachment')}" style="color:var(--primary);margin-right:4px;"><i class="fas fa-paperclip"></i></a>`
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
                            <span style="flex:1;">#${hi+1} — ${escapeHtml(h.product||'N/A')} · ${UI.formatCurrency(parseFloat(h.sale_amount) || 0, { currency: window._crmUtils.recordCurrency(typeof customer !== 'undefined' ? customer : (typeof prospect !== 'undefined' ? prospect : null)) })}</span>
                            ${_crStatusBadge(h)}
                            <span style="font-size:11px;color:var(--gray-400);font-weight:400;">${h.closing_date || (h.approved_at ? h.approved_at.split('T')[0] : '')}</span>
                        </summary>
                        <div style="padding:10px 12px;background:#fafafa;font-size:12px;border-top:1px solid #f3f4f6;">
                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;margin-bottom:10px;">
                                <div><span style="color:var(--gray-400);">Payment:</span> ${escapeHtml(h.payment_method||'-')}</div>
                                <div><span style="color:var(--gray-400);">Invoice:</span> ${escapeHtml(h.invoice_number||'-')}</div>
                                <div style="grid-column:1/-1;">
                                    ${h.invoice_file
                                        ? `<a href="${safeUrl(h.invoice_file)}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);"><i class="fas fa-paperclip"></i> ${escapeHtml(h.invoice_file_name||'View invoice')}</a>`
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
                                    ${h.delivery_proof ? `<div style="margin-bottom:4px;"><a href="${safeUrl(h.delivery_proof)}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);font-size:12px;"><i class="fas fa-paperclip"></i> ${escapeHtml(h.delivery_proof_name||'View proof')}</a> <span style="color:var(--gray-400);font-size:11px;">(upload new to replace)</span></div>` : ''}
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
            // NPO (agent-sellable installment package) — config stays L1-only, but
            // any closer can tag this closing to an active NPO package. Filled async.
            const isNPO = d.payment_method === 'NPO';
            const npoPlanId = d.npo_plan_id || '';
            const npoPlanName = d.npo_plan_name || '';
            container.innerHTML = pre2025Html + historyHtml + `
                <div class="cr-status draft" style="margin-bottom:14px;padding:8px 12px;border-radius:8px;background:#fff8e1;border:1px solid #ffc107;color:#856404;font-size:13px;font-weight:600;">
                    <i class="fas fa-edit"></i> Draft — Fill in details and submit for manager approval
                </div>
                <div class="pv-sub">Customer Information</div>
                <div class="form-group" style="margin-bottom:10px;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Full Name</label><input id="cr-full-name" class="form-control" value="${escapeHtml(d.full_name || prospect.full_name || '')}" placeholder="Full name"></div>
                <div class="form-row" style="display:flex;gap:8px;margin-bottom:10px;">
                    <div class="form-group" style="flex:1;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Phone</label><input id="cr-phone" class="form-control" value="${escapeHtml(d.phone || prospect.phone || '')}" placeholder="Phone"></div>
                    <div class="form-group" style="flex:1;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Email</label><input id="cr-email" class="form-control" value="${escapeHtml(d.email || prospect.email || '')}" placeholder="Email"></div>
                </div>
                <div class="form-row" style="display:flex;gap:8px;margin-bottom:10px;">
                    <div class="form-group" style="flex:1;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">IC Number</label><input id="cr-ic" class="form-control" value="${escapeHtml(d.ic_number || prospect.ic_number || '')}" placeholder="NRIC/Passport"></div>
                    <div class="form-group" style="flex:1;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Date of Birth</label><input id="cr-dob" type="date" class="form-control" value="${d.date_of_birth || prospect.date_of_birth || ''}"></div>
                </div>
                <div class="form-group" style="margin-bottom:14px;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Address</label><textarea id="cr-address" class="form-control" rows="2" placeholder="Full address">${escapeHtml(d.address || [prospect.address, prospect.city, prospect.state, prospect.postal_code].filter(Boolean).join(', ') || '')}</textarea></div>

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
                        <select id="cr-payment-method" class="form-control" onchange="app.crPaymentMethodChanged(this.value)">
                            <option value="Cash" ${d.payment_method==='Cash'?'selected':''}>Cash</option>
                            <option value="Bank Transfer" ${d.payment_method==='Bank Transfer'?'selected':''}>Bank Transfer</option>
                            <option value="Credit Card" ${d.payment_method==='Credit Card'?'selected':''}>Credit Card</option>
                            <option value="Cheque" ${d.payment_method==='Cheque'?'selected':''}>Cheque</option>
                            <option value="EPP" ${d.payment_method==='EPP'?'selected':''}>EPP</option>
                            <option value="POP" ${d.payment_method==='POP'?'selected':''}>POP</option>
                            <option value="NPO" ${d.payment_method==='NPO'?'selected':''}>NPO</option>
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
                <div id="cr-npo-fields" style="display:${isNPO?'block':'none'};background:#ecfeff;border:1px solid #a5f3fc;padding:12px;border-radius:6px;margin-bottom:10px;">
                    <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;"><i class="fas fa-file-invoice-dollar" style="color:#0e7490;"></i> NPO Package <span style="color:#ef4444;font-weight:700;" title="Required for NPO">*</span></label>
                    <select id="cr-npo-plan" class="form-control" onchange="app.crNpoPlanPicked()" data-selected="${escapeHtml(String(npoPlanId))}">
                        <option value="">${isNPO ? 'Loading packages…' : '— Select package —'}</option>
                    </select>
                    <div id="cr-npo-selected" style="font-size:12px;color:#0e7490;margin-top:6px;">${npoPlanName ? 'Selected package: <strong>' + escapeHtml(npoPlanName) + '</strong>' : ''}</div>
                    ${isNPO ? `<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="" style="display:none;" onload="window.app && app.crNpoFillPlans && app.crNpoFillPlans('${escapeHtml(String(npoPlanId))}')">` : ''}
                </div>
                <div class="form-row" style="display:flex;gap:8px;margin-bottom:10px;">
                    <div class="form-group" style="flex:1;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Invoice Number</label><input id="cr-invoice" class="form-control" value="${escapeHtml(d.invoice_number || '')}" placeholder="INV-2026-001"></div>
                    <div class="form-group" style="flex:1;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Collection Date</label><input id="cr-close-date" type="date" class="form-control" value="${d.closing_date || ''}"></div>
                </div>
                <div class="form-group" style="margin-bottom:10px;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Remarks</label><textarea id="cr-remarks" class="form-control" rows="2" placeholder="e.g. Ring Size, Special Request...">${escapeHtml(d.closing_remarks || '')}</textarea></div>
                <div class="form-group" style="margin-bottom:14px;">
                    <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Upload Purchased Invoice <span style="font-size:11px;color:var(--gray-400);font-weight:normal;">(AI auto-fill on upload)</span></label>
                    <input id="cr-invoice-file" type="file" class="form-control" accept="image/png,image/jpeg,application/pdf" onchange="app.scanInvoiceWithAI(this,'cr','cr')">
                    ${d.invoice_file ? `<div style="margin-top:6px;font-size:11px;color:var(--gray-500);"><i class="fas fa-paperclip"></i> Current: <a href="${safeUrl(d.invoice_file)}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);">${escapeHtml(d.invoice_file_name || 'view')}</a> <span style="color:var(--gray-400);">(choosing a new file will replace it)</span></div>` : ''}
                </div>

                <div class="pv-sub">📁 Case Study (Optional)</div>
                <div class="form-group" style="margin-bottom:10px;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Sales Idea</label><textarea id="cr-sales-idea" class="form-control" rows="2" placeholder="Describe the sales idea...">${escapeHtml(d.sales_idea || '')}</textarea></div>
                <div class="form-group" style="margin-bottom:10px;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Plan Details</label><textarea id="cr-plan-details" class="form-control" rows="2" placeholder="Details of the plan proposed...">${escapeHtml(d.plan_details || '')}</textarea></div>
                <div class="form-group" style="margin-bottom:14px;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Success Story</label><textarea id="cr-success-story" class="form-control" rows="2" placeholder="What made this a success?">${escapeHtml(d.success_story || '')}</textarea></div>

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
                <div class="pv-row"><span class="pv-lbl">Full Name</span><span class="pv-val">${escapeHtml(d.full_name || '-')}</span></div>
                <div class="pv-row"><span class="pv-lbl">Phone</span><span class="pv-val">${escapeHtml(d.phone || '-')}</span></div>
                <div class="pv-row"><span class="pv-lbl">Email</span><span class="pv-val">${escapeHtml(d.email || '-')}</span></div>
                <div class="pv-row"><span class="pv-lbl">IC Number</span><span class="pv-val">${escapeHtml(d.ic_number || '-')}</span></div>
                <div class="pv-row"><span class="pv-lbl">Date of Birth</span><span class="pv-val">${escapeHtml(d.date_of_birth || '-')}</span></div>
                <div class="pv-row"><span class="pv-lbl">Address</span><span class="pv-val">${escapeHtml(d.address || '-')}</span></div>
                <div class="pv-sub">Meeting Outcome</div>
                <div class="pv-row"><span class="pv-lbl">Product/Service</span><span class="pv-val">${escapeHtml(d.product || '-')}</span></div>
                <div class="pv-row"><span class="pv-lbl">Order Date</span><span class="pv-val">${escapeHtml(d.order_date || '-')}</span></div>
                <div class="pv-row"><span class="pv-lbl">Amount Closed</span><span class="pv-val">${d.sale_amount ? UI.formatCurrency(parseFloat(d.sale_amount), { currency: window._crmUtils.recordCurrency(typeof customer !== 'undefined' ? customer : (typeof prospect !== 'undefined' ? prospect : null)) }) : '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Payment Method</span><span class="pv-val">${escapeHtml(d.payment_method || '-')}</span></div>
                ${d.payment_method === 'POP' ? `
                <div class="pv-row"><span class="pv-lbl">Monthly (RM)</span><span class="pv-val">${d.pop_monthly || '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Tenure</span><span class="pv-val">${d.pop_tenure ? d.pop_tenure + ' months' : '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Down Payment</span><span class="pv-val">${d.pop_down_payment ? 'RM ' + parseFloat(d.pop_down_payment).toLocaleString() : '-'}</span></div>
                ` : ''}
                ${d.payment_method === 'NPO' && d.npo_plan_name ? `
                <div class="pv-row"><span class="pv-lbl">NPO Package</span><span class="pv-val">${escapeHtml(d.npo_plan_name)}</span></div>
                ` : ''}
                <div class="pv-row"><span class="pv-lbl">Invoice No.</span><span class="pv-val">${escapeHtml(d.invoice_number || '-')}</span></div>
                <div class="pv-row"><span class="pv-lbl">Collection Date</span><span class="pv-val">${escapeHtml(d.closing_date || '-')}</span></div>
                <div class="pv-row"><span class="pv-lbl">Invoice File</span><span class="pv-val">${d.invoice_file ? `<a href="${safeUrl(d.invoice_file)}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);"><i class="fas fa-paperclip"></i> ${escapeHtml(d.invoice_file_name || 'View')}</a>` : '-'}</span></div>
                ${(d.sales_idea || d.plan_details || d.success_story) ? `
                <div class="pv-sub">Case Study</div>
                ${d.sales_idea ? `<div class="pv-row"><span class="pv-lbl">Sales Idea</span><span class="pv-val">${escapeHtml(d.sales_idea)}</span></div>` : ''}
                ${d.plan_details ? `<div class="pv-row"><span class="pv-lbl">Plan Details</span><span class="pv-val">${escapeHtml(d.plan_details)}</span></div>` : ''}
                ${d.success_story ? `<div class="pv-row"><span class="pv-lbl">Success Story</span><span class="pv-val">${escapeHtml(d.success_story)}</span></div>` : ''}
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
                <div class="pv-row"><span class="pv-lbl">Product/Service</span><span class="pv-val">${escapeHtml(d.product || '-')}</span></div>
                <div class="pv-row"><span class="pv-lbl">Order Date</span><span class="pv-val">${escapeHtml(d.order_date || '-')}</span></div>
                <div class="pv-row"><span class="pv-lbl">Amount Closed</span><span class="pv-val">${d.sale_amount ? UI.formatCurrency(parseFloat(d.sale_amount), { currency: window._crmUtils.recordCurrency(typeof customer !== 'undefined' ? customer : (typeof prospect !== 'undefined' ? prospect : null)) }) : '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Payment Method</span><span class="pv-val">${escapeHtml(d.payment_method || '-')}</span></div>
                ${d.payment_method === 'POP' ? `
                <div class="pv-row"><span class="pv-lbl">Monthly (RM)</span><span class="pv-val">${d.pop_monthly || '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Tenure</span><span class="pv-val">${d.pop_tenure ? d.pop_tenure + ' months' : '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Down Payment</span><span class="pv-val">${d.pop_down_payment ? 'RM ' + parseFloat(d.pop_down_payment).toLocaleString() : '-'}</span></div>
                ` : ''}
                ${d.payment_method === 'NPO' && d.npo_plan_name ? `
                <div class="pv-row"><span class="pv-lbl">NPO Package</span><span class="pv-val">${escapeHtml(d.npo_plan_name)}</span></div>
                ` : ''}
                <div class="pv-row"><span class="pv-lbl">Invoice No.</span><span class="pv-val">${escapeHtml(d.invoice_number || '-')}</span></div>
                <div class="pv-row"><span class="pv-lbl">Collection Date</span><span class="pv-val">${escapeHtml(d.closing_date || '-')}</span></div>
                <div class="pv-row"><span class="pv-lbl">Invoice File</span><span class="pv-val">${d.invoice_file ? `<a href="${safeUrl(d.invoice_file)}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);"><i class="fas fa-paperclip"></i> ${escapeHtml(d.invoice_file_name || 'View')}</a>` : '-'}</span></div>
                ${(d.sales_idea || d.plan_details || d.success_story) ? `
                <div class="pv-sub">Case Study</div>
                ${d.sales_idea ? `<div class="pv-row"><span class="pv-lbl">Sales Idea</span><span class="pv-val">${escapeHtml(d.sales_idea)}</span></div>` : ''}
                ${d.plan_details ? `<div class="pv-row"><span class="pv-lbl">Plan Details</span><span class="pv-val">${escapeHtml(d.plan_details)}</span></div>` : ''}
                ${d.success_story ? `<div class="pv-row"><span class="pv-lbl">Success Story</span><span class="pv-val">${escapeHtml(d.success_story)}</span></div>` : ''}
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
                        ${d.delivery_proof ? `<div style="margin-bottom:5px;"><a href="${safeUrl(d.delivery_proof)}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);font-size:12px;"><i class="fas fa-paperclip"></i> ${escapeHtml(d.delivery_proof_name||'View proof')}</a> <span style="color:var(--gray-400);font-size:11px;">(upload new to replace)</span></div>` : ''}
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
        } catch(_) { /* intentional: JSON.parse fallback — malformed/empty stays [] */ }

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
            } catch(_) { /* intentional: best-effort formula-master load — dropdown just stays empty */ hcProducts = []; }
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
                            ? `<a href="${safeUrl(r.attachment_data)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(r.attachment_name||'View attachment')}" style="color:var(--primary);margin-right:4px;"><i class="fas fa-paperclip"></i></a>`
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
                    <span style="font-size:12px;">Total: ${UI.formatCurrency(totalAmount, { currency: window._crmUtils.recordCurrency(typeof customer !== 'undefined' ? customer : (typeof prospect !== 'undefined' ? prospect : null)) })}</span>
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
    else if (tab === 'orders') {
        let orders = [];
        try {
            // purchases rows are keyed by customer_id (no code path ever writes
            // purchases.prospect_id), so resolve the linked customer first via
            // converted_from_prospect_id, then query by that customer_id. Without
            // this the Sales Orders tab was always empty.
            const linkedCustomers = await AppDataStore.query('customers', { converted_from_prospect_id: prospect.id }).catch(() => []);
            if (linkedCustomers && linkedCustomers.length) {
                const orderLists = await Promise.all(
                    linkedCustomers.map(c => AppDataStore.query('purchases', { customer_id: c.id }).catch(() => []))
                );
                orders = orderLists.flat();
            }
            orders.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        } catch (err) {
            // Surface the failure rather than silently degrading to the empty state.
            console.warn('[orders tab] purchases fetch failed:', err);
            UI.toast.error('Could not load sales orders');
        }
        if (!orders.length) {
            container.innerHTML = `<div style="padding:16px;color:var(--gray-400);font-size:13px;text-align:center;">No sales orders on record.</div>`;
            return;
        }
        const dsBadge = (ds) => {
            const s = ds || 'Pending Delivery';
            const map = {
                'Delivered':       ['#DCFCE7','#166534'],
                'Cancelled':       ['#FFE4E6','#9F1239'],
                'Doubtful':        ['#FEF3C7','#92400E'],
                'Partial Delivery':['#E0F2FE','#0369A1'],
            };
            const [bg, fg] = map[s] || ['#EFF6FF','#1e40af'];
            return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:600;background:${bg};color:${fg};">${s}</span>`;
        };
        const fmtAmt = (v) => v ? 'RM ' + Number(v).toLocaleString('en-MY', {minimumFractionDigits:0,maximumFractionDigits:0}) : '-';
        const rows = orders.map(o => `<tr style="border-bottom:1px solid var(--border);">
            <td style="padding:7px 8px;font-size:11px;color:var(--gray-500);white-space:nowrap;">${escapeHtml(o.date || '-')}</td>
            <td style="padding:7px 8px;font-size:11px;color:var(--gray-400);white-space:nowrap;">${escapeHtml(o.invoice || '-')}</td>
            <td style="padding:7px 8px;font-size:12px;font-weight:500;color:var(--gray-800);">${escapeHtml(o.item || '-')}</td>
            <td style="padding:7px 8px;font-size:12px;font-weight:600;color:var(--primary);white-space:nowrap;">${fmtAmt(o.amount)}</td>
            <td style="padding:7px 8px;font-size:11px;color:var(--gray-500);">${escapeHtml(o.payment_method || '-')}</td>
            <td style="padding:7px 8px;">${dsBadge(o.delivery_status)}</td>
        </tr>`).join('');
        const total = orders.reduce((s, o) => s + (parseFloat(o.amount) || 0), 0);
        container.innerHTML = `<div style="padding:8px 12px;overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
                <thead><tr style="border-bottom:2px solid var(--border);background:var(--gray-50);">
                    <th style="padding:7px 8px;text-align:left;font-size:11px;color:var(--gray-500);font-weight:600;">Date</th>
                    <th style="padding:7px 8px;text-align:left;font-size:11px;color:var(--gray-500);font-weight:600;">PRN</th>
                    <th style="padding:7px 8px;text-align:left;font-size:11px;color:var(--gray-500);font-weight:600;">Product</th>
                    <th style="padding:7px 8px;text-align:left;font-size:11px;color:var(--gray-500);font-weight:600;">Amount</th>
                    <th style="padding:7px 8px;text-align:left;font-size:11px;color:var(--gray-500);font-weight:600;">Payment</th>
                    <th style="padding:7px 8px;text-align:left;font-size:11px;color:var(--gray-500);font-weight:600;">Delivery</th>
                </tr></thead>
                <tbody>${rows}</tbody>
                <tfoot><tr style="border-top:2px solid var(--border);background:var(--gray-50);">
                    <td colspan="3" style="padding:8px;font-weight:700;font-size:12px;color:var(--gray-700);">TOTAL &middot; ${orders.length} order${orders.length > 1 ? 's' : ''}</td>
                    <td style="padding:8px;font-weight:700;font-size:13px;color:var(--primary);">${fmtAmt(total)}</td>
                    <td colspan="2"></td>
                </tr></tfoot>
            </table>
        </div>`;
    }
    else if (tab === 'fengshui') {
        // ── ⑦d Feng Shui Audit — sequence per audit event: layout plan file, audit report file,
        //    key notes, product selections (products/bujishu/formula — auto-flow to Potential),
        //    Before photos (up to 50 w/ remarks), After photos (up to 50 w/ remarks),
        //    Site Review entries (multi-date, remarks, up to 5 photos each).
        const pid = prospect.id;
        let audits = [];
        try {
            const src = prospect.feng_shui_audits;
            audits = Array.isArray(src) ? src : JSON.parse(src || '[]');
        } catch(_) { /* intentional: JSON.parse fallback — malformed/empty stays [] */ audits = []; }
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
                ? `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);"><i class="fas fa-paperclip"></i> ${escapeHtml(name || 'View file')}</a>`
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
    // Render every amount in this customer's market currency (rows may carry their own).
    const _cur = UI.currencyForCountry(customer.country);

    // Pull the original conversion sale from the linked prospect closing_record.
    // IMPORTANT: every approval path NULLs closing_record on conversion and pushes
    // the approved CR into closing_records_history. So a non-null closing_record here
    // is a NEW, subsequent draft/submission (status 'draft'|'submitted') — NOT the
    // approved conversion sale. Only count/render it as PAID when it is approved,
    // otherwise it inflates totalPaid with an unapproved draft.
    let conversionRow = '';
    if (customer.converted_from_prospect_id) {
        const origP = await AppDataStore.getById('prospects', customer.converted_from_prospect_id);
        if (origP?.closing_record && origP.closing_record.status === 'approved') {
            const cr0 = origP.closing_record;
            const amt0 = parseFloat(cr0.sale_amount) || 0;
            totalPaid += amt0;
            conversionRow = `
                <tr style="background:#f0fdf4;">
                    <td style="padding:6px 10px;">${escapeHtml(cr0.closing_date || customer.customer_since || '-')}</td>
                    <td style="padding:6px 10px;">${escapeHtml(cr0.invoice_number || '-')}</td>
                    <td style="padding:6px 10px;"><strong>${escapeHtml(cr0.product || '-')}</strong> <span style="font-size:11px;color:var(--gray-400);">(Conversion)</span></td>
                    <td style="padding:6px 10px;">${UI.formatCurrency(amt0, { currency: _cur, dp: 2 })}</td>
                    <td style="padding:6px 10px;"><span style="background:#dcfce7;color:#166534;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;">PAID</span></td>
                    <td style="padding:6px 10px;">${(()=>{ const ds=cr0.delivery_status||'Pending Delivery'; const dc={'Pending Delivery':'background:#fef3c7;color:#92400e','Dispatched':'background:#dbeafe;color:#1e40af','Delivered':'background:#dcfce7;color:#166534'}; return `<span style="${dc[ds]||dc['Pending Delivery']};border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;cursor:pointer;" onclick="app.updateConversionDelivery(${origP.id},${customer.id})" title="Click to update">${ds} ✎</span>`; })()}</td>
                    <td style="padding:6px 10px;">${cr0.invoice_file ? `<a href="${safeUrl(cr0.invoice_file)}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);font-size:12px;"><i class="fas fa-paperclip"></i> View</a>` : '-'}</td>
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
                <td style="padding:6px 10px;">${escapeHtml(p.date || '-')}</td>
                <td style="padding:6px 10px;">${escapeHtml(p.invoice || '-')}</td>
                <td style="padding:6px 10px;">${escapeHtml(p.item || '-')}</td>
                <td style="padding:6px 10px;">${UI.formatCurrency(amt, { currency: p.currency || _cur, dp: 2 })}</td>
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
                <span>Paid: <strong style="color:#166534;">${UI.formatCurrency(totalPaid, { currency: _cur, dp: 2 })}</strong></span>
                <span>Pending: <strong style="color:#854d0e;">${UI.formatCurrency(totalPending, { currency: _cur, dp: 2 })}</strong></span>
                <span style="margin-left:auto;">Lifetime Total: <strong style="color:var(--primary);">${UI.formatCurrency(totalPaid+totalPending, { currency: _cur, dp: 2 })}</strong></span>
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
    const isManager = isSystemAdmin(_state.cu) || isMarketingManager(_state.cu);
    const pid = prospect.id;

    // Before 2025 Purchase Record
    let pre2025 = [];
    try {
        const src = prospect.closing_record?.pre2025_purchases || prospect.pre2025_purchases;
        pre2025 = Array.isArray(src) ? src : JSON.parse(src || '[]');
    } catch(_) { /* intentional: JSON.parse fallback — malformed/empty stays [] */ }
    const pre2025Rows = pre2025.length
        ? pre2025.map((r, i) => `
            <tr>
                <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;">${escapeHtml(r.product || '')}</td>
                <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;color:var(--gray-500);">${escapeHtml(r.notes || '-')}</td>
                <td style="padding:4px 8px;border-bottom:1px solid #f3f4f6;text-align:center;">
                    ${r.attachment_data
                        ? `<a href="${safeUrl(r.attachment_data)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(r.attachment_name||'View attachment')}" style="color:var(--primary);margin-right:4px;"><i class="fas fa-paperclip"></i></a>`
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
                        <span style="flex:1;">#${hi+1} — ${escapeHtml(h.product||'N/A')} · ${UI.formatCurrency(parseFloat(h.sale_amount) || 0, { currency: window._crmUtils.recordCurrency(typeof customer !== 'undefined' ? customer : (typeof prospect !== 'undefined' ? prospect : null)) })}</span>
                        ${_crBadge(h)}
                        <span style="font-size:11px;color:var(--gray-400);font-weight:400;">${h.closing_date || (h.approved_at ? h.approved_at.split('T')[0] : '')}</span>
                    </summary>
                    <div style="padding:10px 12px;background:#fafafa;font-size:12px;border-top:1px solid #f3f4f6;">
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;margin-bottom:10px;">
                            <div><span style="color:var(--gray-400);">Payment:</span> ${escapeHtml(h.payment_method||'-')}</div>
                            <div><span style="color:var(--gray-400);">Invoice:</span> ${escapeHtml(h.invoice_number||'-')}</div>
                            <div style="grid-column:1/-1;">
                                ${h.invoice_file
                                    ? `<a href="${safeUrl(h.invoice_file)}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);"><i class="fas fa-paperclip"></i> ${escapeHtml(h.invoice_file_name||'View invoice')}</a>`
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
                                ${h.delivery_proof ? `<div style="margin-bottom:4px;"><a href="${safeUrl(h.delivery_proof)}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);font-size:12px;"><i class="fas fa-paperclip"></i> ${escapeHtml(h.delivery_proof_name||'View proof')}</a> <span style="color:var(--gray-400);font-size:11px;">(upload new to replace)</span></div>` : ''}
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
                <div class="pv-row"><span class="pv-lbl">Product/Service</span><span class="pv-val">${escapeHtml(d.product || '-')}</span></div>
                <div class="pv-row"><span class="pv-lbl">Amount</span><span class="pv-val">${d.sale_amount ? UI.formatCurrency(parseFloat(d.sale_amount), { currency: window._crmUtils.recordCurrency(typeof customer !== 'undefined' ? customer : (typeof prospect !== 'undefined' ? prospect : null)) }) : '-'}</span></div>
                <div class="pv-row"><span class="pv-lbl">Payment</span><span class="pv-val">${escapeHtml(d.payment_method || '-')}</span></div>
                <div class="pv-row"><span class="pv-lbl">Invoice</span><span class="pv-val">${escapeHtml(d.invoice_number || '-')}</span></div>
                <div class="pv-row"><span class="pv-lbl">Collection Date</span><span class="pv-val">${escapeHtml(d.closing_date || '-')}</span></div>
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

    // pre2025Html is always a non-empty table string, so `... || fallback` never
    // reached the fallback (+ binds tighter than ||). Decide on the actual closing
    // content — history + active submission — and append the message when both are empty.
    const _closingBody = historyHtml + activeHtml ||
        '<p style="text-align:center;padding:16px;color:var(--gray-400);font-size:13px;">No closing records yet.</p>';
    container.innerHTML = pre2025Html + _closingBody;
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
            await window.app.switchCustomerProfileTab(tab, customerId, bodyEl);
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

// Open a WhatsApp chat with the prospect directly (no message draft).
// Reuses the Malaysia MSISDN normalizer so 0xx / +60 / 60xx all resolve.
// GESTURE-SAFE: the header passes the prospect's phone in at render time, so the
// common path opens wa.me SYNCHRONOUSLY inside the click (iOS Safari blocks popups
// opened after an await). Only if no phone was passed do we open a blank window
// first, then redirect it after the async getById resolves.
const openProspectWhatsApp = async (prospectId, presetPhone) => {
    if (presetPhone !== undefined && presetPhone !== null) {
        const num = _evWaPhone(presetPhone);
        if (!num) { UI.toast.error('Prospect has no phone number'); return; }
        window.open(`https://wa.me/${num}`, '_blank', 'noopener');
        return;
    }
    // No phone passed — open a blank window NOW (still inside the gesture) so the
    // popup isn't blocked, then point it at wa.me once we have the number.
    const w = window.open('', '_blank', 'noopener');
    const p = await AppDataStore.getById('prospects', prospectId);
    if (!p) { if (w) w.close(); UI.toast.error('Prospect not found'); return; }
    const num = _evWaPhone(p.phone);
    if (!num) { if (w) w.close(); UI.toast.error('Prospect has no phone number'); return; }
    if (w) { w.location = `https://wa.me/${num}`; }
    else { window.open(`https://wa.me/${num}`, '_blank', 'noopener'); }
};

const addNote = async (prospectId) => {
    const text = document.getElementById('new-note-text')?.value?.trim();
    if (!text) return;
    const currentUser = await Auth.getCurrentUser() || _state.cu;

    // Auto-link to the most recent meet-up so the note surfaces under
    // Meet Up History too — otherwise notes-tab entries get orphaned
    // from the activity context the agent was actually referring to.
    const MEETUP_TYPES = ['CPS','FTF','FSA','GR','XG','CALL','EMAIL','WHATSAPP'];
    // Indexed: returns this prospect's rows pre-sorted activity_date DESC.
    const _latestActs = await AppDataStore.getActivitiesForProspect(prospectId, { limit: 100 });
    const latestActivity = _latestActs.find(a => MEETUP_TYPES.includes(a.activity_type));

    await AppDataStore.create('notes', {
        prospect_id: prospectId,
        activity_id: latestActivity?.id || null,
        text: text,
        author: currentUser?.full_name || 'Unknown', // never a hardcoded real name — avoids identity-bleed
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
    } catch (e) { /* intentional: column-existence probe — treat any error as "column absent" */ return false; }
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
                        <img loading="lazy" decoding="async" data-attach-src="${escapeHtml(String(url))}" style="height:70px;border-radius:4px;object-fit:cover;cursor:pointer;" onclick="window._openAttachment('${UI.escJsAttr(String(url))}')">
                        <button type="button" class="btn-icon" style="position:absolute;top:-6px;right:-6px;background:var(--error);color:white;border-radius:50%;width:20px;height:20px;font-size:10px;padding:0;" title="Remove" onclick="app.removeActivityPhoto(${activityId}, '${UI.escJsAttr(String(url))}', 'upload')"><i class="fas fa-times"></i></button>
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
    // Always fetch fresh photo_urls from the DB — getByIdFull bypasses the
    // in-memory + SWR localStorage cache entirely, unlike getById which returns
    // a warm cache hit and would show the same stale row as _lookupActivityRobust.
    const fresh = await AppDataStore.getByIdFull('activities', activityId);
    const photos = Array.isArray(fresh?.photo_urls) ? fresh.photo_urls :
                   Array.isArray(activity.photo_urls) ? activity.photo_urls : [];

    // Nothing to view → jump straight to the upload modal so the tap still feels useful.
    if (photos.length === 0) {
        return attachActivityPhoto(activityId);
    }

    const content = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;max-height:60vh;overflow:auto;padding:4px;">
            ${photos.map((url, i) => `
                <div style="position:relative;">
                    <img loading="lazy" decoding="async" src="${escapeHtml(url)}" style="width:100%;height:120px;border-radius:6px;object-fit:cover;cursor:zoom-in;border:1px solid var(--gray-200);" onclick="window._openAttachment && window._openAttachment('${UI.escJsAttr(String(url))}')">
                    <button type="button" class="btn-icon" style="position:absolute;top:-6px;right:-6px;background:var(--error);color:white;border-radius:50%;width:22px;height:22px;font-size:11px;padding:0;" title="Remove" onclick="event.stopPropagation();app.removeActivityPhoto(${activityId}, '${UI.escJsAttr(String(url))}', 'view')"><i class="fas fa-times"></i></button>
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
const compressImageFile = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read "${file.name}"`));
    reader.onload = (e) => {
        const img = new Image();
        // Without onerror the Promise would hang forever on an undecodable image
        // (corrupt file, HEIC without browser support), stalling the upload flow.
        img.onerror = () => reject(new Error(`Could not decode "${file.name}"`));
        img.onload = () => {
            const MAX_W = 1920;
            let w = img.width, h = img.height;
            if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            canvas.toBlob((blob) => {
                if (!blob) { reject(new Error(`Could not compress "${file.name}"`)); return; }
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
                        <img loading="lazy" decoding="async" data-attach-src="${escapeHtml(String(row.file_url))}" style="height:70px;border-radius:4px;object-fit:cover;cursor:pointer;" onclick="window._openAttachment('${UI.escJsAttr(String(row.file_url))}')">
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
                // Insert via the RAW client with NO id — prospect_attachments.id is a
                // GENERATED-ALWAYS identity, so AppDataStore.create (which stamps a
                // client-side id) is rejected by Postgres with 428C9 and the row only
                // saves locally. Mirrors _evGenerateForName.
                const { error: insErr } = await sb.from('prospect_attachments').insert({
                    prospect_id: prospectId,
                    attachment_type: 'appraisal_form',
                    file_url: urlData.publicUrl,
                    filename: safeName
                }).select().single();
                if (insErr) throw insErr;
                try { if (AppDataStore.invalidateCache) AppDataStore.invalidateCache('prospect_attachments'); } catch (_) {}
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
                        <img loading="lazy" decoding="async" data-attach-src="${escapeHtml(String(row.file_url))}" style="height:70px;border-radius:4px;object-fit:cover;cursor:pointer;" onclick="window._openAttachment('${UI.escJsAttr(String(row.file_url))}')">
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

        // Insert via the RAW client with NO id — prospect_attachments.id is a
        // GENERATED-ALWAYS identity, so AppDataStore.create (which stamps a
        // client-side id) is rejected by Postgres with 428C9 and the row only
        // saves locally. Mirrors _evGenerateForName.
        const { error: insErr } = await sb.from('prospect_attachments').insert({
            prospect_id: prospectId,
            attachment_type: 'apu_form',
            file_url: urlData.publicUrl,
            filename: safeName
        }).select().single();
        if (insErr) throw insErr;
        try { if (AppDataStore.invalidateCache) AppDataStore.invalidateCache('prospect_attachments'); } catch (_) {}

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

// =========================================================================
// E-VOUCHER GENERATOR (APU referral voucher)
// One admin-uploaded template (evoucher_config singleton) with two field
// placements (姓名 + 序号). Agents enter a name; the CRM stamps an atomic
// running number (next_evoucher_number RPC — 169 + MM + YY + NNN, never
// resets), composes name + number onto the template via canvas, saves the PNG
// to the prospect's APU/Names tab as a prospect_attachments row
// (attachment_type='evoucher'), then shares the actual image file to the
// prospect over WhatsApp (Web Share API, wa.me + download fallback).
// =========================================================================
// Serialize voucher generation: a single shared busy flag used to DROP concurrent
// calls, which silently skipped a name when several per-row "E-Voucher" buttons (or
// quick Add-Name auto-gens) fired in close succession. A promise-chain queue runs each
// task in turn instead, so no name is lost. The chain survives a task failure (next
// task still runs). Template fetch / canvas / atomic running-number RPC / upload thus
// never overlap — the original intent of the busy flag — without dropping work.
let _evGenChain = Promise.resolve();
const _evGenSerialize = (task) => {
    const result = _evGenChain.then(task, task); // run after the prior task settles (ok OR fail)
    _evGenChain = result.then(() => {}, () => {}); // keep the queue alive; swallow to avoid poisoning it
    return result;
};
// The top-button (ad-hoc) flow has NO per-name dedup, so a double-click would mint a
// second voucher. Keep a lightweight re-entrancy guard there to ignore double-submits
// (the per-row flow is idempotent via its name_id dedup, so it doesn't need this).
let _evTopBusy = false;
const _evBlobCache = {}; // attachmentId -> freshly-generated PNG Blob (skips refetch for the share gesture)

const _evIsVoucherAdmin = () =>
    (typeof isSystemAdmin === 'function' && isSystemAdmin(_state?.cu)) ||
    (typeof isMarketingManager === 'function' && isMarketingManager(_state?.cu));

// Malaysia MSISDN normalizer for wa.me (mirror of _mhomeWaPhone in script-mobile.js,
// duplicated because that helper is chunk-private).
const _evWaPhone = (raw) => {
    const digits = String(raw || '').replace(/[^0-9+]/g, '').replace(/^\+/, '');
    if (!digits) return '';
    if (digits.startsWith('60')) return digits;
    if (digits.startsWith('0')) return '6' + digits;
    return digits;
};

const _evGetConfig = async () => {
    const sb = window.supabase || window.supabaseClient;
    if (!sb) return null;
    try {
        const { data, error } = await sb.from('evoucher_config').select('*').eq('id', 1).maybeSingle();
        if (error) { console.warn('evoucher_config read failed:', error.message); return null; }
        return data || null;
    } catch (e) { console.warn('evoucher_config read exception:', e?.message); return null; }
};

// Draw name + running number onto the template image and return a PNG Blob.
// The template is fetched to a same-origin object URL first, so the canvas is
// never tainted (no crossOrigin/CORS dependency) and toBlob always works.
const _evComposeVoucherBlob = async (config, name, code) => {
    let tplUrl = config.template_url;
    try { tplUrl = (await AppDataStore.resolveAttachmentSrc(config.template_url)) || config.template_url; } catch (_) {}
    const resp = await fetch(tplUrl);
    if (!resp.ok) throw new Error('Template image fetch failed (' + resp.status + ')');
    const objUrl = URL.createObjectURL(await resp.blob());
    try {
        const img = await new Promise((res, rej) => {
            const im = new Image();
            im.onload = () => res(im);
            im.onerror = () => rej(new Error('Template image failed to load'));
            im.src = objUrl;
        });
        const W = img.naturalWidth || img.width;
        const H = img.naturalHeight || img.height;
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, W, H);
        const drawField = (field, text) => {
            if (!field || text == null || text === '') return;
            const xPct = typeof field.xPct === 'number' ? field.xPct : 0.5;
            const yPct = typeof field.yPct === 'number' ? field.yPct : 0.5;
            const fontPct = typeof field.fontPct === 'number' ? field.fontPct : 5;
            const maxW = (typeof field.maxWidthPct === 'number' ? field.maxWidthPct : 0.6) * W;
            const fam = '"KaiTi","STKaiti","Microsoft YaHei","PingFang SC",sans-serif';
            let size = Math.max(8, Math.round(fontPct / 100 * W));
            ctx.fillStyle = field.color || '#15233f';
            ctx.textAlign = field.align || 'center';
            ctx.textBaseline = 'middle';
            const str = String(text);
            ctx.font = '700 ' + size + 'px ' + fam;
            while (ctx.measureText(str).width > maxW && size > 8) {
                size -= 2;
                ctx.font = '700 ' + size + 'px ' + fam;
            }
            ctx.fillText(str, xPct * W, yPct * H);
        };
        drawField(config.name_field, name);
        drawField(config.number_field, code);
        const blob = await new Promise(res => canvas.toBlob(res, 'image/png', 0.95));
        if (!blob) throw new Error('Canvas export failed');
        return blob;
    } finally {
        URL.revokeObjectURL(objUrl);
    }
};

const openGenerateEvoucherModal = async (prospectId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) { UI.toast.error('Prospect not found'); return; }
    const config = await _evGetConfig();
    const isAdmin = _evIsVoucherAdmin();
    if (!config || !config.template_url) {
        const content = `
            <div style="text-align:center;padding:14px;">
                <i class="fas fa-ticket-alt" style="font-size:28px;color:#7C3AED;"></i>
                <p style="color:var(--gray-700);margin-top:10px;">No voucher template has been set up yet.</p>
                <p style="color:var(--gray-500);font-size:13px;">${isAdmin ? 'Upload the standard voucher and mark where the name and 序号 go.' : 'Please ask your admin to set up the voucher template first.'}</p>
            </div>`;
        UI.showModal('Generate E-Voucher', content, isAdmin
            ? [{ label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }, { label: 'Set Up Template', type: 'primary', action: '(async () => { await app.openEvoucherTemplateSetup(); })()' }]
            : [{ label: 'Close', type: 'secondary', action: 'UI.hideModal()' }]);
        return;
    }
    const content = `
        <div class="form-group">
            <label>持券人姓名 / Holder Name</label>
            <input type="text" id="ev-name" class="form-control" value="${escapeHtml(prospect.full_name || '')}" placeholder="Name to print on the voucher">
            <p style="color:var(--gray-500);font-size:12px;margin-top:4px;">A unique running number (序号) is assigned automatically.</p>
        </div>
        ${isAdmin ? `<p style="font-size:12px;margin-top:4px;"><a href="javascript:void(0)" style="color:#7C3AED;" onclick="(async () => { await app.openEvoucherTemplateSetup(); })()"><i class="fas fa-cog"></i> Edit template / field positions</a></p>` : ''}
    `;
    UI.showModal('Generate E-Voucher', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Generate', type: 'primary', action: `(async () => { await app.generateEvoucher(${prospectId}); })()` }
    ]);
    setTimeout(() => document.getElementById('ev-name')?.focus(), 60);
};

// Core mint: claim an atomic number, compose the PNG, upload, persist as an
// evoucher attachment. Returns the saved row (with id) or null. nameId ties the
// voucher to a Name List entry (the referred friend/family); null for ad-hoc
// vouchers typed via the top button. Throws on hard errors; with opts.silent it
// returns null quietly when no template is configured (used by auto-on-Add-Name).
const _evGenerateForName = async (prospectId, name, nameId = null, opts = {}) => {
    const sb = window.supabase || window.supabaseClient;
    if (!sb || !sb.storage) { if (!opts.silent) UI.toast.error('Supabase not connected — cannot generate'); return null; }
    const config = await _evGetConfig();
    if (!config || !config.template_url) { if (!opts.silent) UI.toast.error('No voucher template set up yet'); return null; }
    const { data: seq, error: rpcErr } = await sb.rpc('next_evoucher_number');
    if (rpcErr) throw rpcErr;
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear() % 100).padStart(2, '0');
    const prefix = config.prefix || '169';
    const code = `${prefix}${mm}${yy}${String(seq).padStart(3, '0')}`;
    const blob = await _evComposeVoucherBlob(config, name, code);
    const path = `evouchers/${prospectId}_${code}_${Date.now()}.png`;
    const { error: upErr } = await sb.storage.from('attachments').upload(path, blob, { upsert: false, contentType: 'image/png' });
    if (upErr) throw upErr;
    const { data: urlData } = sb.storage.from('attachments').getPublicUrl(path);
    if (!urlData?.publicUrl) throw new Error('Upload succeeded but could not get URL');
    // Insert via the RAW client with NO id. prospect_attachments.id is a
    // GENERATED-ALWAYS identity, so AppDataStore.create (which stamps a client-side
    // id) is rejected by Postgres with 428C9 ("cannot insert a non-DEFAULT value
    // into column id") and the row only ever saves locally. This mirrors the proven
    // order-form attachment insert (chunks/script-order-form-extract.js).
    const { data: savedRow, error: insErr } = await sb.from('prospect_attachments').insert({
        prospect_id: prospectId,
        attachment_type: 'evoucher',
        file_url: urlData.publicUrl,
        filename: `evoucher_${code}.png`,
        metadata: { voucher_code: code, recipient_name: name, seq, name_id: (nameId != null ? nameId : null), generated_by: (_state?.cu?.id || null), generated_at: now.toISOString() }
    }).select().single();
    if (insErr) throw insErr;
    try { if (AppDataStore.invalidateCache) AppDataStore.invalidateCache('prospect_attachments'); } catch (_) {}
    if (savedRow?.id) _evBlobCache[savedRow.id] = blob; // reuse for the immediate share gesture
    return savedRow;
};

// Top-button flow: read the typed name and generate an ad-hoc voucher (name_id=null).
const generateEvoucher = async (prospectId) => {
    if (_evTopBusy) return;
    const name = (document.getElementById('ev-name')?.value || '').trim();
    if (!name) { UI.toast.error('Please enter the holder name'); return; }
    _evTopBusy = true;
    try {
        const row = await _evGenSerialize(() => _evGenerateForName(prospectId, name, null));
        if (!row) return;
        UI.hideModal();
        UI.toast.success(`E-Voucher ${row.metadata?.voucher_code || ''} generated`);
        const bodyEl = document.getElementById(`acc-body-names-${prospectId}`);
        if (bodyEl) await switchProspectTab('names', prospectId, null, bodyEl);
    } catch (err) {
        console.error('E-Voucher generate failed:', err);
        UI.toast.error('Generate failed: ' + (err.message || 'Unknown error'));
    } finally {
        _evTopBusy = false;
    }
};

// Per-name flow: one voucher per Name List entry (the referred friend/family).
// Called auto on Add Name (opts.silent) and by the per-row "E-Voucher" button.
// Skips if that name already has a voucher (no duplicate serials).
const generateEvoucherForName = async (prospectId, name, nameId, opts = {}) => {
    name = (name || '').trim();
    if (!name) { if (!opts.silent) UI.toast.error('Name is required'); return null; }
    // Serialized so rapid per-row clicks / Add-Name auto-gens each generate in turn
    // instead of being dropped by a busy flag. The name_id dedup runs INSIDE the
    // critical section, so a double-fire for the same name returns the existing
    // voucher rather than minting a duplicate serial.
    return _evGenSerialize(async () => {
        try {
            if (nameId != null) {
                const existing = await AppDataStore.query('prospect_attachments', { prospect_id: prospectId });
                const dup = (existing || []).find(a => a.attachment_type === 'evoucher' && a.metadata && String(a.metadata.name_id) === String(nameId));
                if (dup) {
                    if (!opts.silent) {
                        UI.toast.success('This name already has a voucher.');
                        const b = document.getElementById(`acc-body-names-${prospectId}`);
                        if (b) await switchProspectTab('names', prospectId, null, b);
                    }
                    return dup;
                }
            }
            const row = await _evGenerateForName(prospectId, name, nameId, opts);
            if (!row) return null;
            if (!opts.silent) {
                UI.toast.success(`E-Voucher ${row.metadata?.voucher_code || ''} generated`);
                const bodyEl = document.getElementById(`acc-body-names-${prospectId}`);
                if (bodyEl) await switchProspectTab('names', prospectId, null, bodyEl);
            }
            return row;
        } catch (err) {
            console.error('Per-name e-voucher generate failed:', err);
            if (!opts.silent) UI.toast.error('Generate failed: ' + (err.message || 'Unknown error'));
            return null;
        }
    });
};

// Share the generated voucher IMAGE to the prospect. Primary: Web Share API
// (sends the actual PNG file). Fallback: open the prospect's WhatsApp chat with
// a caption + download the PNG so the agent can attach it (wa.me can't carry a file).
//
// NOT async, and synchronous up to navigator.share()/window.open(): the Web Share
// API and popups require transient user activation, which any await before them
// would consume (the gesture would be lost and share/open would silently fail —
// the same lesson as mhomeWa in script-mobile.js). All inputs are passed in from
// the render so we never await a DB read before the gesture. Freshly-generated
// vouchers carry their PNG in _evBlobCache, enabling a true file share on mobile;
// older vouchers (no cached blob) fall back to wa.me + download.
const sendVoucherWhatsApp = (prospectId, attId, code, rname, phone, fileUrl) => {
    code = code || '';
    rname = rname || '';
    const fname = `evoucher_${code || attId}.png`;
    const caption = `🎁 传福增运 · 九星引路\n这是一份专属的特殊个人风水解析券\n持券人：${rname}${code ? `\n序号：${code}` : ''}\n请凭此券免费预约 1对1 个人风水解析，为期30天。`;

    // PRIMARY (gesture-safe): a just-generated voucher has its PNG cached — share the
    // actual file synchronously inside the click so transient activation is preserved.
    const cached = _evBlobCache[attId];
    if (cached && navigator.share && navigator.canShare) {
        try {
            const file = new File([cached], fname, { type: 'image/png' });
            if (navigator.canShare({ files: [file] })) {
                navigator.share({ files: [file], title: 'Feng Shui E-Voucher', text: caption }).catch(() => {});
                return;
            }
        } catch (_) { /* fall through to wa.me */ }
    }

    // FALLBACK (gesture-safe): open the prospect's WhatsApp chat NOW (before any await),
    // then download the PNG so the agent can attach it. wa.me cannot carry a file.
    const num = _evWaPhone(phone);
    if (num) {
        window.open(`https://wa.me/${num}?text=${encodeURIComponent(caption)}`, '_blank', 'noopener');
    } else {
        UI.toast.error('No phone number on file — downloading the voucher to share manually.');
    }
    downloadVoucher(fileUrl, fname);
};

// --- Multi-select forward: all loose vouchers belong to the SAME prospect, so the
// agent can tick several and push them to that one person in a single WhatsApp send. ---
const _evSelRoot = (prospectId) => document.getElementById(`acc-body-names-${prospectId}`) || document;

const updateEvoucherSelection = (prospectId) => {
    const root = _evSelRoot(prospectId);
    // Highlight the selected cards so the agent sees at a glance what will be forwarded.
    root.querySelectorAll('.ev-sel-cb').forEach(cb => {
        const card = cb.closest('div');
        if (card) { card.style.outline = cb.checked ? '2px solid var(--primary)' : ''; card.style.outlineOffset = cb.checked ? '-1px' : ''; }
    });
    const n = root.querySelectorAll('.ev-sel-cb:checked').length;
    const total = root.querySelectorAll('.ev-sel-cb').length;
    const cnt = document.getElementById(`ev-cnt-${prospectId}`);
    if (cnt) cnt.textContent = n;
    const fwd = document.getElementById(`ev-fwd-${prospectId}`);
    if (fwd) { fwd.disabled = n === 0; fwd.style.opacity = n === 0 ? '0.5' : '1'; }
    const selAll = document.getElementById(`ev-selall-${prospectId}`);
    if (selAll) { selAll.checked = total > 0 && n === total; selAll.indeterminate = n > 0 && n < total; }
};

const toggleAllEvouchers = (prospectId, on) => {
    _evSelRoot(prospectId).querySelectorAll('.ev-sel-cb').forEach(cb => { cb.checked = on; });
    updateEvoucherSelection(prospectId);
};

const forwardSelectedVouchers = async (prospectId, phone) => {
    const boxes = [..._evSelRoot(prospectId).querySelectorAll('.ev-sel-cb:checked')];
    if (!boxes.length) { UI.toast.error('Tick at least one e-voucher to forward'); return; }
    const items = boxes.map(b => ({ id: b.dataset.att, code: b.dataset.code || '', url: b.dataset.url, fname: b.dataset.fname || `evoucher_${b.dataset.att}.png` }));
    const rname = boxes[0].dataset.rname || '';
    const serials = items.map(i => i.code).filter(Boolean);
    const caption = `🎁 传福增运 · 九星引路\n这是 ${items.length} 份专属个人风水解析券\n持券人：${rname}` +
        (serials.length ? `\n序号：${serials.join('、')}` : '') +
        `\n请凭券免费预约 1对1 个人风水解析，为期30天。`;

    // PRIMARY (mobile): Web Share can carry multiple files → all land on one WhatsApp
    // contact in a single message. Just-generated vouchers are cached (no await, gesture
    // stays live); stored ones are fetched, which may consume activation → wa.me fallback.
    if (navigator.share && navigator.canShare) {
        try {
            const files = [];
            for (const it of items) {
                let blob = _evBlobCache[it.id];
                if (!blob) {
                    const signed = (await AppDataStore.resolveAttachmentSrc(it.url)) || it.url;
                    const r = await fetch(signed);
                    if (r.ok) blob = await r.blob();
                }
                if (blob) files.push(new File([blob], it.fname, { type: 'image/png' }));
            }
            if (files.length && navigator.canShare({ files })) {
                await navigator.share({ files, title: 'Feng Shui E-Vouchers', text: caption });
                return;
            }
            // else: files not shareable on this platform → fall through to wa.me
        } catch (err) {
            // User dismissed the native share sheet — they chose not to send. Do NOT
            // then fire the wa.me fallback + bulk download behind their back.
            if (err && err.name === 'AbortError') return;
            /* real share/fetch failure (e.g. gesture lost) → fall through to wa.me + bulk download */
        }
    }

    // FALLBACK (desktop / no file-share): open the chat once, download every PNG so the
    // agent drags them all into WhatsApp Web (which accepts multiple images per message).
    const num = _evWaPhone(phone);
    if (num) {
        window.open(`https://wa.me/${num}?text=${encodeURIComponent(caption)}`, '_blank', 'noopener');
    } else {
        UI.toast.error('No phone on file — downloading the vouchers to share manually.');
    }
    for (const it of items) { await downloadVoucher(it.url, it.fname); }
    UI.toast.success(`${items.length} 张券已准备好转发`);
};

// Mark an e-voucher as redeemed/used (stamps metadata.redeemed_at). Clears the
// voucher_unredeemed nudge (dispatchVoucherNudges skips redeemed vouchers) and flips the
// per-name UI to a "已用" badge. Idempotent.
const markVoucherRedeemed = async (prospectId, attId) => {
    try {
        const att = await AppDataStore.getById('prospect_attachments', attId);
        if (!att) { UI.toast.error('Voucher not found'); return; }
        const md = Object.assign({}, att.metadata || {}, { redeemed_at: new Date().toISOString() });
        await AppDataStore.update('prospect_attachments', attId, { metadata: md });
        UI.toast.success('已标记为已使用');
        const bodyEl = document.getElementById(`acc-body-names-${prospectId}`);
        if (bodyEl) await switchProspectTab('names', prospectId, null, bodyEl);
    } catch (err) {
        console.warn('markVoucherRedeemed failed:', err?.message);
        UI.toast.error('更新失败');
    }
};

const downloadVoucher = async (fileUrl, filename) => {
    try {
        const signed = (await AppDataStore.resolveAttachmentSrc(fileUrl)) || fileUrl;
        const resp = await fetch(signed);
        if (!resp.ok) throw new Error('fetch ' + resp.status);
        const url = URL.createObjectURL(await resp.blob());
        const a = document.createElement('a');
        a.href = url; a.download = filename || 'evoucher.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
        console.warn('Download failed, opening in a tab instead:', err?.message);
        try { window._openAttachment(fileUrl); } catch (_) {}
    }
};

const removeEvoucher = async (prospectId, attId) => {
    if (!window.confirm('Remove this e-voucher?')) return;
    try {
        try {
            const atts = await AppDataStore.query('prospect_attachments', { prospect_id: prospectId });
            const row = (atts || []).find(a => String(a.id) === String(attId));
            if (row && row.file_url) {
                const path = AppDataStore.extractAttachmentPath(row.file_url);
                if (path) await AppDataStore.deleteAttachmentByPath(path);
            }
        } catch (_) { /* best-effort storage cleanup */ }
        delete _evBlobCache[attId];
        await AppDataStore.delete('prospect_attachments', attId);
        UI.toast.success('E-Voucher removed');
        const bodyEl = document.getElementById(`acc-body-names-${prospectId}`);
        if (bodyEl) await switchProspectTab('names', prospectId, null, bodyEl);
    } catch (err) {
        UI.toast.error('Remove failed: ' + (err.message || 'Unknown error'));
    }
};

// Admin-only: upload the standard voucher template and drag the two field
// markers (姓名 + 序号) onto the blanks. Stored in the evoucher_config singleton.
const openEvoucherTemplateSetup = async () => {
    if (!_evIsVoucherAdmin()) { UI.toast.error('Only admin / marketing manager can set up the voucher template.'); return; }
    const config = (await _evGetConfig()) || {};
    const nf = config.name_field || {};
    const numf = config.number_field || {};
    let tplPreview = '';
    if (config.template_url) {
        try { tplPreview = (await AppDataStore.resolveAttachmentSrc(config.template_url)) || config.template_url; } catch (_) { tplPreview = config.template_url; }
    }
    const nx = (nf.xPct != null ? nf.xPct : 0.5) * 100;
    const ny = (nf.yPct != null ? nf.yPct : 0.78) * 100;
    const ox = (numf.xPct != null ? numf.xPct : 0.78) * 100;
    const oy = (numf.yPct != null ? numf.yPct : 0.07) * 100;
    const content = `
        <style>.evt-marker{transform:translate(-50%,-50%);position:absolute;background:rgba(124,58,237,.92);color:#fff;font-size:12px;font-weight:700;padding:3px 9px;border-radius:12px;cursor:grab;user-select:none;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.35);touch-action:none;}</style>
        <div class="form-group">
            <label>Voucher template image ${config.template_url ? '<span style="color:#10B981;">(uploaded ✓ — choose a file to replace)</span>' : '(required)'}</label>
            <input type="file" id="evt-file" class="form-control" accept="image/*">
        </div>
        <p style="font-size:12px;color:var(--gray-600);margin:0 0 8px;">Drag <b style="color:#7C3AED;">姓名</b> onto the holder-name box and <b style="color:#7C3AED;">序号</b> onto the serial-number line.</p>
        <div style="font-size:12px;display:flex;gap:18px;flex-wrap:wrap;margin-bottom:10px;">
            <label>姓名 size <input type="range" id="evt-name-size" min="2" max="12" step="0.5" value="${nf.fontPct || 5}" style="vertical-align:middle;width:90px;"></label>
            <label>color <input type="color" id="evt-name-color" value="${nf.color || '#15233f'}" style="vertical-align:middle;"></label>
            <label>序号 size <input type="range" id="evt-num-size" min="1.5" max="10" step="0.5" value="${numf.fontPct || 3.5}" style="vertical-align:middle;width:90px;"></label>
            <label>color <input type="color" id="evt-num-color" value="${numf.color || '#b8341c'}" style="vertical-align:middle;"></label>
        </div>
        <div id="evt-stage" style="position:relative;display:inline-block;max-width:100%;border:1px solid var(--gray-200);border-radius:6px;overflow:hidden;${tplPreview ? '' : 'min-height:140px;width:100%;background:#f8f8f8;'}">
            ${tplPreview ? `<img id="evt-img" src="${safeUrl(tplPreview)}" style="display:block;max-width:100%;height:auto;">` : '<div id="evt-img" style="padding:40px 10px;text-align:center;color:#9CA3AF;">Choose a template image…</div>'}
            <div id="evt-mk-name" class="evt-marker" style="left:${nx}%;top:${ny}%;">姓名</div>
            <div id="evt-mk-num" class="evt-marker" style="left:${ox}%;top:${oy}%;">序号</div>
        </div>
    `;
    UI.showModal('E-Voucher Template Setup', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Save Template', type: 'primary', action: '(async () => { await app.saveEvoucherTemplate(); })()' }
    ]);
    setTimeout(() => _evBindTemplateSetup(), 80);
};

const _evBindTemplateSetup = () => {
    const stage = document.getElementById('evt-stage');
    if (!stage) return;
    const fileInput = document.getElementById('evt-file');
    if (fileInput) {
        fileInput.onchange = () => {
            const f = fileInput.files && fileInput.files[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = (e) => {
                let img = document.getElementById('evt-img');
                if (img && img.tagName === 'IMG') {
                    img.src = e.target.result;
                } else {
                    const newImg = document.createElement('img');
                    newImg.id = 'evt-img';
                    newImg.src = e.target.result;
                    newImg.style.cssText = 'display:block;max-width:100%;height:auto;';
                    if (img) img.replaceWith(newImg);
                    stage.style.minHeight = ''; stage.style.background = ''; stage.style.width = '';
                    // Markers may have been dragged over the empty placeholder box; reset
                    // them to sensible defaults so they're positioned against the real image.
                    const mkN = document.getElementById('evt-mk-name'); if (mkN) { mkN.style.left = '50%'; mkN.style.top = '78%'; }
                    const mkO = document.getElementById('evt-mk-num'); if (mkO) { mkO.style.left = '78%'; mkO.style.top = '7%'; }
                }
            };
            r.readAsDataURL(f);
        };
    }
    ['evt-mk-name', 'evt-mk-num'].forEach((id) => {
        const mk = document.getElementById(id);
        if (!mk) return;
        mk.addEventListener('pointerdown', (ev) => {
            ev.preventDefault();
            mk.style.cursor = 'grabbing';
            try { mk.setPointerCapture(ev.pointerId); } catch (_) {}
            const move = (e) => {
                const rect = stage.getBoundingClientRect();
                if (!rect.width || !rect.height) return;
                let x = (e.clientX - rect.left) / rect.width;
                let y = (e.clientY - rect.top) / rect.height;
                x = Math.max(0, Math.min(1, x));
                y = Math.max(0, Math.min(1, y));
                mk.style.left = (x * 100) + '%';
                mk.style.top = (y * 100) + '%';
            };
            const up = () => {
                mk.style.cursor = 'grab';
                mk.removeEventListener('pointermove', move);
                mk.removeEventListener('pointerup', up);
            };
            mk.addEventListener('pointermove', move);
            mk.addEventListener('pointerup', up);
        });
    });
};

const saveEvoucherTemplate = async () => {
    if (!_evIsVoucherAdmin()) { UI.toast.error('Not authorized'); return; }
    const sb = window.supabase || window.supabaseClient;
    if (!sb || !sb.storage) { UI.toast.error('Supabase not connected'); return; }
    const existing = (await _evGetConfig()) || {};
    const file = document.getElementById('evt-file')?.files?.[0];
    if (!existing.template_url && !file) { UI.toast.error('Please choose a template image'); return; }
    const frac = (id, axis, dflt) => {
        const raw = (document.getElementById(id)?.style?.[axis] || '').replace('%', '');
        const v = parseFloat(raw);
        return isNaN(v) ? dflt : v / 100;
    };
    const nameField = {
        xPct: frac('evt-mk-name', 'left', 0.5),
        yPct: frac('evt-mk-name', 'top', 0.78),
        fontPct: parseFloat(document.getElementById('evt-name-size')?.value) || 5,
        color: document.getElementById('evt-name-color')?.value || '#15233f',
        align: 'center', maxWidthPct: 0.6
    };
    const numField = {
        xPct: frac('evt-mk-num', 'left', 0.78),
        yPct: frac('evt-mk-num', 'top', 0.07),
        fontPct: parseFloat(document.getElementById('evt-num-size')?.value) || 3.5,
        color: document.getElementById('evt-num-color')?.value || '#b8341c',
        align: 'center', maxWidthPct: 0.4
    };
    try {
        let templateUrl = existing.template_url;
        if (file) {
            if (file.size > 8 * 1024 * 1024) { UI.toast.error('Template too large (max 8MB)'); return; }
            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const path = `evoucher_templates/template_${Date.now()}_${safeName}`;
            const { error: upErr } = await sb.storage.from('attachments').upload(path, file, { upsert: false, contentType: file.type });
            if (upErr) throw upErr;
            const { data: urlData } = sb.storage.from('attachments').getPublicUrl(path);
            if (!urlData?.publicUrl) throw new Error('Upload succeeded but could not get URL');
            templateUrl = urlData.publicUrl;
        }
        const { data: updRows, error } = await sb.from('evoucher_config').update({
            template_url: templateUrl,
            name_field: nameField,
            number_field: numField,
            updated_at: new Date().toISOString(),
            updated_by: (_state?.cu?.id || null)
        }).eq('id', 1).select('id');
        if (error) throw error;
        // A zero-row update means RLS silently rejected the write (not an admin at
        // the DB layer). Surface it instead of a false success, and clean up the
        // template we just uploaded so storage doesn't accrete orphans.
        if (!updRows || !updRows.length) {
            if (file && templateUrl) {
                try { const p = AppDataStore.extractAttachmentPath(templateUrl); if (p) await AppDataStore.deleteAttachmentByPath(p); } catch (_) {}
            }
            UI.toast.error('Not authorized to save the voucher template (admin level required).');
            return;
        }
        UI.hideModal();
        UI.toast.success('Voucher template saved');
    } catch (err) {
        console.error('Save template failed:', err);
        UI.toast.error('Save failed: ' + (err.message || 'Unknown error'));
    }
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
    // Recover the activity id by stripping the 3-char suffix as a STRING — do NOT
    // parseInt: some synced activities use fp_* UUID string PKs, and parseInt(uuid)
    // = NaN would silently skip the DB write (localStorage-only). Coerce to a number
    // only when the id is purely numeric so legacy int-keyed rows still match.
    const rawId = itemId.slice(0, -3);
    const activityId = /^\d+$/.test(rawId) ? parseInt(rawId, 10) : rawId;
    const field = isNa ? 'next_action_done' : 'note_next_steps_done';
    if (activityId !== '' && activityId != null) {
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
        npo_plan_id: paymentMethod === 'NPO' ? (document.getElementById('cr-npo-plan')?.value || '') : '',
        npo_plan_name: paymentMethod === 'NPO' ? (() => { const s = document.getElementById('cr-npo-plan'); const o = s && s.options[s.selectedIndex]; return o && o.value ? (o.getAttribute('data-name') || (o.textContent || '').trim()) : ''; })() : '',
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

// ── NPO package picker for the DC Closing Record form (prefix 'cr') ──────────
// Mirrors the Meeting-Outcome closing flow. Defined locally (not reused from the
// activities chunk) so the picker works even if that chunk isn't loaded. NPO
// config stays L1-only; any closer can pick an active package here.
const crPaymentMethodChanged = (val) => {
    const pop = document.getElementById('cr-pop-fields');
    if (pop) pop.style.display = val === 'POP' ? 'block' : 'none';
    const npo = document.getElementById('cr-npo-fields');
    if (npo) npo.style.display = val === 'NPO' ? 'block' : 'none';
    if (val === 'NPO') {
        const sel = document.getElementById('cr-npo-plan');
        crNpoFillPlans((sel && sel.getAttribute('data-selected')) || '');
    }
};

const crNpoFillPlans = async (selectedId) => {
    const sel = document.getElementById('cr-npo-plan');
    if (!sel) return;
    let plans = [];
    try { plans = (await AppDataStore.getAll('npo_plans')) || []; } catch (_) { plans = []; }
    plans = plans.filter(p => p && p.is_active !== false).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (!plans.length) {
        sel.innerHTML = '<option value="">— No NPO packages configured —</option>';
        const cap = document.getElementById('cr-npo-selected');
        if (cap) cap.innerHTML = '<span style="color:#b45309;">No active NPO package — ask an admin to set one up.</span>';
        return;
    }
    const want = String(selectedId || sel.getAttribute('data-selected') || '');
    sel.innerHTML = '<option value="">— Select package —</option>' + plans.map(p =>
        `<option value="${p.id}" data-name="${escapeHtml(p.name || '')}" ${want === String(p.id) ? 'selected' : ''}>${escapeHtml(p.name || ('Package #' + p.id))}</option>`).join('');
    crNpoPlanPicked();
};

const crNpoPlanPicked = () => {
    const sel = document.getElementById('cr-npo-plan');
    const cap = document.getElementById('cr-npo-selected');
    if (!sel || !cap) return;
    const o = sel.options[sel.selectedIndex];
    const name = o && o.value ? (o.getAttribute('data-name') || (o.textContent || '').trim()) : '';
    cap.innerHTML = name
        ? `Selected package: <strong>${escapeHtml(name)}</strong>`
        : '<span style="color:#ef4444;">Please choose an NPO package.</span>';
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
        } catch(_) { /* intentional: JSON.parse fallback — malformed/empty stays [] */ }
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
            // Surface async-save failures in the base64 fallback (was an unhandled
            // rejection — user got no error toast and the row silently failed to save).
            reader.onload = async (e) => {
                try { await saveRow(e.target.result, file.name); }
                catch (err) { UI.toast.error('Failed to save record: ' + (err.message || 'Unknown error')); }
            };
            reader.onerror = () => UI.toast.error('Could not read the selected file');
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
        } catch(_) { /* intentional: JSON.parse fallback — malformed/empty stays [] */ }
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
        // Surface async-save failures in the base64 fallback (was an unhandled rejection).
        reader.onload = async (e) => {
            try { await saveAttachment(e.target.result, file.name); }
            catch (err) { UI.toast.error('Failed to save attachment: ' + (err.message || 'Unknown error')); }
        };
        reader.onerror = () => UI.toast.error('Could not read the selected file');
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
    } catch(_) { /* intentional: JSON.parse fallback — malformed/empty stays [] */ }
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
    } catch(_) { /* intentional: JSON.parse fallback — malformed/empty returns [] */ return []; }
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
        try { productRecord = await AppDataStore.getById('formula', productId); } catch(_) { /* intentional: best-effort master lookup — finish-date calc just skipped */ }
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
        // Surface async-save failures in the base64 fallback (was an unhandled rejection).
        reader.onload = async (e) => {
            try { await saveRow(e.target.result, file.name); }
            catch (err) { UI.toast.error('Failed to save record: ' + (err.message || 'Unknown error')); }
        };
        reader.onerror = () => UI.toast.error('Could not read the selected file');
        reader.readAsDataURL(file);
    } else {
        await saveRow(null, null);
    }
};

const addProductPurchaseAttachment = async (prospectId, type, index, fileInput) => {
    const file = fileInput?.files[0];
    if (!file) return;
    const reader = new FileReader();
    // Surface async-save failures (was an unhandled rejection with no user feedback).
    reader.onload = async (e) => {
        try {
            const prospect = await AppDataStore.getById('prospects', prospectId);
            if (!prospect) return UI.toast.error('Prospect not found');
            const records = _readProductPurchases(prospect, type);
            if (records[index]) {
                records[index].attachment_name = file.name;
                records[index].attachment_data = e.target.result;
            }
            await _writeProductPurchases(prospectId, prospect, type, records);
            UI.toast.success('Attachment saved');
            await _refreshProductPurchaseTab(prospectId, type);
        } catch (err) {
            UI.toast.error('Failed to save attachment: ' + (err.message || 'Unknown error'));
        }
    };
    reader.onerror = () => UI.toast.error('Could not read the selected file');
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
    } catch(_) { /* intentional: JSON.parse fallback — malformed/empty returns [] */ return []; }
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
                        <img loading="lazy" decoding="async" data-attach-src="${escapeHtml(String(p.url))}" style="width:100%;height:90px;object-fit:cover;cursor:pointer;" onclick="window._openAttachment('${UI.escJsAttr(String(p.url))}')">
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
                    <img loading="lazy" decoding="async" data-attach-src="${escapeHtml(String(url))}" style="width:90px;height:90px;object-fit:cover;border-radius:4px;cursor:pointer;border:1px solid var(--gray-200);" onclick="window._openAttachment('${UI.escJsAttr(String(url))}')">
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
    catch (_) { /* intentional: optional calendar mirror — abort quietly, closing_record already saved */ return; }
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
        // Field-name fix: gatherClosingFormData writes pop_down_payment (line ~4248),
        // not pop_down — reading cr.pop_down silently dropped the POP down-payment.
        if (cr.pop_down_payment) updates.pop_down_payment = cr.pop_down_payment;
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
    const isManager = isSystemAdmin(_state.cu) || isMarketingManager(_state.cu);
    const qualifiesForConversion = saleAmount >= 2000 && !isAlreadyConverted;
    const submittedCr = { ...existingCr, ...data, status: 'submitted', submitted_at: new Date().toISOString() };
    const updates = {
        closing_record: submittedCr
    };

    // Auto-trigger conversion approval only for first-time conversions
    if (qualifiesForConversion) {
        updates.conversion_status = 'pending_approval';
        updates.conversion_requested_at = new Date().toISOString();
        updates.conversion_requested_by = _state.cu?.id;
    }

    // Guard the PRIMARY closing-record write + activity mirror: if this throws
    // (RLS/offline), the sale is NOT recorded — surface the error and abort before
    // the success toast, instead of rejecting silently while claiming success.
    try {
        await AppDataStore.update('prospects', prospectId, updates);
        await _mirrorCrToActivity(prospectId, submittedCr);
    } catch (err) {
        console.warn('submitClosingRecord primary update failed:', err);
        UI.toast.error('Failed to submit closing record. Please retry.');
        return;
    }

    // Create approval queue entries for non-managers
    if (!isManager) {
        // Re-fetch post-update so snapshot captures the freshly submitted closing_record
        const freshProspect = await AppDataStore.getById('prospects', prospectId);
        try {
            // New sale approval entry
            await AppDataStore.create('approval_queue', {
                id: window.AppDataStore._generateId(),
                approval_type: 'new_sale',
                status: 'pending',
                prospect_id: prospectId,
                customer_id: null,
                submitted_by: _state.cu?.id,
                submitted_at: new Date().toISOString(),
                snapshot_before: null,
                snapshot_after: { ...data, sale_amount: saleAmount, prospect_name: freshProspect?.full_name },
                description: `New sale RM ${saleAmount.toLocaleString()} for ${freshProspect?.full_name || 'prospect'}`
            });
            // If auto-conversion triggered and not already a customer, create new_customer entry
            if (qualifiesForConversion) {
                await AppDataStore.create('approval_queue', {
                    id: window.AppDataStore._generateId(),
                    approval_type: 'new_customer',
                    status: 'pending',
                    prospect_id: prospectId,
                    customer_id: null,
                    submitted_by: _state.cu?.id,
                    submitted_at: new Date().toISOString(),
                    snapshot_before: null,
                    snapshot_after: freshProspect,
                    description: `New customer conversion for ${freshProspect?.full_name} (auto-triggered by sale RM ${saleAmount.toLocaleString()})`
                });
            }
        } catch (e) {
            console.warn('[approval_queue] new_customer (auto-conversion-on-sale) insert failed', e);
            try { if (window.UI && UI.toast) (UI.toast.warning || UI.toast.error)('Sale recorded, but the conversion approval record could not be created.'); } catch (_) {}
        }
    }

    // A manager is themselves the conversion approver — so a qualifying first
    // sale they submit converts to a Customer immediately instead of parking in
    // pending_approval (the old path set pending_approval but created NO queue
    // entry for managers, leaving the prospect stuck as a prospect forever).
    // approveProspectConversion reads the freshly-submitted closing_record,
    // creates the customer with lifetime_value = sale amount, archives the CR,
    // and refreshes the view + toasts "<name> is now a Customer!".
    if (isManager && qualifiesForConversion) {
        await window.app.approveProspectConversion(prospectId);
        return;
    }

    if (qualifiesForConversion) {
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

    // Feature-detect getByIdFull explicitly: `await` binds tighter than `?:`, so the
    // previous form awaited the function reference itself, not the call. Parenthesize.
    const prospect = AppDataStore.getByIdFull
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
    // getByIdFull does a live fetch and can return null (RLS deny / offline / deleted).
    // Guard before dereferencing, matching savePurchasesHistoryRow.
    if (!prospect) return UI.toast.error('Prospect not found');
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
    if (!_state.phc || now - _state.phcts > 300_000) {
        await _loadPurchasesHistory();
    }
    _renderPurchasesHistory(viewport);
};

const _loadPurchasesHistory = async () => {
    try {
        // Scale-safe: fetch ONLY converted/approved prospects server-side (status OR
        // conversion_status) instead of downloading the WHOLE prospects table just to
        // collect converted IDs. Falls back to the exact legacy two-step (getAll +
        // client filter + .in) on any error / when offline, so behavior is identical.
        const PH_SELECT = 'id,full_name,responsible_agent_id,closing_records_history,closing_record,conversion_status';
        let data = [];
        let usedServerFilter = false;
        try {
            if (AppDataStore.hasLiveSession && !AppDataStore.hasLiveSession()) {
                throw new Error('no live session — using cached fallback');
            }
            const { data: rows, error } = await AppDataStore._readClient()
                .from('prospects')
                .select(PH_SELECT)
                .or('status.eq.converted,conversion_status.eq.approved');
            if (error) throw error;
            data = rows || [];
            usedServerFilter = true;
        } catch (eServer) {
            console.warn('[PH] server-side converted-prospects query unavailable — legacy whole-table fallback', eServer);
            const allProspects = await AppDataStore.getAll('prospects');
            const convertedIds = (allProspects || [])
                .filter(p => p.status === 'converted' || p.conversion_status === 'approved')
                .map(p => p.id);
            if (convertedIds.length) {
                const { data: rows, error } = await AppDataStore._readClient()
                    .from('prospects')
                    .select(PH_SELECT)
                    .in('id', convertedIds);
                if (error) throw error;
                data = rows || [];
            }
        }
        console.log('[PH] data rows to process:', data.length, usedServerFilter ? '(server-filtered)' : '(legacy)');
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
        _state.phc = { rows, agentMap };
        _state.phcts = Date.now();
    } catch (e) {
        console.error('Purchases history load error:', e);
        _state.phc = { rows: [], agentMap: {} };
        _state.phcts = Date.now();
    }
};

// React-island Purchases History (default-on). The island owns filter+page state
// (keeps search focus) and renders the editable table with the SAME cell ids so
// app.savePurchasesHistoryRow still works. Kill-switch → legacy: __REACT_PURCHASES
// ===false, ?react=0, crm_react_off='1'. A minimal server-data legacy table (below)
// is the real fallback when React is off or the island mount throws.

// Minimal legacy Purchases History table — rendered from _state.phc.rows with the
// ph-ds-/ph-rem-/ph-cc- cell ids that savePurchasesHistoryRow reads, so Save works
// without the React island. Honors _phFilter (text) + _phPage pagination.
const _renderPurchasesHistoryLegacy = (viewport) => {
    const { rows = [] } = _state.phc || {};
    const q = (_phFilter.q || '').trim().toLowerCase();
    const filtered = q
        ? rows.filter(r => `${r.customerName} ${r.agentName} ${r.invoiceNo} ${r.product}`.toLowerCase().includes(q))
        : rows;
    const total = filtered.length;
    const start = _phPage * _PH_PAGE_SIZE;
    const page = filtered.slice(start, start + _PH_PAGE_SIZE);
    const dsOptions = ['pending','Pending Delivery','Dispatched','Delivered','Partial Delivery','Cancelled','Doubtful'];
    const body = page.map(r => {
        const rk = `${r.prospectId}-${r.historyIndex}`;
        const opts = dsOptions.map(o => `<option value="${escapeHtml(o)}"${o === r.deliveryStatus ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('');
        return `<tr style="border-bottom:1px solid var(--border);">
            <td style="padding:6px 10px;font-size:12px;">${escapeHtml(r.date || '-')}</td>
            <td style="padding:6px 10px;font-size:12px;">${escapeHtml(r.customerName || '-')}</td>
            <td style="padding:6px 10px;font-size:12px;color:var(--gray-500);">${escapeHtml(r.agentName || '-')}</td>
            <td style="padding:6px 10px;font-size:12px;">${escapeHtml(r.invoiceNo || '-')}</td>
            <td style="padding:6px 10px;font-size:12px;">${escapeHtml(r.product || '-')}</td>
            <td style="padding:6px 10px;font-size:12px;font-weight:600;">RM ${(r.amount || 0).toLocaleString()}</td>
            <td style="padding:6px 10px;"><select id="ph-ds-${escapeHtml(rk)}" class="form-control" style="font-size:11px;padding:2px 6px;">${opts}</select></td>
            <td style="padding:6px 10px;"><input id="ph-rem-${escapeHtml(rk)}" class="form-control" style="font-size:11px;padding:2px 6px;" value="${escapeHtml(r.remarks || '')}"></td>
            <td style="padding:6px 10px;text-align:center;"><input type="checkbox" id="ph-cc-${escapeHtml(rk)}"${r.caseCompleted ? ' checked' : ''}></td>
            <td style="padding:6px 10px;"><button class="btn secondary btn-sm" style="font-size:11px;padding:2px 8px;" onclick="app.savePurchasesHistoryRow('${UI.escJsAttr(String(r.prospectId))}',${r.historyIndex},${r.isHistory})">Save</button></td>
        </tr>`;
    }).join('');
    const pages = Math.max(1, Math.ceil(total / _PH_PAGE_SIZE));
    const pager = pages > 1
        ? `<div style="display:flex;gap:6px;align-items:center;justify-content:flex-end;padding:8px 10px;font-size:12px;">
            <button class="btn secondary btn-sm" ${_phPage <= 0 ? 'disabled' : ''} onclick="app.phSetPage(${_phPage - 1})">Prev</button>
            <span>Page ${_phPage + 1} / ${pages}</span>
            <button class="btn secondary btn-sm" ${_phPage >= pages - 1 ? 'disabled' : ''} onclick="app.phSetPage(${_phPage + 1})">Next</button>
        </div>` : '';
    viewport.innerHTML = `
        <div style="padding:12px;">
            <div style="margin-bottom:10px;"><input class="form-control" placeholder="Search customer / agent / invoice / product…" value="${escapeHtml(_phFilter.q || '')}" oninput="app.phSetFilter('q', this.value)" style="max-width:360px;"></div>
            <div style="border:1px solid var(--border);border-radius:8px;overflow:auto;">
                <table style="width:100%;border-collapse:collapse;min-width:900px;">
                    <thead><tr style="background:var(--gray-50);text-align:left;">
                        <th style="padding:8px 10px;font-size:11px;">Date</th><th style="padding:8px 10px;font-size:11px;">Customer</th><th style="padding:8px 10px;font-size:11px;">Agent</th><th style="padding:8px 10px;font-size:11px;">Invoice</th><th style="padding:8px 10px;font-size:11px;">Product</th><th style="padding:8px 10px;font-size:11px;">Amount</th><th style="padding:8px 10px;font-size:11px;">Delivery</th><th style="padding:8px 10px;font-size:11px;">Remarks</th><th style="padding:8px 10px;font-size:11px;">Done</th><th style="padding:8px 10px;font-size:11px;"></th>
                    </tr></thead>
                    <tbody>${body || `<tr><td colspan="10" style="padding:24px;text-align:center;color:var(--gray-400);font-size:12px;">No purchase history records.</td></tr>`}</tbody>
                </table>
            </div>
            ${pager}
        </div>`;
};

const _reactPurchasesOn = () => {
    try {
        if (window.__REACT_PURCHASES === false) return false;
        if (/[?&]react=0/.test(location.search)) return false;
        if (localStorage.getItem('crm_react_off') === '1') return false;
        return !!(window.CRMReact && typeof window.CRMReact.mountPurchasesHistory === 'function');
    } catch (_) { /* intentional: feature-detection probe — any failure means React island unavailable */ return false; }
};

const _renderPurchasesHistory = (viewport) => {
    const { rows = [], agentMap = {} } = _state.phc || {};
    if (_reactPurchasesOn()) {
        try {
            viewport.innerHTML = '<div id="purchases-react-root"></div>';
            window.CRMReact.mountPurchasesHistory(document.getElementById('purchases-react-root'), { rows, agentMap });
            return;
        } catch (e) {
            console.warn('[purchases_history] react mount failed — using legacy table:', e && e.message);
            _renderPurchasesHistoryLegacy(viewport);
            return;
        }
    }
    // React off (kill-switch) → real legacy table, not a dead error message.
    _renderPurchasesHistoryLegacy(viewport);
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
    _state.phc = null;
    _state.phcts = 0;
    const vp = document.getElementById('content-viewport');
    if (vp) await showPurchasesHistoryView(vp);
};

const savePurchasesHistoryRow = async (prospectId, historyIndex, isHistory) => {
    // Authz: this is the write path of the Super-Admin-only Purchases History screen.
    // Without this gate any authenticated user could deep-link the view and call
    // app.savePurchasesHistoryRow(...) to mutate other teams' closing/fulfilment records.
    if (!isSystemAdmin(_state.cu)) return UI.toast.error('Not permitted');
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
    if (_state.phc?.rows) {
        const row = _state.phc.rows.find(r => r.prospectId == prospectId && r.historyIndex == historyIndex && r.isHistory === isHistory);
        if (row) Object.assign(row, updates);
    }
    UI.toast.success('Saved');
};

const openRecruitModal = async (customerId) => {
    const customer = await AppDataStore.getById('customers', customerId);
    if (!customer) return UI.toast.error('Customer not found');
    const content = `
<div class="form-section">
                <div style="background:#f1f5f9;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:13px;color:var(--gray-700);"><i class="fas fa-user" style="margin-right:6px;color:var(--primary);"></i> Recruiting: <strong>${escapeHtml(customer.full_name || 'Customer')}</strong></div>
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
        // Pass customerId so the recruitment approval entry carries a customer_id link
        // (submitRecruitmentApproval in script-fude.js must read it — see cross_file_needs).
        { label: 'Submit for Approval', type: 'primary', action: `(async () => { await app.submitRecruitmentApproval(${customerId}); })()` }
    ]);
};


const confirmDelete = async (id) => {
    // Defence-in-depth: legacy delete path must enforce the same Level>5 gate as the
    // live confirmDeleteProspect path, not rely solely on RLS.
    if (_getUserLevel(_state.cu) > 5) { UI.toast.error('You do not have permission to delete prospects.'); return; }
    UI.showModal('Delete Confirmation',
        '<p>Are you sure you want to delete this prospect? This action cannot be undone.</p>', [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Confirm Delete', type: 'primary', action: `(async () => { await app.executeDelete(${id}); })()` }
    ]
    );
};

const executeDelete = async (id) => {
    // Defence-in-depth: executeDelete is reachable as app.executeDelete(id). Gate it on
    // the same Level>5 rule the live delete path enforces, not solely on RLS.
    if (_getUserLevel(_state.cu) > 5) { UI.toast.error('You do not have permission to delete prospects.'); return; }
    UI.hideModal();
    try {
        const [acts, notesByFk, notesByEntity, names, referrals] = await Promise.all([
            AppDataStore.query('activities', { prospect_id: id }).catch(() => []),
            // Indexed lookups instead of downloading the whole notes table.
            AppDataStore.query('notes', { prospect_id: id }).catch(() => []),
            AppDataStore.query('notes', { entity_type: 'prospect', entity_id: id }).catch(() => []),
            AppDataStore.query('names', { prospect_id: id }).catch(() => []),
            AppDataStore.query('referrals', { referred_prospect_id: id }).catch(() => []),
        ]);
        const notesMap = new Map();
        for (const n of [...notesByFk, ...notesByEntity]) notesMap.set(n.id, n);
        const notes = [...notesMap.values()];
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
                ${availableTags.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
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
    try { sol = (await AppDataStore.getAll('proposed_solutions')).find(s => String(s.id) === String(solutionId)); } catch (e) { /* intentional: fetch failure leaves sol undefined → handled by the not-found guard below */ }
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

    const isManager = isSystemAdmin(_state.cu) || isMarketingManager(_state.cu);

    if (isManager) {
        await window.app.showConversionApprovalModal(prospectId);
    } else {
        const saleAmount = parseFloat(prospect.closing_record?.sale_amount) || 0;
        UI.showModal('Request Conversion to Customer', `
            <div style="display:flex; flex-direction:column; gap:12px;">
                <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:12px; font-size:13px; color:#1e40af;">
                    <i class="fas fa-info-circle" style="margin-right:6px;"></i>
                    Your request will be reviewed by a manager before the customer profile is created.
                </div>
                <div style="font-size:13px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                    <div><span style="color:var(--gray-500);">Prospect:</span> <strong>${escapeHtml(prospect.full_name)}</strong></div>
                    <div><span style="color:var(--gray-500);">Phone:</span> ${escapeHtml(prospect.phone)}</div>
                    ${saleAmount > 0 ? `<div><span style="color:var(--gray-500);">Sale Amount:</span> <strong>RM ${saleAmount.toLocaleString()}</strong></div>` : ''}
                    <div><span style="color:var(--gray-500);">Referrer:</span> ${escapeHtml(prospect.referred_by || '-')}</div>
                </div>
            </div>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: '<i class="fas fa-paper-plane"></i> Submit for Approval', type: 'primary', action: `(async () => { await app.requestProspectConversion(${prospectId}); })()` }
        ]);
    }
};

// openPastRecordModal is owned by chunks/script-activities.js and has NO core
// lazy-stub, so the prospect-detail "Past Record" button (inline app.openPastRecordModal)
// throws TypeError before the activities chunk is warmed. Register a self-loading
// stub here that loads activities on demand and re-dispatches via the module
// namespace (robust against flat-key clobber regardless of chunk load order).
const openPastRecordModal = async (...args) => {
    await window._loadChunk('chunks/script-activities.min.js');
    const real = (window.app._modules && window.app._modules.activities && window.app._modules.activities.openPastRecordModal)
        || (window.app.openPastRecordModal !== openPastRecordModal ? window.app.openPastRecordModal : null);
    if (typeof real === 'function') return real(...args);
    UI.toast.error('Could not open Past Record. Please reload and try again.');
};


    app.register('prospects', {
        openPastRecordModal,
        EXPORT_HARD_LIMIT,
        EXPORT_WARN_THRESHOLD,
        _computeFinishDate,
        _confirmLargeExport,
        _downloadSheet,
        _getAllActivitiesForExport,
        _getAllProspectsForExport,
        _loadPurchasesHistory,
        _mirrorCrToActivity,
        _productPurchaseKey,
        _readFengShuiAudits,
        _readProductPurchases,
        _refreshCustClosingAfterProspectSave,
        _refreshFengShuiTab,
        _refreshProductPurchaseTab,
        _renderPurchasesHistory,
        _triggerRefillRpc,
        _uploadFengShuiToBucket,
        _writeFengShuiAudits,
        _writeProductPurchases,
        addFengShuiSiteReview,
        addNote,
        addPrePurchaseAttachment,
        addPrePurchaseRow,
        addProductPurchaseAttachment,
        addProductPurchaseRow,
        addTagToEntity,
        archiveAndNewClosingRecord,
        attachActivityPhoto,
        attachAppraisalForm,
        bulkDeleteProspects,
        bulkReassignProspects,
        calculateAge,
        calculateDaysLeft,
        calculateProtectionDays,
        checkPhotoUrlsColumn,
        clearProspectSelection,
        compressImageFile,
        confirmBulkReassign,
        confirmDelete,
        confirmDeleteProspect,
        convertToCustomer,
        deleteFengShuiAudit,
        deleteNote,
        deletePrePurchaseRecord,
        deleteProductPurchaseRecord,
        deleteProspect,
        deleteSolution,
        downloadProspectVCard,
        editProspect,
        executeConfirmedBulkReassign,
        executeDelete,
        exportData,
        extendProtection,
        filterProspects,
        gatherClosingFormData,
        crPaymentMethodChanged,
        crNpoFillPlans,
        crNpoPlanPicked,
        getAvatarColor,
        getInitials,
        getProtectionStatus,
        getScoreGrade,
        openAddSolutionModal,
        openAddTagModal,
        openEditSolutionModal,
        openFengShuiAuditModal,
        openFengShuiPhotosModal,
        openFengShuiSitePhotosModal,
        openProspectGradePicker,
        openProspectModal,
        openProspectWhatsApp,
        openRecruitModal,
        openReviveProspectModal,
        phSetFilter,
        phSetPage,
        prospectPageNav,
        reassignProspect,
        recordSalesClosure,
        refreshPurchasesHistory,
        removeAPUForm,
        removeActivityPhoto,
        removeAppraisalForm,
        removeFengShuiFile,
        removeFengShuiPhoto,
        removeFengShuiSitePhoto,
        removeFengShuiSiteReview,
        removeTagFromCustomer,
        removeTagFromProspect,
        renderCustomerClosingTab,
        renderProspectCards,
        renderProspectsTable,
        saveAPUForm,
        saveActivityPhoto,
        saveAppraisalForm,
        saveClosingDeliveryStatus,
        saveClosingHistoryEntry,
        saveClosingRecord,
        saveFengShuiAudit,
        saveProspect,
        savePurchasesHistoryRow,
        saveReviveProspect,
        saveSolution,
        saveSolutionEdit,
        setProspectGrade,
        showFieldError,
        showPhotoUrlsMigrationModal,
        showProspectDetail,
        showProspectsView,
        showPurchasesHistoryView,
        sortProspects,
        sortProspectsBySelect,
        submitClosingRecord,
        switchProspectTab,
        timeAgo,
        toggleAccordion,
        toggleCustomerAccordion,
        toggleNextAction,
        toggleNextActionItem,
        toggleProspectFilters,
        toggleProspectSelect,
        toggleProspectSelectAll,
        toggleProspectView,
        transferProspect,
        updateFengShuiPhotoRemark,
        updateFengShuiSiteReviewField,
        updateProspectBulkBar,
        updateProspectFilterBadge,
        uploadAPUForm,
        openGenerateEvoucherModal,
        generateEvoucher,
        generateEvoucherForName,
        sendVoucherWhatsApp,
        forwardSelectedVouchers,
        updateEvoucherSelection,
        toggleAllEvouchers,
        downloadVoucher,
        removeEvoucher,
        markVoucherRedeemed,
        openEvoucherTemplateSetup,
        saveEvoucherTemplate,
        uploadFengShuiFile,
        uploadFengShuiPhotos,
        uploadFengShuiSitePhotos,
        uploadHistoryInvoice,
        viewActivityPhotos,
    });
})();
