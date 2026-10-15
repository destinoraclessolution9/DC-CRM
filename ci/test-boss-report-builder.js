// ci/test-boss-report-builder.js — Boss Report "Report Format" (Report Builder) tests.
//
// WHY: the report format (greeting, egg block, headings, divider, section order)
// was a template literal in brGenerate, so every "the boss wants one more line"
// meant a code change. It is now data (br_report_section) edited in the CRM.
//
// Pinned here:
//   1. THE BOSS'S FORMAT — with the 2026-10-16 seed layout and the week's data,
//      the generated text equals the report the boss was sent (10/10/26 eggs,
//      12/10/26 balances), byte for byte, after normalising three hand-typing
//      slips in that sample (spacing in "KL- 3"/"KL -3"/"PG - 9", "Balance 2422"
//      without its dash, a trailing space after "Probiotic").
//   2. Manual-entry sections, the relaxed "Balance" reader, a custom block
//      template round-trip, carry-forward from br_report_history, and the
//      editor's write path.
// The pre-builder byte-identity (fallback layout) is pinned by
// ci/test-boss-report-catalog.js, which runs against the same chunk.
//
// HARNESS: same approach as test-boss-report-catalog.js — eval the REAL chunk in
// a stubbed browser. Time is frozen at 2026-10-12 10:00 MYT (the boss's
// "Product Balance 12/10/26").
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

// ── Frozen clock ────────────────────────────────────────────────────────────
const RealDate = Date;
const FIXED = new RealDate('2026-10-12T10:00:00+08:00').getTime();
global.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(FIXED); }
    static now() { return FIXED; }
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
const SUPER_ADMIN = { id: 1, role: 'Level 1 Super Admin' };
global.window._appState = { cu: SUPER_ADMIN, cv: null };
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
global.XLSX = { read: (buf) => ({ SheetNames: ['Itemised'], Sheets: { Itemised: buf } }), utils: { sheet_to_json: (s) => s } };
global.Papa = { parse: (text) => ({ data: JSON.parse(text) }) };
class FakeFileReader {
    readAsArrayBuffer(file) { this.result = file._rows; if (this.onload) this.onload({ target: { result: file._rows } }); }
    readAsText(file) { this.result = file._text; if (this.onload) this.onload({ target: { result: file._text } }); }
}
global.FileReader = FakeFileReader;

let RUNS = [];
global.AppDataStore = {
    query: async (table, filters) => {
        if (table !== 'egg_run_history') return [];
        if (filters && filters.id) return RUNS.filter(r => r.id === filters.id);
        return RUNS.slice();
    },
};

// Table-aware Supabase stub. A table missing from `db` behaves as absent (PGRST205).
const writes = { upsert: {}, insert: {}, del: {} };
const fakeSb = (db) => ({
    from: (table) => {
        const absent = !(table in db);
        const payload = () => absent
            ? { data: null, error: { message: `Could not find the table 'public.${table}'`, code: 'PGRST205' } }
            : { data: JSON.parse(JSON.stringify(db[table])), error: null };
        const chain = () => {
            const p = Promise.resolve(payload());
            p.order = () => chain(); p.eq = () => chain(); p.limit = () => chain();
            return p;
        };
        return {
            select: () => chain(),
            upsert: async (rows) => { (writes.upsert[table] = writes.upsert[table] || []).push(...rows); return { error: absent ? { message: 'absent' } : null }; },
            insert: async (row) => { (writes.insert[table] = writes.insert[table] || []).push(row); return { error: absent ? { message: 'absent' } : null }; },
            delete: () => ({ eq: async (_c, v) => { (writes.del[table] = writes.del[table] || []).push(v); return { error: null }; } }),
        };
    },
});

// ── Load the real chunk ─────────────────────────────────────────────────────
const src = fs.readFileSync(path.join(__dirname, '..', 'chunks', 'script-boss-report.js'), 'utf8');
try { (0, eval)(src); } catch (e) { console.error('FAIL loading chunk: ' + e.message); process.exit(1); }
const A = global.app;

