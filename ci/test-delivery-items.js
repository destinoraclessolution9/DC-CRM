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
const match = (r, filters) => filters.every(([op, c, v]) => op === 'eq' ? String(r[c]) === String(v)
    : op === 'is' ? (r[c] ?? null) === v : v.map(String).includes(String(r[c])));
// 📦 My stock (2026-11-12): what the stock RPCs answer
let STOCK_COUNTS = {}, STOCK_ROWS = [], rpcCalls = [];
const STOCK_PRODUCTS = [
    { id: 41, name: '元极大通 Yuan Ji Da Tong', subcategory: 'Calligraphy Adornment' },
    { id: 42, name: '大满福 Da Man Fu', subcategory: 'Calligraphy Adornment' },
    { id: 51, name: '财库 Cai Ku', subcategory: 'Royal Woodwork Series' },
];
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
            is: (c, v) => { filters.push(['is', c, v]); return q; },
            insert: (p) => { mode = 'insert'; payload = p; return q; },
            update: (p) => { mode = 'update'; payload = p; return q; },
            delete: () => { mode = 'delete'; return q; },
            then: (res, rej) => Promise.resolve(run()).then(res, rej),
        };
        return q;
    },
    rpc: async (fn, args) => {
        rpcCalls.push([fn, args]);
        if (fn === 'agent_stock_counts') return { data: STOCK_COUNTS[args.p_item] || [], error: null };
        if (fn === 'agent_stock_products') return { data: STOCK_PRODUCTS, error: null };
        if (fn === 'agent_stock_balance') return { data: STOCK_ROWS.filter(r => args.p_agent == null || r.agent_id === args.p_agent), error: null };
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

const calls = { toastErr: [], toastOk: [], toastWarn: [], modals: [], statusSet: [] };
const AppDataStore = {
    getById: async (t, id) => { const r = (DB[t] || []).find(x => String(x.id) === String(id)); return r ? { ...r } : null; },
    getByIdFull: async (t, id) => { const r = (DB[t] || []).find(x => String(x.id) === String(id)); return r ? { ...r } : null; },
    update: async (t, id, patch) => { const r = (DB[t] || []).find(x => String(x.id) === String(id)); if (r) Object.assign(r, patch); if (t === 'purchases' && patch.delivery_status) calls.statusSet.push(patch.delivery_status); return r; },
    query: async () => [], getAll: async (t) => (t === 'users' ? USERS : []), create: async (t, r) => r,
};
const UI = {
    showModal: (title, content, actions) => calls.modals.push({ title, content, actions }), hideModal: () => { calls.hidden = (calls.hidden || 0) + 1; },
    toast: { success: (m) => calls.toastOk.push(m), error: (m) => calls.toastErr.push(m), info: () => {}, warning: (m) => calls.toastWarn.push(m) },
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
    eq('lender list includes the owner / Level 1–2 (2026-11-12)', m.includes('<option value="1" >Admin (0 in hand)</option>'), true);
    eq('one lendable piece: every name shows its count (admin: missing = 0)', [m.includes('>Agent Lau (0 in hand)<'), m.includes('Agent Kim (0 in hand)<')], [true, true]);
    eq('counts asked once for the lendable piece only', rpcCalls.filter(c => c[0] === 'agent_stock_counts').map(c => c[1].p_item).slice(-1), ['元极大通']);
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
    eq("lent with 0 in Lau's list → warning to add it", calls.toastWarn.pop(), "Not in Agent Lau's stock list — add it in 🤝 Agent stock → 📦 My stock");
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
    // ── ↩ Returned from a Name List row (2026-11-12): back to the list, not the board ──
    DB.delivery_advances.push({ id: 903, delivery_item_id: 997, customer_id: 77, lender_agent_id: 5, item_name: '福', given_date: '2026-09-01', expected_back: '2026-10-01', status: 'owed', customers: { full_name: 'Tan Ah Kow' } });
    app.advReturn(903, { from: 'namelist' });
    eq('from a name list: Cancel just closes', calls.modals[calls.modals.length - 1].actions[0].action, 'UI.hideModal()');
    let nlBackAdv = 0; appStub.nlpPiecesClosed = () => { nlBackAdv++; };
    const modalsBefore = calls.modals.length;
    FORM['adv-ret-date'] = { value: '2026-10-20' };
    calls.hidden = 0;
    await app.advSaveReturn(903);
    eq('saved from a name list: list refreshed, board not opened', [DB.delivery_advances.find(a => a.id === 903).status, nlBackAdv, calls.hidden, calls.modals.length], ['returned', 1, 1, modalsBefore]);
    app.advReturn(901);
    eq('from the board: Cancel goes back to the board', calls.modals[calls.modals.length - 1].actions[0].action, 'app.openAgentAdvances()');
    // ── 📦 My stock (2026-11-12) ──
    const LAU = { id: 5, role: 'Level 9 Consultant', full_name: 'Agent Lau' };
    const ADMIN = { id: 1, role: 'Level 1 Super Admin', full_name: 'Admin' };
    // handover form counts, as an agent: own missing = 0, others only when known
    reset();
    DB.purchases[0].item = '元极大通 + 六曜指环 Support Power Ring';
    DB.purchases[0].agent_id = 5;
    windowStub._appState.cu = LAU;
    STOCK_COUNTS = { '元极大通': [{ agent_id: 6, in_hand: 3 }] };
    await app.openDeliveryItems('purchase', 1, 77);
    await app.diSplitItem(items()[0].id);
    const [cal2] = items().map(r => r.id);
    await app.openDeliveryItems('purchase', 1, 77);
    m = calls.modals[calls.modals.length - 1].content;
    eq('agent view: own 0, team count shown, unknown left blank', [m.includes('>Agent Lau (0 in hand)<'), m.includes('>Agent Kim (3 in hand)<'), m.includes('>Admin<')], [true, true, true]);
    // from Kim's stock (3 in hand) → no warning
    calls.toastWarn.length = 0;
    PICKED = [cal2]; FORM = { 'di-date': { value: '2026-11-10' }, 'di-how': { value: 'delivered' }, 'di-photos': { files: [photo('k.jpg')] }, 'di-remark': { value: '' }, 'di-source': { value: 'agent' }, 'di-lender': { value: '6' } };
    await app.diHandover();
    eq('lent from a list that has it → no warning', [DB.delivery_advances.length, calls.toastWarn.length], [1, 0]);
    // unknown count (admin's, seen by an agent) → no warning either
    DB.delivery_advances = [];
    await app.openDeliveryItems('purchase', 1, 77);
    m = calls.modals[calls.modals.length - 1].content;
    eq("the handed-over piece offers 🤝 Agent's stock again", m.includes(`app.diMarkAdvance(${cal2})`), true);
    await app.diMarkAdvance(cal2);
    m = calls.modals[calls.modals.length - 1].content;
    eq('earlier-advance form shows counts too', m.includes('>Agent Kim (3 in hand)<'), true);
    FORM = { 'adv-lender': { value: '1' }, 'adv-date': { value: '2026-11-10' } };
    await app.diSaveAdvance(cal2, 'purchase', 1, 77);
    eq('unknown count (someone outside my team) → no warning', [DB.delivery_advances.length, calls.toastWarn.length], [1, 0]);
    DB.delivery_advances = [];
    await app.openDeliveryItems('purchase', 1, 77);
    await app.diMarkAdvance(cal2);
    FORM = { 'adv-lender': { value: '5' }, 'adv-date': { value: '2026-11-10' } };
    await app.diSaveAdvance(cal2, 'purchase', 1, 77);
    eq('my own 0 → warning', calls.toastWarn.pop(), "Not in Agent Lau's stock list — add it in 🤝 Agent stock → 📦 My stock");
    // two lendable pieces (two products) → names only
    reset();
    DB.purchases[0].item = '元极大通 + 大满福';
    await app.openDeliveryItems('purchase', 1, 77);
    await app.diSplitItem(items()[0].id);
    await app.openDeliveryItems('purchase', 1, 77);
    m = calls.modals[calls.modals.length - 1].content;
    eq('two lendable pieces → no counts in the list', [m.includes('id="di-source"'), m.includes('in hand)')], [true, false]);

    // board: 📦 My stock tab, as the agent
    STOCK_ROWS = [
        { agent_id: 5, product_id: 41, item_name: '元极大通 Yuan Ji Da Tong', subcategory: 'Calligraphy Adornment', in_hand: 2, lent_out: 1, owned: 3, next_back: '2027-02-01', last_date: '2026-11-10', last_kind: 'lent', last_qty: -1 },
        { agent_id: 5, product_id: null, item_name: '宝王象', subcategory: null, in_hand: -1, lent_out: 1, owned: 0, next_back: null, last_date: '2026-11-11', last_kind: 'lent', last_qty: -1 },
        { agent_id: 5, product_id: 51, item_name: '财库 Cai Ku', subcategory: 'Royal Woodwork Series', in_hand: 0, lent_out: 0, owned: 0, next_back: null, last_date: '2026-11-01', last_kind: 'adjust', last_qty: -1 },
    ];
    DB.delivery_advances = [];
    windowStub._appState.cu = LAU;
    await app.openAgentAdvances('stock');
    let bm = calls.modals[calls.modals.length - 1];
    m = bm.content;
    eq('board title + My stock tab first and active', [bm.title, m.includes(`btn-sm primary" onclick="app.openAgentAdvances('stock')">📦 My stock</button>`), m.indexOf("openAgentAdvances('stock')") < m.indexOf("openAgentAdvances('owed')")], ['🤝 Agent stock', true, true]);
    eq('agent: own rows only → no Agent column, no Everyone filter', [m.includes('<th scope="col">Agent</th>'), m.includes('Everyone')], [false, false]);
    eq('in hand 2 bold; lent 1 owed back ~date', [m.includes('<td data-label="In hand"><strong>2</strong>'), m.includes('owed back ~1 Feb 2027')], [true, true]);
    eq('below zero: red with "not entered", item not in the product list', [m.includes('>−1</strong>'), m.includes('not entered — ➕ add it'), m.includes('not in the product list')], [true, true, true]);
    eq('last change: date · kind · qty', m.includes('10 Nov 2026 · 🤝 Given to a customer −1'), true);
    eq('Take out only where something is in hand', [m.includes("app.advStockTakeOut(5, 41, '元极大通 Yuan Ji Da Tong')"), m.includes('app.advStockTakeOut(5, null'), m.includes('app.advStockTakeOut(5, 51')], [true, false, false]);
    eq('➕ and History on every own row', [m.includes("app.advStockAdd(5, null, '宝王象')"), m.includes("app.advStockHistory(5, 51, '财库 Cai Ku')")], [true, true]);
    eq('stock footnote', m.includes('goes down by itself'), true);
    eq('RPC asked for everyone visible (no admin filter)', rpcCalls.filter(c => c[0] === 'agent_stock_balance').pop()[1], { p_agent: null });
    // upline sees a team member's row: Agent column, no edit buttons on it
    STOCK_ROWS.push({ agent_id: 6, product_id: 42, item_name: '大满福 Da Man Fu', subcategory: 'Calligraphy Adornment', in_hand: 1, lent_out: 0, owned: 1, next_back: null, last_date: '2026-11-05', last_kind: 'added', last_qty: 1 });
    await app.openAgentAdvances('stock');
    m = calls.modals[calls.modals.length - 1].content;
    eq("team row: Agent column; History only on someone else's row", [m.includes('<th scope="col">Agent</th>'), m.includes('>Agent Kim</strong>'), m.includes('app.advStockAdd(6,'), m.includes('app.advStockTakeOut(6,'), m.includes('app.advStockHistory(6, 42')], [true, true, false, false, true]);
    // empty
    const keepRows = STOCK_ROWS; STOCK_ROWS = [];
    await app.openAgentAdvances('stock');
    eq('empty: how to start', calls.modals[calls.modals.length - 1].content.includes('No stock entered yet'), true);
    STOCK_ROWS = keepRows;

    // ➕ Add stock as the agent
    await app.advStockAdd();
    m = calls.modals[calls.modals.length - 1].content;
    eq('add form: product groups, own name, no agent picker', [m.includes('<optgroup label="Calligraphy">'), m.includes('<optgroup label="财库 / 财托">'), m.includes('id="adv-st-agent"'), m.includes('>Agent Lau</div>')], [true, true, false, true]);
    const addForm = (o) => { FORM = { 'adv-st-product': { value: '41' }, 'adv-st-qty': { value: '2' }, 'adv-st-date': { value: '2026-11-01' }, 'adv-st-note': { value: '' }, ...o }; };
    const tryAdd = async (o) => { calls.toastErr.length = 0; addForm(o); await app.advStockSave(); return calls.toastErr.pop(); };
    DB.agent_stock_moves = [];
    eq('add: product required', await tryAdd({ 'adv-st-product': { value: '' } }), 'Pick the product');
    eq('add: 0 refused', await tryAdd({ 'adv-st-qty': { value: '0' } }), 'How many: a whole number from 1 to 999');
    eq('add: 1.5 refused', await tryAdd({ 'adv-st-qty': { value: '1.5' } }), 'How many: a whole number from 1 to 999');
    eq('add: 1000 refused', await tryAdd({ 'adv-st-qty': { value: '1000' } }), 'How many: a whole number from 1 to 999');
    eq('add: date required', await tryAdd({ 'adv-st-date': { value: '' } }), 'Date is required');
    eq('add: no future date', await tryAdd({ 'adv-st-date': { value: '2999-01-01' } }), 'Date cannot be in the future');
    eq('nothing saved while refused', DB.agent_stock_moves.length, 0);
    await tryAdd({ 'adv-st-note': { value: ' 11.11 promo ' } });
    eq('added: own id, product, name, qty, date, note', DB.agent_stock_moves.map(r => [r.agent_id, r.product_id, r.item_name, r.qty, r.kind, r.move_date, r.note]),
        [[5, 41, '元极大通 Yuan Ji Da Tong', 2, 'added', '2026-11-01', '11.11 promo']]);
    eq('added: toast + back on the stock tab', [calls.toastOk.pop(), calls.modals[calls.modals.length - 1].title], ['Added 2 × 元极大通 Yuan Ji Da Tong', '🤝 Agent stock']);
    // ➕ on a piece that is not in the product list → that name, no product
    await app.advStockAdd(5, null, '宝王象');
    m = calls.modals[calls.modals.length - 1].content;
    eq('add for a name: fixed name, no product list', [m.includes('>宝王象</div>'), m.includes('id="adv-st-product"')], [true, false]);
    await tryAdd({ 'adv-st-product': { value: '' }, 'adv-st-qty': { value: '1' } });
    eq('added by name', DB.agent_stock_moves.slice(-1).map(r => [r.product_id, r.item_name, r.qty]), [[null, '宝王象', 1]]);
    // an agent can't add to someone else's
    calls.toastErr.length = 0;
    await app.advStockAdd(6, 42, '大满福 Da Man Fu');
    eq("agent: not someone else's stock", calls.toastErr.pop(), 'You can only add to your own stock');

    // ➖ Take out
    await app.openAgentAdvances('stock');
    app.advStockTakeOut(5, 41, '元极大通 Yuan Ji Da Tong');
    bm = calls.modals[calls.modals.length - 1];
    eq('take-out form shows what is in hand', [bm.title, bm.content.includes('· 2 in hand'), bm.content.includes('max="2"')], ['➖ Take out of stock', true, true]);
    const tryOut = async (o) => { calls.toastErr.length = 0; FORM = { 'adv-out-qty': { value: '1' }, 'adv-out-why': { value: 'Damaged' }, 'adv-out-note': { value: '' }, ...o }; await app.advStockSaveOut(); return calls.toastErr.pop(); };
    const before = DB.agent_stock_moves.length;
    eq('take out: more than in hand refused', await tryOut({ 'adv-out-qty': { value: '3' } }), 'Only 2 in hand');
    eq('take out: Other needs a note', await tryOut({ 'adv-out-why': { value: 'Other' } }), 'Add a note for "Other"');
    eq('take out: 0 refused', await tryOut({ 'adv-out-qty': { value: '0' } }), 'How many: a whole number, at least 1');
    eq('nothing saved while refused (take out)', DB.agent_stock_moves.length, before);
    await tryOut({ 'adv-out-note': { value: 'frame cracked' } });
    eq('taken out: −1 adjust with the reason', DB.agent_stock_moves.slice(-1).map(r => [r.agent_id, r.product_id, r.qty, r.kind, r.note]), [[5, 41, -1, 'adjust', 'Damaged · frame cracked']]);
    calls.toastErr.length = 0;
    app.advStockTakeOut(5, 51, '财库 Cai Ku');
    eq('nothing in hand → nothing to take out', calls.toastErr.pop(), 'Nothing in hand to take out');

    // History + remove a typed line
    DB.agent_stock_moves = [
        { id: 701, agent_id: 5, product_id: 41, item_name: '元极大通 Yuan Ji Da Tong', qty: 3, kind: 'added', move_date: '2026-10-01', created_by: 5 },
        { id: 702, agent_id: 5, product_id: 41, item_name: '元极大通 Yuan Ji Da Tong', qty: -1, kind: 'lent', move_date: '2026-11-10', note: 'given to Tan Ah Kow', advance_id: 9, created_by: 6 },
        { id: 703, agent_id: 5, product_id: 41, item_name: '元极大通 Yuan Ji Da Tong', qty: 1, kind: 'added', move_date: '2026-11-11', created_by: 1 },
        { id: 704, agent_id: 5, product_id: null, item_name: '宝王象', qty: -1, kind: 'lent', move_date: '2026-11-11', created_by: 6 },
    ];
    await app.advStockHistory(5, 41, '元极大通 Yuan Ji Da Tong');
    bm = calls.modals[calls.modals.length - 1];
    eq('history: that product only', [bm.title, bm.content.includes('宝王象'), (bm.content.match(/<tr>/g) || []).length], ['📦 元极大通 Yuan Ji Da Tong', false, 3 + 1]);
    eq('history lines: kind, signed qty, note, who', [bm.content.includes('🤝 Given to a customer'), bm.content.includes('>+3<'), bm.content.includes('>−1<'), bm.content.includes('given to Tan Ah Kow'), bm.content.includes('<td data-label="By">Agent Kim</td>')], [true, true, true, true, true]);
    eq("✕ only on lines I typed (not lent lines, not admin's)", [bm.content.includes('advStockDeleteMove(701,'), bm.content.includes('advStockDeleteMove(702,'), bm.content.includes('advStockDeleteMove(703,')], [true, false, false]);
    await app.advStockHistory(5, null, '宝王象');
    eq('history by name for a piece not in the list', (calls.modals[calls.modals.length - 1].content.match(/<tr>/g) || []).length, 1 + 1);
    await app.advStockDeleteMove(701, 5, 41, '元极大通 Yuan Ji Da Tong');
    eq('typed line removed, history reopened', [DB.agent_stock_moves.some(r => r.id === 701), calls.toastOk.pop(), calls.modals[calls.modals.length - 1].title], [false, 'Removed', '📦 元极大通 Yuan Ji Da Tong']);

    // admin: Everyone filter, totals, add for an agent
    windowStub._appState.cu = ADMIN;
    STOCK_ROWS.push({ agent_id: 6, product_id: 41, item_name: '元极大通 Yuan Ji Da Tong', subcategory: 'Calligraphy Adornment', in_hand: 4, lent_out: 0, owned: 4, next_back: null, last_date: '2026-11-05', last_kind: 'added', last_qty: 4 });
    await app.openAgentAdvances('stock');
    m = calls.modals[calls.modals.length - 1].content;
    eq('admin: Everyone filter + totals per product', [m.includes('<option value="">Everyone</option>'), m.includes('All agents'), m.includes('By agent')], [true, true, true]);
    eq('admin totals: 元极大通 2 + 4 = 6 in hand, lent 1, 2 agents holding',
        /<td data-label="Product">元极大通 Yuan Ji Da Tong<\/td><td data-label="In hand"><strong>6<\/strong><\/td>\s*<td data-label="Lent to customers">1<\/td><td data-label="Agents holding">2 agents holding<\/td>/.test(m), true);
    eq('admin can change every row', [m.includes('app.advStockTakeOut(6, 41'), m.includes('app.advStockAdd(6, 42')], [true, true]);
    await app.advStockFilter('6');
    m = calls.modals[calls.modals.length - 1].content;
    eq('admin filter: one agent, no totals', [rpcCalls.filter(c => c[0] === 'agent_stock_balance').pop()[1].p_agent, m.includes('All agents'), m.includes('<option value="6" selected>Agent Kim</option>')], [6, false, true]);
    await app.advStockAdd();
    m = calls.modals[calls.modals.length - 1].content;
    eq('admin add: whose-stock picker, defaults to the filtered agent', [m.includes('id="adv-st-agent"'), m.includes('<option value="6" selected>Agent Kim</option>')], [true, true]);
    DB.agent_stock_moves = [];
    addForm({ 'adv-st-agent': { value: '6' }, 'adv-st-product': { value: '51' }, 'adv-st-qty': { value: '1' } });
    await app.advStockSave();
    eq('admin added for Kim', DB.agent_stock_moves.map(r => [r.agent_id, r.product_id, r.item_name]), [[6, 51, '财库 Cai Ku']]);
    await app.advStockFilter('');
    STOCK_ROWS = [];

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
    // ── 📦 Pieces from a Name List row (2026-11-12) ──
    await app.openDeliveryItems('purchase', 1, 77, { from: 'namelist' });
    const nm = calls.modals[calls.modals.length - 1];
    eq('from a name list: Close instead of Back to list', [nm.actions[0].label, nm.actions[0].action], ['Close', 'app.diClose()']);
    let nlBack = 0; appStub.nlpPiecesClosed = () => { nlBack++; };
    calls.hidden = 0;
    app.diClose();
    eq('Close: hides and refreshes the name list (not the closing record)', [calls.hidden, nlBack, refreshed], [1, 1, 1]);

    windowStub._appState.cu = { id: 1, role: 'Level 1 Super Admin', full_name: 'Admin' };
    console.log(`test-delivery-items: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL crashed: ' + (e && e.stack || e)); process.exit(1); });
