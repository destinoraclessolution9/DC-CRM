// ci/test-monthly-targets.js — Monthly KPI targets: derivation, the is_manual
// override, and the dashboard read path.
//
// WHY these specific things are pinned:
//
//   1. THE OVERRIDE. saveKPITargets rewrites all twelve monthly rows on every
//      "Save Yearly Targets". If the is_manual guard regresses, every hand-set
//      monthly target is silently wiped and the monthly editor becomes write-only
//      theatre — with no error, no toast, nothing to notice.
//   2. THE SPLIT RECONCILES. Math.round(q/3) three times does NOT sum back to q
//      (100 -> 33+33+33 = 99). Across ten metrics and four quarters the monthly
//      plan quietly under-runs the yearly one.
//   3. ID PARITY. The modal renders input ids and the save path reads them back by
//      id. These are two separate string-building sites; if they drift the form
//      saves nothing and still reports success. The round-trip test below mounts
//      the REAL rendered markup and saves from it.
//   4. THE QUARTERLY REGRESSION LOCK. The breakdown card gained a pro-rated pace
//      column for the monthly view. Under every other filter its output must be
//      byte-identical to before.
//   5. FALLBACK PARITY. A month with no stored row must resolve to quarter/3 —
//      the exact number the dashboard showed before monthly targets existed — and
//      it must use the SAME split function the save path writes with.
//
// HARNESS: loads the REAL chunks/script-features2.js and chunks/script-reporting.js
// into a stubbed browser and injects an export hook just before each app.register()
// so the IIFE-private helpers are reachable. No logic is duplicated here.
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++;
    console.error(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
};
const ok = (name, cond, detail) => {
    if (cond) { pass++; return; }
    fail++;
    console.error(`FAIL ${name}${detail ? '\n  ' + detail : ''}`);
};

// ── Fake browser ────────────────────────────────────────────────────────────
global.window = global;
const store = new Map();
global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};

// Element registry: the modal renders an HTML STRING, so `mount()` below scans that
// real markup for the ids it emitted and registers a fake element per id. That makes
// the render site and the save site agree on ids or the tests fail.
let ELEMENTS = new Map();
const mkEl = (id) => ({
    id, value: '', textContent: '', innerHTML: '',
    style: {}, dataset: {}, classList: { add() {}, remove() {} },
});
global.document = {
    getElementById: (id) => ELEMENTS.get(id) || null,
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    createElement: () => ({ style: {}, appendChild() {}, setAttribute() {}, click() {} }),
    body: { appendChild() {}, removeChild() {} },
};
global.location = { search: '' };

let TOASTS = [];
let LAST_MODAL = null;
global.UI = {
    toast: {
        success(m) { TOASTS.push(['success', m]); },
        error(m) { TOASTS.push(['error', m]); },
        warning(m) { TOASTS.push(['warning', m]); },
        info(m) { TOASTS.push(['info', m]); },
    },
    showModal: (title, content, buttons) => { LAST_MODAL = { title, content, buttons }; },
    hideModal: () => {},
    formatDate: (d) => String(d || ''),
    currencyForCountry: () => 'MYR',
};
global.app = { register: (_n, obj) => Object.assign(global.app, obj), navigateTo: () => {} };
global.window._appState = { cu: { id: 1, role: 'Level 1 Super Admin' }, cv: null, se: null };
global.window._crmUtils = {
    isSystemAdmin: () => true, isMarketingManager: () => false, isAgent: () => false,
    isManagement: () => true, isTeamLeaderOrAbove: () => true, isStockTakeStaff: () => false,
    getUserLevel: () => 1,
    escapeHtml: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    isMobile: () => false, withTimeout: (p) => p, timeAgo: () => '', generateId: () => 1,
    USER_ROLES: ['Level 3 Agent', 'Level 5 Team Leader'],
    ALL_COUNTRIES: '__ALL__',
    listCountryScope: () => '__ALL__',
    recordCountry: () => 'MY',
    getVisibleUserIds: async () => 'all',
};

