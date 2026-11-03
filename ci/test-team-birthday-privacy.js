// ci/test-team-birthday-privacy.js — agents never see an upline's birthday.
//
// WHY: colleague ("Team") birthdays render in four places — desktop calendar
// Team Birthdays, phone Home (two renderers), phone Calendar grid/day sheet, and
// the morning push digest. The rule: a viewer never sees the birthday of anyone
// up their reporting chain (users.reporting_to walked up; same-level uplines
// included) or of anyone more senior (smaller level number). L1/L2 see all.
//
// HARNESS: the browser rule (script.js filterTeamBirthdays) and the push rule
// (send-activity-reminders teamBirthdayHider) are sliced out of the REAL sources
// and run on the same org chart, so the two copies can't drift apart. Source
// guards pin every render site to the helper.
'use strict';
const fs = require('fs');
const path = require('path');

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

// ── Source guards: every render site goes through the helper ────────────────
const cal = read('chunks/script-calendar.js');
const mob = read('chunks/script-mobile.js');
const count = (s, needle) => s.split(needle).length - 1;
ok('desktop Team Birthdays filters before dedup',
    cal.includes('_utils.filterTeamBirthdays(_state.cu, allUsers.filter(isStaff), allUsers)'));
ok('desktop users fetch includes reporting_to',
    cal.includes("select: 'id,full_name,date_of_birth,ic_number,role,team,status,phone,reporting_to'"));
ok('phone Home: both renderers filter',
    count(mob, '_dedupStaffByBday(_utils.filterTeamBirthdays(_state.cu, cachedUsers.filter(_isStaffUser), cachedUsers))') === 2);
ok('phone Home users fetch includes reporting_to', mob.includes("'id,full_name,date_of_birth,ic_number,role,reporting_to,team_id,phone,status'"));
ok('phone Calendar filters per render',
    mob.includes('_utils.filterTeamBirthdays(_state.cu, raw.filter(_isStaffUser), raw)'));
ok('phone Calendar cache bumped to v2 (no stale unfiltered v1 list)',
    mob.includes("'mcal-staff-v2'") && !mob.includes("'mcal-staff-v1'"));
ok('phone Calendar users fetch includes reporting_to',
    mob.includes("select: 'id,full_name,date_of_birth,ic_number,role,team,phone,status,reporting_to'"));
ok('push reads reporting_to', edgeSrc.includes('select=id,full_name,role,status,team,date_of_birth,reporting_to'));
ok('push filters colleague birthdays', edgeSrc.includes('&& !hideBday(u))'));

console.log(`\ntest-team-birthday-privacy: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
