/**
 * CRM Lazy Chunk: npo
 *
 * NPO (installment-package deal type) — Phase 1: admin plan configuration UI.
 *
 * NPO is a configurable installment PACKAGE deal type. An admin pre-sets
 * named/versioned plans ("NPO 1.0"); each plan has fixed TIERS (e.g. 45K/55K/65K
 * with a first payment + monthly × tenure) and a whitelist of eligible products
 * drawn from the existing `products` catalog. The SALE flow (drilling into a plan,
 * picking a tier, building a cart, tracking installments) is Phase 2 — this chunk
 * renders an empty "NPO Orders" shell for it and stops there.
 *
 * Self-contained IIFE — accesses shared state through window.* globals only.
 * Loaded on-demand by the navigateTo() chunk loader in script.js. Attaches its
 * public surface to window.app via app.register at the bottom.
 *
 * Tables managed (see migrations/npo_feature_2026-06-24.sql — NOT applied yet):
 *   • npo_plans(id, name, description, is_active, created_at, created_by)
 *   • npo_plan_tiers(id, plan_id, tier_amount, first_payment, monthly_amount,
 *                    tenure_months, sort_order, note)
 *   • npo_plan_products(id, plan_id, product_id, default_redeem_after_months)
 *
 * WRITE PATH: every id column is GENERATED ALWAYS, so AppDataStore.create (which
 * stamps a client-side id) would be rejected by Postgres. All inserts go through
 * the RAW supabase client WITHOUT an id, mirroring _evGenerateForName in
 * chunks/script-prospects.js. Reads use AppDataStore.query / getAll.
 *
 * AUTHZ: the NPO nav is visible to the sales band (L1–L12, owner-tunable in the
 * VIEWS registry in script.js). CONFIG writes (create/edit/delete plans, tiers,
 * products, active toggle) are gated to admin (level <= 2) via _canConfig().
 */
