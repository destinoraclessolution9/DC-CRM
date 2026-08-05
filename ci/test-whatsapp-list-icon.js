// ci/test-whatsapp-list-icon.js — desktop Prospects/Customers WhatsApp icon.
//
// WHY: each of those two lists has TWO live renderers (the legacy chunk template
// and a default-on React island), plus the prospects CARD view, which is the one
// path React never takes. A half-done edit therefore looks correct in whichever
// path the author happened to open and is invisible in the other. These tests pin
// all four render sites at once, plus the shared MSISDN normalizer.
//
// HARNESS: loads the REAL chunks/script-prospects.js and chunks/script-customers.js
// into a stubbed browser and reaches the private row templates by appending a
// single export line inside each chunk's IIFE (same technique as
// ci/test-boss-report-catalog.js — no template logic is duplicated here). waPhone
// is loaded from the REAL script.js by slicing its declaration out of the source,
// so a drift between script.js and this file's expectations fails the test rather
// than being papered over.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass++; return; }
    fail++;
    console.error(`FAIL ${name}${detail ? '\n  ' + detail : ''}`);
};
const eq = (name, got, want) => ok(name, got === want, `got:  ${got}\n  want: ${want}`);

// ── waPhone: sliced out of the real script.js ───────────────────────────────
const scriptSrc = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const waStart = scriptSrc.indexOf('const waPhone = (raw) => {');
ok('waPhone is declared in script.js', waStart !== -1);
const waEnd = scriptSrc.indexOf('\n    };', waStart);
const waPhone = eval('(' + scriptSrc.slice(waStart + 'const waPhone = '.length, waEnd + '\n    }'.length) + ')');

const PHONE_CASES = [
    ['0126379331',      '60126379331', 'leading 0 → 60'],
    ['+60 12-637 9331', '60126379331', '+60 with punctuation'],
    ['60126379331',     '60126379331', 'already normalized'],
    ['126379331',       '60126379331', 'bare local, leading 0 dropped'],   // the _evWaPhone fork got this wrong
    ['0177477 925',     '60177477925', 'internal space'],
    ['',                '',            'empty'],
    [null,              '',            'null'],
    ['-',               '',            'no digits'],
];
for (const [input, want, label] of PHONE_CASES) {
    eq(`waPhone: ${label}`, waPhone(input), want);
}

// ── Fake browser ────────────────────────────────────────────────────────────
global.window = global;
global.self = global;
const noop = () => {};
const asyncNoop = async () => {};

global.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
global.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add: noop, remove: noop }, appendChild: noop }),
    addEventListener: noop,
    body: { appendChild: noop, classList: { add: noop, remove: noop } },
    documentElement: { style: { setProperty: noop } },
};
// node >=21 defines navigator as a getter-only global — redefine rather than assign.
Object.defineProperty(global, 'navigator', {
    value: { userAgent: 'node', onLine: true }, configurable: true, writable: true,
});
global.location = { search: '', href: 'http://localhost/', hash: '' };
global.setTimeout = setTimeout;
global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
global.innerWidth = 1440;
global.addEventListener = noop;
global.removeEventListener = noop;
global.matchMedia = () => ({ matches: false, addListener: noop, addEventListener: noop });
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const escapeHtml = (unsafe) => String(unsafe == null ? '' : unsafe)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

window._appState = new Proxy({ cu: { id: 1, role: 'Level 1 Super Admin' } }, {
    get: (t, k) => (k in t ? t[k] : null),
    set: (t, k, v) => { t[k] = v; return true; },
});
window._crmUtils = {
    escapeHtml,
    waPhone,                                   // the sliced-out real implementation
    openWaChat: noop,
    isMobile: () => false,
    getVisibleUserIds: () => [],
    isSystemAdmin: () => true,
    isMarketingManager: () => false,
    isAgent: () => false,
    isManagement: () => true,
    isTeamLeaderOrAbove: () => true,
    isStockTakeStaff: () => false,
    isCustomer: () => false,
    isReferrer: () => false,
    isAgentOrLeader: () => false,
    getAgentsAndLeaders: () => [],
    getUserLevel: () => 1,
    debounce: (fn) => fn,
    debounceCall: (k, fn) => fn(),
    canViewProspect: () => true,
    canViewCustomer: () => true,
    getVisibleCustomers: () => [],
    USER_ROLES: [],
};
window.app = new Proxy({}, { get: () => noop });
window.UI = { toast: { success: noop, error: noop, info: noop }, showModal: noop, hideModal: noop, money: (n) => 'RM ' + n };
global.UI = window.UI;
window.AppDataStore = new Proxy({}, { get: () => asyncNoop });
global.AppDataStore = window.AppDataStore;
window.Auth = { getCurrentUser: asyncNoop };
global.Auth = window.Auth;
window._loadChunk = asyncNoop;
window.Perf = { debounce: (fn) => fn };

