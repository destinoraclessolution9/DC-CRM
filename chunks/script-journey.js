/**
 * CRM Lazy Chunk: Journey System — 5-Year Automated Follow-Up
 * Loaded on-demand when opening the Journey accordion in prospect/customer profiles,
 * or when navigating to the journey dashboard.
 * Phase 6A (2026-06-06).
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

    // ── Constants ────────────────────────────────────────────────────────────

    const STAGE_LABELS = {
        first_contact:   'First Contact',
        engagement:      'Engagement',
        value_milestone: '30-Day Milestone',
        decision:        'Decision',
        onboarding:      'Onboarding',
        active_client_y1:'Active Client Y1',
        growth_y2:       'Growth Y2',
        growth_y3:       'Growth Y3',
        growth_y4:       'Growth Y4',
        growth_y5:       'Growth Y5',
        nurture:         'Nurture Track',
    };

    const STAGE_ORDER = [
        'first_contact','engagement','value_milestone','decision',
        'onboarding','active_client_y1','growth_y2','growth_y3','growth_y4','growth_y5',
    ];

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

    const SCORE_WEIGHTS = {
        ftf_logged:       15,
        cps_logged:       15,
        fsa_logged:       12,
        call_logged:       8,
        whatsapp_logged:   8,
        reply_received:    8,
        proposal_opened:  12,
        event_attended:   10,
    };
    const DECAY_START_DAYS = 14;

    async function recalcProspectScore(prospectId) {
        try {
            const activities = await AppDataStore.getActivitiesForProspect(prospectId);
            if (!activities || !activities.length) return 0;

            const now = Date.now();
            let score = 0;

            for (const act of activities) {
                const w = SCORE_WEIGHTS[act.activity_type?.toLowerCase()] || 5;
                const actDate = new Date(act.activity_date || act.created_at).getTime();
                const ageD = (now - actDate) / 86400000;
                const decay = ageD > DECAY_START_DAYS
                    ? Math.max(0, 1 - (ageD - DECAY_START_DAYS) * 0.01)
                    : 1;
                score += Math.round(w * decay);
            }

            // Deal value multiplier
            const prospect = await AppDataStore.getById('prospects', prospectId);
            if (prospect?.deal_value && prospect.deal_value >= 200000) score = Math.round(score * 1.3);

            score = Math.min(score, 150);
            return score;
        } catch (e) {
            console.warn('[journey] recalcProspectScore', e?.message);
            return 0;
        }
    }

    // ── Conditional Rules ────────────────────────────────────────────────────

    async function evaluateConditionalRules(entityType, entityId, triggerEvent) {
        try {
            const rules = await AppDataStore.getConditionalRules();
            const matched = rules.filter(r => r.trigger_event === triggerEvent);
            if (!matched.length) return;

            for (const rule of matched) {
                if (rule.action === 'move_to_nurture') {
                    await AppDataStore.logStageTransition(entityType, entityId, null, 'nurture',
                        `Auto: conditional rule ${rule.id} — ${triggerEvent}`);
                    UI.toast.info('Prospect moved to Nurture track');
                } else if (rule.action === 'move_to_active') {
                    const stage = rule.action_payload?.stage || 'decision';
                    await AppDataStore.logStageTransition(entityType, entityId, 'nurture', stage,
                        `Auto: conditional rule ${rule.id} — ${triggerEvent}`);
                    await AppDataStore.spawnTouchpointsForStage(entityType, entityId, stage);
                    UI.toast.success(`Prospect moved to ${STAGE_LABELS[stage] || stage}`);
                }
            }
        } catch (e) {
            console.warn('[journey] evaluateConditionalRules', e?.message);
        }
    }

    // ── Main render entry point ───────────────────────────────────────────────

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

        const latestLog = stageLog[0];
        const currentStage = latestLog?.to_stage || (touchpoints[0]?.stage_name) || 'first_contact';

        container.innerHTML = `
            <style>
                .jny-wrap{font-size:14px;}
                .jny-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px;}
                .jny-stat{background:var(--gray-50);border:1px solid var(--gray-200);border-radius:10px;padding:10px;text-align:center;}
                .jny-stat .val{font-size:20px;font-weight:700;line-height:1.1;}
                .jny-stat .lbl{font-size:11px;color:var(--gray-500);margin-top:2px;}
                .jny-progress{background:var(--gray-200);border-radius:8px;height:8px;margin-bottom:16px;overflow:hidden;}
                .jny-progress-bar{height:100%;border-radius:8px;background:var(--primary);transition:width .4s;}
                .jny-timeline{display:flex;gap:4px;overflow-x:auto;padding:4px 0 12px;margin-bottom:14px;scrollbar-width:none;}
                .jny-timeline::-webkit-scrollbar{display:none;}
                .jny-ts-stage{flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;}
                .jny-ts-dot{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid transparent;transition:all .2s;}
                .jny-ts-dot.done{background:#16a34a;color:#fff;border-color:#16a34a;}
                .jny-ts-dot.active{background:var(--primary);color:#fff;border-color:var(--primary);box-shadow:0 0 0 3px rgba(128,0,32,.2);}
                .jny-ts-dot.future{background:var(--gray-100);color:var(--gray-500);border-color:var(--gray-300);}
                .jny-ts-dot.overdue{background:#dc2626;color:#fff;border-color:#dc2626;animation:pulse 1.5s infinite;}
                .jny-ts-lbl{font-size:10px;color:var(--gray-500);text-align:center;max-width:64px;line-height:1.2;}
                .jny-ts-conn{width:16px;height:2px;background:var(--gray-300);margin-top:13px;flex-shrink:0;}
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
                .jny-card-actions{display:flex;gap:6px;margin-top:10px;}
                .jny-btn{height:28px;padding:0 10px;border-radius:6px;border:1px solid var(--gray-300);background:#fff;font-size:11px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:4px;transition:all .15s;}
                .jny-btn:hover{background:var(--gray-50);}
                .jny-btn.primary{background:var(--primary);color:#fff;border-color:var(--primary);}
                .jny-btn.primary:hover{opacity:.88;}
                .jny-btn.danger{color:#dc2626;border-color:#fca5a5;}
                .jny-btn.danger:hover{background:#fff5f5;}
                .jny-empty{text-align:center;padding:20px;color:var(--gray-400);font-size:13px;}
                .jny-track-tabs{display:flex;gap:6px;margin-bottom:14px;}
                .jny-track-tab{padding:5px 12px;border-radius:20px;border:1px solid var(--gray-300);font-size:12px;font-weight:600;cursor:pointer;background:#fff;transition:all .15s;}
                .jny-track-tab.active{background:var(--primary);color:#fff;border-color:var(--primary);}
                .jny-spawn-btn{display:flex;align-items:center;gap:6px;padding:10px 14px;border:1px dashed var(--gray-300);border-radius:10px;background:var(--gray-50);color:var(--gray-500);font-size:13px;cursor:pointer;width:100%;justify-content:center;margin-top:8px;transition:all .15s;}
                .jny-spawn-btn:hover{border-color:var(--primary);color:var(--primary);background:#fff;}
            </style>

            <div class="jny-wrap">

                <!-- Progress summary -->
                <div class="jny-stats">
                    <div class="jny-stat">
                        <div class="val" style="color:#dc2626;">${overdueCount}</div>
                        <div class="lbl">Overdue</div>
                    </div>
                    <div class="jny-stat">
                        <div class="val" style="color:var(--primary);">${pendingCount}</div>
                        <div class="lbl">Pending</div>
                    </div>
                    <div class="jny-stat">
                        <div class="val" style="color:#16a34a;">${doneCount}</div>
                        <div class="lbl">Completed</div>
                    </div>
                </div>
                <div style="font-size:11px;color:var(--gray-500);margin-bottom:6px;">${pct}% complete (${doneCount}/${totalCount} touchpoints)</div>
                <div class="jny-progress"><div class="jny-progress-bar" style="width:${pct}%"></div></div>

                <!-- Stage timeline -->
                ${renderStageTimeline(touchpoints, currentStage)}

                <!-- Track toggle -->
                <div class="jny-track-tabs">
                    <div class="jny-track-tab active" id="jny-tab-active-${entityId}" onclick="app.switchJourneyTrackDisplay('${entityType}',${entityId},'active',this)">
                        <i class="fas fa-route"></i> Active Track
                    </div>
                    ${hasNurture ? `
                    <div class="jny-track-tab" id="jny-tab-nurture-${entityId}" onclick="app.switchJourneyTrackDisplay('${entityType}',${entityId},'nurture',this)">
                        <i class="fas fa-seedling"></i> Nurture Track
                    </div>` : ''}
                </div>

                <!-- Touchpoint list -->
                <div id="jny-list-${entityType}-${entityId}">
                    ${renderTouchpointList(active, entityType, entityId, canManage)}
                </div>

                <!-- Spawn touchpoints for next stage (admin/TL only) -->
                ${canManage ? `
                <button class="jny-spawn-btn" onclick="app.openSpawnTouchpointsModal('${entityType}',${entityId})">
                    <i class="fas fa-plus-circle"></i> Spawn Touchpoints for a Stage
                </button>` : ''}

                <!-- Stage history log -->
                ${stageLog.length ? `
                <div class="jny-section-hdr" style="margin-top:16px;">
                    <span><i class="fas fa-history" style="color:var(--primary);margin-right:6px;"></i>Stage History</span>
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
        `;
    };

    function renderStageTimeline(touchpoints, currentStage) {
        const stageStatus = {};
        for (const stage of STAGE_ORDER) {
            const stageTps = touchpoints.filter(t => t.stage_name === stage && t.track === 'active');
            if (!stageTps.length) { stageStatus[stage] = 'future'; continue; }
            const hasOverdue = stageTps.some(t => t.status === 'overdue');
            const allDone    = stageTps.every(t => ['done','skipped','auto_sent'].includes(t.status));
            const isCurrent  = stage === currentStage;
            stageStatus[stage] = hasOverdue ? 'overdue' : allDone ? 'done' : isCurrent ? 'active' : 'future';
        }

        return `
            <div class="jny-timeline">
                ${STAGE_ORDER.map((stage, i) => {
                    const st = stageStatus[stage];
                    const lbl = STAGE_LABELS[stage] || stage;
                    const shortLbl = lbl.replace('Active Client ','').replace('Growth ','').replace('First ','');
                    return (i > 0 ? '<div class="jny-ts-conn"></div>' : '') +
                        `<div class="jny-ts-stage" title="${esc(lbl)}">
                            <div class="jny-ts-dot ${st}">
                                ${st === 'done' ? '<i class="fas fa-check" style="font-size:10px;"></i>'
                                : st === 'overdue' ? '<i class="fas fa-fire" style="font-size:10px;"></i>'
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
            return `<div class="jny-empty"><i class="fas fa-map-marker-alt" style="font-size:24px;margin-bottom:8px;display:block;"></i>No touchpoints yet for this track.<br>Click "Spawn Touchpoints" below to start the journey.</div>`;
        }

        // Sort: overdue first, then by due_date, then done last
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

        const actions = isDone ? '' : `
            <div class="jny-card-actions">
                <button class="jny-btn primary" onclick="event.stopPropagation();app.markJourneyTouchpointDone(${tp.id},'${entityType}',${entityId})">
                    <i class="fas fa-check"></i> Done
                </button>
                <button class="jny-btn" onclick="event.stopPropagation();app.snoozeJourneyTouchpoint(${tp.id},'${entityType}',${entityId})">
                    <i class="fas fa-clock"></i> Snooze
                </button>
                <button class="jny-btn danger" onclick="event.stopPropagation();app.skipJourneyTouchpoint(${tp.id},'${entityType}',${entityId})">
                    <i class="fas fa-forward"></i> Skip
                </button>
                ${tp.touchpoint_type === 'whatsapp_auto' ? `
                <button class="jny-btn" style="color:#25d366;border-color:#86efac;" onclick="event.stopPropagation();app.sendJourneyWhatsApp(${tp.id},'${entityType}',${entityId})">
                    <i class="fab fa-whatsapp"></i> Send Now
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
                            <span style="color:var(--gray-400);font-size:11px;">${STAGE_LABELS[tp.stage_name] || tp.stage_name}</span>
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
            UI.toast.success('Touchpoint marked complete');
            await _refreshJourneyTab(entityType, entityId);
        } else {
            UI.toast.error('Could not update touchpoint');
        }
    };

    const skipJourneyTouchpoint = async (touchpointId, entityType, entityId) => {
        const ok = await AppDataStore.updateTouchpointStatus(touchpointId, 'skipped');
        if (ok) {
            UI.toast.info('Touchpoint skipped');
            await _refreshJourneyTab(entityType, entityId);
        }
    };

    const snoozeJourneyTouchpoint = async (touchpointId, entityType, entityId) => {
        UI.showModal(
            'Snooze Touchpoint',
            `<div style="padding:8px 0;">
                <label style="font-size:13px;font-weight:600;display:block;margin-bottom:8px;">Snooze for how many days?</label>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    ${[1,3,7,14].map(d =>
                        `<button class="btn secondary btn-sm" onclick="(async()=>{await app.executeSnooze(${touchpointId},'${entityType}',${entityId},${d});UI.hideModal();})()">${d}d</button>`
                    ).join('')}
                </div>
            </div>`,
            [{ label: 'Cancel', action: 'UI.hideModal()' }]
        );
    };

    const executeSnooze = async (touchpointId, entityType, entityId, days) => {
        const ok = await AppDataStore.updateTouchpointStatus(touchpointId, 'snoozed', { snooze_days: days });
        if (ok) {
            UI.toast.info(`Snoozed for ${days} day${days > 1 ? 's' : ''}`);
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
                UI.toast.success('WhatsApp message sent');
                await _refreshJourneyTab(entityType, entityId);
            } else {
                throw new Error(data.error || 'Send failed');
            }
        } catch (e) {
            // Fall back to manual mark-done + open WA
            UI.toast.info('Auto-send unavailable — opening WhatsApp manually');
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
        const filtered    = touchpoints.filter(t => t.track === track);
        const canManage   = isTeamLeaderOrAbove(_cu()) || isSystemAdmin(_cu());
        const listEl      = document.getElementById(`jny-list-${entityType}-${entityId}`);
        if (listEl) listEl.innerHTML = renderTouchpointList(filtered, entityType, entityId, canManage);
    };

    // Switch the actual journey track for a prospect (moves to nurture or back).
    const switchJourneyTrack = async (entityType, entityId, toTrack) => {
        const label = toTrack === 'nurture' ? 'Nurture Track' : 'Active Track';
        UI.showModal(
            `Move to ${label}?`,
            `<p style="font-size:14px;color:var(--gray-700);">This will log a stage transition and auto-create ${label} touchpoints. Existing touchpoints remain visible.</p>`,
            [
                {
                    label: `Confirm — Move to ${label}`,
                    action: `(async()=>{await app.confirmSwitchJourneyTrack('${entityType}',${entityId},'${toTrack}');UI.hideModal();})()`
                },
                { label: 'Cancel', action: 'UI.hideModal()' }
            ]
        );
    };

    const confirmSwitchJourneyTrack = async (entityType, entityId, toTrack) => {
        const stageName = toTrack === 'nurture' ? 'nurture' : 'first_contact';
        await AppDataStore.logStageTransition(entityType, entityId, null, stageName,
            `Manual track switch to ${toTrack}`);
        const n = await AppDataStore.spawnTouchpointsForStage(entityType, entityId, stageName,
            { track: toTrack, assignedTo: _cu()?.id || null });
        if (n > 0) {
            UI.toast.success(`Moved to ${toTrack === 'nurture' ? 'Nurture' : 'Active'} track — ${n} touchpoints created`);
            await evaluateConditionalRules(entityType, entityId,
                toTrack === 'nurture' ? 'said_not_now' : 'move_to_active');
        }
        await _refreshJourneyTab(entityType, entityId);
    };

    // ── Spawn modal (admin/TL) ───────────────────────────────────────────────

    const openSpawnTouchpointsModal = async (entityType, entityId) => {
        const stageOptions = STAGE_ORDER.concat(['nurture']).map(s =>
            `<option value="${s}">${STAGE_LABELS[s] || s}</option>`
        ).join('');

        UI.showModal(
            'Spawn Journey Touchpoints',
            `<div style="padding:8px 0;">
                <div style="margin-bottom:12px;">
                    <label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px;">Stage</label>
                    <select id="spawn-stage-sel" class="form-control">
                        ${stageOptions}
                    </select>
                </div>
                <div style="margin-bottom:12px;">
                    <label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px;">Stage Start Date</label>
                    <input type="date" id="spawn-start-date" class="form-control" value="${new Date().toISOString().slice(0,10)}">
                </div>
                <div style="font-size:12px;color:var(--gray-500);">Touchpoints will be created based on the 5-year journey template for this stage.</div>
            </div>`,
            [
                {
                    label: 'Spawn Touchpoints',
                    action: `(async()=>{
                        const stage = document.getElementById('spawn-stage-sel')?.value;
                        const start = document.getElementById('spawn-start-date')?.value;
                        if(!stage){UI.toast.error('Select a stage');return;}
                        await app.executeSpawnTouchpoints('${entityType}',${entityId},stage,start);
                        UI.hideModal();
                    })()`
                },
                { label: 'Cancel', action: 'UI.hideModal()' }
            ]
        );
    };

    const executeSpawnTouchpoints = async (entityType, entityId, stageName, startDateStr) => {
        const startDate = startDateStr ? new Date(startDateStr + 'T00:00:00') : new Date();
        const track     = stageName === 'nurture' ? 'nurture' : 'active';
        const n = await AppDataStore.spawnTouchpointsForStage(entityType, entityId, stageName,
            { startDate, track, assignedTo: _cu()?.id || null });
        if (n > 0) {
            await AppDataStore.logStageTransition(entityType, entityId, null, stageName,
                `Manual spawn via admin`);
            UI.toast.success(`${n} touchpoint${n > 1 ? 's' : ''} created for ${STAGE_LABELS[stageName] || stageName}`);
            await _refreshJourneyTab(entityType, entityId);
        } else {
            UI.toast.info('No templates found for that stage');
        }
    };

    // ── Dashboard widget ─────────────────────────────────────────────────────

    const showAgentJourneyDashboard = async (containerEl) => {
        if (!containerEl) return;
        const cu = _cu();
        if (!cu) return;

        const dueTodayList = await AppDataStore.getJourneyTouchpointsDueToday(cu.id);
        const overdueCt    = dueTodayList.filter(t => t.status === 'overdue').length;
        const todayCt      = dueTodayList.filter(t => t.status === 'pending').length;

        if (!dueTodayList.length) {
            containerEl.innerHTML = `
                <div style="text-align:center;padding:16px;color:var(--gray-400);font-size:13px;">
                    <i class="fas fa-check-circle" style="font-size:24px;color:#16a34a;display:block;margin-bottom:6px;"></i>
                    No follow-up tasks due today
                </div>`;
            return;
        }

        containerEl.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <span style="font-weight:700;font-size:14px;"><i class="fas fa-route" style="color:var(--primary);margin-right:6px;"></i>Today's Follow-ups</span>
                <span style="font-size:11px;">
                    ${overdueCt > 0 ? `<span style="color:#dc2626;font-weight:600;margin-right:8px;"><i class="fas fa-fire"></i> ${overdueCt} overdue</span>` : ''}
                    <span style="color:var(--primary);">${todayCt} due today</span>
                </span>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;">
                ${dueTodayList.slice(0, 8).map(tp => {
                    const entity = tp.prospects || tp.customers;
                    const entityName = entity?.full_name || 'Unknown';
                    const sColor = STATUS_COLOR[tp.status] || 'var(--gray-400)';
                    const pColor = PRIORITY_COLOR[tp.priority] || '#94a3b8';
                    return `
                        <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;background:#fff;${tp.status==='overdue'?'border-color:#fca5a5;background:#fff5f5;':''}cursor:pointer;"
                             onclick="app.navigateTo('${tp.prospect_id ? 'prospects' : 'customers'}')">
                            <i class="${TYPE_ICON[tp.touchpoint_type] || 'fas fa-tasks'}" style="color:${pColor};width:16px;text-align:center;flex-shrink:0;"></i>
                            <div style="flex:1;min-width:0;">
                                <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(tp.title)}</div>
                                <div style="font-size:11px;color:var(--gray-500);">${esc(entityName)} · ${relDue(tp.due_date)}</div>
                            </div>
                            <span style="background:${pColor}18;color:${pColor};padding:1px 6px;border-radius:8px;font-size:10px;font-weight:700;flex-shrink:0;">${(tp.priority||'med').toUpperCase()}</span>
                        </div>`;
                }).join('')}
                ${dueTodayList.length > 8 ? `<div style="text-align:center;font-size:12px;color:var(--gray-400);padding:4px;">+${dueTodayList.length - 8} more</div>` : ''}
            </div>
        `;
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
                containerEl.innerHTML = `<div style="font-size:12px;color:var(--gray-400);text-align:center;padding:12px;">No open journey tasks for any agent.</div>`;
                return;
            }

            const allUsers = await AppDataStore.getAll('users');
            const userMap  = new Map((allUsers || []).map(u => [u.id, u.full_name]));

            containerEl.innerHTML = `
                <div style="font-size:12px;font-weight:700;color:var(--gray-600);margin-bottom:8px;">Agent Journey Load</div>
                ${data.map(row => {
                    const name   = userMap.get(row.agent_id) || row.agent_id;
                    const pct    = row.total_open > 0 ? Math.min(100, Math.round((row.overdue_count / row.total_open) * 100)) : 0;
                    const atCap  = row.total_open >= 30;
                    return `
                        <div style="margin-bottom:8px;">
                            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
                                <span style="font-weight:600;">${esc(name)} ${atCap ? '<span style="color:#dc2626;font-size:10px;">AT CAP</span>' : ''}</span>
                                <span style="color:var(--gray-500);">${row.overdue_count} overdue / ${row.total_open} open</span>
                            </div>
                            <div style="background:var(--gray-200);border-radius:4px;height:6px;overflow:hidden;">
                                <div style="height:100%;width:${pct}%;background:${atCap?'#dc2626':pct>50?'#f59e0b':'#16a34a'};border-radius:4px;"></div>
                            </div>
                        </div>`;
                }).join('')}
            `;
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

    Object.assign(window.app, {
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
        showAgentJourneyDashboard,
        showAgentJourneyLoad,
        evaluateJourneyRules: evaluateConditionalRules,
        recalcProspectScore,
    });

    console.log('[chunk] script-journey loaded');
})();
