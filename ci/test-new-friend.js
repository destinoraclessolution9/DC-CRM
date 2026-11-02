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
    check('event links to the session', a[4].includes('app.viewActivityDetails(5)'));
    check('Book CPS sits right after the name, never off screen', t.headers[1] === '' && a[1].includes('Book CPS'));
    check('Book CPS opens the CPS form for that person', a[1].includes(`app.openActivityModal('', 11)`));
    check('WhatsApp uses the normalised phone', a[1].includes(`openWaChat('60123456789')`));
    check('a booked CPS hides Book CPS', b[1].includes('Book CPS'), false);
    check('no phone, no WhatsApp button', b[1].includes('WhatsApp'), false);
    check('booked date is shown', b[2].includes('CPS booked'));
    check('came twice is shown', b[2].includes('×2'));
    check('no event shows a dash', b[4], '—');
    check('waiting days', a[3], '2d');
    for (const [state, label] of [['came', 'Came'], ['coming', 'Coming'], ['no_show', 'No show'], ['unmarked', 'Not marked'], ['cps_cancelled', 'CPS cancelled']]) {
        check(`status ${state}`, sandbox.status({ state, came_n: 1 }), label);
    }
    check('came count only for people who came', sandbox.status({ state: 'cps_cancelled', came_n: 2 }), 'CPS cancelled');

    vm.runInContext(`_nlFriends = [
        { prospect_id: 13, name: 'Cat', phone: '0123456789', agent_name: 'Agent A', brought_by: 'Ref', session_id: 5, event_title: '汇集', event_date: '2026-10-31', came_n: 1, state: 'cps_cancelled', cps_booked: null, days_waiting: 3, cancelled_cps_date: '2026-11-01', cancel_reason: 'Emergency', cancel_note: '<i>family</i>' },
        { prospect_id: 14, name: 'Dan', phone: '', agent_name: 'Agent A', brought_by: null, session_id: null, event_title: null, event_date: null, came_n: 0, state: 'cps_cancelled', cps_booked: null, days_waiting: 0, cancelled_cps_date: '2026-11-01', cancel_reason: 'Sick', cancel_note: null },
    ]`, sandbox);
    const c = JSON.parse(sandbox.render().replace(/^[\s\S]*?<\/strip>\s*/, ''));
    check('list says where they came from', c.headers[4], 'From');
    check('cancelled: shows the CPS date', c.rows[0][4].includes('CPS 1 Nov'));
    check('cancelled: shows the reason', c.rows[0][4].includes('Emergency'));
    check('cancelled: note is escaped', c.rows[0][4].includes('&lt;i&gt;family') && !c.rows[0][4].includes('<i>family'));
    check('cancelled beats the event they came to', c.rows[0][4].includes('app.viewActivityDetails'), false);
    check('cancelled with no note: no stray dot', c.rows[1][4].includes('Sick') && !c.rows[1][4].includes('Sick ·'));
    check('cancelled: Book CPS is there', c.rows[1][1].includes(`app.openActivityModal('', 14)`));
}

