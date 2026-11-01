#!/usr/bin/env node
/**
 * ci/browser-new-friend.js — 🌱 New Friends, the real screens in a real browser.
 *
 * Mock admin login + an in-memory AppDataStore (nothing reaches Supabase): the
 * Add Attendee button → the tagged form → the attendee row, a plain prospect
 * stays untagged, Book CPS lands on the same person, an old name stays blocked,
 * the Name List tab and the phone filter sheet.
 *
 * Usage: node ci/browser-new-friend.js [screenshot-dir]
 * Exit 0 = all pass. Exit 1 = failures.
 */
'use strict';
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const PORT = 8092;
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.argv[2] || null;
const SESSION = 900001;

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
    if (ok) { pass++; console.log(`  ok   ${name}`); return; }
    fail++;
    console.log(`  FAIL ${name}${extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`);
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// In-memory tables behind the same AppDataStore calls the screens make.
const installStore = () => {
    const db = window.__db = {
        prospects: [
            { id: 500, full_name: 'Old Name', phone: '0122222222', status: 'active', responsible_agent_id: 1, referred_by: 'Someone' },
        ],
        activities: [{ id: 800, activity_type: 'CALL', prospect_id: 500, activity_date: '2026-01-01' }],
        event_attendees: [], referrals: [], reassignment_history: [],
        users: [{ id: 1, full_name: 'System Admin', role: 'Level 1 Super Admin', status: 'active' }],
        venues: [{ id: 1, name: 'HQ', location: 'KL', sequence: 1 }],
        customers: [], products: [],
    };
    let seq = 1000;
    const table = (t) => (db[t] = db[t] || []);
    const match = (r, f) => Object.entries(f || {}).every(([k, v]) => String(r[k]) === String(v));
    const s = window.AppDataStore;
    Object.assign(s, {
        create: async (t, row) => { const r = { id: row.id || ++seq, ...row }; table(t).push(r); return r; },
        update: async (t, id, patch) => { const r = table(t).find(x => String(x.id) === String(id)); if (r) Object.assign(r, patch); return r; },
        delete: async () => true,
        getById: async (t, id) => table(t).find(x => String(x.id) === String(id)) || null,
        getByIdFull: async (t, id) => table(t).find(x => String(x.id) === String(id)) || null,
        getAll: async (t) => table(t).slice(),
        query: async (t, f) => table(t).filter(r => match(r, f)),
        queryAdvanced: async (t, o) => ({ data: table(t).filter(r => match(r, o && o.filters)), count: 0 }),
        searchProspects: async (q) => db.prospects.filter(p => (p.full_name || '').toLowerCase().includes(String(q).toLowerCase())),
        searchCustomers: async () => [],
        getActivitiesForProspect: async (id) => db.activities.filter(a => String(a.prospect_id) === String(id)),
        getActivitiesForCustomer: async () => [],
        getActiveProspects: async () => db.prospects.slice(),
    });
    window.__toasts = [];
    for (const k of ['success', 'error', 'info', 'warning']) {
        const orig = window.UI.toast[k];
        window.UI.toast[k] = (m) => { window.__toasts.push(`${k}: ${m}`); return orig && orig.call(window.UI.toast, m); };
    }
    window.confirm = () => true;
    window.__rpc = [];
    const rpcRows = () => db.prospects.filter(p => p.source === 'event_new_friend'
        && !db.activities.some(a => String(a.prospect_id) === String(p.id) && a.activity_type === 'CPS'))
        .map(p => ({ prospect_id: p.id, name: p.full_name, phone: p.phone, agent_id: 1, agent_name: 'System Admin', brought_by: p.referred_by,
            session_id: p.source_id, event_title: 'TEST 汇集', event_date: '2026-10-31', came_n: 1, state: 'came', cps_booked: null, days_waiting: 1 }));
    const fake = { rpc: async (name) => { window.__rpc.push(name); return name === 'new_friend_list' ? { data: rpcRows(), error: null } : { data: [], error: null }; } };
    const real = window.supabase;
    window.supabase = new Proxy(real || {}, { get: (o, k) => (k === 'rpc' ? fake.rpc : o[k]) });
};

