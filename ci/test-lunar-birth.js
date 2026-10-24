// ci/test-lunar-birth.js — solar DOB → Lunar Birth, 2026-10-25.
//
// Bugs fixed (script.js convertSolarToLunar):
//   · lunar-calendar.min.js returns lunarMonth as the month's SLOT, so in a
//     闰月 year the leap month and every month after it came out one too high
//     (2020 闰四月初一 was stored "2020-05-01 (Lunar)", 2020 五月初一 "2020-06-01").
//   · its month-length data is wrong in 1926/1935/1945/2007/2057/2089/2097
//     (e.g. 2007-04-17 = 三月初一, it said 二月三十).
//   · its local-time maths gives fractional days in Malaysian time for
//     1905/1933/1941/1942 ("1942-01-2.9375 (Lunar)").
// Now a table built from the Hong Kong Observatory tables does 1901–2099; a
// leap month is written "YYYY-MM-DD (Lunar 闰)".
//
// Reference: ci/fixtures/hko-lunar-months.json = every lunar month start in the
// HKO Gregorian-Lunar conversion tables 1901–2100. Every day is checked.
//
// HARNESS: the code is SLICED OUT OF THE REAL SOURCE and eval'd (same idea as
// test-ming-gua.js), never copied; the real lunar-calendar.min.js is loaded.
'use strict';
process.env.TZ = 'Asia/Kuala_Lumpur';   // where the fractional-day bug shows
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const eq = (name, got, want) => {
    if (got === want) { pass++; return; }
    fail++;
    if (fail <= 25) console.error(`FAIL ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
};
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Load the real library into a fake window.
const window = {};
new Function('window', read('lunar-calendar.min.js'))(window);

const src = read('script.js').replace(/\r\n/g, '\n');
const startDecl = '    const _LUNAR_FIRST_YEAR = ';
const endMarker = "        return 'Conversion failed';\n    };\n";
const a = src.indexOf(startDecl);
const b = src.indexOf(endMarker, a);
if (a === -1 || b === -1) throw new Error('lunar block not found in script.js');
const { convertSolarToLunar, solarToLunarHko, lunarMonthFromSlot } = new Function('window',
    src.slice(a, b + endMarker.length) + '\nreturn { convertSolarToLunar, solarToLunarHko, lunarMonthFromSlot };')(window);

// ── hand-picked cases (HKO) ────────────────────────────────────────────────
const cases = [
    // first day of each leap month
    ['2020-05-23', '2020-04-01 (Lunar 闰)'],
    ['2023-03-22', '2023-02-01 (Lunar 闰)'],
    ['2017-07-23', '2017-06-01 (Lunar 闰)'],
    ['2012-05-21', '2012-04-01 (Lunar 闰)'],
    ['2009-06-23', '2009-05-01 (Lunar 闰)'],
    ['2006-08-24', '2006-07-01 (Lunar 闰)'],
    ['2004-03-21', '2004-02-01 (Lunar 闰)'],
    ['2001-05-23', '2001-04-01 (Lunar 闰)'],
    ['1998-06-24', '1998-05-01 (Lunar 闰)'],
    ['1995-09-25', '1995-08-01 (Lunar 闰)'],
    ['1990-06-23', '1990-05-01 (Lunar 闰)'],
    ['1987-07-26', '1987-06-01 (Lunar 闰)'],
    // last day of a leap month, and the month right after it
    ['2020-06-20', '2020-04-29 (Lunar 闰)'],
    ['2020-06-21', '2020-05-01 (Lunar)'],
    ['2023-04-20', '2023-03-01 (Lunar)'],
    ['2017-08-22', '2017-07-01 (Lunar)'],
    ['1990-07-22', '1990-06-01 (Lunar)'],
    // the normal month before the leap month
    ['2020-04-23', '2020-04-01 (Lunar)'],
    ['2023-02-20', '2023-02-01 (Lunar)'],
    // late in a leap year — every month after the leap was off by one
    ['2020-12-15', '2020-11-01 (Lunar)'],
    ['2021-01-13', '2020-12-01 (Lunar)'],
    // Chinese New Year edges
    ['2020-01-24', '2019-12-30 (Lunar)'],
    ['2020-01-25', '2020-01-01 (Lunar)'],
    ['2023-01-21', '2022-12-30 (Lunar)'],
    ['2023-01-22', '2023-01-01 (Lunar)'],
    ['1990-01-26', '1989-12-30 (Lunar)'],
    ['1990-01-27', '1990-01-01 (Lunar)'],
    // library data errors / fractional days
    ['2007-04-17', '2007-03-01 (Lunar)'],
    ['1945-09-06', '1945-08-01 (Lunar)'],
    ['1942-02-17', '1942-01-03 (Lunar)'],
    // non-leap year, unchanged
    ['1990-03-15', '1990-02-19 (Lunar)'],
    ['', ''],
];
for (const [solar, want] of cases) eq(`case ${solar}`, convertSolarToLunar(solar), want);

// ── pure helpers ───────────────────────────────────────────────────────────
eq('slot no-leap', JSON.stringify(lunarMonthFromSlot(6, 0)), '{"month":6,"leap":false}');
eq('slot = leap', JSON.stringify(lunarMonthFromSlot(5, 4)), '{"month":4,"leap":true}');
eq('slot after leap', JSON.stringify(lunarMonthFromSlot(13, 4)), '{"month":12,"leap":false}');
eq('table ends 2099', solarToLunarHko(2100, 3, 1), null);
eq('table starts 1901', solarToLunarHko(1901, 1, 31), null);

// ── every day vs HKO ───────────────────────────────────────────────────────
const months = JSON.parse(read('ci/fixtures/hko-lunar-months.json')).months.map((s) => {
    const m = s.match(/^(\d{4})(\d\d)(\d\d)(L?)(\d+)$/);
    return { t: Date.UTC(+m[1], m[2] - 1, +m[3]), leap: !!m[4], month: +m[5] };
});
const pad = (n) => String(n).padStart(2, '0');
let i = 0, lunarYear = 1900, days = 0, leapDays = 0;
for (let t = months[0].t; t <= Date.UTC(2100, 11, 31); t += 864e5) {
    while (i + 1 < months.length && months[i + 1].t <= t) {
        i++;
        if (months[i].month === 1 && !months[i].leap) lunarYear = new Date(months[i].t).getUTCFullYear();
    }
    const M = months[i];
    const want = `${lunarYear}-${pad(M.month)}-${pad(Math.round((t - M.t) / 864e5) + 1)} (Lunar${M.leap ? ' 闰' : ''})`;
    const d = new Date(t);
    eq(`HKO ${d.toISOString().slice(0, 10)}`, convertSolarToLunar(d.toISOString().slice(0, 10)), want);
    days++;
    if (M.leap) leapDays++;
}
eq('sweep covered 1901–2100', days > 73000 && leapDays > 2000, true);

console.log(`test-lunar-birth: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
