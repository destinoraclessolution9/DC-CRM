/**
 * CRM Lazy Chunk: Import System + Follow-up Monitoring & Reassignment
 * Covers: Import dashboard, CSV/Excel import wizard, Follow-up monitoring,
 *   agent reassignment, protection monitoring view.
 * Loaded on-demand when navigating to import/protection views.
 * Extracted 2026-06-05 (~1986 lines).
 */
(() => {
    const _state = window._appState;
    const _utils = window._crmUtils;
    const esc     = (...a) => _utils.escapeHtml(...a);
    const escapeHtml = esc;
    const getVisibleUserIds = (u) => _utils.getVisibleUserIds(u);
    const isSystemAdmin        = (u) => _utils.isSystemAdmin(u || _state.cu);
    const isTeamLeaderOrAbove  = (u) => _utils.isTeamLeaderOrAbove(u || _state.cu);
    const isAgent              = (u) => _utils.isAgent(u || _state.cu);
    const _getUserLevel        = (u) => _utils.getUserLevel(u);
    const navigateTo           = (v) => window.app.navigateTo(v);
    let _currentUser = _state.cu;
    window._syncImportUser = () => { _currentUser = _state.cu; };

// ========== PHASE 13: IMPORT SYSTEM FUNCTIONS ==========

let _currentImportStep = 1;
let _importData = { file: null, fileName: null, fileSize: null, rows: 0, headers: ['Full Name', 'Phone Number', 'Email', 'IC Number', 'Date of Birth', 'Occupation', 'Income Range', 'Address', 'City', 'State', 'Postal Code', 'Ming Gua'], data: [], importType: 'prospects', mapping: {}, validation: { valid: 0, warnings: 0, errors: 0 }, duplicates: { total: 0 }, assignment: { assignTo: 'myself' } };

const showImportDashboard = async (container) => {
    container.innerHTML = `
        <div class="import-view">
            <div class="import-header">
                <div>
                    <h1>Import / Export & Data Management</h1>
                    <p>Import data from files or export your CRM data for backup and analysis</p>
                </div>
                <div class="import-header-actions">
                    <button class="btn primary" onclick="app.openImportWizard()"><i class="fas fa-upload"></i> IMPORT NEW DATA</button>
                    <button class="btn secondary" onclick="app.openTemplatesModal()"><i class="fas fa-download"></i> DOWNLOAD TEMPLATES</button>
                    <button class="btn secondary" onclick="app.showImportHistory()"><i class="fas fa-history"></i> VIEW IMPORT HISTORY</button>
                </div>
            </div>

            <div class="recent-imports" style="margin-bottom:32px;">
                <h3>Recent Imports</h3>
                <div class="imports-table-container">
                    <table class="imports-table">
                        <thead><tr><th scope="col">File Name</th><th scope="col">Type</th><th scope="col">Records</th><th scope="col">Success %</th><th scope="col">Status</th><th scope="col">Date</th><th scope="col">Actions</th></tr></thead>
                        <tbody id="imports-table-body">${await renderRecentImports()}</tbody>
                    </table>
                </div>
            </div>

            <div class="recent-imports">
                <h3>Data Export</h3>
                <p style="color:var(--gray-500);margin-bottom:16px;font-size:14px;">Download your CRM data as CSV or Excel. Access is restricted to authorized roles only.</p>
                <div class="imports-table-container">
                    <table class="imports-table">
                        <thead><tr><th scope="col">Data Type</th><th scope="col">Description</th><th scope="col" style="width:180px">Export</th></tr></thead>
                        <tbody>
                            <tr>
                                <td><strong><i class="fas fa-users" style="color:var(--primary-600);margin-right:8px;"></i>Prospects</strong></td>
                                <td>All prospect records with full profile details</td>
                                <td><button class="btn secondary btn-sm" onclick="app.exportData('prospects','csv')"><i class="fas fa-file-csv"></i> CSV</button> <button class="btn secondary btn-sm" onclick="app.exportData('prospects','xlsx')"><i class="fas fa-file-excel"></i> Excel</button></td>
                            </tr>
                            <tr>
                                <td><strong><i class="fas fa-calendar-check" style="color:var(--primary-600);margin-right:8px;"></i>Prospects + Activities</strong></td>
                                <td>Full prospect profiles with complete activity history (multi-sheet Excel)</td>
                                <td><button class="btn secondary btn-sm" onclick="app.exportData('prospects_activities','xlsx')"><i class="fas fa-file-excel"></i> Excel</button></td>
                            </tr>
                            <tr>
                                <td><strong><i class="fas fa-user-check" style="color:var(--success);margin-right:8px;"></i>Customers</strong></td>
                                <td>All customer records including pipeline & lifetime value</td>
                                <td><button class="btn secondary btn-sm" onclick="app.exportData('customers','csv')"><i class="fas fa-file-csv"></i> CSV</button> <button class="btn secondary btn-sm" onclick="app.exportData('customers','xlsx')"><i class="fas fa-file-excel"></i> Excel</button></td>
                            </tr>
                            <tr>
                                <td><strong><i class="fas fa-user-tie" style="color:var(--warning);margin-right:8px;"></i>Consultants / Agents</strong></td>
                                <td>All consultant and agent profiles with roles and license info</td>
                                <td><button class="btn secondary btn-sm" onclick="app.exportData('agents','csv')"><i class="fas fa-file-csv"></i> CSV</button> <button class="btn secondary btn-sm" onclick="app.exportData('agents','xlsx')"><i class="fas fa-file-excel"></i> Excel</button></td>
                            </tr>
                            <tr>
                                <td><strong><i class="fas fa-box" style="color:var(--gray-600);margin-right:8px;"></i>Products</strong></td>
                                <td>Products marketing list</td>
                                <td><button class="btn secondary btn-sm" onclick="app.exportData('products','csv')"><i class="fas fa-file-csv"></i> CSV</button> <button class="btn secondary btn-sm" onclick="app.exportData('products','xlsx')"><i class="fas fa-file-excel"></i> Excel</button></td>
                            </tr>
                            <tr>
                                <td><strong><i class="fas fa-calendar-alt" style="color:var(--gray-600);margin-right:8px;"></i>Events</strong></td>
                                <td>Events marketing list</td>
                                <td><button class="btn secondary btn-sm" onclick="app.exportData('events','csv')"><i class="fas fa-file-csv"></i> CSV</button> <button class="btn secondary btn-sm" onclick="app.exportData('events','xlsx')"><i class="fas fa-file-excel"></i> Excel</button></td>
                            </tr>
                            <tr>
                                <td><strong><i class="fas fa-tags" style="color:var(--gray-600);margin-right:8px;"></i>Promotions</strong></td>
                                <td>Promotion packages marketing list</td>
                                <td><button class="btn secondary btn-sm" onclick="app.exportData('promotions','csv')"><i class="fas fa-file-csv"></i> CSV</button> <button class="btn secondary btn-sm" onclick="app.exportData('promotions','xlsx')"><i class="fas fa-file-excel"></i> Excel</button></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
`;
};

const renderRecentImports = async () => {
    const imports = (await AppDataStore.getAll('import_jobs')).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);
    if (imports.length === 0) return `<tr><td colspan="7" style="text-align:center;padding:40px;"><i class="fas fa-cloud-upload-alt" style="font-size:48px;color:var(--gray-300);display:block;margin-bottom:16px;"></i><h3>No imports yet</h3><p>Click "IMPORT NEW DATA" to start your first import</p></td></tr>`;
    return imports.map(imp => {
        const pct = imp.total_rows > 0 ? Math.round((imp.valid_rows / imp.total_rows) * 100) : 0;
        return `<tr><td><strong>${imp.file_name}</strong></td><td>${imp.import_type}</td><td>${imp.total_rows} (${imp.created_records} new)</td><td>${pct}%</td><td><span class="import-status status-${imp.status}">${imp.status.toUpperCase()}</span></td><td>${UI.formatDate(imp.created_at)}</td><td><button class="btn-icon" onclick="app.viewImportDetails(${imp.id})" title="View"><i class="fas fa-eye"></i></button><button class="btn-icon" onclick="app.downloadImportLog(${imp.id})" title="Download Log"><i class="fas fa-download"></i></button></td></tr>`;
    }).join('');
};

const openImportWizard = async () => {
    // R9: Only system admin, marketing manager, or team leader may import
    const u = _currentUser;
    const canImport = isTeamLeaderOrAbove(u);
    if (!canImport) { UI.toast.error('You do not have permission to import data.'); return; }

    _currentImportStep = 1;
    _importData = {
        file: null, fileName: null, fileSize: null, rows: 0,
        headers: [], data: [], importType: 'prospects',
        mapping: {},
        validation: { valid: 0, warnings: 0, errors: 0 },
        validationResults: [],
        duplicates: { total: 0, byPhone: 0, byEmail: 0, byIc: 0, list: [] },
        assignment: { assignTo: 'myself' }
    };
    await renderImportStep(1);
};

const getWizardStepsHtml = (active) => {
    const steps = ['Upload', 'Map Fields', 'Validate', 'Duplicates', 'Import'];
    return `<div class="wizard-steps">${steps.map((s, i) => `<div class="wizard-step ${i + 1 < active ? 'completed' : i + 1 === active ? 'active' : ''}" data-step="${i + 1}">${i + 1}. ${s}</div>`).join('')}</div>`;
};

const updateWizardModal = (content) => {
    const overlay = document.getElementById('global-modal-overlay');
    if (overlay) { const box = overlay.querySelector('.modal-box'); if (box) box.innerHTML = content; }
};

const renderImportStep = async (step) => {
    _currentImportStep = step;
    let content = '';
    if (step === 1) content = await getStep1Html();
    else if (step === 2) content = await getStep2Html();
    else if (step === 3) content = await getStep3Html();
    else if (step === 4) content = await getStep4Html();
    else if (step === 5) content = await getStep5Html();
    if (step === 1) UI.showModal('Excel Import Wizard', content, []);
    else updateWizardModal(content);
};

const getStep1Html = async () => `
        <div class="import-wizard">
            ${getWizardStepsHtml(1)}
            <div class="step-content">
                <h3>Step 1: Upload File</h3>
                <div class="upload-area-large" id="import-dropzone" ondragover="event.preventDefault()" ondrop="app.handleImportFileDrop(event)">
                    <i class="fas fa-cloud-upload-alt"></i>
                    <h4>Click or Drag Excel file to upload</h4>
                    <p>Supported formats: .xlsx, .xls, .csv</p>
                    <p class="file-limit">Max file size: 10MB</p>
                    <input type="file" id="import-file-input" accept=".xlsx,.xls,.csv" style="display:none" onchange="app.handleImportFileSelect(event)">
                    <button class="btn primary" onclick="document.getElementById('import-file-input').click()">Browse Files</button>
                </div>
                <div id="file-info" style="display:none;margin-top:20px;"></div>
                <div style="margin-top:20px;"><label class="checkbox-label"><input type="checkbox" id="first-row-header" checked> First row contains headers</label></div>
            </div>
            <div class="wizard-footer">
                <button class="btn secondary" onclick="UI.hideModal()">Cancel</button>
                <button class="btn primary" id="step1-next" onclick="app.importNextStep()" disabled>Next: Field Mapping</button>
            </div>
        </div>
    `;

const getStep2Html = async () => `
        <div class="import-wizard">
            ${getWizardStepsHtml(2)}
            <div class="step-content">
                <h3>Step 2: Field Mapping</h3>
                <div class="import-type-selector"><label>Import Type:</label>
                    <select id="import-type" class="form-control" style="width:200px" onchange="app.updateImportType(this.value)">
                        <option value="prospects" ${_importData.importType === 'prospects' ? 'selected' : ''}>Prospects</option>
                        <option value="customers" ${_importData.importType === 'customers' ? 'selected' : ''}>Customers</option>
                        <option value="agents" ${_importData.importType === 'agents' ? 'selected' : ''}>Agents</option>
                        <option value="products" ${_importData.importType === 'products' ? 'selected' : ''}>Products (Marketing List)</option>
                        <option value="events" ${_importData.importType === 'events' ? 'selected' : ''}>Events (Marketing List)</option>
                        <option value="promotions" ${_importData.importType === 'promotions' ? 'selected' : ''}>Promotions (Marketing List)</option>
                    </select>
                </div>
                <div class="mapping-actions">
                    <button class="btn secondary btn-sm" onclick="app.autoMapFields()"><i class="fas fa-magic"></i> Auto-map all</button>
                    <button class="btn secondary btn-sm" onclick="app.clearMapping()"><i class="fas fa-times"></i> Clear all</button>
                </div>
                <div class="mapping-table-container">
                    <table class="mapping-table"><thead><tr><th scope="col">Excel Column</th><th scope="col">CRM Field</th></tr></thead>
                    <tbody>${renderMappingRows()}</tbody></table>
                </div>
            </div>
            <div class="wizard-footer">
                <button class="btn secondary" onclick="app.importPrevStep()">Back</button>
                <button class="btn primary" onclick="app.importNextStep()">Next: Validation</button>
            </div>
        </div>
    `;

const getStep3Html = async () => {
    const { valid, warnings, errors } = _importData.validation;
    const errorRows   = _importData.validationResults.filter(r => r.status === 'error');
    const warningRows = _importData.validationResults.filter(r => r.status === 'warning');

    const renderIssueRows = (rows, type) => {
        const issues = rows.flatMap(r =>
            (type === 'error' ? r.errors : r.warnings).map(issue =>
                `<tr class="${type}-row"><td>${r.rowIndex}</td><td>${issue.field}</td><td>${issue.msg}</td><td>${issue.suggestion}</td></tr>`
            )
        );
        return issues.length > 0 ? issues.join('') : `<tr><td colspan="4" style="text-align:center;color:var(--gray-400)">No ${type}s found</td></tr>`;
    };

    return `
        <div class="import-wizard">
            ${getWizardStepsHtml(3)}
            <div class="step-content">
                <h3>Step 3: Validation</h3>
                <div class="validation-summary">
                    <div class="validation-badge valid"><span class="badge-count">${valid}</span><span class="badge-label">Valid Rows</span></div>
                    <div class="validation-badge warning"><span class="badge-count">${warnings}</span><span class="badge-label">Warnings</span></div>
                    <div class="validation-badge error"><span class="badge-count">${errors}</span><span class="badge-label">Errors</span></div>
                </div>
                <div style="margin:16px 0">
                    <label class="checkbox-label"><input type="checkbox" id="stop-on-error"> Stop on first error</label>
                    <label class="checkbox-label"><input type="checkbox" id="continue-warnings" checked> Continue on warnings</label>
                </div>
                <div class="validation-log">
                    <h4>Error Log</h4>
                    <table class="error-table"><thead><tr><th scope="col">Row</th><th scope="col">Column</th><th scope="col">Error</th><th scope="col">Suggestion</th></tr></thead>
                    <tbody>${renderIssueRows(errorRows, 'error')}</tbody></table>
                    <h4 style="margin-top:16px">Warning Log</h4>
                    <table class="warning-table"><thead><tr><th scope="col">Row</th><th scope="col">Column</th><th scope="col">Warning</th><th scope="col">Action</th></tr></thead>
                    <tbody>${renderIssueRows(warningRows, 'warning')}</tbody></table>
                </div>
                <div class="validation-actions">
                    <button class="btn secondary" onclick="app.downloadErrorReport()"><i class="fas fa-download"></i> Download Error Report</button>
                </div>
            </div>
            <div class="wizard-footer">
                <button class="btn secondary" onclick="app.importPrevStep()">Back</button>
                <button class="btn primary" onclick="app.importNextStep()">Next: Duplicate Handling</button>
            </div>
        </div>
    `;
};

const getStep4Html = async () => {
    const { total, byPhone, byEmail, byIc, list } = _importData.duplicates;
    const reverseMap = buildReverseMapping();
    const nameCol  = reverseMap['full_name'];
    const phoneCol = reverseMap['phone'];

    const previewRows = list.slice(0, 20).map(d => {
        const existName  = d.existingRec?.full_name || '(unknown)';
        const existPhone = d.existingRec?.phone || '';
        const importName  = nameCol  !== undefined ? (d.row[nameCol]  || '').toString().trim() : '(no name)';
        const importPhone = phoneCol !== undefined ? (d.row[phoneCol] || '').toString().trim() : '';
        return `<tr>
            <td>${existName}${existPhone ? ' (' + existPhone + ')' : ''}</td>
            <td>${importName}${importPhone ? ' (' + importPhone + ')' : ''}</td>
            <td><span style="color:var(--gray-500);font-size:12px">Pending action below</span></td>
        </tr>`;
    }).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--gray-400)">No duplicates found</td></tr>';

    return `
        <div class="import-wizard">
            ${getWizardStepsHtml(4)}
            <div class="step-content">
                <h3>Step 4: Duplicate Handling</h3>
                <div class="duplicate-stats">
                    <div><strong>Total duplicates found:</strong> ${total}</div>
                    <div><strong>By phone number:</strong> ${byPhone}</div>
                    <div><strong>By email:</strong> ${byEmail}</div>
                    <div><strong>By IC number:</strong> ${byIc}</div>
                </div>
                <div class="duplicate-options" style="margin:16px 0">
                    <h4>Duplicate Handling</h4>
                    <label class="radio-label"><input type="radio" name="duplicate-action" value="skip" checked> Skip duplicates (keep existing)</label>
                    <label class="radio-label"><input type="radio" name="duplicate-action" value="update"> Update existing records</label>
                    <label class="radio-label"><input type="radio" name="duplicate-action" value="merge"> Create as new (merge)</label>
                </div>
                <div class="duplicate-preview">
                    <h4>Preview of affected records${list.length > 20 ? ' (showing first 20)' : ''}</h4>
                    <table class="preview-table"><thead><tr><th scope="col">Existing Record</th><th scope="col">Import Record</th><th scope="col">Status</th></tr></thead>
                    <tbody>${previewRows}</tbody></table>
                </div>
            </div>
            <div class="wizard-footer">
                <button class="btn secondary" onclick="app.importPrevStep()">Back</button>
                <button class="btn primary" onclick="app.importNextStep()">Next: Import</button>
            </div>
        </div>
    `;
};

