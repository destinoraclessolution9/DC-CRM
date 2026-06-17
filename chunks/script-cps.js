/**
 * CRM Lazy Chunk: Notification Bell + Customer Health + Meeting Scheduler + CPS
 * Covers: notification bell init, customer health scoring, meeting scheduler/booking,
 *   CPS intake link, CPS form photo OCR (Gemini Flash).
 * Loaded on-demand when user first opens notifications or navigates to booking/CPS views.
 * Extracted 2026-06-05 (~1310 lines).
 */
(() => {
    const _state = window._appState;
    const _utils = window._crmUtils;
    const esc    = (...a) => _utils.escapeHtml(...a);
    const escapeHtml = esc;
    const getVisibleUserIds = (u) => _utils.getVisibleUserIds(u);
    const isMobile = () => _utils.isMobile();
    const isSystemAdmin        = (u) => _utils.isSystemAdmin(u || _state.cu);
    const isMarketingManager   = (u) => _utils.isMarketingManager(u || _state.cu);
    const isAgent              = (u) => _utils.isAgent(u || _state.cu);
    const isManagement         = (u) => _utils.isManagement(u || _state.cu);
    const isTeamLeaderOrAbove  = (u) => _utils.isTeamLeaderOrAbove(u || _state.cu);
    const isCustomer           = (u) => _utils.isCustomer(u || _state.cu);
    const _getUserLevel        = (u) => _utils.getUserLevel(u);
    const navigateTo           = (v) => window.app.navigateTo(v);
    // Live user reference
    let _currentUser = _state.cu;
    window._syncCpsUser = () => { _currentUser = _state.cu; };

// ========== NOTIFICATION BELL ==========
const _refreshNotifBadge = async () => {
    const badge = document.querySelector('.notif-bell .badget');
    if (!badge) return;
    let count = 0;
    try {
        // Pending CPS intakes
        const visibleIds = await getVisibleUserIds(_currentUser);
        let intakes = [];
        try {
            intakes = await AppDataStore.query('cps_intake_requests', { status: 'submitted' });
        } catch (_) {
            const all = await AppDataStore.getAll('cps_intake_requests');
            intakes = (all || []).filter(r => r.status === 'submitted');
        }
        if (visibleIds !== 'all') {
            const vStrs = visibleIds.map(String);
            intakes = intakes.filter(i => !i.agent_id || vStrs.includes(String(i.agent_id)));
        }
        count += intakes.length;

        // Today's + tomorrow's birthdays
        const today = new Date();
        const mmdd = d => `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const todayMD = mmdd(today);
        const tom = new Date(today); tom.setDate(tom.getDate()+1);
        const tomMD = mmdd(tom);
        const [allProspects, allCustomers, allUsers] = await Promise.all([
            AppDataStore.getAll('prospects'), AppDataStore.getAll('customers'), AppDataStore.getAll('users')
        ]);
        const birthdayPeople = [...allProspects, ...allCustomers, ...allUsers].filter(p => {
            const dob = p.date_of_birth || '';
            if (!dob || dob.length < 5) return false;
            const md = dob.slice(5, 10); // MM-DD
            return md === todayMD || md === tomMD;
        });
        count += birthdayPeople.length;

        // Pending refill reminders
        try {
            const reminders = await AppDataStore.query('refill_reminders', { status: 'pending' });
            count += (reminders || []).length;
        } catch (_) {}

        // Pending co-agent invitations for current user
        try {
            if (_currentUser?.id) {
                const { data: coInvites } = await window.supabase
                    .from('activities')
                    .select('id')
                    .filter('co_agents', 'cs', JSON.stringify([{ id: String(_currentUser.id), status: 'pending' }]));
                count += (coInvites || []).length;
            }
        } catch (_) {}
    } catch (_) {}

    badge.textContent = count > 99 ? '99+' : String(count);
    badge.setAttribute('data-zero', count === 0 ? '1' : '0');
    badge.setAttribute('data-count', count);
};

const _buildNotifPanel = async () => {
    const items = [];
    const today = new Date();
    const mmdd = d => `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const todayMD = mmdd(today);
    const tom = new Date(today); tom.setDate(tom.getDate()+1);
    const tomMD = mmdd(tom);

    // CPS intakes
    const visibleIds = await getVisibleUserIds(_currentUser);
    let intakes = [];
    try {
        intakes = await AppDataStore.query('cps_intake_requests', { status: 'submitted' });
    } catch (_) {
        const all = await AppDataStore.getAll('cps_intake_requests');
        intakes = (all || []).filter(r => r.status === 'submitted');
    }
    if (visibleIds !== 'all') {
        const vStrs = visibleIds.map(String);
        intakes = intakes.filter(i => !i.agent_id || vStrs.includes(String(i.agent_id)));
    }
    for (const i of intakes) {
        items.push({ icon: '📋', title: `CPS Intake: ${esc(i.prospect_name || 'Unknown')}`, sub: `${esc(i.activity_date || '')} · Pending approval`, action: `app.openApproveCpsIntakeModal(${i.id})` });
    }

    // Birthdays
    const [allProspects, allCustomers, allUsers] = await Promise.all([
        AppDataStore.getAll('prospects'), AppDataStore.getAll('customers'), AppDataStore.getAll('users')
    ]);
    const bdayClientSet = new Set();
    [...allProspects, ...allCustomers].forEach(p => {
        const dob = p.date_of_birth || '';
        if (!dob || dob.length < 5) return;
        const md = dob.slice(5, 10);
        const isToday = md === todayMD;
        const isTom   = md === tomMD;
        if (!isToday && !isTom) return;
        items.push({ icon: '🎂', title: `${esc(p.full_name || 'Someone')}'s Birthday`, sub: isToday ? 'Today!' : 'Tomorrow' });
        bdayClientSet.add(p.id);
    });
    allUsers.forEach(u => {
        const dob = u.date_of_birth || '';
        if (!dob || dob.length < 5) return;
        const md = dob.slice(5, 10);
        const isToday = md === todayMD;
        const isTom   = md === tomMD;
        if (!isToday && !isTom) return;
        items.push({ icon: '🎂', title: `${esc(u.full_name || 'Agent')}'s Birthday`, sub: (isToday ? 'Today!' : 'Tomorrow') + ' · Agent' });
    });

    // Refill reminders
    try {
        const reminders = await AppDataStore.query('refill_reminders', { status: 'pending' });
        for (const r of (reminders || []).slice(0, 5)) {
            items.push({ icon: '💊', title: `Refill due: ${esc(r.product_name || 'Product')}`, sub: `Customer needs reorder · Due ${esc(r.due_date || '')}` });
        }
    } catch (_) {}

    // Pending co-agent invitations for current user
    try {
        if (_currentUser?.id) {
            const { data: coInvites } = await window.supabase
                .from('activities')
                .select('id, activity_type, activity_title, activity_date')
                .filter('co_agents', 'cs', JSON.stringify([{ id: String(_currentUser.id), status: 'pending' }]));
            for (const act of (coInvites || []).slice(0, 5)) {
                const typeLabel = act.activity_type || 'Activity';
                const dateLabel = act.activity_date ? ` · ${act.activity_date}` : '';
                const actId = act.id;
                items.push({
                    icon: '🤝',
                    title: `Co-agent invitation: ${esc(typeLabel)}`,
                    sub: `${esc(act.activity_title || typeLabel)}${esc(dateLabel)}
                        <span style="display:inline-flex;gap:6px;margin-top:6px;">
                            <button onclick="event.stopPropagation();app.respondCoAgentInvite(${actId},'accepted');document.querySelector('.notif-panel')?.remove()" style="background:#16a34a;color:#fff;border:none;border-radius:4px;padding:2px 10px;cursor:pointer;font-size:11px;">✓ Accept</button>
                            <button onclick="event.stopPropagation();app.respondCoAgentInvite(${actId},'rejected');document.querySelector('.notif-panel')?.remove()" style="background:#dc2626;color:#fff;border:none;border-radius:4px;padding:2px 10px;cursor:pointer;font-size:11px;">✗ Reject</button>
                        </span>`,
                });
            }
        }
    } catch (_) {}

    if (!items.length) {
        return `<div class="notif-panel-header"><i class="fas fa-bell"></i> Notifications</div>
                <div class="notif-panel-empty">🎉 All caught up! No pending items.</div>`;
    }
    return `<div class="notif-panel-header"><i class="fas fa-bell"></i> Notifications <span style="margin-left:auto;font-size:12px;font-weight:500;color:var(--text-secondary);">${items.length} item${items.length===1?'':'s'}</span></div>` +
        items.map(it => `
            <div class="notif-item" ${it.action ? `onclick="${it.action}; document.querySelector('.notif-panel')?.remove()" style="cursor:pointer;"` : ''}>
                <div class="notif-item-icon">${it.icon}</div>
                <div class="notif-item-body">
                    <div class="notif-item-title">${it.title}</div>
                    <div class="notif-item-sub">${it.sub}</div>
                </div>
            </div>`).join('');
};

const toggleNotifPanel = async () => {
    try {
        const existing = document.querySelector('.notif-panel');
        if (existing) { existing.remove(); return; }
        const panel = document.createElement('div');
        panel.className = 'notif-panel';
        panel.innerHTML = `<div class="notif-panel-header"><i class="fas fa-spinner fa-spin"></i> Loading…</div>`;
        document.body.appendChild(panel);
        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', function handler(e) {
                if (!panel.contains(e.target) && !e.target.closest('.notif-bell')) {
                    panel.remove();
                    document.removeEventListener('click', handler);
                }
            });
        }, 10);
        try {
            panel.innerHTML = await _buildNotifPanel();
        } catch (e) {
            panel.innerHTML = '<div class="notif-panel-empty">Failed to load notifications.</div>';
        }
    } catch (outerErr) {
        console.error('[notif] toggleNotifPanel failed:', outerErr);
    }
};

