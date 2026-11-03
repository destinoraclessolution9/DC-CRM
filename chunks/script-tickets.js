/**
 * CRM Lazy Chunk: Big event ticket categories (2026-11-03)
 *
 * A big event (events.is_big_event) sells several ticket categories, each with
 * its own price, optional early-bird price + end date, and seats per team per
 * session date (events.ticket_tiers[].seats keyed by the users.team label,
 * '_none' = no team; blank = no limit). A full category is a warning
 * ("Register anyway"), never a block — owner rule. Each attendee keeps a
 * snapshot (ticket_tier / _name / _price / _team) so a later price or team
 * change never rewrites what they were sold. Seat counts come from the
 * event_ticket_counts RPC (sees every agent's session rows, counts only),
 * falling back to the rows the browser can read.
 * Migration: migrations/event_ticket_tiers_2026-11-03.sql.
 *
 * Surfaces:
 *   Marketing → Events add / edit   Big event tick + category editor (ttInitEditor / ttReadEditor)
 *   Add Attendee / Add Agent        category picker + "run out" pop-up (ttMountPicker / ttResolvePick,
 *                                   called through _ttMount / _ttResolve in the activities chunk)
 *   Calendar Activity Details       ticket chip per attendee + seat summary (ttAttendeeChip /
 *                                   ttFillSessionSummary), pick / change a ticket (ttOpenAttendeeTicket)
 *
 * Loaded on demand by those three surfaces (window._loadChunk).
 */
