/**
 * CRM Lazy Chunk: Ring Journey autopilot (2026-10-20)
 *
 * The automation itself lives in the database (migrations/
 * 2026-10-20_journey_autopilot.sql). This chunk only shows it:
 *   F  📋 Today's top 5 — desktop Calendar (above the month grid) + mobile Home
 *   D  🟣 Golden Road 2/6 · ready ~15 Dec — under the 🎯 follow-up line on profiles
 *   A  "What's next?" after a CPS is saved — book · invite to an event · not interested · later
 *   G  🧭 Journey funnel — Pipeline page, under Where from / Which product
 *   💳 POP — auto-deducted; lapsed months + manual receipts (board, plan, profile line,
 *      list / picture import, history on the DC Closing Record)
 *   ❌ Sale cancellations + refunds — block on the DC Closing Record + list
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
    const _fmtY = (d) => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
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
        if (r.kind === 'pop' && r.ref_id != null) return btn('💳 Plan', `app.openPopPlan(${Number(r.ref_id)})`);
        if (r.kind === 'photo' && r.ref_id != null && pid != null) return btn('📸 Attach', `app.ofAttachLater(${Number(r.ref_id)}, ${pid})`);
        if (r.kind === 'minutes' && r.ref_id != null) return btn('📝 Minutes', `app.openPostMeetupNotesModal(${Number(r.ref_id)}, ${pid == null ? 'null' : pid})`);
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
        // The phone Home has the same list built in ("Do today", 2026-10-26).
        if (_isMobile()) return;
        const anchor = _top5Anchor();
        if (!anchor || document.getElementById('ap-top5')) return;
        const box = document.createElement('div');
        box.id = 'ap-top5';
        box.style.cssText = 'background:#fff;border:1px solid #DDD6FE;border-left:4px solid #7C3AED;border-radius:12px;padding:12px 14px;margin:0 0 12px;box-shadow:0 1px 2px rgba(0,0,0,.04);';
        box.innerHTML = _todoHtml([]).replace('Nothing urgent today 🎉', 'Loading…');
        anchor.parentNode.insertBefore(box, anchor);
        apRenderTop5();
    };

    // ═════ 🌱 立春 / 🌙 冬至 — festival wishes (2026-10-26) ═════
    // On the festival day (+3 catch-up days) festival_wish_list returns the
    // signed-in agent's customers + active prospects with the message ready.
    // The CRM sends nothing itself: tap → WhatsApp opens → the row ticks.
    let _festRows = null;      // rows of the open festival, [] when none
    let _festDay = '';         // local date the rows were fetched for
    let _festP = null;
    let _festAll = false;
    const apFestLoad = (force = false) => {
        if (!force && _festP && _festDay === _today()) return _festP;
        _festDay = _today();
        _festP = (async () => {
            const sb = _sb();
            if (!sb) return [];
            try {
                const { data, error } = await sb.rpc('festival_wish_list', {});
                if (error) throw error;
                _festRows = data || [];
            } catch (e) {
                console.warn('[autopilot] festival', e && e.message);
                _festRows = [];
                setTimeout(() => { _festP = null; }, 60e3);   // try again in a minute
            }
            return _festRows;
        })();
        return _festP;
    };

    const _festHtml = (rows) => {
        const f = rows[0];
        const icon = f.label === '立春' ? '🌱' : '🌙';
        const sent = rows.filter(r => r.sent).length;
        const todo = rows.filter(r => !r.sent);
        const shown = _festAll ? rows : todo.slice(0, 5);
        const list = shown.map((r, i) => {
            const idx = rows.indexOf(r);
            return `
            <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-top:${i ? '1px solid var(--gray-100)' : 'none'};">
                <div style="flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${r.sent ? 'color:var(--gray-500);' : 'font-weight:600;'}">
                    ${esc(r.name || '')}${r.customer_id != null ? ' <span style="font-size:10px;font-weight:600;color:#047857;background:#ECFDF5;padding:1px 6px;border-radius:8px;">Customer</span>' : ''}
                </div>
                ${r.sent
                    ? '<span style="font-size:12px;color:#047857;white-space:nowrap;">✓ Sent</span>'
                    : `<button type="button" class="btn btn-sm" style="font-size:12px;padding:4px 10px;background:#25D366;border-color:#25D366;color:#fff;white-space:nowrap;" onclick="event.stopPropagation();app.apFestWa(${idx})" aria-label="Send ${esc(f.label)} WhatsApp to ${esc(r.name || '')}"><i class="fab fa-whatsapp" aria-hidden="true"></i> Send</button>`}
            </div>`;
        }).join('');
        const more = rows.length > 5 || sent
            ? `<button type="button" class="btn secondary btn-sm" style="font-size:12px;margin-top:6px;" onclick="app.apFestToggle()">${_festAll ? 'Show only not sent' : `Show all ${rows.length}`}</button>`
            : '';
        return `
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:6px;">
                <strong style="font-size:15px;">${icon} ${esc(f.label)} — wish your people</strong>
                <span style="font-size:12px;color:var(--gray-600);white-space:nowrap;">${sent} / ${rows.length} sent</span>
            </div>
            ${todo.length ? '' : `<div style="font-size:13px;color:#047857;margin-bottom:4px;">All done — everyone has your ${esc(f.label)} wishes 🎉</div>`}
            ${list}${more}`;
    };

    const apRenderFestival = () => {
        const el = document.getElementById('ap-festival');
        if (!el) return;
        if (!_festRows || !_festRows.length) { el.remove(); return; }
        el.innerHTML = _festHtml(_festRows);
    };

    const apMountFestival = async () => {
        if (document.getElementById('ap-festival')) return;
        const rows = await apFestLoad();
        if (!rows || !rows.length) return;
        const anchor = _top5Anchor();
        if (!anchor || document.getElementById('ap-festival')) return;
        const box = document.createElement('div');
        box.id = 'ap-festival';
        box.style.cssText = 'background:#fff;border:1px solid #BBF7D0;border-left:4px solid #16A34A;border-radius:12px;padding:12px 14px;margin:0 0 12px;box-shadow:0 1px 2px rgba(0,0,0,.04);';
        const top5 = document.getElementById('ap-top5');
        anchor.parentNode.insertBefore(box, top5 && top5.parentNode === anchor.parentNode ? top5 : anchor);
        apRenderFestival();
    };

    const apFestToggle = () => { _festAll = !_festAll; apRenderFestival(); };

    const _festStandalone = () => {
        try {
            return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
                || window.navigator.standalone === true;
        } catch (_) { return false; }
    };

    const apFestWa = async (idx) => {
        const r = _festRows && _festRows[idx];
        if (!r) return;
        const utils = window._crmUtils || {};
        const num = typeof utils.waPhone === 'function' ? utils.waPhone(r.phone) : String(r.phone || '').replace(/\D/g, '');
        if (!num) { UI.toast.error('No usable phone number for ' + (r.name || 'this person')); return; }
        const text = String(r.message || '').replace(/\{name\}/g, r.name || '');
        // Tick first: a standalone app hands the page over to WhatsApp.
        r.sent = true;
        apRenderFestival();
        const sb = _sb();
        const mark = sb ? sb.rpc('festival_wish_mark', {
            p_day: r.festival_day, p_prospect_id: r.prospect_id, p_customer_id: r.customer_id,
        }) : null;
        const url = `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
        // Same rules as the mobile home: same-window in an installed app (keeps
        // the ?text), new tab in a browser ('noopener' returns null — no fallback).
        if (_festStandalone()) {
            try { await Promise.race([mark, new Promise(res => setTimeout(res, 1200))]); } catch (_) { /* tick retried below */ }
            window.location.href = url;
            return;
        }
        window.open(url, '_blank', 'noopener');
        try {
            const { data, error } = await mark;
            if (error || data === false) throw error || new Error('not marked');
        } catch (e) {
            r.sent = false;
            apRenderFestival();
            UI.toast.error('WhatsApp opened, but the tick did not save. Tap Send again after sending.');
        }
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
        const parts = [`<strong>🟣 Golden Road ${Number(g.done) || 0}/${Number(g.total)}</strong>`];
        if (g.collected) parts.push('<span style="color:#047857;font-weight:600;">✅ collected</span>');
        else if (g.ready_date) parts.push(`<span>${esc(short)} ready ~${esc(_fmt(g.ready_date))}</span>`);
        if (!g.collected && g.next_due) parts.push(`<span style="color:#6B7280;">next GR ${esc(_fmt(g.next_due))}</span>`);
        const line = document.createElement('div');
        // Neutral status row under the profile snapshot (styles-fixed.css .pv-attn-line).
        line.className = 'ap-gr-line pv-attn-line';
        line.dataset.grFor = String(pid);
        line.innerHTML = parts.join('<span class="pv-attn-dot">·</span>');
        slot.insertAdjacentElement('afterend', line);
    };

    // ═════ A · "What's next?" after a CPS ═════
    const _modalOpen = () => !!document.querySelector('#global-modal-overlay.active');

    // Called by the activity save (activities chunk) for a NEW CPS. Waits for
    // any modal still open (the CPS-intake WhatsApp prompt) to close first.
    const apCpsNextStep = async (pid, name = '', activityId = null) => {
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
            ${activityId ? opt('🔁', "Didn't happen — reschedule", 'Opens the appointment to change the date', `UI.hideModal();app.editActivity(${Number(activityId)})`) : ''}
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

    // ═════ 💳 POP — auto-deducted; only LAPSED charges + manual receipts ═════
    // Monthly POP charges come off the customer's card automatically (status
    // "auto" once the date passes). Only when the office reports a lapse does
    // the agent mark it; the customer banks in and the agent uploads the
    // receipt (one receipt may cover several months). Tracked from Oct 2026.
    const POP_STATUS = {
        due:         ['Upcoming', '#6B7280', '#F3F4F6'],
        auto:        ['✅ Auto-deducted', '#065F46', '#D1FAE5'],
        lapsed:      ['⚠ Lapsed', '#B91C1C', '#FEE2E2'],
        paid_manual: ['💵 Paid manually', '#1E40AF', '#DBEAFE'],
        waived:      ['Waived', '#6B7280', '#F3F4F6'],
        assumed:     ['Before tracking', '#6B7280', '#F3F4F6'],
    };
    const _maskCard = (s) => String(s || '').replace(/(?:\d[\s-]?){8,}/g, m => '••••' + m.replace(/\D/g, '').slice(-4)).slice(0, 34);
    const _popChip = (st) => {
        const c = POP_STATUS[st] || POP_STATUS.due;
        return `<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:700;color:${c[1]};background:${c[2]};white-space:nowrap;">${c[0]}</span>`;
    };
    const _popMonth = (d) => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '';
    const _popRM = (n) => 'RM ' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
    const _monthEnd = () => { const d = new Date(); return _ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };
    let _popTab = 'lapsed';
    let _popRows = [];
    const _popSelect = 'id,purchase_id,customer_id,agent_id,seq,due_date,amount,status,paid_date,lapsed_at,receipt_id,note,customers(full_name),purchases(item,payment_method,epp_bank,epp_months,installment_tenure,invoice)';

    // actions on one month (plan → reopen that plan afterwards)
    const _popActs = (i, plan) => {
        const p = plan ? `, { plan: ${Number(plan)} }` : '';
        const b = (label, js, color) => `<button type="button" class="btn secondary btn-sm" style="font-size:11px;padding:2px 8px;${color ? 'color:' + color + ';' : ''}" onclick="event.stopPropagation();${js}">${label}</button>`;
        if (i.status === 'auto' || (i.status === 'due' && i.due_date <= _monthEnd())) return b('⚠ Lapsed', `app.popMark(${Number(i.id)}, 'lapsed'${p})`, '#B91C1C');
        if (i.status === 'lapsed') return b('💵 Paid manually', `app.popPayManual(${Number(i.purchase_id)}, ${Number(i.id)})`, '#1E40AF')
            + b('↺ Not lapsed', `app.popMark(${Number(i.id)}, '${i.due_date < _today() ? 'auto' : 'due'}'${p})`);
        if (i.status === 'paid_manual' && i.receipt_id != null) return b('📎 Receipt', `app.popOpenReceipt(${Number(i.receipt_id)})`);
        return '';
    };
    // ✎ amount (plan view only): unpaid months, optionally every later unpaid month too
    const _popEditBtn = (i, plan) => (plan && ['due', 'auto', 'lapsed'].includes(i.status))
        ? `<a href="javascript:void(0)" title="Change the amount" style="font-size:11px;margin-left:2px;" onclick="event.stopPropagation();app.popEditAmount(${Number(i.id)}, ${Number(plan)}, ${Number(i.seq)}, ${Number(i.amount) || 0})">✎</a>` : '';
    const popEditAmount = (id, plan, seq, amount) => {
        UI.showModal('✎ Change the POP amount', `
            <div class="form-group"><label>Amount (RM)</label><input type="number" step="0.01" min="1" id="pop-amt-val" class="form-control" value="${Number(amount).toFixed(2)}"></div>
            <label style="display:flex;gap:8px;align-items:center;font-size:13px;"><input type="checkbox" id="pop-amt-all" checked> Also change every later month that is not paid yet (#${Number(seq)} onward)</label>
            <div style="font-size:11px;color:var(--gray-500);margin-top:6px;">Use this when the real card charge differs from the CRM (e.g. RM499 vs RM498.50).</div>`,
            [{ label: 'Cancel', action: `app.openPopPlan(${Number(plan)})` },
             { label: 'Save', type: 'primary', action: `(async () => { await app.popSaveAmount(${Number(id)}, ${Number(plan)}, ${Number(seq)}); })()` }]);
    };
    const popSaveAmount = async (id, plan, seq) => {
        const v = Math.round(Number(document.getElementById('pop-amt-val')?.value) * 100) / 100;
        const all = !!document.getElementById('pop-amt-all')?.checked;
        if (!(v > 0)) return UI.toast.error('Enter an amount');
        try {
            let q = _sb().from('pop_installments').update({ amount: v, amount_edited: true });
            q = all ? q.eq('purchase_id', plan).gte('seq', seq).in('status', ['due', 'auto', 'lapsed']) : q.eq('id', id);
            const { data, error } = await q.select('id');
            if (error) throw error;
            if (!data || !data.length) throw new Error('Not allowed for this customer');
            UI.toast.success(`Amount changed on ${data.length} month${data.length === 1 ? '' : 's'}`);
        } catch (e) { return UI.toast.error('Not saved: ' + (e && e.message ? e.message : e)); }
        await openPopPlan(plan);
    };
    const _popRowHtml = (i, opts = {}) => {
        const name = (i.customers && i.customers.full_name) || '—';
        const pu = i.purchases || {};
        const n = pu.installment_tenure || pu.epp_months || '';
        const card = _maskCard([pu.epp_bank, pu.payment_method].filter(Boolean).join(' · '));
        const title = opts.plan
            ? `#${Number(i.seq)}${n ? '/' + esc(n) : ''}`
            : `<a href="javascript:void(0)" onclick="app.openPopPlan(${Number(i.purchase_id)})">${esc(name)}</a> <span style="color:var(--gray-500);font-weight:400;">${Number(i.seq)}${n ? '/' + esc(n) : ''}</span>`;
        const sub = opts.plan ? '' : `<div style="font-size:11px;color:var(--gray-500);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(String(pu.item || '').slice(0, 40))}${pu.invoice ? ' · ' + esc(pu.invoice) : ''}${card ? ' · ' + esc(card) : ''}</div>`;
        const extra = i.status === 'lapsed' && i.lapsed_at ? `<span style="font-size:11px;color:#B91C1C;">marked ${esc(_fmt(i.lapsed_at))}</span>`
            : i.status === 'paid_manual' && i.paid_date ? `<span style="font-size:11px;color:#1E40AF;">paid ${esc(_fmt(i.paid_date))}</span>` : '';
        return `
        <div class="ap-pop-row" style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:8px 0;border-top:1px solid var(--gray-100);">
            <div style="flex:1 1 180px;min-width:0;">
                <div style="font-weight:600;font-size:13px;">${title}</div>${sub}
            </div>
            <span style="font-size:12px;white-space:nowrap;">${esc(_popMonth(i.due_date))}</span>
            <strong style="font-size:13px;white-space:nowrap;">${_popRM(i.amount)}${_popEditBtn(i, opts.plan)}</strong>
            ${_popChip(i.status)} ${extra}
            <span style="display:flex;gap:4px;flex-wrap:wrap;">${_popActs(i, opts.plan)}</span>
        </div>`;
    };

    const popLoad = async (tab) => {
        const sb = _sb();
        if (!sb) return [];
        let q = sb.from('pop_installments').select(_popSelect);
        if (tab === 'lapsed') q = q.eq('status', 'lapsed').order('due_date');
        else if (tab === 'manual') q = q.eq('status', 'paid_manual').order('paid_date', { ascending: false });
        else q = q.in('status', ['due', 'lapsed', 'auto']).order('due_date');
        const { data, error } = await q.limit(3000);
        if (error) throw error;
        return data || [];
    };

    // All plans tab: one line per running plan
    const _popPlansHtml = (rows) => {
        const by = new Map();
        for (const i of rows) {
            const k = String(i.purchase_id);
            if (!by.has(k)) by.set(k, { i, n: 0, left: 0, lapsed: 0, next: null });
            const o = by.get(k);
            o.n++;
            if (i.status === 'due' || i.status === 'lapsed') o.left += Number(i.amount) || 0;
            if (i.status === 'lapsed') o.lapsed++;
            if (i.status === 'due' && (!o.next || i.due_date < o.next.due_date)) o.next = i;
        }
        const plans = [...by.values()].filter(o => o.left > 0).sort((a, b) => (b.lapsed - a.lapsed) || (b.left - a.left));
        if (!plans.length) return '<div style="padding:12px 0;color:var(--gray-500);font-size:13px;">No running POP plans.</div>';
        return plans.map(o => {
            const pu = o.i.purchases || {};
            return `
            <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:8px 0;border-top:1px solid var(--gray-100);cursor:pointer;" onclick="app.openPopPlan(${Number(o.i.purchase_id)})">
                <div style="flex:1 1 180px;min-width:0;">
                    <div style="font-weight:600;font-size:13px;color:#2563EB;">${esc((o.i.customers && o.i.customers.full_name) || '—')}</div>
                    <div style="font-size:11px;color:var(--gray-500);">${esc(String(pu.item || '').slice(0, 40))}${pu.invoice ? ' · ' + esc(pu.invoice) : ''}</div>
                </div>
                <strong style="font-size:13px;white-space:nowrap;">${_popRM(o.left)} left</strong>
                ${o.next ? `<span style="font-size:12px;color:var(--gray-500);white-space:nowrap;">next ${esc(_popMonth(o.next.due_date))}</span>` : ''}
                ${o.lapsed ? `<span style="font-size:11px;font-weight:700;color:#B91C1C;">⚠ ${o.lapsed} lapsed</span>` : ''}
            </div>`;
        }).join('');
    };

    const openPopBoard = async (tab) => {
        if (tab) _popTab = tab;
        const sb = _sb();
        if (!sb) return UI.toast.error('Offline — try again in a moment');
        let sum = null;
        try {
            const [sres, rows] = await Promise.all([sb.rpc('pop_summary'), popLoad(_popTab)]);
            sum = ((sres && sres.data) || [])[0] || null;
            _popRows = rows;
        } catch (e) {
            return UI.toast.error('Could not load POP: ' + (e && e.message ? e.message : e));
        }
        const rm = (n) => 'RM ' + Math.round(Number(n) || 0).toLocaleString();
        const tile = (label, val, sub, color) => `<div style="flex:1 1 130px;background:var(--gray-50);border-radius:10px;padding:8px 10px;">
            <div style="font-size:11px;color:var(--gray-500);">${label}</div>
            <div style="font-size:16px;font-weight:700;${color ? 'color:' + color + ';' : ''}">${val}</div>
            ${sub ? `<div style="font-size:11px;color:var(--gray-500);">${sub}</div>` : ''}</div>`;
        const tabBtn = (t, label) => `<button type="button" class="btn btn-sm ${_popTab === t ? 'primary' : 'secondary'}" style="font-size:12px;" onclick="app.openPopBoard('${t}')">${label}</button>`;
        const lapsedN = Number(sum && sum.lapsed_n) || 0;
        const list = _popTab === 'plans' ? _popPlansHtml(_popRows)
            : (_popRows.length ? _popRows.map(i => _popRowHtml(i)).join('')
                : `<div style="padding:12px 0;color:var(--gray-500);font-size:13px;">${_popTab === 'lapsed' ? 'No lapsed charges 🎉' : 'No manual payments yet.'}</div>`);
        const body = `
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
                ${tile('⚠ Lapsed — waiting', rm(sum && sum.lapsed_rm), `${lapsedN} charge${lapsedN === 1 ? '' : 's'}`, lapsedN ? '#B91C1C' : '')}
                ${tile('📎 Receipts this month', String(Number(sum && sum.receipts_n) || 0), rm(sum && sum.receipts_rm))}
                ${tile('Still to come (auto)', rm(sum && sum.to_come), `${Number(sum && sum.plans) || 0} plans`)}
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px;">
                ${tabBtn('lapsed', `⚠ Lapsed (${lapsedN})`)}${tabBtn('manual', '📎 Paid manually')}${tabBtn('plans', 'All plans')}
                <span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;">
                    <button type="button" class="btn secondary btn-sm" style="font-size:12px;" onclick="app.popImportOpen()">📋 Mark lapsed from a list</button>
                    <button type="button" class="btn secondary btn-sm" style="font-size:12px;" onclick="app.popImportOpen(true)">📷 From a picture</button>
                </span>
            </div>
            <div style="font-size:11px;color:var(--gray-500);margin-bottom:4px;">Charges are deducted from the card automatically. Only mark a month <strong>⚠ Lapsed</strong> when the office says it failed, then upload the customer's bank-in receipt with <strong>💵 Paid manually</strong>. Tracked from Oct 2026.</div>
            <div>${list}</div>`;
        UI.showModal('💳 POP collections', body, [{ label: 'Close', action: 'UI.hideModal()' }]);
    };

    const popMark = async (id, status, opts = {}) => {
        const sb = _sb();
        if (!sb) return UI.toast.error('Offline — try again in a moment');
        try {
            const { data, error } = await sb.from('pop_installments').update({ status }).eq('id', id).select('id');
            if (error) throw error;
            if (!data || !data.length) throw new Error('Not allowed for this customer');
            UI.toast.success(status === 'lapsed' ? 'Marked lapsed — upload the receipt once the customer banks in' : 'Back to normal (auto-deducted)');
        } catch (e) {
            UI.toast.error('Could not update: ' + (e && e.message ? e.message : e));
            return false;
        }
        if (opts.plan) openPopPlan(opts.plan); else openPopBoard();
        apRenderTop5(true);
        return true;
    };

    // 💵 one receipt for one or more lapsed months of a sale
    const popPayManual = async (purchaseId, focusId) => {
        const sb = _sb();
        let rows = [];
        try {
            const { data, error } = await sb.from('pop_installments').select('id,seq,due_date,amount').eq('purchase_id', purchaseId).eq('status', 'lapsed').order('due_date');
            if (error) throw error;
            rows = data || [];
        } catch (e) { return UI.toast.error('Could not load: ' + (e && e.message ? e.message : e)); }
        if (!rows.length) return UI.toast.info('No lapsed months on this plan');
        const focus = rows.some(r => String(r.id) === String(focusId)) ? String(focusId) : String(rows[0].id);
        const sum = rows.filter(r => String(r.id) === focus).reduce((t, r) => t + (Number(r.amount) || 0), 0);
        UI.showModal('💵 Paid manually (bank-in receipt)', `
            <div style="font-size:13px;margin-bottom:6px;">Which lapsed month(s) does this receipt pay?</div>
            ${rows.map(r => `<label style="display:flex;gap:8px;align-items:center;padding:4px 0;"><input type="checkbox" class="pop-pay-pick" value="${Number(r.id)}" data-amt="${Number(r.amount) || 0}" ${String(r.id) === focus ? 'checked' : ''}
                onchange="(function(){var t=0;document.querySelectorAll('.pop-pay-pick:checked').forEach(function(c){t+=Number(c.dataset.amt)||0;});var a=document.getElementById('pop-pay-amt');if(a)a.value=t.toFixed(2);})()">
                <span>${esc(_popMonth(r.due_date))} · #${Number(r.seq)} · ${_popRM(r.amount)}</span></label>`).join('')}
            <div class="form-row" style="margin-top:8px;">
                <div class="form-group half"><label>Amount paid (RM) <span class="required">*</span></label><input type="number" step="0.01" min="0" id="pop-pay-amt" class="form-control" value="${sum.toFixed(2)}"></div>
                <div class="form-group half"><label>Date paid <span class="required">*</span></label><input type="date" id="pop-pay-date" class="form-control" value="${_today()}" max="${_today()}"></div>
            </div>
            <div class="form-group"><label>Receipt (photo or PDF) <span class="required">*</span></label><input type="file" id="pop-pay-file" class="form-control" accept="image/*,application/pdf"></div>
            <div class="form-row">
                <div class="form-group half"><label>Bank ref</label><input type="text" id="pop-pay-ref" class="form-control" placeholder="optional"></div>
                <div class="form-group half"><label>Note</label><input type="text" id="pop-pay-note" class="form-control" placeholder="e.g. incl. RM50 late fee"></div>
            </div>
            <div id="pop-pay-status" style="font-size:12px;color:var(--primary);"></div>`,
            [{ label: 'Cancel', action: `app.openPopPlan(${Number(purchaseId)})` },
             { label: 'Save receipt', type: 'primary', action: `(async () => { await app.popSaveReceipt(${Number(purchaseId)}); })()` }]);
    };
    let _popPayBusy = false;
    const popSaveReceipt = async (purchaseId) => {
        if (_popPayBusy) return;
        const sb = _sb();
        const ids = [...document.querySelectorAll('.pop-pay-pick:checked')].map(c => Number(c.value));
        const amount = Number(document.getElementById('pop-pay-amt')?.value);
        const date = document.getElementById('pop-pay-date')?.value || '';
        const file = (document.getElementById('pop-pay-file')?.files || [])[0];
        const ref = (document.getElementById('pop-pay-ref')?.value || '').trim();
        const note = (document.getElementById('pop-pay-note')?.value || '').trim();
        if (!ids.length) return UI.toast.error('Tick the month(s) this receipt pays');
        if (!(amount > 0)) return UI.toast.error('Enter the amount paid');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > _today()) return UI.toast.error('Enter the date paid (not in the future)');
        if (!file) return UI.toast.error('Attach the receipt (photo or PDF)');
        _popPayBusy = true;
        const status = document.getElementById('pop-pay-status');
        let path = null;
        try {
            let f = file;
            if (/^image\//.test(file.type)) {
                if (!app.compressImageFile && typeof window._loadChunk === 'function') { try { await window._loadChunk('chunks/script-prospects.min.js'); } catch (_) { /* raw file */ } }
                if (app.compressImageFile) f = await app.compressImageFile(file);
            }
            if (f.size > 5 * 1024 * 1024) throw new Error('File too large (max 5 MB)');
            if (status) status.textContent = 'Uploading the receipt…';
            path = `pop/receipts/${purchaseId}/${Date.now()}_${String(f.name || 'receipt').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
            const { error: upErr } = await sb.storage.from('attachments').upload(path, f, { upsert: false, contentType: f.type || 'application/octet-stream' });
            if (upErr) throw upErr;
            const { error } = await sb.rpc('pop_record_receipt', { p_inst_ids: ids, p_paid_date: date, p_amount: amount, p_file_path: path, p_file_name: file.name || null, p_bank_ref: ref || null, p_note: note || null });
            if (error) throw error;
            UI.toast.success(`Receipt saved — ${ids.length} month${ids.length === 1 ? '' : 's'} paid manually`);
        } catch (e) {
            if (path) { try { await sb.storage.from('attachments').remove([path]); } catch (_) { /* best-effort */ } }
            if (status) status.textContent = '';
            _popPayBusy = false;
            return UI.toast.error('Not saved: ' + (e && e.message ? e.message : e));
        }
        _popPayBusy = false;
        await openPopPlan(purchaseId);
        apRenderTop5(true);
    };
    const popOpenReceipt = async (receiptId) => {
        try {
            const { data } = await _sb().from('pop_receipts').select('file_path').eq('id', receiptId).maybeSingle();
            if (data && data.file_path && window._openAttachment) window._openAttachment(data.file_path);
            else UI.toast.error('Receipt file not found');
        } catch (e) { UI.toast.error('Could not open: ' + (e && e.message ? e.message : e)); }
    };
    const popUndoReceipt = async (receiptId, purchaseId) => {
        if (!window.confirm('Undo this receipt? Its months go back to ⚠ Lapsed.')) return;
        try {
            const { error } = await _sb().rpc('pop_undo_receipt', { p_receipt_id: receiptId });
            if (error) throw error;
            UI.toast.success('Receipt undone');
        } catch (e) { return UI.toast.error('Could not undo: ' + (e && e.message ? e.message : e)); }
        await openPopPlan(purchaseId);
    };

    const _popReceiptsHtml = (receipts, rows, purchaseId) => {
        if (!receipts.length) return '';
        const me = String((_cu() && _cu().id) || '');
        const isAdmin = _lvl() <= 2;
        return `
            <div style="margin-top:12px;font-weight:700;font-size:13px;">📎 Manual payments (${receipts.length})</div>
            ${receipts.map(r => {
                const months = rows.filter(i => String(i.receipt_id) === String(r.id)).map(i => _popMonth(i.due_date)).join(', ');
                return `
                <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:7px 0;border-top:1px solid var(--gray-100);font-size:12px;">
                    <strong>${_popRM(r.amount)}</strong>
                    <span>paid ${esc(_fmt(r.paid_date))}</span>
                    ${months ? `<span style="color:var(--gray-500);">for ${esc(months)}</span>` : ''}
                    ${r.bank_ref ? `<span style="color:var(--gray-500);">ref ${esc(r.bank_ref)}</span>` : ''}
                    ${r.note ? `<span style="color:var(--gray-500);">· ${esc(r.note)}</span>` : ''}
                    <span style="margin-left:auto;display:flex;gap:4px;">
                        <button type="button" class="btn secondary btn-sm" style="font-size:11px;padding:2px 8px;" onclick="event.stopPropagation();app.popOpenReceipt(${Number(r.id)})">📎 View receipt</button>
                        ${isAdmin || String(r.uploaded_by) === me ? `<button type="button" class="btn secondary btn-sm" style="font-size:11px;padding:2px 8px;" onclick="event.stopPropagation();app.popUndoReceipt(${Number(r.id)}, ${Number(purchaseId)})">↺ Undo</button>` : ''}
                    </span>
                </div>`;
            }).join('')}`;
    };

    // One plan's whole schedule + receipts (from the 💳 profile line, a board row or the DC Closing Record)
    const openPopPlan = async (purchaseId) => {
        const sb = _sb();
        if (!sb) return;
        let rows = [], receipts = [];
        try {
            const [a, b] = await Promise.all([
                sb.from('pop_installments').select(_popSelect).eq('purchase_id', purchaseId).order('seq'),
                sb.from('pop_receipts').select('*').eq('purchase_id', purchaseId).order('paid_date'),
            ]);
            if (a.error) throw a.error;
            rows = a.data || [];
            receipts = (b && b.data) || [];
        } catch (e) {
            return UI.toast.error('Could not load the plan: ' + (e && e.message ? e.message : e));
        }
        if (!rows.length) return UI.toast.info('No POP schedule for this sale');
        const pu = rows[0].purchases || {};
        const left = rows.filter(i => i.status === 'due' || i.status === 'lapsed').reduce((s, i) => s + (Number(i.amount) || 0), 0);
        const done = rows.filter(i => ['auto', 'assumed', 'paid_manual', 'waived'].includes(i.status)).length;
        const lapsed = rows.filter(i => i.status === 'lapsed').length;
        const head = `<div style="font-size:13px;margin-bottom:8px;"><strong>${esc((rows[0].customers && rows[0].customers.full_name) || '')}</strong> · ${esc(String(pu.item || '').slice(0, 50))}${pu.invoice ? ' · ' + esc(pu.invoice) : ''}<br>
            <span style="color:var(--gray-600);">${done}/${rows.length} paid · <strong>${_popRM(left)}</strong> left${lapsed ? ` · <span style="color:#B91C1C;font-weight:700;">⚠ ${lapsed} lapsed</span>` : ''} · ${esc(_maskCard([pu.epp_bank, pu.payment_method].filter(Boolean).join(' · ')))}</span></div>`;
        const list = rows.map(i => _popRowHtml(i, { plan: purchaseId })).join('');
        UI.showModal('💳 POP plan', head + list + _popReceiptsHtml(receipts, rows, purchaseId),
            [{ label: 'All POP', action: 'app.openPopBoard()' }, { label: 'Close', action: 'UI.hideModal()' }]);
    };

    // ── 📋 / 📷 mark lapsed from the office's list (text or a picture of a table) ──
    const _MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const _norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9㐀-鿿]+/g, ' ').trim();
    // "Tan Ah Kow  Oct 2026  RM499" → { month: '2026-10', amount: 499 }
    const _popLineMonth = (line, fallbackYear) => {
        const t = String(line).toLowerCase();
        let m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*'?(\d{2,4})?/);
        if (m) {
            let y = m[2] ? Number(m[2]) : fallbackYear;
            if (y < 100) y += 2000;
            return `${y}-${String(_MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}`;
        }
        m = t.match(/\b(20\d{2})[\/\-.](\d{1,2})\b/);
        if (m) return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}`;
        m = t.match(/\b(\d{1,2})[\/\-.](20\d{2})\b/);
        if (m) return `${m[2]}-${String(Number(m[1])).padStart(2, '0')}`;
        m = String(line).match(/(\d{1,2})\s*月/);
        if (m) return `${fallbackYear}-${String(Number(m[1])).padStart(2, '0')}`;
        return null;
    };
    const _popLineAmount = (line) => {
        const m = String(line).match(/rm\s*([\d,]+(?:\.\d{1,2})?)/i) || String(line).match(/\b(\d{2,3}(?:,\d{3})*\.\d{2})\b/);
        return m ? Number(m[1].replace(/,/g, '')) : null;
    };
    let _popImport = { rows: [], plans: [] };
    const popImportOpen = (fromPicture = false) => {
        UI.showModal(fromPicture ? '📷 Mark lapsed from a picture' : '📋 Mark lapsed from a list', `
            ${fromPicture ? `
            <div class="form-group"><label>Picture of the office's list (photo or screenshot)</label>
                <input type="file" id="pop-imp-file" class="form-control" accept="image/*" onchange="app.popImportPhoto(this)"></div>
            <div id="pop-imp-read" style="font-size:12px;color:var(--primary);margin-bottom:6px;"></div>` : ''}
            <div class="form-group"><label>${fromPicture ? 'Text read from the picture (check / fix it)' : 'Paste the office\'s list — one customer per line'}</label>
                <textarea id="pop-imp-text" class="form-control" rows="6" placeholder="e.g.&#10;Tan Ah Kow   Oct 2026   RM499&#10;Lim Mei Ling  11/2026"></textarea></div>
            <button type="button" class="btn secondary btn-sm" onclick="app.popImportPreview()">🔍 Preview matches</button>
            <div id="pop-imp-preview" style="margin-top:10px;"></div>`,
            [{ label: 'Cancel', action: 'app.openPopBoard()' },
             { label: 'Mark ticked as lapsed', type: 'primary', action: '(async () => { await app.popImportConfirm(); })()' }]);
    };
    const popImportPhoto = async (input) => {
        const file = input && input.files && input.files[0];
        const out = document.getElementById('pop-imp-read');
        if (!file) return;
        if (out) out.textContent = 'Reading the picture…';
        try {
            const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
            const [meta, b64] = String(dataUrl).split(',');
            const mime = (meta.match(/data:(.*?);base64/) || [])[1] || file.type || 'image/jpeg';
            const { data: res, error } = await _sb().functions.invoke('order-form-ocr', { body: { image_base64: b64, mime_type: mime, form_type: 'auto' } });
            if (error) throw new Error(error.message || 'reader unavailable');
            const text = String((res && res.raw_text) || '').trim();
            if (!text) throw new Error('no text found');
            const ta = document.getElementById('pop-imp-text');
            if (ta) ta.value = text;
            if (out) out.textContent = 'Read ✓ — check the text, then Preview.';
            await popImportPreview();
        } catch (e) {
            if (out) out.textContent = "Couldn't read the picture (" + (e && e.message ? e.message : e) + ') — type or paste the names instead.';
        }
    };
    const popImportPreview = async () => {
        const sb = _sb();
        const text = String(document.getElementById('pop-imp-text')?.value || '');
        const lines = text.split(/\r?\n/).map(s => s.trim()).filter(s => s.length >= 3);
        const box = document.getElementById('pop-imp-preview');
        if (!lines.length) { if (box) box.innerHTML = '<div style="color:var(--gray-500);font-size:12px;">Nothing to match yet.</div>'; return; }
        let inst = [];
        try {
            const { data, error } = await sb.from('pop_installments').select('id,purchase_id,customer_id,due_date,amount,status,customers(full_name)').in('status', ['auto', 'due', 'lapsed']).limit(5000);
            if (error) throw error;
            inst = data || [];
        } catch (e) { if (box) box.innerHTML = `<div style="color:#B91C1C;">Could not load plans: ${esc(e && e.message ? e.message : e)}</div>`; return; }
        const custs = new Map();
        for (const i of inst) {
            const n = i.customers && i.customers.full_name;
            if (n && !custs.has(String(i.customer_id))) custs.set(String(i.customer_id), { id: i.customer_id, name: n, norm: _norm(n) });
        }
        const year = new Date().getFullYear();
        // A picture's text often comes back as ONE line for the whole table —
        // split a line wherever another customer's name starts.
        // (normalised names hold only a-z, 0-9 and CJK \u2014 safe inside a RegExp;
        //  whole words only, so "Ng" never matches inside "Ling")
        const nameRx = [...custs.values()].filter(c => c.norm).map(c => ({ c, rx: new RegExp('(?<![a-z0-9])' + c.norm.split(' ').join('[^a-z0-9\\u3400-\\u9fff]+') + '(?![a-z0-9])', 'gi') }));
        const segments = [];
        for (const line of lines) {
            const hits = [];
            for (const { c, rx } of nameRx) for (const m of line.matchAll(rx)) hits.push({ at: m.index, len: m[0].length, c });
            // keep the longest name at each position, drop names inside a longer one
            hits.sort((x, y) => (x.at - y.at) || (y.len - x.len));
            const keep = [];
            for (const h of hits) { const last = keep[keep.length - 1]; if (!last || h.at >= last.at + last.len) keep.push(h); }
            if (keep.length <= 1) { segments.push(line); continue; }
            keep.forEach((h, k) => segments.push(line.slice(h.at, k + 1 < keep.length ? keep[k + 1].at : line.length).trim()));
        }
        _popImport.rows = segments.map(line => {
            const ln = ' ' + _norm(line) + ' ';
            // best = the longest customer name found in the line (or all its words)
            let best = null;
            for (const c of custs.values()) {
                if (!c.norm) continue;
                const words = c.norm.split(' ').filter(w => w.length >= 2);
                const hit = ln.includes(' ' + c.norm + ' ') || (words.length >= 2 && words.every(w => ln.includes(' ' + w + ' ')));
                if (hit && (!best || c.norm.length > best.norm.length)) best = c;
            }
            const month = _popLineMonth(line, year);
            const amount = _popLineAmount(line);
            if (!best) return { line, ok: false, why: 'no customer with a POP plan matches' };
            const mine = inst.filter(i => String(i.customer_id) === String(best.id));
            let pick = month ? mine.find(i => String(i.due_date).slice(0, 7) === month) : null;
            if (!pick && !month) pick = mine.filter(i => i.status === 'auto').sort((a, b) => String(b.due_date).localeCompare(String(a.due_date)))[0];
            if (!pick) return { line, ok: false, cust: best.name, why: month ? `no charge in ${month}` : 'no month found' };
            if (pick.status === 'lapsed') return { line, ok: false, cust: best.name, inst: pick, why: 'already lapsed' };
            return { line, ok: true, cust: best.name, inst: pick, amount };
        });
        const okN = _popImport.rows.filter(r => r.ok).length;
        if (box) box.innerHTML = `
            <div style="font-size:12px;margin-bottom:4px;"><strong>${okN}</strong> of ${_popImport.rows.length} line${_popImport.rows.length === 1 ? '' : 's'} matched · untick any that look wrong</div>
            ${_popImport.rows.map((r, k) => `
            <label style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-top:1px solid var(--gray-100);font-size:12px;">
                <input type="checkbox" class="pop-imp-pick" value="${k}" ${r.ok ? 'checked' : 'disabled'}>
                <span style="flex:1;min-width:0;"><span style="color:var(--gray-500);">${esc(r.line.slice(0, 80))}</span><br>
                ${r.ok ? `→ <strong>${esc(r.cust)}</strong> · ${esc(_popMonth(r.inst.due_date))} · ${_popRM(r.inst.amount)}${r.amount && Math.abs(r.amount - Number(r.inst.amount)) > 1 ? ` <span style="color:#B45309;">(list says RM${r.amount})</span>` : ''}`
                    : `<span style="color:#B91C1C;">✗ ${esc(r.why)}${r.cust ? ' — ' + esc(r.cust) : ''}</span>`}</span>
            </label>`).join('')}`;
    };
    const popImportConfirm = async () => {
        const picks = [...document.querySelectorAll('.pop-imp-pick:checked')].map(c => _popImport.rows[Number(c.value)]).filter(r => r && r.ok);
        if (!picks.length) return UI.toast.error('Preview the list and tick at least one match');
        const ids = [...new Set(picks.map(r => r.inst.id))];
        try {
            const { data, error } = await _sb().from('pop_installments').update({ status: 'lapsed' }).in('id', ids).in('status', ['auto', 'due']).select('id');
            if (error) throw error;
            const n = (data || []).length;
            UI.toast.success(`${n} charge${n === 1 ? '' : 's'} marked lapsed${n < ids.length ? ` (${ids.length - n} not allowed / already changed)` : ''}`);
        } catch (e) { return UI.toast.error('Not saved: ' + (e && e.message ? e.message : e)); }
        _popImport = { rows: [], plans: [] };
        await openPopBoard('lapsed');
        apRenderTop5(true);
    };

    // 💳 line under the 🎯 follow-up line on a customer profile
    const apFillPopLine = async (slot) => {
        const pid = Number(slot.dataset.fuPid);
        const sb = _sb();
        if (!pid || !sb) return;
        let plans = [];
        try {
            const { data } = await sb.rpc('pop_person_plans', { p_pid: pid });
            plans = (data || []).filter(p => Number(p.left_rm) > 0 || Number(p.failed) > 0);
        } catch (_) { /* hidden */ }
        document.querySelectorAll(`.ap-pop-line[data-pop-for="${pid}"]`).forEach(n => n.remove());
        if (!plans.length) return;
        const line = document.createElement('div');
        line.className = 'ap-pop-line pv-attn-line is-stack';
        line.dataset.popFor = String(pid);
        line.innerHTML = plans.map(p => `
            <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;cursor:pointer;" onclick="event.stopPropagation();app.openPopPlan(${Number(p.purchase_id)})">
                <strong>💳 POP ${Number(p.done) || 0}/${Number(p.total) || 0}</strong>
                <span>RM ${Math.round(Number(p.left_rm) || 0).toLocaleString()} left</span>
                ${Number(p.failed) ? `<span style="color:#B91C1C;font-weight:700;">⚠ ${Number(p.failed)} lapsed</span>`
                    : (p.next_due ? `<span style="color:#6B7280;">next RM${Math.round(Number(p.next_amount) || 0)} ${esc(_fmt(p.next_due))} (auto)</span>` : '')}
                <span style="color:#9CA3AF;font-size:11px;">${esc(String(p.item || '').slice(0, 24))}</span>
            </div>`).join('');
        slot.insertAdjacentElement('afterend', line);
    };

    // 💳 POP history inside a sale on the DC Closing Record (slot data-pop-purchase)
    const apFillClosingPop = async (slot) => {
        const pu = Number(slot.dataset.popPurchase);
        const sb = _sb();
        if (!pu || !sb) return;
        let rows = [], receipts = [];
        try {
            const [a, b] = await Promise.all([
                sb.from('pop_installments').select('id,seq,due_date,amount,status,lapsed_at,paid_date,receipt_id').eq('purchase_id', pu).order('seq'),
                sb.from('pop_receipts').select('*').eq('purchase_id', pu).order('paid_date'),
            ]);
            rows = (a && a.data) || [];
            receipts = (b && b.data) || [];
        } catch (_) { return; }
        if (!rows.length) { slot.innerHTML = ''; return; }
        const done = rows.filter(i => ['auto', 'assumed', 'paid_manual', 'waived'].includes(i.status)).length;
        const left = rows.filter(i => i.status === 'due' || i.status === 'lapsed').reduce((s, i) => s + (Number(i.amount) || 0), 0);
        const lapses = rows.filter(i => i.status === 'lapsed' || i.status === 'paid_manual');
        const open = rows.filter(i => i.status === 'lapsed').length;
        slot.innerHTML = `
            <details style="margin:4px 12px 8px;border:1px solid #A7F3D0;border-radius:8px;background:#F0FDF4;" ${open ? 'open' : ''}>
                <summary style="padding:6px 10px;cursor:pointer;font-size:12px;list-style:none;">
                    <strong style="color:#065F46;">💳 POP payments</strong> · ${done}/${rows.length} paid · ${_popRM(left)} left
                    ${open ? ` · <span style="color:#B91C1C;font-weight:700;">⚠ ${open} lapsed</span>` : ''}
                    ${receipts.length ? ` · 📎 ${receipts.length} receipt${receipts.length === 1 ? '' : 's'}` : ''}
                </summary>
                <div style="padding:4px 10px 8px;font-size:12px;">
                    ${lapses.length ? lapses.map(i => `
                        <div style="display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;padding:4px 0;border-top:1px solid #D1FAE5;">
                            <span>${esc(_popMonth(i.due_date))} · #${Number(i.seq)}</span><strong>${_popRM(i.amount)}</strong> ${_popChip(i.status)}
                            ${i.lapsed_at ? `<span style="color:var(--gray-500);">lapsed ${esc(_fmt(i.lapsed_at))}</span>` : ''}
                            ${i.paid_date ? `<span style="color:var(--gray-500);">paid ${esc(_fmt(i.paid_date))}</span>` : ''}
                            ${i.receipt_id != null ? `<a href="javascript:void(0)" onclick="event.stopPropagation();app.popOpenReceipt(${Number(i.receipt_id)})">📎 receipt</a>` : ''}
                        </div>`).join('') : '<div style="color:var(--gray-500);">No lapsed months — every charge auto-deducted so far.</div>'}
                    ${receipts.length ? `<div style="margin-top:6px;color:var(--gray-600);">${receipts.map(r => `📎 ${_popRM(r.amount)} on ${esc(_fmt(r.paid_date))}${r.bank_ref ? ' · ref ' + esc(r.bank_ref) : ''}${r.note ? ' · ' + esc(r.note) : ''}`).join('<br>')}</div>` : ''}
                    <button type="button" class="btn secondary btn-sm" style="font-size:11px;padding:2px 8px;margin-top:6px;" onclick="event.stopPropagation();app.openPopPlan(${pu})">Open full schedule</button>
                </div>
            </details>`;
    };

    // push link ./index.html?minutes=<activity id>#calendar → that meeting's minutes form
    try {
        const _mm = location.search.match(/[?&]minutes=(\d+)/);
        if (_mm) {
            history.replaceState(null, '', location.pathname + location.hash);
            setTimeout(async () => {
                try {
                    const { data: a } = await _sb().from('activities').select('id,prospect_id,customer_id').eq('id', Number(_mm[1])).maybeSingle();
                    if (a) await app.openPostMeetupNotesModal(a.id, a.prospect_id || a.customer_id);
                    else UI.toast.error('That appointment is no longer there');
                } catch (_) { /* best-effort deep link */ }
            }, 2500);
        }
    } catch (_) { /* best-effort */ }

    // push link ./index.html?pop=1#pipeline → open the board
    try {
        if (/[?&]pop=1\b/.test(location.search)) {
            history.replaceState(null, '', location.pathname + location.hash);
            setTimeout(() => openPopBoard('lapsed'), 2500);
        }
    } catch (_) { /* best-effort */ }

    // ═════ ❌ Sale cancellations + refunds (owner 2026-10-22) ═════
    // Request letter (reason + bank) → office letter → signed acceptance (sale
    // cancelled on that date, POP still-to-come stopped) → refund over N months
    // → "fully refunded" date. Every write is an RPC (cancel_*); the two files
    // live in the private attachments bucket under cancellations/<sale>/.
    const CXL_STATUS = {
        requested: ['🟠 Waiting for signed acceptance', '#92400E', '#FEF3C7'],
        refunding: ['🔵 Refunding', '#1E40AF', '#DBEAFE'],
        completed: ['✅ Refund completed', '#065F46', '#D1FAE5'],
        withdrawn: ['↩ Withdrawn', '#6B7280', '#F3F4F6'],
    };
    const _cxlChip = (st) => { const c = CXL_STATUS[st] || CXL_STATUS.requested; return `<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:700;color:${c[1]};background:${c[2]};white-space:nowrap;">${c[0]}</span>`; };
    const _maskAcct = (s) => { const d = String(s || '').replace(/\D/g, ''); return d.length > 4 ? '••••' + d.slice(-4) : String(s || ''); };
    const _addMonths = (ymd, n) => { const [y, m] = String(ymd).slice(0, 7).split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return _ymd(d); };
    const _cxlEnd = (x) => x.first_refund_month && x.refund_months ? _addMonths(x.first_refund_month, x.refund_months - 1) : null;
    const _cxlFileLink = (path, label) => path ? `<a href="javascript:void(0)" onclick="event.stopPropagation();window._openAttachment&&window._openAttachment('${esc(String(path)).replace(/'/g, '&#39;')}')">📎 ${esc(label)}</a>` : '';
    const _cxlUpload = async (purchaseId, file, kind) => {
        let f = file;
        if (/^image\//.test(file.type)) {
            if (!app.compressImageFile && typeof window._loadChunk === 'function') { try { await window._loadChunk('chunks/script-prospects.min.js'); } catch (_) { /* raw */ } }
            if (app.compressImageFile) f = await app.compressImageFile(file);
        }
        if (f.size > 5 * 1024 * 1024) throw new Error('File too large (max 5 MB)');
        const path = `cancellations/${purchaseId}/${kind}_${Date.now()}_${String(f.name || kind).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const { error } = await _sb().storage.from('attachments').upload(path, f, { upsert: false, contentType: f.type || 'application/octet-stream' });
        if (error) throw error;
        return path;
    };
    const _cxlRm = (n) => 'RM ' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

    // the case summary + its actions (used by the DC Closing block and the list)
    const _cxlCaseHtml = (x, opts = {}) => {
        const b = (label, js, color) => `<button type="button" class="btn secondary btn-sm" style="font-size:11px;padding:2px 8px;${color ? 'color:' + color + ';' : ''}" onclick="event.stopPropagation();${js}">${label}</button>`;
        const end = _cxlEnd(x);
        const monthly = x.refund_total != null && x.refund_months ? Number(x.refund_total) / Number(x.refund_months) : null;
        const late = x.status === 'refunding' && end && _today() > _ymd(new Date(Number(end.slice(0, 4)), Number(end.slice(5, 7)), 0));
        const acts = x.status === 'requested'
            ? b('✍ Signed acceptance received', `app.cxlSignOpen(${Number(x.id)})`, '#1E40AF') + b('↩ Withdrawn', `app.cxlWithdraw(${Number(x.id)})`)
            : x.status === 'refunding'
                ? b('✅ Fully refunded', `app.cxlCompleteOpen(${Number(x.id)})`, '#065F46') + b('↺ Undo signed', `app.cxlUndoSign(${Number(x.id)})`)
                : x.status === 'completed' ? b('↺ Not finished', `app.cxlReopen(${Number(x.id)})`) : '';
        return `
            <div style="display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;">${_cxlChip(x.status)}
                <span style="color:var(--gray-500);">requested ${esc(_fmt(x.requested_at))}</span>
                ${x.signed_at ? `<span style="color:var(--gray-500);">· signed ${esc(_fmt(x.signed_at))} (sale cancelled)</span>` : ''}
                ${x.refunded_at ? `<span style="color:#065F46;font-weight:600;">· fully refunded ${esc(_fmt(x.refunded_at))}</span>` : ''}
                ${x.withdrawn_at ? `<span style="color:var(--gray-500);">· withdrawn ${esc(_fmt(x.withdrawn_at))}</span>` : ''}
            </div>
            <div style="margin-top:4px;">Reason: ${esc(x.reason || '')}</div>
            <div style="color:var(--gray-600);">Bank: ${esc(x.bank_name || '')} · <span title="${esc(x.bank_account || '')}">${esc(_maskAcct(x.bank_account))}</span>
                <a href="javascript:void(0)" onclick="event.stopPropagation();this.previousElementSibling.textContent=this.previousElementSibling.title;this.remove()" style="font-size:11px;">show</a>
                · ${esc(x.account_holder || '')}</div>
            ${x.refund_total != null ? `<div style="margin-top:2px;">Paid ${_cxlRm(x.amount_paid)} − admin fee ${_cxlRm(x.admin_fee)} = <strong>refund ${_cxlRm(x.refund_total)}</strong>
                over ${Number(x.refund_months)} month${Number(x.refund_months) === 1 ? '' : 's'} (${esc(_popMonth(x.first_refund_month))} – ${esc(_popMonth(end))}${monthly != null ? ` · ≈ ${_cxlRm(monthly)} / month` : ''})
                ${late ? ' <span style="color:#B91C1C;font-weight:700;">· past the expected end</span>' : ''}</div>` : ''}
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px;">${_cxlFileLink(x.request_file, 'Request letter')} ${_cxlFileLink(x.acceptance_file, 'Signed acceptance')}</div>
            ${opts.noActions ? '' : `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;">${acts}</div>`}`;
    };

    // ❌ block under a sale on the DC Closing Record (slot data-cxl-purchase)
    const apFillClosingCxl = async (slot) => {
        const pu = Number(slot.dataset.cxlPurchase);
        const sb = _sb();
        if (!pu || !sb) return;
        let cases = [], delivered = false, cancelled = false;
        try {
            const [a, b, c] = await Promise.all([
                sb.from('sale_cancellations').select('*').eq('purchase_id', pu).order('id', { ascending: false }),
                sb.from('delivery_items').select('id,status').eq('purchase_id', pu),
                sb.from('purchases').select('status,delivery_status').eq('id', pu).maybeSingle(),
            ]);
            cases = (a && a.data) || [];
            delivered = ((b && b.data) || []).some(r => r.status === 'delivered' || r.status === 'picked_up') || /^delivered/i.test(String((c && c.data && c.data.delivery_status) || ''));
            cancelled = /cancel|refund|void/i.test(String((c && c.data && c.data.status) || ''));
        } catch (_) { return; }
        const open = cases.find(x => x.status !== 'withdrawn');
        const old = cases.filter(x => x.status === 'withdrawn');
        let inner;
        if (open) inner = _cxlCaseHtml(open);
        else if (cancelled) inner = '<span style="color:var(--gray-500);">This sale is cancelled.</span>';
        else if (delivered) inner = '<span style="color:var(--gray-500);">❌ Cancellation not available — delivered, no refund is allowed.</span>';
        else inner = `<button type="button" class="btn secondary btn-sm" style="font-size:11px;padding:2px 8px;color:#B91C1C;" onclick="event.stopPropagation();app.cxlRequestOpen(${pu})">❌ Request cancellation</button>`;
        const oldHtml = old.length ? `<div style="margin-top:4px;color:var(--gray-500);font-size:11px;">${old.map(x => `↩ withdrawn request of ${esc(_fmt(x.requested_at))} ${_cxlFileLink(x.request_file, 'letter')}`).join(' · ')}</div>` : '';
        const tone = open && open.status !== 'completed' ? '#FECACA' : '#E5E7EB';
        slot.innerHTML = (open || old.length)
            ? `<div style="margin:4px 12px 8px;padding:6px 10px;border:1px solid ${tone};border-radius:8px;background:${open && open.status !== 'completed' ? '#FEF2F2' : '#F9FAFB'};font-size:12px;">
                   <strong style="color:#B91C1C;">❌ Cancellation</strong><div style="margin-top:4px;">${inner}</div>${oldHtml}</div>`
            : `<div style="margin:0 12px 8px;font-size:12px;">${inner}</div>`;
    };
    const _cxlRefresh = () => {
        document.querySelectorAll('[data-cxl-purchase]').forEach(s => apFillClosingCxl(s));
        if (document.querySelector('#global-modal-overlay.active [data-cxl-list]')) openCancellations();
    };

    const cxlRequestOpen = async (purchaseId) => {
        let pu = null;
        try { const { data } = await _sb().from('purchases').select('item,invoice,amount,customers(full_name)').eq('id', purchaseId).maybeSingle(); pu = data; } catch (_) { /* header only */ }
        UI.showModal('❌ Request cancellation', `
            <div style="font-size:13px;margin-bottom:8px;"><strong>${esc((pu && pu.customers && pu.customers.full_name) || '')}</strong> · ${esc((pu && pu.item) || '')}${pu && pu.invoice ? ' · ' + esc(pu.invoice) : ''}${pu ? ' · ' + _cxlRm(pu.amount) : ''}</div>
            <div class="form-group"><label>Date requested <span class="required">*</span></label><input type="date" id="cxl-date" class="form-control" value="${_today()}" max="${_today()}"></div>
            <div class="form-group"><label>Reason <span class="required">*</span></label><textarea id="cxl-reason" class="form-control" rows="2" placeholder="As written in the customer's letter"></textarea></div>
            <div class="form-row">
                <div class="form-group half"><label>Bank name <span class="required">*</span></label><input type="text" id="cxl-bank" class="form-control" placeholder="e.g. Maybank"></div>
                <div class="form-group half"><label>Account number <span class="required">*</span></label><input type="text" id="cxl-acct" class="form-control" inputmode="numeric"></div>
            </div>
            <div class="form-group"><label>Account holder <span class="required">*</span></label><input type="text" id="cxl-holder" class="form-control"></div>
            <div class="form-group"><label>Customer's request letter (photo or PDF) <span class="required">*</span></label><input type="file" id="cxl-file" class="form-control" accept="image/*,application/pdf"></div>
            <div id="cxl-status" style="font-size:12px;color:var(--primary);"></div>`,
            [{ label: 'Cancel', action: 'UI.hideModal()' },
             { label: 'Save request', type: 'primary', action: `(async () => { await app.cxlRequestSave(${Number(purchaseId)}); })()` }]);
    };
    let _cxlBusy = false;
    const cxlRequestSave = async (purchaseId) => {
        if (_cxlBusy) return;
        const v = (id) => String(document.getElementById(id)?.value || '').trim();
        const file = (document.getElementById('cxl-file')?.files || [])[0];
        const date = v('cxl-date');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > _today()) return UI.toast.error('Enter the request date (not in the future)');
        if (!v('cxl-reason')) return UI.toast.error('Enter the reason');
        if (!v('cxl-bank') || !v('cxl-acct') || !v('cxl-holder')) return UI.toast.error('Enter the bank name, account number and account holder');
        if (!file) return UI.toast.error("Attach the customer's request letter");
        _cxlBusy = true;
        let path = null;
        try {
            const st = document.getElementById('cxl-status'); if (st) st.textContent = 'Uploading the letter…';
            path = await _cxlUpload(purchaseId, file, 'request');
            const { error } = await _sb().rpc('cancel_request', { p_purchase: purchaseId, p_requested_at: date, p_reason: v('cxl-reason'), p_bank_name: v('cxl-bank'),
                p_bank_account: v('cxl-acct'), p_account_holder: v('cxl-holder'), p_file: path, p_file_name: file.name || null });
            if (error) throw error;
            UI.hideModal();
            UI.toast.success('Cancellation request saved — waiting for the signed acceptance');
        } catch (e) {
            if (path) { try { await _sb().storage.from('attachments').remove([path]); } catch (_) { /* best-effort */ } }
            UI.toast.error('Not saved: ' + (e && e.message ? e.message : e));
        }
        _cxlBusy = false;
        _cxlRefresh();
    };

    const _cxlGet = async (id) => { const { data, error } = await _sb().from('sale_cancellations').select('*').eq('id', id).maybeSingle(); if (error) throw error; return data; };
    const cxlSignOpen = async (id) => {
        let x = null;
        try { x = await _cxlGet(id); } catch (e) { return UI.toast.error('Could not load: ' + (e && e.message ? e.message : e)); }
        if (!x) return;
        const paid = Number(x.amount_paid) || 0;
        UI.showModal('✍ Signed acceptance received', `
            <div style="font-size:12px;color:var(--gray-600);margin-bottom:8px;">On the signing date the sale is <strong>cancelled</strong> (it stops counting toward goals and commission) and any POP charges still to come stop.</div>
            <div class="form-row">
                <div class="form-group half"><label>Date signed <span class="required">*</span></label><input type="date" id="cxs-date" class="form-control" value="${_today()}" min="${esc(x.requested_at)}" max="${_today()}"></div>
                <div class="form-group half"><label>Signed acceptance (photo or PDF) <span class="required">*</span></label><input type="file" id="cxs-file" class="form-control" accept="image/*,application/pdf"></div>
            </div>
            <div class="form-row">
                <div class="form-group half"><label>Amount paid (RM)</label><input type="number" step="0.01" min="0" id="cxs-paid" class="form-control" value="${paid.toFixed(2)}" oninput="app.cxlCalc()"></div>
                <div class="form-group half"><label>Admin fee (RM)</label><input type="number" step="0.01" min="0" id="cxs-fee" class="form-control" value="0.00" oninput="app.cxlCalc()"></div>
            </div>
            <div class="form-row">
                <div class="form-group half"><label>Refund total (RM) <span class="required">*</span></label><input type="number" step="0.01" min="0" id="cxs-total" class="form-control" value="${paid.toFixed(2)}" oninput="app.cxlCalc(true)"></div>
                <div class="form-group half"><label>Number of months <span class="required">*</span></label><input type="number" min="1" max="60" id="cxs-months" class="form-control" value="6" oninput="app.cxlCalc(true)"></div>
            </div>
            <div class="form-group"><label>First refund month <span class="required">*</span></label><input type="month" id="cxs-first" class="form-control" value="${_addMonths(_today(), 1).slice(0, 7)}" oninput="app.cxlCalc(true)"></div>
            <div id="cxs-sum" style="font-size:13px;font-weight:600;color:#1E40AF;"></div>
            <div id="cxs-status" style="font-size:12px;color:var(--primary);"></div>`,
            [{ label: 'Cancel', action: 'UI.hideModal()' },
             { label: 'Save — cancel the sale', type: 'primary', action: `(async () => { await app.cxlSignSave(${Number(id)}, ${Number(x.purchase_id)}); })()` }]);
        cxlCalc();
    };
    // refund = paid − fee (until the total is typed by hand); show the monthly split
    let _cxlTotalTouched = false;
    const cxlCalc = (fromTotal = false) => {
        const n = (id) => Number(document.getElementById(id)?.value) || 0;
        if (fromTotal === true && document.activeElement && document.activeElement.id === 'cxs-total') _cxlTotalTouched = true;
        const tot = document.getElementById('cxs-total');
        if (tot && !_cxlTotalTouched && !fromTotal) tot.value = Math.max(0, n('cxs-paid') - n('cxs-fee')).toFixed(2);
        const months = Math.max(1, Math.round(n('cxs-months')) || 1);
        const first = String(document.getElementById('cxs-first')?.value || '');
        const sum = document.getElementById('cxs-sum');
        if (sum) sum.textContent = first ? `≈ ${_cxlRm(n('cxs-total') / months)} a month × ${months} · ${_popMonth(first + '-01')} – ${_popMonth(_addMonths(first + '-01', months - 1))}` : '';
    };
    const cxlSignSave = async (id, purchaseId) => {
        if (_cxlBusy) return;
        const v = (k) => String(document.getElementById(k)?.value || '').trim();
        const file = (document.getElementById('cxs-file')?.files || [])[0];
        const date = v('cxs-date');
        const total = Number(v('cxs-total')), months = Math.round(Number(v('cxs-months')));
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > _today()) return UI.toast.error('Enter the date signed (not in the future)');
        if (!file) return UI.toast.error('Attach the signed acceptance');
        if (!(total >= 0) || v('cxs-total') === '') return UI.toast.error('Enter the refund total');
        if (!(months >= 1 && months <= 60)) return UI.toast.error('Enter the number of refund months (1–60)');
        if (!/^\d{4}-\d{2}$/.test(v('cxs-first'))) return UI.toast.error('Pick the first refund month');
        _cxlBusy = true;
        let path = null;
        try {
            const st = document.getElementById('cxs-status'); if (st) st.textContent = 'Uploading the signed acceptance…';
            path = await _cxlUpload(purchaseId, file, 'acceptance');
            const { error } = await _sb().rpc('cancel_sign', { p_id: id, p_signed_at: date, p_file: path, p_file_name: file.name || null,
                p_amount_paid: Number(v('cxs-paid')) || null, p_admin_fee: Number(v('cxs-fee')) || 0, p_refund_total: total, p_months: months, p_first_month: v('cxs-first') + '-01' });
            if (error) throw error;
            UI.hideModal();
            UI.toast.success('Signed — the sale is cancelled and the refund plan is set');
        } catch (e) {
            if (path) { try { await _sb().storage.from('attachments').remove([path]); } catch (_) { /* best-effort */ } }
            UI.toast.error('Not saved: ' + (e && e.message ? e.message : e));
        }
        _cxlBusy = false;
        _cxlTotalTouched = false;
        _cxlRefresh();
        apRenderTop5(true);
    };
    const _cxlRpc = async (fn, args, ok) => {
        try {
            const { error } = await _sb().rpc(fn, args);
            if (error) throw error;
            UI.toast.success(ok);
        } catch (e) { UI.toast.error('Not saved: ' + (e && e.message ? e.message : e)); }
        _cxlRefresh();
    };
    const cxlWithdraw = (id) => { if (window.confirm('Mark this cancellation request as withdrawn? The sale stays as it is.')) return _cxlRpc('cancel_withdraw', { p_id: id, p_date: _today() }, 'Request withdrawn'); };
    const cxlUndoSign = (id) => { if (window.confirm('Undo the signed acceptance? The sale, its POP charges and items come back; the case returns to "waiting for signed acceptance".')) return _cxlRpc('cancel_undo_sign', { p_id: id }, 'Signing undone — the sale is active again'); };
    const cxlReopen = (id) => _cxlRpc('cancel_reopen', { p_id: id }, 'Back to refunding');
    const cxlCompleteOpen = (id) => {
        UI.showModal('✅ Full refund done', `
            <div class="form-group"><label>Date the full refund was done</label><input type="date" id="cxc-date" class="form-control" value="${_today()}" max="${_today()}"></div>`,
            [{ label: 'Cancel', action: 'UI.hideModal()' },
             { label: 'Save', type: 'primary', action: `(async () => { UI.hideModal(); await app.cxlComplete(${Number(id)}, document.getElementById('cxc-date') ? document.getElementById('cxc-date').value : ''); })()` }]);
    };
    const cxlComplete = (id, date) => _cxlRpc('cancel_complete', { p_id: id, p_date: date || _today() }, 'Refund marked as completed');

    // ❌ Cancellations list (Delivery board button / push link ?cxl=1)
    let _cxlTab = 'requested';
    const openCancellations = async (tab) => {
        if (tab) _cxlTab = tab;
        let rows = [];
        try {
            const { data, error } = await _sb().from('sale_cancellations').select('*,customers(full_name),purchases(item,invoice,amount)').neq('status', 'withdrawn').order('requested_at', { ascending: false }).limit(500);
            if (error) throw error;
            rows = data || [];
        } catch (e) { return UI.toast.error('Could not load cancellations: ' + (e && e.message ? e.message : e)); }
        const by = (s) => rows.filter(x => x.status === s);
        const tabBtn = (t, label) => `<button type="button" class="btn btn-sm ${_cxlTab === t ? 'primary' : 'secondary'}" style="font-size:12px;" onclick="app.openCancellations('${t}')">${label} (${by(t).length})</button>`;
        const shown = by(_cxlTab);
        const due = by('refunding').filter(x => { const e = _cxlEnd(x); return e && _today() > _ymd(new Date(Number(e.slice(0, 4)), Number(e.slice(5, 7)), 0)); }).length;
        const body = `<div data-cxl-list="1">
            <div style="font-size:13px;margin-bottom:8px;"><strong>${by('requested').length}</strong> waiting for signed acceptance · <strong>${by('refunding').length}</strong> refunding${due ? ` · <span style="color:#B91C1C;font-weight:700;">${due} past the expected end</span>` : ''}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">${tabBtn('requested', '🟠 Waiting for signature')}${tabBtn('refunding', '🔵 Refunding')}${tabBtn('completed', '✅ Completed')}</div>
            ${shown.length ? shown.map(x => `
                <div style="padding:9px 0;border-top:1px solid var(--gray-100);font-size:12px;">
                    <div style="font-size:13px;"><a href="javascript:void(0)" onclick="UI.hideModal();app.showCustomerDetail(${Number(x.customer_id)})" style="font-weight:700;color:#2563EB;">${esc((x.customers && x.customers.full_name) || '—')}</a>
                        · ${esc(String((x.purchases && x.purchases.item) || '').slice(0, 40))}${x.purchases && x.purchases.invoice ? ' · ' + esc(x.purchases.invoice) : ''} · ${_cxlRm(x.purchases && x.purchases.amount)}</div>
                    ${_cxlCaseHtml(x)}
                </div>`).join('') : '<div style="padding:12px 0;color:var(--gray-500);font-size:13px;">Nothing here.</div>'}
            </div>`;
        UI.showModal('❌ Cancellations & refunds', body, [{ label: 'Close', action: 'UI.hideModal()' }]);
    };

    // push link ./index.html?cxl=1#customers → the list
    try {
        if (/[?&]cxl=1\b/.test(location.search)) {
            history.replaceState(null, '', location.pathname + location.hash);
            setTimeout(() => openCancellations('requested'), 2500);
        }
    } catch (_) { /* best-effort */ }

    // ═════ Mount everything on DOM changes ═════
    const _scan = () => {
        try { apMountTop5(); } catch (_) { /* best-effort */ }
        try { apMountFestival(); } catch (_) { /* best-effort */ }
        try { apMountFunnel(); } catch (_) { /* best-effort */ }
        document.querySelectorAll('[data-cxl-purchase]:not([data-cxl-done])').forEach(slot => {
            slot.dataset.cxlDone = '1';
            apFillClosingCxl(slot);
        });
        document.querySelectorAll('[data-pop-purchase]:not([data-pop-done])').forEach(slot => {
            slot.dataset.popDone = '1';
            apFillClosingPop(slot);
        });
        document.querySelectorAll('[data-fu-pid]:not([data-gr-done])').forEach(slot => {
            slot.dataset.grDone = '1';
            apFillGrLine(slot);
            apFillPopLine(slot);
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

    // ── 📸 order-form photo attached after the closing was saved ─────────────
    // Owner 2026-10-22: a slow / failed upload may not block a sale, so the closing
    // can be saved without it; journey_todo_for then shows "📸 Attach" until a
    // photo tagged with that closing activity exists.
    let _ofLaterBusy = false;
    const ofAttachLater = (activityId, prospectId) => {
        _ofLaterBusy = false;
        UI.showModal('📸 Attach the order form photo', `
            <p style="font-size:13px;color:var(--gray-600);margin:0 0 10px;">The closing was saved without its signed order form. Take or choose the photo — it is filed under this sale.</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button type="button" class="btn primary btn-sm" onclick="document.getElementById('ofl-camera').click()"><i class="fas fa-camera"></i> Take Photo</button>
                <button type="button" class="btn secondary btn-sm" onclick="document.getElementById('ofl-file').click()"><i class="fas fa-upload"></i> Choose File</button>
            </div>
            <input type="file" id="ofl-camera" accept="image/jpeg,image/png,image/webp" capture="environment" style="display:none;" onchange="app.ofAttachLaterSave(this, ${Number(activityId)}, ${Number(prospectId)})">
            <input type="file" id="ofl-file" accept="image/jpeg,image/png,image/webp" style="display:none;" onchange="app.ofAttachLaterSave(this, ${Number(activityId)}, ${Number(prospectId)})">
            <div id="ofl-status" style="margin-top:10px;font-size:12px;"></div>`,
            [{ label: 'Close', action: 'UI.hideModal()' }]);
    };
    const ofAttachLaterSave = async (input, activityId, prospectId) => {
        let file = input && input.files && input.files[0];
        if (!file || _ofLaterBusy) return;
        const sb = _sb();
        const st = (t, c) => { const el = document.getElementById('ofl-status'); if (el) el.innerHTML = `<span style="color:${c || 'var(--gray-600)'};">${t}</span>`; };
        _ofLaterBusy = true;
        let path = null;
        try {
            st('<i class="fas fa-spinner fa-spin"></i> Preparing photo…');
            if (!app.shrinkOrderFormPhoto && typeof window._loadChunk === 'function') { try { await window._loadChunk('chunks/script-activities.min.js'); } catch (_) { /* raw file */ } }
            if (app.shrinkOrderFormPhoto) { try { file = await app.shrinkOrderFormPhoto(file); } catch (_) { /* send as is */ } }
            if (!/^image\/(jpe?g|png|webp)$/i.test(file.type || '')) throw new Error('Use a JPG or PNG photo');
            if (file.size > 8 * 1024 * 1024) throw new Error('Image too large (max 8 MB)');
            const safe = String(file.name || 'order_form.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
            path = `order_forms/${prospectId}_${Date.now()}_later_${safe}`;
            let upErr = null;
            for (let i = 1; i <= 2; i++) {
                st(`<i class="fas fa-spinner fa-spin"></i> Uploading (${Math.max(1, Math.round(file.size / 1024))} KB)${i > 1 ? ' — retrying…' : '…'}`);
                try { ({ error: upErr } = await sb.storage.from('attachments').upload(path, file, { upsert: i > 1, contentType: file.type })); }
                catch (e) { upErr = e; }
                if (!upErr) break;
            }
            if (upErr) throw new Error('Upload failed — ' + (upErr.message || upErr) + '. Check your connection and try again.');
            const { error } = await sb.from('prospect_attachments').insert({
                prospect_id: prospectId, attachment_type: 'order_form', file_url: path, filename: safe,
                metadata: { form_type: 'auto', activity_id: activityId, attached_later: true, edited_by_agent: [] },
                scanned_at: new Date().toISOString(),
            });
            if (error) throw error;
            try { if (AppDataStore.invalidateCache) AppDataStore.invalidateCache('prospect_attachments'); } catch (_) {}
            path = null;
            UI.hideModal();
            UI.toast.success('Order form photo attached ✓');
            try { apRenderTop5(true); } catch (_) { /* card not on screen */ }
        } catch (e) {
            if (path) { try { await sb.storage.from('attachments').remove([path]); } catch (_) { /* best-effort */ } }
            st('⚠ ' + esc(e && e.message ? e.message : String(e)), '#b91c1c');
        } finally {
            _ofLaterBusy = false;
            if (input) input.value = '';
        }
    };

    app.register('autopilot', {
        apOpen,
        apTodo,
        apMountTop5,
        apRenderTop5,
        apTodoActionHtml: _todoAction,
        apFestLoad,
        apMountFestival,
        apRenderFestival,
        apFestToggle,
        apFestWa,
        apFillGrLine,
        apTouchDone,
        apCpsNextStep,
        apCpsSet,
        apCpsInvite,
        apCpsInviteGo,
        apRenderFunnel,
        openPopBoard,
        openPopPlan,
        popMark,
        popPayManual,
        apFillClosingCxl,
        cxlRequestOpen,
        cxlRequestSave,
        cxlSignOpen,
        cxlCalc,
        cxlSignSave,
        cxlWithdraw,
        cxlUndoSign,
        cxlReopen,
        cxlCompleteOpen,
        cxlComplete,
        openCancellations,
        popEditAmount,
        popSaveAmount,
        popSaveReceipt,
        popOpenReceipt,
        popUndoReceipt,
        popImportOpen,
        popImportPhoto,
        popImportPreview,
        popImportConfirm,
        apFillClosingPop,
        apFillPopLine,
        ofAttachLater,
        ofAttachLaterSave,
    });
    console.log('[chunk] script-autopilot loaded');
})();
