// ci/test-improvements-sim.js — behavioural smoke test for the 改命后的进步
// (customer improvement log) feature in chunks/script-customers.js.
//
// Loads the REAL chunk in a vm sandbox with stubbed window/_crmUtils/AppDataStore/
// UI/document, then exercises render, permission gating, XSS escaping, modal
// build, save validation, story mode ordering and delete. Run: node ci/test-improvements-sim.js
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
    children: [], display: '',
    appendChild(c) { this.children.push(c); },
    insertAdjacentHTML() {},
    remove() { this._removed = true; const k = this._id || id; if (k) elements.delete(k); },
  };
  if (id) elements.set(id, el);
  return el;
}
const documentStub = {
  getElementById: (id) => elements.get(id) || null,
  createElement: () => {
    const el = makeEl(null);
    Object.defineProperty(el, 'id', { get() { return this._id; }, set(v) { this._id = v; elements.set(v, this); } });
    return el;
  },
  body: makeEl('__body__'),
  querySelectorAll: () => [],
  addEventListener: () => {},
};

// ─── fixtures ───────────────────────────────────────────────────────────────
const CUSTOMER = { id: 77, full_name: '陈大文', responsible_agent_id: 501, country: 'MY' };
const ROWS = [
  { id: 2, customer_id: 77, improve_date: '2022-11-02', solution: '个人改命', story: '升职为经理，失眠问题解决' },
  { id: 3, customer_id: 77, improve_date: '2026-08-10', solution: 'PR4 Power Ring', story: '生意收入增加40%' },
  { id: 4, customer_id: 77, improve_date: '2025-03-18', solution: null, story: '<img src=x onerror=alert(1)>购入新房' },
];
const PURCHASES = [
  { id: 1, customer_id: 77, item: 'PR4 Power Ring' },
  { id: 2, customer_id: 77, item: 'PR4 Power Ring' },   // duplicate — must dedup
  { id: 3, customer_id: 77, item: ' Home Audit ' },      // needs trim
  { id: 4, customer_id: 77, item: '' },                  // blank — must drop
];

const calls = { create: [], update: [], delete: [], toastErr: [], toastOk: [], modals: [], confirms: [] };
let queryRows = ROWS;