// Wire bell click + initial badge load.
// Notification badge used to be the single biggest browser→DB chatter
// source on nano: a 2-min poll firing four query() calls (cps_intake_requests,
// refill_reminders, prospects+customers for birthdays, activities co-agent
// JSONB scan) × every tab × every agent. Now we use Supabase Realtime
// (postgres_changes) to be PUSHED a single event whenever any of the three
// tables changes, and only re-fetch then. The 15-min safety-net interval
// exists in case the websocket reconnect logic drops an event during a
// network blip — but the steady-state cost is zero queries.
const _initNotifBell = () => {
    const bell = document.querySelector('.notif-bell');
    if (!bell || bell._notifWired) return;
    bell._notifWired = true;

    const refreshIfVisible = () => { if (!document.hidden) _refreshNotifBadge(); };
    // Initial load
    refreshIfVisible();

    // Coalesce bursts of events (e.g. a bulk admin update) into a single
    // refresh per ~1 s window so we don't trigger a stampede of badge
    // re-counts when many rows change at once.
    let _coalesceTimer = null;
    const onRealtimeEvent = () => {
        if (_coalesceTimer) clearTimeout(_coalesceTimer);
        _coalesceTimer = setTimeout(() => { _coalesceTimer = null; refreshIfVisible(); }, 1000);
    };

    try {
        const sb = window.supabase;
        if (sb && typeof sb.channel === 'function') {
            const ch = sb.channel('notif-badge')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'cps_intake_requests' }, onRealtimeEvent)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'refill_reminders' }, onRealtimeEvent)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'activities' }, onRealtimeEvent)
                .subscribe();
            window._notifChannel = ch;
        }
    } catch (e) { console.warn('[notif] realtime subscribe failed, falling back to interval:', e); }

    // Refresh on tab focus — covers events the websocket may have missed
    // while the tab was backgrounded by the OS.
    document.addEventListener('visibilitychange', refreshIfVisible);
    // 15-min safety-net poll. Was 2 min when we polled; now realtime is
    // primary, so this is just belt-and-braces if the websocket dies
    // and reconnect fails silently.
    setInterval(refreshIfVisible, 15 * 60 * 1000);
};

const getViewPhase = (viewId) => {
    const phaseMap = {
        'dashboard': '0', 'calendar': '1', 'pipeline': '6', 'protection': '13',
        'prospects': '3', 'referrals': '7', 'cases': '18', 'documents': '11',
        'promotions': '12', 'marketing_automation': '12', 'performance': '9', 'reports': '9', 'risk': '19', 'settings': '0',
        'import': '13'
    };
    return phaseMap[viewId] || '?';
};

// ========== CUSTOMER HEALTH SCORE ==========

const calculateCustomerHealthScore = async (customer) => {
    let score = 0;
    // Fire both queries in parallel — they're independent. Previously they ran
    // sequentially (~2x latency) and blocked the customer profile header render.
    const [activities, purchases] = await Promise.all([
        AppDataStore.query('activities', { customer_id: customer.id }).catch(() => []),
        AppDataStore.query('purchases', { customer_id: customer.id }).catch(() => [])
    ]);
    if (activities.length > 0) {
        const last = activities.sort((a, b) => (b.activity_date || '').localeCompare(a.activity_date || ''))[0];
        const days = Math.floor((Date.now() - new Date(last.activity_date)) / 86400000);
        if (days <= 30) score += 40;
        else if (days <= 60) score += 25;
        else if (days <= 90) score += 10;
    }
    if (purchases.length > 0) {
        const last = purchases.sort((a, b) => (b.purchase_date || '').localeCompare(a.purchase_date || ''))[0];
        const days = Math.floor((Date.now() - new Date(last.purchase_date)) / 86400000);
        if (days <= 90) score += 30;
        else if (days <= 180) score += 15;
    }
    score += Math.min(30, Math.floor((customer.score || 0) / 10));
    const grade = score >= 70 ? 'green' : score >= 40 ? 'yellow' : 'red';
    const label = score >= 70 ? 'Healthy' : score >= 40 ? 'At Risk' : 'Churning';
    return { score, grade, label };
};

const renderHealthBadge = (health) => {
    const bg = health.grade === 'green' ? '#10b981' : health.grade === 'yellow' ? '#f59e0b' : '#ef4444';
    return `<span class="score-badge" style="background:${bg}; color:white;" title="Health Score: ${health.score}/100">${health.label} ${health.score}</span>`;
};

const renderQuickHealthBadge = (customer) => {
    const score = customer.score || 0;
    const grade = score >= 70 ? 'green' : score >= 40 ? 'yellow' : 'red';
    const label = score >= 70 ? 'Healthy' : score >= 40 ? 'At Risk' : 'Churning';
    const bg = grade === 'green' ? '#10b981' : grade === 'yellow' ? '#f59e0b' : '#ef4444';
    return `<span class="score-badge" style="background:${bg}; color:white; font-size:11px;" title="Quick health estimate">${label}</span>`;
};

// ========== MEETING SCHEDULER / BOOKING LINKS ==========

