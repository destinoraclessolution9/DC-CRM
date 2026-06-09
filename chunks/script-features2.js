/**
 * CRM Lazy Chunk: Mobile App Init + Scoring + Features bundle
 * Covers: initMobileApp, Auto-scoring rules, Protection period extension,
 *   Prospect potential, Birthday workflows, KPI targets, Special programs.
 * Extracted 2026-06-05 (~1596 lines).
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
    const isTeamLeaderOrAbove  = (u) => _utils.isTeamLeaderOrAbove(u || _state.cu);
    const _getUserLevel        = (u) => _utils.getUserLevel(u);
    const navigateTo           = (v) => window.app.navigateTo(v);
    // computeNineMethodStatuses / computeFourPillarStatuses live in script-performance.js.
    // Ensure that chunk is loaded before calling them (milestones view may load features2
    // before performance). Falls back to empty objects so the view degrades gracefully.
    const computeNineMethodStatuses = async (...a) => {
        if (!window.app.computeNineMethodStatuses) {
            await (window._loadChunk ? window._loadChunk('chunks/script-performance.min.js') : Promise.resolve());
        }
        return (window.app.computeNineMethodStatuses || (() => Promise.resolve({})))(...a);
    };
    const computeFourPillarStatuses = async (...a) => {
        if (!window.app.computeFourPillarStatuses) {
            await (window._loadChunk ? window._loadChunk('chunks/script-performance.min.js') : Promise.resolve());
        }
        return (window.app.computeFourPillarStatuses || (() => Promise.resolve({})))(...a);
    };
    let _currentUser = _state.cu;
    window._syncFeatures2User = () => { _currentUser = _state.cu; };


// ========== PHASE 18: MOBILE APP & OFFLINE SYNC ==========
const initMobileApp = async () => {
    if (!isMobile()) return;

    try {
        // Initializing Phase 18 mobile features

        // 1. Initialize Offline Storage & Sync
        if (typeof SyncManager !== 'undefined') {
            await SyncManager.init();
        }

        // 2. Setup Push Notifications
        if (typeof PushNotifications !== 'undefined') {
            const pushSupport = await PushNotifications.checkSupport();
            if (pushSupport) {
                await PushNotifications.requestPermission();
            }
        }

        // 3. Register Service Worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./service-worker.js')
                .then(() => {})
                .catch(err => console.error('Service Worker sync failed', err));
        }

        // 4. Add meta tags for PWA
        (window.app.addMobileMetaTags || (() => {}))();

        // Phase 18 mobile features initialized
    } catch (error) {
        console.error('Error initializing mobile features:', error);
    }
};

const addMobileMetaTags = () => {
    const head = document.head;
    if (!document.querySelector('meta[name="theme-color"]')) {
        const metaTheme = document.createElement('meta');
        metaTheme.name = 'theme-color';
        metaTheme.content = '#2563eb';
        head.appendChild(metaTheme);
    }
    if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
        const metaApple = document.createElement('meta');
        metaApple.name = 'apple-mobile-web-app-capable';
        metaApple.content = 'yes';
        head.appendChild(metaApple);
    }
};

const refreshPipelineCalculations = async () => {
    UI.toast.info('Recalculating pipeline...');
    setTimeout(async () => {
        await (window.app.refreshPipeline || (() => {}))();
    }, 500);
};

const filterPipeline = async () => {
    // Redraw with current filter value
    await (window.app.refreshPipeline || (() => {}))();
};

const saveFocusOrder = async () => {
    // Placeholder for compatibility if called from HTML
    await (window.app.saveManualOrder || (() => {}))();
};

const showAddToFocusModal = () => {
    UI.toast.info('Select a prospect from the System Pipeline below to add to your Focus List.');
};

const openPrerequisiteConfig = () => {
    UI.toast.info('Opening prerequisite configuration (Marketing Manager only)');
};

// ========== FEATURE: AUTOMATED SCORING RULES ==========
const SCORING_RULES = {
    CREATE_PROSPECT: 5,
    FIRST_CONTACT: 10,
    CPS_ACTIVITY: 10,
    FTF_MEETING: 10,
    FSA_CONSULTATION: 25,
    GR_GROUP_REVIEW: 15,
    SITE_VISIT: 15,
    CALL: 5,
    WHATSAPP: 5,
    EVENT_ATTENDANCE: 10,
    PRICE_INQUIRY: 30,
    HEARD_LIFE_PLAN: 40,
    REFERRAL_CLOSED: 50,
    WEEKLY_INACTIVITY: -5,
    MARK_NOT_INTERESTED: -500
};

// Audit-log threshold for score_history. Activities that fire on every
// CPS/Call/WhatsApp/event-attendance (±5..±10 points) generate >80% of the
// write volume but carry the least audit value. The Postgres trigger
// log_score_change_trigger (migrations/server_cron_2026-05-03.sql) covers
// every change atomically; this client-side write is now a redundant
// backup that we only keep for high-signal events while the trigger rolls
// out. Once every environment has the trigger applied, this constant can
// be raised to Infinity (effectively disabling client-side logging).
const _SCORE_HISTORY_MIN_ABS = 20;

const addScoreToProspect = async (prospectId, points, reason) => {
    if (!prospectId || !points) return;
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;
    const oldScore = prospect.score || 0;
    const newScore = Math.max(0, oldScore + points);
    await AppDataStore.update('prospects', prospectId, { score: newScore });
    if (Math.abs(points) >= _SCORE_HISTORY_MIN_ABS) {
        AppDataStore.create('score_history', {
            entity_type: 'prospect',
            entity_id: prospectId,
            old_score: oldScore,
            new_score: newScore,
            points_change: points,
            reason: reason,
            created_at: new Date().toISOString()
        }).catch(() => {});
    }
};

const addScoreToCustomer = async (customerId, points, reason) => {
    if (!customerId || !points) return;
    const customer = await AppDataStore.getById('customers', customerId);
    if (!customer) return;
    const oldScore = customer.score || 0;
    const newScore = Math.max(0, oldScore + points);
    await AppDataStore.update('customers', customerId, { score: newScore });
    if (Math.abs(points) >= _SCORE_HISTORY_MIN_ABS) {
        AppDataStore.create('score_history', {
            entity_type: 'customer',
            entity_id: customerId,
            old_score: oldScore,
            new_score: newScore,
            points_change: points,
            reason: reason,
            created_at: new Date().toISOString()
        }).catch(() => {});
    }
};

const scoreActivityType = (activityType) => {
    switch (activityType) {
        case 'CPS':     return { points: SCORING_RULES.CPS_ACTIVITY,     reason: 'CPS - Consultation/Planning Session' };
        case 'FTF':     return { points: SCORING_RULES.FTF_MEETING,       reason: 'Face to Face Meeting' };
        case 'FSA':     return { points: SCORING_RULES.FSA_CONSULTATION,  reason: 'Feng Shui Analysis (Consultation)' };
        case 'GR':      return { points: SCORING_RULES.GR_GROUP_REVIEW,   reason: 'Group Review' };
        case 'SITE':    return { points: SCORING_RULES.SITE_VISIT,        reason: 'Site Visit' };
        case 'XG':      return { points: SCORING_RULES.FTF_MEETING,       reason: 'Xin Gua Session' };
        case 'Call':    return { points: SCORING_RULES.CALL,              reason: 'Phone Call' };
        case 'WhatsApp':return { points: SCORING_RULES.WHATSAPP,          reason: 'WhatsApp Chat' };
        case 'EVENT':   return { points: SCORING_RULES.EVENT_ATTENDANCE,  reason: 'Event Attendance' };
        default:        return { points: 5, reason: `Activity: ${activityType}` };
    }
};

const applyActivityScoring = async (activity) => {
    const { points, reason } = scoreActivityType(activity.activity_type);

    if (activity.prospect_id) {
        // First contact bonus — awarded once, when the prospect's score has never been touched by an activity
        try {
            const existingActs = await AppDataStore.getActivitiesForProspect(activity.prospect_id, { limit: 2 });
            const isFirst = existingActs.filter(a => String(a.id) !== String(activity.id)).length === 0;
            if (isFirst) {
                await addScoreToProspect(activity.prospect_id, SCORING_RULES.FIRST_CONTACT, 'First contact made');
            }
        } catch (e) { /* ignore */ }
        await addScoreToProspect(activity.prospect_id, points, reason);
    } else if (activity.customer_id) {
        await addScoreToCustomer(activity.customer_id, points, reason);
    }

    // Bonus scoring for closing/transaction
    if (activity.is_closing && activity.amount_closed) {
        const txPoints = Math.round(parseFloat(activity.amount_closed) / 100);
        if (activity.prospect_id) {
            await addScoreToProspect(activity.prospect_id, txPoints, `Transaction closed: RM ${activity.amount_closed}`);
            // Referral bonus: if this prospect was referred by another prospect, reward the referrer
            try {
                const closedP = await AppDataStore.getById('prospects', activity.prospect_id);
                if (closedP?.referred_by_id && closedP?.referred_by_type === 'prospect') {
                    await addScoreToProspect(closedP.referred_by_id, SCORING_RULES.REFERRAL_CLOSED,
                        `Referral converted: ${closedP.full_name || 'Prospect #' + activity.prospect_id}`);
                }
            } catch (e) { /* ignore */ }
        } else if (activity.customer_id) {
            await addScoreToCustomer(activity.customer_id, txPoints, `Transaction closed: RM ${activity.amount_closed}`);
        }
    }
};

