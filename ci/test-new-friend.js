// ci/test-new-friend.js — 🌱 New Friends (2026-11-01).
// Runs the REAL code blocks in a vm sandbox: the Name List tab, the check that
// lets a New Friend's CPS land on their own record, and the fill-the-blanks
// update. Who is on the list is tested in SQL: ci/sql/new-friend-scenario.sql.
// Run: node ci/test-new-friend.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function check(name, got, want = true) {
    if (got === want) { pass++; return; }
    fail++;
    console.error(`FAIL ${name}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`);
}
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const slice = (src, from, to) => {
    const a = src.indexOf(from);
    const b = src.indexOf(to, a);
    if (a < 0 || b < 0) { console.error(`FAIL could not find block: ${from}`); process.exit(1); }
    return src.slice(a, b);
};
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const activities = read('chunks/script-activities.js');
const prospects = read('chunks/script-prospects.js');
const reporting = read('chunks/script-reporting.js');
const mobile = read('chunks/script-mobile.js');

// ── Name List tab ───────────────────────────────────────────────────────────
{
    const block = slice(reporting, 'const NL_NF_STATE =', 'const _nlLoadFriends = async');
    const sandbox = {
        escapeHtml,
        window: { _crmUtils: { waPhone: (raw) => String(raw || '').replace(/\D/g, '').replace(/^0/, '60') } },
        _nlFriends: null, _nlFriendsErr: '',
        _nlStrip: (t) => `<strip>${t}</strip>`,
        _nlTable: (key, headers, rows, empty, rightFrom) => JSON.stringify({ key, headers, rows, empty, rightFrom }),
    };
    vm.createContext(sandbox);
    vm.runInContext(block + '\nthis.render = _nlNewFriendsHtml; this.status = _nlNfStatus;', sandbox);

    check('loading state', sandbox.render().includes('Loading new friends'));
    vm.runInContext('_nlFriendsErr = "boom"', sandbox);
    check('error is shown, never an empty list', sandbox.render().includes('Could not load'));
    vm.runInContext('_nlFriendsErr = ""; _nlFriends = []', sandbox);
    const empty = JSON.parse(sandbox.render().replace(/^[\s\S]*?<\/strip>\s*/, ''));
    check('empty list says how to add one', empty.empty.includes('+ Add Attendee'));
    check('table key', empty.key, 'newfriends');

    vm.runInContext(`_nlFriends = [
        { prospect_id: 11, name: '<b>Ann</b>', phone: '012-345 6789', agent_name: 'Agent A', brought_by: 'Ref', session_id: 5, event_title: '汇集', event_date: '2026-10-31', came_n: 1, state: 'came', cps_booked: null, days_waiting: 2 },
        { prospect_id: 12, name: 'Bob', phone: '', agent_name: 'Agent A', brought_by: null, session_id: null, event_title: null, event_date: null, came_n: 2, state: 'came', cps_booked: '2026-11-08', days_waiting: 9 },
    ]`, sandbox);
    const t = JSON.parse(sandbox.render().replace(/^[\s\S]*?<\/strip>\s*/, ''));
    const [a, b] = t.rows;
    check('name is escaped', a[0].includes('&lt;b&gt;Ann') && !a[0].includes('<b>Ann'));
    check('name opens the profile', a[0].includes('app.showProspectDetail(11)'));
    check('event links to the session', a[1].includes('app.viewActivityDetails(5)'));
    check('Book CPS opens the CPS form for that person', a[6].includes(`app.openActivityModal('', 11)`));
    check('WhatsApp uses the normalised phone', a[6].includes(`openWaChat('60123456789')`));
    check('a booked CPS hides Book CPS', b[6].includes('Book CPS'), false);
    check('no phone, no WhatsApp button', b[6].includes('WhatsApp'), false);
    check('booked date is shown', b[4].includes('CPS booked'));
    check('came twice is shown', b[4].includes('×2'));
    check('no event shows a dash', b[1], '—');
    check('waiting days', a[5], '2d');
    for (const [state, label] of [['came', 'Came'], ['coming', 'Coming'], ['no_show', 'No show'], ['unmarked', 'Not marked']]) {
        check(`status ${state}`, sandbox.status({ state, came_n: 1 }), label);
    }
}

