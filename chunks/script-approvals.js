/**
 * CRM Lazy Chunk: Manager Approval Queue & Conversion Approvals
 * Covers: approval queue render/detail, queue + closing approve/reject,
 *   prospect->customer conversion request/approve/reject. Uses _appState.phc
 *   (shared purchases-history cache). Split out of script-prospects.js 2026-06-18.
 */
(() => {
    const _state = window._appState;
    const _utils = window._crmUtils;
    const esc     = (...a) => _utils.escapeHtml(...a);
    const escapeHtml = esc;
    const getVisibleUserIds = (u) => _utils.getVisibleUserIds(u);
    const isMobile = () => _utils.isMobile();
    const isSystemAdmin        = (u) => _utils.isSystemAdmin(u || _state.cu);
    const isMarketingManager   = (u) => _utils.isMarketingManager(u || _state.cu);
    const isAgent              = (u) => _utils.isAgent(u || _state.cu);
    const isManagement         = (u) => _utils.isManagement(u || _state.cu);
    const isTeamLeaderOrAbove  = (u) => _utils.isTeamLeaderOrAbove(u || _state.cu);
    const isStockTakeStaff     = (u) => _utils.isStockTakeStaff(u || _state.cu);
    const isCustomer           = (u) => _utils.isCustomer(u || _state.cu);
    const isReferrer           = (u) => _utils.isReferrer(u || _state.cu);
    const isAgentOrLeader      = (u) => _utils.isAgentOrLeader(u || _state.cu);
    const getAgentsAndLeaders  = () => _utils.getAgentsAndLeaders();
    const getUserLevel         = (u) => _utils.getUserLevel(u);
    const _getUserLevel        = (u) => _utils.getUserLevel(u);
    const canAccessStockTake   = (u) => _utils.isSystemAdmin(u) || _utils.isStockTakeStaff(u);
    const debounce             = _utils.debounce;
    const debounceCall         = _utils.debounceCall;
    // Permission helpers — defined in script.js IIFE, exported to _crmUtils after line ~755.
    const canViewProspect     = (p) => _utils.canViewProspect(p);
    const canViewCustomer     = (c) => _utils.canViewCustomer(c);
    const getVisibleCustomers = ()  => _utils.getVisibleCustomers();
    // navigateTo lives in the script.js IIFE — reach it via window.app.
    const navigateTo          = (v) => window.app.navigateTo(v);
    // Constants defined in script.js IIFE — redeclare locally for chunk scope.
    const USER_ROLES    = _utils.USER_ROLES || [];
    const _PH_PAGE_SIZE = 50;
    // Cross-chunk reassign helpers — defined in script-import.js, exported to window.app.
    // Guards use || noop so callers don't throw if the import chunk hasn't loaded yet
    // (e.g. user opens Prospects view without ever visiting Import/Protection).
    const cascadeProspectReassign   = (...a) => (window.app.cascadeProspectReassign   || (() => Promise.resolve(null)))(...a);
    const _renderReassignSummary    = (...a) => (window.app._renderReassignSummary    || (() => '<p style="color:var(--gray-400)">Loading…</p>'))(...a);
    const _showReassignConfirmPopup = (...a) => (window.app._showReassignConfirmPopup || (() => {}))(...a);
    // Robust activity lookup — defined in script-calendar.js. Falls back to plain
    // AppDataStore.getById when the calendar chunk hasn't loaded yet (e.g. user
    // jumps straight into a prospect detail before opening calendar).
    const _lookupActivityRobust = (...a) => (window.app._lookupActivityRobust || AppDataStore.getById.bind(AppDataStore, 'activities'))(...a);
    // CPS-photo silent uploader — defined in script-cps.js. Fire-and-forget.
    const _uploadCpsFormFile    = (...a) => (window.app._uploadCpsFormFile || (() => Promise.resolve()))(...a);
    // CPS health helpers — defined in script-cps.js, exported to window.app.
    const renderQuickHealthBadge       = (...a) => (window.app.renderQuickHealthBadge       || (() => ''))(...a);
    const renderHealthBadge            = (...a) => (window.app.renderHealthBadge            || (() => ''))(...a);
    const calculateCustomerHealthScore = (...a) => (window.app.calculateCustomerHealthScore || (() => 0))(...a);
    // Import / workflow helpers — defined in script-import.js and script-features2.js.
    const exportMarketingList          = (...a) => (window.app.exportMarketingList          || (() => Promise.resolve()))(...a);
    const executeWorkflows             = (...a) => (window.app.executeWorkflows             || (() => Promise.resolve()))(...a);
    // SCORING_RULES constant — exported by script-features2.js. Fallback guards against load order.
    const SCORING_RULES = window.app.SCORING_RULES || { CREATE_PROSPECT: 5, MARK_NOT_INTERESTED: -500 };
    // addWhatsAppButtonToProfile — defined in script.js IIFE, exported to window.app.
    const addWhatsAppButtonToProfile = (...a) => (window.app.addWhatsAppButtonToProfile || (() => Promise.resolve()))(...a);
    // Current view (read-only reference)
    const _getCurrentView = () => _state.cv;

    // Bug #7: in-flight guard for prospect->customer conversion. Prevents a rapid
    // double-click / queue+modal race from creating two customer rows (and doubling
    // lifetime_value) before the persisted 'converted' status lands. Module-scoped
    // so every entry point (modal, approveQueueEntry, approveClosingRecord, manager
    // auto-convert) shares the same lock.
    const _convInFlight = window._convInFlight || (window._convInFlight = new Set());

    // Audit data-integrity fix: in-flight guard for approveQueueEntry. Mirrors the
    // _convInFlight lock so a rapid double-click / partial-failure retry of the green
    // Approve icon cannot pass the entry.status==='pending' check twice and book the
    // same sale (purchases row + adjustCustomerLtv) more than once.
    const _queueInFlight = window._queueInFlight || (window._queueInFlight = new Set());

const renderApprovalQueue = async () => {
    const tbody = document.getElementById('approval-queue-body');
    if (!tbody) return;
    // Failure-isolated: a transient error loading the approval queue must never
    // bubble up and abort showCustomersView (which would leave the whole
    // Customers tab half-rendered). On error, show a graceful fallback row.
    try {

    // Fetch all three tables in parallel. Previously these awaited
    // sequentially and then the rendering loop did `await getAgentName()`
    // per pending entry (one getById per row). Now we do 3 queries total.
    const [allEntries, allProspects, allUsers] = await Promise.all([
        AppDataStore.getAll('approval_queue'),
        AppDataStore.getAll('prospects'),
        AppDataStore.getAll('users'),
    ]);
    // Hide stale info_update entries for prospects that were never converted
    // to customers — those should never have reached the queue (a previous
    // bug created them on every prospect edit). Approval gating only makes
    // sense once the prospect is a customer, so filter them out here too.
    const convertedIds = new Set(
        (allProspects || []).filter(p => p?.status === 'converted').map(p => String(p.id))
    );
    const userMap = new Map((allUsers || []).map(u => [String(u.id), u]));
    const pending = allEntries
        .filter(e => e.status === 'pending')
        .filter(e => e.approval_type !== 'info_update' || convertedIds.has(String(e.prospect_id)))
        .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));

    const countEl = document.getElementById('approval-queue-count');
    if (countEl) countEl.textContent = pending.length;

    if (pending.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--gray-400);"><i class="fas fa-check-circle" style="margin-right:6px;"></i>No pending approvals</td></tr>';
        return;
    }

    let html = '';
    for (const entry of pending) {
        const agentName = userMap.get(String(entry.submitted_by))?.full_name || 'Unknown';
        const name = entry.snapshot_after?.full_name || '-';
        const typeConfig = {
            new_customer: { label: 'New Customer', icon: 'fa-user-plus', bg: '#dbeafe', color: '#1e40af' },
            info_update: { label: 'Info Update', icon: 'fa-edit', bg: '#fef3c7', color: '#92400e' },
            new_sale: { label: 'New Sale', icon: 'fa-dollar-sign', bg: '#d1fae5', color: '#065f46' }
        };
        const tc = typeConfig[entry.approval_type] || { label: entry.approval_type, icon: 'fa-question', bg: '#f3f4f6', color: '#374151' };
        const dateStr = entry.submitted_at ? new Date(entry.submitted_at).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

        html += `<tr>
            <td><span style="background:${tc.bg}; color:${tc.color}; padding:3px 10px; border-radius:6px; font-size:12px; font-weight:600; white-space:nowrap;"><i class="fas ${tc.icon}" style="margin-right:4px;"></i>${escapeHtml(tc.label)}</span></td>
            <td><strong>${escapeHtml(name)}</strong></td>
            <td>${escapeHtml(agentName)}</td>
            <td style="font-size:12px; white-space:nowrap;">${dateStr}</td>
            <td style="max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px;">${escapeHtml(entry.description || '-')}</td>
            <td onclick="event.stopPropagation()">
                <button class="btn-icon" title="View Details" onclick="event.stopPropagation();app.showApprovalDetail(${entry.id})"><i class="fas fa-eye"></i></button>
                <button class="btn-icon" title="Approve" style="color:#16a34a;" onclick="event.stopPropagation();app.approveQueueEntry(${entry.id})"><i class="fas fa-check-circle"></i></button>
                <button class="btn-icon" title="Reject" style="color:#dc2626;" onclick="event.stopPropagation();app.rejectQueueEntry(${entry.id})"><i class="fas fa-times-circle"></i></button>
            </td>
        </tr>`;
    }
    tbody.innerHTML = html;
    } catch (e) {
        console.warn('[renderApprovalQueue] non-fatal — approval queue load failed:', e?.message || e);
        try { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--gray-400);">Approval queue temporarily unavailable — refresh to retry</td></tr>'; } catch (_) { /* intentional: even the fallback DOM write failed — nothing more to do */ }
    }
};

