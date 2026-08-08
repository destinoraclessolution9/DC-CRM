// ci/test-high-touch-kpi.js — "Prospect Met >5×" KPI: high-touch prospects who
// still have not become customers.
//
// WHY these things are pinned:
//
//   1. THE THRESHOLD IS STRICT. Owner spec: "MORE than 5 times" — 5 touches must
//      NOT flag, 6 must. An >= regression silently grows the list.
//   2. EVERY CONVERSION MARKER EXCLUDES. Four independent markers say "already a
//      customer" (conversion FK, prospect status, approved conversion request,
//      name/phone match to a customer row). Losing any one of them puts existing
//      customers back on a closing list — the exact noise the card must not have.
//   3. ONE MEETING NEVER COUNTS TWICE. An event_attendees row pointing at an
//      activity already counted as a CPS/FTF meet is the same meeting, not a 2nd
//      touch. Without the guard, 5-touch prospects cross the threshold falsely.
//   4. FUTURE MEETINGS ARE NOT "MET". A planned CPS tomorrow counts nothing today.
//   5. ALL TIME, BUT SCOPED. The number ignores the date filter yet honours the
//      agent/role scope via the prospect's RESPONSIBLE agent (deliberately not the
//      per-activity lead — a prospect met 6× by two agents is flagged, not split
//      into two invisible 3s).
//   6. REFERRALS MADE ADD 1 EACH (owner follow-up 2026-08-08), read from the
//      referrals table with the referral tree's key semantics: prospect-type
//      referrers only (case-insensitive, missing type = prospect), deduped per
//      referred person, and NEVER moving Last Touch (that stays "last met").
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

