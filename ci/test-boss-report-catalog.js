// ci/test-boss-report-catalog.js — Boss Report product-catalog characterization tests.
//
// WHY: the four product-balance groups used to be hardcoded in FOUR places (chunk
// render, chunk generate, _brParseFinalBalances, and the React island) and the
// code→group→qty mapping lived only in localStorage. Adding a product code meant
// editing an xlsx offline; adding a product LINE meant a code change in all four
// sites. Worse, three failure modes were silent: an unmapped code, a group not in
// the hardcoded four, and a blank Quantities cell all vanished without a warning
// while INFLATING the reported balance.
//
// These tests pin two things:
//   1. REGRESSION — with the same inputs, the catalog-driven generator produces a
//      byte-identical report to the pre-catalog algorithm (reimplemented below as
//      the reference oracle). If this fails, the boss's numbers moved.
//   2. THE NEW BEHAVIOUR — catalog-driven lines, unit quantities, per-group online
//      exclusion, egg handling, and the unmapped-code surfacing.
//
// HARNESS: loads the REAL chunks/script-boss-report.js into a stubbed browser
// (fake DOM / localStorage / XLSX / Papa / Supabase). No logic is duplicated here
// except the reference oracle, which is deliberately a verbatim copy of the OLD
// implementation — that is the point of it.
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
    const g = typeof got === 'string' ? got : JSON.stringify(got);
    const w = typeof want === 'string' ? want : JSON.stringify(want);
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
global.document = {
    getElementById: (id) => (DOM.has(id) ? DOM.get(id) : null),
    // No real DOM here: the wholesale source-key checkboxes cannot be ticked, so
    // those tests drive the free-text `br-ws-extra` field instead.
    querySelectorAll: () => [],
};
global.location = { search: '' };
// Node 24 exposes `navigator` as a getter-only global — brCopy is not under test.
try { Object.defineProperty(global, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true }); } catch (_) { /* fine */ }

const toasts = [];
global.UI = {
    toast: {
        success: (m) => toasts.push(['success', m]),
        error:   (m) => toasts.push(['error', m]),
        warning: (m) => toasts.push(['warning', m]),
    },
    showModal: () => {}, hideModal: () => {},
};

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

// A "workbook buffer" in this harness IS the row array.
global.XLSX = {
    read: (buf) => ({ SheetNames: ['Itemised'], Sheets: { Itemised: buf } }),
    utils: { sheet_to_json: (s) => s },
};
// A "csv text" in this harness is JSON.
global.Papa = { parse: (text) => ({ data: JSON.parse(text) }) };

let RUN = null;
global.AppDataStore = {
    query: async (table, filters) => {
        if (table !== 'egg_run_history') return [];
        if (filters && filters.id) return RUN && RUN.id === filters.id ? [RUN] : [];
        return RUN ? [RUN] : [];
    },
};

// ── Load the real chunk ─────────────────────────────────────────────────────
const chunkPath = path.join(__dirname, '..', 'chunks', 'script-boss-report.js');
const src = fs.readFileSync(chunkPath, 'utf8');
try { (0, eval)(src); } catch (e) { console.error('FAIL loading chunk: ' + e.message); process.exit(1); }
const A = global.app;
ok('chunk registers brManageCatalog', typeof A.brManageCatalog === 'function');
ok('chunk registers brGenerate', typeof A.brGenerate === 'function');

// ── Fixtures ────────────────────────────────────────────────────────────────
RUN = {
    id: 77, week_start_date: '2026-07-27', run_at: '2026-07-28T02:00:00.000Z',
    totals: {
        KL: { KING: 10, GOLD: 20 }, PG: { KING: 5, GOLD: 6 }, JB: { KING: 1, GOLD: 2 },
        by_group: { 'KL Kepong': 4, 'SG Puchong & Sunway': 3, 'KL Cheras': 2, 'PG Center': 1, 'PG Mainland': 1, 'PG South': 1 },
    },
};

const LEGACY_SKUS = {
    FMLOCEAN001:  { group: 'Ocean sold',      qty: 1 },
    FMLOCEAN006:  { group: 'Ocean sold',      qty: 6 },
    FMLYANG001:   { group: 'Yang power sold', qty: 1 },
    FMLD3K2001:   { group: 'D3k2 Sold',       qty: 1 },
    FMLEYE001:    { group: 'Eye+',            qty: 1 },
};

