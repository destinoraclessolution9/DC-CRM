// ci/test-mobile-prospects-parity.js — mobile Clients list vs the desktop table.
//
// WHY: the mobile Prospects list and the desktop Prospects table are two
// INDEPENDENT data paths over the same table — desktop goes through the
// prospects_page RPC (server-side), mobile through AppDataStore.getAll +
// client-side filters. On 2026-08-06 they disagreed on the very same Ming Gua
// filter (54 vs 65) because only the RPC applied the active-prospect rule
// `coalesce(status,'') not in ('converted','lost')`, so people who had already
// been converted to customers were still listed as prospects on the phone.
// They also disagreed on ORDER (RPC: score desc, id desc — mobile: hardcoded
// updated_at desc) and mobile hard-capped the render at 60 rows with no way to
// reach row 61+.
//
// These tests drive the REAL _mpRenderList from chunks/script-mobile.js against
// fixtures and assert on the HTML it paints, so any of the three regressions
// re-appearing fails here rather than on a salesperson's phone.
//
// HARNESS: same eval-the-real-chunk technique as ci/test-whatsapp-list-icon.js —
// an export line is appended INSIDE the chunk's closing IIFE so private bindings
// become reachable without exporting them in production.
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
const eq = (name, got, want) => ok(name, got === want, `got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);

// ── Fake browser ────────────────────────────────────────────────────────────
global.window = global;
global.self = global;
const noop = () => {};
const asyncNoop = async () => {};

const _ls = new Map();
global.localStorage = {
    getItem: (k) => (_ls.has(k) ? _ls.get(k) : null),
    setItem: (k, v) => _ls.set(k, String(v)),
    removeItem: (k) => _ls.delete(k),
    get length() { return _ls.size; },
    key: (i) => Array.from(_ls.keys())[i] ?? null,
};

// The list host: captures whatever _mpRenderList paints.
const listHost = { innerHTML: '' };
// Filter-sheet inputs, read by mpApplyFilters via getElementById.
const sheet = {
    'mpf-sort': { value: '' }, 'mpf-status': { value: '' }, 'mpf-agent': { value: '' },
    'mpf-minggua': { value: '' }, 'mpf-score-min': { value: '' }, 'mpf-score-max': { value: '' },
    'mpf-pipeline': { value: '' },
};
const setSheet = (patch) => {
    for (const k of Object.keys(sheet)) sheet[k].value = '';
    for (const [k, v] of Object.entries(patch)) sheet[`mpf-${k}`].value = v;
};

global.document = {
    getElementById: (id) => (id === 'mp-list' ? listHost : (sheet[id] || null)),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add: noop, remove: noop }, appendChild: noop }),
    addEventListener: noop,
    removeEventListener: noop,
    body: { appendChild: noop, classList: { add: noop, remove: noop } },
    documentElement: { style: { setProperty: noop } },
};
Object.defineProperty(global, 'navigator', {
    value: { userAgent: 'node', onLine: true }, configurable: true, writable: true,
});
global.location = { search: '', href: 'http://localhost/', hash: '' };
global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
global.innerWidth = 390;
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
    isMobile: () => true,
    getVisibleUserIds: async () => 'all',
    isSystemAdmin: () => true,
    getUserLevel: () => 1,
    waPhone: (p) => String(p || '').replace(/\D/g, ''),
    openWaChat: noop,
    debounce: (fn) => fn,
    debounceCall: (k, fn) => fn(),
};
window.app = new Proxy({}, { get: () => noop });
window.UI = {
    toast: { success: noop, error: noop, info: noop },
    showModal: noop, hideModal: noop,
    escJsAttr: (s) => String(s || '').replace(/'/g, "\\'"),
    money: (n) => 'RM ' + n,
};
global.UI = window.UI;
window.Auth = { getCurrentUser: asyncNoop };
window._loadChunk = asyncNoop;
window.Perf = { debounce: (fn) => fn };

// ── Fixtures ────────────────────────────────────────────────────────────────
// 70 MG8 prospects so the 60-row page boundary is actually exercised:
//   ids 1001..1070, score 0 (mirrors production, where the whole MG8 set scores
//   0 and the sort therefore collapses onto its tiebreak), updated_at ASCENDING
//   with id so score-desc and recent-desc produce OPPOSITE orders.
// Statuses: 1001 converted, 1002 lost, 1003 NULL (never classified), rest active.
const PROSPECTS = Array.from({ length: 70 }, (_, i) => {
    const id = 1001 + i;
    return {
        id,
        full_name: `P${String(i).padStart(2, '0')}`,
        phone: `01100000${String(i).padStart(2, '0')}`,
        ming_gua: 'MG8',
        score: 0,
        status: id === 1001 ? 'converted' : id === 1002 ? 'lost' : id === 1003 ? null : 'active',
        responsible_agent_id: 7,
        updated_at: `2026-06-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
        last_activity_date: `2026-05-${String((i % 28) + 1).padStart(2, '0')}`,
    };
});
// A scored MG1 set to prove score sorting is real and not just the id tiebreak.
const SCORED = [
    { id: 2001, full_name: 'Low',  ming_gua: 'MG1', score: 10,  status: 'active', responsible_agent_id: 7, updated_at: '2026-07-03T00:00:00Z' },
    { id: 2002, full_name: 'High', ming_gua: 'MG1', score: 900, status: 'active', responsible_agent_id: 7, updated_at: '2026-07-01T00:00:00Z' },
    { id: 2003, full_name: 'Mid',  ming_gua: 'MG1', score: 400, status: 'active', responsible_agent_id: 7, updated_at: '2026-07-02T00:00:00Z' },
];
const ALL = [...PROSPECTS, ...SCORED];

