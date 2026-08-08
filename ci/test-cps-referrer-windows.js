// ci/test-cps-referrer-windows.js — CPS card momentum line: rolling 90d vs 365d
// distinct referrer head-counts.
//
// WHY these things are pinned:
//
//   1. HEAD-COUNT, NOT REFERRAL COUNT. The whole point of the line: an agent who
//      referred 3 CPS in 90 days is ONE head. If this regresses the number silently
//      inflates and "2/8" starts reading as sessions.
//   2. SUBSET INVARIANT. 90d is a strict subset of 365d, so agents90 <= agents365
//      must hold for every input. A violation means the two windows were computed
//      from different populations — the exact bug a second fetch would introduce.
//   3. BOUNDARIES. Windows are inclusive on BOTH ends (90 days = today-89..today).
//      Off by one here silently moves people in and out of "active".
//   4. THE WINDOWS IGNORE THE TIME FILTER BUT HONOUR THE SCOPE FILTERS. That split
//      is the design; getting it backwards means either a number that moves when it
//      shouldn't, or org-wide counts under a single-agent headline.
//   5. ONE FETCH FOR TWO WINDOWS. refreshKPIDashboard runs calculateKPIs for the
//      current and previous periods in PARALLEL and both reach this function. The
//      promise cache must collapse that into a single 365-day read, or the most
//      expensive query on the dashboard doubles.
//
// HARNESS: loads the REAL chunks/script-reporting.js into a stubbed browser and
// injects an export hook just before app.register(). No logic duplicated here.
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

