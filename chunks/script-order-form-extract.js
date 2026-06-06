/**
 * CRM Lazy Chunk: Standalone Order Form Extract + History Viewer
 *   Tab A — Scan: capture/upload photo → Gemini OCR → display all fields
 *   Tab B — History: searchable table of all past order form scans
 * Loaded lazily by navigateTo('order_form_extract').
 */
(() => {
    'use strict';
    const _utils = window._crmUtils;
    const esc    = (...a) => _utils.escapeHtml(...a);

    // ── Shared field definitions ───────────────────────────────────────────
    const FIELD_GROUPS = [
        { title: 'Order Info', icon: 'fa-file-invoice', fields: [
            ['form_type',           'Template'],
            ['prn_number',          'PRN / PR Number'],
            ['order_ref',           'Order Reference'],
            ['order_date',          'Order Date'],
            ['consultant',          'Consultant'],
            ['agent_code',          'Agent Code'],
            ['collection_branch',   'Collection Branch'],
            ['business_month',      'Business Month'],
        ]},
        { title: 'Customer', icon: 'fa-user', fields: [
            ['customer_name',       'Full Name'],
            ['customer_nric',       'NRIC'],
            ['customer_phone',      'Phone'],
            ['customer_email',      'Email'],
            ['customer_address',    'Address'],
            ['customer_occupation', 'Occupation'],
            ['customer_attn',       'Attention'],
        ]},
        { title: 'Product', icon: 'fa-gem', fields: [
            ['product_name',        'Product Name'],
            ['product_ringsize',    'Ring Size'],
            ['product_solar_bd',    'Solar Birth Date'],
            ['product_lunar_bd',    'Lunar Birth Date'],
            ['product_lifesign',    'Lifesign'],
            ['product_usage',       'Usage'],
            ['product_gender',      'Gender'],
            ['product_gua',         'Gua'],
            ['product_category',    'Category'],
        ]},
        { title: 'Amounts', icon: 'fa-dollar-sign', fields: [
            ['amount_unit_price',        'Unit Price (RM)'],
            ['amount_down_payment',      'Down Payment (RM)'],
            ['amount_security_deposit',  'Security Deposit (RM)'],
            ['amount_total_due',         'Total Due (RM)'],
            ['amount_grand_total',       'Grand Total (RM)'],
        ]},
        { title: 'Installment (POP)', icon: 'fa-calendar-check', fields: [
            ['installment_monthly',       'Monthly Payment (RM)'],
            ['installment_tenure_months', 'Tenure (months)'],
            ['installment_amount',        'Installment Amount (RM)'],
        ]},
        { title: 'Payment', icon: 'fa-credit-card', fields: [
            ['payment_type',             'Payment Type'],
            ['payment_method',           'Payment Method'],
            ['card_holder',              'Card Holder'],
            ['card_last4',               'Card (last 4)'],
            ['card_expiry',              'Card Expiry'],
            ['card_issuing_bank',        'Issuing Bank'],
            ['third_party_relationship', 'Third Party'],
        ]},
        { title: 'Transaction', icon: 'fa-receipt', fields: [
            ['transaction_reference', 'Transaction Ref'],
            ['transaction_receipt_no','Receipt Number'],
            ['transaction_gateway',   'Gateway'],
        ]},
    ];

    const _confColor = (c) =>
        c === 'high' ? '#10b981' : c === 'medium' ? '#f59e0b' : c === 'low' ? '#ef4444' : '#9ca3af';

    const _confBadge = (c) => c
        ? `<span style="display:inline-block;padding:1px 6px;border-radius:10px;background:${_confColor(c)}1a;color:${_confColor(c)};font-size:10px;font-weight:600;text-transform:uppercase;">${c}</span>`
        : '';

    const _formTypeLabel = (t) => ({ A: 'Template A', B: 'Template B', C: 'Template C' }[t] || (t || '—'));

    // ── Module state ───────────────────────────────────────────────────────
    let _ofeResult     = null;
    let _ofeAllRows    = [];   // cached history rows
    let _ofeHistPage   = 0;
    let _ofeHistSearch = '';
    const _HIST_PAGE_SIZE = 50;

    // ══════════════════════════════════════════════════════════════════════
    // Page shell — tabs: Scan | History
    // ══════════════════════════════════════════════════════════════════════
    const showOrderFormExtractView = async (viewport) => {
        _ofeResult = null;
        _ofeAllRows = [];
        _ofeHistPage = 0;
        _ofeHistSearch = '';
        viewport.innerHTML = `
            <div class="view-header" style="padding:20px 24px 0;">
                <h2 class="view-title" style="display:flex;align-items:center;gap:8px;">
                    <i class="fas fa-file-search" style="color:var(--primary,#6366f1);"></i>
                    Order Form Extract
                </h2>
            </div>
            <div style="max-width:980px;margin:0 auto;padding:16px 20px 48px;">
                <!-- Tab bar -->
                <div style="display:flex;gap:0;border-bottom:2px solid var(--border,#e2e8f0);margin-bottom:20px;">
                    <button id="ofe-tab-scan" onclick="app.ofeShowTab('scan')"
                        style="padding:10px 20px;background:none;border:none;cursor:pointer;font-size:14px;font-weight:600;color:var(--primary,#6366f1);border-bottom:2px solid var(--primary,#6366f1);margin-bottom:-2px;">
                        <i class="fas fa-camera"></i> Scan
                    </button>
                    <button id="ofe-tab-history" onclick="app.ofeShowTab('history')"
                        style="padding:10px 20px;background:none;border:none;cursor:pointer;font-size:14px;font-weight:600;color:var(--gray-500);border-bottom:2px solid transparent;margin-bottom:-2px;">
                        <i class="fas fa-history"></i> History
                    </button>
                </div>
                <!-- Scan pane -->
                <div id="ofe-pane-scan">
                    <div id="ofe-upload-zone" style="background:var(--surface,#fff);border:2px dashed var(--border,#e2e8f0);border-radius:12px;padding:32px 24px;text-align:center;margin-bottom:20px;">
                        <div style="font-size:36px;color:var(--gray-300);margin-bottom:12px;"><i class="fas fa-camera-retro"></i></div>
                        <div style="font-weight:600;color:var(--gray-700);margin-bottom:6px;font-size:15px;">Scan a PREON order form</div>
                        <div style="font-size:13px;color:var(--gray-400);margin-bottom:20px;">Templates A, B, C supported &nbsp;·&nbsp; JPG or PNG &nbsp;·&nbsp; max 8 MB</div>
                        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;align-items:center;">
                            <button class="btn primary" style="gap:6px;" onclick="document.getElementById('ofe-camera-input').click()">
                                <i class="fas fa-camera"></i> Take Photo
                            </button>
                            <button class="btn secondary" style="gap:6px;" onclick="document.getElementById('ofe-file-input').click()">
                                <i class="fas fa-upload"></i> Upload File
                            </button>
                            <select id="ofe-form-type" class="form-control" style="width:auto;padding:6px 12px;font-size:13px;height:auto;">
                                <option value="auto">Auto-detect template</option>
                                <option value="A">Template A — PRN Installment</option>
                                <option value="B">Template B — PRN Receipt</option>
                                <option value="C">Template C — Old Paper</option>
                            </select>
                        </div>
                        <input type="file" id="ofe-camera-input" accept="image/*" capture="environment" style="display:none;" onchange="app.ofeHandleFile(this)">
                        <input type="file" id="ofe-file-input" accept="image/png,image/jpeg" style="display:none;" onchange="app.ofeHandleFile(this)">
                    </div>
                    <div id="ofe-status" style="margin-bottom:16px;"></div>
                    <div id="ofe-result"></div>
                </div>
                <!-- History pane (hidden initially) -->
                <div id="ofe-pane-history" style="display:none;">
                    <div id="ofe-history-content"></div>
                </div>
            </div>
        `;
    };

    // ── Tab switch ─────────────────────────────────────────────────────────
    const ofeShowTab = (tab) => {
        const scanPane    = document.getElementById('ofe-pane-scan');
        const histPane    = document.getElementById('ofe-pane-history');
        const tabScan     = document.getElementById('ofe-tab-scan');
        const tabHist     = document.getElementById('ofe-tab-history');
        if (!scanPane || !histPane) return;

        const active   = 'color:var(--primary,#6366f1);border-bottom:2px solid var(--primary,#6366f1);margin-bottom:-2px;';
        const inactive = 'color:var(--gray-500);border-bottom:2px solid transparent;margin-bottom:-2px;';

        if (tab === 'history') {
            scanPane.style.display  = 'none';
            histPane.style.display  = '';
            tabScan.style.color     = 'var(--gray-500)';
            tabScan.style.borderBottom = '2px solid transparent';
            tabHist.style.color     = 'var(--primary,#6366f1)';
            tabHist.style.borderBottom = '2px solid var(--primary,#6366f1)';
            if (_ofeAllRows.length === 0) _ofeLoadHistory();
        } else {
            histPane.style.display  = 'none';
            scanPane.style.display  = '';
            tabHist.style.color     = 'var(--gray-500)';
            tabHist.style.borderBottom = '2px solid transparent';
            tabScan.style.color     = 'var(--primary,#6366f1)';
            tabScan.style.borderBottom = '2px solid var(--primary,#6366f1)';
        }
    };

    // ══════════════════════════════════════════════════════════════════════
    // Option B — History Viewer
    // ══════════════════════════════════════════════════════════════════════
    const _ofeLoadHistory = async () => {
        const el = document.getElementById('ofe-history-content');
        if (!el) return;
        el.innerHTML = `<div style="padding:32px;text-align:center;color:var(--gray-400);"><i class="fas fa-spinner fa-spin"></i> Loading scanned forms…</div>`;

        try {
            const sb = window.supabase || window.supabaseClient;
            if (!sb) throw new Error('Supabase not available');

            const { data, error } = await sb
                .from('prospect_attachments')
                .select('id, prospect_id, file_url, filename, metadata, scanned_at, scan_confidence')
                .eq('attachment_type', 'order_form')
                .order('scanned_at', { ascending: false })
                .limit(500);

            if (error) throw error;
            _ofeAllRows = data || [];
            _ofeHistPage = 0;
            _ofeRenderHistory();

        } catch (err) {
            if (el) el.innerHTML = `<div style="padding:24px;color:#b71c1c;background:#ffebee;border-radius:8px;font-size:13px;">
                <i class="fas fa-exclamation-triangle"></i> Failed to load history: ${esc(err.message || String(err))}
            </div>`;
        }
    };

    const _ofeRenderHistory = () => {
        const el = document.getElementById('ofe-history-content');
        if (!el) return;

        const q = _ofeHistSearch.toLowerCase().trim();
        const filtered = q
            ? _ofeAllRows.filter(r => {
                const m = r.metadata || {};
                const f = m.fields || {};
                return (
                    (f.customer_name || '').toLowerCase().includes(q) ||
                    (f.customer_nric || '').toLowerCase().includes(q) ||
                    (m.prn_number    || f.prn_number || '').toLowerCase().includes(q) ||
                    (f.agent_code    || '').toLowerCase().includes(q) ||
                    (f.product_name  || '').toLowerCase().includes(q) ||
                    (f.consultant    || '').toLowerCase().includes(q)
                );
            })
            : _ofeAllRows;

        const total   = filtered.length;
        const start   = _ofeHistPage * _HIST_PAGE_SIZE;
        const pageRows = filtered.slice(start, start + _HIST_PAGE_SIZE);
        const pages   = Math.ceil(total / _HIST_PAGE_SIZE);

        const _fmt = (iso) => {
            if (!iso) return '—';
            try {
                const d = new Date(iso);
                return d.toLocaleDateString('en-MY', { day:'2-digit', month:'short', year:'numeric' })
                    + ' ' + d.toLocaleTimeString('en-MY', { hour:'2-digit', minute:'2-digit' });
            } catch { return iso.slice(0, 16).replace('T', ' '); }
        };

        const rowsHtml = pageRows.map((r, idx) => {
            const m   = r.metadata || {};
            const f   = m.fields   || {};
            const c   = m.confidence || {};
            const rid = esc(r.id);
            const confPct = r.scan_confidence != null
                ? Math.round(r.scan_confidence * 100) + '%'
                : '—';
            const confColor = r.scan_confidence >= 0.8 ? '#10b981' : r.scan_confidence >= 0.5 ? '#f59e0b' : '#ef4444';
            const customer  = f.customer_name || '—';
            const prn       = m.prn_number || f.prn_number || '—';
            const product   = f.product_name || '—';
            const amount    = f.amount_total_due || f.amount_unit_price || '—';
            const amountDisp = (amount !== '—') ? 'RM ' + esc(String(amount)) : '—';
            const template  = _formTypeLabel(m.form_type || f.form_type);
            const date      = _fmt(r.scanned_at);
            const bgRow = (start + idx) % 2 === 0 ? 'var(--surface,#fff)' : 'var(--gray-50,#f8fafc)';

            return `<tr id="ofe-row-${rid}" style="background:${bgRow};cursor:pointer;" onclick="app.ofeHistToggleRow('${rid}')">
                <td style="padding:10px 12px;font-size:12px;color:var(--gray-500);white-space:nowrap;">${esc(date)}</td>
                <td style="padding:10px 12px;font-size:12px;white-space:nowrap;">${esc(template)}</td>
                <td style="padding:10px 12px;font-size:13px;font-weight:500;color:var(--gray-900);">${esc(customer)}</td>
                <td style="padding:10px 12px;font-size:12px;font-family:monospace;">${esc(prn)}</td>
                <td style="padding:10px 12px;font-size:12px;color:var(--gray-700);">${esc(product)}</td>
                <td style="padding:10px 12px;font-size:12px;font-weight:600;">${amountDisp}</td>
                <td style="padding:10px 12px;font-size:12px;font-weight:700;color:${r.scan_confidence != null ? confColor : 'var(--gray-400)'};">${confPct}</td>
                <td style="padding:10px 12px;text-align:center;">
                    ${r.file_url
                        ? `<button class="btn secondary" style="padding:3px 10px;font-size:11px;" onclick="event.stopPropagation();window._openAttachment && window._openAttachment('${esc(r.file_url)}')"><i class="fas fa-image"></i></button>`
                        : ''}
                </td>
            </tr>
            <tr id="ofe-expand-${rid}" style="display:none;">
                <td colspan="8" style="padding:0;border-bottom:2px solid var(--border,#e2e8f0);">
                    <div id="ofe-expand-body-${rid}" style="padding:16px 20px;background:var(--gray-50,#f8fafc);">
                    </div>
                </td>
            </tr>`;
        }).join('');

        const pagingHtml = pages > 1 ? `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-top:1px solid var(--border,#e2e8f0);font-size:13px;color:var(--gray-600);">
                <span>Showing ${start + 1}–${Math.min(start + _HIST_PAGE_SIZE, total)} of ${total}</span>
                <div style="display:flex;gap:6px;">
                    ${_ofeHistPage > 0 ? `<button class="btn secondary" style="padding:4px 12px;font-size:12px;" onclick="app.ofeHistPage(${_ofeHistPage - 1})"><i class="fas fa-chevron-left"></i> Prev</button>` : ''}
                    <span style="padding:4px 10px;font-size:12px;">Page ${_ofeHistPage + 1} / ${pages}</span>
                    ${_ofeHistPage < pages - 1 ? `<button class="btn secondary" style="padding:4px 12px;font-size:12px;" onclick="app.ofeHistPage(${_ofeHistPage + 1})">Next <i class="fas fa-chevron-right"></i></button>` : ''}
                </div>
            </div>` : '';

        el.innerHTML = `
            <!-- Toolbar -->
            <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap;">
                <div style="position:relative;flex:1;min-width:200px;max-width:360px;">
                    <i class="fas fa-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--gray-400);font-size:13px;"></i>
                    <input type="text" id="ofe-hist-search" placeholder="Search customer, PRN, agent, product…"
                        value="${esc(_ofeHistSearch)}"
                        oninput="app.ofeHistSearch(this.value)"
                        style="width:100%;padding:8px 10px 8px 32px;border:1px solid var(--border,#e2e8f0);border-radius:8px;font-size:13px;box-sizing:border-box;">
                </div>
                <span style="font-size:13px;color:var(--gray-500);">${total} record${total !== 1 ? 's' : ''}</span>
                <button class="btn secondary" style="padding:6px 12px;font-size:12px;margin-left:auto;" onclick="app.ofeRefreshHistory()">
                    <i class="fas fa-sync-alt"></i> Refresh
                </button>
            </div>
            <!-- Table -->
            <div style="background:var(--surface,#fff);border:1px solid var(--border,#e2e8f0);border-radius:10px;overflow:hidden;">
                ${total === 0
                    ? `<div style="padding:40px;text-align:center;color:var(--gray-400);">
                           <i class="fas fa-inbox" style="font-size:24px;margin-bottom:10px;display:block;"></i>
                           ${q ? 'No scans match your search.' : 'No order forms have been scanned yet.'}
                       </div>`
                    : `<div style="overflow-x:auto;">
                        <table style="width:100%;border-collapse:collapse;min-width:680px;">
                            <thead>
                                <tr style="background:var(--gray-50,#f8fafc);border-bottom:2px solid var(--border,#e2e8f0);text-align:left;">
                                    <th style="padding:10px 12px;font-size:11px;color:var(--gray-500);text-transform:uppercase;letter-spacing:.4px;white-space:nowrap;">Scanned At</th>
                                    <th style="padding:10px 12px;font-size:11px;color:var(--gray-500);text-transform:uppercase;letter-spacing:.4px;">Template</th>
                                    <th style="padding:10px 12px;font-size:11px;color:var(--gray-500);text-transform:uppercase;letter-spacing:.4px;">Customer</th>
                                    <th style="padding:10px 12px;font-size:11px;color:var(--gray-500);text-transform:uppercase;letter-spacing:.4px;">PRN</th>
                                    <th style="padding:10px 12px;font-size:11px;color:var(--gray-500);text-transform:uppercase;letter-spacing:.4px;">Product</th>
                                    <th style="padding:10px 12px;font-size:11px;color:var(--gray-500);text-transform:uppercase;letter-spacing:.4px;">Amount</th>
                                    <th style="padding:10px 12px;font-size:11px;color:var(--gray-500);text-transform:uppercase;letter-spacing:.4px;">Conf.</th>
                                    <th style="padding:10px 12px;width:52px;"></th>
                                </tr>
                            </thead>
                            <tbody>${rowsHtml}</tbody>
                        </table>
                       </div>
                       ${pagingHtml}`
                }
            </div>
        `;
    };

    // Expand/collapse a row to show the full field card inline
    const ofeHistToggleRow = (id) => {
        const expRow  = document.getElementById(`ofe-expand-${id}`);
        const expBody = document.getElementById(`ofe-expand-body-${id}`);
        if (!expRow) return;
        const isOpen = expRow.style.display !== 'none';
        expRow.style.display = isOpen ? 'none' : '';
        if (!isOpen && expBody) {
            const record = _ofeAllRows.find(r => String(r.id) === String(id));
            if (record) {
                expBody.innerHTML = _ofeFieldCard(record);
            }
        }
    };

    const _ofeFieldCard = (record) => {
        const m   = record.metadata || {};
        const fields = m.fields || {};
        const confidence = m.confidence || {};

        const confValues = Object.values(confidence)
            .map(c => c === 'high' ? 1 : c === 'medium' ? 0.6 : c === 'low' ? 0.3 : null)
            .filter(v => v !== null);
        const meanConf = confValues.length
            ? Math.round(confValues.reduce((a, b) => a + b, 0) / confValues.length * 100)
            : (record.scan_confidence != null ? Math.round(record.scan_confidence * 100) : null);
        const confGaugeColor = meanConf >= 80 ? '#10b981' : meanConf >= 50 ? '#f59e0b' : '#ef4444';

        const groupsHtml = FIELD_GROUPS.map(({ title, icon, fields: fList }) => {
            const rows = fList.map(([key, label]) => {
                const val = fields[key];
                if (val == null || String(val).trim() === '') return '';
                const conf = confidence[key];
                return `<tr style="border-bottom:1px solid var(--gray-100,#f1f5f9);">
                    <td style="padding:6px 10px;color:var(--gray-500);font-size:11px;white-space:nowrap;width:40%;">${esc(label)}</td>
                    <td style="padding:6px 10px;color:var(--gray-900);font-size:12px;font-weight:500;word-break:break-word;">${esc(String(val))} ${_confBadge(conf)}</td>
                </tr>`;
            }).join('');
            if (!rows) return '';
            return `<div style="background:var(--surface,#fff);border:1px solid var(--border,#e2e8f0);border-radius:8px;margin-bottom:8px;overflow:hidden;">
                <div style="padding:7px 12px;background:var(--gray-50,#f8fafc);border-bottom:1px solid var(--border,#e2e8f0);font-weight:600;font-size:11px;color:var(--gray-600);display:flex;align-items:center;gap:6px;text-transform:uppercase;letter-spacing:.4px;">
                    <i class="fas ${esc(icon)}" style="color:var(--primary,#6366f1);font-size:10px;"></i>${esc(title)}
                </div>
                <table style="width:100%;border-collapse:collapse;">${rows}</table>
            </div>`;
        }).join('');

        const photoHtml = record.file_url
            ? `<img src="${esc(record.file_url)}" loading="lazy"
                    style="width:100%;border-radius:8px;border:1px solid var(--border,#e2e8f0);margin-bottom:10px;cursor:zoom-in;"
                    onclick="window._openAttachment && window._openAttachment('${esc(record.file_url)}')">`
            : `<div style="width:100%;aspect-ratio:3/4;background:var(--gray-100);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--gray-300);margin-bottom:10px;font-size:28px;">
                   <i class="fas fa-image"></i></div>`;

        return `<div style="display:grid;grid-template-columns:200px 1fr;gap:16px;align-items:start;">
            <div>
                ${photoHtml}
                <div style="background:var(--surface,#fff);border:1px solid var(--border,#e2e8f0);border-radius:8px;padding:12px;font-size:12px;">
                    <div style="font-size:10px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;">Template</div>
                    <div style="font-weight:600;color:var(--gray-900);margin-bottom:10px;">${esc(_formTypeLabel(m.form_type || fields.form_type))}</div>
                    ${meanConf !== null ? `
                    <div style="font-size:10px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;">Avg Confidence</div>
                    <div style="font-weight:700;font-size:18px;color:${confGaugeColor};">${meanConf}%</div>` : ''}
                </div>
            </div>
            <div style="max-height:400px;overflow-y:auto;">
                ${groupsHtml || '<div style="color:var(--gray-400);padding:16px;font-size:13px;">No field data stored for this scan.</div>'}
            </div>
        </div>`;
    };

    // Public handlers called from inline HTML
    const ofeHistSearch = (val) => {
        _ofeHistSearch = val || '';
        _ofeHistPage = 0;
        _ofeRenderHistory();
    };

    const ofeHistPage = (page) => {
        _ofeHistPage = page;
        _ofeRenderHistory();
        document.getElementById('ofe-history-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const ofeRefreshHistory = () => {
        _ofeAllRows = [];
        _ofeHistPage = 0;
        _ofeLoadHistory();
    };

    // ══════════════════════════════════════════════════════════════════════
    // Option C — Create Closing Activity from scan result
    // ══════════════════════════════════════════════════════════════════════
    let _ofeLinkedProspect = null;   // { id, name, entityType }
    let _ofeClosTimer = null;

    const _ofeMapPayment = (type, method) => {
        const t = (type   || '').toLowerCase();
        const m = (method || '').toLowerCase();
        if (m.includes('standing') || t.includes('standing')) return 'POP';
        if (m.includes('online') || m.includes('mpgs') || t === 'visa' || t === 'master'
            || t.includes('credit') || t.includes('debit')) return 'Credit Card';
        if (t.includes('cheque')) return 'Cheque';
        if (m.includes('direct') || t.includes('direct') || t.includes('bank')) return 'Bank Transfer';
        if (t === 'epp') return 'EPP';
        if (t.includes('cash')) return 'Cash';
        return null;
    };

    const _ofeCleanNum = (v) => {
        if (!v) return null;
        const s = String(v).replace(/\bRM\b/gi, '').replace(/,/g, '').trim();
        const n = parseFloat(s);
        return isNaN(n) ? null : n;
    };

    const _ofeRenderClosingPanel = (fields, confidence) => {
        const resultEl = document.getElementById('ofe-result');
        if (!resultEl) return;
        _ofeLinkedProspect = null;

        const product   = fields.product_name || '';
        const amount    = _ofeCleanNum(fields.amount_total_due || fields.amount_unit_price);
        const payment   = _ofeMapPayment(fields.payment_type, fields.payment_method);
        const prn       = fields.prn_number || '';
        const colDate   = fields.order_date || '';
        const isPop     = payment === 'POP';
        const popAmt    = _ofeCleanNum(fields.installment_monthly);
        const popTen    = fields.installment_tenure_months || '';
        const popDown   = _ofeCleanNum(fields.amount_down_payment);

        const fieldRows = [
            product   ? `<tr><td style="color:var(--gray-500);width:44%;padding:4px 8px;font-size:12px;">Product</td><td style="font-size:12px;font-weight:500;padding:4px 8px;">${esc(product)}</td></tr>` : '',
            amount    ? `<tr><td style="color:var(--gray-500);width:44%;padding:4px 8px;font-size:12px;">Amount</td><td style="font-size:12px;font-weight:600;color:#10b981;padding:4px 8px;">RM ${esc(String(amount))}</td></tr>` : '',
            payment   ? `<tr><td style="color:var(--gray-500);width:44%;padding:4px 8px;font-size:12px;">Payment</td><td style="font-size:12px;padding:4px 8px;">${esc(payment)}</td></tr>` : '',
            prn       ? `<tr><td style="color:var(--gray-500);width:44%;padding:4px 8px;font-size:12px;">PRN / Invoice</td><td style="font-size:12px;font-family:monospace;padding:4px 8px;">${esc(prn)}</td></tr>` : '',
            colDate   ? `<tr><td style="color:var(--gray-500);width:44%;padding:4px 8px;font-size:12px;">Collection Date</td><td style="font-size:12px;padding:4px 8px;">${esc(colDate)}</td></tr>` : '',
            isPop && popAmt  ? `<tr><td style="color:var(--gray-500);width:44%;padding:4px 8px;font-size:12px;">Monthly (POP)</td><td style="font-size:12px;padding:4px 8px;">RM ${esc(String(popAmt))}</td></tr>` : '',
            isPop && popTen  ? `<tr><td style="color:var(--gray-500);width:44%;padding:4px 8px;font-size:12px;">Tenure</td><td style="font-size:12px;padding:4px 8px;">${esc(String(popTen))} months</td></tr>` : '',
            isPop && popDown ? `<tr><td style="color:var(--gray-500);width:44%;padding:4px 8px;font-size:12px;">Down Payment</td><td style="font-size:12px;padding:4px 8px;">RM ${esc(String(popDown))}</td></tr>` : '',
        ].filter(Boolean).join('');

        const panelHtml = `
            <div id="ofe-closing-panel" style="margin-top:24px;background:var(--surface,#fff);border:1px solid var(--border,#e2e8f0);border-radius:12px;overflow:hidden;">
                <div style="padding:12px 16px;background:var(--gray-50,#f8fafc);border-bottom:1px solid var(--border,#e2e8f0);display:flex;align-items:center;gap:8px;">
                    <i class="fas fa-plus-circle" style="color:var(--primary,#6366f1);"></i>
                    <span style="font-weight:600;color:var(--gray-700);font-size:14px;">Create Closing Activity</span>
                </div>
                <div style="padding:16px 18px;">
                    <!-- Step 1: Prospect search -->
                    <div id="ofe-clos-step1">
                        <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:var(--gray-500);margin-bottom:8px;">Step 1 — Find Prospect</div>
                        <div style="position:relative;">
                            <i class="fas fa-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--gray-400);font-size:13px;pointer-events:none;"></i>
                            <input type="text" id="ofe-clos-search" placeholder="Search by name, phone, or NRIC…"
                                oninput="app.ofeClosSearch(this.value)"
                                style="width:100%;padding:9px 10px 9px 32px;border:1px solid var(--border,#e2e8f0);border-radius:8px;font-size:13px;box-sizing:border-box;">
                        </div>
                        <div id="ofe-clos-results" style="margin-top:6px;"></div>
                    </div>
                    <!-- Step 2 + 3: Review & Save (hidden until prospect selected) -->
                    <div id="ofe-clos-step2" style="display:none;">
                        <div id="ofe-clos-badge" style="margin-bottom:14px;"></div>
                        <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:var(--gray-500);margin-bottom:6px;">Step 2 — Fields to Save</div>
                        <div style="background:var(--gray-50,#f8fafc);border:1px solid var(--border,#e2e8f0);border-radius:8px;margin-bottom:14px;overflow:hidden;">
                            ${fieldRows
                                ? `<table style="width:100%;border-collapse:collapse;">${fieldRows}</table>`
                                : '<div style="padding:12px;color:var(--gray-400);font-size:12px;">No closing fields extracted — will create an empty closing record.</div>'}
                        </div>
                        <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:var(--gray-500);margin-bottom:8px;">Activity Type</div>
                        <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
                            <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;color:var(--gray-700);">
                                <input type="radio" name="ofe-clos-type" value="FTF" checked> FTF (Face to Face)
                            </label>
                            <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;color:var(--gray-700);">
                                <input type="radio" name="ofe-clos-type" value="GR"> GR (Golden Road)
                            </label>
                            <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;color:var(--gray-700);">
                                <input type="radio" name="ofe-clos-type" value="XG"> XG (Xin Gua)
                            </label>
                        </div>
                        <div style="display:flex;gap:8px;">
                            <button class="btn primary" onclick="app.ofeSaveClosing()" style="flex:1;">
                                <i class="fas fa-check"></i> Save Closing Activity
                            </button>
                            <button class="btn secondary" onclick="app.ofeClosClear()" style="padding:8px 14px;">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;

        resultEl.insertAdjacentHTML('beforeend', panelHtml);
    };

    const ofeClosSearch = (query) => {
        clearTimeout(_ofeClosTimer);
        const q = (query || '').trim();
        const resEl = document.getElementById('ofe-clos-results');
        if (!resEl) return;
        if (!q) { resEl.innerHTML = ''; return; }
        resEl.innerHTML = '<div style="padding:6px 10px;font-size:12px;color:var(--gray-400);"><i class="fas fa-spinner fa-spin"></i> Searching…</div>';
        _ofeClosTimer = setTimeout(() => _ofeRunClosSearch(q), 300);
    };

    const _ofeRunClosSearch = async (q) => {
        const resEl = document.getElementById('ofe-clos-results');
        if (!resEl) return;
        try {
            const sb = window.supabase || window.supabaseClient;
            if (!sb) throw new Error('offline');
            const { data, error } = await sb
                .from('prospects')
                .select('id, full_name, phone, ic_number, status')
                .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,ic_number.ilike.%${q}%`)
                .limit(8);
            if (error) throw error;
            const rows = data || [];
            if (!rows.length) {
                resEl.innerHTML = '<div style="padding:8px 10px;font-size:12px;color:var(--gray-400);">No prospects found.</div>';
                return;
            }
            resEl.innerHTML = rows.map(r => {
                const entityType = (r.status === 'customer' || r.status === 'Customer') ? 'customer' : 'prospect';
                const badge = entityType === 'customer'
                    ? `<span style="font-size:10px;padding:1px 6px;border-radius:10px;background:#dbeafe;color:#1d4ed8;">Customer</span>`
                    : `<span style="font-size:10px;padding:1px 6px;border-radius:10px;background:#dcfce7;color:#15803d;">Prospect</span>`;
                return `<div onclick="app.ofeClosSelect('${esc(String(r.id))}',${JSON.stringify(r.full_name || '')},'${entityType}')"
                    style="padding:9px 12px;cursor:pointer;border:1px solid var(--border,#e2e8f0);border-radius:8px;margin-bottom:5px;background:var(--surface,#fff);display:flex;align-items:center;gap:8px;"
                    onmouseover="this.style.background='var(--gray-50,#f8fafc)'" onmouseout="this.style.background='var(--surface,#fff)'">
                    <i class="fas fa-user-circle" style="color:var(--gray-300);font-size:18px;"></i>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:13px;font-weight:500;color:var(--gray-900);">${esc(r.full_name)}</div>
                        <div style="font-size:11px;color:var(--gray-500);">${esc(r.phone || r.ic_number || '—')}</div>
                    </div>
                    ${badge}
                </div>`;
            }).join('');
        } catch (err) {
            if (resEl) resEl.innerHTML = `<div style="padding:8px 10px;font-size:12px;color:#b71c1c;">Error: ${esc(err.message || String(err))}</div>`;
        }
    };

    const ofeClosSelect = (id, name, entityType) => {
        _ofeLinkedProspect = { id, name, entityType };
        const step1 = document.getElementById('ofe-clos-step1');
        const step2 = document.getElementById('ofe-clos-step2');
        const badge = document.getElementById('ofe-clos-badge');
        if (step1) step1.style.display = 'none';
        if (step2) step2.style.display = '';
        if (badge) badge.innerHTML = `
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px;">
                <i class="fas fa-user-check" style="color:#15803d;font-size:16px;"></i>
                <div>
                    <div style="font-size:13px;font-weight:600;color:#166534;">${esc(name)}</div>
                    <div style="font-size:11px;color:#4ade80;text-transform:capitalize;">${esc(entityType)}</div>
                </div>
            </div>`;
    };

    const ofeClosClear = () => {
        _ofeLinkedProspect = null;
        const step1 = document.getElementById('ofe-clos-step1');
        const step2 = document.getElementById('ofe-clos-step2');
        const srch  = document.getElementById('ofe-clos-search');
        const res   = document.getElementById('ofe-clos-results');
        if (step1) step1.style.display = '';
        if (step2) step2.style.display = 'none';
        if (srch)  srch.value = '';
        if (res)   res.innerHTML = '';
    };

    const ofeSaveClosing = async () => {
        if (!_ofeLinkedProspect) { UI.toast.error('Please select a prospect first.'); return; }
        if (!_ofeResult) { UI.toast.error('No scan result to save.'); return; }

        const fields  = _ofeResult.fields || {};
        const actType = document.querySelector('input[name="ofe-clos-type"]:checked')?.value || 'FTF';
        const today   = new Date().toISOString().split('T')[0];

        const product  = fields.product_name || null;
        const amount   = _ofeCleanNum(fields.amount_total_due || fields.amount_unit_price);
        const payment  = _ofeMapPayment(fields.payment_type, fields.payment_method);
        const prn      = fields.prn_number || null;
        const colDate  = fields.order_date || null;

        const activity = {
            activity_type:    actType,
            activity_date:    today,
            activity_title:   `Closing — ${product || 'Order Form'}`,
            is_closing:       true,
            solution_sold:    product,
            amount_closed:    amount,
            payment_method:   payment,
            invoice_number:   prn,
            collection_date:  colDate,
        };

        if (payment === 'POP') {
            const popAmt  = _ofeCleanNum(fields.installment_monthly);
            const popTen  = fields.installment_tenure_months || null;
            const popDown = _ofeCleanNum(fields.amount_down_payment);
            if (popAmt)  activity.pop_monthly_amount = popAmt;
            if (popTen)  activity.pop_tenure         = popTen;
            if (popDown) activity.pop_down_payment   = popDown;
        }

        if (_ofeLinkedProspect.entityType === 'customer') {
            activity.customer_id = _ofeLinkedProspect.id;
        } else {
            activity.prospect_id = _ofeLinkedProspect.id;
        }

        const saveBtn = document.querySelector('#ofe-closing-panel .btn.primary');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; }

        try {
            await window.AppDataStore.create('activities', activity);
            UI.toast.success(`✓ Closing activity created for ${_ofeLinkedProspect.name}`);
            const panel = document.getElementById('ofe-closing-panel');
            if (panel) panel.innerHTML = `
                <div style="padding:18px 20px;display:flex;align-items:center;gap:12px;background:#f0fdf4;border-radius:12px;">
                    <i class="fas fa-check-circle" style="color:#22c55e;font-size:22px;"></i>
                    <div>
                        <div style="font-weight:600;color:#166534;font-size:14px;">Closing activity saved!</div>
                        <div style="font-size:12px;color:#4ade80;margin-top:2px;">Linked to <strong>${esc(_ofeLinkedProspect.name)}</strong> · ${esc(actType)} · ${product ? esc(product) : 'no product'}</div>
                    </div>
                </div>`;
            _ofeLinkedProspect = null;
        } catch (err) {
            UI.toast.error('Failed to save: ' + (err.message || String(err)));
            if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-check"></i> Save Closing Activity'; }
        }
    };

    // ══════════════════════════════════════════════════════════════════════
    // Option A — Scan tab handlers (unchanged)
    // ══════════════════════════════════════════════════════════════════════
    const ofeHandleFile = async (input) => {
        const file = input?.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            UI.toast.error('Please select an image file (JPG or PNG).');
            if (input) input.value = '';
            return;
        }
        if (file.size > 8 * 1024 * 1024) {
            UI.toast.error('Image too large. Please use a photo under 8 MB.');
            if (input) input.value = '';
            return;
        }

        _ofeResult = null;
        clearTimeout(_ofeClosTimer);   // cancel any stale prospect search from last scan
        if (input) input.value = '';

        const statusEl = document.getElementById('ofe-status');
        const resultEl = document.getElementById('ofe-result');
        if (resultEl) resultEl.innerHTML = '';

        const setStatus = (bg, fg, html) => {
            if (!statusEl) return;
            statusEl.innerHTML = `<div style="padding:10px 14px;background:${bg};color:${fg};border-radius:8px;font-size:13px;display:flex;align-items:center;gap:8px;">${html}</div>`;
        };

        const previewUrl = URL.createObjectURL(file);

        try {
            const sb = window.supabase || window.supabaseClient;
            if (!sb?.functions) throw new Error('Supabase not available (offline mode?)');

            const formTypeHint = document.getElementById('ofe-form-type')?.value || 'auto';

            setStatus('#fef3c7', '#92400e', '<i class="fas fa-spinner fa-spin"></i> Reading order form with AI… (3–6 s)');

            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('Could not read file'));
                reader.readAsDataURL(file);
            });
            const [meta, b64] = String(dataUrl).split(',');
            const mime = (meta.match(/data:(.*?);base64/) || [])[1] || file.type || 'image/jpeg';

            const { data: res, error } = await sb.functions.invoke('order-form-ocr', {
                body: { image_base64: b64, mime_type: mime, form_type: formTypeHint },
            });
            if (error) throw new Error(error.message || 'Edge function call failed');
            if (!res || res.ok === false) throw new Error(res?.detail || res?.error || 'OCR failed');

            _ofeResult = res;
            if (statusEl) statusEl.innerHTML = '';
            _ofeRenderScanResult(res, previewUrl);
            _ofeRenderClosingPanel(res.fields || {}, res.confidence || {});
            setTimeout(() => URL.revokeObjectURL(previewUrl), 90000);

        } catch (err) {
            URL.revokeObjectURL(previewUrl);
            setStatus('#ffebee', '#b71c1c', `<i class="fas fa-exclamation-triangle"></i> ${esc(err.message || 'Scan failed')}`);
        }
    };

    const _ofeRenderScanResult = (res, previewUrl) => {
        const resultEl = document.getElementById('ofe-result');
        if (!resultEl) return;

        const fields     = res.fields     || {};
        const confidence = res.confidence || {};
        const detectedType  = res.form_type || fields.form_type || 'unknown';
        const formTypeLabel = {
            A: 'A — PRN Modern (Installment)',
            B: 'B — PRN Receipt (Direct)',
            C: 'C — Old Paper Form',
            unknown: 'Unknown',
        }[detectedType] || esc(detectedType);

        const confValues = Object.values(confidence)
            .map(c => c === 'high' ? 1 : c === 'medium' ? 0.6 : c === 'low' ? 0.3 : null)
            .filter(v => v !== null);
        const meanConf = confValues.length
            ? Math.round(confValues.reduce((a, b) => a + b, 0) / confValues.length * 100)
            : null;
        const confGaugeColor = meanConf >= 80 ? '#10b981' : meanConf >= 50 ? '#f59e0b' : '#ef4444';

        const groupsHtml = FIELD_GROUPS.map(({ title, icon, fields: fList }) => {
            const rows = fList.map(([key, label]) => {
                const val = fields[key];
                if (val == null || String(val).trim() === '') return '';
                const conf = confidence[key];
                return `<tr style="border-bottom:1px solid var(--gray-100,#f1f5f9);">
                    <td style="padding:7px 12px;color:var(--gray-500);font-size:12px;white-space:nowrap;width:42%;vertical-align:top;">${esc(label)}</td>
                    <td style="padding:7px 12px;color:var(--gray-900);font-size:13px;font-weight:500;word-break:break-word;">${esc(String(val))} ${_confBadge(conf)}</td>
                </tr>`;
            }).join('');
            if (!rows) return '';
            return `
                <div style="background:var(--surface,#fff);border:1px solid var(--border,#e2e8f0);border-radius:10px;margin-bottom:12px;overflow:hidden;">
                    <div style="padding:9px 14px;background:var(--gray-50,#f8fafc);border-bottom:1px solid var(--border,#e2e8f0);font-weight:600;font-size:12px;color:var(--gray-600);display:flex;align-items:center;gap:7px;text-transform:uppercase;letter-spacing:.4px;">
                        <i class="fas ${esc(icon)}" style="color:var(--primary,#6366f1);font-size:11px;"></i>${esc(title)}
                    </div>
                    <table style="width:100%;border-collapse:collapse;">${rows}</table>
                </div>`;
        }).join('');

        resultEl.innerHTML = `
            <div style="display:grid;grid-template-columns:260px 1fr;gap:20px;align-items:start;">
                <div>
                    <img src="${esc(previewUrl)}" loading="lazy"
                         style="width:100%;border-radius:10px;border:1px solid var(--border,#e2e8f0);margin-bottom:12px;cursor:zoom-in;"
                         onclick="window._openAttachment && window._openAttachment('${esc(previewUrl)}')">
                    <div style="background:var(--surface,#fff);border:1px solid var(--border,#e2e8f0);border-radius:10px;padding:14px 16px;font-size:13px;">
                        <div style="font-size:10px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Template Detected</div>
                        <div style="font-weight:600;color:var(--gray-900);margin-bottom:12px;">${formTypeLabel} ${_confBadge(confidence.form_type)}</div>
                        ${meanConf !== null ? `
                        <div style="font-size:10px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Avg Confidence</div>
                        <div style="font-weight:700;font-size:22px;color:${confGaugeColor};line-height:1;">${meanConf}%</div>` : ''}
                    </div>
                </div>
                <div>
                    ${groupsHtml || '<div style="color:var(--gray-500);padding:24px;text-align:center;border:1px dashed var(--border,#e2e8f0);border-radius:10px;">No fields could be extracted — try a clearer photo or select the template manually.</div>'}
                </div>
            </div>
        `;
    };

    Object.assign(window.app, {
        showOrderFormExtractView,
        ofeShowTab,
        ofeHandleFile,
        ofeHistToggleRow,
        ofeHistSearch,
        ofeHistPage,
        ofeRefreshHistory,
        // Option C
        ofeClosSearch,
        ofeClosSelect,
        ofeClosClear,
        ofeSaveClosing,
    });
})();
