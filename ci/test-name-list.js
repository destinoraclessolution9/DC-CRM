// ci/test-name-list.js — "Name List — Who to Focus" (owner spec locked 2026-08-10).
//
// WHY these things are pinned:
//
//   1. CATEGORY BOUNDARIES ARE THE OWNER'S: A = 5+ mentions, B = 2-4, C = 1.
//      (Owner corrected the draft's 6+/2-5 split on 2026-08-10.)
//   2. ONE ACTIVITY = ONE MENTION, bucketed by priority Tick → Event → Talk.
//      A meet-up where the agent ticked the product AND wrote it in notes is
//      one pitch, not two — and it lands in Tick (the strongest signal).
//   3. TICK = PITCHED IN PERSON. opportunity_potential / next_action ticks
//      after FTF/GR/CPS count ("after i got click on the potential that means
//      also i got pitching" — owner). DC 日 is NOT a 招商 signal ("consider an
//      event"); 博物馆 and 运程讲座 count for BOTH Power Ring and 风水.
//   4. 财库 IS EXPLICIT-ONLY: generic painting classes never count; buyers of
//      CAI KU Painting drop off (the promo-ready list must be presentable
//      as-is). Power Ring keeps "Owns 1" people (everyone can buy 2) and drops
//      only 2+ owners. Audited people leave the 风水 list for the Audited tab.
//   5. TOUCH WEIGHTS: meet/class/CPS = 1, CALL = 0.5, WHATSAPP = 0.3. The
//      repeat-frequency breakdown and New-Head-Count use PHYSICAL touches only.
//   6. NEW HEAD COUNT = 90+ days of silence (any contact kind) before the
//      physical touch. The gap check reads the FULL 365d history — a touch
//      exactly 90 days back sits OUTSIDE the 90d counting window yet still
//      makes the customer Repeat (the blind-spot regression this suite pins).
//   7. REFERRAL HEAD COUNT dedups per referred person; agents and clients are
//      separate boards; the 365d window filters on referral created_at.
//   8. AUDITED = audit package bought OR FSA logged; audit date prefers the
//      FSA (service actually delivered) over the purchase date.
//   9. ATTENDED 汇集/汇聚 = 1.5 MENTIONS instead of 1 (owner 2026-08-15). The
//      weight rides on the ACTIVITY — a tick made during the visit is also
//      1.5, so "attended + pitched" never scores below "attended alone".
//      Boundaries stay: a lone 汇集 (1.5) is C; 1 汇集 + 3 events (4.5) is
//      still B; A remains 5+. Touch weights are untouched.
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
    ALL_COUNTRIES: '__ALL__',
    listCountryScope: () => '__ALL__',
    recordCountry: () => 'MY',
    getVisibleUserIds: async () => 'all',
};

// ── Data fixtures ───────────────────────────────────────────────────────────
let ACTIVITIES = [], PROSPECTS = [], CUSTOMERS = [], USERS = [], ATTENDEES = [],
    REFERRALS = [], PURCHASES = [], EVENTS = [];
