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
  { id: 1, agent_id: 101, date: '2026-11-03', amount: 20000, item: 'Power Ring', customer_id: 9001 },
  { id: 2, agent_id: 101, date: '2026-10-30', amount: 50000, item: 'x' },              // other month
  { id: 3, agent_id: 101, date: '2026-11-10', amount: 9000, status: 'CANCELLED' },     // cancelled
  { id: 4, agent_id: 102, date: '2026-11-12', amount: 30000, item: '专案 Project Plan', prospect_id: 602, customer_id: 9003 },
  { id: 5, agent_id: 20,  date: '2026-11-15', amount: 10000, item: 'TIAN ZHI XI 1', customer_id: 9003 },    // leader's own, untagged
  { id: 8, agent_id: 101, date: '2026-03-15', amount: 40000, item: '六曜指环 Support Power Ring', customer_id: 9002 },  // YTD only
  { id: 6, agent_id: 103, date: '2026-11-15', amount: 5000, item: 'Book' },
  { id: 7, agent_id: 999, date: '2026-11-15', amount: 7000, item: 'Other team' },
];
const DEALS = [
  { id: 1, prospect_id: 501, agent_id: 101, product: 'PR6', amount: 20000, expected_close_date: '2026-11-20', stage: 'proposal', source: 'customer_referral', updated_at: new Date().toISOString() },
  { id: 2, prospect_id: 502, agent_id: 101, product: 'Audit', amount: 40000, expected_close_date: '2026-12-05', stage: 'closing' },   // next month
  { id: 3, prospect_id: 503, agent_id: 101, product: 'Old', amount: 10000, expected_close_date: '2026-10-01', stage: 'interested' }, // overdue → counts
  { id: 4, prospect_id: 504, agent_id: 101, product: 'Done', amount: 99000, expected_close_date: '2026-11-02', stage: 'won' },      // not open
  { id: 5, prospect_id: 505, agent_id: 102, product: 'X', amount: 10000, expected_close_date: '2026-11-30', stage: 'closing' },
  { id: 6, prospect_id: 506, agent_id: 102, product: 'Lost one', amount: 8000, expected_close_date: '2026-11-10', stage: 'lost', source: 'customer_referral', updated_at: '2026-11-11T03:00:00Z' },
  { id: 7, prospect_id: 507, agent_id: 101, product: '六曜指环 Support Power Ring', product_id: 5, amount: 20000, expected_close_date: '2026-11-05', stage: 'won', source: 'event', purchase_id: 1, won_at: '2026-11-03T05:00:00Z' },
];
let GOALS = [];
// Where-from / Which-product fixtures (sale source via the customer hop).
const CUSTOMERS = [
  { id: 9001, referred_by_type: null, converted_from_prospect_id: 601 },  // source via converted prospect
  { id: 9002, referred_by_type: 'Customer' },
  { id: 9003, referred_by_type: null },                                   // untagged
];
const LINK_PROSPECTS = [{ id: 601, referred_by_type: 'Consultant' }, { id: 602, referred_by_type: 'Prospect' }];
const CATALOG = [
  { id: 5, name: '六曜指环 Support Power Ring', subcategory: 'Power Ring' },
  { id: 6, name: '天至喜1 Tian Zhi Xi 1', subcategory: 'Calligraphy Adornment' },
  { id: 7, name: '专案-排屋 Terrace House (Direct On)', subcategory: 'Fengshui Audit · 专案 Direct On' },
  { id: 8, name: '灵活风水-公寓 Flexi Fengshui Condominium', subcategory: 'Fengshui Audit · 灵活 Flexi' },
];
const PROSPECTS = [{ id: 501, full_name: '<b>Evil</b> Tan', referred_by_type: 'Customer', referred_by: 'Mr Lim' }];

const calls = { inserts: [], toastErr: [], toastOk: [], custIn: [] };
function builder(table) {
  const q = { table, filters: [], _op: 'select', _row: null };
  const api = {
    select() { return api; }, order() { return api; }, limit() { return api; },
    eq(k, v) { q.filters.push([k, v]); return api; },
    in(k, vs) { q.inF = [k, vs.map(String)]; return api; },
    insert(row) { q._op = 'insert'; q._row = row; calls.inserts.push({ table, row }); return api; },
    update(row) { q._op = 'update'; q._row = row; return api; },
    upsert(rows) { q._op = 'upsert'; q._row = rows; return api; },
    delete() { q._op = 'delete'; return api; },
    maybeSingle() { return Promise.resolve({ data: q._op === 'select' ? null : { id: 777, ...q._row }, error: null }); },
    then(res, rej) {
      let data = [];
      if (table === 'pipeline_goals') data = GOALS.filter(g => q.filters.every(([k, v]) => String(g[k]) === String(v)));
      if (table === 'pipeline_deals') data = DEALS.slice();
      if (table === 'customers') { calls.custIn.push(q.inF[1].slice()); data = CUSTOMERS.filter(r => q.inF[1].includes(String(r.id))); }
      if (table === 'prospects') data = LINK_PROSPECTS.filter(r => q.inF[1].includes(String(r.id)));
      return Promise.resolve({ data, error: null }).then(res, rej);
    },
  };
  return api;
}
const supabaseStub = { from: (t) => builder(t) };

