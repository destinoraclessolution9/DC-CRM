// ci/test-approval-waiting-sales.js — sales waiting outside the approval queue (owner 2026-11-02).
//
// WHY: the Manager Approval Queue listed approval_queue rows only. A sale can wait in
// a client's closing slot with no pending row: a manager's own submit writes none,
// July's rows were lost to an RLS bug, and an approval that read a stale prospect left
// LIM CHONG HENG's slot on 'submitted'. Those were only approvable from each client's
// DC Closing Record tab, so the owner could not find them. This pins:
//   1. RULE   — which slots count as waiting outside the queue.
//   2. LIST   — the desktop queue and the Sales-to-approve pop-up show them once,
//               next to the queue rows, newest first.
//   3. ACT    — Approve books once (an already-approved sale is only filed),
//               Reject sends it back with the reason, Order Date gate still applies.
//   4. SAFE   — agents can't act, and a failed live read never doubles a sale.
//
// HARNESS: loads the REAL data-helpers.js and approvals chunk in a vm sandbox with a
// stubbed DOM, in-memory tables and a fake supabase query builder.
// Run: node ci/test-approval-waiting-sales.js
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

// ── Live shapes (2026-11-02) ────────────────────────────────────────────────
const LIM_SALE = { status: 'submitted', product: 'Ring A', sale_amount: '16980', invoice_number: 'PR1936471', order_date: '2026-10-27', submitted_at: '2026-10-27T07:47:00Z' };
const KWONG_SALE = { status: 'submitted', product: 'Ring B', sale_amount: '17990.00', invoice_number: 'PR77', order_date: '2026-07-21', submitted_at: '2026-07-21T13:06:13Z' };
const WANG_SALE = { status: 'submitted', product: 'Ring C', sale_amount: '11990', invoice_number: 'PR88', order_date: '2026-07-28', submitted_at: '2026-07-28T09:27:48Z' };
const NG_SLOT = { status: 'submitted', product: 'Book', sale_amount: '800', invoice_number: 'PR10', order_date: '2026-10-30', submitted_at: '2026-10-30T02:00:00Z' };
const NG_QUEUED = { product: 'Bracelet', sale_amount: 2500, invoice_number: 'PR11', order_date: '2026-11-01', prospect_name: 'Ng' };

const seed = () => ({
    users: [{ id: 8, full_name: 'Deeta' }, { id: 7, full_name: 'Oo' }, { id: 1, full_name: 'Boss' }],
    prospects: [
        // approved in the queue on 27 Oct, record stuck on 'submitted'
        { id: 1, full_name: 'LIM CHONG HENG', status: 'converted', conversion_status: 'approved', responsible_agent_id: 8, closing_record: { ...LIM_SALE }, closing_records_history: [] },
        // July sale with no queue row at all
        { id: 2, full_name: 'Kwong Wang Sheng', status: null, conversion_status: 'pending_approval', responsible_agent_id: 8, closing_record: { ...KWONG_SALE }, closing_records_history: [] },
        // already in the queue (sale + conversion rows)
        { id: 3, full_name: 'Wang Jing Lin', status: null, conversion_status: 'pending_approval', responsible_agent_id: 8, closing_record: { ...WANG_SALE }, closing_records_history: [] },
        // slot sale has no row; the pending row is a DIFFERENT, queued sale
        { id: 4, full_name: 'Ng', status: 'converted', conversion_status: 'approved', responsible_agent_id: 8, closing_record: { ...NG_SLOT, submitted_by: 7 }, closing_records_history: [] },
        // a draft is not waiting
        { id: 5, full_name: 'Draft Person', status: null, responsible_agent_id: 8, closing_record: { ...KWONG_SALE, status: 'draft' }, closing_records_history: [] },
        // a pending conversion row stands for the slot sale
        { id: 6, full_name: 'Conv Only', status: null, conversion_status: 'pending_approval', responsible_agent_id: 8, closing_record: { ...WANG_SALE, invoice_number: 'PR66' }, closing_records_history: [] },
    ],
    customers: [{ id: 501, full_name: 'LIM CHONG HENG', converted_from_prospect_id: 1 }, { id: 504, full_name: 'Ng', converted_from_prospect_id: 4 }],
    // Lim's sale was booked when Oo approved it
    purchases: [{ id: 700, customer_id: 501, invoice: 'PR1936471', amount: 16980, item: 'Ring A' }],
    approval_queue: [
        { id: 10, approval_type: 'new_sale', status: 'approved', prospect_id: 1, submitted_by: 8, submitted_at: '2026-10-27T07:47:00Z', reviewed_by: 7, reviewed_at: '2026-10-27T07:48:00Z',
            snapshot_after: { ...LIM_SALE, sale_amount: 16980, prospect_name: 'LIM CHONG HENG' }, description: 'New sale RM 16,980 for LIM CHONG HENG' },
        { id: 30, approval_type: 'new_sale', status: 'pending', prospect_id: 3, submitted_by: 8, submitted_at: '2026-07-28T09:27:00Z',
            snapshot_after: { ...WANG_SALE, sale_amount: 11990, prospect_name: 'Wang Jing Lin' }, description: 'New sale RM 11,990 for Wang Jing Lin' },
        { id: 31, approval_type: 'new_customer', status: 'pending', prospect_id: 3, submitted_by: 8, submitted_at: '2026-07-28T09:27:00Z',
            snapshot_after: { full_name: 'Wang Jing Lin', closing_record: { ...WANG_SALE } }, description: 'New customer conversion for Wang Jing Lin' },
        { id: 40, approval_type: 'new_sale', status: 'pending', prospect_id: 4, submitted_by: 8, submitted_at: '2026-11-01T03:00:00Z',
            snapshot_after: { ...NG_QUEUED }, description: 'Another sale RM 2,500 for Ng' },
        { id: 60, approval_type: 'new_customer', status: 'pending', prospect_id: 6, submitted_by: 8, submitted_at: '2026-07-28T09:00:00Z',
            snapshot_after: { full_name: 'Conv Only' }, description: 'New customer conversion for Conv Only' },
    ],
});

