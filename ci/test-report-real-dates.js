// ci/test-report-real-dates.js — weekly report counts by the REAL date, never the key-in day.
//
// WHY: owner 2026-10-19 — "if I backdate the data, use the invoice date, not my entry
// date". A sale, NPO order, event attendance or new agent keyed in late must land in
// the week it actually happened. This pins each source the weekly report reads:
//   - NPO orders     → npo_sales.start_date (order date), not created_at
//   - event headcount → event_attendees ticked Attended/Late, dated by the event
//                       activity's activity_date (event_registrations has no
//                       attendance/date columns live, so it always read 0)
//   - PJA new agents → users.join_date read straight from Supabase (the light
//                       users select omits it, so the count was always 0)
//
// HARNESS: loads the REAL chunks/script-reporting.js into a stubbed browser
// (same pattern as test-quarter-review.js).
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++;
    console.error(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
};

global.window = global;
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.document = {
    getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, addEventListener: () => {},
    createElement: () => ({ style: {}, appendChild() {}, setAttribute() {}, click() {} }),
    body: { appendChild() {}, removeChild() {} },
};
global.location = { search: '' };
global.UI = { toast: { success() {}, error() {}, warning() {}, info() {} }, showModal: () => {}, hideModal: () => {}, formatDate: (d) => String(d || ''), currencyForCountry: () => 'MYR' };
global.app = { register: (_n, obj) => Object.assign(global.app, obj) };
global.window._appState = { cu: { id: 1, full_name: 'Boss', role: 'Level 1 Super Admin' }, cv: null };
const levelOf = (u) => { const m = String((u && u.role) || '').match(/Level\s*(\d+)/i); return m ? +m[1] : 99; };
global.window._crmUtils = {
    isSystemAdmin: () => true, isMarketingManager: () => false,
    isAgent: (u) => { const l = levelOf(u); return l >= 3 && l <= 12; },
    isManagement: () => true, isTeamLeaderOrAbove: () => true, isStockTakeStaff: () => false,
    escapeHtml: (s) => String(s ?? ''), isMobile: () => false, withTimeout: (p) => p, timeAgo: () => '', generateId: () => 1,
    USER_ROLES: ['Level 3 Agent'], ALL_COUNTRIES: '__ALL__', listCountryScope: () => '__ALL__', recordCountry: () => 'MY',
    getVisibleUserIds: async () => 'all',
};

let DB = {};
global.AppDataStore = {
    getAll: async (t) => DB[t] || [],
    getActivitiesInRange: async (from, to) => (DB.activities || []).filter(a => a.activity_date >= from && a.activity_date <= to),
    getById: async () => null, query: async () => [],
};
// A Supabase stub that really applies gte/lte/lt/in, so a query on the wrong column
// (created_at instead of start_date) returns the wrong rows instead of passing silently.
const SB_TABLES = { npo_sales: () => DB.npo_sales || [], users: () => DB.users_full || [] };
global.supabase = {
    from: (table) => {
        let rows = (SB_TABLES[table] || (() => []))();
        const q = {
            select: () => q,
            gte: (c, v) => { rows = rows.filter(r => r[c] != null && String(r[c]) >= String(v)); return q; },
            lte: (c, v) => { rows = rows.filter(r => r[c] != null && String(r[c]) <= String(v)); return q; },
            lt: (c, v) => { rows = rows.filter(r => r[c] != null && String(r[c]) < String(v)); return q; },
            in: (c, vs) => { rows = rows.filter(r => vs.map(String).includes(String(r[c]))); return q; },
            then: (res) => res({ data: rows, error: null }),
        };
        return q;
    },
};

const chunkPath = path.join(__dirname, '..', 'chunks', 'script-reporting.js');
let src = fs.readFileSync(chunkPath, 'utf8');
const ANCHOR = "app.register('reporting', {";
if (!src.includes(ANCHOR)) { console.error('FAIL: register anchor not found'); process.exit(1); }
// Getters are read lazily — some are declared after the anchor.
src = src.replace(ANCHOR, `window.__T = { fns: () => ({ _getNPOWeekAgg, getEventCategoryHeadcount, getHeadcountByEventType, getNewAgents }),
        setScope: (vis, role) => { _visibleUserIds = vis; _currentRoleFilter = role; } };
    ${ANCHOR}`);
try { (0, eval)(src); } catch (e) { console.error('FAIL loading chunk: ' + e.message); process.exit(1); }

