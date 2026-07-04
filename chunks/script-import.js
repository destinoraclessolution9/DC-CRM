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
    // Atomic, race-free LTV + total_purchases adjuster (defined in script.js core,
    // exported on window._crmUtils). Used by the import auto-convert path so an
    // imported sale lands in the purchases table + total_purchases exactly like
    // the approvals/savePurchase paths — never a bare lifetime_value write
    // (audit #9 leaderboard/LTV divergence). Defensive alias with a no-op fallback.
    const adjustCustomerLtv = (...a) => (_utils.adjustCustomerLtv || (async () => {}))(...a);

    // BUG #4: the Protection Monitoring classifiers key on calculateProtectionDays,
    // which is defined in chunks/script-prospects.js and undefined on a fresh
    // session that lands here first. The old fallback `() => 0` reported every
    // prospect as protDays<=0 → ALL critical. Replicate the real pure computation
    // locally (identical logic: parse the deadline as LOCAL midnight, whole-day
    // diff, floored at 0) so the classification is correct with or without the
    // prospects chunk loaded. Prefer the canonical fn when it IS registered.
    const _calcProtDaysFallback = (prospect) => {
        if (!prospect || !prospect.protection_deadline) return 0;
        const parts = String(prospect.protection_deadline).split('T')[0].split('-');
        const deadline = new Date(+parts[0], (+parts[1] || 1) - 1, +parts[2] || 1);
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const diffDays = Math.round((deadline - today) / (1000 * 60 * 60 * 24));
        return diffDays > 0 ? diffDays : 0;
    };
    const calcProtectionDays = (p) => (window.app.calculateProtectionDays || _calcProtDaysFallback)(p);

    // React-island flag (default-on) for the Protection Monitoring view.
    // Kill-switch → legacy: window.__REACT_PROTECTION===false, ?react=0, crm_react_off='1'.
    const _reactProtectionOn = () => {
        try {
            if (window.__REACT_PROTECTION === false) return false;
            if (/[?&]react=0/.test(location.search)) return false;
            if (localStorage.getItem('crm_react_off') === '1') return false;
            return !!(window.CRMReact && typeof window.CRMReact.mountProtectionMonitoring === 'function');
        } catch (_) { return false; }
    };

// ========== PHASE 13: IMPORT SYSTEM FUNCTIONS ==========

let _currentImportStep = 1;
let _importData = { file: null, fileName: null, fileSize: null, rows: 0, headers: ['Full Name', 'Phone Number', 'Email', 'IC Number', 'Date of Birth', 'Occupation', 'Income Range', 'Address', 'City', 'State', 'Postal Code', 'Ming Gua'], data: [], importType: 'prospects', mapping: {}, validation: { valid: 0, warnings: 0, errors: 0 }, duplicates: { total: 0 }, assignment: { assignTo: 'myself' } };

// Pure HTML head for showImportDashboard: everything up to (and including) the
// <tbody> open tag that hosts the awaited recent-imports rows. Byte-exact split.
const buildImportDashboardHead = () => `
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
                        <tbody id="imports-table-body">`;

// Pure HTML tail for showImportDashboard: everything after the awaited
// recent-imports rows (the <tbody> close onward). Byte-exact split.
const buildImportDashboardTail = () => `</tbody>
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

const showImportDashboard = async (container) => {
    container.innerHTML = buildImportDashboardHead() + await renderRecentImports() + buildImportDashboardTail();
};

const renderRecentImports = async () => {
    const imports = (await AppDataStore.getAll('import_jobs')).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);
    if (imports.length === 0) return `<tr><td colspan="7" style="text-align:center;padding:40px;"><i class="fas fa-cloud-upload-alt" style="font-size:48px;color:var(--gray-300);display:block;margin-bottom:16px;"></i><h3>No imports yet</h3><p>Click "IMPORT NEW DATA" to start your first import</p></td></tr>`;
    return imports.map(imp => {
        const pct = imp.total_rows > 0 ? Math.round((imp.valid_rows / imp.total_rows) * 100) : 0;
        // Null-safe + escaped, mirroring showImportHistory: a null/undefined status
        // would otherwise throw on .toUpperCase() and abort the whole dashboard
        // innerHTML render; import_type/status are now escaped like file_name.
        return `<tr><td><strong>${esc(imp.file_name)}</strong></td><td>${esc(String(imp.import_type||''))}</td><td>${imp.total_rows} (${imp.created_records} new)</td><td>${pct}%</td><td><span class="import-status status-${esc(String(imp.status||''))}">${esc(String(imp.status||'').toUpperCase())}</span></td><td>${UI.formatDate(imp.created_at)}</td><td><button class="btn-icon" onclick="app.viewImportDetails(${imp.id})" title="View"><i class="fas fa-eye"></i></button><button class="btn-icon" onclick="app.downloadImportLog(${imp.id})" title="Download Log"><i class="fas fa-download"></i></button></td></tr>`;
    }).join('');
};

const openImportWizard = async () => {
    // R9: Only system admin, marketing manager, or team leader may import
    const u = _state.cu;
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
                        <!-- BUG (data-integrity): 'agents' import had NO table-map entry, so it fell
                             through to the prospects table — agent rows were silently written as
                             prospects with agent_code discarded. Agents are auth-provisioned users
                             (role/auth/code), not a plain table insert, so the option is removed
                             rather than wired into a half-implemented users-insert path. -->
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
                    <label class="checkbox-label" style="opacity:.55"><input type="checkbox" id="stop-on-error" disabled> Stop on first error <span style="color:var(--gray-400);font-size:12px">(not yet enforced)</span></label>
                    <label class="checkbox-label" style="opacity:.55"><input type="checkbox" id="continue-warnings" checked disabled> Continue on warnings <span style="color:var(--gray-400);font-size:12px">(not yet enforced)</span></label>
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
            <td>${esc(existName)}${existPhone ? ' (' + esc(existPhone) + ')' : ''}</td>
            <td>${esc(importName)}${importPhone ? ' (' + esc(importPhone) + ')' : ''}</td>
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
    const assignLabel = _state.cu?.full_name || _state.cu?.name || 'Me';
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
                    <label class="radio-label"><input type="radio" name="assign-to" value="myself" checked> Assign to myself (${esc(assignLabel)})</label>
                    <!-- BUG (broken-feature): the "Assign to team" radio + Team A-Z <select> +
                         "Distribute evenly" checkbox were dead — startImport only honoured
                         'myself', so 'team' was byte-identical to 'unassigned' (records imported
                         unassigned, the team select/distribute had no id and were never read).
                         Removed the option + its sub-controls so the UI cannot promise behaviour
                         the code does not perform. -->
                    <label class="radio-label"><input type="radio" name="assign-to" value="unassigned"> Leave unassigned</label>
                </div>
                <div class="import-options" style="margin:16px 0">
                    <h4>Import Options</h4>
                    <label class="checkbox-label" style="opacity:.55"><input type="checkbox" checked disabled> Send notification when complete <span style="color:var(--gray-400);font-size:12px">(not yet enforced)</span></label>
                    <label class="checkbox-label" style="opacity:.55"><input type="checkbox" disabled> Create backup before import <span style="color:var(--gray-400);font-size:12px">(not yet enforced)</span></label>
                    <label class="checkbox-label" style="opacity:.55"><input type="checkbox" checked disabled> Log all changes for audit <span style="color:var(--gray-400);font-size:12px">(not yet enforced)</span></label>
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
    const savedMapping = _importData.mapping || {};
    const validValues = new Set(crmFields.map(f => f.value));
    // Once the user has committed a mapping, untouched columns must stay on
    // '-- Ignore --' rather than snapping back to an auto-matched default.
    const captured = !!_importData._mappingCaptured;
    return headers.map((header, index) => {
        // BUG #11: prefer the user's previously-captured mapping for this column
        // (so returning to step 2 from step 3 keeps their corrections) and only
        // fall back to auto-match when they never committed a mapping. A saved
        // value that isn't a field of the current import type is dropped (the
        // import type changed) and re-auto-matched.
        const saved = savedMapping[index];
        const matched = (saved !== undefined && validValues.has(saved))
            ? saved
            : (captured ? '' : autoMatchField(header, _importData.importType));
        return `<tr><td><strong>${esc(header)}</strong></td><td>
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
    if (type === 'prospects') return [...common, ...extraProspect, { value: 'lifetime_value', label: 'Purchase Amount (auto-converts to customer)' }];
    if (type === 'customers') return [...common, ...extraProspect, { value: 'customer_since', label: 'Customer Since' }, { value: 'lifetime_value', label: 'Purchase Amount / Lifetime Value' }];
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
    const map = { 'full name': 'full_name', 'name': 'full_name', 'phone': 'phone', 'mobile': 'phone', 'email': 'email', 'ic': 'ic_number', 'ic number': 'ic_number', 'nric': 'ic_number', 'dob': 'date_of_birth', 'date of birth': 'date_of_birth', 'occupation': 'occupation', 'income': 'income_range', 'address': 'address', 'city': 'city', 'state': 'state', 'postcode': 'postal_code', 'postal': 'postal_code', 'postal code': 'postal_code', 'ming gua': 'ming_gua', 'gender': 'gender', 'title': 'title', 'nationality': 'nationality', 'lunar': 'lunar_birth', 'company': 'company_name', 'referred by': 'referred_by', 'referral relationship': 'referral_relationship', 'relationship': 'referral_relationship', 'pipeline': 'pipeline_stage', 'stage': 'pipeline_stage', 'close date': 'expected_close_date', 'expected close': 'expected_close_date', 'deal value': 'deal_value', 'customer since': 'customer_since', 'join date': 'customer_since', 'date joined': 'customer_since', 'amount': 'lifetime_value', 'purchase': 'lifetime_value', 'spend': 'lifetime_value', 'lifetime': 'lifetime_value', 'ltv': 'lifetime_value', 'total spent': 'lifetime_value' };
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