// ── 1. RULE ─────────────────────────────────────────────────────────────────
{
    const s = seed();
    const out = helpers.closingsOutsideQueue(s.prospects, s.approval_queue);
    eq('rule: Lim, Kwong and Ng\'s slot sale wait outside the queue', out.map(w => w.prospect.full_name), ['LIM CHONG HENG', 'Kwong Wang Sheng', 'Ng']);
    eq('rule: Lim\'s sale was already approved (row 10)', out.map(w => w.approvedRow && w.approvedRow.id), [10, null, null]);
    eq('rule: the sale is the slot', out[1].sale.invoice_number, 'PR77');
    eq('rule: no rows = every submitted slot', helpers.closingsOutsideQueue(s.prospects, null).length, 5);
    eq('rule: a rejected row does not hold a slot', helpers.closingsOutsideQueue([s.prospects[2]], [{ ...s.approval_queue[1], status: 'rejected' }]).length, 1);
    eq('rule: an approved row of ANOTHER sale is not this one', helpers.closingsOutsideQueue([s.prospects[0]], [{ ...s.approval_queue[0], snapshot_after: { ...LIM_SALE, invoice_number: 'PR2' } }])[0].approvedRow, null);
    eq('rule: ids compare as text', helpers.closingsOutsideQueue([{ ...s.prospects[2], id: '3' }], s.approval_queue).length, 0);
}

// ── Harness ─────────────────────────────────────────────────────────────────
const fields = new Map();
const field = (id, props) => fields.set(id, { id, value: '', innerHTML: '', textContent: '', style: {}, ...props });
const document = {
    getElementById: (id) => fields.get(id) || null,
    createElement: () => ({ style: {}, setAttribute() {}, getAttribute: () => null }),
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: { appendChild() {} },
};
const toasts = [];
let modal = null;
let booked = [];
let DB, nextId, failTables, approverIds;
const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const levelOf = (u) => { const m = /Level\s*(\d+)/i.exec((u && u.role) || ''); return m ? +m[1] : 99; };
const UI = new Proxy({
    toast: { success: (m) => toasts.push(['ok', m]), error: (m) => toasts.push(['err', m]), info: (m) => toasts.push(['info', m]), warning: (m) => toasts.push(['warn', m]) },
    showModal: (title, html, buttons) => { modal = { title, html, buttons }; },
    hideModal: () => { modal = null; },
    purchasePaymentTerms: () => ({}), countryByCode: () => ({ code: 'MY' }), currencyForCountry: () => 'MYR',
}, { get: (t, k) => (k in t ? t[k] : () => '') });