// Weekly inactivity deduction — runs once per ISO week per browser session.
// Prospects with no activity in 7+ days lose 5 points (excludes unable_to_serve / converted / lost).
const _runWeeklyInactivityCheck = async () => {
    const getISOWeek = (d) => {
        const dt = new Date(d); dt.setHours(0, 0, 0, 0);
        dt.setDate(dt.getDate() + 3 - (dt.getDay() + 6) % 7);
        const w1 = new Date(dt.getFullYear(), 0, 4);
        return `${dt.getFullYear()}-W${String(1 + Math.round(((dt - w1) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7)).padStart(2, '0')}`;
    };
    const thisWeek = getISOWeek(new Date());
    if (localStorage.getItem('_inactivityCheckWeek') === thisWeek) return;
    try {
        const prospects = await AppDataStore.getAll('prospects');
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        let count = 0;
        for (const p of prospects) {
            if (p.unable_to_serve || p.status === 'converted' || p.status === 'lost') continue;
            const lastAct = p.last_activity_date;
            if (!lastAct || lastAct < cutoff) {
                await addScoreToProspect(p.id, SCORING_RULES.WEEKLY_INACTIVITY, 'Weekly inactivity — no activity for 7+ days');
                count++;
            }
        }
        localStorage.setItem('_inactivityCheckWeek', thisWeek);
        if (count > 0) console.log(`[Scoring] Weekly inactivity applied to ${count} prospects`);
    } catch (e) { console.warn('[Scoring] Weekly inactivity check failed:', e); }
};

