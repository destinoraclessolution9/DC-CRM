// ci/test-sale-approver.js — granted sale approvers (owner ask 2026-10-16).
//
// WHY: a Level 5 team leader (Oo Kean Cherng) can now approve his team's sales
// when the Super Admin grants "approve_sales". This pins:
//   1. PERMISSION — management still approves; a granted L5 approves; an
//      ungranted L5 gets "Not permitted" and NOTHING is written.
//   2. NO LOST SALE — approving the "new sale" row of a prospect who is not a
//      customer yet goes through the paired conversion, books the sale ONCE and
//      closes BOTH queue rows. (Before: the closing record was archived without
//      booking, so a later conversion approval found nothing and the sale vanished.)
//   3. POP-UP LIST — shows sales, hides the conversion row paired with a sale,
//      ignores types a granted approver doesn't handle.
//
// HARNESS: loads the REAL chunks/script-approvals.js into a stubbed browser.
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.error(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
};

global.window = global;
global.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
const toasts = [];
let lastModal = null;
global.UI = {
    toast: { success: (m) => toasts.push(['ok', m]), error: (m) => toasts.push(['err', m]), info: (m) => toasts.push(['info', m]), warning: (m) => toasts.push(['warn', m]) },
    showModal: (title, html) => { lastModal = { title, html }; }, hideModal: () => {},
    countryByCode: () => ({ code: 'MY' }), currencyForCountry: () => 'MYR', purchasePaymentTerms: () => ({}),
};
const levelOf = (u) => { const m = String((u && u.role) || '').match(/Level\s*(\d+)/i); return m ? +m[1] : 99; };
global.window._appState = { cu: null };
const booked = [];
global.window._crmUtils = {
    escapeHtml: (s) => String(s ?? ''), getUserLevel: levelOf,
    isManagement: (u) => levelOf(u) <= 4, isSystemAdmin: (u) => levelOf(u) === 1,
    bookPurchaseOnce: async (customerId, purchase) => { booked.push({ customerId, amount: purchase.amount }); return { booked: true }; },
};
global.app = { register: (_n, obj) => Object.assign(global.app, obj) };

// In-memory tables
let DB;
let nextId = 5000;
const table = (t) => (DB[t] = DB[t] || []);
global.AppDataStore = {
    _generateId: () => ++nextId,
    getAll: async (t) => table(t).map(r => ({ ...r })),
    getById: async (t, id) => { const r = table(t).find(x => String(x.id) === String(id)); return r ? { ...r } : null; },
    query: async (t, f) => table(t).filter(r => Object.entries(f).every(([k, v]) => String(r[k]) === String(v))).map(r => ({ ...r })),
    update: async (t, id, patch) => { const r = table(t).find(x => String(x.id) === String(id)); if (r) Object.assign(r, patch); return r; },
    create: async (t, row) => { const r = { id: row.id || ++nextId, ...row }; table(t).push(r); return { ...r }; },
};
let rpcResult = false;
global.supabase = { rpc: async (name) => ({ data: name === 'can_approve_sales' ? rpcResult : null, error: null }) };

const src = fs.readFileSync(path.join(__dirname, '..', 'chunks', 'script-approvals.js'), 'utf8');
try { (0, eval)(src); } catch (e) { console.error('FAIL loading chunk: ' + e.message); process.exit(1); }