const table = (t) => (DB[t] = DB[t] || []);
const findRow = (t, id) => table(t).find(r => String(r.id) === String(id));
const copy = (r) => JSON.parse(JSON.stringify(r));
const AppDataStore = {
    _generateId: () => ++nextId,
    getAll: async (t) => table(t).map(copy),
    getById: async (t, id) => { const r = findRow(t, id); return r ? copy(r) : null; },
    getByIdFull: async (t, id) => { const r = findRow(t, id); return r ? copy(r) : null; },
    query: async (t, f) => table(t).filter(r => Object.entries(f).every(([k, v]) => String(r[k]) === String(v))).map(copy),
    update: async (t, id, patch) => { const r = findRow(t, id); if (r) Object.assign(r, copy(patch)); return r; },
    create: async (t, row) => { const r = { id: row.id || ++nextId, ...copy(row) }; table(t).push(r); return copy(r); },
};
// PostgREST-ish builder: select / eq (incl. col->>key) / in / limit, awaited for { data, error }.
const colValue = (r, col) => {
    const m = /^(\w+)->>(\w+)$/.exec(col);
    if (!m) return r[col];
    const o = r[m[1]];
    return o && o[m[2]] != null ? String(o[m[2]]) : undefined;
};
const from = (t) => {
    const filters = [];
    const b = {
        select() { return b; },
        eq(col, v) { filters.push(r => colValue(r, col) === v); return b; },
        in(col, vs) { filters.push(r => vs.map(String).includes(String(r[col]))); return b; },
        limit() { return b; },
        then(ok, bad) {
            const res = failTables.has(t) ? { data: null, error: { message: 'network' } } : { data: table(t).filter(r => filters.every(f => f(r))).map(copy), error: null };
            return Promise.resolve(res).then(ok, bad);
        },
    };
    return b;
};