// Manual score adjustment modal — agents/admins can add or deduct points with a reason.
const openScoreAdjustmentModal = async (entityType, entityId) => {
    const tableName = entityType === 'prospect' ? 'prospects' : 'customers';
    const entity = await AppDataStore.getById(tableName, entityId);
    if (!entity) { UI.toast.error('Record not found'); return; }
    const currentScore = entity.score || 0;
    const grade = (window.app.getScoreGrade || (() => ({ grade:"N/A",label:"N/A",color:"#888" })))(currentScore);
    const presets = [
        { label: '— Select a quick preset —', pts: '' },
        { label: 'Customer Satisfied (+20)', pts: 20 },
        { label: `Price Inquiry Discussed (+${SCORING_RULES.PRICE_INQUIRY})`, pts: SCORING_RULES.PRICE_INQUIRY },
        { label: `Life Plan Shared (+${SCORING_RULES.HEARD_LIFE_PLAN})`, pts: SCORING_RULES.HEARD_LIFE_PLAN },
        { label: `Referral Closed Bonus (+${SCORING_RULES.REFERRAL_CLOSED})`, pts: SCORING_RULES.REFERRAL_CLOSED },
        { label: 'Customer Complaint (−20)', pts: -20 },
        { label: 'No-show / Cancelled (−10)', pts: -10 },
        { label: 'Custom (enter below)', pts: '' },
    ];
    const content = `
        <div>
            <div style="background:var(--gray-50);border-radius:8px;padding:10px 14px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;font-size:14px;">
                <strong>${escapeHtml(entity.full_name)}</strong>
                <span style="font-weight:700;color:var(--primary);">${currentScore} pts &nbsp;·&nbsp; Grade ${grade}</span>
            </div>
            <div class="form-group">
                <label>Quick Presets</label>
                <select id="score-adj-preset" class="form-control" onchange="(function(s){const v=s.options[s.selectedIndex]?.dataset.pts;if(v!==''&&v!==undefined){document.getElementById('score-adj-points').value=v;}})(this)">
                    ${presets.map(p => `<option data-pts="${p.pts}">${p.label}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>Points adjustment <span style="color:var(--gray-400);font-size:12px;">(positive = add, negative = deduct)</span></label>
                <input type="number" id="score-adj-points" class="form-control" placeholder="e.g. 20 or -15">
            </div>
            <div class="form-group">
                <label>Reason / Note <span style="color:#ef4444;">*</span></label>
                <input type="text" id="score-adj-note" class="form-control" placeholder="e.g. Customer satisfied with feng shui analysis" maxlength="200">
            </div>
        </div>`;
    UI.showModal(`Adjust Score — ${escapeHtml(entity.full_name)}`, content, [
        { label: 'Apply', type: 'primary',   action: `app.confirmScoreAdjustment('${entityType}', ${entityId})` },
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }
    ]);
};

const confirmScoreAdjustment = async (entityType, entityId) => {
    const rawPts = document.getElementById('score-adj-points')?.value;
    const pts = parseInt(rawPts);
    const note = document.getElementById('score-adj-note')?.value?.trim();
    if (!rawPts || isNaN(pts) || pts === 0) { UI.toast.error('Enter a non-zero point value.'); return; }
    if (!note) { UI.toast.error('A reason is required.'); return; }
    try {
        if (entityType === 'prospect') {
            await addScoreToProspect(entityId, pts, `[Manual] ${note}`);
            UI.hideModal();
            UI.toast.success(`Score ${pts > 0 ? '+' : ''}${pts} pts applied`);
            await (window.app.showProspectDetail || (() => {}))(entityId);
        } else {
            await addScoreToCustomer(entityId, pts, `[Manual] ${note}`);
            UI.hideModal();
            UI.toast.success(`Score ${pts > 0 ? '+' : ''}${pts} pts applied`);
        }
    } catch (e) { UI.toast.error('Failed: ' + (e.message || 'Unknown error')); }
};

// ========== FEATURE: PROTECTION PERIOD AUTO-EXTENSION ==========
const PROTECTION_EXTENSIONS = {
    ACTIVITY: 15,
    CONSULTATION: 30,
    TRANSACTION: 90,
    EVENT: 10
};

const autoExtendProtection = async (prospectId, extensionType) => {
    if (!prospectId) return;
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;

    let days = PROTECTION_EXTENSIONS.ACTIVITY;
    let label = 'activity';
    if (extensionType === 'consultation') {
        days = PROTECTION_EXTENSIONS.CONSULTATION;
        label = 'consultation';
    } else if (extensionType === 'transaction') {
        days = PROTECTION_EXTENSIONS.TRANSACTION;
        label = 'transaction';
    } else if (extensionType === 'event') {
        days = PROTECTION_EXTENSIONS.EVENT;
        label = 'event attendance';
    }

    const currentDeadline = new Date(prospect.protection_deadline || Date.now());
    const today = new Date();
    const baseDate = currentDeadline > today ? currentDeadline : today;
    const newDeadline = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    await AppDataStore.update('prospects', prospectId, {
        protection_deadline: newDeadline,
        last_contact_date: new Date().toISOString().split('T')[0]
    });
    // Protection auto-extended
};

const getExtensionType = (activityType) => {
    if (['FSA', 'GR'].includes(activityType)) return 'consultation';
    if (['EVENT'].includes(activityType)) return 'event';
    return 'activity';
};

// ========== FEATURE: PROSPECT POTENTIAL & OPPORTUNITIES ==========
const openLatestMeetupNotes = async (prospectId) => {
    const allActivities = (await AppDataStore.getAll('activities'))
        .filter(a => a.prospect_id == prospectId)
        .sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date) || b.id - a.id);
    if (allActivities.length === 0) {
        UI.toast.error('No activities found. Log a meetup or event first.');
        return;
    }
    await (window.app.openPostMeetupNotesModal || (() => {}))(allActivities[0].id, prospectId);
};

const openEditPotentialModal = async (prospectId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;

    const content = `
        <div class="form-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div class="form-group">
                <label>Potential Level</label>
                <select id="pot-level" class="form-control">
                    <option value="High" ${prospect.potential_level === 'High' ? 'selected' : ''}>HIGH POTENTIAL</option>
                    <option value="Medium" ${prospect.potential_level === 'Medium' ? 'selected' : ''}>MEDIUM POTENTIAL</option>
                    <option value="Low" ${prospect.potential_level === 'Low' ? 'selected' : ''}>LOW POTENTIAL</option>
                </select>
            </div>
            <div class="form-group">
                <label>Close Probability (%)</label>
                <input type="number" id="pot-probability" class="form-control" min="0" max="100" value="${prospect.close_probability || 0}">
            </div>
            <div class="form-group">
                <label>Est. Value Min (RM)</label>
                <input type="number" id="pot-value-min" class="form-control" value="${prospect.estimated_value_min || 0}">
            </div>
            <div class="form-group">
                <label>Est. Value Max (RM)</label>
                <input type="number" id="pot-value-max" class="form-control" value="${prospect.estimated_value_max || 0}">
            </div>
            <div class="form-group" style="grid-column:1/3;">
                <label>Decision Timeline</label>
                <input type="text" id="pot-timeline" class="form-control" placeholder="e.g. Within 1 month" value="${prospect.decision_timeline || ''}">
            </div>
            <div class="form-group" style="grid-column:1/3;">
                <label>Pain Points</label>
                <textarea id="pot-pain" class="form-control" rows="2" placeholder="e.g. Declining revenue, team morale">${prospect.pain_points || ''}</textarea>
            </div>
            <div class="form-group" style="grid-column:1/3;">
                <label>Interests</label>
                <input type="text" id="pot-interests" class="form-control" placeholder="e.g. PR4, Office Audit, Career Consultation" value="${prospect.interests || ''}">
            </div>
            <div class="form-group">
                <label>Decision Maker?</label>
                <select id="pot-decision-maker" class="form-control">
                    <option value="yes" ${prospect.decision_maker === 'yes' ? 'selected' : ''}>Yes</option>
                    <option value="no" ${prospect.decision_maker === 'no' ? 'selected' : ''}>No</option>
                    <option value="unknown" ${(!prospect.decision_maker || prospect.decision_maker === 'unknown') ? 'selected' : ''}>Unknown</option>
                </select>
            </div>
            <div class="form-group">
                <label>Budget Range</label>
                <input type="text" id="pot-budget" class="form-control" placeholder="e.g. RM 15k-20k/mo" value="${prospect.budget_range || ''}">
            </div>
        </div>
    `;
    UI.showModal('Edit Potential & Opportunities', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Save', type: 'primary', action: `(async () => { await app.savePotential(${prospectId}); })()` }
    ]);
};

const savePotential = async (prospectId) => {
    const data = {
        potential_level: document.getElementById('pot-level')?.value || 'Medium',
        close_probability: parseInt(document.getElementById('pot-probability')?.value) || 0,
        estimated_value_min: parseFloat(document.getElementById('pot-value-min')?.value) || 0,
        estimated_value_max: parseFloat(document.getElementById('pot-value-max')?.value) || 0,
        decision_timeline: document.getElementById('pot-timeline')?.value || '',
        pain_points: document.getElementById('pot-pain')?.value || '',
        interests: document.getElementById('pot-interests')?.value || '',
        decision_maker: document.getElementById('pot-decision-maker')?.value || 'unknown',
        budget_range: document.getElementById('pot-budget')?.value || ''
    };
    await AppDataStore.update('prospects', prospectId, data);
    UI.hideModal();
    UI.toast.success('Potential & Opportunities updated');
    await (window.app.showProspectDetail || (() => {}))(prospectId);
};

// ========== FEATURE: BIRTHDAY ACTION WORKFLOWS ==========
const sendBirthdayWish = async (personName, phone) => {
    const templates = await AppDataStore.getAll('whatsapp_templates');
    const bdayTemplate = templates.find(t => t.template_name?.toLowerCase().includes('birthday'));
    const message = bdayTemplate
        ? bdayTemplate.content.replace(/\{\{name\}\}/g, personName)
        : `Hi ${personName}, Happy Birthday! 🎂 Wishing you a wonderful day filled with joy and blessings. — From the DestinOracles Team`;

    UI.showModal('Send Birthday Wish', `
        <div class="form-group">
            <label>To: ${personName}</label>
            <input type="text" class="form-control" value="${phone || ''}" readonly>
        </div>
        <div class="form-group">
            <label>Message</label>
            <textarea id="bday-msg" class="form-control" rows="5">${message}</textarea>
        </div>
        <div class="form-group">
            <label>Channel</label>
            <select id="bday-channel" class="form-control">
                <option value="whatsapp">WhatsApp</option>
                <option value="sms">SMS</option>
                <option value="call">Phone Call</option>
            </select>
        </div>
    `, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Send', type: 'primary', action: `(async () => { UI.hideModal(); UI.toast.success('Birthday wish sent to ${personName} via ' + document.getElementById('bday-channel').value); })()` }
    ]);
};

const scheduleBirthdayFollowup = async (personName, entityId, entityType) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];

    UI.showModal('Schedule Birthday Follow-up', `
        <div class="form-group">
            <label>For: ${personName}</label>
        </div>
        <div class="form-group">
            <label>Action Type</label>
            <select id="bday-action-type" class="form-control">
                <option value="gift">Prepare Birthday Gift</option>
                <option value="call">Schedule Follow-up Call</option>
                <option value="meeting">Schedule Birthday Meeting</option>
                <option value="task">Create General Task</option>
            </select>
        </div>
        <div class="form-group">
            <label>Date</label>
            <input type="date" id="bday-action-date" class="form-control" value="${dateStr}">
        </div>
        <div class="form-group">
            <label>Notes</label>
            <textarea id="bday-action-notes" class="form-control" rows="2" placeholder="e.g. Prepare fruit basket, call to wish..."></textarea>
        </div>
    `, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Create', type: 'primary', action: `(async () => { await app.executeBirthdayAction('${personName}', ${entityId}, '${entityType || 'prospect'}'); })()` }
    ]);
};

const executeBirthdayAction = async (personName, entityId, entityType) => {
    const actionType = document.getElementById('bday-action-type')?.value || 'task';
    const actionDate = document.getElementById('bday-action-date')?.value || new Date().toISOString().split('T')[0];
    const notes = document.getElementById('bday-action-notes')?.value || '';

    if (actionType === 'call' || actionType === 'meeting') {
        const activity = {
            activity_type: actionType === 'call' ? 'Call' : 'FTF',
            activity_date: actionDate,
            start_time: '10:00',
            end_time: '10:30',
            activity_title: `Birthday follow-up with ${personName}`,
            lead_agent_id: _currentUser?.id || 5,
            discussion_summary: `Birthday follow-up. ${notes}`
        };
        if (entityType === 'prospect') activity.prospect_id = entityId;
        else activity.customer_id = entityId;
        const savedBdayActivity = await AppDataStore.create('activities', activity);
        UI.hideModal();
        UI.toast.success(`${actionType === 'call' ? 'Call' : 'Meeting'} scheduled for ${personName} on ${actionDate}`);

    } else {
        // Create as a note/task
        await AppDataStore.create('notes', {
            entity_type: entityType,
            entity_id: entityId,
            content: `[Birthday ${actionType === 'gift' ? 'Gift' : 'Task'}] ${personName} — ${notes || 'Prepare birthday follow-up'}`,
            created_by: _currentUser?.id || 5,
            created_at: new Date().toISOString(),
            due_date: actionDate
        });
        UI.hideModal();
        UI.toast.success(`Birthday ${actionType} created for ${personName}`);
    }
};

// ========== FEATURE: KPI HIERARCHICAL TARGETS ==========
const openKPITargetsModal = async () => {
    const currentYear = new Date().getFullYear();
    const existing = (await AppDataStore.getAll('yearly_targets')).find(t => t.target_year === currentYear);
    const allQ = (await AppDataStore.getAll('quarterly_targets')).filter(t => t.year === currentYear);
    const getQ = (q, field) => { const qt = allQ.find(t => t.quarter === q); return qt?.[field] || ''; };

    const qRow = (label, field, qkey) => `
        <tr style="border-bottom:1px solid var(--gray-200);">
            <td style="padding:5px 8px; font-size:12px; white-space:nowrap;">${label}</td>
            ${[1,2,3,4].map(q => `<td style="padding:4px;"><input type="number" id="qt-q${q}-${qkey}" class="form-control" style="min-width:80px; font-size:12px; padding:4px 6px;" placeholder="auto" value="${getQ(q, field)}"></td>`).join('')}
        </tr>`;

    const content = `
        <div style="max-height:75vh; overflow-y:auto; padding-right:4px;">
            <h3 style="margin-bottom:12px;">Yearly Targets — ${currentYear}</h3>
            <div class="form-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <div class="form-group"><label>CPS Count Target</label>
                    <input type="number" id="yt-cps" class="form-control" value="${existing?.cps_count_target || 840}"></div>
                <div class="form-group"><label>Total Sales Target (RM)</label>
                    <input type="number" id="yt-sales" class="form-control" value="${existing?.total_sales_target || 1680000}"></div>
                <div class="form-group"><label>POP Case Target</label>
                    <input type="number" id="yt-pop-count" class="form-control" value="${existing?.pop_case_count_target || 120}"></div>
                <div class="form-group"><label>POP Sales Target (RM)</label>
                    <input type="number" id="yt-pop-sales" class="form-control" value="${existing?.pop_sales_target || 480000}"></div>
                <div class="form-group"><label>EPP Case Target</label>
                    <input type="number" id="yt-epp-count" class="form-control" value="${existing?.epp_case_count_target || 80}"></div>
                <div class="form-group"><label>EPP Sales Target (RM)</label>
                    <input type="number" id="yt-epp-sales" class="form-control" value="${existing?.epp_sales_target || 320000}"></div>
                <div class="form-group"><label>New Agents Target</label>
                    <input type="number" id="yt-agents" class="form-control" value="${existing?.new_agents_target || 48}"></div>
                <div class="form-group"><label>New Customers Target</label>
                    <input type="number" id="yt-customers" class="form-control" value="${existing?.new_customers_target || 360}"></div>
                <div class="form-group"><label>Total Meetings Target</label>
                    <input type="number" id="yt-meetings" class="form-control" value="${existing?.total_meetings_target || 2000}"></div>
                <div class="form-group"><label>Activity Headcount Target</label>
                    <input type="number" id="yt-headcount" class="form-control" value="${existing?.activity_headcount_target || 500}"></div>
            </div>
            <hr style="margin:16px 0; border:none; border-top:1px solid var(--gray-200);">
            <h3 style="margin-bottom:4px;">Quarterly Targets — ${currentYear}</h3>
            <p style="font-size:12px; color:var(--gray-500); margin-bottom:10px;">Set per-quarter values manually, or leave blank to auto-calculate from yearly targets × seasonal weights below.</p>
            <div style="overflow-x:auto;">
                <table style="width:100%; border-collapse:collapse;">
                    <thead>
                        <tr style="background:var(--gray-100);">
                            <th scope="col" style="text-align:left; padding:6px 8px; font-size:12px; font-weight:600;">Metric</th>
                            <th scope="col" style="text-align:center; padding:6px 8px; font-size:12px; font-weight:600;">Q1</th>
                            <th scope="col" style="text-align:center; padding:6px 8px; font-size:12px; font-weight:600;">Q2</th>
                            <th scope="col" style="text-align:center; padding:6px 8px; font-size:12px; font-weight:600;">Q3</th>
                            <th scope="col" style="text-align:center; padding:6px 8px; font-size:12px; font-weight:600;">Q4</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${qRow('CPS Count', 'cps_count_target', 'cps')}
                        ${qRow('Total Sales (RM)', 'total_sales_target', 'sales')}
                        ${qRow('POP Case', 'pop_case_count_target', 'pop-count')}
                        ${qRow('POP Sales (RM)', 'pop_sales_target', 'pop-sales')}
                        ${qRow('EPP Case', 'epp_case_count_target', 'epp-count')}
                        ${qRow('EPP Sales (RM)', 'epp_sales_target', 'epp-sales')}
                        ${qRow('New Agents', 'new_agents_target', 'agents')}
                        ${qRow('New Customers', 'new_customers_target', 'customers')}
                        ${qRow('Total Meetings', 'total_meetings_target', 'meetings')}
                        ${qRow('Activity Headcount', 'activity_headcount_target', 'headcount')}
                    </tbody>
                </table>
            </div>
            <h3 style="margin:16px 0 8px;">Seasonal Weighting (auto-calc fallback)</h3>
            <p style="font-size:12px; color:var(--gray-500); margin-bottom:8px;">Used only when quarterly fields above are left blank. Must sum to 100%.</p>
            <div class="form-grid" style="display:grid; grid-template-columns:repeat(4,1fr); gap:8px;">
                <div class="form-group"><label>Q1 %</label><input type="number" id="yt-q1w" class="form-control" value="${existing?.q1_weight || 22}"></div>
                <div class="form-group"><label>Q2 %</label><input type="number" id="yt-q2w" class="form-control" value="${existing?.q2_weight || 25}"></div>
                <div class="form-group"><label>Q3 %</label><input type="number" id="yt-q3w" class="form-control" value="${existing?.q3_weight || 27}"></div>
                <div class="form-group"><label>Q4 %</label><input type="number" id="yt-q4w" class="form-control" value="${existing?.q4_weight || 26}"></div>
            </div>
        </div>
    `;
    UI.showModal('Set KPI Targets', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Save Targets', type: 'primary', action: `(async () => { await app.saveKPITargets(${currentYear}); })()` }
    ]);
};

const saveKPITargets = async (year) => {
    const d = (id) => parseFloat(document.getElementById(id)?.value) || 0;
    const weights = [d('yt-q1w'), d('yt-q2w'), d('yt-q3w'), d('yt-q4w')];
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    // Only enforce weight sum if weights are being used (non-zero)
    if (totalWeight > 0 && Math.abs(totalWeight - 100) > 1) {
        UI.toast.error(`Quarter weights must sum to 100% (currently ${totalWeight}%)`);
        return;
    }
    const effectiveWeights = totalWeight > 0 ? weights : [25, 25, 25, 25];

    const yearlyData = {
        target_year: year,
        cps_count_target: d('yt-cps'),
        total_sales_target: d('yt-sales'),
        pop_case_count_target: d('yt-pop-count'),
        pop_sales_target: d('yt-pop-sales'),
        epp_case_count_target: d('yt-epp-count'),
        epp_sales_target: d('yt-epp-sales'),
        new_agents_target: d('yt-agents'),
        new_customers_target: d('yt-customers'),
        total_meetings_target: d('yt-meetings'),
        activity_headcount_target: d('yt-headcount'),
        q1_weight: effectiveWeights[0],
        q2_weight: effectiveWeights[1],
        q3_weight: effectiveWeights[2],
        q4_weight: effectiveWeights[3],
        created_at: new Date().toISOString()
    };

    // Save or update yearly target
    const existing = (await AppDataStore.getAll('yearly_targets')).find(t => t.target_year === year);
    if (existing) {
        await AppDataStore.update('yearly_targets', existing.id, yearlyData);
    } else {
        yearlyData.id = Date.now();
        await AppDataStore.create('yearly_targets', yearlyData);
    }

    // Save quarterly targets — use manual inputs if provided, else auto-calculate from weights
    const metrics = ['cps_count_target', 'total_sales_target', 'pop_case_count_target', 'pop_sales_target', 'epp_case_count_target', 'epp_sales_target', 'new_agents_target', 'new_customers_target', 'total_meetings_target', 'activity_headcount_target'];
    const qkeys = ['cps', 'sales', 'pop-count', 'pop-sales', 'epp-count', 'epp-sales', 'agents', 'customers', 'meetings', 'headcount'];
    for (let q = 1; q <= 4; q++) {
        const w = effectiveWeights[q - 1] / 100;
        const qData = { quarter: q, year: year };
        metrics.forEach((m, i) => {
            const el = document.getElementById(`qt-q${q}-${qkeys[i]}`);
            const manual = el ? parseFloat(el.value) : NaN;
            qData[m] = (!isNaN(manual) && el?.value !== '') ? manual : Math.round(yearlyData[m] * w);
        });
        const existingQ = (await AppDataStore.getAll('quarterly_targets')).find(t => t.quarter === q && t.year === year);
        if (existingQ) {
            await AppDataStore.update('quarterly_targets', existingQ.id, qData);
        } else {
            qData.id = Date.now() + q;
            await AppDataStore.create('quarterly_targets', qData);
        }

        // Auto-generate monthly targets (3 months per quarter, even split)
        for (let m = 0; m < 3; m++) {
            const month = (q - 1) * 3 + m + 1;
            const mData = { month: month, year: year, quarter: q };
            metrics.forEach(met => { mData[met] = Math.round(qData[met] / 3); });
            const existingM = (await AppDataStore.getAll('monthly_targets')).find(t => t.month === month && t.year === year);
            if (existingM) {
                await AppDataStore.update('monthly_targets', existingM.id, mData);
            } else {
                mData.id = Date.now() + q * 10 + m;
                await AppDataStore.create('monthly_targets', mData);
            }
        }
    }

    UI.hideModal();
    UI.toast.success('KPI targets saved — monthly breakdowns auto-generated from quarterly values');
    if (typeof window.app.refreshKPIDashboard === 'function') await window.app.refreshKPIDashboard();
};

// ========== QUARTERLY TARGETS (standalone modal) ==========
const openQuarterlyTargetsModal = async () => {
    const currentYear = new Date().getFullYear();
    const allQ = (await AppDataStore.getAll('quarterly_targets')).filter(t => t.year === currentYear);
    const getQ = (q, field) => { const qt = allQ.find(t => t.quarter === q); return qt?.[field] ?? ''; };

    const qRow = (label, field, qkey) => `
        <tr style="border-bottom:1px solid var(--gray-200);">
            <td style="padding:6px 8px; font-size:12px; white-space:nowrap; font-weight:500;">${label}</td>
            ${[1,2,3,4].map(q => `<td style="padding:4px;"><input type="number" id="qo-q${q}-${qkey}" class="form-control" style="min-width:90px; font-size:12px; padding:5px 7px;" placeholder="0" value="${getQ(q, field)}"></td>`).join('')}
        </tr>`;

    const content = `
        <div style="max-height:70vh; overflow-y:auto; padding-right:4px;">
            <p style="font-size:12px;color:var(--gray-500);margin-bottom:12px;">
                Set per-quarter targets for ${currentYear}. These values override the yearly auto-split.
            </p>
            <div style="overflow-x:auto;">
                <table style="width:100%; border-collapse:collapse; min-width:560px;">
                    <thead>
                        <tr style="background:var(--gray-100);">
                            <th scope="col" style="text-align:left; padding:8px; font-size:12px; font-weight:600;">Metric</th>
                            <th scope="col" style="text-align:center; padding:8px; font-size:12px; font-weight:600;">Q1 (Jan–Mar)</th>
                            <th scope="col" style="text-align:center; padding:8px; font-size:12px; font-weight:600;">Q2 (Apr–Jun)</th>
                            <th scope="col" style="text-align:center; padding:8px; font-size:12px; font-weight:600;">Q3 (Jul–Sep)</th>
                            <th scope="col" style="text-align:center; padding:8px; font-size:12px; font-weight:600;">Q4 (Oct–Dec)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${qRow('CPS Count', 'cps_count_target', 'cps')}
                        ${qRow('Total Sales (RM)', 'total_sales_target', 'sales')}
                        ${qRow('POP Cases', 'pop_case_count_target', 'pop-count')}
                        ${qRow('POP Sales (RM)', 'pop_sales_target', 'pop-sales')}
                        ${qRow('EPP Cases', 'epp_case_count_target', 'epp-count')}
                        ${qRow('EPP Sales (RM)', 'epp_sales_target', 'epp-sales')}
                        ${qRow('New Agents', 'new_agents_target', 'agents')}
                        ${qRow('New Customers', 'new_customers_target', 'customers')}
                        ${qRow('Total Meetings', 'total_meetings_target', 'meetings')}
                        ${qRow('Activity Headcount', 'activity_headcount_target', 'headcount')}
                    </tbody>
                </table>
            </div>
        </div>`;
    UI.showModal(`Set Quarterly Targets — ${currentYear}`, content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Save Quarterly Targets', type: 'primary', action: `(async () => { await app.saveQuarterlyTargets(${currentYear}); })()` }
    ]);
};

const saveQuarterlyTargets = async (year) => {
    const d = (id) => {
        const el = document.getElementById(id);
        if (!el || el.value === '') return null;
        const n = parseFloat(el.value);
        return isNaN(n) ? null : n;
    };
    const metrics = ['cps_count_target', 'total_sales_target', 'pop_case_count_target', 'pop_sales_target', 'epp_case_count_target', 'epp_sales_target', 'new_agents_target', 'new_customers_target', 'total_meetings_target', 'activity_headcount_target'];
    const qkeys = ['cps', 'sales', 'pop-count', 'pop-sales', 'epp-count', 'epp-sales', 'agents', 'customers', 'meetings', 'headcount'];

    for (let q = 1; q <= 4; q++) {
        const qData = { quarter: q, year: year };
        let hasValue = false;
        metrics.forEach((m, i) => {
            const val = d(`qo-q${q}-${qkeys[i]}`);
            if (val !== null) { qData[m] = val; hasValue = true; }
            else { qData[m] = 0; }
        });
        const existingQ = (await AppDataStore.getAll('quarterly_targets')).find(t => t.quarter === q && t.year === year);
        if (existingQ) {
            await AppDataStore.update('quarterly_targets', existingQ.id, qData);
        } else if (hasValue) {
            qData.id = Date.now() + q;
            await AppDataStore.create('quarterly_targets', qData);
        }
    }

    UI.hideModal();
    UI.toast.success(`Quarterly targets saved for ${year}`);
    if (typeof window.app.refreshKPIDashboard === 'function') await window.app.refreshKPIDashboard();
};

// ========== SPECIAL PROGRAM FIGHTING ==========
// Incentive programs for selected agents (e.g. close RM200k in 60 days → China trip)

const _today = () => new Date().toISOString().slice(0, 10);

// Compute one participant's progress toward a program's targets
const calculateProgramProgress = async (program, agentId) => {
    const from = program.start_date;
    const to = program.end_date;
    const [purchases, customers, activities] = await Promise.all([
        AppDataStore.getAll('purchases'),
        AppDataStore.getAll('customers'),
        AppDataStore.getAll('activities')
    ]);
    // Build customer map for agent fallback (old purchases may lack agent_id)
    const customerMap = {};
    customers.forEach(c => { customerMap[c.id] = c; });
    let salesActual = 0;
    for (const p of purchases) {
        const pAgent = p.agent_id || customerMap[p.customer_id]?.responsible_agent_id;
        if (pAgent !== agentId) continue;
        if (p.date < from || p.date > to) continue;
        if (p.is_agent_package) continue;
        salesActual += (p.amount || 0);
    }
    let customersActual = 0;
    for (const c of customers) {
        if (c.responsible_agent_id !== agentId) continue;
        if (!c.customer_since || c.customer_since < from || c.customer_since > to) continue;
        customersActual++;
    }
    let cpsActual = 0;
    for (const a of activities) {
        if (a.activity_type !== 'CPS') continue;
        if (a.lead_agent_id !== agentId) continue;
        if (a.activity_date < from || a.activity_date > to) continue;
        cpsActual++;
    }
    const targets = [];
    if (program.sales_target > 0) {
        targets.push({
            label: 'Total Sales',
            actual: salesActual,
            target: program.sales_target,
            display: `RM ${salesActual.toLocaleString()} / RM ${program.sales_target.toLocaleString()}`,
            pct: Math.min(100, Math.round((salesActual / program.sales_target) * 100))
        });
    }
    if (program.new_customers_target > 0) {
        targets.push({
            label: 'New Customers',
            actual: customersActual,
            target: program.new_customers_target,
            display: `${customersActual} / ${program.new_customers_target}`,
            pct: Math.min(100, Math.round((customersActual / program.new_customers_target) * 100))
        });
    }
    if (program.cps_target > 0) {
        targets.push({
            label: 'CPS Count',
            actual: cpsActual,
            target: program.cps_target,
            display: `${cpsActual} / ${program.cps_target}`,
            pct: Math.min(100, Math.round((cpsActual / program.cps_target) * 100))
        });
    }
    const allHit = targets.length > 0 && targets.every(t => t.actual >= t.target);
    return { targets, qualified: allHit };
};

// Render the Special Programs section on the KPI dashboard
const renderSpecialPrograms = async () => {
    const [programs, allParts, users] = await Promise.all([
        AppDataStore.getAll('special_programs'),
        AppDataStore.getAll('special_program_participants'),
        AppDataStore.getAll('users')
    ]);
    const userMap = {}; users.forEach(u => { userMap[u.id] = u; });
    const active = programs.filter(p => p.status !== 'cancelled' && p.status !== 'deleted');
    active.sort((a, b) => (a.end_date || '').localeCompare(b.end_date || ''));

    const canManage = isTeamLeaderOrAbove(_currentUser);
    const newBtn = canManage
        ? `<button class="btn primary btn-sm" onclick="app.openSpecialProgramModal()"><i class="fas fa-plus"></i> New Program</button>`
        : '';

    if (active.length === 0) {
        return `
            <div class="card" style="padding:20px;border:2px dashed var(--gray-200);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <h3 style="margin:0;">🏆 Special Program Fighting</h3>
                    ${newBtn}
                </div>
                <p style="text-align:center;color:var(--gray-400);padding:24px 0;margin:0;">No active special programs. Create one to launch a new challenge for selected agents.</p>
            </div>`;
    }

    const cards = [];
    for (const program of active) {
        const parts = allParts.filter(p => p.program_id === program.id);
        const today = _today();
        const daysLeft = program.end_date ? Math.max(0, Math.ceil((new Date(program.end_date) - new Date(today)) / 86400000)) : 0;
        const isExpired = program.end_date && today > program.end_date;

        // Calculate progress for each participant (concurrent)
        const partProgress = await Promise.all(parts.map(async (part) => {
            const progress = await calculateProgramProgress(program, part.agent_id);
            return {
                agentId: part.agent_id,
                agentName: userMap[part.agent_id]?.full_name || `Agent #${part.agent_id}`,
                agentRole: userMap[part.agent_id]?.role || '',
                progress
            };
        }));

        // Count how many qualified
        const qualifiedCount = partProgress.filter(p => p.progress.qualified).length;

        const partsHtml = partProgress.length > 0 ? `
            <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:12px;">
                <thead>
                    <tr style="background:var(--gray-50,#f7f4ed);">
                        <th scope="col" style="text-align:left;padding:8px;border-bottom:1px solid var(--gray-200);">Agent</th>
                        ${program.sales_target > 0 ? '<th scope="col" style="text-align:left;padding:8px;border-bottom:1px solid var(--gray-200);">Sales</th>' : ''}
                        ${program.new_customers_target > 0 ? '<th scope="col" style="text-align:left;padding:8px;border-bottom:1px solid var(--gray-200);">New Customers</th>' : ''}
                        ${program.cps_target > 0 ? '<th scope="col" style="text-align:left;padding:8px;border-bottom:1px solid var(--gray-200);">CPS</th>' : ''}
                        <th scope="col" style="text-align:center;padding:8px;border-bottom:1px solid var(--gray-200);">Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${partProgress.map(p => {
                        const barsHtml = (metric) => {
                            const t = p.progress.targets.find(t => t.label === metric);
                            if (!t) return '';
                            const color = t.actual >= t.target ? '#16a34a' : (t.pct >= 60 ? '#f59e0b' : '#dc2626');
                            return `
                                <td style="padding:8px;border-bottom:1px solid var(--gray-100);">
                                    <div style="font-size:11px;margin-bottom:2px;">${t.display}</div>
                                    <div style="background:#eee;border-radius:4px;height:6px;overflow:hidden;">
                                        <div style="background:${color};height:100%;width:${t.pct}%;transition:width .3s;"></div>
                                    </div>
                                </td>`;
                        };
                        const statusBadge = p.progress.qualified
                            ? '<span style="background:#dcfce7;color:#166534;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;">✓ Qualified</span>'
                            : '<span style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:12px;font-size:11px;">In Progress</span>';
                        return `
                            <tr>
                                <td style="padding:8px;border-bottom:1px solid var(--gray-100);"><strong>${p.agentName}</strong><br/><span style="font-size:10px;color:var(--gray-400);">${p.agentRole}</span></td>
                                ${program.sales_target > 0 ? barsHtml('Total Sales') : ''}
                                ${program.new_customers_target > 0 ? barsHtml('New Customers') : ''}
                                ${program.cps_target > 0 ? barsHtml('CPS Count') : ''}
                                <td style="padding:8px;border-bottom:1px solid var(--gray-100);text-align:center;">${statusBadge}</td>
                            </tr>`;
                    }).join('')}
                </tbody>
            </table>` : '<p style="color:var(--gray-400);text-align:center;padding:16px;margin:12px 0 0;">No participants assigned yet.</p>';

        const manageBtns = canManage ? `
            <button class="btn secondary btn-sm" onclick="app.openSpecialProgramModal(${program.id})" title="Edit"><i class="fas fa-edit"></i></button>
            <button class="btn btn-sm" style="background:#fee2e2;color:#991b1b;" onclick="app.deleteSpecialProgram(${program.id})" title="Delete"><i class="fas fa-trash"></i></button>
        ` : '';

        cards.push(`
            <div class="card" style="padding:20px;margin-bottom:16px;${isExpired ? 'opacity:0.75;' : ''}">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
                    <div style="flex:1;">
                        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                            <h3 style="margin:0;font-size:16px;">🏆 ${program.program_name || 'Untitled Program'}</h3>
                            ${isExpired ? '<span style="background:#f3f4f6;color:#6b7280;padding:3px 8px;border-radius:10px;font-size:11px;">EXPIRED</span>' : `<span style="background:#fef3c7;color:#92400e;padding:3px 8px;border-radius:10px;font-size:11px;">${daysLeft} days left</span>`}
                        </div>
                        <div style="font-size:13px;color:var(--gray-500);margin-top:4px;">
                            🎁 <strong>${program.reward || '—'}</strong>
                            &nbsp;·&nbsp; ${program.start_date || '?'} to ${program.end_date || '?'}
                            &nbsp;·&nbsp; ${parts.length} participant${parts.length===1?'':'s'}
                            ${qualifiedCount > 0 ? `&nbsp;·&nbsp; <span style="color:#16a34a;font-weight:600;">${qualifiedCount} qualified</span>` : ''}
                        </div>
                        ${program.description ? `<p style="font-size:12px;color:var(--gray-500);margin:6px 0 0;">${program.description}</p>` : ''}
                    </div>
                    <div style="display:flex;gap:6px;">${manageBtns}</div>
                </div>
                ${partsHtml}
            </div>`);
    }

    return `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
            <h2 style="margin:0;font-size:18px;">🏆 Special Program Fighting</h2>
            ${newBtn}
        </div>
        ${cards.join('')}`;
};

