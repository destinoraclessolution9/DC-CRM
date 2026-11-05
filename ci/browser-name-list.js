#!/usr/bin/env node
/**
 * ci/browser-name-list.js — the Name List page in a real browser.
 *
 * Mock login + fake RPCs (nothing reaches Supabase): the sidebar tab sits right
 * after Prospect / Customer (admin + agent order), the page and its 3 tabs, New
 * list (purpose → goal choices, payload), Who to include (bought exactly 1 /
 * 1+ / never, live count, bought-between, offer → next step + WhatsApp), a list's rows (ticked / suggested /
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
        list: list(window.__nlOwn ? { who: 'owns_1', bought_from: '2026-01-01', bought_to: '2026-06-30', offer: '2nd ring RM1,000 off' } : {}),
        version: { no: ver || 2, latest: !ver || ver === 2, held: { do_not_invite: 2, paused: 1 }, candidates: 9, offered: 6, picked: 3 },
        versions: [{ no: 2, generated_at: '2026-11-03T10:00:00Z', by: 'System Admin' }, { no: 1, generated_at: '2026-11-01T10:00:00Z', by: 'System Admin' }],
        counts: { picked: 3, contacted: 1, replied: 1, interested: 1, met: 0, closed: 1, revenue: 3800, closed_after_contact: 1 },
        freq_limit: 2, freq_days: 30,
        rows: [
            row({ id: 101, name: 'Alice Lee', grp: 'strong', fit: 85, contact_at: '2026-11-02T17:10:00Z', contact_via: 'whatsapp', reply: 'interested', reply_note: 'wants a visit', sale_amount: 3800, sale_date: '2026-11-03', sale_item: 'Power Ring',
                  feedback: [{ kind: 'wrong', reason: 'wrong_reason', note: 'met at a wedding', by: 'System Admin', at: '2026-11-04T03:00:00Z', took_off: false }] }),
            row({ id: 102, name: 'Ben Tan', freq: 2, rank: 2, contact_at: '2026-11-03T02:00:00Z', contact_via: 'called',
                  reasons: [{ t: 'Bought Power Ring PR6', d: '2024-01-01', p: 50, ref: 'person' }] }),
            row({ id: 103, name: 'Cara Dnf', dni: true, rank: 3 }),
            row({ id: 104, name: 'Dan Extra', decision: 'pending', engine_picked: false, rank: 4,
                  ...(window.__nlRule ? { next_step_rule: window.__nlRule, next_step: window.__nlRule === 'task_due' ? 'Follow up: Step 1 order WA' : 'Arrange a follow-up talk about 汇集' } : {}) }),
            row({ id: 105, name: 'Eve Gone', decision: 'removed', decision_reason: 'not_fit', decision_note: 'moved overseas', decided_by_name: 'System Admin', rank: 5 }),
            row({ id: 106, name: 'Fay Added', customer_id: 77, prospect_id: null, person_key: 'c:77', source: 'manual', added_by_name: 'System Admin', add_note: 'met at dinner', reasons: [], fit: null, reply: 'interested', reply_at: '2026-11-03T03:00:00Z' }),
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
            case 'name_list_preview': return { data: { match: 58, held: 1, agents: 8, per_agent_max: 31 }, error: null };
            case 'name_list_feedback': return { data: { ok: true, id: 1, took_off: !!args.p_take_off }, error: null };
            case 'name_list_feedback_report': return { data: {
                lists: [{ id: 11, name: 'TEST Feng shui Nov', line: 'fengshui', line_label: '风水 Feng Shui', goal: 'decide', who: 'best',
                          suggested: 6, kept: 3, added: 1, wrong: 2, missed: 1, by_reason: { owns_more: 1, wrong_reason: 1, should_match: 1 } }],
                notes: [{ list_id: 11, list: 'TEST Feng shui Nov', version: 2, name: 'Ben Tan', agent: 'System Admin', kind: 'wrong', reason: 'owns_more',
                          label: 'Already owns more than shown', note: 'bought a 2nd in Oct', took_off: true, by: 'System Admin',
                          at: '2026-11-05T03:00:00Z', fit: 60, owned: null, rule: 'default', crm_said: ['Recent CPS'] }] }, error: null };
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
            && JSON.stringify(cr.args.p.focus) === '[501]' && cr.args.p.target_date === '2026-11-30' && cr.args.p.scope === 'mine' && cr.args.p.purpose === 'promote'
            && cr.args.p.who === 'best' && cr.args.p.bought_from === null, cr);

        console.log('\nOne list');
        const dt = await text();
        check('header: line · goal, target, date, version picker', dt.includes('风水 Feng Shui · Decide 成交') && dt.includes('Target 3') && dt.includes('By 30 Nov')
            && await page.evaluate(() => !!document.querySelector('.nlp-vsel')), dt.slice(0, 300));
        check('held back explained', dt.includes('2 asked not to be contacted') && dt.includes('1 paused after saying no'), dt.slice(0, 500));
        check('sections: on the list 4 · suggestions 1 · taken off 1', dt.includes('On the list (4)') && dt.includes('More suggestions (1)') && dt.includes('Taken off (1)'));
        const alice = await page.evaluate(() => document.getElementById('nl-row-101')?.innerText || '');
        check('row: reasons + scores; closed sale → no next step', alice.includes('Recent CPS') && alice.includes('Fit 85') && !alice.includes('➜'), alice);
        const nextOf = (id) => page.evaluate((i) => document.querySelector(`#nl-row-${i} .nlp-next`)?.textContent || '', id);
        check('next step: untouched row keeps the engine plan', (await nextOf(104)).includes('Share 风水 Feng Shui') && (await nextOf(104)).includes('Fits, not approached yet'), await nextOf(104));
        check('next step: contacted, no reply → get their answer', (await nextOf(102)).includes('Get their answer') && !(await nextOf(102)).includes('not approached'), await nextOf(102));
        check('next step: interested → book a meeting about the line', (await nextOf(106)).includes('Book a meeting about 风水 Feng Shui'), await nextOf(106));
        check('next step: taken off → none', (await nextOf(105)) === '', await nextOf(105));
        check('row: progress — WhatsApp on the local day, interested + note, closed RM', alice.includes('💬 WhatsApp 3 Nov') && alice.includes('Interested') && alice.includes('wants a visit') && alice.includes('Closed RM 3,800'), alice);
        check('contacted-often warning', (await page.evaluate(() => document.getElementById('nl-row-102')?.innerText || '')).includes('contacted 2× in 30 days'));
        const cara = await page.evaluate(() => ({ t: document.getElementById('nl-row-103')?.innerText || '', btns: [...document.querySelectorAll('#nl-row-103 .inv-acts button')].map(b => b.textContent.trim()) }));
        check('Do not contact: chip, no WhatsApp / Called', cara.t.includes('Do not contact') && !cara.btns.some(b => /WhatsApp|Called/.test(b)), cara);
        const fay = await page.evaluate(() => document.getElementById('nl-row-106')?.innerText || '');
        check('added person: chip + note, customer link', fay.includes('Added by System Admin') && fay.includes('met at dinner') && fay.includes('Customer'), fay);
        check('taken-off reason shown', (await page.evaluate(() => document.getElementById('nl-row-105')?.textContent || '')).includes('Not suitable now — moved overseas'));

        console.log('\nNot right? notes');
        check('a row shows its note', alice.includes('👎 Not right: The reason shown is wrong') && alice.includes('met at a wedding'), alice);
        check('engine rows: "Not right?"; added by hand: "Why missed?"', await page.evaluate(() =>
            document.querySelector('#nl-row-102 .nlp-flag')?.textContent.includes('Not right?') && document.querySelector('#nl-row-106 .nlp-flag')?.textContent.includes('Why missed?')));
        await click('#nl-row-102 .nlp-flag');
        check('form: 7 "what is wrong" choices + take off ticked', await page.evaluate(() =>
            document.querySelectorAll('#nl-f-102 option').length === 8 && document.getElementById('nl-fo-102')?.checked === true));
        await page.evaluate(() => { document.getElementById('nl-f-102').value = 'other'; });
        await clickText('#nl-form-102 button', 'Save note');
        await sleep(300);
        check('"Other" needs a comment', (await calls('name_list_feedback')).length === 0 && (await page.evaluate(() => window.__toasts.slice(-1)[0] || '')).includes('comment'));
        await page.evaluate(() => { document.getElementById('nl-f-102').value = 'owns_more'; document.getElementById('nl-fn-102').value = 'bought a 2nd in Oct'; });
        await clickText('#nl-form-102 button', 'Save note');
        await sleep(400);
        let fb = await last('name_list_feedback');
        check('Save note → name_list_feedback(row, reason, comment, take off)', fb && fb.args.p_row === 102 && fb.args.p_reason === 'owns_more'
            && fb.args.p_note === 'bought a 2nd in Oct' && fb.args.p_take_off === true, fb);
        await click('#nl-row-106 .nlp-flag');
        check('added by hand: "why missed" choices, no take off', await page.evaluate(() =>
            document.querySelectorAll('#nl-f-106 option').length === 5 && !document.getElementById('nl-fo-106')));
        await page.evaluate(() => { document.getElementById('nl-f-106').value = 'not_recorded'; });
        await clickText('#nl-form-106 button', 'Save note');
        await sleep(400);
        fb = await last('name_list_feedback');
        check('why-missed note saved, never takes off', fb && fb.args.p_row === 106 && fb.args.p_reason === 'not_recorded' && fb.args.p_take_off === false, fb);
        await page.evaluate(() => { document.querySelector('details[data-g="off"]').open = true; });
        await page.evaluate(() => window.app.nlpDecide(104, 'selected'));
        await sleep(400);
        check('an open section stays open after a row action', await page.evaluate(() => document.querySelector('details[data-g="off"]')?.open === true
            && document.querySelector('details[data-g="more"]')?.open === false));
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
        await page.evaluate(() => { document.getElementById('nlp-add-note').value = 'neighbour'; document.getElementById('nlp-add-why').value = 'referred'; window.app.nlpAddSearch('Gus'); });
        await page.waitForFunction(() => document.getElementById('nlp-add-res')?.innerText.includes('Gus Search'), { timeout: 5000 });
        await click('#nlp-add-res .inv-add-row');
        await page.waitForFunction(() => document.getElementById('nlp-add-warn')?.innerText.includes('add anyway'), { timeout: 5000 });
        check('warning first (contacted often)', (await page.evaluate(() => document.getElementById('nlp-add-warn').innerText)).includes('Contacted 2×'));
        await clickText('#nlp-add-warn button', 'Add anyway');
        await sleep(400);
        const adds = await calls('name_list_add');
        check('Add anyway → force + note + prospect', adds.length === 2 && adds[0].args.p_force === false && adds[1].args.p_force === true
            && adds[1].args.p_prospect === 300 && adds[1].args.p_note === 'neighbour', adds);
        const mf = await last('name_list_feedback');
        check('add a person: "why missed" saved on the new row', mf && mf.args.p_row === 107 && mf.args.p_reason === 'referred'
            && mf.args.p_note === 'neighbour' && mf.args.p_take_off === false, mf);

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
        check('old version: banner, no row buttons, no add, no notes link', await page.evaluate(() => document.querySelectorAll('.nl-row .inv-acts button').length === 0
            && !document.getElementById('nlp-addbox') && !document.querySelector('.nlp-flag')));
        check('version picker asked for V1', (await last('name_list_get')).args.p_version === 1);
        await shot('4-old-version');
        await page.evaluate(() => window.app.nlpBack());
        await sleep(400);

        console.log('\nWho to include');
        await page.evaluate(() => window.app.nlpNew());
        await page.waitForSelector('#nlp-f-who option', { timeout: 10000 });
        check('Who to include: 4 choices, best fit first', (await page.evaluate(() => [...document.querySelectorAll('#nlp-f-who option')].map(o => o.value).join(','))) === 'best,owns_1,owns_any,owns_none');
        await page.evaluate(() => { document.getElementById('nlp-f-line').value = 'general'; window.app.nlpFormSync(); });
        check('General line: only best fit (nothing to count)', await page.evaluate(() => [...document.querySelectorAll('#nlp-f-who option')].filter(o => !o.disabled).map(o => o.value).join(',') === 'best'));
        await page.evaluate(() => {
            document.getElementById('nlp-f-line').value = 'ring'; window.app.nlpFormSync();
            document.getElementById('nlp-f-who').value = 'owns_1'; window.app.nlpFormSync();
        });
        check('Bought exactly 1 → Upgrade goal + "bought between" shown', await page.evaluate(() => document.getElementById('nlp-f-goal').value === 'upgrade' && !document.getElementById('nlp-f-window').hidden));
        await page.waitForFunction(() => document.getElementById('nlp-f-match')?.innerText.includes('58'), { timeout: 5000 });
        const pv = await last('name_list_preview');
        check('live count: asks for the rule, shows "58 people match"', pv && pv.args.p.who === 'owns_1' && pv.args.p.line === 'ring' && pv.args.p.goal === 'upgrade'
            && (await page.evaluate(() => document.getElementById('nlp-f-match').innerText)).includes('58 people match'), pv);
        check('How many fills in with the match count', await page.evaluate(() => document.getElementById('nlp-f-qty').value === '58'));
        await shot('2b-who');
        await page.evaluate(() => {
            document.getElementById('nlp-f-from').value = '2026-01-01'; document.getElementById('nlp-f-to').value = '2026-06-30';
            document.getElementById('nlp-f-offer').value = '2nd ring RM1,000 off'; window.app.nlpFormSync();
        });
        await clickText('#global-modal-overlay button', 'Find the people');
        await page.waitForFunction(() => !!document.querySelector('.nlp-detail'), { timeout: 15000 });
        const cw = await last('name_list_create');
        check('create payload: rule, window, offer, count', cw && cw.args.p.who === 'owns_1' && cw.args.p.bought_from === '2026-01-01' && cw.args.p.bought_to === '2026-06-30'
            && cw.args.p.offer === '2nd ring RM1,000 off' && cw.args.p.target_qty === 58 && cw.args.p.line === 'ring', cw);
        await page.evaluate(() => { window.__nlOwn = true; return window.app.nlpOpen(11); });
        await page.waitForFunction(() => document.querySelector('.nlp-detail')?.innerText.includes('RM1,000'), { timeout: 10000 });
        const hd = await text();
        check('header: rule + window + offer', hd.includes('Bought exactly 1 · bought 1 Jan 2026 – 30 Jun 2026') && hd.includes('🏷 2nd ring RM1,000 off'), hd.slice(0, 400));
        check('next step: untouched row → the offer', (await nextOf(104)).includes('Offer: 2nd ring RM1,000 off'), await nextOf(104));
        check('next step: progress still wins over the offer', (await nextOf(102)).includes('Get their answer'), await nextOf(102));
        check('reason dates: an earlier year shows the year', (await page.evaluate(() => document.getElementById('nl-row-102')?.textContent || '')).includes('1 Jan 2024'));
        await page.evaluate(() => { window.__nlRule = 'came_no_buy'; return window.app.nlpOpen(11); });
        await page.waitForFunction(() => (document.querySelector('#nl-row-104 .nlp-next')?.textContent || '').includes('汇集'), { timeout: 10000 });
        check('next step: the offer beats a general suggestion (kept as the why)', (await nextOf(104)).includes('Offer: 2nd ring RM1,000 off') && (await nextOf(104)).includes('Arrange a follow-up talk about 汇集'), await nextOf(104));
        await page.evaluate(() => { window.__nlRule = 'task_due'; return window.app.nlpOpen(11); });
        await page.waitForFunction(() => (document.querySelector('#nl-row-104 .nlp-next')?.textContent || '').includes('Step 1'), { timeout: 10000 });
        check('next step: a due follow-up task still comes first', (await nextOf(104)).includes('Follow up: Step 1 order WA') && !(await nextOf(104)).includes('Offer:'), await nextOf(104));
        await page.evaluate(() => { window.__nlRule = null; });
        await page.evaluate(() => { window.__opened = []; window.app.nlpWhatsApp(102); });
        check('WhatsApp opener carries the offer', await page.evaluate(() => decodeURIComponent(window.__opened[0] || '').includes('2nd ring RM1,000 off')));
        await page.evaluate(() => window.app.nlpEdit());
        check('Edit shows the offer', await page.evaluate(() => document.getElementById('nlp-e-offer')?.value === '2nd ring RM1,000 off'));
        await page.evaluate(() => { document.getElementById('nlp-e-offer').value = '2nd ring RM800 off'; });
        await clickText('#global-modal-overlay button', 'Save');
        await sleep(400);
        const se = await last('name_list_set');
        check('Edit saves the offer', se && se.args.p.offer === '2nd ring RM800 off', se);
        await page.evaluate(() => { window.__nlOwn = false; window.app.nlpBack(); });
        await sleep(300);

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
        await page.waitForFunction(() => document.getElementById('nlp-acc') && !document.getElementById('nlp-acc').hidden, { timeout: 10000 });
        const acc = await page.evaluate(() => document.getElementById('nlp-acc').innerText);
        check('Accuracy: totals, reasons, list row', acc.includes('2 not right') && acc.includes('1 added by hand') && acc.includes('Already owns more than shown · 1')
            && acc.includes('TEST Feng shui Nov'), acc.slice(0, 500));
        check('Accuracy: each note beside what the CRM said', acc.includes('Ben Tan') && acc.includes('bought a 2nd in Oct') && acc.includes('CRM said: Recent CPS · Fit 60'), acc.slice(0, 900));
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
