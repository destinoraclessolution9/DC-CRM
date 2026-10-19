// ci/test-ming-gua.js — IC → DOB / gender, and DOB + gender → Ming Gua auto-fill
// on the shared basic-info form (CPS + Add/Edit Prospect), 2026-10-19.
//
// House rules (from the boss's tables):
//   · Malaysian IC YYMMDD-PB-###G: YYMMDD = birth date, last digit odd = Male,
//     even = Female.
//   · Ming Gua year turns at Li Chun (立春), NOT Chinese New Year. Li Chun table
//     covers 1950–2100 only; outside it no auto-fill.
//   · Male 2008 = MG1 counting up as the year goes down; female 1941 = MG1
//     counting up with the year. MG5 stays MG5.
//
// HARNESS: functions are SLICED OUT OF THE REAL SOURCE and eval'd (same pattern
// as test-basic-info-selects.js), never copied.
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
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sliceArrow = (src, decl, endMarker) => {
    const start = src.indexOf(decl);
    if (start === -1) throw new Error('not found: ' + decl);
    const end = src.indexOf(endMarker, start);
    return src.slice(start + decl.length, end + endMarker.length - 1);
};

const act = read('chunks/script-activities.js');
const cps = read('chunks/script-cps.js');
const _toIsoDate  = eval('(' + sliceArrow(act, '    const _toIsoDate = ', '\n    };') + ')');
const _biGender   = eval('(' + sliceArrow(act, '    const _biGender = ', '\n    };') + ')');
const icToDob     = eval('(' + sliceArrow(act, '    const icToDob = ', '\n    };') + ')');
const icToGender  = eval('(' + sliceArrow(act, '    const icToGender = ', '\n    };') + ')');
const liChunDay   = eval('(' + sliceArrow(act, '    const liChunDay = ', '\n    };') + ')');
const mingGuaFor  = eval('(' + sliceArrow(act, '    const mingGuaFor = ', '\n    };') + ')');
const _parseMalaysianIc = eval('(' + sliceArrow(cps, 'const _parseMalaysianIc = ', '\n};') + ')');

// ── 1. Li Chun table (boss's list: Feb 4, except Feb 5 / Feb 3 below) ──────
const FEB5 = [1952, 1956, 1960, 1964, 1968, 1972, 1976, 1980, 1984];
const FEB3 = [2017, 2021, 2025, 2029, 2033, 2037, 2041, 2045, 2049, 2053, 2057,
              2061, 2065, 2069, 2073, 2077, 2081, 2085, 2089, 2093, 2097];
for (let y = 1950; y <= 2100; y++) {
    eq(`Li Chun ${y}`, liChunDay(y), FEB5.includes(y) ? 5 : FEB3.includes(y) ? 3 : 4);
}
eq('Li Chun 1949 outside table', liChunDay(1949), 0);
eq('Li Chun 2101 outside table', liChunDay(2101), 0);

// ── 2. Ming Gua cycle vs the boss's picture (mid-year birthdays) ───────────
// Male column: 2008..2000 = 1..9, 1999..1991 = 1..9, … ; female 1941..1949 = 1..9, …
for (let y = 1951; y <= 2008; y++) {
    eq(`male ${y}`, mingGuaFor(`${y}-06-15`, 'Male'), `MG${((2008 - y) % 9) + 1}`);
}
for (let y = 1950; y <= 2012; y++) {
    eq(`female ${y}`, mingGuaFor(`${y}-06-15`, 'Female'), `MG${((y - 1941) % 9) + 1}`);
}
// Spot values read straight off the picture.
[['1990', 'Male', 'MG1'], ['1984', 'Male', 'MG7'], ['1965', 'Male', 'MG8'], ['1957', 'Male', 'MG7'],
 ['1990', 'Female', 'MG5'], ['1977', 'Female', 'MG1'], ['2012', 'Female', 'MG9'], ['1988', 'Female', 'MG3'],
 ['1988', 'Male', 'MG3']].forEach(([y, g, mg]) => eq(`picture ${y} ${g}`, mingGuaFor(`${y}-08-01`, g), mg));

// ── 3. Li Chun boundary ─────────────────────────────────────────────────────
eq('1990-02-01 male → previous year 1989 → MG2', mingGuaFor('1990-02-01', 'Male'), 'MG2');
eq('1990-02-03 male → still 1989', mingGuaFor('1990-02-03', 'Male'), 'MG2');
eq('1990-02-04 male → Li Chun day is the new year', mingGuaFor('1990-02-04', 'Male'), 'MG1');
eq('1990-01-28 male → after CNY but before Li Chun → 1989', mingGuaFor('1990-01-28', 'Male'), 'MG2');
eq('1984-02-04 female → Li Chun is Feb 5 that year → 1983', mingGuaFor('1984-02-04', 'Female'), mingGuaFor('1983-06-01', 'Female'));
eq('2017-02-03 female → Li Chun is Feb 3 → 2017', mingGuaFor('2017-02-03', 'Female'), mingGuaFor('2017-06-01', 'Female'));
eq('2017-02-02 female → 2016', mingGuaFor('2017-02-02', 'Female'), mingGuaFor('2016-06-01', 'Female'));

// ── 4. Outside the table / bad input → no auto-fill ────────────────────────
eq('born 1949 → skipped', mingGuaFor('1949-06-01', 'Male'), '');
eq('born 2101 → skipped', mingGuaFor('2101-06-01', 'Male'), '');
eq('no gender → skipped', mingGuaFor('1990-06-01', ''), '');
eq('Other gender → skipped', mingGuaFor('1990-06-01', 'Other'), '');
eq('no DOB → skipped', mingGuaFor('', 'Male'), '');
eq('lowercase gender accepted', mingGuaFor('1990-06-01', 'female'), 'MG5');
eq('F accepted', mingGuaFor('1990-06-01', 'F'), 'MG5');

// ── 5. IC → DOB / gender ────────────────────────────────────────────────────
eq('IC plain → DOB', icToDob('901024075153'), '1990-10-24');
eq('IC dashed → DOB', icToDob('901024-07-5153'), '1990-10-24');
eq('IC last digit 3 → Male', icToGender('901024-07-5153'), 'Male');
eq('IC last digit 4 → Female', icToGender('901024-07-5154'), 'Female');
eq('IC 2000s', icToDob('050312-10-1234'), '2005-03-12');
eq('IC 1930 is not 2030', icToDob('300101-01-1234'), '1930-01-01');
eq('impossible date → none', icToDob('901324-07-5153'), '');
eq('passport → none', icToDob('A12345678'), '');
eq('passport → no gender', icToGender('A12345678'), '');
eq('IC example end-to-end → MG1', mingGuaFor(icToDob('901024-07-5153'), icToGender('901024-07-5153')), 'MG1');
eq('script-cps parser agrees on century', _parseMalaysianIc('300101-01-1234').dob, '1930-01-01');
eq('script-cps parser 2005', _parseMalaysianIc('050312-10-1234').dob, '2005-03-12');

console.log(`test-ming-gua: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
