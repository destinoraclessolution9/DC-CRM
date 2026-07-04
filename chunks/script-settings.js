/**
 * CRM Lazy Chunk: Settings
 * Covers: Settings view, phone/email dedup, push notifications, notification
 *   preferences, self password / preferred-name. Split out of
 *   script-prospects.js 2026-06-18.
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
    // updateUserDisplay lives in the script.js IIFE (exported to window.app, see script.js:4911).
    // Aliased here so saveSelfPreferredName's post-save header refresh no longer throws a
    // ReferenceError (which previously fired the false "Failed to save display name" toast).
    const updateUserDisplay   = (...a) => (window.app.updateUserDisplay || (() => {}))(...a);
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

const selfChangePassword = async () => {
    const currentPwd = document.getElementById('settings-current-pwd')?.value;
    const newPwd = document.getElementById('settings-new-pwd')?.value;
    const confirmPwd = document.getElementById('settings-confirm-pwd')?.value;
    if (!currentPwd) return UI.toast.error('Enter your current password');
    if (!newPwd || newPwd.length < 8) return UI.toast.error('New password must be at least 8 characters');
    if (newPwd !== confirmPwd) return UI.toast.error('Passwords do not match');
    if (newPwd === currentPwd) return UI.toast.error('New password must differ from current password');

    // Verify the current password on a THROWAWAY, non-persistent client so the MAIN
    // client's session is never touched. signInWithPassword mints a FRESH session that,
    // for an MFA (AAL2) user, is only AAL1 — running it on window.supabase would silently
    // REPLACE the user's elevated session with a downgraded one, dropping AAL2-gated access
    // mid-session (the "dead session" symptom). persistSession:false keeps the throwaway
    // entirely in memory (it never writes the shared 'fs-crm-auth-v1' localStorage key), and
    // a distinct storageKey guarantees isolation from the real session. (audit settings:79)
    const _factory = window._supabaseFactory
        || (window.supabase && typeof window.supabase.createClient === 'function' ? window.supabase : null);
    if (!_factory) return UI.toast.error('Auth is still loading — please reload and try again');
    let _verifyClient;
    try {
        _verifyClient = _factory.createClient(window.SUPABASE_URL, window.__SUPABASE_ANON, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'fs-crm-pwverify-ephemeral' }
        });
    } catch (e) {
        console.error('Password verify client init failed:', e?.message || e);
        return UI.toast.error('Could not verify password. Please try again.');
    }
    try {
        const verifyRes = await _verifyClient.auth.signInWithPassword({
            email: _state.cu.email,
            password: currentPwd
        });
        // Best-effort revoke the ephemeral verification session so it doesn't dangle.
        // MUST be scope:'local' — the supabase-js default scope:'global' revokes EVERY
        // refresh token for this user server-side, which would kill the MAIN session (and
        // all the user's other devices). 'local' terminates only this throwaway session.
        try { await _verifyClient.auth.signOut({ scope: 'local' }); } catch (_) { /* ephemeral — expires on its own */ }
        const verifyErr = verifyRes && verifyRes.error;
        if (verifyErr) return UI.toast.error('Current password is incorrect');
        // Update the password on the MAIN client — its (possibly AAL2) session is intact.
        const updateRes = await window.supabase.auth.updateUser({ password: newPwd });
        const updateErr = updateRes && updateRes.error;
        if (updateErr) throw updateErr;
    } catch (e) {
        console.error('Password change failed:', e?.message || e);
        return UI.toast.error('Could not change password. Please try again.');
    }
    // GoTrue (auth.users) is the source of truth for the password — do NOT store a
    // plaintext copy in public.users. Only clear the force-change flag here.
    try { await AppDataStore.update('users', _state.cu.id, { force_password_change: false }); } catch (_) { /* best-effort flag clear */ }
    _state.cu.force_password_change = false;
    const _curEl = document.getElementById('settings-current-pwd');
    const _newEl = document.getElementById('settings-new-pwd');
    const _confEl = document.getElementById('settings-confirm-pwd');
    if (_curEl) _curEl.value = '';
    if (_newEl) _newEl.value = '';
    if (_confEl) _confEl.value = '';
    UI.toast.success('Password changed successfully');
};

