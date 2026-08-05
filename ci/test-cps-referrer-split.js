// ci/test-cps-referrer-split.js — CPS Consultations card: agent/client referrer split.
//
// WHY: the card now shows three numbers — total CPS sessions, distinct AGENT
// referrers, distinct CLIENT referrers. Two things can silently go wrong:
//
//   1. SCOPE DRIFT. The two head-counts are computed by getCPSReferrerSplit,
//      which is a separate pass from getCPSCount. If their scope gates ever
//      diverge (date window, market, team, role filter), the card would show a
//      split describing a different set of sessions than the total sitting right
//      above it — and nothing would look broken.
//   2. KEY COLLAPSE. Referrers are deduped by a COMPOSITE key (`user:5` vs
//      `prospect:5`). Keying on the bare id would silently merge two different
//      people into one head.
//
// Both are pinned below, along with the classification rules (capitalised
// 'Consultant' from the picker vs lowercase 'user' from the referrals table) and
// the drill-down's promise that its distinct referrer rows equal the card chips.
//
// HARNESS: loads the REAL chunks/script-reporting.js into a stubbed browser and
// injects an export hook just before app.register() so the IIFE-private getters
// are reachable. No logic is duplicated here.
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
global.document = {
    getElementById: () => null,
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
    // Market drill-down off: ALL scope, so _recInMarket is always true.
    ALL_COUNTRIES: '__ALL__',
    listCountryScope: () => '__ALL__',
    recordCountry: () => 'MY',
    getVisibleUserIds: async () => 'all',
};

// ── Data fixtures, swapped per test ─────────────────────────────────────────
let ACTIVITIES = [], PROSPECTS = [], USERS = [], CUSTOMERS = [];
global.AppDataStore = {
    getAll: async (t) => (t === 'activities' ? ACTIVITIES
        : t === 'prospects' ? PROSPECTS
        : t === 'users' ? USERS
        : t === 'customers' ? CUSTOMERS
        : []),
    getActivitiesInRange: async (from, to) =>
        ACTIVITIES.filter(a => !a.activity_date || (a.activity_date >= from && a.activity_date <= to)),
    getById: async () => null,
    query: async () => [],
};
global.supabase = null; // no RPC fast paths in this harness

// ── Load the real chunk with an export hook injected ────────────────────────
const chunkPath = path.join(__dirname, '..', 'chunks', 'script-reporting.js');
let src = fs.readFileSync(chunkPath, 'utf8');
const ANCHOR = "app.register('reporting', {";
if (!src.includes(ANCHOR)) { console.error('FAIL: register anchor not found — harness needs updating'); process.exit(1); }
src = src.replace(ANCHOR, `window.__T = {
        getCPSReferrerSplit, getCPSCount, _cpsReferrerOf, _cpsSplitParts,
        _buildCPSDetailsLegacy, _kpiCardDefs,
        setScope: (vis, role) => { _visibleUserIds = vis; _currentRoleFilter = role; },
    };
    ${ANCHOR}`);
try { (0, eval)(src); } catch (e) { console.error('FAIL loading chunk: ' + e.message); process.exit(1); }
const T = global.window.__T;
ok('harness reached the chunk internals', T && typeof T.getCPSReferrerSplit === 'function');
if (!T) process.exit(1);

const FROM = '2026-08-01', TO = '2026-08-31';
const reset = () => { ACTIVITIES = []; PROSPECTS = []; USERS = []; CUSTOMERS = []; T.setScope('all', 'All'); };