async function main() {
    const server = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore' });
    await sleep(1500);
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 900 });
        const pageErrors = [];
        page.on('pageerror', e => pageErrors.push(e.message));
        // Nothing may reach the live database from this test.
        await page.setRequestInterception(true);
        page.on('request', r => (/supabase\.co|vercel|posthog/.test(r.url()) ? r.abort() : r.continue()));
        const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
        const modalTitle = () => page.evaluate(() => document.querySelector('#global-modal-overlay.active .modal-title, #global-modal-overlay.active h3, #global-modal-overlay.active h2')?.textContent?.trim() || '');
        const clickButton = (label) => page.evaluate((l) => {
            const b = [...document.querySelectorAll('#global-modal-overlay button')].find(x => x.textContent.trim().includes(l));
            if (b) b.click();
            return !!b;
        }, label);

        await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(4000);
        await page.evaluate(() => {
            document.getElementById('login-container')?.style.setProperty('display', 'none');
            const shell = document.getElementById('app-shell');
            if (shell) { shell.style.display = 'flex'; shell.style.visibility = 'visible'; }
            window._appState.cu = { id: 1, username: 'admin', full_name: 'System Admin', role: 'Level 1 Super Admin', status: 'active', email: 'admin@example.test' };
        });
        await page.evaluate(installStore);
        await page.evaluate(async () => {
            await window._loadChunk('chunks/script-activities.min.js');
            await window._loadChunk('chunks/script-prospects.min.js');
            window.app.viewActivityDetails = async (id) => { window.__viewed = id; };
        });

        console.log('\nAdd Attendee → New Friend');
        await page.evaluate((s) => window.app.showAddAttendeeSearch(77, s), SESSION);
        await sleep(400);
        const addText = await page.evaluate(() => document.getElementById('global-modal-overlay').innerText);
        check('button reads New Friend (not yet CPS)', addText.includes('New Friend (not yet CPS)'), addText.slice(0, 200));
        check('old wording gone', !addText.includes('First Time Friend'));
        await shot('1-add-attendee');
        check('button is clickable', await clickButton('New Friend (not yet CPS)'));
        await sleep(1500);
        check('form says New Friend', (await page.evaluate(() => document.getElementById('global-modal-overlay').innerText)).includes('Add New Friend (not yet CPS)'));
        await shot('2-new-friend-form');
        const fillProspect = (name, phone) => page.evaluate(async (n, p) => {
            document.getElementById('prospect-name').value = n;
            document.getElementById('prospect-phone').value = p;
            window._appState.sprr = { name: 'Lee Referrer', id: 700, type: 'Customer' };
            const rel = document.getElementById('prospect-relationship');
            rel.value = [...rel.options].map(o => o.value).find(Boolean);
        }, name, phone);
        await fillProspect('Ann Friend', '0133333333');
        await clickButton('Create Prospect');
        await sleep(1200);
        const ann = await page.evaluate(() => window.__db.prospects.find(p => p.full_name === 'Ann Friend') || null);
        check('saved with the New Friend tag', ann && ann.source === 'event_new_friend', ann);
        check('tag points at the event session', ann && Number(ann.source_id) === SESSION, ann && ann.source_id);
        const att = await page.evaluate(() => window.__db.event_attendees.slice());
        check('added as an attendee of that session', att.length === 1 && String(att[0].attendee_id) === String(ann && ann.id) && Number(att[0].activity_id) === SESSION, att);

        console.log('\nA normal Add Prospect stays untagged');
        await page.evaluate(() => { window.UI.hideModal(); });
        await page.evaluate(() => window.app.openProspectModal());
        await sleep(1000);
        check('normal form title', !(await page.evaluate(() => document.getElementById('global-modal-overlay').innerText)).includes('New Friend'));
        await fillProspect('Plain Person', '0144444444');
        await clickButton('Create Prospect');
        await sleep(1000);
        const plain = await page.evaluate(() => window.__db.prospects.find(p => p.full_name === 'Plain Person') || null);
        check('created', !!plain);
        check('not tagged', plain && !plain.source && !plain.source_id, plain);

        console.log('\nBook CPS');
        const before = await page.evaluate(() => window.__db.prospects.length);
        await page.evaluate(() => { window.UI.hideModal(); window.__toasts.length = 0; });
        await page.evaluate((id) => window.app.openActivityModal('', id), ann.id);
        await page.waitForFunction(() => document.getElementById('cps-name')?.value === 'Ann Friend', { timeout: 8000 });
        await sleep(600);
        const cpsForm = await page.evaluate(() => ({
            type: document.getElementById('modal-activity-type')?.value,
            phone: document.getElementById('cps-phone')?.value,
            referrer: window._appState.sr, badge: document.getElementById('cps-referrer-info')?.innerText,
        }));
        check('opens on CPS', cpsForm.type === 'CPS', cpsForm);
        check('phone prefilled', cpsForm.phone === '0133333333', cpsForm);
        check('referrer already picked', cpsForm.referrer && cpsForm.referrer.name === 'Lee Referrer', cpsForm);
        await shot('3-book-cps');
        const saveCps = () => page.evaluate(async () => {
            const venue = document.getElementById('activity-venue');
            if (venue) venue.value = [...venue.options].map(o => o.value).find(Boolean);
            const set = (id, v) => { const el = document.getElementById(id); if (el && !el.value) el.value = v; };
            set('activity-date', '2026-11-05'); set('start-time', '10:00'); set('end-time', '11:00');
            set('cps-ic', '900101145678');
            const rel = document.getElementById('cps-relationship');
            if (rel && !rel.value) rel.value = [...rel.options].map(o => o.value).find(Boolean);
            await window.app.saveActivity();
        });
        await saveCps();
        await sleep(1500);
        const afterCps = await page.evaluate(() => ({
            n: window.__db.prospects.length,
            acts: window.__db.activities.filter(a => a.activity_type === 'CPS'),
            refs: window.__db.referrals, toasts: window.__toasts.slice(-4),
        }));
        check('no second person created', afterCps.n === before, afterCps);
        check('CPS saved on the same person', afterCps.acts.length === 1 && String(afterCps.acts[0].prospect_id) === String(ann.id), afterCps);
        check('referral row made once', afterCps.refs.length === 1 && String(afterCps.refs[0].referred_prospect_id) === String(ann.id), afterCps.refs);
        const annAfter = await page.evaluate((id) => window.__db.prospects.find(p => p.id === id), ann.id);
        check('blank IC filled from the CPS form', annAfter.ic_number === '900101145678', annAfter.ic_number);
        check('protection starts at the CPS', !!annAfter.protection_deadline && annAfter.protection_deadline !== ann.protection_deadline || annAfter.cps_assignment_date, annAfter.protection_deadline);

        console.log('\nA New Friend who already has an activity is not blocked');
        await page.evaluate(() => {
            window.__db.prospects.push({ id: 501, full_name: 'Ben Friend', phone: '0155555555', status: 'active', responsible_agent_id: 1, referred_by: 'Lee Referrer', referred_by_id: 700, referred_by_type: 'Customer', referral_relationship: 'Friend', source: 'event_new_friend', source_id: 900001 });
            window.__db.activities.push({ id: 801, activity_type: 'CALL', prospect_id: 501, activity_date: '2026-10-30' });
            window.UI.hideModal(); window.__toasts.length = 0;
        });
        await page.evaluate(() => window.app.openActivityModal('', 501));
        await page.waitForFunction(() => document.getElementById('cps-name')?.value === 'Ben Friend', { timeout: 8000 });
        await sleep(600);
        await saveCps();
        await sleep(1200);
        const ben = await page.evaluate(() => ({ cps: window.__db.activities.filter(a => a.activity_type === 'CPS' && a.prospect_id === 501).length, toasts: window.__toasts, n: window.__db.prospects.filter(p => p.full_name === 'Ben Friend').length }));
        check('CPS saved', ben.cps === 1, ben);
        check('one record only', ben.n === 1, ben);
        check('no duplicate block', !ben.toasts.some(t => /Duplicate blocked/.test(t)), ben.toasts);

        console.log('\nAn old name keeps the old duplicate rule');
        await page.evaluate(() => { window.UI.hideModal(); window.__toasts.length = 0; });
        await page.evaluate(() => window.app.openActivityModal('', 500));
        await page.waitForFunction(() => document.getElementById('cps-name')?.value === 'Old Name', { timeout: 8000 });
        await sleep(600);
        await page.evaluate(() => { window.app.selectReferrer(700, 'Lee Referrer', 'Customer'); });
        await saveCps();
        await sleep(1000);
        const oldName = await page.evaluate(() => ({ cps: window.__db.activities.filter(a => a.activity_type === 'CPS' && a.prospect_id === 500).length, toasts: window.__toasts }));
        check('still blocked', oldName.cps === 0 && oldName.toasts.some(t => /Duplicate blocked/.test(t)), oldName);

        console.log('\nName List tab');
        await page.evaluate(() => {
            window.UI.hideModal();
            window.__db.prospects.push({ id: 502, full_name: 'Cara Friend', phone: '0166666666', status: 'active', responsible_agent_id: 1, referred_by: 'Lee Referrer', source: 'event_new_friend', source_id: 900001 });
        });
        await page.evaluate(async () => {
            await window._loadChunk('chunks/script-reporting.min.js');
            document.querySelector('.main-content, #content-body, main')?.insertAdjacentHTML('afterbegin', '<div class="kpi-dashboard"><div id="kpi-stats-grid"></div></div>');
            try { localStorage.setItem('fs_nl_open', '1'); } catch (_) { /* best-effort */ }
            await window.app.nlToggle();
        });
        await page.waitForFunction(() => !!document.getElementById('nl-tab-n-newfriends'), { timeout: 45000 });
        await page.evaluate(() => window.app.nlTab('newfriends'));
        await sleep(800);
        const tab = await page.evaluate(() => document.getElementById('nl-body')?.innerText || '');
        const count = await page.evaluate(() => document.getElementById('nl-tab-n-newfriends')?.textContent);
        check('tab shows the count', count === '1', count);
        check('tab shows the friend', tab.includes('Cara Friend'), tab.slice(0, 200));
        check('a friend with a CPS is gone', !tab.includes('Ann Friend') && !tab.includes('Ben Friend'), tab.slice(0, 200));
        check('Book CPS button is there', tab.includes('Book CPS'), tab.slice(0, 200));
        await page.evaluate(() => document.getElementById('nl-body')?.scrollIntoView());
        await shot('4-name-list-tab');

        console.log('\nPhone');
        // A fresh phone-sized page: changing to a touch viewport reloads the page.
        const phone = await browser.newPage();
        await phone.setViewport({ width: 400, height: 850, isMobile: true, hasTouch: true });
        phone.on('pageerror', e => pageErrors.push(e.message));
        await phone.setRequestInterception(true);
        phone.on('request', r => (/supabase\.co|vercel|posthog/.test(r.url()) ? r.abort() : r.continue()));
        const phoneShot = async (name) => { if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, name + '.png') }); };
        await phone.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(4000);
        await phone.evaluate(() => {
            document.getElementById('login-container')?.style.setProperty('display', 'none');
            const shell = document.getElementById('app-shell');
            if (shell) { shell.style.display = 'flex'; shell.style.visibility = 'visible'; }
            window._appState.cu = { id: 1, username: 'admin', full_name: 'System Admin', role: 'Level 1 Super Admin', status: 'active', email: 'admin@example.test' };
        });
        await phone.evaluate(installStore);
        await phone.evaluate(async () => {
            window.__db.prospects.push(
                { id: 510, full_name: 'Dee Friend', phone: '0177777777', status: 'active', responsible_agent_id: 1, source: 'event_new_friend', source_id: 900001 },
                { id: 511, full_name: 'Eve Regular', phone: '0188888888', status: 'active', responsible_agent_id: 1 });
            await window._loadChunk('chunks/script-activities.min.js');
            await window._loadChunk('chunks/script-prospects.min.js');
            await window._loadChunk('chunks/script-mobile.min.js');
        });
        check('phone layout is on', await phone.evaluate(() => window.matchMedia('(max-width: 768px)').matches));
        await phone.evaluate((s) => window.app.showAddAttendeeSearch(77, s), SESSION);
        await sleep(500);
        check('button on phone', (await phone.evaluate(() => document.getElementById('global-modal-overlay').innerText)).includes('New Friend (not yet CPS)'));
        await phoneShot('5-phone-add-attendee');
        await phone.evaluate(() => window.UI.hideModal());
        await phone.evaluate(async () => {
            let box = document.getElementById('mp-test-viewport');
            if (!box) {
                box = document.createElement('div');
                box.id = 'mp-test-viewport';
                box.style.cssText = 'position:fixed;inset:0;z-index:50;background:#fff;overflow:auto;';
                document.body.appendChild(box);
            }
            await window.app.showMobileProspectsView(box);
        });
        await sleep(1200);
        const listText = () => phone.evaluate(() => document.getElementById('mp-test-viewport')?.innerText || '');
        check('list starts with everyone', /Eve Regular/i.test(await listText()) && /Dee Friend/i.test(await listText()), (await listText()).slice(0, 200));
        await phone.evaluate(() => window.app.mpOpenFilters());
        await sleep(800);
        const sheet = await phone.evaluate(() => document.getElementById('global-modal-overlay').innerText);
        check('filter sheet offers New Friend', sheet.includes('New Friend (no CPS yet)'), sheet.slice(0, 200));
        await phone.evaluate(() => { document.getElementById('mpf-new-friend')?.scrollIntoView({ block: 'center' }); });
        await sleep(300);
        await phoneShot('6-phone-filter');
        await phone.evaluate(async () => {
            document.getElementById('mpf-new-friend').value = '1';
            await window.app.mpApplyFilters();
        });
        await sleep(1000);
        const filtered = await listText();
        check('filter keeps the New Friend', /Dee Friend/i.test(filtered), filtered.slice(0, 200));
        check('filter drops everyone else', !/Eve Regular/i.test(filtered), filtered.slice(0, 200));
        await phoneShot('7-phone-list');
        await phone.evaluate(() => window.app.mpOpenFilters());
        await sleep(500);
        await phone.evaluate(() => window.app.mpClearFilters());
        await sleep(1000);
        check('clearing brings everyone back', /Eve Regular/i.test(await listText()));
        await phone.close();

        const real = pageErrors.filter(e => !/supabase|Failed to fetch|fetch/i.test(e));
        check('no page errors', real.length === 0, real.slice(0, 3));
    } finally {
        await browser.close();
        server.kill();
    }
    console.log(`\nbrowser-new-friend: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('FAIL', e); process.exit(1); });