// ── Load a chunk, exposing named private bindings ────────────────────────────
// The chunks are IIFEs; append an assignment INSIDE the closing `})();` so the
// real, unmodified templates become reachable without exporting them in prod.
function loadChunk(file, names) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const close = src.lastIndexOf('})();');
    if (close === -1) throw new Error(`${file}: no trailing IIFE close found`);
    const bag = `\n;window.__T_${path.basename(file, '.js').replace(/\W/g, '_')} = { ${names.join(', ')} };\n`;
    const patched = src.slice(0, close) + bag + src.slice(close);
    eval(patched);
    return window[`__T_${path.basename(file, '.js').replace(/\W/g, '_')}`];
}

const P = loadChunk('chunks/script-prospects.js', ['buildProspectRowHtml', 'renderProspectCards', '_evWaPhone']);
const C = loadChunk('chunks/script-customers.js', ['renderCustomersTable', 'showCustomerDetail']);

// ── E7: the two chunk-private forks now delegate to the canonical helper ─────
// _evWaPhone had fallen a branch behind _mhomeWaPhone: a number stored without
// its leading 0 went to wa.me with no country code, so voucher shares to those
// prospects opened the wrong chat. Both are aliases now, so they cannot re-drift.
eq('_evWaPhone delegates (bare local gets 60)', P._evWaPhone('126379331'), '60126379331');
eq('_evWaPhone delegates (leading 0)', P._evWaPhone('0126379331'), '60126379331');

const M = loadChunk('chunks/script-mobile.js', ['_mhomeWaPhone']);
eq('_mhomeWaPhone delegates (mobile unchanged)', M._mhomeWaPhone('0126379331'), '60126379331');
eq('_mhomeWaPhone delegates (bare local)', M._mhomeWaPhone('126379331'), '60126379331');

// ── Prospects TABLE row (legacy chunk template) ─────────────────────────────
const ctx = { userById: new Map(), canReassign: false, canDelete: true, activeAgents: [], agentOptionParts: [] };
const withPhone = P.buildProspectRowHtml(
    { id: 7, full_name: 'Wong Pooi Mei', phone: '0126379331', score: 70, ming_gua: 'MG3', status: 'active' }, ctx);
const noPhone = P.buildProspectRowHtml(
    { id: 8, full_name: 'No Phone', phone: '', score: 15, ming_gua: 'MG9', status: 'active' }, ctx);

ok('prospects row: WhatsApp icon present', withPhone.includes('fab fa-whatsapp'));
ok('prospects row: opens normalized number', withPhone.includes("app.openWaChat('60126379331')"));
ok('prospects row: WhatsApp green', withPhone.includes('#25d366'));
ok('prospects row: hidden when no phone', !noPhone.includes('fa-whatsapp'),
    'a phone-less row must render NO button, not a dead one');
ok('prospects row: sits before Delete', withPhone.indexOf('fa-whatsapp') < withPhone.indexOf('fa-trash'),
    'placement is deliberate — a stale click on Delete\'s old spot must degrade to "opens a chat"');
ok('prospects row: actions cell still stops row navigation',
    withPhone.includes(`<td onclick="event.stopPropagation()">`));

// A quote in the phone field must not be able to break out of the onclick
// attribute — the number is normalized to digits before it is interpolated.
const quoted = P.buildProspectRowHtml(
    { id: 9, full_name: "Quote'y", phone: `012');alert('xss`, score: 1, status: 'active' }, ctx);
// `012');alert('xss` keeps only the digits 0,1,2 → leading-0 rule → 6012.
ok('prospects row: hostile phone cannot break the onclick',
    !quoted.includes("alert('xss") && quoted.includes("app.openWaChat('6012')"),
    'onclick must carry digits only');
ok('prospects row: hostile phone is escaped in the title attribute',
    quoted.includes('&#039;') && !/title="[^"]*'/.test(quoted));

// ── Prospects CARD view (the one path React never takes) ─────────────────────
let cardHtml = '';
global.document.getElementById = (id) =>
    (id === 'prospect-cards-container' ? { set innerHTML(v) { cardHtml = v; }, get innerHTML() { return cardHtml; } } : null);
P.renderProspectCards(
    [{ id: 7, full_name: 'Wong Pooi Mei', phone: '0126379331', score: 70 },
     { id: 8, full_name: 'No Phone', phone: null, score: 15 }],
    new Map(), false, []);
global.document.getElementById = () => null;

ok('prospects card: WhatsApp icon present', cardHtml.includes('fab fa-whatsapp'));
ok('prospects card: opens normalized number', cardHtml.includes("app.openWaChat('60126379331')"));
ok('prospects card: stops the card-navigate click',
    /onclick="event\.stopPropagation\(\);app\.openWaChat/.test(cardHtml),
    'the card itself opens the detail on click');
ok('prospects card: exactly one button for two rows (one has no phone)',
    (cardHtml.match(/fa-whatsapp/g) || []).length === 1);

// ── Customers table (legacy chunk template) ─────────────────────────────────
// renderCustomersTable is async + DOM/data bound; assert against the source of
// the row template instead, which is what the chunk actually emits.
const custSrc = fs.readFileSync(path.join(ROOT, 'chunks/script-customers.js'), 'utf8');
ok('customers row: WhatsApp button in the actions cell',
    /waPhone\(c\.phone\)[\s\S]{0,400}fab fa-whatsapp/.test(custSrc));
