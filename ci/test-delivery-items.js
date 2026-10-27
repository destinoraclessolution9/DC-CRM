// ci/test-delivery-items.js — per-item delivery / pick-up with photo proof.
//
// WHY (owner 2026-10-19): products are custom-made (rings ~6 months). One order
// can hold several items handed over on different days or together; each handover
// needs a date AND photo proof; the Collection Date is the item's expected ready
// date (never the sale date). Pins: item creation from the order (ready date from
// the matching closing record, only when after the order date), split, the
// handover gate (tick + date + photo, no future date), per-item status, the order
// flipping to Delivered only when every item is handed over, and undo.
//
// HARNESS: loads the REAL chunks/script-customers.js in a vm sandbox (pattern of
// test-improvements-sim.js) with an in-memory Supabase that applies eq/in filters.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++;
    console.error(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
};

const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

const USERS = [
    { id: 1, role: 'Level 1 Super Admin', full_name: 'Admin' },
    { id: 5, role: 'Level 9 Consultant', full_name: 'Agent Lau' },
    { id: 6, role: 'Level 9 Consultant', full_name: 'Agent Kim' },
];
// ── in-memory DB ──
let DB, nextId, uploads, removed;
const reset = () => {
    nextId = 100; uploads = []; removed = [];
    DB = {
        delivery_items: [],
        purchases: [{ id: 1, customer_id: 77, item: '圣智+ PR 6', invoice: 'INV-9', ring_size: '16', delivery_status: 'Pending Delivery' }],
        customers: [{ id: 77, full_name: 'Tan Ah Kow', converted_from_prospect_id: 500 }],
        prospects: [{ id: 500, closing_record: null, closing_records_history: [
            { invoice_number: 'inv-9', order_date: '2026-10-05', closing_date: '2027-04-01' },
        ] }],
    };
};
const match = (r, filters) => filters.every(([op, c, v]) => op === 'eq' ? String(r[c]) === String(v) : v.map(String).includes(String(r[c])));
const sb = {
    from: (t) => {
        const filters = [];
        let mode = 'select', payload = null;
        const run = () => {
            const rows = DB[t] || (DB[t] = []);
            if (mode === 'insert') {
                const list = (Array.isArray(payload) ? payload : [payload]).map(p => ({ id: ++nextId, qty: 1, status: 'pending', photos: [], ...p }));
                // the DB check constraint: no handover without date + photo
                rows.push(...list);
                return { data: list, error: null };
            }
            const hit = rows.filter(r => match(r, filters));
            if (mode === 'update') {
                for (const r of hit) {
                    const next = { ...r, ...payload };
                    if (t === 'delivery_items' && next.status !== 'pending' && (!next.handover_date || !(next.photos || []).length)) return { data: null, error: { message: 'violates check constraint delivery_items_handover_chk' } };
                    Object.assign(r, payload);
                }
                return { data: hit, error: null };
            }
            if (mode === 'delete') { DB[t] = rows.filter(r => !hit.includes(r)); return { data: hit, error: null }; }
            if (mode === 'count') return { data: null, count: hit.length, error: null };
            return { data: hit.map(r => ({ ...r })).sort((a, b) => a.id - b.id), error: null };
        };
        const q = {
            select: (_c, o) => { if (o && o.head) mode = 'count'; return q; }, order: () => q, limit: () => q,
            eq: (c, v) => { filters.push(['eq', c, v]); return q; },
            in: (c, v) => { filters.push(['in', c, v]); return q; },
            insert: (p) => { mode = 'insert'; payload = p; return q; },
            update: (p) => { mode = 'update'; payload = p; return q; },
            delete: () => { mode = 'delete'; return q; },
            then: (res, rej) => Promise.resolve(run()).then(res, rej),
        };
        return q;
    },
    rpc: async (fn, args) => {
        // mirrors delivery_advance_allowed: calligraphy / artistic / 财库·财托, never rings
        if (fn === 'delivery_advance_eligible') return { data: (DB.delivery_items || []).filter(r => args.p_item_ids.includes(r.id) && /(元极大通|大满福|上龙柄|财库|calligraph)/i.test(r.item_name) && !/(ring|指环|\bpr\s?\d)/i.test(r.item_name)).map(r => r.id), error: null };
        return { data: [], error: null };
    },
    storage: { from: () => ({
        upload: async (p) => { uploads.push(p); return { error: null }; },
        remove: async (ps) => { removed.push(...ps); return { error: null }; },
    }) },
};