// A LEADING minus (after optional currency/space, e.g. "-50" / "-RM 1,200") is
// preserved so refunds/credit adjustments import as negative; previously the
// minus was stripped by the [^0-9.] filter, silently flipping them to positive.
// A non-leading '-' (e.g. "1-2") is still ignored. Magnitude logic unchanged.
const _parseAmount = (raw) => { const s = (raw || '').toString(); const n = parseFloat(s.replace(/[^0-9.]/g, '')); if (!Number.isFinite(n)) return 0; return /^[^\d]*-/.test(s) ? -n : n; };

// Local (MYT) YYYY-MM-DD for a Date (defaults to now). toISOString() gives the UTC
// day, which is the PREVIOUS day before 08:00 MYT — mis-bucketing persisted dates
// (customer_since, protection_deadline, purchase date) into the prior period.
const _impLocalDay = (dt = new Date()) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
// Normalise a customer_since cell into a YYYY-MM-DD purchase date for the synthetic
// "Opening balance (imported)" row. The sheet is parsed WITHOUT cellDates (see line ~515
// XLSX.read + sheet_to_json), so a date column arrives as an Excel SERIAL NUMBER, and
// Malaysian sheets commonly use DD/MM/YYYY — both must be handled, or the purchase lands
// in the wrong period (a raw `new Date('45658')` parses to the year 45658, and
// `new Date('15/3/2025')` is Invalid → today). Order: ISO passthrough → Excel serial →
// DD/MM/YYYY (day-first) → free-text with a plausible-year guard → today as last resort.
// The plausible window (1970–2100) also stops a stray non-date value from becoming a
// bogus far-future/past date. (audit import:594)
const _OB_YEAR_MIN = 1970, _OB_YEAR_MAX = 2100;
const _openingBalanceDate = (cs) => {
    const today = _impLocalDay();
    if (cs == null || cs === '') return today;
    const s = String(cs).trim();
    if (!s) return today;
    // Already ISO (what mapRowToRecord synthesizes for a blank cell) → take the day part.
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    // Excel serial date → convert via the 1899-12-30 epoch (accounts for the Lotus 1900
    // leap-year bug). Bounded to plausible serials (1970-01-01=25569 .. 2100-01-01=73051)
    // so an amount mis-mapped into this column can't masquerade as a date.
    if (/^\d+(\.\d+)?$/.test(s)) {
        const serial = parseFloat(s);
        if (serial >= 25569 && serial <= 73051) {
            const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
            if (!isNaN(d.getTime())) return _impLocalDay(d);
        }
        return today;
    }
    // DD/MM/YYYY or DD-MM-YYYY (Malaysia locale) → interpret DAY-first, unlike JS Date's
    // month-first parse, so '15/3/2025' and '3/4/2025' both read as day/month/year.
    const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (dmy) {
        let dd = parseInt(dmy[1], 10), mm = parseInt(dmy[2], 10), yy = parseInt(dmy[3], 10);
        if (yy < 100) yy += yy < 70 ? 2000 : 1900;
        if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
            const d = new Date(yy, mm - 1, dd);
            if (!isNaN(d.getTime()) && d.getFullYear() >= _OB_YEAR_MIN && d.getFullYear() <= _OB_YEAR_MAX) return _impLocalDay(d);
        }
        return today;
    }
    // Free-text ('March 2025', etc.): trust JS Date but REJECT an implausible year so a
    // mis-parse (e.g. the year-45658 trap) can never push the purchase millennia away.
    const d = new Date(s);
    if (!isNaN(d.getTime()) && d.getFullYear() >= _OB_YEAR_MIN && d.getFullYear() <= _OB_YEAR_MAX) return _impLocalDay(d);
    return today;
};

const mapRowToRecord = (row, reverseMap, agentId, importType = 'prospects') => {
    const get = (field) => {
        const idx = reverseMap[field];
        return idx !== undefined ? (row[idx] || '').toString().trim() : '';
    };
    // Customers import → a permanent, ACTIVE customer record (no prospect-only
    // columns, no approval). Empty date fields must be null, not '' (date cols).
    if (importType === 'customers') {
        return {
            full_name: get('full_name'),
            gender: get('gender'),
            nationality: get('nationality'),
            phone: get('phone'),
            email: get('email'),
            ic_number: get('ic_number'),
            date_of_birth: get('date_of_birth') || null,
            lunar_birth: get('lunar_birth'),
            occupation: get('occupation'),
            company_name: get('company_name'),
            income_range: get('income_range'),
            address: get('address'),
            city: get('city'),
            state: get('state'),
            postal_code: get('postal_code'),
            ming_gua: get('ming_gua'),
            responsible_agent_id: agentId,
            // Clamp to >= 0: lifetime_value is a cumulative balance, not a signed
            // adjustment, and _parseAmount now preserves a leading minus. A negative
            // imported LTV (e.g. "-RM 1,200") would otherwise bypass the Math.max(0,…)
            // clamp every other LTV path applies and push aggregates negative.
            lifetime_value: Math.max(0, _parseAmount(get('lifetime_value'))),
            customer_since: get('customer_since') || _impLocalDay(),
            status: 'active'
        };
    }
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
        date_of_birth: get('date_of_birth') || null,
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
        // Accept only a clean currency number (optional non-digit prefix like 'RM',
        // digits with thousands commas, ONE optional decimal). The old digit-only guard
        // let _parseAmount mangle '3.5.7'→3.5 and '1,000 (approx 2000)'→10,002,000.
        deal_value: (() => { const s = String(dealVal || '').trim(); if (!/^[^\d]*-?\d[\d,]*(\.\d+)?\s*$/.test(s)) return null; const n = _parseAmount(s); return Number.isFinite(n) ? n : null; })(),
        responsible_agent_id: agentId,
        source: 'import'
    };
};

const mapRowToMarketingRecord = (row, reverseMap, type) => {
    const get = (field) => { const idx = reverseMap[field]; return idx !== undefined ? (row[idx] || '').toString().trim() : ''; };
    const parseActive = (val) => { if (!val) return true; return !['false','no','0','inactive','n'].includes(val.toLowerCase()); };
    if (type === 'products') return { name: get('name'), price: _parseAmount(get('price')), remarks: get('remarks') || null, delivery_lead_time: get('delivery_lead_time') || null, is_active: parseActive(get('is_active')) };
    if (type === 'events') return { title: get('title'), ticket_price: _parseAmount(get('ticket_price')), duration: get('duration') || null, target_group: get('target_group') || null, description: get('description') || null, is_active: parseActive(get('is_active')) };
    // promotions
    return { package_name: get('package_name'), price: _parseAmount(get('price')), details: get('details') || null, requirement: get('requirement') || null, remarks: get('remarks') || null, delivery_lead_time: get('delivery_lead_time') || null, is_active: parseActive(get('is_active')) };
};

