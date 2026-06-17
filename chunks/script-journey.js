/**
 * CRM Lazy Chunk: Journey System — 21-Step Revenue Operating System
 * Loaded on-demand when opening the Journey accordion or journey dashboard.
 * Updated 2026-06-09: Full 21-step business journey + 7 product tracks.
 */
(() => {
    const _state   = window._appState;
    const _utils   = window._crmUtils;
    const esc      = (...a) => _utils.escapeHtml(...a);
    const isMobile = () => _utils.isMobile();

    const isSystemAdmin      = (u) => _utils.isSystemAdmin(u || _state.cu);
    const isMarketingManager = (u) => _utils.isMarketingManager(u || _state.cu);
    const isManagement       = (u) => _utils.isManagement(u || _state.cu);
    const isTeamLeaderOrAbove= (u) => _utils.isTeamLeaderOrAbove(u || _state.cu);

    const _cu = () => _state.cu;

    // ── Stage Labels ─────────────────────────────────────────────────────────
    // Covers: all 7 product pre-purchase funnels + 21-step post-purchase journey
    // + annual touchpoints + nurture track.

    const STAGE_LABELS = {
        // ── Legacy generic stages (backwards compat for old touchpoints) ─────
        first_contact:   '首次接触',
        engagement:      '互动阶段',
        value_milestone: '30日里程碑',
        decision:        '决策阶段',
        onboarding:      '新客入门',
        active_client_y1:'Y1 活跃客户',
        growth_y2:       'Y2 成长',
        growth_y3:       'Y3 成长',
        growth_y4:       'Y4 成长',
        growth_y5:       'Y5 成长',

        // ── Power Ring (pr_) ─────────────────────────────────────────────────
        pr_post_cps:         '💍 改命戒指 — CPS后',
        pr_invited_9star:    '💍 改命戒指 — 九星课受邀',
        pr_post_9star:       '💍 改命戒指 — 九星课后',
        pr_invited_sharing:  '💍 改命戒指 — 改命会受邀',
        pr_post_sharing:     '💍 改命戒指 — 改命会后',
        pr_invited_museum:   '💍 改命戒指 — 博物馆受邀',
        pr_post_museum:      '💍 改命戒指 — 博物馆后',
        pr_invited_huiji:    '💍 改命戒指 — 汇集受邀',
        pr_post_huiji:       '💍 改命戒指 — 汇集后',
        pr_fsa_scheduled:    '💍 改命戒指 — 1对1 FSA',
        pr_decision:         '💍 改命戒指 — 决策阶段',

        // ── Feng Shui Audit (fs_) ────────────────────────────────────────────
        fs_post_cps:         '🏠 风水方案 — CPS后',
        fs_invited_diy:      '🏠 风水方案 — DIY受邀',
        fs_post_diy:         '🏠 风水方案 — DIY后',
        fs_invited_sharing:  '🏠 风水方案 — 分享会受邀',
        fs_post_sharing:     '🏠 风水方案 — 分享会后',
        fs_invited_museum:   '🏠 风水方案 — 博物馆受邀',
        fs_post_museum:      '🏠 风水方案 — 博物馆后',
        fs_invited_huiji:    '🏠 风水方案 — 汇集受邀',
        fs_post_huiji:       '🏠 风水方案 — 汇集后',
        fs_fsa_scheduled:    '🏠 风水方案 — 1对1 FSA',
        fs_decision:         '🏠 风水方案 — 决策阶段',

        // ── Calligraphy (cal_) ───────────────────────────────────────────────
        cal_post_cps:        '🖌️ 画作 — CPS后',
        cal_invited_sharing: '🖌️ 画作 — 画作会受邀',
        cal_post_sharing:    '🖌️ 画作 — 画作会后',
        cal_invited_art:     '🖌️ 画作 — 艺品会受邀',
        cal_post_art:        '🖌️ 画作 — 艺品会后',
        cal_invited_huiji:   '🖌️ 画作 — 汇集受邀',
        cal_post_huiji:      '🖌️ 画作 — 汇集后',
        cal_decision:        '🖌️ 画作 — 决策阶段',

        // ── Bujishu Bed (bed_) ───────────────────────────────────────────────
        bed_post_cps:        '🛏️ 旺床 — CPS后',
        bed_invited_sharing: '🛏️ 旺床 — 分享会受邀',
        bed_post_sharing:    '🛏️ 旺床 — 分享会后',
        bed_invited_huiji:   '🛏️ 旺床 — 汇集受邀',
        bed_post_huiji:      '🛏️ 旺床 — 汇集后',
        bed_decision:        '🛏️ 旺床 — 决策阶段',

        // ── Bujishu Sofa (sofa_) ─────────────────────────────────────────────
        sofa_post_cps:       '🛋️ 旺沙发 — CPS后',
        sofa_invited_sharing:'🛋️ 旺沙发 — 分享会受邀',
        sofa_post_sharing:   '🛋️ 旺沙发 — 分享会后',
        sofa_invited_huiji:  '🛋️ 旺沙发 — 汇集受邀',
        sofa_post_huiji:     '🛋️ 旺沙发 — 汇集后',
        sofa_decision:       '🛋️ 旺沙发 — 决策阶段',

        // ── Bujishu Curtain (curtain_) ───────────────────────────────────────
        curtain_post_cps:         '🪟 旺窗帘 — CPS后',
        curtain_invited_sharing:  '🪟 旺窗帘 — 分享会受邀',
        curtain_post_sharing:     '🪟 旺窗帘 — 分享会后',
        curtain_invited_huiji:    '🪟 旺窗帘 — 汇集受邀',
        curtain_post_huiji:       '🪟 旺窗帘 — 汇集后',
        curtain_decision:         '🪟 旺窗帘 — 决策阶段',

        // ── Formula Health Care (hc_) ────────────────────────────────────────
        hc_post_cps:         '💊 健康 — CPS后',
        hc_invited_sharing:  '💊 健康 — 福粒会受邀',
        hc_post_sharing:     '💊 健康 — 福粒会后',
        hc_invited_launch:   '💊 健康 — 新品发布受邀',
        hc_post_launch:      '💊 健康 — 新品发布后',
        hc_invited_memberday:'💊 健康 — 会员日受邀',
        hc_post_memberday:   '💊 健康 — 会员日后',
        hc_decision:         '💊 健康 — 决策阶段',

        // ── Post-purchase: 21-Step Customer Journey ──────────────────────────
        step05_golden_path:      'Step 5 — 黄金大道',
        step06_exchange:         'Step 6 — 感恩交流',
        step07_spread:           'Step 7 — 传福',
        step08_testimony:        'Step 8 — 见证',
        step09_intro:            'Step 9 — 转介绍',
        step10_ambassador_cand:  'Step 10 — 准大使候选',
        step11_ambassador_path:  'Step 11 — 准传福大使',
        step12_group_sharing:    'Step 12 — 小组分享',
        step13_ambassador:       'Step 13 — 传福大使',
        step14_blueprint:        'Step 14 — 3年蓝图',
        step15_new_product:      'Step 15 — 第二产品',
        step16_multi_product:    'Step 16 — 多产品',
        step17_dc_meetup:        'Step 17 — DC招商会',
        step18_advanced:         'Step 18 — 高阶培训',
        step19_case_study:       'Step 19 — 案例贡献',
        step20_leadership:       'Step 20 — 领导团队',
        step21_legacy:           'Step 21 — 三年成就',

        // ── Annual recurring touchpoints ─────────────────────────────────────
        annual_flying_stars:     '年度 — 飞星提醒',
        annual_birthday:         '年度 — 生日祝福',
        annual_spring:           '年度 — 立春',
        annual_midyear:          '年度 — 中年检视',
        annual_dongzhi:          '年度 — 冬至',
        annual_forecast:         '年度 — 运程讲座',
        annual_xingua:           '年度 — 星卦解运',

        // ── Nurture ──────────────────────────────────────────────────────────
        nurture:                 '缓和培育',
    };

    // Stage order per product track — drives the timeline display
    const STAGE_ORDER_BY_TRACK = {
        pr:      ['pr_post_cps','pr_invited_9star','pr_post_9star','pr_invited_sharing',
                  'pr_post_sharing','pr_invited_museum','pr_post_museum',
                  'pr_invited_huiji','pr_post_huiji','pr_fsa_scheduled','pr_decision'],
        fs:      ['fs_post_cps','fs_invited_diy','fs_post_diy','fs_invited_sharing',
                  'fs_post_sharing','fs_invited_museum','fs_post_museum',
                  'fs_invited_huiji','fs_post_huiji','fs_fsa_scheduled','fs_decision'],
        cal:     ['cal_post_cps','cal_invited_sharing','cal_post_sharing',
                  'cal_invited_art','cal_post_art','cal_invited_huiji','cal_post_huiji','cal_decision'],
        bed:     ['bed_post_cps','bed_invited_sharing','bed_post_sharing',
                  'bed_invited_huiji','bed_post_huiji','bed_decision'],
        sofa:    ['sofa_post_cps','sofa_invited_sharing','sofa_post_sharing',
                  'sofa_invited_huiji','sofa_post_huiji','sofa_decision'],
        curtain: ['curtain_post_cps','curtain_invited_sharing','curtain_post_sharing',
                  'curtain_invited_huiji','curtain_post_huiji','curtain_decision'],
        hc:      ['hc_post_cps','hc_invited_sharing','hc_post_sharing',
                  'hc_invited_launch','hc_post_launch','hc_invited_memberday',
                  'hc_post_memberday','hc_decision'],
        post:    ['step05_golden_path','step06_exchange','step07_spread','step08_testimony',
                  'step09_intro','step10_ambassador_cand','step11_ambassador_path',
                  'step12_group_sharing','step13_ambassador','step14_blueprint',
                  'step15_new_product','step16_multi_product','step17_dc_meetup',
                  'step18_advanced','step19_case_study','step20_leadership','step21_legacy'],
    };

    // Flat STAGE_ORDER for backwards compat (used by spawn modal selector)
    const STAGE_ORDER = [
        ...STAGE_ORDER_BY_TRACK.pr,
        ...STAGE_ORDER_BY_TRACK.fs,
        ...STAGE_ORDER_BY_TRACK.cal,
        ...STAGE_ORDER_BY_TRACK.bed,
        ...STAGE_ORDER_BY_TRACK.sofa,
        ...STAGE_ORDER_BY_TRACK.curtain,
        ...STAGE_ORDER_BY_TRACK.hc,
        ...STAGE_ORDER_BY_TRACK.post,
        'annual_flying_stars','annual_birthday','annual_spring',
        'annual_midyear','annual_dongzhi','annual_forecast','annual_xingua',
        'nurture',
    ];

    // Detect which product track a stage belongs to
    const TRACK_PREFIXES = ['pr_','fs_','cal_','bed_','sofa_','curtain_','hc_'];
    function getTrackForStage(stageName) {
        if (!stageName) return 'post';
        for (const p of TRACK_PREFIXES) {
            if (stageName.startsWith(p)) return p.replace('_','');
        }
        if (stageName.startsWith('step')) return 'post';
        if (stageName.startsWith('annual_')) return 'annual';
        return 'post';
    }

    const PRIORITY_COLOR = { high: '#dc2626', med: '#f59e0b', low: '#16a34a' };
    const PRIORITY_LABEL = { high: 'High',    med: 'Medium',  low: 'Low'    };

    const STATUS_ICON = {
        pending:   'fas fa-clock',
        overdue:   'fas fa-fire',
        done:      'fas fa-check-circle',
        skipped:   'fas fa-forward',
        snoozed:   'fas fa-bell-slash',
        auto_sent: 'fab fa-whatsapp',
    };
    const STATUS_COLOR = {
        pending:   'var(--gray-400)',
        overdue:   '#dc2626',
        done:      '#16a34a',
        skipped:   'var(--gray-400)',
        snoozed:   '#f59e0b',
        auto_sent: '#25d366',
    };

    const TYPE_ICON = {
        task:          'fas fa-tasks',
        call:          'fas fa-phone',
        meeting:       'fas fa-handshake',
        whatsapp_auto: 'fab fa-whatsapp',
    };

    const FOLLOW_MODE_LABEL = {
        active:        '🟡 Active',
        warm_hold:     '🟢 Warm Hold',
        gentle_nurture:'🔵 Gentle Nurture',
    };

    // ── Helpers ──────────────────────────────────────────────────────────────

    function fmtDate(iso) {
        if (!iso) return '-';
        const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
        return d.toLocaleDateString('en-MY', { day:'2-digit', month:'short', year:'numeric' });
    }

    function daysFromNow(iso) {
        if (!iso) return null;
        const d = new Date(iso + 'T00:00:00');
        const today = new Date(); today.setHours(0,0,0,0);
        return Math.round((d - today) / 86400000);
    }

    function relDue(iso) {
        const n = daysFromNow(iso);
        if (n === null) return '';
        if (n < 0)  return `<span style="color:#dc2626;font-weight:600;">${Math.abs(n)}d overdue</span>`;
        if (n === 0) return `<span style="color:#f59e0b;font-weight:600;">Due today</span>`;
        if (n === 1) return `<span style="color:#f59e0b;">Due tomorrow</span>`;
        return `<span style="color:var(--gray-500);">Due in ${n}d</span>`;
    }

    // ── Scoring Engine ───────────────────────────────────────────────────────

    // Activity type → score weight mapping.
    // Rules: warm_hold = no decay. active = -1pt/3d after D+14. gentle_nurture = -1pt/day after D+21.
    const SCORE_WEIGHTS = {
        // Core activities
        ftf_logged:               15,
        cps_logged:               15,
        fsa_logged:               12,
        call_logged:               8,
        whatsapp_logged:           8,
        reply_received:            8,
        proposal_opened:          12,
        event_attended:           10,
        // Power Ring funnel events
        pr_9star_class_attended:  12,
        pr_sharing_attended:      15,
        pr_museum_attended:       15,
        pr_huiji_attended:        18,
        pr_fsa_completed:         20,
        // FS Audit funnel events
        fs_diy_attended:          12,
        fs_sharing_attended:      15,
        fs_museum_attended:       15,
        fs_huiji_attended:        18,
        fs_fsa_completed:         20,
        // Universal purchase + post-purchase
        purchase_signed:          30,
        gr_activity_logged:       10,
        testimony_recorded:       20,
        referral_intro_given:     15,
        ambassador_nominated:     20,
        ambassador_confirmed:     25,
        // Annual engagement
        flying_star_engaged:       5,
        birthday_replied:          8,
        xingua_booked:            10,
    };

    // Decay rates per follow_mode:
    const DECAY_CONFIG = {
        warm_hold:      { startDay:  0, ratePerDay: 0     },  // no decay
        active:         { startDay: 14, ratePerDay: 1/3   },  // -1pt/3d
        gentle_nurture: { startDay: 21, ratePerDay: 1     },  // -1pt/day
    };

    async function recalcProspectScore(prospectId) {
        try {
            const activities = await AppDataStore.getActivitiesForProspect(prospectId);
            if (!activities || !activities.length) return 0;

            // Get current follow_mode from latest journey touchpoint
            const touchpoints = await AppDataStore.getJourneyTouchpoints('prospect', prospectId);
            const latestPending = touchpoints.find(t =>
                ['pending','overdue','snoozed'].includes(t.status)
            );
            const currentMode = latestPending?.follow_mode || 'active';
            const decayCfg = DECAY_CONFIG[currentMode] || DECAY_CONFIG.active;

            const now = Date.now();
            let score = 0;

            for (const act of activities) {
                const actType = act.activity_type?.toLowerCase() || '';
                const eventCat = act.event_category?.toLowerCase() || '';

                // Map activity_type + event_category to score weight
                let w = SCORE_WEIGHTS[actType] || SCORE_WEIGHTS[eventCat] || 5;

                // Event activity: use event_category key if it has its own weight
                if (actType === 'event' && eventCat) {
                    w = SCORE_WEIGHTS[eventCat] || SCORE_WEIGHTS['event_attended'] || 10;
                }

                const actDate = new Date(act.activity_date || act.created_at).getTime();
                const ageD = (now - actDate) / 86400000;
                let decay = 1;
                if (decayCfg.startDay > 0 && ageD > decayCfg.startDay) {
                    const penaltyDays = ageD - decayCfg.startDay;
                    decay = Math.max(0, 1 - penaltyDays * decayCfg.ratePerDay);
                }
                score += Math.round(w * decay);
            }

            // Deal value multiplier (high-value prospects score more)
            const prospect = await AppDataStore.getById('prospects', prospectId);
            if (prospect?.deal_value && prospect.deal_value >= 200000) score = Math.round(score * 1.3);

            score = Math.min(score, 150);
            return score;
        } catch (e) {
            console.warn('[journey] recalcProspectScore', e?.message);
            return 0;
        }
    }

    // ── Conditional Rules Engine ─────────────────────────────────────────────
    // context: { productTrack?, fromStage?, currentScore? }

    async function evaluateConditionalRules(entityType, entityId, triggerEvent, context = {}) {
        try {
            const rules = await AppDataStore.getConditionalRules();
            const matched = rules.filter(r => r.trigger_event === triggerEvent && r.is_active);
            if (!matched.length) return;

            for (const rule of matched) {

                // ── skip_to_stage ──────────────────────────────────────────
                if (rule.action === 'skip_to_stage') {
                    const targetStage  = rule.action_payload?.stage;
                    const productTrack = rule.action_payload?.product_track || context.productTrack || null;
                    const clearPre     = rule.action_payload?.clear_pre_purchase || false;
                    if (!targetStage) continue;

                    await AppDataStore.logStageTransition(
                        entityType, entityId,
                        context.fromStage || null,
                        targetStage,
                        `Auto: rule [${rule.id}] — ${triggerEvent}`
                    );

                    // Get next event date if this is an event-linked stage
                    const eventCategory = _stageToEventCategory(targetStage);
                    const nextEventDate = eventCategory
                        ? await AppDataStore.getNextEventDate(eventCategory)
                        : null;

                    const spawnOpts = {
                        startDate:    nextEventDate ? new Date(nextEventDate + 'T00:00:00') : new Date(),
                        track:        targetStage === 'nurture' ? 'nurture' : 'active',
                        assignedTo:   _cu()?.id || null,
                        productTrack: productTrack,
                    };
                    const n = await AppDataStore.spawnTouchpointsForStage(
                        entityType, entityId, targetStage, spawnOpts
                    );

                    if (n > 0) {
                        const lbl = STAGE_LABELS[targetStage] || targetStage;
                        UI.toast.success(`✅ 进入阶段: ${lbl}${nextEventDate ? ' · 日期已锁定' : ''}`);
                    }
                }

                // ── move_to_nurture ────────────────────────────────────────
                else if (rule.action === 'move_to_nurture') {
                    await AppDataStore.logStageTransition(
                        entityType, entityId,
                        context.fromStage || null,
                        'nurture',
                        `Auto: rule [${rule.id}] — ${triggerEvent}`
                    );
                    const n = await AppDataStore.spawnTouchpointsForStage(
                        entityType, entityId, 'nurture',
                        { track: 'nurture', assignedTo: _cu()?.id || null }
                    );
                    if (n > 0) UI.toast.info('💤 已移至缓和培育轨道');

                    // Update follow_mode on all pending touchpoints
                    await _updatePendingFollowMode(entityType, entityId, 'gentle_nurture');
                }

                // ── move_to_active ─────────────────────────────────────────
                else if (rule.action === 'move_to_active') {
                    const stage = rule.action_payload?.stage || 'pr_post_cps';
                    await AppDataStore.logStageTransition(
                        entityType, entityId, 'nurture', stage,
                        `Auto: rule [${rule.id}] — ${triggerEvent}`
                    );
                    const n = await AppDataStore.spawnTouchpointsForStage(
                        entityType, entityId, stage,
                        { track: 'active', assignedTo: _cu()?.id || null }
                    );
                    if (n > 0) UI.toast.success(`🔥 重新激活 → ${STAGE_LABELS[stage] || stage}`);
                    await _updatePendingFollowMode(entityType, entityId, 'active');
                }

                // ── accelerate ────────────────────────────────────────────
                else if (rule.action === 'accelerate') {
                    const reduceDays = rule.action_payload?.reduce_offset_days || 7;
                    // Move all pending future due dates earlier by reduceDays
                    const touchpoints = await AppDataStore.getJourneyTouchpoints(entityType, entityId);
                    const today = new Date().toISOString().slice(0, 10);
                    const toAccelerate = touchpoints.filter(t =>
                        t.status === 'pending' && t.due_date > today
                    );
                    for (const tp of toAccelerate) {
                        const d = new Date(tp.due_date + 'T00:00:00');
                        d.setDate(d.getDate() - reduceDays);
                        const newDate = d.toISOString().slice(0, 10);
                        if (newDate >= today) {
                            await AppDataStore.updateTouchpointStatus(tp.id, 'pending', {
                                notes: `Accelerated by ${reduceDays}d (score > 70)`
                            });
                        }
                    }
                    UI.toast.info(`⚡ 跟进日期提前了 ${reduceDays} 天`);
                }

                // ── pause ─────────────────────────────────────────────────
                else if (rule.action === 'pause') {
                    await AppDataStore.logStageTransition(
                        entityType, entityId, null, 'paused',
                        `Auto: rule [${rule.id}] — ${triggerEvent} (${Math.round(90)} days no reply)`
                    );
                    UI.toast.info('⏸️ 跟进已暂停 (90天无回应)');
                }

                // ── escalate ──────────────────────────────────────────────
                else if (rule.action === 'escalate') {
                    const reason = rule.action_payload?.reason || '需要关注';
                    const notify = rule.action_payload?.notify || 'team_leader';
                    console.log(`[journey] ESCALATE: ${entityType} ${entityId} — ${reason}`);
                    // Creates a high-priority touchpoint assigned to TL for review
                    await window.supabase?.from('journey_touchpoints').insert({
                        [entityType === 'customer' ? 'customer_id' : 'prospect_id']: entityId,
                        stage_name:     'escalation',
                        track:          'active',
                        touchpoint_type:'task',
                        title:          `⚠️ 升级处理: ${reason}`,
                        due_date:       new Date().toISOString().slice(0, 10),
                        priority:       'high',
                        status:         'pending',
                        assigned_to:    _cu()?.id || null,
                        follow_mode:    'active',
                        notes:          `Triggered by: ${triggerEvent}`,
                    });
                    UI.toast.warning(`⚠️ 已升级至 ${notify}: ${reason}`);
                }

                // ── role_upgrade ──────────────────────────────────────────
                else if (rule.action === 'role_upgrade') {
                    const roleLevel = rule.action_payload?.role_level;
                    const roleName  = rule.action_payload?.role_name || '';
                    const notifyAgent = rule.action_payload?.notify_agent || false;
                    if (!roleLevel) continue;

                    const table = entityType === 'customer' ? 'customers' : 'prospects';
                    const newRole = `Level ${roleLevel} ${roleName}`;

                    await AppDataStore.update(table, entityId, {
                        role: newRole,
                        updated_at: new Date().toISOString(),
                    });

                    if (notifyAgent) {
                        UI.toast.success(`🎉 角色升级 → ${roleName}`);
                    }

                    // For purchase_signed: also create the Customer record if this
                    // prospect just hit customer level (13). Reuse the canonical
                    // conversion routine (app.approveProspectConversion) — the same
                    // record-creator the manager auto-convert path uses — rather than
                    // hand-rolling a second conversion. DATA-MUTATING: stay conservative.
                    if (roleLevel === 13 && entityType === 'prospect') {
                        try {
                            // Re-fetch fresh: role was just updated above, and we must
                            // check the latest conversion flags for idempotency.
                            const p = await AppDataStore.getById('prospects', entityId);
                            if (p) {
                                // Idempotency guard — never double-convert. A prospect is
                                // already a customer if it is flagged converted/approved or
                                // a customers row already links back to it.
                                let alreadyCustomer =
                                    p.status === 'converted' ||
                                    p.conversion_status === 'approved';
                                if (!alreadyCustomer) {
                                    try {
                                        const linked = await AppDataStore.query('customers', {
                                            converted_from_prospect_id: entityId,
                                        });
                                        alreadyCustomer = Array.isArray(linked) && linked.length > 0;
                                    } catch (lookupErr) {
                                        console.warn('[journey] customer-link lookup failed', lookupErr?.message);
                                    }
                                }

                                if (alreadyCustomer) {
                                    console.log('[journey] prospect → customer: already converted, skipping', entityId);
                                } else {
                                    // Only auto-create the Customer record when there is real
                                    // sale evidence (a closing_record with a positive amount).
                                    // approveProspectConversion derives lifetime_value /
                                    // customer_since from that record — without it we would
                                    // fabricate an empty/zero customer, so we instead flag the
                                    // record for manual completion via app.convertToCustomer.
                                    const saleAmount = parseFloat(p.closing_record?.sale_amount) || 0;
                                    if (p.closing_record && saleAmount > 0 &&
                                        typeof window.app?.approveProspectConversion === 'function') {
                                        await window.app.approveProspectConversion(entityId);
                                    } else if (p.conversion_status !== 'pending_approval') {
                                        // No sale data to copy — don't invent a customer record.
                                        // Park it for manual review so an agent/manager can
                                        // complete the conversion via the existing flow.
                                        await AppDataStore.update('prospects', entityId, {
                                            conversion_status: 'pending_approval',
                                            conversion_requested_at: new Date().toISOString(),
                                            conversion_requested_by: _cu()?.id || null,
                                            updated_at: new Date().toISOString(),
                                        });
                                        UI.toast.info('🎯 已达成交客户等级 — 请确认转为客户 (Convert to Customer)');
                                    }
                                }
                            }
                        } catch (convErr) {
                            // Never throw into the rule loop / journey render.
                            console.warn('[journey] prospect → customer conversion failed', convErr?.message);
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('[journey] evaluateConditionalRules', e?.message);
        }
    }

    // Maps a stage name to the event category string for next-event-date lookup.
    function _stageToEventCategory(stageName) {
        const map = {
            pr_invited_9star:    'pr_9star',
            pr_post_9star:       'pr_9star',
            pr_invited_sharing:  'pr_destiny',
            pr_post_sharing:     'pr_destiny',
            pr_invited_museum:   'pr_museum',
            pr_post_museum:      'pr_museum',
            pr_invited_huiji:    'painting_huiji',
            fs_invited_diy:      'fs_diy',
            fs_post_diy:         'fs_diy',
            fs_invited_sharing:  'fs_sharing',
            fs_post_sharing:     'fs_sharing',
            fs_invited_museum:   'fs_museum',
            fs_post_museum:      'fs_museum',
            fs_invited_huiji:    'fs_huiji',
            cal_invited_sharing: 'painting_sharing',
            cal_invited_art:     'painting_art',
            annual_forecast:     'annual_forecast',
            annual_xingua:       'annual_xingua',
        };
        return map[stageName] || null;
    }

    // Helper: update follow_mode on all pending touchpoints for an entity
    async function _updatePendingFollowMode(entityType, entityId, newMode) {
        try {
            const col = entityType === 'customer' ? 'customer_id' : 'prospect_id';
            await window.supabase
                ?.from('journey_touchpoints')
                .update({ follow_mode: newMode })
                .eq(col, entityId)
                .in('status', ['pending', 'snoozed']);
        } catch (e) {
            console.warn('[journey] _updatePendingFollowMode', e?.message);
        }
    }

    // ── Main render entry point ───────────────────────────────────────────────

    // React journey-timeline passthrough — DEFAULT-ON (e2e-verified live 2026-06-16:
    // stats/timeline/empty-state render through the React root, 0 unhandled
    // rejections). Kill-switch: window.__REACT_JOURNEY=false | ?react_journey=0 |
    // crm_react_journey='0' (plus the global ?react=0 / crm_react_off='1').
    const _reactJourneyOn = () => {
        try {
            if (/[?&]react=0/.test(location.search)) return false;
            if (localStorage.getItem('crm_react_off') === '1') return false;
            if (!(window.CRMReact && typeof window.CRMReact.mountJourneyContent === 'function')) return false;
            if (window.__REACT_JOURNEY === false) return false;
            if (/[?&]react_journey=0/.test(location.search)) return false;
            if (localStorage.getItem('crm_react_journey') === '0') return false;
            return true;
        } catch (_) { return false; }
    };
    // Render the assembled journey HTML into `container`, routed through the
    // dedicated journey React root when enabled (re-mount on each call — including
    // _refreshJourneyTab after touchpoint mutations). Inline app.* onclicks survive
    // (dangerouslySetInnerHTML). flushSync makes the DOM present synchronously.
    const _rxRenderJourney = (container, viewHtml) => {
        if (_reactJourneyOn()) {
            container.innerHTML = '<div id="jny-react-root"></div>';
            const root = document.getElementById('jny-react-root');
            if (root && window.CRMReact && typeof window.CRMReact.mountJourneyContent === 'function') {
                try { window.CRMReact.mountJourneyContent(root, { html: viewHtml }); return; }
                catch (e) { console.warn('[journey] island mount failed, legacy:', e && e.message); }
            }
        }
        container.innerHTML = viewHtml;
    };

    // React aux-widget passthrough for the small read-only journey widgets
    // (agent dashboard + team-load panels). Two can be on-screen at once, so
    // these route through the MULTI-root mountJourneyAux (per-container roots),
    // NOT the singleton journey-timeline root. DEFAULT-ON; same kill-switches as
    // _reactJourneyOn plus a feature-detect on mountJourneyAux.
    const _reactJourneyAuxOn = () => {
        try {
            if (/[?&]react=0/.test(location.search)) return false;
            if (localStorage.getItem('crm_react_off') === '1') return false;
            if (!(window.CRMReact && typeof window.CRMReact.mountJourneyAux === 'function')) return false;
            if (window.__REACT_JOURNEY === false) return false;
            if (/[?&]react_journey=0/.test(location.search)) return false;
            if (localStorage.getItem('crm_react_journey') === '0') return false;
            return true;
        } catch (_) { return false; }
    };
    // Render an aux-widget body into `container` via the multi-root island when
    // enabled, else plain innerHTML. Inline app.navigateTo(...) onclicks survive
    // dangerouslySetInnerHTML.
    const _rxRenderAux = (container, html) => {
        if (_reactJourneyAuxOn()) {
            try { window.CRMReact.mountJourneyAux(container, { html }); return; }
            catch (e) { console.warn('[journey] aux island mount failed, legacy:', e && e.message); }
        }
        container.innerHTML = html;
    };

    const renderJourneyTab = async (entityType, entityId, container) => {
        if (!container) return;
        container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--gray-400);"><i class="fas fa-spinner fa-spin"></i> Loading journey…</div>';

        const touchpoints  = await AppDataStore.getJourneyTouchpoints(entityType, entityId);
        const stageLog     = await AppDataStore.getJourneyStageLog(entityType, entityId);
        const currentUser  = _cu();
        const canManage    = isTeamLeaderOrAbove(currentUser) || isSystemAdmin(currentUser);

        const active    = touchpoints.filter(t => t.track === 'active');
        const nurture   = touchpoints.filter(t => t.track === 'nurture');
        const hasNurture= nurture.length > 0;

        const overdueCount  = touchpoints.filter(t => t.status === 'overdue').length;
        const pendingCount  = touchpoints.filter(t => t.status === 'pending').length;
        const doneCount     = touchpoints.filter(t => ['done','auto_sent'].includes(t.status)).length;
        const totalCount    = touchpoints.length;
        const pct           = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;

        const latestLog    = stageLog[0];
        const currentStage = latestLog?.to_stage || (touchpoints[0]?.stage_name) || 'pr_post_cps';
        const activeTrack  = getTrackForStage(currentStage);

        // Get product tracks present in touchpoints
        const tracksPresent = [...new Set(touchpoints.map(t => getTrackForStage(t.stage_name)))].filter(Boolean);

        // Get latest follow_mode
        const latestPending = touchpoints.find(t => ['pending','overdue','snoozed'].includes(t.status));
        const followMode = latestPending?.follow_mode || 'active';

        _rxRenderJourney(container, `
            <style>
                .jny-wrap{font-size:14px;}
                .jny-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px;}
                .jny-stat{background:var(--gray-50);border:1px solid var(--gray-200);border-radius:10px;padding:10px;text-align:center;}
                .jny-stat .val{font-size:18px;font-weight:700;line-height:1.1;}
                .jny-stat .lbl{font-size:10px;color:var(--gray-500);margin-top:2px;}
                .jny-progress{background:var(--gray-200);border-radius:8px;height:8px;margin-bottom:16px;overflow:hidden;}
                .jny-progress-bar{height:100%;border-radius:8px;background:var(--primary);transition:width .4s;}
                .jny-timeline{display:flex;gap:4px;overflow-x:auto;padding:4px 0 12px;margin-bottom:14px;scrollbar-width:none;}
                .jny-timeline::-webkit-scrollbar{display:none;}
                .jny-ts-stage{flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;}
                .jny-ts-dot{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;border:2px solid transparent;transition:all .2s;}
                .jny-ts-dot.done{background:#16a34a;color:#fff;border-color:#16a34a;}
                .jny-ts-dot.active{background:var(--primary);color:#fff;border-color:var(--primary);box-shadow:0 0 0 3px rgba(128,0,32,.2);}
                .jny-ts-dot.future{background:var(--gray-100);color:var(--gray-500);border-color:var(--gray-300);}
                .jny-ts-dot.overdue{background:#dc2626;color:#fff;border-color:#dc2626;animation:pulse 1.5s infinite;}
                .jny-ts-lbl{font-size:9px;color:var(--gray-500);text-align:center;max-width:56px;line-height:1.2;}
                .jny-ts-conn{width:12px;height:2px;background:var(--gray-300);margin-top:13px;flex-shrink:0;}
                @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,.4);}50%{box-shadow:0 0 0 6px rgba(220,38,38,0);}}
                .jny-section-hdr{display:flex;justify-content:space-between;align-items:center;margin:12px 0 8px;font-weight:600;font-size:13px;color:var(--gray-700);}
                .jny-card{border:1px solid var(--gray-200);border-radius:10px;padding:12px;margin-bottom:8px;background:#fff;transition:box-shadow .15s;}
                .jny-card:hover{box-shadow:0 2px 8px rgba(0,0,0,.08);}
                .jny-card.overdue{border-color:#fca5a5;background:#fff5f5;}
                .jny-card.done{opacity:.6;background:var(--gray-50);}
                .jny-card-top{display:flex;align-items:flex-start;gap:8px;}
                .jny-card-icon{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;}
                .jny-card-body{flex:1;min-width:0;}
                .jny-card-title{font-weight:600;font-size:13px;margin-bottom:2px;line-height:1.3;}
                .jny-card-meta{font-size:11px;color:var(--gray-500);display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
                .jny-card-actions{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;}
                .jny-btn{height:28px;padding:0 10px;border-radius:6px;border:1px solid var(--gray-300);background:#fff;font-size:11px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:4px;transition:all .15s;}
                .jny-btn:hover{background:var(--gray-50);}
                .jny-btn.primary{background:var(--primary);color:#fff;border-color:var(--primary);}
                .jny-btn.primary:hover{opacity:.88;}
                .jny-btn.danger{color:#dc2626;border-color:#fca5a5;}
                .jny-btn.danger:hover{background:#fff5f5;}
                .jny-empty{text-align:center;padding:20px;color:var(--gray-400);font-size:13px;}
                .jny-track-tabs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;}
                .jny-track-tab{padding:5px 12px;border-radius:20px;border:1px solid var(--gray-300);font-size:12px;font-weight:600;cursor:pointer;background:#fff;transition:all .15s;}
                .jny-track-tab.active{background:var(--primary);color:#fff;border-color:var(--primary);}
                .jny-spawn-btn{display:flex;align-items:center;gap:6px;padding:10px 14px;border:1px dashed var(--gray-300);border-radius:10px;background:var(--gray-50);color:var(--gray-500);font-size:13px;cursor:pointer;width:100%;justify-content:center;margin-top:8px;transition:all .15s;}
                .jny-spawn-btn:hover{border-color:var(--primary);color:var(--primary);background:#fff;}
                .jny-mode-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:20px;font-size:11px;font-weight:600;background:var(--gray-100);color:var(--gray-600);margin-bottom:10px;}
            </style>

            <div class="jny-wrap">

                <!-- Progress summary -->
                <div class="jny-stats">
                    <div class="jny-stat">
                        <div class="val" style="color:#dc2626;">${overdueCount}</div>
                        <div class="lbl">逾期</div>
                    </div>
                    <div class="jny-stat">
                        <div class="val" style="color:var(--primary);">${pendingCount}</div>
                        <div class="lbl">待处理</div>
                    </div>
                    <div class="jny-stat">
                        <div class="val" style="color:#16a34a;">${doneCount}</div>
                        <div class="lbl">完成</div>
                    </div>
                    <div class="jny-stat">
                        <div class="val" style="color:var(--gray-600);">${pct}%</div>
                        <div class="lbl">进度</div>
                    </div>
                </div>
                <div class="jny-progress"><div class="jny-progress-bar" style="width:${pct}%"></div></div>

                <!-- Follow mode badge -->
                <div class="jny-mode-badge">${FOLLOW_MODE_LABEL[followMode] || followMode}
                    <span style="color:var(--gray-400);font-weight:400;">· 跟进模式</span>
                </div>

                <!-- Stage timeline — shows active product track or post-purchase steps -->
                ${renderStageTimeline(touchpoints, currentStage, activeTrack)}

                <!-- Track toggle tabs -->
                <div class="jny-track-tabs">
                    <div class="jny-track-tab active" id="jny-tab-active-${entityId}"
                         onclick="app.switchJourneyTrackDisplay('${entityType}',${entityId},'active',this)">
                        <i class="fas fa-route"></i> Active
                    </div>
                    ${hasNurture ? `
                    <div class="jny-track-tab" id="jny-tab-nurture-${entityId}"
                         onclick="app.switchJourneyTrackDisplay('${entityType}',${entityId},'nurture',this)">
                        <i class="fas fa-seedling"></i> Nurture
                    </div>` : ''}
                    ${tracksPresent.includes('annual') ? `
                    <div class="jny-track-tab" id="jny-tab-annual-${entityId}"
                         onclick="app.switchJourneyTrackDisplay('${entityType}',${entityId},'annual',this)">
                        <i class="fas fa-calendar-alt"></i> Annual
                    </div>` : ''}
                </div>

                <!-- Touchpoint list -->
                <div id="jny-list-${entityType}-${entityId}">
                    ${renderTouchpointList(active, entityType, entityId, canManage)}
                </div>

                <!-- Spawn touchpoints (admin/TL only) -->
                ${canManage ? `
                <button class="jny-spawn-btn" onclick="app.openSpawnTouchpointsModal('${entityType}',${entityId})">
                    <i class="fas fa-plus-circle"></i> 为阶段生成跟进任务
                </button>
                <button class="jny-spawn-btn" style="margin-top:4px;"
                        onclick="app.spawnAnnualTouchpoints('${entityType}',${entityId})">
                    <i class="fas fa-calendar-plus"></i> 生成年度跟进任务
                </button>` : ''}

                <!-- Stage history log -->
                ${stageLog.length ? `
                <div class="jny-section-hdr" style="margin-top:16px;">
                    <span><i class="fas fa-history" style="color:var(--primary);margin-right:6px;"></i>阶段历史</span>
                </div>
                <div style="font-size:12px;color:var(--gray-600);">
                    ${stageLog.slice(0, 5).map(s => `
                        <div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid var(--gray-100);">
                            <i class="fas fa-arrow-right" style="color:var(--primary);margin-top:2px;flex-shrink:0;"></i>
                            <div>
                                <span style="font-weight:600;">${esc(STAGE_LABELS[s.to_stage] || s.to_stage)}</span>
                                <span style="color:var(--gray-400);margin-left:6px;">${fmtDate(s.transitioned_at)}</span>
                                ${s.notes ? `<div style="color:var(--gray-500);font-style:italic;">${esc(s.notes)}</div>` : ''}
                            </div>
                        </div>`).join('')}
                </div>` : ''}

            </div>
        `);
    };

    function renderStageTimeline(touchpoints, currentStage, activeTrack) {
        // Pick the right order array based on active track
        const order = STAGE_ORDER_BY_TRACK[activeTrack] || STAGE_ORDER_BY_TRACK.post;

        const stageStatus = {};
        for (const stage of order) {
            const stageTps = touchpoints.filter(t => t.stage_name === stage && t.track === 'active');
            if (!stageTps.length) { stageStatus[stage] = 'future'; continue; }
            const hasOverdue = stageTps.some(t => t.status === 'overdue');
            const allDone    = stageTps.every(t => ['done','skipped','auto_sent'].includes(t.status));
            const isCurrent  = stage === currentStage;
            stageStatus[stage] = hasOverdue ? 'overdue' : allDone ? 'done' : isCurrent ? 'active' : 'future';
        }

        return `
            <div class="jny-timeline">
                ${order.map((stage, i) => {
                    const st = stageStatus[stage] || 'future';
                    const lbl = STAGE_LABELS[stage] || stage;
                    // Strip emoji + product prefix for compact label
                    const shortLbl = lbl.replace(/^[^\s—]+\s—\s/, '').replace('Step ','S').replace(' — ','·').slice(0,12);
                    return (i > 0 ? '<div class="jny-ts-conn"></div>' : '') +
                        `<div class="jny-ts-stage" title="${esc(lbl)}">
                            <div class="jny-ts-dot ${st}">
                                ${st === 'done'   ? '<i class="fas fa-check" style="font-size:9px;"></i>'
                                : st === 'overdue' ? '<i class="fas fa-fire" style="font-size:9px;"></i>'
                                : (i + 1)}
                            </div>
                            <div class="jny-ts-lbl">${esc(shortLbl)}</div>
                        </div>`;
                }).join('')}
            </div>
        `;
    }

    function renderTouchpointList(touchpoints, entityType, entityId, canManage) {
        if (!touchpoints.length) {
            return `<div class="jny-empty"><i class="fas fa-map-marker-alt" style="font-size:24px;margin-bottom:8px;display:block;"></i>暂无跟进任务<br>点击下方"生成跟进任务"开始旅程。</div>`;
        }

        const sorted = [...touchpoints].sort((a, b) => {
            const statusOrder = { overdue:0, pending:1, snoozed:2, done:3, skipped:3, auto_sent:3 };
            const so = (statusOrder[a.status] ?? 1) - (statusOrder[b.status] ?? 1);
            if (so !== 0) return so;
            return new Date(a.due_date) - new Date(b.due_date);
        });

        return sorted.map(tp => renderTouchpointCard(tp, entityType, entityId, canManage)).join('');
    }

    function renderTouchpointCard(tp, entityType, entityId, canManage) {
        const isDone    = ['done','skipped','auto_sent'].includes(tp.status);
        const isOverdue = tp.status === 'overdue';
        const pColor    = PRIORITY_COLOR[tp.priority] || '#94a3b8';
        const sIcon     = STATUS_ICON[tp.status]  || 'fas fa-circle';
        const sColor    = STATUS_COLOR[tp.status] || 'var(--gray-400)';
        const tIcon     = TYPE_ICON[tp.touchpoint_type] || 'fas fa-tasks';
        const modeLabel = FOLLOW_MODE_LABEL[tp.follow_mode] || '';

        const actions = isDone ? '' : `
            <div class="jny-card-actions">
                <button class="jny-btn primary" onclick="event.stopPropagation();app.markJourneyTouchpointDone(${tp.id},'${entityType}',${entityId})">
                    <i class="fas fa-check"></i> 完成
                </button>
                <button class="jny-btn" onclick="event.stopPropagation();app.snoozeJourneyTouchpoint(${tp.id},'${entityType}',${entityId})">
                    <i class="fas fa-clock"></i> 暂缓
                </button>
                <button class="jny-btn danger" onclick="event.stopPropagation();app.skipJourneyTouchpoint(${tp.id},'${entityType}',${entityId})">
                    <i class="fas fa-forward"></i> 跳过
                </button>
                ${tp.touchpoint_type === 'whatsapp_auto' ? `
                <button class="jny-btn" style="color:#25d366;border-color:#86efac;" onclick="event.stopPropagation();app.sendJourneyWhatsApp(${tp.id},'${entityType}',${entityId})">
                    <i class="fab fa-whatsapp"></i> 发送
                </button>` : ''}
            </div>`;

        return `
            <div class="jny-card ${isOverdue ? 'overdue' : isDone ? 'done' : ''}">
                <div class="jny-card-top">
                    <div class="jny-card-icon" style="background:${pColor}18;">
                        <i class="${tIcon}" style="color:${pColor};"></i>
                    </div>
                    <div class="jny-card-body">
                        <div class="jny-card-title">${esc(tp.title)}</div>
                        <div class="jny-card-meta">
                            <span><i class="${sIcon}" style="color:${sColor};"></i> ${tp.status.replace('_',' ')}</span>
                            <span><i class="fas fa-calendar" style="color:var(--gray-400);"></i> ${fmtDate(tp.due_date)} · ${relDue(tp.due_date)}</span>
                            <span style="background:${pColor}18;color:${pColor};padding:1px 6px;border-radius:10px;font-size:10px;font-weight:700;">${PRIORITY_LABEL[tp.priority] || tp.priority}</span>
                            ${tp.product_track ? `<span style="background:#e0f2fe;color:#0369a1;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:700;">${tp.product_track.toUpperCase()}</span>` : ''}
                            ${modeLabel ? `<span style="font-size:10px;color:var(--gray-400);">${modeLabel}</span>` : ''}
                        </div>
                        ${tp.notes ? `<div style="margin-top:6px;font-size:12px;color:var(--gray-500);font-style:italic;">${esc(tp.notes)}</div>` : ''}
                    </div>
                    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
                        ${tp.touchpoint_type === 'whatsapp_auto' ? `<span style="color:#25d366;font-size:10px;font-weight:600;background:#f0fdf4;padding:2px 6px;border-radius:8px;">AUTO</span>` : ''}
                    </div>
                </div>
                ${actions}
            </div>`;
    }

    // ── Touchpoint actions ───────────────────────────────────────────────────

    const markJourneyTouchpointDone = async (touchpointId, entityType, entityId) => {
        const ok = await AppDataStore.updateTouchpointStatus(touchpointId, 'done');
        if (ok) {
            UI.toast.success('✅ 已完成');
            await _refreshJourneyTab(entityType, entityId);
        } else {
            UI.toast.error('无法更新状态');
        }
    };

    const skipJourneyTouchpoint = async (touchpointId, entityType, entityId) => {
        const ok = await AppDataStore.updateTouchpointStatus(touchpointId, 'skipped');
        if (ok) {
            UI.toast.info('跳过');
            await _refreshJourneyTab(entityType, entityId);
        }
    };

    const snoozeJourneyTouchpoint = async (touchpointId, entityType, entityId) => {
        UI.showModal(
            '暂缓跟进',
            `<div style="padding:8px 0;">
                <label style="font-size:13px;font-weight:600;display:block;margin-bottom:8px;">暂缓多少天？</label>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    ${[1,3,7,14].map(d =>
                        `<button class="btn secondary btn-sm" onclick="(async()=>{await app.executeSnooze(${touchpointId},'${entityType}',${entityId},${d});UI.hideModal();})()">${d}天</button>`
                    ).join('')}
                </div>
            </div>`,
            [{ label: '取消', action: 'UI.hideModal()' }]
        );
    };

    const executeSnooze = async (touchpointId, entityType, entityId, days) => {
        const ok = await AppDataStore.updateTouchpointStatus(touchpointId, 'snoozed', { snooze_days: days });
        if (ok) {
            UI.toast.info(`⏰ 已暂缓 ${days} 天`);
            await _refreshJourneyTab(entityType, entityId);
        }
    };

    const sendJourneyWhatsApp = async (touchpointId, entityType, entityId) => {
        try {
            const res = await fetch('/api/journey/send-whatsapp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ touchpoint_id: touchpointId }),
            });
            const data = await res.json();
            if (data.ok) {
                UI.toast.success('✅ WhatsApp 已发送');
                await _refreshJourneyTab(entityType, entityId);
            } else {
                throw new Error(data.error || 'Send failed');
            }
        } catch (e) {
            // Fall back to manual open
            UI.toast.info('自动发送不可用 — 手动开启 WhatsApp');
            const tp = await AppDataStore.getById('journey_touchpoints', touchpointId);
            if (tp) {
                const entity = tp.prospect_id
                    ? await AppDataStore.getById('prospects', tp.prospect_id)
                    : await AppDataStore.getById('customers', tp.customer_id);
                if (entity?.phone) {
                    const text = encodeURIComponent(
                        (tp.message_template || tp.title).replace(/{name}/g, entity.full_name?.split(' ')[0] || 'there')
                    );
                    window.open(`https://wa.me/${entity.phone.replace(/\D/g,'')}?text=${text}`, '_blank');
                }
            }
        }
    };

    // ── Track switcher ───────────────────────────────────────────────────────

    const switchJourneyTrackDisplay = async (entityType, entityId, track, btnEl) => {
        document.querySelectorAll(`[id^="jny-tab-"][id$="-${entityId}"]`).forEach(b => b.classList.remove('active'));
        if (btnEl) btnEl.classList.add('active');

        const touchpoints = await AppDataStore.getJourneyTouchpoints(entityType, entityId);
        let filtered;
        if (track === 'annual') {
            filtered = touchpoints.filter(t => t.stage_name?.startsWith('annual_'));
        } else {
            filtered = touchpoints.filter(t => t.track === track && !t.stage_name?.startsWith('annual_'));
        }
        const canManage   = isTeamLeaderOrAbove(_cu()) || isSystemAdmin(_cu());
        const listEl      = document.getElementById(`jny-list-${entityType}-${entityId}`);
        if (listEl) listEl.innerHTML = renderTouchpointList(filtered, entityType, entityId, canManage);
    };

    const switchJourneyTrack = async (entityType, entityId, toTrack) => {
        const label = toTrack === 'nurture' ? '缓和培育轨道' : 'Active 轨道';
        UI.showModal(
            `移至 ${label}？`,
            `<p style="font-size:14px;color:var(--gray-700);">将记录阶段转换并自动创建新的跟进任务。现有任务不受影响。</p>`,
            [
                {
                    label: `确认 — 移至 ${label}`,
                    action: `(async()=>{await app.confirmSwitchJourneyTrack('${entityType}',${entityId},'${toTrack}');UI.hideModal();})()`
                },
                { label: '取消', action: 'UI.hideModal()' }
            ]
        );
    };

    const confirmSwitchJourneyTrack = async (entityType, entityId, toTrack) => {
        const stageName = toTrack === 'nurture' ? 'nurture' : 'pr_post_cps';
        await AppDataStore.logStageTransition(entityType, entityId, null, stageName,
            `Manual track switch to ${toTrack}`);
        const n = await AppDataStore.spawnTouchpointsForStage(entityType, entityId, stageName,
            { track: toTrack, assignedTo: _cu()?.id || null });
        if (n > 0) {
            UI.toast.success(`已移至 ${toTrack === 'nurture' ? '缓和培育' : 'Active'} 轨道 — 创建了 ${n} 个任务`);
            await evaluateConditionalRules(entityType, entityId,
                toTrack === 'nurture' ? 'said_not_now' : 'move_to_active');
        }
        await _refreshJourneyTab(entityType, entityId);
    };

    // ── Spawn modal (admin/TL) ───────────────────────────────────────────────

    const openSpawnTouchpointsModal = async (entityType, entityId) => {
        // Group stages by track for the selector
        const trackGroups = {
            '💍 改命戒指': STAGE_ORDER_BY_TRACK.pr,
            '🏠 风水方案': STAGE_ORDER_BY_TRACK.fs,
            '🖌️ 画作': STAGE_ORDER_BY_TRACK.cal,
            '🛏️ 旺床': STAGE_ORDER_BY_TRACK.bed,
            '🛋️ 旺沙发': STAGE_ORDER_BY_TRACK.sofa,
            '🪟 旺窗帘': STAGE_ORDER_BY_TRACK.curtain,
            '💊 健康': STAGE_ORDER_BY_TRACK.hc,
            '⭐ 21步客户旅程': STAGE_ORDER_BY_TRACK.post,
            '📅 年度跟进': ['annual_flying_stars','annual_birthday','annual_spring','annual_midyear','annual_dongzhi','annual_forecast','annual_xingua'],
            '💤 缓和培育': ['nurture'],
        };

        const optgroups = Object.entries(trackGroups).map(([groupLabel, stages]) =>
            `<optgroup label="${esc(groupLabel)}">
                ${stages.map(s => `<option value="${s}">${STAGE_LABELS[s] || s}</option>`).join('')}
            </optgroup>`
        ).join('');

        UI.showModal(
            '生成阶段跟进任务',
            `<div style="padding:8px 0;">
                <div style="margin-bottom:12px;">
                    <label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px;">阶段</label>
                    <select id="spawn-stage-sel" class="form-control">${optgroups}</select>
                </div>
                <div style="margin-bottom:12px;">
                    <label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px;">阶段开始日期</label>
                    <input type="date" id="spawn-start-date" class="form-control" value="${new Date().toISOString().slice(0,10)}">
                </div>
                <div style="margin-bottom:12px;">
                    <label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px;">跟进模式</label>
                    <select id="spawn-follow-mode" class="form-control">
                        <option value="active">🟡 Active — 已受邀，积极跟进</option>
                        <option value="warm_hold">🟢 Warm Hold — 已确认出席，温和维护</option>
                        <option value="gentle_nurture">🔵 Gentle Nurture — 无回应，温柔联系</option>
                    </select>
                </div>
                <div style="font-size:12px;color:var(--gray-500);">将根据该阶段的模板创建跟进任务。</div>
            </div>`,
            [
                {
                    label: '生成任务',
                    action: `(async()=>{
                        const stage = document.getElementById('spawn-stage-sel')?.value;
                        const start = document.getElementById('spawn-start-date')?.value;
                        const mode  = document.getElementById('spawn-follow-mode')?.value || 'active';
                        if(!stage){UI.toast.error('请选择阶段');return;}
                        await app.executeSpawnTouchpoints('${entityType}',${entityId},stage,start,mode);
                        UI.hideModal();
                    })()`
                },
                { label: '取消', action: 'UI.hideModal()' }
            ]
        );
    };

    const executeSpawnTouchpoints = async (entityType, entityId, stageName, startDateStr, followMode = 'active') => {
        const startDate  = startDateStr ? new Date(startDateStr + 'T00:00:00') : new Date();
        const track      = stageName === 'nurture' ? 'nurture'
                         : stageName.startsWith('annual_') ? 'annual'
                         : 'active';
        const productTrack = getTrackForStage(stageName) === 'post' ? 'all' : getTrackForStage(stageName);

        const n = await AppDataStore.spawnTouchpointsForStage(entityType, entityId, stageName, {
            startDate, track, assignedTo: _cu()?.id || null,
            productTrack, followMode,
        });
        if (n > 0) {
            await AppDataStore.logStageTransition(entityType, entityId, null, stageName, 'Manual spawn via admin');
            UI.toast.success(`${n} 个跟进任务已创建 — ${STAGE_LABELS[stageName] || stageName}`);
            await _refreshJourneyTab(entityType, entityId);
        } else {
            UI.toast.info('该阶段没有找到模板');
        }
    };

    // ── Annual touchpoints spawner ────────────────────────────────────────────

    const spawnAnnualTouchpoints = async (entityType, entityId) => {
        const annualStages = [
            'annual_flying_stars','annual_birthday','annual_spring',
            'annual_midyear','annual_dongzhi','annual_forecast','annual_xingua',
        ];
        const today = new Date().toISOString().slice(0, 10);
        let total = 0;
        for (const stage of annualStages) {
            const n = await AppDataStore.spawnTouchpointsForStage(entityType, entityId, stage, {
                startDate:    new Date(),
                track:        'annual',
                assignedTo:   _cu()?.id || null,
                productTrack: 'all',
                followMode:   'warm_hold',
            });
            total += n;
        }
        if (total > 0) {
            UI.toast.success(`📅 已创建 ${total} 个年度跟进任务`);
            await _refreshJourneyTab(entityType, entityId);
        } else {
            UI.toast.info('年度任务已存在或暂无模板');
        }
    };

    // ── Dashboard widget ─────────────────────────────────────────────────────

    function buildAgentJourneyDashboard(dueTodayList, overdueCt, todayCt) {
        return `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <span style="font-weight:700;font-size:14px;"><i class="fas fa-route" style="color:var(--primary);margin-right:6px;"></i>今日跟进任务</span>
                <span style="font-size:11px;">
                    ${overdueCt > 0 ? `<span style="color:#dc2626;font-weight:600;margin-right:8px;"><i class="fas fa-fire"></i> ${overdueCt} 逾期</span>` : ''}
                    <span style="color:var(--primary);">${todayCt} 今日</span>
                </span>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;">
                ${dueTodayList.slice(0, 8).map(tp => {
                    const entity = tp.prospects || tp.customers;
                    const entityName = entity?.full_name || '未知';
                    const sColor = STATUS_COLOR[tp.status] || 'var(--gray-400)';
                    const pColor = PRIORITY_COLOR[tp.priority] || '#94a3b8';
                    const trackBadge = tp.product_track ? `<span style="background:#e0f2fe;color:#0369a1;padding:1px 5px;border-radius:6px;font-size:9px;font-weight:700;">${tp.product_track.toUpperCase()}</span>` : '';
                    return `
                        <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;background:#fff;${tp.status==='overdue'?'border-color:#fca5a5;background:#fff5f5;':''}cursor:pointer;"
                             onclick="app.navigateTo('${tp.prospect_id ? 'prospects' : 'customers'}')">
                            <i class="${TYPE_ICON[tp.touchpoint_type] || 'fas fa-tasks'}" style="color:${pColor};width:16px;text-align:center;flex-shrink:0;"></i>
                            <div style="flex:1;min-width:0;">
                                <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(tp.title)}</div>
                                <div style="font-size:11px;color:var(--gray-500);">${esc(entityName)} · ${relDue(tp.due_date)} ${trackBadge}</div>
                            </div>
                            <span style="background:${pColor}18;color:${pColor};padding:1px 6px;border-radius:8px;font-size:10px;font-weight:700;flex-shrink:0;">${(tp.priority||'med').toUpperCase()}</span>
                        </div>`;
                }).join('')}
                ${dueTodayList.length > 8 ? `<div style="text-align:center;font-size:12px;color:var(--gray-400);padding:4px;">+${dueTodayList.length - 8} 更多</div>` : ''}
            </div>
        `;
    }

    const showAgentJourneyDashboard = async (containerEl) => {
        if (!containerEl) return;
        const cu = _cu();
        if (!cu) return;

        const dueTodayList = await AppDataStore.getJourneyTouchpointsDueToday(cu.id);
        const overdueCt    = dueTodayList.filter(t => t.status === 'overdue').length;
        const todayCt      = dueTodayList.filter(t => t.status === 'pending').length;

        if (!dueTodayList.length) {
            _rxRenderAux(containerEl, `
                <div style="text-align:center;padding:16px;color:var(--gray-400);font-size:13px;">
                    <i class="fas fa-check-circle" style="font-size:24px;color:#16a34a;display:block;margin-bottom:6px;"></i>
                    今日无待跟进任务
                </div>`);
            return;
        }

        _rxRenderAux(containerEl, buildAgentJourneyDashboard(dueTodayList, overdueCt, todayCt));
    };

    // ── Agent load panel (TL+ only) ──────────────────────────────────────────

    const showAgentJourneyLoad = async (containerEl) => {
        if (!containerEl || !isTeamLeaderOrAbove(_cu())) return;
        try {
            const { data } = await window.supabase
                .from('agent_journey_load')
                .select('agent_id, overdue_count, due_today_count, total_open')
                .gt('total_open', 0)
                .order('overdue_count', { ascending: false })
                .limit(10);

            if (!data || !data.length) {
                _rxRenderAux(containerEl, `<div style="font-size:12px;color:var(--gray-400);text-align:center;padding:12px;">所有跟进人员均无开放任务。</div>`);
                return;
            }

            const allUsers = await AppDataStore.getAll('users');
            const userMap  = new Map((allUsers || []).map(u => [u.id, u.full_name]));

            _rxRenderAux(containerEl, `
                <div style="font-size:12px;font-weight:700;color:var(--gray-600);margin-bottom:8px;">团队跟进负载</div>
                ${data.map(row => {
                    const name   = userMap.get(row.agent_id) || row.agent_id;
                    const pct    = row.total_open > 0 ? Math.min(100, Math.round((row.overdue_count / row.total_open) * 100)) : 0;
                    const atCap  = row.total_open >= 30;
                    return `
                        <div style="margin-bottom:8px;">
                            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
                                <span style="font-weight:600;">${esc(name)} ${atCap ? '<span style="color:#dc2626;font-size:10px;">已满</span>' : ''}</span>
                                <span style="color:var(--gray-500);">${row.overdue_count} 逾期 / ${row.total_open} 开放</span>
                            </div>
                            <div style="background:var(--gray-200);border-radius:4px;height:6px;overflow:hidden;">
                                <div style="height:100%;width:${pct}%;background:${atCap?'#dc2626':pct>50?'#f59e0b':'#16a34a'};border-radius:4px;"></div>
                            </div>
                        </div>`;
                }).join('')}
            `);
        } catch (e) {
            console.warn('[journey] showAgentJourneyLoad', e?.message);
        }
    };

    // ── Internal refresh helper ───────────────────────────────────────────────

    async function _refreshJourneyTab(entityType, entityId) {
        const bodyEl = entityType === 'customer'
            ? document.getElementById(`cust-acc-body-journey-${entityId}`)
            : document.getElementById(`acc-body-journey-${entityId}`);
        if (bodyEl) await renderJourneyTab(entityType, entityId, bodyEl);
    }

    // ── Expose ────────────────────────────────────────────────────────────────

    app.register('journey', {
        renderJourneyTab,
        markJourneyTouchpointDone,
        skipJourneyTouchpoint,
        snoozeJourneyTouchpoint,
        executeSnooze,
        sendJourneyWhatsApp,
        switchJourneyTrackDisplay,
        switchJourneyTrack,
        confirmSwitchJourneyTrack,
        openSpawnTouchpointsModal,
        executeSpawnTouchpoints,
        spawnAnnualTouchpoints,
        showAgentJourneyDashboard,
        showAgentJourneyLoad,
        evaluateJourneyRules: evaluateConditionalRules,
        recalcProspectScore,
        getTrackForStage,
        STAGE_LABELS,
        STAGE_ORDER_BY_TRACK,
    });

    console.log('[chunk] script-journey v2 (ROS) loaded');
})();