const showApprovalDetail = async (entryId) => {
    const entry = await AppDataStore.getById('approval_queue', entryId);
    if (!entry) return UI.toast.error('Approval entry not found');

    const agentName = await (window.app.getAgentName || (() => Promise.resolve('')))(entry.submitted_by);
    const snapshot = entry.snapshot_after || {};
    let detailHtml = '';

    if (entry.approval_type === 'new_customer') {
        const cr = snapshot.closing_record;
        const saleAmount = parseFloat(cr?.sale_amount) || 0;
        detailHtml = `
            <div style="background:#dbeafe; border:1px solid #93c5fd; border-radius:8px; padding:12px; font-size:13px; color:#1e40af; margin-bottom:14px;">
                <i class="fas fa-user-plus" style="margin-right:6px;"></i>
                New customer conversion requested by <strong>${escapeHtml(agentName)}</strong>. Approving will create a permanent Customer profile.
            </div>
            <div style="font-size:13px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                <div><span style="color:var(--gray-500);">Name:</span> <strong>${escapeHtml(snapshot.full_name || '-')}</strong></div>
                <div><span style="color:var(--gray-500);">Phone:</span> ${escapeHtml(snapshot.phone || '-')}</div>
                <div><span style="color:var(--gray-500);">IC:</span> ${escapeHtml(snapshot.ic_number || '-')}</div>
                <div><span style="color:var(--gray-500);">DOB:</span> ${escapeHtml(snapshot.date_of_birth || '-')}</div>
                <div><span style="color:var(--gray-500);">Email:</span> ${escapeHtml(snapshot.email || '-')}</div>
                <div><span style="color:var(--gray-500);">Occupation:</span> ${escapeHtml(snapshot.occupation || '-')}</div>
                <div><span style="color:var(--gray-500);">Ming Gua:</span> ${escapeHtml(snapshot.ming_gua || '-')}</div>
                <div><span style="color:var(--gray-500);">Referrer:</span> ${escapeHtml(snapshot.referred_by || '-')}</div>
            </div>
            ${cr ? `
                <div style="border-top:1px solid var(--gray-200); padding-top:12px; margin-top:12px;">
                    <div style="font-weight:600; margin-bottom:8px; font-size:13px;">Sales Record</div>
                    <div style="font-size:13px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <div><span style="color:var(--gray-500);">Product:</span> ${escapeHtml(cr.product || '-')}</div>
                        <div><span style="color:var(--gray-500);">Amount:</span> <strong style="color:#166534;">RM ${saleAmount.toLocaleString()}</strong></div>
                        <div><span style="color:var(--gray-500);">Invoice:</span> ${escapeHtml(cr.invoice_number || '-')}</div>
                        <div><span style="color:var(--gray-500);">Date:</span> ${escapeHtml(cr.closing_date || '-')}</div>
                    </div>
                </div>
            ` : ''}`;
    } else if (entry.approval_type === 'info_update') {
        const before = entry.snapshot_before || {};
        const after = entry.snapshot_after || {};
        const fields = ['full_name','nickname','phone','email','ic_number','date_of_birth','lunar_birth','ming_gua','occupation','company_name','income_range','address','city','state','postal_code','title','gender','nationality','referred_by','referral_relationship'];
        // Audit logic fix: treat an absent (undefined) before/after value as empty so a
        // field newly populated by the agent (undefined before, set after) still shows
        // in the Before/After diff. The old `before[f] !== undefined && after[f] !== undefined`
        // gate silently dropped genuinely-added fields from the manager's review.
        const changedFields = fields.filter(f => String(before[f] ?? '') !== String(after[f] ?? ''));

        detailHtml = `
            <div style="background:#fef3c7; border:1px solid #fcd34d; border-radius:8px; padding:12px; font-size:13px; color:#92400e; margin-bottom:14px;">
                <i class="fas fa-edit" style="margin-right:6px;"></i>
                Information updated by <strong>${escapeHtml(agentName)}</strong>. Review changes below.
            </div>
            ${changedFields.length > 0 ? `
                <table style="width:100%; border-collapse:collapse; font-size:13px;">
                    <thead><tr>
                        <th scope="col" style="text-align:left; padding:6px 8px; border-bottom:2px solid var(--gray-200); color:var(--gray-500);">Field</th>
                        <th scope="col" style="text-align:left; padding:6px 8px; border-bottom:2px solid var(--gray-200); color:#dc2626;">Before</th>
                        <th scope="col" style="text-align:left; padding:6px 8px; border-bottom:2px solid var(--gray-200); color:#16a34a;">After</th>
                    </tr></thead>
                    <tbody>${changedFields.map(f => `<tr>
                        <td style="padding:6px 8px; border-bottom:1px solid var(--gray-100); font-weight:500;">${f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</td>
                        <td style="padding:6px 8px; border-bottom:1px solid var(--gray-100); color:#dc2626; text-decoration:line-through;">${before[f] ? escapeHtml(String(before[f])) : '<em>empty</em>'}</td>
                        <td style="padding:6px 8px; border-bottom:1px solid var(--gray-100); color:#16a34a; font-weight:600;">${after[f] ? escapeHtml(String(after[f])) : '<em>empty</em>'}</td>
                    </tr>`).join('')}</tbody>
                </table>
            ` : '<div style="color:var(--gray-400); font-size:13px; font-style:italic; padding:12px;">No field differences detected.</div>'}`;
    } else if (entry.approval_type === 'new_sale') {
        const cr = entry.snapshot_after || {};
        const saleAmount = parseFloat(cr.sale_amount) || 0;
        detailHtml = `
            <div style="background:#d1fae5; border:1px solid #6ee7b7; border-radius:8px; padding:12px; font-size:13px; color:#065f46; margin-bottom:14px;">
                <i class="fas fa-dollar-sign" style="margin-right:6px;"></i>
                New sale submitted by <strong>${escapeHtml(agentName)}</strong>. Review closing record below.
            </div>
            <div style="font-size:13px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                <div><span style="color:var(--gray-500);">Prospect:</span> <strong>${escapeHtml(cr.full_name || snapshot.prospect_name || '-')}</strong></div>
                <div><span style="color:var(--gray-500);">Product:</span> ${escapeHtml(cr.product || '-')}</div>
                <div><span style="color:var(--gray-500);">Sale Amount:</span> <strong style="color:#166534;">RM ${saleAmount.toLocaleString()}</strong></div>
                <div><span style="color:var(--gray-500);">Payment:</span> ${escapeHtml(cr.payment_method || '-')}</div>
                <div><span style="color:var(--gray-500);">Invoice:</span> ${escapeHtml(cr.invoice_number || '-')}</div>
                <div><span style="color:var(--gray-500);">Closing Date:</span> ${escapeHtml(cr.closing_date || '-')}</div>
                ${cr.sales_idea ? `<div style="grid-column:1/-1;"><span style="color:var(--gray-500);">Sales Idea:</span> ${escapeHtml(cr.sales_idea)}</div>` : ''}
            </div>`;
    }

    UI.showModal('Approval Details', `
        <div style="display:flex; flex-direction:column; gap:14px;">
            ${detailHtml}
            <div style="font-size:12px; color:var(--gray-400); border-top:1px solid var(--gray-100); padding-top:8px;">
                Submitted: ${new Date(entry.submitted_at).toLocaleString('en-MY')} | By: ${escapeHtml(agentName)}
            </div>
        </div>
    `, [
        { label: '<i class="fas fa-times-circle"></i> Reject', type: 'secondary', action: `(async () => { UI.hideModal(); await app.rejectQueueEntry(${entryId}); })()` },
        { label: '<i class="fas fa-check-circle"></i> Approve', type: 'primary', action: `(async () => { await app.approveQueueEntry(${entryId}); })()` }
    ]);
};

