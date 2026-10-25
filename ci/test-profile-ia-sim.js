// ci/test-profile-ia-sim.js — behavioural test for the 2026-10-25 profile
// reorganisation (chunks/script-prospects.js + chunks/script-customers.js):
//   * snapshot cards — next follow-up picks an overdue task before a booked
//     meeting, else the earliest; last meeting skips calls / future rows and
//     opens the paired attendee row for an event closing
//   * tabs — every section exactly once, each in one pane; retired sections gone
//   * Next up — open tasks by due date, overdue from the date (not the status),
//     source links, done folded away, titles escaped
//   * task line in the timeline — task state, or the words as history
//   * Opportunities — deals split open / closed, retired forecast fields gone,
//     "What we know" takes the NEWEST value of each
// Loads the REAL chunks in a vm sandbox with stubbed window / AppDataStore /
// supabase / document. Run: node ci/test-profile-ia-sim.js
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

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };

// ─── DOM stub (ids + the few selectors the snapshot uses) ──────────────────
function makeDom() {
  const byId = new Map();
  const el = (id) => {
    const e = { id: id || '', innerHTML: '', textContent: '', value: '', dataset: {}, style: {}, className: '',
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); }, toggle() {} },
      setAttribute() {}, getAttribute() { return null; }, querySelector: () => null, querySelectorAll: () => [],
      insertAdjacentHTML() {}, scrollIntoView() {}, closest: () => null, remove() {}, appendChild() {} };
    if (id) byId.set(id, e);
    return e;
  };
  const cards = {};
  const snapRoots = new Map();
  const snapRoot = (key) => {
    if (!snapRoots.has(key)) {
      const r = el(null);
      r.querySelector = (sel) => { const m = /data-card="(\w+)"/.exec(sel); if (!m) return null; return (cards[`${key}|${m[1]}`] = cards[`${key}|${m[1]}`] || el(null)); };
      snapRoots.set(key, r);
    }
    return snapRoots.get(key);
  };
  const document = {
    getElementById: (id) => byId.get(id) || null,
    createElement: () => el(null),
    body: el('__body__'),
    head: el('__head__'),
    addEventListener: () => {},
    querySelector: (sel) => { const m = /\.pv-snap\[data-snap="([^"]+)"\]/.exec(sel); return m ? snapRoot(m[1]) : null; },
    querySelectorAll: (sel) => {
      const m = /\[data-card="potential"\]\[data-pot-for="(\d+)"\]/.exec(sel);
      if (m) return [...snapRoots.keys()].map(k => snapRoot(k).querySelector('[data-card="potential"]'));
      return [];
    },
  };
  return { document, el, card: (key, c) => cards[`${key}|${c}`] };
}

