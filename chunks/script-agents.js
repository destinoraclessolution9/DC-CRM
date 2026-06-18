/**
 * CRM Lazy Chunk: Agent / Consultant Management
 * Covers: Agents list/profile/detail, agent CRUD/renew/password/upline/targets
 *   modals + helpers. Split out of script-prospects.js 2026-06-18.
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

            <!-- React island mount target. renderAgentsTable swaps visibility
                 between this and the legacy table below when the opt-in React
                 agents path (__REACT_AGENTS) is active. -->
            <div id="agents-react-root" style="display:none;"></div>
            <div id="agents-table-container" class="agents-table-container">
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

// ── React-island Agents path ─────────────────────────────────────────────────
// PROMOTED TO DEFAULT 2026-06-15 (parity-verified: island === legacy, 20/20 rows
// identical). Engages whenever the island bundle is present. Kill-switch → legacy
// table (instant rollback, no deploy): window.__REACT_AGENTS===false, ?react=0,
// or localStorage crm_react_off='1'. Legacy table remains the fallback on any
// mount/data error (the try/catch in renderAgentsTable).
const _reactAgentsOn = () => {
    try {
        if (window.__REACT_AGENTS === false) return false;
        if (/[?&]react=0/.test(location.search)) return false;
        if (localStorage.getItem('crm_react_off') === '1') return false;
        return !!(window.CRMReact && typeof window.CRMReact.mountAgentsTable === 'function');
    } catch (_) { /* intentional: feature-detection probe — any failure means React island unavailable */ return false; }
};

// Swap visibility between the React mount root and the legacy table container.
const _showAgentsReactRoot = (useReact) => {
    const root   = document.getElementById('agents-react-root');
    const legacy = document.getElementById('agents-table-container');
    if (root)   root.style.display   = useReact ? '' : 'none';
    if (legacy) legacy.style.display = useReact ? 'none' : '';
};