const approveQueueEntry = async (entryId) => {
    // Authz (audit security-authz): manager-only. The Approve/Reject UI is gated at
    // L<=4, but these handlers live on window.app and the writes target rows the
    // submitting agent already owns (so RLS does not stop a self-approval). Re-check
    // the caller's level here so an agent can't book their own commission-bearing
    // sale by calling app.approveQueueEntry(id) from the console / a crafted onclick.
    if (!isManagement(_state.cu)) return UI.toast.error('Not permitted');
    const entry = await AppDataStore.getById('approval_queue', entryId);
    if (!entry || entry.status !== 'pending') return UI.toast.error('Entry not found or already processed.');

    // Audit data-integrity fix (in-flight guard): after the pending check, take a
    // per-entry lock so a concurrent second invocation (double-click) is dropped
    // instead of re-executing the purchase/LTV writes. Released in finally.
    const _queueKey = String(entryId);
    if (_queueInFlight.has(_queueKey)) return;
    _queueInFlight.add(_queueKey);
    try {

    const now = new Date().toISOString();
    // Local calendar date (Malaysia UTC+8) — toISOString() gives the UTC day, which
    // is yesterday between 00:00-07:59 MYT and would shift the sale into the wrong
    // day/month/quarter for KPI/PRSB reports.
    const _localToday = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();

    if (entry.approval_type === 'new_customer') {
        // Audit data-integrity fix: approveProspectConversion swallows its own errors
        // internally and updates the matching queue entry itself on success. Return here
        // so we do NOT unconditionally mark this queue row 'approved' + toast success
        // when the conversion actually failed (which would silently lose the request).
        await approveProspectConversion(entry.prospect_id);
        await renderApprovalQueue();
        await window.app.renderCustomersTable();
        return;
    } else if (entry.approval_type === 'info_update') {
        const prospect = await AppDataStore.getById('prospects', entry.prospect_id);
        if (prospect?.status === 'converted') {
            // Scale-safe: fetch only the customer linked to this prospect (eq
            // converted_from_prospect_id) instead of the whole customers table.
            // Falls back to the whole-table scan on error.
            let customer;
            try {
                const linked = await AppDataStore.query('customers', { converted_from_prospect_id: entry.prospect_id });
                customer = (linked || [])[0];
            } catch (e) {
                console.warn('approveQueueEntry: linked-customer query failed — full-table fallback', e);
                customer = (await AppDataStore.getAll('customers')).find(c => c.converted_from_prospect_id == entry.prospect_id);
            }
            // Audit null-deref fix: guard snapshot_after — an info_update row can come
            // back with a null/RLS-trimmed snapshot_after, and indexing it in the loop
            // below would throw and silently abort the approval.
            if (customer && entry.snapshot_after) {
                const syncable = ['title','full_name','nickname','gender','nationality','phone','email','ic_number','date_of_birth','lunar_birth','ming_gua','occupation','company_name','income_range','address','city','state','postal_code','referred_by','referred_by_id','referred_by_type','referral_relationship'];
                const syncFields = {};
                for (const field of syncable) {
                    if (entry.snapshot_after[field] !== undefined) {
                        syncFields[field] = entry.snapshot_after[field];
                    }
                }
                if (Object.keys(syncFields).length > 0) {
                    await AppDataStore.update('customers', customer.id, syncFields);
                }
            } else if (!customer && prospect?.status === 'converted') {
                // Surface (don't silently skip): the prospect's edited fields couldn't be
                // propagated because no customer row is linked via converted_from_prospect_id
                // (legacy/import). The approval still proceeds; a converted_from_prospect_id
                // backfill re-links it so future edits sync.
                console.warn('[approvals] info_update: converted prospect', entry.prospect_id, 'has no linked customer — field sync skipped');
                try { UI.toast.info('Approved — note: no linked customer record found to sync the edited fields.'); } catch (_) {}
            }
        }
    } else if (entry.approval_type === 'new_sale') {
        const prospect = await AppDataStore.getById('prospects', entry.prospect_id);
        if (prospect?.status === 'converted') {
            // Scale-safe: fetch only the customer linked to this prospect (eq
            // converted_from_prospect_id) instead of the whole customers table.
            // Falls back to the whole-table scan on error.
            let customer;
            try {
                const linked = await AppDataStore.query('customers', { converted_from_prospect_id: entry.prospect_id });
                customer = (linked || [])[0];
            } catch (e) {
                console.warn('approveQueueEntry: linked-customer query failed — full-table fallback', e);
                customer = (await AppDataStore.getAll('customers')).find(c => c.converted_from_prospect_id == entry.prospect_id);
            }
            // In-flight guard (audit data-integrity): _queueInFlight already blocks a
            // double-click on THIS entry, but a concurrent approveClosingRecord additional-
            // sale for the SAME prospect could still double-book the purchase + LTV. Reuse
            // the shared _convInFlight set keyed by prospect_id (the same key that path
            // uses) so only one of the two paths books the sale. Skip silently if held.
            const _saleKey = String(entry.prospect_id);
            if (!_convInFlight.has(_saleKey)) {
                _convInFlight.add(_saleKey);
                try {
                // Audit null-deref fix: guard snapshot_after — a new_sale row can come
                // back with a null/RLS-trimmed snapshot_after (same failure the sibling
                // info_update branch guards against). Without this, cr.sale_amount throws.
                const cr = entry.snapshot_after || {};
                const amt = parseFloat(cr.sale_amount) || 0;
                // Converted prospect but no linked customer (legacy/imported, or an
                // earlier customer-create failed): create it now from the prospect +
                // closing record — exactly like approveClosingRecord does. Without this
                // the sale + its LTV were SILENTLY dropped while the queue was still
                // marked 'approved' with a success toast (revenue loss).
                if (!customer) {
                    customer = await AppDataStore.create('customers', {
                        id: window.AppDataStore._generateId(),
                        full_name: prospect.full_name,
                        phone: prospect.phone,
                        email: prospect.email,
                        ic_number: prospect.ic_number,
                        date_of_birth: prospect.date_of_birth,
                        responsible_agent_id: prospect.responsible_agent_id,
                        country: UI.countryByCode(prospect.country).code,
                        status: 'active',
                        lifetime_value: 0,
                        customer_since: cr.closing_date || cr.order_date || _localToday,
                        converted_from_prospect_id: entry.prospect_id,
                    });
                }
                if (customer) {
                    await AppDataStore.create('purchases', {
                        customer_id: customer.id,
                        date: cr.closing_date || _localToday,
                        invoice: cr.invoice_number || '',
                        item: cr.product || '',
                        amount: amt,
                        currency: UI.currencyForCountry(prospect.country),
                        status: 'COMPLETED',
                        payment_method: cr.payment_method || 'Cash'
                    });
                    // Atomic, race-free LTV + total_purchases bump (audit #8/#16/#22) —
                    // matches savePurchase/deletePurchase so all purchase paths agree.
                    await _utils.adjustCustomerLtv(customer.id, amt, 1);
                }
                } finally {
                    _convInFlight.delete(_saleKey);
                }
            }
        }
        if (prospect?.closing_record?.status === 'submitted') {
            const approvedCr = { ...prospect.closing_record, status: 'approved', approved_at: now };
            const existingHistory = Array.isArray(prospect.closing_records_history) ? prospect.closing_records_history : [];
            await AppDataStore.update('prospects', entry.prospect_id, {
                closing_record: null,
                closing_records_history: [...existingHistory, approvedCr]
            });
        }
    }

    await AppDataStore.update('approval_queue', entryId, {
        status: 'approved',
        reviewed_by: _state.cu?.id,
        reviewed_at: now
    });

    UI.hideModal();
    UI.toast.success('Approved successfully!');
    await renderApprovalQueue();
    await window.app.renderCustomersTable();
    } finally {
        _queueInFlight.delete(_queueKey);
    }
};