const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const levelOf = (u) => { const m = /Level\s+(\d+)/i.exec(u?.role || ''); return m ? parseInt(m[1], 10) : 99; };
const _crmUtils = new Proxy({
  escapeHtml, getUserLevel: levelOf,
  isSystemAdmin: (u) => levelOf(u) === 1, isMarketingManager: (u) => levelOf(u) === 2,
  isManagement: (u) => levelOf(u) <= 4, isTeamLeaderOrAbove: (u) => levelOf(u) <= 5,
  isAgent: (u) => levelOf(u) >= 3 && levelOf(u) <= 12, isMobile: () => false,
  debounce: (fn) => fn, debounceCall: (fn) => fn,
  canViewCustomer: async () => true, canViewProspect: async () => true, canEditProspect: async () => true,
  getVisibleCustomers: () => [], getVisibleUserIds: () => [], USER_ROLES: [],
  calculateProtectionDays: () => 43, getProtectionStatus: () => 'normal', getScoreGrade: () => 'D',
  recordCurrency: () => 'MYR',
}, { get: (t, k) => (k in t ? t[k] : () => undefined) });
const UI = new Proxy({
  showModal: () => {}, hideModal: () => {}, toast: { success: () => {}, error: () => {} },
  money: (v) => `RM ${v}`, formatDate: (d) => String(d || ''),
  escJsAttr: (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"),
}, { get: (t, k) => (k in t ? t[k] : () => '') });

// ─── fixtures ───────────────────────────────────────────────────────────────
const PID = 55, CID = 77;
const PROSPECT = { id: PID, full_name: 'Koid <b>Wei</b> Gaik', phone: '012-345 6789', date_of_birth: '1978-04-02', ming_gua: 'MG6', responsible_agent_id: 7, referred_by: 'Tan', manual_grade: 'B', score: 15, protection_deadline: iso(43), status: 'active' };
const CUSTOMER = { id: CID, full_name: 'Chen Mei Lin', phone: '016-222 3333', converted_from_prospect_id: PID, responsible_agent_id: 7, customer_since: '2025-03-01', country: 'MY' };
const ACTS = [
  { id: 10, prospect_id: PID, activity_type: 'CPS', activity_title: 'CPS one', activity_date: iso(-30), next_action: 'old step' },
  { id: 11, prospect_id: PID, activity_type: 'FTF', activity_title: 'FTF latest', activity_date: iso(-3), next_action: '九星课 | Remarks: call his wife' },
  { id: 12, prospect_id: PID, activity_type: 'CALL', activity_title: 'A call', activity_date: iso(-1) },            // not a meeting
  { id: 13, prospect_id: PID, activity_type: 'FTF', activity_title: 'Booked FTF', activity_date: iso(5) },          // booked
  { id: 14, prospect_id: PID, activity_type: 'EVENT_CLOSING', activity_title: 'Closing at event', activity_date: iso(-10) },
];
const ATTENDEES = [
  { id: 'att9', _attendeeRowId: 9, _parentActivityId: 900, _isAttendeeNote: true, activity_type: 'EVENT', activity_title: 'Event A', activity_date: iso(-10), attended: true, attendance_status: 'Attended', closing_activity_id: 14, next_action: 'Book FSA' },
];
const FRESH = { // fresh activity rows (minutes / needs) — newest first
  11: { id: 11, activity_type: 'FTF', activity_date: iso(-3), note_key_points: 'Wants PR3; wife decides', outcome: 'positive', note_needs: 'Newest need', note_pain_points: '', meeting_minutes: { reaction: 'Keen' } },
  10: { id: 10, activity_type: 'CPS', activity_date: iso(-30), note_needs: 'Old need', note_pain_points: 'Old pain <script>', meeting_minutes: null },
};
let TASKS = [];
const DEALS = [
  { id: 31, prospect_id: PID, product: 'Power Ring PR3', amount: 18990, stage: 'proposal', expected_close_date: iso(20), next_step: 'Send quotation', auto_created: false },
  { id: 32, prospect_id: PID, product: 'Course', amount: 1880, stage: 'interested', expected_close_date: iso(-2), next_step: '个人风水基础课', auto_created: true },
  { id: 33, prospect_id: PID, product: 'Old won', amount: 5000, stage: 'won', expected_close_date: iso(-40) },
];
const POT = { open_potential_rm: 20870, open_potential_detail: { items: [{ label: 'Power Ring PR3', price: 18990, src: 'deal' }, { label: 'Course', price: 0, src: 'meeting' }] }, potential_tier: 'hot', potential_level: 'Warm' };

function makeSupabase() {
  return {
    from(table) {
      const st = { filters: [] };
      const b = {
        select() { return b; }, order() { return b; }, limit() { return b; }, or(x) { st.or = x; return b; }, not() { st.not = true; return b; }, like() { return b; },
        in(k, v) { st.filters.push(['in', k, v]); return b; }, eq(k, v) { st.filters.push(['eq', k, v]); return b; },
        maybeSingle() { st.single = true; return b; },
        then(res, rej) {
          let data = [];
          if (table === 'journey_touchpoints') {
            data = TASKS.slice();
            const inF = st.filters.find(f => f[0] === 'in' && f[1] === 'status');
            if (inF) data = data.filter(t => inF[2].includes(t.status));
            if (st.not) data = data.filter(t => t.source_deal_id != null);
          } else if (table === 'prospects') data = POT;
          else if (table === 'pipeline_deals') data = DEALS.slice();
          else if (table === 'products') data = [{ name: 'Power Ring PR3', short_code: 'PR3' }];
          else if (table === 'activities') {
            const idF = st.filters.find(f => f[1] === 'id');
            data = idF ? (FRESH[idF[2]] || null) : Object.values(FRESH).sort((a, b) => b.activity_date.localeCompare(a.activity_date));
          }
          if (st.single && Array.isArray(data)) data = data[0] || null;
          return Promise.resolve({ data, error: null }).then(res, rej);
        },
      };
      return b;
    },
    rpc: async () => ({ data: [], error: null }),
  };
}

function makeSandbox() {
  const dom = makeDom();
  const store = {
    async getById(t, id) { return t === 'prospects' ? { ...PROSPECT } : t === 'customers' ? { ...CUSTOMER } : t === 'users' ? { id, full_name: id === 8 ? 'Agent Wong' : 'Agent Oo' } : null; },
    async getByIdFull(t, id) { return this.getById(t, id); },
    async getActivitiesForProspect() { return ACTS.map(a => ({ ...a })); },
    async getActivitiesForCustomer() { return []; },
    async getAll() { return []; }, async query() { return []; },
    async queryAdvanced() { return { data: [], count: 0 }; },
    getJourneyTouchpoints: async () => [],
    invalidateCache() {},
  };
  const appStub = {
    register(name, fns) { Object.assign(this, fns); },
    navigateTo: async () => {},
    getProspectAttendeeNotes: async () => ATTENDEES.map(a => ({ ...a })),
    switchCustomerProfileTab: async () => {},
    SCORING_RULES: { CREATE_PROSPECT: 5 },
  };
  const windowStub = {
    _appState: { cu: { id: 7, role: 'Level 5 Team Leader', full_name: 'Agent Oo' }, cv: 'prospects' },
    _crmUtils, app: appStub, _loadChunk: async () => {}, addEventListener: () => {},
    location: { reload: () => {} }, supabase: makeSupabase(),
  };
  const sandbox = {
    window: windowStub, document: dom.document, AppDataStore: store, UI, app: appStub,
    console, setTimeout: (fn) => { try { fn(); } catch (_) { /* ignore */ } }, clearTimeout: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { userAgent: 'node-sim' }, URL, Blob: function () {}, FileReader: function () {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'chunks', 'script-prospects.js'), 'utf8'), sandbox, { filename: 'script-prospects.js' });
  return { dom, app: windowStub.app, sandbox };
}
const flush = () => new Promise(r => setImmediate(r));

