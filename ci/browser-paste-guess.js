#!/usr/bin/env node
/**
 * ci/browser-paste-guess.js — Paste Info with no labels, the real forms in a
 * real browser (2026-11-02).
 *
 * Mock admin login + an in-memory AppDataStore (nothing reaches Supabase): the
 * owner's five bare lines on Add Prospect, the amber "please check" lines, the
 * CPS form keeping its appointment date / time / venue, and the phone size.
 *
 * Usage: node ci/browser-paste-guess.js [screenshot-dir]
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
const OWNER = 'Ngui Kok Feng \n831001105005\nTCM\n0108244914\nkokfeng@gmail.com';

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
    if (ok) { pass++; console.log(`  ok   ${name}`); return; }
    fail++;
    console.log(`  FAIL ${name}${extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`);
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const installStore = () => {
    const db = window.__db = {
        prospects: [{ id: 500, full_name: 'Old Name', phone: '0122222222', status: 'active', responsible_agent_id: 1 }],
        activities: [], users: [{ id: 1, full_name: 'System Admin', role: 'Level 1 Super Admin', status: 'active' }],
        venues: [{ id: 1, name: 'Far Coffee', location: 'Bukit Jalil', aliases: 'Far Coffee Bukit Jalil', sequence: 1 }],
        customers: [], products: [],
    };
    const table = (t) => (db[t] = db[t] || []);
    const match = (r, f) => Object.entries(f || {}).every(([k, v]) => String(r[k]) === String(v));
    Object.assign(window.AppDataStore, {
        getById: async (t, id) => table(t).find(x => String(x.id) === String(id)) || null,
        getByIdFull: async (t, id) => table(t).find(x => String(x.id) === String(id)) || null,
        getAll: async (t) => table(t).slice(),
        query: async (t, f) => table(t).filter(r => match(r, f)),
        queryAdvanced: async (t, o) => ({ data: table(t).filter(r => match(r, o && o.filters)), count: 0 }),
        searchProspects: async () => [], searchCustomers: async () => [],
        getActivitiesForProspect: async () => [], getActivitiesForCustomer: async () => [],
        getActiveProspects: async () => db.prospects.slice(),
    });
    window.__toasts = [];
    for (const k of ['success', 'error', 'info', 'warning']) {
        const orig = window.UI.toast[k];
        window.UI.toast[k] = (m) => { window.__toasts.push(`${k}: ${m}`); return orig && orig.call(window.UI.toast, m); };
    }
    window.confirm = () => true;
};

const open = async (browser, viewport, pageErrors) => {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request', r => (/supabase\.co|vercel|posthog/.test(r.url()) ? r.abort() : r.continue()));
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
        await window._loadChunk('chunks/script-cps.min.js');
    });
    return page;
};

// Paste Info → type the text → Auto-Fill Form.
const paste = async (page, text) => {
    const opened = await page.evaluate(() => {
        const b = [...document.querySelectorAll('#global-modal-overlay button')].find(x => x.textContent.includes('Paste Info'));
        if (b) b.click();
        return !!b;
    });
    await page.waitForSelector('#cps-paste-input', { timeout: 5000 });
    await page.evaluate((t) => { document.getElementById('cps-paste-input').value = t; window.__toasts.length = 0; }, text);
    const hint = await page.evaluate(() => document.getElementById('cps-scan-overlay').innerText);
    await page.evaluate(() => [...document.querySelectorAll('#cps-scan-overlay button')].find(x => x.textContent.includes('Auto-Fill')).click());
    await sleep(1200);
    return { opened, hint };
};
const values = (page, prefix, keys) => page.evaluate((p, ks) => Object.fromEntries(ks.map(k => [k, document.getElementById(`${p}-${k}`)?.value ?? null])), prefix, keys);
const notes = (page) => page.evaluate(() => [...document.querySelectorAll('.paste-guess-note')].map(n => n.previousElementSibling?.id + ': ' + n.textContent));

async function main() {
    const server = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore' });
    await sleep(1500);
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const pageErrors = [];
    try {
        const page = await open(browser, { width: 1280, height: 900 }, pageErrors);
        const shot = async (p, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + '.png') }); } };

        console.log('\nAdd Prospect, the owner\'s five bare lines');
        await page.evaluate(() => window.app.openProspectModal());
        await page.waitForSelector('#prospect-name', { timeout: 8000 });
        const { opened, hint } = await paste(page, OWNER);
        check('Paste Info button opens the box', opened);
        check('box says plain lines work', hint.includes('Plain lines work too') && hint.includes('with or without labels'), hint);
        const v = await values(page, 'prospect', ['name', 'ic', 'occupation', 'phone', 'email', 'dob', 'gender']);
        check('all five fields filled', v.name === 'Ngui Kok Feng' && v.ic === '831001105005' && v.occupation === 'TCM'
            && v.phone === '010-8244914' && v.email === 'kokfeng@gmail.com', v);
        check('IC still fills DOB and gender', v.dob === '1983-10-01' && v.gender === 'Male', v);
        check('box closed', await page.evaluate(() => !document.getElementById('cps-scan-overlay')));
        check('Name and Occupation marked to check', JSON.stringify(await notes(page)) === JSON.stringify(
            ['prospect-name: Guessed from the paste, please check', 'prospect-occupation: Guessed from the paste, please check']), await notes(page));
        const toast = await page.evaluate(() => window.__toasts.join(' | '));
        check('toast asks to check them', toast.includes('Auto-filled 5 fields') && toast.includes('Please check Name and Occupation'), toast);
        check('the mark is amber and readable', await page.evaluate(() => {
            const n = document.querySelector('.paste-guess-note');
            const c = getComputedStyle(n).color;
            return n.offsetHeight > 0 && c !== 'rgba(0, 0, 0, 0)' && c !== getComputedStyle(document.body).color;
        }));
        await shot(page, '1-prospect-pasted');
        await page.click('#prospect-name', { clickCount: 3 });
        await page.keyboard.type('Ngui Kok Feng (Kelvin)');
        check('typing in the box clears its mark', JSON.stringify(await notes(page)) === JSON.stringify(['prospect-occupation: Guessed from the paste, please check']), await notes(page));

        console.log('\nA second paste never replaces a box the agent filled');
        await paste(page, 'Tan Ah Kau\n0123456789\nDoctor');
        const v2 = await values(page, 'prospect', ['name', 'occupation', 'phone']);
        check('name and job kept, phone replaced', v2.name === 'Ngui Kok Feng (Kelvin)' && v2.occupation === 'TCM' && v2.phone === '012-3456789', v2);
        check('no marks left', (await notes(page)).length === 0, await notes(page));

        console.log('\nA chat sentence still says nothing found');
        await paste(page, 'Hi I would like to come for the talk next week please');
        check('error shown', (await page.evaluate(() => window.__toasts.join(' | '))).includes('No recognizable fields found'));
        check('box stays open to fix the paste', await page.evaluate(() => !!document.getElementById('cps-paste-input')));
        await page.evaluate(() => { window.app._hideCpsScanOverlay(); window.UI.hideModal(); });

        console.log('\nCPS form, with the appointment lines');
        await page.evaluate(() => window.app.openActivityModal());
        await page.waitForSelector('#modal-activity-type', { timeout: 8000 });
        await page.evaluate(() => {
            const t = document.getElementById('modal-activity-type');
            t.value = 'CPS';
            t.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForSelector('#cps-name', { visible: true, timeout: 8000 });
        await paste(page, OWNER.replace('TCM\n', '') + '\nWednesday, 12 Nov 2pm\nFar Coffee Bukit Jalil');
        const c = await values(page, 'cps', ['name', 'ic', 'occupation', 'phone', 'email']);
        check('person filled, no job guessed from the appointment lines', c.name === 'Ngui Kok Feng' && c.ic === '831001105005' && c.occupation === '' && c.phone === '010-8244914', c);
        const appt = await page.evaluate(() => ({
            date: document.getElementById('activity-date')?.value, start: document.getElementById('start-time')?.value,
            venue: document.getElementById('activity-venue')?.value,
        }));
        check('appointment date, time and venue still filled', /-11-12$/.test(appt.date) && appt.start === '14:00' && appt.venue === 'Far Coffee | Bukit Jalil', appt);
        check('only Name is marked', JSON.stringify(await notes(page)) === JSON.stringify(['cps-name: Guessed from the paste, please check']), await notes(page));
        await shot(page, '2-cps-pasted');

        console.log('\nPhone');
        const phone = await open(browser, { width: 400, height: 850, isMobile: true, hasTouch: true }, pageErrors);
        check('phone layout is on', await phone.evaluate(() => window.matchMedia('(max-width: 768px)').matches));
        await phone.evaluate(() => window.app.openProspectModal());
        await phone.waitForSelector('#prospect-name', { timeout: 8000 });
        await phone.evaluate(() => {
            const b = [...document.querySelectorAll('#global-modal-overlay button')].find(x => x.textContent.includes('Paste Info'));
            b.click();
        });
        await phone.waitForSelector('#cps-paste-input', { timeout: 5000 });
        await phone.evaluate((t) => { document.getElementById('cps-paste-input').value = t; }, OWNER);
        check('paste box fits the phone', await phone.evaluate(() => {
            const r = document.querySelector('#cps-scan-overlay > div').getBoundingClientRect();
            return r.left >= 0 && r.right <= window.innerWidth;
        }));
        await shot(phone, '3-phone-paste-box');
        await phone.evaluate(() => [...document.querySelectorAll('#cps-scan-overlay button')].find(x => x.textContent.includes('Auto-Fill')).click());
        await sleep(1200);
        const pv = await values(phone, 'prospect', ['name', 'ic', 'occupation', 'phone', 'email']);
        check('phone: all five filled', pv.name === 'Ngui Kok Feng' && pv.occupation === 'TCM' && pv.email === 'kokfeng@gmail.com', pv);
        check('phone: both marks shown', (await notes(phone)).length === 2, await notes(phone));
        await phone.evaluate(() => document.querySelector('.paste-guess-note')?.scrollIntoView({ block: 'center' }));
        await shot(phone, '4-phone-pasted');

        check('no page errors', pageErrors.length === 0, pageErrors);
    } finally {
        await browser.close();
        server.kill();
    }
    console.log(`\nbrowser-paste-guess: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