const getStep5Html = async () => {
    const { valid, warnings, errors } = _importData.validation;
    const processable = valid + warnings;
    const dupCount    = _importData.duplicates.total;
    const assignLabel = _currentUser?.full_name || _currentUser?.name || 'Me';
    return `
        <div class="import-wizard">
            ${getWizardStepsHtml(5)}
            <div class="step-content">
                <h3>Step 5: Import</h3>
                <div class="summary-stats">
                    <div><strong>Total records in file:</strong> ${_importData.data.length}</div>
                    <div><strong>Valid / warning rows:</strong> ${processable}</div>
                    <div><strong>Error rows (will skip):</strong> ${errors}</div>
                    <div><strong>Potential duplicates:</strong> ${dupCount}</div>
                </div>
                <div class="assignment-options" style="margin:16px 0">
                    <h4>Assignment Options</h4>
                    <label class="radio-label"><input type="radio" name="assign-to" value="myself" checked onchange="document.getElementById('team-opts').style.display='none'"> Assign to myself (${assignLabel})</label>
                    <label class="radio-label"><input type="radio" name="assign-to" value="team" onchange="document.getElementById('team-opts').style.display='block'"> Assign to team</label>
                    <label class="radio-label"><input type="radio" name="assign-to" value="unassigned" onchange="document.getElementById('team-opts').style.display='none'"> Leave unassigned</label>
                    <div id="team-opts" style="display:none;margin-top:12px">
                        <select class="form-control" style="width:200px">${Array.from({length: 26}, (_, i) => String.fromCharCode(65 + i)).map(L => `<option>Team ${L}</option>`).join('')}</select>
                        <label class="checkbox-label" style="margin-top:8px"><input type="checkbox"> Distribute evenly</label>
                    </div>
                </div>
                <div class="import-options" style="margin:16px 0">
                    <h4>Import Options</h4>
                    <label class="checkbox-label"><input type="checkbox" checked> Send notification when complete</label>
                    <label class="checkbox-label"><input type="checkbox"> Create backup before import</label>
                    <label class="checkbox-label"><input type="checkbox" checked> Log all changes for audit</label>
                </div>
                <div id="progress-area" style="display:none;margin-top:16px">
                    <h4>Import Progress</h4>
                    <div class="progress-bar-container"><div class="progress-bar-fill" id="progress-bar" style="width:0%">0%</div></div>
                    <p id="progress-status">Preparing import...</p>
                </div>
            </div>
            <div class="wizard-footer">
                <button class="btn secondary" onclick="app.importPrevStep()">Back</button>
                <button class="btn primary" id="start-import-btn" onclick="app.startImport()"><i class="fas fa-play"></i> START IMPORT</button>
            </div>
        </div>
    `;
};

const renderMappingRows = () => {
    const headers = _importData.headers || [];
    const crmFields = getCRMFieldsForType(_importData.importType);
    return headers.map((header, index) => {
        const matched = autoMatchField(header, _importData.importType);
        return `<tr><td><strong>${header}</strong></td><td>
            <select class="form-control mapping-select" data-col="${index}" style="width:200px">
                <option value="">-- Ignore column --</option>
                ${crmFields.map(f => `<option value="${f.value}" ${f.value === matched ? 'selected' : ''}>${f.label}${f.required ? ' *' : ''}</option>`).join('')}
            </select></td></tr>`;
    }).join('');
};

const getCRMFieldsForType = (type) => {
    const common = [
        { value: 'full_name', label: 'Full Name', required: true },
        { value: 'phone', label: 'Phone', required: true },
        { value: 'email', label: 'Email', required: false },
        { value: 'ic_number', label: 'IC Number', required: false }
    ];
    const extraProspect = [
        { value: 'date_of_birth', label: 'Date of Birth' }, { value: 'occupation', label: 'Occupation' },
        { value: 'company_name', label: 'Company Name' }, { value: 'income_range', label: 'Income Range' },
        { value: 'address', label: 'Address' }, { value: 'city', label: 'City' },
        { value: 'state', label: 'State' }, { value: 'postal_code', label: 'Postal Code' },
        { value: 'ming_gua', label: 'Ming Gua' }, { value: 'gender', label: 'Gender' }
    ];
    if (type === 'prospects') return [...common, ...extraProspect];
    if (type === 'customers') return [...common, { value: 'lifetime_value', label: 'Lifetime Value' }];
    if (type === 'agents') return [...common, { value: 'agent_code', label: 'Agent Code', required: true }];
    if (type === 'products') return [
        { value: 'name', label: 'Name', required: true },
        { value: 'price', label: 'Price (RM)', required: false },
        { value: 'remarks', label: 'Remarks', required: false },
        { value: 'delivery_lead_time', label: 'Delivery Lead Time', required: false },
        { value: 'is_active', label: 'Is Active (Yes/No)', required: false }
    ];
    if (type === 'events') return [
        { value: 'title', label: 'Title', required: true },
        { value: 'ticket_price', label: 'Ticket Price (RM)', required: false },
        { value: 'duration', label: 'Duration', required: false },
        { value: 'target_group', label: 'Target Group', required: false },
        { value: 'description', label: 'Description', required: false },
        { value: 'is_active', label: 'Is Active (Yes/No)', required: false }
    ];
    if (type === 'promotions') return [
        { value: 'package_name', label: 'Package Name', required: true },
        { value: 'price', label: 'Price (RM)', required: false },
        { value: 'details', label: 'Details', required: false },
        { value: 'requirement', label: 'Requirement', required: false },
        { value: 'remarks', label: 'Remarks', required: false },
        { value: 'delivery_lead_time', label: 'Delivery Lead Time', required: false },
        { value: 'is_active', label: 'Is Active (Yes/No)', required: false }
    ];
    return common;
};

const autoMatchField = (header, importType = 'prospects') => {
    const lower = header.toLowerCase().trim();
    if (importType === 'products') {
        const m = { 'name': 'name', 'product name': 'name', 'price': 'price', 'remarks': 'remarks', 'delivery lead time': 'delivery_lead_time', 'lead time': 'delivery_lead_time', 'is active': 'is_active', 'active': 'is_active' };
        for (let key in m) { if (lower.includes(key)) return m[key]; }
        return '';
    }
    if (importType === 'events') {
        const m = { 'title': 'title', 'name': 'title', 'event name': 'title', 'ticket price': 'ticket_price', 'price': 'ticket_price', 'duration': 'duration', 'target group': 'target_group', 'target': 'target_group', 'description': 'description', 'is active': 'is_active', 'active': 'is_active' };
        for (let key in m) { if (lower.includes(key)) return m[key]; }
        return '';
    }
    if (importType === 'promotions') {
        const m = { 'package name': 'package_name', 'name': 'package_name', 'price': 'price', 'details': 'details', 'description': 'details', 'requirement': 'requirement', 'remarks': 'remarks', 'delivery lead time': 'delivery_lead_time', 'lead time': 'delivery_lead_time', 'is active': 'is_active', 'active': 'is_active' };
        for (let key in m) { if (lower.includes(key)) return m[key]; }
        return '';
    }
    const map = { 'full name': 'full_name', 'name': 'full_name', 'phone': 'phone', 'mobile': 'phone', 'email': 'email', 'ic': 'ic_number', 'ic number': 'ic_number', 'nric': 'ic_number', 'dob': 'date_of_birth', 'date of birth': 'date_of_birth', 'occupation': 'occupation', 'income': 'income_range', 'address': 'address', 'city': 'city', 'state': 'state', 'postcode': 'postal_code', 'postal': 'postal_code', 'postal code': 'postal_code', 'ming gua': 'ming_gua', 'gender': 'gender', 'title': 'title', 'nationality': 'nationality', 'lunar': 'lunar_birth', 'company': 'company_name', 'referred by': 'referred_by', 'referral relationship': 'referral_relationship', 'relationship': 'referral_relationship', 'pipeline': 'pipeline_stage', 'stage': 'pipeline_stage', 'close date': 'expected_close_date', 'expected close': 'expected_close_date', 'deal value': 'deal_value' };
    for (let key in map) { if (lower.includes(key)) return map[key]; }
    return '';
};

const handleImportFileDrop = async (event) => { event.preventDefault(); const files = event.dataTransfer.files; if (files.length > 0) await processImportFile(files[0]); };
const handleImportFileSelect = async (event) => { const files = event.target.files; if (files.length > 0) await processImportFile(files[0]); };

const processImportFile = async (file) => {
    if (file.size > 10 * 1024 * 1024) { UI.toast.error('File size exceeds 10MB limit'); return; }
    _importData.file = file; _importData.fileName = file.name; _importData.fileSize = file.size;

    try {
        const isCsv = file.name.toLowerCase().endsWith('.csv');
        const readFile = (f) => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = () => reject(new Error('File read failed'));
            if (isCsv) reader.readAsText(f, 'UTF-8');
            else reader.readAsArrayBuffer(f);
        });

        const result = await readFile(file);
        let allRows = [];

        if (isCsv) {
            const parsed = Papa.parse(result, { header: false, skipEmptyLines: true });
            allRows = parsed.data;
        } else {
            await window._ensureXlsx();
            const workbook = XLSX.read(result, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
            // Remove trailing empty rows
            while (allRows.length > 0 && allRows[allRows.length - 1].every(c => c === '')) allRows.pop();
        }

        if (allRows.length === 0) { UI.toast.error('File appears to be empty'); return; }

        const firstRowHeader = document.getElementById('first-row-header')?.checked !== false;
        if (firstRowHeader && allRows.length > 0) {
            _importData.headers = allRows[0].map(h => (h || '').toString().trim());
            _importData.data = allRows.slice(1);
        } else {
            const colCount = allRows[0].length;
            _importData.headers = Array.from({ length: colCount }, (_, i) => `Col${i + 1}`);
            _importData.data = allRows;
        }
        _importData.rows = _importData.data.length;

        const fi = document.getElementById('file-info');
        if (fi) {
            const sizeStr = file.size > 1048576 ? (file.size / 1048576).toFixed(1) + ' MB' : (file.size / 1024).toFixed(0) + ' KB';
            fi.innerHTML = `<div class="file-info-card"><div><strong>File:</strong> ${escapeHtml(file.name)}</div><div><strong>Size:</strong> ${escapeHtml(sizeStr)}</div><div><strong>Rows detected:</strong> ${_importData.rows}</div><div><strong>Columns detected:</strong> ${_importData.headers.length}</div></div>`;
            fi.style.display = 'block';
        }
        const btn = document.getElementById('step1-next'); if (btn) btn.disabled = false;
        UI.toast.success(`File loaded: ${_importData.rows} rows, ${_importData.headers.length} columns`);
    } catch (err) {
        console.error('File parse error:', err);
        UI.toast.error('Failed to read file: ' + err.message);
    }
};

