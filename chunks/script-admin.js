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
    let _currentUser = _state.cu;
    window._syncAdminUser = () => { _currentUser = _state.cu; };

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
        const logs = (await AppDataStore.getAll('audit_logs') || [])
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 50);
    
        let content = `
            <div class="audit-log-viewer" style="margin:24px;">
                <h2>Audit Logs</h2>
                <div class="audit-filters">
                    <select class="form-control" style="width:200px"><option>All Categories</option></select>
                    <select class="form-control" style="width:200px">
                        <option>All Levels</option>
                        ${(_utils.USER_ROLES || []).map(r => `<option>${r}</option>`).join('')}
                    </select>
                </div>
                <table class="audit-table">
                    <thead>
                        <tr>
                            <th scope="col">Timestamp</th>
                            <th scope="col">Level</th>
                            <th scope="col">Category</th>
                            <th scope="col">Action</th>
                            <th scope="col">User</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${logs.map(log => `
                            <tr>
                                <td>${new Date(log.timestamp).toLocaleString()}</td>
                                <td><span class="log-level ${log.level}">${log.level}</span></td>
                                <td>${esc(log.category)}</td>
                                <td>${esc(log.action)}</td>
                                <td>${esc(log.user_id || 'System')}</td>
                            </tr>
                        `).join('')}
                        ${!logs.length ? '<tr><td colspan="5">No logs found.</td></tr>' : ''}
                    </tbody>
                </table>
            </div>
        `;
        const view = document.getElementById('content-viewport');
        if (view) view.innerHTML = content;
    };
    
    const showComplianceCenter = () => {
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
        showComplianceCenter,
        showTwoFactorSetup: typeof showTwoFactorSetup !== 'undefined' ? showTwoFactorSetup : () => UI.toast.warning('Two-factor authentication is not enabled on this build.'),
        verifyAndEnable2FA: typeof verifyAndEnable2FA !== 'undefined' ? verifyAndEnable2FA : () => UI.toast.warning('Two-factor authentication is not enabled on this build.'),
        showTwoFactorLogin: typeof showTwoFactorLogin !== 'undefined' ? showTwoFactorLogin : () => UI.toast.warning('Two-factor authentication is not enabled on this build.'),
        verifyTwoFactorLogin: typeof verifyTwoFactorLogin !== 'undefined' ? verifyTwoFactorLogin : () => UI.toast.warning('Two-factor authentication is not enabled on this build.')
    });
    
    // ========== PHASE 20: SYSTEM ADMINISTRATION & DEPLOYMENT ==========
    
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
    
        let content = `
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
    
        const view = document.getElementById('content-viewport');
        if (view) view.innerHTML = content;
    };
    
    const showTenantManagement = () => {
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
                                    <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);"><span class="status-badge status-${t.status.toLowerCase()}">${t.status}</span></td>
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
        const idEl    = document.getElementById('new-tenant-id');
        const nameEl  = document.getElementById('new-tenant-name');
        const emailEl = document.getElementById('new-tenant-email');
        if (!idEl || !nameEl || !emailEl) {
            if (window.UI) UI.toast.error("Tenant form elements missing — please reopen the dialog");
            return;
        }
        const id    = idEl.value;
        const name  = nameEl.value;
        const email = emailEl.value;
        if (!id || !name || !email) {
            if (window.UI) UI.toast.error("Please fill all fields");
            return;
        }
        if (typeof TenantManager !== 'undefined') {
            await TenantManager.createTenant(id, name, email);
        }
        if (window.UI) {
            UI.hideModal();
            UI.toast.success("Tenant provisioned successfully");
        }
        showTenantManagement();
    };
    
    const showSystemHealth = () => {
        const health = typeof SystemHealth !== 'undefined' ? SystemHealth.checkAll() : { status: 'UNKNOWN', components: {} };
        let content = `
            <div class="system-health" style="padding: 24px;">
                <div class="header-actions" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                    <h2>System Health</h2>
                    <button class="btn secondary" onclick="app.showSystemHealth()"><i class="fas fa-sync-alt"></i> Refresh</button>
                </div>
                <div class="kpi-card" style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 24px; border: 1px solid var(--gray-200);">
                    <h3>Overall Status: <span class="${health.status === 'HEALTHY' ? 'status-active' : 'status-danger'}">${health.status}</span></h3>
                    <p style="color: var(--gray-500); font-size: 14px;">Last checked: ${new Date(health.timestamp).toLocaleString()}</p>
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
                                    <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);"><span class="status-badge status-${b.status.toLowerCase()}">${b.status}</span></td>
                                    <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${Math.round(b.size / 1024)}</td>
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
        if (typeof BackupManager !== 'undefined') {
            const id = await BackupManager.createBackup(type);
            if (window.UI) UI.toast.success(`Backup ${id} initiated successfully`);
            setTimeout(showBackupManager, 1000); // Refresh view after a simulated delay
        }
    };
    
    const restoreBackup = (id) => {
        if (confirm("Are you sure you want to restore this backup? This will replace current data.")) {
            if (typeof BackupManager !== 'undefined') {
                BackupManager.restoreBackup(id);
                if (window.UI) UI.toast.success("Backup restored successfully");
            }
        }
    };
    
    const showPerformanceMonitor = async () => {
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
                                    <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);"><span class="status-badge status-${d.status.toLowerCase()}">${d.status}</span></td>
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
        if (typeof DeploymentManager !== 'undefined') {
            const version = 'v' + (8.7 + Math.random() * 0.1).toFixed(2);
            DeploymentManager.createDeployment(version, 'PRODUCTION', { 'feature_x': true });
            if (window.UI) UI.toast.success(`Deployment ${version} started`);
            setTimeout(showDeploymentCenter, 1000);
        }
    };
    
    const rollbackDeployment = async (version) => {
        if (confirm(`Are you sure you want to rollback from ${version}?`)) {
            if (typeof DeploymentManager !== 'undefined') {
                await DeploymentManager.rollbackDeployment(version);
                if (window.UI) UI.toast.success('Rollback initiated');
                setTimeout(showDeploymentCenter, 1000);
            }
        }
    };
    
    const showSystemLogs = () => {
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
                    if (window.app.showActivityDetail) await window.app.showActivityDetail(id);
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