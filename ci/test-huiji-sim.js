// ci/test-huiji-sim.js — behavioural smoke test for the 汇集 event briefing
// (house owner + verified purchased solutions) in chunks/script-activities.js.
//
// Loads the REAL chunk in a vm sandbox with stubbed window/_crmUtils/
// AppDataStore/UI/document (pattern: ci/test-improvements-sim.js), then
// exercises the category matcher (both 汇聚/汇集 spellings), the purchase +
// conversion-sale merge, snapshot shape (price-free), owner-required guard,
// widget flow, and create/update/read-only save paths.
// Run: node ci/test-huiji-sim.js
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
let qsMap = {}; // selector → array returned by querySelectorAll
function makeEl(id) {
  const el = {
    id, innerHTML: '', value: '', textContent: '', dataset: {}, style: {},
    children: [], display: '', className: '',
    appendChild(c) { this.children.push(c); },
    insertAdjacentHTML() {},
    addEventListener() {},
    querySelector() { return null; },
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
  querySelectorAll: (sel) => qsMap[sel] || [],
  querySelector: () => null,
  addEventListener: () => {},
};

// ─── fixtures ───────────────────────────────────────────────────────────────
const CUSTOMER = { id: 77, full_name: '陈大文', phone: '0123456789', country: 'MY', converted_from_prospect_id: 55 };
const PROSPECT_55 = { id: 55, full_name: '陈大文', closing_record: { product: '风水改命方案', closing_date: '2025-01-05', sale_amount: 88888, invoice_number: 'INV-1' } };
const PURCHASES = [
  { id: 1, customer_id: 77, item: 'PR4 Power Ring', date: '2025-06-01', amount: 12000, status: 'PAID' },
  { id: 2, customer_id: 77, item: 'PR4 Power Ring', date: '2025-06-01', amount: 12000, status: 'PAID' }, // dup — must dedupe
  { id: 3, customer_id: 77, item: ' 财库画 ', date: '2026-02-14', amount: 8800, status: 'PENDING' },     // trim + pending marker
  { id: 4, customer_id: 77, item: '', date: '2026-03-01', amount: 100, status: 'PAID' },                  // blank — must drop
];

const calls = { create: [], update: [], delete: [], toastErr: [], toastOk: [], modals: [] };

// ─── app-layer stubs ────────────────────────────────────────────────────────
const AppDataStore = {
  async getById(table, id) {
    if (table === 'customers') return String(id) === '77' ? CUSTOMER : null;
    if (table === 'prospects') return String(id) === '55' ? PROSPECT_55 : null;
    return null;
  },
  async query(table, filters) {
    if (table === 'purchases') return PURCHASES.slice();
    if (table === 'event_huiji_details') return [];
    if (table === 'customer_improvements') return [];
    return [];
  },
  async queryAdvanced() { return { data: [], count: 0 }; },
  async getAll() { return []; },
  async searchCustomers(term) { return [CUSTOMER]; },
  async searchProspects() { return []; },
  async create(table, rec) { calls.create.push({ table, rec }); return { ...rec, id: 999 }; },
  async update(table, id, patch) { calls.update.push({ table, id, patch }); return {}; },
  async delete(table, id) { calls.delete.push({ table, id }); return {}; },
  invalidateCache() {},
  getJourneyTouchpoints: async () => [],
};
const UI = {
  showModal: (title, content, buttons) => calls.modals.push({ title, content, buttons }),
  hideModal: () => {},
  confirm: (title, msg, cb) => cb && cb(),
  toast: { success: (m) => calls.toastOk.push(m), error: (m) => calls.toastErr.push(m) },
  money: (v) => `RM ${v}`,
  currencyForCountry: () => 'MYR',
  countryByCode: () => ({ symbol: 'RM', code: 'MY' }),
  formatCurrency: (v) => `RM ${v}`,
  countries: [{ code: 'MY', name: 'Malaysia', symbol: 'RM' }],
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
  cuHomeCountry: () => 'MY',
  USER_ROLES: [],
}, { get: (t, k) => (k in t ? t[k] : () => undefined) });