window.AppDataStore = {
    getAll: async (table) => {
        if (table === 'prospects') return ALL.map(r => ({ ...r }));
        if (table === 'users') return [{ id: 7, full_name: 'Agent Seven', agent_code: 'A7' }];
        return [];
    },
    searchProspects: async () => [],
    searchCustomers: async () => [],
};
global.AppDataStore = window.AppDataStore;

// ── Load the real chunk ─────────────────────────────────────────────────────
function loadChunk(file, names) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const close = src.lastIndexOf('})();');
    if (close === -1) throw new Error(`${file}: no trailing IIFE close found`);
    const key = `__T_${path.basename(file, '.js').replace(/\W/g, '_')}`;
    const patched = src.slice(0, close) + `\n;window.${key} = { ${names.join(', ')} };\n` + src.slice(close);
    eval(patched);
    return window[key];
}
const M = loadChunk('chunks/script-mobile.js',
    ['_mpRenderList', 'mpApplyFilters', 'mpClearFilters', 'mpLoadMore']);

// Names of the cards currently painted, in render order.
// NOTE: the class must be anchored — a loose `mp-card-name[^"]*` also matches
// the `mp-card-name-row` wrapper and silently doubles every count.
const rendered = () =>
    [...listHost.innerHTML.matchAll(/class="mp-card-name(?: name-unable)?">([^<]*)</g)].map(m => m[1]);
const cardCount = () => rendered().length;
const loadMore = () => {
    const m = listHost.innerHTML.match(/class="mp-load-more"[^>]*>Load more <span>(\d+) of (\d+)</);
    return m ? { shown: Number(m[1]), total: Number(m[2]) } : null;
};
const apply = async (patch) => { setSheet(patch); await M.mpApplyFilters(); };