const appStub = {
    register(_n, fns) { Object.assign(this, fns); },
    getAgentName: async (id) => (findRow('users', id) || {}).full_name || '',
};
const windowStub = {
    _appState: { cu: null, phc: null },
    _crmUtils: new Proxy({
        escapeHtml, getUserLevel: levelOf, isManagement: (u) => levelOf(u) <= 4, isSystemAdmin: (u) => levelOf(u) === 1,
        isMarketingManager: (u) => levelOf(u) === 2, isAgent: (u) => levelOf(u) >= 3,
        // bookPurchaseOnce's durable guard: same invoice + amount + item books nothing.
        bookPurchaseOnce: async (customerId, p) => {
            if (table('purchases').some(x => String(x.customer_id) === String(customerId) && x.invoice === p.invoice && +x.amount === +p.amount && x.item === p.item)) return { booked: false };
            table('purchases').push({ id: ++nextId, ...p }); booked.push([p.invoice, p.amount, p.date]); return { booked: true };
        },
    }, { get: (t, k) => (k in t ? t[k] : () => undefined) }),
    app: appStub, AppDataStore, UI, _dataHelpers: helpers,
    supabase: {
        rpc: async (name) => ({ data: name === 'can_approve_sales' ? approverIds.has(windowStub._appState.cu?.id) : null, error: null }),
        from,
    },
};
const sandbox = {
    window: windowStub, document, AppDataStore, UI, app: appStub, console, Promise, Map, Set, JSON,
    setTimeout: () => 0, clearTimeout() {}, localStorage: { getItem: () => null, setItem() {} },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(read('chunks/script-approvals.js'), sandbox, { filename: 'chunks/script-approvals.js' });
const app = appStub;

const AGENT = { id: 8, role: 'Level 12 Agent' };
const OO = { id: 7, role: 'Level 6 Senior Agent' };   // not management: granted approve_sales
const BOSS = { id: 1, role: 'Level 1 Super Admin' };

const fresh = (cu = BOSS) => {
    DB = seed(); nextId = 9000; failTables = new Set(); approverIds = new Set([7]);
    toasts.length = 0; modal = null; booked = [];
    fields.clear();
    field('approval-queue-body');
    field('approval-queue-count');
    windowStub._appState.cu = cu;
};
const tbody = () => fields.get('approval-queue-body').innerHTML;
const count = () => String(fields.get('approval-queue-count').textContent);
const rowsIn = (html) => html.split('<tr>').slice(1);
const p = (id) => findRow('prospects', id);
const clickButton = async (label) => {
    const b = modal.buttons.find(x => String(x.label).includes(label));
    if (!b) throw new Error('no button: ' + label + ' in ' + modal.title);
    await vm.runInContext(b.action, sandbox);
};

(async () => {
    // ── 2. LIST: desktop queue ─────────────────────────────────────────────
    fresh();
    await app.renderApprovalQueue();
    const rows = rowsIn(tbody());
    // queue rows 30, 31, 40, 60 + waiting Lim, Kwong, Ng's slot
    eq('queue: count is queue rows + waiting sales', count(), '7');
    eq('queue: Lim is listed', /LIM CHONG HENG/.test(tbody()));
    eq('queue: Kwong is listed', /Kwong Wang Sheng/.test(tbody()));
    eq('queue: Wang shows only as her two queue rows', rows.filter(r => r.includes('Wang Jing Lin')).length, 2);
    eq('queue: Ng shows twice: queued sale + slot sale', rows.filter(r => r.includes('<strong>Ng</strong>')).length, 2);
    eq('queue: newest first', rows.map(r => /<strong>([^<]*)<\/strong>/.exec(r)[1]), ['Ng', 'Ng', 'LIM CHONG HENG', 'Wang Jing Lin', 'Wang Jing Lin', 'Conv Only', 'Kwong Wang Sheng']);
    const limRow = rows.find(r => r.includes('LIM CHONG HENG'));
    const kwongRow = rows.find(r => r.includes('Kwong'));
    eq('queue: Lim says approved but not filed', /Approved \d+ Oct, not filed yet/.test(limRow));
    eq('queue: Lim has no Reject (already booked)', /rejectWaitingClosing/.test(limRow), false);
    eq('queue: Kwong says approving creates the customer', /New sale RM 17,990 \+ new customer/.test(kwongRow));
    // The Description column cuts off at about 33 characters (seen live 2026-11-02).
    const descOf = (r) => (/font-size:13px;" title="([^"]*)"/.exec(r) || [])[1];
    eq('queue: waiting descriptions fit the column', rows.filter(r => /WaitingClosing/.test(r)).map(r => descOf(r).length <= 33), [true, true, true]);
    eq('queue: Kwong has Approve + Reject on the slot', [/approveWaitingClosing\(2\)/.test(kwongRow), /rejectWaitingClosing\(2\)/.test(kwongRow)], [true, true]);
    eq('queue: submitted by the agent, or by who submitted it', [/Deeta/.test(kwongRow), /Oo/.test(rows.find(r => r.includes('approveWaitingClosing(4)')))], [true, true]);

    // A failed live read: queue rows only, never a guessed duplicate.
    fresh();
    failTables.add('approval_queue');
    await app.renderApprovalQueue();
    eq('read fails: queue rows still render, no waiting sales', [count(), /WaitingClosing/.test(tbody())], ['4', false]);

    // Granted approver (not management) sees them too; an agent's onclick is refused.
    fresh(OO);
    await app.renderApprovalQueue();
    eq('granted approver: waiting sales listed', /approveWaitingClosing\(2\)/.test(tbody()));
    fresh(AGENT);
    await app.approveWaitingClosing(2);
    eq('agent: approve refused, nothing changes', [p(2).closing_record.status, booked.length, toasts.some(t => t[1] === 'Not permitted')], ['submitted', 0, true]);
    await app.rejectWaitingClosing(2);
    eq('agent: reject refused', [p(2).closing_record.status, modal], ['submitted', null]);

    // ── 3. ACT ─────────────────────────────────────────────────────────────
    // Lim: already approved and booked → filing only, no second purchase.
    fresh();
    await app.renderApprovalQueue();
    await app.approveWaitingClosing(1);
    eq('Lim: filed, no second purchase', [p(1).closing_record, p(1).closing_records_history.map(h => [h.invoice_number, h.status]), table('purchases').length], [null, [['PR1936471', 'approved']], 1]);
    eq('Lim: gone from the queue', [/LIM CHONG HENG/.test(tbody()), count()], [false, '6']);

    // Kwong: no row → approving creates the customer and books the sale once.
    await app.approveWaitingClosing(2);
    eq('Kwong: now a customer', [p(2).status, p(2).closing_record, table('customers').some(c => String(c.converted_from_prospect_id) === '2')], ['converted', null, true]);
    eq('Kwong: sale booked once on its order date', booked, [['PR77', 17990, '2026-07-21']]);
    eq('Kwong: gone from the queue', [/Kwong/.test(tbody()), count()], [false, '5']);
    await app.approveWaitingClosing(2);
    eq('Kwong: approving again books nothing', booked.length, 1);

    // Detail view: Lim's says it is only filing; Kwong's offers both buttons.
    fresh();
    await app.showClosingApprovalDetail(1);
    eq('detail Lim: explains, File it only', [/never filed/.test(modal.html), /by <strong>Oo<\/strong>/.test(modal.html), modal.buttons.map(b => /Reject/.test(b.label)), /File it/.test(modal.buttons[0].label)], [true, true, [false], true]);
    await app.showClosingApprovalDetail(2);
    eq('detail Kwong: sale fields + Reject/Approve', [/PR77/.test(modal.html), /17,990/.test(modal.html), modal.buttons.length], [true, true, 2]);
    await clickButton('Approve');
    eq('detail Kwong: Approve button approves and closes', [p(2).status, modal], ['converted', null]);
    await app.showClosingApprovalDetail(3);
    eq('detail: a sale in the queue is not here', [modal, toasts.some(t => /no longer waiting/.test(t[1]))], [null, true]);

    // Reject from the pop-up: reason reaches the agent, the queued sale stays, pop-up returns.
    fresh();
    await app.rejectWaitingClosing(4, 'panel');
    eq('reject: asks why', [modal.title, /Book|RM 800/.test(modal.html)], ['Reject Approval', true]);
    field('reject-reason', { value: 'Wrong invoice photo' });
    await clickButton('Confirm Reject');
    eq('reject: slot back to the agent with the reason', [p(4).closing_record.status, p(4).closing_record.reject_reason], ['draft', 'Wrong invoice photo']);
    eq('reject: the queued sale is untouched', findRow('approval_queue', 40).status, 'pending');
    eq('reject: pop-up reopened without it', [/^Sales to approve/.test(modal.title), /rejectWaitingClosing\(4/.test(modal.html)], [true, false]);
    // Cancel from the pop-up returns to it; nothing changes.
    await app.rejectWaitingClosing(2, 'panel');
    await clickButton('Cancel');
    eq('reject cancel: back to the pop-up, sale untouched', [/^Sales to approve/.test(modal.title), p(2).closing_record.status], [true, 'submitted']);
    // The DC Closing Record tab's Reject no longer acts on a sale that isn't waiting.
    await app.rejectClosingRecord(4);
    eq('reject: a draft is not sent back again', toasts.some(t => /no longer waiting/.test(t[1])), true);

    // Order Date gate still applies; saving it finishes and refreshes the queue.
    fresh();
    delete p(2).closing_record.order_date;
    eq('order date: asked first', await app.approveWaitingClosing(2), 'needs-order-date');
    eq('order date: prompt stays up', modal && modal.title, 'Order Date needed');
    field('apr-order-date', { value: '2026-07-20' });
    await clickButton('Save Order Date');
    eq('order date: approved on that date', [p(2).status, booked], ['converted', [['PR77', 17990, '2026-07-20']]]);
    eq('order date: queue refreshed', /Kwong/.test(tbody()), false);

    // ── 2b. LIST: Sales-to-approve pop-up (phone + bell) ───────────────────
    fresh();
    await app.openSaleApprovals();
    // queue: 30 (Wang sale; her conversion row hidden), 40, 60 + waiting Lim, Kwong, Ng
    eq('pop-up: count', modal.title, 'Sales to approve (6)');
    eq('pop-up: Lim card says not filed, File it, no Reject', (() => {
        const card = modal.html.split('border-radius:10px').find(c => c.includes('LIM CHONG HENG'));
        return [/not filed yet/.test(card), /File it/.test(card), /Reject/.test(card)];
    })(), [true, true, false]);
    eq('pop-up: Kwong card = sale + new customer', /Sale \+ new customer/.test(modal.html));
    await vm.runInContext(`app.approveWaitingClosing(2, 'panel')`, sandbox);
    eq('pop-up approve: reopens with one fewer', [modal.title, p(2).status], ['Sales to approve (5)', 'converted']);

    console.log(`test-approval-waiting-sales: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
