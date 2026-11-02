// ci/test-closing-per-appointment.js — one closing form per appointment (owner 2026-11-02).
//
// WHY: a prospect has ONE closing slot (prospects.closing_record) but can buy at
// several appointments. The Meeting Outcome form loaded that slot for ANY
// appointment, plus every order-form photo the person ever had, so a new closing
// opened full of the old sale. While the old sale waited for approval the new one
// could not be recorded at all: Save showed green and nothing reached the manager.
// This pins:
//   1. FORM    — a new appointment opens blank, with only its own photos.
//   2. SALES   — an appointment with a finished sale shows it read-only, and
//                "Record another sale" gives a clean form.
//   3. QUEUE   — a second sale goes to the approval queue and leaves the first alone.
//   4. APPROVE — each sale is booked exactly once, in any order, and reject /
//                Order Date touch only the sale they were pressed on.
//
// HARNESS: loads the REAL data-helpers.js, activities + calendar + approvals chunks
// in one vm sandbox with a stubbed DOM and in-memory tables.
// Run: node ci/test-closing-per-appointment.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const eq = (name, got, want = true) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.error(`FAIL ${name}\n     got:  ${g}\n     want: ${w}`);
};
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const helpers = require(path.join(__dirname, '..', 'data-helpers.js'));

// ── 0. Pure rules ───────────────────────────────────────────────────────────
{
    const { isSameSale, closingBelongsToActivity: mine, closingSaveRoute: route, meetingOutcomeView: view } = helpers;
    const sub = { status: 'submitted', product: 'Ring', sale_amount: '5000', invoice_number: 'PR1', closing_activity_id: 10 };

    eq('same sale: "5000" = 5000, case and spaces ignored', isSameSale({ sale_amount: '5000', invoice_number: ' pr1', product: 'RING' }, sub));
    eq('same sale: different invoice is another sale', isSameSale({ ...sub, invoice_number: 'PR2' }, sub), false);
    eq('same sale: different amount is another sale', isSameSale({ ...sub, sale_amount: 5001 }, sub), false);
    eq('same sale: a copy without product still matches', isSameSale({ sale_amount: 5000, invoice_number: 'PR1' }, sub));
    eq('same sale: empty never matches', isSameSale(null, sub), false);

    eq('belongs: by appointment id', mine(sub, { id: 10 }));
    eq('belongs: id "10" = 10', mine(sub, { id: '10' }));
    eq('belongs: another appointment', mine(sub, { id: 11 }), false);
    const old = { status: 'submitted', product: 'Ring', sale_amount: 5000, invoice_number: 'PR1' };
    eq('belongs: old closing, activity carries the sale', mine(old, { id: 1, is_closing: true, amount_closed: 5000 }));
    eq('belongs: old closing, plain meeting', mine(old, { id: 1 }), false);
    eq('belongs: old closing, closed with another amount', mine(old, { id: 1, is_closing: true, amount_closed: 999 }), false);

    eq('route: empty slot', route(null, { id: 1 }), 'slot');
    eq('route: slot with no sale (only pre-2025 data)', route({ pre2025_purchases: [1] }, { id: 1 }), 'slot');
    eq('route: own draft', route({ ...sub, status: 'draft' }, { id: 10 }), 'slot');
    eq('route: another appointment locked', route(sub, { id: 11 }), 'queue');
    eq('route: another appointment draft', route({ ...sub, status: 'draft' }, { id: 11 }), 'queue');
    eq('route: another draft, continued here', route({ ...sub, status: 'draft' }, { id: 11 }, { continueDraft: true }), 'slot');
    eq('route: own locked sale from a stale form', route(sub, { id: 10 }), 'locked');
    eq('route: own locked sale, Record another sale', route(sub, { id: 10 }, { newSale: true }), 'queue');

    const a = { id: 11, prospect_id: 1 };
    eq('view: other appointment locked = blank + notice', [view({ activity: a, slot: sub }).mode, view({ activity: a, slot: sub }).closingRecord, !!view({ activity: a, slot: sub }).earlierSale], ['form', {}, true]);
    eq('view: own locked = read-only', view({ activity: { id: 10 }, slot: sub }).mode, 'sales');
    eq('view: own draft = editable', view({ activity: { id: 10 }, slot: { ...sub, status: 'draft' } }).mode, 'form');
    eq('view: approved sale from history = read-only', view({ activity: { id: 10 }, slot: null, history: [{ ...sub, status: 'approved' }] }).mode, 'sales');
    eq('view: newSale wins over read-only', view({ activity: { id: 10 }, slot: sub, newSale: true }).closingRecord, {});
    eq('view: unfinished draft elsewhere is offered, never prefilled', [view({ activity: a, slot: { ...sub, status: 'draft' } }).closingRecord, view({ activity: a, slot: { ...sub, status: 'draft' } }).earlierSale.status], [{}, 'draft']);

    // Approved in the queue but the record never left 'submitted' (live: LIM CHONG HENG,
    // 2026-10-27): shown as approved, on its own appointment and as the earlier sale.
    const doneRow = { approval_type: 'new_sale', status: 'approved', snapshot_after: { ...sub, sale_amount: 5000 } };
    eq('view: approved row beats a stuck "submitted"', view({ activity: { id: 10 }, slot: sub, queueRows: [doneRow] }).sales.map(s => s.sale_state), ['approved']);
    eq('view: stuck record reads approved on a new appointment', view({ activity: a, slot: sub, queueRows: [doneRow] }).earlierSale.status, 'approved');
    eq('view: approved row of ANOTHER sale changes nothing', view({ activity: a, slot: sub, queueRows: [{ ...doneRow, snapshot_after: { ...sub, invoice_number: 'PR9' } }] }).earlierSale.status, 'submitted');

    // Queue rows: the last row decides "rejected"; a resubmitted sale clears it.
    const row = (status, at, extra = {}) => ({ approval_type: 'new_sale', status, submitted_at: at, reject_reason: 'wrong amount', snapshot_after: { product: 'Book', sale_amount: 100, invoice_number: 'B1', closing_activity_id: 11, ...extra } });
    eq('view: pending row on this appointment = read-only', view({ activity: a, queueRows: [row('pending', '1')] }).sales.map(s => s.sale_state), ['pending']);
    eq('view: rejected row shows why', view({ activity: a, queueRows: [row('rejected', '1')] }).rejected.reject_reason, 'wrong amount');
    eq('view: rejected then resubmitted = not rejected', view({ activity: a, queueRows: [row('rejected', '1'), row('pending', '2', { sale_amount: 120 })] }).rejected, null);
    eq('view: slot and its own queue row are one sale', view({ activity: { id: 10 }, slot: sub, queueRows: [{ approval_type: 'new_sale', status: 'pending', snapshot_after: { ...sub, sale_amount: 5000 } }] }).sales.length, 1);
}