const rejectQueueEntry = async (entryId) => {
    // Authz (audit security-authz): manager-only — same rationale as approveQueueEntry.
    if (!isManagement(_state.cu)) return UI.toast.error('Not permitted');
    const entry = await AppDataStore.getById('approval_queue', entryId);
    if (!entry || entry.status !== 'pending') return UI.toast.error('Entry not found or already processed.');

    UI.showModal('Reject Approval', `
        <div style="display:flex; flex-direction:column; gap:12px;">
            <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:12px; font-size:13px; color:#991b1b;">
                <i class="fas fa-exclamation-circle" style="margin-right:6px;"></i>
                You are rejecting: <strong>${escapeHtml(entry.description || 'this entry')}</strong>
            </div>
            <div class="form-group">
                <label>Reason for rejection</label>
                <textarea id="reject-reason" class="form-control" rows="3" placeholder="Explain why this is being rejected..." style="width:100%;"></textarea>
            </div>
        </div>
    `, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: '<i class="fas fa-times"></i> Confirm Reject', type: 'primary', action: `(async () => { await app.confirmRejectQueueEntry(${entryId}); })()` }
    ]);
};

const confirmRejectQueueEntry = async (entryId) => {
    // Authz (audit security-authz): this is the function that actually persists the
    // rejection (reverts prospect fields + marks the queue row rejected), so re-gate
    // it too — rejectQueueEntry only opens the modal.
    if (!isManagement(_state.cu)) return UI.toast.error('Not permitted');
    const reason = document.getElementById('reject-reason')?.value?.trim() || '';
    const entry = await AppDataStore.getById('approval_queue', entryId);
    if (!entry) return;

    // Audit null-deref fix: also require snapshot_after — a row with snapshot_before
    // set but snapshot_after null (partial insert / aborted edit / RLS-trimmed JSONB)
    // would otherwise throw `Object.keys(null)`, aborting the whole rejection silently.
    if (entry.approval_type === 'info_update' && entry.snapshot_before && entry.snapshot_after) {
        const revertFields = {};
        for (const key of Object.keys(entry.snapshot_after)) {
            if (entry.snapshot_before[key] !== undefined) {
                revertFields[key] = entry.snapshot_before[key];
            }
        }
        if (Object.keys(revertFields).length > 0) {
            await AppDataStore.update('prospects', entry.prospect_id, revertFields);
        }
    }

    if (entry.approval_type === 'new_customer') {
        await AppDataStore.update('prospects', entry.prospect_id, {
            conversion_status: 'rejected',
            conversion_rejected_at: new Date().toISOString(),
            conversion_rejected_by: _state.cu?.id
        });
    }

    if (entry.approval_type === 'new_sale') {
        const prospect = await AppDataStore.getById('prospects', entry.prospect_id);
        if (prospect?.closing_record?.status === 'submitted') {
            await AppDataStore.update('prospects', entry.prospect_id, {
                closing_record: { ...prospect.closing_record, status: 'draft', rejected_at: new Date().toISOString(), reject_reason: reason }
            });
        }
    }

    await AppDataStore.update('approval_queue', entryId, {
        status: 'rejected',
        reviewed_by: _state.cu?.id,
        reviewed_at: new Date().toISOString(),
        reject_reason: reason
    });

    UI.hideModal();
    UI.toast.info('Approval rejected.');
    await renderApprovalQueue();
};

