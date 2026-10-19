// ci/test-pipeline-goals-sim.js — behavioural test for Pipeline v8 (Goal Bar +
// Deals) in chunks/script-pipeline.js. Loads the REAL chunk in a vm sandbox with
// stubbed window/_crmUtils/AppDataStore/UI/supabase and checks goal resolution,
// won/pipeline/coverage math, team trees, escaping and saveDeal validation.
// Run: node ci/test-pipeline-goals-sim.js
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

const USERS = [
  { id: 1, role: 'Level 1 Super Admin', full_name: 'Admin' },
  { id: 10, role: 'Level 4 Managers', full_name: 'Mgr Teh' },
  { id: 20, role: 'Level 5 Team Leader', full_name: 'TL Oo', reporting_to: 10 },  // nested leader
  { id: 30, role: 'Level 5 Team Leader', full_name: 'TL Solo' },                   // top-level, no team
  { id: 101, role: 'Level 9 Consultant', full_name: 'Agent A', reporting_to: 20 },
  { id: 102, role: 'Level 9 Consultant', full_name: 'Agent B', reporting_to: 20 },
  { id: 103, role: 'Level 7 Consultant', full_name: 'Agent C', reporting_to: 10 },
  { id: 104, role: 'Level 9 Consultant', full_name: 'Gone', reporting_to: 20, status: 'inactive' },
];
const PURCHASES = [
  { id: 1, agent_id: 101, date: '2026-11-03', amount: 20000, item: 'Power Ring' },
  { id: 2, agent_id: 101, date: '2026-10-30', amount: 50000, item: 'x' },              // other month
  { id: 3, agent_id: 101, date: '2026-11-10', amount: 9000, status: 'CANCELLED' },     // cancelled
  { id: 4, agent_id: 102, date: '2026-11-12', amount: 30000, item: 'Fengshui' },
  { id: 5, agent_id: 20,  date: '2026-11-15', amount: 10000, item: 'Calligraphy' },    // leader's own
  { id: 6, agent_id: 103, date: '2026-11-15', amount: 5000, item: 'Book' },
  { id: 7, agent_id: 999, date: '2026-11-15', amount: 7000, item: 'Other team' },
];
const DEALS = [
  { id: 1, prospect_id: 501, agent_id: 101, product: 'PR6', amount: 20000, expected_close_date: '2026-11-20', stage: 'proposal', source: 'customer_referral', updated_at: new Date().toISOString() },
  { id: 2, prospect_id: 502, agent_id: 101, product: 'Audit', amount: 40000, expected_close_date: '2026-12-05', stage: 'closing' },   // next month
  { id: 3, prospect_id: 503, agent_id: 101, product: 'Old', amount: 10000, expected_close_date: '2026-10-01', stage: 'interested' }, // overdue → counts
  { id: 4, prospect_id: 504, agent_id: 101, product: 'Done', amount: 99000, expected_close_date: '2026-11-02', stage: 'won' },      // not open
  { id: 5, prospect_id: 505, agent_id: 102, product: 'X', amount: 10000, expected_close_date: '2026-11-30', stage: 'closing' },
];
let GOALS = [];
const PROSPECTS = [{ id: 501, full_name: '<b>Evil</b> Tan', referred_by_type: 'Customer', referred_by: 'Mr Lim' }];

const calls = { inserts: [], toastErr: [], toastOk: [] };
function builder(table) {
  const q = { table, filters: [], _op: 'select', _row: null };
  const api = {
    select() { return api; }, order() { return api; }, limit() { return api; },
    eq(k, v) { q.filters.push([k, v]); return api; },
    insert(row) { q._op = 'insert'; q._row = row; calls.inserts.push({ table, row }); return api; },
    update(row) { q._op = 'update'; q._row = row; return api; },
    upsert(rows) { q._op = 'upsert'; q._row = rows; return api; },
    delete() { q._op = 'delete'; return api; },
    maybeSingle() { return Promise.resolve({ data: q._op === 'select' ? null : { id: 777, ...q._row }, error: null }); },
    then(res, rej) {
      let data = [];
      if (table === 'pipeline_goals') data = GOALS.filter(g => q.filters.every(([k, v]) => String(g[k]) === String(v)));
      if (table === 'pipeline_deals') data = DEALS.slice();
      return Promise.resolve({ data, error: null }).then(res, rej);
    },
  };
  return api;
}
const supabaseStub = { from: (t) => builder(t) };

const AppDataStore = {
  async getAll(t) { if (t === 'users') return USERS; if (t === 'purchases') return PURCHASES; return []; },
  async getById(t, id) { return t === 'prospects' ? PROSPECTS.find(p => String(p.id) === String(id)) || null : null; },
  async query() { return []; },
  async searchProspects() { return PROSPECTS; },
};
const UI = {
  showModal: () => {}, hideModal: () => {},
  toast: { success: (m) => calls.toastOk.push(m), error: (m) => calls.toastErr.push(m) },
};
const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const levelOf = (u) => { const m = /Level\s+(\d+)/i.exec(u?.role || ''); return m ? parseInt(m[1], 10) : 99; };
let visibleIds = [];
const _crmUtils = new Proxy({
  escapeHtml, getUserLevel: levelOf,
  isSystemAdmin: (u) => levelOf(u) === 1, isTeamLeaderOrAbove: (u) => levelOf(u) <= 5,
  isAgent: (u) => levelOf(u) >= 3 && levelOf(u) <= 12, isAgentOrLeader: () => true,
  getVisibleProspects: async () => PROSPECTS, getVisibleActivities: async () => [],
  getVisibleUserIds: async () => visibleIds,
}, { get: (t, k) => (k in t ? t[k] : () => undefined) });