// ===== Special Programs Table (Marketing List tab) =====
// Flat KPI-style table — one row per (program × agent), showing how much they made and how far to target
const renderSpecialProgramsTable = async () => {
    const [programs, allParts, users] = await Promise.all([
        AppDataStore.getAll('special_programs'),
        AppDataStore.getAll('special_program_participants'),
        AppDataStore.getAll('users')
    ]);
    const userMap = {}; users.forEach(u => { userMap[u.id] = u; });
    const active = programs.filter(p => p.status !== 'cancelled' && p.status !== 'deleted');
    active.sort((a, b) => (a.end_date || '').localeCompare(b.end_date || ''));

    const canManage = isTeamLeaderOrAbove(_currentUser);
    const today = _today();

    if (active.length === 0) {
        return `
            <div class="card" style="padding:32px;border:2px dashed var(--gray-200);text-align:center;">
                <h3 style="margin:0 0 8px;">🏆 No Active Special Programs</h3>
                <p style="color:var(--gray-400);margin:0;">${canManage ? 'Click "New Program" to launch a new challenge for selected agents.' : 'No special programs have been launched yet.'}</p>
            </div>`;
    }

    // Build flat rows: one per (program, participant)
    const rows = [];
    for (const program of active) {
        const parts = allParts.filter(p => p.program_id === program.id);
        const isExpired = program.end_date && today > program.end_date;
        const daysLeft = program.end_date ? Math.max(0, Math.ceil((new Date(program.end_date) - new Date(today)) / 86400000)) : 0;

        if (parts.length === 0) {
            rows.push({
                program, isExpired, daysLeft,
                agentName: '—', agentRole: '',
                progress: { targets: [], qualified: false },
                noParticipants: true
            });
            continue;
        }
        for (const part of parts) {
            const progress = await calculateProgramProgress(program, part.agent_id);
            rows.push({
                program, isExpired, daysLeft,
                agentId: part.agent_id,
                agentName: userMap[part.agent_id]?.full_name || `Agent #${part.agent_id}`,
                agentRole: userMap[part.agent_id]?.role || '',
                progress
            });
        }
    }

    const fmtRM = (n) => 'RM ' + (Number(n) || 0).toLocaleString();
    const cell = (t) => {
        if (!t) return '<td style="padding:10px;color:var(--gray-300);text-align:center;">—</td>';
        const color = t.actual >= t.target ? '#16a34a' : (t.pct >= 60 ? '#f59e0b' : '#dc2626');
        const remaining = Math.max(0, t.target - t.actual);
        const remainingDisplay = t.label === 'Total Sales' ? fmtRM(remaining) : remaining;
        return `
            <td style="padding:10px;border-bottom:1px solid var(--gray-100);min-width:160px;">
                <div style="font-size:12px;font-weight:600;margin-bottom:3px;">${t.display}</div>
                <div style="background:#eee;border-radius:4px;height:6px;overflow:hidden;margin-bottom:3px;">
                    <div style="background:${color};height:100%;width:${t.pct}%;transition:width .3s;"></div>
                </div>
                <div style="font-size:11px;color:var(--gray-500);">${t.pct}% · ${remaining > 0 ? remainingDisplay + ' to go' : '✓ Hit'}</div>
            </td>`;
    };

    const tbody = rows.map(r => {
        const salesT = r.progress.targets.find(t => t.label === 'Total Sales');
        const custT = r.progress.targets.find(t => t.label === 'New Customers');
        const cpsT = r.progress.targets.find(t => t.label === 'CPS Count');
        const statusBadge = r.noParticipants
            ? '<span style="background:#f3f4f6;color:#6b7280;padding:3px 10px;border-radius:12px;font-size:11px;">No Agents</span>'
            : (r.progress.qualified
                ? '<span style="background:#dcfce7;color:#166534;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;">✓ Qualified</span>'
                : '<span style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:12px;font-size:11px;">In Progress</span>');
        const expiredBadge = r.isExpired
            ? '<span style="background:#f3f4f6;color:#6b7280;padding:2px 6px;border-radius:8px;font-size:10px;margin-left:6px;">EXPIRED</span>'
            : `<span style="background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:8px;font-size:10px;margin-left:6px;">${r.daysLeft}d left</span>`;
        const actionBtns = canManage ? `
            <button class="btn-icon" onclick="app.openSpecialProgramModal(${r.program.id})" title="Edit"><i class="fas fa-pencil-alt"></i></button>
            <button class="btn-icon text-danger" onclick="app.deleteSpecialProgram(${r.program.id})" title="Delete"><i class="fas fa-trash-alt"></i></button>
        ` : '';
        return `
            <tr style="${r.isExpired ? 'opacity:0.6;background:#f9fafb;' : ''}">
                <td style="padding:10px;border-bottom:1px solid var(--gray-100);min-width:200px;">
                    <strong style="font-size:13px;">🏆 ${r.program.program_name || 'Untitled'}</strong>${expiredBadge}
                    <div style="font-size:11px;color:var(--gray-500);margin-top:3px;">🎁 ${r.program.reward || '—'}</div>
                    <div style="font-size:10px;color:var(--gray-400);margin-top:2px;">${r.program.start_date || '?'} → ${r.program.end_date || '?'}</div>
                </td>
                <td style="padding:10px;border-bottom:1px solid var(--gray-100);min-width:160px;">
                    ${r.noParticipants ? '<span style="color:var(--gray-400);font-style:italic;">No participants</span>' : `
                        <strong style="font-size:13px;">${r.agentName}</strong>
                        <div style="font-size:11px;color:var(--gray-500);margin-top:2px;">${r.agentRole}</div>
                    `}
                </td>
                ${cell(salesT)}
                ${cell(custT)}
                ${cell(cpsT)}
                <td style="padding:10px;border-bottom:1px solid var(--gray-100);text-align:center;">${statusBadge}</td>
                <td style="padding:10px;border-bottom:1px solid var(--gray-100);white-space:nowrap;">${actionBtns}</td>
            </tr>`;
    }).join('');

    return `
        <div style="margin-bottom:12px;color:var(--gray-500);font-size:13px;">
            Track each agent's progress toward their special program targets. Bars show how much they have made and how far to go.
        </div>
        <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;">
                <thead>
                    <tr>
                        <th scope="col" style="text-align:left;">Program</th>
                        <th scope="col" style="text-align:left;">Agent</th>
                        <th scope="col" style="text-align:left;">Total Sales</th>
                        <th scope="col" style="text-align:left;">New Customers</th>
                        <th scope="col" style="text-align:left;">CPS Count</th>
                        <th scope="col" style="text-align:center;">Status</th>
                        <th scope="col" style="text-align:left;">Actions</th>
                    </tr>
                </thead>
                <tbody>${tbody}</tbody>
            </table>
        </div>`;
};