const approveClosingRecord = async (prospectId) => {
    // Authz (audit security-authz): manager-only. This creates purchases rows,
    // converts prospects to customers and adjusts lifetime_value — an agent must
    // not be able to self-approve their own sale by calling app.approveClosingRecord
    // directly. The UI only renders the approve control at L<=4.
    if (!isManagement(_state.cu)) return UI.toast.error('Not permitted');
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect?.closing_record) return UI.toast.error('No closing record found');
    const isAlreadyConverted = prospect.status === 'converted' || prospect.conversion_status === 'approved';
    if (isAlreadyConverted) {
        // In-flight guard (audit data-integrity): this additional-sale branch creates a
        // purchases row + adjustCustomerLtv with NO other lock, so a rapid double-click
        // would book the sale twice and double the LTV. Reuse the shared _convInFlight set
        // keyed by prospectId so this also coordinates with the new_sale queue path
        // targeting the same prospect. Scoped to this branch only — the else branch below
        // delegates to approveProspectConversion, which takes the SAME _convInFlight lock,
        // so locking here would deadlock that path. Released in finally.
        const _convKey = String(prospectId);
        if (_convInFlight.has(_convKey)) return;
        _convInFlight.add(_convKey);
        try {
        // Additional sale on existing customer — add purchase, archive CR, reset
        const cr = prospect.closing_record;
        const now = new Date().toISOString();
        // Local calendar date (Malaysia UTC+8) — toISOString() gives the UTC day, which
        // is yesterday between 00:00-07:59 MYT and would shift the sale into the wrong
        // day/month/quarter for KPI/PRSB reports.
        const _localToday = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
        const saleAmount = parseFloat(cr.sale_amount) || 0;
        // Scale-safe: fetch only the customer linked to this prospect instead of the
        // whole customers table. Falls back to the whole-table scan on error.
        let customer;
        try {
            const linked = await AppDataStore.query('customers', { converted_from_prospect_id: prospectId });
            customer = (linked || [])[0];
        } catch (e) {
            console.warn('approveClosingRecord: linked-customer query failed — full-table fallback', e);
            customer = (await AppDataStore.getAll('customers', { fresh: true })).find(c => c.converted_from_prospect_id == prospectId);
        }
        if (!customer) {
            // Prospect was marked converted but no customer record exists — create one now
            const newCust = await AppDataStore.create('customers', {
                id: window.AppDataStore._generateId(),
                full_name: prospect.full_name,
                phone: prospect.phone,
                email: prospect.email,
                ic_number: prospect.ic_number,
                date_of_birth: prospect.date_of_birth,
                responsible_agent_id: prospect.responsible_agent_id,
                country: UI.countryByCode(prospect.country).code,
                status: 'active',
                lifetime_value: 0,
                customer_since: cr.closing_date || cr.order_date || _localToday,
                converted_from_prospect_id: prospectId,
            });
            customer = newCust;
        }
        if (customer) {
            await AppDataStore.create('purchases', {
                customer_id: customer.id,
                date: cr.closing_date || cr.order_date || _localToday,
                invoice: cr.invoice_number || '',
                item: cr.product || '',
                amount: saleAmount,
                currency: UI.currencyForCountry(prospect.country),
                status: 'COMPLETED',
                payment_method: cr.payment_method || 'Cash'
            });
            // Atomic, race-free LTV + total_purchases bump (audit #8/#16/#22).
            await _utils.adjustCustomerLtv(customer.id, saleAmount, 1);
        }
        const existingHistory = Array.isArray(prospect.closing_records_history) ? prospect.closing_records_history : [];
        await AppDataStore.update('prospects', prospectId, {
            closing_records_history: [...existingHistory, { ...cr, status: 'approved', approved_at: now }],
            closing_record: null
        });
        UI.toast.success(`Sale of RM ${saleAmount.toLocaleString()} approved!`);
        } finally {
            _convInFlight.delete(_convKey);
        }
    } else {
        // First conversion — reuse full-copy conversion
        await approveProspectConversion(prospectId);
    }
    _state.phc = null;
    const bodyEl = document.getElementById(`acc-body-closing-${prospectId}`);
    if (bodyEl) await window.app.switchProspectTab('closing', prospectId, null, bodyEl);
};