// React-island flag (default-on). Kill-switch → legacy: window.__REACT_BOOKING===false,
// ?react=0, or localStorage crm_react_off='1'.
const _reactBookingOn = () => {
    try {
        if (window.__REACT_BOOKING === false) return false;
        if (/[?&]react=0/.test(location.search)) return false;
        if (localStorage.getItem('crm_react_off') === '1') return false;
        return !!(window.CRMReact && typeof window.CRMReact.mountBookingSettings === 'function');
    } catch (_) { return false; }
};

const showBookingSettingsView = async (container) => {
    _state.cv = 'booking_settings';
    if (!_currentUser?.id) { UI.toast.error('Session not ready — please refresh.'); return; }
    const allSlots = await AppDataStore.getAll('booking_slots').catch(() => []);
    const agentSlots = allSlots.filter(s => s.agent_id === _currentUser.id);
    const allAppts = await AppDataStore.getAll('booking_appointments').catch(() => []);
    const appointments = allAppts.filter(a => a.agent_id === _currentUser.id)
        .sort((a, b) => (b.booking_date || '').localeCompare(a.booking_date || ''));
    const bookingUrl = `${window.location.origin}/booking.html?agent=${_currentUser.id}`;

    if (_reactBookingOn()) {
        try {
            container.innerHTML = '<div id="booking-react-root"></div>';
            window.CRMReact.mountBookingSettings(document.getElementById('booking-react-root'), { slots: agentSlots, appointments, bookingUrl });
            return;
        } catch (e) {
            console.warn('[booking-settings] react mount failed:', e && e.message);
            container.innerHTML = '<div style="padding:48px 24px;text-align:center;color:#888;"><i class="fas fa-rotate-right" style="font-size:30px;opacity:.45;"></i><p style="margin:14px 0;">This section couldn\'t load. Please reload the page.</p><button class="btn primary" onclick="location.reload()">Reload</button></div>';
            return;
        }
    }

    container.innerHTML = '<div style="padding:48px 24px;text-align:center;color:#888;"><i class="fas fa-rotate-right" style="font-size:30px;opacity:.45;"></i><p style="margin:14px 0;">This section couldn\'t load. Please reload the page.</p><button class="btn primary" onclick="location.reload()">Reload</button></div>';
};

const openAddSlotModal = () => {
    UI.showModal('Add Availability Slot', `
        <div style="display:flex; flex-direction:column; gap:16px;">
            <div>
                <label style="display:block; font-weight:500; margin-bottom:6px;">Day of Week</label>
                <select id="slot-day" class="form-control">
                    <option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option>
                    <option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option><option value="0">Sunday</option>
                </select>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                <div><label style="display:block; font-weight:500; margin-bottom:6px;">Start Time</label><input type="time" id="slot-start" class="form-control" value="09:00"></div>
                <div><label style="display:block; font-weight:500; margin-bottom:6px;">End Time</label><input type="time" id="slot-end" class="form-control" value="17:00"></div>
            </div>
            <div>
                <label style="display:block; font-weight:500; margin-bottom:6px;">Duration per Slot (minutes)</label>
                <select id="slot-duration" class="form-control">
                    <option value="30">30 minutes</option><option value="45">45 minutes</option>
                    <option value="60" selected>60 minutes</option><option value="90">90 minutes</option>
                </select>
            </div>
        </div>
    `, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Save Slot', type: 'primary', action: '(async () => { await app.saveBookingSlot(); })()' }
    ]);
};

const saveBookingSlot = async () => {
    const startEl = document.getElementById('slot-start');
    const endEl = document.getElementById('slot-end');
    const dayEl = document.getElementById('slot-day');
    const durEl = document.getElementById('slot-duration');
    if (!startEl || !endEl || !dayEl || !durEl) { UI.toast.error('Booking slot form is not ready.'); return; }
    const start = startEl.value;
    const end = endEl.value;
    if (!start || !end || start >= end) { UI.toast.error('End time must be after start time.'); return; }
    await AppDataStore.create('booking_slots', {
        agent_id: _currentUser?.id,
        day_of_week: parseInt(dayEl.value),
        start_time: start, end_time: end,
        duration_minutes: parseInt(durEl.value),
        is_active: true, created_at: new Date().toISOString()
    });
    UI.hideModal();
    UI.toast.success('Availability slot added.');
    await showBookingSettingsView(document.getElementById('content-viewport'));
};

const deleteBookingSlot = async (slotId) => {
    try {
        await AppDataStore.delete('booking_slots', slotId);
        UI.toast.success('Slot removed.');
        await showBookingSettingsView(document.getElementById('content-viewport'));
    } catch (err) {
        UI.toast.error('Delete failed: ' + (err.message || 'Unknown error'));
    }
};

const toggleSlotActive = async (slotId, isActive) => {
    try {
        await AppDataStore.update('booking_slots', slotId, { is_active: isActive });
        UI.toast.success(isActive ? 'Slot activated.' : 'Slot deactivated.');
    } catch (err) {
        UI.toast.error('Update failed: ' + (err?.message || err));
    }
};

const copyBookingLink = () => {
    const url = `${window.location.origin}/booking.html?agent=${_currentUser?.id}`;
    navigator.clipboard.writeText(url).then(() => UI.toast.success('Booking link copied!')).catch(() => UI.toast.info(`Link: ${url}`));
};

const openShareBookingLinkModal = () => {
    const baseUrl = `${window.location.origin}/booking.html?agent=${_currentUser?.id}`;
    UI.showModal('Share Booking Link', `
        <div style="display:flex; flex-direction:column; gap:16px;">
            <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:12px; font-size:13px; color:#166534;">
                <i class="fas fa-info-circle" style="margin-right:6px;"></i>
                Pre-fill the referral info below, then send the link to the customer. The customer will fill in their own personal details on the booking page.
            </div>
            <div>
                <label style="display:block; font-weight:500; margin-bottom:6px;">Referred By <span style="color:var(--gray-400); font-weight:400;">(optional)</span></label>
                <input type="text" id="share-referrer" class="form-control" placeholder="e.g. Tan Ah Kow" oninput="app.updateShareLinkPreview()">
            </div>
            <div>
                <label style="display:block; font-weight:500; margin-bottom:6px;">Relation to Referrer</label>
                <select id="share-relation" class="form-control" onchange="app.updateShareLinkPreview()">
                    <option value="">-- Select Relation --</option>
                    <option value="Friend">Friend</option>
                    <option value="Family">Family</option>
                    <option value="Spouse">Spouse</option>
                    <option value="Siblings">Siblings</option>
                    <option value="Cousin">Cousin</option>
                    <option value="Colleague">Colleague</option>
                    <option value="Ex Colleague">Ex Colleague</option>
                    <option value="Ex Classmate">Ex Classmate</option>
                    <option value="Business Partner">Business Partner</option>
                    <option value="Customer">Customer</option>
                    <option value="Other">Other</option>
                </select>
            </div>
            <div>
                <label style="display:block; font-weight:500; margin-bottom:6px;">Generated Link</label>
                <input type="text" id="share-link-preview" class="form-control" readonly value="${baseUrl}" style="font-size:12px; color:var(--gray-600); background:var(--gray-50);">
                <p style="font-size:11px; color:var(--gray-400); margin:4px 0 0;">Link updates as you fill in the fields above.</p>
            </div>
        </div>
    `, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: '<i class="fas fa-copy"></i> Copy Link', type: 'primary', action: 'app.copySmartBookingLink()' }
    ]);
};

const updateShareLinkPreview = () => {
    const baseUrl = `${window.location.origin}/booking.html?agent=${_currentUser?.id}`;
    const ref = document.getElementById('share-referrer')?.value.trim();
    const rel = document.getElementById('share-relation')?.value;
    let url = baseUrl;
    if (ref) url += `&ref=${encodeURIComponent(ref)}`;
    if (rel) url += `&rel=${encodeURIComponent(rel)}`;
    const linkEl = document.getElementById('share-link-preview');
    if (linkEl) linkEl.value = url;
};

