// ci/test-journey-autopilot-sim.js — behavioural test for the Ring Journey
// autopilot surfaces in chunks/script-autopilot.js (the automation itself is
// SQL: migrations/2026-10-20_journey_autopilot.sql, scenario-tested by
// ci/sql/journey-autopilot-scenario.sql in a rolled-back transaction).
//
// Loads the REAL chunk in a vm sandbox with stubbed window / supabase / UI /
// document, then checks: top-5 RPC + cache, row rendering per kind (buttons,
// RM, escaping), empty / error states, level gate + mount anchor (desktop vs
// mobile), touchpoint Done, CPS next-step prompt (RPC args, follow-on action),
// event invite (dedupe + attendee shape), Golden Road line, funnel totals.
// Run: node ci/test-journey-autopilot-sim.js
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
const byId = new Map();
function makeEl(tag) {
  const el = {
    tag, innerHTML: '', dataset: {}, style: {}, className: '', _id: null, parentNode: null, inserted: [],
    get id() { return this._id; },
    set id(v) { this._id = v; byId.set(v, this); },
    insertBefore(node, ref) { node.parentNode = this; this.inserted.push({ node, before: ref }); },
    insertAdjacentElement(pos, node) { node.parentNode = this.parentNode; this.inserted.push({ node, pos }); if (node._id) byId.set(node._id, node); },
    remove() { this._removed = true; if (this._id) byId.delete(this._id); },
  };
  return el;
}
let qsAll = {};
let qsOne = {};
const documentStub = {
  getElementById: (id) => byId.get(id) || null,
  createElement: (t) => makeEl(t),
  querySelector: (sel) => qsOne[sel] || null,
  querySelectorAll: (sel) => qsAll[sel] || [],
  body: makeEl('body'),
};

// ─── supabase stub ──────────────────────────────────────────────────────────
const calls = [];
let rpcData = {};
let tableData = {};
function builder(table) {
  const q = { table, ops: [] };
  const chain = new Proxy({}, {
    get(_, k) {
      if (k === 'then') {
        calls.push(q);
        const res = { data: typeof tableData[table] === 'function' ? tableData[table](q) : (tableData[table] || []), error: null };
        return (ok) => Promise.resolve(res).then(ok);
      }
      if (k === 'maybeSingle') return () => { calls.push(q); const d = tableData[table]; return Promise.resolve({ data: Array.isArray(d) ? d[0] || null : d, error: null }); };
      return (...a) => { q.ops.push([k, ...a]); return chain; };
    },
  });
  return chain;
}
const supabase = {
  rpc: (fn, args) => { calls.push({ rpc: fn, args }); const d = rpcData[fn]; return Promise.resolve(d instanceof Error ? { data: null, error: d } : { data: typeof d === 'function' ? d(args) : d, error: null }); },
  from: (t) => builder(t),
};

// ─── window / app stubs ─────────────────────────────────────────────────────
const toasts = [];
const modals = [];
let hidden = 0;
const appCalls = [];
const created = [];
const win = {
  innerWidth: 1280,
  supabase,
  _appState: { cu: { id: 42, full_name: 'Agent Kim', role: 'Level 9 Agent' } },
  _crmUtils: {
    escapeHtml: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    getUserLevel: (u) => { const m = String(u && u.role || '').match(/Level\s*(\d+)/); return m ? Number(m[1]) : 99; },
  },
  app: {
    register(domain, m) { Object.assign(this, m); this._reg = domain; return this; },
    openActivityModal: (...a) => appCalls.push(['openActivityModal', ...a]),
    navigateTo: async (v) => appCalls.push(['navigateTo', v]),
    showProspectDetail: (id) => appCalls.push(['showProspectDetail', id]),
    showCustomerDetail: (id) => appCalls.push(['showCustomerDetail', id]),
  },
};
const UI = {
  toast: { success: (m) => toasts.push(['ok', m]), error: (m) => toasts.push(['err', m]), info: (m) => toasts.push(['info', m]) },
  showModal: (t, c, b) => modals.push({ t, c, b }),
  hideModal: () => { hidden++; },
};
const timers = [];
const sandbox = {
  window: win, document: documentStub, UI, console: { log() {}, warn() {}, error: console.error },
  AppDataStore: { create: async (t, row) => { created.push([t, row]); return { id: 1, ...row }; } },
  setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  clearTimeout: () => {},
  MutationObserver: function () { this.observe = () => {}; },
  Promise, Date, Math, JSON, String, Number, Array, Object, Map, Set, RegExp, Error,
};
win.document = documentStub;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'chunks', 'script-autopilot.js'), 'utf8'), sandbox);
const app = win.app;
const flush = () => new Promise(r => setImmediate(r));
const runTimers = async () => { while (timers.length) { const t = timers.shift(); await t.fn(); } await flush(); };

