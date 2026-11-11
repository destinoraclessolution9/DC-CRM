#!/usr/bin/env node
/**
 * ci/browser-office-notice.js — 🏢 office "ready for collection" notices, the
 * real screens in a real browser (built chunks: run `node build.mjs` first).
 *
 * Mock admin login + an in-memory supabase (nothing reaches Supabase):
 *   desktop — delivery board (Step column + step chips + 📷 Office photos),
 *   notices list, review (colours, ticks, item choice) → Confirm → apply call,
 *   Items screen (🏢 line, 📥 Collected, 📲 Tell customer → WhatsApp + told);
 *   phone — review + Items screen as cards, nothing wider than the screen.
 * The SQL side (matching, apply, pushes) is ci/sql/office-notice-scenario.sql.
 *
 * Usage: node ci/browser-office-notice.js [screenshot-dir]
 * Exit 0 = all pass. Exit 1 = failures.
 */
'use strict';
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const PORT = 8094;
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.argv[2] || null;

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
    if (ok) { pass++; console.log(`  ok   ${name}`); return; }
    fail++;
    console.log(`  FAIL ${name}${extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 400) : ''}`);
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Runs in the page: an admin, an in-memory store and the notice RPCs.
const installFakes = () => {
    window._appState.cu = { id: 1, username: 'admin', full_name: 'Oo Kean Cherng', role: 'Level 1 Super Admin', status: 'active', email: 'a@example.test' };
    const T = {
        customers: [{ id: 77, full_name: 'Tan Soo Chi', phone: '0123456789', responsible_agent_id: 1 }, { id: 78, full_name: 'Oo Kean Cherng', phone: '0198765432', responsible_agent_id: 1 }],
        purchases: [
            { id: 1, customer_id: 77, item: '财库，财托', invoice: '1908016', date: '2026-02-28', delivery_status: 'Pending Delivery', payment_method: 'Cash', status: 'COMPLETED' },
            { id: 2, customer_id: 78, item: 'Calligraphy Series: 元亨利貞', invoice: '1935530', date: '2026-06-11', delivery_status: 'Pending Delivery', payment_method: 'Cash', status: 'COMPLETED' },
        ],
        delivery_items: [
            { id: 11, customer_id: 77, purchase_id: 1, item_name: '财库，财托', qty: 1, status: 'pending', photos: [], expected_ready_date: '2026-12-01' },
            { id: 25, customer_id: 78, purchase_id: 2, item_name: 'Calligraphy Series: 元亨利貞', qty: 1, status: 'pending', photos: [], expected_ready_date: '2026-10-09',
              office_ready_date: '2026-05-22', office_ready_place: 'LVL 20, KL HQ', office_notice_id: 900 },
        ],
        office_notices: [{ id: 900, created_at: '2026-11-11T02:00:00Z', status: 'read', is_ready_list: true, photo_path: 'office-notices/2026-11/a.jpg',
            title: '財庫 pls collect on 11 NOV 2026,WED - lvl 20', category: '財庫', collect_date: '2026-11-11', collect_time: null, place: 'lvl 20', read_provider: 'gemini-2.5-flash' }],
        office_notice_lines: [{ id: 1, notice_id: 900, applied_at: null }, { id: 2, notice_id: 900, applied_at: null }, { id: 3, notice_id: 900, applied_at: null }],
        delivery_advances: [],
    };
    window.__T = T;
    window.__calls = [];
    window.__opened = [];
    window.open = (u) => { window.__opened.push(u); return null; };
    const match = (r, f) => f.every(([op, c, v]) => op === 'eq' ? String(r[c]) === String(v) : op === 'neq' ? String(r[c]) !== String(v) : v.map(String).includes(String(r[c])));
    const from = (t) => {
        const f = []; let mode = 'select', payload = null, head = false;
        const run = () => {
            const rows = T[t] || (T[t] = []);
            if (mode === 'insert') { const list = (Array.isArray(payload) ? payload : [payload]).map(p => ({ id: Math.floor(Math.random() * 1e6), ...p })); rows.push(...list); return { data: list, error: null }; }
            const hit = rows.filter(r => match(r, f));
            if (mode === 'update') { window.__calls.push(['update', t, payload]); hit.forEach(r => Object.assign(r, payload)); return { data: hit, error: null }; }
            if (head) return { data: null, count: hit.length, error: null };
            return { data: hit.map(r => ({ ...r })), error: null };
        };
        const q = {
            select: (_c, o) => { if (o && o.head) head = true; return q; }, order: () => q, limit: () => q,
            eq: (c, v) => { f.push(['eq', c, v]); return q; }, neq: (c, v) => { f.push(['neq', c, v]); return q; }, in: (c, v) => { f.push(['in', c, v]); return q; },
            insert: (p) => { mode = 'insert'; payload = p; return q; }, update: (p) => { mode = 'update'; payload = p; return q; }, delete: () => { mode = 'delete'; return q; },
            then: (ok, ko) => Promise.resolve(run()).then(ok, ko),
        };
        return q;
    };
    const O = (kind, id, customer_name, item, invoice, items, extra = {}) => ({ kind, id, customer_id: 77, customer_name, item, invoice, order_date: '2026-02-28', delivery_status: 'Pending Delivery', agent_id: 1, agent_name: 'Oo Kean Cherng', items, ...extra });
    window.__cands = [
        { id: 1, line_no: 1, sn_raw: '19029678', sn_norm: '19029678', grp: 'LIM CY', dealer: 'PHANG SIEW IM', customer: 'CHU BOON LIN', item: '財庫', orders: [] },
        { id: 2, line_no: 2, sn_raw: '1908016', sn_norm: '1908016', grp: 'LIM CY', dealer: 'OO KEAN CHERNG', customer: 'MANJUNG PROFESSIONAL SKIN SOLUTIONS', item: '財庫',
          orders: [O('purchase', 1, 'Tan Soo Chi', '财库，财托', '1908016', [{ id: 11, item_name: '财库，财托', status: 'pending', office_ready_date: null }])] },
        { id: 3, line_no: 3, sn_raw: '1935530', sn_norm: '1935530', grp: 'LIM CY', dealer: 'OO KEAN CHERNG', customer: 'OO KEAN CHERNG', item: '元亨利貞',
          orders: [O('purchase', 2, 'Oo Kean Cherng', 'Calligraphy Series: 元亨利貞', '1935530', [{ id: 25, item_name: 'Calligraphy Series: 元亨利貞', status: 'pending', office_ready_date: null }])] },
    ];
    const rpc = async (name, args) => {
        window.__calls.push(['rpc', name, args]);
        if (name === 'office_notice_candidates') return { data: window.__cands, error: null };
        if (name === 'office_lead_times') return { data: [
            { grp: 'Calligraphy Adornment', set_days: 120, pieces: 9, median_days: 113, min_days: 82, max_days: 343, examples: '元亨利贞 · 天至喜 1 · 天道酬勤' },
            { grp: 'Power Ring', set_days: 180, pieces: 3, median_days: 138, min_days: 101, max_days: 138, examples: 'PR 4 · PR 5' },
        ], error: null };
        if (name === 'office_notice_apply') {
            for (const p of args.p_picks) { const l = window.__cands.find(x => x.id === p.line_id); if (l) { l.applied_at = '2026-11-11T03:00:00Z'; l.delivery_item_id = p.item_id; l.decision = 'apply'; } }
            T.office_notices[0].status = 'applied';
            return { data: { applied: args.p_picks.length, created: 0, pushed: 1 }, error: null };
        }
        return { data: [], error: null };
    };
    const real = window.supabase;
    window.supabase = new Proxy(real || {}, { get: (o, k) => (k === 'rpc' ? rpc : k === 'from' ? from
        : k === 'functions' ? { invoke: async (fn, b) => { window.__calls.push(['invoke', fn, b && b.body]); return { data: { ok: true, lines: 3 }, error: null }; } }
        : k === 'storage' ? { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) } : o[k]) });
    const s = window.AppDataStore;
    const byId = (t, id) => { const r = (T[t] || []).find(x => String(x.id) === String(id)); return r ? { ...r } : null; };
    Object.assign(s, {
        getAll: async (t) => (t === 'users' ? [{ id: 1, full_name: 'Oo Kean Cherng', role: 'Level 1 Super Admin' }] : (T[t] || [])),
        query: async () => [], getById: async (t, id) => byId(t, id), getByIdFull: async (t, id) => byId(t, id),
        queryPaged: async (t) => (T[t] || []).map(r => ({ ...r })), queryAdvanced: async () => ({ data: [], count: 0 }), getActiveProspects: async () => [],
    });
    window._crmUtils.getVisibleCustomers = async () => T.customers.map(c => ({ ...c }));
    window._openAttachment = (p) => { window.__calls.push(['photo', p]); };
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
        console.log('\nDesktop · delivery board');
        const page = await newPage({ width: 1366, height: 900 });
        const shot = shotOf(page);
        await bootPage(page);
        await page.evaluate(() => window.app.openDeliveryListing());
        await page.waitForFunction(() => /Tan Soo Chi/.test(document.getElementById('delivery-listing-body')?.innerText || ''), { timeout: 8000 }).catch(() => {});
        const board = await page.evaluate(() => document.getElementById('delivery-listing-body')?.innerText || '');
        check('board has the Step column', /\bStep\b/i.test(board), board.slice(0, 300));
        check('Oo Kean Cherng\'s 元亨利貞 shows 🏢 Ready at office + date', /🏢 Ready at office\s*22 May 2026 · LVL 20, KL HQ/.test(board), board);
        check('step chips with counts + 📷 Office photos', /🏢 Ready at office \(1\)/.test(board) && /📥 With agent \(0\)/.test(board) && /📲 Customer told \(0\)/.test(board) && /📷 Office photos/.test(board));
        await shot('1-board');
        await page.evaluate(() => window.app._setDeliveryStageFilter('office'));
        await sleep(300);
        const filtered = await page.evaluate(() => document.getElementById('delivery-listing-body')?.innerText || '');
        check('🏢 chip filters the board to that line', /Oo Kean Cherng/.test(filtered) && !/Tan Soo Chi/.test(filtered), filtered.slice(0, 400));
        await page.evaluate(() => window.app._setDeliveryStageFilter('told'));
        await sleep(300);
        const empty = await page.evaluate(() => document.getElementById('delivery-listing-body')?.innerText || '');
        check('a step with nothing on it says so (not "No pending deliveries")', /Nothing at "Customer told" right now/.test(empty) && !/No pending deliveries/.test(empty), empty.slice(-200));
        await page.evaluate(() => window.app._setDeliveryStageFilter('told'));

        console.log('\nDesktop · notices list + review');
        await page.evaluate(() => window.app.openOfficeNotices());
        await sleep(300);
        const list = await modalText(page);
        check('notices list: upload box + the sheet with collect date', /Upload the office's photo/.test(list) && /財庫 pls collect on 11 NOV 2026/.test(list) && /11 Nov 2026/.test(list), list.slice(0, 400));
        await shot('2-notices');
        await page.evaluate(() => { const d = document.getElementById('ofn-lead'); d.open = true; d.dispatchEvent(new Event('toggle')); });
        await sleep(400);
        const times = await modalText(page);
        check('⏱ real times: CRM setting vs real per group', /How long pieces really take/.test(times) && /Calligraphy Adornment/.test(times)
            && /3\.8 months\s*about right/i.test(times) && /4\.6 months\s*faster than set/i.test(times) && /From 12 pieces/.test(times), times.slice(-700));
        check('⏱ asked the database once', await page.evaluate(() => window.__calls.filter(c => c[1] === 'office_lead_times').length) >= 1);
        await shot('2b-times');
        await page.evaluate(() => window.app.openOfficeNotice(900));
        await sleep(400);
        const rev = await modalText(page);
        check('summary line', /3 lines/.test(rev) && /🟢 1 ready to mark/.test(rev) && /🟡 1 to check/.test(rev) && /⚪ 1 not in the CRM/.test(rev), rev.slice(0, 500));
        check('amber: company on the sheet vs Tan Soo Chi in the CRM', /Name differs \("MANJUNG PROFESSIONAL SKIN SOLUTIONS" vs "Tan Soo Chi"\)/.test(rev));
        const ticks = await page.evaluate(() => [...document.querySelectorAll('.ofn-pick')].map(b => [b.value, b.checked]));
        check('Tan Soo Chi unticked, Oo Kean Cherng ticked', JSON.stringify(ticks) === JSON.stringify([['1', false], ['2', true]]), ticks);
        check('Chu Boon Lin under "Not in the CRM" with Not ours', await page.evaluate(() => {
            const d = [...document.querySelectorAll('#ofn-panel details')][0];
            return !!d && !d.open && /CHU BOON LIN/.test(d.textContent) && /Not ours/.test(d.textContent);
        }));
        await page.evaluate(() => { [...document.querySelectorAll('#ofn-panel details')].forEach(d => { d.open = true; }); });
        await shot('3-review');
        // tick the amber row too, then Confirm
        await page.evaluate(() => { document.querySelector('.ofn-pick[value="1"]').checked = true; });
        await page.evaluate(() => [...document.querySelectorAll('#global-modal-overlay.active button')].find(b => b.textContent.trim() === 'Confirm ticked').click());
        await sleep(600);
        const apply = await page.evaluate(() => window.__calls.find(c => c[1] === 'office_notice_apply'));
        check('Confirm → apply with both lines and their items', apply && JSON.stringify(apply[2].p_picks.map(p => [p.line_id, p.order_id, p.item_id])) === JSON.stringify([[2, 1, 11], [3, 2, 25]]), apply);
        check('toast: marked ready + agent notified', await page.evaluate(() => window.__toasts.some(t => /2 items marked ready at office · 1 agent notified/.test(t))));
        const after = await modalText(page);
        check('after confirm: rows show ✅ and no Confirm button', /✅ 2 done/.test(after) && !(await page.evaluate(() => [...document.querySelectorAll('#global-modal-overlay.active button')].some(b => b.textContent.trim() === 'Confirm ticked'))), after.slice(0, 300));

        console.log('\nDesktop · items screen');
        await page.evaluate(() => window.app.openDeliveryItems('purchase', 2, 78));
        await sleep(400);
        const items = await modalText(page);
        check('🏢 line with date + place', /🏢 Ready at office · 22 May 2026 · LVL 20, KL HQ/.test(items), items.slice(0, 400));
        check('📥 Collected + 📲 Tell customer buttons', /📥 Collected/.test(items) && /📲 Tell customer/.test(items));
        await shot('4-items');
        await page.evaluate(() => [...document.querySelectorAll('#di-panel button')].find(b => b.textContent.includes('📥 Collected')).click());
        await sleep(500);
        const it2 = await modalText(page);
        check('📥 Collected → line shows who + today, button gone', /📥 Collected \d+ \w+ \d{4} · Oo Kean Cherng/.test(it2) && !/📥 Collected\s*\n?\s*📲/.test(it2), it2.slice(0, 500));
        await page.evaluate(() => [...document.querySelectorAll('#di-panel button')].find(b => b.textContent.includes('📲 Tell customer')).click());
        await sleep(600);
        const wa = await page.evaluate(() => window.__opened[0] || '');
        check('📲 → WhatsApp to the customer with the message', wa.startsWith('https://wa.me/60198765432?text=') && /元亨利貞/.test(decodeURIComponent(wa)), wa.slice(0, 160));
        const it3 = await modalText(page);
        check('📲 Customer told shown, both buttons gone', /📲 Customer told/.test(it3) && !/Tell customer/.test(it3));
        check('handover form still there (photo still required)', /Hand over the ticked item/.test(it3) && /Photo proof/.test(it3));
        await shot('5-items-after');
        await page.close();

        // ── phone ───────────────────────────────────────────────────────────
        console.log('\nPhone');
        const phone = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
        const pshot = shotOf(phone);
        await bootPage(phone);
        await phone.evaluate(() => window.app.openOfficeNotice(900));
        await sleep(500);
        const wide = async () => phone.evaluate(() => {
            const box = document.querySelector('#global-modal-overlay.active .modal-box') || document.body;
            return { sw: box.scrollWidth, cw: box.clientWidth, doc: document.documentElement.scrollWidth, vw: window.innerWidth };
        });
        const w1 = await wide();
        check('phone review fits the screen (no sideways scroll)', w1.doc <= w1.vw + 1, w1);
        check('phone review shows the lines', /MANJUNG/.test(await modalText(phone)));
        await phone.evaluate(() => { [...document.querySelectorAll('#ofn-panel details')].forEach(d => { d.open = true; }); });
        await pshot('6-phone-review');
        await phone.evaluate(() => window.app.openOfficeNotices());
        await sleep(300);
        await phone.evaluate(() => { const d = document.getElementById('ofn-lead'); d.open = true; d.dispatchEvent(new Event('toggle')); });
        await sleep(400);
        const w3 = await wide();
        check('phone ⏱ real times fit the screen', w3.doc <= w3.vw + 1 && /faster than set/i.test(await modalText(phone)), w3);
        await phone.evaluate(() => document.getElementById('ofn-lead').scrollIntoView());
        await pshot('6b-phone-times');
        await phone.evaluate(() => window.app.openDeliveryItems('purchase', 1, 77));
        await sleep(500);
        const w2 = await wide();
        check('phone items screen fits the screen', w2.doc <= w2.vw + 1, w2);
        check('phone items: step buttons there', /📥 Collected/.test(await modalText(phone)) && /📲 Tell customer/.test(await modalText(phone)));
        await pshot('7-phone-items');
        await phone.close();

        check('no page errors', pageErrors.length === 0, pageErrors);
    } finally {
        await browser.close();
        server.kill();
    }
    console.log(`\nbrowser-office-notice: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