// Private helpers (not exported)
const buildReverseMapping = () => {
    const rev = {};
    Object.entries(_importData.mapping).forEach(([col, field]) => { rev[field] = parseInt(col); });
    return rev;
};

const normalisePhone = (raw) => (raw || '').toString().replace(/[-\s()]/g, '').replace(/^\+60/, '0');

const mapRowToRecord = (row, reverseMap, agentId) => {
    const get = (field) => {
        const idx = reverseMap[field];
        return idx !== undefined ? (row[idx] || '').toString().trim() : '';
    };
    const dealVal = get('deal_value');
    const pipelineStage = get('pipeline_stage') || 'new';
    return {
        full_name: get('full_name'),
        title: get('title'),
        gender: get('gender'),
        nationality: get('nationality'),
        phone: get('phone'),
        email: get('email'),
        ic_number: get('ic_number'),
        date_of_birth: get('date_of_birth'),
        lunar_birth: get('lunar_birth'),
        occupation: get('occupation'),
        company_name: get('company_name'),
        income_range: get('income_range'),
        address: get('address'),
        city: get('city'),
        state: get('state'),
        postal_code: get('postal_code'),
        ming_gua: get('ming_gua'),
        referred_by: get('referred_by'),
        referral_relationship: get('referral_relationship'),
        pipeline_stage: pipelineStage,
        expected_close_date: get('expected_close_date') || null,
        deal_value: dealVal ? parseFloat(dealVal) || null : null,
        responsible_agent_id: agentId,
        source: 'import'
    };
};

const mapRowToMarketingRecord = (row, reverseMap, type) => {
    const get = (field) => { const idx = reverseMap[field]; return idx !== undefined ? (row[idx] || '').toString().trim() : ''; };
    const parseActive = (val) => { if (!val) return true; return !['false','no','0','inactive','n'].includes(val.toLowerCase()); };
    if (type === 'products') return { name: get('name'), price: parseFloat(get('price')) || 0, remarks: get('remarks') || null, delivery_lead_time: get('delivery_lead_time') || null, is_active: parseActive(get('is_active')) };
    if (type === 'events') return { title: get('title'), ticket_price: parseFloat(get('ticket_price')) || 0, duration: get('duration') || null, target_group: get('target_group') || null, description: get('description') || null, is_active: parseActive(get('is_active')) };
    // promotions
    return { package_name: get('package_name'), price: parseFloat(get('price')) || 0, details: get('details') || null, requirement: get('requirement') || null, remarks: get('remarks') || null, delivery_lead_time: get('delivery_lead_time') || null, is_active: parseActive(get('is_active')) };
};

const updateImportProgress = (pct, current, total) => {
    const bar = document.getElementById('progress-bar');
    if (bar) { bar.style.width = pct + '%'; bar.textContent = pct + '%'; }
    const st = document.getElementById('progress-status');
    if (st) st.textContent = `Processing ${current}/${total} records...`;
};

const runValidation = () => {
    const reverseMap = buildReverseMapping();
    const importType = _importData.importType;
    const isMarketingType = ['products', 'events', 'promotions'].includes(importType);
    _importData.validationResults = [];
    let valid = 0, warnings = 0, errors = 0;

    _importData.data.forEach((row, i) => {
        const rowErrors = [], rowWarnings = [];

        if (isMarketingType) {
            // Validate required name field per marketing type
            const reqField = importType === 'products' ? 'name' : importType === 'events' ? 'title' : 'package_name';
            const reqLabel = importType === 'products' ? 'Name' : importType === 'events' ? 'Title' : 'Package Name';
            const reqCol = reverseMap[reqField];
            if (reqCol !== undefined) {
                const val = (row[reqCol] || '').toString().trim();
                if (!val) rowErrors.push({ field: reqLabel, msg: `${reqLabel} is required`, suggestion: `Enter the ${reqLabel.toLowerCase()}` });
            }
        } else {
            const nameCol  = reverseMap['full_name'];
            const phoneCol = reverseMap['phone'];
            const emailCol = reverseMap['email'];
            const icCol    = reverseMap['ic_number'];

            if (nameCol !== undefined) {
                const name = (row[nameCol] || '').toString().trim();
                if (!name) rowErrors.push({ field: 'Full Name', msg: 'Name is required', suggestion: 'Enter the full name' });
            }
            if (phoneCol !== undefined) {
                const raw = (row[phoneCol] || '').toString().trim();
                if (!raw) rowErrors.push({ field: 'Phone', msg: 'Phone is required', suggestion: 'Enter a phone number' });
                else if (!/^(\+?60|0)[1-9]\d{7,9}$/.test(raw.replace(/[-\s()]/g, '')))
                    rowWarnings.push({ field: 'Phone', msg: 'Non-standard MY format', suggestion: 'Use 01X-XXXXXXX or +601XXXXXXXX' });
            }
            if (emailCol !== undefined) {
                const email = (row[emailCol] || '').toString().trim();
                if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
                    rowErrors.push({ field: 'Email', msg: 'Invalid email format', suggestion: 'Check @ and domain' });
            }
            if (icCol !== undefined) {
                const ic = (row[icCol] || '').toString().replace(/[-\s]/g, '');
                if (ic && !/^\d{12}$/.test(ic))
                    rowWarnings.push({ field: 'IC Number', msg: 'IC should be 12 digits', suggestion: 'Remove dashes or spaces' });
            }
        }

        const status = rowErrors.length > 0 ? 'error' : rowWarnings.length > 0 ? 'warning' : 'valid';
        _importData.validationResults.push({ rowIndex: i + 2, row, errors: rowErrors, warnings: rowWarnings, status });
        if (status === 'valid') valid++;
        else if (status === 'warning') warnings++;
        else errors++;
    });
    _importData.validation = { valid, warnings, errors };
};

const runDuplicateCheck = async () => {
    const reverseMap = buildReverseMapping();
    const importType = _importData.importType;
    const isMarketingType = ['products', 'events', 'promotions'].includes(importType);
    const table = { customers: 'customers', prospects: 'prospects', products: 'products', events: 'events', promotions: 'promotions' }[importType] || 'prospects';
    let existing = [];
    try { existing = await AppDataStore.getAll(table); } catch (e) { existing = []; }

    if (isMarketingType) {
        // Duplicate check by name for marketing list types
        const nameField = importType === 'products' ? 'name' : importType === 'events' ? 'title' : 'package_name';
        const nameCol = reverseMap[nameField];
        const existingNames = new Map();
        existing.forEach(rec => {
            const n = (rec[nameField] || '').toLowerCase().trim();
            if (n) existingNames.set(n, rec);
        });
        let byName = 0;
        const dupList = [];
        _importData.validationResults.forEach(vr => {
            if (vr.status === 'error') return;
            if (nameCol !== undefined) {
                const n = (vr.row[nameCol] || '').toString().toLowerCase().trim();
                if (n && existingNames.has(n)) { byName++; dupList.push({ rowIndex: vr.rowIndex, row: vr.row, matchField: 'name', existingRec: existingNames.get(n) }); }
            }
        });
        _importData.duplicates = { total: byName, byPhone: 0, byEmail: 0, byIc: 0, list: dupList };
        return;
    }

    const phoneCol = reverseMap['phone'];
    const emailCol = reverseMap['email'];
    const icCol    = reverseMap['ic_number'];
    const existingPhones = new Map();
    const existingEmails = new Map();
    const existingIcs    = new Map();
    existing.forEach(rec => {
        if (rec.phone)     existingPhones.set(normalisePhone(rec.phone), rec);
        if (rec.email)     existingEmails.set((rec.email || '').toLowerCase().trim(), rec);
        if (rec.ic_number) existingIcs.set((rec.ic_number || '').replace(/[-\s]/g, ''), rec);
    });

    let byPhone = 0, byEmail = 0, byIc = 0;
    const dupList = [];
    _importData.validationResults.forEach(vr => {
        if (vr.status === 'error') return;
        const row = vr.row;
        let isDup = false, matchField = '', existingRec = null;

        if (!isDup && phoneCol !== undefined) {
            const p = normalisePhone(row[phoneCol]);
            if (p && existingPhones.has(p)) { byPhone++; isDup = true; matchField = 'phone'; existingRec = existingPhones.get(p); }
        }
        if (!isDup && emailCol !== undefined) {
            const e = (row[emailCol] || '').toString().toLowerCase().trim();
            if (e && existingEmails.has(e)) { byEmail++; isDup = true; matchField = 'email'; existingRec = existingEmails.get(e); }
        }
        if (!isDup && icCol !== undefined) {
            const ic = (row[icCol] || '').toString().replace(/[-\s]/g, '');
            if (ic && existingIcs.has(ic)) { byIc++; isDup = true; matchField = 'ic'; existingRec = existingIcs.get(ic); }
        }
        if (isDup) dupList.push({ rowIndex: vr.rowIndex, row, matchField, existingRec });
    });
    _importData.duplicates = { total: byPhone + byEmail + byIc, byPhone, byEmail, byIc, list: dupList };
};