// ── Data fixtures + a fetch counter ─────────────────────────────────────────
let ACTIVITIES = [], PROSPECTS = [], USERS = [];
let RANGE_FETCHES = 0;
global.AppDataStore = {
    getAll: async (t) => (t === 'activities' ? ACTIVITIES
        : t === 'prospects' ? PROSPECTS
        : t === 'users' ? USERS
        : []),
    getActivitiesInRange: async (from, to) => {
        RANGE_FETCHES++;
        return ACTIVITIES.filter(a => !a.activity_date || (a.activity_date >= from && a.activity_date <= to));
    },
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
        getCPSReferrerWindows, getCPSReferrerSplit,
        _cpsWindowParts, _windowLineHtml, _newCustomerWindowParts,
        _buildKpiCards, renderKPIStats, getNewCustomers365, getNewCustomers,
        _CPS_WINDOW_RECENT_DAYS, _CPS_WINDOW_WIDE_DAYS,
        setScope: (vis, role) => { _visibleUserIds = vis; _currentRoleFilter = role; },
        resetWindows: () => { _windowCaches.clear(); },
        setTimeFilter: (f) => { _currentTimeFilter = f; },
    };
    ${ANCHOR}`);
try { (0, eval)(src); } catch (e) { console.error('FAIL loading chunk: ' + e.message); process.exit(1); }
const T = global.window.__T;
ok('harness reached the chunk internals', T && typeof T.getCPSReferrerWindows === 'function');
if (!T) process.exit(1);

eq('windows are 90 and 365 days', [T._CPS_WINDOW_RECENT_DAYS, T._CPS_WINDOW_WIDE_DAYS], [90, 365]);

// Dates are built relative to the REAL today, exactly as the chunk does, so the
// boundary cases stay true whatever day this suite runs on.
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };

let _id = 0;
// One CPS session on `date`, for a prospect referred by `ref`, led by `lead`.
const cps = (ref, date, opts = {}) => {
    const pid = ++_id;
    PROSPECTS.push({
        id: pid, full_name: 'P' + pid,
        referred_by: ref ? ref.name : '',
        referred_by_id: ref ? ref.id : null,
        referred_by_type: ref ? ref.type : null,
    });
    ACTIVITIES.push({
        id: 10000 + pid, activity_type: opts.type || 'CPS', activity_date: date,
        prospect_id: pid, lead_agent_id: opts.lead == null ? 7 : opts.lead,
        activity_title: 'CPS With P' + pid,
    });
};
const agentRef = (id, name) => ({ id, name, type: 'Consultant' });
const clientRef = (id, name) => ({ id, name, type: 'Prospect' });

const reset = () => {
    ACTIVITIES = []; PROSPECTS = []; USERS = []; RANGE_FETCHES = 0; _id = 0;
    T.setScope('all', 'All'); T.resetWindows();
};

async function main() {

// ── 1. The worked example from the request ──────────────────────────────────
// "Agent (90d)/agent (365d) | Prospect (90d)/(365d)  →  (2/8) | (9/20)"
reset();
{
    // 8 agent referrers over the year, 2 of them also in the last 90 days.
    for (let i = 1; i <= 8; i++) cps(agentRef(100 + i, 'Agent' + i), daysAgo(200));
    cps(agentRef(101, 'Agent1'), daysAgo(10));
    cps(agentRef(102, 'Agent2'), daysAgo(10));
    // 20 client referrers over the year, 9 of them also in the last 90 days.
    for (let i = 1; i <= 20; i++) cps(clientRef(200 + i, 'Client' + i), daysAgo(200));
    for (let i = 1; i <= 9; i++) cps(clientRef(200 + i, 'Client' + i), daysAgo(30));

    const w = await T.getCPSReferrerWindows();
    eq('the worked example: 2/8 agents, 9/20 clients',
        [w.agents90, w.agents365, w.clients90, w.clients365], [2, 8, 9, 20]);
    eq('…and it renders in the asked-for shape',
        T._cpsWindowParts(w.agents90, w.agents365, w.clients90, w.clients365),
        ['Referrers 90d / 365d', '👤 2/8 agent', '🤝 9/20 client']);
}

// ── 2. Head-count, not referral count ───────────────────────────────────────
reset();
{
    cps(agentRef(11, 'Wong'), daysAgo(5));
    cps(agentRef(11, 'Wong'), daysAgo(6));
    cps(agentRef(11, 'Wong'), daysAgo(7));
    const w = await T.getCPSReferrerWindows();
    eq('one agent, three CPS in 90d → 1 head in both windows',
        [w.agents90, w.agents365], [1, 1]);
    eq('…and the roster shows the three sessions against that one person',
        w.roster.map(r => [r.name, r.sessions]), [['Wong', 3]]);
}
reset();
{
    for (let i = 0; i < 10; i++) cps(clientRef(21, 'Prospect A'), daysAgo(i + 1));
    const w = await T.getCPSReferrerWindows();
    eq('one prospect, ten CPS in 90d → 1 head', [w.clients90, w.clients365], [1, 1]);
}

// ── 3. Subset invariant ─────────────────────────────────────────────────────
reset();
{
    for (let i = 1; i <= 12; i++) cps(agentRef(300 + i, 'A' + i), daysAgo(i * 25));
    for (let i = 1; i <= 12; i++) cps(clientRef(400 + i, 'C' + i), daysAgo(i * 25));
    const w = await T.getCPSReferrerWindows();
    ok('agents90 <= agents365', w.agents90 <= w.agents365, `${w.agents90} > ${w.agents365}`);
    ok('clients90 <= clients365', w.clients90 <= w.clients365, `${w.clients90} > ${w.clients365}`);
    ok('…and 365 actually caught more than 90', w.agents365 > w.agents90);
}

// ── 4. Boundaries — inclusive on both ends ──────────────────────────────────
reset();
{
    cps(agentRef(1, 'EdgeIn90'), daysAgo(89));    // == from90
    cps(agentRef(2, 'EdgeOut90'), daysAgo(90));   // one day before from90
    cps(agentRef(3, 'EdgeIn365'), daysAgo(364));  // == from365
    cps(agentRef(4, 'EdgeOut365'), daysAgo(365)); // one day before from365
    const w = await T.getCPSReferrerWindows();
    eq('day 89 is inside the 90-day window, day 90 is not; day 364 inside 365, day 365 not',
        [w.agents90, w.agents365], [1, 3]);
    const names = w.roster.map(r => r.name).sort();
    eq('…and the roster holds exactly the three inside the year',
        names, ['EdgeIn365', 'EdgeIn90', 'EdgeOut90']);
}
reset();
{
    cps(agentRef(1, 'Today'), daysAgo(0));
    const w = await T.getCPSReferrerWindows();
    eq('a CPS logged today counts in both windows', [w.agents90, w.agents365], [1, 1]);
}

// ── 5. Agent vs client bucketing, and the composite key ─────────────────────
reset();
{
    cps(agentRef(5, 'Agent Five'), daysAgo(5));
    cps(clientRef(5, 'Prospect Five'), daysAgo(5));
    const w = await T.getCPSReferrerWindows();
    eq('same id, different referrer type = two different people',
        [w.agents90, w.clients90], [1, 1]);
}
reset();
{
    cps(null, daysAgo(5));
    const w = await T.getCPSReferrerWindows();
    eq('a CPS with no referrer counts toward nobody',
        [w.agents365, w.clients365, w.roster.length], [0, 0, 0]);
}
reset();
{
    cps(agentRef(1, 'A'), daysAgo(5), { type: 'CALL' });
    const w = await T.getCPSReferrerWindows();
    eq('non-CPS activities are ignored', [w.agents365, w.clients365], [0, 0]);
}

// ── 6. Scope gates: follows agent + role, ignores the time filter ───────────
reset();
{
    USERS = [{ id: 7, role: 'Level 3 Agent' }, { id: 8, role: 'Level 5 Team Leader' }];
    cps(agentRef(11, 'RefOfSeven'), daysAgo(5), { lead: 7 });
    cps(agentRef(12, 'RefOfEight'), daysAgo(5), { lead: 8 });

    T.resetWindows();
    let w = await T.getCPSReferrerWindows();
    eq('unscoped sees both', w.agents90, 2);

    T.setScope([7], 'All'); T.resetWindows();
    w = await T.getCPSReferrerWindows();
    eq('agent filter narrows the windows too', w.agents90, 1);
    eq('…to the right person', w.roster.map(r => r.name), ['RefOfSeven']);

    T.setScope('all', 'Level 5 Team Leader'); T.resetWindows();
    w = await T.getCPSReferrerWindows();
    eq('role filter narrows the windows too', w.agents90, 1);
    eq('…to the right person', w.roster.map(r => r.name), ['RefOfEight']);

    // The scope gates must agree head-for-head with the period split on the same
    // fixture — the two lines on the card describe one population or neither is
    // trustworthy.
    T.setScope([7], 'All'); T.resetWindows();
    const split = await T.getCPSReferrerSplit(daysAgo(89), daysAgo(0));
    w = await T.getCPSReferrerWindows();
    eq('windows and period split agree when the period IS the 90-day window',
        [w.agents90, w.clients90], [split.agents, split.clients]);
}

// ── 7. Roster: who went quiet ───────────────────────────────────────────────
reset();
{
    cps(agentRef(1, 'StillActive'), daysAgo(300));
    cps(agentRef(1, 'StillActive'), daysAgo(10));
    cps(agentRef(2, 'WentQuiet'), daysAgo(300));
    cps(clientRef(3, 'QuietClient'), daysAgo(200));
    const w = await T.getCPSReferrerWindows();
    eq('roster flags who is still active in the last 90 days',
        w.roster.map(r => [r.name, r.recent]),
        [['StillActive', true], ['WentQuiet', false], ['QuietClient', false]]);
    eq('…recent people sort first', w.roster[0].name, 'StillActive');
    eq('…lastDate is the most recent session', w.roster[0].lastDate, daysAgo(10));
    eq('…and sessions count every CPS in the 365-day window', w.roster[0].sessions, 2);
    eq('the headline pair matches the roster', [w.agents90, w.agents365], [1, 2]);
}

// ── 8. One fetch for two windows, and for two parallel callers ──────────────
reset();
{
    cps(agentRef(1, 'A'), daysAgo(5));
    RANGE_FETCHES = 0;
    const [a, b] = await Promise.all([T.getCPSReferrerWindows(), T.getCPSReferrerWindows()]);
    eq('two PARALLEL callers share one 365-day read', RANGE_FETCHES, 1);
    ok('…and both get the same object', a === b);

    await T.getCPSReferrerWindows();
    eq('a later caller inside the TTL still reads nothing', RANGE_FETCHES, 1);

    T.setScope([7], 'All');
    await T.getCPSReferrerWindows();
    eq('changing scope busts the cache', RANGE_FETCHES, 2);
}

// ── 9. A failed read must not stick in the cache for the whole TTL ──────────
reset();
{
    cps(agentRef(1, 'A'), daysAgo(5));
    const realGetAll = global.AppDataStore.getAll;
    global.AppDataStore.getAll = async (t) => { if (t === 'prospects') throw new Error('boom'); return realGetAll(t); };
    let threw = false;
    try { await T.getCPSReferrerWindows(); } catch (_) { threw = true; }
    ok('a read failure propagates rather than returning junk', threw);
    global.AppDataStore.getAll = realGetAll;
    // try/catch so a poisoned cache reports a clean FAIL here rather than throwing
    // out of the whole suite.
    let w = null, replayErr = null;
    try { w = await T.getCPSReferrerWindows(); } catch (e) { replayErr = e; }
    eq('…and the very next call retries instead of replaying the failure',
        replayErr ? `threw again: ${replayErr.message}` : w.agents90, 1);
}

// ── 10. Card wiring ─────────────────────────────────────────────────────────
{
    const kpis = {
        cpsCount: 7, totalSales: 0, popCaseCount: 0, popSales: 0, newAgents: 0, newCustomers: 0,
        conversionRate: 0, totalMeetings: 0, clientMeetings: 0, activityHeadcount: 0,
        eppCaseCount: 0, agentHours: '0 / 90h', agentHoursPct: 0, eppDetails: [],
        cpsAgentReferrers: 2, cpsClientReferrers: 1, cpsUnattributed: 0,
        cpsAgents90: 2, cpsAgents365: 8, cpsClients90: 9, cpsClients365: 20,
    };
    const cards = T._buildKpiCards(kpis, { ...kpis });
    const cpsCard = cards.find(c => c.key === 'cpsCount');
    eq('the CPS card carries the window line',
        cpsCard.windowParts, ['Referrers 90d / 365d', '👤 2/8 agent', '🤝 9/20 client']);
    eq('…and still carries the period chips underneath',
        cpsCard.cpsSplitParts, ['👤 2 agent referrers', '🤝 1 client referrer']);
    // The slot is generic now, so pin the exact set rather than "only CPS" — a card
    // silently gaining or losing a window line should fail here.
    eq('exactly these cards carry a rolling-window line',
        cards.filter(c => (c.windowParts || []).length).map(c => c.key).sort(),
        ['cpsCount', 'highTouchProspects', 'newCustomers']);

    // The window label is load-bearing: these numbers ignore the time filter, so
    // without it on screen they read as a stuck value.
    ok('the rendered line names its windows', /90d\s*\/\s*365d/.test(T._windowLineHtml(cpsCard.windowParts)));
    ok('…and one chip per span so a 182px card wraps between chips, not inside one',
        (T._windowLineHtml(cpsCard.windowParts).match(/<span/g) || []).length === 3);

    // The LEGACY by-id grid is a separate render site from _buildKpiCards (it is the
    // fallback when the React re-mount fails). Both must carry the line or the
    // fallback silently drops it — assert against the real innerHTML it writes.
    const grid = { id: 'kpi-stats-grid', innerHTML: '' };
    ELEMENTS.set('kpi-stats-grid', grid);
    T.renderKPIStats(kpis, { ...kpis }, true);
    ok('the legacy grid renders the window line', /Referrers 90d \/ 365d/.test(grid.innerHTML),
        grid.innerHTML.slice(0, 300));
    ok('…with the numbers', /2\/8 agent/.test(grid.innerHTML) && /9\/20 client/.test(grid.innerHTML));
    ok('…ABOVE the headline value, which is what was asked for',
        grid.innerHTML.indexOf('Referrers 90d / 365d') < grid.innerHTML.indexOf('stat-value'));
    ok('…and the period chips still render BELOW it',
        grid.innerHTML.indexOf('stat-value') < grid.innerHTML.indexOf('agent referrers'));
    ELEMENTS.delete('kpi-stats-grid');
}

// ── 11. Zero state ──────────────────────────────────────────────────────────
reset();
{
    const w = await T.getCPSReferrerWindows();
    eq('no CPS at all → all zeros, empty roster',
        [w.agents90, w.agents365, w.clients90, w.clients365, w.roster.length], [0, 0, 0, 0, 0]);
    eq('…and it renders as 0/0', T._cpsWindowParts(0, 0, 0, 0),
        ['Referrers 90d / 365d', '👤 0/0 agent', '🤝 0/0 client']);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('FAIL (uncaught): ' + (e && e.stack || e)); process.exit(1); });
