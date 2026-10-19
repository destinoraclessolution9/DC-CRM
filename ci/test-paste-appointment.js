// ci/test-paste-appointment.js — CPS "Paste Info" extras (2026-10-19):
// appointment date / time / venue from the pasted message, and Title from
// gender + marital status.
//
// HARNESS: functions are SLICED OUT OF THE REAL SOURCE and eval'd (same pattern
// as test-basic-info-selects.js / test-ming-gua.js), never copied.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const eq = (name, got, want) => {
    if (got === want) { pass++; return; }
    fail++;
    console.error(`FAIL ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
};
const act = fs.readFileSync(path.join(ROOT, 'chunks/script-activities.js'), 'utf8');
const slice = (decl, end = '\n    };') => {
    const start = act.indexOf(decl);
    if (start === -1) throw new Error('not found: ' + decl);
    return act.slice(start + decl.length, act.indexOf(end, start) + end.length - 1);
};
const _MONTHS = eval('(' + slice('    const _MONTHS = ', '};') + ')');
const _ymd = eval('(' + slice('    const _ymd = ') + ')');
const _biGender = eval('(' + slice('    const _biGender = ') + ')');
const parseApptDate = eval('(' + slice('    const parseApptDate = ') + ')');
const parseApptTime = eval('(' + slice('    const parseApptTime = ') + ')');
const _normLink = eval('(' + slice('    const _normLink = ', ';\n').replace(/;$/, '') + ')');
const _normText = eval('(' + slice('    const _normText = ', ';\n').replace(/;$/, '') + ')');
const matchVenue = eval('(' + slice('    const matchVenue = ') + ')');
const autoTitle = eval('(' + slice('    const autoTitle = ') + ')');

const SHARON = `请填妥基本资料 Basic information

1. 姓名 Name : Sharon Khor
2. 身分号码 IC: 840831025324
3. 职业 Occupation: self employed
4. 联络号码 Phone no: 0176349438
5. 邮箱 Email: Sharonkhorinhouse@yahoo.com

需要穿著端正，長褲包鞋 Proper attire required
(No slipper & short pant)

Date & Time
10am Wednesday, 21 Oct

Location
https://maps.app.goo.gl/evV979LDVe8E4p4B6`;

// ── Date ────────────────────────────────────────────────────────────────────
const T = new Date('2026-10-19T09:00:00');
eq('Sharon date', parseApptDate(SHARON, T), '2026-10-21');
eq('21 October 2026', parseApptDate('on 21 October 2026', T), '2026-10-21');
eq('Oct 21', parseApptDate('Oct 21, 3pm', T), '2026-10-21');
eq('21st Oct', parseApptDate('21st Oct', T), '2026-10-21');
eq('21/10', parseApptDate('Date: 21/10', T), '2026-10-21');
eq('21/10/2026', parseApptDate('21/10/2026', T), '2026-10-21');
eq('ISO', parseApptDate('2026-10-21', T), '2026-10-21');
eq('Chinese 10月21日', parseApptDate('10月21日 星期三', T), '2026-10-21');
eq('past date this year stays (caller asks)', parseApptDate('18 Oct', T), '2026-10-18');
eq('Dec message about Jan → next year', parseApptDate('5 Jan', new Date('2026-12-20T09:00:00')), '2027-01-05');
eq('31 Feb → none', parseApptDate('31 Feb', T), '');
eq('IC digits are not a date', parseApptDate('IC: 840831025324 phone 0176349438', T), '');
eq('no date', parseApptDate('hello', T), '');

// ── Time ────────────────────────────────────────────────────────────────────
eq('Sharon time', parseApptTime(SHARON), '10:00');
eq('2:30pm', parseApptTime('2:30pm'), '14:30');
eq('10.30 am', parseApptTime('10.30 am'), '10:30');
eq('12pm', parseApptTime('12pm'), '12:00');
eq('12am', parseApptTime('12am'), '00:00');
eq('14:30', parseApptTime('at 14:30'), '14:30');
eq('下午3点半', parseApptTime('下午3点半'), '15:30');
eq('上午10点', parseApptTime('上午10点'), '10:00');
eq('晚上8点', parseApptTime('晚上8点'), '20:00');
eq('no time', parseApptTime('IC: 840831025324'), '');

// ── Venue (rows mirror the live venues table, 2026-10-19) ───────────────────
const V = [
    { id: 1, name: 'Menara Bangkok Bank DC HQ', location: 'KL', waze_link: 'https://waze.com/ul/hw283fqe7z',
      map_links: 'https://maps.app.goo.gl/75Lb2oTjBnWpeNYMA https://maps.app.goo.gl/evV979LDVe8E4p4B6', aliases: 'MBB, Menara Bangkok Bank, Bangkok Bank' },
    { id: 2, name: 'Monalisa Bookstore', location: 'Bukit Jalil, KL', map_links: 'https://maps.app.goo.gl/kjpZvtJSUc9TbZWF6', aliases: 'Monalisa, Monalisa Book Store, 御書閣, 御书阁' },
    { id: 3, name: 'Far Coffee', location: 'Bukit Jalil', map_links: 'https://maps.app.goo.gl/LRAZ1qDh8zzueERx8', aliases: 'Far Coffee Bukit Jalil' },
    { id: 4, name: 'Far Coffee', location: 'Sunway Square, Selangor', map_links: null, aliases: 'Far Coffee Sunway, Sunway Square' },
    { id: 5, name: 'Florida 001', location: 'Bukit Jalil KL', map_links: 'https://maps.app.goo.gl/P7xzsZadmiP4bW519', aliases: 'Florida Western Food, Florida Bukit Jalil, Florida 001' },
    { id: 6, name: 'Florida001 PG', location: 'Bay Avenue, Bayan Lepas, Penang', map_links: null, aliases: null },
    { id: 7, name: 'DC SG Office Centrium Square', location: 'SG', map_links: 'https://maps.app.goo.gl/QJV2u8ws3xRKVLsPA', aliases: 'Centrium Square, Centrium, 320 Serangoon' },
    { id: 8, name: '豐展廳', location: 'Bay Avenue, Bayan Lepas, Penang', map_links: null, aliases: null },
];
const vid = (t) => (matchVenue(t, V) || {}).id || null;
eq('Sharon link → MBB', vid(SHARON), 1);
eq('other MBB link', vid('Location https://maps.app.goo.gl/75Lb2oTjBnWpeNYMA'), 1);
eq('link with ?g_st query', vid('https://maps.app.goo.gl/kjpZvtJSUc9TbZWF6?g_st=iw'), 2);
eq('Waze link', vid('https://waze.com/ul/hw283fqe7z'), 1);
eq('"MBB" in text', vid('Location: MBB level 23'), 1);
eq('"Menara Bangkok Bank" in text', vid('Menara Bangkok Bank 1-23-5, Jln Ampang'), 1);
eq('御書閣', vid('地点：御書閣'), 2);
eq('Far Coffee Bukit Jalil beats Sunway', vid('Far Coffee Bukit Jalil'), 3);
eq('Far Coffee Sunway', vid('Far Coffee Sunway Square'), 4);
eq('plain "Far Coffee" is ambiguous → none', vid('meet at Far Coffee'), null);
eq('Florida Western Food', vid('Florida Western Food (Bukit Jalil City)'), 5);
eq('Centrium', vid('Centrium Square320 Serangoon Rd'), 7);
eq('豐展廳 (CJK)', vid('在豐展廳见'), 8);
eq('unknown link → none', vid('https://maps.app.goo.gl/zzzzzzzzzzzzzzzz'), null);
eq('"mbbs" is not MBB', vid('my son studies mbbs'), null);
eq('nothing', vid('hello'), null);

// ── Title ───────────────────────────────────────────────────────────────────
eq('Male → Mr.', autoTitle('Male', ''), 'Mr.');
eq('male married → Mr.', autoTitle('male', 'Married'), 'Mr.');
eq('Female married → Mrs.', autoTitle('Female', 'Married'), 'Mrs.');
eq('Female single → Miss', autoTitle('Female', 'Single'), 'Miss');
eq('Female unknown → Ms.', autoTitle('Female', ''), 'Ms.');
eq('Female widowed → Ms.', autoTitle('F', 'Widowed'), 'Ms.');
eq('no gender → none', autoTitle('', 'Married'), '');

console.log(`test-paste-appointment: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