const copySmartBookingLink = () => {
    const linkEl = document.getElementById('share-link-preview');
    const url = linkEl?.value || `${window.location.origin}/booking.html?agent=${_currentUser?.id}`;
    navigator.clipboard.writeText(url).then(() => {
        UI.hideModal();
        UI.toast.success('Booking link copied!');
    }).catch(() => {
        UI.hideModal();
        UI.toast.info(`Link: ${url}`);
    });
};

const confirmBookingAppointment = async (apptId) => {
    try {
        await AppDataStore.update('booking_appointments', apptId, { status: 'confirmed' });
        UI.toast.success('Appointment confirmed.');
        await showBookingSettingsView(document.getElementById('content-viewport'));
    } catch (err) {
        UI.toast.error('Confirm failed: ' + (err?.message || err));
    }
};

const cancelBookingAppointment = async (apptId) => {
    try {
        await AppDataStore.update('booking_appointments', apptId, { status: 'cancelled' });
        UI.toast.success('Appointment cancelled.');
        await showBookingSettingsView(document.getElementById('content-viewport'));
    } catch (err) {
        UI.toast.error('Cancel failed: ' + (err?.message || err));
    }
};

// ========== CPS INTAKE LINK (shareable one-time form) ==========
// Flow: agent picks date/time/venue → system generates token link → agent sends to
// prospect → prospect fills basic info on cps-intake.html → agent approves on calendar
// which opens Quick Add Activity (CPS) pre-filled; agent adds referrer+relation to confirm.

