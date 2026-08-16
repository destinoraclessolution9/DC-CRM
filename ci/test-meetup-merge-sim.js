// ci/test-meetup-merge-sim.js — behavioural smoke test for the merged
// "Meet Ups & Events" timeline (2026-08-16) in chunks/script-prospects.js
// (switchProspectTab tab==='activity') and chunks/script-customers.js
// (renderCustomerActivityTab).
//
// Loads the REAL chunks in a vm sandbox with stubbed window/AppDataStore/UI/
// document, then exercises the merge invariants: disjoint type sets, owner-wins
// attendee dedup, closing_activity_id pairing (attended+closed = ONE row),
// NaN-safe sort (empty dates, 'att' string ids), invalid-event filtering,
// registrations dedup, XSS escaping, and preserved button handlers.
// Run: node ci/test-meetup-merge-sim.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function check(name, got, want = true) {
  if (got === want) { pass++; return; }
  fail++;
  console.error(`FAIL ${name}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`);
}

// ─── DOM stub ───────────────────────────────────────────────────────────────
const elements = new Map();
function makeEl(id) {
  const el = {
    id, innerHTML: '', value: '', textContent: '', dataset: {}, style: {},
    children: [], classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    appendChild(c) { this.children.push(c); },
    insertAdjacentHTML() {},
    remove() {},
  };
  if (id) elements.set(id, el);
  return el;
}
const documentStub = {
  getElementById: (id) => elements.get(id) || null,
  createElement: () => makeEl(null),
  body: makeEl('__body__'),
  querySelectorAll: () => [],
  addEventListener: () => {},
};

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const levelOf = (u) => { const m = /Level\s+(\d+)/i.exec(u?.role || ''); return m ? parseInt(m[1], 10) : 99; };
const _crmUtils = new Proxy({
  escapeHtml,
  getUserLevel: levelOf,
  isSystemAdmin: (u) => levelOf(u) === 1,
  isMarketingManager: (u) => levelOf(u) === 2,
  isManagement: (u) => levelOf(u) <= 4,
  isTeamLeaderOrAbove: (u) => levelOf(u) <= 5,
  isAgent: (u) => levelOf(u) >= 3 && levelOf(u) <= 12,
  isMobile: () => false,
  debounce: (fn) => fn,
  debounceCall: (fn) => fn,
  canViewCustomer: () => true,
  canViewProspect: () => true,
  getVisibleCustomers: () => [],
  getVisibleUserIds: () => [],
  USER_ROLES: [],
}, { get: (t, k) => (k in t ? t[k] : () => undefined) });
const UI = new Proxy({
  showModal: () => {}, hideModal: () => {},
  confirm: (t, m, cb) => cb && cb(),
  toast: { success: () => {}, error: () => {} },
  money: (v) => `RM ${v}`,
  formatDate: (d) => String(d || ''),
  escJsAttr: (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"),
}, { get: (t, k) => (k in t ? t[k] : () => '') });

// ─── fixtures ───────────────────────────────────────────────────────────────
const EVENTS = [
  { id: 900, title: 'Ev900 家居小物件', event_title: 'Ev900 家居小物件' },
  { id: 901, title: 'Ev901 own event' },
  { id: 902, title: 'Ev902 registered only' },
  { id: 904, title: 'Ev904 pending close' },
  { id: 905, title: 'Ev905 reg row' },
];
// Prospect 55's own activities (both MEETUP_TYPES and EVENT_TYPES mixed).
const PROSPECT_ACTS = [
  { id: 10, prospect_id: 55, activity_type: 'CPS', activity_title: 'CPS With Koid', activity_date: '2026-08-15', is_closed: false },
  { id: 11, prospect_id: 55, activity_type: 'EVENT', activity_title: 'My Own Event', activity_date: '2026-07-20', event_id: 901 },
  { id: 12, prospect_id: 55, activity_type: 'EVENT_CLOSING', activity_title: 'Closing at Ev900', activity_date: '2026-08-08', event_id: 900, is_closed: true },
  { id: 13, prospect_id: 55, activity_type: 'CALL', activity_title: 'No-date call', activity_date: '' },
  { id: 14, prospect_id: 55, activity_type: 'CPS', activity_title: '<img src=x onerror=alert(1)>', activity_date: '2026-08-01' },
  { id: 15, prospect_id: 55, activity_type: 'EVENT', activity_title: 'Ghost Event', activity_date: '2026-08-02', event_id: 903 }, // event 903 missing -> excluded
  { id: 18, prospect_id: 55, activity_type: 'EVENT_CLOSING', activity_title: 'Pending close', activity_date: '2026-08-14', event_id: 904, is_closed: false }, // paired, NOT yet closed
];
const ATTENDEE_ROWS_P = [
  // attended + closed at Ev900 — pairs with EVENT_CLOSING id 12 via closing_activity_id.
  // photo_urls here come from event_attendees — MUST stay untouched by the
  // activities photo enrichment and MUST route through viewAttendeePhotos.
  { id: 'att1', _parentActivityId: 999, _attendeeRowId: 1, _isAttendeeNote: true, activity_type: 'EVENT', activity_title: '家居小物件隱藏大禍害', activity_date: '2026-08-15', event_id: 900, closing_activity_id: 12, paid: true, ticket_created: true, attended: true, attendance_status: 'Attended', added_by_name: 'Agent A', photo_urls: ['e1.jpg', 'e2.jpg'] },
  // attended, closing child created but sale NOT yet closed — the sub-block
  // must keep the Close Sale button on the CLOSING child id (money path).
  { id: 'att4', _parentActivityId: 996, _attendeeRowId: 4, _isAttendeeNote: true, activity_type: 'EVENT', activity_title: 'Pending Close Event', activity_date: '2026-08-14', event_id: 904, closing_activity_id: 18, paid: false, ticket_created: false, attended: true, attendance_status: 'Attended', photo_urls: [] },
  // parent activity 11 is an OWN row — owner wins, attendee row dropped
  { id: 'att2', _parentActivityId: 11, _attendeeRowId: 2, _isAttendeeNote: true, activity_type: 'EVENT', activity_title: 'DUP-SHOULD-DROP', activity_date: '2026-07-20', event_id: 901, closing_activity_id: null, paid: false, ticket_created: false, attended: false, attendance_status: 'Registered', photo_urls: [] },
  // plain registered attendance, no notes
  { id: 'att3', _parentActivityId: 998, _attendeeRowId: 3, _isAttendeeNote: true, activity_type: 'EVENT', activity_title: '', activity_date: '2026-06-01', event_id: 902, closing_activity_id: null, paid: false, ticket_created: false, attended: false, attendance_status: 'Registered', photo_urls: [] },
];
const REGS_P = [
  { attendee_type: 'prospect', attendee_id: 55, event_id: 900, attendance_status: 'Attended', event_date: '2026-08-15', points_awarded: 5 },  // covered by att1 -> hidden
  { attendee_type: 'prospect', attendee_id: 55, event_id: 905, attendance_status: 'Registered', event_date: '2026-05-01', points_awarded: 2 }, // shown
  { attendee_type: 'prospect', attendee_id: 55, event_id: 906, attendance_status: 'Cancelled', event_date: '2026-05-02', points_awarded: 0 },  // invalid status -> hidden
];

const CUSTOMER = { id: 77, full_name: '陈大文', converted_from_prospect_id: 55, country: 'MY' };
const CUST_ACTS = [
  { id: 20, customer_id: 77, activity_type: 'CALL', activity_title: 'Called her', activity_date: '2026-08-10', notes: 'called about renewal', outcome: 'Positive' },
  { id: 25, customer_id: 77, activity_type: 'EVENT_CLOSING', activity_title: 'Cust Closing', activity_date: '2026-08-13', event_id: 902, is_closed: true, summary: 'closed at event' },
];
const CUST_PROSP_ACTS = [
  { id: 20, customer_id: 77, activity_type: 'CALL', activity_title: 'Called her', activity_date: '2026-08-10', notes: 'called about renewal', outcome: 'Positive' }, // duplicate -> dedup
  { id: 22, prospect_id: 55, activity_type: 'FTF', activity_title: 'Old FTF', activity_date: '2026-07-01' },
];
const ATTENDEE_ROWS_C = [
  { id: 'att5', _parentActivityId: 997, _attendeeRowId: 5, _isAttendeeNote: true, activity_type: 'EVENT', activity_title: 'Customer event', activity_date: '2026-08-12', event_id: 900, closing_activity_id: null, paid: true, ticket_created: false, attended: true, attendance_status: 'Attended', photo_urls: [] },
  { id: 'att6', _parentActivityId: 20, _attendeeRowId: 6, _isAttendeeNote: true, activity_type: 'EVENT', activity_title: 'DROP-ME', activity_date: '2026-08-11', event_id: 901, closing_activity_id: null, paid: false, ticket_created: false, attended: false, attendance_status: 'Registered', photo_urls: [] },
  // customer attended + closed — customer-side pairing must also fold to ONE row
  { id: 'att7', _parentActivityId: 995, _attendeeRowId: 7, _isAttendeeNote: true, activity_type: 'EVENT', activity_title: 'Closing Event C', activity_date: '2026-08-13', event_id: 902, closing_activity_id: 25, paid: false, ticket_created: false, attended: true, attendance_status: 'Attended', photo_urls: [] },
];
const REGS_C = [
  { attendee_type: 'customer', attendee_id: 77, event_id: 905, attendance_status: 'Registered', event_date: '2026-04-01', points_awarded: 3 }, // shown
  { attendee_type: 'customer', attendee_id: 77, event_id: 900, attendance_status: 'Attended', event_date: '2026-08-12', points_awarded: 9 },   // covered by att5 -> hidden
];

const makeStore = (attendeeMode) => ({
  async getById(table, id) {
    if (table === 'prospects') return String(id) === '55' ? { id: 55, full_name: 'Koid Wei Gaik', phone: '' } : null;
    if (table === 'customers') return String(id) === '77' ? CUSTOMER : null;
    return null;
  },
  async getAll(table) {
    if (table === 'events') return EVENTS.slice();
    if (table === 'event_registrations') return (attendeeMode === 'customer' ? REGS_C : REGS_P).slice();
    return [];
  },
  async query() { return []; },
  async getActivitiesForProspect(id) {
    if (String(id) === '55' && attendeeMode !== 'customer') return PROSPECT_ACTS.map(a => ({ ...a }));
    if (String(id) === '55' && attendeeMode === 'customer') return CUST_PROSP_ACTS.map(a => ({ ...a }));
    return [];
  },
  async getActivitiesForCustomer(id) { return String(id) === '77' ? CUST_ACTS.map(a => ({ ...a })) : []; },
  async create() { return {}; }, async update() { return {}; }, async delete() { return {}; },
  getJourneyTouchpoints: async () => [],
});

function makeSandbox(store, attendeeRows, expectedAttendeeType, supabaseStub) {
  const windowStub = {
    _appState: { cu: { id: 1, role: 'Level 1 Super Admin', full_name: 'Admin' }, cv: 'prospects' },
    _crmUtils,
    app: null,
    _loadChunk: async () => {},
    addEventListener: () => {},
    location: { reload: () => {} },
    // photo enrichment path: only active when a supabase stub is provided
    supabase: supabaseStub || undefined,
  };
  const appStub = {
    register(name, fns) { Object.assign(this, fns); },
    navigateTo: async () => {},
    getProspectAttendeeNotes: async (id, opts) => {
      // includeWithoutNotes MUST survive the merge — attendance is the record.
      if (!opts || opts.includeWithoutNotes !== true) return [];
      // attendeeType MUST match the profile entity — the real implementation
      // (script-calendar.js) filters by opts.attendeeType || 'prospect', so a
      // dropped/wrong attendeeType would leak another entity's attendance.
      if ((opts.attendeeType || 'prospect') !== expectedAttendeeType) return [];
      return attendeeRows.map(a => ({ ...a }));
    },
    SCORING_RULES: { CREATE_PROSPECT: 5 },
  };
  windowStub.app = appStub;
  const sandbox = {
    window: windowStub, document: documentStub, AppDataStore: store, UI, app: appStub,
    console, setTimeout: (fn) => fn && undefined, clearTimeout: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { userAgent: 'node-sim' },
    URL, Blob: function () {}, FileReader: function () {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return { sandbox, windowStub };
}

(async () => {
  // ═══ PROSPECT side ════════════════════════════════════════════════════════
  {
    // supabase stub: fresh photo_urls enrichment returns photos for own row 10
    // only — attendee rows keep their event_attendees-sourced photo_urls.
    const supabaseStub = { from: () => ({ select: () => ({ eq: async () => ({ data: [{ id: 10, photo_urls: ['p1.jpg'] }] }) }) }) };
    const { sandbox, windowStub } = makeSandbox(makeStore('prospect'), ATTENDEE_ROWS_P, 'prospect', supabaseStub);
    const src = fs.readFileSync(path.join(__dirname, '..', 'chunks', 'script-prospects.js'), 'utf8');
    vm.runInContext(src, sandbox, { filename: 'script-prospects.js' });
    const app = windowStub.app;
    check('P registered: switchProspectTab', typeof app.switchProspectTab, 'function');

    const body = makeEl('acc-body-activity-55');
    await app.switchProspectTab('activity', 55, null, body);
    const html = body.innerHTML;

    // merged rows present
    check('P: CPS meetup row rendered', html.includes('CPS With Koid'));
    check('P: own event row rendered', html.includes('My Own Event'));
    check('P: attendee row rendered', html.includes('家居小物件隱藏大禍害'));
    check('P: registered-only attendee rendered', html.includes('Ev902 registered only') || html.includes('att3') || (html.match(/registered/g) || []).length >= 1);
    // invalid own EVENT excluded (event 903 not in events table)
    check('P: ghost event excluded', !html.includes('Ghost Event'), true);
    // owner-wins dedup
    check('P: duplicate attendee row dropped', !html.includes('DUP-SHOULD-DROP'), true);
    // closing pair = ONE row: EVENT_CLOSING 12 renders as sub-block, not standalone row
    check('P: Sale Closed badge present', html.includes('Sale Closed'));
    check('P: closing sub-block present', html.includes('mu-close-sub'));
    check('P: closing Minutes acts on closing child id', html.includes('app.openPostMeetupNotesModal(12, 55)'));
    const closingChipCount = (html.match(/>CLOSING</g) || []).length;
    check('P: no standalone CLOSING row (paired)', closingChipCount, 0);
    // XSS
    check('P: XSS title escaped', !html.includes('<img src=x'), true);
    check('P: escaped payload visible', html.includes('&lt;img'));
    // handlers preserved
    check('P: Past Record kept', html.includes('app.openPastRecordModal(55)'));
    check('P: single Add button (openActivityModal)', (html.match(/app\.openActivityModal\('', 55\)/g) || []).length, 1);
    check('P: Minutes handler kept', html.includes('app.openPostMeetupNotesModal(10, 55)'));
    check('P: Close Sale handler kept (unclosed CPS)', html.includes('app.openMeetingOutcomeModal(10)'));
    check('P: Attach Photo kept (photo-less row)', html.includes('app.attachActivityPhoto(13)'));
    // pending-close pair: sub-block keeps Close Sale on the CLOSING child id
    check('P: unclosed paired closing keeps Close Sale in sub-block', html.includes('app.openMeetingOutcomeModal(18)'));
    // photo enrichment: own row 10 enriched from the fresh query; attendee row
    // keeps its event_attendees photos and routes through viewAttendeePhotos
    check('P: enriched own-row photos button', html.includes('app.viewActivityPhotos(10)') && html.includes('Photos (1)'));
    check('P: attendee photos keep source and viewer', html.includes('app.viewAttendeePhotos(1)') && html.includes('Photos (2)'));
    check('P: attendee Post Event Notes handler', html.includes('app.openAttendeePostEventModal(1, 999, 55)'));
    check('P: attendee Details routes to parent', html.includes('app.viewActivityDetails(999)'));
    check('P: stopPropagation on action buttons', html.includes('event.stopPropagation();app.openPostMeetupNotesModal(10, 55)'));
    // ordering: 2026-08-15 rows first, no-date row last
    const iCps = html.indexOf('CPS With Koid');
    const iAtt = html.indexOf('家居小物件隱藏大禍害');
    const iOwn = html.indexOf('My Own Event');
    const iNoDate = html.indexOf('No-date call');
    check('P: date desc — CPS(08-15) before own event(07-20)', iCps > -1 && iOwn > iCps);
    check('P: date desc — attendee(08-15) before own event(07-20)', iAtt > -1 && iOwn > iAtt);
    check('P: empty date sorts last', iNoDate > iOwn);
    // registrations dedup
    check('P: reg for covered event 900 hidden', !html.includes('Ev900 家居小物件</td>'), true);
    check('P: reg for event 905 shown', html.includes('Ev905 reg row'));
    check('P: invalid-status reg hidden', !html.includes('Cancelled'), true);
    // filter chips + counts (7 rows: 10,11,13,14,att1,att3,att4 — 3 meetups / 4 events)
    check('P: All count', html.includes('All (7)'));
    check('P: Meet Ups count', html.includes('Meet Ups (3)'));
    check('P: Events count', html.includes('Events (4)'));
    // attendance chips survive for note-less rows
    check('P: attendance chips rendered', html.includes('✓ Paid') && html.includes('✓ Ticket'));
  }

  // ═══ CUSTOMER side ════════════════════════════════════════════════════════
  {
    const { sandbox, windowStub } = makeSandbox(makeStore('customer'), ATTENDEE_ROWS_C, 'customer');
    const src = fs.readFileSync(path.join(__dirname, '..', 'chunks', 'script-customers.js'), 'utf8');
    vm.runInContext(src, sandbox, { filename: 'script-customers.js' });
    const app = windowStub.app;
    check('C registered: renderCustomerActivityTab', typeof app.renderCustomerActivityTab, 'function');

    const body = makeEl('cust-acc-body-activity-77');
    await app.renderCustomerActivityTab(CUSTOMER, 'cust-acc-body-activity-77');
    const html = body.innerHTML;

    check('C: activity row rendered', html.includes('Called her'));
    check('C: notes preserved', html.includes('called about renewal'));
    check('C: outcome badge preserved', html.includes('Positive'));
    check('C: pre-conversion prospect FTF included', html.includes('Old FTF'));
    check('C: duplicate id deduped (one Called her)', (html.match(/Called her/g) || []).length, 1);
    check('C: attendee row rendered', html.includes('Customer event'));
    check('C: owner-wins dedup (attendee of own activity dropped)', !html.includes('DROP-ME'), true);
    check('C: attended badge', html.includes('✓ attended'));
    // customer-side pairing: attended+closed folds into ONE row with sub-block
    check('C: paired closing folds into attendee row', html.includes('mu-close-sub'));
    check('C: no standalone CLOSING chip', (html.match(/>CLOSING</g) || []).length, 0);
    check('C: Sale Closed badge on paired row', html.includes('Sale Closed'));
    check('C: closing notes surfaced in sub-block', html.includes('closed at event'));
    check('C: Log Activity kept', html.includes("app.openActivityModal(null, 'customer', 77)"));
    // registrations: 905 shown (+3 pts), 900 covered by att5 -> hidden
    check('C: supplemental reg shown', html.includes('Ev905 reg row'));
    check('C: covered reg hidden (+9 not shown)', !html.includes('+9 pts'), true);
    // Total Events = attendeeRows(3) + shown regs(1) = 4; Points = 3
    check('C: Total Events preserved', html.includes('Total Events: 4'));
    check('C: Points preserved', html.includes('3 Points'));
    // order: att5(08-12) after CALL(08-10)? No — 08-12 > 08-10 so att5 FIRST
    const iCall = html.indexOf('Called her');
    const iAtt5 = html.indexOf('Customer event');
    check('C: date desc — attendee(08-12) before CALL(08-10)', iAtt5 > -1 && iCall > iAtt5);
    // filter chips: 4 rows -> 2 meetups (CALL, FTF; closing 25 paired away) + 2 events (att5, att7)
    check('C: All count', html.includes('All (4)'));
    check('C: Meet Ups count', html.includes('Meet Ups (2)'));
    check('C: Events count', html.includes('Events (2)'));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