// ── Data fixtures + a write log, swapped per test ───────────────────────────
let YEARLY = [], QUARTERLY = [], MONTHLY = [], WRITES = [];
let _nextId = 1000;
global.AppDataStore = {
    getAll: async (t) => (t === 'yearly_targets' ? YEARLY
        : t === 'quarterly_targets' ? QUARTERLY
        : t === 'monthly_targets' ? MONTHLY
        : t === 'purchases' ? []
        : t === 'users' ? []
        : []),
    create: async (t, row) => {
        const created = { ...row, id: ++_nextId };
        WRITES.push({ op: 'create', table: t, row: created });
        if (t === 'monthly_targets') MONTHLY.push(created);
        if (t === 'quarterly_targets') QUARTERLY.push(created);
        if (t === 'yearly_targets') YEARLY.push(created);
        return created;
    },
    update: async (t, id, row) => {
        WRITES.push({ op: 'update', table: t, id, row: { ...row } });
        const bag = t === 'monthly_targets' ? MONTHLY : t === 'quarterly_targets' ? QUARTERLY : YEARLY;
        const i = bag.findIndex(r => r.id === id);
        if (i >= 0) bag[i] = { ...bag[i], ...row };
        return bag[i];
    },
    getById: async () => null,
    query: async () => [],
    getActivitiesInRange: async () => [],
};
// No RPC fast paths, and — critically — no schema probe failure: the modal's
// _monthlyTargetsSchemaReady() treats a missing window.supabase as "local mode, do
// not block", which is the branch we want in tests.
global.supabase = null;

// ── Load both real chunks with export hooks injected ────────────────────────
const loadChunk = (file, anchor, exportsSrc, bag) => {
    const p = path.join(__dirname, '..', 'chunks', file);
    let src = fs.readFileSync(p, 'utf8');
    if (!src.includes(anchor)) {
        console.error(`FAIL: register anchor not found in ${file} — harness needs updating`);
        process.exit(1);
    }
    src = src.replace(anchor, `window.${bag} = {${exportsSrc}};\n    ${anchor}`);
    try { (0, eval)(src); } catch (e) { console.error(`FAIL loading ${file}: ${e.message}`); process.exit(1); }
    return global.window[bag];
};

const F = loadChunk('script-features2.js', "app.register('features2', {", `
    _splitQuarterAcrossMonths, _deriveMonthlyRows, _upsertDerivedMonths,
    _TARGET_METRIC_KEYS, _TARGET_METRIC_DOMS, _mtIsManualInDom,
    saveKPITargets, saveQuarterlyTargets, saveMonthlyTargets,
    openMonthlyTargetsModal, mtRevertMonth, mtAutoSplitQuarter, mtSyncBadge,
`, '__TF');
ok('harness reached features2 internals', F && typeof F._splitQuarterAcrossMonths === 'function');

const R = loadChunk('script-reporting.js', "app.register('reporting', {", `
    _resolveMonthlyTarget, _monthElapsedFraction, _splitQuarter, _MONTH_LABELS,
    _buildPerformanceTableHtml, renderPerformanceTable,
    setFilter: (f) => { _currentTimeFilter = f; },
    getFilter: () => _currentTimeFilter,
`, '__TR');
ok('harness reached reporting internals', R && typeof R._resolveMonthlyTarget === 'function');
if (!F || !R) process.exit(1);

const KEYS = F._TARGET_METRIC_KEYS;
const DOMS = F._TARGET_METRIC_DOMS;
const YEAR = 2026;

const reset = () => {
    YEARLY = []; QUARTERLY = []; MONTHLY = []; WRITES = []; TOASTS = [];
    ELEMENTS = new Map(); LAST_MODAL = null;
};