// CommonJS file (require above) → the awaited assertions live in an async main.
async function main() {

// Build one CPS activity + the prospect it consulted, referred by `ref`.
let _id = 0;
const cps = (ref, opts = {}) => {
    const pid = ++_id;
    PROSPECTS.push({
        id: pid, full_name: 'P' + pid,
        referred_by: ref ? ref.name : (opts.refName || ''),
        referred_by_id: ref ? ref.id : null,
        referred_by_type: ref ? ref.type : (opts.refType || null),
    });
    ACTIVITIES.push({
        id: 1000 + pid, activity_type: 'CPS', activity_date: opts.date || '2026-08-10',
        prospect_id: pid, lead_agent_id: opts.lead == null ? 7 : opts.lead,
        activity_title: 'CPS With P' + pid,
    });
};
const agentRef = (id, name) => ({ id, name, type: 'Consultant' });
const clientRef = (id, name) => ({ id, name, type: 'Prospect' });

// ── 1. The worked example from the request ──────────────────────────────────
// Wong Wai Yeng→1, Oo→1, Prospect A→2, Prospect B→1  ⇒  5 | 2 | 2
reset();
cps(agentRef(11, 'Wong Wai Yeng'));
cps(agentRef(12, 'Oo'));
cps(clientRef(21, 'Prospect A'));
cps(clientRef(21, 'Prospect A'));
cps(clientRef(22, 'Prospect B'));
eq('example: total is 5', await T.getCPSCount(FROM, TO), 5);
eq('example: split is 2 agents / 2 clients', await T.getCPSReferrerSplit(FROM, TO),
    { agents: 2, clients: 2, unattributed: 0 });

// ── 2. Head-counts are NOT a partition of the total ─────────────────────────
reset();
cps(agentRef(11, 'Wong Wai Yeng'));
cps(agentRef(11, 'Wong Wai Yeng'));
cps(agentRef(11, 'Wong Wai Yeng'));
eq('one agent, three referrals → 3 sessions but 1 head', await T.getCPSReferrerSplit(FROM, TO),
    { agents: 1, clients: 0, unattributed: 0 });
eq('…and the headline still counts 3 sessions', await T.getCPSCount(FROM, TO), 3);

// ── 3. Composite key: same id, different referrer type = different people ───
reset();
cps(agentRef(5, 'Agent Five'));
cps(clientRef(5, 'Prospect Five'));
eq('same id across buckets → one head each', await T.getCPSReferrerSplit(FROM, TO),
    { agents: 1, clients: 1, unattributed: 0 });

// The one that actually pins the composite key. Agent-vs-client above cannot
// catch a bare-id key because the two buckets are separate Sets — but 'prospect'
// and 'customer' BOTH land in the client bucket, so keying on the bare id would
// silently merge prospect 5 and customer 5 into a single head.
reset();
cps({ id: 5, name: 'Prospect Five', type: 'Prospect' });
cps({ id: 5, name: 'Customer Five', type: 'customer' });
eq('prospect:5 and customer:5 are two client heads, not one', await T.getCPSReferrerSplit(FROM, TO),
    { agents: 0, clients: 2, unattributed: 0 });

// Same guard for the name-only fallback sharing an id-space with real ids.
reset();
cps({ id: 5, name: 'Real Five', type: 'Prospect' });
cps(null, { refName: '5' });
eq('a name that looks like an id does not collide with prospect:5',
    await T.getCPSReferrerSplit(FROM, TO), { agents: 0, clients: 2, unattributed: 0 });

// ── 4. Type spelling: pickers store 'Consultant', referrals store 'user' ────
reset();
cps({ id: 31, name: 'A', type: 'Consultant' });
cps({ id: 32, name: 'B', type: 'consultant' });
cps({ id: 33, name: 'C', type: 'user' });
cps({ id: 34, name: 'D', type: 'agent' });
eq('every agent-ish type spelling lands in the agent bucket', await T.getCPSReferrerSplit(FROM, TO),
    { agents: 4, clients: 0, unattributed: 0 });
reset();
cps({ id: 41, name: 'E', type: 'Prospect' });
cps({ id: 42, name: 'F', type: 'prospect' });
cps({ id: 43, name: 'G', type: 'customer' });
eq('prospect/customer types land in the client bucket', await T.getCPSReferrerSplit(FROM, TO),
    { agents: 0, clients: 3, unattributed: 0 });

// ── 5. Legacy rows ──────────────────────────────────────────────────────────
reset();
cps(null, { refName: 'Someone Untyped' });          // name only, no id, no type
cps(null, { refName: 'Someone Untyped' });          // same name → one head
cps(null, { refName: 'Typed Agent', refType: 'Consultant' }); // name + type, no id
cps(null);                                          // nothing at all
eq('name-only dedups by name; typed-but-idless still classifies; blank is unattributed',
    await T.getCPSReferrerSplit(FROM, TO), { agents: 1, clients: 1, unattributed: 1 });

// ── 6. Scope gates match getCPSCount exactly ────────────────────────────────
reset();
cps(agentRef(11, 'In range'), { date: '2026-08-10' });
cps(agentRef(12, 'Before'),   { date: '2026-07-31' });
cps(agentRef(13, 'After'),    { date: '2026-09-01' });
eq('out-of-window sessions excluded from the split', await T.getCPSReferrerSplit(FROM, TO),
    { agents: 1, clients: 0, unattributed: 0 });
eq('…and the split agrees with the headline', await T.getCPSCount(FROM, TO), 1);

reset();
cps(agentRef(11, 'Mine'),   { lead: 7 });
cps(clientRef(21, 'Theirs'), { lead: 99 });
T.setScope([7], 'All');
eq('team scope drops the other agent’s session', await T.getCPSReferrerSplit(FROM, TO),
    { agents: 1, clients: 0, unattributed: 0 });
eq('…matching the headline under the same scope', await T.getCPSCount(FROM, TO), 1);

reset();
USERS = [{ id: 7, role: 'Level 3 Agent' }, { id: 99, role: 'Level 5 Team Leader' }];
cps(agentRef(11, 'By L3'), { lead: 7 });
cps(clientRef(21, 'By L5'), { lead: 99 });
T.setScope('all', 'Level 3 Agent');
eq('role filter drops the other role’s session', await T.getCPSReferrerSplit(FROM, TO),
    { agents: 1, clients: 0, unattributed: 0 });
eq('…matching the headline under the same filter', await T.getCPSCount(FROM, TO), 1);
T.setScope('all', 'All');

// ── 7. Non-CPS activities never contribute ─────────────────────────────────
reset();
cps(agentRef(11, 'Real CPS'));
PROSPECTS.push({ id: 900, full_name: 'FTF person', referred_by: 'Other Agent', referred_by_id: 55, referred_by_type: 'Consultant' });
ACTIVITIES.push({ id: 9000, activity_type: 'FTF', activity_date: '2026-08-10', prospect_id: 900, lead_agent_id: 7 });
eq('an FTF with a referrer does not inflate the CPS split', await T.getCPSReferrerSplit(FROM, TO),
    { agents: 1, clients: 0, unattributed: 0 });

// ── 8. Drill-down agrees with the card ──────────────────────────────────────
reset();
USERS = [{ id: 7, full_name: 'Lead Agent', role: 'Level 3 Agent' }];
cps(agentRef(11, 'Lai Sow Lian'));
cps(agentRef(11, 'Lai Sow Lian'));
cps(clientRef(21, 'Lim Min Qi'));
cps(clientRef(21, 'Lim Min Qi'));
cps(clientRef(21, 'Lim Min Qi'));
const split8 = await T.getCPSReferrerSplit(FROM, TO);
const html8 = await T._buildCPSDetailsLegacy(FROM, TO);
eq('fixture mirrors the live Aug 1-5 shape (5 | 1 | 1)', split8, { agents: 1, clients: 1, unattributed: 0 });
ok('drill-down summary states the session count', html8.includes('<strong>5</strong> CPS session'));
ok('drill-down summary states the agent head-count', html8.includes('<strong>1</strong> agent referrer'));
ok('drill-down summary states the client head-count', html8.includes('<strong>1</strong> client referrer'));
ok('drill-down groups by referrer', html8.includes('By referrer (2)'));
ok('drill-down lists every session', html8.includes('Sessions (5)'));
ok('drill-down names the referrers', html8.includes('Lai Sow Lian') && html8.includes('Lim Min Qi'));
ok('drill-down labels referrer type', html8.includes('>Agent<') && html8.includes('>Client<'));
ok('drill-down warns the numbers do not sum', /do not add up/.test(html8));

// ── 9. Card chip line ───────────────────────────────────────────────────────
eq('chips pluralise correctly at 1', T._cpsSplitParts(1, 1, 0),
    ['👤 1 agent referrer', '🤝 1 client referrer']);
eq('chips pluralise correctly at 0 and 2', T._cpsSplitParts(0, 2, 0),
    ['👤 0 agent referrers', '🤝 2 client referrers']);
eq('unattributed chip is hidden at zero', T._cpsSplitParts(2, 2, 0).length, 2);
eq('unattributed chip appears when non-zero', T._cpsSplitParts(2, 2, 3)[2], '3 unattributed');

const cards = T._kpiCardDefs(
    { cpsCount: 5, cpsAgentReferrers: 1, cpsClientReferrers: 1, cpsUnattributed: 0,
      totalSales: 0, popCaseCount: 0, popSales: 0, eppCaseCount: 0, neaPitching: 0,
      newAgents: 0, activeAgents: 0, fengshuiPitching: 0, newCustomers: 0,
      conversionRate: 0, totalMeetings: 0, clientMeetings: 0, activityHeadcount: 0,
      agentHours: '0 / 45h', agentHoursPct: 0, eppDetails: [] },
    { cpsCount: 9, totalSales: 0, popCaseCount: 0, eppCaseCount: 0, neaPitching: 0,
      newAgents: 0, activeAgents: 0, fengshuiPitching: 0, newCustomers: 0,
      conversionRate: 0, totalMeetings: 0, clientMeetings: 0, activityHeadcount: 0,
      agentHours: '0 / 45h' });
const cpsCard = cards.find(c => c.key === 'cpsCount');
eq('CPS card headline is still the plain session count', cpsCard.value, 5);
eq('CPS card carries the cps subType', cpsCard.subType, 'cps');
ok('CPS card sub-line renders both chips',
    cpsCard.subHtml.includes('1 agent referrer') && cpsCard.subHtml.includes('1 client referrer'));

// Each chip must be its OWN element. The mobile KPI grid is two columns (~182px
// per card) — as one text run the line breaks mid-phrase ("1 agent / referrer").
// Flex items wrap between chips instead.
const spans = cpsCard.subHtml.match(/<span>/g) || [];
eq('each chip is its own span, so wrapping never splits a phrase', spans.length, 2);
ok('chip row is flex-wrap', /display:flex;flex-wrap:wrap/.test(cpsCard.subHtml));
ok('chips are not joined by a middot run', !cpsCard.subHtml.includes('·'));

// ── 10. React island renders the same chips the legacy HTML does ────────────
// _buildKpiCards is not exported; assert the shared builder both paths call.
const jsxParts = T._cpsSplitParts(cpsCard.cpsAgents, cpsCard.cpsClients, cpsCard.cpsUnattributed);
eq('React receives the chips as an array, not a pre-joined string', jsxParts,
    ['👤 1 agent referrer', '🤝 1 client referrer']);
ok('every React chip appears verbatim in the legacy sub-line',
    jsxParts.every(p => cpsCard.subHtml.includes(p)), `parts: ${jsxParts.join(' | ')}`);

}

main().then(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}).catch((e) => {
    console.error('FAIL harness threw: ' + (e && e.stack || e));
    process.exit(1);
});