// ── A New Friend's CPS lands on their own record ────────────────────────────
{
    const block = slice(activities, 'try {\n                    const _ids = [_state.se?.type', 'if (hardDuplicate && !_newFriendCps) {');
    const _isNewFriend = vm.runInNewContext(slice(activities, "const NEW_FRIEND_SOURCE = 'event_new_friend';", 'const openActivityModal = async') + '; _isNewFriend');
    const go = async (o) => {
        const sandbox = {
            _isNewFriend, console: { warn() {} },
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
    const cancelled = { id: 3, full_name: 'Ann Lee', phone: '0123456789', source: 'form_intake_old', cps_cancelled_on: '2026-11-01', status: 'active', responsible_agent_id: 7 };

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
        r = await go({ se: { type: 'Prospect', id: 3 }, hardDuplicate: { id: 3, __src: 'prospects' }, people: { 3: cancelled } });
        check('cancelled CPS, opened for them: reused, not refused as a duplicate', r.nf && r.id, 3);
        r = await go({ hardDuplicate: { id: 3, __src: 'prospects' }, people: { 3: cancelled } });
        check('cancelled CPS, typed into a blank form: reused', r.nf && r.id, 3);
        r = await go({ hardDuplicate: { id: 3, __src: 'prospects' }, vis: ['99'], people: { 3: cancelled } });
        check('cancelled CPS, another team: poaching guard stays', r.nf, false);
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
        check('New Friend referrer is prefilled', /_isNewFriend\(prospect\) && prospect\.referred_by/.test(activities));
        check('prefill reads the full row', /const prospect = \(AppDataStore\.getByIdFull \? await AppDataStore\.getByIdFull\('prospects', prospectId\)/.test(activities));
        check('CPS makes the missing referral row', activities.includes('(!_recoveredProspect || _newFriendCps) && _state.sr?.id != null'));
        check('desktop filter routes to the client path', /_pUnsupported = [^\n]*newFriendFilter/.test(prospects));
        check('desktop filter narrows the rows', prospects.includes('if (_nfIds && !_nfIds.has(String(p.id))) continue;'));
        check('desktop filter counts on the badge', /\[score, gua, status, agent, referral, newFriend\]/.test(prospects));
        check('mobile filter applied', mobile.includes("newFriend: v('mpf-new-friend')"));
        check('mobile filter cleared', /_mpFilters = \{ status: ''[^\n]*newFriend: '' \}/.test(mobile));
        check('mobile filter dropped on Customers', /tab === 'customers'\) \{[^\n]*_mpFilters\.newFriend = ''/.test(mobile));
        check('tab is on the Name List', /\['newfriends', '🌱', 'New Friends'\]/.test(reporting));
        check('tab has a CSV', reporting.includes("_nlTab === 'newfriends') {\n        headers ="));

        // ── 🚫 Cancel CPS ──
        const calendar = read('chunks/script-calendar.js');
        const cc = slice(calendar, 'const CPS_CANCEL_REASONS =', 'const deleteActivity = async');
        const calls = [];
        const ccBox = {
            escapeHtml, calls, console,
            document: { elements: {}, getElementById(id) { return this.elements[id] || null; }, querySelector() { return null; } },
            window: { supabase: { rpc: async (name, args) => { calls.push(['rpc', name, args]); return ccBox.rpcResult; } }, app: { mcalRefreshActiveView: async () => calls.push(['refresh']) } },
            rpcResult: { error: null },
            UI: { showModal: (t, body, buttons) => { ccBox.modal = { t, body, buttons }; }, hideModal: () => calls.push(['hide']), toast: { error: (m) => calls.push(['err', m]), success: (m) => calls.push(['ok', m]) } },
            AppDataStore: { _evictPrimedRow: (t, id) => calls.push(['evict', t, id]), invalidateCache: (t) => calls.push(['invalidate', t]), emit: (e, d) => calls.push(['emit', e, d]) },
            renderCalendar: async () => {}, renderTodayActivities: async () => {},
        };
        vm.createContext(ccBox);
        vm.runInContext(cc + '\nthis.happened = _cpsHappened; this.ended = _cpsCancelEnded; this.open = openCancelCps; this.confirm = confirmCancelCps;', ccBox);
        check('a fresh booking can be cancelled', ccBox.happened({ meeting_minutes: null }), false);
        check('a booking summary is not proof', ccBox.happened({ summary: 'booked via Ann' }), false);
        for (const [k, v] of [['note_key_points', 'x'], ['note_needs', 'x'], ['note_pain_points', 'x'], ['note_outcome', 'x'], ['next_action', 'x'], ['is_closing', true], ['completed_at', '2026-11-01'], ['meeting_minutes', { advisor: 'x' }]]) {
            check(`${k} means it happened`, ccBox.happened({ [k]: v }));
        }
        ccBox.open(55);
        check('form lists every reason', ['emergency', 'sick', 'clash', 'unreachable', 'changed_mind', 'other'].every(v => ccBox.modal.body.includes(`value="${v}"`)));
        check('form points to Edit for a new date', ccBox.modal.body.includes('<strong>Edit</strong>'));
        check('Back returns to the CPS', ccBox.modal.buttons[0].action.includes('app.viewActivityDetails(55)'));
        ccBox.document.elements = { 'cps-cancel-reason': { value: '' }, 'cps-cancel-note': { value: '  ' } };
        await ccBox.confirm(55);
        check('no reason: nothing sent', calls.some(c => c[0] === 'rpc'), false);
        check('no reason: told so', calls.some(c => c[0] === 'err' && /reason/.test(c[1])));
        calls.length = 0;
        ccBox.document.elements['cps-cancel-reason'].value = 'emergency';
        ccBox.rpcResult = { error: { message: 'This CPS has minutes or a closing, so it cannot be cancelled' } };
        await ccBox.confirm(55);
        check('server refusal shown', calls.some(c => c[0] === 'err' && /cannot be cancelled/.test(c[1])));
        check('server refusal keeps the form and the cache', calls.some(c => ['hide', 'invalidate'].includes(c[0])), false);
        calls.length = 0;
        ccBox.rpcResult = { error: null };
        await ccBox.confirm(55);
        const rpc = calls.find(c => c[0] === 'rpc');
        check('sends the reason', !!rpc && rpc[1] === 'cps_cancel' && rpc[2].p_activity === 55 && rpc[2].p_reason === 'emergency');
        check('blank note sends nothing', rpc && rpc[2].p_note, null);
        check('clears this device', calls.some(c => c[0] === 'evict') && calls.some(c => c[0] === 'invalidate' && c[1] === 'activities') && calls.some(c => c[0] === 'emit' && c[2].action === 'delete'));
        check('phone calendar refreshed', calls.some(c => c[0] === 'refresh'));
        check('button on the CPS pop-up', calendar.includes('app.openCancelCps(${activityId})') && calendar.includes('${_cancelCpsBtn}'));
        check('button hidden once it happened', /activity\.activity_type === 'CPS' && activity\.prospect_id && !_cpsHappened\(activity\)/.test(calendar));
        check('both functions registered', /openCancelCps,\s+confirmCancelCps,/.test(calendar));

        // ── 🔒 Cancel lock: 1 Nov → last day 14 Nov, by the Malaysia calendar ──
        const at = (iso) => vm.runInContext(`Date.now = () => ${Date.parse(iso)}`, ccBox);
        at('2026-11-14T15:59:00Z');
        check('last day 23:59 Malaysia: open', ccBox.ended({ activity_date: '2026-11-01' }), null);
        at('2026-11-14T16:00:00Z');
        check('next day 00:00 Malaysia: locked', ccBox.ended({ activity_date: '2026-11-01' }), '14 Nov');
        check('a CPS from day 13 is open', ccBox.ended({ activity_date: '2026-11-02' }), null);
        check('future CPS open', ccBox.ended({ activity_date: '2026-12-25' }), null);
        check('date with a time part', ccBox.ended({ activity_date: '2026-11-01T00:00:00' }), '14 Nov');
        at('2027-02-01T00:00:00Z');
        check('over a month end', ccBox.ended({ activity_date: '2026-11-25' }), '8 Dec');
        check('over a year end', ccBox.ended({ activity_date: '2026-12-25' }), '7 Jan');
        check('no date: not locked', ccBox.ended({ activity_date: null }), null);
        check('bad date: not locked', ccBox.ended({ activity_date: 'soon' }), null);
        const greyBtn = calendar.match(/_cpsCancelEndedOn\s*\? `([^`]*)`/)?.[1] || '';
        check('locked button says why', greyBtn.includes("UI.toast.info('Cancel period ended on ${_cpsCancelEndedOn}')"));
        check('locked button opens no form', !greyBtn.includes('openCancelCps'));
        check('locked button is marked disabled', greyBtn.includes('aria-disabled="true"') && greyBtn.includes('not-allowed'));

        // A refused date is not saved on this device either.
        const sat = slice(calendar, 'const saveActivityTiming = async', 'const openPostMeetupModal = async');
        const satLog = [];
        const satBox = {
            console, JSON,
            _state: {}, refusal: '',
            document: {
                querySelector: () => null,
                getElementById: (id) => ({ 'edit-timing-date': { value: '2026-12-01' }, 'edit-timing-start': { value: '15:00' }, 'edit-timing-end': { value: '16:00' } }[id] || null),
            },
            localStorage: { getItem: () => JSON.stringify([{ id: 9 }]), setItem: (k) => satLog.push('stored ' + k) },
            AppDataStore: { getById: async () => ({ id: 9 }), update: async () => { throw new Error(satBox.refusal); } },
            UI: { hideModal: () => satLog.push('hide'), toast: { error: (m) => satLog.push('err ' + m), success: (m) => satLog.push('ok ' + m), warning: (m) => satLog.push('warn ' + m) } },
        };
        vm.createContext(satBox);
        vm.runInContext(sat + '\nthis.save = saveActivityTiming;', satBox);
        satBox.refusal = "This CPS is past its cancel period, so its date and type can't be changed. Ask an admin to fix a wrong date.";
        await satBox.save(9);
        check('refusal shown', satLog.some(l => l.startsWith('err This CPS is past its cancel period')), true);
        check('refusal keeps the form open', satLog.includes('hide'), false);
        check('refusal stores nothing', satLog.some(l => l.startsWith('stored')), false);
        check('refusal claims no save', satLog.some(l => /^(ok|warn)/.test(l)), false);
        satLog.length = 0;
        satBox.refusal = 'something else';
        await satBox.save(9);
        check('any other failure still keeps the device copy', satLog.some(l => l.startsWith('stored')), true);
        const activitiesSrc = read('chunks/script-activities.js');
        check('full Edit form shows a refusal', /try \{\s+await AppDataStore\.update\('activities', activityId, \{ \.\.\.activity, \.\.\.updatedData \}\);\s+\} catch \(e\) \{\s+UI\.toast\.error/.test(activitiesSrc));

        console.log(`test-new-friend: ${pass} passed, ${fail} failed`);
        process.exit(fail ? 1 : 0);
    })().catch(e => { console.error('FAIL', e); process.exit(1); });
}