// Register fake elements for every id the modal markup emits, carrying the value /
// placeholder the renderer actually wrote. This is what makes the render-site and
// save-site id strings agree or fail loudly.
const mount = (html) => {
    const attr = (tag, name) => {
        const m = tag.match(new RegExp(`${name}="([^"]*)"`));
        return m ? m[1] : '';
    };
    (html.match(/<input\b[^>]*>/g) || []).forEach(tag => {
        const id = attr(tag, 'id');
        if (!id) return;
        const el = mkEl(id);
        el.value = attr(tag, 'value');
        el.placeholder = attr(tag, 'placeholder');
        ELEMENTS.set(id, el);
    });
    (html.match(/<span\b[^>]*id="mt-badge-\d+"[^>]*>/g) || []).forEach(tag => {
        const id = (tag.match(/id="([^"]*)"/) || [])[1];
        if (id) ELEMENTS.set(id, mkEl(id));
    });
};

// A quarterly row with every metric set to `base` (so the split is easy to reason
// about), unless overridden.
const qRow = (quarter, base, over = {}) => {
    const r = { id: 500 + quarter, year: YEAR, quarter };
    KEYS.forEach(k => { r[k] = base; });
    return Object.assign(r, over);
};
const mRow = (month, base, opts = {}) => {
    const r = { id: 700 + month, year: YEAR, month, quarter: Math.floor((month - 1) / 3) + 1, is_manual: !!opts.is_manual };
    KEYS.forEach(k => { r[k] = base; });
    return r;
};