const openShareCpsIntakeLinkModal = async () => {
    const venueData = await AppDataStore.getAll('venues').catch(() => []);
    const venueOptions = (venueData || [])
        .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
        .map(v => `<option value="${v.id}" data-name="${(v.name || '').replace(/"/g, '&quot;')}" data-address="${(v.address || v.location || '').replace(/"/g, '&quot;')}" data-waze="${(v.waze_link || '').replace(/"/g, '&quot;')}">${esc(v.name)} | ${esc(v.location || '')}</option>`)
        .join('');

    const today = new Date().toISOString().split('T')[0];

    UI.showModal('Share CPS Intake Link', `
        <div style="display:flex; flex-direction:column; gap:14px;">
            <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:12px; font-size:13px; color:#166534;">
                <i class="fas fa-info-circle" style="margin-right:6px;"></i>
                Set the appointment date, time and venue. A one-time link will be generated — share it with the prospect so they can fill in their basic info. You'll approve it on your calendar afterwards.
            </div>
            <div class="form-row">
                <div class="form-group half">
                    <label>Date <span class="required">*</span></label>
                    <input type="date" id="intake-date" class="form-control" value="${today}">
                </div>
                <div class="form-group half">
                    <label>Venue <span class="required">*</span></label>
                    <select id="intake-venue" class="form-control">
                        <option value="">-- Select Venue --</option>
                        ${venueOptions}
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group half">
                    <label>Start Time <span class="required">*</span></label>
                    <input type="time" id="intake-start" class="form-control" value="14:00">
                </div>
                <div class="form-group half">
                    <label>End Time <span class="required">*</span></label>
                    <input type="time" id="intake-end" class="form-control" value="15:30">
                </div>
            </div>

            <div id="intake-generated-link" style="display:none; background:var(--gray-50); border:1px solid var(--gray-200); border-radius:8px; padding:14px;">
                <label style="display:block; font-weight:600; margin-bottom:6px; font-size:13px;">Shareable Link</label>
                <div style="display:flex; gap:8px; align-items:center;">
                    <input type="text" id="intake-link-input" class="form-control" readonly style="flex:1; font-size:12px;">
                    <button class="btn secondary btn-sm" type="button" onclick="app.copyCpsIntakeLink()"><i class="fas fa-copy"></i> Copy</button>
                    <button class="btn secondary btn-sm" type="button" onclick="app.shareCpsIntakeWhatsApp()"><i class="fab fa-whatsapp"></i> WhatsApp</button>
                </div>
                <p class="help-text" style="margin-top:8px; font-size:12px; color:var(--gray-500);">The link expires in 7 days or once the prospect submits.</p>
            </div>
        </div>
    `, [
        { label: 'Close', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Generate Link', type: 'primary', action: '(async () => { await app.saveCpsIntakeLink(); })()' }
    ]);
};

const saveCpsIntakeLink = async () => {
    const date = document.getElementById('intake-date')?.value;
    const startTime = document.getElementById('intake-start')?.value;
    const endTime = document.getElementById('intake-end')?.value;
    const venueSel = document.getElementById('intake-venue');

    if (!date || !startTime || !endTime) {
        UI.toast.error('Date, start time and end time are required.');
        return;
    }
    if (startTime >= endTime) {
        UI.toast.error('End time must be after start time.');
        return;
    }
    if (!venueSel?.value) {
        UI.toast.error('Please select a venue.');
        return;
    }

    const opt = (venueSel && venueSel.selectedIndex >= 0) ? venueSel.options[venueSel.selectedIndex] : null;
    const venueName = opt?.getAttribute('data-name') || '';
    const venueAddress = opt?.getAttribute('data-address') || '';
    const wazeLink = opt?.getAttribute('data-waze') || '';

    try {
        const row = await AppDataStore.create('cps_intake_requests', {
            agent_id: _currentUser?.id || null,
            activity_date: date,
            start_time: startTime,
            end_time: endTime,
            venue_name: venueName,
            venue_address: venueAddress,
            waze_link: wazeLink,
            status: 'awaiting_submission',
            created_at: new Date().toISOString()
        });

        if (!row || !row.token) {
            UI.toast.error('Link created but token missing. Please try again.');
            return;
        }

        const url = `${window.location.origin}/cps-intake.html?token=${row.token}`;
        const linkBlock = document.getElementById('intake-generated-link');
        const linkInput = document.getElementById('intake-link-input');
        if (linkBlock && linkInput) {
            linkInput.value = url;
            linkBlock.style.display = 'block';
        }
        UI.toast.success('Link generated! Share it with the prospect.');
    } catch (err) {
        console.error('saveCpsIntakeLink failed:', err);
        UI.toast.error('Failed to generate link: ' + (err.message || 'Unknown error'));
    }
};

const copyCpsIntakeLink = () => {
    const input = document.getElementById('intake-link-input');
    if (!input || !input.value) return;
    navigator.clipboard.writeText(input.value)
        .then(() => UI.toast.success('Link copied!'))
        .catch(() => {
            input.select();
            document.execCommand('copy');
            UI.toast.success('Link copied!');
        });
};

const shareCpsIntakeWhatsApp = () => {
    const input = document.getElementById('intake-link-input');
    if (!input || !input.value) return;

    const date = document.getElementById('intake-date')?.value || '';
    const startTime = document.getElementById('intake-start')?.value || '';
    const endTime = document.getElementById('intake-end')?.value || '';
    const venueSel = document.getElementById('intake-venue');
    const opt = venueSel?.options[venueSel.selectedIndex];
    const venueName = opt?.getAttribute('data-name') || '';
    const venueAddress = opt?.getAttribute('data-address') || '';
    const wazeLink = opt?.getAttribute('data-waze') || '';

    // Format date nicely: "Mon, 13 Apr 2026"
    let dateStr = date;
    if (date) {
        const [y, m, d] = date.split('-').map(Number);
        const dt = new Date(y, m - 1, d);
        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        dateStr = `${days[dt.getDay()]}, ${d} ${months[dt.getMonth()]} ${y}`;
    }
    const timeStr = `${(startTime || '').slice(0,5)} – ${(endTime || '').slice(0,5)}`;

    let msg = `您好！请通过以下链接填妥基本资料以确认您的 CPS 约谈：\nHi! Please fill in your basic information to confirm your CPS appointment:\n`;
    msg += `\n${input.value}\n`;
    msg += `\n📅 日期 Date: ${dateStr}`;
    msg += `\n⏰ 时间 Time: ${timeStr}`;
    if (venueName) msg += `\n📍 地点 Venue: ${venueName}`;
    if (venueAddress) msg += `\n🏠 地址 Address: ${venueAddress}`;
    if (wazeLink) msg += `\n🗺️ Waze: ${wazeLink}`;

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
};

const _buildPendingCpsIntakesHtml = (intakes) => {
    return `
        <div style="background:#fffbeb; border:1px solid #fcd34d; border-radius:12px; padding:16px; margin-bottom:16px;">
            <h3 style="margin:0 0 12px; font-size:15px; color:#92400e; display:flex; align-items:center; gap:8px;">
                <i class="fas fa-bell"></i> PENDING CPS INTAKE APPROVALS (${intakes.length})
            </h3>
            <div style="display:flex; flex-direction:column; gap:10px;">
                ${intakes.map(i => `
                    <div style="background:white; border:1px solid #fde68a; border-radius:8px; padding:12px;">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
                            <div style="flex:1; min-width:200px;">
                                <div style="font-weight:600; font-size:14px; margin-bottom:2px;">${esc(i.prospect_name || 'Unknown')}</div>
                                <div style="font-size:12px; color:var(--gray-600);">
                                    <i class="fas fa-phone" style="margin-right:4px;"></i>${esc(i.prospect_phone || '—')}
                                    ${i.prospect_email ? ` · <i class="fas fa-envelope" style="margin-right:4px;"></i>${esc(i.prospect_email)}` : ''}
                                </div>
                                <div style="font-size:12px; color:var(--gray-500); margin-top:4px;">
                                    <i class="far fa-calendar" style="margin-right:4px;"></i>${esc(i.activity_date)} · ${(i.start_time || '').slice(0,5)}–${(i.end_time || '').slice(0,5)}
                                    ${i.venue_name ? ` · <i class="fas fa-map-marker-alt" style="margin-right:4px;"></i>${esc(i.venue_name)}` : ''}
                                </div>
                            </div>
                            <div style="display:flex; gap:6px;">
                                <button class="btn primary btn-sm" onclick="app.openApproveCpsIntakeModal(${i.id})">
                                    <i class="fas fa-check"></i> Review & Approve
                                </button>
                                <button class="btn secondary btn-sm" onclick="app.rejectCpsIntake(${i.id})" title="Reject">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
};

// Render a "Pending CPS Intake Approvals" section at the top of the calendar today-list.
// Called from showCalendarView in parallel with the other renderers.
const renderPendingCpsIntakes = async () => {
    const host = document.getElementById('pending-cps-intakes');
    if (!host) return;

    let intakes = [];
    try {
        // SWR serves the cached snapshot instantly; background revalidation picks
        // up new submissions within 5 min. Removed { fresh: true } which forced a
        // Supabase round-trip on EVERY calendar render, blocking re-paints.
        const all = await AppDataStore.getAll('cps_intake_requests');
        const pendingStatuses = new Set(['submitted', 'pending', 'awaiting_approval', 'new']);
        intakes = (all || []).filter(r => pendingStatuses.has(r.status));
    } catch (_) { intakes = []; }

    // Filter: only show intakes created by the current user or their subordinates.
    // Records with no agent_id are always shown to any logged-in leader.
    const visibleIds = await getVisibleUserIds(_currentUser);
    if (visibleIds !== 'all') {
        const visibleStrs = visibleIds.map(String);
        intakes = intakes.filter(i => !i.agent_id || visibleStrs.includes(String(i.agent_id)));
    }

    if (!intakes || intakes.length === 0) {
        host.innerHTML = '';
        host.style.display = 'none';
        return;
    }

    host.style.display = 'block';
    host.innerHTML = _buildPendingCpsIntakesHtml(intakes);
};

const openApproveCpsIntakeModal = async (intakeId) => {
    const intake = await AppDataStore.getById('cps_intake_requests', intakeId);
    if (!intake) {
        UI.toast.error('Intake request not found.');
        return;
    }
    if (intake.status !== 'submitted') {
        UI.toast.error('This intake is no longer pending.');
        await renderPendingCpsIntakes();
        return;
    }

    // Stash id + full row so saveActivity can mark approved and send WhatsApp
    _state.pii = intakeId;
    _state.pir = intake;

    // Open the standard Quick Add Activity modal — it defaults to CPS type
    await (window.app.openActivityModal || (() => {}))(intake.activity_date);

    // Wait for the CPS dynamic fields to mount, then prefill
    let attempts = 0;
    const pollInterval = setInterval(() => {
        const nameEl = document.getElementById('cps-name');
        if (nameEl) {
            const setF = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
            setF('cps-name', intake.prospect_name);
            setF('cps-ic', intake.prospect_ic);
            setF('cps-occupation', intake.prospect_occupation);
            setF('cps-phone', intake.prospect_phone);
            setF('cps-email', intake.prospect_email);
            setF('activity-date', intake.activity_date);
            setF('start-time', (intake.start_time || '').slice(0, 5));
            setF('end-time', (intake.end_time || '').slice(0, 5));

            // Try to select the venue — match by name against the dropdown options
            const venueSel = document.getElementById('activity-venue');
            if (venueSel && intake.venue_name) {
                for (const opt of venueSel.options) {
                    if (opt.value && opt.value.toLowerCase().startsWith(intake.venue_name.toLowerCase())) {
                        venueSel.value = opt.value;
                        break;
                    }
                }
            }

            // Trigger duration recalc
            if (typeof app !== 'undefined' && app.calculateDuration) app.calculateDuration();

            clearInterval(pollInterval);
            UI.toast.info('Please add referrer and relation before saving.');
        } else if (++attempts >= 16) {
            clearInterval(pollInterval);
        }
    }, 250);
};

const rejectCpsIntake = async (intakeId) => {
    if (!confirm('Reject this CPS intake request? This cannot be undone.')) return;
    try {
        await AppDataStore.update('cps_intake_requests', intakeId, {
            status: 'rejected',
            approved_at: new Date().toISOString()
        });
        UI.toast.success('Intake rejected.');
        await renderPendingCpsIntakes();
    } catch (err) {
        UI.toast.error('Reject failed: ' + (err.message || 'Unknown error'));
    }
};

// ========== CPS FORM PHOTO OCR (Gemini Flash via Edge Function) ==========
// Lets agents snap a photo of the paper "細解命盤" form and auto-fill the
// basic-info panel. Always shows a side-by-side review modal first so the
// agent can compare existing form values vs scanned values before applying.

// Map of scanned field → CRM form field id (suffix on `${prefix}-`)
const CPS_SCAN_FIELD_MAP = [
    // [scannedKey, fieldSuffix, displayLabel, dbColumn]
    // dbColumn is used when applying to an existing prospect record.
    ['name',           'name',         'Full Name',          'full_name'],
    ['gender',         'gender',       'Gender',             'gender'],
    ['dob_solar',      'dob',          'Date of Birth',      'date_of_birth'],
    ['dob_lunar',      'lunar',        'Lunar Birth',        'lunar_birth'],
    ['phone',          'phone',        'Phone',              'phone'],
    ['occupation',     'occupation',   'Occupation',         'occupation'],
    ['email',          'email',        'Email',              'email'],
    ['address',        'address',      'Address',            'address'],
    // marital_status is a checkbox group in form, plain column in DB
    ['marital_status', '__marital__',  'Marital Status',     'marital_status'],
];

// Read the current value out of the form for a given field suffix
const _readCpsField = (prefix, suffix) => {
    if (suffix === '__marital__') {
        const cb = document.querySelector(`.${prefix}-marital-cb:checked`);
        return cb ? cb.value : '';
    }
    const el = document.getElementById(`${prefix}-${suffix}`);
    return el ? (el.value || '').trim() : '';
};

// Write a value into a form field
const _writeCpsField = (prefix, suffix, value) => {
    if (suffix === '__marital__') {
        document.querySelectorAll(`.${prefix}-marital-cb`).forEach(cb => {
            cb.checked = (cb.value === value);
        });
        return;
    }
    const el = document.getElementById(`${prefix}-${suffix}`);
    if (!el) return;
    el.value = value || '';
    // Trigger lunar recalc when DOB is set
    if (suffix === 'dob' && typeof app !== 'undefined' && app.updateLunarBirth) {
        try { app.updateLunarBirth(`${prefix}-dob`, `${prefix}-lunar`); } catch (e) {}
    }
};

// Stash scan result so the review modal callbacks can read it.
let _cpsScanCache = null;
// Photo file (File blob) pending silent upload. Persists across the
// review modal lifecycle — consumed when the host record (prospect or
// activity) is saved, then cleared. Per-prefix so prospect-modal and
// cps-modal flows don't trample each other.
// NOTE: backed by the shared _appState bridge (_state.cppf) so script-activities.js
// saveActivity can see the photo. A chunk-local object would be invisible to it.
const _cpsPendingPhotoFiles = _state.cppf;  // { [prefix]: File } — shared reference

// Centralized helper: upload a CPS form photo to Supabase Storage and
// patch the prospect record with the URL + date + filename. Single source
// of truth used by all three entry points (Upload CPS button, basic-info
// Take Photo, CPS Quick Add). Returns the public URL or null on failure.
const _uploadCpsFormFile = async (file, prospectId) => {
    if (!file || !prospectId) return null;
    try {
        const sb = window.supabase;
        if (!sb || !sb.storage) return null;
        const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] || '.jpg').toLowerCase();
        const path = `cps-forms/${prospectId}_${Date.now()}${ext}`;
        const { error: upErr } = await sb.storage
            .from('attachments')
            .upload(path, file, { upsert: true, contentType: file.type });
        if (upErr) throw upErr;
        const { data: urlData } = sb.storage.from('attachments').getPublicUrl(path);
        await AppDataStore.update('prospects', prospectId, {
            cps_form_url: urlData?.publicUrl || null,
            cps_form_date: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })(),
            cps_form_name: file.name,
        });
        return urlData?.publicUrl || null;
    } catch (err) {
        console.warn('CPS form silent upload failed:', err);
        return null;
    }
};