const L1 = { id: 9999, role: 'Level 1 Super Admin' };
const OO = { id: 7, role: 'Level 5 Team Leader' };
const AGENT = { id: 8, role: 'Level 12 Agent' };
const fresh = () => {
    booked.length = 0; toasts.length = 0; lastModal = null;
    DB = {
        users: [{ id: 7, full_name: 'Oo' }, { id: 8, full_name: 'Lau' }],
        prospects: [
            // not a customer yet; submitted closing record RM21,990
            { id: 100, full_name: 'New Client', status: 'active', responsible_agent_id: 8,
              closing_record: { status: 'submitted', sale_amount: 21990, product: 'Power Ring', closing_date: '2026-10-05' } },
            // already a customer; additional sale RM5,000
            { id: 101, full_name: 'Old Client', status: 'converted', responsible_agent_id: 8,
              closing_record: { status: 'submitted', sale_amount: 5000, product: 'Book', closing_date: '2026-10-06' } },
        ],
        customers: [{ id: 501, full_name: 'Old Client', converted_from_prospect_id: 101, responsible_agent_id: 8 }],
        approval_queue: [
            { id: 1, approval_type: 'new_sale', status: 'pending', prospect_id: 100, submitted_by: 8, submitted_at: '2026-10-15T01:00:00Z', snapshot_after: { sale_amount: 21990, prospect_name: 'New Client' } },
            { id: 2, approval_type: 'new_customer', status: 'pending', prospect_id: 100, submitted_by: 8, submitted_at: '2026-10-15T01:00:01Z', snapshot_after: { full_name: 'New Client', closing_record: { sale_amount: 21990 } } },
            { id: 3, approval_type: 'new_sale', status: 'pending', prospect_id: 101, submitted_by: 8, submitted_at: '2026-10-15T02:00:00Z', snapshot_after: { sale_amount: 5000, prospect_name: 'Old Client' } },
            { id: 4, approval_type: 'info_update', status: 'pending', prospect_id: 101, submitted_by: 8, submitted_at: '2026-10-15T03:00:00Z', snapshot_after: {} },
        ],
    };
};
const q = (id) => DB.approval_queue.find(r => r.id === id).status;

async function main() {
    // ── 1. Permission ──
    fresh(); window._appState.cu = AGENT; rpcResult = false;
    await app.approveQueueEntry(1);
    eq('ungranted user: refused', toasts[0], ['err', 'Not permitted']);
    eq('ungranted user: nothing booked or approved', [booked.length, q(1), q(2)], [0, 'pending', 'pending']);
    eq('ungranted: conversion refused too', (await app.approveProspectConversion(100), [DB.prospects[0].status, booked.length]), ['active', 0]);

    fresh(); window._appState.cu = { ...OO, id: 77 }; rpcResult = true; // new uid → fresh RPC check
    eq('granted L5 is an approver', await app.canApproveSales(), true);

    // ── 2. No lost sale: approve the new_sale row of a not-yet-customer ──
    fresh(); window._appState.cu = OO; rpcResult = true;
    await app.approveQueueEntry(1);
    eq('sale booked once at RM21,990', booked.map(b => b.amount), [21990]);
    eq('prospect converted', DB.prospects[0].status, 'converted');
    eq('both paired rows approved', [q(1), q(2)], ['approved', 'approved']);
    eq('closing record archived as approved', DB.prospects[0].closing_records_history.map(c => c.status), ['approved']);
    eq('customer created from the prospect', DB.customers.filter(c => c.converted_from_prospect_id === 100).length, 1);

    // Approving the conversion row first also closes the paired sale row (no dead entry).
    fresh(); window._appState.cu = OO; rpcResult = true;
    await app.approveQueueEntry(2);
    eq('conversion-first: booked once, both rows approved', [booked.map(b => b.amount), q(1), q(2)], [[21990], 'approved', 'approved']);
    await app.approveQueueEntry(1);
    eq('re-approving the closed sale row books nothing more', booked.length, 1);

    // Existing customer's extra sale still books via the original path.
    fresh(); window._appState.cu = OO; rpcResult = true;
    await app.approveQueueEntry(3);
    eq('additional sale on existing customer', [booked.map(b => [b.customerId, b.amount]), q(3)], [[[501, 5000]], 'approved']);

    // ── 3. Pop-up list ──
    fresh(); window._appState.cu = OO; rpcResult = true;
    await app.openSaleApprovals();
    eq('pop-up title counts sales, hides paired conversion and info_update', lastModal && lastModal.title, 'Sales to approve (2)');
    eq('pop-up shows both clients', ['New Client', 'Old Client'].every(n => lastModal.html.includes(n)), true);
    eq('pop-up shows amount', lastModal.html.includes('RM 21,990'), true);

    fresh(); window._appState.cu = AGENT; rpcResult = false;
    await app.openSaleApprovals();
    eq('pop-up refused for ungranted user', [lastModal, toasts[0]], [null, ['err', 'Not permitted']]);

    console.log(`test-sale-approver: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('FAIL', e); process.exit(1); });