const AppDataStore = {
  async getAll(t) { if (t === 'users') return USERS; if (t === 'purchases') return PURCHASES; if (t === 'products') return CATALOG; return []; },
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

  // ── Where from / Which product ──
  check('product: exact catalogue name', app._plProductGroup('六曜指环 Support Power Ring', null, CATALOG), 'Power Ring');
  check('product: pinyin inside free text', app._plProductGroup('TIAN ZHI XI 1', null, CATALOG), 'Calligraphy Adornment');
  check('product: keyword 专案', app._plProductGroup('专案 Project Plan', null, CATALOG), 'Fengshui Audit · 专案 Direct On');
  check('product: keyword Pr 6 → Power Ring', app._plProductGroup('Pr 6', null, CATALOG), 'Power Ring');
  check('product: Flexi keyword', app._plProductGroup('Flexi Fengshui Double story', null, CATALOG), 'Fengshui Audit · 灵活 Flexi');
  check('product: product_id wins over text', app._plProductGroup('whatever', 6, CATALOG), 'Calligraphy Adornment');
  check('product: imports grouped', app._plProductGroup('Imported / pre-system balance', null, CATALOG), 'Imported balance');
  check('product: unknown → Other', app._plProductGroup('???', null, CATALOG), 'Other / not matched');

  as(20);  // leader: team tree 20/101/102/104
  c = await app._plLoadGoalCtx(USERS);
  const tsales = PURCHASES.filter(p => c.scopeIds.has(String(p.agent_id)) && !/cancel/i.test(p.status || ''));
  const links = await app._plLoadSaleLinks(tsales);
  check('links: customer hop loaded', links.cust.has('9001') && links.pros.has('601'));
  check('links: only in-scope customers fetched', calls.custIn.flat().sort().join(','), '9001,9002,9003');
  let src = app._plSourceStats(c, links, 'month', c.scopeIds);
  const bySrc = (k) => src.find(x => x.key === k) || {};
  check('source: deal-linked sale uses the deal source', bySrc('event').rm, 20000);
  check('source: no agent_referral when deal source wins', bySrc('agent_referral').rm === undefined);
  check('source: prospect_id referred_by_type beats untagged customer', bySrc('prospect_referral').rm, 30000);
  check('source: untagged sale → Not tagged', bySrc('unknown').rm, 10000);
  check('source: Not tagged sorted last', src[src.length - 1].key, 'unknown');
  check('source: lost deal counts in win rate', bySrc('customer_referral').lost, 1);
  check('source: win rate 0/1', bySrc('customer_referral').winRate, 0);
  check('source: event win rate 1/1', bySrc('event').winRate, 1);
  check('source: avg deal', bySrc('prospect_referral').avg, 30000);
  check('source: cancelled + other month excluded', src.reduce((s, x) => s + x.rm, 0), 60000);
  // without the deal link, the customer → converted prospect hop gives Consultant
  const noLink = { ...c, deals: c.deals.filter(d => d.id !== 7) };
  check('source: customer → converted prospect hop', (app._plSourceStats(noLink, links, 'month', c.scopeIds).find(x => x.key === 'agent_referral') || {}).rm, 20000);
  src = app._plSourceStats(c, links, 'ytd', c.scopeIds);
  check('source YTD adds March customer referral', (src.find(x => x.key === 'customer_referral') || {}).rm, 40000);
  check('source YTD: Oct sale (no customer) joins Not tagged', (src.find(x => x.key === 'unknown') || {}).rm, 60000);

  const prod = app._plProductStats(c, CATALOG, 'month', c.scopeIds);
  const byP = (k) => prod.find(x => x.key === k) || {};
  check('product won: Power Ring via linked deal product_id', byP('Power Ring').rm, 20000);
  check('product won: 专案', byP('Fengshui Audit · 专案 Direct On').rm, 30000);
  check('product won: calligraphy (leader own)', byP('Calligraphy Adornment').rm, 10000);
  check('product open: PR6 deal text → Power Ring', byP('Power Ring').open, 20000);
  check('product weighted: PR6 at proposal 50%', byP('Power Ring').weighted, 10000);
  check('product open: unmatched deals grouped', byP('Other / not matched').openN, 2);
  check('product weighted: Old 20% + X 80%', byP('Other / not matched').weighted, 10000 * 0.2 + 10000 * 0.8);

  src = app._plSourceStats(c, links, 'month', new Set(['102']));
  check('member filter restricts sales', src.reduce((s, x) => s + x.rm, 0), 30000);

  app._plSetInsightPeriodForTest('month');
  let ih = app._plInsightsHtml(c, links, CATALOG);
  check('insights html has both cards', ih.includes('id="pl-where-from"') && ih.includes('id="pl-which-product"'));
  check('insights html warns untagged RM', ih.includes('has no source'));
  check('insights html win rate 0/1', ih.includes('0% <span class="plg-muted">0/1</span>'));
  app._plSetInsightPeriodForTest('ytd');
  ih = app._plInsightsHtml(c, links, CATALOG);
  check('insights ytd label', ih.includes('Jan–Nov 2026'));
  app._plSetInsightPeriodForTest('month');

  as(101);
  c = await app._plLoadGoalCtx(USERS);
  src = app._plSourceStats(c, links, 'month', c.scopeIds);
  check('agent scope: only own sale', src.reduce((s, x) => s + x.rm, 0), 20000);

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

  // ── v8.2 auto-draft deals ──
  as(20); visibleIds = [20, 101, 102, 104];
  await app._plLoadGoalCtx(USERS);
  CATALOG.push({ id: 90, name: 'PR6', subcategory: 'Power Ring', price: 18990 }, { id: 91, name: 'PR8', subcategory: 'Power Ring', price: 24990 }, { id: 92, name: 'PR4', subcategory: 'Power Ring', price: 12990 });
  const mk = (id, agent, prob, extra) => ({ id, full_name: 'P' + id, responsible_agent_id: agent, referred_by_type: 'Customer', referred_by: 'Ref', _pipeline: { probability: prob, category: 'powerring', stage: null, action: '<b>Book</b> meeting', ...(extra || {}) } });
  app._plSetLastEnrichedForTest([
    mk(601, 101, 85),                              // eligible, hot → this month
    mk(602, 102, 65),                              // eligible, warm → next month
    mk(603, 101, 55),                              // below 60 → skip
    mk(604, 101, 90, { noProductSignal: true }),   // no product signal → skip
    mk(605, 999, 90),                              // owner not visible → skip
    mk(501, 101, 90),                              // already has open deal (DEALS prospect 501) → skip
    mk(606, 101, 90, { fromPotential: true }),     // declared only → skip
    mk(607, 102, 95, { stage: 'closing' }),        // stage carried over
  ]);
  calls.inserts.length = 0;
  app._plResetAutoDraftForTest();
  const nAdded = await app._plAutoDraftDeals();
  const autoRows = calls.inserts.filter(i => i.table === 'pipeline_deals').map(i => i.row);
  check('auto-draft count', nAdded, 3);
  check('auto-draft prospects', autoRows.map(r => r.prospect_id).join(','), '601,602,607');
  check('auto-draft flagged', autoRows.every(r => r.auto_created === true && r.created_by === null), true);
  check('auto-draft owner = prospect agent', autoRows[1] && autoRows[1].agent_id, 102);
  check('auto-draft amount = catalogue median', autoRows[0] && autoRows[0].amount, 18990);
  const thisEnd = (() => { const d = new Date(); const e = new Date(d.getFullYear(), d.getMonth() + 1, 0); return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`; })();
  check('hot deal closes this month', autoRows[0] && autoRows[0].expected_close_date, thisEnd);
  check('warm deal closes later', autoRows[1] && autoRows[1].expected_close_date > thisEnd, true);
  check('stage carried from engine', autoRows[2] && autoRows[2].stage, 'closing');
  check('source auto-filled', autoRows[0] && autoRows[0].source, 'customer_referral');
  check('next step html stripped', autoRows[0] && autoRows[0].next_step, 'Book meeting');
  calls.inserts.length = 0;
  const again = await app._plAutoDraftDeals();
  check('auto-draft throttled on immediate rerun', again, 0);
  CATALOG.splice(CATALOG.length - 3, 3);

  // ── v8.2 payment category never leaks card numbers ──
  check('card number + 31m → EPP (no digits shown)', app._plPayCategory('CIMB Master CC 5521-1540-0842-5476, 31m'), 'EPP');
  check('credit card → Card', app._plPayCategory('Credit Card'), 'Card');
  check('POP', app._plPayCategory('POP'), 'POP');
  check('cash', app._plPayCategory('Cash'), 'Cash');
  check('transfer', app._plPayCategory('Offline Bank Transfer/ CC Machine'), 'Transfer');
  check('NPO', app._plPayCategory('NPO'), 'NPO installment');
  check('empty', app._plPayCategory(null), '');

  console.log(`pipeline-goals-sim: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