// ── Harness ─────────────────────────────────────────────────────────────────
const fields = new Map();
const field = (id, props) => fields.set(id, { id, value: '', dataset: {}, style: {}, focus() {}, scrollIntoView() {}, addEventListener() {}, removeEventListener() {}, ...props });
const thumbs = () => fields.get('mo-order-form-thumbs');
const mkThumb = (attrs) => ({ getAttribute: (k) => (k in attrs ? attrs[k] : null) });

const document = {
    getElementById: (id) => fields.get(id) || null,
    createElement: () => ({
        style: {}, attrs: {}, innerHTML: '',
        setAttribute(k, v) { this.attrs[k] = v; },
        getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    }),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, body: { appendChild() {} },
};

const toasts = [];
let modal = null;
let hidden = 0;
const booked = [];
let rpcCalls = [];
let queueWriteFails = false;

const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const levelOf = (u) => { const m = /Level\s*(\d+)/i.exec((u && u.role) || ''); return m ? +m[1] : 99; };

const UI = new Proxy({
    toast: { success: (m) => toasts.push(['ok', m]), error: (m) => toasts.push(['err', m]), info: (m) => toasts.push(['info', m]), warning: (m) => toasts.push(['warn', m]) },
    showModal: (title, html, buttons) => { modal = { title, html, buttons }; },
    hideModal: () => { hidden++; modal = null; },
    formatCurrency: (n) => `RM ${n}`, paymentMethodLabel: (m) => m || '', paymentMethodOptionsHtml: () => '',
    productOptionsHtml: () => '<option>Ring</option>', eppFieldsHtml: () => '', escJsAttr: (s) => s,
    purchasePaymentTerms: () => ({}), countryByCode: () => ({ code: 'MY' }), currencyForCountry: () => 'MYR',
}, { get: (t, k) => (k in t ? t[k] : () => '') });