const importNextStep = async () => {
    if (_currentImportStep === 2) {
        // Collect mapping from DOM before proceeding
        _importData.mapping = {};
        document.querySelectorAll('.mapping-select').forEach(sel => {
            if (sel.value) _importData.mapping[parseInt(sel.dataset.col)] = sel.value;
        });
        runValidation();
    }
    if (_currentImportStep === 3) {
        await runDuplicateCheck();
    }
    if (_currentImportStep < 5) await renderImportStep(_currentImportStep + 1);
};
const importPrevStep = async () => { if (_currentImportStep > 1) await renderImportStep(_currentImportStep - 1); };
const updateImportType = (type) => { _importData.importType = type; };
const autoMapFields = () => {
    const selects = document.querySelectorAll('.mapping-select');
    let matched = 0;
    selects.forEach(sel => {
        const crmField = autoMatchField(_importData.headers[parseInt(sel.dataset.col)] || '', _importData.importType);
        if (crmField) { sel.value = crmField; matched++; }
    });
    UI.toast.success(`Auto-mapped ${matched} of ${selects.length} columns`);
};
const clearMapping = () => { document.querySelectorAll('.mapping-select').forEach(s => s.value = ''); UI.toast.info('Mapping cleared'); };
const clearMappingField = (idx) => { const s = document.querySelector(`.mapping-select[data-col="${idx}"]`); if (s) s.value = ''; };
const downloadErrorReport = () => {
    const issues = _importData.validationResults.filter(r => r.status !== 'valid');
    if (!issues.length) { UI.toast.info('No errors or warnings to report'); return; }
    const lines = ['Row,Field,Severity,Message,Suggestion'];
    issues.forEach(r => {
        [...r.errors.map(e => ({ ...e, sev: 'ERROR' })), ...r.warnings.map(w => ({ ...w, sev: 'WARNING' }))].forEach(issue => {
            lines.push(`${r.rowIndex},"${issue.field}","${issue.sev}","${issue.msg}","${issue.suggestion}"`);
        });
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `import_errors_${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    UI.toast.success('Error report downloaded');
};

const startImport = async () => {
    const duplicateAction = document.querySelector('input[name="duplicate-action"]:checked')?.value || 'skip';
    const assignTo        = document.querySelector('input[name="assign-to"]:checked')?.value || 'myself';

    const progressArea = document.getElementById('progress-area');
    if (progressArea) progressArea.style.display = 'block';
    const startBtn = document.getElementById('start-import-btn');
    if (startBtn) startBtn.disabled = true;

    const rowsToProcess = _importData.validationResults.filter(vr => vr.status !== 'error');
    const total = rowsToProcess.length;
    if (total === 0) { UI.toast.error('No valid rows to import'); if (startBtn) startBtn.disabled = false; return; }

    const dupMap = new Map();
    _importData.duplicates.list.forEach(d => dupMap.set(d.rowIndex, d));

    let assignedAgentId = null;
    if (assignTo === 'myself') assignedAgentId = _currentUser?.id;

    const reverseMap = buildReverseMapping();
    const isMarketingType = ['products', 'events', 'promotions'].includes(_importData.importType);
    const table = { customers: 'customers', prospects: 'prospects', products: 'products', events: 'events', promotions: 'promotions' }[_importData.importType] || 'prospects';
    let created = 0, updated = 0, skipped = 0, errorCount = 0;

    for (let i = 0; i < rowsToProcess.length; i++) {
        if (i % 10 === 0) {
            updateImportProgress(Math.round((i / total) * 100), i, total);
            await new Promise(r => setTimeout(r, 0));
        }
        const vr = rowsToProcess[i];
        const record = isMarketingType ? mapRowToMarketingRecord(vr.row, reverseMap, _importData.importType) : mapRowToRecord(vr.row, reverseMap, assignedAgentId);
        const dup = dupMap.get(vr.rowIndex);

        if (dup) {
            if (duplicateAction === 'skip') { skipped++; continue; }
            if (duplicateAction === 'update') {
                try { await AppDataStore.update(table, dup.existingRec.id, record); updated++; }
                catch (e) { console.error('Update failed row', vr.rowIndex, e); errorCount++; }
                continue;
            }
            // merge: fall through to create
        }
        try {
            record.created_at = new Date().toISOString();
            if (!isMarketingType) {
                record.status = 'New';
                record.protection_deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                record.score = 5;
            }
            await AppDataStore.create(table, record);
            created++;
        } catch (e) { console.error('Insert failed row', vr.rowIndex, e); errorCount++; }
    }

    updateImportProgress(100, total, total);
    await new Promise(r => setTimeout(r, 200));

    try {
        await AppDataStore.create('import_jobs', {
            file_name:          _importData.fileName || 'import.xlsx',
            import_type:        _importData.importType,
            total_rows:         _importData.data.length,
            valid_rows:         _importData.validation.valid + _importData.validation.warnings,
            error_rows:         _importData.validation.errors + errorCount,
            created_records:    created,
            updated_records:    updated,
            skipped_records:    skipped,
            status:             'completed',
            mapping_config:     _importData.mapping,
            duplicate_handling: duplicateAction,
            assignment_config:  { assignTo, agentId: assignedAgentId },
            created_by:         _currentUser?.id,
            created_at:         new Date().toISOString(),
            completed_at:       new Date().toISOString()
        });
    } catch (e) { console.error('Failed to log import job:', e); }

    UI.hideModal();
    UI.toast.success(`Import complete: ${created} created, ${updated} updated, ${skipped} skipped`);
    const vp = document.getElementById('content-viewport');
    if (vp) {
        if (_importData.importType === 'prospects') {
            await (window.app.showProspectsViewSmart || (() => {}))(vp);
        } else if (['products', 'events', 'promotions'].includes(_importData.importType)) {
            _state.cmlt = _importData.importType;
            await (window.app.showMarketingListsView || (() => Promise.resolve()))(vp);
        } else {
            await showImportDashboard(vp);
        }
    }
};

const viewImportDetails = async (id) => {
    const job = await AppDataStore.getById('import_jobs', id);
    if (!job) return;
    const content = `<div><div style="background:var(--gray-50);padding:16px;border-radius:8px;margin-bottom:16px"><div><strong>File:</strong> ${job.file_name}</div><div><strong>Type:</strong> ${job.import_type}</div><div><strong>Status:</strong> ${job.status}</div><div><strong>Date:</strong> ${UI.formatDate(job.created_at)}</div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><strong>Total rows:</strong> ${job.total_rows}</div><div><strong>Valid rows:</strong> ${job.valid_rows}</div><div><strong>New records:</strong> ${job.created_records}</div><div><strong>Updated:</strong> ${job.updated_records}</div><div><strong>Skipped:</strong> ${job.skipped_records}</div><div><strong>Errors:</strong> ${job.error_rows}</div></div></div>`;
    UI.showModal(`Import Details: ${job.file_name}`, content, [{ label: 'Close', type: 'primary', action: 'UI.hideModal()' }]);
};

const downloadImportLog = (id) => UI.toast.info('Import log downloaded');

const openTemplatesModal = () => {
    const content = `
        <table style="width:100%;border-collapse:collapse">
            <thead><tr><th scope="col" style="padding:10px;text-align:left;background:var(--gray-50)">Template</th><th scope="col" style="padding:10px;text-align:left;background:var(--gray-50)">Description</th><th scope="col" style="padding:10px;text-align:left;background:var(--gray-50)">Download</th></tr></thead>
            <tbody>
                ${['Prospects', 'Customers', 'Agents', 'Products', 'Events', 'Promotions', 'Activities'].map(t => `<tr><td style="padding:10px;border-bottom:1px solid var(--gray-100)">${t} Template</td><td style="padding:10px;border-bottom:1px solid var(--gray-100)">${t} data import</td><td style="padding:10px;border-bottom:1px solid var(--gray-100)"><button class="btn secondary btn-sm" onclick="app.downloadTemplate('${t.toLowerCase()}','csv')">CSV</button> <button class="btn secondary btn-sm" onclick="app.downloadTemplate('${t.toLowerCase()}','xlsx')">Excel</button></td></tr>`).join('')}
            </tbody>
        </table>`;
    UI.showModal('Download Import Templates', content, [{ label: 'Close', type: 'primary', action: 'UI.hideModal()' }]);
};

const downloadTemplate = async (type, format) => {
    if (format === 'xlsx') await window._ensureXlsx();
    const headers = {
        prospects: ['Title','Full Name','Gender','Nationality','Phone','Email','IC Number','Date of Birth','Lunar Birth','Occupation','Company Name','Income Range','Address','City','State','Postal Code','Ming Gua','Referred By','Referral Relationship','Pipeline Stage','Expected Close Date','Deal Value (RM)'],
        customers: ['Full Name','Phone','Email','IC Number','Customer Since','Lifetime Value'],
        agents: ['Full Name','Phone','Email','Agent Code','Commission Rate','License Start','License Expiry'],
        products: ['Name','Price (RM)','Remarks','Delivery Lead Time','Is Active'],
        events: ['Title','Ticket Price (RM)','Duration','Target Group','Description','Is Active'],
        promotions: ['Package Name','Price (RM)','Details','Requirement','Remarks','Delivery Lead Time','Is Active'],
        activities: ['Date','Type','Title','Agent','Prospect','Status']
    };
    const samples = {
        prospects: ['Mr.','Ahmad bin Ali','Male','Malaysian','012-345-6789','ahmad@email.com','901212-10-1234','1990-12-12','','Business Owner','ABC Sdn Bhd','RM5-8k','123 Jalan SS2','Petaling Jaya','Selangor','46000','MG4','','Friend','new','2025-06-30','50000'],
        customers: ['Sample Name','012-345-6789','sample@email.com','901212-10-1234','2024-01-01','50000'],
        agents: ['Sample Name','012-345-6789','sample@email.com','AGT001','0.10','2024-01-01','2025-01-01'],
        products: ['PR4 Power Ring','2500','Premium feng shui ring','3-5 days','Yes'],
        events: ['Feng Shui Workshop','50','2 hours','Homeowners','Introduction to Feng Shui principles','Yes'],
        promotions: ['Starter Package','2000','Basic feng shui consultation','New customers only','Limited time offer','7-14 days','Yes'],
        activities: ['2024-01-01','Meeting','Sample Activity','Agent Name','Prospect Name','Completed']
    };
    const cols = headers[type] || headers.prospects;
    const sample = samples[type] || samples.prospects;
    if (format === 'xlsx') {
        const ws = XLSX.utils.aoa_to_sheet([cols, sample]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, type);
        XLSX.writeFile(wb, `${type}_template.xlsx`);
    } else {
        const csv = cols.join(',') + '\n' + sample.map(v => `"${v}"`).join(',');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `${type}_template.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }
    UI.toast.success(`${type} template downloaded`);
};

const exportMarketingList = async (format) => {
    const type = _state.cmlt;
    const data = await AppDataStore.getAll(type);
    if (!data.length) { UI.toast.error('No data to export'); return; }
    let cols, rows;
    if (type === 'products') {
        cols = ['Name','Price (RM)','Remarks','Delivery Lead Time','Is Active'];
        rows = data.map(d => [d.name || '', d.price || 0, d.remarks || '', d.delivery_lead_time || '', d.is_active ? 'Yes' : 'No']);
    } else if (type === 'events') {
        cols = ['Title','Ticket Price (RM)','Duration','Target Group','Description','Is Active'];
        rows = data.map(d => [d.title || '', d.ticket_price || 0, d.duration || '', d.target_group || '', d.description || '', d.is_active ? 'Yes' : 'No']);
    } else {
        cols = ['Package Name','Price (RM)','Details','Requirement','Remarks','Delivery Lead Time','Is Active'];
        rows = data.map(d => [d.package_name || '', d.price || 0, d.details || '', d.requirement || '', d.remarks || '', d.delivery_lead_time || '', d.is_active ? 'Yes' : 'No']);
    }
    const filename = `${type}_export_${new Date().toISOString().split('T')[0]}`;
    if (format === 'xlsx') {
        await window._ensureXlsx();
        const ws = XLSX.utils.aoa_to_sheet([cols, ...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, type);
        XLSX.writeFile(wb, `${filename}.xlsx`);
    } else {
        const csvRows = [cols, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `${filename}.csv`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    UI.toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} exported (${data.length} records)`);
};

const openImportWizardForType = async (type) => {
    await openImportWizard();
    _importData.importType = type;
};

const showImportHistory = async () => {
    const jobs = (await AppDataStore.getAll('import_jobs')).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const rows = jobs.length === 0 ? '<tr><td colspan="6" style="text-align:center;padding:20px">No import history</td></tr>' :
        jobs.map(j => `<tr><td>${j.file_name}</td><td>${j.import_type}</td><td>${j.total_rows}</td><td><span class="import-status status-${j.status}">${j.status.toUpperCase()}</span></td><td>${UI.formatDate(j.created_at)}</td><td><button class="btn-icon" onclick="app.viewImportDetails(${j.id})"><i class="fas fa-eye"></i></button></td></tr>`).join('');
    const content = `<table style="width:100%;border-collapse:collapse"><thead><tr style="background:var(--gray-50)"><th scope="col" style="padding:10px;text-align:left">File</th><th scope="col" style="padding:10px;text-align:left">Type</th><th scope="col" style="padding:10px;text-align:left">Records</th><th scope="col" style="padding:10px;text-align:left">Status</th><th scope="col" style="padding:10px;text-align:left">Date</th><th scope="col" style="padding:10px;text-align:left">Actions</th></tr></thead><tbody>${rows}</tbody></table>`;
    UI.showModal('Import History', content, [{ label: 'Close', type: 'primary', action: 'UI.hideModal()' }]);
};

// ========== PHASE 13: FOLLOW-UP MONITORING & REASSIGNMENT ==========

const showProtectionMonitoringView = async (container) => {
    const [allProspects, allUsers, allActivities, visibleIds] = await Promise.all([
        AppDataStore.getAll('prospects'),
        AppDataStore.getAll('users'),
        AppDataStore.getAll('activities'),
        getVisibleUserIds(_currentUser)
    ]);
    const agentMap = {};
    for (const u of allUsers) agentMap[u.id] = u;
    const now = new Date();
    const lastActivityMap = {};
    for (const p of allProspects) {
        const pActivities = allActivities
            .filter(a => String(a.prospect_id) === String(p.id))
            .sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date));
        const last = pActivities[0];
        const daysSince = last ? Math.floor((now - new Date(last.activity_date)) / (1000 * 60 * 60 * 24)) : 999;
        lastActivityMap[p.id] = { date: last?.activity_date, daysSince, type: last?.activity_type };
    }
    const visibleAgents = allUsers.filter(u => {
        const lvl = _getUserLevel(u);
        if (lvl < 3 || lvl > 11 || u.status === 'deleted') return false;
        return visibleIds === 'all' || visibleIds.includes(u.id);
    });
    const visibleProspects = visibleIds === 'all'
        ? allProspects
        : allProspects.filter(p => visibleIds.includes(p.responsible_agent_id));
    const monitorData = { visibleProspects, visibleAgents, agentMap, lastActivityMap };

    container.innerHTML = `
        <div class="protection-view">
            <div class="protection-header">
                <div><h1>Protection Period & Follow-up Monitoring</h1><p>Track prospect protection periods and agent follow-up performance</p></div>
                <div class="protection-header-actions">
                    <button class="btn secondary" onclick="app.refreshFollowupStats()"><i class="fas fa-sync-alt"></i> Refresh Stats</button>
                    <button class="btn secondary" onclick="app.exportFollowupReport()"><i class="fas fa-download"></i> Export Report</button>
                    <button class="btn secondary" onclick="app.configureAlerts()"><i class="fas fa-bell"></i> Configure Alerts</button>
                    <button class="btn primary" onclick="app.navigateTo('import')"><i class="fas fa-upload"></i> Bulk Import</button>
                </div>
            </div>
            <div class="team-summary-cards">${renderTeamSummaryCards(monitorData)}</div>
            <div class="agent-performance">
                <h3>Agent Performance</h3>
                <div class="agent-table-container">
                    <table class="agent-performance-table">
                        <thead><tr><th scope="col">Agent</th><th scope="col">Team</th><th scope="col">Assigned</th><th scope="col">Followed up (7d)</th><th scope="col">Rate</th><th scope="col">Inactive (3-7d)</th><th scope="col">Inactive (8-14d)</th><th scope="col">Inactive (15d+)</th><th scope="col">Actions</th></tr></thead>
                        <tbody>${renderAgentPerformanceRows(monitorData)}</tbody>
                    </table>
                </div>
            </div>
            <div class="inactive-prospects">
                <h3>Inactive Prospects (>7 days)</h3>
                <div class="inactive-table-container">
                    <table class="inactive-table">
                        <thead><tr><th scope="col">Prospect</th><th scope="col">Agent</th><th scope="col">Days Inactive</th><th scope="col">Score</th><th scope="col">Protection Deadline</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
                        <tbody>${renderInactiveProspectsRows(monitorData)}</tbody>
                    </table>
                </div>
            </div>
            <div class="agent-performance" style="margin-top:24px">
                <h3>Reassignment History</h3>
                <div class="agent-table-container">${await renderReassignmentHistory()}</div>
            </div>
        </div>`;
};

const renderTeamSummaryCards = ({ visibleProspects, agentMap, lastActivityMap }) => {
    const teamColors = ['team-a', 'team-b', 'team-c', 'team-d', 'team-e'];
    const teamStats = {};
    const totals = { active: 0, attention: 0, inactive: 0, critical: 0 };
    for (const p of visibleProspects) {
        const agent = agentMap[p.responsible_agent_id];
        const teamName = agent?.team || 'Unassigned';
        if (!teamStats[teamName]) teamStats[teamName] = { active: 0, attention: 0, inactive: 0, critical: 0 };
        const days = lastActivityMap[p.id]?.daysSince ?? 999;
        const protDays = (window.app.calculateProtectionDays || (() => 0))(p);
        if (days > 14 || protDays <= 0) { teamStats[teamName].critical++; totals.critical++; }
        else if (days > 7) { teamStats[teamName].inactive++; totals.inactive++; }
        else if (days > 3) { teamStats[teamName].attention++; totals.attention++; }
        else { teamStats[teamName].active++; totals.active++; }
    }
    const teamNames = Object.keys(teamStats).sort();
    const cards = teamNames.map((name, i) => {
        const t = teamStats[name];
        const color = teamColors[i % teamColors.length];
        return `<div class="summary-card ${color}"><h4>${name}</h4><div class="summary-stats"><div><span class="stat-label">Active:</span><span class="stat-value">${t.active}</span></div><div><span class="stat-label">Attention:</span><span class="stat-value warning">${t.attention}</span></div><div><span class="stat-label">Inactive:</span><span class="stat-value danger">${t.inactive}</span></div><div><span class="stat-label">Critical:</span><span class="stat-value danger">${t.critical}</span></div></div></div>`;
    });
    cards.push(`<div class="summary-card total"><h4>Total</h4><div class="summary-stats"><div><span class="stat-label">Active:</span><span class="stat-value">${totals.active}</span></div><div><span class="stat-label">Attention:</span><span class="stat-value warning">${totals.attention}</span></div><div><span class="stat-label">Inactive:</span><span class="stat-value danger">${totals.inactive}</span></div><div><span class="stat-label">Critical:</span><span class="stat-value danger">${totals.critical}</span></div></div></div>`);
    return cards.join('');
};

const renderAgentPerformanceRows = ({ visibleAgents, visibleProspects, lastActivityMap }) => {
    return visibleAgents.map(agent => {
        const agentProspects = visibleProspects.filter(p => String(p.responsible_agent_id) === String(agent.id));
        const assigned = agentProspects.length;
        let followedUp7d = 0, i37 = 0, i814 = 0, i15 = 0;
        for (const p of agentProspects) {
            const days = lastActivityMap[p.id]?.daysSince ?? 999;
            if (days <= 7) followedUp7d++;
            if (days > 3 && days <= 7) i37++;
            else if (days > 7 && days <= 14) i814++;
            else if (days > 14) i15++;
        }
        const rate = assigned > 0 ? Math.round((followedUp7d / assigned) * 100) : 0;
        const cls = rate < 70 ? 'rate-bad' : rate < 90 ? 'rate-warning' : 'rate-good';
        const teamName = agent.team || 'Unassigned';
        return `<tr><td><strong>${agent.full_name || 'Unknown'}</strong></td><td>${teamName}</td><td>${assigned}</td><td>${followedUp7d}</td><td><span class="rate-badge ${cls}">${rate}%</span></td><td>${i37}</td><td>${i814}</td><td>${i15}</td><td><button class="btn-icon" onclick="app.viewAgentDetails(${agent.id})" title="View"><i class="fas fa-eye"></i></button><button class="btn-icon" onclick="app.bulkReassign(${agent.id})" title="Reassign"><i class="fas fa-exchange-alt"></i></button><button class="btn-icon" onclick="app.bulkReassign(${agent.id})" title="Bulk Reassign"><i class="fas fa-users"></i></button></td></tr>`;
    }).join('');
};

const renderInactiveProspectsRows = ({ visibleProspects, agentMap, lastActivityMap }) => {
    const inactive = visibleProspects
        .filter(p => (lastActivityMap[p.id]?.daysSince ?? 999) > 7)
        .sort((a, b) => (lastActivityMap[b.id]?.daysSince ?? 999) - (lastActivityMap[a.id]?.daysSince ?? 999));
    if (!inactive.length) return '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--gray-500)">No inactive prospects found</td></tr>';
    return inactive.map(p => {
        const days = lastActivityMap[p.id]?.daysSince ?? 999;
        const agentName = agentMap[p.responsible_agent_id]?.full_name || 'Unassigned';
        const protDays = (window.app.calculateProtectionDays || (() => 0))(p);
        const status = days > 14 || protDays <= 0 ? 'critical' : 'warning';
        const deadline = p.protection_deadline ? UI.formatDate(p.protection_deadline) : 'N/A';
        return `<tr><td><strong>${p.full_name || 'Unknown'}</strong></td><td>${agentName}</td><td class="${days > 14 ? 'critical' : 'warning'}">${days === 999 ? 'Never' : days + ' days'}</td><td>${p.score || 0}</td><td>${deadline}</td><td><span class="status-badge status-${status}">${status === 'critical' ? '🔴 Critical' : '🟡 Warning'}</span></td><td><button class="btn-icon" onclick="app.openReassignModal(${p.id})" title="Reassign"><i class="fas fa-exchange-alt"></i></button><button class="btn-icon" onclick="app.contactProspect(${p.id})" title="Contact"><i class="fas fa-phone"></i></button></td></tr>`;
    }).join('');
};

const renderReassignmentHistory = async () => {
    // Fetch history + users in parallel, build a user map once. Previously
    // this fired 3 * history.length getById calls — 300 roundtrips on a
    // 100-row history. Now it's 2 queries total.
    const [historyRaw, allUsers] = await Promise.all([
        AppDataStore.getAll('reassignment_history'),
        AppDataStore.getAll('users'),
    ]);
    const history = (historyRaw || []).sort((a, b) => new Date(b.reassignment_date) - new Date(a.reassignment_date));
    if (history.length === 0) return '<p style="padding:16px;color:var(--gray-500)">No reassignment history yet.</p>';
    const userMap = new Map((allUsers || []).map(u => [String(u.id), u]));
    const nameOf = (id) => userMap.get(String(id))?.full_name || `Agent #${id}`;

    const rows = history.map(r => `<tr><td>${UI.formatDate(r.reassignment_date)}</td><td>#${r.prospect_id}</td><td>${nameOf(r.from_agent_id)}</td><td>${nameOf(r.to_agent_id)}</td><td>${r.reassignment_reason}</td><td>${nameOf(r.reassigned_by)}</td></tr>`);

    return `<table class="agent-performance-table"><thead><tr><th scope="col">Date</th><th scope="col">Prospect ID</th><th scope="col">From Agent</th><th scope="col">To Agent</th><th scope="col">Reason</th><th scope="col">By</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
};

// ────────────────────────────────────────────────────────────────────────
// Single shared cascade for prospect→agent reassignment.
// Always updates prospects.responsible_agent_id; optionally cascades to
// the linked converted customer (responsible_agent_id + legacy agent_id)
// and to historical activities (lead_agent_id) currently credited to the
// old agent. Writes a reassignment_history audit row with a cascade note.
// Best-effort client-side rollback if any write fails mid-flight.
const cascadeProspectReassign = async (prospectId, toAgentId, opts = {}) => {
    const pid = parseInt(prospectId);
    const newAgentId = parseInt(toAgentId);
    if (!pid || !newAgentId) throw new Error('Missing prospect or agent id');

    const prospect = await AppDataStore.getById('prospects', pid);
    if (!prospect) throw new Error('Prospect not found');
    const fromAgentId = prospect.responsible_agent_id || null;

    if (fromAgentId != null && String(fromAgentId) === String(newAgentId)) {
        return { skipped: true, reason: 'same_agent', fromAgentId, toAgentId: newAgentId,
                 linkedCustomerCount: 0, customersCascaded: 0, activitiesCascaded: 0 };
    }

    const allCustomers = await AppDataStore.getAll('customers');
    const linkedCustomers = (allCustomers || []).filter(c =>
        String(c.converted_from_prospect_id) === String(pid));

    let activitiesToTransfer = [];
    const cascadeActivitiesAfter = opts.cascadeActivitiesAfter ?? null;
    if (cascadeActivitiesAfter) {
        const allActs = await AppDataStore.getAll('activities');
        const cutoffMs = new Date(cascadeActivitiesAfter).getTime();
        const linkedCustomerIds = new Set(linkedCustomers.map(c => String(c.id)));
        activitiesToTransfer = (allActs || []).filter(a => {
            const matchesEntity = String(a.prospect_id) === String(pid)
                || (a.customer_id && linkedCustomerIds.has(String(a.customer_id)));
            if (!matchesEntity) return false;
            if (fromAgentId != null && String(a.lead_agent_id) !== String(fromAgentId)) return false;
            if (!a.activity_date) return false;
            return new Date(a.activity_date).getTime() >= cutoffMs;
        });
    }

    const now = new Date().toISOString();
    const prospectPatch = { responsible_agent_id: newAgentId };
    let protectionResetTo = null;
    if (opts.resetProtection) {
        protectionResetTo = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        prospectPatch.protection_deadline = protectionResetTo;
    }

    const customersDone = [];
    const activitiesDone = [];
    let prospectDone = false;
    try {
        await AppDataStore.update('prospects', pid, prospectPatch);
        prospectDone = true;

        if (opts.cascadeCustomer !== false && linkedCustomers.length) {
            for (const c of linkedCustomers) {
                await AppDataStore.update('customers', c.id, {
                    responsible_agent_id: newAgentId,
                    agent_id: newAgentId
                });
                customersDone.push({ id: c.id,
                    prev_responsible: c.responsible_agent_id ?? null,
                    prev_agent: c.agent_id ?? null });
            }
        }

        for (const a of activitiesToTransfer) {
            await AppDataStore.update('activities', a.id, { lead_agent_id: newAgentId });
            activitiesDone.push({ id: a.id, prev_lead: a.lead_agent_id });
        }
    } catch (err) {
        try {
            if (prospectDone) {
                const rollback = { responsible_agent_id: fromAgentId };
                if (protectionResetTo) rollback.protection_deadline = prospect.protection_deadline ?? null;
                await AppDataStore.update('prospects', pid, rollback);
            }
            for (const c of customersDone) {
                await AppDataStore.update('customers', c.id, {
                    responsible_agent_id: c.prev_responsible,
                    agent_id: c.prev_agent
                });
            }
            for (const a of activitiesDone) {
                await AppDataStore.update('activities', a.id, { lead_agent_id: a.prev_lead });
            }
        } catch (_rb) { /* rollback best-effort */ }
        throw new Error(`Reassignment failed and was rolled back: ${err.message}`);
    }

    try {
        const cascadeBits = [];
        if (customersDone.length) cascadeBits.push(`customer×${customersDone.length}`);
        if (activitiesDone.length) cascadeBits.push(`activities×${activitiesDone.length}`);
        const notes = (opts.reasonNotes || '') + (cascadeBits.length
            ? ` [cascaded: ${cascadeBits.join(', ')}]`
            : '');
        await AppDataStore.create('reassignment_history', {
            prospect_id: pid,
            from_agent_id: fromAgentId,
            to_agent_id: newAgentId,
            reassigned_by: _currentUser?.id,
            reassignment_date: now,
            reassignment_reason: opts.reason || 'manual',
            reason_notes: notes,
            days_inactive: opts.daysInactive || 0,
            protection_deadline: protectionResetTo || prospect.protection_deadline || '',
            created_at: now
        });
    } catch (_h) { /* audit log best-effort */ }

    return {
        skipped: false,
        fromAgentId,
        toAgentId: newAgentId,
        linkedCustomerCount: linkedCustomers.length,
        customersCascaded: customersDone.length,
        activitiesCascaded: activitiesDone.length,
        protectionResetTo
    };
};

// Customer-side reassignment. Reverse-syncs to the source prospect (if
// converted) so the two stay aligned. Activity history is preserved.
const cascadeCustomerReassign = async (customerId, toAgentId) => {
    const cid = parseInt(customerId);
    const newAgentId = parseInt(toAgentId);
    if (!cid || !newAgentId) throw new Error('Missing customer or agent id');

    const customer = await AppDataStore.getById('customers', cid);
    if (!customer) throw new Error('Customer not found');
    const fromAgentId = customer.responsible_agent_id || customer.agent_id || null;
    if (fromAgentId != null && String(fromAgentId) === String(newAgentId)) {
        return { skipped: true, reason: 'same_agent' };
    }

    await AppDataStore.update('customers', cid, {
        responsible_agent_id: newAgentId,
        agent_id: newAgentId
    });

    let prospectSynced = false;
    const sourceProspectId = customer.converted_from_prospect_id;
    if (sourceProspectId) {
        try {
            const sourceProspect = await AppDataStore.getById('prospects', sourceProspectId);
            if (sourceProspect && String(sourceProspect.responsible_agent_id) !== String(newAgentId)) {
                await AppDataStore.update('prospects', sourceProspectId, { responsible_agent_id: newAgentId });
                try {
                    await AppDataStore.create('reassignment_history', {
                        prospect_id: sourceProspectId,
                        from_agent_id: sourceProspect.responsible_agent_id || null,
                        to_agent_id: newAgentId,
                        reassigned_by: _currentUser?.id,
                        reassignment_date: new Date().toISOString(),
                        reassignment_reason: 'customer_dropdown_sync',
                        reason_notes: `Synced from customer #${cid} reassignment`,
                        created_at: new Date().toISOString()
                    });
                } catch (_h) {}
                prospectSynced = true;
            }
        } catch (_p) {}
    }

    return { skipped: false, fromAgentId, toAgentId: newAgentId, prospectSynced };
};