(() => {
    const app = window.app;
    const _state = window._appState;
    const _utils = window._crmUtils;
    const esc = (...a) => _utils.escapeHtml(...a);
    const isSystemAdmin = (u) => _utils.isSystemAdmin(u || _state.cu);
    const isMarketingManager = (u) => _utils.isMarketingManager(u || _state.cu);

    const TT_NONE = '_none';
    const TT_PRESETS = ['Super VIP', 'VVIP', 'VIP', 'Normal', 'Agent (FOC)', 'Agent (Paid)'];
    // Same normalisation as the 'Own Team' visibility check in script.js.
    const _ttNormTeam = (t) => { const s = t != null ? String(t).trim() : ''; return (!s || s.toLowerCase() === 'unassigned') ? '' : s; };
    const _ttTeamKey = (team) => _ttNormTeam(team) || TT_NONE;
    const _ttTeamLabel = (key) => (!key || key === TT_NONE) ? 'No team' : key;
    const _ttParse = (raw) => {
        let t = raw;
        if (typeof t === 'string') { try { t = JSON.parse(t); } catch (_) { t = null; } }
        return Array.isArray(t) ? t.filter(x => x && x.key && String(x.name || '').trim()) : [];
    };
    const _ttTiers = (ev) => (ev && ev.is_big_event) ? _ttParse(ev.ticket_tiers) : [];
    const _ttToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const _ttNum = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
    // Price charged when registering on `day`: early bird up to and including its end date.
    const _ttPriceOn = (tier, day = _ttToday()) => {
        const early = _ttNum(tier.early_price);
        if (early != null && tier.early_end && String(day) <= String(tier.early_end)) return { price: early, early: true };
        return { price: _ttNum(tier.price) || 0, early: false };
    };
    const _ttSeats = (tier, teamKey) => {
        const v = _ttNum(tier && tier.seats ? tier.seats[teamKey] : null);
        return v == null ? null : Math.max(0, Math.floor(v));
    };
    const _ttTaken = (counts, teamKey, tierKey) => counts.get(teamKey + '|' + tierKey) || 0;
    // RPC rows carry `taken`; attendee rows count one each.
    const _ttCountsFromRows = (rows) => {
        const m = new Map();
        for (const r of rows || []) {
            if (!r || !r.ticket_tier) continue;
            const k = _ttTeamKey(r.ticket_team) + '|' + r.ticket_tier;
            m.set(k, (m.get(k) || 0) + (r.taken != null ? Number(r.taken) || 0 : 1));
        }
        return m;
    };
    const _ttFetchCounts = async (eventId, date) => {
        try {
            const sb = window.supabase || window.supabaseClient;
            if (!sb || !date) throw new Error('no session');
            const { data, error } = await sb.rpc('event_ticket_counts', { p_event: Number(eventId), p_date: date });
            if (error) throw error;
            return _ttCountsFromRows(data);
        } catch (_) {
            // Fallback: the session's rows this browser can read (may miss another
            // agent's private activity — better a slightly low count than none).
            try {
                const [acts, atts] = await Promise.all([
                    AppDataStore.getAll('activities'),
                    AppDataStore.query('event_attendees', { event_id: eventId }),
                ]);
                const ids = new Set((acts || []).filter(a => String(a.event_id) === String(eventId)
                    && String(a.activity_date || '').slice(0, 10) === date).map(a => String(a.id)));
                return _ttCountsFromRows((atts || []).filter(a => a.activity_id && ids.has(String(a.activity_id))));
            } catch (_e) { return new Map(); }
        }
    };
    const _ttFreshEvent = async (eventId) => {
        if (eventId == null || eventId === '' || String(eventId) === 'null') return null;
        try {
            const fresh = await Promise.race([
                AppDataStore.getByIdFull('events', eventId),
                new Promise(r => setTimeout(() => r(null), 4000)),
            ]);
            if (fresh) return fresh;
        } catch (_) { /* intentional: fall back to the cached row */ }
        return AppDataStore.getById('events', eventId);
    };
    const _ttUserTeamKey = async (userId) => {
        const cu = _state.cu || {};
        if (String(userId) === String(cu.id) && cu.team !== undefined) return _ttTeamKey(cu.team);
        try { const u = await AppDataStore.getById('users', userId); return _ttTeamKey(u && u.team); } catch (_) { return TT_NONE; }
    };
    const _ttOrgWide = () => isSystemAdmin(_state.cu) || isMarketingManager(_state.cu);
    // Every team label in use, then No team.
    const _ttTeamKeys = async () => {
        let users = [];
        try { users = (await AppDataStore.getAll('users')) || []; } catch (_) { /* intentional: offline → No team only */ }
        const s = new Set();
        users.forEach(u => { if (u && u.status !== 'inactive') { const t = _ttNormTeam(u.team); if (t) s.add(t); } });
        return [...s].sort((a, b) => a.localeCompare(b)).concat(TT_NONE);
    };
    const _ttMoney = (n, ev) => UI.money(n, ev && ev.country);
    // "2 of 5 left" / "Full · 5 of 5" / "6 of 5 · 1 over" / "3 registered"
    const _ttLeftText = (taken, seats) => {
        if (seats == null) return `${taken} registered · no limit`;
        if (taken > seats) return `${taken} of ${seats} · ${taken - seats} over`;
        if (taken === seats) return `Full · ${taken} of ${seats}`;
        return `${seats - taken} of ${seats} left`;
    };

    // ── Event form editor (Marketing → Events add / edit) ──
    let _ttEd = null; // { tiers, teams }
    const _ttNewKey = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const _ttEdSync = () => {
        if (!_ttEd) return;
        _ttEd.tiers = _ttEd.tiers.map((t, i) => {
            const val = (id) => { const el = document.getElementById(id); return el ? el.value : undefined; };
            if (val(`tt-n-${i}`) === undefined) return t;
            const seats = {};
            _ttEd.teams.forEach((tk, j) => { const n = _ttNum(val(`tt-s-${i}-${j}`)); if (n != null) seats[tk] = Math.max(0, Math.floor(n)); });
            const early = _ttNum(val(`tt-ep-${i}`));
            return {
                key: t.key,
                name: String(val(`tt-n-${i}`) || '').trim(),
                price: _ttNum(val(`tt-p-${i}`)) || 0,
                early_price: early,
                early_end: early != null ? (val(`tt-ee-${i}`) || null) : null,
                agent_only: !!(document.getElementById(`tt-ao-${i}`) || {}).checked,
                seats,
            };
        });
    };
    const _ttEdRender = () => {
        const host = document.getElementById('tt-editor');
        if (!host || !_ttEd) return;
        const { tiers, teams } = _ttEd;
        const used = new Set(tiers.map(t => String(t.name || '').trim().toLowerCase()));
        const card = (t, i) => `
            <div class="tt-card">
                <div class="tt-card-top">
                    <input type="text" id="tt-n-${i}" class="form-control tt-name" value="${esc(t.name || '')}" placeholder="Category name, e.g. VVIP">
                    <button type="button" class="tt-x" title="Remove category" aria-label="Remove category" onclick="app.ttEdRemove(${i})">&times;</button>
                </div>
                <div class="tt-grid">
                    <label>Price<input type="number" min="0" id="tt-p-${i}" class="form-control" value="${t.price != null ? esc(String(t.price)) : ''}" placeholder="0"></label>
                    <label>Early-bird price<input type="number" min="0" id="tt-ep-${i}" class="form-control" value="${t.early_price != null ? esc(String(t.early_price)) : ''}" placeholder="optional"></label>
                    <label>Early bird ends<input type="date" id="tt-ee-${i}" class="form-control" value="${esc(t.early_end || '')}"></label>
                </div>
                <label class="tt-ao"><input type="checkbox" id="tt-ao-${i}" ${t.agent_only ? 'checked' : ''}> Agents only — hidden from client invites &amp; the noticeboard</label>
                <div class="tt-seats-head">
                    <span>Seats per team <small>(each date · blank = no limit)</small></span>
                    <button type="button" class="tt-link" onclick="app.ttEdFillSeats(${i})">Same for all teams</button>
                </div>
                <div class="tt-seats">
                    ${teams.map((tk, j) => `<label>${esc(_ttTeamLabel(tk))}<input type="number" min="0" id="tt-s-${i}-${j}" class="form-control" value="${_ttSeats(t, tk) != null ? _ttSeats(t, tk) : ''}" placeholder="no limit"></label>`).join('')}
                </div>
            </div>`;
        host.innerHTML = `
            <div class="tt-ed">
                <div class="tt-ed-head">🎟 Ticket categories</div>
                ${tiers.map(card).join('') || '<div class="tt-empty">No categories yet — add one below.</div>'}
                <div class="tt-add">
                    ${TT_PRESETS.map((p, k) => used.has(p.toLowerCase()) ? '' : `<button type="button" class="btn btn-sm secondary" onclick="app.ttEdAdd(${k})">+ ${esc(p)}</button>`).join('')}
                    <button type="button" class="btn btn-sm secondary" onclick="app.ttEdAdd(-1)">+ Other</button>
                </div>
            </div>`;
        host.dataset.ttReady = '1';
    };
    const ttToggleBig = (checked) => {
        const normal = document.getElementById('mkt-normal-prices');
        const ed = document.getElementById('tt-editor');
        if (normal) normal.style.display = checked ? 'none' : '';
        if (ed) ed.style.display = checked ? '' : 'none';
    };
    const ttInitEditor = async (ev) => {
        const host = document.getElementById('tt-editor');
        if (!host) return;
        const teams = await _ttTeamKeys();
        if (!document.getElementById('tt-editor')) return; // modal closed meanwhile
        _ttEd = { tiers: _ttParse(ev && ev.ticket_tiers).map(t => ({ ...t, seats: { ...(t.seats || {}) } })), teams };
        _ttEdRender();
        const cb = document.getElementById('mkt-big-event');
        ttToggleBig(!!(cb && cb.checked));
    };
    const ttEdAdd = (presetIdx) => {
        if (!_ttEd) return;
        _ttEdSync();
        const name = presetIdx >= 0 ? (TT_PRESETS[presetIdx] || '') : '';
        _ttEd.tiers.push({ key: _ttNewKey(), name, price: /FOC/.test(name) ? 0 : null, early_price: null, early_end: null, agent_only: /^Agent/.test(name), seats: {} });
        _ttEdRender();
        if (!name) { const el = document.getElementById(`tt-n-${_ttEd.tiers.length - 1}`); if (el) el.focus(); }
    };
    const ttEdRemove = (i) => {
        if (!_ttEd) return;
        _ttEdSync();
        _ttEd.tiers.splice(i, 1);
        _ttEdRender();
    };
    // Copy the first filled team box in this category to every team.
    const ttEdFillSeats = (i) => {
        if (!_ttEd) return;
        const boxes = _ttEd.teams.map((_, j) => document.getElementById(`tt-s-${i}-${j}`)).filter(Boolean);
        const src = boxes.find(b => String(b.value).trim() !== '');
        if (!src) { UI.toast.error('Type the seats for one team first'); return; }
        boxes.forEach(b => { b.value = src.value; });
    };
    // Read the form for saveMarketingListItem. null = this form has no ticket
    // editor (leave the columns alone); { error } = block the save.
    const ttReadEditor = () => {
        const cb = document.getElementById('mkt-big-event');
        const host = document.getElementById('tt-editor');
        if (!cb || !host) return null;
        // Only trust _ttEd once it was rendered into THIS form (a previous
        // event's editor state must never be saved onto another event).
        if (!_ttEd || host.dataset.ttReady !== '1') {
            return cb.checked ? { error: 'Ticket categories are still loading — tap Save again' } : null;
        }
        _ttEdSync();
        const tiers = _ttEd.tiers.filter(t => t.name);
        if (cb.checked) {
            if (!tiers.length) return { error: 'Add at least one ticket category for a big event' };
            const seen = new Set();
            for (const t of tiers) {
                const k = t.name.toLowerCase();
                if (seen.has(k)) return { error: `Two ticket categories are both called "${t.name}"` };
                seen.add(k);
                if (t.early_price != null && !t.early_end) return { error: `${t.name}: give the early-bird price an end date` };
            }
        }
        // Lowest paid CLIENT price (agents-only left out) — what the list, invites
        // and noticeboard show as the price.
        const pub = tiers.filter(t => !t.agent_only);
        const paid = (pub.length ? pub : tiers).map(t => Number(t.price) || 0).filter(p => p > 0);
        return { is_big_event: !!cb.checked, ticket_tiers: tiers, from_price: paid.length ? Math.min(...paid) : 0 };
    };

    // ── Ticket picker (Add Attendee / Add Agent / change an attendee's ticket) ──
    let _ttPick = null; // { hostId, ev, date, tiers, counts, teamKey, teams, tierKey, keepTier, keepTeam }
    const _ttRenderPicker = () => {
        const p = _ttPick;
        const host = p && document.getElementById(p.hostId);
        if (!host) return;
        const teamSel = p.teams ? `
            <label class="tt-pick-team">Count under
                <select class="form-control" onchange="app.ttPickTeam(this.value)">
                    ${p.teams.map(tk => `<option value="${esc(tk)}" ${tk === p.teamKey ? 'selected' : ''}>${esc(_ttTeamLabel(tk))}</option>`).join('')}
                </select>
            </label>` : `<span class="tt-pick-for">Seats for ${esc(_ttTeamLabel(p.teamKey))}</span>`;
        const opt = (t) => {
            const seats = _ttSeats(t, p.teamKey);
            const taken = _ttTaken(p.counts, p.teamKey, t.key);
            const full = seats != null && taken >= seats;
            const { price, early } = _ttPriceOn(t);
            const priceHtml = early
                ? `${esc(_ttMoney(price, p.ev))} <s>${esc(_ttMoney(t.price, p.ev))}</s> <em>early bird</em>`
                : esc(_ttMoney(price, p.ev));
            return `
                <label class="tt-opt${full ? ' is-full' : ''}${p.tierKey === t.key ? ' is-on' : ''}">
                    <input type="radio" name="tt-pick" value="${esc(t.key)}" ${p.tierKey === t.key ? 'checked' : ''} onchange="app.ttPickTier(this.value)">
                    <span class="tt-opt-name">${esc(t.name)}${t.agent_only ? ' <span class="tt-opt-tag">agents only</span>' : ''}</span>
                    <span class="tt-opt-price">${priceHtml}</span>
                    <span class="tt-opt-left">${esc(_ttLeftText(taken, seats))}</span>
                </label>`;
        };
        host.innerHTML = `
            <div class="tt-pick">
                <div class="tt-pick-head"><span>🎟 Ticket category</span>${teamSel}</div>
                <div class="tt-opts">${p.tiers.map(opt).join('')}</div>
            </div>`;
    };
    // Fill #hostId with the picker when the event is a big event (else leave it
    // empty and clear _ttPick, so the save paths write no ticket fields). A save
    // tapped while this is still loading waits for it (_ttPickReady), so a fast
    // tap on a big event can't slip through with no ticket.
    let _ttPickReady = Promise.resolve();
    const _ttMountPicker = (hostId, opts) => {
        _ttPick = null;
        _ttPickReady = _ttMountPickerNow(hostId, opts || {});
        return _ttPickReady;
    };
    const _ttMountPickerNow = async (hostId, { eventId, activityId, date, teamKey, tierKey }) => {
        const host = document.getElementById(hostId);
        if (!host) return;
        const ev = await _ttFreshEvent(eventId);
        const tiers = _ttTiers(ev);
        if (!tiers.length) { host.innerHTML = ''; return; }
        let day = date ? String(date).slice(0, 10) : '';
        if (!day && activityId) {
            try { const act = await AppDataStore.getById('activities', activityId); day = act && act.activity_date ? String(act.activity_date).slice(0, 10) : ''; } catch (_) { /* intentional: counts fall back below */ }
        }
        const [counts, myTeam, teams] = await Promise.all([
            _ttFetchCounts(ev.id, day),
            teamKey ? Promise.resolve(teamKey) : _ttUserTeamKey(_state.cu && _state.cu.id),
            _ttOrgWide() ? _ttTeamKeys() : Promise.resolve(null),
        ]);
        if (!document.getElementById(hostId)) return; // modal closed meanwhile
        if (teams && !teams.includes(myTeam)) teams.push(myTeam);
        _ttPick = { hostId, ev, date: day, tiers, counts, teamKey: myTeam, teams, tierKey: tierKey || null, keepTier: tierKey || null, keepTeam: myTeam };
        _ttRenderPicker();
    };
    const ttPickTier = (key) => { if (_ttPick) { _ttPick.tierKey = key; _ttRenderPicker(); } };
    const ttPickTeam = (tk) => { if (_ttPick) { _ttPick.teamKey = tk; _ttRenderPicker(); } };

    // "Run out" pop-up over the open modal. Resolves true = Register anyway.
    let _ttFullResolve = null;
    const ttFullAnswer = (yes) => {
        const el = document.getElementById('tt-full-pop');
        if (el) el.remove();
        const r = _ttFullResolve;
        _ttFullResolve = null;
        if (r) r(!!yes);
    };
    const _ttFullPopup = (tierName, teamKey, taken, seats) => new Promise((resolve) => {
        if (_ttFullResolve) ttFullAnswer(false);
        _ttFullResolve = resolve;
        const el = document.createElement('div');
        el.id = 'tt-full-pop';
        el.className = 'tt-full-pop';
        el.setAttribute('role', 'alertdialog');
        el.setAttribute('aria-modal', 'true');
        el.innerHTML = `
            <div class="tt-full-card">
                <div class="tt-full-title">🎟 ${esc(tierName)} tickets have run out</div>
                <div class="tt-full-msg">${esc(_ttTeamLabel(teamKey))}: ${taken} of ${seats} seats taken. You can still register — it will show as over.</div>
                <div class="tt-full-btns">
                    <button type="button" class="btn secondary" onclick="app.ttFullAnswer(false)">Pick another</button>
                    <button type="button" class="btn primary" onclick="app.ttFullAnswer(true)">Register anyway</button>
                </div>
            </div>`;
        document.body.appendChild(el);
    });
    // The ticket fields for a save. {} = not a big event (write nothing);
    // null = stop (nothing picked, or the owner chose Pick another).
    const _ttResolvePick = async () => {
        try { await _ttPickReady; } catch (_) { /* intentional: a failed load leaves no picker */ }
        const p = _ttPick;
        if (!p || !document.getElementById(p.hostId)) return {};
        const tier = p.tiers.find(t => t.key === p.tierKey);
        if (!tier) { UI.toast.error('Pick a ticket category'); return null; }
        const unchanged = tier.key === p.keepTier && p.teamKey === p.keepTeam;
        const seats = _ttSeats(tier, p.teamKey);
        const taken = _ttTaken(p.counts, p.teamKey, tier.key);
        if (!unchanged && seats != null && taken >= seats) {
            if (!(await _ttFullPopup(tier.name, p.teamKey, taken, seats))) return null;
        }
        return {
            ticket_tier: tier.key,
            ticket_tier_name: tier.name,
            ticket_price: _ttPriceOn(tier).price,
            ticket_team: p.teamKey === TT_NONE ? null : p.teamKey,
        };
    };

    // ── Attendee list (calendar Activity Details) ──
    // Chip on an attendee row. canEdit → a button that opens the ticket picker.
    const ttAttendeeChip = (att, ev, canEdit, activityId) => {
        const tiers = _ttTiers(ev);
        if (!tiers.length || !att) return '';
        const open = `event.stopPropagation();app.ttOpenAttendeeTicket(${Number(att.id)}, ${Number(activityId)})`;
        if (!att.ticket_tier) {
            return canEdit ? `<button type="button" class="tt-chip tt-chip-empty" onclick="${open}">🎟 Pick ticket</button>` : '';
        }
        const tier = tiers.find(t => t.key === att.ticket_tier);
        const name = (tier && tier.name) || att.ticket_tier_name || 'Ticket';
        const price = att.ticket_price != null ? ' · ' + _ttMoney(att.ticket_price, ev) : '';
        return canEdit
            ? `<button type="button" class="tt-chip" title="Change ticket" onclick="${open}">🎟 ${esc(name)}${esc(price)}</button>`
            : `<span class="tt-chip">🎟 ${esc(name)}</span>`;
    };
    // Ticket sales per category (event_ticket_revenue — admin / marketing only;
    // date null = the whole event). Map tierKey → { amount, paid }; null on error.
    const _ttFetchRevenue = async (eventId, date) => {
        try {
            const sb = window.supabase || window.supabaseClient;
            const { data, error } = await sb.rpc('event_ticket_revenue', { p_event: Number(eventId), p_date: date || null });
            if (error) throw error;
            const m = new Map();
            (data || []).forEach(r => m.set(r.ticket_tier, { amount: Number(r.amount) || 0, paid: Number(r.paid_amount) || 0 }));
            return m;
        } catch (_) { return null; }
    };
    const _ttRevTotal = (rev) => {
        let amount = 0, paid = 0;
        if (rev) rev.forEach(v => { amount += v.amount; paid += v.paid; });
        return { amount, paid };
    };
    // Seat summary for one session, filled after the modal opens. Agents see
    // their own team's line; admin / marketing see a team × category table
    // with sales + paid per category.
    const ttFillSessionSummary = async (hostId, ev, date) => {
        const host = document.getElementById(hostId);
        const tiers = _ttTiers(ev);
        if (!host || !tiers.length) return;
        const day = String(date || '').slice(0, 10);
        const [counts, myTeam] = await Promise.all([_ttFetchCounts(ev.id, day), _ttUserTeamKey(_state.cu && _state.cu.id)]);
        if (!document.getElementById(hostId)) return;
        const cell = (tk, t) => {
            const seats = _ttSeats(t, tk);
            const taken = _ttTaken(counts, tk, t.key);
            const cls = seats == null ? '' : (taken > seats ? ' is-over' : (taken === seats ? ' is-full' : ''));
            const txt = seats == null ? String(taken) : `${taken}/${seats}`;
            const over = seats != null && taken > seats ? ` · ${taken - seats} over` : '';
            return { cls, txt: txt + over };
        };
        if (!_ttOrgWide()) {
            host.innerHTML = `<div class="tt-sum"><span class="tt-sum-team">${esc(_ttTeamLabel(myTeam))} seats</span>${tiers.map(t => {
                const c = cell(myTeam, t);
                return `<span class="tt-sum-item${c.cls}">${esc(t.name)} ${esc(c.txt)}</span>`;
            }).join('')}</div>`;
            return;
        }
        const [teams, revDay, revAll] = await Promise.all([_ttTeamKeys(), _ttFetchRevenue(ev.id, day), _ttFetchRevenue(ev.id, null)]);
        if (!document.getElementById(hostId)) return;
        counts.forEach((_, k) => { const tk = k.split('|')[0]; if (!teams.includes(tk)) teams.push(tk); });
        const rows = teams.filter(tk => tiers.some(t => _ttSeats(t, tk) != null || _ttTaken(counts, tk, t.key) > 0));
        const total = (t) => {
            const taken = teams.reduce((s, tk) => s + _ttTaken(counts, tk, t.key), 0);
            const capped = teams.map(tk => _ttSeats(t, tk));
            const seats = capped.every(s => s != null) ? capped.reduce((s, n) => s + n, 0) : null;
            return seats == null ? String(taken) : `${taken}/${seats}`;
        };
        host.innerHTML = `
            <div class="tt-sum-wrap">
                <table class="tt-sum-table">
                    <thead><tr><th>Team</th>${tiers.map(t => `<th>${esc(t.name)}</th>`).join('')}</tr></thead>
                    <tbody>
                        ${rows.map(tk => `<tr><td>${esc(_ttTeamLabel(tk))}</td>${tiers.map(t => { const c = cell(tk, t); return `<td class="${c.cls.trim()}">${esc(c.txt)}</td>`; }).join('')}</tr>`).join('')
                            || `<tr><td colspan="${tiers.length + 1}" class="tt-sum-none">No tickets registered yet.</td></tr>`}
                    </tbody>
                    <tfoot>
                        <tr><td>Total</td>${tiers.map(t => `<td>${esc(total(t))}</td>`).join('')}</tr>
                        ${revDay ? `<tr class="tt-rev"><td>Sales</td>${tiers.map(t => `<td>${esc(_ttMoney((revDay.get(t.key) || {}).amount || 0, ev))}</td>`).join('')}</tr>
                        <tr class="tt-rev"><td>Paid</td>${tiers.map(t => `<td>${esc(_ttMoney((revDay.get(t.key) || {}).paid || 0, ev))}</td>`).join('')}</tr>` : ''}
                    </tfoot>
                </table>
                ${revDay ? (() => {
                    const d = _ttRevTotal(revDay), a = _ttRevTotal(revAll);
                    const line = (x) => `Sales ${_ttMoney(x.amount, ev)} · Paid ${_ttMoney(x.paid, ev)} · Unpaid ${_ttMoney(x.amount - x.paid, ev)}`;
                    return `<div class="tt-rev-line"><strong>This date:</strong> ${esc(line(d))}</div>`
                        + (revAll && (a.amount !== d.amount || a.paid !== d.paid) ? `<div class="tt-rev-line"><strong>Whole event (all dates):</strong> ${esc(line(a))}</div>` : '');
                })() : ''}
                <div class="tt-sum-note">Taken / seats per team · a number alone = no limit · sales = ticket prices booked, paid = Paid ticked</div>
            </div>`;
    };
    // Pick or change one attendee's ticket from the attendee list.
    const ttOpenAttendeeTicket = async (attendeeId, activityId) => {
        const att = (await AppDataStore.getByIdFull('event_attendees', attendeeId)) || (await AppDataStore.getById('event_attendees', attendeeId));
        if (!att) { UI.toast.error('Attendee not found'); return; }
        const name = att.entity_name || '';
        UI.showModal('Ticket' + (name ? ' — ' + name : ''), '<div id="tt-pick-edit" style="min-height:60px;color:var(--gray-400);font-size:13px;">Loading…</div>', [
            { label: 'Cancel', type: 'secondary', action: `(async()=>{ UI.hideModal(); await app.viewActivityDetails(${Number(activityId)}); })()` },
            { label: 'Save', type: 'primary', action: `(async()=>{ await app.ttSaveAttendeeTicket(${Number(attendeeId)}, ${Number(activityId)}); })()` },
        ]);
        const teamKey = att.ticket_tier
            ? _ttTeamKey(att.ticket_team)
            : await _ttUserTeamKey(att.added_by_agent_id != null ? att.added_by_agent_id : (_state.cu && _state.cu.id));
        await _ttMountPicker('tt-pick-edit', { eventId: att.event_id, activityId: att.activity_id || activityId, teamKey, tierKey: att.ticket_tier || null });
        const host = document.getElementById('tt-pick-edit');
        if (host && !_ttPick) host.innerHTML = '<div class="info-row">This event has no ticket categories.</div>';
    };
    const ttSaveAttendeeTicket = async (attendeeId, activityId) => {
        const fields = await _ttResolvePick();
        if (!fields || !fields.ticket_tier) return;
        try {
            await AppDataStore.update('event_attendees', attendeeId, fields);
            try { AppDataStore.invalidateCache('event_attendees'); } catch (_) { /* intentional: cache refresh is best-effort */ }
            UI.hideModal();
            await app.viewActivityDetails(activityId);
            UI.toast.success('Ticket saved · ' + fields.ticket_tier_name);
        } catch (e) {
            UI.toast.error('Could not save the ticket: ' + (e.message || e));
        }
    };

    app.register('tickets', {
        ttToggleBig,
        ttInitEditor,
        ttEdAdd,
        ttEdRemove,
        ttEdFillSeats,
        ttReadEditor,
        ttMountPicker: _ttMountPicker,
        ttResolvePick: _ttResolvePick,
        ttPickTier,
        ttPickTeam,
        ttFullAnswer,
        ttAttendeeChip,
        ttFillSessionSummary,
        ttOpenAttendeeTicket,
        ttSaveAttendeeTicket,
    });
    console.log('[chunk] script-tickets loaded');
})();
