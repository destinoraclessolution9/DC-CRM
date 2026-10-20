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

const CATALOG = [
  { id: 1, name: '厚滿堂2 Hou Man Tang 2 [PU] Bed Frame - Queen', category: 'Mattresses & Bedsheets > Bed Frames', price_customer: 18980, price_member: 14980, is_active: true },
  { id: 2, name: 'Bloom 001 - Dragon Pleat Curtain (Beige)', category: 'Curtains', price_customer: 2599, price_member: 2349, price_customer_min: 2599, price_customer_max: 5899, is_active: true },
  { id: 3, name: 'Velvet Sofa, 3 Seater', category: 'Tables & Chairs > Sofas & Armchairs', price_customer: 6999, price_member: 6299, is_active: true },
  { id: 4, name: 'Plain Mattress Protector', category: 'Mattresses & Bedsheets', price_customer: 399, price_member: 349, is_active: true },
  { id: 5, name: 'Hidden Old Item', category: 'Curtains', price_customer: 1, is_active: false },
];
const OPTIONS = [
  { id: 11, catalog_id: 2, option_type: 'Curtain Size', option_label: 'L5ft x H7ft', price_customer: 3299, price_member: 2999, sort_order: 2 },
  { id: 12, catalog_id: 2, option_type: 'Curtain Size', option_label: 'L3ft x H6ft', price_customer: 2599, price_member: 2349, sort_order: 1 },
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
  async getAll(t) {
    if (t === 'bujishu_catalog') return CATALOG;
    if (t === 'bujishu_catalog_options') return OPTIONS;
    return [];
  },
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
// ci/test-bujishu-picker-sim.js — 🛋️ category-first Bujishu Catalogue picker
// (chunks/script-activities.js): label cleaning, category tree, views, multi
// (chips + hidden checkboxes) and single (select + amount) picking, saved-text
// round trip, and the Post-Meetup Notes block wiring.
sandbox.Event = function (type) { this.type = type; };
(async () => {
  for (const fn of ['bjcData', 'bjcMultiHtml', 'bjcAttachSelect', 'bjcOpen', 'bjcShow', 'bjcFilter', 'bjcPick', 'bjcRemove', 'bjcSelectedFromText', 'bjcResolveLabel', 'bjcLabel', 'bjcClean']) {
    check(`registered: ${fn}`, typeof app[fn], 'function');
  }
  // cleaning matches SQL bjc_clean: [ ] , | never reach the "[Group] a, b | Remarks" format
  check('clean brackets/commas/pipes', app.bjcClean('A [PU], B | C'), 'A (PU)， B / C');
  const d = await app.bjcData();
  check('inactive items dropped', d.list.length, 4);
  check('tree: main categories', [...d.tree.keys()].sort().join('|'), 'Curtains|Mattresses & Bedsheets|Tables & Chairs');
  const mb = d.tree.get('Mattresses & Bedsheets');
  check('tree: sub + direct items', mb.subs.get('Bed Frames').length === 1 && mb.direct.length === 1, true);
  check('options sorted', d.optsBy.get('2').map(o => o.id).join(','), '12,11');
  const lblOpt = app.bjcLabel(CATALOG[1], OPTIONS[0]);
  check('label with option', lblOpt, 'Bloom 001 - Dragon Pleat Curtain (Beige) · L5ft x H7ft');
  check('resolve label → item + option', ((await app.bjcResolveLabel(lblOpt)) || {}).opt?.id, 11);
  check('resolve cleaned [PU] name', ((await app.bjcResolveLabel('厚滿堂2 Hou Man Tang 2 (PU) Bed Frame - Queen')) || {}).item?.id, 1);
  check('resolve ignores 🛋️ prefix', ((await app.bjcResolveLabel('🛋️ Plain Mattress Protector')) || {}).item?.id, 4);
  check('DC name is not catalogue', await app.bjcResolveLabel('八大护法 Prosperity Power Ring'), null);
  // saved-text round trip
  const saved = '[Products] PR6 | [Bujishu Catalogue] Velvet Sofa， 3 Seater, Plain Mattress Protector | Remarks: wants cosy';
  check('selected from text', app.bjcSelectedFromText(saved).join(' / '), 'Velvet Sofa， 3 Seater / Plain Mattress Protector');
  check('selected from text: none', app.bjcSelectedFromText('[Products] PR6').length, 0);

  // multi block + views
  const html = app.bjcMultiHtml('pmn-opp', 'pmn-opp-items', ['Plain Mattress Protector']);
  check('multi: hidden checked checkbox with form name + group', html.includes('name="pmn-opp-items"') && html.includes('data-group="Bujishu Catalogue"') && html.includes('checked'));
  check('multi: category button', html.includes("app.bjcOpen('pmn-opp')"));
  const panel = makeEl('pmn-opp-bjc-panel'); panel.style.display = 'none';
  const chips = makeEl('pmn-opp-bjc-chips'); chips.insertAdjacentHTML = function (pos, h) { this.innerHTML += h; }; chips.querySelectorAll = () => [];
  await app.bjcOpen('pmn-opp');
  check('open: shows categories only', panel.innerHTML.includes('Tap a category') && panel.innerHTML.includes('Curtains') && !panel.innerHTML.includes('Velvet Sofa'));
  await app.bjcShow('pmn-opp', 'subs', 'Mattresses & Bedsheets');
  check('subs: sub-groups + Other', panel.innerHTML.includes('Bed Frames') && panel.innerHTML.includes('Other Mattresses &amp; Bedsheets'));
  await app.bjcShow('pmn-opp', 'items', 'Curtains', '');
  check('items: only that category', panel.innerHTML.includes('Dragon Pleat') && !panel.innerHTML.includes('Velvet') && !panel.innerHTML.includes('Hidden Old'));
  check('items: price range + options hint', panel.innerHTML.includes('RM 2,599–5,899') && panel.innerHTML.includes('choose size/colour'));
  makeEl('pmn-opp-bjc-list');
  await app.bjcFilter('pmn-opp', 'zzz');
  check('filter within category', elements.get('pmn-opp-bjc-list').innerHTML.includes('No items'));
  await app.bjcShow('pmn-opp', 'opts', 2);
  check('opts: customer + member prices', panel.innerHTML.includes('RM 3,299') && panel.innerHTML.includes('member RM 2,999'));
  await app.bjcPick('pmn-opp', 2, 11);
  check('multi pick adds chip checkbox', chips.innerHTML.includes('value="Bloom 001 - Dragon Pleat Curtain (Beige) · L5ft x H7ft"') && chips.innerHTML.includes('data-group="Bujishu Catalogue"'));
  check('names escaped in chips', !app.bjcMultiHtml('x', 'n', ['<b>x</b>']).includes('<b>x</b>'));

  // single mode on a sales select
  const opts = [];
  const sel = makeEl('cr-product'); sel.dataset = {}; sel.options = opts;
  sel.appendChild = (o) => opts.push(o); sel.removeAttribute = () => {}; let changed = 0; sel.dispatchEvent = () => { changed++; };
  sel.insertAdjacentHTML = () => {};
  const amt = makeEl('cr-amount'); amt.dispatchEvent = () => {};
  check('attach once', app.bjcAttachSelect('cr-product', 'cr-amount') && !app.bjcAttachSelect('cr-product', 'cr-amount'), true);
  makeEl('bjs-cr-product-bjc-panel');
  await app.bjcPick('bjs-cr-product', 1, null);
  check('single: select set to label', sel.value, '厚滿堂2 Hou Man Tang 2 (PU) Bed Frame - Queen');
  check('single: option carries ids + price', !!opts[0] && opts[0].dataset.bjcId === '1' && opts[0].dataset.price === '18980');
  check('single: change fired', changed, 1);
  check('single: amount = customer price', amt.value, 18980);
  // rx / pur selects keep their own price logic (qty × price)
  const ropts = []; const rsel = makeEl('rx-product'); rsel.dataset = {}; rsel.options = ropts; rsel.appendChild = (o) => ropts.push(o); rsel.removeAttribute = () => {}; rsel.dispatchEvent = () => {}; rsel.insertAdjacentHTML = () => {};
  const ramt = makeEl('rx-amount'); ramt.value = '';
  app.bjcAttachSelect('rx-product', 'rx-amount'); makeEl('bjs-rx-product-bjc-panel');
  await app.bjcPick('bjs-rx-product', 4, null);
  check('rx: amount left to its handler', ramt.value, '');

  // Post-Meetup Notes block shows the picker AFTER DC / existing potential
  const block = app.buildPostMeetupNotesBlock('pmn', { opportunity_potential: saved }, { products: [{ name: 'PR6' }], bujishu: [{ name: '悦满堂' }], formula: [] });
  const iDC = block.indexOf('value="PR6"'), iOld = block.indexOf('value="悦满堂"'), iBjc = block.indexOf('🛋️ Bujishu Catalogue');
  check('order: DC → existing potential → Bujishu Catalogue', iDC > 0 && iOld > iDC && iBjc > iOld);
  check('saved catalogue items come back as chips', block.includes('value="Plain Mattress Protector"') && block.includes('value="Velvet Sofa， 3 Seater"'));

  console.log(`bujishu-picker-sim: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS CRASH:', e); process.exit(1); });