// ────────────────────────────────────────────────────────────────────────
// Confirmation popup layer: every reassignment path stashes its intent in
// _pendingReassign and shows a summary popup. Only the user's explicit
// "Yes, Shift Everything Over" click triggers the actual cascade write.
let _pendingReassign = null;
// Expose via _state so script-prospects.js (a different IIFE) can read/write the same variable.
Object.defineProperty(_state, '_pendingReassign', {
    configurable: true,
    get: () => _pendingReassign,
    set: (v) => { _pendingReassign = v; },
});

const _renderReassignSummary = (s) => {
    const lines = [];
    if (s.kind === 'single') {
        lines.push(`<li><strong>${escapeHtml(s.prospectName || 'This prospect')}</strong>'s ownership will move from <strong>${escapeHtml(s.fromAgentName)}</strong> to <strong>${escapeHtml(s.toAgentName)}</strong>.</li>`);
        if (s.willCascadeCustomer && s.linkedCustomerCount > 0) {
            lines.push(`<li>✓ <strong>${s.linkedCustomerCount}</strong> linked customer record${s.linkedCustomerCount > 1 ? 's' : ''} will also move (incl. future commission &amp; renewal credit).</li>`);
        } else if (s.linkedCustomerCount > 0) {
            lines.push(`<li>⚠ ${s.linkedCustomerCount} linked customer record${s.linkedCustomerCount > 1 ? 's' : ''} will <strong>stay with ${escapeHtml(s.fromAgentName)}</strong> (customer commission stays on old agent).</li>`);
        } else {
            lines.push(`<li>No converted customer linked — nothing to cascade on the customer side.</li>`);
        }
        if (s.willCascadeActivities && s.activityTransferCount > 0) {
            lines.push(`<li>⚠ <strong>${s.activityTransferCount}</strong> past activit${s.activityTransferCount > 1 ? 'ies' : 'y'} will flip to ${escapeHtml(s.toAgentName)} — historical KPI credit rewrites.</li>`);
        } else if (s.willCascadeActivities) {
            lines.push(`<li>Activity transfer was enabled but no matching activities fell in range — history preserved.</li>`);
        } else {
            lines.push(`<li>Past activity credit stays with ${escapeHtml(s.fromAgentName)} (KPI history preserved).</li>`);
        }
        if (s.protectionResetEnabled) lines.push(`<li>Protection deadline resets to today + 30 days.</li>`);
    } else {
        lines.push(`<li><strong>${s.bulkCount}</strong> prospect${s.bulkCount > 1 ? 's' : ''} will be reassigned${s.toAgentName ? ` to <strong>${escapeHtml(s.toAgentName)}</strong>` : ' across multiple agents (distribution)'}.</li>`);
        if (s.bulkCustomerCascadeEnabled && s.bulkLinkedCustomers > 0) {
            lines.push(`<li>✓ <strong>${s.bulkLinkedCustomers}</strong> linked customer record${s.bulkLinkedCustomers > 1 ? 's' : ''} will also move with their prospect.</li>`);
        } else if (s.bulkLinkedCustomers > 0) {
            lines.push(`<li>⚠ ${s.bulkLinkedCustomers} linked customer record${s.bulkLinkedCustomers > 1 ? 's' : ''} will <strong>stay on the old agent</strong>.</li>`);
        } else {
            lines.push(`<li>None of the selected prospects are converted — no customer cascade.</li>`);
        }
        if (s.bulkActivityCascadeEnabled) {
            lines.push(`<li>⚠ Past activities currently credited to source agent(s) will flip — historical KPI rewrites.</li>`);
        } else {
            lines.push(`<li>Past activity credit is preserved on the source agents.</li>`);
        }
    }
    return `
        <div style="padding:4px 0;">
            <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:14px;border-radius:6px;margin-bottom:14px;">
                <div style="font-weight:700;color:#92400e;font-size:14px;">⚠️ Are you sure you want to shift this?</div>
                <div style="color:#78350f;font-size:13px;margin-top:6px;line-height:1.5;">Once confirmed, the change writes to the database and is logged in the reassignment history. Reverting requires another reassignment.</div>
            </div>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;font-size:13px;">
                <div style="font-weight:600;margin-bottom:10px;font-size:14px;color:#1f2937;">What will shift:</div>
                <ul style="margin:0;padding-left:20px;line-height:1.7;color:#334155;">${lines.join('')}</ul>
            </div>
        </div>
    `;
};

