/**
 * CRM Lazy Chunk: Calendar + Follow-up Automation Engine
 * Covers renderCalendar, renderTodayActivities, renderWeekView, viewActivityDetails,
 *   the full follow-up dispatch engine, and all calendar sub-components.
 * Loaded on-demand when user navigates to the calendar view.
 * Extracted 2026-06-05 (~5356 lines).
 */
(() => {
    const _state = window._appState;
    const _utils = window._crmUtils;
    const esc    = (...a) => _utils.escapeHtml(...a);
    const escapeHtml = esc;
    const getVisibleUserIds = (u) => _utils.getVisibleUserIds(u);
    // _filters is an object; alias by reference so in-place mutations are shared.
    const _filters = _state.flt;
    const isMobile   = () => _utils.isMobile();
    const timeAgo    = (...a) => _utils.timeAgo(...a);
    const debounceCall = (...a) => window.app.debounceCall(...a);
    const navigateTo   = (v) => window.app.navigateTo(v);
    const isSystemAdmin        = (u) => _utils.isSystemAdmin(u || _state.cu);
    const isMarketingManager   = (u) => _utils.isMarketingManager(u || _state.cu);
    const isAgent              = (u) => _utils.isAgent(u || _state.cu);
    const isManagement         = (u) => _utils.isManagement(u || _state.cu);
    const isTeamLeaderOrAbove  = (u) => _utils.isTeamLeaderOrAbove(u || _state.cu);
    const getUserLevel         = (u) => _utils.getUserLevel(u);
    const getAgentsAndLeaders  = () => _utils.getAgentsAndLeaders();
    // Co-agent push notification — defined in script-activities.js, exported to window.app.
    // Fire-and-forget after a co-agent is added to an activity.
    const _notifyCoAgentAdded  = (...a) => (window.app._notifyCoAgentAdded || (() => Promise.resolve()))(...a);
    // Local (MYT) date string YYYY-MM-DD. toISOString() uses UTC, which shifts to
    // the previous day for any action taken 00:00–08:00 local — wrong due_date and
    // breaks birthday-draft dedup. Use this for all date-only fields.
    const _localDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    // Auto-logged touches (birthday wish / gift sent) are kept for the contact's activity HISTORY
    // and to advance the cadence clock (last_activity_date), but are a logged PAST contact — not a
    // scheduled meeting. They are marked source='birthday_auto' and hidden from every calendar
    // surface (month grid / today's list / day & week views / mobile) so they don't clutter it.
    const _isAutoTouchLog = (a) => !!(a && a.source === 'birthday_auto');
    // Entity-name visibility gate (shared by month tile / today list / week / day
    // views and the detail modal so they can never drift again). The client
    // (prospect/customer) name on an activity the viewer does NOT personally own
    // is shown only when the activity's lead agent sits inside the viewer's
    // visibility scope: the viewer owns/co-owns it, is an admin/marketing (org-
    // wide), or — the case this fixes — is a team leader / manager whose downline
    // includes the lead agent. `scope` is a getVisibleUserIds() result: the string
    // 'all', or an array of visible user ids. The calendar grid RPC already scopes
    // its rows by this same visible-id set, so previously a leader could see a
    // downline tile but not whose meeting it was — the gate here was stricter than
    // the fetch. Peer agents viewing a public activity outside their scope still
    // see no name, preserving the original privacy intent (commits fa31e3b/3a75855).
    const _canViewEntityName = (a, scope) => {
        const viewerId = _state.cu?.id;
        // viewerId != null guard: a logged-out viewer (undefined id) on an activity
        // with no lead_agent_id must not self-match via String(undefined)===String(undefined).
        if (viewerId != null && a.lead_agent_id != null && String(a.lead_agent_id) === String(viewerId)) return true;
        if (viewerId != null && Array.isArray(a.co_agents) && a.co_agents.some(ca => ca.id != null && String(ca.id) === String(viewerId))) return true;
        if (isSystemAdmin(_state.cu)) return true;
        if (scope === 'all') return true;
        if (!Array.isArray(scope) || a.lead_agent_id == null) return false;
        const lid = String(a.lead_agent_id);
        return scope.some(id => String(id) === lid);
    };
    // ========== PHASE 1: FULL CALENDAR IMPLEMENTATION ==========

    // React-island flag (default-on, PROMOTED 2026-06-16 after thorough opt-in
    // verify of this highest-risk view: grid 42 cells + month title + day headers
    // + today activities + birthdays + glance counts (activity 2 / followup 2 /
    // bday 0) all parity-identical to legacy). Kill-switch → legacy:
    // window.__REACT_CAL===false, ?react=0, crm_react_off='1'. (Desktop only;
    // mobile uses showMobileCalendarView, untouched.)
    const _reactCalendarOn = () => {
        try {
            if (window.__REACT_CAL === false) return false;
            if (/[?&]react=0/.test(location.search)) return false;
            if (localStorage.getItem('crm_react_off') === '1') return false;
            return !!(window.CRMReact && typeof window.CRMReact.mountCalendar === 'function');
        } catch (_) { /* intentional: feature-detect, default off on any error */ return false; }
    };

    // ── NEW full-JSX render flag (default OFF). Opt in via ?react_cal_jsx=1 or
    // localStorage crm_react_cal_jsx==='1'. Same idiom as _reactCalendarOn but
    // DEFAULT FALSE: when off, the existing scaffold + by-id fill path runs
    // BYTE-FOR-BYTE unchanged. When on, CalendarFullJsx owns the static shell
    // (welcome banner / header toolbar / section headers / glance / quick
    // actions) from a plain-serializable payload, and the chunk STILL fills the
    // privacy-sensitive month/week/day GRID + activity/birthday/refill/glance
    // lists by id (the grid render's scoped queryAdvanced + name-masking is
    // preserved untouched — the JSX path only owns static chrome).
    const _reactCalJsxOn = () => {
        try {
            if (/[?&]react_cal_jsx=1/.test(location.search)) return true;
            if (localStorage.getItem('crm_react_cal_jsx') === '1') return true;
            return false;
        } catch (_) { /* intentional: opt-in flag probe, default off on any error */ return false; }
    };

    // Plain-serializable payload (NO HTML strings) for the parts CalendarFullJsx
    // renders as real JSX. Only the static chrome text is JSX-owned; every
    // dynamic list/grid/count is left as a stable-id container the chunk fills
    // exactly as the scaffold path (so the privacy scoping/masking is reused
    // verbatim). Kept tiny + synchronous so it cannot throw on the hot path.
    const buildCalendarIslandData = () => {
        const userName = _state.cu?.display_name || _state.cu?.name || _state.cu?.email?.split('@')[0] || 'there';
        const userEmail = _state.cu?.email || '';
        const hour = new Date().getHours();
        const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
        return { greeting, userName, userEmail };
    };

    const showCalendarView = async (container) => {
        const userName = _state.cu?.display_name || _state.cu?.name || _state.cu?.email?.split('@')[0] || 'there';
        const userEmail = _state.cu?.email || '';
        const hour = new Date().getHours();
        const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

        // React scaffold-shell — island renders the shell; the cache-warm +
        // renderCalendar()/renderTodayActivities()/secondary fills below populate
        // the by-id containers (grid/today/birthdays/refills/glance) exactly as
        // legacy, after awaiting the island useEffect-ready (rAF-too-early lesson).
        if (_reactCalendarOn()) {
            container.innerHTML = '<div id="cal-react-root"></div>';
            let _calReady; const _calReadyP = new Promise(res => { _calReady = res; });
            const _calGuard = setTimeout(() => _calReady(), 4000);

            // NEW full-JSX path (default OFF — _reactCalJsxOn). When on AND the
            // payload builds, pass data:<payload> so CalendarFullJsx renders the
            // static chrome (banner/toolbar/section headers/glance/quick actions)
            // as real JSX. The grid + every dynamic list are STILL stable-id
            // containers in that JSX view, so the by-id fills below run
            // identically — DO NOT suppress them (the privacy-scoped grid render
            // is reused verbatim). If the build throws, fall back to
            // data:undefined → the scaffold-shell island, behavior unchanged.
            let _calData;
            if (_reactCalJsxOn()) {
                try {
                    _calData = buildCalendarIslandData();
                } catch (e) {
                    console.warn('[calendar] JSX payload build failed, falling back to scaffold shell:', e && e.message);
                    _calData = undefined;
                }
            }
            try {
                window.CRMReact.mountCalendar(document.getElementById('cal-react-root'), {
                    greeting, userName, userEmail,
                    data: _calData,
                    onReady: () => { clearTimeout(_calGuard); _calReady(); },
                });
            } catch (e) {
                console.warn('[calendar] island mount failed, falling back to legacy:', e && e.message);
                clearTimeout(_calGuard); _calReady();
            }
            await _calReadyP;
        } else {
        container.innerHTML = `
            <div class="calendar-page-layout">

                <!-- ── Left: main calendar content ── -->
                <div class="calendar-main">

                    <!-- Welcome banner -->
                    <div class="cal-welcome-banner">
                        <div class="cal-welcome-text">
                            <h2>${greeting}, <span class="welcome-name">${esc(userName)}!</span> 👋</h2>
                            <p>Stay on top of your schedule and never miss an important follow-up.</p>
                            ${userEmail ? `<p class="cal-account-line" style="margin-top:6px;font-size:12px;color:#9ca3af;">
                                Logged in as <strong style="color:#6b7280;">${esc(userEmail)}</strong> —
                                <a href="#" onclick="event.preventDefault(); app.switchAccount();" style="color:#dc2626;font-weight:600;text-decoration:underline;cursor:pointer;">not you? Switch account</a>
                            </p>` : ''}
                        </div>
                        <div class="cal-welcome-illus" aria-hidden="true">📅</div>
                    </div>

                    <div class="calendar-view-container">
                        <!-- Section 1.1: Header -->
                        <div class="calendar-header-toolbar">
                            <div class="calendar-title-nav">
                                <h2 id="calendar-month-title" onclick="app.openMonthPicker()" style="cursor:pointer;" title="Click to select month">Month Year</h2>
                                <div class="nav-arrows">
                                    <button class="btn-nav" onclick="app.goToPrevious()" aria-label="Previous month"><i class="fas fa-chevron-left" aria-hidden="true"></i></button>
                                    <button class="btn-nav" onclick="app.goToNext()" aria-label="Next month"><i class="fas fa-chevron-right" aria-hidden="true"></i></button>
                                </div>
                                <button class="btn secondary btn-sm" onclick="app.goToToday()">Today</button>
                            </div>
                            <div class="calendar-controls">
                                <div class="cal-controls-pill">
                                    <button class="cal-icon-btn cal-btn-filter" onclick="app.openCalendarFilterModal()" title="Filter">
                                        <i class="fas fa-search"></i>
                                    </button>
                                    <button class="cal-icon-btn cal-btn-wa" onclick="app.openShareCpsIntakeLinkModal()" title="Share CPS Intake Link">
                                        <i class="fab fa-whatsapp"></i>
                                    </button>
                                    <button class="cal-icon-btn cal-btn-add" onclick="app.openActivityModal()" title="Quick Add Activity">
                                        <i class="fas fa-plus"></i>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Section 1.2: Grid -->
                        <div class="calendar-monthly-wrapper">
                            <div class="calendar-days-header" id="calendar-days-header"></div>
                            <div class="calendar-grid-main" id="calendar-grid"></div>
                        </div>

                        <!-- Pending CPS Intake Approvals -->
                        <div id="pending-cps-intakes" style="display:none; margin-top:16px;"></div>

                        <!-- Follow-Up Reminders -->
                        <div id="follow-up-reminders" style="display:none;"></div>

                        <!-- Pending Proposed Solutions widget -->
                        <div id="pending-solutions-widget" style="display:none;"></div>

                        <!-- Section 1.3: Today's Activities -->
                        <div class="today-activities-section">
                            <h3>📅 TODAY'S ACTIVITIES</h3>
                            <div class="activity-cards-grid" id="today-activities-grid"></div>
                        </div>

                        <!-- Section 1.4: Birthdays -->
                        <div class="birthday-section">
                            <h3>🎂 BIRTHDAY REMINDERS</h3>
                            <div class="birthday-columns">
                                <div class="birthday-col">
                                    <div id="bday-today-header" style="display:flex;align-items:center;gap:10px;margin-bottom:15px;">
                                        <div class="bday-badge today" style="width:30px;height:30px;border-radius:50%;background:#3b82f6;color:white;display:flex;align-items:center;justify-content:center;font-weight:bold;">0</div>
                                        <h4 style="margin:0;">Today</h4>
                                    </div>
                                    <div class="bday-list" id="bday-today-list"></div>
                                </div>
                                <div class="birthday-col">
                                    <div id="bday-upcoming-header" style="display:flex;align-items:center;gap:10px;margin-bottom:15px;">
                                        <div class="bday-badge upcoming" style="width:30px;height:30px;border-radius:50%;background:#f59e0b;color:white;display:flex;align-items:center;justify-content:center;font-weight:bold;">0</div>
                                        <h4 style="margin:0;">Upcoming (Next 2 Days)</h4>
                                    </div>
                                    <div class="bday-list" id="bday-upcoming-list"></div>
                                </div>
                            </div>
                        </div>

                        <!-- Section 1.45: Team Birthdays (staff/colleagues) -->
                        <div class="birthday-section">
                            <h3>🎉 TEAM BIRTHDAYS</h3>
                            <div class="birthday-columns">
                                <div class="birthday-col">
                                    <div id="team-bday-today-header" style="display:flex;align-items:center;gap:10px;margin-bottom:15px;">
                                        <div id="team-bday-today-badge" class="bday-badge" style="width:30px;height:30px;border-radius:50%;background:#10b981;color:white;display:flex;align-items:center;justify-content:center;font-weight:bold;">0</div>
                                        <h4 style="margin:0;">Today</h4>
                                    </div>
                                    <div class="bday-list" id="team-bday-today-list"></div>
                                </div>
                                <div class="birthday-col">
                                    <div id="team-bday-upcoming-header" style="display:flex;align-items:center;gap:10px;margin-bottom:15px;">
                                        <div id="team-bday-upcoming-badge" class="bday-badge" style="width:30px;height:30px;border-radius:50%;background:#f59e0b;color:white;display:flex;align-items:center;justify-content:center;font-weight:bold;">0</div>
                                        <h4 style="margin:0;">Upcoming (Next 2 Days)</h4>
                                    </div>
                                    <div class="bday-list" id="team-bday-upcoming-list"></div>
                                </div>
                            </div>
                        </div>

                        <!-- Section 1.5: Health Product Refills -->
                        <div class="birthday-section">
                            <h3>💊 HEALTH PRODUCT REFILLS</h3>
                            <div class="birthday-columns">
                                <div class="birthday-col">
                                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:15px;">
                                        <div id="refill-overdue-badge" class="bday-badge" style="width:30px;height:30px;border-radius:50%;background:#dc2626;color:white;display:flex;align-items:center;justify-content:center;font-weight:bold;">0</div>
                                        <h4 style="margin:0;">Overdue</h4>
                                    </div>
                                    <div class="bday-list" id="refill-overdue-list"></div>
                                </div>
                                <div class="birthday-col">
                                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:15px;">
                                        <div id="refill-soon-badge" class="bday-badge" style="width:30px;height:30px;border-radius:50%;background:#f59e0b;color:white;display:flex;align-items:center;justify-content:center;font-weight:bold;">0</div>
                                        <h4 style="margin:0;">Due This Week</h4>
                                    </div>
                                    <div class="bday-list" id="refill-soon-list"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ── Right panel: Today at a Glance ── -->
                <aside class="cal-right-panel" id="cal-right-panel">
                    <!-- Glance stats -->
                    <div class="cal-panel-card">
                        <h4>Today at a Glance</h4>
                        <div class="glance-stat" onclick="document.getElementById('follow-up-reminders')?.scrollIntoView({behavior:'smooth'})">
                            <div class="glance-icon pink"><i class="fas fa-bell"></i></div>
                            <div class="glance-info">
                                <div class="glance-count" id="glance-followup-count">—</div>
                                <div class="glance-label">Follow-up Reminders</div>
                            </div>
                        </div>
                        <div class="glance-stat" onclick="document.getElementById('today-activities-grid')?.scrollIntoView({behavior:'smooth'})">
                            <div class="glance-icon green"><i class="fas fa-calendar-check"></i></div>
                            <div class="glance-info">
                                <div class="glance-count" id="glance-activity-count">—</div>
                                <div class="glance-label">Activities</div>
                            </div>
                        </div>
                        <div class="glance-stat" onclick="document.getElementById('bday-today-list')?.scrollIntoView({behavior:'smooth'})">
                            <div class="glance-icon amber"><i class="fas fa-cake-candles"></i></div>
                            <div class="glance-info">
                                <div class="glance-count" id="glance-bday-count">—</div>
                                <div class="glance-label">Birthdays</div>
                            </div>
                        </div>
                        <div class="glance-stat" onclick="document.getElementById('bday-upcoming-list')?.scrollIntoView({behavior:'smooth'})">
                            <div class="glance-icon blue"><i class="fas fa-clock"></i></div>
                            <div class="glance-info">
                                <div class="glance-count" id="glance-upcoming-count">—</div>
                                <div class="glance-label">Upcoming</div>
                            </div>
                        </div>
                    </div>

                    <!-- Pipeline promo -->
                    <div class="cal-pipeline-card">
                        <h4>Keep your pipeline moving forward!</h4>
                        <p>Add activities, follow-ups and never miss a customer touchpoint.</p>
                        <button class="btn-add-activity" onclick="app.openActivityModal()">
                            <i class="fas fa-plus"></i> Add Activity
                        </button>
                    </div>

                    <!-- Quick actions -->
                    <div class="cal-panel-card">
                        <h4>Quick Actions</h4>
                        <div class="quick-action-row" onclick="app.openActivityModal()">
                            <div class="qa-left">
                                <div class="qa-icon green"><i class="fas fa-calendar-plus"></i></div>
                                <div><div class="qa-title">Add Activity</div><div class="qa-sub">Log a new activity</div></div>
                            </div>
                            <i class="fas fa-chevron-right qa-arrow"></i>
                        </div>
                        <div class="quick-action-row" onclick="app.openAddProspectModal && app.openAddProspectModal()">
                            <div class="qa-left">
                                <div class="qa-icon purple"><i class="fas fa-user-plus"></i></div>
                                <div><div class="qa-title">Add Prospect</div><div class="qa-sub">Create new prospect</div></div>
                            </div>
                            <i class="fas fa-chevron-right qa-arrow"></i>
                        </div>
                    </div>
                </aside>

            </div>
        `;
        }

        // Warm the cache for small shared lookup tables that multiple renderers
        // need. Calendar + Today activities now use queryAdvanced() with date
        // ranges so they no longer fetch ALL activities/prospects/customers.
        // Only warm events, users, and names (used by birthday section).
        AppDataStore.getAll('events');
        AppDataStore.getAll('users');
        AppDataStore.getAll('names');

        // ── Single-call dashboard prime (F6) ────────────────────────────
        // calendar_dashboard_payload() RPC returns activities+users+prospects
        // +customers in ONE round-trip with server-side filtering, then primes
        // each table's cache. Subsequent renderCalendar / renderTodayActivities
        // calls below hit the warm cache instead of 4 separate HTTP fetches.
        // Falls back gracefully (returns null) when the RPC isn't deployed yet;
        // the existing getAll() calls above already handle that path.
        // Fire-and-forget so we don't block the critical-path render — when
        // the RPC lands, it emits dataChanged which triggers a re-render.
        try {
            const _agentId = _state.cu?.id || null;
            AppDataStore.loadCalendarDashboard(_agentId).catch(() => {});
        } catch (_) { /* intentional: fire-and-forget cache prime, optional RPC */ }

        // ── Tier 1.2/1.3: critical path first, sidebars after ──
        // Critical path = the calendar grid + today's activity list. These
        // are what the user is waiting to see.
        console.time('[cal-perf] showCalendarView:critical');
        renderCalendar()
            .catch(e => console.warn('renderCalendar failed:', e))
            .finally(() => console.timeEnd('[cal-perf] showCalendarView:critical'));
        renderTodayActivities().catch(e => console.warn('renderTodayActivities failed:', e));

        // Secondary panels (right glance, birthdays, refills, follow-up
        // reminders) and the schema migration are deferred so they don't
        // compete with the grid for network + main-thread time. The 100 ms
        // delay lets the grid's first paint settle before sidebars start
        // fetching; on a slow connection the user perceives "the calendar
        // appeared, then the sidebars filled in" instead of "everything
        // hung for 10 s".
        const _runSecondary = () => {
            renderBirthdaySection().catch(e => console.warn('renderBirthdaySection failed:', e));
            renderRefillReminders().catch(e => console.warn('renderRefillReminders failed:', e));
            (window.app.renderPendingCpsIntakes || (() => Promise.resolve()))().catch(e => console.warn('renderPendingCpsIntakes failed:', e));
            // Use allSettled so a single dispatch failure doesn't block the
            // follow-up render — each dispatch is fire-and-forget side work.
            Promise.allSettled([
                dispatchBirthdayTriggers(),
                dispatchProactiveEventInvites(),
                dispatchPendingSolutionReminders(),
                dispatchReEngagementReminders(),
                dispatchCustomerCheckins(),
                dispatchApuAckTouches(),
                dispatchAppointmentReminders(),
                dispatchVoucherNudges()
            ]).then(() => Promise.all([
                renderFollowUpReminders(),
                renderPendingSolutionsWidget()
            ])).catch(e => console.warn('Follow-up reminders failed:', e));
        };
        setTimeout(_runSecondary, 100);

        // Tier 1.3: one-time schema check + follow-up template migration at idle.
        // Three-tier priority: scheduler.postTask (Chrome 94+, priority:'background')
        // > requestIdleCallback > setTimeout(1500). The migration itself uses
        // scheduler.yield() internally to break up the work if it loops.
        const _idleDeferred = (cb) => {
            if (typeof window.scheduler !== 'undefined' && typeof window.scheduler.postTask === 'function') {
                return window.scheduler.postTask(cb, { priority: 'background' });
            }
            if (typeof requestIdleCallback === 'function') {
                return requestIdleCallback(cb, { timeout: 5000 });
            }
            return setTimeout(cb, 1500);
        };
        _idleDeferred(() => {
            _migrateFollowUpTemplateColumns().catch(e => console.warn('Follow-up template migration failed:', e));
        });

        // Show Special Program progress popup (once per session, for participating agents)
        // Deferred so it doesn't block the calendar paint.
        setTimeout(() => {
            (window.app.checkSpecialProgramPopup || (() => Promise.resolve()))().catch(e => console.warn('Special Program popup failed:', e));
        }, 100);
    };

    // ========== FOLLOW-UP AUTOMATION ENGINE ==========

    // Cache templates in memory after first load
    let _followUpTemplatesCache = null;

    const loadFollowUpTemplates = async () => {
        if (_followUpTemplatesCache) return _followUpTemplatesCache;
        try {
            const templates = await AppDataStore.getAll('follow_up_templates');
            _followUpTemplatesCache = templates || [];
        } catch (e) {
            console.warn('Failed to load follow-up templates:', e);
            _followUpTemplatesCache = [];
        }
        return _followUpTemplatesCache;
    };

    const invalidateFollowUpTemplatesCache = () => { _followUpTemplatesCache = null; };

    // Default trigger config — single source of truth for all follow-up templates.
    // solution_category_match: matches against the product CATEGORY (from products table) of the
    //   prospect's proposed_solutions rows. e.g. 'Power Ring', '画作', '风水方案'.
    // eligibility_tiers: pipe-separated list — 'active' (CPS ≤180d), 'engaged' (>180d + 3+ events),
    //   'returning' (attended same event category last year), 'customer' (converted customer).
    const _TRIGGER_DEFAULTS = {
        // ── System triggers (non-CPS) — always kept ─────────────────────────────────
        apu_appointment: { trigger_category: 'on_apu_photo', event_keywords: '', cps_interest_match: '', solution_match: '', solution_category_match: '', eligibility_tiers: 'active', icon: '📋', description: 'When APU photo is attached. Reminds prospect to schedule appointment.', sort_order: 4, template_name: 'APU Appointment Reminder', message_template: '{name}，您的传福名单已经被公司妥善记录及保管。请您抽空与DC顾问团队联系，以便安排后续预约。免费的解盘卷将随后按名字发放给您。', delay_days: 0, event_window_days: 0 },
        diy_review:      { trigger_category: 'on_event_attendance', event_keywords: '环境风水基础课', cps_interest_match: '', solution_match: '', solution_category_match: '', eligibility_tiers: 'active', icon: '🔄', description: 'After attending 环境风水基础课. 3-day follow-up.', sort_order: 5, template_name: 'DIY 3-Day Review Follow-up', message_template: '{name}，环境风水基础课结束已三日。不知您在回顾或实践过程中，是否有遇到疑问？若有需要探讨之处，可以有30分钟与我们资深的顾问一对一交流。学习贵在沉淀，风水贵在运用。', delay_days: 3, event_window_days: 0 },
        birthday:        { trigger_category: 'on_birthday', event_keywords: '', cps_interest_match: '', solution_match: '', solution_category_match: '', eligibility_tiers: 'active', icon: '🎂', description: 'Daily on calendar load. Sends birthday greeting.', sort_order: 6, template_name: 'Birthday Greeting', message_template: '{name}，生日快乐。愿您新岁安康，诸事顺遂。', delay_days: 0, event_window_days: 0 },
        re_engagement:   { trigger_category: 'no_contact', event_keywords: '', cps_interest_match: '', solution_match: '', solution_category_match: '', eligibility_tiers: 'active', icon: '💌', description: 'No contact for N+ days — gentle re-connect message ({days} auto-filled). Tune cadence via RE_ENGAGE_DAYS.', sort_order: 7, template_name: 'Re-Engagement Nudge', message_template: '{name}，您好。时间匆匆，以相隔{days}日，不知近来一切是否顺遂？若有机缘，盼能与您约见叙谈。静候佳音。', delay_days: 0, event_window_days: 0 },
        cust_checkin:    { trigger_category: 'customer_checkin', event_keywords: '', cps_interest_match: '', solution_match: '', solution_category_match: '', eligibility_tiers: 'customer', icon: '🤝', description: '90-day customer check-in — no contact for {days}+ days. Caps at 2/day, highest-LTV first.', sort_order: 8, template_name: 'Customer 90-Day Check-In', message_template: '{name}，别来无恙。距上次见面已{days}天，特此问候。近来若有空，邀您喝杯茶，聊聊近况。', delay_days: 0, event_window_days: 0 },
        apu_ack:         { trigger_category: 'apu_namelist', event_keywords: '', cps_interest_match: '', solution_match: '', solution_category_match: '', eligibility_tiers: 'active', icon: '📒', description: 'Next day after a referral namelist is provided — thank them + confirm slots reserved. Respects grade-F/converted; re-arms each new namelist round.', sort_order: 9, template_name: 'APU Namelist Acknowledgment', message_template: '{name}，感谢您提供的推荐名单。我们已收悉，将尽快为每位贵宾安排专属解析与预留。您的传福，无疑为华社增加多一份正力，我们珍之重之。', delay_days: 1, event_window_days: 0 },
        appointment_reminder: { trigger_category: 'on_appointment', event_keywords: '', cps_interest_match: '', solution_match: '', solution_category_match: '', eligibility_tiers: 'active', icon: '🔔', description: 'Day(s) before a booked CPS/FTF/GR/XG meeting — surfaces a come-on-time confirmation with date / time / venue to send the client.', sort_order: 3, template_name: 'Appointment Reminder', message_template: '{name}，您好。温馨提醒：您与DC有约。预约的{date} {time}，地点为{venue}。需要穿著端正，長褲包鞋。敬请准时莅临。如有不便，烦请提前告知。', delay_days: 0, event_window_days: 0 },
        voucher_unredeemed: { trigger_category: 'voucher_followup', event_keywords: '', cps_interest_match: '', solution_match: '', solution_category_match: '', eligibility_tiers: 'active', icon: '🎫', description: 'A generated e-CPS voucher is 14+ days old and not marked redeemed — nudge the agent to follow up so it gets used.', sort_order: 2, template_name: 'Unredeemed Voucher Follow-up', message_template: '{name}，您好。之前为「{recipient}」准备的电子券（序号 {code}）尚未使用。名额有限，方便的话请协助提醒对方尽快预约领取。', delay_days: 0, event_window_days: 0 },
        // ── Power Ring ───────────────────────────────────────────────────────────────
        pr_9star:    { trigger_category: 'after_cps', event_keywords: '个人风水基础课', solution_category_match: 'Power Ring', cps_interest_match: '', solution_match: '', eligibility_tiers: 'active', icon: '⭐', template_name: 'Power Ring → 个人风水基础课', description: 'Power Ring proposed → 个人风水基础课 invite (Active)', sort_order: 10, message_template: 'Hi {name}，诚邀您出席《个人风水基础课》！日期：{date}，地点：{venue}。期待与您相见！— {agent_name}', delay_days: 0, event_window_days: 60 },
        pr_destiny:  { trigger_category: 'after_cps', event_keywords: '个人改命分享会', solution_category_match: 'Power Ring', cps_interest_match: '', solution_match: '', eligibility_tiers: 'active', icon: '⭐', template_name: 'Power Ring → 个人改命分享会', description: 'Power Ring proposed → 个人改命分享会 invite (Active)', sort_order: 11, message_template: 'Hi {name}，诚邀您出席《个人改命分享会》！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        pr_boss:     { trigger_category: 'after_cps', event_keywords: '老板每月主题课', solution_category_match: 'Power Ring', cps_interest_match: '', solution_match: '', eligibility_tiers: 'active', icon: '⭐', template_name: 'Power Ring → 老板每月主题课', description: 'Power Ring proposed → 老板每月主题课 invite (Active)', sort_order: 12, message_template: 'Hi {name}，诚邀您出席每月《老板主题课》！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        pr_museum:   { trigger_category: 'after_cps', event_keywords: '博物馆', solution_category_match: 'Power Ring', cps_interest_match: '', solution_match: '', eligibility_tiers: 'active', icon: '⭐', template_name: 'Power Ring → 博物馆', description: 'Power Ring proposed → 博物馆 invite (Active)', sort_order: 13, message_template: 'Hi {name}，诚邀您参观《天渊玄空风水博物馆》！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        // ── 画作 ───────────────────────────────���─────────────────��───────────────────
        painting_sharing: { trigger_category: 'after_cps', event_keywords: '画作分享会', solution_category_match: '画作', cps_interest_match: '', solution_match: '', eligibility_tiers: 'active', icon: '🖼️', template_name: '画作 → 画作分享会', description: '画作 proposed → 画作分享会 invite (Active)', sort_order: 20, message_template: 'Hi {name}，诚邀您出席《画作分享会》，了解更多画作资讯！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        painting_art:     { trigger_category: 'after_cps', event_keywords: '艺品分享会', solution_category_match: '画作', cps_interest_match: '', solution_match: '', eligibility_tiers: 'active', icon: '🖼️', template_name: '画作 → 艺品分享会', description: '画作 proposed → 艺品分享会 invite (Active)', sort_order: 21, message_template: 'Hi {name}，诚邀您出席《艺品分享会》！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        painting_huiji:   { trigger_category: 'after_cps', event_keywords: '汇集-商业,汇集-灵活,汇集-简易,汇聚-专案', solution_category_match: '画作', cps_interest_match: '', solution_match: '', eligibility_tiers: 'active', icon: '🖼️', template_name: '画作 → 汇集', description: '画作 proposed → any 汇集 invite (Active)', sort_order: 22, message_template: 'Hi {name}，诚邀您出席《{event_name}》！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        // ── 风水方案 ───────────────────────────���─────────────────���────────────────────
        fs_diy:     { trigger_category: 'after_cps', event_keywords: '环境风水基础课', solution_category_match: '风水方案', cps_interest_match: '', solution_match: '', eligibility_tiers: 'active', icon: '🏠', template_name: '风水方案 → 环境风水基础课', description: '风水方案 proposed → 环境风水基础课 invite (Active)', sort_order: 30, message_template: 'Hi {name}，诚邀您出席《环境风水基础课》！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        fs_boss:    { trigger_category: 'after_cps', event_keywords: '老板每月主题课', solution_category_match: '风水方案', cps_interest_match: '', solution_match: '', eligibility_tiers: 'active', icon: '🏠', template_name: '风水方案 → 老板每月主题课', description: '风水方案 proposed → 老板每月主题课 invite (Active)', sort_order: 31, message_template: 'Hi {name}，诚邀您出席每月《老板主题课》！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        fs_museum:  { trigger_category: 'after_cps', event_keywords: '博物馆', solution_category_match: '风水方案', cps_interest_match: '', solution_match: '', eligibility_tiers: 'active', icon: '🏠', template_name: '风水方案 → 博物馆', description: '风水方案 proposed → 博物馆 invite (Active)', sort_order: 32, message_template: 'Hi {name}，诚邀您参观《天渊玄空风水博物馆》！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        fs_huiji:   { trigger_category: 'after_cps', event_keywords: '汇集-商业,汇集-灵活,汇集-简易,汇聚-专案', solution_category_match: '风水方案', cps_interest_match: '', solution_match: '', eligibility_tiers: 'active', icon: '🏠', template_name: '风水方案 → 汇集', description: '风水方案 proposed → any 汇集 invite (Active)', sort_order: 33, message_template: 'Hi {name}，诚邀您出席《{event_name}》！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        fs_sharing: { trigger_category: 'after_cps', event_keywords: '风水改命分享会-简易,风水改命分享会-专案', solution_category_match: '风水方案', cps_interest_match: '', solution_match: '', eligibility_tiers: 'active', icon: '🏠', template_name: '风水方案 → 风水改命分享会', description: '风水方案 proposed → 风水改命分享会 invite (Active)', sort_order: 34, message_template: 'Hi {name}，诚邀您出席《{event_name}》！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        // ── Bujishu ──────────────────────────────────────────────────────────────────
        bujishu_sharing: { trigger_category: 'after_cps', event_keywords: 'Bujishu 分享会', solution_category_match: 'Bujishu', cps_interest_match: '', solution_match: '', eligibility_tiers: 'active', icon: '💎', template_name: 'Bujishu → 分享会', description: 'Bujishu proposed → Bujishu 分享会 invite (Active)', sort_order: 40, message_template: 'Hi {name}，诚邀您出席《Bujishu 分享会》！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        bujishu_launch:  { trigger_category: 'after_cps', event_keywords: 'Bujishu 新品发布会', solution_category_match: 'Bujishu', cps_interest_match: '', solution_match: '', eligibility_tiers: 'active', icon: '💎', template_name: 'Bujishu → 新品发布会', description: 'Bujishu proposed → Bujishu 新品发布会 invite (Active)', sort_order: 41, message_template: 'Hi {name}，诚邀您出席《Bujishu 新品发布会》！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        // ── Formula ───────────────────────────��───────────────────────────���──────────
        formula_sharing:    { trigger_category: 'after_cps', event_keywords: 'Formula 分享会', solution_category_match: 'Formula', cps_interest_match: '', solution_match: '', eligibility_tiers: 'active', icon: '💊', template_name: 'Formula → 分享会', description: 'Formula proposed → Formula 分享会 invite (Active)', sort_order: 50, message_template: 'Hi {name}，诚邀您出席《Formula 分享会》！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        formula_launch:     { trigger_category: 'after_cps', event_keywords: 'Formula 新品发布会', solution_category_match: 'Formula', cps_interest_match: '', solution_match: '', eligibility_tiers: 'active', icon: '💊', template_name: 'Formula → 新品发布会', description: 'Formula proposed → Formula 新品发布会 invite (Active)', sort_order: 51, message_template: 'Hi {name}，诚邀您出席《Formula 新品发布会》！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        formula_exhibition: { trigger_category: 'after_cps', event_keywords: 'Formula 展览', solution_category_match: 'Formula', cps_interest_match: '', solution_match: '', eligibility_tiers: 'active', icon: '💊', template_name: 'Formula → 展览', description: 'Formula proposed → Formula 展览 invite (Active)', sort_order: 52, message_template: 'Hi {name}，诚邀您出席《Formula 展览》！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        formula_memberday:  { trigger_category: 'after_cps', event_keywords: 'Formula Member Day', solution_category_match: 'Formula', cps_interest_match: '', solution_match: '', eligibility_tiers: 'active', icon: '💊', template_name: 'Formula → Member Day', description: 'Formula proposed → Formula Member Day invite (Active)', sort_order: 53, message_template: 'Hi {name}，诚邀您出席《Formula Member Day》！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        // ── 招商 (Recruitment) ──────────────────────��─────────────────────────────────
        recruitment_dc: { trigger_category: 'after_cps', event_keywords: 'DC 招商会', solution_category_match: '', cps_interest_match: '招商', solution_match: '', eligibility_tiers: 'active', icon: '🤝', template_name: '招商 → DC 招商会', description: '招商 interest → DC 招商会 invite (Active)', sort_order: 60, message_template: 'Hi {name}，诚邀您出席《DC 招商会》！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        // ── 课程 (Courses) ────────────────────────────���────────────────────────────���──
        course_class: { trigger_category: 'after_cps', event_keywords: '课程', solution_category_match: '', cps_interest_match: '课程', solution_match: '', eligibility_tiers: 'active', icon: '📚', template_name: '课程 → 课程', description: '课程 interest → 课程 event invite (Active)', sort_order: 70, message_template: 'Hi {name}，诚邀您出席即将举行的课程！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        course_boss:  { trigger_category: 'after_cps', event_keywords: '老板每月主题课', solution_category_match: '', cps_interest_match: '课程', solution_match: '', eligibility_tiers: 'active', icon: '📚', template_name: '课程 → 老板每月主题课', description: '课程 interest → 老板每月主题课 invite (Active)', sort_order: 71, message_template: 'Hi {name}，诚邀您出席《老板主题课》！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        // ── 咨询类型 ───────────────���─────────────────────────────��────────────────────
        consult_xinguiyun: { trigger_category: 'after_cps', event_keywords: '运程讲座', solution_category_match: '咨询类型', cps_interest_match: '星卦解运', solution_match: '', eligibility_tiers: 'returning', icon: '🔮', template_name: '咨询-星卦解运 → 运程讲座', description: '星卦解运 consultation → 运程讲座 re-invite (Returning)', sort_order: 80, message_template: 'Hi {name}，诚邀您再次出席《运程讲座》！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        // ── General — all active (CPS ≤180d) ─────────────────────────────────────────
        general_fuqi:     { trigger_category: 'after_cps', event_keywords: '福气分享会', solution_category_match: '', cps_interest_match: '', solution_match: '', eligibility_tiers: 'active', icon: '🎊', template_name: '全体 → 福气分享会', description: 'All active → 福气分享会 invite', sort_order: 90, message_template: 'Hi {name}，诚邀您出席《福气分享会》！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        // ── General — active + engaged + returning ────────────────────────────────────
        general_yuncheng: { trigger_category: 'after_cps', event_keywords: '运程讲座', solution_category_match: '', cps_interest_match: '', solution_match: '', eligibility_tiers: 'active|engaged|returning', icon: '🌟', template_name: '全体 → 运程讲座', description: 'All active/engaged/returning → 运程讲座 invite', sort_order: 91, message_template: 'Hi {name}，诚邀您出席《运程讲座》！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        general_spring:   { trigger_category: 'after_cps', event_keywords: '新春活动', solution_category_match: '', cps_interest_match: '', solution_match: '', eligibility_tiers: 'active|engaged|returning', icon: '🧧', template_name: '全体 → 新春活动', description: 'All active/engaged/returning → 新春活动 invite', sort_order: 92, message_template: 'Hi {name}，诚邀您出席《新春活动》！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 90 },
        general_dcday:    { trigger_category: 'after_cps', event_keywords: 'DC 日', solution_category_match: '', cps_interest_match: '', solution_match: '', eligibility_tiers: 'active|engaged|returning', icon: '🗓️', template_name: '全体 → DC 日', description: 'All active/engaged/returning → DC 日 invite', sort_order: 93, message_template: 'Hi {name}，诚邀您出席《DC 日》！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 60 },
        customer_trip:    { trigger_category: 'after_cps', event_keywords: '游一游', solution_category_match: '', cps_interest_match: '', solution_match: '', eligibility_tiers: 'customer|engaged|returning', icon: '✈️', template_name: '客户 → 游一游', description: 'Customers (engaged/returning) → 游一游 invite', sort_order: 94, message_template: 'Hi {name}，诚邀您参加《游一游》活动！日期：{date}，地点：{venue}。— {agent_name}', delay_days: 0, event_window_days: 90 },
        // ── Solution follow-up sequence (after_solution_proposed) ─────────────────────
        painting_day1:    { trigger_category: 'after_solution_proposed', event_keywords: '', cps_interest_match: '', solution_match: 'harmony painting,画作,painting', solution_category_match: '画作', eligibility_tiers: 'active', icon: '🖼️', description: 'Day 1 after 画作 proposed — thank you + brochure.', sort_order: 100, template_name: '画作 Day-1 Thank You', message_template: '您好{name}，感谢您今日拨冗会面。您对今天所看所闻的画作哪一幅印象最深刻？此卦将反应您当下最真实的情况，欢迎随时交流。', delay_days: 1, event_window_days: 0 },
        painting_day3:    { trigger_category: 'after_solution_proposed', event_keywords: '', cps_interest_match: '', solution_match: 'harmony painting,画作,painting', solution_category_match: '画作', eligibility_tiers: 'active', icon: '🖼️', description: 'Day 3 after 画作 proposed — check-in.', sort_order: 101, template_name: '画作 Day-3 Check-In', message_template: 'Hi {name}，想了解您对画作目录的看法，有什么想法吗？— {agent_name}', delay_days: 3, event_window_days: 0 },
        painting_day7:    { trigger_category: 'after_solution_proposed', event_keywords: '', cps_interest_match: '', solution_match: 'harmony painting,画作,painting', solution_category_match: '画作', eligibility_tiers: 'active', icon: '🖼️', description: 'Day 7 after 画作 proposed — send mockup.', sort_order: 102, template_name: '画作 Day-7 Mockup', message_template: 'Hi {name}，我已为您准备好画作的3D效果图，方便的话可以约个时间给您展示！— {agent_name}', delay_days: 7, event_window_days: 0 },
        painting_day14:   { trigger_category: 'after_solution_proposed', event_keywords: '', cps_interest_match: '', solution_match: 'harmony painting,画作,painting', solution_category_match: '画作', eligibility_tiers: 'active', icon: '🖼️', description: 'Day 14 after 画作 proposed — closing push.', sort_order: 103, template_name: '画作 Day-14 Closing', message_template: 'Hi {name}，本月画作名额有限，请问您准备好锁定了吗？— {agent_name}', delay_days: 14, event_window_days: 0 },
        // Generic drip (bug #7): every NON-painting proposal (Power Ring / FSA / Bujishu /
        // Formula / …) had NO day-1/3/7/14 sequence. These empty-solution_match templates
        // are the FALLBACK — the dispatcher prefers a specific match (e.g. 画作) when one
        // exists, else uses these. {solution} is interpolated with the proposal name.
        sol_day1:  { trigger_category: 'after_solution_proposed', event_keywords: '', cps_interest_match: '', solution_match: '', solution_category_match: '', eligibility_tiers: 'active', icon: '💬', description: 'Day 1 after any proposal — thank you (generic).', sort_order: 105, template_name: 'Proposal Day-1 Thank You', message_template: '{name}，感谢您今日的宝贵时间。关于「{solution}」的提案，若有任何疑问，请不吝告知。', delay_days: 1, event_window_days: 0 },
        sol_day3:  { trigger_category: 'after_solution_proposed', event_keywords: '', cps_interest_match: '', solution_match: '', solution_category_match: '', eligibility_tiers: 'active', icon: '💬', description: 'Day 3 after any proposal — check-in (generic).', sort_order: 106, template_name: 'Proposal Day-3 Check-In', message_template: '{name}，关于「{solution}」的提案，不知您是否有初步想法或需补充说明之处？', delay_days: 3, event_window_days: 0 },
        sol_day7:  { trigger_category: 'after_solution_proposed', event_keywords: '', cps_interest_match: '', solution_match: '', solution_category_match: '', eligibility_tiers: 'active', icon: '💬', description: 'Day 7 after any proposal — detail/offer (generic).', sort_order: 107, template_name: 'Proposal Day-7 Follow-Up', message_template: '{name}，关于「{solution}」，我可为您安排一次更详细的介绍或演示。方便约个时间吗？', delay_days: 7, event_window_days: 0 },
        sol_day14: { trigger_category: 'after_solution_proposed', event_keywords: '', cps_interest_match: '', solution_match: '', solution_category_match: '', eligibility_tiers: 'active', icon: '💬', description: 'Day 14 after any proposal — closing push (generic).', sort_order: 108, template_name: 'Proposal Day-14 Closing', message_template: 'Hi {name}，本月「{solution}」名额有限，请问您准备好了吗？— {agent_name}', delay_days: 14, event_window_days: 0 },
        solution_overdue: { trigger_category: 'solution_overdue', event_keywords: '', cps_interest_match: '', solution_match: '', solution_category_match: '', eligibility_tiers: 'active', icon: '⚠️', description: 'Day 21+ — proposed solution still Proposed. Escalation alert.', sort_order: 104, template_name: 'Solution Overdue Alert', message_template: 'Hi {name}，距离我们上次提案已超过21天，希望能再约个时间为您跟进。— {agent_name}', delay_days: 21, event_window_days: 0 }
    };

    // Unified event-invite copy (owner 2026-06-22): every class/event invitation (the after_cps
    // templates above) sends ONE restrained message with the class name filled dynamically via
    // {event_name}, rather than each template hard-coding its own name. Single source of truth;
    // overwrites the per-template message_template at load. (Solution drips + overdue are a
    // different trigger_category and keep their own copy.)
    const _EVENT_INVITE_MSG = '{name}，诚邀您出席《{event_name}》。日期：{date}，地点：{venue}。期待您的莅临。';
    for (const _k in _TRIGGER_DEFAULTS) {
        if (_TRIGGER_DEFAULTS[_k].trigger_category === 'after_cps') _TRIGGER_DEFAULTS[_k].message_template = _EVENT_INVITE_MSG;
    }

    // scheduler.yield() helper — breaks up long async loops so the browser can
    // handle user input between iterations. Falls back to a 0ms setTimeout on
    // browsers that don't yet support scheduler.yield() (Firefox, Safari <17).
    // Use: `await _yieldToMain()` at the top of every loop iteration that
    // might run 50+ times, or after any operation that's measurably blocking.
    const _yieldToMain = () => {
        if (typeof window.scheduler !== 'undefined' && typeof window.scheduler.yield === 'function') {
            return window.scheduler.yield();
        }
        return new Promise(resolve => setTimeout(resolve, 0));
    };

    // One-time JS migration: ensure all templates exist + backfill new columns
    const _migrateFollowUpTemplateColumns = async () => {
        try {
            // Never run against an unauthenticated read: RLS answers it with
            // 0 rows, which made this seeder re-create every default template
            // (31 rows straight into the sync queue) on one bad boot.
            if (window.AppDataStore && typeof AppDataStore.hasLiveSession === 'function'
                && !AppDataStore.hasLiveSession()) return;
            const templates = await AppDataStore.getAll('follow_up_templates');
            const existing = (templates || []);

            // Deactivate legacy templates superseded by the new category-based system
            const _LEGACY_DEACTIVATE = {
                cps_9star:    { is_active: false, event_keywords: '个人风水基础课', solution_category_match: 'Power Ring', eligibility_tiers: 'active' },
                cps_fengshui: { is_active: false, event_keywords: '环境风水基础课', solution_category_match: '风水方案', eligibility_tiers: 'active' },
                cps_huiji:    { is_active: false, event_keywords: '汇集-商业,汇集-灵活,汇集-简易,汇聚-专案', solution_category_match: '', eligibility_tiers: 'active' },
            };
            for (const tpl of existing) {
                await _yieldToMain(); // yield between rows so input stays responsive
                if (_LEGACY_DEACTIVATE[tpl.trigger_type] && tpl.is_active !== false) {
                    await AppDataStore.update('follow_up_templates', tpl.id, {
                        ..._LEGACY_DEACTIVATE[tpl.trigger_type],
                        updated_at: new Date().toISOString()
                    });
                }
            }

            // Seed missing templates from _TRIGGER_DEFAULTS
            for (const [tType, defaults] of Object.entries(_TRIGGER_DEFAULTS)) {
                await _yieldToMain();
                if (!existing.some(t => t.trigger_type === tType)) {
                    // No explicit id — data.js stamps an integer. The old
                    // Date.now()+Math.random() float was rejected by the
                    // bigint id column (22P02) and poisoned the sync queue.
                    await AppDataStore.create('follow_up_templates', {
                        trigger_type: tType,
                        is_active: true,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                        ...defaults
                    });
                }
            }

            // Backfill solution_category_match + eligibility_tiers on existing rows that lack them
            for (const tpl of existing) {
                if (_LEGACY_DEACTIVATE[tpl.trigger_type]) continue; // already handled above
                if (tpl.eligibility_tiers != null && tpl.eligibility_tiers !== '') continue; // already migrated
                const defaults = _TRIGGER_DEFAULTS[tpl.trigger_type];
                if (!defaults) continue;
                await AppDataStore.update('follow_up_templates', tpl.id, {
                    trigger_category: defaults.trigger_category,
                    event_keywords: defaults.event_keywords,
                    cps_interest_match: defaults.cps_interest_match,
                    solution_match: defaults.solution_match,
                    solution_category_match: defaults.solution_category_match || '',
                    eligibility_tiers: defaults.eligibility_tiers || 'active',
                    icon: defaults.icon,
                    description: defaults.description,
                    sort_order: defaults.sort_order,
                    event_window_days: defaults.event_window_days,
                    updated_at: new Date().toISOString()
                });
            }
            invalidateFollowUpTemplatesCache();
        } catch (e) { console.warn('Follow-up template migration failed:', e); }
    };

    const getFollowUpTemplate = async (triggerType) => {
        const templates = await loadFollowUpTemplates();
        return templates.find(t => t.trigger_type === triggerType && t.is_active);
    };

    const interpolateTemplate = (template, vars) => {
        let msg = template;
        for (const [key, val] of Object.entries(vars)) {
            // Use a function replacer so '$' sequences in user values (names,
            // venues, prices like "$5", or literal "$&") are inserted verbatim.
            // String.replace's string-arg form treats $&/$1/$`/$'/$$ specially,
            // which silently corrupts the interpolated message.
            const replacement = val || '';
            msg = msg.replace(new RegExp(`\\{${key}\\}`, 'g'), () => replacement);
        }
        return msg;
    };

    // Session-scoped in-flight guard for createFollowUpDraft. The dedup below is
    // a check-then-create (getAll → find dup → create) with no DB lock, so two
    // concurrent producers (solution reminders, overdue escalation, birthday/
    // event/APU generators, or two open tabs) can both read a stale snapshot,
    // both miss the dup, and both insert. Keying an in-flight Set by the same
    // natural dedup key collapses the window for the common same-tab burst:
    // the second caller bails before its create commits.
    const _followUpDraftInFlight = new Set();
    const _followUpDedupKey = (opts) => {
        const _n = (s) => String(s || '').trim().toLowerCase();
        const person = opts.prospectId ? `p:${opts.prospectId}`
                     : opts.customerId ? `c:${opts.customerId}` : 'n:?';
        if (opts.triggerType === 'birthday' || opts.triggerType === 're_engagement' || opts.triggerType === 'cust_checkin' || opts.triggerType === 'apu_ack' || opts.triggerType === 'card_expiry') return `${person}|${opts.triggerType}|${opts.dueDate || ''}`;
        // appointment_reminder's eventId is an ACTIVITY id (its own id-space, not events.id)
        // — namespace it so it can't collide with an event invite sharing the same number.
        if (opts.triggerType === 'appointment_reminder') return `${person}|appt:${opts.eventId || ''}`;
        // voucher_unredeemed's eventId is a prospect_attachments id (its own id-space, not
        // events.id) — namespace it so it can't collide with an event invite sharing the same number.
        if (opts.triggerType === 'voucher_unredeemed') return `${person}|voucher:${opts.eventId || ''}`;
        if (opts.eventId) return `${person}|eid:${opts.eventId}`;
        if (opts.eventName && opts.eventDate) return `${person}|en:${_n(opts.eventName)}|ed:${opts.eventDate}`;
        return `${person}|t:${opts.triggerType}`;
    };

    const createFollowUpDraft = async (opts) => {
        const { prospectId, customerId, triggerType, messageText, phone, prospectName, eventId, eventDate, eventName, dueDate, attachmentUrl } = opts;
        // Resolve the owning agent. Callers may pass an explicit agentId (e.g.
        // the prospect/customer responsible_agent_id) to attribute the draft
        // even when _state.cu is the dispatching user. Falling back to a NULL
        // agent_id is unsafe: renderFollowUpReminders shows null-agent drafts to
        // EVERY agent, leaking a prospect's name/phone/message cross-agent. So
        // refuse to create the draft when no agent can be attributed.
        const _draftAgentId = (opts.agentId != null ? opts.agentId : _state.cu?.id) || null;
        if (_draftAgentId == null) {
            console.warn('createFollowUpDraft: no agent_id resolvable — skipping to avoid a cross-agent-visible draft', { triggerType });
            return null;
        }
        const _inflightKey = _followUpDedupKey(opts);
        if (_followUpDraftInFlight.has(_inflightKey)) return null; // a concurrent call is already creating this exact draft
        _followUpDraftInFlight.add(_inflightKey);
        try {
            // Dedup regardless of status — once a draft exists (pending/sent/
            // dismissed), don't recreate it. The agent's decision sticks.
            //
            // Two failure modes this needs to handle:
            //   (a) Events catalog has duplicate rows for the same conceptual
            //       event (different agents re-created it). event_id-only
            //       matching lets each duplicate row spawn its own draft.
            //   (b) One prospect has multiple cps_interest categories (e.g.
            //       Power Ring + 风水方案 + 课程) and several templates target
            //       the same upcoming event — so trigger_type-scoped dedup
            //       fires 3 different drafts for the same person to invite
            //       to the same event. Customer should only get ONE invite.
            //
            // Strategy:
            //   - birthday trigger: dedup by (person, type, due_date)
            //   - non-event triggers (APU, etc.): dedup by (person, type)
            //   - event-based triggers: dedup by (person, event), IGNORING
            //     trigger_type, so case (b) collapses. Match the event by
            //     event_id OR (event_name, event_date) so case (a) collapses.
            const _norm = (s) => String(s || '').trim().toLowerCase();
            const existing = await AppDataStore.getAll('follow_up_drafts');
            const dup = existing.find(d => {
                const personMatch = (prospectId && d.prospect_id == prospectId) ||
                                    (customerId && d.customer_id == customerId);
                if (!personMatch) return false;
                if (triggerType === 'birthday' || triggerType === 're_engagement' || triggerType === 'cust_checkin' || triggerType === 'apu_ack' || triggerType === 'card_expiry') {
                    // Episode-keyed dedup: re_engagement passes last_activity_date as
                    // due_date, so a NEW no-contact gap (after the agent logs a fresh
                    // contact) re-arms the nudge, while repeated calendar loads within
                    // the same gap stay deduped — and a dismissal sticks for that gap.
                    // card_expiry keys on the (expiry-derived) due_date so re-saving the
                    // same closing dedups, but a renewed card (new expiry → new due_date)
                    // arms a fresh reminder.
                    return d.trigger_type === triggerType && d.due_date === dueDate;
                }
                if (triggerType === 'appointment_reminder') {
                    // event_id here is an ACTIVITY id (separate id-space from the events.id
                    // that event invites store). Scope dedup to this trigger so a colliding
                    // events.id can't suppress — or be suppressed by — an appointment reminder.
                    return d.trigger_type === triggerType && d.event_id == eventId;
                }
                if (triggerType === 'voucher_unredeemed') {
                    // event_id here is a prospect_attachments id (separate id-space from the
                    // events.id that event invites store). Scope dedup to this trigger so a
                    // colliding events.id can't suppress — or be suppressed by — a voucher nudge.
                    return d.trigger_type === triggerType && d.event_id == eventId;
                }
                if (!eventId) {
                    return d.trigger_type === triggerType;
                }
                if (d.event_id == eventId) return true;
                if (opts.eventName && d.event_name && opts.eventDate && d.event_date
                    && _norm(opts.eventName) === _norm(d.event_name)
                    && opts.eventDate === d.event_date) return true;
                return false;
            });
            if (dup) return null; // already exists

            // Hard comfort ceiling (Phase 6): never produce more than COMFORT_MAX_PER_30D
            // proactive drafts for ONE person in any rolling 30 days, across ALL trigger
            // types combined. Placed AFTER dedup so a re-fire of an existing draft never
            // counts against the budget. Reuses the `existing` snapshot already fetched above.
            const COMFORT_MAX_PER_30D = 6;
            const _ceilFloorMs = Date.now() - 30 * 86400000;
            const _recentForPerson = existing.filter(d => {
                const personMatch = (prospectId && d.prospect_id == prospectId) ||
                                    (customerId && d.customer_id == customerId);
                if (!personMatch) return false;
                const t = d.created_at ? new Date(d.created_at).getTime() : 0;
                return t >= _ceilFloorMs;
            }).length;
            // Compliance-style reminders (card_expiry) opt out of the comfort ceiling: they are
            // future-dated and time-critical (a lapsed card breaks installment collection), so
            // they must never be silently dropped just because the person got other nudges.
            if (!opts.bypassComfortCeiling && _recentForPerson >= COMFORT_MAX_PER_30D) {
                console.warn('createFollowUpDraft: 30-day comfort ceiling reached for person — skipping', { prospectId, customerId, triggerType });
                return null;
            }

            return await AppDataStore.create('follow_up_drafts', {
                prospect_id: prospectId || null,
                customer_id: customerId || null,
                agent_id: _draftAgentId,
                trigger_type: triggerType,
                message_text: messageText,
                phone: phone || '',
                prospect_name: prospectName || '',
                event_id: eventId || null,
                event_date: eventDate || null,
                event_name: eventName || '',
                due_date: dueDate || _localDateStr(new Date()),
                attachment_url: attachmentUrl || null,
                status: 'pending'
            });
        } catch (e) {
            console.warn('createFollowUpDraft failed:', e);
            return null;
        } finally {
            _followUpDraftInFlight.delete(_inflightKey); // release the in-flight guard once this create resolves/fails
        }
    };

    // ── Credit-card-expiry reminder (installment closings) ───────────────────────
    // A POP/NPO installment charged to a credit card lapses when the card expires,
    // so the office must chase updated card details BEFORE that happens. Given a card
    // expiry (YYYY-MM from an <input type="month">), return the reminder due_date: the
    // first day of the month ONE month before the expiry month. Cards die at month-end,
    // so this surfaces the nudge ~1 month before collection would fail. Returns null on
    // a malformed expiry so the caller skips scheduling rather than arming a bad date.
    const _cardExpiryDueDate = (expiryYYYYMM) => {
        const m = /^(\d{4})-(\d{2})$/.exec(String(expiryYYYYMM || '').trim());
        if (!m) return null;
        let y = parseInt(m[1], 10);
        let mo = parseInt(m[2], 10); // 1–12
        if (mo < 1 || mo > 12) return null;
        mo -= 1;                     // one month before the expiry month
        if (mo < 1) { mo = 12; y -= 1; }
        return `${y}-${String(mo).padStart(2, '0')}-01`;
    };

    // Arm (or refresh) the "collect updated credit-card details" reminder for an
    // installment closing. The draft is future-dated (composeFollowUpList hides it
    // until due_date <= today), attributed to the closing's responsible agent, and
    // dedup-keyed on (person, card_expiry, due_date) so re-saving the same closing
    // never piles up while a renewed card (new expiry) arms a fresh reminder.
    const scheduleCardExpiryReminder = async (opts = {}) => {
        try {
            const due = _cardExpiryDueDate(opts.expiry);
            if (!due) return null;
            if (!opts.prospectId && !opts.customerId) return null;
            const mm = /^(\d{4})-(\d{2})$/.exec(String(opts.expiry).trim());
            const expLabel = mm ? `${mm[2]}/${mm[1]}` : String(opts.expiry);
            const agentName = _state.cu?.full_name || '';
            const name = opts.name || '';
            const methodTag = opts.method ? `（${opts.method}）` : '';
            // Renewed card → retire this person's OTHER pending card_expiry drafts (a
            // different due_date = a superseded expiry) so the stale nudge with the old
            // date doesn't also fire. Best-effort; never blocks arming the new reminder.
            try {
                const _existingDrafts = await AppDataStore.getAll('follow_up_drafts');
                const _stale = (_existingDrafts || []).filter(d =>
                    d && d.trigger_type === 'card_expiry' && d.status === 'pending' && d.due_date !== due &&
                    ((opts.prospectId && d.prospect_id == opts.prospectId) || (opts.customerId && d.customer_id == opts.customerId)));
                for (const d of _stale) {
                    await AppDataStore.update('follow_up_drafts', d.id, { status: 'dismissed', updated_at: new Date().toISOString() });
                }
            } catch (_supersede) { /* best-effort supersede */ }
            // Greeting drops the "Hi {name}" prefix when no name is on file (avoids "Hi ，…").
            const greeting = name ? `Hi ${name}，您好 😊` : '您好 😊';
            const msg = `${greeting} 我们的记录显示您用于分期付款${methodTag}的信用卡将于 ${expLabel} 到期。为确保接下来的分期扣款顺利进行，烦请您尽快向公司更新并提交最新的信用卡资料。谢谢您的配合！— ${agentName}`;
            return await createFollowUpDraft({
                prospectId: opts.prospectId || null,
                customerId: opts.customerId || null,
                agentId: opts.agentId || null,
                triggerType: 'card_expiry',
                messageText: msg,
                phone: opts.phone || '',
                prospectName: name,
                dueDate: due,
                bypassComfortCeiling: true,
            });
        } catch (e) {
            console.warn('scheduleCardExpiryReminder failed:', e);
            return null;
        }
    };

    // ========== GENERIC TRIGGER ENGINE (data-driven from follow_up_templates) ==========

    // Parse event.categories (JSON string or array) into array of strings
    const _parseEventCats = (raw) => {
        if (!raw) return [];
        if (Array.isArray(raw)) return raw;
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            /* intentional: not JSON — fall back to comma-split parsing */
            return String(raw).split(',').map(s => s.trim()).filter(Boolean);
        }
    };

    // Interest/known-proposal → event CATEGORY. Owner-confirmed 2026-06-22: a prospect's stated
    // CPS INTEREST (not just a formal proposal) should flag them for the matching class, and
    // proposal names whose product isn't in the products table still map. These feed an
    // "implied category" OR'd into the event-invite solCatOk — so cps_interest='个人改命' (a ring)
    // is invited to Power-Ring classes, and a proposed 'Office Audit' to 风水方案 classes.
    const _INTEREST_SOLCAT = { '个人改命': 'power ring', '风水': '风水方案', '画作': '画作', '满堂系列': 'bujishu', 'formula': 'formula' };
    const _SOLUTION_SOLCAT = { 'office audit': '风水方案', 'home audit': '风水方案', '风水审计': '风水方案', 'pr3 ring': 'power ring', 'pr5 ring': 'power ring' };
    const _impliedSolCats = (cpsInterest, solNames) => {
        const out = [];
        const it = (cpsInterest || '').trim().toLowerCase();
        if (_INTEREST_SOLCAT[it]) out.push(_INTEREST_SOLCAT[it]);
        for (const n of (solNames || [])) { const c = _SOLUTION_SOLCAT[(n || '').toLowerCase()]; if (c) out.push(c); }
        return out;
    };

    // Check if an event matches template target categories (used by all event-based triggers)
    const _eventMatchesTemplate = (event, tpl) => {
        const targetCats = (tpl.event_keywords || '').split(',').map(k => k.trim()).filter(Boolean);
        if (!targetCats.length) return false;
        const eventCats = _parseEventCats(event.categories);
        return targetCats.some(tc => eventCats.includes(tc));
    };

    // Shared: find ALL matching events by category within window (sorted by date ascending)
    const _findMatchingEvents = async (tpl) => {
        const targetCats = (tpl.event_keywords || '').split(',').map(k => k.trim()).filter(Boolean);
        if (!targetCats.length) return [];
        const events = await AppDataStore.getAll('events');
        const today = new Date();
        const todayStr = _localDateStr(today);
        const windowEnd = new Date(today);
        windowEnd.setDate(windowEnd.getDate() + (tpl.event_window_days || 60));
        const windowEndStr = _localDateStr(windowEnd);

        return events.filter(e => {
            const eDate = e.event_date || e.date || '';
            return _eventMatchesTemplate(e, tpl) &&
                eDate >= todayStr && eDate <= windowEndStr &&
                (e.status || '').toLowerCase() !== 'cancelled';
        }).sort((a, b) => (a.event_date || a.date || '').localeCompare(b.event_date || b.date || ''));
    };

    // Legacy alias: find the NEXT matching event (used by reactive triggers)
    const _findNextMatchingEvent = async (tpl) => {
        const matches = await _findMatchingEvents(tpl);
        return matches[0] || null;
    };

    // Generic: event-based trigger (for after_cps and similar)
    const executeEventBasedTrigger = async (tpl, prospectId, prospectName, phone) => {
        if (!tpl || !tpl.is_active) return;
        const nextEvent = await _findNextMatchingEvent(tpl);
        if (!nextEvent) return;

        const msg = interpolateTemplate(tpl.message_template, {
            name: prospectName,
            date: nextEvent.event_date || nextEvent.date || '',
            time: (nextEvent.start_time || nextEvent.time || '').slice(0, 5),
            venue: nextEvent.location || '',
            event_name: nextEvent.event_title || nextEvent.title || '',
            agent_name: _state.cu?.full_name || ''
        });

        await createFollowUpDraft({
            prospectId,
            triggerType: tpl.trigger_type,
            messageText: msg,
            phone,
            prospectName,
            eventId: nextEvent.id,
            eventDate: nextEvent.event_date || nextEvent.date,
            eventName: nextEvent.event_title || nextEvent.title,
            dueDate: _localDateStr(new Date()), // local (MYT) day — toISOString() rolls back a day before 08:00 MYT
            attachmentUrl: nextEvent.poster_url || null   // event poster → sent as a real image on WhatsApp
        });
    };

    // Generic: simple trigger (no event lookup — APU, birthday, etc.)
    const executeSimpleTrigger = async (tpl, entity, extraVars = {}) => {
        if (!tpl || !tpl.is_active) return;
        const msg = interpolateTemplate(tpl.message_template, {
            name: entity.full_name || '',
            agent_name: _state.cu?.full_name || '',
            ...extraVars
        });

        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + (tpl.delay_days || 0));

        await createFollowUpDraft({
            prospectId: entity._type !== 'customer' ? entity.id : null,
            customerId: entity._type === 'customer' ? entity.id : null,
            triggerType: tpl.trigger_type,
            messageText: msg,
            phone: entity.phone || '',
            prospectName: entity.full_name || '',
            dueDate: _localDateStr(dueDate),
            attachmentUrl: extraVars.photo_url || null
        });
    };

    // Dispatcher: after CPS consultation — checks cps_interest_match + solution_match + solution_category_match
    const dispatchAfterCpsTriggers = async (prospectId) => {
        const templates = await loadFollowUpTemplates();
        const cpsTriggers = templates.filter(t => t.trigger_category === 'after_cps' && t.is_active);
        if (!cpsTriggers.length) return;

        const prospect = await AppDataStore.getById('prospects', prospectId);
        if (!prospect) return;
        if (prospect.unable_to_serve) return; // greyed-out prospects are excluded from all automation
        const interest = (prospect.cps_interest || '').trim().toLowerCase();

        // Build product name→category map for category matching
        let productCatMap = {};
        try {
            const prods = await AppDataStore.query('products', {});
            (prods || []).forEach(p => {
                if (p.name && p.category) productCatMap[p.name.toLowerCase()] = p.category.toLowerCase();
            });
        } catch (e) { /* products table may not be seeded */ }

        let solutionNames = [];
        let solutionCategories = [];
        try {
            const solutions = await AppDataStore.query('proposed_solutions', { prospect_id: prospectId });
            solutionNames = (solutions || []).map(s => (s.solution || '').toLowerCase());
            solutionCategories = solutionNames.map(n => productCatMap[n] || '').filter(Boolean);
        } catch (e) { /* proposed_solutions may not exist yet */ }

        for (const tpl of cpsTriggers) {
            const interestList = (tpl.cps_interest_match || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            const solutionList = (tpl.solution_match || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            const solCatList   = (tpl.solution_category_match || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

            const interestOk = !interestList.length || interestList.some(m => interest.includes(m));
            const solutionOk = !solutionList.length || solutionList.some(m => solutionNames.some(s => s.includes(m)));
            const solCatOk   = !solCatList.length   || solCatList.some(m => solutionCategories.some(c => c.includes(m)));

            // Skip if any match criteria are defined but none match.
            // #3: only the criteria the template ACTUALLY specifies gate the match — an
            // empty sub-list must be NEUTRAL, not vacuously true (same fix as
            // dispatchProactiveEventInvites / dispatchOnNewCalendarEvent). Previously
            // every *Ok flag defaulted true for an empty list, so a template setting
            // only one criterion always passed and fired for every prospect.
            const _matchChecks = [];
            if (interestList.length) _matchChecks.push(interestOk);
            if (solutionList.length) _matchChecks.push(solutionOk);
            if (solCatList.length)   _matchChecks.push(solCatOk);
            if (_matchChecks.length && !_matchChecks.some(Boolean)) continue;

            executeEventBasedTrigger(tpl, prospectId, prospect.full_name, prospect.phone).catch(e => console.warn(`CPS trigger ${tpl.trigger_type} failed:`, e));
        }
    };

    // Dispatcher: on event attendance
    const dispatchOnEventAttendanceTriggers = async (entityId, entityType, eventId, activityDate) => {
        const templates = await loadFollowUpTemplates();
        const triggers = templates.filter(t => t.trigger_category === 'on_event_attendance' && t.is_active);
        if (!triggers.length) return;

        const event = await AppDataStore.getById('events', eventId);
        if (!event) return;

        const entity = entityType === 'customer'
            ? await AppDataStore.getById('customers', entityId)
            : await AppDataStore.getById('prospects', entityId);
        if (!entity) return;

        for (const tpl of triggers) {
            // Match by event categories (same logic as other triggers)
            if (!_eventMatchesTemplate(event, tpl)) continue;

            const msg = interpolateTemplate(tpl.message_template, {
                name: entity.full_name || '',
                event_name: event.event_title || event.title || '',
                agent_name: _state.cu?.full_name || ''
            });

            const dueDate = new Date(activityDate || Date.now());
            dueDate.setDate(dueDate.getDate() + (tpl.delay_days || 0));

            await createFollowUpDraft({
                prospectId: entityType !== 'customer' ? entityId : null,
                customerId: entityType === 'customer' ? entityId : null,
                triggerType: tpl.trigger_type,
                messageText: msg,
                phone: entity.phone || '',
                prospectName: entity.full_name || '',
                eventId,
                eventDate: activityDate,
                eventName: event.event_title || event.title,
                dueDate: _localDateStr(dueDate)
            });
        }
    };

    // Dispatcher: on APU photo upload — passes latest photo URL to template as {photo_url}
    const dispatchOnApuPhotoTriggers = async (prospectId) => {
        const templates = await loadFollowUpTemplates();
        const triggers = templates.filter(t => t.trigger_category === 'on_apu_photo' && t.is_active);
        if (!triggers.length) return;

        const prospect = await AppDataStore.getById('prospects', prospectId);
        if (!prospect) return;
        prospect._type = 'prospect';

        // Extract latest APU photo URL from prospect_attachments table
        const apuRows = await AppDataStore.query('prospect_attachments', { prospect_id: prospectId, attachment_type: 'apu_form' });
        const latestPhotoUrl = apuRows.length ? apuRows[apuRows.length - 1].file_url : '';

        for (const tpl of triggers) {
            executeSimpleTrigger(tpl, prospect, { photo_url: latestPhotoUrl }).catch(e => console.warn(`APU trigger ${tpl.trigger_type} failed:`, e));
        }
    };

    // One-time bulk: create APU follow-up drafts for all prospects who already have
    // APU attachments in prospect_attachments but never got the trigger.
    // Assigns each draft to the prospect's own responsible_agent_id, not the admin running this.
    const bulkDispatchApuReminders = async () => {
        UI.toast.success('Scanning prospects with APU photos…');
        try {
            // Force-refresh cache so we get the latest templates
            invalidateFollowUpTemplatesCache();
            const templates = await loadFollowUpTemplates();
            const triggers = templates.filter(t => t.trigger_category === 'on_apu_photo' && t.is_active);
            if (!triggers.length) {
                UI.toast.error('No active APU template found — enable "APU Appointment Reminder" in Automation settings first.');
                return;
            }

            const [allProspects, allDrafts] = await Promise.all([
                AppDataStore.getAll('prospects'),
                AppDataStore.getAll('follow_up_drafts').catch(() => [])
            ]);

            const allApuAttachments = await AppDataStore.getAll('prospect_attachments').then(rows => rows.filter(r => r.attachment_type === 'apu_form')).catch(() => []);
            const apuByProspect = {};
            for (const row of allApuAttachments) {
                if (!apuByProspect[row.prospect_id]) apuByProspect[row.prospect_id] = [];
                apuByProspect[row.prospect_id].push(row.file_url);
            }
            const withApu = allProspects.filter(p => apuByProspect[p.id]?.length > 0);
            if (!withApu.length) { UI.toast.error('No prospects with APU photos found.'); return; }

            let created = 0, skipped = 0;

            for (const p of withApu) {
                const urls = apuByProspect[p.id];
                const latestPhotoUrl = urls[urls.length - 1];
                for (const tpl of triggers) {
                    const dup = allDrafts.find(d =>
                        d.prospect_id == p.id &&
                        d.trigger_type === tpl.trigger_type &&
                        !d.event_id
                    );
                    if (dup) { skipped++; continue; }

                    const msg = interpolateTemplate(tpl.message_template, {
                        name: p.full_name || '',
                        agent_name: _state.cu?.full_name || '',
                        photo_url: latestPhotoUrl
                    });
                    const dueDate = new Date();
                    dueDate.setDate(dueDate.getDate() + (tpl.delay_days || 0));

                    const draft = await AppDataStore.create('follow_up_drafts', {
                        prospect_id: p.id,
                        customer_id: null,
                        agent_id: p.responsible_agent_id || _state.cu?.id || null,
                        trigger_type: tpl.trigger_type,
                        message_text: msg,
                        phone: p.phone || '',
                        prospect_name: p.full_name || '',
                        event_id: null,
                        event_date: null,
                        event_name: '',
                        due_date: _localDateStr(dueDate),
                        attachment_url: latestPhotoUrl || null,
                        status: 'pending'
                    });
                    if (draft) { created++; allDrafts.push(draft); }
                }
            }

            UI.toast.success(`APU reminders: ${created} created, ${skipped} already existed.`);
            renderFollowUpReminders();
        } catch (e) {
            console.error('bulkDispatchApuReminders failed:', e);
            UI.toast.error('Bulk APU dispatch failed — check console.');
        }
    };

    // Dispatcher: PROACTIVE event invites — scans upcoming events and finds eligible
    // prospects/customers based on solution category, interest, and eligibility tier.
    // Tiers: active (CPS ≤180d) | engaged (>180d + 3+ events) | returning (same category last year) | customer
    const dispatchProactiveEventInvites = async () => {
        const templates = await loadFollowUpTemplates();
        const eventTriggers = templates.filter(t =>
            t.trigger_category === 'after_cps' && t.is_active && (t.event_keywords || '').trim()
        );
        if (!eventTriggers.length) return;

        const today = new Date();
        const todayStr = _localDateStr(today);
        const prevYearStart = `${today.getFullYear() - 1}-01-01`;
        const prevYearEnd   = `${today.getFullYear() - 1}-12-31`;

        const [events, prospects, customers, products] = await Promise.all([
            AppDataStore.getAll('events'),
            AppDataStore.getAll('prospects'),
            AppDataStore.getAll('customers'),
            AppDataStore.getAll('products').catch(() => [])
        ]);

        // product name (lowercase) → category
        const productCatMap = {};
        for (const p of (products || [])) {
            if (p.name && p.category) productCatMap[p.name.toLowerCase()] = p.category.toLowerCase();
        }

        // Index proposed_solutions — both names and product categories
        let allSolutions = [];
        try { allSolutions = await AppDataStore.getAll('proposed_solutions') || []; } catch (e) { /* intentional: optional table, default [] */ }
        const solNamesByProspect = {}, solNamesByCustomer = {};
        const solCatsByProspect  = {}, solCatsByCustomer  = {};
        for (const s of allSolutions) {
            const name = (s.solution || '').toLowerCase();
            const cat  = productCatMap[name] || name; // #4: a proposal may store the bare category (e.g. 'Power Ring'), not a product name — fall back to the solution string itself
            if (s.prospect_id) {
                (solNamesByProspect[s.prospect_id] = solNamesByProspect[s.prospect_id] || []).push(name);
                if (cat) (solCatsByProspect[s.prospect_id] = solCatsByProspect[s.prospect_id] || []).push(cat);
            }
            if (s.customer_id) {
                (solNamesByCustomer[s.customer_id] = solNamesByCustomer[s.customer_id] || []).push(name);
                if (cat) (solCatsByCustomer[s.customer_id] = solCatsByCustomer[s.customer_id] || []).push(cat);
            }
        }

        // Load EVENT activities for Engaged (3+ events) and Returning (same category last year) tiers
        let eventActs = [];
        try { eventActs = (await AppDataStore.getAll('activities')).filter(a => a.activity_type === 'EVENT'); } catch (e) { /* intentional: optional history, default [] */ }
        const eventsMap = Object.fromEntries((events || []).map(e => [String(e.id), e]));
        const eventCountP = {}, eventCountC = {};
        const prevYearCatsP = {}, prevYearCatsC = {};
        for (const a of eventActs) {
            if (a.prospect_id) eventCountP[a.prospect_id] = (eventCountP[a.prospect_id] || 0) + 1;
            if (a.customer_id) eventCountC[a.customer_id] = (eventCountC[a.customer_id] || 0) + 1;
            const d = a.activity_date || '';
            if (d >= prevYearStart && d <= prevYearEnd) {
                const ev = eventsMap[String(a.event_id)];
                if (!ev) continue;
                const cats = _parseEventCats(ev.categories);
                if (a.prospect_id) { if (!prevYearCatsP[a.prospect_id]) prevYearCatsP[a.prospect_id] = new Set(); cats.forEach(c => prevYearCatsP[a.prospect_id].add(c)); }
                if (a.customer_id) { if (!prevYearCatsC[a.customer_id]) prevYearCatsC[a.customer_id] = new Set(); cats.forEach(c => prevYearCatsC[a.customer_id].add(c)); }
            }
        }

        const allPeople = [
            ...prospects.map(p => ({ ...p, _type: 'prospect' })),
            ...customers.map(c => ({ ...c, _type: 'customer' }))
        ];

        for (const tpl of eventTriggers) {
            const targetCats    = (tpl.event_keywords || '').split(',').map(k => k.trim()).filter(Boolean);
            if (!targetCats.length) continue;
            const interestList  = (tpl.cps_interest_match || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            const solutionList  = (tpl.solution_match || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            const solCatList    = (tpl.solution_category_match || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            const tplTiers      = (tpl.eligibility_tiers || 'active').split('|').map(s => s.trim());
            const hasMatchCrit  = interestList.length || solutionList.length || solCatList.length;

            const windowEnd = new Date(today);
            windowEnd.setDate(windowEnd.getDate() + (tpl.event_window_days || 60));
            const windowEndStr = _localDateStr(windowEnd);

            // Instances to invite to = upcoming logged EVENT activities (which carry the
            // per-slot date/time/venue) PLUS catalog events whose `date` falls in the window
            // but were never separately logged as a calendar activity. #5: a published class
            // with no activity previously invited NOBODY (the old comment "catalog has no
            // dates" is stale — events.date exists now). Dedupe by event_id, preferring the
            // logged activity (richer slot info) over the bare catalog row.
            const _actInstances = eventActs.filter(a => {
                const aDate = a.activity_date || '';
                if (aDate < todayStr || aDate > windowEndStr) return false;
                const linkedEv = eventsMap[String(a.event_id)];
                if (!linkedEv) return false;
                if ((linkedEv.status || '').toLowerCase() === 'cancelled') return false;
                return targetCats.some(tc => _parseEventCats(linkedEv.categories).includes(tc));
            });
            const _seenEv = new Set(_actInstances.map(a => String(a.event_id)));
            const _catInstances = (events || []).filter(ev => {
                const d = ev.date || ev.event_date || '';
                if (!d || d < todayStr || d > windowEndStr) return false;
                if ((ev.status || '').toLowerCase() === 'cancelled' || ev.is_active === false) return false;
                if (_seenEv.has(String(ev.id))) return false; // already covered by a logged activity
                return targetCats.some(tc => _parseEventCats(ev.categories).includes(tc));
            }).map(ev => ({ activity_date: ev.date || ev.event_date, start_time: ev.start_time || ev.time || '', location_address: ev.location || '', event_id: ev.id }));
            const matchingInstances = [..._actInstances, ..._catInstances]
                .sort((a, b) => (a.activity_date || '').localeCompare(b.activity_date || ''));
            if (!matchingInstances.length) continue;

            for (const person of allPeople) {
                // #21: a null/empty responsible_agent_id used to fall THROUGH this guard (the
                // leading `responsible_agent_id &&` short-circuits), and the draft was then
                // attributed to the dispatching admin — leaking unowned contacts. Skip them.
                if (person.responsible_agent_id != _state.cu?.id) continue;
                if (person.unable_to_serve) continue;
                if (person._type === 'prospect' && person.manual_grade === 'F') continue; // grade F = dropped, fully dark

                // ── Tier eligibility ──────────────────────────────────────────────────────
                const cpsDate     = person.cps_assignment_date || person.cps_form_date;
                const daysSinceCps = cpsDate ? Math.floor((new Date(todayStr) - new Date(cpsDate)) / 86400000) : 999;
                const isActive    = daysSinceCps >= 0 && daysSinceCps <= 180;
                const pid         = person.id;
                const evCount     = person._type === 'prospect' ? (eventCountP[pid] || 0) : (eventCountC[pid] || 0);
                const isEngaged   = !isActive && evCount >= 3;
                const isCustomer  = person._type === 'customer' || person.conversion_status === 'converted';
                const prevCats    = person._type === 'prospect' ? (prevYearCatsP[pid] || new Set()) : (prevYearCatsC[pid] || new Set());
                const isReturning = targetCats.some(tc => prevCats.has(tc));

                const tierOk =
                    (tplTiers.includes('active')    && isActive)   ||
                    (tplTiers.includes('engaged')   && isEngaged)  ||
                    (tplTiers.includes('returning') && isReturning)||
                    (tplTiers.includes('customer')  && isCustomer  && (isEngaged || isReturning));
                if (!tierOk) continue;

                // ── Solution / interest match ─────────────────────────────────────────────
                const interest       = (person.cps_interest || '').trim().toLowerCase();
                const interestOk     = !interestList.length || interestList.some(m => interest.includes(m));
                const personSolNames = person._type === 'prospect' ? (solNamesByProspect[pid] || []) : (solNamesByCustomer[pid] || []);
                const personSolCats  = person._type === 'prospect' ? (solCatsByProspect[pid]  || []) : (solCatsByCustomer[pid]  || []);
                // Fold in implied categories so stated INTEREST (or an off-catalog proposal name)
                // flags the class, OR'd with the real proposed categories (owner: interest OR proposal).
                const effSolCats     = [...personSolCats, ..._impliedSolCats(person.cps_interest, personSolNames)];
                const solNameOk      = !solutionList.length || solutionList.some(m => personSolNames.some(s => s.includes(m)));
                const solCatOk       = !solCatList.length   || solCatList.some(m => effSolCats.some(c => c.includes(m)));
                // General templates (no match criteria) fire for all tier-qualified people
                // #3: only the criteria the template ACTUALLY specifies gate the match — an
                // empty sub-list must be NEUTRAL, not vacuously true. (pr_9star sets only
                // solution_category_match; empty interest/solution made matchOk always true,
                // inviting EVERY tier-eligible prospect instead of Power-Ring ones.)
                const _matchChecks = [];
                if (interestList.length) _matchChecks.push(interestOk);
                if (solutionList.length) _matchChecks.push(solNameOk);
                if (solCatList.length)   _matchChecks.push(solCatOk);
                const matchOk = !_matchChecks.length || _matchChecks.some(Boolean);
                if (!matchOk) continue;

                for (const act of matchingInstances) {
                    const linkedEv = eventsMap[String(act.event_id)] || {};
                    const msg = interpolateTemplate(tpl.message_template, {
                        name:       person.full_name || '',
                        date:       act.activity_date || '',
                        time:       (act.start_time || '').slice(0, 5),
                        venue:      act.location_address || linkedEv.location || '',
                        event_name: linkedEv.title || linkedEv.event_title || act.activity_title || '',
                        agent_name: _state.cu?.full_name || ''
                    });
                    await createFollowUpDraft({
                        prospectId:   person._type === 'prospect' ? person.id : null,
                        customerId:   person._type === 'customer' ? person.id : null,
                        triggerType:  tpl.trigger_type,
                        messageText:  msg,
                        phone:        person.phone || '',
                        prospectName: person.full_name || '',
                        eventId:      linkedEv.id || act.event_id,
                        eventDate:    act.activity_date,
                        eventName:    linkedEv.title || linkedEv.event_title || '',
                        dueDate:      todayStr,
                        attachmentUrl: linkedEv.poster_url || null   // event poster → sent as a real image on WhatsApp
                    });
                }
            }
        }
    };

    // Dispatcher: fires when a new EVENT activity is saved to the calendar.
    // calActivity = the just-saved activity object (has event_id, activity_date, start_time, location_address).
    // Scans all prospects + customers and creates invite drafts for those who:
    //   1. Pass tier + solution/interest match for a template matching this event's categories
    //   2. Have NOT already attended a PAST event with the same title (future bookings are ignored)
    const dispatchOnNewCalendarEvent = async (calActivity) => {
        if (!calActivity?.event_id) return;

        const today    = new Date();
        const todayStr = _localDateStr(today);
        const prevYearStart = `${today.getFullYear() - 1}-01-01`;
        const prevYearEnd   = `${today.getFullYear() - 1}-12-31`;

        // Load events catalog, then look up the linked marketing event for categories
        const [allEventRows, prospects, customers, products] = await Promise.all([
            AppDataStore.getAll('events').catch(() => []),
            AppDataStore.getAll('prospects'),
            AppDataStore.getAll('customers'),
            AppDataStore.getAll('products').catch(() => [])
        ]);
        const eventsMap  = Object.fromEntries(allEventRows.map(e => [String(e.id), e]));
        const linkedEv   = eventsMap[String(calActivity.event_id)];
        if (!linkedEv) return;

        const linkedEvTitle = (linkedEv.title || linkedEv.event_title || '').toLowerCase();
        const linkedEvCats  = _parseEventCats(linkedEv.categories);
        if (!linkedEvCats.length) return;

        const templates = await loadFollowUpTemplates();
        const matchingTpls = templates.filter(t =>
            t.trigger_category === 'after_cps' && t.is_active &&
            (t.event_keywords || '').split(',').map(k => k.trim()).some(kw => linkedEvCats.includes(kw))
        );
        if (!matchingTpls.length) return;

        const productCatMap = {};
        for (const p of (products || [])) {
            if (p.name && p.category) productCatMap[p.name.toLowerCase()] = p.category.toLowerCase();
        }

        let allSolutions = [];
        try { allSolutions = await AppDataStore.getAll('proposed_solutions') || []; } catch (e) { /* intentional: optional table, default [] */ }
        const solNamesByProspect = {}, solNamesByCustomer = {};
        const solCatsByProspect  = {}, solCatsByCustomer  = {};
        for (const s of allSolutions) {
            const name = (s.solution || '').toLowerCase();
            const cat  = productCatMap[name] || name; // #4: a proposal may store the bare category (e.g. 'Power Ring'), not a product name — fall back to the solution string itself
            if (s.prospect_id) {
                (solNamesByProspect[s.prospect_id] = solNamesByProspect[s.prospect_id] || []).push(name);
                if (cat) (solCatsByProspect[s.prospect_id] = solCatsByProspect[s.prospect_id] || []).push(cat);
            }
            if (s.customer_id) {
                (solNamesByCustomer[s.customer_id] = solNamesByCustomer[s.customer_id] || []).push(name);
                if (cat) (solCatsByCustomer[s.customer_id] = solCatsByCustomer[s.customer_id] || []).push(cat);
            }
        }

        // Build per-person event history from PAST activities only (future bookings don't count as attended)
        let eventActs = [];
        try { eventActs = (await AppDataStore.getAll('activities')).filter(a => a.activity_type === 'EVENT'); } catch (e) { /* intentional: optional history, default [] */ }
        const eventCountP = {}, eventCountC = {};
        const prevYearCatsP = {}, prevYearCatsC = {};
        const attendedTitlesP = {}, attendedTitlesC = {};

        for (const a of eventActs) {
            if (a.prospect_id) eventCountP[a.prospect_id] = (eventCountP[a.prospect_id] || 0) + 1;
            if (a.customer_id) eventCountC[a.customer_id] = (eventCountC[a.customer_id] || 0) + 1;
            const ev = eventsMap[String(a.event_id)];
            if (!ev) continue;
            // Only past activities count as "attended" — future bookings must not block invites
            const isPast = (a.activity_date || '') < todayStr;
            if (isPast) {
                const evTitle = (ev.title || ev.event_title || '').toLowerCase();
                if (a.prospect_id) { if (!attendedTitlesP[a.prospect_id]) attendedTitlesP[a.prospect_id] = new Set(); attendedTitlesP[a.prospect_id].add(evTitle); }
                if (a.customer_id) { if (!attendedTitlesC[a.customer_id]) attendedTitlesC[a.customer_id] = new Set(); attendedTitlesC[a.customer_id].add(evTitle); }
            }
            const d = a.activity_date || '';
            if (d >= prevYearStart && d <= prevYearEnd) {
                const cats = _parseEventCats(ev.categories);
                if (a.prospect_id) { if (!prevYearCatsP[a.prospect_id]) prevYearCatsP[a.prospect_id] = new Set(); cats.forEach(c => prevYearCatsP[a.prospect_id].add(c)); }
                if (a.customer_id) { if (!prevYearCatsC[a.customer_id]) prevYearCatsC[a.customer_id] = new Set(); cats.forEach(c => prevYearCatsC[a.customer_id].add(c)); }
            }
        }

        const allPeople = [
            ...prospects.map(p => ({ ...p, _type: 'prospect' })),
            ...customers.map(c => ({ ...c, _type: 'customer' }))
        ];

        let draftsCreated = 0;
        for (const tpl of matchingTpls) {
            const targetCats   = (tpl.event_keywords || '').split(',').map(k => k.trim()).filter(Boolean);
            const interestList = (tpl.cps_interest_match || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            const solutionList = (tpl.solution_match || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            const solCatList   = (tpl.solution_category_match || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            const tplTiers     = (tpl.eligibility_tiers || 'active').split('|').map(s => s.trim());
            const hasMatchCrit = interestList.length || solutionList.length || solCatList.length;

            for (const person of allPeople) {
                // #21: skip null-owner contacts (the `&&` short-circuit previously let them
                // through, mis-attributing the draft to the dispatching admin).
                if (person.responsible_agent_id != _state.cu?.id) continue;
                if (person.unable_to_serve) continue;
                if (person._type === 'prospect' && person.manual_grade === 'F') continue; // grade F = dropped, fully dark

                const pid = person.id;

                // Skip if already attended a past event with the same title
                const myTitles = person._type === 'prospect' ? (attendedTitlesP[pid] || new Set()) : (attendedTitlesC[pid] || new Set());
                if (linkedEvTitle && myTitles.has(linkedEvTitle)) continue;

                // Tier eligibility
                const cpsDate      = person.cps_assignment_date || person.cps_form_date;
                const daysSinceCps = cpsDate ? Math.floor((new Date(todayStr) - new Date(cpsDate)) / 86400000) : 999;
                const isActive     = daysSinceCps >= 0 && daysSinceCps <= 180;
                const evCount      = person._type === 'prospect' ? (eventCountP[pid] || 0) : (eventCountC[pid] || 0);
                const isEngaged    = !isActive && evCount >= 3;
                const isCustomer   = person._type === 'customer' || person.conversion_status === 'converted';
                const prevCats     = person._type === 'prospect' ? (prevYearCatsP[pid] || new Set()) : (prevYearCatsC[pid] || new Set());
                const isReturning  = targetCats.some(tc => prevCats.has(tc));

                const tierOk =
                    (tplTiers.includes('active')    && isActive)    ||
                    (tplTiers.includes('engaged')   && isEngaged)   ||
                    (tplTiers.includes('returning') && isReturning) ||
                    (tplTiers.includes('customer')  && isCustomer   && (isEngaged || isReturning));
                if (!tierOk) continue;

                // Solution / interest match
                const interest       = (person.cps_interest || '').trim().toLowerCase();
                const interestOk     = !interestList.length || interestList.some(m => interest.includes(m));
                const personSolNames = person._type === 'prospect' ? (solNamesByProspect[pid] || []) : (solNamesByCustomer[pid] || []);
                const personSolCats  = person._type === 'prospect' ? (solCatsByProspect[pid]  || []) : (solCatsByCustomer[pid]  || []);
                // Fold in implied categories so stated INTEREST (or an off-catalog proposal name)
                // flags the class, OR'd with the real proposed categories (owner: interest OR proposal).
                const effSolCats     = [...personSolCats, ..._impliedSolCats(person.cps_interest, personSolNames)];
                const solNameOk      = !solutionList.length || solutionList.some(m => personSolNames.some(s => s.includes(m)));
                const solCatOk       = !solCatList.length   || solCatList.some(m => effSolCats.some(c => c.includes(m)));
                // #3: only the criteria the template ACTUALLY specifies gate the match — an
                // empty sub-list must be NEUTRAL, not vacuously true. (pr_9star sets only
                // solution_category_match; empty interest/solution made matchOk always true,
                // inviting EVERY tier-eligible prospect instead of Power-Ring ones.)
                const _matchChecks = [];
                if (interestList.length) _matchChecks.push(interestOk);
                if (solutionList.length) _matchChecks.push(solNameOk);
                if (solCatList.length)   _matchChecks.push(solCatOk);
                const matchOk = !_matchChecks.length || _matchChecks.some(Boolean);
                if (!matchOk) continue;

                const msg = interpolateTemplate(tpl.message_template, {
                    name:       person.full_name || '',
                    date:       calActivity.activity_date || '',
                    time:       (calActivity.start_time || '').slice(0, 5),
                    venue:      calActivity.location_address || linkedEv.location || '',
                    event_name: linkedEv.title || linkedEv.event_title || '',
                    agent_name: _state.cu?.full_name || ''
                });

                await createFollowUpDraft({
                    prospectId:   person._type === 'prospect' ? person.id : null,
                    customerId:   person._type === 'customer' ? person.id : null,
                    triggerType:  tpl.trigger_type,
                    messageText:  msg,
                    phone:        person.phone || '',
                    prospectName: person.full_name || '',
                    eventId:      linkedEv.id,
                    eventDate:    calActivity.activity_date,
                    eventName:    linkedEv.title || linkedEv.event_title || '',
                    dueDate:      todayStr,
                    attachmentUrl: linkedEv.poster_url || null   // event poster → sent as a real image on WhatsApp
                });
                draftsCreated++;
            }
        }

        if (draftsCreated > 0) {
            UI.toast.success(`${draftsCreated} invite reminder${draftsCreated > 1 ? 's' : ''} queued for this event`);
        }
    };

    // Dispatcher: birthday triggers — called on calendar load
    const dispatchBirthdayTriggers = async () => {
        const templates = await loadFollowUpTemplates();
        const triggers = templates.filter(t => t.trigger_category === 'on_birthday' && t.is_active);
        if (!triggers.length) return;

        const today = new Date();
        const todayMD = `${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;

        const [prospects, customers] = await Promise.all([
            AppDataStore.getAll('prospects'),
            AppDataStore.getAll('customers')
        ]);

        const allPeople = [
            ...prospects.map(p => ({ ...p, _type: 'prospect' })),
            ...customers.map(c => ({ ...c, _type: 'customer' }))
        ];

        for (const person of allPeople) {
            if (!person.date_of_birth) continue;
            const dobMD = person.date_of_birth.slice(5);
            if (dobMD !== todayMD) continue;
            // #21: skip null-owner contacts (the `&&` short-circuit previously let them
            // through, mis-attributing the birthday draft to the dispatching admin).
            if (person.responsible_agent_id != _state.cu?.id) continue;
            if (person._type === 'prospect' && person.manual_grade === 'F') continue; // grade F = dropped, no birthday wish

            for (const tpl of triggers) {
                executeSimpleTrigger(tpl, person).catch(e => console.warn(`Birthday trigger ${tpl.trigger_type} failed:`, e));
            }
        }
    };

    // ── Dispatcher: re-engagement nudges — runs on calendar load ─────────────────────
    // "You haven't contacted {name} in {days} days — they're missing you."
    // For every prospect the current agent owns whose last_activity_date is older than
    // its GRADE cadence (A=3/B=10/C=21/D=30, ungraded->C, F=dark), queue a warm
    // re-connect message in Follow-Up Reminders. Ownership is never changed. The draft
    // is episode-keyed on last_activity_date so logging a fresh contact re-arms the
    // nudge; one-open-reminder + a grade-ranked cap keep the panel from flooding.
    // Grade-driven re-connect cadence: days of no contact before a nudge surfaces.
    // Grade sets the rhythm (A tightest -> D loosest); ungraded defaults to C; F is dark.
    const GRADE_CADENCE = { A: 3, B: 10, C: 21, D: 30 };
    const GRADE_RANK    = { A: 0, B: 1, C: 2, D: 3 };
    // Decaying back-off (REDESIGNED 2026-06-23): each un-answered nudge WIDENS the next gap and
    // rotates the message up a ladder, so a quiet lead is chased progressively less. The 2026-06-22
    // audit killed the old silence_count approach (it mis-measured churn). This version derives the
    // step from EXISTING data with no extra column/trigger: step = how many re_engagement drafts
    // this agent has DISMISSED for the prospect SINCE their last contact. It auto-increments when
    // the agent dismisses a nudge (gave up → back off), and auto-RESETS to 0 the moment any real
    // contact moves last_activity_date (sending the nudge logs contact too). No hard "seasonal"
    // cutoff — the gap just widens to the RE_ENGAGE_DECAY_CAP_DAYS floor (~quarterly), so a lead is
    // never stranded; the one-open-reminder gate makes each step wait until the prior nudge clears.
    const RE_ENGAGE_DECAY          = [1, 1.6, 2.5, 4]; // step 0,1,2,3+ interval multipliers
    const RE_ENGAGE_DECAY_CAP_DAYS = 120;              // hard floor on max widening
    const SILENCE_SEASONAL_AT      = 4;                // un-answered touches → seasonal-only
    const _silenceStep  = (p) => { const n = parseInt(p && p.silence_count, 10); return (Number.isFinite(n) && n > 0) ? n : 0; };
    const _decayFactor  = (step) => RE_ENGAGE_DECAY[Math.min(step, RE_ENGAGE_DECAY.length - 1)];
    const _baseDays     = (g) => GRADE_CADENCE[g] || GRADE_CADENCE.C; // ungraded -> C (21d)
    const _cadenceDays  = (g, step) => Math.min(RE_ENGAGE_DECAY_CAP_DAYS, Math.round(_baseDays(g) * _decayFactor(step || 0)));
    // Touch-type LADDER: the message PURPOSE climbs with each un-answered touch so repeated
    // nudges don't all read as the same "miss you" line. Step 0 uses the warm template;
    // step 1 = event-invite framing, 2 = social proof, 3+ = decision-bridge. Built in code so
    // it works on the live DB with no template change.
    const RE_ENGAGE_LADDER = [
        '我们近期有一场很适合您的活动，名额有限，想第一时间留给您 😊',
        '最近有几位和您情况相似的朋友做了调整，反馈都很好，想分享给您参考',
        '想帮您把方案最后梳理一下，约个15分钟，让您安心做决定，方便吗？'
    ];
    const _ladderCopy = (step) => RE_ENGAGE_LADDER[Math.min((step || 1) - 1, RE_ENGAGE_LADDER.length - 1)];
    const RE_ENGAGE_MAX_OPEN = 5; // hard cap on how many re-engagement rows an agent sees at once
    const dispatchReEngagementReminders = async () => {
        const myId = _state.cu?.id;
        if (!myId) return;
        const tpl = await getFollowUpTemplate('re_engagement');
        if (!tpl) return;
        // Local (MYT) "today" — toISOString() gives the UTC date, which flips the
        // 14-day boundary (and the displayed {days}) before 08:00 local. Match the
        // renderer, which uses local date parts.
        const _t = new Date();
        const todayMs = new Date(_t.getFullYear(), _t.getMonth(), _t.getDate()).getTime();
        let prospects = [];
        // #14: re-engagement is the ONE feature meant to wake the longest-quiet leads, but
        // getActiveProspects() hides anything past the 500-day dormancy cutoff — exactly the
        // leads most in need of a nudge. Pull the full set; the RE_ENGAGE_MAX_OPEN cap +
        // grade-rank sort + F/converted/lost skips already bound how many surface per agent.
        try { prospects = await AppDataStore.getActiveProspects({ includeDormant: true }); }
        catch (_) { return; }
        // Cap the VISIBLE backlog to RE_ENGAGE_MAX_OPEN. Count what this agent already
        // has pending, then top up only to the cap, oldest-quiet first. Without this a
        // seasoned agent's book (80+ quiet leads) dumped a draft for every one on a
        // single calendar load. As rows are cleared, slots reopen and the next-oldest
        // surface — the backlog drains a few at a time instead of flooding.
        let existing = [];
        try { existing = await AppDataStore.getAll('follow_up_drafts'); } catch (_) {}
        // One-open-reminder: a prospect already holding ANY pending outreach (birthday /
        // event invite / proposal / re-engage) is not re-nudged, so the panel never
        // double-contacts the same person. The cap bounds new re-engagement rows.
        const minePending = (existing || []).filter(d => d.status === 'pending' && d.agent_id == myId);
        const reEngOpen   = minePending.filter(d => d.trigger_type === 're_engagement').length;
        const hasOpenDraft = new Set(minePending.map(d => String(d.prospect_id)));
        // step source: re_engagement nudges this agent DISMISSED per prospect (with created_at).
        // In the loop we count only those dismissed AFTER the prospect's last contact, so a fresh
        // contact (which advances last_activity_date) drops them all and resets the step to 0.
        const _dismissedReEng = {};
        for (const d of (existing || [])) {
            if (d.status === 'dismissed' && d.trigger_type === 're_engagement' && d.agent_id == myId && d.prospect_id) {
                (_dismissedReEng[String(d.prospect_id)] = _dismissedReEng[String(d.prospect_id)] || []).push(d.created_at);
            }
        }
        const slots = Math.max(0, RE_ENGAGE_MAX_OPEN - reEngOpen);
        if (slots === 0) return;
        const due = [];
        for (const p of prospects) {
            if (p.responsible_agent_id != myId) continue;            // only my own leads
            if (p.unable_to_serve || p.status === 'converted' || p.status === 'lost') continue;
            if (p.manual_grade === 'F') continue;                   // grade F = dropped, fully dark
            if (hasOpenDraft.has(String(p.id))) continue;           // already has an open outreach
            const last = p.last_activity_date;
            if (!last) continue;          // never-contacted is a CPS/protection concern, not re-engagement
            const _lastMs = new Date(last).getTime();
            const days = Math.floor((todayMs - _lastMs) / 86400000);
            // step = nudges dismissed since the last contact → widens the gap + steps the ladder.
            const step = (_dismissedReEng[String(p.id)] || []).filter(c => c && new Date(c).getTime() > _lastMs).length;
            const _cad = _cadenceDays(p.manual_grade, step);
            if (days < _cad) continue;     // grade × decay sets the rhythm
            // Episode key advances per step (last contact + this step's cadence) so the next step
            // after a dismissal is a NEW draft, not deduped against the dismissed one.
            const dueStr = _localDateStr(new Date(_lastMs + _cad * 86400000));
            due.push({ p, last, days, step, dueStr });
        }
        // Highest-value first: grade rank, then most-overdue (oldest contact).
        due.sort((a, b) => {
            const ra = GRADE_RANK[a.p.manual_grade] ?? 2, rb = GRADE_RANK[b.p.manual_grade] ?? 2;
            if (ra !== rb) return ra - rb;
            return a.last < b.last ? -1 : a.last > b.last ? 1 : 0;
        });
        for (const { p, last, days, step, dueStr } of due.slice(0, slots)) {
            // Step 0 = the warm template; later steps rotate the purpose up the ladder.
            const _agent = _state.cu?.full_name || '';
            const msg = step > 0
                ? `Hi ${p.full_name || ''}，距离上次联系已经 ${days} 天 😊 ${_ladderCopy(step)} — ${_agent}`
                : interpolateTemplate(tpl.message_template, { name: p.full_name || '', days: String(days), agent_name: _agent });
            await createFollowUpDraft({
                prospectId:   p.id,
                triggerType:  're_engagement',
                messageText:  msg,
                phone:        p.phone || '',
                prospectName: p.full_name || '',
                dueDate:      dueStr      // per-step episode key (last contact + this step's cadence)
            });
        }
    };

    // ── Dispatcher: 90-day customer check-ins — runs on calendar load ────────────────
    // The post-conversion counterpart to re-engagement (bug #11: the CRM went silent
    // once a prospect converted — no customer-side reminder existed at all). For every
    // customer the current agent owns whose last_contact_date is CUSTOMER_CHECKIN_DAYS+
    // old, queue a warm "let's catch up" draft — capped at CUSTOMER_MAX_OPEN ("2 a day"),
    // highest-LTV first. last_contact_date is trigger-maintained (customers migration,
    // Phase 1); the draft is episode-keyed on it so a fresh contact re-arms the cycle.
    const CUSTOMER_CHECKIN_DAYS = 90;
    const CUSTOMER_MAX_OPEN = 2;
    const dispatchCustomerCheckins = async () => {
        const myId = _state.cu?.id;
        if (!myId) return;
        const tpl = await getFollowUpTemplate('cust_checkin');
        if (!tpl) return;
        const _t = new Date();
        const todayMs = new Date(_t.getFullYear(), _t.getMonth(), _t.getDate()).getTime();
        let customers = [];
        try { customers = await AppDataStore.getAll('customers'); } catch (_) { return; }
        let existing = [];
        try { existing = await AppDataStore.getAll('follow_up_drafts'); } catch (_) {}
        const minePending = (existing || []).filter(d => d.status === 'pending' && d.agent_id == myId);
        const checkinOpen = minePending.filter(d => d.trigger_type === 'cust_checkin').length;
        const hasOpenDraft = new Set(minePending.filter(d => d.customer_id).map(d => String(d.customer_id)));
        const slots = Math.max(0, CUSTOMER_MAX_OPEN - checkinOpen);
        if (slots === 0) return;
        const due = [];
        for (const c of customers) {
            if (c.responsible_agent_id != myId) continue;          // only my own customers
            if (c.status === 'lost' || c.unable_to_serve) continue;
            if (hasOpenDraft.has(String(c.id))) continue;          // one open reminder per customer
            const last = c.last_contact_date;
            if (!last) continue;
            const days = Math.floor((todayMs - new Date(last).getTime()) / 86400000);
            if (days < CUSTOMER_CHECKIN_DAYS) continue;
            due.push({ c, last, days });
        }
        // Highest-value first: lifetime value desc, then most-overdue.
        due.sort((a, b) => {
            const la = Number(a.c.lifetime_value) || 0, lb = Number(b.c.lifetime_value) || 0;
            if (la !== lb) return lb - la;
            return a.last < b.last ? -1 : a.last > b.last ? 1 : 0;
        });
        for (const { c, last, days } of due.slice(0, slots)) {
            const msg = interpolateTemplate(tpl.message_template, {
                name: c.full_name || '', days: String(days), agent_name: _state.cu?.full_name || ''
            });
            await createFollowUpDraft({
                customerId:   c.id,
                triggerType:  'cust_checkin',
                messageText:  msg,
                phone:        c.phone || '',
                prospectName: c.full_name || '',
                dueDate:      last        // episode key — fresh contact re-arms the 90-day cycle
            });
        }
    };

    // ── Dispatcher: APU namelist acknowledgment — runs on calendar load ──────────────
    // When a prospect hands over a referral namelist (a names-tab insert → the DB trigger
    // trg_stamp_apu_namelist stamps prospects.apu_namelist_at = now), thank them the NEXT
    // day and confirm slots are reserved. Episode-keyed on the namelist date (+1) so
    // same-day adds dedupe but a new day's batch re-arms (owner: re-arm every round).
    // Owner decision: this RESPECTS grade-F / converted / lost (skip them).
    const dispatchApuAckTouches = async () => {
        const myId = _state.cu?.id;
        if (!myId) return;
        const tpl = await getFollowUpTemplate('apu_ack');
        if (!tpl) return;
        let prospects = [];
        try { prospects = await AppDataStore.getAll('prospects'); } catch (_) { return; }
        for (const p of prospects) {
            if (p.responsible_agent_id != myId) continue;          // only my own leads
            if (!p.apu_namelist_at) continue;                      // no namelist captured
            if (p.manual_grade === 'F') continue;                  // owner: F stays dark
            if (p.unable_to_serve || p.status === 'converted' || p.status === 'lost') continue; // owner: respect converted/closed
            const base = new Date(p.apu_namelist_at);
            if (isNaN(base.getTime())) continue;
            const due = new Date(base); due.setDate(due.getDate() + 1);
            const dueStr = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
            const msg = interpolateTemplate(tpl.message_template, {
                name: p.full_name || '', agent_name: _state.cu?.full_name || ''
            });
            await createFollowUpDraft({
                prospectId:   p.id,
                triggerType:  'apu_ack',
                messageText:  msg,
                phone:        p.phone || '',
                prospectName: p.full_name || '',
                dueDate:      dueStr   // episode key = namelist date +1 (same-day adds dedupe; new day re-arms)
            });
        }
    };

    // ── Dispatcher: appointment reminders — runs on calendar load ────────────────────
    // For each UPCOMING client meeting (CPS/FTF/GR/XG activity, today..+LOOKAHEAD days, with a
    // date) surface a draft so the agent sends the prospect/customer a "please come on time"
    // confirmation carrying the date / time / venue. Deduped per booking via eventId=activity.id
    // (one reminder per appointment). Grade-blind on purpose — a confirmed meeting is honored
    // regardless of grade; only unable_to_serve + cross-agent are skipped.
    const APPT_TYPES = ['CPS', 'FTF', 'GR', 'XG'];
    const APPT_REMINDER_LOOKAHEAD = 2; // days of notice (today + next 2 days)
    const dispatchAppointmentReminders = async () => {
        const myId = _state.cu?.id;
        if (!myId) return;
        const tpl = await getFollowUpTemplate('appointment_reminder');
        if (!tpl) return;
        const _t = new Date();
        const today0 = new Date(_t.getFullYear(), _t.getMonth(), _t.getDate());
        const todayStr = _localDateStr(today0);
        const horizon = new Date(today0); horizon.setDate(horizon.getDate() + APPT_REMINDER_LOOKAHEAD);
        const horizonStr = _localDateStr(horizon);
        let activities = [];
        try { activities = await AppDataStore.getAll('activities'); } catch (_) { return; }
        const appts = (activities || []).filter(a => APPT_TYPES.includes(a.activity_type)
            && a.activity_date && a.activity_date >= todayStr && a.activity_date <= horizonStr
            && (a.prospect_id || a.customer_id));
        if (!appts.length) return;
        let prospects = [], customers = [];
        try { prospects = await AppDataStore.getAll('prospects'); } catch (_) {}
        try { customers = await AppDataStore.getAll('customers'); } catch (_) {}
        const pById = Object.fromEntries((prospects || []).map(p => [String(p.id), p]));
        const cById = Object.fromEntries((customers || []).map(c => [String(c.id), c]));
        for (const a of appts) {
            const person = a.prospect_id ? pById[String(a.prospect_id)] : cById[String(a.customer_id)];
            if (!person) continue;
            if (person.responsible_agent_id != myId) continue;     // only my own
            if (person.unable_to_serve) continue;
            const time  = (a.start_time || '').slice(0, 5);
            const venue = a.venue || a.location_address || '';
            const msg = interpolateTemplate(tpl.message_template, {
                name: person.full_name || '', date: a.activity_date, time, venue,
                agent_name: _state.cu?.full_name || ''
            });
            await createFollowUpDraft({
                prospectId:   a.prospect_id || null,
                customerId:   a.customer_id || null,
                triggerType:  'appointment_reminder',
                messageText:  msg,
                phone:        person.phone || '',
                prospectName: person.full_name || '',
                eventId:      a.id,                 // dedup: one reminder per appointment booking
                eventDate:    a.activity_date,
                eventName:    a.activity_title || a.activity_type,
                dueDate:      todayStr              // surface now (1-2 days before the meeting)
            });
        }
    };

    // ── Dispatcher: unredeemed e-voucher follow-up — runs on calendar load ───────────
    // A generated e-CPS voucher (prospect_attachments, attachment_type='evoucher') that is 14+
    // days old and not marked redeemed (metadata.redeemed_at) → nudge the owning agent to chase
    // it so it gets used. Deduped per voucher via eventId=attachment.id (one nudge per voucher).
    // Marking the voucher redeemed (prospects.js markVoucherRedeemed) or dismissing the nudge clears it.
    const VOUCHER_NUDGE_DAYS = 14;
    const dispatchVoucherNudges = async () => {
        const myId = _state.cu?.id;
        if (!myId) return;
        const tpl = await getFollowUpTemplate('voucher_unredeemed');
        if (!tpl) return;
        let atts = [];
        try { atts = await AppDataStore.getAll('prospect_attachments'); } catch (_) { return; }
        const evs = (atts || []).filter(a => a.attachment_type === 'evoucher' && a.prospect_id);
        if (!evs.length) return;
        let prospects = [];
        try { prospects = await AppDataStore.getAll('prospects'); } catch (_) { return; }
        const pById = Object.fromEntries((prospects || []).map(p => [String(p.id), p]));
        const _t = new Date();
        const cutoffMs = _t.getTime() - VOUCHER_NUDGE_DAYS * 86400000;
        const todayStr = _localDateStr(_t);
        for (const a of evs) {
            const md = a.metadata || {};
            if (md.redeemed_at) continue;                       // already redeemed
            const _genRaw = md.generated_at || a.created_at;
            const gen = _genRaw ? new Date(_genRaw).getTime() : 0;
            if (!gen || gen > cutoffMs) continue;               // < 14 days old — not due yet
            const p = pById[String(a.prospect_id)];
            if (!p) continue;
            if (p.responsible_agent_id != myId) continue;       // only my own
            if (p.unable_to_serve || p.status === 'lost') continue;
            const msg = interpolateTemplate(tpl.message_template, {
                name: p.full_name || '', recipient: md.recipient_name || p.full_name || '',
                code: md.voucher_code || '', agent_name: _state.cu?.full_name || ''
            });
            await createFollowUpDraft({
                prospectId:   p.id,
                triggerType:  'voucher_unredeemed',
                messageText:  msg,
                phone:        p.phone || '',
                prospectName: p.full_name || '',
                eventId:      a.id,            // dedup: one nudge per voucher attachment
                eventName:    `voucher ${md.voucher_code || ''}`,
                dueDate:      todayStr
            });
        }
    };

    // ── Dispatcher: pending solution follow-ups — runs on calendar load ──────────────
    // For each proposed_solutions row where status='Proposed' and next_follow_up_date <= today,
    // creates a follow_up_draft for the responsible agent.
    // Also escalates solutions that have been Proposed for 21+ days.
    const dispatchPendingSolutionReminders = async () => {
        const templates = await loadFollowUpTemplates();
        const todayStr = _localDateStr(new Date());

        let solutions = [];
        try { solutions = await AppDataStore.getAll('proposed_solutions') || []; } catch (e) { /* intentional: optional table absent → nothing to dispatch */ return; }

        const pending = solutions.filter(s => s.status === 'Proposed');
        if (!pending.length) return;

        // Load people + agents in bulk
        const [prospects, customers] = await Promise.all([
            AppDataStore.getAll('prospects').catch(() => []),
            AppDataStore.getAll('customers').catch(() => [])
        ]);
        const prospectMap = Object.fromEntries(prospects.map(p => [String(p.id), p]));
        const customerMap = Object.fromEntries(customers.map(c => [String(c.id), c]));

        // Build solution-match → template lookup for after_solution_proposed triggers
        const solutionTpls = templates.filter(t => t.trigger_category === 'after_solution_proposed' && t.is_active);
        const overdueTpl  = templates.find(t => t.trigger_type === 'solution_overdue' && t.is_active);

        for (const sol of pending) {
            const person = sol.prospect_id ? prospectMap[String(sol.prospect_id)]
                         : sol.customer_id ? customerMap[String(sol.customer_id)] : null;
            if (!person) continue;

            // Only create drafts for the current agent's own prospects. #21: a null owner
            // used to slip past the `&&` short-circuit and get a draft attributed to the
            // dispatching admin — skip unowned contacts outright.
            if (person.responsible_agent_id != _state.cu?.id) continue;
            // Lifecycle guard (parity with the re-engagement dispatcher): a converted /
            // lost / unable-to-serve contact must not keep getting the proposal drip or
            // the 21-day overdue escalation — they already closed (or were dropped).
            if (person.unable_to_serve || person.status === 'converted' || person.status === 'lost') continue;
            if (person.manual_grade === 'F') continue; // grade F = dropped, fully dark

            const solutionLower = (sol.solution || '').toLowerCase();
            const proposedDate  = sol.proposed_date || '';

            // ── Sequence reminders (day 1/3/7/14) based on next_follow_up_date ──
            if (sol.next_follow_up_date && sol.next_follow_up_date <= todayStr) {
                // Days elapsed since the solution was proposed — drives WHICH
                // sequence step is due. The four 画作 templates share an
                // identical solution_match, so without gating on delay_days they
                // would ALL fire at once (each has a distinct trigger_type, so
                // createFollowUpDraft's non-event dedup does NOT collapse them),
                // dumping day-1/3/7/14 reminders on the agent simultaneously.
                const daysSinceProposed = proposedDate
                    ? Math.floor((new Date(todayStr) - new Date(proposedDate)) / 86400000)
                    : null;
                // Find which sequence template matches this solution AND is the
                // step due now. Fire only the template whose delay_days has been
                // reached but whose NEXT step (if any) has not — so each drip
                // step lands on its own date as the sequence progresses.
                const _allMatch = solutionTpls.filter(tpl => {
                    const matchList = (tpl.solution_match || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
                    return !matchList.length || matchList.some(m => solutionLower.includes(m));
                });
                // Specific solution_match beats the generic (empty-match) fallback: a 画作
                // proposal gets its tailored drip, every other proposal gets the generic
                // sol_day* drip — never both (bug #7: non-painting proposals had no drip).
                const _specific = _allMatch.filter(tpl => (tpl.solution_match || '').trim());
                const matchingTpls = _specific.length ? _specific : _allMatch;
                // The single step whose delay_days is the largest value already
                // reached (delay_days <= daysSinceProposed). When proposed_date
                // is unknown, fall back to the smallest-delay (first) step.
                const sortedSteps = matchingTpls.slice().sort((a, b) => (a.delay_days || 0) - (b.delay_days || 0));
                let dueTpls;
                if (daysSinceProposed == null) {
                    dueTpls = sortedSteps.length ? [sortedSteps[0]] : [];
                } else {
                    const reached = sortedSteps.filter(t => (t.delay_days || 0) <= daysSinceProposed);
                    dueTpls = reached.length ? [reached[reached.length - 1]] : [];
                }
                for (const tpl of dueTpls) {
                    const msg = interpolateTemplate(tpl.message_template, {
                        name: person.full_name || '',
                        solution: sol.solution || '',
                        proposed_date: proposedDate,
                        agent_name: _state.cu?.full_name || ''
                    });

                    await createFollowUpDraft({
                        prospectId: sol.prospect_id || null,
                        customerId: sol.customer_id || null,
                        triggerType: tpl.trigger_type,
                        messageText: msg,
                        phone: person.phone || '',
                        prospectName: person.full_name || '',
                        dueDate: sol.next_follow_up_date
                    });
                }

                // #15: only advance the cadence cursor when a drip step actually fired.
                // Previously this ran even when dueTpls was empty (no matching/reached step),
                // bumping follow_up_count and pushing next_follow_up_date +7d with zero
                // outreach sent — silently skipping the contact a step at a time.
                if (dueTpls.length) {
                    // Advance next_follow_up_date by 7 days so we don't re-fire tomorrow
                    const next = new Date(sol.next_follow_up_date);
                    next.setDate(next.getDate() + 7);
                    AppDataStore.update('proposed_solutions', sol.id, {
                        last_follow_up_date: sol.next_follow_up_date,
                        next_follow_up_date: next.toISOString().split('T')[0],
                        follow_up_count: (sol.follow_up_count || 0) + 1,
                        updated_at: new Date().toISOString()
                    }).catch(() => {});
                }
            }

            // ── Overdue escalation (21+ days since proposed_date, not yet escalated) ──
            if (overdueTpl && proposedDate && !sol.escalated_at) {
                const daysSince = Math.floor((new Date(todayStr) - new Date(proposedDate)) / 86400000);
                if (daysSince >= 21) {
                    const msg = interpolateTemplate(overdueTpl.message_template, {
                        name: person.full_name || '',
                        solution: sol.solution || '',
                        days: daysSince,
                        agent_name: _state.cu?.full_name || ''
                    });
                    await createFollowUpDraft({
                        prospectId: sol.prospect_id || null,
                        customerId: sol.customer_id || null,
                        triggerType: 'solution_overdue',
                        messageText: msg,
                        phone: person.phone || '',
                        prospectName: person.full_name || '',
                        dueDate: todayStr
                    });
                    AppDataStore.update('proposed_solutions', sol.id, {
                        escalated_at: new Date().toISOString(),
                        escalation_notes: `Auto-escalated after ${daysSince} days pending`,
                        updated_at: new Date().toISOString()
                    }).catch(() => {});
                }
            }
        }
    };

    // Render follow-up reminders below calendar
    // ── Gesture-safe poster share (P2) ──────────────────────────────────────────────
    // iOS Safari voids transient activation the moment any network/data await runs, so
    // fetching the poster (or the event row) inside the Send click breaks
    // navigator.share({files}). Instead we PREFETCH the poster image + precompute the
    // invite body when the reminders panel renders, cache them by draft id, and let the
    // Send click fire navigator.share synchronously. Cache miss/null → async
    // fetch-then-share / wa.me-link fallback (unchanged). value: null = fetch in flight,
    // { file, body, draft } = ready.
    const _posterShareCache = new Map();

    // Build the WhatsApp message body for a draft: event invites get the rich poster
    // caption (needs the events row + matching activity for date/time/venue); everything
    // else uses the stored message text. Extracted so the render-time prefetch and the
    // click-time send share ONE source of truth.
    const _buildFollowUpBody = async (draft) => {
        // appointment_reminder + voucher_unredeemed overload event_id to carry an activity /
        // attachment id (dedup key), NOT a real events row. Their message_text is already a
        // fully interpolated reminder/chase — return it instead of building an event poster.
        if (!draft.event_id
            || draft.trigger_type === 'appointment_reminder'
            || draft.trigger_type === 'voucher_unredeemed') return draft.message_text || '';
        const event = await AppDataStore.getById('events', draft.event_id);
        let activity = null;
        try {
            const allActs = await AppDataStore.getAll('activities');
            activity = (allActs || []).find(a =>
                a.activity_type === 'EVENT'
                && String(a.event_id) === String(draft.event_id)
                && (!draft.event_date || a.activity_date === draft.event_date)
            ) || null;
        } catch (_) { /* best-effort time lookup, falls back to event fields */ }
        const title = event?.event_title || event?.title || draft.event_name || '';
        const date = (event?.event_date || event?.date || draft.event_date || '').toString();
        const startTRaw = (activity?.start_time || event?.start_time || '').toString();
        const endTRaw = (activity?.end_time || event?.end_time || '').toString();
        const time = startTRaw && endTRaw ? `${startTRaw} - ${endTRaw}` : (startTRaw || '');
        const venue = activity?.venue || activity?.location_address || event?.location || '';
        const description = event?.description || '';
        const ticketPrice = event?.ticket_price ? `RM ${event.ticket_price}` : '';
        // Unicode escapes — literal emoji bytes get mangled by Windows clipboard round-trips.
        const E = { sparkle: '✨', calendar: '\u{1F4C5}', clock: '\u{1F550}', pin: '\u{1F4CD}', ticket: '\u{1F39F}️' };
        const lines = [`${E.sparkle} *${title || 'You are invited!'}* ${E.sparkle}`, ''];
        if (date) lines.push(`${E.calendar} Date: ${date}`);
        if (time) lines.push(`${E.clock} Time: ${time}`);
        if (venue) lines.push(`${E.pin} Venue: ${venue}`);
        if (ticketPrice) lines.push(`${E.ticket} Ticket Price: ${ticketPrice}`);
        if (description) lines.push('', description);
        return lines.join('\n');
    };

    // Prefetch poster image + body for the event-invite drafts currently shown, and evict
    // entries for rows no longer on screen. No-op when the Web Share file API is absent
    // (desktops keep the wa.me-link path). Fire-and-forget; never blocks render.
    const _prefetchPosterShares = (drafts) => {
        if (!(navigator.share && navigator.canShare)) return;
        const wanted = new Set();
        for (const d of drafts) {
            if (!(d.event_id && d.attachment_url)) continue;
            wanted.add(d.id);
            if (_posterShareCache.has(d.id)) continue; // ready or already in flight
            _posterShareCache.set(d.id, null);          // mark in flight
            (async () => {
                try {
                    const body = await _buildFollowUpBody(d);
                    const resp = await fetch(d.attachment_url);
                    if (!resp.ok) { _posterShareCache.delete(d.id); return; }
                    const blob = await resp.blob();
                    const ext = ((blob.type || '').split('/')[1] || 'jpg').replace('jpeg', 'jpg');
                    const file = new File([blob], `poster.${ext}`, { type: blob.type || 'image/jpeg' });
                    if (!navigator.canShare({ files: [file] })) { _posterShareCache.delete(d.id); return; }
                    _posterShareCache.set(d.id, { file, body, draft: d });
                } catch (_) { _posterShareCache.delete(d.id); }
            })();
        }
        for (const k of [..._posterShareCache.keys()]) { if (!wanted.has(k)) _posterShareCache.delete(k); }
    };

    // Shared curated-follow-up builder — the SINGLE source of truth for "today's follow-ups",
    // used by BOTH the desktop panel (renderFollowUpReminders) and the mobile home so the two
    // surfaces show the IDENTICAL list/count. Pure: no DOM, no state writes. Filters to
    // pending + due<=today + non-expired-event + owned-(or admin sees null-agent) + not
    // unable_to_serve, then collapses duplicates (episodic newest-wins / appointment / event /
    // other) and sorts by due_date asc. The ~5-prospect/2-customer/birthday curation is already
    // guaranteed upstream by the dispatcher caps — do NOT add a slice here.
    const composeFollowUpList = (allDrafts, allProspects, allCustomers, viewerId, isAdminViewer) => {
        const _now = new Date();
        const todayStr = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
        const _unableP = new Set((allProspects || []).filter(p => p.unable_to_serve).map(p => String(p.id)));
        const _unableC = new Set((allCustomers || []).filter(c => c.unable_to_serve).map(c => String(c.id)));
        const visible = (allDrafts || []).filter(d =>
            d.status === 'pending' &&
            d.due_date <= todayStr &&
            (!d.event_date || d.event_date >= todayStr) &&
            (d.agent_id ? d.agent_id == viewerId : isAdminViewer) &&
            !(d.prospect_id && _unableP.has(String(d.prospect_id))) &&
            !(d.customer_id && _unableC.has(String(d.customer_id)))
        );
        const _norm = (s) => String(s || '').trim().toLowerCase();
        const _episodic = new Set(['re_engagement', 'cust_checkin']);
        const seen = new Map();
        const deduped = [];
        const _orderedForDedup = visible.slice().sort((a, b) => {
            const ea = _episodic.has(a.trigger_type), eb = _episodic.has(b.trigger_type);
            if (ea !== eb) return ea ? -1 : 1;             // episodic rows resolved first
            if (ea && eb) return (b.id || 0) - (a.id || 0); // newest episode wins
            return (a.id || 0) - (b.id || 0);              // others: oldest wins (stable)
        });
        for (const d of _orderedForDedup) {
            const personKey = d.prospect_id ? `p:${d.prospect_id}` : (d.customer_id ? `c:${d.customer_id}` : `n:${d.id}`);
            const isEventBased = !!d.event_id || (!!d.event_name && !!d.event_date);
            let key;
            if (_episodic.has(d.trigger_type)) {
                key = `${personKey}|t:${d.trigger_type}`;
            } else if (d.trigger_type === 'appointment_reminder') {
                key = `${personKey}|t:appointment_reminder|eid:${d.event_id || ''}`;
            } else if (d.trigger_type === 'voucher_unredeemed') {
                // event_id here is a prospect_attachments id (own id-space) — key it under this
                // trigger so it can't collapse with an event invite sharing the same number.
                key = `${personKey}|t:voucher_unredeemed|vid:${d.event_id || ''}`;
            } else if (isEventBased) {
                const eventKey = d.event_id ? `eid:${d.event_id}` : `en:${_norm(d.event_name)}|ed:${d.event_date || ''}`;
                key = `${personKey}|${eventKey}`;
            } else {
                key = `${personKey}|t:${d.trigger_type}|due:${d.due_date || ''}`;
            }
            if (seen.has(key)) continue;
            seen.set(key, true);
            deduped.push(d);
        }
        return deduped.sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
    };

    const renderFollowUpReminders = async () => {
        const container = document.getElementById('follow-up-reminders');
        if (!container) return;

        let drafts = [];
        try {
            const [all, allProspectsR, allCustomersR] = await Promise.all([
                AppDataStore.getAll('follow_up_drafts'),
                AppDataStore.getAll('prospects').catch(() => []),
                AppDataStore.getAll('customers').catch(() => []),
            ]);
            drafts = composeFollowUpList(all, allProspectsR, allCustomersR, _state.cu?.id, isSystemAdmin(_state.cu));
            // Update the count badge inside the try block so an error doesn't reset it to 0.
            const _gfc = document.getElementById('glance-followup-count');
            if (_gfc) _gfc.textContent = drafts.length;
        } catch (e) {
            console.warn('renderFollowUpReminders failed:', e);
        }

        if (drafts.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'block';
        // Build labels/icons from DB templates (data-driven, supports custom triggers)
        const _tpls = await loadFollowUpTemplates();
        const triggerLabels = {};
        const triggerIcons = {};
        for (const t of _tpls) {
            triggerLabels[t.trigger_type] = t.template_name || t.trigger_type;
            triggerIcons[t.trigger_type] = t.icon || '📩';
        }
        // card_expiry has no DB template row — give it a friendly label/icon so the
        // installment card-renewal reminder doesn't render as the raw trigger key.
        if (!triggerLabels['card_expiry']) triggerLabels['card_expiry'] = '信用卡到期 · Card Renewal';
        if (!triggerIcons['card_expiry']) triggerIcons['card_expiry'] = '💳';

        container.innerHTML = `
            <div style="background:var(--white,#fff); border:1px solid var(--gray-200,#e5e7eb); border-radius:12px; padding:16px; margin-top:16px;">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
                    <div style="width:32px;height:32px;border-radius:50%;background:#3b82f6;color:white;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:14px;">${drafts.length}</div>
                    <h3 style="margin:0; font-size:16px; color:var(--gray-800,#1f2937);">📩 Follow-Up Reminders</h3>
                </div>
                <div style="display:flex; flex-direction:column; gap:10px;">
                    ${drafts.map(d => {
                        const thumbHtml = d.attachment_url
                            ? `<img loading="lazy" decoding="async" data-attach-src="${escapeHtml(d.attachment_url)}" alt="Attachment" style="width:48px; height:48px; border-radius:6px; object-fit:cover; cursor:pointer; border:1px solid var(--gray-200); flex-shrink:0;" onclick="event.stopPropagation(); window._openAttachment('${UI.escJsAttr(String(d.attachment_url))}');" title="Click to view full image">`
                            : '';
                        // Agent-action loop: how long this reminder has sat un-acted
                        // (from created_at) → an "overdue Nd" nag so it's chased, not ignored.
                        const _nowD = new Date();
                        const _todayMs2 = new Date(_nowD.getFullYear(), _nowD.getMonth(), _nowD.getDate()).getTime();
                        // A future-dated draft (e.g. card_expiry) doesn't start "aging" until it
                        // becomes due — otherwise it would surface already showing "overdue 300d"
                        // from its creation date. Clock the overdue nag from max(created_at, due_date).
                        const _createdMs = d.created_at ? new Date(d.created_at).getTime() : 0;
                        const _dueMs = d.due_date ? new Date(d.due_date + 'T00:00:00').getTime() : 0;
                        const _ageStartMs = Math.max(_createdMs, _dueMs || _createdMs);
                        const _daysOpen = _ageStartMs ? Math.floor((_todayMs2 - _ageStartMs) / 86400000) : 0;
                        const _overdueBadge = _daysOpen >= 1
                            ? `<span style="font-size:11px; background:#fee2e2; color:#b91c1c; padding:2px 8px; border-radius:10px; font-weight:600;" title="Un-acted for ${_daysOpen} day(s)">overdue ${_daysOpen}d</span>`
                            : '';
                        // Make the name a click-through to the linked profile (prospect preferred, else customer).
                        const _navName = d.prospect_id
                            ? `app.showProspectDetail(${d.prospect_id})`
                            : (d.customer_id ? `app.showCustomerDetail(${d.customer_id})` : '');
                        const _nameHtml = _navName
                            ? `<strong style="font-size:13px; color:#2563eb; cursor:pointer; text-decoration:underline; text-decoration-style:dotted;" onclick="event.stopPropagation(); ${_navName};" title="Open profile">${esc(d.prospect_name || 'Unknown')}</strong>`
                            : `<strong style="font-size:13px; color:var(--gray-800,#1f2937);">${esc(d.prospect_name || 'Unknown')}</strong>`;
                        return `
                        <div id="followup-row-${d.id}" style="display:flex; align-items:flex-start; gap:12px; padding:12px; background:var(--gray-50,#f9fafb); border-radius:8px; border-left:4px solid #3b82f6; transition: opacity 0.4s ease, max-height 0.4s ease;">
                            <input type="checkbox" id="followup-check-${d.id}" style="margin-top:4px; width:18px; height:18px; cursor:pointer; accent-color:#3b82f6;" onchange="app.markFollowUpSent(${d.id})" title="Mark as sent">
                            ${thumbHtml}
                            <div style="flex:1; min-width:0;">
                                <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                                    <span style="font-size:16px;">${triggerIcons[d.trigger_type] || '📩'}</span>
                                    ${_nameHtml}
                                    <span style="font-size:11px; background:#dbeafe; color:#1d4ed8; padding:2px 8px; border-radius:10px;">${esc(triggerLabels[d.trigger_type] || d.trigger_type)}</span>
                                    ${_overdueBadge}
                                    ${d.event_name ? `<span style="font-size:11px; color:var(--gray-500,#6b7280);">${esc(d.event_name)}${d.event_date ? ' — ' + esc(d.event_date) : ''}</span>` : ''}
                                    ${d.attachment_url ? '<span style="font-size:11px; background:#dcfce7; color:#059669; padding:2px 8px; border-radius:10px;"><i class="fas fa-paperclip"></i> Photo</span>' : ''}
                                </div>
                            </div>
                            <div style="display:flex; gap:6px; flex-shrink:0;">
                                ${d.trigger_type === 'apu_ack' && d.prospect_id ? `<button class="btn secondary btn-sm" onclick="event.stopPropagation(); app.openGenerateEvoucherModal(${d.prospect_id});" style="font-size:12px; padding:6px 10px; white-space:nowrap;" title="Generate / send the referral e-CPS voucher(s)"><i class="fas fa-ticket-alt"></i> E-Voucher</button>` : ''}
                                <button class="btn primary btn-sm" onclick="event.stopPropagation(); (async () => { await app.sendFollowUpInvite(${d.id}); })();" style="font-size:12px; padding:6px 12px; white-space:nowrap;">
                                    <i class="fab fa-whatsapp"></i> Send
                                </button>
                                <button class="btn secondary btn-sm" onclick="event.stopPropagation(); app.dismissFollowUp(${d.id});" style="font-size:12px; padding:6px 8px;" title="Dismiss">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        `;

        // Prefetch posters so the Send click can share the image gesture-safely (P2).
        _prefetchPosterShares(drafts);
    };

    // Contacted-feedback loop: a tick OR a WhatsApp-click both count as "contacted" →
    // stamp today onto the linked entity's last-contact date so the cadence clock advances
    // (the next nudge is measured from now) and the episode-keyed dedup only re-arms after
    // the NEXT gap. Best-effort, non-blocking.
    const _logFollowUpContact = async (draft) => {
        if (!draft) return;
        try {
            const d = new Date();
            const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            if (draft.prospect_id) await AppDataStore.update('prospects', draft.prospect_id, { last_activity_date: today, follow_mode: 'active', silence_count: 0 });
            else if (draft.customer_id) await AppDataStore.update('customers', draft.customer_id, { last_contact_date: today });
        } catch (e) { console.warn('_logFollowUpContact failed:', e); }
    };

    const markFollowUpSent = async (draftId) => {
        try {
            const _draft = await AppDataStore.getById('follow_up_drafts', draftId).catch(() => null);
            await AppDataStore.update('follow_up_drafts', draftId, { status: 'sent', updated_at: new Date().toISOString() });
            _logFollowUpContact(_draft); // contacted → advance the cadence clock
            // Animate row out
            const row = document.getElementById(`followup-row-${draftId}`);
            if (row) {
                row.style.opacity = '0';
                row.style.maxHeight = '0';
                row.style.overflow = 'hidden';
                row.style.padding = '0 12px';
                row.style.marginBottom = '0';
                setTimeout(() => {
                    row.remove();
                    // If no more rows, hide the section
                    const container = document.getElementById('follow-up-reminders');
                    if (container && container.querySelectorAll('[id^="followup-row-"]').length === 0) {
                        container.style.display = 'none';
                    }
                }, 500);
            }
            UI.toast.success('Follow-up marked as sent');
        } catch (e) {
            console.warn('markFollowUpSent failed:', e);
            UI.toast.error('Failed to update');
        }
    };

    const dismissFollowUp = async (draftId) => {
        try {
            await AppDataStore.update('follow_up_drafts', draftId, { status: 'dismissed', updated_at: new Date().toISOString() });
            const row = document.getElementById(`followup-row-${draftId}`);
            if (row) {
                row.style.opacity = '0';
                row.style.maxHeight = '0';
                row.style.overflow = 'hidden';
                row.style.padding = '0 12px';
                setTimeout(() => {
                    row.remove();
                    const container = document.getElementById('follow-up-reminders');
                    if (container && container.querySelectorAll('[id^="followup-row-"]').length === 0) {
                        container.style.display = 'none';
                    }
                }, 500);
            }
            UI.toast.success('Follow-up dismissed');
        } catch (e) {
            UI.toast.error('Failed to dismiss');
        }
    };

    // Build the WhatsApp invite text from the LIVE event row at click time, so
    // edits to the event description/venue/time after the draft was created
    // are picked up. The draft's stored message_text is used only as a fallback
    // when no event_id is set (e.g. birthday triggers, manual drafts).
    const sendFollowUpInvite = async (draftId) => {
        // Gesture-safe fast path (P2): if renderFollowUpReminders prefetched this event
        // invite's poster + body, fire the native file-share synchronously — BEFORE any
        // await — so iOS Safari keeps transient activation (a data/network await first
        // voids it). Map.get + canShare are synchronous, so navigator.share is the very
        // first await this click sees. Cache miss/null → async path below (unchanged).
        const _pre = _posterShareCache.get(draftId);
        if (_pre && _pre.file && navigator.share && navigator.canShare && navigator.canShare({ files: [_pre.file] })) {
            try {
                await navigator.share({ files: [_pre.file], text: _pre.body });
                _posterShareCache.delete(draftId);
                AppDataStore.update('follow_up_drafts', draftId, { status: 'sent', updated_at: new Date().toISOString() }).catch(() => {});
                _logFollowUpContact(_pre.draft);
                renderFollowUpReminders();
                return;
            } catch (e) {
                if (e && e.name === 'AbortError') return; // user cancelled — leave pending
                // any other error → fall through to the async fetch / wa.me-link path
            }
        }

        const draft = await AppDataStore.getById('follow_up_drafts', draftId);
        if (!draft) { UI.toast.error('Reminder not found'); return; }

        const phone = (draft.phone || '').replace(/\D/g, '');
        if (!phone) { UI.toast.error('No phone number on this contact'); return; }
        const waPhone = phone.startsWith('0') ? '60' + phone.slice(1) : phone;

        // Body for the wa.me / link fallback (event invite → rich poster caption built
        // from the LIVE event row at click time, else the stored text). Same builder the
        // render-time prefetch uses, so both share paths emit identical copy.
        const body = await _buildFollowUpBody(draft);

        // Clicking Send counts as "contacted": mark the draft sent + advance the cadence clock,
        // then refresh the panel so the handled row clears. Shared by both send paths below.
        const _markSentAndRefresh = () => {
            AppDataStore.update('follow_up_drafts', draftId, { status: 'sent', updated_at: new Date().toISOString() }).catch(() => {});
            _logFollowUpContact(draft);
            renderFollowUpReminders();
        };

        // Event-class invites carry the event POSTER (attachment_url = events.poster_url). Send it
        // as a REAL image via the device share sheet — the same path the e-voucher uses — so the
        // poster lands inline in WhatsApp. Mobile-only; falls back to a wa.me text + poster LINK
        // when the Web Share file API is unavailable (most desktops) or the fetch fails. Scoped to
        // event invites (draft.event_id) per owner choice — other reminders keep the link behaviour.
        if (draft.event_id && draft.attachment_url && navigator.share && navigator.canShare) {
            let _file = null;
            try {
                const _resp = await fetch(draft.attachment_url);
                if (_resp.ok) {
                    const _blob = await _resp.blob();
                    const _ext  = ((_blob.type || '').split('/')[1] || 'jpg').replace('jpeg', 'jpg');
                    _file = new File([_blob], `poster.${_ext}`, { type: _blob.type || 'image/jpeg' });
                }
            } catch (_) { _file = null; } // fetch failed — fall through to the wa.me link path
            if (_file && navigator.canShare({ files: [_file] })) {
                try {
                    await navigator.share({ files: [_file], text: body });
                    _markSentAndRefresh();
                    return;
                } catch (e) {
                    if (e && e.name === 'AbortError') return; // user cancelled the share — leave it pending
                    // any other share error — fall through to the wa.me link path
                }
            }
        }

        // Default path (and fallback): wa.me with the text; poster appended as a tappable link.
        let _waBody = body;
        if (draft.attachment_url && !_waBody.includes(draft.attachment_url)) _waBody += '\n\n' + draft.attachment_url;
        window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(_waBody)}`, '_blank');
        _markSentAndRefresh();
    };

    // ── Pending Proposals widget — shown on calendar page below follow-up reminders ──
    const renderPendingSolutionsWidget = async () => {
        const container = document.getElementById('pending-solutions-widget');
        if (!container) return;

        let solutions = [];
        try { solutions = await AppDataStore.getAll('proposed_solutions') || []; } catch (e) { /* intentional: optional table absent → hide widget */ container.style.display = 'none'; return; }

        const [prospects, customers] = await Promise.all([
            AppDataStore.getAll('prospects').catch(() => []),
            AppDataStore.getAll('customers').catch(() => [])
        ]);
        const prospectMap = Object.fromEntries(prospects.map(p => [String(p.id), p]));
        const customerMap = Object.fromEntries(customers.map(c => [String(c.id), c]));

        const todayStr = _localDateStr(new Date());
        const pending = solutions.filter(s => {
            if (s.status !== 'Proposed') return false;
            const person = s.prospect_id ? prospectMap[String(s.prospect_id)] : s.customer_id ? customerMap[String(s.customer_id)] : null;
            if (!person) return false;
            return !person.responsible_agent_id || person.responsible_agent_id == _state.cu?.id;
        }).sort((a, b) => (a.proposed_date || '').localeCompare(b.proposed_date || ''));

        if (!pending.length) { container.style.display = 'none'; return; }

        const overdueCount = pending.filter(s => {
            if (!s.proposed_date) return false;
            return Math.floor((new Date(todayStr) - new Date(s.proposed_date)) / 86400000) >= 7;
        }).length;

        container.style.display = 'block';
        container.innerHTML = `
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-top:16px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div style="width:32px;height:32px;border-radius:50%;background:#f59e0b;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">${pending.length}</div>
                        <h3 style="margin:0;font-size:16px;color:#1f2937;">🖼️ Pending Proposed Solutions</h3>
                        ${overdueCount ? `<span style="background:#fef2f2;color:#dc2626;font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;"><i class="fas fa-exclamation-circle"></i> ${overdueCount} overdue</span>` : ''}
                    </div>
                </div>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    ${pending.map(sol => {
                        const person = sol.prospect_id ? prospectMap[String(sol.prospect_id)] : sol.customer_id ? customerMap[String(sol.customer_id)] : null;
                        const name = person?.full_name || 'Unknown';
                        const daysSince = sol.proposed_date ? Math.floor((new Date(todayStr) - new Date(sol.proposed_date)) / 86400000) : null;
                        const isOverdue = daysSince !== null && daysSince >= 7;
                        const isEscalated = !!sol.escalated_at;
                        const borderColor = isEscalated ? '#dc2626' : isOverdue ? '#f59e0b' : '#22c55e';
                        const navId = sol.prospect_id || sol.customer_id;
                        const navFn = sol.prospect_id ? `app.showProspectDetail(${navId})` : `app.showCustomerDetail(${navId})`;
                        return `
                        <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:#f9fafb;border-radius:8px;border-left:4px solid ${borderColor};cursor:pointer;" onclick="${navFn}">
                            <div style="flex:1;min-width:0;">
                                <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;">
                                    <strong style="font-size:13px;color:#1f2937;">${escapeHtml(name)}</strong>
                                    <span style="font-size:11px;background:#fef9c3;color:#92400e;padding:2px 8px;border-radius:10px;">${escapeHtml(sol.solution || '')}</span>
                                    ${isEscalated ? '<span style="font-size:11px;background:#fef2f2;color:#dc2626;padding:2px 8px;border-radius:10px;">Escalated</span>' : ''}
                                </div>
                                <div style="font-size:11px;color:#6b7280;">
                                    Proposed: ${sol.proposed_date || '—'}
                                    ${daysSince !== null ? ` · <span style="color:${isOverdue ? '#dc2626' : '#6b7280'};font-weight:${isOverdue ? '600' : '400'}">${daysSince}d ago</span>` : ''}
                                    ${sol.next_follow_up_date ? ` · Next follow-up: ${sol.next_follow_up_date}` : ''}
                                </div>
                            </div>
                            <button class="btn primary btn-sm" style="font-size:11px;padding:5px 10px;white-space:nowrap;"
                                onclick="event.stopPropagation(); app.openEditSolutionModal(${sol.id}, ${sol.prospect_id || sol.customer_id}, ${!!sol.prospect_id})">
                                <i class="fas fa-edit"></i> Update
                            </button>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        `;
    };

    // Fetch activities where the current user is in the co_agents JSONB array.
    // The standard renderCalendar / renderTodayActivities query scopes by lead_agent_id
    // (so non-admins only see activities they own or supervise), which silently drops
    // any activity where the user is just a co-agent. This helper covers the gap with
    // a JSONB containment query, run in parallel and merged client-side.
    //
    // Returns an array of activity rows (possibly empty). Best-effort: any error is
    // swallowed so it never breaks calendar rendering for the lead-agent path.
    const _fetchActivitiesAsCoAgent = async (rangeStart, rangeEnd) => {
        try {
            if (!_state.cu || _state.cu.id == null) return [];
            const client = AppDataStore._readClient && AppDataStore._readClient();
            if (!client) return [];
            // .contains() serialises the JS array as {[object Object]} instead
            // of valid JSON, causing a 400. Use .filter() with an explicit
            // JSON string so PostgREST receives: co_agents=cs.[{"id":123}]
            // JSONB @> partial-object matching handles the remaining keys
            // (name, co_role, status) correctly.
            // Phase Q: trimmed column list — these are the only fields renderCalendar
            // reads in the per-cell render block. Was select('*') which returned
            // ~50 columns × N activities, half wasted on mobile bandwidth.
            let q = client
                .from('activities')
                .select('id,activity_type,activity_date,start_time,end_time,prospect_id,customer_id,lead_agent_id,event_id,co_agents,closing_amount,is_closing,solution_sold,activity_title,venue,location_address,client_request_id')
                .filter('co_agents', 'cs', JSON.stringify([{ id: _state.cu.id }]));
            if (rangeStart) q = q.gte('activity_date', rangeStart);
            if (rangeEnd) q = q.lte('activity_date', rangeEnd);
            const { data, error } = await q;
            if (error) {
                console.warn('[co-agent fetch] failed:', error.message || error);
                return [];
            }
            return data || [];
        } catch (e) {
            console.warn('[co-agent fetch] threw:', e.message || e);
            return [];
        }
    };

    // Cache TTL constant — defined locally so this chunk works standalone
    // (script-activities.js defines the same constant; both share _state cache keys).
    const _LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000;

    const _getVenuesCached = async () => {
        const now = Date.now();
        if (_state.vc && (now - _state.vcts) < _LOOKUP_CACHE_TTL_MS) return _state.vc;
        _state.vc = await AppDataStore.getAll('venues').catch(() => []);
        _state.vcts = Date.now();
        return _state.vc;
    };
    const _getProductsCached = async () => {
        const now = Date.now();
        if (_state.pc && (now - _state.pcts) < _LOOKUP_CACHE_TTL_MS) return _state.pc;
        _state.pc = await AppDataStore.getAll('products').catch(() => []);
        _state.pcts = Date.now();
        return _state.pc;
    };

    // Single source of truth for a month-grid appointment card. Previously this
    // ~60-line builder was duplicated in _renderCalendarLegacy and the main
    // _renderCalendarImpl per-cell loops; the two copies had drifted (only the
    // main path grew optimistic-badge handling). Both call sites now go through
    // here so they can never diverge again. ctx carries the lookup maps both
    // sites build; _state.cu / isSystemAdmin / esc / escapeHtml are read from the
    // enclosing closure. The richer (main-path) behaviour — optimistic ⏳/⚠
    // badge, optimistic-pending/failed classes, and the sync-error onclick — is
    // preserved for BOTH paths. Legacy activity rows have no _optimistic field,
    // so for them _optBadge stays '' and the onclick falls back to
    // viewActivityDetails — identical to the legacy output before extraction.
    const buildAppointmentCardHtml = (a, ctx) => {
        const { prospectMap, customerMap, userMap, eventMap, entityScope } = ctx;
        const prospect = a.prospect_id ? prospectMap.get(String(a.prospect_id)) : null;
        const customer = a.customer_id ? customerMap.get(String(a.customer_id)) : null;
        // Entity-name gate (commits fa31e3b/3a75855; extended 2026-07 so leaders/
        // managers see downline names). Owners/co-agents/admins and any viewer
        // whose scope covers the lead agent see the client name; peers viewing a
        // public activity outside their scope do not. See _canViewEntityName.
        const _tileOwned = _canViewEntityName(a, entityScope);
        const entityName = _tileOwned
            ? (prospect ? prospect.full_name : (customer ? customer.full_name : (a.activity_title || a.customer_name || 'Event')))
            : (a.activity_title || a.activity_type || 'Activity');
        if (!entityName) return '';

        const isEvent = a.activity_type === 'EVENT';
        const agent = (!isEvent && a.lead_agent_id) ? userMap.get(String(a.lead_agent_id)) : null;
        // Fall back through lead → first co-agent → "Unassigned" so the UI never
        // renders a literal "null" when the lead user isn't in userMap.
        const firstCoAgentName = Array.isArray(a.co_agents) && a.co_agents[0]?.name;
        const agentName = agent?.full_name || firstCoAgentName || 'Unassigned';
        const coAgentCount = Array.isArray(a.co_agents) ? a.co_agents.length : 0;
        const extraCoAgents = agent?.full_name ? coAgentCount : Math.max(coAgentCount - 1, 0);

        // Pending invite: does the current viewer need to Accept/Reject this co-agent slot?
        const myCoAgentStatus = _state.cu && Array.isArray(a.co_agents)
            ? a.co_agents.find(ca => String(ca.id) === String(_state.cu.id))?.status
            : null;
        const isPendingInvite = myCoAgentStatus === 'pending';
        const isRejectedInvite = myCoAgentStatus === 'rejected';

        // For EVENTs: show event title instead of agent/entity
        let eventTitle = null;
        let eventVenue = null;
        if (isEvent && a.event_id) {
            const ev = eventMap.get(String(a.event_id));
            eventTitle = ev ? (ev.event_title || ev.title) : null;
            eventVenue = ev ? (ev.location || null) : null;
        }
        // Fall back to location_address: the `venue` column may be missing from
        // the Supabase schema, in which case it gets stripped on save and only
        // survives in the creator's localStorage. We mirror to location_address
        // (which IS persisted server-side) so other users see the venue too.
        const displayVenue = a.venue || eventVenue || a.location_address || '';

        // Build the optimistic badge with a rich, captured error in the tooltip.
        // 'pending' = ⏳ Saving / Retrying; 'failed' = ⚠ + actual Postgres error.
        // navigator.onLine drives the wording so the user knows we *will* retry
        // automatically when WiFi/data returns — no manual action required.
        let _optBadge = '';
        if (a._optimistic === 'pending') {
            const _t = navigator.onLine ? 'Saving…' : 'Waiting for connection — will sync automatically';
            _optBadge = ` <span class="opt-badge" title="${escapeHtml(_t)}">⏳</span>`;
        } else if (a._optimistic === 'failed') {
            const _human = a._errorMsg || 'Save failed';
            const _code  = a._errorCode ? ` [${a._errorCode}]` : '';
            const _raw   = a._errorRaw && a._errorRaw !== a._errorMsg ? `\nDetails: ${a._errorRaw}` : '';
            const _hint  = navigator.onLine
                ? '\nWill keep retrying in background.'
                : '\nWaiting for connection — auto-syncs when you reconnect.';
            _optBadge = ` <span class="opt-badge fail" title="${escapeHtml(_human + _code + _raw + _hint)}">⚠</span>`;
        }

        return `
            <div class="calendar-appointment ${(a.activity_type || '').toLowerCase()} ${(a.closing_amount || a.is_closing) ? 'closed-case' : ''} ${isPendingInvite ? 'pending-invite' : ''} ${isRejectedInvite ? 'rejected-invite' : ''} ${a._optimistic === 'pending' ? 'optimistic-pending' : ''} ${a._optimistic === 'failed' ? 'optimistic-failed' : ''}"
                onclick="event.stopPropagation(); ${a._optimistic === 'failed' ? `app.showSyncErrorModal(${escapeHtml(JSON.stringify(a.id))},${escapeHtml(JSON.stringify(a._errorMsg||''))},${escapeHtml(JSON.stringify(a._errorCode||''))})` : a._optimistic ? '' : `app.viewActivityDetails(${a.id})`}">
                <div class="appointment-time">${(a.start_time || '00:00').slice(0,5)}${_optBadge}</div>
                ${isEvent
                    ? `<div class="appointment-customer">${esc(eventTitle || a.activity_title || 'Event')}</div>`
                    : `<div class="appointment-customer">${esc(entityName)}</div>
                <div class="appointment-agent">${esc(agentName)}${extraCoAgents > 0 ? ` +${extraCoAgents}` : ''}</div>`
                }
                <div class="appointment-type">${esc(a.activity_type)}</div>
                ${displayVenue ? `<div class="appointment-venue">${esc(displayVenue)}</div>` : ''}
                ${isPendingInvite ? `
                <div class="co-agent-invite-actions" style="display:flex;gap:4px;margin-top:6px;padding-top:6px;border-top:1px dashed rgba(0,0,0,0.1);">
                    <button class="btn btn-sm" style="flex:1;background:#dcfce7;color:#166534;border:none;padding:3px 6px;border-radius:4px;cursor:pointer;font-size:11px;" onclick="event.stopPropagation();(async()=>{await app.respondCoAgentInvite(${a.id},'accepted');})()"><i class="fas fa-check"></i> Accept</button>
                    <button class="btn btn-sm" style="flex:1;background:#fee2e2;color:#991b1b;border:none;padding:3px 6px;border-radius:4px;cursor:pointer;font-size:11px;" onclick="event.stopPropagation();(async()=>{await app.respondCoAgentInvite(${a.id},'rejected');})()"><i class="fas fa-times"></i> Reject</button>
                </div>
                ` : ''}
                ${isRejectedInvite ? `<div class="appointment-status-rejected" style="margin-top:6px;padding:3px 6px;background:#fee2e2;color:#991b1b;border-radius:4px;font-size:11px;text-align:center;"><i class="fas fa-times-circle"></i> You rejected this</div>` : ''}
                ${(a.closing_amount || a.is_closing) ? `
                <div class="appointment-closed">
                    <div class="closed-badge">✓ CLOSED</div>
                    ${a.solution_sold ? `<div class="closed-product">📦 ${esc(a.solution_sold)}</div>` : ''}
                    ${a.closing_amount ? `<div class="closed-amount">💰 RM ${parseFloat(a.closing_amount).toLocaleString('en-MY', {minimumFractionDigits:2,maximumFractionDigits:2})}</div>` : ''}
                </div>
                ` : ''}
            </div>
        `;
    };

    // Legacy multi-query calendar fetch — the pre-2026-05-03 path. Kept as a
    // fallback so the calendar still renders if the get_calendar_window RPC
    // hasn't been deployed yet (e.g. during the gap between code push and
    // migration apply). Once the RPC is verified live, this function and the
    // fallback branch above can be deleted.
    const _renderCalendarLegacy = async ({ myToken, year, month, daysInMonth, startDay, rangeStart, monthEnd, html, grid, visibleIds }) => {
        const actQueryOpts = {
            gte: { activity_date: rangeStart },
            lte: { activity_date: monthEnd },
            sort: 'activity_date',
            sortDir: 'asc',
            limit: 5000,
            offset: 0,
            countMode: null,
            filters: {},
        };
        // Agent filter is a user-chosen narrowing and applies to EVERY viewer,
        // including admins — the admin scoping guard is a SEPARATE concern below.
        if (_filters.agent && _filters.agent !== 'all') {
            actQueryOpts.filters.lead_agent_id = _filters.agent;
        }
        if (_filters.type && _filters.type !== 'all') {
            actQueryOpts.filters.activity_type = _filters.type;
        }
        if (!isSystemAdmin(_state.cu) && visibleIds !== 'all') {
            actQueryOpts.scopeFields = [
                { field: 'lead_agent_id', values: visibleIds },
                { field: 'visibility', values: ['open', 'public', 'team'] }
            ];
        }
        const needsCoAgentMerge = !isSystemAdmin(_state.cu) && _state.cu?.id != null;
        const coAgentFetch = needsCoAgentMerge
            ? _fetchActivitiesAsCoAgent(rangeStart, monthEnd)
            : Promise.resolve([]);
        const [actResult, allEvents, allUsers, coAgentRows] = await Promise.all([
            AppDataStore.queryAdvanced('activities', actQueryOpts),
            AppDataStore.getAll('events'),
            AppDataStore.getAll('users'),
            coAgentFetch,
        ]);
        let rawActivities = actResult.data;
        if (coAgentRows && coAgentRows.length > 0) {
            const seen = new Set(rawActivities.map(a => String(a.id)));
            for (const a of coAgentRows) {
                if (!seen.has(String(a.id))) {
                    seen.add(String(a.id));
                    rawActivities.push(a);
                }
            }
        }
        const eventIds = new Set(allEvents.map(e => String(e.id)));
        const userMap = new Map(allUsers.map(u => [String(u.id), u]));
        const eventMap = new Map(allEvents.map(e => [String(e.id), e]));
        let activities = allEvents.length === 0
            ? rawActivities
            : rawActivities.filter(a =>
                a.activity_type !== 'EVENT' || !a.event_id || eventIds.has(String(a.event_id))
              );
        if (_filters.caseStatus === 'closed') {
            activities = activities.filter(a => a.closing_amount && parseFloat(a.closing_amount) > 0);
        } else if (_filters.caseStatus === 'open') {
            activities = activities.filter(a => !a.closing_amount || parseFloat(a.closing_amount) <= 0);
        }
        // Make every rendered row resolvable on click (see _calGridIndex).
        _indexGridActivities(activities);
        const neededProspectIds = [...new Set(activities.filter(a => a.prospect_id).map(a => a.prospect_id))];
        const neededCustomerIds = [...new Set(activities.filter(a => a.customer_id).map(a => a.customer_id))];
        const [prospectResult, customerResult] = await Promise.all([
            neededProspectIds.length > 0
                ? AppDataStore.queryAdvanced('prospects', { scopeField: 'id', scopeValues: neededProspectIds, limit: 5000, select: 'id,full_name', countMode: null })
                : Promise.resolve({ data: [] }),
            neededCustomerIds.length > 0
                ? AppDataStore.queryAdvanced('customers', { scopeField: 'id', scopeValues: neededCustomerIds, limit: 5000, select: 'id,full_name', countMode: null })
                : Promise.resolve({ data: [] }),
        ]);
        const prospectMap = new Map(prospectResult.data.map(p => [String(p.id), p]));
        const customerMap = new Map(customerResult.data.map(c => [String(c.id), c]));
        const todayDate = new Date();
        const isCurrentMonth = todayDate.getMonth() === month && todayDate.getFullYear() === year;
        const isMobileCalendar = window.innerWidth < 768;
        const maxRenderPerCell = isMobileCalendar ? 2 : Infinity;
        for (let i = 1; i <= daysInMonth; i++) {
            const isToday = isCurrentMonth && i === todayDate.getDate();
            const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${i.toString().padStart(2, '0')}`;
            const dayActivities = activities.filter(a => a.activity_date === dateStr && !_isAutoTouchLog(a))
                .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
            let activityHtml = '';
            let renderedInCell = 0;
            let skippedInCell = 0;
            const seenIds = new Set();
            const seenEventSlots = new Set();
            for (const a of dayActivities) {
                if (seenIds.has(a.id)) continue;
                seenIds.add(a.id);
                if (a.activity_type === 'EVENT' && a.event_id) {
                    const slotKey = `${a.event_id}|${a.start_time || ''}|${a.end_time || ''}`;
                    if (seenEventSlots.has(slotKey)) continue;
                    seenEventSlots.add(slotKey);
                }
                // Unified card builder (shared with the main RPC path). Returns ''
                // when the ownership/entity gate produces no name — matches the
                // legacy `if (!entityName) continue;` (no per-cell cap consumed).
                const _cardHtml = buildAppointmentCardHtml(a, { prospectMap, customerMap, userMap, eventMap, entityScope: visibleIds });
                if (!_cardHtml) continue;
                if (renderedInCell >= maxRenderPerCell) { skippedInCell++; continue; }
                activityHtml += _cardHtml;
                renderedInCell++;
            }
            if (skippedInCell > 0) {
                activityHtml += `<div class="more-events-indicator" onclick="event.stopPropagation(); app.openDayView('${dateStr}')">+${skippedInCell} more</div>`;
            }
            html += `
                <div class="calendar-cell ${isToday ? 'today' : ''}" onclick="app.openActivityModal('${dateStr}')">
                    <span class="date-num">${i}</span>
                    <div class="grid-activities">${activityHtml}</div>
                </div>`;
        }
        const totalCells = startDay + daysInMonth;
        const remainingCells = 42 - totalCells;
        for (let i = 1; i <= remainingCells; i++) {
            const nextMonth = month === 11 ? 0 : month + 1;
            const nextYear = month === 11 ? year + 1 : year;
            const nextDateStr = `${nextYear}-${(nextMonth + 1).toString().padStart(2, '0')}-${i.toString().padStart(2, '0')}`;
            html += `<div class="calendar-cell" onclick="app.openActivityModal('${nextDateStr}')"><span class="date-num other-month">${i}</span></div>`;
        }
        if (myToken !== _state.rct) return;
        grid.innerHTML = html;
        _getVenuesCached();
        _getProductsCached();
    };

    // ==================== OPTIMISTIC ACTIVITY OVERLAY (Phase J + K) ====================
    // While AppDataStore.add('activities', …) is in flight, the row lives here
    // so the calendar can render it immediately with a ⏳ badge. On success the
    // entry is cleared and the real row arrives via the next fetch. On failure
    // the entry is marked 'failed' so the user sees a ⚠️ retry chip.
    const _optimisticActivities = new Map(); // key: client_request_id

    // Surface helpers on window so data.js (which lives outside this IIFE) can
    // push/clear without needing to be part of the closure.
    window._addOptimisticActivity = (row) => {
        if (!row || !row.client_request_id) return;
        _optimisticActivities.set(row.client_request_id, { ...row, _optimistic: 'pending', _ts: Date.now() });
        // Fire a coalesced redraw — Perf.coalesce already prevents bursts.
        if (typeof renderCalendar === 'function') renderCalendar().catch(() => {});
    };
    window._confirmOptimisticActivity = (clientRequestId) => {
        if (!clientRequestId) return;
        _optimisticActivities.delete(clientRequestId);
        if (typeof renderCalendar === 'function') renderCalendar().catch(() => {});
    };
    window._failOptimisticActivity = (clientRequestId, errorMsg, errorCode, rawMsg) => {
        if (!clientRequestId) return;
        const row = _optimisticActivities.get(clientRequestId);
        if (row) {
            row._optimistic = 'failed';
            row._errorMsg = errorMsg || 'Save failed';
            row._errorCode = errorCode || null;
            row._errorRaw = rawMsg || null;
            row._errorAt = Date.now();
        }
        if (typeof renderCalendar === 'function') renderCalendar().catch(() => {});
    };
    // Flip every currently-failed optimistic row back to 'pending' so the user sees
    // the retry attempt as ⏳ instead of stale ⚠. Called when 'online' fires.
    window._markOptimisticRetrying = () => {
        let touched = 0;
        for (const row of _optimisticActivities.values()) {
            if (row._optimistic === 'failed') {
                row._optimistic = 'pending';
                touched++;
            }
        }
        if (touched > 0 && typeof renderCalendar === 'function') renderCalendar().catch(() => {});
    };
    // Rendering helper: returns optimistic rows whose activity_date falls inside
    // the given range, EXCLUDING any whose client_request_id already appears in
    // the fetched data (avoids duplicates once the server confirms).
    window._mergeOptimisticActivities = (fetched, rangeStart, rangeEnd) => {
        if (_optimisticActivities.size === 0) return fetched;
        const seen = new Set(fetched.map(a => a.client_request_id).filter(Boolean));
        const merged = fetched.slice();
        for (const [crid, row] of _optimisticActivities) {
            if (seen.has(crid)) continue; // already arrived from server
            if (row.activity_date && (row.activity_date < rangeStart || row.activity_date > rangeEnd)) continue;
            merged.push(row);
        }
        return merged;
    };

    // Pure HTML builder for one month-grid day cell — extracted verbatim from
    // _renderCalendarImpl. The per-day activity loop (filter/dedup/+N-more, which
    // uses `continue`) stays in the orchestrator; this only wraps the already-
    // assembled `activityHtml` string in the cell markup.
    const buildMonthDayCellHtml = (dayNum, dateStr, isToday, activityHtml) => {
        return `
                <div class="calendar-cell ${isToday ? 'today' : ''}" onclick="app.openActivityModal('${dateStr}')">
                    <span class="date-num">${dayNum}</span>
                    <div class="grid-activities">
                        ${activityHtml}
                    </div>
                </div>`;
    };

    const _renderCalendarImpl = async () => {
        const myToken = ++_state.rct;
        // ── Perf instrumentation (Tier 0). Cheap, observable in DevTools.
        // Look for "[cal-perf]" rows in the console — they print where the
        // cold-load time is going. Remove once cold-load p50 is acceptable.
        const _calPerfT0 = performance.now();
        const _calPerf = (label) => {
            try { console.info(`[cal-perf] ${label} +${Math.round(performance.now() - _calPerfT0)}ms`); } catch(_) { /* intentional: perf logging is best-effort */ }
        };
        _calPerf('renderCalendar:start');
        updateMonthHeader(_state.cd);

        const header = document.getElementById('calendar-days-header');
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        if (header) header.innerHTML = days.map(d => `<div class="day-header">${d}</div>`).join('');

        const grid = document.getElementById('calendar-grid');
        if (!grid) return;

        // Snapshot restore — if we already rendered this month, show the cached
        // HTML instantly so the user sees their calendar with zero wait.
        // The RPC fetch continues below; if fresh data differs we swap quietly.
        // Tier 1.4: TTL extended 30m → 8h to match mobile (mcal-snap), and SWR
        // pattern — stale snapshot still paints instantly, fresh data swaps in
        // silently when it arrives. Stale beats blank.
        // Namespaced by user id: the snapshot is rendered with the viewer's
        // role/group scope already baked in (ownership gate + RPC scope), so it
        // MUST NOT be read back by a different user on a shared device. Without
        // the uid prefix, a higher-scope user's cached month (e.g. an admin who
        // sees every agent's activities) would paint for the next, lower-scope
        // login — most visibly in offline mode, where no scoped RPC swaps it out.
        const _calSnapKey = `cal-snap-${_state.cu?.id || 'anon'}-${_state.cd.getFullYear()}-${_state.cd.getMonth()}`;
        const _CAL_SNAP_TTL_MS = 8 * 60 * 60 * 1000; // 8h
        const _calSnap = (() => {
            try {
                const raw = localStorage.getItem(_calSnapKey);
                if (!raw) return null;
                const { ts, html } = JSON.parse(raw);
                if (!ts || Date.now() - ts > _CAL_SNAP_TTL_MS) return null;
                return html;
            } catch (_) { /* intentional: corrupt/absent snapshot → no cache */ return null; }
        })();
        if (_calSnap) {
            grid.innerHTML = _calSnap; // instant paint — no dim needed
            _calPerf('snapshot-painted');
        } else {
            // First-ever render of this month: paint a skeleton grid (Phase N)
            // so the user sees structured placeholders instead of a blank/dim
            // void. 42 cells = 6 rows × 7 days. Replaced once data arrives.
            let _sk = '';
            for (let i = 0; i < 42; i++) {
                _sk += '<div class="calendar-cell skel-cell"><span class="skeleton-block skel-cell-num"></span>' +
                       '<span class="skeleton-block skel-cell-row"></span>' +
                       '<span class="skeleton-block skel-cell-row short"></span></div>';
            }
            grid.innerHTML = _sk;
            _calPerf('skeleton-painted');
        }

        try {

        let html = '';

        const year = _state.cd.getFullYear();
        const month = _state.cd.getMonth();

        const firstDayOfMonth = new Date(year, month, 1);
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        // Adjust to Monday start (0=Mon, 6=Sun)
        let startDay = firstDayOfMonth.getDay() - 1;
        if (startDay === -1) startDay = 6;

        const daysInPrevMonth = new Date(year, month, 0).getDate();

        // Previous month overflow days
        for (let i = startDay - 1; i >= 0; i--) {
            const dateNum = daysInPrevMonth - i;
            const prevMonth = month === 0 ? 11 : month - 1;
            const prevYear = month === 0 ? year - 1 : year;
            const prevDateStr = `${prevYear}-${(prevMonth + 1).toString().padStart(2, '0')}-${dateNum.toString().padStart(2, '0')}`;
            html += `<div class="calendar-cell" onclick="app.openActivityModal('${prevDateStr}')"><span class="date-num other-month">${dateNum}</span></div>`;
        }

        // ── Visible date range (incl. prev-month overflow + next-month overflow) ──
        const nextMonth = month === 11 ? 0 : month + 1;
        const nextYear = month === 11 ? year + 1 : year;
        const monthEnd = `${nextYear}-${(nextMonth + 1).toString().padStart(2, '0')}-01`;
        const prevOverflow = new Date(year, month, 1 - startDay);
        const rangeStart = `${prevOverflow.getFullYear()}-${(prevOverflow.getMonth() + 1).toString().padStart(2, '0')}-${prevOverflow.getDate().toString().padStart(2, '0')}`;

        // Hot window = yesterday → today + 7 days. Full activity rows for this
        // window are warmed into _state.hac so click-to-detail is instant
        // (no second network round-trip). Independent of the visible month —
        // even when viewing a past/future month, the cache always covers the
        // user's near-term activity.
        const _todayJs = new Date();
        const _yJs = new Date(_todayJs); _yJs.setDate(_todayJs.getDate() - 1);
        const _hotEndJs = new Date(_todayJs); _hotEndJs.setDate(_todayJs.getDate() + 7);
        const _ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const hotStart = _ymd(_yJs);
        const hotEnd   = _ymd(_hotEndJs);

        // Translate getVisibleUserIds → RPC params. 'all' (admin/lead) maps to
        // is_admin=true so the RPC short-circuits the OR scope.
        const visibleIds = await getVisibleUserIds(_state.cu);
        const isAdmin = isSystemAdmin(_state.cu) || visibleIds === 'all';
        const visibleIdsArr = Array.isArray(visibleIds) ? visibleIds : null;
        const userId = _state.cu?.id ?? 0;

        const lightParams = {
            p_range_start:  rangeStart,
            p_range_end:    monthEnd,
            p_user_id:      userId,
            p_visible_ids:  isAdmin ? null : visibleIdsArr,
            p_is_admin:     isAdmin,
            p_agent_filter: (_filters.agent && _filters.agent !== 'all') ? _filters.agent : null,
            p_type_filter:  (_filters.type && _filters.type !== 'all') ? _filters.type : null,
        };
        const hotParams = {
            p_range_start:  hotStart,
            p_range_end:    hotEnd,
            p_user_id:      userId,
            p_visible_ids:  isAdmin ? null : visibleIdsArr,
            p_is_admin:     isAdmin,
        };

        // Tier 1.1: render the grid as soon as the LIGHT RPC returns. The hot
        // RPC only warms a click-cache for the detail modal — there's no reason
        // to make the user wait for it. Previously a Promise.all gate meant a
        // slow hotRes added its full latency to the time-to-grid-paint.
        // NOTE: supabase-js v2 .rpc() returns a thenable PostgrestFilterBuilder,
        // not a real Promise — wrap in Promise.resolve() before .catch/.then.
        // Helper: read any stored snapshot for this month, ignoring TTL.
        // Used in multiple fallback paths below so defined once here.
        const _readStaleSnap = () => {
            try { const raw = localStorage.getItem(_calSnapKey); return raw ? JSON.parse(raw).html : null; } catch (_) { /* intentional: corrupt/absent snapshot → no cache */ return null; }
        };
        // Helper: paint stale snapshot or, if none exists, show an offline
        // placeholder so the user never stares at a blank/skeleton grid.
        const _paintOfflineFallback = (reason) => {
            if (myToken !== _state.rct) return; // a newer render owns the grid
            const staleSnap = _readStaleSnap();
            if (staleSnap) {
                if (grid.innerHTML !== staleSnap) grid.innerHTML = staleSnap;
                console.warn('[calendar] ' + reason + ' — showing stale snapshot');
            } else {
                grid.innerHTML = '<div style="padding:40px 16px;text-align:center;color:#9ca3af;grid-column:1/-1">' +
                    '<div style="font-size:36px;margin-bottom:10px">📅</div>' +
                    '<div style="font-weight:600;color:#6b7280">No cached data</div>' +
                    '<div style="font-size:13px;margin-top:6px">Open calendar while connected to enable offline view</div>' +
                    '</div>';
                console.warn('[calendar] ' + reason + ' — no cached snapshot available');
            }
        };

        // Wrap the light RPC so a thrown network error (supabase-js on Android
        // can throw TypeError instead of returning { error }) is normalised into
        // the same { data, error } shape as a returned error, keeping all
        // error-handling logic in one place below.
        _calPerf('rpc:light:start');
        let lightRes;
        try {
            lightRes = await Promise.race([
                Promise.resolve(window.supabase.rpc('get_calendar_window', lightParams)),
                new Promise(resolve => setTimeout(
                    () => resolve({ data: null, error: { message: 'Failed to fetch: calendar RPC timed out after 10s', code: '' } }),
                    10000
                ))
            ]);
        } catch (fetchErr) {
            lightRes = { data: null, error: { message: fetchErr?.message || 'Network error', code: '' } };
        }
        _calPerf('rpc:light:done');
        // Fire-and-forget hot RPC. Once it lands we drop the rows into
        // _state.hac so subsequent activity-card taps still feel instant,
        // AND prime them into AppDataStore so every downstream handler that
        // calls AppDataStore.getById('activities', id) finds them — even when
        // the calling user's RLS would not return the row on a direct table
        // SELECT (e.g. consultants on an activity they didn't create). Without
        // the prime call, the modal would render via _state.hac but the
        // Accept/Reject/Repair-Link handlers would surface "Activity not found".
        Promise.resolve(window.supabase.rpc('get_calendar_hot_details', hotParams))
            .then(hotRes => {
                if (hotRes && hotRes.data && hotRes.data.length > 0) {
                    for (const a of hotRes.data) _state.hac.set(String(a.id), a);
                    try { AppDataStore.primeRows('activities', hotRes.data); } catch (_) { /* intentional: cache priming is best-effort */ }
                }
            })
            .catch(e => { console.warn('[calendar] hot warm-up failed:', e?.message || e); });

        // Transition fallback: if the calendar_perf_2026-05-03 migration hasn't
        // been applied to this DB yet, the RPC won't exist (PG code 42883). Fall
        // back to the legacy multi-query path so the calendar still renders.
        // Safe to remove once the migration has been verified live.
        if (lightRes.error) {
            // Staleness guard: if the user navigated to another month/view while
            // this RPC was in flight, do NOT paint our (error/offline) result over
            // the newer render — it would clobber good content with a fallback.
            if (myToken !== _state.rct) return;
            const msg = lightRes.error.message || '';
            const missing = lightRes.error.code === '42883' || /function .* does not exist/i.test(msg);
            if (missing) {
                console.warn('[calendar] RPC not yet deployed, using legacy fetch path');
                return await _renderCalendarLegacy({
                    myToken, year, month, daysInMonth, startDay,
                    rangeStart, monthEnd, html, grid, visibleIds,
                });
            }
            // Network/offline — prefer stale snapshot over blank grid.
            // navigator.onLine is unreliable on Android (true even when server
            // unreachable), so also match common fetch-failure message patterns.
            const isNetworkErr = !navigator.onLine
                || /failed to fetch|network request failed|load failed|networkerror|internet connection/i.test(msg);
            if (isNetworkErr) {
                _paintOfflineFallback('offline');
                return;
            }
            // Non-network server error — toast and leave whatever is on screen.
            console.error('[calendar] get_calendar_window failed:', lightRes.error);
            UI.toast.error('Calendar load failed: ' + msg);
            return;
        }

        // Dead-session empty-read guard. A no-error RPC that returns ZERO rows while our
        // LOCAL auth token is missing/expired is almost always an RLS empty read from a
        // silently-dropped session (the request quietly downgraded to the anon role, which
        // gets 200 + [] — not a 401), NOT a genuinely empty month. Rendering [] here would
        // wipe the calendar and read as data loss ("all my info is gone"). Instead keep the
        // last-good view (stale snapshot) and run the CONSERVATIVE liveness probe, which only
        // prompts re-login if supabase-js confirms the session is truly gone (a refresh that
        // self-heals is left untouched, so a genuinely empty month is never misflagged once
        // the token is valid). Guarded on !hasLiveSession() so it can't fire on a healthy
        // session. (bug 2026-07: mobile calendar showed empty after a silent session drop)
        if ((!lightRes.data || lightRes.data.length === 0)
            && window.AppDataStore && typeof AppDataStore.hasLiveSession === 'function'
            && !AppDataStore.hasLiveSession()) {
            if (myToken === _state.rct) _paintOfflineFallback('session may have expired — keeping last view');
            try { if (typeof window._checkSessionAlive === 'function') window._checkSessionAlive('calendar_empty_read'); } catch (_) { /* best-effort */ }
            return;
        }

        let activities = (lightRes.data || []).slice();

        // Phase J: merge in optimistic in-flight rows so the user sees them
        // immediately. Once the server acknowledges, the optimistic entry is
        // cleared (in data.js) and the real row from the next fetch replaces it.
        if (typeof window._mergeOptimisticActivities === 'function') {
            activities = window._mergeOptimisticActivities(activities, rangeStart, monthEnd);
        }

        // Hot cache is populated by the fire-and-forget block above (Tier 1.1)
        // — no synchronous handling here. Detail-modal click incurs at most one
        // extra getById round-trip if the hot RPC hasn't landed yet.

        // Orphan EVENT filter: drop activities of type EVENT that have an event_id
        // but NO resolvable title. Two title sources exist:
        //   a.event_title  — returned by the RPC via JOIN on events.title (new column)
        //   a.activity_title — set at save time from ev.event_title || ev.title
        // Old events were created before the `title` column was added, so they only
        // have `event_title` in the DB. The RPC JOIN (e.title) returns null for those,
        // but saveActivity() always writes the resolved title into activity_title, so
        // checking activity_title covers old-event links without dropping real orphans.
        activities = activities.filter(a =>
            a.activity_type !== 'EVENT' || !a.event_id ||
            a.event_title != null || a.activity_title != null
        );

        // Phase 21: Case Status filter (Closed/Open) — kept client-side (computed)
        if (_filters.caseStatus === 'closed') {
            activities = activities.filter(a => a.closing_amount && parseFloat(a.closing_amount) > 0);
        } else if (_filters.caseStatus === 'open') {
            activities = activities.filter(a => !a.closing_amount || parseFloat(a.closing_amount) <= 0);
        }

        // Sort once (server returns unordered for grouped queries)
        activities.sort((a, b) => {
            const da = (a.activity_date || '').localeCompare(b.activity_date || '');
            if (da !== 0) return da;
            return (a.start_time || '').localeCompare(b.start_time || '');
        });

        // Make every row this grid renders resolvable on click, even outside the
        // hot window / under scoped RLS (see _calGridIndex). Indexed from the full
        // list so rows hidden behind the mobile "+N more" cap still open.
        _indexGridActivities(activities);

        // Lookup maps reconstructed from joined RPC fields (no extra queries).
        // userMap/eventMap/prospectMap/customerMap shaped to match the legacy
        // contract used by the per-cell render block below — but only entries
        // we actually need are populated, no full-table scans.
        const userMap = new Map();
        const eventMap = new Map();
        const prospectMap = new Map();
        const customerMap = new Map();
        for (const a of activities) {
            if (a.lead_agent_id != null && a.lead_agent_name) {
                userMap.set(String(a.lead_agent_id), { id: a.lead_agent_id, full_name: a.lead_agent_name });
            }
            if (a.event_id != null && a.event_title != null) {
                eventMap.set(String(a.event_id), {
                    id: a.event_id,
                    event_title: a.event_title,
                    title: a.event_title,
                    location: a.event_location,
                });
            }
            if (a.prospect_id != null && a.prospect_name) {
                prospectMap.set(String(a.prospect_id), { id: a.prospect_id, full_name: a.prospect_name });
            }
            if (a.customer_id != null && a.customer_name) {
                customerMap.set(String(a.customer_id), { id: a.customer_id, full_name: a.customer_name });
            }
        }

        const todayDate = new Date();
        const isCurrentMonth = todayDate.getMonth() === month && todayDate.getFullYear() === year;
        // Cap rendered cards per cell on mobile. Previously every activity was
        // emitted to the DOM and CSS hid the overflow with `display:none`,
        // bloating a busy day's cell with dozens of nodes + inline onclicks.
        // Now we render only what's visible and surface the rest behind a
        // "+N more" tap that opens the day view.
        const isMobileCalendar = window.innerWidth < 768;
        const maxRenderPerCell = isMobileCalendar ? 2 : Infinity;

        for (let i = 1; i <= daysInMonth; i++) {
            const isToday = isCurrentMonth && i === todayDate.getDate();
            const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${i.toString().padStart(2, '0')}`;
            const dayActivities = activities.filter(a => a.activity_date === dateStr && !_isAutoTouchLog(a))
                .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));

            let activityHtml = '';
            let renderedInCell = 0;
            let skippedInCell = 0;
            const seenIds = new Set();
            // Defensive dedup: when multiple agents create separate EVENT activity
            // rows for the same event on the same day at the same time, collapse them
            // to a single calendar card. Without this we render N visually-identical
            // cards (one per agent), which looks broken to the viewer. Non-EVENT
            // activities are not deduped — each agent's CPS/FTF/etc is its own row.
            const seenEventSlots = new Set();

            for (const a of dayActivities) {
                if (!seenIds.has(a.id)) {
                    seenIds.add(a.id);
                    if (a.activity_type === 'EVENT' && a.event_id) {
                        const slotKey = `${a.event_id}|${a.start_time || ''}|${a.end_time || ''}`;
                        if (seenEventSlots.has(slotKey)) continue;
                        seenEventSlots.add(slotKey);
                    }
                    // Unified card builder (shared with the legacy fetch path).
                    // Returns '' when the ownership/entity gate yields no name —
                    // matches the previous `if (entityName) { … }` guard. The cap
                    // and "+N more" accounting are unchanged.
                    const _cardHtml = buildAppointmentCardHtml(a, { prospectMap, customerMap, userMap, eventMap, entityScope: visibleIds });
                    if (_cardHtml) {
                        if (renderedInCell >= maxRenderPerCell) {
                            skippedInCell++;
                            continue;
                        }
                        activityHtml += _cardHtml;
                        renderedInCell++;
                    }
                }
            }

            // "+N more" indicator (mobile only — desktop has Infinity cap so this never fires)
            if (skippedInCell > 0) {
                activityHtml += `<div class="more-events-indicator" onclick="event.stopPropagation(); app.openDayView('${dateStr}')">+${skippedInCell} more</div>`;
            }

            html += buildMonthDayCellHtml(i, dateStr, isToday, activityHtml);
        }

        // Next month overflow days
        const totalCells = startDay + daysInMonth;
        const remainingCells = 42 - totalCells; // 6 rows of 7 = 42

        for (let i = 1; i <= remainingCells; i++) {
            const nextMonth = month === 11 ? 0 : month + 1;
            const nextYear = month === 11 ? year + 1 : year;
            const nextDateStr = `${nextYear}-${(nextMonth + 1).toString().padStart(2, '0')}-${i.toString().padStart(2, '0')}`;
            html += `<div class="calendar-cell" onclick="app.openActivityModal('${nextDateStr}')"><span class="date-num other-month">${i}</span></div>`;
        }

        // Discard if a newer render started while this one's fetches were in flight.
        if (myToken !== _state.rct) return;
        // Tier 1.4 SWR: only swap the painted snapshot if the new HTML actually
        // differs. Avoids a perceptible re-paint flash when the cached snapshot
        // already matches the fresh data (the common case for unchanged days).
        if (grid.innerHTML !== html) grid.innerHTML = html;
        _calPerf('grid-painted');

        // Persist this render to localStorage so future navigations back to
        // this month paint instantly — survives tab close on Android.
        try {
            localStorage.setItem(_calSnapKey, JSON.stringify({ ts: Date.now(), html }));
        } catch (_) { /* intentional: snapshot persist best-effort (quota/private mode) */ }

        // Warm the activity-modal lookup caches in the background so the first
        // tap on a day cell opens instantly instead of waiting on two fetches.
        _getVenuesCached();
        _getProductsCached();

        } finally {
            // Always lift the dim — even on error or early-return — so the grid
            // never stays "frozen" looking. Only the latest render touches it
            // so an older render doesn't undo the dim a newer render just set.
            if (myToken === _state.rct) {
                grid.style.opacity = '';
            }
        }
    };

    // Phase B: coalesce burst calls — back-to-back renderCalendar() invocations
    // (e.g. save → attachListeners → view-switch) collapse into one network round-trip.
    // The 200ms trailing window absorbs follow-ups while a render is in-flight.
    const renderCalendar = (window.Perf && window.Perf.coalesce)
        ? window.Perf.coalesce(_renderCalendarImpl, 200)
        : _renderCalendarImpl;

    const getDotColor = (type) => {
        switch (type) {
            case 'CPS': return 'green';
            case 'FTF': return 'blue';
            case 'FSA': return 'orange';
            case 'EVENT': return 'red';
            default: return 'blue';
        }
    };

    const openCalendarFilterModal = async () => {
        const agents = await getAgentsAndLeaders();
        const types = ['CPS', 'FTF', 'FSA', 'EVENT', 'CALL', 'EMAIL', 'WHATSAPP'];

        const content = `
                <div class="form-group">
                    <label>Agent</label>
                    <select id="cal-filter-agent" class="form-control">
                        <option value="all" ${_filters.agent === 'all' ? 'selected' : ''}>All Agents</option>
                        ${agents.map(a => `<option value="${a.id}" ${String(_filters.agent) === String(a.id) ? 'selected' : ''}>${esc(a.full_name)}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Activity Type</label>
                    <select id="cal-filter-type" class="form-control">
                        <option value="all" ${_filters.type === 'all' ? 'selected' : ''}>All Types</option>
                        ${types.map(t => `<option value="${t}" ${_filters.type === t ? 'selected' : ''}>${t}</option>`).join('')}
                    </select>
                </div>
                <!-- Date-range inputs removed: the month view is inherently
                     month-scoped and no render path ever consumed _filters.from/
                     _filters.to, so they were a no-op control. -->
                <!-- Phase 21: Case Closed Filter -->
                <div class="form-group">
                    <label>Case Status</label>
                    <div class="radio-group" style="display:flex; flex-direction:column; gap:8px; margin-top:5px;">
                        <label style="display:flex; align-items:center; gap:8px;">
                            <input type="radio" name="case-status" value="all" ${_filters.caseStatus === 'all' ? 'checked' : ''}> All Appointments
                        </label>
                        <label style="display:flex; align-items:center; gap:8px;">
                            <input type="radio" name="case-status" value="closed" ${_filters.caseStatus === 'closed' ? 'checked' : ''}> Only Closed Cases
                        </label>
                        <label style="display:flex; align-items:center; gap:8px;">
                            <input type="radio" name="case-status" value="open" ${_filters.caseStatus === 'open' ? 'checked' : ''}> Only Open Cases
                        </label>
                    </div>
                </div>
            `;

        UI.showModal('Calendar Filters', content, [
            { label: 'Clear Filters', type: 'secondary', action: '(async () => { await app.clearCalendarFilters(); })()' },
            { label: 'Apply', type: 'primary', action: '(async () => { await app.applyCalendarFilters(); })()' }
        ]);
    };

    const applyCalendarFilters = async () => {
        _filters.agent = document.getElementById('cal-filter-agent')?.value ?? 'all';
        _filters.type = document.getElementById('cal-filter-type')?.value ?? 'all';
        // from/to intentionally NOT collected: the date-range inputs were removed
        // because no calendar render path consumed them (dead control).

        const caseStatus = document.querySelector('input[name="case-status"]:checked');
        _filters.caseStatus = caseStatus ? caseStatus.value : 'all';

        // Persist to sessionStorage
        sessionStorage.setItem('calendar_filters', JSON.stringify(_filters));

        UI.hideModal();

        if (_state.cv === 'month') await renderCalendar();
        else if (_state.cv === 'day') await renderTodayActivities();
        else await switchView(_state.cv); // other views
    };

    const clearCalendarFilters = async () => {
        Object.assign(_filters, { agent: 'all', type: 'all', from: '', to: '', caseStatus: 'all' });
        sessionStorage.removeItem('calendar_filters');
        UI.hideModal();
        if (_state.cv === 'month') await renderCalendar();
        else await switchView(_state.cv);
    };

    // Load from SessionStorage on init
    const storedFilters = sessionStorage.getItem('calendar_filters');
    if (storedFilters) {
        try {
            Object.assign(_filters, JSON.parse(storedFilters));
        } catch (e) { /* intentional: corrupt stored filters → keep defaults */ }
    }

    // Pure HTML builder for one "today" activity card — extracted verbatim from
    // renderTodayActivities' per-row loop. All ownership/entity/status resolution
    // stays in the orchestrator; this only assembles the card string. `esc` is
    // read from the enclosing closure (same as the inline code).
    const buildTodayActivityCardHtml = (a, agentName, entityName, typeClass, statusText) => {
        return `
                <div class="today-act-card ${typeClass}" onclick="app.viewActivityDetails(${a.id})">
                    <div class="tac-meta">
                        <span class="tac-time">${a.start_time ? a.start_time.slice(0,5) : '--:--'}</span>
                        <span class="tac-type ${typeClass}">${esc(a.activity_type)}</span>
                        <span class="tac-status">${statusText}${(a.closing_amount || a.is_closing) ? ' · Closed' : ''}</span>
                    </div>
                    <div class="tac-names">
                        <div class="tac-agent">${esc(agentName)}</div>
                        ${entityName !== 'N/A' ? `<div class="tac-customer">${esc(entityName)}</div>` : ''}
                    </div>
                    <div class="tac-actions" onclick="event.stopPropagation()">
                        <button class="btn btn-sm tac-btn-view" title="View" onclick="app.viewActivityDetails(${a.id})"><i class="fas fa-eye"></i></button>
                        <button class="btn btn-sm tac-btn-outcome" title="Outcome" onclick="(async()=>{await app.openMeetingOutcomeModal(${a.id});})()"><i class="fas fa-clipboard-check"></i></button>
                        <button class="btn btn-sm tac-btn-notes" title="Notes" onclick="(async()=>{await app.openPostMeetupNotesModal(${a.id},${a.prospect_id || 'null'});})()"><i class="fas fa-sticky-note"></i></button>
                        <button class="btn btn-sm tac-btn-edit" title="Edit" onclick="app.editActivity(${a.id})"><i class="fas fa-pen"></i></button>
                        <button class="btn btn-sm tac-btn-co" title="Add Co-Agent" onclick="app.addCoAgentToActivity(${a.id})"><i class="fas fa-user-plus"></i></button>
                    </div>
                </div>
            `;
    };

    const renderTodayActivities = async () => {
        const grid = document.getElementById('today-activities-grid');
        if (!grid) return;

        const today = new Date();
        const dateStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;

        // ── Fetch ONLY today's activities from Supabase (not all history) ──
        const visibleIds = await getVisibleUserIds(_state.cu);
        const queryOpts = {
            filters: { activity_date: dateStr },
            sort: 'start_time',
            sortDir: 'asc',
            limit: 500,
            offset: 0,
            countMode: null, // no pagination needed
        };
        // Agent filter is a user-chosen narrowing and applies to every viewer, admins included.
        if (_filters && _filters.agent && _filters.agent !== 'all') {
            queryOpts.filters.lead_agent_id = _filters.agent;
        }
        if (_filters && _filters.type && _filters.type !== 'all') {
            queryOpts.filters.activity_type = _filters.type;
        }
        // Same OR-with-public-events scoping as renderCalendar: an agent must
        // see today's public events even when the creator is outside their
        // reporting subtree.
        if (!isSystemAdmin(_state.cu) && visibleIds !== 'all') {
            queryOpts.scopeFields = [
                { field: 'lead_agent_id', values: visibleIds },
                { field: 'visibility', values: ['open', 'public', 'team'] }
            ];
        }

        // Non-admins also need a parallel JSONB query for today's activities where
        // they are a co-agent — the lead_agent_id scope above drops those rows.
        const needsCoAgentMergeRTA = !isSystemAdmin(_state.cu) && _state.cu?.id != null;
        const coAgentFetchRTA = needsCoAgentMergeRTA
            ? _fetchActivitiesAsCoAgent(dateStr, dateStr)
            : Promise.resolve([]);
        const [actResult, allEventsRTA, allUsersRTA, coAgentRowsRTA] = await Promise.all([
            AppDataStore.queryAdvanced('activities', queryOpts),
            AppDataStore.getAll('events'),
            AppDataStore.getAll('users'),
            coAgentFetchRTA,
        ]);
        // Merge co-agent rows in so the viewer sees today's invited activities too.
        if (coAgentRowsRTA && coAgentRowsRTA.length > 0) {
            const seenRTA = new Set(actResult.data.map(a => String(a.id)));
            for (const a of coAgentRowsRTA) {
                if (!seenRTA.has(String(a.id))) {
                    seenRTA.add(String(a.id));
                    actResult.data.push(a);
                }
            }
        }
        const existingEventIds = new Set(allEventsRTA.map(e => String(e.id)));
        const userMapRTA = new Map(allUsersRTA.map(u => [String(u.id), u]));

        let activities = (actResult.data || []).filter(a => !_isAutoTouchLog(a));

        // Case status filter (computed — must stay client-side); EVENTs have no
        // closing_amount so always pass them through regardless of the filter.
        if (_filters && _filters.caseStatus === 'closed') {
            activities = activities.filter(a => a.activity_type === 'EVENT' || (a.closing_amount && parseFloat(a.closing_amount) > 0));
        } else if (_filters && _filters.caseStatus === 'open') {
            activities = activities.filter(a => a.activity_type === 'EVENT' || (!a.closing_amount || parseFloat(a.closing_amount) <= 0));
        }

        // Fetch only the prospect/customer names we actually need
        const neededPIds = [...new Set(activities.filter(a => a.prospect_id).map(a => a.prospect_id))];
        const neededCIds = [...new Set(activities.filter(a => a.customer_id).map(a => a.customer_id))];
        const [pRes, cRes] = await Promise.all([
            neededPIds.length > 0 ? AppDataStore.queryAdvanced('prospects', { scopeField: 'id', scopeValues: neededPIds, limit: 500, select: 'id,full_name', countMode: null }) : Promise.resolve({ data: [] }),
            neededCIds.length > 0 ? AppDataStore.queryAdvanced('customers', { scopeField: 'id', scopeValues: neededCIds, limit: 500, select: 'id,full_name', countMode: null }) : Promise.resolve({ data: [] }),
        ]);
        const prospectMapRTA = new Map(pRes.data.map(p => [String(p.id), p]));
        const customerMapRTA = new Map(cRes.data.map(c => [String(c.id), c]));

        const _gac = document.getElementById('glance-activity-count');
        if (_gac) _gac.textContent = activities.length;

        if (activities.length === 0) {
            grid.innerHTML = '<div style="padding:20px; text-align:center; color:var(--gray-500);">No activities scheduled for today. Enjoy your day! 🎉</div>';
            return;
        }

        let html = `<div class="today-activity-list">`;

        for (const a of activities) {
            // Sync lookups from prefetched maps (no awaits per row).
            const agent = userMapRTA.get(String(a.lead_agent_id)) || { full_name: 'Unknown Agent' };
            const prospect = a.prospect_id ? prospectMapRTA.get(String(a.prospect_id)) : null;
            const customer = a.customer_id ? customerMapRTA.get(String(a.customer_id)) : null;
            const _rtaOwned = _canViewEntityName(a, visibleIds);
            const _rtaEvent = a.activity_type === 'EVENT' && a.event_id
                ? allEventsRTA.find(e => String(e.id) === String(a.event_id))
                : null;
            const entityName = a.activity_type === 'EVENT'
                ? (_rtaEvent?.event_title || _rtaEvent?.title || a.activity_title || 'Company Event')
                : (_rtaOwned
                    ? (prospect ? prospect.full_name : (customer ? customer.full_name : (a.customer_name || 'N/A')))
                    : null);
            const typeClass = (a.activity_type || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
            const statusText = esc(a.status || 'scheduled');

            html += buildTodayActivityCardHtml(a, agent.full_name, entityName, typeClass, statusText);
        }

        html += `</div>`;

        grid.innerHTML = html;
    };

    const renderBirthdaySection = async () => {
        const todayList = document.getElementById('bday-today-list');
        const upcomingList = document.getElementById('bday-upcoming-list');
        if (!todayList || !upcomingList) return;

        const today = new Date();
        const mmdd = (d) => `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
        const todayStr = mmdd(today);

        // Get tomorrow and day after
        const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
        const tomorrowStr = mmdd(tomorrow);
        const day2 = new Date(today); day2.setDate(today.getDate() + 2);
        const day2Str = mmdd(day2);

        // Fetch everything in parallel. Individual .catch(() => []) guards
        // ensure a single table failure doesn't prevent glance counts updating.
        const [prospects, customers, names, allUsers] = await Promise.all([
            AppDataStore.getAll('prospects').catch(() => []),
            AppDataStore.getAll('customers').catch(() => []),
            AppDataStore.getAll('names').catch(() => []),
            // Explicit select — getAll('users') is PII-trimmed and omits ic_number,
            // which the Team Birthdays IC-derived DOB needs. Mirror the mobile fetch.
            AppDataStore.queryAdvanced('users', { select: 'id,full_name,date_of_birth,ic_number,role,team,status,phone', limit: 50000, countMode: null }).then(r => r?.data || []).catch(() => []),
        ]);
        const all = [...prospects, ...customers];
        const userMap = new Map(allUsers.map(u => [String(u.id), u]));
        const prospectById = new Map(all.map(p => [String(p.id), p]));

        // RBAC: scope birthdays to the viewer's visible agent set — admins /
        // marketing managers see all; team leaders see their own team (self +
        // same-team downline); plain agents see only their own contacts.
        // Previously this section filtered by birthday date alone and leaked
        // every agent's prospects/customers org-wide (cross-agent privacy bug).
        // Mirrors the Health Product Refills widget below + the Activities
        // widgets above. Unassigned contacts (no owner) show to admins only.
        const visibleIds = await getVisibleUserIds(_state.cu).catch(() => 'all');
        const ownerVisible = (ownerId) => {
            if (visibleIds === 'all') return true;
            if (!ownerId) return false; // unassigned → admins / marketing only
            return Array.isArray(visibleIds) && visibleIds.some(id => String(id) === String(ownerId));
        };
        const visibleAll = all.filter(p => ownerVisible(p.responsible_agent_id || p.lead_agent_id));
        // Family-member birthdays inherit the visibility of their parent contact.
        const visibleNames = names.filter(n => {
            if (visibleIds === 'all') return true; // admins / marketing see all
            const parent = prospectById.get(String(n.prospect_id));
            return parent && ownerVisible(parent.responsible_agent_id || parent.lead_agent_id);
        });

        // Safely extract MM-DD from a date_of_birth string (YYYY-MM-DD)
        const getMMDD = (dob) => {
            if (!dob) return '';
            if (typeof dob === 'string' && dob.length >= 7 && dob[4] === '-') return dob.substring(5, 10);
            return '';
        };

        // Sync versions — no more per-row awaits. Agent resolved from the map.
        const getBdayInfo = (p) => {
            const agent = userMap.get(String(p.responsible_agent_id || p.lead_agent_id));
            return {
                id: p.id,
                name: p.full_name,
                phone: p.phone || '',
                type: p.customer_since ? 'customer' : 'prospect',
                info: `Agent: ${agent?.full_name || 'Unassigned'} · ${p.customer_since ? 'Customer' : 'Prospect'}`,
                dob: getMMDD(p.date_of_birth)
            };
        };

        const getNameBdayInfo = (n) => {
            const prospect = prospectById.get(String(n.prospect_id));
            return {
                // The wish/gift is logged against the PARENT prospect (a family member has no
                // own contact record). Never fall back to the names-table row id here — that id
                // lives in a different id-space and would resolve to an unrelated prospect.
                id: n.prospect_id || null,
                name: `${n.full_name} (${n.relation || 'Family'} of ${prospect?.full_name || 'Contact'})`,
                phone: prospect?.phone || '',
                type: 'prospect',
                // The birthday belongs to the family member — carry their name so the wish is
                // addressed to them, not to the parent contact whose record we load.
                celebrant: n.full_name || '',
                info: `Family of: ${prospect?.full_name || 'Contact'} · ${n.relation || 'Family Member'}`,
                dob: getMMDD(n.date_of_birth)
            };
        };

        // Collapse a person who exists as BOTH a prospect and a customer (e.g. a
        // converted prospect whose old record was never removed) into ONE birthday
        // card. Key = name + DOB; prefer the customer record (canonical). Family
        // entries have distinctive names so they're unaffected.
        const _dedupBdays = (arr) => {
            const m = new Map();
            for (const b of arr) {
                const k = `${String(b.name || '').trim().toLowerCase()}|${b.dob}`;
                const prev = m.get(k);
                if (!prev || (b.type === 'customer' && prev.type !== 'customer')) m.set(k, b);
            }
            return [...m.values()];
        };
        const todayBdays = _dedupBdays([
            ...visibleAll.filter(p => getMMDD(p.date_of_birth) === todayStr).map(getBdayInfo),
            ...visibleNames.filter(n => getMMDD(n.date_of_birth) === todayStr).map(getNameBdayInfo)
        ]);

        const upcomingBdays = _dedupBdays([
            ...visibleAll.filter(p => {
                const md = getMMDD(p.date_of_birth);
                return md === tomorrowStr || md === day2Str;
            }).map(p => {
                const info = getBdayInfo(p);
                info.info += ` · ${getMMDD(p.date_of_birth) === tomorrowStr ? 'Tomorrow' : 'In 2 days'}`;
                return info;
            }),
            ...visibleNames.filter(n => {
                const md = getMMDD(n.date_of_birth);
                return md === tomorrowStr || md === day2Str;
            }).map(n => {
                const info = getNameBdayInfo(n);
                info.info += ` · ${getMMDD(n.date_of_birth) === tomorrowStr ? 'Tomorrow' : 'In 2 days'}`;
                return info;
            })
        ]);

        const renderBday = (data) => {
            if (data.length === 0) return '<div class="text-muted" style="padding:10px; font-size:12px;">No birthdays found.</div>';
            return data.map(b => {
                // A family-member card with no parent prospect id (b.id null) has no record to
                // log the wish/gift against — show the card but omit the actions rather than
                // dispatch to a wrong id-space prospect.
                const _celebArg = b.celebrant ? `, '${UI.escJsAttr(String(b.celebrant))}'` : '';
                const actions = (b.id == null) ? '' : `
                    <div class="act-actions" style="border-top:none; margin-top:4px; padding-top:0;">
                        <button class="btn btn-sm secondary" style="font-size:11px" onclick="app.openSendBirthdayWish(${b.id}, '${UI.escJsAttr(String(b.type))}'${_celebArg})">Send Wish</button>
                        <button class="btn btn-sm secondary" style="font-size:11px" onclick="app.openPrepareGiftModal(${b.id}, '${UI.escJsAttr(String(b.type))}'${_celebArg})">Prepare Gift</button>
                    </div>`;
                // Clickable name → opens the contact's full profile. Customers route to
                // showCustomerDetail, prospects (incl. family members, whose b.id is the
                // parent prospect id) to showProspectDetail. Family cards with no parent
                // record (b.id null) stay plain text — nothing to open.
                const _detailFn = b.type === 'customer' ? 'showCustomerDetail' : 'showProspectDetail';
                const nameHtml = (b.id == null)
                    ? `${esc(b.name)} 🎂`
                    : `<span style="cursor:pointer;color:var(--primary);text-decoration:underline;" title="View profile" onclick="event.stopPropagation();app.${_detailFn}(${b.id})">${esc(b.name)}</span> 🎂`;
                return `
                <div class="bday-card">
                    <div class="bday-name">${nameHtml}</div>
                    <div class="bday-info">${esc(b.info)}</div>
                    ${actions}
                </div>
            `;
            }).join('');
        };

        const todayBadge = document.querySelector('#bday-today-header .today');
        if (todayBadge) todayBadge.textContent = todayBdays.length;

        const upcomingBadge = document.querySelector('#bday-upcoming-header .upcoming');
        if (upcomingBadge) upcomingBadge.textContent = upcomingBdays.length;

        const _gbc = document.getElementById('glance-bday-count');
        if (_gbc) _gbc.textContent = todayBdays.length;
        const _guc = document.getElementById('glance-upcoming-count');
        if (_guc) _guc.textContent = upcomingBdays.length;

        todayList.innerHTML = renderBday(todayBdays);
        upcomingList.innerHTML = renderBday(upcomingBdays);

        // ===== TEAM BIRTHDAYS (staff / colleagues) =====
        // Internal team celebration widget — separate from client birthdays above.
        // NOT RBAC-scoped: every staff member can see all colleagues' birthdays
        // (this is intentional — it's a team-morale feature, not client PII).
        // Excludes customer (L13) / referrer (L14) accounts that also live in the
        // users table, and inactive/expired staff.
        const teamTodayList = document.getElementById('team-bday-today-list');
        const teamUpcomingList = document.getElementById('team-bday-upcoming-list');
        if (teamTodayList && teamUpcomingList) {
            // Staff birthday source: prefer an explicit date_of_birth (YYYY-MM-DD);
            // otherwise derive MM-DD from the Malaysian IC number (first 6 digits =
            // YYMMDD). The birth YEAR is irrelevant for a birthday match, so we only
            // ever compare MM-DD — no 19xx/20xx disambiguation needed. Foreign /
            // non-IC ids fail the MM/DD range check and are simply skipped.
            const getStaffMMDD = (u) => {
                const explicit = getMMDD(u.date_of_birth);
                if (explicit) return explicit;
                const digits = String(u.ic_number || '').replace(/[^0-9]/g, '');
                if (digits.length < 6) return '';
                const mm = digits.substring(2, 4), dd = digits.substring(4, 6);
                const mi = parseInt(mm, 10), di = parseInt(dd, 10);
                if (!(mi >= 1 && mi <= 12 && di >= 1 && di <= 31)) return '';
                return `${mm}-${dd}`;
            };

            const isStaff = (u) => {
                const status = String(u.status || '').toLowerCase();
                if (status === 'inactive' || status === 'expired') return false;
                let lvl = 12;
                try { lvl = getUserLevel(u); } catch (_) { /* default keeps them in */ }
                return lvl <= 12 || lvl === 15; // exclude L13 customer / L14 referrer
            };

            const getStaffBdayInfo = (u) => ({
                id: u.id,
                name: u.full_name || 'Staff',
                phone: u.phone || '',
                info: `${u.role || 'Team Member'}${u.team ? ' · ' + u.team : ''}`,
                dob: getStaffMMDD(u)
            });

            // Collapse duplicate staff accounts (same person across multiple user
            // rows) so a colleague's birthday shows once — keyed by name + birthday
            // MM-DD; prefer a row that has a phone (so Send Wish works). Also drops
            // staff with no birthday source (they can never match a day anyway).
            const _staffSeen = new Map();
            for (const u of allUsers.filter(isStaff)) {
                const md = getStaffMMDD(u);
                if (!md) continue;
                const key = `${String(u.full_name || '').trim().toLowerCase()}|${md}`;
                const prev = _staffSeen.get(key);
                if (!prev || (!prev.phone && u.phone)) _staffSeen.set(key, u);
            }
            const staff = [..._staffSeen.values()];
            const teamToday = staff.filter(u => getStaffMMDD(u) === todayStr).map(getStaffBdayInfo);
            const teamUpcoming = staff.filter(u => {
                const md = getStaffMMDD(u);
                return md === tomorrowStr || md === day2Str;
            }).map(u => {
                const info = getStaffBdayInfo(u);
                info.info += ` · ${getStaffMMDD(u) === tomorrowStr ? 'Tomorrow' : 'In 2 days'}`;
                return info;
            });

            const renderTeamBday = (data) => {
                if (data.length === 0) return '<div class="text-muted" style="padding:10px; font-size:12px;">No team birthdays.</div>';
                return data.map(b => `
                    <div class="bday-card">
                        <div class="bday-name">${esc(b.name)} 🎉</div>
                        <div class="bday-info">${esc(b.info)}</div>
                        ${b.phone ? `<div class="act-actions" style="border-top:none; margin-top:4px; padding-top:0;">
                            <button class="btn btn-sm secondary" style="font-size:11px" onclick="app.sendTeamBirthdayWish(${b.id})">Send Wish</button>
                        </div>` : ''}
                    </div>
                `).join('');
            };

            const teamTodayBadge = document.getElementById('team-bday-today-badge');
            if (teamTodayBadge) teamTodayBadge.textContent = teamToday.length;
            const teamUpcomingBadge = document.getElementById('team-bday-upcoming-badge');
            if (teamUpcomingBadge) teamUpcomingBadge.textContent = teamUpcoming.length;

            teamTodayList.innerHTML = renderTeamBday(teamToday);
            teamUpcomingList.innerHTML = renderTeamBday(teamUpcoming);
        }
    };

    // ===== HEALTH PRODUCT REFILL REMINDERS =====

    // Probe: does the refill_reminders table exist in Supabase yet?
    // Returns true if the migration has been run, false otherwise.
    const checkRefillReminderTable = async () => {
        try {
            const sb = window.supabase || window.supabaseClient;
            if (!sb) return false;
            const { error } = await sb.from('refill_reminders').select('id').limit(1);
            if (!error) return true;
            if (error.message && /relation|does not exist|refill_reminders/i.test(error.message)) return false;
            return false;
        } catch (_) { /* intentional: table-exists probe, default false on any error */ return false; }
    };

    // Show the one-time migration modal when refill_reminders table is missing.
    // Modeled on showPhotoUrlsMigrationModal at ~script.js:16940.
    const showRefillMigrationModal = () => {
        const migrationPath = 'migrations/add_healthcare_refill_reminders.sql';
        const instructions = `-- Run this SQL in Supabase SQL Editor to enable Health Product Refill Reminders.
-- First, enable pg_cron: Supabase Dashboard → Database → Extensions → enable "pg_cron"
-- Then paste the full contents of ${migrationPath} into the SQL Editor and click Run.`;
        UI.showModal('⚠️ One-time Setup Required — Health Refill Reminders', `
            <p style="margin-bottom:12px;">The <strong>Health Product Refill Reminders</strong> feature needs a one-time database migration to be applied.</p>
            <ol style="font-size:13px;line-height:1.7;margin:0 0 12px 20px;padding:0;">
                <li>Open your <a href="https://supabase.com/dashboard/project/remuwhxvzkzjtgbzqjaa/database/extensions" target="_blank" rel="noopener noreferrer" style="color:var(--primary);font-weight:600;">Supabase Extensions ↗</a> and enable <code>pg_cron</code>.</li>
                <li>Open the <a href="https://supabase.com/dashboard/project/remuwhxvzkzjtgbzqjaa/sql/new" target="_blank" rel="noopener noreferrer" style="color:var(--primary);font-weight:600;">SQL Editor ↗</a>.</li>
                <li>Open the file <code>${migrationPath}</code> from the project folder and paste its contents.</li>
                <li>Click <strong>Run</strong>.</li>
                <li>Refresh this page.</li>
            </ol>
            <textarea class="form-control" rows="4" style="font-family:monospace;font-size:11px;background:#1e1e1e;color:#d4d4d4;border:none;resize:none;width:100%;">${instructions}</textarea>
            <p style="margin-top:12px;font-size:12px;color:var(--gray-600);"><i class="fas fa-info-circle"></i> The migration is safe to re-run. Until you apply it, the refill reminder widget stays empty but the rest of the CRM is unaffected.</p>
        `, [{ label: 'Close', type: 'primary', action: 'UI.hideModal()' }]);
    };

    // Render the dashboard "Health Product Refills" widget by reading straight
    // from the refill_reminders table (populated by the pg_cron job + triggered
    // RPC after purchase save).
    const renderRefillReminders = async () => {
        const overdueList = document.getElementById('refill-overdue-list');
        const soonList = document.getElementById('refill-soon-list');
        const overdueBadge = document.getElementById('refill-overdue-badge');
        const soonBadge = document.getElementById('refill-soon-badge');
        if (!overdueList || !soonList) return;

        // Fire the table probe, both refill queries, AND lookup tables all in
        // one parallel batch. If the table doesn't exist the data queries
        // harmlessly return [] via their .catch() handlers.
        const [tableOk, reminders, whatsappSent, prospects, customers, allUsers] = await Promise.all([
            checkRefillReminderTable(),
            AppDataStore.query('refill_reminders', { status: 'pending' }).catch(() => []),
            AppDataStore.query('refill_reminders', { status: 'whatsapp_sent' }).catch(() => []),
            // Guard each lookup so one table failing (RLS deny / Failed to fetch)
            // doesn't reject Promise.all and wipe out the whole refills widget —
            // mirrors renderBirthdaySection's per-table .catch pattern.
            AppDataStore.getAll('prospects').catch(() => []),
            AppDataStore.getAll('customers').catch(() => []),
            AppDataStore.getAll('users').catch(() => []),
        ]);

        if (!tableOk) {
            const cta = `<div class="text-muted" style="padding:10px;font-size:12px;">
                <i class="fas fa-database" style="margin-right:4px;"></i>
                Run the one-time migration (<a href="#" onclick="event.preventDefault();app.showRefillMigrationModal()" style="color:var(--primary);">view instructions</a>) to enable refill reminders.
            </div>`;
            overdueList.innerHTML = cta;
            soonList.innerHTML = '';
            if (overdueBadge) overdueBadge.textContent = '0';
            if (soonBadge) soonBadge.textContent = '0';
            return;
        }
        const all = [...(reminders || []), ...(whatsappSent || [])];

        const prospectMap = new Map(prospects.map(p => [String(p.id), p]));
        const customerMap = new Map(customers.map(c => [String(c.id), c]));
        const userMap = new Map(allUsers.map(u => [String(u.id), u]));

        // RBAC: non-admin agents only see their own customers
        // Admin/lead = canonical level helper (L1-L5: admin, marketing, senior mgr,
        // manager, team leader). Owner-confirmed 2026-06-19: replaces the brittle
        // /manager|team_leader/ regex, which never matched the canonical "Level 5
        // Team Leader" string (space vs underscore) — so Team Leaders now correctly
        // see all refill reminders, not just their own.
        const isAdminOrLead = !!_state.cu && _utils.isTeamLeaderOrAbove(_state.cu);
        const visibleReminders = all.filter(r => {
            const entity = r.prospect_id
                ? prospectMap.get(String(r.prospect_id))
                : customerMap.get(String(r.customer_id));
            if (!entity) return false;
            // Terminal-status guard: a refill tied to a converted/lost/unable PROSPECT
            // is no longer a live reorder nudge (customers carry their own refills).
            if (entity.status === 'converted' || entity.status === 'lost' || entity.unable_to_serve) return false;
            if (isAdminOrLead) return true;
            const agentId = entity.responsible_agent_id || entity.lead_agent_id;
            return agentId && String(agentId) === String(_state.cu?.id);
        });

        // days_until_finish is a STATIC integer the pg_cron job wrote once; if
        // the cron hasn't run for N days it's N days stale and misclassifies
        // overdue/soon. estimated_finish_date (a DATE) is the reliable source of
        // truth, so derive days-left from it relative to today and fall back to
        // the stored integer only when the date is missing/unparseable.
        const _refillTodayMs = (() => {
            const t = new Date();
            return new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
        })();
        const _refillDaysLeft = (r) => {
            const efd = r.estimated_finish_date;
            if (efd) {
                const parts = String(efd).slice(0, 10).split('-').map(Number);
                if (parts.length === 3 && parts.every(n => !isNaN(n))) {
                    const finishMs = new Date(parts[0], parts[1] - 1, parts[2]).getTime();
                    return Math.floor((finishMs - _refillTodayMs) / 86400000);
                }
            }
            return r.days_until_finish; // fallback: stored integer
        };

        // Split into overdue vs. due this week using the recomputed value.
        const overdue = visibleReminders.filter(r => _refillDaysLeft(r) < 0)
            .sort((a, b) => _refillDaysLeft(a) - _refillDaysLeft(b));
        const soon = visibleReminders.filter(r => _refillDaysLeft(r) >= 0 && _refillDaysLeft(r) <= 7)
            .sort((a, b) => _refillDaysLeft(a) - _refillDaysLeft(b));

        const renderRow = (r) => {
            const entity = r.prospect_id
                ? prospectMap.get(String(r.prospect_id))
                : customerMap.get(String(r.customer_id));
            const name = entity?.full_name || 'Unknown contact';
            const phone = entity?.phone || '';
            const agent = userMap.get(String(entity?.responsible_agent_id || entity?.lead_agent_id));
            const _daysLeft = _refillDaysLeft(r);
            const daysText = _daysLeft < 0
                ? `<span style="color:#dc2626;font-weight:600;">${Math.abs(_daysLeft)}d overdue</span>`
                : _daysLeft === 0
                    ? `<span style="color:#dc2626;font-weight:600;">Today</span>`
                    : `<span style="color:#d97706;font-weight:600;">${_daysLeft}d left</span>`;
            const sentBadge = r.status === 'whatsapp_sent'
                ? `<span style="background:#dcfce7;color:#15803d;padding:2px 6px;border-radius:4px;font-size:10px;margin-left:4px;">✓ SENT</span>`
                : '';
            return `
                <div class="refill-card" style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:8px;padding:10px 12px;margin-bottom:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-weight:600;font-size:13px;">${escapeHtml(name)}${sentBadge}</div>
                            <div style="font-size:12px;color:var(--gray-600);margin-top:2px;">💊 ${escapeHtml(r.product_name || 'Product')}</div>
                            <div style="font-size:11px;color:var(--gray-500);margin-top:2px;">Est. finish: ${r.estimated_finish_date} · ${daysText}</div>
                            <div style="font-size:10px;color:var(--gray-400);margin-top:2px;">Agent: ${esc(agent?.full_name || 'Unassigned')}</div>
                        </div>
                    </div>
                    <div style="display:flex;gap:6px;margin-top:8px;">
                        <button class="btn btn-sm secondary" style="font-size:11px;flex:1;" onclick="app.sendRefillWhatsApp(${r.id})" ${!phone ? 'disabled title="No phone number"' : ''}><i class="fab fa-whatsapp"></i> WhatsApp</button>
                        <button class="btn btn-sm secondary" style="font-size:11px;flex:1;" onclick="app.viewRefillProspect(${r.prospect_id || 'null'}, ${r.customer_id || 'null'})"><i class="fas fa-user"></i> View</button>
                        <button class="btn btn-sm secondary" style="font-size:11px;" onclick="app.dismissRefillReminder(${r.id})" title="Dismiss"><i class="fas fa-check"></i></button>
                    </div>
                </div>
            `;
        };

        if (overdueBadge) overdueBadge.textContent = overdue.length;
        if (soonBadge) soonBadge.textContent = soon.length;

        overdueList.innerHTML = overdue.length
            ? overdue.map(renderRow).join('')
            : '<div class="text-muted" style="padding:10px;font-size:12px;">No overdue refills.</div>';
        soonList.innerHTML = soon.length
            ? soon.map(renderRow).join('')
            : '<div class="text-muted" style="padding:10px;font-size:12px;">No refills due this week.</div>';
    };

    // Click "WhatsApp" on a refill card → open wa.me/ with a prefilled template.
    // Does NOT auto-send; the agent reviews in WhatsApp before tapping send.
    const sendRefillWhatsApp = async (reminderId) => {
        const reminder = await AppDataStore.getById('refill_reminders', reminderId);
        if (!reminder) { UI.toast.error('Reminder not found'); return; }

        const entity = reminder.prospect_id
            ? await AppDataStore.getById('prospects', reminder.prospect_id)
            : await AppDataStore.getById('customers', reminder.customer_id);
        if (!entity) { UI.toast.error('Customer record not found'); return; }
        if (!entity.phone) { UI.toast.error('No phone number on file'); return; }

        // Seed the template on first use if it doesn't exist yet
        let template;
        try {
            const existing = await AppDataStore.query('whatsapp_templates', { template_name: 'Product Refill Reminder' });
            template = existing?.[0];
            if (!template) {
                await AppDataStore.create('whatsapp_templates', {
                    template_name: 'Product Refill Reminder',
                    status: 'APPROVED',
                    content: "Hi {{name}}, hope you're doing well! Just checking — we noticed your {{product}} will be finishing around {{finish_date}}. Would you like us to prepare your next bottle? \u{1F64F}"
                });
                template = { content: "Hi {{name}}, hope you're doing well! Just checking — we noticed your {{product}} will be finishing around {{finish_date}}. Would you like us to prepare your next bottle? \u{1F64F}" };
            }
        } catch (_) {
            /* intentional: template table unavailable → use built-in default copy */
            template = { content: "Hi {{name}}, hope you're doing well! Just checking — we noticed your {{product}} will be finishing around {{finish_date}}. Would you like us to prepare your next bottle? \u{1F64F}" };
        }

        const firstName = (entity.full_name || '').split(' ')[0] || entity.full_name || 'there';
        const body = template.content
            .replace(/\{\{name\}\}/g, firstName)
            .replace(/\{\{product\}\}/g, reminder.product_name || 'your healthcare product')
            .replace(/\{\{finish_date\}\}/g, reminder.estimated_finish_date || 'soon');

        // Normalize phone to international format (strip non-digits, prepend 60 if looks Malaysian)
        let phone = String(entity.phone).replace(/[^0-9]/g, '');
        if (phone.startsWith('0')) phone = '60' + phone.slice(1);
        if (!phone.startsWith('60') && phone.length <= 10) phone = '60' + phone;

        const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(body)}`;
        window.open(waUrl, '_blank');

        // Mark reminder as whatsapp_sent (stays visible, just with a ✓ badge)
        try {
            await AppDataStore.update('refill_reminders', reminderId, { status: 'whatsapp_sent', updated_at: new Date().toISOString() });
        } catch (_) { /* intentional: best-effort status flag after WhatsApp opened */ }
        UI.toast.success('WhatsApp opened — review and send');
        renderRefillReminders().catch(() => {});
    };

    // Send the activity's event description as a WhatsApp invite message.
    //
    // Flow: copy the full invite (with emojis) to the OS clipboard, then show
    // a modal with the message preview and a big "Open WhatsApp" button. We
    // deliberately do NOT call window.open with any WhatsApp URL automatically:
    // on some Windows machines a broken `whatsapp://` protocol handler (e.g.
    // HKCU\Software\Classes\whatsapp registered but no shell\open\command) is
    // triggered when Chrome tries to deep-link wa.me / web.whatsapp.com, and
    // Windows surfaces "this link could not be opened" before the tab loads.
    // Putting the navigation behind an explicit button click inside a modal
    // keeps the user gesture intact and lets them see the copied text first —
    // if opening WhatsApp from the app still fails, they can just alt-tab to
    // their already-open WhatsApp and paste.
    const sendDescriptionInvite = async (activityId) => {
        const activity = await _lookupActivityRobust(activityId);
        if (!activity) { UI.toast.error('Activity not found'); return; }

        const event = (activity.event_id) ? await AppDataStore.getById('events', activity.event_id) : null;
        const title = event?.event_title || event?.title || activity.activity_title || '';
        const date = activity.activity_date || '';
        const time = (activity.start_time && activity.end_time) ? `${activity.start_time} - ${activity.end_time}` : (activity.start_time || '');
        const venue = activity.venue || activity.location_address || event?.location || '';
        const description = event?.description || activity.summary || '';
        const ticketPrice = event?.ticket_price ? `RM ${event.ticket_price}` : '';

        // Use Unicode escapes so emojis survive any file-encoding mismatch
        const E = { sparkle: '\u2728', calendar: '\u{1F4C5}', clock: '\u{1F550}', pin: '\u{1F4CD}', ticket: '\u{1F39F}\uFE0F' };
        let lines = [`${E.sparkle} *${title || 'You are invited!'}* ${E.sparkle}`, ''];
        if (date) lines.push(`${E.calendar} Date: ${date}`);
        if (time) lines.push(`${E.clock} Time: ${time}`);
        if (venue) lines.push(`${E.pin} Venue: ${venue}`);
        if (ticketPrice) lines.push(`${E.ticket} Ticket Price: ${ticketPrice}`);
        if (description) lines.push('', description);

        const body = lines.join('\n');

        // Copy to the OS clipboard (preserves UTF-8 emojis perfectly).
        let copied = false;
        try {
            await navigator.clipboard.writeText(body);
            copied = true;
        } catch (_) {
            // Fallback for older browsers / blocked clipboard API
            try {
                const ta = document.createElement('textarea');
                ta.value = body;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                copied = document.execCommand('copy');
                document.body.removeChild(ta);
            } catch (__) { /* intentional: clipboard fallback failed → copied stays false */ }
        }

        // Escape HTML in the preview so special chars render correctly
        const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));

        const previewHtml = `
            <div style="display:flex;flex-direction:column;gap:12px;">
                <div style="padding:10px 12px;background:${copied ? '#dcfce7' : '#fee2e2'};color:${copied ? '#166534' : '#991b1b'};border-radius:6px;font-size:13px;">
                    <i class="fas ${copied ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>
                    ${copied
                        ? 'Invite copied to clipboard \u2014 paste it in WhatsApp with Ctrl+V'
                        : 'Could not auto-copy \u2014 please select the text below and copy it manually'}
                </div>
                <div style="font-size:12px;color:var(--gray-600);">Preview:</div>
                <textarea readonly rows="14" onclick="this.select()" style="width:100%;font-family:inherit;font-size:13px;padding:10px;border:1px solid var(--gray-300);border-radius:6px;background:#f9fafb;white-space:pre-wrap;resize:vertical;">${escapeHtml(body)}</textarea>
                <div style="font-size:11px;color:var(--gray-500);line-height:1.5;">
                    <strong>Next step:</strong> open WhatsApp (desktop app or web), pick the contact you want to invite, click in the chat, and press Ctrl+V to paste. The emojis will come through correctly.
                </div>
            </div>
        `;

        // wa.me/?text=... pre-fills the message after the user picks a contact,
        // so pasting isn't even required. encodeURIComponent turns any ' into
        // %27, so the URL is safe to wrap in single quotes inside the HTML
        // onclick="..." attribute.
        const waUrl = 'https://wa.me/?text=' + encodeURIComponent(body);
        UI.showModal('\u{1F4E4} WhatsApp Invite Ready', previewHtml, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' },
            { label: '\uD83D\uDCF1 Open WhatsApp Web', type: 'primary', action: `(() => { window.open('${waUrl}', '_blank', 'noopener'); UI.hideModal(); })()` }
        ]);
    };

    // Dismiss a refill reminder. Updates BOTH the refill_reminders row AND the
    // underlying JSON purchase record's reminder_dismissed_at, so the next cron
    // run won't resurrect it.
    const dismissRefillReminder = async (reminderId) => {
        if (!confirm('Dismiss this refill reminder? It will not show again for this purchase.')) return;

        const reminder = await AppDataStore.getById('refill_reminders', reminderId);
        if (!reminder) { UI.toast.error('Reminder not found'); return; }

        try {
            // 1. Update refill_reminders row
            await AppDataStore.update('refill_reminders', reminderId, {
                status: 'dismissed',
                updated_at: new Date().toISOString()
            });

            // 2. Update the underlying purchase record's reminder_dismissed_at
            const isProspect = !!reminder.prospect_id;
            const entityTable = isProspect ? 'prospects' : 'customers';
            const entityId = reminder.prospect_id || reminder.customer_id;
            const entity = await AppDataStore.getById(entityTable, entityId);
            if (entity && entity.closing_record) {
                const cr = { ...entity.closing_record };
                const records = Array.isArray(cr.formula_healthcare_purchases)
                    ? [...cr.formula_healthcare_purchases]
                    : [];
                if (records[reminder.purchase_index]) {
                    records[reminder.purchase_index] = {
                        ...records[reminder.purchase_index],
                        reminder_dismissed_at: new Date().toISOString()
                    };
                    cr.formula_healthcare_purchases = records;
                    await AppDataStore.update(entityTable, entityId, { closing_record: cr });
                }
            }

            UI.toast.success('Reminder dismissed');
            renderRefillReminders().catch(() => {});
        } catch (err) {
            console.warn('dismissRefillReminder failed:', err);
            UI.toast.error('Failed to dismiss: ' + (err.message || 'unknown error'));
        }
    };

    // Navigate to the prospect or customer profile linked to a refill reminder.
    const viewRefillProspect = async (prospectId, customerId) => {
        if (prospectId) {
            await navigateTo('prospects');
            setTimeout(() => { try { (window.app.showProspectDetail || (() => {}))(prospectId); } catch(_) { /* intentional: best-effort deferred navigation */ } }, 200);
        } else if (customerId) {
            // Navigate to the CUSTOMERS view (not prospects) so showCustomerDetail
            // captures the correct back-destination — closing returns to the
            // customers list, not the prospects list.
            await navigateTo('customers');
            setTimeout(() => { try { (window.app.showCustomerDetail || (() => {}))(customerId); } catch(_) { /* intentional: best-effort deferred navigation */ } }, 200);
        }
    };

    // ===== END HEALTH PRODUCT REFILL REMINDERS =====


    const openSendBirthdayWish = async (id, entityType, celebrantName) => {
        const table = entityType === 'customer' ? 'customers' : 'prospects';
        const person = await AppDataStore.getById(table, id);
        if (!person) return;
        // The wish is logged against `person` (the parent contact for a family member),
        // but is ADDRESSED to the celebrant — use their name when supplied, else the contact's.
        const _greetName = (celebrantName && String(celebrantName).trim()) || person.full_name;
        const content = `
            <div class="form-section">
                <p>Send a birthday wish to <strong>${escapeHtml(_greetName)}</strong>.</p>
                <div class="form-group" style="margin-top:12px;">
                    <label>Message</label>
                    <textarea id="bday-wish-msg" class="form-control" rows="4">Happy Birthday, ${escapeHtml(_greetName)}! 🎂 Wishing you a wonderful year ahead filled with joy and prosperity. Best regards, DestinOraclesSolution Team</textarea>
                </div>
                <div class="form-group">
                    <label>Channel</label>
                    <select id="bday-wish-channel" class="form-control">
                        <option>WhatsApp</option>
                        <option>Email</option>
                        <option>SMS</option>
                    </select>
                </div>
            </div>
        `;
        UI.showModal('Send Birthday Wish', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Send Wish', type: 'primary', action: `(async () => { await app.executeSendBirthdayWish(${id}, '${entityType}'); })()` }
        ]);
    };

    const executeSendBirthdayWish = async (id, entityType) => {
        const msg = document.getElementById('bday-wish-msg')?.value?.trim();
        const channel = document.getElementById('bday-wish-channel')?.value;
        if (!msg) { UI.toast.error('Message cannot be empty.'); return; }
        const _d = new Date();
        const _localDate = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`;
        const _payload = {
            activity_type: 'CALL',
            activity_date: _localDate,
            source: 'birthday_auto',   // logged touch — hidden from the calendar, kept in history
            summary: `Birthday Wish via ${channel}: ${msg}`,
            lead_agent_id: _state.cu?.id,
            created_by: _state.cu?.id
        };
        if (entityType === 'customer') _payload.customer_id = id; else _payload.prospect_id = id;
        // De-dupe: one birthday-wish log per person per day (re-tapping Send won't pile up).
        try {
            const _existing = await AppDataStore.query('activities', entityType === 'customer' ? { customer_id: id } : { prospect_id: id });
            if ((_existing || []).some(a => a.source === 'birthday_auto' && a.activity_date === _localDate && (a.summary || '').startsWith('Birthday Wish'))) {
                UI.hideModal(); UI.toast.success('Birthday wish sent.'); return;
            }
        } catch (_) { /* de-dupe is best-effort */ }
        await AppDataStore.create('activities', _payload);
        UI.hideModal();
        UI.toast.success('Birthday wish logged.');
    };

    // Team Birthdays "Send Wish" → open wa.me to a colleague with a prefilled
    // greeting. Staff are NOT contacts, so nothing is logged (no birthday_auto
    // touch, no activity record) — this is a simple internal nicety.
    const sendTeamBirthdayWish = async (userId) => {
        const u = await AppDataStore.getById('users', userId).catch(() => null);
        if (!u) { UI.toast.error('Staff record not found'); return; }
        if (!u.phone) { UI.toast.error('No phone number on file'); return; }
        const firstName = (u.full_name || '').split(' ')[0] || u.full_name || '';
        const body = `${firstName}，生日快乐！🎉 祝您新岁安康，诸事顺遂。— DestinOraclesSolution Team`;
        // Normalize phone to international format (mirror sendRefillWhatsApp).
        let phone = String(u.phone).replace(/[^0-9]/g, '');
        if (phone.startsWith('0')) phone = '60' + phone.slice(1);
        if (!phone.startsWith('60') && phone.length <= 10) phone = '60' + phone;
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(body)}`, '_blank');
        UI.toast.success('WhatsApp opened — review and send');
    };

    const openPrepareGiftModal = async (id, entityType, celebrantName) => {
        const table = entityType === 'customer' ? 'customers' : 'prospects';
        const person = await AppDataStore.getById(table, id);
        if (!person) return;
        // Gift is logged against `person` (the parent for a family member) but is FOR the
        // celebrant — label it with their name when supplied, else the contact's.
        const _giftName = (celebrantName && String(celebrantName).trim()) || person.full_name;
        const content = `
            <div class="form-section">
                <p>Log a birthday gift for <strong>${escapeHtml(_giftName)}</strong>.</p>
                <div class="form-group" style="margin-top:12px;">
                    <label>Gift Description</label>
                    <input type="text" id="bday-gift-desc" class="form-control" placeholder="e.g. Mooncake box, RM50 voucher">
                </div>
                <div class="form-group">
                    <label>Estimated Value (RM)</label>
                    <input type="number" id="bday-gift-value" class="form-control" placeholder="50">
                </div>
                <div class="form-group">
                    <label>Notes</label>
                    <textarea id="bday-gift-notes" class="form-control" rows="2" placeholder="Delivery method, special instructions..."></textarea>
                </div>
            </div>
        `;
        UI.showModal('Prepare Birthday Gift', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Log Gift', type: 'primary', action: `(async () => { await app.logBirthdayGift(${id}, '${entityType}'); })()` }
        ]);
    };

    const logBirthdayGift = async (id, entityType) => {
        const desc = document.getElementById('bday-gift-desc')?.value?.trim();
        const value = document.getElementById('bday-gift-value')?.value?.trim();
        const notes = document.getElementById('bday-gift-notes')?.value?.trim();
        if (!desc) { UI.toast.error('Gift description is required.'); return; }
        const _d = new Date();
        const _localDate = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`;
        const _summary = `Birthday Gift: ${desc}${value ? ` (RM ${value})` : ''}${notes ? ` — ${notes}` : ''}`;
        const _payload = {
            activity_type: 'CALL',
            activity_date: _localDate,
            source: 'birthday_auto',   // logged touch — hidden from the calendar, kept in history
            summary: _summary,
            lead_agent_id: _state.cu?.id,
            created_by: _state.cu?.id
        };
        if (entityType === 'customer') _payload.customer_id = id; else _payload.prospect_id = id;
        // De-dupe: don't pile up the SAME gift for one person on one day. Gift
        // logging previously had no guard (unlike the wish path), so re-tapping
        // "Log Gift" — or retrying after a slow save — stacked duplicate history
        // rows. Keyed on the exact summary so a genuinely different gift the same
        // day is still allowed through. Best-effort: a read failure never blocks
        // the log.
        try {
            const _existing = await AppDataStore.query('activities', entityType === 'customer' ? { customer_id: id } : { prospect_id: id });
            if ((_existing || []).some(a => a.source === 'birthday_auto' && a.activity_date === _localDate && a.summary === _summary)) {
                UI.hideModal(); UI.toast.success('Birthday gift logged.'); return;
            }
        } catch (_) { /* de-dupe is best-effort */ }
        await AppDataStore.create('activities', _payload);
        UI.hideModal();
        UI.toast.success('Birthday gift logged.');
    };

    // --- Phase 7 Navigation & Filter Functions ---
    const switchView = async (view) => {
        _state.cv = view;

        // NOTE: the React-era calendar shell renders no .btn-toggle month/week/day
        // switcher, so the old querySelectorAll('.btn-toggle') activation loop was
        // a dead no-op and has been removed. The week/day views themselves stay
        // reachable via openDayView ("+N more") and goToPrevious/Next, which
        // preserve _state.cv — so the renderWeek/Day code below is NOT orphaned.

        if (view === 'month') {
            await renderMonthView();
        } else if (view === 'week') {
            await renderWeekView();
        } else if (view === 'day') {
            await renderDayView();
        }
    };

    const goToToday = async () => {
        _state.cd = new Date();
        updateMonthHeader(_state.cd);
        await switchView(_state.cv);
    };

    const goToPrevious = async () => {
        if (_state.cv === 'month') {
            // Anchor to day 1 BEFORE shifting the month so month-end dates (29–31)
            // don't overflow into the wrong month (e.g. Mar 31 → Feb 31 → Mar 3).
            // The month grid renders purely from year+month, so day=1 is safe.
            _state.cd.setDate(1);
            _state.cd.setMonth(_state.cd.getMonth() - 1);
        } else if (_state.cv === 'week') {
            _state.cd.setDate(_state.cd.getDate() - 7);
        } else if (_state.cv === 'day') {
            _state.cd.setDate(_state.cd.getDate() - 1);
        }
        if (_state.cd.getFullYear() < 2010) _state.cd.setFullYear(2010);
        updateMonthHeader(_state.cd);
        await switchView(_state.cv);
    };

    const goToNext = async () => {
        if (_state.cv === 'month') {
            // Anchor to day 1 BEFORE shifting the month so month-end dates (29–31)
            // don't overflow into the wrong month (e.g. Jan 31 → Feb 31 → Mar 3).
            // The month grid renders purely from year+month, so day=1 is safe.
            _state.cd.setDate(1);
            _state.cd.setMonth(_state.cd.getMonth() + 1);
        } else if (_state.cv === 'week') {
            _state.cd.setDate(_state.cd.getDate() + 7);
        } else if (_state.cv === 'day') {
            _state.cd.setDate(_state.cd.getDate() + 1);
        }
        if (_state.cd.getFullYear() > 2200) _state.cd.setFullYear(2200);
        updateMonthHeader(_state.cd);
        await switchView(_state.cv);
    };

    const openMonthPicker = () => {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const currentMonth = _state.cd.getMonth();
        const currentYear = _state.cd.getFullYear();

        // Year range: 5 years before and after current
        const years = [];
        for (let y = currentYear - 5; y <= currentYear + 5; y++) years.push(y);

        const content = `
            <div style="text-align:center;">
                <div style="margin-bottom:16px;">
                    <label style="font-weight:600; margin-right:8px;">Year:</label>
                    <select id="mp-year" style="padding:6px 12px; border:1px solid #d1d5db; border-radius:6px; font-size:14px;">
                        ${years.map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`).join('')}
                    </select>
                </div>
                <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:8px;">
                    ${monthNames.map((m, i) => `
                        <button class="btn ${i === currentMonth ? 'primary' : 'secondary'} btn-sm"
                            onclick="app.jumpToMonth(${i}, document.getElementById('mp-year').value); UI.hideModal();"
                            style="padding:8px 4px; font-size:13px;">
                            ${m}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;

        UI.showModal('Go to Month', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }
        ]);
    };

    const jumpToMonth = async (month, year) => {
        _state.cd = new Date(parseInt(year), month, 1);
        updateMonthHeader(_state.cd);
        await switchView(_state.cv);
    };

    const openDayView = async (dateStr) => {
        const [y, m, d] = dateStr.split('-').map(Number);
        _state.cd = new Date(y, m - 1, d);
        updateMonthHeader(_state.cd);
        // Show skeleton immediately so tapping "+N more" feels instant
        _state.cv = 'day';
        // (Removed dead .btn-toggle activation loop — no such switcher exists in
        //  the current calendar shell, matching the switchView cleanup above.)
        const grid = document.getElementById('calendar-grid');
        if (grid) {
            const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][_state.cd.getMonth()];
            grid.innerHTML = `<div style="padding:40px 24px;text-align:center;"><i class="fas fa-spinner fa-spin" style="color:var(--accent);font-size:28px;"></i><p style="color:var(--gray-400);margin-top:14px;font-size:15px;">Loading ${_state.cd.getDate()} ${mon} ${_state.cd.getFullYear()}…</p></div>`;
        }
        await renderDayView();
    };

    const updateMonthHeader = (date) => {
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
        const header2 = document.getElementById('calendar-month-title');
        if (header2) header2.textContent = `${monthNames[date.getMonth()]} ${date.getFullYear()} `;

        const header = document.querySelector('.calendar-title-nav h2');
        if (header && !header.id) {
            header.textContent = `${monthNames[date.getMonth()]} ${date.getFullYear()} `;
        }
    };

    const renderMonthView = async () => {
        await renderCalendar();
    };

    // Pure HTML builders for renderWeekView — extracted verbatim so the
    // orchestrator below keeps the same template strings while staying a thin
    // loop. `esc` is read from the enclosing closure (same as the inline code).
    const buildWeekDayHeaderHtml = (dayName, dayDate, isToday) => {
        return `
                <div class="week-day-header ${isToday ? 'today' : ''}">
                    <div class="day-name">${dayName}</div>
                    <div class="day-date">${dayDate.getDate()}</div>
                </div>
            `;
    };
    const buildWeekActivityHtml = (a, name) => {
        return `
    <div class="week-activity ${esc(String(a.activity_type || '').toLowerCase())}" onclick="app.viewActivityDetails(${a.id})">
        ${esc(a.start_time)} ${esc(name)}
    </div>
    `;
    };

    const renderWeekView = async () => {
        const grid = document.getElementById('calendar-grid');
        if (!grid) return;

        // Get start of week (Sunday)
        const startOfWeek = new Date(_state.cd);
        startOfWeek.setDate(_state.cd.getDate() - _state.cd.getDay());

        let html = '<div class="week-view-container">';
        html += '<div class="week-header">';
        html += '<div class="hour-label"></div>'; // Empty corner

        // Generate day headers
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        for (let i = 0; i < 7; i++) {
            const day = new Date(startOfWeek);
            day.setDate(startOfWeek.getDate() + i);
            const isToday = day.toDateString() === new Date().toDateString();

            html += buildWeekDayHeaderHtml(days[i], day, isToday);
        }

        html += '</div>';
        html += '<div class="week-body">';

        // Scope the fetch to THIS week's date range + the viewer's visible user
        // set — mirrors _renderCalendarLegacy / renderTodayActivities. The prior
        // code did three unscoped getAll() calls, pulling EVERY org activity/
        // prospect/customer into browser memory + the network response (a privacy
        // over-fetch; the _wvOwned gate below only masks the rendered NAME, not
        // the data that reached the client). queryAdvanced gte/lte + scopeFields
        // is the same proven path the month view uses.
        const _wkEndWV = new Date(startOfWeek); _wkEndWV.setDate(startOfWeek.getDate() + 6);
        const _fmtWV = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const _wkStartStr = _fmtWV(startOfWeek);
        const _wkEndStr = _fmtWV(_wkEndWV);
        const visibleIdsWV = await getVisibleUserIds(_state.cu);
        const wvQueryOpts = {
            gte: { activity_date: _wkStartStr },
            lte: { activity_date: _wkEndStr },
            sort: 'start_time', sortDir: 'asc',
            limit: 5000, offset: 0, countMode: null,
            filters: {},
        };
        // Agent filter is a user-chosen narrowing and applies to every viewer, admins included.
        if (_filters && _filters.agent && _filters.agent !== 'all') {
            wvQueryOpts.filters.lead_agent_id = _filters.agent;
        }
        if (_filters && _filters.type && _filters.type !== 'all') {
            wvQueryOpts.filters.activity_type = _filters.type;
        }
        if (!isSystemAdmin(_state.cu) && visibleIdsWV !== 'all') {
            wvQueryOpts.scopeFields = [
                { field: 'lead_agent_id', values: visibleIdsWV },
                { field: 'visibility', values: ['open', 'public', 'team'] }
            ];
        }
        const needsCoAgentMergeWV = !isSystemAdmin(_state.cu) && _state.cu?.id != null;
        const [wvActResult, wvCoAgentRows] = await Promise.all([
            AppDataStore.queryAdvanced('activities', wvQueryOpts),
            needsCoAgentMergeWV ? _fetchActivitiesAsCoAgent(_wkStartStr, _wkEndStr) : Promise.resolve([]),
        ]);
        const activities = (wvActResult && wvActResult.data) || [];
        if (wvCoAgentRows && wvCoAgentRows.length > 0) {
            const _seenWV = new Set(activities.map(a => String(a.id)));
            for (const a of wvCoAgentRows) {
                if (!_seenWV.has(String(a.id)) && a.activity_date >= _wkStartStr && a.activity_date <= _wkEndStr) {
                    _seenWV.add(String(a.id));
                    activities.push(a);
                }
            }
        }
        // Make every rendered row resolvable on click (see _calGridIndex).
        _indexGridActivities(activities);
        // Fetch ONLY the prospect/customer names these scoped activities reference.
        const _wvPIds = [...new Set(activities.filter(a => a.prospect_id).map(a => a.prospect_id))];
        const _wvCIds = [...new Set(activities.filter(a => a.customer_id).map(a => a.customer_id))];
        const [_wvPRes, _wvCRes] = await Promise.all([
            _wvPIds.length > 0 ? AppDataStore.queryAdvanced('prospects', { scopeField: 'id', scopeValues: _wvPIds, limit: 5000, select: 'id,full_name', countMode: null }) : Promise.resolve({ data: [] }),
            _wvCIds.length > 0 ? AppDataStore.queryAdvanced('customers', { scopeField: 'id', scopeValues: _wvCIds, limit: 5000, select: 'id,full_name', countMode: null }) : Promise.resolve({ data: [] }),
        ]);
        const prospectMapWV = new Map(((_wvPRes && _wvPRes.data) || []).map(p => [String(p.id), p]));
        const customerMapWV = new Map(((_wvCRes && _wvCRes.data) || []).map(c => [String(c.id), c]));

        // Pre-bucket activities ONCE by "<date> <hour>" so each of the ~91
        // (13 hours × 7 days) grid cells is an O(1) Map.get instead of an O(n)
        // .filter over the whole activities array (previously ~1M iterations at
        // 10k+ activities, blocking the main thread). Keying on start_time's
        // first two chars reproduces the original predicate exactly:
        // `a.start_time.startsWith(hourStr)` where hourStr is the 2-digit hour.
        // Rows with no start_time are skipped here just as the `a.start_time &&`
        // guard skipped them before.
        const wvActivityBuckets = new Map();
        for (const a of activities) {
            if (!a.activity_date || !a.start_time) continue;
            const bk = `${a.activity_date} ${a.start_time.slice(0, 2)}`;
            let bucket = wvActivityBuckets.get(bk);
            if (!bucket) { bucket = []; wvActivityBuckets.set(bk, bucket); }
            bucket.push(a);
        }

        // Time async slots (8 AM to 8 PM)
        for (let hour = 8; hour <= 20; hour++) {
            html += '<div class="week-hour-row">';
            html += `<div class="hour-label">${hour.toString().padStart(2, '0')}:00</div>`;

            for (let day = 0; day < 7; day++) {
                const dayDate = new Date(startOfWeek);
                dayDate.setDate(startOfWeek.getDate() + day);
                const dateStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth()+1).padStart(2,'0')}-${String(dayDate.getDate()).padStart(2,'0')}`;
                const hourStr = hour.toString().padStart(2, '0');

                const dayActivities = wvActivityBuckets.get(`${dateStr} ${hourStr}`) || [];

                html += '<div class="week-hour-cell">';
                for (const a of dayActivities) {
                    const prospect = a.prospect_id ? prospectMapWV.get(String(a.prospect_id)) : null;
                    const customer = a.customer_id ? customerMapWV.get(String(a.customer_id)) : null;
                    // Client names are private to the activity owner/co-agents (match the
                    // month-grid _tileOwned gate) — otherwise the week view leaked every
                    // agent's prospect/customer names. Also escape to prevent stored XSS.
                    const _wvOwned = _canViewEntityName(a, visibleIdsWV);
                    const name = _wvOwned
                        ? (prospect?.full_name || customer?.full_name || a.activity_title || 'Activity')
                        : (a.activity_title || a.activity_type || 'Activity');

                    html += buildWeekActivityHtml(a, name);
                }
                html += '</div>';
            }
            html += '</div>';
        }

        html += '</div></div>';
        grid.innerHTML = html;
    };

    const renderDayView = async () => {
        const grid = document.getElementById('calendar-grid');
        // Build local YYYY-MM-DD — toISOString() shifts to UTC and can return
        // the previous calendar day for users east of GMT (e.g. Malaysia +08).
        const _y = _state.cd.getFullYear();
        const _m = String(_state.cd.getMonth() + 1).padStart(2, '0');
        const _d = String(_state.cd.getDate()).padStart(2, '0');
        const todayStr = `${_y}-${_m}-${_d}`;

        // Mirror renderCalendar's scoped fetch so the day view shows the SAME
        // activities the user just saw on the month grid. Previously this used
        // AppDataStore.getAll('activities'), which served whatever happened to
        // be in the SWR cache and could miss public events / co-agent invites
        // — producing a "Total Activities 4" stat that didn't match the 10
        // chips visible in the month cell the user just tapped.
        const visibleIdsDV = await getVisibleUserIds(_state.cu);
        const actQueryOptsDV = {
            gte: { activity_date: todayStr },
            lte: { activity_date: todayStr },
            sort: 'start_time',
            sortDir: 'asc',
            limit: 5000,
            offset: 0,
            countMode: null,
            filters: {},
        };
        // Agent filter is a user-chosen narrowing and applies to every viewer, admins included.
        if (_filters?.agent && _filters.agent !== 'all') {
            actQueryOptsDV.filters.lead_agent_id = _filters.agent;
        }
        if (_filters?.type && _filters.type !== 'all') {
            actQueryOptsDV.filters.activity_type = _filters.type;
        }
        if (!isSystemAdmin(_state.cu) && visibleIdsDV !== 'all') {
            actQueryOptsDV.scopeFields = [
                { field: 'lead_agent_id', values: visibleIdsDV },
                { field: 'visibility', values: ['open', 'public', 'team'] }
            ];
        }
        const needsCoAgentMergeDV = !isSystemAdmin(_state.cu) && _state.cu?.id != null;
        const [actResultDV, allUsersDV, allEventsDV, coAgentRowsDV] = await Promise.all([
            AppDataStore.queryAdvanced('activities', actQueryOptsDV),
            AppDataStore.getAll('users'),
            AppDataStore.getAll('events'),
            needsCoAgentMergeDV ? _fetchActivitiesAsCoAgent(todayStr, todayStr) : Promise.resolve([]),
        ]);
        let rawActivitiesDV = actResultDV.data || [];
        if (coAgentRowsDV && coAgentRowsDV.length > 0) {
            const seen = new Set(rawActivitiesDV.map(a => String(a.id)));
            for (const a of coAgentRowsDV) {
                if (!seen.has(String(a.id)) && a.activity_date === todayStr) {
                    seen.add(String(a.id));
                    rawActivitiesDV.push(a);
                }
            }
        }
        // Apply orphan filter — same logic as renderCalendar — so activities linked to
        // a deleted event never appear in the day view (would cause "Activity not found").
        const existingEventIdsDV = new Set(allEventsDV.map(e => String(e.id)));
        if (allEventsDV.length > 0) {
            rawActivitiesDV = rawActivitiesDV.filter(a =>
                a.activity_type !== 'EVENT' || !a.event_id || existingEventIdsDV.has(String(a.event_id))
            );
        }
        // Dedupe identical EVENT activities at the same slot (matches month grid).
        const dayActivities = [];
        const seenEventSlotsDV = new Set();
        for (const a of rawActivitiesDV) {
            if (_isAutoTouchLog(a)) continue;
            if (a.activity_type === 'EVENT' && a.event_id) {
                const slotKey = `${a.event_id}|${a.start_time || ''}|${a.end_time || ''}`;
                if (seenEventSlotsDV.has(slotKey)) continue;
                seenEventSlotsDV.add(slotKey);
            }
            dayActivities.push(a);
        }
        dayActivities.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
        // Make every rendered row resolvable on click (see _calGridIndex).
        _indexGridActivities(dayActivities);
        // Fetch ONLY the prospect/customer names the scoped day activities
        // reference (id,full_name) — not the whole tables. Mirrors the week-view
        // + renderTodayActivities fix; closes the same getAll() privacy over-fetch.
        const _dvPIds = [...new Set(dayActivities.filter(a => a.prospect_id).map(a => a.prospect_id))];
        const _dvCIds = [...new Set(dayActivities.filter(a => a.customer_id).map(a => a.customer_id))];
        const [_dvPRes, _dvCRes] = await Promise.all([
            _dvPIds.length > 0 ? AppDataStore.queryAdvanced('prospects', { scopeField: 'id', scopeValues: _dvPIds, limit: 5000, select: 'id,full_name', countMode: null }) : Promise.resolve({ data: [] }),
            _dvCIds.length > 0 ? AppDataStore.queryAdvanced('customers', { scopeField: 'id', scopeValues: _dvCIds, limit: 5000, select: 'id,full_name', countMode: null }) : Promise.resolve({ data: [] }),
        ]);
        const prospectMapDV = new Map(((_dvPRes && _dvPRes.data) || []).map(p => [String(p.id), p]));
        const customerMapDV = new Map(((_dvCRes && _dvCRes.data) || []).map(c => [String(c.id), c]));
        const userMapDV = new Map((allUsersDV || []).map(u => [String(u.id), u]));

        // Calculate summary stats over ONLY the activities the timeline actually
        // renders (those with a start_time). Counting start_time-less rows in the
        // headline totals made the summary claim more than the grid showed.
        const timedActivities = dayActivities.filter(a => a.start_time);
        const totalActivities = timedActivities.length;
        const totalMeetings = timedActivities.filter(a => a.activity_type === 'FTF').length;
        const totalCalls = timedActivities.filter(a => a.activity_type === 'CALL' || a.activity_type === 'WHATSAPP').length;

        let html = '<div class="enhanced-day-view">';
        html += `
                <div class="day-header">
                    <h2>${_state.cd.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h2>
                    <button class="btn primary btn-sm" onclick="app.openActivityModal('${todayStr}')">
                        <i class="fas fa-plus"></i> Add Activity
                    </button>
                </div>

                <div class="day-summary">
                    <div class="summary-card">
                        <div class="summary-label">Total Activities</div>
                        <div class="summary-value">${totalActivities}</div>
                    </div>
                    <div class="summary-card">
                        <div class="summary-label">Meetings</div>
                        <div class="summary-value">${totalMeetings}</div>
                    </div>
                    <div class="summary-card">
                        <div class="summary-label">Calls</div>
                        <div class="summary-value">${totalCalls}</div>
                    </div>
                </div>

                <div class="timeline">
        `;

        // Group activities by hour
        for (let hour = 0; hour < 24; hour++) {
            const hourStr = hour.toString().padStart(2, '0');
            const hourActivities = dayActivities.filter(a => a.start_time && a.start_time.startsWith(hourStr));

            html += `
                <div class="timeline-hour">
                    <div class="timeline-label">${hourStr}:00</div>
                    <div class="timeline-slot">
            `;

            for (const a of hourActivities) {
                const prospect = a.prospect_id ? prospectMapDV.get(String(a.prospect_id)) : null;
                const customer = a.customer_id ? customerMapDV.get(String(a.customer_id)) : null;
                const _dvOwned = _canViewEntityName(a, visibleIdsDV);
                const name = _dvOwned ? (prospect?.full_name || customer?.full_name || '') : '';
                const agent = userMapDV.get(String(a.lead_agent_id));

                html += `
                    <div class="timeline-activity ${String(a.activity_type || '').toLowerCase()}" onclick="app.viewActivityDetails(${a.id})">
                        <div class="activity-time">${a.start_time} - ${a.end_time || '?'}</div>
                        <div class="activity-title"><strong>${esc(a.activity_title || a.activity_type)}</strong> ${esc(name)}</div>
                        <div class="activity-agent">Agent: ${esc(agent?.full_name || 'Unknown')}</div>
                    </div>
                `;
            }

            html += '</div></div>';
        }

        html += '</div></div>';
        grid.innerHTML = html;
    };

    // generateDayHours / openFilterModal / applyFilters / clearFilters were
    // REMOVED here (2026-06-20 audit): all four were dead/legacy and unsafe —
    //   • generateDayHours did an unscoped getAll('activities'/'prospects') and
    //     rendered every agent's prospect names with NO ownership masking (the
    //     cross-agent name-leak class the live renderers were fixed for); no
    //     caller existed.
    //   • openFilterModal hardcoded four fictional demo agents (ids 5-8 Michelle
    //     Tan / Ah Seng / Mei Ling / Raj Kumar) that match no production
    //     lead_agent_id, a "Search by title or summary" input never consumed by
    //     any query path, and a Date Range never applied — a fully non-functional
    //     control with no HTML caller.
    //   • applyFilters/clearFilters were its only siblings, superseded by the
    //     live openCalendarFilterModal / applyCalendarFilters / clearCalendarFilters.
    // Their exports are removed from the register() tail below.

    const todo = (msg = 'Coming in Phase 2') => {
        UI.toast.info(msg);
    };

    // Robust activity lookup used by viewActivityDetails AND every downstream
    // handler the modal can trigger (Accept/Reject, Repair Link, Live Notes,
    // WhatsApp invite, …). _state.hac holds rows fetched via the calendar
    // RPC, which can include activities the user is on as a consultant — those
    // rows aren't always returned by a direct `activities.select().eq('id', …)`
    // under RLS, so handlers that only used AppDataStore.getById would show
    // "Activity not found" while the modal was open with valid data right next
    // to them. This helper mirrors viewActivityDetails's lookup chain so the
    // two code paths can never disagree.
    //
    // _recentActivities is a per-session pin-board of every activity that has
    // been successfully rendered in this tab. The moment a modal opens with
    // valid data, the row gets pinned here — so any downstream click handler
    // (Accept, Reject, Repair, Live Notes, WhatsApp, Edit) is GUARANTEED to
    // resolve the same row, no matter what subsequently happened to the SWR
    // snapshot, the in-memory cache, or the network's RLS verdict.
    const _recentActivities = new Map();
    const _pinRecentActivity = (a) => {
        if (!a || a.id == null) return;
        _recentActivities.set(String(a.id), a);
        // Cap to 200 rows so the map can't grow without bound across a long session.
        if (_recentActivities.size > 200) {
            const oldest = _recentActivities.keys().next().value;
            if (oldest !== undefined) _recentActivities.delete(oldest);
        }
    };

    // _calGridIndex — every activity row that was DRAWN on a calendar grid this
    // session (month / week / day). It exists to close a gap that surfaced as
    // "Activity not found" when clicking a tile the user is plainly looking at:
    //   • The grids fetch via get_calendar_window / queryAdvanced, both of which
    //     include the `visibility IN ('open','public')` arm — so a tile can be
    //     visible that the caller CANNOT re-read with a direct getById, because
    //     the activities table RLS is owner/subtree-scoped (no public arm).
    //   • _state.hac (the full-row click cache) only covers yesterday→today+7,
    //     so any tile outside that window misses the hot tier too.
    // When both happen at once (e.g. a public activity 4 days in the past) every
    // tier of _lookupActivityRobust below missed and the modal refused to open.
    // Stashing the light row that rendered the tile lets the detail lookup
    // always resolve what was drawn. Heavy columns (notes/summary/consultants)
    // may be absent — the detail modal renders those conditionally, so they are
    // simply omitted, never broken. Bounded so a long session can't grow it
    // without limit.
    const _calGridIndex = new Map();
    const _indexGridActivities = (rows) => {
        if (!Array.isArray(rows)) return;
        for (const a of rows) {
            // Skip optimistic in-flight rows: they carry a temp id and clicking
            // them is already gated, and we must not let a temp row mask the real
            // one once it syncs.
            if (!a || a.id == null || a._optimistic) continue;
            _calGridIndex.set(String(a.id), a);
        }
        while (_calGridIndex.size > 1000) {
            const oldest = _calGridIndex.keys().next().value;
            if (oldest === undefined) break;
            _calGridIndex.delete(oldest);
        }
    };

    const _lookupActivityRobust = async (activityId) => {
        if (activityId == null || activityId === 'null' || activityId === 'undefined') return null;
        const idStr = String(activityId);
        // Tier 0 — pinned row from a successful prior render in this tab.
        // Survives invalidateCache(), SWR refresh, and any RLS flap.
        const pinned = _recentActivities.get(idStr);
        if (pinned) return pinned;
        // Tier 1 — calendar hot RPC cache (get_calendar_hot_details, full rows
        // for yesterday→today+7). The RPC is SECURITY INVOKER, so this only
        // holds rows the caller's RLS already permits within the hot window.
        let activity = _state.hac.get(idStr) || null;
        // Tier 2 — AppDataStore (which now checks primedRows, then SWR, then network).
        if (!activity) {
            activity = await AppDataStore.getById('activities', activityId);
        }
        // Tier 3 — full-table scan via getAll (uses light-select projection).
        if (!activity) {
            const all = await AppDataStore.getAll('activities');
            activity = all.find(a => String(a.id) === idStr) || null;
        }
        // Tier 4 — raw localStorage snapshot, in case getAll just got a stale RLS denial.
        if (!activity) {
            try {
                const raw = localStorage.getItem('fs_crm_activities');
                if (raw) {
                    const rows = JSON.parse(raw);
                    if (Array.isArray(rows)) {
                        activity = rows.find(a => a && String(a.id) === idStr) || null;
                    }
                }
            } catch (_) { /* intentional: localStorage snapshot fallback is best-effort */ }
        }
        if (activity) {
            _pinRecentActivity(activity);
            return activity;
        }
        // Tier 5 — calendar grid snapshot (final fallback). The row was drawn on
        // a grid this session but is outside the hot window AND not directly
        // re-readable (scoped-RLS public/open activity owned by another agent).
        // Return the light row that rendered the tile so the modal opens instead
        // of erroring. Deliberately NOT pinned: if a later getById can fetch the
        // full row (e.g. a transient denial clears), that authoritative path
        // should win on the next click rather than being masked by this stash.
        return _calGridIndex.get(idStr) || null;
    };

    // Pure HTML builder for viewActivityDetails — extracted verbatim so the
    // orchestrator below keeps the same template string while staying a thin
    // function. `esc`, `escapeHtml`, and `_state` are read from the enclosing
    // closure (same as the inline code). Takes the locals the template reads.
    const buildActivityDetailsContent = (activity, marketingEvent, _isOwnActivity, _canSeeEntity, entityName, _entityIconBtn, _consultantId, _consultantName, _leadAgentName, attendeeHtml, isAttendeeType, entityOrphaned, activityId) => {
        return `
            <div class="activity-details">
                <div class="detail-section">
                    <h4>Activity Information</h4>
                    <div class="info-row"><span class="info-label">Type:</span> <span>${escapeHtml(activity.activity_type || '')}</span></div>
                    <div class="info-row"><span class="info-label">Title:</span> <span>${escapeHtml(marketingEvent?.event_title || marketingEvent?.title || activity.activity_title || 'N/A')}</span></div>
                    <div class="info-row"><span class="info-label">Date:</span> <span>${escapeHtml(activity.activity_date || '')}</span></div>
                    <div class="info-row"><span class="info-label">Time:</span> <span>${escapeHtml(activity.start_time || '')} - ${escapeHtml(activity.end_time || '')}</span></div>
                    ${activity.activity_type !== 'EVENT' && _canSeeEntity ? `<div class="info-row"><span class="info-label">Met With:</span> <span style="display:inline-flex; align-items:center; flex-wrap:wrap; gap:4px;">${escapeHtml(entityName || '')}${_entityIconBtn}</span></div>` : ''}
                    ${activity.location_address ? `<div class="info-row"><span class="info-label">Location:</span> <span>${escapeHtml(activity.location_address)}</span></div>` : ''}
                    ${marketingEvent?.description ? `<div class="info-row" style="flex-direction:column; align-items:flex-start; gap:4px;"><div style="display:flex; align-items:center; gap:8px; width:100%;"><span class="info-label">Description:</span><button style="width:30px;height:30px;border-radius:50%;border:none;background:#25d366;color:#fff;font-size:17px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 8px rgba(37,211,102,0.4);flex-shrink:0;" onclick="event.stopPropagation();app.sendDescriptionInvite(${activity.id})" title="Send WhatsApp Invite"><i class="fab fa-whatsapp"></i></button></div><span style="white-space:pre-wrap; color:var(--gray-700);">${escapeHtml(marketingEvent.description)}</span></div>` : ''}
                    ${activity.summary ? `<div class="info-row"><span class="info-label">Summary:</span> <span>${escapeHtml(activity.summary)}</span></div>` : ''}
                </div>

                ${marketingEvent ? `
                <div class="detail-section">
                    <h4>Event Details</h4>
                    ${marketingEvent.ticket_price ? `<div class="info-row"><span class="info-label">Ticket Price:</span> <span>RM ${marketingEvent.ticket_price}</span></div>` : ''}
                    ${marketingEvent.early_bird_price ? `<div class="info-row"><span class="info-label">Early Bird Price:</span> <span>RM ${marketingEvent.early_bird_price}</span></div>` : ''}
                    ${marketingEvent.group_purchase_price ? `<div class="info-row"><span class="info-label">Group Purchase Price:</span> <span>RM ${marketingEvent.group_purchase_price}</span></div>` : ''}
                    ${marketingEvent.duration ? `<div class="info-row"><span class="info-label">Duration:</span> <span>${esc(marketingEvent.duration)}</span></div>` : ''}
                    ${marketingEvent.target_group ? `<div class="info-row"><span class="info-label">Target Group:</span> <span>${esc(marketingEvent.target_group)}</span></div>` : ''}
                    ${marketingEvent.remarks ? `<div class="info-row"><span class="info-label">Remarks:</span> <span>${esc(marketingEvent.remarks)}</span></div>` : ''}
                </div>
                ` : ''}

                ${isAttendeeType || !_isOwnActivity ? '' : `
                <div class="detail-section">
                    <h4>Consultant</h4>
                    ${_consultantId
                        ? `<div class="info-row"><span class="info-label">Consultant Name:</span> <span>✅ ${esc(_consultantName || 'Unknown')}</span></div>`
                        : `<div class="info-row"><span class="info-label">Consultant Name:</span> <span>❌ Not Assigned</span></div>`}
                </div>
                `}

                ${activity.activity_type !== 'EVENT' ? `
                <div class="detail-section">
                    <h4>Agents</h4>
                    <div class="info-row"><span class="info-label">Lead:</span> <span>${esc(_leadAgentName || 'Unknown')}</span></div>
                    ${activity.co_agents?.length ? `
                        <div class="info-row" style="flex-direction:column;align-items:flex-start;gap:6px;">
                            <span class="info-label">Co-Agents:</span>
                            <div style="width:100%;">
                                ${activity.co_agents.map(ca => {
                                    const caStatus = ca.status || 'accepted';
                                    const statusIcon = caStatus === 'accepted'
                                        ? '<i class="fas fa-check-circle" style="color:#16a34a;margin-right:4px;" title="Accepted"></i>'
                                        : caStatus === 'rejected'
                                            ? '<i class="fas fa-times-circle" style="color:#dc2626;margin-right:4px;" title="Rejected"></i>'
                                            : '<i class="fas fa-clock" style="color:#f59e0b;margin-right:4px;" title="Pending response"></i>';
                                    const isMe = _state.cu && String(_state.cu.id) === String(ca.id);
                                    const canRespond = isMe && caStatus === 'pending';
                                    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--gray-100);">
                                        <span>${statusIcon}<strong>${esc(ca.name)}</strong> <span style="font-size:11px;color:#888;">${esc(ca.co_role || '')}</span></span>
                                        ${canRespond ? `
                                        <span>
                                            <button class="btn btn-sm" style="background:#dcfce7;color:#166534;border:none;padding:3px 8px;border-radius:4px;cursor:pointer;margin-right:4px;" onclick="event.stopPropagation();app.respondCoAgentInvite(${activityId},'accepted')"><i class="fas fa-check"></i> Accept</button>
                                            <button class="btn btn-sm" style="background:#fee2e2;color:#991b1b;border:none;padding:3px 8px;border-radius:4px;cursor:pointer;" onclick="event.stopPropagation();app.respondCoAgentInvite(${activityId},'rejected')"><i class="fas fa-times"></i> Reject</button>
                                        </span>` : ''}
                                    </div>`;
                                }).join('')}
                            </div>
                        </div>
                    ` : ''}
                    ${activity.consultants?.length ? `
                        <div class="info-row" style="flex-direction:column;align-items:flex-start;gap:6px;">
                            <span class="info-label">Consultants:</span>
                            <div style="width:100%;">
                                ${activity.consultants.map(c => {
                                    const statusIcon = c.status === 'accepted'
                                        ? '<i class="fas fa-check-circle" style="color:#16a34a;margin-right:4px;" title="Accepted"></i>'
                                        : c.status === 'rejected'
                                            ? '<i class="fas fa-times-circle" style="color:#dc2626;margin-right:4px;" title="Rejected"></i>'
                                            : '<i class="fas fa-clock" style="color:#f59e0b;margin-right:4px;" title="Pending response"></i>';
                                    const isCurrentConsultant = _state.cu && _state.cu.id === c.id;
                                    const canRespond = isCurrentConsultant && c.status === 'pending';
                                    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--gray-100);">
                                        <span>${statusIcon}<strong>${esc(c.name)}</strong> <span style="font-size:11px;color:#888;">${esc(c.role||'')}</span></span>
                                        ${canRespond ? `
                                        <span>
                                            <button class="btn btn-sm" style="background:#dcfce7;color:#166534;border:none;padding:3px 8px;border-radius:4px;cursor:pointer;margin-right:4px;" onclick="event.stopPropagation();app.respondConsultantInvite(${activityId},${c.id},'accepted')"><i class="fas fa-check"></i> Accept</button>
                                            <button class="btn btn-sm" style="background:#fee2e2;color:#991b1b;border:none;padding:3px 8px;border-radius:4px;cursor:pointer;" onclick="event.stopPropagation();app.respondConsultantInvite(${activityId},${c.id},'rejected')"><i class="fas fa-times"></i> Reject</button>
                                        </span>` : ''}
                                    </div>`;
                                }).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
                ` : ''}
                ${attendeeHtml}
                <div class="detail-section act-actions-section">
                    <h4>Actions</h4>
                    <div class="act-actions-list">
                        ${(() => {
                            const _MEETUP_TYPES = ['CPS','FTF','FSA','GR','XG','CALL','EMAIL','WHATSAPP'];
                            const _isMeetup = _MEETUP_TYPES.includes(activity.activity_type);
                            const _entityId = activity.prospect_id || activity.customer_id;
                            const _isProspect = !!activity.prospect_id;
                            const _entityKind = _isProspect ? 'prospect' : 'customer';
                            const _entityLabel = _isProspect ? 'Prospect' : 'Customer';
                            // Orphaned link: skip the entity-dependent buttons (they would just
                            // surface "record not found") and offer a single Repair action.
                            if (entityOrphaned) {
                                return `
                            <button class="act-action-btn act-btn-profile" style="background:#fef3c7;border-color:#f59e0b;color:#92400e;" onclick="(async () => { await app.openActivityRepairModal(${activityId}); })()"><span class="act-icon"><i class="fas fa-link"></i></span><span class="act-label">Repair Link</span></button>
                            <button class="act-action-btn act-btn-edit" onclick="app.editActivityTiming(${activityId})"><span class="act-icon"><i class="fas fa-pen"></i></span><span class="act-label">Edit</span></button>
                            <button class="act-action-btn act-action-delete" onclick="(async () => { await app.deleteActivity(${activityId}); })()"><i class="fas fa-trash-alt"></i> Delete</button>`;
                            }
                            const _profileBtn = (_isMeetup && _entityId)
                                ? `<button class="act-action-btn act-btn-profile" onclick="(async()=>{ const p=await AppDataStore.getById('${_entityKind}s',${_entityId}); if(!p){UI.toast.error('${_entityLabel} record not found');return;} UI.hideModal(); app.${_isProspect ? 'showProspectDetail' : 'showCustomerDetail'}(${_entityId}); })()"><span class="act-icon"><i class="fas fa-user"></i></span><span class="act-label">${_entityLabel}</span></button>`
                                : '';
                            const _cpsBtns = (activity.activity_type === 'CPS' && activity.prospect_id)
                                ? `<button class="act-action-btn act-btn-doc" onclick="app.uploadCPSForm(${activityId}, ${activity.prospect_id})"><span class="act-icon"><i class="fas fa-file-upload"></i></span><span class="act-label">Upload CPS</span></button>
                                   <button class="act-action-btn act-btn-doc" onclick="app.uploadAPUForm(${activityId}, ${activity.prospect_id})"><span class="act-icon"><i class="fas fa-file-alt"></i></span><span class="act-label">APU</span></button>`
                                : '';
                            const _outcomeBtn = (_isMeetup && _entityId)
                                ? `<button class="act-action-btn act-btn-outcome" onclick="(async () => { await app.openMeetingOutcomeModal(${activityId}); })()"><span class="act-icon"><i class="fas fa-clipboard-check"></i></span><span class="act-label">Closing</span></button>`
                                : '';
                            const _notesBtn = (_isMeetup && _entityId)
                                ? `<button class="act-action-btn act-btn-notes" onclick="(async () => { await app.openPostMeetupNotesModal(${activityId}, ${_entityId}); })()"><span class="act-icon"><i class="fas fa-sticky-note"></i></span><span class="act-label">Minutes</span></button>`
                                : '';
                            const _liveBtn = (_isMeetup || activity.activity_type === 'AGENT_TRAINING')
                                ? `<button class="act-action-btn act-btn-edit" onclick="(async()=>{ UI.hideModal(); await app.openMeetingCapture(${activityId}); })()"><span class="act-icon"><i class="fas fa-microphone-alt"></i></span><span class="act-label">Live Notes</span></button>`
                                : '';
                            return `
                            ${_profileBtn}
                            ${_cpsBtns}
                            <button class="act-action-btn act-btn-edit" onclick="app.editActivityTiming(${activityId})"><span class="act-icon"><i class="fas fa-pen"></i></span><span class="act-label">Edit</span></button>
                            ${_outcomeBtn}
                            ${_notesBtn}
                            ${_liveBtn}
                            <button class="act-action-btn act-action-delete" onclick="(async () => { await app.deleteActivity(${activityId}); })()"><i class="fas fa-trash-alt"></i> Delete</button>`;
                        })()}
                    </div>
                </div>
            </div>
        `;
    };

    const viewActivityDetails = async (activityId) => {
        // Hot cache hit: activity is in the yesterday→today+7 window pre-warmed by
        // the last renderCalendar(). Skip the network round-trip entirely so the
        // detail modal opens instantly on near-term taps.
        const activity = await _lookupActivityRobust(activityId);
        if (!activity) { UI.toast.error('Activity not found'); return; }
        // Pin BEFORE we kick off prospect/customer lookups so any concurrent
        // click handler reading the same id resolves instantly.
        _pinRecentActivity(activity);

        // Parallelise the three independent lookups — prospect, customer and
        // the linked marketing event are all keyed off fields we already have
        // on `activity`, so there's no need to await them one after another.
        // On cold cache this turns 3 × network round-trips into one.
        const [prospect, customer, marketingEvent] = await Promise.all([
            activity.prospect_id ? AppDataStore.getById('prospects', activity.prospect_id) : null,
            activity.customer_id ? AppDataStore.getById('customers', activity.customer_id) : null,
            (activity.activity_type === 'EVENT' && activity.event_id)
                ? AppDataStore.getById('events', activity.event_id)
                : null,
        ]);
        // Orphan detection: activity carries a prospect_id / customer_id but the
        // row was deleted (or scoped out). The buttons that depend on the entity
        // would just throw "record not found" toasts, so we render a Repair Link
        // action instead and label the row with the broken ID.
        const entityOrphaned = !!((activity.prospect_id && !prospect) || (activity.customer_id && !customer));
        const orphanKind = activity.prospect_id ? 'prospect' : (activity.customer_id ? 'customer' : null);
        const orphanId = activity.prospect_id || activity.customer_id;
        const entityName = prospect?.full_name
            || customer?.full_name
            || (entityOrphaned ? `⚠ Deleted ${orphanKind} (ID: ${orphanId})` : 'Unknown');

        // Non-owners (agents viewing someone else's public activity) must not see
        // prospect/customer names or profile links — those belong to the lead agent.
        const _isOwnActivity = isSystemAdmin(_state.cu)
            || String(activity.lead_agent_id) === String(_state.cu?.id)
            || (Array.isArray(activity.co_agents) && activity.co_agents.some(ca => String(ca.id) === String(_state.cu?.id)));

        // A team leader / manager viewing a DOWNLINE agent's activity is entitled
        // to the prospect/customer name — the calendar already surfaced the tile to
        // them (grid RPC scoped by getVisibleUserIds), and the Actions strip already
        // offers a Prospect/Customer button. _isOwnActivity (admin/lead/co-agent)
        // hid the name from the very leaders whose job is to see it, so the "Met
        // With" row + inline profile link now gate on the broader scope check while
        // _isOwnActivity keeps its literal-ownership meaning for the rest of the modal.
        const _entityScope = await getVisibleUserIds(_state.cu).catch(() => null);
        const _canSeeEntity = _canViewEntityName(activity, _entityScope);

        let attendeeHtml = '';
        const isAttendeeType = ['EVENT', 'AGENT_MEETING', 'AGENT_TRAINING'].includes(activity.activity_type);
        if (isAttendeeType && activity.event_id) {
            // Attendees are shared across ALL activity rows that point to the same event on
            // the same date. Each agent who joins an event creates their own activity row, but
            // they should all see the same registered attendees. We scope by event_date so a
            // recurring event still keeps each session's attendees separate.
            const [allActivities, allAttendees, prospects, customers, users] = await Promise.all([
                AppDataStore.getAll('activities'),
                AppDataStore.getAll('event_attendees', { fresh: true }),
                AppDataStore.getAll('prospects'),
                AppDataStore.getAll('customers'),
                AppDataStore.getAll('users'),
            ]);
            const sameSessionActivityIds = new Set(
                allActivities
                    .filter(a => String(a.event_id) === String(activity.event_id)
                        && a.activity_date === activity.activity_date)
                    .map(a => String(a.id))
            );
            sameSessionActivityIds.add(String(activity.id));
            // Include users so agent attendees (AGENT_MEETING / AGENT_TRAINING) resolve their names
            const all = [...prospects, ...customers, ...users];

            // Hide ghost records that have no attendee_id, no entity_id, and no entity_name —
            // these are leftovers from the pre-fix bug where the schema-mismatch stripper
            // dropped the prospect link before insert. They cannot be resolved to a person on
            // any user's machine and would otherwise show up as "Unresolved prospect" rows.
            const attendees = allAttendees.filter(a => {
                if (String(a.event_id) !== String(activity.event_id)) return false;
                if (a.activity_id && !sameSessionActivityIds.has(String(a.activity_id))) return false;
                const entityId = a.entity_id || a.attendee_id;
                const person = entityId ? all.find(p => String(p.id) === String(entityId)) : null;
                const hasName = !!(person?.full_name || a.entity_name);
                return hasName;
            });
            // v6: split attendees into prospect-type and agent-type for separate rendering
            const prospectAttendees = attendees.filter(a => a.attendee_type !== 'agent');
            const agentAttendees = attendees.filter(a => a.attendee_type === 'agent');

            // Per-attendee name visibility. An EVENT gathers attendees added by many
            // different agents (att.added_by_agent_id), so the right unit of privacy is
            // the ROW, not the activity's lead agent — otherwise an agent could not even
            // see the client THEY registered (they weren't the event's lead agent).
            // A viewer may see an attendee's name when:
            //   • they hold an org-wide role (admin / marketing), OR
            //   • they own this activity (lead agent / co-agent), OR
            //   • they added this attendee themselves (own client), OR
            //   • the adder is within their downline (team leader → their agents), OR
            //   • the adder shares their team (same-team peers).
            const _viewer = _state.cu;
            const _viewerTeam = _viewer && _viewer.team_id != null ? String(_viewer.team_id) : null;
            const _visibleAgentIds = await getVisibleUserIds(_viewer).catch(() => null);
            const _orgWide = isSystemAdmin(_viewer) || isMarketingManager(_viewer) || _visibleAgentIds === 'all';
            const _userById = new Map(users.map(u => [String(u.id), u]));
            const _canSeeAttendeeName = (att) => {
                if (_orgWide || _isOwnActivity) return true;
                const adderId = att.added_by_agent_id != null ? String(att.added_by_agent_id) : null;
                if (!adderId) return false; // legacy row without an adder → stay private
                if (_viewer && adderId === String(_viewer.id)) return true; // own client
                if (Array.isArray(_visibleAgentIds) && _visibleAgentIds.map(String).includes(adderId)) return true; // downline (team leader sees their agents)
                const adder = _userById.get(adderId); // same-team peer
                if (adder && _viewerTeam && adder.team_id != null && String(adder.team_id) === _viewerTeam) return true;
                return false;
            };

            const renderProspectRow = async (att) => {
                // Names are private to the adder, their team, their upline, and the
                // activity owner — everyone else sees an anonymized placeholder.
                if (!_canSeeAttendeeName(att)) {
                    return `<div class="info-row" style="color:var(--gray-400);font-size:12px;font-style:italic;">— Attendee (private) —</div>`;
                }
                const entityId = att.entity_id || att.attendee_id;
                const person = all.find(p => String(p.id) === String(entityId));
                const name = person?.full_name || att.entity_name || '';
                const agent = users.find(u => String(u.id) === String(att.added_by_agent_id));
                const agentName = agent?.full_name || att.added_by_name || 'Unknown';
                const attendedChecked = (att.attended || att.attendance_status === 'Attended') ? 'checked' : '';
                const unattendedChecked = att.attendance_status === 'No Show' ? 'checked' : '';
                const paidChecked = att.paid ? 'checked' : '';
                const ticketChecked = att.ticket_created ? 'checked' : '';
                return `
                    <div class="info-row" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:8px; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
                        <div>
                            <strong style="cursor:pointer;color:var(--primary);text-decoration:underline;" onclick="event.stopPropagation();app.showAttendeeDetails(${entityId},'${UI.escJsAttr(String(att.attendee_type||'prospect'))}')">${esc(name)}</strong>
                            <span style="font-size:10px; margin-left:5px; background:var(--gray-100); padding:1px 6px; border-radius:10px;">${att.attendee_type || 'prospect'}</span>
                            <div style="font-size:11px; color:gray;">Added by: ${esc(agentName)}</div>
                        </div>
                        <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
                            <label style="display:flex; align-items:center; gap:4px; font-size:13px; cursor:pointer;">
                                <input type="checkbox" ${paidChecked} onchange="app.toggleAttendeePaid(${att.id}, this.checked)"> Paid
                            </label>
                            <label style="display:flex; align-items:center; gap:4px; font-size:13px; cursor:pointer;">
                                <input type="checkbox" ${ticketChecked} onchange="app.toggleAttendeeTicket(${att.id}, this.checked)"> Ticket Created
                            </label>
                            <label style="display:flex; align-items:center; gap:4px; font-size:13px; cursor:pointer;">
                                <input type="checkbox" ${attendedChecked} onchange="app.toggleAttendeeAttended(${att.id}, this.checked, ${entityId}, '${UI.escJsAttr(String(att.attendee_type||'prospect'))}', ${activity.event_id}, '${UI.escJsAttr(String(activity.activity_date||''))}')"> Attended
                            </label>
                            <label style="display:flex; align-items:center; gap:4px; font-size:13px; cursor:pointer;">
                                <input type="checkbox" ${unattendedChecked} onchange="app.toggleAttendeeUnattended(${att.id}, this.checked, ${entityId}, '${UI.escJsAttr(String(att.attendee_type||'prospect'))}', ${activity.event_id}, '${UI.escJsAttr(String(activity.activity_date||''))}')"> Unattended
                            </label>
                            ${entityId ? `<button class="btn btn-sm secondary" onclick="(async()=>{ await app.openAttendeePostEventModal(${att.id}, ${activityId}, ${entityId}); })()">Post Event</button>` : ''}
                        </div>
                    </div>
                `;
            };

            const renderAgentRow = async (att) => {
                const entityId = att.entity_id || att.attendee_id;
                const person = all.find(p => String(p.id) === String(entityId));
                const name = person?.full_name || att.entity_name || '';
                const addedBy = users.find(u => String(u.id) === String(att.added_by_agent_id));
                const addedByName = addedBy?.full_name || att.added_by_name || 'Unknown';
                const attendedChecked = (att.attended || att.attendance_status === 'Attended') ? 'checked' : '';
                const unattendedChecked = att.attendance_status === 'No Show' ? 'checked' : '';
                const nameDisplay = `<strong>${esc(name)}</strong>`;
                const roleLabel = person?.role || 'consultant';
                return `
                    <div class="info-row" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:8px; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
                        <div>
                            ${nameDisplay}
                            <span style="font-size:10px; margin-left:5px; background:#E0F2FE; color:#075985; padding:1px 6px; border-radius:10px;">${escapeHtml(roleLabel)}</span>
                            <div style="font-size:11px; color:gray;">Added by: ${esc(addedByName)}</div>
                        </div>
                        <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
                            <label style="display:flex; align-items:center; gap:4px; font-size:13px; cursor:pointer;">
                                <input type="checkbox" ${attendedChecked} onchange="app.toggleAttendeeAttended(${att.id}, this.checked, ${entityId}, 'agent', ${activity.event_id}, '${UI.escJsAttr(String(activity.activity_date||''))}')"> Attended
                            </label>
                            <label style="display:flex; align-items:center; gap:4px; font-size:13px; cursor:pointer;">
                                <input type="checkbox" ${unattendedChecked} onchange="app.toggleAttendeeUnattended(${att.id}, this.checked, ${entityId}, 'agent', ${activity.event_id}, '${UI.escJsAttr(String(activity.activity_date||''))}')"> Unattended
                            </label>
                            <button class="btn btn-sm" style="background:#FEE2E2;color:#991B1B;border:none;padding:3px 8px;border-radius:4px;" onclick="event.stopPropagation();app.removeAgentAttendee(${att.id}, ${activityId})" title="Remove"><i class="fas fa-times"></i></button>
                        </div>
                    </div>
                `;
            };

            const prospectRows = (await Promise.all(prospectAttendees.map(renderProspectRow))).join('');
            const agentRows = (await Promise.all(agentAttendees.map(renderAgentRow))).join('');

            // Section 1: Prospect / Customer Attendees
            const prospectSection = `
                <div class="detail-section">
                    <h4>Attendees <span style="font-size:11px;color:#9CA3AF;font-weight:400;">(${prospectAttendees.length})</span></h4>
                    ${prospectRows || '<div class="info-row">No prospect/customer attendees.</div>'}
                    <div style="margin-top:10px; text-align:right;">
                        <button class="btn-add-slot" onclick="app.showAddAttendeeSearch('${activity.event_id}', '${activityId}')"><i class="fas fa-user-plus"></i> + Add Attendee</button>
                    </div>
                </div>
            `;

            // Section 2: Agent / Consultant Attendees (searches consultant roster)
            const agentSection = `
                <div class="detail-section">
                    <h4>Agent Attendance <span style="font-size:11px;color:#9CA3AF;font-weight:400;">(${agentAttendees.length})</span></h4>
                    ${agentRows || '<div class="info-row">No agents/consultants added.</div>'}
                    <div style="margin-top:10px; text-align:right;">
                        <button class="btn-add-slot" onclick="app.showAddConsultantSearch('${activity.event_id}', '${activityId}')"><i class="fas fa-user-tie"></i> + Add Agent / Consultant</button>
                    </div>
                </div>
            `;

            // Section 3: Event Roles (活动负责人) — five named organiser roles, each
            // assigned from the agent/consultant roster. EVENT-only; stored on the
            // shared `events` row (events.event_roles JSONB) so every agent's
            // activity row for the same event sees the same assignments. Editing is
            // limited to managers / marketing / admin or the event creator; everyone
            // else sees a read-only label.
            let rolesSection = '';
            if (activity.activity_type === 'EVENT' && activity.event_id) {
                const _EVENT_ROLE_DEFS = [
                    { key: 'main_organizer',    label: '主要负责人' },
                    { key: 'venue_lead',        label: '场地负责人' },
                    { key: 'registration_lead', label: '报到负责人' },
                    { key: 'speaker',           label: '主讲老师' },
                    { key: 'emcee',             label: '活动司仪' },
                ];
                const _eventRoles = (marketingEvent && marketingEvent.event_roles && typeof marketingEvent.event_roles === 'object')
                    ? marketingEvent.event_roles : {};
                const _roleRoster = users
                    .filter(u => isAgent(u) && u.status !== 'inactive')
                    .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
                const _canEditRoles = isSystemAdmin(_state.cu) || isManagement(_state.cu) || isMarketingManager(_state.cu)
                    || (marketingEvent && marketingEvent.created_by != null && String(marketingEvent.created_by) === String(_state.cu?.id));
                const _roleRows = _EVENT_ROLE_DEFS.map(rd => {
                    const cur = _eventRoles[rd.key] || null;
                    const curId = (cur && cur.id != null) ? String(cur.id) : '';
                    const curName = (cur && cur.name) ? String(cur.name) : '';
                    if (!_canEditRoles) {
                        return `<div class="info-row"><span class="info-label">${rd.label}:</span> <span>${curName ? esc(curName) : '—'}</span></div>`;
                    }
                    // Keep the current holder selectable even if they've since left
                    // the roster (inactive / role change) so the pill still displays.
                    let optionUsers = _roleRoster;
                    if (curId && !_roleRoster.some(u => String(u.id) === curId)) {
                        optionUsers = [{ id: cur.id, full_name: curName || ('#' + curId) }].concat(_roleRoster);
                    }
                    const opts = ['<option value="">— 未指派 · Unassigned —</option>']
                        .concat(optionUsers.map(u => `<option value="${u.id}" ${String(u.id) === curId ? 'selected' : ''}>${esc(u.full_name || '')}</option>`))
                        .join('');
                    return `<div class="info-row"><span class="info-label">${rd.label}:</span> <select class="form-control" style="max-width:240px;flex:0 1 240px;" onchange="app.saveEventRole(${activity.event_id}, '${rd.key}', this.value, this.options[this.selectedIndex].text)">${opts}</select></div>`;
                }).join('');
                rolesSection = `
                <div class="detail-section">
                    <h4>活动负责人 <span style="font-size:11px;color:#9CA3AF;font-weight:400;">Event Roles</span></h4>
                    ${_roleRows}
                </div>`;
            }

            attendeeHtml = prospectSection + agentSection + rolesSection;
        }

        // Resolve consultant + lead agent names in parallel before we build
        // the template. Previously these were awaited sequentially inside the
        // template literal, forcing two serial network round-trips on cold
        // cache. With SWR now backing getById, both resolve synchronously
        // when the localStorage snapshot has the users; when it doesn't,
        // Promise.all overlaps the two requests.
        // Consultant defaults to whoever created the appointment (the lead agent),
        // unless one or more consultants were explicitly chosen in the consultant
        // picker (activity.consultants). Previously this derived from the linked
        // prospect/customer's responsible agent, so an appointment whose contact
        // had no responsible agent — or whose contact didn't resolve (Entity shows
        // "Unknown") — rendered "❌ Not Assigned" even though it has a creator.
        const _assignedConsultants = Array.isArray(activity.consultants)
            ? activity.consultants.filter(c => c && c.id != null)
            : [];
        const _consultantId = _assignedConsultants.length
            ? _assignedConsultants[0].id
            : (activity.lead_agent_id || null);
        const [_consultantName, _leadAgentName] = await Promise.all([
            _assignedConsultants.length
                ? Promise.resolve(_assignedConsultants.map(c => c.name).filter(Boolean).join(', ')
                    || (await getAgentName(_assignedConsultants[0].id)))
                : (_consultantId ? getAgentName(_consultantId) : Promise.resolve(null)),
            activity.activity_type !== 'EVENT' && activity.lead_agent_id
                ? getAgentName(activity.lead_agent_id)
                : Promise.resolve(''),
        ]);

        // Inline "open profile" icon next to the Entity row so the user can jump
        // straight to the prospect/customer profile (and read the saved meeting
        // notes) without first hunting in the Actions strip. When the entity is
        // orphaned (deleted prospect/customer) the same slot becomes a yellow
        // "Repair Link" pill — clear visual cue that the link is broken AND
        // a one-tap fix.
        const _entityActionId = activity.prospect_id || activity.customer_id;
        const _entityIsProspect = !!activity.prospect_id;
        const _entityProfileFn = _entityIsProspect ? 'showProspectDetail' : 'showCustomerDetail';
        const _entityIconBtn = (_canSeeEntity && _entityActionId)
            ? (entityOrphaned
                ? `<button title="Relink this activity to a contact" style="margin-left:8px; height:26px; padding:0 10px; border-radius:13px; border:1px solid #f59e0b; background:#fef3c7; color:#92400e; cursor:pointer; display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:600;" onclick="event.stopPropagation();(async()=>{ await app.openActivityRepairModal(${activity.id}); })()"><i class="fas fa-link"></i> Repair</button>`
                : `<button title="Open ${_entityIsProspect ? 'prospect' : 'customer'} profile" style="margin-left:8px; width:26px; height:26px; border-radius:50%; border:none; background:#dbeafe; color:#1e40af; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; font-size:13px;" onclick="event.stopPropagation();(async()=>{ const p=await AppDataStore.getById('${_entityIsProspect ? 'prospects' : 'customers'}', ${_entityActionId}); if(!p){UI.toast.error('${_entityIsProspect ? 'Prospect' : 'Customer'} record not found'); return;} UI.hideModal(); app.${_entityProfileFn}(${_entityActionId}); })()"><i class="fas fa-user-circle"></i></button>`)
            : '';

        const content = buildActivityDetailsContent(activity, marketingEvent, _isOwnActivity, _canSeeEntity, entityName, _entityIconBtn, _consultantId, _consultantName, _leadAgentName, attendeeHtml, isAttendeeType, entityOrphaned, activityId);

        UI.showModal('Activity Details', content, []);
    };

    // ========== ORPHAN ACTIVITY REPAIR ==========
    // Activities can outlive their linked prospect/customer (manual delete,
    // dedup cleanup, conversion that didn't migrate the FK). The repair modal
    // lets a user relink the activity to an existing prospect/customer or
    // detach the broken FK entirely — no SQL required.
    const openActivityRepairModal = async (activityId) => {
        const activity = await _lookupActivityRobust(activityId);
        if (!activity) { UI.toast.error('Activity not found'); return; }

        const brokenId = activity.prospect_id || activity.customer_id;
        const brokenKind = activity.prospect_id ? 'Prospect' : (activity.customer_id ? 'Customer' : 'Entity');

        const content = `
            <div style="display:flex; flex-direction:column; gap:14px;">
                <div style="padding:10px 12px; background:#fef3c7; border:1px solid #f59e0b; border-radius:6px; font-size:13px; color:#92400e;">
                    <i class="fas fa-exclamation-triangle" style="margin-right:6px;"></i>
                    This activity points at <strong>${brokenKind} #${brokenId}</strong>, which no longer exists.
                    Pick a contact below to relink, or detach the link entirely.
                </div>
                <div>
                    <label style="display:block; font-size:13px; color:var(--gray-600); margin-bottom:4px;">Search prospects &amp; customers</label>
                    <input type="text" id="repair-search-input" class="form-control" placeholder="Name or phone…" autocomplete="off" oninput="app.repairSearchEntities(this.value, ${activityId})">
                    <div id="repair-search-results" style="margin-top:8px; max-height:280px; overflow:auto;">
                        <div style="padding:10px; color:#9CA3AF; font-size:12px;">Type 2 or more characters…</div>
                    </div>
                </div>
            </div>
        `;

        UI.showModal('Repair Activity Link', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: '<i class="fas fa-unlink"></i> Detach (Leave Unlinked)', type: 'secondary', action: `(async () => { await app.repairActivityDetach(${activityId}); })()` },
        ]);
        setTimeout(() => document.getElementById('repair-search-input')?.focus(), 60);
    };

    const repairSearchEntities = async (term, activityId) => {
        const resultsDiv = document.getElementById('repair-search-results');
        if (!resultsDiv) return;
        const q = (term || '').trim();
        if (q.length < 2) {
            resultsDiv.innerHTML = '<div style="padding:10px; color:#9CA3AF; font-size:12px;">Type 2 or more characters…</div>';
            return;
        }
        // Debounce — coalesce keystrokes so we don't fire on every character.
        if (window._repairSearchTimer) clearTimeout(window._repairSearchTimer);
        if (typeof window._repairSearchSeq !== 'number') window._repairSearchSeq = 0;
        window._repairSearchSeq += 1;
        const seq = window._repairSearchSeq;
        resultsDiv.innerHTML = '<div style="padding:10px; color:#6b7280; font-size:12px;"><i class="fas fa-circle-notch fa-spin" style="margin-right:6px;"></i>Searching…</div>';

        window._repairSearchTimer = setTimeout(async () => {
            try {
                const [prospects, customers] = await Promise.all([
                    AppDataStore.searchProspects(q, { limit: 10, includeDormant: true }).catch(() => []),
                    AppDataStore.searchCustomers(q, { limit: 10 }).catch(() => []),
                ]);
                if (seq !== window._repairSearchSeq) return;
                const items = [
                    ...(prospects || []).map(p => ({ ...p, _kind: 'prospect' })),
                    ...(customers || []).map(c => ({ ...c, _kind: 'customer' })),
                ];
                if (items.length === 0) {
                    resultsDiv.innerHTML = '<div style="padding:10px; color:#9CA3AF; font-size:12px;">No matches.</div>';
                    return;
                }
                resultsDiv.innerHTML = items.map(p => {
                    const badgeBg = p._kind === 'prospect' ? '#dbeafe' : '#dcfce7';
                    const badgeColor = p._kind === 'prospect' ? '#1e40af' : '#166534';
                    return `<div style="padding:8px 12px; border:1px solid #eee; border-radius:6px; cursor:pointer; margin-bottom:6px; background:#fff;" onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background='#fff'" onclick="app.repairActivityRelink(${activityId}, ${p.id}, '${p._kind}')">
                        <strong>${escapeHtml(p.full_name || '(No Name)')}</strong>
                        <span style="font-size:11px; margin-left:6px; padding:1px 8px; border-radius:10px; background:${badgeBg}; color:${badgeColor};">${p._kind}</span>
                        <div style="font-size:11px; color:gray; margin-top:2px;">${escapeHtml(p.phone || '—')}</div>
                    </div>`;
                }).join('');
            } catch (e) {
                if (seq !== window._repairSearchSeq) return;
                resultsDiv.innerHTML = '<div style="padding:10px; color:#b91c1c; font-size:12px;">Search failed.</div>';
            }
        }, 220);
    };

    const repairActivityRelink = async (activityId, newId, kind) => {
        try {
            const patch = kind === 'prospect'
                ? { prospect_id: newId, customer_id: null }
                : { customer_id: newId, prospect_id: null };
            await AppDataStore.update('activities', activityId, patch);
            UI.hideModal();
            UI.toast.success(`Activity relinked to ${kind}.`);
            // Re-open the detail view so the user immediately sees the fixed state.
            setTimeout(() => { try { app.viewActivityDetails(activityId); } catch (_) { /* intentional: best-effort detail re-open */ } }, 200);
        } catch (e) {
            UI.toast.error('Relink failed: ' + (e.message || e));
        }
    };

    const repairActivityDetach = async (activityId) => {
        if (!confirm('Remove the broken entity link from this activity?\n\nThe activity will remain on the calendar but will no longer point at a prospect or customer.')) return;
        try {
            await AppDataStore.update('activities', activityId, { prospect_id: null, customer_id: null });
            UI.hideModal();
            UI.toast.success('Activity detached.');
            setTimeout(() => { try { app.viewActivityDetails(activityId); } catch (_) { /* intentional: best-effort detail re-open */ } }, 200);
        } catch (e) {
            UI.toast.error('Detach failed: ' + (e.message || e));
        }
    };

    // ========== MEETING LIVE NOTES (QUICK CAPTURE) ==========

    const _MC_CONFIG = {
        CPS: {
            label: 'CPS 咨询',
            buttons: [
                { emoji: '🎯', label: 'Goals 目标',      key: 'goals',       outcome: false, next: false },
                { emoji: '💼', label: 'Situation 现状',   key: 'situation',   outcome: false, next: false },
                { emoji: '📦', label: 'Product 产品',     key: 'product',     outcome: false, next: false },
                { emoji: '❓', label: 'Concern 疑虑',     key: 'concern',     outcome: false, next: false },
                { emoji: '🚫', label: 'Objection 反对',   key: 'objection',   outcome: false, next: false },
                { emoji: '✅', label: 'Decision 决定',    key: 'decision',    outcome: true,  next: false },
                { emoji: '📅', label: 'Next Action 跟进', key: 'next_action', outcome: false, next: true  },
            ],
        },
        FTF: {
            label: 'FTF 会面',
            buttons: [
                { emoji: '🎯', label: 'Purpose 目的',   key: 'purpose',    outcome: false, next: false },
                { emoji: '💬', label: 'Discussion 讨论', key: 'discussion', outcome: false, next: false },
                { emoji: '📦', label: 'Product 产品',    key: 'product',    outcome: false, next: false },
                { emoji: '😊', label: 'Response 反应',   key: 'response',   outcome: false, next: false },
                { emoji: '✅', label: 'Outcome 结果',    key: 'outcome',    outcome: true,  next: false },
                { emoji: '📅', label: 'Follow-up 跟进',  key: 'followup',   outcome: false, next: true  },
            ],
        },
        GR: {
            label: 'Golden Road',
            buttons: [
                { emoji: '💰', label: 'Financial Goal 财务目标', key: 'fin_goal',  outcome: false, next: false },
                { emoji: '⚖️', label: 'Risk Profile 风险',       key: 'risk',      outcome: false, next: false },
                { emoji: '📦', label: 'Product Match 产品',       key: 'product',   outcome: false, next: false },
                { emoji: '❓', label: 'Concern 疑虑',             key: 'concern',   outcome: false, next: false },
                { emoji: '✅', label: 'Decision 决定',            key: 'decision',  outcome: true,  next: false },
                { emoji: '📅', label: 'Next Step 下步',           key: 'next_step', outcome: false, next: true  },
            ],
        },
        XG: {
            label: 'Xin Gua 星卦',
            buttons: [
                { emoji: '🔮', label: 'Focus 分析重点',      key: 'focus',          outcome: false, next: false },
                { emoji: '💡', label: 'Finding 发现',         key: 'finding',        outcome: true,  next: false },
                { emoji: '📋', label: 'Recommendation 建议',  key: 'recommendation', outcome: true,  next: false },
                { emoji: '😊', label: 'Reaction 反应',        key: 'reaction',       outcome: false, next: false },
                { emoji: '📅', label: 'Action Plan 行动',     key: 'action_plan',    outcome: false, next: true  },
            ],
        },
        AGENT_TRAINING: {
            label: 'Agent Training 培训',
            buttons: [
                { emoji: '📚', label: 'Topic 主题',       key: 'topic',       outcome: false, next: false },
                { emoji: '🛠', label: 'Skills 技能',      key: 'skills',      outcome: false, next: false },
                { emoji: '📊', label: 'Performance 表现', key: 'performance', outcome: true,  next: false },
                { emoji: '⬆', label: 'Improve 改进',     key: 'improve',     outcome: false, next: true  },
                { emoji: '🎯', label: 'Next Focus 重点',  key: 'next_focus',  outcome: false, next: true  },
            ],
        },
    };

    let _mcState = null;
    // Reentrancy guard for openMeetingCapture: it awaits a network lookup BEFORE assigning
    // _mcState / appending the overlay, so a double-tap could spawn two overlays + two 1s
    // intervals + an orphaned wakeLock. This flag closes that window.
    let _mcOpening = false;

    const _mcElapsed = () => {
        if (!_mcState) return '00:00:00';
        const s = Math.floor((Date.now() - _mcState.startTime) / 1000);
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    };

    const _mcTimestamp = () => {
        const now = new Date();
        return `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    };

    const _mcRenderLog = () => {
        const logEl = document.getElementById('mc-log');
        if (!logEl || !_mcState) return;
        if (!_mcState.items.length) {
            logEl.innerHTML = '<div style="color:#94a3b8;text-align:center;padding:30px;font-size:13px;">Tap a button above to capture a note</div>';
            return;
        }
        logEl.innerHTML = _mcState.items.map((it, i) => `
            <div style="display:flex;align-items:flex-start;gap:8px;padding:10px 14px;border-bottom:1px solid #f1f5f9;">
                <div style="font-size:18px;line-height:1.4;">${it.emoji}</div>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:11px;color:#64748b;font-weight:600;">${it.time} · ${it.label}</div>
                    <div style="font-size:13px;color:#1e293b;margin-top:2px;word-break:break-word;">${esc(it.text)}</div>
                </div>
                <button onclick="app.mcRemoveItem(${i})" style="background:none;border:none;color:#cbd5e1;cursor:pointer;font-size:16px;padding:0 4px;flex-shrink:0;">✕</button>
            </div>
        `).join('');
    };

    const openMeetingCapture = async (activityId) => {
        // Refuse re-entry: a session is already open/opening, or a stray overlay exists.
        if (_mcOpening || _mcState || document.getElementById('mc-overlay')) return;
        _mcOpening = true;
        let activity;
        try {
            activity = await _lookupActivityRobust(activityId);
        } finally {
            _mcOpening = false;
        }
        if (!activity) { UI.toast.error('Activity not found'); return; }
        // Another invocation may have won the race while we awaited the lookup.
        if (_mcState || document.getElementById('mc-overlay')) return;
        const config = _MC_CONFIG[activity.activity_type];
        if (!config) { UI.toast.error('Live Notes not available for this activity type'); return; }

        _mcState = { activityId, config, items: [], startTime: Date.now(), timerInterval: null, micOn: false, recognition: null, activeBtn: null };

        const overlay = document.createElement('div');
        overlay.id = 'mc-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:#f8fafc;z-index:9999;display:flex;flex-direction:column;overflow:hidden;font-family:inherit;';
        overlay.innerHTML = `
            <div style="background:#7f1d1d;color:#fff;padding:12px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0;">
                <button onclick="app.closeMeetingCapture()" style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:34px;height:34px;border-radius:50%;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;">✕</button>
                <div style="flex:1;">
                    <div style="font-weight:700;font-size:15px;">📝 Live Notes</div>
                    <div style="font-size:12px;opacity:0.8;">${config.label}</div>
                </div>
                <div id="mc-timer" style="font-size:13px;font-variant-numeric:tabular-nums;background:rgba(0,0,0,0.25);padding:4px 12px;border-radius:20px;letter-spacing:0.05em;">00:00:00</div>
            </div>

            <div style="padding:12px 16px;border-bottom:1px solid #e2e8f0;flex-shrink:0;background:#fff;">
                <div style="font-size:11px;font-weight:700;color:#64748b;letter-spacing:0.06em;margin-bottom:8px;">QUICK CAPTURE</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                    ${config.buttons.map(b => `
                        <button id="mc-btn-${b.key}" onclick="app.mcSelectCategory('${b.key}','${b.label.replace(/'/g,"\\'")}','${b.emoji}')"
                            style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:20px;padding:7px 13px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:5px;transition:all 0.15s;white-space:nowrap;">
                            <span>${b.emoji}</span><span style="font-weight:500;">${b.label}</span>
                        </button>
                    `).join('')}
                </div>
            </div>

            <div id="mc-input-area" style="padding:10px 16px;border-bottom:1px solid #e2e8f0;flex-shrink:0;display:none;background:#fffbeb;">
                <div id="mc-input-label" style="font-size:11px;font-weight:700;color:#7f1d1d;margin-bottom:6px;"></div>
                <div style="display:flex;gap:8px;align-items:flex-end;">
                    <textarea id="mc-text-input" rows="2" placeholder="Type your note here..."
                        style="flex:1;border:1.5px solid #cbd5e1;border-radius:8px;padding:8px;font-size:13px;resize:none;outline:none;font-family:inherit;line-height:1.5;"
                        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();app.mcAddItem();}"></textarea>
                    <button onclick="app.mcAddItem()"
                        style="background:#7f1d1d;color:#fff;border:none;border-radius:8px;padding:10px 16px;cursor:pointer;font-size:20px;font-weight:700;flex-shrink:0;line-height:1;">+</button>
                </div>
                <div style="display:flex;align-items:center;gap:8px;margin-top:7px;">
                    <button id="mc-mic-btn" onclick="app.mcToggleMic()"
                        style="background:#f1f5f9;border:1.5px solid #e2e8f0;border-radius:16px;padding:4px 12px;cursor:pointer;font-size:11px;display:flex;align-items:center;gap:4px;transition:all 0.2s;">
                        🎤 <span id="mc-mic-label">Mic Off</span>
                    </button>
                    <span style="font-size:10px;color:#94a3b8;">Voice → input only, never saved to server</span>
                </div>
            </div>

            <div id="mc-log" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;">
                <div style="color:#94a3b8;text-align:center;padding:30px;font-size:13px;">Tap a button above to capture a note</div>
            </div>

            <div style="padding:12px 16px;border-top:2px solid #e2e8f0;background:#fff;flex-shrink:0;">
                <div id="mc-count" style="text-align:center;font-size:12px;color:#64748b;margin-bottom:8px;">0 notes captured</div>
                <button onclick="(async()=>{ await app.endMeetingCapture(${activityId}); })()"
                    style="width:100%;background:#7f1d1d;color:#fff;border:none;border-radius:10px;padding:14px;font-size:15px;font-weight:700;cursor:pointer;letter-spacing:0.02em;">
                    ✅ End & Save Notes
                </button>
            </div>
        `;
        document.body.appendChild(overlay);

        _mcState.timerInterval = setInterval(() => {
            const el = document.getElementById('mc-timer');
            if (el) el.textContent = _mcElapsed();
        }, 1000);

        try { _mcState.wakeLock = await navigator.wakeLock.request('screen'); } catch(_) { /* intentional: wakeLock optional API, best-effort */ }
    };

    const closeMeetingCapture = () => {
        if (_mcState) {
            clearInterval(_mcState.timerInterval);
            if (_mcState.recognition) { try { _mcState.recognition.stop(); } catch(_) { /* intentional: best-effort cleanup */ } }
            try { _mcState.wakeLock?.release(); } catch(_) { /* intentional: best-effort cleanup */ }
            _mcState = null;
        }
        document.getElementById('mc-overlay')?.remove();
    };

    const mcSelectCategory = (key, label, emoji) => {
        if (!_mcState) return;
        _mcState.activeBtn = { key, label, emoji };

        // Reset all buttons then highlight active
        _mcState.config.buttons.forEach(b => {
            const el = document.getElementById(`mc-btn-${b.key}`);
            if (el) { el.style.background = '#f8fafc'; el.style.color = '#374151'; el.style.borderColor = '#e2e8f0'; }
        });
        const activeEl = document.getElementById(`mc-btn-${key}`);
        if (activeEl) { activeEl.style.background = '#7f1d1d'; activeEl.style.color = '#fff'; activeEl.style.borderColor = '#7f1d1d'; }

        const area = document.getElementById('mc-input-area');
        const labelEl = document.getElementById('mc-input-label');
        const input = document.getElementById('mc-text-input');
        if (area) area.style.display = 'block';
        if (labelEl) labelEl.textContent = `${emoji} ${label}`;
        if (input) { input.value = ''; input.focus(); }
    };

    const mcAddItem = () => {
        if (!_mcState || !_mcState.activeBtn) { UI.toast.error('Select a category first'); return; }
        const input = document.getElementById('mc-text-input');
        const text = (input?.value || '').trim().replace(/\[…[^\]]*\]$/, '').trim();
        if (!text) { UI.toast.error('Please enter a note'); return; }

        const btn = _mcState.config.buttons.find(b => b.key === _mcState.activeBtn.key);
        _mcState.items.push({
            key:       _mcState.activeBtn.key,
            label:     _mcState.activeBtn.label,
            emoji:     _mcState.activeBtn.emoji,
            text,
            time:      _mcTimestamp(),
            isOutcome: btn?.outcome || false,
            isNext:    btn?.next    || false,
        });

        if (input) input.value = '';
        _mcRenderLog();
        const log = document.getElementById('mc-log');
        if (log) log.scrollTop = log.scrollHeight;
        const countEl = document.getElementById('mc-count');
        if (countEl) countEl.textContent = `${_mcState.items.length} note${_mcState.items.length === 1 ? '' : 's'} captured`;
    };

    const mcRemoveItem = (index) => {
        if (!_mcState) return;
        _mcState.items.splice(index, 1);
        _mcRenderLog();
        const countEl = document.getElementById('mc-count');
        if (countEl) countEl.textContent = `${_mcState.items.length} note${_mcState.items.length === 1 ? '' : 's'} captured`;
    };

    const mcToggleMic = () => {
        if (!_mcState) return;
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { UI.toast.error('Speech recognition not supported in this browser'); return; }

        if (_mcState.micOn) {
            try { _mcState.recognition?.stop(); } catch(_) { /* intentional: best-effort mic stop */ }
            _mcState.micOn = false;
            _mcState.recognition = null;
            const btn = document.getElementById('mc-mic-btn');
            const lbl = document.getElementById('mc-mic-label');
            if (btn) { btn.style.background = '#f1f5f9'; btn.style.borderColor = '#e2e8f0'; btn.style.color = '#374151'; }
            if (lbl) lbl.textContent = 'Mic Off';
            return;
        }

        const recog = new SR();
        recog.continuous = true;
        recog.interimResults = true;
        recog.lang = 'zh';
        recog.onresult = (e) => {
            const input = document.getElementById('mc-text-input');
            if (!input) return;
            let finalText = '', interimText = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
                else interimText += e.results[i][0].transcript;
            }
            if (finalText) {
                input.value = (input.value.replace(/\[…[^\]]*\]$/, '') + finalText).trim();
            } else if (interimText) {
                input.value = input.value.replace(/\[…[^\]]*\]$/, '') + `[…${interimText}]`;
            }
        };
        recog.onend = () => {
            // Auto-restart so 90-min sessions don't cut off
            if (_mcState?.micOn) { try { recog.start(); } catch(_) { /* intentional: best-effort mic auto-restart */ } }
        };
        recog.onerror = (e) => {
            if (e.error !== 'no-speech') UI.toast.error('Mic: ' + e.error);
        };

        try {
            recog.start();
            _mcState.micOn = true;
            _mcState.recognition = recog;
            const btn = document.getElementById('mc-mic-btn');
            const lbl = document.getElementById('mc-mic-label');
            if (btn) { btn.style.background = '#dcfce7'; btn.style.borderColor = '#16a34a'; btn.style.color = '#166534'; }
            if (lbl) lbl.textContent = 'Mic On 🔴';
        } catch(e) {
            UI.toast.error('Could not start microphone: ' + (e.message || e));
        }
    };

    const endMeetingCapture = async (activityId) => {
        if (!_mcState) return;
        if (!_mcState.items.length) { UI.toast.error('No notes captured yet — tap a category button to add notes'); return; }

        const { items, config } = _mcState;
        const dateStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
        const elapsed = _mcElapsed();

        const keyPoints  = `[Live Notes · ${config.label} · ${dateStr} · ${elapsed}]\n` +
            items.map(it => `${it.time}  ${it.emoji} ${it.label}: ${it.text}`).join('\n');
        const outcome    = items.filter(it => it.isOutcome).map(it => `${it.emoji} ${it.label}: ${it.text}`).join('\n');
        const nextSteps  = items.filter(it => it.isNext   ).map(it => `${it.emoji} ${it.label}: ${it.text}`).join('\n');

        try {
            const existing = await AppDataStore.getById('activities', activityId) || {};
            await AppDataStore.update('activities', activityId, {
                note_key_points: [existing.note_key_points, keyPoints].filter(Boolean).join('\n\n---\n\n'),
                note_outcome:    [existing.note_outcome,    outcome  ].filter(Boolean).join('\n'),
                note_next_steps: [existing.note_next_steps, nextSteps].filter(Boolean).join('\n'),
            });
            const n = items.length;
            UI.toast.success(`${n} note${n === 1 ? '' : 's'} saved ✓`);
            closeMeetingCapture();
            if (document.querySelector('.calendar-view-container')) renderCalendar().catch(() => {});
        } catch(e) {
            UI.toast.error('Could not save notes: ' + (e.message || 'Unknown error'));
        }
    };

    // ========== END MEETING LIVE NOTES ==========

    const uploadCPSForm = (activityId, prospectId) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,application/pdf';
        input.style.display = 'none';
        document.body.appendChild(input);
        input.onchange = async () => {
            const file = input.files[0];
            document.body.removeChild(input);
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) {
                UI.toast.error('File too large (max 5 MB)');
                return;
            }
            // Run upload and OCR in PARALLEL so the user only waits once.
            // Upload always happens silently. OCR result triggers the review
            // modal if any extractable fields differ from the existing prospect.
            const uploadPromise = (window.app._uploadCpsFormFile || (() => Promise.resolve(null)))(file, prospectId)
                .then(url => {
                    if (url) UI.toast.success('CPS form uploaded to prospect profile');
                    else UI.toast.error('Upload failed — please retry');
                });
            // OCR only if it's an image — PDFs we send too (Gemini supports both)
            _scanAndApplyToProspect(file, prospectId).catch(err => {
                console.warn('OCR autofill skipped:', err);
            });
            await uploadPromise;
        };
        input.oncancel = () => document.body.removeChild(input);
        input.click();
    };

    // OCR a CPS form photo and open the review modal scoped to an EXISTING
    // prospect record. Applies picked fields directly via AppDataStore.update.
    // Used by the "Upload CPS" Actions-panel button.
    const _scanAndApplyToProspect = async (file, prospectId) => {
        // Show OCR-only spinner on top of any open view
        (window.app._showCpsScanOverlay || (() => {}))('Reading Form…', `
            <div style="text-align:center; padding:20px 0;">
                <i class="fas fa-spinner fa-spin" style="font-size:36px; color:#7c3aed; margin-bottom:14px;"></i>
                <p style="color:var(--gray-600); margin:0;">Reading the form, please wait…</p>
                <p style="color:var(--gray-400); font-size:12px; margin-top:6px;">(usually 3–6 seconds)</p>
            </div>
        `);

        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('Could not read file'));
                reader.readAsDataURL(file);
            });
            const [meta, b64] = String(dataUrl).split(',');
            const mime = (meta.match(/data:(.*?);base64/) || [])[1] || file.type || 'image/jpeg';

            if (!window.supabase || !window.supabase.functions) {
                throw new Error('Supabase client not available');
            }
            const { data: res, error } = await window.supabase.functions.invoke('cps-form-ocr', {
                body: { image_base64: b64, mime_type: mime },
            });
            if (error) throw new Error(error.message || 'OCR call failed');
            if (!res || res.ok === false) throw new Error(res?.detail || res?.error || 'OCR failed');

            // Snapshot existing prospect values for the diff.
            // CPS_SCAN_FIELD_MAP is declared const INSIDE the cps chunk's IIFE and is
            // NOT on window, so referencing it here threw ReferenceError and the
            // review modal never opened. Build `current` from a local scannedKey→dbColumn
            // map (mirrors the cps chunk's map columns [0] and [3]) so the diff snapshot
            // keys line up with the keys renderCpsScanReview reads.
            const prospect = await AppDataStore.getById('prospects', prospectId);
            const _cpsScanKeyToDbCol = {
                name: 'full_name', gender: 'gender', dob_solar: 'date_of_birth',
                dob_lunar: 'lunar_birth', phone: 'phone', occupation: 'occupation',
                email: 'email', address: 'address', marital_status: 'marital_status',
            };
            const current = {};
            Object.entries(_cpsScanKeyToDbCol).forEach(([key, dbCol]) => {
                current[key] = prospect?.[dbCol] != null ? String(prospect[dbCol]) : '';
            });

            // The CPS-scan review state lives in the cps chunk (module-local
            // `_cpsScanCache`). The old bare `_cpsScanCache = {...}` here created
            // a leaked implicit GLOBAL that renderCpsScanReview never reads —
            // breaking this flow cross-chunk. Hand the payload to the cps chunk's
            // setter so it populates its own state before rendering the review.
            (window.app._setCpsScanCache || (() => {}))({
                prefix: '__prospect_row__',     // sentinel: write to DB not DOM
                prospectId,
                scanned: res.fields || {},
                confidence: res.confidence || {},
                current,
                rawText: res.raw_text || '',
            });
            (window.app.renderCpsScanReview || (() => {}))();
        } catch (err) {
            (window.app._hideCpsScanOverlay || (() => {}))();
            console.warn('OCR failed for Upload CPS:', err);
            UI.toast.info('Photo saved. Could not auto-read fields — please edit manually.');
        }
    };

    const editActivityTiming = async (activityId) => {
        const activity = await _lookupActivityRobust(activityId);
        if (!activity) { UI.toast.error('Activity not found'); return; }
        const venues = await AppDataStore.getAll('venues').catch(() => []);
        const venueRequiredTypes = ['CPS','FTF','EVENT','GR','XG'];
        const venueRequired = venueRequiredTypes.includes(activity.activity_type);
        // Pre-populate co-agent state from this activity so the shared add/edit helpers
        // (toggleCoAgentSection, searchAgents, renderCoAgents) operate on the right list.
        _state.sca = Array.isArray(activity.co_agents) ? activity.co_agents.map(a => ({ ...a })) : [];
        const hasCoAgents = _state.sca.length > 0;
        UI.showModal('Edit Appointment Timing', `
            <div class="form-group">
                <label>Date</label>
                <input type="date" id="edit-timing-date" class="form-control" value="${activity.activity_date || ''}">
            </div>
            <div class="form-row">
                <div class="form-group half">
                    <label>Start Time</label>
                    <input type="time" id="edit-timing-start" class="form-control" value="${activity.start_time || ''}" onchange="app.autoSetEndTime()">
                </div>
                <div class="form-group half">
                    <label>End Time</label>
                    <input type="time" id="edit-timing-end" class="form-control" value="${activity.end_time || ''}" data-manual="false" onchange="this.dataset.manual='true'">
                </div>
            </div>
            <div class="form-group">
                <label>Venue${venueRequired ? ' <span class="required">*</span>' : ''}</label>
                <select id="edit-timing-venue" class="form-control">
                    <option value="">-- Select Venue --</option>
                    ${venues.sort((a, b) => (a.sequence || 0) - (b.sequence || 0)).map(v => `<option value="${esc(v.name + ' | ' + v.location)}" ${activity.venue === v.name + ' | ' + v.location ? 'selected' : ''}>${esc(v.name + ' | ' + v.location)}</option>`).join('')}
                </select>
            </div>
            <div class="form-section">
                <h4>👥 Co-Agent Assignment</h4>
                <div class="form-group">
                    <label class="toggle-switch">
                        <input type="checkbox" id="allow-join" ${hasCoAgents ? 'checked' : ''} onchange="app.toggleCoAgentSection()">
                        <span class="toggle-label">Allow Join</span>
                    </label>
                </div>
            </div>
            <div id="co-agent-section" style="display: ${hasCoAgents ? 'block' : 'none'}; background: #f0fdfa; padding: 12px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #ccfbf1;">
                <div class="form-group">
                    <label>Search and Add Co-Agents</label>
                    <div class="co-agent-search" style="position:relative;">
                        <input type="text" id="co-agent-search-input" class="form-control" placeholder="Type consultant name..." onkeyup="app.debounceCall('co-agent-search', () => app.searchAgents(), 250)">
                        <div id="agent-search-results" class="search-results-dropdown"></div>
                    </div>
                </div>
                <div id="selected-co-agents" class="co-agent-list"></div>
                <p class="help-text">Maximum 5 co-agents. They will receive calendar invitations.</p>
            </div>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save', type: 'primary', action: `(async () => { await app.saveActivityTiming(${activityId}); })()` }
        ]);
        // Render any pre-existing co-agents into the newly mounted #selected-co-agents container.
        setTimeout(() => { (window.app.renderCoAgents || (() => {}))(); }, 50);
    };

    const autoSetEndTime = () => {
        const endInput = document.getElementById('edit-timing-end');
        if (!endInput || endInput.dataset.manual === 'true') return;
        const startVal = document.getElementById('edit-timing-start')?.value;
        if (!startVal) return;
        const [h, m] = startVal.split(':').map(Number);
        const endH = (h + 1) % 24;
        endInput.value = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    const saveActivityTiming = async (activityId) => {
        const date = document.getElementById('edit-timing-date')?.value;
        const start = document.getElementById('edit-timing-start')?.value;
        const end = document.getElementById('edit-timing-end')?.value;
        const venue = document.getElementById('edit-timing-venue')?.value || '';
        if (!date || !start || !end) { UI.toast.error('Please fill in all timing fields'); return; }
        // Only persist co_agents when the Allow Join toggle is present in this modal —
        // that way this helper stays safe if another caller ever reuses it.
        const allowJoinEl = document.getElementById('allow-join');
        const updates = { activity_date: date, start_time: start, end_time: end, venue };
        // Snapshot the existing co-agents so we can compute the delta (who was added this turn)
        // and notify only them after the save lands. We do this BEFORE the update call so the
        // comparison isn't tainted by the freshly-saved row.
        const preSave = await AppDataStore.getById('activities', activityId);
        const oldCoAgentIds = new Set(
            Array.isArray(preSave?.co_agents)
                ? preSave.co_agents.map(ca => ca && ca.id != null && String(ca.id)).filter(Boolean)
                : []
        );
        if (allowJoinEl) {
            updates.co_agents = allowJoinEl.checked ? _state.sca : [];
        }
        // Mirror venue to location_address so it persists server-side (the `venue` column may
        // be missing from the Supabase schema and silently stripped on save). Only mirror when
        // the venue is non-empty so we don't clobber existing FSA/SITE site addresses.
        if (venue) updates.location_address = venue;
        let _localOnly = false;
        try {
            await AppDataStore.update('activities', activityId, updates);
        } catch (e) {
            // Fallback: update localStorage directly for local-only activities
            const key = 'fs_crm_activities';
            const all = JSON.parse(localStorage.getItem(key) || '[]');
            const idx = all.findIndex(r => r.id == activityId);
            if (idx >= 0) { all[idx] = { ...all[idx], ...updates }; localStorage.setItem(key, JSON.stringify(all)); _localOnly = true; }
            else { UI.toast.error('Could not save: ' + e.message); return; }
        }
        UI.hideModal();
        // Don't claim a successful save when the server never received the change.
        // The localStorage fallback is device-local: other users won't see the new
        // timing and a later server refresh can silently revert it — surface that.
        if (_localOnly) {
            (UI.toast.warning || UI.toast.error)('Saved on this device only — could not sync to the server. Other users won\'t see this change until it syncs.');
        } else {
            UI.toast.success('Appointment timing updated');
        }

        // Push-notify any newly-added co-agents (delta only, so existing ones aren't spammed).
        if (Array.isArray(updates.co_agents) && updates.co_agents.length > 0) {
            const newIds = updates.co_agents
                .map(ca => ca && ca.id != null && String(ca.id))
                .filter(id => id && !oldCoAgentIds.has(id));
            if (newIds.length > 0) {
                const savedSnapshot = { ...(preSave || {}), ...updates, id: activityId };
                _notifyCoAgentAdded(savedSnapshot, newIds).catch(() => {});
            }
        }

        if (document.querySelector('.calendar-view-container')) { await renderCalendar(); await renderTodayActivities(); }
    };

    const openPostMeetupModal = async (activityId, prospectId) => {
        // getById already does a targeted Supabase select + cache fallback;
        // scanning getAll() was a belt-and-braces extra that loaded the whole
        // prospects table on every post-meetup open. Drop the fallback.
        const prospect = await AppDataStore.getById('prospects', prospectId);
        const name = prospect?.full_name || 'Prospect';
        const notes = await AppDataStore.getAll('notes');
        const existing_outcome = notes.find(n => n.activity_id == activityId && n.note_type === 'outcome' && n.prospect_id == prospectId);
        const existing_postmtup = notes.find(n => n.activity_id == activityId && n.note_type === 'post_meetup' && n.prospect_id == prospectId);
        UI.showModal(`📝 Post MtUp — ${esc(name)}`, `
            <div class="form-group">
                <label><strong>📝 Meeting Outcome</strong></label>
                <textarea id="post-mtup-outcome" class="form-control" rows="3" placeholder="Outcome of this meeting...">${esc(existing_outcome?.text || '')}</textarea>
            </div>
            <div class="form-group" style="margin-top:12px;">
                <label><strong>📝 Post-Meetup Notes</strong></label>
                <textarea id="post-mtup-notes" class="form-control" rows="3" placeholder="Key points, next steps, follow-up actions...">${esc(existing_postmtup?.text || '')}</textarea>
            </div>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save', type: 'primary', action: `(async () => { await app.savePostMeetup(${activityId}, ${prospectId}); })()` }
        ]);
    };

    const savePostMeetup = async (activityId, prospectId) => {
        try {
        const outcomeText = document.getElementById('post-mtup-outcome')?.value?.trim();
        const notesText = document.getElementById('post-mtup-notes')?.value?.trim();
        const agentName = _state.cu?.full_name || 'Agent';
        const today = new Date().toISOString().split('T')[0];
        const allNotes = await AppDataStore.getAll('notes');

        if (outcomeText) {
            const existing = allNotes.find(n => n.activity_id == activityId && n.note_type === 'outcome' && n.prospect_id == prospectId);
            if (existing) {
                await AppDataStore.update('notes', existing.id, { text: outcomeText });
            } else {
                await AppDataStore.create('notes', { activity_id: activityId, prospect_id: prospectId, note_type: 'outcome', text: outcomeText, author: agentName, date: today });
            }
        }
        if (notesText) {
            const existing = allNotes.find(n => n.activity_id == activityId && n.note_type === 'post_meetup' && n.prospect_id == prospectId);
            if (existing) {
                await AppDataStore.update('notes', existing.id, { text: notesText });
            } else {
                await AppDataStore.create('notes', { activity_id: activityId, prospect_id: prospectId, note_type: 'post_meetup', text: notesText, author: agentName, date: today });
            }
        }
        UI.hideModal();
        UI.toast.success('Post-meetup notes saved');
        } catch (err) {
            UI.toast.error('Failed to save notes: ' + (err?.message || 'Unknown error'));
        }

        // Navigate to prospect detail and open Potential & Opportunities + Next Actions
        if (prospectId) {
            await (window.app.showProspectDetail || (() => {}))(prospectId);
            // Wait for DOM to render, then expand and scroll to the two sections
            setTimeout(async () => {
                for (const tab of ['potential', 'nextactions']) {
                    const itemEl = document.getElementById(`acc-${tab}-${prospectId}`);
                    const bodyEl = document.getElementById(`acc-body-${tab}-${prospectId}`);
                    if (itemEl && bodyEl && !itemEl.classList.contains('open')) {
                        itemEl.classList.add('open');
                        bodyEl.style.display = 'block';
                        if (bodyEl.dataset.loaded === 'false') {
                            bodyEl.dataset.loaded = 'true';
                            await (window.app.switchProspectTab || (() => {}))(tab, prospectId, null, bodyEl);
                        }
                    }
                }
                // Scroll to Potential & Opportunities
                const potentialEl = document.getElementById(`acc-potential-${prospectId}`);
                if (potentialEl) potentialEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 400);
        }
    };

    const openMeetingOutcomeModal = async (activityId) => {
        // The Meeting Outcome body is built by buildMeetingOutcomeBlock(), which
        // lives in the activities chunk. On mobile that chunk isn't loaded when a
        // prospect activity is tapped, so the builder fell back to (() => '') and
        // the modal opened with an empty body. Load the chunk first.
        await _ensureActivitiesChunk();

        // Use the robust lookup so the Closing modal opens with the right data
        // even when the row is only reachable via the calendar hot cache / pin
        // board (consultant scope under RLS).
        const activity = (await _lookupActivityRobust(activityId)) || {};
        const products = (await AppDataStore.getAll('products')).filter(p => p.is_active !== false);

        // When linked to a prospect, prefill from closing_record → activity → prospect.
        // The shared builder handles the merging; we just hand it the raw rows.
        let prospect = null;
        let closingRecord = {};
        if (activity.prospect_id) {
            prospect = await AppDataStore.getById('prospects', activity.prospect_id);
            closingRecord = prospect?.closing_record || {};
        }

        const content = (window.app.buildMeetingOutcomeBlock || (() => ''))('mo', activity, { products, prospect, closingRecord });
        UI.showModal('📝 Meeting Outcome', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save', type: 'primary', action: `(async () => { await app.saveMeetingOutcome(${activityId}); })()` }
        ]);

        // Backup load of existing order-form photos — the inline <img onload> trick
        // in the closing block also triggers this, but if CSP blocks data URIs the
        // explicit call here still fires.
        if (activity.prospect_id) {
            setTimeout(() => {
                try { (window.app.loadOrderFormThumbnails || (() => {}))('mo', activity.prospect_id); } catch (e) { console.warn(e); }
            }, 0);
        }
    };

    const saveMeetingOutcome = async (activityId) => {
        // collectMeetingOutcomeData lives in the activities chunk — guarantee it's
        // loaded so the save doesn't silently no-op into empty data on mobile.
        await _ensureActivitiesChunk();

        // All DOM reads go through the shared collector so CPS/Prospect/
        // Standard Functions all see the same field set.
        const mo = (window.app.collectMeetingOutcomeData || (() => ({})))('mo');
        const isClosed = mo.is_closing;

        if (isClosed && (!mo.amount_closed || parseFloat(mo.amount_closed) <= 0)) {
            UI.toast.error('Please enter the Amount Closed (RM) — it is required to record a sales closing.');
            document.getElementById('mo-amount-closed')?.focus();
            return;
        }

        // NPO closings REQUIRE the installment terms (owner: this is what creates the
        // npo_sales order that feeds the PORT KPI). Unlike the old silent guard, we
        // scroll the NPO block into view and red-highlight the exact missing field(s)
        // so it's obvious on mobile why Save didn't go through (the toast alone was
        // easy to miss). The highlight clears as soon as the agent edits the field.
        if (isClosed && mo.payment_method === 'NPO') {
            const _np = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
            const checks = [
                ['mo-npo-tier-amount', (v) => v != null && v > 0,  mo.npo_tier_amount],
                ['mo-npo-first',       (v) => v != null && v >= 0, mo.npo_first_payment],
                ['mo-npo-monthly',     (v) => v != null && v >= 0, mo.npo_monthly],
                ['mo-npo-tenure',      (v) => v != null && v > 0,  mo.npo_tenure],
            ];
            const missing = checks.filter(([, ok, raw]) => !ok(_np(raw)));
            if (missing.length) {
                document.getElementById('mo-npo-fields')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                missing.forEach(([id]) => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    el.style.border = '2px solid #ef4444';
                    el.style.background = '#fff5f5';
                    const _clr = () => { el.style.border = ''; el.style.background = ''; el.removeEventListener('input', _clr); };
                    el.addEventListener('input', _clr);
                });
                document.getElementById(missing[0][0])?.focus();
                UI.toast.error('NPO needs Tier Amount, First Payment, Monthly Amount and Tenure (months) — highlighted in red.');
                return;
            }
            // Guard against a fat-finger tenure that would explode the schedule.
            if (_np(mo.npo_tenure) > 600) {
                const el = document.getElementById('mo-npo-tenure');
                if (el) { el.style.border = '2px solid #ef4444'; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); }
                UI.toast.error('Tenure looks too large — please enter the number of months (max 600).');
                return;
            }
        }

        // Credit-card installment: when the closer flags a POP/NPO installment as charged
        // to a credit card, the card expiry is compulsory — the office charges the card
        // monthly and must chase updated details before it lapses. Red-highlight the field
        // (matching the NPO guard above) so it's obvious on mobile why Save didn't go through.
        if (isClosed && (mo.payment_method === 'POP' || mo.payment_method === 'NPO') && mo.cc_installment) {
            if (!/^\d{4}-\d{2}$/.test(mo.cc_expiry || '')) {
                const el = document.getElementById('mo-cc-expiry');
                if (el) {
                    el.style.border = '2px solid #ef4444';
                    el.style.background = '#fff5f5';
                    const _clr = () => { el.style.border = ''; el.style.background = ''; el.removeEventListener('input', _clr); };
                    el.addEventListener('input', _clr);
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.focus();
                }
                UI.toast.error('Please enter the Credit Card Expiry (MM/YY) — required when the installment is charged to a credit card.');
                return;
            }
        }

        // Require an Order Form photo when closing — covers the 3 PREON templates.
        // Only enforced when the photo capture UI was rendered (i.e. linked to a prospect).
        if (isClosed && document.getElementById('mo-order-form-thumbs') && !(window.app.hasOrderFormPhoto || (() => false))('mo')) {
            UI.toast.error('Please attach the Order Form photo before saving the closing.');
            document.getElementById('mo-order-form-camera')?.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        // Upload the invoice file (if a new one was selected). The Meeting
        // Outcome modal previously only used the file for OCR auto-fill and
        // never persisted it — so users would upload an invoice, save the
        // outcome, then have no way to retrieve the file. Now we mirror the
        // closing-record-form upload path: push to Supabase storage, get a
        // public URL, then save it on the prospect's closing_record JSONB
        // so existing "View invoice" links throughout the profile pages
        // light up. (We don't write invoice_file directly on the activity
        // row — that column isn't in the activities schema.)
        let invoice_file = null;
        let invoice_file_name = null;
        const _moFileInput = document.getElementById('mo-invoice-file');
        const _moFile = _moFileInput?.files?.[0] || null;
        if (_moFile) {
            try {
                const sb = window.supabase || window.supabaseClient;
                if (sb && sb.storage) {
                    const safeName = _moFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                    const path = `invoices/${Date.now()}_${safeName}`;
                    const { error: upErr } = await sb.storage
                        .from('attachments')
                        .upload(path, _moFile, { upsert: false, contentType: _moFile.type });
                    if (upErr) throw upErr;
                    const { data: urlData } = sb.storage.from('attachments').getPublicUrl(path);
                    invoice_file = urlData?.publicUrl || null;
                } else {
                    // Storage unavailable — fall back to base64 so the file
                    // still survives the save (chunkier but recoverable).
                    invoice_file = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = e => resolve(e.target.result);
                        reader.onerror = () => reject(reader.error);
                        reader.readAsDataURL(_moFile);
                    });
                }
                invoice_file_name = _moFile.name;
            } catch (e) {
                console.warn('saveMeetingOutcome: invoice upload failed:', e);
                UI.toast.error('Invoice upload failed: ' + (e.message || e));
                // Don't abort the whole save — text fields should still persist.
            }
        }

        const updates = {
            is_closing: isClosed,
            unable_to_serve: mo.unable_to_serve,
        };
        if (isClosed) {
            updates.solution_sold = mo.solution_sold;
            updates.amount_closed = mo.amount_closed;
            updates.closing_amount = mo.amount_closed;
            updates.payment_method = mo.payment_method;
            updates.invoice_number = mo.invoice_number;
            updates.collection_date = mo.collection_date;
            updates.order_date = mo.order_date;
            if (updates.payment_method === 'POP') {
                updates.pop_monthly_amount = mo.pop_monthly;
                updates.pop_tenure = mo.pop_tenure;
                updates.pop_down_payment = mo.pop_down;
            }
        }
        if (updates.unable_to_serve) {
            updates.unable_reason = mo.unable_reason;
        }
        try {
            await AppDataStore.update('activities', activityId, updates);
        } catch (err) {
            UI.toast.error('Failed to save meeting outcome: ' + (err?.message || 'Unknown error'));
            return;
        }

        // Sync unable_to_serve to the prospect row so filtering works without scanning activities
        try {
            const _uta = await AppDataStore.getById('activities', activityId);
            if (_uta?.prospect_id) {
                const _uSync = { updated_at: new Date().toISOString(), unable_to_serve: !!updates.unable_to_serve };
                if (updates.unable_to_serve) _uSync.unable_reason = updates.unable_reason || '';
                await AppDataStore.update('prospects', _uta.prospect_id, _uSync);
            }
        } catch (e) {
            console.warn('[unable_to_serve] prospect flag sync failed', e);
            try{ if(window.UI&&UI.toast)(UI.toast.warning||UI.toast.error)('Outcome saved, but the prospect status flag did not sync — list filters may be stale.'); }catch(_){}
        }

        // ── Mirror to prospect's DC Closing Record ──
        // When the activity is linked to a prospect AND the user marked the
        // case as closed, write the same fields through to the prospect's
        // closing_record JSONB so the data lands on the DC Closing Record tab.
        // We refuse to overwrite a record that's already submitted/approved
        // so we don't sneak edits past the manager approval flow.
        let crSyncStatus = 'none';
        // Tracks whether the NPO order (sale/items/installments) failed to materialise so the
        // final toast can warn the agent instead of showing an unqualified success — otherwise
        // a transient insert failure is invisible AND the now-submitted record locks out retry.
        let npoOrderFailed = false;
        if (isClosed) {
            const activity = await AppDataStore.getById('activities', activityId);
            if (activity?.prospect_id) {
                const prospect = await AppDataStore.getById('prospects', activity.prospect_id);
                const existingCR = prospect?.closing_record || null;
                const existingStatus = existingCR?.status || 'draft';
                if (existingStatus === 'draft') {
                    const paymentMethod = mo.payment_method || 'Cash';
                    // mo.* returns null when the customer-info section wasn't
                    // rendered (activity not linked to a prospect) — fall back
                    // to the existing record then the prospect row in that case.
                    const newCR = {
                        ...(existingCR || {}),
                        full_name:     mo.full_name     ?? existingCR?.full_name     ?? prospect?.full_name     ?? '',
                        phone:         mo.phone         ?? existingCR?.phone         ?? prospect?.phone         ?? '',
                        email:         mo.email         ?? existingCR?.email         ?? prospect?.email         ?? '',
                        ic_number:     mo.ic_number     ?? existingCR?.ic_number     ?? prospect?.ic_number     ?? '',
                        date_of_birth: mo.date_of_birth ?? existingCR?.date_of_birth ?? prospect?.date_of_birth ?? '',
                        address:       mo.address       ?? existingCR?.address       ?? '',
                        product:        mo.solution_sold || '',
                        sale_amount:    mo.amount_closed || '',
                        payment_method: paymentMethod,
                        pop_monthly:      paymentMethod === 'POP' ? (mo.pop_monthly || '') : '',
                        pop_tenure:       paymentMethod === 'POP' ? (mo.pop_tenure  || '') : '',
                        pop_down_payment: paymentMethod === 'POP' ? (mo.pop_down    || '') : '',
                        npo_plan_id:      paymentMethod === 'NPO' ? (mo.npo_plan_id   || '') : '',
                        npo_plan_name:    paymentMethod === 'NPO' ? (mo.npo_plan_name || '') : '',
                        npo_tier_amount:   paymentMethod === 'NPO' ? (mo.npo_tier_amount   || '') : '',
                        npo_first_payment: paymentMethod === 'NPO' ? (mo.npo_first_payment || '') : '',
                        npo_monthly:       paymentMethod === 'NPO' ? (mo.npo_monthly       || '') : '',
                        npo_tenure:        paymentMethod === 'NPO' ? (mo.npo_tenure        || '') : '',
                        npo_note:          paymentMethod === 'NPO' ? (mo.npo_note          || '') : '',
                        npo_products:      paymentMethod === 'NPO' ? (Array.isArray(mo.npo_products) ? mo.npo_products : []) : [],
                        npo_sale_id:       (existingCR && existingCR.npo_sale_id) || null,
                        // Credit-card-installment flag + expiry (POP/NPO only). Expiry is YYYY-MM;
                        // stored on the closing record so the DC Closing Record tab shows it and the
                        // card-renewal reminder can re-derive its due date. We store ONLY the expiry —
                        // never the card number/CVV (PCI).
                        cc_installment: (paymentMethod === 'POP' || paymentMethod === 'NPO') ? !!mo.cc_installment : false,
                        cc_expiry:      (paymentMethod === 'POP' || paymentMethod === 'NPO') && mo.cc_installment ? (mo.cc_expiry || '') : '',
                        invoice_number:  mo.invoice_number || '',
                        invoice_file:    invoice_file || existingCR?.invoice_file || '',
                        invoice_file_name: invoice_file_name || existingCR?.invoice_file_name || '',
                        closing_date:    mo.collection_date || '',
                        order_date:      mo.order_date || '',
                        closing_remarks: mo.closing_remarks ?? existingCR?.closing_remarks ?? '',
                        sales_idea:      mo.sales_idea      ?? existingCR?.sales_idea     ?? '',
                        plan_details:    mo.plan_details    ?? existingCR?.plan_details   ?? '',
                        success_story:   mo.success_story   ?? existingCR?.success_story  ?? '',
                        status: 'draft',
                    };

                    // ── Auto-submit for manager approval when all required fields are filled ──
                    // Mirrors submitClosingRecord() so agents don't have to also click "Submit"
                    // on the DC Closing Record tab — that hidden second step was the reason
                    // closed cases never reached the Manager Approval Queue.
                    const hasRequiredFields =
                        newCR.full_name && newCR.product && newCR.sale_amount && newCR.invoice_number;
                    const saleAmount = parseFloat(newCR.sale_amount) || 0;
                    if (hasRequiredFields) {
                        newCR.status = 'submitted';
                        newCR.submitted_at = new Date().toISOString();
                    }

                    // ── Phase 2: materialise the NPO installment order ──────────────
                    // When the closing is NPO and the terms are present, create the real
                    // npo_sales + npo_sale_items + npo_installments rows so the deal shows
                    // up in the NPO Orders tab with a payment schedule. Ad-hoc terms keyed
                    // at close → plan_id/tier_id stay NULL (schema allows it). Idempotent:
                    // once a sale id is stamped on the closing record we never re-create.
                    if (mo.payment_method === 'NPO' && !newCR.npo_sale_id) {
                        try {
                            const sb = window.supabase || window.supabaseClient;
                            const _f = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
                            const tierAmount  = _f(mo.npo_tier_amount);
                            const firstPay    = _f(mo.npo_first_payment);
                            const monthly     = _f(mo.npo_monthly);
                            const tenure      = Math.round(_f(mo.npo_tenure));
                            if (sb && tierAmount > 0 && tenure > 0) {
                                const _addMonths = (iso, n) => {
                                    const base = iso ? new Date(iso) : new Date();
                                    if (isNaN(base)) return null;
                                    // Anchor month math on Y/M/D parts and CLAMP the day so a start on the
                                    // 29th–31st doesn't overflow into the next month (Jan 31 + 1 → Feb 28,
                                    // not Mar 3). Build the result string from local parts (no UTC shift).
                                    const y = base.getFullYear();
                                    const m = base.getMonth();
                                    const day = base.getDate();
                                    const targetY = y + Math.floor((m + n) / 12);
                                    const targetM = ((m + n) % 12 + 12) % 12;
                                    const lastDay = new Date(targetY, targetM + 1, 0).getDate();
                                    const d = Math.min(day, lastDay);
                                    return `${targetY}-${String(targetM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                                };
                                const startDate = (mo.order_date || mo.collection_date || _localDateStr(new Date()));
                                const uid = _state.cu?.id || null;
                                const salePayload = {
                                    customer_id: prospect?.customer_id || null,
                                    customer_name: newCR.full_name || prospect?.full_name || null,
                                    plan_id: mo.npo_plan_id ? mo.npo_plan_id : null,
                                    tier_id: null,
                                    cart_total: tierAmount, tier_amount: tierAmount, overage: 0,
                                    first_payment: firstPay, monthly_amount: monthly, tenure_months: tenure,
                                    fulfillment_mode: 'all_within_period', redemption_period_months: null,
                                    start_date: startDate, status: 'active',
                                    responsible_agent_id: activity.lead_agent_id || uid, created_by: uid,
                                };
                                const { data: saleRow, error: saleErr } = await sb.from('npo_sales').insert(salePayload).select().single();
                                if (saleErr) throw saleErr;
                                const saleId = saleRow && saleRow.id;
                                if (saleId != null) {
                                    newCR.npo_sale_id = saleId;
                                    // one item row per ticked product
                                    const items = (Array.isArray(mo.npo_products) ? mo.npo_products : []).map(p => ({
                                        sale_id: saleId,
                                        product_id: (typeof p.product_id === 'number') ? p.product_id : null,
                                        product_name: p.product_name || '',
                                        qty: 1, unit_price: null, line_total: null,
                                        redeem_after_months: (p.redeem_after_months != null) ? p.redeem_after_months : null,
                                        delivery_status: 'pending',
                                    }));
                                    if (items.length) {
                                        const { error: itemErr } = await sb.from('npo_sale_items').insert(items).select();
                                        if (itemErr) { npoOrderFailed = true; console.warn('NPO sale items insert failed:', itemErr); }
                                    }
                                    // installment schedule: seq 1..tenure, deposit is on the sale (not a row)
                                    const inst = [];
                                    for (let seq = 1; seq <= tenure; seq++) {
                                        inst.push({ sale_id: saleId, seq, due_date: _addMonths(startDate, seq), amount: monthly, status: 'due' });
                                    }
                                    const { error: instErr } = await sb.from('npo_installments').insert(inst).select();
                                    if (instErr) { npoOrderFailed = true; console.warn('NPO installments insert failed:', instErr); }
                                    ['npo_sales', 'npo_sale_items', 'npo_installments'].forEach(t => {
                                        try { AppDataStore.invalidateCache && AppDataStore.invalidateCache(t); } catch (_) {}
                                    });
                                }
                            }
                        } catch (npoErr) {
                            // Never let an NPO-order failure abort the closing save — but flag it so
                            // the agent is warned (the closing auto-submits and then locks, so a
                            // silent failure here would strand the deal with no NPO order forever).
                            npoOrderFailed = true;
                            console.warn('NPO order creation failed (closing still saved):', npoErr);
                        }
                    }

                    try {
                        const prospectUpdates = { closing_record: newCR };
                        if (hasRequiredFields && saleAmount >= 2000) {
                            prospectUpdates.conversion_status = 'pending_approval';
                            prospectUpdates.conversion_requested_at = new Date().toISOString();
                            prospectUpdates.conversion_requested_by = _state.cu?.id;
                        }
                        await AppDataStore.update('prospects', activity.prospect_id, prospectUpdates);
                        crSyncStatus = hasRequiredFields ? 'submitted' : 'synced';
                    } catch (e) {
                        console.warn('Failed to sync closing_record:', e);
                        crSyncStatus = 'failed';
                    }

                    // Create approval_queue entries for non-managers — only if the
                    // closing record was successfully submitted above. Without this
                    // step the super admin's Manager Approval Queue stays empty and
                    // the sale is invisible to leadership.
                    if (crSyncStatus === 'submitted') {
                        const isManager = isSystemAdmin(_state.cu) || isMarketingManager(_state.cu);
                        if (!isManager) {
                            try {
                                await AppDataStore.create('approval_queue', {
                                    approval_type: 'new_sale',
                                    status: 'pending',
                                    prospect_id: activity.prospect_id,
                                    customer_id: null,
                                    submitted_by: _state.cu?.id,
                                    submitted_at: new Date().toISOString(),
                                    snapshot_before: null,
                                    snapshot_after: { ...newCR, sale_amount: saleAmount, prospect_name: prospect?.full_name },
                                    description: `New sale RM ${saleAmount.toLocaleString()} for ${prospect?.full_name || 'prospect'}`
                                });
                                if (saleAmount >= 2000) {
                                    await AppDataStore.create('approval_queue', {
                                        approval_type: 'new_customer',
                                        status: 'pending',
                                        prospect_id: activity.prospect_id,
                                        customer_id: null,
                                        submitted_by: _state.cu?.id,
                                        submitted_at: new Date().toISOString(),
                                        snapshot_before: null,
                                        snapshot_after: { ...prospect, closing_record: newCR, conversion_status: 'pending_approval' },
                                        description: `New customer conversion for ${prospect?.full_name} (auto-triggered by sale RM ${saleAmount.toLocaleString()})`
                                    });
                                    crSyncStatus = 'submitted_with_conversion';
                                }
                            } catch (qe) {
                                console.warn('Failed to create approval_queue entry:', qe);
                                crSyncStatus = 'submitted_no_queue';
                            }
                        }
                    }
                } else {
                    crSyncStatus = 'locked';
                }

                // Arm the credit-card-renewal reminder for a POP/NPO installment charged to a
                // card. Runs whether the record synced or was locked (the card expires either
                // way) and dedups on (prospect, expiry) so re-saves don't pile up. Best-effort:
                // a failure here must not block the closing save.
                if ((mo.payment_method === 'POP' || mo.payment_method === 'NPO') && mo.cc_installment && /^\d{4}-\d{2}$/.test(mo.cc_expiry || '')) {
                    try {
                        await scheduleCardExpiryReminder({
                            prospectId: activity.prospect_id,
                            expiry: mo.cc_expiry,
                            method: mo.payment_method,
                            name: mo.full_name || prospect?.full_name || '',
                            phone: mo.phone || prospect?.phone || '',
                            agentId: prospect?.responsible_agent_id || _state.cu?.id || null,
                        });
                    } catch (e) { console.warn('card-expiry reminder scheduling failed:', e); }
                }
            }
        }

        UI.hideModal();
        // Surface an NPO-order failure regardless of the closing-record status: the closing
        // still saved (by design), but the npo_sales/items/installments rows were NOT created,
        // so the deal is missing from the NPO Orders tab / PORT KPI and needs manual follow-up.
        if (npoOrderFailed) {
            UI.toast.error('Closing saved, but the NPO order could not be created — please recreate it in the NPO Orders tab or contact support.');
        }
        else if (crSyncStatus === 'submitted_with_conversion') UI.toast.success('✓ Submitted to manager for approval — sale ≥ RM 2,000 also requested customer conversion');
        else if (crSyncStatus === 'submitted_no_queue')   UI.toast.error('Closing saved but approval queue write failed — please retry from the prospect profile');
        else if (crSyncStatus === 'submitted')            UI.toast.success('✓ Submitted to manager for approval');
        else if (crSyncStatus === 'synced')               UI.toast.success('Saved as draft (fill product, amount, invoice & full name to auto-submit for approval)');
        else if (crSyncStatus === 'locked')               UI.toast.success('Activity saved (closing record locked — not overwritten)');
        else if (crSyncStatus === 'failed')               UI.toast.error('Activity saved but closing record sync failed — retry from the prospect profile');
        else                                              UI.toast.success('Meeting outcome saved');
        if (document.querySelector('.calendar-view-container')) { await renderCalendar(); await renderTodayActivities(); }
    };

    // ── Helpers for multi-select checkbox fields in Post-Meetup Notes ──
    const parseSelectedItems = (savedText) => {
        if (!savedText) return { selected: [], remarks: '' };
        const remarksMatch = savedText.match(/\|\s*Remarks:\s*([\s\S]*)/);
        const remarks = remarksMatch ? remarksMatch[1].trim() : '';
        const itemsPart = remarksMatch ? savedText.slice(0, remarksMatch.index).trim() : savedText;
        const selected = [];
        const groupRegex = /\[([^\]]+)\]\s*([^[|]*)/g;
        let match;
        while ((match = groupRegex.exec(itemsPart)) !== null) {
            const names = match[2].split(',').map(n => n.trim()).filter(Boolean);
            selected.push(...names);
        }
        // Old free-text data without group markers → treat as remarks
        if (selected.length === 0 && !remarksMatch) return { selected: [], remarks: savedText };
        return { selected, remarks };
    };

    const serializeMultiSelectToText = (checkboxName, remarksId) => {
        const checked = Array.from(document.querySelectorAll(`input[name="${checkboxName}"]:checked`));
        const groups = {};
        for (const cb of checked) {
            const group = cb.dataset.group || 'Items';
            if (!groups[group]) groups[group] = [];
            groups[group].push(cb.value);
        }
        const parts = Object.entries(groups).map(([g, items]) => `[${g}] ${items.join(', ')}`);
        const remarks = document.getElementById(remarksId)?.value?.trim() || '';
        let result = parts.join(' | ');
        if (remarks) result += (result ? ' | ' : '') + 'Remarks: ' + remarks;
        return result;
    };

    const serializeEventSelectToText = (checkboxName, remarksId) => {
        const checked = Array.from(document.querySelectorAll(`input[name="${checkboxName}"]:checked`));
        const items = checked.map(cb => cb.value);
        const remarks = document.getElementById(remarksId)?.value?.trim() || '';
        let result = items.join(', ');
        if (remarks) result += (result ? ' | ' : '') + 'Remarks: ' + remarks;
        return result;
    };

    // buildPostMeetupNotesBlock / collectPostMeetupNotesData live in the
    // activities chunk. On mobile the activities chunk is often not loaded when
    // these modals open (the opener lives here in the calendar chunk), so the
    // builder falls back to () => '' and the modal renders with an EMPTY body.
    // Ensure the activities chunk is loaded before building/collecting.
    const _ensureActivitiesChunk = async () => {
        if (window.app.buildPostMeetupNotesBlock) return;
        if (typeof window._loadChunk !== 'function') return;
        try { await window._loadChunk('chunks/script-activities.min.js'); } catch (_) { /* bail if lazy chunk fails to load */ }
    };

    const openPostMeetupNotesModal = async (activityId, prospectId) => {
        await _ensureActivitiesChunk();
        const activity = (await _lookupActivityRobust(activityId)) || {};

        // Fetch product/event data for the multi-select checkbox groups.
        const [products, bujishu, formula, events] = await Promise.all([
            AppDataStore.getAll('products').then(r => r.filter(p => p.is_active !== false)),
            AppDataStore.getAll('bujishu').then(r => r.filter(b => b.is_active !== false)),
            AppDataStore.getAll('formula').then(r => r.filter(f => f.is_active !== false)),
            AppDataStore.getAll('events').then(r => r.filter(e => e.is_active !== false && e.status !== 'inactive')),
        ]);

        // Grade picker (set AFTER the meeting): grade/cadence is a prospect-only
        // concept. Resolve prospectId to a prospect row to seed the current grade;
        // if it's a customer (no prospect row) the picker is simply omitted.
        let gradeContext = null;
        if (prospectId) {
            try {
                const p = await AppDataStore.getById('prospects', prospectId);
                if (p) gradeContext = { current: p.manual_grade || '' };
            } catch (_) { /* lookup failed → omit grade picker */ }
        }

        const content = (window.app.buildPostMeetupNotesBlock || (() => ''))('pmn', activity, { products, bujishu, formula, events, gradeContext });
        UI.showModal('📝 Post-Meetup Notes', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save', type: 'primary', action: `(async () => { await app.savePostMeetupNotes(${activityId}, ${prospectId}); })()` }
        ]);
    };

    const savePostMeetupNotes = async (activityId, prospectId) => {
        // Disable Save immediately to prevent double-submit while upload/write runs.
        const _saveBtn = document.querySelector('.modal-footer .btn.primary');
        if (_saveBtn) { _saveBtn.disabled = true; _saveBtn.textContent = 'Saving…'; }

        await _ensureActivitiesChunk();
        const updates = (window.app.collectPostMeetupNotesData || (() => ({})))('pmn');
        // Single client reference used by both the photo upload and the row update.
        const sb = window.supabase || window.supabaseClient;

        // ── Discussion paper photos ────────────────────────────────────────
        // Upload any files selected in the Minutes photo picker before saving
        // the text fields, then merge URLs into photo_urls on the same row.
        const photoInput = document.getElementById('pmn-photo-files');
        const photoFiles = photoInput?.files?.length ? Array.from(photoInput.files) : [];
        if (photoFiles.length > 0) {
            if (sb && sb.storage) {
                const _compress = window.app.compressImageFile || (f => Promise.resolve(f));
                // Read existing photo_urls from the data attribute embedded in the
                // modal DOM when it was rendered — avoids any cache/network dependency.
                let existingUrls = [];
                try {
                    const section = document.getElementById('pmn-photo-section');
                    existingUrls = JSON.parse(section?.dataset?.existing || '[]');
                } catch (_) { /* intentional: malformed dataset → start from empty list */ existingUrls = []; }

                UI.toast.success('Uploading photo(s)…');
                const newUrls = [];
                let uploadFailed = false;
                for (const file of photoFiles) {
                    if (!file.type.startsWith('image/')) continue;
                    try {
                        const compressed = await _compress(file);
                        const safeName = compressed.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                        const path = `activity_photos/${activityId}_${Date.now()}_${safeName}`;
                        const { error: upErr } = await sb.storage.from('attachments').upload(path, compressed, { upsert: false, contentType: compressed.type || 'image/jpeg' });
                        if (upErr) {
                            console.warn('minutes photo upload error:', upErr);
                            uploadFailed = true;
                            continue;
                        }
                        const { data: urlData } = sb.storage.from('attachments').getPublicUrl(path);
                        if (urlData?.publicUrl) newUrls.push(urlData.publicUrl);
                    } catch (e) {
                        console.warn('minutes photo upload threw:', e);
                        uploadFailed = true;
                    }
                }
                if (newUrls.length > 0) {
                    updates.photo_urls = [...existingUrls, ...newUrls];
                } else if (uploadFailed) {
                    // Re-enable the Save button so the user can retry
                    if (_saveBtn) { _saveBtn.disabled = false; _saveBtn.textContent = 'Save'; }
                    UI.toast.error('Photo upload failed — check your connection and try again. Notes were NOT saved.');
                    return;
                }
            } else {
                UI.toast.error('Supabase storage not available — photos not uploaded');
            }
        }
        // ── End photo upload ───────────────────────────────────────────────

        // Use the authenticated Supabase client so RLS applies and errors
        // surface instead of silently falling back to localStorage.
        let writeOk = false;
        if (sb) {
            try {
                const { error } = await sb.from('activities').update(updates).eq('id', activityId);
                if (error) {
                    console.warn('savePostMeetupNotes update failed:', error);
                } else {
                    writeOk = true;
                }
            } catch (e) {
                console.warn('savePostMeetupNotes threw:', e);
            }
        }
        // Only fall back to AppDataStore when the direct client is entirely unavailable.
        // When `sb` exists but its RLS-aware write FAILED (e.g. 42501 on an activity owned by
        // another agent, or an expired session), falling back to AppDataStore.update — which
        // never rejects and silently queues — would force writeOk=true and lose the notes.
        // Let that failure surface via the error toast below instead.
        if (!writeOk && !sb) {
            try {
                await AppDataStore.update('activities', activityId, updates);
                writeOk = true;
            } catch (e) {
                console.warn('AppDataStore.update fallback failed:', e);
            }
        }

        if (!writeOk) {
            // Re-enable Save so the agent can actually retry (the label was set to 'Saving…').
            if (_saveBtn) { _saveBtn.disabled = false; _saveBtn.textContent = 'Save'; }
            UI.toast.error('Failed to save notes — please try again');
            return;
        }

        // Invalidate the activities cache so the accordion re-reads fresh data
        AppDataStore.invalidateCache('activities');

        // ── Grade (set after the meeting) → prospect ───────────────────────
        // The grade picker writes prospects.manual_grade, NOT activities, so it's
        // handled here rather than in collectPostMeetupNotesData (whose payload
        // targets the activities row). The element only exists when openModal
        // resolved a real prospect, so its presence already scopes this to
        // prospects. Write only when the value actually changed.
        const gradeEl = document.getElementById('pmn-grade');
        if (gradeEl && prospectId) {
            const newGrade = gradeEl.value || null;
            const curGrade = gradeEl.dataset.current || '';
            if ((newGrade || '') !== curGrade) {
                try {
                    if (sb) {
                        const { error: gErr } = await sb.from('prospects').update({ manual_grade: newGrade }).eq('id', prospectId);
                        if (gErr) console.warn('grade update failed:', gErr);
                    } else {
                        await AppDataStore.update('prospects', prospectId, { manual_grade: newGrade });
                    }
                    AppDataStore.invalidateCache('prospects');
                } catch (e) { console.warn('grade update threw:', e); }
            }
        }

        UI.hideModal();
        UI.toast.success('Post-meetup notes saved');
        if (prospectId) {
            // Entity may be a prospect or a customer — detect before routing.
            let isProspect = true;
            try {
                const p = await AppDataStore.getById('prospects', prospectId);
                if (!p) isProspect = false;
            } catch (_) { /* intentional: lookup failed → treat as customer route */ isProspect = false; }
            if (isProspect) {
                await (window.app.showProspectDetail || (() => {}))(prospectId);
                setTimeout(async () => {
                    for (const tab of ['potential', 'nextactions']) {
                        const itemEl = document.getElementById(`acc-${tab}-${prospectId}`);
                        const bodyEl = document.getElementById(`acc-body-${tab}-${prospectId}`);
                        if (itemEl && bodyEl && !itemEl.classList.contains('open')) {
                            itemEl.classList.add('open');
                            bodyEl.style.display = 'block';
                            if (bodyEl.dataset.loaded === 'false') {
                                bodyEl.dataset.loaded = 'true';
                                await (window.app.switchProspectTab || (() => {}))(tab, prospectId, null, bodyEl);
                            }
                        }
                    }
                    document.getElementById(`acc-potential-${prospectId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 400);
            } else {
                // The previous `typeof showCustomerDetail === 'function'` guard
                // referenced a bare (undeclared) identifier that is ALWAYS
                // undefined, so the customer-navigation branch never ran. Call
                // window.app.showCustomerDetail directly; the || fallback keeps it
                // safe if the handler isn't loaded.
                await (window.app.showCustomerDetail || (() => {}))(prospectId);
            }
        }
    };

    // ──────────────────────────────────────────────────────────────────────
    // PER-ATTENDEE POST-EVENT NOTES (event_attendees row)
    //
    // The event activity row has ONE prospect_id, but events have many
    // attendees. Saving post-event notes onto the activity makes them
    // invisible on every attendee's profile except the activity owner,
    // and lets attendees overwrite each other's notes. These helpers route
    // Post Event saves to the event_attendees row keyed by (activity_id,
    // entity_id) so each attendee owns their own note bundle and the
    // prospect profile can surface it.
    const openAttendeePostEventModal = async (attendeeId, activityId, prospectId) => {
        await _ensureActivitiesChunk();
        const attendee = await AppDataStore.getById('event_attendees', attendeeId);
        if (!attendee) { UI.toast.error('Attendee not found'); return; }
        const activity = (await _lookupActivityRobust(activityId)) || {};

        const [products, bujishu, formula, events] = await Promise.all([
            AppDataStore.getAll('products').then(r => r.filter(p => p.is_active !== false)),
            AppDataStore.getAll('bujishu').then(r => r.filter(b => b.is_active !== false)),
            AppDataStore.getAll('formula').then(r => r.filter(f => f.is_active !== false)),
            AppDataStore.getAll('events').then(r => r.filter(e => e.is_active !== false && e.status !== 'inactive')),
        ]);

        // Pre-populate from the attendee row (per-person notes), not the
        // activity. Inherit event_id/title/date from the parent so the
        // event-checkbox group still renders contextually.
        const seedActivity = {
            ...activity,
            note_key_points: attendee.note_key_points || '',
            note_needs: attendee.note_needs || '',
            note_pain_points: attendee.note_pain_points || '',
            opportunity_potential: attendee.opportunity_potential || '',
            next_action: attendee.next_action || '',
            summary: attendee.summary || '',
            // Discussion-paper photos live on the ATTENDEE row (per-person), not
            // the shared activity. Seed them so existing thumbs render and the
            // photo-section's data-existing attribute is populated — otherwise a
            // re-save would wipe previously uploaded papers.
            photo_urls: Array.isArray(attendee.photo_urls) ? attendee.photo_urls : [],
        };

        const attendeeName = attendee.entity_name || 'Attendee';
        const content = (window.app.buildPostMeetupNotesBlock || (() => ''))('pmn', seedActivity, { products, bujishu, formula, events });
        UI.showModal(`📝 Post-Event Notes — ${escapeHtml(attendeeName)}`, content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save', type: 'primary', action: `(async () => { await app.saveAttendeePostEventNotes(${attendeeId}, ${activityId}, ${prospectId}); })()` }
        ]);
    };

    const saveAttendeePostEventNotes = async (attendeeId, activityId, prospectId) => {
        // Disable Save immediately to prevent double-submit while upload/write runs.
        const _saveBtn = document.querySelector('.modal-footer .btn.primary');
        if (_saveBtn) { _saveBtn.disabled = true; _saveBtn.textContent = 'Saving…'; }

        await _ensureActivitiesChunk();
        const fields = (window.app.collectPostMeetupNotesData || (() => ({})))('pmn');
        const updates = {
            note_key_points: fields.note_key_points,
            note_needs: fields.note_needs,
            note_pain_points: fields.note_pain_points,
            opportunity_potential: fields.opportunity_potential,
            next_action: fields.next_action,
            summary: fields.summary,
            post_event_updated_at: new Date().toISOString(),
            post_event_updated_by: _state.cu?.id || null,
        };

        const sb = window.supabase || window.supabaseClient;

        // ── Discussion paper photos (per-attendee) ─────────────────────────
        // The shared notes form renders the "Discussion Papers" uploader, but
        // these photos belong to THIS attendee — storing them on the shared
        // activity row would leak/overwrite across every attendee. Upload here
        // and merge into event_attendees.photo_urls. Mirrors savePostMeetupNotes.
        const photoInput = document.getElementById('pmn-photo-files');
        const photoFiles = photoInput?.files?.length ? Array.from(photoInput.files) : [];
        if (photoFiles.length > 0) {
            if (sb && sb.storage) {
                const _compress = window.app.compressImageFile || (f => Promise.resolve(f));
                // Read existing photo_urls from the data attribute embedded in the
                // modal DOM when it was rendered — avoids any cache/network dependency.
                let existingUrls = [];
                try {
                    const sec = document.getElementById('pmn-photo-section');
                    existingUrls = JSON.parse(sec?.dataset?.existing || '[]');
                } catch (_) { /* intentional: malformed dataset → start from empty list */ existingUrls = []; }

                UI.toast.success('Uploading photo(s)…');
                const newUrls = [];
                let uploadFailed = false;
                for (const file of photoFiles) {
                    if (!file.type.startsWith('image/')) continue;
                    try {
                        const compressed = await _compress(file);
                        const safeName = compressed.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                        const path = `event_attendee_photos/${attendeeId}_${Date.now()}_${safeName}`;
                        const { error: upErr } = await sb.storage.from('attachments').upload(path, compressed, { upsert: false, contentType: compressed.type || 'image/jpeg' });
                        if (upErr) {
                            console.warn('attendee paper upload error:', upErr);
                            uploadFailed = true;
                            continue;
                        }
                        const { data: urlData } = sb.storage.from('attachments').getPublicUrl(path);
                        if (urlData?.publicUrl) newUrls.push(urlData.publicUrl);
                    } catch (e) {
                        console.warn('attendee paper upload threw:', e);
                        uploadFailed = true;
                    }
                }
                if (newUrls.length > 0) {
                    updates.photo_urls = [...existingUrls, ...newUrls];
                } else if (uploadFailed) {
                    if (_saveBtn) { _saveBtn.disabled = false; _saveBtn.textContent = 'Save'; }
                    UI.toast.error('Photo upload failed — check your connection and try again. Notes were NOT saved.');
                    return;
                }
            } else {
                UI.toast.error('Supabase storage not available — photos not uploaded');
            }
        }
        // ── End photo upload ───────────────────────────────────────────────

        let writeOk = false;
        if (sb) {
            try {
                const { error } = await sb.from('event_attendees').update(updates).eq('id', attendeeId);
                if (error) console.warn('saveAttendeePostEventNotes update failed:', error);
                else writeOk = true;
            } catch (e) {
                console.warn('saveAttendeePostEventNotes threw:', e);
            }
        }
        if (!writeOk) {
            try {
                await AppDataStore.update('event_attendees', attendeeId, updates);
                writeOk = true;
            } catch (e) {
                console.warn('AppDataStore.update fallback failed:', e);
            }
        }
        if (!writeOk) {
            if (_saveBtn) { _saveBtn.disabled = false; _saveBtn.textContent = 'Save'; }
            UI.toast.error('Failed to save notes — please try again');
            return;
        }

        AppDataStore.invalidateCache('event_attendees');

        UI.hideModal();
        UI.toast.success('Post-event notes saved');

        if (prospectId) {
            await (window.app.showProspectDetail || (() => {}))(prospectId);
            setTimeout(async () => {
                for (const tab of ['potential', 'nextactions']) {
                    const itemEl = document.getElementById(`acc-${tab}-${prospectId}`);
                    const bodyEl = document.getElementById(`acc-body-${tab}-${prospectId}`);
                    if (itemEl && bodyEl && !itemEl.classList.contains('open')) {
                        itemEl.classList.add('open');
                        bodyEl.style.display = 'block';
                        if (bodyEl.dataset.loaded === 'false') {
                            bodyEl.dataset.loaded = 'true';
                            await (window.app.switchProspectTab || (() => {}))(tab, prospectId, null, bodyEl);
                        }
                    }
                }
                document.getElementById(`acc-potential-${prospectId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 400);
        }
    };

    // Returns activity-shaped records for every event_attendees row that
    // captures post-event notes for this prospect. Lets the prospect
    // profile read sites (meetup history modal, potential / nextactions /
    // events tabs) merge attendee-side notes alongside activity-owner
    // notes without rewriting their render code.
    const getProspectAttendeeNotes = async (prospectId) => {
        if (!prospectId) return [];
        const _matchesProspect = (a) =>
            String(a.entity_id || a.attendee_id) === String(prospectId) &&
            (a.attendee_type || 'prospect') === 'prospect' &&
            (a.note_key_points || a.note_needs || a.note_pain_points ||
             a.opportunity_potential || a.next_action || a.summary);

        // Scale-safe: fetch ONLY this prospect's attendee rows server-side via an
        // OR on the two possible id columns (a SUPERSET of the client filter),
        // then trim with the exact client filter. Whole-table fallback on error.
        let myRows;
        try {
            const { data, error } = await AppDataStore._readClient()
                .from('event_attendees')
                .select(AppDataStore._selectClauseForGetAll('event_attendees'))
                .or(`entity_id.eq.${prospectId},attendee_id.eq.${prospectId}`);
            if (error) throw error;
            myRows = (data || []).filter(_matchesProspect);
        } catch (e) {
            console.warn('getProspectAttendeeNotes: event_attendees scope query failed — full-table fallback', e);
            myRows = (await AppDataStore.getAll('event_attendees')).filter(_matchesProspect);
        }
        if (myRows.length === 0) return [];

        // Scale-safe: resolve ONLY the parent activities referenced by these rows
        // (by id) instead of mapping the whole activities table. Fallback on error.
        const parentIds = [...new Set(myRows.map(att => att.activity_id).filter(Boolean).map(String))];
        let byId = new Map();
        if (parentIds.length) {
            try {
                const { data, error } = await AppDataStore._readClient()
                    .from('activities')
                    .select(AppDataStore._selectClauseForGetAll('activities'))
                    .in('id', parentIds);
                if (error) throw error;
                byId = new Map((data || []).map(a => [String(a.id), a]));
            } catch (e) {
                console.warn('getProspectAttendeeNotes: parent-activities lookup failed — full-table fallback', e);
                byId = new Map((await AppDataStore.getAll('activities')).map(a => [String(a.id), a]));
            }
        }
        return myRows.map(att => {
            const parent = byId.get(String(att.activity_id)) || {};
            return {
                // Synthetic ID — never collides with real activity IDs so the
                // 'nextactions' tab's per-item keys (`${a.id}_na`) stay unique
                // even when the prospect both hosted and attended the same event.
                id: `att${att.id}`,
                _parentActivityId: parent.id || att.activity_id,
                _attendeeRowId: att.id,
                _isAttendeeNote: true,
                activity_type: parent.activity_type || 'EVENT',
                activity_title: parent.activity_title || '',
                activity_date: parent.activity_date || (att.created_at ? String(att.created_at).slice(0, 10) : ''),
                event_id: parent.event_id || att.event_id,
                prospect_id: prospectId,
                note_key_points: att.note_key_points || '',
                note_needs: att.note_needs || '',
                note_pain_points: att.note_pain_points || '',
                opportunity_potential: att.opportunity_potential || '',
                next_action: att.next_action || '',
                summary: att.summary || '',
                // Per-attendee discussion papers — surfaced so Meet Up History
                // and the events tab can render a photo button for this note.
                photo_urls: Array.isArray(att.photo_urls) ? att.photo_urls : [],
            };
        });
    };

    // Gallery viewer for a single attendee's discussion-paper photos. The
    // prospect "Post-Meetup" path stores photos on activities.photo_urls and
    // uses viewActivityPhotos; the per-attendee path stores them on the
    // event_attendees row, so it needs its own fresh-read + remove handlers.
    const viewAttendeePhotos = async (attendeeRowId) => {
        const sb = window.supabase || window.supabaseClient;
        let photos = [];
        try {
            if (sb) {
                const { data } = await sb.from('event_attendees').select('photo_urls').eq('id', attendeeRowId).maybeSingle();
                photos = Array.isArray(data?.photo_urls) ? data.photo_urls : [];
            } else {
                const att = await AppDataStore.getById('event_attendees', attendeeRowId);
                photos = Array.isArray(att?.photo_urls) ? att.photo_urls : [];
            }
        } catch (e) { console.warn('viewAttendeePhotos read failed:', e); }

        if (photos.length === 0) { UI.toast.error('No discussion papers attached'); return; }

        const content = `
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;max-height:60vh;overflow:auto;padding:4px;">
                ${photos.map(url => `
                    <div style="position:relative;">
                        <img loading="lazy" decoding="async" src="${escapeHtml(url)}" style="width:100%;height:120px;border-radius:6px;object-fit:cover;cursor:zoom-in;border:1px solid var(--gray-200);" onclick="window._openAttachment && window._openAttachment('${UI.escJsAttr(String(url))}')">
                        <button type="button" class="btn-icon" style="position:absolute;top:-6px;right:-6px;background:var(--error);color:white;border-radius:50%;width:22px;height:22px;font-size:11px;padding:0;" title="Remove" onclick="event.stopPropagation();app.removeAttendeePhoto(${attendeeRowId}, '${UI.escJsAttr(String(url))}')"><i class="fas fa-times"></i></button>
                    </div>
                `).join('')}
            </div>
            <p style="color:var(--gray-500);font-size:12px;margin-top:10px;text-align:center;">Tap a photo to view full size. Tap × to remove.</p>
        `;
        UI.showModal(`Discussion Papers (${photos.length})`, content, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' },
        ]);
    };

    const removeAttendeePhoto = async (attendeeRowId, url) => {
        const sb = window.supabase || window.supabaseClient;
        try {
            let current = [];
            if (sb) {
                const { data } = await sb.from('event_attendees').select('photo_urls').eq('id', attendeeRowId).maybeSingle();
                current = Array.isArray(data?.photo_urls) ? data.photo_urls : [];
            } else {
                const att = await AppDataStore.getById('event_attendees', attendeeRowId);
                current = Array.isArray(att?.photo_urls) ? att.photo_urls : [];
            }
            const updated = current.filter(u => u !== url);
            if (sb) {
                const { error } = await sb.from('event_attendees').update({ photo_urls: updated }).eq('id', attendeeRowId);
                if (error) throw error;
            } else {
                await AppDataStore.update('event_attendees', attendeeRowId, { photo_urls: updated });
            }
            AppDataStore.invalidateCache('event_attendees');
            UI.toast.success('Photo removed');
            UI.hideModal();
            if (updated.length > 0) await viewAttendeePhotos(attendeeRowId);
        } catch (e) {
            console.warn('removeAttendeePhoto failed:', e);
            UI.toast.error('Failed to remove photo');
        }
    };

    const editActivity = async (activityId) => {
        const activity = await _lookupActivityRobust(activityId);
        if (!activity) { UI.toast.error('Activity not found'); return; }
        UI.hideModal(); // close any open modal
        await (window.app.openActivityModal || (() => {}))(null, null, activity);
    };

    const deleteActivity = async (activityId) => {
        UI.showModal('Confirm Delete',
            '<p>Are you sure you want to delete this activity? This action cannot be undone.</p>',
            [
                { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
                { label: 'Delete', type: 'primary', action: `(async () => { await app.confirmDeleteActivity(${activityId}); })()` }
            ]
        );
    };

    const confirmDeleteActivity = async (activityId) => {
        try {
            await AppDataStore.delete('activities', activityId);
            UI.hideModal();
            UI.toast.success('Activity deleted');
            if (document.querySelector('.calendar-view-container')) {
                await renderCalendar();
                await renderTodayActivities();
            }
        } catch (err) {
            UI.toast.error('Failed to delete activity: ' + (err?.message || 'Unknown error'));
        }
    };

    const markActivityComplete = async (activityId) => {
        const activity = await _lookupActivityRobust(activityId);
        if (!activity) { UI.toast.error('Activity not found'); return; }

        try {
            // Send a NARROW payload, not the whole `activity` object: the row can
            // come from the calendar hot RPC and carry joined/synthetic columns
            // (e.g. entity_name) that don't exist on the activities table, which
            // would make the write fail with 42703. Wrap in try/catch so an RLS
            // deny / offline error surfaces to the user instead of silently
            // rejecting the promise (and skipping the toast + re-render).
            await AppDataStore.update('activities', activityId, {
                status: 'completed',
                completed_at: new Date().toISOString()
            });
        } catch (err) {
            UI.toast.error('Could not mark complete: ' + (err?.message || 'Unknown error'));
            return;
        }

        UI.toast.success('Activity marked as complete');
        if (document.querySelector('.calendar-view-container')) {
            await renderCalendar();
            await renderTodayActivities();
        }
    };

    const postMeetupNotes = async (activityId) => {
        await app.editActivity(activityId);
        setTimeout(() => {
            document.getElementById('note-key-points')?.focus();
        }, 650);
    };

    // Aggregated read-only view of every post-meetup note this prospect has
    // accumulated. Opens from the profile header button — quicker than
    // expanding each activity row in turn. Empty or note-less meetings are
    // still shown (date + type) so the agent sees chronology; visits that
    // never captured notes are flagged as "— no notes captured —".
    const openMeetupHistoryModal = async (prospectId) => {
        const prospect = await AppDataStore.getById('prospects', prospectId);
        if (!prospect) { UI.toast.error('Prospect not found'); return; }
        const MEETUP_TYPES = ['CPS','FTF','FSA','GR','XG','CALL','EMAIL','WHATSAPP'];
        // Scale-safe: indexed per-prospect activity fetch (eq prospect_id, has its
        // own getAll fallback) instead of scanning the WHOLE activities table.
        const ownActivities = (await AppDataStore.getActivitiesForProspect(prospectId, { limit: 2000 }))
            .filter(a => MEETUP_TYPES.includes(a.activity_type));
        const attendeeNotes = await getProspectAttendeeNotes(prospectId);
        const activities = [...ownActivities, ...attendeeNotes]
            .sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date) || (b.id || 0) - (a.id || 0));

        const fmt = (txt) => txt ? escapeHtml(txt).replace(/\n/g, '<br>') : '';
        const section = (label, text) => text
            ? `<div style="margin-top:8px;"><div style="font-size:11px;font-weight:600;color:var(--gray-500);text-transform:uppercase;letter-spacing:.5px;">${label}</div><div style="font-size:13px;color:var(--gray-800);margin-top:2px;">${fmt(text)}</div></div>`
            : '';

        const body = activities.length === 0
            ? '<p style="text-align:center;padding:24px;color:var(--gray-400);">No meet-up history recorded yet.</p>'
            : activities.map(a => {
                const hasAnyNote = a.note_key_points || a.note_needs || a.note_pain_points || a.opportunity_potential || a.next_action || a.summary;
                const editHandler = a._isAttendeeNote
                    ? `UI.hideModal();app.openAttendeePostEventModal(${a._attendeeRowId}, ${a._parentActivityId}, ${prospectId})`
                    : `UI.hideModal();app.openPostMeetupNotesModal(${a.id}, ${prospectId})`;
                const sourceTag = a._isAttendeeNote
                    ? `<span style="font-size:10px;background:var(--gray-100);color:var(--gray-600);padding:1px 6px;border-radius:10px;margin-left:6px;">attended</span>`
                    : '';
                const photoCount = Array.isArray(a.photo_urls) ? a.photo_urls.length : 0;
                const photoHandler = a._isAttendeeNote
                    ? `app.viewAttendeePhotos(${a._attendeeRowId})`
                    : `app.viewActivityPhotos(${a.id})`;
                const photoBtn = photoCount > 0
                    ? `<button class="btn btn-sm secondary" style="font-size:11px;padding:3px 8px;color:var(--primary);border-color:var(--primary);" title="${photoCount} discussion paper${photoCount > 1 ? 's' : ''}" onclick="event.stopPropagation();${photoHandler}"><i class="fas fa-camera"></i> ${photoCount}</button>`
                    : '';
                return `
                    <div style="border:1px solid var(--gray-200);border-radius:8px;padding:12px 14px;margin-bottom:10px;background:#fff;">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                            <div>
                                <div style="font-weight:600;font-size:14px;"><i class="fas fa-user-friends" style="color:var(--primary);"></i> ${escapeHtml(a.activity_type || 'Meeting')}${a.activity_title ? ' — ' + escapeHtml(a.activity_title) : ''}${sourceTag}</div>
                                <div style="font-size:12px;color:var(--gray-500);margin-top:2px;">${escapeHtml(a.activity_date || '')}</div>
                            </div>
                            <div style="display:flex;gap:6px;flex-shrink:0;">
                                ${photoBtn}
                                <button class="btn btn-sm secondary" style="font-size:11px;padding:3px 8px;" onclick="${editHandler}"><i class="fas fa-edit"></i> Edit</button>
                            </div>
                        </div>
                        ${hasAnyNote ? `
                            ${section('Key Points', a.note_key_points || a.summary)}
                            ${section('Customer Needs', a.note_needs)}
                            ${section('Pain Points', a.note_pain_points)}
                            ${section('Potential & Opportunities', a.opportunity_potential)}
                            ${section('Next Actions', a.next_action)}
                        ` : '<div style="margin-top:8px;color:var(--gray-400);font-size:12px;font-style:italic;">— no notes captured —</div>'}
                    </div>
                `;
            }).join('');

        UI.showModal(`📋 Meet-Up History — ${escapeHtml(prospect.full_name)}`, `
            <div style="max-height:70vh;overflow-y:auto;padding-right:4px;">
                <div style="font-size:12px;color:var(--gray-500);margin-bottom:10px;">${activities.length} meet-up${activities.length === 1 ? '' : 's'} · most recent first</div>
                ${body}
            </div>
        `, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' },
        ]);
    };

    const rescheduleActivity = async (activityId) => {
        await app.editActivity(activityId);
        setTimeout(() => {
            const dateEl = document.getElementById('activity-date');
            if (dateEl) {
                dateEl.focus();
                dateEl.style.boxShadow = '0 0 0 2px var(--primary-color)';
                setTimeout(() => { dateEl.style.boxShadow = ''; }, 2000);
            }
        }, 350);
    };

    const postEventFollowUp = async (eventId, entityId) => {
        UI.hideModal();
        const ev = await AppDataStore.getById('events', eventId);
        await (window.app.openActivityModal || (() => {}))();
        setTimeout(async () => {
            // Scale-safe: resolve the one record by id (prospects first, then
            // customers) instead of downloading BOTH whole tables. getById is a
            // synchronous in-memory hit when the table is already cached, else a
            // single-row fetch. Falls back to the dual whole-table scan on error.
            // Classify by WHICH table the record came from — there is no `is_customer`
            // flag on either table (customers rows never carry it), so the old
            // `p.is_customer ? 'customer' : 'prospect'` always mis-tagged customers as
            // prospects, writing prospect_id = the customer's id into the wrong id-space.
            let p = null;
            let pType = 'prospect';
            try {
                p = await AppDataStore.getById('prospects', entityId);
                if (!p) { p = await AppDataStore.getById('customers', entityId); if (p) pType = 'customer'; }
            } catch (e) {
                console.warn('postEventFollowUp: getById lookup failed — whole-table fallback', e);
                const prospectsAll = await AppDataStore.getAll('prospects');
                p = prospectsAll.find(x => x.id === entityId);
                if (!p) { p = (await AppDataStore.getAll('customers')).find(x => x.id === entityId); if (p) pType = 'customer'; }
            }
            if (p) app.selectEntity(entityId, pType);

            const typeEl = document.getElementById('modal-activity-type');
            if (typeEl) {
                typeEl.value = 'CALL';
                await app.updateActivityForm();
                setTimeout(() => {
                    const titleEl = document.getElementById('meeting-title');
                    if (titleEl && ev) titleEl.value = `Follow-up from ${ev.title}`;
                    document.getElementById('note-key-points')?.focus();
                }, 100);
            }
        }, 300);
    };

    const openAttendeeOutcomeModal = async (attendeeId, attendeeType, activityId) => {
        const attendee = attendeeType === 'agent'
            ? await AppDataStore.getById('users', attendeeId)
            : (attendeeType === 'prospect' ? await AppDataStore.getById('prospects', attendeeId) : await AppDataStore.getById('customers', attendeeId));

        // Normalize ids with String(): activityId/attendeeId arrive from the
        // modal action string as bare numeric literals, but the notes table can
        // store string/UUID ids — strict === would never match and we'd create a
        // duplicate note. Mirrors the String()-normalized style used elsewhere.
        const existingNote = (await AppDataStore.query('notes', { activity_id: activityId, note_type: 'outcome' }).catch(() => [])).find(n =>
            ((attendeeType === 'agent' && String(n.agent_id) === String(attendeeId)) ||
                (attendeeType === 'prospect' && String(n.prospect_id) === String(attendeeId)) ||
                (attendeeType === 'customer' && String(n.customer_id) === String(attendeeId))));

        const content = `
            <div class="form-group">
                <label>Outcome for ${esc(attendee?.full_name || 'Attendee')} (${attendeeType})</label>
                <textarea id="attendee-outcome-text" class="form-control" rows="4" placeholder="Enter meeting outcome for this attendee...">${esc(existingNote?.text || '')}</textarea>
            </div>
        `;

        UI.showModal('Meeting Outcome', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save Outcome', type: 'primary', action: `(async () => { await app.saveAttendeeNote(${attendeeId}, '${attendeeType}', ${activityId}, 'outcome'); })()` }
        ]);
    };

    const openAttendeeNotesModal = async (attendeeId, attendeeType, activityId) => {
        const attendee = attendeeType === 'agent'
            ? await AppDataStore.getById('users', attendeeId)
            : (attendeeType === 'prospect' ? await AppDataStore.getById('prospects', attendeeId) : await AppDataStore.getById('customers', attendeeId));

        // String()-normalize ids (see openAttendeeOutcomeModal) so number-vs-string
        // id types still match the existing note instead of duplicating it.
        const existingNote = (await AppDataStore.query('notes', { activity_id: activityId, note_type: 'post_meetup' }).catch(() => [])).find(n =>
            ((attendeeType === 'agent' && String(n.agent_id) === String(attendeeId)) ||
                (attendeeType === 'prospect' && String(n.prospect_id) === String(attendeeId)) ||
                (attendeeType === 'customer' && String(n.customer_id) === String(attendeeId))));

        const content = `
            <div class="form-group">
                <label>Post-Meetup Notes for ${esc(attendee?.full_name || 'Attendee')} (${attendeeType})</label>
                <textarea id="attendee-notes-text" class="form-control" rows="4" placeholder="Enter key points, next steps, etc...">${esc(existingNote?.text || '')}</textarea>
            </div>
        `;

        UI.showModal('Post-Meetup Notes', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save Notes', type: 'primary', action: `(async () => { await app.saveAttendeeNote(${attendeeId}, '${attendeeType}', ${activityId}, 'post_meetup'); })()` }
        ]);
    };

    const saveAttendeeNote = async (attendeeId, attendeeType, activityId, noteType) => {
        const textAreaId = noteType === 'outcome' ? 'attendee-outcome-text' : 'attendee-notes-text';
        const text = document.getElementById(textAreaId)?.value?.trim();

        if (!text) {
            UI.toast.error('Please enter some text.');
            return;
        }

        const currentUser = await Auth.getCurrentUser();
        const noteData = {
            activity_id: activityId,
            note_type: noteType,
            text: text,
            author: currentUser?.full_name || 'System',
            date: new Date().toISOString().split('T')[0]
        };

        if (attendeeType === 'agent') noteData.agent_id = attendeeId;
        else if (attendeeType === 'prospect') noteData.prospect_id = attendeeId;
        else if (attendeeType === 'customer') noteData.customer_id = attendeeId;

        // Check if note already exists to update. String()-normalize the id
        // comparisons: attendeeId/activityId come in as bare numeric literals
        // from the modal action string, but notes ids may be string/UUID — strict
        // === would miss the match and create a duplicate note every save.
        // Scoped query by activity_id + note_type (was getAll over the whole notes
        // table + .find), then match the attendee on the small result.
        const _scopedNotes = await AppDataStore.query('notes', { activity_id: activityId, note_type: noteType }).catch(() => []);
        const existingNote = _scopedNotes.find(n =>
            ((attendeeType === 'agent' && String(n.agent_id) === String(attendeeId)) ||
                (attendeeType === 'prospect' && String(n.prospect_id) === String(attendeeId)) ||
                (attendeeType === 'customer' && String(n.customer_id) === String(attendeeId))));

        if (existingNote) {
            await AppDataStore.update('notes', existingNote.id, noteData);
        } else {
            await AppDataStore.create('notes', noteData);
        }

        UI.toast.success('Note saved successfully');
        UI.hideModal();
        // Re-open activity details to show updated state if needed, 
        // but since notes aren't directly rendered in the list yet, we'll just close.
    };

    const addCoAgentToActivity = async (activityId) => {
        await app.editActivity(activityId);
        // Was a parenthesized comma expression `(() => {...}, 350)` — the arrow
        // function was created then discarded and the body never ran, so the
        // co-agent section never auto-expanded/focused. Wrap in setTimeout so it
        // fires after the edit modal mounts (matches rescheduleActivity/postMeetupNotes).
        setTimeout(() => {
            const coSectionStr = document.getElementById('co-agent-section')?.style.display;
            if (coSectionStr === 'none' || !coSectionStr) {
                app.toggleCoAgentSection();
            }
            document.getElementById('co-agent-search-input')?.focus();
        }, 350);
    };

    const getAgentName = async (agentId) => {
        const agent = await AppDataStore.getById('users', agentId);
        return agent?.full_name || 'Unknown';
    };

    // ========== PHASE 2: ACTIVITY MODAL + APPT + PUSH + PAST RECORD ==========
    app.register('calendar', {
        showCalendarView,
        loadFollowUpTemplates,
        invalidateFollowUpTemplatesCache,
        getFollowUpTemplate,
        interpolateTemplate,
        createFollowUpDraft,
        scheduleCardExpiryReminder,
        executeEventBasedTrigger,
        executeSimpleTrigger,
        dispatchAfterCpsTriggers,
        dispatchOnEventAttendanceTriggers,
        dispatchOnApuPhotoTriggers,
        bulkDispatchApuReminders,
        dispatchProactiveEventInvites,
        dispatchOnNewCalendarEvent,
        dispatchBirthdayTriggers,
        dispatchPendingSolutionReminders,
        dispatchReEngagementReminders,
        dispatchCustomerCheckins,
        dispatchApuAckTouches,
        dispatchAppointmentReminders,
        dispatchVoucherNudges,
        renderFollowUpReminders,
        composeFollowUpList,
        markFollowUpSent,
        dismissFollowUp,
        sendFollowUpInvite,
        renderPendingSolutionsWidget,
        renderCalendar,
        getDotColor,
        openCalendarFilterModal,
        applyCalendarFilters,
        clearCalendarFilters,
        storedFilters,
        renderTodayActivities,
        renderBirthdaySection,
        checkRefillReminderTable,
        showRefillMigrationModal,
        renderRefillReminders,
        sendRefillWhatsApp,
        sendDescriptionInvite,
        dismissRefillReminder,
        viewRefillProspect,
        openSendBirthdayWish,
        executeSendBirthdayWish,
        sendTeamBirthdayWish,
        openPrepareGiftModal,
        logBirthdayGift,
        switchView,
        goToToday,
        goToPrevious,
        goToNext,
        openMonthPicker,
        jumpToMonth,
        openDayView,
        updateMonthHeader,
        renderMonthView,
        renderWeekView,
        renderDayView,
        todo,
        viewActivityDetails,
        openActivityRepairModal,
        repairSearchEntities,
        repairActivityRelink,
        repairActivityDetach,
        openMeetingCapture,
        closeMeetingCapture,
        mcSelectCategory,
        mcAddItem,
        mcRemoveItem,
        mcToggleMic,
        endMeetingCapture,
        uploadCPSForm,
        editActivityTiming,
        autoSetEndTime,
        saveActivityTiming,
        openPostMeetupModal,
        savePostMeetup,
        openMeetingOutcomeModal,
        saveMeetingOutcome,
        parseSelectedItems,
        serializeMultiSelectToText,
        serializeEventSelectToText,
        openPostMeetupNotesModal,
        _lookupActivityRobust,
        savePostMeetupNotes,
        openAttendeePostEventModal,
        saveAttendeePostEventNotes,
        getProspectAttendeeNotes,
        viewAttendeePhotos,
        removeAttendeePhoto,
        editActivity,
        deleteActivity,
        confirmDeleteActivity,
        markActivityComplete,
        postMeetupNotes,
        openMeetupHistoryModal,
        rescheduleActivity,
        postEventFollowUp,
        openAttendeeOutcomeModal,
        openAttendeeNotesModal,
        saveAttendeeNote,
        addCoAgentToActivity,
        getAgentName,
        showSyncErrorModal,
        discardFailedActivity,
    });

    function discardFailedActivity(localId) {
        if (!localId) return;
        _optimisticActivities.delete(localId);
        // Also evict from the mcal retry queue so it doesn't re-surface.
        try {
            const qKey = 'fs_crm_mcal_retry_queue';
            const q = JSON.parse(localStorage.getItem(qKey) || '[]');
            const filtered = q.filter(item => item.tmpId !== localId);
            if (filtered.length !== q.length) localStorage.setItem(qKey, JSON.stringify(filtered));
        } catch (_) { /* intentional: best-effort retry-queue eviction */ }
        if (typeof renderCalendar === 'function') renderCalendar().catch(() => {});
        UI.toast.success('Activity discarded.');
    }

    function showSyncErrorModal(localId, errorMsg, errorCode) {
        const codeHint = errorCode === '23503'
            ? 'The linked contact doesn\'t exist on the server yet — make sure their record synced first, then re-enter this activity.'
            : errorCode === '42703' || (errorMsg && errorMsg.includes('column'))
                ? 'A field in this activity doesn\'t exist in the database yet. Ask your admin to run the pending migration, then re-enter.'
                : errorCode
                    ? `Server error code: ${errorCode}.`
                    : '';
        const humanMsg = errorMsg || 'Save failed — could not sync to server.';
        UI.showModal('⚠ Sync Failed', `
            <div style="display:flex;flex-direction:column;gap:12px;">
                <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:12px 14px;font-size:13px;color:#7f1d1d;">
                    <strong>${humanMsg}</strong>
                    ${codeHint ? `<div style="margin-top:6px;color:#991b1b;">${codeHint}</div>` : ''}
                </div>
                <div style="font-size:13px;color:#374151;">
                    This appointment was saved on this device but <strong>did not reach the server</strong>.
                    Other users cannot see it yet. You can discard it and re-enter it once the issue is resolved.
                </div>
            </div>
        `, [
            { label: 'Keep (retry later)', type: 'secondary', action: 'UI.hideModal()' },
            { label: '🗑 Discard', type: 'danger', action: `(async () => { app.discardFailedActivity(${JSON.stringify(localId)}); UI.hideModal(); })()` },
        ]);
    }
})();