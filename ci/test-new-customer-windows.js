// ci/test-new-customer-windows.js — New Customers card: "this period / 365d" line.
//
// WHY these things are pinned:
//
//   1. ONE METRIC, TWO SPANS. The left number IS the card's headline
//      (kpis.newCustomers) and the right comes from getNewCustomers with a wider
//      window — deliberately the SAME function, unchanged. If someone ever
//      reimplements the 365-day half, the two can disagree on the same card, which
//      is exactly how CF Headcount went wrong. The tests below lock the shared rule.
//   2. THE RULE IS NON-OBVIOUS. A customer counts only if customer_since is in the
//      window AND they have a purchase in that SAME window. Joined-but-not-bought
//      is zero. That is why a short period can legitimately read 0, and it must not
//      be "fixed" by accident.
//   3. THE LABEL FOLLOWS THE TIME FILTER, THE RIGHT-HAND NUMBER DOES NOT. The left
//      half moves with Weekly/Monthly/Quarterly/Yearly; 365d is always rolling.
//      Getting that backwards produces a number that lies about its own window.
//   4. SUBSET holds for the four presets (left <= right) but NOT for a custom range,
//      which can sit entirely outside the last 365 days. Asserting subset everywhere
//      would be wrong.
//   5. ONE COMPUTATION PER REFRESH. calculateKPIs runs for the current AND previous
//      period in parallel and both reach the 365-day getter; the promise cache must
//      collapse that.
//
// HARNESS: loads the REAL chunks/script-reporting.js with an export hook. No logic
// duplicated here.
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

// ── Fake browser ────────────────────────────────────────────────────────────
global.window = global;
const store = new Map();
global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};
const ELEMENTS = new Map();
const mkEl = (id) => ({ id, value: '', textContent: '', innerHTML: '', style: {}, dataset: {} });
global.document = {
    getElementById: (id) => ELEMENTS.get(id) || null,
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    createElement: () => ({ style: {}, appendChild() {}, setAttribute() {}, click() {} }),
    body: { appendChild() {}, removeChild() {} },
};
global.location = { search: '' };
global.UI = {
    toast: { success() {}, error() {}, warning() {}, info() {} },
    showModal: () => {}, hideModal: () => {},
    formatDate: (d) => String(d || ''),
    currencyForCountry: () => 'MYR',
};
global.app = { register: (_n, obj) => Object.assign(global.app, obj) };
global.window._appState = { cu: { id: 1, role: 'Level 1 Super Admin' }, cv: null };
global.window._crmUtils = {
    isSystemAdmin: () => true, isMarketingManager: () => false, isAgent: () => false,
    isManagement: () => true, isTeamLeaderOrAbove: () => true, isStockTakeStaff: () => false,
    escapeHtml: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    isMobile: () => false, withTimeout: (p) => p, timeAgo: () => '', generateId: () => 1,
    USER_ROLES: ['Level 3 Agent', 'Level 5 Team Leader'],
    ALL_COUNTRIES: '__ALL__',
    listCountryScope: () => '__ALL__',
    recordCountry: () => 'MY',
    getVisibleUserIds: async () => 'all',
};

// ── Fixtures + a fetch counter ──────────────────────────────────────────────
let CUSTOMERS = [], PURCHASES = [];
let CUSTOMER_FETCHES = 0;
global.AppDataStore = {
    getAll: async (t) => {
        if (t === 'customers') { CUSTOMER_FETCHES++; return CUSTOMERS; }
        if (t === 'purchases') return PURCHASES;
        return [];
    },
    getActivitiesInRange: async () => [],
    getById: async () => null,
    query: async () => [],
};
global.supabase = null;

// ── Load the real chunk with an export hook injected ────────────────────────
const chunkPath = path.join(__dirname, '..', 'chunks', 'script-reporting.js');
let src = fs.readFileSync(chunkPath, 'utf8');
const ANCHOR = "app.register('reporting', {";
if (!src.includes(ANCHOR)) { console.error('FAIL: register anchor not found — harness needs updating'); process.exit(1); }
src = src.replace(ANCHOR, `window.__T = {
        getNewCustomers, getNewCustomers365, _newCustomerWindowParts, _windowLineHtml,
        _buildKpiCards, renderKPIStats, _rollingFrom, _NEW_CUSTOMERS_WIDE_DAYS,
        setScope: (vis, role) => { _visibleUserIds = vis; _currentRoleFilter = role; },
        setTimeFilter: (f) => { _currentTimeFilter = f; },
        resetWindows: () => { _windowCaches.clear(); },
    };
    ${ANCHOR}`);
