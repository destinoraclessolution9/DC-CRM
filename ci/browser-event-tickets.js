#!/usr/bin/env node
/**
 * ci/browser-event-tickets.js — 🎟 Big event ticket categories, the real screens
 * in a real browser.
 *
 * Mock login + an in-memory AppDataStore + a fake event_ticket_counts RPC
 * (nothing reaches Supabase): Marketing → Add Event with the Big event tick,
 * categories + seats per team → Add Attendee picker (own team's seats, early
 * bird price) → the "run out" pop-up (Pick another / Register anyway) → chips
 * + seat summary on the attendee list (agent line, admin team table) → change
 * a ticket → another team's own pool → a normal event shows no picker → phone.
 *
 * Usage: node ci/browser-event-tickets.js [screenshot-dir]
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
const SESSION = 700;
const DATE = '2026-12-20';

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
    if (ok) { pass++; console.log(`  ok   ${name}`); return; }
    fail++;
    console.log(`  FAIL ${name}${extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`);
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const USERS = {
    admin: { id: 1, full_name: 'System Admin', role: 'Level 1 Super Admin', status: 'active', team: null },
    amy: { id: 2, full_name: 'Amy Agent', role: 'Level 10 Agent', status: 'active', team: 'Team A', reporting_to: 1 },
    alan: { id: 3, full_name: 'Alan Agent', role: 'Level 10 Agent', status: 'active', team: 'Team A', reporting_to: 1 },
    bob: { id: 4, full_name: 'Bob Agent', role: 'Level 10 Agent', status: 'active', team: 'Team B', reporting_to: 1 },
};

// In-memory tables behind the same AppDataStore calls the screens make.
const installStore = (users, sessionId, date) => {
    const db = window.__db = {
        prospects: [
            { id: 501, full_name: 'Tan Ah Kow', phone: '0121111111', status: 'active', responsible_agent_id: 2 },
            { id: 502, full_name: 'Lee Mei', phone: '0122222222', status: 'active', responsible_agent_id: 2 },
            { id: 503, full_name: 'Wong Siew', phone: '0123333333', status: 'active', responsible_agent_id: 2 },
            { id: 504, full_name: 'Chan Bee', phone: '0124444444', status: 'active', responsible_agent_id: 4 },
        ],
        activities: [{ id: sessionId, activity_type: 'EVENT', event_id: null, activity_date: date, lead_agent_id: 1, visibility: 'open', activity_title: 'TEST Big Night' }],
        events: [], event_attendees: [], customers: [], users: Object.values(users),
        venues: [{ id: 1, name: 'HQ', location: 'KL', sequence: 1 }],
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
        invalidateCache: () => {}, primeRows: () => {},
    });
    window.__toasts = [];
    for (const k of ['success', 'error', 'info', 'warning']) {
        const orig = window.UI.toast[k];
        window.UI.toast[k] = (m) => { window.__toasts.push(`${k}: ${m}`); return orig && orig.call(window.UI.toast, m); };
    }
    window.confirm = () => true;
    window.__rpc = [];
    // event_ticket_counts: same grouping as the SQL function.
    const counts = (p) => {
        const ids = new Set(db.activities.filter(a => String(a.event_id) === String(p.p_event) && a.activity_date === p.p_date).map(a => String(a.id)));
        const m = new Map();
        db.event_attendees.forEach(a => {
            if (!a.ticket_tier || !ids.has(String(a.activity_id)) || String(a.event_id) !== String(p.p_event)) return;
            const k = (a.ticket_team || '') + '|' + a.ticket_tier;
            m.set(k, (m.get(k) || 0) + 1);
        });
        return [...m].map(([k, n]) => ({ ticket_team: k.split('|')[0], ticket_tier: k.split('|')[1], taken: n }));
    };
    // event_ticket_revenue: same grouping as the SQL function (p_date null = all dates).
    const revenue = (p) => {
        const ids = new Set(db.activities.filter(a => String(a.event_id) === String(p.p_event) && (p.p_date == null || a.activity_date === p.p_date)).map(a => String(a.id)));
        const m = new Map();
        db.event_attendees.forEach(a => {
            if (!a.ticket_tier || !ids.has(String(a.activity_id)) || String(a.event_id) !== String(p.p_event)) return;
            const r = m.get(a.ticket_tier) || { ticket_tier: a.ticket_tier, taken: 0, amount: 0, paid_count: 0, paid_amount: 0 };
            r.taken++; r.amount += Number(a.ticket_price) || 0;
            if (a.paid) { r.paid_count++; r.paid_amount += Number(a.ticket_price) || 0; }
            m.set(a.ticket_tier, r);
        });
        return [...m.values()];
    };
    const fake = { rpc: async (name, p) => {
        window.__rpc.push(name);
        if (name === 'event_ticket_counts') return { data: counts(p), error: null };
        if (name === 'event_ticket_revenue') return { data: revenue(p), error: null };
        return { data: [], error: null };
    } };
    const real = window.supabase;
    window.supabase = new Proxy(real || {}, { get: (o, k) => (k === 'rpc' ? fake.rpc : o[k]) });
};

const login = (page, user) => page.evaluate((u) => { window._appState.cu = { ...u, username: u.full_name, email: u.id + '@example.test' }; }, user);

async function main() {
    const server = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore' });
    await sleep(1500);
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const pageErrors = [];
    const open = async (viewport) => {
        const page = await browser.newPage();
        await page.setViewport(viewport);
        page.on('pageerror', e => pageErrors.push(e.message));
        // Nothing may reach the live database from this test.
        await page.setRequestInterception(true);
        page.on('request', r => (/supabase\.co|vercel|posthog/.test(r.url()) ? r.abort() : r.continue()));
        await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(4000);
        await page.evaluate(() => {
            document.getElementById('login-container')?.style.setProperty('display', 'none');
            const shell = document.getElementById('app-shell');
            if (shell) { shell.style.display = 'flex'; shell.style.visibility = 'visible'; }
        });
        await login(page, USERS.admin);
        await page.evaluate(installStore, USERS, SESSION, DATE);
        await page.evaluate(async () => {
            await window._loadChunk('chunks/script-activities.min.js');
            await window._loadChunk('chunks/script-marketing.min.js');
            await window._loadChunk('chunks/script-calendar.min.js');
        });
        return page;
    };
    const helpers = (page, prefix) => ({
        shot: async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, prefix + name + '.png') }); } },
        modalText: () => page.evaluate(() => document.getElementById('global-modal-overlay')?.innerText || ''),
        clickButton: (label) => page.evaluate((l) => {
            const b = [...document.querySelectorAll('#global-modal-overlay .modal-footer button, #global-modal-overlay .modal-actions button, #global-modal-overlay button')].find(x => x.textContent.trim() === l || x.textContent.trim().includes(l));
            if (b) b.click();
            return !!b;
        }, label),
        pickTier: (name) => page.evaluate((n) => {
            const opt = [...document.querySelectorAll('.tt-opt')].find(o => o.querySelector('.tt-opt-name')?.firstChild?.textContent.trim() === n);
            if (opt) opt.querySelector('input').click();
            return !!opt;
        }, name),
        optText: (name) => page.evaluate((n) => [...document.querySelectorAll('.tt-opt')].find(o => o.querySelector('.tt-opt-name')?.firstChild?.textContent.trim() === n)?.innerText.replace(/\s+/g, ' ') || '', name),
    });

    try {
        const page = await open({ width: 1280, height: 900 });
        const h = helpers(page, '');

        console.log('\nEvent form — Big event tick');
        await page.evaluate(async () => { window._appState.cmlt = 'events'; await window.app.openMarketingListAddModal(); });
        await page.waitForFunction(() => document.getElementById('tt-editor')?.dataset.ttReady === '1', { timeout: 8000 });
        const before = await page.evaluate(() => ({
            tick: !!document.getElementById('mkt-big-event'),
            normal: getComputedStyle(document.getElementById('mkt-normal-prices')).display,
            editor: getComputedStyle(document.getElementById('tt-editor')).display,
        }));
        check('tick is on the form', before.tick, before);
        check('single price shows for a normal event', before.normal !== 'none' && before.editor === 'none', before);
        await page.click('#mkt-big-event');
        await sleep(200);
        const after = await page.evaluate(() => ({
            normal: getComputedStyle(document.getElementById('mkt-normal-prices')).display,
            editor: getComputedStyle(document.getElementById('tt-editor')).display,
            presets: [...document.querySelectorAll('#tt-editor .tt-add button')].map(b => b.textContent.trim()),
        }));
        check('ticked → categories replace the single price', after.normal === 'none' && after.editor !== 'none', after);
        check('quick-add buttons for the usual names', ['+ Super VIP', '+ VVIP', '+ VIP', '+ Normal', '+ Agent (FOC)', '+ Agent (Paid)', '+ Other'].every(p => after.presets.includes(p)), after.presets);

        const add = (label) => page.evaluate((l) => { const b = [...document.querySelectorAll('#tt-editor .tt-add button')].find(x => x.textContent.trim() === l); if (b) b.click(); return !!b; }, label);
        await add('+ VVIP'); await add('+ VIP'); await add('+ Normal'); await add('+ Agent (FOC)');
        const teams = await page.evaluate(() => [...document.querySelectorAll('.tt-card')[0].querySelectorAll('.tt-seats label')].map(l => l.firstChild.textContent.trim()));
        check('seats per team: Team A, Team B, No team', JSON.stringify(teams) === JSON.stringify(['Team A', 'Team B', 'No team']), teams);
        const ao = await page.evaluate(() => [0, 1, 2, 3].map(i => document.getElementById('tt-ao-' + i).checked));
        check('Agent category starts as agents-only, others not', JSON.stringify(ao) === JSON.stringify([false, false, false, true]), ao);
        check('VVIP button gone once added', !(await page.evaluate(() => [...document.querySelectorAll('#tt-editor .tt-add button')].some(b => b.textContent.trim() === '+ VVIP'))));
        await page.evaluate(() => {
            const set = (id, v) => { const el = document.getElementById(id); el.value = v; };
            set('mkt-title', 'TEST Big Night (Claude)');
            const cb = [...document.querySelectorAll('#mkt-event-categories .mkt-event-category-cb')].find(c => !/汇集|汇聚/.test(c.value));
            cb.checked = true;
            // VVIP: early bird running; Team A 2, Team B 3, No team blank
            set('tt-p-0', '2888'); set('tt-ep-0', '2388'); set('tt-ee-0', '2099-12-31'); set('tt-s-0-0', '2'); set('tt-s-0-1', '3');
            // VIP: early bird over; Team A 1
            set('tt-p-1', '1288'); set('tt-ep-1', '988'); set('tt-ee-1', '2020-01-01'); set('tt-s-1-0', '1');
            set('tt-p-2', '388');
        });
        // "Same for all teams" copies the first filled box.
        await page.evaluate(() => { document.getElementById('tt-s-3-0').value = '20'; window.app.ttEdFillSeats(3); });
        const filled = await page.evaluate(() => [0, 1, 2].map(j => document.getElementById('tt-s-3-' + j).value));
        check('Same for all teams fills every team', filled.every(v => v === '20'), filled);
        // Removing re-renders without losing what was typed.
        await page.evaluate(() => { window.app.ttEdAdd(-1); });
        await page.evaluate(() => { window.app.ttEdRemove(4); });
        check('typed values survive add/remove', await page.evaluate(() => document.getElementById('tt-p-0').value === '2888' && document.getElementById('tt-s-0-1').value === '3'));
        await page.evaluate(() => document.getElementById('tt-editor').scrollIntoView());
        await h.shot('1-event-form');
        await page.evaluate(async () => { await window.app.saveMarketingListItem(); });
        await sleep(800);
        const ev = await page.evaluate(() => window.__db.events[0] || null);
        check('saved as a big event', ev && ev.is_big_event === true, ev);
        check('4 categories saved in order', ev && ev.ticket_tiers.map(t => t.name).join(',') === 'VVIP,VIP,Normal,Agent (FOC)', ev && ev.ticket_tiers);
        const vvip = ev && ev.ticket_tiers[0];
        check('VVIP price + early bird + seats per team', vvip && vvip.price === 2888 && vvip.early_price === 2388 && vvip.early_end === '2099-12-31'
            && vvip.seats['Team A'] === 2 && vvip.seats['Team B'] === 3 && !('_none' in vvip.seats), vvip);
        check('agents-only saved on Agent (FOC) only', ev && ev.ticket_tiers.map(t => !!t.agent_only).join() === 'false,false,false,true', ev && ev.ticket_tiers.map(t => t.agent_only));
        check('Normal has no limit', ev && Object.keys(ev.ticket_tiers[2].seats).length === 0, ev && ev.ticket_tiers[2]);
        check('Ticket Price = lowest paid category', ev && ev.ticket_price === 388, ev && ev.ticket_price);
        const EID = ev ? ev.id : 0;
        await page.evaluate((eid) => { window.__db.activities[0].event_id = eid; window.UI.hideModal(); }, EID);

        console.log('\nEvent form — editing a big event');
        await page.evaluate(async (eid) => { await window.app.openMarketingListEditModal(eid); }, EID);
        await page.waitForFunction(() => document.getElementById('tt-editor')?.dataset.ttReady === '1', { timeout: 8000 });
        const edit = await page.evaluate(() => ({
            ticked: document.getElementById('mkt-big-event').checked,
            cards: document.querySelectorAll('.tt-card').length,
            vvipA: document.getElementById('tt-s-0-0').value,
            normal: getComputedStyle(document.getElementById('mkt-normal-prices')).display,
        }));
        check('opens ticked with the 4 categories', edit.ticked && edit.cards === 4 && edit.vvipA === '2' && edit.normal === 'none', edit);
        await page.evaluate(() => { document.getElementById('tt-n-1').value = 'vvip'; });
        await page.evaluate(async (eid) => { window.__toasts.length = 0; await window.app.saveMarketingListItem(eid); }, EID);
        check('duplicate category names are refused', (await page.evaluate(() => window.__toasts)).some(t => /both called/.test(t)));
        await page.evaluate(() => window.UI.hideModal());

        console.log('\nAdd Attendee — Amy (Team A)');
        await login(page, USERS.amy);
        await page.evaluate((eid, s, d) => window.app.showAddAttendeeSearch(eid, s, d), EID, SESSION, DATE);
        await page.waitForFunction(() => document.querySelectorAll('.tt-opt').length === 4, { timeout: 8000 });
        check('picker lists the 4 categories', true);
        check('agents-only category is tagged in the picker', /agents only/.test(await h.optText('Agent (FOC)')), await h.optText('Agent (FOC)'));
        check('counts are for her team', (await page.evaluate(() => document.querySelector('.tt-pick-for')?.textContent || '')).includes('Team A'));
        const vvipOpt = await h.optText('VVIP');
        check('VVIP: early-bird price, struck normal price, 2 of 2 left', /RM 2,388/.test(vvipOpt) && /RM 2,888/.test(vvipOpt) && /early bird/.test(vvipOpt) && /2 of 2 left/.test(vvipOpt), vvipOpt);
        const vipOpt = await h.optText('VIP');
        check('VIP: early bird ended → normal price', /RM 1,288/.test(vipOpt) && !/early bird/.test(vipOpt) && /1 of 1 left/.test(vipOpt), vipOpt);
        check('Normal: no limit', /no limit/.test(await h.optText('Normal')), await h.optText('Normal'));
        await page.evaluate(() => window.app.selectAddAttendee(501, 'Tan Ah Kow', 'prospect'));
        await page.evaluate(async () => { window.__toasts.length = 0; await window.app.confirmAddAttendee(); });
        check('Add without a category is refused', (await page.evaluate(() => window.__toasts)).includes('error: Pick a ticket category'), await page.evaluate(() => window.__toasts));
        check('nothing saved yet', (await page.evaluate(() => window.__db.event_attendees.length)) === 0);
        await h.pickTier('VVIP');
        await h.shot('2-add-attendee-picker');
        await page.evaluate(async () => { await window.app.confirmAddAttendee(); });
        await sleep(300);
        const a1 = await page.evaluate(() => window.__db.event_attendees[0] || null);
        check('saved with VVIP, early-bird price, Team A', a1 && a1.ticket_tier === vvip.key && a1.ticket_tier_name === 'VVIP' && a1.ticket_price === 2388 && a1.ticket_team === 'Team A', a1);

        const addVvip = async (id, name) => {
            await page.evaluate((eid, s, d) => window.app.showAddAttendeeSearch(eid, s, d), EID, SESSION, DATE);
            await page.waitForFunction(() => document.querySelectorAll('.tt-opt').length === 4, { timeout: 8000 });
            await page.evaluate((i, n) => window.app.selectAddAttendee(i, n, 'prospect'), id, name);
            await h.pickTier('VVIP');
        };
        await addVvip(502, 'Lee Mei');
        await page.evaluate(async () => { await window.app.confirmAddAttendee(); });
        await sleep(300);
        check('second VVIP saved', (await page.evaluate(() => window.__db.event_attendees.length)) === 2);

        console.log('\nRun out pop-up');
        await addVvip(503, 'Wong Siew');
        check('VVIP now shows Full', /Full · 2 of 2/.test(await h.optText('VVIP')), await h.optText('VVIP'));
        check('full category is still pickable', await page.evaluate(() => document.querySelector('.tt-opt.is-full input:checked') !== null));
        page.evaluate(async () => { window.__addDone = false; await window.app.confirmAddAttendee(); window.__addDone = true; });
        await page.waitForSelector('#tt-full-pop', { timeout: 5000 });
        const popText = await page.evaluate(() => document.getElementById('tt-full-pop').innerText);
        check('pop-up: VVIP tickets have run out, 2 of 2', /VVIP tickets have run out/.test(popText) && /Team A: 2 of 2 seats taken/.test(popText), popText);
        await h.shot('3-run-out-popup');
        await page.evaluate(() => window.app.ttFullAnswer(false));
        await page.waitForFunction(() => window.__addDone === true, { timeout: 5000 });
        check('Pick another → nothing saved, picker still open', (await page.evaluate(() => window.__db.event_attendees.length)) === 2 && (await h.modalText()).includes('Ticket category'));
        page.evaluate(async () => { window.__addDone = false; await window.app.confirmAddAttendee(); window.__addDone = true; });
        await page.waitForSelector('#tt-full-pop', { timeout: 5000 });
        await page.evaluate(() => window.app.ttFullAnswer(true));
        await page.waitForFunction(() => window.__addDone === true, { timeout: 5000 });
        const a3 = await page.evaluate(() => window.__db.event_attendees[2] || null);
        check('Register anyway → saved over the limit', a3 && a3.ticket_tier_name === 'VVIP' && a3.entity_name === 'Wong Siew', a3);
        check('pop-up gone', !(await page.evaluate(() => !!document.getElementById('tt-full-pop'))));

        console.log('\nAdd Agent — picks a category too');
        await page.evaluate(async (eid, s, d) => { await window.app.showAddConsultantSearch(eid, s, d); }, EID, SESSION, DATE);
        await page.waitForFunction(() => document.querySelectorAll('.tt-opt').length === 4, { timeout: 8000 });
        await page.evaluate(() => window.app.selectAddConsultant(3, 'Alan Agent'));
        await h.pickTier('Agent (FOC)');
        await page.evaluate(async () => { await window.app.confirmAddConsultant(); });
        await sleep(300);
        const ag = await page.evaluate(() => window.__db.event_attendees.find(a => a.attendee_type === 'agent') || null);
        check('agent saved with Agent (FOC) at RM 0', ag && ag.ticket_tier_name === 'Agent (FOC)' && ag.ticket_price === 0, ag);

        console.log('\nNew Friend on a big event — ticket picked first');
        await page.evaluate((eid, s, d) => window.app.showAddAttendeeSearch(eid, s, d), EID, SESSION, DATE);
        await page.waitForFunction(() => document.querySelectorAll('.tt-opt').length === 4, { timeout: 8000 });
        await page.evaluate(async () => { window.__toasts.length = 0; window.app.openProspectModal = () => { window.__prospectFormOpened = true; }; await window.app.showFTFAttendeeForm(); });
        check('New Friend without a category is refused', (await page.evaluate(() => window.__toasts)).includes('error: Pick a ticket category') && !(await page.evaluate(() => window.__prospectFormOpened)));
        await h.pickTier('Normal');
        await page.evaluate(async () => { await window.app.showFTFAttendeeForm(); });
        check('then the prospect form opens', await page.evaluate(() => window.__prospectFormOpened === true));
        await page.evaluate(() => { window.__db.prospects.push({ id: 600, full_name: 'New Pal', status: 'active' }); document.dispatchEvent(new CustomEvent('prospectCreated', { detail: { id: 600, full_name: 'New Pal' } })); });
        await page.waitForFunction(() => window.__db.event_attendees.some(a => a.attendee_id === 600), { timeout: 5000 });
        const pal = await page.evaluate(() => window.__db.event_attendees.find(a => a.attendee_id === 600));
        check('new friend saved with the Normal ticket', pal.ticket_tier_name === 'Normal' && pal.ticket_price === 388 && pal.ticket_team === 'Team A', pal);

        console.log('\nAttendee list — Amy');
        // One attendee from before the event was big: no ticket yet.
        await page.evaluate((eid, s) => { window.__db.event_attendees.push({ id: 1990, event_id: eid, activity_id: s, attendee_id: 504, entity_id: 504, entity_name: 'Chan Bee', attendee_type: 'prospect', attendance_status: 'Registered', added_by_agent_id: 2 }); }, EID, SESSION);
        await page.evaluate(async (s) => { await window.app.viewActivityDetails(s); }, SESSION);
        await page.waitForFunction(() => !!document.querySelector('.tt-sum'), { timeout: 8000 });
        const list = await page.evaluate(() => ({
            chips: [...document.querySelectorAll('.att-row .tt-chip')].map(c => c.textContent.trim()),
            sum: document.querySelector('.tt-sum')?.innerText.replace(/\s+/g, ' '),
        }));
        check('chips show category + price', list.chips.filter(c => c === '🎟 VVIP · RM 2,388').length === 3, list.chips);
        check('agent row chip', list.chips.includes('🎟 Agent (FOC) · RM 0'), list.chips);
        check('old attendee gets a Pick ticket button', list.chips.includes('🎟 Pick ticket'), list.chips);
        check('her team line: VVIP 3/2 · 1 over', /Team A seats/.test(list.sum) && /VVIP 3\/2 · 1 over/.test(list.sum) && /VIP 0\/1/.test(list.sum), list.sum);
        check('over shows red', await page.evaluate(() => !!document.querySelector('.tt-sum-item.is-over')));
        check('Event Details lists the categories', (await h.modalText()).replace(/\s+/g, ' ').includes('Tickets: VVIP RM 2,888 · VIP RM 1,288 · Normal RM 388 · Agent (FOC) RM 0'), (await h.modalText()).slice(0, 400));
        await page.evaluate(() => document.querySelector('.tt-sum')?.scrollIntoView({ block: 'center' }));
        await h.shot('4-attendee-list-agent');

        console.log('\nPick / change a ticket from the list');
        await page.evaluate(async (s) => { await window.app.ttOpenAttendeeTicket(1990, s); }, SESSION);
        await page.waitForFunction(() => document.querySelectorAll('#tt-pick-edit .tt-opt').length === 4, { timeout: 8000 });
        await h.pickTier('VIP');
        await page.evaluate(async (s) => { await window.app.ttSaveAttendeeTicket(1990, s); }, SESSION);
        await sleep(400);
        const chan = await page.evaluate(() => window.__db.event_attendees.find(a => a.id === 1990));
        check('old attendee now VIP, counted under the adder\'s team', chan.ticket_tier_name === 'VIP' && chan.ticket_price === 1288 && chan.ticket_team === 'Team A', chan);
        const a1id = a1.id;
        await page.evaluate(async (id, s) => { await window.app.ttOpenAttendeeTicket(id, s); }, a1id, SESSION);
        await page.waitForFunction(() => document.querySelectorAll('#tt-pick-edit .tt-opt').length === 4, { timeout: 8000 });
        check('change opens on the current category', await page.evaluate(() => document.querySelector('#tt-pick-edit .tt-opt.is-on .tt-opt-name')?.textContent === 'VVIP'));
        await page.evaluate(async (id, s) => { window.__toasts.length = 0; await window.app.ttSaveAttendeeTicket(id, s); }, a1id, SESSION);
        await sleep(300);
        check('keeping your own full category needs no pop-up', !(await page.evaluate(() => !!document.getElementById('tt-full-pop'))) && (await page.evaluate(() => window.__toasts)).some(t => /Ticket saved/.test(t)));

        console.log('\nRevenue (admin)');
        // Tan Ah Kow has paid; a second date of the same event sells one VIP.
        await page.evaluate(async (eid, a1) => {
            await window.app.toggleAttendeePaid(a1, true);
            window.__db.activities.push({ id: 702, activity_type: 'EVENT', event_id: eid, activity_date: '2026-12-21', lead_agent_id: 1, visibility: 'open' });
            window.__db.event_attendees.push({ id: 1991, event_id: eid, activity_id: 702, attendee_id: 504, entity_id: 504, entity_name: 'Chan Bee', attendee_type: 'prospect', added_by_agent_id: 4, ticket_tier: window.__db.events[0].ticket_tiers[1].key, ticket_tier_name: 'VIP', ticket_price: 1288, ticket_team: 'Team B' });
        }, EID, a1.id);

        console.log('\nAttendee list — admin');
        await login(page, USERS.admin);
        await page.evaluate(async (s) => { await window.app.viewActivityDetails(s); }, SESSION);
        await page.waitForFunction(() => !!document.querySelector('.tt-sum-table'), { timeout: 8000 });
        const table = await page.evaluate(() => [...document.querySelectorAll('.tt-sum-table tr')].map(r => [...r.children].map(c => c.textContent.trim())));
        check('team × category table', JSON.stringify(table[0]) === JSON.stringify(['Team', 'VVIP', 'VIP', 'Normal', 'Agent (FOC)']), table);
        const rowA = table.find(r => r[0] === 'Team A') || [];
        check('Team A row: VVIP 3/2 · 1 over, VIP 1/1, Agent 1/20', rowA[1] === '3/2 · 1 over' && rowA[2] === '1/1' && rowA[4] === '1/20', rowA);
        const rowB = table.find(r => r[0] === 'Team B') || [];
        check('Team B row: VVIP 0/3', rowB[1] === '0/3', rowB);
        const sales = table.find(r => r[0] === 'Sales') || [];
        const paidRow = table.find(r => r[0] === 'Paid') || [];
        check('Sales per category', JSON.stringify(sales) === JSON.stringify(['Sales', 'RM 7,164', 'RM 1,288', 'RM 388', 'RM 0']), sales);
        check('Paid per category', JSON.stringify(paidRow) === JSON.stringify(['Paid', 'RM 2,388', 'RM 0', 'RM 0', 'RM 0']), paidRow);
        const revText = await page.evaluate(() => [...document.querySelectorAll('.tt-rev-line')].map(l => l.textContent.replace(/\s+/g, ' ').trim()));
        check('this date total: sales / paid / unpaid', revText[0] === 'This date: Sales RM 8,840 · Paid RM 2,388 · Unpaid RM 6,452', revText);
        check('whole event total adds the other date', revText[1] === 'Whole event (all dates): Sales RM 10,128 · Paid RM 2,388 · Unpaid RM 7,740', revText);
        await page.evaluate(() => document.querySelector('.tt-sum-table')?.scrollIntoView({ block: 'center' }));
        await h.shot('5-attendee-list-admin');

        console.log('\nAdd Attendee — Bob (Team B) has his own pool');
        await login(page, USERS.bob);
        await page.evaluate((eid, s, d) => window.app.showAddAttendeeSearch(eid, s, d), EID, SESSION, DATE);
        await page.waitForFunction(() => document.querySelectorAll('.tt-opt').length === 4, { timeout: 8000 });
        check('Team B VVIP: 3 of 3 left', /3 of 3 left/.test(await h.optText('VVIP')), await h.optText('VVIP'));
        check('Team B VIP: no limit (none set)', /no limit/.test(await h.optText('VIP')), await h.optText('VIP'));

        console.log('\nAdmin can count under another team');
        await login(page, USERS.admin);
        await page.evaluate((eid, s, d) => window.app.showAddAttendeeSearch(eid, s, d), EID, SESSION, DATE);
        await page.waitForFunction(() => document.querySelectorAll('.tt-opt').length === 4, { timeout: 8000 });
        const sel = await page.evaluate(() => [...document.querySelectorAll('.tt-pick-team option')].map(o => o.textContent.trim()));
        check('team selector lists every team', JSON.stringify(sel) === JSON.stringify(['Team A', 'Team B', 'No team']), sel);
        await page.evaluate(() => window.app.ttPickTeam('Team A'));
        check('switching team switches the counts', /3 of 2 · 1 over/.test(await h.optText('VVIP')), await h.optText('VVIP'));

        console.log('\nClient prices — agents-only left out');
        const tk = await page.evaluate(() => window.UI.eventTickets({ is_big_event: true, country: 'MY', ticket_tiers: [
            { key: 'a', name: 'VVIP', price: 2888, early_price: 2388, early_end: '2099-12-31' },
            { key: 'b', name: 'Agent (Paid)', price: 100, agent_only: true },
            { key: 'c', name: 'Normal', price: 388 } ] }));
        check('UI.eventTickets: list, early bird, from', tk && tk.list === 'VVIP RM 2,888 · Normal RM 388' && tk.early === 'VVIP RM 2,388 (till 31 Dec)' && tk.from === 388, tk);
        check('UI.eventTickets: normal event → null', (await page.evaluate(() => window.UI.eventTickets({ is_big_event: false, ticket_price: 50 }))) === null);
        await page.evaluate(async (s) => { window.UI.hideModal(); await window.app.sendDescriptionInvite(s); }, SESSION);
        await sleep(500);
        const invite = (await page.evaluate(() => document.querySelector('#global-modal-overlay textarea')?.value || '')).replace(/\s+/g, ' ');
        check('WhatsApp invite lists client tickets', invite.includes('Tickets: VVIP RM 2,888 · VIP RM 1,288 · Normal RM 388'), invite.slice(0, 400));
        check('WhatsApp invite has the early bird line', invite.includes('Early bird: VVIP RM 2,388 (till 31 Dec)'), invite.slice(0, 400));
        check('no agent ticket in the invite', !/Agent/.test(invite), invite.slice(0, 400));
        await h.shot('6-whatsapp-invite');
        await page.evaluate(async (eid) => {
            window.UI.hideModal();
            Object.assign(window.__db.events[0], { date: '2026-12-20', published_to_noticeboard: true });
            await window._loadChunk('chunks/script-performance.min.js');
            await window.app.openNoticeboardDetail(eid);
        }, EID);
        await sleep(500);
        const nbd = (await h.modalText()).replace(/\s+/g, ' ');
        check('noticeboard detail lists client tickets + early bird', nbd.includes('VVIP RM 2,888 · VIP RM 1,288 · Normal RM 388') && nbd.includes('Early bird: VVIP RM 2,388') && !/Agent/.test(nbd), nbd.slice(0, 300));
        await page.evaluate(async () => {
            window.UI.hideModal();
            let box = document.getElementById('tt-test-view');
            if (!box) { box = document.createElement('div'); box.id = 'tt-test-view'; box.style.cssText = 'position:fixed;inset:0;z-index:50;background:#fff;overflow:auto;'; document.body.appendChild(box); }
            await window.app.showNoticeboardView(box);
        });
        await page.waitForFunction(() => !!document.querySelector('#tt-test-view .nb-price-badge'), { timeout: 8000 })
            .catch(() => {});
        const badge = await page.evaluate(() => [...document.querySelectorAll('#tt-test-view .nb-price-badge')].map(b => b.textContent.trim()));
        check('noticeboard card: From RM 388 · 早鸟', badge.includes('From RM 388 · 早鸟'), badge);
        await page.evaluate(() => document.querySelector('#tt-test-view .nb-price-badge')?.scrollIntoView({ block: 'center' }));
        await h.shot('7-noticeboard-card');
        await page.evaluate(async () => {
            const box = document.getElementById('tt-test-view');
            window._appState.cmlt = 'events';
            // The save earlier already drew the list into the main page — one #ml-react-root only.
            document.querySelectorAll('#ml-react-root').forEach(e => e.remove());
            await window.app.showMarketingListsView(box);
        });
        await page.waitForFunction(() => /From RM 388/.test(document.getElementById('tt-test-view')?.innerText || ''), { timeout: 8000 })
            .catch(() => {});
        const ml = (await page.evaluate(() => document.getElementById('tt-test-view').innerText)).replace(/\s+/g, ' ');
        check('Marketing list: From RM 388 + every category', ml.includes('From RM 388') && ml.includes('VVIP · VIP · Normal · Agent (FOC)') && ml.includes('per category'), ml.slice(0, 300));
        await h.shot('8-marketing-list');
        await page.evaluate(() => document.getElementById('tt-test-view')?.remove());

        console.log('\nA normal event shows no picker');
        await page.evaluate(() => {
            window.__db.events.push({ id: 4242, title: 'TEST Normal Talk', is_big_event: false, ticket_price: 50 });
            window.__db.activities.push({ id: 701, activity_type: 'EVENT', event_id: 4242, activity_date: '2026-12-21', lead_agent_id: 1, visibility: 'open' });
        });
        await page.evaluate(() => window.app.showAddAttendeeSearch(4242, 701, '2026-12-21'));
        await sleep(600);
        check('no ticket section', (await page.evaluate(() => document.getElementById('tt-pick-att')?.innerHTML.trim())) === '');
        await page.evaluate(() => window.app.selectAddAttendee(504, 'Chan Bee', 'prospect'));
        await page.evaluate(async () => { await window.app.confirmAddAttendee(); });
        await sleep(300);
        const plain = await page.evaluate(() => window.__db.event_attendees.find(a => a.activity_id === 701) || null);
        check('saved with no ticket fields', plain && !('ticket_tier' in plain) && !('ticket_price' in plain), plain);

        console.log('\nPhone');
        const phone = await open({ width: 400, height: 850, isMobile: true, hasTouch: true });
        const p = helpers(phone, 'phone-');
        check('phone layout is on', await phone.evaluate(() => window.matchMedia('(max-width: 768px)').matches));
        await phone.evaluate(async () => { window._appState.cmlt = 'events'; await window.app.openMarketingListAddModal(); });
        await phone.waitForFunction(() => document.getElementById('tt-editor')?.dataset.ttReady === '1', { timeout: 8000 });
        await phone.evaluate(() => { const cb = document.getElementById('mkt-big-event'); cb.scrollIntoView({ block: 'center' }); cb.click(); });
        await phone.evaluate(() => { window.app.ttEdAdd(1); window.app.ttEdAdd(2); });
        await phone.evaluate(() => document.querySelector('.tt-card')?.scrollIntoView({ block: 'start' }));
        await sleep(200);
        const noScroll = await phone.evaluate(() => { const m = document.querySelector('#global-modal-overlay .modal-content'); return m ? m.scrollWidth <= m.clientWidth + 1 : false; });
        check('form fits the phone width', noScroll);
        await p.shot('1-event-form');
        await phone.evaluate(() => window.UI.hideModal());
        // Same big event on the phone page.
        await phone.evaluate((e, atts) => {
            window.__db.events.push(e);
            window.__db.activities[0].event_id = e.id;
            atts.forEach(a => window.__db.event_attendees.push(a));
        }, await page.evaluate(() => window.__db.events[0]), await page.evaluate(() => window.__db.event_attendees.filter(a => a.activity_id === 700)));
        await login(phone, USERS.amy);
        await phone.evaluate((eid, s, d) => window.app.showAddAttendeeSearch(eid, s, d), EID, SESSION, DATE);
        await phone.waitForFunction(() => document.querySelectorAll('.tt-opt').length === 4, { timeout: 8000 });
        await phone.evaluate(() => { window.__db.prospects.push({ id: 505, full_name: 'Ng Ah Lian', status: 'active' }); window.app.selectAddAttendee(505, 'Ng Ah Lian', 'prospect'); });
        await p.pickTier('VIP');
        await phone.evaluate(() => document.querySelector('.tt-pick')?.scrollIntoView({ block: 'center' }));
        await p.shot('2-picker');
        phone.evaluate(async () => { await window.app.confirmAddAttendee(); });
        await phone.waitForSelector('#tt-full-pop', { timeout: 5000 });
        await p.shot('3-run-out-popup');
        await phone.evaluate(() => window.app.ttFullAnswer(false));
        await phone.evaluate(() => window.UI.hideModal());
        await phone.evaluate(async (s) => { await window.app.viewActivityDetails(s); }, SESSION);
        await phone.waitForFunction(() => !!document.querySelector('.tt-sum'), { timeout: 8000 });
        await phone.evaluate(() => document.querySelector('.tt-sum')?.scrollIntoView({ block: 'start' }));
        await p.shot('4-attendee-list');
        const rowFits = await phone.evaluate(() => [...document.querySelectorAll('.att-row')].every(r => r.scrollWidth <= r.clientWidth + 1));
        check('attendee rows fit the phone width', rowFits);

        check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 5));
    } catch (e) {
        fail++;
        console.log('  FAIL threw — ' + (e && e.stack || e));
    } finally {
        await browser.close();
        server.kill();
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}

main();