const elements = new Map();
const windowStub = { _appState: { cu: USERS[0] }, _crmUtils, supabase: supabaseStub, addEventListener: () => {} };
const appStub = { register(name, fns) { Object.assign(this, fns); }, navigateTo: async () => {} };
windowStub.app = appStub;
const documentStub = {
  getElementById: (id) => elements.get(id) || null,
  createElement: () => ({}), head: { appendChild() {} }, querySelectorAll: () => [],
};
const sandbox = {
  window: windowStub, document: documentStub, AppDataStore, UI, app: appStub, console,
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  navigator: { userAgent: 'node-sim' },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'chunks', 'script-pipeline.js'), 'utf8'), sandbox, { filename: 'script-pipeline.js' });
const app = windowStub.app;
const as = (id) => { windowStub._appState.cu = USERS.find(u => u.id === id); };

(async () => {
  app._plSetGoalMonthForTest('2026-11');

  // ── Agent: personal RM100k default ──
  as(101);
  let c = await app._plLoadGoalCtx(USERS);
  check('agent mode', c.mode, 'personal');
  check('agent default goal', c.goal, 100000);
  check('agent won only own + month + not cancelled', c.won.rm, 20000);
  check('agent open deals: proposal + overdue interested (not next month, not won)', c.pipe.n, 2);
  check('agent open RM', c.pipe.open, 30000);
  check('agent weighted = 20000×50% + 10000×20%', c.pipe.weighted, 12000);
  check('agent gap', c.gap, 80000);
  check('agent cannot edit goals', c.canEditGoals, false);
  let html = app._plGoalBarHtml(c);
  check('goal bar shows coverage 0.4×', html.includes('0.4×'));
  check('goal bar warns thin pipeline', html.includes('Pipeline too thin'));

  // custom goal row overrides default
  GOALS = [{ user_id: 101, month: '2026-11', scope: 'personal', target_amount: 150000 }];
  c = await app._plLoadGoalCtx(USERS);
  check('custom personal goal', c.goal, 150000);
  GOALS = [];

  // ── Leader L5 with 2 active agents: team RM500k ──
  as(20);
  c = await app._plLoadGoalCtx(USERS);
  check('leader mode', c.mode, 'team');
  check('leader team goal default', c.goal, 500000);
  check('leader won = A 20k + B 30k + own 10k', c.won.rm, 60000);
  check('leader members exclude inactive', c.members.length, 3);
  check('leader unassigned = 500k - 2×100k', c.unassigned, 300000);
  check('leader own row has no personal goal', c.members.find(m => m.self).goal, null);
  check('agent B pipeline counted', c.members.find(m => m.user.id === 102).pipe.open, 10000);
  check('leader team pipeline', c.pipe.open, 40000);

  // ── Manager L4: tree includes nested leader's agents ──
  as(10);
  c = await app._plLoadGoalCtx(USERS);
  check('manager won covers whole tree', c.won.rm, 65000);

  // ── Admin: company goal = top-level leaders only (Teh + Solo) ──
  as(1);
  c = await app._plLoadGoalCtx(USERS);
  check('admin mode', c.mode, 'company');
  check('admin goal excludes nested leader', c.goal, 1000000);
  check('admin won = all agents', c.won.rm, 72000);
  check('admin team rows = 3 leaders', c.members.length, 3);
  check('nested leader flagged', c.members.find(m => m.user.id === 20).nested, true);

  // ── Deals board escapes names ──
  as(101);
  c = await app._plLoadGoalCtx(USERS);
  const board = await app._plDealsBoardHtml(c);
  check('board escapes prospect name', board.includes('&lt;b&gt;Evil&lt;/b&gt; Tan') && !board.includes('<b>Evil</b>'));
  check('board hides next-month deal in month view', !board.includes('Audit'));
  check('board shows overdue chip', board.includes('overdue'));

  // ── Auto source ──
  check('customer referral source', app._plAutoSource(PROSPECTS[0]).source, 'customer_referral');
  check('converted → repeat', app._plAutoSource({ status: 'converted' }).source, 'repeat_customer');
  check('consultant → agent referral', app._plAutoSource({ referred_by_type: 'Consultant' }).source, 'agent_referral');

  // ── saveDeal validation + owner resolution ──
  const vals = {};
  elements.clear();
  const setVal = (id, v) => { vals[id] = v; elements.set(id, { value: v, options: [{ dataset: { pid: '5' } }], selectedIndex: 0 }); };
  await app.plDealPickProspect(501);   // prospect has no responsible agent → owner = me
  setVal('pld-product', 'PR6'); setVal('pld-amount', '20000'); setVal('pld-close', '2026-11-28');
  setVal('pld-stage', 'interested'); setVal('pld-next', 'Send quote'); setVal('pld-source', '');
  await app.saveDeal(null);
  check('missing source blocked', calls.toastErr.pop(), 'Pick where this deal came from.');
  check('no insert on validation fail', calls.inserts.length, 0);
  setVal('pld-source', 'event');
  await app.saveDeal(null);
  check('insert happened', calls.inserts.length, 1);
  const ins = calls.inserts[0] && calls.inserts[0].row;
  check('insert owner = me when prospect has no agent', ins && ins.agent_id, 101);
  check('insert created_by = me', ins && ins.created_by, 101);
  check('insert amount numeric', ins && ins.amount, 20000);
  check('success toast', calls.toastOk.pop(), 'Deal added');

  console.log(`pipeline-goals-sim: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