// ── Fixtures: the week the boss was sent ────────────────────────────────────
// Read the seed layout straight out of the migration, so the test fails if the
// SQL and the expected format drift apart.
const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'boss_report_builder_2026-10-16.sql'), 'utf8');
const SEED_SECTIONS = [...sql.matchAll(/\('([^']+)', '(settings|text|eggs|wholesale|balance|manual)', '([^']*)', (\d+),\s*'([\s\S]*?)'::jsonb\)/g)]
    .map(m => ({ key: m[1], type: m[2], title: m[3], sort_order: Number(m[4]), active: true, config: JSON.parse(m[5]) }));
ok('seed: 5 sections parsed from the migration', SEED_SECTIONS.length === 5, JSON.stringify(SEED_SECTIONS.map(s => s.key)));

const GROUPS = [
    { key: 'oceanSold', label: 'Ocean sold', sort_order: 10, is_egg: false, exclude_online_pattern: 'formula2u|mbb', active: true },
    { key: 'yangPower', label: 'Yang power sold', sort_order: 20, is_egg: false, exclude_online_pattern: null, active: true },
    { key: 'd3k2', label: 'D3k2 Sold', sort_order: 30, is_egg: false, exclude_online_pattern: null, active: true },
    { key: 'eyePlus', label: 'Eye+', sort_order: 40, is_egg: false, exclude_online_pattern: null, active: true },
    { key: 'morningPoweer', label: 'Morning Poweer', sort_order: 50, is_egg: false, exclude_online_pattern: null, active: true },
    { key: 'probiotic', label: 'Probiotic', sort_order: 60, is_egg: false, exclude_online_pattern: null, active: true },
    { key: 'eggs', label: 'Eggs (excluded from product balance)', sort_order: 900, is_egg: true, exclude_online_pattern: null, active: true },
];
// The Morning Poweer / Probiotic codes + unit_qty exactly as seeded by the migration.
const SEED_SKUS = [...sql.matchAll(/\('((?:PWRMON|PBTPWR)\d+)',\s*'[^']*',\s*'[^']*',\s*'(\w+)',\s*(\d+)\)/g)]
    .map(m => ({ code: m[1], group_key: m[2], unit_qty: Number(m[3]), active: true }));