// Open create/edit modal for a special program
const openSpecialProgramModal = async (programId = null) => {
    const existing = programId ? (await AppDataStore.getAll('special_programs')).find(p => p.id === programId) : null;
    const participants = programId
        ? (await AppDataStore.getAll('special_program_participants')).filter(p => p.program_id === programId)
        : [];
    const selectedIds = new Set(participants.map(p => p.agent_id));

    // Pull eligible agents: Level 6-12 (Senior Consultant through Ambassador)
    const allUsers = await AppDataStore.getAll('users');
    const eligible = allUsers.filter(u => {
        if (u.status === 'deleted') return false;
        const m = u.role?.match(/Level\s*(\d+)/);
        if (!m) return false;
        const lvl = parseInt(m[1]);
        return lvl >= 6 && lvl <= 12;
    });

    const todayStr = _today();
    const defaultEnd = (() => { const d = new Date(); d.setDate(d.getDate() + 60); return d.toISOString().slice(0, 10); })();

    const agentRows = eligible.map(u => `
        <tr>
            <td style="padding:6px 8px;"><input type="checkbox" class="sp-agent-cb" value="${u.id}" ${selectedIds.has(u.id) ? 'checked' : ''}></td>
            <td style="padding:6px 8px;"><strong>${u.full_name || u.username || '—'}</strong></td>
            <td style="padding:6px 8px;font-size:11px;color:var(--gray-500);">${u.role || '—'}</td>
        </tr>`).join('');

    const content = `
        <div style="max-height:75vh;overflow-y:auto;padding-right:4px;">
            <h4 style="margin:0 0 10px;">Program Details</h4>
            <div class="form-group"><label>Program Name *</label>
                <input type="text" id="sp-name" class="form-control" value="${existing?.program_name || ''}" placeholder="e.g. China Trip Challenge"></div>
            <div class="form-group"><label>Reward *</label>
                <input type="text" id="sp-reward" class="form-control" value="${existing?.reward || ''}" placeholder="e.g. China 5D4N Trip"></div>
            <div class="form-group"><label>Description</label>
                <textarea id="sp-desc" class="form-control" rows="2" placeholder="Optional details about the program">${existing?.description || ''}</textarea></div>
            <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <div class="form-group"><label>Start Date *</label>
                    <input type="date" id="sp-start" class="form-control" value="${existing?.start_date || todayStr}"></div>
                <div class="form-group"><label>End Date *</label>
                    <input type="date" id="sp-end" class="form-control" value="${existing?.end_date || defaultEnd}"></div>
            </div>

            <h4 style="margin:16px 0 10px;">Targets (all must be hit to qualify)</h4>
            <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
                <div class="form-group"><label>Sales Target (RM)</label>
                    <input type="number" id="sp-sales" class="form-control" value="${existing?.sales_target || ''}" placeholder="e.g. 200000"></div>
                <div class="form-group"><label>New Customers</label>
                    <input type="number" id="sp-customers" class="form-control" value="${existing?.new_customers_target || ''}" placeholder="e.g. 5"></div>
                <div class="form-group"><label>CPS Count</label>
                    <input type="number" id="sp-cps" class="form-control" value="${existing?.cps_target || ''}" placeholder="optional"></div>
            </div>
            <p style="font-size:11px;color:var(--gray-400);margin:0 0 14px;">Leave a target blank to exclude it from the program.</p>

            <h4 style="margin:16px 0 6px;">Participating Agents (${eligible.length} eligible)</h4>
            <p style="font-size:11px;color:var(--gray-400);margin:0 0 8px;">Pick from Consultant/Agent roles (Level 6–12)</p>
            <div style="max-height:260px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:6px;">
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <thead style="background:var(--gray-50,#f7f4ed);position:sticky;top:0;">
                        <tr>
                            <th scope="col" style="padding:8px;width:40px;"><input type="checkbox" id="sp-select-all" onchange="document.querySelectorAll('.sp-agent-cb').forEach(cb => cb.checked = this.checked)"></th>
                            <th scope="col" style="text-align:left;padding:8px;">Name</th>
                            <th scope="col" style="text-align:left;padding:8px;">Role</th>
                        </tr>
                    </thead>
                    <tbody>${agentRows || '<tr><td colspan="3" style="padding:16px;text-align:center;color:var(--gray-400);">No eligible agents found</td></tr>'}</tbody>
                </table>
            </div>
        </div>`;

    UI.showModal(existing ? 'Edit Special Program' : 'New Special Program', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: existing ? 'Save Changes' : 'Create Program', type: 'primary', action: `(async () => { await app.saveSpecialProgram(${programId || 'null'}); })()` }
    ]);
};