// Dedicated overlay for the scan flow (separate from UI.showModal).
// The CPS form's prospect/quick-add modal already lives in the global
// modal overlay; reusing it for the spinner + review would WIPE the form
// DOM and lose the agent's in-progress entries. This standalone overlay
// sits on top without touching the underlying modal.
const _showCpsScanOverlay = (title, contentHtml, buttons = []) => {
    let overlay = document.getElementById('cps-scan-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'cps-scan-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';
        document.body.appendChild(overlay);
    }
    const btnHtml = buttons.map(b => {
        const cls = b.type === 'primary' ? 'btn primary' : 'btn secondary';
        return `<button class="${cls}" style="margin-left:8px;" onclick="${b.action}">${b.label}</button>`;
    }).join('');
    overlay.innerHTML = `
        <div style="background:white;border-radius:12px;max-width:760px;width:100%;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
            <div style="padding:16px 20px;border-bottom:1px solid var(--gray-200);font-weight:600;font-size:16px;display:flex;justify-content:space-between;align-items:center;">
                <span>${title}</span>
                <button type="button" style="background:none;border:none;font-size:20px;color:var(--gray-500);cursor:pointer;padding:0;line-height:1;" onclick="app._hideCpsScanOverlay()">&times;</button>
            </div>
            <div style="padding:18px 20px;overflow-y:auto;flex:1;">${contentHtml}</div>
            ${buttons.length ? `<div style="padding:14px 20px;border-top:1px solid var(--gray-200);text-align:right;background:var(--gray-50);">${btnHtml}</div>` : ''}
        </div>
    `;
    overlay.style.display = 'flex';
};

const _hideCpsScanOverlay = () => {
    const overlay = document.getElementById('cps-scan-overlay');
    if (overlay) overlay.remove();
};

// ─── CPS Paste-Text Parser ───────────────────────────────────────────
// Lets agents paste the standard WhatsApp "请填妥基本资料" reply and
// auto-fill Name / IC / Occupation / Phone / Email. The IC also derives
// Date of Birth and Gender. Sits on the same overlay layer as the
// photo-scan flow so the underlying form DOM stays intact.
const openCpsPasteModal = (prefix = 'cps') => {
    const placeholder = `请填妥基本资料 Basic information
1. 姓名 Name : CHEE CHUN CHING
2. 身分号码 IC: 740315-04-5427
3. 职业 Occupation: Driver
4. 联络号码 Phone no: 0122034218
5. 邮箱 Email: thomaschee@gmail.com`;
    const contentHtml = `
        <div style="margin-bottom:10px;color:var(--gray-600);font-size:13px;line-height:1.5;">
            Paste the customer's bilingual reply below. The system will auto-fill
            <strong>Name</strong>, <strong>IC</strong>, <strong>Occupation</strong>,
            <strong>Phone</strong>, <strong>Email</strong> — and derive
            <strong>Date of Birth</strong> and <strong>Gender</strong> from the IC.
        </div>
        <textarea id="cps-paste-input" class="form-control" rows="10"
            style="font-family:inherit;font-size:13px;"
            placeholder="${placeholder.replace(/"/g, '&quot;')}"></textarea>
        <div style="margin-top:8px;font-size:11px;color:var(--gray-400);">
            Also accepts variants like "电话", "Tel", "手机", "Mobile", "E-mail", "身份证", etc.
        </div>
    `;
    _showCpsScanOverlay('Paste Customer Info', contentHtml, [
        { type: 'secondary', label: 'Cancel', action: 'app._hideCpsScanOverlay()' },
        { type: 'primary',   label: 'Auto-Fill Form', action: `app.parseCpsPastedText('${prefix}')` },
    ]);
    setTimeout(() => {
        const ta = document.getElementById('cps-paste-input');
        if (ta) ta.focus();
    }, 50);
};