const SALES_ROWS = [
    { 'Purchase Number': 'F1001', 'Product Code': 'FMLOCEAN001', Quantity: 10 },
    { 'Purchase Number': 'F1002', 'Product Code': 'FMLOCEAN006', Quantity: 2 },   // ×6 = 12
    { 'Purchase Number': 'P2001', 'Product Code': 'FMLYANG001',  Quantity: 7 },
    { 'Purchase Number': 'F1003', 'Product Code': 'FMLEGG010',   Quantity: 99 },  // egg → excluded
    { 'Purchase Number': 'X9999', 'Product Code': 'FMLD3K2001',  Quantity: 50 },  // no region → excluded
    { 'Purchase Number': 'F1004', 'Product Code': 'FMLD3K2001',  Quantity: 3 },
    { 'Purchase Number': 'F1005', 'Product Code': 'FMLEYE001',   Quantity: -4 },  // clamped to 0
];
const TRACK_ROWS = [
    { 'Product Code': 'FMLOCEAN001', Quantity: 5,  'Self Collection': 'Bay Avenue, PG' },
    { 'Product Code': 'FMLOCEAN001', Quantity: 8,  'Self Collection': 'formula2u warehouse' }, // Ocean exclusion
    { 'Product Code': 'FMLYANG001',  Quantity: 4,  'Self Collection': '' },
    { 'Product Code': 'FMLEYE001',   Quantity: 2,  'Self Collection': 'Bay Avenue, PG' },
];
const OPENING = { oceanSold: 1945, yangPower: 4734, d3k2: 967, eyePlus: 1079 };

// ── Reference oracle: the PRE-catalog algorithm, verbatim ───────────────────
const oldIsEgg = (c) => { const s = String(c || '').toUpperCase(); return s.startsWith('FMLEGG') || s.startsWith('FMLENX') || s.startsWith('FWHEGG'); };
const oldParseSales = (rows, skusMap) => {
    const sold = { KL: {}, PG: {} };
    for (const row of rows) {
        const pNum = String(row['Purchase Number'] || '');
        const code = String(row['Product Code'] || '').trim();
        const qty = Math.max(0, Number(row.Quantity) || 0);
        if (oldIsEgg(code)) continue;
        const region = pNum.startsWith('F') ? 'KL' : pNum.startsWith('P') ? 'PG' : null;
        if (!region) continue;
        const sku = skusMap[code];
        if (!sku) continue;
        const g = sku.group.trim();
        sold[region][g] = (sold[region][g] || 0) + qty * sku.qty;
    }
    return sold;
};
const oldParseTrack = (rows, skusMap) => {
    const sold = { KL: {}, PG: {} };
    for (const row of rows) {
        const code = String(row['Product Code'] || '').trim();
        const qty = Number(row.Quantity) || 0;
        const selfCol = String(row['Self Collection'] || '');
        if (oldIsEgg(code)) continue;
        const region = selfCol.includes('Bay Avenue, PG') ? 'PG' : 'KL';
        const sku = skusMap[code];
        if (!sku) continue;
        const g = sku.group.trim();
        if (g === 'Ocean sold' && /formula2u|mbb/i.test(selfCol)) continue;
        sold[region][g] = (sold[region][g] || 0) + qty * sku.qty;
    }
    return sold;
};
const oldBalSection = (balDate, opening) => {
    const sold = { KL: {}, PG: {} };
    for (const s of [oldParseSales(SALES_ROWS, LEGACY_SKUS), oldParseTrack(TRACK_ROWS, LEGACY_SKUS)])
        for (const rg of ['KL', 'PG']) for (const [g, q] of Object.entries(s[rg] || {})) sold[rg][g] = (sold[rg][g] || 0) + q;
    const groups = [
        { key: 'oceanSold', skuGroup: 'Ocean sold', label: 'Ocean sold' },
        { key: 'yangPower', skuGroup: 'Yang power sold', label: 'Yang power sold' },
        { key: 'd3k2', skuGroup: 'D3k2 Sold', label: 'D3k2 Sold' },
        { key: 'eyePlus', skuGroup: 'Eye+', label: 'Eye+' },
    ];
    let out = `Product Balance\n${balDate}`;
    for (const g of groups) {
        const kl = Math.round(sold.KL[g.skuGroup] || 0);
        const pg = Math.round(sold.PG[g.skuGroup] || 0);
        const bal = Math.max(0, (opening[g.key] || 0) - kl - pg);
        out += `\n${g.label}\nKL-${kl}\nPG-${pg}\nBalance - ${bal}\n`;
    }
    return out;
};

