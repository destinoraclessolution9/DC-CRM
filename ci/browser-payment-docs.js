#!/usr/bin/env node
/**
 * ci/browser-payment-docs.js — 📎 Payment documents (up to 50 files per installment
 * sale) on the Product Delivery Listing, and their link into the POP lapse receipt.
 * Built chunks: run `node build.mjs` first.
 *
 * Mock admin login + an in-memory supabase (nothing reaches Supabase):
 *   desktop — Installment row shows "Docs 0/50" (Full-payment row has none) →
 *   modal → upload 3 files with a note → 3 / 50 → fill to the cap (extra files
 *   skipped, input locked at 50 / 50) → delete one → note edit →
 *   💵 POP "Paid manually": pick an uploaded file → the RPC gets that file's path
 *   (no second upload) ;
 *   phone — the modal fits the screen.
 * The 50-file trigger + RLS are proven in SQL (see migrations/2026-11-19_purchase_documents.sql).
 *
 * Usage: node ci/browser-payment-docs.js [screenshot-dir]
 */
'use strict';
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const PORT = 8096;
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.argv[2] || null;

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
    if (ok) { pass++; console.log(`  ok   ${name}`); return; }
    fail++;
    console.log(`  FAIL ${name}${extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 400) : ''}`);
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const installFakes = () => {
    window._appState.cu = { id: 1, username: 'admin', full_name: 'Oo Kean Cherng', role: 'Level 1 Super Admin', status: 'active', email: 'a@example.test' };
    const USERS = [
        { id: 1, full_name: 'Oo Kean Cherng', role: 'Level 1 Super Admin', status: 'active' },
        { id: 5, full_name: 'Lau Mian Mian', role: 'Level 6 Senior Consultant', status: 'active' },
    ];
    const T = {
        customers: [
            { id: 77, full_name: 'Toh How Zhuan', phone: '0123456789', responsible_agent_id: 5 },
            { id: 78, full_name: 'Cash Buyer', phone: '0123456780', responsible_agent_id: 5 },
        ],
        purchases: [
            { id: 1, customer_id: 77, item: 'Prosperity Power Ring', invoice: 'PR1908036', date: '2026-09-13', delivery_status: 'Pending Delivery', payment_method: 'POP', installment_tenure: 36, status: 'ONGOING', agent_id: 5 },
            { id: 2, customer_id: 78, item: 'Calligraphy Adornment', invoice: '1935530', date: '2026-10-01', delivery_status: 'Pending Delivery', payment_method: 'Cash', status: 'COMPLETED', agent_id: 5 },
        ],
        delivery_items: [],
        purchase_documents: [],
        pop_installments: [{ id: 901, purchase_id: 1, seq: 3, due_date: '2026-12-13', amount: 499, status: 'lapsed', agent_id: 5, customer_id: 77 }],
        pop_receipts: [],
    };
    window.__T = T;
    window.__calls = [];
    window.__uploads = [];
    let nextId = 500;
    const match = (r, f) => f.every(([op, c, v]) => op === 'eq' ? String(r[c]) === String(v) : v.map(String).includes(String(r[c])));
    const from = (t) => {
        const f = []; let mode = 'select', payload = null, head = false;
        const run = () => {
            const rows = T[t] || (T[t] = []);
            if (mode === 'insert') {
                if (t === 'purchase_documents') {   // the DB trigger: 50 per sale
                    const n = rows.filter(r => r.ref_kind === payload.ref_kind && String(r.ref_id) === String(payload.ref_id)).length;
                    if (n >= 50) return { data: null, error: { message: 'This sale already has 50 documents (the maximum). Delete one first.' } };
                }
                const row = { id: ++nextId, uploaded_by: 1, created_at: new Date().toISOString(), ...payload };
                window.__calls.push(['insert', t, payload]);
                rows.push(row); return { data: [row], error: null };
            }
            const hit = rows.filter(r => match(r, f));
            if (mode === 'update') { hit.forEach(r => Object.assign(r, payload)); return { data: hit, error: null }; }
            if (mode === 'delete') { T[t] = rows.filter(r => !hit.includes(r)); window.__calls.push(['delete', t]); return { data: hit, error: null }; }
            if (head) return { data: null, count: hit.length, error: null };
            return { data: hit.map(r => ({ ...r })), error: null };
        };
        const q = {
            select: (_c, o) => { if (o && o.head) head = true; return q; }, order: () => q, limit: () => q,
            eq: (c, v) => { f.push(['eq', c, v]); return q; }, in: (c, v) => { f.push(['in', c, v]); return q; },
            insert: (p) => { mode = 'insert'; payload = p; return q; }, update: (p) => { mode = 'update'; payload = p; return q; }, delete: () => { mode = 'delete'; return q; },
            maybeSingle: async () => ({ data: null, error: null }),
            then: (ok, ko) => Promise.resolve(run()).then(ok, ko),
        };
        return q;
    };
    const rpc = async (name, args) => { window.__calls.push(['rpc', name, args]); return { data: null, error: null }; };
    const real = window.supabase;
    window.supabase = new Proxy(real || {}, { get: (o, k) => (k === 'rpc' ? rpc : k === 'from' ? from
        : k === 'storage' ? { from: () => ({ upload: async (p) => { window.__uploads.push(p); return { error: null }; }, remove: async () => ({ error: null }) }) } : o[k]) });
    const s = window.AppDataStore;
    const byId = (t, id) => { const r = (T[t] || []).find(x => String(x.id) === String(id)); return r ? { ...r } : null; };
    Object.assign(s, {
        getAll: async (t) => (t === 'users' ? USERS : (T[t] || [])),
        query: async () => [], getById: async (t, id) => (t === 'users' ? USERS.find(u => u.id === Number(id)) : byId(t, id)), getByIdFull: async (t, id) => byId(t, id),
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
    await page.evaluate(() => window._loadChunk('chunks/script-autopilot.min.js'));
};
const modalText = (page) => page.evaluate(() => document.querySelector('#global-modal-overlay.active')?.innerText || '');
const clickButton = (page, re) => page.evaluate((src) => {
    const rx = new RegExp(src);
    const b = [...document.querySelectorAll('#global-modal-overlay.active button')].find(x => rx.test(x.textContent.trim()));
    if (b) b.click();
    return !!b;
}, re.source);

async function main() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdocs-'));
    const mk = (n) => { const p = path.join(tmp, n); fs.writeFileSync(p, '%PDF-1.4 test ' + n); return p; };
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
        await sleep(700);
        const h = await page.$('#global-modal-overlay.active .modal-box') || await page.$('#global-modal-overlay.active');
        await (h || page).screenshot({ path: path.join(SHOTS, name + '.png') });
    };
    const docsCount = (page) => page.evaluate(() => window.__T.purchase_documents.length);
    try {
        console.log('\nDesktop · listing');
        const page = await newPage({ width: 1366, height: 900 });
        const shot = shotOf(page);
        await bootPage(page);
        await page.evaluate(() => window.app.openDeliveryListing());
        await page.waitForFunction(() => /Toh How Zhuan/.test(document.getElementById('delivery-listing-body')?.innerText || ''), { timeout: 8000 }).catch(() => {});
        const rowsInfo = await page.evaluate(() => [...document.querySelectorAll('#delivery-listing-body tbody tr')].map(tr => ({ t: tr.innerText, b: /Docs \d+\/50/.test(tr.innerText) })));
        check('installment row has "Docs 0/50"', rowsInfo.some(r => /Toh How Zhuan/.test(r.t) && /Docs 0\/50/.test(r.t)), rowsInfo);
        check('full-payment row has NO docs button', rowsInfo.some(r => /Cash Buyer/.test(r.t) && !r.b), rowsInfo);
        await shot('1-listing');

        console.log('\nDesktop · upload');
        await page.evaluate(() => window.app.openPaymentDocs('purchase', 1, 77));
        await sleep(500);
        let t = await modalText(page);
        check('modal: title, 0 / 50, empty message', /Payment documents/.test(t) && /0 \/ 50/.test(t) && /No documents yet/.test(t), t.slice(0, 300));
        await shot('2-empty');
        const input = await page.$('#pd-files');
        await input.uploadFile(mk('receipt-aug.pdf'), mk('receipt-sep.pdf'), mk('slip.pdf'));
        await page.evaluate(() => { document.getElementById('pd-note').value = 'Aug + Sep incl. late fee'; });
        await page.evaluate(() => window.app.pdUpload());
        await sleep(900);
        t = await modalText(page);
        check('3 files saved → 3 / 50, names listed', /3 \/ 50/.test(t) && /receipt-aug\.pdf/.test(t) && /slip\.pdf/.test(t), t.slice(0, 500));
        const rows = await page.evaluate(() => window.__T.purchase_documents.map(r => ({ k: r.ref_kind, id: r.ref_id, p: r.file_path, n: r.note })));
        check('rows keyed to purchase 1 with the note + a purchase-docs path', rows.length === 3 && rows.every(r => r.k === 'purchase' && r.id === 1 && /^purchase-docs\/purchase\/1\//.test(r.p) && r.n === 'Aug + Sep incl. late fee'), rows);
        check('uploader name shown', /Oo Kean Cherng/.test(t), t.slice(0, 400));
        await shot('3-three-files');

        console.log('\nDesktop · 50-file cap');
        await page.evaluate(() => { for (let i = 0; i < 46; i++) window.__T.purchase_documents.push({ id: 1000 + i, ref_kind: 'purchase', ref_id: 1, file_path: `purchase-docs/purchase/1/x${i}.pdf`, file_name: `x${i}.pdf`, mime: 'application/pdf', uploaded_by: 1, created_at: new Date().toISOString() }); });
        await page.evaluate(() => window.app.openPaymentDocs('purchase', 1, 77));
        await sleep(500);
        t = await modalText(page);
        check('49 / 50 shown', /49 \/ 50/.test(t), t.slice(0, 200));
        const input2 = await page.$('#pd-files');
        await input2.uploadFile(mk('a.pdf'), mk('b.pdf'), mk('c.pdf'));
        await page.evaluate(() => window.app.pdUpload());
        await sleep(900);
        t = await modalText(page);
        check('only 1 fits → 50 / 50 and 2 skipped', /50 \/ 50/.test(t) && await docsCount(page) === 50 && await page.evaluate(() => window.__toasts.some(x => /2 files skipped/.test(x))), { n: await docsCount(page), t: await page.evaluate(() => window.__toasts) });
        check('input locked at the limit + message', await page.evaluate(() => document.getElementById('pd-files').disabled) && /50-file limit/.test(t), t.slice(0, 300));
        await shot('4-full');

        console.log('\nDesktop · delete + note');
        await page.evaluate(() => window.app.pdSaveNote(1000, 'checked by office'));
        await sleep(200);
        check('note saved', await page.evaluate(() => window.__T.purchase_documents.find(d => d.id === 1000).note) === 'checked by office');
        await page.evaluate(() => window.app.pdDelete(1001));
        await sleep(600);
        check('delete → 49 / 50, input unlocked', await docsCount(page) === 49 && /49 \/ 50/.test(await modalText(page)) && !(await page.evaluate(() => document.getElementById('pd-files').disabled)));

        console.log('\nDesktop · back to list shows the count');
        check('← Back to list', await clickButton(page, /Back to list/));
        await page.waitForFunction(() => /Docs 49\/50/.test(document.getElementById('delivery-listing-body')?.innerText || ''), { timeout: 8000 }).catch(() => {});
        check('listing row now "Docs 49/50"', /Docs 49\/50/.test(await page.evaluate(() => document.getElementById('delivery-listing-body')?.innerText || '')));
        await shot('5-listing-count');

        console.log('\nDesktop · POP lapse receipt uses an uploaded file');
        await page.evaluate(() => { window.__uploads.length = 0; window.__calls.length = 0; });
        await page.evaluate(() => window.app.popPayManual(1, 901));
        await sleep(600);
        t = await modalText(page);
        check('receipt form offers "already uploaded" files', /already uploaded for this sale/.test(t) && await page.evaluate(() => document.querySelectorAll('#pop-pay-doc option').length) > 40, t.slice(0, 400));
        await shot('6-pop-receipt');
        await page.evaluate(() => { const s = document.getElementById('pop-pay-doc'); s.value = 'purchase-docs/purchase/1/x5.pdf'; s.dispatchEvent(new Event('change', { bubbles: true })); });
        await page.evaluate(() => window.app.popSaveReceipt(1));
        await sleep(700);
        const rpcCall = await page.evaluate(() => window.__calls.find(c => c[0] === 'rpc' && c[1] === 'pop_record_receipt'));
        check('pop_record_receipt called with that file path + name', !!rpcCall && rpcCall[2].p_file_path === 'purchase-docs/purchase/1/x5.pdf' && rpcCall[2].p_file_name === 'x5.pdf' && rpcCall[2].p_inst_ids[0] === 901, rpcCall);
        check('no second upload for a picked file', await page.evaluate(() => window.__uploads.length) === 0);
        await page.close();

        console.log('\nPhone');
        const phone = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
        const pshot = shotOf(phone);
        await bootPage(phone);
        await phone.evaluate(() => { for (let i = 0; i < 6; i++) window.__T.purchase_documents.push({ id: 2000 + i, ref_kind: 'purchase', ref_id: 1, file_path: `purchase-docs/purchase/1/p${i}.pdf`, file_name: `bank-in-receipt-august-2026-${i}.pdf`, mime: 'application/pdf', uploaded_by: 1, created_at: new Date().toISOString(), note: 'Aug + Sep, RM 600 incl. late fee' }); });
        await phone.evaluate(() => window.app.openPaymentDocs('purchase', 1, 77));
        await sleep(700);
        const w = await phone.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: window.innerWidth }));
        check('phone: documents modal fits the screen (no sideways scroll)', w.doc <= w.vw + 1, w);
        check('phone: 6 / 50 and the files', /6 \/ 50/.test(await modalText(phone)) && /bank-in-receipt-august/.test(await modalText(phone)));
        await pshot('7-phone');
        await phone.close();

        check('no page errors', pageErrors.length === 0, pageErrors);
    } finally {
        await browser.close();
        server.kill();
        fs.rmSync(tmp, { recursive: true, force: true });
    }
    console.log(`\nbrowser-payment-docs: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