const saveSpecialProgram = async (programId = null) => {
    const name = document.getElementById('sp-name')?.value?.trim();
    const reward = document.getElementById('sp-reward')?.value?.trim();
    const description = document.getElementById('sp-desc')?.value?.trim() || '';
    const startDate = document.getElementById('sp-start')?.value;
    const endDate = document.getElementById('sp-end')?.value;
    const salesTarget = parseFloat(document.getElementById('sp-sales')?.value) || 0;
    const customersTarget = parseInt(document.getElementById('sp-customers')?.value) || 0;
    const cpsTarget = parseInt(document.getElementById('sp-cps')?.value) || 0;

    if (!name) return UI.toast.error('Program name is required');
    if (!reward) return UI.toast.error('Reward is required');
    if (!startDate || !endDate) return UI.toast.error('Start and end dates are required');
    if (endDate < startDate) return UI.toast.error('End date must be after start date');
    if (salesTarget <= 0 && customersTarget <= 0 && cpsTarget <= 0) return UI.toast.error('At least one target must be set');

    const selectedAgents = Array.from(document.querySelectorAll('.sp-agent-cb:checked')).map(cb => parseInt(cb.value));

    const programData = {
        program_name: name,
        reward: reward,
        description: description,
        start_date: startDate,
        end_date: endDate,
        sales_target: salesTarget,
        new_customers_target: customersTarget,
        cps_target: cpsTarget,
        qualify_mode: 'all',
        status: 'active',
        created_by: _currentUser?.id || null,
        created_at: new Date().toISOString()
    };

    let savedProgramId = programId;
    if (programId) {
        await AppDataStore.update('special_programs', programId, programData);
        // Remove old participants
        const oldParts = (await AppDataStore.getAll('special_program_participants')).filter(p => p.program_id === programId);
        for (const p of oldParts) {
            await AppDataStore.delete('special_program_participants', p.id);
        }
    } else {
        programData.id = Date.now();
        savedProgramId = programData.id;
        await AppDataStore.create('special_programs', programData);
    }

    // Create new participants
    for (const agentId of selectedAgents) {
        await AppDataStore.create('special_program_participants', {
            id: Date.now() + agentId,
            program_id: savedProgramId,
            agent_id: agentId,
            joined_at: new Date().toISOString()
        });
    }

    UI.hideModal();
    UI.toast.success(programId ? 'Program updated' : `Program created with ${selectedAgents.length} participant${selectedAgents.length===1?'':'s'}`);
    await refreshSpecialProgramView();
};

