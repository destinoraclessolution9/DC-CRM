/**
 * CRM Lazy Chunk: Ring Journey autopilot (2026-10-20)
 *
 * The automation itself lives in the database (migrations/
 * 2026-10-20_journey_autopilot.sql). This chunk only shows it:
 *   F  📋 Today's top 5 — desktop Calendar (above the month grid) + mobile Home
 *   D  🟣 Golden Road 2/6 · ready ~15 Dec — under the 🎯 follow-up line on profiles
 *   A  "What's next?" after a CPS is saved — book · invite to an event · not interested · later
 *   G  🧭 Journey funnel — Pipeline page, under Where from / Which product
 *   💳 POP collections — board, per-plan schedule, 💳 line on profiles
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

    // ═════ 💳 POP collections (company-financed instalments) ═════
    // Schedule rows live in pop_installments (built by the DB from each POP
    // sale). The board is where the monthly card charges get ticked Paid /
    // Failed; "assumed" = fell due before tracking began (counted collected).
    const POP_STATUS = {
        due:     ['Due', '#92400E', '#FEF3C7'],
        paid:    ['Paid', '#065F46', '#D1FAE5'],
        failed:  ['Failed', '#B91C1C', '#FEE2E2'],
        waived:  ['Waived', '#6B7280', '#F3F4F6'],
        assumed: ['Before tracking', '#6B7280', '#F3F4F6'],
    };
    const _maskCard = (s) => String(s || '').replace(/(?:\d[\s-]?){8,}/g, m => '••••' + m.replace(/\D/g, '').slice(-4)).slice(0, 34);
    const _popChip = (st) => {
        const c = POP_STATUS[st] || POP_STATUS.due;
        return `<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:700;color:${c[1]};background:${c[2]};">${c[0]}</span>`;
    };
    let _popTab = 'month';
    let _popRows = [];
    const _popSelect = 'id,purchase_id,customer_id,agent_id,seq,due_date,amount,status,paid_date,note,customers(full_name),purchases(item,payment_method,epp_bank,epp_months,installment_tenure)';

    const _popRowHtml = (i, opts = {}) => {
        const name = (i.customers && i.customers.full_name) || '—';
        const pu = i.purchases || {};
        const n = pu.installment_tenure || pu.epp_months || '';
        const card = _maskCard([pu.epp_bank, pu.payment_method].filter(Boolean).join(' · '));
        const late = i.status === 'due' && i.due_date < _today();
        const plan = opts.plan ? `, { plan: ${Number(opts.plan)} }` : '';
        const b = (label, st, color) => `<button type="button" class="btn secondary btn-sm" style="font-size:11px;padding:2px 8px;${color ? 'color:' + color + ';' : ''}" onclick="event.stopPropagation();app.popMark(${Number(i.id)}, '${st}'${plan})">${label}</button>`;
        const acts = (i.status === 'due' || i.status === 'failed')
            ? b('✓ Paid', 'paid') + (i.status === 'due' ? b('✗ Failed', 'failed', '#B91C1C') : '')
            : (i.status === 'paid' || i.status === 'waived') ? b('↺ Undo', 'due') : '';
        const title = opts.plan
            ? `#${Number(i.seq)}${n ? '/' + esc(n) : ''}`
            : `<a href="javascript:void(0)" onclick="app.openPopPlan(${Number(i.purchase_id)})">${esc(name)}</a> <span style="color:var(--gray-500);font-weight:400;">${Number(i.seq)}${n ? '/' + esc(n) : ''}</span>`;
        const sub = opts.plan ? '' : `<div style="font-size:11px;color:var(--gray-500);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(String(pu.item || '').slice(0, 40))}${card ? ' · ' + esc(card) : ''}</div>`;
        return `
        <div class="ap-pop-row" style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:8px 0;border-top:1px solid var(--gray-100);">
            <div style="flex:1 1 180px;min-width:0;">
                <div style="font-weight:600;font-size:13px;">${title}</div>${sub}
            </div>
            <span style="font-size:12px;white-space:nowrap;${late ? 'color:#B91C1C;font-weight:600;' : ''}">${esc(opts.plan ? _fmtY(i.due_date) : _fmt(i.due_date))}${i.paid_date && i.status === 'paid' ? ' · paid ' + esc(_fmt(i.paid_date)) : ''}</span>
            <strong style="font-size:13px;white-space:nowrap;">RM ${Number(i.amount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
            ${_popChip(i.status)}
            <span style="display:flex;gap:4px;">${acts}</span>
        </div>`;
    };

    const popLoad = async (tab) => {
        const sb = _sb();
        if (!sb) return [];
        const today = _today();
        const d = new Date();
        const mStart = _ymd(new Date(d.getFullYear(), d.getMonth(), 1));
        const mEnd = _ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
        let q = sb.from('pop_installments').select(_popSelect);
        if (tab === 'month') q = q.in('status', ['due', 'failed', 'paid']).gte('due_date', mStart).lte('due_date', mEnd);
        else if (tab === 'overdue') q = q.or(`status.eq.failed,and(status.eq.due,due_date.lt.${today})`);
        else q = q.in('status', ['due', 'failed']).gte('due_date', today).lte('due_date', _ymd(new Date(Date.now() + 90 * 864e5)));
        const { data, error } = await q.order('due_date').order('id').limit(1000);
        if (error) throw error;
        return data || [];
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
        const open = _popRows.filter(i => i.status === 'due' || i.status === 'failed');
        const body = `
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
                ${tile('Still to collect', rm(sum && sum.outstanding), `${Number(sum && sum.plans) || 0} plans`)}
                ${tile('Due this month', rm(sum && sum.due_month), `${Number(sum && sum.due_month_n) || 0} charges`)}
                ${tile('Overdue / failed', rm(sum && sum.overdue), `${Number(sum && sum.overdue_n) || 0} charges`, Number(sum && sum.overdue_n) ? '#B91C1C' : '')}
                ${tile('Collected this month', rm(sum && sum.collected_month), '', '#047857')}
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px;">
                ${tabBtn('month', 'This month')}${tabBtn('overdue', 'Overdue / failed')}${tabBtn('next', 'Next 90 days')}
                ${open.length ? `<button type="button" class="btn secondary btn-sm" style="font-size:12px;margin-left:auto;" onclick="app.popMarkAll()">✓ Mark ${open.length} shown as paid</button>` : ''}
            </div>
            <div style="font-size:11px;color:var(--gray-500);margin-bottom:4px;">Tick each card charge after it runs. "Before tracking" = due before 20 Oct 2026, counted as collected.</div>
            <div>${_popRows.length ? _popRows.map(i => _popRowHtml(i)).join('') : '<div style="padding:12px 0;color:var(--gray-500);font-size:13px;">Nothing here 🎉</div>'}</div>`;
        UI.showModal('💳 POP collections', body, [{ label: 'Close', action: 'UI.hideModal()' }]);
    };

    const popMark = async (id, status, opts = {}) => {
        const sb = _sb();
        if (!sb) return UI.toast.error('Offline — try again in a moment');
        try {
            const { error } = await sb.from('pop_installments').update({ status }).eq('id', id);
            if (error) throw error;
            UI.toast.success(status === 'paid' ? 'Marked paid ✓' : status === 'failed' ? 'Marked failed — the agent sees it on their to-do' : 'Back to due');
        } catch (e) {
            UI.toast.error('Could not update: ' + (e && e.message ? e.message : e));
            return false;
        }
        if (opts.plan) openPopPlan(opts.plan); else openPopBoard();
        apRenderTop5(true);
        return true;
    };

    const popMarkAll = async () => {
        const ids = _popRows.filter(i => i.status === 'due' || i.status === 'failed').map(i => i.id);
        if (!ids.length) return;
        if (!window.confirm(`Mark ${ids.length} charge${ids.length === 1 ? '' : 's'} as paid?`)) return;
        const sb = _sb();
        try {
            const { error } = await sb.from('pop_installments').update({ status: 'paid' }).in('id', ids);
            if (error) throw error;
            UI.toast.success(`${ids.length} marked paid ✓`);
        } catch (e) {
            UI.toast.error('Could not update: ' + (e && e.message ? e.message : e));
        }
        openPopBoard();
        apRenderTop5(true);
    };

    // One plan's whole schedule (from the 💳 profile line or a board row)
    const openPopPlan = async (purchaseId) => {
        const sb = _sb();
        if (!sb) return;
        let rows = [];
        try {
            const { data, error } = await sb.from('pop_installments').select(_popSelect).eq('purchase_id', purchaseId).order('seq');
            if (error) throw error;
            rows = data || [];
        } catch (e) {
            return UI.toast.error('Could not load the plan: ' + (e && e.message ? e.message : e));
        }
        if (!rows.length) return UI.toast.info('No POP schedule for this sale');
        const pu = rows[0].purchases || {};
        const left = rows.filter(i => i.status === 'due' || i.status === 'failed').reduce((s, i) => s + (Number(i.amount) || 0), 0);
        const done = rows.filter(i => i.status === 'paid' || i.status === 'assumed' || i.status === 'waived').length;
        const head = `<div style="font-size:13px;margin-bottom:8px;"><strong>${esc((rows[0].customers && rows[0].customers.full_name) || '')}</strong> · ${esc(String(pu.item || '').slice(0, 50))}<br>
            <span style="color:var(--gray-600);">${done}/${rows.length} paid · <strong>RM ${Math.round(left).toLocaleString()}</strong> left · ${esc(_maskCard([pu.epp_bank, pu.payment_method].filter(Boolean).join(' · ')))}</span></div>`;
        const list = rows.map(i => _popRowHtml(i, { plan: purchaseId })).join('');
        UI.showModal('💳 POP plan', head + list, [{ label: 'All POP', action: 'app.openPopBoard()' }, { label: 'Close', action: 'UI.hideModal()' }]);
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
        line.className = 'ap-pop-line';
        line.dataset.popFor = String(pid);
        line.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin:0 0 8px;padding:6px 10px;border-radius:8px;background:#ECFDF5;border:1px solid #A7F3D0;font-size:13px;';
        line.innerHTML = plans.map(p => `
            <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;cursor:pointer;" onclick="event.stopPropagation();app.openPopPlan(${Number(p.purchase_id)})">
                <strong style="color:#065F46;">💳 POP ${Number(p.done) || 0}/${Number(p.total) || 0}</strong>
                <span>RM ${Math.round(Number(p.left_rm) || 0).toLocaleString()} left</span>
                ${p.next_due ? `<span style="color:#6B7280;">next RM${Math.round(Number(p.next_amount) || 0)} ${esc(_fmt(p.next_due))}</span>` : ''}
                ${Number(p.failed) ? `<span style="color:#B91C1C;font-weight:700;">⚠ ${Number(p.failed)} failed</span>` : ''}
                <span style="color:#9CA3AF;font-size:11px;">${esc(String(p.item || '').slice(0, 24))}</span>
            </div>`).join('');
        slot.insertAdjacentElement('afterend', line);
    };

    // push link ./index.html?pop=1#pipeline → open the board
    try {
        if (/[?&]pop=1\b/.test(location.search)) {
            history.replaceState(null, '', location.pathname + location.hash);
            setTimeout(() => openPopBoard('month'), 2500);
        }
    } catch (_) { /* best-effort */ }

    // ═════ Mount everything on DOM changes ═════
    const _scan = () => {
        try { apMountTop5(); } catch (_) { /* best-effort */ }
        try { apMountFunnel(); } catch (_) { /* best-effort */ }
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
        openPopBoard,
        openPopPlan,
        popMark,
        popMarkAll,
        apFillPopLine,
    });
    console.log('[chunk] script-autopilot loaded');
})();