// ── Driver ──────────────────────────────────────────────────────────────────
const resetDom = (openingBals, groupKeys) => {
    DOM.clear();
    el('br-run-select').value = String(RUN.id);
    ['br-output','br-text','br-unmapped','br-bal-rows','br-ws-unassigned','br-tgt-rows'].forEach(el);
    for (const k of groupKeys) el(`br-bal-${k}`).value = String(openingBals[k] ?? '');
};
// A view visit is what refreshes the catalog in production (showBossReportView
// calls _brLoadCatalog(true)); brGenerate deliberately reuses the cached copy.
// Going through the real view function keeps that contract under test.
const visitView = async () => { await A.showBossReportView({ innerHTML: '' }); };

const runGenerate = async () => {
    toasts.length = 0;
    await A.brGenerate();
    return el('br-text').value;
};
const balBlock = (report) => report.split('________________________________________').pop().replace(/^\n/, '');

// The chunk keeps its per-week upload buffers module-private (deliberately — see
// the reset comment in showBossReportView). Rather than reach into them, drive
// the loaders through a FileReader stub, which is the real code path.
class FakeFileReader {
    readAsArrayBuffer(file) { this.result = file._rows; if (this.onload) this.onload({ target: { result: file._rows } }); }
    readAsText(file) { this.result = file._text; if (this.onload) this.onload({ target: { result: file._text } }); }
}
global.FileReader = FakeFileReader;
const fileOf = (rows) => ({ name: 'sales.xlsx', _rows: rows });
const csvOf = (rows) => ({ name: 'track.csv', _text: JSON.stringify(rows) });

const loadBoth = (salesRows, trackRows) => {
    if (salesRows) A.brLoadSales({ files: [fileOf(salesRows)] });
    if (trackRows) A.brLoadTracking({ files: [csvOf(trackRows)] });
};

// Supabase stub returning a fixture catalog. `ws` omitted => the wholesale-group
// table is absent (PGRST205), which is the real pre-migration state.
const wsWrites = [];
const targetWrites = [];
const fakeSb = (groups, skus, ws, targets) => ({
    from: (table) => ({
        select: () => {
            const rows = table === 'br_product_group' ? groups
                       : table === 'br_product_sku' ? skus
                       : table === 'br_wholesale_group' ? ws
                       : targets;
            const err = rows === undefined
                ? { message: `Could not find the table 'public.${table}'`, code: 'PGRST205' } : null;
            const payload = { data: err ? null : rows, error: err };
            const res = Promise.resolve(payload);
            res.order = () => Promise.resolve(payload);
            res.eq = () => Promise.resolve(payload);
            return res;
        },
        upsert: async (rows) => {
            if (table === 'br_wholesale_group') wsWrites.push(...rows);
            if (table === 'br_wholesale_target') targetWrites.push(...rows);
            return { error: null };
        },
        delete: () => ({ eq: async () => ({ error: null }) }),
    }),
});

