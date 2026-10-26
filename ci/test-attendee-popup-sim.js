// ci/test-attendee-popup-sim.js — the event attendee pop-up (2026-10-26):
// a copy icon per value, "Copy all for Google Sheet" (tab-separated, IC kept
// as text), and Close / × / Escape / phone Back returning to the event it was
// opened from. Loads the REAL ui.js (showModal / hideModal / closeModal) and
// the REAL activities chunk in one vm sandbox with a small DOM stub.
// Run: node ci/test-attendee-popup-sim.js
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
const mkEl = (tag) => {
  const cls = new Set();
  const e = {
    tag, style: {}, dataset: {}, children: [], _html: '', value: '',
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) },
    get className() { return [...cls].join(' '); }, set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => cls.add(c)); },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
    set id(v) { this._id = v; byId.set(v, this); }, get id() { return this._id; },
    setAttribute() {}, appendChild(c) { this.children.push(c); return c; }, remove() {}, select() {},
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, focus() {},
  };
  return e;
};
const keyHandlers = [];
const document = {
  getElementById: (id) => byId.get(id) || null,
  createElement: mkEl,
  body: mkEl('body'),
  activeElement: null,
  addEventListener: (t, f) => { if (t === 'keydown') keyHandlers.push(f); },
  removeEventListener: (t, f) => { const i = keyHandlers.indexOf(f); if (i >= 0) keyHandlers.splice(i, 1); },
  querySelector: (sel) => {
    const ov = byId.get('global-modal-overlay');
    if (sel === '#global-modal-overlay.active .att-pop') return ov && ov.classList.contains('active') && ov.innerHTML.includes('att-pop') ? {} : null;
    return null;
  },
  querySelectorAll: () => [],
  execCommand: () => true,
};

// ─── window / clipboard / history ───────────────────────────────────────────
const clip = [];
let clipFail = false;
const popHandlers = [];
const hist = { stack: ['app'], pushState(s) { this.stack.push(s); }, back() { this.stack.pop(); setImmediate(() => popHandlers.forEach(f => f({}))); } };
const toasts = [];
const appCalls = [];
const windowStub = {
  addEventListener: (t, f) => { if (t === 'popstate') popHandlers.push(f); },
  location: { hostname: 'localhost' },
  _appState: { cu: { id: 1, role: 'Level 1' } },
};
const timers = [];
const sandbox = {
  window: windowStub, document, console,
  history: hist,
  navigator: { userAgent: 'node-sim', clipboard: { writeText: async (t) => { if (clipFail) throw new Error('denied'); clip.push(t); } } },
  setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {},
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  URL, Blob: function () {}, FileReader: function () {}, FormData: function () {},
  fetch: async () => ({ ok: false, json: async () => ({}) }),
};
sandbox.globalThis = sandbox;
windowStub.history = hist;
windowStub.document = document;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'ui.js'), 'utf8'), sandbox, { filename: 'ui.js' });
const UI = windowStub.UI || sandbox.UI;
UI.toast = { success: (m) => toasts.push(['ok', m]), error: (m) => toasts.push(['err', m]), info() {} };
sandbox.UI = UI;
const PEOPLE = {
  'prospects:77': { id: 77, full_name: 'Alan <b>Woon</b>', ic_number: '030519105747', email: 'a@x.com', date_of_birth: '1970-05-19', lunar_birth: '1970-04-15 (Lunar)', occupation: '', responsible_agent_id: 5 },
  'users:5': { id: 5, full_name: 'Oo Kean Cherng' },
};
sandbox.AppDataStore = { getById: async (t, id) => PEOPLE[`${t}:${id}`] || null };
const appStub = {
  register(name, fns) { Object.assign(this, fns); },
  viewActivityDetails: async (id) => { appCalls.push(['event', id]); },
  showProspectDetail: (id) => appCalls.push(['prospect', id]),
  showCustomerDetail: (id) => appCalls.push(['customer', id]),
};
windowStub.app = appStub; sandbox.app = appStub;
windowStub._crmUtils = new Proxy({ escapeHtml: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') },
  { get: (t, k) => (k in t ? t[k] : () => undefined) });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'chunks', 'script-activities.js'), 'utf8'), sandbox, { filename: 'script-activities.js' });
const app = windowStub.app;
const flush = () => new Promise(r => setImmediate(r));
const runTimers = async () => { while (timers.length) { const t = timers.shift(); await t.fn(); } await flush(); };
const overlay = () => byId.get('global-modal-overlay');
const isOpen = () => !!overlay() && overlay().classList.contains('active');
const footerAction = (label) => { const m = overlay().innerHTML.match(new RegExp(`onclick="([^"]*)"[^>]*>${label}<`)); return m && m[1].replace(/&quot;/g, '"'); };
const run = (js) => vm.runInContext(js, sandbox);

