// ci/test-boss-report-cross-month.js — Boss Report Wholesales block across a month-end.
//
// WHY: the Month column, the Target and the "(October 2026)" title were all
// keyed on TODAY. The report made on Monday 2 Nov from Saturday's 31/10 egg run
// printed "(November 2026)", a Month total of only November's runs (0) and
// November's targets — October's final number, the one management asks for,
// was gone. They now follow the SELECTED RUN's month.
//
// Pinned here (fixture = the owner's real October 2026 numbers, 2026-11-02):
//   1. 2 Nov + the 31/10 run → October title, October month-to-date, October targets.
//   2. 9 Nov + the 7/11 run → November (a normal new-month report).
//   3. A week committed again after month-end (a correction on 2 Nov of the
//      31/10 week) stays in October and replaces that week's numbers — it is not
//      counted a second time in November.
//   4. The Monthly Targets card still edits TODAY's month (set November's
//      targets on the 1st), and the Report Format preview follows the newest run.
//
// HARNESS: same approach as test-boss-report-builder.js — eval the REAL chunk in
// a stubbed browser, with a clock the test moves between days.
'use strict';
process.env.TZ = 'Asia/Kuala_Lumpur';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
    const g = typeof got === 'string' ? got : JSON.stringify(got);
    const w = typeof want === 'string' ? want : JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++;
    console.error(`FAIL ${name}\n  got:  ${JSON.stringify(g)}\n  want: ${JSON.stringify(w)}`);
};
const ok = (name, cond, detail) => {
    if (cond) { pass++; return; }
    fail++;
    console.error(`FAIL ${name}${detail ? '\n  ' + detail : ''}`);
};

// ── Movable clock ───────────────────────────────────────────────────────────
const RealDate = Date;
let NOW = 0;
const setToday = (iso) => { NOW = new RealDate(iso).getTime(); };
global.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(NOW); }
    static now() { return NOW; }
};

// ── Fake browser ────────────────────────────────────────────────────────────
class El {
    constructor(id) { this.id = id; this.value = ''; this.textContent = ''; this.innerHTML = ''; this.style = {}; this.checked = false; }
    scrollIntoView() {}
    querySelectorAll() { return { forEach() {} }; }
    setSelectionRange() {}
    focus() {}
}
const DOM = new Map();
const el = (id) => { if (!DOM.has(id)) DOM.set(id, new El(id)); return DOM.get(id); };
const store = new Map();
global.window = global;
global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};
global.document = { getElementById: (id) => (DOM.has(id) ? DOM.get(id) : null), querySelectorAll: () => [] };
global.location = { search: '' };
try { Object.defineProperty(global, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true }); } catch (_) { /* fine */ }
const toasts = [];
global.UI = {
    toast: { success: (m) => toasts.push(['success', m]), error: (m) => toasts.push(['error', m]), warning: (m) => toasts.push(['warning', m]) },
    showModal: () => {}, hideModal: () => {},
};
global.confirm = () => true;
global.window._appState = { cu: { id: 1, role: 'Level 1 Super Admin' }, cv: null };
global.window._crmUtils = {
    isSystemAdmin: (u) => !!(u && /Level 1\b/.test(u.role || '')),
    isMarketingManager: () => false, isAgent: () => false, isManagement: () => false,
    isTeamLeaderOrAbove: () => false, isStockTakeStaff: () => false,
    escapeHtml: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    isMobile: () => false, withTimeout: (p) => p, timeAgo: () => '', generateId: () => 1,
};
global.app = { register: (_n, obj) => Object.assign(global.app, obj) };
global.window._ensureXlsx = async () => {};

let RUNS = [];
global.AppDataStore = {
    query: async (table, filters) => {
        if (table !== 'egg_run_history') return [];
        if (filters && filters.id) return RUNS.filter(r => r.id === filters.id);
        return RUNS.slice();
    },
};

// Supabase stub that honours .eq() — the targets are per month_key, and the
// whole point is WHICH month's row the report reads.
const writes = { upsert: {} };
const fakeSb = (db) => ({
    from: (table) => {
        const absent = !(table in db);
        const chain = (filters) => {
            const rows = absent ? null : db[table].filter(r => filters.every(([c, v]) => r[c] === v));
            const p = Promise.resolve(absent
                ? { data: null, error: { message: `Could not find the table 'public.${table}'`, code: 'PGRST205' } }
                : { data: JSON.parse(JSON.stringify(rows)), error: null });
            p.order = () => chain(filters); p.limit = () => chain(filters);
            p.eq = (c, v) => chain(filters.concat([[c, v]]));
            return p;
        };
        return {
            select: () => chain([]),
            upsert: async (rows) => { (writes.upsert[table] = writes.upsert[table] || []).push(...rows); return { error: absent ? { message: 'absent' } : null }; },
            insert: async () => ({ error: null }),
        };
    },
});

