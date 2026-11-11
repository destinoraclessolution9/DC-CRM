// ci/test-office-notice.js — 🏢 office "ready for collection" notices.
//
// WHY (owner 2026-11-11): the office (Agnes) sends a photo of a table — SN NO |
// group | DEALER | CUSTOMER | ITEM — when pieces are ready to collect. Our side
// collects them, tells the customer, then the customer collects (the existing
// handover). The photo must be saved, every line read, and each SN matched to
// the order waiting for delivery. Pins: SN normalising (same rule as the SQL
// office_sn_norm), the review colours / default ticks (green ours, amber name
// differs / cancelled / more pieces than the CRM, blue nothing to do or the
// lender's piece, grey not in the CRM), traditional ↔ simplified item matching,
// Confirm's picks, upload (photo saved before the read, duplicate photo
// refused), lines typed by hand, the item steps (📥 collected, 📲 told +
// WhatsApp text), and the board's furthest step per line.
//
// HARNESS: the REAL chunks/script-customers.js in a vm sandbox (pattern of
// ci/test-delivery-items.js) with an in-memory Supabase.
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
const ok = (name, cond) => eq(name, !!cond, true);
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

// ── in-memory DB ──
let DB, nextId, uploads, rpcCalls, invokes, opened, CANDS, PROMPT_VAL, CONFIRM_VAL;
const reset = () => {
    nextId = 100; uploads = []; rpcCalls = []; invokes = []; opened = []; CANDS = []; PROMPT_VAL = null; CONFIRM_VAL = true;
    DB = {
        office_notices: [], office_notice_lines: [], delivery_items: [],
        purchases: [{ id: 1, customer_id: 77, item: '财库，财托', invoice: '1908016', delivery_status: 'Pending Delivery' }],
        customers: [{ id: 77, full_name: 'Tan Soo Chi', phone: '012-345 6789' }, { id: 78, full_name: 'No Phone Person', phone: '' }],
        prospects: [],
    };
};
const match = (r, filters) => filters.every(([op, c, v]) => op === 'eq' ? String(r[c]) === String(v)
    : op === 'neq' ? String(r[c]) !== String(v) : v.map(String).includes(String(r[c])));
const sb = {
    from: (t) => {
        const filters = [];
        let mode = 'select', payload = null;
        const run = () => {
            const rows = DB[t] || (DB[t] = []);
            if (mode === 'insert') {
                const list = (Array.isArray(payload) ? payload : [payload]).map(p => ({ id: ++nextId, status: t === 'office_notices' ? 'saved' : (t === 'delivery_items' ? 'pending' : undefined), created_at: '2026-11-11T02:00:00Z', ...p }));
                rows.push(...list);
                return { data: list, error: null };
            }
            const hit = rows.filter(r => match(r, filters));
            if (mode === 'update') { hit.forEach(r => Object.assign(r, payload)); return { data: hit, error: null }; }
            if (mode === 'delete') { DB[t] = rows.filter(r => !hit.includes(r)); return { data: hit, error: null }; }
            return { data: hit.map(r => ({ ...r })), error: null };
        };
        const q = {
            select: () => q, order: () => q, limit: () => q,
            eq: (c, v) => { filters.push(['eq', c, v]); return q; },
            neq: (c, v) => { filters.push(['neq', c, v]); return q; },
            in: (c, v) => { filters.push(['in', c, v]); return q; },
            insert: (p) => { mode = 'insert'; payload = p; return q; },
            update: (p) => { mode = 'update'; payload = p; return q; },
            delete: () => { mode = 'delete'; return q; },
            then: (res, rej) => Promise.resolve(run()).then(res, rej),
        };
        return q;
    },
    rpc: async (fn, args) => {
        rpcCalls.push([fn, args]);
        if (fn === 'office_notice_candidates') return { data: CANDS, error: null };
        if (fn === 'office_notice_apply') return { data: { applied: args.p_picks.length, created: args.p_picks.filter(p => p.item_id == null).length, pushed: 1 }, error: null };
        return { data: [], error: null };
    },
    functions: { invoke: async (fn, o) => { invokes.push([fn, o.body]); return { data: { ok: true, lines: 2 }, error: null }; } },
    storage: { from: () => ({ upload: async (p) => { uploads.push(p); return { error: null }; }, remove: async () => ({ error: null }) }) },
};

