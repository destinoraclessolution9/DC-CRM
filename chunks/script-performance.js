/**
 * CRM Lazy Chunk: performance (Ranking + Workflow Automation + Noticeboard)
 * Role-gated: loaded on first navigation to 'performance', 'ranking', 'workflows', or 'noticeboard'.
 *
 * Self-contained IIFE. Accesses shared state through window.* globals only.
 * Loaded on-demand by navigateTo() role-gated chunk loader in script.js.
 * Attaches all public functions to window.app via Object.assign at the bottom.
 *
 * Extracted 2026-06-05 — covers showRankingPerformanceView, showWorkflowAutomationView,
 * and showNoticeboardView (lines 38141-39053 of original script.js).
 * ~913 lines removed from the main IIFE, reducing initial bundle parse by ~30 KB.
 */
(() => {
    // ── Live bindings to IIFE-private state ──────────────────────────────
    const _state = window._appState;
    const _utils = window._crmUtils;
    // Role helpers
    const isSystemAdmin        = (u) => _utils.isSystemAdmin(u || _state.cu);
    const isMarketingManager   = (u) => _utils.isMarketingManager(u || _state.cu);
    const isAgent              = (u) => _utils.isAgent(u || _state.cu);
    const isManagement         = (u) => _utils.isManagement(u || _state.cu);
    const isTeamLeaderOrAbove  = (u) => _utils.isTeamLeaderOrAbove(u || _state.cu);
    // Utility aliases
    const escapeHtml           = (...a) => _utils.escapeHtml(...a);
    const isMobile             = () => _utils.isMobile();
    const navigateTo           = (v)   => window.app.navigateTo(v);
    // AppDataStore, UI, supabase are global — no alias needed.
// ========== FEATURE: RANKING PERFORMANCE OVERVIEW ==========
// React-island flags (default-on; read-only views). Kill-switch → legacy:
// window.__REACT_<X>===false, ?react=0, or localStorage crm_react_off='1'.
const _reactRankingOn = () => {
    try {
        if (window.__REACT_RANKING === false) return false;
        if (/[?&]react=0/.test(location.search)) return false;
        if (localStorage.getItem('crm_react_off') === '1') return false;
        return !!(window.CRMReact && typeof window.CRMReact.mountRankingView === 'function');
    } catch (_) { return false; }
};
const _reactNoticeboardOn = () => {
    try {
        if (window.__REACT_NOTICEBOARD === false) return false;
        if (/[?&]react=0/.test(location.search)) return false;
        if (localStorage.getItem('crm_react_off') === '1') return false;
        return !!(window.CRMReact && typeof window.CRMReact.mountNoticeboardGrid === 'function');
    } catch (_) { return false; }
};

const showRankingPerformanceView = async (container) => {
    _state.cv = 'ranking';
    // ── Paint skeleton immediately ──────────────────────────────────────
    const _rSkelR = (cols) => `<tr>${Array.from({length:cols},(_,i)=>`<td style="padding:10px 12px;"><div class="skeleton" style="height:14px;border-radius:4px;width:${[30,70,45,40,35,50,45,40,35,35][i%10]}%;"></div></td>`).join('')}</tr>`;
    container.innerHTML = `
        <div class="ranking-view">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <div>
                    <h1>Ranking Performance Overview</h1>
                    <p style="color:var(--gray-500);">Calculating agent rankings…</p>
                </div>
                <div><button class="btn secondary" disabled><i class="fas fa-sync-alt"></i> Refresh</button></div>
            </div>
            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:16px; margin-bottom:24px;">
                ${Array(3).fill(0).map(() => `<div class="skeleton" style="border-radius:12px;height:160px;"></div>`).join('')}
            </div>
            <div class="profile-section">
                <div class="skeleton" style="height:24px;width:160px;border-radius:4px;margin-bottom:16px;"></div>
                <table class="data-table" style="width:100%;"><tbody>${Array(10).fill(0).map(()=>_rSkelR(10)).join('')}</tbody></table>
            </div>
        </div>`;
    // ── Fetch all four tables in parallel ───────────────────────────────
    // Pre-fetch all four tables in parallel ONCE, then bucket by agent_id
    // for O(1) per-agent lookups. Previously this loop did three serial
    // getAll() calls inside a per-agent for loop and re-filtered the entire
    // activities/purchases/prospects arrays for every agent — O(agents ×
    // records). With 100 agents and 5k activities that's 500k comparisons
    // inside the render path, and each await-in-loop forces a microtask
    // yield even when the cache is hot.
    const [users, allActivities, allPurchases, allProspects, allCustomers] = await Promise.all([
        AppDataStore.getAll('users'),
        AppDataStore.getAll('activities'),
        AppDataStore.getAll('purchases'),
        AppDataStore.getAll('prospects'),
        AppDataStore.getAll('customers'),
    ]);
    // Purchases have NO agent_id column — sales are attributed via the customer's
    // responsible_agent_id (same resolution the KPI reporting dashboard uses).
    // Without this map every purchase was skipped → leaderboard sales/closing/score
    // were all zero.
    const _custAgentMap = new Map((allCustomers || []).map(c => [String(c.id), c.responsible_agent_id]));
    const agents = users.filter(u => u.role && (u.role.includes('Level') || u.role === 'agent' || u.role === 'consultant'));
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const monthEnd = now.toISOString().split('T')[0];

    // Bucket activities for the current month by lead_agent_id
    const activitiesByAgent = new Map();
    for (const a of allActivities) {
        if (!a.lead_agent_id) continue;
        if (a.activity_date < monthStart || a.activity_date > monthEnd) continue;
        const k = String(a.lead_agent_id);
        let bucket = activitiesByAgent.get(k);
        if (!bucket) { bucket = []; activitiesByAgent.set(k, bucket); }
        bucket.push(a);
    }
    // Bucket purchases for the current month by agent_id
    const purchasesByAgent = new Map();
    for (const p of allPurchases) {
        // Resolve the owning agent: prefer an explicit agent_id if present, else
        // fall back to the purchase's customer's responsible_agent_id.
        const agentId = p.agent_id || (p.customer_id != null ? _custAgentMap.get(String(p.customer_id)) : null);
        if (!agentId) continue;
        if ((p.date || p.purchase_date) < monthStart || (p.date || p.purchase_date) > monthEnd) continue;
        const k = String(agentId);
        let bucket = purchasesByAgent.get(k);
        if (!bucket) { bucket = []; purchasesByAgent.set(k, bucket); }
        bucket.push(p);
    }
    // Bucket prospects by responsible_agent_id
    const prospectsByAgent = new Map();
    for (const p of allProspects) {
        if (!p.responsible_agent_id) continue;
        const k = String(p.responsible_agent_id);
        let bucket = prospectsByAgent.get(k);
        if (!bucket) { bucket = []; prospectsByAgent.set(k, bucket); }
        bucket.push(p);
    }

    // Gather agent stats — O(1) lookup per agent against the buckets above
    const agentStats = [];
    for (const agent of agents) {
        const aid = String(agent.id);
        const activities = activitiesByAgent.get(aid) || [];
        const purchases = purchasesByAgent.get(aid) || [];
        const prospects = prospectsByAgent.get(aid) || [];
        const cpsCount = activities.filter(a => a.activity_type === 'CPS').length;
        const totalSales = purchases.reduce((s, p) => s + (p.amount || 0), 0);
        const meetingCount = activities.filter(a => ['FTF', 'FSA', 'GR', 'SITE', 'XG'].includes(a.activity_type)).length;
        const followedUp = prospects.filter(p => {
            if (!p.last_contact_date) return false;
            const diff = (now - new Date(p.last_contact_date)) / (1000 * 60 * 60 * 24);
            return diff <= 7;
        }).length;
        const followupRate = prospects.length > 0 ? Math.round((followedUp / prospects.length) * 100) : 0;
        const closingRate = cpsCount > 0 ? Math.round((purchases.length / cpsCount) * 100) : 0;

        agentStats.push({
            id: agent.id,
            name: agent.full_name || 'Unknown',
            team: agent.team || '-',
            cps: cpsCount,
            sales: totalSales,
            meetings: meetingCount,
            prospects: prospects.length,
            followupRate,
            closingRate,
            // Overall performance score
            performanceScore: Math.round(cpsCount * 5 + totalSales / 1000 + meetingCount * 3 + followupRate * 0.5 + closingRate * 0.8)
        });
    }
    agentStats.sort((a, b) => b.performanceScore - a.performanceScore);

    // React island (default-on) renders the computed stats. Legacy markup below
    // is the fallback on any mount error.
    if (_reactRankingOn()) {
        try {
            const monthLabel = now.toLocaleString('default', { month: 'long', year: 'numeric' });
            container.innerHTML = '<div id="ranking-react-root"></div>';
            window.CRMReact.mountRankingView(document.getElementById('ranking-react-root'), { agentStats, monthLabel });
            return;
        } catch (e) {
            console.warn('[react-ranking] mount failed → legacy:', e?.message || e);
        }
    }

    const rankBadge = (i) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;

    container.innerHTML = `
        <div class="ranking-view">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <div>
                    <h1>Ranking Performance Overview</h1>
                    <p style="color:var(--gray-500);">Agent rankings for ${now.toLocaleString('default', { month: 'long', year: 'numeric' })}</p>
                </div>
                <div>
                    <button class="btn secondary" onclick="app.refreshCurrentView()"><i class="fas fa-sync-alt"></i> Refresh</button>
                </div>
            </div>

            <!-- Top 3 Cards -->
            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:16px; margin-bottom:24px;">
                ${agentStats.slice(0, 3).map((a, i) => `
                    <div style="background:var(--white); border-radius:12px; padding:20px; text-align:center; box-shadow:0 2px 8px rgba(0,0,0,0.06); border-top:4px solid ${i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : '#CD7F32'};">
                        <div style="font-size:32px; margin-bottom:8px;">${rankBadge(i)}</div>
                        <div style="font-size:16px; font-weight:600;">${a.name}</div>
                        <div style="color:var(--gray-500); font-size:12px; margin-bottom:12px;">${a.team}</div>
                        <div style="font-size:24px; font-weight:700; color:var(--primary);">${a.performanceScore} pts</div>
                        <div style="font-size:12px; color:var(--gray-500); margin-top:8px;">Sales: RM ${a.sales.toLocaleString()} · CPS: ${a.cps} · Rate: ${a.closingRate}%</div>
                    </div>
                `).join('')}
            </div>

            <!-- Full Rankings Table -->
            <div class="profile-section">
                <h2><i class="fas fa-list-ol"></i> Full Rankings</h2>
                <table class="data-table" style="width:100%;">
                    <thead>
                        <tr>
                            <th scope="col">Rank</th>
                            <th scope="col">Agent</th>
                            <th scope="col">Team</th>
                            <th scope="col" style="text-align:right;">Score</th>
                            <th scope="col" style="text-align:right;">CPS</th>
                            <th scope="col" style="text-align:right;">Sales (RM)</th>
                            <th scope="col" style="text-align:right;">Meetings</th>
                            <th scope="col" style="text-align:right;">Prospects</th>
                            <th scope="col" style="text-align:right;">Follow-up %</th>
                            <th scope="col" style="text-align:right;">Closing %</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${agentStats.map((a, i) => `
                            <tr style="${i < 3 ? 'background:var(--primary-50);' : ''}">
                                <td style="font-weight:600;">${rankBadge(i)}</td>
                                <td>${a.name}</td>
                                <td>${a.team}</td>
                                <td style="text-align:right; font-weight:600;">${a.performanceScore}</td>
                                <td style="text-align:right;">${a.cps}</td>
                                <td style="text-align:right;">${a.sales.toLocaleString()}</td>
                                <td style="text-align:right;">${a.meetings}</td>
                                <td style="text-align:right;">${a.prospects}</td>
                                <td style="text-align:right;"><span class="badge ${a.followupRate >= 80 ? 'success' : a.followupRate >= 50 ? 'warning' : 'danger'}">${a.followupRate}%</span></td>
                                <td style="text-align:right;"><span class="badge ${a.closingRate >= 30 ? 'success' : a.closingRate >= 15 ? 'warning' : 'danger'}">${a.closingRate}%</span></td>
                            </tr>
                        `).join('')}
                        ${agentStats.length === 0 ? '<tr><td colspan="10" style="text-align:center; padding:20px;">No agent data available</td></tr>' : ''}
                    </tbody>
                </table>
            </div>
        </div>
    `;
};

// ========== FEATURE: WORKFLOW AUTOMATION ENGINE ==========
const showWorkflowAutomationView = async (container) => {
    _state.cv = 'workflows';
    const workflows = await AppDataStore.getAll('automation_workflows');

    container.innerHTML = `
        <div class="workflow-view">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <div>
                    <h1>Workflow Automation Engine</h1>
                    <p style="color:var(--gray-500);">Create automated workflows with triggers and actions</p>
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="btn primary" onclick="app.openCreateWorkflowModal()"><i class="fas fa-plus"></i> Create Workflow</button>
                    <button class="btn secondary" onclick="app.refreshCurrentView()"><i class="fas fa-sync-alt"></i> Refresh</button>
                </div>
            </div>

            <!-- Active Workflows -->
            <div class="profile-section">
                <h2><i class="fas fa-bolt"></i> Active Workflows (${workflows.filter(w => w.status === 'active').length})</h2>
                <div id="workflows-list">
                    ${workflows.length > 0 ? workflows.map(w => renderWorkflowCard(w)).join('') : `
                        <div style="text-align:center; padding:40px; color:var(--gray-500);">
                            <i class="fas fa-cogs" style="font-size:48px; margin-bottom:12px; color:var(--gray-300);"></i>
                            <p>No workflows created yet</p>
                            <p style="font-size:12px;">Create your first workflow to automate tasks like sending birthday wishes, scoring updates, and follow-up reminders.</p>
                            <button class="btn primary" style="margin-top:12px;" onclick="app.openCreateWorkflowModal()"><i class="fas fa-plus"></i> Create First Workflow</button>
                        </div>
                    `}
                </div>
            </div>

            <!-- Workflow Templates -->
            <div class="profile-section" style="margin-top:20px;">
                <h2><i class="fas fa-clipboard-list"></i> Quick Templates</h2>
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(250px, 1fr)); gap:12px;">
                    ${renderWorkflowTemplate('Birthday Greeting', 'birthday', 'Send WhatsApp greeting on customer birthday', 'fas fa-birthday-cake')}
                    ${renderWorkflowTemplate('Protection Expiring', 'protection_expiring', 'Alert agent 7 days before protection expires', 'fas fa-shield-alt')}
                    ${renderWorkflowTemplate('Inactivity Alert', 'inactivity', 'Flag prospects with >7 days no follow-up', 'fas fa-exclamation-triangle')}
                    ${renderWorkflowTemplate('New Prospect Welcome', 'new_prospect', 'Send welcome message when prospect created', 'fas fa-user-plus')}
                    ${renderWorkflowTemplate('Event Follow-up', 'event_attendance', 'Create follow-up task after event attendance', 'fas fa-calendar-check')}
                    ${renderWorkflowTemplate('Score Threshold', 'score_change', 'Notify agent when prospect reaches 600+ score', 'fas fa-chart-line')}
                </div>
            </div>
        </div>
    `;
};

const renderWorkflowCard = (w) => {
    const statusColor = w.status === 'active' ? 'success' : w.status === 'paused' ? 'warning' : 'secondary';
    return `
        <div style="background:var(--white); border-radius:8px; padding:16px; margin-bottom:12px; border:1px solid var(--gray-200); display:flex; justify-content:space-between; align-items:center;">
            <div>
                <div style="font-weight:600; font-size:14px;">${w.workflow_name}</div>
                <div style="font-size:12px; color:var(--gray-500); margin-top:4px;">
                    Trigger: <strong>${w.trigger_type}</strong> → Action: <strong>${w.action_type || 'Multiple'}</strong>
                </div>
                <div style="font-size:11px; color:var(--gray-400); margin-top:2px;">Runs: ${w.run_count || 0} times · Last: ${w.last_run || 'Never'}</div>
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
                <span class="badge ${statusColor}">${w.status}</span>
                <button class="btn btn-sm secondary" onclick="app.toggleWorkflow(${w.id})">${w.status === 'active' ? 'Pause' : 'Activate'}</button>
                <button class="btn btn-sm secondary" onclick="app.editWorkflow(${w.id})"><i class="fas fa-edit"></i></button>
                <button class="btn btn-sm secondary" style="color:var(--danger);" onclick="app.deleteWorkflow(${w.id})"><i class="fas fa-trash"></i></button>
            </div>
        </div>
    `;
};

const renderWorkflowTemplate = (name, trigger, desc, icon) => `
    <div style="background:var(--gray-50); border-radius:8px; padding:16px; border:1px solid var(--gray-200); cursor:pointer;" onclick="app.createWorkflowFromTemplate('${trigger}')">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <i class="${icon}" style="color:var(--primary);"></i>
            <span style="font-weight:600; font-size:13px;">${name}</span>
        </div>
        <p style="font-size:12px; color:var(--gray-500); margin:0;">${desc}</p>
    </div>
`;

const WORKFLOW_TRIGGERS = {
    new_prospect: 'New Prospect Created',
    new_customer: 'Customer Converted',
    score_change: 'Score Threshold Reached',
    purchase: 'Transaction Completed',
    activity_completed: 'Activity Completed',
    birthday: 'Customer/Prospect Birthday',
    protection_expiring: 'Protection ≤7 Days Left',
    inactivity: 'No Contact >7 Days',
    event_attendance: 'Event Attended'
};

const WORKFLOW_ACTIONS = {
    send_whatsapp: 'Send WhatsApp Message',
    create_task: 'Create Follow-up Task',
    add_tag: 'Add Tag',
    remove_tag: 'Remove Tag',
    add_score: 'Add Score Points',
    extend_protection: 'Extend Protection Period',
    send_notification: 'Send In-App Notification',
    assign_agent: 'Reassign to Agent',
    create_activity: 'Schedule Activity',
    flag_reassignment: 'Flag for Reassignment'
};

const openCreateWorkflowModal = async (workflowId = null) => {
    const existing = workflowId ? await AppDataStore.getById('automation_workflows', workflowId) : null;

    const content = `
        <div style="max-height:70vh; overflow-y:auto;">
            <div class="form-group">
                <label>Workflow Name *</label>
                <input type="text" id="wf-name" class="form-control" value="${existing?.workflow_name || ''}" placeholder="e.g. Birthday Greeting Workflow">
            </div>
            <div class="form-group">
                <label>Trigger *</label>
                <select id="wf-trigger" class="form-control" onchange="app.updateWorkflowConditions()">
                    <option value="">Select Trigger...</option>
                    ${Object.entries(WORKFLOW_TRIGGERS).map(([k, v]) => `<option value="${k}" ${existing?.trigger_type === k ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
            </div>
            <div class="form-group" id="wf-conditions-container" style="display:${existing?.trigger_conditions ? 'block' : 'none'};">
                <label>Conditions (optional)</label>
                <div id="wf-conditions">
                    ${existing?.trigger_conditions ? `<input type="text" id="wf-condition-value" class="form-control" value="${existing.trigger_conditions.value || ''}" placeholder="e.g. score threshold: 600">` : ''}
                </div>
            </div>
            <hr style="margin:16px 0;">
            <div class="form-group">
                <label>Action *</label>
                <select id="wf-action" class="form-control">
                    <option value="">Select Action...</option>
                    ${Object.entries(WORKFLOW_ACTIONS).map(([k, v]) => `<option value="${k}" ${existing?.action_type === k ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>Action Configuration</label>
                <textarea id="wf-action-config" class="form-control" rows="3" placeholder="e.g. Message: Happy Birthday {{name}}! or Tag: VIP Customer">${existing?.action_config || ''}</textarea>
            </div>
            <div class="form-group">
                <label>Delay (days after trigger)</label>
                <input type="number" id="wf-delay" class="form-control" min="0" value="${existing?.delay_days || 0}">
            </div>
            <div class="form-group">
                <label>Status</label>
                <select id="wf-status" class="form-control">
                    <option value="active" ${(!existing || existing?.status === 'active') ? 'selected' : ''}>Active</option>
                    <option value="paused" ${existing?.status === 'paused' ? 'selected' : ''}>Paused</option>
                    <option value="draft" ${existing?.status === 'draft' ? 'selected' : ''}>Draft</option>
                </select>
            </div>
        </div>
    `;
    UI.showModal(workflowId ? 'Edit Workflow' : 'Create Workflow', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Save Workflow', type: 'primary', action: `(async () => { await app.saveWorkflow(${workflowId || 'null'}); })()` }
    ]);
};

const updateWorkflowConditions = () => {
    const trigger = document.getElementById('wf-trigger')?.value;
    const container = document.getElementById('wf-conditions-container');
    const conditions = document.getElementById('wf-conditions');
    if (!container || !conditions) return;

    if (trigger === 'score_change') {
        container.style.display = 'block';
        conditions.innerHTML = '<input type="number" id="wf-condition-value" class="form-control" placeholder="Score threshold (e.g. 600)">';
    } else if (trigger === 'inactivity') {
        container.style.display = 'block';
        conditions.innerHTML = '<input type="number" id="wf-condition-value" class="form-control" placeholder="Days inactive (e.g. 7)" value="7">';
    } else if (trigger === 'protection_expiring') {
        container.style.display = 'block';
        conditions.innerHTML = '<input type="number" id="wf-condition-value" class="form-control" placeholder="Days before expiry (e.g. 7)" value="7">';
    } else {
        container.style.display = 'none';
    }
};

const saveWorkflow = async (workflowId) => {
    const name = document.getElementById('wf-name')?.value?.trim();
    const trigger = document.getElementById('wf-trigger')?.value;
    const action = document.getElementById('wf-action')?.value;

    if (!name || !trigger || !action) {
        UI.toast.error('Workflow name, trigger, and action are required');
        return;
    }

    const data = {
        workflow_name: name,
        trigger_type: trigger,
        action_type: action,
        action_config: document.getElementById('wf-action-config')?.value || '',
        delay_days: parseInt(document.getElementById('wf-delay')?.value) || 0,
        status: document.getElementById('wf-status')?.value || 'active',
        trigger_conditions: {
            value: document.getElementById('wf-condition-value')?.value || ''
        },
        updated_at: new Date().toISOString()
    };

    try {
        if (workflowId) {
            await AppDataStore.update('automation_workflows', workflowId, data);
        } else {
            data.created_by = _state.cu?.id || 5;
            data.created_at = new Date().toISOString();
            data.run_count = 0;
            await AppDataStore.create('automation_workflows', data);
        }
        UI.hideModal();
        UI.toast.success(workflowId ? 'Workflow updated' : 'Workflow created');
        const _tabC = document.getElementById('marketing-tab-content');
        if (_tabC && app.renderAutomationTab) _tabC.innerHTML = await app.renderAutomationTab();
    } catch (e) { UI.toast.error('Save failed: ' + (e?.message || e)); }
};

const createWorkflowFromTemplate = async (triggerType) => {
    const templates = {
        birthday: { name: 'Birthday Greeting', action: 'send_whatsapp', config: 'Hi {{name}}, Happy Birthday! Wishing you a wonderful year ahead. — DestinOracles Team', delay: 0 },
        protection_expiring: { name: 'Protection Expiry Alert', action: 'send_notification', config: 'Protection period for {{prospect_name}} expires in {{days}} days. Take action now.', delay: 0 },
        inactivity: { name: 'Inactivity Follow-up Alert', action: 'flag_reassignment', config: 'Prospect {{name}} has been inactive for {{days}} days. Consider reassignment.', delay: 0 },
        new_prospect: { name: 'New Prospect Welcome', action: 'send_whatsapp', config: 'Hi {{name}}, thank you for your interest! Our consultant will reach out to you shortly.', delay: 0 },
        event_attendance: { name: 'Post-Event Follow-up', action: 'create_task', config: 'Follow up with {{name}} after attending {{event_name}}. Schedule a CPS within 3 days.', delay: 1 },
        score_change: { name: 'High Score Notification', action: 'send_notification', config: 'Prospect {{name}} has reached score {{score}}. Prioritize follow-up.', delay: 0 }
    };

    const tpl = templates[triggerType];
    if (!tpl) return;

    const data = {
        workflow_name: tpl.name,
        trigger_type: triggerType,
        action_type: tpl.action,
        action_config: tpl.config,
        delay_days: tpl.delay,
        status: 'active',
        trigger_conditions: {},
        created_by: _state.cu?.id || 5,
        created_at: new Date().toISOString(),
        run_count: 0
    };

    try {
        await AppDataStore.create('automation_workflows', data);
        UI.toast.success(`Workflow "${tpl.name}" created from template`);
        const _tabC2 = document.getElementById('marketing-tab-content');
        if (_tabC2 && app.renderAutomationTab) _tabC2.innerHTML = await app.renderAutomationTab();
    } catch (e) { UI.toast.error('Template create failed: ' + (e?.message || e)); }
};

const toggleWorkflow = async (workflowId) => {
    const wf = await AppDataStore.getById('automation_workflows', workflowId);
    if (!wf) return;
    const newStatus = wf.status === 'active' ? 'paused' : 'active';
    try {
        await AppDataStore.update('automation_workflows', workflowId, { status: newStatus });
        UI.toast.success(`Workflow ${newStatus === 'active' ? 'activated' : 'paused'}`);
        const _tabC3 = document.getElementById('marketing-tab-content');
        if (_tabC3 && app.renderAutomationTab) _tabC3.innerHTML = await app.renderAutomationTab();
    } catch (e) { UI.toast.error('Toggle failed: ' + (e?.message || e)); }
};

const editWorkflow = async (workflowId) => {
    await openCreateWorkflowModal(workflowId);
};

const deleteWorkflow = async (workflowId) => {
    UI.showModal('Delete Workflow', '<p>Are you sure you want to delete this workflow?</p>', [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Delete', type: 'primary', action: `(async () => { try { await AppDataStore.delete('automation_workflows', ${workflowId}); UI.hideModal(); UI.toast.success('Workflow deleted'); const tc = document.getElementById('marketing-tab-content'); if (tc && app.renderAutomationTab) tc.innerHTML = await app.renderAutomationTab(); } catch(e) { UI.toast.error('Delete failed: ' + (e?.message || e)); } })()` }
    ]);
};

// executeWorkflows and markMilestoneCompleted live in script.js (main IIFE)
// so they're available before this chunk loads. Access via window.app.* if needed.

// ---------- 增运九法 + 丁财贵寿四柱 definitions ----------
// 9 icons -> event category matchers (by event_categories.category_name OR
//   regex fallback on event_title/notes if the category isn't wired up yet).
// Icon 9 (传) is a referral-chain check, no category list.
const NINE_METHOD_DEFS = [
    { key: 'icon-1', icon: 'assets/milestone-icons/icon-1-beidou.png',
      categories: ['个人风水基础课', '个人改命分享会'],
      regex: /(个人风水基础|个人改命|personal.?fengshui|personal.?sharing)/i },
    { key: 'icon-2', icon: 'assets/milestone-icons/icon-2-house.png',
      categories: ['环境风水基础课', '风水改命分享会'],
      regex: /(环境风水|风水改命|fengshui.?diy|environment.?fengshui)/i },
    { key: 'icon-3', icon: 'assets/milestone-icons/icon-3-ancient.png',
      categories: ['博物馆'],
      regex: /(博物馆|museum)/i },
    { key: 'icon-4', icon: 'assets/milestone-icons/icon-4-hui.png',
      categories: ['汇聚-专案', '汇集-商业', '汇集-灵活', '汇集-简易'],
      regex: /(汇聚|汇集|hui.?ji)/i },
    { key: 'icon-5', icon: 'assets/milestone-icons/icon-5-fu.png',
      categories: ['福气分享会'],
      regex: /(福气分享|福气课|fu.?qi)/i },
    { key: 'icon-6', icon: 'assets/milestone-icons/icon-6-fire.png',
      categories: ['DC 招商会', 'DC招商会'],
      regex: /(dc.?招商|招商会)/i },
    { key: 'icon-7', icon: 'assets/milestone-icons/icon-7-wang.png',
      categories: ['Bujishu 分享会', 'Bujishu新品发布会', 'Bujishu 新品发布会'],
      regex: /(bujishu|bu.?ji.?shu)/i },
    { key: 'icon-8', icon: 'assets/milestone-icons/icon-8-bagua.png',
      categories: ['画作分享会', '艺品分享会'],
      regex: /(画作|艺品|calligraphy.?sharing|painting.?sharing)/i },
    { key: 'icon-9', icon: 'assets/milestone-icons/icon-9-chuan.png',
      isReferral: true },
];

// 4 pillar icons -> product category matchers (by products.category OR
//   regex fallback on purchases.item)
const FOUR_PILLAR_DEFS = [
    { key: 'pillar-1', icon: 'assets/milestone-icons/pillar-1-stars.png',
      label: '九星助命', source: 'products', categories: ['Power Ring'],
      regex: /power.?ring|pr[0-9]/i },
    { key: 'pillar-2', icon: 'assets/milestone-icons/pillar-2-identify.png',
      label: '寻旺用旺', source: 'products', categories: ['风水方案'],
      regex: /风水方案|fengshui.?solution|fengshui.?audit/i },
    { key: 'pillar-3', icon: 'assets/milestone-icons/pillar-3-guide.png',
      label: '泰山北斗', source: 'bujishu', categories: ['满堂系列', '旺床'],
      regex: /满堂系列|旺床|bujishu.?set|mattress/i },
    { key: 'pillar-4', icon: 'assets/milestone-icons/pillar-4-qi.png',
      label: '以卦聚气', source: 'products', categories: ['画作'],
      regex: /画作|calligraphy|painting/i },
];

// Compute 9-icon attendance statuses for a given subject (user / prospect / customer).
// Admin overrides in user_milestones (name='icon-1'..'icon-9', with completed boolean) win.
const computeNineMethodStatuses = async (subject) => {
    const result = {};
    // Admin overrides
    let overrides = {};
    try {
        const rows = await AppDataStore.query('user_milestones', { user_id: subject.user_id });
        rows.forEach(r => { overrides[r.milestone_name] = r.completed; });
    } catch(e) {}

    // Preload data for auto-detect
    let categories = [], events = [], regs = [], activities = [], referrals = [];
    try { categories = await AppDataStore.getAll('event_categories'); } catch(e) {}
    try { events     = await AppDataStore.getAll('events'); } catch(e) {}
    try { regs       = await AppDataStore.getAll('event_registrations'); } catch(e) {}
    try { activities = await AppDataStore.getAll('activities'); } catch(e) {}
    try { referrals  = await AppDataStore.getAll('referrals'); } catch(e) {}

    const catByName = new Map(categories.map(c => [String(c.category_name || '').trim(), c.id]));
    const eventById = new Map(events.map(e => [String(e.id), e]));

    // Helper: has the subject attended any event in the given category list?
    const subjectAttendedCategory = (def) => {
        const wantedCatIds = new Set(
            (def.categories || [])
                .map(name => catByName.get(name))
                .filter(id => id != null)
                .map(String)
        );

        // 1) Proper event_registrations route
        const attendedRegs = regs.filter(r =>
            String(r.attendance_status || '').toLowerCase() === 'attended' &&
            (
                (subject.prospect_id && String(r.attendee_id) === String(subject.prospect_id)) ||
                (subject.customer_id && String(r.attendee_id) === String(subject.customer_id))
            )
        );
        for (const r of attendedRegs) {
            const ev = eventById.get(String(r.event_id));
            if (!ev) continue;
            const evCatId = String(ev.event_category_id || '');
            if (wantedCatIds.has(evCatId)) return true;
        }

        // 2) Fallback: scan activities by event title / notes regex
        if (def.regex) {
            const mine = activities.filter(a =>
                (subject.prospect_id && String(a.prospect_id) === String(subject.prospect_id)) ||
                (subject.customer_id && String(a.customer_id) === String(subject.customer_id))
            );
            if (mine.some(a => def.regex.test((a.event_title || '') + ' ' + (a.notes || '') + ' ' + (a.activity_type || '')))) {
                return true;
            }
        }
        return false;
    };

    // Icon 9: did subject refer a NEW prospect who has completed CPS?
    const referralLeadToCPS = () => {
        if (!subject.prospect_id && !subject.customer_id) return false;
        const myRefs = referrals.filter(r =>
            (subject.prospect_id && String(r.referrer_id) === String(subject.prospect_id)) ||
            (subject.customer_id && String(r.referrer_id) === String(subject.customer_id))
        );
        if (myRefs.length === 0) return false;
        // For each referred prospect, check if they've done CPS (activity_type='CPS' OR event-regex CPS)
        for (const r of myRefs) {
            const refId = r.referred_prospect_id;
            if (!refId) continue;
            const refActs = activities.filter(a => String(a.prospect_id) === String(refId));
            if (refActs.some(a => a.activity_type === 'CPS' || /\bcps\b/i.test((a.event_title || '') + ' ' + (a.notes || '')))) {
                return true;
            }
        }
        return false;
    };

    for (const def of NINE_METHOD_DEFS) {
        if (overrides[def.key] === true)  { result[def.key] = true;  continue; }
        if (overrides[def.key] === false) { result[def.key] = false; continue; }
        result[def.key] = def.isReferral ? referralLeadToCPS() : subjectAttendedCategory(def);
    }
    return result;
};

// Compute 4-pillar purchase statuses for the subject's customer_id.
const computeFourPillarStatuses = async (subject) => {
    const result = {};
    let overrides = {};
    try {
        const rows = await AppDataStore.query('user_milestones', { user_id: subject.user_id });
        rows.forEach(r => { overrides[r.milestone_name] = r.completed; });
    } catch(e) {}

    let purchases = [], products = [], bujishuList = [];
    if (subject.customer_id) {
        try { purchases = await AppDataStore.query('purchases', { customer_id: subject.customer_id }); } catch(e) {}
    }
    try { products = await AppDataStore.getAll('products'); } catch(e) {}
    try { bujishuList = await AppDataStore.getAll('bujishu'); } catch(e) {}

    const nameMatches = (source, def, item) => {
        const pool = source === 'bujishu' ? bujishuList : products;
        const matches = pool.filter(p =>
            def.categories.some(cat =>
                String(p.category || '').trim().includes(cat) ||
                String(cat).includes(String(p.category || '').trim())
            )
        );
        if (matches.length === 0) return false;
        const itemStr = String(item || '').toLowerCase();
        return matches.some(p => itemStr.includes(String(p.name || '').toLowerCase()));
    };

    for (const def of FOUR_PILLAR_DEFS) {
        if (overrides[def.key] === true)  { result[def.key] = true;  continue; }
        if (overrides[def.key] === false) { result[def.key] = false; continue; }
        let owned = false;
        for (const pur of purchases) {
            if (nameMatches(def.source, def, pur.item)) { owned = true; break; }
            // Fallback regex on the item text
            if (def.regex && def.regex.test(String(pur.item || ''))) { owned = true; break; }
        }
        result[def.key] = owned;
    }
    return result;
};

// ==================== NOTICEBOARD (公告栏) — L12/13/14 event feed ====================
// Read-only one-glance feed of upcoming events for 传福大使 / 改命客户 / 准传福大使.
// Cards expose ALL info inline (no click-to-expand) — admin keeps descriptions
// concise so cards stay scannable. Past events auto-expire (filtered out once
// event_date < today). Sourced from the `events` table; admins publish via the
// Calendar event modal (poster_url + published_to_noticeboard checkbox) or
// from the Quick Add Activity → Event flow.
const showNoticeboardView = async (container) => {
    const currentUser = _state.cu;
    if (!currentUser) return;

    const userLevel = _utils.getUserLevel(currentUser);
    const isAdmin = userLevel <= 2;

    // Inline <style> so the noticeboard is self-contained (independent of
    // styles-fixed.css load order) and so card hover/responsive rules work
    // without polluting the global stylesheet.
    const styleBlock = `
    <style id="noticeboard-styles">
        .nb-page { background: linear-gradient(180deg, #fdf6ec 0%, #fdf2f8 100%); min-height: 100vh; padding: 0 0 64px; }
        .nb-topbar { display: flex; align-items: center; justify-content: space-between; padding: 18px 28px; border-bottom: 1px solid rgba(128,0,32,0.12); background: rgba(255,255,255,0.6); backdrop-filter: blur(8px); flex-wrap: wrap; gap: 12px; }
        .nb-topbar-brand { font-size: 1.15rem; font-weight: 700; color: #800020; display: flex; align-items: center; gap: 8px; letter-spacing: 0.02em; }
        .nb-topbar-tagline { color: #9b1c4f; font-size: 0.95rem; font-style: italic; letter-spacing: 0.05em; }
        .nb-hero { text-align: center; padding: 48px 20px 32px; max-width: 900px; margin: 0 auto; }
        .nb-hero-title { font-size: 2.2rem; font-weight: 800; color: #800020; margin: 0 0 12px; letter-spacing: 0.05em; position: relative; display: inline-block; padding: 0 28px; }
        .nb-hero-title::before, .nb-hero-title::after { content: ""; position: absolute; top: 50%; width: 32px; height: 1px; background: #be185d; }
        .nb-hero-title::before { left: -16px; } .nb-hero-title::after { right: -16px; }
        .nb-hero-sub { color: #6b7280; font-size: 0.95rem; letter-spacing: 0.08em; }
        .nb-grid { display: grid; gap: 26px; grid-template-columns: repeat(3, 1fr); max-width: 1200px; margin: 0 auto; padding: 0 28px; }
        @media (max-width: 1024px) { .nb-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 640px)  { .nb-grid { grid-template-columns: 1fr; gap: 20px; padding: 0 16px; } .nb-hero-title { font-size: 1.6rem; } }
        .nb-card { background: white; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 16px rgba(128,0,32,0.10); display: flex; flex-direction: column; position: relative; transition: transform .18s ease, box-shadow .18s ease; }
        .nb-card:hover { transform: translateY(-3px); box-shadow: 0 10px 28px rgba(128,0,32,0.16); }
        .nb-num { position: absolute; top: 14px; left: 14px; z-index: 2; width: 38px; height: 38px; border-radius: 50%; background: #800020; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.95rem; letter-spacing: 0.05em; box-shadow: 0 2px 8px rgba(0,0,0,0.2); font-family: 'Inter', sans-serif; }
        .nb-poster { width: 100%; aspect-ratio: 3 / 4; object-fit: cover; display: block; background: linear-gradient(135deg, #800020, #be185d); }
        .nb-poster-placeholder { width: 100%; aspect-ratio: 3 / 4; background: linear-gradient(135deg, #800020, #be185d); color: white; display: flex; align-items: center; justify-content: center; font-size: 4rem; }
        .nb-body { padding: 18px 18px 20px; display: flex; flex-direction: column; gap: 10px; flex: 1; }
        .nb-title { font-size: 1.2rem; font-weight: 800; color: #1f2937; line-height: 1.25; margin: 0; }
        .nb-tagline { font-size: 0.88rem; color: #9b1c4f; font-style: italic; line-height: 1.3; min-height: 1.3em; }
        .nb-info { background: #fdf2f8; border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; border: 1px solid #fce7f3; }
        .nb-info-row { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: #4b5563; }
        .nb-info-row i { color: #be185d; width: 14px; text-align: center; }
        .nb-desc { color: #6b7280; font-size: 0.86rem; line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
        .nb-price-badge { display: inline-block; padding: 3px 10px; background: #800020; color: white; border-radius: 12px; font-size: 0.78rem; font-weight: 600; align-self: flex-start; }
        .nb-empty { grid-column: 1 / -1; text-align: center; padding: 80px 20px; color: #6b7280; }
        .nb-empty-emoji { font-size: 4rem; margin-bottom: 16px; opacity: 0.6; }
        .nb-footer { margin: 56px auto 0; padding: 22px 28px; max-width: 1200px; border-top: 1px solid rgba(128,0,32,0.12); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; color: #800020; font-size: 0.85rem; }
        .nb-footer-brand { display: flex; align-items: center; gap: 10px; font-weight: 700; }
        .nb-footer-brand-icon { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, #800020, #be185d); color: white; display: flex; align-items: center; justify-content: center; font-size: 1rem; }
        .nb-footer-meta { color: #9b1c4f; font-size: 0.8rem; letter-spacing: 0.03em; }
        .nb-admin-bar { max-width: 1200px; margin: 0 auto 18px; padding: 0 28px; display: flex; justify-content: flex-end; }
    </style>`;

    // Skeleton paint
    container.innerHTML = `
        ${styleBlock}
        <div class="nb-page">
            <div class="nb-topbar">
                <div class="nb-topbar-brand">📢 公告栏 · Noticeboard</div>
                <div class="nb-topbar-tagline">探索过去 · 启迪未来</div>
            </div>
            <div class="nb-hero">
                <h1 class="nb-hero-title">即将举行的活动</h1>
                <div class="nb-hero-sub">探索风水智慧与人文之美</div>
            </div>
            ${isAdmin ? `<div class="nb-admin-bar"><button class="btn primary" onclick="(async()=>{ if(app.openCreateEventModal) await app.openCreateEventModal(); })()"><i class="fas fa-plus"></i> Post Event</button></div>` : ''}
            <div id="noticeboard-grid" class="nb-grid">
                <div class="nb-empty"><div style="opacity:0.5;">Loading events…</div></div>
            </div>
            <div class="nb-footer">
                <div class="nb-footer-brand">
                    <div class="nb-footer-brand-icon">🏛️</div>
                    <div>DestinOraclesSolution · 玄空风水博物馆</div>
                </div>
                <div class="nb-footer-meta">destinoraclessolution.com</div>
            </div>
        </div>`;

    // Fetch events
    let events = [];
    try {
        events = await AppDataStore.getAll('events');
    } catch(err) {
        console.warn('[noticeboard] events fetch failed:', err);
    }
    events = events || [];

    // Filter: must have a valid future event_date AND not be explicitly
    // hidden from the noticeboard. Defaults are inclusive — a freshly-
    // created event shows up unless the admin specifically unticks the
    // "Publish to Noticeboard" checkbox. This avoids the previous footgun
    // where admins forgot to tick the publish box and the event silently
    // never appeared.
    //   - Missing event_date → skipped (otherwise "Invalid Date" cards)
    //   - event_date < today → skipped (auto-expire past events)
    //   - status === 'cancelled' → skipped
    //   - published_to_noticeboard === false → skipped (explicit hide)
    //   - everything else → shown
    // The Postgres `events` table uses column `date` (NOT `event_date`) —
    // older JS code wrote to `event_date` which the data layer stripped.
    // Read `date` first, fall back to `event_date` for legacy in-memory rows.
    const dateOf = (e) => e?.date || e?.event_date || null;
    const todayStr = new Date().toISOString().split('T')[0];
    let visible = events.filter(e => {
        if (!e) return false;
        const d = dateOf(e);
        if (!d) return false;
        const parsed = new Date(d);
        if (isNaN(parsed.getTime())) return false;
        if (d < todayStr) return false; // expired
        if ((e.status || 'upcoming') === 'cancelled') return false;
        if (e.published_to_noticeboard === false) return false; // explicit hide
        return true;
    });
    visible.sort((a, b) => String(dateOf(a) || '').localeCompare(String(dateOf(b) || '')));

    const grid = document.getElementById('noticeboard-grid');
    if (!grid) return;

    if (!visible.length) {
        grid.innerHTML = `
            <div class="nb-empty">
                <div class="nb-empty-emoji">📭</div>
                <div style="font-size:1.15rem;font-weight:700;color:#800020;margin-bottom:6px;">暂无活动 · No upcoming events</div>
                <div style="font-size:0.9rem;">${isAdmin ? 'Tap "Post Event" above to publish the first one.' : 'Check back soon — new events will appear here.'}</div>
            </div>`;
        return;
    }

    // Pre-sign poster images (best-effort)
    const postered = visible.filter(e => e.poster_url);
    if (postered.length && AppDataStore.resolveAttachmentSrc) {
        await Promise.all(postered.map(async e => {
            try { e._posterSigned = await AppDataStore.resolveAttachmentSrc(e.poster_url); }
            catch(_) { e._posterSigned = e.poster_url; }
        }));
    } else {
        postered.forEach(e => { e._posterSigned = e.poster_url; });
    }

    const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const titleOf = (e) => e.event_title || e.title || 'Untitled Event';
    const fmtDate = (d) => {
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return '日期待定 · Date TBD';
        // 2026年6月15日 (星期六) style — closer to the reference design
        try {
            const opts = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' };
            return dt.toLocaleDateString('zh-CN', opts);
        } catch(_) { return dt.toLocaleDateString(); }
    };
    const fmtTime = (s, e) => {
        if (!s && !e) return '';
        const fmt = (t) => {
            if (!t) return '';
            // Accept "14:30" or "14:30:00" → "2:30 PM"
            const [h, m] = String(t).split(':');
            const hr = parseInt(h, 10);
            if (isNaN(hr)) return t;
            const ampm = hr >= 12 ? 'PM' : 'AM';
            const h12 = hr % 12 || 12;
            return `${h12}:${(m || '00').padStart(2, '0')} ${ampm}`;
        };
        if (s && e) return `${fmt(s)} – ${fmt(e)}`;
        return fmt(s || e);
    };

    // React island (default-on) renders the cards from the prepared (filtered,
    // sorted, poster-signed) `visible` events. Legacy template below is the fallback.
    if (_reactNoticeboardOn()) {
        try {
            window.CRMReact.mountNoticeboardGrid(grid, { events: visible, isAdmin });
            return;
        } catch (e) {
            console.warn('[react-noticeboard] mount failed → legacy:', e?.message || e);
        }
    }

    grid.innerHTML = visible.map((e, idx) => {
        const num = String(idx + 1).padStart(2, '0');
        const posterHtml = e._posterSigned
            ? `<img class="nb-poster" loading="lazy" decoding="async" src="${esc(e._posterSigned)}" alt="${esc(titleOf(e))}" onerror="this.outerHTML='<div class=&quot;nb-poster-placeholder&quot;>📅</div>';">`
            : `<div class="nb-poster-placeholder">📅</div>`;
        const time = fmtTime(e.start_time, e.end_time);
        const tagline = e.speaker ? `主讲 · ${e.speaker}` : (e.target_group || '');
        const priceBadge = e.ticket_price && parseFloat(e.ticket_price) > 0
            ? `<div class="nb-price-badge">RM ${parseFloat(e.ticket_price).toFixed(0)}${e.early_bird_price ? ` · 早鸟 RM ${esc(e.early_bird_price)}` : ''}</div>`
            : (e.ticket_price === 0 || e.ticket_price === '0' ? `<div class="nb-price-badge" style="background:#10b981;">免费 · Free</div>` : '');
        return `
            <article class="nb-card">
                <div class="nb-num">${num}</div>
                ${posterHtml}
                <div class="nb-body">
                    <h3 class="nb-title">${esc(titleOf(e))}</h3>
                    ${tagline ? `<div class="nb-tagline">${esc(tagline)}</div>` : ''}
                    <div class="nb-info">
                        <div class="nb-info-row"><i class="fas fa-calendar"></i> ${esc(fmtDate(dateOf(e)))}</div>
                        ${time ? `<div class="nb-info-row"><i class="fas fa-clock"></i> ${esc(time)}</div>` : ''}
                        ${e.location ? `<div class="nb-info-row"><i class="fas fa-map-marker-alt"></i> ${esc(e.location)}</div>` : ''}
                    </div>
                    ${e.description ? `<div class="nb-desc">${esc(e.description)}</div>` : ''}
                    ${priceBadge}
                </div>
            </article>`;
    }).join('');
};

// Full event detail modal opened from a noticeboard card tap.
const openNoticeboardDetail = async (eventId) => {
    const e = await AppDataStore.getById('events', eventId);
    if (!e) { UI.toast.error('Event not found'); return; }

    let posterSrc = '';
    if (e.poster_url) {
        try { posterSrc = AppDataStore.resolveAttachmentSrc ? await AppDataStore.resolveAttachmentSrc(e.poster_url) : e.poster_url; }
        catch(_) { posterSrc = e.poster_url; }
    }

    const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const fmtDate = (d) => { try { return new Date(d).toLocaleDateString('en-MY', { weekday:'long', day:'numeric', month:'long', year:'numeric' }); } catch(_) { return d || ''; } };
    const time = (e.start_time && e.end_time) ? `${e.start_time} – ${e.end_time}` : (e.start_time || e.end_time || '');
    const evTitle = e.title || e.event_title || 'Event Details';
    const evDate  = e.date  || e.event_date  || null;

    const content = `
        <div style="max-width:560px;">
            ${posterSrc
                ? `<img loading="lazy" decoding="async" src="${esc(posterSrc)}" alt="${esc(evTitle)}" style="width:100%;max-height:360px;object-fit:contain;background:#f3f4f6;border-radius:8px;margin-bottom:16px;">`
                : `<div style="width:100%;height:200px;background:linear-gradient(135deg,#be185d,#e91e8c);color:white;display:flex;align-items:center;justify-content:center;font-size:4rem;border-radius:8px;margin-bottom:16px;">📅</div>`
            }
            <div style="display:grid;gap:10px;color:var(--gray-700,#374151);font-size:0.95rem;">
                <div><i class="fas fa-calendar" style="color:#be185d;width:20px;"></i> <strong>${esc(fmtDate(evDate))}</strong></div>
                ${time ? `<div><i class="fas fa-clock" style="color:#be185d;width:20px;"></i> ${esc(time)}</div>` : ''}
                ${e.location ? `<div><i class="fas fa-map-marker-alt" style="color:#be185d;width:20px;"></i> ${esc(e.location)}</div>` : ''}
                ${e.capacity ? `<div><i class="fas fa-users" style="color:#be185d;width:20px;"></i> Capacity: ${esc(e.capacity)}</div>` : ''}
                ${e.ticket_price ? `<div><i class="fas fa-tag" style="color:#be185d;width:20px;"></i> RM ${esc(e.ticket_price)}</div>` : ''}
            </div>
            ${e.description ? `<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--gray-200,#e5e7eb);color:var(--gray-700,#374151);font-size:0.95rem;line-height:1.6;white-space:pre-wrap;">${esc(e.description)}</div>` : ''}
        </div>`;

    UI.showModal(evTitle, content, [
        { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
    ]);
};
    // ── Attach public functions to window.app ────────────────────────────
    Object.assign(window.app, {
        // Ranking Performance
        showRankingPerformanceView,
        // Workflow Automation
        showWorkflowAutomationView,
        openCreateWorkflowModal,
        updateWorkflowConditions,
        saveWorkflow,
        createWorkflowFromTemplate,
        toggleWorkflow,
        editWorkflow,
        deleteWorkflow,
        // Exported so script-marketing.js renderAutomationTab can render workflow cards
        renderWorkflowCard,
        // Noticeboard
        showNoticeboardView,
        openNoticeboardDetail,
        // Shared computation helpers (used by script-features2.js for milestones view)
        computeNineMethodStatuses,
        computeFourPillarStatuses,
        // Definition arrays (used by features2.js showMilestonesView for rendering)
        NINE_METHOD_DEFS,
        FOUR_PILLAR_DEFS,
    });
})();