try { (0, eval)(src); } catch (e) { console.error('FAIL loading chunk: ' + e.message); process.exit(1); }
const T = global.window.__T;
ok('harness reached the chunk internals', T && typeof T.getNewCustomers365 === 'function');
if (!T) process.exit(1);

eq('the wide window is 365 days', T._NEW_CUSTOMERS_WIDE_DAYS, 365);

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
const TODAY = daysAgo(0);

let _id = 0;
// A customer who joined on `since`, optionally with a purchase on `bought`.
const cust = (since, bought, opts = {}) => {
    const id = ++_id;
    CUSTOMERS.push({ id, full_name: 'C' + id, customer_since: since, responsible_agent_id: opts.agent == null ? 7 : opts.agent });
    if (bought) PURCHASES.push({ id: 9000 + id, customer_id: id, date: bought, amount: 1000 });
    return id;
};

const reset = () => {
    CUSTOMERS = []; PURCHASES = []; CUSTOMER_FETCHES = 0; _id = 0;
    T.setScope('all', 'All'); T.setTimeFilter('monthly'); T.resetWindows();
};

async function main() {

// ── 1. The shared rule: joined AND bought, in the SAME window ───────────────
reset();
{
    cust(daysAgo(10), daysAgo(5));    // joined + bought inside 365 → counts
    cust(daysAgo(10), null);          // joined, never bought      → does NOT count
    cust(daysAgo(400), daysAgo(5));   // bought recently, joined too long ago → no
    cust(daysAgo(10), daysAgo(400));  // joined recently, bought too long ago → no
    eq('365d counts only joined-AND-bought-in-window', await T.getNewCustomers365(), 1);
}
reset();
{
    cust(daysAgo(3), daysAgo(2));
    eq('a customer who joined and bought counts once', await T.getNewCustomers365(), 1);
    // Two purchases must not double-count the person.
    PURCHASES.push({ id: 99999, customer_id: 1, date: daysAgo(1), amount: 500 });
    T.resetWindows();
    eq('…and two purchases still count them once', await T.getNewCustomers365(), 1);
}

// ── 2. The 365-day boundary, inclusive both ends ────────────────────────────
reset();
{
    cust(daysAgo(364), daysAgo(364));  // == from365
    cust(daysAgo(365), daysAgo(365));  // one day before
    eq('day 364 is inside the window, day 365 is not', await T.getNewCustomers365(), 1);
    eq('_rollingFrom(365) is today-364', T._rollingFrom(365), daysAgo(364));
    eq('_rollingFrom(1) is today', T._rollingFrom(1), TODAY);
}
reset();
{
    cust(TODAY, TODAY);
    eq('joined and bought today counts', await T.getNewCustomers365(), 1);
}

// ── 3. Subset: the selected period is inside the rolling year (presets) ─────
reset();
{
    for (let i = 0; i < 5; i++) cust(daysAgo(i * 60), daysAgo(i * 60));
    const wide = await T.getNewCustomers365();
    const month = await T.getNewCustomers(daysAgo(20), TODAY);
    const week = await T.getNewCustomers(daysAgo(6), TODAY);
    ok('week <= month <= 365d', week <= month && month <= wide, `${week}/${month}/${wide}`);
    ok('…and 365d actually saw more', wide > week);
}

// ── 4. Scope gates come free from getNewCustomers ───────────────────────────
reset();
{
    cust(daysAgo(5), daysAgo(5), { agent: 7 });
    cust(daysAgo(5), daysAgo(5), { agent: 8 });
    eq('unscoped sees both', await T.getNewCustomers365(), 2);
    T.setScope([7], 'All'); T.resetWindows();
    eq('the agent filter narrows the 365d half too', await T.getNewCustomers365(), 1);
}

// ── 5. One computation per refresh ──────────────────────────────────────────
reset();
{
    cust(daysAgo(5), daysAgo(5));
    CUSTOMER_FETCHES = 0;
    const [a, b] = await Promise.all([T.getNewCustomers365(), T.getNewCustomers365()]);
    eq('two PARALLEL callers share one computation', CUSTOMER_FETCHES, 1);
    eq('…and agree', a, b);
    await T.getNewCustomers365();
    eq('a later caller inside the TTL recomputes nothing', CUSTOMER_FETCHES, 1);
    T.setScope([7], 'All');
    await T.getNewCustomers365();
    eq('changing scope busts the cache', CUSTOMER_FETCHES, 2);
}

// ── 6. The label follows the time filter; 365d never does ──────────────────
{
    const labels = {};
    for (const f of ['weekly', 'monthly', 'quarterly', 'yearly', 'custom']) {
        T.setTimeFilter(f);
        labels[f] = T._newCustomerWindowParts(3, 240)[0];
    }
    eq('each filter names its own left-hand window', labels, {
        weekly: 'This week / 365d',
        monthly: 'This month / 365d',
        quarterly: 'This quarter / 365d',
        yearly: 'This year / 365d',
        custom: 'Selected range / 365d',
    });
    T.setTimeFilter('monthly');
    eq('the numbers render as current/365d', T._newCustomerWindowParts(3, 240)[1], '👥 3/240');
    eq('zero state', T._newCustomerWindowParts(0, 0), ['This month / 365d', '👥 0/0']);
}

// ── 7. Card wiring, BOTH render sites ──────────────────────────────────────
{
    T.setTimeFilter('monthly');
    const kpis = {
        cpsCount: 0, totalSales: 0, popCaseCount: 0, popSales: 0, newAgents: 0,
        newCustomers: 3, newCustomers365: 240,
        conversionRate: 0, totalMeetings: 0, clientMeetings: 0, activityHeadcount: 0,
        eppCaseCount: 0, agentHours: '0 / 90h', agentHoursPct: 0, eppDetails: [],
        cpsAgentReferrers: 0, cpsClientReferrers: 0, cpsUnattributed: 0,
        cpsAgents90: 0, cpsAgents365: 0, cpsClients90: 0, cpsClients365: 0,
    };
    const cards = T._buildKpiCards(kpis, { ...kpis });
    const nc = cards.find(c => c.key === 'newCustomers');
    eq('the React payload carries the line', nc.windowParts, ['This month / 365d', '👥 3/240']);
    eq('…and the headline is still the period value', nc.value, 3);

    // The legacy by-id grid is a SEPARATE render site (the React-remount fallback).
    const grid = { id: 'kpi-stats-grid', innerHTML: '' };
    ELEMENTS.set('kpi-stats-grid', grid);
    T.renderKPIStats(kpis, { ...kpis }, true);
    ok('the legacy grid renders it', /This month \/ 365d/.test(grid.innerHTML));
    ok('…with the numbers', /3\/240/.test(grid.innerHTML));

    // Position: above the New Customers headline specifically. Slice from this card's
    // label to the start of the NEXT card, so the CPS card's own window line can't
    // satisfy the assertion by accident. (Slicing a fixed length is fragile — the
    // tooltip text alone is longer than 900 chars.)
    const cardStart = grid.innerHTML.indexOf('New Customers');
    const nextCard = grid.innerHTML.indexOf('stat-card', grid.innerHTML.indexOf('stat-value', cardStart));
    const card = grid.innerHTML.slice(cardStart, nextCard > 0 ? nextCard : undefined);
    const iLine = card.indexOf('This month / 365d');
    const iValue = card.indexOf('stat-value');
    ok('both the line and the value are in this card', iLine >= 0 && iValue >= 0, card.slice(0, 200));
    ok('the line sits ABOVE that card\'s value', iLine >= 0 && iValue >= 0 && iLine < iValue,
        `line@${iLine} value@${iValue}`);
    ELEMENTS.delete('kpi-stats-grid');

    // A missing 365 figure must degrade to 0, not "undefined".
    const partial = T._buildKpiCards({ ...kpis, newCustomers365: undefined }, { ...kpis })
        .find(c => c.key === 'newCustomers');
    eq('a missing 365d figure renders 0, never undefined', partial.windowParts[1], '👥 3/0');
}

// ── 8. The existing calculation was not touched ────────────────────────────
reset();
{
    // Same fixture as the pre-existing behaviour: getNewCustomers over an explicit
    // window must still require BOTH conditions. This is the "don't change the
    // existing calculation" guard.
    cust(daysAgo(5), daysAgo(5));
    cust(daysAgo(5), null);
    eq('getNewCustomers(from,to) still requires a purchase in range',
        await T.getNewCustomers(daysAgo(30), TODAY), 1);
    eq('…and an empty window is 0', await T.getNewCustomers(daysAgo(300), daysAgo(200)), 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('FAIL (uncaught): ' + (e && e.stack || e)); process.exit(1); });