const windowStub = {
  _appState: { cu: { id: 1, role: 'Level 1 Super Admin', full_name: 'Admin' }, cv: 'calendar', sca: [] },
  _crmUtils,
  app: null,
  _loadChunk: async () => {},
  _loadChunkOnce: async () => {},
  addEventListener: () => {},
  location: { reload: () => {}, hostname: 'localhost' },
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
  URL, Blob: function () {}, FileReader: function () {}, FormData: function () {},
  fetch: async () => ({ ok: false, json: async () => ({}) }),
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const src = fs.readFileSync(path.join(__dirname, '..', 'chunks', 'script-activities.js'), 'utf8');
vm.runInContext(src, sandbox, { filename: 'script-activities.js' });
const app = windowStub.app;
const _state = windowStub._appState;

(async () => {
  // 1 — registration
  for (const fn of ['huijiIsHuijiCats', 'huijiIsHuijiEvent', 'huijiMergeSolutionSources',
    'huijiNormalizeSolutions', 'huijiInitSection', 'huijiToggleSection', 'huijiSearchOwner',
    'huijiSelectOwner', 'huijiClearOwner', 'huijiAddManualRow', 'huijiCollectSolutions',
    'huijiValidateBeforeSave', 'huijiSaveForEvent', 'huijiFillBriefing']) {
    check(`registered: ${fn}`, typeof app[fn], 'function');
  }

  // 2 — category matcher (both spellings + Others custom + negatives)
  check('matcher: 汇聚-专案', app.huijiIsHuijiCats(['汇聚-专案']));
  check('matcher: 汇集-商业', app.huijiIsHuijiCats(['汇集-商业']));
  check('matcher: 汇集-灵活', app.huijiIsHuijiCats(['汇集-灵活']));
  check('matcher: 汇集-简易', app.huijiIsHuijiCats(['汇集-简易']));
  check('matcher: custom Others 汇集-新品', app.huijiIsHuijiCats(['个人风水基础课', '汇集-新品']));
  // Property-type matrix (owner 2026-08-15): residential tracks × Condo/
  // Terrace/Semi-D/Bungalow, 商业 × Retail/Factory/Shoplot/Office.
  const HJ_MATRIX = {
    '专案': ['Condo', 'Terrace', 'Semi-D', 'Bungalow'],
    '商业': ['Retail', 'Factory', 'Shoplot', 'Office'],
    '灵活': ['Condo', 'Terrace', 'Semi-D', 'Bungalow'],
    '简易': ['Condo', 'Terrace', 'Semi-D', 'Bungalow'],
  };
  check('matcher: 汇集专案-Condo', app.huijiIsHuijiCats(['汇集专案-Condo']));
  check('matcher: 汇集商业-Retail', app.huijiIsHuijiCats(['汇集商业-Retail']));
  check('matcher: 汇集灵活-Semi-D', app.huijiIsHuijiCats(['汇集灵活-Semi-D']));
  check('matcher: 汇集简易-Bungalow', app.huijiIsHuijiCats(['汇集简易-Bungalow']));
  check('categories list: full 16-item track×property matrix present',
    Object.entries(HJ_MATRIX).every(([t, props]) => props.every(p => app.EVENT_CATEGORIES.includes(`汇集${t}-${p}`))));
  check('categories list: 商业 residential variants replaced',
    ['Condo', 'Terrace', 'Semi-D', 'Bungalow'].every(p => !app.EVENT_CATEGORIES.includes(`汇集商业-${p}`)));
  check('matcher: non-huiji course', app.huijiIsHuijiCats(['个人风水基础课']), false);
  check('matcher: 内含汇集 but not prefix', app.huijiIsHuijiCats(['大汇集晚宴']), false);
  check('matcher: empty', app.huijiIsHuijiCats([]), false);
  check('event matcher: JSON string cats', app.huijiIsHuijiEvent({ categories: '["汇集-简易"]' }));
  check('event matcher: array cats', app.huijiIsHuijiEvent({ categories: ['汇聚-专案'] }));
  check('event matcher: null event', app.huijiIsHuijiEvent(null), false);

  // 3 — merge: dedupe + trim + blank-drop + conversion sale + price-free
  const merged = app.huijiMergeSolutionSources(PURCHASES, PROSPECT_55.closing_record);
  check('merge: count (2 purchases + conversion)', merged.length, 3);
  check('merge: dedup kept one PR4', merged.filter(s => s.label === 'PR4 Power Ring').length, 1);
  check('merge: trimmed 财库画', merged.some(s => s.label === '财库画'));
  check('merge: blank dropped', merged.some(s => s.label === ''), false);
  check('merge: conversion sale present', merged.some(s => s.source === 'conversion' && s.label === '风水改命方案'));
  check('merge: pending marker', merged.find(s => s.label === '财库画')?.pending, true);
  check('merge: NO amount key ever', merged.every(s => !('amount' in s) && !('sale_amount' in s)));
  const merged2 = app.huijiMergeSolutionSources([{ id: 9, item: '风水改命方案', date: '2025-01-05' }], PROSPECT_55.closing_record);
  check('merge: conversion deduped vs purchase', merged2.length, 1);

  // 4 — normalize: array / JSON string / garbage
  check('normalize: array in', app.huijiNormalizeSolutions([{ label: 'A', date: '2025-01-01' }]).length, 1);
  check('normalize: JSON string in', app.huijiNormalizeSolutions('[{"label":"B"}]')[0].label, 'B');
  check('normalize: garbage string', app.huijiNormalizeSolutions('not json').length, 0);
  check('normalize: blank labels dropped', app.huijiNormalizeSolutions([{ label: '  ' }, { label: 'C' }]).length, 1);

  // 5 — widget flow: init + toggle + owner select + auto-pull
  makeEl('huiji-owner-section');
  const catBox = makeEl('mkt-event-categories');
  makeEl('mkt-event-cat-others-input');
  makeEl('huiji-owner-results');
  makeEl('huiji-owner-search');
  makeEl('huiji-owner-info');
  makeEl('huiji-solutions-block');
  makeEl('huiji-solutions-list');
  makeEl('huiji-notes');
  qsMap = { '#mkt-event-categories .mkt-event-category-cb:checked': [] };
  await app.huijiInitSection({ eventId: null });
  check('init: section hidden with no cats', elements.get('huiji-owner-section').style.display, 'none');
  check('init: cat box wired once', catBox.dataset.huijiWired, '1');

  qsMap['#mkt-event-categories .mkt-event-category-cb:checked'] = [{ value: '汇集-简易' }];
  app.huijiToggleSection();
  check('toggle: section shown for 汇集-简易', elements.get('huiji-owner-section').style.display, 'block');
  check('toggle: owner picker rendered', elements.get('huiji-owner-section').innerHTML.includes('屋主'));

  // owner required before any owner picked
  let v = app.huijiValidateBeforeSave();
  check('validate: blocked without owner', v.ok, false);
  check('validate: message names 屋主', String(v.msg || '').includes('屋主'));

  // non-huiji cats → inactive, never blocks
  qsMap['#mkt-event-categories .mkt-event-category-cb:checked'] = [{ value: '运程讲座' }];
  v = app.huijiValidateBeforeSave();
  check('validate: non-huiji passes', v.ok && v.active === false);
  qsMap['#mkt-event-categories .mkt-event-category-cb:checked'] = [{ value: '汇集-简易' }];

  // select owner → auto-pull renders checklist (unchecked) + conversion + price-free
  app.huijiSelectOwner(77, '陈大文');
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  const listEl = elements.get('huiji-solutions-list');
  check('pull: PR4 rendered', listEl.innerHTML.includes('PR4 Power Ring'));
  check('pull: conversion sale rendered', listEl.innerHTML.includes('风水改命方案'));
  check('pull: conversion tagged', listEl.innerHTML.includes('conversion sale'));
  check('pull: price never rendered', listEl.innerHTML.includes('88888'), false);
  check('pull: checklist starts UNCHECKED', listEl.innerHTML.includes(' checked'), false);
  check('pull: owner chip set', elements.get('huiji-owner-info').innerHTML.includes('陈大文'));

  // XSS: owner name escaped in chip
  app.huijiSelectOwner(78, '<img src=x onerror=alert(1)>');
  check('xss: owner chip escaped', !elements.get('huiji-owner-info').innerHTML.includes('<img'), true);
  app.huijiSelectOwner(77, '陈大文');
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));

  // 6 — collect: ticked pulled rows + manual rows; snapshot stays price-free
  qsMap['#huiji-solutions-list .huiji-sol-cb'] = [
    { checked: true, dataset: { idx: '0' } },
    { checked: false, dataset: { idx: '1' } },
  ];
  qsMap['#huiji-solutions-list .huiji-manual-row'] = [{
    querySelector: (sel) => sel === '.huiji-manual-label' ? { value: ' 老板房风水布局 ' } : { value: '2024-05-01' },
  }];
  const collected = app.huijiCollectSolutions();
  check('collect: 1 verified + 1 manual', collected.length, 2);
  check('collect: manual trimmed', collected.some(s => s.label === '老板房风水布局' && s.source === 'manual'));
  check('collect: no amounts in snapshot', collected.every(s => !('amount' in s)));
  check('collect: unticked rows excluded', collected.filter(s => s.source !== 'manual').length, 1);

  // 7 — save (create): payload shape + created_by stamped
  v = app.huijiValidateBeforeSave();
  check('validate: ok with owner', v.ok && v.active, true);
  elements.get('huiji-notes').value = '客厅财位摆放';
  await app.huijiSaveForEvent(123);
  check('save: one create call', calls.create.length, 1);
  check('save: table', calls.create[0]?.table, 'event_huiji_details');
  check('save: event_id', calls.create[0]?.rec.event_id, 123);
  check('save: owner id', calls.create[0]?.rec.owner_customer_id, 77);
  check('save: created_by = current user', calls.create[0]?.rec.created_by, 1);
  check('save: notes captured', calls.create[0]?.rec.notes, '客厅财位摆放');
  check('save: solutions is array', Array.isArray(calls.create[0]?.rec.solutions));
  check('save: snapshot price-free', JSON.stringify(calls.create[0]?.rec.solutions).includes('88888'), false);

  // 8 — save (update path when a briefing row already exists)
  _state.huiji.existing = { id: 42, created_by: 1, solutions: [] };
  await app.huijiSaveForEvent(123);
  check('save: update targets existing row', calls.update.some(u => u.table === 'event_huiji_details' && u.id === 42));
  check('save: no second create', calls.create.length, 1);

  // 9 — read-only (manager viewing another creator's briefing): never writes
  _state.huiji.readOnly = true;
  const before = calls.create.length + calls.update.length;
  v = app.huijiValidateBeforeSave();
  check('readonly: validate inactive', v.ok && v.active === false);
  await app.huijiSaveForEvent(123);
  check('readonly: no writes', calls.create.length + calls.update.length, before);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS CRASH:', e); process.exit(1); });
