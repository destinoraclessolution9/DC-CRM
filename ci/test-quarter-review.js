// ci/test-quarter-review.js — Quarter Review workbook (Reports → export button).
//
// WHY: the export replaces the old metric-key CSV with the per-agent PRSB table
// used at the quarter review meeting. Every number is computed in one in-memory
// pass (_qrLoad → agg(from, to)) rather than through the dashboard getters, so
// this pins each column's counting rule against a small hand-checked fixture:
// credit attribution (CPS lead agent, purchase agent_id first), POP + NPO, the
// 傳福大使 total/active/new split, existing-customer meetings, NEA via
// reporting_to, event buckets, scope gates, and the period/comparison windows.
//
// HARNESS: loads the REAL chunks/script-reporting.js into a stubbed browser
// (same pattern as test-cps-referrer-split.js). Set EXCELJS_PATH to an installed
// exceljs package to also build the workbook and write it to QR_OUT.
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
const ok = (name, cond, detail) => {
    if (cond) { pass++; return; }
    fail++;
    console.error(`FAIL ${name}${detail ? '\n  ' + detail : ''}`);
};

global.window = global;
const store = new Map();
global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
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
global.supabase = { from: (table) => { const q = { select: () => q, gte: () => q, lt: () => q, lte: () => q,
    then: (r) => r({ data: table === 'users' ? (DB.users_join || []) : (DB.npo_sales || []), error: null }) }; return q; } };

let EXCEL = null;
if (process.env.EXCELJS_PATH) { EXCEL = require(process.env.EXCELJS_PATH); global.ExcelJS = EXCEL; }
global.window._ensureExcelJs = async () => {};
global.window._ensureChartJs = async () => {}; // no Chart global → charts degrade to a text placeholder

const chunkPath = path.join(__dirname, '..', 'chunks', 'script-reporting.js');
let src = fs.readFileSync(chunkPath, 'utf8');
const ANCHOR = "app.register('reporting', {";
if (!src.includes(ANCHOR)) { console.error('FAIL: register anchor not found'); process.exit(1); }
src = src.replace(ANCHOR, `window.__T = { _qrLoad, _qrPeriods, _qrMonths, _qrBuildWorkbook,
        setScope: (vis, role) => { _visibleUserIds = vis; _currentRoleFilter = role; },
        setRange: (f, from, to) => { _currentTimeFilter = f; _customDateFrom = from; _customDateTo = to; } };
    ${ANCHOR}`);
try { (0, eval)(src); } catch (e) { console.error('FAIL loading chunk: ' + e.message); process.exit(1); }
const T = global.window.__T;
ok('harness reached the chunk internals', T && typeof T._qrLoad === 'function');
if (!T) process.exit(1);

