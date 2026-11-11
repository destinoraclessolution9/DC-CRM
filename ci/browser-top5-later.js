#!/usr/bin/env node
/**
 * ci/browser-top5-later.js — 📋 Today's top 5 · ⏰ Later / ✕ Not now, the real
 * screens in a real browser (built chunks: run `node build.mjs` first).
 *
 * Mock agent login + a fake supabase.rpc (nothing reaches Supabase): the desktop
 * card above the month grid (Later → row gone + Undo line → Undo → row back, a
 * saved meeting redraws the card) and the phone Home "Do today" (⋯ → sheet →
 * Not now). The ranking itself is SQL: ci/sql/top5-later-scenario.sql.
 *
 * Usage: node ci/browser-top5-later.js [screenshot-dir]
 * Exit 0 = all pass. Exit 1 = failures.
 */
'use strict';
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const PORT = 8093;
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.argv[2] || null;

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
    if (ok) { pass++; console.log(`  ok   ${name}`); return; }
    fail++;
    console.log(`  FAIL ${name}${extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 400) : ''}`);
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Runs in the page: an agent, an in-memory store, and the to-do RPCs.
const installFakes = () => {
    window._appState.cu = { id: 42, username: 'kim', full_name: 'Agent Kim', role: 'Level 9 Agent', status: 'active', email: 'kim@example.test' };
    window.__rows = [
        { kind: 'book', icon: '🩺', prospect_id: 101, customer_id: null, name: 'CHEN MEI FONG', why: 'Audit · RM168k · nothing booked · met 6 Nov', rm: 167820, score: 70000, ref_id: null },
        { kind: 'book', icon: '🩺', prospect_id: 102, customer_id: null, name: 'Lim Hui Leng', why: 'Audit · RM44k · nothing booked · last contact 8 Jul', rm: 43960, score: 60000, ref_id: null },
        { kind: 'collect', icon: '📦', prospect_id: 103, customer_id: 903, name: 'TAN SIEW HONG', why: 'Collect Flexi Feng Shui + New · ready since 10 Aug', rm: 19980, score: 50000, ref_id: 7003 },
        { kind: 'touch', icon: '🧭', prospect_id: 104, customer_id: null, name: 'Wong Le Ying', why: 'CPS跟进电话 · overdue', rm: 19990, score: 40000, ref_id: 568 },
        { kind: 'book', icon: '🔥', prospect_id: 105, customer_id: null, name: 'gredgory chee', why: 'Hot · RM38k · nothing booked · met 20 Oct', rm: 37980, score: 30000, ref_id: null },
        { kind: 'gr', icon: '🟣', prospect_id: 106, customer_id: 906, name: 'Alan Woon Siew Lun', why: 'Golden Road 1/6 · due 12 Nov', rm: 21990, score: 20000, ref_id: 7006 },
    ];
    window.__hidden = new Map();
    const key = (k, p, c, r) => [k, c ?? '-', p ?? '-', r ?? '-'].join(':');
    window.__rpc = [];
    const today = new Date();
    const plus = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
    const rpc = async (name, args) => {
        window.__rpc.push([name, args]);
        if (name === 'journey_daily_todo') {
            const rows = window.__rows.filter(r => !window.__hidden.has(key(r.kind, r.prospect_id, r.customer_id, r.ref_id)));
            return { data: rows.slice(0, (args && args.p_limit) || 5), error: null };
        }
        if (name === 'journey_todo_hide') {
            const until = plus(args.p_action === 'not_now' ? 30 : 7);
            window.__hidden.set(key(args.p_kind, args.p_prospect_id, args.p_customer_id, args.p_ref_id), until);
            return { data: until, error: null };
        }
        if (name === 'journey_todo_unhide') {
            return { data: window.__hidden.delete(key(args.p_kind, args.p_prospect_id, args.p_customer_id, args.p_ref_id)), error: null };
        }
        return { data: [], error: null };
    };
    const real = window.supabase;
    const from = () => { const c = new Proxy({}, { get: (_, k) => (k === 'then' ? (ok) => Promise.resolve({ data: [], error: null }).then(ok) : () => c) }); return c; };
    window.supabase = new Proxy(real || {}, { get: (o, k) => (k === 'rpc' ? rpc : k === 'from' ? from : o[k]) });
    const s = window.AppDataStore;
    Object.assign(s, {
        getAll: async () => [], query: async () => [], getById: async () => null,
        queryAdvanced: async () => ({ data: [], count: 0 }), getActiveProspects: async () => [],
    });
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
};

