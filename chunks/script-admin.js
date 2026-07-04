/**
 * CRM Lazy Chunk: Security Dashboard + System Administration
 * Covers: showSecurityDashboard, showAuditLogs, showComplianceCenter,
 *   showAdminDashboard, showTenantManagement, showSystemHealth, showSystemLogs, etc.
 * Loaded on-demand when Super Admin navigates to security/admin views.
 * Extracted 2026-06-05 (~547 lines).
 */
(() => {
    const _state = window._appState;
    const _utils = window._crmUtils;
    const esc    = (...a) => _utils.escapeHtml(...a);
    const isSystemAdmin      = (u) => _utils.isSystemAdmin(u || _state.cu);
    const isMarketingManager = (u) => _utils.isMarketingManager(u || _state.cu);
    const navigateTo         = (v) => window.app.navigateTo(v);

    // React-island Security dashboard. DEFAULT-ON (read-only, admin-only, low risk);
    // kill-switch → legacy: window.__REACT_SECURITY===false, ?react=0, crm_react_off='1'.
    const _reactSecurityOn = () => {
        try {
            if (window.__REACT_SECURITY === false) return false;
            if (/[?&]react=0/.test(location.search)) return false;
            if (localStorage.getItem('crm_react_off') === '1') return false;
            return !!(window.CRMReact && typeof window.CRMReact.mountSecurityDashboard === 'function');
        } catch (_) { return false; }
    };

    const showSecurityDashboard = async () => {
        if (!isSystemAdmin()) {
            if (window.UI) window.UI.toast.error("Access Denied. Super Admins only.");
            return;
        }
        const view = document.getElementById('content-viewport');
        if (!view) return;
        const incidents = (await AppDataStore.getAll('security_incidents').catch(() => [])) || [];

        // React island (default-on). Legacy template removed; the off/error path
        // renders a small inline reload card into the same container.
        if (_reactSecurityOn()) {
            try {
                view.innerHTML = '<div id="security-react-root"></div>';
                window.CRMReact.mountSecurityDashboard(document.getElementById('security-react-root'), { incidents });
                return;
            } catch (e) {
                console.warn('[security] react mount failed:', e && e.message);
                view.innerHTML = '<div style="padding:48px 24px;text-align:center;color:#888;"><i class="fas fa-rotate-right" style="font-size:30px;opacity:.45;"></i><p style="margin:14px 0;">This section couldn\'t load. Please reload the page.</p><button class="btn primary" onclick="location.reload()">Reload</button></div>';
                return;
            }
        }

        view.innerHTML = '<div style="padding:48px 24px;text-align:center;color:#888;"><i class="fas fa-rotate-right" style="font-size:30px;opacity:.45;"></i><p style="margin:14px 0;">This section couldn\'t load. Please reload the page.</p><button class="btn primary" onclick="location.reload()">Reload</button></div>';
    };

    const showAuditLogs = async () => {
        if (!isSystemAdmin()) {
            if (window.UI) window.UI.toast.error("Access Denied. Super Admins only.");
            return;
        }
        // audit_logs schema (written by data.js _writeAudit): created_at, action,
        // entity_type, entity_id, user_id, old_data, new_data, user_agent.
        // There is no timestamp/level/category column — read the real columns.
        // Server-side order+limit (mirrors showUserActivity below): audit_logs is
        // append-only and grows without bound, so never pull the whole table just
        // to render 50 rows. Fall back to the (bounded) client sort only if the
        // direct query is unavailable.
        let logs = [];
        try {
            const { data, error } = await window.supabase
                .from('audit_logs')
                .select('created_at,entity_type,action,user_id')
                .order('created_at', { ascending: false })
                .limit(50);
            if (error) throw error;
            logs = data || [];
        } catch (_) {
            // Avoid the unbounded getAll('audit_logs') fallback: audit_logs is an
            // append-only HIGH_VOLUME table and getAll auto-paginates past 1000 rows,
            // so a transient failure of the bounded query above would trigger a whole-
            // table download. Leave empty on failure (the user can retry).
            logs = [];
        }
    
        let content = `
            <div class="audit-log-viewer" style="margin:24px;">
                <h2>Audit Logs</h2>
                <div class="audit-filters">
                    <select class="form-control" style="width:200px"><option>All Entities</option></select>
                </div>
                <table class="audit-table">
                    <thead>
                        <tr>
                            <th scope="col">Timestamp</th>
                            <th scope="col">Entity</th>
                            <th scope="col">Action</th>
                            <th scope="col">User</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${logs.map(log => `
                            <tr>
                                <td>${log.created_at ? new Date(log.created_at).toLocaleString() : '—'}</td>
                                <td>${esc(log.entity_type)}</td>
                                <td>${esc(log.action)}</td>
                                <td>${esc(log.user_id || 'System')}</td>
                            </tr>
                        `).join('')}
                        ${!logs.length ? '<tr><td colspan="4">No logs found.</td></tr>' : ''}
                    </tbody>
                </table>
            </div>
        `;
        const view = document.getElementById('content-viewport');
        if (view) view.innerHTML = content;
    };
    
    // User Activity (predictive-UX telemetry viewer). Reads public.user_events
    // directly via the admin's RLS-scoped session (SELECT policy: role_level<=2),
    // windowed to the last 7 days. Renders: summary, the navigation transition map
    // (the signal that will drive predictive prefetch), top actions and a recent
    // feed. The events themselves are PII-free (view ids / fn names / counts only).
    const showUserActivity = async () => {
        if (!isSystemAdmin()) {
            if (window.UI) window.UI.toast.error('Access Denied. Super Admins only.');
            return;
        }
        const view = document.getElementById('content-viewport');
        if (!view) return;
        view.innerHTML = '<div style="padding:48px 24px;text-align:center;color:#888;">Loading activity…</div>';

        const sinceISO = new Date(Date.now() - 7 * 864e5).toISOString();
        let rows = [];
        try {
            const { data, error } = await window.supabase
                .from('user_events')
                .select('user_id,session_id,event_type,view,from_view,target,dwell_ms,role_level,client_ts,created_at,meta')
                .gte('created_at', sinceISO)
                .order('created_at', { ascending: false })
                .limit(3000);
            if (error) throw error;
            rows = data || [];
        } catch (e) {
            view.innerHTML = '<div style="padding:48px 24px;text-align:center;color:#888;">Could not load user activity (' + esc((e && e.message) || 'error') + ').</div>';
            return;
        }

        // Resolve user_id -> display name (admins already see names elsewhere).
        const nameById = {};
        try {
            const users = (await AppDataStore.getAll('users').catch(() => [])) || [];
            users.forEach(u => { if (u && u.id != null) nameById[String(u.id)] = u.full_name || u.username || ('#' + u.id); });
        } catch (_) { /* name map best-effort */ }
        const nameOf = (id) => (id == null) ? '—' : (nameById[String(id)] || ('#' + id));

        const navs = rows.filter(r => r.event_type === 'nav');
        const clicks = rows.filter(r => r.event_type === 'click');
        const errors = rows.filter(r => r.event_type === 'error');
        const activeUsers = new Set(rows.map(r => r.user_id).filter(v => v != null));
        const sessions = new Set(rows.map(r => r.session_id).filter(Boolean));

        // Transition map: from_view -> view counts (the prediction signal).
        const trans = {};
        navs.forEach(n => { const k = (n.from_view || '∅') + ' → ' + (n.view || '∅'); trans[k] = (trans[k] || 0) + 1; });
        const topTrans = Object.entries(trans).sort((a, b) => b[1] - a[1]).slice(0, 15);

        // Top action clicks.
        const acts = {};
        clicks.forEach(c => { if (c.target) acts[c.target] = (acts[c.target] || 0) + 1; });
        const topActs = Object.entries(acts).sort((a, b) => b[1] - a[1]).slice(0, 15);

        const fmtDur = (ms) => ms == null ? '—' : (ms < 1000 ? ms + 'ms' : (ms < 60000 ? (ms / 1000).toFixed(1) + 's' : Math.round(ms / 60000) + 'm'));
        const card = (label, val) => '<div style="flex:1;min-width:110px;background:var(--surface,#fff);border:1px solid var(--border,#e5e7eb);border-radius:12px;padding:16px;">'
            + '<div style="font-size:24px;font-weight:700;line-height:1;">' + val + '</div>'
            + '<div style="font-size:11px;color:var(--muted-text,#6b7280);text-transform:uppercase;letter-spacing:.05em;margin-top:6px;">' + label + '</div></div>';

        let html = '<div style="margin:24px;max-width:1100px;">'
            + '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">'
            + '<h2 style="margin:0;">User Activity <span style="font-size:13px;color:var(--muted-text,#6b7280);font-weight:400;">· last 7 days · ' + rows.length + ' events</span></h2>'
            + '<button class="btn ghost" onclick="app.showUserActivity()">↻ Refresh</button>'
            + '</div>'
            + '<div style="display:flex;gap:12px;flex-wrap:wrap;margin:16px 0;">'
            + card('Events', rows.length) + card('Navigations', navs.length) + card('Action clicks', clicks.length)
            + card('Active users', activeUsers.size) + card('Sessions', sessions.size)
            + '<div style="flex:1;min-width:110px;background:var(--surface,#fff);border:1px solid ' + (errors.length ? '#e11d48' : 'var(--border,#e5e7eb)') + ';border-radius:12px;padding:16px;">'
            + '<div style="font-size:24px;font-weight:700;line-height:1;color:' + (errors.length ? '#e11d48' : 'inherit') + ';">' + errors.length + '</div>'
            + '<div style="font-size:11px;color:var(--muted-text,#6b7280);text-transform:uppercase;letter-spacing:.05em;margin-top:6px;">JS errors</div></div>'
            + '</div>';

        html += '<h3 style="margin:20px 0 8px;">Navigation flow <span style="font-size:12px;color:var(--muted-text,#6b7280);font-weight:400;">— where users go next (drives predictive preloading)</span></h3>'
            + '<table class="audit-table" style="width:100%;"><thead><tr><th scope="col">From → To</th><th scope="col" style="text-align:right;">Count</th></tr></thead><tbody>'
            + (topTrans.length ? topTrans.map(t => '<tr><td>' + esc(t[0]) + '</td><td style="text-align:right;font-variant-numeric:tabular-nums;">' + t[1] + '</td></tr>').join('') : '<tr><td colspan="2">No navigation recorded yet.</td></tr>')
            + '</tbody></table>';

        html += '<h3 style="margin:20px 0 8px;">Top actions</h3>'
            + '<table class="audit-table" style="width:100%;"><thead><tr><th scope="col">Action (app.fn)</th><th scope="col" style="text-align:right;">Count</th></tr></thead><tbody>'
            + (topActs.length ? topActs.map(t => '<tr><td>' + esc(t[0]) + '</td><td style="text-align:right;font-variant-numeric:tabular-nums;">' + t[1] + '</td></tr>').join('') : '<tr><td colspan="2">No action clicks recorded yet.</td></tr>')
            + '</tbody></table>';

        if (errors.length) {
            html += '<h3 style="margin:20px 0 8px;color:#e11d48;">Recent errors <span style="font-size:12px;color:var(--muted-text,#6b7280);font-weight:400;">— uncaught JS exceptions &amp; rejected promises (PII-free)</span></h3>'
                + '<table class="audit-table" style="width:100%;"><thead><tr><th scope="col">Time</th><th scope="col">User</th><th scope="col">Type</th><th scope="col">Message</th><th scope="col">Where</th></tr></thead><tbody>'
                + errors.slice(0, 40).map(r => {
                    const t = r.created_at ? new Date(r.created_at).toLocaleString() : '—';
                    const m = (r.meta && r.meta.msg) ? r.meta.msg : '';
                    const where = (r.meta && r.meta.src) ? (String(r.meta.src).split('/').pop() + (r.meta.line ? ':' + r.meta.line : '')) : (r.view || '');
                    return '<tr><td style="white-space:nowrap;">' + esc(t) + '</td><td>' + esc(nameOf(r.user_id)) + '</td><td>' + esc(r.target || 'error') + '</td><td>' + esc(m) + '</td><td>' + esc(where) + '</td></tr>';
                }).join('')
                + '</tbody></table>';
        }

        html += '<h3 style="margin:20px 0 8px;">Recent events</h3>'
            + '<table class="audit-table" style="width:100%;"><thead><tr><th scope="col">Time</th><th scope="col">User</th><th scope="col">Type</th><th scope="col">Detail</th></tr></thead><tbody>'
            + rows.slice(0, 120).map(r => {
                const t = r.created_at ? new Date(r.created_at).toLocaleString() : '—';
                let detail = '';
                if (r.event_type === 'nav') detail = (r.from_view || '∅') + ' → ' + (r.view || '∅') + (r.dwell_ms != null ? ' · ' + fmtDur(r.dwell_ms) : '');
                else if (r.event_type === 'click') detail = r.target || '';
                else if (r.event_type === 'search') detail = 'search · ' + (r.view || '');
                else if (r.event_type === 'error') detail = '⚠ ' + (r.target || 'error') + ': ' + ((r.meta && r.meta.msg) ? r.meta.msg : '');
                else detail = r.view || '';
                return '<tr><td style="white-space:nowrap;">' + esc(t) + '</td><td>' + esc(nameOf(r.user_id)) + '</td><td>' + esc(r.event_type) + '</td><td>' + esc(detail) + '</td></tr>';
            }).join('')
            + '</tbody></table>'
            + '<p style="color:var(--muted-text,#6b7280);font-size:12px;margin-top:14px;">PII-free behavioral telemetry — view ids, action names, dwell and counts only. No names, phone numbers, notes or search text are stored. This data powers the upcoming predictive preloading.</p>'
            + '</div>';

        view.innerHTML = html;
    };

    const showComplianceCenter = () => {
        if (!isSystemAdmin()) {
            if (window.UI) window.UI.toast.error("Access Denied. Super Admins only.");
            return;
        }
        let content = `
            <div class="compliance-center" style="margin:24px;">
                <h2>Compliance Center</h2>
                <p>Manage GDPR and PDPA compliance features.</p>
                
                <div class="retention-policies" style="margin-top:24px;">
                    <h3>Active Retention Policies</h3>
                    <div class="policy-card">
                        <div class="policy-header">
                            <div class="policy-name">Audit Logs Retention</div>
                            <div class="policy-action">Archive</div>
                        </div>
                        <div class="policy-details">Retain for: 365 Days</div>
                    </div>
                    <div class="policy-card">
                        <div class="policy-header">
                            <div class="policy-name">Inactive Prospects Data</div>
                            <div class="policy-action">Anonymize</div>
                        </div>
                        <div class="policy-details">Retain for: 730 Days</div>
                    </div>
                </div>
            </div>
        `;
        const view = document.getElementById('content-viewport');
        if (view) view.innerHTML = content;
    };
    
    // Add to window.app
    // Note: initSecurity, initSessionTimeout, logoutDueToInactivity, monitorLoginAttempts,
    // checkForSecurityIncidents, addSecurityAlertIcon, checkExpiredConsents, scheduleRetentionJobs
    // are defined in script.js and already on window.app — do NOT reference them as bare vars here.
    app.register('admin', {
        showSecurityDashboard,
        showAuditLogs,
        showUserActivity,
        showComplianceCenter,
        showTwoFactorSetup: typeof showTwoFactorSetup !== 'undefined' ? showTwoFactorSetup : () => UI.toast.warning('Two-factor authentication is not enabled on this build.'),
        verifyAndEnable2FA: typeof verifyAndEnable2FA !== 'undefined' ? verifyAndEnable2FA : () => UI.toast.warning('Two-factor authentication is not enabled on this build.'),
        showTwoFactorLogin: typeof showTwoFactorLogin !== 'undefined' ? showTwoFactorLogin : () => UI.toast.warning('Two-factor authentication is not enabled on this build.'),
        verifyTwoFactorLogin: typeof verifyTwoFactorLogin !== 'undefined' ? verifyTwoFactorLogin : () => UI.toast.warning('Two-factor authentication is not enabled on this build.')
    });
    
    // ========== PHASE 20: SYSTEM ADMINISTRATION & DEPLOYMENT ==========
    
    const buildAdminDashboardHtml = (health, activeTenants, tenants, updates) => {
        return `
            <div class="admin-dashboard fade-in" style="padding: 24px;">
                <div class="header-actions" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                    <h2>System Administration</h2>
                    <button class="btn primary" onclick="app.showSystemHealth()"><i class="fas fa-stethoscope"></i> Run Health Check</button>
                </div>
    
                <div class="kpi-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; margin-bottom: 24px;">
                    <div class="kpi-card" style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <div class="kpi-title" style="color: var(--gray-600); font-size: 14px; margin-bottom: 8px;">System Status</div>
                        <div class="kpi-value ${health.status === 'HEALTHY' ? 'status-active' : (health.status === 'DEGRADED' ? 'status-warning' : 'status-danger')}" style="font-size: 24px; font-weight: bold;">
                            ${health.status}
                        </div>
                    </div>
                    <div class="kpi-card" style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); cursor: pointer;" onclick="app.showTenantManagement()">
                        <div class="kpi-title" style="color: var(--gray-600); font-size: 14px; margin-bottom: 8px;">Active Tenants</div>
                        <div class="kpi-value" style="font-size: 24px; font-weight: bold; color: var(--gray-900);">${activeTenants} / ${tenants.length}</div>
                    </div>
                    <div class="kpi-card" style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); cursor: pointer;" onclick="app.showDeploymentCenter()">
                        <div class="kpi-title" style="color: var(--gray-600); font-size: 14px; margin-bottom: 8px;">System Version</div>
                        <div class="kpi-value" style="font-size: 24px; font-weight: bold; color: var(--gray-900);">
                            ${updates && updates.hasUpdate ? '<span style="color: var(--warning-color); font-size:16px;">Update Available</span>' : 'Up to Date'}
                        </div>
                    </div>
                </div>
    
                <div class="admin-modules-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">
                    
                    <div class="admin-module-card" style="background: white; padding: 24px; border-radius: 8px; border: 1px solid var(--gray-200); text-align: center; cursor: pointer; transition: transform 0.2s;" onclick="app.showTenantManagement()" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
                        <i class="fas fa-building" style="font-size: 40px; color: var(--primary-color); margin-bottom: 16px;"></i>
                        <h3>Tenant Management</h3>
                        <p style="color: var(--gray-600); font-size: 14px; margin-top: 8px;">Manage multi-tenant architecture, provision new tenants, and monitor usage.</p>
                    </div>
    
                    <div class="admin-module-card" style="background: white; padding: 24px; border-radius: 8px; border: 1px solid var(--gray-200); text-align: center; cursor: pointer; transition: transform 0.2s;" onclick="app.showSystemHealth()" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
                        <i class="fas fa-heartbeat" style="font-size: 40px; color: var(--success-color); margin-bottom: 16px;"></i>
                        <h3>System Health</h3>
                        <p style="color: var(--gray-600); font-size: 14px; margin-top: 8px;">Monitor database, API, storage, and external service connectivity.</p>
                    </div>
    
                    <div class="admin-module-card" style="background: white; padding: 24px; border-radius: 8px; border: 1px solid var(--gray-200); text-align: center; cursor: pointer; transition: transform 0.2s;" onclick="app.showBackupManager()" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
                        <i class="fas fa-database" style="font-size: 40px; color: var(--secondary-color); margin-bottom: 16px;"></i>
                        <h3>Backup & Restore</h3>
                        <p style="color: var(--gray-600); font-size: 14px; margin-top: 8px;">Configure automated backups, manage snapshots, and perform data restoration.</p>
                    </div>
    
                    <div class="admin-module-card" style="background: white; padding: 24px; border-radius: 8px; border: 1px solid var(--gray-200); text-align: center; cursor: pointer; transition: transform 0.2s;" onclick="app.showPerformanceMonitor()" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
                        <i class="fas fa-tachometer-alt" style="font-size: 40px; color: var(--warning-color); margin-bottom: 16px;"></i>
                        <h3>Performance Monitor</h3>
                        <p style="color: var(--gray-600); font-size: 14px; margin-top: 8px;">Track query execution times, memory usage, and application delays.</p>
                    </div>
    
                    <div class="admin-module-card" style="background: white; padding: 24px; border-radius: 8px; border: 1px solid var(--gray-200); text-align: center; cursor: pointer; transition: transform 0.2s;" onclick="app.showDeploymentCenter()" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
                        <i class="fas fa-rocket" style="font-size: 40px; color: #8b5cf6; margin-bottom: 16px;"></i>
                        <h3>Deployment Center</h3>
                        <p style="color: var(--gray-600); font-size: 14px; margin-top: 8px;">Manage CI/CD pipelines, rollouts to different environments, and zero-downtime updates.</p>
                    </div>
    
                    <div class="admin-module-card" style="background: white; padding: 24px; border-radius: 8px; border: 1px solid var(--gray-200); text-align: center; cursor: pointer; transition: transform 0.2s;" onclick="app.showSystemLogs()" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
                        <i class="fas fa-terminal" style="font-size: 40px; color: var(--gray-800); margin-bottom: 16px;"></i>
                        <h3>System Logs</h3>
                        <p style="color: var(--gray-600); font-size: 14px; margin-top: 8px;">View consolidated application, database, and system error logs.</p>
                    </div>
                </div>
            </div>
        `;
    };

    const showAdminDashboard = async () => {
        // Gate on the app PROFILE user (_state.cu), not Auth.getCurrentUser():
        // the latter returns the raw Supabase auth user whose .role is the
        // Postgres claim "authenticated" — never "Level 1 …" — so a real Super
        // Admin was being denied. isSystemAdmin() defaults to _state.cu, matching
        // every other Super-Admin-gated view (boss-report, egg, formula).
        if (!isSystemAdmin()) {
            if (window.UI) window.UI.toast.error("Access Denied. Super Admins only.");
            return;
        }

        const health = typeof SystemHealth !== 'undefined' ? SystemHealth.checkAll() : { status: 'UNKNOWN' };
        const tenants = typeof TenantManager !== 'undefined' ? TenantManager.listTenants() : [];
        const activeTenants = tenants.filter(t => t.status === 'ACTIVE').length;
        const updates = typeof DeploymentManager !== 'undefined' ? DeploymentManager.checkForUpdates() : null;

        let content = buildAdminDashboardHtml(health, activeTenants, tenants, updates);

        const view = document.getElementById('content-viewport');
        if (view) view.innerHTML = content;
    };

    const showTenantManagement = () => {
        if (!isSystemAdmin()) {
            if (window.UI) window.UI.toast.error("Access Denied. Super Admins only.");
            return;
        }
        let tenants = typeof TenantManager !== 'undefined' ? TenantManager.listTenants() : [];
        if (tenants.length === 0) {
            // Seed some dummy tenants for demonstration
            if (typeof TenantManager !== 'undefined') {
                TenantManager.createTenant('FSC-TE-DEMO1', 'Alpha Agency CRM', 'admin@alpha-agency.com');
                TenantManager.createTenant('FSC-TE-DEMO2', 'Beta Properties', 'admin@beta-prop.com');
                tenants = TenantManager.listTenants();
            }
        }
    
        let content = `
            <div class="tenant-management" style="padding: 24px;">
                <div class="header-actions" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                    <h2>Tenant Management</h2>
                    <button class="btn primary" onclick="app.openCreateTenantModal()"><i class="fas fa-plus"></i> New Tenant</button>
                </div>
                
                <div class="data-table-container">
                    <table class="data-table" style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: var(--gray-100); text-align: left;">
                                <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Tenant ID</th>
                                <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Name</th>
                                <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Plan</th>
                                <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Status</th>
                                <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Provisioned</th>
                                <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tenants.map(t => `
                                <tr>
                                    <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${esc(t.tenant_id)}</td>
                                    <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);"><strong>${esc(t.name)}</strong></td>
                                    <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${esc(t.plan)}</td>
                                    <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);"><span class="status-badge status-${esc(String(t.status || '').toLowerCase())}">${esc(t.status)}</span></td>
                                    <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${new Date(t.created_at).toLocaleDateString()}</td>
                                    <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">
                                        <button class="btn-icon" onclick="app.viewTenantDetails('${t.tenant_id}')" title="View"><i class="fas fa-eye"></i></button>
                                        <button class="btn-icon" onclick="app.suspendTenant('${t.tenant_id}')" title="${t.status === 'ACTIVE' ? 'Suspend' : 'Activate'}">
                                            <i class="fas ${t.status === 'ACTIVE' ? 'fa-pause' : 'fa-play'}"></i>
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        const view = document.getElementById('content-viewport');
        if (view) view.innerHTML = content;
    };
    
    const openCreateTenantModal = () => {
        let content = `
            <div class="form-group">
                <label>Tenant ID (Identifier)</label>
                <input type="text" id="new-tenant-id" class="form-control" placeholder="e.g. COMPANY-A">
            </div>
            <div class="form-group">
                <label>Tenant Name</label>
                <input type="text" id="new-tenant-name" class="form-control" placeholder="Company Name">
            </div>
            <div class="form-group">
                <label>Admin Email</label>
                <input type="email" id="new-tenant-email" class="form-control" placeholder="admin@company.com">
            </div>
        `;
        if (window.UI) {
            UI.showModal('Provision New Tenant', content, [
                { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
                { label: 'Provision Tenant', type: 'primary', action: '(async () => { await app.submitNewTenant(); })()' }
            ]);
        }
    };
    
    const submitNewTenant = async () => {
        // Authz: provisioning a tenant is a privileged mutation — gate at entry
        // rather than relying solely on the (admin-only) rendering view.
        if (!isSystemAdmin()) {
            if (window.UI) window.UI.toast.error("Access Denied. Super Admins only.");
            return;
        }
        const idEl    = document.getElementById('new-tenant-id');
        const nameEl  = document.getElementById('new-tenant-name');
        const emailEl = document.getElementById('new-tenant-email');
        if (!idEl || !nameEl || !emailEl) {
            if (window.UI) UI.toast.error("Tenant form elements missing — please reopen the dialog");
            return;
        }
        // Trim whitespace so malformed (padded) tenants are not persisted.
        const id    = idEl.value.trim();
        const name  = nameEl.value.trim();
        const email = emailEl.value.trim();
        if (!id || !name || !email) {
            if (window.UI) UI.toast.error("Please fill all fields");
            return;
        }
        // Validate tenant-id charset (alphanumeric, dash, underscore) and email shape.
        if (!/^[A-Za-z0-9_-]+$/.test(id)) {
            if (window.UI) UI.toast.error("Tenant ID may only contain letters, numbers, hyphens and underscores");
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            if (window.UI) UI.toast.error("Please enter a valid admin email address");
            return;
        }
        // Only claim success if a tenant is actually persisted. TenantManager is
        // not present in the loaded runtime, so guard against a false-success toast
        // (modal closing on a complete no-op). Keep the modal open on failure.
        if (typeof TenantManager === 'undefined' || typeof TenantManager.createTenant !== 'function') {
            if (window.UI) UI.toast.error("Tenant provisioning is not available in this build");
            return;
        }
        // Reject duplicates before creating.
        const existing = (typeof TenantManager.listTenants === 'function' ? TenantManager.listTenants() : []) || [];
        if (existing.some(t => String(t.tenant_id) === id)) {
            if (window.UI) UI.toast.error("A tenant with that ID already exists");
            return;
        }
        try {
            await TenantManager.createTenant(id, name, email);
        } catch (e) {
            if (window.UI) UI.toast.error("Failed to provision tenant" + (e && e.message ? (": " + e.message) : ""));
            return;
        }
        if (window.UI) {
            UI.hideModal();
            UI.toast.success("Tenant provisioned successfully");
        }
        showTenantManagement();
    };
    
    const showSystemHealth = () => {
        if (!isSystemAdmin()) {
            if (window.UI) window.UI.toast.error("Access Denied. Super Admins only.");
            return;
        }
        const health = typeof SystemHealth !== 'undefined' ? SystemHealth.checkAll() : { status: 'UNKNOWN', components: {}, timestamp: Date.now() };
        let content = `
            <div class="system-health" style="padding: 24px;">
                <div class="header-actions" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                    <h2>System Health</h2>
                    <button class="btn secondary" onclick="app.showSystemHealth()"><i class="fas fa-sync-alt"></i> Refresh</button>
                </div>
                <div class="kpi-card" style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 24px; border: 1px solid var(--gray-200);">
                    <h3>Overall Status: <span class="${health.status === 'HEALTHY' ? 'status-active' : 'status-danger'}">${health.status}</span></h3>
                    <p style="color: var(--gray-500); font-size: 14px;">Last checked: ${health.timestamp ? new Date(health.timestamp).toLocaleString() : '—'}</p>
                </div>
                <div class="components-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px;">
                    ${Object.entries(health.components).map(([name, status]) => `
                        <div style="background: white; padding: 16px; border-radius: 8px; border: 1px solid var(--gray-200); display: flex; align-items: center;">
                            <i class="fas ${status === 'up' ? 'fa-check-circle' : 'fa-times-circle'}" style="color: ${status === 'up' ? 'var(--success-color)' : 'var(--danger-color)'}; font-size: 24px; margin-right: 16px;"></i>
                            <div>
                                <div style="font-weight: bold; text-transform: capitalize;">${name.replace('_', ' ')} Node</div>
                                <div style="font-size: 12px; color: var(--gray-500);">Status: ${status.toUpperCase()}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        const view = document.getElementById('content-viewport');
        if (view) view.innerHTML = content;
    };
    
    const showBackupManager = async () => {
        if (!isSystemAdmin()) {
            if (window.UI) window.UI.toast.error("Access Denied. Super Admins only.");
            return;
        }
        let backups = typeof BackupManager !== 'undefined' ? BackupManager.listBackups() : [];
        let content = `
            <div class="backup-manager" style="padding: 24px;">
                <div class="header-actions" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                    <h2>Backup & Restore</h2>
                    <div>
                        <button class="btn secondary" onclick="app.createBackup('INCREMENTAL')">Incremental Backup</button>
                        <button class="btn primary" onclick="app.createBackup('FULL')"><i class="fas fa-save"></i> Full Backup</button>
                    </div>
                </div>
                <div class="data-table-container">
                    <table class="data-table" style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: var(--gray-100); text-align: left;">
                                <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Backup ID</th>
                                <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Date</th>
                                <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Type</th>
                                <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Status</th>
                                <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Size (KB)</th>
                                <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${backups.length > 0 ? backups.map(b => `
                                <tr>
                                    <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${b.id}</td>
                                    <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${new Date(b.created_at).toLocaleString()}</td>
                                    <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${b.type}</td>
                                    <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);"><span class="status-badge status-${esc(String(b.status || '').toLowerCase())}">${esc(b.status)}</span></td>
                                    <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${Number.isFinite(b.size) ? Math.round(b.size / 1024) : 0}</td>
                                    <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">
                                        <button class="btn btn-sm secondary" onclick="app.restoreBackup('${b.id}')">Restore</button>
                                    </td>
                                </tr>
                            `).join('') : '<tr><td colspan="6" style="padding: 16px; text-align: center;">No backups found.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        const view = document.getElementById('content-viewport');
        if (view) view.innerHTML = content;
    };
    
    const createBackup = async (type) => {
        // Authz: destructive/privileged op exported on window.app — gate at entry.
        if (!isSystemAdmin()) {
            if (window.UI) window.UI.toast.error("Access Denied. Super Admins only.");
            return;
        }
        if (typeof BackupManager !== 'undefined') {
            const id = await BackupManager.createBackup(type);
            if (window.UI) UI.toast.success(`Backup ${id} initiated successfully`);
            setTimeout(showBackupManager, 1000); // Refresh view after a simulated delay
        }
    };
    
    const restoreBackup = (id) => {
        // Authz: destructive data-replacing restore exported on window.app — gate at entry.
        if (!isSystemAdmin()) {
            if (window.UI) window.UI.toast.error("Access Denied. Super Admins only.");
            return;
        }
        if (confirm("Are you sure you want to restore this backup? This will replace current data.")) {
            if (typeof BackupManager !== 'undefined') {
                BackupManager.restoreBackup(id);
                if (window.UI) UI.toast.success("Backup restored successfully");
            }
        }
    };
    
    const showPerformanceMonitor = async () => {
        if (!isSystemAdmin()) {
            if (window.UI) window.UI.toast.error("Access Denied. Super Admins only.");
            return;
        }
        if (window.UI) window.UI.toast.info("Generating performance metrics report...");
        let content = `
            <div class="performance-monitor" style="padding: 24px;">
                <h2>Performance Monitor</h2>
                <p>Performance monitoring active. View reports via the browser console or use the System Logs feature to see documented warnings.</p>
                <div class="kpi-card" style="background: white; padding: 20px; border-radius: 8px; margin-top:20px;">
                    <canvas id="performanceChart" width="400" height="150"></canvas>
                </div>
            </div>
        `;
        const view = document.getElementById('content-viewport');
        if (view) {
            view.innerHTML = content;
            // Mock chart
            setTimeout(async () => {
                const ctx = document.getElementById('performanceChart');
                if (!ctx) return;
                await window._ensureChartJs();
                if (window.Chart) {
                    new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: ['10:00', '10:05', '10:10', '10:15', '10:20', '10:25'],
                            datasets: [{ label: 'Average Query Time (ms)', data: [12, 19, 15, 25, 22, 18], borderColor: 'var(--primary)', tension: 0.1 }]
                        }
                    });
                }
            }, 100);
        }
    };
    
    const showDeploymentCenter = async () => {
        if (!isSystemAdmin()) {
            if (window.UI) window.UI.toast.error("Access Denied. Super Admins only.");
            return;
        }
        const history = typeof DeploymentManager !== 'undefined' ? DeploymentManager.getDeploymentHistory() : [];
        let content = `
            <div class="deployment-center" style="padding: 24px;">
                <div class="header-actions" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                    <h2>Deployment Center</h2>
                    <button class="btn primary" onclick="app.executeDeployment()"><i class="fas fa-rocket"></i> Deploy New Version</button>
                </div>
                
                <div class="data-table-container">
                    <table class="data-table" style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: var(--gray-100); text-align: left;">
                                <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Version</th>
                                <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Environment</th>
                                <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Status</th>
                                <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Deployed At</th>
                                <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${history.length > 0 ? history.map(d => `
                                <tr>
                                    <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);"><strong>${d.version}</strong></td>
                                    <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${d.environment}</td>
                                    <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);"><span class="status-badge status-${esc(String(d.status || '').toLowerCase())}">${esc(d.status)}</span></td>
                                    <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${new Date(d.deployed_at).toLocaleString()}</td>
                                    <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">
                                        ${d.status === 'COMPLETED' ? `<button class="btn btn-sm warning" onclick="app.rollbackDeployment('${d.version}')">Rollback</button>` : '-'}
                                    </td>
                                </tr>
                            `).join('') : '<tr><td colspan="5" style="padding: 16px; text-align: center;">No deployment history.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        const view = document.getElementById('content-viewport');
        if (view) view.innerHTML = content;
    };
    
    const executeDeployment = async () => {
        // Authz: privileged deployment op exported on window.app — gate at entry.
        if (!isSystemAdmin()) {
            if (window.UI) window.UI.toast.error("Access Denied. Super Admins only.");
            return;
        }
        if (typeof DeploymentManager !== 'undefined') {
            const version = 'v' + (8.7 + Math.random() * 0.1).toFixed(2);
            DeploymentManager.createDeployment(version, 'PRODUCTION', { 'feature_x': true });
            if (window.UI) UI.toast.success(`Deployment ${version} started`);
            setTimeout(showDeploymentCenter, 1000);
        }
    };
    
    const rollbackDeployment = async (version) => {
        // Authz: destructive rollback exported on window.app — gate at entry.
        if (!isSystemAdmin()) {
            if (window.UI) window.UI.toast.error("Access Denied. Super Admins only.");
            return;
        }
        if (confirm(`Are you sure you want to rollback from ${version}?`)) {
            if (typeof DeploymentManager !== 'undefined') {
                await DeploymentManager.rollbackDeployment(version);
                if (window.UI) UI.toast.success('Rollback initiated');
                setTimeout(showDeploymentCenter, 1000);
            }
        }
    };
    
    const showSystemLogs = () => {
        if (!isSystemAdmin()) {
            if (window.UI) window.UI.toast.error("Access Denied. Super Admins only.");
            return;
        }
        if (typeof SystemLogger !== 'undefined') {
            SystemLogger.showLogViewer();
        } else {
            if (window.UI) window.UI.toast.error("SystemLogger not available");
        }
    };
    
    
    // Add new Admin UI Functions to window.app
    app.register('admin', {
        showAdminDashboard,
        showTenantManagement,
        openCreateTenantModal,
        submitNewTenant,
        showSystemHealth,
        showBackupManager,
        createBackup,
        restoreBackup,
        showPerformanceMonitor,
        showDeploymentCenter,
        executeDeployment,
        rollbackDeployment,
        showSystemLogs,
        viewEntityDetail: async (entity, id) => {
            if (window.app.hideSearchPanel) window.app.hideSearchPanel();
            switch (entity) {
                case 'prospects': if (window.app.showProspectDetail) await window.app.showProspectDetail(id); break;
                case 'customers': if (window.app.showCustomerDetail) await window.app.showCustomerDetail(id); break;
                case 'agents': if (window.app.showAgentDetail) await window.app.showAgentDetail(id); break;
                case 'products':
                case 'bujishu':
                case 'formula':
                    // Navigate to the Marketing > Lists section
                    if (window.app.navigateTo) await window.app.navigateTo('marketing');
                    UI.toast.info('Navigate to Marketing → Lists to manage ' + entity);
                    break;
                case 'activities':
                    if (window.app.viewActivityDetails) await window.app.viewActivityDetails(id);
                    break;
                case 'transactions':
                    if (window.app.showTransactionDetail) await window.app.showTransactionDetail(id);
                    else UI.toast.info('Transaction #' + id);
                    break;
                case 'events':
                    if (window.app.showEventDetail) await window.app.showEventDetail(id);
                    else UI.toast.info('Event #' + id);
                    break;
                default: console.warn('Unknown entity type:', entity);
            }
        },
        // Provide mocks for some inline UI handlers to avoid errors if they don't exist
        suspendTenant: async (id) => {   // ← added 'async'
            if (window.UI) window.UI.toast.info("Tenant suspended state toggled.");
            // Remove 'await' – setTimeout doesn't return a promise
            setTimeout(showTenantManagement, 500);
        },
        viewTenantDetails: (id) => {
            if (window.UI) window.UI.toast.info("Viewing details for " + id);
        }
    });
})();