const _showReassignConfirmPopup = (titleText, summaryHtml, executeFnName) => {
    UI.showModal(titleText, summaryHtml, [
        { label: 'Cancel', type: 'secondary', action: `(async () => { await app.cancelPendingReassign(); })()` },
        { label: '✓ Yes, Shift Everything Over', type: 'primary', action: `(async () => { await app.${executeFnName}(); })()` }
    ]);
};

const cancelPendingReassign = async () => {
    const p = _pendingReassign;
    _pendingReassign = null;
    UI.hideModal();
    if (!p) return;

    // Quick dropdown: dropdown was already pre-reverted at popup-open time,
    // so this is just a safety belt in case anything mutated it.
    if (p.kind === 'quick' && p.selectEl && p.fromAgentId != null) {
        try { p.selectEl.value = String(p.fromAgentId); } catch (_) {}
        return;
    }

    // Full reassign modal: re-open the original modal so the user doesn't
    // lose the reason / justification / cascade checkbox state they typed.
    if (p.kind === 'modalSingle' && p.prospectId && p.formSnapshot) {
        try {
            await openReassignModal(p.prospectId);
            // Give the modal a moment to render before restoring values
            await new Promise(r => setTimeout(r, 40));
            const snap = p.formSnapshot;
            const a = document.getElementById('reassign-agent');
            if (a && snap.agentValue) a.value = snap.agentValue;
            const j = document.getElementById('reassign-justification');
            if (j) j.value = snap.justification || '';
            if (snap.reason) {
                const r = document.querySelector(`input[name="reassign-reason"][value="${snap.reason}"]`);
                if (r) r.checked = true;
            }
            const cc = document.getElementById('reassign-cascade-customer');
            if (cc) cc.checked = !!snap.cascadeCustomerChecked;
            const ca = document.getElementById('reassign-cascade-activities');
            if (ca) ca.checked = !!snap.cascadeActivitiesChecked;
            const cd = document.getElementById('reassign-cascade-activities-from');
            if (cd && snap.cascadeActivitiesFromValue) cd.value = snap.cascadeActivitiesFromValue;
            const rp = document.getElementById('reassign-reset-protection');
            if (rp) rp.checked = !!snap.resetProtectionChecked;
            const nf = document.getElementById('reassign-notify');
            if (nf) nf.checked = !!snap.notifyChecked;
        } catch (_) {}
    }
};

const openReassignModal = async (prospectId) => {
    const [prospect, allActivities, allUsers, allProspectsForCap, allCustomers] = await Promise.all([
        AppDataStore.getById('prospects', prospectId),
        AppDataStore.getAll('activities'),
        AppDataStore.getAll('users'),
        AppDataStore.getAll('prospects'),
        AppDataStore.getAll('customers'),
    ]);
    if (!prospect) { UI.toast.error('Prospect not found'); return; }
    const currentAgent = prospect.responsible_agent_id
        ? allUsers.find(u => String(u.id) === String(prospect.responsible_agent_id)) || null
        : null;
    const linkedCustomers = (allCustomers || []).filter(c => String(c.converted_from_prospect_id) === String(prospectId));
    const linkedCustomerCount = linkedCustomers.length;
    const fromAgentActivityCount = allActivities.filter(a => {
        const pidMatch = String(a.prospect_id) === String(prospectId);
        const cidMatch = a.customer_id && linkedCustomers.some(c => String(c.id) === String(a.customer_id));
        return (pidMatch || cidMatch) && prospect.responsible_agent_id != null
            && String(a.lead_agent_id) === String(prospect.responsible_agent_id);
    }).length;
    const pActs = allActivities.filter(a => String(a.prospect_id) === String(prospectId)).sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date));
    const lastAct = pActs[0];
    const daysSince = lastAct ? Math.floor((Date.now() - new Date(lastAct.activity_date)) / (1000 * 60 * 60 * 24)) : 999;
    const activeAgents = allUsers.filter(u => {
        const lvl = _getUserLevel(u);
        return lvl >= 3 && lvl <= 11 && u.status !== 'deleted' && u.id !== prospect.responsible_agent_id;
    });
    const agentOptions = activeAgents.map(a => {
        const assignedCount = allProspectsForCap.filter(p => String(p.responsible_agent_id) === String(a.id)).length;
        const capacity = Math.max(0, 60 - assignedCount);
        const icon = capacity > 10 ? '🟢' : capacity > 0 ? '🟡' : '🔴';
        return `<option value="${a.id}">${a.full_name || 'Agent'} (${assignedCount} assigned, capacity +${capacity}) ${icon}</option>`;
    }).join('');
    const content = `
        <div class="reassign-modal">
            <input type="hidden" id="reassign-prospect-id" value="${prospectId}">
            <input type="hidden" id="reassign-from-agent-id" value="${prospect.responsible_agent_id || ''}">
            <div class="current-info">
                <h4>Current Information</h4>
                <div class="info-grid">
                    <div><strong>Prospect:</strong> ${prospect.full_name || 'Unknown'}</div><div><strong>Current Agent:</strong> ${currentAgent?.full_name || 'Unassigned'}</div>
                    <div><strong>Days Inactive:</strong> <span data-days-inactive="${daysSince}">${daysSince === 999 ? 'Never contacted' : daysSince}</span></div><div><strong>Score:</strong> ${prospect.score || 0}</div>
                    <div><strong>Protection Deadline:</strong> ${prospect.protection_deadline ? UI.formatDate(prospect.protection_deadline) : 'N/A'}</div><div><strong>Last Activity:</strong> ${lastAct ? UI.formatDate(lastAct.activity_date) + ' (' + (lastAct.activity_type || 'Unknown') + ')' : 'Never'}</div>
                </div>
            </div>
            <div class="form-group">
                <label>Reassign to</label>
                <select id="reassign-agent" class="form-control">${agentOptions || '<option value="">No agents available</option>'}</select>
            </div>
            <div class="form-group">
                <label>Reason for reassignment</label>
                <div class="radio-group">
                    <label class="radio-label"><input type="radio" name="reassign-reason" value="inactive" checked> Agent inactive / unresponsive</label>
                    <label class="radio-label"><input type="radio" name="reassign-reason" value="workload"> Workload balancing</label>
                    <label class="radio-label"><input type="radio" name="reassign-reason" value="territory"> Territory realignment</label>
                    <label class="radio-label"><input type="radio" name="reassign-reason" value="request"> Prospect request</label>
                </div>
            </div>
            <div class="form-group">
                <label>Justification</label>
                <textarea id="reassign-justification" class="form-control" rows="3"></textarea>
            </div>
            <div class="form-group">
                <label class="checkbox-label"><input type="checkbox" id="reassign-notify" checked> Send notification to new agent</label>
                <label class="checkbox-label"><input type="checkbox" id="reassign-reset-protection" checked> Reset protection period (30 days)</label>
            </div>
            <div class="form-group" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;">
                <label style="font-weight:600;display:block;margin-bottom:8px;">What else should follow the new agent?</label>
                ${linkedCustomerCount > 0 ? `
                    <label class="checkbox-label" style="display:flex;align-items:flex-start;gap:8px;margin-bottom:4px;">
                        <input type="checkbox" id="reassign-cascade-customer" checked style="margin-top:3px;">
                        <span>
                            <strong>Transfer linked customer record</strong> (${linkedCustomerCount} converted customer${linkedCustomerCount > 1 ? 's' : ''})
                            <div style="font-size:11px;color:#475569;margin-top:2px;">Recommended — otherwise the new agent owns the prospect but old agent keeps the customer & future commission.</div>
                        </span>
                    </label>
                ` : `
                    <div style="font-size:12px;color:#64748b;margin-bottom:8px;font-style:italic;">No converted customer linked to this prospect.</div>
                `}
                <label class="checkbox-label" style="display:flex;align-items:flex-start;gap:8px;margin-top:8px;">
                    <input type="checkbox" id="reassign-cascade-activities" style="margin-top:3px;">
                    <span>
                        <strong>Transfer activity credit</strong> ${fromAgentActivityCount > 0 ? `(${fromAgentActivityCount} historical activit${fromAgentActivityCount > 1 ? 'ies' : 'y'} on old agent)` : '(no historical activities to transfer)'}
                        <div style="font-size:11px;color:#92400e;margin-top:2px;">⚠️ Off by default — flipping this rewrites who gets KPI credit for past CPS / calls / visits. Only enable when correcting a wrong-assignment.</div>
                        <div style="margin-top:6px;display:flex;align-items:center;gap:6px;font-size:12px;">
                            <span style="color:#475569;">From date:</span>
                            <input type="date" id="reassign-cascade-activities-from" class="form-control" style="font-size:12px;padding:2px 6px;width:auto;" value="${new Date(Date.now() - 365*24*60*60*1000).toISOString().split('T')[0]}">
                        </div>
                    </span>
                </label>
            </div>
        </div>`;
    UI.showModal(`Reassign Prospect: ${prospect.full_name || 'Unknown'}`, content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'CONFIRM REASSIGNMENT', type: 'primary', action: '(async () => { await app.confirmReassignment(); })()' }
    ]);
};

const confirmReassignment = async () => {
    try {
        const prospectId = parseInt(document.getElementById('reassign-prospect-id')?.value);
        const toAgentId = parseInt(document.getElementById('reassign-agent')?.value);
        if (!prospectId || !toAgentId) { UI.toast.error('Missing prospect or agent'); return; }

        const cascadeCustomer = document.getElementById('reassign-cascade-customer')?.checked ?? false;
        const cascadeActivitiesChecked = document.getElementById('reassign-cascade-activities')?.checked ?? false;
        const cascadeFromDate = document.getElementById('reassign-cascade-activities-from')?.value || null;
        const resetProtection = document.getElementById('reassign-reset-protection')?.checked ?? false;
        const daysInactive = parseInt(document.querySelector('[data-days-inactive]')?.dataset.daysInactive) || 0;
        const reason = document.querySelector('input[name="reassign-reason"]:checked')?.value || 'inactive';
        const reasonNotes = document.getElementById('reassign-justification')?.value || '';

        // Build preview before showing confirm popup
        const [prospect, allUsers, allCustomers, allActivities] = await Promise.all([
            AppDataStore.getById('prospects', prospectId),
            AppDataStore.getAll('users'),
            AppDataStore.getAll('customers'),
            AppDataStore.getAll('activities'),
        ]);
        const fromAgentId = prospect?.responsible_agent_id || null;
        const fromAgentName = ((allUsers || []).find(u => String(u.id) === String(fromAgentId))?.full_name)
            || (fromAgentId ? `Agent #${fromAgentId}` : 'Unassigned');
        const toAgentName = ((allUsers || []).find(u => String(u.id) === String(toAgentId))?.full_name)
            || `Agent #${toAgentId}`;
        const linkedCustomers = (allCustomers || []).filter(c => String(c.converted_from_prospect_id) === String(prospectId));
        const linkedCustomerCount = linkedCustomers.length;
        let activityTransferCount = 0;
        if (cascadeActivitiesChecked && cascadeFromDate) {
            const cutoffMs = new Date(cascadeFromDate).getTime();
            const linkedIds = new Set(linkedCustomers.map(c => String(c.id)));
            activityTransferCount = (allActivities || []).filter(a => {
                const matchesEntity = String(a.prospect_id) === String(prospectId)
                    || (a.customer_id && linkedIds.has(String(a.customer_id)));
                if (!matchesEntity) return false;
                if (fromAgentId != null && String(a.lead_agent_id) !== String(fromAgentId)) return false;
                if (!a.activity_date) return false;
                return new Date(a.activity_date).getTime() >= cutoffMs;
            }).length;
        }

        _pendingReassign = {
            kind: 'modalSingle',
            prospectId, toAgentId,
            cascadeCustomer,
            cascadeActivitiesAfter: cascadeActivitiesChecked ? cascadeFromDate : null,
            resetProtection,
            reason, reasonNotes, daysInactive,
            // Snapshot of form state — used by cancelPendingReassign to
            // restore the modal if the user backs out of the confirmation.
            formSnapshot: {
                agentValue: String(toAgentId),
                reason, justification: reasonNotes,
                cascadeCustomerChecked: cascadeCustomer,
                cascadeActivitiesChecked,
                cascadeActivitiesFromValue: cascadeFromDate || '',
                resetProtectionChecked: resetProtection,
                notifyChecked: !!document.getElementById('reassign-notify')?.checked
            }
        };

        const summaryHtml = _renderReassignSummary({
            kind: 'single',
            prospectName: prospect?.full_name,
            fromAgentName, toAgentName,
            linkedCustomerCount,
            willCascadeCustomer: cascadeCustomer,
            activityTransferCount,
            willCascadeActivities: cascadeActivitiesChecked,
            protectionResetEnabled: resetProtection
        });
        _showReassignConfirmPopup('Confirm Prospect Reassignment', summaryHtml, 'executeConfirmedReassignment');
    } catch (err) {
        UI.toast.error('Could not prepare confirmation: ' + err.message);
    }
};

