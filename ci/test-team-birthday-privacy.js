// ci/test-team-birthday-privacy.js — agents never see an upline's birthday,
// and never receive a colleague's IC number or full date of birth.
//
// WHY: colleague ("Team") birthdays render in five places — desktop calendar
// Team Birthdays, phone Home (two renderers), phone Calendar grid/day sheet, the
// notification bell (badge + panel), and the morning push digest. The rule: a
// viewer never sees the birthday of anyone up their reporting chain
// (users.reporting_to walked up; same-level uplines included) or of anyone more
// senior (smaller level number). L1/L2 see all.
// Phase 2 (2026-11-03): the browser used to download every colleague's
// date_of_birth + ic_number to build those lists. The rows now come from the
// my_team_birthdays RPC (the same rule in SQL; name + 'MM-DD' only) and no
// client read of another user selects ic_number / date_of_birth.
//
// HARNESS: the browser rule (script.js filterTeamBirthdays) and the push rule
// (send-activity-reminders teamBirthdayHider) are sliced out of the REAL sources
// and run on the same org chart, so the two copies can't drift apart. The SQL
// rule runs on the same chart in ci/sql/team-birthdays-scenario.sql (live, rolled
// back); its expected lists are checked here against the browser rule. Source
// guards pin every render site to the RPC + helper.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass++; return; }
    fail++;
    console.error(`FAIL ${name}${detail ? '\n  ' + detail : ''}`);
};
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sliceLines = (src, startRe, endRe, label) => {
    const lines = src.split('\n');
    const start = lines.findIndex((l) => startRe.test(l));
    const end = lines.findIndex((l, i) => i > start && endRe.test(l));
    if (start < 0 || end < 0) throw new Error(`slice not found: ${label} (start=${start}, end=${end})`);
    return lines.slice(start, end).join('\n');
};