let DB, nextId;
const table = (t) => (DB[t] = DB[t] || []);
const findRow = (t, id) => table(t).find(r => String(r.id) === String(id));
const AppDataStore = {
    _generateId: () => ++nextId,
    invalidateCache() {},
    getAll: async (t) => table(t).map(r => ({ ...r })),
    getById: async (t, id) => { const r = findRow(t, id); return r ? { ...r } : null; },
    getByIdFull: async (t, id) => { const r = findRow(t, id); return r ? { ...r } : null; },
    query: async (t, f) => table(t).filter(r => Object.entries(f).every(([k, v]) => String(r[k]) === String(v))).map(r => ({ ...r })),
    update: async (t, id, patch) => { const r = findRow(t, id); if (r) Object.assign(r, patch); return r; },
    create: async (t, row) => {
        if (t === 'approval_queue' && queueWriteFails) throw new Error('offline');
        const r = { id: row.id || ++nextId, ...row }; table(t).push(r); return { ...r };
    },
};

const appStub = { register(_n, fns) { Object.assign(this, fns); }, buildPostMeetupNotesBlock() {}, gatherContactPrefill: undefined };
const windowStub = {
    _appState: { cu: { id: 8, role: 'Level 12 Agent', full_name: 'Agent' }, hac: new Map(), flt: {}, phc: null },
    _crmUtils: new Proxy({
        escapeHtml, getUserLevel: levelOf, recordCurrency: () => 'MYR',
        isManagement: (u) => levelOf(u) <= 4, isSystemAdmin: (u) => levelOf(u) === 1, isMarketingManager: (u) => levelOf(u) === 2,
        isAgent: (u) => levelOf(u) >= 3, isTeamLeaderOrAbove: (u) => levelOf(u) <= 5, isMobile: () => false,
        bookPurchaseOnce: async (customerId, p) => { booked.push({ customerId, item: p.item, amount: p.amount, invoice: p.invoice, date: p.date }); return { booked: true }; },
    }, { get: (t, k) => (k in t ? t[k] : () => undefined) }),
    app: appStub, AppDataStore, UI, _dataHelpers: helpers,
    addEventListener() {}, matchMedia: () => ({ matches: false }),
    supabase: {
        rpc: async (name, args) => {
            rpcCalls.push(name);
            if (name === 'can_approve_sales') return { data: false, error: null };
            if (name === 'submit_closing_record') {
                const p = findRow('prospects', args.p_prospect_id);
                const st = p.closing_record?.status;
                if (st === 'submitted' || st === 'approved') return { data: { ok: false, reason: 'locked' }, error: null };
                p.closing_record = args.p_closing_record;
                if (args.p_request_conversion) p.conversion_status = 'pending_approval';
                return { data: { ok: true }, error: null };
            }
            return { data: null, error: null };
        },
    },
};
const sandbox = {
    window: windowStub, document, AppDataStore, UI, app: appStub, console, URL, Promise, Map, Set,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'node-sim' }, fetch: async () => ({ ok: false, json: async () => ({}) }),
    Blob: function () {}, FileReader: function () {}, FormData: function () {}, confirm: () => true, CustomEvent: function () {},
};
windowStub.confirm = () => true;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['chunks/script-activities.js', 'chunks/script-calendar.js', 'chunks/script-approvals.js']) {
    vm.runInContext(read(f), sandbox, { filename: f });
}
const app = appStub;
const flush = () => new Promise(r => setImmediate(r));

const AGENT = { id: 8, role: 'Level 12 Agent', full_name: 'Agent' };
const BOSS = { id: 1, role: 'Level 1 Super Admin', full_name: 'Boss' };