let FORM = {}, PICKED = [];
const documentStub = {
    getElementById: (id) => (id in FORM ? FORM[id] : null),
    querySelectorAll: (sel) => (sel === '.ofn-pick:checked' ? PICKED.map(v => ({ value: String(v) })) : []),
    querySelector: () => null, addEventListener: () => {}, body: { appendChild() {} },
    createElement: () => ({ style: {}, appendChild() {} }),
};
const calls = { toastErr: [], toastOk: [], modals: [] };
const USERS = [{ id: 1, role: 'Level 1 Super Admin', full_name: 'Admin' }, { id: 5, role: 'Level 9 Consultant', full_name: 'Agent Lau' }];
const AppDataStore = {
    getById: async (t, id) => { const r = (DB[t] || []).find(x => String(x.id) === String(id)); return r ? { ...r } : null; },
    getByIdFull: async (t, id) => { const r = (DB[t] || []).find(x => String(x.id) === String(id)); return r ? { ...r } : null; },
    update: async (t, id, patch) => { const r = (DB[t] || []).find(x => String(x.id) === String(id)); if (r) Object.assign(r, patch); return r; },
    query: async () => [], getAll: async (t) => (t === 'users' ? USERS : []), create: async (t, r) => r,
};
const UI = {
    showModal: (title, content, actions) => calls.modals.push({ title, content, actions }), hideModal: () => {},
    toast: { success: (m) => calls.toastOk.push(m), error: (m) => calls.toastErr.push(m), info: (m) => calls.toastOk.push(m) },
    escJsAttr: (s) => String(s), currencyForCountry: () => 'MYR', countryByCode: () => ({ code: 'MY', symbol: 'RM' }),
};
const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const levelOf = (u) => { const m = /Level\s+(\d+)/i.exec(u?.role || ''); return m ? parseInt(m[1], 10) : 99; };
const waPhone = (raw) => { const d = String(raw || '').replace(/[^0-9+]/g, '').replace(/^\+/, ''); if (!d) return ''; if (d.startsWith('60')) return d; if (d.startsWith('0')) return '6' + d; return d; };
const _crmUtils = new Proxy({ escapeHtml, waPhone, getUserLevel: levelOf, isSystemAdmin: (u) => levelOf(u) === 1, isManagement: (u) => levelOf(u) <= 4, isAgent: () => true, isMobile: () => false },
    { get: (t, k) => (k in t ? t[k] : () => undefined) });
const appStub = { register(name, fns) { Object.assign(this, fns); }, navigateTo: async () => {}, compressImageFile: async (f) => f, applyMobileTableLabels: () => {} };
const windowStub = {
    _appState: { cu: { id: 1, role: 'Level 1 Super Admin', full_name: 'Admin' } }, _crmUtils, app: appStub, supabase: sb,
    _loadChunk: async () => {}, addEventListener: () => {}, location: {}, navigator: {},
    matchMedia: () => ({ matches: false }), open: (u) => { opened.push(u); },
};
const sandbox = {
    window: windowStub, document: documentStub, AppDataStore, UI, app: appStub, console,
    setTimeout: (f) => 0, clearTimeout: () => {}, confirm: () => CONFIRM_VAL, prompt: () => PROMPT_VAL,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, navigator: { userAgent: 'node' }, URL, Blob: function () {}, FileReader: function () {},
    crypto: globalThis.crypto, File: function () {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'chunks', 'script-customers.js'), 'utf8'), sandbox, { filename: 'script-customers.js' });
const app = windowStub.app;

// candidate-line builder (shape of public.office_notice_candidates)
const L = (id, sn, customer, item, orders, extra = {}) => ({ id, line_no: id, sn_raw: sn, sn_norm: app._ofnSnNorm(sn), customer, item, dealer: 'OO KEAN CHERNG', orders, ...extra });
const O = (id, customer_name, item, items, extra = {}) => ({ kind: 'purchase', id, customer_id: 77, customer_name, item, invoice: String(id), delivery_status: 'Pending Delivery', agent_name: 'Oo', items, ...extra });
const I = (id, item_name, extra = {}) => ({ id, item_name, status: 'pending', office_ready_date: null, ...extra });

