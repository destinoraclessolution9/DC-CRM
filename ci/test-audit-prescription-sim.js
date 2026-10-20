// ci/test-audit-prescription-sim.js — 🩺 Audit Prescription block in
// chunks/script-prospects.js: totals (open = Must + Recommended only), status
// options, escaping, and save validation. Loads the REAL chunk in a vm sandbox.
// Run: node ci/test-audit-prescription-sim.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let pass = 0, fail = 0;
function check(name, got, want = true) {
  if (got === want) { pass++; return; }
  fail++; console.error(`FAIL ${name}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`);
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const els = new Map();
const calls = { inserts: [], toastErr: [], toastOk: [] };
const sb = { from: () => { const api = { select() { return api; }, eq() { return api; }, order() { return api; },
  insert(r) { calls.inserts.push(r); return api; }, update() { return api; }, delete() { return api; },
  maybeSingle() { return Promise.resolve({ data: { id: 1 }, error: null }); }, then(res) { return Promise.resolve({ data: [], error: null }).then(res); } }; return api; } };
const utils = new Proxy({ escapeHtml: esc, getUserLevel: () => 9, isAgent: () => true }, { get: (t, k) => (k in t ? t[k] : () => undefined) });
const win = { _appState: { cu: { id: 101, role: 'Level 9 Consultant' } }, _crmUtils: utils, supabase: sb, addEventListener() {}, app: null };
const appStub = { register(n, f) { Object.assign(this, f); }, navigateTo: async () => {} };
win.app = appStub;
const sandbox = {
  window: win, app: appStub, console, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
  document: { getElementById: (id) => els.get(id) || null, querySelectorAll: () => [], createElement: () => ({ style: {} }), head: { appendChild() {} }, body: { appendChild() {} }, addEventListener() {} },
  AppDataStore: { getAll: async () => [], getById: async () => null, query: async () => [] },
  UI: { showModal() {}, hideModal() {}, escJsAttr: (s) => s, toast: { success: (m) => calls.toastOk.push(m), error: (m) => calls.toastErr.push(m) } },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, navigator: { userAgent: 'sim' }, confirm: () => true,
  URL, Blob: function () {}, FileReader: function () {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'chunks', 'script-prospects.js'), 'utf8'), sandbox, { filename: 'script-prospects.js' });
const app = win.app;
(async () => {
  const rows = [
    { id: 1, product: '八大护法 Prosperity Power Ring', qty: 1, quoted_amount: 19990, priority: 'must', status: 'proposed' },
    { id: 2, product: '<img src=x onerror=alert(1)>', qty: 2, quoted_amount: 12000, priority: 'recommended', status: 'accepted' },
    { id: 3, product: 'Art', qty: 1, quoted_amount: 5000, priority: 'optional', status: 'proposed' },
    { id: 4, product: 'Old', qty: 1, quoted_amount: 3000, priority: 'must', status: 'bought' },
    { id: 5, product: 'No', qty: 1, quoted_amount: 7000, priority: 'must', status: 'declined' },
  ];
  const html = app._prescriptionBlockHtml(77, 555, rows);
  check('escapes product names', html.includes('&lt;img src=x') && !html.includes('<img src=x'));
  check('open = Must + Recommended only', html.includes('Still open (Must + Recommended) <strong>RM 31,990</strong>'));
  check('bought total', html.includes('Bought <strong>RM 3,000</strong>'));
  check('total excludes declined', html.includes('Total <strong>RM 39,990</strong>'));
  check('qty shown', html.includes('× 2'));
  check('add button wired', html.includes('app.openPrescriptionModal(77,555)'));
  check('empty state', app._prescriptionBlockHtml(1, 2, []).includes('No solutions prescribed yet'));
  // save validation
  const set = (id, v, extra) => els.set(id, { value: v, options: [{ dataset: { pid: '9' } }], selectedIndex: 0, ...(extra || {}) });
  set('rx-product', ''); set('rx-amount', '100'); set('rx-qty', '1'); set('rx-priority', 'must'); set('rx-notes', '');
  await app.savePrescriptionLine(77, 555, null);
  check('missing product blocked', calls.toastErr.pop(), 'Pick the solution.');
  set('rx-product', 'PR6'); set('rx-amount', '');
  await app.savePrescriptionLine(77, 555, null);
  check('missing price blocked', calls.toastErr.pop(), 'Enter the quoted price.');
  check('nothing inserted yet', calls.inserts.length, 0);
  set('rx-amount', '18990'); set('rx-qty', '2');
  await app.savePrescriptionLine(77, 555, null);
  const ins = calls.inserts[0] || {};
  check('insert prospect + audit', ins.prospect_id === 77 && ins.audit_id === 555);
  check('insert numbers', ins.quoted_amount === 18990 && ins.qty === 2);
  check('insert product id', ins.product_id, 9);
  check('insert created_by', ins.created_by, 101);
  console.log(`audit-prescription-sim: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS CRASH:', e); process.exit(1); });