// Sale 1: sitting in the slot, submitted from appointment 10, with its queue row.
const SALE1 = { status: 'submitted', full_name: 'Lim', product: 'Ring', sale_amount: '5000', invoice_number: 'PR1', order_date: '2026-10-01', closing_activity_id: 10, invoice_file: 'order_forms/old.jpg' };
const fresh = ({ converted = true, slot = SALE1, amount = 5000 } = {}) => {
    toasts.length = 0; booked.length = 0; rpcCalls = []; modal = null; hidden = 0; queueWriteFails = false; nextId = 5000;
    fields.clear();
    windowStub._appState.cu = AGENT;
    const sale = slot ? { ...slot, sale_amount: String(amount) } : null;
    DB = {
        prospects: [{ id: 1, full_name: 'Lim', status: converted ? 'converted' : 'active', responsible_agent_id: 8, closing_record: sale, closing_records_history: [] }],
        customers: converted ? [{ id: 501, full_name: 'Lim', converted_from_prospect_id: 1 }] : [],
        activities: [
            { id: 10, prospect_id: 1, lead_agent_id: 8, activity_date: '2026-10-01', is_closing: true, solution_sold: 'Ring', amount_closed: amount, closing_amount: amount, invoice_number: 'PR1' },
            { id: 11, prospect_id: 1, lead_agent_id: 8, activity_date: '2026-11-02' },
        ],
        products: [{ id: 1, name: 'Ring' }],
        prospect_attachments: [
            { id: 900, prospect_id: 1, attachment_type: 'order_form', file_url: 'order_forms/old.jpg', metadata: { activity_id: 10, form_type: 'C', prn_number: 'PR1' } },
            { id: 901, prospect_id: 1, attachment_type: 'order_form', file_url: 'order_forms/manual_0608.jpg', metadata: { form_type: 'C' } },
        ],
        approval_queue: sale ? [{ id: 20, approval_type: 'new_sale', status: 'pending', prospect_id: 1, submitted_by: 8, submitted_at: '2026-10-01T01:00:00Z',
            snapshot_after: { ...sale, sale_amount: amount, prospect_name: 'Lim' } }] : [],
    };
};
const queueRow = (id) => DB.approval_queue.find(r => String(r.id) === String(id));
const prospect = () => DB.prospects[0];
const inputValue = (html, id) => { const m = new RegExp(`id="${id}"[^>]*value="([^"]*)"`).exec(html); return m ? m[1] : null; };
const isTicked = (html, id) => new RegExp(`id="${id}"[^>]*\\schecked`).test(html);

// What the agent has typed in the form.
const fillForm = (o = {}) => {
    const v = { 'mo-solution-sold': 'Book', 'mo-amount-closed': '800', 'mo-order-date': '2026-11-02', 'mo-invoice-number': 'PR2', 'mo-full-name': 'Lim', 'mo-payment-method': 'Cash', ...o };
    field('mo-is-closing', { checked: true });
    field('mo-unable-to-serve', { checked: false });
    field('mo-order-form-thumbs', { children: [] });
    for (const [id, value] of Object.entries(v)) field(id, { value });
};
// Run the modal's own button, exactly as the click would.
const clickButton = async (label) => {
    const b = modal.buttons.find(x => String(x.label).includes(label));
    if (!b) throw new Error('no button: ' + label);
    await vm.runInContext(b.action, sandbox);
    await flush();
};
const loadThumbs = async (activityId) => {
    field('mo-order-form-thumbs', { children: [], dataset: {}, appendChild(c) { this.children.push(c); } });
    await app.loadOrderFormThumbnails('mo', 1, activityId);
    return thumbs().children.map(c => c.getAttribute('data-photo'));
};

