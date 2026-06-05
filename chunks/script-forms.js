/**
 * CRM Lazy Chunk: Lead Forms, Surveys, Contracts, Custom Fields, Portal
 * Loaded on-demand when navigating to form-related views.
 * Extracted 2026-06-05 (~1164 lines). All self-contained, no private state reads.
 */
(() => {
    const _state = window._appState;
    const esc = (s) => window._crmUtils.escapeHtml(s);
    // ========== LEAD CAPTURE FORMS ==========

    const showLeadFormsView = async (container) => {
        _currentView = 'lead_forms';
        const forms = await AppDataStore.getAll('lead_forms').catch(() => []);
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
        const name = document.getElementById('form-name').value.trim();
        if (!name) { UI.toast.error('Form name is required.'); return; }
        const fields = [];
        document.querySelectorAll('#form-fields-list .form-field-row').forEach((row, i) => {
            const label = row.querySelector('.field-label').value.trim();
            const type = row.querySelector('.field-type').value;
            const required = row.querySelector('.field-required').checked;
            if (label) fields.push({ id: `field_${i}`, label, type, required });
        });
        if (fields.length === 0) { UI.toast.error('Add at least one field.'); return; }
        const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();
        await AppDataStore.create('lead_forms', {
            name, slug, title: name,
            description: document.getElementById('form-description').value.trim(),
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
                                <td style="padding:10px;">${name}</td>
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
        _currentView = 'surveys';
        const surveys = await AppDataStore.getAll('surveys').catch(() => []);
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
        const name = document.getElementById('survey-name').value.trim();
        if (!name) { UI.toast.error('Survey name is required.'); return; }
        await AppDataStore.create('surveys', {
            name, type: document.getElementById('survey-type').value,
            question: document.getElementById('survey-question').value.trim(),
            description: document.getElementById('survey-description').value.trim(),
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
        _currentView = 'contracts';
        const contracts = await AppDataStore.getAll('contracts').catch(() => []);
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
        const title = document.getElementById('contract-title').value.trim();
        if (!title) { UI.toast.error('Contract title is required.'); return; }
        const customerId = document.getElementById('contract-customer-id').value.trim();
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
        _currentView = 'custom_fields';
        const defs = await AppDataStore.getAll('custom_field_definitions').catch(() => []);
        const prospectFields = defs.filter(d => d.entity_type === 'prospect');
        const customerFields = defs.filter(d => d.entity_type === 'customer');
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
        const label = document.getElementById('cf-label').value.trim();
        if (!label) { UI.toast.error('Field label is required.'); return; }
        const entityType = document.getElementById('cf-entity-type').value;
        const type = document.getElementById('cf-type').value;
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

    // ── Core views that are always available in script.js ─────────────────
    // Everything else is in script-features.min.js and loaded on first use.
    const _CORE_VIEWS = new Set(['home', 'calendar', 'month']);

    // ── Lazy-chunk loader infrastructure (Code-Split Design Option A) ────
    // Each entry maps a viewId to a chunks/<name>.min.js file. The chunk is
    // a self-contained IIFE that reads only stable globals (window.AppDataStore,
    // window.UI, window._state.cu, window._crmUtils) and calls
    // Object.assign(window.app, { ... }) to attach its public surface.
    //
    // CURRENT STATUS: infrastructure in place, no chunks extracted yet.
    // First extraction (stock_take ~1,428 lines) needs a dedicated session to
    // audit IIFE closure dependencies. See chunks/README.md + docs/CODE_SPLIT_DESIGN.md.
    //
    // To add a chunk: move functions to chunks/<viewId>.js, ensure they only
    // touch stable globals, run build.mjs (it auto-picks up chunks/*.js), then
    // add the viewId entry below.
    const _CHUNK_VIEWS = {
        'stock_take':           { src: 'chunks/script-stock-take.min.js',  minLevel: null, exactLevels: [1, 15] },
        'egg_purchasing':       { src: 'chunks/script-egg.min.js',         minLevel: null, exactLevels: [1] },
        'boss_report':          { src: 'chunks/script-boss-report.min.js', minLevel: null, exactLevels: [1, 2] },
        'knowledge':            { src: 'chunks/script-knowledge.min.js',   minLevel: null, exactLevels: null },
        'formula_purchaser':    { src: 'chunks/script-formula.min.js',     minLevel: null, exactLevels: [1] },
        'marketing_automation': { src: 'chunks/script-marketing.min.js',   minLevel: null, exactLevels: [1, 2] },
        'marketing_lists':      { src: 'chunks/script-marketing.min.js',   minLevel: null, exactLevels: [1, 2] },
        'workflows':            { src: 'chunks/script-marketing.min.js',   minLevel: null, exactLevels: [1, 2] },
        'reports':              { src: 'chunks/script-reporting.min.js',   minLevel: null, exactLevels: [1, 2, 3, 4, 5] },
        'cases':                { src: 'chunks/script-cases.min.js',       minLevel: null, exactLevels: null },
        'referrals':            { src: 'chunks/script-referrals.min.js',   minLevel: null, exactLevels: null },
        // Phase: Ranking + Workflow Automation + Noticeboard (extracted 2026-06-05)
        'ranking':              { src: 'chunks/script-performance.min.js', minLevel: null, exactLevels: null },
        'performance':          { src: 'chunks/script-performance.min.js', minLevel: null, exactLevels: null },
        'noticeboard':          { src: 'chunks/script-performance.min.js',  minLevel: null, exactLevels: null },
        'whatsapp':             { src: 'chunks/script-whatsapp.min.js',    minLevel: 1,    exactLevels: [1, 2] },
        'ai_insights':          { src: 'chunks/script-ai.min.js',          minLevel: 1,    exactLevels: [1, 2] },
        'documents':            { src: 'chunks/script-documents.min.js', minLevel: null, exactLevels: null },
        'integrations':         { src: 'chunks/script-gcal.min.js',       minLevel: 1,    exactLevels: null },
    };

    // Predictive prefetch — after login, queue rel=prefetch for every chunk
    // the current role is allowed to load. Browser uses idle bandwidth; when
    // the user actually navigates to a chunked view, the chunk is already
    // in the HTTP cache and the network round-trip is gone.
    let _predictivePrefetchRan = false;
    const _runPredictivePrefetch = () => {
        if (_predictivePrefetchRan || !_state.cu) return;
        _predictivePrefetchRan = true;
        const schedule = (cb) =>
            (typeof requestIdleCallback === 'function'
                ? requestIdleCallback(cb, { timeout: 4000 })
                : setTimeout(cb, 1500));
        schedule(() => {
            try {
                const lvl = _getUserLevel(_state.cu);
                const manifest = window.__ASSET_MANIFEST || {};
                const seen = new Set();
                for (const def of Object.values(_CHUNK_VIEWS)) {
                    const ok = !def.exactLevels || def.exactLevels.includes(lvl);
                    if (!ok || seen.has(def.src)) continue;
                    seen.add(def.src);
                    const link = document.createElement('link');
                    link.rel = 'prefetch';
                    link.as = 'script';
                    link.href = manifest[def.src] || def.src;
                    document.head.appendChild(link);
                }
            } catch (e) { console.warn('predictive prefetch failed', e); }
        });
    };

    // In-flight promises keyed by chunk src URL — ensures each chunk is fetched once.
    const _chunkInFlight = new Map();
    const _loadChunkOnce = (src) => {
        if (_chunkInFlight.has(src)) return _chunkInFlight.get(src);
        const p = new Promise((resolve) => {
            const s = document.createElement('script');
            const manifest = window.__ASSET_MANIFEST || {};
            s.src = manifest[src] || src;
            s.async = false;
            s.onload = resolve;
            s.onerror = (e) => { console.warn('[chunk] failed to load', src, e); resolve(); };
            document.body.appendChild(s);
        });
        _chunkInFlight.set(src, p);
        return p;
    };
    // Expose _loadChunkOnce globally so retained stubs in script.js (e.g.
    // addWhatsAppButtonToProfile) can trigger lazy chunk loads without needing
    // to be inside the navigateTo flow.
    window._loadChunk = (src) => _loadChunkOnce(src);

    // One-shot promise-based loader for script-features.js.
    // Returns immediately if already loaded. Shows inline loading ring
    // in the viewport while waiting so the user sees feedback.
    const _loadFeatures = (() => {
        let _promise = null;
        return (viewport) => {
            if (window._appFeaturesLoaded) return Promise.resolve();
            if (!_promise) {
                if (viewport) {
                    viewport.innerHTML =
                        '<div style="display:flex;align-items:center;justify-content:center;' +
                        'height:200px;gap:12px;color:var(--text-secondary);">' +
                        '<i class="fas fa-circle-notch fa-spin" style="font-size:20px;color:var(--primary,#800020);"></i>' +
                        '<span style="font-size:15px;">Loading...</span></div>';
                }
                _promise = new Promise((resolve, reject) => {
                    const s = document.createElement('script');
                    // Resolve the content-hashed filename from the manifest injected
                    // by build.mjs into index.html (window.__ASSET_MANIFEST). Falls back
                    // to the canonical non-hashed name (no ?v= needed — Vercel serves
                    // the latest and the SW caches it stale-while-revalidate).
                    const _manifest = window.__ASSET_MANIFEST || {};
                    s.src = _manifest['script-features.min.js'] || 'script-features.min.js';
                    s.async = false; // preserve execution order
                    s.onload = () => { window._appFeaturesLoaded = true; resolve(); };
                    s.onerror = (e) => {
                        console.warn('[perf] script-features failed, falling back to script.js', e);
                        window._appFeaturesLoaded = true; // don't retry forever
                        resolve();
                    };
                    document.body.appendChild(s);
                });
            }
            return _promise;
        };
    })();

    const navigateTo = async (viewId) => {
        UI.hideModal();
        // Cancel any in-flight Supabase reads tied to the OUTGOING view so
        // their late-arriving responses can't overwrite the new view's cache
        // ~800ms after navigation. AppDataStore catches AbortError internally
        // and returns []; no exception leaks here.
        // No-op if AppDataStore isn't ready yet (first navigate during boot).
        try { if (window.AppDataStore && typeof window.AppDataStore.abortInflight === 'function') {
            window.AppDataStore.abortInflight('navigate:' + viewId);
        } } catch (_) {}
        // ── Lazy-load per-view chunk (Code-Split Design Option A) ────────────
        // If this view has a dedicated chunk registered in _CHUNK_VIEWS, fetch
        // it before attempting to render. _loadChunkOnce deduplicates — the
        // network request fires only the first time this view is visited.
        const _chunkDef = _CHUNK_VIEWS[viewId];
        if (_chunkDef) {
            const _userLevel = _state.cu ? _getUserLevel(_state.cu) : 99;
            const _allowed = !_chunkDef.exactLevels || _chunkDef.exactLevels.includes(_userLevel);
            if (_allowed) {
                await _loadChunkOnce(_chunkDef.src);
            }
        }
        // ── Lazy-load non-core views ──────────────────────────────────────────
        // script-features.min.js is only fetched when the user first navigates
        // away from home/calendar. After that it's cached + immutable.
        if (!_CORE_VIEWS.has(viewId) && !window._appFeaturesLoaded) {
            const vp = document.getElementById('content-viewport');
            await _loadFeatures(vp);
        }
        // Stock Take v2 teardown — when leaving the stock_take view, stop the
        // Supabase realtime channel and any active camera stream so we don't
        // pin a websocket / camera handle in the background.
        if (_currentView === 'stock_take' && viewId !== 'stock_take') {
            try { if (typeof window.app?.stStopRealtime === 'function') await window.app.stStopRealtime(); } catch (e) {}
            try { if (typeof window.app?._stCancelScanner === 'function') await window.app._stCancelScanner(); } catch (e) {}
        }
        // ── View HTML cache: save the outgoing view's DOM before we replace it.
        // Lets the user bounce back to it within TTL without paying the rebuild
        // cost. See _saveViewToCache near the top of the IIFE.
        if (_currentView && _currentView !== viewId && _CACHEABLE_VIEWS.has(_currentView)) {
            _saveViewToCache(_currentView, document.getElementById('content-viewport'));
        }
        _currentDetailView = null; // leaving any detail page — pull-to-refresh goes back to list
        // Strip mobile-home / mobile-calendar page backgrounds when leaving so
        // the beige fill doesn't bleed into other screens.
        if (viewId !== 'home') {
            document.getElementById('content-viewport')?.classList.remove('mhome-active');
        }
        if (viewId !== 'calendar' && viewId !== 'month') {
            document.getElementById('content-viewport')?.classList.remove('mcal-active');
        }
        if (viewId !== 'prospects' && viewId !== 'customers') {
            document.getElementById('content-viewport')?.classList.remove('mprospects-active');
        }
        // Stamp the navigation time so initSync can suppress the SWR
        // revalidation refresh that would otherwise blow away the DOM 1–3s
        // after the page paints (visible flash / lost scroll position).
        _lastNavigatedAt = Date.now();
        document.querySelectorAll('.nav-links li').forEach(li => {
            li.classList.toggle('active', li.getAttribute('data-view') === viewId);
        });
        document.querySelectorAll('.sb-nav-item[data-view]').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-view') === viewId);
        });

        // ── View Transitions API (Chrome 111+ / Safari 18+) ─────────────────
        // Wraps the view-swap in a cross-fade transition. Browser captures the
        // outgoing DOM, renders the new view, then animates between them using
        // GPU-composited cross-fade — no main-thread blocking. Users perceive
        // the app as feeling "native" even on slow connections because the exit
        // animation plays instantly while the new view renders.
        // Opt-out list: views that clear then refill DOM with the same content
        // (e.g. month nav) skip transitions to avoid a flash.
        const _NO_TRANSITION_VIEWS = new Set(['month']);
        const _withViewTransition = async (fn) => {
            const skip = typeof document.startViewTransition !== 'function'
                || _currentView === viewId
                || _NO_TRANSITION_VIEWS.has(viewId)
                || document.visibilityState !== 'visible';
            if (skip) return fn();
            // Track whether the callback actually ran inside the transition.
            // If startViewTransition aborts BEFORE invoking the callback
            // (e.g. "InvalidStateError: Transition was aborted because of
            // invalid state" when the document was just hidden or another
            // transition is mid-flight), the DOM never updates and the user
            // is stuck on the prior view. We detect that case and run fn()
            // directly so the bottom-nav tap always navigates.
            let callbackRan = false;
            const wrapped = async () => { callbackRan = true; return await fn(); };
            try {
                const t = document.startViewTransition(wrapped);
                // Silence unhandled rejections from ALL transition promises —
                // any may reject if the transition is aborted by another
                // in-flight transition or by the document becoming hidden.
                // Must attach .catch on updateCallbackDone synchronously here:
                // a later try/catch on `await` is too late to suppress the
                // unhandled-rejection event on the original promise.
                t.finished.catch(() => {});
                t.ready.catch(() => {});
                t.updateCallbackDone.catch(() => {});
                // Await DOM update (faster than .finished which waits for animation).
                await t.updateCallbackDone;
            } catch (_) {
                if (!callbackRan) await fn();
            }
        };

        // Update document title BEFORE awaiting the view render. If the render
        // hangs or throws, the browser tab title still reflects the user's
        // last click — previously the title would lag on the prior view.
        const VIEW_TITLES = {
            home: 'Home',
            calendar: 'Calendar', month: 'Calendar', prospects: 'Prospects & Customers',
            pipeline: 'Pipeline', agents: 'Consultants', promotions: 'Monthly Promotion',
            marketing_automation: 'Marketing Automation', reports: 'Reporting KPI',
            documents: 'Documents', protection: 'Protection Monitoring', import: 'Import / Export',
            integrations: 'Integrations', referrals: 'Referral Relationships', cases: 'Success Cases',
            marketing_lists: 'Marketing Lists', ranking: 'Ranking Performance', performance: 'Ranking Performance',
            workflows: 'Workflow Automation', booking_settings: 'Booking Scheduler',
            lead_forms: 'Lead Capture Forms', surveys: 'NPS Surveys', contracts: 'Contracts',
            custom_fields: 'Custom Fields', settings: 'Settings', milestones: 'Milestones',
            fude: '福运相随', noticeboard: '公告栏 Noticeboard',
            egg_purchasing: 'Egg Purchasing', standard_functions: 'Standard Functions',
            formula_purchaser: 'Formula Purchaser', purchases_history: 'Purchases History',
            stock_take: 'Stock Take', boss_report: 'Boss Report', ai: 'AI Insights', security: 'Security', admin: 'Admin',
            risk: 'Attrition Risk', nps: 'NPS Surveys',
            knowledge: 'Knowledge HQ',
            org_chart: 'Org Chart Consultant',
        };
        document.title = `${VIEW_TITLES[viewId] || viewId} — 悅客匯 CRM`;

        // ── URL hash deep linking ──────────────────────────────────────────
        // Keeps the address bar in sync so users can bookmark, share, or use
        // browser back/forward to reach a specific view. 'month' canonicalises
        // to 'calendar' so the URL stays human-readable. replaceState (not
        // pushState) avoids flooding the history stack on rapid tab-switching.
        try {
            const _hashId = (viewId === 'month') ? 'calendar' : viewId;
            const _targetHash = '#' + _hashId;
            if (location.hash !== _targetHash) {
                history.replaceState({ view: _hashId }, '', _targetHash);
            }
        } catch (_) { /* no-op in environments that restrict history API */ }

        const viewport = document.getElementById('content-viewport');

        // ── View HTML cache: try to restore from a fresh cached DOM.
        // On a hit, we skip the entire showXView() rebuild — the dominant
        // cost (200-800 ms) of a tab switch. 'calendar' canonicalises to
        // 'month' (matches the _currentView assignment below).
        {
            const cacheKey = (viewId === 'calendar') ? 'month' : viewId;
            if (_CACHEABLE_VIEWS.has(cacheKey) && _restoreViewFromCache(cacheKey, viewport)) {
                _currentView = cacheKey;
                if (isMobile()) {
                    (window.app.updateBottomNavActive || (() => {}))(viewId);
                    setTimeout(applyMobileTableLabels, 200);
                }
                return;
            }
        }

        await _withViewTransition(async () => {
        if (viewId === 'home') {
            _currentView = 'home';
            await (window.app.showMobileHomeView || (() => {}))(viewport);
        } else if (viewId === 'calendar' || viewId === 'month') {
            _currentView = 'month';
            if (isMobile()) {
                await (window.app.showMobileCalendarView || (() => {}))(viewport);
            } else {
                await showCalendarView(viewport);
            }
        } else if (viewId === 'prospects') {
            _currentView = 'prospects';
            if (isMobile()) {
                await (window.app.showMobileProspectsView || (() => {}))(viewport);
            } else {
                await showProspectsView(viewport);
            }
        } else if (viewId === 'pipeline') {
            _currentView = 'pipeline';
            // Skeleton is painted synchronously before the first await inside
            // showPipelineView, so the user sees it instantly. Heavy scoring
            // runs in the background; navigateTo returns after skeleton paint.
            showPipelineView(viewport).catch(e => console.warn('pipeline failed:', e));
        } else if (viewId === 'agents') {
            _currentView = 'agents';
            await showAgentsView(viewport);
        } else if (viewId === 'promotions') {
            _currentView = 'promotions';
            await showMonthlyPromotionView(viewport);
        } else if (viewId === 'marketing_automation') {
            _currentView = 'marketing_automation';
            await (window.app.showMarketingAutomationView || (() => {}))(viewport);
        } else if (viewId === 'reports') {
            _currentView = 'reports';
            // Shell is painted synchronously before the first await inside
            // showKPIDashboard; navigateTo returns after shell paint.
            (window.app.showKPIDashboard || (() => Promise.resolve()))(viewport).catch(e => console.warn('KPI dashboard failed:', e));
        } else if (viewId === 'documents') {
            _currentView = 'documents';
            await (window.app.showDocumentManagementView || (() => {}))(viewport);
        } else if (viewId === 'protection') {
            _currentView = 'protection';
            await showProtectionMonitoringView(viewport);
        } else if (viewId === 'import') {
            _currentView = 'import';
            await showImportDashboard(viewport);
        } else if (viewId === 'integrations') {
            _currentView = 'integrations';
            await (window.app.showIntegrationHub || (() => {}))(viewport);
        } else if (viewId === 'referrals') {
            _currentView = 'referrals';
            // Same pattern as pipeline — skeleton paints synchronously, data loads async.
            (window.app.showReferralsView || (() => Promise.resolve()))(viewport).catch(e => console.warn('referrals failed:', e));
        } else if (viewId === 'cases') {
            _currentView = 'cases';
            await (window.app.showCasesView               || (() => {}))(viewport);
        } else if (viewId === 'marketing_lists') {
            _currentView = 'marketing_lists';
            await (window.app.showMarketingListsView      || (() => {}))(viewport);
        } else if (viewId === 'ranking' || viewId === 'performance') {
            _currentView = 'ranking';
            await (window.app.showRankingPerformanceView || (() => {}))(viewport);
        } else if (viewId === 'workflows') {
            // Redirect legacy workflows route to Marketing Automation → Automation tab
            _currentMarketingTab = 'automation';
            _currentView = 'marketing_automation';
            await (window.app.showMarketingAutomationView || (() => {}))(viewport);
        } else if (viewId === 'booking_settings') {
            _currentView = 'booking_settings';
            await showBookingSettingsView(viewport);
        } else if (viewId === 'lead_forms') {
            _currentView = 'lead_forms';
            await showLeadFormsView(viewport);
        } else if (viewId === 'surveys') {
            _currentView = 'surveys';
            await showSurveysView(viewport);
        } else if (viewId === 'contracts') {
            _currentView = 'contracts';
            await showContractsView(viewport);
        } else if (viewId === 'custom_fields') {
            _currentView = 'custom_fields';
            await showCustomFieldsAdmin(viewport);
        } else if (viewId === 'settings') {
            _currentView = 'settings';
            showSettingsView(viewport);
        } else if (viewId === 'milestones') {
            _currentView = 'milestones';
            await showMilestonesView(viewport);
        } else if (viewId === 'fude') {
            _currentView = 'fude';
            await showFudeView(viewport);
        } else if (viewId === 'noticeboard') {
            _currentView = 'noticeboard';
            await (window.app.showNoticeboardView || (() => {}))(viewport);
        } else if (viewId === 'whatsapp') {
            _currentView = 'whatsapp';
            await (window.app.showWhatsAppIntegration || (() => {}))(viewport);
        } else if (viewId === 'ai_insights' || viewId === 'ai_prediction') {
            _currentView = 'ai_insights';
            await (window.app.showAIInsightsDashboard || (() => {}))(viewport);
        } else if (viewId === 'integrations') {
            _currentView = 'integrations';
            await (window.app.showIntegrationHub || (() => {}))(viewport);
        } else if (viewId === 'egg_purchasing') {
            // Super Admin only gate — bounce non-admins to calendar
            if (!isSystemAdmin(_state.cu)) {
                UI.toast.error('Super Admin only');
                await navigateTo('calendar');
                return;
            }
            _currentView = 'egg_purchasing';
            await (window.app.showEggPurchasingView || (() => {}))(viewport);
        } else if (viewId === 'standard_functions') {
            if (!isSystemAdmin(_state.cu)) {
                UI.toast.error('Super Admin only');
                await navigateTo('calendar');
                return;
            }
            _currentView = 'standard_functions';
            await showStandardFunctionsView(viewport);
        } else if (viewId === 'formula_purchaser') {
            if (!isSystemAdmin(_state.cu)) {
                UI.toast.error('Super Admin only');
                await navigateTo('calendar');
                return;
            }
            _currentView = 'formula_purchaser';
            await (window.app.showFormulaPurchaserView    || (() => {}))(viewport);
        } else if (viewId === 'purchases_history') {
            _currentView = 'purchases_history';
            await showPurchasesHistoryView(viewport);
        } else if (viewId === 'knowledge') {
            _currentView = 'knowledge';
            await (window.app.showKnowledgeView || (() => {}))(viewport);
        } else if (viewId === 'stock_take') {
            // Level 1 (Super Admin) or Level 15 (Stock Take Staff). Staff get
            // a restricted tab strip inside the module — see showStockTakeView.
            if (!canAccessStockTake(_state.cu)) {
                UI.toast.error('Not permitted');
                await navigateTo('calendar');
                return;
            }
            _currentView = 'stock_take';
            await (window.app.showStockTakeView || (() => {}))(viewport);
        } else if (viewId === 'boss_report') {
            if (!isSystemAdmin(_state.cu)) {
                UI.toast.error('Super Admin only');
                await navigateTo('calendar');
                return;
            }
            _currentView = 'boss_report';
            await (window.app.showBossReportView || (() => {}))(viewport);
        } else if (viewId === 'org_chart') {
            // Org Chart Consultant — admin / level 1-2 only.
            // Implementation is top-level (post-IIFE) so we call via window.app.
            const lvl = _state.cu ? _getUserLevel(_state.cu) : 99;
            if (lvl > 2) {
                UI.toast.error('Admin only');
                await navigateTo('calendar');
                return;
            }
            _currentView = 'org_chart';
            if (typeof window.app?.showOrgChartView === 'function') {
                await window.app.showOrgChartView(viewport);
            } else {
                viewport.innerHTML = '<div style="padding:24px;color:var(--gray-500);">Org Chart Consultant module is loading…</div>';
            }
        } else {
            viewport.innerHTML = `
                <div class="placeholder-view">
                    <h1>${viewId.toUpperCase()}</h1>
                    <p>Phase ${getViewPhase(viewId)} Implementation: ${viewId} module interface.</p>
                    <button class="btn primary" onclick="app.showRoadmap()">View Roadmap</button>
                </div>
            `;
        }

        // Silent nav switch — previous info toast was firing on every click, spamming
        // the DOM with toast nodes + timers and contributing to the perceived lag.
        // (document.title was set at the top of this function — see VIEW_TITLES.)
        }); // end _withViewTransition

        // Mobile: update bottom nav active state + apply table card labels
        if (isMobile()) {
            (window.app.updateBottomNavActive || (() => {}))(viewId);
            // Small delay so DOM is painted before we label tds
            setTimeout(applyMobileTableLabels, 200);
        }
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