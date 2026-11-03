#!/usr/bin/env node
/**
 * ci/browser-name-list.js — the Name List page in a real browser.
 *
 * Mock login + fake RPCs (nothing reaches Supabase): the sidebar tab sits right
 * after Prospect / Customer (admin + agent order), the page and its 3 tabs, New
 * list (purpose → goal choices, payload), a list's rows (ticked / suggested /
 * taken off, Do not contact, contacted-often warning, next step, progress, team
 * groups), every row action → the right RPC + arguments, take-off needs a
 * reason, add a person → warning → Add anyway, Start list, an old version is
 * read-only, Who to Focus + event results come from the reporting chunk, the
 * Reports pointer card, and the phone layout + drawer item.
 * The database side is ci/sql/name-list-scenario.sql.
 *
 * Usage: node ci/browser-name-list.js [screenshot-dir]
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

// Fake RPC + table reads, installed in the page.
const installFakes = () => {
    const row = (o) => Object.assign({
        person_key: 'p:' + o.id, prospect_id: o.id, customer_id: null, agent_id: 1, agent_name: 'System Admin',
        fit: 60, engagement: 40, readiness: 0, grp: 'potential', rank: 1, reasons: [{ t: 'Recent CPS', d: '2026-10-20', p: 30 }],
        warnings: [], last_touch: '2026-10-29', engine_picked: true, next_step: 'Share 风水 Feng Shui', next_step_why: 'Fits, not approached yet',
        source: 'engine', decision: 'selected', contact_at: null, reply: null, met_at: null, sale_amount: null, freq: 0, dni: false,
        phone: '0123456789', prefers_call: false,
    }, o);
    const list = (o) => Object.assign({
        id: 11, name: 'TEST Feng shui Nov', purpose: 'promote', line: 'fengshui', line_label: '风水 Feng Shui', goal: 'decide', focus: [],
        focus_names: [], scope: 'mine', status: 'active', target_qty: 3, target_date: '2026-11-30', remarks: null,
        owner_id: 1, owner_name: 'System Admin', mine: true, can_manage: true,
    }, o);
    const detail = (ver) => ({
        list: list({}),
        version: { no: ver || 2, latest: !ver || ver === 2, held: { do_not_invite: 2, paused: 1 }, candidates: 9, offered: 6, picked: 3 },
        versions: [{ no: 2, generated_at: '2026-11-03T10:00:00Z', by: 'System Admin' }, { no: 1, generated_at: '2026-11-01T10:00:00Z', by: 'System Admin' }],
        counts: { picked: 3, contacted: 1, replied: 1, interested: 1, met: 0, closed: 1, revenue: 3800, closed_after_contact: 1 },
        freq_limit: 2, freq_days: 30,
        rows: [
            row({ id: 101, name: 'Alice Lee', grp: 'strong', fit: 85, contact_at: '2026-11-02T17:10:00Z', contact_via: 'whatsapp', reply: 'interested', reply_note: 'wants a visit', sale_amount: 3800, sale_date: '2026-11-03', sale_item: 'Power Ring' }),
            row({ id: 102, name: 'Ben Tan', freq: 2, rank: 2 }),
            row({ id: 103, name: 'Cara Dnf', dni: true, rank: 3 }),
            row({ id: 104, name: 'Dan Extra', decision: 'pending', engine_picked: false, rank: 4 }),
            row({ id: 105, name: 'Eve Gone', decision: 'removed', decision_reason: 'not_fit', decision_note: 'moved overseas', decided_by_name: 'System Admin', rank: 5 }),
            row({ id: 106, name: 'Fay Added', customer_id: 77, prospect_id: null, person_key: 'c:77', source: 'manual', added_by_name: 'System Admin', add_note: 'met at dinner', reasons: [], fit: null }),
        ],
    });
    window.__calls = [];
    window.__nl = { index: [
        { ...list({}), version: 2, counts: { picked: 3, contacted: 1, replied: 1, interested: 1, met: 0, closed: 1, revenue: 3800, agents: 1 } },
        { ...list({ id: 12, name: 'TEST Team ring', scope: 'team', status: 'draft', line: 'ring', line_label: 'Power Ring', goal: 'decide', target_qty: 9 }), version: 1, counts: { picked: 18, agents: 2 } },
        { ...list({ id: 13, name: 'TEST Old list', status: 'completed' }), version: 1, counts: { picked: 5, contacted: 5, closed: 2, revenue: 9000 } },
    ] };
    const rpc = async (name, args) => {
        window.__calls.push({ name, args: JSON.parse(JSON.stringify(args || {})) });
        switch (name) {
            case 'name_list_index': return { data: { lists: window.__nl.index, can_team: true }, error: null };
            case 'name_list_get': return { data: detail(args.p_version), error: null };
            case 'name_list_create': return { data: { ok: true, id: 11, version: 1 }, error: null };
            case 'name_list_add': return { data: args.p_force ? { ok: true, id: 107 } : { ok: false, warn: 'Contacted 2× in the last 30 days' }, error: null };
            case 'event_invite_results': return { data: [{ activity_id: 5, date: '2026-10-31', title: 'TEST 天心交喜', objectives: ['fengshui:decide'], reasons: {}, suggested: 33, added: 2, sent: 20, coming: 8, came: 6, closed: 1 }], error: null };
            case 'new_friend_list': case 'invite_smart_list': return { data: [], error: null };
            default: return { data: { ok: true }, error: null };
        }
    };
    const tables = {
        invite_lines: [{ key: 'fengshui', label: '风水 Feng Shui', subcategories: ['Fengshui'] }, { key: 'ring', label: 'Power Ring', subcategories: ['Ring'] }, { key: 'general', label: 'General 一般', subcategories: [] }],
        products: [{ id: 501, name: '换天心 Huan Tian Xin', subcategory: 'Fengshui' }, { id: 502, name: 'Power Ring Gold', subcategory: 'Ring' }],
        activities: [{ id: 9001, activity_title: 'TEST 汇集 USJ', activity_date: '2026-11-08', start_time: '19:30', event_id: 1 }],
    };
    const q = (t) => {
        const b = { select: () => b, eq: () => b, gte: () => b, lte: () => b, order: () => b, limit: () => b, in: () => b,
            then: (res, rej) => Promise.resolve({ data: tables[t] || [], error: null }).then(res, rej) };
        return b;
    };
    const real = window.supabase;
    window.supabase = new Proxy(real || {}, { get: (o, k) => (k === 'rpc' ? rpc : k === 'from' ? q : o[k]) });
    window.AppDataStore.searchProspects = async () => [{ id: 300, full_name: 'Gus Search', status: 'active' }];
    window.AppDataStore.searchCustomers = async () => [];
    window.__toasts = [];
    for (const k of ['success', 'error', 'info', 'warning']) {
        const orig = window.UI.toast[k];
        window.UI.toast[k] = (m) => { window.__toasts.push(`${k}: ${m}`); return orig && orig.call(window.UI.toast, m); };
    }
    window.confirm = () => true;
    window.__opened = [];
    window.open = (u) => { window.__opened.push(u); return null; };
};

const boot = async (page, user) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(4000);
    await page.evaluate((u) => {
        document.getElementById('login-container')?.style.setProperty('display', 'none');
        const shell = document.getElementById('app-shell');
        if (shell) { shell.style.display = 'flex'; shell.style.visibility = 'visible'; }
        window._appState.cu = u;
    }, user);
    await page.evaluate(installFakes);
};

async function main() {
    const server = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore' });
    await sleep(1500);
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const pageErrors = [];
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 900 });
        await page.emulateTimezone('Asia/Kuala_Lumpur');
        page.on('pageerror', e => pageErrors.push(e.message));
        await page.setRequestInterception(true);
        page.on('request', r => (/supabase\.co|vercel|posthog|wa\.me/.test(r.url()) ? r.abort() : r.continue()));
        const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }); } };
        const calls = (name) => page.evaluate((n) => window.__calls.filter(c => c.name === n), name);
        const last = async (name) => { const c = await calls(name); return c[c.length - 1]; };
        const text = () => page.evaluate(() => document.getElementById('nlp-body')?.innerText || '');
        const click = (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (el) el.click(); return !!el; }, sel);
        const clickText = (sel, label) => page.evaluate((s, l) => {
            const el = [...document.querySelectorAll(s)].find(x => x.textContent.trim().includes(l));
            if (el) el.click();
            return !!el;
        }, sel, label);

        await boot(page, { id: 1, username: 'admin', full_name: 'System Admin', role: 'Level 1 Super Admin', status: 'active', email: 'admin@example.test' });

        console.log('\nSidebar');
        await page.evaluate(() => window.app.updateNavVisibility());
        const sb = await page.evaluate(() => {
            const items = [...document.querySelectorAll('.sidebar-menu .sb-nav-item')].filter(b => b.style.display !== 'none').map(b => b.id.replace('sb-nav-', ''));
            return items;
        });
        check('admin sees Name List', sb.includes('name-list'), sb);
        check('admin: right after Prospect / Customer', sb[sb.indexOf('prospects') + 1] === 'name-list', sb);
        await page.evaluate(() => { window._appState.cu = { id: 2, full_name: 'TEST Agent', role: 'Level 7 Consultant', status: 'active' }; window.app.updateNavVisibility(); });
        const sbA = await page.evaluate(() => [...document.querySelectorAll('.sidebar-menu .sb-nav-item')].filter(b => b.style.display !== 'none').map(b => b.id.replace('sb-nav-', '')));
        check('agent (L7) order: calendar, 福运, prospects, NAME LIST, referrals …', sbA.slice(0, 5).join(',') === 'calendar,fude,prospects,name-list,referrals', sbA);
        await page.evaluate(() => { window._appState.cu = { id: 3, full_name: 'TEST L11', role: 'Level 11 Agent', status: 'active' }; window.app.updateNavVisibility(); });
        const sb11 = await page.evaluate(() => [...document.querySelectorAll('.sidebar-menu .sb-nav-item')].filter(b => b.style.display !== 'none').map(b => b.id.replace('sb-nav-', '')));
        check('L11 sees Name List too', sb11.includes('name-list'), sb11);
        await page.evaluate(() => { window._appState.cu = { id: 4, full_name: 'TEST Ambassador', role: '传福大使', status: 'active' }; window.app.updateNavVisibility(); });
        const sb12 = await page.evaluate(() => [...document.querySelectorAll('.sidebar-menu .sb-nav-item')].filter(b => b.style.display !== 'none').map(b => b.id.replace('sb-nav-', '')));
        check('传福大使 (L12) does not', !sb12.includes('name-list'), sb12);
        await page.evaluate(() => { window._appState.cu = { id: 1, username: 'admin', full_name: 'System Admin', role: 'Level 1 Super Admin', status: 'active' }; window.app.updateNavVisibility(); });

        console.log('\nPage + lists');
        await page.evaluate(() => window.app.navigateTo('name_list'));
        await page.waitForFunction(() => document.querySelectorAll('.nlp-card').length > 0, { timeout: 30000 });
        const idx = await text();
        check('three tabs', await page.evaluate(() => [...document.querySelectorAll('.nlp-tab')].map(t => t.textContent.trim()).join('|')) === '📋 My Lists|🎯 Who to Focus|📈 Results');
        check('open lists shown (active + draft)', idx.includes('TEST Feng shui Nov') && idx.includes('TEST Team ring') && !idx.includes('TEST Old list'), idx.slice(0, 300));
        check('card funnel + revenue', idx.includes('RM 3,800') && /3\/3\s*picked/.test(idx), idx.slice(0, 400));
        check('team card says per agent', idx.includes('team · 9 per agent'), idx.slice(0, 400));
        await shot('1-lists');
        await page.evaluate(() => window.app.nlpFilter('done'));
        await sleep(300);
        check('Done filter shows the finished list', (await text()).includes('TEST Old list'));
        await page.evaluate(() => window.app.nlpFilter('open'));
        await sleep(300);

        console.log('\nNew list');
        await page.evaluate(() => window.app.nlpNew());
        await page.waitForSelector('#nlp-f-line option', { timeout: 10000 });
        const goals = () => page.evaluate(() => [...document.querySelectorAll('#nlp-f-goal option')].map(o => o.value).join(','));
        check('Promote → Decide / Introduce / Upgrade', (await goals()) === 'decide,introduce,upgrade', await goals());
        check('focus products follow the line', await page.evaluate(() => [...document.querySelectorAll('#nlp-f-focus option')].map(o => o.textContent).join('|').includes('换天心')));
        check('team choice offered to a leader', await page.evaluate(() => !!document.querySelector('input[name="nlp-scope"][value="team"]')));
        await shot('2-new-list');
        await page.evaluate(() => { document.querySelector('input[name="nlp-purpose"][value="follow_up"]').checked = true; window.app.nlpFormSync(); });
        check('Follow up → Come back first, General line', (await goals()).startsWith('comeback') && await page.evaluate(() => document.getElementById('nlp-f-line').value === 'general'), await goals());
        await page.evaluate(() => { document.querySelector('input[name="nlp-purpose"][value="event"]').checked = true; window.app.nlpFormSync(); });
        check('Invite to an event hides the form', await page.evaluate(() => document.getElementById('nlp-f-main').hidden && !document.getElementById('nlp-f-event').hidden));
        await page.evaluate(() => {
            document.querySelector('input[name="nlp-purpose"][value="promote"]').checked = true; window.app.nlpFormSync();
            document.getElementById('nlp-f-line').value = 'fengshui'; window.app.nlpFormSync();
            document.getElementById('nlp-f-goal').value = 'upgrade';
            document.getElementById('nlp-f-focus').value = '501';
            document.getElementById('nlp-f-qty').value = '15';
            document.getElementById('nlp-f-date').value = '2026-11-30';
            document.getElementById('nlp-f-name').value = 'TEST upgrade';
        });
        await clickText('#global-modal-overlay button', 'Find the people');
        await page.waitForFunction(() => !!document.querySelector('.nlp-detail'), { timeout: 15000 });
        const cr = await last('name_list_create');
        check('create payload', cr && cr.args.p.line === 'fengshui' && cr.args.p.goal === 'upgrade' && cr.args.p.target_qty === 15
            && JSON.stringify(cr.args.p.focus) === '[501]' && cr.args.p.target_date === '2026-11-30' && cr.args.p.scope === 'mine' && cr.args.p.purpose === 'promote', cr);

        console.log('\nOne list');
        const dt = await text();
        check('header: line · goal, target, date, version picker', dt.includes('风水 Feng Shui · Decide 成交') && dt.includes('Target 3') && dt.includes('By 30 Nov')
            && await page.evaluate(() => !!document.querySelector('.nlp-vsel')), dt.slice(0, 300));
        check('held back explained', dt.includes('2 asked not to be contacted') && dt.includes('1 paused after saying no'), dt.slice(0, 500));
        check('sections: on the list 4 · suggestions 1 · taken off 1', dt.includes('On the list (4)') && dt.includes('More suggestions (1)') && dt.includes('Taken off (1)'));
        const alice = await page.evaluate(() => document.getElementById('nl-row-101')?.innerText || '');
        check('row: reasons, next step, scores', alice.includes('Recent CPS') && alice.includes('Share 风水 Feng Shui') && alice.includes('Fit 85'), alice);
        check('row: progress — WhatsApp on the local day, interested + note, closed RM', alice.includes('💬 WhatsApp 3 Nov') && alice.includes('Interested') && alice.includes('wants a visit') && alice.includes('Closed RM 3,800'), alice);
        check('contacted-often warning', (await page.evaluate(() => document.getElementById('nl-row-102')?.innerText || '')).includes('contacted 2× in 30 days'));
        const cara = await page.evaluate(() => ({ t: document.getElementById('nl-row-103')?.innerText || '', btns: [...document.querySelectorAll('#nl-row-103 .inv-acts button')].map(b => b.textContent.trim()) }));
        check('Do not contact: chip, no WhatsApp / Called', cara.t.includes('Do not contact') && !cara.btns.some(b => /WhatsApp|Called/.test(b)), cara);
        const fay = await page.evaluate(() => document.getElementById('nl-row-106')?.innerText || '');
        check('added person: chip + note, customer link', fay.includes('Added by System Admin') && fay.includes('met at dinner') && fay.includes('Customer'), fay);
        check('taken-off reason shown', (await page.evaluate(() => document.getElementById('nl-row-105')?.textContent || '')).includes('Not suitable now — moved overseas'));
        await shot('3-list');

        console.log('\nRow actions');
        await click('#nl-row-102 .inv-acts button:nth-child(2)'); // 📞 Called
        await sleep(400);
        let c = await last('name_list_step');
        check('Called → name_list_step(called)', c && c.args.p_row === 102 && c.args.p_step === 'called', c);
        await page.evaluate(() => window.app.nlpWhatsApp(102));
        check('WhatsApp opens wa.me with 60 number', await page.evaluate(() => /wa\.me\/60123456789\?text=/.test(window.__opened[0] || '')));
        await clickText('#nl-form-102 button', 'Sent ✓');
        await sleep(400);
        c = await last('name_list_step');
        check('Sent ✓ → name_list_step(whatsapp)', c && c.args.p_step === 'whatsapp' && c.args.p_row === 102, c);
        await page.evaluate(() => window.app.nlpForm(102, 'reply'));
        await page.evaluate(() => { document.getElementById('nl-note-102').value = 'call back next month'; });
        await clickText('#nl-form-102 button', 'Not now');
        await sleep(400);
        c = await last('name_list_step');
        check('Reply → not_now + note', c && c.args.p_step === 'not_now' && c.args.p_note === 'call back next month', c);
        await page.evaluate(() => window.app.nlpForm(102, 'reply'));
        await clickText('#nl-form-102 button', 'Asked us to stop');
        await sleep(400);
        c = await last('name_list_step');
        check('Asked us to stop → stop', c && c.args.p_step === 'stop', c);
        await page.evaluate(() => window.app.nlpForm(102, 'more'));
        await clickText('#nl-form-102 button', 'Take off the list');
        const before = (await calls('name_list_decide')).length;
        await clickText('#nl-form-102 button', 'Take off');
        await sleep(300);
        check('take off without a reason is refused', (await calls('name_list_decide')).length === before && await page.evaluate(() => window.__toasts.some(t => /Pick why/.test(t))));
        await page.evaluate(() => { document.getElementById('nl-r-102').value = 'handled'; document.getElementById('nl-rn-102').value = 'sister handles'; });
        await clickText('#nl-form-102 button', 'Take off');
        await sleep(400);
        c = await last('name_list_decide');
        check('take off → removed + reason + note', c && c.args.p_decision === 'removed' && c.args.p_reason === 'handled' && c.args.p_note === 'sister handles', c);
        await page.evaluate(() => document.querySelector('.nlp-more').open = true);
        await clickText('#nl-row-104 button', '+ Tick');
        await sleep(400);
        c = await last('name_list_decide');
        check('+ Tick a suggestion → selected', c && c.args.p_row === 104 && c.args.p_decision === 'selected', c);

        console.log('\nAdd a person');
        await page.evaluate(() => window.app.nlpToggleAdd());
        await page.evaluate(() => { document.getElementById('nlp-add-note').value = 'neighbour'; window.app.nlpAddSearch('Gus'); });
        await page.waitForFunction(() => document.getElementById('nlp-add-res')?.innerText.includes('Gus Search'), { timeout: 5000 });
        await click('#nlp-add-res .inv-add-row');
        await page.waitForFunction(() => document.getElementById('nlp-add-warn')?.innerText.includes('add anyway'), { timeout: 5000 });
        check('warning first (contacted often)', (await page.evaluate(() => document.getElementById('nlp-add-warn').innerText)).includes('Contacted 2×'));
        await clickText('#nlp-add-warn button', 'Add anyway');
        await sleep(400);
        const adds = await calls('name_list_add');
        check('Add anyway → force + note + prospect', adds.length === 2 && adds[0].args.p_force === false && adds[1].args.p_force === true
            && adds[1].args.p_prospect === 300 && adds[1].args.p_note === 'neighbour', adds);

        console.log('\nList actions + versions');
        await page.evaluate(() => window.app.nlpSet('completed'));
        await sleep(300);
        c = await last('name_list_set');
        check('Mark done → status completed', c && c.args.p.status === 'completed', c);
        await page.evaluate(() => window.app.nlpRegenerate());
        await sleep(300);
        check('New version → name_list_regenerate', (await calls('name_list_regenerate')).length === 1);
        await page.evaluate(() => window.app.nlpVersion(1));
        await page.waitForFunction(() => document.querySelector('.nlp-banner')?.innerText.includes('older version'), { timeout: 5000 });
        check('old version: banner, no row buttons, no add', await page.evaluate(() => document.querySelectorAll('.nl-row .inv-acts button').length === 0 && !document.getElementById('nlp-addbox')));
        check('version picker asked for V1', (await last('name_list_get')).args.p_version === 1);
        await shot('4-old-version');
        await page.evaluate(() => window.app.nlpBack());
        await sleep(400);

        console.log('\nWho to Focus + Results');
        await page.evaluate(() => window.app.nlpTab('focus'));
        await page.waitForFunction(() => !!document.querySelector('#nlp-focus #nl-body'), { timeout: 45000 });
        await sleep(800);
        const focusTabs = await page.evaluate(() => document.getElementById('nlp-focus').innerText);
        check('Who to Focus renders inside the page (no collapse header)', focusTabs.includes('Top Referral') && !focusTabs.includes('▼ Open') && !focusTabs.includes('▲ Hide'), focusTabs.slice(0, 200));
        check('…without its own Event results tab', !focusTabs.includes('Event results'), focusTabs.slice(0, 300));
        await shot('5-focus');
        await page.evaluate(() => window.app.nlpTab('results'));
        await page.waitForFunction(() => document.getElementById('nlp-ev-results')?.innerText.includes('天心交喜'), { timeout: 30000 });
        const res = await text();
        check('Results: started lists only, funnel + rates', res.includes('TEST Feng shui Nov') && !res.includes('TEST Team ring') && res.includes('100%'), res.slice(0, 400));
        check('Results: event invitations table', res.includes('TEST 天心交喜'), res.slice(0, 800));
        await shot('6-results');

        console.log('\nReports pointer');
        await page.evaluate(async () => {
            document.querySelector('#nlp-body')?.insertAdjacentHTML('afterbegin', '<div class="kpi-dashboard"><div id="kpi-stats-grid"></div></div>');
            await window.app.renderNameListMoved();
        });
        const card = await page.evaluate(() => document.getElementById('name-list-section')?.innerText || '');
        check('Reports shows the moved card with a link', card.includes('Open Name List'), card);

        console.log('\nPhone');
        const phone = await browser.newPage();
        await phone.setViewport({ width: 400, height: 850, isMobile: true, hasTouch: true });
        phone.on('pageerror', e => pageErrors.push(e.message));
        await phone.setRequestInterception(true);
        phone.on('request', r => (/supabase\.co|vercel|posthog|wa\.me/.test(r.url()) ? r.abort() : r.continue()));
        await boot(phone, { id: 2, full_name: 'TEST Agent', role: 'Level 7 Consultant', status: 'active' });
        await phone.evaluate(async () => { await window._loadChunk('chunks/script-mobile.min.js'); window.app.openMobileDrawer(); });
        await sleep(400);
        const drawer = await phone.evaluate(() => [...document.querySelectorAll('#mobile-drawer-body .mobile-drawer-item span')].map(s => s.textContent.trim()));
        check('phone drawer: Name List right after Prospect / Customer', drawer[drawer.indexOf('Prospect / Customer') + 1] === 'Name List', drawer);
        // the page remembers the last tab (desktop run ended on Results)
        await phone.evaluate(() => { try { localStorage.setItem('fs_nlp_tab', 'lists'); } catch (_) { /* private */ } window.app.closeMobileDrawer(); window.app.navigateTo('name_list'); });
        await phone.waitForFunction(() => document.querySelectorAll('.nlp-card').length > 0, { timeout: 30000 });
        check('phone: cards one per row', await phone.evaluate(() => {
            const c = [...document.querySelectorAll('.nlp-card')];
            return c.length > 1 && Math.abs(c[0].getBoundingClientRect().left - c[1].getBoundingClientRect().left) < 2;
        }));
        if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, '7-phone-lists.png') });
        await phone.evaluate(() => window.app.nlpOpen(11));
        await phone.waitForFunction(() => !!document.getElementById('nl-row-101'), { timeout: 15000 });
        const fit = await phone.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth,
            acts: (() => { const r = document.querySelector('#nl-row-102 .inv-acts').getBoundingClientRect(); return r.right <= window.innerWidth + 1; })() }));
        check('phone: no sideways scroll, buttons inside the screen', fit.sw <= fit.w + 1 && fit.acts, fit);
        if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, '8-phone-list.png'), fullPage: false });

        // The team-list phone notice opens ./index.html#name_list — boot only
        // honours hashes in _KNOWN_VIEWS, so without it the tap lands on Home.
        const known = /_KNOWN_VIEWS = new Set\(\[([\s\S]*?)\]\)/.exec(fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8'));
        check('#name_list opens Name List on start-up (notice tap / reload)', !!known && /'name_list'/.test(known[1]));

        check('no page errors', pageErrors.length === 0, pageErrors);
    } catch (e) {
        fail++;
        console.log('  FAIL crashed — ' + (e && e.stack || e));
    } finally {
        await browser.close();
        server.kill();
    }
    console.log(`\nbrowser-name-list: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}
main();