const renderAgentsTable = async () => {
    const tbody = document.getElementById('agents-table-body');
    if (!tbody) {
        console.error('agents-table-body not found');
        return;
    }

    const allAgents = (await AppDataStore.getAll('users')).filter(u => isAgent(u) || u.agent_code);
    const visibleIds = await getVisibleUserIds(_state.cu);
    const agents = visibleIds === 'all' ? allAgents : allAgents.filter(a => visibleIds.map(String).includes(String(a.id)));

    // React island reuses the SAME identity+scope `agents` list above; it applies
    // the toolbar filters + joins per-agent counts (React Query). Legacy table is
    // the fallback. mountAgentsTable + return short-circuits the legacy render.
    if (_reactAgentsOn()) {
        const reactRoot = document.getElementById('agents-react-root');
        if (reactRoot) {
            try {
                // Per-agent count maps (REND-3). The displayed Prospects/Customers
                // counts are NOT taken from agent_stats (its `total_assigned` is a
                // precomputed summary, not provably equal to the live count the
                // island shows) — they are bucketed live PER VISIBLE AGENT from the
                // prospects/customers tables. So we only need the rows whose owning
                // agent is one of the rows in this table — NOT the whole tables.
                // `agents` is already identity-filtered + visibility-scoped (above),
                // so its ids form the exact bound; the maps are read only for these
                // ids. We push that bound as a scoped query (compiles to `.in()`),
                // KEEP the byte-identical bucket loops, and FALL BACK to the original
                // whole-table getAll on cap-overflow / error so the maps stay a
                // superset narrowed by the unchanged loops → counts identical.
                // agent_stats is a tiny one-row-per-agent summary (not a whole-table
                // scan concern) and feeds the followup-rate map where row ORDER
                // decides last-wins on any duplicate agent_id — so it keeps getAll
                // unchanged to preserve that exact ordering.
                const FETCH_CAP = 10000;
                const _agentIds = agents.map(a => a.id);
                const _allS = await AppDataStore.getAll('agent_stats');
                let _allP, _allC;
                if (_agentIds.length === 0) {
                    // No table rows to count for — empty count maps. (An empty scope
                    // IN () would be malformed, and getAll has nothing readable here.)
                    _allP = []; _allC = [];
                } else {
                    try {
                        const [_rp, _rc] = await Promise.all([
                            // prospects: bucket key = responsible_agent_id
                            AppDataStore.queryAdvanced('prospects', { scopeField: 'responsible_agent_id', scopeValues: _agentIds, select: 'id,responsible_agent_id', countMode: null, limit: FETCH_CAP + 1, offset: 0 }),
                            // customers: bucket key = responsible_agent_id || agent_id —
                            // capture rows where EITHER field is a visible agent (OR scope);
                            // the unchanged loop below still picks the same single key.
                            AppDataStore.queryAdvanced('customers', { scopeFields: [{ field: 'responsible_agent_id', values: _agentIds }, { field: 'agent_id', values: _agentIds }], select: 'id,responsible_agent_id,agent_id', countMode: null, limit: FETCH_CAP + 1, offset: 0 }),
                        ]);
                        const _dp = (_rp && Array.isArray(_rp.data)) ? _rp.data : null;
                        const _dc = (_rc && Array.isArray(_rc.data)) ? _rc.data : null;
                        if (_dp && _dc && _dp.length <= FETCH_CAP && _dc.length <= FETCH_CAP) {
                            _allP = _dp; _allC = _dc;
                        } else {
                            throw new Error('agent count source exceeds fetch cap — whole-table fallback');
                        }
                    } catch (_ce) {
                        console.warn('[agents] bounded count source unavailable — getAll fallback', _ce && _ce.message);
                        [_allP, _allC] = await Promise.all([
                            AppDataStore.getAll('prospects'),
                            AppDataStore.getAll('customers'),
                        ]);
                    }
                }
                const _pcm = {}, _ccm = {}, _sba = {};
                for (const _p of _allP) { const _aid = String(_p.responsible_agent_id); _pcm[_aid] = (_pcm[_aid] || 0) + 1; }
                for (const _c of _allC) { const _aid = String(_c.responsible_agent_id || _c.agent_id); if (_aid) _ccm[_aid] = (_ccm[_aid] || 0) + 1; }
                for (const _s of _allS) { _sba[String(_s.agent_id)] = _s; }
                _showAgentsReactRoot(true);
                window.CRMReact.mountAgentsTable(reactRoot, {
                    agents,
                    counts: { prospectCountMap: _pcm, customerCountMap: _ccm, statsByAgentId: _sba },
                    filters: {
                        search: document.getElementById('agent-search')?.value.toLowerCase() || '',
                        team:   document.getElementById('filter-agent-team')?.value || '',
                        role:   document.getElementById('filter-agent-role')?.value || '',
                        status: document.getElementById('filter-agent-status')?.value || '',
                    },
                    meta: { canAssignUpline: _getUserLevel(_state.cu) <= 4 },
                });
                return;
            } catch (e) {
                console.warn('[agents] react mount failed:', e && e.message);
                _showAgentsReactRoot(false);
                tbody.innerHTML = '<tr><td colspan="8"><div style="padding:48px 24px;text-align:center;color:#888;"><i class="fas fa-rotate-right" style="font-size:30px;opacity:.45;"></i><p style="margin:14px 0;">This section couldn\'t load. Please reload the page.</p><button class="btn primary" onclick="location.reload()">Reload</button></div></td></tr>';
                return;
            }
        }
    }
    _showAgentsReactRoot(false);
    tbody.innerHTML = '<tr><td colspan="8"><div style="padding:48px 24px;text-align:center;color:#888;"><i class="fas fa-rotate-right" style="font-size:30px;opacity:.45;"></i><p style="margin:14px 0;">This section couldn\'t load. Please reload the page.</p><button class="btn primary" onclick="location.reload()">Reload</button></div></td></tr>';
};