(async () => {
    // ── 1. Active-prospect parity: converted + lost are gone ────────────────
    await apply({ minggua: 'MG8' });
    eq('MG8 total matches the RPC rule (70 − converted − lost)', loadMore().total, 68);
    // P00/P01/P02 are the LOWEST ids, so under the default id-desc tiebreak they
    // land on page 2 — reveal everything before asserting presence/absence, or
    // these checks pass for the wrong reason.
    await M.mpLoadMore();
    const names = rendered();
    eq('every surviving row is painted', names.length, 68);
    ok('converted prospect is NOT listed', !names.includes('P00'), `rendered tail: ${names.slice(-5)}`);
    ok('lost prospect is NOT listed', !names.includes('P01'));
    ok('NULL-status prospect IS kept (never classified)', names.includes('P02'));

    // The gap is EXACTLY the closed rows — nothing else got dropped.
    await M.mpClearFilters();
    const unfilteredTotal = loadMore().total;
    eq('unfiltered list drops exactly the 2 closed rows', unfilteredTotal, ALL.length - 2);

    // ── 2. …unless the user explicitly asks for them ────────────────────────
    await apply({ minggua: 'MG8', status: 'converted' });
    eq('Status → Converted still surfaces converted rows', cardCount(), 1);
    eq('…and it is the converted one', rendered()[0], 'P00');
    await apply({ minggua: 'MG8', status: 'lost' });
    eq('Status → Lost still surfaces lost rows', rendered().join(','), 'P01');

    // ── 3. Sort: default is desktop's Score (High → Low) ────────────────────
    await apply({ minggua: 'MG1' });
    eq('default sort = score desc (desktop parity)', rendered().join(','), 'High,Mid,Low');
    await apply({ minggua: 'MG1', sort: 'score_asc' });
    eq('score_asc', rendered().join(','), 'Low,Mid,High');
    await apply({ minggua: 'MG1', sort: 'name_asc' });
    eq('name_asc', rendered().join(','), 'High,Low,Mid');
    await apply({ minggua: 'MG1', sort: 'name_desc' });
    eq('name_desc', rendered().join(','), 'Mid,Low,High');
    await apply({ minggua: 'MG1', sort: 'recent_desc' });
    eq('recent_desc = the old hardcoded order, now opt-in', rendered().join(','), 'Low,Mid,High');

    // All-zero scores must fall back to the RPC's `id desc` tiebreak, NOT to
    // updated_at — this is the case that made the two lists look unrelated.
    await apply({ minggua: 'MG8' });
    eq('zero-score tiebreak is id desc (highest id first)', rendered()[0], 'P69');
    await apply({ minggua: 'MG8', sort: 'recent_desc' });
    ok('recent_desc genuinely differs from the id tiebreak', rendered()[0] !== 'P69',
       `first card: ${rendered()[0]}`);

    // ── 4. Pagination replaces the hard cap ─────────────────────────────────
    await apply({ minggua: 'MG8' });
    eq('page 1 paints 60 cards', cardCount(), 60);
    eq('load-more button reports 60 of 68', JSON.stringify(loadMore()), JSON.stringify({ shown: 60, total: 68 }));
    await M.mpLoadMore();
    eq('page 2 reveals the remaining rows', cardCount(), 68);
    ok('load-more button is gone once everything is shown', loadMore() === null);
    ok('row 61+ is genuinely reachable now', rendered().includes('P02'));

    // A filter change must restart paging, or a narrowed list would inherit
    // page 3 and paint every row at once.
    await M.mpLoadMore();
    await apply({ minggua: 'MG8' });
    eq('changing filters resets to page 1', cardCount(), 60);

    // ── 5. Snapshot hygiene ─────────────────────────────────────────────────
    // A multi-page render must NOT be cached: _mpPage resets to 1 on view entry,
    // so a restored 120-card snapshot would SHRINK on the next Load-more tap.
    _ls.clear();
    await M.mpClearFilters();
    ok('page-1 render is cached', _ls.has('mp-list-snap-v4-prospects'));
    _ls.clear();
    await M.mpLoadMore();
    ok('multi-page render is NOT cached', !_ls.has('mp-list-snap-v4-prospects'));

    // `MP_DUMP=1 node ci/test-mobile-prospects-parity.js > list.html` emits the
    // real chunk-rendered cards + Load-more button so the new .mp-load-more
    // styling can be eyeballed against the live stylesheet without a session.
    if (process.env.MP_DUMP) {
        await apply({ minggua: 'MG8' });
        // styles-fixed.css first: it carries the global `* { box-sizing:
        // border-box }` reset the app always has. Without it .mp-card (a div)
        // measures content-box while .mp-load-more (a button) measures
        // border-box, and the preview shows a 32px width mismatch that does not
        // exist in the app.
        console.log(`<link rel="stylesheet" href="../styles-fixed.css">
<link rel="stylesheet" href="../styles-login-v2.css">
<style>body{margin:0;background:#efe3e5;font-family:system-ui,sans-serif;}
  .phone{width:390px;margin:0 auto;padding:16px;background:#fdf5f6;min-height:100vh;}</style>
<div class="phone"><div class="mp"><div class="mp-list">${listHost.innerHTML}</div></div></div>
<script>
// Harness-only: every .mp-* rule lives inside @media (max-width:768px) and this
// page is viewed in a pane that can't be narrowed that far, so re-emit those
// rules unconditionally. Purely a preview aid — ships nowhere.
(() => {
  const flat = [];
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
    for (const rule of rules) {
      if (rule.media && String(rule.conditionText || '').includes('768px')) {
        for (const r of rule.cssRules) flat.push(r.cssText);
      }
    }
  }
  const s = document.createElement('style');
  s.textContent = flat.join('\\n');
  document.head.appendChild(s);
})();
<\/script>`);
        process.exit(fail ? 1 : 0);
    }

    console.log(`test-mobile-prospects-parity: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