async function main() {
    const server = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore' });
    await sleep(1500);
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const pageErrors = [];
    try {
        // ── desktop card ────────────────────────────────────────────────────
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 900 });
        page.on('pageerror', e => pageErrors.push(e.message));
        await page.setRequestInterception(true);
        page.on('request', r => (/supabase\.co|vercel|posthog|ui-avatars/.test(r.url()) ? r.abort() : r.continue()));
        const shot = async (name, el) => {
            if (!SHOTS) return;
            fs.mkdirSync(SHOTS, { recursive: true });
            const h = el ? await page.$(el) : null;
            await (h || page).screenshot({ path: path.join(SHOTS, name + '.png') });
        };
        await bootPage(page);
        await page.evaluate(async () => {
            // the Calendar month grid the card mounts above
            const host = document.getElementById('content-viewport') || document.querySelector('main') || document.body;
            host.innerHTML = '<div id="t5-host" style="max-width:980px;padding:16px;background:#f7f7f8;"><div class="calendar-monthly-wrapper" style="height:200px;border:1px dashed #ccc;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#999;">month grid</div></div>';
            await window._loadChunk('chunks/script-autopilot.min.js');
            window.app.apMountTop5();
        });
        await page.waitForFunction(() => (document.getElementById('ap-top5')?.querySelectorAll('.ap-todo-row').length || 0) === 5, { timeout: 8000 });
        console.log('\nDesktop card');
        const card = () => page.evaluate(() => document.getElementById('ap-top5').innerText);
        const t0 = await card();
        check('5 rows, Chen first', t0.indexOf('CHEN MEI FONG') >= 0 && t0.indexOf('CHEN MEI FONG') < t0.indexOf('Lim Hui Leng'), t0.slice(0, 200));
        const btns = await page.evaluate(() => [...document.querySelectorAll('#ap-top5 .ap-todo-hide')].map(b => b.textContent.trim()));
        check('Later + Not now on every row', btns.length === 10 && btns.filter(b => b === 'Later').length === 5 && btns.filter(b => b === 'Not now').length === 5, btns);
        // Later / Not now sit on the same line as the row's own button (nothing wraps)
        const lines = await page.evaluate(() => [...document.querySelectorAll('#ap-top5 .ap-todo-row')].map(r => {
            const mid = (el) => { const b = el.getBoundingClientRect(); return Math.round(b.top + b.height / 2); };
            const hide = [...r.querySelectorAll('.ap-todo-hide')].map(mid);
            const act = r.querySelector('.btn');
            return { row: Math.round(r.getBoundingClientRect().height), hide, act: act ? mid(act) : null };
        }));
        check('one line per row: Later / Not now level with the row button', lines.every(l => l.row <= 64 && l.hide.length === 2
            && Math.abs(l.hide[0] - l.hide[1]) <= 2 && (l.act == null || Math.abs(l.hide[0] - l.act) <= 3)), lines);
        await shot('1-desktop-card', '#t5-host');

        // click Later on Chen → the row goes, Undo line shows, the row click did NOT fire
        await page.evaluate(() => { window.__opened = null; window.app.apOpen = (k, id) => { window.__opened = [k, id]; }; });
        await page.evaluate(() => [...document.querySelectorAll('#ap-top5 .ap-todo-row')][0].querySelector('.ap-todo-hide').click());
        await page.waitForFunction(() => !document.getElementById('ap-top5').innerText.includes('Audit · RM168k'), { timeout: 5000 }).catch(() => {});
        const t1 = await card();
        const hideCall = await page.evaluate(() => window.__rpc.find(c => c[0] === 'journey_todo_hide'));
        check('Later → RPC with Chen\'s identity', hideCall && hideCall[1].p_kind === 'book' && hideCall[1].p_prospect_id === 101 && hideCall[1].p_action === 'later', hideCall);
        check('Later did not open the profile', await page.evaluate(() => window.__opened === null));
        check('Chen\'s row is gone, the 6th person moved up', !t1.includes('Audit · RM168k') && t1.includes('Alan Woon Siew Lun'), t1);
        check('Undo line names her', /Hid CHEN MEI FONG — back on \d+ \w+ · Undo/.test(t1), t1.slice(-80));
        check('toast says when she is back', (await page.evaluate(() => window.__toasts.slice(-1)[0] || '')).startsWith('success: Hidden — back on'));
        await shot('2-desktop-after-later', '#t5-host');

        // Undo → back
        await page.evaluate(() => [...document.querySelectorAll('#ap-top5 button')].find(b => b.textContent.trim() === 'Undo').click());
        await page.waitForFunction(() => document.getElementById('ap-top5').innerText.includes('Audit · RM168k'), { timeout: 5000 }).catch(() => {});
        const t2 = await card();
        check('Undo → Chen back on top, Undo line gone', t2.includes('Audit · RM168k') && !t2.includes('Undo'), t2.slice(0, 120));

        // Not now on the collect row
        await page.evaluate(() => [...document.querySelectorAll('#ap-top5 .ap-todo-row')][2].querySelectorAll('.ap-todo-hide')[1].click());
        await sleep(800);
        const nn = await page.evaluate(() => window.__rpc.filter(c => c[0] === 'journey_todo_hide').pop());
        check('Not now → collect row with customer + purchase ids', nn && nn[1].p_kind === 'collect' && nn[1].p_customer_id === 903 && nn[1].p_ref_id === 7003 && nn[1].p_action === 'not_now', nn);

        // a meeting saved somewhere else → the card redraws by itself
        await page.evaluate(() => { window.__rows.splice(1, 1); window.__rpc.length = 0; });   // Lim's meeting got booked
        await page.evaluate(() => window.AppDataStore.emit('dataChanged', { action: 'add', table: 'activities', record: { id: 1 } }));
        await page.waitForFunction(() => !document.getElementById('ap-top5').innerText.includes('Lim Hui Leng'), { timeout: 5000 }).catch(() => {});
        check('meeting booked elsewhere → card refetched + row gone', (await page.evaluate(() => window.__rpc.some(c => c[0] === 'journey_daily_todo'))) && !(await card()).includes('Lim Hui Leng'));

        // a leader's 📋 To-do pop-up (Pipeline review) still lists the hidden row, marked
        console.log('\nLeader to-do pop-up');
        await page.evaluate(async () => {
            const today = new Date(); const plus = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
            const rpc0 = window.supabase.rpc;
            window.supabase = new Proxy(window.supabase, { get: (o, k) => (k === 'rpc' ? async (name, args) => (name === 'journey_todo_list'
                ? { data: [
                    { agent_id: 42, kind: 'book', icon: '🩺', prospect_id: 101, customer_id: null, name: 'CHEN MEI FONG', why: 'Audit · RM168k · nothing booked · met 6 Nov', rm: 167820, due: '2026-11-06', score: 70000, ref_id: null, hidden_until: plus(30), hidden_action: 'not_now' },
                    { agent_id: 42, kind: 'touch', icon: '🧭', prospect_id: 104, customer_id: null, name: 'Wong Le Ying', why: 'CPS跟进电话 · overdue', rm: 19990, due: '2026-10-20', score: 40000, ref_id: 568, hidden_until: null, hidden_action: null },
                ], error: null }
                : rpc0(name, args)) : o[k]) });
            await window._loadChunk('chunks/script-pipeline.min.js');
            await window.app.plShowTodoFor('42', 'Agent Kim');
        });
        await sleep(400);
        const lead = await page.evaluate(() => document.querySelector('#global-modal-overlay.active')?.innerText || '');
        check('leader sees the hidden row, marked “Not now” with its date', /CHEN MEI FONG[\s\S]*💤 Agent chose “Not now” — off their list till \d+ \w+/.test(lead), lead.slice(0, 300));
        check('a normal row has no mark', !/Wong Le Ying[\s\S]*💤/.test(lead));
        await shot('2b-leader-todo', '#global-modal-overlay .modal-box');
        await page.close();

        // ── phone Home ──────────────────────────────────────────────────────
        console.log('\nPhone Home · Do today');
        const phone = await browser.newPage();
        await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
        phone.on('pageerror', e => pageErrors.push(e.message));
        await phone.setRequestInterception(true);
        phone.on('request', r => (/supabase\.co|vercel|posthog|ui-avatars/.test(r.url()) ? r.abort() : r.continue()));
        // The mocked shell squeezes the content area, so a picture of the Home card
        // is taken from a copy laid over the whole screen (same classes → same CSS).
        const pshot = async (name, el) => {
            if (!SHOTS) return;
            if (el) {
                await phone.evaluate((sel) => {
                    const src = document.querySelector(sel);
                    const o = document.createElement('div');
                    o.id = 't5-shot';
                    o.className = 'mhome';
                    o.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#F6F6F7;padding:16px;overflow:hidden;';
                    if (src) o.appendChild(src.cloneNode(true));
                    document.body.appendChild(o);
                }, el);
                await phone.screenshot({ path: path.join(SHOTS, name + '.png') });
                await phone.evaluate(() => document.getElementById('t5-shot')?.remove());
                return;
            }
            await phone.screenshot({ path: path.join(SHOTS, name + '.png') });
        };
        await bootPage(phone);
        await phone.evaluate(async () => {
            try { Object.keys(localStorage).filter(k => k.startsWith('mhome-')).forEach(k => localStorage.removeItem(k)); } catch (_) { /* fresh */ }
            await window._loadChunk('chunks/script-autopilot.min.js');
            await window._loadChunk('chunks/script-mobile.min.js');
            window._appState.cv = 'home';   // Home repaints only while it is the current view
            document.body.classList.add('is-mobile');   // what applyMobileClass does after a real login
            const vp = document.getElementById('content-viewport') || document.body;
            await window.app.showMobileHomeView(vp);
        });
        await phone.waitForFunction(() => (document.querySelectorAll('#mhome-do .mh-do-row').length || 0) >= 5, { timeout: 10000 }).catch(() => {});
        const doRows = await phone.evaluate(() => document.querySelectorAll('#mhome-do .mh-do-row').length);
        check('Do today shows 5 rows', doRows === 5, doRows);
        const more = await phone.evaluate(() => [...document.querySelectorAll('#mhome-do .mh-do-more')].map(b => {
            const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) };
        }));
        check('⋯ on every journey row, fits on screen', more.length === 5 && more.every(m => m.w >= 28 && m.h >= 36 && m.right <= 390), more);
        await phone.evaluate(() => document.getElementById('mhome-do').scrollIntoView({ block: 'start' }));
        await pshot('3-phone-do-today', '#mhome-do');
        await phone.evaluate(() => { window.__opened = null; window.app.apOpen = (k, id) => { window.__opened = [k, id]; }; });
        await phone.evaluate(() => document.querySelectorAll('#mhome-do .mh-do-more')[0].click());
        await sleep(500);
        const sheet = await phone.evaluate(() => document.querySelector('#global-modal-overlay.active')?.innerText || '');
        check('⋯ opens the sheet for that person', sheet.includes('CHEN MEI FONG') && sheet.includes('Later — back on') && sheet.includes('Not now — hide for 30 days'), sheet);
        check('⋯ did not open the profile', await phone.evaluate(() => window.__opened === null));
        await pshot('4-phone-sheet');
        await phone.evaluate(() => [...document.querySelectorAll('#global-modal-overlay button')].find(b => b.textContent.includes('Not now')).click());
        await phone.waitForFunction(() => !document.getElementById('mhome-do')?.innerText.includes('CHEN MEI FONG · ') && document.querySelectorAll('#mhome-do .mh-do-row').length >= 1
            && !document.querySelector('#mhome-do .mh-do-row .mh-do-name')?.textContent.includes('CHEN'), { timeout: 6000 }).catch(() => {});
        const after = await phone.evaluate(() => ({
            first: document.querySelector('#mhome-do .mh-do-row .mh-do-name')?.textContent || '',
            undo: document.querySelector('#mhome-do .mh-do-undo')?.innerText || '',
            sheetOpen: !!document.querySelector('#global-modal-overlay.active'),
            call: window.__rpc.filter(c => c[0] === 'journey_todo_hide').pop(),
        }));
        check('Not now → sheet closed, RPC not_now for Chen', !after.sheetOpen && after.call && after.call[1].p_prospect_id === 101 && after.call[1].p_action === 'not_now', after);
        check('Chen gone from Do today, Undo line shown', !after.first.includes('CHEN') && /Hid CHEN MEI FONG — back on/.test(after.undo), after);
        await phone.evaluate(() => document.getElementById('mhome-do').scrollIntoView({ block: 'start' }));
        await sleep(300);
        await pshot('5-phone-after-not-now', '#mhome-do');
        await pshot('6-phone-toast');

        check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 5));
    } finally {
        await browser.close();
        server.kill();
    }
    console.log(`\ntop5-later browser: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