const rejectClosingRecord = async (prospectId) => {
    // Authz (audit security-authz): manager-only — mirrors approveClosingRecord. This
    // mutates a teammate's prospect (closing_record back to 'draft' + rejected_at), and
    // the handler lives on window.app where RLS does not stop a same-team write, so an
    // L5 team leader (never shown reject controls) could bounce a sale from the console.
    if (!isManagement(_state.cu)) return UI.toast.error('Not permitted');
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect?.closing_record) return UI.toast.error('No closing record found');
    const cr = prospect.closing_record;
    await AppDataStore.update('prospects', prospectId, {
        closing_record: { ...cr, status: 'draft', rejected_at: new Date().toISOString() }
    });
    UI.toast.success('Record sent back to agent for revision');
    const bodyEl = document.getElementById(`acc-body-closing-${prospectId}`);
    if (bodyEl) await window.app.switchProspectTab('closing', prospectId, null, bodyEl);
};

const requestProspectConversion = async (prospectId) => {
    await AppDataStore.update('prospects', prospectId, {
        conversion_status: 'pending_approval',
        conversion_requested_at: new Date().toISOString(),
        conversion_requested_by: _state.cu?.id
    });

    // Create approval queue entry for new customer conversion
    try {
        const prospect = await AppDataStore.getById('prospects', prospectId);
        await AppDataStore.create('approval_queue', {
            approval_type: 'new_customer',
            status: 'pending',
            prospect_id: prospectId,
            customer_id: null,
            submitted_by: _state.cu?.id,
            submitted_at: new Date().toISOString(),
            snapshot_before: null,
            snapshot_after: prospect,
            description: `New customer conversion for ${prospect?.full_name || 'prospect'}`
        });
    } catch (e) {
        console.warn('[approval_queue] new_customer (manual submit-for-conversion) insert failed', e);
        try { if (window.UI && UI.toast) (UI.toast.warning || UI.toast.error)('Submitted, but the conversion approval record could not be created.'); } catch (_) {}
    }

    UI.hideModal();
    UI.toast.success('Conversion request submitted. A manager will review and approve shortly.');
    await window.app.renderProspectsTable();
};