// ── Browser rule: sliced from script.js ─────────────────────────────────────
const scriptSrc = read('script.js');
const levelSrc = sliceLines(scriptSrc, /const _getUserLevel = \(user\) => \{/, /const isSystemAdmin =/, '_getUserLevel');
const filterSrc = sliceLines(scriptSrc, /── Team-birthday privacy/, /Object\.assign\(window\._crmUtils, \{ filterTeamBirthdays \}\)/, 'filterTeamBirthdays');
// eslint-disable-next-line no-new-func
const filterTeamBirthdays = new Function(`${levelSrc}\n${filterSrc}\nreturn filterTeamBirthdays;`)();

// ── Push rule: sliced from the edge function, types stripped (CI is Node 20) ─
const edgeSrc = read('supabase/functions/send-activity-reminders/index.ts');
const stripTs = (s) => s
    .replace(/\):\s*\(u: any\) => boolean\s*\{/g, ') {')
    .replace(/\):\s*number\s*\{/g, ') {')
    .replace(/<number>/g, '')
    .replace(/:\s*Map<number, any>/g, '')
    .replace(/:\s*(any|number|unknown)\b/g, '');
const edgeLevel = sliceLines(edgeSrc, /^function levelOf\(/, /^const isActiveUser/, 'levelOf');
const edgeHider = sliceLines(edgeSrc, /^function teamBirthdayHider\(/, /^}\s*$/, 'teamBirthdayHider') + '\n}';
// eslint-disable-next-line no-new-func
const teamBirthdayHider = new Function(`${stripTs(edgeLevel)}\n${stripTs(edgeHider)}\nreturn teamBirthdayHider;`)();

// ── Org chart ───────────────────────────────────────────────────────────────
//   1 Boss (L1)        2 Marketing (L2)
//   3 Senior Mgr (L3) → 1
//   5 Leader A (L5) → 3          6 Leader B (L5, other branch) → 3
//   9 Senior Peer (L12) → 5
//   8 Old Agent (L12, INACTIVE) → 9
//   7 Upline U (L12, same level as X) → 8
//  10 Agent X (L12) → 7          11 Peer (L12) → 5      12 Downline (L12) → 10
//  20 "Leader A" duplicate account (L12, no upline)    15 Stock Take (L15)
//  30 ↔ 31 reporting loop (both L12)
const U = (id, full_name, lvl, reporting_to, status = 'active') =>
    ({ id, full_name, role: `Level ${lvl} Staff`, reporting_to, status });
const all = [
    U(1, 'Boss', 1, null), U(2, 'Marketing', 2, null), U(3, 'Senior Mgr', 3, 1),
    U(5, 'Leader A', 5, 3), U(6, 'Leader B', 5, 3), U(9, 'Senior Peer', 12, 5),
    U(8, 'Old Agent', 12, 9, 'inactive'), U(7, 'Upline U', 12, 8), U(10, 'Agent X', 12, 7),
    U(11, 'Peer', 12, 5), U(12, 'Downline', 12, 10), U(20, ' leader a ', 12, null),
    U(15, 'Stock Take', 15, null), U(30, 'Loop One', 12, 31), U(31, 'Loop Two', 12, 30),
];
const byId = new Map(all.map((u) => [u.id, u]));
const shown = all.filter((u) => u.status !== 'inactive'); // what the screens pass as `rows`

const browserVisible = (viewerId) =>
    filterTeamBirthdays(byId.get(viewerId), shown, all).map((u) => u.id).sort((a, b) => a - b);
const pushVisible = (viewerId) => {
    const hide = teamBirthdayHider(viewerId, byId);
    return shown.filter((u) => !hide(u)).map((u) => u.id).sort((a, b) => a - b);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const cases = [
    // Agent X: seniors 1-6 hidden, same-level upline 7 hidden, 9 hidden THROUGH the
    // inactive 8 (chain walked on the raw list), "Leader A" duplicate 20 hidden by name.
    { viewer: 10, want: [10, 11, 12, 15, 30, 31], why: 'L12 agent: chain + seniors + duplicate hidden' },
    // Leader A: only more-senior 1-3 hidden; same-level Leader B and all of L12 stay.
    { viewer: 5, want: [5, 6, 7, 9, 10, 11, 12, 15, 20, 30, 31], why: 'L5 leader: only L1-L3 hidden, peers + downline visible' },
    // Loop: 30's chain is 31 → 30 (stops), no hang; 31 hidden as 30's upline.
    // 20 stays hidden: it's senior Leader A's duplicate account.
    { viewer: 30, want: [7, 9, 10, 11, 12, 15, 30], why: 'reporting loop terminates' },
    { viewer: 1, want: shown.map((u) => u.id).sort((a, b) => a - b), why: 'L1 admin sees everyone' },
    { viewer: 2, want: shown.map((u) => u.id).sort((a, b) => a - b), why: 'L2 marketing sees everyone' },
];
for (const c of cases) {
    const b = browserVisible(c.viewer);
    const p = pushVisible(c.viewer);
    ok(`browser: ${c.why}`, same(b, c.want), `got:  ${b}\n  want: ${c.want}`);
    ok(`push matches browser: ${c.why}`, same(p, b), `push: ${p}\n  browser: ${b}`);
}
ok('no viewer → nothing shown', filterTeamBirthdays(null, shown, all).length === 0);
ok('rows-only call (no allUsers) still hides seniors',
    !filterTeamBirthdays(byId.get(10), shown).some((u) => u.id === 5));

// ── Server rule (SQL scenario) = browser rule on the same chart ─────────────
// The scenario's org chart adds rows the server drops before the rule runs
// (40 L13 customer, 41 no birthday, 42 bad IC, 43 deleted); none of them is in
// any expected list, so each list must equal the browser rule's answer.
const scenario = read('ci/sql/team-birthdays-scenario.sql');
const sqlCases = [...scenario.matchAll(/^\s*\((\d+), '([\d,]*)', '[^']*'\)/gm)]
    .map((m) => ({ viewer: Number(m[1]), want: m[2] ? m[2].split(',').map(Number) : [] }));
ok('SQL scenario lists every JS viewer', cases.every((c) => sqlCases.some((s) => s.viewer === c.viewer)),
    `sql viewers: ${sqlCases.map((s) => s.viewer)}`);
for (const s of sqlCases.filter((x) => byId.has(x.viewer))) {
    const b = browserVisible(s.viewer);
    ok(`SQL scenario matches browser rule for viewer ${s.viewer}`, same(s.want, b), `sql: ${s.want}\n  browser: ${b}`);
}
ok('SQL scenario: L13 customer account gets nothing', sqlCases.some((s) => s.viewer === 40 && s.want.length === 0));
const migration = read('migrations/2026-11-03_team_birthdays_rpc.sql');
const rpcCols = (migration.match(/returns table \(([^)]*)\)/) || [])[1] || '';
ok('RPC returns name + MM-DD + role/team/phone only',
    rpcCols.replace(/\s+/g, ' ') === 'id bigint, full_name text, birthday_md text, role text, team text, phone text', rpcCols);
ok('RPC is SECURITY DEFINER with a pinned search_path', /security definer set search_path = public, pg_temp/.test(migration));
ok('RPC: anon cannot call it', /revoke all on function public\.my_team_birthdays\(\) from public, anon;/.test(migration)
    && /grant execute on function public\.my_team_birthdays\(\) to authenticated;/.test(migration));
ok('migration has an undo file', fs.existsSync(path.join(ROOT, 'migrations/2026-11-03_team_birthdays_rpc_undo.sql')));

// ── fetchTeamBirthdays: one shared call, failures never cached ──────────────
const fetchSrc = sliceLines(scriptSrc, /let _teamBdayMemo = null;/, /Object\.assign\(window\._crmUtils, \{ fetchTeamBirthdays \}\)/, 'fetchTeamBirthdays');
const makeFetcher = (rpcImpl, uid = 10) => {
    const calls = [];
    const window = { supabase: { rpc: (name) => { calls.push(name); return rpcImpl(calls.length); } }, _appState: { cu: null } };
    // eslint-disable-next-line no-new-func
    const fetchTeamBirthdays = new Function('window', '_currentUser', `${fetchSrc}\nreturn fetchTeamBirthdays;`)(window, { id: uid });
    return { fetchTeamBirthdays, calls };
};
const RPC_ROW = { id: 11, full_name: 'Peer', birthday_md: '10-14', role: 'Level 12 Staff', team: 'A', phone: '012' };
(async () => {
    {
        const { fetchTeamBirthdays, calls } = makeFetcher(async () => ({ data: [RPC_ROW], error: null }));
        const [a, b] = await Promise.all([fetchTeamBirthdays(), fetchTeamBirthdays()]);
        ok('fetchTeamBirthdays calls my_team_birthdays', calls[0] === 'my_team_birthdays', String(calls));
        ok('fetchTeamBirthdays: surfaces on one page share one call', calls.length === 1 && same(a, b) && a[0].id === 11, `calls=${calls.length}`);
        await fetchTeamBirthdays(true);
        ok('fetchTeamBirthdays(force) refetches', calls.length === 2, `calls=${calls.length}`);
    }
    {
        const { fetchTeamBirthdays, calls } = makeFetcher(async (n) => (n === 1 ? { data: null, error: { code: '42501' } } : { data: [RPC_ROW], error: null }));
        const first = await fetchTeamBirthdays();
        const second = await fetchTeamBirthdays();
        ok('fetchTeamBirthdays: a failed read resolves null (callers show none, cache nothing)', first === null);
        ok('fetchTeamBirthdays: a failure is not memoised — the next call retries', calls.length === 2 && Array.isArray(second), `calls=${calls.length}`);
    }
    {
        const { fetchTeamBirthdays, calls } = makeFetcher(async () => { throw new Error('offline'); });
        ok('fetchTeamBirthdays: a thrown read resolves null', (await fetchTeamBirthdays()) === null && calls.length === 1);
    }
    {
        const { fetchTeamBirthdays, calls } = makeFetcher(async () => ({ data: [], error: null }), null);
        ok('fetchTeamBirthdays: signed out → null, no call', (await fetchTeamBirthdays()) === null && calls.length === 0);
    }
    finish();
})().catch((e) => { fail++; console.error('FAIL async section threw', e); finish(); });

// ── Birthday MM-DD on the RPC rows (no IC parsing left in the browser) ──────
const mobSrc = read('chunks/script-mobile.js');
const staffMDSrc = sliceLines(mobSrc, /const _staffMD = \(u\) => \{/, /Collapse duplicate staff accounts/, '_staffMD');
// eslint-disable-next-line no-new-func
const _staffMD = new Function(`${staffMDSrc}\nreturn _staffMD;`)();
ok('phone _staffMD reads birthday_md', _staffMD({ birthday_md: '03-07' }) === '03-07');
ok('phone _staffMD still reads a client date_of_birth', _staffMD({ date_of_birth: '1990-12-25' }) === '12-25');
ok('phone _staffMD no longer derives anything from an IC', _staffMD({ ic_number: '900913-10-2222' }) === '');
const cpsSrc = read('chunks/script-cps.js');
const dueSrc = sliceLines(cpsSrc, /^const _teamBdaysDue = /, /^\};\s*$/, '_teamBdaysDue') + '\n};';
// eslint-disable-next-line no-new-func
const _teamBdaysDue = new Function('_utils', '_state', `${dueSrc}\nreturn _teamBdaysDue;`)(
    { filterTeamBirthdays }, { cu: byId.get(10) });
{
    const rows = [
        { id: 11, full_name: 'Peer', birthday_md: '11-03', role: 'Level 12 Staff' },
        { id: 21, full_name: ' peer ', birthday_md: '11-03', role: 'Level 12 Staff' }, // duplicate account
        { id: 12, full_name: 'Downline', birthday_md: '11-04', role: 'Level 12 Staff' },
        { id: 15, full_name: 'Stock Take', birthday_md: '12-16', role: 'Level 15 Staff' },
        { id: 5, full_name: 'Leader A', birthday_md: '11-03', role: 'Level 5 Staff' }, // senior: hidden even if sent
    ];
    const due = _teamBdaysDue(rows, '11-03', '11-04').map((u) => u.id);
    ok('bell: today + tomorrow only, one per person, seniors still hidden', same(due, [11, 12]), `got ${due}`);
}

// ── Source guards: every render site reads the RPC, never colleague IC/DOB ──
const cal = read('chunks/script-calendar.js');
const mob = mobSrc;
const dataSrc = read('data.js');
const count = (s, needle) => s.split(needle).length - 1;
ok('desktop Team Birthdays reads the RPC', cal.includes('_utils.fetchTeamBirthdays().then(r => r || [])'));
ok('desktop Team Birthdays filters before dedup',
    cal.includes('_utils.filterTeamBirthdays(_state.cu, teamBdayRows.filter(isStaff), teamBdayRows)'));
ok('desktop users fetch is names only', cal.includes("AppDataStore.queryAdvanced('users', { select: 'id,full_name', limit: 50000, countMode: null })"));
ok('phone Home reads the RPC under a per-viewer key',
    mob.includes('_utils.fetchTeamBirthdays(_mhomeForce)') && mob.includes("'mhome-teambday-v1-' + _mhomeUid"));
ok('phone Home: both renderers filter the RPC rows',
    count(mob, '_dedupStaffByBday(_utils.filterTeamBirthdays(_state.cu, cachedTeamBdays.filter(_isStaffUser), cachedTeamBdays))') === 2);
ok('phone Home users fetch has no DOB / IC / phone',
    mob.includes("select: 'id,full_name,role,reporting_to,team_id,status'") && mob.includes("'mhome-users-v3-' + _mhomeUid"));
// \r?\n: a Windows checkout (core.autocrlf) has CRLF line ends, CI has LF.
ok('phone Calendar reads the RPC', /_utils\.fetchTeamBirthdays\(\)\r?\n/.test(mob));
ok('phone Calendar filters per render',
    mob.includes('_utils.filterTeamBirthdays(_state.cu, raw.filter(_isStaffUser), raw)'));
ok('phone Calendar cache is per viewer (server-filtered rows)',
    mob.includes("'mcal-teambday-v1-' + (_state.cu?.id ?? 'anon')") && !/'mcal-staff-v\d'/.test(mob));
ok('bell badge + panel read the RPC', count(cpsSrc, '_utils.fetchTeamBirthdays().then(r => r || [])') === 2
    && count(cpsSrc, '_teamBdaysDue(teamBdays, todayMD, tomMD)') === 2 && !/allUsers/.test(cpsSrc));

// No client read of the users table selects another user's IC / DOB.
const clientFiles = ['script.js', 'data.js', ...fs.readdirSync(path.join(ROOT, 'chunks'))
    .filter((f) => /^script-.*\.js$/.test(f) && !f.includes('.min.')).map((f) => `chunks/${f}`)];
for (const f of clientFiles) {
    const src = read(f);
    const bad = [...src.matchAll(/queryAdvanced\('users',\s*\{[^}]*select:\s*'([^']*)'/g),
        ...src.matchAll(/\.from\('users'\)\s*\.select\('([^']*)'/g)]
        .map((m) => m[1]).filter((sel) => /ic_number|date_of_birth|bank_/.test(sel));
    ok(`${f}: no users select of ic_number / date_of_birth / bank`, bad.length === 0, bad.join(' | '));
}
const sel = (key) => ((dataSrc.match(new RegExp(`\\n\\s+${key}: '([^']+)'`)) || [])[1] || '').split(',');
ok('users list select (getAll) has no DOB / IC / bank', sel('users').length > 5 && !sel('users').some((c) => /ic_number|date_of_birth|bank_/.test(c)));
ok('users_detail (getById of another user) has no DOB / IC / bank',
    sel('users_detail').length > 20 && !sel('users_detail').some((c) => /ic_number|date_of_birth|bank_/.test(c)));
ok("getById reads another user's row with users_detail, only your own with *",
    dataSrc.includes("const isOtherUser = tableName === 'users' && String(id) !== String(window._currentUser?.id);")
    && dataSrc.includes(".select(isOtherUser ? this._lightSelects.users_detail : '*')"));
ok('realtime no longer streams full users rows',
    /const TABLES = \[[^\]]*\];/.test(dataSrc) && !/const TABLES = \[[^\]]*'users'[^\]]*\];/.test(dataSrc));

// One-shot device purge drops the old caches that hold colleague DOB / IC.
{
    const purgeSrc = sliceLines(scriptSrc, /One-shot staff-PII purge \(2026-11-03\)/, /console\.info\('\[init\] one-shot staff PII cache purge applied/, 'purge') + '\n}} catch (_) {}';
    // Like the browser's: stored keys are own enumerable props (Object.keys lists them).
    const localStorage = {
        fs_crm_users: '[]', fs_crm_users_last_sync: 'x', 'mhome-users-v2-10': '[]', 'mhome-users-v1-7': '[]',
        'mcal-staff-v1': '[]', 'mcal-staff-v2': '[]', 'mhome-users-v3-10': '[]', fs_crm_prospects: '[]', 'mcal-retry-queue-v1': '[]',
    };
    Object.defineProperties(localStorage, {
        getItem: { value(k) { return Object.prototype.hasOwnProperty.call(this, k) ? this[k] : null; } },
        setItem: { value(k, v) { this[k] = String(v); } },
        removeItem: { value(k) { delete this[k]; } },
    });
    const sandbox = { localStorage, console: { info() {} }, window: { AppDataStore: { invalidateCache: (t) => { sandbox.invalidated = t; } } } };
    vm.runInNewContext(purgeSrc, sandbox);
    ok('purge drops the users snapshot + old phone staff caches',
        same(Object.keys(localStorage).sort(), ['_staff_pii_purge_2026_11_03', 'fs_crm_prospects', 'mcal-retry-queue-v1', 'mhome-users-v3-10']),
        `left: ${Object.keys(localStorage)}`);
    ok('purge drops the in-memory users cache too', sandbox.invalidated === 'users');
}

ok('push reads reporting_to', edgeSrc.includes('select=id,full_name,role,status,team,date_of_birth,reporting_to'));
ok('push filters colleague birthdays', edgeSrc.includes('&& !hideBday(u))'));

function finish() {
    console.log(`\ntest-team-birthday-privacy: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}