// ── A New Friend's CPS lands on their own record ────────────────────────────
{
    const block = slice(activities, 'try {\n                    const _ids = [_state.se?.type', 'if (hardDuplicate && !_newFriendCps) {');
    const go = async (o) => {
        const sandbox = {
            NEW_FRIEND_SOURCE: 'event_new_friend', console: { warn() {} },
            _state: { se: o.se || null, cu: { id: 7 } },
            hardDuplicate: o.hardDuplicate, phone: o.phone || '0123456789',
            normName: (o.name || 'Ann Lee').toLowerCase().replace(/\s+/g, ''),
            normalize: (s) => (s ? String(s).toLowerCase().replace(/\s+/g, '') : ''),
            _utils: { getVisibleUserIds: async () => (o.vis === undefined ? ['7'] : o.vis) },
            AppDataStore: { getById: async (_t, id) => o.people[id] || null },
        };
        vm.createContext(sandbox);
        return vm.runInContext(`(async () => { var _recoveredProspect = null, _newFriendCps = false; ${block}; return { id: _recoveredProspect && _recoveredProspect.id, nf: _newFriendCps }; })()`, sandbox);
    };
    const nf ={ id: 1, full_name: 'Ann Lee', phone: '0123456789', source: 'event_new_friend', status: 'active', responsible_agent_id: 7 };
    const old = { id: 2, full_name: 'Ann Lee', phone: '0123456789', source: null, status: 'active', responsible_agent_id: 7 };

    (async () => {
        let r = await go({ se: { type: 'Prospect', id: 1 }, hardDuplicate: null, people: { 1: nf } });
        check('opened for them: reused', r.nf && r.id, 1);
        r = await go({ se: { type: 'Prospect', id: 1 }, hardDuplicate: { id: 1, __src: 'prospects' }, people: { 1: nf } });
        check('opened for them + same phone: reused, not blocked', r.nf && r.id, 1);
        r = await go({ hardDuplicate: { id: 1, __src: 'prospects' }, people: { 1: nf } });
        check('typed the same name + phone in a blank CPS form: reused', r.nf && r.id, 1);
        r = await go({ se: { type: 'Prospect', id: 1 }, hardDuplicate: null, phone: '0111111111', people: { 1: nf } });
        check('phone corrected in the form: still the same person', r.nf && r.id, 1);
        r = await go({ se: { type: 'Prospect', id: 1 }, hardDuplicate: null, name: 'Bob Tan', phone: '0111111111', people: { 1: nf } });
        check('form retyped as someone else: a different person', r.nf, false);
        r = await go({ hardDuplicate: { id: 2, __src: 'prospects' }, people: { 2: old } });
        check('old name: duplicate rules unchanged', r.nf, false);
        r = await go({ se: { type: 'Prospect', id: 2 }, hardDuplicate: null, people: { 2: old } });
        check('form opened for an old name: unchanged', r.nf, false);
        r = await go({ hardDuplicate: { id: 1, __src: 'customers' }, people: { 1: nf } });
        check('a customer row is never reused', r.nf, false);
        r = await go({ hardDuplicate: { id: 1, __src: 'prospects' }, people: { 1: { ...nf, status: 'converted' } } });
        check('converted: not reused', r.nf, false);
        r = await go({ hardDuplicate: { id: 1, __src: 'prospects' }, vis: ['99'], people: { 1: nf } });
        check('another team: poaching guard stays', r.nf, false);
        r = await go({ hardDuplicate: { id: 1, __src: 'prospects' }, vis: 'all', people: { 1: nf } });
        check('admin: reused', r.nf && r.id, 1);
        r = await go({ hardDuplicate: null, people: {} });
        check('nobody matched: a normal new CPS', r.nf, false);

        // ── fill the blanks, never overwrite ──
        const patchBlock = slice(activities, 'const _blank = (v) =>', 'try {\n                        await AppDataStore.update(\'prospects\', prospect.id, _patch);');
        const patchOf = (prospect, basic, sr, si, onBehalf) => {
            const sandbox = {
                prospect, basic,
                prospectData: { cps_assignment_date: '2026-11-01', protection_deadline: '2026-12-01', referred_by_id: 5, referred_by_type: 'Customer', referred_by: 'Ref', introduced_by_id: 6, introduced_by_type: 'Customer', introduced_by: 'Intro' },
                _state: { sr, si }, _isOnBehalf: !!onBehalf, _assignedAgentId: 9,
            };
            vm.createContext(sandbox);
            return JSON.parse(vm.runInContext(`(() => { ${patchBlock}; return JSON.stringify(_patch); })()`, sandbox));
        };
        let p = patchOf({ phone: '012', ic_number: null, occupation: 'Boss', children: null, country: 'SG' },
            { phone: '099', ic_number: '900101', occupation: 'Clerk', children: '[]', country: 'MY', email: null }, { id: 5 }, null);
        check('blank field gets filled', p.ic_number, '900101');
        check('filled field is never overwritten', 'occupation' in p, false);
        check('phone on file stays', 'phone' in p, false);
        check('country default never overwrites', 'country' in p, false);
        check('empty children never overwrites', 'children' in p, false);
        check('empty form value is skipped', 'email' in p, false);
        check('CPS date stamped', p.cps_assignment_date, '2026-11-01');
        check('protection starts at the CPS', p.protection_deadline, '2026-12-01');
        check('picked referrer saved', p.referred_by, 'Ref');
        check('no introducer picked: left alone', 'introduced_by' in p, false);
        check('owner unchanged', 'responsible_agent_id' in p, false);
        p = patchOf({}, {}, null, { id: 6 }, true);
        check('no referrer picked: left alone', 'referred_by' in p, false);
        check('introducer saved', p.introduced_by, 'Intro');
        check('leader keyed for an agent: owner moves', p.responsible_agent_id, 9);

        // ── wiring ──
        check('button renamed', activities.includes('➕ New Friend (not yet CPS)'));
        check('old button wording gone', activities.includes('First Time Friend'), false);
        check('button passes the event session', activities.includes('openProspectModal(null, { newFriendSession: activityId })'));
        check('form carries the session', prospects.includes('id="prospect-new-friend-session" value="${escapeHtml(opts.newFriendSession'));
        check('save tags the prospect', /data\.source = 'event_new_friend';\s+data\.source_id = Number\(_nfSession\);/.test(prospects));
        check('tag only in the create path', prospects.indexOf("data.source = 'event_new_friend'") > prospects.indexOf("data.pipeline_stage       = 'new'"));
        check('New Friend referrer is prefilled', /prospect\.source === NEW_FRIEND_SOURCE && prospect\.referred_by/.test(activities));
        check('CPS makes the missing referral row', activities.includes('(!_recoveredProspect || _newFriendCps) && _state.sr?.id != null'));
        check('desktop filter routes to the client path', /_pUnsupported = [^\n]*newFriendFilter/.test(prospects));
        check('desktop filter narrows the rows', prospects.includes('if (_nfIds && !_nfIds.has(String(p.id))) continue;'));
        check('desktop filter counts on the badge', /\[score, gua, status, agent, referral, newFriend\]/.test(prospects));
        check('mobile filter applied', mobile.includes("newFriend: v('mpf-new-friend')"));
        check('mobile filter cleared', /_mpFilters = \{ status: ''[^\n]*newFriend: '' \}/.test(mobile));
        check('mobile filter dropped on Customers', /tab === 'customers'\) \{[^\n]*_mpFilters\.newFriend = ''/.test(mobile));
        check('tab is on the Name List', /\['newfriends', '🌱', 'New Friends'\]/.test(reporting));
        check('tab has a CSV', reporting.includes("_nlTab === 'newfriends') {\n        headers ="));

        console.log(`test-new-friend: ${pass} passed, ${fail} failed`);
        process.exit(fail ? 1 : 0);
    })().catch(e => { console.error('FAIL', e); process.exit(1); });
}