// BUG #6: build a PARTIAL update payload for the "Update existing records" path.
// Unlike mapRowToRecord (which emits EVERY column + synthesized defaults like
// status/customer_since/source/responsible_agent_id), this reads ONLY the columns
// the user actually mapped AND whose cell is non-empty after trim — so blank
// cells and unmapped columns never overwrite populated DB values, and no
// synthesized default ever clobbers existing status/customer_since/agent. There
// is no mappable agent column (responsible_agent_id is never in reverseMap), so
// the agent is intentionally left untouched. Money fields use the same numeric
// coercion as mapRowToRecord; deal_value with a blank cell is skipped (handled
// by the non-empty guard). Returns {} when nothing real was mapped → caller skips.
const buildUpdatePayload = (row, reverseMap, importType = 'prospects') => {
    const moneyFields = new Set(['lifetime_value', 'deal_value', 'price', 'ticket_price']);
    const payload = {};
    Object.keys(reverseMap).forEach(field => {
        const idx = reverseMap[field];
        if (idx === undefined) return;
        const raw = (row[idx] || '').toString().trim();
        if (raw === '') return; // never overwrite with a blank cell
        if (moneyFields.has(field)) {
            // deal_value + all money fields use the currency-aware _parseAmount (was:
            // deal_value special-cased with raw parseFloat, which turned "5,000" into 5
            // and "RM 5,000" into NaN — diverging from the create path in mapRowToRecord).
            // Skip a non-blank but digit-less cell ("TBD"/"pending") so it PRESERVES the
            // existing DB value — _parseAmount would coerce it to 0 and overwrite. Mirrors
            // mapRowToRecord's `!/[0-9]/.test(dealVal)` guard on the create path.
            if (!/[0-9]/.test(raw)) return;
            const amt = _parseAmount(raw);
            // BUG #12: lifetime_value is a cumulative balance, not a signed
            // adjustment. _parseAmount preserves a leading minus, so clamp it to
            // >= 0 on the update path exactly like the create path (mapRowToRecord)
            // — a negative cell must never push an existing customer's LTV negative.
            payload[field] = field === 'lifetime_value' ? Math.max(0, amt) : amt;
            return;
        }
        payload[field] = raw;
    });
    return payload;
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
            // BUG #6: an unmapped required field previously skipped the check entirely,
            // so every row validated as 'valid' and imported blank. Flag the missing
            // mapping as a per-row error so the totals surface it and import is blocked.
            if (reqCol === undefined) {
                rowErrors.push({ field: reqLabel, msg: `${reqLabel} column is not mapped`, suggestion: `Map a column to ${reqLabel}` });
            } else {
                const val = (row[reqCol] || '').toString().trim();
                if (!val) rowErrors.push({ field: reqLabel, msg: `${reqLabel} is required`, suggestion: `Enter the ${reqLabel.toLowerCase()}` });
            }
        } else {
            const nameCol  = reverseMap['full_name'];
            const phoneCol = reverseMap['phone'];
            const emailCol = reverseMap['email'];
            const icCol    = reverseMap['ic_number'];

            // BUG #6: full_name and phone are required (*). If the column was never
            // mapped, the old code skipped the check and let empty records through.
            // Treat an unmapped required field as a per-row error.
            if (nameCol === undefined) {
                rowErrors.push({ field: 'Full Name', msg: 'Full Name column is not mapped', suggestion: 'Map a column to Full Name' });
            } else {
                const name = (row[nameCol] || '').toString().trim();
                if (!name) rowErrors.push({ field: 'Full Name', msg: 'Name is required', suggestion: 'Enter the full name' });
            }
            if (phoneCol === undefined) {
                rowErrors.push({ field: 'Phone', msg: 'Phone column is not mapped', suggestion: 'Map a column to Phone' });
            } else {
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
    if (isMarketingType) {
        // Duplicate check by name for marketing list types. These are small
        // reference tables (products/events/promotions) — a whole-table fetch
        // is cheap, so they stay on the legacy getAll path.
        let existing = [];
        // fresh:true bypasses the SWR cache for the duplicate check — a stale snapshot
        // (e.g. from a prior import this session) would miss just-added rows and let
        // real duplicates through.
        try { existing = await AppDataStore.getAll(table, { fresh: true }); } catch (e) { existing = []; }
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

    // ── PHASE 1 (#12): server-side existence check (flagged, default OFF) ──
    // Instead of getAll(table) (download the WHOLE contact table to dedup the
    // import file), ask the server for only the existing rows whose normalized
    // phone/email/ic matches a key present in this import file. A duplicate
    // requires key equality, so existing rows with no key in the import set can
    // never match — the candidate set is identical, the payload is just the
    // real matches. Normalization runs server-side identically (the
    // import_existing_matches RPC). Any guard/RPC error falls back to the
    // whole-table path below, so the flag-off behavior is byte-identical.
    let _builtServerSide = false;
    if (window.__SERVER_TABLES) {
        try {
            const phoneSet = new Set(), emailSet = new Set(), icSet = new Set();
            _importData.validationResults.forEach(vr => {
                if (vr.status === 'error') return;
                if (phoneCol !== undefined) { const p = normalisePhone(vr.row[phoneCol]); if (p) phoneSet.add(p); }
                if (emailCol !== undefined) { const e = (vr.row[emailCol] || '').toString().toLowerCase().trim(); if (e) emailSet.add(e); }
                if (icCol    !== undefined) { const ic = (vr.row[icCol] || '').toString().replace(/[-\s]/g, ''); if (ic) icSet.add(ic); }
            });
            const matches = await AppDataStore.importExistingMatches(table, {
                phones: [...phoneSet], emails: [...emailSet], ics: [...icSet],
            });
            matches.forEach(rec => {
                if (rec.norm_phone) existingPhones.set(rec.norm_phone, rec);
                if (rec.norm_email) existingEmails.set(rec.norm_email, rec);
                if (rec.norm_ic)    existingIcs.set(rec.norm_ic, rec);
            });
            _builtServerSide = true;
        } catch (e) {
            console.warn('[runDuplicateCheck] server existence check → whole-table fallback:', e?.message || e);
        }
    }
    if (!_builtServerSide) {
        let existing = [];
        // fresh:true bypasses the SWR cache for the duplicate check — a stale snapshot
        // (e.g. from a prior import this session) would miss just-added rows and let
        // real duplicates through.
        try { existing = await AppDataStore.getAll(table, { fresh: true }); } catch (e) { existing = []; }
        existing.forEach(rec => {
            if (rec.phone)     existingPhones.set(normalisePhone(rec.phone), rec);
            if (rec.email)     existingEmails.set((rec.email || '').toLowerCase().trim(), rec);
            if (rec.ic_number) existingIcs.set((rec.ic_number || '').replace(/[-\s]/g, ''), rec);
        });
    }

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
        // BUG #11: remember that the user has committed a mapping so a later
        // re-render (Back to step 2) restores THEIR choices — including columns
        // they deliberately left on '-- Ignore --' — instead of reverting to
        // auto-match defaults.
        _importData._mappingCaptured = true;
        runValidation();
    }
    if (_currentImportStep === 3) {
        await runDuplicateCheck();
    }
    if (_currentImportStep === 4) {
        // BUG #3: the duplicate-action radios live only on step 4 and are destroyed
        // when step 5 replaces the modal body. Capture the choice here (at the 4→5
        // transition) so startImport can read it from _importData instead of a
        // now-missing DOM node (which always returned null → forced 'skip').
        _importData.duplicateAction = document.querySelector('input[name="duplicate-action"]:checked')?.value || 'skip';
    }
    if (_currentImportStep < 5) await renderImportStep(_currentImportStep + 1);
};
const importPrevStep = async () => { if (_currentImportStep > 1) await renderImportStep(_currentImportStep - 1); };
const updateImportType = async (type) => {
    if (type === _importData.importType) return;
    _importData.importType = type;
    // The previous type's captured mapping no longer applies to the new type's
    // fields, so treat the switch as a fresh mapping: clear the saved mapping +
    // captured flag so step 2 re-auto-matches for the newly selected type.
    _importData.mapping = {};
    _importData._mappingCaptured = false;
    // BUG #7: the mapping table still lists the PREVIOUS type's CRM fields until
    // step 2 is re-rendered, so Auto-map (which computes new-type field names)
    // assigns option values that don't exist and silently maps nothing. Re-render
    // step 2 so the dropdowns list the newly selected type's fields + re-auto-match.
    if (_currentImportStep === 2) await renderImportStep(2);
};
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
    // BUG #3: the duplicate-action radios are on step 4 (already gone by step 5),
    // so read the choice captured at the 4→5 transition; fall back to a live DOM
    // read (in case step 4 was skipped) then to 'skip'.
    const duplicateAction = _importData.duplicateAction
        || document.querySelector('input[name="duplicate-action"]:checked')?.value
        || 'skip';
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
    if (assignTo === 'myself') assignedAgentId = _state.cu?.id;

    const reverseMap = buildReverseMapping();
    const isMarketingType = ['products', 'events', 'promotions'].includes(_importData.importType);
    const table = { customers: 'customers', prospects: 'prospects', products: 'products', events: 'events', promotions: 'promotions' }[_importData.importType] || 'prospects';
    let created = 0, updated = 0, skipped = 0, errorCount = 0, convertedCount = 0;

    // COMP-7: batch inserts via AppDataStore.createMany (bulk insert with a
    // per-row add() fallback) instead of one serial round-trip per row.
    // Pass 1 builds the records (handling dedup-skip and dedup-update inline,
    // since those don't create); Pass 2 flushes the create candidates in
    // chunks of ~500 — one cache-invalidate / progress tick per chunk, never
    // per row. Resulting records, dedup/validation behaviour and the
    // success/skip/error tallies are identical to the old per-row path.
    const CHUNK_SIZE = 500;
    const pendingCreates = []; // { record, rowIndex, purchaseAmount }
    // BUG #15: intra-file dedup — runDuplicateCheck only compares rows against
    // EXISTING DB rows, so the SAME person listed twice in one spreadsheet would
    // be inserted twice. Track the natural key of every row already queued THIS
    // batch and skip a later create whose key collides. Conservative: a row with
    // no usable key (no ic/phone/name — e.g. marketing rows) is NEVER deduped.
    const seenKeys = new Set();
    const naturalKeyForCreate = (rec) => {
        const ic = (rec.ic_number || '').toString().replace(/[-\s]/g, '').toLowerCase();
        if (ic) return 'ic:' + ic;
        const phone = normalisePhone(rec.phone);
        if (phone) return 'ph:' + phone;
        // BUG #13: the previous name-only fallback ('np:' + name, since phone is
        // always '' by this point) silently collapsed two DIFFERENT people who
        // share a name when neither ic nor phone was mapped — dropping a real
        // person as an in-file "duplicate". A name alone is NOT a unique identity,
        // so a row with no ic/phone is never deduped.
        return ''; // no usable key → do not dedup
    };

    // ── Pass 1: map rows → records, resolve duplicates ───────────────────
    for (let i = 0; i < rowsToProcess.length; i++) {
        const vr = rowsToProcess[i];
        const record = isMarketingType ? mapRowToMarketingRecord(vr.row, reverseMap, _importData.importType) : mapRowToRecord(vr.row, reverseMap, assignedAgentId, _importData.importType);
        const dup = dupMap.get(vr.rowIndex);

        if (dup) {
            if (duplicateAction === 'skip') { skipped++; continue; }
            if (duplicateAction === 'update') {
                // BUG #6: patch ONLY the mapped, non-empty cells — never the full
                // record (which would wipe populated columns with blanks/defaults).
                const patch = buildUpdatePayload(vr.row, reverseMap, _importData.importType);
                if (Object.keys(patch).length === 0) { skipped++; continue; }
                try { await AppDataStore.update(table, dup.existingRec.id, patch); updated++; }
                catch (e) { console.error('Update failed row', vr.rowIndex, e); errorCount++; }
                continue;
            }
            // merge: fall through to create
        }
        // Purchase amount on this row (drives auto-conversion for prospects)
        const purchaseAmount = (() => {
            const idx = reverseMap['lifetime_value'];
            return idx !== undefined ? _parseAmount(vr.row[idx]) : 0;
        })();
        record.created_at = new Date().toISOString();
        if (table === 'prospects') {
            // Same prospect defaults the per-row path applied just before insert.
            record.status = 'New';
            record.protection_deadline = _impLocalDay(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
            record.score = 5;
        } else if (table === 'customers') {
            // Keep the imported LTV ON the customer record (mapRowToRecord already set
            // lifetime_value) so the value is persisted by the single customer insert and
            // can NEVER be lost if the synthetic opening-balance purchase below fails. The
            // purchase row is added purely so the historical spend is VISIBLE to
            // purchase-based leaderboard/revenue reports (dated customer_since) — it must
            // NOT also re-bump LTV via adjustCustomerLtv, which would double the value.
            // Set total_purchases to match the single opening entry. (audit import:594)
            record.total_purchases = purchaseAmount > 0 ? 1 : 0;
        }
        // BUG #15: skip a second occurrence of the same person within this file.
        const natKey = naturalKeyForCreate(record);
        if (natKey) {
            if (seenKeys.has(natKey)) { skipped++; continue; }
            seenKeys.add(natKey);
        }
        pendingCreates.push({ record, rowIndex: vr.rowIndex, purchaseAmount });
    }

    // Imported prospect that already purchased → auto-approve the conversion
    // right away: mark the prospect converted and create the linked permanent
    // Customer (skip manager approval for imports). Identical record shape to
    // the old inline path; runs after the prospect row is saved so we have id.
    const autoConvertProspect = async (record, savedProspect, purchaseAmount, rowIndex) => {
        if (!(purchaseAmount > 0 && savedProspect?.id)) return;
        try {
            // Seed lifetime_value at 0, then route the imported sale through the
            // canonical purchases-row + adjustCustomerLtv path (audit #9). Writing
            // lifetime_value directly here (the old behaviour) recorded the LTV but
            // left NO purchases row / total_purchases, so leaderboard & revenue
            // reports (which SUM the purchases table) never saw imported conversions.
            const savedCustomer = await AppDataStore.create('customers', {
                full_name: record.full_name, gender: record.gender || '', nationality: record.nationality || '',
                phone: record.phone || '', email: record.email || '', ic_number: record.ic_number || '',
                date_of_birth: record.date_of_birth || null, lunar_birth: record.lunar_birth || '',
                occupation: record.occupation || '', company_name: record.company_name || '',
                income_range: record.income_range || '', address: record.address || '', city: record.city || '',
                state: record.state || '', postal_code: record.postal_code || '', ming_gua: record.ming_gua || '',
                responsible_agent_id: assignedAgentId, lifetime_value: 0,
                customer_since: _impLocalDay(),
                converted_from_prospect_id: savedProspect.id, status: 'active',
                created_at: new Date().toISOString()
            });
            if (savedCustomer?.id) {
                // Purchases row so the imported sale appears in purchase-based reports,
                // mirroring approveClosingRecord / savePurchase (column is `date`).
                await AppDataStore.create('purchases', {
                    customer_id: savedCustomer.id,
                    date: _impLocalDay(),
                    invoice: 'IMPORT-CONVERT',
                    item: '',
                    amount: purchaseAmount,
                    status: 'COMPLETED',
                    payment_method: 'Cash'
                });
                // Atomic lifetime_value + total_purchases bump (same adjuster as every
                // other purchase path) so LTV and the leaderboard stay reconciled.
                await adjustCustomerLtv(savedCustomer.id, purchaseAmount, 1);
            }
            await AppDataStore.update('prospects', savedProspect.id, { status: 'converted', conversion_status: 'approved' });
            convertedCount++;
        } catch (convErr) {
            // Surface the failure in the import tally (finding #922): a created prospect
            // whose auto-conversion silently failed otherwise inflated convertedCount's basis.
            console.error('Auto-convert failed row', rowIndex, convErr);
            errorCount++;
        }
    };

    // Imported customer with a non-zero opening LTV → record it as ONE synthetic
    // "Opening balance (imported)" purchase DATED TO customer_since so the historical spend
    // is VISIBLE to purchase-based leaderboard/revenue reports (which SUM the purchases
    // table) and lands in the correct historical period, not current-month revenue. The
    // customer's lifetime_value + total_purchases were already persisted on the record
    // itself, so this deliberately does NOT call adjustCustomerLtv (that would DOUBLE the
    // LTV) — and a failed insert here costs only this row's report visibility, never the
    // LTV value. Runs once per created customer, so re-imports never double-post.
    // (audit import:594)
    const autoOpeningBalance = async (record, savedCustomer, purchaseAmount, rowIndex) => {
        if (!(purchaseAmount > 0 && savedCustomer?.id)) return;
        try {
            await AppDataStore.create('purchases', {
                customer_id: savedCustomer.id,
                date: _openingBalanceDate(record.customer_since),
                invoice: 'IMPORT-OPENING',
                item: 'Opening balance (imported)',
                amount: purchaseAmount,
                status: 'COMPLETED',
                payment_method: 'Imported'
            });
        } catch (obErr) {
            // LTV is safe on the customer record; only the purchase-report visibility of
            // this one row is lost. Surface it in the tally without failing the import.
            console.error('Opening-balance purchase failed row', rowIndex, obErr);
            errorCount++;
        }
    };

    // ── Pass 2: flush create candidates in chunks of ~500 ────────────────
    for (let start = 0; start < pendingCreates.length; start += CHUNK_SIZE) {
        const chunk = pendingCreates.slice(start, start + CHUNK_SIZE);
        const records = chunk.map(c => c.record);
        try {
            // createMany returns the saved rows in input order; on bulk failure
            // it already falls back to per-row add() internally.
            const saved = await AppDataStore.createMany(table, records);
            created += saved.length;
            if (table === 'prospects') {
                for (let j = 0; j < chunk.length; j++) {
                    await autoConvertProspect(chunk[j].record, saved[j], chunk[j].purchaseAmount, chunk[j].rowIndex);
                }
            } else if (table === 'customers') {
                for (let j = 0; j < chunk.length; j++) {
                    await autoOpeningBalance(chunk[j].record, saved[j], chunk[j].purchaseAmount, chunk[j].rowIndex);
                }
            }
        } catch (e) {
            // Whole-chunk reject (createMany re-threw): fall back to per-row
            // inserts for THIS chunk so one bad row can't lose the batch.
            console.warn('createMany rejected chunk, falling back to per-row insert:', e?.message || e);
            for (const c of chunk) {
                try {
                    const savedOne = await AppDataStore.create(table, c.record);
                    created++;
                    if (table === 'prospects') await autoConvertProspect(c.record, savedOne, c.purchaseAmount, c.rowIndex);
                    else if (table === 'customers') await autoOpeningBalance(c.record, savedOne, c.purchaseAmount, c.rowIndex);
                } catch (rowErr) { console.error('Insert failed row', c.rowIndex, rowErr); errorCount++; }
            }
        }
        // One progress tick + cooperative yield per chunk (not per row), so the
        // UI stays responsive without a per-row full-localStorage scan.
        updateImportProgress(Math.round(Math.min(start + chunk.length, total) / total * 100), Math.min(start + chunk.length, total), total);
        await new Promise(r => setTimeout(r, 0));
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
            created_by:         _state.cu?.id,
            created_at:         new Date().toISOString(),
            completed_at:       new Date().toISOString()
        });
    } catch (e) { console.error('Failed to log import job:', e); }

    UI.hideModal();
    const convMsg = convertedCount > 0 ? `, ${convertedCount} auto-converted to customers` : '';
    UI.toast.success(`Import complete: ${created} created${convMsg}, ${updated} updated, ${skipped} skipped`);
    // Fresh reads so the new records show immediately (not a stale SWR snapshot)
    try { AppDataStore.invalidateCache && AppDataStore.invalidateCache('customers'); AppDataStore.invalidateCache && AppDataStore.invalidateCache('prospects'); } catch (e) {}
    const vp = document.getElementById('content-viewport');
    if (vp) {
        if (['products', 'events', 'promotions'].includes(_importData.importType)) {
            _state.cmlt = _importData.importType;
            await (window.app.showMarketingListsView || (() => Promise.resolve()))(vp);
        } else if (_importData.importType === 'customers') {
            // Show the imported customers directly on the Customers tab
            await (window.app.navigateTo || (() => {}))('prospects');
            try { await (window.app.switchCustomerTab || (() => {}))('customers'); } catch (e) {}
        } else if (_importData.importType === 'prospects') {
            await (window.app.navigateTo || (() => {}))('prospects');
            // If any imported prospects were auto-converted, surface them on the Customers tab
            if (convertedCount > 0) { try { await (window.app.switchCustomerTab || (() => {}))('customers'); } catch (e) {} }
        } else {
            await showImportDashboard(vp);
        }
    }
};