const executeConfirmedReassignment = async () => {
    const p = _pendingReassign;
    if (!p || p.kind !== 'modalSingle') return;
    _pendingReassign = null;
    UI.hideModal();
    try {
        const result = await cascadeProspectReassign(p.prospectId, p.toAgentId, {
            reason: p.reason,
            reasonNotes: p.reasonNotes,
            resetProtection: p.resetProtection,
            cascadeCustomer: p.cascadeCustomer,
            cascadeActivitiesAfter: p.cascadeActivitiesAfter,
            daysInactive: p.daysInactive
        });
        if (result.skipped) {
            UI.toast.info('No change — already assigned to this agent.');
        } else {
            const bits = [];
            if (result.customersCascaded) bits.push(`${result.customersCascaded} customer record`);
            if (result.activitiesCascaded) bits.push(`${result.activitiesCascaded} activit${result.activitiesCascaded > 1 ? 'ies' : 'y'}`);
            UI.toast.success(bits.length
                ? `Prospect reassigned (also transferred: ${bits.join(', ')})`
                : 'Prospect reassigned successfully');
        }
        const container = document.getElementById('content-viewport');
        if (container) await showProtectionMonitoringView(container);
    } catch (err) {
        UI.toast.error('Reassignment failed: ' + err.message);
    }
};

const quickReassign = async (entityId, newAgentId, entityType = 'prospect') => {
    // Quick dropdown reassignment. Now requires explicit confirmation via
    // popup before the write fires. Cancel reverts the dropdown.
    newAgentId = parseInt(newAgentId);
    const id = parseInt(entityId);
    if (!id || !newAgentId) return;

    const selectEl = document.querySelector(`select[onchange*="quickReassign(${id}"]`);
    const dropdownName = selectEl?.options[selectEl.selectedIndex]?.text || '';

    let fromAgentId = null;
    let fromAgentName = 'Unassigned';
    let toAgentName = dropdownName;
    let entityName = entityType === 'customer' ? 'This customer' : 'This prospect';
    let linkedCustomerCount = 0;
    try {
        const users = await AppDataStore.getAll('users');
        const userById = (uid) => ((users || []).find(u => String(u.id) === String(uid))?.full_name) || null;
        const toAgentLookup = userById(newAgentId);
        if (!toAgentName || /^Agent$/i.test(toAgentName.trim())) {
            toAgentName = toAgentLookup || `Agent #${newAgentId}`;
        }
        if (entityType === 'customer') {
            const customer = await AppDataStore.getById('customers', id);
            if (!customer) throw new Error('Customer not found');
            fromAgentId = customer.responsible_agent_id || customer.agent_id || null;
            if (fromAgentId != null && String(fromAgentId) === String(newAgentId)) return;
            entityName = customer.full_name || entityName;
            fromAgentName = userById(fromAgentId)
                || (fromAgentId ? `Agent #${fromAgentId}` : 'Unassigned');
        } else {
            const prospect = await AppDataStore.getById('prospects', id);
            if (!prospect) throw new Error('Prospect not found');
            fromAgentId = prospect.responsible_agent_id || null;
            if (fromAgentId != null && String(fromAgentId) === String(newAgentId)) return;
            entityName = prospect.full_name || entityName;
            const customers = await AppDataStore.getAll('customers');
            fromAgentName = userById(fromAgentId)
                || (fromAgentId ? `Agent #${fromAgentId}` : 'Unassigned');
            linkedCustomerCount = (customers || []).filter(c =>
                String(c.converted_from_prospect_id) === String(id)).length;
        }
    } catch (err) {
        if (selectEl && fromAgentId != null) selectEl.value = String(fromAgentId);
        UI.toast.error('Could not load: ' + err.message);
        return;
    }

    // Revert dropdown to OLD agent immediately. The dropdown only flips to
    // the new agent if the user explicitly clicks "Yes, Shift Everything
    // Over" in the popup. This way the × close button can't leave the
    // dropdown lying about its DB state.
    if (selectEl && fromAgentId != null) {
        try { selectEl.value = String(fromAgentId); } catch (_) {}
    }

    _pendingReassign = {
        kind: 'quick',
        entityType, id, newAgentId,
        selectEl, fromAgentId, optimisticName: toAgentName
    };

    const summaryHtml = _renderReassignSummary({
        kind: 'single',
        prospectName: entityName,
        fromAgentName,
        toAgentName,
        linkedCustomerCount: entityType === 'prospect' ? linkedCustomerCount : 0,
        willCascadeCustomer: entityType === 'prospect',
        activityTransferCount: 0,
        willCascadeActivities: false,
        protectionResetEnabled: false
    });
    _showReassignConfirmPopup(
        entityType === 'customer' ? 'Confirm Customer Reassignment' : 'Confirm Prospect Reassignment',
        summaryHtml,
        'executeConfirmedQuickReassign'
    );
};

const executeConfirmedQuickReassign = async () => {
    const p = _pendingReassign;
    if (!p || p.kind !== 'quick') return;
    _pendingReassign = null;
    UI.hideModal();
    // Flip dropdown to NEW agent now that user confirmed (we reverted to old
    // when showing the popup so that × close left it correct).
    if (p.selectEl && p.newAgentId != null) {
        try { p.selectEl.value = String(p.newAgentId); } catch (_) {}
    }
    try {
        if (p.entityType === 'customer') {
            const result = await cascadeCustomerReassign(p.id, p.newAgentId);
            if (result.skipped) return;
            const extra = result.prospectSynced ? ' (source prospect synced)' : '';
            UI.toast.success(`Customer reassigned to ${p.optimisticName}${extra}`);
        } else {
            const result = await cascadeProspectReassign(p.id, p.newAgentId, {
                reason: 'manual',
                reasonNotes: 'Quick reassign from table',
                cascadeCustomer: true,
                cascadeActivitiesAfter: null
            });
            if (result.skipped) return;
            const extra = result.customersCascaded
                ? ` (also moved ${result.customersCascaded} customer record)`
                : '';
            UI.toast.success(`Reassigned to ${p.optimisticName}${extra}`);
        }
    } catch (err) {
        if (p.selectEl && p.fromAgentId != null) {
            try { p.selectEl.value = String(p.fromAgentId); } catch (_) {}
        }
        UI.toast.error('Reassignment failed: ' + err.message);
    }
};

const bulkReassign = async (agentId) => {
    const [agent, allProspects, allActivities, allUsers] = await Promise.all([
        AppDataStore.getById('users', agentId),
        AppDataStore.getAll('prospects'),
        AppDataStore.getAll('activities'),
        AppDataStore.getAll('users'),
    ]);
    if (!agent) { UI.toast.error('Agent not found'); return; }
    const now = new Date();
    const agentProspects = allProspects.filter(p => String(p.responsible_agent_id) === String(agentId));
    const inactiveProspects = agentProspects.filter(p => {
        const pActs = allActivities.filter(a => String(a.prospect_id) === String(p.id)).sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date));
        const last = pActs[0];
        p._daysSince = last ? Math.floor((now - new Date(last.activity_date)) / (1000 * 60 * 60 * 24)) : 999;
        return p._daysSince > 7;
    }).sort((a, b) => b._daysSince - a._daysSince);
    if (!inactiveProspects.length) { UI.toast.info('No inactive prospects found for this agent'); return; }
    const avgDays = Math.round(inactiveProspects.reduce((s, p) => s + (p._daysSince === 999 ? 0 : p._daysSince), 0) / inactiveProspects.length);
    const otherAgents = allUsers.filter(u => {
        const lvl = _getUserLevel(u);
        return lvl >= 3 && lvl <= 11 && u.status !== 'deleted' && u.id !== agentId;
    });
    const prospectCheckboxes = inactiveProspects.map(p =>
        `<label class="checkbox-label"><input type="checkbox" checked data-prospect-id="${p.id}"> ${p.full_name || 'Unknown'} (${p._daysSince === 999 ? 'Never' : p._daysSince + 'd'}, Score ${p.score || 0})</label>`
    ).join('');
    const perAgent = otherAgents.length ? Math.ceil(inactiveProspects.length / otherAgents.length) : 0;
    const distPreview = otherAgents.map((a, i) => {
        const share = i < inactiveProspects.length % otherAgents.length ? perAgent : Math.floor(inactiveProspects.length / otherAgents.length);
        return `<li>${a.full_name || 'Agent'}: ${share} prospects</li>`;
    }).join('');
    const singleAgentOptions = otherAgents.map(a => `<option value="${a.id}">${a.full_name || 'Agent'}</option>`).join('');
    const content = `<div class="bulk-reassign-modal">
        <input type="hidden" id="bulk-reassign-from-agent" value="${agentId}">
        <div style="background:var(--gray-50);padding:16px;border-radius:8px;margin-bottom:16px">
            <div><strong>From Agent:</strong> ${agent.full_name || 'Unknown'}</div><div><strong>Average inactive days:</strong> ${avgDays}</div><div><strong>Prospects selected:</strong> ${inactiveProspects.length}</div>
        </div>
        <div class="selected-prospects"><h4>Selected Prospects</h4><div class="prospects-list" style="max-height:200px;overflow-y:auto">
            ${prospectCheckboxes}
        </div></div>
        <div class="form-group">
            <label>Reassign to</label>
            <div class="radio-group">
                <label class="radio-label"><input type="radio" name="bulk-option" value="distribute" checked onchange="document.getElementById('bulk-single-agent').style.display='none'"> Distribute evenly among active agents</label>
                <label class="radio-label"><input type="radio" name="bulk-option" value="single" onchange="document.getElementById('bulk-single-agent').style.display='block'"> Assign all to single agent</label>
            </div>
            <select id="bulk-single-agent" class="form-control" style="display:none;margin-top:8px">${singleAgentOptions}</select>
        </div>
        <div class="distribution-preview"><h4>Distribution Preview</h4><ul>${distPreview || '<li>No agents available</li>'}</ul></div>
        <div class="form-group"><label>Justification</label><textarea class="form-control" rows="3">${agent.full_name || 'Agent'} has ${inactiveProspects.length} inactive prospect${inactiveProspects.length !== 1 ? 's' : ''}. Redistributing to other agents.</textarea></div>
        <div class="form-group" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;">
            <label style="font-weight:600;display:block;margin-bottom:8px;font-size:13px;">What else should follow the new agent?</label>
            <label class="checkbox-label" style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;">
                <input type="checkbox" id="bulkmon-cascade-customer" checked style="margin-top:3px;">
                <span>
                    <strong>Transfer linked customer records</strong>
                    <div style="font-size:11px;color:#475569;margin-top:2px;">Recommended — keeps prospect ownership and customer commission aligned.</div>
                </span>
            </label>
            <label class="checkbox-label" style="display:flex;align-items:flex-start;gap:8px;">
                <input type="checkbox" id="bulkmon-cascade-activities" style="margin-top:3px;">
                <span>
                    <strong>Transfer activity credit</strong>
                    <div style="font-size:11px;color:#92400e;margin-top:2px;">⚠️ Off by default — rewrites who gets KPI credit for past CPS / calls / visits.</div>
                    <div style="margin-top:6px;display:flex;align-items:center;gap:6px;font-size:12px;">
                        <span style="color:#475569;">From date:</span>
                        <input type="date" id="bulkmon-cascade-activities-from" class="form-control" style="font-size:12px;padding:2px 6px;width:auto;" value="${new Date(Date.now() - 365*24*60*60*1000).toISOString().split('T')[0]}">
                    </div>
                </span>
            </label>
        </div>
    </div>`;
    UI.showModal('Bulk Reassignment', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'CONFIRM BULK REASSIGNMENT', type: 'primary', action: '(async () => { await app.confirmBulkReassignment(); })()' }
    ]);
};

const confirmBulkReassignment = async () => {
    try {
        const option = document.querySelector('input[name="bulk-option"]:checked')?.value || 'distribute';
        const checkedProspectIds = Array.from(document.querySelectorAll('.prospects-list input[type="checkbox"]:checked'))
            .map(cb => parseInt(cb.dataset.prospectId))
            .filter(id => !isNaN(id));
        const justification = document.querySelector('.bulk-reassign-modal textarea')?.value || 'Bulk reassignment';
        if (!checkedProspectIds.length) { UI.toast.error('No prospects selected'); return; }

        const allProspects = await AppDataStore.getAll('prospects');
        const matchedProspects = allProspects.filter(p => checkedProspectIds.includes(p.id));
        const fromAgentId = parseInt(document.getElementById('bulk-reassign-from-agent')?.value) || null;

        const allUsers = await AppDataStore.getAll('users');
        let targetAgents;
        if (option === 'single') {
            const singleId = parseInt(document.getElementById('bulk-single-agent')?.value);
            const singleAgent = allUsers.find(u => u.id === singleId);
            targetAgents = singleAgent ? [singleAgent] : [];
        } else {
            targetAgents = allUsers.filter(u => {
                const lvl = _getUserLevel(u);
                return lvl >= 3 && lvl <= 11 && u.status !== 'deleted' && u.id !== fromAgentId;
            });
        }
        if (!targetAgents.length) { UI.toast.error('No active agents to assign to'); return; }

        const cascadeCustomer = document.getElementById('bulkmon-cascade-customer')?.checked ?? true;
        const cascadeActivitiesChecked = document.getElementById('bulkmon-cascade-activities')?.checked ?? false;
        const cascadeFromDate = document.getElementById('bulkmon-cascade-activities-from')?.value || null;

        // Preview cascade scope
        const allCustomers = await AppDataStore.getAll('customers');
        const matchedIds = new Set(matchedProspects.map(p => String(p.id)));
        const linkedCount = (allCustomers || []).filter(c =>
            matchedIds.has(String(c.converted_from_prospect_id))).length;

        _pendingReassign = {
            kind: 'bulkMonitoring',
            option,
            fromAgentId,
            cascadeCustomer,
            cascadeActivitiesAfter: cascadeActivitiesChecked ? cascadeFromDate : null,
            justification,
            matchedProspects: matchedProspects.map(p => ({ id: p.id, responsible_agent_id: p.responsible_agent_id })),
            targetAgents: targetAgents.map(a => ({ id: a.id, full_name: a.full_name }))
        };

        const summaryHtml = _renderReassignSummary({
            kind: 'bulk',
            toAgentName: option === 'single' ? targetAgents[0]?.full_name : null,
            bulkCount: matchedProspects.length,
            bulkLinkedCustomers: linkedCount,
            bulkCustomerCascadeEnabled: cascadeCustomer,
            bulkActivityCascadeEnabled: cascadeActivitiesChecked
        });
        _showReassignConfirmPopup('Confirm Bulk Reassignment', summaryHtml, 'executeConfirmedBulkReassignment');
    } catch (err) {
        UI.toast.error('Could not prepare confirmation: ' + err.message);
    }
};