const saveSelfPreferredName = async () => {
    if (!_state.cu) return UI.toast.error('Not logged in');
    const input = document.getElementById('settings-preferred-name');
    const newName = (input?.value || '').trim();
    if (newName.length > 60) return UI.toast.error('Preferred name must be 60 characters or less');
    try {
        await AppDataStore.update('users', _state.cu.id, { preferred_name: newName || null });
        _state.cu.preferred_name = newName || null;
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
                <div class="stat-row"><span class="stat-label">Name:</span><span class="stat-value">${escapeHtml(_state.cu?.full_name || '')}</span></div>
                <div class="stat-row"><span class="stat-label">Email:</span><span class="stat-value">${escapeHtml(_state.cu?.email || '')}</span></div>
                <div class="stat-row"><span class="stat-label">Role:</span><span class="stat-value">${escapeHtml(_state.cu?.role || '')}</span></div>
                <div class="stat-row"><span class="stat-label">Agent Code:</span><span class="stat-value">${escapeHtml(_state.cu?.agent_code || '—')}</span></div>
            </div>
        </div>

        <div class="performance-card" style="margin-bottom:24px;">
            <h4><i class="fas fa-id-badge"></i> Display Name</h4>
            <p style="color:var(--gray-500); font-size:13px; margin:8px 0 12px;">This is the name shown in the top-right header. Leave blank to use your full name.</p>
            <div class="form-group" style="margin-bottom:12px;">
                <label>Preferred Name</label>
                <input type="text" id="settings-preferred-name" class="form-control" placeholder="e.g. Mian" value="${escapeHtml(_state.cu?.preferred_name || '')}" maxlength="60">
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

        <!-- ========== Two-Factor Authentication (native TOTP) ========== -->
        <div class="performance-card" style="margin-top:24px;">
            <h4><i class="fas fa-shield-alt"></i> Two-Factor Authentication</h4>
            <p style="color:var(--gray-500); font-size:13px; margin:8px 0 12px;">
                Add a second step at login using an authenticator app (Google Authenticator, Authy, 1Password).
                Strongly recommended for an account with customer data.
            </p>
            <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
                <span id="mfa-status" style="font-size:14px;">Checking…</span>
                <button class="btn primary" id="mfa-enable-btn" style="display:none;" onclick="(async()=>{ await app.startMfaEnroll(); })()">
                    <i class="fas fa-plus"></i> Enable
                </button>
                <button class="btn secondary" id="mfa-disable-btn" style="display:none;" onclick="(async()=>{ await app.unenrollMfa(); })()">
                    <i class="fas fa-times"></i> Disable
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

        ${isSystemAdmin(_state.cu) ? `
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
    setTimeout(() => refreshMfaStatus(), 50);
};

// ========== Native Two-Factor Authentication (Supabase auth.mfa, TOTP) ==========
let _mfaEnrollFactorId = null;

const refreshMfaStatus = async () => {
    const el = document.getElementById('mfa-status');
    const enableBtn = document.getElementById('mfa-enable-btn');
    const disableBtn = document.getElementById('mfa-disable-btn');
    if (!el) return;
    try {
        const { data, error } = await window.supabase.auth.mfa.listFactors();
        if (error) throw error;
        const verified = ((data && data.totp) || []).filter(f => f.status === 'verified');
        if (verified.length) {
            el.innerHTML = '<span style="color:var(--success,#10b981); font-weight:600;"><i class="fas fa-check-circle"></i> Enabled</span>';
            if (enableBtn) enableBtn.style.display = 'none';
            if (disableBtn) disableBtn.style.display = '';
        } else {
            el.innerHTML = '<span style="color:var(--gray-500);">Not enabled</span>';
            if (enableBtn) enableBtn.style.display = '';
            if (disableBtn) disableBtn.style.display = 'none';
        }
    } catch (e) {
        el.textContent = 'Status unavailable';
    }
};

const startMfaEnroll = async () => {
    try {
        // Clean up any stale unverified factor from a previous abandoned attempt.
        try {
            const { data: existing } = await window.supabase.auth.mfa.listFactors();
            for (const f of ((existing && existing.totp) || [])) {
                if (f.status !== 'verified') { try { await window.supabase.auth.mfa.unenroll({ factorId: f.id }); } catch (_) {} }
            }
        } catch (_) {}
        const { data, error } = await window.supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'CRM TOTP' });
        if (error) throw error;
        _mfaEnrollFactorId = data.id;
        const secret = (data.totp && data.totp.secret) || '';
        const content =
            '<p style="margin-bottom:10px; font-size:14px; color:var(--gray-600);">Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.</p>'
            + '<div style="text-align:center; margin-bottom:10px;"><img id="mfa-qr-img" alt="Authenticator QR code" style="width:184px; height:184px;" /></div>'
            + '<p style="font-size:12px; color:var(--gray-500); text-align:center; margin-bottom:12px;">Can’t scan? Manual key: <code style="user-select:all;">' + escapeHtml(secret) + '</code></p>'
            + '<input id="mfa-enroll-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" style="width:100%; padding:10px; font-size:18px; letter-spacing:4px; text-align:center; border:1px solid var(--gray-300,#d1d5db); border-radius:8px;" />';
        UI.showModal('Set Up Two-Factor Authentication', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Verify & Enable', type: 'primary', action: '(async()=>{ await app.verifyMfaEnrollment(); })()' },
        ]);
        // Set the QR src directly (avoid HTML-escaping the data: URI) + focus input.
        setTimeout(() => {
            const im = document.getElementById('mfa-qr-img');
            if (im && data.totp && data.totp.qr_code) im.src = data.totp.qr_code;
            const ip = document.getElementById('mfa-enroll-code');
            if (ip) ip.focus();
        }, 60);
    } catch (e) {
        UI.toast.error('Could not start 2FA setup: ' + (e?.message || e));
    }
};

const verifyMfaEnrollment = async () => {
    const code = ((document.getElementById('mfa-enroll-code') || {}).value || '').trim();
    if (!_mfaEnrollFactorId || code.length < 6) return UI.toast.error('Enter the 6-digit code from your app');
    try {
        const { error } = await window.supabase.auth.mfa.challengeAndVerify({ factorId: _mfaEnrollFactorId, code });
        if (error) throw error;
        _mfaEnrollFactorId = null;
        UI.hideModal();
        UI.toast.success('Two-factor authentication enabled');
        refreshMfaStatus();
    } catch (e) {
        UI.toast.error('Incorrect code — please try again.');
    }
};

const unenrollMfa = async () => {
    if (!window.confirm('Disable two-factor authentication for your account?')) return;
    try {
        const { data } = await window.supabase.auth.mfa.listFactors();
        for (const f of ((data && data.totp) || [])) {
            try { await window.supabase.auth.mfa.unenroll({ factorId: f.id }); } catch (_) {}
        }
        UI.toast.success('Two-factor authentication disabled');
        refreshMfaStatus();
    } catch (e) {
        UI.toast.error('Could not disable 2FA: ' + (e?.message || e));
    }
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
    } catch (_) { /* intentional: RPC probe — fall through to the client-side scan below */ }
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
    } catch (_) { /* intentional: RPC probe — fall through to the client-side scan below */ }
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
                            Agent: ${escapeHtml(agentName(p.responsible_agent_id || p.lead_agent_id))} · Last activity: ${last} · ID ${p.id}
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
    if (!isSystemAdmin(_state.cu)) {
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
    if (!isSystemAdmin(_state.cu)) { UI.toast.error('Access denied'); return; } // defense-in-depth: UI gate is admin-only, but this is app-exposed
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
    // Settings is reachable without ever visiting Prospects, so the prospects
    // chunk (which owns openProspectModal) may not be loaded yet. The script.js
    // forwarding stub does NOT lazy-load it, so load it here first — otherwise
    // the Edit button silently no-ops after the dupes modal closes.
    try {
        if (typeof window._loadChunk === 'function') {
            await window._loadChunk('chunks/script-prospects.min.js');
        }
    } catch (_) { /* fall through — guarded below */ }
    UI.hideModal();
    // Tiny delay so the close animation doesn't fight the next modal open.
    setTimeout(() => {
        if (typeof window.app.openProspectModal === 'function') {
            window.app.openProspectModal(prospectId);
        } else {
            UI.toast.error('Could not open the prospect editor. Please try again.');
        }
    }, 120);
};

const dedupeClearPhone = async (prospectId) => {
    if (!isSystemAdmin(_state.cu)) { UI.toast.error('Access denied'); return; } // defense-in-depth: UI gate is admin-only, but this is app-exposed
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
    if (!isSystemAdmin(_state.cu)) { UI.toast.error('Access denied'); return; } // defense-in-depth: UI gate is admin-only, but this is app-exposed
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
    if (!_state.cu?.id) { UI.toast.error('Log in first'); return; }
    try {
        const res = await window.PushNotif.sendActivityPush(
            { id: 'test_' + Date.now(), activity_type: 'Test', activity_title: 'Test notification' },
            [String(_state.cu.id)],
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
    if (!_state.cu?.id) return;
    try {
        const { data } = await window.supabase
            .from('notification_preferences')
            .select('reminder_minutes,daily_summary')
            .eq('user_id', _state.cu.id)
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
    if (!_state.cu?.id) { UI.toast.error('Log in first'); return; }
    const minutes = [1440, 60, 15, 10].filter(m => {
        const el = document.getElementById(`reminder-${m}`);
        return el && el.checked;
    });
    if (minutes.length === 0) { UI.toast.error('Please select at least one reminder time'); return; }
    const dailySummary = !!(document.getElementById('reminder-daily-summary')?.checked);
    try {
        const { error } = await window.supabase
            .from('notification_preferences')
            .upsert({ user_id: _state.cu.id, reminder_minutes: minutes, daily_summary: dailySummary, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
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

    app.register('settings', {
        _loadEmailDupes,
        _loadPhoneDupes,
        _renderDupeGroup,
        _renderPhoneDupesBody,
        dedupeClearEmail,
        dedupeClearPhone,
        dedupeDeleteProspect,
        dedupeEditPhone,
        disablePushNotifications,
        enablePushNotifications,
        loadNotificationPreferences,
        onReminderCheckboxChange,
        refreshMfaStatus,
        refreshPhoneDupes,
        refreshPushNotificationStatus,
        saveNotificationPreferences,
        saveSelfPreferredName,
        selfChangePassword,
        startMfaEnroll,
        unenrollMfa,
        verifyMfaEnrollment,
        sendTestPushNotification,
        showPhoneDupesModal,
        showSettingsView,
        verifyAndPreparePhoneConstraint,
    });
})();
