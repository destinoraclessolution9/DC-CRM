/**
 * CRM Lazy Chunk: Org Chart Consultant
 * Covers: showOrgChartView, consultation management, member add/edit/bulk paste,
 *   org analysis, reporting. Super Admin / L1-2 only.
 * Extracted 2026-06-05 (~661 lines).
 */
(() => {
    const _state = window._appState;
    const _utils = window._crmUtils;
    const esc    = (...a) => _utils.escapeHtml(...a);
    const isSystemAdmin      = (u) => _utils.isSystemAdmin(u || _state.cu);
    const navigateTo         = (v) => window.app.navigateTo(v);
    let _currentUser = _state.cu;
    window._syncOrgUser = () => { _currentUser = _state.cu; };

    const ORG_TIERS = [
        { code: 't1_5',   min: 1,  max: 5,  price: 99 },
        { code: 't6_10',  min: 6,  max: 10, price: 399 },
        { code: 't11_15', min: 11, max: 15, price: 699 },
        { code: 't16_20', min: 16, max: 20, price: 999 },
        { code: 't21_25', min: 21, max: 25, price: 1499 },
        { code: 't26_30', min: 26, max: 30, price: 1999 },
        { code: 't31_35', min: 31, max: 35, price: 2499 },
        { code: 't36_40', min: 36, max: 40, price: 2999 },
        { code: 't41_45', min: 41, max: 45, price: 3499 },
        { code: 't46_50', min: 46, max: 50, price: 3999 },
    ];
    
    const _orgTierForSize = (size) => ORG_TIERS.find(t => size >= t.min && size <= t.max) || null;

    // React-island flag (default-on). Kill-switch → legacy: window.__REACT_ORG===false,
    // ?react=0, or localStorage crm_react_off='1'.
    const _reactOrgOn = () => {
        try {
            if (window.__REACT_ORG === false) return false;
            if (/[?&]react=0/.test(location.search)) return false;
            if (localStorage.getItem('crm_react_off') === '1') return false;
            return !!(window.CRMReact && typeof window.CRMReact.mountOrgChartView === 'function');
        } catch (_) { return false; }
    };
    
    // BaZi-secrecy sanitiser. Anything that touches report_html or DOM goes
    // through this. Codes are matched case-insensitively.
    const ORG_TERM_MAP = {
        'bazi':         'temperament pattern',
        '八字':         'temperament pattern',
        'life chart':   'role-fit profile',
        'life-chart':   'role-fit profile',
        'lifechart':    'role-fit profile',
        'day master':   'core trait',
        'daymaster':    'core trait',
        'feng shui':    'workplace harmony',
        'fengshui':     'workplace harmony',
        'bagua':        'eight-area framework',
        '八卦':         'eight-area framework',
    };
    
    const _orgSanitiseClientText = (raw) => {
        if (!raw) return '';
        let out = String(raw);
        for (const [bad, good] of Object.entries(ORG_TERM_MAP)) {
            const re = new RegExp(bad.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi');
            out = out.replace(re, good);
        }
        return out;
    };
    
    const ORG_ARCHETYPES = [
        { code: 'leader',     label: 'Strategic Leader',     hint: 'sets direction, takes accountability' },
        { code: 'operator',   label: 'Operational Driver',   hint: 'executes plans, hits targets' },
        { code: 'connector',  label: 'People Connector',     hint: 'builds bridges, mediates' },
        { code: 'analyst',    label: 'Analytical Thinker',   hint: 'pattern recognition, data-led' },
        { code: 'creator',    label: 'Creative Innovator',   hint: 'new ideas, breaks moulds' },
        { code: 'guardian',   label: 'Quality Guardian',     hint: 'standards, follow-through' },
        { code: 'catalyst',   label: 'Growth Catalyst',      hint: 'energises others, drives change' },
        { code: 'mentor',     label: 'Capability Builder',   hint: 'teaches, coaches, develops talent' },
    ];
    
    const _orgArchetypeLabel = (code) => {
        if (!code) return '';
        const a = ORG_ARCHETYPES.find(x => x.code === code);
        return a?.label || code;
    };
    
    // Lightweight DOB → archetype mapping. NOT a real BaZi engine — v1 demo
    // using day-of-year mod archetype count. Replace with the live
    // compute_life_chart_score once the engine is portable. Crucially: ZERO
    // internal terminology surfaces from this function.
    const _orgComputeArchetype = (member) => {
        const dob = member.dob;
        if (!dob) return { code: 'analyst', score: 60, note: 'incomplete data' };
        const d = new Date(dob);
        if (isNaN(d.getTime())) return { code: 'analyst', score: 60, note: 'unparseable date' };
        const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
        const idx = (dayOfYear + (member.name?.length || 0)) % ORG_ARCHETYPES.length;
        const score = 60 + ((dayOfYear * 7) % 41); // 60..100
        return { code: ORG_ARCHETYPES[idx].code, score, note: '' };
    };
    
    const _orgPairScore = (a, b) => {
        const ai = ORG_ARCHETYPES.findIndex(x => x.code === a.archetype_code);
        const bi = ORG_ARCHETYPES.findIndex(x => x.code === b.archetype_code);
        if (ai < 0 || bi < 0) return 60;
        const dist = Math.abs(ai - bi);
        if (dist === 0) return 55;   // same archetype → mild friction
        if (dist === 1) return 75;
        if (dist === 2) return 85;
        if (dist === 3) return 80;
        return 70;
    };
    
    // Local html-escape — avoids needing the IIFE-private escapeHtml.
    function _orgEscapeHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    
    // ---------------- LIST VIEW ----------------
    const showOrgChartView = async (viewport) => {
        viewport = viewport || document.getElementById('content-viewport');
        if (!viewport) return;
    
        let rows = [];
        try {
            const all = await AppDataStore.getAll('org_consultations');
            rows = (all || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        } catch (_) {
            rows = [];
        }

        if (_reactOrgOn()) {
            try {
                viewport.innerHTML = '<div id="orgchart-react-root"></div>';
                window.CRMReact.mountOrgChartView(document.getElementById('orgchart-react-root'), { rows });
                return;
            } catch (e) {
                console.warn('[orgchart] react mount failed:', e && e.message);
                viewport.innerHTML = '<div style="padding:48px 24px;text-align:center;color:#888;"><i class="fas fa-rotate-right" style="font-size:30px;opacity:.45;"></i><p style="margin:14px 0;">This section couldn\'t load. Please reload the page.</p><button class="btn primary" onclick="location.reload()">Reload</button></div>';
                return;
            }
        }

        viewport.innerHTML = '<div style="padding:48px 24px;text-align:center;color:#888;"><i class="fas fa-rotate-right" style="font-size:30px;opacity:.45;"></i><p style="margin:14px 0;">This section couldn\'t load. Please reload the page.</p><button class="btn primary" onclick="location.reload()">Reload</button></div>';
    };
    
    // ---------------- NEW CONSULTATION ----------------
    const openNewOrgConsultation = async () => {
        const tierRows = ORG_TIERS.map(t => `
            <tr><td style="padding:6px 10px;">${t.min}–${t.max} pax</td><td style="padding:6px 10px;text-align:right;">RM ${t.price.toLocaleString()}</td></tr>
        `).join('');
    
        UI.showModal('New Org Chart Consultation', `
            <div style="display:grid;grid-template-columns:1fr 220px;gap:20px;">
                <div>
                    <div class="form-group"><label>Client Company *</label>
                        <input type="text" id="org-new-company" class="form-control" placeholder="ABC Sdn Bhd"></div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                        <div class="form-group"><label>Contact Name</label><input type="text" id="org-new-contact" class="form-control"></div>
                        <div class="form-group"><label>Contact Phone</label><input type="text" id="org-new-phone" class="form-control"></div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                        <div class="form-group"><label>Contact Email</label><input type="email" id="org-new-email" class="form-control"></div>
                        <div class="form-group"><label>Industry</label><input type="text" id="org-new-industry" class="form-control" placeholder="e.g. F&amp;B, retail"></div>
                    </div>
                    <div class="form-group"><label>Team Size (pax) *</label>
                        <input type="number" id="org-new-size" class="form-control" min="1" max="50" value="5" oninput="app._orgUpdatePricePreview()"></div>
                    <div style="background:#f1f5f9;padding:14px;border-radius:6px;border-left:4px solid var(--primary);">
                        <div style="font-size:11px;color:var(--gray-600);text-transform:uppercase;letter-spacing:0.5px;">Auto-priced</div>
                        <div id="org-new-price-display" style="font-size:24px;font-weight:700;color:var(--primary);">RM 99</div>
                        <div id="org-new-tier-display" style="font-size:12px;color:var(--gray-600);">Tier: 1–5 pax</div>
                    </div>
                </div>
                <div>
                    <div style="font-size:11px;color:var(--gray-600);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Pricing Ladder</div>
                    <table style="width:100%;font-size:12px;border:1px solid var(--gray-200);border-radius:6px;background:#fff;">${tierRows}</table>
                </div>
            </div>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Create Consultation', type: 'primary', action: '(async () => { await app.saveNewOrgConsultation(); })()' }
        ]);
        setTimeout(() => window.app._orgUpdatePricePreview && window.app._orgUpdatePricePreview(), 50);
    };
    
    const _orgUpdatePricePreview = () => {
        const size = parseInt(document.getElementById('org-new-size')?.value, 10) || 0;
        const tier = _orgTierForSize(size);
        const priceEl = document.getElementById('org-new-price-display');
        const tierEl = document.getElementById('org-new-tier-display');
        if (!tier) {
            if (priceEl) priceEl.textContent = 'Out of range';
            if (tierEl) tierEl.textContent = 'Supported: 1–50 pax';
            return;
        }
        if (priceEl) priceEl.textContent = `RM ${tier.price.toLocaleString()}`;
        if (tierEl) tierEl.textContent = `Tier: ${tier.min}–${tier.max} pax`;
    };
    
    const saveNewOrgConsultation = async () => {
        const company = document.getElementById('org-new-company')?.value?.trim();
        const size = parseInt(document.getElementById('org-new-size')?.value, 10);
        if (!company) { UI.toast.error('Client company is required.'); return; }
        if (!size || size < 1 || size > 50) { UI.toast.error('Team size must be 1–50.'); return; }
        const tier = _orgTierForSize(size);
        if (!tier) { UI.toast.error('Team size out of supported range.'); return; }
    
        const user = await (typeof Auth !== 'undefined' && Auth.getCurrentUser ? Auth.getCurrentUser() : Promise.resolve(null)).catch(() => null);
    
        const payload = {
            client_company: company,
            client_contact_name:  document.getElementById('org-new-contact')?.value?.trim() || null,
            client_contact_phone: document.getElementById('org-new-phone')?.value?.trim() || null,
            client_contact_email: document.getElementById('org-new-email')?.value?.trim() || null,
            client_industry:      document.getElementById('org-new-industry')?.value?.trim() || null,
            team_size: size,
            tier_code: tier.code,
            price_myr: tier.price,
            payment_status: 'unpaid',
            status: 'collecting',
            members: [],
            pairs: [],
            analysis: {},
            consultant_id: user?.id || null,
            created_by:    user?.id || null,
        };
    
        try {
            const row = await AppDataStore.create('org_consultations', payload);
            UI.toast.success('Consultation created.');
            UI.hideModal();
            if (row?.id) await window.app.openOrgConsultationDetail(row.id);
        } catch (e) {
            UI.toast.error('Save failed: ' + (e?.message || e));
        }
    };
    
    // ---------------- DETAIL VIEW ----------------
    const _orgBuildDetailHtml = (row, members, analysisDone, reportReady) => `
            <div style="padding:24px;max-width:1100px;margin:0 auto;">
                <div style="margin-bottom:12px;">
                    <button class="btn btn-sm secondary" onclick="app.navigateTo('org_chart')">
                        <i class="fas fa-arrow-left"></i> Back to list
                    </button>
                </div>
                <div style="background:#fff;border:1px solid var(--gray-200);border-radius:8px;padding:20px;margin-bottom:16px;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
                        <div>
                            <h2 style="margin:0;">${_orgEscapeHtml(row.client_company)}</h2>
                            <div style="color:var(--gray-500);font-size:13px;margin-top:4px;">
                                ${row.client_contact_name ? `${_orgEscapeHtml(row.client_contact_name)} · ` : ''}
                                ${row.client_contact_phone ? `${_orgEscapeHtml(row.client_contact_phone)} · ` : ''}
                                ${row.client_industry ? _orgEscapeHtml(row.client_industry) : ''}
                            </div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:28px;font-weight:700;color:var(--primary);">RM ${Number(row.price_myr).toLocaleString()}</div>
                            <div style="font-size:12px;color:var(--gray-500);">Team size: ${row.team_size} pax · ${row.tier_code}</div>
                            <div style="margin-top:8px;">
                                ${row.payment_status === 'paid'
                                  ? '<span style="background:#16a34a;color:#fff;font-size:11px;padding:3px 8px;border-radius:10px;">Paid</span>'
                                  : `<button class="btn btn-sm" onclick="app.markOrgConsultationPaid(${row.id})">Mark Paid</button>`}
                            </div>
                        </div>
                    </div>
                </div>
    
                <div style="background:#fff;border:1px solid var(--gray-200);border-radius:8px;padding:20px;margin-bottom:16px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                        <h3 style="margin:0;">Team Members <span style="color:var(--gray-500);font-size:14px;font-weight:400;">(${members.length} / ${row.team_size})</span></h3>
                        <div style="display:flex;gap:8px;">
                            <button class="btn btn-sm" onclick="app.openOrgMemberBulkPaste(${row.id})"><i class="fas fa-paste"></i> Bulk Paste</button>
                            <button class="btn btn-sm primary" onclick="app.openOrgMemberAddModal(${row.id})"><i class="fas fa-user-plus"></i> Add Member</button>
                        </div>
                    </div>
                    ${members.length === 0 ? `
                        <div style="text-align:center;padding:32px;color:var(--gray-500);">No members yet. Add team members one by one or paste a CSV.</div>
                    ` : `
                        <table style="width:100%;border-collapse:collapse;font-size:13px;">
                            <thead><tr style="background:var(--gray-100);text-align:left;">
                                <th style="padding:8px;">Name</th><th style="padding:8px;">Current Role</th><th style="padding:8px;">DOB</th><th style="padding:8px;">Suggested Role</th><th style="padding:8px;">Fit</th><th style="padding:8px;text-align:right;"></th>
                            </tr></thead>
                            <tbody>${members.map((m, i) => `
                                <tr style="border-top:1px solid var(--gray-200);">
                                    <td style="padding:8px;"><strong>${_orgEscapeHtml(m.name || '—')}</strong></td>
                                    <td style="padding:8px;color:var(--gray-600);">${_orgEscapeHtml(m.current_role || '—')}</td>
                                    <td style="padding:8px;font-size:11px;color:var(--gray-500);">${_orgEscapeHtml(m.dob || '—')}</td>
                                    <td style="padding:8px;">${_orgEscapeHtml(_orgArchetypeLabel(m.archetype_code)) || '—'}</td>
                                    <td style="padding:8px;">${m.fit_score ? `<span style="background:#dcfce7;color:#166534;font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;">${m.fit_score}</span>` : '—'}</td>
                                    <td style="padding:8px;text-align:right;">
                                        <button class="btn btn-sm" onclick="app.openOrgMemberAddModal(${row.id}, ${i})">Edit</button>
                                        <button class="btn btn-sm" style="background:#fee2e2;color:#991b1b;" onclick="app.removeOrgMember(${row.id}, ${i})">×</button>
                                    </td>
                                </tr>
                            `).join('')}</tbody>
                        </table>
                    `}
                </div>
    
                ${members.length > 0 ? `
                <div style="background:#fff;border:1px solid var(--gray-200);border-radius:8px;padding:20px;margin-bottom:16px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                        <h3 style="margin:0;">Analysis</h3>
                        <button class="btn ${analysisDone ? 'secondary' : 'primary'}" onclick="app.runOrgAnalysis(${row.id})">
                            <i class="fas fa-bolt"></i> ${analysisDone ? 'Re-run' : 'Run'} Analysis
                        </button>
                    </div>
                    ${analysisDone && row.analysis?.overall_summary ? `
                        <div style="background:#f8fafc;padding:12px;border-radius:6px;font-size:13px;">${_orgEscapeHtml(row.analysis.overall_summary)}</div>
                    ` : `<div style="color:var(--gray-500);font-size:13px;">${analysisDone ? 'Analysis complete. Re-run if members change.' : 'Run analysis once all members have DOBs filled in.'}</div>`}
                </div>
    
                ${analysisDone ? `
                <div style="background:#fff;border:1px solid var(--gray-200);border-radius:8px;padding:20px;margin-bottom:16px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                        <h3 style="margin:0;">Client-facing Report</h3>
                        <div style="display:flex;gap:8px;">
                            <button class="btn ${reportReady ? 'secondary' : 'primary'}" onclick="app.generateOrgReport(${row.id})">
                                <i class="fas fa-file-alt"></i> ${reportReady ? 'Regenerate' : 'Generate'} Report
                            </button>
                            ${reportReady ? `<button class="btn primary" onclick="app.previewOrgReport(${row.id})"><i class="fas fa-eye"></i> Preview</button>` : ''}
                        </div>
                    </div>
                    <div style="color:var(--gray-500);font-size:13px;">
                        ${reportReady ? 'Report ready. All client-facing copy is sanitised — no internal terminology surfaces.' : 'Click Generate to produce the deliverable.'}
                    </div>
                </div>
                ` : ''}
                ` : ''}
    
                <div style="background:#fff;border:1px solid var(--gray-200);border-radius:8px;padding:20px;">
                    <h3 style="margin:0 0 12px;">Internal Notes <span style="font-size:11px;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;">consultant-only</span></h3>
                    <textarea id="org-detail-notes-${row.id}" class="form-control" rows="4" placeholder="Raw notes — internal use only. Never shown to client.">${_orgEscapeHtml(row.consultant_notes || '')}</textarea>
                    <div style="text-align:right;margin-top:8px;">
                        <button class="btn btn-sm primary" onclick="app.saveOrgConsultationNotes(${row.id})">Save Notes</button>
                    </div>
                </div>
            </div>
        `;

    const openOrgConsultationDetail = async (id) => {
        const row = await AppDataStore.getById('org_consultations', id);
        if (!row) { UI.toast.error('Consultation not found.'); return; }
        const viewport = document.getElementById('content-viewport');
        if (!viewport) return;

        const members = Array.isArray(row.members) ? row.members : [];
        const analysisDone = members.length > 0 && members.every(m => m.archetype_code);
        const reportReady = !!row.report_html;

        viewport.innerHTML = _orgBuildDetailHtml(row, members, analysisDone, reportReady);
    };

    // ---------------- MEMBER ADD / EDIT ----------------
    const openOrgMemberAddModal = async (consultationId, memberIdx) => {
        const row = await AppDataStore.getById('org_consultations', consultationId);
        if (!row) { UI.toast.error('Consultation not found.'); return; }
        const members = Array.isArray(row.members) ? row.members : [];
        const editing = typeof memberIdx === 'number' && members[memberIdx];
        const m = editing || { name: '', current_role: '', dob: '', dob_time: '', dob_city: '', gender: '' };
    
        UI.showModal(editing ? 'Edit Team Member' : 'Add Team Member', `
            <input type="hidden" id="org-mem-cid" value="${consultationId}">
            <input type="hidden" id="org-mem-idx" value="${editing ? memberIdx : -1}">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div class="form-group"><label>Full Name *</label>
                    <input type="text" id="org-mem-name" class="form-control" value="${_orgEscapeHtml(m.name)}"></div>
                <div class="form-group"><label>Current Role</label>
                    <input type="text" id="org-mem-role" class="form-control" value="${_orgEscapeHtml(m.current_role)}"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
                <div class="form-group"><label>Date of Birth *</label>
                    <input type="date" id="org-mem-dob" class="form-control" value="${_orgEscapeHtml(m.dob)}"></div>
                <div class="form-group"><label>Time (optional)</label>
                    <input type="time" id="org-mem-dobtime" class="form-control" value="${_orgEscapeHtml(m.dob_time)}"></div>
                <div class="form-group"><label>Gender</label>
                    <select id="org-mem-gender" class="form-control">
                        <option value="">—</option>
                        <option value="male" ${m.gender === 'male' ? 'selected' : ''}>Male</option>
                        <option value="female" ${m.gender === 'female' ? 'selected' : ''}>Female</option>
                    </select></div>
            </div>
            <div class="form-group"><label>Birth City (optional)</label>
                <input type="text" id="org-mem-city" class="form-control" value="${_orgEscapeHtml(m.dob_city)}"></div>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: editing ? 'Update' : 'Add', type: 'primary', action: '(async () => { await app.saveOrgMember(); })()' }
        ]);
    };
    
    const saveOrgMember = async () => {
        const cid = parseInt(document.getElementById('org-mem-cid')?.value, 10);
        const idx = parseInt(document.getElementById('org-mem-idx')?.value, 10);
        const name = document.getElementById('org-mem-name')?.value?.trim();
        if (!cid || !name) { UI.toast.error('Name is required.'); return; }
        const dobVal = document.getElementById('org-mem-dob')?.value || '';
        // DOB is marked required (*) and the archetype analysis needs it — enforce
        // it so analysis can't silently complete on incomplete data.
        if (!dobVal) { UI.toast.error('Date of Birth is required.'); return; }

        const member = {
            name,
            current_role: document.getElementById('org-mem-role')?.value?.trim() || '',
            dob:          dobVal,
            dob_time:     document.getElementById('org-mem-dobtime')?.value || '',
            dob_city:     document.getElementById('org-mem-city')?.value?.trim() || '',
            gender:       document.getElementById('org-mem-gender')?.value || '',
            archetype_code: null, suggested_role: null, fit_score: null, notes: ''
        };
    
        const row = await AppDataStore.getById('org_consultations', cid);
        if (!row) { UI.toast.error('Consultation not found.'); return; }
        const members = Array.isArray(row.members) ? [...row.members] : [];
        if (idx >= 0 && members[idx]) {
            members[idx] = { ...members[idx], ...member, archetype_code: null, fit_score: null }; // reset compute
        } else {
            if (members.length >= row.team_size) {
                UI.toast.error(`Team size cap reached (${row.team_size}). Upgrade tier first.`);
                return;
            }
            members.push(member);
        }
    
        try {
            // Clearing analysis/pairs: they store member ARRAY INDICES which go
            // stale the moment the member list changes, producing wrong names in
            // a regenerated report. Reset so analysis must be re-run.
            await AppDataStore.update('org_consultations', cid, { members, status: 'collecting', analysis: {}, pairs: [], report_html: null });
            UI.toast.success('Member saved.');
            UI.hideModal();
            await window.app.openOrgConsultationDetail(cid);
        } catch (e) {
            UI.toast.error('Save failed: ' + (e?.message || e));
        }
    };
    
    const removeOrgMember = async (cid, idx) => {
        if (!confirm('Remove this member?')) return;
        const row = await AppDataStore.getById('org_consultations', cid);
        if (!row) return;
        const members = Array.isArray(row.members) ? [...row.members] : [];
        members.splice(idx, 1);
        try {
            // Reset analysis/pairs (member-index based) so the removed member
            // can't leave the regenerated report pointing at the wrong people.
            await AppDataStore.update('org_consultations', cid, { members, status: 'collecting', analysis: {}, pairs: [], report_html: null });
            await window.app.openOrgConsultationDetail(cid);
        } catch (e) {
            UI.toast.error('Remove failed: ' + (e?.message || e));
        }
    };
    
    const openOrgMemberBulkPaste = async (cid) => {
        UI.showModal('Bulk Paste Members', `
            <input type="hidden" id="org-bulk-cid" value="${cid}">
            <p style="color:var(--gray-600);font-size:13px;">Paste CSV: <code>Name, Role, DOB (YYYY-MM-DD), Gender</code> — one per line.</p>
            <textarea id="org-bulk-csv" class="form-control" rows="10" placeholder="Ali bin Abu, Sales Lead, 1985-03-12, male&#10;Siti Aminah, HR Manager, 1990-07-25, female"></textarea>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Import', type: 'primary', action: '(async () => { await app.importOrgMembersCsv(); })()' }
        ]);
    };
    
    const importOrgMembersCsv = async () => {
        const cid = parseInt(document.getElementById('org-bulk-cid')?.value, 10);
        const csv = document.getElementById('org-bulk-csv')?.value || '';
        const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
        if (!lines.length) { UI.toast.error('Paste at least one row.'); return; }
    
        const row = await AppDataStore.getById('org_consultations', cid);
        if (!row) return;
        const members = Array.isArray(row.members) ? [...row.members] : [];
    
        let added = 0, skipped = 0;
        for (const line of lines) {
            const parts = line.split(',').map(p => p.trim());
            const name = parts[0]; if (!name) { skipped++; continue; }
            if (members.length >= row.team_size) { skipped++; continue; }
            members.push({
                name,
                current_role: parts[1] || '',
                dob:          parts[2] || '',
                dob_time:     '',
                dob_city:     '',
                gender:       (parts[3] || '').toLowerCase(),
                archetype_code: null, suggested_role: null, fit_score: null, notes: ''
            });
            added++;
        }

        // Reset analysis/pairs (member-index based) since the roster changed.
        await AppDataStore.update('org_consultations', cid, { members, status: 'collecting', analysis: {}, pairs: [], report_html: null });
        if (skipped > 0) UI.toast.warning(`Imported ${added} member(s); skipped ${skipped} (team-size cap ${row.team_size} reached or blank/malformed row).`);
        else UI.toast.success(`Imported ${added} member(s).`);
        UI.hideModal();
        await window.app.openOrgConsultationDetail(cid);
    };
    
    // ---------------- ANALYSIS ----------------
    const runOrgAnalysis = async (cid) => {
        const row = await AppDataStore.getById('org_consultations', cid);
        if (!row) return;
        const membersIn = Array.isArray(row.members) ? row.members : [];
        if (!membersIn.length) { UI.toast.error('No members to analyse.'); return; }
    
        UI.toast.info('Running analysis…');
        const members = membersIn.map(m => {
            const r = _orgComputeArchetype(m);
            return { ...m, archetype_code: r.code, fit_score: r.score, suggested_role: _orgArchetypeLabel(r.code) };
        });
    
        const pairs = [];
        for (let i = 0; i < members.length; i++) {
            for (let j = i + 1; j < members.length; j++) {
                pairs.push({ from_idx: i, to_idx: j, score: _orgPairScore(members[i], members[j]), code: '' });
            }
        }
    
        const leadershipCluster = members
            .map((m, idx) => ({ idx, m }))
            .filter(({ m }) => ['leader', 'operator', 'catalyst'].includes(m.archetype_code))
            .sort((a, b) => (b.m.fit_score || 0) - (a.m.fit_score || 0))
            .slice(0, 3)
            .map(({ idx }) => idx);
    
        const conflictPairs = pairs.filter(p => p.score < 60)
            .sort((a, b) => a.score - b.score)
            .slice(0, 5)
            .map(p => ({ a: p.from_idx, b: p.to_idx, severity: 100 - p.score }));
    
        const presentArchetypes = new Set(members.map(m => m.archetype_code));
        const missingArchetypes = ORG_ARCHETYPES.filter(a => !presentArchetypes.has(a.code)).map(a => a.code);
    
        const analysis = {
            leadership_cluster: leadershipCluster,
            conflict_pairs: conflictPairs,
            missing_archetypes: missingArchetypes,
            overall_summary: `Team of ${members.length}. Strong in ${[...presentArchetypes].slice(0, 3).map(c => _orgArchetypeLabel(c)).join(', ') || 'mixed traits'}. ${conflictPairs.length ? `Watch ${conflictPairs.length} potential friction pair(s).` : 'No high-friction pairs detected.'}`,
            generated_at: new Date().toISOString(),
        };
    
        await AppDataStore.update('org_consultations', cid, { members, pairs, analysis, status: 'analyzing' });
        UI.toast.success('Analysis complete.');
        await window.app.openOrgConsultationDetail(cid);
    };
    
    // ---------------- REPORT ----------------
    const generateOrgReport = async (cid) => {
        const row = await AppDataStore.getById('org_consultations', cid);
        if (!row) return;
        const members = Array.isArray(row.members) ? row.members : [];
        const analysis = row.analysis || {};
    
        const memberRows = members.map(m => `
            <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:10px;"><strong>${_orgEscapeHtml(m.name)}</strong><div style="font-size:11px;color:#6b7280;">${_orgEscapeHtml(m.current_role || '')}</div></td>
                <td style="padding:10px;">${_orgEscapeHtml(_orgArchetypeLabel(m.archetype_code))}</td>
                <td style="padding:10px;font-weight:600;color:#16a34a;">${m.fit_score || ''}</td>
            </tr>
        `).join('');
    
        const leadershipNames = (analysis.leadership_cluster || []).map(idx => members[idx]?.name).filter(Boolean);
    
        const conflictRows = (analysis.conflict_pairs || []).map(c =>
            `<li>${_orgEscapeHtml(members[c.a]?.name || '')} ↔ ${_orgEscapeHtml(members[c.b]?.name || '')} — coach communication style</li>`
        ).join('') || '<li>No high-friction pairs detected.</li>';
    
        const missingList = (analysis.missing_archetypes || [])
            .map(code => _orgArchetypeLabel(code))
            .map(label => `<li>${_orgEscapeHtml(label)}</li>`)
            .join('') || '<li>All key archetypes are represented.</li>';
    
        // Build raw HTML then RUN IT THROUGH THE SANITISER before persist.
        const rawHtml = `
            <div style="font-family:Inter,sans-serif;max-width:800px;color:#1f2937;">
                <div style="background:linear-gradient(135deg,#8B1A1A,#b91c1c);color:#fff;padding:24px;border-radius:8px;">
                    <h1 style="margin:0;">Organisational Restructure Report</h1>
                    <div style="opacity:0.9;margin-top:6px;">Prepared for ${_orgEscapeHtml(row.client_company)} · ${new Date().toLocaleDateString()}</div>
                </div>
                <div style="padding:24px 8px;">
                    <h2>Executive Summary</h2>
                    <p>${_orgEscapeHtml(analysis.overall_summary || '')}</p>
                    <h2>Recommended Leadership Cluster</h2>
                    <p>${leadershipNames.length ? leadershipNames.map(_orgEscapeHtml).join(', ') : 'No clear leadership cluster — recommend external hire or development plan.'}</p>
                    <h2>Role-Fit Assessment</h2>
                    <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:6px;">
                        <thead style="background:#f9fafb;text-align:left;"><tr><th style="padding:10px;">Member</th><th style="padding:10px;">Suggested Role</th><th style="padding:10px;">Fit</th></tr></thead>
                        <tbody>${memberRows}</tbody>
                    </table>
                    <h2>Friction Pairs To Coach</h2>
                    <ul>${conflictRows}</ul>
                    <h2>Capability Gaps</h2>
                    <ul>${missingList}</ul>
                    <hr style="margin:32px 0;border:none;border-top:1px solid #e5e7eb;">
                    <p style="font-size:11px;color:#6b7280;">Report generated by DestinOraclesSolution · Confidential · For internal use of ${_orgEscapeHtml(row.client_company)} only.</p>
                </div>
            </div>
        `;
        const report = _orgSanitiseClientText(rawHtml);
    
        await AppDataStore.update('org_consultations', cid, {
            report_html: report,
            report_generated_at: new Date().toISOString(),
            status: 'completed'
        });
        UI.toast.success('Report generated.');
        await window.app.openOrgConsultationDetail(cid);
    };
    
    const previewOrgReport = async (cid) => {
        const row = await AppDataStore.getById('org_consultations', cid);
        if (!row?.report_html) { UI.toast.error('No report yet.'); return; }
        UI.showModal('Client-facing Report Preview', `
            <div style="max-height:70vh;overflow:auto;" id="org-report-body">${row.report_html}</div>
        `, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Print', type: 'primary', action: '(() => { const body=document.getElementById("org-report-body")?.innerHTML||""; const w=window.open("","_blank"); if(!w){alert("Popup blocked. Please allow popups to print.");return;} w.document.write("<html><head><title>Report</title></head><body>"+body+"</body></html>"); w.document.close(); w.print(); })()' }
        ]);
    };
    
    // ---------------- MISC ----------------
    const markOrgConsultationPaid = async (cid) => {
        try {
            await AppDataStore.update('org_consultations', cid, {
                payment_status: 'paid',
                payment_received_at: new Date().toISOString()
            });
            UI.toast.success('Marked as paid.');
            await window.app.openOrgConsultationDetail(cid);
        } catch (e) {
            UI.toast.error('Update failed: ' + (e?.message || e));
        }
    };

    const saveOrgConsultationNotes = async (cid) => {
        const notes = document.getElementById(`org-detail-notes-${cid}`)?.value || '';
        try {
            await AppDataStore.update('org_consultations', cid, { consultant_notes: notes });
            UI.toast.success('Notes saved.');
        } catch (e) {
            UI.toast.error('Save failed: ' + (e?.message || e));
        }
    };
    
    app.register('org', {
        showOrgChartView,
        openNewOrgConsultation,
        _orgUpdatePricePreview,
        saveNewOrgConsultation,
        openOrgConsultationDetail,
        openOrgMemberAddModal,
        saveOrgMember,
        removeOrgMember,
        openOrgMemberBulkPaste,
        importOrgMembersCsv,
        runOrgAnalysis,
        generateOrgReport,
        previewOrgReport,
        markOrgConsultationPaid,
        saveOrgConsultationNotes,
    });
    
    // Initialize application when DOM is ready
})();