(async () => {
    // ── 1. THE BUG: a new appointment while sale 1 waits for approval ──────────
    fresh();
    await app.openMeetingOutcomeModal(11);
    eq('new appointment: opens the form', !!modal.html.includes('mo-amount-closed'));
    eq('new appointment: Case Closed not ticked', isTicked(modal.html, 'mo-is-closing'), false);
    eq('new appointment: amount blank', inputValue(modal.html, 'mo-amount-closed'), '');
    eq('new appointment: invoice blank', inputValue(modal.html, 'mo-invoice-number'), '');
    eq('new appointment: says it is a new sale', modal.html.includes('This is a new sale'));
    eq('new appointment: names the earlier sale', modal.html.includes('Ring · RM 5000 · Invoice PR1'));
    eq('new appointment: the old locked box is gone', modal.html.includes('locked closing record'), false);
    eq('new appointment: photos load for THIS appointment', modal.html.includes("loadOrderFormThumbnails('mo',1,11)"));

    eq('photos: new appointment shows none of the old ones', await loadThumbs(11), []);
    eq('photos: sale 1 appointment shows its own only', await loadThumbs(10), ['order_forms/old.jpg']);
    DB.prospect_attachments.push({ id: 902, prospect_id: 1, attachment_type: 'order_form', file_url: 'order_forms/new.jpg', metadata: { activity_id: 11 } });
    eq('photos: a photo taken here shows here', await loadThumbs(11), ['order_forms/new.jpg']);
    eq('photos: photo-required gate passes on it', app.hasOrderFormPhoto('mo', 11));
    eq('photos: no appointment id = every photo (other callers)', (await loadThumbs(undefined)).length, 3);

    // ── 2. Appointment that already has its sale ───────────────────────────────
    fresh();
    await app.openMeetingOutcomeModal(10);
    eq('own sale: read-only, not the form', modal.html.includes('mo-amount-closed'), false);
    eq('own sale: shows the sale', modal.html.includes('Ring · RM 5000 · Invoice PR1'));
    eq('own sale: Waiting for approval', modal.html.includes('Waiting for approval'));
    eq('own sale: no Save button', modal.buttons.map(b => b.label).some(l => /Save/.test(l)), false);
    await clickButton('Record another sale');
    eq('another sale: opens the form', modal.html.includes('mo-amount-closed'));
    eq('another sale: Case Closed ticked', isTicked(modal.html, 'mo-is-closing'));
    eq('another sale: amount blank (activity row still has sale 1)', inputValue(modal.html, 'mo-amount-closed'), '');
    eq('another sale: invoice blank', inputValue(modal.html, 'mo-invoice-number'), '');
    eq('another sale: no old photos loaded', modal.html.includes('loadOrderFormThumbnails'), false);
    eq('another sale: Save carries the flag', modal.buttons[0].action.includes('{ newSale: true }'));

    // ── 3. Second sale saved: reaches the manager, sale 1 untouched ────────────
    fresh();
    const slotBefore = JSON.stringify(prospect().closing_record);
    await app.openMeetingOutcomeModal(11);
    fillForm();
    await clickButton('Save');
    eq('queued: green message says it went to the manager', toasts.filter(t => t[0] === 'ok').map(t => t[1]), ['✓ Sent to manager for approval, separate from the earlier sale']);
    eq('queued: a new queue row exists', DB.approval_queue.length, 2);
    const row2 = DB.approval_queue[1];
    eq('queued: row carries the new sale', [row2.approval_type, row2.status, row2.snapshot_after.product, row2.snapshot_after.sale_amount, row2.snapshot_after.invoice_number], ['new_sale', 'pending', 'Book', 800, 'PR2']);
    eq('queued: row knows its appointment', row2.snapshot_after.closing_activity_id, 11);
    eq('queued: nothing of sale 1 leaked in', [row2.snapshot_after.invoice_file, row2.snapshot_after.status], ['', 'submitted']);
    eq('queued: the slot is exactly as it was', JSON.stringify(prospect().closing_record), slotBefore);
    eq('queued: the locked-slot RPC was not even tried', rpcCalls.includes('submit_closing_record'), false);
    eq('queued: form closed', hidden, 1);
    await app.openMeetingOutcomeModal(11);
    eq('queued: reopening shows it read-only', [modal.html.includes('mo-amount-closed'), modal.html.includes('Book · RM 800 · Invoice PR2')], [false, true]);

    // Its own photo becomes its invoice — never sale 1's, same appointment or not.
    fresh();
    await app.openMeetingOutcomeModal(10, { newSale: true });
    fillForm();
    DB.prospect_attachments.push({ id: 903, prospect_id: 1, attachment_type: 'order_form', file_url: 'order_forms/second.jpg', metadata: { activity_id: 10 } });
    thumbs().children = [mkThumb({ 'data-photo': 'order_forms/second.jpg', 'data-activity-id': '10' })];
    await clickButton('Save');
    eq('same appointment: takes its own photo', DB.approval_queue[1].snapshot_after.invoice_file, 'order_forms/second.jpg');

    // Incomplete → nothing written at all.
    fresh();
    await app.openMeetingOutcomeModal(11);
    fillForm({ 'mo-invoice-number': '' });
    await clickButton('Save');
    eq('queued incomplete: red message', toasts.map(t => t[0]), ['err']);
    eq('queued incomplete: nothing written', [DB.approval_queue.length, findRow('activities', 11).is_closing], [1, undefined]);
    eq('queued incomplete: form stays open', hidden, 0);

    // Keying the very same sale again is refused.
    fresh();
    await app.openMeetingOutcomeModal(11);
    fillForm({ 'mo-solution-sold': 'Ring', 'mo-amount-closed': '5000', 'mo-invoice-number': 'PR1' });
    await clickButton('Save');
    eq('same sale twice: refused', [toasts[0][0], DB.approval_queue.length], ['err', 1]);

    // The queue write fails → the agent is told, the form stays, retry works once.
    fresh();
    await app.openMeetingOutcomeModal(11);
    fillForm();
    queueWriteFails = true;
    await clickButton('Save');
    eq('queue failure: red message, form open', [toasts.at(-1)[0], hidden], ['err', 0]);
    queueWriteFails = false;
    await clickButton('Save');
    eq('queue failure: retry files exactly one row', DB.approval_queue.length, 2);

    // A manager's sale normally skips the queue; a queued one has nowhere else to be.
    fresh();
    windowStub._appState.cu = BOSS;
    await app.openMeetingOutcomeModal(11);
    fillForm();
    await clickButton('Save');
    eq('manager: queued sale still gets a row', DB.approval_queue.length, 2);

    // Slot taken between opening and saving: never overwritten, never dropped.
    fresh({ slot: null });
    await app.openMeetingOutcomeModal(11);
    fillForm();
    const realFull = AppDataStore.getByIdFull;
    AppDataStore.getByIdFull = async (t, id) => { const r = await realFull(t, id); if (t === 'prospects') { prospect().closing_record = { ...SALE1 }; return { ...r, closing_record: null }; } return r; };
    await clickButton('Save');
    AppDataStore.getByIdFull = realFull;
    eq('race: the other sale kept', prospect().closing_record.invoice_number, 'PR1');
    eq('race: this sale reached the queue', DB.approval_queue.map(r => r.snapshot_after.invoice_number), ['PR2']);

    // Nothing in the way → still the normal closing record path.
    fresh({ slot: null });
    await app.openMeetingOutcomeModal(11);
    fillForm();
    await clickButton('Save');
    eq('free slot: saved to the closing record', [prospect().closing_record.invoice_number, prospect().closing_record.closing_activity_id], ['PR2', 11]);
    eq('free slot: normal queue row', DB.approval_queue.map(r => r.description), ['New sale RM 800 for Lim']);

    // Own draft keeps editing; another appointment's draft is only adopted on request.
    fresh({ slot: { ...SALE1, status: 'draft' } });
    await app.openMeetingOutcomeModal(10);
    eq('own draft: editable with its data', inputValue(modal.html, 'mo-amount-closed'), '5000');
    await app.openMeetingOutcomeModal(11);
    eq('draft elsewhere: blank form + Continue link', [inputValue(modal.html, 'mo-amount-closed'), modal.html.includes('Continue that draft')], ['', true]);
    await app.openMeetingOutcomeModal(11, { continueDraft: true });
    eq('draft elsewhere: Continue loads it', inputValue(modal.html, 'mo-amount-closed'), '5000');
    fillForm({ 'mo-solution-sold': 'Ring', 'mo-amount-closed': '5000', 'mo-invoice-number': 'PR1' });
    await clickButton('Save');
    eq('draft elsewhere: adopted by this appointment', prospect().closing_record.closing_activity_id, 11);

    // Only the appointment's own stale form can hit a lock now.
    fresh();
    fillForm();
    await app.saveMeetingOutcome(10);
    eq('stale form on a locked sale: refused, nothing written', [toasts[0][0], findRow('activities', 10).solution_sold], ['err', 'Ring']);

    // ── 4. Approvals with two sales waiting ────────────────────────────────────
    const queueSale2 = async () => {
        await app.openMeetingOutcomeModal(11);
        fillForm();
        await clickButton('Save');
        toasts.length = 0;
        windowStub._appState.cu = BOSS;
        return DB.approval_queue[1].id;
    };

    // Existing customer: either order books each sale once.
    fresh();
    let id2 = await queueSale2();
    await app.approveQueueEntry(id2);
    eq('customer, sale 2 first: booked once', booked.map(b => [b.item, b.amount]), [['Book', 800]]);
    eq('customer, sale 2 first: sale 1 still waiting in the slot', [prospect().closing_record.invoice_number, prospect().closing_record.status, queueRow(20).status], ['PR1', 'submitted', 'pending']);
    eq('customer, sale 2 first: goes to history', prospect().closing_records_history.map(h => [h.invoice_number, h.status]), [['PR2', 'approved']]);
    eq('customer, sale 2 first: internal name not stored', 'prospect_name' in prospect().closing_records_history[0], false);
    await app.approveQueueEntry(20);
    eq('customer, then sale 1: both booked', booked.map(b => b.invoice), ['PR2', 'PR1']);
    eq('customer, then sale 1: slot emptied, both in history', [prospect().closing_record, prospect().closing_records_history.map(h => h.invoice_number)], [null, ['PR2', 'PR1']]);

    fresh();
    id2 = await queueSale2();
    await app.approveQueueEntry(20);
    eq('customer, sale 1 first: slot emptied', prospect().closing_record, null);
    eq('customer, sale 1 first: sale 2 still waiting', queueRow(id2).status, 'pending');
    await app.approveQueueEntry(id2);
    eq('customer, sale 1 first: both booked', booked.map(b => b.invoice), ['PR1', 'PR2']);
    eq('customer, sale 1 first: both in history once', prospect().closing_records_history.map(h => h.invoice_number), ['PR1', 'PR2']);

    // Sale 1 approved on the DC Closing Record tab leaves its row pending. Approving
    // that leftover must not add it to history twice.
    fresh();
    windowStub._appState.cu = BOSS;
    await app.approveClosingRecord(1);
    await app.approveQueueEntry(20);
    eq('leftover row: history keeps one copy', prospect().closing_records_history.length, 1);

    // Approving right after submitting: the cached prospect does not show the new
    // closing record yet. It must still be archived, not left on 'submitted'.
    fresh();
    windowStub._appState.cu = BOSS;
    const cachedRead = AppDataStore.getById;
    AppDataStore.getById = async (t, id) => { const r = await cachedRead(t, id); return t === 'prospects' && r ? { ...r, closing_record: null } : r; };
    await app.approveQueueEntry(20);
    AppDataStore.getById = cachedRead;
    eq('stale cache at approval: record archived', [prospect().closing_record, prospect().closing_records_history.map(h => h.invoice_number)], [null, ['PR1']]);

    // Reject touches only the sale it was pressed on.
    fresh();
    id2 = await queueSale2();
    field('reject-reason', { value: 'wrong amount' });
    await app.confirmRejectQueueEntry(id2);
    eq('reject sale 2: sale 1 stays submitted', prospect().closing_record.status, 'submitted');
    eq('reject sale 2: its row rejected with the reason', [queueRow(id2).status, queueRow(id2).reject_reason], ['rejected', 'wrong amount']);
    windowStub._appState.cu = AGENT;
    await app.openMeetingOutcomeModal(11);
    eq('reject sale 2: agent sees why and can fix it', [modal.html.includes('wrong amount'), inputValue(modal.html, 'mo-amount-closed')], [true, '800']);
    eq('reject sale 2: Case Closed already ticked', isTicked(modal.html, 'mo-is-closing'));
    fillForm({ 'mo-amount-closed': '850' });
    await clickButton('Save');
    eq('reject sale 2: the fix goes back to the manager', DB.approval_queue.at(-1).snapshot_after.sale_amount, 850);
    await app.openMeetingOutcomeModal(11);
    eq('reject sale 2: after the fix, read-only and no red notice', [modal.html.includes('mo-amount-closed'), modal.html.includes('wrong amount')], [false, false]);

    // Rejected sale sharing an appointment with a finished one: still reachable.
    fresh();
    await app.openMeetingOutcomeModal(10, { newSale: true });
    fillForm();
    await clickButton('Save');
    id2 = DB.approval_queue[1].id;
    windowStub._appState.cu = BOSS;
    field('reject-reason', { value: 'wrong amount' });
    await app.confirmRejectQueueEntry(id2);
    windowStub._appState.cu = AGENT;
    await app.openMeetingOutcomeModal(10);
    eq('rejected beside a finished sale: both visible', [modal.html.includes('Ring · RM 5000'), modal.html.includes('Book · RM 800'), modal.html.includes('wrong amount')], [true, true, true]);
    await clickButton('Record another sale');
    eq('rejected beside a finished sale: Record another sale prefills it', inputValue(modal.html, 'mo-amount-closed'), '800');

    fresh();
    id2 = await queueSale2();
    await app.confirmRejectQueueEntry(20);
    eq('reject sale 1: back to draft', prospect().closing_record.status, 'draft');
    eq('reject sale 1: sale 2 still waiting', queueRow(id2).status, 'pending');

    // Not a customer yet: the customer is created from the first sale.
    fresh({ converted: false, amount: 21990 });
    DB.approval_queue.push({ id: 21, approval_type: 'new_customer', status: 'pending', prospect_id: 1, submitted_by: 8, submitted_at: '2026-10-01T01:00:01Z', snapshot_after: { full_name: 'Lim' } });
    await app.openMeetingOutcomeModal(11);
    fillForm();
    await clickButton('Save');
    id2 = DB.approval_queue.find(r => r.approval_type === 'new_sale' && r.id !== 20).id;
    toasts.length = 0;
    windowStub._appState.cu = BOSS;
    await app.approveQueueEntry(id2);
    eq('not a customer, sale 2 first: refused with the reason', toasts.map(t => t[1]), ['Approve the earlier sale for this client first. This one is queued behind it.']);
    eq('not a customer, sale 2 first: nothing booked, row still pending', [booked.length, queueRow(id2).status, prospect().status], [0, 'pending', 'active']);
    await app.approveQueueEntry(20);
    eq('not a customer, sale 1: customer created, sale 1 booked', [prospect().status, booked.map(b => b.invoice)], ['converted', ['PR1']]);
    eq('not a customer, sale 1: its two rows closed', [queueRow(20).status, queueRow(21).status], ['approved', 'approved']);
    eq('not a customer, sale 1: sale 2 NOT closed by accident', queueRow(id2).status, 'pending');
    await app.approveQueueEntry(id2);
    eq('not a customer, then sale 2: booked to the same customer', [booked.map(b => b.invoice), DB.customers.length], [['PR1', 'PR2'], 1]);

    // Conversion approved directly: same protection.
    fresh({ converted: false, amount: 21990 });
    DB.approval_queue.push({ id: 21, approval_type: 'new_customer', status: 'pending', prospect_id: 1, submitted_by: 8, submitted_at: '2026-10-01T01:00:01Z', snapshot_after: { full_name: 'Lim' } });
    await app.openMeetingOutcomeModal(11);
    fillForm();
    await clickButton('Save');
    id2 = DB.approval_queue.find(r => r.approval_type === 'new_sale' && r.id !== 20).id;
    windowStub._appState.cu = BOSS;
    DB.approval_queue.reverse(); // the database promises no row order: sale 2 listed first
    await app.approveQueueEntry(21);
    eq('conversion row: closes sale 1 only', [queueRow(20).status, queueRow(id2).status], ['approved', 'pending']);

    // Small first sale already approved (still a prospect), big queued sale converts.
    fresh({ converted: false, slot: null });
    DB.approval_queue.push({ id: 30, approval_type: 'new_sale', status: 'pending', prospect_id: 1, submitted_by: 8, submitted_at: '2026-10-02T01:00:00Z',
        snapshot_after: { product: 'Big', sale_amount: 30000, invoice_number: 'PR9', order_date: '2026-10-02', closing_activity_id: 11 } });
    windowStub._appState.cu = BOSS;
    await app.approveQueueEntry(30);
    eq('queued big sale, slot clear: customer created on THIS sale', [prospect().status, booked.map(b => [b.invoice, b.amount])], ['converted', [['PR9', 30000]]]);
    eq('queued big sale: row approved, in history', [queueRow(30).status, prospect().closing_records_history.map(h => h.invoice_number)], ['approved', ['PR9']]);

    // Under RM 2,000 a client stays a prospect: archived, no purchase, as for a first sale.
    fresh({ converted: false, slot: null });
    DB.approval_queue.push({ id: 31, approval_type: 'new_sale', status: 'pending', prospect_id: 1, submitted_by: 8, submitted_at: '2026-10-02T01:00:00Z',
        snapshot_after: { product: 'Small', sale_amount: 500, invoice_number: 'PR8', order_date: '2026-10-02' } });
    windowStub._appState.cu = BOSS;
    await app.approveQueueEntry(31);
    eq('queued small sale: stays a prospect, sale in history', [prospect().status, booked.length, prospect().closing_records_history.map(h => h.invoice_number)], ['active', 0, ['PR8']]);

    // Order Date entered for one sale must not overwrite the other's.
    fresh();
    id2 = await queueSale2();
    delete queueRow(20).snapshot_after.order_date;
    delete prospect().closing_record.order_date;
    eq('order date: sale 1 asks for it', await app.approveQueueEntry(20), 'needs-order-date');
    field('apr-order-date', { value: '2026-09-01' });
    await app.saveOrderDateAndApprove('queue', '20');
    eq('order date: sale 1 gets it', booked.map(b => [b.invoice, b.date]), [['PR1', '2026-09-01']]);
    eq('order date: sale 2 keeps its own', queueRow(id2).snapshot_after.order_date, '2026-11-02');

    console.log(`test-closing-per-appointment: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
