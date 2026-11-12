#!/usr/bin/env node
/**
 * ci/browser-agent-stock.js — 📦 My stock (agents' own pieces in hand), the
 * real screens in a real browser (built chunks: run `node build.mjs` first).
 *
 * Mock admin login + an in-memory supabase (nothing reaches Supabase):
 *   desktop — delivery board button "🤝 Agent stock" → 📦 My stock tab (empty) →
 *   ➕ Add stock for an agent → the row with its count → Items screen: "Whose
 *   stock?" shows "(3 in hand)" → ➖ Take out → History;
 *   phone — the stock tab and the add form fit the screen, rows as cards.
 * The SQL side (ledger, triggers, who sees) is ci/sql/agent-stock-scenario.sql.
 *
 * Usage: node ci/browser-agent-stock.js [screenshot-dir]
 * Exit 0 = all pass. Exit 1 = failures.
 */
'use strict';
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const PORT = 8095;
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.argv[2] || null;

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
    if (ok) { pass++; console.log(`  ok   ${name}`); return; }
    fail++;
    console.log(`  FAIL ${name}${extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 400) : ''}`);
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Runs in the page: an admin, an in-memory store and the stock RPCs.
const installFakes = () => {
    window._appState.cu = { id: 1, username: 'admin', full_name: 'Oo Kean Cherng', role: 'Level 1 Super Admin', status: 'active', email: 'a@example.test' };
    const USERS = [
        { id: 1, full_name: 'Oo Kean Cherng', role: 'Level 1 Super Admin', status: 'active' },
        { id: 5, full_name: 'Lau Mian Mian', role: 'Level 6 Senior Consultant', status: 'active' },
        { id: 6, full_name: 'Kim Lee', role: 'Level 9 Consultant', status: 'active' },
    ];
    const PRODUCTS = [
        { id: 41, name: '元亨利贞 Yuan Heng Li Zhen', subcategory: 'Calligraphy Adornment' },
        { id: 42, name: '天道酬勤 Tian Dao Chou Qin', subcategory: 'Calligraphy Adornment' },
        { id: 43, name: '上龙柄 Shang Long Bing', subcategory: 'Artistic Masterpieces' },
        { id: 51, name: '财库 Cai Ku', subcategory: 'Royal Woodwork Series' },
    ];
    const T = {
        customers: [{ id: 77, full_name: 'Tan Soo Chi', phone: '0123456789', responsible_agent_id: 5 }],
        purchases: [{ id: 1, customer_id: 77, item: 'Calligraphy Series: 元亨利貞', invoice: '1935530', date: '2026-10-01', delivery_status: 'Pending Delivery', payment_method: 'Cash', status: 'COMPLETED', agent_id: 5 }],
        delivery_items: [{ id: 11, customer_id: 77, purchase_id: 1, item_name: 'Calligraphy Series: 元亨利貞', qty: 1, status: 'pending', photos: [], expected_ready_date: '2027-02-01' }],
        delivery_advances: [],
        agent_stock_moves: [],
    };
    window.__T = T;
    window.__calls = [];
    let nextId = 500;
    const match = (r, f) => f.every(([op, c, v]) => op === 'eq' ? String(r[c]) === String(v) : op === 'is' ? (r[c] ?? null) === v : v.map(String).includes(String(r[c])));
    const from = (t) => {
        const f = []; let mode = 'select', payload = null, head = false;
        const run = () => {
            const rows = T[t] || (T[t] = []);
            if (mode === 'insert') {
                const list = (Array.isArray(payload) ? payload : [payload]).map(p => ({ id: ++nextId, created_by: 1, ...p }));
                if (t === 'agent_stock_moves') list.forEach(m => { const pr = PRODUCTS.find(x => x.id === m.product_id); if (pr) m.item_name = pr.name; });
                window.__calls.push(['insert', t, payload]);
                rows.push(...list); return { data: list, error: null };
            }
            const hit = rows.filter(r => match(r, f));
            if (mode === 'update') { hit.forEach(r => Object.assign(r, payload)); return { data: hit, error: null }; }
            if (mode === 'delete') { T[t] = rows.filter(r => !hit.includes(r)); return { data: hit, error: null }; }
            if (head) return { data: null, count: hit.length, error: null };
            return { data: hit.map(r => ({ ...r })), error: null };
        };
        const q = {
            select: (_c, o) => { if (o && o.head) head = true; return q; }, order: () => q, limit: () => q,
            eq: (c, v) => { f.push(['eq', c, v]); return q; }, in: (c, v) => { f.push(['in', c, v]); return q; }, is: (c, v) => { f.push(['is', c, v]); return q; },
            neq: () => q,
            insert: (p) => { mode = 'insert'; payload = p; return q; }, update: (p) => { mode = 'update'; payload = p; return q; }, delete: () => { mode = 'delete'; return q; },
            then: (ok, ko) => Promise.resolve(run()).then(ok, ko),
        };
        return q;
    };
    const balance = (agent) => {
        const g = new Map();
        T.agent_stock_moves.filter(m => agent == null || m.agent_id === agent).forEach(m => {
            const k = m.agent_id + '|' + (m.product_id ?? 'n:' + m.item_name);
            const v = g.get(k) || { agent_id: m.agent_id, product_id: m.product_id ?? null, item_name: m.item_name, in_hand: 0, lent_out: 0, owned: 0, next_back: null, last: null };
            v.in_hand += m.qty;
            if (['lent', 'returned', 'unlent'].includes(m.kind)) v.lent_out -= m.qty; else v.owned += m.qty;
            if (!v.last || m.move_date >= v.last.move_date) v.last = m;
            g.set(k, v);
        });
        return [...g.values()].map(v => ({ ...v, last_date: v.last.move_date, last_kind: v.last.kind, last_qty: v.last.qty }));
    };
    const rpc = async (name, args) => {
        window.__calls.push(['rpc', name, args]);
        if (name === 'agent_stock_products') return { data: PRODUCTS, error: null };
        if (name === 'agent_stock_balance') return { data: balance(args.p_agent), error: null };
        if (name === 'agent_stock_counts') {
            const pid = /元亨利[贞貞]/.test(args.p_item) ? 41 : null;
            return { data: balance(null).filter(r => pid && r.product_id === pid).map(r => ({ agent_id: r.agent_id, product_id: pid, in_hand: r.in_hand })), error: null };
        }
        if (name === 'delivery_advance_eligible') return { data: [11], error: null };
        return { data: [], error: null };
    };
    const real = window.supabase;
    window.supabase = new Proxy(real || {}, { get: (o, k) => (k === 'rpc' ? rpc : k === 'from' ? from
        : k === 'storage' ? { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) } : o[k]) });
    const s = window.AppDataStore;
    const byId = (t, id) => { const r = (T[t] || []).find(x => String(x.id) === String(id)); return r ? { ...r } : null; };
    Object.assign(s, {
        getAll: async (t) => (t === 'users' ? USERS : (T[t] || [])),
        query: async () => [], getById: async (t, id) => byId(t, id), getByIdFull: async (t, id) => byId(t, id),
        queryPaged: async (t) => (T[t] || []).map(r => ({ ...r })), queryAdvanced: async () => ({ data: [], count: 0 }), getActiveProspects: async () => [],
    });
    window._crmUtils.getVisibleCustomers = async () => T.customers.map(c => ({ ...c }));
    window.confirm = () => true;
    window.__toasts = [];
    for (const k of ['success', 'error', 'info', 'warning']) {
        const orig = window.UI.toast[k];
        window.UI.toast[k] = (m) => { window.__toasts.push(`${k}: ${m}`); return orig && orig.call(window.UI.toast, m); };
    }
};