// ── Data fixtures + fetch counters ──────────────────────────────────────────
let ACTIVITIES = [], PROSPECTS = [], CUSTOMERS = [], USERS = [], ATTENDEES = [], REFERRALS = [];
let PAGED_FETCHES = 0;      // queryPaged calls (the getter's lifetime reads)
let PAGED_TYPE_THROWS = false; // force the type-filtered fetch down the getAll fallback
global.AppDataStore = {
    getAll: async (t) => (t === 'activities' ? ACTIVITIES
        : t === 'prospects' ? PROSPECTS
        : t === 'customers' ? CUSTOMERS
        : t === 'users' ? USERS
        : t === 'event_attendees' ? ATTENDEES
        : t === 'referrals' ? REFERRALS
        : []),
    getActivitiesInRange: async (from, to) =>
        ACTIVITIES.filter(a => !a.activity_date || (a.activity_date >= from && a.activity_date <= to)),
    // Emulates the real contract the getter relies on: filters map with array
    // values = .in(), scalar = .eq(). Select is ignored (full rows returned).
    queryPaged: async (t, opts = {}) => {
        PAGED_FETCHES++;
        if (t !== 'activities') return [];
        const filters = (opts && opts.filters) || {};
        if (PAGED_TYPE_THROWS && filters.activity_type) throw new Error('boom (forced)');
        return ACTIVITIES.filter(a => Object.entries(filters).every(([col, val]) =>
            Array.isArray(val) ? val.map(String).includes(String(a[col])) : String(a[col]) === String(val)));
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
        getHighTouchProspects, buildHighTouchDetails, showKPIDetails,
        HIGH_TOUCH_MIN, HIGH_TOUCH_MEET_TYPES,
        _highTouchWindowParts, _windowLineHtml, _buildKpiCards, renderKPIStats,
        KPI_DEFINITIONS,
        setScope: (vis, role) => { _visibleUserIds = vis; _currentRoleFilter = role; },
        resetWindows: () => { _windowCaches.clear(); },
    };
    ${ANCHOR}`);
try { (0, eval)(src); } catch (e) { console.error('FAIL loading chunk: ' + e.message); process.exit(1); }
const T = global.window.__T;
ok('harness reached the chunk internals', T && typeof T.getHighTouchProspects === 'function');
if (!T) process.exit(1);

eq('threshold is 5 (flag when total EXCEEDS it) and meets are CPS+FTF',
    [T.HIGH_TOUCH_MIN, T.HIGH_TOUCH_MEET_TYPES], [5, ['CPS', 'FTF']]);

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };

let _actId = 0;
const prospect = (id, opts = {}) => PROSPECTS.push({
    id, full_name: opts.name || 'Prospect ' + id, phone: opts.phone || '',
    responsible_agent_id: opts.agent == null ? 7 : opts.agent,
    status: opts.status || 'active', conversion_status: opts.conversion_status || null,
});
// n meetings of `type` for prospect `pid`; returns the activity ids created.
const meets = (pid, type, n, date) => {
    const ids = [];
    for (let i = 0; i < n; i++) {
        const id = ++_actId;
        ACTIVITIES.push({ id, activity_type: type, activity_date: date || daysAgo(30 + i), prospect_id: pid });
        ids.push(id);
    }
    return ids;
};
// One ATTENDED event for prospect `pid` (its own EVENT activity unless actId given).
const attended = (pid, opts = {}) => {
    let actId = opts.actId;
    if (actId == null) {
        actId = ++_actId;
        ACTIVITIES.push({ id: actId, activity_type: 'EVENT', activity_date: opts.date || daysAgo(20), prospect_id: null });
    }
    ATTENDEES.push({
        activity_id: actId, event_id: 900 + actId,
        attendee_type: opts.attendeeType || 'prospect',
        entity_id: pid,
        attended: opts.attended !== undefined ? opts.attended : true,
        attendance_status: opts.attendanceStatus || null,
    });
};

let _refId = 0;
// One referral MADE BY prospect `pid` (referrals-table shape from the CPS
// intake auto-create; override referrer_type / referred id via opts).
const referral = (pid, opts = {}) => REFERRALS.push({
    id: ++_refId,
    referrer_id: pid,
    referrer_type: 'referrer_type' in opts ? opts.referrer_type : 'prospect',
    referred_prospect_id: 'referred' in opts ? opts.referred : 5000 + _refId,
    referral_source: 'CPS', created_at: new Date().toISOString(),
});

const reset = () => {
    ACTIVITIES = []; PROSPECTS = []; CUSTOMERS = []; USERS = []; ATTENDEES = []; REFERRALS = [];
    PAGED_FETCHES = 0; PAGED_TYPE_THROWS = false; _actId = 0; _refId = 0;
    T.setScope('all', 'All'); T.resetWindows();
};

async function main() {

// ── 1. The threshold is strict: 5 is not "more than 5", 6 is ───────────────
reset();
{
    prospect(1, { name: 'Five Touches' });
    meets(1, 'CPS', 5);
    prospect(2, { name: 'Six Touches' });
    meets(2, 'CPS', 6);
    const r = await T.getHighTouchProspects();
    eq('5 touches does not flag, 6 does', r.rows.map(x => x.name), ['Six Touches']);
    eq('…and the count matches the rows', r.count, 1);
}

// ── 2. CPS + FTF + attended events + referrals SUM to the total ─────────────
reset();
{
    prospect(1, { name: 'Mixed' });
    meets(1, 'CPS', 2);
    meets(1, 'FTF', 2);
    attended(1);
    referral(1);
    const r = await T.getHighTouchProspects();
    eq('2 CPS + 2 FTF + 1 event + 1 referral = 6 → flagged with the right split',
        r.rows.map(x => [x.name, x.cps, x.ftf, x.events, x.refs, x.total]),
        [['Mixed', 2, 2, 1, 1, 6]]);
}

// ── 2b. Referral rules: who counts, dedup, and Last Touch ───────────────────
reset();
{
    prospect(1, { name: 'Boundary By Referral' });
    meets(1, 'CPS', 5, daysAgo(40));
    const before = await T.getHighTouchProspects();
    eq('5 meets alone do not flag', before.count, 0);
    referral(1);
    T.resetWindows();
    const after = await T.getHighTouchProspects();
    eq('…the 6th touch via a referral flags', after.rows.map(x => [x.name, x.refs, x.total]),
        [['Boundary By Referral', 1, 6]]);
    eq('…and the referral does NOT move Last Touch (stays the last meet)',
        after.rows[0].lastDate, daysAgo(40));
}
reset();
{
    prospect(1, { name: 'Legacy Case' });
    meets(1, 'CPS', 5);
    referral(1, { referrer_type: 'Prospect' }); // capitalised legacy row
    const r = await T.getHighTouchProspects();
    eq('referrer_type matches case-insensitively', r.rows.map(x => x.refs), [1]);
}
reset();
{
    prospect(1, { name: 'Untyped' });
    meets(1, 'CPS', 5);
    referral(1, { referrer_type: null }); // missing type defaults to prospect (like _referrerKeyOf)
    const r = await T.getHighTouchProspects();
    eq('a referral row with no referrer_type counts as a prospect referral', r.rows.map(x => x.refs), [1]);
}
reset();
{
    prospect(1, { name: 'Not Mine' });
    meets(1, 'CPS', 5);
    referral(1, { referrer_type: 'user' });     // an agent with the same id referred someone
    referral(1, { referrer_type: 'customer' }); // a customer with the same id referred someone
    const r = await T.getHighTouchProspects();
    eq('user/customer referrer rows never count toward the prospect', r.count, 0);
}
reset();
{
    prospect(1, { name: 'Dup Referral' });
    meets(1, 'CPS', 4);
    referral(1, { referred: 777 });
    referral(1, { referred: 777 }); // double-written row for the same referred person
    const r = await T.getHighTouchProspects();
    eq('the same referred person counts once (4 meets + 1 deduped referral = 5 → not flagged)', r.count, 0);

    T.resetWindows();
    referral(1, { referred: 888 }); // a genuinely different person
    const r2 = await T.getHighTouchProspects();
    eq('…a second distinct referred person is a real 6th touch', r2.rows.map(x => [x.refs, x.total]), [[2, 6]]);
}
reset();
{
    prospect(1, { name: 'Referrals Only' });
    for (let i = 0; i < 6; i++) referral(1);
    const r = await T.getHighTouchProspects();
    eq('6 referrals with zero meetings still crosses the threshold (owner arithmetic: it all sums)',
        r.rows.map(x => [x.name, x.refs, x.total]), [['Referrals Only', 6, 6]]);
}

// ── 3. Every conversion marker excludes ─────────────────────────────────────
reset();
{
    prospect(1, { name: 'FK Linked' });          meets(1, 'CPS', 6);
    prospect(2, { name: 'Status Converted', status: 'converted' }); meets(2, 'CPS', 6);
    prospect(3, { name: 'Approved Conversion', conversion_status: 'approved' }); meets(3, 'CPS', 6);
    prospect(4, { name: 'Name Match' });         meets(4, 'CPS', 6);
    prospect(5, { name: 'Phone Match', phone: '012-345 6789' }); meets(5, 'CPS', 6);
    prospect(6, { name: 'Still Open' });         meets(6, 'CPS', 6);
    CUSTOMERS = [
        { id: 100, converted_from_prospect_id: 1, full_name: 'Someone Else', phone: '' },
        { id: 101, full_name: 'name match', phone: '' },                  // normalised-name hit for #4
        { id: 102, full_name: 'Different Person', phone: '+60123456789' }, // last-8-digits hit for #5
    ];
    const r = await T.getHighTouchProspects();
    eq('only the genuinely-unconverted prospect is flagged', r.rows.map(x => x.name), ['Still Open']);
}

// ── 4. One meeting never counts twice (attendee row on a counted CPS) ───────
reset();
{
    prospect(1, { name: 'Dedup Me' });
    const ids = meets(1, 'CPS', 5);
    attended(1, { actId: ids[0] }); // same meeting, recorded again as attendance
    const r = await T.getHighTouchProspects();
    eq('5 CPS + an attendee row on one of THOSE activities stays 5 → not flagged', r.count, 0);

    // …but attendance at a DIFFERENT activity is a real 6th touch.
    T.resetWindows();
    attended(1);
    const r2 = await T.getHighTouchProspects();
    eq('…while a 6th distinct touch flags', r2.rows.map(x => [x.name, x.total]), [['Dedup Me', 6]]);
}

// ── 5. Future-dated meetings are not "met" ──────────────────────────────────
reset();
{
    prospect(1, { name: 'Planned Ahead' });
    meets(1, 'CPS', 5);
    meets(1, 'CPS', 1, daysAgo(-7)); // planned next week
    const r = await T.getHighTouchProspects();
    eq('5 held + 1 planned future CPS → not flagged', r.count, 0);
}
reset();
{
    prospect(1, { name: 'Future Event' });
    meets(1, 'CPS', 5);
    attended(1, { date: daysAgo(-7) }); // attendance row against a future-dated event
    const r = await T.getHighTouchProspects();
    eq('an attendance row on a future-dated event does not count', r.count, 0);
}

// ── 6. Only real attendance counts ──────────────────────────────────────────
reset();
{
    prospect(1, { name: 'No Shows' });
    meets(1, 'CPS', 5);
    attended(1, { attended: false });                                  // registered, absent
    attended(1, { attended: false, attendanceStatus: 'Registered' });  // still absent
    const r = await T.getHighTouchProspects();
    eq('non-attended rows count nothing', r.count, 0);

    T.resetWindows();
    attended(1, { attended: false, attendanceStatus: 'Attended' }); // legacy string-only marking
    const r2 = await T.getHighTouchProspects();
    eq("…but attendance_status === 'Attended' counts like attended=true", r2.rows.map(x => x.total), [6]);
}
reset();
{
    prospect(1, { name: 'Not Me' });
    meets(1, 'CPS', 5);
    attended(1, { attendeeType: 'agent' });
    attended(1, { attendeeType: 'customer' });
    const r = await T.getHighTouchProspects();
    eq('agent/customer attendee rows never touch a prospect count', r.count, 0);
}

// ── 7. Remote touches (CALL etc.) never count ───────────────────────────────
reset();
{
    prospect(1, { name: 'Phone Only' });
    meets(1, 'CALL', 6);
    meets(1, 'WHATSAPP', 6);
    const r = await T.getHighTouchProspects();
    eq('6 calls + 6 WhatsApps = 0 meets', r.count, 0);
}

// ── 8. Scope: prospect's responsible agent, not per-activity lead ───────────
reset();
{
    USERS = [{ id: 7, role: 'Level 3 Agent', full_name: 'Agent Seven' },
             { id: 8, role: 'Level 5 Team Leader', full_name: 'Agent Eight' }];
    prospect(1, { name: 'Of Seven', agent: 7 });
    meets(1, 'CPS', 6);
    prospect(2, { name: 'Of Eight', agent: 8 });
    meets(2, 'CPS', 6);

    let r = await T.getHighTouchProspects();
    eq('unscoped sees both', r.rows.map(x => [x.name, x.agentName]).sort(),
        [['Of Eight', 'Agent Eight'], ['Of Seven', 'Agent Seven']]);

    T.setScope([7], 'All'); T.resetWindows();
    r = await T.getHighTouchProspects();
    eq('agent filter keeps only that agent\'s prospects', r.rows.map(x => x.name), ['Of Seven']);

    T.setScope('all', 'Level 5 Team Leader'); T.resetWindows();
    r = await T.getHighTouchProspects();
    eq('role filter goes through the responsible agent\'s role', r.rows.map(x => x.name), ['Of Eight']);
}

// ── 9. The type-filtered fetch falls back to getAll and agrees ──────────────
reset();
{
    prospect(1, { name: 'Fallback' });
    meets(1, 'CPS', 3);
    meets(1, 'FTF', 3);
    meets(1, 'CALL', 6); // must be filtered client-side on the fallback path too
    attended(1);
    const viaPaged = await T.getHighTouchProspects();
    PAGED_TYPE_THROWS = true; T.resetWindows();
    const viaFallback = await T.getHighTouchProspects();
    eq('paged path flags with 7 touches', viaPaged.rows.map(x => x.total), [7]);
    eq('fallback path computes the identical result', viaFallback.rows, viaPaged.rows);
}

// ── 10. Cache: parallel callers share one computation; scope busts it ───────
reset();
{
    prospect(1, { name: 'Cached' });
    meets(1, 'CPS', 6);
    PAGED_FETCHES = 0;
    const [a, b] = await Promise.all([T.getHighTouchProspects(), T.getHighTouchProspects()]);
    eq('two PARALLEL callers share one lifetime read', PAGED_FETCHES, 1);
    ok('…and both get the same object', a === b);
    T.setScope([7], 'All');
    await T.getHighTouchProspects();
    ok('changing scope busts the cache', PAGED_FETCHES > 1);
}

// ── 11. Sort: most-met first ────────────────────────────────────────────────
reset();
{
    prospect(1, { name: 'Seven' }); meets(1, 'CPS', 7);
    prospect(2, { name: 'Nine' });  meets(2, 'CPS', 9);
    prospect(3, { name: 'Six' });   meets(3, 'CPS', 6);
    const r = await T.getHighTouchProspects();
    eq('rows sort by total desc', r.rows.map(x => x.name), ['Nine', 'Seven', 'Six']);
}

// ── 12. Card wiring: def, trend, window line, both render paths ─────────────
{
    const kpis = {
        cpsCount: 0, totalSales: 0, popCaseCount: 0, popSales: 0, newAgents: 0, newCustomers: 0,
        conversionRate: 0, totalMeetings: 0, clientMeetings: 0, activityHeadcount: 0,
        eppCaseCount: 0, agentHours: '0 / 90h', agentHoursPct: 0, eppDetails: [],
        cpsAgentReferrers: 0, cpsClientReferrers: 0, cpsUnattributed: 0,
        cpsAgents90: 0, cpsAgents365: 0, cpsClients90: 0, cpsClients365: 0,
        highTouchProspects: 4,
    };
    const cards = T._buildKpiCards(kpis, { ...kpis });
    const card = cards.find(c => c.key === 'highTouchProspects');
    ok('the card exists in the React payload', !!card);
    eq('…as the LAST card (the empty slot after EPP Cases)', cards[cards.length - 1].key, 'highTouchProspects');
    eq('…with the count as its value', card.value, 4);
    eq('…carrying the all-time window line', card.windowParts, ['All time', 'met >5× · not yet customer']);
    ok('…with a tooltip definition', (card.definition || '').includes('more than 5'));
    ok('an all-time metric shows NO period trend', card.trendHide === true);
    ok('…while a normal numeric card still shows one',
        cards.find(c => c.key === 'cpsCount').trendHide === false);

    // The LEGACY by-id grid is a separate render site (the React-remount fallback).
    const grid = { id: 'kpi-stats-grid', innerHTML: '' };
    ELEMENTS.set('kpi-stats-grid', grid);
    T.renderKPIStats(kpis, { ...kpis }, true);
    ok('the legacy grid renders the card', /Prospect Met &gt;5×|Prospect Met >5×/.test(grid.innerHTML));
    ok('…with the all-time line', /All time/.test(grid.innerHTML));
    const cardStart = grid.innerHTML.indexOf('Prospect Met');
    const slice = grid.innerHTML.slice(cardStart);
    ok('…and the line sits ABOVE the value', slice.indexOf('All time') < slice.indexOf('stat-value'));
    ok('…with no trend badge on this card', !/stat-trend/.test(slice));
    ELEMENTS.delete('kpi-stats-grid');
}

// ── 13. Drill-down: names, counts, profile links, empty state ───────────────
reset();
{
    USERS = [{ id: 7, role: 'Level 3 Agent', full_name: 'Agent Seven' }];
    prospect(1, { name: 'Tan <Ah> Kow', agent: 7 });
    meets(1, 'CPS', 4);
    meets(1, 'FTF', 2);
    attended(1);
    referral(1);
    const html = await T.buildHighTouchDetails();
    ok('summary carries the count', /<strong>1<\/strong> prospect/.test(html));
    ok('the name renders escaped', html.includes('Tan &lt;Ah&gt; Kow'));
    ok('…as a link into the prospect profile', html.includes('app.showProspectDetail(1)'));
    ok('the split renders (4 CPS, 2 FTF, 1 event, 1 referral, 8 total)',
        html.includes('>4</td>') && html.includes('>2</td>') && html.includes('>1</td>') && html.includes('<strong>8</strong>'));
    ok('the Referrals column exists', html.includes('Referrals'));
    ok('…and the summary names referrals as a touch', /referral made counts as 1/.test(html));
    ok('the agent column names the responsible agent', html.includes('Agent Seven'));
    ok('the strip says the date filter does not apply', /date filter above does not apply/.test(html));
}
reset();
{
    const html = await T.buildHighTouchDetails();
    ok('empty state says so', /No prospect has been met more than 5 times/.test(html));
}

// ── 13b. The modal strip names the real window, not the date filter ─────────
// (owner flagged the "Date range: …" line contradicting an all-time breakdown)
reset();
{
    const MODALS = [];
    const realShowModal = global.UI.showModal;
    global.UI.showModal = (t, c) => MODALS.push({ t, c });
    prospect(1, { name: 'Strip Case' });
    meets(1, 'CPS', 6);
    await T.showKPIDetails('highTouchProspects');
    const finalHt = MODALS[MODALS.length - 1];
    ok('the high-touch strip says All time', /Window:<\/strong> All time/.test(finalHt.c), finalHt.c.slice(0, 300));
    ok('…and does NOT echo the filtered date range', !/Date range:/.test(finalHt.c));
    ok('…while the title carries All Time', /All Time/.test(finalHt.t));

    MODALS.length = 0;
    await T.showKPIDetails('cpsCount');
    const finalCps = MODALS[MODALS.length - 1];
    ok('a period metric still shows its date range', /Date range:/.test(finalCps.c));
    global.UI.showModal = realShowModal;
}

// ── 14. Zero state on the getter ────────────────────────────────────────────
reset();
{
    const r = await T.getHighTouchProspects();
    eq('no data → zero, no rows', [r.count, r.rows.length], [0, 0]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('FAIL (uncaught): ' + (e && e.stack || e)); process.exit(1); });