const showConversionApprovalModal = async (prospectId) => {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;
    const cr = prospect.closing_record;
    const saleAmount = parseFloat(cr?.sale_amount) || 0;
    const requestedBy = prospect.conversion_requested_by
        ? await (window.app.getAgentName || (() => Promise.resolve('')))(prospect.conversion_requested_by)
        : 'Agent';

    UI.showModal('Review & Approve Conversion', `
        <div style="display:flex; flex-direction:column; gap:14px;">
            <div style="background:#fef3c7; border:1px solid #fcd34d; border-radius:8px; padding:12px; font-size:13px; color:#92400e;">
                <i class="fas fa-user-clock" style="margin-right:6px;"></i>
                Conversion requested by <strong>${escapeHtml(requestedBy)}</strong>. Review all data before approving.
            </div>
            <div style="font-size:13px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                <div><span style="color:var(--gray-500);">Name:</span> <strong>${escapeHtml(prospect.full_name)}</strong></div>
                <div><span style="color:var(--gray-500);">Phone:</span> ${escapeHtml(prospect.phone)}</div>
                <div><span style="color:var(--gray-500);">IC:</span> ${escapeHtml(prospect.ic_number || '-')}</div>
                <div><span style="color:var(--gray-500);">DOB:</span> ${escapeHtml(prospect.date_of_birth || '-')}</div>
                <div><span style="color:var(--gray-500);">Occupation:</span> ${escapeHtml(prospect.occupation || '-')}</div>
                <div><span style="color:var(--gray-500);">Ming Gua:</span> ${escapeHtml(prospect.ming_gua || '-')}</div>
                <div><span style="color:var(--gray-500);">Referrer:</span> ${escapeHtml(prospect.referred_by || '-')}</div>
                <div><span style="color:var(--gray-500);">Relation:</span> ${escapeHtml(prospect.referral_relationship || '-')}</div>
            </div>
            ${cr ? `
                <div style="border-top:1px solid var(--gray-200); padding-top:12px;">
                    <div style="font-weight:600; margin-bottom:8px; font-size:13px;">Sales Record</div>
                    <div style="font-size:13px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <div><span style="color:var(--gray-500);">Product:</span> ${escapeHtml(cr.product || '-')}</div>
                        <div><span style="color:var(--gray-500);">Amount:</span> <strong style="color:#166534;">RM ${saleAmount.toLocaleString()}</strong></div>
                        <div><span style="color:var(--gray-500);">Invoice:</span> ${escapeHtml(cr.invoice_number || '-')}</div>
                        <div><span style="color:var(--gray-500);">Date:</span> ${escapeHtml(cr.closing_date || '-')}</div>
                    </div>
                </div>
            ` : '<div style="color:var(--gray-400); font-size:13px; font-style:italic;">No closing record submitted yet.</div>'}
            <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:12px; font-size:13px; color:#166534;">
                <i class="fas fa-copy" style="margin-right:6px;"></i>
                Approving will <strong>copy all prospect data</strong> into a permanent Customer profile. The prospect will be marked Converted.
            </div>
        </div>
    `, [
        { label: 'Reject', type: 'secondary', action: `(async () => { await app.rejectProspectConversion(${prospectId}); })()` },
        { label: '<i class="fas fa-user-check"></i> Approve Conversion', type: 'primary', action: `(async () => { await app.approveProspectConversion(${prospectId}); })()` }
    ]);
};