(async () => {
  check('registered under autopilot', app._reg, 'autopilot');
  for (const fn of ['apOpen', 'apTodo', 'apMountTop5', 'apRenderTop5', 'apFillGrLine', 'apTouchDone', 'apCpsNextStep', 'apCpsSet', 'apCpsInvite', 'apCpsInviteGo', 'apRenderFunnel']) {
    check('exports ' + fn, typeof app[fn], 'function');
  }
  timers.length = 0; // the boot scan

  // ── F · top 5 ────────────────────────────────────────────────────────────
  rpcData.journey_daily_todo = [
    { kind: 'collect', icon: '📦', prospect_id: 5, customer_id: 9, name: 'Ng <b>Jing</b>', why: 'Collect ring · ready since 15 Aug', rm: 21990, ref_id: 700 },
    { kind: 'cps', icon: '🆕', prospect_id: 11, customer_id: null, name: 'Tee', why: 'CPS 7 Oct · no 2nd meeting booked', rm: 5000, ref_id: null },
    { kind: 'touch', icon: '🧭', prospect_id: 12, customer_id: null, name: 'Wong', why: 'CPS跟进电话', rm: 3000, ref_id: 88 },
    { kind: 'gr', icon: '🟣', prospect_id: 13, customer_id: 14, name: 'Lim', why: 'Golden Road 2/6 · due 3 Nov', rm: 900, ref_id: 701 },
  ];
  const rows1 = await app.apTodo(true);
  check('todo rpc called with p_limit 5', JSON.stringify(calls.find(c => c.rpc === 'journey_daily_todo').args), '{"p_limit":5}');
  check('todo returns rows', rows1.length, 4);
  const n0 = calls.filter(c => c.rpc === 'journey_daily_todo').length;
  await app.apTodo();
  check('todo cached within 60s', calls.filter(c => c.rpc === 'journey_daily_todo').length, n0);

  // level gate: L1 admin never gets the card
  const wrapper = makeEl('div'); const parent = makeEl('div'); wrapper.parentNode = parent;
  qsOne['.calendar-monthly-wrapper'] = wrapper;
  win._appState.cu.role = 'Level 1 Super Admin';
  app.apMountTop5();
  check('L1 admin: no top-5 card', byId.has('ap-top5'), false);
  win._appState.cu.role = 'Level 9 Agent';
  app.apMountTop5();
  check('L9 agent: card mounted', byId.has('ap-top5'), true);
  check('desktop: inserted before the month grid', parent.inserted[0] && parent.inserted[0].before, wrapper);
  await flush(); await flush();
  const html = byId.get('ap-top5').innerHTML;
  check('header shows top 4', html.includes("Today's top 4"), true);
  check('name escaped', html.includes('Ng &lt;b&gt;Jing&lt;/b&gt;'), true);
  check('raw tag not injected', html.includes('<b>Jing'), false);
  check('RM shown in k', html.includes('RM22k'), true);
  check('collect → delivery items of that purchase', html.includes("app.openDeliveryItems('purchase', 700, 9)"), true);
  check('cps → book meeting for prospect', html.includes("app.openActivityModal('', 11)"), true);
  check('touch → done button with touchpoint id', html.includes('app.apTouchDone(88)'), true);
  check('customer row opens customer', html.includes("app.apOpen('customer', 9)"), true);
  check('prospect row opens prospect', html.includes("app.apOpen('prospect', 11)"), true);
  check('gr row has no action button', /Golden Road 2\/6[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/.test(html), true);
  app.apMountTop5();
  check('mount is idempotent', parent.inserted.length, 1);

  rpcData.journey_daily_todo = [];
  await app.apRenderTop5(true);
  check('empty → nothing urgent', byId.get('ap-top5').innerHTML.includes('Nothing urgent today'), true);
  rpcData.journey_daily_todo = new Error('boom');
  await app.apRenderTop5(true);
  check('error → could not load', byId.get('ap-top5').innerHTML.includes('Could not load'), true);

  // mobile anchor
  byId.delete('ap-top5');
  win.innerWidth = 400;
  const mbody = makeEl('div'); const mparent = makeEl('div'); mbody.parentNode = mparent; mbody.id = 'mhome-body';
  rpcData.journey_daily_todo = [];
  app.apMountTop5();
  check('mobile: inserted before #mhome-body', mparent.inserted[0] && mparent.inserted[0].before, mbody);
  win.innerWidth = 1280;

  // touch done
  calls.length = 0;
  await app.apTouchDone(88);
  const upd = calls.find(c => c.table === 'journey_touchpoints');
  check('done: updates journey_touchpoints', !!upd, true);
  check('done: status done', upd && upd.ops[0][0] === 'update' && upd.ops[0][1].status, 'done');
  check('done: completed_by viewer', upd && upd.ops[0][1].completed_by_id, 42);
  check('done: scoped to that id', JSON.stringify(upd && upd.ops[1]), '["eq","id",88]');

  // ── A · CPS next step ────────────────────────────────────────────────────
  modals.length = 0;
  qsOne['#global-modal-overlay.active'] = null;
  await app.apCpsNextStep(11, 'Tee <x>');
  const m = modals[0];
  check('prompt shown', !!m, true);
  check('prompt title has name', m && m.t, "What's next for Tee <x>?");
  check('prompt body escapes name', m && m.c.includes('Tee &lt;x&gt;'), true);
  check('4 choices', m && ['meeting', 'event', 'later', 'not_interested'].every(s => m.c.includes(`app.apCpsSet(11, '${s}')`)), true);
  check('closing = later', m && m.b[0].action, "app.apCpsSet(11, 'later')");

  calls.length = 0; appCalls.length = 0; timers.length = 0; hidden = 0;
  await app.apCpsSet(11, 'meeting');
  const sr = calls.find(c => c.rpc === 'set_cps_next_step');
  check('set step rpc args', JSON.stringify(sr && sr.args), '{"p_pid":11,"p_step":"meeting"}');
  check('modal hidden', hidden, 1);
  await runTimers();
  check('meeting → opens activity modal', JSON.stringify(appCalls.find(c => c[0] === 'openActivityModal')), '["openActivityModal","",11]');

  modals.length = 0; timers.length = 0;
  const today = new Date(); const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  tableData.activities = [
    { id: 501, activity_title: '九星运命', activity_date: ymd, start_time: '19:30:00', event_id: 61 },
    { id: 502, activity_title: '代理会议', activity_date: ymd, event_id: 62 },
  ];
  await app.apCpsSet(11, 'event');
  await runTimers();
  const inv = modals[modals.length - 1];
  check('event → invite list shown', inv && inv.t, 'Invite to which event?');
  check('event list has 九星', inv && inv.c.includes('app.apCpsInviteGo(11, 501, 61)'), true);
  check('agent meetings excluded', inv && inv.c.includes('代理会议'), false);
  const evq = calls.filter(c => c.table === 'activities').pop();
  check('only EVENT activities queried', JSON.stringify(evq.ops.find(o => o[0] === 'eq')), '["eq","activity_type","EVENT"]');

  await app.apCpsSet(11, 'not_interested');
  check('not interested → toast', toasts.some(t => t[1].includes('no more reminders')), true);

  // invite go: creates attendee once
  created.length = 0;
  tableData.event_attendees = [];
  tableData.prospects = [{ full_name: 'Tee Wei Hao' }];
  await app.apCpsInviteGo(11, 501, 61);
  check('attendee created', created.length, 1);
  const row = created[0] && created[0][1];
  check('attendee table', created[0] && created[0][0], 'event_attendees');
  check('attendee shape', row && [row.event_id, row.activity_id, row.entity_id, row.attendee_id, row.attendee_type, row.attendance_status, row.added_by_agent_id, row.entity_name].join('|'),
        '61|501|11|11|prospect|Registered|42|Tee Wei Hao');
  tableData.event_attendees = [{ id: 9 }];
  await app.apCpsInviteGo(11, 501, 61);
  check('duplicate invite not re-created', created.length, 1);

  // ── D · Golden Road line ─────────────────────────────────────────────────
  const slotParent = makeEl('div');
  const slot = makeEl('div'); slot.parentNode = slotParent; slot.dataset.fuPid = '55';
  qsAll['.ap-gr-line[data-gr-for="55"]'] = [];
  rpcData.journey_gr_status = [{ done: 2, total: 6, next_due: '2026-11-03', item: 'PR6 / BASE PRICE RM 12990', ready_date: '2026-12-15', collected: false }];
  await app.apFillGrLine(slot);
  const gl = slot.inserted[0] && slot.inserted[0].node;
  check('gr line inserted after the 🎯 slot', slot.inserted[0] && slot.inserted[0].pos, 'afterend');
  check('gr count', gl && gl.innerHTML.includes('Golden Road 2/6'), true);
  check('gr item trimmed + ready date', gl && gl.innerHTML.includes('PR6 ready ~15 Dec'), true);
  check('gr next session', gl && gl.innerHTML.includes('next GR 3 Nov'), true);
  rpcData.journey_gr_status = [{ done: 6, total: 6, next_due: null, item: 'PR6', ready_date: '2026-12-15', collected: true }];
  const slot2 = makeEl('div'); slot2.dataset.fuPid = '55';
  await app.apFillGrLine(slot2);
  check('collected state', slot2.inserted[0] && slot2.inserted[0].node.innerHTML.includes('✅ collected'), true);
  rpcData.journey_gr_status = [];
  const slot3 = makeEl('div'); slot3.dataset.fuPid = '56';
  await app.apFillGrLine(slot3);
  check('no Golden Road → no line', slot3.inserted.length, 0);

  // ── G · funnel ───────────────────────────────────────────────────────────
  const insights = makeEl('div'); insights.id = 'pl-insights-root';
  const fbox = makeEl('div'); fbox.id = 'pl-funnel-root';
  rpcData.journey_funnel = [
    { agent_id: 1, agent_name: 'Chen', cps: 8, met_again: 2, potential: 3, event: 1, signed: 1, collected: 0, gr6: 0, referral: 1 },
    { agent_id: 2, agent_name: 'Oo', cps: 2, met_again: 2, potential: 1, event: 1, signed: 1, collected: 1, gr6: 0, referral: 0 },
  ];
  calls.length = 0;
  await app.apRenderFunnel('m');
  const fr = calls.find(c => c.rpc === 'journey_funnel');
  check('funnel rpc from = 1st of month', fr && fr.args.p_from, ymd.slice(0, 8) + '01');
  check('funnel rpc to = today', fr && fr.args.p_to, ymd);
  const fh = fbox.innerHTML;
  check('funnel total CPS', fh.includes('<strong>10</strong> · 100%'), true);
  check('funnel met again 40% and -60% drop', fh.includes('<strong>4</strong> · 40% <span style="color:#B91C1C;">-60%</span>'), true);
  check('funnel per-agent table', fh.includes('>Chen<') && fh.includes('>Oo<'), true);
  check('period button active', fh.includes(`btn-sm primary" style="font-size:11px;padding:2px 8px;" onclick="app.apRenderFunnel('m')"`), true);
  rpcData.journey_funnel = [];
  await app.apRenderFunnel('y');
  check('no CPS → message', fbox.innerHTML.includes('No CPS in this period'), true);

  // ── 💳 POP collections ──────────────────────────────────────────────────
  for (const fn of ['openPopBoard', 'openPopPlan', 'popMark', 'popMarkAll', 'apFillPopLine']) check('exports ' + fn, typeof app[fn], 'function');
  const POPROWS = [
    { id: 901, purchase_id: 70, customer_id: 9, seq: 3, due_date: '2026-10-25', amount: 499, status: 'due', customers: { full_name: 'Tan <i>Ah</i> Kow' }, purchases: { item: 'PR6', payment_method: 'Visa 4111 1111 1111 1234 (POP)', epp_bank: 'UOB', installment_tenure: 36 } },
    { id: 902, purchase_id: 71, customer_id: 10, seq: 5, due_date: '2026-10-02', amount: 624.17, status: 'failed', customers: { full_name: 'Lim' }, purchases: { item: '上龙柄', payment_method: 'pre own 24 months', epp_months: 24 } },
    { id: 903, purchase_id: 72, customer_id: 11, seq: 1, due_date: '2026-10-05', amount: 399, status: 'paid', paid_date: '2026-10-05', customers: { full_name: 'Ng' }, purchases: { item: 'X' } },
  ];
  rpcData.pop_summary = [{ outstanding: 115165, plans: 15, due_month: 6000, due_month_n: 12, overdue: 624.17, overdue_n: 1, failed_n: 1, collected_month: 399, due_90: 19000 }];
  tableData.pop_installments = () => POPROWS;
  modals.length = 0; calls.length = 0;
  await app.openPopBoard('month');
  const pb = modals[modals.length - 1];
  check('board: title', pb && pb.t, '💳 POP collections');
  check('board: summary rpc', calls.some(c => c.rpc === 'pop_summary'), true);
  const pq = calls.find(c => c.table === 'pop_installments');
  check('board month: statuses due/failed/paid', JSON.stringify(pq.ops.find(o => o[0] === 'in')), '["in","status",["due","failed","paid"]]');
  check('board month: from 1st of month', JSON.stringify(pq.ops.find(o => o[0] === 'gte')), JSON.stringify(['gte', 'due_date', ymd.slice(0, 8) + '01']));
  check('board: outstanding tile', pb.c.includes('RM 115,165'), true);
  check('board: overdue tile red', pb.c.includes('color:#B91C1C;">RM 624'), true);
  check('board: name escaped', pb.c.includes('Tan &lt;i&gt;Ah&lt;/i&gt; Kow'), true);
  check('board: card number masked', pb.c.includes('4111') || pb.c.includes('1111 1111'), false);
  check('board: card last 4 kept', pb.c.includes('••••1234'), true);
  check('board: seq / tenure', pb.c.includes('3/36'), true);
  check('board: due row has Paid + Failed', pb.c.includes("app.popMark(901, 'paid')") && pb.c.includes("app.popMark(901, 'failed')"), true);
  check('board: failed row has Paid, no Failed', pb.c.includes("app.popMark(902, 'paid')") && !pb.c.includes("app.popMark(902, 'failed')"), true);
  check('board: paid row has Undo', pb.c.includes("app.popMark(903, 'due')"), true);
  check('board: bulk button counts open rows only', pb.c.includes('Mark 2 shown as paid'), true);
  check('board: row opens plan', pb.c.includes('app.openPopPlan(70)'), true);
  calls.length = 0;
  await app.openPopBoard('overdue');
  const oq = calls.find(c => c.table === 'pop_installments');
  check('board overdue: failed or past due', JSON.stringify(oq.ops.find(o => o[0] === 'or')), JSON.stringify(['or', `status.eq.failed,and(status.eq.due,due_date.lt.${ymd})`]));

  calls.length = 0; modals.length = 0;
  await app.popMark(901, 'paid');
  for (let k = 0; k < 6; k++) await flush();
  const mu = calls.find(c => c.table === 'pop_installments' && c.ops[0][0] === 'update');
  check('mark: update status only', JSON.stringify(mu && mu.ops[0][1]), '{"status":"paid"}');
  check('mark: scoped to id', JSON.stringify(mu && mu.ops[1]), '["eq","id",901]');
  check('mark: board re-opened', modals.length > 0 && modals[modals.length - 1].t, '💳 POP collections');

  win.confirm = () => false;
  calls.length = 0;
  await app.popMarkAll();
  check('bulk: cancelled → no update', calls.some(c => c.table === 'pop_installments' && c.ops[0] && c.ops[0][0] === 'update'), false);
  win.confirm = () => true;
  calls.length = 0;
  await app.popMarkAll();
  for (let k = 0; k < 6; k++) await flush();
  const bu = calls.find(c => c.table === 'pop_installments' && c.ops[0] && c.ops[0][0] === 'update');
  check('bulk: only open rows', JSON.stringify(bu && bu.ops[1]), '["in","id",[901,902]]');

  for (let k = 0; k < 6; k++) await flush();
  modals.length = 0;
  await app.openPopPlan(70);
  const pp = modals[modals.length - 1];
  check('plan: title', pp && pp.t, '💳 POP plan');
  check('plan: left = open rows', pp && pp.c.includes('RM 1,123'), true);
  check('plan: buttons keep plan view', pp && pp.c.includes("app.popMark(901, 'paid', { plan: 70 })"), true);
  check('plan: link back to board', pp && pp.b[0].action, 'app.openPopBoard()');

  // 💳 line
  rpcData.pop_person_plans = [
    { purchase_id: 70, item: 'PR6', total: 36, done: 14, left_rm: 10978, next_due: '2026-11-13', next_amount: 499, failed: 1 },
    { purchase_id: 73, item: 'Old', total: 24, done: 24, left_rm: 0, next_due: null, next_amount: null, failed: 0 },
  ];
  qsAll['.ap-pop-line[data-pop-for="55"]'] = [];
  const ps = makeEl('div'); ps.dataset.fuPid = '55';
  await app.apFillPopLine(ps);
  const pl = ps.inserted[0] && ps.inserted[0].node;
  check('pop line: inserted after slot', ps.inserted[0] && ps.inserted[0].pos, 'afterend');
  check('pop line: n/N', pl && pl.innerHTML.includes('💳 POP 14/36'), true);
  check('pop line: left', pl && pl.innerHTML.includes('RM 10,978 left'), true);
  check('pop line: next charge', pl && pl.innerHTML.includes('next RM499 13 Nov'), true);
  check('pop line: failed warning', pl && pl.innerHTML.includes('⚠ 1 failed'), true);
  check('pop line: finished plan hidden', pl && pl.innerHTML.includes('openPopPlan(73)'), false);
  rpcData.pop_person_plans = [{ purchase_id: 73, total: 24, done: 24, left_rm: 0, failed: 0 }];
  const ps2 = makeEl('div'); ps2.dataset.fuPid = '56';
  qsAll['.ap-pop-line[data-pop-for="56"]'] = [];
  await app.apFillPopLine(ps2);
  check('pop line: none when nothing left', ps2.inserted.length, 0);

  // to-do row of kind pop → plan button
  rpcData.journey_daily_todo = [{ kind: 'pop', icon: '💳', prospect_id: 5, customer_id: 9, name: 'Tan', why: 'POP 3/36 charge failed', rm: 10978, ref_id: 70 }];
  byId.delete('ap-top5');
  const w2 = makeEl('div'); const p2 = makeEl('div'); w2.parentNode = p2;
  qsOne['.calendar-monthly-wrapper'] = w2;
  app.apMountTop5();
  await app.apRenderTop5(true);
  check('todo pop → plan button', byId.get('ap-top5').innerHTML.includes('app.openPopPlan(70)'), true);

  console.log(`\njourney-autopilot sim: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