ok('customers row: calls openWaChat with the normalized number',
    /app\.openWaChat\('\$\{_wa\}'\)/.test(custSrc));
ok('customers chunk: waPhone bound from _crmUtils',
    /const waPhone\s+= \(raw\) => _utils\.waPhone\(raw\)/.test(custSrc));

// ── Customer DETAIL header (chunk-rendered; no React equivalent) ────────────
// The header button used to open the Meta Business API composer while the
// prospect detail header and every list row opened the chat directly. Render the
// real header and assert the behaviours match.
async function renderCustomerDetail(customer) {
    let html = '';
    const viewport = { set innerHTML(v) { html = v; }, get innerHTML() { return html; }, querySelectorAll: () => [] };
    const prevGet = global.document.getElementById;
    const prevQSA = global.document.querySelectorAll;
    global.document.getElementById = (id) => (id === 'content-viewport' ? viewport : null);
    global.document.querySelectorAll = () => [];
    window.AppDataStore = new Proxy({}, {
        get: (t, k) => (k === 'getById'
            ? async (table) => (table === 'customers' ? customer : null)
            : k === 'query' ? async () => [] : asyncNoop),
    });
    global.AppDataStore = window.AppDataStore;
    try { await C.showCustomerDetail(customer.id); } finally {
        global.document.getElementById = prevGet;
        global.document.querySelectorAll = prevQSA;
    }
    return html;
}

let detailHtml = '';
const detailTests = (async () => {
    const withPhoneHtml = detailHtml = await renderCustomerDetail(
        { id: 42, full_name: 'Chia Ying Ying', phone: '0107640462', customer_since: '2025-01-02' });
    ok('customer detail: header WhatsApp button present', /fab fa-whatsapp/.test(withPhoneHtml));
    ok('customer detail: opens the chat directly',
        withPhoneHtml.includes("app.openWaChat('60107640462')"),
        'must not route through openSendWhatsAppModal (the Meta composer)');
    ok('customer detail: no longer opens the Meta composer',
        !/openSendWhatsAppModal/.test(withPhoneHtml));

    const noPhoneHtml = await renderCustomerDetail({ id: 43, full_name: 'No Phone', phone: null });
    // Detail headers keep a stable button row, unlike list rows — an empty number
    // reaches openWaChat, which toasts rather than opening a broken wa.me link.
    ok('customer detail: button stays put without a phone', /fab fa-whatsapp/.test(noPhoneHtml));
    ok('customer detail: empty number falls through to the toast',
        noPhoneHtml.includes("app.openWaChat('')"));
})();

// ── React islands (default-on path) ─────────────────────────────────────────
const waBtn = fs.readFileSync(path.join(ROOT, 'src/react/ui/WhatsAppButton.jsx'), 'utf8');
ok('React button: delegates to the same normalizer', /app\(\)\.waPhone/.test(waBtn));
ok('React button: renders nothing without a number', /if \(!num\) return null;/.test(waBtn));
ok('React button: calls openWaChat', /openWaChat\(num\)/.test(waBtn));
for (const view of ['ProspectsTable', 'CustomersTable']) {
    const src = fs.readFileSync(path.join(ROOT, `src/react/views/${view}.jsx`), 'utf8');
    ok(`React ${view}: imports WhatsAppButton`, /import \{ WhatsAppButton \}/.test(src));
    ok(`React ${view}: renders <WhatsAppButton phone=`, /<WhatsAppButton phone=\{[cp]\.phone\}/.test(src));
}

// ── Shipped bundles actually carry it (Vercel serves the .min files) ────────
for (const f of ['chunks/script-prospects.min.js', 'chunks/script-customers.min.js', 'script.min.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    ok(`built ${f}: contains the WhatsApp wiring`,
        /openWaChat/.test(src), 'run `node build.mjs` after editing the source');
}
ok('built react-dist/react-island.js: contains the WhatsApp button',
    /fab fa-whatsapp/.test(fs.readFileSync(path.join(ROOT, 'react-dist/react-island.js'), 'utf8')),
    'run `npx vite build` — Vercel never runs vite, the bundle must be committed');

// The customer-detail render is async, so the summary waits on it.
detailTests.then(() => {
    // `WA_DUMP=1 node ci/test-whatsapp-list-icon.js > rows.html` emits the real
    // chunk-rendered rows so they can be eyeballed against the live stylesheets
    // without a logged-in session.
    if (process.env.WA_DUMP) {
        console.log(`<table class="prospects-table"><tbody>${withPhone}${noPhone}</tbody></table>`);
        console.log(`<div class="prospect-cards-grid">${cardHtml}</div>`);
        console.log(detailHtml);
        process.exit(fail ? 1 : 0);
    }
    console.log(`\ntest-whatsapp-list-icon: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}).catch((e) => {
    console.error('harness crashed:', e);
    process.exit(1);
});