const bootPage = async (page) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(4000);
    await page.evaluate(() => {
        document.getElementById('login-container')?.style.setProperty('display', 'none');
        const shell = document.getElementById('app-shell');
        if (shell) { shell.style.display = 'flex'; shell.style.visibility = 'visible'; }
    });
    await page.evaluate(installFakes);
    await page.evaluate(() => window._loadChunk('chunks/script-customers.min.js'));
};
const modalText = (page) => page.evaluate(() => document.querySelector('#global-modal-overlay.active')?.innerText || '');
const clickButton = (page, re) => page.evaluate((src) => {
    const rx = new RegExp(src);
    const b = [...document.querySelectorAll('#global-modal-overlay.active button')].find(x => rx.test(x.textContent.trim()));
    if (b) b.click();
    return !!b;
}, re.source);
const setVal = (page, id, v) => page.evaluate((i, val) => { const el = document.getElementById(i); el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); }, id, v);

async function main() {
    const server = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore' });
    await sleep(1500);
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const pageErrors = [];
    const newPage = async (vp) => {
        const page = await browser.newPage();
        await page.setViewport(vp);
        page.on('pageerror', e => pageErrors.push(e.message));
        await page.setRequestInterception(true);
        page.on('request', r => (/supabase\.co|vercel|posthog|ui-avatars/.test(r.url()) ? r.abort() : r.continue()));
        return page;
    };
    const shotOf = (page) => async (name) => {
        if (!SHOTS) return;
        fs.mkdirSync(SHOTS, { recursive: true });
        await sleep(700); // let the modal finish fading in
        const h = await page.$('#global-modal-overlay.active .modal-box') || await page.$('#global-modal-overlay.active');
        await (h || page).screenshot({ path: path.join(SHOTS, name + '.png') });
    };
    try {
        // ── desktop ─────────────────────────────────────────────────────────
        console.log('\nDesktop · delivery board → 🤝 Agent stock');
        const page = await newPage({ width: 1366, height: 900 });
        const shot = shotOf(page);
        await bootPage(page);
        await page.evaluate(() => window.app.openDeliveryListing());
        await page.waitForFunction(() => /Tan Soo Chi/.test(document.getElementById('delivery-listing-body')?.innerText || ''), { timeout: 8000 }).catch(() => {});
        const listing = await modalText(page);
        check('delivery board button says 🤝 Agent stock', /🤝 Agent stock/.test(listing) && !/Agent advances/.test(listing), listing.slice(0, 300));
        check('button opens on the stock tab', await clickButton(page, /^🤝 Agent stock/));
        await sleep(500);
        let t = await modalText(page);
        check('board: title, 📦 My stock first, empty message', /🤝 Agent stock/.test(t) && /📦 My stock\s*Owed \(0\)/.test(t) && /No stock entered yet/.test(t), t.slice(0, 400));
        await shot('1-empty');

        console.log('\nDesktop · ➕ Add stock');
        check('➕ Add stock opens the form', await clickButton(page, /^➕ Add stock$/));
        await sleep(400);
        t = await modalText(page);
        const groups = await page.evaluate(() => [...document.querySelectorAll('#adv-st-product optgroup')].map(g => g.label));
        check('form: whose stock (admin) + product groups', !!(await page.$('#adv-st-agent')) && JSON.stringify(groups) === JSON.stringify(['Calligraphy', 'Artistic Masterpieces', '财库 / 财托']), groups);
        await shot('2-add-form');
        await setVal(page, 'adv-st-agent', '5');
        await setVal(page, 'adv-st-product', '41');
        await setVal(page, 'adv-st-qty', '3');
        await clickButton(page, /^Save$/);
        await sleep(600);
        const ins = await page.evaluate(() => window.__calls.filter(c => c[0] === 'insert' && c[1] === 'agent_stock_moves').map(c => c[2]));
        check('saved: Lau, 元亨利贞, 3, added', ins.length === 1 && ins[0].agent_id === 5 && ins[0].product_id === 41 && ins[0].qty === 3 && ins[0].kind === 'added', ins);
        t = await modalText(page);
        check('board row: Lau Mian Mian · 元亨利贞 · 3 in hand', /Lau Mian Mian\s*元亨利贞 Yuan Heng Li Zhen\s*3/.test(t), t.slice(0, 600));
        check('toast: Added 3 × …', await page.evaluate(() => window.__toasts.some(x => /success: Added 3 × 元亨利贞/.test(x))));
        await shot('3-board-row');

        console.log('\nDesktop · handover "Whose stock?" shows the count');
        await page.evaluate(() => window.app.openDeliveryItems('purchase', 1, 77));
        await sleep(500);
        const opts = await page.evaluate(() => [...document.querySelectorAll('#di-lender option')].map(o => o.textContent));
        check('Whose stock? lists the owner too, with counts', opts.includes('Lau Mian Mian (3 in hand)') && opts.includes('Oo Kean Cherng (0 in hand)') && opts.includes('Kim Lee (0 in hand)'), opts);
        check('defaults to the sale agent', await page.evaluate(() => document.getElementById('di-lender').value) === '5');
        await setVal(page, 'di-source', 'agent');
        await sleep(200);
        await shot('4-whose-stock');

        console.log('\nDesktop · ➖ Take out + History');
        await page.evaluate(() => window.app.openAgentAdvances('stock'));
        await sleep(400);
        check('➖ Take out button on the row', await clickButton(page, /^➖ Take out$/));
        await sleep(300);
        t = await modalText(page);
        check('take-out form: 3 in hand, reasons', /3 in hand/.test(t) && /Counted wrong/.test(await page.evaluate(() => document.getElementById('adv-out-why').innerHTML)), t.slice(0, 300));
        await shot('5-take-out');
        await setVal(page, 'adv-out-why', 'Damaged');
        await clickButton(page, /^Take out$/);
        await sleep(500);
        t = await modalText(page);
        check('after take out: 2 in hand, last change −1', /元亨利贞 Yuan Heng Li Zhen\s*2/.test(t) && /➖ Taken out −1/.test(t), t.slice(0, 600));
        check('History opens the lines', await clickButton(page, /^History$/));
        await sleep(400);
        t = await modalText(page);
        check('history: added +3 and taken out −1 with reason', /➕ Added\s*\+3/.test(t) && /➖ Taken out\s*−1\s*Damaged/.test(t), t.slice(0, 500));
        await shot('6-history');
        await page.close();

        // ── phone ───────────────────────────────────────────────────────────
        console.log('\nPhone');
        const phone = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
        const pshot = shotOf(phone);
        await bootPage(phone);
        await phone.evaluate(() => {
            window.__T.agent_stock_moves.push(
                { id: 1, agent_id: 5, product_id: 41, item_name: '元亨利贞 Yuan Heng Li Zhen', qty: 3, kind: 'added', move_date: '2026-11-01', created_by: 1 },
                { id: 2, agent_id: 6, product_id: 51, item_name: '财库 Cai Ku', qty: -1, kind: 'lent', move_date: '2026-11-10', note: 'given to Tan Soo Chi', created_by: 1 });
        });
        await phone.evaluate(() => window.app.openAgentAdvances('stock'));
        await sleep(600);
        const wide = async () => phone.evaluate(() => {
            const box = document.querySelector('#global-modal-overlay.active .modal-box') || document.body;
            return { sw: box.scrollWidth, cw: box.clientWidth, doc: document.documentElement.scrollWidth, vw: window.innerWidth };
        });
        const w1 = await wide();
        check('phone stock tab fits the screen (no sideways scroll)', w1.doc <= w1.vw + 1, w1);
        const pt = await modalText(phone);
        check('phone: totals + both agents, minus shown, holders in words', /All agents/.test(pt) && /1 agent holding/.test(pt) && /0 agents holding/.test(pt) && /Lau Mian Mian/.test(pt) && /Kim Lee/.test(pt) && /−1/.test(pt), pt.slice(0, 500));
        await pshot('7-phone-stock');
        await phone.evaluate(() => window.app.advStockAdd());
        await sleep(400);
        const w2 = await wide();
        check('phone add form fits the screen', w2.doc <= w2.vw + 1, w2);
        await pshot('8-phone-add');
        await phone.close();

        check('no page errors', pageErrors.length === 0, pageErrors);
    } finally {
        await browser.close();
        server.kill();
    }
    console.log(`\nbrowser-agent-stock: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