global.AppDataStore = {
    getAll: async (t) => (t === 'activities' ? ACTIVITIES
        : t === 'prospects' ? PROSPECTS
        : t === 'customers' ? CUSTOMERS
        : t === 'users' ? USERS
        : t === 'event_attendees' ? ATTENDEES
        : t === 'referrals' ? REFERRALS
        : t === 'purchases' ? PURCHASES
        : t === 'events' ? EVENTS
        : []),
    getActivitiesInRange: async (from, to) =>
        ACTIVITIES.filter(a => a.activity_date && a.activity_date >= from && a.activity_date <= to),
    queryPaged: async (t, opts = {}) => {
        if (t !== 'activities') return [];
        const filters = (opts && opts.filters) || {};
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
        _getNameListData, _windowCaches, NL_TOPICS,
        _nlParseTicks, _nlParseCats, _nlTickHit, _nlCatHit, _nlFmtW, _nlTable, _nlExpanded, _nlIsHuiji,
    };
    ` + ANCHOR);
// eslint-disable-next-line no-eval
eval(src);
const T = global.window.__T;
ok('hook exported', !!(T && T._getNameListData && T._windowCaches), 'window.__T missing');

const daysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fresh = () => { T._windowCaches.clear(); return T._getNameListData(); };

(async () => {
    // ── Pure helpers ────────────────────────────────────────────────────────
    eq('parseTicks: items + remarks split', T._nlParseTicks('A, B | Remarks: hello world'),
        { items: ['A', 'B'], remarks: 'hello world' });
    eq('parseTicks: no remarks', T._nlParseTicks('DC 招商会'), { items: ['DC 招商会'], remarks: '' });
    eq('parseCats: JSON array', T._nlParseCats('["个人风水基础课","DC 日"]'), ['个人风水基础课', 'DC 日']);
    eq('parseCats: comma list', T._nlParseCats('博物馆, 课程'), ['博物馆', '课程']);
    eq('fmtW: integers stay clean', T._nlFmtW(5), '5');
    eq('fmtW: one decimal', T._nlFmtW(5.8000000001), '5.8');
    eq('fmtW: halves print clean (mention totals)', T._nlFmtW(1.5), '1.5');
    ok('isHuiji: matches 汇集-* AND the 汇聚 spelling, nothing else',
        T._nlIsHuiji(['汇集-商业']) && T._nlIsHuiji(['汇聚-专案']) && !T._nlIsHuiji(['个人风水基础课', '博物馆', 'DC 日']));
    ok('tickHit: DC 日 is NOT a 招商 tick (owner: "consider an event")',
        T._nlTickHit(T.NL_TOPICS.recruit, ['DC 日']) === null);
    ok('tickHit: DC 招商会 IS a 招商 tick', T._nlTickHit(T.NL_TOPICS.recruit, ['DC 招商会']) === 'DC 招商会');
    ok('catHit: 博物馆 counts for Power Ring', T._nlCatHit(T.NL_TOPICS.ring, ['博物馆']) === '博物馆');
    ok('catHit: 博物馆 counts for 风水 too', T._nlCatHit(T.NL_TOPICS.fengshui, ['博物馆']) === '博物馆');
    ok('catHit: 运程讲座 counts for both PR + 风水',
        T._nlCatHit(T.NL_TOPICS.ring, ['运程讲座']) && T._nlCatHit(T.NL_TOPICS.fengshui, ['运程讲座']));
    ok('catHit: painting class is NOT a 财库 signal (explicit only)',
        T._nlCatHit(T.NL_TOPICS.caiku, ['画作分享会', '艺品分享会']) === null);

    // ── Scenario 1: mention engine, priorities, exclusions, profile ★ ───────
    USERS = [{ id: 1, full_name: 'Alice Tan', role: 'Level 3 Agent' }];
    PROSPECTS = [
        { id: 11, full_name: 'P Fengshui Five', phone: '0110', responsible_agent_id: 1 },
        { id: 12, full_name: 'P Recruit One', phone: '0120', responsible_agent_id: 1 },
        { id: 13, full_name: 'P Profile Caiku', phone: '0130', responsible_agent_id: 1, cps_interest: '想买财库' },
        { id: 15, full_name: 'P Museum Both', phone: '0150', responsible_agent_id: 1 },
        { id: 16, full_name: 'P Attendee Only', phone: '0160', responsible_agent_id: 1 },
        { id: 17, full_name: 'P Huiji Only', phone: '0170', responsible_agent_id: 1 },
        { id: 18, full_name: 'P Huiji Plus Talk', phone: '0180', responsible_agent_id: 1 },
        { id: 19, full_name: 'P Huiji Tick', phone: '0190', responsible_agent_id: 1 },
        { id: 20, full_name: 'P Huiji B45', phone: '0200', responsible_agent_id: 1 },
        { id: 26, full_name: 'P Huiji A55', phone: '0264', responsible_agent_id: 1 },
        { id: 27, full_name: 'P Huiji Attendee', phone: '0274', responsible_agent_id: 1 },
    ];
    CUSTOMERS = [
        { id: 21, full_name: 'C Audited Flexi', phone: '0210', responsible_agent_id: 1 },
        { id: 22, full_name: 'C Owns Two Rings', phone: '0220', responsible_agent_id: 1 },
        { id: 23, full_name: 'C Owns One Ring', phone: '0230', responsible_agent_id: 1 },
        { id: 24, full_name: 'C Caiku Bought', phone: '0240', responsible_agent_id: 1 },
        { id: 25, full_name: 'C FSA Only', phone: '0250', responsible_agent_id: 1 },
    ];
    EVENTS = [
        { id: 101, categories: '["个人风水基础课"]', title: '风水基础 8月班' },
        { id: 102, categories: 'DC 日', title: 'DC Day August' },
        { id: 103, categories: '["博物馆"]', title: 'Museum Trip' },
        { id: 104, categories: '["汇集-商业"]', title: '汇集 - 王家' },
        { id: 105, categories: '["汇聚-专案"]', title: '汇聚 - 李家' },
    ];
    ACTIVITIES = [
        // P11 — five fengshui mentions across all buckets, priority pinned:
        { id: 1, activity_type: 'FTF', activity_date: daysAgo(10), prospect_id: 11, lead_agent_id: 1,
          opportunity_potential: 'FengShui 专案 | Remarks: follow up', note_key_points: '聊了风水' }, // tick wins over talk
        { id: 2, activity_type: 'CPS', activity_date: daysAgo(20), prospect_id: 11, lead_agent_id: 1, summary: '想看家里风水' },
        { id: 3, activity_type: 'EVENT', activity_date: daysAgo(30), prospect_id: 11, lead_agent_id: 1, event_id: 101 },
        { id: 4, activity_type: 'SITE', activity_date: daysAgo(40), prospect_id: 11, lead_agent_id: 1 }, // SITE = mention, NOT audited
        { id: 5, activity_type: 'FTF', activity_date: daysAgo(50), prospect_id: 11, lead_agent_id: 1, note_needs: 'fengshui audit soon' },
        // P12 — recruit via Next Actions tick; DC 日 event must add nothing:
        { id: 6, activity_type: 'FTF', activity_date: daysAgo(15), prospect_id: 12, lead_agent_id: 1, next_action: 'DC 招商会, 课程 | Remarks: invite' },
        { id: 7, activity_type: 'EVENT', activity_date: daysAgo(25), prospect_id: 12, lead_agent_id: 1, event_id: 102 },
        // P15 — museum event counts for BOTH ring and fengshui:
        { id: 8, activity_type: 'EVENT', activity_date: daysAgo(12), prospect_id: 15, lead_agent_id: 1, event_id: 103 },
        // C21 — audited (Flexi purchase + FSA): fengshui talk must NOT list them:
        { id: 9, activity_type: 'FTF', activity_date: daysAgo(18), customer_id: 21, lead_agent_id: 1, note_key_points: '风水 follow up' },
        { id: 10, activity_type: 'FSA', activity_date: daysAgo(60), customer_id: 21, lead_agent_id: 1 },
        // C22/C23 — ring talk; ownership decides who stays:
        { id: 12, activity_type: 'FTF', activity_date: daysAgo(9), customer_id: 22, lead_agent_id: 1, note_key_points: 'power ring interest' },
        { id: 13, activity_type: 'FTF', activity_date: daysAgo(9), customer_id: 23, lead_agent_id: 1, note_key_points: 'power ring interest' },
        // C24 — caiku talk but already bought:
        { id: 14, activity_type: 'FTF', activity_date: daysAgo(8), customer_id: 24, lead_agent_id: 1, note_key_points: '财库 promo' },
        // C25 — FSA only (no purchase):
        { id: 15, activity_type: 'FSA', activity_date: daysAgo(45), customer_id: 25, lead_agent_id: 1 },
        // group event nobody is directly linked to — P16 attends via attendee row:
        { id: 16, activity_type: 'EVENT', activity_date: daysAgo(22), lead_agent_id: 1, event_id: 101 },
        // ── 汇集 = 1.5 fixtures (owner 2026-08-15) ──
        // P17 — one 汇聚 visit (the 聚 spelling), duplicated by an attendee row:
        { id: 40, activity_type: 'EVENT', activity_date: daysAgo(7), prospect_id: 17, lead_agent_id: 1, event_id: 105 },
        // P18 — 汇集 (1.5) + a fengshui talk (1) = 2.5 → B:
        { id: 41, activity_type: 'EVENT', activity_date: daysAgo(14), prospect_id: 18, lead_agent_id: 1, event_id: 104 },
        { id: 42, activity_type: 'FTF', activity_date: daysAgo(6), prospect_id: 18, lead_agent_id: 1, note_key_points: '风水 follow up' },
        // P19 — ticked the product DURING the 汇集 visit → tick bucket at 1.5:
        { id: 43, activity_type: 'EVENT', activity_date: daysAgo(11), prospect_id: 19, lead_agent_id: 1, event_id: 104,
          opportunity_potential: 'FengShui 专案 | Remarks: pitched at the house' },
        // P20 — 1 汇集 + 3 plain classes = 4.5 → still B (halves never cross into A):
        { id: 44, activity_type: 'EVENT', activity_date: daysAgo(41), prospect_id: 20, lead_agent_id: 1, event_id: 104 },
        { id: 45, activity_type: 'EVENT', activity_date: daysAgo(42), prospect_id: 20, lead_agent_id: 1, event_id: 101 },
        { id: 46, activity_type: 'EVENT', activity_date: daysAgo(43), prospect_id: 20, lead_agent_id: 1, event_id: 101 },
        { id: 47, activity_type: 'EVENT', activity_date: daysAgo(44), prospect_id: 20, lead_agent_id: 1, event_id: 101 },
        // P26 — 3 汇集 + 1 plain class = 5.5 → A:
        { id: 48, activity_type: 'EVENT', activity_date: daysAgo(31), prospect_id: 26, lead_agent_id: 1, event_id: 104 },
        { id: 49, activity_type: 'EVENT', activity_date: daysAgo(32), prospect_id: 26, lead_agent_id: 1, event_id: 105 },
        { id: 50, activity_type: 'EVENT', activity_date: daysAgo(33), prospect_id: 26, lead_agent_id: 1, event_id: 104 },
        { id: 51, activity_type: 'EVENT', activity_date: daysAgo(34), prospect_id: 26, lead_agent_id: 1, event_id: 101 },
        // group 汇集 P27 only reaches through an attendee row:
        { id: 52, activity_type: 'EVENT', activity_date: daysAgo(13), lead_agent_id: 1, event_id: 104 },
    ];
    ATTENDEES = [
        { id: 1, attendee_type: 'prospect', entity_id: 16, activity_id: 16, attended: true },
        // duplicate signal for a3 (P11 already the activity's prospect) — must NOT double-count:
        { id: 2, attendee_type: 'prospect', entity_id: 11, activity_id: 3, attendance_status: 'Attended' },
        // duplicate for a40 (P17 already the activity's prospect) — 1.5 must NOT become 3:
        { id: 3, attendee_type: 'prospect', entity_id: 17, activity_id: 40, attended: true },
        // P27's only path to the 汇集 — attendee-row weight must also be 1.5:
        { id: 4, attendee_type: 'prospect', entity_id: 27, activity_id: 52, attended: true },
    ];
    PURCHASES = [
        { id: 1, customer_id: 21, item: 'Flexi FengShui Package', date: daysAgo(100) },
        { id: 2, customer_id: 22, item: 'Power Ring PR4', date: daysAgo(200) },
        { id: 3, customer_id: 22, item: 'Authority Power Ring', date: daysAgo(150) },
        { id: 4, customer_id: 23, item: 'Power Ring PR3', date: daysAgo(180) },
        { id: 5, customer_id: 24, item: 'CAI KU Painting', date: daysAgo(90) },
    ];
    REFERRALS = [];

    let d = await fresh();

    const p11 = d.topics.fengshui.find(r => r.key === 'p:11');
    ok('P11 listed on 风水', !!p11);
    eq('P11: A at exactly 5 mentions (owner boundary)', p11 && p11.cat, 'A');
    eq('P11: buckets tick/event/talk = 1/2/2 (priority + SITE auto + attendee dedup)',
        p11 && { tick: p11.tick, event: p11.event, talk: p11.talk, total: p11.total },
        { tick: 1, event: 2, talk: 2, total: 5 });
    eq('P11: last mention = most recent signal date', p11 && p11.last, daysAgo(10));

    const p12 = d.topics.recruit.find(r => r.key === 'p:12');
    eq('P12: 招商 = 1 tick only — DC 日 event added nothing', p12 && { cat: p12.cat, total: p12.total, tick: p12.tick, event: p12.event }, { cat: 'C', total: 1, tick: 1, event: 0 });

    const p13 = d.topics.caiku.find(r => r.key === 'p:13');
    ok('P13: profile ★ alone lists as C with no last-mention date', p13 && p13.cat === 'C' && p13.total === 1 && p13.profile === true && p13.last === '');

    const p15r = d.topics.ring.find(r => r.key === 'p:15');
    const p15f = d.topics.fengshui.find(r => r.key === 'p:15');
    ok('P15: 博物馆 attendance counts for BOTH ring and 风水', !!p15r && !!p15f && p15r.event === 1 && p15f.event === 1);

    const p16 = d.topics.fengshui.find(r => r.key === 'p:16');
    ok('P16: attendee-row-only group event still counts (event bucket)', !!p16 && p16.event === 1);

    // ── 汇集 attended = 1.5 mentions (owner 2026-08-15) ─────────────────────
    const p17 = d.topics.fengshui.find(r => r.key === 'p:17');
    eq('P17: one attended 汇聚 = 1.5, still C (boundaries stay) — attendee dup did not double',
        p17 && { event: p17.event, total: p17.total, cat: p17.cat, last: p17.last },
        { event: 1.5, total: 1.5, cat: 'C', last: daysAgo(7) });
    ok('P17: drill-down entry carries the ×1.5 weight', !!p17 && p17.ev.length === 1 && p17.ev[0].w === 1.5);
    const p18 = d.topics.fengshui.find(r => r.key === 'p:18');
    eq('P18: 汇集 (1.5) + talk (1) = 2.5 → B',
        p18 && { total: p18.total, cat: p18.cat, event: p18.event, talk: p18.talk },
        { total: 2.5, cat: 'B', event: 1.5, talk: 1 });
    const p19 = d.topics.fengshui.find(r => r.key === 'p:19');
    eq('P19: tick made DURING the 汇集 visit is 1.5 too (attended+pitched never < attended alone)',
        p19 && { tick: p19.tick, event: p19.event, total: p19.total },
        { tick: 1.5, event: 0, total: 1.5 });
    const p20 = d.topics.fengshui.find(r => r.key === 'p:20');
    eq('P20: 1 汇集 + 3 classes = 4.5 → still B (halves never cross into A)',
        p20 && { total: p20.total, cat: p20.cat }, { total: 4.5, cat: 'B' });
    const p26 = d.topics.fengshui.find(r => r.key === 'p:26');
    eq('P26: 3 汇集 + 1 class = 5.5 → A', p26 && { total: p26.total, cat: p26.cat }, { total: 5.5, cat: 'A' });
    const p27 = d.topics.fengshui.find(r => r.key === 'p:27');
    eq('P27: attendee-row-only 汇集 also weighs 1.5', p27 && { event: p27.event, total: p27.total }, { event: 1.5, total: 1.5 });

    ok('C21: audited → NOT on the 风水 potential list', !d.topics.fengshui.some(r => r.key === 'c:21'));
    const a21 = d.audited.find(r => r.key === 'c:21');
    eq('C21: audited row shows tier + FSA date (service delivered beats purchase date)',
        a21 && { services: a21.services, date: a21.date }, { services: 'Flexi FengShui', date: daysAgo(60) });
    const a25 = d.audited.find(r => r.key === 'c:25');
    eq('C25: FSA with no purchase = "FSA only"', a25 && a25.services, 'FSA only');

    ok('C22: owns 2 rings → dropped from Power Ring list', !d.topics.ring.some(r => r.key === 'c:22'));
    const c23 = d.topics.ring.find(r => r.key === 'c:23');
    ok('C23: owns 1 ring → still listed (everyone can buy 2), owns=1', !!c23 && c23.owns === 1);
    ok('C24: bought CAI KU Painting → dropped from 财库 list', !d.topics.caiku.some(r => r.key === 'c:24'));

    // ── Scenario 2: coverage weights, gap rule, buckets, not-met, referrals ─
    USERS = [{ id: 1, full_name: 'Alice Tan', role: 'Level 3 Agent' }];
    PROSPECTS = [
        { id: 31, full_name: 'PP Ongoing', phone: '0310', responsible_agent_id: 1 },
        { id: 39, full_name: 'PP Converted Ref', phone: '0390', responsible_agent_id: 1, status: 'converted' },
    ];
    CUSTOMERS = [
        { id: 41, full_name: 'CC Weights', phone: '0410', responsible_agent_id: 1 },
        { id: 42, full_name: 'CC NewGap100', phone: '0420', responsible_agent_id: 1 },
        { id: 43, full_name: 'CC RepeatGap90', phone: '0430', responsible_agent_id: 1 },
        { id: 44, full_name: 'CC LapsedCall150', phone: '0440', responsible_agent_id: 1 },
        { id: 45, full_name: 'CC NeverTouched', phone: '0450', responsible_agent_id: 1 },
    ];
    EVENTS = []; ATTENDEES = []; PURCHASES = [];
    ACTIVITIES = [
        // CC41 — the owner's weight table: 3 meet + 1 class + 1 CPS + 1 call + 1 WA = 5.8
        { id: 21, activity_type: 'FTF', activity_date: daysAgo(0), customer_id: 41, lead_agent_id: 1 },
        { id: 22, activity_type: 'GR', activity_date: daysAgo(20), customer_id: 41, lead_agent_id: 1 },
        { id: 23, activity_type: 'XG', activity_date: daysAgo(40), customer_id: 41, lead_agent_id: 1 },
        { id: 24, activity_type: 'EVENT', activity_date: daysAgo(10), customer_id: 41, lead_agent_id: 1 },
        { id: 25, activity_type: 'CPS', activity_date: daysAgo(15), customer_id: 41, lead_agent_id: 1 },
        { id: 26, activity_type: 'CALL', activity_date: daysAgo(5), customer_id: 41, lead_agent_id: 1 },
        { id: 27, activity_type: 'WHATSAPP', activity_date: daysAgo(3), customer_id: 41, lead_agent_id: 1 },
        { id: 28, activity_type: 'EMAIL', activity_date: daysAgo(2), customer_id: 41, lead_agent_id: 1 }, // counts nothing
        // CC42 — meeting today after 100 days of silence → New Head Count
        { id: 29, activity_type: 'FTF', activity_date: daysAgo(0), customer_id: 42, lead_agent_id: 1 },
        { id: 30, activity_type: 'CALL', activity_date: daysAgo(100), customer_id: 42, lead_agent_id: 1 },
        // CC43 — prior meet EXACTLY 90 days back (outside the 90d window) → Repeat, bucket 1×
        { id: 31, activity_type: 'FTF', activity_date: daysAgo(0), customer_id: 43, lead_agent_id: 1 },
        { id: 32, activity_type: 'FTF', activity_date: daysAgo(90), customer_id: 43, lead_agent_id: 1 },
        // CC44 — nothing in 90d, last contact = call 150 days ago
        { id: 33, activity_type: 'CALL', activity_date: daysAgo(150), customer_id: 44, lead_agent_id: 1 },
        // PP31 — prospect met today, WA 5 days ago → Ongoing (not first-met)
        { id: 34, activity_type: 'FTF', activity_date: daysAgo(0), prospect_id: 31, lead_agent_id: 1 },
        { id: 35, activity_type: 'WHATSAPP', activity_date: daysAgo(5), prospect_id: 31, lead_agent_id: 1 },
    ];
    REFERRALS = [
        { id: 1, referrer_id: 1, referrer_type: 'user', referred_prospect_id: 31, created_at: daysAgo(10) + 'T10:00:00Z' },
        { id: 2, referrer_id: 1, referrer_type: 'user', referred_prospect_id: 39, created_at: daysAgo(20) + 'T10:00:00Z' },
        { id: 3, referrer_id: 1, referrer_type: 'user', referred_prospect_id: 39, created_at: daysAgo(5) + 'T10:00:00Z' }, // dup person → still head count 2
        { id: 4, referrer_id: 31, referrer_type: 'Prospect', referred_prospect_id: 39, created_at: daysAgo(15) + 'T10:00:00Z' },
        { id: 5, referrer_id: 1, referrer_type: 'user', referred_prospect_id: 31, created_at: daysAgo(400) + 'T10:00:00Z' }, // outside 365d
    ];

    d = await fresh();

    const cc41 = d.coverage.custMet.find(r => r.key === 'c:41');
    eq('CC41: weighted total = 3 meet + 1 class + 1 CPS + 0.5 call + 0.3 WA = 5.8 (EMAIL = 0)',
        cc41 && { meet: cc41.meet, cls: cc41.cls, cps: cc41.cps, call: cc41.call, wa: cc41.wa, w: Math.round(cc41.w * 10) / 10 },
        { meet: 3, cls: 1, cps: 1, call: 1, wa: 1, w: 5.8 });

    const cc42 = d.coverage.custMet.find(r => r.key === 'c:42');
    eq('CC42: met after 100-day silence → New', cc42 && cc42.tag, 'New');
    const cc43 = d.coverage.custMet.find(r => r.key === 'c:43');
    eq('CC43: prior touch exactly 90 days back → Repeat (365d history feeds the gap check)', cc43 && cc43.tag, 'Repeat');

    eq('chips: New Head Count = CC42 only', d.coverage.chips.newHead, 1);
    eq('chips: repeat = CC41 + CC43', d.coverage.chips.repeat, 2);
    eq('chips: prospects met this month = PP31', d.coverage.chips.prospectsMet, 1);

    ok('repeat breakdown: CC43 in the 1× bucket (only phys touches inside 90d count)',
        d.coverage.repeatBuckets['1'].some(x => x.name === 'CC RepeatGap90'));
    ok('repeat breakdown: CC41 in the 4+ bucket (5 physical touches)',
        d.coverage.repeatBuckets['4+'].some(x => x.name === 'CC Weights'));

    const cc44 = d.coverage.custNotMet.find(r => r.key === 'c:44');
    eq('CC44: lapsed — last touch shown from 365d history with day count', cc44 && { last: cc44.last, days: cc44.days }, { last: daysAgo(150), days: 150 });
    const cc45 = d.coverage.custNotMet.find(r => r.key === 'c:45');
    ok('CC45: never touched in 12 months → days null (12+ months pill)', !!cc45 && cc45.days === null);
    ok('CC45 sorts before CC44 (never-contacted on top)',
        d.coverage.custNotMet.findIndex(r => r.key === 'c:45') < d.coverage.custNotMet.findIndex(r => r.key === 'c:44'));
    eq('coverage denominator = met + not met', d.coverage.custTotal, 5);
    eq('covered count', d.coverage.coveredCount, 3);

    const pp31 = d.coverage.prospMet.find(r => r.key === 'p:31');
    ok('PP31: WA 5 days before the meet → Ongoing, not first-met', !!pp31 && pp31.firstMet === false);
    ok('converted prospect PP39 never appears in the prospect table', !d.coverage.prospMet.some(r => r.key === 'p:39'));

    const agent1 = d.referral.agents.find(r => r.key === 'u:1');
    eq('referral: agent head count dedups the double-written person and drops the 400d-old row',
        agent1 && { count: agent1.count, converted: agent1.converted }, { count: 2, converted: 1 });
    const client31 = d.referral.clients.find(r => r.key === 'p:31');
    eq('referral: prospect referrer on the clients board, type-case-insensitive, converted tracked',
        client31 && { count: client31.count, converted: client31.converted }, { count: 1, converted: 1 });

    // ── Render helper: top-5 collapse/expand ────────────────────────────────
    const rows = Array.from({ length: 7 }, (_, i) => [`name${i}`, String(i)]);
    const collapsed = T._nlTable('t-demo', ['Name', 'N'], rows, 'empty');
    ok('table collapsed: 5 rows + "Show all (7)"',
        (collapsed.match(/<tr>/g) || []).length === 6 && collapsed.includes('Show all (7)'), collapsed.slice(0, 200));
    T._nlExpanded.add('t-demo');
    const expanded = T._nlTable('t-demo', ['Name', 'N'], rows, 'empty');
    ok('table expanded: all 7 rows + "Show top 5 only"',
        (expanded.match(/<tr>/g) || []).length === 8 && expanded.includes('Show top 5 only'));
    T._nlExpanded.delete('t-demo');

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE CRASH:', e); process.exit(1); });
