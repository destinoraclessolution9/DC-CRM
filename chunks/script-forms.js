/**
 * CRM Lazy Chunk: Lead Forms, Surveys, Contracts, Custom Fields, Portal
 * Loaded on-demand when navigating to form-related views.
 * Extracted 2026-06-05 (~1164 lines). All self-contained, no private state reads.
 */
(() => {
    const _state = window._appState;
    const esc = (s) => window._crmUtils.escapeHtml(s);
    // ========== LEAD CAPTURE FORMS ==========

    // React-island flag for the forms-chunk views (default-on). Kill-switch → legacy:
    // window.__REACT_<X>===false, ?react=0, or localStorage crm_react_off='1'.
    const _reactFormsOn = (killFlag, mountName) => {
        try {
            if (window[killFlag] === false) return false;
            if (/[?&]react=0/.test(location.search)) return false;
            if (localStorage.getItem('crm_react_off') === '1') return false;
            return !!(window.CRMReact && typeof window.CRMReact[mountName] === 'function');
        } catch (_) { return false; }
    };

    const showLeadFormsView = async (container) => {
        _state.cv = 'lead_forms';
        const forms = await AppDataStore.getAll('lead_forms').catch(() => []);
        if (_reactFormsOn('__REACT_LEADFORMS', 'mountLeadFormsView')) {
            try {
                container.innerHTML = '<div id="leadforms-react-root"></div>';
                window.CRMReact.mountLeadFormsView(document.getElementById('leadforms-react-root'), { forms });
                return;
            } catch (e) { console.warn('[react-leadforms] mount failed → legacy:', e?.message || e); }
        }
        container.innerHTML = `
            <div style="padding:24px; max-width:1000px; margin:0 auto;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
                    <div>
                        <h1 style="font-size:24px; font-weight:700; margin:0;">Lead Capture Forms</h1>
                        <p style="color:var(--gray-500); margin:4px 0 0;">Shareable forms that auto-create prospects when submitted.</p>
                    </div>
                    <button class="btn primary" onclick="app.openFormBuilderModal()"><i class="fas fa-plus"></i> New Form</button>
                </div>
                ${forms.length === 0 ? `
                    <div style="text-align:center; padding:60px; background:white; border:1px solid var(--gray-200); border-radius:12px; color:var(--gray-400);">
                        <i class="fas fa-wpforms" style="font-size:48px; display:block; margin-bottom:12px;"></i>
                        <h3 style="color:var(--gray-500);">No forms yet</h3>
                        <p>Create your first lead capture form to start collecting prospects automatically.</p>
                        <button class="btn primary" onclick="app.openFormBuilderModal()">Create Form</button>
                    </div>
                ` : `
                    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:16px;">
                        ${forms.map(form => `
                            <div style="background:white; border:1px solid var(--gray-200); border-radius:12px; padding:20px;">
                                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
                                    <div>
                                        <h3 style="margin:0; font-size:16px;">${form.name}</h3>
                                        <p style="margin:4px 0 0; color:var(--gray-500); font-size:13px;">${form.description || 'No description'}</p>
                                    </div>
                                    <span style="padding:3px 10px; border-radius:20px; font-size:12px; background:${form.is_active ? '#d1fae5' : '#f3f4f6'}; color:${form.is_active ? '#065f46' : '#6b7280'};">${form.is_active ? 'Active' : 'Inactive'}</span>
                                </div>
                                <div style="font-size:12px; color:var(--gray-400); margin-bottom:16px;">${(form.fields || []).length} fields</div>
                                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                                    <button class="btn secondary" style="flex:1; font-size:12px; padding:6px;" onclick="app.copyFormLink(${form.id})"><i class="fas fa-copy"></i> Copy Link</button>
                                    <button class="btn secondary" style="flex:1; font-size:12px; padding:6px;" onclick="app.showFormSubmissions(${form.id})"><i class="fas fa-inbox"></i> Submissions</button>
                                    <button class="btn-icon" style="color:var(--error);" onclick="app.deleteLeadForm(${form.id})"><i class="fas fa-trash"></i></button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `}
            </div>
        `;
    };

    const openFormBuilderModal = () => {
        UI.showModal('Create Lead Capture Form', `
            <div style="display:flex; flex-direction:column; gap:16px;">
                <div><label style="display:block; font-weight:500; margin-bottom:6px;">Form Name</label>
                <input type="text" id="form-name" class="form-control" placeholder="e.g. Free Consultation Request"></div>
                <div><label style="display:block; font-weight:500; margin-bottom:6px;">Description</label>
                <textarea id="form-description" class="form-control" rows="2" placeholder="Brief description shown on the form..."></textarea></div>
                <div>
                    <label style="display:block; font-weight:500; margin-bottom:8px;">Form Fields</label>
                    <div id="form-fields-list" style="display:flex; flex-direction:column; gap:8px; margin-bottom:10px;">
                        <div class="form-field-row" style="display:flex; gap:8px; align-items:center;">
                            <input type="text" class="form-control field-label" value="Full Name" style="flex:1;">
                            <select class="form-control field-type" style="width:110px;"><option value="text" selected>Text</option><option value="email">Email</option><option value="tel">Phone</option><option value="textarea">Long Text</option><option value="date">Date</option></select>
                            <label style="display:flex; align-items:center; gap:4px; font-size:12px; white-space:nowrap;"><input type="checkbox" class="field-required" checked> Req</label>
                            <button class="btn-icon" style="color:var(--error);" onclick="this.closest('.form-field-row').remove()"><i class="fas fa-times"></i></button>
                        </div>
                        <div class="form-field-row" style="display:flex; gap:8px; align-items:center;">
                            <input type="text" class="form-control field-label" value="Phone" style="flex:1;">
                            <select class="form-control field-type" style="width:110px;"><option value="text">Text</option><option value="email">Email</option><option value="tel" selected>Phone</option><option value="textarea">Long Text</option><option value="date">Date</option></select>
                            <label style="display:flex; align-items:center; gap:4px; font-size:12px; white-space:nowrap;"><input type="checkbox" class="field-required" checked> Req</label>
                            <button class="btn-icon" style="color:var(--error);" onclick="this.closest('.form-field-row').remove()"><i class="fas fa-times"></i></button>
                        </div>
                    </div>
                    <button class="btn secondary" style="font-size:13px;" onclick="app.addFormField()"><i class="fas fa-plus"></i> Add Field</button>
                </div>
            </div>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save Form', type: 'primary', action: '(async () => { await app.saveLeadForm(); })()' }
        ]);
    };

    const addFormField = () => {
        const list = document.getElementById('form-fields-list');
        const row = document.createElement('div');
        row.className = 'form-field-row';
        row.style.cssText = 'display:flex; gap:8px; align-items:center;';
        row.innerHTML = `
            <input type="text" class="form-control field-label" placeholder="Field label" style="flex:1;">
            <select class="form-control field-type" style="width:110px;"><option value="text" selected>Text</option><option value="email">Email</option><option value="tel">Phone</option><option value="textarea">Long Text</option><option value="date">Date</option></select>
            <label style="display:flex; align-items:center; gap:4px; font-size:12px; white-space:nowrap;"><input type="checkbox" class="field-required"> Req</label>
            <button class="btn-icon" style="color:var(--error);" onclick="this.closest('.form-field-row').remove()"><i class="fas fa-times"></i></button>
        `;
        list.appendChild(row);
    };

    const saveLeadForm = async () => {
        const _nameEl = document.getElementById('form-name');
        if (!_nameEl) { UI.toast.error('Form name field not found.'); return; }
        const name = _nameEl.value.trim();
        if (!name) { UI.toast.error('Form name is required.'); return; }
        const fields = [];
        document.querySelectorAll('#form-fields-list .form-field-row').forEach((row, i) => {
            const label = (row.querySelector('.field-label')?.value || '').trim();
            const type = row.querySelector('.field-type')?.value || 'text';
            const required = row.querySelector('.field-required')?.checked || false;
            if (label) fields.push({ id: `field_${i}`, label, type, required });
        });
        if (fields.length === 0) { UI.toast.error('Add at least one field.'); return; }
        const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();
        await AppDataStore.create('lead_forms', {
            name, slug, title: name,
            description: document.getElementById('form-description')?.value.trim() ?? '',
            fields, assigned_agent_id: _state.cu?.id || 1,
            is_active: true, created_at: new Date().toISOString()
        });
        UI.hideModal();
        UI.toast.success('Lead form created!');
        await showLeadFormsView(document.getElementById('content-viewport'));
    };

    const deleteLeadForm = async (formId) => {
        try {
            const submissions = await AppDataStore.getAll('lead_submissions').catch(() => []);
            for (const s of submissions.filter(s => String(s.form_id) === String(formId)))
                await AppDataStore.delete('lead_submissions', s.id);
            await AppDataStore.delete('lead_forms', formId);
            UI.toast.success('Form deleted.');
            await showLeadFormsView(document.getElementById('content-viewport'));
        } catch (err) {
            UI.toast.error('Delete failed: ' + (err.message || 'Unknown error'));
        }
    };

    const copyFormLink = (formId) => {
        const url = `${window.location.origin}/form.html?id=${formId}`;
        navigator.clipboard.writeText(url).then(() => UI.toast.success('Form link copied!')).catch(() => UI.toast.info(`Link: ${url}`));
    };

    const showFormSubmissions = async (formId) => {
        const submissions = (await AppDataStore.getAll('lead_submissions').catch(() => [])).filter(s => s.form_id == formId);
        const html = `
            <div>
                <p style="color:var(--gray-500); margin:0 0 16px;">${submissions.length} total submissions</p>
                ${submissions.length === 0 ? '<p style="text-align:center; color:var(--gray-400); padding:40px 0;">No submissions yet.</p>' : `
                    <table style="width:100%; border-collapse:collapse;">
                        <thead><tr style="background:var(--gray-50); border-bottom:2px solid var(--gray-200);">
                            <th scope="col" style="padding:10px; text-align:left;">Name</th>
                            <th scope="col" style="padding:10px; text-align:left;">Date</th>
                            <th scope="col" style="padding:10px; text-align:left;">Status</th>
                            <th scope="col" style="padding:10px; text-align:left;">Action</th>
                        </tr></thead>
                        <tbody>${submissions.map(s => {
                            const data = s.data || {};
                            const name = data['Full Name'] || data.name || 'Unknown';
                            return `<tr style="border-bottom:1px solid var(--gray-100);">
                                <td style="padding:10px;">${esc(name)}</td>
                                <td style="padding:10px; color:var(--gray-500); font-size:13px;">${s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}</td>
                                <td style="padding:10px;"><span style="padding:2px 8px; border-radius:10px; font-size:12px; background:${s.status==='processed'?'#d1fae5':'#fef3c7'}; color:${s.status==='processed'?'#065f46':'#92400e'};">${s.status || 'new'}</span></td>
                                <td style="padding:10px;">${s.status !== 'processed' ? `<button class="btn secondary" style="font-size:12px; padding:4px 10px;" onclick="app.processFormSubmission(${s.id})">Create Prospect</button>` : '<span style="color:var(--gray-400); font-size:12px;">Done</span>'}</td>
                            </tr>`;
                        }).join('')}</tbody>
                    </table>
                `}
            </div>
        `;
        UI.showModal('Form Submissions', html, [{ label: 'Close', type: 'secondary', action: 'UI.hideModal()' }]);
    };

    const processFormSubmission = async (submissionId) => {
        const submission = await AppDataStore.getById('lead_submissions', submissionId);
        if (!submission) return;
        const data = submission.data || {};
        const name = data['Full Name'] || data.name || 'Lead Form Prospect';
        const prospect = await AppDataStore.create('prospects', {
            full_name: name, phone: data['Phone'] || data.phone || '',
            email: data['Email'] || data.email || '',
            status: 'New', source: 'lead_form',
            lead_agent_id: _state.cu?.id || 1, created_at: new Date().toISOString()
        });
        await AppDataStore.update('lead_submissions', submissionId, { status: 'processed', prospect_id: prospect?.id });
        UI.toast.success(`Prospect "${name}" created.`);
        UI.hideModal();
    };

    // ========== NPS / SATISFACTION SURVEYS ==========

    const showSurveysView = async (container) => {
        _state.cv = 'surveys';
        const surveys = await AppDataStore.getAll('surveys').catch(() => []);
        if (_reactFormsOn('__REACT_SURVEYS', 'mountSurveysView')) {
            try {
                container.innerHTML = '<div id="surveys-react-root"></div>';
                window.CRMReact.mountSurveysView(document.getElementById('surveys-react-root'), { surveys });
                return;
            } catch (e) { console.warn('[react-surveys] mount failed → legacy:', e?.message || e); }
        }
        container.innerHTML = `
            <div style="padding:24px; max-width:1000px; margin:0 auto;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
                    <div>
                        <h1 style="font-size:24px; font-weight:700; margin:0;">NPS & Satisfaction Surveys</h1>
                        <p style="color:var(--gray-500); margin:4px 0 0;">Measure customer satisfaction with shareable survey links.</p>
                    </div>
                    <button class="btn primary" onclick="app.openSurveyBuilderModal()"><i class="fas fa-plus"></i> New Survey</button>
                </div>
                ${surveys.length === 0 ? `
                    <div style="text-align:center; padding:60px; background:white; border:1px solid var(--gray-200); border-radius:12px; color:var(--gray-400);">
                        <i class="fas fa-star" style="font-size:48px; display:block; margin-bottom:12px;"></i>
                        <h3 style="color:var(--gray-500);">No surveys yet</h3>
                        <button class="btn primary" onclick="app.openSurveyBuilderModal()">Create Survey</button>
                    </div>
                ` : `
                    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:16px;">
                        ${surveys.map(survey => `
                            <div style="background:white; border:1px solid var(--gray-200); border-radius:12px; padding:20px;">
                                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                                    <div>
                                        <h3 style="margin:0; font-size:16px;">${survey.name}</h3>
                                        <span style="font-size:12px; color:var(--gray-400); text-transform:uppercase;">${survey.type}</span>
                                    </div>
                                    <span style="padding:3px 10px; border-radius:20px; font-size:12px; background:${survey.is_active ? '#d1fae5' : '#f3f4f6'}; color:${survey.is_active ? '#065f46' : '#6b7280'};">${survey.is_active ? 'Active' : 'Inactive'}</span>
                                </div>
                                <p style="color:var(--gray-600); font-size:13px; margin:0 0 16px;">${survey.question}</p>
                                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                                    <button class="btn secondary" style="flex:1; font-size:12px; padding:6px;" onclick="app.copySurveyLink(${survey.id})"><i class="fas fa-copy"></i> Copy Link</button>
                                    <button class="btn secondary" style="flex:1; font-size:12px; padding:6px;" onclick="app.showSurveyResults(${survey.id})"><i class="fas fa-chart-bar"></i> Results</button>
                                    <button class="btn-icon" style="color:var(--error);" onclick="app.deleteSurvey(${survey.id})"><i class="fas fa-trash"></i></button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `}
            </div>
        `;
    };

    const openSurveyBuilderModal = () => {
        UI.showModal('Create Survey', `
            <div style="display:flex; flex-direction:column; gap:16px;">
                <div><label style="display:block; font-weight:500; margin-bottom:6px;">Survey Name</label>
                <input type="text" id="survey-name" class="form-control" placeholder="e.g. Q2 Customer Satisfaction"></div>
                <div><label style="display:block; font-weight:500; margin-bottom:6px;">Type</label>
                <select id="survey-type" class="form-control" onchange="app.updateSurveyQuestion(this.value)">
                    <option value="nps">NPS (Net Promoter Score)</option>
                    <option value="csat">CSAT (Customer Satisfaction)</option>
                    <option value="custom">Custom Question</option>
                </select></div>
                <div><label style="display:block; font-weight:500; margin-bottom:6px;">Question</label>
                <input type="text" id="survey-question" class="form-control" value="How likely are you to recommend us to a friend or colleague?"></div>
                <div><label style="display:block; font-weight:500; margin-bottom:6px;">Description (optional)</label>
                <textarea id="survey-description" class="form-control" rows="2" placeholder="Additional context shown to respondents..."></textarea></div>
            </div>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save Survey', type: 'primary', action: '(async () => { await app.saveSurvey(); })()' }
        ]);
    };

    const updateSurveyQuestion = (type) => {
        const q = document.getElementById('survey-question');
        if (!q) return;
        if (type === 'nps') q.value = 'How likely are you to recommend us to a friend or colleague?';
        else if (type === 'csat') q.value = 'How satisfied are you with our service today?';
    };

    const saveSurvey = async () => {
        const _survNameEl = document.getElementById('survey-name');
        if (!_survNameEl) { UI.toast.error('Survey name field not found.'); return; }
        const name = _survNameEl.value.trim();
        if (!name) { UI.toast.error('Survey name is required.'); return; }
        await AppDataStore.create('surveys', {
            name, type: document.getElementById('survey-type')?.value ?? 'nps',
            question: document.getElementById('survey-question')?.value.trim() ?? '',
            description: document.getElementById('survey-description')?.value.trim() ?? '',
            created_by: _state.cu?.id || 1, is_active: true, created_at: new Date().toISOString()
        });
        UI.hideModal();
        UI.toast.success('Survey created!');
        await showSurveysView(document.getElementById('content-viewport'));
    };

    const deleteSurvey = async (surveyId) => {
        try {
            const responses = await AppDataStore.getAll('survey_responses').catch(() => []);
            for (const r of responses.filter(r => String(r.survey_id) === String(surveyId)))
                await AppDataStore.delete('survey_responses', r.id);
            await AppDataStore.delete('surveys', surveyId);
            UI.toast.success('Survey deleted.');
            await showSurveysView(document.getElementById('content-viewport'));
        } catch (err) {
            UI.toast.error('Delete failed: ' + (err.message || 'Unknown error'));
        }
    };

    const copySurveyLink = (surveyId) => {
        const url = `${window.location.origin}/survey.html?id=${surveyId}`;
        navigator.clipboard.writeText(url).then(() => UI.toast.success('Survey link copied!')).catch(() => UI.toast.info(`Link: ${url}`));
    };

    const showSurveyResults = async (surveyId) => {
        const survey = await AppDataStore.getById('surveys', surveyId);
        const responses = (await AppDataStore.getAll('survey_responses').catch(() => [])).filter(r => r.survey_id == surveyId);
        const promoters = responses.filter(r => r.score >= 9).length;
        const passives = responses.filter(r => r.score >= 7 && r.score <= 8).length;
        const detractors = responses.filter(r => r.score <= 6).length;
        const total = responses.length;
        const nps = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : null;
        const npsColor = nps === null ? '#9ca3af' : nps >= 50 ? '#10b981' : nps >= 0 ? '#f59e0b' : '#ef4444';
        const html = `
            <div>
                <p style="color:var(--gray-600); margin:0 0 20px;">${survey?.question}</p>
                <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:20px;">
                    <div style="text-align:center; padding:16px; background:var(--gray-50); border-radius:8px;">
                        <div style="font-size:28px; font-weight:700; color:${npsColor};">${nps !== null ? nps : '—'}</div>
                        <div style="font-size:12px; color:var(--gray-500);">NPS Score</div>
                    </div>
                    <div style="text-align:center; padding:16px; background:#f0fdf4; border-radius:8px;">
                        <div style="font-size:28px; font-weight:700; color:#10b981;">${promoters}</div>
                        <div style="font-size:12px; color:var(--gray-500);">Promoters (9-10)</div>
                    </div>
                    <div style="text-align:center; padding:16px; background:#fffbeb; border-radius:8px;">
                        <div style="font-size:28px; font-weight:700; color:#f59e0b;">${passives}</div>
                        <div style="font-size:12px; color:var(--gray-500);">Passives (7-8)</div>
                    </div>
                    <div style="text-align:center; padding:16px; background:#fef2f2; border-radius:8px;">
                        <div style="font-size:28px; font-weight:700; color:#ef4444;">${detractors}</div>
                        <div style="font-size:12px; color:var(--gray-500);">Detractors (0-6)</div>
                    </div>
                </div>
                ${responses.length === 0 ? '<p style="text-align:center; color:var(--gray-400);">No responses yet. Share your survey link.</p>' : `
                    <table style="width:100%; border-collapse:collapse;">
                        <thead><tr style="background:var(--gray-50); border-bottom:2px solid var(--gray-200);">
                            <th scope="col" style="padding:10px; text-align:left;">Respondent</th>
                            <th scope="col" style="padding:10px; text-align:left;">Score</th>
                            <th scope="col" style="padding:10px; text-align:left;">Feedback</th>
                            <th scope="col" style="padding:10px; text-align:left;">Date</th>
                        </tr></thead>
                        <tbody>${responses.slice(0,20).map(r => `
                            <tr style="border-bottom:1px solid var(--gray-100);">
                                <td style="padding:10px;">${r.respondent_name || 'Anonymous'}</td>
                                <td style="padding:10px;"><span style="font-weight:700; color:${r.score>=9?'#10b981':r.score>=7?'#f59e0b':'#ef4444'};">${r.score}/10</span></td>
                                <td style="padding:10px; color:var(--gray-600); font-size:13px;">${r.feedback || '—'}</td>
                                <td style="padding:10px; color:var(--gray-400); font-size:12px;">${r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : '—'}</td>
                            </tr>
                        `).join('')}</tbody>
                    </table>
                `}
            </div>
        `;
        UI.showModal(`Survey Results — ${survey?.name}`, html, [{ label: 'Close', type: 'secondary', action: 'UI.hideModal()' }]);
    };

    // ========== CONTRACTS / E-SIGNATURE ==========

    const renderContractStatusBadge = (status) => {
        const map = { draft:{bg:'#f3f4f6',color:'#6b7280',label:'Draft'}, sent:{bg:'#dbeafe',color:'#1e40af',label:'Sent'}, signed:{bg:'#d1fae5',color:'#065f46',label:'Signed'}, declined:{bg:'#fee2e2',color:'#991b1b',label:'Declined'} };
        const s = map[status] || map.draft;
        return `<span style="padding:3px 10px; border-radius:20px; font-size:12px; background:${s.bg}; color:${s.color};">${s.label}</span>`;
    };

    const showContractsView = async (container) => {
        _state.cv = 'contracts';
        const contracts = await AppDataStore.getAll('contracts').catch(() => []);
        if (_reactFormsOn('__REACT_CONTRACTS', 'mountContractsView')) {
            try {
                container.innerHTML = '<div id="contracts-react-root"></div>';
                window.CRMReact.mountContractsView(document.getElementById('contracts-react-root'), { contracts });
                return;
            } catch (e) { console.warn('[react-contracts] mount failed → legacy:', e?.message || e); }
        }
        container.innerHTML = `
            <div style="padding:24px; max-width:1000px; margin:0 auto;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
                    <div>
                        <h1 style="font-size:24px; font-weight:700; margin:0;">Contract Management</h1>
                        <p style="color:var(--gray-500); margin:4px 0 0;">Upload contracts and collect e-signatures from customers.</p>
                    </div>
                    <button class="btn primary" onclick="app.openUploadContractModal()"><i class="fas fa-plus"></i> Upload Contract</button>
                </div>
                ${contracts.length === 0 ? `
                    <div style="text-align:center; padding:60px; background:white; border:1px solid var(--gray-200); border-radius:12px; color:var(--gray-400);">
                        <i class="fas fa-file-signature" style="font-size:48px; display:block; margin-bottom:12px;"></i>
                        <h3 style="color:var(--gray-500);">No contracts yet</h3>
                        <p>Upload a contract to send for e-signature.</p>
                        <button class="btn primary" onclick="app.openUploadContractModal()">Upload Contract</button>
                    </div>
                ` : `
                    <table style="width:100%; border-collapse:collapse; background:white; border:1px solid var(--gray-200); border-radius:12px; overflow:hidden;">
                        <thead><tr style="background:var(--gray-50); border-bottom:2px solid var(--gray-200);">
                            <th scope="col" style="padding:12px 16px; text-align:left;">Title</th>
                            <th scope="col" style="padding:12px 16px; text-align:left;">Customer</th>
                            <th scope="col" style="padding:12px 16px; text-align:left;">Status</th>
                            <th scope="col" style="padding:12px 16px; text-align:left;">Date</th>
                            <th scope="col" style="padding:12px 16px; text-align:left;">Actions</th>
                        </tr></thead>
                        <tbody>${contracts.map(c => `
                            <tr style="border-bottom:1px solid var(--gray-100);">
                                <td style="padding:12px 16px;"><i class="fas fa-file-contract" style="color:var(--primary); margin-right:8px;"></i>${c.title}</td>
                                <td style="padding:12px 16px; color:var(--gray-600);">${c.signer_name || (c.customer_id ? `Customer #${c.customer_id}` : '—')}</td>
                                <td style="padding:12px 16px;">${renderContractStatusBadge(c.status)}</td>
                                <td style="padding:12px 16px; color:var(--gray-400); font-size:13px;">${c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}</td>
                                <td style="padding:12px 16px;">
                                    ${c.status === 'draft' ? `<button class="btn secondary" style="font-size:12px; padding:4px 10px;" onclick="app.sendContractForSigning(${c.id})"><i class="fas fa-paper-plane"></i> Send</button>` : ''}
                                    ${c.status === 'sent' ? `<button class="btn secondary" style="font-size:12px; padding:4px 10px;" onclick="app.copySigningLink(${c.id})"><i class="fas fa-copy"></i> Copy Link</button>` : ''}
                                    ${c.status === 'signed' ? `<button class="btn secondary" style="font-size:12px; padding:4px 10px;" onclick="app.showContractDetail(${c.id})"><i class="fas fa-eye"></i> View</button>` : ''}
                                </td>
                            </tr>
                        `).join('')}</tbody>
                    </table>
                `}
            </div>
        `;
    };

    const openUploadContractModal = (entityType = null, entityId = null) => {
        UI.showModal('Upload Contract', `
            <div style="display:flex; flex-direction:column; gap:16px;">
                <div><label style="display:block; font-weight:500; margin-bottom:6px;">Contract Title</label>
                <input type="text" id="contract-title" class="form-control" placeholder="e.g. Service Agreement - John Doe"></div>
                <div><label style="display:block; font-weight:500; margin-bottom:6px;">Link to Customer (optional — enter ID)</label>
                <input type="number" id="contract-customer-id" class="form-control" placeholder="Customer ID" value="${entityType === 'customer' && entityId ? entityId : ''}"></div>
                <div><label style="display:block; font-weight:500; margin-bottom:6px;">Contract File</label>
                <input type="file" id="contract-file" class="form-control" accept=".pdf,.doc,.docx">
                <p style="font-size:12px; color:var(--gray-400); margin:4px 0 0;">File reference is stored. Upload to Supabase Storage for production use.</p></div>
            </div>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Upload', type: 'primary', action: '(async () => { await app.uploadContract(); })()' }
        ]);
    };

    const uploadContract = async () => {
        const _titleEl = document.getElementById('contract-title');
        if (!_titleEl) { UI.toast.error('Contract title field not found.'); return; }
        const title = _titleEl.value.trim();
        if (!title) { UI.toast.error('Contract title is required.'); return; }
        const customerId = document.getElementById('contract-customer-id')?.value.trim() ?? '';
        const fileInput = document.getElementById('contract-file');
        const fileName = fileInput.files?.[0]?.name || null;
        await AppDataStore.create('contracts', {
            title, customer_id: customerId ? parseInt(customerId) : null,
            file_name: fileName, file_url: fileName ? `local:${fileName}` : null,
            status: 'draft', created_by: _state.cu?.id || 1, created_at: new Date().toISOString()
        });
        UI.hideModal();
        UI.toast.success('Contract uploaded.');
        await showContractsView(document.getElementById('content-viewport'));
    };

    const sendContractForSigning = async (contractId) => {
        const token = 'tok-' + Math.random().toString(36).substr(2, 16) + Date.now().toString(36);
        await AppDataStore.update('contracts', contractId, { status: 'sent', signing_token: token, sent_at: new Date().toISOString() });
        const signingUrl = `${window.location.origin}/sign.html?token=${token}`;
        UI.showModal('Contract Sent for Signing', `
            <div>
                <p>Share this signing link with the customer:</p>
                <div style="display:flex; gap:8px;">
                    <input type="text" value="${signingUrl}" readonly id="signing-url-display" style="flex:1; padding:8px; border:1px solid var(--border); border-radius:6px; font-size:13px;">
                    <button class="btn primary" onclick="navigator.clipboard.writeText(document.getElementById('signing-url-display').value).then(()=>UI.toast.success('Copied!'))">Copy</button>
                </div>
            </div>
        `, [{ label: 'Done', type: 'primary', action: 'UI.hideModal()' }]);
    };

    const copySigningLink = async (contractId) => {
        const contract = await AppDataStore.getById('contracts', contractId);
        if (!contract?.signing_token) { UI.toast.error('No signing token found.'); return; }
        const url = `${window.location.origin}/sign.html?token=${contract.signing_token}`;
        navigator.clipboard.writeText(url).then(() => UI.toast.success('Signing link copied!')).catch(() => UI.toast.info(`Link: ${url}`));
    };

    const showContractDetail = async (contractId) => {
        const c = await AppDataStore.getById('contracts', contractId);
        if (!c) return;
        UI.showModal(`Contract: ${c.title}`, `
            <div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
                    <div><span style="color:var(--gray-500);">Status:</span> ${renderContractStatusBadge(c.status)}</div>
                    <div><span style="color:var(--gray-500);">Signed by:</span> <strong>${c.signer_name || '—'}</strong></div>
                    <div><span style="color:var(--gray-500);">Signed at:</span> <span>${c.signed_at ? new Date(c.signed_at).toLocaleString() : '—'}</span></div>
                    <div><span style="color:var(--gray-500);">File:</span> ${c.file_name || '—'}</div>
                </div>
                ${c.signature_data_url ? `
                    <div>
                        <p style="font-weight:500; margin-bottom:8px;">Signature:</p>
                        <div style="border:1px solid var(--gray-200); border-radius:8px; padding:8px; background:#fafafa;">
                            <img loading="lazy" decoding="async" src="${c.signature_data_url}" style="max-width:100%; height:auto; max-height:150px;">
                        </div>
                    </div>
                ` : ''}
            </div>
        `, [{ label: 'Close', type: 'secondary', action: 'UI.hideModal()' }]);
    };

    const renderCustomerContractsTab = async (customer, containerId = 'profile-tab-content') => {
        const contracts = (await AppDataStore.getAll('contracts').catch(() => [])).filter(c => c.customer_id == customer.id);
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = `
            <div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                    <h4 style="margin:0;">Contracts</h4>
                    <button class="btn secondary" onclick="app.openUploadContractModal('customer', ${customer.id})"><i class="fas fa-plus"></i> Upload Contract</button>
                </div>
                ${contracts.length === 0 ? '<p style="color:var(--gray-400); text-align:center; padding:40px 0;">No contracts yet.</p>' : `
                    <div style="display:flex; flex-direction:column; gap:8px;">
                        ${contracts.map(c => `
                            <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 16px; background:var(--gray-50); border-radius:8px; border:1px solid var(--gray-200);">
                                <div>
                                    <strong>${c.title}</strong>
                                    <span style="margin-left:8px;">${renderContractStatusBadge(c.status)}</span>
                                    <div style="font-size:12px; color:var(--gray-400); margin-top:2px;">${c.file_name || ''} ${c.created_at ? '· '+new Date(c.created_at).toLocaleDateString() : ''}</div>
                                </div>
                                <div style="display:flex; gap:6px;">
                                    ${c.status === 'draft' ? `<button class="btn secondary" style="font-size:12px; padding:4px 10px;" onclick="app.sendContractForSigning(${c.id})">Send</button>` : ''}
                                    ${c.status === 'sent' ? `<button class="btn secondary" style="font-size:12px; padding:4px 10px;" onclick="app.copySigningLink(${c.id})">Copy Link</button>` : ''}
                                    ${c.status === 'signed' ? `<button class="btn secondary" style="font-size:12px; padding:4px 10px;" onclick="app.showContractDetail(${c.id})">View</button>` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `}
            </div>
        `;
    };

    // ========== CUSTOM FIELDS ==========

    const showCustomFieldsAdmin = async (container) => {
        _state.cv = 'custom_fields';
        const defs = await AppDataStore.getAll('custom_field_definitions').catch(() => []);
        const prospectFields = defs.filter(d => d.entity_type === 'prospect');
        const customerFields = defs.filter(d => d.entity_type === 'customer');
        if (_reactFormsOn('__REACT_CUSTOMFIELDS', 'mountCustomFieldsAdmin')) {
            try {
                container.innerHTML = '<div id="customfields-react-root"></div>';
                window.CRMReact.mountCustomFieldsAdmin(document.getElementById('customfields-react-root'), { prospectFields, customerFields });
                return;
            } catch (e) { console.warn('[react-customfields] mount failed → legacy:', e?.message || e); }
        }
        const renderFieldList = (fields) => fields.length === 0
            ? '<p style="color:var(--gray-400); font-size:13px; padding:8px 0;">No custom fields yet.</p>'
            : fields.map(f => `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:white; border:1px solid var(--gray-200); border-radius:8px; margin-bottom:6px;">
                    <div><strong style="font-size:14px;">${f.label}</strong><span style="color:var(--gray-400); font-size:12px; margin-left:8px;">${f.type}${f.is_required ? ' · required' : ''}</span></div>
                    <button class="btn-icon" style="color:var(--error);" onclick="app.deleteCustomFieldDefinition(${f.id})"><i class="fas fa-trash"></i></button>
                </div>
            `).join('');
        container.innerHTML = `
            <div style="padding:24px; max-width:800px; margin:0 auto;">
                <div style="margin-bottom:24px;">
                    <h1 style="font-size:24px; font-weight:700; margin:0;">Custom Fields</h1>
                    <p style="color:var(--gray-500); margin:4px 0 0;">Add custom data fields to prospects and customers. Fields appear in all create/edit forms.</p>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:24px;">
                    <div style="background:var(--gray-50); border:1px solid var(--gray-200); border-radius:12px; padding:20px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                            <h3 style="margin:0; font-size:16px;">Prospect Fields</h3>
                            <button class="btn secondary" style="font-size:13px; padding:6px 12px;" onclick="app.openCustomFieldModal('prospect')"><i class="fas fa-plus"></i> Add</button>
                        </div>
                        ${renderFieldList(prospectFields)}
                    </div>
                    <div style="background:var(--gray-50); border:1px solid var(--gray-200); border-radius:12px; padding:20px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                            <h3 style="margin:0; font-size:16px;">Customer Fields</h3>
                            <button class="btn secondary" style="font-size:13px; padding:6px 12px;" onclick="app.openCustomFieldModal('customer')"><i class="fas fa-plus"></i> Add</button>
                        </div>
                        ${renderFieldList(customerFields)}
                    </div>
                </div>
                <div style="margin-top:24px; padding:16px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; font-size:13px; color:#1e40af;">
                    <i class="fas fa-info-circle"></i> Custom field values appear in the Basic & Info tab of each customer/prospect profile.
                </div>
            </div>
        `;
    };

    const openCustomFieldModal = (entityType) => {
        UI.showModal(`Add Custom Field — ${entityType === 'prospect' ? 'Prospects' : 'Customers'}`, `
            <input type="hidden" id="cf-entity-type" value="${entityType}">
            <div style="display:flex; flex-direction:column; gap:16px;">
                <div><label style="display:block; font-weight:500; margin-bottom:6px;">Field Label</label>
                <input type="text" id="cf-label" class="form-control" placeholder="e.g. Preferred Language, Budget Range"></div>
                <div><label style="display:block; font-weight:500; margin-bottom:6px;">Field Type</label>
                <select id="cf-type" class="form-control" onchange="app.toggleDropdownOptions(this.value)">
                    <option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="dropdown">Dropdown</option>
                </select></div>
                <div id="cf-options-row" style="display:none;"><label style="display:block; font-weight:500; margin-bottom:6px;">Options (comma-separated)</label>
                <input type="text" id="cf-options" class="form-control" placeholder="Option A, Option B, Option C"></div>
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;"><input type="checkbox" id="cf-required"> <span>Required field</span></label>
            </div>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Add Field', type: 'primary', action: '(async () => { await app.saveCustomFieldDefinition(); })()' }
        ]);
    };

    const toggleDropdownOptions = (type) => {
        const row = document.getElementById('cf-options-row');
        if (row) row.style.display = type === 'dropdown' ? 'block' : 'none';
    };

    const saveCustomFieldDefinition = async () => {
        const _cfLabelEl = document.getElementById('cf-label');
        if (!_cfLabelEl) { UI.toast.error('Field label input not found.'); return; }
        const label = _cfLabelEl.value.trim();
        if (!label) { UI.toast.error('Field label is required.'); return; }
        const entityType = document.getElementById('cf-entity-type')?.value ?? '';
        const type = document.getElementById('cf-type')?.value ?? 'text';
        const fieldKey = label.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const optionsRaw = document.getElementById('cf-options')?.value || '';
        const options = type === 'dropdown' ? optionsRaw.split(',').map(o => o.trim()).filter(Boolean) : [];
        await AppDataStore.create('custom_field_definitions', {
            entity_type: entityType, label, field_key: fieldKey, type, options,
            is_required: document.getElementById('cf-required').checked,
            sort_order: 0, created_at: new Date().toISOString()
        });
        UI.hideModal();
        UI.toast.success('Custom field added.');
        await showCustomFieldsAdmin(document.getElementById('content-viewport'));
    };

    const deleteCustomFieldDefinition = async (fieldId) => {
        try {
            const def = await AppDataStore.getById('custom_field_definitions', fieldId);
            if (def) {
                const allVals = await AppDataStore.getAll('custom_field_values').catch(() => []);
                for (const v of allVals.filter(v => v.field_key === def.field_key && v.entity_type === def.entity_type))
                    await AppDataStore.delete('custom_field_values', v.id);
            }
            await AppDataStore.delete('custom_field_definitions', fieldId);
            UI.toast.success('Field removed.');
            await showCustomFieldsAdmin(document.getElementById('content-viewport'));
        } catch (err) {
            UI.toast.error('Delete failed: ' + (err.message || 'Unknown error'));
        }
    };

    const renderCustomFieldInputs = async (entityType, entityId = null) => {
        const defs = (await AppDataStore.getAll('custom_field_definitions').catch(() => [])).filter(d => d.entity_type === entityType);
        if (defs.length === 0) return '';
        let values = {};
        if (entityId) {
            const vals = (await AppDataStore.getAll('custom_field_values').catch(() => [])).filter(v => v.entity_type === entityType && v.entity_id == entityId);
            vals.forEach(v => { values[v.field_key] = v.value; });
        }
        const inputs = defs.map(def => {
            const val = values[def.field_key] || '';
            let input = '';
            if (def.type === 'dropdown') {
                input = `<select id="cf-input-${def.field_key}" class="form-control">${(def.options||[]).map(o=>`<option value="${o}" ${val===o?'selected':''}>${o}</option>`).join('')}</select>`;
            } else if (def.type === 'number') {
                input = `<input type="number" id="cf-input-${def.field_key}" class="form-control" value="${val}">`;
            } else if (def.type === 'date') {
                input = `<input type="date" id="cf-input-${def.field_key}" class="form-control" value="${val}">`;
            } else {
                input = `<input type="text" id="cf-input-${def.field_key}" class="form-control" value="${val}">`;
            }
            return `<div style="margin-bottom:12px;"><label style="display:block; font-weight:500; margin-bottom:4px; font-size:14px;">${def.label}${def.is_required?' <span style="color:var(--error);">*</span>':''}</label>${input}</div>`;
        }).join('');
        return `<div style="border-top:1px solid var(--gray-200); margin-top:16px; padding-top:16px;"><h4 style="font-size:13px; text-transform:uppercase; color:var(--gray-400); letter-spacing:0.5px; margin:0 0 12px;">Custom Fields</h4>${inputs}</div>`;
    };

    const saveCustomFieldValues = async (entityType, entityId) => {
        const defs = (await AppDataStore.getAll('custom_field_definitions').catch(() => [])).filter(d => d.entity_type === entityType);
        const existingVals = (await AppDataStore.getAll('custom_field_values').catch(() => [])).filter(v => v.entity_type === entityType && v.entity_id == entityId);
        for (const def of defs) {
            const input = document.getElementById(`cf-input-${def.field_key}`);
            if (!input) continue;
            const existing = existingVals.find(v => v.field_key === def.field_key);
            if (existing) {
                await AppDataStore.update('custom_field_values', existing.id, { value: input.value, updated_at: new Date().toISOString() });
            } else {
                await AppDataStore.create('custom_field_values', { entity_type: entityType, entity_id: entityId, field_key: def.field_key, value: input.value, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
            }
        }
    };

    const renderCustomFieldDisplay = async (entityType, entityId) => {
        const defs = (await AppDataStore.getAll('custom_field_definitions').catch(() => [])).filter(d => d.entity_type === entityType);
        if (defs.length === 0) return '';
        const vals = (await AppDataStore.getAll('custom_field_values').catch(() => [])).filter(v => v.entity_type === entityType && v.entity_id == entityId);
        const valueMap = {};
        vals.forEach(v => { valueMap[v.field_key] = v.value; });
        const rows = defs.map(def => `<div style="display:flex; justify-content:space-between; margin-bottom:8px;"><span style="color:var(--gray-500);">${def.label}:</span><strong>${valueMap[def.field_key] || '—'}</strong></div>`).join('');
        return `<div style="border-top:1px solid var(--gray-100); margin-top:16px; padding-top:16px;"><h5 style="font-size:13px; text-transform:uppercase; color:var(--gray-400); letter-spacing:0.5px; margin:0 0 12px;">Custom Fields</h5>${rows}</div>`;
    };

    // ========== CUSTOMER SELF-SERVICE PORTAL ==========

    const sendPortalLink = async (customerId) => {
        const customer = await AppDataStore.getById('customers', customerId);
        if (!customer) return;
        const token = 'portal-' + Math.random().toString(36).substr(2, 16) + '-' + Date.now().toString(36);
        const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await AppDataStore.create('portal_sessions', {
            customer_id: customerId, email: customer.email, token,
            expires_at: expires, created_at: new Date().toISOString()
        });
        const portalUrl = `${window.location.origin}/portal.html?token=${token}`;
        UI.showModal('Customer Portal Link', `
            <div>
                <p>Share this link with <strong>${customer.full_name}</strong>. It expires in 7 days.</p>
                <div style="display:flex; gap:8px; margin-bottom:12px;">
                    <input type="text" id="portal-link-input" value="${portalUrl}" readonly style="flex:1; padding:8px; border:1px solid var(--border); border-radius:6px; font-size:13px; background:var(--gray-50);">
                    <button class="btn primary" onclick="navigator.clipboard.writeText(document.getElementById('portal-link-input').value).then(()=>UI.toast.success('Copied!'))"><i class="fas fa-copy"></i></button>
                </div>
                <p style="font-size:12px; color:var(--gray-400);">The customer can view their activities, purchases, documents, and upcoming appointments.</p>
            </div>
        `, [{ label: 'Close', type: 'secondary', action: 'UI.hideModal()' }]);
    };

    // [CHUNK: referrals] 27 functions extracted to chunks/script-referrals.js — loaded role-gated by navigateTo().

    // [CHUNK: cases] 20 functions extracted to chunks/script-cases.js — loaded role-gated by navigateTo().

    Object.assign(window.app, {
        showLeadFormsView,
        openFormBuilderModal,
        addFormField,
        saveLeadForm,
        deleteLeadForm,
        copyFormLink,
        showFormSubmissions,
        processFormSubmission,
        showSurveysView,
        openSurveyBuilderModal,
        updateSurveyQuestion,
        saveSurvey,
        deleteSurvey,
        copySurveyLink,
        showSurveyResults,
        renderContractStatusBadge,
        showContractsView,
        openUploadContractModal,
        uploadContract,
        sendContractForSigning,
        copySigningLink,
        showContractDetail,
        renderCustomerContractsTab,
        showCustomFieldsAdmin,
        openCustomFieldModal,
        toggleDropdownOptions,
        saveCustomFieldDefinition,
        deleteCustomFieldDefinition,
        renderCustomFieldInputs,
        saveCustomFieldValues,
        renderCustomFieldDisplay,
        sendPortalLink,
    });
})();