// ── DOM stub: handover form fields + ticked boxes ──
let FORM = {};
let PICKED = [];
const documentStub = {
    getElementById: (id) => (id in FORM ? FORM[id] : null),
    querySelectorAll: (sel) => (sel === '.di-pick:checked' ? PICKED.map(v => ({ value: String(v) })) : []),
    querySelector: () => null, addEventListener: () => {}, body: { appendChild() {} },
    createElement: () => ({ style: {}, appendChild() {} }),
};

const calls = { toastErr: [], toastOk: [], modals: [], statusSet: [] };
const AppDataStore = {
    getById: async (t, id) => { const r = (DB[t] || []).find(x => String(x.id) === String(id)); return r ? { ...r } : null; },
    getByIdFull: async (t, id) => { const r = (DB[t] || []).find(x => String(x.id) === String(id)); return r ? { ...r } : null; },
    update: async (t, id, patch) => { const r = (DB[t] || []).find(x => String(x.id) === String(id)); if (r) Object.assign(r, patch); if (t === 'purchases' && patch.delivery_status) calls.statusSet.push(patch.delivery_status); return r; },
    query: async () => [], getAll: async (t) => (t === 'users' ? USERS : []), create: async (t, r) => r,
};
const UI = {
    showModal: (title, content, actions) => calls.modals.push({ title, content, actions }), hideModal: () => { calls.hidden = (calls.hidden || 0) + 1; },
    toast: { success: (m) => calls.toastOk.push(m), error: (m) => calls.toastErr.push(m), info: () => {} },
    escJsAttr: (s) => String(s), currencyForCountry: () => 'MYR', countryByCode: () => ({ code: 'MY', symbol: 'RM' }),
};
const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const levelOf = (u) => { const m = /Level\s+(\d+)/i.exec(u?.role || ''); return m ? parseInt(m[1], 10) : 99; };
const _crmUtils = new Proxy({ escapeHtml, getUserLevel: levelOf, isSystemAdmin: (u) => levelOf(u) === 1, isManagement: (u) => levelOf(u) <= 4, isAgent: () => true, isMobile: () => false },
    { get: (t, k) => (k in t ? t[k] : () => undefined) });
const appStub = { register(name, fns) { Object.assign(this, fns); }, navigateTo: async () => {}, compressImageFile: async (f) => f, applyMobileTableLabels: () => {} };
const windowStub = { _appState: { cu: { id: 1, role: 'Level 1 Super Admin', full_name: 'Admin' } }, _crmUtils, app: appStub, supabase: sb, _loadChunk: async () => {}, addEventListener: () => {}, location: {} };
const sandbox = {
    window: windowStub, document: documentStub, AppDataStore, UI, app: appStub, console,
    setTimeout: () => 0, clearTimeout: () => {}, confirm: () => true,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, navigator: { userAgent: 'node' }, URL, Blob: function () {}, FileReader: function () {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'chunks', 'script-customers.js'), 'utf8'), sandbox, { filename: 'script-customers.js' });
const app = windowStub.app;
const photo = (n) => ({ name: n, type: 'image/jpeg' });
const items = () => DB.delivery_items.slice().sort((a, b) => a.id - b.id);