async function main() {
    // ── Periods ─────────────────────────────────────────────────────────────
    const pq = T._qrPeriods('2026-07-01', '2026-09-30');
    eq('full quarter label', pq.current.label, '2026 Q3');
    eq('previous quarters', pq.prev.map(p => [p.label, p.from, p.to]), [['2026 Q2', '2026-04-01', '2026-06-30'], ['2026 Q1', '2026-01-01', '2026-03-31']]);
    const pip = T._qrPeriods('2026-10-01', '2026-10-15');
    eq('quarter in progress', [pip.current.label, pip.prev[0].label], ['2026 Q4 (to 2026-10-15)', '2026 Q3']);
    const pc = T._qrPeriods('2026-10-05', '2026-10-11');
    eq('custom range compares equal-length windows', pc.prev.map(p => [p.from, p.to]), [['2026-09-28', '2026-10-04'], ['2026-09-21', '2026-09-27']]);
    eq('months clipped to range', T._qrMonths('2026-07-15', '2026-09-10').map(m => [m.label, m.from, m.to]),
        [['JUL 2026', '2026-07-15', '2026-07-31'], ['AUG 2026', '2026-08-01', '2026-08-31'], ['SEP 2026', '2026-09-01', '2026-09-10']]);

    // ── Fixture ─────────────────────────────────────────────────────────────
    // Agents 7 (Oo) and 8 (Lau); 9 is a manager outside the agent band; 10 is a
    // new recruit reporting to 7.
    DB = {
        users: [
            { id: 7, full_name: 'Oo', role: 'Level 5 Team Leader', agent_code: 'EA7' },
            { id: 8, full_name: 'Lau', role: 'Level 3 Agent', agent_code: 'EA8' },
            { id: 9, full_name: 'Boss', role: 'Level 1 Super Admin' },
            // join_date deliberately absent here: the live light select drops it.
            { id: 10, full_name: 'Newbie', role: 'Level 12 Agent', reporting_to: 7 },
        ],
        prospects: [
            { id: 1, responsible_agent_id: 7, referred_by_id: 50, referred_by_type: 'Prospect', referred_by: 'Ambassador A' },
            { id: 2, responsible_agent_id: 7, referred_by_id: 50, referred_by_type: 'Prospect', referred_by: 'Ambassador A' },
            { id: 3, responsible_agent_id: 8, referred_by_id: 8, referred_by_type: 'Consultant', referred_by: 'Lau' },
            { id: 4, responsible_agent_id: 7, referred_by_id: 51, referred_by_type: 'Prospect', referred_by: 'Ambassador B' },
            { id: 5, responsible_agent_id: 7, referred_by_id: 52, referred_by_type: 'Prospect', referred_by: 'Old Ambassador' },
            { id: 60, responsible_agent_id: 7 },
        ],
        customers: [
            { id: 100, responsible_agent_id: 7, customer_since: '2026-08-20', full_name: 'New C' },
            { id: 101, responsible_agent_id: 7, customer_since: '2025-01-01', full_name: 'Old C', converted_from_prospect_id: 60 },
            { id: 102, responsible_agent_id: 8, customer_since: '2026-07-02', full_name: 'Lau C' },
            { id: 103, responsible_agent_id: 8, customer_since: '2026-07-24', full_name: 'Imported, no purchase' },
        ],
        activities: [
            // Old Ambassador referred once in Q1 (not active in Q3, still in the total).
            { id: 1, activity_type: 'CPS', activity_date: '2026-02-01', prospect_id: 5, lead_agent_id: 7 },
            // Ambassador A: two CPS in Q3 (new — first ever), Ambassador B: one in Q3.
            { id: 2, activity_type: 'CPS', activity_date: '2026-07-10', prospect_id: 1, lead_agent_id: 7 },
            { id: 3, activity_type: 'CPS', activity_date: '2026-08-10', prospect_id: 2, lead_agent_id: 7 },
            { id: 4, activity_type: 'CPS', activity_date: '2026-09-10', prospect_id: 4, lead_agent_id: 7 },
            // Agent-referred CPS: counts as CPS but never as 傳福大使.
            { id: 5, activity_type: 'CPS', activity_date: '2026-07-20', prospect_id: 3, lead_agent_id: 8 },
            { id: 6, activity_type: 'FSA', activity_date: '2026-08-15', customer_id: 101, lead_agent_id: 7 },
            // FTF with the converted prospect record of the old customer → existing customer meeting.
            { id: 7, activity_type: 'FTF', activity_date: '2026-09-01', prospect_id: 60, lead_agent_id: 7 },
            // Closing logged on a meeting, client never got a purchase → data check.
            { id: 901, activity_type: 'SITE', activity_date: '2026-08-20', prospect_id: 4, lead_agent_id: 7, closing_amount: 12000 },
            // Closing that DID become a purchase (customer 100 bought in Q3) → not flagged.
            { id: 902, activity_type: 'OTHERS', activity_date: '2026-08-21', customer_id: 100, lead_agent_id: 7, closing_amount: 19990 },
            { id: 900, activity_type: 'EVENT', activity_date: '2026-08-02', event_id: 'e1', lead_agent_id: 9 },
            // Q2 activity for the comparison sheet.
            { id: 8, activity_type: 'CPS', activity_date: '2026-05-05', prospect_id: 3, lead_agent_id: 8 },
        ],
        purchases: [
            { id: 1, customer_id: 100, date: '2026-08-21', amount: 19990, payment_method: 'Cash', item: '六曜指环 Power Ring 6 + 圣智 Calligraphy' },
            { id: 2, customer_id: 101, date: '2026-09-02', amount: 25980, payment_method: 'POP', item: '灵活风水 Flexi Audit' },
            // agent_id frozen at booking beats the customer's current owner.
            { id: 3, customer_id: 101, date: '2026-09-05', amount: 5000, payment_method: 'Cash', agent_id: 8, item: 'Books x 2' },
            { id: 4, customer_id: 102, date: '2026-07-05', amount: 9999, payment_method: 'Cash', is_agent_package: true, item: 'DC 代理配套' },
            { id: 5, customer_id: 102, date: '2026-05-01', amount: 1000, payment_method: 'Cash', item: 'x' },
            { id: 6, customer_id: 101, date: '2027-10-01', amount: 21980, payment_method: 'Cash', item: 'typo date' },
        ],
        npo_sales: [
            { cart_total: 30000, responsible_agent_id: 8, status: 'active', start_date: '2026-08-01' },
            { cart_total: 99999, responsible_agent_id: 8, status: 'cancelled', start_date: '2026-08-01' },
        ],
        users_join: [{ id: 10, join_date: '2026-08-03' }],
        events: [{ id: 'e1', categories: '["老板每月主题课"]', date: '2026-08-02' }, { id: 'e2', categories: '["汇集灵活-Condo","博物馆"]', date: '2026-09-03' }],
        event_attendees: [
            { event_id: 'e1', activity_id: 900, attended: true, attendance_status: 'Attended', attendee_type: 'prospect', entity_id: 1 },
            { event_id: 'e1', activity_id: 900, attended: false, attendance_status: 'Registered', attendee_type: 'prospect', entity_id: 2 },
            // no activity row → falls back to the event's own date
            { event_id: 'e2', attended: true, attendance_status: 'Attended', attendee_type: 'customer', attendee_id: 102 },
            { event_id: 'e2', attended: true, attendance_status: 'Attended', attendee_type: 'agent', attendee_id: 7 },
        ],
    };
    T.setScope('all', 'All');
    const D = await T._qrLoad('2026-01-01', '2026-09-30');
    eq('agents = agent band only', D.agents.map(u => u.id).sort((a, b) => a - b), [7, 8, 10]);
    eq('客户# = whole book', [D.custCount.get('7'), D.custCount.get('8')], [2, 2]);

    const q3 = D.agg('2026-07-01', '2026-09-30');
    const o = q3.get('7'), l = q3.get('8');
    eq('Oo CPS / FSA', [o.cps, o.fsa], [3, 1]);
    eq('Lau CPS', l.cps, 1);
    eq('NC needs a purchase in the same window (103 bought nothing)', [o.nc, l.nc], [1, 1]);
    eq('Oo sales (agent_id-frozen sale goes to Lau)', o.sales, 19990 + 25980);
    eq('Lau sales excludes agent package', l.sales, 5000);
    eq('POP = POP purchases + live NPO orders', [o.pop, o.popRm, l.pop, l.popRm], [1, 25980, 1, 30000]);
    eq('DO excludes POP', [o.doSales, l.doSales], [19990, 5000]);
    eq('product counts from item text', [o.pr, o.art, o.flexi], [1, 1, 1]);
    eq('existing-customer meetings (FSA + FTF on converted prospect)', [o.meetOld, o.oldMet.size], [2, 1]);
    eq('existing customer met AND bought', [o.oldBought.size, o.oldOrders], [1, 2]);
    eq('傳福大使 total / active / new', [o.cfAll.size, o.cfActive.size, o.cfNew.size], [3, 2, 2]);
    eq('CPS# from 傳福大使', o.cpsFromCf, 3);
    eq('agent referrer is never a 傳福大使', l.cfAll.size, 0);
    eq('NEA via reporting_to', o.nea, 1);
    eq('funnel: client meetings and closings', [o.meet, o.orders, l.orders], [2, 2, 2]);
    const dc = D.dataCheck('2026-07-01', '2026-09-30');
    eq('data check: closing without a sale', dc.pending.map(x => x.amount), [12000]);
    eq('data check: impossible purchase date', dc.oddDates.map(x => x.date), ['2027-10-01']);
    eq('events: attended non-agents only, bucketed', [o.laoban, l.hj, l.mz, o.hj], [1, 1, 1, 0]);

    const q2 = D.agg('2026-04-01', '2026-06-30');
    eq('Q2 window', [q2.get('8').cps, q2.get('8').sales], [1, 1000]);
    // Old Ambassador referred in Q1 → in the Q1 window they are new.
    eq('Q1 new ambassador', D.agg('2026-01-01', '2026-03-31').get('7').cfNew.size, 1);

    // Scope: only agent 8 visible.
    T.setScope([8], 'All');
    const D8 = await T._qrLoad('2026-01-01', '2026-09-30');
    const s8 = D8.agg('2026-07-01', '2026-09-30');
    eq('scope keeps only visible agents', [...s8.keys()].sort(), ['8']);
    eq('scoped agent list', D8.agents.map(u => u.id), [8]);
    T.setScope('all', 'All');

    // ── Workbook (optional) ─────────────────────────────────────────────────
    if (EXCEL) {
        T.setRange('custom', '2026-07-01', '2026-09-30');
        const { wb } = await T._qrBuildWorkbook();
        eq('sheet names', wb.worksheets.map(w => w.name), ['Dashboard', 'Summary', '2026 Q3', 'Comparison', 'Sales Details', 'Notes']);
        const s0 = wb.getWorksheet('Dashboard');
        eq('dashboard tiles: sales / CPS / NC', [s0.getCell('A5').value, s0.getCell('C5').value, s0.getCell('E5').value], [50970, 4, 2]);
        eq('dashboard tile delta vs Q2', s0.getCell('A6').value, '▲ 4997% vs 2026 Q2');
        const txt = [];
        s0.eachRow(r => r.eachCell(c => { if (typeof c.value === 'string') txt.push(c.value); }));
        ok('observation names the high-effort-no-sale agent rule', txt.some(t => t.startsWith('• ')), txt.join(' | '));
        ok('data check lists the 2027 typo-style future date', txt.some(t => t.includes('missing or impossible date')), txt.join(' | '));
        const s1 = wb.getWorksheet('Summary');
        eq('summary CPS / NC / SALES', [s1.getCell('F6').value, s1.getCell('H6').value, s1.getCell('I6').value], [4, 2, 50970]);
        eq('summary total is a formula', s1.getCell('I7').value, { formula: 'SUM(I6:I6)' });
        const s2 = wb.getWorksheet('2026 Q3');
        eq('agent sheet first row = top seller', s2.getCell('B6').value, 'Oo');
        if (process.env.QR_OUT) { await wb.xlsx.writeFile(process.env.QR_OUT); console.log('wrote', process.env.QR_OUT); }
    }

    console.log(`test-quarter-review: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('FAIL', e); process.exit(1); });