(async () => {
  // ═══ Snapshot + tabs ═══════════════════════════════════════════════════════
  {
    TASKS = [
      { id: 1, prospect_id: PID, title: '📝 九星课 — call his wife', due_date: iso(-2), status: 'pending', source_kind: 'meeting', source_activity_id: 11 },
      { id: 2, prospect_id: PID, title: '💬 Journey call', due_date: iso(3), status: 'pending', stage_name: 'pr_post_cps' },
    ];
    const { dom, app } = makeSandbox();
    const viewport = dom.el('content-viewport');
    await app.showProspectDetail(PID);
    for (let i = 0; i < 6; i++) await flush();
    const html = viewport.innerHTML;
    const keys = [...html.matchAll(/id="acc-([a-z]+)-55"/g)].map(m => m[1]).filter(k => k !== 'container');
    const want = ['tasks', 'activity', 'notes', 'potential', 'journey', 'fengshui', 'names', 'closing', 'bujishu', 'formula', 'forms', 'docs', 'info', 'tags'];
    check('tabs: every section once, in order', JSON.stringify(keys), JSON.stringify(want));
    const panes = [...html.matchAll(/id="acc-([a-z]+)-55" data-pane="(\w+)"/g)].map(m => m[2]);
    check('tabs: every section has a pane', panes.length, want.length);
    check('tabs: four tab buttons', (html.match(/role="tab"/g) || []).length, 4);
    check('tabs: opens on Engagement', html.includes('data-tab="engagement"'));
    check('retired: no Next Actions section', !html.includes('acc-nextactions-'));
    check('retired: no Protection section', !html.includes('acc-protection-'));
    check('retired: no 🎯 follow-up box / 💰 header badge', !html.includes('fu-line') && !html.includes('data-pot-pid'));
    check('header: name escaped', html.includes('Koid &lt;b&gt;Wei&lt;/b&gt; Gaik'));
    check('header: Book follow-up is the primary action', /btn primary btn-sm pv-cta" onclick="app\.openActivityModal\('', 55\)"/.test(html));
    check('header: protection chip opens the sheet', html.includes('app.openProtectionSheet(55)'));
    check('header: key facts (age, ming gua)', html.includes('Ming Gua 6') && /Age \d+/.test(html));

    const next = dom.card('prospect:55', 'next').innerHTML;
    check('next card: overdue task beats the booked FTF', next.includes('Overdue · 2 days') && next.includes('call his wife'));
    check('next card: counts the other open task', next.includes('+1 more open task'));
    const last = dom.card('prospect:55', 'last').innerHTML;
    check('last card: newest meeting, not the later CALL', last.includes('FTF latest') && !last.includes('A call'));
    check('last card: summary from the fresh row', last.includes('Wants PR3; wife decides') && last.includes('Positive'));
    check('last card: opens that row', last.includes("app.pvOpenMeeting('prospect', 55, 'mu-11')"));
    const pot = dom.card('prospect:55', 'potential').innerHTML;
    check('potential card: total + tier', pot.includes('RM 20,870') && pot.includes('Hot'));
  }
  {
    // no overdue task → the booked meeting (earlier than the next task) wins
    TASKS = [{ id: 3, prospect_id: PID, title: 'Later task', due_date: iso(9), status: 'pending' }];
    const { dom, app } = makeSandbox();
    dom.el('content-viewport');
    await app.showProspectDetail(PID);
    for (let i = 0; i < 6; i++) await flush();
    const next = dom.card('prospect:55', 'next').innerHTML;
    check('next card: booked FTF before a later task', next.includes('Booked · FTF') && next.includes('Booked FTF'));
  }
  {
    // nothing open, nothing booked; last meeting = an event closing → paired attendee row
    TASKS = [];
    const saved = ACTS.splice(0, ACTS.length, ACTS[4]);
    const { dom, app } = makeSandbox();
    dom.el('content-viewport');
    await app.showProspectDetail(PID);
    for (let i = 0; i < 6; i++) await flush();
    check('next card: nothing booked', dom.card('prospect:55', 'next').innerHTML.includes('Nothing booked'));
    check('last card: event closing opens its attendee row', dom.card('prospect:55', 'last').innerHTML.includes("'mu-att9'"));
    ACTS.splice(0, ACTS.length, ...saved);
  }

  // ═══ Next up ═══════════════════════════════════════════════════════════════
  {
    TASKS = [
      { id: 1, prospect_id: PID, title: 'Late <img src=x>', due_date: iso(-4), status: 'pending', source_kind: 'meeting', source_activity_id: 11, assigned_to_id: 7 },
      { id: 2, prospect_id: PID, title: 'Deal step', due_date: iso(0), status: 'pending', source_kind: 'deal', source_deal_id: 31, assigned_to_id: 8 },
      { id: 3, prospect_id: PID, title: 'Event step', due_date: iso(2), status: 'overdue', source_kind: 'meeting', source_attendee_id: 9 },
      { id: 4, prospect_id: PID, title: 'Hand task', due_date: iso(1), status: 'pending', source_kind: 'manual' },
      { id: 5, prospect_id: PID, title: 'Finished', due_date: iso(-9), status: 'done', completed_at: iso(-8) + 'T09:00:00Z', source_kind: 'meeting', source_activity_id: 10 },
      { id: 6, prospect_id: PID, title: 'Ancient', due_date: iso(-200), status: 'done', completed_at: iso(-190) + 'T09:00:00Z' },
    ];
    const { dom, app } = makeSandbox();
    const body = dom.el('acc-body-tasks-55');
    await app.renderProfileTasks('prospect', PID, PID, body);
    const html = body.innerHTML;
    const order = ['Late', 'Deal step', 'Hand task', 'Event step'].map(t => html.indexOf(t));
    check('next up: open tasks by due date', order.every((v, i) => v > -1 && (i === 0 || v > order[i - 1])));
    check('next up: overdue from the date', html.includes('Overdue · 4 days') && html.includes('1 overdue'));
    check('next up: "overdue" status but future date is not overdue', !/Event step[\s\S]{0,400}Overdue/.test(html));
    check('next up: today label', html.includes('>Today<'));
    check('next up: meeting source opens the row', html.includes("app.pvOpenMeeting('prospect', 55, 'mu-11')") && html.includes('from FTF'));
    check('next up: event source opens the attendee row', html.includes("'mu-att9'"));
    check('next up: deal source opens the deal', html.includes('app.pvOpenDeal(31)'));
    check('next up: hand-added label', html.includes('added by hand'));
    check('next up: other agent named, me not', html.includes('Agent Wong') && !html.includes('Agent Oo'));
    check('next up: title escaped', html.includes('Late &lt;img src=x&gt;') && !html.includes('<img src=x>'));
    check('next up: recent done folded, ancient dropped', html.includes('Show 1 done') && !html.includes('Ancient'));
    check('next up: done / reschedule handlers', html.includes('app.pvTaskToggle(1, this.checked') && html.includes('app.pvTaskReschedule(1,'));

    // task line inside the timeline row
    const maps = await app.pvTaskMaps('prospect', PID, PID);
    const line = app.pvTaskLineHtml({ id: 11, next_action: '九星课 | Remarks: call his wife' }, maps);
    check('task line: meeting words, not the Remarks syntax', line.includes('九星课 — call his wife') && !line.includes('Remarks:'));
    check('task line: shows the task state', line.includes('due ') && line.includes('is-danger'));
    const doneLine = app.pvTaskLineHtml({ id: 10, next_action: 'old step' }, maps);
    check('task line: done task', doneLine.includes('is-done') && doneLine.includes('>done<'));
    const hist = app.pvTaskLineHtml({ id: 999, next_action: 'Long ago' }, maps);
    check('task line: no task → history words only', hist.includes('Long ago') && !hist.includes('mu-task'));
    check('task line: attendee row by attendee id', app.pvTaskLineHtml({ id: 'att9', _isAttendeeNote: true, _attendeeRowId: 9, next_action: 'Book FSA' }, maps).includes('mu-task'));
    check('task line: nothing when no next action', app.pvTaskLineHtml({ id: 11 }, maps), '');
  }

  // ═══ Opportunities ═════════════════════════════════════════════════════════
  {
    TASKS = [{ id: 7, prospect_id: PID, title: 'Send quotation', due_date: iso(-1), status: 'pending', source_kind: 'deal', source_deal_id: 31 }];
    const { dom, app } = makeSandbox();
    const body = dom.el('acc-body-potential-55');
    await app.renderProfileOpportunities('prospect', PID, PID, body);
    const html = body.innerHTML;
    check('opps: total + CPS rating', html.includes('RM 20,870') && html.includes('CPS: Warm'));
    check('opps: unpriced item says price?', html.includes('price?'));
    check('opps: open deals listed, closed folded', html.includes('Power Ring PR3') && html.includes('Course') && html.includes('Show 1 closed'));
    check('opps: deal next step shows its task (overdue)', /Send quotation[\s\S]{0,120}is-danger[\s\S]{0,40}task due/.test(html));
    check('opps: auto draft says confirm', html.includes('draft — open to confirm'));
    check('opps: past close date flagged', /is-danger">close by/.test(html));
    check('opps: + Deal for this prospect', html.includes('app.pvNewDeal(55)'));
    check('opps: newest need wins', html.includes('Newest need') && !html.includes('Old need'));
    check('opps: older value used when newest is empty (escaped)', html.includes('Old pain &lt;script&gt;'));
    check('opps: reaction from minutes', html.includes('Keen'));
    for (const gone of ['Close Prob', 'Est. Value', 'Budget', 'Decision Maker', 'Next Steps to Close', 'Deal Analysis']) {
      check(`opps: retired "${gone}" gone`, !html.includes(gone));
    }
    const none = dom.el('x');
    await app.renderProfileOpportunities('customer', CID, null, none);
    check('opps: customer without a prospect record', none.innerHTML.includes('No opportunities are tracked'));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