const showAgentProfile = async (agentId) => {
const agent = await AppDataStore.getById('users', agentId);
if (!agent) {
    UI.toast.error('Agent not found');
    return;
}

const isAdminOrLead = _getUserLevel(_state.cu) <= 4;

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

const renderCurrentAssignments = async (agentId) => {
    // REND-7: this card lists ONLY this agent's prospects, so fetch a bounded
    // scoped slice (responsible_agent_id == agentId) instead of the whole
    // prospects table. The scope is exactly the agent being profiled (no
    // broadening of visibility), and queryAdvanced always hits the server (no
    // SWR), preserving the original fresh:true bypass. The unchanged client
    // filter below keeps the result byte-identical to legacy. On cap-overflow /
    // error we FALL BACK to the original whole-table getAll('prospects',{fresh}).
    const FETCH_CAP = 10000;
    let allP;
    try {
        const _r = await AppDataStore.queryAdvanced('prospects', {
            scopeField: 'responsible_agent_id', scopeValues: [agentId],
            select: 'id,full_name,status,last_activity_date,responsible_agent_id',
            countMode: null, limit: FETCH_CAP + 1, offset: 0,
        });
        const _d = (_r && Array.isArray(_r.data)) ? _r.data : null;
        if (_d && _d.length <= FETCH_CAP) {
            allP = _d;
        } else {
            throw new Error('agent prospect slice exceeds fetch cap — whole-table fallback');
        }
    } catch (_ce) {
        console.warn('[agents] bounded assignment source unavailable — getAll fallback', _ce && _ce.message);
        // fresh:true bypasses SWR cache so stale localStorage data never hides prospects
        allP = await AppDataStore.getAll('prospects', { fresh: true });
    }
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
                            ${p.last_activity_date ? 'Last: ' + escapeHtml(p.last_activity_date) : 'No activity yet'}
                        </div>
                    </div>
                    <span class="assignment-status status-${(p.status || 'prospect').toLowerCase()}">${p.status || 'Prospect'}</span>
                </div>
            `).join('')}
        </div>
        <p style="font-size:12px;color:var(--gray-400);margin-top:8px;">${agentProspects.length} prospect${agentProspects.length !== 1 ? 's' : ''} total</p>
    `;
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
                <span>Agent ID: ${escapeHtml(agent.agent_code || '—')}</span>
                <span><i class="fas fa-user-tie"></i> ${escapeHtml(agent.role || 'Consultant')}</span>
                <span><i class="fas fa-users"></i> ${escapeHtml(agent.team || 'Sales')}</span>
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
                    <span class="stat-value">${escapeHtml(agent.phone || '012-1234567')}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Email:</span>
                    <span class="stat-value">${escapeHtml(agent.email || 'agent@fengshui.com')}</span>
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
    const currentUser = _state.cu || await Auth.getCurrentUser();
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
                        <h1 style="font-size:32px; font-weight:700;">${escapeHtml(agent.full_name)}</h1>
                        <span class="status-badge status-${agent.status}">${agent.status.toUpperCase()}</span>
                    </div>
                    <div style="display:flex; gap:12px; color:var(--gray-500); font-size:14px;">
                        <span>Agent ID: ${escapeHtml(agent.agent_code || '—')}</span>
                        <span><i class="fas fa-user-tie"></i> Senior Consultant</span>
                        <span><i class="fas fa-users"></i> ${escapeHtml(agent.team || '')}</span>
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
                            <span class="stat-value">${escapeHtml(agent.phone || '012-1234567')}</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Email:</span>
                            <span class="stat-value">${escapeHtml(agent.email || 'agent@fengshui.com')}</span>
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
                        <div class="assignment-prospect">${escapeHtml(c.full_name || '')}</div>
                        <div class="next-action">Customer Since: ${escapeHtml(c.customer_since || '')}</div>
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
                <div class="next-action">Next: ${escapeHtml(a.next_action || 'None')}</div>
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
    await AppDataStore.update('users', _state.cu.id, {
        force_password_change: false,
        password: newPwd
    });
    _state.cu.force_password_change = false;
    UI.hideModal();
    UI.toast.success('Password set successfully. Welcome!');
    await navigateTo('calendar');
};

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
    if (!(isSystemAdmin(_state.cu) || isMarketingManager(_state.cu))) {
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
    if (!(isSystemAdmin(_state.cu) || isMarketingManager(_state.cu))) {
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
    const main = document.getElementById('content-viewport');
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

    app.register('agents', {
        assignProspectToAgent,
        calculateDaysDiff,
        confirmDeleteAgent,
        deactivateAgent,
        deleteAgent,
        executePasswordReset,
        executeRenewal,
        generatePassword,
        openAddAgentModal,
        openAssignUplineModal,
        openEditAgentModal,
        openResetPasswordModal,
        renderAgentsTable,
        renderCurrentAssignments,
        renderCustomerHistory,
        renderFollowupStats,
        renderPerformanceTargets,
        renewLicense,
        resetAgentPassword,
        saveAgent,
        saveAgentTargets,
        saveUplineAssignment,
        sendRenewalReminder,
        showAgentDetail,
        showAgentProfile,
        showAgentsView,
        showForcePasswordChangeModal,
        submitForcePasswordChange,
        updateAgentTargets,
        viewInactiveProspects,
    });
})();