(async () => {
    const T = window.__T;
    T.setScope('all', 'All');
    const F = T.fns();
    const FROM = '2026-10-12', TO = '2026-10-18'; // W2 October 2026

    // ── NPO: order date wins over the key-in timestamp ──
    DB.npo_sales = [
        // sold in W2, keyed in a week later → COUNTS
        { start_date: '2026-10-14', created_at: '2026-10-21T03:00:00Z', cart_total: 10000, first_payment: 1000, responsible_agent_id: 8, status: 'active' },
        // sold in W1, keyed in during W2 → does NOT count
        { start_date: '2026-10-07', created_at: '2026-10-13T03:00:00Z', cart_total: 50000, first_payment: 5000, responsible_agent_id: 8, status: 'active' },
        // cancelled → never counts
        { start_date: '2026-10-15', created_at: '2026-10-15T03:00:00Z', cart_total: 99999, first_payment: 9, responsible_agent_id: 8, status: 'cancelled' },
        // last day of the window is inclusive
        { start_date: '2026-10-18', created_at: '2026-10-25T03:00:00Z', cart_total: 990, first_payment: 90, responsible_agent_id: 9, status: 'active' },
    ];
    const npo = await F._getNPOWeekAgg(FROM, TO);
    eq('NPO counts by start_date (order date), not created_at', npo, { count: 2, dp: 1090, total: 10990 });
    T.setScope([9], 'All');
    eq('NPO honours agent scope', await F._getNPOWeekAgg(FROM, TO), { count: 1, dp: 90, total: 990 });
    T.setScope('all', 'All');

    // ── Event headcount: event day from the activity, attendance from event_attendees ──
    DB.events = [
        { id: 100, title: 'Fengshui class', categories: JSON.stringify(['个人风水基础课']) },
        { id: 200, title: 'Monthly Talk Oct', categories: JSON.stringify(['老板每月主题课']) },
    ];
    DB.activities = [
        { id: 1, event_id: 100, activity_type: 'EVENT', activity_date: '2026-10-15' }, // W2
        { id: 2, event_id: 100, activity_type: 'EVENT', activity_date: '2026-10-08' }, // W1
        { id: 3, event_id: 100, activity_type: 'EVENT_CLOSING', activity_date: '2026-10-15' }, // a sale record
        { id: 4, event_id: 200, activity_type: 'EVENT', activity_date: '2026-10-17' }, // W2
    ];
    DB.event_attendees = [
        // W2 event, ticked late (created/ticked any time) → counts
        { activity_id: 1, event_id: 100, attendee_type: 'prospect', attendee_id: 11, attended: true, attendance_status: 'Attended', created_at: '2026-10-25T00:00:00Z' },
        // Late = attended
        { activity_id: 1, event_id: 100, attendee_type: 'customer', attendee_id: 12, attended: true, attendance_status: 'Late' },
        // registered only → no
        { activity_id: 1, event_id: 100, attendee_type: 'prospect', attendee_id: 13, attended: false, attendance_status: 'Registered' },
        // duplicate row for the same person + day → counted once
        { activity_id: 1, event_id: 100, attendee_type: 'prospect', attendee_id: 11, attended: true, attendance_status: 'Attended' },
        // W1 event ticked during W2 → no
        { activity_id: 2, event_id: 100, attendee_type: 'prospect', attendee_id: 14, attended: true, attendance_status: 'Attended', created_at: '2026-10-14T00:00:00Z' },
        // legacy row with only event_id 200 (one dated activity in range) → counts via the event
        { event_id: 200, attendee_type: 'agent', attendee_id: 5, attended: true, attendance_status: 'Attended' },
    ];
    // The old source must be ignored entirely.
    DB.event_registrations = [{ event_id: 100, attendance_status: 'Attended', event_date: '2026-10-15', attendee_type: 'prospect', attendee_id: 99 }];
    eq('FT(N) counts attended+late on the event day', await F.getEventCategoryHeadcount(FROM, TO, ['个人风水基础课']), 2);
    eq('IT-style attendee type filter (customer only)', await F.getEventCategoryHeadcount(FROM, TO, ['个人风水基础课'], ['customer']), 1);
    eq('legacy event_id-only row resolves via its single event activity', await F.getEventCategoryHeadcount(FROM, TO, ['老板每月主题课']), 1);
    eq('W1 window gets the W1 attendee', await F.getEventCategoryHeadcount('2026-10-05', '2026-10-11', ['个人风水基础课']), 1);
    const hc = await F.getHeadcountByEventType(FROM, TO);
    eq('dashboard Headcount by Event Type reads event_attendees', hc['Monthly Talk'], { prospects: 0, agents: 1, total: 1 });

    // ── PJA: join_date comes from the direct users read ──
    DB.users = [ // the light select: NO join_date
        { id: 5, full_name: 'New A', role: 'Level 3 Agent', created_at: '2026-10-20T00:00:00Z' },
        { id: 6, full_name: 'Old B', role: 'Level 3 Agent', created_at: '2026-10-13T00:00:00Z' },
        { id: 7, full_name: 'Cust C', role: 'Level 13 Customer' },
    ];
    DB.users_full = [
        { id: 5, join_date: '2026-10-16' }, // joined in W2, account created later → counts
        { id: 6, join_date: '2026-09-01' }, // created in W2 but joined earlier → no
        { id: 7, join_date: '2026-10-14' }, // not an agent → no
    ];
    eq('PJA counts by join_date, not account creation', await F.getNewAgents(FROM, TO), 1);

    console.log(`test-report-real-dates: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL crashed: ' + (e && e.stack || e)); process.exit(1); });