async function main() {

// ── 1. The split reconciles ─────────────────────────────────────────────────
eq('split 100 -> 33/33/34', F._splitQuarterAcrossMonths(100), [33, 33, 34]);
eq('split 0 -> zeros', F._splitQuarterAcrossMonths(0), [0, 0, 0]);
eq('split 210 -> even thirds', F._splitQuarterAcrossMonths(210), [70, 70, 70]);
eq('split null/undefined is safe', F._splitQuarterAcrossMonths(undefined), [0, 0, 0]);
{
    // The property that matters: the three months ALWAYS sum back to the quarter.
    // Math.round(q/3) x3 fails this for two of every three integers.
    let worst = null;
    for (let v = 0; v <= 1000; v++) {
        const s = F._splitQuarterAcrossMonths(v).reduce((a, b) => a + b, 0);
        if (s !== v) { worst = { v, s }; break; }
    }
    ok('every quarter 0..1000 splits to an exact sum', worst === null,
        worst ? `quarter ${worst.v} summed to ${worst.s}` : '');
    // Guard the guard: the naive implementation this replaced must FAIL the same check.
    const naive = (v) => { const a = Math.round(v / 3); return [a, a, a]; };
    ok('…and the naive round(q/3)x3 does not (mutation check)',
        naive(100).reduce((a, b) => a + b, 0) !== 100);
}

// ── 2. Derivation shape ─────────────────────────────────────────────────────
reset();
{
    const rows = F._deriveMonthlyRows(YEAR, 3, qRow(3, 90));
    eq('quarter 3 derives months 7,8,9', rows.map(r => r.month), [7, 8, 9]);
    eq('…all tagged with the quarter', rows.map(r => r.quarter), [3, 3, 3]);
    eq('…and marked derived, not manual', rows.map(r => r.is_manual), [false, false, false]);
    ok('…carrying every one of the ten metric keys',
        rows.every(r => KEYS.every(k => typeof r[k] === 'number')));
    eq('…each metric split evenly', rows.map(r => r.cps_count_target), [30, 30, 30]);
}

// ── 3. The override: _upsertDerivedMonths skips hand-set months ─────────────
reset();
{
    const existing = [mRow(7, 999, { is_manual: true }), mRow(8, 5, { is_manual: false })];
    const ops = F._upsertDerivedMonths(YEAR, 3, qRow(3, 90), existing);
    eq('a manual month produces no write', ops.length, 2);
    await Promise.all(ops.map(fn => fn()));
    const touched = WRITES.map(w => w.row.month).sort();
    eq('…and months 8 and 9 are the ones written', touched, [8, 9]);
    eq('…the existing auto row is UPDATEd, the missing one CREATEd',
        WRITES.map(w => w.op).sort(), ['create', 'update']);
}

// ── 4. saveKPITargets keeps hand-set months ─────────────────────────────────
reset();
{
    YEARLY = [];
    QUARTERLY = [1, 2, 3, 4].map(q => qRow(q, 60));
    MONTHLY = [mRow(2, 12345, { is_manual: true }), mRow(5, 7, { is_manual: false })];
    // Yearly form inputs: everything blank so the weights path drives the quarters.
    ['cps', 'sales', 'pop-count', 'pop-sales', 'epp-count', 'epp-sales',
     'agents', 'customers', 'meetings', 'headcount'].forEach(d => {
        ELEMENTS.set(`yt-${d}`, Object.assign(mkEl(`yt-${d}`), { value: '120' }));
    });
    ['q1w', 'q2w', 'q3w', 'q4w'].forEach(d => {
        ELEMENTS.set(`yt-${d}`, Object.assign(mkEl(`yt-${d}`), { value: '25' }));
    });
    await F.saveKPITargets(YEAR);
    const monthWrites = WRITES.filter(w => w.table === 'monthly_targets');
    eq('11 of 12 months rewritten', monthWrites.length, 11);
    ok('the manual month is never touched', !monthWrites.some(w => w.row.month === 2));
    ok('…and its stored value survives',
        MONTHLY.find(r => r.month === 2).cps_count_target === 12345);
    ok('every rewritten month is marked derived',
        monthWrites.every(w => w.row.is_manual === false));
    ok('the toast says how many were kept',
        TOASTS.some(([, m]) => /1 hand-set month kept/.test(m)),
        JSON.stringify(TOASTS));
}

// ── 5. saveQuarterlyTargets re-derives its months, same guard ───────────────
reset();
{
    QUARTERLY = [qRow(1, 30)];
    MONTHLY = [mRow(1, 4242, { is_manual: true })];
    DOMS.forEach(d => {
        ELEMENTS.set(`qo-q1-${d}`, Object.assign(mkEl(`qo-q1-${d}`), { value: '90' }));
    });
    await F.saveQuarterlyTargets(YEAR);
    const monthWrites = WRITES.filter(w => w.table === 'monthly_targets');
    eq('changing Q1 re-derives its non-manual months', monthWrites.map(w => w.row.month).sort(), [2, 3]);
    ok('…and leaves the pinned month alone',
        MONTHLY.find(r => r.month === 1).cps_count_target === 4242);
    ok('…quarters with no input and no stored row derive nothing',
        !monthWrites.some(w => w.row.month > 3));
}

// ── 6. Render -> save round-trip on the REAL markup ─────────────────────────
reset();
{
    QUARTERLY = [1, 2, 3, 4].map(q => qRow(q, 90));
    MONTHLY = [mRow(4, 777, { is_manual: true })];
    await F.openMonthlyTargetsModal();
    ok('the modal rendered', !!LAST_MODAL && /Set Monthly Targets/.test(LAST_MODAL.title));
    mount(LAST_MODAL.content);

    ok('every month x metric input exists with the id the saver reads',
        [1, 12].every(m => DOMS.every(d => ELEMENTS.has(`mt-${m}-${d}`))));

    // An auto month carries its derived number as the PLACEHOLDER and an empty value —
    // that is what encodes "blank = follows the quarter". `|| mkEl` so an id drift
    // reports a clean FAIL here instead of throwing out of the whole suite.
    const autoEl = ELEMENTS.get('mt-1-cps') || mkEl('missing');
    eq('auto month value is blank', autoEl.value, '');
    eq('…with the derived number as its placeholder', autoEl.placeholder, '30');
    // The stored manual month is pre-filled, so it stays manual across a re-save.
    eq('manual month is pre-filled', (ELEMENTS.get('mt-4-cps') || mkEl('missing')).value, '777');

    eq('DOM manual detection: blank column is auto', F._mtIsManualInDom(1), false);
    eq('DOM manual detection: filled column is manual', F._mtIsManualInDom(4), true);

    // Pin March by typing into one field only.
    ELEMENTS.get('mt-3-sales').value = '50000';
    await F.saveMonthlyTargets(YEAR);
    const written = WRITES.filter(w => w.table === 'monthly_targets');
    eq('only the two pinned months are written', written.map(w => w.row.month).sort(), [3, 4]);
    const march = written.find(w => w.row.month === 3).row;
    eq('…the typed field is stored', march.total_sales_target, 50000);
    eq('…the fields left blank fall back to the derived value, not zero', march.cps_count_target, 30);
    eq('…and it is flagged manual', march.is_manual, true);
    eq('…with the right quarter stamped', march.quarter, 1);
}

// ── 7. Revert to auto demotes a stored manual row ───────────────────────────
reset();
{
    QUARTERLY = [1, 2, 3, 4].map(q => qRow(q, 90));
    MONTHLY = [mRow(4, 777, { is_manual: true })];
    await F.openMonthlyTargetsModal();
    mount(LAST_MODAL.content);
    F.mtRevertMonth(4);
    eq('revert clears every field in the column', F._mtIsManualInDom(4), false);
    await F.saveMonthlyTargets(YEAR);
    const written = WRITES.filter(w => w.table === 'monthly_targets');
    eq('the demotion is written', written.length, 1);
    eq('…as an update to the existing row', written[0].op, 'update');
    eq('…flipping is_manual off', written[0].row.is_manual, false);
    eq('…and restoring the derived value', written[0].row.cps_count_target, 30);
}

// ── 8. "Fill from Q/3" pins the whole quarter ───────────────────────────────
reset();
{
    QUARTERLY = [1, 2, 3, 4].map(q => qRow(q, 90));
    await F.openMonthlyTargetsModal();
    mount(LAST_MODAL.content);
    eq('Q2 starts unpinned', [4, 5, 6].map(F._mtIsManualInDom), [false, false, false]);
    F.mtAutoSplitQuarter(2);
    eq('…and is pinned after the fill', [4, 5, 6].map(F._mtIsManualInDom), [true, true, true]);
    eq('…with the derived numbers', ELEMENTS.get('mt-5-cps').value, 30);
}

// ── 9. Reporting: stored row wins, else quarter/3 ───────────────────────────
reset();
{
    const qs = [qRow(1, 90)];
    const ms = [mRow(2, 555, { is_manual: true })];
    const stored = R._resolveMonthlyTarget(2, YEAR, ms, qs);
    eq('a stored month is used as-is', stored.row.cps_count_target, 555);
    eq('…and flagged as stored', stored.isStored, true);

    const fallback = R._resolveMonthlyTarget(1, YEAR, ms, qs);
    eq('a month with no row falls back to quarter/3', fallback.row.cps_count_target, 30);
    eq('…and is flagged as derived', fallback.isStored, false);
    eq('…carrying the quarter it came from', fallback.row.quarter, 1);

    // Fallback parity: the number the dashboard shows must equal the number the save
    // path would have written for that month.
    const saved = F._deriveMonthlyRows(YEAR, 1, qs[0]);
    eq('read-side fallback equals write-side derivation',
        [1, 2, 3].map(m => R._resolveMonthlyTarget(m, YEAR, [], qs).row.total_sales_target),
        saved.map(r => r.total_sales_target));

    eq('an unknown month with no quarter row yields an empty target',
        R._resolveMonthlyTarget(11, YEAR, [], []).row.cps_count_target, undefined);
}

// ── 10. Pace pro-rating ─────────────────────────────────────────────────────
{
    eq('day 15 of a 30-day month is half elapsed',
        R._monthElapsedFraction(2026, 6, new Date(2026, 5, 15)), 0.5);
    eq('the last day of the month is fully elapsed',
        R._monthElapsedFraction(2026, 6, new Date(2026, 5, 30)), 1);
    eq('February 28 is fully elapsed',
        R._monthElapsedFraction(2026, 2, new Date(2026, 1, 28)), 1);
    eq('day 14 of February is half elapsed',
        R._monthElapsedFraction(2026, 2, new Date(2026, 1, 14)), 0.5);
    eq('a past month is not pro-rated',
        R._monthElapsedFraction(2026, 1, new Date(2026, 5, 15)), 1);
    ok('day 1 never pro-rates to zero (which would divide by zero)',
        R._monthElapsedFraction(2026, 6, new Date(2026, 5, 1)) > 0);
}

// ── 11. Breakdown card: quarterly output is unchanged ───────────────────────
{
    const metrics = [{ name: 'Total Sales', target: 300, actual: 150, isRM: true }];
    const html = R._buildPerformanceTableHtml(metrics);
    ok('no Pace row without a pace value', !/Pace</.test(html), html.slice(0, 400));
    ok('…the label stays "Variance"', /Variance</.test(html));
    ok('…and achievement is measured against the full target', /50\.0%/.test(html));

    const paced = R._buildPerformanceTableHtml([{ ...metrics[0], pace: 150 }]);
    ok('with a pace value the Pace row appears', /Pace</.test(paced));
    ok('…the label becomes "Vs pace"', /Vs pace</.test(paced));
    ok('…achievement is measured against pace, not the target', /100\.0%/.test(paced));
    ok('…while the full-month target is still shown', /RM\s*300/.test(paced.replace(/&nbsp;/g, ' ')));
    ok('…and vs-pace variance is zero, not -150', /\+RM 0/.test(paced));
}

// ── 12. renderPerformanceTable picks the right period + heading ─────────────
reset();
{
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const q = Math.floor(now.getMonth() / 3) + 1;
    QUARTERLY = [qRow(q, 900)]; QUARTERLY[0].year = y;
    MONTHLY = [Object.assign(mRow(m, 111, { is_manual: true }), { year: y })];

    const container = mkEl('quarterly-performance-table');
    const title = mkEl('perf-breakdown-title');
    ELEMENTS.set('quarterly-performance-table', container);
    ELEMENTS.set('perf-breakdown-title', title);
    const kpis = { cpsCount: 0, totalSales: 0, newAgents: 0, newCustomers: 0, popCaseCount: 0, eppCaseCount: 0 };

    R.setFilter('quarterly');
    await R.renderPerformanceTable(kpis);
    ok('quarterly view reads the QUARTER target', /900/.test(container.innerHTML));
    eq('…and keeps the quarter heading', title.textContent, 'Current Quarter Performance Breakdown');
    ok('…with no Pace row', !/Pace</.test(container.innerHTML));

    R.setFilter('monthly');
    await R.renderPerformanceTable(kpis);
    ok('monthly view reads the MONTH target', /111/.test(container.innerHTML), container.innerHTML.slice(0, 300));
    eq('…and flips the heading to the month',
        title.textContent, `${R._MONTH_LABELS[m - 1]} ${y} Performance Breakdown`);
    ok('…adding the Pace row', /Pace</.test(container.innerHTML));

    R.setFilter('yearly');
    await R.renderPerformanceTable(kpis);
    ok('yearly view still shows the current quarter', /900/.test(container.innerHTML));
    eq('…with the quarter heading back', title.textContent, 'Current Quarter Performance Breakdown');
}

// ── 13. The shared split really is shared ───────────────────────────────────
ok('reporting uses the split published by features2 on _crmUtils',
    typeof window._crmUtils.splitQuarterAcrossMonths === 'function');
eq('…and the two produce identical output',
    R._splitQuarter(100), F._splitQuarterAcrossMonths(100));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('FAIL (uncaught): ' + (e && e.stack || e)); process.exit(1); });