const approveProspectConversion = async (prospectId) => {
    // Bug #7 layer 1: synchronous in-flight guard. Set BEFORE the first await so a
    // rapid second invocation (double-click / queue+modal race) is dropped instead
    // of racing to create a duplicate customer.
    const _convKey = String(prospectId);
    if (_convInFlight.has(_convKey)) return;
    _convInFlight.add(_convKey);
    try {
    const prospect = await AppDataStore.getById('prospects', prospectId);
    if (!prospect) return;
    // Bug #7 layer 2: persisted already-converted guard. If this prospect already
    // became a customer, do NOT create a second customer / double the lifetime_value.
    if (prospect.status === 'converted' || prospect.conversion_status === 'approved') {
        UI.toast.info(`${prospect.full_name || 'This prospect'} is already a customer.`);
        UI.hideModal();
        return;
    }
    const cr = prospect.closing_record;
    const saleAmount = parseFloat(cr?.sale_amount) || 0;
    const now = new Date().toISOString();
    // Local calendar date (Malaysia UTC+8) — toISOString() gives the UTC day, which is
    // yesterday between 00:00-07:59 MYT and would shift customer_since / the purchase
    // date into the wrong day/month/quarter for KPI/PRSB reports.
    const _localToday = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();

    // Audit data-integrity fix: persist the prospect's converted/idempotency flag
    // FIRST, before creating the customer. If a later step throws, a manual retry
    // hits the layer-2 guard above (already 'converted'/'approved') and is dropped,
    // so we never create a SECOND customer + duplicate lifetime_value. Previously the
    // order was create-customer → update-prospect, and a failed update left the guard
    // unset, letting a retry duplicate the customer.
    const updatedFields = {
        status: 'converted',
        conversion_status: 'approved',
        conversion_approved_at: now,
        conversion_approved_by: _state.cu?.id
    };
    // Archive closing record to history and reset so a new closing can be started
    if (cr) {
        const existingHistory = Array.isArray(prospect.closing_records_history) ? prospect.closing_records_history : [];
        updatedFields.closing_records_history = [...existingHistory, { ...cr, status: 'approved', approved_at: now }];
        updatedFields.closing_record = null;
    }
    await AppDataStore.update('prospects', prospectId, updatedFields);
    _state.phc = null;

    // Full data copy — every field from prospect goes to customer.
    // Audit #9 fix: create with lifetime_value:0 here, then route the sale through a
    // purchases row + adjustCustomerLtv below. Setting lifetime_value directly with no
    // purchases row + total_purchases:0 re-creates the leaderboard<->LTV divergence the
    // ltv_purchase_backfill migration was written to cure.
    const customer = {
        title: prospect.title || '',
        full_name: prospect.full_name,
        nickname: prospect.nickname || '',
        gender: prospect.gender || '',
        nationality: prospect.nationality || '',
        phone: prospect.phone,
        email: prospect.email || '',
        ic_number: prospect.ic_number || '',
        date_of_birth: prospect.date_of_birth || '',
        lunar_birth: prospect.lunar_birth || '',
        ming_gua: prospect.ming_gua || '',
        occupation: prospect.occupation || '',
        company_name: prospect.company_name || '',
        income_range: prospect.income_range || '',
        address: prospect.address || '',
        city: prospect.city || '',
        state: prospect.state || '',
        postal_code: prospect.postal_code || '',
        referred_by: prospect.referred_by || '',
        referred_by_id: prospect.referred_by_id || null,
        referred_by_type: prospect.referred_by_type || '',
        referral_relationship: prospect.referral_relationship || '',
        responsible_agent_id: prospect.responsible_agent_id || null,
        country: UI.countryByCode(prospect.country).code,
        lifetime_value: 0,
        status: 'active',
        customer_since: cr?.closing_date || _localToday,
        converted_from_prospect_id: prospectId,
        approved_by: _state.cu?.id,
        approved_at: now,
        created_at: now
    };

    const createdCustomer = await AppDataStore.create('customers', customer);
    const newCustomerId = createdCustomer?.id;

    // Audit #9 fix: book the first sale as a real purchases row + atomic LTV bump,
    // mirroring the additional-sale path in approveClosingRecord so all purchase paths
    // agree (lifetime_value AND total_purchases move together, never diverge).
    if (newCustomerId && saleAmount > 0) {
        // Book the sale in its OWN try/catch: the customer + converted-flag are
        // already persisted (idempotent), so if only this step fails a plain retry
        // is blocked by the already-converted guard and would leave LTV=0 silently.
        // Surface a specific, actionable message so the manager records it manually.
        try {
            await AppDataStore.create('purchases', {
                customer_id: newCustomerId,
                date: cr?.closing_date || _localToday,
                invoice: cr?.invoice_number || '',
                item: cr?.product || '',
                amount: saleAmount,
                currency: UI.currencyForCountry(prospect.country),
                status: 'COMPLETED',
                payment_method: cr?.payment_method || 'Cash'
            });
            await _utils.adjustCustomerLtv(newCustomerId, saleAmount, 1);
        } catch (saleErr) {
            console.error('[approveProspectConversion] sale booking failed', saleErr);
            try { UI.toast.error(`Customer created, but recording the RM ${saleAmount.toLocaleString()} sale failed — please add the purchase manually from the customer profile.`); } catch (_) {}
        }
    }

    // Sync approval queue — mark matching new_customer entry as approved
    try {
        // Scale-safe: query only this prospect's rows instead of the whole append-only
        // approval_queue table. Falls back to the full-table scan on error.
        let queueRows;
        try {
            queueRows = await AppDataStore.query('approval_queue', { prospect_id: prospectId });
        } catch (qErr) {
            console.warn('approveProspectConversion: scoped approval_queue query failed — full-table fallback', qErr);
            queueRows = await AppDataStore.getAll('approval_queue');
        }
        const matchingEntry = (queueRows || []).find(e => e.prospect_id == prospectId && e.approval_type === 'new_customer' && e.status === 'pending');
        if (matchingEntry) {
            await AppDataStore.update('approval_queue', matchingEntry.id, {
                status: 'approved',
                reviewed_by: _state.cu?.id,
                reviewed_at: now
            });
        }
    } catch (e) {
        console.warn('[approval_queue] status->approved update failed', e);
        try { if (window.UI && UI.toast) (UI.toast.warning || UI.toast.error)('Approved, but the queue entry status could not be updated.'); } catch (_) {}
    }

    UI.hideModal();
    UI.toast.success(`${prospect.full_name} is now a Customer!`);
    const viewport = document.getElementById('content-viewport');
    if (viewport && _state.cv === 'prospects') await (window.app.showProspectsViewSmart || (() => {}))(viewport);
    } catch (e) {
        // Audit data-integrity fix: surface the failure instead of letting it become a
        // silent unhandled rejection. Leave the modal OPEN so the manager sees the error
        // and can retry — the persisted converted-flag (written first, above) makes any
        // retry idempotent via the layer-2 guard.
        console.error('[approveProspectConversion] failed', e);
        try { UI.toast.error('Conversion failed — please retry. ' + (e?.message || '')); } catch (_) {}
    } finally {
        // Always release the in-flight lock, even on early-return / throw.
        _convInFlight.delete(_convKey);
    }
};

const rejectProspectConversion = async (prospectId) => {
    // Authz (audit security-authz): manager-only — mirrors approveProspectConversion /
    // confirmRejectQueueEntry. Marks a teammate's pending conversion 'rejected' and stamps
    // conversion_rejected_by; the handler is on window.app and RLS permits the same-team
    // write, so gate it here to stop a non-management role tampering from the console.
    if (!isManagement(_state.cu)) return UI.toast.error('Not permitted');
    const now = new Date().toISOString();
    await AppDataStore.update('prospects', prospectId, {
        conversion_status: 'rejected',
        conversion_rejected_at: now,
        conversion_rejected_by: _state.cu?.id
    });

    // Sync approval queue — mark matching new_customer entry as rejected
    try {
        // Scale-safe: query only this prospect's rows instead of the whole append-only
        // approval_queue table. Falls back to the full-table scan on error.
        let queueRows;
        try {
            queueRows = await AppDataStore.query('approval_queue', { prospect_id: prospectId });
        } catch (qErr) {
            console.warn('rejectProspectConversion: scoped approval_queue query failed — full-table fallback', qErr);
            queueRows = await AppDataStore.getAll('approval_queue');
        }
        const matchingEntry = (queueRows || []).find(e => e.prospect_id == prospectId && e.approval_type === 'new_customer' && e.status === 'pending');
        if (matchingEntry) {
            await AppDataStore.update('approval_queue', matchingEntry.id, {
                status: 'rejected',
                reviewed_by: _state.cu?.id,
                reviewed_at: now
            });
        }
    } catch (e) {
        console.warn('[approval_queue] status->rejected update failed', e);
        try { if (window.UI && UI.toast) (UI.toast.warning || UI.toast.error)('Rejected, but the queue entry status could not be updated.'); } catch (_) {}
    }

    UI.hideModal();
    UI.toast.info('Conversion rejected. Agent can resubmit after reviewing.');
    await window.app.renderProspectsTable();
};


    app.register('approvals', {
        approveClosingRecord,
        approveProspectConversion,
        approveQueueEntry,
        confirmRejectQueueEntry,
        rejectClosingRecord,
        rejectProspectConversion,
        rejectQueueEntry,
        renderApprovalQueue,
        requestProspectConversion,
        showApprovalDetail,
        showConversionApprovalModal,
    });
})();