(async () => {
  check('ui exports closeModal', typeof UI.closeModal, 'function');
  for (const f of ['attCopy', 'attCopyAll', 'attOpenProfile']) check('chunk exports ' + f, typeof app[f], 'function');

  // ── open from an event ──────────────────────────────────────────────────
  await app.showAttendeeDetails(77, 'prospect', 9001);
  overlay().querySelectorAll = () => [{ offsetParent: {}, focus() {} }];   // focusable buttons for the Escape trap
  const html = overlay().innerHTML;
  check('pop-up open', isOpen());
  check('name escaped', html.includes('Alan &lt;b&gt;Woon&lt;/b&gt;') && !html.includes('<b>Woon'));
  check('copy icon per filled value (6 of 7)', (html.match(/app\.attCopy\(\d, this\)/g) || []).length, 6);
  check('empty value: dash, no icon', html.includes('>—<') && !html.includes('app.attCopy(5, this)'));
  check('Copy all button', html.includes('Copy all for Google Sheet'));
  check('× goes through closeModal', html.includes('class="modal-close" onclick="UI.closeModal()"'));
  check('Close button goes through closeModal', footerAction('Close'), 'UI.closeModal()');
  check('history entry pushed for phone Back', hist.stack.length, 2);

  await app.attCopy(1, null);
  check('copy one value (IC as shown)', clip.pop(), '030519105747');
  check('copied toast', toasts.pop()[1], 'Copied');
  await app.attCopyAll(null);
  check('copy all: one tab-separated row, IC kept as text', clip.pop(), "Alan <b>Woon</b>\t'030519105747\ta@x.com\t1970-05-19\t1970-04-15 (Lunar)\t\tOo Kean Cherng");
  clipFail = true;
  await app.attCopy(0, null);
  check('clipboard denied → execCommand fallback still copies', toasts.pop()[0], 'ok');
  clipFail = false;

  // ── Close → back to the event, history entry removed ─────────────────────
  run(footerAction('Close'));
  await flush(); await runTimers();
  check('Close: pop-up closed', isOpen(), false);
  check('Close: event reopened', JSON.stringify(appCalls.pop()), JSON.stringify(['event', 9001]));
  check('Close: history entry removed', hist.stack.length, 1);

  // ── phone Back → back to the event ───────────────────────────────────────
  await app.showAttendeeDetails(77, 'prospect', 9001);
  hist.back();                              // the user's Back gesture
  await flush(); await runTimers();
  check('Back: pop-up closed', isOpen(), false);
  check('Back: event reopened once', appCalls.filter(c => c[0] === 'event').length, 1);
  appCalls.length = 0;

  // ── Escape → back to the event ───────────────────────────────────────────
  await app.showAttendeeDetails(77, 'prospect', 9001);
  keyHandlers.slice().forEach(f => f({ key: 'Escape', preventDefault() {} }));
  await flush(); await runTimers();
  check('Escape: event reopened', JSON.stringify(appCalls.pop()), JSON.stringify(['event', 9001]));
  check('Escape: history clean', hist.stack.length, 1);

  // ── View Full Profile → the profile, NOT the event ───────────────────────
  await app.showAttendeeDetails(77, 'prospect', 9001);
  run(footerAction('View Full Profile'));
  await flush(); await runTimers();
  check('profile opened', JSON.stringify(appCalls), JSON.stringify([['prospect', 77]]));
  check('profile: history clean', hist.stack.length, 1);
  appCalls.length = 0;

  // ── opened elsewhere (no event) → closes normally ────────────────────────
  await app.showAttendeeDetails(77, 'prospect');
  check('no event: no history entry', hist.stack.length, 1);
  run(footerAction('Close'));
  await flush(); await runTimers();
  check('no event: closed, nothing reopened', !isOpen() && appCalls.length === 0);

  // ── other modals: a plain hideModal never runs a stale onClose ───────────
  let ran = 0;
  UI.showModal('A', 'x', [], '', { onClose: () => { ran++; } });
  UI.hideModal();
  UI.closeModal();                 // e.g. a later × on whatever is shown next
  UI.showModal('B', 'y', []);
  UI.closeModal();
  check('onClose dropped by hideModal / a new modal', ran, 0);
  UI.showModal('C', 'z', [], '', { onClose: () => { ran++; } });
  UI.closeModal();
  check('onClose runs once on closeModal', ran, 1);

  console.log(`\nattendee-popup sim: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