(async () => {
    // ── open: the order becomes one item; ready date = closing record's Collection Date ──
    reset();
    await app.openDeliveryItems('purchase', 1, 77);
    eq('first open creates one item from the order', items().map(r => [r.item_name, r.ring_size, r.expected_ready_date, r.purchase_id]), [['圣智+ PR 6', '16', '2027-04-01', 1]]);
    await app.openDeliveryItems('purchase', 1, 77);
    eq('re-open does not duplicate', items().length, 1);

    // Collection Date equal to the order date is NOT a ready date.
    reset();
    DB.prospects[0].closing_records_history[0].closing_date = '2026-10-05';
    await app.openDeliveryItems('purchase', 1, 77);
    eq('collection = order date → no ready date', items()[0].expected_ready_date, null);

    // ── split ──
    reset();
    await app.openDeliveryItems('purchase', 1, 77);
    await app.diSplitItem(items()[0].id);
    eq('split "圣智+ PR 6" into two items with the same ready date', items().map(r => [r.item_name, r.expected_ready_date]), [['圣智', '2027-04-01'], ['PR 6', '2027-04-01']]);
    const [a, b] = items().map(r => r.id);

    // ── handover gate ──
    calls.toastErr.length = 0;
    PICKED = [a]; FORM = { 'di-date': { value: today }, 'di-how': { value: 'delivered' }, 'di-photos': { files: [] }, 'di-remark': { value: '' } };
    await app.diHandover();
    eq('no photo → blocked', [calls.toastErr.pop(), items()[0].status], ['Add at least one photo as proof of handover', 'pending']);
    FORM['di-photos'] = { files: [photo('a.jpg')] }; FORM['di-date'] = { value: '' };
    await app.diHandover();
    eq('no date → blocked', [calls.toastErr.pop(), items()[0].status], ['Handover date is required', 'pending']);
    FORM['di-date'] = { value: '2999-01-01' };
    await app.diHandover();
    eq('future date → blocked', [calls.toastErr.pop(), items()[0].status], ['Handover date cannot be in the future', 'pending']);
    PICKED = []; FORM['di-date'] = { value: today };
    await app.diHandover();
    eq('nothing ticked → blocked', calls.toastErr.pop(), 'Tick the item(s) being handed over');
    eq('blocked attempts uploaded nothing', uploads.length, 0);

    // ── hand over one item ──
    PICKED = [a]; FORM['di-date'] = { value: '2026-10-10' }; FORM['di-remark'] = { value: 'received by wife' };
    await app.diHandover();
    const i1 = items().find(r => r.id === a);
    eq('item 1 delivered with date, photo and remark', [i1.status, i1.handover_date, i1.photos.length, i1.remarks], ['delivered', '2026-10-10', 1, 'received by wife']);
    eq('photo stored under delivery/<customer>/<date>/', /^delivery\/77\/2026-10-10\//.test(i1.photos[0]), true);
    eq('order NOT delivered while an item is pending', DB.purchases[0].delivery_status, 'Pending Delivery');

    // ── hand over the rest as picked up → order Delivered ──
    PICKED = [b]; FORM['di-how'] = { value: 'picked_up' }; FORM['di-photos'] = { files: [photo('b1.jpg'), photo('b2.jpg')] }; FORM['di-remark'] = { value: '' };
    await app.diHandover();
    const i2 = items().find(r => r.id === b);
    eq('item 2 picked up with 2 photos', [i2.status, i2.photos.length], ['picked_up', 2]);
    eq('every item handed over → order Delivered', DB.purchases[0].delivery_status, 'Delivered');

    // ── two items handed over together share date + photos ──
    reset();
    await app.openDeliveryItems('purchase', 1, 77);
    await app.diSplitItem(items()[0].id);
    PICKED = items().map(r => r.id); FORM = { 'di-date': { value: '2026-10-12' }, 'di-how': { value: 'delivered' }, 'di-photos': { files: [photo('x.jpg')] }, 'di-remark': { value: '' } };
    await app.diHandover();
    eq('both items handed over together, same date + photo', items().map(r => [r.status, r.handover_date, r.photos.length]), [['delivered', '2026-10-12', 1], ['delivered', '2026-10-12', 1]]);
    eq('one photo uploaded once for both', uploads.length, 1);

    // ── undo ──
    await app.diUndoHandover(items()[1].id);
    eq('undo → item pending, date cleared, photo kept', [items()[1].status, items()[1].handover_date, items()[1].photos.length], ['pending', null, 1]);
    eq('undo on a Delivered order → back to Pending Delivery', DB.purchases[0].delivery_status, 'Pending Delivery');

    // ── save failure leaves no orphan photos ──
    reset();
    await app.openDeliveryItems('purchase', 1, 77);
    const realFrom = sb.from;
    sb.from = (t) => { const q = realFrom(t); const up = q.update; q.update = (p) => { const r = up(p); r.then = (res) => Promise.resolve({ data: null, error: { message: 'boom' } }).then(res); return r; }; return q; };
    PICKED = [items()[0].id]; FORM = { 'di-date': { value: today }, 'di-how': { value: 'delivered' }, 'di-photos': { files: [photo('z.jpg')] }, 'di-remark': { value: '' } };
    await app.diHandover();
    sb.from = realFrom;
    eq('failed save removes the uploaded photo', [uploads.length, removed.length, items()[0].status], [1, 1, 'pending']);


    // ── 🤝 agent stock advances ──
    reset();
    DB.purchases[0].item = '元极大通 + 六曜指环 Support Power Ring';
    DB.purchases[0].agent_id = 6;
    await app.openDeliveryItems('purchase', 1, 77);
    await app.diSplitItem(items()[0].id);
    const [cal, ring] = items().map(r => r.id);
    await app.openDeliveryItems('purchase', 1, 77);
    let m = calls.modals[calls.modals.length - 1].content;
    eq('handover form offers "Given from" when an item can be lent', m.includes('id="di-source"'), true);
    eq('lender defaults to the sale agent', /<option value="6" selected>Agent Kim/.test(m), true);
    eq('lender list = staff L3–12 (no admin)', m.includes('>Admin<'), false);
    // a ring ticked with agent's stock → refused, nothing saved
    calls.toastErr.length = 0; uploads.length = 0;
    PICKED = [cal, ring]; FORM = { 'di-date': { value: '2026-10-15' }, 'di-how': { value: 'delivered' }, 'di-photos': { files: [photo('c.jpg')] }, 'di-remark': { value: '' }, 'di-source': { value: 'agent' }, 'di-lender': { value: '5' } };
    await app.diHandover();
    eq('ring from agent stock refused', /Only calligraphy/.test(calls.toastErr.pop() || ''), true);
    eq('refused → nothing handed over or uploaded', [items().every(r => r.status === 'pending'), uploads.length], [true, 0]);
    // calligraphy from Agent Lau's stock
    PICKED = [cal];
    await app.diHandover();
    eq('calligraphy handed over', items().find(r => r.id === cal).status, 'delivered');
    eq('advance recorded for that item, lender + date', (DB.delivery_advances || []).map(a => [a.delivery_item_id, a.lender_agent_id, a.given_date]), [[cal, 5, '2026-10-15']]);
    eq('toast mentions the advance', /from agent's stock/.test(calls.toastOk[calls.toastOk.length - 1] || ''), true);
    // office stock → no advance
    PICKED = [ring]; FORM['di-source'] = { value: 'office' };
    await app.diHandover();
    eq('office-stock handover adds no advance', (DB.delivery_advances || []).length, 1);
    // items screen shows the IOU
    DB.delivery_advances[0].status = 'owed'; DB.delivery_advances[0].expected_back = '2027-02-01';
    await app.openDeliveryItems('purchase', 1, 77);
    m = calls.modals[calls.modals.length - 1].content;
    eq("item line: from Agent Lau's stock, owed back", m.includes("🤝 From Agent Lau's stock · owed back ~1 Feb 2027"), true);
    eq('no "Agent stock" button on an item that already has one', m.includes(`app.diMarkAdvance(${cal})`), false);
    eq('no "Agent stock" button on a ring', m.includes(`app.diMarkAdvance(${ring})`), false);
    // record an earlier advance on a handed-over piece
    DB.delivery_advances = [];
    await app.openDeliveryItems('purchase', 1, 77);
    m = calls.modals[calls.modals.length - 1].content;
    eq('handed-over calligraphy without a record offers the button', m.includes(`app.diMarkAdvance(${cal})`), true);
    await app.diMarkAdvance(cal);
    FORM = { 'adv-lender': { value: '6' }, 'adv-date': { value: '2026-10-15' } };
    await app.diSaveAdvance(cal, 'purchase', 1, 77);
    eq('earlier advance saved', DB.delivery_advances.map(a => [a.delivery_item_id, a.lender_agent_id]), [[cal, 6]]);

    // advances board + returned
    DB.delivery_advances = [
        { id: 900, delivery_item_id: cal, customer_id: 77, lender_agent_id: 5, sale_agent_id: 6, item_name: '元极大通', given_date: '2026-06-01', expected_back: '2026-09-01', status: 'owed', customers: { full_name: 'Tan Ah Kow' } },
        { id: 901, delivery_item_id: 999, customer_id: 77, lender_agent_id: 6, sale_agent_id: 6, item_name: '大满福', given_date: '2026-10-01', expected_back: '2099-01-01', status: 'owed', customers: { full_name: 'Tan Ah Kow' } },
        { id: 902, delivery_item_id: 998, customer_id: 77, lender_agent_id: 5, item_name: '上龙柄', given_date: '2026-01-01', expected_back: '2026-05-01', status: 'returned', returned_date: '2026-05-03', customers: { full_name: 'Tan Ah Kow' } },
    ];
    windowStub._appState.cu = { id: 5, role: 'Level 9 Consultant', full_name: 'Agent Lau' };
    await app.openAgentAdvances('owed');
    m = calls.modals[calls.modals.length - 1].content;
    eq('board: 2 owed, 1 due now', [m.includes('<strong>2</strong> pieces owed'), m.includes('1 due now')], [true, true]);
    eq('board: late shown in days', /Due back · \d+d late/.test(m), true);
    eq('board: sale agent shown when someone else lent', m.includes('sale: Agent Kim'), true);
    eq('board: lender can tick own advance', m.includes('app.advReturn(900)'), true);
    eq("board: cannot tick someone else's", m.includes('app.advReturn(901)'), false);
    await app.openAgentAdvances('due');
    m = calls.modals[calls.modals.length - 1].content;
    eq('due tab: only the late one', [m.includes('元极大通'), m.includes('大满福')], [true, false]);
    await app.openAgentAdvances('returned');
    eq('returned tab', calls.modals[calls.modals.length - 1].content.includes('✅ Returned 3 May 2026'), true);
    FORM = { 'adv-ret-date': { value: '2026-10-16' }, 'adv-ret-photos': { files: [] }, 'adv-ret-note': { value: 'at office' }, 'adv-ret-status': { textContent: '' } };
    await app.advSaveReturn(900);
    const a900 = DB.delivery_advances.find(a => a.id === 900);
    eq('returned with date + note, by me', [a900.status, a900.returned_date, a900.note, a900.returned_by], ['returned', '2026-10-16', 'at office', 5]);
    FORM['adv-ret-date'] = { value: '' };
    calls.toastErr.length = 0;
    await app.advSaveReturn(901);
    eq('return needs a date', calls.toastErr.pop(), 'Date returned is required');
    // ── 📦 Mark delivered from a profile's DC Closing Record (2026-10-27) ──
    reset();
    await app.openDeliveryItems('purchase', 1, 77);
    eq('from the listing: Back to list', calls.modals[calls.modals.length - 1].actions[0].action, 'app.openDeliveryListing()');
    await app.openDeliveryItems('purchase', 1, 77, { from: 'profile' });
    const pm = calls.modals[calls.modals.length - 1];
    eq('from a profile: Close instead of Back to list', [pm.actions[0].label, pm.actions[0].action], ['Close', 'app.diClose()']);
    let refreshed = 0; appStub.pvRefreshClosing = () => { refreshed++; };
    calls.hidden = 0;
    app.diClose();
    eq('Close: hides and refreshes the closing record', [calls.hidden, refreshed], [1, 1]);
    await app.openDeliveryItems('purchase', 1, 77);
    app.diClose();
    eq('listing context: no profile refresh', refreshed, 1);

    windowStub._appState.cu = { id: 1, role: 'Level 1 Super Admin', full_name: 'Admin' };
    console.log(`test-delivery-items: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL crashed: ' + (e && e.stack || e)); process.exit(1); });
