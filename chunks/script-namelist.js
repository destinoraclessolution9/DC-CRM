/**
 * CRM Lazy Chunk: Name List page (2026-11-03, owner)
 *
 * Sidebar "Name List" — who to approach, why, what to do next, what happened.
 *   📋 My Lists    saved target lists: purpose → product line × goal → how many →
 *                  Generate (same engine as ✨ Who to invite) → tick / take off
 *                  (with a reason) → work it (WhatsApp / called / reply / met) →
 *                  sales that followed. Regenerate = a new version; old ones stay.
 *   🎯 Who to Focus the Reports "Name List — Who to Focus" section, moved here
 *                  (still rendered by the reporting chunk).
 *   📈 Results     funnel per list + event invite results.
 *
 * Data: RPCs from migrations/2026-11-03_name_lists.sql (name_list_index / _get /
 * _create / _regenerate / _set / _decide / _add / _step). "Do not contact"
 * (do_not_invite) is enforced in the database — the screen only explains it.
 * Loaded by navigateTo('name_list').
 */
(() => {
    const app = window.app;
    const _state = window._appState;
    const _utils = window._crmUtils;
    const esc = (...a) => _utils.escapeHtml(...a);

    const NLP_TABS = [['lists', '📋', 'My Lists'], ['focus', '🎯', 'Who to Focus'], ['results', '📈', 'Results']];
    const NLP_PURPOSES = [
        ['promote', 'Promote a product', 'decide'],
        ['service', 'Recommend a service', 'service'],
        ['follow_up', 'Follow up customers', 'comeback'],
        ['other', 'Something else', 'decide'],
    ];
    const NLP_GOALS = {
        decide: 'Decide 成交', upgrade: 'Upgrade 升级', introduce: 'Introduce 认识',
        service: 'Service 服务', comeback: 'Come back 回流',
    };
    const NLP_PURPOSE_GOALS = {
        promote: ['decide', 'introduce', 'upgrade'],
        service: ['service', 'upgrade'],
        follow_up: ['comeback', 'service', 'decide'],
        other: ['decide', 'introduce', 'upgrade', 'service', 'comeback'],
    };
    // Who to include: the engine's best fits, or everyone by what they bought from the line.
    const NLP_WHO = [['best', 'Best fit (CRM picks)'], ['owns_1', 'Bought exactly 1'], ['owns_any', 'Bought 1 or more'], ['owns_none', 'Never bought']];
    const NLP_REMOVE = [['not_fit', 'Not suitable now'], ['handled', 'Already being handled'], ['wrong_person', 'Wrong person / duplicate'], ['no_contact', 'Cannot reach'], ['other', 'Other (write why)']];
    const NLP_REPLY = [['interested', '👍 Interested'], ['not_now', '⏳ Not now'], ['not_interested', '🙅 Not interested'], ['no_reply', '… No reply']];
    const NLP_STEP_LABEL = {
        whatsapp: '💬 WhatsApp', called: '📞 Called', met: '🤝 Met', CALL: '📞 Call logged', WHATSAPP: '💬 WhatsApp logged',
        FTF: '🤝 Meeting logged', CPS: '🤝 CPS logged', FSA: '🤝 Audit logged', SITE: '🤝 Site visit logged', GR: '🤝 Meeting logged', XG: '🤝 Meeting logged',
        EVENT: '🎉 Came to an event',
        interested: '👍 Interested', not_now: '⏳ Not now', not_interested: '🙅 Not interested', no_reply: '… No reply', stop: '🚫 Asked us to stop',
    };
    const NLP_STATUS = { draft: 'Draft', active: 'Active', completed: 'Done', archived: 'Archived' };
    const NLP_WARN = {
        only_events: 'only seen at events', no_notes: 'meetings have no notes', no_phone: 'no phone number',
        no_contact_6m: 'no contact for 6 months', agent_inactive: 'agent left — upline covers', invited_often: 'invited twice this month',
        not_matched_now: 'no longer matches — kept from the last version',
        'check_first:no_agent': 'check first: no agent', 'check_first:said_not_interested': 'check first: said not interested at CPS',
        'check_first:no_time_3x': 'check first: "no time" 3× in a row', 'check_first:no_show_2x': 'check first: no-show twice',
        'check_first:no_reply_2x': 'check first: no reply twice',
    };
    const NLP_HELD = {
        do_not_invite: 'asked not to be contacted', unable_to_serve: 'unable to serve', grade_f: 'dropped (grade F)',
        cooldown: 'cooling down', paused: 'paused after saying no', complete: 'already own it',
    };

    const _nlp = {
        tab: (() => { try { return localStorage.getItem('fs_nlp_tab') || 'lists'; } catch (_) { return 'lists'; } })(),
        filter: 'open', index: null, canTeam: false, err: '', listId: null, version: null, detail: null,
        lines: null, products: null, sessions: null, addTimer: null, results: null,
    };

    const _sb = () => window.supabase || window.supabaseClient || null;
    const _rpc = async (name, args) => {
        const sb = _sb();
        if (!sb) throw new Error('Not connected — please refresh');
        const { data, error } = await sb.rpc(name, args || {});
        if (error) throw new Error(error.message || String(error));
        return data;
    };
    const _err = (e) => String(e && e.message ? e.message : e).replace(/^.*?:\s*(?=[A-Z])/, '');
    const _MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    // A timestamp shows the viewer's own day (a plain slice of a UTC time made
    // a 1 am step read "yesterday"); a bare YYYY-MM-DD date stays as it is.
    const _ymd = (v) => {
        if (!v) return '';
        const s = String(v);
        if (s.length > 10) {
            const t = new Date(s);
            if (!isNaN(t)) return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
        }
        return s.slice(0, 10);
    };
    const _d = (v) => {
        if (!v) return '';
        const s = _ymd(v);
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        return m ? `${Number(m[3])} ${_MON[Number(m[2]) - 1]}` : s;
    };
    const _rm = (n) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { maximumFractionDigits: 0 });
    const _waPhone = (raw) => {
        let p = String(raw || '').replace(/[^0-9]/g, '');
        if (!p) return '';
        if (p.startsWith('0')) p = '60' + p.slice(1);
        if (!p.startsWith('60') && !(p.startsWith('65') && p.length === 10) && p.length <= 10) p = '60' + p;
        return p;
    };
    const _body = () => document.getElementById('nlp-body');
    const _spin = (t) => `<div class="nlp-empty"><i class="fas fa-spinner fa-spin"></i> ${esc(t)}</div>`;

    // ── Page shell + tabs ────────────────────────────────────────────────────
    const showNameListView = async (vp) => {
        const host = vp || document.getElementById('content-viewport');
        if (!host) return;
        if (!NLP_TABS.some(t => t[0] === _nlp.tab)) _nlp.tab = 'lists';
        host.innerHTML = `
            <div class="nlp">
                <div class="nlp-head">
                    <div>
                        <h2 class="nlp-title">📇 Name List</h2>
                        <div class="nlp-sub">Who to approach, why they fit, what to do next — and what happened after.</div>
                    </div>
                </div>
                <div class="nlp-tabs" role="tablist" id="nlp-tabs">${_tabsHtml()}</div>
                <div id="nlp-body"></div>
            </div>`;
        await _renderTab();
    };
    const _tabsHtml = () => NLP_TABS.map(([k, i, l]) => `
        <button type="button" role="tab" aria-selected="${_nlp.tab === k}" class="nlp-tab${_nlp.tab === k ? ' is-on' : ''}" onclick="app.nlpTab('${k}')">${i} ${esc(l)}</button>`).join('');
    const nlpTab = async (k) => {
        _nlp.tab = k;
        try { localStorage.setItem('fs_nlp_tab', k); } catch (_) { /* private mode */ }
        if (k === 'lists') _nlp.listId = null;
        const t = document.getElementById('nlp-tabs');
        if (t) t.innerHTML = _tabsHtml();
        await _renderTab();
    };
    const _renderTab = async () => {
        if (_nlp.tab === 'focus') return _renderFocus();
        if (_nlp.tab === 'results') return _renderResults();
        if (_nlp.listId) return _renderDetail();
        return _renderIndex();
    };

    // ── 📋 My Lists ──────────────────────────────────────────────────────────
    const _loadIndex = async () => {
        try {
            const d = await _rpc('name_list_index');
            _nlp.index = (d && d.lists) || [];
            _nlp.canTeam = !!(d && d.can_team);
            _nlp.err = '';
        } catch (e) {
            _nlp.index = _nlp.index || [];
            _nlp.err = _err(e);
        }
    };
    const _funnelHtml = (c, target) => {
        c = c || {};
        const cell = (n, l) => `<span><b>${n}</b> ${l}</span>`;
        return `<div class="inv-funnel nlp-funnel">
            ${cell(`${c.picked || 0}${target ? `/${target}` : ''}`, 'picked')}
            ${cell(c.contacted || 0, 'contacted')}
            ${cell(c.replied || 0, 'replied')}
            ${cell(c.interested || 0, 'interested')}
            ${cell(c.met || 0, 'met')}
            ${cell(c.closed || 0, 'closed')}
            ${c.revenue ? `<span><b>${_rm(c.revenue)}</b></span>` : ''}
        </div>`;
    };
    const _dy = (v) => v ? `${_d(v)} ${String(v).slice(0, 4)}` : '';
    const _whoText = (l) => {
        if (!l.who || l.who === 'best') return '';
        const t = (NLP_WHO.find(w => w[0] === l.who) || [null, l.who])[1];
        return l.bought_from || l.bought_to ? `${t} · bought ${l.bought_from ? _dy(l.bought_from) : '…'} – ${l.bought_to ? _dy(l.bought_to) : 'today'}` : t;
    };
    const _listMeta = (l) => [
        `${esc(l.line_label || l.line)} · ${esc(NLP_GOALS[l.goal] || l.goal)}`,
        esc(_whoText(l)),
        l.scope === 'team' ? `team · ${l.target_qty} per agent` : `target ${l.target_qty}`,
        l.target_date ? `by ${_d(l.target_date)}` : '',
        l.mine ? '' : esc(l.owner_name || ''),
    ].filter(Boolean).join(' · ');
    const _renderIndex = async () => {
        const body = _body();
        if (!body) return;
        if (_nlp.index === null) body.innerHTML = _spin('Loading your lists…');
        await _loadIndex();
        if (_nlp.tab !== 'lists' || _nlp.listId) return;
        const all = _nlp.index || [];
        const open = all.filter(l => l.status === 'draft' || l.status === 'active');
        const done = all.filter(l => l.status === 'completed' || l.status === 'archived');
        const shown = _nlp.filter === 'done' ? done : open;
        const cards = shown.map(l => {
            const c = l.counts || {};
            const target = l.scope === 'team' ? null : l.target_qty;
            const pct = target ? Math.min(100, Math.round(100 * (c.picked || 0) / target)) : null;
            return `
            <button type="button" class="nlp-card" onclick="app.nlpOpen(${Number(l.id)})">
                <div class="nlp-card-top">
                    <span class="nlp-st nlp-st-${esc(l.status)}">${esc(NLP_STATUS[l.status] || l.status)}</span>
                    <span class="nlp-card-name">${esc(l.name)}</span>
                    ${l.scope === 'team' ? `<span class="inv-chip">Team · ${c.agents || 0} agent${(c.agents || 0) === 1 ? '' : 's'}</span>` : ''}
                </div>
                <div class="nlp-card-meta">${_listMeta(l)}</div>
                ${pct !== null ? `<div class="nlp-bar"><span style="width:${pct}%"></span></div>` : ''}
                ${_funnelHtml(c, target)}
            </button>`;
        }).join('');
        body.innerHTML = `
            <div class="nlp-bar-top">
                <div class="nlp-filters">
                    <button type="button" class="nlp-chip${_nlp.filter === 'open' ? ' is-on' : ''}" onclick="app.nlpFilter('open')">Open <b>${open.length}</b></button>
                    <button type="button" class="nlp-chip${_nlp.filter === 'done' ? ' is-on' : ''}" onclick="app.nlpFilter('done')">Done <b>${done.length}</b></button>
                </div>
                <div class="nlp-btns">
                    <button type="button" class="btn secondary" onclick="app.nlpEvents()">🎯 Invite to an event</button>
                    <button type="button" class="btn primary" onclick="app.nlpNew()"><i class="fas fa-plus"></i> New list</button>
                </div>
            </div>
            ${_nlp.err ? `<div class="inv-warn">Could not load lists — ${esc(_nlp.err)}</div>` : ''}
            ${shown.length ? `<div class="nlp-cards">${cards}</div>` : `
                <div class="nlp-empty">
                    ${_nlp.filter === 'done' ? 'No finished lists yet.' : `
                    <div class="nlp-empty-t">No open lists</div>
                    Make a list for a promotion, a service or customers to follow up: pick the product line and how many people,
                    and the CRM picks the best names with the reasons — the same rules as ✨ Who to invite on an event.
                    <div style="margin-top:10px;"><button type="button" class="btn primary" onclick="app.nlpNew()"><i class="fas fa-plus"></i> New list</button></div>`}
                </div>`}`;
    };
    const nlpFilter = (f) => { _nlp.filter = f; _renderIndex(); };

    // ── New list ─────────────────────────────────────────────────────────────
    const _loadLines = async () => {
        if (_nlp.lines) return _nlp.lines;
        const sb = _sb();
        const r = await sb.from('invite_lines').select('key,label,subcategories').eq('active', true).order('sort');
        _nlp.lines = r.data || [];
        return _nlp.lines;
    };
    const _loadProducts = async () => {
        if (_nlp.products) return _nlp.products;
        try {
            const r = await _sb().from('products').select('id,name,subcategory').eq('is_active', true).order('name');
            _nlp.products = r.data || [];
        } catch (_) { _nlp.products = []; }
        return _nlp.products;
    };
    const nlpNew = async () => {
        let lines = [];
        try { lines = await _loadLines(); } catch (e) { UI.toast.error('Could not load product lines: ' + _err(e)); return; }
        await _loadProducts();
        const opt = (k, l, sel) => `<option value="${esc(k)}"${sel ? ' selected' : ''}>${esc(l)}</option>`;
        const html = `
            <div class="nlp-form">
                <label class="nlp-lbl">What is it for?</label>
                <div class="nlp-purposes" id="nlp-f-purpose">
                    ${NLP_PURPOSES.map(([k, l], i) => `<label class="nlp-radio"><input type="radio" name="nlp-purpose" value="${k}"${i === 0 ? ' checked' : ''} onchange="app.nlpFormSync()"> ${esc(l)}</label>`).join('')}
                    <label class="nlp-radio"><input type="radio" name="nlp-purpose" value="event" onchange="app.nlpFormSync()"> Invite to an event</label>
                </div>
                <div id="nlp-f-event" class="inv-sub" hidden>Event invitations are made on the event itself (✨ Who to invite). <a href="javascript:void(0)" onclick="app.nlpEvents()">Pick an event →</a></div>
                <div id="nlp-f-main">
                    <div class="nlp-grid">
                        <div><label class="nlp-lbl" for="nlp-f-line">Product line</label>
                            <select class="form-control" id="nlp-f-line" onchange="app.nlpFormSync()">${lines.map((l, i) => opt(l.key, l.label, i === 0)).join('')}</select></div>
                        <div><label class="nlp-lbl" for="nlp-f-who">Who to include</label>
                            <select class="form-control" id="nlp-f-who" onchange="app.nlpFormSync()">${NLP_WHO.map(([k, l], i) => opt(k, l, i === 0)).join('')}</select></div>
                        <div><label class="nlp-lbl" for="nlp-f-goal">Goal</label>
                            <select class="form-control" id="nlp-f-goal" onchange="this.dataset.touched='1';app.nlpFormSync()"></select></div>
                        <div><label class="nlp-lbl" for="nlp-f-focus">Focus product (optional)</label>
                            <select class="form-control" id="nlp-f-focus" onchange="app.nlpFormSync()"></select></div>
                        <div><label class="nlp-lbl" for="nlp-f-qty" id="nlp-f-qty-l">How many people?</label>
                            <input type="number" class="form-control" id="nlp-f-qty" min="1" max="200" value="20" oninput="this.dataset.touched='1'"></div>
                        <div><label class="nlp-lbl" for="nlp-f-date">Target date</label>
                            <input type="date" class="form-control" id="nlp-f-date"></div>
                        <div><label class="nlp-lbl" for="nlp-f-name">List name (optional)</label>
                            <input type="text" class="form-control" id="nlp-f-name" maxlength="120" placeholder="e.g. Power Ring Nov promo"></div>
                        <div><label class="nlp-lbl" for="nlp-f-offer">Offer (optional)</label>
                            <input type="text" class="form-control" id="nlp-f-offer" maxlength="120" placeholder="e.g. 2nd ring RM1,000 off"></div>
                    </div>
                    <div class="nlp-grid" id="nlp-f-window" hidden>
                        <div><label class="nlp-lbl" for="nlp-f-from">Bought from (optional)</label>
                            <input type="date" class="form-control" id="nlp-f-from" onchange="app.nlpFormSync()"></div>
                        <div><label class="nlp-lbl" for="nlp-f-to">Bought to</label>
                            <input type="date" class="form-control" id="nlp-f-to" onchange="app.nlpFormSync()"></div>
                    </div>
                    ${_nlp.canTeam ? `
                    <label class="nlp-lbl">Whose people?</label>
                    <div class="nlp-purposes">
                        <label class="nlp-radio"><input type="radio" name="nlp-scope" value="mine" checked onchange="app.nlpFormSync()"> My own</label>
                        <label class="nlp-radio"><input type="radio" name="nlp-scope" value="team" onchange="app.nlpFormSync()"> My team (split per agent)</label>
                    </div>` : ''}
                    <label class="nlp-lbl" for="nlp-f-remarks">Remarks (optional)</label>
                    <textarea class="form-control" id="nlp-f-remarks" rows="2" maxlength="500"></textarea>
                    <div class="nlp-match" id="nlp-f-match" aria-live="polite"></div>
                    <div class="inv-sub" id="nlp-f-note"></div>
                </div>
            </div>`;
        UI.showModal('New name list', html, [
            { label: 'Cancel', action: 'UI.hideModal()' },
            { label: 'Find the people', type: 'primary', action: '(async () => { await app.nlpCreate(); })()' },
        ]);
        nlpFormSync();
    };
    const _radio = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value || '';
    const nlpFormSync = () => {
        const purpose = _radio('nlp-purpose') || 'promote';
        const isEvent = purpose === 'event';
        const ev = document.getElementById('nlp-f-event'); if (ev) ev.hidden = !isEvent;
        const main = document.getElementById('nlp-f-main'); if (main) main.hidden = isEvent;
        if (isEvent) return;
        const goalSel = document.getElementById('nlp-f-goal');
        if (goalSel) {
            const keep = goalSel.dataset.purpose === purpose ? goalSel.value : null;
            const goals = NLP_PURPOSE_GOALS[purpose] || NLP_PURPOSE_GOALS.other;
            goalSel.innerHTML = goals.map(g => `<option value="${g}"${(keep ? keep === g : g === goals[0]) ? ' selected' : ''}>${esc(NLP_GOALS[g])}</option>`).join('');
            goalSel.dataset.purpose = purpose;
        }
        // "Follow up customers" starts on the General line (whole relationship).
        const lineSel = document.getElementById('nlp-f-line');
        if (lineSel && purpose === 'follow_up' && !lineSel.dataset.touched && [...lineSel.options].some(o => o.value === 'general')) {
            lineSel.value = 'general';
        }
        if (lineSel && document.activeElement === lineSel) lineSel.dataset.touched = '1';
        const line = (_nlp.lines || []).find(l => l.key === lineSel?.value);
        const subs = new Set((line && line.subcategories) || []);
        const focus = document.getElementById('nlp-f-focus');
        if (focus) {
            const prods = (_nlp.products || []).filter(p => subs.has(p.subcategory));
            const cur = focus.value;
            focus.innerHTML = `<option value="">— any in this line —</option>` + prods.map(p => `<option value="${Number(p.id)}"${String(p.id) === cur ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
            focus.disabled = !prods.length;
        }
        const team = _radio('nlp-scope') === 'team';
        const ql = document.getElementById('nlp-f-qty-l'); if (ql) ql.textContent = team ? 'How many per agent?' : 'How many people?';
        const q = document.getElementById('nlp-f-qty');
        if (q) { q.max = team ? 50 : 200; if (team && Number(q.value) > 50) q.value = 9; }
        // Who to include: counting purchases needs a product line; owners → Upgrade, never bought → Decide.
        const whoSel = document.getElementById('nlp-f-who');
        if (whoSel) {
            const general = lineSel?.value === 'general';
            [...whoSel.options].forEach(o => { o.disabled = general && o.value !== 'best'; });
            if (general) whoSel.value = 'best';
            const who = whoSel.value;
            const owns = who === 'owns_1' || who === 'owns_any';
            const win = document.getElementById('nlp-f-window'); if (win) win.hidden = !owns;
            if (goalSel && whoSel.dataset.prev !== who && !goalSel.dataset.touched) {
                const want = owns ? 'upgrade' : who === 'owns_none' ? 'decide' : null;
                if (want && [...goalSel.options].some(o => o.value === want)) goalSel.value = want;
            }
            whoSel.dataset.prev = who;
            const note = document.getElementById('nlp-f-note');
            if (note) note.textContent = who === 'best'
                ? 'The CRM shows about 2.5× as many names as you ask for and ticks the best ones. People who asked not to be contacted are never listed.'
                : 'Everyone who matches is listed, best first. Counted per item: “A + B” in one sale counts 2; cancelled or refunded sales don’t count. People who asked not to be contacted are never listed.';
        }
        _previewSoon();
    };
    const _formPayload = () => {
        const v = (id) => (document.getElementById(id)?.value || '').trim();
        const focus = v('nlp-f-focus');
        const who = v('nlp-f-who') || 'best';
        const owns = who === 'owns_1' || who === 'owns_any';
        return {
            purpose: _radio('nlp-purpose') || 'promote', line: v('nlp-f-line'), goal: v('nlp-f-goal'),
            focus: focus ? [Number(focus)] : [], scope: _radio('nlp-scope') || 'mine', who,
            bought_from: owns ? v('nlp-f-from') || null : null, bought_to: owns ? v('nlp-f-to') || null : null,
        };
    };
    // "N people match" under the form — the same pool the list is made from.
    const _previewSoon = () => {
        const box = document.getElementById('nlp-f-match');
        if (!box) return;
        clearTimeout(_nlp.prevTimer);
        if (_radio('nlp-purpose') === 'event') { box.innerHTML = ''; return; }
        box.innerHTML = '<span class="inv-when">Counting…</span>';
        _nlp.prevTimer = setTimeout(_preview, 500);
    };
    const _preview = async () => {
        const p = _formPayload();
        const seq = (_nlp.prevSeq = (_nlp.prevSeq || 0) + 1);
        let r;
        try { r = await _rpc('name_list_preview', { p }); } catch (e) { r = { err: _err(e) }; }
        const box = document.getElementById('nlp-f-match');
        if (!box || seq !== _nlp.prevSeq) return;
        if (r.err) { box.innerHTML = `<span class="inv-when">${esc(r.err)}</span>`; return; }
        const team = p.scope === 'team', n = Number(r.match) || 0, a = Number(r.agents) || 0, h = Number(r.held) || 0;
        box.innerHTML = `<b>${n}</b> ${n === 1 ? 'person matches' : 'people match'}${team ? ` · ${a} agent${a === 1 ? '' : 's'}` : ''}${h ? ` <span class="inv-when">· ${h} held back</span>` : ''}`;
        const q = document.getElementById('nlp-f-qty');
        if (q && !q.dataset.touched && (p.who === 'owns_1' || p.who === 'owns_any') && n > 0) {
            q.value = Math.min(team ? Number(r.per_agent_max) || 1 : n, team ? 50 : 200);
        }
    };
    const nlpCreate = async () => {
        if (_radio('nlp-purpose') === 'event') { nlpEvents(); return; }
        const v = (id) => (document.getElementById(id)?.value || '').trim();
        const p = {
            ..._formPayload(), target_qty: Number(v('nlp-f-qty')), target_date: v('nlp-f-date') || null,
            name: v('nlp-f-name') || null, remarks: v('nlp-f-remarks') || null, offer: v('nlp-f-offer') || null,
        };
        if (!p.target_qty || p.target_qty < 1) { UI.toast.error('How many people?'); return; }
        try {
            const r = await _rpc('name_list_create', { p });
            UI.hideModal();
            UI.toast.success('List ready — check the names, then press Start list');
            _nlp.index = null;
            await nlpOpen(r.id);
        } catch (e) { UI.toast.error(_err(e)); }
    };

    // Upcoming event sessions → the event's own ✨ Who to invite.
    const nlpEvents = async () => {
        UI.showModal('Invite to an event', _spin('Finding upcoming events…'), [{ label: 'Close', action: 'UI.hideModal()' }]);
        try {
            const today = new Date(); const to = new Date(Date.now() + 60 * 864e5);
            const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const r = await _sb().from('activities').select('id,activity_title,activity_date,start_time,event_id')
                .eq('activity_type', 'EVENT').gte('activity_date', iso(today)).lte('activity_date', iso(to))
                .order('activity_date').limit(40);
            const rows = (r.data || []).filter(a => !/代理会议/.test(a.activity_title || ''));
            const box = document.querySelector('#global-modal-overlay .modal-content');
            if (!box) return;
            box.innerHTML = rows.length ? `
                <div class="inv-sub">Open an event to see ✨ Who to invite — the names, why each one fits, and the invite + reply buttons.</div>
                <div class="inv-add-res">${rows.map(a => `
                    <button type="button" class="inv-add-row" onclick="app.nlpOpenEvent(${Number(a.id)})">
                        <span>${esc(a.activity_title || 'Event')}</span><span class="inv-chip">${esc(_d(a.activity_date))}${a.start_time ? ' ' + esc(String(a.start_time).slice(0, 5)) : ''}</span><span class="inv-add-plus">Open →</span>
                    </button>`).join('')}</div>` : '<div class="nlp-empty">No events in the next 60 days.</div>';
        } catch (e) {
            const box = document.querySelector('#global-modal-overlay .modal-content');
            if (box) box.innerHTML = `<div class="inv-warn">Could not load events — ${esc(_err(e))}</div>`;
        }
    };
    const nlpOpenEvent = async (id) => {
        UI.hideModal();
        try { await window._loadChunk('chunks/script-calendar.min.js'); } catch (_) { /* fall through */ }
        if (typeof app.viewActivityDetails === 'function') app.viewActivityDetails(Number(id));
    };

    // ── One list ─────────────────────────────────────────────────────────────
    const nlpOpen = async (id, version = null) => {
        _nlp.listId = Number(id);
        _nlp.version = version;
        _nlp.detail = null;
        if (_nlp.tab !== 'lists') {
            _nlp.tab = 'lists';
            const t = document.getElementById('nlp-tabs'); if (t) t.innerHTML = _tabsHtml();
        }
        await _renderDetail();
        try { document.getElementById('nlp-body')?.scrollIntoView({ block: 'start' }); } catch (_) { /* old browsers */ }
    };
    const nlpBack = () => { _nlp.listId = null; _nlp.detail = null; _renderIndex(); };
    const nlpVersion = (no) => nlpOpen(_nlp.listId, Number(no) || null);

    const _loadDetail = async () => {
        _nlp.detail = await _rpc('name_list_get', { p_list: _nlp.listId, p_version: _nlp.version });
        return _nlp.detail;
    };
    const _renderDetail = async () => {
        const body = _body();
        if (!body) return;
        if (!_nlp.detail) body.innerHTML = _spin('Opening the list…');
        try { await _loadDetail(); } catch (e) {
            body.innerHTML = `<button type="button" class="btn secondary nlp-back" onclick="app.nlpBack()">← All lists</button>
                <div class="inv-warn">Could not open this list — ${esc(_err(e))}</div>`;
            return;
        }
        if (_nlp.tab !== 'lists' || !_nlp.listId) return;
        body.innerHTML = _detailHtml(_nlp.detail);
    };
    const _canWork = (d) => d.version.latest && d.list.status !== 'archived';

    const _detailHtml = (d) => {
        const l = d.list; const v = d.version; const rows = d.rows || [];
        const work = _canWork(d);
        const sel = rows.filter(r => r.decision === 'selected');
        const pend = rows.filter(r => r.decision === 'pending');
        const rem = rows.filter(r => r.decision === 'removed');
        const meId = Number(_state.cu?.id);
        const actions = [];
        if (l.can_manage && v.latest) {
            if (l.status === 'draft') actions.push(`<button type="button" class="btn primary" onclick="app.nlpSet('active')">▶ Start list</button>`);
            if (l.status === 'active') actions.push(`<button type="button" class="btn secondary" onclick="app.nlpSet('completed')">✓ Mark done</button>`);
            if (l.status === 'completed') actions.push(`<button type="button" class="btn secondary" onclick="app.nlpSet('active')">Reopen</button>`);
            if (l.status !== 'archived') actions.push(`<button type="button" class="btn secondary" onclick="app.nlpRegenerate()">↻ New version</button>`);
            if (l.status !== 'archived') actions.push(`<button type="button" class="btn secondary" onclick="app.nlpEdit()">Edit</button>`);
            if (l.status === 'completed') actions.push(`<button type="button" class="btn secondary" onclick="app.nlpSet('archived')">Archive</button>`);
        }
        actions.push(`<button type="button" class="btn secondary" onclick="app.nlpCsv()"><i class="fas fa-file-csv"></i> CSV</button>`);
        const held = Object.entries(v.held || {}).filter(([, n]) => n > 0)
            .map(([k, n]) => `${n} ${esc(NLP_HELD[k] || k.replace(/_/g, ' '))}`).join(' · ');
        const versionSel = (d.versions || []).length > 1 ? `
            <select class="form-control nlp-vsel" aria-label="Version" onchange="app.nlpVersion(this.value)">
                ${(d.versions || []).map((x, i) => `<option value="${i === 0 ? '' : Number(x.no)}"${Number(x.no) === Number(v.no) ? ' selected' : ''}>V${Number(x.no)} · ${esc(_d(x.generated_at))}${x.by ? ' · ' + esc(x.by) : ''}${i === 0 ? ' (latest)' : ''}</option>`).join('')}
            </select>` : `<span class="inv-chip">V${Number(v.no)}</span>`;
        // team lists: one group per agent (mine first); own lists: one group
        const groupRows = (list) => {
            if (l.scope !== 'team') return list.map(r => _rowHtml(r, d, work)).join('');
            const by = new Map();
            list.forEach(r => { const k = r.agent_id || 0; if (!by.has(k)) by.set(k, []); by.get(k).push(r); });
            const keys = [...by.keys()].sort((a, b) => (b === meId) - (a === meId) || String(by.get(a)[0].agent_name || '').localeCompare(String(by.get(b)[0].agent_name || '')));
            return keys.map(k => {
                const rs = by.get(k);
                const cont = rs.filter(r => r.contact_at).length;
                return `<details class="inv-agent"${keys.length === 1 || k === meId ? ' open' : ''}>
                    <summary><span class="inv-agent-n">${esc(rs[0].agent_name || 'No agent')}</span><span class="inv-agent-s">${rs.length} · ${cont} contacted</span></summary>
                    ${rs.map(r => _rowHtml(r, d, work)).join('')}
                </details>`;
            }).join('');
        };
        return `
            <button type="button" class="btn secondary nlp-back" onclick="app.nlpBack()">← All lists</button>
            <div class="inv-sec nlp-detail">
                <div class="nlp-d-head">
                    <div class="nlp-d-title">
                        <span class="nlp-st nlp-st-${esc(l.status)}">${esc(NLP_STATUS[l.status] || l.status)}</span>
                        <h3>${esc(l.name)}</h3>
                    </div>
                    <div class="nlp-d-acts">${actions.join('')}</div>
                </div>
                <div class="inv-objs">
                    <span class="inv-obj">${esc(l.line_label || l.line)} · ${esc(NLP_GOALS[l.goal] || l.goal)}</span>
                    ${_whoText(l) ? `<span class="inv-obj">${esc(_whoText(l))}</span>` : ''}
                    ${(l.focus_names || []).map(n => `<span class="inv-obj">Focus: ${esc(n)}</span>`).join('')}
                    ${l.offer ? `<span class="inv-obj nlp-offer">🏷 ${esc(l.offer)}</span>` : ''}
                    <span class="inv-obj">${l.scope === 'team' ? `Team · ${l.target_qty} per agent` : `Target ${l.target_qty}`}</span>
                    ${l.target_date ? `<span class="inv-obj">By ${esc(_d(l.target_date))}</span>` : ''}
                    <span class="inv-obj">${l.mine ? 'Your list' : 'By ' + esc(l.owner_name || '')}</span>
                    ${versionSel}
                </div>
                ${l.remarks ? `<div class="inv-sub">${esc(l.remarks)}</div>` : ''}
                ${!v.latest ? `<div class="nlp-banner">You are looking at an older version (V${Number(v.no)}) — read-only. The latest version is the one being worked.</div>` : ''}
                ${l.status === 'draft' && v.latest ? `<div class="nlp-banner">Draft — check the names below (untick or add people), then press <b>Start list</b>.${l.scope === 'team' ? ' Each agent gets a phone notice when it starts.' : ''}</div>` : ''}
                ${_funnelHtml(d.counts, l.scope === 'team' ? null : l.target_qty)}
                ${held ? `<div class="inv-held">Not listed: ${held}</div>` : ''}
                ${work ? _addBoxHtml() : ''}
                <div class="inv-group-h">On the list (${sel.length})</div>
                ${sel.length ? groupRows(sel) : '<div class="inv-why-none">Nobody ticked yet.</div>'}
                ${pend.length ? `<details class="inv-agent nlp-more"${sel.length ? '' : ' open'}>
                    <summary><span class="inv-agent-n">More suggestions (${pend.length})</span><span class="inv-agent-s">tick to add</span></summary>
                    ${pend.map(r => _rowHtml(r, d, work)).join('')}</details>` : ''}
                ${rem.length ? `<details class="inv-agent nlp-more">
                    <summary><span class="inv-agent-n">Taken off (${rem.length})</span><span class="inv-agent-s">with the reason</span></summary>
                    ${rem.map(r => _rowHtml(r, d, work)).join('')}</details>` : ''}
                ${!rows.length ? `<div class="nlp-empty">Nobody matches this ${_whoText(l) ? 'rule' : 'line and goal'} yet${l.scope === 'team' ? ' in your team' : ''}. Try another ${_whoText(l) ? 'rule' : 'goal'}, or add people yourself.</div>` : ''}
            </div>`;
    };

    const _addBoxHtml = () => `
        <div class="inv-group-head nlp-addhead">
            <span class="inv-sub" style="margin:0;">Someone the list missed?</span>
            <button type="button" class="btn btn-sm secondary inv-add-btn" onclick="app.nlpToggleAdd()">+ Add a person</button>
        </div>
        <div class="inv-addbox" id="nlp-addbox" hidden>
            <input type="search" class="form-control" id="nlp-add-q" placeholder="Type a name to find the person" oninput="app.nlpAddSearch(this.value)">
            <input type="text" class="form-control" id="nlp-add-note" placeholder="Why this person? (optional)" maxlength="200">
            <div id="nlp-add-warn"></div>
            <div class="inv-add-res" id="nlp-add-res"></div>
        </div>`;

    const _reasonsHtml = (r) => (r.reasons || []).slice(0, 2).map(x => {
        const when = x.d ? ` <span class="inv-when">${esc(_d(x.d))}</span>` : '';
        const link = x.ref === 'act' && x.id ? ` class="inv-link" onclick="event.stopPropagation();app.nlpOpenActivity(${Number(x.id)})" role="button" tabindex="0" title="Open the record"` : '';
        return `<li${link}>${esc(x.t || '')}${when}</li>`;
    }).join('');
    const _progressHtml = (r) => {
        const bits = [];
        if (r.contact_at) bits.push(`${esc(NLP_STEP_LABEL[r.contact_via] || r.contact_via || 'Contacted')} ${esc(_d(r.contact_at))}`);
        if (r.reply) bits.push(`<span class="${r.reply === 'interested' ? 'inv-st-ok' : (r.reply === 'not_interested' || r.reply === 'stop') ? 'inv-st-no' : ''}">${esc(NLP_STEP_LABEL[r.reply] || r.reply)}</span>${r.reply_note ? ` <span class="inv-when">“${esc(r.reply_note)}”</span>` : ''}`);
        if (r.met_at && (r.met_via !== r.contact_via || r.met_at !== _ymd(r.contact_at))) bits.push(`${esc(NLP_STEP_LABEL[r.met_via] || '🤝 Met')} ${esc(_d(r.met_at))}`);
        if (r.sale_amount != null) bits.push(`<span class="inv-st-ok">💰 Closed ${_rm(r.sale_amount)}</span>${r.sale_item ? ` <span class="inv-when">${esc(String(r.sale_item).slice(0, 40))}</span>` : ''}`);
        return bits.length ? `<div class="nlp-prog">${bits.join(' · ')}</div>` : '';
    };
    // The engine's next step is a snapshot from when the list was made; once the
    // agent has done something the row moves on from it (null = nothing to do).
    const _nextStep = (r, d) => {
        if (r.decision === 'removed' || r.sale_amount != null || r.dni || r.reply === 'stop') return null;
        const l = (d && d.list) || {};
        const topic = (l.focus_names || []).length === 1 ? l.focus_names[0] : (l.line_label || l.line || '');
        const about = topic ? ` about ${topic}` : '';
        if (r.reply === 'not_interested') return { step: 'Leave it for now', why: 'Said not interested' };
        if (r.reply === 'not_now') return { step: 'Try again later', why: `Said not now${r.reply_at ? ' on ' + _d(r.reply_at) : ''}` };
        if (r.met_at) return { step: `Follow up to close${about}`, why: `Met ${_d(r.met_at)}` };
        if (r.reply === 'interested') return { step: `Book a meeting${about}`, why: 'Said interested' };
        if (r.reply === 'no_reply') return { step: 'Try once more — a call this time', why: 'No reply yet' };
        if (r.contact_at) return { step: 'Get their answer', why: 'then press Reply…' };
        if (l.offer && (!r.next_step_rule || r.next_step_rule === 'default')) return { step: `Offer: ${l.offer}`, why: r.next_step_why || '' };
        return r.next_step ? { step: r.next_step, why: r.next_step_why || '' } : null;
    };
    const _rowHtml = (r, d, work) => {
        const id = Number(r.id);
        const next = _nextStep(r, d);
        const profile = r.customer_id ? `app.showCustomerDetail(${Number(r.customer_id)})` : `app.showProspectDetail(${Number(r.prospect_id)})`;
        const warns = (r.warnings || []).map(w => NLP_WARN[w] || String(w).replace(/[_:]/g, ' '));
        if (Number(r.freq) >= Number(d.freq_limit || 2)) warns.unshift(`contacted ${Number(r.freq)}× in ${Number(d.freq_days || 30)} days — give them space`);
        const chips = [
            `<span class="inv-chip">${r.customer_id ? 'Customer' : 'Prospect'}</span>`,
            r.grp === 'strong' ? '<span class="inv-chip inv-chip-strong">Strong</span>' : '',
            r.source === 'manual' ? `<span class="inv-chip inv-chip-added">Added${r.added_by_name ? ' by ' + esc(r.added_by_name) : ''}</span>` : '',
            r.dni ? '<span class="inv-chip inv-chip-warn">🚫 Do not contact</span>' : '',
            r.prefers_call && !r.dni ? '<span class="inv-chip">Prefers a call</span>' : '',
        ].join('');
        let acts = '';
        if (work) {
            if (r.decision === 'selected') {
                const contact = r.dni ? '' : (r.prefers_call || !r.phone
                    ? `<button type="button" class="btn btn-sm secondary" onclick="event.stopPropagation();app.nlpStep(${id}, 'called')">📞 Called</button>`
                    : `<button type="button" class="btn btn-sm secondary" onclick="event.stopPropagation();app.nlpWhatsApp(${id})">💬 WhatsApp</button>
                       <button type="button" class="btn btn-sm secondary" onclick="event.stopPropagation();app.nlpStep(${id}, 'called')">📞 Called</button>`);
                acts = `${contact}
                    <button type="button" class="btn btn-sm secondary" onclick="event.stopPropagation();app.nlpForm(${id}, 'reply')">Reply…</button>
                    <button type="button" class="btn btn-sm secondary" aria-label="More" onclick="event.stopPropagation();app.nlpForm(${id}, 'more')">⋯</button>`;
            } else if (r.decision === 'pending') {
                acts = r.dni ? '' : `<button type="button" class="btn btn-sm primary" onclick="event.stopPropagation();app.nlpDecide(${id}, 'selected')">+ Tick</button>`;
            } else {
                acts = r.dni ? '' : `<button type="button" class="btn btn-sm secondary" onclick="event.stopPropagation();app.nlpDecide(${id}, 'selected')">Put back</button>`;
            }
        }
        const removed = r.decision === 'removed'
            ? `<div class="inv-warn">Taken off: ${esc((NLP_REMOVE.find(x => x[0] === r.decision_reason) || [null, r.decision_reason || ''])[1])}${r.decision_note ? ' — ' + esc(r.decision_note) : ''}${r.decided_by_name ? ` <span class="inv-when">${esc(r.decided_by_name)}</span>` : ''}</div>` : '';
        return `
            <div class="inv-row nl-row${r.decision === 'removed' ? ' is-closed' : ''}" id="nl-row-${id}">
                <div class="inv-main">
                    <div class="inv-name"><a href="javascript:void(0)" onclick="event.stopPropagation();${profile}">${esc(r.name || '—')}</a>${chips}</div>
                    ${r.add_note ? `<ul class="inv-why"><li class="inv-note">“${esc(r.add_note)}”</li></ul>` : ''}
                    ${(r.reasons || []).length ? `<ul class="inv-why">${_reasonsHtml(r)}</ul>` : (r.source === 'manual' ? '' : '<div class="inv-why-none">No reason recorded</div>')}
                    ${next ? `<div class="nlp-next">➜ <b>${esc(next.step)}</b>${next.why ? ` <span class="inv-when">${esc(next.why)}</span>` : ''}</div>` : ''}
                    ${warns.length ? `<div class="inv-warn">⚠ ${esc(warns.join(' · '))}</div>` : ''}
                    ${removed}
                    ${_progressHtml(r)}
                    ${r.fit != null ? `<span class="inv-score">Fit ${Number(r.fit)} · Engaged ${Number(r.engagement || 0)} · Ready ${Number(r.readiness || 0)}${r.last_touch ? ` · last met ${esc(_d(r.last_touch))}` : ''}</span>` : ''}
                </div>
                <div class="inv-acts">${acts}</div>
                <div class="inv-form" id="nl-form-${id}"></div>
            </div>`;
    };

    const _row = (id) => (_nlp.detail?.rows || []).find(r => Number(r.id) === Number(id));
    const _refresh = async () => {
        const y = window.scrollY;
        await _renderDetail();
        try { window.scrollTo(0, y); } catch (_) { /* jsdom */ }
    };

    // Inline forms under a row: reply, more (met / take off / clear), remove.
    const nlpForm = (id, kind) => {
        const box = document.getElementById(`nl-form-${Number(id)}`);
        if (!box) return;
        if (box.dataset.kind === kind && box.innerHTML) { box.innerHTML = ''; box.dataset.kind = ''; return; }
        box.dataset.kind = kind;
        const n = Number(id);
        if (kind === 'reply') {
            box.innerHTML = `<div class="inv-form-in">
                <div class="inv-sub">What did they say?</div>
                <input type="text" class="form-control" id="nl-note-${n}" placeholder="Note (optional)" maxlength="200">
                <div class="inv-form-btns">
                    ${NLP_REPLY.map(([k, l]) => `<button type="button" class="btn btn-sm ${k === 'interested' ? 'primary' : 'secondary'}" onclick="event.stopPropagation();app.nlpStep(${n}, '${k}', true)">${esc(l)}</button>`).join('')}
                    <button type="button" class="btn btn-sm secondary" onclick="event.stopPropagation();app.nlpStop(${n})">🚫 Asked us to stop</button>
                </div></div>`;
        } else if (kind === 'more') {
            const r = _row(id) || {};
            box.innerHTML = `<div class="inv-form-in"><div class="inv-form-btns">
                ${r.dni ? '' : `<button type="button" class="btn btn-sm secondary" onclick="event.stopPropagation();app.nlpStep(${n}, 'met')">🤝 Met in person</button>`}
                <button type="button" class="btn btn-sm secondary" onclick="event.stopPropagation();app.nlpForm(${n}, 'remove')">Take off the list</button>
                ${r.contact_at && !r.contact_auto ? `<button type="button" class="btn btn-sm secondary" onclick="event.stopPropagation();app.nlpStep(${n}, 'clear_contact')">Undo contact</button>` : ''}
                ${r.reply ? `<button type="button" class="btn btn-sm secondary" onclick="event.stopPropagation();app.nlpStep(${n}, 'clear_reply')">Undo reply</button>` : ''}
            </div></div>`;
        } else if (kind === 'remove') {
            box.innerHTML = `<div class="inv-form-in">
                <label class="inv-sub" for="nl-r-${n}">Why take this person off? (needed)</label>
                <select class="form-control" id="nl-r-${n}">
                    <option value="">— pick a reason —</option>
                    ${NLP_REMOVE.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}
                </select>
                <input type="text" class="form-control" id="nl-rn-${n}" placeholder="Note" maxlength="200">
                <div class="inv-form-btns">
                    <button type="button" class="btn btn-sm primary" onclick="event.stopPropagation();app.nlpRemove(${n})">Take off</button>
                    <button type="button" class="btn btn-sm secondary" onclick="event.stopPropagation();app.nlpForm(${n}, 'remove')">Cancel</button>
                </div></div>`;
        }
    };
    const nlpDecide = async (id, decision, reason = null, note = null) => {
        try {
            await _rpc('name_list_decide', { p_row: Number(id), p_decision: decision, p_reason: reason, p_note: note });
            UI.toast.success(decision === 'selected' ? 'On the list' : decision === 'removed' ? 'Taken off the list' : 'Saved');
            await _refresh();
        } catch (e) { UI.toast.error(_err(e)); }
    };
    const nlpRemove = (id) => {
        const reason = document.getElementById(`nl-r-${Number(id)}`)?.value || '';
        const note = (document.getElementById(`nl-rn-${Number(id)}`)?.value || '').trim();
        if (!reason) { UI.toast.error('Pick why this person comes off the list'); return; }
        if (reason === 'other' && !note) { UI.toast.error('Write a short reason'); return; }
        return nlpDecide(id, 'removed', reason, note || null);
    };
    const nlpStep = async (id, step, withNote = false) => {
        const note = withNote ? (document.getElementById(`nl-note-${Number(id)}`)?.value || '').trim() : '';
        try {
            await _rpc('name_list_step', { p_row: Number(id), p_step: step, p_note: note || null });
            UI.toast.success(NLP_STEP_LABEL[step] ? `${NLP_STEP_LABEL[step]} — saved` : 'Saved');
            await _refresh();
        } catch (e) { UI.toast.error(_err(e)); }
    };
    const nlpStop = async (id) => {
        if (!confirm('They asked not to be contacted again?\n\nThis turns on "Do not contact" for this person — they will not be put on any list or event invite again (it can be switched off on their profile).')) return;
        await nlpStep(id, 'stop', true);
    };
    // Opens WhatsApp with a short greeting; the agent writes the rest and taps Sent ✓.
    const nlpWhatsApp = (id) => {
        const r = _row(id);
        if (!r) return;
        const phone = _waPhone(r.phone);
        if (!phone) { UI.toast.error('No phone number on file'); return; }
        const me = _state.cu?.full_name || '';
        const offer = String(_nlp.detail?.list?.offer || '').trim();
        const msg = `Hi ${String(r.name || '').trim()}，我是${me} 😊${offer ? '\n' + offer : ''}`;
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
        const box = document.getElementById(`nl-form-${Number(id)}`);
        if (box) {
            box.dataset.kind = 'sent';
            box.innerHTML = `<div class="inv-form-in"><div class="inv-sub">Sent it in WhatsApp?</div><div class="inv-form-btns">
                <button type="button" class="btn btn-sm primary" onclick="event.stopPropagation();app.nlpStep(${Number(id)}, 'whatsapp')">Sent ✓</button>
                <button type="button" class="btn btn-sm secondary" onclick="event.stopPropagation();app.nlpForm(${Number(id)}, 'sent')">Not yet</button></div></div>`;
        }
    };
    const nlpOpenActivity = async (id) => {
        try { await window._loadChunk('chunks/script-calendar.min.js'); } catch (_) { /* fall through */ }
        if (typeof app.viewActivityDetails === 'function') app.viewActivityDetails(Number(id));
    };

    // Add a person (search → name_list_add; warning → Add anyway).
    const nlpToggleAdd = () => {
        const box = document.getElementById('nlp-addbox');
        if (!box) return;
        box.hidden = !box.hidden;
        if (!box.hidden) document.getElementById('nlp-add-q')?.focus();
    };
    const nlpAddSearch = (q) => {
        clearTimeout(_nlp.addTimer);
        const res = document.getElementById('nlp-add-res');
        if (!res) return;
        const term = String(q || '').trim();
        if (term.length < 2) { res.innerHTML = ''; return; }
        _nlp.addTimer = setTimeout(async () => {
            try {
                const [ps, cs] = await Promise.all([
                    AppDataStore.searchProspects(term, { limit: 6 }).catch(() => []),
                    AppDataStore.searchCustomers ? AppDataStore.searchCustomers(term, { limit: 6 }).catch(() => []) : [],
                ]);
                const rows = [
                    ...(cs || []).slice(0, 6).map(c => ({ kind: 'customer', id: c.id, name: c.full_name })),
                    ...(ps || []).filter(p => p.status !== 'converted').slice(0, 6).map(p => ({ kind: 'prospect', id: p.id, name: p.full_name })),
                ];
                const box = document.getElementById('nlp-add-res');
                if (!box) return;
                box.innerHTML = rows.length ? rows.map(r => `
                    <button type="button" class="inv-add-row" onclick="event.stopPropagation();app.nlpAdd('${r.kind}', ${Number(r.id)}, false)">
                        <span>${esc(r.name || '—')}</span><span class="inv-chip">${r.kind === 'customer' ? 'Customer' : 'Prospect'}</span><span class="inv-add-plus">+ Add</span>
                    </button>`).join('') : '<div class="inv-sub">No one found</div>';
            } catch (e) { console.warn('[namelist] search failed:', e); }
        }, 300);
    };
    const nlpAdd = async (kind, id, force = false) => {
        const note = (document.getElementById('nlp-add-note')?.value || '').trim();
        const warnBox = document.getElementById('nlp-add-warn');
        try {
            const r = await _rpc('name_list_add', {
                p_list: _nlp.listId, p_prospect: kind === 'prospect' ? Number(id) : null, p_customer: kind === 'customer' ? Number(id) : null,
                p_note: note || null, p_force: !!force,
            });
            if (r && r.ok === false && r.warn) {
                if (warnBox) warnBox.innerHTML = `<div class="inv-add-warn">⚠ ${esc(r.warn)} — add anyway?
                    <div class="inv-form-btns"><button type="button" class="btn btn-sm primary" onclick="event.stopPropagation();app.nlpAdd('${kind}', ${Number(id)}, true)">Add anyway</button></div></div>`;
                return;
            }
            if (r && r.ok === false) { UI.toast.info(r.msg || 'Already on this list'); return; }
            UI.toast.success('Added to the list');
            await _refresh();
        } catch (e) { UI.toast.error(_err(e)); }
    };

    // List-level actions.
    const nlpSet = async (status) => {
        const d = _nlp.detail;
        if (!d) return;
        if (status === 'archived' && !confirm('Archive this list? It stays in Done, read-only.')) return;
        if (status === 'active' && d.list.status === 'draft' && d.list.scope === 'team'
            && !confirm('Start the list? Each agent gets a phone notice with their names.')) return;
        try {
            await _rpc('name_list_set', { p_list: _nlp.listId, p: { status } });
            UI.toast.success(status === 'active' ? (d.list.status === 'draft' ? 'List started' : 'List reopened') : status === 'completed' ? 'Marked done' : 'Archived');
            _nlp.index = null;
            await _refresh();
        } catch (e) { UI.toast.error(_err(e)); }
    };
    const nlpRegenerate = async () => {
        const d = _nlp.detail;
        if (!d) return;
        const next = Math.max(...(d.versions || []).map(x => Number(x.no) || 0), 0) + 1;
        if (!confirm(`Make version ${next} with today's data?\n\nPeople you ticked or took off keep that choice; new matches are added; version ${next - 1} stays as it was.`)) return;
        try {
            await _rpc('name_list_regenerate', { p_list: _nlp.listId });
            UI.toast.success(`Version ${next} ready`);
            _nlp.version = null;
            await _refresh();
        } catch (e) { UI.toast.error(_err(e)); }
    };
    const nlpEdit = () => {
        const l = _nlp.detail?.list;
        if (!l) return;
        UI.showModal('Edit list', `
            <div class="nlp-form">
                <label class="nlp-lbl" for="nlp-e-name">Name</label>
                <input type="text" class="form-control" id="nlp-e-name" maxlength="120" value="${esc(l.name)}">
                <div class="nlp-grid">
                    <div><label class="nlp-lbl" for="nlp-e-qty">${l.scope === 'team' ? 'How many per agent?' : 'How many people?'}</label>
                        <input type="number" class="form-control" id="nlp-e-qty" min="1" max="${l.scope === 'team' ? 50 : 200}" value="${Number(l.target_qty)}"></div>
                    <div><label class="nlp-lbl" for="nlp-e-date">Target date</label>
                        <input type="date" class="form-control" id="nlp-e-date" value="${esc(l.target_date || '')}"></div>
                </div>
                <label class="nlp-lbl" for="nlp-e-offer">Offer</label>
                <input type="text" class="form-control" id="nlp-e-offer" maxlength="120" value="${esc(l.offer || '')}" placeholder="e.g. 2nd ring RM1,000 off">
                <label class="nlp-lbl" for="nlp-e-remarks">Remarks</label>
                <textarea class="form-control" id="nlp-e-remarks" rows="2" maxlength="500">${esc(l.remarks || '')}</textarea>
                <div class="inv-sub">A new number applies the next time you make a new version.</div>
            </div>`, [
            { label: 'Cancel', action: 'UI.hideModal()' },
            { label: 'Save', type: 'primary', action: '(async () => { await app.nlpSaveEdit(); })()' },
        ]);
    };
    const nlpSaveEdit = async () => {
        const v = (id) => (document.getElementById(id)?.value || '').trim();
        try {
            await _rpc('name_list_set', { p_list: _nlp.listId, p: { name: v('nlp-e-name'), target_qty: Number(v('nlp-e-qty')), target_date: v('nlp-e-date'), remarks: v('nlp-e-remarks'), offer: v('nlp-e-offer') } });
            UI.hideModal();
            UI.toast.success('Saved');
            _nlp.index = null;
            await _refresh();
        } catch (e) { UI.toast.error(_err(e)); }
    };
    // CSV of the version on screen. No phone numbers, and people who asked not
    // to be contacted are left out (an export is a contact list).
    const nlpCsv = () => {
        const d = _nlp.detail;
        if (!d) return;
        const q = (s) => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
        const head = ['Name', 'Type', 'Agent', 'On the list', 'Fit', 'Engaged', 'Ready', 'Why', 'Next step', 'Contacted', 'Reply', 'Met', 'Closed RM'];
        const rows = (d.rows || []).filter(r => !r.dni).map(r => [
            r.name, r.customer_id ? 'Customer' : 'Prospect', r.agent_name || '',
            r.decision === 'selected' ? 'yes' : r.decision === 'removed' ? 'taken off' : 'suggested',
            r.fit ?? '', r.engagement ?? '', r.readiness ?? '',
            (r.reasons || []).map(x => x.t).join('; '), (_nextStep(r, d) || {}).step || '',
            r.contact_at ? `${NLP_STEP_LABEL[r.contact_via] || r.contact_via} ${_ymd(r.contact_at)}` : '',
            r.reply ? (NLP_STEP_LABEL[r.reply] || r.reply) : '', r.met_at || '', r.sale_amount ?? '',
        ]);
        const csv = '﻿' + [head, ...rows].map(x => x.map(q).join(',')).join('\r\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        a.download = `name-list-${String(d.list.name || 'list').replace(/[^\w一-龥-]+/g, '-').slice(0, 40)}-v${d.version.no}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
    };

    // ── 🎯 Who to Focus (reporting chunk renders it) ─────────────────────────
    const _renderFocus = async () => {
        const body = _body();
        if (!body) return;
        body.innerHTML = `<div id="nlp-focus">${_spin('Loading Who to Focus…')}</div>`;
        try {
            await window._loadChunk('chunks/script-reporting.min.js');
            const host = document.getElementById('nlp-focus');
            if (host && typeof app.renderNameListSection === 'function') await app.renderNameListSection(host, { embedded: true });
        } catch (e) {
            const host = document.getElementById('nlp-focus');
            if (host) host.innerHTML = `<div class="inv-warn">Could not load — ${esc(_err(e))}</div>`;
        }
    };

    // ── 📈 Results ───────────────────────────────────────────────────────────
    const _renderResults = async () => {
        const body = _body();
        if (!body) return;
        body.innerHTML = _spin('Counting results…');
        await _loadIndex();
        if (_nlp.tab !== 'results') return;
        const lists = (_nlp.index || []).filter(l => l.status !== 'draft');
        const pct = (a, b) => (b ? Math.round(100 * a / b) + '%' : '—');
        const rows = lists.map(l => {
            const c = l.counts || {};
            return `<tr onclick="app.nlpOpen(${Number(l.id)})" class="nlp-tr">
                <td><b>${esc(l.name)}</b><div class="inv-when" style="margin:0;">${esc(l.line_label || l.line)} · ${esc(NLP_GOALS[l.goal] || l.goal)} · ${esc(NLP_STATUS[l.status] || l.status)}</div></td>
                <td>${c.picked || 0}</td><td>${c.contacted || 0}</td><td>${c.replied || 0}</td><td>${c.interested || 0}</td>
                <td>${c.met || 0}</td><td>${c.closed || 0}${c.closed ? `<div class="inv-when" style="margin:0;">${c.closed_after_contact || 0} after contact</div>` : ''}</td>
                <td>${c.revenue ? _rm(c.revenue) : '—'}</td><td>${pct(c.contacted || 0, c.picked || 0)}</td><td>${pct(c.closed || 0, c.picked || 0)}</td>
            </tr>`;
        }).join('');
        body.innerHTML = `
            <div class="inv-sec">
                <h4>📋 Lists</h4>
                <div class="inv-sub">Contacted = a WhatsApp / call / meeting recorded on the list, or any call or meeting logged on that person since the list started. A sale counts for one list only — the one with the latest contact before the sale.</div>
                ${lists.length ? `<div class="nlp-table-wrap"><table class="nlp-table">
                    <thead><tr><th>List</th><th>Picked</th><th>Contacted</th><th>Replied</th><th>Interested</th><th>Met</th><th>Closed</th><th>Sales</th><th>Reach</th><th>Close</th></tr></thead>
                    <tbody>${rows}</tbody></table></div>` : '<div class="nlp-empty">No started lists yet.</div>'}
            </div>
            <div class="inv-sec" style="margin-top:14px;">
                <h4>🎯 Event invitations</h4>
                <div id="nlp-ev-results">${_spin('Loading…')}</div>
            </div>`;
        try {
            await window._loadChunk('chunks/script-reporting.min.js');
            const host = document.getElementById('nlp-ev-results');
            if (host && typeof app.nlRenderEventResults === 'function') await app.nlRenderEventResults(host);
        } catch (e) {
            const host = document.getElementById('nlp-ev-results');
            if (host) host.innerHTML = `<div class="inv-warn">Could not load — ${esc(_err(e))}</div>`;
        }
    };

    app.register('namelist', {
        showNameListView,
        nlpTab, nlpFilter, nlpNew, nlpFormSync, nlpCreate, nlpEvents, nlpOpenEvent,
        nlpOpen, nlpBack, nlpVersion, nlpForm, nlpDecide, nlpRemove, nlpStep, nlpStop, nlpWhatsApp, nlpOpenActivity,
        nlpToggleAdd, nlpAddSearch, nlpAdd, nlpSet, nlpRegenerate, nlpEdit, nlpSaveEdit, nlpCsv,
    });
    console.log('[chunk] script-namelist loaded');
})();
