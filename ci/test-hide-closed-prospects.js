// ci/test-hide-closed-prospects.js — Unable to Serve + Dropped (F) stay out of
// the desktop Prospects list unless asked for (owner 2026-11-06: "those rejected
// since is hide then should not show in list, unless i want to call it out").
//
// WHY: the desktop list has THREE load paths and a half-done edit looks right in
// whichever one the author opened:
//   1. React island  → /api/prospects (BFF) → prospects_page(p_include_closed)
//   2. server page   → AppDataStore.prospectsPage({ includeClosed })
//   3. legacy client → getActiveProspects + a client-side filter (also card view)
// Each must hide the rows by default and bring them back when the user ticks
// "Show Unable to Serve / Dropped (F)" or searches a name / phone. The phone list
// is pinned separately in ci/test-mobile-prospects-parity.js.
//
// HARNESS: the REAL chunks/script-prospects.js runs in a stubbed browser (same
// export-line technique as ci/test-whatsapp-list-icon.js), and the REAL
// api/prospects.mjs handler runs against a stubbed fetch.
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass++; return; }
    fail++;
    console.error(`FAIL ${name}${detail ? '\n  ' + detail : ''}`);
};
const eq = (name, got, want) => ok(name, got === want, `got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);

// ── Fake browser ────────────────────────────────────────────────────────────
global.window = global;
global.self = global;
const noop = () => {};
const asyncNoop = async () => {};

const makeEl = (id) => {
    const el = {
        id, value: '', checked: false, innerHTML: '', textContent: '',
        style: {}, dataset: {}, children: [],
        classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
        appendChild: noop, insertBefore: noop, insertAdjacentHTML: noop, remove: noop,
        setAttribute: noop, removeAttribute: noop, addEventListener: noop,
        querySelector: () => null, querySelectorAll: () => [],
    };
    el.closest = () => makeEl(`${id}-parent`);
    el.parentNode = { insertBefore: noop, appendChild: noop };
    return el;
};
const els = new Map();
const $ = (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };
$('prospect-adv-filters').style.display = 'none';

global.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
global.document = {
    getElementById: (id) => $(id),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (t) => makeEl(`new-${t}`),
    addEventListener: noop,
    body: { appendChild: noop, classList: { add: noop, remove: noop } },
    documentElement: { style: { setProperty: noop } },
};
Object.defineProperty(global, 'navigator', {
    value: { userAgent: 'node', onLine: true }, configurable: true, writable: true,
});
global.location = { search: '', href: 'http://localhost/', hash: '' };
global.performance = global.performance || { now: () => Date.now() };
global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
global.innerWidth = 1440;
global.addEventListener = noop;
global.removeEventListener = noop;
global.matchMedia = () => ({ matches: false, addListener: noop, addEventListener: noop });
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
// renderProspectsTable prints a perf table on every render; keep the output readable.
console.table = noop;

const escapeHtml = (unsafe) => String(unsafe == null ? '' : unsafe)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

window._appState = new Proxy({ cu: { id: 1, role: 'Level 1 Super Admin' } }, {
    get: (t, k) => (k in t ? t[k] : null),
    set: (t, k, v) => { t[k] = v; return true; },
});
window._crmUtils = {
    escapeHtml,
    waPhone: (p) => String(p || '').replace(/\D/g, ''),
    openWaChat: noop,
    isMobile: () => false,
    getVisibleUserIds: async () => 'all',
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
    listCountryScope: () => 'ALL',
    ALL_COUNTRIES: 'ALL',
    recordCountry: () => 'MY',
    USER_ROLES: [],
};
window.app = new Proxy({}, { get: () => noop });
window.UI = { toast: { success: noop, error: noop, info: noop }, showModal: noop, hideModal: noop, money: (n) => 'RM ' + n };
global.UI = window.UI;
window.Auth = { getCurrentUser: asyncNoop };
global.Auth = window.Auth;
window._loadChunk = asyncNoop;
window.Perf = { debounce: (fn) => fn };

// ── Fixtures ────────────────────────────────────────────────────────────────
const ROWS = [
    { id: 1, full_name: 'Open Alpha',   phone: '0110000001', score: 90, status: 'active', responsible_agent_id: 7 },
    { id: 2, full_name: 'Uts Sandrea',  phone: '0110000002', score: 80, status: 'active', responsible_agent_id: 7, unable_to_serve: true },
    { id: 3, full_name: 'Dropped Fong', phone: '0110000003', score: 70, status: 'active', responsible_agent_id: 7, manual_grade: 'F' },
    { id: 4, full_name: 'Open Beta',    phone: '0110000004', score: 60, status: 'active', responsible_agent_id: 7, manual_grade: 'B' },
];
const pageCalls = [];
window.AppDataStore = {
    getActiveProspects: async () => ROWS.map(r => ({ ...r })),
    searchProspects: async (term) => ROWS.filter(r => r.full_name.toLowerCase().includes(String(term).toLowerCase())).map(r => ({ ...r })),
    searchCustomers: async () => [],
    getAll: async (t) => (t === 'users' ? [{ id: 7, full_name: 'Agent Seven', role: 'Level 7 Agent' }] : []),
    getUsersByIds: async () => [],
    getLatestActivitiesForProspects: async () => new Map(),
    prospectsPage: async (opts) => { pageCalls.push(opts); return { data: [], count: 0 }; },
};
global.AppDataStore = window.AppDataStore;

function loadChunk(file, names) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const close = src.lastIndexOf('})();');
    if (close === -1) throw new Error(`${file}: no trailing IIFE close found`);
    const key = `__T_${path.basename(file, '.js').replace(/\W/g, '_')}`;
    const patched = src.slice(0, close) + `\n;window.${key} = { ${names.join(', ')} };\n` + src.slice(close);
    eval(patched);
    return window[key];
}
const P = loadChunk('chunks/script-prospects.js',
    ['renderProspectsTable', '_isClosedOutProspect', 'updateProspectFilterBadge']);

const listed = () => ROWS.filter(r => $('prospects-table-body').innerHTML.includes(r.full_name)).map(r => r.full_name);
const setUi = ({ search = '', showClosed = false } = {}) => {
    $('prospect-search').value = search;
    $('filter-show-closed').checked = showClosed;
};

(async () => {
    // ── The rule itself ─────────────────────────────────────────────────────
    eq('Unable to Serve is closed out', P._isClosedOutProspect({ unable_to_serve: true }), true);
    eq('grade F is closed out', P._isClosedOutProspect({ manual_grade: 'F' }), true);
    eq('grade B is not', P._isClosedOutProspect({ manual_grade: 'B' }), false);
    eq('a plain row is not', P._isClosedOutProspect({}), false);
    eq('null is not', P._isClosedOutProspect(null), false);

    // ── Path 3: legacy client list (React off, no server tables) ────────────
    window.__REACT_PROSPECTS = false;
    window.__SERVER_TABLES = false;
    setUi();
    await P.renderProspectsTable();
    eq('legacy: hidden by default', listed().join(','), 'Open Alpha,Open Beta');
    ok('legacy: Total Prospects counts only what is shown',
        /<div class="prospect-stat-value">2<\/div><div class="prospect-stat-label">Total Prospects/.test($('prospect-stats-row').innerHTML),
        $('prospect-stats-row').innerHTML.slice(0, 200));
    ok('legacy: the note under the list says they are hidden',
        /Unable to Serve \/ Dropped \(F\)/.test($('prospects-pagination').innerHTML), $('prospects-pagination').innerHTML.slice(0, 300));

    setUi({ showClosed: true });
    await P.renderProspectsTable();
    eq('legacy: ticking Show brings both back', listed().join(','), 'Open Alpha,Uts Sandrea,Dropped Fong,Open Beta');
    ok('legacy: they are still greyed out', ($('prospects-table-body').innerHTML.match(/class="row-unable"/g) || []).length === 2);
    ok('legacy: no "hidden" note once shown',
        !/Unable to Serve \/ Dropped \(F\)/.test($('prospects-pagination').innerHTML));

    setUi({ search: 'sandrea' });
    await P.renderProspectsTable();
    eq('legacy: a name search finds an Unable to Serve prospect', listed().join(','), 'Uts Sandrea');
    setUi({ search: 'fong' });
    await P.renderProspectsTable();
    eq('legacy: a name search finds a Dropped (F) prospect', listed().join(','), 'Dropped Fong');

    // ── Path 2: server page (AppDataStore.prospectsPage) ────────────────────
    window.__SERVER_TABLES = true;
    pageCalls.length = 0;
    setUi();
    await P.renderProspectsTable();
    eq('server: asks to hide them by default', pageCalls[0] && pageCalls[0].includeClosed, false);
    setUi({ showClosed: true });
    await P.renderProspectsTable();
    eq('server: Show asks for them', pageCalls[1] && pageCalls[1].includeClosed, true);
    setUi({ search: 'sandrea' });
    await P.renderProspectsTable();
    eq('server: a search asks for them', pageCalls[2] && pageCalls[2].includeClosed, true);

    // ── Path 1: React island params ─────────────────────────────────────────
    const mounts = [];
    window.__REACT_PROSPECTS = true;
    window.CRMReact = { mountProspectsTable: (root, props) => { mounts.push(props.params); } };
    setUi();
    await P.renderProspectsTable();
    eq('react: closed=false by default', mounts[0] && mounts[0].closed, false);
    setUi({ showClosed: true });
    await P.renderProspectsTable();
    eq('react: closed=true when Show is ticked', mounts[1] && mounts[1].closed, true);
    setUi({ search: 'sandrea' });
    await P.renderProspectsTable();
    eq('react: closed=true while searching', mounts[2] && mounts[2].closed, true);

    // ── Filter button badge counts the toggle ───────────────────────────────
    let badge = '';
    $('prospect-filter-btn').insertAdjacentHTML = (_pos, html) => { badge = html; };
    setUi({ showClosed: true });
    P.updateProspectFilterBadge();
    ok('badge counts Show Unable to Serve / Dropped (F)', />1</.test(badge), badge);

    // ── BFF: /api/prospects maps closed → p_include_closed ──────────────────
    process.env.SUPABASE_SECRET_KEY = 'test-secret';
    const rpcBodies = [];
    global.fetch = async (url, opts = {}) => {
        if (url.includes('/auth/v1/user')) return { ok: true, status: 200, json: async () => ({ id: 'auth-1' }) };
        if (url.includes('/rpc/bff_visible_agent_ids')) return { ok: true, status: 200, json: async () => [7] };
        if (url.includes('/rpc/prospects_page')) {
            rpcBodies.push(JSON.parse(opts.body));
            return { ok: true, status: 200, json: async () => [{ rows: [], total: 0 }] };
        }
        return { ok: false, status: 404, json: async () => ({}) };
    };
    const { default: handler } = await import(pathToFileURL(path.join(ROOT, 'api', 'prospects.mjs')).href);
    const call = async (query) => {
        const res = { statusCode: 0, setHeader: noop, end: noop };
        await handler({ method: 'GET', query, headers: { authorization: 'Bearer tok' } }, res);
        return res.statusCode;
    };
    eq('bff: 200 with no closed param', await call({}), 200);
    eq('bff: hides by default', rpcBodies[0] && rpcBodies[0].p_include_closed, false);
    await call({ closed: '1' });
    eq('bff: closed=1 shows them', rpcBodies[1] && rpcBodies[1].p_include_closed, true);
    await call({ closed: 'true' });
    eq('bff: closed=true shows them', rpcBodies[2] && rpcBodies[2].p_include_closed, true);
    await call({ closed: '0', q: 'sandrea' });
    eq('bff: closed=0 keeps them hidden (search is handled in the RPC)', rpcBodies[3] && rpcBodies[3].p_include_closed, false);
    eq('bff: the search term still reaches the RPC', rpcBodies[3] && rpcBodies[3].p_search, 'sandrea');
    eq('bff: scope still comes from the server', JSON.stringify(rpcBodies[0] && rpcBodies[0].p_visible_agent_ids), '[7]');

    // ── data.js maps includeClosed → p_include_closed (old callers keep today's behaviour) ──
    const dataSrc = fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8');
    ok('data.js prospectsPage passes p_include_closed (default true)',
        /p_include_closed:\s*opts\.includeClosed \?\? true,/.test(dataSrc));

    console.log(`test-hide-closed-prospects: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