// Refresh whichever view currently hosts the special programs UI
const refreshSpecialProgramView = async () => {
    const mlContent = document.getElementById('marketing-list-content');
    if (mlContent && _state.cmlt === 'special_programs') {
        mlContent.innerHTML = await renderMarketingListTable();
        return;
    }
    if (typeof window.app.refreshKPIDashboard === 'function') await window.app.refreshKPIDashboard();
};

const deleteSpecialProgram = async (programId) => {
    UI.showModal('Delete Program', '<p>Are you sure you want to delete this special program? Participants and progress history will be removed.</p>', [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Delete', type: 'primary', action: `(async () => { await app.confirmDeleteSpecialProgram(${programId}); })()` }
    ]);
};

const confirmDeleteSpecialProgram = async (programId) => {
    await AppDataStore.delete('special_programs', programId);
    const parts = (await AppDataStore.getAll('special_program_participants')).filter(p => p.program_id === programId);
    for (const p of parts) {
        await AppDataStore.delete('special_program_participants', p.id);
    }
    UI.hideModal();
    UI.toast.success('Program deleted');
    await refreshSpecialProgramView();
};

// Calendar popup — show on first calendar visit per session if current user is in any active program
const checkSpecialProgramPopup = async () => {
    if (!_currentUser) return;
    if (sessionStorage.getItem('specialProgramPopupShown') === '1') return;

    const [programs, parts] = await Promise.all([
        AppDataStore.getAll('special_programs'),
        AppDataStore.getAll('special_program_participants')
    ]);
    const today = _today();
    const myParts = parts.filter(p => p.agent_id === _currentUser.id);
    if (myParts.length === 0) return;

    const myActive = [];
    for (const part of myParts) {
        const program = programs.find(pr => pr.id === part.program_id);
        if (!program || program.status === 'cancelled' || program.status === 'deleted') continue;
        if (program.start_date > today || program.end_date < today) continue;
        myActive.push(program);
    }
    if (myActive.length === 0) return;

    // Build progress cards
    const cards = [];
    for (const program of myActive) {
        const progress = await calculateProgramProgress(program, _currentUser.id);
        const daysLeft = program.end_date ? Math.max(0, Math.ceil((new Date(program.end_date) - new Date(today)) / 86400000)) : 0;
        const barsHtml = progress.targets.map(t => {
            const color = t.actual >= t.target ? '#16a34a' : (t.pct >= 60 ? '#f59e0b' : '#dc2626');
            return `
                <div style="margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                        <span>${t.label}</span>
                        <strong>${t.display}</strong>
                    </div>
                    <div style="background:#eee;border-radius:6px;height:10px;overflow:hidden;">
                        <div style="background:${color};height:100%;width:${t.pct}%;transition:width .4s;"></div>
                    </div>
                </div>`;
        }).join('');
        const statusBanner = progress.qualified
            ? '<div style="background:#dcfce7;color:#166534;padding:10px;border-radius:6px;margin-bottom:10px;font-weight:600;text-align:center;">🎉 You\'ve qualified for this reward!</div>'
            : `<div style="background:#fef3c7;color:#92400e;padding:10px;border-radius:6px;margin-bottom:10px;text-align:center;font-size:13px;">⏳ <strong>${daysLeft} days left</strong> — keep pushing!</div>`;

        cards.push(`
            <div style="background:var(--white,#fff);border:2px solid #8B1A1A;border-radius:10px;padding:16px;margin-bottom:14px;">
                <h3 style="margin:0 0 4px;color:#8B1A1A;">🏆 ${program.program_name}</h3>
                <p style="font-size:13px;color:var(--gray-500);margin:0 0 10px;">🎁 Reward: <strong>${program.reward}</strong></p>
                ${statusBanner}
                ${barsHtml}
            </div>`);
    }

    sessionStorage.setItem('specialProgramPopupShown', '1');
    UI.showModal('Your Special Programs', cards.join(''), [
        { label: 'Let\'s Go! 💪', type: 'primary', action: 'UI.hideModal()' }
    ]);
};

// renderKPITargetComparison + renderYearlyTargetRows moved to script-reporting.js
// (they call getCPSCount/getTotalSales/etc. which are IIFE-private to that chunk).


// [CHUNK: performance] 913 lines extracted to chunks/script-performance.js
// Covers: showRankingPerformanceView, showWorkflowAutomationView, showNoticeboardView
// + all workflow CRUD helpers. Loaded lazily by navigateTo() for views:
// 'ranking', 'performance', 'noticeboard'.
// Registered on window.app via Object.assign at chunk load time.