ok('seed: 10 Morning Poweer / Probiotic codes parsed', SEED_SKUS.length === 10);
const SKUS = SEED_SKUS.concat([
    { code: 'D3KPWR001', group_key: 'd3k2', unit_qty: 1, active: true },
    { code: 'FMLOP001', group_key: 'oceanSold', unit_qty: 1, active: true },
]);
const WS = [
    { key: 'klKepong', label: 'KL Kepong + SG Puchong & Sunway', source_keys: ['KL Kepong', 'SG Puchong & Sunway'], sort_order: 10, active: true },
    { key: 'klCheras', label: 'KL Cheras', source_keys: ['KL Cheras'], sort_order: 20, active: true },
    { key: 'pgCenter', label: 'PG Center', source_keys: ['PG Center'], sort_order: 30, active: true },
    { key: 'pgMainland', label: 'PG Mainland', source_keys: ['PG Mainland'], sort_order: 40, active: true },
    { key: 'pgSouth', label: 'PG South', source_keys: ['PG South'], sort_order: 50, active: true },
];
const TARGETS = [
    { group_key: 'klKepong', target: 350 }, { group_key: 'pgCenter', target: 250 },
    { group_key: 'pgMainland', target: 450 }, { group_key: 'pgSouth', target: 300 },
];
RUNS = [
    { id: 10, week_start_date: '2026-10-05', run_at: '2026-10-10T00:11:34.000Z',
      totals: { KL: { KING: 19, GOLD: 67 }, PG: { KING: 43, GOLD: 146 }, JB: { KING: 0, GOLD: 2 },
                by_group: { 'KL Kepong': 40, 'SG Puchong & Sunway': 27, 'KL Cheras': 4, 'PG Center': 39, 'PG Mainland': 77, 'PG South': 35 } } },
    { id: 9, week_start_date: '2026-09-28', run_at: '2026-10-03T00:47:41.000Z',
      totals: { KL: { KING: 20, GOLD: 70 }, PG: { KING: 40, GOLD: 150 }, JB: { KING: 0, GOLD: 0 },
                by_group: { 'KL Kepong': 50, 'SG Puchong & Sunway': 34, 'KL Cheras': 9, 'PG Center': 43, 'PG Mainland': 70, 'PG South': 50 } } },
];
// Opening balances = the boss's closing balance + what sold that week.
const OPENING = { oceanSold: 1874, yangPower: 4508, d3k2: 786, eyePlus: 893, morningPoweer: 1272, probiotic: 2434 };
const SALES = [
    { 'Purchase Number': 'F5001', 'Product Code': 'D3KPWR001', Quantity: 2 },
    { 'Purchase Number': 'F5002', 'Product Code': 'PWRMON001', Quantity: 3 },
    { 'Purchase Number': 'P6001', 'Product Code': 'PWRMON003', Quantity: 5 },   // ×3 = 15
    { 'Purchase Number': 'P6002', 'Product Code': 'PWRMON001', Quantity: 4 },   // PG 19
    { 'Purchase Number': 'F5003', 'Product Code': 'PBTPWR001', Quantity: 3 },
    { 'Purchase Number': 'P6003', 'Product Code': 'PBTPWR002', Quantity: 3 },   // ×3 = 9
];

// The report as the boss received it (pasted 2026-10-16), verbatim.
const BOSS_SAMPLE = `老板好，

10/10/26
KL
KINGEGGS 高鮮帝王蛋- 19 carton
GOLD FRESH HEALTH PLUS EGG 高鮮蛋 - 67 cartons

PG
KINGEGGS 高鮮帝王蛋- 43 carton
GOLD FRESH HEALTH PLUS EGG 高鮮蛋 - 146 cartons

JB
KINGEGGS 高鮮帝王蛋- 0 carton
GOLD FRESH HEALTH PLUS EGG 高鮮蛋 - 2 cartons

Total -
Kin-62
Gold-215
______________
Wholesales Week/ Month/ Target (October 2026)
KL Kepong + SG Puchong & Sunway - 67 / 151 / 350
KL Cheras - 4 / 13 / N/A
PG Center - 39 / 82 / 250
PG Mainland - 77 / 147 / 450
PG South - 35 / 85 / 300
______________
Product Balance
12/10/26
Ocean sold
KL-0
PG-0
Balance - 1874

Yang power sold
KL-0
PG-0
Balance - 4508

D3k2 Sold
KL-2
PG-0
Balance - 784

Eye+
KL-0
PG-0
Balance - 893

Morning Poweer
KL- 3
PG-19
Balance - 1250

Probiotic
KL -3
PG - 9
Balance 2422
`;
// The three hand-typing slips, normalised to the format every other line uses.
const EXPECTED = BOSS_SAMPLE
    .replace('KL- 3', 'KL-3').replace('KL -3', 'KL-3').replace('PG - 9', 'PG-9')
    .replace('Probiotic \n', 'Probiotic\n').replace('Balance 2422', 'Balance - 2422');