const run = async () => {
    const balDate = (() => {
        const d = new Date();
        return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
    })();

    // ── 1. REGRESSION vs the pre-catalog algorithm ───────────────────────────
    store.clear();
    store.set('br_skus', JSON.stringify(LEGACY_SKUS));
    global.window.supabase = null;
    await visitView();
    resetDom(OPENING, Object.keys(OPENING));
    loadBoth(SALES_ROWS, TRACK_ROWS);
    let report = await runGenerate();
    eq('R1 balance block byte-identical to old algorithm', balBlock(report), oldBalSection(balDate, OPENING));
    ok('R1 egg section present', report.includes('KINGEGGS'));
    // Week column sums the two source groups (4 + 3). The Month column is 0 here
    // because the fixture run's run_at is in a previous month — existing,
    // unrelated behaviour, pinned so a future change to it is deliberate.
    ok('R1 wholesales week column sums its source groups',
        /^KL Kepong \+ SG Puchong & Sunway - 7 \/ \d+ \/ N\/A$/m.test(report),
        report.split('________________________________________')[1]);
    ok('R1 no unmapped banner', el('br-unmapped').style.display === 'none');

    // Spot-check the arithmetic the oracle encodes, so a matching pair of bugs
    // in both implementations cannot pass silently.
    ok('R1 Ocean KL = 10 + 12 = 22', /Ocean sold\nKL-22\n/.test(report), balBlock(report));
    ok('R1 Ocean PG = 5 (formula2u row excluded)', /Ocean sold\nKL-22\nPG-5\n/.test(report));
    ok('R1 Ocean balance 1945-22-5 = 1918', /Ocean sold\nKL-22\nPG-5\nBalance - 1918/.test(report));
    ok('R1 Yang KL 4 / PG 7', /Yang power sold\nKL-4\nPG-7\n/.test(report));
    ok('R1 Eye\\+ negative qty clamped to 0', /Eye\+\nKL-0\nPG-2\n/.test(report));

    // ── 2. UNMAPPED CODES are surfaced, not silently dropped ────────────────
    const withNew = SALES_ROWS.concat([{ 'Purchase Number': 'F1006', 'Product Code': 'AGENTFMLYANG002', Quantity: 18 }]);
    await visitView();
    resetDom(OPENING, Object.keys(OPENING));
    loadBoth(withNew, TRACK_ROWS);
    report = await runGenerate();
    ok('U1 banner shown', el('br-unmapped').style.display === '');
    ok('U1 banner names the code', el('br-unmapped').innerHTML.includes('AGENTFMLYANG002'));
    ok('U1 banner reports 18 units', el('br-unmapped').innerHTML.includes('18 units were not deducted'),
        el('br-unmapped').innerHTML);
    eq('U1 unmapped units NOT deducted (Yang unchanged)', /Yang power sold\nKL-(\d+)/.exec(report)[1], '4');

    // ── 3. CATALOG-DRIVEN: a new product line + unit qty, from the DB ────────
    const GROUPS = [
        { key: 'oceanSold', label: 'Ocean sold', sort_order: 10, is_egg: false, exclude_online_pattern: 'formula2u|mbb', active: true },
        { key: 'yangPower', label: 'Yang power sold', sort_order: 20, is_egg: false, exclude_online_pattern: null, active: true },
        { key: 'd3k2', label: 'D3k2 Sold', sort_order: 30, is_egg: false, exclude_online_pattern: null, active: true },
        { key: 'eyePlus', label: 'Eye+', sort_order: 40, is_egg: false, exclude_online_pattern: null, active: true },
        { key: 'collagenSold', label: 'Collagen (K2) sold', sort_order: 50, is_egg: false, exclude_online_pattern: null, active: true },
        { key: 'retired', label: 'Retired line', sort_order: 60, is_egg: false, exclude_online_pattern: null, active: false },
        { key: 'eggs', label: 'Eggs', sort_order: 900, is_egg: true, exclude_online_pattern: null, active: true },
    ];
    const SKUS = [
        { code: 'FMLOCEAN001', group_key: 'oceanSold', unit_qty: 1, active: true },
        { code: 'FMLOCEAN006', group_key: 'oceanSold', unit_qty: 6, active: true },
        { code: 'FMLYANG001', group_key: 'yangPower', unit_qty: 1, active: true },
        // The user's real case: an agent pre-buy pack of 50 bottles.
        { code: 'AGENTFMLYANG002', name: 'YANG POWER (AGENT PROMOTION)', attribute: 'Pre Buy 50 bottle', group_key: 'yangPower', unit_qty: 50, active: true },
        { code: 'FMLD3K2001', group_key: 'd3k2', unit_qty: 1, active: true },
        { code: 'FMLEYE001', group_key: 'eyePlus', unit_qty: 1, active: true },
        { code: 'FMLCOL001', group_key: 'collagenSold', unit_qty: 1, active: true },
        { code: 'FMLRET001', group_key: 'retired', unit_qty: 1, active: true },
        { code: 'FMLOFF001', group_key: 'oceanSold', unit_qty: 1, active: false },
        // An egg code WITHOUT a legacy prefix — impossible to exclude before.
        { code: 'NEWEGG777', group_key: 'eggs', unit_qty: 1, active: true },
    ];
    store.clear();
    global.window.supabase = fakeSb(GROUPS, SKUS);
    const openingV2 = { ...OPENING, collagenSold: 500 };
    const salesV2 = SALES_ROWS.concat([
        { 'Purchase Number': 'F1006', 'Product Code': 'AGENTFMLYANG002', Quantity: 18 }, // ×50 = 900
        { 'Purchase Number': 'F1007', 'Product Code': 'FMLCOL001', Quantity: 25 },
        { 'Purchase Number': 'F1008', 'Product Code': 'NEWEGG777', Quantity: 999 },      // is_egg → excluded
        { 'Purchase Number': 'F1009', 'Product Code': 'FMLRET001', Quantity: 40 },       // inactive line → skipped
        { 'Purchase Number': 'F1010', 'Product Code': 'FMLOFF001', Quantity: 40 },       // inactive sku → skipped
    ]);
    await visitView();
    resetDom(openingV2, Object.keys(openingV2));
    loadBoth(salesV2, TRACK_ROWS);
    report = await runGenerate();
    ok('C1 new product line prints its own block', /Collagen \(K2\) sold\nKL-25\nPG-0\nBalance - 475/.test(report), balBlock(report));
    ok('C1 unit_qty 50 applied: Yang KL = 4 + 900 = 904', /Yang power sold\nKL-904\n/.test(report), balBlock(report));
    ok('C1 is_egg group excluded (no 999)', !report.includes('999'));
    ok('C1 inactive line does not print', !report.includes('Retired line'));
    ok('C1 inactive sku/line skipped silently (no banner)', el('br-unmapped').style.display === 'none',
        el('br-unmapped').innerHTML);
    ok('C1 Ocean unaffected by the inactive sku', /Ocean sold\nKL-22\n/.test(report), balBlock(report));

    // ── 4. Per-group online exclusion travels with a RENAMED group ───────────
    const renamed = GROUPS.map(g => g.key === 'oceanSold' ? { ...g, label: 'Ocean Fresh sold' } : g);
    store.clear();
    global.window.supabase = fakeSb(renamed, SKUS);
    await visitView();
    resetDom({ ...openingV2, oceanSold: 1945 }, Object.keys(openingV2));
    loadBoth(SALES_ROWS, TRACK_ROWS);
    report = await runGenerate();
    ok('X1 renamed line keeps its exclusion (PG 5, not 13)', /Ocean Fresh sold\nKL-22\nPG-5\n/.test(report), balBlock(report));

    // ── 5. Saved-report parse-back handles dynamic + regex-metachar labels ───
    el('br-text').value = report;
    store.delete('br_balances');
    A.brSaveFinal();
    const saved = JSON.parse(store.get('br_balances') || '{}');
    eq('S1 Ocean balance carried forward', saved.oceanSold, 1918);
    eq('S1 Eye+ label with metachar parsed', saved.eyePlus, 1077);
    eq('S1 new Collagen (K2) line parsed', saved.collagenSold, 500);

    // A block whose Balance line was deleted must yield NO balance for that block
    // rather than stealing the next block's number.
    el('br-text').value = report.replace(/Ocean Fresh sold\nKL-22\nPG-5\nBalance - 1918/, 'Ocean Fresh sold\nKL-22\nPG-5');
    store.delete('br_balances');
    A.brSaveFinal();
    const saved2 = JSON.parse(store.get('br_balances') || '{}');
    ok('S2 missing Balance line does not steal the next block', saved2.oceanSold === undefined, JSON.stringify(saved2));
    eq('S2 following block still correct', saved2.yangPower, 4723);

    // ── 6. Blank Quantities is reported by the import preview, not silent ────
    store.clear();
    global.window.supabase = null;
    await visitView();
    // Exercised through brLoadSkus → diff preview. The workbook here is the row array.
    const wbRows = [
        { 'Product Code': 'FMLNEW001', Group: 'Ocean sold', Quantities: 12 },
        { 'Product Code': 'FMLNEW002', Group: 'Ocean sold', Quantities: '' },   // blank → 1
        { 'Product Code': 'FMLNEW003', Group: 'Brand New Line', Quantities: 3 },
        { 'Product Code': 'FMLNEW004', Group: '' },                              // skipped
    ];
    DOM.clear(); el('br-lbl-skus'); el('br-cat-body');
    let opened = null;
    global.UI.showModal = (title) => { opened = title; };
    A.brLoadSkus({ files: [{ name: 'skus.xlsx', _rows: wbRows }], value: '' });
    await new Promise(r => setTimeout(r, 10));
    const body = el('br-cat-body').innerHTML;
    eq('I1 import preview opened', opened, 'Product Catalog');
    ok('I1 flags the blank Quantities row', body.includes('FMLNEW002') && /blank &quot;Quantities&quot;|blank "Quantities"/.test(body), body.slice(0, 400));
    ok('I1 flags the row with no Group as skipped', body.includes('FMLNEW004'));
    ok('I1 announces the new product line', body.includes('Brand New Line'));
    ok('I1 nothing written before confirmation', store.get('br_skus') == null, String(store.get('br_skus')));

    // ── 7. EDITOR: adding the user's real product end-to-end ────────────────
    // The whole point of the feature: add AGENTFMLYANG002 / "Pre Buy 50 bottle"
    // from the UI and have the next report deduct 50 bottles per unit sold.
    store.clear();
    store.set('br_skus', JSON.stringify(LEGACY_SKUS));
    global.window.supabase = null;
    await visitView();
    DOM.clear();
    ['br-cat-body', 'br-bal-rows', 'br-lbl-skus'].forEach(el);
    el('br-cat-code').value   = 'AGENTFMLYANG002';
    el('br-cat-name').value   = 'YANG POWER (AGENT PROMOTION)';
    el('br-cat-attr').value   = 'Pre Buy 50 bottle';
    el('br-cat-group').value  = 'yangPower';
    el('br-cat-qty').value    = '50';
    toasts.length = 0;
    await A.brCatSaveSku();
    ok('E1 save reported success', toasts.some(t => t[0] === 'success'), JSON.stringify(toasts));
    const persisted = JSON.parse(store.get('br_skus') || '{}');
    eq('E1 persisted with unit qty 50', persisted.AGENTFMLYANG002, { group: 'Yang power sold', qty: 50 });

    resetDom(OPENING, Object.keys(OPENING));
    loadBoth(SALES_ROWS.concat([{ 'Purchase Number': 'F1006', 'Product Code': 'AGENTFMLYANG002', Quantity: 18 }]), TRACK_ROWS);
    report = await runGenerate();
    ok('E1 new code now deducts 18 × 50 = 900 (Yang KL 4 + 900)', /Yang power sold\nKL-904\n/.test(report), balBlock(report));
    ok('E1 no unmapped banner once added', el('br-unmapped').style.display === 'none');

    // Validation: unit qty must be >= 1, so a typo cannot silently zero a deduction.
    el('br-cat-code').value = 'FMLBAD001'; el('br-cat-qty').value = '0';
    toasts.length = 0;
    await A.brCatSaveSku();
    ok('E2 rejects unit qty 0', toasts.some(t => t[0] === 'error'), JSON.stringify(toasts));

    // A new product LINE, added from the UI, prints its own block.
    el('br-cat-glabel').value = 'Collagen (K2) sold';
    el('br-cat-gorder').value = '50';
    el('br-cat-gexcl').value  = '';
    el('br-cat-gegg').checked = false;
    toasts.length = 0;
    await A.brCatSaveGroup();
    ok('E3 product line saved', toasts.some(t => t[0] === 'success'), JSON.stringify(toasts));
    el('br-cat-code').value = 'FMLCOL001'; el('br-cat-name').value = ''; el('br-cat-attr').value = '';
    el('br-cat-group').value = 'collagenK2Sold'; el('br-cat-qty').value = '1';
    await A.brCatSaveSku();
    resetDom({ ...OPENING, collagenK2Sold: 500 }, [...Object.keys(OPENING), 'collagenK2Sold']);
    loadBoth(SALES_ROWS.concat([{ 'Purchase Number': 'F1007', 'Product Code': 'FMLCOL001', Quantity: 25 }]), TRACK_ROWS);
    report = await runGenerate();
    ok('E3 new line prints its own balance block', /Collagen \(K2\) sold\nKL-25\nPG-0\nBalance - 475/.test(report), balBlock(report));

    // An invalid exclusion pattern is refused rather than silently disabling itself.
    el('br-cat-glabel').value = 'Bad pattern line'; el('br-cat-gexcl').value = '([';
    toasts.length = 0;
    await A.brCatSaveGroup();
    ok('E4 rejects an invalid exclusion pattern', toasts.some(t => t[0] === 'error'), JSON.stringify(toasts));

    // Deleting a line that still has products is refused (would orphan them).
    toasts.length = 0;
    await A.brCatDeleteGroup('collagenK2Sold');
    ok('E5 refuses to delete a line with products attached',
        toasts.some(t => t[0] === 'error' && /still on this line/.test(t[1])), JSON.stringify(toasts));

    // Non-admin cannot write, even though the handlers are on window.app.
    global.window._appState.cu = { id: 2, role: 'Level 4 Management' };
    toasts.length = 0;
    el('br-cat-code').value = 'SNEAK001'; el('br-cat-qty').value = '1'; el('br-cat-group').value = 'yangPower';
    await A.brCatSaveSku();
    ok('E6 non-admin write denied', toasts.some(t => t[0] === 'error' && /Access denied/.test(t[1])), JSON.stringify(toasts));
    ok('E6 nothing persisted for non-admin', !JSON.parse(store.get('br_skus') || '{}').SNEAK001);
    global.window._appState.cu = SUPER_ADMIN;

    // ── 8. SECTION 3: wholesale groups + monthly targets ────────────────────
    // Same disease as Section 2 — five groups hardcoded in four places, and the
    // only copy carrying source_keys was the one inside brGenerate. A by_group
    // key belonging to no line was dropped from the report without a word.
    const WS = [
        { key:'klKepong',   label:'KL Kepong + SG Puchong & Sunway', source_keys:['KL Kepong','SG Puchong & Sunway'], sort_order:10, active:true },
        { key:'klCheras',   label:'KL Cheras',   source_keys:['KL Cheras'],   sort_order:20, active:true },
        { key:'pgCenter',   label:'PG Center',   source_keys:['PG Center'],   sort_order:30, active:true },
        { key:'pgMainland', label:'PG Mainland', source_keys:['PG Mainland'], sort_order:40, active:true },
        { key:'pgSouth',    label:'PG South',    source_keys:['PG South'],    sort_order:50, active:true },
    ];
    const wsLine = (rep, label) => new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' - .*$', 'm').exec(rep)?.[0];

    // 8a. DB-driven groups reproduce the hardcoded output exactly.
    store.clear();
    global.window.supabase = fakeSb(GROUPS, SKUS, WS, []);
    await visitView();
    resetDom(openingV2, Object.keys(openingV2));
    loadBoth(SALES_ROWS, TRACK_ROWS);
    report = await runGenerate();
    eq('W1 combined-source line matches the hardcoded behaviour',
        wsLine(report, 'KL Kepong + SG Puchong & Sunway'), 'KL Kepong + SG Puchong & Sunway - 7 / 0 / N/A');
    eq('W1 single-source line', wsLine(report, 'KL Cheras'), 'KL Cheras - 2 / 0 / N/A');
    ok('W1 no unassigned banner when every key is on a line',
        el('br-ws-unassigned').style.display === 'none', el('br-ws-unassigned').innerHTML);

    // 8b. A renamed line with a re-pointed source key.
    const WS2 = WS.map(w => w.key === 'klCheras'
        ? { ...w, label: 'KL Cheras & Ampang', source_keys: ['KL Cheras', 'PG South'] } : w);
    store.clear();
    global.window.supabase = fakeSb(GROUPS, SKUS, WS2, []);
    await visitView();
    resetDom(openingV2, Object.keys(openingV2));
    loadBoth(SALES_ROWS, TRACK_ROWS);
    report = await runGenerate();
    eq('W2 renamed line sums its new source keys (2 + 1)',
        wsLine(report, 'KL Cheras & Ampang'), 'KL Cheras & Ampang - 3 / 0 / N/A');
    ok('W2 old label gone', !report.includes('\nKL Cheras - '));

    // 8c. An egg-run group on NO line is surfaced, not silently dropped.
    const WS3 = WS.filter(w => w.key !== 'pgMainland' && w.key !== 'pgSouth');
    store.clear();
    global.window.supabase = fakeSb(GROUPS, SKUS, WS3, []);
    await visitView();
    resetDom(openingV2, Object.keys(openingV2));
    loadBoth(SALES_ROWS, TRACK_ROWS);
    report = await runGenerate();
    ok('W3 unassigned banner shown', el('br-ws-unassigned').style.display === '');
    const wsBanner = el('br-ws-unassigned').innerHTML;
    ok('W3 names both orphaned groups', wsBanner.includes('PG Mainland') && wsBanner.includes('PG South'), wsBanner);
    ok('W3 counts the lost cartons', wsBanner.includes('2 cartons left out of the report'), wsBanner);
    ok('W3 report omits the deleted lines', !report.includes('PG Mainland - '));

    // 8d. Targets: dynamic keys, DB write, and DB-over-local precedence.
    store.clear();
    targetWrites.length = 0;
    global.window.supabase = fakeSb(GROUPS, SKUS, WS, []);
    await visitView();
    DOM.clear(); el('br-tgt-rows');
    for (const w of WS) el(`br-tgt-${w.key}`).value = String(({ klKepong: 350, klCheras: 120 })[w.key] ?? 0);
    toasts.length = 0;
    await A.brSaveTargets();
    ok('W4 target save succeeded', toasts.some(t => t[0] === 'success'), JSON.stringify(toasts));
    const mkNow = (() => { const d = new Date(); return `${d.getFullYear()}_${String(d.getMonth()+1).padStart(2,'0')}`; })();
    eq('W4 wrote every catalog group to the DB', targetWrites.length, WS.length);
    eq('W4 target row shape', targetWrites.find(r => r.group_key === 'klKepong').target, 350);
    eq('W4 month_key matches the client month', targetWrites[0].month_key, mkNow);
    eq('W4 mirrored to localStorage', JSON.parse(store.get(`br_targets_${mkNow}`)).klKepong, 350);

    // A target held only in the DB (set on another device) must reach the report.
    store.clear();
    global.window.supabase = fakeSb(GROUPS, SKUS, WS, [{ group_key: 'klKepong', target: 400 }]);
    await visitView();
    resetDom(openingV2, Object.keys(openingV2));
    loadBoth(SALES_ROWS, TRACK_ROWS);
    report = await runGenerate();
    eq('W5 DB target reaches the report (was localStorage-only → N/A)',
        wsLine(report, 'KL Kepong + SG Puchong & Sunway'), 'KL Kepong + SG Puchong & Sunway - 7 / 0 / 400');

    // 8e. Editor: validation, stable key on rename, and the write gate.
    store.clear();
    wsWrites.length = 0;
    global.window.supabase = fakeSb(GROUPS, SKUS, WS, []);
    await visitView();
    DOM.clear(); ['br-cat-body', 'br-tgt-rows'].forEach(el);
    el('br-ws-label').value = 'New Region'; el('br-ws-order').value = '60'; el('br-ws-extra').value = '';
    toasts.length = 0;
    await A.brCatSaveWs();
    ok('W6 refuses a line with no source keys (it would always report 0)',
        toasts.some(t => t[0] === 'error' && /at least one/.test(t[1])), JSON.stringify(toasts));

    el('br-ws-extra').value = 'JB Tebrau, JB Skudai';
    toasts.length = 0;
    await A.brCatSaveWs();
    ok('W7 saves with free-text source keys', toasts.some(t => t[0] === 'success'), JSON.stringify(toasts));
    eq('W7 source keys split and trimmed', wsWrites.at(-1).source_keys, ['JB Tebrau', 'JB Skudai']);
    eq('W7 key slugged from the label', wsWrites.at(-1).key, 'newRegion');

    // Renaming must NOT regenerate the key — it is the target key and DOM id.
    A.brCatEditWs('klKepong');
    el('br-ws-label').value = 'KL Kepong (merged)';
    el('br-ws-order').value = '10'; el('br-ws-extra').value = 'KL Kepong, SG Puchong & Sunway';
    wsWrites.length = 0;
    await A.brCatSaveWs();
    eq('W8 rename keeps the key so the saved target is not orphaned', wsWrites.at(-1).key, 'klKepong');
    eq('W8 label updated', wsWrites.at(-1).label, 'KL Kepong (merged)');

    global.window._appState.cu = { id: 2, role: 'Level 4 Management' };
    wsWrites.length = 0; toasts.length = 0;
    el('br-ws-label').value = 'Sneak'; el('br-ws-extra').value = 'X';
    await A.brCatSaveWs();
    ok('W9 non-admin wholesale write denied',
        toasts.some(t => t[0] === 'error' && /Access denied/.test(t[1])), JSON.stringify(toasts));
    eq('W9 nothing written', wsWrites.length, 0);
    toasts.length = 0;
    await A.brSaveTargets();
    ok('W9 non-admin target save denied', toasts.some(t => t[0] === 'error' && /Access denied/.test(t[1])));
    global.window._appState.cu = SUPER_ADMIN;

    // 8f. Pre-migration: wholesale table absent while products exist.
    store.clear();
    global.window.supabase = fakeSb(GROUPS, SKUS, undefined, undefined);
    await visitView();
    resetDom(openingV2, Object.keys(openingV2));
    loadBoth(SALES_ROWS, TRACK_ROWS);
    report = await runGenerate();
    eq('W10 falls back to the hardcoded five when the table is absent',
        wsLine(report, 'KL Kepong + SG Puchong & Sunway'), 'KL Kepong + SG Puchong & Sunway - 7 / 0 / N/A');
    eq('W10 all five lines present',
        report.split('________________________________________')[1].trim().split('\n').length - 1, 5);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
};

run().catch(e => { console.error('HARNESS ERROR: ' + (e && e.stack || e)); process.exit(1); });