(async () => {
    // ── SN normalising = public.office_sn_norm ──
    eq('SN: PR prefix dropped, spaces gone', ['PR 1936760', 'PRN19018491', 'pr1935382', 'SG 0000013', '1908016', '80783', ' 1921 314 ', '', null].map(app._ofnSnNorm),
        ['1936760', '19018491', '1935382', 'SG0000013', '1908016', '80783', '1921314', '', '']);

    // ── names: green only when clearly the same person / company ──
    eq('names', [
        ['ERIC NG WEI HAW', 'ERIC NG WEI HAw'], ['OO JIAN HANG', 'Oo Jian Hang'], ['OOI SHER LENG', 'Ooi Sher Leng 黄雪玲'],
        ['TUEN YU KIN', 'Jocelyn Tuen Yu Xin'], ['CHEN MEI LIN', 'Chen Mei Fong'], ['MANJUNG PROFESSIONAL SKIN SOLUTIONS', 'Tan Soo Chi'], ['', 'x'],
    ].map(([a, b]) => app._ofnNameMatch(a, b)), [true, true, true, false, false, false, false]);

    // ── review rows ──
    let rows = app._ofnClassify([
        L(1, '1908016', 'TAN SOO CHI', '財庫', [O(1, 'Tan Soo Chi', '财库，财托', [I(11, '财库，财托')])]),
    ]);
    eq('green: ours, waiting, names agree → ticked, lands on the item', [rows[0].tone, rows[0].pick, rows[0].selectable, rows[0].target.id], ['green', true, true, 11]);

    rows = app._ofnClassify([
        L(1, '1908016', 'MANJUNG PROFESSIONAL SKIN SOLUTIONS', '財庫', [O(1, 'Tan Soo Chi', '财库，财托', [I(11, '财库，财托')])]),
    ]);
    eq('amber: company name on the sheet vs person in the CRM → unticked, same item', [rows[0].tone, rows[0].pick, rows[0].target.id], ['amber', false, 11]);
    ok('amber note names both', /MANJUNG/.test(rows[0].note) && /Tan Soo Chi/.test(rows[0].note));

    rows = app._ofnClassify([L(1, '1908016', 'TAN SOO CHI', '財庫', [O(1, 'Tan Soo Chi', '财库，财托', [])])]);
    eq('never-opened order → a new item named after the order', [rows[0].tone, rows[0].pick, rows[0].target, rows[0].newName], ['green', true, null, '财库，财托']);

    rows = app._ofnClassify([
        L(1, '19031465', 'NATURE ACCESS TRANSPORT SDN BHD', '厚德載物', [O(5, 'Nature Access Transport Sdn Bhd', '专案', [I(51, '专案 Project Plan')])]),
        L(2, '19031465', 'NATURE ACCESS TRANSPORT SDN BHD', '積倉富', [O(5, 'Nature Access Transport Sdn Bhd', '专案', [I(51, '专案 Project Plan')])]),
    ]);
    eq('same SN twice, one CRM item: 1st takes it, 2nd = amber "add as new item"', [rows[0].target.id, rows[1].tone, rows[1].pick, rows[1].selectable, rows[1].target, rows[1].newName],
        [51, 'amber', false, true, null, '積倉富']);

    rows = app._ofnClassify([
        L(1, '1935530', 'OO KEAN CHERNG', '元亨利貞', [O(6, 'Oo Kean Cherng', 'Calligraphy', [I(61, '上龙柄'), I(62, 'Calligraphy Series: 元亨利贞')])]),
        L(2, '1935530', 'OO KEAN CHERNG', '上龍柄', [O(6, 'Oo Kean Cherng', 'Calligraphy', [I(61, '上龙柄'), I(62, 'Calligraphy Series: 元亨利贞')])]),
    ]);
    eq('traditional on the sheet matches simplified in the CRM, item by item', [rows[0].target.id, rows[1].target.id], [62, 61]);
    eq('the item choice offers the waiting items + a new item', rows[0].options.map(o => o.id), [61, 62, '']);
    rows = app._ofnClassify([L(1, '1934101', 'CML BIZ TEAM SOLUTION', '寶龍', [O(7, 'CML Biz Team Solution', '专案', [I(71, '天至喜 1'), I(72, '宝龙')])])]);
    eq('only the simplified form matches → still the right item', rows[0].target.id, 72);

    rows = app._ofnClassify([L(1, '1908016', 'TAN SOO CHI', '財庫', [O(1, 'Tan Soo Chi', '财库', [I(11, '财库', { status: 'picked_up', handover_date: '2026-10-01', adv_status: 'owed', adv_lender_name: 'Lau Mian Mian' })])])]);
    eq('customer already has an agent\'s piece → blue, ticked, goes back to the lender', [rows[0].tone, rows[0].pick, rows[0].target.id, /Lau Mian Mian/.test(rows[0].note)], ['blue', true, 11, true]);

    rows = app._ofnClassify([L(1, '19031257', 'WONG WAI YENG', '天至喜 1', [O(8, 'WONG WAI YENG', 'TIAN ZHI XI 1', [], { delivery_status: 'Delivered' })])]);
    eq('order already marked Delivered (no item rows) → blue, nothing to do', [rows[0].tone, rows[0].selectable, rows[0].pick], ['blue', false, false]);

    rows = app._ofnClassify([L(1, '1908016', 'TAN SOO CHI', '財庫', [O(1, 'Tan Soo Chi', '财库', [I(11, '财库', { status: 'delivered', handover_date: '2026-10-01' })])])]);
    eq('already handed over (no advance) → blue, nothing to do', [rows[0].tone, rows[0].selectable, /handed over/.test(rows[0].note)], ['blue', false, true]);

    rows = app._ofnClassify([L(1, '1908016', 'TAN SOO CHI', '財庫', [O(1, 'Tan Soo Chi', '财库', [I(11, '财库', { office_ready_date: '2026-11-01' })])])]);
    eq('already ready at office from an earlier sheet → blue, nothing to do', [rows[0].tone, rows[0].selectable], ['blue', false]);

    rows = app._ofnClassify([L(1, '1908016', 'TAN SOO CHI', '財庫', [O(1, 'Tan Soo Chi', '财库', [I(11, '财库')], { delivery_status: 'Cancelled' })])]);
    eq('cancelled order → amber, unticked', [rows[0].tone, rows[0].pick], ['amber', false]);

    rows = app._ofnClassify([
        L(1, '19029678', 'CHU BOON LIN', '財庫', []),
        L(2, '1908016', 'TAN SOO CHI', '財庫', [O(1, 'Tan Soo Chi', '财库', [I(11, '财库')])], { applied_at: '2026-11-11T03:00:00Z', delivery_item_id: 11, decision: 'apply' }),
        L(3, '19029679', 'X', '財庫', [], { decision: 'not_ours' }),
        L(4, '1908016', 'TAN SOO CHI', '財庫', [O(1, 'Tan Soo Chi', '财库', [I(11, '财库')])]),
    ]);
    eq('grey / done / not ours, and a confirmed item is not offered again', rows.map(r => [r.tone, r.selectable]),
        [['grey', false], ['done', false], ['grey', false], ['amber', true]]);

    // ── Confirm sends the ticked lines' picks ──
    reset();
    DB.office_notices.push({ id: 900, status: 'read', photo_path: 'office-notices/2026-11/a.jpg', title: '財庫 pls collect on 11 NOV 2026', collect_date: '2026-11-11', place: 'lvl 20', created_at: '2026-11-11T02:00:00Z' });
    CANDS = [
        L(1, '1908016', 'MANJUNG PROFESSIONAL SKIN SOLUTIONS', '財庫', [O(1, 'Tan Soo Chi', '财库，财托', [I(11, '财库，财托')])]),
        L(2, '19029678', 'CHU BOON LIN', '財庫', []),
        L(3, '1934111', 'WONG THIEN SEN', '上龍柄', [O(3, 'Wong Thien Sen', '上龙柄', [])]),
    ];
    await app.openOfficeNotice(900);
    const m = calls.modals.at(-1);
    eq('review opens with a Confirm button', m.actions.map(a => a.label), ['← Notices', 'Confirm ticked']);
    ok('summary counts', /3 lines/.test(m.content) && /⚪ 1 not in the CRM/.test(m.content));
    ok('amber row unticked, green row ticked', /value="0" +aria/.test(m.content) && /value="2" checked/.test(m.content));
    PICKED = [0, 2];
    await app.ofnConfirm();
    const apply = rpcCalls.find(c => c[0] === 'office_notice_apply');
    eq('apply picks: chosen item, and a new item for the never-opened order', apply && apply[1], {
        p_notice_id: 900, p_picks: [
            { line_id: 1, kind: 'purchase', order_id: 1, item_id: 11, item_name: null },
            { line_id: 3, kind: 'purchase', order_id: 3, item_id: null, item_name: '上龙柄' },
        ] });
    ok('confirm toast', calls.toastOk.some(t => /2 items marked ready at office \(1 new\) · 1 agent notified/.test(t)));
    PICKED = [];
    calls.toastErr.length = 0;
    await app.ofnConfirm();
    ok('nothing ticked → error, no apply', calls.toastErr.some(t => /Tick the lines/.test(t)) && rpcCalls.filter(c => c[0] === 'office_notice_apply').length === 1);

    // ── header + SN fixes + not ours ──
    await app.ofnSaveHeader('collect_date', '2026-11-12');
    await app.ofnSaveHeader('place', 'LVL 20, KL HQ');
    eq('collect date + place saved on the notice', [DB.office_notices[0].collect_date, DB.office_notices[0].place], ['2026-11-12', 'LVL 20, KL HQ']);
    DB.office_notice_lines.push({ id: 2, notice_id: 900, line_no: 2, sn_raw: '19029678', decision: null });
    PROMPT_VAL = '1908017';
    await app.ofnEditSn(2);
    eq('edit SN writes the line (the DB trigger re-normalises)', DB.office_notice_lines[0].sn_raw, '1908017');
    await app.ofnNotOurs(2, true);
    eq('not ours', DB.office_notice_lines[0].decision, 'not_ours');

    // ── lines typed by hand ──
    eq('manual parse', app._ofnParseManual('1908016 Tan Soo Chi 財庫\nPR 1921423 LIEW WEN QI\nhello\nSG 0000013 LIM 天至喜 2'), [
        { sn_raw: '1908016', customer: 'Tan Soo Chi', item: '財庫' },
        { sn_raw: 'PR 1921423', customer: 'LIEW WEN QI', item: null },
        { sn_raw: 'SG 0000013', customer: 'LIM', item: '天至喜 2' },
    ]);
    FORM['ofn-manual'] = { value: '1908016 Tan Soo Chi 財庫' };
    await app.ofnAddManual();
    const added = DB.office_notice_lines.filter(l => l.notice_id === 900 && l.sn_raw === '1908016');
    eq('manual line numbered after the read lines', added.map(l => [l.line_no, l.customer, l.item]), [[4, 'Tan Soo Chi', '財庫']]);

    // ── upload: saved first, then read; duplicate refused ──
    reset();
    CANDS = [];
    const bytes = new TextEncoder().encode('fake-jpeg-bytes');
    const file = { name: 'IMG_1.jpg', type: 'image/jpeg', size: bytes.length, arrayBuffer: async () => bytes.buffer };
    await app.ofnUpload({ files: [file] });
    eq('photo uploaded under office-notices/', uploads.length === 1 && /^office-notices\/\d{4}-\d{2}\/\d+_0\.jpg$/.test(uploads[0]), true);
    eq('notice row saved with the photo + its hash', [DB.office_notices.length, DB.office_notices[0].photo_path === uploads[0], /^[0-9a-f]{64}$/.test(DB.office_notices[0].photo_hash)], [1, true, true]);
    eq('then the reader is asked for that notice', invokes, [['office-notice-ocr', { notice_id: DB.office_notices[0].id }]]);
    ok('and the review opens', calls.modals.at(-1).title === '🏢 Office notice');
    await app.ofnUpload({ files: [file] });
    eq('same photo again → not uploaded twice', [uploads.length, DB.office_notices.length, invokes.length], [1, 1, 1]);
    ok('told it was already uploaded', calls.toastOk.some(t => /already uploaded/.test(t)));

    // ── item steps ──
    reset();
    DB.delivery_items.push(
        { id: 11, customer_id: 77, purchase_id: 1, item_name: '财库', status: 'pending', photos: [], office_ready_date: '2026-11-11', office_ready_place: 'lvl 20', office_notice_id: 900 },
        { id: 12, customer_id: 77, purchase_id: 1, item_name: 'PR 6', status: 'pending', photos: [] },
    );
    DB.office_notices.push({ id: 900, photo_path: 'office-notices/2026-11/a.jpg', place: 'lvl 20' });
    await app.openDeliveryItems('purchase', 1, 77);
    let html = calls.modals.at(-1).content;
    ok('pending items show 📥 Collected + 📲 Tell customer', (html.match(/📥 Collected<\/button>/g) || []).length === 2 && (html.match(/📲 Tell customer<\/button>/g) || []).length === 2);
    ok('ready-at-office line with the photo link', /🏢 Ready at office · 11 Nov 2026 · lvl 20/.test(html) && /office-notices\/2026-11\/a\.jpg/.test(html));
    await app.diMarkCollected(11);
    eq('collected = today, by me', [DB.delivery_items[0].collected_at, DB.delivery_items[0].collected_by, DB.delivery_items[0].status], [today, 1, 'pending']);
    app.diTellCustomer(11);
    await new Promise(r => setImmediate(r));
    eq('WhatsApp opens to the customer', opened.length === 1 && opened[0].startsWith('https://wa.me/60123456789?text='), true);
    const text = decodeURIComponent(opened[0].split('?text=')[1]);
    ok('message in Chinese + English, names the ready piece only', /您好 Tan Soo Chi，您的 财库 已经准备好了/.test(text) && /your 财库 is ready for collection/.test(text) && !/PR 6/.test(text));
    eq('told is stamped on the ready piece, not the one still in production', [!!DB.delivery_items[0].customer_told_at, DB.delivery_items[0].customer_told_by, DB.delivery_items[1].customer_told_at], [true, 1, undefined]);
    CONFIRM_VAL = true;
    await app.diUndoTold(11);
    await app.diUndoCollected(11);
    eq('undo both steps', [DB.delivery_items[0].customer_told_at, DB.delivery_items[0].collected_at], [null, null]);

    // no phone → confirm, mark only, no WhatsApp
    reset();
    DB.purchases.push({ id: 2, customer_id: 78, item: '上龙柄', invoice: '1', delivery_status: 'Pending Delivery' });
    DB.delivery_items.push({ id: 21, customer_id: 78, purchase_id: 2, item_name: '上龙柄', status: 'pending', photos: [] });
    await app.openDeliveryItems('purchase', 2, 78);
    app.diTellCustomer(21);
    await new Promise(r => setImmediate(r));
    eq('no phone → marked told, no WhatsApp', [opened.length, !!DB.delivery_items[0].customer_told_at], [0, true]);

    // ── board step per line ──
    eq('furthest step of the pending items', [
        app._diLineStage([{ status: 'pending' }], false).stage,
        app._diLineStage([{ status: 'pending', office_ready_date: '2026-11-11', office_ready_place: 'lvl 20' }, { status: 'pending' }], false),
        app._diLineStage([{ status: 'pending', office_ready_date: '2026-11-11', collected_at: '2026-11-11' }, { status: 'pending', customer_told_at: 'x', collected_at: 'y', office_ready_date: 'z' }], false).stage,
        app._diLineStage([{ status: 'delivered' }], false).stage,
        app._diLineStage([], true).stage,
    ], ['production', { stage: 'office', counts: { office: 1, collected: 0, told: 0 }, office: '2026-11-11', place: 'lvl 20', pending: 2 }, 'told', 'done', 'done']);
    eq('message for several pieces', app._diTellText('Ali', ['上龙柄', '财库']).split('\n')[2], 'Hi Ali, your 上龙柄, 财库 are ready for collection 🎉 When is a good time for you to collect?');

    console.log(`test-office-notice: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