// ── Driver ──────────────────────────────────────────────────────────────────
const db = (over = {}) => ({
    br_product_group: GROUPS, br_product_sku: SKUS, br_wholesale_group: WS, br_wholesale_target: TARGETS,
    br_report_section: SEED_SECTIONS, br_report_history: [], ...over,
});
const resetDom = () => {
    DOM.clear();
    el('br-run-select').value = '10';
    ['br-output', 'br-text', 'br-unmapped', 'br-bal-rows', 'br-ws-unassigned', 'br-tgt-rows', 'br-manual-card', 'br-manual-rows', 'br-cat-body'].forEach(el);
    for (const [k, v] of Object.entries(OPENING)) el(`br-bal-${k}`).value = String(v);
};
const visit = async () => { await A.showBossReportView({ innerHTML: '' }); };
const generate = async () => {
    A.brLoadSales({ files: [{ name: 'sales.xlsx', _rows: SALES }] });
    toasts.length = 0;
    await A.brGenerate();
    return el('br-text').value;
};

const run = async () => {
    // ── 1. The boss's format ────────────────────────────────────────────────
    store.clear();
    global.window.supabase = fakeSb(db());
    await visit(); resetDom();
    let report = await generate();
    eq('B1 generated report == the boss sample (normalised)', report, EXPECTED);
    ok('B1 no unmapped-code banner', el('br-unmapped').style.display === 'none', el('br-unmapped').innerHTML);
    ok('B1 manual card not shown (no manual sections)', el('br-manual-card').style.display !== '');

    // Save Final on the boss's ORIGINAL text (with "Balance 2422", no dash): the
    // relaxed reader still carries every balance forward.
    el('br-text').value = BOSS_SAMPLE;
    await A.brSaveFinal();
    const saved = JSON.parse(store.get('br_balances'));
    eq('S1 balances read from the hand-typed sample',
        saved, { oceanSold: 1874, yangPower: 4508, d3k2: 784, eyePlus: 893, morningPoweer: 1250, probiotic: 2422 });
    ok('S1 no "balance not found" warning', !toasts.some(t => t[0] === 'warning'), JSON.stringify(toasts));
    const hist = (writes.insert.br_report_history || []).pop();
    ok('S1 history row written', !!hist && hist.report_text === BOSS_SAMPLE && hist.balances.probiotic === 2422 && hist.run_id === 10,
        JSON.stringify(hist && { ...hist, report_text: '…' }));
    ok('S1 shared-save toast', toasts.some(t => t[0] === 'success' && /balances updated/.test(t[1]) && !/this browser/.test(t[1])), JSON.stringify(toasts));

    // A balance line that really is missing is flagged, not silently skipped.
    el('br-text').value = EXPECTED.replace('Balance - 893', 'Balance - ???');
    toasts.length = 0;
    await A.brSaveFinal();
    ok('S2 missing balance warns and names the line', toasts.some(t => t[0] === 'warning' && /Eye\+/.test(t[1])), JSON.stringify(toasts));

    // ── 2. Carry-forward from history (another device saved later) ───────────
    store.clear();
    store.set('br_balances', JSON.stringify({ oceanSold: 1 }));
    store.set('br_balances_at', '2026-10-01T00:00:00.000Z');
    global.window.supabase = fakeSb(db({ br_report_history: [{ id: 5, report_date: '2026-10-05', balances: { oceanSold: 1874, probiotic: 2422 }, manual: {}, saved_at: '2026-10-05T03:00:00.000Z' }] }));
    await visit();
    eq('H1 newer shared save wins over this browser', JSON.parse(store.get('br_balances')), { oceanSold: 1874, probiotic: 2422 });
    store.set('br_balances_at', '2026-10-09T00:00:00.000Z');
    store.set('br_balances', JSON.stringify({ oceanSold: 7 }));
    await visit();
    eq('H2 newer local save is kept', JSON.parse(store.get('br_balances')), { oceanSold: 7 });

    // ── 3. Manual-entry section: new information for the boss ───────────────
    const MANUAL = { key: 'cash', type: 'manual', title: 'Cash', sort_order: 35, active: true,
        config: { divider_before: true, title: 'Cash collected', line: '{label} - RM{value}', skip_empty: true,
                  fields: [{ key: 'klCash', label: 'KL', type: 'number', carry: false },
                           { key: 'pgCash', label: 'PG', type: 'number', carry: true }] } };
    store.clear();
    global.window.supabase = fakeSb(db({
        br_report_section: SEED_SECTIONS.concat([MANUAL]),
        br_report_history: [{ id: 6, balances: OPENING, manual: { cash: { pgCash: '880' } }, saved_at: '2026-10-11T00:00:00.000Z' }],
    }));
    DOM.clear(); ['br-manual-card', 'br-manual-rows'].forEach(el);
    await visit();
    ok('M1 manual card shown', el('br-manual-card').style.display === '');
    ok('M1 carry field pre-filled from the last save', /id="br-man-cash-pgCash"[^>]*value="880"/.test(el('br-manual-rows').innerHTML), el('br-manual-rows').innerHTML);
    ok('M1 non-carry field starts blank', /id="br-man-cash-klCash"[^>]*value=""/.test(el('br-manual-rows').innerHTML));
    resetDom();
    el('br-man-cash-klCash').value = '1500';
    el('br-man-cash-pgCash').value = '';
    report = await generate();
    ok('M2 manual section printed between wholesale and balance',
        report.includes('PG South - 35 / 85 / 300\n______________\nCash collected\nKL - RM1500\n______________\nProduct Balance'), report);
    ok('M2 blank field left out', !report.includes('PG - RM'));
    el('br-man-cash-klCash').value = '';
    report = await generate();
    eq('M3 all-blank manual section prints nothing (no stray divider)', report, EXPECTED);

    // ── 4. Custom balance block: generate → Save Final round-trip ────────────
    const custom = SEED_SECTIONS.map(s => s.type !== 'balance' ? s
        : { ...s, config: { ...s.config, block: '【{label}】\nKL {kl} / PG {pg}\n剩余：{balance} 瓶' } });
    store.clear();
    global.window.supabase = fakeSb(db({ br_report_section: custom }));
    await visit(); resetDom();
    report = await generate();
    ok('C1 custom block rendered', report.includes('【Probiotic】\nKL 3 / PG 9\n剩余：2422 瓶'), report.split('______________').pop());
    await A.brSaveFinal();
    eq('C1 custom block reads back', JSON.parse(store.get('br_balances')).probiotic, 2422);
    eq('C1 all six lines read back', Object.keys(JSON.parse(store.get('br_balances'))).length, 6);

    // ── 5. Editor: first edit on an EMPTY table writes the whole layout ──────
    store.clear();
    writes.upsert = {};
    global.window.supabase = fakeSb(db({ br_report_section: [] }));
    await visit(); DOM.clear(); el('br-cat-body'); el('br-manual-card'); el('br-manual-rows');
    await A.brManageCatalog('report');
    el('br-sec-newtype').value = 'manual';
    A.brSecAdd();
    el('br-sec-title').value = 'Events';
    el('br-sec-divbefore').checked = true;
    el('br-sec-mtitle').value = 'Events this week';
    el('br-sec-mline').value = '{label}: {value}';
    el('br-sec-skip').checked = true;
    el('br-sec-f-label-0').value = 'Attendees';
    el('br-sec-f-type-0').value = 'number';
    await A.brSecSave();
    const up = writes.upsert.br_report_section || [];
    ok('E1 saved', toasts.some(t => t[0] === 'success' && /Report format saved/.test(t[1])), JSON.stringify(toasts));
    eq('E1 whole layout persisted (built-in 5 + new)', up.map(r => r.key).sort(), ['_settings', 'balance', 'eggs', 'greeting', 'manualEntry', 'wholesale']);
    const ev = up.find(r => r.type === 'manual');
    eq('E1 field key derived from its label', ev && ev.config.fields.map(f => f.key), ['attendees']);
    ok('E1 sorted after the last section', ev && ev.sort_order === 50, ev && ev.sort_order);

    // Validation: the balance block must keep {label} and {balance}.
    toasts.length = 0;
    A.brSecEdit('balance');
    el('br-sec-block').value = '{label} KL-{kl}';
    await A.brSecSave();
    ok('E2 block without {balance} refused', toasts.some(t => t[0] === 'error' && /\{balance\}/.test(t[1])), JSON.stringify(toasts));

    // ── 5b. Bug-check regressions (2026-10-16 review) ───────────────────────
    // A manual field named like a product line, ABOVE Product Balance, must not
    // be read as that line's balance (header search is scoped to the section),
    // and the Balance pattern must not cross lines ("Balance\n12/10/26" = 12).
    const PROMO = { key: 'promo', type: 'manual', title: 'Promo', sort_order: 35, active: true,
        config: { divider_before: true, title: 'Promo units', line: '{label} - {value}', skip_empty: true,
                  fields: [{ key: 'pro', label: 'Probiotic', type: 'number', carry: false }] } };
    store.clear();
    global.window.supabase = fakeSb(db({ br_report_section: SEED_SECTIONS.concat([PROMO]) }));
    DOM.clear(); ['br-manual-card', 'br-manual-rows'].forEach(el);
    await visit(); resetDom();
    el('br-man-promo-pro').value = '5';
    report = await generate();
    ok('X1 promo line printed', report.includes('Promo units\nProbiotic - 5'), report);
    await A.brSaveFinal();
    eq('X1 Probiotic balance read from Product Balance, not the promo line', JSON.parse(store.get('br_balances')).probiotic, 2422);
    eq('X1 Ocean balance not taken from the date under the heading', JSON.parse(store.get('br_balances')).oceanSold, 1874);

    // Opening an OLD saved report then Save Final must ask first — otherwise
    // next week's opening balances silently roll back to that week.
    const OLD = { id: 3, report_date: '2026-09-28', run_id: 7, report_text: EXPECTED.replace('Balance - 2422', 'Balance - 9999'), saved_at: '2026-09-28T03:00:00+00:00' };
    store.clear();
    global.window.supabase = fakeSb(db({ br_report_history: [OLD] }));
    await visit(); resetDom();
    await A.brManageCatalog('history');
    await new Promise(r => setTimeout(r, 0));
    A.brHistoryUse(3);
    eq('X2 old report opened in the box', el('br-text').value, OLD.report_text);
    writes.insert = {};
    let asked = 0;
    global.confirm = () => { asked++; return false; };
    await A.brSaveFinal();
    ok('X2 confirmation asked', asked === 1);
    ok('X2 declined → nothing written', !store.has('br_balances') && !(writes.insert.br_report_history || []).length);
    global.confirm = () => { asked++; return true; };
    await A.brSaveFinal();
    eq('X2 accepted → saved with the old report\'s run id', (writes.insert.br_report_history || [])[0]?.run_id, 7);
    // A fresh Generate clears the "opened from history" state: no prompt.
    asked = 0;
    await generate();
    await A.brSaveFinal();
    ok('X2 after Generate, Save Final does not ask again', asked === 0);

    // Newest save wins by TIME, not by string order (Supabase returns +00:00).
    store.clear();
    store.set('br_balances', JSON.stringify({ oceanSold: 7 }));
    store.set('br_balances_at', '2026-10-05T03:00:00.500Z');
    global.window.supabase = fakeSb(db({ br_report_history: [{ id: 8, balances: { oceanSold: 1874 }, manual: {}, saved_at: '2026-10-05T03:00:00.4+00:00' }] }));
    await visit();
    eq('X3 older shared save (other timestamp format) does not overwrite', JSON.parse(store.get('br_balances')), { oceanSold: 7 });
    store.set('br_balances_at', '2026-10-05T02:59:59.000Z');
    await visit();
    eq('X3 newer shared save wins', JSON.parse(store.get('br_balances')), { oceanSold: 1874 });

    // Only one Eggs / Wholesales / Product Balance section.
    store.clear();
    global.window.supabase = fakeSb(db());
    await visit(); DOM.clear(); el('br-cat-body');
    await A.brManageCatalog('report');
    toasts.length = 0;
    el('br-sec-newtype').value = 'balance';
    A.brSecAdd();
    ok('X4 second balance section refused', toasts.some(t => t[0] === 'error' && /already/.test(t[1])), JSON.stringify(toasts));
    el('br-sec-newtype').value = 'manual';
    toasts.length = 0;
    A.brSecAdd();
    ok('X4 manual sections can be added', !toasts.some(t => t[0] === 'error'));
    A.brSecEdit('');

    // Reorder in browser-only mode (table absent), as clicked in the live UI test.
    store.clear();
    global.window.supabase = fakeSb((() => { const d = db(); delete d.br_report_section; return d; })());
    await visit(); DOM.clear(); el('br-cat-body'); el('br-manual-card'); el('br-manual-rows');
    await A.brManageCatalog('report');
    el('br-sec-newtype').value = 'manual';
    A.brSecAdd();
    el('br-sec-mtitle').value = 'Cash'; el('br-sec-mline').value = '{label} - {value}'; el('br-sec-skip').checked = true;
    el('br-sec-f-label-0').value = 'KL cash';
    await A.brSecSave();
    const t0 = Date.now();
    await A.brSecMove('manualEntry', -1);
    ok('X5 move finishes promptly', Date.now() - t0 < 1000);
    eq('X5 manual section now above Product Balance',
        JSON.parse(store.get('br_sections_cache')).filter(s => s.type !== 'settings').map(s => s.key),
        ['greeting', 'eggs', 'wholesale', 'manualEntry', 'balance']);
    // Before the move the section sat AFTER Product Balance: no blank line
    // between the last balance line and the divider.
    {
        const sb = global.window.supabase;
        const after = SEED_SECTIONS.concat([{ ...MANUAL, sort_order: 50 }]);
        global.window.supabase = fakeSb(db({ br_report_section: after }));
        DOM.clear(); ['br-manual-card', 'br-manual-rows'].forEach(el);
        await visit(); resetDom();
        el('br-man-cash-klCash').value = '1500';
        const r2 = await generate();
        ok('X6 section after Product Balance: no extra blank line', r2.endsWith('Balance - 2422\n______________\nCash collected\nKL - RM1500'), JSON.stringify(r2.slice(-80)));
        global.window.supabase = sb;
    }

    // The React island must RECEIVE the catalog-driven rows. mountBossReport
    // used to drop balGroups/tgtGroups, so the page always showed the built-in
    // four balance boxes — a new product line (Morning Poweer) then had no
    // opening-balance box and always printed "Balance - 0".
    const mainJsx = fs.readFileSync(path.join(__dirname, '..', 'src', 'react', 'main.jsx'), 'utf8');
    const mountSrc = (mainJsx.match(/function mountBossReport[\s\S]*?\n\}/) || [''])[0];
    ok('X7 island mount forwards balGroups', /balGroups=\{o\.balGroups\}/.test(mountSrc), mountSrc);
    ok('X7 island mount forwards tgtGroups', /tgtGroups=\{o\.tgtGroups\}/.test(mountSrc));

    // ── 6. Small guarantees ──────────────────────────────────────────────────
    const badRow = SEED_SECTIONS.concat([{ key: 'junk', type: 'nope', sort_order: 5, config: {} }]);
    store.clear();
    global.window.supabase = fakeSb(db({ br_report_section: badRow }));
    await visit(); resetDom();
    eq('G1 unknown section type ignored', await generate(), EXPECTED);
    const typo = SEED_SECTIONS.map(s => s.key === 'greeting' ? { ...s, config: { ...s.config, text: '老板好 {totay}' } } : s);
    global.window.supabase = fakeSb(db({ br_report_section: typo }));
    await visit(); resetDom();
    ok('G2 unknown token left visible', (await generate()).startsWith('老板好 {totay}\n\n10/10/26'));
};

run().then(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