(() => {
    // ── Live bindings to shared globals ──────────────────────────────────
    const _state   = window._appState;
    const _utils   = window._crmUtils;
    const escapeHtml = (...a) => _utils.escapeHtml(...a);
    // Admin gate for all config writes. level<=2 = Super Admin / Marketing Manager.
    const _canConfig = () => {
        try { return _utils.getUserLevel(_state.cu) <= 2; } catch (_) { return false; }
    };
    // Raw supabase client — REQUIRED for inserts because npo_* id columns are
    // GENERATED ALWAYS (AppDataStore.create stamps an id Postgres would reject).
    const _sb = () => window.supabase || window.supabaseClient || null;
    // The element the view dispatch renders into (navigateTo passes this as the
    // container arg; we re-resolve it for in-place re-renders after a write).
    const _viewport = () => document.getElementById('content-viewport');

    // ── number helpers ───────────────────────────────────────────────────
    const _money = (n) => {
        const v = parseFloat(n);
        return isNaN(v) ? '—' : 'RM ' + v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    const _num = (id) => {
        const el = document.getElementById(id);
        const v = parseFloat(el && el.value);
        return isNaN(v) ? null : v;
    };
    const _str = (id) => {
        const el = document.getElementById(id);
        return (el && el.value || '').trim();
    };

    // ====================================================================
    // DATA ACCESS
    // ====================================================================
    const _loadPlans = async () => {
        try { return (await AppDataStore.getAll('npo_plans')) || []; }
        catch (_) { return []; }
    };
    const _loadTiers = async (planId) => {
        try { return (await AppDataStore.query('npo_plan_tiers', { plan_id: planId })) || []; }
        catch (_) { return []; }
    };
    const _loadPlanProducts = async (planId) => {
        try { return (await AppDataStore.query('npo_plan_products', { plan_id: planId })) || []; }
        catch (_) { return []; }
    };

    // ====================================================================
    // VIEW (admin config + Phase-2 orders shell)
    // ====================================================================
    const showNpoView = async (container) => {
        _state.cv = 'npo';
        const canConfig = _canConfig();
        const plans = await _loadPlans();
        plans.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        const planRows = plans.length ? plans.map(p => _renderPlanRow(p, canConfig)).join('') : `
            <tr><td colspan="${canConfig ? 4 : 3}" style="padding:18px;text-align:center;color:var(--gray-500);">No NPO plans yet.${canConfig ? ' Create one to get started.' : ''}</td></tr>`;

        container.innerHTML = `
            <div style="padding:24px;max-width:1000px;margin:0 auto;">
                <div style="margin-bottom:18px;">
                    <h1 style="margin:0;display:flex;align-items:center;gap:10px;"><i class="fas fa-file-invoice-dollar" style="color:#0e7490;"></i> NPO</h1>
                    <div style="color:var(--gray-500);font-size:13px;margin-top:4px;">Installment-package deal type${canConfig ? ' • configure plans, tiers &amp; eligible products' : ' • view-only'}</div>
                </div>

                <!-- ── Admin: NPO Plans ─────────────────────────────────── -->
                <div style="background:white;border:1px solid var(--gray-200);border-radius:12px;padding:20px;margin-bottom:18px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                        <h3 style="margin:0;">NPO Plans</h3>
                        ${canConfig ? `<button class="btn" onclick="app.npoOpenPlanModal()" style="background:#0e7490;border:none;color:white;padding:8px 16px;border-radius:8px;font-weight:600;cursor:pointer;"><i class="fas fa-plus"></i> New Plan</button>` : ''}
                    </div>
                    <table style="width:100%;border-collapse:collapse;font-size:13px;">
                        <thead>
                            <tr style="text-align:left;color:var(--gray-500);border-bottom:1px solid var(--gray-200);">
                                <th style="padding:8px;">Plan</th>
                                <th style="padding:8px;">Description</th>
                                <th style="padding:8px;">Active</th>
                                ${canConfig ? '<th style="padding:8px;text-align:right;">Actions</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>${planRows}</tbody>
                    </table>
                </div>

                <!-- ── NPO Orders ───────────────────────────────────────── -->
                <div style="background:white;border:1px solid var(--gray-200);border-radius:12px;padding:20px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                        <h3 style="margin:0;">NPO Orders</h3>
                        <button class="btn" onclick="app.npoOpenOrderModal()" style="background:#0e7490;border:none;color:white;padding:8px 16px;border-radius:8px;font-weight:600;cursor:pointer;"><i class="fas fa-plus"></i> New Order</button>
                    </div>
                    <div id="npo-orders-list">${await _renderOrdersList()}</div>
                </div>
            </div>`;
    };

    // ── Orders list (scoped) ─────────────────────────────────────────────
    // Management / admin (getVisibleUserIds === 'all') see every sale; an agent
    // sees only the sales whose responsible_agent_id is in their visible set.
    // Fail CLOSED: if scope resolution throws or yields nothing, show none.
    const _renderOrdersList = async () => {
        let sales = [];
        try {
            const user = _state.cu;
            const visible = await _utils.getVisibleUserIds(user); // 'all' | [ids]
            const all = (await AppDataStore.getAll('npo_sales')) || [];
            if (visible === 'all') {
                sales = all;
            } else if (Array.isArray(visible) && visible.length) {
                const set = new Set(visible.map(String));
                sales = all.filter(s => set.has(String(s.responsible_agent_id)));
            } else {
                sales = []; // fail closed
            }
        } catch (_) {
            return `<div style="padding:24px;text-align:center;color:#dc2626;">Could not load orders.</div>`;
        }
        if (!sales.length) {
            return `<div style="padding:24px;text-align:center;color:var(--gray-500);">No NPO orders yet.</div>`;
        }
        sales.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

        // Resolve display labels in batch (customer names, plan names, installment progress).
        const [customers, plans, allInst] = await Promise.all([
            (async () => { try { return (await AppDataStore.getAll('customers')) || []; } catch (_) { return []; } })(),
            _loadPlans(),
            (async () => { try { return (await AppDataStore.getAll('npo_installments')) || []; } catch (_) { return []; } })()
        ]);
        const custMap = new Map(customers.map(c => [String(c.id), c.full_name || c.nickname || '']));
        const planMap = new Map(plans.map(p => [String(p.id), p.name || '']));
        const paidBySale = new Map();
        allInst.forEach(i => {
            const k = String(i.sale_id);
            const cur = paidBySale.get(k) || 0;
            paidBySale.set(k, cur + (i.status === 'paid' ? 1 : 0));
        });

        const rows = sales.map(s => {
            const custName = s.customer_id != null
                ? (custMap.get(String(s.customer_id)) || ('Customer #' + s.customer_id))
                : (s.customer_name || '(new customer)');
            const planName = s.plan_id != null ? (planMap.get(String(s.plan_id)) || '—') : '—';
            const paid = paidBySale.get(String(s.id)) || 0;
            const tenure = s.tenure_months || 0;
            return `
                <tr style="cursor:pointer;" onclick="app.npoOpenOrder(${s.id})">
                    <td style="padding:8px;border-bottom:1px solid var(--gray-100);"><strong>${escapeHtml(custName)}</strong></td>
                    <td style="padding:8px;border-bottom:1px solid var(--gray-100);color:var(--gray-600);">${escapeHtml(planName)}</td>
                    <td style="padding:8px;border-bottom:1px solid var(--gray-100);">${_money(s.tier_amount)}</td>
                    <td style="padding:8px;border-bottom:1px solid var(--gray-100);">${_money(s.cart_total)}</td>
                    <td style="padding:8px;border-bottom:1px solid var(--gray-100);">${_statusBadge(s.status)}</td>
                    <td style="padding:8px;border-bottom:1px solid var(--gray-100);">${paid} / ${tenure}</td>
                </tr>`;
        }).join('');

        return `
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead>
                    <tr style="text-align:left;color:var(--gray-500);border-bottom:1px solid var(--gray-200);">
                        <th style="padding:8px;">Customer</th>
                        <th style="padding:8px;">Plan</th>
                        <th style="padding:8px;">Tier</th>
                        <th style="padding:8px;">Cart Total</th>
                        <th style="padding:8px;">Status</th>
                        <th style="padding:8px;">Installments</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>`;
    };

    const _statusBadge = (status) => {
        const map = {
            active:    ['#dbeafe', '#1e40af', 'Active'],
            completed: ['#dcfce7', '#166534', 'Completed'],
            lapsed:    ['#fef3c7', '#92400e', 'Lapsed'],
            cancelled: ['var(--gray-200)', 'var(--gray-600)', 'Cancelled'],
        };
        const [bg, fg, label] = map[status] || ['var(--gray-200)', 'var(--gray-600)', status || '—'];
        return `<span class="badge" style="background:${bg};color:${fg};padding:2px 8px;border-radius:10px;font-size:11px;">${escapeHtml(label)}</span>`;
    };

    const _renderPlanRow = (p, canConfig) => {
        const active = p.is_active !== false;
        const badge = active
            ? '<span class="badge" style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:10px;font-size:11px;">Active</span>'
            : '<span class="badge" style="background:var(--gray-200);color:var(--gray-600);padding:2px 8px;border-radius:10px;font-size:11px;">Inactive</span>';
        const actions = canConfig ? `
            <td style="padding:8px;text-align:right;white-space:nowrap;">
                <button class="btn-icon" title="Configure tiers & products" onclick="event.stopPropagation();app.npoManagePlan(${p.id})" style="background:none;border:none;cursor:pointer;color:#0e7490;margin-right:6px;"><i class="fas fa-sliders-h"></i></button>
                <button class="btn-icon" title="Edit plan" onclick="event.stopPropagation();app.npoOpenPlanModal(${p.id})" style="background:none;border:none;cursor:pointer;color:var(--gray-600);margin-right:6px;"><i class="fas fa-pen"></i></button>
                <button class="btn-icon" title="${active ? 'Deactivate' : 'Activate'}" onclick="event.stopPropagation();app.npoTogglePlanActive(${p.id})" style="background:none;border:none;cursor:pointer;color:var(--gray-600);margin-right:6px;"><i class="fas fa-power-off"></i></button>
                <button class="btn-icon" title="Delete plan" onclick="event.stopPropagation();app.npoDeletePlan(${p.id})" style="background:none;border:none;cursor:pointer;color:#dc2626;"><i class="fas fa-trash"></i></button>
            </td>` : '';
        const rowClick = canConfig ? ` style="cursor:pointer;" onclick="app.npoManagePlan(${p.id})"` : '';
        return `
            <tr${rowClick}>
                <td style="padding:8px;border-bottom:1px solid var(--gray-100);"><strong>${escapeHtml(p.name || '')}</strong></td>
                <td style="padding:8px;border-bottom:1px solid var(--gray-100);color:var(--gray-600);">${escapeHtml(p.description || '—')}</td>
                <td style="padding:8px;border-bottom:1px solid var(--gray-100);">${badge}</td>
                ${actions}
            </tr>`;
    };

    // ====================================================================
    // PLAN CRUD
    // ====================================================================
    const npoOpenPlanModal = async (id = null) => {
        if (!_canConfig()) { UI.toast.error('Admin only'); return; }
        let plan = { name: '', description: '', is_active: true, customer_eligibility: 'both' };
        if (id != null) {
            try { plan = (await AppDataStore.getById('npo_plans', id)) || plan; } catch (_) {}
        }
        const elig = ['existing', 'new', 'both'].includes(plan.customer_eligibility) ? plan.customer_eligibility : 'both';
        const eligOpt = (v, label) => `<option value="${v}"${elig === v ? ' selected' : ''}>${label}</option>`;
        const content = `
            <div class="form-group">
                <label>Plan Name <span class="required">*</span></label>
                <input type="text" id="npo-plan-name" class="form-control" value="${escapeHtml(plan.name || '')}" placeholder="e.g., NPO 1.0">
            </div>
            <div class="form-group">
                <label>Description</label>
                <textarea id="npo-plan-desc" class="form-control" rows="2" placeholder="Optional notes about this plan">${escapeHtml(plan.description || '')}</textarea>
            </div>
            <div class="form-group">
                <label>Customer Eligibility</label>
                <select id="npo-plan-eligibility" class="form-control">
                    ${eligOpt('existing', 'Existing customers only')}
                    ${eligOpt('new', 'New customers only')}
                    ${eligOpt('both', 'Both')}
                </select>
                <div style="font-size:12px;color:var(--gray-500);margin-top:4px;">Who this plan can be sold to in the order wizard.</div>
            </div>
            <div class="form-group">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                    <input type="checkbox" id="npo-plan-active" ${plan.is_active !== false ? 'checked' : ''}> Active
                </label>
            </div>`;
        UI.showModal(id != null ? 'Edit NPO Plan' : 'New NPO Plan', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save', type: 'primary', action: `(async () => { await app.npoSavePlan(${id != null ? id : 'null'}); })()` }
        ]);
    };

    const npoSavePlan = async (id = null) => {
        if (!_canConfig()) { UI.toast.error('Admin only'); return; }
        const sb = _sb();
        if (!sb) { UI.toast.error('Supabase not connected'); return; }
        const name = _str('npo-plan-name');
        if (!name) { UI.toast.error('Plan name is required'); return; }
        const description = _str('npo-plan-desc') || null;
        const is_active = !!(document.getElementById('npo-plan-active') || {}).checked;
        const eligRaw = (document.getElementById('npo-plan-eligibility') || {}).value;
        const customer_eligibility = ['existing', 'new', 'both'].includes(eligRaw) ? eligRaw : 'both';
        try {
            if (id != null) {
                const { error } = await sb.from('npo_plans').update({ name, description, is_active, customer_eligibility }).eq('id', id);
                if (error) throw error;
            } else {
                // RAW insert WITHOUT id (GENERATED ALWAYS). Mirror _evGenerateForName.
                const { error } = await sb.from('npo_plans').insert({
                    name, description, is_active, customer_eligibility,
                    created_by: (_state.cu && _state.cu.id) || null
                }).select().single();
                if (error) throw error;
            }
            try { AppDataStore.invalidateCache && AppDataStore.invalidateCache('npo_plans'); } catch (_) {}
            UI.hideModal();
            UI.toast.success(id != null ? 'Plan updated' : 'Plan created');
            await _refresh();
        } catch (e) {
            UI.toast.error('Save failed: ' + (e && e.message ? e.message : 'unknown error'));
        }
    };

    const npoTogglePlanActive = async (id) => {
        if (!_canConfig()) { UI.toast.error('Admin only'); return; }
        const sb = _sb();
        if (!sb) { UI.toast.error('Supabase not connected'); return; }
        try {
            const plan = await AppDataStore.getById('npo_plans', id);
            if (!plan) { UI.toast.error('Plan not found'); return; }
            const next = !(plan.is_active !== false);
            const { error } = await sb.from('npo_plans').update({ is_active: next }).eq('id', id);
            if (error) throw error;
            try { AppDataStore.invalidateCache && AppDataStore.invalidateCache('npo_plans'); } catch (_) {}
            UI.toast.success(next ? 'Plan activated' : 'Plan deactivated');
            await _refresh();
        } catch (e) {
            UI.toast.error('Update failed: ' + (e && e.message ? e.message : 'unknown error'));
        }
    };

    const npoDeletePlan = async (id) => {
        if (!_canConfig()) { UI.toast.error('Admin only'); return; }
        const sb = _sb();
        if (!sb) { UI.toast.error('Supabase not connected'); return; }
        const plan = await AppDataStore.getById('npo_plans', id);
        UI.confirm('Delete NPO Plan', `Delete NPO plan "${(plan && plan.name) || ''}"? Its tiers and product whitelist will also be removed.`, async () => {
            try {
                // tiers/products cascade in the DB (ON DELETE CASCADE), but clean them
                // here too so local caches don't keep orphans if the FK isn't enforced.
                await sb.from('npo_plan_tiers').delete().eq('plan_id', id);
                await sb.from('npo_plan_products').delete().eq('plan_id', id);
                const { error } = await sb.from('npo_plans').delete().eq('id', id);
                if (error) throw error;
                ['npo_plans', 'npo_plan_tiers', 'npo_plan_products'].forEach(t => {
                    try { AppDataStore.invalidateCache && AppDataStore.invalidateCache(t); } catch (_) {}
                });
                UI.toast.success('Plan deleted');
                await _refresh();
            } catch (e) {
                UI.toast.error('Delete failed: ' + (e && e.message ? e.message : 'unknown error'));
            }
        });
    };

    // ====================================================================
    // PLAN DETAIL — TIERS + ELIGIBLE PRODUCTS
    // ====================================================================
    const npoManagePlan = async (planId) => {
        if (!_canConfig()) { UI.toast.error('Admin only'); return; }
        const container = _viewport();
        if (!container) return;
        const plan = await AppDataStore.getById('npo_plans', planId);
        if (!plan) { UI.toast.error('Plan not found'); return; }
        const [tiers, planProducts, allProducts] = await Promise.all([
            _loadTiers(planId),
            _loadPlanProducts(planId),
            (async () => { try { return (await AppDataStore.getAll('products')) || []; } catch (_) { return []; } })()
        ]);
        tiers.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.tier_amount || 0) - (b.tier_amount || 0));
        const productMap = new Map(allProducts.map(p => [p.id, p.name]));

        const tierRows = tiers.length ? tiers.map(t => `
            <tr>
                <td style="padding:8px;border-bottom:1px solid var(--gray-100);">${_money(t.tier_amount)}</td>
                <td style="padding:8px;border-bottom:1px solid var(--gray-100);">${_money(t.first_payment)}</td>
                <td style="padding:8px;border-bottom:1px solid var(--gray-100);">${_money(t.monthly_amount)}</td>
                <td style="padding:8px;border-bottom:1px solid var(--gray-100);">${t.tenure_months != null ? escapeHtml(String(t.tenure_months)) + ' mo' : '—'}</td>
                <td style="padding:8px;border-bottom:1px solid var(--gray-100);color:var(--gray-600);">${escapeHtml(t.note || '—')}</td>
                <td style="padding:8px;border-bottom:1px solid var(--gray-100);text-align:right;white-space:nowrap;">
                    <button class="btn-icon" title="Edit tier" onclick="app.npoOpenTierModal(${planId},${t.id})" style="background:none;border:none;cursor:pointer;color:var(--gray-600);margin-right:6px;"><i class="fas fa-pen"></i></button>
                    <button class="btn-icon" title="Remove tier" onclick="app.npoDeleteTier(${planId},${t.id})" style="background:none;border:none;cursor:pointer;color:#dc2626;"><i class="fas fa-trash"></i></button>
                </td>
            </tr>`).join('') : `<tr><td colspan="6" style="padding:14px;text-align:center;color:var(--gray-500);">No tiers yet.</td></tr>`;

        const eligibleProductsHtml = allProducts.length ? allProducts.map(p => {
            const link = planProducts.find(pp => pp.product_id === p.id);
            const checked = !!link;
            return `
                <div style="display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid var(--gray-100);">
                    <label style="flex:1;display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
                        <input type="checkbox" name="npo-elig-product" value="${p.id}" ${checked ? 'checked' : ''}>
                        ${escapeHtml(p.name || ('Product #' + p.id))}
                    </label>
                    <input type="number" min="0" placeholder="redeem after (mo)" title="Default redeem-after-months for this product (optional)"
                        id="npo-redeem-${p.id}" value="${link && link.default_redeem_after_months != null ? link.default_redeem_after_months : ''}"
                        style="width:150px;padding:4px 6px;border:1px solid var(--gray-300);border-radius:4px;font-size:12px;">
                </div>`;
        }).join('') : '<p style="color:var(--gray-500);font-size:13px;">No products in the catalog.</p>';

        container.innerHTML = `
            <div style="padding:24px;max-width:1000px;margin:0 auto;">
                <button class="btn" onclick="app.navigateTo('npo')" style="background:none;border:none;color:#0e7490;cursor:pointer;padding:0;margin-bottom:14px;font-size:13px;"><i class="fas fa-arrow-left"></i> Back to NPO Plans</button>
                <div style="margin-bottom:18px;">
                    <h1 style="margin:0;">${escapeHtml(plan.name || '')}</h1>
                    <div style="color:var(--gray-500);font-size:13px;margin-top:4px;">${escapeHtml(plan.description || '')}</div>
                </div>

                <!-- ── Tiers ─────────────────────────────────────────────── -->
                <div style="background:white;border:1px solid var(--gray-200);border-radius:12px;padding:20px;margin-bottom:18px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                        <h3 style="margin:0;">Tiers</h3>
                        <button class="btn" onclick="app.npoOpenTierModal(${planId})" style="background:#0e7490;border:none;color:white;padding:8px 16px;border-radius:8px;font-weight:600;cursor:pointer;"><i class="fas fa-plus"></i> Add Tier</button>
                    </div>
                    <table style="width:100%;border-collapse:collapse;font-size:13px;">
                        <thead>
                            <tr style="text-align:left;color:var(--gray-500);border-bottom:1px solid var(--gray-200);">
                                <th style="padding:8px;">Tier Amount</th>
                                <th style="padding:8px;">First Payment</th>
                                <th style="padding:8px;">Monthly</th>
                                <th style="padding:8px;">Tenure</th>
                                <th style="padding:8px;">Note</th>
                                <th style="padding:8px;text-align:right;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>${tierRows}</tbody>
                    </table>
                </div>

                <!-- ── Eligible Products ─────────────────────────────────── -->
                <div style="background:white;border:1px solid var(--gray-200);border-radius:12px;padding:20px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                        <h3 style="margin:0;">Eligible Products</h3>
                        <button class="btn" onclick="app.npoSaveEligibleProducts(${planId})" style="background:#0e7490;border:none;color:white;padding:8px 16px;border-radius:8px;font-weight:600;cursor:pointer;"><i class="fas fa-save"></i> Save Products</button>
                    </div>
                    <p style="color:var(--gray-500);font-size:12px;margin:0 0 12px;">Tick the products eligible for this plan. The number is an optional default redeem-after-months captured per product.</p>
                    <div style="max-height:340px;overflow-y:auto;">${eligibleProductsHtml}</div>
                </div>
            </div>`;
    };

    const npoOpenTierModal = async (planId, tierId = null) => {
        if (!_canConfig()) { UI.toast.error('Admin only'); return; }
        let t = { tier_amount: '', first_payment: '', monthly_amount: '', tenure_months: '', sort_order: 0, note: '' };
        if (tierId != null) {
            try { t = (await AppDataStore.getById('npo_plan_tiers', tierId)) || t; } catch (_) {}
        }
        const content = `
            <div class="form-row" style="display:flex;gap:12px;">
                <div class="form-group" style="flex:1;">
                    <label>Tier Amount (RM) <span class="required">*</span></label>
                    <input type="number" id="npo-tier-amount" class="form-control" step="0.01" min="0" value="${t.tier_amount != null ? t.tier_amount : ''}" placeholder="45000">
                </div>
                <div class="form-group" style="flex:1;">
                    <label>First Payment (RM) <span class="required">*</span></label>
                    <input type="number" id="npo-tier-first" class="form-control" step="0.01" min="0" value="${t.first_payment != null ? t.first_payment : ''}" placeholder="9045">
                </div>
            </div>
            <div class="form-row" style="display:flex;gap:12px;">
                <div class="form-group" style="flex:1;">
                    <label>Monthly Amount (RM) <span class="required">*</span></label>
                    <input type="number" id="npo-tier-monthly" class="form-control" step="0.01" min="0" value="${t.monthly_amount != null ? t.monthly_amount : ''}" placeholder="799">
                </div>
                <div class="form-group" style="flex:1;">
                    <label>Tenure (months) <span class="required">*</span></label>
                    <input type="number" id="npo-tier-tenure" class="form-control" step="1" min="1" value="${t.tenure_months != null ? t.tenure_months : ''}" placeholder="45">
                </div>
            </div>
            <div class="form-row" style="display:flex;gap:12px;">
                <div class="form-group" style="flex:1;">
                    <label>Sort Order</label>
                    <input type="number" id="npo-tier-sort" class="form-control" step="1" value="${t.sort_order != null ? t.sort_order : 0}">
                </div>
                <div class="form-group" style="flex:2;">
                    <label>Note</label>
                    <input type="text" id="npo-tier-note" class="form-control" value="${escapeHtml(t.note || '')}" placeholder="Optional">
                </div>
            </div>`;
        UI.showModal(tierId != null ? 'Edit Tier' : 'Add Tier', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save', type: 'primary', action: `(async () => { await app.npoSaveTier(${planId}, ${tierId != null ? tierId : 'null'}); })()` }
        ]);
    };

    const npoSaveTier = async (planId, tierId = null) => {
        if (!_canConfig()) { UI.toast.error('Admin only'); return; }
        const sb = _sb();
        if (!sb) { UI.toast.error('Supabase not connected'); return; }
        const tier_amount = _num('npo-tier-amount');
        const first_payment = _num('npo-tier-first');
        const monthly_amount = _num('npo-tier-monthly');
        const tenure_months = _num('npo-tier-tenure');
        const sort_order = _num('npo-tier-sort') || 0;
        const note = _str('npo-tier-note') || null;
        if (tier_amount == null || tier_amount <= 0) { UI.toast.error('Tier amount must be greater than 0'); return; }
        if (first_payment == null || first_payment < 0) { UI.toast.error('First payment is required'); return; }
        if (monthly_amount == null || monthly_amount < 0) { UI.toast.error('Monthly amount is required'); return; }
        if (tenure_months == null || tenure_months <= 0) { UI.toast.error('Tenure (months) must be greater than 0'); return; }
        const payload = { tier_amount, first_payment, monthly_amount, tenure_months: Math.round(tenure_months), sort_order: Math.round(sort_order), note };
        try {
            if (tierId != null) {
                const { error } = await sb.from('npo_plan_tiers').update(payload).eq('id', tierId);
                if (error) throw error;
            } else {
                // RAW insert WITHOUT id (GENERATED ALWAYS).
                const { error } = await sb.from('npo_plan_tiers').insert({ plan_id: planId, ...payload }).select().single();
                if (error) throw error;
            }
            try { AppDataStore.invalidateCache && AppDataStore.invalidateCache('npo_plan_tiers'); } catch (_) {}
            UI.hideModal();
            UI.toast.success(tierId != null ? 'Tier updated' : 'Tier added');
            await npoManagePlan(planId);
        } catch (e) {
            UI.toast.error('Save failed: ' + (e && e.message ? e.message : 'unknown error'));
        }
    };

    const npoDeleteTier = async (planId, tierId) => {
        if (!_canConfig()) { UI.toast.error('Admin only'); return; }
        const sb = _sb();
        if (!sb) { UI.toast.error('Supabase not connected'); return; }
        UI.confirm('Remove Tier', 'Remove this tier?', async () => {
            try {
                const { error } = await sb.from('npo_plan_tiers').delete().eq('id', tierId);
                if (error) throw error;
                try { AppDataStore.invalidateCache && AppDataStore.invalidateCache('npo_plan_tiers'); } catch (_) {}
                UI.toast.success('Tier removed');
                await npoManagePlan(planId);
            } catch (e) {
                UI.toast.error('Delete failed: ' + (e && e.message ? e.message : 'unknown error'));
            }
        });
    };

    // Reconcile the checked products + per-product redeem-after months against
    // the existing npo_plan_products rows: insert newly ticked, delete unticked,
    // update changed redeem values. unique(plan_id, product_id) keeps it idempotent.
    const npoSaveEligibleProducts = async (planId) => {
        if (!_canConfig()) { UI.toast.error('Admin only'); return; }
        const sb = _sb();
        if (!sb) { UI.toast.error('Supabase not connected'); return; }
        const existing = await _loadPlanProducts(planId);
        const existingByProduct = new Map(existing.map(r => [r.product_id, r]));
        const checked = Array.from(document.querySelectorAll('input[name="npo-elig-product"]:checked'))
            .map(cb => parseInt(cb.value, 10))
            .filter(id => !isNaN(id));
        const checkedSet = new Set(checked);
        const redeemFor = (pid) => {
            const el = document.getElementById('npo-redeem-' + pid);
            const v = parseInt(el && el.value, 10);
            return isNaN(v) ? null : v;
        };
        try {
            // Split the currently-checked products into brand-new inserts vs.
            // existing links whose redeem value changed, so each class collapses
            // into as few round-trips as possible instead of one await per product.
            const insertRows = [];
            const updateRows = []; // { id, redeem }
            for (const pid of checked) {
                const redeem = redeemFor(pid);
                const row = existingByProduct.get(pid);
                if (!row) {
                    // RAW insert WITHOUT id (GENERATED ALWAYS).
                    insertRows.push({ plan_id: planId, product_id: pid, default_redeem_after_months: redeem });
                } else if ((row.default_redeem_after_months ?? null) !== redeem) {
                    updateRows.push({ id: row.id, redeem });
                }
            }
            // Deletes for previously-linked products that are now unchecked.
            const deleteIds = existing.filter(row => !checkedSet.has(row.product_id)).map(row => row.id);

            // One array insert for all new links (PostgREST accepts arrays).
            if (insertRows.length) {
                const { error } = await sb.from('npo_plan_products').insert(insertRows).select();
                if (error) throw error;
            }
            // Per-row updates (different id + value each) run in parallel, not serially.
            if (updateRows.length) {
                const results = await Promise.all(updateRows.map(u =>
                    sb.from('npo_plan_products').update({ default_redeem_after_months: u.redeem }).eq('id', u.id)));
                const bad = results.find(r => r && r.error);
                if (bad) throw bad.error;
            }
            // One batched delete for all unchecked links.
            if (deleteIds.length) {
                const { error } = await sb.from('npo_plan_products').delete().in('id', deleteIds);
                if (error) throw error;
            }
            try { AppDataStore.invalidateCache && AppDataStore.invalidateCache('npo_plan_products'); } catch (_) {}
            UI.toast.success('Eligible products saved');
            await npoManagePlan(planId);
        } catch (e) {
            UI.toast.error('Save failed: ' + (e && e.message ? e.message : 'unknown error'));
        }
    };

    // ====================================================================
    // PHASE 2 — NPO SALE FLOW (new order wizard)
    // ====================================================================
    // Ephemeral state for the order modal: the active plan's tiers + eligible
    // products (joined to the catalog) + the line items the agent is building.
    // Kept module-scoped (not in the DB) until SAVE assembles the final rows.
    let _order = null; // { plan, tiers, products:[{product_id,name,unit_price,default_redeem_after_months}], lines:Map<product_id,{qty,redeem}> , customer:{id,name} }

    const _date = (d) => {
        // YYYY-MM-DD in local time.
        const x = d instanceof Date ? d : new Date();
        const m = String(x.getMonth() + 1).padStart(2, '0');
        const day = String(x.getDate()).padStart(2, '0');
        return `${x.getFullYear()}-${m}-${day}`;
    };
    // Add `n` calendar months to an ISO date string, clamping day-of-month overflow
    // (e.g. Jan 31 + 1mo → Feb 28/29). Returns YYYY-MM-DD.
    const _addMonths = (iso, n) => {
        const base = iso ? new Date(iso + 'T00:00:00') : new Date();
        const d0 = base.getDate();
        const t = new Date(base.getFullYear(), base.getMonth() + n, 1);
        const lastDay = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
        t.setDate(Math.min(d0, lastDay));
        return _date(t);
    };

    // `presetCustomerId` (optional): when launched from the customer's Add-Purchase
    // modal, an existing customer is already known. We fetch it and preselect it the
    // same way npoPickCustomer does, so the agent skips the customer-search step.
    const npoOpenOrderModal = async (presetCustomerId) => {
        const sb = _sb();
        if (!sb) { UI.toast.error('Supabase not connected'); return; }
        const plans = (await _loadPlans()).filter(p => p.is_active !== false);
        if (!plans.length) { UI.toast.error('No active NPO plan — ask an admin to create one first'); return; }
        plans.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        _order = { plan: null, eligibility: 'both', tiers: [], products: [], lines: new Map(), customer: { id: null, name: '' } };

        // Resolve a preset existing customer (if any) before building the modal so
        // we can seed _order.customer and prefill the search field once it renders.
        let _presetCust = null;
        if (presetCustomerId != null && presetCustomerId !== '') {
            try { _presetCust = await AppDataStore.getById('customers', presetCustomerId); } catch (_) { _presetCust = null; }
            if (_presetCust) {
                _order.customer = { id: _presetCust.id, name: _presetCust.full_name || _presetCust.nickname || ('Customer #' + _presetCust.id) };
            }
        }

        const planOptions = plans.map(p => `<option value="${p.id}">${escapeHtml(p.name || '')}</option>`).join('');
        const content = `
            <div style="max-height:70vh;overflow-y:auto;">
                <!-- Customer -->
                <div class="form-group">
                    <label>Customer <span class="required">*</span></label>
                    <div id="npo-cust-existing-wrap">
                        <input type="text" id="npo-cust-search" class="form-control" placeholder="Search existing customer by name / phone / email…" oninput="app.npoSearchCustomers(this.value)" autocomplete="off">
                        <div id="npo-cust-results" style="border:1px solid var(--gray-200);border-radius:6px;margin-top:4px;max-height:160px;overflow-y:auto;display:none;"></div>
                        <div id="npo-cust-selected" style="margin-top:6px;font-size:13px;color:var(--gray-600);"></div>
                    </div>
                    <div id="npo-cust-new-wrap">
                        <div id="npo-cust-newname-hint" style="font-size:12px;color:var(--gray-500);margin-top:6px;">No match? Type a name below to create a lightweight record (no customer profile, name only).</div>
                        <input type="text" id="npo-cust-newname" class="form-control" placeholder="New customer name" style="margin-top:4px;" oninput="app.npoClearSelectedCustomer()">
                    </div>
                </div>

                <!-- Plan + Tier -->
                <div class="form-row" style="display:flex;gap:12px;">
                    <div class="form-group" style="flex:1;">
                        <label>Plan <span class="required">*</span></label>
                        <select id="npo-order-plan" class="form-control" onchange="app.npoOrderPlanChanged(this.value)">
                            <option value="">— Select plan —</option>
                            ${planOptions}
                        </select>
                    </div>
                    <div class="form-group" style="flex:1;">
                        <label>Tier <span class="required">*</span></label>
                        <select id="npo-order-tier" class="form-control" onchange="app.npoOrderTierChanged()" disabled>
                            <option value="">— Select plan first —</option>
                        </select>
                    </div>
                </div>
                <div id="npo-tier-terms" style="font-size:12px;color:var(--gray-600);margin:-4px 0 10px;"></div>

                <!-- Products -->
                <div class="form-group">
                    <label>Products (from this plan)</label>
                    <div id="npo-order-products" style="border:1px solid var(--gray-200);border-radius:8px;padding:10px;max-height:240px;overflow-y:auto;color:var(--gray-500);font-size:13px;">Select a plan to load its eligible products.</div>
                </div>

                <!-- Fulfillment + start -->
                <div class="form-row" style="display:flex;gap:12px;">
                    <div class="form-group" style="flex:1;">
                        <label>Fulfillment Mode</label>
                        <label style="display:flex;align-items:center;gap:6px;font-weight:normal;font-size:13px;">
                            <input type="radio" name="npo-fmode" value="all_within_period" checked onchange="app.npoOrderModeChanged()"> All within period
                        </label>
                        <label style="display:flex;align-items:center;gap:6px;font-weight:normal;font-size:13px;">
                            <input type="radio" name="npo-fmode" value="full_payment_first" onchange="app.npoOrderModeChanged()"> Full payment first
                        </label>
                    </div>
                    <div class="form-group" style="flex:1;" id="npo-redperiod-wrap">
                        <label>Redemption Period (months)</label>
                        <input type="number" id="npo-redperiod" class="form-control" min="1" step="1" value="12">
                    </div>
                    <div class="form-group" style="flex:1;">
                        <label>Start Date</label>
                        <input type="date" id="npo-start-date" class="form-control" value="${_date()}">
                    </div>
                </div>

                <!-- Live totals -->
                <div id="npo-order-summary" style="background:var(--gray-50,#f9fafb);border:1px solid var(--gray-200);border-radius:8px;padding:12px;font-size:13px;"></div>
            </div>`;

        UI.showModal('New NPO Order', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save Order', type: 'primary', action: `(async () => { await app.npoSaveOrder(); })()` }
        ]);
        _renderOrderSummary();

        // Paint the preset existing customer into the now-rendered DOM (same
        // visual state npoPickCustomer produces). No plan is selected yet, so
        // _applyEligibilityUI hasn't run for a 'new'-only plan — if the agent
        // later picks such a plan, _applyEligibilityUI hides the existing path
        // and clears this selection, so the agent can re-enter a new name. No crash.
        if (_presetCust) {
            const nm = _order.customer.name;
            const sel = document.getElementById('npo-cust-selected');
            if (sel) sel.innerHTML = `Selected: <strong>${escapeHtml(nm)}</strong> <a href="#" onclick="app.npoClearSelectedCustomer();return false;" style="color:#dc2626;font-size:12px;margin-left:6px;">clear</a>`;
            const search = document.getElementById('npo-cust-search');
            if (search) search.value = nm;
            const results = document.getElementById('npo-cust-results');
            if (results) { results.style.display = 'none'; results.innerHTML = ''; }
        }
    };

    // ── customer lookup ──────────────────────────────────────────────────
    let _custSearchSeq = 0;
    // Debounced dispatcher (was firing searchCustomers on every keystroke). The seq
    // guard in _npoRunCustomerSearch already drops stale results; this cuts the calls.
    const npoSearchCustomers = (term) => {
        clearTimeout(npoSearchCustomers._t);
        const box = document.getElementById('npo-cust-results');
        if (!(term || '').trim()) { if (box) { box.style.display = 'none'; box.innerHTML = ''; } return; }
        npoSearchCustomers._t = setTimeout(() => _npoRunCustomerSearch(term), 220);
    };
    const _npoRunCustomerSearch = async (term) => {
        const box = document.getElementById('npo-cust-results');
        if (!box) return;
        term = (term || '').trim();
        if (!term) { box.style.display = 'none'; box.innerHTML = ''; return; }
        const seq = ++_custSearchSeq;
        let results = [];
        try { results = await AppDataStore.searchCustomers(term, { limit: 15 }); } catch (_) { results = []; }
        if (seq !== _custSearchSeq) return; // a newer keystroke won
        if (!results.length) { box.style.display = 'block'; box.innerHTML = `<div style="padding:8px;color:var(--gray-500);font-size:12px;">No matches.</div>`; return; }
        box.style.display = 'block';
        box.innerHTML = results.map(c => {
            const nm = (c.full_name || c.nickname || ('Customer #' + c.id));
            const sub = [c.phone, c.email].filter(Boolean).join(' · ');
            return `<div style="padding:8px;cursor:pointer;border-bottom:1px solid var(--gray-100);" onclick="app.npoPickCustomer(${c.id}, '${UI.escJsAttr(String(nm))}')">
                <strong>${escapeHtml(nm)}</strong>${sub ? `<span style="color:var(--gray-500);font-size:12px;"> — ${escapeHtml(sub)}</span>` : ''}
            </div>`;
        }).join('');
    };
    const npoPickCustomer = (id, name) => {
        if (!_order) return;
        _order.customer = { id, name: name || '' };
        const sel = document.getElementById('npo-cust-selected');
        if (sel) sel.innerHTML = `Selected: <strong>${escapeHtml(name || ('Customer #' + id))}</strong> <a href="#" onclick="app.npoClearSelectedCustomer();return false;" style="color:#dc2626;font-size:12px;margin-left:6px;">clear</a>`;
        const box = document.getElementById('npo-cust-results');
        if (box) { box.style.display = 'none'; box.innerHTML = ''; }
        const newname = document.getElementById('npo-cust-newname');
        if (newname) newname.value = '';
        const search = document.getElementById('npo-cust-search');
        if (search) search.value = name || '';
    };
    const npoClearSelectedCustomer = () => {
        if (!_order) return;
        _order.customer = { id: null, name: '' };
        const sel = document.getElementById('npo-cust-selected');
        if (sel) sel.innerHTML = '';
    };

    // Show/hide the two customer-entry paths according to the selected plan's
    // customer_eligibility: 'existing' → only the existing-customer search;
    // 'new' → only the free-text new-customer name; 'both' → both visible.
    // Also clears whichever path is being hidden so a stale value can't leak.
    const _applyEligibilityUI = () => {
        const elig = (_order && _order.eligibility) || 'both';
        const existingWrap = document.getElementById('npo-cust-existing-wrap');
        const newWrap = document.getElementById('npo-cust-new-wrap');
        const hint = document.getElementById('npo-cust-newname-hint');
        const newName = document.getElementById('npo-cust-newname');
        const showExisting = elig === 'existing' || elig === 'both';
        const showNew = elig === 'new' || elig === 'both';
        if (existingWrap) existingWrap.style.display = showExisting ? '' : 'none';
        if (newWrap) newWrap.style.display = showNew ? '' : 'none';
        // 'both' keeps the "No match?" framing; 'new' makes the name primary.
        if (hint) hint.style.display = (elig === 'both') ? '' : 'none';
        if (newName) newName.placeholder = (elig === 'new') ? 'New customer name' : 'New customer name (fallback)';
        // Clear the hidden path so a previously-entered value can't be saved.
        if (!showExisting) npoClearSelectedCustomer();
        if (!showNew && newName) newName.value = '';
    };

    // ── plan / tier / product wiring ─────────────────────────────────────
    const npoOrderPlanChanged = async (planId) => {
        if (!_order) return;
        const tierSel = document.getElementById('npo-order-tier');
        const prodBox = document.getElementById('npo-order-products');
        _order.plan = null; _order.eligibility = 'both'; _order.tiers = []; _order.products = []; _order.lines = new Map();
        if (!planId) {
            if (tierSel) { tierSel.disabled = true; tierSel.innerHTML = '<option value="">— Select plan first —</option>'; }
            if (prodBox) prodBox.innerHTML = 'Select a plan to load its eligible products.';
            _applyEligibilityUI();
            _renderTierTerms(); _renderOrderProducts(); _renderOrderSummary();
            return;
        }
        const pid = parseInt(planId, 10);
        const [plan, tiers, planProducts, allProducts] = await Promise.all([
            AppDataStore.getById('npo_plans', pid),
            _loadTiers(pid),
            _loadPlanProducts(pid),
            (async () => { try { return (await AppDataStore.getAll('products')) || []; } catch (_) { return []; } })()
        ]);
        _order.plan = plan || null;
        _order.eligibility = (plan && ['existing', 'new', 'both'].includes(plan.customer_eligibility)) ? plan.customer_eligibility : 'both';
        _applyEligibilityUI();
        tiers.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.tier_amount || 0) - (b.tier_amount || 0));
        _order.tiers = tiers;
        const catMap = new Map(allProducts.map(p => [String(p.id), p]));
        _order.products = planProducts.map(pp => {
            const cat = catMap.get(String(pp.product_id));
            return {
                product_id: pp.product_id,
                name: (cat && cat.name) || ('Product #' + pp.product_id),
                unit_price: cat && cat.price != null ? parseFloat(cat.price) : 0,
                default_redeem_after_months: pp.default_redeem_after_months != null ? pp.default_redeem_after_months : null
            };
        });
        if (tierSel) {
            tierSel.disabled = false;
            tierSel.innerHTML = '<option value="">— Select tier —</option>' + tiers.map(t =>
                `<option value="${t.id}">${_money(t.tier_amount)} — deposit ${_money(t.first_payment)} · ${_money(t.monthly_amount)}/mo × ${t.tenure_months}</option>`).join('');
        }
        _renderTierTerms();
        _renderOrderProducts();
        _renderOrderSummary();
    };

    const _selectedTier = () => {
        const sel = document.getElementById('npo-order-tier');
        const id = sel && parseInt(sel.value, 10);
        if (!id || isNaN(id)) return null;
        return _order.tiers.find(t => String(t.id) === String(id)) || null;
    };

    const npoOrderTierChanged = () => { _renderTierTerms(); _renderOrderSummary(); };
    const npoOrderModeChanged = () => {
        const mode = (document.querySelector('input[name="npo-fmode"]:checked') || {}).value;
        const wrap = document.getElementById('npo-redperiod-wrap');
        if (wrap) wrap.style.display = (mode === 'all_within_period') ? '' : 'none';
    };

    const _renderTierTerms = () => {
        const el = document.getElementById('npo-tier-terms');
        if (!el) return;
        const t = _selectedTier();
        el.innerHTML = t
            ? `Tier ${_money(t.tier_amount)} · deposit base ${_money(t.first_payment)} · ${_money(t.monthly_amount)} × ${t.tenure_months} months`
            : '';
    };

    const _renderOrderProducts = () => {
        const box = document.getElementById('npo-order-products');
        if (!box) return;
        if (!_order.plan) { box.innerHTML = 'Select a plan to load its eligible products.'; return; }
        if (!_order.products.length) { box.innerHTML = '<span style="color:var(--gray-500);">This plan has no eligible products configured.</span>'; return; }
        box.innerHTML = _order.products.map(p => {
            const line = _order.lines.get(p.product_id);
            const qty = line ? line.qty : 0;
            const redeem = line && line.redeem != null ? line.redeem : (p.default_redeem_after_months != null ? p.default_redeem_after_months : '');
            return `
                <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--gray-100);">
                    <div style="flex:1;">
                        <div><strong>${escapeHtml(p.name)}</strong></div>
                        <div style="font-size:12px;color:var(--gray-500);">${_money(p.unit_price)} each</div>
                    </div>
                    <label style="font-size:12px;color:var(--gray-500);">Qty
                        <input type="number" min="0" step="1" value="${qty}" style="width:64px;margin-left:4px;padding:3px 5px;border:1px solid var(--gray-300);border-radius:4px;"
                            oninput="app.npoOrderSetQty(${p.product_id}, this.value)">
                    </label>
                    <label style="font-size:12px;color:var(--gray-500);">Redeem after (mo)
                        <input type="number" min="0" step="1" value="${redeem}" style="width:74px;margin-left:4px;padding:3px 5px;border:1px solid var(--gray-300);border-radius:4px;"
                            oninput="app.npoOrderSetRedeem(${p.product_id}, this.value)">
                    </label>
                </div>`;
        }).join('');
    };

    const npoOrderSetQty = (productId, val) => {
        if (!_order) return;
        const qty = Math.max(0, Math.floor(parseFloat(val) || 0));
        const prod = _order.products.find(p => String(p.product_id) === String(productId));
        if (!prod) return;
        let line = _order.lines.get(prod.product_id);
        if (qty <= 0) {
            _order.lines.delete(prod.product_id);
        } else {
            if (!line) line = { qty: 0, redeem: prod.default_redeem_after_months != null ? prod.default_redeem_after_months : null };
            line.qty = qty;
            _order.lines.set(prod.product_id, line);
        }
        _renderOrderSummary();
    };
    const npoOrderSetRedeem = (productId, val) => {
        if (!_order) return;
        const prod = _order.products.find(p => String(p.product_id) === String(productId));
        if (!prod) return;
        const v = parseInt(val, 10);
        let line = _order.lines.get(prod.product_id);
        if (!line) { line = { qty: 0, redeem: null }; _order.lines.set(prod.product_id, line); }
        line.redeem = isNaN(v) ? null : v;
    };

    const _cartTotal = () => {
        let total = 0;
        _order.lines.forEach((line, pid) => {
            const prod = _order.products.find(p => String(p.product_id) === String(pid));
            if (prod) total += (prod.unit_price || 0) * (line.qty || 0);
        });
        return total;
    };

    const _renderOrderSummary = () => {
        const el = document.getElementById('npo-order-summary');
        if (!el || !_order) return;
        const t = _selectedTier();
        const cart = _cartTotal();
        if (!t) {
            el.innerHTML = `<div style="color:var(--gray-500);">Select a tier to see deposit &amp; installment terms.</div>
                <div style="margin-top:4px;">Cart total: <strong>${_money(cart)}</strong></div>`;
            return;
        }
        const tierAmount = parseFloat(t.tier_amount) || 0;
        const overage = Math.max(0, cart - tierAmount);
        const deposit = (parseFloat(t.first_payment) || 0) + overage;
        const below = cart < tierAmount;
        el.innerHTML = `
            <div style="display:flex;justify-content:space-between;"><span>Cart total</span><strong>${_money(cart)}</strong></div>
            <div style="display:flex;justify-content:space-between;"><span>Tier amount (minimum)</span><span>${_money(tierAmount)}</span></div>
            <div style="display:flex;justify-content:space-between;"><span>Overage</span><span>${_money(overage)}</span></div>
            <div style="display:flex;justify-content:space-between;margin-top:4px;border-top:1px solid var(--gray-200);padding-top:4px;"><span>Deposit (first payment)</span><strong>${_money(deposit)}</strong></div>
            <div style="display:flex;justify-content:space-between;color:var(--gray-600);"><span>Then</span><span>${_money(t.monthly_amount)} × ${t.tenure_months} months</span></div>
            ${below ? `<div style="margin-top:8px;color:#dc2626;font-weight:600;"><i class="fas fa-exclamation-triangle"></i> Cart total must be at least the tier amount (${_money(tierAmount)}). Only over, never below.</div>` : ''}`;
    };

    // ── SAVE ─────────────────────────────────────────────────────────────
    // In-flight reentrancy guard. The order save is 3 dependent, non-atomic
    // inserts (sale → items → installments). If a second invocation slips through
    // while the first is still awaiting the network — a double-click, a rapid
    // re-fire, or the framework re-enabling the Save button after an unrelated
    // toast — it would insert a DUPLICATE sale. Without a DB client_request_id
    // column (none exists; adding one is out of scope), this module-scoped flag is
    // the idempotency key: the first call wins, any overlapping call is ignored.
    // Combined with the framework's button-load disable (ui.js _startBtnLoad),
    // this makes a retry-while-in-flight a no-op instead of a stacked order.
    let _orderSaveInFlight = false;
    const npoSaveOrder = async () => {
        if (_orderSaveInFlight) return; // already saving this order — ignore the duplicate
        _orderSaveInFlight = true;
        try {
            return await _npoSaveOrderImpl();
        } finally {
            _orderSaveInFlight = false;
        }
    };
    // Legacy multi-insert path (sale -> items -> installments) with best-effort
    // compensating deletes on partial failure. Used only when the atomic RPC is
    // absent. Returns the new sale id or throws (after cleaning up any orphan).
    const _npoPersistViaInserts = async (sb, salePayload, itemPayloads, instPayloads) => {
        let savedSaleId = null;
        try {
            const { data: saleRow, error: saleErr } = await sb.from('npo_sales').insert(salePayload).select().single();
            if (saleErr) throw saleErr;
            const saleId = saleRow && saleRow.id;
            if (saleId == null) throw new Error('Sale insert returned no id');
            savedSaleId = saleId;
            if (itemPayloads.length) {
                const { error: itemErr } = await sb.from('npo_sale_items').insert(itemPayloads.map(i => ({ sale_id: saleId, ...i }))).select();
                if (itemErr) throw itemErr;
            }
            if (instPayloads.length) {
                const { error: instErr } = await sb.from('npo_installments').insert(instPayloads.map(n => ({ sale_id: saleId, ...n }))).select();
                if (instErr) throw instErr;
            }
            return saleId;
        } catch (e) {
            if (savedSaleId != null) {
                try { await sb.from('npo_sale_items').delete().eq('sale_id', savedSaleId); } catch (_) {}
                try { await sb.from('npo_installments').delete().eq('sale_id', savedSaleId); } catch (_) {}
                try { await sb.from('npo_sales').delete().eq('id', savedSaleId); } catch (_) {}
            }
            throw e;
        }
    };

    // Persist an order. Prefers the atomic server-side transaction
    // (npo_create_order RPC — migrations/npo_atomic_create_order_2026-07-03.sql):
    // all three inserts commit or roll back together, so no orphan can survive a
    // mid-sequence failure. Falls back to the legacy multi-insert path ONLY when
    // the function is absent (nothing ran → no double-insert risk); any other RPC
    // error is a genuine save failure and is surfaced, never silently retried.
    const _npoPersistOrder = async (sb, salePayload, itemPayloads, instPayloads) => {
        const rpc = await sb.rpc('npo_create_order', { p_sale: salePayload, p_items: itemPayloads, p_installments: instPayloads });
        if (!rpc.error) {
            if (rpc.data == null) throw new Error('npo_create_order returned no id');
            return rpc.data;
        }
        const code = rpc.error.code || '';
        const msg = rpc.error.message || '';
        const missing = code === '42883' || code === 'PGRST202'
            || /Could not find the function|function .* does not exist/i.test(msg);
        if (!missing) throw rpc.error;
        return await _npoPersistViaInserts(sb, salePayload, itemPayloads, instPayloads);
    };

    const _npoSaveOrderImpl = async () => {
        const sb = _sb();
        if (!sb) { UI.toast.error('Supabase not connected'); return; }
        if (!_order) { UI.toast.error('Order state lost — reopen the form'); return; }

        // Customer: gate the entry path by the plan's customer_eligibility.
        //   'existing' → require a picked existing customer (no free-text name).
        //   'new'      → require a typed name; customer_id stays null.
        //   'both'     → prefer a picked existing customer; else a typed name.
        const elig = _order.eligibility || 'both';
        const newName = _str('npo-cust-newname');
        let customer_id = _order.customer && _order.customer.id != null ? _order.customer.id : null;
        let customer_name = _order.customer && _order.customer.name ? _order.customer.name : '';
        if (elig === 'existing') {
            if (customer_id == null) { UI.toast.error('This plan is for existing customers only — pick an existing customer'); return; }
        } else if (elig === 'new') {
            // New-customer plan: ignore any stray existing pick, require a name.
            customer_id = null;
            if (!newName) { UI.toast.error('This plan is for new customers only — enter a new customer name'); return; }
            customer_name = newName;
        } else { // both
            if (customer_id == null) {
                if (newName) { customer_name = newName; }
                else { UI.toast.error('Select a customer or type a new customer name'); return; }
            }
        }

        const plan = _order.plan;
        if (!plan) { UI.toast.error('Select a plan'); return; }
        const tier = _selectedTier();
        if (!tier) { UI.toast.error('Select a tier'); return; }

        // Build line items from the cart.
        const lines = [];
        _order.lines.forEach((line, pid) => {
            const prod = _order.products.find(p => String(p.product_id) === String(pid));
            if (!prod || !(line.qty > 0)) return;
            const lt = (prod.unit_price || 0) * line.qty;
            lines.push({
                product_id: prod.product_id,
                product_name: prod.name,
                qty: line.qty,
                unit_price: prod.unit_price || 0,
                line_total: lt,
                redeem_after_months: line.redeem != null ? line.redeem
                    : (prod.default_redeem_after_months != null ? prod.default_redeem_after_months : null)
            });
        });
        if (!lines.length) { UI.toast.error('Add at least one product'); return; }

        const cart_total = lines.reduce((s, l) => s + l.line_total, 0);
        const tier_amount = parseFloat(tier.tier_amount) || 0;
        if (cart_total < tier_amount) {
            UI.toast.error(`Cart total ${_money(cart_total)} is below the tier amount ${_money(tier_amount)}. Only over, never below.`);
            return;
        }
        const overage = cart_total - tier_amount;
        const first_payment = (parseFloat(tier.first_payment) || 0) + overage;
        const monthly_amount = parseFloat(tier.monthly_amount) || 0;
        const tenure_months = parseInt(tier.tenure_months, 10) || 0;
        if (tenure_months <= 0) { UI.toast.error('Tier tenure is invalid'); return; }

        const fulfillment_mode = (document.querySelector('input[name="npo-fmode"]:checked') || {}).value || 'all_within_period';
        let redemption_period_months = null;
        if (fulfillment_mode === 'all_within_period') {
            redemption_period_months = parseInt(_num('npo-redperiod'), 10);
            if (isNaN(redemption_period_months)) redemption_period_months = null;
        }
        const start_date = _str('npo-start-date') || _date();
        const uid = (_state.cu && _state.cu.id) || null;

        // Payloads. `id` is GENERATED identity (never sent); the persist step sets
        // sale_id on items/installments. customer_name is a first-class column
        // (migrations/npo_feature_2026-06-24.sql) capturing the name when there's
        // no existing customer_id.
        const salePayload = {
            customer_id, customer_name: customer_name || null,
            plan_id: plan.id, tier_id: tier.id,
            cart_total, tier_amount, overage, first_payment, monthly_amount, tenure_months,
            fulfillment_mode, redemption_period_months, start_date,
            status: 'active', responsible_agent_id: uid, created_by: uid
        };
        // one item per cart line (sale_id added by the persist step)
        const itemPayloads = lines.map(l => ({
            product_id: l.product_id, product_name: l.product_name, qty: l.qty,
            unit_price: l.unit_price, line_total: l.line_total,
            redeem_after_months: l.redeem_after_months, delivery_status: 'pending'
        }));
        // installment schedule: seq 1..tenure, due = start + seq months, amount = monthly.
        // The first_payment deposit is on the sale, NOT a row.
        const instPayloads = [];
        for (let seq = 1; seq <= tenure_months; seq++) {
            instPayloads.push({ seq, due_date: _addMonths(start_date, seq), amount: monthly_amount, status: 'due' });
        }

        let saleId;
        try {
            // Atomic when the RPC is present; atomic-compensated fallback otherwise.
            saleId = await _npoPersistOrder(sb, salePayload, itemPayloads, instPayloads);
        } catch (e) {
            UI.toast.error('Save failed: ' + (e && e.message ? e.message : 'unknown error'));
            return;
        }

        ['npo_sales', 'npo_sale_items', 'npo_installments'].forEach(t => {
            try { AppDataStore.invalidateCache && AppDataStore.invalidateCache(t); } catch (_) {}
        });

        // Count the deposit toward the customer's Lifetime Value as collected.
        // Only for an EXISTING customer (customer_id is a real id) — a new customer
        // has no LTV target, so SKIP. countDelta=1: the sale counts as one purchase;
        // later paid installments bump the amount with countDelta=0. Best-effort: a
        // failed bump must NOT undo the already-committed sale.
        if (customer_id != null) {
            try { await _utils.adjustCustomerLtv(customer_id, first_payment, 1); }
            catch (e) { console.warn('NPO LTV deposit bump failed', e); }
        }

        _order = null;
        UI.hideModal();
        UI.toast.success('NPO order created');
        await _refresh();
    };

    // ====================================================================
    // ORDER DETAIL — terms, items + delivery controls, installment ledger
    // ====================================================================
    // Shared fail-closed scope gate for the by-id mutators (mirrors npoOpenOrder's
    // view gate). The NPO nav is visible org-wide, so without this an agent could
    // write to a sale outside their visible set by passing a guessed/sibling saleId.
    const _npoSaleInScope = async (saleId) => {
        let sale = null;
        try { sale = await AppDataStore.getById('npo_sales', saleId); } catch (_) { sale = null; }
        if (!sale) return false;
        try {
            const visible = await _utils.getVisibleUserIds(_state.cu);
            if (visible !== 'all') {
                const set = new Set((Array.isArray(visible) ? visible : []).map(String));
                if (!set.has(String(sale.responsible_agent_id))) return false;
            }
        } catch (_) { return false; }
        return true;
    };

    const npoOpenOrder = async (saleId) => {
        const container = _viewport();
        if (!container) return;
        let sale;
        try { sale = await AppDataStore.getById('npo_sales', saleId); } catch (_) { sale = null; }
        if (!sale) { UI.toast.error('Order not found'); return; }

        // Fail-closed scope check: an agent may only open their own sales.
        try {
            const visible = await _utils.getVisibleUserIds(_state.cu);
            if (visible !== 'all') {
                const set = new Set((Array.isArray(visible) ? visible : []).map(String));
                if (!set.has(String(sale.responsible_agent_id))) { UI.toast.error('Not permitted'); return; }
            }
        } catch (_) { UI.toast.error('Not permitted'); return; }

        const [items, installments, plan, tier, customer] = await Promise.all([
            (async () => { try { return (await AppDataStore.query('npo_sale_items', { sale_id: saleId })) || []; } catch (_) { return []; } })(),
            (async () => { try { return (await AppDataStore.query('npo_installments', { sale_id: saleId })) || []; } catch (_) { return []; } })(),
            (async () => { try { return sale.plan_id != null ? await AppDataStore.getById('npo_plans', sale.plan_id) : null; } catch (_) { return null; } })(),
            (async () => { try { return sale.tier_id != null ? await AppDataStore.getById('npo_plan_tiers', sale.tier_id) : null; } catch (_) { return null; } })(),
            (async () => { try { return sale.customer_id != null ? await AppDataStore.getById('customers', sale.customer_id) : null; } catch (_) { return null; } })()
        ]);
        installments.sort((a, b) => (a.seq || 0) - (b.seq || 0));

        const custName = customer ? (customer.full_name || customer.nickname || ('Customer #' + customer.id))
            : (sale.customer_name || (sale.customer_id != null ? ('Customer #' + sale.customer_id) : '(new customer)'));
        const paidCount = installments.filter(i => i.status === 'paid').length;

        const itemRows = items.length ? items.map(it => _renderItemRow(saleId, it)).join('') : `<tr><td colspan="5" style="padding:14px;text-align:center;color:var(--gray-500);">No items.</td></tr>`;
        const instRows = installments.length ? installments.map(i => _renderInstallmentRow(saleId, i)).join('') : `<tr><td colspan="6" style="padding:14px;text-align:center;color:var(--gray-500);">No installments.</td></tr>`;

        container.innerHTML = `
            <div style="padding:24px;max-width:1000px;margin:0 auto;">
                <button class="btn" onclick="app.navigateTo('npo')" style="background:none;border:none;color:#0e7490;cursor:pointer;padding:0;margin-bottom:14px;font-size:13px;"><i class="fas fa-arrow-left"></i> Back to NPO</button>
                <div style="margin-bottom:18px;display:flex;align-items:center;justify-content:space-between;">
                    <div>
                        <h1 style="margin:0;">${escapeHtml(custName)}</h1>
                        <div style="color:var(--gray-500);font-size:13px;margin-top:4px;">${escapeHtml((plan && plan.name) || '—')} · started ${escapeHtml(sale.start_date || '—')}</div>
                    </div>
                    ${_statusBadge(sale.status)}
                </div>

                <!-- ── Terms ─────────────────────────────────────────────── -->
                <div style="background:white;border:1px solid var(--gray-200);border-radius:12px;padding:20px;margin-bottom:18px;">
                    <h3 style="margin:0 0 12px;">Terms</h3>
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;font-size:13px;">
                        <div><div style="color:var(--gray-500);">Tier amount</div><strong>${_money(sale.tier_amount)}</strong></div>
                        <div><div style="color:var(--gray-500);">Cart total</div><strong>${_money(sale.cart_total)}</strong></div>
                        <div><div style="color:var(--gray-500);">Overage</div><strong>${_money(sale.overage)}</strong></div>
                        <div><div style="color:var(--gray-500);">Deposit (first payment)</div><strong>${_money(sale.first_payment)}</strong></div>
                        <div><div style="color:var(--gray-500);">Monthly × tenure</div><strong>${_money(sale.monthly_amount)} × ${escapeHtml(String(sale.tenure_months || 0))}</strong></div>
                        <div><div style="color:var(--gray-500);">Fulfillment</div><strong>${escapeHtml(sale.fulfillment_mode === 'full_payment_first' ? 'Full payment first' : 'All within period')}</strong></div>
                        ${sale.redemption_period_months != null ? `<div><div style="color:var(--gray-500);">Redemption period</div><strong>${escapeHtml(String(sale.redemption_period_months))} mo</strong></div>` : ''}
                        <div><div style="color:var(--gray-500);">Installments paid</div><strong>${paidCount} / ${escapeHtml(String(sale.tenure_months || 0))}</strong></div>
                    </div>
                </div>

                <!-- ── Items + delivery ──────────────────────────────────── -->
                <div style="background:white;border:1px solid var(--gray-200);border-radius:12px;padding:20px;margin-bottom:18px;">
                    <h3 style="margin:0 0 12px;">Items &amp; Delivery</h3>
                    <table style="width:100%;border-collapse:collapse;font-size:13px;">
                        <thead><tr style="text-align:left;color:var(--gray-500);border-bottom:1px solid var(--gray-200);">
                            <th style="padding:8px;">Product</th><th style="padding:8px;">Qty</th><th style="padding:8px;">Line Total</th>
                            <th style="padding:8px;">Delivery</th><th style="padding:8px;text-align:right;">Action</th>
                        </tr></thead>
                        <tbody>${itemRows}</tbody>
                    </table>
                </div>

                <!-- ── Installment ledger ────────────────────────────────── -->
                <div style="background:white;border:1px solid var(--gray-200);border-radius:12px;padding:20px;">
                    <h3 style="margin:0 0 12px;">Installment Ledger</h3>
                    <table style="width:100%;border-collapse:collapse;font-size:13px;">
                        <thead><tr style="text-align:left;color:var(--gray-500);border-bottom:1px solid var(--gray-200);">
                            <th style="padding:8px;">#</th><th style="padding:8px;">Due</th><th style="padding:8px;">Amount</th>
                            <th style="padding:8px;">Status</th><th style="padding:8px;">Paid / Slip</th><th style="padding:8px;text-align:right;">Actions</th>
                        </tr></thead>
                        <tbody>${instRows}</tbody>
                    </table>
                </div>
            </div>`;
    };

    const _DELIVERY_FLOW = ['pending', 'ordered', 'in_transit', 'delivered', 'redeemed'];
    const _deliveryLabel = (s) => ({ pending: 'Pending', ordered: 'Ordered', in_transit: 'In transit', delivered: 'Delivered', redeemed: 'Redeemed' }[s] || s || '—');
    const _renderItemRow = (saleId, it) => {
        const cur = it.delivery_status || 'pending';
        const idx = _DELIVERY_FLOW.indexOf(cur);
        const next = idx >= 0 && idx < _DELIVERY_FLOW.length - 1 ? _DELIVERY_FLOW[idx + 1] : null;
        const advanceBtn = next
            ? `<button class="btn-icon" title="Advance to ${_deliveryLabel(next)}" onclick="app.npoAdvanceDelivery(${saleId},${it.id})" style="background:#0e7490;border:none;color:white;cursor:pointer;padding:4px 10px;border-radius:6px;font-size:12px;">→ ${escapeHtml(_deliveryLabel(next))}</button>`
            : `<span style="color:var(--gray-500);font-size:12px;">—</span>`;
        return `
            <tr>
                <td style="padding:8px;border-bottom:1px solid var(--gray-100);"><strong>${escapeHtml(it.product_name || ('Product #' + it.product_id))}</strong></td>
                <td style="padding:8px;border-bottom:1px solid var(--gray-100);">${escapeHtml(String(it.qty || 0))}</td>
                <td style="padding:8px;border-bottom:1px solid var(--gray-100);">${_money(it.line_total)}</td>
                <td style="padding:8px;border-bottom:1px solid var(--gray-100);">${escapeHtml(_deliveryLabel(cur))}${it.delivered_date ? ` <span style="color:var(--gray-500);font-size:11px;">(${escapeHtml(it.delivered_date)})</span>` : ''}</td>
                <td style="padding:8px;border-bottom:1px solid var(--gray-100);text-align:right;">${advanceBtn}</td>
            </tr>`;
    };

    // Advance an item one step along pending→ordered→in_transit→delivered→redeemed.
    // delivered_date is stamped when it reaches 'delivered'.
    const npoAdvanceDelivery = async (saleId, itemId) => {
        if (!(await _npoSaleInScope(saleId))) { UI.toast.error('Not permitted'); return; }
        const sb = _sb();
        if (!sb) { UI.toast.error('Supabase not connected'); return; }
        try {
            const it = await AppDataStore.getById('npo_sale_items', itemId);
            if (!it) { UI.toast.error('Item not found'); return; }
            const idx = _DELIVERY_FLOW.indexOf(it.delivery_status || 'pending');
            if (idx < 0 || idx >= _DELIVERY_FLOW.length - 1) { UI.toast.success('Already at final stage'); return; }
            const next = _DELIVERY_FLOW[idx + 1];
            const patch = { delivery_status: next };
            if (next === 'delivered' && !it.delivered_date) patch.delivered_date = _date();
            const { error } = await sb.from('npo_sale_items').update(patch).eq('id', itemId);
            if (error) throw error;
            try { AppDataStore.invalidateCache && AppDataStore.invalidateCache('npo_sale_items'); } catch (_) {}
            UI.toast.success('Delivery → ' + _deliveryLabel(next));
            await npoOpenOrder(saleId);
        } catch (e) {
            UI.toast.error('Update failed: ' + (e && e.message ? e.message : 'unknown error'));
        }
    };

    // ── installment ledger rows + actions ────────────────────────────────
    const _instBadge = (s) => {
        const map = { due: ['#e0f2fe', '#075985', 'Due'], paid: ['#dcfce7', '#166534', 'Paid'], lapsed: ['#fee2e2', '#991b1b', 'Lapsed'], waived: ['var(--gray-200)', 'var(--gray-600)', 'Waived'] };
        const [bg, fg, label] = map[s] || ['var(--gray-200)', 'var(--gray-600)', s || '—'];
        return `<span class="badge" style="background:${bg};color:${fg};padding:2px 8px;border-radius:10px;font-size:11px;">${escapeHtml(label)}</span>`;
    };
    const _renderInstallmentRow = (saleId, i) => {
        const slip = i.slip_url
            ? `<a href="#" onclick="event.preventDefault();window._openAttachment&&window._openAttachment('${UI.escJsAttr(String(i.slip_url))}')" style="color:#0e7490;font-size:12px;cursor:pointer;">slip${i.is_manual_transfer ? ' (manual)' : ''}</a>`
            : (i.is_manual_transfer ? '<span style="color:var(--gray-500);font-size:12px;">manual</span>' : '');
        const paidInfo = i.status === 'paid'
            ? `<span style="font-size:12px;color:var(--gray-600);">${escapeHtml(i.paid_date || '')}</span> ${slip}`
            : slip;
        let actions = '';
        if (i.status !== 'paid') {
            actions += `<button class="btn-icon" title="Mark paid" onclick="app.npoMarkInstallmentPaid(${saleId},${i.id})" style="background:none;border:none;cursor:pointer;color:#166534;margin-right:6px;"><i class="fas fa-check-circle"></i></button>`;
        }
        if (i.status !== 'lapsed' && i.status !== 'paid') {
            actions += `<button class="btn-icon" title="Mark lapsed" onclick="app.npoMarkInstallmentLapsed(${saleId},${i.id})" style="background:none;border:none;cursor:pointer;color:#b45309;margin-right:6px;"><i class="fas fa-exclamation-circle"></i></button>`;
        }
        // Resubmit / manual transfer — upload a slip AND mark paid (clears a lapse).
        actions += `<button class="btn-icon" title="Resubmit / manual transfer (upload slip + mark paid)" onclick="app.npoResubmitInstallment(${saleId},${i.id})" style="background:none;border:none;cursor:pointer;color:#0e7490;"><i class="fas fa-file-upload"></i></button>`;
        return `
            <tr>
                <td style="padding:8px;border-bottom:1px solid var(--gray-100);">${escapeHtml(String(i.seq || ''))}</td>
                <td style="padding:8px;border-bottom:1px solid var(--gray-100);">${escapeHtml(i.due_date || '—')}</td>
                <td style="padding:8px;border-bottom:1px solid var(--gray-100);">${_money(i.amount)}</td>
                <td style="padding:8px;border-bottom:1px solid var(--gray-100);">${_instBadge(i.status)}</td>
                <td style="padding:8px;border-bottom:1px solid var(--gray-100);">${paidInfo || '—'}</td>
                <td style="padding:8px;border-bottom:1px solid var(--gray-100);text-align:right;white-space:nowrap;">${actions}</td>
            </tr>`;
    };

    // Upload a payment slip to the `attachments` bucket and return its public URL.
    // Mirrors saveAPUForm / _evGenerateForName storage pattern. Returns null on no file.
    const _uploadSlip = async (file, saleId, seq) => {
        const sb = _sb();
        if (!sb || !sb.storage) throw new Error('Supabase storage not connected');
        const safeName = (file.name || 'slip').replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `npo_slips/${saleId}_${seq}_${Date.now()}_${safeName}`;
        const { error: upErr } = await sb.storage.from('attachments').upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
        if (upErr) throw upErr;
        const { data: urlData } = sb.storage.from('attachments').getPublicUrl(path);
        if (!urlData || !urlData.publicUrl) throw new Error('Upload succeeded but could not get URL');
        return urlData.publicUrl;
    };

    // Mark PAID — optional slip upload via a small modal.
    const npoMarkInstallmentPaid = async (saleId, instId) => {
        if (!(await _npoSaleInScope(saleId))) { UI.toast.error('Not permitted'); return; }
        const inst = await AppDataStore.getById('npo_installments', instId).catch(() => null);
        const seq = inst ? inst.seq : '';
        const content = `
            <div class="form-group">
                <label>Payment Date</label>
                <input type="date" id="npo-paid-date" class="form-control" value="${_date()}">
            </div>
            <div class="form-group">
                <label>Payment Slip (optional)</label>
                <input type="file" id="npo-paid-slip" class="form-control" accept="image/*,application/pdf">
            </div>
            <div class="form-group">
                <label>Note</label>
                <input type="text" id="npo-paid-note" class="form-control" placeholder="Optional">
            </div>`;
        UI.showModal(`Mark Installment #${seq} Paid`, content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Mark Paid', type: 'primary', action: `(async () => { await app.npoConfirmInstallmentPaid(${saleId}, ${instId}, false); })()` }
        ]);
    };

    // Resubmit / manual transfer — slip REQUIRED, marks paid with is_manual_transfer.
    const npoResubmitInstallment = async (saleId, instId) => {
        if (!(await _npoSaleInScope(saleId))) { UI.toast.error('Not permitted'); return; }
        const inst = await AppDataStore.getById('npo_installments', instId).catch(() => null);
        const seq = inst ? inst.seq : '';
        const content = `
            <div style="font-size:13px;color:var(--gray-600);margin-bottom:10px;">Upload a transfer slip and mark this installment paid as a manual transfer. This clears a lapsed payment.</div>
            <div class="form-group">
                <label>Payment Date</label>
                <input type="date" id="npo-paid-date" class="form-control" value="${_date()}">
            </div>
            <div class="form-group">
                <label>Transfer Slip <span class="required">*</span></label>
                <input type="file" id="npo-paid-slip" class="form-control" accept="image/*,application/pdf">
            </div>
            <div class="form-group">
                <label>Note</label>
                <input type="text" id="npo-paid-note" class="form-control" placeholder="e.g. manual bank transfer ref">
            </div>`;
        UI.showModal(`Resubmit / Manual Transfer — #${seq}`, content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Upload &amp; Mark Paid', type: 'primary', action: `(async () => { await app.npoConfirmInstallmentPaid(${saleId}, ${instId}, true); })()` }
        ]);
    };

    // Shared confirm path for both "mark paid" and "resubmit/manual transfer".
    // manual=true requires a slip and sets is_manual_transfer.
    const npoConfirmInstallmentPaid = async (saleId, instId, manual) => {
        if (!(await _npoSaleInScope(saleId))) { UI.toast.error('Not permitted'); return; }
        const sb = _sb();
        if (!sb) { UI.toast.error('Supabase not connected'); return; }
        const paid_date = _str('npo-paid-date') || _date();
        const note = _str('npo-paid-note') || null;
        const input = document.getElementById('npo-paid-slip');
        const file = input && input.files && input.files[0];
        if (manual && !file) { UI.toast.error('A slip is required for a manual transfer'); return; }
        if (file && file.size > 10 * 1024 * 1024) { UI.toast.error('File too large (max 10MB)'); return; }
        try {
            const inst = await AppDataStore.getById('npo_installments', instId);
            const seq = inst ? inst.seq : 0;
            // Idempotency guard: only a REAL transition INTO 'paid' counts toward LTV.
            // Read the current status BEFORE the update — if it was already 'paid',
            // re-marking / resubmitting must NOT bump LTV again (no double-count).
            const wasPaid = inst && inst.status === 'paid';
            const instAmount = inst ? (parseFloat(inst.amount) || 0) : 0;
            let slip_url = null;
            if (file) slip_url = await _uploadSlip(file, saleId, seq);
            const patch = { status: 'paid', paid_date, note };
            if (slip_url) patch.slip_url = slip_url;
            if (manual) patch.is_manual_transfer = true;
            // .select('id') so a zero-row update (RLS filtered the row out, or instId
            // no longer exists) is caught here — without it PostgREST resolves error=null
            // on 0 rows and we'd toast success + bump the customer LTV for a payment that
            // was never actually recorded, leaving the ledger and LTV disagreeing.
            const { data: _upd, error } = await sb.from('npo_installments').update(patch).eq('id', instId).select('id');
            if (error) throw error;
            if (!_upd || _upd.length === 0) throw new Error('Installment not updated — it may have been removed or you may not have permission.');
            try { AppDataStore.invalidateCache && AppDataStore.invalidateCache('npo_installments'); } catch (_) {}

            // Count this installment toward the customer's LTV as collected — ONLY on a
            // genuine first transition into 'paid' (was 'due' or 'lapsed', not already
            // 'paid'), and ONLY for an EXISTING customer (sale.customer_id a real id; a
            // new-customer sale has customer_id null → SKIP). countDelta=0: same
            // purchase, just more collected. Best-effort: a failed bump must NOT fail
            // the already-recorded payment.
            if (!wasPaid && instAmount > 0) {
                let sale = null;
                try { sale = await AppDataStore.getById('npo_sales', saleId); } catch (_) { sale = null; }
                if (sale && sale.customer_id != null) {
                    try { await _utils.adjustCustomerLtv(sale.customer_id, instAmount, 0); }
                    catch (e) { console.warn('NPO LTV installment bump failed', e); }
                }
            }

            UI.hideModal();
            UI.toast.success(manual ? 'Manual transfer recorded — installment paid' : 'Installment marked paid');
            await npoOpenOrder(saleId);
        } catch (e) {
            UI.toast.error('Save failed: ' + (e && e.message ? e.message : 'unknown error'));
        }
    };

    const npoMarkInstallmentLapsed = async (saleId, instId) => {
        if (!(await _npoSaleInScope(saleId))) { UI.toast.error('Not permitted'); return; }
        const sb = _sb();
        if (!sb) { UI.toast.error('Supabase not connected'); return; }
        UI.confirm('Mark Lapsed', 'Mark this installment as lapsed?', async () => {
            try {
                const { error } = await sb.from('npo_installments').update({ status: 'lapsed' }).eq('id', instId);
                if (error) throw error;
                try { AppDataStore.invalidateCache && AppDataStore.invalidateCache('npo_installments'); } catch (_) {}
                UI.toast.success('Installment marked lapsed');
                await npoOpenOrder(saleId);
            } catch (e) {
                UI.toast.error('Update failed: ' + (e && e.message ? e.message : 'unknown error'));
            }
        });
    };

    // ── refresh helper — re-render the current NPO list view in place ────
    const _refresh = async () => {
        const container = _viewport();
        if (container) await showNpoView(container);
    };

    // ── Register public surface on window.app ────────────────────────────
    app.register('npo', {
        showNpoView,
        npoOpenPlanModal,
        npoSavePlan,
        npoTogglePlanActive,
        npoDeletePlan,
        npoManagePlan,
        npoOpenTierModal,
        npoSaveTier,
        npoDeleteTier,
        npoSaveEligibleProducts,
        // ── Phase 2: order flow ──
        npoOpenOrderModal,
        npoSearchCustomers,
        npoPickCustomer,
        npoClearSelectedCustomer,
        npoOrderPlanChanged,
        npoOrderTierChanged,
        npoOrderModeChanged,
        npoOrderSetQty,
        npoOrderSetRedeem,
        npoSaveOrder,
        npoOpenOrder,
        npoAdvanceDelivery,
        npoMarkInstallmentPaid,
        npoResubmitInstallment,
        npoConfirmInstallmentPaid,
        npoMarkInstallmentLapsed,
    });
})();