// Workflow execution engine — called from activity save and prospect create paths;
// must live in the main IIFE so it's available without navigating to the ranking view.
const executeWorkflows = async (triggerType, context = {}) => {
    const workflows = (await AppDataStore.getAll('automation_workflows')).filter(w => w.trigger_type === triggerType && w.status === 'active');
    for (const wf of workflows) {
        try {
            if (wf.trigger_conditions?.value) {
                if (triggerType === 'score_change' && context.score < parseInt(wf.trigger_conditions.value)) continue;
                if (triggerType === 'inactivity' && context.daysInactive < parseInt(wf.trigger_conditions.value)) continue;
            }
            const config = (wf.action_config || '')
                .replace(/\{\{name\}\}/g, context.name || '')
                .replace(/\{\{prospect_name\}\}/g, context.name || '')
                .replace(/\{\{score\}\}/g, context.score || '')
                .replace(/\{\{days\}\}/g, context.days || '')
                .replace(/\{\{event_name\}\}/g, context.eventName || '');
            void config;
            await AppDataStore.update('automation_workflows', wf.id, {
                run_count: (wf.run_count || 0) + 1,
                last_run: new Date().toISOString()
            });
        } catch (err) {
            console.error(`Workflow execution error for "${wf.workflow_name}":`, err);
        }
    }
};

// Called from activity save, milestone view, and admin "Mark ✓" buttons.
// Must live here so it's available before the performance chunk is ever loaded.
const markMilestoneCompleted = async (userId, milestoneName) => {
    try {
        const existing = await AppDataStore.query('user_milestones', { user_id: userId, milestone_name: milestoneName });
        if (existing.length === 0) {
            await AppDataStore.create('user_milestones', {
                id: Date.now(),
                user_id: userId,
                milestone_name: milestoneName,
                completed: true,
                completed_date: new Date().toISOString().split('T')[0]
            });
        } else if (!existing[0].completed) {
            await AppDataStore.update('user_milestones', existing[0].id, {
                completed: true,
                completed_date: new Date().toISOString().split('T')[0]
            });
        }
    } catch (err) {
        console.warn('markMilestoneCompleted error:', err);
    }
};

// showMilestonesView(container, targetUserId?)
// If targetUserId is supplied (admin use), shows that user's progress instead of the current user's.
const showMilestonesView = async (container, targetUserId = null) => {
    const currentUser = _currentUser;
    if (!currentUser) return;

    // ── Paint skeleton immediately ──────────────────────────────────────
    container.innerHTML = `
        <div class="milestone-view-wrap">
            <div class="milestone-container">
                <div class="milestone-inner">
                    <div class="milestone-header"><h1>增运九法</h1></div>
                    <div class="nine-method-grid">
                        ${Array(9).fill(0).map(() => `<div class="skeleton" style="border-radius:12px;height:120px;"></div>`).join('')}
                    </div>
                    <div style="margin-top:32px;">
                        <div class="skeleton" style="height:24px;width:140px;border-radius:4px;margin-bottom:16px;"></div>
                        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;">
                            ${Array(4).fill(0).map(() => `<div class="skeleton" style="border-radius:12px;height:100px;"></div>`).join('')}
                        </div>
                    </div>
                </div>
            </div>
        </div>`;

    // Determine admin status using canonical helper (handles Chinese-only role names)
    const viewerLevel = _getUserLevel(currentUser);
    const isAdmin = viewerLevel <= 2;

    // Resolve subject (whose milestones to show)
    const subjectUserId = (isAdmin && targetUserId) ? parseInt(targetUserId) : currentUser.id;
    const subjectUser   = (isAdmin && targetUserId) ? (await AppDataStore.getById('users', subjectUserId) || currentUser) : currentUser;
    const viewingOther  = isAdmin && subjectUserId !== currentUser.id;

    const subject = {
        user_id: subjectUserId,
        customer_id: subjectUser.customer_id || null,
        prospect_id: subjectUser.prospect_id || null,
    };

    // Compute statuses (parallel)
    const [nineStatuses, pillarStatuses] = await Promise.all([
        computeNineMethodStatuses(subject),
        computeFourPillarStatuses(subject),
    ]);

    // Admin user picker
    let adminPicker = '';
    if (isAdmin) {
        let allUsers = [];
        try { allUsers = (await AppDataStore.getAll('users')).filter(u => { const l = _getUserLevel(u); return l >= 13 && l <= 14; }); } catch(e) {}
        if (allUsers.length) {
            adminPicker = `
                <div class="milestone-admin-picker">
                    <span>View:</span>
                    <select onchange="(async()=>{ const vp=document.getElementById('content-viewport'); if(vp) await app.showMilestonesView(vp, this.value||null); })()">
                        <option value="">— My own —</option>
                        ${allUsers.map(u => `<option value="${u.id}" ${u.id === subjectUserId && viewingOther ? 'selected' : ''}>${u.full_name}</option>`).join('')}
                    </select>
                </div>`;
        }
    }

    const reloadAfter = `setTimeout(() => { const vp=document.getElementById('content-viewport'); if(vp) app.showMilestonesView(vp, ${targetUserId ? targetUserId : 'null'}); }, 120)`;
    const adminBtn = (key, isOn) => {
        if (!isAdmin) return '';
        if (isOn) {
            return `<button class="mc-admin reset" onclick="event.stopPropagation(); app.resetMilestone(${subjectUserId},'${key}').then(()=>{${reloadAfter}})">Reset</button>`;
        }
        return `<button class="mc-admin" onclick="event.stopPropagation(); app.markMilestoneCompleted(${subjectUserId},'${key}').then(()=>{${reloadAfter}})">Mark ✓</button>`;
    };
    const adminBtnPillar = (key, isOn) => {
        if (!isAdmin) return '';
        if (isOn) {
            return `<button class="pc-admin reset" onclick="event.stopPropagation(); app.resetMilestone(${subjectUserId},'${key}').then(()=>{${reloadAfter}})">Reset</button>`;
        }
        return `<button class="pc-admin" onclick="event.stopPropagation(); app.markMilestoneCompleted(${subjectUserId},'${key}').then(()=>{${reloadAfter}})">Mark ✓</button>`;
    };

    container.innerHTML = `
        <div class="milestone-view-wrap">
            <div class="milestone-container">
                <div class="milestone-inner">
                    <div class="milestone-header">
                        <h1>增运九法</h1>
                        ${viewingOther ? `<div class="viewer-note">Viewing: ${subjectUser.full_name}</div>` : ''}
                    </div>
                    ${adminPicker}
                    <div class="nine-method-grid">
                        ${NINE_METHOD_DEFS.map(def => {
                            const on = !!nineStatuses[def.key];
                            return `
                                <div class="nine-method-card ${on ? 'attended' : ''}">
                                    <div class="mc-icon"><picture><source srcset="${def.icon.replace(/\.png$/i,'.webp')}" type="image/webp"><img loading="lazy" decoding="async" src="${def.icon}" alt=""></picture></div>
                                    ${adminBtn(def.key, on)}
                                </div>
                            `;
                        }).join('')}
                    </div>

                    <div class="four-pillar-section">
                        <h2>丁财贵寿四柱</h2>
                        <div class="four-pillar-grid">
                            ${FOUR_PILLAR_DEFS.map(def => {
                                const on = !!pillarStatuses[def.key];
                                return `
                                    <div class="four-pillar-card ${on ? 'owned' : ''}">
                                        <div class="pc-icon"><picture><source srcset="${def.icon.replace(/\.png$/i,'.webp')}" type="image/webp"><img loading="lazy" decoding="async" src="${def.icon}" alt=""></picture></div>
                                        <div class="pc-label">${def.label}</div>
                                        ${adminBtnPillar(def.key, on)}
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
};

// Reset a milestone — removes the admin override row so auto-detect takes over.
// (Previously set completed=false; that prevented auto-detect from re-lighting the icon.)
const resetMilestone = async (userId, milestoneName) => {
    try {
        const existing = await AppDataStore.query('user_milestones', { user_id: userId, milestone_name: milestoneName });
        for (const row of existing) {
            await AppDataStore.delete('user_milestones', row.id);
        }
        if (existing.length > 0) UI.toast.success(`Override removed for "${milestoneName}".`);
    } catch(err) {
        UI.toast.error('Reset failed: ' + (err.message || 'Unknown error'));
    }
};

    Object.assign(window.app, {
        initMobileApp,
        addMobileMetaTags,
        refreshPipelineCalculations,
        filterPipeline,
        saveFocusOrder,
        showAddToFocusModal,
        openPrerequisiteConfig,
        addScoreToProspect,
        addScoreToCustomer,
        scoreActivityType,
        applyActivityScoring,
        _runWeeklyInactivityCheck,
        openScoreAdjustmentModal,
        confirmScoreAdjustment,
        autoExtendProtection,
        getExtensionType,
        openLatestMeetupNotes,
        openEditPotentialModal,
        savePotential,
        sendBirthdayWish,
        scheduleBirthdayFollowup,
        executeBirthdayAction,
        openKPITargetsModal,
        saveKPITargets,
        openQuarterlyTargetsModal,
        saveQuarterlyTargets,
        _today,
        calculateProgramProgress,
        renderSpecialPrograms,
        renderSpecialProgramsTable,
        openSpecialProgramModal,
        saveSpecialProgram,
        refreshSpecialProgramView,
        deleteSpecialProgram,
        confirmDeleteSpecialProgram,
        checkSpecialProgramPopup,
        executeWorkflows,
        markMilestoneCompleted,
        showMilestonesView,
        resetMilestone,
        SCORING_RULES,
    });
})();