// ci/test-mark-delivered.js — "📦 Mark delivered" on each sale in a profile's
// DC Closing Record (2026-10-27): shown only while the sale is not delivered /
// cancelled, opens the delivery Items screen in profile mode, and the closing
// record refreshes after Close. The Items screen itself is ci/test-delivery-items.js.
// HARNESS: the REAL chunks/script-prospects.js in a stubbed browser; private
// helpers reached by appending one export line inside the IIFE
// (ci/test-whatsapp-list-icon.js technique).
// Run: node ci/test-mark-delivered.js
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass++; return; }
    fail++;
    console.error(`FAIL ${name}${detail ? '\n  ' + detail : ''}`);
};

global.window = global;
global.self = global;
const noop = () => {};
const asyncNoop = async () => {};
global.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
const els = [];
global.document = {
    getElementById: (id) => els.find(e => e.id === id) || null, querySelector: () => null,
    querySelectorAll: (sel) => (/closing-/.test(sel) ? els : []),
    createElement: () => ({ style: {}, classList: { add: noop, remove: noop }, appendChild: noop }),
    addEventListener: noop, body: { appendChild: noop, classList: { add: noop, remove: noop } },
    documentElement: { style: { setProperty: noop } },
};
Object.defineProperty(global, 'navigator', { value: { userAgent: 'node', onLine: true }, configurable: true, writable: true });
global.location = { search: '', href: 'http://localhost/', hash: '' };
global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
global.innerWidth = 400;
global.addEventListener = noop;
global.removeEventListener = noop;
global.matchMedia = () => ({ matches: false, addListener: noop, addEventListener: noop });
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
const escapeHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
window._appState = new Proxy({ cu: { id: 1, role: 'Level 5 Team Leader' } }, { get: (t, k) => (k in t ? t[k] : null), set: (t, k, v) => { t[k] = v; return true; } });
window._crmUtils = new Proxy({ escapeHtml, recordCurrency: () => 'MYR', isMobile: () => true, debounce: (f) => f, debounceCall: (k, f) => f(), USER_ROLES: [] },
    { get: (t, k) => (k in t ? t[k] : () => false) });
const calls = [];
window.app = new Proxy({
    openDeliveryItems: async (...a) => { calls.push(['openDeliveryItems', ...a]); },
    switchCustomerProfileTab: async (...a) => { calls.push(['switchCustomerProfileTab', a[0], a[1]]); },
}, { get: (t, k) => (k in t ? t[k] : noop) });
window.UI = { toast: { success: noop, error: noop, info: noop }, showModal: noop, hideModal: noop, formatCurrency: (n) => 'RM ' + n, escJsAttr: (s) => String(s) };
global.UI = window.UI;
const PURCHASES = [
    { id: 11, customer_id: 77, item: '积仓富（限时特价） Ji Cang Fu Promo 3.0', amount: 16980, date: '2026-10-24', invoice: 'PR 1936471', delivery_status: 'Pending Delivery' },
    { id: 12, customer_id: 77, item: '心誠配套-PR6', amount: 13490, date: '2026-06-11', invoice: '1921450', delivery_status: 'Delivered' },
    { id: 13, customer_id: 77, item: 'Cancelled thing', amount: 100, date: '2026-05-01', delivery_status: 'Cancelled' },
    { id: 14, customer_id: 77, item: 'Half done', amount: 200, date: '2026-04-01', delivery_status: 'Partial Delivery' },
];
window.AppDataStore = new Proxy({ query: async (t) => (t === 'purchases' ? PURCHASES.map(p => ({ ...p })) : []) }, { get: (t, k) => (k in t ? t[k] : asyncNoop) });
global.AppDataStore = window.AppDataStore;
window._loadChunk = asyncNoop;
window.Perf = { debounce: (fn) => fn };

const src = fs.readFileSync(path.join(__dirname, '..', 'chunks', 'script-prospects.js'), 'utf8');
const close = src.lastIndexOf('})();');
eval(src.slice(0, close) + '\n;window.__T_p = { buildClosingSalesLedger, pvMarkDelivered, pvRefreshClosing };\n' + src.slice(close));
const P = window.__T_p;

(async () => {
    const html = await P.buildClosingSalesLedger({ customer: { id: 77, full_name: 'X' }, customerMode: true });
    ok('pending sale has Mark delivered', html.includes('app.pvMarkDelivered(11, 77)'));
    ok('partial delivery still has it', html.includes('app.pvMarkDelivered(14, 77)'));
    ok('delivered / cancelled sales do not', !html.includes('app.pvMarkDelivered(12,') && !html.includes('app.pvMarkDelivered(13,'));
    ok('the tap does not fold the sale open/closed', /event\.preventDefault\(\);event\.stopPropagation\(\);app\.pvMarkDelivered/.test(html));

    await P.pvMarkDelivered(11, 77);
    ok('opens the Items screen in profile mode', JSON.stringify(calls.pop()) === JSON.stringify(['openDeliveryItems', 'purchase', 11, 77, { from: 'profile' }]));

    els.push({ id: 'cust-acc-body-closing-77', dataset: {} });
    await P.pvRefreshClosing();
    ok('refresh re-renders the customer closing section', calls.some(c => c[0] === 'switchCustomerProfileTab' && c[1] === 'closing' && String(c[2]) === '77'));

    console.log(`\nmark-delivered: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