const executeConfirmedBulkReassignment = async () => {
    const p = _pendingReassign;
    if (!p || p.kind !== 'bulkMonitoring') return;
    _pendingReassign = null;
    UI.hideModal();
    try {
        let count = 0, totalCust = 0, totalActs = 0, errors = 0;
        for (let i = 0; i < p.matchedProspects.length; i++) {
            const prospect = p.matchedProspects[i];
            const targetAgent = p.targetAgents[i % p.targetAgents.length];
            try {
                const result = await cascadeProspectReassign(prospect.id, targetAgent.id, {
                    reason: 'bulk_reassignment',
                    reasonNotes: p.justification,
                    cascadeCustomer: p.cascadeCustomer,
                    cascadeActivitiesAfter: p.cascadeActivitiesAfter
                });
                totalCust += result.customersCascaded || 0;
                totalActs += result.activitiesCascaded || 0;
                if (!result.skipped) count++;
            } catch { errors++; }
        }
        const bits = [];
        if (totalCust) bits.push(`${totalCust} customer record${totalCust > 1 ? 's' : ''}`);
        if (totalActs) bits.push(`${totalActs} activit${totalActs > 1 ? 'ies' : 'y'}`);
        const tail = bits.length ? ` (also transferred: ${bits.join(', ')})` : '';
        const errTail = errors ? ` — ${errors} failed.` : '';
        UI.toast.success(`${count} prospect${count !== 1 ? 's' : ''} reassigned${tail}${errTail}`);
        const container = document.getElementById('content-viewport');
        if (container) await showProtectionMonitoringView(container);
    } catch (err) {
        UI.toast.error('Reassignment failed: ' + err.message);
    }
};

const refreshFollowupStats = async () => {
    const container = document.getElementById('content-viewport');
    if (container) {
        await showProtectionMonitoringView(container);
        UI.toast.success('Follow-up statistics refreshed');
    }
};

const exportFollowupReport = async () => {
    try {
        const [prospects, agents, activities] = await Promise.all([
            AppDataStore.getAll('prospects'),
            AppDataStore.getAll('users'),
            AppDataStore.getAll('activities'),
        ]);
        const agentMap = Object.fromEntries(agents.map(a => [a.id, a.full_name]));
        const now = new Date();
        const rows = prospects.map(p => {
            const lastActivity = activities
                .filter(a => a.prospect_id === p.id)
                .sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date))[0];
            const daysSince = lastActivity
                ? Math.floor((now - new Date(lastActivity.activity_date)) / (1000 * 60 * 60 * 24))
                : null;
            return [
                p.full_name || '',
                p.phone || '',
                agentMap[p.responsible_agent_id] || 'Unassigned',
                p.score || 0,
                p.status || 'new',
                lastActivity ? lastActivity.activity_date : 'Never',
                daysSince !== null ? daysSince : 'N/A'
            ];
        });
        const cols = ['Prospect Name', 'Phone', 'Responsible Agent', 'Score', 'Status', 'Last Activity Date', 'Days Since Last Activity'];
        const csvRows = [cols, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `followup_report_${new Date().toISOString().slice(0,10)}.csv`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        UI.toast.success(`Follow-up report exported (${rows.length} prospects)`);
    } catch (err) {
        UI.toast.error('Export failed: ' + err.message);
    }
};

const configureAlerts = () => {
    let config = {};
    try {
        config = JSON.parse(localStorage.getItem('fs_crm_alert_config') || '{}') || {};
    } catch (_) {
        // Corrupt localStorage payload — reset to defaults rather than crashing the alerts UI.
        localStorage.removeItem('fs_crm_alert_config');
        config = {};
    }
    const warningDays = config.warningDays || 7;
    const criticalDays = config.criticalDays || 14;
    const autoReassign = config.autoReassign || false;
    const autoReassignDays = config.autoReassignDays || 21;
    const content = `
        <div class="alert-config-modal">
            <div class="form-group">
                <label>Warning threshold (days inactive)</label>
                <input type="number" id="alert-warning-days" class="form-control" value="${warningDays}" min="1" max="30">
                <small style="color:var(--gray-500)">Prospects inactive for this many days will show as "Attention"</small>
            </div>
            <div class="form-group">
                <label>Critical threshold (days inactive)</label>
                <input type="number" id="alert-critical-days" class="form-control" value="${criticalDays}" min="1" max="60">
                <small style="color:var(--gray-500)">Prospects inactive beyond this will show as "Critical"</small>
            </div>
            <hr style="border:none;border-top:1px solid var(--gray-200);margin:16px 0">
            <div class="form-group">
                <label class="checkbox-label"><input type="checkbox" id="alert-auto-reassign" ${autoReassign ? 'checked' : ''}> Enable auto-reassign suggestion</label>
                <small style="color:var(--gray-500)">Flag prospects for reassignment after the threshold below</small>
            </div>
            <div class="form-group">
                <label>Auto-reassign suggestion after (days)</label>
                <input type="number" id="alert-auto-days" class="form-control" value="${autoReassignDays}" min="1" max="90">
            </div>
        </div>`;
    UI.showModal('Configure Alerts', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Save Configuration', type: 'primary', action: '(async () => { app.saveAlertConfig(); })()' }
    ]);
};

const saveAlertConfig = () => {
    const config = {
        warningDays: parseInt(document.getElementById('alert-warning-days')?.value) || 7,
        criticalDays: parseInt(document.getElementById('alert-critical-days')?.value) || 14,
        autoReassign: document.getElementById('alert-auto-reassign')?.checked || false,
        autoReassignDays: parseInt(document.getElementById('alert-auto-days')?.value) || 21
    };
    localStorage.setItem('fs_crm_alert_config', JSON.stringify(config));
    UI.hideModal();
    UI.toast.success('Alert configuration saved');
};

const viewAgentDetails = async (agentIdOrName) => {
    if (typeof agentIdOrName === 'number' || !isNaN(parseInt(agentIdOrName))) {
        await (window.app.showAgentDetail || (() => {}))(parseInt(agentIdOrName));
    } else {
        const agents = await AppDataStore.getAll('users');
        const agent = agents.find(a => a.full_name?.toLowerCase().includes(String(agentIdOrName).toLowerCase()));
        if (agent) await (window.app.showAgentDetail || (() => {}))(agent.id);
        else UI.toast.info(`Agent "${agentIdOrName}" not found in database`);
    }
};
const contactProspect = async (prospectId) => { await (window.app.openActivityModal || (() => {}))(null, prospectId); };

// Phase 13: seed demo data

// --- Helper to check if a user exists (outer scope so it can be exported) ---
const userExists = async (userId) => {
    const user = await AppDataStore.getById('users', userId);
    return !!user;
};

const initImportDemoData = async () => {
// Clear demo data if requested (optional)
if (window.location.search.includes('resetDemo=true')) {
    const tables = ['import_jobs', 'reassignment_history'];
    for (const table of tables) {
        const all = await AppDataStore.getAll(table);
        const demoItems = all.filter(item => item.is_demo);
        for (const item of demoItems) {
            await AppDataStore.delete(table, item.id).catch(() => {});
        }
    }
    UI.toast.info('Demo data cleared.');
}

// --- Import Jobs ---
const importJobs = await AppDataStore.getAll('import_jobs');
if (importJobs.length === 0) {
    // Only create jobs if user 5 exists
    if (await userExists(5)) {
        const jobs = [
            { id: 9001, file_name: 'leads_march_2026.xlsx', import_type: 'prospects', total_rows: 250, valid_rows: 235, error_rows: 15, created_records: 217, updated_records: 18, skipped_records: 15, status: 'completed', mapping_config: {}, duplicate_handling: 'skip', assignment_config: { assignTo: 'myself' }, created_by: 5, created_at: '2026-03-05T14:30:00Z', completed_at: '2026-03-05T14:32:35Z' },
            { id: 9002, file_name: 'customers_feb.xlsx', import_type: 'customers', total_rows: 128, valid_rows: 122, error_rows: 6, created_records: 115, updated_records: 7, skipped_records: 6, status: 'completed', mapping_config: {}, duplicate_handling: 'update', assignment_config: { assignTo: 'team' }, created_by: 5, created_at: '2026-02-28T10:15:00Z', completed_at: '2026-02-28T10:17:22Z' },
            { id: 9003, file_name: 'agents_2026.xlsx', import_type: 'agents', total_rows: 15, valid_rows: 15, error_rows: 0, created_records: 15, updated_records: 0, skipped_records: 0, status: 'completed', mapping_config: {}, duplicate_handling: 'skip', assignment_config: {}, created_by: 1, created_at: '2026-02-15T09:00:00Z', completed_at: '2026-02-15T09:01:00Z' },
            { id: 9004, file_name: 'product_catalog.xlsx', import_type: 'products', total_rows: 45, valid_rows: 0, error_rows: 45, created_records: 0, updated_records: 0, skipped_records: 0, status: 'failed', mapping_config: {}, duplicate_handling: 'skip', assignment_config: {}, created_by: 5, created_at: '2026-02-10T09:45:00Z', completed_at: '2026-02-10T09:45:30Z' }
        ];
        for (const j of jobs) {
            try {
                await AppDataStore.create('import_jobs', j);
            } catch (err) {
                console.warn(`Skipping import_job ${j.id}:`, err.message);
            }
        }
    } else {
        // Skipping import_jobs seeding: user 5 does not exist
    }
}

// --- Reassignment History ---
const reassignmentsAll = await AppDataStore.getAll('reassignment_history');
if (reassignmentsAll.length === 0) {
    // Check that all referenced users exist
    const usersExist = await Promise.all([userExists(8), userExists(6), userExists(5), userExists(7), userExists(3)]);
    if (usersExist.every(v => v === true)) {
        const reassignments = [
            { id: 8001, prospect_id: 101, from_agent_id: 8, to_agent_id: 6, reassigned_by: 5, reassignment_date: '2026-03-06T10:23:00Z', reassignment_reason: 'inactive', reason_notes: 'Raj Kumar unresponsive', days_inactive: 14, protection_deadline: '2026-03-17', created_at: '2026-03-06T10:23:00Z' },
            { id: 8002, prospect_id: 102, from_agent_id: 8, to_agent_id: 5, reassigned_by: 5, reassignment_date: '2026-03-05T15:45:00Z', reassignment_reason: 'inactive', reason_notes: 'High score prospect', days_inactive: 16, protection_deadline: '2026-03-15', created_at: '2026-03-05T15:45:00Z' },
            { id: 8003, prospect_id: 103, from_agent_id: 6, to_agent_id: 7, reassigned_by: 3, reassignment_date: '2026-03-04T09:30:00Z', reassignment_reason: 'workload', reason_notes: 'Balancing workload', days_inactive: 12, protection_deadline: '2026-03-20', created_at: '2026-03-04T09:30:00Z' }
        ];
        for (const r of reassignments) {
            try {
                await AppDataStore.create('reassignment_history', r);
            } catch (err) {
                console.warn(`Skipping reassignment_history ${r.id}:`, err.message);
            }
        }
    } else {
        // Skipping reassignment_history seeding: referenced users missing
    }
}
};

    Object.assign(window.app, {
        showImportDashboard,
        renderRecentImports,
        openImportWizard,
        getWizardStepsHtml,
        updateWizardModal,
        renderImportStep,
        getStep1Html,
        getStep2Html,
        getStep3Html,
        getStep4Html,
        getStep5Html,
        renderMappingRows,
        getCRMFieldsForType,
        autoMatchField,
        handleImportFileDrop,
        handleImportFileSelect,
        processImportFile,
        buildReverseMapping,
        normalisePhone,
        mapRowToRecord,
        mapRowToMarketingRecord,
        updateImportProgress,
        runValidation,
        runDuplicateCheck,
        importNextStep,
        importPrevStep,
        updateImportType,
        autoMapFields,
        clearMapping,
        clearMappingField,
        downloadErrorReport,
        startImport,
        viewImportDetails,
        downloadImportLog,
        openTemplatesModal,
        downloadTemplate,
        exportMarketingList,
        openImportWizardForType,
        showImportHistory,
        showProtectionMonitoringView,
        renderTeamSummaryCards,
        renderAgentPerformanceRows,
        renderInactiveProspectsRows,
        renderReassignmentHistory,
        cascadeProspectReassign,
        cascadeCustomerReassign,
        _renderReassignSummary,
        _showReassignConfirmPopup,
        cancelPendingReassign,
        openReassignModal,
        confirmReassignment,
        executeConfirmedReassignment,
        quickReassign,
        executeConfirmedQuickReassign,
        bulkReassign,
        confirmBulkReassignment,
        executeConfirmedBulkReassignment,
        refreshFollowupStats,
        exportFollowupReport,
        configureAlerts,
        saveAlertConfig,
        viewAgentDetails,
        contactProspect,
        userExists,
    });
})();