// Malaysian IC (NRIC) format: YYMMDD-PB-###G
//   YYMMDD → birth date · last digit G → odd=Male, even=Female
// Returns { dob: 'YYYY-MM-DD', gender: 'Male'|'Female' } or null on bad input.
const _parseMalaysianIc = (ic) => {
    const clean = String(ic || '').replace(/[^0-9]/g, '');
    if (clean.length !== 12) return null;
    const yy = parseInt(clean.slice(0, 2), 10);
    const mm = parseInt(clean.slice(2, 4), 10);
    const dd = parseInt(clean.slice(4, 6), 10);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    // Century window: anything within ~5 years of "future" maps to 20YY,
    // older years map to 19YY. Works for both elderly customers and babies.
    const nowYY = new Date().getFullYear() % 100;
    const century = (yy <= nowYY + 5) ? 2000 : 1900;
    const dob = `${century + yy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    const last = parseInt(clean.slice(-1), 10);
    const gender = (last % 2 === 0) ? 'Female' : 'Male';
    return { dob, gender };
};

const parseCpsPastedText = (prefix = 'cps') => {
    const ta = document.getElementById('cps-paste-input');
    if (!ta) return;
    const text = (ta.value || '').trim();
    if (!text) {
        UI.toast.error('Please paste the message first.');
        return;
    }

    // Tolerates ":" or "：", leading numbering ("1.", "1)", "-"), spacing
    // inside Chinese labels, and either Chinese or English keyword.
    const grab = (re) => {
        const m = text.match(re);
        return m && m[1] ? m[1].trim() : '';
    };

    // Value captures use [^\r\n]+ so they never spill into the next labelled
    // line — important for numeric IC/Phone where "3." or "5." prefixes on
    // following lines would otherwise glue onto the value.
    const fields = {
        name:       grab(/(?:姓\s*名|Name)\s*[:：]\s*([^\r\n]+)/i),
        ic:         grab(/(?:身\s*[分份](?:\s*[号证码])+|IC(?:\s*No\.?)?|NRIC)\s*[:：]\s*([^\r\n]+)/i),
        occupation: grab(/(?:职\s*业|工\s*作|Occupation|Job)\s*[:：]\s*([^\r\n]+)/i),
        phone:      grab(/(?:联\s*络\s*号?\s*码|电\s*话|手\s*机|Phone(?:\s*no\.?)?|Tel(?:ephone)?|Mobile|Contact\s*(?:no\.?|number))\s*[:：]\s*([^\r\n]+)/i),
        email:      grab(/(?:邮\s*箱|电\s*邮|Email|E[-\s]?mail)\s*[:：]\s*([^\s,;，；]+)/i),
    };

    Object.keys(fields).forEach(k => {
        fields[k] = (fields[k] || '').replace(/[。；;,，]\s*$/, '').trim();
    });
    if (fields.phone) fields.phone = fields.phone.replace(/[^\d+()]/g, '');
    if (fields.ic)    fields.ic    = fields.ic.replace(/[^0-9A-Za-z\-]/g, '');

    const map = [
        ['name',       'name'],
        ['ic',         'ic'],
        ['occupation', 'occupation'],
        ['phone',      'phone'],
        ['email',      'email'],
    ];
    let filled = 0;
    map.forEach(([key, suffix]) => {
        if (fields[key]) {
            _writeCpsField(prefix, suffix, fields[key]);
            filled++;
        }
    });

    // Derive DOB + Gender from a Malaysian IC if one was supplied and the
    // form fields are empty — never overwrite a value the agent already entered.
    let derived = 0;
    if (fields.ic) {
        const parsed = _parseMalaysianIc(fields.ic);
        if (parsed) {
            if (!_readCpsField(prefix, 'dob')) {
                _writeCpsField(prefix, 'dob', parsed.dob);
                derived++;
            }
            const genderEl = document.getElementById(`${prefix}-gender`);
            if (genderEl && !genderEl.value) {
                genderEl.value = parsed.gender;
                derived++;
            }
        }
    }

    // Only dismiss the overlay on success — if the parser found nothing,
    // keep the textarea open so the agent can correct their paste and
    // retry without having to copy and paste the message a second time.
    if (filled === 0) {
        UI.toast.error('No recognizable fields found — please check the pasted text and try again.');
        return;
    }
    _hideCpsScanOverlay();
    const extra = derived ? ` (+${derived} derived from IC)` : '';
    UI.toast.success(`Auto-filled ${filled} field${filled === 1 ? '' : 's'}${extra}.`);
};

const scanCpsForm = (prefix = 'cps') => {
    const input = document.getElementById(`${prefix}-scan-input`);
    if (!input) {
        UI.toast.error('Scan input not found. Please reopen the form.');
        return;
    }
    input.value = ''; // allow re-selecting the same file
    input.click();
};

const handleCpsScanFile = async (input, prefix = 'cps') => {
    const file = input.files && input.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        UI.toast.error('Please select an image file.');
        return;
    }
    if (file.size > 8 * 1024 * 1024) {
        UI.toast.error('Image too large. Please use a photo under 8 MB.');
        return;
    }

    // Snapshot current form values BEFORE showing any overlay.
    const current = {};
    CPS_SCAN_FIELD_MAP.forEach(([key, suffix]) => {
        current[key] = _readCpsField(prefix, suffix);
    });

    // Show a "scanning…" overlay on TOP of the prospect/CPS modal
    // (separate overlay so the form DOM stays intact).
    _showCpsScanOverlay('Scanning Form…', `
        <div style="text-align:center; padding:20px 0;">
            <i class="fas fa-spinner fa-spin" style="font-size:36px; color:#7c3aed; margin-bottom:14px;"></i>
            <p style="color:var(--gray-600); margin:0;">Reading the form, please wait…</p>
            <p style="color:var(--gray-400); font-size:12px; margin-top:6px;">(usually 3–6 seconds)</p>
        </div>
    `);

    try {
        // Convert image to base64 (avoids multipart edge cases)
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Could not read file'));
            reader.readAsDataURL(file);
        });
        const [meta, b64] = String(dataUrl).split(',');
        const mime = (meta.match(/data:(.*?);base64/) || [])[1] || file.type || 'image/jpeg';

        if (!window.supabase || !window.supabase.functions) {
            throw new Error('Supabase client not available (offline mode?)');
        }

        const { data: res, error } = await window.supabase.functions.invoke('cps-form-ocr', {
            body: { image_base64: b64, mime_type: mime },
        });

        if (error) throw new Error(error.message || 'Edge function call failed');
        if (!res || res.ok === false) {
            throw new Error(res?.detail || res?.error || 'OCR failed');
        }

        const scanned = res.fields || {};
        const confidence = res.confidence || {};

        // `current` was snapshotted above before any overlay opened.
        _cpsScanCache = { prefix, scanned, confidence, current, rawText: res.raw_text || '' };
        // Stash the photo for silent upload after host record is saved.
        // Survives review modal Cancel — the photo is always uploaded.
        _cpsPendingPhotoFiles[prefix] = file;
        renderCpsScanReview();
    } catch (err) {
        _hideCpsScanOverlay();
        console.error('CPS scan failed:', err);
        UI.toast.error('Scan failed: ' + (err.message || 'Unknown error'));
    }
};

const _buildCpsScanReviewHtml = (rows, rawText) => {
    const statusBadge = (s) => {
        if (s === 'same')       return '<span style="color:#10b981;font-size:11px;font-weight:600;">✓ MATCH</span>';
        if (s === 'fill-empty') return '<span style="color:#7c3aed;font-size:11px;font-weight:600;">+ FILL</span>';
        if (s === 'conflict')   return '<span style="color:#d97706;font-size:11px;font-weight:600;">⚠ CONFLICT</span>';
        if (s === 'no-scan')    return '<span style="color:#9ca3af;font-size:11px;">— blank</span>';
        return '';
    };
    const confBadge = (c) => {
        if (!c) return '';
        const color = c === 'high' ? '#10b981' : c === 'medium' ? '#f59e0b' : '#ef4444';
        return `<span style="display:inline-block;padding:1px 6px;border-radius:10px;background:${color}1a;color:${color};font-size:10px;font-weight:600;text-transform:uppercase;">${c}</span>`;
    };
    const rowBg = (s) => {
        if (s === 'conflict')   return '#fffbeb';
        if (s === 'fill-empty') return '#f5f3ff';
        if (s === 'same')       return '#f0fdf4';
        return '#ffffff';
    };

    return `
        <div style="max-height:60vh;overflow-y:auto;">
            <p style="margin:0 0 14px;color:var(--gray-600);font-size:13px;">
                Review the scanned values below. Tick the ones you want to apply.
                <br><strong style="color:#d97706;">Conflicts</strong> need your explicit pick — nothing will overwrite without your tick.
            </p>

            <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead>
                    <tr style="background:var(--gray-100);text-align:left;">
                        <th style="padding:8px 6px;width:32px;"></th>
                        <th style="padding:8px;">Field</th>
                        <th style="padding:8px;">Currently in form</th>
                        <th style="padding:8px;">Scanned</th>
                        <th style="padding:8px;width:90px;">Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((r, idx) => `
                        <tr style="background:${rowBg(r.status)};border-bottom:1px solid #e5e7eb;">
                            <td style="padding:8px 6px;text-align:center;">
                                ${r.status === 'no-scan' || r.status === 'same' ? '' : `
                                    <input type="checkbox" class="cps-scan-pick" data-idx="${idx}" ${r.defaultChecked ? 'checked' : ''}>
                                `}
                            </td>
                            <td style="padding:8px;font-weight:500;color:var(--gray-700);">${r.label}</td>
                            <td style="padding:8px;color:${r.cur ? 'var(--gray-700)' : 'var(--gray-400)'};">
                                ${r.cur ? escapeHtml(r.cur) : '<em style="font-size:12px;">(empty)</em>'}
                            </td>
                            <td style="padding:8px;color:${r.scn ? 'var(--gray-900)' : 'var(--gray-400)'};">
                                ${r.scn ? escapeHtml(r.scn) : '<em style="font-size:12px;">(blank)</em>'}
                                ${r.conf ? ' ' + confBadge(r.conf) : ''}
                            </td>
                            <td style="padding:8px;">${statusBadge(r.status)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">
                <button type="button" class="btn secondary btn-sm" onclick="app.toggleCpsScanAll(true)">
                    <i class="fas fa-check-square"></i> Tick all available
                </button>
                <button type="button" class="btn secondary btn-sm" onclick="app.toggleCpsScanAll(false)">
                    <i class="far fa-square"></i> Untick all
                </button>
            </div>

            ${rawText ? `
                <details style="margin-top:14px;font-size:12px;color:var(--gray-500);">
                    <summary style="cursor:pointer;">Show raw OCR text</summary>
                    <pre style="white-space:pre-wrap;background:var(--gray-100);padding:10px;border-radius:6px;margin-top:6px;font-size:11px;max-height:160px;overflow:auto;">${escapeHtml(rawText)}</pre>
                </details>
            ` : ''}
        </div>
    `;
};

const renderCpsScanReview = () => {
    if (!_cpsScanCache) return;
    const { scanned, confidence, current, rawText } = _cpsScanCache;

    const norm = v => (v == null ? '' : String(v).trim());
    const isEmpty = v => norm(v) === '';

    const rows = CPS_SCAN_FIELD_MAP.map(([key, suffix, label]) => {
        const cur = norm(current[key]);
        const scn = norm(scanned[key]);
        const conf = confidence[key] || null;

        let status, defaultChecked;
        if (isEmpty(scn)) {
            status = 'no-scan';
            defaultChecked = false;
        } else if (isEmpty(cur)) {
            status = 'fill-empty';
            defaultChecked = true; // auto-fill empty fields
        } else if (cur.toLowerCase() === scn.toLowerCase()) {
            status = 'same';
            defaultChecked = false; // already matches — no change needed
        } else {
            status = 'conflict';
            defaultChecked = false; // agent must explicitly pick
        }

        return { key, suffix, label, cur, scn, conf, status, defaultChecked };
    });

    const html = _buildCpsScanReviewHtml(rows, rawText);

    _showCpsScanOverlay('Review Scanned Form', html, [
        { type: 'secondary', label: 'Cancel', action: 'app._hideCpsScanOverlay()' },
        { type: 'primary',   label: 'Apply Selected', action: 'app.applyCpsScanSelection()' },
    ]);
};

const toggleCpsScanAll = (checked) => {
    document.querySelectorAll('.cps-scan-pick').forEach(cb => { cb.checked = !!checked; });
};

const applyCpsScanSelection = async () => {
    if (!_cpsScanCache) { _hideCpsScanOverlay(); return; }
    const { prefix, scanned, prospectId } = _cpsScanCache;
    const dbTarget = prefix === '__prospect_row__';

    const picked = Array.from(document.querySelectorAll('.cps-scan-pick:checked'))
        .map(cb => parseInt(cb.dataset.idx, 10))
        .filter(n => !isNaN(n));

    let applied = 0;
    if (dbTarget) {
        // Write directly to the prospect record (Upload CPS button flow)
        const patch = {};
        picked.forEach(idx => {
            const row = CPS_SCAN_FIELD_MAP[idx] || [];
            const key = row[0];
            const dbCol = row[3];
            if (!key || !dbCol) return;
            const val = scanned[key];
            if (val == null || String(val).trim() === '') return;
            patch[dbCol] = String(val).trim();
            applied++;
        });
        if (applied > 0 && prospectId) {
            try {
                await AppDataStore.update('prospects', prospectId, patch);
            } catch (err) {
                UI.toast.error('Failed to save fields: ' + (err.message || err));
                applied = 0;
            }
        }
    } else {
        // Form-target: write into the open modal's form fields
        picked.forEach(idx => {
            const [key, suffix] = CPS_SCAN_FIELD_MAP[idx] || [];
            if (!key) return;
            const val = scanned[key];
            if (val == null || String(val).trim() === '') return;
            _writeCpsField(prefix, suffix, String(val).trim());
            applied++;
        });
    }

    _hideCpsScanOverlay();
    _cpsScanCache = null;
    if (applied > 0) {
        const tail = dbTarget ? 'to prospect record.' : 'from scan. Please review before saving.';
        UI.toast.success(`Applied ${applied} field${applied === 1 ? '' : 's'} ${tail}`);
    } else {
        UI.toast.info('No fields were applied.');
    }
};

    app.register('cps', {
        _refreshNotifBadge,
        _buildNotifPanel,
        toggleNotifPanel,
        _initNotifBell,
        getViewPhase,
        calculateCustomerHealthScore,
        renderHealthBadge,
        renderQuickHealthBadge,
        showBookingSettingsView,
        openAddSlotModal,
        saveBookingSlot,
        deleteBookingSlot,
        toggleSlotActive,
        copyBookingLink,
        openShareBookingLinkModal,
        updateShareLinkPreview,
        copySmartBookingLink,
        confirmBookingAppointment,
        cancelBookingAppointment,
        openShareCpsIntakeLinkModal,
        saveCpsIntakeLink,
        copyCpsIntakeLink,
        shareCpsIntakeWhatsApp,
        renderPendingCpsIntakes,
        openApproveCpsIntakeModal,
        rejectCpsIntake,
        _readCpsField,
        _writeCpsField,
        _uploadCpsFormFile,
        _showCpsScanOverlay,
        _hideCpsScanOverlay,
        openCpsPasteModal,
        _parseMalaysianIc,
        parseCpsPastedText,
        scanCpsForm,
        handleCpsScanFile,
        renderCpsScanReview,
        toggleCpsScanAll,
        applyCpsScanSelection,
    });
})();