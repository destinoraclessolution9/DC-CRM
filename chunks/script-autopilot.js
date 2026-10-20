/**
 * CRM Lazy Chunk: Ring Journey autopilot (2026-10-20)
 *
 * The automation itself lives in the database (migrations/
 * 2026-10-20_journey_autopilot.sql). This chunk only shows it:
 *   F  📋 Today's top 5 — desktop Calendar (above the month grid) + mobile Home
 *   D  🟣 Golden Road 2/6 · ready ~15 Dec — under the 🎯 follow-up line on profiles
 *   A  "What's next?" after a CPS is saved — book · invite to an event · not interested · later
 *   G  🧭 Journey funnel — Pipeline page, under Where from / Which product
 *
 * Loaded right after login (script.js, next to the activities chunk). Every
 * surface is mounted by a MutationObserver, so it survives view re-renders,
 * the React island and the mobile home's progressive fills.
 *
 * External dependencies (all global):
 *   window.supabase   window.UI   window.app   window._appState.cu
 *   window._crmUtils.escapeHtml / getUserLevel
 */
(() => {
    const app = window.app;
    const _state = window._appState || {};
    const esc = (s) => (window._crmUtils && window._crmUtils.escapeHtml
        ? window._crmUtils.escapeHtml(s)
        : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const _sb = () => window.supabase || window.supabaseClient;
    const _cu = () => (window._appState && window._appState.cu) || _state.cu || null;
    const _lvl = () => {
        const u = _cu();
        try { return window._crmUtils.getUserLevel(u); } catch (_) { return 99; }
    };
    const _isMobile = () => window.innerWidth <= 768;
    const _ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const _today = () => _ymd(new Date());
    const _fmt = (d) => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
    const _rmK = (rm) => {
        const n = Number(rm) || 0;
        return 'RM' + (n >= 1000 ? Math.round(n / 1000) + 'k' : Math.round(n));
    };

    // Open a person's profile from anywhere (list first, so Back works).
    const apOpen = async (kind, id) => {
        if (id == null) return;
        const isCust = kind === 'customer';
        try { await (app.navigateTo || (() => {}))(isCust ? 'customers' : 'prospects'); } catch (_) { /* best-effort nav */ }
        setTimeout(() => {
            try { (isCust ? app.showCustomerDetail : app.showProspectDetail)(id); } catch (_) { /* best-effort open */ }
        }, 200);
    };

    // ═════ F · 📋 Today's top 5 ═════
    let _todoP = null;
    let _todoAt = 0;
    const apTodo = (force = false) => {
        if (!force && _todoP && Date.now() - _todoAt < 60e3) return _todoP;
        _todoAt = Date.now();
        _todoP = (async () => {
            const sb = _sb();
            if (!sb) return [];
            try {
                const { data, error } = await sb.rpc('journey_daily_todo', { p_limit: 5 });
                if (error) throw error;
                return data || [];
            } catch (e) {
                console.warn('[autopilot] todo', e && e.message);
                return null;
            }
        })();
        return _todoP;
    };

    const _todoAction = (r) => {
        const pid = r.prospect_id != null ? Number(r.prospect_id) : null;
        const cid = r.customer_id != null ? Number(r.customer_id) : null;
        const btn = (label, js) => `<button type="button" class="btn secondary btn-sm" style="font-size:11px;padding:3px 8px;white-space:nowrap;" onclick="event.stopPropagation();${js}">${label}</button>`;
        if (r.kind === 'collect' && r.ref_id != null && cid != null) return btn('📦 Items', `app.openDeliveryItems('purchase', ${Number(r.ref_id)}, ${cid})`);
        if ((r.kind === 'cps' || r.kind === 'book') && pid != null) return btn('📅 Book', `app.openActivityModal('', ${pid})`);
        if (r.kind === 'touch' && r.ref_id != null) return btn('✓ Done', `app.apTouchDone(${Number(r.ref_id)})`);
        return '';
    };

    const _todoHtml = (rows) => {
        const head = `
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:8px;">
                <strong style="font-size:15px;">📋 Today's top ${rows && rows.length ? rows.length : 5}</strong>
                <span style="font-size:11px;color:var(--gray-500);">ranked by money × urgency</span>
            </div>`;
        if (rows === null) return head + '<div style="font-size:13px;color:var(--gray-500);">Could not load right now.</div>';
        if (!rows.length) return head + '<div style="font-size:13px;color:var(--gray-500);">Nothing urgent today 🎉</div>';
        return head + rows.map((r, i) => {
            const kind = r.customer_id != null ? 'customer' : 'prospect';
            const id = r.customer_id != null ? Number(r.customer_id) : Number(r.prospect_id);
            return `
            <div class="ap-todo-row" onclick="app.apOpen('${kind}', ${id})" style="display:flex;align-items:center;gap:8px;padding:7px 0;border-top:${i ? '1px solid var(--gray-100)' : 'none'};cursor:pointer;">
                <span style="font-size:18px;flex-shrink:0;">${esc(r.icon || '•')}</span>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.name || '')}
                        <span style="font-weight:700;color:#047857;margin-left:4px;">${esc(_rmK(r.rm))}</span></div>
                    <div style="font-size:12px;color:var(--gray-600);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.why || '')}</div>
                </div>
                ${_todoAction(r)}
            </div>`;
        }).join('');
    };

    const apRenderTop5 = async (force = false) => {
        const box = document.getElementById('ap-top5');
        if (!box) return;
        const rows = await apTodo(force);
        const el = document.getElementById('ap-top5');
        if (el) el.innerHTML = _todoHtml(rows);
    };

    const _top5Anchor = () => _isMobile()
        ? document.getElementById('mhome-body')
        : document.querySelector('.calendar-monthly-wrapper');

    const apMountTop5 = () => {
        const lv = _lvl();
        if (!(lv >= 3 && lv <= 12)) return;
        const anchor = _top5Anchor();
        if (!anchor || document.getElementById('ap-top5')) return;
        const box = document.createElement('div');
        box.id = 'ap-top5';
        box.style.cssText = 'background:#fff;border:1px solid #DDD6FE;border-left:4px solid #7C3AED;border-radius:12px;padding:12px 14px;margin:0 0 12px;box-shadow:0 1px 2px rgba(0,0,0,.04);';
        box.innerHTML = _todoHtml([]).replace('Nothing urgent today 🎉', 'Loading…');
        anchor.parentNode.insertBefore(box, anchor);
        apRenderTop5();
    };

    const apTouchDone = async (id) => {
        const sb = _sb();
        if (!sb) return UI.toast.error('Offline — try again in a moment');
        try {
            const { error } = await sb.from('journey_touchpoints')
                .update({ status: 'done', completed_at: new Date().toISOString(), completed_by_id: _cu() ? _cu().id : null })
                .eq('id', id);
            if (error) throw error;
            UI.toast.success('Done ✓');
            apRenderTop5(true);
        } catch (e) {
            UI.toast.error('Could not mark it done: ' + (e && e.message ? e.message : e));
        }
    };

    // ═════ D · 🟣 Golden Road line on profiles ═════
    const apFillGrLine = async (slot) => {
        const pid = Number(slot.dataset.fuPid);
        if (!pid) return;
        const sb = _sb();
        if (!sb) return;
        let g = null;
        try {
            const { data } = await sb.rpc('journey_gr_status', { p_pid: pid });
            g = (data || [])[0] || null;
        } catch (_) { /* hidden */ }
        document.querySelectorAll(`.ap-gr-line[data-gr-for="${pid}"]`).forEach(n => n.remove());
        if (!g || !g.total) return;
        const item = String(g.item || '').replace(/\s*\/.*$/, '');
        const short = item.length > 28 ? item.slice(0, 27) + '…' : item;
        const parts = [`<strong style="color:#6D28D9;">🟣 Golden Road ${Number(g.done) || 0}/${Number(g.total)}</strong>`];
        if (g.collected) parts.push('<span style="color:#047857;font-weight:600;">✅ collected</span>');
        else if (g.ready_date) parts.push(`<span>${esc(short)} ready ~${esc(_fmt(g.ready_date))}</span>`);
        if (!g.collected && g.next_due) parts.push(`<span style="color:#6B7280;">next GR ${esc(_fmt(g.next_due))}</span>`);
        const line = document.createElement('div');
        line.className = 'ap-gr-line';
        line.dataset.grFor = String(pid);
        line.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 8px;padding:6px 10px;border-radius:8px;background:#F5F3FF;border:1px solid #DDD6FE;font-size:13px;';
        line.innerHTML = parts.join('<span style="color:#C4B5FD;">·</span>');
        slot.insertAdjacentElement('afterend', line);
    };

    // ═════ A · "What's next?" after a CPS ═════
    const _modalOpen = () => !!document.querySelector('#global-modal-overlay.active');

    // Called by the activity save (activities chunk) for a NEW CPS. Waits for
    // any modal still open (the CPS-intake WhatsApp prompt) to close first.
    const apCpsNextStep = async (pid, name = '') => {
        if (!pid) return;
        const t0 = Date.now();
        while (_modalOpen() && Date.now() - t0 < 120e3) await new Promise(r => setTimeout(r, 600));
        if (_modalOpen()) return;
        const who = name ? esc(name) : 'this person';
        const opt = (icon, label, hint, js) => `
            <button type="button" class="btn secondary" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:10px 12px;margin:0 0 8px;" onclick="${js}">
                <span style="font-size:20px;">${icon}</span>
                <span><strong>${label}</strong><br><span style="font-size:12px;color:var(--gray-500);font-weight:400;">${hint}</span></span>
            </button>`;
        UI.showModal(`What's next for ${name || 'them'}?`, `
            <p style="margin:0 0 12px;font-size:13px;color:var(--gray-600);">Only 7% of CPS were met again. Pick the next step for ${who} now — it takes 5 seconds.</p>
            ${opt('📅', 'Book the 2nd meeting', 'Opens a new activity for them', `app.apCpsSet(${Number(pid)}, 'meeting')`)}
            ${opt('🎟️', 'Invite to an event', '九星课 · 改命会 · 博物馆 · 汇集 …', `app.apCpsSet(${Number(pid)}, 'event')`)}
            ${opt('⏳', 'Decide later', 'They go on your daily to-do and Monday list', `app.apCpsSet(${Number(pid)}, 'later')`)}
            ${opt('🚫', 'Not interested', 'Stops reminders for them', `app.apCpsSet(${Number(pid)}, 'not_interested')`)}
        `, [{ label: 'Close', action: `app.apCpsSet(${Number(pid)}, 'later')` }]);
    };

    const apCpsSet = async (pid, step) => {
        const sb = _sb();
        try {
            if (sb) await sb.rpc('set_cps_next_step', { p_pid: Number(pid), p_step: step });
        } catch (e) { console.warn('[autopilot] set_cps_next_step', e && e.message); }
        UI.hideModal();
        if (step === 'meeting') {
            setTimeout(() => { try { app.openActivityModal('', Number(pid)); } catch (_) { /* best-effort */ } }, 150);
        } else if (step === 'event') {
            setTimeout(() => apCpsInvite(pid), 150);
        } else if (step === 'not_interested') {
            UI.toast.info('Noted — no more reminders for them');
        } else {
            UI.toast.info('On your to-do — book them soon');
        }
        apRenderTop5(true);
    };

    const apCpsInvite = async (pid) => {
        const sb = _sb();
        if (!sb) return UI.toast.error('Offline — try again in a moment');
        const today = _today();
        const until = _ymd(new Date(Date.now() + 60 * 864e5));
        let rows = [];
        try {
            const { data } = await sb.from('activities')
                .select('id,activity_title,activity_date,start_time,event_id')
                .eq('activity_type', 'EVENT').gte('activity_date', today).lte('activity_date', until)
                .not('event_id', 'is', null).order('activity_date').limit(40);
            rows = (data || []).filter(a => !/代理会议/.test(a.activity_title || ''));
        } catch (_) { /* empty */ }
        const list = rows.length ? rows.map(a => `
            <button type="button" class="btn secondary" style="display:flex;justify-content:space-between;gap:10px;width:100%;text-align:left;padding:9px 12px;margin:0 0 6px;"
                onclick="app.apCpsInviteGo(${Number(pid)}, ${Number(a.id)}, ${Number(a.event_id)})">
                <span style="font-weight:600;">${esc(a.activity_title || 'Event')}</span>
                <span style="color:var(--gray-500);white-space:nowrap;">${esc(_fmt(a.activity_date))}${a.start_time ? ' ' + esc(String(a.start_time).slice(0, 5)) : ''}</span>
            </button>`).join('')
            : '<p style="color:var(--gray-500);font-size:13px;">No events on the calendar in the next 60 days. Add the event first, then invite them from it.</p>';
        UI.showModal('Invite to which event?', list, [{ label: 'Cancel', action: 'UI.hideModal()' }]);
    };

    const apCpsInviteGo = async (pid, activityId, eventId) => {
        const sb = _sb();
        try {
            const { data: dup } = await sb.from('event_attendees').select('id')
                .eq('activity_id', activityId).eq('attendee_type', 'prospect').eq('entity_id', pid).limit(1);
            if (!dup || !dup.length) {
                const { data: p } = await sb.from('prospects').select('full_name').eq('id', pid).maybeSingle();
                const cu = _cu();
                await AppDataStore.create('event_attendees', {
                    event_id: eventId,
                    activity_id: activityId,
                    attendee_id: pid,
                    entity_id: pid,
                    entity_name: (p && p.full_name) || '',
                    attendee_type: 'prospect',
                    attendance_status: 'Registered',
                    added_by_agent_id: cu ? cu.id : null,
                    added_by_name: cu ? (cu.full_name || '') : '',
                    created_at: new Date().toISOString(),
                });
            }
            UI.hideModal();
            UI.toast.success('Invited ✓ — the ring journey moves on when they attend');
            apRenderTop5(true);
        } catch (e) {
            UI.toast.error('Could not add them: ' + (e && e.message ? e.message : e));
        }
    };

    // ═════ G · 🧭 Journey funnel (Pipeline page) ═════
    let _fnPeriod = 'q';
    const _fnRange = (p) => {
        const d = new Date();
        if (p === 'm') return [_ymd(new Date(d.getFullYear(), d.getMonth(), 1)), _ymd(d)];
        if (p === 'y') return [_ymd(new Date(d.getFullYear(), 0, 1)), _ymd(d)];
        return [_ymd(new Date(d.getFullYear(), d.getMonth() - 2, 1)), _ymd(d)];
    };
    const FN_STEPS = [
        ['cps', 'CPS'],
        ['met_again', 'Met again'],
        ['potential', 'Potential'],
        ['event', 'Event'],
        ['signed', 'Signed'],
        ['collected', 'Collected'],
        ['gr6', 'GR 6/6'],
        ['referral', 'Referral'],
    ];
    const apRenderFunnel = async (period) => {
        if (period) _fnPeriod = period;
        const box = document.getElementById('pl-funnel-root');
        const sb = _sb();
        if (!box || !sb) return;
        const [from, to] = _fnRange(_fnPeriod);
        let rows = [];
        try {
            const { data, error } = await sb.rpc('journey_funnel', { p_from: from, p_to: to });
            if (error) throw error;
            rows = data || [];
        } catch (e) {
            console.warn('[autopilot] funnel', e && e.message);
        }
        const tot = {};
        FN_STEPS.forEach(([k]) => { tot[k] = rows.reduce((s, r) => s + (Number(r[k]) || 0), 0); });
        const pct = (n, d) => d ? Math.round(n * 100 / d) + '%' : '—';
        const bars = FN_STEPS.map(([k, label], i) => {
            const prev = i ? tot[FN_STEPS[i - 1][0]] : tot.cps;
            const w = tot.cps && tot[k] ? Math.max(3, Math.round(tot[k] * 100 / tot.cps)) : 0;
            const drop = i && prev ? Math.round((prev - tot[k]) * 100 / prev) : 0;
            return `
            <div style="display:grid;grid-template-columns:86px 1fr 92px;align-items:center;gap:8px;margin:3px 0;font-size:12px;">
                <span style="font-weight:600;">${label}</span>
                <div style="background:var(--gray-100);border-radius:4px;height:16px;overflow:hidden;">
                    <div style="width:${w}%;height:100%;background:${i < 2 ? '#7C3AED' : i < 5 ? '#2563EB' : '#059669'};"></div>
                </div>
                <span style="text-align:right;white-space:nowrap;"><strong>${tot[k]}</strong> · ${pct(tot[k], tot.cps)}${i && drop > 0 ? ` <span style="color:#B91C1C;">-${drop}%</span>` : ''}</span>
            </div>`;
        }).join('');
        const btn = (p, label) => `<button type="button" class="btn btn-sm ${_fnPeriod === p ? 'primary' : 'secondary'}" style="font-size:11px;padding:2px 8px;" onclick="app.apRenderFunnel('${p}')">${label}</button>`;
        const table = rows.length > 1 ? `
            <div style="overflow-x:auto;margin-top:10px;">
                <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:560px;">
                    <thead><tr style="text-align:right;color:var(--gray-500);">
                        <th style="text-align:left;padding:4px 6px;">Agent</th>${FN_STEPS.map(([, l]) => `<th style="padding:4px 6px;">${l}</th>`).join('')}
                    </tr></thead>
                    <tbody>${rows.map(r => `<tr style="border-top:1px solid var(--gray-100);text-align:right;">
                        <td style="text-align:left;padding:4px 6px;font-weight:600;white-space:nowrap;">${esc(r.agent_name || '—')}</td>
                        ${FN_STEPS.map(([k]) => `<td style="padding:4px 6px;">${Number(r[k]) || 0}</td>`).join('')}
                    </tr>`).join('')}</tbody>
                </table>
            </div>` : '';
        box.innerHTML = `
            <div class="plg-card" style="margin-top:12px;">
                <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
                    <strong style="font-size:15px;">🧭 Journey funnel</strong>
                    <span style="display:flex;gap:4px;">${btn('m', 'This month')}${btn('q', '3 months')}${btn('y', 'This year')}</span>
                </div>
                <div style="font-size:11px;color:var(--gray-500);margin-bottom:8px;">People whose CPS was ${esc(_fmt(from))} – ${esc(_fmt(to))}: how many reached each step. Red = lost since the step before.</div>
                ${tot.cps ? bars : '<div style="font-size:13px;color:var(--gray-500);">No CPS in this period.</div>'}
                ${table}
            </div>`;
    };
    const apMountFunnel = () => {
        const anchor = document.getElementById('pl-insights-root');
        if (!anchor || document.getElementById('pl-funnel-root')) return;
        const box = document.createElement('div');
        box.id = 'pl-funnel-root';
        anchor.insertAdjacentElement('afterend', box);
        apRenderFunnel();
    };

    // ═════ Mount everything on DOM changes ═════
    const _scan = () => {
        try { apMountTop5(); } catch (_) { /* best-effort */ }
        try { apMountFunnel(); } catch (_) { /* best-effort */ }
        document.querySelectorAll('[data-fu-pid]:not([data-gr-done])').forEach(slot => {
            slot.dataset.grDone = '1';
            apFillGrLine(slot);
        });
    };
    if (!window.__apObserver && typeof MutationObserver !== 'undefined' && document.body) {
        let _t = null;
        window.__apObserver = new MutationObserver(() => {
            clearTimeout(_t);
            _t = setTimeout(_scan, 250);
        });
        window.__apObserver.observe(document.body, { childList: true, subtree: true });
    }
    setTimeout(_scan, 300);

    app.register('autopilot', {
        apOpen,
        apTodo,
        apMountTop5,
        apRenderTop5,
        apFillGrLine,
        apTouchDone,
        apCpsNextStep,
        apCpsSet,
        apCpsInvite,
        apCpsInviteGo,
        apRenderFunnel,
    });
    console.log('[chunk] script-autopilot loaded');
})();