// ── Load the real chunk ─────────────────────────────────────────────────────
const src = fs.readFileSync(path.join(__dirname, '..', 'chunks', 'script-boss-report.js'), 'utf8');
try { (0, eval)(src); } catch (e) { console.error('FAIL loading chunk: ' + e.message); process.exit(1); }
const A = global.app;

// ── Fixtures ────────────────────────────────────────────────────────────────
const WS = [
    { key: 'klKepong', label: 'KL Kepong + SG Puchong & Sunway', source_keys: ['KL Kepong', 'SG Puchong & Sunway'], sort_order: 10, active: true },
    { key: 'klCheras', label: 'KL Cheras', source_keys: ['KL Cheras'], sort_order: 20, active: true },
    { key: 'pgCenter', label: 'PG Center', source_keys: ['PG Center'], sort_order: 30, active: true },
    { key: 'pgMainland', label: 'PG Mainland', source_keys: ['PG Mainland'], sort_order: 40, active: true },
    { key: 'pgSouth', label: 'PG South', source_keys: ['PG South'], sort_order: 50, active: true },
];
// October and November targets differ, so the test can tell which month was read.
const TARGETS = [
    { month_key: '2026_10', group_key: 'klKepong', target: 350 }, { month_key: '2026_10', group_key: 'pgCenter', target: 250 },
    { month_key: '2026_10', group_key: 'pgMainland', target: 450 }, { month_key: '2026_10', group_key: 'pgSouth', target: 300 },
    { month_key: '2026_11', group_key: 'klKepong', target: 360 }, { month_key: '2026_11', group_key: 'pgCenter', target: 260 },
    { month_key: '2026_11', group_key: 'pgMainland', target: 460 }, { month_key: '2026_11', group_key: 'pgSouth', target: 310 },
];
const db = () => ({
    br_product_group: [], br_product_sku: [], br_wholesale_group: WS, br_wholesale_target: TARGETS,
    br_report_history: [],
});

// One committed run per week. [KL Kepong, SG Puchong & Sunway, KL Cheras, PG Center, PG Mainland, PG South]
const run = (id, week, at, n) => ({
    id, week_start_date: week, run_at: at,
    totals: { KL: { KING: 1, GOLD: 1 }, PG: { KING: 1, GOLD: 1 }, JB: { KING: 0, GOLD: 0 },
              by_group: { 'KL Kepong': n[0], 'SG Puchong & Sunway': n[1], 'KL Cheras': n[2],
                          'PG Center': n[3], 'PG Mainland': n[4], 'PG South': n[5] } },
});
const SEP_26 = run(100, '2026-09-21', '2026-09-26T03:00:00.000Z', [99, 99, 99, 99, 99, 99]);
const OCT_RUNS = [
    run(101, '2026-09-28', '2026-10-03T03:00:00.000Z', [50, 34, 9, 43, 70, 50]),
    run(102, '2026-10-05', '2026-10-10T03:00:00.000Z', [40, 27, 4, 39, 77, 35]),
    run(103, '2026-10-12', '2026-10-17T03:00:00.000Z', [45, 25, 8, 40, 90, 40]),
    run(104, '2026-10-19', '2026-10-24T03:00:00.000Z', [44, 25, 9, 40, 88, 38]),
];
// Saturday 31/10 — the week in the report the owner pasted (64 / 9 / 51 / 84 / 48).
const OCT_31 = run(105, '2026-10-26', '2026-10-31T03:00:00.000Z', [40, 24, 9, 51, 84, 48]);
const NOV_07 = run(106, '2026-11-02', '2026-11-07T03:00:00.000Z', [30, 20, 5, 40, 60, 30]);
// The 31/10 week committed AGAIN on Monday 2 Nov (a correction: +2 KL Kepong).
const OCT_31_FIX = run(107, '2026-10-26', '2026-11-02T01:00:00.000Z', [42, 24, 9, 51, 84, 48]);

// The block the owner says is correct (2026-11-02).
const OCTOBER_FINAL = `Wholesales Week/ Month/ Target (October 2026)
KL Kepong + SG Puchong & Sunway - 64 / 354 / 350
KL Cheras - 9 / 39 / N/A
PG Center - 51 / 213 / 250
PG Mainland - 84 / 409 / 450
PG South - 48 / 211 / 300`;