// ─── app-layer stubs ────────────────────────────────────────────────────────
const AppDataStore = {
  async getById(table, id) {
    if (table === 'customers') return String(id) === '77' ? CUSTOMER : null;
    if (table === 'customer_improvements') return queryRows.find(r => String(r.id) === String(id)) || null;
    return null;
  },
  async query(table, filters) {
    if (table === 'customer_improvements') return queryRows.slice();
    if (table === 'purchases') return PURCHASES.slice();
    return [];
  },
  async getAll() { return []; },
  async create(table, rec) { calls.create.push({ table, rec }); return { ...rec, id: 999 }; },
  async update(table, id, patch) { calls.update.push({ table, id, patch }); return {}; },
  async delete(table, id) { calls.delete.push({ table, id }); return {}; },
  getJourneyTouchpoints: async () => [],
};
const UI = {
  showModal: (title, content, buttons) => calls.modals.push({ title, content, buttons }),
  hideModal: () => {},
  confirm: (title, msg, cb) => { calls.confirms.push(title); return cb(); },
  toast: { success: (m) => calls.toastOk.push(m), error: (m) => calls.toastErr.push(m) },
  money: (v) => `RM ${v}`,
  currencyForCountry: () => 'MYR',
  countryByCode: () => ({ symbol: 'RM' }),
  formatCurrency: (v) => `RM ${v}`,
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

const windowStub = {
  _appState: { cu: { id: 1, role: 'Level 1 Super Admin', full_name: 'Admin' }, cv: 'customers' },
  _crmUtils,
  app: null, // set below
  _loadChunk: async () => {},
  addEventListener: () => {},
  location: { reload: () => {} },
};
const appStub = {
  register(name, fns) { Object.assign(this, fns); },
  navigateTo: async () => {},
  SCORING_RULES: { CREATE_PROSPECT: 5 },
};
windowStub.app = appStub;

const sandbox = {
  window: windowStub, document: documentStub, AppDataStore, UI, app: appStub,
  console, setTimeout: (fn) => fn && undefined, clearTimeout: () => {},
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  navigator: { userAgent: 'node-sim' },
  URL, Blob: function () {}, FileReader: function () {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const src = fs.readFileSync(path.join(__dirname, '..', 'chunks', 'script-customers.js'), 'utf8');
vm.runInContext(src, sandbox, { filename: 'script-customers.js' });
const app = windowStub.app;

(async () => {
  // 1 — registration
  for (const fn of ['renderImprovementsTab', 'openImprovementModal', 'saveCustomerImprovement',
    'deleteCustomerImprovement', 'openImprovementStoryMode', 'closeImprovementStoryMode']) {
    check(`registered: ${fn}`, typeof app[fn], 'function');
  }

  // 2 — render as L1 admin: buttons + rows + newest-first + badge
  const body77 = makeEl('cust-acc-body-improvements-77');
  const badge77 = makeEl('cust-imp-badge-77');
  await app.renderImprovementsTab(CUSTOMER, body77);
  check('render: has 记录进步 button', body77.innerHTML.includes('记录进步'));
  check('render: has 回顾模式 button', body77.innerHTML.includes('回顾模式'));
  check('render: newest entry before oldest', body77.innerHTML.indexOf('2026-08-10') < body77.innerHTML.indexOf('2022-11-02'));
  check('render: XSS story is escaped', !body77.innerHTML.includes('<img'), true);
  check('render: escaped payload visible', body77.innerHTML.includes('&lt;img'));
  check('render: badge count set', badge77.textContent, 3);
  check('render: solution chip shown', body77.innerHTML.includes('PR4 Power Ring'));

  // 3 — render as unrelated L7 agent: read-only
  windowStub._appState.cu = { id: 888, role: 'Level 7 Consultant' };
  await app.renderImprovementsTab(CUSTOMER, body77);
  check('agent (not responsible): no add button', !body77.innerHTML.includes('记录进步'), true);
  check('agent (not responsible): no delete icon', !body77.innerHTML.includes('deleteCustomerImprovement'), true);
  check('agent (not responsible): still sees 回顾模式', body77.innerHTML.includes('回顾模式'));

  // 4 — render as the responsible agent (id 501, L7): can write
  windowStub._appState.cu = { id: 501, role: 'Level 7 Consultant' };
  await app.renderImprovementsTab(CUSTOMER, body77);
  check('responsible agent: has add button', body77.innerHTML.includes('记录进步'));
  check('responsible agent: has edit icon', body77.innerHTML.includes('openImprovementModal(77, 2)'));

  // 5 — modal build: purchases dedup + trim + Other option; denied for stranger
  calls.modals.length = 0;
  await app.openImprovementModal(77);
  check('modal opened for responsible agent', calls.modals.length, 1);
  const modal = calls.modals[0];
  check('modal: dedup purchases (one PR4 option)', (modal.content.match(/value="PR4 Power Ring"/g) || []).length, 1);
  check('modal: trimmed Home Audit option', modal.content.includes('value="Home Audit"'));
  check('modal: only the — Select — placeholder has an empty value', (modal.content.match(/<option value=""/g) || []).length, 1);
  check('modal: has Other escape hatch', modal.content.includes('value="Other"'));
  check('modal: save action string convention', modal.buttons[1].action.includes('app.saveCustomerImprovement(77, null)'));

  windowStub._appState.cu = { id: 888, role: 'Level 7 Consultant' };
  calls.modals.length = 0; calls.toastErr.length = 0;
  await app.openImprovementModal(77);
  check('modal denied for non-responsible agent', calls.modals.length, 0);
  check('denial toast shown', calls.toastErr.length, 1);

  // 6 — save validation + payload
  windowStub._appState.cu = { id: 501, role: 'Level 7 Consultant' };
  makeEl('imp-date').value = '2026-08-15';
  makeEl('imp-solution').value = 'PR4 Power Ring';
  makeEl('imp-solution-other').value = '';
  makeEl('imp-story').value = '  ';
  calls.toastErr.length = 0;
  await app.saveCustomerImprovement(77, null);
  check('save: blank story rejected', calls.toastErr.length, 1);
  check('save: nothing created on reject', calls.create.length, 0);

  elements.get('imp-story').value = '生意收入增加40%';
  await app.saveCustomerImprovement(77, null);
  check('save: create called', calls.create.length, 1);
  check('save: table', calls.create[0].table, 'customer_improvements');
  check('save: solution from select', calls.create[0].rec.solution, 'PR4 Power Ring');
  check('save: created_by stamped', calls.create[0].rec.created_by, 501);
  check('save: date passthrough', calls.create[0].rec.improve_date, '2026-08-15');

  // Other → free text wins
  elements.get('imp-solution').value = 'Other';
  elements.get('imp-solution-other').value = '风水布局';
  await app.saveCustomerImprovement(77, null);
  check('save: Other uses free text', calls.create[1].rec.solution, '风水布局');

  // edit path → update not create
  await app.saveCustomerImprovement(77, 2);
  check('save: edit calls update', calls.update.length, 1);
  check('save: update id', calls.update[0].id, 2);

  // 7 — story mode: overlay, oldest-first, year grouping, XSS
  documentStub.body.children.length = 0;
  await app.openImprovementStoryMode(77);
  const overlay = elements.get('imp-story-overlay');
  check('story: overlay appended', !!overlay && documentStub.body.children.includes(overlay));
  check('story: oldest before newest', overlay.innerHTML.indexOf('2022-11-02') < overlay.innerHTML.indexOf('2026-08-10'));
  check('story: year headers present', overlay.innerHTML.includes('>2022<') && overlay.innerHTML.includes('>2026<'));
  check('story: customer name in title', overlay.innerHTML.includes('陈大文'));
  check('story: XSS escaped in story mode', !overlay.innerHTML.includes('<img'), true);
  app.closeImprovementStoryMode();
  check('story: overlay removed on close', overlay._removed, true);

  // empty → toast, no overlay
  queryRows = [];
  calls.toastErr.length = 0;
  await app.openImprovementStoryMode(77);
  check('story: empty shows toast', calls.toastErr.length, 1);
  check('story: no overlay when empty', elements.get('imp-story-overlay') || null, null);
  queryRows = ROWS;

  // 8 — delete: confirm → delete → re-render
  calls.delete.length = 0;
  await app.deleteCustomerImprovement(77, 3);
  check('delete: confirm shown', calls.confirms.length, 1);
  check('delete: AppDataStore.delete called', calls.delete.length, 1);
  check('delete: right id', calls.delete[0].id, 3);

  // 9 — empty-state render
  queryRows = [];
  await app.renderImprovementsTab(CUSTOMER, body77);
  check('empty state message', body77.innerHTML.includes('还没有记录'));
  check('empty: no 回顾模式 button', !body77.innerHTML.includes('回顾模式'), true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