const viewImportDetails = async (id) => {
    const job = await AppDataStore.getById('import_jobs', id);
    if (!job) return;
    const content = `<div><div style="background:var(--gray-50);padding:16px;border-radius:8px;margin-bottom:16px"><div><strong>File:</strong> ${esc(job.file_name)}</div><div><strong>Type:</strong> ${esc(job.import_type)}</div><div><strong>Status:</strong> ${esc(String(job.status||''))}</div><div><strong>Date:</strong> ${UI.formatDate(job.created_at)}</div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><strong>Total rows:</strong> ${job.total_rows}</div><div><strong>Valid rows:</strong> ${job.valid_rows}</div><div><strong>New records:</strong> ${job.created_records}</div><div><strong>Updated:</strong> ${job.updated_records}</div><div><strong>Skipped:</strong> ${job.skipped_records}</div><div><strong>Errors:</strong> ${job.error_rows}</div></div></div>`;
    UI.showModal(`Import Details: ${job.file_name}`, content, [{ label: 'Close', type: 'primary', action: 'UI.hideModal()' }]);
};

// BUG #14: this used to fire a "downloaded" toast without producing any file.
// Build a real log from the stored import_jobs record and download it, or show
// an honest error if the job can't be loaded.
const downloadImportLog = async (id) => {
    let job = null;
    try { job = await AppDataStore.getById('import_jobs', id); } catch (e) { job = null; }
    if (!job) { UI.toast.error('Import log not found'); return; }
    const lines = [
        `Import Log — ${job.file_name || 'import'}`,
        `Type: ${job.import_type || ''}`,
        `Status: ${job.status || ''}`,
        `Date: ${job.created_at || ''}`,
        `Completed: ${job.completed_at || ''}`,
        '',
        `Total rows: ${job.total_rows ?? ''}`,
        `Valid rows: ${job.valid_rows ?? ''}`,
        `Error rows: ${job.error_rows ?? ''}`,
        `Created records: ${job.created_records ?? ''}`,
        `Updated records: ${job.updated_records ?? ''}`,
        `Skipped records: ${job.skipped_records ?? ''}`,
        `Duplicate handling: ${job.duplicate_handling || ''}`,
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `import_log_${id}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    UI.toast.success('Import log downloaded');
};

const openTemplatesModal = () => {
    const content = `
        <table style="width:100%;border-collapse:collapse">
            <thead><tr><th scope="col" style="padding:10px;text-align:left;background:var(--gray-50)">Template</th><th scope="col" style="padding:10px;text-align:left;background:var(--gray-50)">Description</th><th scope="col" style="padding:10px;text-align:left;background:var(--gray-50)">Download</th></tr></thead>
            <tbody>
                ${/* 'Agents' template dropped — the Agents import type was removed (agents are auth-provisioned users, not a plain import). */ ['Prospects', 'Customers', 'Products', 'Events', 'Promotions', 'Activities'].map(t => `<tr><td style="padding:10px;border-bottom:1px solid var(--gray-100)">${t} Template</td><td style="padding:10px;border-bottom:1px solid var(--gray-100)">${t} data import</td><td style="padding:10px;border-bottom:1px solid var(--gray-100)"><button class="btn secondary btn-sm" onclick="app.downloadTemplate('${t.toLowerCase()}','csv')">CSV</button> <button class="btn secondary btn-sm" onclick="app.downloadTemplate('${t.toLowerCase()}','xlsx')">Excel</button></td></tr>`).join('')}
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
    const filename = `${type}_export_${_impLocalDay()}`;
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
        jobs.map(j => `<tr><td>${esc(j.file_name)}</td><td>${esc(j.import_type)}</td><td>${j.total_rows}</td><td><span class="import-status status-${esc(String(j.status||''))}">${esc(String(j.status||'').toUpperCase())}</span></td><td>${UI.formatDate(j.created_at)}</td><td><button class="btn-icon" onclick="app.viewImportDetails(${j.id})"><i class="fas fa-eye"></i></button></td></tr>`).join('');
    const content = `<table style="width:100%;border-collapse:collapse"><thead><tr style="background:var(--gray-50)"><th scope="col" style="padding:10px;text-align:left">File</th><th scope="col" style="padding:10px;text-align:left">Type</th><th scope="col" style="padding:10px;text-align:left">Records</th><th scope="col" style="padding:10px;text-align:left">Status</th><th scope="col" style="padding:10px;text-align:left">Date</th><th scope="col" style="padding:10px;text-align:left">Actions</th></tr></thead><tbody>${rows}</tbody></table>`;
    UI.showModal('Import History', content, [{ label: 'Close', type: 'primary', action: 'UI.hideModal()' }]);
};

// ========== PHASE 13: FOLLOW-UP MONITORING & REASSIGNMENT ==========

const showProtectionMonitoringView = async (container) => {
    const [allProspects, allUsers, allActivities, visibleIds] = await Promise.all([
        AppDataStore.getAll('prospects'),
        AppDataStore.getAll('users'),
        AppDataStore.getAll('activities'),
        getVisibleUserIds(_state.cu)
    ]);
    const agentMap = {};
    for (const u of allUsers) agentMap[u.id] = u;
    const now = new Date();
    // Single pass to find each prospect's LATEST activity (was a full activities.filter
    // + sort PER prospect → O(prospects × activities) on every render).
    const _latestActByProspect = new Map();
    for (const a of allActivities) {
        const k = String(a.prospect_id);
        const cur = _latestActByProspect.get(k);
        if (!cur || new Date(a.activity_date) > new Date(cur.activity_date)) _latestActByProspect.set(k, a);
    }
    const lastActivityMap = {};
    for (const p of allProspects) {
        const last = _latestActByProspect.get(String(p.id));
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

    // React island — chunk computes the 4 model arrays (mirroring the legacy
    // render* helpers below), island renders; mutations stay on app.*.
    if (_reactProtectionOn()) {
        try {
            const _calcProt = calcProtectionDays;

            // team summary cards (mirror renderTeamSummaryCards)
            const teamColors = ['team-a', 'team-b', 'team-c', 'team-d', 'team-e'];
            const teamStats = {};
            const totals = { active: 0, attention: 0, inactive: 0, critical: 0 };
            for (const p of visibleProspects) {
                const agent = agentMap[p.responsible_agent_id];
                const teamName = agent?.team || 'Unassigned';
                if (!teamStats[teamName]) teamStats[teamName] = { active: 0, attention: 0, inactive: 0, critical: 0 };
                const days = lastActivityMap[p.id]?.daysSince ?? 999;
                const protDays = _calcProt(p);
                if (days > 14 || protDays <= 0) { teamStats[teamName].critical++; totals.critical++; }
                else if (days > 7) { teamStats[teamName].inactive++; totals.inactive++; }
                else if (days > 3) { teamStats[teamName].attention++; totals.attention++; }
                else { teamStats[teamName].active++; totals.active++; }
            }
            const teamNames = Object.keys(teamStats).sort();
            const teamCards = teamNames.map((name, i) => ({ name, colorClass: teamColors[i % teamColors.length], ...teamStats[name] }));
            teamCards.push({ name: 'Total', colorClass: 'total', ...totals });

            // agent performance rows (mirror renderAgentPerformanceRows)
            const agentRows = visibleAgents.map(agent => {
                const aP = visibleProspects.filter(p => String(p.responsible_agent_id) === String(agent.id));
                const assigned = aP.length;
                let followedUp7d = 0, i37 = 0, i814 = 0, i15 = 0;
                for (const p of aP) {
                    const days = lastActivityMap[p.id]?.daysSince ?? 999;
                    if (days <= 7) followedUp7d++;
                    if (days > 3 && days <= 7) i37++;
                    else if (days > 7 && days <= 14) i814++;
                    else if (days > 14) i15++;
                }
                const rate = assigned > 0 ? Math.round((followedUp7d / assigned) * 100) : 0;
                const rateCls = rate < 70 ? 'rate-bad' : rate < 90 ? 'rate-warning' : 'rate-good';
                return { id: agent.id, full_name: agent.full_name || 'Unknown', team: agent.team || 'Unassigned', assigned, followedUp7d, rate, rateCls, i37, i814, i15 };
            });

            // inactive prospect rows (mirror renderInactiveProspectsRows)
            const inactiveRows = visibleProspects
                .filter(p => (lastActivityMap[p.id]?.daysSince ?? 999) > 7)
                .sort((a, b) => (lastActivityMap[b.id]?.daysSince ?? 999) - (lastActivityMap[a.id]?.daysSince ?? 999))
                .map(p => {
                    const days = lastActivityMap[p.id]?.daysSince ?? 999;
                    const agentName = agentMap[p.responsible_agent_id]?.full_name || 'Unassigned';
                    const protDays = _calcProt(p);
                    const status = (days > 14 || protDays <= 0) ? 'critical' : 'warning';
                    return {
                        id: p.id, full_name: p.full_name || 'Unknown', agentName,
                        days, daysText: days === 999 ? 'Never' : days + ' days', daysCls: days > 14 ? 'critical' : 'warning',
                        score: p.score || 0,
                        deadline: p.protection_deadline ? UI.formatDate(p.protection_deadline) : 'N/A',
                        status, statusLabel: status === 'critical' ? '🔴 Critical' : '🟡 Warning',
                    };
                });

            // reassignment history rows (mirror renderReassignmentHistory data)
            let reassignRows = [];
            try {
                const [historyRaw, allUsers2] = await Promise.all([
                    AppDataStore.getAll('reassignment_history'),
                    AppDataStore.getAll('users'),
                ]);
                const history = (historyRaw || []).sort((a, b) => new Date(b.reassignment_date) - new Date(a.reassignment_date));
                const userMap2 = new Map((allUsers2 || []).map(u => [String(u.id), u]));
                const nameOf = (id) => userMap2.get(String(id))?.full_name || `Agent #${id}`;
                reassignRows = history.map(r => ({
                    date: UI.formatDate(r.reassignment_date),
                    prospect_id: r.prospect_id,
                    fromName: nameOf(r.from_agent_id),
                    toName: nameOf(r.to_agent_id),
                    reason: r.reassignment_reason,
                    byName: nameOf(r.reassigned_by),
                }));
            } catch (e) { console.warn('[protection] reassignment rows', e && e.message); }

            container.innerHTML = '<div id="protection-react-root"></div>';
            window.CRMReact.mountProtectionMonitoring(document.getElementById('protection-react-root'), {
                teamCards, agentRows, inactiveRows, reassignRows,
            });
            return;
        } catch (e) {
            console.warn('[protection] island mount failed, falling back to legacy:', e && e.message);
            // fall through to the legacy render below
        }
    }

    container.innerHTML = buildProtectionMonitoringView(
        renderTeamSummaryCards(monitorData),
        renderAgentPerformanceRows(monitorData),
        renderInactiveProspectsRows(monitorData),
        await renderReassignmentHistory()
    );
};

// Pure HTML shell for the legacy protection-monitoring view. The orchestrator
// computes the four row-string fragments (3 sync renders + 1 awaited history)
// and passes them in; this helper assembles the identical static markup with
// the fragments interpolated at the same four positions. Byte-exact extraction.
const buildProtectionMonitoringView = (teamSummaryCardsHtml, agentPerformanceRowsHtml, inactiveProspectsRowsHtml, reassignmentHistoryHtml) => `
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
            <div class="team-summary-cards">${teamSummaryCardsHtml}</div>
            <div class="agent-performance">
                <h3>Agent Performance</h3>
                <div class="agent-table-container">
                    <table class="agent-performance-table">
                        <thead><tr><th scope="col">Agent</th><th scope="col">Team</th><th scope="col">Assigned</th><th scope="col">Followed up (7d)</th><th scope="col">Rate</th><th scope="col">Inactive (3-7d)</th><th scope="col">Inactive (8-14d)</th><th scope="col">Inactive (15d+)</th><th scope="col">Actions</th></tr></thead>
                        <tbody>${agentPerformanceRowsHtml}</tbody>
                    </table>
                </div>
            </div>
            <div class="inactive-prospects">
                <h3>Inactive Prospects (>7 days)</h3>
                <div class="inactive-table-container">
                    <table class="inactive-table">
                        <thead><tr><th scope="col">Prospect</th><th scope="col">Agent</th><th scope="col">Days Inactive</th><th scope="col">Score</th><th scope="col">Protection Deadline</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
                        <tbody>${inactiveProspectsRowsHtml}</tbody>
                    </table>
                </div>
            </div>
            <div class="agent-performance" style="margin-top:24px">
                <h3>Reassignment History</h3>
                <div class="agent-table-container">${reassignmentHistoryHtml}</div>
            </div>
        </div>`;

const renderTeamSummaryCards = ({ visibleProspects, agentMap, lastActivityMap }) => {
    const teamColors = ['team-a', 'team-b', 'team-c', 'team-d', 'team-e'];
    const teamStats = {};
    const totals = { active: 0, attention: 0, inactive: 0, critical: 0 };
    for (const p of visibleProspects) {
        const agent = agentMap[p.responsible_agent_id];
        const teamName = agent?.team || 'Unassigned';
        if (!teamStats[teamName]) teamStats[teamName] = { active: 0, attention: 0, inactive: 0, critical: 0 };
        const days = lastActivityMap[p.id]?.daysSince ?? 999;
        const protDays = calcProtectionDays(p);
        if (days > 14 || protDays <= 0) { teamStats[teamName].critical++; totals.critical++; }
        else if (days > 7) { teamStats[teamName].inactive++; totals.inactive++; }
        else if (days > 3) { teamStats[teamName].attention++; totals.attention++; }
        else { teamStats[teamName].active++; totals.active++; }
    }
    const teamNames = Object.keys(teamStats).sort();
    const cards = teamNames.map((name, i) => {
        const t = teamStats[name];
        const color = teamColors[i % teamColors.length];
        return `<div class="summary-card ${color}"><h4>${esc(name)}</h4><div class="summary-stats"><div><span class="stat-label">Active:</span><span class="stat-value">${t.active}</span></div><div><span class="stat-label">Attention:</span><span class="stat-value warning">${t.attention}</span></div><div><span class="stat-label">Inactive:</span><span class="stat-value danger">${t.inactive}</span></div><div><span class="stat-label">Critical:</span><span class="stat-value danger">${t.critical}</span></div></div></div>`;
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
        return `<tr><td><strong>${esc(agent.full_name || 'Unknown')}</strong></td><td>${esc(teamName)}</td><td>${assigned}</td><td>${followedUp7d}</td><td><span class="rate-badge ${cls}">${rate}%</span></td><td>${i37}</td><td>${i814}</td><td>${i15}</td><td><button class="btn-icon" onclick="app.viewAgentDetails(${agent.id})" title="View"><i class="fas fa-eye"></i></button><button class="btn-icon" onclick="app.bulkReassign(${agent.id})" title="Reassign"><i class="fas fa-exchange-alt"></i></button><button class="btn-icon" onclick="app.bulkReassign(${agent.id})" title="Bulk Reassign"><i class="fas fa-users"></i></button></td></tr>`;
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
        const protDays = calcProtectionDays(p);
        const status = days > 14 || protDays <= 0 ? 'critical' : 'warning';
        const deadline = p.protection_deadline ? UI.formatDate(p.protection_deadline) : 'N/A';
        return `<tr><td><strong>${esc(p.full_name || 'Unknown')}</strong></td><td>${esc(agentName)}</td><td class="${days > 14 ? 'critical' : 'warning'}">${days === 999 ? 'Never' : days + ' days'}</td><td>${p.score || 0}</td><td>${deadline}</td><td><span class="status-badge status-${status}">${status === 'critical' ? '🔴 Critical' : '🟡 Warning'}</span></td><td><button class="btn-icon" onclick="app.openReassignModal(${p.id})" title="Reassign"><i class="fas fa-exchange-alt"></i></button><button class="btn-icon" onclick="app.contactProspect(${p.id})" title="Contact"><i class="fas fa-phone"></i></button></td></tr>`;
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

    const rows = history.map(r => `<tr><td>${UI.formatDate(r.reassignment_date)}</td><td>#${r.prospect_id}</td><td>${esc(nameOf(r.from_agent_id))}</td><td>${esc(nameOf(r.to_agent_id))}</td><td>${esc(r.reassignment_reason)}</td><td>${esc(nameOf(r.reassigned_by))}</td></tr>`);

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

    // Scale-safe: fetch ONLY the customers linked to this prospect (eq
    // converted_from_prospect_id) instead of the whole customers table. Falls
    // back to the whole-table scan on error.
    let linkedCustomers;
    try {
        linkedCustomers = await AppDataStore.query('customers', { converted_from_prospect_id: pid });
    } catch (e) {
        console.warn('cascadeProspectReassign: linked-customers query failed — full-table fallback', e);
        linkedCustomers = (await AppDataStore.getAll('customers')).filter(c =>
            String(c.converted_from_prospect_id) === String(pid));
    }
    linkedCustomers = linkedCustomers || [];

    let activitiesToTransfer = [];
    const cascadeActivitiesAfter = opts.cascadeActivitiesAfter ?? null;
    if (cascadeActivitiesAfter) {
        const cutoffMs = new Date(cascadeActivitiesAfter).getTime();
        const linkedCustomerIds = new Set(linkedCustomers.map(c => String(c.id)));
        const _matchesCascade = (a) => {
            const matchesEntity = String(a.prospect_id) === String(pid)
                || (a.customer_id && linkedCustomerIds.has(String(a.customer_id)));
            if (!matchesEntity) return false;
            if (fromAgentId != null && String(a.lead_agent_id) !== String(fromAgentId)) return false;
            if (!a.activity_date) return false;
            return new Date(a.activity_date).getTime() >= cutoffMs;
        };
        // Scale-safe: fetch only activities for THIS prospect + its linked customers
        // (server OR on prospect_id / customer_id, + lead_agent_id eq when known)
        // instead of the whole activities table; the exact client filter (incl. the
        // date cutoff) is reapplied for parity. >cap or any error → full-table scan.
        const CASCADE_CAP = 10000;
        let acts = null;
        try {
            const scopeFields = [{ field: 'prospect_id', values: [pid] }];
            if (linkedCustomerIds.size) scopeFields.push({ field: 'customer_id', values: [...linkedCustomerIds] });
            const opt = { scopeFields, limit: CASCADE_CAP + 1, offset: 0, countMode: null, sort: 'id', sortDir: 'asc' };
            if (fromAgentId != null) opt.filters = { lead_agent_id: fromAgentId };
            const res = await AppDataStore.queryAdvanced('activities', opt);
            const data = (res && Array.isArray(res.data)) ? res.data : null;
            if (data && data.length <= CASCADE_CAP) acts = data;
            else throw new Error('cascade activity set exceeds cap — full scan for completeness');
        } catch (e) {
            console.warn('cascadeProspectReassign: scoped activity query unavailable — full-table fallback', e);
            acts = await AppDataStore.getAll('activities');
        }
        activitiesToTransfer = (acts || []).filter(_matchesCascade);
    }

    const now = new Date().toISOString();
    const prospectPatch = { responsible_agent_id: newAgentId };
    let protectionResetTo = null;
    if (opts.resetProtection) {
        protectionResetTo = _impLocalDay(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
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
            reassigned_by: _state.cu?.id,
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
                        reassigned_by: _state.cu?.id,
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
        return `<option value="${a.id}">${esc(a.full_name || 'Agent')} (${assignedCount} assigned, capacity +${capacity}) ${icon}</option>`;
    }).join('');
    const content = `
        <div class="reassign-modal">
            <input type="hidden" id="reassign-prospect-id" value="${prospectId}">
            <input type="hidden" id="reassign-from-agent-id" value="${prospect.responsible_agent_id || ''}">
            <div class="current-info">
                <h4>Current Information</h4>
                <div class="info-grid">
                    <div><strong>Prospect:</strong> ${esc(prospect.full_name || 'Unknown')}</div><div><strong>Current Agent:</strong> ${esc(currentAgent?.full_name || 'Unassigned')}</div>
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

    // BUG #15: a substring match on "quickReassign(12" also matches ids 120-129
    // (and 123, 125, …). The rendered onchange is `app.quickReassign(<id>, ...)`
    // so include the trailing comma delimiter to bind to the exact row's dropdown.
    const selectEl = document.querySelector(`select[onchange*="quickReassign(${id},"]`);
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
            fromAgentName = userById(fromAgentId)
                || (fromAgentId ? `Agent #${fromAgentId}` : 'Unassigned');
            // Scale-safe: count linked customers via eq query (only matching rows)
            // instead of scanning the whole customers table. Fallback on error.
            try {
                const linked = await AppDataStore.query('customers', { converted_from_prospect_id: id });
                linkedCustomerCount = (linked || []).length;
            } catch (e) {
                console.warn('quickReassign preview: linked-count query failed — full-table fallback', e);
                linkedCustomerCount = (await AppDataStore.getAll('customers')).filter(c =>
                    String(c.converted_from_prospect_id) === String(id)).length;
            }
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
        `<label class="checkbox-label"><input type="checkbox" checked data-prospect-id="${p.id}"> ${esc(p.full_name || 'Unknown')} (${p._daysSince === 999 ? 'Never' : p._daysSince + 'd'}, Score ${p.score || 0})</label>`
    ).join('');
    const perAgent = otherAgents.length ? Math.ceil(inactiveProspects.length / otherAgents.length) : 0;
    const distPreview = otherAgents.map((a, i) => {
        const share = i < inactiveProspects.length % otherAgents.length ? perAgent : Math.floor(inactiveProspects.length / otherAgents.length);
        return `<li>${esc(a.full_name || 'Agent')}: ${share} prospects</li>`;
    }).join('');
    const singleAgentOptions = otherAgents.map(a => `<option value="${a.id}">${esc(a.full_name || 'Agent')}</option>`).join('');
    const content = `<div class="bulk-reassign-modal">
        <input type="hidden" id="bulk-reassign-from-agent" value="${agentId}">
        <div style="background:var(--gray-50);padding:16px;border-radius:8px;margin-bottom:16px">
            <div><strong>From Agent:</strong> ${esc(agent.full_name || 'Unknown')}</div><div><strong>Average inactive days:</strong> ${avgDays}</div><div><strong>Prospects selected:</strong> ${inactiveProspects.length}</div>
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
        <div class="form-group"><label>Justification</label><textarea class="form-control" rows="3">${esc(agent.full_name || 'Agent')} has ${inactiveProspects.length} inactive prospect${inactiveProspects.length !== 1 ? 's' : ''}. Redistributing to other agents.</textarea></div>
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

        // Scale-safe: fetch ONLY the selected prospects by id (IN) instead of the
        // whole prospects table. Falls back to the whole-table scan on error.
        // String-coerce ids on both sides (the rest of this file does the same):
        // checkedProspectIds are parseInt() numbers but Supabase ids can surface as
        // strings, in which case a strict includes() would match nothing and bulk
        // reassignment would silently do nothing.
        const checkedIdSet = new Set(checkedProspectIds.map(id => String(id)));
        let matchedProspects;
        try {
            const res = await AppDataStore.queryAdvanced('prospects', { scopeField: 'id', scopeValues: checkedProspectIds, limit: 5000, countMode: null });
            matchedProspects = ((res && res.data) || []).filter(p => checkedIdSet.has(String(p.id)));
        } catch (e) {
            console.warn('confirmBulkReassignment: prospects IN-query failed — full-table fallback', e);
            matchedProspects = (await AppDataStore.getAll('prospects')).filter(p => checkedIdSet.has(String(p.id)));
        }
        const fromAgentId = parseInt(document.getElementById('bulk-reassign-from-agent')?.value) || null;

        const allUsers = await AppDataStore.getAll('users');
        let targetAgents;
        if (option === 'single') {
            const singleId = parseInt(document.getElementById('bulk-single-agent')?.value);
            // String-coerce like the rest of the file: u.id may arrive as a string,
            // so a strict === would resolve no target and trip 'No active agents'.
            const singleAgent = allUsers.find(u => String(u.id) === String(singleId));
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
        // Scale-safe: count customers linked to ANY selected prospect via an IN
        // query (only matching rows) instead of scanning the whole customers table.
        const matchedIds = new Set(matchedProspects.map(p => String(p.id)));
        let linkedCount;
        try {
            const res = await AppDataStore.queryAdvanced('customers', { scopeField: 'converted_from_prospect_id', scopeValues: matchedProspects.map(p => p.id), limit: 10000, countMode: null });
            linkedCount = ((res && res.data) || []).filter(c =>
                matchedIds.has(String(c.converted_from_prospect_id))).length;
        } catch (e) {
            console.warn('confirmBulkReassignment: linked-count IN-query failed — full-table fallback', e);
            linkedCount = (await AppDataStore.getAll('customers')).filter(c =>
                matchedIds.has(String(c.converted_from_prospect_id))).length;
        }

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
            } catch (e) {
                // Log which prospect→agent transfer failed and why — cascadeProspectReassign
                // does multi-table writes with best-effort rollback, so a bare count gives
                // the operator no way to diagnose a partial failure.
                errors++;
                console.warn('[bulkReassign] prospect', prospect.id, '->', targetAgent.id, 'failed:', e && e.message);
            }
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
        const [allProspects, agents, activities, visibleIds] = await Promise.all([
            AppDataStore.getAll('prospects'),
            AppDataStore.getAll('users'),
            AppDataStore.getAll('activities'),
            getVisibleUserIds(_state.cu),
        ]);
        // SECURITY (PII leak): scope the export exactly like the Protection Monitoring
        // view that hosts this button. Per-row RLS on prospects is NOT relied upon
        // (BACK-1 deferred), so without this an L3 agent could export EVERY prospect's
        // name+phone. Mirror showProtectionMonitoringView: keep only prospects whose
        // responsible_agent_id is visible (and limit the agent map to the same set).
        const prospects = visibleIds === 'all'
            ? allProspects
            : allProspects.filter(p => visibleIds.includes(p.responsible_agent_id));
        const visibleAgents = visibleIds === 'all'
            ? agents
            : agents.filter(a => visibleIds.includes(a.id));
        const agentMap = Object.fromEntries(visibleAgents.map(a => [a.id, a.full_name]));
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
            <div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:6px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:var(--gray-500)">
                <i class="fas fa-info-circle"></i> These settings are not yet enforced — the monitoring view currently uses fixed thresholds (Attention &gt;3d, Inactive &gt;7d, Critical &gt;14d).
            </div>
            <div class="form-group">
                <label>Warning threshold (days inactive)</label>
                <input type="number" id="alert-warning-days" class="form-control" value="${warningDays}" min="1" max="30" disabled>
                <small style="color:var(--gray-500)">Prospects inactive for this many days will show as "Attention" <span style="color:var(--gray-400)">(not yet enforced)</span></small>
            </div>
            <div class="form-group">
                <label>Critical threshold (days inactive)</label>
                <input type="number" id="alert-critical-days" class="form-control" value="${criticalDays}" min="1" max="60" disabled>
                <small style="color:var(--gray-500)">Prospects inactive beyond this will show as "Critical" <span style="color:var(--gray-400)">(not yet enforced)</span></small>
            </div>
            <hr style="border:none;border-top:1px solid var(--gray-200);margin:16px 0">
            <div class="form-group">
                <label class="checkbox-label" style="opacity:.55"><input type="checkbox" id="alert-auto-reassign" ${autoReassign ? 'checked' : ''} disabled> Enable auto-reassign suggestion <span style="color:var(--gray-400);font-size:12px">(not yet enforced)</span></label>
                <small style="color:var(--gray-500)">Flag prospects for reassignment after the threshold below</small>
            </div>
            <div class="form-group">
                <label>Auto-reassign suggestion after (days)</label>
                <input type="number" id="alert-auto-days" class="form-control" value="${autoReassignDays}" min="1" max="90" disabled>
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

// BUG (data-integrity): the former initImportDemoData (+ its only helper userExists)
// was removed. It seeded import_jobs / reassignment_history WITHOUT is_demo (so
// ?resetDemo=true could never clear its own seed) and wrote fake rows into the real
// reassignment_history AUDIT table on first load, polluting genuine audit history.
// It was never exported nor invoked (dead/unreachable), so deletion is safe and
// avoids seeding the production audit table.

    app.register('import', {
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
    });
})();