// ── Driver ──────────────────────────────────────────────────────────────────
const wsBlock = (report) => {
    const lines = report.split('\n');
    const i = lines.findIndex(l => l.startsWith('Wholesales'));
    return i < 0 ? '(no Wholesales block)' : lines.slice(i, i + 6).join('\n');
};
let container;
const visit = async () => {
    DOM.clear();
    ['br-output', 'br-text', 'br-unmapped', 'br-bal-rows', 'br-ws-unassigned', 'br-tgt-rows', 'br-cat-body'].forEach(el);
    container = { innerHTML: '' };
    await A.showBossReportView(container);
};
const generate = async (runId) => {
    el('br-run-select').value = String(runId);
    toasts.length = 0;
    await A.brGenerate();
    return el('br-text').value;
};

const main = async () => {
    // ── 1. Monday 2 Nov, Saturday's 31/10 run → October closes ───────────────
    store.clear();
    global.window.supabase = fakeSb(db());
    RUNS = [SEP_26, ...OCT_RUNS, OCT_31];
    setToday('2026-11-02T10:00:00+08:00');
    await visit();
    let report = await generate(105);
    eq('M1 2 Nov + 31/10 run → the October final block', wsBlock(report), OCTOBER_FINAL);
    ok('M1 no error toast', !toasts.some(t => t[0] === 'error'), JSON.stringify(toasts));
    ok('M1 egg date is still the run date', report.includes('\n31/10/26\n'), report.slice(0, 60));

    // The page's Monthly Targets card still edits TODAY's month, so November's
    // targets can be set on the 1st while the report closes October.
    ok('M1 targets card is November', container.innerHTML.includes('Monthly Targets — November 2026'));
    for (const w of WS) el(`br-tgt-${w.key}`).value = '1';
    await A.brSaveTargets();
    ok('M1 targets save to November', JSON.parse(store.get('br_targets_2026_11') || '{}').klCheras === 1
        && JSON.parse(store.get('br_targets_2026_10') || '{}').klCheras !== 1, JSON.stringify(toasts));
    store.delete('br_targets_2026_11');

    // Report Format preview: newest run (31/10) → October too.
    el('br-sec-preview');
    await A.brManageCatalog('report');
    for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));
    eq('M1 preview follows the newest run', wsBlock(el('br-sec-preview').textContent).split('\n')[0],
        'Wholesales Week/ Month/ Target (October 2026)');

    // Still October a week later if the 31/10 run is picked on purpose.
    setToday('2026-11-09T10:00:00+08:00');
    RUNS = [SEP_26, ...OCT_RUNS, OCT_31, NOV_07];
    await visit();
    eq('M2 picking 31/10 on 9 Nov still gives October', wsBlock(await generate(105)), OCTOBER_FINAL);

    // ── 2. A normal new-month report ────────────────────────────────────────
    eq('N1 9 Nov + 7/11 run → November, its own month and targets', wsBlock(await generate(106)), `Wholesales Week/ Month/ Target (November 2026)
KL Kepong + SG Puchong & Sunway - 50 / 50 / 360
KL Cheras - 5 / 5 / N/A
PG Center - 40 / 40 / 260
PG Mainland - 60 / 60 / 460
PG South - 30 / 30 / 310`);

    // ── 3. The 31/10 week re-committed on 2 Nov ─────────────────────────────
    RUNS = [SEP_26, ...OCT_RUNS, OCT_31, OCT_31_FIX, NOV_07];
    await visit();
    report = await generate(107);
    eq('C1 the correction reports into October, replacing that week',
        wsBlock(report).split('\n').slice(0, 2).join('\n'),
        'Wholesales Week/ Month/ Target (October 2026)\nKL Kepong + SG Puchong & Sunway - 66 / 356 / 350');
    eq('C2 November does not count the October week again',
        wsBlock(await generate(106)).split('\n')[1], 'KL Kepong + SG Puchong & Sunway - 50 / 50 / 360');
    // Picking the ORIGINAL 31/10 run still shows that run's week in both columns.
    eq('C3 the older run of the week stays authoritative when picked',
        wsBlock(await generate(105)).split('\n')[1], 'KL Kepong + SG Puchong & Sunway - 64 / 354 / 350');

    // ── 4. Mid-month behaviour is unchanged ─────────────────────────────────
    RUNS = [SEP_26, ...OCT_RUNS.slice(0, 2)];
    setToday('2026-10-12T10:00:00+08:00');
    await visit();
    eq('U1 mid-month: this month so far, this month\'s target',
        wsBlock(await generate(102)).split('\n').slice(0, 2).join('\n'),
        'Wholesales Week/ Month/ Target (October 2026)\nKL Kepong + SG Puchong & Sunway - 67 / 151 / 350');
    // 3 Oct run of the week that began 28 Sep counts in October (its commit date).
    ok('U2 September run left out of October', !wsBlock(await generate(101)).includes('/ 99'), wsBlock(await generate(101)));
};

main().then(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
